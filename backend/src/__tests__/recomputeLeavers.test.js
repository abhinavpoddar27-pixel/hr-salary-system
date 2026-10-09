/**
 * Stage 6 must not reactivate a 'Left' employee just because they have
 * attendance rows in the month being computed (the days before their exit are
 * in that month too). Only a worked day strictly after the exit cutoff — the
 * later of date_of_exit and inactive_since — counts as a return. With no usable
 * exit date at all, the legacy "any row reactivates" behaviour is kept.
 */
const { recomputeDays } = require('../services/recompute');
const F = require('./helpers/leaveFixture');

const MONTH = 3;
const YEAR = 2026;
const COMPANY = 'Indriyan Beverages Pvt Ltd';
const OTHER = 'Asian Lakto Ind Ltd';

let db;

beforeEach(() => {
  db = F.newDb();
  db.prepare(`
    INSERT INTO monthly_imports (month, year, company, file_name, status, stage_1_done)
    VALUES (?, ?, ?, 'test.xls', 'imported', 1)
  `).run(MONTH, YEAR, COMPANY);
});

afterEach(() => db.close());

function leaver(code, { status = 'Left', doe = null, since = null, auto = 0, company = COMPANY } = {}) {
  const emp = F.addEmployee(db, { code, status, company });
  db.prepare('UPDATE employees SET date_of_exit = ?, inactive_since = ?, auto_inactive = ? WHERE code = ?')
    .run(doe, since, auto, code);
  return emp;
}

/** Insert one row per day in [from, to] of March with the given status. */
function days(code, from, to, status, company = COMPANY) {
  const ins = db.prepare(`
    INSERT INTO attendance_processed
      (employee_code, date, month, year, company, status_original, status_final,
       in_time_original, out_time_original, is_night_out_only, is_miss_punch)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0)
  `);
  for (let d = from; d <= to; d += 1) {
    const date = `${YEAR}-03-${String(d).padStart(2, '0')}`;
    const worked = !['A', 'WO', ''].includes(status);
    ins.run(code, date, MONTH, YEAR, company, status, status,
      worked ? '08:00' : '', worked ? '18:00' : '');
  }
}

function emp(code) {
  return db.prepare('SELECT status, was_left_returned, auto_inactive FROM employees WHERE code = ?').get(code);
}
function dayCalc(code) {
  return db.prepare('SELECT * FROM day_calculations WHERE employee_code = ? AND month = ? AND year = ?')
    .get(code, MONTH, YEAR);
}
function run(opts = {}) {
  return F.silently(() => recomputeDays(db, { month: MONTH, year: YEAR, company: COMPANY, ...opts }));
}

describe('Stage 6 — Left employees are reactivated only on a genuine return', () => {
  test('1. exit on the 15th, worked 1st–15th → stays Left, still gets a day_calculations row', () => {
    leaver('L1', { doe: '2026-03-15', since: '2026-03-15' });
    days('L1', 1, 15, 'P');
    days('L1', 16, 31, 'A');
    run();
    expect(emp('L1')).toMatchObject({ status: 'Left', was_left_returned: 0 });
    const dc = dayCalc('L1');
    expect(dc).toBeTruthy();
    expect(dc.days_present).toBeGreaterThan(0);
  });

  test('2. exit in a previous month, worked days this month → reactivated', () => {
    leaver('L2', { doe: '2026-02-20', since: '2026-02-20' });
    days('L2', 1, 10, 'P');
    run();
    expect(emp('L2')).toMatchObject({ status: 'Active', was_left_returned: 1 });
  });

  test('3. no exit date at all → legacy: any row reactivates', () => {
    leaver('L3');
    days('L3', 1, 5, 'A');
    run();
    expect(emp('L3')).toMatchObject({ status: 'Active', was_left_returned: 1 });
  });

  test('4. only A / blank rows after exit → stays Left', () => {
    leaver('L4', { doe: '2026-03-10', since: '2026-03-10' });
    days('L4', 1, 10, 'P');
    days('L4', 11, 25, 'A');
    days('L4', 26, 26, ''); // ghost row — normalised to A by the cleanup pass
    run();
    expect(emp('L4')).toMatchObject({ status: 'Left', was_left_returned: 0 });
  });

  test('5. Exited is untouched and not computed', () => {
    leaver('X5', { status: 'Exited', doe: '2026-02-01' });
    days('X5', 1, 20, 'P');
    run();
    expect(emp('X5')).toMatchObject({ status: 'Exited', was_left_returned: 0 });
    expect(dayCalc('X5')).toBeUndefined();
  });

  test('6. auto-detected leaver (inactive_since only, A rows after) → stays Left', () => {
    leaver('L6', { since: '2026-03-05', auto: 1 });
    days('L6', 1, 5, 'P');
    days('L6', 6, 31, 'A');
    run();
    expect(emp('L6')).toMatchObject({ status: 'Left', was_left_returned: 0, auto_inactive: 1 });
  });

  test('7. both dates set → the later one is the cutoff', () => {
    leaver('L7a', { doe: '2026-03-05', since: '2026-03-20' });
    days('L7a', 10, 10, 'P'); // between the two dates — not a return
    leaver('L7b', { doe: '2026-03-20', since: '2026-03-05' });
    days('L7b', 10, 10, 'P'); // same, other way round
    leaver('L7c', { doe: '2026-03-05', since: '2026-03-20' });
    days('L7c', 25, 25, 'P'); // after both — a return
    run();
    expect(emp('L7a').status).toBe('Left');
    expect(emp('L7b').status).toBe('Left');
    expect(emp('L7c')).toMatchObject({ status: 'Active', was_left_returned: 1 });
  });

  test('8. ½P and WOP after exit count as worked; CL does not', () => {
    leaver('L8a', { doe: '2026-03-10' });
    days('L8a', 12, 12, '½P');
    leaver('L8b', { doe: '2026-03-10' });
    days('L8b', 15, 15, 'WOP');
    leaver('L8c', { doe: '2026-03-10' });
    days('L8c', 12, 14, 'CL');
    run();
    expect(emp('L8a').status).toBe('Active');
    expect(emp('L8b').status).toBe('Active');
    expect(emp('L8c').status).toBe('Left');
  });

  test('9. company scope: work after exit only under another company → stays Left', () => {
    leaver('L9', { doe: '2026-03-10' });
    days('L9', 1, 10, 'P', COMPANY);
    days('L9', 15, 20, 'P', OTHER);
    run();
    expect(emp('L9').status).toBe('Left');
  });

  test('10. employeeCodes limit: a returner outside the list is not touched', () => {
    leaver('L10a', { doe: '2026-02-01' });
    days('L10a', 1, 5, 'P');
    leaver('L10b', { doe: '2026-02-01' });
    days('L10b', 1, 5, 'P');
    run({ employeeCodes: ['L10a'] });
    expect(emp('L10a').status).toBe('Active');
    expect(emp('L10b').status).toBe('Left');
  });

  test('11. a non-ISO exit date is ignored, not string-compared', () => {
    leaver('L11a', { doe: '15/03/2026', since: '2026-03-15' });
    days('L11a', 1, 15, 'P');
    leaver('L11b', { doe: '15/03/2026' }); // nothing usable → legacy
    days('L11b', 1, 2, 'A');
    run();
    expect(emp('L11a').status).toBe('Left');
    expect(emp('L11b').status).toBe('Active');
  });

  test('12. a punch ON the exit date is the last working day, not a return', () => {
    leaver('L12', { doe: '2026-03-31' });
    days('L12', 31, 31, 'P');
    run();
    expect(emp('L12').status).toBe('Left');
  });
});
