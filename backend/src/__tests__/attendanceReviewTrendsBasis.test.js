/**
 * Attendance Review — Trends T5 (plan G3 + G4): 18-month range, the rules version behind each month, and the what-if
 * basis switch (basis=master|import computes every month live on that basis; stored runs ignored). Read only.
 * Synthetic codes TB…, Sep–Oct 2026.
 *
 * TB1: master shift 07:30–16:30 (T5X); punches 07:30–16:30. The import measured it on the 12-hour shift → early exit of
 *      3 h 30 m on 10 days in October. Import basis: 10 early exits; master basis: none.
 */
const http = require('http');
const XLSX = require('xlsx');
const F = require('./helpers/attendanceReviewFixture');
const S = require('../services/attendanceReviewService');
const { startJwtApi } = require('./helpers/jwtApiHarness');

const BASE = '/api/analytics/attendance-review';

function seed(db) {
  db.prepare("INSERT INTO shifts (name, code, start_time, end_time, duration_hours) VALUES ('T5 short', 'T5X', '07:30', '16:30', 9)").run();
  F.emp(db, 'TB1'); F.emp(db, 'TB2');
  db.prepare("UPDATE employees SET default_shift_id = (SELECT id FROM shifts WHERE code = 'T5X') WHERE code = 'TB1'").run();
  db.prepare("UPDATE employees SET default_shift_id = (SELECT id FROM shifts WHERE code = '12HR') WHERE code = 'TB2'").run();
  F.month(db, 'TB1', 2026, 9, 22, () => ({ it: '07:30', ot: '16:30' }));
  F.month(db, 'TB2', 2026, 9, 22);
  F.month(db, 'TB1', 2026, 10, 22, (i) => (i < 10 ? { it: '07:30', ot: '16:30', em: 210 } : { it: '07:30', ot: '16:30' }));
  F.month(db, 'TB2', 2026, 10, 22);
}
const saveConfig = (db, ef, cfg) => db.prepare('INSERT INTO attendance_review_config (effective_from, config_json, updated_by) VALUES (?, ?, ?)')
  .run(ef, JSON.stringify(cfg), 'adm').lastInsertRowid;
const download = (api, path) => new Promise((resolve, reject) => {
  const req = http.request({ host: '127.0.0.1', port: api.server.address().port, path, headers: { Authorization: `Bearer ${api.tokens.adm}` } }, (res) => {
    const chunks = []; res.on('data', (c) => chunks.push(c)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
  }); req.on('error', reject); req.end();
});

describe('trendRow carries the rules version (pure)', () => {
  test('rules passed through; absent → null', () => {
    expect(S.trendRow({}, { month: 10, year: 2026, source: 'live', rules: { version: 7, effective_from: '2026-09', from: 'live' } }).rules)
      .toEqual({ version: 7, effective_from: '2026-09', from: 'live' });
    expect(S.trendRow({}, { month: 10, year: 2026, source: 'final' }).rules).toBeNull();
  });
});

// one server + database for the file (the harness keeps one DB per process); each block starts with no runs / no rules
let api; let db;
beforeAll(() => { api = startJwtApi({ [BASE]: '../../routes/attendanceReview' }, { users: [{ username: 'adm', role: 'admin' }] }); db = api.db; seed(db); });
afterAll(() => api.close());
const reset = () => { db.prepare('DELETE FROM attendance_review_runs').run(); db.prepare('DELETE FROM attendance_review_config').run(); };

describe('API: range of 18 months', () => {
  beforeAll(reset);

  test('/trends: 18 months accepted (empty months skipped), 19 refused', async () => {
    const ok = await api.request('GET', `${BASE}/trends?from=2025-05&to=2026-10`, { as: 'adm' });
    expect(ok.status).toBe(200);
    expect(ok.body.data.months.map((m) => m.ym)).toEqual(['2026-09', '2026-10']);
    expect(ok.body.data.skipped).toHaveLength(16);
    expect(ok.body.data.skipped.every((s) => s.reason === 'no attendance')).toBe(true);
    const bad = await api.request('GET', `${BASE}/trends?from=2025-04&to=2026-10`, { as: 'adm' });
    expect(bad.status).toBe(400); expect(bad.body.error).toMatch(/18 months/);
  });

  test('/trends/export.xlsx: 19 months refused; /person/:code 18 ok, 19 refused', async () => {
    expect((await api.request('GET', `${BASE}/trends/export.xlsx?from=2025-04&to=2026-10`, { as: 'adm' })).status).toBe(400);
    const p = await api.request('GET', `${BASE}/person/TB1?from=2025-05&to=2026-10`, { as: 'adm' });
    expect(p.status).toBe(200);
    const p19 = await api.request('GET', `${BASE}/person/TB1?from=2025-04&to=2026-10`, { as: 'adm' });
    expect(p19.status).toBe(400); expect(p19.body.error).toMatch(/18 months/);
  });
});

describe('API: rules version per month', () => {
  let v1; let v2;
  beforeAll(() => {
    reset();
    v1 = saveConfig(db, '2026-09', { thresholds: { notice_late: 5 } });
    v2 = saveConfig(db, '2026-10', { thresholds: { notice_late: 6 } });
  });

  test('live months: the version in force for each month', async () => {
    const r = (await api.request('GET', `${BASE}/trends?from=2026-08&to=2026-10`, { as: 'adm' })).body.data;
    expect(r.months.map((m) => [m.ym, m.source, m.rules])).toEqual([
      ['2026-09', 'live', { version: v1, effective_from: '2026-09', from: 'live' }],
      ['2026-10', 'live', { version: v2, effective_from: '2026-10', from: 'live' }]]);
    expect(r.what_if).toBeNull();
    expect(r.months.every((m) => m.what_if === undefined)).toBe(true);
  });

  test('stored run: version from result.configSource', async () => {
    const gen = await api.request('POST', `${BASE}/runs`, { as: 'adm', body: { month: 10, year: 2026, releaseDays: [], overrides: [] } });
    expect([200, 201]).toContain(gen.status);
    const r = (await api.request('GET', `${BASE}/trends?from=2026-09&to=2026-10`, { as: 'adm' })).body.data;
    expect(r.months[1]).toMatchObject({ ym: '2026-10', source: 'draft', run_id: gen.body.data.id, rules: { version: v2, effective_from: '2026-10', from: 'run' } });
  });

  test('older run without configSource: matched by its config snapshot; unmatched snapshot → null', async () => {
    const id = db.prepare('SELECT id FROM attendance_review_runs WHERE month = 10 AND year = 2026').get().id;
    const res = JSON.parse(db.prepare('SELECT result_json FROM attendance_review_runs WHERE id = ?').get(id).result_json);
    delete res.configSource;
    // snapshot = the September version's merged config (as an old run stored it), stored in a different key order
    const snap = S.mergeConfig({ thresholds: { notice_late: 5 } });
    const reordered = Object.fromEntries(Object.entries(snap).reverse());
    db.prepare('UPDATE attendance_review_runs SET result_json = ?, config_snapshot = ? WHERE id = ?').run(JSON.stringify(res), JSON.stringify(reordered), id);
    let r = (await api.request('GET', `${BASE}/trends?from=2026-10&to=2026-10`, { as: 'adm' })).body.data;
    expect(r.months[0].rules).toEqual({ version: v1, effective_from: '2026-09', from: 'snapshot' });
    // a snapshot no saved version matches → unknown
    db.prepare('UPDATE attendance_review_runs SET config_snapshot = ? WHERE id = ?').run(JSON.stringify(S.mergeConfig({ thresholds: { notice_late: 99 } })), id);
    r = (await api.request('GET', `${BASE}/trends?from=2026-10&to=2026-10`, { as: 'adm' })).body.data;
    expect(r.months[0].rules).toBeNull();
    // the built-in defaults → version null, not unknown
    db.prepare('UPDATE attendance_review_runs SET config_snapshot = ? WHERE id = ?').run(JSON.stringify(S.mergeConfig({})), id);
    r = (await api.request('GET', `${BASE}/trends?from=2026-10&to=2026-10`, { as: 'adm' })).body.data;
    expect(r.months[0].rules).toEqual({ version: null, effective_from: null, from: 'snapshot' });
    // a broken snapshot never fails the request
    db.prepare("UPDATE attendance_review_runs SET config_snapshot = 'not json' WHERE id = ?").run(id);
    const bad = await api.request('GET', `${BASE}/trends?from=2026-10&to=2026-10`, { as: 'adm' });
    expect(bad.status).toBe(200); expect(bad.body.data.months[0].rules).toBeNull();
  });

  test('export: the Months sheet carries the rules version', async () => {
    const r = await download(api, `${BASE}/trends/export.xlsx?from=2026-09&to=2026-10`);
    expect(r.status).toBe(200);
    const rows = XLSX.utils.sheet_to_json(XLSX.read(r.body, { type: 'buffer' }).Sheets.Months);
    expect(rows.map((x) => [x.Month, x['Rules version']])).toEqual([['2026-09', `v${v1} (from 2026-09)`], ['2026-10', 'unknown']]);
  });
});

describe('API: basis switch (what-if)', () => {
  let runId;
  beforeAll(async () => {
    reset();
    saveConfig(db, '2026-09', { assessment_basis: 'import' });
    const gen = await api.request('POST', `${BASE}/runs`, { as: 'adm', body: { month: 10, year: 2026, releaseDays: [], overrides: [] } });
    runId = gen.body.data.id;
    // make the stored October distinguishable from any recomputation
    const res = JSON.parse(db.prepare('SELECT result_json FROM attendance_review_runs WHERE id = ?').get(runId).result_json);
    res.actionTotals.indicative_amount = 4242;
    db.prepare('UPDATE attendance_review_runs SET result_json = ? WHERE id = ?').run(JSON.stringify(res), runId);
  });
  const get = async (q) => api.request('GET', `${BASE}/trends?${q}`, { as: 'adm' });

  test('no basis: the stored run wins (today\'s behaviour), not what-if', async () => {
    const r = (await get('from=2026-09&to=2026-10')).body.data;
    expect(r.what_if).toBeNull();
    expect(r.months[1]).toMatchObject({ source: 'draft', run_id: runId, basis: 'import', action: { indicative_amount: 4242 } });
    expect((await get('from=2026-09&to=2026-10&basis=')).body.data.months[1].source).toBe('draft');
  });

  test('basis=import / master: every month live on that basis, what_if, stored run ignored; numbers = the engine on that basis', async () => {
    const imp = (await get('from=2026-09&to=2026-10&basis=import')).body.data;
    const mas = (await get('from=2026-09&to=2026-10&basis=master')).body.data;
    expect(imp.what_if).toEqual({ basis: 'import' }); expect(mas.what_if).toEqual({ basis: 'master' });
    for (const r of [imp, mas]) {
      expect(r.months.map((m) => [m.ym, m.source, m.what_if, m.run_id])).toEqual([['2026-09', 'live', true, null], ['2026-10', 'live', true, null]]);
      expect(r.months[1].action.indicative_amount).not.toBe(4242);
    }
    expect(imp.months.map((m) => m.basis)).toEqual(['import', 'import']);
    expect(mas.months.map((m) => m.basis)).toEqual(['master', 'master']);
    // the import shift flagged TB1 early on 10 October days; the master shift (07:30–16:30) finds none
    expect(imp.months[1].all.early_exits).toBe(10);
    expect(mas.months[1].all.early_exits).toBe(0);
    const eng = (b) => S.computeAttendanceReview(db, { month: 10, year: 2026, config: { assessment_basis: b }, releaseDays: [], prevReleaseDays: [] }).trend.monthly['2026-10'].All;
    expect(imp.months[1].all.early_pct).toBe(eng('import').early_pct);
    expect(mas.months[1].all.early_pct).toBe(eng('master').early_pct);
    // the rules version is still the one in force (the basis is the only thing forced)
    expect(mas.months[1].rules).toMatchObject({ from: 'live', effective_from: '2026-09' });
  });

  test('invalid basis → 400 (trends and export); nothing written', async () => {
    const before = db.prepare('SELECT COUNT(*) n FROM attendance_review_runs').get().n;
    const bad = await get('from=2026-09&to=2026-10&basis=payroll');
    expect(bad.status).toBe(400); expect(bad.body.error).toMatch(/basis must be master or import/);
    expect((await api.request('GET', `${BASE}/trends/export.xlsx?from=2026-09&to=2026-10&basis=MASTER`, { as: 'adm' })).status).toBe(400);
    expect(db.prepare('SELECT COUNT(*) n FROM attendance_review_runs').get().n).toBe(before);
  });

  test('export with basis: what-if figures, file name and audit remark say so', async () => {
    const r = await download(api, `${BASE}/trends/export.xlsx?from=2026-09&to=2026-10&basis=master`);
    expect(r.status).toBe(200);
    expect(r.headers['content-disposition']).toBe('attachment; filename="Attendance_Trends_2026-09_to_2026-10_what-if-master.xlsx"');
    const rows = XLSX.utils.sheet_to_json(XLSX.read(r.body, { type: 'buffer' }).Sheets.Months);
    expect(rows.map((x) => [x.From, x.Basis])).toEqual([['what-if (live)', 'master'], ['what-if (live)', 'master']]);
    expect(rows[1]['Early counted']).toBe(0);
    expect(db.prepare("SELECT COUNT(*) n FROM audit_log WHERE stage = 'ATTENDANCE_REVIEW_EXPORT' AND remark LIKE '%what-if master basis'").get().n).toBe(1);
  });
});
