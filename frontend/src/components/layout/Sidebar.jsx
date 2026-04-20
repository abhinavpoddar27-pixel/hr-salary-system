import React from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { useAppStore } from '../../store/appStore'
import { normalizeRole } from '../../utils/role'
import clsx from 'clsx'

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
      { label: 'Loans', icon: '🏦', to: '/loans' },
    ]
  },
  { label: 'Leave Management', icon: '📋', to: '/leave-management' },
  {
    label: 'Workforce', icon: '👥', to: '/workforce',
    children: [
      { label: 'Headcount & Composition', to: '/workforce/headcount' },
      { label: 'Hiring & Attrition', to: '/workforce/attrition' },
      { label: 'Contractor Management', to: '/workforce/contractors' },
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
    ]
  },
  // Late Coming Phase 1: dedicated nav entry points to the Punctuality tab
  // where the new late-coming management UI lives.
  { label: 'Late Coming', icon: '⏰', to: '/analytics/punctuality' },
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
      { label: 'Finance Review', to: '/daily-wage/finance/review', financeOnly: true },
      { label: 'Payments', to: '/daily-wage/finance/payments', financeOnly: true },
      { label: 'Dashboard', to: '/daily-wage/finance/dashboard', financeOnly: true },
      { label: 'Audit Log', to: '/daily-wage/audit', financeOnly: true },
    ]
  },
  { label: 'Employee Profile', icon: '🔬', to: '/employee-profile' },
  { label: 'Dept Analytics', icon: '🏢', to: '/dept-analytics' },
  { label: 'Salary Explainer', icon: '🤖', action: 'salaryExplainer', hrFinanceOrAdmin: true },
  { label: 'Session Analytics', icon: '📊', to: '/session-analytics', adminOnly: true },
  { label: 'Query Tool', icon: '🔎', to: '/admin/query-tool', adminOnly: true },
  { label: 'Bug Reports', icon: '🐞', to: '/admin/bug-reports', adminOnly: true },
  {
    label: 'Settings', icon: '⚙️', to: '/settings', adminOnly: true,
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

function NavItem({ item, collapsed, depth = 0, userRole, onNavigate, onAction }) {
  const [open, setOpen] = React.useState(false)
  const location = useLocation()
  const isActive = item.to ? (location.pathname === item.to || location.pathname.startsWith(item.to + '/')) : false
  const hasChildren = item.children && item.children.length > 0

  // Hide admin-only items from non-admin users
  if (item.adminOnly && userRole !== 'admin') return null
  // Hide finance-only items from non-finance/non-admin users
  if (item.financeOnly && userRole !== 'finance' && userRole !== 'admin') return null
  // Hide HR/Finance/Admin-only items from other roles (Salary Explainer)
  if (item.hrFinanceOrAdmin && !['hr', 'finance', 'admin'].includes(userRole)) return null

  // Auto-open active parent
  React.useEffect(() => {
    if (isActive && hasChildren) setOpen(true)
  }, [isActive])

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
    const visibleChildren = item.children.filter(c => {
      if (c.adminOnly && userRole !== 'admin') return false
      if (c.financeOnly && userRole !== 'finance' && userRole !== 'admin') return false
      return true
    })
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
              <NavItem key={child.to} item={child} collapsed={collapsed} depth={depth + 1} userRole={userRole} onNavigate={onNavigate} />
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
        <div className="flex items-center gap-3 px-4 py-4 border-b border-slate-100">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center text-white text-sm font-bold shrink-0">AL</div>
          {!collapsed && (
            <div className="min-w-0">
              <div className="text-sm font-semibold text-slate-800 truncate">Asian Lakto</div>
              <div className="text-xs text-slate-400">HR & Payroll System</div>
            </div>
          )}
          <button onClick={toggleSidebar} className="ml-auto text-slate-400 hover:text-slate-600 shrink-0">
            <span className="text-xs">{collapsed ? '→' : '←'}</span>
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto px-2 py-3">
          <ul className="space-y-0.5">
            {nav.map(item => (
              <NavItem key={item.to || item.action || item.label} item={item} collapsed={collapsed} userRole={userRole} onNavigate={handleMobileNav} onAction={handleAction} />
            ))}
          </ul>
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
