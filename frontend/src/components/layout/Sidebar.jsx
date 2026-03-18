import React from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { useAppStore } from '../../store/appStore'
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
      { label: 'Salary Advance', icon: '💵', to: '/salary-advance' },
      { label: 'Salary Input', icon: '📝', to: '/salary-input' },
      { label: 'Loans', icon: '🏦', to: '/loans' },
      { label: 'Leave Management', icon: '📋', to: '/leave-management' },
    ]
  },
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
    ]
  },
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
  { label: 'Alerts', icon: '🔔', to: '/alerts' },
  { label: 'Employees', icon: '👤', to: '/employees' },
  { label: 'Session Analytics', icon: '📊', to: '/session-analytics', adminOnly: true },
  {
    label: 'Settings', icon: '⚙️', to: '/settings',
    children: [
      { label: 'Shift Master', to: '/settings/shifts' },
      { label: 'Holiday Master', to: '/settings/holidays' },
      { label: 'Policy Config', to: '/settings/policy' },
      { label: 'Audit Trail', to: '/settings/audit' },
      { label: 'Usage Logs', to: '/settings/usage-logs', adminOnly: true },
      { label: 'User Management', to: '/settings/users', adminOnly: true },
    ]
  },
]

function NavItem({ item, collapsed, depth = 0, userRole }) {
  const [open, setOpen] = React.useState(false)
  const location = useLocation()
  const isActive = location.pathname === item.to || location.pathname.startsWith(item.to + '/')
  const hasChildren = item.children && item.children.length > 0

  // Hide admin-only items from non-admin users
  if (item.adminOnly && userRole !== 'admin') return null

  // Auto-open active parent
  React.useEffect(() => {
    if (isActive && hasChildren) setOpen(true)
  }, [isActive])

  if (hasChildren) {
    const visibleChildren = item.children.filter(c => !c.adminOnly || userRole === 'admin')
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
              <NavItem key={child.to} item={child} collapsed={collapsed} depth={depth + 1} userRole={userRole} />
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
  const { sidebarCollapsed, toggleSidebar, alertCount, user } = useAppStore()
  const collapsed = sidebarCollapsed
  const userRole = user?.role || 'viewer'

  return (
    <aside className={clsx(
      'flex flex-col bg-white border-r border-slate-200 h-screen sticky top-0 transition-all duration-200',
      collapsed ? 'w-14' : 'w-60'
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
            <NavItem key={item.to} item={item} collapsed={collapsed} userRole={userRole} />
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
  )
}
