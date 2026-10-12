/**
 * P3-RG — tax declaration reads are hr / finance / admin only.
 *
 * GET /api/tax-declarations/:code and GET /:code/calculate had no role guard
 * (router mounted behind requireAuth only), so a viewer, supervisor or an
 * employee-portal login could read anyone's declaration and projected TDS
 * (the calculate route also reads the person's latest gross). No caller in
 * the app or portal uses them for those roles (prod usage_logs: 0 calls ever),
 * and the owner ruled no self-read exception.
 *
 * Driven over HTTP behind the REAL requireAuth with real JWTs.
 */
const { startJwtApi } = require('./helpers/jwtApiHarness');

const CODE = 'T9871';
const FY = '2026-27';
let api;
let db;

beforeAll(() => {
  api = startJwtApi({ '/api/tax-declarations': '../../routes/taxDeclarations' }, {
    users: [
      { username: 'boss', role: 'admin' },
      { username: 'hr1', role: 'hr' },
      { username: 'hrmgr', role: 'HR Manager' },
      { username: 'fin1', role: 'finance' },
      { username: 'finteam', role: 'Finance Team' },
      { username: 'view1', role: 'viewer' },
      { username: 'sup1', role: 'supervisor' },
      { username: 'emp1', role: 'employee', employeeCode: CODE },
      { username: 'blank', role: '' },
    ],
  });
  db = api.db;
  const empId = db.prepare(`INSERT INTO employees (code, name, company, employment_type, status, date_of_joining)
                            VALUES (?, 'TEST PERSON', 'Test Co', 'Permanent', 'Active', '2024-01-01')`).run(CODE).lastInsertRowid;
  db.prepare(`INSERT INTO salary_structures (employee_id, effective_from, gross_salary, basic, da, hra)
              VALUES (?, '2024-01-01', 90000, 45000, 0, 20000)`).run(empId);
  db.prepare(`INSERT INTO tax_declarations (employee_code, financial_year, regime, section_80c, section_80d)
              VALUES (?, ?, 'old', 150000, 25000)`).run(CODE, FY);
});
afterAll(async () => { await api.close(); });

const ALLOWED = ['boss', 'hr1', 'hrmgr', 'fin1', 'finteam'];
const REFUSED = ['view1', 'sup1', 'emp1', 'blank'];
const READS = [
  ['declaration', `/api/tax-declarations/${CODE}?financial_year=${FY}`],
  ['calculate', `/api/tax-declarations/${CODE}/calculate?financial_year=${FY}`],
];

describe.each(READS)('GET %s', (_name, url) => {
  test.each(ALLOWED)('%s → 200 with data', async (as) => {
    const r = await api.request('GET', url, { as });
    expect(r.status).toBe(200);
    expect(r.body.success).toBe(true);
    expect(r.body.data).toBeTruthy();
  });

  test.each(REFUSED)('%s → 403, no data', async (as) => {
    const r = await api.request('GET', url, { as });
    expect(r.status).toBe(403);
    expect(r.body).toEqual({ success: false, error: 'HR, finance or admin access required' });
  });

  test('no token → 401', async () => {
    const r = await api.request('GET', url);
    expect(r.status).toBe(401);
  });
});

test('declaration read returns the stored row for hr', async () => {
  const r = await api.request('GET', `/api/tax-declarations/${CODE}?financial_year=${FY}`, { as: 'hr1' });
  expect(r.body.data.regime).toBe('old');
  expect(r.body.data.section_80c).toBe(150000);
});

test('unknown code as viewer → 403 (guard runs before the lookup)', async () => {
  const r = await api.request('GET', '/api/tax-declarations/T0000', { as: 'view1' });
  expect(r.status).toBe(403);
});

test('unknown code as finance → 200 data null (unchanged)', async () => {
  const r = await api.request('GET', '/api/tax-declarations/T0000', { as: 'fin1' });
  expect(r.status).toBe(200);
  expect(r.body.data).toBeNull();
});

describe('PUT unchanged', () => {
  test('hr can save', async () => {
    const r = await api.request('PUT', `/api/tax-declarations/${CODE}`, { as: 'hr1', body: { financial_year: FY, regime: 'old', section_80c: 100000 } });
    expect(r.status).toBe(200);
    expect(db.prepare('SELECT section_80c FROM tax_declarations WHERE employee_code = ? AND financial_year = ?').get(CODE, FY).section_80c).toBe(100000);
  });
  test('viewer refused, nothing written', async () => {
    const r = await api.request('PUT', `/api/tax-declarations/${CODE}`, { as: 'view1', body: { financial_year: FY, section_80c: 1 } });
    expect(r.status).toBe(403);
    expect(db.prepare('SELECT section_80c FROM tax_declarations WHERE employee_code = ? AND financial_year = ?').get(CODE, FY).section_80c).toBe(100000);
  });
});
