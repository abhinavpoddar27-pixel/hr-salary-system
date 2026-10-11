/**
 * Attendance Review — Trends (T1): GET /api/analytics/attendance-review/trends?from&to.
 * One row per month: from the FINAL run, else the DRAFT, else a live computation (labelled), months without attendance left
 * out; plus the people on the action list in two or more months. Read only. Synthetic codes (TR…), Aug–Oct 2026.
 */
const F = require('./helpers/attendanceReviewFixture');
const S = require('../services/attendanceReviewService');
const { startJwtApi } = require('./helpers/jwtApiHarness');

const BASE = '/api/analytics/attendance-review';
const late = (db, code, mon, n) => F.month(db, code, 2026, mon, 22, (i) => (i < n ? { lm: 45 } : {}));

describe('trendRow / repeaters (pure)', () => {
  test('an older stored result with missing fields reads as zeros, not an error', () => {
    const r = S.trendRow({ actionList: [{ code: 'X1', action: 'deduction', deduction_days: 1 }] }, { month: 5, year: 2026, source: 'final', run_id: 3 });
    expect(r).toMatchObject({ ym: '2026-05', source: 'final', run_id: 3, basis: 'import', people_assessed: 0,
      all: { late_pct: 0, early_pct: 0, time_lost_pct: 0 }, action: { people: 1, deductions: 0 }, departments: [] });
    expect(r.action_people[0]).toMatchObject({ code: 'X1', deduction_days: 1, workdays_lost: 0 });
  });
  test('monthRange crosses a year end', () => {
    expect(S.monthRange({ month: 11, year: 2025 }, { month: 2, year: 2026 }).map((m) => `${m.year}-${m.month}`))
      .toEqual(['2025-11', '2025-12', '2026-1', '2026-2']);
  });
  test('repeaters: two or more months only, most months first', () => {
    const row = (ym, codes) => ({ ym, action_people: codes.map((c) => ({ code: c, name: c, department: 'D', action: 'deduction', deduction_days: 1, workdays_lost: 1.2 })) });
    const r = S.repeaters([row('2026-08', ['A', 'B']), row('2026-09', ['A', 'B', 'C']), row('2026-10', ['A'])]);
    expect(r.map((p) => [p.code, p.months.length, p.deduction_days, p.workdays_lost])).toEqual([['A', 3, 3, 3.6], ['B', 2, 2, 2.4]]);
  });
});

describe('API: GET /trends', () => {
  let api; let db;
  beforeAll(() => {
    api = startJwtApi({ [BASE]: '../../routes/attendanceReview' }, { users: [{ username: 'adm', role: 'admin' }, { username: 'hr1', role: 'hr' }] });
    db = api.db;
    F.emp(db, 'TR1'); F.emp(db, 'TR2'); F.emp(db, 'TR3');
    for (const m of [8, 9, 10]) { late(db, 'TR1', m, 12); late(db, 'TR2', m, m === 10 ? 12 : 0); late(db, 'TR3', m, 0); }
  });
  afterAll(() => api.close());
  const get = async (q, as = 'adm') => api.request('GET', `${BASE}/trends?${q}`, { as });

  test('admin only; bad ranges refused', async () => {
    expect((await get('from=2026-08&to=2026-10', 'hr1')).status).toBe(403);
    expect((await get('from=2026-8&to=2026-10')).status).toBe(400);
    expect((await get('to=2026-10')).status).toBe(400);
    expect((await get('from=2026-10&to=2026-08')).status).toBe(400);
    const tooMany = await get('from=2025-01&to=2026-01');
    expect(tooMany.status).toBe(400); expect(tooMany.body.error).toMatch(/12 months/);
  });

  test('live months match the month preview; a month with no attendance is skipped', async () => {
    const r = (await get('from=2026-07&to=2026-10')).body.data;
    expect(r.months.map((m) => [m.ym, m.source])).toEqual([['2026-08', 'live'], ['2026-09', 'live'], ['2026-10', 'live']]);
    expect(r.skipped).toEqual([{ ym: '2026-07', reason: 'no attendance' }]);
    const oct = r.months[2];
    const prev = (await api.request('GET', `${BASE}?month=10&year=2026`, { as: 'adm' })).body.data;
    expect(oct.all).toMatchObject({ late_days: prev.trend.monthly['2026-10'].All.late_days, late_pct: prev.trend.monthly['2026-10'].All.late_pct });
    expect(oct.action.people).toBe(prev.actionTotals.people);
    expect(oct.action_people.map((a) => a.code).sort()).toEqual(['TR1', 'TR2']);
    expect(r.months[0].action_people.map((a) => a.code)).toEqual(['TR1']);
  });

  test('repeat names: TR1 on the list three months running, TR2 once (not listed)', async () => {
    const r = (await get('from=2026-08&to=2026-10')).body.data;
    expect(r.repeaters.map((p) => [p.code, p.months.map((m) => m.ym)])).toEqual([['TR1', ['2026-08', '2026-09', '2026-10']]]);
  });

  test('a stored run wins over live: final shows its stored figures and run id; live=0 leaves the rest out', async () => {
    const gen = await api.request('POST', `${BASE}/runs`, { as: 'adm', body: { month: 9, year: 2026, releaseDays: [], overrides: [] } });
    expect([200, 201]).toContain(gen.status);
    const id = gen.body.data.id;
    const fin = await api.request('PUT', `${BASE}/runs/${id}/finalise`, { as: 'adm', body: { acknowledge: 'Synthetic test month, checks reviewed' } });
    expect(fin.status).toBe(200);
    const stored = JSON.parse(db.prepare('SELECT result_json FROM attendance_review_runs WHERE id = ?').get(id).result_json);
    // make the stored figure distinguishable from a recomputation
    stored.actionTotals.indicative_amount = 4242;
    db.prepare('UPDATE attendance_review_runs SET result_json = ? WHERE id = ?').run(JSON.stringify(stored), id);
    const runsBefore = db.prepare('SELECT COUNT(*) n FROM attendance_review_runs').get().n;
    const r = (await get('from=2026-08&to=2026-10')).body.data;
    const sep = r.months.find((m) => m.ym === '2026-09');
    expect(sep).toMatchObject({ source: 'final', run_id: id, action: { indicative_amount: 4242 } });
    const only = (await get('from=2026-08&to=2026-10&live=0')).body.data;
    expect(only.months.map((m) => m.ym)).toEqual(['2026-09']);
    expect(only.skipped).toEqual([{ ym: '2026-08', reason: 'no review run' }, { ym: '2026-10', reason: 'no review run' }]);
    expect(db.prepare('SELECT COUNT(*) n FROM attendance_review_runs').get().n).toBe(runsBefore);
  });
});
