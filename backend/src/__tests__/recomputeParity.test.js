/**
 * Golden proof for the Phase 3 extraction.
 *
 * Seeds one month of realistic attendance, runs the verbatim origin/main Stage 6
 * orchestration against one database and services/recompute.js against an
 * identical copy, then compares day_calculations field for field. The only
 * permitted differences are the two deliberate additions: HR's late deduction
 * is re-applied, and the new salary_stale / leave_recomputed_at markers.
 */
const { legacyRecomputeDays } = require('./helpers/legacyStage6');
const { recomputeDays, recomputeSalary, countStaleSalary } = require('../services/recompute');
const F = require('./helpers/leaveFixture');

const MONTH = 3;
const YEAR = 2026;
const COMPANY = 'Indriyan Beverages Pvt Ltd'; // must be canonical — see salaryComputation.CANONICAL_COMPANIES

/** Deliberately added by Phase 3 — excluded from the field-for-field compare. */
const NEW_COLUMNS = ['salary_stale', 'leave_recomputed_at', 'updated_at'];

function seed(db) {
  db.prepare(`
    INSERT INTO monthly_imports (month, year, company, file_name, status, stage_1_done)
    VALUES (?, ?, ?, 'test.xls', 'imported', 1)
  `).run(MONTH, YEAR, COMPANY);

  const employees = [
    { code: 'PAR001', employment_type: 'Permanent', weekly_off_day: 0, date_of_joining: '2023-05-01' },
    { code: 'PAR002', employment_type: 'Permanent', weekly_off_day: 0, date_of_joining: '2026-03-10' },
    { code: 'PAR003', employment_type: 'Contract', weekly_off_day: 0, date_of_joining: '2024-01-01' },
    { code: 'PAR004', employment_type: 'Permanent', weekly_off_day: 3, date_of_joining: '2022-02-02' },
  ].map((e) => F.addEmployee(db, { ...e, company: COMPANY }));

  const ins = db.prepare(`
    INSERT INTO attendance_processed
      (employee_code, date, month, year, company, status_original, status_final,
       in_time_original, out_time_original, is_night_out_only, is_miss_punch)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0)
  `);
  for (const emp of employees) {
    let weeklyOffSeen = 0;
    for (let d = 1; d <= 31; d += 1) {
      const date = `${YEAR}-03-${String(d).padStart(2, '0')}`;
      const dow = new Date(`${date}T12:00:00Z`).getUTCDay();
      let status = 'P';
      if (dow === (emp.weekly_off_day ?? 0)) {
        weeklyOffSeen += 1;
        // The second weekly off of the month was worked — exercises the
        // auto-created PENDING extra_duty_grant path on both sides.
        status = weeklyOffSeen === 2 ? 'WOP' : 'WO';
      }
      else if (d === 7) status = 'A';
      else if (d === 11) status = '½P';
      // One blank ghost row so the cleanup pass is exercised on both sides.
      if (d === 19) {
        ins.run(emp.code, date, MONTH, YEAR, COMPANY, '', '', '', '');
        continue;
      }
      ins.run(emp.code, date, MONTH, YEAR, COMPANY, status, status, '08:00', '18:00');
    }
    F.setBalance(db, emp, 'EL', YEAR, { opening: 0, accrued: 5, used: 0, balance: 5 });
    F.setBalance(db, emp, 'CL', YEAR, { opening: 7, accrued: 0, used: 0, balance: 7 });
  }

  F.addApplication(db, employees[0], {
    leave_type: 'EL', start_date: '2026-03-07', end_date: '2026-03-07', days: 1,
  });
  db.prepare(`
    INSERT INTO compensatory_off_requests
      (employee_code, employee_id, start_date, end_date, days, month, year, company, reason, hr_remark, applied_by, finance_status)
    VALUES (?, ?, '2026-03-07', '2026-03-07', 1, ?, ?, ?, 'comp off for parity fixture', 'approved by finance in fixture', 'hr1', 'approved')
  `).run(employees[3].code, employees[3].id, MONTH, YEAR, COMPANY);

  return employees;
}

function dayCalcRows(db) {
  return db.prepare('SELECT * FROM day_calculations ORDER BY employee_code').all();
}

describe('recompute.js is a faithful extraction of Stage 6', () => {
  test('day_calculations matches the origin/main orchestration field for field', () => {
    const legacyDb = F.newDb();
    const newDb = F.newDb();
    seed(legacyDb);
    seed(newDb);

    F.silently(() => legacyRecomputeDays(legacyDb, MONTH, YEAR, COMPANY));
    F.silently(() => recomputeDays(newDb, { month: MONTH, year: YEAR, company: COMPANY, requestId: 'new' }));

    const a = dayCalcRows(legacyDb);
    const b = dayCalcRows(newDb);
    expect(a.length).toBeGreaterThan(0);
    expect(b.map((r) => r.employee_code)).toEqual(a.map((r) => r.employee_code));

    const diffs = [];
    for (let i = 0; i < a.length; i += 1) {
      for (const key of Object.keys(a[i])) {
        if (NEW_COLUMNS.includes(key)) continue;
        if (b[i][key] !== a[i][key]) {
          diffs.push(`${a[i].employee_code}.${key}: legacy=${a[i][key]} new=${b[i][key]}`);
        }
      }
    }
    expect(diffs).toEqual([]);

    // The ghost-row cleanup and the WOP grant auto-creation ran on both sides.
    const ghosts = (db) => db.prepare(
      "SELECT COUNT(*) c FROM attendance_processed WHERE date = '2026-03-19' AND status_final = 'A'"
    ).get().c;
    expect(ghosts(newDb)).toBe(ghosts(legacyDb));
    const grants = (db) => db.prepare('SELECT COUNT(*) c FROM extra_duty_grants').get().c;
    expect(grants(newDb)).toBe(grants(legacyDb));
    expect(grants(newDb)).toBeGreaterThan(0);

    legacyDb.close();
    newDb.close();
  });

  test('stage_6_done is stamped the same way', () => {
    const legacyDb = F.newDb();
    const newDb = F.newDb();
    seed(legacyDb); seed(newDb);
    F.silently(() => legacyRecomputeDays(legacyDb, MONTH, YEAR, COMPANY));
    F.silently(() => recomputeDays(newDb, { month: MONTH, year: YEAR, company: COMPANY }));
    const stamp = (db) => db.prepare('SELECT stage_6_done FROM monthly_imports WHERE month=? AND year=?').get(MONTH, YEAR).stage_6_done;
    expect(stamp(newDb)).toBe(stamp(legacyDb));
    expect(stamp(newDb)).toBe(1);
    legacyDb.close(); newDb.close();
  });
});

describe("recompute.js preserves HR's late deduction (defect g)", () => {
  test('the legacy path loses the deduction on a re-run; the new path keeps it', () => {
    const legacyDb = F.newDb();
    const newDb = F.newDb();
    seed(legacyDb); seed(newDb);
    F.silently(() => legacyRecomputeDays(legacyDb, MONTH, YEAR, COMPANY));
    F.silently(() => recomputeDays(newDb, { month: MONTH, year: YEAR, company: COMPANY }));

    // HR enters a 2-day late deduction, exactly as
    // PUT /api/payroll/day-calculations/:code/late-deduction does.
    const applyLateDeduction = (db, code, days) => {
      const dc = db.prepare('SELECT * FROM day_calculations WHERE employee_code=? AND month=? AND year=?').get(code, MONTH, YEAR);
      db.prepare(`
        UPDATE day_calculations
        SET late_deduction_days = ?, late_deduction_remark = 'late', total_payable_days = ?, lop_days = ?
        WHERE employee_code = ? AND month = ? AND year = ?
      `).run(days,
        Math.max(0, (dc.total_payable_days || 0) - days + (dc.late_deduction_days || 0)),
        Math.max(0, (dc.lop_days || 0) + days - (dc.late_deduction_days || 0)),
        code, MONTH, YEAR);
      return db.prepare('SELECT total_payable_days, lop_days FROM day_calculations WHERE employee_code=? AND month=? AND year=?').get(code, MONTH, YEAR);
    };

    const legacyAfterDeduction = applyLateDeduction(legacyDb, 'PAR001', 2);
    const newAfterDeduction = applyLateDeduction(newDb, 'PAR001', 2);
    expect(newAfterDeduction).toEqual(legacyAfterDeduction);

    // Stage 6 runs again — a reimport, a corrected miss punch, anything.
    F.silently(() => legacyRecomputeDays(legacyDb, MONTH, YEAR, COMPANY));
    F.silently(() => recomputeDays(newDb, { month: MONTH, year: YEAR, company: COMPANY }));

    const read = (db) => db.prepare(
      'SELECT total_payable_days, lop_days, late_deduction_days FROM day_calculations WHERE employee_code=? AND month=? AND year=?'
    ).get('PAR001', MONTH, YEAR);

    const legacyNow = read(legacyDb);
    const newNow = read(newDb);

    // Legacy: the flag survives but the days it was supposed to cost came back.
    expect(legacyNow.late_deduction_days).toBe(2);
    expect(legacyNow.total_payable_days).toBe(legacyAfterDeduction.total_payable_days + 2);

    // New: the deduction is still costing the 2 days it is supposed to.
    expect(newNow.late_deduction_days).toBe(2);
    expect(newNow.total_payable_days).toBe(legacyAfterDeduction.total_payable_days);
    expect(newNow.lop_days).toBe(legacyAfterDeduction.lop_days);

    // And it stays stable across further re-runs rather than compounding.
    F.silently(() => recomputeDays(newDb, { month: MONTH, year: YEAR, company: COMPANY }));
    expect(read(newDb).total_payable_days).toBe(legacyAfterDeduction.total_payable_days);

    legacyDb.close(); newDb.close();
  });
});

describe('salary staleness marker', () => {
  test('Stage 6 marks rows stale; Stage 7 clears them', () => {
    const db = F.newDb();
    const employees = seed(db);
    for (const e of employees) {
      db.prepare(`
        INSERT INTO salary_structures (employee_id, basic, hra, gross_salary, effective_from, pf_applicable, esi_applicable)
        VALUES (?, 10000, 4000, 20000, '2024-01-01', 0, 0)
      `).run(e.id);
    }

    F.silently(() => recomputeDays(db, { month: MONTH, year: YEAR, company: COMPANY }));
    const stale = countStaleSalary(db, { month: MONTH, year: YEAR, company: COMPANY });
    expect(stale.count).toBe(employees.length);
    expect(stale.employeeCodes).toContain('PAR001');

    F.silently(() => recomputeSalary(db, { month: MONTH, year: YEAR, company: COMPANY }));
    expect(countStaleSalary(db, { month: MONTH, year: YEAR, company: COMPANY }).count).toBe(0);

    // A later Stage 6 makes them stale again — salary never recomputes by itself.
    F.silently(() => recomputeDays(db, { month: MONTH, year: YEAR, company: COMPANY }));
    expect(countStaleSalary(db, { month: MONTH, year: YEAR, company: COMPANY }).count).toBe(employees.length);
    db.close();
  });

  test('salary drift stays within a rupee after a compute', () => {
    const db = F.newDb();
    const employees = seed(db);
    for (const e of employees) {
      db.prepare(`
        INSERT INTO salary_structures (employee_id, basic, hra, gross_salary, effective_from, pf_applicable, esi_applicable)
        VALUES (?, 10000, 4000, 20000, '2024-01-01', 1, 1)
      `).run(e.id);
    }
    F.silently(() => recomputeDays(db, { month: MONTH, year: YEAR, company: COMPANY }));
    F.silently(() => recomputeSalary(db, { month: MONTH, year: YEAR, company: COMPANY }));

    const drift = db.prepare(`
      SELECT employee_code, ABS(net_salary - (gross_earned - total_deductions)) d
      FROM salary_computations WHERE month = ? AND year = ? ORDER BY d DESC LIMIT 20
    `).all(MONTH, YEAR);
    expect(drift.length).toBeGreaterThan(0);
    expect(Math.max(...drift.map((r) => r.d))).toBeLessThanOrEqual(1);
    db.close();
  });

  test('employeeCodes limits the run to the codes given', () => {
    const db = F.newDb();
    seed(db);
    F.silently(() => recomputeDays(db, { month: MONTH, year: YEAR, company: COMPANY, employeeCodes: ['PAR002'] }));
    const rows = dayCalcRows(db);
    expect(rows.map((r) => r.employee_code)).toEqual(['PAR002']);
    db.close();
  });
});
