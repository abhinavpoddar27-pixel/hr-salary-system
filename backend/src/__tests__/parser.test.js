const fs = require('fs');
const os = require('os');
const path = require('path');
const XLSX = require('xlsx');

const { parseEESLFile, parseDateRange } = require('../services/parser');

const WEEKDAY_ABBREV = ['S', 'M', 'T', 'W', 'Th', 'F', 'St'];
const WEEKDAY_NAME = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function utc(year, monthIdx, day) {
  return new Date(Date.UTC(year, monthIdx, day));
}

function abbrevFor(date) {
  return WEEKDAY_ABBREV[date.getUTCDay()];
}

function fmt(date) {
  return date.getUTCFullYear() + '-' +
         String(date.getUTCMonth() + 1).padStart(2, '0') + '-' +
         String(date.getUTCDate()).padStart(2, '0');
}

// Build an EESL-shaped sheet: title + date range + company + day headers +
// one or more employee blocks. Returns an array of arrays for aoa_to_sheet.
// EESL real exports include a 1-row separator between employee blocks; the
// parser's `r += hasInTime ? 5 : 3` skip-ahead assumes this layout.
function buildEESLRows({ dateRangeStr, company, dayHeaders, employees }) {
  const rows = [
    ['Monthly Status Report (Basic Work Duration)'],
    [dateRangeStr],
    ['Company:', company],
    [],
    ['Days', ...dayHeaders],
    ['Department:', 'BLOW MOULDING']
  ];
  for (const emp of employees) {
    rows.push(['Emp. Code :', emp.code, 'Emp. Name :', emp.name]);
    rows.push(['Status', ...emp.status]);
    rows.push(['InTime', ...emp.inTime]);
    rows.push(['OutTime', ...emp.outTime]);
    rows.push(['Total', ...emp.total]);
    rows.push([]); // EESL separator row
  }
  return rows;
}

function writeTempXlsx(rows, sheetName = 'Sheet1') {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  const tmpPath = path.join(os.tmpdir(), `parser-test-${Date.now()}-${Math.random().toString(36).slice(2)}.xlsx`);
  XLSX.writeFile(wb, tmpPath);
  return tmpPath;
}

function rmTemp(p) {
  try { fs.unlinkSync(p); } catch (_) {}
}

describe('parser — date range', () => {
  test('parseDateRange returns endMonth and endYear for full pattern', () => {
    const r = parseDateRange('Apr 30 2026  To  May 01 2026');
    expect(r).toEqual({
      month: 4, year: 2026,
      endMonth: 5, endYear: 2026,
      startDate: '2026-04-30',
      endDate: '2026-05-01'
    });
  });

  test('parseDateRange returns endMonth and endYear for partial pattern (missing end year)', () => {
    const r = parseDateRange('Mar 01 2026  To  Mar 22');
    expect(r.month).toBe(3);
    expect(r.endMonth).toBe(3);
    expect(r.year).toBe(2026);
    expect(r.endYear).toBe(2026);
    expect(r.startDate).toBe('2026-03-01');
    expect(r.endDate).toBe('2026-03-22');
  });
});

describe('parser — multi-month file (Apr 30 → May 1)', () => {
  // This is the regression fixture for the 2026-05-02 incident: a multi-month
  // EESL export overwrote April 1 attendance because the OLD parser stamped
  // every column with the start month. Day-number + weekday cross-check makes
  // this impossible now.

  let tmpPath;
  let result;

  beforeAll(async () => {
    const rows = buildEESLRows({
      dateRangeStr: 'Apr 30 2026  To  May 01 2026',
      company: 'Asian Lakto Ind Ltd',
      dayHeaders: ['30 Th', '1 F'],
      employees: [
        { code: '23216', name: 'dhanraj', status: ['A', 'A'], inTime: ['', ''], outTime: ['', ''], total: ['00:00', '00:00'] },
        { code: '23357', name: 'YOGESH KUMAR', status: ['A', 'P'], inTime: ['', '08:02'], outTime: ['', '11:58'], total: ['00:00', '03:56'] }
      ]
    });
    tmpPath = writeTempXlsx(rows);
    result = await parseEESLFile(tmpPath);
  });

  afterAll(() => rmTemp(tmpPath));

  test('parses successfully', () => {
    expect(result.success).toBe(true);
  });

  test('column 1 maps to 2026-04-30 (Thursday), not 2026-04-30 stamped wrong', () => {
    const apr30 = result.allRecords.filter(r => r.date === '2026-04-30');
    expect(apr30).toHaveLength(2);
    expect(apr30[0].dayOfWeek).toBe('Thursday');
  });

  test('column 2 maps to 2026-05-01 (Friday), NOT 2026-04-01 (the bug)', () => {
    const may1 = result.allRecords.filter(r => r.date === '2026-05-01');
    expect(may1).toHaveLength(2);
    expect(may1[0].dayOfWeek).toBe('Friday');

    // Critical: April 1 must NOT appear anywhere — that was the corruption signal
    const apr1 = result.allRecords.filter(r => r.date === '2026-04-01');
    expect(apr1).toHaveLength(0);
  });

  test('top-level month/year still report START month (filing semantics preserved)', () => {
    expect(result.month).toBe(4);
    expect(result.year).toBe(2026);
  });

  test('YOGESH KUMAR May 1 punch round-trips (P, 08:02, 11:58)', () => {
    const may1Yogesh = result.allRecords.find(r => r.date === '2026-05-01' && r.employeeCode === '23357');
    expect(may1Yogesh).toBeDefined();
    expect(may1Yogesh.status).toBe('P');
    expect(may1Yogesh.inTime).toBe('08:02');
    expect(may1Yogesh.outTime).toBe('11:58');
  });
});

describe('parser — single-month clean file (Apr 2026)', () => {
  let tmpPath;
  let result;

  beforeAll(async () => {
    const dayHeaders = [];
    const status = [];
    for (let d = 1; d <= 30; d++) {
      const date = utc(2026, 3, d);
      dayHeaders.push(`${d} ${abbrevFor(date)}`);
      status.push('A');
    }
    const rows = buildEESLRows({
      dateRangeStr: 'Apr 01 2026  To  Apr 30 2026',
      company: 'Asian Lakto Ind Ltd',
      dayHeaders,
      employees: [
        { code: '12345', name: 'TEST EMPLOYEE', status, inTime: status.map(() => ''), outTime: status.map(() => ''), total: status.map(() => '00:00') }
      ]
    });
    tmpPath = writeTempXlsx(rows);
    result = await parseEESLFile(tmpPath);
  });

  afterAll(() => rmTemp(tmpPath));

  test('parses successfully', () => {
    expect(result.success).toBe(true);
    expect(result.allRecords).toHaveLength(30);
  });

  test('every day maps to the correct date and weekday', () => {
    for (let d = 1; d <= 30; d++) {
      const date = utc(2026, 3, d);
      const expected = fmt(date);
      const expectedWeekday = WEEKDAY_NAME[date.getUTCDay()];
      const rec = result.allRecords.find(r => r.date === expected);
      expect(rec).toBeDefined();
      expect(rec.dayOfWeek).toBe(expectedWeekday);
      expect(rec.dayNumber).toBe(d);
    }
  });

  test('legacy regression: Apr 1 is Wednesday, Apr 30 is Thursday (anchors against weekday drift)', () => {
    const apr1 = result.allRecords.find(r => r.date === '2026-04-01');
    const apr30 = result.allRecords.find(r => r.date === '2026-04-30');
    expect(apr1.dayOfWeek).toBe('Wednesday');
    expect(apr30.dayOfWeek).toBe('Thursday');
  });

  test('all records carry start month=4 year=2026 (filing semantics)', () => {
    for (const r of result.allRecords) {
      expect(r.month).toBe(4);
      expect(r.year).toBe(2026);
    }
  });
});

describe('parser — cross-check failure modes', () => {
  test('throws on day-number mismatch (header says day 5 but expected day 1)', async () => {
    // Date range starts Apr 1, but first day-header column claims "5 W"
    const rows = buildEESLRows({
      dateRangeStr: 'Apr 01 2026  To  Apr 02 2026',
      company: 'Asian Lakto Ind Ltd',
      dayHeaders: ['5 W', '2 Th'],
      employees: [
        { code: '99999', name: 'TEST', status: ['A', 'A'], inTime: ['', ''], outTime: ['', ''], total: ['00:00', '00:00'] }
      ]
    });
    const tmp = writeTempXlsx(rows);
    const r = await parseEESLFile(tmp);
    rmTemp(tmp);

    expect(r.success).toBe(false);
    expect(r.error).toMatch(/day-number mismatch/i);
    expect(r.error).toContain('expected day 1');
  });

  test('throws on weekday mismatch (header says Monday but Apr 1 2026 is Wednesday)', async () => {
    const rows = buildEESLRows({
      dateRangeStr: 'Apr 01 2026  To  Apr 02 2026',
      company: 'Asian Lakto Ind Ltd',
      dayHeaders: ['1 M', '2 Th'], // dayNum 1 is correct, but Apr 1 2026 is Wednesday not Monday
      employees: [
        { code: '99999', name: 'TEST', status: ['A', 'A'], inTime: ['', ''], outTime: ['', ''], total: ['00:00', '00:00'] }
      ]
    });
    const tmp = writeTempXlsx(rows);
    const r = await parseEESLFile(tmp);
    rmTemp(tmp);

    expect(r.success).toBe(false);
    expect(r.error).toMatch(/weekday mismatch/i);
    expect(r.error).toContain('Wednesday');
  });
});
