/**
 * Loans engine — numbered cash receipts (Loans PR-2, docs/loans/SPEC.md §5.2 r9,
 * D-7, K35; fixes D3; coordinator rulings 7 and 8).
 *
 * Finance (or admin) records a receipt. It reduces the balance and clears the
 * schedule FROM THE END: first any "uncovered" amount (left over when the
 * extension limit was reached), then scheduled instalments from the last one
 * backwards — a fully covered instalment becomes paid_in_cash, the last
 * partially covered one has its amount_due reduced.
 *
 * Provisional instalments (already in this month's Stage 7) are not touched
 * unless the caller passes allowProvisional; then their deduction is reversed
 * and returned in staleDeductions, so the salary row can be re-run.
 *
 * Receipt numbers: LR/<Indian FY>/<5-digit serial>, e.g. LR/2026-27/00001.
 */
const { parseAmount, toPaise, toRupees } = require('./money');
const { parseDate, todayIst, compareMonth } = require('./months');
const { checkActor, LIVE_LOAN_STATES } = require('./states');
const { writeEvent } = require('./events');
const { fail, text, getLoan, getInstalments, inTxn, openPaise, moveBalance, autoComplete } = require('./common');

function financialYear(dateStr) {
  const d = parseDate(dateStr);
  const start = d.month >= 4 ? d.year : d.year - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

function nextReceiptNo(db, dateStr) {
  const prefix = `LR/${financialYear(dateStr)}/`;
  const rows = db.prepare('SELECT receipt_no FROM loan_receipts WHERE receipt_no LIKE ?').all(`${prefix}%`);
  const max = rows.reduce((m, r) => Math.max(m, Number(r.receipt_no.slice(prefix.length)) || 0), 0);
  return `${prefix}${String(max + 1).padStart(5, '0')}`;
}

/** Latest-due first; ties by sequence. */
const fromTheEnd = (a, b) => compareMonth({ month: b.due_month, year: b.due_year }, { month: a.due_month, year: a.due_year }) || b.sequence - a.sequence;

/**
 * @param {object} r {amount, mode, reference, receiptDate:'YYYY-MM-DD', remarks, allowProvisional}
 */
function recordReceipt(db, loanId, actor, r = {}, { asOf } = {}) {
  const loan = getLoan(db, loanId);
  if (!loan) return fail('LOAN_NOT_FOUND', `loan ${loanId} not found`);
  const gate = checkActor('receipt', actor);
  if (!gate.ok) return gate;
  if (!LIVE_LOAN_STATES.includes(loan.status)) return fail('LOAN_NOT_LIVE', `loan is ${loan.status}; receipts apply to active or recover-at-exit loans`);
  const amt = parseAmount(r.amount, { field: 'receipt amount' });
  if (!amt.ok) return amt;
  if (!text(r.mode)) return fail('MODE_REQUIRED', 'receipt mode is required');
  if (!parseDate(r.receiptDate)) return fail('DATE_INVALID', 'receipt date must be YYYY-MM-DD');
  if (r.receiptDate.slice(0, 10) > (asOf || todayIst())) return fail('DATE_IN_FUTURE', 'receipt date cannot be in the future');
  const balance = toPaise(loan.remaining_balance);
  if (amt.paise > balance) return fail('RECEIPT_ABOVE_BALANCE', `receipt ₹${toRupees(amt.paise)} is above the balance ₹${toRupees(balance)}`);

  return inTxn(db, () => {
    const instalments = getInstalments(db, loan.id);
    const uncovered = Math.max(0, balance - openPaise(instalments));
    let left = amt.paise;
    const cleared = [];
    const stale = [];
    const warnings = [];

    const receiptNo = nextReceiptNo(db, r.receiptDate);
    const receiptId = db.prepare(`INSERT INTO loan_receipts (receipt_no, loan_id, amount, mode, reference, receipt_date, recorded_by, remarks)
                                  VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(receiptNo, loan.id, toRupees(amt.paise), text(r.mode), text(r.reference) || null, r.receiptDate.slice(0, 10), gate.actor.username, text(r.remarks) || null).lastInsertRowid;

    if (uncovered > 0 && left > 0) {
      const take = Math.min(uncovered, left);
      cleared.push({ uncovered: true, amount: toRupees(take) });
      left -= take;
    }
    const takeFrom = (ins) => {
      const due = toPaise(ins.amount_due);
      if (left >= due) {
        db.prepare("UPDATE loan_instalments SET status = 'paid_in_cash', receipt_id = ?, updated_at = datetime('now') WHERE id = ? AND status = ?").run(receiptId, ins.id, ins.status);
        writeEvent(db, { loan, instalmentId: ins.id, event: 'instalment_paid_in_cash', fromState: ins.status, toState: 'paid_in_cash', amountPaise: due, actor: gate.actor, reason: receiptNo, field: 'instalment_status' });
        cleared.push({ instalmentId: ins.id, sequence: ins.sequence, amount: toRupees(due), whole: true });
        left -= due;
      } else {
        db.prepare("UPDATE loan_instalments SET amount_due = ?, updated_at = datetime('now') WHERE id = ?").run(toRupees(due - left), ins.id);
        writeEvent(db, { loan, instalmentId: ins.id, event: 'instalment_reduced', fromState: ins.status, toState: ins.status, amountPaise: left, actor: gate.actor, reason: `${receiptNo}: ₹${toRupees(due)} → ₹${toRupees(due - left)}`, field: 'amount_due' });
        cleared.push({ instalmentId: ins.id, sequence: ins.sequence, amount: toRupees(left), whole: false });
        left = 0;
      }
    };
    for (const ins of instalments.filter((i) => i.status === 'scheduled').sort(fromTheEnd)) {
      if (left <= 0) break;
      takeFrom(ins);
    }
    if (left > 0) {
      if (!r.allowProvisional) {
        return fail('RECEIPT_OVERLAPS_PROVISIONAL', `₹${toRupees(left)} of this receipt would cover an instalment already in this month's Stage 7; wait for the loan close or pass allowProvisional`);
      }
      for (const ins of instalments.filter((i) => i.status === 'provisional').sort(fromTheEnd)) {
        if (left <= 0) break;
        for (const row of db.prepare("SELECT * FROM loan_deductions WHERE instalment_id = ? AND state = 'provisional'").all(ins.id)) {
          db.prepare(`UPDATE loan_deductions SET state = 'reversed', reversed_at = datetime('now'), reversed_by = ?, reversal_reason = ?, updated_at = datetime('now')
                       WHERE id = ? AND state = 'provisional'`).run(gate.actor.username, `covered by receipt ${receiptNo}`, row.id);
          writeEvent(db, { loan, instalmentId: ins.id, event: 'provisional_reversed', fromState: 'provisional', toState: 'reversed', amountPaise: toPaise(row.amount), actor: gate.actor, reason: `covered by receipt ${receiptNo}`, field: 'deduction' });
          stale.push({ deductionId: row.id, payroll: row.payroll, month: row.month, year: row.year, employeeCode: row.employee_code, company: row.company });
        }
        const due = toPaise(ins.amount_due);
        if (left >= due) {
          takeFrom(ins);
        } else {
          db.prepare("UPDATE loan_instalments SET status = 'scheduled', updated_at = datetime('now') WHERE id = ? AND status = 'provisional'").run(ins.id);
          takeFrom({ ...ins, status: 'scheduled' });
        }
      }
    }
    if (left > 0) return fail('RECEIPT_NOT_ALLOCATED', `₹${toRupees(left)} could not be allocated to the schedule`);

    db.prepare('UPDATE loan_receipts SET instalments_cleared = ? WHERE id = ?').run(JSON.stringify(cleared), receiptId);
    const b = moveBalance(db, loan, -amt.paise);
    if (!b.ok) return b;
    if (text(loan.requested_by).toLowerCase() === gate.actor.username.toLowerCase()) {
      warnings.push({ code: 'RECEIPT_BY_REQUESTER', message: 'the person who requested this loan recorded the receipt (K35)' });
    }
    writeEvent(db, {
      loan, event: 'receipt', fromState: loan.status, toState: loan.status, amountPaise: amt.paise, actor: gate.actor, field: 'remaining_balance',
      reason: `${receiptNo} ${text(r.mode)}${text(r.reference) ? ' ref ' + text(r.reference) : ''} on ${r.receiptDate.slice(0, 10)}${warnings.length ? ' — WARNING: recorded by the requester' : ''}`,
    });
    const completed = autoComplete(db, loan.id, gate.actor, `cleared by receipt ${receiptNo}`);
    return {
      ok: true, receiptId, receiptNo, amount: toRupees(amt.paise), balance: toRupees(b.balancePaise),
      cleared, staleDeductions: stale, warnings, loanStatus: completed || getLoan(db, loan.id).status,
    };
  });
}

module.exports = { recordReceipt, nextReceiptNo, financialYear };
