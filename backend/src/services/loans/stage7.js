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
 *                    effective posted amount (posted − opposite entries). If the
 *                    headroom can no longer carry it (PR-6, owner ruling Q3), a
 *                    live loan deducts only what fits and the plan asks apply to
 *                    move the rest (`moveUnbornePaise`); a loan that is no longer
 *                    live still deducts in full and finance is alerted.
 *  applyStage7Loans  Called by saveSalaryComputation AFTER the salary row is
 *                    written. recordProvisional per loan (keyed loan + month +
 *                    payroll — never the salary row id, so re-runs and reimports
 *                    give the same rows), then reverses any provisional row of
 *                    this employee + month the plan no longer contains. Only
 *                    what changed is written, so a re-run writes no events.
 *                    THROWS on any ledger refusal: the caller's per-employee
 *                    savepoint then rolls back the salary row with it, so the
 *                    payslip and the loan ledger never disagree. The unborne
 *                    part of a frozen month becomes an opposite entry here, in
 *                    the same savepoint (adjustments.js), so payslip = ledger.
 *                    K8: refuses if the employee-month has two salary rows.
 *  clearStage7Loans  An employee Stage 7 did not pay this run (excluded / zero
 *                    attendance): their provisional rows are reversed (K29).
 *  clearOrphanProvisional  Provisional rows for the month with no salary row at
 *                    all (reimport deleted it and the employee was not
 *                    recomputed) are reversed.
 *
 * Plant matches by employee code only — never the loan's or the run's company
 * (K7, K8). Sales (Loans PR-8, planner ruling Q2) matches by employee code AND
 * the loan's company: a sales person is code + company (sales_employees is
 * UNIQUE on both, and sales_salary_computations on code + month + company), so a
 * sales loan deducts only in the salary row of its own company, whatever the
 * order the companies are computed in — the K8 guard for sales.
 *  clearSalesNotComputed  (sales) provisional rows of a company + month whose
 *                    employee the sales compute did not pay this run (excluded,
 *                    or no longer in the active upload) are reversed; the salary
 *                    rows the run did not compute are never rewritten (ruling Q7)
 *                    and are reported as stale.
 */
const { toPaise, toRupees } = require('./money');
const { readLoanPolicy } = require('./policy');
const { earnedBase, priorDeductions, computeHeadroom, planLoanDeduction } = require('./headroom');
const { LIVE_LOAN_STATES } = require('./states');
const { recordProvisional, clearProvisional } = require('./ledger');
const { effectivePostedPaise, writeAdjustment } = require('./adjustments');
const { notifyAlerts } = require('./notify');

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

function assertPayroll(payroll, company) {
  if (payroll !== 'plant' && payroll !== 'sales') throw new Error(`loans stage7: unknown payroll ${payroll}`);
  if (payroll === 'sales' && !String(company || '').trim()) throw new Error('loans stage7: a sales run needs its company (Loans PR-8, K8)');
}

/** Sales only: the loan's company must be the run's company (planner ruling Q2). */
const salesCo = (payroll, company, alias) => (payroll === 'sales'
  ? { sql: ` AND ${alias}.company = ?`, args: [String(company).trim()] } : { sql: '', args: [] });

const empty = (extra = {}) => ({ totalRupees: 0, totalPaise: 0, items: [], alerts: [], warnings: [], headroomPaise: null, capPct: null, ...extra });

/**
 * @param {object} p {employeeCode, month, year, payroll, company, salary}
 *   salary = this month's figures by salary-table column name (plant:
 *   gross_earned, ot_pay, … early_exit_deduction; sales: gross_earned, pf_employee,
 *   esi_employee, professional_tax, tds, advance_recovery, diwali_recovery,
 *   other_deductions — see headroom.js). company: required for sales.
 */
function planStage7Loans(db, { employeeCode, month, year, payroll = 'plant', company = null, salary }) {
  assertPayroll(payroll, company);
  if (!loansReady(db)) {
    return empty({ skipped: true, warnings: ['loan tables not migrated (migration_loans_schema_v2_done missing) — loan step skipped'] });
  }
  const lc = salesCo(payroll, company, 'loans');
  const loans = db.prepare(`SELECT * FROM loans WHERE employee_code = ? AND borrower_type = ? AND status IN (${LIVE_SQL})${lc.sql} ORDER BY id`)
    .all(String(employeeCode), payroll, ...lc.args);
  // Posted months are read from the ledger whatever the loan's status now (Loans
  // PR-6): the close that posts a last instalment completes the loan, and a
  // later re-run of that month must still deduct exactly the posted amount.
  const postedRows = db.prepare(`SELECT ld.*, l.status AS loan_status FROM loan_deductions ld JOIN loans l ON l.id = ld.loan_id
                                  WHERE ld.employee_code = ? AND ld.month = ? AND ld.year = ? AND ld.payroll = ? AND ld.state = 'posted'
                                    AND l.borrower_type = ?${salesCo(payroll, company, 'l').sql} ORDER BY ld.loan_id`)
    .all(String(employeeCode), month, year, payroll, payroll, ...salesCo(payroll, company, 'l').args);
  if (loans.length === 0 && postedRows.length === 0) return empty();

  const capPct = readLoanPolicy(db).deductionCapPct;
  const headroomPaise = computeHeadroom({
    earnedBasePaise: earnedBase(salary, payroll), capPct, priorDeductionsPaise: priorDeductions(salary, payroll),
  });
  let room = headroomPaise;
  const items = [];
  const alerts = [];

  // 1. Months already posted at a loan close are frozen (K2): deduct exactly that.
  const frozenIds = new Set();
  for (const posted of postedRows) {
    const effPaise = effectivePostedPaise(db, posted);
    const live = LIVE_LOAN_STATES.includes(posted.loan_status);
    const p = planLoanDeduction({ duePaise: 0, headroomPaise: room, postedPaise: effPaise });
    // Live loan: deduct what still fits; the rest becomes an opposite entry in apply (ruling Q3).
    const moveUnbornePaise = live ? p.unbornePaise : 0;
    const amountPaise = p.deductPaise - moveUnbornePaise;
    frozenIds.add(posted.loan_id);
    items.push({
      loanId: posted.loan_id, instalmentId: posted.instalment_id, deductionId: posted.id, duePaise: effPaise, amountPaise,
      shortfallPaise: 0, unbornePaise: p.unbornePaise, moveUnbornePaise, frozen: true,
    });
    if (p.unbornePaise > 0) {
      alerts.push({
        type: live ? 'loan_posted_unborne_moved' : 'loan_posted_unborne', severity: 'action_required', audience: 'finance',
        loanId: posted.loan_id, employeeCode: posted.employee_code, payroll, month, year,
        postedAmount: toRupees(effPaise), unborneAmount: toRupees(p.unbornePaise), deductedAmount: toRupees(amountPaise),
        message: live
          ? `Loan ${posted.loan_id} (${posted.employee_code}) ${month}/${year}: posted ₹${toRupees(effPaise)} no longer fits the cap; ₹${toRupees(amountPaise)} is deducted and ₹${toRupees(p.unbornePaise)} moves to a new last instalment (opposite entry).`
          : `Loan ${posted.loan_id} (${posted.employee_code}) ${month}/${year}: posted ₹${toRupees(effPaise)} no longer fits the cap by ₹${toRupees(p.unbornePaise)}; the loan is ${posted.loan_status}, so it is still deducted in full. Finance must review.`,
      });
    }
    room = Math.max(0, room - amountPaise);
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
  assertPayroll(payroll, company);
  if (!plan || plan.skipped || !loansReady(db)) return { recorded: 0, cleared: 0, adjusted: 0 };
  // K8 (Loans PR-6): the ledger holds one deduction per loan + month + payroll, so
  // two salary rows for one employee-month would show the loan twice. The plant
  // table is unique on (employee_code, month, year), so this cannot happen while
  // that key exists; if it ever does, this employee fails in its savepoint.
  // Sales (PR-8): the plan only holds loans of the run's company (ruling Q2) — a
  // loan of another company here would be a bug, so it fails the employee.
  if (payroll === 'sales') {
    const want = String(company).trim();
    for (const item of plan.items) {
      const l = db.prepare('SELECT company FROM loans WHERE id = ?').get(item.loanId);
      if (!l || String(l.company).trim() !== want) throw new Error(`loan step refused: LOAN_COMPANY_MISMATCH — loan ${item.loanId} is not a ${want} loan (K8)`);
    }
  } else if (plan.items.length > 0) {
    const rows = db.prepare('SELECT COUNT(*) AS n FROM salary_computations WHERE employee_code = ? AND month = ? AND year = ?')
      .get(String(employeeCode), month, year).n;
    if (rows > 1) throw new Error(`loan step refused: LOAN_TWO_SALARY_ROWS — ${employeeCode} has ${rows} salary rows for ${month}/${year}; a loan is deducted once only (K8)`);
  }
  let recorded = 0;
  let adjusted = 0;
  for (const item of plan.items) {
    if (item.frozen) {
      // posted: never rewritten (K2). The part pay can no longer bear → opposite entry.
      if (item.moveUnbornePaise > 0) {
        const a = writeAdjustment(db, {
          deductionId: item.deductionId, kind: 'unborne', amountPaise: item.moveUnbornePaise,
          reason: `Stage 7${runId ? ` ${runId}` : ''}: pay no longer bears ₹${toRupees(item.moveUnbornePaise)} of the posted ${month}/${year} amount`,
        }, SYSTEM);
        if (!a.ok) throw refuse(`opposite entry on loan ${item.loanId} ${month}/${year}`, a);
        adjusted += 1;
        plan.alerts.push(...a.alerts);
      }
      continue;
    }
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
  const dc = salesCo(payroll, company, 'loan_deductions');
  const stale = db.prepare(`SELECT loan_id FROM loan_deductions WHERE employee_code = ? AND month = ? AND year = ? AND payroll = ? AND state = 'provisional'${dc.sql}`)
    .all(String(employeeCode), month, year, payroll, ...dc.args).filter((r) => !keep.has(r.loan_id));
  let cleared = 0;
  for (const s of stale) {
    const r = clearProvisional(db, { loanId: s.loan_id, month, year, payroll, reason: `Stage 7 re-run${runId ? ` ${runId}` : ''}: not deducted this run` }, SYSTEM);
    if (!r.ok) throw refuse(`clearing loan ${s.loan_id} ${month}/${year}`, r);
    if (r.changed) cleared += 1;
  }
  // Finance is flagged (SPEC §5.2 r7) — both kinds of unborne alert, de-duplicated per
  // day. Inside the savepoint: rolls back with the employee.
  if (plan.alerts.length) notifyAlerts(db, plan.alerts);
  return { recorded, cleared, adjusted };
}

/** Reverses every provisional row of one employee + month (Stage 7 did not pay them this run). */
function clearStage7Loans(db, { employeeCode, month, year, payroll = 'plant', company = null, reason }) {
  assertPayroll(payroll, company);
  if (!loansReady(db)) return { cleared: 0 };
  const dc = salesCo(payroll, company, 'loan_deductions');
  const rows = db.prepare(`SELECT loan_id FROM loan_deductions WHERE employee_code = ? AND month = ? AND year = ? AND payroll = ? AND state = 'provisional'${dc.sql}`)
    .all(String(employeeCode), month, year, payroll, ...dc.args);
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
  if (payroll !== 'plant') throw new Error('clearOrphanProvisional is plant-only; sales uses clearSalesNotComputed (Loans PR-8)');
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

/**
 * Sales (Loans PR-8, ruling Q7 — mirrors plant PR-5 Q3): after a sales compute of
 * company + month, reverse the provisional sales rows of every employee the run
 * did not pay — excluded (no structure, no days…), or no longer in the active
 * upload. `keepCodes` = the employees the run computed OR failed on (a failing
 * employee keeps its previous salary row and provisional rows, as on plant).
 * Salary rows the run did not compute are NEVER rewritten: one still carrying a
 * loan_recovery is returned in staleRows (the close then sees payslip ≠ ledger,
 * leaves it and tells finance) and logged `LOAN STALE ROW`.
 */
function clearSalesNotComputed(db, { month, year, company, keepCodes, reason }) {
  assertPayroll('sales', company);
  if (!loansReady(db)) return { cleared: 0, staleRows: [] };
  const keep = new Set([...(keepCodes || [])].map(String));
  const rows = db.prepare(`SELECT loan_id, employee_code FROM loan_deductions
                            WHERE payroll = 'sales' AND month = ? AND year = ? AND company = ? AND state = 'provisional' ORDER BY loan_id`)
    .all(month, year, String(company).trim()).filter((r) => !keep.has(String(r.employee_code)));
  const staleRows = [];
  const sal = db.prepare('SELECT id, loan_recovery FROM sales_salary_computations WHERE employee_code = ? AND month = ? AND year = ? AND company = ?');
  for (const row of rows) {
    const r = clearProvisional(db, { loanId: row.loan_id, month, year, payroll: 'sales', reason: reason || 'sales compute did not pay this employee this run' }, SYSTEM);
    if (!r.ok) throw refuse(`clearing sales loan ${row.loan_id} ${month}/${year}`, r);
    const s = sal.get(row.employee_code, month, year, String(company).trim());
    if (s && Number(s.loan_recovery || 0) !== 0) {
      staleRows.push({ employeeCode: row.employee_code, salaryRowId: s.id, loanRecovery: s.loan_recovery, loanId: row.loan_id });
      console.warn(`LOAN STALE ROW ${row.employee_code} ${month}/${year} sales ${company}: salary row keeps loan ₹${s.loan_recovery}; the loan ledger no longer holds it`);
    }
  }
  return { cleared: rows.length, staleRows };
}

module.exports = { planStage7Loans, applyStage7Loans, clearStage7Loans, clearOrphanProvisional, clearSalesNotComputed, loansReady, STAGE7_ACTOR: SYSTEM };
