'use strict';

/**
 * TA/DA Compute Engine — Phase α (auto from attendance) + Phase β (after km/split inputs)
 *
 * PRESERVATION RULES (critical — do not widen):
 * - Phase α re-run preserves ONLY input fields in sales_ta_da_monthly_inputs
 *   (in_city_days, outstation_days, total_km, bike_km, car_km, notes, source, source_detail)
 *   when existing source IN ('upload', 'manual').
 * - Outputs in sales_ta_da_computations are ALWAYS fully recomputed — every snapshot
 *   column re-read from sales_employees + sales_ta_da_monthly_inputs, every amount
 *   re-computed using the current class's formula and current rates.
 * - Only audit-trail metadata (neft_exported_at, neft_exported_by, paid_at) carries
 *   forward across recomputes.
 */

const VALID_CLASSES = new Set([0, 1, 2, 3, 4, 5]);

function round2(n) {
  if (n === null || n === undefined || !Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function num(v) {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function nonNegOrZero(v) {
  const n = num(v);
  if (n === null || n < 0) return 0;
  return n;
}

/**
 * Pure compute. No DB.
 *
 * @param {Object} employee     — { ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary }
 * @param {Object} monthlyInput — { days_worked, in_city_days, outstation_days, total_km, bike_km, car_km }
 * @param {Object} cycle        — { start, end, lengthDays }   (currently only used for forward-compat; not in formula)
 * @param {Object} options      — { } reserved
 * @returns {{ da_local_amount, da_outstation_amount, ta_primary_amount, ta_secondary_amount,
 *            total_da, total_ta, total_payable, status, computation_notes }}
 */
function computeForEmployee(employee, monthlyInput, cycle, options) {
  const cls = num(employee && employee.ta_da_class);
  const daRate = nonNegOrZero(employee && employee.da_rate);
  const daOutRate = nonNegOrZero(employee && employee.da_outstation_rate);
  const taPrimaryRate = nonNegOrZero(employee && employee.ta_rate_primary);
  const taSecondaryRate = nonNegOrZero(employee && employee.ta_rate_secondary);

  const days = nonNegOrZero(monthlyInput && monthlyInput.days_worked);
  const inCity = num(monthlyInput && monthlyInput.in_city_days);
  const outstation = num(monthlyInput && monthlyInput.outstation_days);
  const totalKm = num(monthlyInput && monthlyInput.total_km);
  const bikeKm = num(monthlyInput && monthlyInput.bike_km);
  const carKm = num(monthlyInput && monthlyInput.car_km);

  const zero = {
    da_local_amount: 0,
    da_outstation_amount: 0,
    ta_primary_amount: 0,
    ta_secondary_amount: 0,
    total_da: 0,
    total_ta: 0,
    total_payable: 0,
  };

  // Class 0 — HR review required, never compute amounts.
  if (cls === 0) {
    return Object.assign({}, zero, {
      status: 'flag_for_review',
      computation_notes: 'Class 0: HR review required',
    });
  }

  // Validate class membership.
  if (cls === null || !VALID_CLASSES.has(cls)) {
    return Object.assign({}, zero, {
      status: 'flag_for_review',
      computation_notes: `Invalid or missing TA/DA class (got ${cls})`,
    });
  }

  // No days worked — cannot compute meaningful amounts.
  if (days <= 0) {
    return Object.assign({}, zero, {
      status: 'flag_for_review',
      computation_notes: 'no days worked',
    });
  }

  // Class 1 — DA only, flat rate × days. No β phase.
  if (cls === 1) {
    const daLocal = round2(daRate * days);
    return {
      da_local_amount: daLocal,
      da_outstation_amount: 0,
      ta_primary_amount: 0,
      ta_secondary_amount: 0,
      total_da: daLocal,
      total_ta: 0,
      total_payable: daLocal,
      status: 'computed',
      computation_notes: null,
    };
  }

  // Class 2 — split DA (in-city / outstation). No TA.
  if (cls === 2) {
    const haveSplit = inCity !== null && outstation !== null;
    if (haveSplit) {
      const daLocal = round2(Math.max(0, inCity) * daRate);
      const daOut = round2(Math.max(0, outstation) * daOutRate);
      const totalDa = round2(daLocal + daOut);
      return {
        da_local_amount: daLocal,
        da_outstation_amount: daOut,
        ta_primary_amount: 0,
        ta_secondary_amount: 0,
        total_da: totalDa,
        total_ta: 0,
        total_payable: totalDa,
        status: 'computed',
        computation_notes: null,
      };
    }
    // α fallback: assume all in-city.
    const daLocal = round2(daRate * days);
    return {
      da_local_amount: daLocal,
      da_outstation_amount: 0,
      ta_primary_amount: 0,
      ta_secondary_amount: 0,
      total_da: daLocal,
      total_ta: 0,
      total_payable: daLocal,
      status: 'partial',
      computation_notes: 'DA fallback: all in-city',
    };
  }

  // Class 3 — flat DA × days, TA from total_km × primary rate.
  if (cls === 3) {
    const daLocal = round2(daRate * days);
    if (totalKm !== null) {
      const taPrim = round2(Math.max(0, totalKm) * taPrimaryRate);
      return {
        da_local_amount: daLocal,
        da_outstation_amount: 0,
        ta_primary_amount: taPrim,
        ta_secondary_amount: 0,
        total_da: daLocal,
        total_ta: taPrim,
        total_payable: round2(daLocal + taPrim),
        status: 'computed',
        computation_notes: null,
      };
    }
    return {
      da_local_amount: daLocal,
      da_outstation_amount: 0,
      ta_primary_amount: 0,
      ta_secondary_amount: 0,
      total_da: daLocal,
      total_ta: 0,
      total_payable: daLocal,
      status: 'partial',
      computation_notes: 'TA pending: total_km not provided',
    };
  }

  // Class 4 — split DA + flat TA (total_km × primary).
  if (cls === 4) {
    const haveSplit = inCity !== null && outstation !== null;
    const haveKm = totalKm !== null;

    if (haveSplit && haveKm) {
      const daLocal = round2(Math.max(0, inCity) * daRate);
      const daOut = round2(Math.max(0, outstation) * daOutRate);
      const taPrim = round2(Math.max(0, totalKm) * taPrimaryRate);
      const totalDa = round2(daLocal + daOut);
      return {
        da_local_amount: daLocal,
        da_outstation_amount: daOut,
        ta_primary_amount: taPrim,
        ta_secondary_amount: 0,
        total_da: totalDa,
        total_ta: taPrim,
        total_payable: round2(totalDa + taPrim),
        status: 'computed',
        computation_notes: null,
      };
    }

    // α fallback: DA = flat × days, TA = 0.
    const daLocal = round2(daRate * days);
    const missing = [];
    if (!haveSplit) missing.push('in_city/outstation split');
    if (!haveKm) missing.push('total_km');
    return {
      da_local_amount: daLocal,
      da_outstation_amount: 0,
      ta_primary_amount: 0,
      ta_secondary_amount: 0,
      total_da: daLocal,
      total_ta: 0,
      total_payable: daLocal,
      status: 'partial',
      computation_notes: `DA fallback: all in-city; pending: ${missing.join(', ')}`,
    };
  }

  // Class 5 — split DA + tiered TA (bike × primary + car × secondary).
  if (cls === 5) {
    const haveSplit = inCity !== null && outstation !== null;
    const haveAnyKm = bikeKm !== null || carKm !== null;

    if (haveSplit && haveAnyKm) {
      const daLocal = round2(Math.max(0, inCity) * daRate);
      const daOut = round2(Math.max(0, outstation) * daOutRate);
      const taPrim = round2(Math.max(0, bikeKm || 0) * taPrimaryRate);
      const taSec = round2(Math.max(0, carKm || 0) * taSecondaryRate);
      const totalDa = round2(daLocal + daOut);
      const totalTa = round2(taPrim + taSec);
      return {
        da_local_amount: daLocal,
        da_outstation_amount: daOut,
        ta_primary_amount: taPrim,
        ta_secondary_amount: taSec,
        total_da: totalDa,
        total_ta: totalTa,
        total_payable: round2(totalDa + totalTa),
        status: 'computed',
        computation_notes: null,
      };
    }

    // α fallback: DA = flat × days, TA = 0.
    const daLocal = round2(daRate * days);
    const missing = [];
    if (!haveSplit) missing.push('in_city/outstation split');
    if (!haveAnyKm) missing.push('bike_km/car_km');
    return {
      da_local_amount: daLocal,
      da_outstation_amount: 0,
      ta_primary_amount: 0,
      ta_secondary_amount: 0,
      total_da: daLocal,
      total_ta: 0,
      total_payable: daLocal,
      status: 'partial',
      computation_notes: `DA fallback: all in-city; pending: ${missing.join(', ')}`,
    };
  }

  // Should be unreachable.
  return Object.assign({}, zero, {
    status: 'flag_for_review',
    computation_notes: `Unhandled class ${cls}`,
  });
}

// ── DB-backed orchestration ───────────────────────────────────────────

/**
 * Find the latest matched/computed upload's sheet_days_given for an
 * employee in this (month, year, company). Returns the days as a number,
 * or null if no usable upload row exists.
 */
function readSheetDaysGiven(db, { employeeCode, month, year, company }) {
  const row = db.prepare(`
    SELECT smi.sheet_days_given AS days
    FROM sales_monthly_input smi
    JOIN sales_uploads su ON su.id = smi.upload_id
    WHERE smi.employee_code = ?
      AND smi.month = ?
      AND smi.year = ?
      AND smi.company = ?
      AND su.status IN ('matched','computed')
    ORDER BY su.uploaded_at DESC
    LIMIT 1
  `).get(employeeCode, month, year, company);
  if (!row) return null;
  const n = num(row.days);
  return n === null ? null : n;
}

/**
 * Resolve the days_worked for Phase α:
 *   1. Latest matched/computed upload's sheet_days_given.
 *   2. Existing input row's days_worked (if any).
 *   3. 0 (which will force flag_for_review downstream).
 */
function resolveDaysWorked(db, { employeeCode, month, year, company }, existingInput) {
  const fromUpload = readSheetDaysGiven(db, { employeeCode, month, year, company });
  if (fromUpload !== null) return fromUpload;
  if (existingInput && existingInput.days_worked !== null && existingInput.days_worked !== undefined) {
    const n = num(existingInput.days_worked);
    if (n !== null) return n;
  }
  return 0;
}

/**
 * Read existing input row (or null).
 */
function readExistingInput(db, { employeeId, month, year, company }) {
  return db.prepare(`
    SELECT *
    FROM sales_ta_da_monthly_inputs
    WHERE employee_id = ?
      AND month = ?
      AND year = ?
      AND company = ?
  `).get(employeeId, month, year, company);
}

/**
 * Read existing computation row (or null) — used to preserve audit-trail.
 */
function readExistingComputation(db, { employeeId, month, year, company }) {
  return db.prepare(`
    SELECT neft_exported_at, neft_exported_by, paid_at
    FROM sales_ta_da_computations
    WHERE employee_id = ?
      AND month = ?
      AND year = ?
      AND company = ?
  `).get(employeeId, month, year, company);
}

/**
 * UPSERT the input row according to preservation rules.
 *
 * If existing row exists AND existing.source IN ('upload','manual'):
 *   UPDATE only days_worked, cycle_start_date, cycle_end_date, updated_at, updated_by.
 *   Preserve in_city_days, outstation_days, total_km, bike_km, car_km, notes, source, source_detail.
 *
 * If existing row exists AND existing.source = 'attendance_auto':
 *   Overwrite all fields with fresh α data (source stays 'attendance_auto').
 *
 * If no existing row: INSERT with source='attendance_auto', source_detail='salary_compute_trigger'.
 *
 * Returns the resulting row's input shape used to compute amounts.
 */
function upsertMonthlyInput(db, params, existingInput) {
  const {
    employeeId, employeeCode, month, year, company,
    cycleStart, cycleEnd, daysWorked, computedBy, triggerSource,
  } = params;

  if (existingInput) {
    if (existingInput.source === 'upload' || existingInput.source === 'manual') {
      // Preserve user-provided fields; refresh days_worked + cycle boundaries.
      db.prepare(`
        UPDATE sales_ta_da_monthly_inputs
        SET days_worked = ?,
            cycle_start_date = ?,
            cycle_end_date = ?,
            updated_at = datetime('now'),
            updated_by = ?
        WHERE id = ?
      `).run(daysWorked, cycleStart, cycleEnd, computedBy || null, existingInput.id);

      return {
        days_worked: daysWorked,
        in_city_days: existingInput.in_city_days,
        outstation_days: existingInput.outstation_days,
        total_km: existingInput.total_km,
        bike_km: existingInput.bike_km,
        car_km: existingInput.car_km,
      };
    }

    // source = 'attendance_auto' — overwrite everything (β fields cleared,
    // since α has no knowledge of them).
    db.prepare(`
      UPDATE sales_ta_da_monthly_inputs
      SET days_worked = ?,
          in_city_days = NULL,
          outstation_days = NULL,
          total_km = NULL,
          bike_km = NULL,
          car_km = NULL,
          source = 'attendance_auto',
          source_detail = ?,
          notes = NULL,
          cycle_start_date = ?,
          cycle_end_date = ?,
          updated_at = datetime('now'),
          updated_by = ?
      WHERE id = ?
    `).run(
      daysWorked,
      triggerSource || 'salary_compute_trigger',
      cycleStart,
      cycleEnd,
      computedBy || null,
      existingInput.id
    );

    return {
      days_worked: daysWorked,
      in_city_days: null,
      outstation_days: null,
      total_km: null,
      bike_km: null,
      car_km: null,
    };
  }

  // No existing row — INSERT fresh attendance_auto row.
  db.prepare(`
    INSERT INTO sales_ta_da_monthly_inputs (
      employee_id, employee_code, month, year, company,
      cycle_start_date, cycle_end_date,
      days_worked, in_city_days, outstation_days, total_km, bike_km, car_km,
      source, source_detail, notes,
      created_at, created_by, updated_at, updated_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL,
              'attendance_auto', ?, NULL,
              datetime('now'), ?, datetime('now'), ?)
  `).run(
    employeeId, employeeCode, month, year, company,
    cycleStart, cycleEnd,
    daysWorked,
    triggerSource || 'salary_compute_trigger',
    computedBy || null,
    computedBy || null
  );

  return {
    days_worked: daysWorked,
    in_city_days: null,
    outstation_days: null,
    total_km: null,
    bike_km: null,
    car_km: null,
  };
}

/**
 * INSERT OR REPLACE the computation row. Preserves audit-trail fields
 * (neft_exported_at, neft_exported_by, paid_at) from existing row when present.
 */
function upsertComputation(db, params, employee, finalInput, result, existingComp) {
  const {
    employeeId, employeeCode, month, year, company,
    cycleStart, cycleEnd, computedBy,
  } = params;

  const neftAt = existingComp ? (existingComp.neft_exported_at || null) : null;
  const neftBy = existingComp ? (existingComp.neft_exported_by || null) : null;
  const paidAt = existingComp ? (existingComp.paid_at || null) : null;

  db.prepare(`
    INSERT INTO sales_ta_da_computations (
      employee_id, employee_code, month, year, company,
      cycle_start_date, cycle_end_date,
      ta_da_class_at_compute,
      da_rate_at_compute, da_outstation_rate_at_compute,
      ta_rate_primary_at_compute, ta_rate_secondary_at_compute,
      days_worked_at_compute,
      in_city_days_at_compute, outstation_days_at_compute,
      total_km_at_compute, bike_km_at_compute, car_km_at_compute,
      da_local_amount, da_outstation_amount,
      ta_primary_amount, ta_secondary_amount,
      total_da, total_ta, total_payable,
      status, computation_notes,
      computed_at, computed_by,
      neft_exported_at, neft_exported_by, paid_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
              ?, ?, ?, ?, ?, ?, ?, ?, ?,
              datetime('now'), ?, ?, ?, ?)
    ON CONFLICT(employee_id, month, year, company) DO UPDATE SET
      cycle_start_date              = excluded.cycle_start_date,
      cycle_end_date                = excluded.cycle_end_date,
      ta_da_class_at_compute        = excluded.ta_da_class_at_compute,
      da_rate_at_compute            = excluded.da_rate_at_compute,
      da_outstation_rate_at_compute = excluded.da_outstation_rate_at_compute,
      ta_rate_primary_at_compute    = excluded.ta_rate_primary_at_compute,
      ta_rate_secondary_at_compute  = excluded.ta_rate_secondary_at_compute,
      days_worked_at_compute        = excluded.days_worked_at_compute,
      in_city_days_at_compute       = excluded.in_city_days_at_compute,
      outstation_days_at_compute    = excluded.outstation_days_at_compute,
      total_km_at_compute           = excluded.total_km_at_compute,
      bike_km_at_compute            = excluded.bike_km_at_compute,
      car_km_at_compute             = excluded.car_km_at_compute,
      da_local_amount               = excluded.da_local_amount,
      da_outstation_amount          = excluded.da_outstation_amount,
      ta_primary_amount             = excluded.ta_primary_amount,
      ta_secondary_amount           = excluded.ta_secondary_amount,
      total_da                      = excluded.total_da,
      total_ta                      = excluded.total_ta,
      total_payable                 = excluded.total_payable,
      status                        = excluded.status,
      computation_notes             = excluded.computation_notes,
      computed_at                   = datetime('now'),
      computed_by                   = excluded.computed_by,
      neft_exported_at              = excluded.neft_exported_at,
      neft_exported_by              = excluded.neft_exported_by,
      paid_at                       = excluded.paid_at
  `).run(
    employeeId, employeeCode, month, year, company,
    cycleStart, cycleEnd,
    num(employee.ta_da_class),
    num(employee.da_rate), num(employee.da_outstation_rate),
    num(employee.ta_rate_primary), num(employee.ta_rate_secondary),
    finalInput.days_worked,
    finalInput.in_city_days, finalInput.outstation_days,
    finalInput.total_km, finalInput.bike_km, finalInput.car_km,
    result.da_local_amount, result.da_outstation_amount,
    result.ta_primary_amount, result.ta_secondary_amount,
    result.total_da, result.total_ta, result.total_payable,
    result.status, result.computation_notes,
    computedBy || null,
    neftAt, neftBy, paidAt
  );
}

/**
 * Recompute one employee end-to-end. Wraps input UPSERT + computation UPSERT
 * in a single per-employee transaction so partial failure does not leave
 * an inconsistent (input, output) pair.
 *
 * @returns {{ status: string, error?: string }}
 */
function recomputeOneEmployee(db, params) {
  const {
    month, year, company, cycleStart, cycleEnd,
    computedBy, triggerSource, employeeCode,
  } = params;

  // Resolve employee.
  const employee = db.prepare(`
    SELECT id, code, name, status,
           ta_da_class, da_rate, da_outstation_rate,
           ta_rate_primary, ta_rate_secondary
    FROM sales_employees
    WHERE code = ? AND company = ?
  `).get(employeeCode, company);

  if (!employee) {
    return { status: 'error', error: 'employee not found' };
  }

  const txn = db.transaction(() => {
    const existingInput = readExistingInput(db, {
      employeeId: employee.id, month, year, company,
    });

    const daysWorked = resolveDaysWorked(
      db,
      { employeeCode: employee.code, month, year, company },
      existingInput
    );

    const finalInput = upsertMonthlyInput(db, {
      employeeId: employee.id, employeeCode: employee.code,
      month, year, company, cycleStart, cycleEnd,
      daysWorked, computedBy, triggerSource,
    }, existingInput);

    const result = computeForEmployee(
      employee,
      finalInput,
      { start: cycleStart, end: cycleEnd },
      {}
    );

    const existingComp = readExistingComputation(db, {
      employeeId: employee.id, month, year, company,
    });

    upsertComputation(db, {
      employeeId: employee.id, employeeCode: employee.code,
      month, year, company, cycleStart, cycleEnd, computedBy,
    }, employee, finalInput, result, existingComp);

    return result;
  });

  try {
    const r = txn();
    return { status: r.status };
  } catch (e) {
    return { status: 'error', error: e && e.message ? e.message : String(e) };
  }
}

/**
 * Recompute the whole cycle (or a single employee when employeeCode is supplied).
 *
 * @param {Object} db
 * @param {Object} params  { month, year, company, cycleStart, cycleEnd,
 *                           computedBy, requestId, triggerSource, employeeCode? }
 * @returns {{ computed:number, partial:number, flagged:number, errors:Array<{employeeCode,error}> }}
 */
function recomputeCycle(db, params) {
  const {
    month, year, company, cycleStart, cycleEnd,
    computedBy, triggerSource, employeeCode,
  } = params || {};

  if (!month || !year || !company || !cycleStart || !cycleEnd) {
    throw new Error('recomputeCycle: month, year, company, cycleStart, cycleEnd are required');
  }

  let codes;
  if (employeeCode) {
    codes = [employeeCode];
  } else {
    const rows = db.prepare(`
      SELECT code FROM sales_employees
      WHERE company = ? AND status = 'Active'
      ORDER BY code
    `).all(company);
    codes = rows.map(r => r.code);
  }

  const summary = { computed: 0, partial: 0, flagged: 0, errors: [] };

  for (const code of codes) {
    const r = recomputeOneEmployee(db, {
      month, year, company, cycleStart, cycleEnd,
      computedBy, triggerSource, employeeCode: code,
    });
    if (r.status === 'computed') summary.computed++;
    else if (r.status === 'partial') summary.partial++;
    else if (r.status === 'flag_for_review') summary.flagged++;
    else if (r.status === 'error') summary.errors.push({ employeeCode: code, error: r.error });
  }

  return summary;
}

/**
 * Read-only snapshot of a single employee's TA/DA data for a cycle.
 *
 * @returns {{ employee, input, computation }}  — any of the three may be null.
 */
function getComputation(db, { employeeCode, month, year, company }) {
  if (!employeeCode || !month || !year || !company) {
    throw new Error('getComputation: employeeCode, month, year, company are required');
  }

  const employee = db.prepare(`
    SELECT id, code, name, company, status,
           ta_da_class, da_rate, da_outstation_rate,
           ta_rate_primary, ta_rate_secondary, ta_da_notes,
           ta_da_updated_at, ta_da_updated_by
    FROM sales_employees
    WHERE code = ? AND company = ?
  `).get(employeeCode, company);

  if (!employee) {
    return { employee: null, input: null, computation: null };
  }

  const input = db.prepare(`
    SELECT * FROM sales_ta_da_monthly_inputs
    WHERE employee_id = ? AND month = ? AND year = ? AND company = ?
  `).get(employee.id, month, year, company) || null;

  const computation = db.prepare(`
    SELECT * FROM sales_ta_da_computations
    WHERE employee_id = ? AND month = ? AND year = ? AND company = ?
  `).get(employee.id, month, year, company) || null;

  return { employee, input, computation };
}

module.exports = {
  computeForEmployee,
  recomputeCycle,
  getComputation,
};
