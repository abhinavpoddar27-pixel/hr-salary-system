/**
 * Salary split helpers (moved verbatim from routes/employees.js, P5-04 ruling Q-B7).
 * Used by PUT /employees/:code/salary (single path) and the bulk salary revision kind,
 * so a revision builds exactly the structure the single path would request.
 */

// The split Stage 7 auto-creates for an employee with no structure (salaryComputation.js).
const DEFAULT_SPLIT = { basic_percent: 50, hra_percent: 20, da_percent: 0, special_allowance: 0, other_allowances: 0, pf_wage_ceiling: 15000 };

/**
 * N-19: read one split field. Missing / blank / unreadable → `fallback` (the
 * stored value). 0 is a real value (the old `parseFloat(x) || 50` turned an
 * explicit 0 into 50).
 */
function readSplitNum(body, key, fallback) {
  const v = body[key];
  if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) return fallback;
  const n = typeof v === 'number' ? v : Number(String(v).trim());
  return Number.isFinite(n) ? n : fallback;
}

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

/** The split the window asks for; a field left out keeps the stored value. null + error when out of range. */
function resolveSplit(body, stored) {
  const split = {
    basicPct: readSplitNum(body, 'basic_percent', stored.basicPct),
    hraPct: readSplitNum(body, 'hra_percent', stored.hraPct),
    daPct: readSplitNum(body, 'da_percent', stored.daPct),
    specialPct: readSplitNum(body, 'special_allowance_percent', stored.specialPct),
    other: readSplitNum(body, 'other_allowance', stored.other),
    pfCeiling: readSplitNum(body, 'pf_wage_ceiling', stored.pfCeiling),
  };
  for (const k of ['basicPct', 'hraPct', 'daPct', 'specialPct']) {
    if (split[k] < 0 || split[k] > 100) return { error: 'Salary split percentages must be between 0 and 100' };
  }
  if (split.other < 0 || split.pfCeiling < 0) return { error: 'Other allowance and PF wage ceiling cannot be negative' };
  return { split };
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
};
