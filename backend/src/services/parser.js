/**
 * EESL Biometric Attendance XLS Parser
 *
 * Parses the "Monthly Status Report (Basic Work Duration)" format exported by
 * the EESL biometric server used by Asian Lakto Ind. Ltd. / Indriyan Beverages.
 *
 * VERIFIED AGAINST ACTUAL FILES (Apr 2025 – Jan 2026):
 * - All values are TEXT strings (ctype=1) — no numeric/date types
 * - Times are HH:MM or H:MM text strings (single-digit hour possible)
 * - Status codes: P, A, WO, WOP, ½P, WO½P
 * - Non-contiguous columns: gaps at 1, 4, 9, 12, 30
 * - Day headers in Row 6 format: "1 T", "2 W", "14 M", "31 St"
 * - Employee code at col 3, name at col 13
 * - Department at col 3 of Department: row
 * - Company at col 4 of row 3
 */

const XLSX = require('xlsx');
const path = require('path');

// Day abbreviation → full day name mapping
const DAY_ABBREV_MAP = {
  'S': 'Sunday',
  'M': 'Monday',
  'T': 'Tuesday',
  'W': 'Wednesday',
  'Th': 'Thursday',
  'F': 'Friday',
  'St': 'Saturday'
};

/**
 * Parse a date range string like "Apr 01 2025  To  Apr 30 2025"
 * Returns { month (1-12), year, startDate, endDate }
 */
function parseDateRange(dateRangeStr) {
  if (!dateRangeStr) return null;
  const str = String(dateRangeStr).trim();

  const MONTHS = {
    'Jan': 1, 'Feb': 2, 'Mar': 3, 'Apr': 4, 'May': 5, 'Jun': 6,
    'Jul': 7, 'Aug': 8, 'Sep': 9, 'Oct': 10, 'Nov': 11, 'Dec': 12
  };

  // Pattern: "Apr 01 2025  To  Apr 30 2025"
  const match = str.match(/(\w{3})\s+(\d{1,2})\s+(\d{4})\s+To\s+(\w{3})\s+(\d{1,2})\s+(\d{4})/i);
  if (!match) {
    console.warn('Could not parse date range:', str);
    return null;
  }

  const startMonth = MONTHS[match[1]];
  const startDay = parseInt(match[2]);
  const startYear = parseInt(match[3]);
  const endMonth = MONTHS[match[4]];
  const endDay = parseInt(match[5]);
  const endYear = parseInt(match[6]);

  return {
    month: startMonth,
    year: startYear,
    startDate: `${startYear}-${String(startMonth).padStart(2,'0')}-${String(startDay).padStart(2,'0')}`,
    endDate: `${endYear}-${String(endMonth).padStart(2,'0')}-${String(endDay).padStart(2,'0')}`
  };
}

/**
 * Get cell value as string (handles null/undefined gracefully)
 */
function getCellValue(ws, row, col) {
  const cell = ws[XLSX.utils.encode_cell({ r: row, c: col })];
  if (!cell) return null;
  // All EESL cells are type text; use .w (formatted) or .v (raw value)
  const val = (cell.w !== undefined ? cell.w : cell.v);
  if (val === undefined || val === null) return null;
  const str = String(val).trim();
  return str === '' ? null : str;
}

/**
 * Build a map of column index → { dayNumber, dayOfWeek, dateStr }
 * by reading the day header row (row 6) dynamically.
 */
function buildColToDayMap(ws, month, year) {
  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1:A1');
  const map = {};

  for (let c = 0; c <= range.e.c; c++) {
    const header = getCellValue(ws, 6, c);
    if (!header || header === 'Days') continue;

    // Format: "1 T", "2 W", "14 M", "31 St"
    const parts = header.split(' ');
    if (parts.length < 2) continue;

    const dayNum = parseInt(parts[0]);
    if (isNaN(dayNum) || dayNum < 1 || dayNum > 31) continue;

    const abbrev = parts[1];
    const dayOfWeek = DAY_ABBREV_MAP[abbrev] || abbrev;

    // Construct the ISO date string
    const dateStr = `${year}-${String(month).padStart(2,'0')}-${String(dayNum).padStart(2,'0')}`;

    map[c] = { dayNumber: dayNum, dayOfWeek, dateStr };
  }

  return map;
}

/**
 * Normalize time string to "HH:MM" (add leading zero if single digit hour)
 * Returns null if invalid.
 */
function normalizeTime(timeStr) {
  if (!timeStr) return null;
  const str = String(timeStr).trim();
  if (!str) return null;

  // Match H:MM or HH:MM
  const match = str.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;

  const h = parseInt(match[1]);
  const m = parseInt(match[2]);
  if (h > 23 || m > 59) return null;

  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
}

/**
 * Convert "H:MM" or "HH:MM" duration to decimal hours
 */
function parseHoursToDecimal(hoursStr) {
  if (!hoursStr) return 0;
  const match = String(hoursStr).match(/^(\d+):(\d{2})$/);
  if (!match) return 0;
  return parseInt(match[1]) + parseInt(match[2]) / 60;
}

/**
 * Parse a single sheet of an EESL workbook.
 * Returns array of attendance records.
 */
function parseSheet(ws, sheetName) {
  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1:A1');
  const records = [];

  // Extract metadata
  const dateRangeStr = getCellValue(ws, 2, 1);
  const dateInfo = parseDateRange(dateRangeStr);
  if (!dateInfo) {
    console.warn(`Sheet ${sheetName}: Could not parse date range from: ${dateRangeStr}`);
    return records;
  }

  const company = getCellValue(ws, 3, 4) || sheetName;
  const { month, year } = dateInfo;

  // Build column → day map from Row 6
  const colToDayMap = buildColToDayMap(ws, month, year);
  const dayColumns = Object.keys(colToDayMap).map(Number);

  if (dayColumns.length === 0) {
    console.warn(`Sheet ${sheetName}: No day columns found in row 6`);
    return records;
  }

  // Parse employee blocks
  let currentDepartment = '';

  for (let r = 7; r <= range.e.r; r++) {
    const col0 = getCellValue(ws, r, 0);
    if (!col0) continue;

    // Department header
    if (col0 === 'Department:') {
      currentDepartment = getCellValue(ws, r, 3) || '';
      continue;
    }

    // Employee block start: "Emp. Code :"
    if (col0.startsWith('Emp. Code')) {
      const empCode = getCellValue(ws, r, 3);
      const empName = getCellValue(ws, r, 13);

      if (!empCode) continue;

      // Verify next rows are Status/InTime/OutTime/Total
      const statusLabel = getCellValue(ws, r + 1, 0);
      const inTimeLabel = getCellValue(ws, r + 2, 0);
      const outTimeLabel = getCellValue(ws, r + 3, 0);
      const totalLabel = getCellValue(ws, r + 4, 0);

      // Flexible matching (sometimes labels vary slightly)
      const hasStatus = statusLabel && statusLabel.toLowerCase().includes('status');
      const hasInTime = inTimeLabel && inTimeLabel.toLowerCase().includes('intime');
      const hasOutTime = outTimeLabel && outTimeLabel.toLowerCase().includes('outtime');
      const hasTotal = totalLabel && totalLabel.toLowerCase().includes('total');

      if (!hasStatus) continue; // Skip malformed blocks

      // Extract data for each day
      for (const col of dayColumns) {
        const dayInfo = colToDayMap[col];
        if (!dayInfo) continue;

        const status = getCellValue(ws, r + 1, col) || '';
        const inTimeRaw = getCellValue(ws, r + 2, col);
        const outTimeRaw = getCellValue(ws, r + 3, col);
        const totalHoursRaw = getCellValue(ws, r + 4, col);

        // Normalize times
        const inTime = normalizeTime(inTimeRaw);
        const outTime = normalizeTime(outTimeRaw);
        const totalHours = totalHoursRaw && totalHoursRaw !== '00:00' ? totalHoursRaw : null;

        records.push({
          employeeCode: String(empCode).trim(),
          employeeName: String(empName || '').trim(),
          department: currentDepartment,
          company: String(company).trim(),
          sheetName,
          date: dayInfo.dateStr,
          dayOfWeek: dayInfo.dayOfWeek,
          dayNumber: dayInfo.dayNumber,
          month,
          year,
          status: status.trim(),
          inTime,
          outTime,
          totalHours,
          totalHoursDecimal: parseHoursToDecimal(totalHoursRaw)
        });
      }

      // Skip ahead past this employee block (status+intime+outtime+total+blank = 5 rows)
      r += 5;
    }
  }

  return records;
}

/**
 * Main parser function.
 * Parses both Sheet1 and Sheet2 from an EESL .xls file.
 *
 * @param {string} filePath - Absolute path to the .xls file
 * @returns {Object} { success, month, year, sheets: [{sheetName, company, records}], allRecords, error }
 */
async function parseEESLFile(filePath) {
  try {
    const wb = XLSX.readFile(filePath, {
      type: 'file',
      raw: true,
      cellText: false,
      cellDates: false
    });

    if (!wb.SheetNames || wb.SheetNames.length === 0) {
      return { success: false, error: 'No sheets found in workbook' };
    }

    const sheets = [];
    let globalMonth = null;
    let globalYear = null;

    for (const sheetName of wb.SheetNames) {
      const ws = wb.Sheets[sheetName];
      if (!ws) continue;

      const records = parseSheet(ws, sheetName);

      if (records.length > 0) {
        const sample = records[0];
        globalMonth = sample.month;
        globalYear = sample.year;

        // Get unique company from records
        const companies = [...new Set(records.map(r => r.company))];
        const company = companies[0] || sheetName;

        sheets.push({
          sheetName,
          company,
          recordCount: records.length,
          employeeCount: new Set(records.map(r => r.employeeCode)).size,
          records
        });
      }
    }

    const allRecords = sheets.flatMap(s => s.records);

    return {
      success: true,
      month: globalMonth,
      year: globalYear,
      fileName: require('path').basename(filePath),
      sheets,
      allRecords,
      totalRecords: allRecords.length,
      totalEmployees: new Set(allRecords.map(r => r.employeeCode)).size,
      departments: [...new Set(allRecords.map(r => r.department))].filter(Boolean)
    };

  } catch (err) {
    console.error('Parser error:', err);
    return { success: false, error: err.message };
  }
}

/**
 * Extract unique employees from parsed records
 */
function extractEmployees(records) {
  const empMap = {};
  for (const r of records) {
    if (!empMap[r.employeeCode]) {
      empMap[r.employeeCode] = {
        code: r.employeeCode,
        name: r.employeeName,
        department: r.department,
        company: r.company
      };
    }
  }
  return Object.values(empMap);
}

/**
 * Get import summary statistics
 */
function getImportSummary(parseResult) {
  const { allRecords, sheets, month, year } = parseResult;

  const deptBreakdown = {};
  const companyBreakdown = {};
  let missingInCount = 0;
  let missingOutCount = 0;
  let nightShiftCandidates = 0;

  for (const r of allRecords) {
    // Department breakdown
    if (!deptBreakdown[r.department]) deptBreakdown[r.department] = { employees: new Set(), records: 0 };
    deptBreakdown[r.department].employees.add(r.employeeCode);
    deptBreakdown[r.department].records++;

    // Company breakdown
    if (!companyBreakdown[r.company]) companyBreakdown[r.company] = { employees: new Set(), records: 0 };
    companyBreakdown[r.company].employees.add(r.employeeCode);
    companyBreakdown[r.company].records++;

    // Issue detection
    const isPresent = ['P', 'WOP', '½P', 'WO½P'].includes(r.status);
    if (isPresent) {
      if (!r.inTime && !r.outTime) { /* both missing */ }
      else if (!r.inTime) missingInCount++;
      else if (!r.outTime) {
        // Check if night shift candidate
        const inHour = r.inTime ? parseInt(r.inTime.split(':')[0]) : -1;
        if (inHour >= 18) nightShiftCandidates++;
        else missingOutCount++;
      }
    }
  }

  return {
    month,
    year,
    sheets: sheets.map(s => ({ sheetName: s.sheetName, company: s.company, employees: s.employeeCount, records: s.recordCount })),
    totalRecords: allRecords.length,
    totalEmployees: new Set(allRecords.map(r => r.employeeCode)).size,
    departments: Object.entries(deptBreakdown).map(([dept, d]) => ({
      department: dept,
      employees: d.employees.size,
      records: d.records
    })).sort((a, b) => b.employees - a.employees),
    companies: Object.entries(companyBreakdown).map(([company, d]) => ({
      company,
      employees: d.employees.size,
      records: d.records
    })),
    issues: {
      missingIn: missingInCount,
      missingOut: missingOutCount,
      nightShiftCandidates,
      total: missingInCount + missingOutCount
    }
  };
}

module.exports = {
  parseEESLFile,
  extractEmployees,
  getImportSummary,
  parseDateRange,
  parseHoursToDecimal,
  normalizeTime
};
