// Indian number formatting utilities

export const INR = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 0, maximumFractionDigits: 0 })
export const INR2 = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 })
export const NUM = new Intl.NumberFormat('en-IN')

export const fmtINR = (val) => INR.format(val || 0)
export const fmtINR2 = (val) => INR2.format(val || 0)
export const fmtNum = (val) => NUM.format(val || 0)
export const fmtPct = (val, decimals = 1) => `${(+(val || 0)).toFixed(decimals)}%`

const MONTHS_SHORT = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTHS_LONG = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

export const monthName = (m) => MONTHS_LONG[m] || ''
export const monthShort = (m) => MONTHS_SHORT[m] || ''
export const monthYearLabel = (m, y) => `${MONTHS_LONG[m]} ${y}`
export const monthYearShort = (m, y) => `${MONTHS_SHORT[m]} ${y}`

export function fmtDate(dateStr) {
  if (!dateStr) return '—'
  try {
    const d = new Date(dateStr + 'T12:00:00')
    return `${String(d.getDate()).padStart(2, '0')}-${MONTHS_SHORT[d.getMonth() + 1]}-${d.getFullYear()}`
  } catch { return dateStr }
}

export function fmtDateTime(isoStr) {
  if (!isoStr) return '—'
  try {
    const d = new Date(isoStr)
    return `${String(d.getDate()).padStart(2,'0')}-${MONTHS_SHORT[d.getMonth()+1]}-${d.getFullYear()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
  } catch { return isoStr }
}

export function fmtHours(decimal) {
  if (!decimal) return '—'
  const h = Math.floor(decimal)
  const m = Math.round((decimal - h) * 60)
  return `${h}h ${m}m`
}

export function attendanceRateColor(rate) {
  if (rate >= 85) return 'text-green-600'
  if (rate >= 70) return 'text-yellow-600'
  return 'text-red-600'
}

export function attendanceRateBg(rate) {
  if (rate >= 85) return 'bg-green-100'
  if (rate >= 70) return 'bg-yellow-100'
  return 'bg-red-100'
}

export function statusColor(status) {
  switch (status) {
    case 'P': return 'bg-green-100 text-green-700'
    case 'A': return 'bg-red-100 text-red-600'
    case 'WO': return 'bg-slate-100 text-slate-500'
    case 'WOP': return 'bg-emerald-100 text-emerald-700'
    case '½P': return 'bg-yellow-100 text-yellow-700'
    case 'WO½P': return 'bg-orange-100 text-orange-700'
    default: return 'bg-slate-50 text-slate-400'
  }
}

export function severityColor(severity) {
  switch (severity) {
    case 'Critical': return 'bg-red-100 text-red-700 border-red-200'
    case 'Warning': return 'bg-yellow-100 text-yellow-700 border-yellow-200'
    case 'Info': return 'bg-blue-50 text-blue-700 border-blue-200'
    default: return 'bg-slate-100 text-slate-600'
  }
}

export function severityIcon(severity) {
  switch (severity) {
    case 'Critical': return '🔴'
    case 'Warning': return '🟡'
    case 'Info': return '🟢'
    default: return '⚪'
  }
}

export const MONTH_OPTIONS = Array.from({ length: 12 }, (_, i) => ({ value: i + 1, label: MONTHS_LONG[i + 1] }))

// ── IST calendar helpers ──────────────────────────────────────────────
// The plant runs on IST; the server stores UTC; a browser may be in any zone.
// India has no DST, so IST is always UTC+05:30 — a fixed shift is exact and
// gives the same answer in every browser zone (no Intl dependency).
const IST_OFFSET_MS = 330 * 60 * 1000

function toEpochMs(value) {
  if (value === null || value === undefined || value === '') return NaN
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'number') return value
  const str = String(value).trim()
  if (!str) return NaN
  // A stored server timestamp "YYYY-MM-DD HH:MM:SS" (or ISO without a zone) is UTC.
  const iso = str.replace(' ', 'T')
  const hasZone = /([zZ]|[+-]\d{2}:?\d{2})$/.test(iso)
  return new Date(hasZone ? iso : `${iso}Z`).getTime()
}

/** Today's date in IST as 'YYYY-MM-DD', whatever zone the browser is in. */
export function todayIST(now = new Date()) {
  const ms = toEpochMs(now)
  return new Date((Number.isNaN(ms) ? Date.now() : ms) + IST_OFFSET_MS).toISOString().slice(0, 10)
}

/**
 * A value for <input type="date"> ('YYYY-MM-DD') in IST.
 * Accepts a Date, epoch ms, or a stored server timestamp (read as UTC).
 * A plain 'YYYY-MM-DD' is already a calendar date and is returned unchanged.
 * Empty / invalid → ''.
 */
export function toIstDateInput(value) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) return value.trim()
  const ms = toEpochMs(value)
  if (Number.isNaN(ms)) return ''
  return new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 10)
}

/** { year, month } (month 1-12) of `now` in IST. */
export function istYearMonth(now = new Date()) {
  const [y, m] = todayIST(now).split('-').map(Number)
  return { year: y, month: m }
}

/** 'YYYY-MM-DD' + n days (calendar arithmetic, zone-free). */
export function addDaysIso(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** Day of week of a 'YYYY-MM-DD' (0 = Sunday … 6 = Saturday), zone-free. */
export function isoDayOfWeek(iso) {
  return new Date(`${iso}T00:00:00Z`).getUTCDay()
}

/** Current IST year −2 … +1 (evaluated when the app loads). */
export const YEAR_OPTIONS = (() => {
  const { year } = istYearMonth()
  return [year - 2, year - 1, year, year + 1].map(y => ({ value: y, label: String(y) }))
})()

/**
 * The server stores timestamps in UTC (`datetime('now')`). The plant reads IST.
 * Renders a stored "YYYY-MM-DD HH:MM:SS" as HH:MM IST on the same clock the
 * owner uses, without pulling in a date library.
 */
export function fmtIstTime(stored) {
  if (!stored) return ''
  const iso = String(stored).replace(' ', 'T')
  const d = new Date(iso.endsWith('Z') ? iso : `${iso}Z`)
  if (Number.isNaN(d.getTime())) return String(stored)
  const ist = new Date(d.getTime() + 5.5 * 60 * 60 * 1000)
  const hh = String(ist.getUTCHours()).padStart(2, '0')
  const mm = String(ist.getUTCMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

/** Same, but with the date: "18 Sep, 14:35". */
export function fmtIstDateTime(stored) {
  if (!stored) return ''
  const iso = String(stored).replace(' ', 'T')
  const d = new Date(iso.endsWith('Z') ? iso : `${iso}Z`)
  if (Number.isNaN(d.getTime())) return String(stored)
  const ist = new Date(d.getTime() + 5.5 * 60 * 60 * 1000)
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${ist.getUTCDate()} ${MONTHS[ist.getUTCMonth()]}, ${fmtIstTime(stored)}`
}
