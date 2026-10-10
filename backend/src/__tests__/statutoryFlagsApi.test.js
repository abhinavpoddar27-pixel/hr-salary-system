/**
 * Statutory flags PR-1 — /api/statutory-flags through the REAL requireAuth
 * (jwtApiHarness: real JWTs, temp DATA_DIR, real initSchema). Synthetic data.
 */
const http = require('http');
const { startJwtApi } = require('./helpers/jwtApiHarness');
const S = require('./helpers/statutoryFixture');

const USERS = [
  { username: 'boss', role: 'admin' },
  { username: 'hr1', role: 'hr' },
  { username: 'fin1', role: 'finance' },
  { username: 'view1', role: 'viewer' },
];

let api; let db;
beforeAll(() => {
  api = startJwtApi({ '/api/statutory-flags': '../../routes/statutoryFlags' }, { users: USERS });
  db = api.db;
});
afterAll(() => api.close());

/** multipart/form-data POST with one file + text fields. */
function postFile(url, { as, fields = {}, file = null, fileName = 'flags.xlsx' } = {}) {
  const boundary = `----statutory${Date.now()}`;
  const parts = [];
  for (const [k, v] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  }
  if (file) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: application/octet-stream\r\n\r\n`));
    parts.push(file);
    parts.push(Buffer.from('\r\n'));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  const body = Buffer.concat(parts);
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port: api.server.address().port, method: 'POST', path: url,
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': body.length,
        ...(as ? { Authorization: `Bearer ${api.tokens[as]}` } : {}),
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        let json = null; try { json = JSON.parse(buf.toString('utf8')); } catch { /* binary */ }
        resolve({ status: res.statusCode, body: json, raw: buf, headers: res.headers });
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function getRaw(url, as) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: api.server.address().port, path: url,
      headers: as ? { Authorization: `Bearer ${api.tokens[as]}` } : {} }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        let json = null; try { json = JSON.parse(buf.toString('utf8')); } catch { /* binary */ }
        resolve({ status: res.statusCode, body: json, raw: buf, headers: res.headers });
      });
    }).on('error', reject);
  });
}

let emp;
let file;
beforeAll(() => {
  emp = S.plant(db, { code: 'API1' });
  S.plantStructure(db, emp, '2025-01-01');
  file = S.plantFile(S.prow('API1', 1, 0, 1), S.prow('NOPE', 1, 0, 1));
});

describe('role guard on every endpoint', () => {
  test('no token → 401 on all four', async () => {
    expect((await postFile('/api/statutory-flags/preview', {})).status).toBe(401);
    expect((await postFile('/api/statutory-flags/apply', {})).status).toBe(401);
    expect((await api.request('GET', '/api/statutory-flags/batches')).status).toBe(401);
    expect((await api.request('GET', '/api/statutory-flags/batches/1/undo-file')).status).toBe(401);
  });

  for (const who of ['hr1', 'fin1', 'view1']) {
    test(`${who} → 403 on all four; nothing written`, async () => {
      const before = S.counts(db);
      const f = { scope: 'plant', effectiveMonth: '2026-09' };
      expect((await postFile('/api/statutory-flags/preview', { as: who, fields: f, file })).status).toBe(403);
      expect((await postFile('/api/statutory-flags/apply', { as: who, fields: { ...f, expectedSha256: 'x' }, file })).status).toBe(403);
      expect((await api.request('GET', '/api/statutory-flags/batches', { as: who })).status).toBe(403);
      expect((await api.request('GET', '/api/statutory-flags/batches/1/undo-file', { as: who })).status).toBe(403);
      expect(S.counts(db)).toEqual(before);
    });
  }
});

describe('admin flow', () => {
  let sha;
  let batchId;

  test('preview → 200 with plan, sha256, canApply; writes nothing', async () => {
    const before = S.counts(db);
    const r = await postFile('/api/statutory-flags/preview', { as: 'boss', fields: { scope: 'plant', effectiveMonth: '2026-09' }, file });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ success: true, canApply: true, scope: 'plant', effectiveMonth: '2026-09' });
    expect(r.body.totals).toMatchObject({ rows: 2, matched: 1, unmatched: 1, changed: 1 });
    expect(r.body.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(S.counts(db)).toEqual(before);
    sha = r.body.sha256;
  });

  test('apply without expectedSha256 → 400; with a different hash → 409', async () => {
    const f = { scope: 'plant', effectiveMonth: '2026-09' };
    expect((await postFile('/api/statutory-flags/apply', { as: 'boss', fields: f, file })).status).toBe(400);
    const r = await postFile('/api/statutory-flags/apply', { as: 'boss', fields: { ...f, expectedSha256: '0'.repeat(64) }, file });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('HASH_MISMATCH');
  });

  test('apply → 200 and batch applied; the same file again → 409 duplicate', async () => {
    const f = { scope: 'plant', effectiveMonth: '2026-09', expectedSha256: sha };
    const r = await postFile('/api/statutory-flags/apply', { as: 'boss', fields: f, file });
    expect(r.status).toBe(200);
    expect(r.body.summary.counts.employees).toBe(1);
    batchId = r.body.batchId;
    expect(S.flags(S.master(db, emp))).toEqual({ pf: 0, esi: 1, lwf: 1 });
    const again = await postFile('/api/statutory-flags/apply', { as: 'boss', fields: f, file });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('DUPLICATE_BATCH');
    const pv = await postFile('/api/statutory-flags/preview', { as: 'boss', fields: { scope: 'plant', effectiveMonth: '2026-09' }, file });
    expect(pv.body).toMatchObject({ canApply: false, alreadyAppliedBatchId: batchId });
  });

  test('batches list (no-store) and undo file download', async () => {
    const b = await api.request('GET', '/api/statutory-flags/batches', { as: 'boss' });
    expect(b.status).toBe(200);
    expect(b.body.batches[0]).toMatchObject({ id: batchId, status: 'applied', applied_by: 'boss' });
    const u = await getRaw(`/api/statutory-flags/batches/${batchId}/undo-file`, 'boss');
    expect(u.status).toBe(200);
    expect(u.headers['content-type']).toMatch(/spreadsheetml/);
    expect(u.headers['cache-control']).toBe('no-store');
    expect(u.headers['content-disposition']).toMatch(/statutory_flags_undo_plant_2026-09/);
    const SF = require('../services/statutoryFlags');
    expect(SF.parseFlagFile(u.raw, 'plant').rows[0]).toMatchObject({ code: 'API1', esi: 0, pf: 0, lwf: 0 });
    expect((await getRaw('/api/statutory-flags/batches/99999/undo-file', 'boss')).status).toBe(404);
  });
});

describe('upload validation', () => {
  test('.txt → 400', async () => {
    const r = await postFile('/api/statutory-flags/preview', { as: 'boss', fields: { scope: 'plant', effectiveMonth: '2026-09' }, file, fileName: 'flags.txt' });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/xlsx, \.xls or \.csv/);
  });

  test('> 2 MB → 400', async () => {
    const big = Buffer.alloc(2 * 1024 * 1024 + 10, 65);
    const r = await postFile('/api/statutory-flags/preview', { as: 'boss', fields: { scope: 'plant', effectiveMonth: '2026-09' }, file: big, fileName: 'big.csv' });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/2 MB/);
  });

  test('no file / bad scope / bad month / missing column → 400', async () => {
    const f = { scope: 'plant', effectiveMonth: '2026-09' };
    expect((await postFile('/api/statutory-flags/preview', { as: 'boss', fields: f })).status).toBe(400);
    expect((await postFile('/api/statutory-flags/preview', { as: 'boss', fields: { ...f, scope: 'x' }, file })).status).toBe(400);
    expect((await postFile('/api/statutory-flags/preview', { as: 'boss', fields: { ...f, effectiveMonth: '2026-9' }, file })).status).toBe(400);
    const r = await postFile('/api/statutory-flags/preview', { as: 'boss', fields: f, file: S.xlsxBuf([['code', 'esi_applicable'], ['API1', 'Y']]) });
    expect(r.status).toBe(400);
    expect(r.body.errors[0]).toMatch(/Missing column/);
  });

  test('blocking plan → apply 400 BLOCKED, nothing written', async () => {
    const bad = S.plant(db, { code: 'API2' });
    S.plantStructure(db, bad, '2026/09/01');
    const f2 = S.plantFile(S.prow('API2', 1, 0, 1));
    const pv = await postFile('/api/statutory-flags/preview', { as: 'boss', fields: { scope: 'plant', effectiveMonth: '2026-09' }, file: f2 });
    expect(pv.body.canApply).toBe(false);
    const before = S.counts(db);
    const r = await postFile('/api/statutory-flags/apply', { as: 'boss', fields: { scope: 'plant', effectiveMonth: '2026-09', expectedSha256: pv.body.sha256 }, file: f2 });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('BLOCKED');
    expect(S.counts(db)).toEqual(before);
  });
});
