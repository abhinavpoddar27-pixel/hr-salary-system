/**
 * Loans PR-8 — sales borrowers in the engine (docs/loans/SPEC.md §5.3, K12;
 * planner rulings Q2, Q3, Q5, 10 Oct 2026).
 *
 *  Q3  first EMI = the sales CYCLE month after the disbursement's cycle month
 *      (day ≥ 26 belongs to the next month's cycle).
 *  Q5  sales gross for eligibility = the latest salary structure (what compute
 *      pays), the master gross only as a fallback.
 *  Q2  a sales borrower is code + company: the open-loan count and the 3-month
 *      deduction history are scoped to the company.
 */
const { L, F, COMPANY, OTHER_COMPANY, ASOF, sales, activeLoan, instalments } = require('./helpers/loanFixture');
const { salesCycleMonthOf, payrollMonthOf } = require('../services/loans/months');
const { firstEmiMonth } = require('../services/loans/schedule');
const { loadBorrowerFacts, evaluateEligibility } = require('../services/loans/eligibility');
const { readLoanPolicy } = require('../services/loans/policy');

let db;
beforeEach(() => { db = F.newDb(); });

function structure(db, emp, effectiveFrom, gross) {
  db.prepare(`INSERT INTO sales_salary_structures (employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, pf_applicable, esi_applicable, pt_applicable, created_by)
              VALUES (?, ?, ?, 0, 0, 0, ?, 0, 0, 0, 'test')`).run(emp.id, effectiveFrom, gross, gross);
}

describe('sales cycle month (K12)', () => {
  test.each([
    ['2026-10-25', { month: 10, year: 2026 }],
    ['2026-10-26', { month: 11, year: 2026 }],
    ['2026-10-28', { month: 11, year: 2026 }],
    ['2026-12-26', { month: 1, year: 2027 }],
    ['2026-01-01', { month: 1, year: 2026 }],
  ])('%s → %o', (d, m) => {
    expect(salesCycleMonthOf(d)).toEqual(m);
    expect(payrollMonthOf(d, 'sales')).toEqual(m);
  });
  test('plant keeps the calendar month; invalid date → null', () => {
    expect(payrollMonthOf('2026-10-28', 'plant')).toEqual({ month: 10, year: 2026 });
    expect(salesCycleMonthOf('28/10/2026')).toBeNull();
  });
});

describe('first EMI month (ruling Q3)', () => {
  test('sales: paid 28 Oct → Dec; paid 20 Oct → Nov; plant paid 28 Oct → Nov', () => {
    expect(firstEmiMonth({ disbursedOn: '2026-10-28', closed: new Set(), payroll: 'sales' }).month).toEqual({ month: 12, year: 2026 });
    expect(firstEmiMonth({ disbursedOn: '2026-10-20', closed: new Set(), payroll: 'sales' }).month).toEqual({ month: 11, year: 2026 });
    expect(firstEmiMonth({ disbursedOn: '2026-10-28', closed: new Set() }).month).toEqual({ month: 11, year: 2026 });
  });
  test('a sales disbursement on 8 Oct starts in Nov; on 28 Oct in Dec 2026', () => {
    const s = sales(db);
    const { loanId } = activeLoan(db, { emp: s, borrowerType: 'sales', disbursedOn: '2026-10-08' });
    expect(instalments(db, loanId)[0]).toMatchObject({ due_month: 11, due_year: 2026 });
    const s2 = sales(db);
    const r = L.requestLoan(db, { borrowerType: 'sales', employeeCode: s2.code, company: COMPANY, loanType: 'Personal', principal: 6000, tenure: 3, reason: 'x' },
      { username: 'hr1', role: 'hr' }, { asOf: '2026-10-28' });
    L.approveLoan(db, r.loanId, { username: 'boss', role: 'admin' }, { asOf: '2026-10-28' });
    const d = L.disburseLoan(db, r.loanId, { username: 'fin1', role: 'finance' },
      { mode: 'NEFT', reference: 'U', disbursedOn: '2026-10-28', agreementFilePath: 'a' }, { asOf: '2026-10-28' });
    expect(d.ok).toBe(true);
    expect(d.firstEmiMonth).toEqual({ month: 12, year: 2026 });
  });
});

describe('sales eligibility (rulings Q2, Q5)', () => {
  const policy = () => readLoanPolicy(db);
  const facts = (emp, company = emp.company, asOf = ASOF) => loadBorrowerFacts(db, { borrowerType: 'sales', employeeCode: emp.code, company, asOf });

  test('gross = latest structure effective by the as-of month, not the master gross', () => {
    const s = sales(db, { gross_salary: 50000 });
    structure(db, s, '2025-01', 20000);
    structure(db, s, '2026-09', 22000);
    structure(db, s, '2027-01', 30000); // future: ignored while an effective one exists
    expect(facts(s).grossPaise).toBe(2200000);
    const v = evaluateEligibility(facts(s), { borrowerType: 'sales', company: COMPANY, loanType: 'Personal', principal: 44001, tenure: 12, asOf: ASOF }, policy());
    expect(v.refusals.map((r) => r.code)).toContain('AMOUNT_OVER_LIMIT'); // 2 × 22,000
  });
  test('only a future structure → that one; no structure → master gross', () => {
    const s = sales(db, { gross_salary: 18000 });
    expect(facts(s).grossPaise).toBe(1800000);
    structure(db, s, '2027-02', 25000);
    expect(facts(s).grossPaise).toBe(2500000);
  });
  test('open-loan count is per company: the same code in the other company does not block', () => {
    const a = sales(db, { code: 'S900', company: COMPANY });
    const b = sales(db, { code: 'S900', company: OTHER_COMPANY });
    activeLoan(db, { emp: a, borrowerType: 'sales', company: COMPANY });
    expect(facts(a).openLoanCount).toBe(1);
    expect(facts(b).openLoanCount).toBe(0);
    const v = evaluateEligibility(facts(b), { borrowerType: 'sales', company: OTHER_COMPANY, loanType: 'Personal', principal: 6000, tenure: 3, asOf: ASOF }, policy());
    expect(v.eligible).toBe(true);
  });
  test('deduction history is per company', () => {
    const a = sales(db, { code: 'S901', company: COMPANY });
    sales(db, { code: 'S901', company: OTHER_COMPANY });
    const row = (company, gross, other) => db.prepare(`INSERT INTO sales_salary_computations (employee_code, month, year, company, days_given, total_days, calendar_days, earned_ratio, gross_earned, other_deductions, total_deductions, net_salary)
                                       VALUES ('S901', 9, 2026, ?, 30, 30, 31, 1, ?, ?, ?, ?)`).run(company, gross, other, other, gross - other);
    row(COMPANY, 20000, 1000);
    row(OTHER_COMPANY, 90000, 50000);
    const h = facts(a).history;
    expect(h).toMatchObject({ months: 1, earnedBasePaise: 2000000, totalDeductionsPaise: 100000 });
  });
});
