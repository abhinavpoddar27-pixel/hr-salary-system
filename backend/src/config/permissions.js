const PERMISSIONS = {
  admin: ['*'],
  hr: ['dashboard', 'daily-mis', 'import', 'attendance', 'miss-punch', 'night-shift', 'shift-verify',
       'corrections', 'day-calc', 'salary', 'employees', 'leaves', 'advances', 'loans',
       'reports', 'payslips', 'notifications', 'leave-management', 'salary-input', 'salary-advance',
       'workforce', 'analytics', 'compliance', 'finance-audit', 'alerts'],
  // Finance role (April 2026): added `salary-input` so finance can navigate to
  // the gross-salary change approval queue, and `miss-punch` so finance can
  // reach the new "Miss Punch Review" tab on the Finance Verification page.
  finance: ['dashboard', 'salary', 'reports', 'finance-audit', 'finance-verification',
            'extra-duty-grants', 'payable-ot', 'payslips', 'notifications', 'alerts',
            'employees', 'compliance', 'salary-input', 'miss-punch'],
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
