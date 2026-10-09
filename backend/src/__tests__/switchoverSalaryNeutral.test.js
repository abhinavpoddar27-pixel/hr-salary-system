/**
 * Salary-neutral proof for the 2026 retype (ruling R-A, amendment C).
 *
 * One SILP, one Worker and one SILP carrying the legacy is_contractor=1 flag are
 * run through Stage 6 + Stage 7 before and after the real applySwitchover. Every
 * salary_computations and day_calculations value must be identical; all three
 * are non-contractors throughout, and after the retype the leave engine counts
 * them (including the is_contractor=1 one).
 */
const path = require('path');
const F = require('./helpers/leaveFixture');
const S = require('./helpers/switchoverFixture');
const { recomputeDays, recomputeSalary } = require('../services/recompute');
const { applySwitchover, CONFIRM_PHRASE } = require('../services/leaveSwitchover2026');
const { selectEligibleEmployees } = require('../services/leaveEngine');
const { isContractorForPayroll } = require('../utils/employeeClassification');

const MONTH = 3;
const YEAR = 2026;
const COMPANY = 'Indriyan Beverages Pvt Ltd';
const VOLATILE = new Set(['id', 'computed_at', 'created_at', 'updated_at', 'leave_recomputed_at', 'salary_stale',
  'ai_explanation', 'ai_explanation_at']);

function seed(db) {
  db.prepare(`INSERT INTO monthly_imports (month, year, company, file_name, status, stage_1_done)
              VALUES (?, ?, ?, 'test.xls', 'imported', 1)`).run(MONTH, YEAR, COMPANY);
  const emps = [
    S.addEmp(db, '14686', 'SILP', { company: COMPANY }),
    S.addEmp(db, '18989', 'Worker', { company: COMPANY }),
    S.addEmp(db, '17575', 'SILP', { company: COMPANY, is_contractor: 1 }),
  ];
  const ins = db.prepare(`
    INSERT INTO attendance_processed
      (employee_code, date, month, year, company, status_original, status_final,
       in_time_original, out_time_original, is_night_out_only, is_miss_punch)
    VALUES (?, ?, ?, ?, ?, ?, ?, '08:00', '18:00', 0, 0)
  `);
  emps.forEach((emp, i) => {
    for (let d = 1; d <= 31; d += 1) {
      const date = `${YEAR}-03-${String(d).padStart(2, '0')}`;
      const dow = new Date(`${date}T12:00:00Z`).getUTCDay();
      let status = dow === 0 ? 'WO' : 'P';
      if (d === 8) status = 'WOP';
      if (d === 5 + i) status = 'A';
      if (d === 12) status = '½P';
      ins.run(emp.code, date, MONTH, YEAR, COMPANY, status, status);
    }
    db.prepare(`INSERT INTO salary_structures (employee_id, basic, hra, gross_salary, effective_from, pf_applicable, esi_applicable)
                VALUES (?, 9000, 3600, 18000, '2024-01-01', 1, 1)`).run(emp.id);
    F.setBalance(db, emp, 'CL', YEAR, { opening: 7, used: 12, balance: 0 });
    F.setBalance(db, emp, 'EL', YEAR, { opening: 0, balance: 0 });
  });
  return emps;
}

function stage67(db) {
  F.silently(() => recomputeDays(db, { month: MONTH, year: YEAR, company: COMPANY }));
  F.silently(() => recomputeSalary(db, { month: MONTH, year: YEAR, company: COMPANY }));
  const strip = (rows) => rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !VOLATILE.has(k))));
  return {
    salary: strip(db.prepare('SELECT * FROM salary_computations ORDER BY employee_code').all()),
    days: strip(db.prepare('SELECT * FROM day_calculations ORDER BY employee_code').all()),
  };
}

test('Stage 6 + 7 are identical before and after the retype, including the is_contractor=1 profile', async () => {
  const { db, dir, cleanup } = S.newFileDb();
  seed(db);
  const emp = () => db.prepare("SELECT * FROM employees WHERE code IN ('14686','18989','17575') ORDER BY code").all();

  expect(emp().map(isContractorForPayroll)).toEqual([false, false, false]);
  expect(selectEligibleEmployees(db, null).map((e) => e.code)).toEqual([]);

  const before = stage67(db);
  expect(before.salary.length).toBe(3);
  expect(before.salary.every((r) => r.net_salary > 0)).toBe(true);

  const out = await applySwitchover(db, { confirm: CONFIRM_PHRASE, backupDir: path.join(dir, 'b') });
  expect(out.ok).toBe(true);
  expect(emp().map((e) => e.employment_type)).toEqual(['Permanent', 'Permanent', 'Permanent']);
  expect(emp().find((e) => e.code === '17575').is_contractor).toBe(1); // flag untouched
  expect(emp().map(isContractorForPayroll)).toEqual([false, false, false]);

  const after = stage67(db);
  expect(after.salary).toEqual(before.salary);
  expect(after.days).toEqual(before.days);

  // The engine now counts all three, the is_contractor=1 one included.
  expect(selectEligibleEmployees(db, null).map((e) => e.code)).toEqual(['14686', '17575', '18989']);

  const drift = db.prepare(`SELECT COUNT(*) c FROM salary_computations
                            WHERE ABS(net_salary - (gross_earned - total_deductions)) > 1`).get().c;
  expect(drift).toBe(0);
  cleanup();
});
