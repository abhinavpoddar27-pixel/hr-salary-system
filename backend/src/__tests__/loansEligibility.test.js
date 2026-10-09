/**
 * Loans PR-2 — eligibility (docs/loans/SPEC.md §5.2 r2, D-4, D-13, D-17, D-23,
 * D-24; coordinator rulings 4 and 5; PR-1 ruling "Sales = sales master only").
 */
const { L, F, COMPANY, OTHER_COMPANY, ASOF, plant, sales, activeLoan } = require('./helpers/loanFixture');
const { evaluateEligibility, loadBorrowerFacts } = require('../services/loans/eligibility');
const { readLoanPolicy } = require('../services/loans/policy');

let db; let policy;
beforeEach(() => { db = F.newDb(); policy = readLoanPolicy(db); });

function check(emp, over = {}) {
  const req = { borrowerType: 'plant', company: COMPANY, loanType: 'Personal', principal: 10000, tenure: 3, asOf: ASOF, ...over };
  const facts = loadBorrowerFacts(db, { borrowerType: req.borrowerType, employeeCode: emp.code, company: req.company });
  return evaluateEligibility(facts, req, policy);
}
const codes = (v) => v.refusals.map((r) => r.code);

describe('happy paths', () => {
  test('permanent plant employee, gross 20,000', () => {
    const v = check(plant(db));
    expect(v.eligible).toBe(true);
    expect(v.emi).toBe(3334);
    expect(v.limits).toMatchObject({ maxAmount: 40000, maxEmi: 6000, maxTenure: 12 });
  });
  test.each(['SILP', 'Worker', 'permanent'])('employment type %s is eligible (case-insensitive)', (t) => {
    expect(check(plant(db, { employment_type: t })).eligible).toBe(true);
  });
  test('sales-master borrower, looked up by code + company', () => {
    const s = sales(db, { company: OTHER_COMPANY });
    expect(check(s, { borrowerType: 'sales', company: OTHER_COMPANY }).eligible).toBe(true);
    expect(codes(check(s, { borrowerType: 'sales', company: COMPANY }))).toContain('EMPLOYEE_NOT_FOUND');
  });
  test('Emergency / medical is urgent', () => {
    expect(check(plant(db), { loanType: 'Emergency / medical' }).urgent).toBe(true);
  });
});

describe('amount, tenure and EMI limits (boundaries)', () => {
  test('2× gross exactly is allowed; ₹1 over is refused', () => {
    expect(check(plant(db), { principal: 40000, tenure: 12 }).eligible).toBe(true);
    expect(codes(check(plant(db), { principal: 40001, tenure: 12 }))).toEqual(['AMOUNT_OVER_LIMIT']);
  });
  test('Emergency / medical: 3× allowed, ₹1 over refused', () => {
    expect(check(plant(db), { loanType: 'Emergency / medical', principal: 60000, tenure: 12 }).eligible).toBe(true);
    expect(codes(check(plant(db), { loanType: 'Emergency / medical', principal: 60001, tenure: 12 }))).toContain('AMOUNT_OVER_LIMIT');
  });
  test('tenure 12 allowed, 13 refused, 0 invalid', () => {
    expect(check(plant(db), { principal: 12000, tenure: 12 }).eligible).toBe(true);
    expect(codes(check(plant(db), { principal: 13000, tenure: 13 }))).toContain('TENURE_OVER_LIMIT');
    expect(codes(check(plant(db), { tenure: 0 }))).toContain('TENURE_INVALID');
  });
  test('EMI = 30% of gross exactly allowed; above refused', () => {
    expect(check(plant(db), { principal: 6000, tenure: 1 }).eligible).toBe(true);
    expect(codes(check(plant(db), { principal: 6001, tenure: 1 }))).toEqual(['EMI_OVER_CEILING']);
  });
  test('schedule that cannot be formed', () => {
    expect(codes(check(plant(db), { principal: 25, tenure: 12 }))).toContain('TENURE_TOO_LONG_FOR_AMOUNT');
  });
  test('bad amounts', () => {
    expect(codes(check(plant(db), { principal: 0 }))).toContain('AMOUNT_INVALID');
    expect(codes(check(plant(db), { principal: 100.005 }))).toContain('AMOUNT_INVALID');
  });
});

describe('who may borrow', () => {
  test('contract worker refused (type contains "contract")', () => {
    expect(codes(check(plant(db, { employment_type: 'Contract' })))).toContain('CONTRACT_NOT_ELIGIBLE');
    expect(codes(check(plant(db, { employment_type: 'Contractual Worker' })))).toContain('CONTRACT_NOT_ELIGIBLE');
  });
  test('is_contractor = 1 refused even when typed Worker (ruling 4)', () => {
    expect(codes(check(plant(db, { employment_type: 'Worker', is_contractor: 1 })))).toContain('CONTRACT_NOT_ELIGIBLE');
  });
  test('plant-master row typed Sales refused; must use the sales master', () => {
    expect(codes(check(plant(db, { employment_type: 'Sales' })))).toEqual(['SALES_USE_SALES_MASTER']);
  });
  test('unknown employment type refused', () => {
    expect(codes(check(plant(db, { employment_type: 'Trainee' })))).toContain('EMPLOYMENT_TYPE_NOT_ELIGIBLE');
  });
  test('Left / inactive refused; unknown code refused', () => {
    expect(codes(check(plant(db, { status: 'Left' })))).toContain('EMPLOYEE_NOT_ACTIVE');
    expect(codes(check({ code: 'NOPE' }))).toContain('EMPLOYEE_NOT_FOUND');
    expect(codes(check(sales(db, { status: 'Left' }), { borrowerType: 'sales' }))).toContain('EMPLOYEE_NOT_ACTIVE');
  });
  test('sales refused when "Sales" is removed from the eligible types', () => {
    F.setPolicy(db, 'loan_eligible_employment_types', '["Permanent"]');
    policy = readLoanPolicy(db);
    expect(codes(check(sales(db), { borrowerType: 'sales' }))).toContain('EMPLOYMENT_TYPE_NOT_ELIGIBLE');
  });
  test('company must be one of the two; "Default", "null", blank refused', () => {
    for (const c of ['Default', 'null', '', '  ', 'Indriyan', null]) {
      expect(codes(check(plant(db), { company: c }))).toContain('COMPANY_INVALID');
    }
    expect(check(plant(db), { company: OTHER_COMPANY }).eligible).toBe(true);
  });
  test('loan company differing from the master company is only a warning (K7)', () => {
    const v = check(plant(db, { company: COMPANY }), { company: OTHER_COMPANY });
    expect(v.eligible).toBe(true);
    expect(v.warnings.map((w) => w.code)).toContain('COMPANY_DIFFERS_FROM_MASTER');
  });
  test('loan type must be in policy; "Salary Advance" refused (K18)', () => {
    expect(codes(check(plant(db), { loanType: 'Salary Advance' }))).toContain('LOAN_TYPE_INVALID');
  });
});

describe('service and gross (ruling 5: no guessing)', () => {
  test('exactly 6 months of service passes; one day short refused', () => {
    expect(check(plant(db, { date_of_joining: '2026-04-09' })).eligible).toBe(true);
    expect(codes(check(plant(db, { date_of_joining: '2026-04-10' })))).toEqual(['MIN_SERVICE_NOT_MET']);
  });
  test('31-Aug joiner: eligible on 28 Feb (non-leap) / 29 Feb (leap), not a day earlier', () => {
    const e1 = plant(db, { date_of_joining: '2024-08-31' });
    expect(check(e1, { asOf: '2025-02-28' }).eligible).toBe(true);
    expect(codes(check(e1, { asOf: '2025-02-27' }))).toEqual(['MIN_SERVICE_NOT_MET']);
    const e2 = plant(db, { date_of_joining: '2023-08-31' });
    expect(check(e2, { asOf: '2024-02-29' }).eligible).toBe(true);
    expect(codes(check(e2, { asOf: '2024-02-28' }))).toEqual(['MIN_SERVICE_NOT_MET']);
  });
  test('missing or invalid DOJ → SERVICE_UNKNOWN', () => {
    const e = plant(db);
    db.prepare("UPDATE employees SET date_of_joining = '' WHERE code = ?").run(e.code);
    expect(codes(check(e))).toEqual(['SERVICE_UNKNOWN']);
    db.prepare("UPDATE employees SET date_of_joining = NULL WHERE code = ?").run(e.code);
    expect(codes(check(e))).toEqual(['SERVICE_UNKNOWN']);
    db.prepare("UPDATE employees SET date_of_joining = '0026-03-21' WHERE code = ?").run(e.code);
    expect(codes(check(e))).toEqual(['SERVICE_UNKNOWN']);
    expect(codes(check(sales(db, { doj: null }), { borrowerType: 'sales' }))).toEqual(['SERVICE_UNKNOWN']);
  });
  test('no gross → GROSS_UNKNOWN; salary_structures fallback used', () => {
    const e = plant(db, { gross_salary: 0 });
    expect(codes(check(e))).toContain('GROSS_UNKNOWN');
    db.prepare("INSERT INTO salary_structures (employee_id, effective_from, gross_salary) VALUES (?, '2025-01', 30000)").run(e.id);
    const v = check(e, { principal: 60000, tenure: 12 });
    expect(v.eligible).toBe(true);
    expect(v.limits.maxAmount).toBe(60000);
  });
});

describe('one open loan per person', () => {
  test('a second loan is refused while one is requested, approved or active', () => {
    const e = plant(db);
    const r = L.requestLoan(db, { borrowerType: 'plant', employeeCode: e.code, company: COMPANY, loanType: 'Personal', principal: 5000, tenure: 2, reason: 'x' }, { username: 'hr1', role: 'hr' }, { asOf: ASOF });
    expect(r.ok).toBe(true);
    expect(codes(check(e))).toEqual(['ACTIVE_LOAN_LIMIT']);
  });
  test('a completed loan does not count', () => {
    const { loanId, emp } = activeLoan(db, { principal: 3000, tenure: 1 });
    db.prepare("UPDATE loans SET status = 'completed', remaining_balance = 0 WHERE id = ?").run(loanId);
    expect(check(emp).eligible).toBe(true);
  });
  test('same code in the other master does not count', () => {
    const s = sales(db, { code: 'X1' });
    const p = plant(db, { code: 'X1' });
    activeLoan(db, { emp: p });
    expect(check(s, { borrowerType: 'sales' }).eligible).toBe(true);
  });
});

describe('deduction-load warnings (D-13, K26)', () => {
  function salary(emp, month, over = {}) {
    db.prepare(`INSERT INTO salary_computations (employee_code, month, year, company, gross_salary, gross_earned, ot_pay,
                  pf_employee, advance_recovery, total_deductions, net_salary)
                VALUES (?, ?, 2026, ?, 20000, ?, ?, ?, ?, ?, ?)`)
      .run(emp.code, month, COMPANY, over.gross_earned ?? 20000, over.ot_pay ?? 0, over.pf ?? 1800, over.adv ?? 0,
        (over.pf ?? 1800) + (over.adv ?? 0), 10000);
  }
  test('no history → note only', () => {
    expect(check(plant(db)).warnings.map((w) => w.code)).toEqual(['NO_SALARY_HISTORY']);
  });
  test('light load → no warnings; heavy load → both warnings, still eligible', () => {
    const light = plant(db);
    for (const m of [7, 8, 9]) salary(light, m);
    expect(check(light).warnings).toEqual([]);
    const heavy = plant(db);
    for (const m of [6, 7, 8, 9]) salary(heavy, m, { adv: 7000 });
    const v = check(heavy);
    expect(v.eligible).toBe(true);
    expect(v.warnings.map((w) => w.code).sort()).toEqual(['DEDUCTION_LOAD_HIGH', 'PROJECTED_RECOVERY_LOW']);
    expect(v.warnings.find((w) => w.code === 'DEDUCTION_LOAD_HIGH').loadPct).toBeCloseTo(44, 0);
  });
});
