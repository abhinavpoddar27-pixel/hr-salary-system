/**
 * Loans engine — money helpers (Loans PR-2, docs/loans/SPEC.md §5.2 r3).
 *
 * Every amount inside the engine is an integer number of PAISE. The database
 * stores REAL rupees rounded to 2 decimals; conversion happens only at the
 * edges (toPaise when reading, toRupees when writing). Doing the arithmetic in
 * integers is what makes "the instalments sum exactly to the principal" and
 * "reconciliation exact to the paisa" hold without float drift.
 */

/** Rupees (number or numeric string) → integer paise. NaN for anything not finite. */
function toPaise(rupees) {
  const n = typeof rupees === 'string' ? Number(rupees.trim()) : Number(rupees);
  if (!Number.isFinite(n)) return NaN;
  return Math.round(n * 100);
}

/** Integer paise → rupees, exactly 2 decimals as a Number. */
function toRupees(paise) {
  return Math.round(paise) / 100;
}

/**
 * Validates a user-supplied money amount.
 * Rules: finite, > 0 (or ≥ 0 with allowZero), at most 2 decimals.
 * @returns {{ok:true, paise:number} | {ok:false, code:string, message:string}}
 */
function parseAmount(value, { allowZero = false, field = 'amount' } = {}) {
  if (value === null || value === undefined || value === '') {
    return { ok: false, code: 'AMOUNT_INVALID', message: `${field} is required` };
  }
  const n = typeof value === 'string' ? Number(value.trim()) : Number(value);
  if (!Number.isFinite(n)) {
    return { ok: false, code: 'AMOUNT_INVALID', message: `${field} must be a number` };
  }
  const scaled = n * 100;
  if (Math.abs(scaled - Math.round(scaled)) > 1e-6) {
    return { ok: false, code: 'AMOUNT_INVALID', message: `${field} may have at most 2 decimals` };
  }
  const paise = Math.round(scaled);
  if (paise < 0 || (!allowZero && paise === 0)) {
    return { ok: false, code: 'AMOUNT_INVALID', message: `${field} must be greater than zero` };
  }
  return { ok: true, paise };
}

/** Rounds paise UP to the next whole rupee (100 paise). */
function ceilToRupee(paise) {
  return Math.ceil(paise / 100) * 100;
}

module.exports = { toPaise, toRupees, parseAmount, ceilToRupee };
