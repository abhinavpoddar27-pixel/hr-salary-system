/**
 * Loans PR-7 — exit read endpoints over HTTP with REAL JWT auth.
 *
 *   GET /api/loans/exit-residuals                  read roles; company-restricted users see their companies only
 *   GET /api/loans/write-offs?month&year[&basis]   read roles; TDS list keyed by write-off month (ruling Q-A),
 *                                                  each row with exitDate + finalMonth; basis=final by final month
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
const HR = { username: 'hr1', role: 'hr' };
const ADMIN = { username: 'boss', role: 'admin' };
const FIN = { username: 'fin1', role: 'finance' };

let api; let db; let L;
beforeAll(() => {
  api = startJwtApi({ '/api/loans': '../../routes/loans' }, { users: USERS });
  db = api.db;
  L = require('../services/loans');
});
afterAll(() => api.close());

let n = 0;
/** ₹10,000 / 3 disbursed 5 Aug 2026. Sep is closed first, so: ₹3,334 Oct / ₹3,334 Nov / ₹3,332 Dec. */
function loan(company = IND) {
  const code = `X${++n}`;
  db.prepare(`INSERT INTO employees (code, name, department, company, employment_type, status, date_of_joining, is_contractor, gross_salary)
              VALUES (?, 'EXIT TEST', 'PRODUCTION', ?, 'Permanent', 'Active', '2024-01-01', 0, 20000)`).run(code, company);
  const asOf = '2026-08-10';
  const r = L.requestLoan(db, { borrowerType: 'plant', employeeCode: code, company, loanType: 'Personal', principal: 10000, tenure: 3, reason: 'test' }, HR, { asOf });
  L.approveLoan(db, r.loanId, ADMIN, { asOf });
  const d = L.disburseLoan(db, r.loanId, FIN, { mode: 'NEFT', reference: 'UTR', disbursedOn: '2026-08-05', agreementFilePath: 'a.pdf' }, { asOf });
  if (!d.ok) throw new Error(d.code);
  return { code, loanId: r.loanId };
}

test('exit-residuals: residual (final payroll past) vs awaiting; roles; company restriction', async () => {
  db.prepare("INSERT INTO loan_closes (month, year, payroll, run_by, trigger_kind) VALUES (9, 2026, 'plant', 'system', 'test')").run();
  const past = loan();                                   // exit in Sep (closed) → every instalment cancelled, residual at once
  L.flagForExit(db, past.loanId, HR, { exitDate: '2026-09-20' });
  const open = loan();                                   // exit in Nov → Oct stays, ₹6,666 falls due in Nov
  L.flagForExit(db, open.loanId, HR, { exitDate: '2026-11-03' });
  const other = loan(ALI);
  L.flagForExit(db, other.loanId, HR, { exitDate: '2026-11-03' });

  for (const as of ['boss', 'hr1', 'fin1', 'view1']) expect((await api.request('GET', '/api/loans/exit-residuals', { as })).status).toBe(200);
  expect((await api.request('GET', '/api/loans/exit-residuals', { as: 'sup1' })).status).toBe(403);

  const r = (await api.request('GET', '/api/loans/exit-residuals', { as: 'fin1' })).body.data;
  const res = r.residuals.find((x) => x.loanId === past.loanId);
  expect(res).toMatchObject({ employeeCode: past.code, employeeName: 'EXIT TEST', company: IND, exitDate: '2026-09-20', finalMonth: { month: 9, year: 2026 },
    balance: 10000, residual: 10000, heldPending: 0, stage: 'residual', pendingRequest: null });
  expect(r.awaitingFinalPayroll.find((x) => x.loanId === open.loanId)).toMatchObject({ finalMonth: { month: 11, year: 2026 }, dueInFinalPayroll: 6666, residual: 0 });
  expect(r.awaitingFinalPayroll.map((x) => x.loanId)).toContain(other.loanId);

  const asian = (await api.request('GET', '/api/loans/exit-residuals', { as: 'finAsian' })).body.data;
  expect([...asian.residuals, ...asian.awaitingFinalPayroll].map((x) => x.company)).toEqual([ALI]);

  // a write-off request shows on the residual row; the admin's approval settles the loan and it leaves the list
  const q = L.requestChange(db, { loanId: past.loanId, kind: 'write_off', reason: 'left, no dues to adjust' }, HR);
  expect(q.ok).toBe(true);
  expect((await api.request('GET', '/api/loans/exit-residuals', { as: 'fin1' })).body.data.residuals.find((x) => x.loanId === past.loanId).pendingRequest).toBe('write_off');
  const a = await api.request('POST', `/api/loans/requests/${q.requestId}/approve`, { as: 'boss', body: {} });
  expect(a.status).toBe(200);
  expect(L.getLoan(db, past.loanId)).toMatchObject({ status: 'settled_at_exit', remaining_balance: 0, written_off_amount: 10000 });
  expect((await api.request('GET', '/api/loans/exit-residuals', { as: 'fin1' })).body.data.residuals.map((x) => x.loanId)).not.toContain(past.loanId);

  // write-offs: by write-off month (now, IST) — and by the final month with basis=final
  const now = new Date(Date.now() + 330 * 60000);
  const wm = { month: now.getUTCMonth() + 1, year: now.getUTCFullYear() };
  const w = await api.request('GET', `/api/loans/write-offs?month=${wm.month}&year=${wm.year}`, { as: 'view1' });
  expect(w.status).toBe(200);
  expect(w.body.basis).toBe('writeoff');
  expect(w.body.data).toEqual([expect.objectContaining({ loanId: past.loanId, amount: 10000, status: 'settled_at_exit', exitDate: '2026-09-20', finalMonth: { month: 9, year: 2026 }, writeOffMonth: wm })]);
  expect(w.body.total).toBe(10000);
  const fm = await api.request('GET', '/api/loans/write-offs?month=9&year=2026&basis=final', { as: 'fin1' });
  expect(fm.body.data.map((x) => x.loanId)).toEqual([past.loanId]);
  expect((await api.request('GET', `/api/loans/write-offs?month=${wm.month}&year=${wm.year}`, { as: 'finAsian' })).body.data).toEqual([]);
  expect((await api.request('GET', '/api/loans/write-offs?month=13&year=2026', { as: 'fin1' })).body.code).toBe('MONTH_REQUIRED');
  expect((await api.request('GET', '/api/loans/write-offs?month=9&year=2026&basis=paid', { as: 'fin1' })).body.code).toBe('BASIS_INVALID');
  expect((await api.request('GET', '/api/loans/write-offs?month=9&year=2026', { as: 'sup1' })).status).toBe(403);

  // a write-off of a loan never flagged for exit has no exit fields
  const plain = loan();
  expect(L.writeOffLoan(db, { loanId: plain.loanId, reason: 'hardship', requestedBy: HR }, ADMIN).ok).toBe(true);
  const w2 = (await api.request('GET', `/api/loans/write-offs?month=${wm.month}&year=${wm.year}`, { as: 'fin1' })).body.data;
  expect(w2.find((x) => x.loanId === plain.loanId)).toMatchObject({ status: 'written_off', exitDate: null, finalMonth: null });
});
