import { useCallback, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import api from '../utils/api'
import { useAppStore } from '../store/appStore'
import { normalizeRole } from '../utils/role'

/**
 * P2-10: the ONE place the frontend learns what a role may open.
 * Source = GET /api/auth/permissions (backend/src/config/permissions.js). Sidebar items, App routes
 * and the Header "Settings" link all call can(<page key>) from here — never a role compare.
 *
 * - Loaded once per signed-in user (query key carries token + username + role, so another login or
 *   the /auth/me role refresh refetches).
 * - Sent with no-cache: server.js answers GETs with max-age=5, which would hand a second user in the
 *   same browser the first user's list.
 * - While loading: ready=false — gated nav items are not drawn, gated pages show the loader.
 * - On failure (ruling Q2, fail open): every page except the admin-only ones below (admin keeps all),
 *   and failed=true so the Sidebar shows "Couldn't load your access". The server stays the real guard.
 */

// Keys no role but admin ('*') holds. Used ONLY for the fail-open fallback.
export const ADMIN_ONLY_KEYS = [
  'settings', 'sql-console', 'query-tool', 'bug-reports', 'record-history', 'statutory-flags',
  'session-analytics', 'attendance-review',
]

export function permissionsQueryKey(token, user) {
  return ['auth-permissions', token || '', user?.username || '', normalizeRole(user?.role)]
}

export default function usePermissions() {
  const isAuthenticated = useAppStore(s => s.isAuthenticated)
  const token = useAppStore(s => s.token)
  const user = useAppStore(s => s.user)
  const role = normalizeRole(user?.role)

  const q = useQuery({
    queryKey: permissionsQueryKey(token, user),
    queryFn: () => api.get('/auth/permissions', { headers: { 'Cache-Control': 'no-cache' } }).then(r => r.data),
    enabled: !!(isAuthenticated && token),
    staleTime: Infinity,
    gcTime: Infinity,
    retry: 1,
    refetchOnWindowFocus: false,
  })

  const perms = q.data?.success && Array.isArray(q.data.permissions) ? q.data.permissions : null
  const failed = !perms && q.isError
  const ready = !!perms || failed

  const can = useCallback((key) => {
    if (!key) return true
    if (perms) return perms.includes('*') || perms.includes(key)
    if (failed) return role === 'admin' || !ADMIN_ONLY_KEYS.includes(key)
    return false
  }, [perms, failed, role])

  const canAny = useCallback((keys) => (keys || []).some(k => can(k)), [can])

  return useMemo(() => ({ ready, failed, can, canAny, role }), [ready, failed, can, canAny, role])
}
