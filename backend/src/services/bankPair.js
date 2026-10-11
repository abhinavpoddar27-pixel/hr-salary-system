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

/** Last 4 characters only — an audit row must never hold a full account / IFSC. */
function maskTail(v) {
  if (v === null || v === undefined || String(v) === '') return '';
  const s = String(v);
  return '****' + s.slice(-4);
}

/** The value a reader sees today: A unless empty, else B (normalised). */
const storedAccount = (emp) => normAccount(emp?.account_number) ?? normAccount(emp?.bank_account);
const storedIfsc = (emp) => normIfsc(emp?.ifsc_code) ?? normIfsc(emp?.ifsc);

/**
 * P1-14 review F2: one audit_log row per bank value that really changed
 * (stage 'bank_details_change', field account_number / ifsc_code, old/new
 * masked to the last 4 characters). Call AFTER the write, on the same handle.
 *
 * @param {object} db
 * @param {object} p  { emp: stored row before the write (or null for a new employee),
 *                      employeeId, employeeCode, account: readPair result, ifsc: readPair result, user, via }
 * @returns {number} rows written
 */
function auditBankChange(db, { emp, employeeId, employeeCode, account, ifsc, user, via }) {
  const ins = db.prepare(`INSERT INTO audit_log (table_name, record_id, field_name, old_value, new_value, changed_by, stage, remark, employee_code, action_type)
    VALUES ('employees', ?, ?, ?, ?, ?, 'bank_details_change', ?, ?, 'bank_details_change')`);
  let n = 0;
  for (const [field, pair, before] of [
    ['account_number', account, storedAccount(emp)],
    ['ifsc_code', ifsc, storedIfsc(emp)],
  ]) {
    if (!pair || !pair.present) continue;
    const after = pair.value ?? null;
    if ((before ?? null) === after) continue;
    ins.run(employeeId ?? null, field, maskTail(before), maskTail(after), user || 'unknown',
      `Bank ${field === 'account_number' ? 'account' : 'IFSC'} changed via ${via}`, employeeCode);
    n++;
  }
  return n;
}

module.exports = { normAccount, normIfsc, readBankPairs, auditBankChange, maskTail, BANK_PAIR_MISMATCH };
