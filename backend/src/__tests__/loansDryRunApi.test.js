/**
 * Loans PR-11 — the dry run API over HTTP with REAL JWT auth.
 *
 *   POST /api/loans/dry-run          admin only, company-unrestricted admins only
 *   GET  /api/loans/dry-run/pack     admin only, read-only
 *
 * Month used: Sep 2026 (always ended, whatever day the suite runs on).
 */
const crypto = require('crypto');
const { startJwtApi } = require('./helpers/jwtApiHarness');

const IND = 'Indriyan Beverages Pvt Ltd';
const ALI = 'Asian Lakto Ind Ltd';
const USERS = [
  { username: 'boss', role: 'admin' },
  { username: 'bossAsian', role: 'admin', allowedCompanies: ALI },
  { username: 'hr1', role: 'hr' },
  { username: 'fin1', role: 'finance' },
  { username: 'view1', role: 'viewer' },
  { username: 'sup1', role: 'supervisor' },
];

let api; let db; let F;
const codes = [];

function dumpAll(auditMax) {
  const out = {};
  for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all()) {
    const where = name === 'audit_log' ? ` WHERE id <= ${Number(auditMax)}` : name === 'sqlite_sequence' ? " WHERE name <> 'audit_log'" : '';
    const h = crypto.createHash('sha256');
    for (const row of db.prepare(`SELECT * FROM "${name}"${where} ORDER BY rowid`).raw().iterate()) h.update(JSON.stringify(row));
    out[name] = h.digest('hex');
  }
  return out;
}
const auditMax = () => db.prepare('SELECT COALESCE(MAX(id), 0) AS m FROM audit_log').get().m;

beforeAll(() => {
  api = startJwtApi({ '/api/loans': '../../routes/loans' }, { users: USERS });
  db = api.db;
  F = require('./helpers/leaveFixture');
  for (let i = 0; i < 3; i++) {
    const code = `DR${i}${Math.floor(Math.random() * 1e5)}`;
    codes.push(code);
    db.prepare(`INSERT INTO employees (code, name, department, company, employment_type, status, date_of_joining, is_contractor, gross_salary)
                VALUES (?, 'DRY RUN EMP', 'PRODUCTION', ?, 'Permanent', 'Active', '2024-01-01', 0, 20000)`).run(code, IND);
    F.addDayCalc(db, { code, company: IND }, 9, 2026, { days_present: 26, total_payable_days: 26 });
    const ins = db.prepare("INSERT OR IGNORE INTO attendance_processed (employee_code, date, status_original, status_final, company, month, year) VALUES (?, ?, 'P', 'P', ?, 9, 2026)");
    for (let d = 23; d <= 30; d++) ins.run(code, `2026-09-${d}`, IND);
  }
  F.silently(() => require('../services/recompute').recomputeSalary(db, { month: 9, year: 2026, company: IND, requestId: 'stored' }));
});
afterAll(() => api.close());

const body = (over = {}) => ({ month: 9, year: 2026, payroll: 'plant', scenarios: [{ employeeCode: codes[0], company: IND, principal: 10000, tenure: 3 }], ...over });
const quiet = async (p) => { const l = console.log; const w = console.warn; const e = console.error; console.log = () => {}; console.warn = () => {}; console.error = () => {}; try { return await p(); } finally { console.log = l; console.warn = w; console.error = e; } };

describe('POST /api/loans/dry-run', () => {
  test('admin: 200, the report, and the database is unchanged except one audit row', async () => {
    const m = auditMax();
    const before = dumpAll(m);
    const r = await quiet(() => api.request('POST', '/api/loans/dry-run', { as: 'boss', body: body() }));
    expect(r.status).toBe(200);
    expect(r.body.success).toBe(true);
    const d = r.body.data;
    expect(d.nothingSaved).toBe(true);
    expect(d.verification.rollbackVerified).toBe(true);
    expect(d.scenarios[0].deductedInMonth).toBe(3334);
    expect(d.close.result.posted).toBe(1);
    expect(dumpAll(m)).toEqual(before);
    const added = db.prepare('SELECT action_type, changed_by FROM audit_log WHERE id > ?').all(m);
    expect(added).toEqual([{ action_type: 'loan_dry_run', changed_by: 'boss' }]);
    expect(db.prepare('SELECT COUNT(*) AS n FROM loans').get().n).toBe(0);
    expect(db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE type LIKE 'LOAN_%'").get().n).toBe(0);
  });

  test.each(['hr1', 'fin1', 'view1', 'sup1'])('%s → 403', async (who) => {
    const r = await api.request('POST', '/api/loans/dry-run', { as: who, body: body() });
    expect(r.status).toBe(403);
  });

  test('no token → 401', async () => {
    const r = await api.request('POST', '/api/loans/dry-run', { body: body() });
    expect(r.status).toBe(401);
  });

  test('company-restricted admin → 403 COMPANY_NOT_ALLOWED', async () => {
    const r = await api.request('POST', '/api/loans/dry-run', { as: 'bossAsian', body: body() });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('COMPANY_NOT_ALLOWED');
  });

  test('bad body → 400 with the code', async () => {
    const r = await api.request('POST', '/api/loans/dry-run', { as: 'boss', body: body({ scenarios: [] }) });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('SCENARIOS_INVALID');
  });

  test('another write transaction open on the handle → 409 DB_BUSY', async () => {
    db.exec('BEGIN');
    let r;
    try { r = await api.request('POST', '/api/loans/dry-run', { as: 'boss', body: body() }); } finally { db.exec('ROLLBACK'); }
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('DB_BUSY');
  });

  test('an ineligible borrower is a 200 report with the refusal, not an error', async () => {
    const r = await quiet(() => api.request('POST', '/api/loans/dry-run', { as: 'boss', body: body({ scenarios: [{ employeeCode: 'NOPE', company: IND, principal: 1000, tenure: 1 }] }) }));
    expect(r.status).toBe(200);
    expect(r.body.data.scenarios[0].refusal.code).toBe('NOT_ELIGIBLE');
  });
});

describe('GET /api/loans/dry-run/pack', () => {
  test('admin: suggestions for the latest computed month, read-only', async () => {
    const m = auditMax();
    const before = dumpAll(m);
    const r = await quiet(() => api.request('GET', '/api/loans/dry-run/pack?payroll=plant&month=9&year=2026', { as: 'boss' }));
    expect(r.status).toBe(200);
    expect(r.body.data.scenarios.length).toBeGreaterThanOrEqual(1);
    expect(r.body.data).toMatchObject({ month: 9, year: 2026, payroll: 'plant' });
    expect(dumpAll(m)).toEqual(before);
    expect(auditMax()).toBe(m);
  });

  test('hr → 403', async () => {
    const r = await api.request('GET', '/api/loans/dry-run/pack?payroll=plant', { as: 'hr1' });
    expect(r.status).toBe(403);
  });
});
