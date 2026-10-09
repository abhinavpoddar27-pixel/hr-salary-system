/**
 * Loans engine — the Stage 7 loan step (Loans PR-5, docs/loans/SPEC.md §5.1,
 * §5.2 r4–r5, D-5, D-6, D-11, D-12; K2, K22–K25, K29).
 *
 * The one rule (§5.1): Stage 7 only records a PROVISIONAL deduction. Nothing
 * here moves a balance or posts; the loan close (PR-6) does.
 *
 *  planStage7Loans   READ-ONLY. Called by computeEmployeeSalary after every
 *                    other deduction is known (the loan is LAST, D-12). Works out
 *                    the amount per live loan: min(due, headroom under the cap,
 *                    balance). A month already posted is frozen (K2): exactly the
 *                    posted amount, with any part the headroom can no longer
 *                    carry reported as an `unborne` alert for PR-6.
 *  applyStage7Loans  Called by saveSalaryComputation AFTER the salary row is
 *                    written. recordProvisional per loan (keyed loan + month +
 *                    payroll — never the salary row id, so re-runs and reimports
 *                    give the same rows), then reverses any provisional row of
 *                    this employee + month the plan no longer contains. Only
 *                    what changed is written, so a re-run writes no events.
 *                    THROWS on any ledger refusal: the caller's per-employee
 *                    savepoint then rolls back the salary row with it, so the
 *                    payslip and the loan ledger never disagree.
 *  clearStage7Loans  An employee Stage 7 did not pay this run (excluded / zero
 *                    attendance): their provisional rows are reversed (K29).
 *  clearOrphanProvisional  Provisional rows for the month with no salary row at
 *                    all (reimport deleted it and the employee was not
 *                    recomputed) are reversed.
 *
 * Matching is by employee code only — never the loan's or the run's company
 * (K7, K8). Plant only for now; sales arrives with PR-8.
 */
const { toPaise, toRupees } = require('./money');
const { readLoanPolicy } = require('./policy');
const { earnedBase, priorDeductions, computeHeadroom, planLoanDeduction } = require('./headroom');
const { LIVE_LOAN_STATES } = require('./states');
const { recordProvisional, clearProvisional } = require('./ledger');

const SYSTEM = Object.freeze({ username: 'system', role: 'system' });
const LIVE_SQL = LIVE_LOAN_STATES.map((s) => `'${s}'`).join(',');

// Once the loan tables are migrated they stay migrated for the life of the
// process, so a positive answer is cached per database handle.
const ready = new WeakSet();
function loansReady(db) {
  if (ready.has(db)) return true;
  const r = db.prepare("SELECT value FROM policy_config WHERE key = 'migration_loans_schema_v2_done'").get();
  if (r) { ready.add(db); return true; }
  return false;
}

function assertPayroll(payroll) {
  if (payroll !== 'plant') throw new Error(`loans stage7: payroll ${payroll} is not wired yet (sales = Loans PR-8)`);
}

const empty = (extra = {}) => ({ totalRupees: 0, totalPaise: 0, items: [], alerts: [], warnings: [], headroomPaise: null, capPct: null, ...extra });

/**
 * @param {object} p {employeeCode, month, year, payroll, salary}
 *   salary = this month's figures by salary_computations column name
 *   (gross_earned, ot_pay, holiday_duty_pay, pf_employee, … early_exit_deduction).
 */
function planStage7Loans(db, { employeeCode, month, year, payroll = 'plant', salary }) {
  assertPayroll(payroll);
  if (!loansReady(db)) {
    return empty({ skipped: true, warnings: ['loan tables not migrated (migration_loans_schema_v2_done missing) — loan step skipped'] });
  }
  const loans = db.prepare(`SELECT * FROM loans WHERE employee_code = ? AND borrower_type = ? AND status IN (${LIVE_SQL}) ORDER BY id`)
    .all(String(employeeCode), payroll);
  if (loans.length === 0) return empty();

  const capPct = readLoanPolicy(db).deductionCapPct;
  const headroomPaise = computeHeadroom({
    earnedBasePaise: earnedBase(salary, payroll), capPct, priorDeductionsPaise: priorDeductions(salary, payroll),
  });
  let room = headroomPaise;
  const items = [];
  const alerts = [];

  // 1. Months already posted at a loan close are frozen (K2): deduct exactly that.
  const postedStmt = db.prepare("SELECT * FROM loan_deductions WHERE loan_id = ? AND month = ? AND year = ? AND payroll = ? AND state = 'posted'");
  const frozenIds = new Set();
  for (const loan of loans) {
    const posted = postedStmt.get(loan.id, month, year, payroll);
    if (!posted) continue;
    const p = planLoanDeduction({ duePaise: 0, headroomPaise: room, postedPaise: toPaise(posted.amount) });
    frozenIds.add(loan.id);
    items.push({ loanId: loan.id, instalmentId: posted.instalment_id, duePaise: p.deductPaise, amountPaise: p.deductPaise, shortfallPaise: 0, unbornePaise: p.unbornePaise, frozen: true });
    if (p.unbornePaise > 0) {
      alerts.push({
        type: 'loan_posted_unborne', severity: 'action_required', audience: 'finance',
        loanId: loan.id, employeeCode: loan.employee_code, payroll, month, year,
        postedAmount: toRupees(p.deductPaise), unborneAmount: toRupees(p.unbornePaise),
        message: `Loan ${loan.id} (${loan.employee_code}) ${month}/${year}: posted ₹${toRupees(p.deductPaise)} no longer fits the cap by ₹${toRupees(p.unbornePaise)}; it is still deducted in full until the loan close moves the unborne part (PR-6).`,
      });
    }
    room = Math.max(0, room - p.deductPaise);
  }

  // 2. The instalment due this month, oldest loan first, inside what room is left.
  const dueStmt = db.prepare(`SELECT * FROM loan_instalments WHERE loan_id = ? AND due_month = ? AND due_year = ?
                                AND status IN ('scheduled','provisional') ORDER BY sequence LIMIT 1`);
  for (const loan of loans) {
    if (frozenIds.has(loan.id)) continue;
    const ins = dueStmt.get(loan.id, month, year);
    if (!ins) continue;
    const duePaise = toPaise(ins.amount_due);
    const owed = Math.min(duePaise, Math.max(0, toPaise(loan.remaining_balance)));
    const p = planLoanDeduction({ duePaise: owed, headroomPaise: room });
    // A ₹0 item is kept on purpose: the close turns it into a shortfall instalment (D-5).
    items.push({ loanId: loan.id, instalmentId: ins.id, duePaise, amountPaise: p.deductPaise, shortfallPaise: duePaise - p.deductPaise, unbornePaise: 0, frozen: false });
    room -= p.deductPaise;
  }

  const totalPaise = items.reduce((s, i) => s + i.amountPaise, 0);
  return { totalRupees: toRupees(totalPaise), totalPaise, items, alerts, warnings: [], headroomPaise, capPct };
}

function refuse(what, r) {
  return new Error(`loan ledger refused ${what}: ${r.code} — ${r.message}`);
}

/**
 * Writes the plan after the salary row is saved. Throws on any refusal.
 * @returns {{recorded:number, cleared:number}}
 */
function applyStage7Loans(db, { employeeCode, month, year, payroll = 'plant', company, plan, runId = null }) {
  assertPayroll(payroll);
  if (!plan || plan.skipped || !loansReady(db)) return { recorded: 0, cleared: 0 };
  let recorded = 0;
  for (const item of plan.items) {
    if (item.frozen) continue; // posted: never rewritten (K2)
    const r = recordProvisional(db, {
      loanId: item.loanId, instalmentId: item.instalmentId, payroll, month, year, company,
      amount: toRupees(item.amountPaise), runId,
    }, SYSTEM);
    if (!r.ok) throw refuse(`loan ${item.loanId} ${month}/${year}`, r);
    if (r.changed) recorded += 1;
  }
  // Provisional rows of this employee + month that the plan no longer has
  // (loan no longer live, instalment moved, nothing due) are superseded.
  const keep = new Set(plan.items.map((i) => i.loanId));
  const stale = db.prepare(`SELECT loan_id FROM loan_deductions WHERE employee_code = ? AND month = ? AND year = ? AND payroll = ? AND state = 'provisional'`)
    .all(String(employeeCode), month, year, payroll).filter((r) => !keep.has(r.loan_id));
  let cleared = 0;
  for (const s of stale) {
    const r = clearProvisional(db, { loanId: s.loan_id, month, year, payroll, reason: `Stage 7 re-run${runId ? ` ${runId}` : ''}: not deducted this run` }, SYSTEM);
    if (!r.ok) throw refuse(`clearing loan ${s.loan_id} ${month}/${year}`, r);
    if (r.changed) cleared += 1;
  }
  return { recorded, cleared };
}

/** Reverses every provisional row of one employee + month (Stage 7 did not pay them this run). */
function clearStage7Loans(db, { employeeCode, month, year, payroll = 'plant', reason }) {
  assertPayroll(payroll);
  if (!loansReady(db)) return { cleared: 0 };
  const rows = db.prepare(`SELECT loan_id FROM loan_deductions WHERE employee_code = ? AND month = ? AND year = ? AND payroll = ? AND state = 'provisional'`)
    .all(String(employeeCode), month, year, payroll);
  let cleared = 0;
  for (const row of rows) {
    const r = clearProvisional(db, { loanId: row.loan_id, month, year, payroll, reason }, SYSTEM);
    if (!r.ok) throw refuse(`clearing loan ${row.loan_id} ${month}/${year}`, r);
    if (r.changed) cleared += 1;
  }
  return { cleared };
}

/** Reverses provisional rows for the month whose employee has no salary row at all. */
function clearOrphanProvisional(db, { month, year, payroll = 'plant', reason }) {
  assertPayroll(payroll);
  if (!loansReady(db)) return { cleared: 0, rows: [] };
  const rows = db.prepare(`
    SELECT ld.loan_id, ld.employee_code FROM loan_deductions ld
     WHERE ld.payroll = ? AND ld.month = ? AND ld.year = ? AND ld.state = 'provisional'
       AND NOT EXISTS (SELECT 1 FROM salary_computations sc
                        WHERE sc.employee_code = ld.employee_code AND sc.month = ld.month AND sc.year = ld.year)
  `).all(payroll, month, year);
  for (const row of rows) {
    const r = clearProvisional(db, { loanId: row.loan_id, month, year, payroll, reason: reason || 'no salary row for this month' }, SYSTEM);
    if (!r.ok) throw refuse(`clearing orphan loan ${row.loan_id} ${month}/${year}`, r);
  }
  return { cleared: rows.length, rows: rows.map((r) => ({ loanId: r.loan_id, employeeCode: r.employee_code })) };
}

module.exports = { planStage7Loans, applyStage7Loans, clearStage7Loans, clearOrphanProvisional, STAGE7_ACTOR: SYSTEM };
