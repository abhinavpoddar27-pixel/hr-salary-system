/**
 * Stage 7 runs each employee in its own SAVEPOINT (docs/loans/SPEC.md K25,
 * Loans PR-5). A throw after the salary row is written must undo that
 * employee's writes — the salary row and the applied flags — and leave every
 * other employee of the month saved.
 *
 * Real schema (initSchema), real recomputeSalary.
 */
const F = require('./helpers/leaveFixture');
const { recomputeSalary } = require('../services/recompute');

const COMPANY = 'Indriyan Beverages Pvt Ltd';
const M = 3;
const Y = 2026;

const stage7 = (db) => F.silently(() => recomputeSalary(db, { month: M, year: Y, company: COMPANY, requestId: 'sp' }));
const salaryRow = (db, code) => db.prepare('SELECT * FROM salary_computations WHERE employee_code = ? AND month = ? AND year = ?').get(code, M, Y);

function seed() {
  const db = F.newDb();
  const emps = ['SP1', 'SP2', 'SP3'].map((code) => {
    const e = F.addEmployee(db, { code, company: COMPANY });
    F.addDayCalc(db, e, M, Y, { days_present: 26, total_payable_days: 26 });
    return e;
  });
  // An approved late-coming deduction for SP2: its applied flag is flipped in
  // saveSalaryComputation, i.e. after the salary row is written.
  db.prepare(`INSERT INTO late_coming_deductions (employee_code, month, year, company, late_count, deduction_days, remark, applied_by, finance_status)
              VALUES ('SP2', ?, ?, ?, 4, 1, 'late x4', 'hr1', 'approved')`).run(M, Y, COMPANY);
  return { db, emps };
}

/** Fails SP2 AFTER its salary row is saved: clearing the stale marker is the last write. */
function failSp2AfterSave(db) {
  db.exec(`CREATE TRIGGER fail_sp2 BEFORE UPDATE OF salary_stale ON day_calculations
           WHEN NEW.employee_code = 'SP2' BEGIN SELECT RAISE(ABORT, 'injected failure for SP2'); END;`);
}

describe('recomputeSalary: per-employee savepoint', () => {
  test('a failure after the save leaves no salary row and no applied flag; the others are saved', () => {
    const { db } = seed();
    failSp2AfterSave(db);
    const out = stage7(db);
    expect(out.errors.map((e) => e.employeeCode)).toEqual(['SP2']);
    expect(out.errors[0].error).toMatch(/injected failure/);
    expect(out.results.map((r) => r.employeeCode).sort()).toEqual(['SP1', 'SP3']);
    expect(salaryRow(db, 'SP1')).toBeDefined();
    expect(salaryRow(db, 'SP3')).toBeDefined();
    expect(salaryRow(db, 'SP2')).toBeUndefined();
    expect(db.prepare("SELECT is_applied_to_salary FROM late_coming_deductions WHERE employee_code = 'SP2'").get().is_applied_to_salary).toBe(0);
    db.close();
  });

  test('a failing re-run keeps the previous salary row exactly as it was', () => {
    const { db } = seed();
    stage7(db);
    const before = salaryRow(db, 'SP2');
    expect(before.late_coming_deduction).toBeGreaterThan(0);
    // Something changes that would move SP2's pay, then the re-run fails for SP2.
    db.prepare("UPDATE day_calculations SET total_payable_days = 20, days_present = 20 WHERE employee_code = 'SP2'").run();
    failSp2AfterSave(db);
    const out = stage7(db);
    expect(out.errors.map((e) => e.employeeCode)).toEqual(['SP2']);
    expect(salaryRow(db, 'SP2')).toEqual(before);
    expect(db.prepare("SELECT is_applied_to_salary FROM late_coming_deductions WHERE employee_code = 'SP2'").get().is_applied_to_salary).toBe(1);
    db.close();
  });

  test('without a failure the result shape and rows are what they always were', () => {
    const { db } = seed();
    const out = stage7(db);
    expect(out.errors).toEqual([]);
    expect(out.results).toHaveLength(3);
    expect(out.employeeCount).toBe(3);
    const drift = db.prepare('SELECT COUNT(*) AS n FROM salary_computations WHERE ABS(net_salary - (gross_earned - total_deductions)) > 1').get().n;
    expect(drift).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS n FROM day_calculations WHERE salary_stale = 1').get().n).toBe(0);
    db.close();
  });
});
