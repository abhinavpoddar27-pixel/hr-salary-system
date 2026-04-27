// Sales salary cycle: (M-1)-26 … M-25.
// Mirrors backend/src/services/cycleUtil.js deriveCycle(). If the backend
// cycle rule changes, update both in lockstep.
//
// Returns a human-readable subtitle like:
//   "Cycle: Mar 26, 2026 – Apr 25, 2026 (31 days)"
// Empty string if month/year are missing — safe to render unconditionally.

const MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function cycleSubtitle(month, year) {
  if (!month || !year) return ''
  const prevMonth = month === 1 ? 12 : month - 1
  const prevYear  = month === 1 ? year - 1 : year
  const startMs = Date.UTC(prevYear, prevMonth - 1, 26)
  const endMs   = Date.UTC(year, month - 1, 25)
  const lengthDays = Math.round((endMs - startMs) / 86400000) + 1
  const startLabel = `${MONTHS[prevMonth]} 26, ${prevYear}`
  const endLabel   = `${MONTHS[month]} 25, ${year}`
  return `Cycle: ${startLabel} – ${endLabel} (${lengthDays} days)`
}
