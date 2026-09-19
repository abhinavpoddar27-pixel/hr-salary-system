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

// ─── Payroll's own day weights (2.1) ──────────────────────────────────────
// What STAGE 6 counts a day as, mirroring dayCalculation.js's main loop
// (`daysPresent`/`daysWOP`/`daysHalfPresent`, lines 263-266) and its
// countWorkingDays helper. It differs from PRESENT_WEIGHTS above by ONE entry:
// payroll also pays 'HP' as half a day. PRESENT_WEIGHTS is left exactly as it
// was — it defines what this report calls a head, which is a PR-2 ruling.
//
// Used only to weigh payroll's side of a pending-correction difference. Weighing
// an HP with PRESENT_WEIGHTS there would score it 0 against payroll's 0.5 and
// manufacture the very false mismatch the payroll rule was imported to remove.
// Production carries 2 HP rows in the contract population today, so this is a
// guard against a real status, not a hypothetical one.
const PAYROLL_PRESENT_WEIGHTS = { P: 1, WOP: 1, '½P': 0.5, HP: 0.5, 'WO½P': 0.5 };

/** Weight of a status as STAGE 6 counts it. Unknown statuses weigh 0. */
function payrollStatusWeight(status) {
  const key = String(status == null ? '' : status).trim();
  return Object.prototype.hasOwnProperty.call(PAYROLL_PRESENT_WEIGHTS, key)
    ? PAYROLL_PRESENT_WEIGHTS[key]
    : 0;
}

// ─── Who is still on the roster (2.1) ─────────────────────────────────────
// "Active" means the status says Active, OR nothing is recorded at all. A blank
// status is treated as active everywhere else in this codebase (analytics.js,
// recompute.js both read `status IS NULL OR status = 'Active'`), and treating it
// as "left" would silently delete those people from the grid along with the
// absence pattern the worked/no-punch split exists to show.
const ACTIVE_STATUS = 'Active';

/** SQL predicate for "still on the roster", for a given table alias. */
function activeClause(alias) {
  return `(TRIM(COALESCE(${alias}.status,'')) = '' OR TRIM(COALESCE(${alias}.status,'')) = '${ACTIVE_STATUS}')`;
}

/** The JS counterpart of activeClause, for a row already fetched. */
function isActiveStatus(status) {
  const v = String(status == null ? '' : status).trim();
  return v === '' || v === ACTIVE_STATUS;
}

// ─── Roster staleness (2.1) ───────────────────────────────────────────────
// "Active on roster, no punch for 30+ days" flags people payroll still treats
// as employed who have stopped showing up. STRICTLY more than 30 days since
// the last day of weight > 0 — a worker last seen exactly 30 days ago is not
// flagged. Verified on production 19 Sep 2026: > 30 gives 231 people (7 of
// whom never punched at all), >= 30 would give 240.
//
// Deliberately measured against today, not the selected month: a roster that
// has gone stale does not become fresh because you paged back to April.
const STALE_NO_PUNCH_DAYS = 30;

// ─── Payroll's own status rule (2.1) ──────────────────────────────────────
// The report reads status_final. Stage 6 does NOT: dayCalculation.js's
// effectiveStatusForDay() ignores an HR miss-punch resolution until finance
// approves it. The two views therefore disagree on exactly the rows where a
// correction is still awaiting finance, and every one of those showed up as a
// false "biometric days don't match payroll days" mismatch.
//
// That function is exported and pure, so the service IMPORTS it rather than
// mirroring the rule here — see docs/progress/contractor-report-2-1.md
// RULING 2. Nothing in this file duplicates it.
//
// The one thing this file owns is which finance states let us skip a row
// without looking at it. ONLY 'approved': on approval effectiveStatusForDay
// returns status_final, which is exactly what this report shows, so the two
// views cannot differ. 'rejected' is NOT in this list — it forces ½P, which
// can and does differ from status_final, and dropping it would hide a real
// divergence. 'pending', '' and NULL fall back to status_original.
const FINANCE_STATES_MATCHING_REPORT = ['approved'];

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

/**
 * dw_contractors.contractor_name → { name, unmapped }. Never returns empty.
 *
 * Falls back to the BIOMETRIC map on a miss. Without that fallback a gate
 * contractor named exactly like a biometric department — plain "MEERA",
 * "SAJAN", "AMAR" — would resolve to its own raw name while the biometric gang
 * resolves to "Meera"/"Sajan"/"Amar". They would land in two different cells and
 * the same gang being paid twice on one day would NOT raise a both-source flag,
 * which is the single thing this report exists to catch.
 */
function resolveDwContractor(contractorName) {
  const key = up(contractorName);
  if (DW_CONTRACTOR_ALIASES[key]) {
    return { name: DW_CONTRACTOR_ALIASES[key], unmapped: false };
  }
  if (BIOMETRIC_CONTRACTOR_ALIASES[key]) {
    return { name: BIOMETRIC_CONTRACTOR_ALIASES[key], unmapped: false };
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
  // A combined daily-wage record covers several gangs, so its grid must show
  // every component gang's people. Without this expansion the grid for
  // "Sajan + Jiwan Lal (12-h)" comes back empty and its footer reports
  // bothSource = false on the very day the Exceptions tab flags for double pay.
  const names = componentContractors(displayName);
  const mapped = Object.entries(BIOMETRIC_CONTRACTOR_ALIASES)
    .filter(([, name]) => names.includes(name))
    .map(([dept]) => dept);
  return mapped.length ? mapped : names.map(up);
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
  STALE_NO_PUNCH_DAYS,
  FINANCE_STATES_MATCHING_REPORT,
  PAYROLL_PRESENT_WEIGHTS,
  payrollStatusWeight,
  ACTIVE_STATUS,
  activeClause,
  isActiveStatus,
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
