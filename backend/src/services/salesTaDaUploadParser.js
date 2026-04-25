'use strict';

/**
 * TA/DA Class-Template Upload Parser (Phase 3)
 *
 * Parses an HR-uploaded .xlsx for one TA/DA class. All-or-nothing semantics:
 * any per-row validation failure aborts the whole file; the route refuses to
 * commit until every row passes.
 *
 * Per-class required columns (case-insensitive, whitespace-trimmed):
 *   Class 2: employee_code, name, in_city_days, outstation_days
 *   Class 3: employee_code, name, total_km
 *   Class 4: employee_code, name, in_city_days, outstation_days, total_km
 *   Class 5: employee_code, name, in_city_days, outstation_days, bike_km, car_km
 *
 * Header detection: scan first 5 rows for a row containing 'employee_code'
 * (normalised — case + underscores ignored). Header row may sit anywhere
 * 0..4. Data starts on the next row.
 *
 * Empty rows (all key fields blank) are silently skipped.
 */

const XLSX = require('xlsx');

const REQUIRED_BY_CLASS = {
  2: ['employee_code', 'name', 'in_city_days', 'outstation_days'],
  3: ['employee_code', 'name', 'total_km'],
  4: ['employee_code', 'name', 'in_city_days', 'outstation_days', 'total_km'],
  5: ['employee_code', 'name', 'in_city_days', 'outstation_days', 'bike_km', 'car_km'],
};

const NUMERIC_FIELDS = new Set([
  'in_city_days', 'outstation_days',
  'total_km', 'bike_km', 'car_km',
]);

function normaliseHeader(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function findHeaderRow(rows) {
  const limit = Math.min(rows.length, 5);
  for (let i = 0; i < limit; i++) {
    const r = rows[i] || [];
    for (const cell of r) {
      if (normaliseHeader(cell) === 'employee_code') return i;
    }
  }
  return -1;
}

function buildColMap(headerCells) {
  const map = {};
  for (let c = 0; c < headerCells.length; c++) {
    const key = normaliseHeader(headerCells[c]);
    if (!key) continue;
    // First occurrence wins — duplicate header columns are ignored.
    if (!(key in map)) map[key] = c;
  }
  return map;
}

function parseNonNegNumber(v) {
  if (v === null || v === undefined || v === '') return { ok: false, value: null };
  const s = typeof v === 'string' ? v.trim().replace(/,/g, '') : v;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return { ok: false, value: null };
  return { ok: true, value: n };
}

function isCellEmpty(v) {
  return v === null || v === undefined || v === '' || (typeof v === 'string' && v.trim() === '');
}

function isRowAllEmpty(rowObj, keys) {
  for (const k of keys) {
    if (!isCellEmpty(rowObj[k])) return false;
  }
  return true;
}

/**
 * @param {Buffer} buffer
 * @param {2|3|4|5} classNum
 * @param {Map<string, { ta_da_class:number, days_worked_for_cycle:number }>} sales_employees_lookup
 * @returns {{ rows: Array<Object>, errors: Array<{row_number:number, employee_code?:string, error:string}> }}
 */
function parseTaDaUpload(buffer, classNum, sales_employees_lookup) {
  const errors = [];
  const rows = [];

  if (![2, 3, 4, 5].includes(Number(classNum))) {
    errors.push({ row_number: 0, error: `invalid classNum ${classNum}; expected 2|3|4|5` });
    return { rows, errors };
  }
  const required = REQUIRED_BY_CLASS[classNum];

  let wb;
  try {
    wb = XLSX.read(buffer, { type: 'buffer', cellDates: false });
  } catch (e) {
    errors.push({ row_number: 0, error: `Could not read Excel file: ${e.message}` });
    return { rows, errors };
  }
  if (!wb.SheetNames || wb.SheetNames.length === 0) {
    errors.push({ row_number: 0, error: 'Workbook has no sheets' });
    return { rows, errors };
  }

  // Try sheets in order; first sheet with a recognisable header row wins.
  let usedSheetName = null;
  let aoa = null;
  let headerRowIdx = -1;
  for (const sn of wb.SheetNames) {
    const ws = wb.Sheets[sn];
    const candidate = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', blankrows: false });
    const hr = findHeaderRow(candidate);
    if (hr >= 0) {
      usedSheetName = sn;
      aoa = candidate;
      headerRowIdx = hr;
      break;
    }
  }
  if (headerRowIdx < 0) {
    errors.push({
      row_number: 0,
      error: "Header row not found: no row in the first 5 contained 'employee_code'",
    });
    return { rows, errors };
  }

  const colMap = buildColMap(aoa[headerRowIdx]);
  const missing = required.filter(k => !(k in colMap));
  if (missing.length > 0) {
    errors.push({
      row_number: headerRowIdx + 1,
      error: `missing required column${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}`,
    });
    return { rows, errors };
  }

  // Data rows are everything below the header row.
  for (let r = headerRowIdx + 1; r < aoa.length; r++) {
    const sheetRowNumber = r + 1; // 1-indexed for human-friendly errors
    const rawRow = aoa[r] || [];

    // Build a dict of the required keys for emptiness check + downstream.
    const rowObj = {};
    for (const k of required) {
      const colIdx = colMap[k];
      rowObj[k] = colIdx !== undefined ? rawRow[colIdx] : undefined;
    }
    if (isRowAllEmpty(rowObj, required)) continue;

    const code = String(rowObj.employee_code || '').trim();
    if (!code) {
      errors.push({ row_number: sheetRowNumber, error: 'employee_code is empty' });
      continue;
    }

    const lookupRow = sales_employees_lookup.get(code);
    if (!lookupRow) {
      errors.push({ row_number: sheetRowNumber, employee_code: code, error: 'employee not found' });
      continue;
    }

    if (Number(lookupRow.ta_da_class) !== Number(classNum)) {
      errors.push({
        row_number: sheetRowNumber,
        employee_code: code,
        error: `employee ${code} is Class ${lookupRow.ta_da_class} but uploaded in Class ${classNum} template`,
      });
      continue;
    }

    // Parse numeric fields per the class's required list.
    const parsed = { employee_code: code };
    let badField = null;
    for (const f of required) {
      if (f === 'employee_code' || f === 'name') continue;
      if (!NUMERIC_FIELDS.has(f)) continue;
      const r2 = parseNonNegNumber(rowObj[f]);
      if (!r2.ok) { badField = f; break; }
      parsed[f] = r2.value;
    }
    if (badField !== null) {
      errors.push({
        row_number: sheetRowNumber,
        employee_code: code,
        error: `invalid number in ${badField}`,
      });
      continue;
    }

    // Class 5: both bike_km AND car_km must be present (zero allowed).
    if (Number(classNum) === 5) {
      const bikeProvided = parsed.bike_km !== undefined && parsed.bike_km !== null;
      const carProvided = parsed.car_km !== undefined && parsed.car_km !== null;
      if (!bikeProvided || !carProvided) {
        errors.push({
          row_number: sheetRowNumber,
          employee_code: code,
          error: 'Class 5 requires both bike_km and car_km (zero allowed)',
        });
        continue;
      }
    }

    // Cross-validation: in_city_days + outstation_days <= days_worked (Class 2/4/5).
    if ([2, 4, 5].includes(Number(classNum))) {
      const sum = (parsed.in_city_days || 0) + (parsed.outstation_days || 0);
      const days = Number(lookupRow.days_worked_for_cycle) || 0;
      if (sum > days) {
        errors.push({
          row_number: sheetRowNumber,
          employee_code: code,
          error: `split exceeds days worked (${parsed.in_city_days} + ${parsed.outstation_days} > ${days})`,
        });
        continue;
      }
    }

    // Stamp days_worked from lookup so the route can persist it on the input row.
    parsed.days_worked = Number(lookupRow.days_worked_for_cycle) || 0;
    parsed._sheet_row_number = sheetRowNumber;
    parsed._sheet_name = usedSheetName;
    rows.push(parsed);
  }

  return { rows, errors };
}

module.exports = { parseTaDaUpload };
