/**
 * Loans PR-8 — the sales loan close, held sweep and payslip/ledger check
 * (docs/loans/SPEC.md §5.2 r6–r8, §5.3; D-14; K10, K27, K28, K29;
 * PR-6 rulings Q5, Q7; PR-8 rulings Q2, Q7, Q8).
 *
 * Fresh real-schema database per test; sales Stage 7 through the same steps
 * as the route (salesLoanFixture.computeSalesMonth). ₹10,000 / 3 disbursed
 * 5 Oct 2026 → ₹3,334 Nov, ₹3,334 Dec, ₹3,332 Jan. Sales Nov 2026 closes on
 * 13 Dec 2026 (IST).
 */
const F = require('./helpers/leaveFixture');
const S = require('./helpers/salesLoanFixture');
const C = require('../services/loans/close');

const { IND, ALI, L } = S;
const ist = (y, m, d, hh = 1) => new Date(Date.UTC(y, m - 1, d, hh, 0, 0));
const close = (db, month, year, now, over = {}) => F.silently(() => C.runLoanClose(db, { payroll: 'sales', month, year, now, ...over }));
const sweep = (db, now) => F.silently(() => C.runHeldSweep(db, { now }));
const ded = (db, loanId, month = 11, year = 2026) => db.prepare("SELECT * FROM loan_deductions WHERE loan_id = ? AND month = ? AND year = ? AND payroll = 'sales'").get(loanId, month, year);
const ins = (db, loanId) => db.prepare('SELECT * FROM loan_instalments WHERE loan_id = ? ORDER BY sequence').all(loanId);
const notes = (db, type) => db.prepare('SELECT * FROM notifications WHERE type = ? ORDER BY id').all(type);

function setup({ reps = [{ code: 'SC1' }], company = IND } = {}) {
  const db = F.newDb();
  const loans = {};
  for (const r of reps) {
    S.addRep(db, { company, ...r });
    if (r.loan !== false) loans[r.code] = S.salesLoan(db, { code: r.code, company: r.company || company });
  }
  return { db, loans };
}

describe('readiness (K10, K27, ruling Q8)', () => {
  test('waits while the active upload is not computed; closes once it is', () => {
    const { db, loans } = setup();
    S.setUpload(db, { month: 11, year: 2026, rows: [{ code: 'SC1', days: 31 }] });
    const r = close(db, 11, 2026, ist(2026, 12, 13));
    expect(r).toMatchObject({ ok: false, code: 'STAGE7_NOT_COMPUTED', companies: [IND] });
    expect(r.message).toMatch(/sales payroll for 11\/2026 is not computed yet for Indriyan/);
    S.computeSalesMonth(db, { month: 11, year: 2026 });
    const c = close(db, 11, 2026, ist(2026, 12, 13));
    expect(c).toMatchObject({ ok: true, payroll: 'sales', posted: 1, postedAmount: 3334, held: 0, shortfall: 0, mismatches: [], reconciliationOk: true });
    expect(ded(db, loans.SC1)).toMatchObject({ state: 'posted', amount: 3334 });
    expect(L.getLoan(db, loans.SC1).remaining_balance).toBe(6666);
    expect(db.prepare("SELECT payroll FROM loan_closes").all()).toEqual([{ payroll: 'sales' }]);
    db.close();
  });

  test('per company: the close waits only for the company that is not computed', () => {
    const db = F.newDb();
    S.addRep(db, { code: 'SC1', company: IND });
    S.addRep(db, { code: 'SC2', company: ALI });
    S.salesLoan(db, { code: 'SC1', company: IND });
    S.salesLoan(db, { code: 'SC2', company: ALI });
    S.setUpload(db, { month: 11, year: 2026, company: IND, rows: [{ code: 'SC1', days: 31 }] });
    S.setUpload(db, { month: 11, year: 2026, company: ALI, rows: [{ code: 'SC2', days: 31 }] });
    S.computeSalesMonth(db, { month: 11, year: 2026, company: IND });
    expect(close(db, 11, 2026, ist(2026, 12, 13))).toMatchObject({ code: 'STAGE7_NOT_COMPUTED', companies: [ALI] });
    S.computeSalesMonth(db, { month: 11, year: 2026, company: ALI });
    expect(close(db, 11, 2026, ist(2026, 12, 13))).toMatchObject({ ok: true, posted: 2, postedAmount: 6668 });
    db.close();
  });

  test('catch-up: SALES_CLOSE_NOT_WIRED is gone — the sales close runs on the 13th once computed', () => {
    const { db } = setup();
    S.setUpload(db, { month: 11, year: 2026, rows: [{ code: 'SC1', days: 31 }] });
    S.computeSalesMonth(db, { month: 11, year: 2026 });
    const r = F.silently(() => C.runCatchUp(db, { now: ist(2026, 12, 13) }));
    expect(r.results).toEqual([expect.objectContaining({ payroll: 'sales', month: 11, year: 2026, ok: true })]);
    db.close();
  });
});

describe('held = status "hold" (K10) and the daily sweep', () => {
  test('a hold row is not posted; once released the sweep posts it', () => {
    const { db, loans } = setup();
    S.setUpload(db, { month: 11, year: 2026, rows: [{ code: 'SC1', days: 31 }] });
    S.computeSalesMonth(db, { month: 11, year: 2026 });
    db.prepare("UPDATE sales_salary_computations SET status = 'hold' WHERE employee_code = 'SC1'").run();
    expect(close(db, 11, 2026, ist(2026, 12, 13))).toMatchObject({ ok: true, posted: 0, held: 1 });
    expect(ded(db, loans.SC1).state).toBe('provisional');
    expect(sweep(db, ist(2026, 12, 14))).toMatchObject({ posted: 0, waiting: 1 });
    db.prepare("UPDATE sales_salary_computations SET status = 'computed' WHERE employee_code = 'SC1'").run();
    expect(sweep(db, ist(2026, 12, 15))).toMatchObject({ posted: 1, postedAmount: 3334 });
    expect(L.getLoan(db, loans.SC1).remaining_balance).toBe(6666);
    db.close();
  });

  test('still held past 60 days → moved to the end; release is guarded until Stage 7 re-runs (K28)', () => {
    const { db, loans } = setup();
    S.setUpload(db, { month: 11, year: 2026, rows: [{ code: 'SC1', days: 31 }] });
    S.computeSalesMonth(db, { month: 11, year: 2026 });
    db.prepare("UPDATE sales_salary_computations SET status = 'hold' WHERE employee_code = 'SC1'").run();
    close(db, 11, 2026, ist(2026, 12, 13));
    expect(sweep(db, ist(2027, 2, 12))).toMatchObject({ moved: 1 });
    expect(ins(db, loans.SC1).map((i) => [i.due_month, i.status, i.origin])).toEqual([
      [11, 'deferred', 'schedule'], [12, 'scheduled', 'schedule'], [1, 'scheduled', 'schedule'], [2, 'scheduled', 'held'],
    ]);
    const g = C.loanHoldReleaseCheck(db, 'SC1', 11, 2026, { payroll: 'sales', company: IND });
    expect(g).toMatchObject({ ok: false, code: 'LOAN_ROW_STALE' });
    expect(C.loanHoldReleaseCheck(db, 'SC1', 11, 2026, { payroll: 'sales', company: ALI }).ok).toBe(true); // another person
    expect(C.loanHoldReleaseCheck(db, 'SC1', 11, 2026).ok).toBe(true); // plant: no such marker
    S.computeSalesMonth(db, { month: 11, year: 2026 }); // the re-run: Nov no longer carries the loan
    expect(S.salaryRow(db, 'SC1', 11, 2026)).toMatchObject({ loan_recovery: 0, status: 'hold' });
    expect(C.loanHoldReleaseCheck(db, 'SC1', 11, 2026, { payroll: 'sales', company: IND }).ok).toBe(true);
    db.close();
  });
});

describe('no salary and payslip ≠ ledger (K6, K29, ruling Q7)', () => {
  test('a rep not in the computed upload → the instalment moves to the end as "no salary"', () => {
    const { db, loans } = setup({ reps: [{ code: 'SC1' }, { code: 'SC2', loan: false }] });
    S.setUpload(db, { month: 11, year: 2026, rows: [{ code: 'SC2', days: 31 }] });
    S.computeSalesMonth(db, { month: 11, year: 2026 });
    expect(close(db, 11, 2026, ist(2026, 12, 13))).toMatchObject({ ok: true, posted: 0, noSalary: 1 });
    expect(ins(db, loans.SC1).find((i) => i.origin === 'no_salary')).toMatchObject({ due_month: 2, due_year: 2027, amount_due: 3334 });
    db.close();
  });

  test('a stale salary row (excluded this run) is left provisional-free, its instalment left, finance told', () => {
    const { db, loans } = setup();
    const up = S.setUpload(db, { month: 11, year: 2026, rows: [{ code: 'SC1', days: 31 }] });
    S.computeSalesMonth(db, { month: 11, year: 2026 });
    db.prepare('UPDATE sales_monthly_input SET sheet_days_given = -1 WHERE upload_id = ?').run(up);
    const out = S.computeSalesMonth(db, { month: 11, year: 2026 });
    expect(out.loans.staleRows.map((r) => r.employeeCode)).toEqual(['SC1']);
    const check = C.checkPayslipLedger(db, { payroll: 'sales', month: 11, year: 2026 });
    expect(check.mismatches).toEqual([{ employeeCode: 'SC1', company: IND, payslip: 3334, ledger: 0, salaryRows: 1 }]);
    const c = close(db, 11, 2026, ist(2026, 12, 13));
    expect(c).toMatchObject({ ok: true, posted: 0, noSalary: 0 });
    expect(ins(db, loans.SC1)[0].status).toBe('scheduled');
    expect(notes(db, 'LOAN_PAYSLIP_LEDGER_MISMATCH').map((n) => n.message)).toEqual([expect.stringMatching(/^SC1 \(Indriyan.*sales 11\/2026/)]);
    db.close();
  });

  test('payslip ↔ ledger is per code + company: the same code in another company is another person', () => {
    const db = F.newDb();
    S.addRep(db, { code: 'SC1', company: IND });
    S.addRep(db, { code: 'SC1', company: ALI });
    S.salesLoan(db, { code: 'SC1', company: ALI });
    S.setUpload(db, { month: 11, year: 2026, company: IND, rows: [{ code: 'SC1', days: 31 }] });
    S.setUpload(db, { month: 11, year: 2026, company: ALI, rows: [{ code: 'SC1', days: 31 }] });
    S.computeSalesMonth(db, { month: 11, year: 2026, company: IND });
    S.computeSalesMonth(db, { month: 11, year: 2026, company: ALI });
    expect(C.checkPayslipLedger(db, { payroll: 'sales', month: 11, year: 2026 })).toMatchObject({ ok: true, checked: 1 });
    expect(close(db, 11, 2026, ist(2026, 12, 13))).toMatchObject({ ok: true, posted: 1, postedAmount: 3334 });
    db.close();
  });
});

describe('a posted sales month after the close', () => {
  test('re-run deducts exactly the posted amount; drift and component checks clean', () => {
    const { db, loans } = setup();
    S.setUpload(db, { month: 11, year: 2026, rows: [{ code: 'SC1', days: 31 }] });
    S.computeSalesMonth(db, { month: 11, year: 2026 });
    close(db, 11, 2026, ist(2026, 12, 13));
    const before = S.salaryRow(db, 'SC1', 11, 2026);
    S.computeSalesMonth(db, { month: 11, year: 2026, runId: 'run-2' });
    const after = S.salaryRow(db, 'SC1', 11, 2026);
    for (const r of [before, after]) { delete r.computed_at; delete r.sunday_rule_trace; }
    expect(after).toEqual(before);
    expect(ded(db, loans.SC1).state).toBe('posted');
    expect(db.prepare(S.SALES_DRIFT_SQL).get().n).toBe(0);
    expect(db.prepare(S.SALES_SHORT_SQL).get().n).toBe(0);
    db.close();
  });
});

describe('drift monitor: loan_payslip_matches_ledger covers sales', () => {
  const { runChecks } = require('../services/driftMonitor');
  const status = (db) => Object.fromEntries(F.silently(() => runChecks(db)).results
    .filter((r) => r.check_name.startsWith('loan_')).map((r) => [r.check_name, r.status]));
  test('pass when clean; fail on a sales payslip that disagrees with the ledger', () => {
    const { db } = setup();
    S.setUpload(db, { month: 11, year: 2026, rows: [{ code: 'SC1', days: 31 }] });
    S.computeSalesMonth(db, { month: 11, year: 2026 });
    expect(status(db)).toEqual({ loan_balance_reconciles: 'pass', loan_payslip_matches_ledger: 'pass' });
    db.prepare("UPDATE sales_salary_computations SET loan_recovery = 5 WHERE employee_code = 'SC1'").run();
    expect(status(db)).toEqual({ loan_balance_reconciles: 'pass', loan_payslip_matches_ledger: 'fail' });
    db.close();
  });
});
