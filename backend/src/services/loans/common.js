/**
 * Loans engine — shared internals (Loans PR-2). Not part of the public façade.
 */
const { toPaise, toRupees } = require('./money');
const { addMonths, compareMonth } = require('./months');
const { readLoanPolicy } = require('./policy');
const { AUTO_EXTENSION_ORIGINS, LIVE_LOAN_STATES } = require('./states');
const { writeEvent } = require('./events');

const fail = (code, message, extra = {}) => ({ ok: false, code, message, ...extra });
const text = (v) => String(v == null ? '' : v).trim();

function getLoan(db, loanId) {
  return db.prepare('SELECT * FROM loans WHERE id = ?').get(loanId) || null;
}

function getInstalments(db, loanId) {
  return db.prepare('SELECT * FROM loan_instalments WHERE loan_id = ? ORDER BY sequence').all(loanId);
}

const ROLLBACK = Object.freeze({ loansEngineRollback: true });
/**
 * Runs fn inside a transaction (a SAVEPOINT when the caller already has one,
 * e.g. PR-5's per-employee savepoint) and rolls back whenever fn returns
 * ok:false, so a refusal half-way through never leaves partial writes.
 */
function inTxn(db, fn) {
  let result;
  try {
    db.transaction(() => {
      result = fn();
      if (!result || result.ok === false) throw ROLLBACK;
    })();
  } catch (e) {
    if (e !== ROLLBACK) throw e;
  }
  return result;
}

/** Σ amount_due (paise) of instalments still to be recovered (scheduled + provisional). */
function openPaise(instalments) {
  return instalments
    .filter((i) => i.status === 'scheduled' || i.status === 'provisional')
    .reduce((s, i) => s + toPaise(i.amount_due), 0);
}

/** Month after the latest non-cancelled instalment — where a new last instalment goes. */
function nextAppendMonth(instalments) {
  let last = null;
  for (const i of instalments) {
    if (i.status === 'cancelled') continue;
    const m = { month: i.due_month, year: i.due_year };
    if (!last || compareMonth(m, last) > 0) last = m;
  }
  return last ? addMonths(last, 1) : null;
}

/** The month after the latest loan close for a payroll, or null when nothing has closed yet. */
function firstUnclosedMonth(db, payroll) {
  const r = db.prepare('SELECT month, year FROM loan_closes WHERE payroll = ? ORDER BY year DESC, month DESC LIMIT 1').get(payroll);
  return r ? addMonths(r, 1) : null;
}

/** Never place a new instalment in a month whose loan close has already run. */
function notBeforeOpen(db, payroll, m) {
  const open = firstUnclosedMonth(db, payroll);
  return open && compareMonth(m, open) < 0 ? open : m;
}

/**
 * Months already added at the end automatically (shortfall / no salary / held)
 * since the latest restructure. Approved defers do not count (coordinator
 * ruling 3). A restructure inserts its rows contiguously, so every instalment
 * added after it has a larger id than the largest 'restructure' id.
 */
function extensionMonthsUsed(instalments) {
  const boundary = instalments.filter((i) => i.origin === 'restructure').reduce((m, i) => Math.max(m, i.id), 0);
  return instalments.filter((i) => i.id > boundary && AUTO_EXTENSION_ORIGINS.includes(i.origin) && i.status !== 'cancelled').length;
}

/**
 * Adds a new last instalment. For an automatic origin at the extension limit
 * (D-19) nothing is added: the amount stays in the balance as "uncovered", an
 * `extension_limit_reached` event is written, and a structured alert is
 * returned for PR-6 to notify finance.
 */
function appendInstalment(db, loan, { amountPaise, origin, sourceInstalmentId = null, actor, reason }) {
  const instalments = getInstalments(db, loan.id);
  if (AUTO_EXTENSION_ORIGINS.includes(origin)) {
    const policy = readLoanPolicy(db);
    const used = extensionMonthsUsed(instalments);
    if (used >= policy.maxShortfallExtensionMonths) {
      writeEvent(db, {
        loan, instalmentId: sourceInstalmentId, event: 'extension_limit_reached', amountPaise, actor,
        reason: `${origin}: ₹${toRupees(amountPaise)} not rescheduled — ${used} of ${policy.maxShortfallExtensionMonths} extension months already used. Finance must restructure or collect cash. ${reason || ''}`.trim(),
        field: 'schedule',
      });
      return {
        added: null,
        alert: {
          type: 'loan_extension_limit_reached',
          severity: 'action_required',
          audience: 'finance',
          loanId: loan.id,
          borrowerType: loan.borrower_type,
          employeeCode: loan.employee_code,
          company: loan.company,
          origin,
          uncoveredAmount: toRupees(amountPaise),
          extensionMonthsUsed: used,
          extensionLimit: policy.maxShortfallExtensionMonths,
          sourceInstalmentId,
          message: `Loan ${loan.id} (${loan.employee_code}): ₹${toRupees(amountPaise)} could not be moved to the end — the ${policy.maxShortfallExtensionMonths}-month extension limit is reached. Restructure (admin approval) or collect cash.`,
        },
      };
    }
  }
  const month = notBeforeOpen(db, loan.borrower_type, nextAppendMonth(instalments));
  const sequence = instalments.reduce((m, i) => Math.max(m, i.sequence), 0) + 1;
  const info = db.prepare(`
    INSERT INTO loan_instalments (loan_id, sequence, due_month, due_year, amount_due, status, origin, source_instalment_id)
    VALUES (?, ?, ?, ?, ?, 'scheduled', ?, ?)
  `).run(loan.id, sequence, month.month, month.year, toRupees(amountPaise), origin, sourceInstalmentId);
  writeEvent(db, {
    loan, instalmentId: info.lastInsertRowid, event: 'instalment_added', fromState: null, toState: 'scheduled',
    amountPaise, actor, reason: `${origin}${reason ? ': ' + reason : ''} → due ${month.year}-${String(month.month).padStart(2, '0')}`,
    field: 'schedule',
  });
  return { added: { id: info.lastInsertRowid, sequence, month: month.month, year: month.year, amount: toRupees(amountPaise), origin }, alert: null };
}

/** Moves the cached balance by deltaPaise (negative = recovered). Optimistic guard on the old value. */
function moveBalance(db, loan, deltaPaise) {
  const fresh = getLoan(db, loan.id);
  const next = toPaise(fresh.remaining_balance) + deltaPaise;
  if (next < 0) return fail('BALANCE_NEGATIVE', `this would take the balance below ₹0 (balance ₹${fresh.remaining_balance})`);
  const r = db.prepare(`UPDATE loans SET remaining_balance = ?, updated_at = datetime('now') WHERE id = ? AND remaining_balance = ?`)
    .run(toRupees(next), loan.id, fresh.remaining_balance);
  if (r.changes !== 1) return fail('CONCURRENT_CHANGE', 'the balance changed underneath');
  return { ok: true, balancePaise: next };
}

/**
 * When the balance reaches ₹0: active → completed, recover_at_exit →
 * settled_at_exit (automatic, SPEC §5.4). Any instalment still open is cancelled.
 */
function autoComplete(db, loanId, actor, reason) {
  const loan = getLoan(db, loanId);
  if (!LIVE_LOAN_STATES.includes(loan.status) || toPaise(loan.remaining_balance) !== 0) return null;
  const toState = loan.status === 'active' ? 'completed' : 'settled_at_exit';
  for (const i of getInstalments(db, loanId).filter((x) => x.status === 'scheduled')) {
    db.prepare("UPDATE loan_instalments SET status = 'cancelled', updated_at = datetime('now') WHERE id = ? AND status = 'scheduled'").run(i.id);
    writeEvent(db, { loan, instalmentId: i.id, event: 'instalment_cancelled', fromState: 'scheduled', toState: 'cancelled', amountPaise: toPaise(i.amount_due), actor, reason: 'balance reached ₹0', field: 'instalment_status' });
  }
  db.prepare(`UPDATE loans SET status = ?, updated_at = datetime('now') WHERE id = ? AND status = ?`).run(toState, loanId, loan.status);
  writeEvent(db, { loan, event: toState, fromState: loan.status, toState, amountPaise: 0, actor, reason: reason || 'balance reached ₹0' });
  return toState;
}

module.exports = {
  fail, text, getLoan, getInstalments, inTxn, openPaise, nextAppendMonth, firstUnclosedMonth, notBeforeOpen,
  extensionMonthsUsed, appendInstalment, moveBalance, autoComplete,
};
