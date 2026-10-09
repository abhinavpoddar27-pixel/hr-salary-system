/**
 * Loans engine — opposite entries for a POSTED deduction (Loans PR-6,
 * docs/loans/SPEC.md §5.2 r7 and r12, K2, K22, K35).
 *
 * A posted loan_deductions row is never edited (PR-1 ruling). Its correction is
 * a new row in loan_adjustments (append-only):
 *
 *   effective posted = loan_deductions.amount − Σ loan_adjustments.amount
 *
 * Every adjustment, in one savepoint: inserts the row, raises the balance by its
 * amount, returns the amount to the schedule as a new last instalment, and
 * writes a loan event + audit row.
 *
 *   'unborne'   Stage 7 re-ran a posted month and pay can no longer bear the
 *               posted amount: the part that does not fit (origin 'shortfall',
 *               counts toward the 3-month extension limit, D-19).
 *   'reversal'  an admin reverses a posted deduction (origin 'reversal', does
 *               not count toward the limit — it is an approved decision).
 *
 * Live loans only (owner ruling Q2): reopening a completed / settled /
 * written-off loan is a state-machine change this PR does not make.
 */
const { toPaise, toRupees } = require('./money');
const { checkActor, LIVE_LOAN_STATES } = require('./states');
const { writeEvent } = require('./events');
const { fail, text, getLoan, inTxn, appendInstalment, moveBalance } = require('./common');

function tableExists(db) {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'loan_adjustments'").get();
}

/** Σ adjustments of one deduction, in paise (0 when the table is not there yet). */
function adjustedPaise(db, deductionId) {
  if (!tableExists(db)) return 0;
  return db.prepare('SELECT amount FROM loan_adjustments WHERE deduction_id = ?').all(deductionId)
    .reduce((s, r) => s + toPaise(r.amount), 0);
}

/** Posted amount still standing after opposite entries, in paise. */
function effectivePostedPaise(db, deduction) {
  if (!deduction || deduction.state !== 'posted') return 0;
  return toPaise(deduction.amount) - adjustedPaise(db, deduction.id);
}

const KIND = Object.freeze({
  unborne: { action: 'post', origin: 'shortfall', event: 'posted_unborne_moved' },
  reversal: { action: 'reverse_posted', origin: 'reversal', event: 'posted_reversed' },
});

/**
 * @param {object} a {deductionId, kind:'unborne'|'reversal', amountPaise, reason}
 * @returns {{ok, adjustmentId, amount, effectivePosted, added, alerts}}
 */
function writeAdjustment(db, { deductionId, kind, amountPaise, reason }, actor) {
  const k = KIND[kind];
  if (!k) return fail('KIND_INVALID', 'kind must be unborne or reversal');
  const gate = checkActor(k.action, actor);
  if (!gate.ok) return gate;
  if (!tableExists(db)) return fail('NOT_MIGRATED', 'loan_adjustments does not exist yet');
  const why = text(reason);
  if (!why) return fail('REASON_REQUIRED', 'a reason is required');
  if (!Number.isInteger(amountPaise) || amountPaise <= 0) return fail('AMOUNT_INVALID', 'adjustment amount must be above ₹0');
  const row = db.prepare('SELECT * FROM loan_deductions WHERE id = ?').get(deductionId);
  if (!row) return fail('DEDUCTION_NOT_FOUND', `deduction ${deductionId} not found`);
  if (row.state !== 'posted') return fail('DEDUCTION_NOT_POSTED', `deduction is ${row.state}; only a posted deduction takes an opposite entry`);
  const loan = getLoan(db, row.loan_id);
  if (!LIVE_LOAN_STATES.includes(loan.status)) return fail('LOAN_NOT_LIVE', `loan is ${loan.status}; an opposite entry applies to a live loan only`);

  return inTxn(db, () => {
    const eff = effectivePostedPaise(db, row);
    if (amountPaise > eff) return fail('ADJUSTMENT_ABOVE_POSTED', `₹${toRupees(amountPaise)} is above the posted amount still standing (₹${toRupees(eff)})`);
    const b = moveBalance(db, loan, amountPaise);
    if (!b.ok) return b;
    const label = `${row.payroll} ${row.month}/${row.year}`;
    const a = appendInstalment(db, getLoan(db, loan.id), {
      amountPaise, origin: k.origin, sourceInstalmentId: row.instalment_id, actor: gate.actor,
      reason: `${kind} of ${label} posted ₹${row.amount}: ${why}`,
    });
    const info = db.prepare(`INSERT INTO loan_adjustments (loan_id, deduction_id, instalment_id, kind, amount, reason, actor, added_instalment_id)
                             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(loan.id, row.id, row.instalment_id, kind, toRupees(amountPaise), why, gate.actor.username, a.added ? a.added.id : null);
    writeEvent(db, {
      loan, instalmentId: row.instalment_id, event: k.event, fromState: 'posted', toState: 'posted', amountPaise, actor: gate.actor,
      field: 'deduction',
      reason: `${label}: opposite entry ₹${toRupees(amountPaise)} (posted ₹${row.amount}, now ₹${toRupees(eff - amountPaise)}); ${why}`,
    });
    return {
      ok: true, adjustmentId: info.lastInsertRowid, amount: toRupees(amountPaise), effectivePosted: toRupees(eff - amountPaise),
      added: a.added, alerts: a.alert ? [a.alert] : [],
    };
  });
}

module.exports = { adjustedPaise, effectivePostedPaise, writeAdjustment, LOAN_ADJUSTMENT_KINDS: Object.keys(KIND) };
