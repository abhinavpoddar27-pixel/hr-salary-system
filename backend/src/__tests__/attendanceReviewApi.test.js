/**
 * Attendance Review API — /api/analytics/attendance-review (real JWT auth, real initSchema, synthetic codes).
 * Admin only on every route; preview writes nothing; config versions are audited; draft → final lifecycle.
 */
const { startJwtApi } = require('./helpers/jwtApiHarness');
const F = require('./helpers/attendanceReviewFixture');

const BASE = '/api/analytics/attendance-review';
const USERS = [{ username: 'adm', role: 'admin' }, { username: 'hr1', role: 'hr' }, { username: 'fin', role: 'finance' }, { username: 'vw', role: 'viewer' }];
let api; let db;

beforeAll(() => {
  api = startJwtApi({ [BASE]: '../../routes/attendanceReview' }, { users: USERS });
  db = api.db;
  F.emp(db, 'API1'); F.month(db, 'API1', 2026, 9, 22, (i) => ({ lm: i < 10 ? 30 : 0 }));
  F.month(db, 'API1', 2026, 10, 22, (i) => ({ lm: i < 12 ? 45 : 0 }));
  F.emp(db, 'API2'); F.month(db, 'API2', 2026, 10, 20, (i) => ({ em: i < 4 ? 30 : 0 }));
});
afterAll(() => api.close());

const ROUTES = [['GET', `${BASE}?month=10&year=2026`], ['GET', `${BASE}/config`], ['PUT', `${BASE}/config`], ['POST', `${BASE}/runs`],
  ['GET', `${BASE}/runs`], ['GET', `${BASE}/runs/1`], ['PUT', `${BASE}/runs/1/finalise`]];

test('every route refuses hr, finance and viewer (403) and anonymous (401)', async () => {
  for (const [m, url] of ROUTES) {
    for (const as of ['hr1', 'fin', 'vw']) expect((await api.request(m, url, { as, body: m === 'GET' ? null : {} })).status).toBe(403);
    expect((await api.request(m, url)).status).toBe(401);
  }
});

test('preview computes and saves nothing', async () => {
  const count = () => db.prepare('SELECT (SELECT COUNT(*) FROM attendance_review_runs) + (SELECT COUNT(*) FROM attendance_review_config) + (SELECT COUNT(*) FROM audit_log) n').get().n;
  const before = count();
  const r = await api.request('GET', `${BASE}?month=10&year=2026`, { as: 'adm' });
  expect(r.status).toBe(200);
  expect(r.body.data.actionList.map((a) => a.code)).toEqual(['API1']);
  expect(r.body.data.earlyExitWarnings.map((a) => a.code)).toEqual(['API2']);
  expect(count()).toBe(before);
  const ov = encodeURIComponent(JSON.stringify([{ code: 'API1', action: 'warning', reason: 'confirm first' }]));
  const withOv = await api.request('GET', `${BASE}?month=10&year=2026&overrides=${ov}`, { as: 'adm' });
  expect(withOv.body.data.actionList[0]).toMatchObject({ code: 'API1', action: 'warning', override: { reason: 'confirm first' } });
  expect((await api.request('GET', `${BASE}?month=10&year=2026&overrides=nope`, { as: 'adm' })).status).toBe(400);
  const badOv = encodeURIComponent(JSON.stringify([{ code: 'API1', action: 'drop', reason: 'x' }]));
  expect((await api.request('GET', `${BASE}?month=10&year=2026&overrides=${badOv}`, { as: 'adm' })).status).toBe(400);
  expect(count()).toBe(before);
  expect((await api.request('GET', `${BASE}?month=13&year=2026`, { as: 'adm' })).status).toBe(400);
  expect((await api.request('GET', `${BASE}?month=10&year=2026&releaseDays=2026-09-03`, { as: 'adm' })).status).toBe(400);
});

test('config PUT validates, stores a version and writes one audit row; the run uses it', async () => {
  const bad = await api.request('PUT', `${BASE}/config`, { as: 'adm', body: { effective_from: '2026-10', config: { exclude: [] } } });
  expect(bad.status).toBe(400); expect(bad.body.details[0]).toMatch(/unknown key/);
  expect((await api.request('PUT', `${BASE}/config`, { as: 'adm', body: { effective_from: '2026-1', config: {} } })).status).toBe(400);
  const audits = () => db.prepare("SELECT COUNT(*) n FROM audit_log WHERE stage = 'ATTENDANCE_REVIEW_CONFIG'").get().n;
  const a0 = audits();
  const ok = await api.request('PUT', `${BASE}/config`, { as: 'adm', body: { effective_from: '2026-10', config: { excluded_codes: ['API2'] } } });
  expect(ok.status).toBe(200); expect(audits()).toBe(a0 + 1);
  const cfg = await api.request('GET', `${BASE}/config?month=10&year=2026`, { as: 'adm' });
  expect(cfg.body.data.config.excluded_codes).toEqual(['API2']);
  expect(cfg.body.data.config.thresholds.act_workdays).toBe(0.9);
  const sepCfg = await api.request('GET', `${BASE}/config?month=9&year=2026`, { as: 'adm' });
  expect(sepCfg.body.data.config.excluded_codes).toEqual([]);              // effective from Oct only
  const prev = await api.request('GET', `${BASE}?month=10&year=2026`, { as: 'adm' });
  expect(prev.body.data.earlyExitWarnings).toEqual([]);
});

test('runs: create draft, regenerate, finalise, then locked', async () => {
  const badOv = await api.request('POST', `${BASE}/runs`, { as: 'adm', body: { month: 10, year: 2026, overrides: [{ code: 'API1', action: 'exclude', reason: 'no' }] } });
  expect(badOv.status).toBe(400);
  const c = await api.request('POST', `${BASE}/runs`, { as: 'adm', body: { month: 10, year: 2026, releaseDays: ['2026-10-07'] } });
  expect(c.status).toBe(201); expect(c.body.data.status).toBe('draft'); expect(c.body.data.release_days).toEqual(['2026-10-07']);
  const id = c.body.data.id;
  const g = await api.request('POST', `${BASE}/runs`, { as: 'adm', body: { month: 10, year: 2026, overrides: [{ code: 'API1', action: 'warning', reason: 'confirm shift first' }] } });
  expect(g.status).toBe(200); expect(g.body.data.id).toBe(id);
  expect(g.body.data.release_days).toEqual(['2026-10-07']);                // omitted → kept
  expect(g.body.data.overrides).toHaveLength(1);
  expect(g.body.data.result.actionList[0]).toMatchObject({ code: 'API1', action: 'warning' });
  const cleared = await api.request('POST', `${BASE}/runs`, { as: 'adm', body: { month: 10, year: 2026, releaseDays: [] } });
  expect(cleared.body.data.release_days).toEqual([]);                        // explicit [] clears
  await api.request('POST', `${BASE}/runs`, { as: 'adm', body: { month: 10, year: 2026, releaseDays: ['2026-10-07'] } });
  const one = await api.request('GET', `${BASE}/runs/${id}`, { as: 'adm' });
  expect(one.body.data.result.actionList[0].override.reason).toBe('confirm shift first');
  expect(one.body.data.config_snapshot.excluded_codes).toEqual(['API2']);
  expect((await api.request('GET', `${BASE}/runs`, { as: 'adm' })).body.data).toHaveLength(1);
  const f = await api.request('PUT', `${BASE}/runs/${id}/finalise`, { as: 'adm' });
  expect(f.status).toBe(200); expect(f.body.data).toMatchObject({ status: 'final', finalised_by: 'adm' });
  expect((await api.request('PUT', `${BASE}/runs/${id}/finalise`, { as: 'adm' })).status).toBe(409);
  expect((await api.request('POST', `${BASE}/runs`, { as: 'adm', body: { month: 10, year: 2026 } })).status).toBe(409);
  expect((await api.request('GET', `${BASE}/runs/999`, { as: 'adm' })).status).toBe(404);
  const runAudits = db.prepare("SELECT remark FROM audit_log WHERE stage = 'ATTENDANCE_REVIEW_RUN' ORDER BY id").all().map((r) => r.remark);
  expect(runAudits).toHaveLength(5); expect(runAudits[4]).toMatch(/finalised/);
});

test("next month uses last month's confirmed release days", async () => {
  F.month(db, 'API1', 2026, 11, 20, (i) => ({ lm: i < 12 ? 45 : 0 }));
  const r = await api.request('GET', `${BASE}?month=11&year=2026`, { as: 'adm' });
  expect(r.body.data.meta.prev_release_days).toEqual(['2026-10-07']);
});
