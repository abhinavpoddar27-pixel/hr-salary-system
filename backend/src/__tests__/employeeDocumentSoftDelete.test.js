/**
 * G3: employee document delete is a soft delete with an audit trail.
 * Real requireAuth + real JWTs (jwtApiHarness). DOCS_DIR is a temp dir so
 * uploaded files are real files on disk.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const DOCS = fs.mkdtempSync(path.join(os.tmpdir(), 'g3-docs-'));
process.env.DOCS_DIR = DOCS;

const { startJwtApi } = require('./helpers/jwtApiHarness');

let api; let db;

beforeAll(() => {
  api = startJwtApi({ '/api/employees': '../../routes/employees' }, {
    users: [
      { username: 'hr1', role: 'hr' },
      { username: 'adm1', role: 'admin' },
      { username: 'fin1', role: 'finance' },
      { username: 'view1', role: 'viewer' },
    ],
  });
  db = api.db;
  db.prepare(`INSERT INTO employees (code, name, status, company) VALUES ('T9551','TEST DOC EMP','Active','Test Co')`).run();
});

afterAll(async () => {
  await api.close();
  try { fs.rmSync(DOCS, { recursive: true, force: true }); } catch { /* best effort */ }
});

function upload(as, code, name = 'doc.pdf', type = 'Aadhaar') {
  const boundary = '----g3boundary';
  const parts = [
    `--${boundary}\r\nContent-Disposition: form-data; name="documentType"\r\n\r\n${type}\r\n`,
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: application/pdf\r\n\r\n`,
  ];
  const payload = Buffer.concat([
    Buffer.from(parts.join('')), Buffer.from('%PDF-1.4 g3'), Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port: api.server.address().port, method: 'POST', path: `/api/employees/${code}/documents`,
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': payload.length, Authorization: `Bearer ${api.tokens[as]}` },
    }, (res) => { const c = []; res.on('data', d => c.push(d)); res.on('end', () => { let b = null; try { b = JSON.parse(Buffer.concat(c).toString()); } catch { /* */ } resolve({ status: res.statusCode, body: b }); }); });
    req.on('error', reject); req.write(payload); req.end();
  });
}

const docAudit = (id, action) => db.prepare(
  `SELECT * FROM audit_log WHERE table_name='employee_documents' AND record_id=? AND action_type=?`).all(id, action);

test('upload writes the row, the file and one document_upload audit row', async () => {
  const r = await upload('hr1', 'T9551', 'up1.pdf');
  expect(r.status).toBe(200);
  const row = db.prepare('SELECT * FROM employee_documents WHERE id = ?').get(r.body.id);
  expect(fs.existsSync(row.file_path)).toBe(true);
  expect(row.deleted_at).toBeNull();
  const a = docAudit(r.body.id, 'document_upload');
  expect(a).toHaveLength(1);
  expect(a[0].changed_by).toBe('hr1');
  expect(a[0].employee_code).toBe('T9551');
  expect(a[0].remark).toContain('up1.pdf');
});

test('delete hides the row, keeps the file, records who and when, one audit row', async () => {
  const up = await upload('hr1', 'T9551', 'del1.pdf');
  const id = up.body.id;
  const filePath = db.prepare('SELECT file_path FROM employee_documents WHERE id = ?').get(id).file_path;
  const r = await api.request('DELETE', `/api/employees/documents/${id}`, { as: 'hr1' });
  expect(r.status).toBe(200);
  expect(r.body.message).toBe('Document removed');
  const row = db.prepare('SELECT * FROM employee_documents WHERE id = ?').get(id);
  expect(row).toBeTruthy();
  expect(row.deleted_by).toBe('hr1');
  expect(row.deleted_at).toBeTruthy();
  expect(fs.existsSync(filePath)).toBe(true);
  const a = docAudit(id, 'document_delete');
  expect(a).toHaveLength(1);
  expect(a[0]).toMatchObject({ field_name: 'deleted_at', changed_by: 'hr1', employee_code: 'T9551', stage: 'employee_documents', new_value: row.deleted_at });
  expect(a[0].remark).toContain('del1.pdf');
  expect(a[0].remark).toContain('file kept');
});

test('a removed document is gone from the list and its download is 404 for every role', async () => {
  const up = await upload('hr1', 'T9551', 'gone.pdf');
  await api.request('DELETE', `/api/employees/documents/${up.body.id}`, { as: 'adm1' });
  for (const as of ['hr1', 'adm1', 'fin1', 'view1']) {
    const list = await api.request('GET', '/api/employees/T9551/documents', { as });
    expect(list.status).toBe(200);
    expect(list.body.data.map(d => d.id)).not.toContain(up.body.id);
    const dl = await api.request('GET', `/api/employees/documents/${up.body.id}/download`, { as });
    expect(dl.status).toBe(404);
  }
  expect(db.prepare('SELECT deleted_by FROM employee_documents WHERE id = ?').get(up.body.id).deleted_by).toBe('adm1');
});

test('a live document still lists and downloads', async () => {
  const up = await upload('hr1', 'T9551', 'live.pdf');
  const list = await api.request('GET', '/api/employees/T9551/documents', { as: 'fin1' });
  expect(list.body.data.map(d => d.id)).toContain(up.body.id);
  const dl = await api.request('GET', `/api/employees/documents/${up.body.id}/download`, { as: 'hr1' });
  expect(dl.status).toBe(200);
});

test('deleting twice: second call 404, still one audit row, deleted_at unchanged', async () => {
  const up = await upload('hr1', 'T9551', 'twice.pdf');
  await api.request('DELETE', `/api/employees/documents/${up.body.id}`, { as: 'hr1' });
  const first = db.prepare('SELECT deleted_at, deleted_by FROM employee_documents WHERE id = ?').get(up.body.id);
  const r = await api.request('DELETE', `/api/employees/documents/${up.body.id}`, { as: 'adm1' });
  expect(r.status).toBe(404);
  expect(db.prepare('SELECT deleted_at, deleted_by FROM employee_documents WHERE id = ?').get(up.body.id)).toEqual(first);
  expect(docAudit(up.body.id, 'document_delete')).toHaveLength(1);
});

test('finance and viewer cannot delete; nothing changes', async () => {
  const up = await upload('hr1', 'T9551', 'guard.pdf');
  for (const as of ['fin1', 'view1']) {
    const r = await api.request('DELETE', `/api/employees/documents/${up.body.id}`, { as });
    expect(r.status).toBe(403);
  }
  expect(db.prepare('SELECT deleted_at FROM employee_documents WHERE id = ?').get(up.body.id).deleted_at).toBeNull();
  expect(docAudit(up.body.id, 'document_delete')).toHaveLength(0);
  const anon = await api.request('DELETE', `/api/employees/documents/${up.body.id}`);
  expect(anon.status).toBe(401);
});

test('unknown id → 404, no audit row', async () => {
  const before = db.prepare(`SELECT COUNT(*) n FROM audit_log WHERE table_name='employee_documents'`).get().n;
  const r = await api.request('DELETE', '/api/employees/documents/999999', { as: 'hr1' });
  expect(r.status).toBe(404);
  expect(db.prepare(`SELECT COUNT(*) n FROM audit_log WHERE table_name='employee_documents'`).get().n).toBe(before);
});

test('helper is additive and idempotent', () => {
  const { ensureEmployeeDocsSoftDelete } = require('../database/employeeDocsSchema');
  ensureEmployeeDocsSoftDelete(db); ensureEmployeeDocsSoftDelete(db);
  const cols = db.prepare('PRAGMA table_info(employee_documents)').all();
  for (const c of ['deleted_at', 'deleted_by']) {
    const col = cols.find(x => x.name === c);
    expect(col).toBeTruthy();
    expect(col.notnull).toBe(0);
    expect(col.dflt_value).toBeNull();
  }
  const idx = db.prepare(`SELECT name FROM sqlite_master WHERE type='index' AND name='idx_employee_documents_code_live'`).get();
  expect(idx).toBeTruthy();
});
