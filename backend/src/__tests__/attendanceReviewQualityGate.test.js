/**
 * Attendance Review PR-4 — data-quality check before Finalise (real JWT auth, real initSchema, synthetic codes QG…).
 * stop  rules_changed (no acknowledgement possible) · check month_not_over, data_ends_early, shift_doubt, miss_punch_open
 * (a reason of 10+ characters, recorded in audit_log) · note (shown only).
 */
const { startJwtApi } = require('./helpers/jwtApiHarness');
const F = require('./helpers/attendanceReviewFixture');
const S = require('../services/attendanceReviewService');

const BASE = '/api/analytics/attendance-review';
const USERS = [{ username: 'adm', role: 'admin' }, { username: 'hr1', role: 'hr' }];
const AFTER = new Date('2026-11-05T06:00:00Z'); // after both months below
let api; let db; let clock;

const gen = (month, body = {}) => api.request('POST', `${BASE}/runs`, { as: 'adm', body: { month, year: 2026, ...body } });
const quality = (id) => api.request('GET', `${BASE}/runs/${id}/quality`, { as: 'adm' });
const finalise = (id, acknowledge) => api.request('PUT', `${BASE}/runs/${id}/finalise`, { as: 'adm', body: acknowledge === undefined ? {} : { acknowledge } });
const keys = (g) => g.items.map((i) => `${i.level}:${i.key}`).sort();
const allDays = (y, m) => F.weekdays(y, m);

beforeAll(() => {
  api = startJwtApi({ [BASE]: '../../routes/attendanceReview' }, { users: USERS });
  db = api.db;
  clock = jest.spyOn(S, 'nowDate').mockReturnValue(AFTER);
  // ── August (clean month): QGOK late 6 times of 30 min → a ½ day; data to the last weekday (31 Aug, a Monday)
  F.emp(db, 'QGOK');
  F.month(db, 'QGOK', 2026, 7, 20);
  allDays(2026, 8).forEach((d, i) => F.day(db, 'QGOK', d, i < 6 ? { lm: 30 } : {}));
  // ── September: data to 30 Sep
  //   QGLATE  late every day (wrong-master pattern)       → shift_doubt
  //   QGNIGHT night work on the 12HR day master, leaves 90 min early on 18 nights (11 h worked) → shift_doubt (night)
  //   QGMP    an open (unfixed) miss punch on a normal day → miss_punch_open
  //   QGMIX   ordinary deduction (late on 8 of 24 days)    → no check
  for (const c of ['QGLATE', 'QGNIGHT', 'QGMP', 'QGMIX']) { F.emp(db, c); F.month(db, c, 2026, 8, 20); }
  const sep = allDays(2026, 9);
  sep.forEach((d) => F.day(db, 'QGLATE', d, { lm: 40 }));
  sep.forEach((d, i) => F.day(db, 'QGNIGHT', d, { night: 1, sd: 'Night Shift', it: '19:30', ot: i < 18 ? '06:30' : '08:00', em: i < 18 ? 90 : 0 }));
  sep.forEach((d, i) => F.day(db, 'QGMP', d, i === 4 ? { mp: 1 } : {}));
  sep.forEach((d, i) => F.day(db, 'QGMIX', d, i < 8 ? { lm: 35 } : {}));
  db.prepare("UPDATE employees SET default_shift_id = (SELECT id FROM shifts WHERE code = '12HR') WHERE code = 'QGNIGHT'").run();
});
afterAll(() => { clock.mockRestore(); api.close(); });

test('hr cannot read the check (403)', async () => {
  const id = (await gen(8)).body.data.id;
  expect((await api.request('GET', `${BASE}/runs/${id}/quality`, { as: 'hr1' })).status).toBe(403);
});

test('a clean, complete, ended month: nothing to check; finalise needs no reason', async () => {
  const id = (await gen(8)).body.data.id;
  const q = await quality(id);
  expect(q.status).toBe(200);
  expect(q.body.data).toMatchObject({ ok: true, stops: [], checks: [], status: 'draft', reason_min: 10, acknowledged: null });
  const f = await finalise(id);
  expect(f.status).toBe(200); expect(f.body.data.status).toBe('final');
  expect(db.prepare("SELECT COUNT(*) n FROM audit_log WHERE stage = 'ATTENDANCE_REVIEW_GATE'").get().n).toBe(0);
});

test('September: shift doubts and an open miss punch are checks; no reason / short reason refused; reason recorded', async () => {
  const c = await gen(9);
  const id = c.body.data.id;
  const listed = c.body.data.result.actionList.filter((a) => a.action === 'deduction').map((a) => a.code).sort();
  expect(listed).toEqual(expect.arrayContaining(['QGLATE', 'QGMIX', 'QGNIGHT']));
  const q = (await quality(id)).body.data;
  expect(q.ok).toBe(false);
  expect(q.stops).toEqual([]);
  expect(q.checks.map((x) => x.key).sort()).toEqual(['miss_punch_open', 'shift_doubt']);
  const doubt = q.checks.find((x) => x.key === 'shift_doubt');
  expect(doubt.people.map((p) => p.code).sort()).toEqual(['QGLATE', 'QGNIGHT']);           // QGMIX is not a shift question
  expect(doubt.people.find((p) => p.code === 'QGLATE').why.join(' ')).toMatch(/late on 26 of 26 days worked on no master/);
  expect(doubt.people.find((p) => p.code === 'QGNIGHT').why.join(' ')).toMatch(/works nights \(26 of 26 days, punches about 19:30–06:30\) on a day master 12-Hour Shift \(08:00–20:00\)/);
  const mp = q.checks.find((x) => x.key === 'miss_punch_open');
  expect(mp.people).toEqual([{ code: 'QGMP', days: 1, listed: false }]);

  const none = await finalise(id);
  expect(none.status).toBe(409); expect(none.body.code).toBe('QUALITY_GATE');
  expect(none.body.error).toMatch(/Give a reason of at least 10 characters/);
  expect((await finalise(id, '   short  ')).status).toBe(409);                               // 5 characters after trimming
  expect(db.prepare('SELECT status FROM attendance_review_runs WHERE id = ?').get(id).status).toBe('draft');

  const ok = await finalise(id, '  Night master fixed for October; Sept stands as reviewed  ');
  expect(ok.status).toBe(200); expect(ok.body.data.status).toBe('final');
  const a = db.prepare("SELECT new_value, remark, changed_by, action_type FROM audit_log WHERE stage = 'ATTENDANCE_REVIEW_GATE' AND record_id = ?").get(id);
  expect(a).toMatchObject({ remark: 'Night master fixed for October; Sept stands as reviewed', changed_by: 'adm', action_type: 'acknowledge' });
  expect(JSON.parse(a.new_value).map((x) => x.key)).toEqual(['shift_doubt', 'miss_punch_open']);
  expect(JSON.parse(a.new_value)[0].people.sort()).toEqual(['QGLATE', 'QGNIGHT']);
  const fin = db.prepare("SELECT remark FROM audit_log WHERE stage = 'ATTENDANCE_REVIEW_RUN' AND record_id = ? ORDER BY id DESC LIMIT 1").get(id);
  expect(fin.remark).toMatch(/past 2 check\(s\): shift_doubt, miss_punch_open/);
  const after = (await quality(id)).body.data;
  expect(after.status).toBe('final');
  expect(after.acknowledged).toMatchObject({ reason: 'Night master fixed for October; Sept stands as reviewed', by: 'adm' });
});

test('an overnight master clears the night doubt; a fixed miss punch clears that check', async () => {
  // October (fresh): only QGNIGHT, now on an overnight 19:00–07:00 master, and QGMP with its miss punch fixed
  const oct = allDays(2026, 10);
  db.prepare(`INSERT INTO shifts (name, code, start_time, end_time, grace_minutes, duration_hours) VALUES ('Night 19-07', 'QGN1907', '19:00', '07:00', 9, 12)`).run();
  db.prepare("UPDATE employees SET default_shift_id = (SELECT id FROM shifts WHERE code = 'QGN1907') WHERE code = 'QGNIGHT'").run();
  oct.forEach((d, i) => F.day(db, 'QGNIGHT', d, { night: 1, sd: 'Night Shift', it: '19:30', ot: i < 18 ? '06:30' : '08:00', em: i < 18 ? 90 : 0 }));
  oct.forEach((d, i) => F.day(db, 'QGMP', d, i === 4 ? { mp: 1 } : {}));
  db.prepare("UPDATE attendance_processed SET miss_punch_resolved = 1 WHERE employee_code = 'QGMP' AND is_miss_punch = 1 AND date LIKE '2026-10-%'").run();
  const id = (await gen(10)).body.data.id;
  const q = (await quality(id)).body.data;
  const doubt = q.checks.find((x) => x.key === 'shift_doubt');
  const night = doubt && doubt.people.find((p) => p.code === 'QGNIGHT');
  expect(night).toBeDefined();                                     // still early on most nights → still a shift question
  expect(night.why.join(' ')).not.toMatch(/works nights/);          // but no longer "night work on a day master"
  expect(night.why.join(' ')).toMatch(/left early on 18 of 27 days worked on Night 19-07 \(19:00–07:00\)/);
  expect(q.checks.map((x) => x.key)).not.toContain('miss_punch_open');
});

test('rules changed after the draft is a stop: refused even with a reason; regenerating clears it', async () => {
  const id = (await gen(10)).body.data.id;
  expect((await quality(id)).body.data.stops).toEqual([]);
  const put = await api.request('PUT', `${BASE}/config`, { as: 'adm', body: { effective_from: '2026-10', config: { thresholds: { act_workdays: 1.2 } } } });
  expect(put.status).toBe(200);
  const q = (await quality(id)).body.data;
  expect(q.stops.map((s) => s.key)).toEqual(['rules_changed']);
  expect(q.stops[0].detail).toMatch(/Regenerate the draft/);
  const f = await finalise(id, 'I really want to finalise this now');
  expect(f.status).toBe(409); expect(f.body.gate.stops[0].key).toBe('rules_changed');
  await gen(10);
  expect((await quality(id)).body.data.stops).toEqual([]);
});

test('month not over and attendance ending early are checks', async () => {
  // November: data only to 13 Nov; clock on 20 Nov (month not over) then on 5 Dec (over, data ends early)
  F.emp(db, 'QGNOV'); F.month(db, 'QGNOV', 2026, 10, 20);
  allDays(2026, 11).filter((d) => d <= '2026-11-13').forEach((d) => F.day(db, 'QGNOV', d, {}));
  clock.mockReturnValue(new Date('2026-11-20T06:00:00Z'));
  const id = (await gen(11)).body.data.id;
  let q = (await quality(id)).body.data;
  expect(keys(q)).toEqual(expect.arrayContaining(['check:data_ends_early', 'check:month_not_over']));
  expect(q.checks.find((c) => c.key === 'month_not_over').detail).toMatch(/Today is 20-11-2026; 2026-11 runs to 30-11-2026/);
  expect(q.checks.find((c) => c.key === 'data_ends_early').detail).toMatch(/only up to 13-11-2026/);
  clock.mockReturnValue(new Date('2026-12-05T06:00:00Z'));
  q = (await quality(id)).body.data;
  expect(q.checks.map((c) => c.key)).not.toContain('month_not_over');
  expect(q.checks.map((c) => c.key)).toContain('data_ends_early');
  clock.mockReturnValue(AFTER);
});

test('engine: an older draft without newer thresholds still checks; unknown run 404', async () => {
  const run = { month: 9, year: 2026, result_json: JSON.stringify({ actionList: [] }), config_snapshot: JSON.stringify({ thresholds: {} }) };
  const g = S.qualityGate(db, run, { now: AFTER });
  expect(g.stops.map((s) => s.key)).toEqual(['rules_changed']);
  expect((await quality(9999)).status).toBe(404);
  expect((await finalise(9999, 'whatever reason here')).status).toBe(404);
});
