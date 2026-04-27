/**
 * Sales TA/DA Phase β Upload Parser
 *
 * Parses HR's per-class .xlsx template that supplies split + km values.
 * Caller pre-loads `sales_employees_lookup` with each employee's
 * canonical `ta_da_class` (so we can reject mismatched-class uploads)
 * and the cycle's `days_worked_for_cycle` (so we can reject
 * in_city + outstation > days_worked).
 *
 * All-or-nothing semantics: any per-row error → return `errors[]`
 * with rows[] = []; the route MUST NOT commit when errors.length > 0.
 *
 * Header expectations per class (case-insensitive, whitespace-trimmed,
 * underscore/space tolerant):
 *   Class 2: employee_code, name, in_city_days, outstation_days
 *   Class 3: employee_code, name, total_km
 *   Class 4: employee_code, name, in_city_days, outstation_days, total_km
 *   Class 5: employee_code, name, in_city_days, outstation_days, bike_km, car_km
 */

'use strict';

const XLSX = require('xlsx');

// Canonical field synonyms (lower-cased, alphanumeric+underscore only).
const HEADER_SYNONYMS = {
  employee_code: ['employee_code', 'employeecode', 'emp_code', 'empcode', 'code'],
  name:          ['name', 'employee_name', 'employeename', 'sales_person_name', 'salesperson_name'],
  in_city_days:  ['in_city_days', 'incity_days', 'incitydays', 'in_city', 'incity', 'in_city_day'],
  outstation_days: ['outstation_days', 'outstationdays', 'outstation', 'out_station_days', 'outstation_day'],
  total_km:      ['total_km', 'totalkm', 'km', 'kilometers', 'kilometres', 'total_kms'],
  bike_km:       ['bike_km', 'bikekm', 'bike_kms', 'two_wheeler_km'],
  car_km:        ['car_km', 'carkm', 'car_kms', 'four_wheeler_km'],
};

const REQUIRED_FIELDS_BY_CLASS = {
  2: ['employee_code', 'name', 'in_city_days', 'outstation_days'],
  3: ['employee_code', 'name', 'total_km'],
  4: ['employee_code', 'name', 'in_city_days', 'outstation_days', 'total_km'],
  5: ['employee_code', 'name', 'in_city_days', 'outstation_days', 'bike_km', 'car_km'],
};

const NUMERIC_FIELDS = new Set([
  'in_city_days', 'outstation_days', 'total_km', 'bike_km', 'car_km',
]);

function normalizeHeader(s) {
  if (s === null || s === undefined) return '';
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function classifyHeader(rawHeader) {
  const norm = normalizeHeader(rawHeader);
  if (!norm) return null;
  for (const [canonical, synonyms] of Object.entries(HEADER_SYNONYMS)) {
    if (synonyms.includes(norm)) return canonical;
  }
  return null;
}

function getCellValue(ws, row, col) {
  const cell = ws[XLSX.utils.encode_cell({ r: row, c: col })];
  if (!cell) return null;
  const val = (cell.w !== undefined ? cell.w : cell.v);
  if (val === undefined || val === null) return null;
  const str = String(val).trim();
  return str === '' ? null : str;
}

function getCellNumber(ws, row, col) {
  const cell = ws[XLSX.utils.encode_cell({ r: row, c: col })];
  if (!cell) return null;
  if (cell.t === 'n' && typeof cell.v === 'number') return cell.v;
  const val = cell.v ?? cell.w;
  if (val === undefined || val === null || val === '') return null;
  const n = parseFloat(String(val).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

// Find the header row (within first 5 rows) — must contain something that
// classifies as 'employee_code'. Returns {row, colMap} or null.
function findHeaderRow(ws) {
  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1:A1');
  const maxRow = Math.min(4, range.e.r);
  for (let r = range.s.r; r <= maxRow; r++) {
    const colMap = {};
    let sawEmpCode = false;
    for (let c = range.s.c; c <= range.e.c; c++) {
      const val = getCellValue(ws, r, c);
      const canonical = classifyHeader(val);
      if (canonical && colMap[canonical] === undefined) {
        colMap[canonical] = c;
        if (canonical === 'employee_code') sawEmpCode = true;
      }
    }
    if (sawEmpCode) return { row: r, colMap, range };
  }
  return null;
}

function isRowEmpty(ws, r, colMap, requiredFields) {
  for (const field of requiredFields) {
    const c = colMap[field];
    if (c === undefined) continue;
    const v = getCellValue(ws, r, c);
    if (v !== null && v !== '') return false;
  }
  return true;
}

/**
 * @param {Buffer|Uint8Array} buffer
 * @param {number} classNum                                2 | 3 | 4 | 5
 * @param {Map<string, {ta_da_class:number, days_worked_for_cycle:number}>} sales_employees_lookup
 * @returns {{rows: object[], errors: {row_number:number, employee_code?:string, error:string}[]}}
 */
function parseTaDaUpload(buffer, classNum, sales_employees_lookup) {
  const errors = [];
  const rows = [];

  if (![2, 3, 4, 5].includes(classNum)) {
    errors.push({ row_number: 0, error: `unsupported class: ${classNum}` });
    return { rows: [], errors };
  }

  const required = REQUIRED_FIELDS_BY_CLASS[classNum];

  let wb;
  try {
    wb = XLSX.read(buffer, { type: 'buffer', cellDates: false });
  } catch (e) {
    errors.push({ row_number: 0, error: `Could not read Excel file: ${e.message}` });
    return { rows: [], errors };
  }

  if (!wb.SheetNames || wb.SheetNames.length === 0) {
    errors.push({ row_number: 0, error: 'Workbook has no sheets' });
    return { rows: [], errors };
  }

  // Find first sheet that has a recognizable employee_code header in first 5 rows.
  let ws = null, header = null;
  for (const sn of wb.SheetNames) {
    const candidate = wb.Sheets[sn];
    const h = findHeaderRow(candidate);
    if (h) { ws = candidate; header = h; break; }
  }

  if (!ws || !header) {
    errors.push({
      row_number: 0,
      error: "header row not found — first 5 rows must include 'employee_code' column",
    });
    return { rows: [], errors };
  }

  // Validate that all required fields for this class were detected in the header.
  const missing = required.filter(f => header.colMap[f] === undefined);
  if (missing.length > 0) {
    errors.push({
      row_number: header.row + 1,
      error: `missing required column(s) for Class ${classNum} template: ${missing.join(', ')}`,
    });
    return { rows: [], errors };
  }

  const colMap = header.colMap;
  const range = header.range;

  for (let r = header.row + 1; r <= range.e.r; r++) {
    if (isRowEmpty(ws, r, colMap, required)) continue;

    const rowNumber = r + 1; // 1-indexed for human readability
    const empCodeRaw = getCellValue(ws, r, colMap.employee_code);
    const empCode = empCodeRaw ? String(empCodeRaw).trim() : '';

    if (!empCode) {
      errors.push({ row_number: rowNumber, error: 'employee_code is required' });
      continue;
    }

    const lookup = sales_employees_lookup.get(empCode);
    if (!lookup) {
      errors.push({ row_number: rowNumber, employee_code: empCode, error: 'employee not found' });
      continue;
    }

    const empClass = Number(lookup.ta_da_class);
    if (empClass !== classNum) {
      errors.push({
        row_number: rowNumber,
        employee_code: empCode,
        error: `employee ${empCode} is Class ${empClass} but uploaded in Class ${classNum} template`,
      });
      continue;
    }

    const parsed = { employee_code: empCode };
    let rowHadError = false;

    for (const field of required) {
      if (field === 'employee_code' || field === 'name') continue;
      if (!NUMERIC_FIELDS.has(field)) continue;
      const c = colMap[field];
      const cellRaw = getCellValue(ws, r, c);
      // Class 5 specifically requires bike_km AND car_km present (zero allowed).
      if (cellRaw === null || cellRaw === '') {
        errors.push({
          row_number: rowNumber,
          employee_code: empCode,
          error: `${field} is required (zero is allowed)`,
        });
        rowHadError = true;
        continue;
      }
      const n = getCellNumber(ws, r, c);
      if (n === null || !Number.isFinite(n) || n < 0) {
        errors.push({
          row_number: rowNumber,
          employee_code: empCode,
          error: `invalid number in ${field}`,
        });
        rowHadError = true;
        continue;
      }
      parsed[field] = n;
    }

    if (rowHadError) continue;

    // Cross-field validation: in_city + outstation <= days_worked (classes 2/4/5)
    if (classNum === 2 || classNum === 4 || classNum === 5) {
      const ic = parsed.in_city_days;
      const os = parsed.outstation_days;
      const dw = Number(lookup.days_worked_for_cycle) || 0;
      if (ic + os > dw) {
        errors.push({
          row_number: rowNumber,
          employee_code: empCode,
          error: `split exceeds days worked (${ic} + ${os} > ${dw})`,
        });
        continue;
      }
    }

    rows.push(parsed);
  }

  // All-or-nothing: if any errors, drop the rows array.
  if (errors.length > 0) {
    return { rows: [], errors };
  }

  return { rows, errors: [] };
}

module.exports = { parseTaDaUpload };
