/**
 * Loans engine — reconciliation, statement, TDS list (Loans PR-2,
 * docs/loans/SPEC.md §5.2 r13, K34, K35, D-7). Read-only.
 *
 *   disbursed − posted − receipts − written off = balance      (to the paisa)
 *   open instalments (scheduled + provisional) + uncovered = balance, uncovered ≥ 0
 *   Σ posted loan_deductions = Σ posted instalment amounts
 */
const { toPaise, toRupees } = require('./money');
const { monthIndex, fromIndex, dateToMonth, monthLabel } = require('./months');
const { getLoan, getInstalments, openPaise } = require('./common');

function sumPaise(rows, field) {
  return rows.reduce((s, r) => s + toPaise(r[field] || 0), 0);
}

function reconcileLoan(db, loanId) {
  const loan = getLoan(db, loanId);
  if (!loan) return { ok: false, code: 'LOAN_NOT_FOUND', loanId };
  const instalments = getInstalments(db, loanId);
  const disbursed = toPaise(loan.disbursed_amount || 0);
  const posted = sumPaise(instalments.filter((i) => i.status === 'posted' || i.status === 'deferred'), 'posted_amount');
  const receipts = sumPaise(db.prepare('SELECT amount FROM loan_receipts WHERE loan_id = ?').all(loanId), 'amount');
  const writtenOff = toPaise(loan.written_off_amount || 0);
  const balance = toPaise(loan.remaining_balance || 0);
  const expected = disbursed - posted - receipts - writtenOff;
  const open = openPaise(instalments);
  const uncovered = balance - open;
  const deductionsPosted = sumPaise(db.prepare("SELECT amount FROM loan_deductions WHERE loan_id = ? AND state = 'posted'").all(loanId), 'amount');
  const problems = [];
  if (expected !== balance) problems.push(`balance ₹${toRupees(balance)} ≠ disbursed − posted − receipts − written off = ₹${toRupees(expected)}`);
  if (uncovered < 0) problems.push(`open instalments ₹${toRupees(open)} exceed the balance ₹${toRupees(balance)}`);
  if (deductionsPosted !== posted) problems.push(`posted deductions ₹${toRupees(deductionsPosted)} ≠ posted instalments ₹${toRupees(posted)}`);
  if (balance === 0 && ['active', 'recover_at_exit'].includes(loan.status)) problems.push(`balance is ₹0 but the loan is still ${loan.status}`);
  return {
    ok: problems.length === 0, loanId, status: loan.status,
    disbursed: toRupees(disbursed), posted: toRupees(posted), receipts: toRupees(receipts), writtenOff: toRupees(writtenOff),
    expectedBalance: toRupees(expected), balance: toRupees(balance),
    openInstalments: toRupees(open), uncovered: toRupees(Math.max(0, uncovered)),
    problems,
  };
}

/** Every disbursed loan; returns the ones that do not reconcile. */
function reconcileAll(db) {
  const ids = db.prepare('SELECT id FROM loans WHERE disbursed_amount IS NOT NULL ORDER BY id').all().map((r) => r.id);
  const results = ids.map((id) => reconcileLoan(db, id));
  return { ok: results.every((r) => r.ok), checked: results.length, mismatches: results.filter((r) => !r.ok) };
}

/** IST date of a UTC 'YYYY-MM-DD HH:MM:SS' timestamp. */
function istDate(ts) {
  if (!ts) return null;
  const d = new Date(`${String(ts).replace(' ', 'T')}Z`);
  if (Number.isNaN(d.getTime())) return String(ts).slice(0, 10);
  return new Date(d.getTime() + 330 * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * Month-by-month statement: opening, disbursed, recovered (posted deductions,
 * by payroll month), cash (receipts, by receipt date), written off, closing.
 * The last closing equals reconcileLoan().expectedBalance.
 */
function loanStatement(db, loanId) {
  const loan = getLoan(db, loanId);
  if (!loan) return { ok: false, code: 'LOAN_NOT_FOUND' };
  const moves = new Map(); // monthIndex → {disbursed, recovered, cash, writtenOff}
  const bucket = (m) => {
    const k = monthIndex(m);
    if (!moves.has(k)) moves.set(k, { disbursed: 0, recovered: 0, cash: 0, writtenOff: 0 });
    return moves.get(k);
  };
  if (loan.disbursed_on) bucket(dateToMonth(loan.disbursed_on)).disbursed += toPaise(loan.principal_amount);
  // Top-ups: dated by the disbursement date the engine writes into the event
  // as [disbursed_on=YYYY-MM-DD] (loan_events has no date column of its own).
  const topups = db.prepare("SELECT amount, reason, created_at FROM loan_events WHERE loan_id = ? AND event = 'topup_disbursed'").all(loanId);
  for (const t of topups) {
    const on = /\[disbursed_on=(\d{4}-\d{2}-\d{2})\]/.exec(t.reason || '');
    bucket(dateToMonth(on ? on[1] : istDate(t.created_at))).disbursed += toPaise(t.amount);
  }
  for (const i of getInstalments(db, loanId).filter((x) => (x.status === 'posted' || x.status === 'deferred') && toPaise(x.posted_amount || 0) > 0)) {
    bucket({ month: i.due_month, year: i.due_year }).recovered += toPaise(i.posted_amount);
  }
  for (const r of db.prepare('SELECT amount, receipt_date FROM loan_receipts WHERE loan_id = ?').all(loanId)) {
    bucket(dateToMonth(r.receipt_date)).cash += toPaise(r.amount);
  }
  if (toPaise(loan.written_off_amount || 0) > 0) bucket(dateToMonth(istDate(loan.written_off_at))).writtenOff += toPaise(loan.written_off_amount);

  const keys = [...moves.keys()].sort((a, b) => a - b);
  const rows = [];
  let bal = 0;
  if (keys.length) {
    for (let k = keys[0]; k <= keys[keys.length - 1]; k++) {
      const m = moves.get(k) || { disbursed: 0, recovered: 0, cash: 0, writtenOff: 0 };
      const opening = bal;
      bal = opening + m.disbursed - m.recovered - m.cash - m.writtenOff;
      rows.push({
        month: monthLabel(fromIndex(k)), opening: toRupees(opening), disbursed: toRupees(m.disbursed),
        recovered: toRupees(m.recovered), cash: toRupees(m.cash), writtenOff: toRupees(m.writtenOff), closing: toRupees(bal),
      });
    }
  }
  return { ok: true, loanId, employeeCode: loan.employee_code, company: loan.company, status: loan.status, rows, closing: toRupees(bal) };
}

/** Write-offs in a month (IST), for TDS in the final month (D-7, K35; Q4 pending CA). */
function writeOffsForTds(db, { month, year }) {
  return db.prepare(`
    SELECT id AS loanId, borrower_type AS borrowerType, employee_code AS employeeCode, company, loan_type AS loanType,
           written_off_amount AS amount, status, written_off_at AS writtenOffAt, written_off_by AS writtenOffBy, write_off_reason AS reason
      FROM loans
     WHERE written_off_amount > 0
       AND CAST(strftime('%m', datetime(written_off_at, '+330 minutes')) AS INTEGER) = ?
       AND CAST(strftime('%Y', datetime(written_off_at, '+330 minutes')) AS INTEGER) = ?
     ORDER BY company, employee_code
  `).all(month, year);
}

module.exports = { reconcileLoan, reconcileAll, loanStatement, writeOffsForTds };
