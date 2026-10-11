/**
 * PR-2b (owner ruling D-3) — finance-approved late-coming and early-exit deductions are taken from CONTRACTOR worker pay
 * too, from September 2026 payroll, at the contractor's own day rate (gross ÷ calendar days). OT / ED / holiday duty stay
 * contractor-free. Real schema, real recomputeSalary (the /compute-salary path). Synthetic codes CD…
 */
const F = require('./helpers/leaveFixture');
const { recomputeSalary } = require('../services/recompute');

const C = 'Indriyan Beverages Pvt Ltd';
const stage7 = (db, month, year) => F.silently(() => recomputeSalary(db, { month, year, company: C }));
const row = (db, code, month, year) => db.prepare('SELECT * FROM salary_computations WHERE employee_code = ? AND month = ? AND year = ?').get(code, month, year);
const r2 = (x) => Math.round(x * 100) / 100;

function emp(db, code, type, month, year, payable) {
  const e = F.addEmployee(db, { code, company: C, employment_type: type, is_contractor: type === 'Contract' ? 1 : 0 });
  db.prepare('UPDATE employees SET gross_salary = 30000 WHERE code = ?').run(code);
  F.addDayCalc(db, e, month, year, { days_present: payable, total_payable_days: payable });
  db.prepare('UPDATE day_calculations SET extra_duty_days = 2, holiday_duty_days = 1 WHERE employee_code = ? AND month = ? AND year = ?').run(code, month, year);
  return e;
}
let seq = 0;
function late(db, code, month, year, days, status = 'approved') {
  // applied_at is part of the row's UNIQUE key — give each row its own time
  seq++;
  db.prepare(`INSERT INTO late_coming_deductions (employee_code, month, year, company, late_count, deduction_days, remark, applied_by, finance_status, applied_at)
    VALUES (?, ?, ?, ?, 8, ?, 'test', 'hr1', ?, datetime('now', ?))`).run(code, month, year, C, days, status, `-${seq} seconds`);
}
function early(db, code, month, year, amount, type = 'half_day', status = 'approved') {
  seq++;
  const date = `${year}-${String(month).padStart(2, '0')}-${String((seq % 20) + 1).padStart(2, '0')}`;
  const det = db.prepare('INSERT INTO early_exit_detections (employee_code, date) VALUES (?, ?)').run(code, date).lastInsertRowid;
  db.prepare(`INSERT INTO early_exit_deductions (early_exit_detection_id, employee_code, company, date, deduction_type, deduction_amount,
    payroll_month, payroll_year, finance_status, hr_remark) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'test')`)
    .run(det, code, C, date, type, amount, month, year, status);
}

describe('contractor late / early deductions reach pay', () => {
  let db;
  beforeEach(() => { db = F.newDb(); });
  afterEach(() => { db.close(); });

  test('September 2026: contractor late (days × own day rate) and early (amount) are deducted; OT / ED / holiday duty still 0', () => {
    emp(db, 'CD01', 'Contract', 9, 2026, 26);
    late(db, 'CD01', 9, 2026, 1.5); early(db, 'CD01', 9, 2026, 500);
    stage7(db, 9, 2026);
    const r = row(db, 'CD01', 9, 2026);
    const dayRate = 30000 / 30;
    expect(r.late_coming_deduction).toBe(r2(1.5 * dayRate));                // 1,500
    expect(r.early_exit_deduction).toBe(500);
    expect(r.ot_pay).toBe(0); expect(r.holiday_duty_pay).toBe(0); expect(r.ed_pay || 0).toBe(0);
    expect(r.gross_earned).toBe(r2(26 / 30 * 30000));                        // 26,000
    expect(r.net_salary).toBe(r2(r.gross_earned - r.total_deductions));
    expect(r.total_deductions).toBeGreaterThanOrEqual(2000);
    expect(db.prepare("SELECT is_applied_to_salary a FROM late_coming_deductions WHERE employee_code = 'CD01'").get().a).toBe(1);
    expect(db.prepare("SELECT salary_applied a FROM early_exit_deductions WHERE employee_code = 'CD01'").get().a).toBe(1);
  });

  test('a re-run takes each deduction once', () => {
    emp(db, 'CD02', 'Contract', 10, 2026, 20);
    late(db, 'CD02', 10, 2026, 1);
    stage7(db, 10, 2026); const a = row(db, 'CD02', 10, 2026);
    stage7(db, 10, 2026); const b = row(db, 'CD02', 10, 2026);
    expect(a.late_coming_deduction).toBe(r2(30000 / 31));
    expect(b.late_coming_deduction).toBe(a.late_coming_deduction);
    expect(b.net_salary).toBe(a.net_salary);
  });

  test('pending, rejected and warning rows are not taken', () => {
    emp(db, 'CD03', 'Contract', 9, 2026, 26);
    late(db, 'CD03', 9, 2026, 1, 'pending'); late(db, 'CD03', 9, 2026, 2, 'rejected');
    early(db, 'CD03', 9, 2026, 300, 'warning'); early(db, 'CD03', 9, 2026, 400, 'half_day', 'pending');
    stage7(db, 9, 2026);
    const r = row(db, 'CD03', 9, 2026);
    expect([r.late_coming_deduction, r.early_exit_deduction]).toEqual([0, 0]);
  });

  test('before September 2026 a contractor row is still not taken (a paid month re-run does not change)', () => {
    emp(db, 'CD04', 'Contract', 8, 2026, 26);
    late(db, 'CD04', 8, 2026, 1); early(db, 'CD04', 8, 2026, 250);
    stage7(db, 8, 2026);
    const r = row(db, 'CD04', 8, 2026);
    expect([r.late_coming_deduction, r.early_exit_deduction]).toEqual([0, 0]);
    expect(db.prepare("SELECT is_applied_to_salary a FROM late_coming_deductions WHERE employee_code = 'CD04'").get().a).toBe(0);
  });

  test('company staff unchanged, in any month', () => {
    emp(db, 'CD05', 'Permanent', 8, 2026, 26); late(db, 'CD05', 8, 2026, 1);
    emp(db, 'CD06', 'Permanent', 9, 2026, 26); late(db, 'CD06', 9, 2026, 0.5); early(db, 'CD06', 9, 2026, 200);
    stage7(db, 8, 2026); stage7(db, 9, 2026);
    expect(row(db, 'CD05', 8, 2026).late_coming_deduction).toBe(r2(30000 / 31));
    const s = row(db, 'CD06', 9, 2026);
    expect([s.late_coming_deduction, s.early_exit_deduction]).toEqual([500, 200]);
    expect(s.ot_pay).toBeGreaterThan(0);                                   // staff still get OT
  });

  test('a contractor whose deductions exceed earnings is capped at earnings (net never negative)', () => {
    emp(db, 'CD07', 'Contract', 9, 2026, 2);                                // earned 2,000
    late(db, 'CD07', 9, 2026, 3);                                            // 3,000
    stage7(db, 9, 2026);
    const r = row(db, 'CD07', 9, 2026);
    expect(r.net_salary).toBe(0);
    expect(r.total_deductions).toBe(r.gross_earned);
  });

  test('no drift: net = gross earned − total deductions on every row', () => {
    emp(db, 'CD08', 'Contract', 9, 2026, 24); late(db, 'CD08', 9, 2026, 1); early(db, 'CD08', 9, 2026, 123.45);
    emp(db, 'CD09', 'Permanent', 9, 2026, 24); late(db, 'CD09', 9, 2026, 1);
    stage7(db, 9, 2026);
    expect(db.prepare('SELECT COUNT(*) n FROM salary_computations WHERE ABS(net_salary - (gross_earned - total_deductions)) > 1').get().n).toBe(0);
  });
});
