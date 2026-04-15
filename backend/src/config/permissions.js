const PERMISSIONS = {
  admin: ['*'],
  hr: ['dashboard', 'daily-mis', 'import', 'attendance', 'miss-punch', 'night-shift', 'shift-verify',
       'corrections', 'day-calc', 'salary', 'employees', 'leaves', 'advances', 'loans',
       'reports', 'payslips', 'notifications', 'leave-management', 'salary-input', 'salary-advance',
       'workforce', 'analytics', 'compliance', 'finance-audit', 'alerts', 'held-salaries-register',
       'late-coming', 'daily-wage', 'early-exit', 'dept-analytics', 'employee-profile', 'comp-off'],
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
            'held-salaries-register', 'late-coming', 'daily-wage', 'early-exit', 'dept-analytics', 'employee-profile', 'comp-off'],
  supervisor: ['dashboard', 'supervisor-dashboard', 'notifications', 'daily-mis'],
  viewer: ['dashboard', 'reports', 'notifications', 'daily-mis'],
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
