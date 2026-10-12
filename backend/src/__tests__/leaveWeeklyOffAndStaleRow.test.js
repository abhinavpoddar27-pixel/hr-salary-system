/**
 * Owner rulings 12 Oct 2026:
 *  1. From September 2026 payroll, paid leave (EL, and CL once paid) on an
 *     absent working day counts toward weekly-off eligibility — taking paid
 *     leave no longer costs a weekly off. LWP never counts. Earlier months
 *     keep the old rule.
 *  2. When Stage 7 finds zero attendance for an employee who still has a
 *     salary row from an earlier run (employee 60348, Sep 2026: 1 day paid,
 *     later corrected to absent), that leftover row is removed — unless it is
 *     finalised or carries a loan deduction, in which case it is kept and
 *     reported.
 */
const { calculateDays } = require('../services/dayCalculation');
const F = require('./helpers/leaveFixture');
const { recomputeSalary } = require('../services/recompute');

// ── 1. weekly off ─────────────────────────────────────────────────────────
function daysIn(m, y) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }
function records(month, year) {
  const out = [];
  for (let d = 1; d <= daysIn(month, year); d += 1) {
    const date = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const wo = new Date(`${date}T12:00:00Z`).getUTCDay() === 0;
    out.push({ date, month, year, status_original: wo ? 'WO' : 'P', status_final: wo ? 'WO' : 'P',
      in_time_original: '08:00', out_time_original: '20:00', is_night_out_only: 0, is_miss_punch: 0 });
  }
  return out;
}
function absent(recs, dates) {
  for (const r of recs) if (dates.includes(r.date) && r.status_final !== 'WO') {
    r.status_original = 'A'; r.status_final = 'A'; r.in_time_original = null; r.out_time_original = null;
  }
  return recs;
}
const leave = (type, start, end = start) => ({ leave_type: type, start_date: start, end_date: end, status: 'Approved' });
const run = (m, y, recs, leaves) => calculateDays('WOTEST', m, y, 'Asian Lakto Ind Ltd', recs, {}, [],
  { isContractor: false, weeklyOffDay: 0, employmentType: 'Permanent', approvedLeaves: leaves, approvedCompOff: [] });

// Sep 2026: 26 working days, 4 Sundays; threshold 24. Five absences → 21 present → Tier 2.
const SEP_ABS = ['2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18', '2026-09-19'];

describe('paid leave counts toward weekly-off eligibility from Sep 2026', () => {
  test('control: 5 plain absences lose a weekly off', () => {
    const out = run(9, 2026, absent(records(9, 2026), SEP_ABS), []);
    expect(out.paidWeeklyOffs).toBeLessThan(4);
  });

  test('5 days of EL keep every weekly off and pay the full month', () => {
    const out = run(9, 2026, absent(records(9, 2026), SEP_ABS), [leave('EL', SEP_ABS[0], SEP_ABS[4])]);
    expect(out.paidWeeklyOffs).toBe(4);
    expect(out.totalPayableDays).toBe(30);
  });

  test('CL counts too (it is paid from Sep 2026)', () => {
    const out = run(9, 2026, absent(records(9, 2026), SEP_ABS), [leave('CL', SEP_ABS[0], SEP_ABS[4])]);
    expect(out.paidWeeklyOffs).toBe(4);
    expect(out.totalPayableDays).toBe(30);
  });

  test('LWP does not count', () => {
    const base = run(9, 2026, absent(records(9, 2026), SEP_ABS), []);
    const out = run(9, 2026, absent(records(9, 2026), SEP_ABS), [leave('LWP', SEP_ABS[0], SEP_ABS[4])]);
    expect(out.paidWeeklyOffs).toBe(base.paidWeeklyOffs);
    expect(out.totalPayableDays).toBe(base.totalPayableDays);
  });

  test('2 EL + 2 plain absences: the EL keeps the weekly off, the absences still cost a day each', () => {
    const FOUR = SEP_ABS.slice(0, 4);
    const plain = run(9, 2026, absent(records(9, 2026), FOUR), []);
    const out = run(9, 2026, absent(records(9, 2026), FOUR), [leave('EL', FOUR[0], FOUR[1])]);
    // 22 present + 2 EL = 24 = threshold → Tier 1 (old rule: 22 → Tier 2, 3 weekly offs)
    expect(plain.paidWeeklyOffs).toBe(3);
    expect(out.paidWeeklyOffs).toBe(4);
    expect(out.totalPayableDays).toBe(28);
  });

  test('August 2026 keeps the old rule (EL does not count for the weekly off)', () => {
    const AUG = ['2026-08-17', '2026-08-18', '2026-08-19', '2026-08-20', '2026-08-21'];
    const out = run(8, 2026, absent(records(8, 2026), AUG), [leave('EL', AUG[0], AUG[4])]);
    expect(out.paidWeeklyOffs).toBeLessThan(out.totalWeeklyOffs);
  });

  test('no integrity warning', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    run(9, 2026, absent(records(9, 2026), SEP_ABS), [leave('EL', SEP_ABS[0], SEP_ABS[2]), leave('CL', SEP_ABS[3])]);
    const hits = warn.mock.calls.filter((c) => String(c[0]).includes('Integrity warning'));
    warn.mockRestore();
    expect(hits).toHaveLength(0);
  });
});

// ── 2. leftover salary row ─────────────────────────────────────────────────
const CO = 'Asian Lakto Ind Ltd';
describe('Stage 7 removes a leftover salary row when attendance is now zero', () => {
  let db;
  beforeEach(() => { db = F.newDb(); });
  afterEach(() => { db.close(); });
  const stage7 = () => F.silently(() => recomputeSalary(db, { month: 9, year: 2026, company: CO }));
  const row = (code) => db.prepare('SELECT * FROM salary_computations WHERE employee_code = ? AND month = 9 AND year = 2026').get(code);

  function oneDayThenZero(code) {
    const emp = F.addEmployee(db, { code, company: CO });
    F.addDayCalc(db, emp, 9, 2026, { days_present: 1, total_payable_days: 1 });
    stage7();
    expect(row(code)).toBeTruthy();
    db.prepare(`UPDATE day_calculations SET days_present = 0, days_half_present = 0, days_wop = 0, total_payable_days = 0
                WHERE employee_code = ? AND month = 9 AND year = 2026`).run(code);
    return emp;
  }

  test('a 1-day row left from an earlier run is removed and audited', () => {
    oneDayThenZero('Z001');
    const out = stage7();
    expect(row('Z001')).toBeUndefined();
    expect(out.staleSalaryRows.removed.map((r) => r.code)).toEqual(['Z001']);
    const audit = db.prepare("SELECT * FROM audit_log WHERE action_type = 'stale_salary_row_removed' AND employee_code = 'Z001'").all();
    expect(audit).toHaveLength(1);
  });

  test('other employees are untouched', () => {
    const keep = F.addEmployee(db, { code: 'Z010', company: CO });
    F.addDayCalc(db, keep, 9, 2026, { days_present: 26, total_payable_days: 30 });
    oneDayThenZero('Z011');
    const before = row('Z010');
    stage7();
    expect(row('Z010').net_salary).toBe(before.net_salary);
    expect(row('Z011')).toBeUndefined();
  });

  test('a finalised row is kept and reported', () => {
    oneDayThenZero('Z002');
    db.prepare("UPDATE salary_computations SET is_finalised = 1 WHERE employee_code = 'Z002'").run();
    const out = stage7();
    expect(row('Z002')).toBeTruthy();
    expect(out.staleSalaryRows.kept).toEqual([expect.objectContaining({ code: 'Z002', reason: 'finalised' })]);
  });

  test('a row carrying a loan deduction is kept and reported', () => {
    oneDayThenZero('Z003');
    db.prepare("UPDATE salary_computations SET loan_recovery = 500 WHERE employee_code = 'Z003'").run();
    const out = stage7();
    expect(row('Z003')).toBeTruthy();
    expect(out.staleSalaryRows.kept[0].reason).toBe('carries a loan deduction');
  });

  test('an advance the old row recovered is released', () => {
    const emp = oneDayThenZero('Z004');
    db.prepare(`INSERT INTO salary_advances (employee_id, employee_code, month, year, advance_amount, is_eligible, recovered)
                VALUES (?, 'Z004', 9, 2026, 1000, 1, 1)`).run(emp.id);
    stage7();
    expect(db.prepare("SELECT recovered FROM salary_advances WHERE employee_code = 'Z004'").get().recovered).toBe(0);
  });

  test('a second run with nothing left does nothing', () => {
    oneDayThenZero('Z005');
    stage7();
    const out = stage7();
    expect(out.staleSalaryRows.removed).toHaveLength(0);
  });
});
