/**
 * Loans PR-8 — sales exit (SPEC §5.2 r11; D-15, D-21; K20, K32; PR-7 rulings;
 * PR-8 rulings Q4, Q6).
 *
 *   PUT /api/sales/employees/:code/mark-left?company=   flags the rep's open sales loans
 *   PUT /api/sales/employees/:code?company= {status}    Left / Exited flag them too; Inactive does not
 * Final payroll F = the sales cycle that contains the leaving date (day ≥ 26 → next month).
 * ₹10,000 / 3 disbursed 5 Oct 2026 → ₹3,334 Nov, ₹3,334 Dec, ₹3,332 Jan.
 */
const { startJwtApi } = require('./helpers/jwtApiHarness');
const F = require('./helpers/leaveFixture');
const S = require('./helpers/salesLoanFixture');
const C = require('../services/loans/close');
const { finalMonthOf } = require('../services/loans/common');
const { flagSalesBorrowerForExit } = require('../services/loans/lifecycle');

const { IND, ALI, L } = S;

let api; let db;
beforeAll(() => {
  api = startJwtApi({ '/api/sales': '../../routes/sales' },
    { users: [{ username: 'hr1', role: 'hr' }, { username: 'boss', role: 'admin' }] });
  db = api.db;
});
afterAll(() => api.close());

let n = 0;
const code = () => `SE${String(++n).padStart(3, '0')}`;
const loanRow = (id) => db.prepare('SELECT * FROM loans WHERE id = ?').get(id);
const open = (id) => db.prepare("SELECT due_month, due_year, amount_due, origin FROM loan_instalments WHERE loan_id = ? AND status IN ('scheduled','provisional') ORDER BY sequence").all(id);
const markLeft = (c, company, dol) => api.request('PUT', `/api/sales/employees/${c}/mark-left?company=${encodeURIComponent(company)}`, { as: 'hr1', body: { dol, reason: 'resigned' } });

describe('final month = the sales cycle containing the leaving date (ruling Q4)', () => {
  test.each([
    ['2026-11-25', { month: 11, year: 2026 }],
    ['2026-11-26', { month: 12, year: 2026 }],
    ['2026-12-27', { month: 1, year: 2027 }],
  ])('sales exit %s → %o; plant keeps the calendar month', (d, m) => {
    expect(finalMonthOf({ borrower_type: 'sales', exit_date: d })).toEqual(m);
    expect(finalMonthOf({ borrower_type: 'plant', exit_date: d })).toEqual({ month: Number(d.slice(5, 7)), year: Number(d.slice(0, 4)) });
  });
});

describe('PUT /mark-left (ruling Q6)', () => {
  test('leaving 27 Nov → the whole outstanding falls due in the Dec cycle; reply lists the loan', async () => {
    const c = code();
    S.addRep(db, { code: c });
    const loanId = S.salesLoan(db, { code: c });
    const r = await markLeft(c, IND, '2026-11-27');
    expect(r.status).toBe(200);
    expect(r.body.loans).toEqual([expect.objectContaining({ loanId, status: 'recover_at_exit', outstanding: 10000, finalMonth: { month: 12, year: 2026 }, finalMonthPast: false, dueInFinalPayroll: 6666 })]);
    expect(loanRow(loanId)).toMatchObject({ status: 'recover_at_exit', exit_flag: 1, exit_date: '2026-11-27' });
    expect(open(loanId)).toEqual([
      { due_month: 11, due_year: 2026, amount_due: 3334, origin: 'schedule' },
      { due_month: 12, due_year: 2026, amount_due: 6666, origin: 'schedule' },
    ]);
    expect(db.prepare("SELECT remark FROM audit_log WHERE table_name = 'sales_employees' AND employee_code = ? AND action_type = 'mark_left'").get(c).remark)
      .toMatch(/1 loan\(s\) flagged for exit recovery/);
  });

  test('only that person: the same code in the other company keeps its loan untouched', async () => {
    const c = code();
    S.addRep(db, { code: c, company: IND });
    S.addRep(db, { code: c, company: ALI });
    const ali = S.salesLoan(db, { code: c, company: ALI });
    const r = await markLeft(c, IND, '2026-11-10');
    expect(r.body.loans).toEqual([]);
    expect(loanRow(ali)).toMatchObject({ status: 'active', exit_flag: 0 });
  });

  test('a requested loan only gets the exit flag (the admin decides it)', async () => {
    const c = code();
    S.addRep(db, { code: c });
    const req = L.requestLoan(db, { borrowerType: 'sales', employeeCode: c, company: IND, loanType: 'Personal', principal: 6000, tenure: 3, reason: 'x' }, S.HR, { asOf: '2026-10-09' });
    const r = await markLeft(c, IND, '2026-11-10');
    expect(r.body.loans).toEqual([expect.objectContaining({ loanId: req.loanId, status: 'requested', outstanding: 0 })]);
    expect(loanRow(req.loanId)).toMatchObject({ status: 'requested', exit_flag: 1 });
    expect(L.approveLoan(db, req.loanId, S.ADMIN, { asOf: '2026-10-09' }).code).toBe('LOAN_EXIT_FLAGGED');
  });
});

describe('PUT /employees/:code status change (ruling Q6)', () => {
  const put = (c, company, body) => api.request('PUT', `/api/sales/employees/${c}?company=${encodeURIComponent(company)}`, { as: 'hr1', body });

  test.each([['Left'], ['Exited']])('status → %s flags the loan (exit date = dol given)', async (to) => {
    const c = code();
    S.addRep(db, { code: c });
    const loanId = S.salesLoan(db, { code: c });
    const r = await put(c, IND, { status: to, dol: '2026-12-05' });
    expect(r.status).toBe(200);
    expect(r.body.loans).toEqual([expect.objectContaining({ loanId, status: 'recover_at_exit', finalMonth: { month: 12, year: 2026 } })]);
  });
  test('status → Inactive does not flag; an unrelated edit does not either', async () => {
    const c = code();
    S.addRep(db, { code: c });
    const loanId = S.salesLoan(db, { code: c });
    expect((await put(c, IND, { status: 'Inactive' })).body.loans).toBeUndefined();
    expect((await put(c, IND, { designation: 'ASM' })).body.loans).toBeUndefined();
    expect(loanRow(loanId)).toMatchObject({ status: 'active', exit_flag: 0 });
  });
});

describe('final-payroll recovery settles the loan (fresh database)', () => {
  test('leaving 20 Nov: Nov recovers the whole ₹10,000 → the close settles it at exit', () => {
    const fdb = F.newDb();
    S.addRep(fdb, { code: 'SX1', gross: 30000 });
    const loanId = S.salesLoan(fdb, { code: 'SX1', principal: 10000, tenure: 3 });
    const f = fdb.transaction(() => flagSalesBorrowerForExit(fdb, { employeeCode: 'SX1', company: IND, exitDate: '2026-11-20', reason: 'left' }, S.HR))();
    expect(f.loans[0]).toMatchObject({ status: 'recover_at_exit', dueInFinalPayroll: 10000, finalMonth: { month: 11, year: 2026 } });
    S.setUpload(fdb, { month: 11, year: 2026, rows: [{ code: 'SX1', days: 20 }] });
    S.computeSalesMonth(fdb, { month: 11, year: 2026 });
    expect(S.salaryRow(fdb, 'SX1', 11, 2026).loan_recovery).toBe(10000);
    const c = F.silently(() => C.runLoanClose(fdb, { payroll: 'sales', month: 11, year: 2026, now: new Date(Date.UTC(2026, 11, 13, 1)) }));
    expect(c).toMatchObject({ ok: true, posted: 1, postedAmount: 10000 });
    expect(fdb.prepare('SELECT status, remaining_balance FROM loans WHERE id = ?').get(loanId))
      .toEqual({ status: 'settled_at_exit', remaining_balance: 0 });
    fdb.close();
  });

  test('loan schema not migrated → skipped with a warning, nothing thrown', () => {
    const fdb = F.newDb();
    fdb.prepare("DELETE FROM policy_config WHERE key = 'migration_loans_schema_v2_done'").run();
    const r = F.silently(() => flagSalesBorrowerForExit(fdb, { employeeCode: 'X', company: IND, exitDate: '2026-11-20' }, S.HR));
    expect(r).toEqual({ skipped: true, loans: [], alerts: [] });
    fdb.close();
  });
});
