// Role → page-key matrix. Since P2-10 (Oct 2026) this is the ONE source the
// frontend uses to decide which menu items, routes and the Header "Settings"
// link a role sees (GET /api/auth/permissions → frontend/src/utils/permissions.js,
// which maps every route to a key). It does NOT guard the API by itself: only
// the `sales-tada-*` keys are also read by the backend (middleware/roles.js
// requirePermission). Every other API route has its own role guard.
//
// P2-10 rule: a key was added to a role only where that role could already open
// and use the page before P2-10 (its data loaded — the backend did not refuse
// it). No backend access changed. See docs/ux-bulk/prs/P2-10/PROGRESS.md for the
// role × page table. Keys marked "P2-10" are the additions.
//
// Admin-only page keys (no role but admin has them; admin has '*'):
//   attendance-review, session-analytics, query-tool, sql-console, bug-reports,
//   record-history, statutory-flags, settings
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
       // P2-10: pages HR already used (menu showed them, their data loads for HR)
       'payable-ot', 'finance-verification', 'extra-duty-grants', 'contractor-report', 'salary-explainer'],
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
            // P2-10: pages finance already used (menu showed them, their data loads for finance)
            'daily-mis', 'import', 'shift-verify', 'night-shift', 'corrections', 'day-calc',
            'salary-advance', 'leave-management', 'workforce', 'contractor-report', 'analytics',
            'daily-wage-finance', 'salary-explainer'],
  // P2-10: supervisor and viewer keep every page they could already read (the
  // backend has no read guard on these). Pages whose data the backend refuses
  // them (sales, early exit, contractor report, daily-wage finance, and for
  // supervisor loans + leave) are not listed, so the menu hides them.
  supervisor: ['dashboard', 'supervisor-dashboard', 'notifications', 'daily-mis',
               'import', 'miss-punch', 'shift-verify', 'night-shift', 'corrections', 'day-calc', 'salary',
               'held-salaries-register', 'salary-advance', 'payable-ot', 'salary-input', 'workforce',
               'analytics', 'late-coming', 'compliance', 'reports', 'finance-audit', 'finance-verification',
               'extra-duty-grants', 'alerts', 'employees', 'daily-wage', 'employee-profile', 'dept-analytics'],
  viewer: ['dashboard', 'reports', 'notifications', 'daily-mis', 'loans',
           'import', 'miss-punch', 'shift-verify', 'night-shift', 'corrections', 'day-calc', 'salary',
           'held-salaries-register', 'salary-advance', 'payable-ot', 'salary-input', 'leave-management',
           'workforce', 'analytics', 'late-coming', 'compliance', 'finance-audit', 'finance-verification',
           'extra-duty-grants', 'alerts', 'employees', 'daily-wage', 'employee-profile', 'dept-analytics'],
  // P2-10: an employee login opens the same layout as a supervisor and could read
  // the same pages (no backend read guard) — listed so nothing changes for it.
  employee: ['portal',
             'dashboard', 'daily-mis',
             'import', 'miss-punch', 'shift-verify', 'night-shift', 'corrections', 'day-calc', 'salary',
             'held-salaries-register', 'salary-advance', 'payable-ot', 'salary-input', 'workforce',
             'analytics', 'late-coming', 'compliance', 'reports', 'finance-audit', 'finance-verification',
             'extra-duty-grants', 'alerts', 'employees', 'daily-wage', 'employee-profile', 'dept-analytics']
};

function hasPermission(role, page) {
  const perms = PERMISSIONS[role] || PERMISSIONS.viewer;
  return perms.includes('*') || perms.includes(page);
}

function getPermissions(role) {
  return PERMISSIONS[role] || PERMISSIONS.viewer;
}

module.exports = { PERMISSIONS, hasPermission, getPermissions };
