/**
 * Sales Coordinator Sheet Parser
 *
 * Parses the monthly Excel sheet supplied by the sales coordinator's team.
 * Input format is the coordinator's own layout — NOT EESL biometric.
 *
 * Architecture mirrors backend/src/services/parser.js:
 *  - Dynamic header detection (no hardcoded row/col numbers)
 *  - Scans rows 0–10 for cells containing "Sales Person Name" AND "Day's Given"
 *  - Column indices derived from the detected header row
 *  - Captures only authoritative columns (Q4 resolution — drops
 *    "Working Days as Per AI" and "Working Days Manual")
 *
 * Exports:
 *  - parseSalesCoordinatorFile(filePath) → { success, month, year, company, rows, error }
 *  - normalizeName(s), normalizeManager(s), normalizeCity(s) — also used by the
 *    upload route for the matching algorithm, so same normalisation is applied
 *    both when creating the sales employee master and when matching sheet rows.
 */

const XLSX = require('xlsx');
const path = require('path');

// ── City typo lookup ─────────────────────────────────────────────────
// Key = UPPER-cased raw city value. Value = canonical UPPER form.
// One-line additions; grow this as HR flags mismatches in production.
const CITY_TYPO_MAP = {
  GHAZIYABAD: 'GHAZIABAD',
  MUZAFARNAGAR: 'MUZAFFARNAGAR',
};

// ── Month abbreviation map (Jan=1 … Dec=12) ──────────────────────────
const MONTH_MAP = {
  JAN: 1, JANUARY: 1,
  FEB: 2, FEBRUARY: 2,
  MAR: 3, MARCH: 3,
  APR: 4, APRIL: 4,
  MAY: 5,
  JUN: 6, JUNE: 6,
  JUL: 7, JULY: 7,
  AUG: 8, AUGUST: 8,
  SEP: 9, SEPT: 9, SEPTEMBER: 9,
  OCT: 10, OCTOBER: 10,
  NOV: 11, NOVEMBER: 11,
  DEC: 12, DECEMBER: 12,
};

// ──────────────────────────────────────────────────────────────────────
// Normalizers — exported for reuse by the upload route matcher
// ──────────────────────────────────────────────────────────────────────

function normalizeName(s) {
  if (!s) return '';
  return String(s).toUpperCase().trim().replace(/\s+/g, ' ');
}

// "01 SUNIL SHARMA" → "SUNIL SHARMA", "02 RAVI BANSAL" → "RAVI BANSAL"
function normalizeManager(s) {
  if (!s) return '';
  const stripped = String(s).replace(/^\s*\d+\s+/, '');
  return stripped.toUpperCase().trim().replace(/\s+/g, ' ');
}

function normalizeCity(s) {
  if (!s) return '';
  const key = String(s).toUpperCase().trim().replace(/\s+/g, ' ');
  return CITY_TYPO_MAP[key] || key;
}

// ──────────────────────────────────────────────────────────────────────
// Cell helpers
// ──────────────────────────────────────────────────────────────────────

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
  // Prefer the raw numeric value
  if (cell.t === 'n' && typeof cell.v === 'number') return cell.v;
  const val = cell.v ?? cell.w;
  if (val === undefined || val === null || val === '') return null;
  const n = parseFloat(String(val).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

// ──────────────────────────────────────────────────────────────────────
// Header-row detection
// ──────────────────────────────────────────────────────────────────────

// Maps a header cell (case-insensitively compared) to a canonical field name
// in the parser's output. Return null for columns we don't capture (Q4).
function classifyHeader(val) {
  if (!val) return null;
  const low = val.toLowerCase().replace(/\s+/g, ' ').trim();

  // Required canonical fields
  if (low === 'sales person name' || low === 'salesperson name' || low === 'name') return 'sheet_employee_name';
  if (low.includes("day's given") || low.includes('days given') || low === 'days') return 'sheet_days_given';

  // Optional fields
  if (low === 's.no' || low === 'sno' || low === 's no' || low === 'sr no' || low === 'sr.no') return 'sheet_row_number';
  if (low === 'state') return 'sheet_state';
  if (low === 'reporting manager' || low === 'manager') return 'sheet_reporting_manager';
  if (low === 'desig' || low === 'designation') return 'sheet_designation';
  if (low === 'city') return 'sheet_city';
  if (low === 'punch no.' || low === 'punch no' || low === 'punch number') return 'sheet_punch_no';
  if (low === 'd.o.j.' || low === 'doj' || low === 'date of joining') return 'sheet_doj';
  if (low === 'contact no.' || low === 'contact no' || low === 'contact') return 'sheet_contact_NOT_CAPTURED';
  if (low === 'personal contact') return 'sheet_personal_contact_NOT_CAPTURED';
  if (low === 'd.o.l.' || low === 'dol' || low === 'date of leaving') return 'sheet_dol';
  if (low.startsWith('remark')) return 'sheet_remarks';

  // Explicitly DROPPED (Q4)
  if (low.includes('working days as per ai') || low === 'working days ai') return '__DROPPED_AI';
  if (low.includes('working days manual')) return '__DROPPED_MANUAL';

  return null;
}

function findHeaderRow(ws) {
  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1:A1');
  const maxRow = Math.min(10, range.e.r);
  const maxCol = Math.min(30, range.e.c);

  for (let r = 0; r <= maxRow; r++) {
    let hasName = false;
    let hasDaysGiven = false;
    for (let c = 0; c <= maxCol; c++) {
      const v = getCellValue(ws, r, c);
      if (!v) continue;
      const kind = classifyHeader(v);
      if (kind === 'sheet_employee_name') hasName = true;
      if (kind === 'sheet_days_given') hasDaysGiven = true;
    }
    if (hasName && hasDaysGiven) return r;
  }
  return -1;
}

function buildColMap(ws, headerRow) {
  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1:A1');
  const map = {};
  for (let c = 0; c <= range.e.c; c++) {
    const v = getCellValue(ws, headerRow, c);
    const kind = classifyHeader(v);
    if (!kind) continue;
    // Only set if not already set (handles duplicate headers — first wins)
    if (!map[kind]) map[kind] = c;
  }
  return map;
}

// ──────────────────────────────────────────────────────────────────────
// Month/year extraction
// ──────────────────────────────────────────────────────────────────────

function tryExtractMonthYear(str) {
  if (!str) return null;
  const s = String(str);

  // "Feb 2026", "February 2026", "FEB-2026", "FEB_2026", "Feb-26"
  const full = s.match(/([A-Za-z]{3,9})[\s\-_]+(\d{2,4})/);
  if (full) {
    const monthKey = full[1].toUpperCase();
    const month = MONTH_MAP[monthKey];
    let year = parseInt(full[2], 10);
    if (month && !Number.isNaN(year)) {
      if (year < 100) year += 2000;
      return { month, year };
    }
  }

  // "02-2026", "02_2026", "2-2026", "02/2026"
  const numeric = s.match(/\b(\d{1,2})[\-_\/](\d{4})\b/);
  if (numeric) {
    const month = parseInt(numeric[1], 10);
    const year = parseInt(numeric[2], 10);
    if (month >= 1 && month <= 12) return { month, year };
  }

  // "2026-02"
  const iso = s.match(/\b(\d{4})-(\d{2})\b/);
  if (iso) {
    const year = parseInt(iso[1], 10);
    const month = parseInt(iso[2], 10);
    if (month >= 1 && month <= 12) return { month, year };
  }

  return null;
}

function extractMonthYearFromSheet(ws) {
  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1:A1');
  for (let r = 0; r <= Math.min(5, range.e.r); r++) {
    for (let c = 0; c <= Math.min(20, range.e.c); c++) {
      const v = getCellValue(ws, r, c);
      const my = tryExtractMonthYear(v);
      if (my) return my;
    }
  }
  return null;
}

function extractCompanyFromSheet(ws) {
  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1:A1');
  for (let r = 0; r <= Math.min(5, range.e.r); r++) {
    for (let c = 0; c <= Math.min(20, range.e.c); c++) {
      const v = getCellValue(ws, r, c);
      if (!v) continue;
      // Heuristic: recognise the two canonical company strings. HR confirmed
      // these are the only two in use — no period, no "Pvt." etc.
      if (/asian\s*lakto/i.test(v)) return 'Asian Lakto Ind Ltd';
      if (/indriyan\s*beverages/i.test(v)) return 'Indriyan Beverages Pvt Ltd';
    }
  }
  return null;
}

// ──────────────────────────────────────────────────────────────────────
// Row filtering
// ──────────────────────────────────────────────────────────────────────

function isSubtotalRow(name) {
  if (!name) return false;
  const upper = String(name).toUpperCase().trim();
  return upper === 'TOTAL' || upper.startsWith('TOTAL ') || upper.startsWith('SUB TOTAL') ||
         upper.startsWith('GRAND TOTAL') || upper === 'SUBTOTAL';
}

// ──────────────────────────────────────────────────────────────────────
// Main entry point
// ──────────────────────────────────────────────────────────────────────

function parseSalesCoordinatorFile(filePath) {
  let wb;
  try {
    wb = XLSX.readFile(filePath, { cellDates: false });
  } catch (e) {
    return { success: false, error: `Could not read Excel file: ${e.message}` };
  }

  if (!wb.SheetNames || wb.SheetNames.length === 0) {
    return { success: false, error: 'Workbook has no sheets' };
  }

  const filename = path.basename(filePath);

  // Try each sheet until one has a valid header row
  let ws, headerRow = -1, cols = null, usedSheetName = null;
  for (const sn of wb.SheetNames) {
    const candidate = wb.Sheets[sn];
    const hr = findHeaderRow(candidate);
    if (hr >= 0) {
      ws = candidate;
      headerRow = hr;
      usedSheetName = sn;
      cols = buildColMap(candidate, hr);
      break;
    }
  }

  if (headerRow < 0) {
    return {
      success: false,
      error: "Required column missing: header row with both 'Sales Person Name' and \"Day's Given\" not found in any sheet",
    };
  }

  if (cols.sheet_employee_name === undefined) {
    return { success: false, error: "Required column missing: 'Sales Person Name'" };
  }
  if (cols.sheet_days_given === undefined) {
    return { success: false, error: "Required column missing: 'Day's Given'" };
  }

  // Month/year resolution — filename first, then header cells
  let my = tryExtractMonthYear(filename) || extractMonthYearFromSheet(ws);
  const month = my?.month ?? null;
  const year = my?.year ?? null;

  // Company resolution — header scan only (filename fallback is caller's job)
  const company = extractCompanyFromSheet(ws);

  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1:A1');
  const rows = [];

  for (let r = headerRow + 1; r <= range.e.r; r++) {
    const name = getCellValue(ws, r, cols.sheet_employee_name);
    if (!name) continue;                  // empty name → skip
    if (isSubtotalRow(name)) continue;    // total / subtotal → skip

    const days = getCellNumber(ws, r, cols.sheet_days_given);
    if (days === null || !Number.isFinite(days)) continue; // non-numeric → skip

    // Coerce -1 → 1 (HR-confirmed dominant clerical pattern: coordinator
    // typed minus by mistake, intended value is 1). Deliberately narrow:
    // -2, -3, -15, etc. are NOT coerced and continue to be rejected
    // downstream at salesSalaryComputation.js:219 as 'invalid_days_given',
    // surfacing in the Bug A excluded[] banner. Silent normalization by
    // design — no audit log write per HR decision (2026-04-30).
    if (days === -1) days = 1;

    // Assemble the row. Only include keys we actually capture — no
    // sheet_working_days_ai / sheet_working_days_manual in the output (Q4).
    const row = {
      sheet_row_number: cols.sheet_row_number !== undefined
        ? parseInt(getCellValue(ws, r, cols.sheet_row_number), 10) || (r - headerRow)
        : (r - headerRow),
      sheet_state: cols.sheet_state !== undefined ? getCellValue(ws, r, cols.sheet_state) : null,
      sheet_reporting_manager: cols.sheet_reporting_manager !== undefined ? getCellValue(ws, r, cols.sheet_reporting_manager) : null,
      sheet_employee_name: name,
      sheet_designation: cols.sheet_designation !== undefined ? getCellValue(ws, r, cols.sheet_designation) : null,
      sheet_city: cols.sheet_city !== undefined ? getCellValue(ws, r, cols.sheet_city) : null,
      sheet_punch_no: cols.sheet_punch_no !== undefined ? getCellValue(ws, r, cols.sheet_punch_no) : null,
      sheet_doj: cols.sheet_doj !== undefined ? getCellValue(ws, r, cols.sheet_doj) : null,
      sheet_dol: cols.sheet_dol !== undefined ? getCellValue(ws, r, cols.sheet_dol) : null,
      sheet_days_given: days,
      sheet_remarks: cols.sheet_remarks !== undefined ? getCellValue(ws, r, cols.sheet_remarks) : null,
    };

    rows.push(row);
  }

  return {
    success: true,
    month,
    year,
    company,
    filename,
    sheetName: usedSheetName,
    rows,
  };
}

module.exports = {
  parseSalesCoordinatorFile,
  normalizeName,
  normalizeManager,
  normalizeCity,
  CITY_TYPO_MAP,
};
