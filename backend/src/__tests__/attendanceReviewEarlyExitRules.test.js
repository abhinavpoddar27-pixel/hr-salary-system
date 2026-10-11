/**
 * Attendance Review — PR-3 rules (owner rulings D-4, D-6, MP-2). Synthetic codes (ER…), import basis, Oct 2026 (prev Sep).
 *  D-4  early_exit_rule 'd4': each counted exit of 2 h+ = ½ day; 3+ exits of 60+ min → the 60–119 min ones' minutes deducted.
 *  D-6  late_long_always_counted: a 2 h+ late is not excused by full hours (stayed-late still excuses); listed as a shift question.
 *  MP-2 missed_out_rule: from the 5th own missed punch (bulk-failure days not counted) each missed OUT = a 2 h early exit.
 * Every switch is off by default, so a config without them gives the same counts and deductions as before.
 */
const F = require('./helpers/attendanceReviewFixture');
const S = require('../services/attendanceReviewService');

const M = 10; const Y = 2026;
const oct = F.weekdays(Y, M);
const review = (db, config = {}) => S.computeAttendanceReview(db, { month: M, year: Y, config });
const person = (r, code) => r.people.find((p) => p.code === code);
const early = (r, code) => r.earlyExitWarnings.find((x) => x.code === code);
const listed = (r, code) => r.actionList.find((x) => x.code === code);
const D4 = { early_exit_rule: 'd4' };

/** Every person gets 10 clean September days (not a newcomer) unless `newcomer`. */
function emp(db, code, over = {}) {
  F.emp(db, code, over);
  if (!over.newcomer) F.month(db, code, Y, 9, 10);
}
function missed(db, code, date, type = 'MISSING_OUT') {
  F.day(db, code, date, { mp: 1 });
  db.prepare('UPDATE attendance_processed SET miss_punch_type = ?, miss_punch_resolved = 1 WHERE employee_code = ? AND date = ?').run(type, code, date);
}

function seed(db) {
  // ERH1: one 130-min early exit, otherwise clean (20 days)
  emp(db, 'ERH1'); oct.slice(0, 20).forEach((d, i) => F.day(db, 'ERH1', d, i === 3 ? { em: 130 } : {}));
  // ERM3: three 70-min exits; ERM2: two 70-min exits
  emp(db, 'ERM3'); oct.slice(0, 20).forEach((d, i) => F.day(db, 'ERM3', d, i < 3 ? { em: 70 } : {}));
  emp(db, 'ERM2'); oct.slice(0, 20).forEach((d, i) => F.day(db, 'ERM2', d, i < 2 ? { em: 70 } : {}));
  // ERMIX: two 130-min + two 70-min exits
  emp(db, 'ERMIX'); oct.slice(0, 20).forEach((d, i) => F.day(db, 'ERMIX', d, i < 2 ? { em: 130 } : i < 4 ? { em: 70 } : {}));
  // ERNEW: newcomer with a 130-min exit → warning only
  emp(db, 'ERNEW', { newcomer: true }); oct.slice(0, 20).forEach((d, i) => F.day(db, 'ERNEW', d, i === 0 ? { em: 130 } : {}));
  // ERLIST: late regular (8 lates of 30 min) + one 130-min exit
  emp(db, 'ERLIST'); oct.slice(0, 20).forEach((d, i) => F.day(db, 'ERLIST', d, i < 8 ? { lm: 30 } : i === 10 ? { em: 130 } : {}));
  // ERLONG: a 150-min late on a full-hours day (in 10:30, out 22:35); a second one after staying late the evening before
  emp(db, 'ERLONG'); oct.slice(0, 20).forEach((d, i) => F.day(db, 'ERLONG', d,
    i === 5 ? { lm: 150, it: '10:30', ot: '22:35' } : i === 8 ? { ll: 1, ot: '21:00' } : i === 9 ? { lm: 150, it: '10:30', ot: '22:35' } : {}));
  // Bulk-failure threshold is 5 in the MP-2 test: oct[2] has 6 missed punches plant-wide, every other day fewer.
  // ERMP: 7 missed OUTs (days 0–6); day 2 is a bulk day → 6 own → MP-2 counts the 5th and 6th own (days 5 and 6)
  emp(db, 'ERMP'); oct.slice(0, 20).forEach((d, i) => (i < 7 ? missed(db, 'ERMP', d) : F.day(db, 'ERMP', d, {})));
  // ERMPIN: own missed OUTs on days 0, 1, 3, 4 (+ bulk day 2) and a missed IN on day 5 → the 5th own is not an OUT
  emp(db, 'ERMPIN'); oct.slice(0, 20).forEach((d, i) => (i < 5 ? missed(db, 'ERMPIN', d) : i === 5 ? missed(db, 'ERMPIN', d, 'MISSING_IN') : F.day(db, 'ERMPIN', d, {})));
  // ERMPB: 5 missed OUTs, one of them on the bulk-failure day → only 4 own
  emp(db, 'ERMPB'); oct.slice(0, 20).forEach((d, i) => (i < 5 ? missed(db, 'ERMPB', d) : F.day(db, 'ERMPB', d, {})));
  emp(db, 'ERBULK1'); emp(db, 'ERBULK2'); missed(db, 'ERBULK1', oct[2]); missed(db, 'ERBULK2', oct[2]);
  oct.slice(3, 15).forEach((d) => { F.day(db, 'ERBULK1', d, {}); F.day(db, 'ERBULK2', d, {}); });
  // ERLOAD: contract loader with 6 missed OUTs → early exits not assessed, MP-2 does not apply
  emp(db, 'ERLOAD', { designation: 'LOADER', employment_type: 'Contract', is_contractor: 1 });
  oct.slice(0, 20).forEach((d, i) => (i < 6 ? missed(db, 'ERLOAD', d) : F.day(db, 'ERLOAD', d, {})));
}

describe('PR-3 rules', () => {
  let db;
  beforeAll(() => { db = F.newDb(); seed(db); });

  test('switches off (default): counts and deductions as before; long lates are listed but still excused', () => {
    const r = review(db, {});
    expect(r.criteria).toMatchObject({ early_exit_rule: 'warning', late_long_always_counted: false, missed_out_rule: false });
    expect(early(r, 'ERH1')).toBeUndefined();                              // one exit is not a warning line
    expect(early(r, 'ERM3')).toMatchObject({ action: 'warning', deduction_days: 0, early_exits: 3 });
    expect(listed(r, 'ERLIST')).toMatchObject({ action: 'deduction', deduction_days: 0.5 }); // (240 + 130) / 720 = 0.51
    expect(person(r, 'ERLONG')).toBeUndefined();                           // both long lates excused (full hours, stayed late)
    expect(r.longLates.find((x) => x.code === 'ERLONG')).toMatchObject({ long_lates: 0, full_hours_forgiven: 1 });
    expect(person(r, 'ERMP')).toBeUndefined();                             // missed punches are not early exits
    expect(r.missedOut.rule).toBe(false);
  });

  test('D-4: 2 h+ exit = ½ day; 3+ exits of 60+ min = minutes; fewer = nothing; newcomer = warning', () => {
    const r = review(db, D4);
    expect(early(r, 'ERH1')).toMatchObject({ action: 'deduction', deduction_days: 0.5, over_2h: 1, d4_days: 0.5 });
    expect(early(r, 'ERM3')).toMatchObject({ action: 'deduction', deduction_days: 0.5 });           // 210 / 720 → ½ (minimum)
    expect(early(r, 'ERM3').d4).toMatchObject({ half_days: 0, long_exits: 3, minutes: 210 });
    expect(early(r, 'ERM2')).toBeUndefined();                                                        // 2 exits: no line
    expect(early(r, 'ERMIX')).toMatchObject({ action: 'deduction', deduction_days: 1 });            // 1.0 + 140 / 720 = 1.19 → 1
    expect(early(r, 'ERMIX').d4).toMatchObject({ half_days: 2, long_exits: 4, minutes: 140, raw: 1.19 });
    expect(early(r, 'ERNEW')).toMatchObject({ action: 'warning', deduction_days: 0, newcomer: true });
  });

  test('D-4 on the action list: early part = max(minutes, D-4 charge) — never less than before', () => {
    const r = review(db, D4);
    const l = listed(r, 'ERLIST');
    expect(l.workdays_lost).toBeCloseTo(0.51, 2);
    expect(l).toMatchObject({ action: 'deduction', deduction_days: 1, over_2h: 1 });              // 240/720 + max(130/720, 0.5) = 0.83 → 1
    expect(early(r, 'ERLIST')).toBeUndefined();                                                     // not listed twice
    expect(r.actionTotals.deduction_days).toBe(r.actionList.filter((a) => a.action === 'deduction').reduce((s, a) => s + a.deduction_days, 0));
  });

  test('D-6: a 2 h+ late on a full-hours day is counted and listed; stayed late the evening before still excuses it', () => {
    const r = review(db, { late_long_always_counted: true });
    expect(person(r, 'ERLONG')).toMatchObject({ late_days: 1, long_lates: 1, late_min: 150 });
    expect(r.longLates.find((x) => x.code === 'ERLONG')).toMatchObject({ long_lates: 1, full_hours_kept: 1, full_hours_forgiven: 0, avg_minutes: 150 });
    expect(r.trend.weekly.reduce((s, w) => s + w.late_days, 0)).toBe(r.trend.monthly['2026-10'].All.late_days); // weekly agrees
  });

  test('MP-2: from the 5th own missed punch each missed OUT is a 2 h early exit (½ day under D-4)', () => {
    const r = review(db, { ...D4, missed_out_rule: true, thresholds: { bulk_miss_punch_day: 5 } });
    expect(r.criteria.missed_out_rule).toBe(true);
    expect(early(r, 'ERMP')).toMatchObject({ action: 'deduction', deduction_days: 1, missed_out_days: 2, over_2h: 2, early_exits: 2 });
    expect(person(r, 'ERMP')).toMatchObject({ early_days: 2, early_min: 240, missed_out_days: 2 });
    const mo = r.missedOut.people.find((x) => x.code === 'ERMP');
    expect(mo).toMatchObject({ personal_missed_punches: 6, counted_as_early: 2 });
    expect(mo.dates).toEqual([oct[5], oct[6]]);
    // the 5th is a missed IN → nothing counted; a bulk-failure day does not count towards the 5
    expect(early(r, 'ERMPIN')).toBeUndefined();
    expect(early(r, 'ERMPB')).toBeUndefined();
    expect(r.missedOut.bulk_days).toEqual([oct[2]]);
    expect(r.missedOut.people.find((x) => x.code === 'ERMPB')).toBeUndefined(); // only 4 own
    // a contractor loader's early exits are not assessed → MP-2 does not apply
    expect(early(r, 'ERLOAD')).toBeUndefined();
    expect(r.missedOut.people.find((x) => x.code === 'ERLOAD')).toMatchObject({ counted_as_early: 0, exempt: true });
  });

  test('MP-2 days are taken out of the measured early exits, so the same day is never counted twice', () => {
    const d2 = F.newDb(); emp(d2, 'ERTWICE');
    oct.slice(0, 10).forEach((d, i) => F.day(d2, 'ERTWICE', d, i === 2 ? { em: 90 } : {}));
    const cfg = S.mergeConfig({});
    const base = S.loadPersonMonth(d2, M, Y, cfg, [], []).find((x) => x.code === 'ERTWICE' && x.ym === '2026-10');
    const cut = S.loadPersonMonth(d2, M, Y, cfg, [], [], null, [`ERTWICE|${oct[2]}`]).find((x) => x.code === 'ERTWICE' && x.ym === '2026-10');
    expect(base).toMatchObject({ early_exits: 1, early_mid: 1, early_mid_min: 90 });
    expect(cut).toMatchObject({ early_exits: 0, early_mid: 0 });
  });

  test('send to finance includes the early-exit section deductions (one row per person)', () => {
    const r = review(db, D4);
    const run = { id: 77, month: M, year: Y, result_json: JSON.stringify(r) };
    const plan = S.financeSendPlan(db, run);
    const h1 = plan.create.find((c) => c.code === 'ERH1');
    expect(h1).toMatchObject({ deduction_days: 0.5, late_count: 0, source: 'early' });
    expect(h1.remark).toMatch(/\[review run 77\].*early exits.*1 of 2 h or more/);
    expect(plan.create.find((c) => c.code === 'ERLIST')).toMatchObject({ deduction_days: 1, source: 'list' });
    expect(plan.create.find((c) => c.code === 'ERNEW')).toBeUndefined();          // warning, not sent
    expect(new Set(plan.create.map((c) => c.code)).size).toBe(plan.create.length);
  });

  test('config: d4 and the two switches validate; bad values are refused', () => {
    expect(S.validateConfig({ early_exit_rule: 'd4', late_long_always_counted: true, missed_out_rule: false })).toEqual([]);
    expect(S.validateConfig({ thresholds: { long_late_minutes: 120, d4_long_count: 3, missed_out_from: 5 } })).toEqual([]);
    expect(S.validateConfig({ early_exit_rule: 'd5' }).join()).toMatch(/early_exit_rule/);
    expect(S.validateConfig({ missed_out_rule: 'yes' }).join()).toMatch(/missed_out_rule/);
    expect(S.validateConfig({ late_long_always_counted: 1 }).join()).toMatch(/late_long_always_counted/);
  });

  test('exports: Excel has the long-late and missed-OUT sheets and the 2 h rule column; Word pack builds', async () => {
    const XLSX = require('xlsx'); const X = require('../services/attendanceReviewExports');
    const r = review(db, { ...D4, late_long_always_counted: true, missed_out_rule: true, thresholds: { bulk_miss_punch_day: 5 } });
    const wb = XLSX.read(X.buildWorkbook(r, { status: 'draft' }), { type: 'buffer' });
    expect(wb.SheetNames).toEqual(expect.arrayContaining(['Late 2h or more', 'Missed OUT']));
    const ew = XLSX.utils.sheet_to_json(wb.Sheets['Early-exit warnings']);
    expect(ew.find((x) => x.Code === 'ERH1')).toMatchObject({ '2 h or more': 1, '2 h rule days': 0.5, 'Deduction days': 0.5 });
    expect(XLSX.utils.sheet_to_json(wb.Sheets['Missed OUT']).find((x) => x.Code === 'ERMP')).toMatchObject({ 'Counted as early exits': 2 });
    const rules = XLSX.utils.sheet_to_json(wb.Sheets['Rules used'], { header: 1 });
    expect(rules).toEqual(expect.arrayContaining([['early_exit_rule', 'd4'], ['missed_out_rule', 'on'], ['late_long_always_counted', 'on']]));
    const buf = await X.buildDocx(r, { status: 'draft' });
    expect(buf.length).toBeGreaterThan(5000);
  });
});
