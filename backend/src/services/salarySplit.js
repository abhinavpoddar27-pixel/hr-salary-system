/**
 * Salary split helpers (moved verbatim from routes/employees.js, P5-04 ruling Q-B7).
 * Used by PUT /employees/:code/salary (single path) and the bulk salary revision kind,
 * so a revision builds exactly the structure the single path would request.
 */

// The split Stage 7 auto-creates for an employee with no structure (salaryComputation.js).
const DEFAULT_SPLIT = { basic_percent: 50, hra_percent: 20, da_percent: 0, special_allowance: 0, other_allowances: 0, pf_wage_ceiling: 15000 };

/**
 * N-19: read one split field. Missing / blank → `fallback` (the stored value).
 * 0 is a real value (the old `parseFloat(x) || 50` turned an explicit 0 into 50).
 * N-PF-LOWS (ruling Q2): a value that is present but not a number ('abc',
 * '15,000', {}) is NOT silently replaced by the stored value any more — it
 * returns NaN, and resolveSplit turns that into 400 NOT_A_NUMBER.
 */
function readSplitNum(body, key, fallback) {
  const v = body[key];
  if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) return fallback;
  if (typeof v !== 'number' && typeof v !== 'string') return NaN;
  const n = typeof v === 'number' ? v : Number(String(v).trim());
  return Number.isFinite(n) ? n : NaN;
}

// N-PF-LOWS (rulings Q1, Q3): a per-employee PF wage ceiling must be more than
// ₹0 and at most this. PF is switched off by the statutory flag, never by a 0 ceiling.
const PF_CEILING_MAX = 100000;

const FIELD_LABELS = {
  basic_percent: 'Basic %', hra_percent: 'HRA %', da_percent: 'DA %',
  special_allowance_percent: 'Special allowance %', other_allowance: 'Other allowance',
  pf_wage_ceiling: 'PF wage ceiling', gross_salary: 'Gross salary',
};
const notANumber = (field) => ({ error: `${FIELD_LABELS[field] || field} must be a number`, code: 'NOT_A_NUMBER', field });
const ceilingOutOfRange = () => ({
  error: `PF wage ceiling must be more than ₹0 and at most ₹${PF_CEILING_MAX.toLocaleString('en-IN')}`,
  code: 'SPLIT_OUT_OF_RANGE', field: 'pf_wage_ceiling',
});
const ceilingInRange = (n) => Number.isFinite(n) && n > 0 && n <= PF_CEILING_MAX;

const numOr = (v, d) => (v === undefined || v === null || !Number.isFinite(Number(v)) ? d : Number(v));

/** The split stored on a structure row (or the Stage 7 default when there is none). */
function storedSplit(struct) {
  const s = struct || DEFAULT_SPLIT;
  const sGross = Number(s.gross_salary) || 0;
  return {
    basicPct: numOr(s.basic_percent, 50),
    hraPct: numOr(s.hra_percent, 20),
    daPct: numOr(s.da_percent, 0),
    specialPct: sGross > 0 ? (Number(s.special_allowance) || 0) / sGross * 100 : 0,
    other: numOr(s.other_allowances, 0),
    pfCeiling: numOr(s.pf_wage_ceiling, 15000),
  };
}

/**
 * The split the window asks for; a field left out keeps the stored value.
 * Returns { split } or { error, code, field } (NOT_A_NUMBER / SPLIT_OUT_OF_RANGE).
 */
function resolveSplit(body, stored) {
  const keys = [
    ['basicPct', 'basic_percent'], ['hraPct', 'hra_percent'], ['daPct', 'da_percent'],
    ['specialPct', 'special_allowance_percent'], ['other', 'other_allowance'], ['pfCeiling', 'pf_wage_ceiling'],
  ];
  const split = {};
  for (const [k, field] of keys) {
    split[k] = readSplitNum(body, field, stored[k]);
    if (Number.isNaN(split[k])) return notANumber(field);
  }
  for (const k of ['basicPct', 'hraPct', 'daPct', 'specialPct']) {
    if (split[k] < 0 || split[k] > 100) return { error: 'Salary split percentages must be between 0 and 100', code: 'SPLIT_OUT_OF_RANGE', field: k };
  }
  if (split.other < 0) return { error: 'Other allowance and PF wage ceiling cannot be negative', code: 'SPLIT_OUT_OF_RANGE', field: 'other_allowance' };
  if (split.pfCeiling < 0) return { error: 'Other allowance and PF wage ceiling cannot be negative', code: 'SPLIT_OUT_OF_RANGE', field: 'pf_wage_ceiling' };
  // Q1/Q3: only a ceiling the caller SENT is range-checked; a stored value
  // outside the range (none in production) does not block an unrelated save.
  if (!isBlank(body.pf_wage_ceiling) && !ceilingInRange(split.pfCeiling)) return ceilingOutOfRange();
  return { split };
}

const isBlank = (v) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

/** Is the requested split (incl. ceiling) the stored one? Used when no gross is given. */
function splitDiffers(stored, split) {
  const far = (a, b) => Math.abs((Number(a) || 0) - (Number(b) || 0)) > 0.01;
  return ['basicPct', 'hraPct', 'daPct', 'specialPct', 'other', 'pfCeiling'].some((k) => far(split[k], stored[k]));
}

/**
 * N-PF-LOWS (Salary Input request-change, ruling Q8 batch): the same number rules
 * for a free-form new_structure. Components + gross: a number ≥ 0 when present;
 * percents 0–100; ceiling > 0 and ≤ PF_CEILING_MAX. null = fine.
 */
function checkRequestStructure(ns) {
  const s = ns || {};
  const num = (v) => (typeof v === 'number' ? v : (typeof v === 'string' ? Number(v.trim()) : NaN));
  const LABEL = { basic: 'Basic', da: 'DA', hra: 'HRA', conveyance: 'Conveyance', special_allowance: 'Special allowance',
    other_allowances: 'Other allowances', gross_salary: 'Gross salary' };
  for (const k of Object.keys(LABEL)) {
    if (isBlank(s[k])) continue;
    const n = num(s[k]);
    if (!Number.isFinite(n)) return { error: `${LABEL[k]} must be a number`, code: 'NOT_A_NUMBER', field: k };
    if (n < 0) return { error: `${LABEL[k]} cannot be negative`, code: 'SPLIT_OUT_OF_RANGE', field: k };
  }
  for (const k of ['basic_percent', 'hra_percent', 'da_percent']) {
    if (isBlank(s[k])) continue;
    const n = num(s[k]);
    if (!Number.isFinite(n)) return notANumber(k);
    if (n < 0 || n > 100) return { error: 'Salary split percentages must be between 0 and 100', code: 'SPLIT_OUT_OF_RANGE', field: k };
  }
  if (!isBlank(s.pf_wage_ceiling)) {
    const n = num(s.pf_wage_ceiling);
    if (!Number.isFinite(n)) return notANumber('pf_wage_ceiling');
    if (!ceilingInRange(n)) return ceilingOutOfRange();
  }
  return null;
}

const r2 = (x) => Math.round(x * 100) / 100;

/** Component amounts the split gives at a gross (same formulas as before N-19). */
function splitAmounts(gross, split) {
  return {
    basic: r2(gross * split.basicPct / 100),
    da: r2(gross * split.daPct / 100),
    hra: r2(gross * split.hraPct / 100),
    special_allowance: r2(gross * split.specialPct / 100),
    other_allowances: split.other,
  };
}

/**
 * P1-14 (Q2) / N-19: is the requested split the one already stored? Same gross,
 * same percentages, same special + other amounts. PF wage ceiling is not part of
 * the split (N-PF: its change is checked on its own, also by approval). A field left out counts as unchanged.
 */
function splitUnchanged(struct, newGross, split) {
  const near = (a, b) => Math.abs((Number(a) || 0) - (Number(b) || 0)) <= 0.01;
  const s = struct || { ...DEFAULT_SPLIT, gross_salary: newGross };
  if (!near(s.gross_salary, newGross)) return false;
  if (!near(split.basicPct, numOr(s.basic_percent, 50))) return false;
  if (!near(split.hraPct, numOr(s.hra_percent, 20))) return false;
  if (!near(split.daPct, numOr(s.da_percent, 0))) return false;
  if (!near(r2(newGross * split.specialPct / 100), s.special_allowance)) return false;
  if (!near(split.other, s.other_allowances)) return false;
  return true;
}

/**
 * P5-04: the new_structure a gross change from Employee Master requests (same object as
 * raiseRequest in PUT /employees/:code/salary): the stored split re-applied to the new gross.
 * `struct` = the latest structure row (null → the Stage 7 default split).
 */
function buildRevisionStructure(struct, gross, ptValue) {
  const split = storedSplit(struct);
  return {
    gross_salary: gross,
    ...splitAmounts(gross, split),
    basic_percent: split.basicPct,
    hra_percent: split.hraPct,
    da_percent: split.daPct,
    pt_applicable: ptValue,
    pf_wage_ceiling: split.pfCeiling,
  };
}

module.exports = {
  DEFAULT_SPLIT, readSplitNum, numOr, storedSplit, resolveSplit, r2, splitAmounts, splitUnchanged, buildRevisionStructure,
  PF_CEILING_MAX, ceilingInRange, splitDiffers, checkRequestStructure, isBlank,
};
