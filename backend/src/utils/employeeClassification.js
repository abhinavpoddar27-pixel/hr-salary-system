/**
 * Employee classification utilities — contractor vs permanent detection
 *
 * ⚠️ For PAYROLL decisions (day calc, salary comp, payslips), use
 *    `isContractorForPayroll(employee)` — it honours the authoritative
 *    `employment_type` field from the Employee Master and only falls back
 *    to the dept-keyword heuristic when employment_type is missing.
 *
 * The legacy `isContractor()` function remains for backward compat but its
 * cascade (is_contractor flag → employment_type → category → dept keywords)
 * can wrongly flag a permanent employee as contractor if their category is
 * 'WORKER' or their dept name accidentally matches a keyword. Do not use
 * it for new code.
 */

const CONTRACTOR_DEPT_KEYWORDS = [
  'MEERA', 'KULDEEP', 'LAMBU', 'JIWAN', 'DAVINDER',
  'SUNNY', 'AMAR', 'BISLERI', 'CONT', 'PARIKSHAN',
  'MANPREET', 'RANJIT', 'MOTI LAL', 'RAJENDRA', 'PAPPU'
];

function deptMatchesContractorKeyword(deptName) {
  if (!deptName) return false;
  const dept = deptName.toUpperCase();
  return CONTRACTOR_DEPT_KEYWORDS.some(k => dept.includes(k));
}

/**
 * PAYROLL-GRADE contractor detection.
 *
 * Priority order (April 2026 fix — employment_type is now authoritative):
 *   1. `employment_type` from Employee Master (user-editable source of truth).
 *      If it's explicitly set, it ALWAYS determines contractor status —
 *      this makes the Edit Employee form actually work for rows whose
 *      `is_contractor` flag was set by a one-time migration.
 *      - empty string 'contract' → contractor
 *      - anything else ('Permanent', 'Worker', 'SILP', …) → NOT contractor
 *   2. `is_contractor` DB flag — fallback only when employment_type is empty.
 *      This legacy flag was set by the March 2026 migration for employees
 *      that had no employment_type yet.
 *   3. Department-keyword heuristic — last resort for legacy rows with
 *      neither employment_type nor is_contractor set.
 *
 * Returns boolean.
 */
function isContractorForPayroll(employee) {
  if (!employee) return false;

  // 1. employment_type from Employee Master is the source of truth.
  //    If it's explicitly set, use it and SKIP everything else. This
  //    ensures the Edit Employee form actually overrides a stale
  //    is_contractor flag set by the one-time migration.
  const empType = (employee.employment_type || '').trim().toLowerCase();
  if (empType) {
    return empType.includes('contract');
  }

  // 2. is_contractor DB flag — fallback only when employment_type is empty.
  //    The March 2026 migration set this on ~115 rows that didn't have
  //    employment_type. Any row with a non-empty employment_type short-
  //    circuits above this check.
  if (employee.is_contractor === 1) return true;

  // 3. Legacy fallback: no employment_type, no is_contractor. Use dept heuristic.
  return deptMatchesContractorKeyword(employee.department);
}

/**
 * LEGACY detection — kept only for backward compatibility. DO NOT use for
 * payroll. The cascade can misclassify permanent employees whose category
 * happens to be 'WORKER' or whose dept name contains a keyword.
 */
function isContractor(employee) {
  if (!employee) return false;
  if (employee.is_contractor === 1) return true;
  const empType = (employee.employment_type || '').toUpperCase();
  if (empType === 'CONTRACT' || empType === 'CONTRACTOR') return true;
  const category = (employee.category || '').toUpperCase();
  if (category === 'CONTRACTOR' || category === 'WORKER') return true;
  const dept = (employee.department || '').toUpperCase();
  return CONTRACTOR_DEPT_KEYWORDS.some(k => dept.includes(k));
}

module.exports = {
  isContractor,              // legacy — do not use for payroll
  isContractorForPayroll,    // ← use this for payroll
  deptMatchesContractorKeyword,
  CONTRACTOR_DEPT_KEYWORDS
};
