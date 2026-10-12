import React from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useAppStore } from '../../store/appStore'
import { normalizeRole } from '../../utils/role'
import { usePermissions } from '../../utils/permissions'
import { salesTaDaRequestsPendingCount, getLeaveChangeFlags, getLoanStats } from '../../utils/api'
import clsx from 'clsx'

// Pending TA/DA approval count — polls every 60s. Only mounted on the
// child item that opts in via `tadaPendingBadge: true`, and the parent
// component only mounts that child when the user has approve permission,
// so this query never fires for HR-only users.
function TaDaPendingBadge() {
  const { data } = useQuery({
    queryKey: ['ta-da-pending-count'],
    queryFn: () => salesTaDaRequestsPendingCount(),
    refetchInterval: 60 * 1000,
    refetchOnWindowFocus: true,
    retry: 0,
  })
  const count = data?.data?.count || 0
  if (!count) return null
  return (
    <span className="ml-auto inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-semibold leading-none">
      {count}
    </span>
  )
}

/**
 * Count of leave changes that landed on a finalized month and still need HR to
 * look at them. Hidden for anyone who cannot act on them.
 */
function LeaveFlagBadge({ role }) {
  const canSee = role === 'hr' || role === 'admin'
  const { data } = useQuery({
    queryKey: ['leave-change-flags-count'],
    queryFn: () => getLeaveChangeFlags({}),
    refetchInterval: 60 * 1000,
    refetchOnWindowFocus: true,
    enabled: canSee,
    retry: 0,
  })
  const count = data?.data?.count || 0
  if (!canSee || !count) return null
  return (
    <span
      title={`${count} leave change${count === 1 ? '' : 's'} landed on a finalized month`}
      className="ml-auto inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-amber-500 text-white text-[10px] font-semibold leading-none"
    >
      {count}
    </span>
  )
}

/**
 * Loans PR-4: loans and change requests waiting for the admin. Only the admin
 * decides (SPEC §7), so only the admin sees the count.
 */
function LoanQueueBadge({ role }) {
  const isAdminRole = role === 'admin'
  const { data } = useQuery({
    queryKey: ['loan-stats', 'sidebar'],
    queryFn: () => getLoanStats({}),
    refetchInterval: 60 * 1000,
    refetchOnWindowFocus: true,
    enabled: isAdminRole,
    retry: 0,
  })
  const p = data?.data?.data?.pendingApprovals
  const count = (p?.loans || 0) + (p?.changes || 0)
  if (!isAdminRole || !count) return null
  return (
    <span
      title={`${count} loan request${count === 1 ? '' : 's'} waiting for approval`}
      className="ml-auto inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-semibold leading-none"
    >
      {count}
    </span>
  )
}

// P2-10: who sees an item comes from the permission matrix only
// (utils/permissions.js). A link is shown when its route opens for the role
// (`canPath(to)`); an item with `perm` uses that key instead; a parent is shown
// when at least one child is.
const nav = [
  { label: 'Dashboard', icon: '🏠', to: '/' },
  { label: 'Daily MIS', icon: '📊', to: '/daily-mis' },
  {
    label: 'Payroll', icon: '💰', to: '/pipeline',
    children: [
      { label: '1. Import', icon: '📥', to: '/pipeline/import' },
      { label: '2. Miss Punches', icon: '🔍', to: '/pipeline/miss-punch' },
      { label: '3. Shift Check', icon: '🕐', to: '/pipeline/shift-check' },
      { label: '4. Night Shift', icon: '🌙', to: '/pipeline/night-shift' },
      { label: '5. Corrections', icon: '✏️', to: '/pipeline/corrections' },
      { label: '6. Day Calc', icon: '📅', to: '/pipeline/day-calc' },
      { label: '7. Salary', icon: '₹', to: '/pipeline/salary' },
      { label: 'Held Salaries Register', icon: '🔒', to: '/held-salaries' },
      { label: 'Salary Advance', icon: '💵', to: '/salary-advance' },
      { label: 'Payable OT', icon: '⏱️', to: '/payable-ot' },
      { label: 'Salary Input', icon: '📝', to: '/salary-input' },
      { label: 'Loans', icon: '🏦', to: '/loans', loanQueueBadge: true },
    ]
  },
  { label: 'Leave Management', icon: '📋', to: '/leave-management', leaveFlagBadge: true },
  {
    label: 'Workforce', icon: '👥', to: '/workforce',
    children: [
      { label: 'Headcount & Composition', to: '/workforce/headcount' },
      { label: 'Hiring & Attrition', to: '/workforce/attrition' },
      { label: 'Contractor Management', to: '/workforce/contractors' },
      { label: 'Contractor Report', to: '/workforce/contractor-report' },
    ]
  },
  {
    label: 'Attendance Analytics', icon: '📈', to: '/analytics',
    children: [
      { label: 'Overview', to: '/analytics/overview' },
      { label: 'Absenteeism', to: '/analytics/absenteeism' },
      { label: 'Punctuality', to: '/analytics/punctuality' },
      { label: 'Overtime', to: '/analytics/overtime' },
      { label: 'Working Hours', to: '/analytics/hours' },
      { label: 'Early Exit', to: '/analytics/early-exit' },
      { label: 'Attendance Review', to: '/analytics/attendance-review' },
    ]
  },
  // Late Coming Phase 1: dedicated nav entry points to the Punctuality tab
  // where the new late-coming management UI lives.
  { label: 'Late Coming', icon: '⏰', to: '/analytics/punctuality', perm: 'late-coming' },
  {
    label: 'Compliance', icon: '✅', to: '/compliance',
    children: [
      { label: 'PF Compliance', to: '/compliance/pf' },
      { label: 'ESI Compliance', to: '/compliance/esi' },
      { label: 'Labour Law', to: '/compliance/labour-law' },
      { label: 'Compliance Calendar', to: '/compliance/calendar' },
    ]
  },
  { label: 'Reports', icon: '📋', to: '/reports' },
  { label: 'Finance Audit', icon: '🏦', to: '/finance-audit' },
  { label: 'Finance Verify', icon: '🔐', to: '/finance-verification' },
  { label: 'Extra Duty', icon: '⭐', to: '/extra-duty-grants' },
  { label: 'Alerts', icon: '🔔', to: '/alerts' },
  { label: 'Employees', icon: '👤', to: '/employees' },
  {
    label: 'Daily Wage', icon: '👷', to: '/daily-wage', children: [
      { label: 'Records', to: '/daily-wage' },
      { label: 'New Entry', to: '/daily-wage/new' },
      { label: 'Batch Import', to: '/daily-wage/import' },
      { label: 'Contractors', to: '/daily-wage/contractors' },
      { label: 'Reports', to: '/daily-wage/reports' },
      { label: 'Finance Review', to: '/daily-wage/finance/review', },
      { label: 'Payments', to: '/daily-wage/finance/payments', },
      { label: 'Dashboard', to: '/daily-wage/finance/dashboard', },
      { label: 'Audit Log', to: '/daily-wage/audit', },
    ]
  },
  {
    // Finance sees only TA/DA Approvals here (the matrix gives finance no other sales key).
    label: 'Sales', icon: '🛒', to: '/sales',
    children: [
      { label: 'Sales Employees', to: '/sales/employees' },
      { label: 'Sales Holidays', to: '/sales/holidays' },
      { label: 'Upload Sheet', to: '/sales/upload' },
      { label: 'Compute Salaries', to: '/sales/compute' },
      { label: 'TA/DA Register', to: '/sales/ta-da-register' },
      { label: 'TA/DA Upload', to: '/sales/ta-da-upload' },
      // HR may open the URL (reads the list) but approves nothing, so the menu entry needs the approve key.
      { label: 'TA/DA Approvals', to: '/sales/ta-da-approvals', perm: 'sales-tada-approve', tadaPendingBadge: true },
    ]
  },
  { label: 'Employee Profile', icon: '🔬', to: '/employee-profile' },
  { label: 'Dept Analytics', icon: '🏢', to: '/dept-analytics' },
  { label: 'Salary Explainer', icon: '🤖', action: 'salaryExplainer', perm: 'salary-explainer' },
  { label: 'Session Analytics', icon: '📊', to: '/session-analytics' },
  { label: 'Query Tool', icon: '🔎', to: '/admin/query-tool' },
  { label: 'SQL Console', icon: '🛠', to: '/admin/sql-console' },
  { label: 'Bug Reports', icon: '🐞', to: '/admin/bug-reports' },
  { label: 'Record History', icon: '🕰', to: '/admin/record-history' },
  { label: 'Statutory Flags', icon: '🧾', to: '/admin/statutory-flags' },
  {
    label: 'Settings', icon: '⚙️', to: '/settings',
    children: [
      { label: 'Shift Master', to: '/settings/shifts' },
      { label: 'Holiday Master', to: '/settings/holidays' },
      { label: 'Policy Config', to: '/settings/policy' },
      { label: 'Audit Trail', to: '/settings/audit' },
      { label: 'Usage Logs', to: '/settings/usage-logs' },
      { label: 'User Management', to: '/settings/users' },
    ]
  },
]

// True when the item is visible under these permissions (see the comment above `nav`).
function isVisible(item, perm) {
  if (item.children && item.children.length > 0) return item.children.some(c => isVisible(c, perm))
  if (item.perm) return perm.can(item.perm)
  return item.to ? perm.canPath(item.to) : false
}

function NavItem({ item, collapsed, depth = 0, userRole, perm, onNavigate, onAction }) {
  const [open, setOpen] = React.useState(false)
  const location = useLocation()
  const isActive = item.to ? (location.pathname === item.to || location.pathname.startsWith(item.to + '/')) : false
  const hasChildren = item.children && item.children.length > 0

  const hidden = !isVisible(item, perm)

  // Auto-open active parent
  React.useEffect(() => {
    if (isActive && hasChildren) setOpen(true)
  }, [isActive])

  // P1-12: every hook of NavItem must stay ABOVE this line. A hook after a
  // role-based return changes the hook count when the role changes in place
  // (e.g. the /auth/me refresh) and React crashes the whole layout.
  if (hidden) return null

  // Action items (no route, just trigger a handler in the parent)
  if (item.action) {
    return (
      <li>
        <button
          type="button"
          onClick={() => { onAction?.(item.action); onNavigate?.() }}
          className={clsx(
            'w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors text-slate-600 hover:bg-slate-100 hover:text-slate-900',
            depth > 0 && 'pl-6'
          )}
        >
          {item.icon && <span className="text-base shrink-0">{item.icon}</span>}
          {!collapsed && <span className="flex-1 text-left">{item.label}</span>}
        </button>
      </li>
    )
  }

  if (hasChildren) {
    const visibleChildren = item.children.filter(c => isVisible(c, perm))
    return (
      <li>
        <button
          onClick={() => setOpen(!open)}
          className={clsx(
            'w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors',
            isActive ? 'bg-blue-50 text-blue-700 font-medium' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
            depth > 0 && 'pl-6'
          )}
        >
          {item.icon && <span className="text-base shrink-0">{item.icon}</span>}
          {!collapsed && <span className="flex-1 text-left">{item.label}</span>}
          {!collapsed && <span className="text-xs">{open ? '▲' : '▼'}</span>}
        </button>
        {!collapsed && open && (
          <ul className="mt-1 ml-4 space-y-0.5 border-l-2 border-slate-100 pl-3">
            {visibleChildren.map(child => (
              <NavItem key={child.to} item={child} collapsed={collapsed} depth={depth + 1} userRole={userRole} perm={perm} onNavigate={onNavigate} />
            ))}
          </ul>
        )}
      </li>
    )
  }

  return (
    <li>
      <NavLink
        to={item.to}
        onClick={onNavigate}
        className={({ isActive }) => clsx(
          'flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors',
          isActive ? 'bg-blue-600 text-white font-medium shadow-sm' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
          depth > 0 && 'text-xs py-1.5'
        )}
        end={item.to === '/'}
      >
        {item.icon && <span className="text-base shrink-0">{item.icon}</span>}
        {!collapsed && <span>{item.label}</span>}
        {!collapsed && item.tadaPendingBadge && <TaDaPendingBadge />}
        {!collapsed && item.leaveFlagBadge && <LeaveFlagBadge role={userRole} />}
        {!collapsed && item.loanQueueBadge && <LoanQueueBadge role={userRole} />}
      </NavLink>
    </li>
  )
}

export default function Sidebar() {
  const { sidebarCollapsed, toggleSidebar, alertCount, user, openSalaryExplainer } = useAppStore()
  const collapsed = sidebarCollapsed
  // Normalised so legacy role strings ("Finance Team", "Admin") still
  // collapse to canonical form before any === 'admin' check downstream.
  const userRole = normalizeRole(user?.role)
  // P2-10: one permission list for the whole menu. Until it is in, no item shows.
  const perm = usePermissions()

  // Close sidebar on mobile after navigation
  const handleMobileNav = () => {
    if (window.innerWidth < 768 && !collapsed) toggleSidebar()
  }

  // Nav-level actions (sidebar items without routes).
  const handleAction = (action) => {
    if (action === 'salaryExplainer') openSalaryExplainer()
  }

  return (
    <>
      {/* Mobile overlay — click to close sidebar */}
      {!collapsed && (
        <div
          className="fixed inset-0 bg-black/40 z-30 md:hidden"
          onClick={toggleSidebar}
        />
      )}

      <aside className={clsx(
        'flex flex-col bg-white border-r border-slate-200 h-screen transition-all duration-200 z-40',
        // Desktop: sticky sidebar, collapse to thin strip
        'md:sticky md:top-0',
        collapsed ? 'md:w-14' : 'md:w-60',
        // Mobile: fixed overlay drawer, fully hidden when collapsed
        'fixed top-0 left-0',
        collapsed ? '-translate-x-full md:translate-x-0 w-0 md:w-14 overflow-hidden' : 'translate-x-0 w-64'
      )}>
        {/* Logo */}
        <div className={clsx(
          'flex items-center border-b border-slate-100',
          collapsed ? 'justify-center px-2 py-4' : 'gap-3 px-4 py-4'
        )}>
          {!collapsed && (
            <>
              <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center text-white text-sm font-bold shrink-0">AL</div>
              <div className="min-w-0">
                <div className="text-sm font-semibold text-slate-800 truncate">Asian Lakto</div>
                <div className="text-xs text-slate-400">HR & Payroll System</div>
              </div>
            </>
          )}
          <button
            onClick={toggleSidebar}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className={clsx(
              'text-slate-400 hover:text-slate-600 shrink-0',
              !collapsed && 'ml-auto'
            )}
          >
            <span className="text-xs">{collapsed ? '→' : '←'}</span>
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto px-2 py-3">
          {perm.ready ? (
            <ul className="space-y-0.5">
              {nav.map(item => (
                <NavItem key={item.to || item.action || item.label} item={item} collapsed={collapsed} userRole={userRole} perm={perm} onNavigate={handleMobileNav} onAction={handleAction} />
              ))}
            </ul>
          ) : perm.failed && !collapsed ? (
            <div className="px-3 py-2 text-xs text-slate-500" data-testid="nav-perm-error">
              Couldn't load the menu.{' '}
              <button type="button" onClick={() => perm.retry()} className="text-blue-600 hover:underline">Retry</button>
            </div>
          ) : null}
        </nav>

        {/* Footer */}
        {!collapsed && (
          <div className="px-4 py-3 border-t border-slate-100">
            <p className="text-xs text-slate-400">Indriyan Beverages</p>
            <p className="text-xs text-slate-300">v1.1.0 • {user?.username || 'user'} ({userRole})</p>
          </div>
        )}
      </aside>
    </>
  )
}
