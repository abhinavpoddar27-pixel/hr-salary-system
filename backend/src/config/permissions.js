// Page keys — the single source for the frontend nav, routes and Header (P2-10,
// GET /api/auth/permissions). Admin-only pages use keys no role lists ('settings',
// 'sql-console', 'query-tool', 'bug-reports', 'record-history', 'statutory-flags',
// 'session-analytics', 'attendance-review') so only admin ('*') has them.
// Server routes do NOT read this matrix except requirePermission (sales.js, sales-* keys).
const PERMISSIONS = {
  admin: ['*'],
  hr: ['dashboard', 'daily-mis', 'import', 'attendance', 'miss-punch', 'night-shift', 'shift-verify',
       'corrections', 'day-calc', 'salary', 'employees', 'leaves', 'advances', 'loans',
       'reports', 'payslips', 'notifications', 'leave-management', 'salary-input', 'salary-advance',
       'workforce', 'analytics', 'compliance', 'finance-audit', 'alerts', 'held-salaries-register',
       'late-coming', 'daily-wage', 'early-exit', 'dept-analytics', 'employee-profile', 'comp-off',
       'sales-employees', 'sales-holidays', 'sales-upload',
       'sales-compute', 'sales-register', 'sales-exports',
       'sales-tada-request', 'sales-tada-compute', 'sales-tada-payable-export',
       // P2-10 (Oct 2026): pages HR already uses that the matrix never listed. The
       // frontend now gates nav + routes on this matrix, so they must be here.
       'finance-verification', 'extra-duty-grants', 'payable-ot', 'contractor-report', 'salary-explainer'],
  // Finance role (April 2026): added `salary-input` so finance can navigate to
  // the gross-salary change approval queue, `miss-punch` so finance can reach
  // the Miss Punch Review tab, and `held-salaries-register` for the new
  // dedicated Held Salaries Register page under Payroll. HR also gets the
  // register for read-only visibility (Release button is gated on canFinance).
  // `late-coming` (Phase 1) is read-only for finance — they will gain
  // approve/reject buttons in Phase 2.
  finance: ['dashboard', 'salary', 'reports', 'finance-audit', 'finance-verification',
            'extra-duty-grants', 'payable-ot', 'payslips', 'notifications', 'alerts',
            'employees', 'compliance', 'salary-input', 'miss-punch',
            'held-salaries-register', 'late-coming', 'daily-wage', 'early-exit', 'dept-analytics', 'employee-profile', 'comp-off',
            'sales-tada-approve', 'sales-tada-payable-export', 'loans',
            // P2-10 (Oct 2026): pages finance already uses that the matrix never listed.
            'daily-mis', 'import', 'shift-verify', 'night-shift', 'corrections', 'day-calc',
            'salary-advance', 'leave-management', 'workforce', 'analytics', 'contractor-report',
            'daily-wage-finance', 'salary-explainer'],
  supervisor: ['dashboard', 'supervisor-dashboard', 'notifications', 'daily-mis'],
  viewer: ['dashboard', 'reports', 'notifications', 'daily-mis', 'loans'],
  employee: ['portal']
};

function hasPermission(role, page) {
  const perms = PERMISSIONS[role] || PERMISSIONS.viewer;
  return perms.includes('*') || perms.includes(page);
}

function getPermissions(role) {
  return PERMISSIONS[role] || PERMISSIONS.viewer;
}

module.exports = { PERMISSIONS, hasPermission, getPermissions };
