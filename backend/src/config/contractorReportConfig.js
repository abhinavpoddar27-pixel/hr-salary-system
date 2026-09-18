/**
 * Contractor Report — the single rules file. (PR-2, read-only, Sep 2026)
 *
 * Every mapping, weight and exclusion the Contractor Report depends on lives
 * here and nowhere else. A later PR replaces the alias maps with a contractor
 * master table; when it does, only this file changes.
 *
 * NOTHING in this file reads `employees.is_contractor` or
 * `employees.contractor_group`. Both are deliberately unused:
 *   - `is_contractor` is a stale one-time-migration flag (owner ruling).
 *   - `contractor_group` was blank on 345/345 contract employees on 19 Sep 2026.
 *
 * This file also never reads any commission column
 * (`dw_contractors.current_commission_rate`, `dw_entries.commission_rate_applied`,
 * `dw_entries.total_commission_amount`, `dw_entries.total_liability`,
 * `dw_department_allocations.allocated_commission_amount`). Commission rates are
 * admin-set in the contractor master and are out of scope for this PR
 * (AMENDMENT 1, 19 Sep 2026).
 */

// ─── Population ───────────────────────────────────────────────────────────
// A contractor worker is an employee whose employment_type contains "contract",
// minus two departments. This is INTENTIONALLY NARROWER than
// utils/employeeClassification.js `isContractorForPayroll`, which also falls
// back to the is_contractor flag and a department-keyword heuristic.
//
// Verified on production 19 Sep 2026: the two classifiers disagree on exactly
// 11 employees, all in SECURITY, all reached through the employment_type path.
// Every one of the 1,221 employees has a non-empty employment_type, so
// isContractorForPayroll never reaches its other two fallbacks at all.
const EMPLOYMENT_TYPE_NEEDLE = 'contract';

// BISLERI WORKERS currently excludes nobody (its employees are Permanent /
// Worker, never Contract). It is kept because it is an owner ruling and because
// "BISLERI" is a contractor keyword in the legacy heuristic.
const EXCLUDED_DEPARTMENTS = ['SECURITY', 'BISLERI WORKERS'];

// ─── Attendance weights ───────────────────────────────────────────────────
// Applied to COALESCE(status_final, status_original). Anything not listed
// weighs 0. Rows with is_night_out_only = 1 are skipped before weighting so a
// night shift is counted once, on the date the worker punched IN.
const PRESENT_WEIGHTS = { P: 1, WOP: 1, '½P': 0.5, 'WO½P': 0.5 };

// "Heads" = rows with weight > 0 (a half day is one head).
// "Man-days" = sum of weights, excluding dates before date_of_joining.
// Man-days are NOT clipped by date_of_exit: payroll does not clip either, so
// clipping here would break the tie-out. Post-exit punching is flagged instead.

// ─── Daily wage ───────────────────────────────────────────────────────────
const DW_COUNTED_STATUSES = ['approved', 'paid'];

// Excluded from every figure except the "Test entries to void" exception list.
const TEST_CONTRACTORS = ['RAJESH KUMAR', 'SURESH SINGH'];

// ─── Company ──────────────────────────────────────────────────────────────
// Exactly these two strings are valid. Everything else — blank, NULL, the
// literal string "null", "Default", "ASIAN" — is unknown and feeds the yellow
// banner. There are deliberately NO company-mapping rules: the report must
// agree with the value payroll stores, and bad records are fixed at source
// (owner ruling, 19 Sep 2026).
const VALID_COMPANIES = ['Indriyan Beverages Pvt Ltd', 'Asian Lakto Ind Ltd'];

// dw_entries is effectively not company-split (157 blank + 6 Indriyan across
// April–May 2026), so the company filter applies to biometric workers only.

// ─── Contractor aliases ───────────────────────────────────────────────────
// Matched on UPPER(TRIM(...)). A name absent from both maps is NOT dropped —
// it is shown under its own name with a grey "not mapped" badge.

// employees.department → display name.
const BIOMETRIC_CONTRACTOR_ALIASES = {
  MEERA: 'Meera',
  MRREA: 'Meera',
  'PAPPU CONT': 'Pappu',
  'PARIKSHAN PASWAN': 'Parikshan Paswan',
  'KULDEEP CONT': 'Kuldeep',
  'MANPREET CON': 'Manpreet',
  'MOTI LAL CON': 'Moti Lal',
  'RANJIT CONT': 'Ranjit',
  'RAJENDRA CONT': 'Rajendra',
  'DAVINDER CONT': 'Davinder',
  'JIWAN CONT': 'Jiwan Lal',
  SAJAN: 'Sajan',
  AMAR: 'Amar',
  'SONU CONT': 'Sonu',
  DEFAULT: 'Unmapped (DEFAULT)',
};

// dw_contractors.contractor_name → display name.
const DW_CONTRACTOR_ALIASES = {
  'MEERA CONT': 'Meera',
  'MEERA CONTRACTOR': 'Meera',
  'MEERA DAILY WAGE': 'Meera',
  PAPPU: 'Pappu',
  'PAPPU CONT': 'Pappu',
  'JIWAN LAL CONT': 'Jiwan Lal',
  'SAJAN CONT': 'Sajan',
  'CHOTTU CONT': 'Chottu',
  'JAVED PAINTER (SHABBIR)': 'Javed painter',
  'DHANRAJ (FOR LIFTTER)': 'Floor lifters',
  'JITENDER FLOOR LIFTER': 'Floor lifters',
  'SANJAY FLOOR LIFTER': 'Floor lifters',
  'SAJJAN+JIWAN LAL (12-H)': 'Sajan + Jiwan Lal (12-h)',
};

// A daily-wage record that covers more than one gang. Its both-source check
// runs against the biometric attendance of EVERY component, not against a
// contractor of its own name (which has no biometric workers).
//
// No live entries existed in April–May 2026, so this path is proven by a unit
// test fixture rather than by production data (owner ruling, 19 Sep 2026).
const COMBINED_CONTRACTORS = {
  'Sajan + Jiwan Lal (12-h)': ['Sajan', 'Jiwan Lal'],
};

// ─── Department normaliser ────────────────────────────────────────────────
// Runs over dw_department_allocations.department (the text typed at the gate).
// The typed text is always kept alongside the normalised name.
//
// ⚠️ RULE ORDER IS LOAD-BEARING — do not sort, regroup or "tidy" this list.
// The rules are tested in sequence and the first match wins. Proof from
// production, 9 May 2026: one allocation is typed
//     "UTILITY (SUGAR-7, SYRUP-1,PULP-2,HK-2,ZEERA (400) PROD-5,,BOILER-1,MOULDING-2, OTHER-1"
// It contains "zeera" AND "prod", so only the starts-with-"utility" rule
// running FIRST puts its 21 heads under Utility. Move the zeera or prod rule
// above it and the 9 May report silently changes (Utility 21 → 0).
const DEPARTMENT_RULES = [
  { test: (s) => s.startsWith('utility'), name: 'Utility' },
  { test: (s) => s.includes('zeera'), name: 'Zeera 400 ml line' },
  { test: (s) => s.includes('night'), name: 'Production · night' },
  { test: (s) => s.includes('paint'), name: 'Painting' },
  { test: (s) => s.includes('store'), name: 'Store' },
  { test: (s) => s.includes('godown'), name: 'Godown' },
  { test: (s) => s.includes('prod'), name: 'Production' },
  { test: (s) => s.includes('housekeeping'), name: 'Housekeeping' },
  { test: (s) => s.includes('etp'), name: 'ETP' },
  { test: (s) => s.includes('mistri'), name: 'Maintenance (mistri)' },
];

const DEPARTMENT_NOT_RECORDED = 'Not recorded';

// ─── Roles ────────────────────────────────────────────────────────────────
// From employees.designation. Biometric contract workers carry NO work
// department in the data, so the Day Report groups them by role under
// "Area not recorded · <role>".
const ROLE_ALIASES = {
  LODING: 'Loading',
  LOADING: 'Loading',
  SUPERVISOR: 'Supervisor',
  HELPER: 'Helper',
  'S.GUARD': 'Guard',
  GUARD: 'Guard',
  SWEEPER: 'Sweeper',
};

const ROLE_NO_DESIGNATION = 'No designation';

// Display order for grouped rows. Anything unlisted sorts between the known
// roles and "No designation", alphabetically.
const ROLE_ORDER = ['Supervisor', 'Loading', 'Helper', 'Guard', 'Sweeper'];

// ─── Helpers ──────────────────────────────────────────────────────────────
const up = (v) => String(v == null ? '' : v).trim().toUpperCase();

/** Weight of an attendance status. Unknown/absent statuses weigh 0. */
function statusWeight(status) {
  const key = String(status == null ? '' : status).trim();
  return Object.prototype.hasOwnProperty.call(PRESENT_WEIGHTS, key)
    ? PRESENT_WEIGHTS[key]
    : 0;
}

/**
 * SQL fragment that weights an attendance status column, generated from
 * PRESENT_WEIGHTS so SQL and JS can never drift apart.
 * Status keys are literals owned by this file — no user input reaches it.
 */
function statusWeightSql(columnExpr) {
  const whens = Object.entries(PRESENT_WEIGHTS)
    .map(([st, w]) => `WHEN '${st.replace(/'/g, "''")}' THEN ${w}`)
    .join(' ');
  return `CASE ${columnExpr} ${whens} ELSE 0 END`;
}

/** The statuses that count as present, for an SQL IN (...) list. */
const PRESENT_STATUSES = Object.keys(PRESENT_WEIGHTS);

/** employees.department → { name, unmapped }. Never returns empty. */
function resolveBiometricContractor(department) {
  const key = up(department);
  if (BIOMETRIC_CONTRACTOR_ALIASES[key]) {
    return { name: BIOMETRIC_CONTRACTOR_ALIASES[key], unmapped: false };
  }
  return { name: key || 'Unmapped (blank department)', unmapped: true };
}

/** dw_contractors.contractor_name → { name, unmapped }. Never returns empty. */
function resolveDwContractor(contractorName) {
  const key = up(contractorName);
  if (DW_CONTRACTOR_ALIASES[key]) {
    return { name: DW_CONTRACTOR_ALIASES[key], unmapped: false };
  }
  return { name: key || 'Unmapped (blank name)', unmapped: true };
}

/** The biometric contractors a display name should be compared against. */
function componentContractors(displayName) {
  return COMBINED_CONTRACTORS[displayName] || [displayName];
}

/** Typed gate text → normalised department name. Order matters — see above. */
function normalizeDepartment(typed) {
  const raw = String(typed == null ? '' : typed).trim();
  if (!raw) return DEPARTMENT_NOT_RECORDED;
  const s = raw.toLowerCase();
  for (const rule of DEPARTMENT_RULES) {
    if (rule.test(s)) return rule.name;
  }
  return raw;
}

/** employees.designation → role label. */
function normalizeRole(designation) {
  const key = up(designation);
  if (!key) return ROLE_NO_DESIGNATION;
  if (ROLE_ALIASES[key]) return ROLE_ALIASES[key];
  return key
    .toLowerCase()
    .split(/\s+/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}

/** Sort key for a role, for grouped grid rows and the day-report detail. */
function roleRank(role) {
  const i = ROLE_ORDER.indexOf(role);
  if (i >= 0) return i;
  return role === ROLE_NO_DESIGNATION ? ROLE_ORDER.length + 1 : ROLE_ORDER.length;
}

/** Is this employees.company one of the two real companies? */
function isValidCompany(company) {
  return VALID_COMPANIES.includes(String(company == null ? '' : company).trim());
}

function isTestContractorName(contractorName) {
  return TEST_CONTRACTORS.includes(up(contractorName));
}

/**
 * The employees.department values that resolve to a given display name.
 * Lets the grid query filter in SQL instead of scanning the whole month and
 * discarding other gangs in JS. An unmapped contractor is its own department.
 */
function departmentsForContractor(displayName) {
  const mapped = Object.entries(BIOMETRIC_CONTRACTOR_ALIASES)
    .filter(([, name]) => name === displayName)
    .map(([dept]) => dept);
  return mapped.length ? mapped : [up(displayName)];
}

/** Every display name this config knows about, for grid-param validation. */
function knownContractorNames() {
  return [
    ...new Set([
      ...Object.values(BIOMETRIC_CONTRACTOR_ALIASES),
      ...Object.values(DW_CONTRACTOR_ALIASES),
      ...Object.keys(COMBINED_CONTRACTORS),
    ]),
  ].sort();
}

module.exports = {
  EMPLOYMENT_TYPE_NEEDLE,
  EXCLUDED_DEPARTMENTS,
  PRESENT_WEIGHTS,
  PRESENT_STATUSES,
  DW_COUNTED_STATUSES,
  TEST_CONTRACTORS,
  VALID_COMPANIES,
  BIOMETRIC_CONTRACTOR_ALIASES,
  DW_CONTRACTOR_ALIASES,
  COMBINED_CONTRACTORS,
  DEPARTMENT_RULES,
  DEPARTMENT_NOT_RECORDED,
  ROLE_ALIASES,
  ROLE_NO_DESIGNATION,
  ROLE_ORDER,
  statusWeight,
  statusWeightSql,
  resolveBiometricContractor,
  resolveDwContractor,
  componentContractors,
  normalizeDepartment,
  normalizeRole,
  roleRank,
  isValidCompany,
  isTestContractorName,
  departmentsForContractor,
  knownContractorNames,
};
