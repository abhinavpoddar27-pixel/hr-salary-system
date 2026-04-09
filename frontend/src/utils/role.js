// Canonical frontend role normalizer — mirrors backend/src/routes/auth.js
// normalizeRole() so HR/Finance/Admin checks never care about case,
// whitespace, or compound labels like "Finance Team" / "HR Manager".
//
// Kept deliberately small and dependency-free so any component can import
// it without pulling in a store or the API layer.

const VALID_ROLES = ['admin', 'hr', 'finance', 'supervisor', 'viewer', 'employee']

/**
 * Coerce any raw role value to its canonical lowercase form.
 * Handles: null/undefined, whitespace, case variations, and compound
 * strings ("Finance Team" → "finance", "HR_Manager" → "hr"). Unknown
 * values fall back to 'viewer' — the same safe default the backend uses.
 */
export function normalizeRole(raw) {
  const trimmed = String(raw || '').trim().toLowerCase()
  if (!trimmed) return 'viewer'
  // Exact match first (fast path)
  if (VALID_ROLES.includes(trimmed)) return trimmed
  // Token-based match for compound labels like "Finance Team" or "HR_Manager"
  const tokens = trimmed.split(/[\s_-]+/).filter(Boolean)
  for (const r of VALID_ROLES) {
    if (tokens.includes(r)) return r
  }
  return 'viewer'
}

/** True if the user can act as HR (HR or admin). */
export function canHR(user) {
  const r = normalizeRole(user?.role)
  return r === 'admin' || r === 'hr'
}

/** True if the user can act as Finance (Finance or admin). */
export function canFinance(user) {
  const r = normalizeRole(user?.role)
  return r === 'admin' || r === 'finance'
}

/** True if the user is admin. */
export function isAdmin(user) {
  return normalizeRole(user?.role) === 'admin'
}
