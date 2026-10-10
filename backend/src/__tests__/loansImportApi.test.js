/**
 * Loans PR-10 — import API over real HTTP with real JWTs (routes/loanImport.js).
 * Role matrix (SPEC §7 last row), multipart upload, the mapping step, company
 * restriction, cutover check JSON + xlsx, and that /api/loans still answers.
 */
const http = require('http');
const XLSX = require('xlsx');
const { startJwtApi } = require('./helpers/jwtApiHarness');

const AL = 'Asian Lakto Ind Ltd';
const USERS = [
  { username: 'hr1', role: 'hr' }, { username: 'fin1', role: 'finance' }, { username: 'boss', role: 'admin' },
  { username: 'view1', role: 'viewer' }, { username: 'hrind', role: 'hr', allowedCompanies: 'Indriyan Beverages Pvt Ltd' },
];
let api;
let db;

beforeAll(() => {
  api = startJwtApi({ '/api/loans/import': '../../routes/loanImport', '/api/loans': '../../routes/loans' }, { users: USERS });
  db = api.db;
  for (const [code, name] of [['A001', 'RAVI KUMAR'], ['A002', 'BALA DEVI']]) {
    db.prepare(`INSERT INTO employees (code, name, department, company, employment_type, status, date_of_joining, is_contractor, weekly_off_day, gross_salary)
                VALUES (?, ?, 'PRODUCTION', ?, 'Permanent', 'Active', '2024-01-01', 0, 0, 20000)`).run(code, name, AL);
  }
});
afterAll(() => api.close());

const book = (aoa) => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Sheet1');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
};

/** multipart/form-data POST with a file field and text fields. */
function postFile(url, { as, file, fileName = 'accounts.xlsx', fields = {} }) {
  const boundary = `----loanimport${Date.now()}`;
  const parts = [];
  for (const [k, v] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  }
  if (file) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: application/octet-stream\r\n\r\n`));
    parts.push(file, Buffer.from('\r\n'));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  const body = Buffer.concat(parts);
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port: api.server.address().port, method: 'POST', path: url,
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': body.length, Authorization: `Bearer ${api.tokens[as]}` },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch { /* not json */ }
        resolve({ status: res.statusCode, body: json, headers: res.headers, raw: Buffer.concat(chunks) });
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

const FILE = book([['Emp Name', 'Firm', 'Balance', 'EMI'], ['Ravi Kumar', 'Asian Lakto', '10,000', '2,500'], ['Bala Devi', 'Asian', 3000, 1000]]);
let batchId;

describe('upload and mapping', () => {
  test('template download (hr / finance / admin; viewer 403)', async () => {
    const r = await api.request('GET', '/api/loans/import/template', { as: 'boss' });
    expect(r.status).toBe(200);
    expect((await api.request('GET', '/api/loans/import/template', { as: 'view1' })).status).toBe(403);
  });
  test('parse: automatic mapping + preview, nothing written', async () => {
    const r = await postFile('/api/loans/import/parse', { as: 'hr1', file: FILE });
    expect(r.status).toBe(200);
    expect(r.body.data.mapping).toEqual({ name: 0, company: 1, outstanding: 2, emi: 3 });
    expect(r.body.data.preview[0]).toMatchObject({ name: 'Ravi Kumar', outstanding: 10000, emi: 2500 });
    expect(db.prepare('SELECT COUNT(*) n FROM loan_import_batches').get().n).toBe(0);
  });
  test('an unmapped required field returns the headers for the mapping step; a custom mapping fixes it', async () => {
    const odd = book([['Who', 'Owes', 'Cut'], ['Ravi Kumar', 500, 100]]);
    const r = await postFile('/api/loans/import/parse', { as: 'hr1', file: odd });
    expect(r.status).toBe(400);
    expect(r.body).toMatchObject({ code: 'MAPPING_INVALID', headers: [{ index: 0, text: 'Who' }, { index: 1, text: 'Owes' }, { index: 2, text: 'Cut' }] });
    const ok = await postFile('/api/loans/import/parse', { as: 'hr1', file: odd, fields: { mapping: JSON.stringify({ name: 0, outstanding: 1, emi: 2 }), defaultCompany: AL } });
    expect(ok.status).toBe(200);
    expect(ok.body.data.preview[0]).toMatchObject({ company: AL, outstanding: 500 });
  });
  test('roles: admin 403 ADMIN_CANNOT_UPLOAD, viewer 403; non-xlsx 400; hr 201; same file 409', async () => {
    expect((await postFile('/api/loans/import/batches', { as: 'boss', file: FILE })).body.code).toBe('ADMIN_CANNOT_UPLOAD');
    expect((await postFile('/api/loans/import/batches', { as: 'view1', file: FILE })).status).toBe(403);
    expect((await postFile('/api/loans/import/batches', { as: 'hr1', file: Buffer.from('x'), fileName: 'a.csv' })).status).toBe(400);
    const r = await postFile('/api/loans/import/batches', { as: 'hr1', file: FILE });
    expect(r.status).toBe(201);
    batchId = r.body.data.batchId;
    const again = await postFile('/api/loans/import/batches', { as: 'fin1', file: FILE });
    expect(again.status).toBe(409);
    expect(again.body).toMatchObject({ code: 'IMPORT_FILE_ALREADY_UPLOADED', batchId });
    expect(db.prepare("SELECT COUNT(*) n FROM notifications WHERE type = 'LOAN_IMPORT_UPLOADED'").get().n).toBe(2);
  });
  test('a company-restricted user cannot see an other-company batch', async () => {
    expect((await api.request('GET', `/api/loans/import/batches/${batchId}`, { as: 'hrind' })).status).toBe(403);
    const list = await api.request('GET', '/api/loans/import/batches', { as: 'hrind' });
    expect(list.body.data.batches).toEqual([]);
  });
});

describe('confirm, approve, cutover check', () => {
  test('match: hr only; balance: finance only; approve: admin only', async () => {
    const d = (await api.request('GET', `/api/loans/import/batches/${batchId}`, { as: 'view1' })).body.data;
    const [r1, r2] = d.rows;
    const match = (row, as) => api.request('POST', `/api/loans/import/batches/${batchId}/rows/${row.id}/match`, { as, body: { borrowerType: 'plant', employeeCode: row.employee_code } });
    expect((await match(r1, 'fin1')).status).toBe(403);
    expect((await match(r1, 'boss')).status).toBe(403);
    expect((await match(r1, 'hr1')).status).toBe(200);
    expect((await match(r2, 'hr1')).status).toBe(200);
    const bal = (row, as, body = {}) => api.request('POST', `/api/loans/import/batches/${batchId}/rows/${row.id}/balance`, { as, body });
    expect((await bal(r1, 'hr1')).status).toBe(403);
    expect((await bal(r1, 'fin1', { outstanding: 9000 })).body.code).toBe('NOTE_REQUIRED');
    expect((await bal(r1, 'fin1')).status).toBe(200);
    expect((await api.request('POST', `/api/loans/import/batches/${batchId}/approve`, { as: 'boss', body: { cutoverMonth: 11, cutoverYear: 2026 } })).body.code).toBe('ROWS_NOT_DECIDED');
    expect((await bal(r2, 'fin1')).status).toBe(200);
    expect(db.prepare("SELECT COUNT(*) n FROM notifications WHERE type = 'LOAN_IMPORT_READY'").get().n).toBe(1);
    expect((await api.request('POST', `/api/loans/import/batches/${batchId}/approve`, { as: 'fin1', body: { cutoverMonth: 11, cutoverYear: 2026 } })).status).toBe(403);
    const a = await api.request('POST', `/api/loans/import/batches/${batchId}/approve`, { as: 'boss', body: { cutoverMonth: 11, cutoverYear: 2026, note: 'cutover' } });
    expect(a.status).toBe(201);
    expect(a.body.data.loans).toHaveLength(2);
    expect((await api.request('POST', `/api/loans/import/batches/${batchId}/approve`, { as: 'boss', body: { cutoverMonth: 11, cutoverYear: 2026 } })).status).toBe(409);
  });
  test('imported loans show on /api/loans with the import mode; loan detail reconciles', async () => {
    const list = await api.request('GET', '/api/loans', { as: 'view1' });
    expect(list.status).toBe(200);
    expect(list.body.data.map((l) => l.disbursement_mode)).toEqual(['Opening balance (import)', 'Opening balance (import)']);
    const one = await api.request('GET', `/api/loans/${list.body.data[0].id}`, { as: 'view1' });
    expect(one.body.data.reconciliation.ok).toBe(true);
  });
  test('cutover check JSON and xlsx; viewer may read', async () => {
    const c = await api.request('GET', `/api/loans/import/batches/${batchId}/cutover-check`, { as: 'view1' });
    expect(c.status).toBe(200);
    expect(c.body.data.rows.every((r) => r.flags.includes('STAGE7_PENDING'))).toBe(true);
    const x = await api.request('GET', `/api/loans/import/batches/${batchId}/cutover-check?format=xlsx`, { as: 'fin1' });
    expect(x.status).toBe(200);
    expect(x.text.slice(0, 2)).toBe('PK'); // a zip (xlsx); the harness decodes bodies as text, so no deeper parse here
  });
  test('discard: uploader or admin only, review state only', async () => {
    const f = book([['Name', 'Company', 'Outstanding', 'EMI'], ['Bala Devi', 'Asian', 700, 100]]);
    const r = await postFile('/api/loans/import/batches', { as: 'fin1', file: f });
    const id = r.body.data.batchId;
    expect((await api.request('POST', `/api/loans/import/batches/${id}/discard`, { as: 'hr1', body: { reason: 'wrong' } })).status).toBe(403);
    expect((await api.request('POST', `/api/loans/import/batches/${id}/discard`, { as: 'boss', body: { reason: 'wrong sheet' } })).status).toBe(200);
    expect((await api.request('POST', `/api/loans/import/batches/${batchId}/discard`, { as: 'boss', body: { reason: 'too late' } })).status).toBe(409);
  });
});
