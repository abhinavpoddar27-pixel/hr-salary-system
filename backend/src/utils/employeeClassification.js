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
 * Priority order:
 *   1. Explicit `is_contractor` DB flag (if set — HR's manual override wins)
 *   2. `employment_type` from Employee Master (authoritative — if set, it
 *      determines contractor status regardless of category/department)
 *   3. Department-keyword heuristic (FALLBACK ONLY for legacy rows with
 *      no employment_type set)
 *
 * Returns boolean.
 */
function isContractorForPayroll(employee) {
  if (!employee) return false;

  // 1. Explicit DB flag — HR's manual override wins. is_contractor=0 is
  //    NOT treated as "definitely not contractor" here because many rows
  //    default to 0 without HR having reviewed them; only =1 is decisive.
  if (employee.is_contractor === 1) return true;

  // 2. employment_type from Employee Master is the source of truth.
  //    If it's explicitly set, use it and SKIP the dept heuristic entirely.
  //    This prevents COM. HELPER / WORKER-category permanent employees
  //    from being wrongly flagged by keyword matching.
  const empType = (employee.employment_type || '').trim().toLowerCase();
  if (empType) {
    return empType.includes('contract');
  }

  // 3. Legacy fallback: no employment_type set. Use dept heuristic.
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
