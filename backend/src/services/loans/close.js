/**
 * Loans engine — the monthly loan close, the held sweep and the catch-up
 * (Loans PR-6, docs/loans/SPEC.md §5.1, §5.2 r6–r8 and r13, D-5, D-10, D-14,
 * D-19; K1, K5, K6, K19, K27–K29, K33, K34; owner rulings Q1–Q12, 10 Oct 2026).
 *
 * The one rule (§5.1): Stage 7 records a PROVISIONAL deduction; the loan
 * balance moves once, here, at the close of month M (or later, by the sweep,
 * for a salary that was held at the close).
 *
 *  runLoanClose     one payroll + month, one transaction. Writes its
 *                   loan_closes row FIRST (the unique key is the restart /
 *                   double-run guard, K33), then posts every provisional row
 *                   whose salary is not held and whose payslip agrees with the
 *                   ledger; a due instalment with no deduction moves to the end
 *                   ("no salary", D9/K6); reconciles before and after and rolls
 *                   the whole close back if the close itself broke a loan.
 *  runHeldSweep     daily. Posts a held row once its hold is released (checked
 *                   at that moment, K19); still held `loan_held_emi_wait_days`
 *                   after the close → the instalment moves to the end and the
 *                   reversed row is the loan-side "salary row stale" marker
 *                   (K28) that loanHoldReleaseCheck reads.
 *  runCatchUp       closes every needed month up to the due month, oldest first,
 *                   stopping at the first that is not ready.
 *
 * An EMPTY LEDGER WRITES NOTHING (owner ruling Q5): a close is only "needed"
 * when a provisional row or an open instalment exists for that month.
 *
 * Payrolls close separately (ruling Q7): plant never waits for sales. Sales
 * (Loans PR-8, K10): month M is ready once every company with a sales loan due
 * or provisional in M has an ACTIVE sales upload stamped `computed` (the sales
 * Stage 7 ran on it); a sales row on status 'hold' counts as held. A sales
 * person is code + company, so every sales check keys on both.
 *
 * By the 13th the salary has been paid, so the close never waits for one
 * employee to be re-run: a per-employee problem is left provisional, listed and
 * alerted, and the daily sweep picks it up once it is clean.
 */
const { toPaise, toRupees } = require('./money');
const { addMonths, compareMonth, isValidMonth, todayIst, monthIndex } = require('./months');
const { readLoanPolicy } = require('./policy');
const { checkActor, LIVE_LOAN_STATES } = require('./states');
const { fail, text, exitResidualPaise } = require('./common');
const { exitLoansForMonth, heldPendingPaise, exitFinalPayrollWarnings } = require('./exit');
const { postDeduction, moveInstalmentToEnd, HELD_MOVE_REVERSAL_REASON } = require('./ledger');
const { effectivePostedPaise, writeAdjustment } = require('./adjustments');
const { reconcileLoan } = require('./reconcile');
const { loansReady } = require('./stage7');
const { notify, notifyAlerts } = require('./notify');

const SYSTEM = Object.freeze({ username: 'system', role: 'system' });
const PAYROLLS = Object.freeze(['plant', 'sales']);
const LIVE_SQL = LIVE_LOAN_STATES.map((s) => `'${s}'`).join(',');
const WAITING_CODES = new Set(['STAGE7_NOT_COMPUTED', 'EARLIER_MONTH_OPEN']);

/** Who one salary row belongs to: plant = code; sales = code + company (Loans PR-8). */
const personKey = (payroll, code, company) => (payroll === 'sales' ? `${code}|${String(company || '').trim()}` : String(code));

const label = (m) => `${m.month}/${m.year}`;
const rs = (paise) => `₹${toRupees(paise).toLocaleString('en-IN')}`;

/** {year, month, day} of `now` in IST. */
function istToday(now = new Date()) {
  const [year, month, day] = todayIst(now).split('-').map(Number);
  return { year, month, day };
}

/** 'YYYY-MM-DD HH:MM:SS' (UTC) — the shape SQLite's datetime('now') writes. */
function sqlUtc(now = new Date()) {
  return now.toISOString().slice(0, 19).replace('T', ' ');
}

/**
 * The month whose close is due on `now` (D-10): last month once the IST day
 * has reached the close day, otherwise the month before.
 *   13 Oct 2026 IST, close day 13 → Sep 2026;  12 Oct → Aug 2026.
 */
function dueCloseMonth(now = new Date(), closeDay = 13) {
  const t = istToday(now);
  return addMonths({ month: t.month, year: t.year }, t.day >= closeDay ? -1 : -2);
}

function closeRow(db, payroll, m) {
  return db.prepare('SELECT * FROM loan_closes WHERE payroll = ? AND month = ? AND year = ?').get(payroll, m.month, m.year) || null;
}

/** Is there anything to close for this payroll + month? (an empty ledger → false) */
function isNeeded(db, payroll, m) {
  const prov = db.prepare("SELECT COUNT(*) AS n FROM loan_deductions WHERE payroll = ? AND month = ? AND year = ? AND state = 'provisional'")
    .get(payroll, m.month, m.year).n;
  if (prov > 0) return true;
  const due = db.prepare(`SELECT COUNT(*) AS n FROM loan_instalments i JOIN loans l ON l.id = i.loan_id
                           WHERE l.borrower_type = ? AND l.status IN (${LIVE_SQL})
                             AND i.due_month = ? AND i.due_year = ? AND i.status IN ('scheduled','provisional')`)
    .get(payroll, m.month, m.year).n;
  return due > 0;
}

/** Needed months of a payroll with no close row, up to and including `upTo`, oldest first. */
function neededUnclosedMonths(db, payroll, upTo) {
  const seen = new Map();
  const add = (r) => { const m = { month: r.month, year: r.year }; seen.set(monthIndex(m), m); };
  db.prepare("SELECT DISTINCT month, year FROM loan_deductions WHERE payroll = ? AND state = 'provisional'").all(payroll).forEach(add);
  db.prepare(`SELECT DISTINCT i.due_month AS month, i.due_year AS year FROM loan_instalments i JOIN loans l ON l.id = i.loan_id
               WHERE l.borrower_type = ? AND l.status IN (${LIVE_SQL}) AND i.status IN ('scheduled','provisional')`).all(payroll).forEach(add);
  return [...seen.entries()].sort((a, b) => a[0] - b[0]).map(([, m]) => m)
    .filter((m) => (!upTo || compareMonth(m, upTo) <= 0) && !closeRow(db, payroll, m));
}

/**
 * Payslip ↔ ledger, per employee-month (K8, K19, K28, K29, §5.2 r7):
 *   Σ salary_computations.loan_recovery over ALL rows of the employee-month
 *   = Σ provisional + effective posted loan_deductions of the payroll.
 * Two salary rows (K8) also count as a mismatch.
 * Sales (Loans PR-8): per person = code + company — sales_salary_computations
 * .loan_recovery of that company's row vs the sales deductions of that company.
 */
function checkPayslipLedger(db, { payroll = 'plant', month, year, employeeCode = null, company = null }) {
  if (payroll === 'sales') return checkSalesPayslipLedger(db, { month, year, employeeCode, company });
  if (payroll !== 'plant') return { ok: true, mismatches: [], checked: 0 };
  const byCode = new Map();
  const at = (code) => {
    if (!byCode.has(code)) byCode.set(code, { employeeCode: code, payslipPaise: 0, ledgerPaise: 0, salaryRows: 0 });
    return byCode.get(code);
  };
  const codeSql = employeeCode ? ' AND employee_code = ?' : '';
  const args = employeeCode ? [month, year, String(employeeCode)] : [month, year];
  for (const d of db.prepare(`SELECT * FROM loan_deductions WHERE payroll = 'plant' AND month = ? AND year = ? AND state IN ('provisional','posted')${codeSql}`).all(...args)) {
    at(d.employee_code).ledgerPaise += d.state === 'posted' ? effectivePostedPaise(db, d) : toPaise(d.amount);
  }
  for (const r of db.prepare(`SELECT employee_code FROM salary_computations WHERE month = ? AND year = ? AND COALESCE(loan_recovery, 0) <> 0${codeSql}`).all(...args)) {
    at(r.employee_code);
  }
  const salStmt = db.prepare('SELECT loan_recovery FROM salary_computations WHERE employee_code = ? AND month = ? AND year = ?');
  for (const e of byCode.values()) {
    const rows = salStmt.all(e.employeeCode, month, year);
    e.salaryRows = rows.length;
    e.payslipPaise = rows.reduce((s, r) => s + toPaise(r.loan_recovery || 0), 0);
  }
  const mismatches = [...byCode.values()].filter((e) => e.payslipPaise !== e.ledgerPaise || e.salaryRows > 1)
    .map((e) => ({ employeeCode: e.employeeCode, payslip: toRupees(e.payslipPaise), ledger: toRupees(e.ledgerPaise), salaryRows: e.salaryRows }));
  return { ok: mismatches.length === 0, mismatches, checked: byCode.size };
}

function checkSalesPayslipLedger(db, { month, year, employeeCode = null, company = null }) {
  const by = new Map();
  const at = (code, co) => {
    const k = personKey('sales', code, co);
    if (!by.has(k)) by.set(k, { employeeCode: String(code), company: String(co || '').trim(), payslipPaise: 0, ledgerPaise: 0, salaryRows: 0 });
    return by.get(k);
  };
  let filter = '';
  const args = [month, year];
  if (employeeCode) { filter += ' AND employee_code = ?'; args.push(String(employeeCode)); }
  if (company) { filter += ' AND company = ?'; args.push(String(company).trim()); }
  for (const d of db.prepare(`SELECT * FROM loan_deductions WHERE payroll = 'sales' AND month = ? AND year = ? AND state IN ('provisional','posted')${filter}`).all(...args)) {
    at(d.employee_code, d.company).ledgerPaise += d.state === 'posted' ? effectivePostedPaise(db, d) : toPaise(d.amount);
  }
  for (const r of db.prepare(`SELECT employee_code, company FROM sales_salary_computations WHERE month = ? AND year = ? AND COALESCE(loan_recovery, 0) <> 0${filter}`).all(...args)) {
    at(r.employee_code, r.company);
  }
  const sal = db.prepare('SELECT loan_recovery FROM sales_salary_computations WHERE employee_code = ? AND month = ? AND year = ? AND company = ?');
  for (const e of by.values()) {
    const rows = sal.all(e.employeeCode, month, year, e.company);
    e.salaryRows = rows.length;
    e.payslipPaise = rows.reduce((s, r) => s + toPaise(r.loan_recovery || 0), 0);
  }
  const mismatches = [...by.values()].filter((e) => e.payslipPaise !== e.ledgerPaise)
    .map((e) => ({ employeeCode: e.employeeCode, company: e.company,
      payslip: toRupees(e.payslipPaise), ledger: toRupees(e.ledgerPaise), salaryRows: e.salaryRows }));
  return { ok: mismatches.length === 0, mismatches, checked: by.size };
}

/** Sales readiness (K10, K27): companies with a sales loan due / provisional in m whose active upload is not computed. */
function salesNotComputed(db, m) {
  const companies = new Set([
    ...db.prepare("SELECT DISTINCT company FROM loan_deductions WHERE payroll = 'sales' AND month = ? AND year = ? AND state = 'provisional'").all(m.month, m.year).map((r) => r.company),
    ...db.prepare(`SELECT DISTINCT l.company FROM loan_instalments i JOIN loans l ON l.id = i.loan_id
                    WHERE l.borrower_type = 'sales' AND l.status IN (${LIVE_SQL}) AND i.due_month = ? AND i.due_year = ?
                      AND i.status IN ('scheduled','provisional')`).all(m.month, m.year).map((r) => r.company),
  ].map((c) => String(c || '').trim()));
  const up = db.prepare('SELECT status FROM sales_uploads WHERE month = ? AND year = ? AND company = ? AND is_active = 1 LIMIT 1');
  return [...companies].sort().filter((c) => { const u = up.get(m.month, m.year, c); return !u || u.status !== 'computed'; });
}

/** Whole-payroll readiness of one month (§3.3 of the PR-6 plan). Never writes. */
function closeReadiness(db, { payroll = 'plant', month, year, now = new Date() }) {
  const m = { month: Number(month), year: Number(year) };
  if (!PAYROLLS.includes(payroll)) return fail('PAYROLL_INVALID', 'payroll must be plant or sales');
  if (!isValidMonth(m)) return fail('MONTH_INVALID', 'month/year invalid');
  if (!loansReady(db)) return fail('NOT_MIGRATED', 'loan tables not migrated');
  const done = closeRow(db, payroll, m);
  if (done) return fail('ALREADY_CLOSED', `${payroll} ${label(m)} was closed on ${done.run_at} UTC by ${done.run_by}`, { close: done });
  const t = istToday(now);
  if (compareMonth(m, { month: t.month, year: t.year }) >= 0) return fail('MONTH_NOT_ENDED', `${label(m)} has not ended yet (IST)`);
  if (!isNeeded(db, payroll, m)) return fail('NOT_NEEDED', `${payroll} ${label(m)}: nothing to close`);
  const earlier = neededUnclosedMonths(db, payroll, addMonths(m, -1));
  if (earlier.length) return fail('EARLIER_MONTH_OPEN', `${payroll} ${earlier.map(label).join(', ')} must be closed first`, { earlier });
  if (payroll === 'sales') {
    const missing = salesNotComputed(db, m);
    if (missing.length) {
      return fail('STAGE7_NOT_COMPUTED', `sales payroll for ${label(m)} is not computed yet for ${missing.join(', ')} (needs the active upload computed)`, { companies: missing });
    }
    return { ok: true, warnings: exitFinalPayrollWarnings(db, payroll, m) };
  }
  const salaryRows = db.prepare('SELECT COUNT(*) AS n FROM salary_computations WHERE month = ? AND year = ?').get(m.month, m.year).n;
  const mi = db.prepare('SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN stage_7_done = 1 THEN 1 ELSE 0 END), 0) AS done FROM monthly_imports WHERE month = ? AND year = ?').get(m.month, m.year);
  if (salaryRows === 0 || (mi.total > 0 && mi.done < mi.total)) {
    return fail('STAGE7_NOT_COMPUTED', `plant Stage 7 for ${label(m)} is not computed yet (${salaryRows} salary rows; Stage 7 stamped on ${mi.done} of ${mi.total} imports)`);
  }
  // Borrowers whose Stage 6 changed after Stage 7: a warning only (the paid payslip and the ledger still agree).
  const warnings = db.prepare(`SELECT DISTINCT dc.employee_code FROM day_calculations dc
                                JOIN loans l ON l.employee_code = dc.employee_code AND l.borrower_type = 'plant' AND l.status IN (${LIVE_SQL})
                               WHERE dc.month = ? AND dc.year = ? AND dc.salary_stale = 1`).all(m.month, m.year)
    .map((r) => ({ code: 'SALARY_STALE', employeeCode: r.employee_code, message: `${r.employee_code}: Stage 6 changed after Stage 7 for ${label(m)}` }));
  // Loans PR-7: an exit loan's final payroll that will not cover the outstanding (non-blocking).
  warnings.push(...exitFinalPayrollWarnings(db, payroll, m));
  return { ok: true, warnings };
}

function provisionalRows(db, payroll, m) {
  return db.prepare("SELECT * FROM loan_deductions WHERE payroll = ? AND month = ? AND year = ? AND state = 'provisional' ORDER BY loan_id")
    .all(payroll, m.month, m.year);
}

/** Is the employee-month's salary held? Plant: salary_held. Sales (K10): the company row on status 'hold'. */
function salaryHeld(db, payroll, code, company, m) {
  if (payroll === 'sales') {
    const rows = db.prepare('SELECT status FROM sales_salary_computations WHERE employee_code = ? AND month = ? AND year = ? AND company = ?')
      .all(code, m.month, m.year, String(company || '').trim());
    return { exists: rows.length > 0, held: rows.some((r) => r.status === 'hold') };
  }
  const rows = db.prepare('SELECT salary_held FROM salary_computations WHERE employee_code = ? AND month = ? AND year = ?').all(code, m.month, m.year);
  return { exists: rows.length > 0, held: rows.some((r) => r.salary_held === 1) };
}

function scheduledDue(db, payroll, m) {
  return db.prepare(`SELECT i.*, l.employee_code, l.company AS loan_company FROM loan_instalments i JOIN loans l ON l.id = i.loan_id
                      WHERE l.borrower_type = ? AND l.status IN (${LIVE_SQL})
                        AND i.due_month = ? AND i.due_year = ? AND i.status = 'scheduled' ORDER BY i.loan_id, i.sequence`)
    .all(payroll, m.month, m.year);
}

/** Read-only: what a close of this month would do now (the close screen, PR-6b). */
function previewClose(db, { payroll = 'plant', month, year, now = new Date() }) {
  const m = { month: Number(month), year: Number(year) };
  const readiness = closeReadiness(db, { payroll, month, year, now });
  if (['PAYROLL_INVALID', 'MONTH_INVALID', 'NOT_MIGRATED'].includes(readiness.code)) return readiness;
  const rows = provisionalRows(db, payroll, m);
  const check = checkPayslipLedger(db, { payroll, month: m.month, year: m.year });
  const bad = new Set(check.mismatches.map((x) => personKey(payroll, x.employeeCode, x.company)));
  const out = {
    ok: true, payroll, month: m.month, year: m.year, readiness,
    close: closeRow(db, payroll, m),
    provisional: { count: rows.length, amount: toRupees(rows.reduce((s, r) => s + toPaise(r.amount), 0)) },
    wouldPost: { count: 0, amount: 0 }, held: 0, shortfalls: 0, mismatches: check.mismatches,
    noSalary: 0,
    exitFinalMonth: { loans: exitLoansForMonth(db, payroll, m).length, short: (readiness.warnings || []).filter((w) => w.code === 'EXIT_FINAL_PAYROLL_SHORT') },
  };
  let postPaise = 0;
  for (const r of rows) {
    if (bad.has(personKey(payroll, r.employee_code, r.company))) continue;
    const s = salaryHeld(db, payroll, r.employee_code, r.company, m);
    if (s.held) { out.held += 1; continue; }
    const ins = db.prepare('SELECT amount_due FROM loan_instalments WHERE id = ?').get(r.instalment_id);
    if (ins && toPaise(r.amount) < toPaise(ins.amount_due)) out.shortfalls += 1;
    if (toPaise(r.amount) > 0) { out.wouldPost.count += 1; postPaise += toPaise(r.amount); }
  }
  out.wouldPost.amount = toRupees(postPaise);
  out.noSalary = scheduledDue(db, payroll, m).filter((i) => !bad.has(personKey(payroll, i.employee_code, i.loan_company))).length;
  return out;
}

class CloseAbort extends Error {
  constructor(code, message, extra = {}) { super(message); this.code = code; this.extra = extra; }
}

/**
 * The loan close of one payroll + month. One transaction.
 * @returns {{ok, closeId, posted, ...} | {ok:false, code, message}}
 */
function runLoanClose(db, { payroll = 'plant', month, year, trigger = 'auto', actor = SYSTEM, now = new Date() } = {}) {
  const gate = checkActor('close', actor);
  if (!gate.ok) return gate;
  const ready = closeReadiness(db, { payroll, month, year, now });
  if (!ready.ok) return ready;
  const m = { month: Number(month), year: Number(year) };

  const loanIds = new Set(db.prepare(`SELECT id FROM loans WHERE borrower_type = ? AND status IN (${LIVE_SQL})`).all(payroll).map((r) => r.id));
  for (const r of provisionalRows(db, payroll, m)) loanIds.add(r.loan_id);
  const before = new Map([...loanIds].map((id) => [id, reconcileLoan(db, id).ok]));
  const exitLoanIds = exitLoansForMonth(db, payroll, m).map((l) => l.id);   // Loans PR-7: final payroll = this month

  let out;
  try {
    db.transaction(() => {
      let closeId;
      try {
        closeId = db.prepare('INSERT INTO loan_closes (month, year, payroll, run_at, run_by, trigger_kind) VALUES (?, ?, ?, ?, ?, ?)')
          .run(m.month, m.year, payroll, sqlUtc(now), gate.actor.username, trigger).lastInsertRowid;
      } catch (e) {
        if (/UNIQUE/.test(e.message)) throw new CloseAbort('ALREADY_CLOSED', `${payroll} ${label(m)} is already closed`);
        throw e;
      }
      const check = checkPayslipLedger(db, { payroll, month: m.month, year: m.year });
      const bad = new Set(check.mismatches.map((x) => personKey(payroll, x.employeeCode, x.company)));
      const c = { posted: 0, postedPaise: 0, deferred: 0, held: 0, noSalary: 0, shortfall: 0, exitResidual: 0, exitResidualPaise: 0, exitHeld: 0, exitHeldPaise: 0 };
      const notes = { mismatches: check.mismatches, held: [], refusals: [], noSalary: [], warnings: ready.warnings, leftScheduled: [] };
      const alerts = [];

      for (const row of provisionalRows(db, payroll, m)) {
        if (bad.has(personKey(payroll, row.employee_code, row.company))) continue;
        const s = salaryHeld(db, payroll, row.employee_code, row.company, m);
        if (s.held) {
          c.held += 1;
          notes.held.push({ loanId: row.loan_id, employeeCode: row.employee_code, amount: row.amount });
          continue;
        }
        const r = postDeduction(db, { deductionId: row.id, closeId }, gate.actor);
        if (!r.ok) { notes.refusals.push({ deductionId: row.id, loanId: row.loan_id, code: r.code, message: r.message }); continue; }
        if (toPaise(r.posted) > 0) { c.posted += 1; c.postedPaise += toPaise(r.posted); } else c.deferred += 1;
        if (toPaise(r.shortfall) > 0) c.shortfall += 1;
        alerts.push(...(r.alerts || []));
      }

      for (const ins of scheduledDue(db, payroll, m)) {
        if (bad.has(personKey(payroll, ins.employee_code, ins.loan_company))) { notes.leftScheduled.push({ instalmentId: ins.id, loanId: ins.loan_id, employeeCode: ins.employee_code }); continue; }
        const s = salaryHeld(db, payroll, ins.employee_code, ins.loan_company, m);
        const note = s.exists ? 'salary row exists but carried no deduction for this loan' : 'no salary row this month';
        const r = moveInstalmentToEnd(db, { instalmentId: ins.id, reason: 'no_salary', note: `${label(m)} close: ${note}` }, gate.actor);
        if (!r.ok) { notes.refusals.push({ instalmentId: ins.id, loanId: ins.loan_id, code: r.code, message: r.message }); continue; }
        c.noSalary += 1; c.deferred += 1;
        notes.noSalary.push({ loanId: ins.loan_id, employeeCode: ins.employee_code, amount: ins.amount_due, note });
        alerts.push(...(r.alerts || []));
      }

      // Loans PR-7: exit loans whose final payroll is this month — what is left after it.
      notes.exitResiduals = [];
      for (const id of exitLoanIds) {
        const l = db.prepare('SELECT * FROM loans WHERE id = ?').get(id);
        const residual = l.status === 'recover_at_exit' ? exitResidualPaise(db, id) : 0;
        const held = l.status === 'recover_at_exit' ? heldPendingPaise(db, id) : 0;
        if (residual === 0 && held === 0) continue;
        notes.exitResiduals.push({ loanId: id, employeeCode: l.employee_code, residual: toRupees(residual), heldPending: toRupees(held) });
        c.exitResidual += residual > 0 ? 1 : 0; c.exitResidualPaise += residual;
        if (held > 0) {
          c.exitHeld += 1; c.exitHeldPaise += held;
          // Held final salary (ruling Q-B): it waits the D-14 days like any held EMI, then the rest becomes residual.
          alerts.push({
            type: 'loan_exit_final_held', audience: 'finance', loanId: id, employeeCode: l.employee_code, heldPending: toRupees(held), residual: toRupees(residual),
            message: `Loan ${id} (${l.employee_code}): the final payroll ${label(m)} salary is held — ₹${toRupees(held)} waits for the hold to be released (posted by the daily sweep; after ${readLoanPolicy(db).heldEmiWaitDays} days it becomes exit residual)${residual > 0 ? `; exit residual so far ₹${toRupees(residual)}` : ''}.`,
          });
        }
      }

      const after = [...loanIds].map((id) => reconcileLoan(db, id));
      const broken = after.filter((r) => !r.ok && before.get(r.loanId));
      if (broken.length) {
        throw new CloseAbort('RECONCILIATION_BROKEN', `the ${payroll} ${label(m)} close would break reconciliation of loan(s) ${broken.map((r) => r.loanId).join(', ')}; rolled back`,
          { problems: broken.map((r) => ({ loanId: r.loanId, problems: r.problems })) });
      }
      const reconOk = after.every((r) => r.ok);
      if (!reconOk) notes.reconciliation = after.filter((r) => !r.ok).map((r) => ({ loanId: r.loanId, problems: r.problems }));
      db.prepare(`UPDATE loan_closes SET posted_count = ?, posted_amount = ?, deferred_count = ?, held_count = ?, no_salary_count = ?,
                         shortfall_count = ?, reconciliation_ok = ?, notes = ? WHERE id = ?`)
        .run(c.posted, toRupees(c.postedPaise), c.deferred, c.held, c.noSalary, c.shortfall, reconOk ? 1 : 0, JSON.stringify(notes), closeId);
      out = {
        ok: true, closeId, payroll, month: m.month, year: m.year, trigger,
        posted: c.posted, postedAmount: toRupees(c.postedPaise), deferred: c.deferred, held: c.held, noSalary: c.noSalary,
        shortfall: c.shortfall, reconciliationOk: reconOk, mismatches: check.mismatches, refusals: notes.refusals, alerts,
        exitResiduals: notes.exitResiduals,
        exitSummary: { residual: c.exitResidual, residualAmount: toRupees(c.exitResidualPaise), heldFinal: c.exitHeld, heldFinalAmount: toRupees(c.exitHeldPaise) },
      };
    })();
  } catch (e) {
    if (!(e instanceof CloseAbort)) throw e;
    if (e.code === 'RECONCILIATION_BROKEN') {
      console.error(`[loans-close] ${e.message}`);
      for (const role of ['admin', 'finance']) notify(db, role, 'LOAN_CLOSE_FAILED', `Loan close ${payroll} ${label(m)} rolled back: ${e.message}`);
    }
    return fail(e.code, e.message, e.extra);
  }

  // After the commit: finance summary + every engine alert.
  notify(db, 'finance', 'LOAN_CLOSE_DONE',
    `Loan close ${payroll} ${label(m)}: posted ${out.posted} (${rs(toPaise(out.postedAmount))}), held ${out.held}, shortfall ${out.shortfall}, no salary ${out.noSalary}`
    + `${out.exitSummary.residual ? `, exit residual ${out.exitSummary.residual} (${rs(toPaise(out.exitSummary.residualAmount))})` : ''}`
    + `${out.exitSummary.heldFinal ? `, held final salary ${out.exitSummary.heldFinal} (${rs(toPaise(out.exitSummary.heldFinalAmount))} pending release)` : ''}`
    + `${out.mismatches.length ? `, ${out.mismatches.length} payslip/ledger mismatch(es) left for review` : ''}${out.reconciliationOk ? '' : ' — RECONCILIATION MISMATCH (pre-existing)'}`);
  for (const x of out.mismatches) {
    notify(db, 'finance', 'LOAN_PAYSLIP_LEDGER_MISMATCH', `${x.employeeCode}${x.company ? ` (${x.company})` : ''} ${payroll} ${label(m)}: payslip loan ₹${x.payslip} ≠ ledger ₹${x.ledger}${x.salaryRows > 1 ? ` (${x.salaryRows} salary rows)` : ''}; left provisional — re-run Stage 7 for this employee`);
  }
  notifyAlerts(db, out.alerts);
  console.log(`[loans-close] ${payroll} ${label(m)} closed (#${out.closeId}, ${trigger}): posted ${out.posted}, held ${out.held}, shortfall ${out.shortfall}, no salary ${out.noSalary}, mismatches ${out.mismatches.length}`);
  return out;
}

/**
 * Daily: provisional rows (and scheduled instalments) left in an already-closed
 * month. Each row in its own savepoint; one failure never stops the sweep.
 */
function runHeldSweep(db, { now = new Date(), actor = SYSTEM } = {}) {
  const gate = checkActor('close', actor);
  if (!gate.ok) return gate;
  if (!loansReady(db)) return { ok: true, skipped: true, posted: 0, moved: 0, waiting: 0, mismatched: 0, errors: [] };
  const waitDays = readLoanPolicy(db).heldEmiWaitDays;
  const res = { ok: true, posted: 0, postedAmount: 0, moved: 0, movedRows: [], waiting: 0, mismatched: 0, noSalaryMoved: 0, errors: [], alerts: [] };
  const mismatchSeen = new Set();
  // Both payrolls (Loans PR-8). A sales person is code + company.
  const consistent = (payroll, code, company, m) => {
    const c = checkPayslipLedger(db, { payroll, month: m.month, year: m.year, employeeCode: code, company: payroll === 'sales' ? company : null });
    const seenKey = `${payroll}|${personKey(payroll, code, company)}|${monthIndex(m)}`;
    if (!c.ok && !mismatchSeen.has(seenKey)) {
      mismatchSeen.add(seenKey);
      res.mismatched += 1;
      const x = c.mismatches[0];
      notify(db, 'finance', 'LOAN_PAYSLIP_LEDGER_MISMATCH', `${code}${payroll === 'sales' ? ` (${company})` : ''} ${payroll} ${label(m)}: payslip loan ₹${x.payslip} ≠ ledger ₹${x.ledger}; left provisional — re-run Stage 7 for this employee`);
    }
    return c.ok;
  };

  const rows = db.prepare(`SELECT ld.*, c.id AS close_id, c.run_at AS close_run_at FROM loan_deductions ld
                             JOIN loan_closes c ON c.payroll = ld.payroll AND c.month = ld.month AND c.year = ld.year
                            WHERE ld.state = 'provisional' ORDER BY ld.payroll, ld.year, ld.month, ld.loan_id`).all();
  for (const row of rows) {
    const m = { month: row.month, year: row.year };
    try {
      db.transaction(() => {
        if (!consistent(row.payroll, row.employee_code, row.company, m)) return;
        const s = salaryHeld(db, row.payroll, row.employee_code, row.company, m);
        if (!s.held) {
          const r = postDeduction(db, { deductionId: row.id, closeId: row.close_id }, gate.actor);
          if (!r.ok) { res.errors.push({ deductionId: row.id, code: r.code, message: r.message }); return; }
          res.posted += 1; res.postedAmount += toPaise(r.posted);
          res.alerts.push(...(r.alerts || []));
          return;
        }
        const closedAt = new Date(`${String(row.close_run_at).replace(' ', 'T')}Z`);
        const days = Math.floor((now.getTime() - closedAt.getTime()) / 86400000);
        if (days < waitDays) { res.waiting += 1; return; }
        const r = moveInstalmentToEnd(db, {
          instalmentId: row.instalment_id, reason: 'held', note: `salary still held ${days} days after the ${label(m)} loan close`,
        }, gate.actor);
        if (!r.ok) { res.errors.push({ deductionId: row.id, code: r.code, message: r.message }); return; }
        res.moved += 1;
        res.movedRows.push({ loanId: row.loan_id, employeeCode: row.employee_code, month: m.month, year: m.year, amount: row.amount, days });
        res.alerts.push(...(r.alerts || []));
      })();
    } catch (e) {
      res.errors.push({ deductionId: row.id, code: 'SWEEP_ERROR', message: e.message });
      console.error(`[loans-sweep] deduction ${row.id} failed: ${e.message}`);
    }
  }

  // Scheduled instalments still due in a closed month (left at the close because the
  // employee's payslip disagreed with the ledger): moved once the employee is clean.
  const left = db.prepare(`SELECT i.*, l.employee_code, l.company AS loan_company, l.borrower_type FROM loan_instalments i JOIN loans l ON l.id = i.loan_id
                             JOIN loan_closes c ON c.payroll = l.borrower_type AND c.month = i.due_month AND c.year = i.due_year
                            WHERE l.status IN (${LIVE_SQL}) AND i.status = 'scheduled'
                            ORDER BY l.borrower_type, i.due_year, i.due_month, i.loan_id`).all();
  for (const ins of left) {
    const m = { month: ins.due_month, year: ins.due_year };
    try {
      db.transaction(() => {
        if (!consistent(ins.borrower_type, ins.employee_code, ins.loan_company, m)) return;
        const r = moveInstalmentToEnd(db, { instalmentId: ins.id, reason: 'no_salary', note: `after the ${label(m)} close: no deduction for this loan` }, gate.actor);
        if (!r.ok) { res.errors.push({ instalmentId: ins.id, code: r.code, message: r.message }); return; }
        res.noSalaryMoved += 1;
        res.alerts.push(...(r.alerts || []));
      })();
    } catch (e) {
      res.errors.push({ instalmentId: ins.id, code: 'SWEEP_ERROR', message: e.message });
    }
  }

  for (const x of res.movedRows) {
    notify(db, 'finance', 'LOAN_HELD_MOVED_TO_END',
      `Loan ${x.loanId} (${x.employeeCode}) ${x.month}/${x.year}: salary still held ${x.days} days after the loan close — ₹${x.amount} moved to the end. `
      + 'The salary row still shows it; release is refused until Stage 7 is re-run for this employee.');
  }
  notifyAlerts(db, res.alerts);
  res.postedAmount = toRupees(res.postedAmount);
  if (res.posted || res.moved || res.noSalaryMoved || res.errors.length) {
    console.log(`[loans-sweep] posted ${res.posted}, moved ${res.moved}, no-salary moved ${res.noSalaryMoved}, waiting ${res.waiting}, mismatched ${res.mismatched}, errors ${res.errors.length}`);
  }
  return res;
}

/** Closes every needed month up to the due month, oldest first, per payroll. */
function runCatchUp(db, { now = new Date(), trigger = 'auto', actor = SYSTEM } = {}) {
  if (!loansReady(db)) return { ok: true, skipped: true, results: [] };
  const due = dueCloseMonth(now, readLoanPolicy(db).closeDay);
  const results = [];
  for (const payroll of PAYROLLS) {
    const months = neededUnclosedMonths(db, payroll, due);
    if (!months.length) {
      console.log(`[loans-close] ${payroll} up to ${label(due)}: nothing to close`);
      continue;
    }
    for (const m of months) {
      const r = runLoanClose(db, { payroll, month: m.month, year: m.year, trigger, actor, now });
      results.push({ payroll, month: m.month, year: m.year, ok: r.ok, code: r.code || null, message: r.message || null, closeId: r.closeId || null });
      if (r.ok) continue;
      if (WAITING_CODES.has(r.code)) {
        console.log(`[loans-close] ${payroll} ${label(m)} waits: ${r.message}`);
        notify(db, 'finance', 'LOAN_CLOSE_WAITING', `Loan close ${payroll} ${label(m)} is waiting: ${r.message}`);
      } else {
        console.error(`[loans-close] ${payroll} ${label(m)} not closed: ${r.code} ${r.message}`);
      }
      break;
    }
  }
  return { ok: true, due, results };
}

/** The daily job: sweep first, then the catch-up close. Never throws. */
function runDailyLoanJobs(db, { now = new Date(), trigger = 'auto' } = {}) {
  const out = { sweep: null, close: null, errors: [] };
  try { out.sweep = runHeldSweep(db, { now }); } catch (e) { out.errors.push(`sweep: ${e.message}`); console.error('[loans-sweep] failed:', e.message); }
  try { out.close = runCatchUp(db, { now, trigger }); } catch (e) { out.errors.push(`close: ${e.message}`); console.error('[loans-close] failed:', e.message); }
  return out;
}

/**
 * Admin reversal of a posted deduction (§5.2 r12, ruling Q2): an opposite entry
 * for what still stands; the amount returns to the schedule as a new last
 * instalment. The month's next Stage 7 re-run deducts the remaining effective
 * posted amount (₹0 after a full reversal). Live loans only.
 */
function reverseDeduction(db, { deductionId, reason }, actor) {
  const gate = checkActor('reverse_posted', actor);
  if (!gate.ok) return gate;
  const why = text(reason);
  if (why.length < 10) return fail('REASON_TOO_SHORT', 'give a reason of at least 10 characters');
  const row = db.prepare('SELECT * FROM loan_deductions WHERE id = ?').get(deductionId);
  if (!row) return fail('DEDUCTION_NOT_FOUND', `deduction ${deductionId} not found`);
  if (row.state !== 'posted') return fail('DEDUCTION_NOT_POSTED', `deduction is ${row.state}; only a posted deduction can be reversed`);
  const eff = effectivePostedPaise(db, row);
  if (eff <= 0) return fail('NOTHING_TO_REVERSE', 'this posted deduction has already been reversed in full');
  const r = writeAdjustment(db, { deductionId: row.id, kind: 'reversal', amountPaise: eff, reason: why }, gate.actor);
  if (!r.ok) return r;
  notify(db, 'finance', 'LOAN_DEDUCTION_REVERSED',
    `Loan ${row.loan_id} (${row.employee_code}) ${row.payroll} ${row.month}/${row.year}: posted ₹${toRupees(eff)} reversed by ${gate.actor.username} — re-run Stage 7 for this employee and month`);
  notifyAlerts(db, r.alerts);
  return { ...r, deductionId: row.id, loanId: row.loan_id, employeeCode: row.employee_code, month: row.month, year: row.year };
}

/**
 * Hold-release guard (K28, coordinator change 10 Oct 2026): refuses while this
 * held employee-month has a provisional row reversed by the "held past the wait"
 * move (the loan-side stale marker) AND its salary row still disagrees with the
 * ledger. A Stage 7 re-run of the employee makes them agree and lifts it.
 * With no loan rows this is a no-op. Never throws (fails open, logged).
 */
function loanHoldReleaseCheck(db, employeeCode, month, year, { payroll = 'plant', company = null } = {}) {
  try {
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'loan_deductions'").get()) return { ok: true };
    const m = Number.parseInt(month, 10);
    const y = Number.parseInt(year, 10);
    // Loans PR-8: a sales hold (status 'hold') is guarded the same way, per code + company.
    const sales = payroll === 'sales';
    const marked = db.prepare(`SELECT COUNT(*) AS n FROM loan_deductions WHERE employee_code = ? AND month = ? AND year = ?
                                 AND payroll = ? AND state = 'reversed' AND reversal_reason = ?${sales ? ' AND company = ?' : ''}`)
      .get(String(employeeCode), m, y, sales ? 'sales' : 'plant', HELD_MOVE_REVERSAL_REASON, ...(sales ? [String(company || '').trim()] : [])).n;
    if (!marked) return { ok: true };
    const c = checkPayslipLedger(db, { payroll: sales ? 'sales' : 'plant', month: m, year: y, employeeCode: String(employeeCode), company: sales ? company : null });
    if (c.ok) return { ok: true };
    const x = c.mismatches[0];
    return {
      ok: false, code: 'LOAN_ROW_STALE',
      message: `This salary still shows a loan deduction of ₹${x.payslip} whose instalment moved to the end of the schedule (held past the wait); `
        + `the loan ledger now holds ₹${x.ledger}. Re-run Stage 7 for ${employeeCode} ${m}/${y} before releasing the hold.`,
    };
  } catch (e) {
    console.error('[loans] hold-release check failed (release allowed):', e.message);
    return { ok: true };
  }
}

/**
 * Sales (Loans PR-8, K31): effective posted loan deductions (paise) of one sales
 * salary row — code + month + company. > 0 means the row may not move to Hold.
 * 0 before the loan tables exist.
 */
function salesPostedLoanPaise(db, { employeeCode, month, year, company }) {
  if (!loansReady(db)) return 0;
  return db.prepare(`SELECT * FROM loan_deductions WHERE payroll = 'sales' AND state = 'posted'
                       AND employee_code = ? AND month = ? AND year = ? AND company = ?`)
    .all(String(employeeCode), Number(month), Number(year), String(company || '').trim())
    .reduce((s, d) => s + effectivePostedPaise(db, d), 0);
}

/** Sales register (Loans PR-8): codes of a company-month whose row carries a posted loan deduction. */
function salesLoanPostedCodes(db, { month, year, company }) {
  if (!loansReady(db)) return new Set();
  const out = new Set();
  for (const d of db.prepare(`SELECT * FROM loan_deductions WHERE payroll = 'sales' AND state = 'posted' AND month = ? AND year = ? AND company = ?`)
    .all(Number(month), Number(year), String(company || '').trim())) {
    if (effectivePostedPaise(db, d) > 0) out.add(d.employee_code);
  }
  return out;
}

module.exports = {
  salesPostedLoanPaise, salesLoanPostedCodes,
  dueCloseMonth, istToday, isNeeded, neededUnclosedMonths, checkPayslipLedger, closeReadiness, previewClose,
  runLoanClose, runHeldSweep, runCatchUp, runDailyLoanJobs, reverseDeduction, loanHoldReleaseCheck,
  CLOSE_ACTOR: SYSTEM,
};
