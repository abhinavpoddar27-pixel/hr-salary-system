/**
 * Statutory flags PR-3 — LWF register (services/lwfRegister.js + GET /api/reports/lwf-register).
 *   F10 plant 5 / 20 rows + sales rows from REAL computes; unflagged employees absent; company
 *       subtotals and a total; XLSX header width = every row's width (and !cols); viewer 403.
 *   F11 (M2) a flagged plant row whose other deductions exceed the earned gross: lwf_employee stays 5
 *       while total_deductions = gross_earned (the cap); the register marks it capped with the
 *       shortfall (V11 component sum − total); the ECR / ESI lines still carry the full EE shares.
 * Synthetic data only.
 */
const XLSX = require('xlsx');
const http = require('http');
const S = require('./helpers/statutoryFixture');
const { buildLwfRegister, lwfRegisterWorkbook, PLANT_COMPONENTS } = require('../services/lwfRegister');
const { generatePFECR, generateESIFile } = require('../services/exportFormats');
const { startJwtApi } = require('./helpers/jwtApiHarness');

const A = S.COMPANY; const B = S.OTHER_COMPANY;
const M = 10; const Y = 2026;

function plantRep(db, { code, lwf = 0, pf = 0, esi = 0, company = A, uan = null, esiNo = null, advance = 0 }) {
  const e = S.plant(db, { code, company, uan, esi_number: esiNo, gross_salary: 15000 });
  db.prepare('UPDATE employees SET name = ? WHERE id = ?').run(`Plant ${code}`, e.id);
  S.plantStructure(db, e, '2025-01-01', { lwf, pf, esi, gross_salary: 15000 });
  S.plantMonth(db, e, M, Y, 26);
  if (advance) db.prepare('INSERT INTO salary_advances (employee_code, month, year, advance_amount, paid) VALUES (?, ?, ?, ?, 1)').run(code, M, Y, advance);
  return S.computePlant(db, e, M, Y);
}
function salesRep(db, { code, lwf = 0, company = A }) {
  const e = S.salesEmp(db, { code, company });
  db.prepare('UPDATE sales_employees SET name = ? WHERE id = ?').run(`Sales ${code}`, e.id);
  S.salesStructure(db, e, '2026-01', { lwf, gross_salary: 18000 });
  return S.computeSales(db, e, M, Y, 24);
}
/** Plant L1/L2 (A) + L3 (B) flagged, U1 unflagged; sales SL1 (A) + SL2 (B) flagged, SU1 unflagged; C1 capped (A). */
function cast(db) {
  plantRep(db, { code: 'L1', lwf: 1 }); plantRep(db, { code: 'L2', lwf: 1 }); plantRep(db, { code: 'L3', lwf: 1, company: B });
  plantRep(db, { code: 'U1', lwf: 0 });
  salesRep(db, { code: 'SL1', lwf: 1 }); salesRep(db, { code: 'SL2', lwf: 1, company: B }); salesRep(db, { code: 'SU1', lwf: 0 });
  return plantRep(db, { code: 'C1', lwf: 1, pf: 1, esi: 1, uan: '100000000901', esiNo: '1000000901', advance: 40000 });
}

describe('F10 — the register lists every LWF row of the month, plant and sales', () => {
  test('rows, subtotals, total; unflagged absent', () => {
    const db = S.newDb();
    cast(db);
    const reg = buildLwfRegister(db, { month: M, year: Y });
    expect(reg.rows.map((r) => [r.company === A ? 'A' : 'B', r.payroll, r.employee_code, r.lwf_employee, r.lwf_employer])).toEqual([
      ['B', 'Plant', 'L3', 5, 20], ['B', 'Sales', 'SL2', 5, 20],
      ['A', 'Plant', 'C1', 5, 20], ['A', 'Plant', 'L1', 5, 20], ['A', 'Plant', 'L2', 5, 20], ['A', 'Sales', 'SL1', 5, 20],
    ]);
    expect(reg.rows.some((r) => ['U1', 'SU1'].includes(r.employee_code))).toBe(false);
    expect(reg.rows.find((r) => r.employee_code === 'SL1')).toMatchObject({ employee_name: 'Sales SL1', capped: null, shortfall: null });
    expect(reg.subtotals).toEqual([
      { company: B, count: 2, plant: 1, sales: 1, lwf_employee: 10, lwf_employer: 40, capped: 0, shortfall: 0 },
      { company: A, count: 4, plant: 3, sales: 1, lwf_employee: 20, lwf_employer: 80, capped: 1, shortfall: reg.rows.find((r) => r.employee_code === 'C1').shortfall },
    ]);
    expect(reg.totals).toMatchObject({ count: 6, plant: 4, sales: 2, lwf_employee: 30, lwf_employer: 120, capped: 1 });
    expect(buildLwfRegister(db, { month: M, year: Y, company: B }).rows.map((r) => r.employee_code)).toEqual(['L3', 'SL2']);
    expect(buildLwfRegister(db, { month: 9, year: Y }).rows).toEqual([]);
    db.close();
  });

  test('XLSX: header = data = subtotal = total row width = !cols = 8', () => {
    const db = S.newDb();
    cast(db);
    const reg = buildLwfRegister(db, { month: M, year: Y });
    const { buffer, filename } = lwfRegisterWorkbook(reg);
    expect(filename).toBe('LWF_Register_Oct_2026.xlsx');
    const wb = XLSX.read(buffer, { type: 'buffer', cellStyles: true });
    const ws = wb.Sheets['LWF Register'];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', blankrows: true });
    expect(rows[0]).toEqual(['Payroll', 'Company', 'Code', 'Name', 'LWF (EE)', 'LWF (ER)', 'Capped', 'Shortfall']);
    expect(XLSX.utils.decode_range(ws['!ref']).e.c + 1).toBe(8);
    expect(ws['!cols']).toHaveLength(8);
    expect(rows.every((r) => r.length === 8)).toBe(true);
    expect(rows).toHaveLength(1 + 6 + 2 + 1);
    expect(rows[rows.length - 1].slice(0, 1).concat(rows[rows.length - 1].slice(4, 7))).toEqual(['Total', 30, 120, 1]);
    expect(rows.filter((r) => r[0] === 'Subtotal').map((r) => [r[1], r[4], r[5]])).toEqual([[B, 10, 40], [A, 20, 80]]);
    db.close();
  });
});

describe('F11 (M2) — a capped plant row: LWF due is listed, the shortfall is shown, ECR / ESI unaffected', () => {
  test('lwf_employee 5 while total = gross; register capped + shortfall; ECR / ESI carry the full EE shares', () => {
    const db = S.newDb();
    const c1 = cast(db);
    expect(c1.lwf_employee).toBe(5);
    expect(c1.total_deductions).toBeCloseTo(c1.gross_earned, 2);                 // the cap fired
    const sum = PLANT_COMPONENTS.reduce((s, k) => s + (c1[k] || 0), 0);
    expect(sum - c1.total_deductions).toBeGreaterThan(1);
    const r = buildLwfRegister(db, { month: M, year: Y }).rows.find((x) => x.employee_code === 'C1');
    expect(r).toMatchObject({ payroll: 'Plant', lwf_employee: 5, lwf_employer: 20, capped: 1, shortfall: Math.round((sum - c1.total_deductions) * 100) / 100 });
    for (const code of ['L1', 'L2', 'L3']) expect(buildLwfRegister(db, { month: M, year: Y }).rows.find((x) => x.employee_code === code)).toMatchObject({ capped: 0, shortfall: 0 });
    // the filing files list what is due, whatever the cap recovered
    expect(c1.pf_employee).toBeGreaterThan(0);
    expect(c1.esi_employee).toBeGreaterThan(0);
    const ecr = generatePFECR(db, M, Y, A);
    expect(ecr.content.split('\n').find((l) => l.startsWith('100000000901|')).split('|')[6]).toBe(String(Math.round(c1.pf_employee)));
    const esi = generateESIFile(db, M, Y, A);
    expect(esi.content.split('\n').find((l) => l.startsWith('1000000901|')).split('|')[4]).toBe(String(Math.round(c1.esi_employee)));
    db.close();
  });
});

// ── route (one harness per file, D-9) ──
let api;
beforeAll(() => {
  api = startJwtApi({ '/api/reports': '../../routes/reports' }, {
    users: [{ username: 'hr1', role: 'hr' }, { username: 'fin1', role: 'finance' }, { username: 'adm1', role: 'admin' }, { username: 'view1', role: 'viewer' }],
  });
  S.silently(() => cast(api.db));
});
afterAll(() => api.close());
function get(url, as) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: api.server.address().port, method: 'GET', path: url,
      headers: as ? { Authorization: `Bearer ${api.tokens[as]}` } : {} }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        let json = null; try { json = JSON.parse(buf.toString('utf8')); } catch { /* binary */ }
        resolve({ status: res.statusCode, headers: res.headers, json, buf });
      });
    });
    r.on('error', reject); r.end();
  });
}

describe('F10 over HTTP — GET /api/reports/lwf-register', () => {
  test('JSON rows / subtotals / totals; company filter; 400 without month / year', async () => {
    const r = await get(`/api/reports/lwf-register?month=${M}&year=${Y}`, 'hr1');
    expect(r.status).toBe(200);
    expect(r.json.data).toHaveLength(6);
    expect(r.json.totals).toMatchObject({ count: 6, lwf_employee: 30, lwf_employer: 120, capped: 1 });
    expect(r.json.subtotals.map((s) => s.company)).toEqual([B, A]);
    const b = await get(`/api/reports/lwf-register?month=${M}&year=${Y}&company=${encodeURIComponent(B)}`, 'fin1');
    expect(b.json.data.map((x) => x.employee_code)).toEqual(['L3', 'SL2']);
    expect(b.json.filename).toBe('LWF_Register_Oct_2026_Asian_Lakto_Ind_Ltd.xlsx');
    for (const u of [`/api/reports/lwf-register?year=${Y}`, `/api/reports/lwf-register?month=${M}`, `/api/reports/lwf-register?month=0&year=${Y}`]) {
      expect((await get(u, 'hr1')).status).toBe(400);
    }
  });

  test('download=xlsx: attachment, 8 columns everywhere; an odd company never breaks the header', async () => {
    const d = await get(`/api/reports/lwf-register?month=${M}&year=${Y}&download=xlsx`, 'adm1');
    expect(d.status).toBe(200);
    expect(d.headers['content-disposition']).toBe('attachment; filename="LWF_Register_Oct_2026.xlsx"');
    const rows = XLSX.utils.sheet_to_json(XLSX.read(d.buf, { type: 'buffer' }).Sheets['LWF Register'], { header: 1, defval: '' });
    expect(rows.every((x) => x.length === 8)).toBe(true);
    const odd = await get(`/api/reports/lwf-register?month=${M}&year=${Y}&download=xlsx&company=${encodeURIComponent('Wëird "Co" Ltd')}`, 'hr1');
    expect(odd.status).toBe(200);
    expect(odd.headers['content-disposition']).toBe('attachment; filename="LWF_Register_Oct_2026_Wird_Co_Ltd.xlsx"');
  });

  test('hr / finance / admin 200; viewer 403; no token 401', async () => {
    const url = `/api/reports/lwf-register?month=${M}&year=${Y}`;
    for (const as of ['hr1', 'fin1', 'adm1']) expect([as, (await get(url, as)).status]).toEqual([as, 200]);
    expect((await get(url, 'view1')).status).toBe(403);
    expect((await get(`${url}&download=xlsx`, 'view1')).status).toBe(403);
    expect((await get(url, null)).status).toBe(401);
  });
});
