/**
 * Gate pass PR-2: early exits allow for gate passes everywhere they are read, and
 * detection measures night shifts against the night window (same calculator as import).
 * Synthetic codes only (EX…). Dates in Oct 2026; Sep 2026 is the previous month.
 */
const F = require('./helpers/attendanceReviewFixture');
const D = require('../services/earlyExitDetection');
const S = require('../services/attendanceReviewService');
const { startJwtApi } = require('./helpers/jwtApiHarness');

function emp(db, code, shift = '12HR') { F.emp(db, code); db.prepare('UPDATE employees SET shift_code = ? WHERE code = ?').run(shift, code); return code; }
function pass(db, code, date, type = 'short_leave', hours = 2, cancelled = false) {
  return db.prepare(`INSERT INTO short_leaves (employee_code, date, leave_type, duration_hours, remark, cancelled_at)
    VALUES (?, ?, ?, ?, 'test', ?)`).run(code, date, type, hours, cancelled ? '2026-10-01 10:00:00' : null).lastInsertRowid;
}
const ap = (db, code, date) => db.prepare('SELECT is_early_departure ed, early_by_minutes em FROM attendance_processed WHERE employee_code = ? AND date = ?').get(code, date);
const det = (db, code, date) => db.prepare('SELECT * FROM early_exit_detections WHERE employee_code = ? AND date = ?').get(code, date);

describe('detection with gate passes (12HR 08:00–20:00)', () => {
  let db;
  beforeEach(() => { db = F.newDb(); });

  test('no pass: left 18:30 → 90 min early, flagged', () => {
    emp(db, 'EX1'); F.day(db, 'EX1', '2026-10-05', { ot: '18:30', em: 0 });
    D.refreshEarlyExits(db, ['2026-10-05']);
    expect(ap(db, 'EX1', '2026-10-05')).toEqual({ ed: 1, em: 90 });
    expect(det(db, 'EX1', '2026-10-05')).toMatchObject({ minutes_early: 90, flagged_minutes: 90, has_gate_pass: 0, detection_status: 'flagged', shift_code: '12HR' });
  });

  test('Short Leave (2 h), left 18:10 → not an early exit (exempted, raw kept on the detection row)', () => {
    emp(db, 'EX2'); F.day(db, 'EX2', '2026-10-05', { ot: '18:10' }); pass(db, 'EX2', '2026-10-05');
    D.refreshEarlyExits(db, ['2026-10-05']);
    expect(ap(db, 'EX2', '2026-10-05')).toEqual({ ed: 0, em: 0 });
    expect(det(db, 'EX2', '2026-10-05')).toMatchObject({ minutes_early: 110, flagged_minutes: 0, has_gate_pass: 1, authorized_leave_until: '18:00', detection_status: 'exempted' });
  });

  test('Short Leave, left 17:30 → only the 30 min beyond the pass count', () => {
    emp(db, 'EX3'); F.day(db, 'EX3', '2026-10-05', { ot: '17:30' }); pass(db, 'EX3', '2026-10-05');
    D.refreshEarlyExits(db, ['2026-10-05']);
    expect(ap(db, 'EX3', '2026-10-05')).toEqual({ ed: 1, em: 30 });
    expect(det(db, 'EX3', '2026-10-05')).toMatchObject({ minutes_early: 150, gate_pass_overage_minutes: 30, flagged_minutes: 30, detection_status: 'flagged' });
  });

  test('Half Day (6 h), left 14:05 → exempted', () => {
    emp(db, 'EX4'); F.day(db, 'EX4', '2026-10-05', { ot: '14:05' }); pass(db, 'EX4', '2026-10-05', 'half_day', 6);
    D.refreshEarlyExits(db, ['2026-10-05']);
    expect(ap(db, 'EX4', '2026-10-05')).toEqual({ ed: 0, em: 0 });
    expect(det(db, 'EX4', '2026-10-05').authorized_leave_until).toBe('14:00');
  });

  test('cancelled pass is ignored', () => {
    emp(db, 'EX5'); F.day(db, 'EX5', '2026-10-05', { ot: '18:10' }); pass(db, 'EX5', '2026-10-05', 'short_leave', 2, true);
    D.refreshEarlyExits(db, ['2026-10-05']);
    expect(ap(db, 'EX5', '2026-10-05')).toEqual({ ed: 1, em: 110 });
  });

  test('10HR (09:00–19:00, no night variant): Short Leave covers from 17:00', () => {
    emp(db, 'EX6', '10HR'); F.day(db, 'EX6', '2026-10-05', { it: '09:00', ot: '17:05' }); pass(db, 'EX6', '2026-10-05');
    D.refreshEarlyExits(db, ['2026-10-05']);
    expect(ap(db, 'EX6', '2026-10-05')).toEqual({ ed: 0, em: 0 });
    expect(det(db, 'EX6', '2026-10-05').authorized_leave_until).toBe('17:00');
  });

  test('pass with no early exit that day changes nothing and adds no detection row', () => {
    emp(db, 'EX7'); F.day(db, 'EX7', '2026-10-05', { ot: '20:05' }); pass(db, 'EX7', '2026-10-05');
    D.refreshEarlyExits(db, ['2026-10-05']);
    expect(ap(db, 'EX7', '2026-10-05')).toEqual({ ed: 0, em: 0 });
    expect(det(db, 'EX7', '2026-10-05')).toBeUndefined();
  });
});

describe('night shifts use the night window (the old code recorded ~700 min early)', () => {
  test('12HR night: in 20:02, out 08:09 → not early, no detection row', () => {
    const db = F.newDb(); emp(db, 'EN1'); F.day(db, 'EN1', '2026-10-05', { it: '20:02', ot: '08:09', night: 1 });
    D.refreshEarlyExits(db, ['2026-10-05']);
    expect(ap(db, 'EN1', '2026-10-05')).toEqual({ ed: 0, em: 0 });
    expect(det(db, 'EN1', '2026-10-05')).toBeUndefined();
  });

  test('12HR night: out 07:30 → 30 min early; a Short Leave covers from 06:00', () => {
    const db = F.newDb(); emp(db, 'EN2'); emp(db, 'EN3');
    F.day(db, 'EN2', '2026-10-05', { it: '20:00', ot: '07:30', night: 1 });
    F.day(db, 'EN3', '2026-10-05', { it: '20:00', ot: '06:30', night: 1 }); pass(db, 'EN3', '2026-10-05');
    D.refreshEarlyExits(db, ['2026-10-05']);
    expect(ap(db, 'EN2', '2026-10-05')).toEqual({ ed: 1, em: 30 });
    expect(ap(db, 'EN3', '2026-10-05')).toEqual({ ed: 0, em: 0 });
    expect(det(db, 'EN3', '2026-10-05')).toMatchObject({ minutes_early: 90, authorized_leave_until: '06:00', detection_status: 'exempted' });
  });
});

describe('re-runs', () => {
  test('idempotent; actioned rows keep their status; a row a deduction points at is never deleted', () => {
    const db = F.newDb(); emp(db, 'ER1'); emp(db, 'ER2');
    F.day(db, 'ER1', '2026-10-05', { ot: '18:30' }); F.day(db, 'ER2', '2026-10-05', { ot: '18:30' });
    D.refreshEarlyExits(db, ['2026-10-05']);
    const before = db.prepare('SELECT employee_code, minutes_early, flagged_minutes, detection_status FROM early_exit_detections ORDER BY employee_code').all();
    D.refreshEarlyExits(db, ['2026-10-05']);
    expect(db.prepare('SELECT employee_code, minutes_early, flagged_minutes, detection_status FROM early_exit_detections ORDER BY employee_code').all()).toEqual(before);

    const d1 = det(db, 'ER1', '2026-10-05'); const d2 = det(db, 'ER2', '2026-10-05');
    db.prepare("UPDATE early_exit_detections SET detection_status = 'actioned' WHERE id = ?").run(d1.id);
    db.prepare(`INSERT INTO early_exit_deductions (early_exit_detection_id, employee_code, date, hr_remark, finance_status)
                VALUES (?, 'ER2', '2026-10-05', 'x', 'cancelled')`).run(d2.id);
    // both later get a pass → no longer early, but neither row may disappear
    pass(db, 'ER1', '2026-10-05'); pass(db, 'ER2', '2026-10-05');
    D.refreshEarlyExits(db, ['2026-10-05']);
    expect(det(db, 'ER1', '2026-10-05')).toMatchObject({ id: d1.id, detection_status: 'actioned', flagged_minutes: 0 });
    expect(det(db, 'ER2', '2026-10-05')).toMatchObject({ id: d2.id, detection_status: 'exempted' });
  });

  test('a row that is no longer early (and nothing points at it) is removed', () => {
    const db = F.newDb(); emp(db, 'ER3'); F.day(db, 'ER3', '2026-10-05', { ot: '18:30' });
    D.refreshEarlyExits(db, ['2026-10-05']);
    db.prepare("UPDATE attendance_processed SET out_time_final = '20:00' WHERE employee_code = 'ER3'").run();
    D.refreshEarlyExits(db, ['2026-10-05']);
    expect(det(db, 'ER3', '2026-10-05')).toBeUndefined();
    expect(ap(db, 'ER3', '2026-10-05')).toEqual({ ed: 0, em: 0 });
  });

  test('refreshRecentMonths covers the current and previous IST month only', () => {
    const db = F.newDb(); emp(db, 'ER4');
    F.day(db, 'ER4', '2026-08-31', { ot: '18:00' }); F.day(db, 'ER4', '2026-09-30', { ot: '18:00' }); F.day(db, 'ER4', '2026-10-01', { ot: '18:00' });
    db.prepare("UPDATE attendance_processed SET is_early_departure = 0, early_by_minutes = 0").run();
    const r = D.refreshRecentMonths(db, new Date('2026-10-10T18:00:00Z'));
    expect(r.dates).toBe(2);
    expect(ap(db, 'ER4', '2026-08-31')).toEqual({ ed: 0, em: 0 });
    expect(ap(db, 'ER4', '2026-09-30').ed).toBe(1); expect(ap(db, 'ER4', '2026-10-01').ed).toBe(1);
  });
});

describe('Attendance Review counts only uncovered early exits', () => {
  test('5 early exits of 90 min, 3 covered by Short Leaves → 2 early days', () => {
    const db = F.newDb(); emp(db, 'EV1');
    F.month(db, 'EV1', 2026, 9, 22);
    const days = F.weekdays(2026, 10).slice(0, 20);
    days.forEach((iso, i) => F.day(db, 'EV1', iso, i < 5 ? { ot: '18:30' } : {}));
    const run = () => S.computeAttendanceReview(db, { month: 10, year: 2026, config: {}, releaseDays: [], prevReleaseDays: [], overrides: [] })
      .people.find((p) => p.code === 'EV1') || { early_days: 0 };
    D.refreshEarlyExitsForMonth(db, 10, 2026);
    expect(run().early_days).toBe(5);
    days.slice(0, 3).forEach((iso) => pass(db, 'EV1', iso));
    D.refreshEarlyExitsForMonth(db, 10, 2026);
    expect(run().early_days).toBe(2);
    const full = S.computeAttendanceReview(db, { month: 10, year: 2026, config: {}, releaseDays: [], prevReleaseDays: [], overrides: [] });
    expect(full.gatePassCount).toBe(3); expect(full.gatePassExcused).toBe(3);
  });
});

describe('hooks over HTTP (real requireAuth)', () => {
  let api; let db;
  beforeAll(() => {
    api = startJwtApi({ '/api/short-leaves': '../../routes/short-leaves', '/api/attendance': '../../routes/attendance' }, {
      users: [{ username: 'hr1', role: 'hr' }, { username: 'boss', role: 'admin' }],
    });
    db = api.db;
  });
  afterAll(async () => { await api.close(); });

  test('creating a backdated gate pass exempts the early exit already on record', async () => {
    emp(db, 'EH1'); F.day(db, 'EH1', '2026-09-07', { ot: '18:10', em: 110 });
    const r = await api.request('POST', '/api/short-leaves', { as: 'hr1', body: { employee_code: 'EH1', date: '2026-09-07', leave_type: 'short_leave', remark: 'bank' } });
    expect(r.status).toBe(201);
    expect(r.body.early_exit_refresh).toMatchObject({ dates: 1, exempted: 1 });
    expect(ap(db, 'EH1', '2026-09-07')).toEqual({ ed: 0, em: 0 });
  });

  test('recalculate-metrics writes raw values, then the gate pass is applied on top', async () => {
    emp(db, 'EH2'); F.day(db, 'EH2', '2026-09-08', { ot: '18:10' }); pass(db, 'EH2', '2026-09-08');
    db.prepare("UPDATE attendance_processed SET is_early_departure = 1, early_by_minutes = 110 WHERE employee_code = 'EH2'").run();
    const r = await api.request('POST', '/api/attendance/recalculate-metrics', { as: 'boss', body: { month: 9, year: 2026 } });
    expect(r.status).toBe(200);
    expect(r.body.earlyExitRefresh.dates).toBeGreaterThan(0);
    expect(ap(db, 'EH2', '2026-09-08')).toEqual({ ed: 0, em: 0 });
  });
});
