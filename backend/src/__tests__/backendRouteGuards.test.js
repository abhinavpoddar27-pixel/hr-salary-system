/**
 * P2-11 — role guards on write routes that sat behind requireAuth only.
 *
 * 35 POST/PUT/PATCH/DELETE routes were reachable by ANY logged-in role
 * (viewer, supervisor, employee-portal login included): deleting a month's
 * import, marking employees Left/Active, marking advances paid, queueing
 * salary-compute jobs, writing punch corrections, … Each now has a role guard.
 *
 * Driven over HTTP behind the REAL requireAuth with real JWTs (jwtApiHarness),
 * on a real initSchema() database. A refused call must write NOTHING: the
 * connection's total_changes() is compared before and after (the routers share
 * the harness' db handle via getDb()).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const DOCS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'p2-11-docs-'));
process.env.DOCS_DIR = DOCS_DIR;
const { startJwtApi } = require('./helpers/jwtApiHarness');

const HR = 'HR or admin access required';
const FIN = 'Finance or admin access required';
const ADMIN = 'Admin access required';
const HFA = 'HR, finance or admin access required';

// [method, url, allowed roles, refusal message, body for the allowed-role call]
const ROUTES = [
  ['POST', '/api/import/upload', ['admin', 'hr'], HR, {}],
  ['POST', '/api/import/stage/3/complete', ['admin', 'hr'], HR, { month: 9, year: 2026 }],
  ['DELETE', '/api/import/999999', ['admin'], ADMIN, null],
  ['POST', '/api/import/reconciliation/update-departments', ['admin', 'hr'], HR, { corrections: [] }],
  ['POST', '/api/import/reconciliation/add-to-master', ['admin', 'hr'], HR, { employees: [] }],
  ['POST', '/api/attendance/miss-punches/999999/resolve', ['admin', 'hr'], HR, {}],
  ['POST', '/api/attendance/miss-punches/bulk-resolve', ['admin', 'hr'], HR, {}],
  ['POST', '/api/attendance/night-shifts/999999/confirm', ['admin', 'hr'], HR, {}],
  ['POST', '/api/attendance/night-shifts/999999/reject', ['admin', 'hr'], HR, {}],
  ['PUT', '/api/attendance/record/999999', ['admin', 'hr', 'finance'], HFA, {}],
  ['PUT', '/api/attendance/record/999999/shift', ['admin', 'hr'], HR, {}],
  ['POST', '/api/attendance/recalculate-metrics', ['admin', 'hr', 'finance'], HFA, {}],
  ['POST', '/api/attendance/deduplicate', ['admin', 'hr'], HR, {}],
  ['POST', '/api/employees', ['admin', 'hr'], HR, {}],
  ['POST', '/api/employees/T9900/documents', ['admin', 'hr'], HR, {}],
  ['DELETE', '/api/employees/documents/999999', ['admin', 'hr'], HR, null],
  ['POST', '/api/employees/bulk-set-contractor', ['admin', 'hr'], HR, {}],
  ['POST', '/api/analytics/alerts/generate', ['admin', 'hr', 'finance'], HFA, { month: 9, year: 2026 }],
  ['PUT', '/api/analytics/alerts/999999/read', ['admin', 'hr', 'finance'], HFA, {}],
  ['POST', '/api/analytics/detect-inactive', ['admin', 'hr'], HR, {}],
  ['POST', '/api/analytics/auto-detect-left', ['admin', 'hr'], HR, {}],
  ['POST', '/api/analytics/reactivate-employee', ['admin', 'hr'], HR, { code: 'T9999' }],
  ['POST', '/api/analytics/employee/T9900/ai-review', ['admin', 'hr', 'finance'], HFA, { from: '2026-09-30', to: '2026-01-01' }],
  ['PUT', '/api/settings/holidays/audit-log/999999/review', ['admin', 'finance'], FIN, {}],
  ['POST', '/api/advance/calculate', ['admin', 'hr'], HR, {}],
  ['PUT', '/api/advance/999999/mark-paid', ['admin', 'hr'], HR, {}],
  ['PUT', '/api/advance/batch-mark-paid', ['admin', 'hr'], HR, {}],
  ['PUT', '/api/advance/999999/set-remark', ['admin', 'hr'], HR, {}],
  ['PUT', '/api/advance/batch-remark', ['admin', 'hr'], HR, {}],
  ['POST', '/api/lifecycle', ['admin', 'hr'], HR, {}],
  ['POST', '/api/finance-audit/day-correction', ['admin', 'hr', 'finance'], HFA, {}],
  ['POST', '/api/finance-audit/punch-correction', ['admin', 'hr', 'finance'], HFA, {}],
  ['PUT', '/api/finance-audit/manual-flags/999999/verify', ['admin', 'finance'], FIN, {}],
  ['POST', '/api/jobs', ['admin'], ADMIN, {}],
  ['PUT', '/api/tax-declarations/T9900', ['admin', 'hr', 'finance'], HFA, { financial_year: '2026-27' }],
];

// username → canonical role
const USERS = {
  boss: 'admin', hr1: 'hr', fin1: 'finance', view1: 'viewer', sup1: 'supervisor', emp1: 'employee', blank: 'viewer',
};
const AS = { admin: 'boss', hr: 'hr1', finance: 'fin1' };

let api; let db;
beforeAll(() => {
  api = startJwtApi({
    '/api/import': '../../routes/import',
    '/api/attendance': '../../routes/attendance',
    '/api/employees': '../../routes/employees',
    '/api/analytics': '../../routes/analytics',
    '/api/settings': '../../routes/settings',
    '/api/advance': '../../routes/advance',
    '/api/lifecycle': '../../routes/lifecycle',
    '/api/finance-audit': '../../routes/financeAudit',
    '/api/jobs': '../../routes/jobs',
    '/api/tax-declarations': '../../routes/taxDeclarations',
  }, {
    users: [
      { username: 'boss', role: 'admin' },
      { username: 'hr1', role: 'hr' },
      { username: 'fin1', role: 'finance' },
      { username: 'view1', role: 'viewer' },
      { username: 'sup1', role: 'supervisor' },
      { username: 'emp1', role: 'employee', employeeCode: 'T9901' },
      { username: 'blank', role: '' },
    ],
  });
  db = api.db;
});
afterAll(async () => {
  await api.close();
  try { fs.rmSync(DOCS_DIR, { recursive: true, force: true }); } catch { /* best effort */ }
});

const changes = () => db.prepare('SELECT total_changes() AS c').get().c;

const refusalCases = [];
for (const [method, url, allowed, msg] of ROUTES) {
  for (const [user, role] of Object.entries(USERS)) {
    if (!allowed.includes(role)) refusalCases.push([method, url, user, msg]);
  }
}

describe('refused roles get 403 and nothing is written', () => {
  test.each(refusalCases)('%s %s as %s → 403', async (method, url, user, msg) => {
    const before = changes();
    const r = await api.request(method, url, { as: user, body: method === 'DELETE' ? null : { month: 9, year: 2026, code: 'T9900', codes: ['T9900'], type: 'salary_compute' } });
    expect(r.status).toBe(403);
    expect(r.body).toEqual({ success: false, error: msg });
    expect(changes()).toBe(before);
  });
});

const allowedCases = [];
for (const [method, url, allowed, , body] of ROUTES) {
  for (const role of allowed) allowedCases.push([method, url, role, body]);
}

describe('allowed roles still reach the handler', () => {
  test.each(allowedCases)('%s %s as %s → not 401/403', async (method, url, role, body) => {
    const r = await api.request(method, url, { as: AS[role], body });
    expect([401, 403]).not.toContain(r.status);
  });
});

describe('no token → 401', () => {
  test.each(ROUTES.map((x) => [x[0], x[1]]))('%s %s', async (method, url) => {
    const r = await api.request(method, url, { body: method === 'DELETE' ? null : {} });
    expect(r.status).toBe(401);
  });
});

// ── concrete effects the guard now blocks ─────────────────────────────
describe('what a viewer could do before, and now cannot', () => {
  test('DELETE /import/:id — hr refused, the month stays; admin deletes it', async () => {
    const id = db.prepare(`INSERT INTO monthly_imports (month, year, company, file_name) VALUES (8, 2026, 'P2-11 Co', 'f.xls')`).run().lastInsertRowid;
    let r = await api.request('DELETE', `/api/import/${id}`, { as: 'view1' });
    expect(r.status).toBe(403);
    r = await api.request('DELETE', `/api/import/${id}`, { as: 'hr1' });
    expect(r.status).toBe(403);
    expect(db.prepare('SELECT COUNT(*) AS c FROM monthly_imports WHERE id = ?').get(id).c).toBe(1);
    r = await api.request('DELETE', `/api/import/${id}`, { as: 'boss' });
    expect(r.status).toBe(200);
    expect(db.prepare('SELECT COUNT(*) AS c FROM monthly_imports WHERE id = ?').get(id).c).toBe(0);
  });

  test('reactivate-employee — viewer refused, status stays Left; hr reactivates', async () => {
    db.prepare(`INSERT INTO employees (code, name, company, status) VALUES ('T9902', 'TEST', 'P2-11 Co', 'Left')`).run();
    let r = await api.request('POST', '/api/analytics/reactivate-employee', { as: 'view1', body: { code: 'T9902' } });
    expect(r.status).toBe(403);
    expect(db.prepare(`SELECT status FROM employees WHERE code = 'T9902'`).get().status).toBe('Left');
    r = await api.request('POST', '/api/analytics/reactivate-employee', { as: 'hr1', body: { code: 'T9902' } });
    expect(r.status).toBe(200);
    expect(db.prepare(`SELECT status FROM employees WHERE code = 'T9902'`).get().status).toBe('Active');
  });

  test('POST /jobs — hr and finance refused, no job queued', async () => {
    const before = changes();
    for (const who of ['hr1', 'fin1', 'view1']) {
      const r = await api.request('POST', '/api/jobs', { as: who, body: { type: 'salary_compute', params: { month: 9, year: 2026 } } });
      expect(r.status).toBe(403);
    }
    expect(changes()).toBe(before);
  });

  test('PUT /attendance/record/:id — finance kept (planner Q3), viewer refused', async () => {
    const id = db.prepare(`INSERT INTO attendance_processed (employee_code, date, month, year, company, status_final)
                           VALUES ('T9903', '2026-09-02', 9, 2026, 'P2-11 Co', 'A')`).run().lastInsertRowid;
    let r = await api.request('PUT', `/api/attendance/record/${id}`, { as: 'view1', body: { status_final: 'P', remark: 'x' } });
    expect(r.status).toBe(403);
    expect(db.prepare('SELECT status_final FROM attendance_processed WHERE id = ?').get(id).status_final).toBe('A');
    r = await api.request('PUT', `/api/attendance/record/${id}`, { as: 'fin1', body: { status_final: 'P', remark: 'x' } });
    expect([401, 403]).not.toContain(r.status);
  });
});

// ── uploads: a refused file is never written to disk ──────────────────
function multipart(url, token, field, filename, content) {
  const boundary = '----p211boundary';
  const payload = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`),
    Buffer.from(content),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port: api.server.address().port, method: 'POST', path: url,
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': payload.length, Authorization: `Bearer ${token}` },
    }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    req.on('error', reject);
    req.write(payload); req.end();
  });
}
const listFiles = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir, { recursive: true }) : []);

describe('uploads', () => {
  test('viewer document upload → 403, no file in the documents dir', async () => {
    const before = listFiles(DOCS_DIR).length;
    const status = await multipart('/api/employees/T9900/documents', api.tokens.view1, 'file', 'x.pdf', 'fake');
    expect(status).toBe(403);
    expect(listFiles(DOCS_DIR).length).toBe(before);
  });

  test('viewer attendance upload → 403, no file in the uploads dir', async () => {
    const dir = path.join(__dirname, '../../../uploads');
    const before = listFiles(dir).length;
    const status = await multipart('/api/import/upload', api.tokens.view1, 'files', 'x.xls', 'fake');
    expect(status).toBe(403);
    expect(listFiles(dir).length).toBe(before);
  });
});

// ── stage number whitelist (one line, planner-approved) ──────────────
describe('POST /import/stage/:stage/complete', () => {
  test('non-numeric stage → 400 (was a 500: stage_NaN_done)', async () => {
    const r = await api.request('POST', '/api/import/stage/abc/complete', { as: 'hr1', body: { month: 9, year: 2026 } });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('Invalid stage number');
  });
  test.each(['0', '8', '-1'])('stage %s → 400', async (s) => {
    const r = await api.request('POST', `/api/import/stage/${s}/complete`, { as: 'hr1', body: { month: 9, year: 2026 } });
    expect(r.status).toBe(400);
  });
  test('stage 3 → 200 and stage_3_done set', async () => {
    db.prepare(`INSERT INTO monthly_imports (month, year, company, file_name) VALUES (7, 2026, 'P2-11 Co', 'g.xls')`).run();
    const r = await api.request('POST', '/api/import/stage/3/complete', { as: 'hr1', body: { month: 7, year: 2026 } });
    expect(r.status).toBe(200);
    expect(db.prepare(`SELECT stage_3_done FROM monthly_imports WHERE month = 7 AND year = 2026`).get().stage_3_done).toBe(1);
  });
});
