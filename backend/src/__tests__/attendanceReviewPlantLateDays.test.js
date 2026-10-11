/**
 * Attendance Review PR-8 — plant-wide late days (plan item 7: detector + tick, like release days).
 * Owner rulings 11–12 Oct 2026: detected days start UNTICKED; a ticked day = lates on that date are not counted for anyone
 * (excused as "plant-wide late day"); early exits on that date are unaffected; the tick is saved on the run (late_free_days).
 * Synthetic codes only (PL…, PO…, PX…). Current month Oct 2026 (Sundays 4/11/18/25), previous Sep 2026.
 */
const F = require('./helpers/attendanceReviewFixture');
const S = require('../services/attendanceReviewService');
const X = require('../services/attendanceReviewExports');
const XLSX = require('xlsx');
const { startJwtApi } = require('./helpers/jwtApiHarness');

const M = 10; const Y = 2026; const DAY = '2026-10-06'; // a Tuesday
const review = (db, o = {}) => S.computeAttendanceReview(db, { month: M, year: Y, config: o.config || {}, releaseDays: o.releaseDays || [],
  prevReleaseDays: [], overrides: o.overrides || [], ...(o.lateFreeDays ? { lateFreeDays: o.lateFreeDays } : {}),
  ...(o.prevLateFreeDays ? { prevLateFreeDays: o.prevLateFreeDays } : {}) });
const person = (r, code) => r.people.find((p) => p.code === code) || { code, late_days: 0, early_days: 0 };

/** One date: `n` people at work (codes prefix1..n), the first `k` late by `lm` minutes. */
function oneDay(db, date, n, k, { prefix = 'PX', lm = 52, emp = true } = {}) {
  for (let i = 1; i <= n; i++) {
    const code = `${prefix}${i}`;
    if (emp) F.emp(db, code);
    F.day(db, code, date, i <= k ? { lm } : {});
  }
}

describe('detector', () => {
  test('both thresholds: just below / at / above (people 15, share 0.25)', () => {
    const db = F.newDb();
    oneDay(db, '2026-10-01', 40, 14, { prefix: 'PA' });              // 14 late — below people
    oneDay(db, '2026-10-02', 60, 15, { prefix: 'PB' });              // 15 of 60 = 0.25 exactly — at both
    oneDay(db, '2026-10-03', 61, 15, { prefix: 'PC' });              // 15 of 61 = 0.246 — below share
    oneDay(db, '2026-10-05', 40, 22, { prefix: 'PD', lm: 55 });      // above both
    const cfg = S.mergeConfig({});
    expect(cfg.thresholds).toMatchObject({ plant_late_min_people: 15, plant_late_min_share: 0.25 });
    const d = S.detectPlantLateDays(db, M, Y, cfg);
    expect(d).toEqual([
      { date: '2026-10-02', weekday: 'Fri', assessed: 60, late_people: 15, share: 0.25, median_late_minutes: 52 },
      { date: '2026-10-05', weekday: 'Mon', assessed: 40, late_people: 22, share: 0.55, median_late_minutes: 55 },
    ]);
    // thresholds come from the config
    expect(S.detectPlantLateDays(db, M, Y, S.mergeConfig({ thresholds: { plant_late_min_people: 14 } })).map((x) => x.date)).toEqual(['2026-10-01', '2026-10-02', '2026-10-05']);
    expect(S.detectPlantLateDays(db, M, Y, S.mergeConfig({ thresholds: { plant_late_min_share: 0.24 } })).map((x) => x.date)).toEqual(['2026-10-02', '2026-10-03', '2026-10-05']);
  });

  test('the engine\'s own late measure: under late_min_minutes and misreads are not late; Sunday is ignored; median of the late minutes', () => {
    const db = F.newDb();
    oneDay(db, '2026-10-04', 40, 40, { prefix: 'PS' });               // Sunday, everyone late → ignored
    for (let i = 1; i <= 40; i++) F.emp(db, `PM${i}`);
    for (let i = 1; i <= 40; i++) F.day(db, `PM${i}`, '2026-10-07', i <= 15 ? { lm: 20 + i } : i <= 25 ? { lm: 9 } : i <= 30 ? { lm: 700 } : {});
    const d = S.detectPlantLateDays(db, M, Y, S.mergeConfig({}));
    expect(d).toEqual([{ date: '2026-10-07', weekday: 'Wed', assessed: 40, late_people: 15, share: 0.38, median_late_minutes: 28 }]);
  });

  test('excluded people (codes and departments) are not counted; miss-punch and night rows are not assessed', () => {
    const db = F.newDb();
    oneDay(db, DAY, 40, 15, { prefix: 'PE' });
    expect(S.detectPlantLateDays(db, M, Y, S.mergeConfig({}))).toHaveLength(1);
    // one late person left out of the review → 14 late → not a plant day
    const ex = S.mergeConfig({ standing_people: { PE1: { rule: 'exclude', reason: 'senior staff' } } });
    expect(S.detectPlantLateDays(db, M, Y, ex)).toEqual([]);
    db.prepare("UPDATE employees SET department = 'PIECE RATE CREW' WHERE code IN ('PE2')").run();
    const exd = S.mergeConfig({ standing_departments: { 'PIECE RATE CREW': { rule: 'exclude', reason: 'piece rate' } } });
    expect(S.detectPlantLateDays(db, M, Y, exd)).toEqual([]);
    // a late person on a miss-punch / night row is not assessed that day
    db.prepare("UPDATE attendance_processed SET is_miss_punch = 1 WHERE employee_code = 'PE3'").run();
    expect(S.detectPlantLateDays(db, M, Y, S.mergeConfig({}))).toEqual([]);
  });

  test('master basis: late on the current master shift; not-assessed days left out', () => {
    const db = F.newDb();
    oneDay(db, DAY, 40, 0, { prefix: 'PG' });
    db.prepare("UPDATE employees SET default_shift_id = (SELECT id FROM shifts WHERE code = '12HR')").run();
    // the import says nobody is late; 16 people punched in 08:50 against a 08:00 master
    db.prepare("UPDATE attendance_processed SET in_time_final = '08:50' WHERE employee_code IN (SELECT 'PG' || value FROM json_each('[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16]'))").run();
    expect(S.detectPlantLateDays(db, M, Y, S.mergeConfig({}))).toEqual([]);                      // import basis
    const d = S.detectPlantLateDays(db, M, Y, S.mergeConfig({ assessment_basis: 'master' }));
    expect(d).toEqual([{ date: DAY, weekday: 'Tue', assessed: 40, late_people: 16, share: 0.4, median_late_minutes: 50 }]);
    // a person without a master is not assessed → 15 of 39
    db.prepare("UPDATE employees SET default_shift_id = NULL WHERE code = 'PG1'").run();
    expect(S.detectPlantLateDays(db, M, Y, S.mergeConfig({ assessment_basis: 'master' }))[0]).toMatchObject({ assessed: 39, late_people: 15 });
  });
});

/**
 * PL1: 8 lates of 30 min on the first 8 weekdays of October (a late regular, on the action list) — one of them on DAY —
 * plus one early exit on DAY; September 3 lates (1, 2, 3 Sep). PO1..PO39: at work every weekday, 19 of them late on DAY only.
 */
function seedReview(db) {
  F.emp(db, 'PL1');
  F.month(db, 'PL1', 2026, 9, 20, (i) => (i < 3 ? { lm: 25 } : {}));
  F.month(db, 'PL1', 2026, 10, 20, (i, iso) => ({ ...(i < 8 ? { lm: 30 } : {}), ...(iso === DAY ? { em: 40 } : {}) }));
  for (let i = 1; i <= 39; i++) {
    const c = `PO${i}`; F.emp(db, c);
    F.month(db, c, 2026, 9, 20);
    F.month(db, c, 2026, 10, 20, (k, iso) => (iso === DAY && i <= 19 ? { lm: 45 } : {}));
  }
}

describe('engine with ticked days', () => {
  let db;
  beforeAll(() => { db = F.newDb(); seedReview(db); });

  test('detected, unticked by default: result says so and nothing is excused', () => {
    const r = review(db);
    expect(r.plantLateDays.detected).toEqual([{ date: DAY, weekday: 'Tue', assessed: 40, late_people: 20, share: 0.5, median_late_minutes: 45 }]);
    expect(r.plantLateDays).toMatchObject({ ticked: [], prev_ticked: [], lates_excused: 0 });
    expect(r.criteria.late_free_days).toEqual([]);
    expect(r.waterfall.lates.plant_late_days).toBe(0);
    expect(r.actionList.map((a) => a.code)).toEqual(['PL1']);
  });

  test('no param = explicit [] (byte-identical result)', () => {
    const a = JSON.stringify(review(db));
    const b = JSON.stringify(review(db, { lateFreeDays: [], prevLateFreeDays: [] }));
    expect(b).toBe(a);
  });

  test('a ticked day excuses that day\'s lates for everyone — early exits on it still count', () => {
    const before = review(db); const after = review(db, { lateFreeDays: [DAY] });
    expect(person(before, 'PL1')).toMatchObject({ late_days: 8, early_days: 1 });
    expect(person(after, 'PL1')).toMatchObject({ late_days: 7, early_days: 1 });
    expect(person(after, 'PO1').late_days).toBe(0);
    expect(after.plantLateDays).toMatchObject({ ticked: [DAY], lates_excused: 20 });
    expect(after.criteria.late_free_days).toEqual([DAY]);
    // action list follows: 7 lates is below the regular count of 8
    expect(after.actionList.map((a) => a.code)).toEqual([]);
    // trend + weekly: 20 fewer lates in October, early unchanged
    expect(before.trend.monthly['2026-10'].All.late_days - after.trend.monthly['2026-10'].All.late_days).toBe(20);
    expect(after.trend.monthly['2026-10'].All.early_exits).toBe(before.trend.monthly['2026-10'].All.early_exits);
    const wk = (r) => r.trend.weekly.filter((w) => w.week_start === '2026-10-05').reduce((s, w) => s + w.late_days, 0);
    expect(wk(before) - wk(after)).toBe(20);
    // the notice list follows too
    expect(before.noticeLate.map((x) => x.code)).toContain('PL1');
  });

  test('waterfall identity: measured − stayed late − full hours − loaders − plant-wide late days = counted', () => {
    for (const r of [review(db), review(db, { lateFreeDays: [DAY] })]) {
      const l = r.waterfall.lates;
      expect(l.measured - l.stayed_late - l.full_hours - l.loaders - l.plant_late_days).toBe(l.counted);
    }
    const w = review(db, { lateFreeDays: [DAY] }).waterfall.lates;
    expect(w).toMatchObject({ measured: 27, plant_late_days: 20, counted: 7, stayed_late: 0 });
  });

  test('a ticked day that is also a release day: both its lates and its early exits are left out', () => {
    const r = review(db, { lateFreeDays: [DAY], releaseDays: [DAY] });
    expect(person(r, 'PL1')).toMatchObject({ late_days: 7, early_days: 0 });
  });

  test('last month\'s ticks change the previous-month comparison only', () => {
    const r = review(db, { prevLateFreeDays: ['2026-09-02'] });
    expect(r.actionList.find((a) => a.code === 'PL1').last_month).toMatchObject({ late_days: 2 });
    expect(review(db).actionList.find((a) => a.code === 'PL1').last_month).toMatchObject({ late_days: 3 });
    expect(person(r, 'PL1').late_days).toBe(8);
    expect(r.plantLateDays.prev_ticked).toEqual(['2026-09-02']);
  });

  test('re-measured people and D-6 long lates: a ticked day excuses them too', () => {
    const rm = { remeasure: { PL1: { start: '08:00', end: '20:00' } } };
    expect(person(review(db, { config: rm }), 'PL1').late_days).toBe(8);
    const r = review(db, { config: rm, lateFreeDays: [DAY] });
    expect(person(r, 'PL1').late_days).toBe(7);
    const l = r.waterfall.lates;
    expect(l.measured - l.stayed_late - l.full_hours - l.loaders - l.plant_late_days).toBe(l.counted);
    const long = { late_long_always_counted: true, thresholds: { long_late_minutes: 40 } };
    expect(review(db, { config: long }).longLates.map((x) => x.code)).toContain('PO1');
    expect(review(db, { config: long, lateFreeDays: [DAY] }).longLates.map((x) => x.code)).not.toContain('PO1');
  });

  test('exports: Excel Summary lists the ticked days; Word pack says so', async () => {
    const r = review(db, { lateFreeDays: [DAY] });
    const wb = XLSX.read(X.buildWorkbook(r, { status: 'draft', generated_by: 'adm' }), { type: 'buffer' });
    const rows = XLSX.utils.sheet_to_json(wb.Sheets.Summary, { header: 1 });
    expect(rows.find((x) => x[0] === 'Plant-wide late days ticked (lates not counted)')[1]).toBe(DAY);
    expect(rows.find((x) => x[0] === 'Late arrivals not counted on those days')[1]).toBe(20);
    const buf = await X.buildDocx(r, { status: 'draft' });
    expect(buf.length).toBeGreaterThan(1000);
    // an older stored result (no plantLateDays) builds as before, without the new rows
    const old = review(db); delete old.plantLateDays;
    const ow = XLSX.read(X.buildWorkbook(old, { status: 'draft' }), { type: 'buffer' });
    expect(XLSX.utils.sheet_to_json(ow.Sheets.Summary, { header: 1 }).some((x) => x[0] === 'Plant-wide late days ticked (lates not counted)')).toBe(false);
  });

  test('config validation of the two thresholds', () => {
    expect(S.validateConfig({ thresholds: { plant_late_min_people: 15, plant_late_min_share: 0.25 } })).toEqual([]);
    expect(S.validateConfig({ thresholds: { plant_late_min_people: 0 } })).toContain('plant_late_min_people must be a whole number of at least 1');
    expect(S.validateConfig({ thresholds: { plant_late_min_people: 2.5 } })).toContain('plant_late_min_people must be a whole number of at least 1');
    expect(S.validateConfig({ thresholds: { plant_late_min_share: 0 } })).toContain('plant_late_min_share must be a share above 0 and at most 1 (e.g. 0.25)');
    expect(S.validateConfig({ thresholds: { plant_late_min_share: 1.5 } })).toContain('plant_late_min_share must be a share above 0 and at most 1 (e.g. 0.25)');
    expect(S.validateConfig({ thresholds: { plant_late_min_share: '0.3' } }).length).toBeGreaterThan(0);
  });
});

describe('API', () => {
  const BASE = '/api/analytics/attendance-review';
  let api; let db;
  beforeAll(() => { api = startJwtApi({ [BASE]: '../../routes/attendanceReview' }, { users: [{ username: 'adm', role: 'admin' }] }); db = api.db; seedReview(db); });
  afterAll(() => api.close());
  const get = (q) => api.request('GET', `${BASE}${q}`, { as: 'adm' });
  const post = (u, body) => api.request('POST', `${BASE}${u}`, { as: 'adm', body });

  test('preview: lateFreeDays validated (dates in the month) and applied', async () => {
    expect((await get(`/?month=${M}&year=${Y}&lateFreeDays=2026-09-30`)).status).toBe(400);
    expect((await get(`/?month=${M}&year=${Y}&lateFreeDays=6-10-2026`)).status).toBe(400);
    const bad = await get(`/?month=${M}&year=${Y}&lateFreeDays=2026-10-06,x`);
    expect(bad.status).toBe(400); expect(bad.body.error).toMatch(/plant-wide late day/);
    const none = (await get(`/?month=${M}&year=${Y}`)).body.data;
    expect(none.plantLateDays).toMatchObject({ ticked: [], lates_excused: 0 });
    expect(none.plantLateDays.detected.map((d) => d.date)).toEqual([DAY]);
    const r = (await get(`/?month=${M}&year=${Y}&lateFreeDays=${DAY}`)).body.data;
    expect(r.plantLateDays).toMatchObject({ ticked: [DAY], lates_excused: 20 });
    expect(r.criteria.late_free_days).toEqual([DAY]);
  });

  test('POST /runs saves the tick; omitted on regenerate keeps it; explicit [] clears; bad → 400', async () => {
    expect((await post('/runs', { month: M, year: Y, lateFreeDays: ['2026-11-02'] })).status).toBe(400);
    const c = await post('/runs', { month: M, year: Y, releaseDays: [], lateFreeDays: [DAY] });
    expect(c.status).toBe(201);
    expect(c.body.data.late_free_days).toEqual([DAY]);
    expect(c.body.data.result.plantLateDays.ticked).toEqual([DAY]);
    expect(db.prepare('SELECT late_free_days FROM attendance_review_runs WHERE id = ?').get(c.body.data.id).late_free_days).toBe(JSON.stringify([DAY]));
    const audit = db.prepare("SELECT remark FROM audit_log WHERE table_name = 'attendance_review_runs' AND stage = 'ATTENDANCE_REVIEW_RUN' ORDER BY id DESC LIMIT 1").get();
    expect(audit.remark).toMatch(/plant-wide late days \["2026-10-06"\]/);
    const keep = await post('/runs', { month: M, year: Y });
    expect(keep.status).toBe(200); expect(keep.body.data.late_free_days).toEqual([DAY]);
    expect(keep.body.data.result.actionList).toEqual([]);
    const list = (await get('/runs')).body.data;
    expect(list.find((x) => x.month === M).late_free_days).toEqual([DAY]);
    const clear = await post('/runs', { month: M, year: Y, lateFreeDays: [] });
    expect(clear.body.data.late_free_days).toEqual([]);
    expect(clear.body.data.result.actionList.map((a) => a.code)).toEqual(['PL1']);
  });

  test('next month reads this month\'s saved ticks as the previous month\'s', async () => {
    await post('/runs', { month: M, year: Y, lateFreeDays: [DAY] });
    F.emp(db, 'PN1'); F.month(db, 'PN1', 2026, 11, 5);
    const nov = (await get('/?month=11&year=2026')).body.data;
    expect(nov.plantLateDays.prev_ticked).toEqual([DAY]);
    expect(nov.trend.monthly['2026-10'].All.late_days).toBe(7);
  });

  test('a finalised run never changes', async () => {
    const id = db.prepare('SELECT id FROM attendance_review_runs WHERE month = ? AND year = ?').get(M, Y).id;
    const fin = await api.request('PUT', `${BASE}/runs/${id}/finalise`, { as: 'adm', body: { acknowledge: 'checked by the admin in test' } });
    expect(fin.status).toBe(200);
    expect(fin.body.data.late_free_days).toEqual([DAY]);
    const before = db.prepare('SELECT * FROM attendance_review_runs WHERE id = ?').get(id);
    expect((await post('/runs', { month: M, year: Y, lateFreeDays: [] })).status).toBe(409);
    expect(db.prepare('SELECT * FROM attendance_review_runs WHERE id = ?').get(id)).toEqual(before);
    const stored = (await get(`/runs/${id}`)).body.data;
    expect(stored.late_free_days).toEqual([DAY]); expect(stored.result.plantLateDays.ticked).toEqual([DAY]);
  });

  test('rules editor save keeps the two thresholds; bad values refused', async () => {
    const cfg = (await get(`/config?month=${M}&year=${Y}`)).body.data.config;
    expect(cfg.thresholds).toMatchObject({ plant_late_min_people: 15, plant_late_min_share: 0.25 });
    // the editor rebuilds config from its form: thresholds are carried whole
    const body = { thresholds: { ...cfg.thresholds, plant_late_min_people: 21, plant_late_min_share: 0.3 }, stayed_late_mode: cfg.stayed_late_mode,
      early_exit_rule: cfg.early_exit_rule, standing_people: {}, standing_departments: {} };
    expect((await api.request('PUT', `${BASE}/config`, { as: 'adm', body: { effective_from: '2026-11', config: { ...body, thresholds: { ...body.thresholds, plant_late_min_share: 2 } } } })).status).toBe(400);
    expect((await api.request('PUT', `${BASE}/config`, { as: 'adm', body: { effective_from: '2026-11', config: body } })).status).toBe(200);
    const after = (await get('/config?month=11&year=2026')).body.data.config;
    expect(after.thresholds).toMatchObject({ plant_late_min_people: 21, plant_late_min_share: 0.3 });
    expect(S.detectPlantLateDays(db, M, Y, S.mergeConfig(after))).toEqual([]);              // 20 late < 21
  });
});
