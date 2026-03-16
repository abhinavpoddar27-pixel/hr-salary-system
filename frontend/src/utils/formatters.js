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
export const YEAR_OPTIONS = [2024, 2025, 2026, 2027].map(y => ({ value: y, label: String(y) }))
