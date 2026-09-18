// Contractor Report — shared presentation helpers. (PR-2, read-only, Sep 2026)
//
// Light theme only, using the app's existing utility classes from index.css
// (card / card-header / table-compact / badge-* / stat-card / select / input).
// Nothing here fetches or writes.

// ─── formatters ───────────────────────────────────────────────────────────
// Rupees are displayed rounded to whole rupees (owner ruling, 19 Sep 2026).
// The API payload keeps exact values; rounding is a display concern only.
export const money = (n) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN')

// Man-days carry halves, so they show one decimal only when they need it.
export const days1 = (n) => {
  const v = Math.round((Number(n) || 0) * 10) / 10
  return v.toLocaleString('en-IN', { maximumFractionDigits: 1 })
}

export const int = (n) => (Number(n) || 0).toLocaleString('en-IN')
export const pct = (ratio) => Math.round((Number(ratio) || 0) * 100)

const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const MONTHS = MS.map((m, i) => ({ value: i + 1, label: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][i] }))

const asUtc = (iso) => new Date(iso + 'T00:00:00Z')

/** "Thu, 23 Apr 2026" */
export const dateLong = (iso) => {
  if (!iso) return '—'
  const d = asUtc(iso)
  return `${WD[d.getUTCDay()]}, ${d.getUTCDate()} ${MS[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

/** "23 Apr" */
export const dateShort = (iso) => {
  if (!iso) return '—'
  const d = asUtc(iso)
  return `${d.getUTCDate()} ${MS[d.getUTCMonth()]}`
}

export const isSunday = (iso) => asUtc(iso).getUTCDay() === 0
export const monthLabel = (m) => MONTHS.find((x) => x.value === Number(m))?.label || ''

// ─── shift + status marks ─────────────────────────────────────────────────
// Night is indigo/purple to match AttendanceRegister's night convention.
export const SUN_MARK = <span className="text-amber-500" aria-hidden="true">☀</span>
export const MOON_MARK = <span className="text-indigo-400" aria-hidden="true">☾</span>

export const STATUS_LABEL = {
  P: 'P', WOP: 'WOP', '½P': '½P', 'WO½P': 'WO½P', A: 'A', WO: 'WO',
}

export function ShiftBadge({ night }) {
  return night
    ? <span className="badge-purple">☾ Night</span>
    : <span className="badge-yellow">☀ Day</span>
}

export function StatusBadge({ status }) {
  const cls = status === 'P' ? 'badge-green' : status === 'WOP' ? 'badge-blue' : 'badge-yellow'
  return <span className={cls}>{STATUS_LABEL[status] || status}</span>
}

export function DwStatusBadge({ status }) {
  const counted = status === 'approved' || status === 'paid'
  return <span className={counted ? 'badge-green' : 'badge-yellow'}>{status}</span>
}

const ROLE_BADGE = {
  Supervisor: 'badge-green',
  Loading: 'badge-blue',
  Helper: 'badge-gray',
  Guard: 'badge-gray',
  Sweeper: 'badge-gray',
}

export function RoleBadge({ role }) {
  if (role === 'No designation') {
    return <span className="text-xs text-slate-400">No designation</span>
  }
  return <span className={ROLE_BADGE[role] || 'badge-gray'}>{role}</span>
}

/** A contractor name, with the grey "not mapped" badge when we've never seen it. */
export function ContractorName({ name, unmapped }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className="font-semibold text-slate-800">{name}</span>
      {unmapped && <span className="badge-gray" title="This name is not in the contractor alias list yet">not mapped</span>}
    </span>
  )
}

/** Small grey chips, e.g. departments or contractors on a row. */
export function Chips({ items }) {
  if (!items?.length) return <span className="text-slate-300">—</span>
  return (
    <span className="flex flex-wrap gap-1">
      {items.map((it) => (
        <span key={it.key} className="badge-gray" title={it.title || it.key}>
          {it.label}
        </span>
      ))}
    </span>
  )
}

// ─── layout bits ──────────────────────────────────────────────────────────
export function StatCard({ label, value, accent, alert }) {
  return (
    <div className={`stat-card border-l-4 ${accent}`}>
      <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</span>
      <span className={`text-2xl font-bold ${alert ? 'text-red-700' : 'text-slate-800'}`}>{value}</span>
    </div>
  )
}

/** DailyMIS-style segmented control. */
export function Segmented({ options, value, onChange, size = 'md' }) {
  return (
    <div className="flex gap-1 bg-slate-100 rounded-xl p-1 w-fit">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          className={[
            size === 'sm' ? 'px-3 py-1.5 text-xs' : 'px-5 py-2 text-sm',
            'font-semibold rounded-lg transition-all',
            value === o.value ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-700',
          ].join(' ')}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function EmptyState({ children }) {
  return <div className="card-body text-center text-slate-400">{children}</div>
}

export function Loading({ label = 'Loading…' }) {
  return <div className="card-body text-center text-slate-400">{label}</div>
}

export function ErrorState({ error }) {
  const msg = error?.response?.data?.error || error?.message || 'Something went wrong'
  return (
    <div className="card-body text-center">
      <p className="text-sm text-red-700">{msg}</p>
    </div>
  )
}

/** The yellow banner about workers whose company isn't one of the two real ones. */
export function UnknownCompanyBanner({ ratio, month, company }) {
  const p = pct(ratio)
  if (!p) return null
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
      {company
        ? <>Showing biometric workers tagged to <strong>{company}</strong> only. Daily-wage entries aren’t split by company, and </>
        : <>Daily-wage entries aren’t split by company, and </>}
      <strong>{p}%</strong> of {monthLabel(month)} contractor man-days sit on workers with no valid company.
    </div>
  )
}
