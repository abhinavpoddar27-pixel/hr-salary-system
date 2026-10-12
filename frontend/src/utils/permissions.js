// P2-10: one source of truth for what a role may see.
//
// The role → page-key matrix lives on the server (backend/src/config/permissions.js)
// and comes from GET /api/auth/permissions. This file holds the other half: which
// page key(s) each route needs. The sidebar, the route guard in App.jsx and the
// Header "Settings" link all ask the same two functions — `can(key)` and
// `canPath(pathname)` — so a menu item and its URL can never disagree.
//
// While the permissions load nothing is shown (no flicker of items the role
// cannot open). Admin's list is ['*'] = everything.
import { useQuery } from '@tanstack/react-query'
import { useAppStore } from '../store/appStore'
import { getUserPermissions } from './api'
import { normalizeRole } from './role'

// Route prefix → page keys (any one of them opens the page). Longest prefix wins;
// '/' matches only the dashboard itself. A path that matches nothing is refused.
const ROUTE_KEYS = {
  '/': ['dashboard'],
  '/daily-mis': ['daily-mis'],
  '/pipeline': ['import'], // redirects to /pipeline/import
  '/pipeline/import': ['import'],
  '/pipeline/miss-punch': ['miss-punch'],
  '/pipeline/shift-check': ['shift-verify'],
  '/pipeline/night-shift': ['night-shift'],
  '/pipeline/corrections': ['corrections'],
  '/pipeline/day-calc': ['day-calc'],
  '/pipeline/salary': ['salary'],
  '/held-salaries': ['held-salaries-register'],
  '/salary-advance': ['salary-advance'],
  '/payable-ot': ['payable-ot'],
  '/salary-input': ['salary-input'],
  '/loans': ['loans'],
  '/leave-management': ['leave-management'],
  '/workforce': ['workforce'],
  '/workforce/contractor-report': ['contractor-report'],
  '/analytics': ['analytics'],
  // The "Late Coming" menu entry opens this tab, so either key opens it.
  '/analytics/punctuality': ['analytics', 'late-coming'],
  '/analytics/early-exit': ['early-exit'],
  '/analytics/attendance-review': ['attendance-review'],
  '/compliance': ['compliance'],
  '/reports': ['reports'],
  '/finance-audit': ['finance-audit'],
  '/finance-verification': ['finance-verification'],
  '/extra-duty-grants': ['extra-duty-grants'],
  '/alerts': ['alerts'],
  '/employees': ['employees'],
  '/daily-wage': ['daily-wage'],
  '/daily-wage/finance': ['daily-wage-finance'],
  '/daily-wage/audit': ['daily-wage-finance'],
  '/sales/employees': ['sales-employees'],
  '/sales/holidays': ['sales-holidays'],
  '/sales/upload': ['sales-upload'],
  '/sales/compute': ['sales-compute'],
  '/sales/payslip': ['sales-register'],
  '/sales/ta-da-register': ['sales-tada-compute'],
  '/sales/ta-da-upload': ['sales-tada-compute'],
  // HR can read the TA/DA request list (the server allows it), so the URL stays
  // open to HR; the menu entry uses 'sales-tada-approve' only (see Sidebar).
  '/sales/ta-da-approvals': ['sales-tada-approve', 'sales-tada-request'],
  '/employee-profile': ['employee-profile'],
  '/dept-analytics': ['dept-analytics'],
  '/session-analytics': ['session-analytics'],
  '/admin/query-tool': ['query-tool'],
  '/admin/sql-console': ['sql-console'],
  '/admin/bug-reports': ['bug-reports'],
  '/admin/record-history': ['record-history'],
  '/admin/statutory-flags': ['statutory-flags'],
  '/settings': ['settings'],
}
const PREFIXES = Object.keys(ROUTE_KEYS).filter(p => p !== '/').sort((a, b) => b.length - a.length)

/** Page keys a pathname needs (any one of them), or null if the path is not a known page. */
export function keysForPath(pathname) {
  const p = String(pathname || '/').replace(/\/+$/, '') || '/'
  if (p === '/') return ROUTE_KEYS['/']
  const hit = PREFIXES.find(pre => p === pre || p.startsWith(pre + '/'))
  return hit ? ROUTE_KEYS[hit] : null
}

/** True if the permission list grants the key ('*' = everything). */
export function hasKey(perms, key) {
  return Array.isArray(perms) && (perms.includes('*') || perms.includes(key))
}

/** True if the permission list opens the pathname. Unknown paths are refused (admin excepted). */
export function canOpenPath(perms, pathname) {
  if (!Array.isArray(perms)) return false
  if (perms.includes('*')) return true
  const keys = keysForPath(pathname)
  return !!keys && keys.some(k => perms.includes(k))
}

/**
 * The signed-in user's permissions. One cached request per user + role; a role
 * changed in place (the /auth/me refresh) fetches again. Until the list is in,
 * `ready` is false and `can` / `canPath` answer false.
 */
export function usePermissions() {
  const isAuthenticated = useAppStore(s => s.isAuthenticated)
  const user = useAppStore(s => s.user)
  const role = normalizeRole(user?.role)
  const q = useQuery({
    queryKey: ['auth-permissions', user?.username || '', role],
    queryFn: () => getUserPermissions().then(r => r.data),
    enabled: !!isAuthenticated,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    retry: 2,
  })
  const perms = Array.isArray(q.data?.permissions) ? q.data.permissions : null
  return {
    ready: !!perms,
    failed: !perms && q.isError,
    retry: q.refetch,
    role,
    can: key => hasKey(perms, key),
    canPath: pathname => canOpenPath(perms, pathname),
  }
}
