/**
 * EESL Biometric Attendance XLS Parser
 *
 * Parses the "Monthly Status Report (Basic Work Duration)" format exported by
 * the EESL biometric server used by Asian Lakto Ind. Ltd. / Indriyan Beverages.
 *
 * DYNAMIC LAYOUT: The parser no longer hardcodes row/column numbers.
 * It scans for key landmarks (date range, day headers, employee blocks)
 * to handle layout variations between different EESL export versions.
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

// Day abbreviation → JS weekday number (0=Sun..6=Sat). Used to cross-check
// the day-header weekday against the date computed from the file's date range.
// Without this check, a multi-month export (e.g. "Apr 30 To May 01") would
// silently stamp BOTH columns under the start month and overwrite real data.
const DAY_ABBREV_TO_WEEKDAY = {
  'S': 0, 'M': 1, 'T': 2, 'W': 3, 'Th': 4, 'F': 5, 'St': 6
};

// Date math helpers — UTC-only to avoid timezone drift on the dev sandbox vs
// production. We never need wall-clock semantics here, just calendar arithmetic.
function weekdayName(date) {
  return ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][date.getUTCDay()];
}
function fmtDate(date) {
  return date.getUTCFullYear() + '-' +
         String(date.getUTCMonth() + 1).padStart(2, '0') + '-' +
         String(date.getUTCDate()).padStart(2, '0');
}
function buildDateList(startDateStr, endDateStr) {
  const dates = [];
  const start = new Date(startDateStr + 'T00:00:00Z');
  const end = new Date(endDateStr + 'T00:00:00Z');
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || end < start) return dates;
  // Cap at 62 days as a safety belt — pathological ranges shouldn't loop forever
  for (let i = 0, d = new Date(start); d <= end && i < 62; i++) {
    dates.push(new Date(d));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return dates;
}

/**
 * Parse a date range string like "Apr 01 2025  To  Apr 30 2025"
 * Also handles incomplete: "Mar 01 2026  To  Mar 22 " (missing end year)
 * Returns { month, year, endMonth, endYear, startDate, endDate }.
 * `month`/`year` are the START month/year (preserved for backwards
 * compatibility — `monthly_imports` files under that key). `endMonth`/`endYear`
 * are added so callers (route layer + parser column mapper) can detect
 * multi-month files.
 */
function parseDateRange(dateRangeStr) {
  if (!dateRangeStr) return null;
  const str = String(dateRangeStr).trim();

  const MONTHS = {
    'Jan': 1, 'Feb': 2, 'Mar': 3, 'Apr': 4, 'May': 5, 'Jun': 6,
    'Jul': 7, 'Aug': 8, 'Sep': 9, 'Oct': 10, 'Nov': 11, 'Dec': 12
  };

  // Pattern 1: "Apr 01 2025  To  Apr 30 2025" (full)
  const fullMatch = str.match(/(\w{3})\s+(\d{1,2})\s+(\d{4})\s+To\s+(\w{3})\s+(\d{1,2})\s+(\d{4})/i);
  if (fullMatch) {
    const startMonth = MONTHS[fullMatch[1]];
    const startDay = parseInt(fullMatch[2]);
    const startYear = parseInt(fullMatch[3]);
    const endMonth = MONTHS[fullMatch[4]];
    const endDay = parseInt(fullMatch[5]);
    const endYear = parseInt(fullMatch[6]);
    return {
      month: startMonth, year: startYear,
      endMonth, endYear,
      startDate: `${startYear}-${String(startMonth).padStart(2,'0')}-${String(startDay).padStart(2,'0')}`,
      endDate: `${endYear}-${String(endMonth).padStart(2,'0')}-${String(endDay).padStart(2,'0')}`
    };
  }

  // Pattern 2: "Mar 01 2026  To  Mar 22" or "Mar 01 2026  To  Mar 22 " (missing end year)
  const partialMatch = str.match(/(\w{3})\s+(\d{1,2})\s+(\d{4})\s+To\s+(\w{3})\s+(\d{1,2})/i);
  if (partialMatch) {
    const startMonth = MONTHS[partialMatch[1]];
    const startDay = parseInt(partialMatch[2]);
    const startYear = parseInt(partialMatch[3]);
    const endMonth = MONTHS[partialMatch[4]];
    const endDay = parseInt(partialMatch[5]);
    // Assume same year as start
    const endYear = startYear;
    return {
      month: startMonth, year: startYear,
      endMonth, endYear,
      startDate: `${startYear}-${String(startMonth).padStart(2,'0')}-${String(startDay).padStart(2,'0')}`,
      endDate: `${endYear}-${String(endMonth).padStart(2,'0')}-${String(endDay).padStart(2,'0')}`
    };
  }

  console.warn('Could not parse date range:', str);
  return null;
}

/**
 * Get cell value as string (handles null/undefined gracefully)
 */
function getCellValue(ws, row, col) {
  const cell = ws[XLSX.utils.encode_cell({ r: row, c: col })];
  if (!cell) return null;
  const val = (cell.w !== undefined ? cell.w : cell.v);
  if (val === undefined || val === null) return null;
  const str = String(val).trim();
  return str === '' ? null : str;
}

/**
 * Scan the sheet for key landmark rows.
 * Returns { dateRangeRow, companyRow, dayHeaderRow, dataStartRow }
 */
function findLandmarks(ws) {
  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1:A1');
  let dateRangeRow = -1;
  let companyRow = -1;
  let dayHeaderRow = -1;

  for (let r = 0; r <= Math.min(10, range.e.r); r++) {
    for (let c = 0; c <= Math.min(5, range.e.c); c++) {
      const val = getCellValue(ws, r, c);
      if (!val) continue;

      // Date range: contains " To " with month names
      if (dateRangeRow < 0 && val.includes(' To ') && /\w{3}\s+\d/.test(val)) {
        dateRangeRow = r;
      }

      // Company row: starts with "Company"
      if (companyRow < 0 && val.toLowerCase().startsWith('company')) {
        companyRow = r;
      }

      // Day header row: has "Days" in col 0 or has patterns like "1 S", "2 M" in the first few cols
      if (dayHeaderRow < 0 && (val === 'Days' || /^\d{1,2}\s+[A-Z]/.test(val))) {
        // Verify it's really the day header by checking adjacent cells
        let dayCount = 0;
        for (let cc = c; cc <= Math.min(c + 10, range.e.c); cc++) {
          const cv = getCellValue(ws, r, cc);
          if (cv && /^\d{1,2}\s+[A-Z]/.test(cv)) dayCount++;
        }
        if (dayCount >= 2) dayHeaderRow = r;
      }
    }
  }

  return { dateRangeRow, companyRow, dayHeaderRow };
}

/**
 * Build a map of column index → { dayNumber, dayOfWeek, dateStr }
 * by reading the day header row dynamically.
 *
 * Strategy: walk the date range start→end inclusive, consume one date per
 * detected day-header column. Cross-check (a) the printed day number against
 * the consumed date's day-of-month, and (b) the printed weekday abbreviation
 * against the consumed date's actual weekday. Either mismatch THROWS — silent
 * misalignment is exactly the bug class that corrupted April 1 attendance
 * when a multi-month "Apr 30 To May 01" file had its May 1 column stamped as
 * 2026-04-01.
 *
 * Day-headers that don't parse (blank cells, "Total", etc.) are skipped
 * without consuming a date.
 */
function buildColToDayMap(ws, dayHeaderRow, dateInfo) {
  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1:A1');
  const map = {};

  const expectedDates = buildDateList(dateInfo.startDate, dateInfo.endDate);
  if (expectedDates.length === 0) {
    throw new Error(
      `Parser: invalid date range — startDate=${dateInfo.startDate} endDate=${dateInfo.endDate}`
    );
  }

  let dateIdx = 0;
  for (let c = 0; c <= range.e.c; c++) {
    const header = getCellValue(ws, dayHeaderRow, c);
    if (!header || header === 'Days') continue;

    // Format: "1 S", "2 M", "14 M", "31 St". Whitespace-tolerant.
    const parts = String(header).trim().split(/\s+/);
    if (parts.length < 2) continue;

    const dayNum = parseInt(parts[0]);
    if (isNaN(dayNum) || dayNum < 1 || dayNum > 31) continue;

    const abbrev = parts[1];

    if (dateIdx >= expectedDates.length) {
      // More day-header columns than days in range — could be a stray column
      // or an export quirk. Warn and skip rather than throwing; downstream
      // pipeline tolerates fewer columns than expected.
      console.warn(
        `Parser: day-header column ${c} ("${header}") found after date range exhausted (${dateInfo.startDate}..${dateInfo.endDate}); skipping`
      );
      continue;
    }

    const expectedDate = expectedDates[dateIdx];

    if (expectedDate.getUTCDate() !== dayNum) {
      throw new Error(
        `Parser day-number mismatch: column ${c} header "${header}" but expected day ${expectedDate.getUTCDate()} of date ${fmtDate(expectedDate)}`
      );
    }

    const headerWeekday = DAY_ABBREV_TO_WEEKDAY[abbrev];
    if (headerWeekday === undefined) {
      // Unknown abbreviation — skip column rather than throw, but DO consume
      // the date so subsequent columns stay aligned.
      console.warn(
        `Parser: unknown day-of-week abbreviation "${abbrev}" in column ${c} ("${header}"); skipping`
      );
      dateIdx++;
      continue;
    }
    if (headerWeekday !== expectedDate.getUTCDay()) {
      throw new Error(
        `Parser weekday mismatch: column ${c} header "${header}" claims ${abbrev} but ${fmtDate(expectedDate)} is ${weekdayName(expectedDate)}`
      );
    }

    map[c] = {
      dayNumber: dayNum,
      dayOfWeek: weekdayName(expectedDate),
      dateStr: fmtDate(expectedDate)
    };
    dateIdx++;
  }

  return map;
}

/**
 * Normalize time string to "HH:MM" (add leading zero if single digit hour)
 */
function normalizeTime(timeStr) {
  if (!timeStr) return null;
  const str = String(timeStr).trim();
  if (!str) return null;
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
 * Find employee code column — scan the "Emp. Code" row for the value
 */
function findEmpCodeCol(ws, row, range) {
  for (let c = 1; c <= Math.min(10, range.e.c); c++) {
    const val = getCellValue(ws, row, c);
    if (val && /^\d{3,6}$/.test(val)) return c;
  }
  return 3; // fallback
}

/**
 * Find department column — scan for non-null value after "Department:" label
 */
function findDeptValue(ws, row, range) {
  for (let c = 1; c <= Math.min(10, range.e.c); c++) {
    const val = getCellValue(ws, row, c);
    if (val && !val.toLowerCase().includes('department')) return val;
  }
  return '';
}

/**
 * Find employee name — scan for "Name" label, then read value after it
 */
function findEmpName(ws, row, range) {
  for (let c = 1; c <= range.e.c; c++) {
    const val = getCellValue(ws, row, c);
    if (val && val.includes('Name')) {
      // Read the next non-null cell after the label
      for (let nc = c + 1; nc <= Math.min(c + 8, range.e.c); nc++) {
        const nameVal = getCellValue(ws, row, nc);
        if (nameVal && !nameVal.includes('Name')) return nameVal;
      }
    }
  }
  return null;
}

/**
 * Parse a single sheet of an EESL workbook.
 * Uses dynamic landmark detection — no hardcoded row numbers.
 */
function parseSheet(ws, sheetName) {
  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1:A1');
  const records = [];

  // Find landmarks dynamically
  const landmarks = findLandmarks(ws);

  if (landmarks.dateRangeRow < 0) {
    console.warn(`Sheet ${sheetName}: Could not find date range row`);
    return records;
  }

  // Extract date range — scan cols 0-5 for the "To" string
  let dateRangeStr = null;
  for (let c = 0; c <= 5; c++) {
    const val = getCellValue(ws, landmarks.dateRangeRow, c);
    if (val && val.includes(' To ')) { dateRangeStr = val; break; }
  }
  // Sometimes the date range spans multiple cells — concatenate
  if (!dateRangeStr) {
    let parts = [];
    for (let c = 0; c <= 10; c++) {
      const val = getCellValue(ws, landmarks.dateRangeRow, c);
      if (val) parts.push(val);
    }
    dateRangeStr = parts.join(' ');
  }

  const dateInfo = parseDateRange(dateRangeStr);
  if (!dateInfo) {
    console.warn(`Sheet ${sheetName}: Could not parse date range from: ${dateRangeStr}`);
    return records;
  }

  // Company: scan the company row for a value
  let company = null;
  if (landmarks.companyRow >= 0) {
    for (let c = 1; c <= 15; c++) {
      const val = getCellValue(ws, landmarks.companyRow, c);
      if (val && !val.toLowerCase().includes('company') && !val.toLowerCase().includes('printed')) {
        company = val;
        break;
      }
    }
  }

  const { month, year } = dateInfo;

  // Day header row
  if (landmarks.dayHeaderRow < 0) {
    console.warn(`Sheet ${sheetName}: Could not find day header row`);
    return records;
  }

  const colToDayMap = buildColToDayMap(ws, landmarks.dayHeaderRow, dateInfo);
  const dayColumns = Object.keys(colToDayMap).map(Number);

  if (dayColumns.length === 0) {
    console.warn(`Sheet ${sheetName}: No day columns found in row ${landmarks.dayHeaderRow}`);
    return records;
  }

  // Parse employee blocks — start scanning from after the day header row
  let currentDepartment = '';
  const startRow = landmarks.dayHeaderRow + 1;

  for (let r = startRow; r <= range.e.r; r++) {
    const col0 = getCellValue(ws, r, 0);
    if (!col0) continue;

    // Department header
    if (col0.includes('Department')) {
      currentDepartment = findDeptValue(ws, r, range);
      continue;
    }

    // Employee block start: "Emp. Code" or "Emp. Code :"
    if (col0.startsWith('Emp.') && col0.includes('Code')) {
      const empCodeCol = findEmpCodeCol(ws, r, range);
      const empCode = getCellValue(ws, r, empCodeCol);
      const empName = findEmpName(ws, r, range);

      if (!empCode) continue;

      // Verify next rows are Status/InTime/OutTime/Total
      const statusLabel = getCellValue(ws, r + 1, 0);
      const hasStatus = statusLabel && statusLabel.toLowerCase().includes('status');
      if (!hasStatus) continue;

      // Check if InTime exists (some blocks have Status+InTime+OutTime+Total, some just Status+Total)
      const row2Label = getCellValue(ws, r + 2, 0);
      const hasInTime = row2Label && row2Label.toLowerCase().includes('intime');

      const statusRow = r + 1;
      const inTimeRow = hasInTime ? r + 2 : -1;
      const outTimeRow = hasInTime ? r + 3 : -1;
      const totalRow = hasInTime ? r + 4 : r + 2;

      // Extract data for each day
      for (const col of dayColumns) {
        const dayInfo = colToDayMap[col];
        if (!dayInfo) continue;

        const rawStatus = getCellValue(ws, statusRow, col) || '';
        const inTimeRaw = inTimeRow >= 0 ? getCellValue(ws, inTimeRow, col) : null;
        const outTimeRaw = outTimeRow >= 0 ? getCellValue(ws, outTimeRow, col) : null;
        const totalHoursRaw = getCellValue(ws, totalRow, col);

        const inTime = normalizeTime(inTimeRaw);
        const outTime = normalizeTime(outTimeRaw);
        const totalHours = totalHoursRaw && totalHoursRaw !== '00:00' ? totalHoursRaw : null;

        // Ghost-record guard: if the biometric XLS left the day completely
        // blank (no status, no IN-time, no OUT-time) treat the day as absent.
        // Without this, the empty string flowed all the way through to
        // attendance_processed and silently inflated total_payable_days in
        // Stage 6. The fallback loop in dayCalculation.js now also catches
        // unknown statuses, but normalising at the source keeps attendance_raw
        // and the Stage 5 UI consistent with reality.
        let status = rawStatus.trim();
        if (!status && !inTime && !outTime) {
          status = 'A';
        }

        records.push({
          employeeCode: String(empCode).trim(),
          employeeName: String(empName || '').trim(),
          department: currentDepartment,
          company: company ? String(company).trim() : null,
          sheetName,
          date: dayInfo.dateStr,
          dayOfWeek: dayInfo.dayOfWeek,
          dayNumber: dayInfo.dayNumber,
          month,
          year,
          status,
          inTime,
          outTime,
          totalHours,
          totalHoursDecimal: parseHoursToDecimal(totalHoursRaw)
        });
      }

      // Skip ahead past this employee block
      r += hasInTime ? 5 : 3;
    }
  }

  return records;
}

/**
 * Main parser function.
 * Parses all sheets from an EESL .xls file.
 *
 * @param {string} filePath - Absolute path to the .xls file
 * @returns {Object} { success, month, year, sheets, allRecords, error }
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

        const companies = [...new Set(records.map(r => r.company).filter(Boolean))];
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
      fileName: path.basename(filePath),
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
        name: r.employeeName || r.employeeCode,
        department: r.department,
        company: r.company
      };
    } else if (!empMap[r.employeeCode].name || empMap[r.employeeCode].name === empMap[r.employeeCode].code) {
      if (r.employeeName && r.employeeName.trim()) {
        empMap[r.employeeCode].name = r.employeeName;
      }
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
    if (!deptBreakdown[r.department]) deptBreakdown[r.department] = { employees: new Set(), records: 0 };
    deptBreakdown[r.department].employees.add(r.employeeCode);
    deptBreakdown[r.department].records++;

    if (!companyBreakdown[r.company]) companyBreakdown[r.company] = { employees: new Set(), records: 0 };
    companyBreakdown[r.company].employees.add(r.employeeCode);
    companyBreakdown[r.company].records++;

    const isPresent = ['P', 'WOP', '½P', 'WO½P'].includes(r.status);
    if (isPresent) {
      if (!r.inTime && !r.outTime) { /* both missing */ }
      else if (!r.inTime) missingInCount++;
      else if (!r.outTime) {
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
