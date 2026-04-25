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

'use strict';

const VALID_CLASSES = new Set([0, 1, 2, 3, 4, 5]);

function round2(n) {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function num(v, fallback = 0) {
  if (v === null || v === undefined) return fallback;
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

function nz(v) {
  // null/undefined → null; numeric → number; otherwise → null
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

// ── PURE: per-employee formula evaluation ─────────────────────────────────
function computeForEmployee(employee, monthlyInput, cycle, options = {}) {
  const cls = Number.isFinite(employee && employee.ta_da_class)
    ? Number(employee.ta_da_class)
    : null;

  const daRate = num(employee && employee.da_rate, 0);
  const daOutRate = num(employee && employee.da_outstation_rate, 0);
  const taPrim = num(employee && employee.ta_rate_primary, 0);
  const taSec = num(employee && employee.ta_rate_secondary, 0);

  const daysWorked = num(monthlyInput && monthlyInput.days_worked, 0);
  const inCity = nz(monthlyInput && monthlyInput.in_city_days);
  const outstation = nz(monthlyInput && monthlyInput.outstation_days);
  const totalKm = nz(monthlyInput && monthlyInput.total_km);
  const bikeKm = nz(monthlyInput && monthlyInput.bike_km);
  const carKm = nz(monthlyInput && monthlyInput.car_km);

  // Universal validation: zero/negative days → flag_for_review
  if (!(daysWorked > 0)) {
    return {
      da_local_amount: 0,
      da_outstation_amount: 0,
      ta_primary_amount: 0,
      ta_secondary_amount: 0,
      total_da: 0,
      total_ta: 0,
      total_payable: 0,
      status: 'flag_for_review',
      computation_notes: 'no days worked',
    };
  }

  // Class must be valid 0–5
  if (cls === null || !VALID_CLASSES.has(cls)) {
    return {
      da_local_amount: 0,
      da_outstation_amount: 0,
      ta_primary_amount: 0,
      ta_secondary_amount: 0,
      total_da: 0,
      total_ta: 0,
      total_payable: 0,
      status: 'flag_for_review',
      computation_notes: 'invalid or missing ta_da_class',
    };
  }

  // ── Class 0: HR review required ───────────────────────────────────────
  if (cls === 0) {
    return {
      da_local_amount: 0,
      da_outstation_amount: 0,
      ta_primary_amount: 0,
      ta_secondary_amount: 0,
      total_da: 0,
      total_ta: 0,
      total_payable: 0,
      status: 'flag_for_review',
      computation_notes: 'Class 0: HR review required',
    };
  }

  let daLocal = 0;
  let daOut = 0;
  let taPrimary = 0;
  let taSecondary = 0;
  let status = 'computed';
  const notes = [];

  // ── Class 1: Fixed DA, no TA, no β phase ──────────────────────────────
  if (cls === 1) {
    daLocal = daRate * daysWorked;
    status = 'computed';
  }

  // ── Class 2: Tiered DA (in_city / outstation), no TA ──────────────────
  if (cls === 2) {
    if (inCity !== null && outstation !== null) {
      daLocal = inCity * daRate;
      daOut = outstation * daOutRate;
      status = 'computed';
    } else {
      // α fallback: treat all days as in-city
      daLocal = daRate * daysWorked;
      status = 'partial';
      notes.push('DA fallback: all in-city');
    }
  }

  // ── Class 3: Flat DA + per-km TA ──────────────────────────────────────
  if (cls === 3) {
    daLocal = daRate * daysWorked;
    if (totalKm !== null) {
      taPrimary = totalKm * taPrim;
      status = 'computed';
    } else {
      status = 'partial';
      notes.push('TA pending: km not provided');
    }
  }

  // ── Class 4: Tiered DA + per-km TA ────────────────────────────────────
  if (cls === 4) {
    const haveSplit = inCity !== null && outstation !== null;
    const haveKm = totalKm !== null;
    if (haveSplit) {
      daLocal = inCity * daRate;
      daOut = outstation * daOutRate;
    } else {
      daLocal = daRate * daysWorked;
      notes.push('DA fallback: all in-city');
    }
    if (haveKm) {
      taPrimary = totalKm * taPrim;
    } else {
      notes.push('TA pending: km not provided');
    }
    status = (haveSplit && haveKm) ? 'computed' : 'partial';
  }

  // ── Class 5: Tiered DA + dual-vehicle TA (bike + car) ─────────────────
  if (cls === 5) {
    const haveSplit = inCity !== null && outstation !== null;
    const haveKm = bikeKm !== null && carKm !== null;
    if (haveSplit) {
      daLocal = inCity * daRate;
      daOut = outstation * daOutRate;
    } else {
      daLocal = daRate * daysWorked;
      notes.push('DA fallback: all in-city');
    }
    if (haveKm) {
      taPrimary = bikeKm * taPrim;
      taSecondary = carKm * taSec;
    } else {
      notes.push('TA pending: bike/car split not provided');
    }
    status = (haveSplit && haveKm) ? 'computed' : 'partial';
  }

  daLocal = round2(daLocal);
  daOut = round2(daOut);
  taPrimary = round2(taPrimary);
  taSecondary = round2(taSecondary);
  const totalDa = round2(daLocal + daOut);
  const totalTa = round2(taPrimary + taSecondary);
  const totalPayable = round2(totalDa + totalTa);

  return {
    da_local_amount: daLocal,
    da_outstation_amount: daOut,
    ta_primary_amount: taPrimary,
    ta_secondary_amount: taSecondary,
    total_da: totalDa,
    total_ta: totalTa,
    total_payable: totalPayable,
    status,
    computation_notes: notes.length ? notes.join('; ') : null,
  };
}

// ── DB: latest sheet days for an employee for a given cycle ───────────────
// sales_monthly_input.sheet_days_given is authoritative per Q1 (Phase 2).
// Picks the most recent matched/computed upload's row for that employee+period.
function getAttendanceDaysWorked(db, { employeeCode, month, year, company }) {
  try {
    const row = db.prepare(`
      SELECT smi.sheet_days_given
        FROM sales_monthly_input smi
        JOIN sales_uploads su ON su.id = smi.upload_id
       WHERE smi.employee_code = ?
         AND smi.month = ?
         AND smi.year = ?
         AND smi.company = ?
         AND su.status IN ('matched', 'computed')
       ORDER BY su.uploaded_at DESC
       LIMIT 1
    `).get(employeeCode, month, year, company);
    if (!row) return null;
    const n = num(row.sheet_days_given, NaN);
    return Number.isFinite(n) ? n : null;
  } catch (e) {
    return null;
  }
}

// ── DB: per-employee input UPSERT with preservation rules ─────────────────
function upsertMonthlyInput(db, params) {
  const {
    employee, month, year, company, cycleStart, cycleEnd, daysWorked, computedBy,
  } = params;

  const existing = db.prepare(`
    SELECT * FROM sales_ta_da_monthly_inputs
     WHERE employee_id = ? AND month = ? AND year = ? AND company = ?
  `).get(employee.id, month, year, company);

  if (existing && (existing.source === 'upload' || existing.source === 'manual')) {
    // Preserve split + km + notes + source + source_detail + upload_id.
    // Only refresh days_worked + cycle bounds + updated_*.
    db.prepare(`
      UPDATE sales_ta_da_monthly_inputs
         SET days_worked = ?,
             cycle_start_date = ?,
             cycle_end_date = ?,
             updated_at = datetime('now'),
             updated_by = ?
       WHERE id = ?
    `).run(daysWorked, cycleStart, cycleEnd, computedBy || null, existing.id);
    return existing.id;
  }

  if (existing && existing.source === 'attendance_auto') {
    // Overwrite: fresh α data (split/km cleared back to NULL).
    db.prepare(`
      UPDATE sales_ta_da_monthly_inputs
         SET days_worked = ?,
             in_city_days = NULL,
             outstation_days = NULL,
             total_km = NULL,
             bike_km = NULL,
             car_km = NULL,
             notes = NULL,
             source = 'attendance_auto',
             source_detail = 'salary_compute_trigger',
             upload_id = NULL,
             cycle_start_date = ?,
             cycle_end_date = ?,
             updated_at = datetime('now'),
             updated_by = ?
       WHERE id = ?
    `).run(daysWorked, cycleStart, cycleEnd, computedBy || null, existing.id);
    return existing.id;
  }

  // New row: insert as attendance_auto.
  const info = db.prepare(`
    INSERT INTO sales_ta_da_monthly_inputs
      (employee_id, employee_code, month, year, company,
       cycle_start_date, cycle_end_date,
       days_worked, in_city_days, outstation_days,
       total_km, bike_km, car_km,
       source, source_detail, upload_id, notes,
       created_at, created_by, updated_at, updated_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL,
            'attendance_auto', 'salary_compute_trigger', NULL, NULL,
            datetime('now'), ?, datetime('now'), ?)
  `).run(
    employee.id, employee.code, month, year, company,
    cycleStart, cycleEnd,
    daysWorked,
    computedBy || null, computedBy || null
  );
  return info.lastInsertRowid;
}

// ── DB: per-employee computation UPSERT preserving audit metadata ─────────
function upsertComputation(db, params) {
  const {
    employee, monthlyInput, month, year, company, cycleStart, cycleEnd,
    result, computedBy,
  } = params;

  // Read existing row only for audit-trail carry-forward.
  const existing = db.prepare(`
    SELECT neft_exported_at, neft_exported_by, paid_at
      FROM sales_ta_da_computations
     WHERE employee_id = ? AND month = ? AND year = ? AND company = ?
  `).get(employee.id, month, year, company);

  const neftAt = existing ? existing.neft_exported_at : null;
  const neftBy = existing ? existing.neft_exported_by : null;
  const paidAt = existing ? existing.paid_at : null;

  // Snapshot rates from current employee row (always fresh).
  const cls = Number.isFinite(employee.ta_da_class)
    ? Number(employee.ta_da_class) : null;

  const stmt = db.prepare(`
    INSERT INTO sales_ta_da_computations
      (employee_id, employee_code, month, year, company,
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
       neft_exported_at, neft_exported_by, paid_at)
    VALUES (?, ?, ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?, ?, ?,
            ?, ?,
            datetime('now'), ?,
            ?, ?, ?)
    ON CONFLICT(employee_id, month, year, company) DO UPDATE SET
      cycle_start_date = excluded.cycle_start_date,
      cycle_end_date = excluded.cycle_end_date,
      ta_da_class_at_compute = excluded.ta_da_class_at_compute,
      da_rate_at_compute = excluded.da_rate_at_compute,
      da_outstation_rate_at_compute = excluded.da_outstation_rate_at_compute,
      ta_rate_primary_at_compute = excluded.ta_rate_primary_at_compute,
      ta_rate_secondary_at_compute = excluded.ta_rate_secondary_at_compute,
      days_worked_at_compute = excluded.days_worked_at_compute,
      in_city_days_at_compute = excluded.in_city_days_at_compute,
      outstation_days_at_compute = excluded.outstation_days_at_compute,
      total_km_at_compute = excluded.total_km_at_compute,
      bike_km_at_compute = excluded.bike_km_at_compute,
      car_km_at_compute = excluded.car_km_at_compute,
      da_local_amount = excluded.da_local_amount,
      da_outstation_amount = excluded.da_outstation_amount,
      ta_primary_amount = excluded.ta_primary_amount,
      ta_secondary_amount = excluded.ta_secondary_amount,
      total_da = excluded.total_da,
      total_ta = excluded.total_ta,
      total_payable = excluded.total_payable,
      status = excluded.status,
      computation_notes = excluded.computation_notes,
      computed_at = excluded.computed_at,
      computed_by = excluded.computed_by,
      neft_exported_at = excluded.neft_exported_at,
      neft_exported_by = excluded.neft_exported_by,
      paid_at = excluded.paid_at
  `);

  stmt.run(
    employee.id, employee.code, month, year, company,
    cycleStart, cycleEnd,
    cls === null ? 0 : cls,
    nz(employee.da_rate), nz(employee.da_outstation_rate),
    nz(employee.ta_rate_primary), nz(employee.ta_rate_secondary),
    num(monthlyInput.days_worked, 0),
    nz(monthlyInput.in_city_days), nz(monthlyInput.outstation_days),
    nz(monthlyInput.total_km), nz(monthlyInput.bike_km), nz(monthlyInput.car_km),
    result.da_local_amount, result.da_outstation_amount,
    result.ta_primary_amount, result.ta_secondary_amount,
    result.total_da, result.total_ta, result.total_payable,
    result.status, result.computation_notes,
    computedBy || null,
    neftAt, neftBy, paidAt
  );
}

// ── PUBLIC: full-cycle (or single-employee) recompute ─────────────────────
function recomputeCycle(db, params) {
  const {
    month, year, company, cycleStart, cycleEnd,
    computedBy, requestId, triggerSource, employeeCode,
  } = params || {};

  if (!month || !year || !company || !cycleStart || !cycleEnd) {
    throw new Error(
      'recomputeCycle requires month, year, company, cycleStart, cycleEnd'
    );
  }

  // Eligible employees: Active in the company; optional single-employee filter.
  let employees;
  if (employeeCode) {
    employees = db.prepare(`
      SELECT * FROM sales_employees
       WHERE company = ? AND code = ? AND status = 'Active'
    `).all(company, employeeCode);
  } else {
    employees = db.prepare(`
      SELECT * FROM sales_employees
       WHERE company = ? AND status = 'Active'
    `).all(company);
  }

  const summary = { computed: 0, partial: 0, flagged: 0, errors: [] };

  for (const employee of employees) {
    try {
      // Phase α attendance lookup — sales_monthly_input.sheet_days_given
      // is the authoritative source. May return null (no upload yet).
      const attendanceDays = getAttendanceDaysWorked(db, {
        employeeCode: employee.code, month, year, company,
      });

      // If no attendance row exists, we still need to write a row so the
      // register surfaces the gap. Use existing input's days_worked when
      // present, else 0 (which forces flag_for_review via the no-days guard).
      let daysWorked = attendanceDays;

      const existingInput = db.prepare(`
        SELECT days_worked, source FROM sales_ta_da_monthly_inputs
         WHERE employee_id = ? AND month = ? AND year = ? AND company = ?
      `).get(employee.id, month, year, company);

      if (daysWorked === null) {
        // No fresh attendance row. Carry existing input's days_worked
        // forward when present (Phase β scenarios where days were entered
        // manually); otherwise 0.
        daysWorked = existingInput ? num(existingInput.days_worked, 0) : 0;
      }

      const txn = db.transaction(() => {
        upsertMonthlyInput(db, {
          employee, month, year, company, cycleStart, cycleEnd,
          daysWorked, computedBy,
        });

        // Re-read so we operate on the canonical post-UPSERT row
        // (split/km may have been preserved from a prior upload/manual write).
        const monthlyInput = db.prepare(`
          SELECT * FROM sales_ta_da_monthly_inputs
           WHERE employee_id = ? AND month = ? AND year = ? AND company = ?
        `).get(employee.id, month, year, company);

        const result = computeForEmployee(employee, monthlyInput, {
          month, year, cycleStart, cycleEnd,
        }, { triggerSource, requestId });

        upsertComputation(db, {
          employee, monthlyInput, month, year, company, cycleStart, cycleEnd,
          result, computedBy,
        });

        return result.status;
      });

      const status = txn();
      if (status === 'computed') summary.computed += 1;
      else if (status === 'partial') summary.partial += 1;
      else if (status === 'flag_for_review') summary.flagged += 1;
    } catch (err) {
      summary.errors.push({
        employeeCode: employee.code,
        error: err && err.message ? err.message : String(err),
      });
    }
  }

  return summary;
}

// ── PUBLIC: read-only fetch of computation + monthly input ────────────────
function getComputation(db, { employeeCode, month, year, company }) {
  if (!employeeCode || !month || !year || !company) {
    throw new Error(
      'getComputation requires employeeCode, month, year, company'
    );
  }
  const employee = db.prepare(`
    SELECT id FROM sales_employees WHERE code = ? AND company = ?
  `).get(employeeCode, company);
  if (!employee) return { computation: null, monthlyInput: null };

  const computation = db.prepare(`
    SELECT * FROM sales_ta_da_computations
     WHERE employee_id = ? AND month = ? AND year = ? AND company = ?
  `).get(employee.id, month, year, company) || null;

  const monthlyInput = db.prepare(`
    SELECT * FROM sales_ta_da_monthly_inputs
     WHERE employee_id = ? AND month = ? AND year = ? AND company = ?
  `).get(employee.id, month, year, company) || null;

  return { computation, monthlyInput };
}

module.exports = {
  computeForEmployee,
  recomputeCycle,
  getComputation,
};
