/**
 * P2-10 — the role matrix (config/permissions.js) is now the ONE source the frontend uses for the
 * Sidebar, the routes and the Header "Settings" link (via GET /api/auth/permissions).
 *
 * Pins:
 *  1. admin / hr / finance keep exactly the sidebar they had before P2-10 (measured on 8abee969 with
 *     backend/scripts/permissions-nav-check.py --base): every nav key they saw is in their list and
 *     every nav key they did not see is not.
 *  2. viewer / supervisor follow the matrix (owner ruling Q5 A): viewer 4 page keys, supervisor 2.
 *  3. No key that existed before P2-10 was removed (additions only), and the sales keys read by
 *     requirePermission in routes/sales.js are unchanged for every role.
 *  4. GET /api/auth/permissions returns the list for each role behind the real requireAuth + JWT.
 */
const { PERMISSIONS, hasPermission } = require('../config/permissions');
const { startJwtApi } = require('./helpers/jwtApiHarness');

// Every Sidebar entry → its page key (frontend/src/components/layout/Sidebar.jsx `perm`).
const NAV = {
  Dashboard: 'dashboard', 'Daily MIS': 'daily-mis',
  '1. Import': 'import', '2. Miss Punches': 'miss-punch', '3. Shift Check': 'shift-verify',
  '4. Night Shift': 'night-shift', '5. Corrections': 'corrections', '6. Day Calc': 'day-calc',
  '7. Salary': 'salary', 'Held Salaries Register': 'held-salaries-register', 'Salary Advance': 'salary-advance',
  'Payable OT': 'payable-ot', 'Salary Input': 'salary-input', Loans: 'loans',
  'Leave Management': 'leave-management', 'Workforce pages': 'workforce', 'Contractor Report': 'contractor-report',
  'Analytics pages': 'analytics', Punctuality: 'late-coming', 'Early Exit': 'early-exit',
  'Attendance Review': 'attendance-review', 'Late Coming': 'late-coming', 'Compliance pages': 'compliance',
  Reports: 'reports', 'Finance Audit': 'finance-audit', 'Finance Verify': 'finance-verification',
  'Extra Duty': 'extra-duty-grants', Alerts: 'alerts', Employees: 'employees',
  'Daily Wage pages': 'daily-wage', 'Daily Wage finance pages': 'daily-wage-finance',
  'Sales Employees': 'sales-employees', 'Sales Holidays': 'sales-holidays', 'Upload Sheet': 'sales-upload',
  'Compute Salaries': 'sales-compute', 'TA/DA Register + Upload': 'sales-tada-compute',
  'TA/DA Approvals': 'sales-tada-approve', 'Employee Profile': 'employee-profile',
  'Dept Analytics': 'dept-analytics', 'Salary Explainer': 'salary-explainer',
  'Session Analytics': 'session-analytics', 'Query Tool': 'query-tool', 'SQL Console': 'sql-console',
  'Bug Reports': 'bug-reports', 'Record History': 'record-history', 'Statutory Flags': 'statutory-flags',
  Settings: 'settings',
};

// Hidden in the sidebar BEFORE P2-10 (8abee969). Everything else in NAV was shown.
const HIDDEN_BEFORE = {
  admin: [],
  hr: ['Attendance Review', 'Daily Wage finance pages', 'TA/DA Approvals', 'Session Analytics', 'Query Tool',
    'SQL Console', 'Bug Reports', 'Record History', 'Statutory Flags', 'Settings'],
  finance: ['Attendance Review', 'Sales Employees', 'Sales Holidays', 'Upload Sheet', 'Compute Salaries',
    'TA/DA Register + Upload', 'Session Analytics', 'Query Tool', 'SQL Console', 'Bug Reports',
    'Record History', 'Statutory Flags', 'Settings'],
};

// The matrix before P2-10 (8abee969) — additions only allowed.
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

describe('P2-10 matrix: admin / hr / finance keep today\'s sidebar', () => {
  for (const role of ['admin', 'hr', 'finance']) {
    test(`${role}: shown before = allowed now, hidden before = refused now`, () => {
      const shown = []; const hidden = [];
      for (const [label, key] of Object.entries(NAV)) (hasPermission(role, key) ? shown : hidden).push(label);
      expect(hidden.sort()).toEqual([...HIDDEN_BEFORE[role]].sort());
    });
  }
});

describe('P2-10 matrix: viewer / supervisor follow the matrix (ruling Q5 A)', () => {
  const visible = (role) => Object.entries(NAV).filter(([, k]) => hasPermission(role, k)).map(([l]) => l).sort();
  test('viewer sees Dashboard, Daily MIS, Loans, Reports', () => {
    expect(visible('viewer')).toEqual(['Daily MIS', 'Dashboard', 'Loans', 'Reports']);
  });
  test('supervisor sees Dashboard, Daily MIS', () => {
    expect(visible('supervisor')).toEqual(['Daily MIS', 'Dashboard']);
  });
  test('admin-only keys belong to no other role', () => {
    for (const k of ['settings', 'sql-console', 'query-tool', 'bug-reports', 'record-history',
      'statutory-flags', 'session-analytics', 'attendance-review']) {
      for (const role of Object.keys(PERMISSIONS).filter(r => r !== 'admin')) {
        expect(PERMISSIONS[role]).not.toContain(k);
      }
    }
  });
});

describe('P2-10 matrix: additions only; sales keys unchanged', () => {
  test('every pre-P2-10 key is still there', () => {
    for (const [role, keys] of Object.entries(BEFORE)) {
      for (const k of keys) expect(PERMISSIONS[role]).toContain(k);
    }
  });
  test('viewer, supervisor, employee lists unchanged', () => {
    for (const role of ['viewer', 'supervisor', 'employee']) expect(PERMISSIONS[role]).toEqual(BEFORE[role]);
  });
  test('sales-* keys (requirePermission in routes/sales.js) unchanged per role', () => {
    for (const role of Object.keys(BEFORE)) {
      const sales = (l) => l.filter(k => k.startsWith('sales-')).sort();
      expect(sales(PERMISSIONS[role])).toEqual(sales(BEFORE[role]));
    }
  });
});

describe('GET /api/auth/permissions (real requireAuth + JWT)', () => {
  let api;
  beforeAll(() => {
    api = startJwtApi({ '/api/auth': '../../routes/auth' }, {
      users: [
        { username: 'adm', role: 'admin' }, { username: 'h1', role: 'hr' }, { username: 'f1', role: 'Finance Team' },
        { username: 'v1', role: 'viewer' }, { username: 's1', role: 'supervisor' },
      ],
    });
  });
  afterAll(async () => { await api.close(); });

  test.each([['adm', 'admin'], ['h1', 'hr'], ['f1', 'finance'], ['v1', 'viewer'], ['s1', 'supervisor']])(
    '%s → %s list', async (user, role) => {
      const r = await api.request('GET', '/api/auth/permissions', { as: user });
      expect(r.status).toBe(200);
      expect(r.body.role).toBe(role);
      expect(r.body.permissions).toEqual(PERMISSIONS[role]);
    });
  test('no token → 401', async () => {
    const r = await api.request('GET', '/api/auth/permissions');
    expect(r.status).toBe(401);
  });
});
