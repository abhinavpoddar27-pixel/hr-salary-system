/**
 * A finance hold release must survive every later Stage 7 run.
 *
 * Production, 9 Oct 2026: 47 of 53 released salaries were held again by a
 * later Stage 7 re-run, because computeEmployeeSalary re-derives the hold from
 * the rules and the upsert writes salary_held = excluded.salary_held. The bank
 * file pays only salary_held = 0, so released people dropped out of NEFT.
 *
 * Real schema (initSchema), real recomputeSalary — the same path the
 * /compute-salary route, the job queue and import.js runReimportRecompute use.
 */
const F = require('./helpers/leaveFixture');
const { recomputeSalary } = require('../services/recompute');
const { generateBankFile } = require('../services/exportFormats');

const COMPANY = 'Indriyan Beverages Pvt Ltd';
const MONTH = 3;
const YEAR = 2026;

function stage7(db, { month = MONTH, year = YEAR, company = COMPANY } = {}) {
  return F.silently(() => recomputeSalary(db, { month, year, company }));
}

function salaryRow(db, code, month = MONTH, year = YEAR) {
  return db.prepare('SELECT * FROM salary_computations WHERE employee_code = ? AND month = ? AND year = ?')
    .get(code, month, year);
}

/** Exactly what PUT /api/payroll/salary/:code/hold-release writes (payroll.js L517-603). */
function releaseHold(db, code, { month = MONTH, year = YEAR, company = COMPANY, by = 'fin1', notes = 'paper ref #1' } = {}) {
  const before = salaryRow(db, code, month, year);
  db.prepare(`
    INSERT INTO salary_hold_releases
      (employee_code, month, year, company, hold_reason, hold_amount, released_by, release_notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(code, month, year, company, before ? before.hold_reason : '', before ? before.net_salary : 0, by, notes);
  db.prepare(`
    UPDATE salary_computations SET
      salary_held = 0, hold_released = 1, hold_released_by = ?, hold_released_at = datetime('now')
    WHERE employee_code = ? AND month = ? AND year = ?
  `).run(by, code, month, year);
}

/** An employee with bank details who will be held for < 5 payable days. */
function heldEmployee(db, code, { month = MONTH, year = YEAR, payable = 2 } = {}) {
  const emp = F.addEmployee(db, { code, company: COMPANY });
  db.prepare('UPDATE employees SET account_number = ?, ifsc_code = ? WHERE code = ?')
    .run(`ACC${code}`, 'PUNB0000100', code);
  F.addDayCalc(db, emp, month, year, { days_present: payable, total_payable_days: payable });
  return emp;
}

function driftRows(db) {
  return db.prepare(`
    SELECT employee_code FROM salary_computations
    WHERE ABS(net_salary - (gross_earned - total_deductions)) > 1
  `).all();
}

describe('finance hold release survives Stage 7', () => {
  let db;
  beforeEach(() => { db = F.newDb(); });
  afterEach(() => { db.close(); });

  test('control: a hold with no release stays held on every run', () => {
    heldEmployee(db, 'H001');
    stage7(db);
    let r = salaryRow(db, 'H001');
    expect(r.salary_held).toBe(1);
    expect(r.hold_reason).toMatch(/payable days/);
    stage7(db);
    r = salaryRow(db, 'H001');
    expect(r.salary_held).toBe(1);
    expect(r.finance_remark).toBe('');
  });

  test('release, then a Stage 7 re-run keeps the salary released', () => {
    heldEmployee(db, 'H002');
    stage7(db);
    const heldNet = salaryRow(db, 'H002').net_salary;
    releaseHold(db, 'H002');

    const out = stage7(db);
    const r = salaryRow(db, 'H002');
    expect(r.salary_held).toBe(0);
    expect(r.hold_reason).toBe('');
    expect(r.hold_released).toBe(1);              // the upsert never touches it
    expect(r.hold_released_by).toBe('fin1');
    expect(r.finance_remark).toMatch(/^Hold released by fin1 on /);
    expect(r.net_salary).toBe(heldNet);           // only the hold flag moves
    expect(out.held.map((h) => h.code)).not.toContain('H002');
  });

  test('release, then delete-and-recompute (reimport shape) keeps it released', () => {
    heldEmployee(db, 'H003');
    stage7(db);
    releaseHold(db, 'H003');

    // import.js runReimportRecompute L971: the row is deleted, then Stage 7 rebuilds it.
    db.prepare('DELETE FROM salary_computations WHERE month = ? AND year = ? AND company = ?')
      .run(MONTH, YEAR, COMPANY);
    stage7(db);

    const r = salaryRow(db, 'H003');
    expect(r.salary_held).toBe(0);
    expect(r.hold_reason).toBe('');
    expect(r.hold_released).toBe(0);              // fresh row; history lives in salary_hold_releases
    expect(r.finance_remark).toMatch(/^Hold released by fin1/);
  });

  test('a release for another month does not leak into this one', () => {
    heldEmployee(db, 'H004', { month: 3 });
    const emp = db.prepare('SELECT * FROM employees WHERE code = ?').get('H004');
    F.addDayCalc(db, emp, 4, YEAR, { days_present: 2, total_payable_days: 2 });
    stage7(db, { month: 3 });
    stage7(db, { month: 4 });
    releaseHold(db, 'H004', { month: 4 });

    stage7(db, { month: 3 });
    stage7(db, { month: 4 });
    expect(salaryRow(db, 'H004', 3).salary_held).toBe(1);
    expect(salaryRow(db, 'H004', 4).salary_held).toBe(0);
  });

  test('a release for another employee does not leak', () => {
    heldEmployee(db, 'H005');
    heldEmployee(db, 'H006');
    stage7(db);
    releaseHold(db, 'H005');
    stage7(db);
    expect(salaryRow(db, 'H005').salary_held).toBe(0);
    expect(salaryRow(db, 'H006').salary_held).toBe(1);
  });

  test('company is not part of the key: blank release company, and an all-company run', () => {
    heldEmployee(db, 'H007');
    heldEmployee(db, 'H008');
    stage7(db);
    releaseHold(db, 'H007', { company: '' });                 // 25 of 53 production rows are blank
    releaseHold(db, 'H008', { company: 'Asian Lakto Ind Ltd' }); // differs from the compute company

    stage7(db, { company: '' });                               // "All companies" passes ''
    expect(salaryRow(db, 'H007').salary_held).toBe(0);
    expect(salaryRow(db, 'H008').salary_held).toBe(0);
    stage7(db);                                                // and a company-scoped run
    expect(salaryRow(db, 'H007').salary_held).toBe(0);
    expect(salaryRow(db, 'H008').salary_held).toBe(0);
  });

  test('a release also covers the month-end absence-streak hold', () => {
    // 10 payable days but no attendance rows at all, so the month-end streak
    // check counts every working day absent → FINANCE REVIEW hold.
    heldEmployee(db, 'H009', { payable: 10 });
    stage7(db);
    expect(salaryRow(db, 'H009').hold_reason).toMatch(/FINANCE REVIEW/);
    releaseHold(db, 'H009');
    stage7(db);
    expect(salaryRow(db, 'H009').salary_held).toBe(0);
  });

  test('bank file pays the released employee and still skips the unreleased one', () => {
    heldEmployee(db, 'H010');
    heldEmployee(db, 'H011');
    stage7(db);
    releaseHold(db, 'H010');
    stage7(db);

    const bank = generateBankFile(db, MONTH, YEAR, COMPANY);
    const codes = bank.employees.map((e) => e.employee_code);
    expect(codes).toContain('H010');
    expect(codes).not.toContain('H011');
  });

  test('drift stays clean through hold, release, re-run and reimport', () => {
    heldEmployee(db, 'H012');
    heldEmployee(db, 'H013', { payable: 20 });
    stage7(db);
    releaseHold(db, 'H012');
    stage7(db);
    db.prepare('DELETE FROM salary_computations').run();
    stage7(db);
    expect(driftRows(db)).toEqual([]);
    expect(salaryRow(db, 'H012').salary_held).toBe(0);
    expect(salaryRow(db, 'H013').salary_held).toBe(1);         // streak hold, never released
  });

  test('a release on a row that is not held is a no-op and keeps the existing remark', () => {
    // Absence streak at month-end, but approved leave on record → not held, and
    // the engine writes its own finance_remark. A stray release row must not touch it.
    const emp = heldEmployee(db, 'H014', { payable: 20 });
    F.addApplication(db, emp, { start_date: '2026-03-20', end_date: '2026-03-31', days: 10 });
    stage7(db);
    const before = salaryRow(db, 'H014');
    expect(before.salary_held).toBe(0);
    expect(before.finance_remark).toMatch(/approved leave on record/);

    releaseHold(db, 'H014');
    stage7(db);
    const after = salaryRow(db, 'H014');
    expect(after.salary_held).toBe(0);
    expect(after.finance_remark).toBe(before.finance_remark);
  });
});
