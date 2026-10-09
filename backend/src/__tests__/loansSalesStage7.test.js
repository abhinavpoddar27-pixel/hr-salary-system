/**
 * Loans PR-8 — sales Stage 7 (docs/loans/SPEC.md §5.2 r4–r5, §5.3, D-5, D-11,
 * D-12; K2, K8, K12, K29; planner rulings Q2, Q7).
 *
 * Real schema, real engine, the real sales compute ROUTE over HTTP with real
 * JWTs (POST /api/sales/compute is the only sales Stage 7 path).
 *
 * Sales month Nov 2026 = cycle 26 Oct – 25 Nov (31 days). A rep on ₹20,000
 * (basic = gross, no PF/ESI) given 31 days earns ₹20,000; the 50% cap is
 * ₹10,000. Loan ₹10,000 / 3 disbursed 5 Oct (cycle Oct) → ₹3,334 Nov, ₹3,334
 * Dec, ₹3,332 Jan.
 */
const { startJwtApi } = require('./helpers/jwtApiHarness');
const S = require('./helpers/salesLoanFixture');

const { IND, ALI } = S;
const M = 11;
const Y = 2026;

let api; let db; let L;
beforeAll(() => {
  api = startJwtApi({ '/api/sales': '../../routes/sales', '/api/loans': '../../routes/loans' },
    { users: [{ username: 'hr1', role: 'hr' }, { username: 'boss', role: 'admin' }, { username: 'fin1', role: 'finance' }] });
  db = api.db;
  L = S.L;
});
afterAll(() => api.close());

let n = 0;
const code = () => `ST${String(++n).padStart(3, '0')}`;

async function compute(month = M, year = Y, company = IND) {
  const { log, warn, error } = console;
  console.log = () => {}; console.warn = () => {}; console.error = () => {};
  try {
    const r = await api.request('POST', '/api/sales/compute', { as: 'hr1', body: { month, year, company } });
    if (r.status !== 200) throw new Error(`compute ${r.status} ${r.text}`);
    return r.body.data;
  } finally { console.log = log; console.warn = warn; console.error = error; }
}
const ded = (loanId, month = M, year = Y) => db.prepare("SELECT * FROM loan_deductions WHERE loan_id = ? AND month = ? AND year = ? AND payroll = 'sales'").get(loanId, month, year);
const eventCount = () => db.prepare('SELECT COUNT(*) AS n FROM loan_events').get().n;
/** Drift + component checks; `only` limits them to one rep (the floor test leaves one deliberate floored row). */
function expectClean(only = null) {
  const f = only ? ` AND employee_code = '${only}'` : '';
  expect(db.prepare(S.SALES_DRIFT_SQL + f).get().n).toBe(0);
  expect(db.prepare(S.SALES_SHORT_SQL + f).get().n).toBe(0);
}

describe('the sales loan step', () => {
  test('deducted in the cycle of the due month, provisional, payslip = ledger; re-run identical', async () => {
    const c = code();
    S.addRep(db, { code: c });
    const loanId = S.salesLoan(db, { code: c });
    S.setUpload(db, { month: M, year: Y, rows: [{ code: c, days: 31 }] });
    const out = await compute();
    expect(out.loans.recorded).toBe(1);
    const row = S.salaryRow(db, c, M, Y);
    expect(row).toMatchObject({ gross_earned: 20000, loan_recovery: 3334, total_deductions: 3334, net_salary: 16666 });
    expect(ded(loanId)).toMatchObject({ state: 'provisional', amount: 3334, company: IND, employee_code: c });
    expect(L.getLoan(db, loanId).remaining_balance).toBe(10000); // Stage 7 never moves a balance
    expectClean();

    const events = eventCount();
    const before = { ...row };
    const again = await compute();
    expect(again.loans.recorded).toBe(0);
    const after = S.salaryRow(db, c, M, Y);
    for (const r of [before, after]) { delete r.computed_at; delete r.sunday_rule_trace; } // both carry a compute timestamp
    expect(after).toEqual(before);
    expect(eventCount()).toBe(events);
  });

  test('loan is LAST and takes only the headroom: other deductions ₹8,000 → ₹2,000; ₹12,000 → ₹0 row', async () => {
    const c = code();
    S.addRep(db, { code: c });
    const loanId = S.salesLoan(db, { code: c });
    S.setUpload(db, { month: M, year: Y, rows: [{ code: c, days: 31 }] });
    await compute();
    db.prepare('UPDATE sales_salary_computations SET other_deductions = 8000 WHERE employee_code = ? AND month = ? AND year = ?').run(c, M, Y);
    await compute();
    expect(S.salaryRow(db, c, M, Y)).toMatchObject({ loan_recovery: 2000, total_deductions: 10000, net_salary: 10000 });
    expect(ded(loanId).amount).toBe(2000);
    db.prepare('UPDATE sales_salary_computations SET other_deductions = 12000 WHERE employee_code = ? AND month = ? AND year = ?').run(c, M, Y);
    await compute();
    expect(S.salaryRow(db, c, M, Y)).toMatchObject({ loan_recovery: 0, total_deductions: 12000, net_salary: 8000 });
    expect(ded(loanId)).toMatchObject({ state: 'provisional', amount: 0 }); // the close turns it into a shortfall (D-5)
    expectClean();
  });

  test('partial month: headroom on the EARNED gross (5 days given)', async () => {
    const c = code();
    S.addRep(db, { code: c, gross: 20000 });
    S.salesLoan(db, { code: c, principal: 18000, tenure: 3 });
    S.setUpload(db, { month: M, year: Y, rows: [{ code: c, days: 5 }] });
    await compute();
    const row = S.salaryRow(db, c, M, Y);
    const capPaise = Math.floor(Math.round(row.gross_earned * 100) * 50 / 100);
    expect(Math.round(row.loan_recovery * 100)).toBe(Math.min(600000, capPaise));
    expect(row.loan_recovery).toBeLessThan(6000);
    expectClean();
  });
});

describe('K8 for sales (ruling Q2): the loan deducts only in its own company row', () => {
  test('same code in both companies; loan on Asian Lakto; compute order does not matter', async () => {
    const c = code();
    S.addRep(db, { code: c, company: IND });
    S.addRep(db, { code: c, company: ALI });
    const loanId = S.salesLoan(db, { code: c, company: ALI });
    S.setUpload(db, { month: M, year: Y, company: IND, rows: [{ code: c, days: 31 }] });
    S.setUpload(db, { month: M, year: Y, company: ALI, rows: [{ code: c, days: 31 }] });
    await compute(M, Y, IND);
    expect(S.salaryRow(db, c, M, Y, IND).loan_recovery).toBe(0);
    expect(ded(loanId)).toBeUndefined();
    await compute(M, Y, ALI);
    expect(S.salaryRow(db, c, M, Y, ALI).loan_recovery).toBe(3334);
    await compute(M, Y, IND); // the other company again: still nothing, ALI row untouched
    expect(S.salaryRow(db, c, M, Y, IND).loan_recovery).toBe(0);
    expect(ded(loanId)).toMatchObject({ company: ALI, amount: 3334, state: 'provisional' });
    // and the Indriyan person with the same code may hold their own loan
    const own = S.salesLoan(db, { code: c, company: IND, principal: 3000, tenure: 3 });
    await compute(M, Y, IND);
    expect(S.salaryRow(db, c, M, Y, IND).loan_recovery).toBe(1000);
    expect(ded(own)).toMatchObject({ company: IND, amount: 1000 });
    expect(ded(loanId).amount).toBe(3334);
  });
});

describe('employees the run did not pay (ruling Q7)', () => {
  test('excluded this run → provisional reversed; the old salary row is NOT rewritten, reported stale', async () => {
    const c = code();
    S.addRep(db, { code: c });
    const loanId = S.salesLoan(db, { code: c });
    const up = S.setUpload(db, { month: 12, year: Y, rows: [{ code: c, days: 31 }] });
    // Dec: the second instalment
    await compute(12, Y);
    expect(ded(loanId, 12).amount).toBe(3334);
    db.prepare('UPDATE sales_monthly_input SET sheet_days_given = -1 WHERE upload_id = ?').run(up); // → excluded invalid_days_given
    const before = S.salaryRow(db, c, 12, Y);
    const out = await compute(12, Y);
    expect(out.excluded.map((x) => x.employee_code)).toContain(c);
    expect(ded(loanId, 12).state).toBe('reversed');
    expect(out.loans.staleRows).toEqual([expect.objectContaining({ employeeCode: c, loanRecovery: 3334, loanId })]);
    expect(S.salaryRow(db, c, 12, Y)).toEqual(before); // never rewritten
  });

  test('no longer in the active upload (superseded) → reversed + stale', async () => {
    const c = code();
    const other = code();
    S.addRep(db, { code: c });
    S.addRep(db, { code: other });
    const loanId = S.salesLoan(db, { code: c });
    S.setUpload(db, { month: 1, year: 2027, rows: [{ code: c, days: 31 }, { code: other, days: 31 }] });
    await compute(1, 2027);
    expect(ded(loanId, 1, 2027).amount).toBe(3332);
    S.setUpload(db, { month: 1, year: 2027, rows: [{ code: other, days: 31 }] });
    const out = await compute(1, 2027);
    expect(ded(loanId, 1, 2027).state).toBe('reversed');
    expect(out.loans.staleRows.map((x) => x.employeeCode)).toEqual([c]);
  });

  test('a run where the employee FAILS keeps both the salary row and the provisional row', async () => {
    const c = code();
    S.addRep(db, { code: c });
    const loanId = S.salesLoan(db, { code: c });
    S.setUpload(db, { month: M, year: Y, rows: [{ code: c, days: 31 }] });
    await compute();
    expect(ded(loanId).amount).toBe(3334);
    db.prepare("UPDATE policy_config SET value = '26' WHERE key = 'sales_salary_divisor_mode'").run();
    try {
      const out = await compute();
      expect(out.errors.map((e) => e.employee_code)).toContain(c);
      expect(ded(loanId)).toMatchObject({ state: 'provisional', amount: 3334 });
      expect(out.loans.staleRows).toEqual([]);
    } finally {
      db.prepare("UPDATE policy_config SET value = 'calendar' WHERE key = 'sales_salary_divisor_mode'").run();
    }
  });
});

describe('a posted month is frozen (K2) — sales', () => {
  test('re-run deducts exactly the posted amount; if pay no longer bears it, a live loan moves the rest (opposite entry)', async () => {
    const c = code();
    S.addRep(db, { code: c, company: ALI });
    const loanId = S.salesLoan(db, { code: c, company: ALI });
    S.setUpload(db, { month: 10, year: 2026, company: ALI, rows: [] }); // Oct: nothing due
    S.setUpload(db, { month: M, year: Y, company: ALI, rows: [{ code: c, days: 31 }] });
    await compute(M, Y, ALI);
    const d = ded(loanId);
    // post it the way the close does (the close itself is covered in loansSalesClose.test.js)
    expect(L.postDeduction(db, { deductionId: d.id }, S.SYS)).toMatchObject({ ok: true, posted: 3334 });
    await compute(M, Y, ALI);
    expect(S.salaryRow(db, c, M, Y, ALI).loan_recovery).toBe(3334);
    db.prepare('UPDATE sales_salary_computations SET other_deductions = 9000 WHERE employee_code = ? AND month = ? AND year = ? AND company = ?').run(c, M, Y, ALI);
    await compute(M, Y, ALI);
    const row = S.salaryRow(db, c, M, Y, ALI);
    expect(row.loan_recovery).toBe(1000);           // 10,000 cap − 9,000
    const adj = db.prepare('SELECT * FROM loan_adjustments WHERE deduction_id = ?').all(d.id);
    expect(adj).toEqual([expect.objectContaining({ kind: 'unborne', amount: 2334 })]);
    expect(L.effectivePostedPaise(db, ded(loanId))).toBe(100000); // payslip = ledger
    expect(L.reconcileLoan(db, loanId).ok).toBe(true);
    expectClean();
  });
});

describe('₹0 net floor only on rows carrying a loan (K22, ruling Q1)', () => {
  test('a no-loan row whose deductions exceed earnings keeps its negative net (unchanged behaviour)', async () => {
    const c = code();
    S.addRep(db, { code: c });
    S.setUpload(db, { month: 3, year: 2027, rows: [{ code: c, days: 31 }] });
    await compute(3, 2027);
    db.prepare('UPDATE sales_salary_computations SET other_deductions = 21000 WHERE employee_code = ? AND month = 3 AND year = 2027').run(c);
    await compute(3, 2027);
    expect(S.salaryRow(db, c, 3, 2027)).toMatchObject({ loan_recovery: 0, total_deductions: 21000, net_salary: -1000 });
  });

  test('a posted month of a COMPLETED loan that pay can no longer bear: deducted in full, net floored at ₹0', async () => {
    const c = code();
    S.addRep(db, { code: c, gross: 40000 });
    const loanId = S.salesLoan(db, { code: c, principal: 10000, tenure: 1 });
    S.setUpload(db, { month: M, year: Y, rows: [{ code: c, days: 31 }] });
    await compute();
    const d = ded(loanId);
    expect(L.postDeduction(db, { deductionId: d.id }, S.SYS)).toMatchObject({ ok: true, loanStatus: 'completed' });
    db.prepare('UPDATE sales_salary_computations SET other_deductions = 35000 WHERE employee_code = ? AND month = ? AND year = ?').run(c, M, Y);
    await compute();
    expect(S.salaryRow(db, c, M, Y)).toMatchObject({ loan_recovery: 10000, total_deductions: 45000, net_salary: 0 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE message LIKE ?").get(`%Loan ${loanId} (${c})%still deducted in full%`).n).toBe(1);
  });
});

describe('HR edits re-run the engine (K30)', () => {
  const put = (id, body) => api.request('PUT', `/api/sales/salary/${id}`, { as: 'hr1', body });

  test('other deductions up → the loan falls to the headroom left; down → back up; ledger follows', async () => {
    const c = code();
    S.addRep(db, { code: c, company: ALI });
    const loanId = S.salesLoan(db, { code: c, company: ALI });
    S.setUpload(db, { month: 12, year: Y, company: ALI, rows: [{ code: c, days: 31 }] });
    await compute(12, Y, ALI);
    const row = S.salaryRow(db, c, 12, Y, ALI);
    expect(row.loan_recovery).toBe(3334);
    let r = await put(row.id, { other_deductions: 9000 });
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ other_deductions: 9000, loan_recovery: 1000, total_deductions: 10000, net_salary: 10000 });
    expect(ded(loanId, 12).amount).toBe(1000);
    r = await put(row.id, { other_deductions: 500 });
    expect(r.body.data).toMatchObject({ loan_recovery: 3334, total_deductions: 3834, net_salary: 16166 });
    expect(ded(loanId, 12).amount).toBe(3334);
    // incentive sits outside the earned base: no change to the loan
    r = await put(row.id, { incentive_amount: 2500 });
    expect(r.body.data).toMatchObject({ loan_recovery: 3334, net_salary: 18666 });
    expectClean(c);
    const audit = db.prepare("SELECT remark FROM audit_log WHERE table_name = 'sales_salary_computations' AND record_id = ? AND action_type = 'manual_override' ORDER BY id").all(row.id);
    expect(audit[0].remark).toMatch(/loan 3334 → 1000/);
  });

  test('a no-loan row edits exactly as before (no loan_recovery write, same totals)', async () => {
    const c = code();
    S.addRep(db, { code: c, company: ALI });
    S.setUpload(db, { month: 12, year: Y, company: ALI, rows: [{ code: c, days: 31 }] });
    await compute(12, Y, ALI);
    const row = S.salaryRow(db, c, 12, Y, ALI);
    const r = await put(row.id, { other_deductions: 25000 });
    expect(r.body.data).toMatchObject({ loan_recovery: 0, total_deductions: 25000, net_salary: -5000 }); // no floor without a loan (Q1)
  });
});

describe('Hold and a posted loan (K31) / release after the held move (K28)', () => {
  const status = (id, to) => api.request('PUT', `/api/sales/salary/${id}/status`, { as: 'hr1', body: { status: to } });

  test('before posting a row may go to Hold; after posting → 409 LOAN_POSTED_NO_HOLD; register flags it', async () => {
    const c = code();
    S.addRep(db, { code: c, company: ALI });
    const loanId = S.salesLoan(db, { code: c, company: ALI });
    S.setUpload(db, { month: 1, year: 2027, company: ALI, rows: [{ code: c, days: 31 }] });
    await compute(1, 2027, ALI);
    const row = S.salaryRow(db, c, 1, 2027, ALI);
    expect((await status(row.id, 'hold')).status).toBe(200);
    expect((await status(row.id, 'computed')).status).toBe(200);
    expect(L.postDeduction(db, { deductionId: ded(loanId, 1, 2027).id }, S.SYS).ok).toBe(true);
    const r = await status(row.id, 'hold');
    expect([r.status, r.body.code]).toEqual([409, 'LOAN_POSTED_NO_HOLD']);
    expect(S.salaryRow(db, c, 1, 2027, ALI).status).toBe('computed');
    const reg = await api.request('GET', `/api/sales/salary-register?month=1&year=2027&company=${encodeURIComponent(ALI)}`, { as: 'hr1' });
    expect(reg.body.data.rows.find((x) => x.employee_code === c).loan_posted).toBe(1);
    expect((await status(row.id, 'reviewed')).status).toBe(200); // other moves unaffected
  });

  test('release refused while the held-move marker disagrees with the row; allowed after the re-run', async () => {
    const c = code();
    S.addRep(db, { code: c, company: ALI });
    const loanId = S.salesLoan(db, { code: c, company: ALI });
    S.setUpload(db, { month: 2, year: 2027, company: ALI, rows: [{ code: c, days: 31 }] });
    S.setUpload(db, { month: M, year: Y, company: ALI, rows: [{ code: c, days: 31 }] });
    await compute(M, Y, ALI);
    const row = S.salaryRow(db, c, M, Y, ALI);
    expect((await status(row.id, 'hold')).status).toBe(200);
    const insNov = db.prepare('SELECT * FROM loan_instalments WHERE loan_id = ? AND due_month = ? AND due_year = ?').get(loanId, M, Y);
    expect(L.moveInstalmentToEnd(db, { instalmentId: insNov.id, reason: 'held' }, S.SYS).ok).toBe(true);
    const r = await status(row.id, 'computed');
    expect([r.status, r.body.code]).toEqual([409, 'LOAN_ROW_STALE']);
    await compute(M, Y, ALI); // the re-run: Nov no longer carries this loan
    expect(S.salaryRow(db, c, M, Y, ALI)).toMatchObject({ loan_recovery: 0, status: 'hold' });
    expect((await status(row.id, 'computed')).status).toBe(200);
  });
});
