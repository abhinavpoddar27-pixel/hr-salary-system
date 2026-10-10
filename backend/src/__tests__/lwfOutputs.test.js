/**
 * Statutory flags PR-2 — LWF on the plant outputs (synthetic data only).
 * O1 payslip (generatePayslipData + GET /api/payroll/payslip/:code)
 * O5 /api/finance-audit/report, /api/payroll/salary-register totals
 * O3 the two plant Excel exports (STEP 5)
 * Real JWT auth (jwtApiHarness), real initSchema, real Stage 7.
 */
const http = require('http');
const XLSX = require('xlsx');
const { startJwtApi } = require('./helpers/jwtApiHarness');
const S = require('./helpers/statutoryFixture');
const { generatePayslipData } = require('../services/salaryComputation');

let api; let db;
beforeAll(() => {
  api = startJwtApi({
    '/api/payroll': '../../routes/payroll',
    '/api/finance-audit': '../../routes/financeAudit',
  }, { users: [{ username: 'boss', role: 'admin' }] });
  db = api.db;
});
afterAll(() => api.close());

/** Stage 6 row + the last 8 days present (no month-end absence hold). */
function worked(emp, month, year, payable = 26) {
  db.prepare(`INSERT INTO day_calculations (employee_code, month, year, company, days_present, total_payable_days, days_absent)
              VALUES (?, ?, ?, ?, ?, ?, 0)`).run(emp.code, month, year, emp.company, payable, payable);
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const ins = db.prepare("INSERT OR IGNORE INTO attendance_processed (employee_code, date, status_original, status_final, company, month, year) VALUES (?, ?, 'P', 'P', ?, ?, ?)");
  for (let d = last - 7; d <= last; d++) ins.run(emp.code, `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`, emp.company, month, year);
}

function person(code, { lwf = 0, pf = 0, esi = 0, gross = 15000 } = {}) {
  const emp = S.plant(db, { code, gross_salary: gross });
  S.plantStructure(db, emp, '2026-01-01', { gross_salary: gross, lwf, pf, esi });
  return emp;
}

/** Raw GET (Excel bodies are binary). */
const rawGet = (url, as = 'boss') => new Promise((resolve, reject) => {
  const req = http.request({
    host: '127.0.0.1', port: api.server.address().port, method: 'GET', path: url,
    headers: { Authorization: `Bearer ${api.tokens[as]}` },
  }, (res) => {
    const chunks = [];
    res.on('data', (c) => chunks.push(c));
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, buf: Buffer.concat(chunks) }));
  });
  req.on('error', reject);
  req.end();
});

// One shared month: O1 (flag on), O2 (flag off), O3 (flag on, held).
let ON; let OFF; let HELD;
beforeAll(() => {
  ON = person('L101', { lwf: 1, pf: 1, esi: 1 });
  OFF = person('L102', { lwf: 0, pf: 1, esi: 1 });
  HELD = person('L103', { lwf: 1 });
  worked(ON, 9, 2026); worked(OFF, 9, 2026); worked(HELD, 9, 2026, 3);
  S.computePlant(db, ON, 9, 2026); S.computePlant(db, OFF, 9, 2026); S.computePlant(db, HELD, 9, 2026);
  expect(db.prepare("SELECT salary_held FROM salary_computations WHERE employee_code = 'L103'").get().salary_held).toBe(1);
});

describe('O1 — plant payslip', () => {
  test("flag on → deductions carry { label: 'LWF (Employee)', amount: 5 } and lwfEmployer 20; deductions sum to the total", () => {
    const p = generatePayslipData(db, 'L101', 9, 2026);
    expect(p.deductions).toContainEqual({ label: 'LWF (Employee)', amount: 5 });
    expect(p.lwfEmployer).toBe(20);
    const sum = Math.round(p.deductions.reduce((s, d) => s + d.amount, 0) * 100) / 100;
    expect(sum).toBeCloseTo(p.totalDeductions, 2);
  });

  test('flag off → no LWF line, lwfEmployer 0', () => {
    const p = generatePayslipData(db, 'L102', 9, 2026);
    expect(p.deductions.find((d) => /LWF/.test(d.label))).toBeUndefined();
    expect(p.lwfEmployer).toBe(0);
  });

  test('GET /api/payroll/payslip/:code returns the same LWF line', async () => {
    const r = await api.request('GET', '/api/payroll/payslip/L101?month=9&year=2026', { as: 'boss' });
    expect(r.status).toBe(200);
    expect(r.body.data.deductions).toContainEqual({ label: 'LWF (Employee)', amount: 5 });
    expect(r.body.data.lwfEmployer).toBe(20);
  });
});

describe('O5 — finance report + register totals', () => {
  test('/api/finance-audit/report returns lwfEmployee 5 / lwfEmployer 20 (0 / 0 when off)', async () => {
    const r = await api.request('GET', '/api/finance-audit/report?month=9&year=2026', { as: 'boss' });
    expect(r.status).toBe(200);
    const rows = r.body.data.rows || r.body.data;
    const by = Object.fromEntries(rows.map((x) => [x.code, x]));
    expect(by.L101).toMatchObject({ lwfEmployee: 5, lwfEmployer: 20 });
    expect(by.L102).toMatchObject({ lwfEmployee: 0, lwfEmployer: 0 });
    expect(by.L103).toMatchObject({ lwfEmployee: 5, lwfEmployer: 20 });
  });

  test('/api/payroll/salary-register totals: totalLWFEmployee / totalLWFEmployer include held rows', async () => {
    const r = await api.request('GET', '/api/payroll/salary-register?month=9&year=2026', { as: 'boss' });
    expect(r.status).toBe(200);
    expect(r.body.totals).toMatchObject({ totalLWFEmployee: 10, totalLWFEmployer: 40, count: 3, heldCount: 1 });
  });
});


describe('O3 — plant Excel exports', () => {
  const sheetRows = (ws) => XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', blankrows: true });
  const width = (ws) => XLSX.utils.decode_range(ws['!ref']).e.c + 1;

  test('/salary-register-excel: header = data = totals = !cols = 39; LWF(EE)/LWF(ER) 5/20 next to ESI(ER); SUMMARY + CTC carry LWF', async () => {
    const r = await rawGet('/api/payroll/salary-register-excel?month=9&year=2026');
    expect(r.status).toBe(200);
    const wb = XLSX.read(r.buf, { type: 'buffer', cellStyles: true });
    const ws = wb.Sheets['PAYROLL REGISTER'];
    const rows = sheetRows(ws);
    const header = rows[3];
    expect(header).toHaveLength(39);
    expect(width(ws)).toBe(39);
    expect(ws['!cols']).toHaveLength(39);
    expect(ws['!merges'].map((m) => m.e.c)).toEqual([38, 38]);
    const H = (h) => header.indexOf(h);
    expect(H('LWF(EE)')).toBe(H('ESI(ER)') + 1);
    expect(H('LWF(ER)')).toBe(H('ESI(ER)') + 2);
    expect(H('PT')).toBe(H('ESI(ER)') + 3);

    const sc = (code) => db.prepare('SELECT * FROM salary_computations WHERE employee_code = ? AND month = 9 AND year = 2026').get(code);
    const data = rows.slice(4).filter((x) => /^L10[123]$/.test(String(x[1])));
    expect(data).toHaveLength(3);
    for (const row of data) {
      expect(row).toHaveLength(39);
      const s = sc(String(row[1]));
      expect(row[H('LWF(EE)')]).toBe(Math.round(s.lwf_employee));
      expect(row[H('LWF(ER)')]).toBe(Math.round(s.lwf_employer));
      // every column after the insert is still aligned
      expect(row[H('Total Ded')]).toBe(Math.round(s.total_deductions));
      expect(row[H('Net Salary')]).toBe(Math.round(s.net_salary));
      expect(row[H('Take Home')]).toBe(Math.round(s.take_home));
    }
    const byCode = Object.fromEntries(data.map((x) => [x[1], x]));
    expect([byCode.L101[H('LWF(EE)')], byCode.L101[H('LWF(ER)')]]).toEqual([5, 20]);
    expect([byCode.L102[H('LWF(EE)')], byCode.L102[H('LWF(ER)')]]).toEqual([0, 0]);

    const totals = rows.find((x) => x[0] === 'TOTAL');
    expect(totals).toHaveLength(39);
    expect([totals[H('LWF(EE)')], totals[H('LWF(ER)')]]).toEqual([10, 40]);
    expect(totals[H('Total Ded')]).toBe(data.reduce((s, x) => s + x[H('Total Ded')], 0));

    const sum = sheetRows(wb.Sheets.SUMMARY);
    const val = (label) => (sum.find((x) => x[0] === label) || [])[1];
    expect(val('LWF (Employee)')).toBe(10);
    expect(val('LWF (Employer)')).toBe(40);
    expect(val('Total CTC (Gross + PF(ER) + ESI(ER) + LWF(ER))'))
      .toBe(val('Total Gross Salary (CTC)') + val('PF (Employer)') + val('ESI (Employer)') + 40);
  });

  test('/salary-slip-excel SUMMARY: header/data/totals/!cols = 20, LWF after ESI; held row comments on TOT DED / NET PAYABLE / TAKE HOME', async () => {
    const r = await rawGet('/api/payroll/salary-slip-excel?month=9&year=2026');
    expect(r.status).toBe(200);
    const wb = XLSX.read(r.buf, { type: 'buffer', cellStyles: true });
    const ws = wb.Sheets.SUMMARY;
    const rows = sheetRows(ws);
    const header = rows[3];
    expect(header).toHaveLength(20);
    expect(width(ws)).toBe(20);
    expect(ws['!cols']).toHaveLength(20);
    expect(ws['!merges'].slice(0, 2).map((m) => m.e.c)).toEqual([19, 19]);
    const H = (h) => header.indexOf(h);
    expect(H('LWF')).toBe(H('ESI') + 1);
    expect([H('TOT DED'), H('NET PAYABLE'), H('TAKE HOME')]).toEqual([16, 17, 18]);

    const rowIdx = (code) => rows.findIndex((x) => x[1] === code);
    for (const code of ['L101', 'L102', 'L103']) {
      const row = rows[rowIdx(code)];
      expect(row).toHaveLength(20);
      const s = db.prepare('SELECT * FROM salary_computations WHERE employee_code = ? AND month = 9 AND year = 2026').get(code);
      expect(row[H('LWF')]).toBe(s.lwf_employee);
      expect(row[H('TOT DED')]).toBe(s.total_deductions);
      expect(row[H('NET PAYABLE')]).toBe(s.net_salary);
    }
    const totals = rows.find((x) => x[2] === 'TOTAL');
    expect(totals).toHaveLength(20);
    expect(totals[H('LWF')]).toBe(10);

    // held employee L103: caution comments on exactly the three money columns
    const held = rowIdx('L103');
    expect(String(rows[held][2])).toMatch(/HELD/);
    const commented = [];
    for (let c = 0; c < 20; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r: held, c })];
      if (cell && cell.c && cell.c.length) commented.push(c);
    }
    expect(commented).toEqual([16, 17, 18]);
  });
});
