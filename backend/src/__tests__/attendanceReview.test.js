/**
 * Attendance Review engine (services/attendanceReviewService.js) — every RUNBOOK rule + the D2 selection rule.
 * Synthetic codes only. Current month Oct 2026, previous Sep 2026.
 */
const F = require('./helpers/attendanceReviewFixture');
const S = require('../services/attendanceReviewService');

const M = 10; const Y = 2026;
const run = (db, over = {}) => S.computeAttendanceReview(db, { month: M, year: Y, config: over.config || {}, releaseDays: over.releaseDays || [], prevReleaseDays: over.prevReleaseDays || [], overrides: over.overrides || [] });
// people lists only those with a late or an early exit; a clean month reads as zeros
const person = (r, code) => r.people.find((p) => p.code === code) || { code, late_days: 0, early_days: 0, late_min: 0, early_min: 0 };
const action = (r, code) => r.actionList.find((p) => p.code === code);

/** A steady previous month: 22 worked days, `lates` late mornings of 30 min, `early` early exits of 30 min. */
function sep(db, code, { days = 22, lates = 0, early = 0 } = {}) {
  F.month(db, code, 2026, 9, days, (i) => ({ lm: i < lates ? 30 : 0, em: i < early ? 30 : 0 }));
}

describe('counting rules', () => {
  test('grace: 9 min not late, 10 min late; 600+ dropped as a misread', () => {
    const db = F.newDb(); F.emp(db, 'AR1'); sep(db, 'AR1');
    F.day(db, 'AR1', '2026-10-01', { lm: 9 }); F.day(db, 'AR1', '2026-10-02', { lm: 10 }); F.day(db, 'AR1', '2026-10-03', { lm: 600 });
    const p = person(run(db), 'AR1');
    expect(p.late_days).toBe(1); expect(p.late_min).toBe(10); expect(p.worked_days).toBe(3);
  });

  test('stayed-late: previous worked day excuses count AND minutes; Sunday gap still finds Saturday', () => {
    const db = F.newDb(); F.emp(db, 'AR2'); sep(db, 'AR2');
    F.day(db, 'AR2', '2026-10-03', { ll: 1 });            // Sat stayed late
    F.day(db, 'AR2', '2026-10-05', { lm: 45 });           // Mon late → excused (prev worked day = Sat)
    F.day(db, 'AR2', '2026-10-06', { lm: 45 });           // Tue late → counted
    const worked = person(run(db, { config: { stayed_late_mode: 'worked' } }), 'AR2');
    expect(worked.late_days).toBe(1); expect(worked.late_min).toBe(45);
    const cal = person(run(db, { config: { stayed_late_mode: 'calendar' } }), 'AR2');
    expect(cal.late_days).toBe(2);                         // Sunday 4 Oct has no row → Monday not excused by calendar
  });

  test('stayed-late on the previous calendar day counts when that day was not a worked day (either / calendar, not worked)', () => {
    const db = F.newDb(); F.emp(db, 'AR3'); sep(db, 'AR3');
    F.day(db, 'AR3', '2026-10-01', {});
    F.day(db, 'AR3', '2026-10-02', { ll: 1, mp: 1 });      // miss punch day → not worked, but left late
    F.day(db, 'AR3', '2026-10-03', { lm: 30 });
    expect(person(run(db), 'AR3').late_days).toBe(0);                                         // default 'either'
    expect(person(run(db, { config: { stayed_late_mode: 'calendar' } }), 'AR3').late_days).toBe(0);
    expect(person(run(db, { config: { stayed_late_mode: 'worked' } }), 'AR3').late_days).toBe(1); // prev WORKED day = 1 Oct
  });

  test('early exit window 15 < m < 600, Mon–Sat, release days out', () => {
    const db = F.newDb(); F.emp(db, 'AR4'); sep(db, 'AR4');
    F.day(db, 'AR4', '2026-10-01', { em: 15 }); F.day(db, 'AR4', '2026-10-02', { em: 16 }); F.day(db, 'AR4', '2026-10-03', { em: 599 });
    F.day(db, 'AR4', '2026-10-05', { em: 600 });
    F.day(db, 'AR4', '2026-10-04', { st: 'WOP', em: 60 });                 // Sunday
    F.day(db, 'AR4', '2026-10-06', { em: 90 });                            // release day
    const p = person(run(db, { releaseDays: ['2026-10-06'] }), 'AR4');
    expect(p.early_days).toBe(2); expect(p.early_min).toBe(615);
    expect(person(run(db), 'AR4').early_days).toBe(3);                     // without the release day
  });

  test('½P is a worked day at half the scheduled minutes; miss punches are not worked days', () => {
    const db = F.newDb(); F.emp(db, 'AR5'); sep(db, 'AR5');
    F.day(db, 'AR5', '2026-10-01', { st: '½P', lm: 20 }); F.day(db, 'AR5', '2026-10-02', { mp: 1, lm: 40 });
    const r = run(db); const p = person(r, 'AR5');
    expect(p.worked_days).toBe(1); expect(p.late_days).toBe(1);
    expect(r.departments.find((d) => d.department === 'PRODUCTION').sched_min).toBe(360);
  });

  test('loading staff: lates not assessed, early exits counted', () => {
    const db = F.newDb(); F.emp(db, 'AR6', { designation: 'LOADER' }); sep(db, 'AR6');
    F.day(db, 'AR6', '2026-10-01', { lm: 60, em: 30 });
    const p = person(run(db), 'AR6'); expect(p.late_days).toBe(0); expect(p.early_days).toBe(1);
  });
});

describe('selection (D2 Option 2)', () => {
  test('late-regular: improved at exactly 60% is out, above 60% is in', () => {
    const db = F.newDb(); F.emp(db, 'ARI'); F.emp(db, 'ARN');
    sep(db, 'ARI', { lates: 15 }); sep(db, 'ARN', { lates: 15 });
    F.month(db, 'ARI', 2026, 10, 20, (i) => ({ lm: i < 9 ? 30 : 0 }));   // 9 ≤ 0.6×15 → improved
    F.month(db, 'ARN', 2026, 10, 20, (i) => ({ lm: i < 10 ? 30 : 0 }));  // 10 > 9 → not improved
    const r = run(db);
    expect(action(r, 'ARI')).toBeUndefined();
    expect(action(r, 'ARN')).toMatchObject({ action: 'deduction', categories: ['late_regular'] });
    expect(r.noticeLate.map((n) => n.code).sort()).toEqual(['ARI', 'ARN']);
  });

  test('late-regular needs 10 worked days', () => {
    const db = F.newDb(); F.emp(db, 'ARW'); sep(db, 'ARW', { lates: 2 });
    F.month(db, 'ARW', 2026, 10, 9, () => ({ lm: 30 }));
    expect(action(run(db), 'ARW')).toBeUndefined();
  });

  test('double needs 0.90 workdays lost (0.89 out)', () => {
    const db = F.newDb(); F.emp(db, 'ARD'); F.emp(db, 'ARE'); sep(db, 'ARD'); sep(db, 'ARE');
    // 12-h shift → 720 min per workday; 0.9 = 648 min
    F.month(db, 'ARD', 2026, 10, 8, (i) => (i < 4 ? { lm: 81 } : { em: 81 }));               // 648 → in
    F.month(db, 'ARE', 2026, 10, 8, (i) => (i < 4 ? { lm: 81 } : { em: i === 7 ? 80 : 81 })); // 647 → out
    const r = run(db);
    expect(action(r, 'ARD')).toMatchObject({ categories: ['double'], workdays_lost: 0.9, deduction_days: 1 });
    expect(action(r, 'ARE')).toBeUndefined();
    expect(r.doubleDefaulters.map((d) => [d.code, d.selected])).toEqual([['ARD', true], ['ARE', false]]);
    expect(r.earlyExitWarnings.map((w) => w.code)).toEqual(['ARE']);
  });

  test('early-regular needs workdays lost ≥ 0.9; early-only below that is a warning', () => {
    const db = F.newDb(); F.emp(db, 'ARX'); F.emp(db, 'ARY'); sep(db, 'ARX', { early: 8 }); sep(db, 'ARY', { early: 8 });
    F.month(db, 'ARX', 2026, 10, 20, (i) => ({ em: i < 9 ? 90 : 0 }));  // 810 min = 1.125
    F.month(db, 'ARY', 2026, 10, 20, (i) => ({ em: i < 9 ? 30 : 0 }));  // 270 min = 0.375
    const r = run(db);
    expect(action(r, 'ARX')).toMatchObject({ categories: ['early_regular'], deduction_days: 1 });
    expect(action(r, 'ARY')).toBeUndefined();
    expect(r.earlyExitWarnings.find((w) => w.code === 'ARY')).toMatchObject({ action: 'warning', early_exits: 9 });
  });

  test('newcomer: no last-month row or < 5 days → warning; 5 days → deduction', () => {
    const db = F.newDb();
    for (const [code, prevDays] of [['ARA', 0], ['ARB', 4], ['ARC', 5]]) {
      F.emp(db, code); if (prevDays) F.month(db, code, 2026, 9, prevDays);
      F.month(db, code, 2026, 10, 20, (i) => ({ lm: i < 10 ? 40 : 0 }));
    }
    const r = run(db);
    expect(action(r, 'ARA')).toMatchObject({ action: 'warning', deduction_days: 0, newcomer: true });
    expect(action(r, 'ARB')).toMatchObject({ action: 'warning', newcomer: true });
    expect(action(r, 'ARC')).toMatchObject({ action: 'deduction', newcomer: false });
  });

  test('deduction rounds to nearest 0.5, minimum 0.5; indicative ₹ = gross ÷ days × days', () => {
    const t = S.DEFAULT_CONFIG.thresholds;
    expect([0.16, 0.24, 0.74, 0.75, 1.24, 1.25, 2.09].map((x) => S.roundDeduction(x, t))).toEqual([0.5, 0.5, 0.5, 1, 1, 1.5, 2]);
    const db = F.newDb(); F.emp(db, 'ARR', { gross_salary: 31000 }); sep(db, 'ARR', { lates: 10 });
    F.month(db, 'ARR', 2026, 10, 20, (i) => ({ lm: i < 10 ? 40 : 0 }));
    const a = action(run(db), 'ARR');
    expect(a.deduction_days).toBe(0.5); expect(a.indicative_amount).toBe(500);
  });
});

describe('exclusions, re-measure, overrides, rule switch', () => {
  function heavy(db, code, over) { F.emp(db, code, over); sep(db, code, { lates: 10, early: 10 }); F.month(db, code, 2026, 10, 20, (i) => ({ lm: i < 10 ? 60 : 0, em: i < 10 ? 60 : 0 })); }

  test('excluded codes / departments appear in no list; early-excluded only drop out of early lists', () => {
    const db = F.newDb();
    heavy(db, 'ARS'); heavy(db, 'ARP', { department: 'PIECE CONT' }); heavy(db, 'ARZ'); heavy(db, 'ARK');
    const r = run(db, { config: { excluded_codes: ['ARS'], excluded_departments: ['piece cont'], early_excluded_codes: ['ARZ'] } });
    const all = JSON.stringify([r.people, r.actionList, r.earlyExitWarnings, r.noticeLate, r.noticeEarly, r.doubleDefaulters, r.regular, r.departments]);
    expect(all).not.toMatch(/ARS|ARP|PIECE/);
    expect(r.meta.excluded_people).toBe(2);
    expect(r.noticeEarly.map((n) => n.code)).toEqual(['ARK']);
    expect(r.noticeLate.map((n) => n.code).sort()).toEqual(['ARK', 'ARZ']);
    expect(action(r, 'ARZ')).toMatchObject({ early_days: 0, categories: ['late_regular'] });
  });

  test('held codes are listed as held with no action or notice', () => {
    const db = F.newDb(); heavy(db, 'ARH');
    const r = run(db, { config: { held_codes: ['ARH'] } });
    expect(r.held.map((h) => h.code)).toEqual(['ARH']);
    expect(r.actionList).toHaveLength(0); expect(r.noticeLate).toHaveLength(0); expect(r.noticeEarly).toHaveLength(0);
  });

  test('re-measure uses the configured shift for both months', () => {
    const db = F.newDb(); F.emp(db, 'ARM');
    // System measured him on 12 h (08:00) — every day reads 60 min late. Real shift 09:00–19:00.
    F.month(db, 'ARM', 2026, 9, 20, () => ({ it: '09:05', ot: '19:00', lm: 65 }));
    F.month(db, 'ARM', 2026, 10, 20, (i) => ({ it: i < 9 ? '09:40' : '09:00', ot: i === 0 ? '18:00' : '19:05', lm: 100 }));
    F.day(db, 'ARM', '2026-10-25', { st: 'WOP', it: '09:00', ot: '17:00' });            // Sunday: early not counted
    const base = person(run(db), 'ARM'); expect(base.late_days).toBe(20);
    const r = run(db, { config: { remeasure: { ARM: { start: '09:00', end: '19:00', late_grace: 9, early_grace: 15 } } } });
    const p = person(r, 'ARM');
    expect(p).toMatchObject({ late_days: 9, late_min: 360, early_days: 1, early_min: 60, shift_h: 10, remeasured: true });
    expect(p.last_month).toMatchObject({ late_days: 0 });                                   // Sep 09:05 within grace
    expect(p.workdays_lost).toBe(0.7);
  });

  test('re-measure stayed-late: system flag, recomputed on the shift, or off', () => {
    const db = F.newDb(); F.emp(db, 'ARV'); F.month(db, 'ARV', 2026, 9, 20);
    // Day 1 leaves 19:30 (≥ 19:20 on a 19:00 shift, but not flagged by the system); day 2 late 30 min.
    F.day(db, 'ARV', '2026-10-01', { it: '09:00', ot: '19:30' }); F.day(db, 'ARV', '2026-10-02', { it: '09:30', ot: '19:00' });
    // Day 3 system-flagged stayed late; day 5 late 30 min.
    F.day(db, 'ARV', '2026-10-03', { it: '09:00', ot: '19:10', ll: 1 }); F.day(db, 'ARV', '2026-10-05', { it: '09:30', ot: '19:00' });
    const rm = (left) => ({ remeasure: { ARV: { start: '09:00', end: '19:00', left_late: left } } });
    expect(person(run(db, { config: rm('system') }), 'ARV').late_days).toBe(1);   // only 5 Oct excused
    expect(person(run(db, { config: rm('shift') }), 'ARV').late_days).toBe(1);    // only 2 Oct excused (19:30 ≥ 19:20)
    expect(person(run(db, { config: rm('off') }), 'ARV').late_days).toBe(2);
    expect(S.validateConfig(rm('maybe'))[0]).toMatch(/left_late/);
  });

  test('re-measure full-hours excuse: a late or early exit is not counted when the shift length was still worked', () => {
    const db = F.newDb(); F.emp(db, 'ARF'); F.month(db, 'ARF', 2026, 9, 20);
    F.day(db, 'ARF', '2026-10-01', { it: '09:40', ot: '19:45' });   // late 40, worked 10 h 05 → excused
    F.day(db, 'ARF', '2026-10-02', { it: '09:40', ot: '19:20' });   // late 40, worked 9 h 40 → counted
    F.day(db, 'ARF', '2026-10-03', { it: '09:15', ot: '19:06' });   // late 15, worked 9 h 51 → excused only with the 10-min tolerance
    F.day(db, 'ARF', '2026-10-05', { it: '08:00', ot: '18:00' });   // early 60, worked 10 h → excused
    F.day(db, 'ARF', '2026-10-06', { it: '09:00', ot: '18:00' });   // early 60, worked 9 h → counted
    const rm = (extra) => ({ remeasure: { ARF: { start: '09:00', end: '19:00', left_late: 'off', ...extra } } });
    expect(person(run(db, { config: rm({}) }), 'ARF')).toMatchObject({ late_days: 3, early_days: 2, hours_excused: 0 });
    expect(person(run(db, { config: rm({ hours_complete: true }) }), 'ARF')).toMatchObject({ late_days: 1, late_min: 40, early_days: 1, early_min: 60, hours_excused: 3 });
    expect(person(run(db, { config: rm({ hours_complete: true, hours_grace: 0 }) }), 'ARF')).toMatchObject({ late_days: 2, early_days: 1, hours_excused: 2 });
    expect(S.validateConfig(rm({ hours_complete: 'yes' }))[0]).toMatch(/hours_complete/);
    expect(S.validateConfig(rm({ hours_complete: true, hours_grace: 500 }))[0]).toMatch(/hours_grace/);
    expect(S.validateConfig(rm({ hours_complete: true, hours_grace: 10 }))).toEqual([]);
  });

  test('overrides: include adds, exclude removes, warning downgrades — each with its reason', () => {
    const db = F.newDb(); heavy(db, 'AR7'); heavy(db, 'AR8'); F.emp(db, 'AR9'); sep(db, 'AR9'); F.month(db, 'AR9', 2026, 10, 20, (i) => ({ lm: i < 2 ? 30 : 0 }));
    const overrides = [{ code: 'AR7', action: 'exclude', reason: 'owner ruling' }, { code: 'AR8', action: 'warning', reason: 'confirm shift' },
      { code: 'AR9', action: 'include', reason: 'repeat offender' }, { code: 'NOPE', action: 'include', reason: 'not here' }];
    const r = run(db, { overrides });
    expect(action(r, 'AR7')).toBeUndefined();
    expect(action(r, 'AR8')).toMatchObject({ action: 'warning', deduction_days: 0, override: { reason: 'confirm shift' } });
    expect(action(r, 'AR9')).toMatchObject({ action: 'deduction', deduction_days: 0.5, categories: [] });
    expect(r.overridesApplied.map((o) => o.effect)).toEqual(['removed from action list', 'deduction changed to warning', 'added to action list', "no effect (code not in this month's data)"]);
    expect(r.earlyExitWarnings.find((w) => w.code === 'AR7')).toBeUndefined();
  });

  test('Option C deducts early-exit-only people only when switched on', () => {
    const db = F.newDb(); F.emp(db, 'ARC2'); sep(db, 'ARC2', { early: 1 });
    F.month(db, 'ARC2', 2026, 10, 20, (i) => (i < 2 ? { em: 70 } : i < 5 ? { em: 20 } : {}));  // 2 long + 3 short
    const off = run(db).earlyExitWarnings[0];
    expect(off).toMatchObject({ code: 'ARC2', early_exits: 5, over_1h: 2, option_c_days: 1.5, action: 'warning', deduction_days: 0 });
    const on = run(db, { config: { early_exit_rule: 'option_c' } }).earlyExitWarnings[0];
    expect(on).toMatchObject({ action: 'deduction', deduction_days: 1.5 });
  });
});

describe('detection, config validation, purity', () => {
  test('release-day detection: > 50% of day-shift workers early on a weekday', () => {
    const db = F.newDb();
    for (const c of ['RD1', 'RD2', 'RD3']) { F.emp(db, c); F.day(db, c, '2026-10-07', { em: c === 'RD3' ? 0 : 120 }); F.day(db, c, '2026-10-08', { em: c === 'RD1' ? 120 : 0 }); }
    expect(S.detectReleaseDays(db, M, Y, S.mergeConfig({})).map((d) => d.date)).toEqual(['2026-10-07']);
  });

  test('validateConfig rejects unknown keys, bad thresholds and bad re-measure entries', () => {
    expect(S.validateConfig({})).toEqual([]);
    expect(S.validateConfig({ thresholds: { act_workdays: 0.8 }, excluded_codes: ['A1'], remeasure: { A1: { start: '09:00', end: '19:00' } } })).toEqual([]);
    expect(S.validateConfig({ exclude_codes: [] })[0]).toMatch(/unknown key/);
    expect(S.validateConfig({ thresholds: { act_workdays: -1, nope: 1 } }).length).toBe(2);
    expect(S.validateConfig({ remeasure: { A1: { start: '19:00', end: '09:00' } } })[0]).toMatch(/after start/);
    expect(S.validateConfig({ stayed_late_mode: 'x', early_exit_rule: 'y' }).length).toBe(2);
    expect(S.validateOverrides([{ code: 'A', action: 'drop', reason: 'x' }]).length).toBe(2);
  });

  test('payroll checks flag two approved rows, rejected-but-applied, and day-calc + salary for the same lates', () => {
    const db = F.newDb();
    const ded = db.prepare("INSERT INTO late_coming_deductions (employee_code, month, year, company, late_count, deduction_days, remark, applied_by, finance_status, applied_at) VALUES (?, 9, 2026, 'X', 4, ?, 'r', 'hr', ?, ?)");
    ded.run('PC1', 3, 'approved', '2026-10-01 10:00'); ded.run('PC1', 3, 'approved', '2026-10-01 11:00');
    ded.run('PC2', 1.5, 'rejected', '2026-10-01 10:00');
    ded.run('PC3', 3, 'rejected', '2026-10-01 10:00'); ded.run('PC3', 3, 'approved', '2026-10-01 11:00');
    ded.run('PC4', 2, 'approved', '2026-10-01 10:00');
    const dc = db.prepare('INSERT INTO day_calculations (employee_code, month, year, late_deduction_days) VALUES (?, 9, 2026, ?)');
    dc.run('PC2', 1.5); dc.run('PC3', 2.5); dc.run('PC4', 0);
    const sc = db.prepare('INSERT INTO salary_computations (employee_code, month, year, late_coming_deduction) VALUES (?, 9, 2026, ?)');
    sc.run('PC3', 2274); sc.run('PC4', 1700);
    const r = run(db).payrollChecks;
    expect(r).toMatchObject({ month: 9, year: 2026, rows: 6 });
    expect(r.flags.map((f) => `${f.code}:${f.flag}`)).toEqual(['PC1:two_approved_rows', 'PC2:rejected_but_daycalc_applied', 'PC3:daycalc_and_salary_deduction']);
  });

  test('computing a review writes nothing', () => {
    const db = F.newDb(); heavy0(db);
    const count = () => db.prepare("SELECT (SELECT COUNT(*) FROM audit_log) + (SELECT COUNT(*) FROM late_coming_deductions) + (SELECT COUNT(*) FROM attendance_processed) + (SELECT COUNT(*) FROM day_calculations) n").get().n;
    const before = count(); run(db); expect(count()).toBe(before);
  });
  function heavy0(db) { F.emp(db, 'ARQ'); sep(db, 'ARQ', { lates: 10 }); F.month(db, 'ARQ', 2026, 10, 20, () => ({ lm: 30 })); }

  test('inlineParams produces the same rows as bound parameters (used by the SQL Console acceptance)', () => {
    const db = F.newDb(); F.emp(db, 'ARL'); sep(db, 'ARL', { lates: 3 }); F.month(db, 'ARL', 2026, 10, 10, (i) => ({ lm: i < 4 ? 20 : 0, em: i === 5 ? 30 : 0 }));
    const p = S.sqlParams(M, Y, S.mergeConfig({}), ['2026-10-02'], []);
    expect(db.prepare(S.inlineParams(S.PERSON_MONTH_SQL, p)).all()).toEqual(db.prepare(S.PERSON_MONTH_SQL).all(p));
  });
});
