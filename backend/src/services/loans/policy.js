/**
 * Loans engine — policy reader (Loans PR-2, docs/loans/SPEC.md §4).
 *
 * Reads the 16 `loan_*` keys PR-1 seeded into policy_config. The admin edits
 * them from the Loan settings screen (PR-4), so nothing here is hard-coded
 * except the SPEC §4 defaults used when a value is missing, unparseable or out
 * of range. A fallback never throws: it is reported in `warnings[]` so the
 * settings screen and the logs can show it.
 */

/** The loan type that gets the higher (3×) amount limit (D-24). */
const EMERGENCY_LOAN_TYPE = 'Emergency / medical';

/** The two companies a loan may belong to (K7). Same strings as salaryComputation.js CANONICAL_COMPANIES. */
const VALID_COMPANIES = Object.freeze(['Indriyan Beverages Pvt Ltd', 'Asian Lakto Ind Ltd']);

const DEFAULTS = Object.freeze({
  closeDay: 13,
  deductionCapPct: 50,
  maxMultipleGross: 2,
  maxMultipleGrossEmergency: 3,
  maxTenureMonths: 12,
  minServiceMonths: 6,
  maxActivePerPerson: 1,
  emiCeilingPctGross: 30,
  deductionLoadWarningPct: 30,
  heldEmiWaitDays: 60,
  maxShortfallExtensionMonths: 3,
  eligibleEmploymentTypes: Object.freeze(['Permanent', 'SILP', 'Worker', 'Sales']),
  loanTypes: Object.freeze(['Personal', 'Emergency / medical', 'Festival advance', 'Education']),
  agreementRequired: true,
  interestRate: 0,
  perquisiteThreshold: 20000,
});

// key → [field, parser, validator]
const num = (v) => { const n = Number(String(v).trim()); return Number.isFinite(n) ? n : undefined; };
const int = (v) => { const n = num(v); return Number.isInteger(n) ? n : undefined; };
const strList = (v) => {
  try {
    const a = JSON.parse(v);
    if (Array.isArray(a) && a.length > 0 && a.every((s) => typeof s === 'string' && s.trim())) return a.map((s) => s.trim());
  } catch (e) { /* fall through */ }
  return undefined;
};
const bool = (v) => {
  const s = String(v).trim().toLowerCase();
  if (['true', '1', 'yes'].includes(s)) return true;
  if (['false', '0', 'no'].includes(s)) return false;
  return undefined;
};

const KEYS = [
  ['loan_close_day', 'closeDay', int, (n) => n >= 1 && n <= 28],
  ['loan_deduction_cap_pct', 'deductionCapPct', num, (n) => n > 0 && n <= 100],
  ['loan_max_multiple_gross', 'maxMultipleGross', num, (n) => n > 0],
  ['loan_max_multiple_gross_emergency', 'maxMultipleGrossEmergency', num, (n) => n > 0],
  ['loan_max_tenure_months', 'maxTenureMonths', int, (n) => n >= 1 && n <= 120],
  ['loan_min_service_months', 'minServiceMonths', int, (n) => n >= 0],
  ['loan_max_active_per_person', 'maxActivePerPerson', int, (n) => n >= 1],
  ['loan_emi_ceiling_pct_gross', 'emiCeilingPctGross', num, (n) => n > 0 && n <= 100],
  ['loan_deduction_load_warning_pct', 'deductionLoadWarningPct', num, (n) => n > 0 && n <= 100],
  ['loan_held_emi_wait_days', 'heldEmiWaitDays', int, (n) => n >= 0],
  ['loan_max_shortfall_extension_months', 'maxShortfallExtensionMonths', int, (n) => n >= 0],
  ['loan_eligible_employment_types', 'eligibleEmploymentTypes', strList, () => true],
  ['loan_types', 'loanTypes', strList, () => true],
  ['loan_agreement_required', 'agreementRequired', bool, () => true],
  ['loan_interest_rate', 'interestRate', num, (n) => n >= 0],
  ['loan_perquisite_threshold', 'perquisiteThreshold', num, (n) => n >= 0],
];

/**
 * @returns {object} typed policy + `warnings: string[]`
 */
function readLoanPolicy(db) {
  const rows = db.prepare("SELECT key, value FROM policy_config WHERE key LIKE 'loan%'").all();
  const raw = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const policy = { warnings: [] };
  for (const [key, field, parse, valid] of KEYS) {
    const def = DEFAULTS[field];
    if (!(key in raw) || raw[key] === null) {
      policy[field] = Array.isArray(def) ? [...def] : def;
      policy.warnings.push(`${key} missing — using default ${JSON.stringify(def)}`);
      continue;
    }
    const v = parse(raw[key]);
    if (v === undefined || !valid(v)) {
      policy[field] = Array.isArray(def) ? [...def] : def;
      policy.warnings.push(`${key} = ${JSON.stringify(raw[key])} is invalid — using default ${JSON.stringify(def)}`);
      continue;
    }
    policy[field] = v;
  }
  if (policy.interestRate !== 0) {
    // D-2: interest-free only in v1. The value is recorded but never applied.
    policy.warnings.push(`loan_interest_rate = ${policy.interestRate} ignored — loans are interest-free in v1 (D-2)`);
    policy.interestRate = 0;
  }
  if (!policy.loanTypes.includes(EMERGENCY_LOAN_TYPE)) {
    policy.warnings.push(`loan_types does not contain "${EMERGENCY_LOAN_TYPE}" — the emergency limit cannot apply`);
  }
  return policy;
}

module.exports = { readLoanPolicy, DEFAULTS, EMERGENCY_LOAN_TYPE, VALID_COMPANIES };
