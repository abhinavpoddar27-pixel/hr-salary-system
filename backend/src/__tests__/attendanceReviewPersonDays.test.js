/**
 * Attendance Review — G10 person drill-down (PR-9): every day of the month with why it was counted or excused.
 * Hard invariant: for every person, the days marked counted (late / early) and their minutes equal what
 * computeAttendanceReview gives that person for the month with the same inputs — on both bases, every excuse kind.
 * Synthetic codes only (PD… import basis, PM… master basis). Oct 2026 reviewed, Sep 2026 previous. Sundays Oct 4/11/18/25.
 */
const F = require('./helpers/attendanceReviewFixture');
const S = require('../services/attendanceReviewService');
const { startJwtApi } = require('./helpers/jwtApiHarness');

const M = 10; const Y = 2026;
const oct = F.weekdays(Y, M);                 // Mon–Sat
const REL = [oct[12]];                        // a plant-wide release day for the fixture

function emp(db, code, over = {}) { F.emp(db, code, over); if (!over.newcomer) F.month(db, code, Y, 9, 10, () => ({ it: over.sepIn || '08:00', ot: over.sepOut || '20:00' })); }
function missed(db, code, date, type = 'MISSING_OUT', o = {}) {
  F.day(db, code, date, { mp: 1, ...o });
  db.prepare('UPDATE attendance_processed SET miss_punch_type = ?, miss_punch_resolved = ? WHERE employee_code = ? AND date = ?').run(type, o.resolved ? 1 : 0, code, date);
}
function master(db, code, shiftCode) { db.prepare('UPDATE employees SET default_shift_id = (SELECT id FROM shifts WHERE code = ?) WHERE code = ?').run(shiftCode, code); }
/** Worked day with explicit punches; import flags off unless given (so only the master basis can find a late / early). */
function punch(db, code, date, it, ot, o = {}) {
  F.day(db, code, date, { it, ot, sd: o.sd || '12-Hour Shift', night: o.night || 0, st: o.st, mp: o.mp || 0, lm: o.lm || 0, em: o.em || 0, ll: o.ll || 0 });
  if (o.resolved) db.prepare('UPDATE attendance_processed SET miss_punch_resolved = 1, miss_punch_type = ? WHERE employee_code = ? AND date = ?').run(o.type || 'MISSING_OUT', code, date);
}

/** Import-basis people, one excuse kind each (plus a counted late / early where useful). */
function seedImport(db) {
  emp(db, 'PD01'); oct.slice(0, 20).forEach((d, i) => F.day(db, 'PD01', d, i === 2 ? { ll: 1, ot: '21:00' } : i === 3 ? { lm: 30 } : i === 6 ? { lm: 25 } : {}));
  emp(db, 'PD02'); oct.slice(0, 20).forEach((d, i) => F.day(db, 'PD02', d, i === 1 ? { lm: 30, it: '08:30', ot: '20:30' } : i === 4 ? { em: 45 } : {}));
  emp(db, 'PD03'); oct.slice(0, 20).forEach((d, i) => F.day(db, 'PD03', d, d === REL[0] ? { em: 60 } : i === 5 ? { em: 50 } : {}));
  F.day(db, 'PD03', '2026-10-04', { em: 90 });                                                       // Sunday
  emp(db, 'PD04'); oct.slice(0, 20).forEach((d, i) => F.day(db, 'PD04', d, i === 2 ? { st: '½P', lm: 30, ot: '14:00' } : i === 3 ? { lm: 12 } : i === 4 ? { lm: 5 } : {}));
  emp(db, 'PD05', { designation: 'LOADING' }); oct.slice(0, 20).forEach((d, i) => F.day(db, 'PD05', d, i < 3 ? { lm: 40 } : i === 5 ? { em: 30 } : {}));
  emp(db, 'PD06'); oct.slice(0, 20).forEach((d, i) => F.day(db, 'PD06', d, { it: i === 1 ? '09:40' : i === 2 ? '09:20' : '09:00', ot: i === 3 ? '17:00' : i === 4 ? '18:30' : '18:00', sd: '12-Hour Shift', lm: 60, em: 120 }));
  emp(db, 'PD07'); oct.slice(0, 20).forEach((d, i) => F.day(db, 'PD07', d, i === 5 ? { lm: 150, it: '10:30', ot: '22:35' } : i === 8 ? { ll: 1, ot: '21:00' } : i === 9 ? { lm: 150, it: '10:30', ot: '22:35' } : {}));
  emp(db, 'PD08'); oct.slice(0, 20).forEach((d, i) => (i < 7 ? missed(db, 'PD08', d) : F.day(db, 'PD08', d, i === 9 ? { em: 30 } : {})));
  emp(db, 'PD09', { designation: 'LOADER', employment_type: 'Contract', is_contractor: 1 });
  oct.slice(0, 20).forEach((d, i) => (i < 6 ? missed(db, 'PD09', d) : F.day(db, 'PD09', d, i === 8 ? { em: 60 } : i === 9 ? { lm: 20 } : {})));
  emp(db, 'PD10'); oct.slice(0, 20).forEach((d, i) => F.day(db, 'PD10', d, i < 4 ? { em: 60 } : {}));
  emp(db, 'PD11'); oct.slice(0, 20).forEach((d, i) => F.day(db, 'PD11', d, i === 1 ? { em: 60, it: '07:00', ot: '19:00' } : i === 2 ? { em: 60 } : {}));
  emp(db, 'PD12'); oct.slice(0, 20).forEach((d, i) => F.day(db, 'PD12', d, i === 1 ? { lm: 700, it: '19:40' } : i === 2 ? { em: 700 } : i === 3 ? { em: 10 } : {}));
  emp(db, 'PD13'); oct.slice(0, 20).forEach((d, i) => F.day(db, 'PD13', d, i < 4 ? { lm: 30 } : {}));
  emp(db, 'PD14'); oct.slice(0, 20).forEach((d, i) => F.day(db, 'PD14', d, i < 2 ? { lm: 30, em: 30 } : {}));
  emp(db, 'PD15', { newcomer: true }); oct.slice(0, 10).forEach((d, i) => F.day(db, 'PD15', d, i === 0 ? { lm: 15 } : { st: i === 1 ? 'A' : 'P' }));
  // bulk-failure day for MP-2: oct[2] gets many missed punches plant-wide (threshold lowered in the config below)
  for (const c of ['PDB1', 'PDB2', 'PDB3']) { emp(db, c); missed(db, c, oct[2]); oct.slice(3, 10).forEach((d) => F.day(db, c, d, {})); }
}

/** Master-basis people. Shifts from the schema seed: 12HR 08:00–20:00, 10HR 09:00–19:00, 9HR 09:30–18:30. */
function seedMaster(db) {
  db.prepare("INSERT INTO shifts (name, code, start_time, end_time, duration_hours) VALUES ('Night Twelve', 'N12X', '19:00', '07:00', 12)").run();
  const on = (code, sc, it = '08:00', ot = '20:00') => { emp(db, code, { sepIn: it, sepOut: ot }); master(db, code, sc); };
  on('PM01', '12HR'); oct.slice(0, 20).forEach((d, i) => (i === 1 ? punch(db, 'PM01', d, '20:30', '08:00', { night: 1, sd: 'Night Shift' })
    : i === 2 ? punch(db, 'PM01', d, '20:15', '07:00', { night: 1, sd: 'Night Shift' }) : punch(db, 'PM01', d, '08:00', '20:00')));
  emp(db, 'PM02'); oct.slice(0, 8).forEach((d) => punch(db, 'PM02', d, '08:40', '18:00'));       // no master
  on('PM03', '12HR'); oct.slice(0, 20).forEach((d, i) => (i === 1 ? punch(db, 'PM03', d, '08:30', '20:00', { mp: 1, resolved: true })
    : i === 2 ? punch(db, 'PM03', d, '08:00', '18:00', { mp: 1, resolved: true }) : i === 3 ? punch(db, 'PM03', d, '08:00', null, { mp: 1 })
      : punch(db, 'PM03', d, '08:00', '20:00')));
  on('PM04', '12HR'); oct.slice(0, 20).forEach((d, i) => punch(db, 'PM04', d, '08:00', i === 1 ? '18:30' : i === 2 ? '17:00' : '20:00'));
  for (const i of [1, 2]) db.prepare("INSERT INTO short_leaves (employee_code, date, leave_type, duration_hours, remark, created_by) VALUES ('PM04', ?, 'short_leave', 2, 'test pass', 'test')").run(oct[i]);
  on('PM05', '12HR'); oct.slice(0, 20).forEach((d, i) => punch(db, 'PM05', d, i === 1 ? '08:40' : '08:00', i === 1 ? '14:00' : i === 2 ? '19:00' : '20:00', { st: i === 1 ? '½P' : 'P' }));
  on('PM06', '12HR'); oct.slice(0, 20).forEach((d, i) => punch(db, 'PM06', d, i === 1 ? '04:00' : '08:00', '20:00'));
  on('PM07', '10HR', '09:00', '19:00'); oct.slice(0, 20).forEach((d, i) => (i < 2 ? punch(db, 'PM07', d, '20:00', '06:00', { night: 1, sd: 'Night Shift' }) : punch(db, 'PM07', d, '09:00', '19:00')));
  on('PM08', '12HR'); oct.slice(0, 20).forEach((d, i) => punch(db, 'PM08', d, i === 3 ? '08:40' : i === 6 ? '08:30' : '08:00', i === 2 ? '20:45' : i === 6 ? '20:30' : d === REL[0] ? '18:00' : i === 9 ? '19:00' : '20:00'));
  on('PM09', 'N12X', '19:00', '07:00'); oct.slice(0, 20).forEach((d, i) => punch(db, 'PM09', d, i === 1 ? '19:40' : '19:00', i === 2 ? '05:30' : '07:00', { night: 1, sd: 'Night Shift' }));
  on('PM10', '9HR', '09:30', '18:30'); oct.slice(0, 20).forEach((d, i) => punch(db, 'PM10', d, i === 1 ? '12:00' : '09:30', i === 1 ? '21:30' : '18:30'));
  F.day(db, 'PM10', '2026-10-04', { it: '09:30', ot: '16:00' });                                    // Sunday early on master
  on('PM11', '12HR'); oct.slice(0, 20).forEach((d, i) => (i < 6 ? missed(db, 'PM11', d) : punch(db, 'PM11', d, '08:00', i === 8 ? '19:00' : '20:00')));
}

const CONFIGS = {
  plain: {},
  everything: { early_exit_rule: 'd4', late_long_always_counted: true, missed_out_rule: true, shift_fit: 'everyone',
    thresholds: { bulk_miss_punch_day: 5 },
    remeasure: { PD06: { start: '09:00', end: '18:00', left_late: 'shift', hours_complete: true } },
    standing_people: { PD10: { rule: 'early_exempt', reason: 'Released by the line in charge' }, PD13: { rule: 'exclude', reason: 'Senior staff' },
      PD14: { rule: 'held', reason: 'Under enquiry' } } },
  habitual: { shift_fit: 'habitual', stayed_late_mode: 'worked', missed_out_rule: true, thresholds: { bulk_miss_punch_day: 5 } },
  off: { shift_fit: 'off', late_full_hours: false, stayed_late_mode: 'calendar' },
};
const asMaster = (c) => ({ ...c, assessment_basis: 'master' });

/** The invariant: per person, counted days / minutes = the engine's person line (0 when not listed). */
function checkInvariant(db, config, releaseDays = REL) {
  const r = S.computeAttendanceReview(db, { month: M, year: Y, config, releaseDays, prevReleaseDays: [] });
  const codes = db.prepare('SELECT DISTINCT employee_code c FROM attendance_processed WHERE substr(date,1,7) = ?').all(`${Y}-${M}`).map((x) => String(x.c));
  const out = [];
  for (const code of codes) {
    const d = S.personMonthDays(db, code, M, Y, { config, releaseDays, prevReleaseDays: [] });
    const p = r.people.find((x) => x.code === code) || { late_days: 0, early_days: 0, late_min: 0, early_min: 0 };
    expect({ code, ...pick(d.totals) }).toEqual({ code, ...pick(p) });
    expect(d.consistent).toBe(true);
    expect(d.days).toHaveLength(31);
    out.push(d);
  }
  return { r, days: new Map(out.map((d) => [d.code, d])) };
}
const pick = (x) => ({ late_days: x.late_days, early_days: x.early_days, late_min: Math.round(x.late_min * 100) / 100, early_min: Math.round(x.early_min * 100) / 100 });
const on = (d, iso) => d.days.find((x) => x.date === iso);

describe('person drill-down — invariant on both bases', () => {
  let db;
  beforeAll(() => { db = F.newDb(); seedImport(db); seedMaster(db); });

  for (const [name, cfg] of Object.entries(CONFIGS)) {
    test(`import basis, ${name} rules: counted days and minutes equal the engine for every person`, () => { checkInvariant(db, cfg); });
    test(`master basis, ${name} rules: counted days and minutes equal the engine for every person`, () => { checkInvariant(db, asMaster(cfg)); });
  }

  test('import basis: each excuse kind is named on its day', () => {
    const { days } = checkInvariant(db, CONFIGS.everything);
    expect(on(days.get('PD01'), oct[3])).toMatchObject({ late: 'excused:stayed_late', late_minutes: 30 });
    expect(on(days.get('PD01'), oct[6])).toMatchObject({ late: 'counted', late_minutes: 25 });
    expect(on(days.get('PD02'), oct[1])).toMatchObject({ late: 'excused:full_hours' });
    expect(on(days.get('PD02'), oct[4])).toMatchObject({ early: 'counted', early_minutes: 45 });
    expect(on(days.get('PD03'), REL[0])).toMatchObject({ early: 'excused:release_day' });
    expect(on(days.get('PD03'), REL[0]).notes).toContain('release_day');
    expect(on(days.get('PD03'), '2026-10-04')).toMatchObject({ weekday: 'Sun', early: 'excused:sunday' });
    expect(on(days.get('PD04'), oct[4]).notes).toContain('late_within_grace');
    expect(on(days.get('PD05'), oct[0])).toMatchObject({ late: 'excused:loader' });
    expect(days.get('PD05').person.loader).toBe(true);
    expect(days.get('PD06').person.remeasured).toBe(true);
    expect(on(days.get('PD06'), oct[1])).toMatchObject({ late: 'counted', late_minutes: 40, shift: { start: '09:00', end: '18:00', mode: 'remeasure' } });
    expect(on(days.get('PD06'), oct[1]).notes).toContain('remeasured');
    expect(on(days.get('PD06'), oct[3])).toMatchObject({ early: 'counted', early_minutes: 60 });
    expect(on(days.get('PD06'), oct[0])).toMatchObject({ late: 'none', early: 'none' });
    expect(on(days.get('PD07'), oct[5])).toMatchObject({ late: 'counted', long_late: true });            // D-6 kept
    expect(on(days.get('PD07'), oct[5]).notes).toContain('long_late_counted_despite_full_hours');
    expect(on(days.get('PD07'), oct[9])).toMatchObject({ late: 'excused:stayed_late', long_late: true });
    const pd08 = days.get('PD08');                                                                        // MP-2 from the 5th own
    expect(pd08.days.filter((x) => x.missed_out).map((x) => x.date)).toEqual([oct[5], oct[6]]);
    expect(on(pd08, oct[5])).toMatchObject({ early: 'counted', early_minutes: 120, times_from: 'missing' });
    expect(on(pd08, oct[2]).missed_punch).toMatchObject({ bulk_day: true, own_number: null });
    expect(on(pd08, oct[4]).missed_punch).toMatchObject({ own_number: 4 });
    expect(on(days.get('PD09'), oct[8])).toMatchObject({ early: 'excused:contract_loader' });
    expect(on(days.get('PD09'), oct[9])).toMatchObject({ late: 'excused:loader' });
    expect(days.get('PD09').days.some((x) => x.missed_out)).toBe(false);
    expect(on(days.get('PD10'), oct[0])).toMatchObject({ early: 'excused:early_exempt' });
    expect(on(days.get('PD11'), oct[1])).toMatchObject({ early: 'excused:full_hours' });
    expect(on(days.get('PD11'), oct[2])).toMatchObject({ early: 'counted' });
    expect(on(days.get('PD12'), oct[1]).notes).toContain('late_misread');
    expect(on(days.get('PD12'), oct[2]).notes).toContain('early_misread');
    expect(on(days.get('PD12'), oct[3]).notes).toContain('early_within_grace');
    expect(days.get('PD13').person.left_out).toBe(true);
    expect(on(days.get('PD13'), oct[0])).toMatchObject({ not_assessed_reason: 'person_left_out', late: 'none' });
    expect(days.get('PD14').person.held).toBe(true);
    expect(on(days.get('PD15'), oct[1])).toMatchObject({ status: 'A', not_assessed_reason: 'not_a_worked_day' });
    expect(on(days.get('PD15'), '2026-10-31')).toMatchObject({ status: null, not_assessed_reason: 'no_attendance_row' });
  });

  test('habitual shift check: a full-hours exit of a non-habitual person is counted; label follows the setting', () => {
    const { days } = checkInvariant(db, CONFIGS.habitual);
    expect(on(days.get('PD11'), oct[1])).toMatchObject({ early: 'counted' });
    expect(on(days.get('PD10'), oct[0])).toMatchObject({ early: 'counted' });
  });

  test('master basis: shift used and every not-assessed reason', () => {
    const { days } = checkInvariant(db, asMaster(CONFIGS.everything));
    expect(on(days.get('PM01'), oct[1])).toMatchObject({ late: 'counted', late_minutes: 30, shift: { start: '20:00', end: '08:00', mode: 'night', hours: 12 } });
    expect(on(days.get('PM01'), oct[2])).toMatchObject({ early: 'counted', early_minutes: 60 });
    expect(on(days.get('PM01'), oct[0])).toMatchObject({ shift: { name: '12-Hour Shift', start: '08:00', end: '20:00', mode: 'day' } });
    expect(on(days.get('PM02'), oct[0])).toMatchObject({ assessed: false, not_assessed_reason: 'no_master', late: 'none' });
    expect(on(days.get('PM03'), oct[1])).toMatchObject({ times_from: 'gate_register', early: 'none' });   // out typed = shift end
    expect(on(days.get('PM03'), oct[1]).notes).toContain('out_not_verified');
    expect(on(days.get('PM03'), oct[1]).late).toBe('counted');                                         // no full-hours excuse from an unverified out
    expect(on(days.get('PM03'), oct[2])).toMatchObject({ times_from: 'gate_register', early: 'counted', early_minutes: 120 });
    expect(on(days.get('PM03'), oct[3])).toMatchObject({ times_from: 'missing', not_assessed_reason: 'miss_punch' });
    expect(on(days.get('PM04'), oct[1])).toMatchObject({ early: 'excused:gate_pass', gate_pass: { hours: 2 } });
    expect(on(days.get('PM04'), oct[2])).toMatchObject({ early: 'counted', early_minutes: 180, early_minutes_after_gate_pass: 60 });
    expect(on(days.get('PM05'), oct[1])).toMatchObject({ status: '½P', not_assessed_reason: 'half_day', late: 'none' });
    expect(on(days.get('PM06'), oct[1])).toMatchObject({ not_assessed_reason: 'odd_punch' });
    expect(on(days.get('PM07'), oct[0])).toMatchObject({ not_assessed_reason: 'night_on_day_master' });
    expect(on(days.get('PM08'), oct[3])).toMatchObject({ late: 'excused:stayed_late' });
    expect(on(days.get('PM08'), oct[6])).toMatchObject({ late: 'excused:full_hours' });
    expect(on(days.get('PM08'), REL[0])).toMatchObject({ early: 'excused:release_day' });
    expect(on(days.get('PM08'), oct[9])).toMatchObject({ early: 'counted', early_minutes: 60 });
    expect(on(days.get('PM09'), oct[1])).toMatchObject({ late: 'counted', late_minutes: 40, shift: { start: '19:00', end: '07:00', mode: 'night' } });
    expect(on(days.get('PM09'), oct[2])).toMatchObject({ early: 'counted', early_minutes: 90 });
    expect(on(days.get('PM10'), oct[1])).toMatchObject({ late: 'counted', long_late: true });            // D-6 on the master
    expect(on(days.get('PM10'), '2026-10-04')).toMatchObject({ early: 'excused:sunday' });
    expect(days.get('PM11').days.filter((x) => x.missed_out).length).toBe(1);                          // 6 missed, bulk day 2 → 5 own → 5th
  });

  test('defaults: stored run inputs are used when a run exists (draft), else the rules in force + detected release days', () => {
    const d0 = S.personMonthDays(db, 'PD03', M, Y);
    expect(d0.rule_version).toMatchObject({ source: 'live', run_id: null });
    expect(on(d0, REL[0]).early).toBe('counted');                                                       // not detected as a release day
    const cfg = CONFIGS.plain;
    const result = S.computeAttendanceReview(db, { month: M, year: Y, config: cfg, releaseDays: REL, prevReleaseDays: [] });
    db.prepare(`INSERT INTO attendance_review_runs (month, year, status, config_snapshot, release_days, overrides, result_json, generated_by)
      VALUES (?, ?, 'draft', ?, ?, '[]', ?, 'test')`).run(M, Y, JSON.stringify(S.mergeConfig(cfg)), JSON.stringify(REL), JSON.stringify(result));
    const d1 = S.personMonthDays(db, 'PD03', M, Y);
    expect(d1.rule_version).toMatchObject({ source: 'draft' });
    expect(on(d1, REL[0]).early).toBe('excused:release_day');
    const p = result.people.find((x) => x.code === 'PD03');
    expect(pick(d1.totals)).toEqual(pick(p));
    expect(d1.stored).toMatchObject({ found: true, early_days: p.early_days });
    db.prepare('DELETE FROM attendance_review_runs WHERE month = ? AND year = ?').run(M, Y);
  });

  test('no attendance in the month → null', () => {
    expect(S.personMonthDays(db, 'PD01', 11, Y)).toBeNull();
    expect(S.personMonthDays(db, 'NOPE1', M, Y)).toBeNull();
  });
});

describe('GET /person/:code/days', () => {
  const BASE = '/api/analytics/attendance-review';
  let api; let db;
  const TABLES = ['employees', 'attendance_processed', 'attendance_review_runs', 'attendance_review_config', 'late_coming_deductions',
    'salary_computations', 'day_calculations', 'audit_log', 'short_leaves'];
  const counts = () => Object.fromEntries(TABLES.map((t) => [t, db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n]));
  beforeAll(() => {
    api = startJwtApi({ [BASE]: '../../routes/attendanceReview' }, { users: [{ username: 'adm', role: 'admin' }, { username: 'hr1', role: 'hr' }] });
    db = api.db; seedImport(db); seedMaster(db);
  });
  afterAll(() => api.close());

  test('admin gets one row per calendar day with the same totals as the engine; nothing written', async () => {
    const before = counts();
    const r = await api.request('GET', `${BASE}/person/PD01/days?month=10&year=2026`, { as: 'adm' });
    expect(r.status).toBe(200);
    expect(r.body.data.days).toHaveLength(31);
    expect(r.body.data.days[0]).toMatchObject({ date: '2026-10-01', weekday: 'Thu' });
    expect(r.body.data.consistent).toBe(true);
    expect(r.body.data.totals).toMatchObject({ late_days: 1, late_min: 25 });
    expect(counts()).toEqual(before);
  });

  test('400 on bad month / code, 404 with no attendance, 403 for hr, 401 without a token', async () => {
    expect((await api.request('GET', `${BASE}/person/PD01/days?month=13&year=2026`, { as: 'adm' })).status).toBe(400);
    expect((await api.request('GET', `${BASE}/person/PD01/days?year=2026`, { as: 'adm' })).status).toBe(400);
    expect((await api.request('GET', `${BASE}/person/${'X'.repeat(21)}/days?month=10&year=2026`, { as: 'adm' })).status).toBe(400);
    expect((await api.request('GET', `${BASE}/person/%20/days?month=10&year=2026`, { as: 'adm' })).status).toBe(400);
    const nf = await api.request('GET', `${BASE}/person/PD01/days?month=11&year=2026`, { as: 'adm' });
    expect(nf.status).toBe(404); expect(nf.body.error).toMatch(/No attendance/);
    expect((await api.request('GET', `${BASE}/person/PD01/days?month=10&year=2026`, { as: 'hr1' })).status).toBe(403);
    expect((await api.request('GET', `${BASE}/person/PD01/days?month=10&year=2026`)).status).toBe(401);
  });

  test('the existing history route still answers (not shadowed)', async () => {
    const r = await api.request('GET', `${BASE}/person/PD01?from=2026-10&to=2026-10`, { as: 'adm' });
    expect(r.status).toBe(200); expect(r.body.data.months).toHaveLength(1);
  });
});
