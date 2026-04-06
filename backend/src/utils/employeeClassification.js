/**
 * Employee classification utilities — contractor vs permanent detection
 */

const CONTRACTOR_DEPT_KEYWORDS = [
  'MEERA', 'KULDEEP', 'LAMBU', 'COM. HELPER', 'JIWAN', 'DAVINDER',
  'SUNNY', 'AMAR', 'BISLERI', 'CONT', 'PARIKSHAN'
];

function isContractor(employee) {
  if (!employee) return false;
  // Explicit flag takes priority
  if (employee.is_contractor === 1) return true;
  const empType = (employee.employment_type || '').toUpperCase();
  if (empType === 'CONTRACT' || empType === 'CONTRACTOR') return true;
  const category = (employee.category || '').toUpperCase();
  if (category === 'CONTRACTOR' || category === 'WORKER') return true;
  const dept = (employee.department || '').toUpperCase();
  return CONTRACTOR_DEPT_KEYWORDS.some(k => dept.includes(k));
}

module.exports = { isContractor, CONTRACTOR_DEPT_KEYWORDS };
