/**
 * P2-10 — the permission matrix is the one source for menu, routes and the
 * Header "Settings" link (GET /api/auth/permissions → frontend/src/utils/permissions.js).
 *
 * Pins: (1) the endpoint answers the role of the JWT (normalised), over HTTP
 * behind the REAL requireAuth with real JWTs; (2) no pre-P2-10 key was removed;
 * (3) the sales-tada-* keys (the only keys the backend itself reads, through
 * requirePermission) are unchanged; (4) every page key the frontend route table
 * uses is either granted to some role or one of the documented admin-only keys;
 * (5) the P2-10 additions are there (these fail on the old matrix).
 */
const fs = require('fs');
const path = require('path');
const { startJwtApi } = require('./helpers/jwtApiHarness');

let api;
beforeAll(() => {
  api = startJwtApi({ '/api/auth': '../../routes/auth' }, {
    users: [
      { username: 'boss', role: 'admin' },
      { username: 'hr1', role: 'hr' },
      { username: 'hrmgr', role: 'HR Manager' },
      { username: 'fin1', role: 'finance' },
      { username: 'view1', role: 'viewer' },
      { username: 'sup1', role: 'supervisor' },
      { username: 'emp1', role: 'employee', employeeCode: 'T9001' },
      { username: 'odd', role: 'cleaner' },
    ],
  });
});
afterAll(async () => { await api.close(); });

const { PERMISSIONS, hasPermission } = require('../config/permissions');

// The matrix as it stood before P2-10 (origin/main 8abee96).
const BEFORE = {
  admin: ['*'],
  hr: ['dashboard', 'daily-mis', 'import', 'attendance', 'miss-punch', 'night-shift', 'shift-verify',
    'corrections', 'day-calc', 'salary', 'employees', 'leaves', 'advances', 'loans',
    'reports', 'payslips', 'notifications', 'leave-management', 'salary-input', 'salary-advance',
    'workforce', 'analytics', 'compliance', 'finance-audit', 'alerts', 'held-salaries-register',
    'late-coming', 'daily-wage', 'early-exit', 'dept-analytics', 'employee-profile', 'comp-off',
    'sales-employees', 'sales-holidays', 'sales-upload', 'sales-compute', 'sales-register', 'sales-exports',
    'sales-tada-request', 'sales-tada-compute', 'sales-tada-payable-export'],
  finance: ['dashboard', 'salary', 'reports', 'finance-audit', 'finance-verification',
    'extra-duty-grants', 'payable-ot', 'payslips', 'notifications', 'alerts',
    'employees', 'compliance', 'salary-input', 'miss-punch',
    'held-salaries-register', 'late-coming', 'daily-wage', 'early-exit', 'dept-analytics', 'employee-profile', 'comp-off',
    'sales-tada-approve', 'sales-tada-payable-export', 'loans'],
  supervisor: ['dashboard', 'supervisor-dashboard', 'notifications', 'daily-mis'],
  viewer: ['dashboard', 'reports', 'notifications', 'daily-mis', 'loans'],
  employee: ['portal'],
};
const ADMIN_ONLY = ['attendance-review', 'session-analytics', 'query-tool', 'sql-console', 'bug-reports',
  'record-history', 'statutory-flags', 'settings'];

describe('GET /api/auth/permissions', () => {
  test.each([
    ['boss', 'admin'], ['hr1', 'hr'], ['hrmgr', 'hr'], ['fin1', 'finance'], ['view1', 'viewer'],
    ['sup1', 'supervisor'], ['emp1', 'employee'], ['odd', 'viewer'],
  ])('%s gets the %s list', async (user, role) => {
    const r = await api.request('GET', '/api/auth/permissions', { as: user });
    expect(r.status).toBe(200);
    expect(r.body.role).toBe(role);
    expect(r.body.permissions).toEqual(PERMISSIONS[role]);
  });

  test('no token → 401', async () => {
    const r = await api.request('GET', '/api/auth/permissions');
    expect(r.status).toBe(401);
  });

  test('admin keeps everything', () => {
    expect(PERMISSIONS.admin).toEqual(['*']);
    for (const k of ADMIN_ONLY) expect(hasPermission('admin', k)).toBe(true);
  });
});

describe('matrix', () => {
  test('no key that existed before P2-10 was removed from any role', () => {
    for (const [role, keys] of Object.entries(BEFORE)) {
      for (const k of keys) expect([role, PERMISSIONS[role].includes(k)]).toEqual([role, true]);
    }
  });

  test('sales-tada-* keys (read by requirePermission on the server) are unchanged', () => {
    for (const role of Object.keys(BEFORE)) {
      const now = PERMISSIONS[role].filter(k => k.startsWith('sales-tada-')).sort();
      const then = BEFORE[role].filter(k => k.startsWith('sales-tada-')).sort();
      expect([role, now]).toEqual([role, then]);
    }
  });

  test('admin-only page keys are granted to no other role', () => {
    for (const role of ['hr', 'finance', 'supervisor', 'viewer', 'employee']) {
      for (const k of ADMIN_ONLY) expect([role, k, PERMISSIONS[role].includes(k)]).toEqual([role, k, false]);
    }
  });

  test('every page key in the frontend route table is granted somewhere or admin-only', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../../frontend/src/utils/permissions.js'), 'utf8');
    const table = src.slice(src.indexOf('const ROUTE_KEYS = {'), src.indexOf('const PREFIXES'));
    const keys = new Set([...table.matchAll(/\[([^\]]+)\]/g)].flatMap(m => [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1])));
    expect(keys.size).toBeGreaterThan(30);
    const granted = new Set(Object.values(PERMISSIONS).flat());
    const orphan = [...keys].filter(k => !granted.has(k) && !ADMIN_ONLY.includes(k));
    expect(orphan).toEqual([]);
  });

  test('P2-10 additions: pages each role already used are now in its list', () => {
    expect(PERMISSIONS.hr).toEqual(expect.arrayContaining(['payable-ot', 'finance-verification', 'extra-duty-grants', 'contractor-report', 'salary-explainer']));
    expect(PERMISSIONS.finance).toEqual(expect.arrayContaining(['daily-mis', 'import', 'day-calc', 'leave-management', 'analytics', 'contractor-report', 'daily-wage-finance', 'salary-explainer']));
    expect(PERMISSIONS.viewer).toEqual(expect.arrayContaining(['import', 'salary', 'employees', 'finance-audit', 'leave-management']));
    // pages whose data the server refuses them stay out
    expect(PERMISSIONS.viewer).not.toEqual(expect.arrayContaining(['early-exit']));
    expect(PERMISSIONS.supervisor).not.toEqual(expect.arrayContaining(['loans']));
    expect(PERMISSIONS.supervisor).not.toEqual(expect.arrayContaining(['leave-management']));
    for (const role of ['viewer', 'supervisor', 'employee']) {
      expect(PERMISSIONS[role].some(k => k.startsWith('sales-'))).toBe(false);
      expect(PERMISSIONS[role]).not.toEqual(expect.arrayContaining(['daily-wage-finance']));
      expect(PERMISSIONS[role]).not.toEqual(expect.arrayContaining(['contractor-report']));
    }
  });
});
