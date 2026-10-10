/**
 * Loans PR-9 — report, payslip-balance and write-off Excel endpoints over HTTP
 * with REAL JWT auth. Read roles (admin, hr, finance, viewer); supervisors and
 * employees get 403; a company-restricted user sees only their companies.
 */
const XLSX = require('xlsx');
const { startJwtApi } = require('./helpers/jwtApiHarness');

const IND = 'Indriyan Beverages Pvt Ltd';
const ALI = 'Asian Lakto Ind Ltd';
const USERS = [
  { username: 'boss', role: 'admin' },
  { username: 'hr1', role: 'hr' },
  { username: 'fin1', role: 'finance' },
  { username: 'finAsian', role: 'finance', allowedCompanies: ALI },
  { username: 'view1', role: 'viewer' },
  { username: 'sup1', role: 'supervisor' },
];
const HR = { username: 'hr1', role: 'hr' };
const ADMIN = { username: 'boss', role: 'admin' };
const FIN = { username: 'fin1', role: 'finance' };

let api; let db; let L; let codes;

function borrower(company, principal) {
  const code = `R${Math.floor(Math.random() * 1e7)}`;
  db.prepare(`INSERT INTO employees (code, name, department, company, employment_type, status, date_of_joining, is_contractor, gross_salary)
              VALUES (?, 'TEST EMP', 'PRODUCTION', ?, 'Permanent', 'Active', '2024-01-01', 0, 30000)`).run(code, company);
  const asOf = '2026-10-09';
  const r = L.requestLoan(db, { borrowerType: 'plant', employeeCode: code, company, loanType: 'Personal', principal, tenure: 3, reason: 'test' }, HR, { asOf });
  L.approveLoan(db, r.loanId, ADMIN, { asOf });
  const d = L.disburseLoan(db, r.loanId, FIN, { mode: 'NEFT', reference: 'UTR', disbursedOn: '2026-10-05', agreementFilePath: 'a.pdf' }, { asOf });
  if (!d.ok) throw new Error(d.code);
  return { code, loanId: r.loanId };
}

beforeAll(() => {
  api = startJwtApi({ '/api/loans': '../../routes/loans' }, { users: USERS });
  db = api.db;
  L = require('../services/loans');
  codes = { ind: borrower(IND, 9000), ali: borrower(ALI, 6000) };
  db.prepare(`INSERT INTO sales_employees (code, name, company, status, doj, gross_salary) VALUES ('S8001', 'REP', ?, 'Active', '2024-01-01', 30000)`).run(IND);
  db.prepare(`INSERT INTO sales_salary_structures (employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, pf_applicable, esi_applicable, pt_applicable, created_by)
              VALUES ((SELECT id FROM sales_employees WHERE code = 'S8001'), '2024-01', 30000, 0, 0, 0, 30000, 0, 0, 0, 't')`).run();
  const r = L.requestLoan(db, { borrowerType: 'sales', employeeCode: 'S8001', company: IND, loanType: 'Personal', principal: 6000, tenure: 3, reason: 't' }, HR, { asOf: '2026-10-09' });
  L.approveLoan(db, r.loanId, ADMIN, { asOf: '2026-10-09' });
  L.disburseLoan(db, r.loanId, FIN, { mode: 'NEFT', reference: 'UTR', disbursedOn: '2026-10-05', agreementFilePath: 'a.pdf' }, { asOf: '2026-10-09' });
});
afterAll(() => api.close());

test('roles: read roles 200, supervisor 403; unknown report 404; bad month 400', async () => {
  for (const as of ['boss', 'hr1', 'fin1', 'view1']) expect((await api.request('GET', '/api/loans/reports/outstanding', { as })).status).toBe(200);
  expect((await api.request('GET', '/api/loans/reports/outstanding', { as: 'sup1' })).status).toBe(403);
  expect((await api.request('GET', '/api/loans/payslip-balance?employeeCode=X&month=11&year=2026', { as: 'sup1' })).status).toBe(403);
  const nf = await api.request('GET', '/api/loans/reports/nope', { as: 'hr1' });
  expect([nf.status, nf.body.code]).toEqual([404, 'REPORT_NOT_FOUND']);
  const bad = await api.request('GET', '/api/loans/reports/perquisite?fromMonth=13&fromYear=2026', { as: 'hr1' });
  expect([bad.status, bad.body.code]).toEqual([400, 'MONTH_INVALID']);
});

test('register total = the Loans "Outstanding" tile; restricted user sees only their company', async () => {
  const reg = await api.request('GET', '/api/loans/reports/outstanding', { as: 'fin1' });
  const stats = await api.request('GET', '/api/loans/stats', { as: 'fin1' });
  expect(reg.body.data.totals.balance).toBe(stats.body.data.outstanding);
  expect(reg.body.data.totals.balance).toBe(9000 + 6000 + 6000);
  const ali = await api.request('GET', '/api/loans/reports/outstanding', { as: 'finAsian' });
  expect(ali.body.data.rows.map((r) => r.company)).toEqual([ALI]);
  expect(ali.body.data.totals.balance).toBe(6000);
});

test('every report answers JSON and Excel', async () => {
  for (const name of ['outstanding', 'forecast', 'exceptions', 'leavers', 'perquisite']) {
    const j = await api.request('GET', `/api/loans/reports/${name}`, { as: 'view1' });
    expect([name, j.status, j.body.success]).toEqual([name, 200, true]);
    const x = await api.request('GET', `/api/loans/reports/${name}?format=xlsx`, { as: 'view1' });
    expect([name, x.status, x.text.slice(0, 2)]).toEqual([name, 200, 'PK']);
  }
  const f = await api.request('GET', '/api/loans/reports/forecast?fromMonth=11&fromYear=2026', { as: 'hr1' });
  expect(f.body.data).toMatchObject({ from: { month: 11, year: 2026 }, reconciles: true, total: 21000 });
  const w = await api.request('GET', '/api/loans/write-offs?month=10&year=2026&format=xlsx', { as: 'fin1' });
  expect([w.status, w.text.slice(0, 2)]).toEqual([200, 'PK']);
  const wj = await api.request('GET', '/api/loans/write-offs?month=10&year=2026', { as: 'fin1' });
  expect(wj.body).toEqual({ success: true, data: [], basis: 'writeoff', total: 0 });   // JSON unchanged
});

test('the Excel register parses back to the JSON total', async () => {
  const sheets = L.reportSheets('outstanding', L.outstandingRegister(db));
  const wb = XLSX.read(L.toXlsx(sheets), { type: 'buffer' });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets['By department'], { header: 1 });
  expect(rows[rows.length - 1][rows[0].indexOf('Outstanding ₹')]).toBe(21000);
});

test('payslip balance: plant borrower, non-borrower, sales needs company, restricted user', async () => {
  const p = await api.request('GET', `/api/loans/payslip-balance?payroll=plant&employeeCode=${codes.ind.code}&month=11&year=2026`, { as: 'hr1' });
  expect(p.body.data).toMatchObject({ show: true, total: 9000, loans: [{ loanId: codes.ind.loanId, outstandingAfter: 9000, emiState: 'none' }] });
  const none = await api.request('GET', '/api/loans/payslip-balance?payroll=plant&employeeCode=NOBODY&month=11&year=2026', { as: 'view1' });
  expect([none.status, none.body.data.show, none.body.data.loans]).toEqual([200, false, []]);
  const noCo = await api.request('GET', '/api/loans/payslip-balance?payroll=sales&employeeCode=S8001&month=11&year=2026', { as: 'hr1' });
  expect([noCo.status, noCo.body.code]).toEqual([400, 'COMPANY_REQUIRED']);
  const s = await api.request('GET', `/api/loans/payslip-balance?payroll=sales&employeeCode=S8001&company=${encodeURIComponent(IND)}&month=11&year=2026`, { as: 'hr1' });
  expect(s.body.data).toMatchObject({ show: true, total: 6000 });
  const forbidden = await api.request('GET', `/api/loans/payslip-balance?payroll=sales&employeeCode=S8001&company=${encodeURIComponent(IND)}&month=11&year=2026`, { as: 'finAsian' });
  expect([forbidden.status, forbidden.body.code]).toEqual([403, 'COMPANY_NOT_ALLOWED']);
  const hidden = await api.request('GET', `/api/loans/payslip-balance?payroll=plant&employeeCode=${codes.ind.code}&month=11&year=2026`, { as: 'finAsian' });
  expect(hidden.body.data).toMatchObject({ show: false, loans: [], total: 0 });
  const badPayroll = await api.request('GET', '/api/loans/payslip-balance?payroll=x&employeeCode=A&month=11&year=2026', { as: 'hr1' });
  expect(badPayroll.status).toBe(400);
});
