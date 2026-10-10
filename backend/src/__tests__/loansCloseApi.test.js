/**
 * Loans PR-6 — the loan close API over HTTP with REAL JWT auth (SPEC §7:
 * "Run loan close early" = finance / admin; "Reverse a posted deduction" =
 * admin, with reason).
 *
 *   GET  /api/loans/closes                    read roles
 *   GET  /api/loans/close/preview?month&year  read roles, unrestricted users
 *   POST /api/loans/close {month, year}       finance / admin, unrestricted users
 *   POST /api/loans/deductions/:id/reverse    admin
 *
 * Month used: Sep 2026 (always ended, whatever day the suite runs on).
 */
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

let api; let db; let L; let F;

beforeAll(() => {
  api = startJwtApi({ '/api/loans': '../../routes/loans' }, { users: USERS });
  db = api.db;
  L = require('../services/loans');
  F = require('./helpers/leaveFixture');
});
afterAll(() => api.close());

/** A Sep 2026 borrower: loan disbursed 5 Aug (first EMI Sep), Stage 7 run for Sep. */
function borrowerWithSeptember() {
  const code = `C${Math.floor(Math.random() * 1e6)}`;
  db.prepare(`INSERT INTO employees (code, name, department, company, employment_type, status, date_of_joining, is_contractor, gross_salary)
              VALUES (?, 'TEST EMP', 'PRODUCTION', ?, 'Permanent', 'Active', '2024-01-01', 0, 20000)`).run(code, IND);
  const asOf = '2026-08-10';
  const r = L.requestLoan(db, { borrowerType: 'plant', employeeCode: code, company: IND, loanType: 'Personal', principal: 10000, tenure: 3, reason: 'test' }, { username: 'hr1', role: 'hr' }, { asOf });
  L.approveLoan(db, r.loanId, { username: 'boss', role: 'admin' }, { asOf });
  const d = L.disburseLoan(db, r.loanId, { username: 'fin1', role: 'finance' }, { mode: 'NEFT', reference: 'UTR', disbursedOn: '2026-08-05', agreementFilePath: 'a.pdf' }, { asOf });
  if (!d.ok) throw new Error(d.code);
  F.addDayCalc(db, { code, company: IND }, 9, 2026, { days_present: 26, total_payable_days: 26 });
  const ins = db.prepare("INSERT OR IGNORE INTO attendance_processed (employee_code, date, status_original, status_final, company, month, year) VALUES (?, ?, 'P', 'P', ?, 9, 2026)");
  for (let day = 23; day <= 30; day++) ins.run(code, `2026-09-${day}`, IND);
  F.silently(() => require('../services/recompute').recomputeSalary(db, { month: 9, year: 2026, company: IND, requestId: 'api' }));
  return { code, loanId: r.loanId };
}

test('roles and company restriction on the close endpoints', async () => {
  for (const as of ['boss', 'hr1', 'fin1', 'view1']) expect((await api.request('GET', '/api/loans/closes', { as })).status).toBe(200);
  expect((await api.request('GET', '/api/loans/closes', { as: 'sup1' })).status).toBe(403);
  expect((await api.request('POST', '/api/loans/close', { as: 'hr1', body: { month: 9, year: 2026 } })).status).toBe(403);
  expect((await api.request('POST', '/api/loans/close', { as: 'view1', body: { month: 9, year: 2026 } })).status).toBe(403);
  const r = await api.request('POST', '/api/loans/close', { as: 'finAsian', body: { month: 9, year: 2026 } });
  expect([r.status, r.body.code]).toEqual([403, 'COMPANY_NOT_ALLOWED']);
  expect((await api.request('GET', '/api/loans/close/preview?month=9&year=2026', { as: 'finAsian' })).status).toBe(403);
  expect((await api.request('POST', '/api/loans/close', { as: 'fin1', body: { month: 13, year: 2026 } })).body.code).toBe('MONTH_REQUIRED');
  // nothing to close yet → 400 NOT_NEEDED, nothing written
  const nn = await api.request('POST', '/api/loans/close', { as: 'fin1', body: { month: 9, year: 2026 } });
  expect([nn.status, nn.body.code]).toEqual([400, 'NOT_NEEDED']);
  expect(db.prepare('SELECT COUNT(*) AS n FROM loan_closes').get().n).toBe(0);
});

test('preview → manual close by finance → 409 on a second close → admin reversal', async () => {
  const { code, loanId } = borrowerWithSeptember();
  const p = await api.request('GET', '/api/loans/close/preview?month=9&year=2026', { as: 'view1' });
  expect(p.status).toBe(200);
  expect(p.body.data).toMatchObject({ readiness: { ok: true }, wouldPost: { count: 1, amount: 3334 }, held: 0 });

  const c = await api.request('POST', '/api/loans/close', { as: 'fin1', body: { month: 9, year: 2026 } });
  expect(c.status).toBe(201);
  expect(c.body.data).toMatchObject({ posted: 1, postedAmount: 3334, trigger: 'manual' });
  expect(db.prepare('SELECT run_by, trigger_kind FROM loan_closes').get()).toEqual({ run_by: 'fin1', trigger_kind: 'manual' });
  const again = await api.request('POST', '/api/loans/close', { as: 'boss', body: { month: 9, year: 2026 } });
  expect([again.status, again.body.code]).toEqual([409, 'ALREADY_CLOSED']);
  const list = await api.request('GET', '/api/loans/closes', { as: 'view1' });
  expect(list.body.data[0]).toMatchObject({ month: 9, year: 2026, payroll: 'plant', posted_count: 1, notes: expect.objectContaining({ mismatches: [] }) });

  const ded = db.prepare('SELECT id FROM loan_deductions WHERE loan_id = ?').get(loanId).id;
  expect((await api.request('POST', `/api/loans/deductions/${ded}/reverse`, { as: 'fin1', body: { reason: 'salary was not paid' } })).status).toBe(403);
  expect((await api.request('POST', `/api/loans/deductions/${ded}/reverse`, { as: 'boss', body: { reason: 'short' } })).body.code).toBe('REASON_TOO_SHORT');
  expect((await api.request('POST', '/api/loans/deductions/999999/reverse', { as: 'boss', body: { reason: 'salary was not paid' } })).status).toBe(404);
  const rv = await api.request('POST', `/api/loans/deductions/${ded}/reverse`, { as: 'boss', body: { reason: 'salary was not paid' } });
  expect(rv.status).toBe(200);
  expect(rv.body.data).toMatchObject({ amount: 3334, effectivePosted: 0, employeeCode: code });
  expect(L.reconcileLoan(db, loanId).problems).toEqual([]);
  const loan = await api.request('GET', `/api/loans/${loanId}`, { as: 'view1' });
  expect(loan.body.data.reconciliation).toMatchObject({ ok: true, adjusted: 3334, balance: 10000 });
});

test('loan detail lists payroll deductions with their opposite entries (PR-6b)', async () => {
  const loanId = db.prepare("SELECT loan_id FROM loan_adjustments WHERE kind = 'reversal' ORDER BY id LIMIT 1").get().loan_id;
  const r = await api.request('GET', `/api/loans/${loanId}`, { as: 'view1' });
  expect(r.status).toBe(200);
  const ded = db.prepare('SELECT id FROM loan_deductions WHERE loan_id = ?').get(loanId).id;
  expect(r.body.data.deductions).toEqual([expect.objectContaining({
    id: ded, month: 9, year: 2026, state: 'posted', amount: 3334, adjusted: 3334, effective_posted: 0,
  })]);
  expect(r.body.data.adjustments).toEqual([expect.objectContaining({
    deduction_id: ded, kind: 'reversal', amount: 3334, actor: 'boss', reason: 'salary was not paid',
  })]);
  // the reversal returned the amount as a new last instalment
  const added = r.body.data.adjustments[0].added_instalment_id;
  expect(r.body.data.instalments.find((i) => i.id === added)).toMatchObject({ origin: 'reversal', amount_due: 3334 });
});

test('a loan with no payroll activity returns empty deductions and adjustments', async () => {
  const code = `R${Math.floor(Math.random() * 1e6)}`;
  db.prepare(`INSERT INTO employees (code, name, department, company, employment_type, status, date_of_joining, is_contractor, gross_salary)
              VALUES (?, 'TEST EMP', 'PRODUCTION', ?, 'Permanent', 'Active', '2024-01-01', 0, 20000)`).run(code, IND);
  const q = L.requestLoan(db, { borrowerType: 'plant', employeeCode: code, company: IND, loanType: 'Personal', principal: 5000, tenure: 2, reason: 'test' }, { username: 'hr1', role: 'hr' }, { asOf: '2026-08-10' });
  const r = await api.request('GET', `/api/loans/${q.loanId}`, { as: 'hr1' });
  expect(r.status).toBe(200);
  expect(r.body.data).toMatchObject({ status: 'requested', deductions: [], adjustments: [] });
});
