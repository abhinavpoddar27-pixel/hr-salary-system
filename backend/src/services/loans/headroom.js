/**
 * Loans engine — deduction headroom (Loans PR-2, docs/loans/SPEC.md D-11, D-12, §5.2 r4/r7).
 *
 * The loan EMI is the LAST deduction (D-12) and takes only the room left under
 * the cap after everything else: cap% × earned base − prior deductions.
 *
 * ┌─ ONE PLACE ───────────────────────────────────────────────────────────────┐
 * │ What "earned base" means is defined ONLY in EARNED_BASE_DEFINITION below, │
 * │ and read only through earnedBase(). The labour consultant may redefine   │
 * │ what the 50% cap is measured on (SPEC §12 Q1); when that happens, change │
 * │ this table and nothing else. Default (coordinator ruling 13, 9 Oct 2026): │
 * │ plant = gross_earned (= basic + DA + HRA + conveyance + other, earned —   │
 * │ plant gross_earned already EXCLUDES ot_pay and holiday_duty_pay, see      │
 * │ salaryComputation.js "GROSS EARNED = BASE SALARY ONLY"; Loans PR-5 fixed  │
 * │ the PR-2 version that subtracted them a second time); sales =             │
 * │ gross_earned (OT, incentive and Diwali sit outside it). The sales mapping │
 * │ is provisional until PR-8.                                                │
 * └───────────────────────────────────────────────────────────────────────────┘
 */
const { toPaise } = require('./money');

const EARNED_BASE_DEFINITION = Object.freeze({
  plant: Object.freeze({ base: 'gross_earned', minus: Object.freeze([]) }),
  sales: Object.freeze({ base: 'gross_earned', minus: Object.freeze([]) }),
});

/** Every deduction that ranks above the loan (D-12) — i.e. every component except loan_recovery. */
const PRIOR_DEDUCTION_COMPONENTS = Object.freeze({
  plant: Object.freeze(['pf_employee', 'esi_employee', 'professional_tax', 'tds', 'advance_recovery',
    'lop_deduction', 'other_deductions', 'late_coming_deduction', 'early_exit_deduction']),
  sales: Object.freeze(['pf_employee', 'esi_employee', 'professional_tax', 'tds', 'advance_recovery',
    'diwali_recovery', 'other_deductions']),
});

const p = (v) => { const x = toPaise(v || 0); return Number.isFinite(x) ? x : 0; };

/** Earned base pay (paise) of one salary row, per EARNED_BASE_DEFINITION. */
function earnedBase(row, payroll = 'plant') {
  const def = EARNED_BASE_DEFINITION[payroll];
  if (!def) throw new Error(`earnedBase: unknown payroll ${payroll}`);
  let v = p(row[def.base]);
  for (const c of def.minus) v -= p(row[c]);
  return Math.max(0, v);
}

/** Deductions ranking above the loan (paise) of one salary row. */
function priorDeductions(row, payroll = 'plant') {
  const cols = PRIOR_DEDUCTION_COMPONENTS[payroll];
  if (!cols) throw new Error(`priorDeductions: unknown payroll ${payroll}`);
  return cols.reduce((s, c) => s + p(row[c]), 0);
}

/**
 * Room left for the loan, in paise, never negative and never above the cap:
 * floor(capPct% × earnedBase) − priorDeductions.
 */
function computeHeadroom({ earnedBasePaise, capPct, priorDeductionsPaise }) {
  const cap = Math.floor((Math.max(0, earnedBasePaise) * capPct) / 100);
  return Math.max(0, cap - Math.max(0, priorDeductionsPaise));
}

/**
 * What the loan step deducts this month.
 * - Nothing posted yet: deduct = min(due, headroom); shortfall = due − deduct
 *   (the close turns the shortfall into a new last instalment).
 * - Already posted for this month (K2): the amount is frozen — deduct exactly
 *   the posted amount; `unborne` = the part the current headroom can no longer
 *   carry (PR-6 moves it to a new last instalment via an opposite entry).
 */
function planLoanDeduction({ duePaise, headroomPaise, postedPaise = null }) {
  const room = Math.max(0, headroomPaise);
  if (postedPaise !== null && postedPaise !== undefined) {
    return { deductPaise: postedPaise, shortfallPaise: 0, unbornePaise: Math.max(0, postedPaise - room), frozen: true };
  }
  const due = Math.max(0, duePaise);
  const deduct = Math.min(due, room);
  return { deductPaise: deduct, shortfallPaise: due - deduct, unbornePaise: 0, frozen: false };
}

module.exports = {
  EARNED_BASE_DEFINITION, PRIOR_DEDUCTION_COMPONENTS,
  earnedBase, priorDeductions, computeHeadroom, planLoanDeduction,
};
