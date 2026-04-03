const PERMISSIONS = {
  admin: ['*'],
  hr: ['dashboard', 'daily-mis', 'import', 'attendance', 'miss-punch', 'night-shift', 'shift-verify',
       'corrections', 'day-calc', 'salary', 'employees', 'leaves', 'advances', 'loans',
       'reports', 'payslips', 'notifications', 'leave-management', 'salary-input', 'salary-advance',
       'workforce', 'analytics', 'compliance', 'finance-audit', 'alerts'],
  finance: ['dashboard', 'salary', 'reports', 'finance-audit', 'payslips', 'notifications', 'alerts',
            'employees', 'compliance'],
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
