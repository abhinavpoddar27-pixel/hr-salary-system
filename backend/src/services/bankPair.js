/**
 * P1-14 — plant employees carry TWO bank column pairs:
 *   A (canonical): account_number / ifsc_code   — read first by the bank (NEFT) file
 *   B (mirror):    bank_account   / ifsc        — read by the payslip and the payroll register
 * Every writer stores the same value in both, so every reader sees an edit.
 *
 * Values are normalised on write: account trimmed, IFSC trimmed + upper-cased,
 * blank → NULL (clearing a field clears both pairs).
 */

function normAccount(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

function normIfsc(v) {
  const s = normAccount(v);
  return s === null ? null : s.toUpperCase();
}

/**
 * Read one value that may arrive under either column name.
 * @returns {{present:false} | {present:true, value:string|null} | {error:string}}
 */
function readPair(body, keyA, keyB, norm) {
  const hasA = body && body[keyA] !== undefined;
  const hasB = body && body[keyB] !== undefined;
  if (!hasA && !hasB) return { present: false };
  const a = hasA ? norm(body[keyA]) : undefined;
  const b = hasB ? norm(body[keyB]) : undefined;
  if (hasA && hasB && a !== b) {
    return { error: `${keyA} and ${keyB} differ — send one value` };
  }
  return { present: true, value: hasA ? a : b };
}

/**
 * Both bank values from a request body.
 * @returns {{ok:true, account:object, ifsc:object} | {ok:false, error:string}}
 */
function readBankPairs(body, names = {}) {
  const account = readPair(body, names.accountA || 'account_number', names.accountB || 'bank_account', normAccount);
  if (account.error) return { ok: false, error: account.error };
  const ifsc = readPair(body, names.ifscA || 'ifsc_code', names.ifscB || 'ifsc', normIfsc);
  if (ifsc.error) return { ok: false, error: ifsc.error };
  return { ok: true, account, ifsc };
}

const BANK_PAIR_MISMATCH = 'BANK_PAIR_MISMATCH';

module.exports = { normAccount, normIfsc, readBankPairs, BANK_PAIR_MISMATCH };
