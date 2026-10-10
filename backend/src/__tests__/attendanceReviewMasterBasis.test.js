/**
 * Attendance Review — the MASTER-SHIFT basis (assessment_basis: 'master'; owner ruling 10 Oct 2026).
 * Every day is measured on the person's CURRENT master shift (employees.default_shift_id) from the final punches,
 * not on the shift the import matched. Synthetic codes only (MB…). Current month Oct 2026, previous Sep 2026.
 * Sundays: Oct 4/11/18/25. Fixture shifts by code: 12HR 08:00–20:00, 10HR 09:00–19:00, 9HR 09:30–18:30, NIGHT 20:00–08:00.
 */
const F = require('./helpers/attendanceReviewFixture');
const S = require('../services/attendanceReviewService');

const M = 10; const Y = 2026;
const MASTER = { assessment_basis: 'master' };
const run = (db, config = MASTER, over = {}) => S.computeAttendanceReview(db, { month: M, year: Y, config,
  releaseDays: over.releaseDays || [], prevReleaseDays: [], overrides: over.overrides || [] });
const person = (r, code) => r.people.find((p) => p.code === code) || { code, late_days: 0, early_days: 0, late_min: 0, early_min: 0 };
const q = (r, kind) => r.assessment.quality[kind];

function shift(db, code, name, start, end, hours) {
  db.prepare('INSERT INTO shifts (name, code, start_time, end_time, duration_hours) VALUES (?, ?, ?, ?, ?)').run(name, code, start, end, hours);
}
function master(db, empCode, shiftCode) {
  db.prepare('UPDATE employees SET default_shift_id = (SELECT id FROM shifts WHERE code = ?) WHERE code = ?').run(shiftCode, empCode);
}
/** A worked day with explicit punches. Import flags default to "nothing" so only the master basis can find a late / early. */
function punch(db, code, date, it, ot, o = {}) {
  F.day(db, code, date, { it, ot, sd: o.sd || '12-Hour Shift', night: o.night || 0, st: o.st, mp: o.mp || 0, lm: o.lm || 0, em: o.em || 0, ll: o.ll || 0 });
  if (o.it_lm === undefined && !o.lm) db.prepare('UPDATE attendance_processed SET is_late_arrival = 0, late_by_minutes = 0 WHERE employee_code = ? AND date = ?').run(code, date);
  if (o.resolved) db.prepare('UPDATE attendance_processed SET miss_punch_resolved = 1 WHERE employee_code = ? AND date = ?').run(code, date);
}
/**
 * A clean September (22 worked days) so nobody is a newcomer. Punches default to the 12-hour shift; pass the master's
 * own times so September doesn't read as "stayed late" every evening (which would excuse the first October late).
 */
const sep = (db, code, it = '08:00', ot = '20:00') => F.month(db, code, 2026, 9, 22, () => ({ it, ot }));

describe('config', () => {
  test('default basis is import; master needs an explicit config value; bad values are rejected', () => {
    expect(S.mergeConfig({}).assessment_basis).toBe('import');
    expect(S.mergeConfig({}).assess_fixed_miss_punch).toBe(true);
    expect(S.validateConfig({ assessment_basis: 'master', assess_fixed_miss_punch: false })).toEqual([]);
    expect(S.validateConfig({ assessment_basis: 'payroll' })).toContain('assessment_basis must be import | master');
    expect(S.validateConfig({ assess_fixed_miss_punch: 'yes' })).toContain('assess_fixed_miss_punch must be true or false');
    expect(S.validateConfig({ thresholds: { odd_punch_minutes: 120, night_start_minutes: 1200, stayed_late_minutes: 30 } })).toEqual([]);
  });

  test('import basis: result says so and carries no master data-quality block', () => {
    const db = F.newDb(); F.emp(db, 'MB0'); sep(db, 'MB0');
    const r = run(db, {});
    expect(r.criteria.assessment_basis).toBe('import');
    expect(r.assessment).toEqual({ basis: 'import', quality: null });
  });
});

describe('measuring on the current master shift', () => {
  test('wrong import shift: a 07:30–16:30 worker flagged early every day by the import has no early exits on the master', () => {
    const db = F.newDb(); F.emp(db, 'MB1'); shift(db, 'HKX', 'Housekeeping X', '07:30', '16:30', 9); master(db, 'MB1', 'HKX'); sep(db, 'MB1', '07:30', '16:30');
    // import measured on 12-hour: early by 3 h 25 m every day
    F.weekdays(2026, 10).slice(0, 10).forEach((d) => punch(db, 'MB1', d, '07:31', '16:35', { em: 205 }));
    expect(person(run(db, {}), 'MB1').early_days).toBe(10);           // import basis
    const p = person(run(db), 'MB1');                                    // master basis
    expect(p.early_days).toBe(0); expect(p.late_days).toBe(0);
  });

  test('late measured from the master start even when the import flagged nothing; full hours still excuse a made-up late', () => {
    const db = F.newDb(); F.emp(db, 'MB2'); master(db, 'MB2', '10HR'); sep(db, 'MB2', '09:00', '19:00');
    punch(db, 'MB2', '2026-10-01', '09:20', '19:00');   // 20 late, worked 580 < 600−9 → counted
    punch(db, 'MB2', '2026-10-02', '09:20', '19:20');   // 20 late, worked 600 → excused by full hours
    punch(db, 'MB2', '2026-10-03', '09:09', '19:00');   // 9 min → grace
    expect(person(run(db, {}), 'MB2').late_days).toBe(0);
    const p = person(run(db), 'MB2');
    expect(p.late_days).toBe(1); expect(p.late_min).toBe(20);
  });

  test('early exit measured from the master end; Sunday not counted; full hours excuse an early start', () => {
    const db = F.newDb(); F.emp(db, 'MB3'); master(db, 'MB3', '9HR'); sep(db, 'MB3', '09:30', '18:30');
    punch(db, 'MB3', '2026-10-01', '09:30', '17:30');   // 60 early, short → counted
    punch(db, 'MB3', '2026-10-02', '08:30', '17:30');   // 60 early but worked 9 h → excused (shift_fit 'everyone')
    punch(db, 'MB3', '2026-10-04', '09:30', '17:00');   // Sunday → not counted
    const p = person(run(db), 'MB3');
    expect(p.early_days).toBe(1); expect(p.early_min).toBe(60);
  });

  test('stay-back is recomputed on the master: out ≥ end + 20 the evening before excuses the next late', () => {
    const db = F.newDb(); F.emp(db, 'MB4'); master(db, 'MB4', '12HR'); sep(db, 'MB4');
    punch(db, 'MB4', '2026-10-05', '08:00', '20:25');   // stayed 25 min (import flag ll = 0)
    punch(db, 'MB4', '2026-10-06', '08:40', '20:00');   // late 40 → excused by yesterday's stay-back
    punch(db, 'MB4', '2026-10-07', '08:40', '20:00');   // late 40 → counted (yesterday ended on time)
    const p = person(run(db), 'MB4');
    expect(p.late_days).toBe(1); expect(p.late_min).toBe(40);
  });

  test('a gate pass works as in early-exit detection: left after (end − pass) → not early; earlier → only the minutes beyond', () => {
    const db = F.newDb(); F.emp(db, 'MB5'); master(db, 'MB5', '12HR'); sep(db, 'MB5');
    punch(db, 'MB5', '2026-10-01', '08:00', '18:00');   // 2 h pass → not early
    punch(db, 'MB5', '2026-10-02', '08:00', '17:00');   // 2 h pass → 60 beyond
    const gp = db.prepare("INSERT INTO short_leaves (employee_code, date, leave_type, duration_hours, remark) VALUES ('MB5', ?, 'short_leave', 2, 'test')");
    gp.run('2026-10-01'); gp.run('2026-10-02');
    // a cancelled pass is ignored
    punch(db, 'MB5', '2026-10-03', '08:00', '18:00');
    db.prepare("INSERT INTO short_leaves (employee_code, date, leave_type, duration_hours, remark, cancelled_at) VALUES ('MB5', '2026-10-03', 'short_leave', 2, 'x', datetime('now'))").run();
    const r = run(db);
    const p = person(r, 'MB5');
    expect(p.early_days).toBe(2); expect(p.early_min).toBe(60 + 120);
    expect(q(r, 'gate_pass')).toEqual({ days: 2, people: [{ code: 'MB5', days: 2 }] });
  });
});

describe('night work', () => {
  test('night on a 12-hour master is measured on 20:00–08:00 (in before noon counts as next morning)', () => {
    const db = F.newDb(); F.emp(db, 'MB6'); master(db, 'MB6', '12HR'); sep(db, 'MB6');
    punch(db, 'MB6', '2026-10-01', '20:15', '08:00', { night: 1, sd: 'Night Shift' });  // 15 late, worked 705 → counted
    punch(db, 'MB6', '2026-10-02', '19:55', '08:05', { night: 1 });                     // on time
    punch(db, 'MB6', '2026-10-03', '20:00', '07:30', { night: 1 });                     // 30 early, worked 690 → counted
    const p = person(run(db), 'MB6');
    expect(p.late_days).toBe(1); expect(p.late_min).toBe(15);
    expect(p.early_days).toBe(1); expect(p.early_min).toBe(30);
  });

  test('an overnight master (19:00–07:00) uses its own times every day', () => {
    const db = F.newDb(); F.emp(db, 'MB7'); shift(db, 'N19', 'Night 19-07', '19:00', '07:00', 12); master(db, 'MB7', 'N19'); sep(db, 'MB7', '19:00', '07:00');
    punch(db, 'MB7', '2026-10-01', '19:15', '07:00', { night: 1 });   // 15 late, worked 705 → counted
    punch(db, 'MB7', '2026-10-02', '18:58', '06:21');                  // not late; 39 early, short → counted
    punch(db, 'MB7', '2026-10-03', '18:55', '07:05');                  // clean
    const r = run(db);
    const p = person(r, 'MB7');
    expect(p.late_days).toBe(1); expect(p.late_min).toBe(15);
    expect(p.early_days).toBe(1); expect(p.early_min).toBe(39);
    expect(r.assessment.quality.unassessable_days).toBe(0);
  });

  test('night on a 9 / 10-hour master is not assessed and is listed in data quality', () => {
    const db = F.newDb(); F.emp(db, 'MB8'); master(db, 'MB8', '10HR'); sep(db, 'MB8', '09:00', '19:00');
    punch(db, 'MB8', '2026-10-01', '20:45', '06:00', { night: 1 });
    const r = run(db);
    expect(person(r, 'MB8').late_days).toBe(0); expect(person(r, 'MB8').early_days).toBe(0);
    expect(q(r, 'night_on_day_master')).toEqual({ days: 1, people: [{ code: 'MB8', days: 1 }] });
  });
});

describe('not assessed', () => {
  test('no master shift → not assessed even when the import flagged it; listed as no_master', () => {
    const db = F.newDb(); F.emp(db, 'MB9'); sep(db, 'MB9');
    F.month(db, 'MB9', 2026, 10, 9, () => ({ lm: 45, em: 60 }));      // import says late + early every day
    const r = run(db);
    expect(person(r, 'MB9').late_days).toBe(0); expect(person(r, 'MB9').early_days).toBe(0);
    expect(q(r, 'no_master').days).toBe(9);
    expect(r.assessment.quality.unassessable_days).toBe(9);
  });

  test('odd punch (in more than 3 h before the master start) → not assessed', () => {
    const db = F.newDb(); F.emp(db, 'MB10'); master(db, 'MB10', '9HR'); sep(db, 'MB10', '09:30', '18:30');
    punch(db, 'MB10', '2026-10-01', '05:00', '12:00');
    const r = run(db);
    expect(person(r, 'MB10').early_days).toBe(0);
    expect(q(r, 'odd_punch')).toEqual({ days: 1, people: [{ code: 'MB10', days: 1 }] });
  });

  test('half days (½P) are not assessed for late or early — a part-timer is not "late" every day', () => {
    const db = F.newDb(); F.emp(db, 'MB11'); master(db, 'MB11', '9HR'); sep(db, 'MB11', '09:30', '18:30');
    F.weekdays(2026, 10).slice(0, 12).forEach((d) => punch(db, 'MB11', d, '15:30', '17:30', { st: '½P' }));
    const r = run(db);
    const p = person(r, 'MB11');
    expect(p.late_days).toBe(0); expect(p.early_days).toBe(0);
    expect(q(r, 'half_day').days).toBe(12);
  });

  test('excluded codes and excluded departments are left out of the data-quality lists too', () => {
    const db = F.newDb(); F.emp(db, 'MB12'); F.emp(db, 'MB16', { department: 'PIECE RATE' }); F.emp(db, 'MB17');
    for (const c of ['MB12', 'MB16', 'MB17']) punch(db, c, '2026-10-01', '08:00', '20:00');
    const r = run(db, { ...MASTER, excluded_codes: ['MB12'], excluded_departments: ['piece rate'] });
    expect(q(r, 'no_master')).toEqual({ days: 1, people: [{ code: 'MB17', days: 1 }] });
  });
});

describe('miss-punch days fixed from the gate register (MP-1, MP-3)', () => {
  test('a fixed miss-punch day is assessed with the gate times; turning it off skips it as before', () => {
    const db = F.newDb(); F.emp(db, 'MB13'); master(db, 'MB13', '12HR'); sep(db, 'MB13');
    punch(db, 'MB13', '2026-10-01', '08:00', '17:00', { mp: 1, resolved: 1 });   // 180 early
    const on = run(db);
    expect(person(on, 'MB13').early_days).toBe(1); expect(person(on, 'MB13').early_min).toBe(180);
    expect(q(on, 'gate_register').days).toBe(1);
    const off = run(db, { ...MASTER, assess_fixed_miss_punch: false });
    expect(person(off, 'MB13').early_days).toBe(0);
    expect(q(off, 'gate_register').days).toBe(0);
    expect(q(off, 'miss_punch_open').days).toBe(1);
  });

  test('an out typed as exactly the shift end is "out not verified": no early exit, and it cannot excuse the late by full hours', () => {
    const db = F.newDb(); F.emp(db, 'MB14'); master(db, 'MB14', '12HR'); sep(db, 'MB14');
    punch(db, 'MB14', '2026-10-01', '08:30', '20:00', { mp: 1, resolved: 1 });   // out = shift end
    punch(db, 'MB14', '2026-10-02', '08:30', '20:30');                           // normal day: late 30 made up → excused
    const r = run(db);
    const p = person(r, 'MB14');
    expect(p.late_days).toBe(1); expect(p.late_min).toBe(30);                     // only the unverified day counts
    expect(p.early_days).toBe(0);
    expect(q(r, 'out_not_verified')).toEqual({ days: 1, people: [{ code: 'MB14', days: 1 }] });
  });

  test('a miss-punch day not yet resolved is still skipped and listed as open', () => {
    const db = F.newDb(); F.emp(db, 'MB15'); master(db, 'MB15', '12HR'); sep(db, 'MB15');
    punch(db, 'MB15', '2026-10-01', '09:00', '15:00', { mp: 1 });
    const r = run(db);
    expect(person(r, 'MB15').late_days).toBe(0); expect(person(r, 'MB15').early_days).toBe(0);
    expect(q(r, 'miss_punch_open').days).toBe(1);
  });
});

describe('release days, re-measure, SQL parity', () => {
  test('release days are detected on the master basis', () => {
    const db = F.newDb();
    for (const c of ['MB20', 'MB21', 'MB22']) { F.emp(db, c); master(db, c, '12HR'); punch(db, c, '2026-10-07', '08:00', '17:00'); }
    F.emp(db, 'MB23'); master(db, 'MB23', '12HR'); punch(db, 'MB23', '2026-10-07', '08:00', '20:00');
    punch(db, 'MB23', '2026-10-08', '08:00', '17:00');   // one of three early on the 8th → not a release day
    for (const c of ['MB21', 'MB22']) punch(db, c, '2026-10-08', '08:00', '20:00');
    expect(S.detectReleaseDays(db, M, Y, S.mergeConfig({})).map((d) => d.date)).toEqual([]);   // import flags are all 0
    expect(S.detectReleaseDays(db, M, Y, S.mergeConfig(MASTER)).map((d) => d.date)).toEqual(['2026-10-07']);
    // a confirmed release day is not counted
    const r = run(db, MASTER, { releaseDays: ['2026-10-07'] });
    expect(person(r, 'MB20').early_days).toBe(0);
  });

  test('a re-measure row still wins over the master for that code', () => {
    const db = F.newDb(); F.emp(db, 'MB30'); master(db, 'MB30', '12HR'); sep(db, 'MB30');
    punch(db, 'MB30', '2026-10-01', '09:05', '19:00');   // on 12HR: 65 late + 60 early; on 09:00–19:00: clean
    expect(person(run(db), 'MB30').late_days).toBe(1);
    const r = run(db, { ...MASTER, remeasure: { MB30: { start: '09:00', end: '19:00', late_grace: 9, early_grace: 15 } } });
    expect(person(r, 'MB30').late_days).toBe(0); expect(person(r, 'MB30').early_days).toBe(0);
  });

  test('inlined master SQL (for the SQL Console acceptance check) returns exactly what the bound statement returns', () => {
    const db = F.newDb(); F.emp(db, 'MB40'); master(db, 'MB40', '10HR'); sep(db, 'MB40', '09:00', '19:00');
    punch(db, 'MB40', '2026-10-01', "09:20", '18:00');
    const p = S.sqlParams(M, Y, S.mergeConfig(MASTER), ['2026-10-07'], []);
    expect(db.prepare(S.inlineParams(S.PERSON_MONTH_SQL_MASTER, p)).all()).toEqual(db.prepare(S.PERSON_MONTH_SQL_MASTER).all(p));
  });

  test('weekly trend follows the basis', () => {
    const db = F.newDb(); F.emp(db, 'MB41'); master(db, 'MB41', '10HR'); sep(db, 'MB41', '09:00', '19:00');
    punch(db, 'MB41', '2026-10-01', '09:40', '19:00');
    const wk = (r) => r.trend.weekly.filter((w) => w.week_start >= '2026-09-28').reduce((a, w) => a + w.late_days, 0);
    expect(wk(run(db, {}))).toBe(0);
    expect(wk(run(db))).toBe(1);
  });
});

describe('exports', () => {
  test('the Excel summary says which basis was used and, on the master basis, what was left out', () => {
    const XLSX = require('xlsx'); const X = require('../services/attendanceReviewExports');
    const db = F.newDb(); F.emp(db, 'MB50'); master(db, 'MB50', '12HR'); sep(db, 'MB50'); F.emp(db, 'MB51');
    punch(db, 'MB50', '2026-10-01', '08:00', '17:00', { mp: 1, resolved: 1 });
    punch(db, 'MB51', '2026-10-01', '08:00', '20:00');
    const rowsOf = (res) => XLSX.utils.sheet_to_json(XLSX.read(X.buildWorkbook(res, { status: 'draft' }), { type: 'buffer' }).Sheets.Summary, { header: 1 });
    const m = rowsOf(run(db));
    const val = (rows, label) => (rows.find((r) => r[0] === label) || [])[1];
    expect(val(m, 'Measured against')).toBe("Each person's current master shift");
    expect(val(m, 'Worked days not assessed (no master / night on a day master / odd punch)')).toBe(1);
    expect(val(m, 'Miss-punch days assessed with gate-register times')).toBe(1);
    const i = rowsOf(run(db, {}));
    expect(val(i, 'Measured against')).toBe('The shift the import matched (import basis)');
    expect(val(i, 'Miss-punch days assessed with gate-register times')).toBeUndefined();
  });
});
