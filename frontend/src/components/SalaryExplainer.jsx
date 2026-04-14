import React, { useState, useEffect, useRef } from 'react'
import clsx from 'clsx'
import { useAppStore } from '../store/appStore'
import { normalizeRole } from '../utils/role'
import { searchEmployeesForAI, explainSalary } from '../utils/api'

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
]

const SECTION_LABELS = {
  SUMMARY: 'Summary',
  EARNINGS: 'Earnings',
  DEDUCTIONS: 'Deductions',
  CHANGES: 'Changes',
  FLAGS: 'Flags'
}

/**
 * Split a narrative explanation into labelled sections.
 * Looks for lines like "SUMMARY", "-- SUMMARY --", "── SUMMARY ──" etc.
 */
function parseSections(text) {
  if (!text) return []
  const keys = Object.keys(SECTION_LABELS)
  const re = new RegExp(`(?:^|\\n)\\s*[─\\-=*]*\\s*(${keys.join('|')})\\s*[─\\-=*:]*\\s*(?:\\n|$)`, 'gi')
  const sections = []
  const matches = []
  let m
  while ((m = re.exec(text)) !== null) {
    matches.push({ key: m[1].toUpperCase(), index: m.index, end: m.index + m[0].length })
  }
  if (matches.length === 0) return [{ key: 'EXPLANATION', title: 'Explanation', body: text.trim() }]
  for (let i = 0; i < matches.length; i++) {
    const cur = matches[i]
    const next = matches[i + 1]
    const body = text.slice(cur.end, next ? next.index : text.length).trim()
    sections.push({ key: cur.key, title: SECTION_LABELS[cur.key] || cur.key, body })
  }
  return sections
}

function formatMoney(n) {
  if (n === null || n === undefined || isNaN(n)) return '₹0'
  const rounded = Math.round(Number(n) * 100) / 100
  return '₹' + rounded.toLocaleString('en-IN', { maximumFractionDigits: 2 })
}

function QuickNumbersCard({ summary }) {
  if (!summary) return null
  const { employee, attendance, current, previous, period } = summary
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs space-y-2">
      <div className="flex items-center justify-between">
        <div className="font-semibold text-slate-700">Quick Numbers</div>
        <div className="text-slate-500">{period?.label}</div>
      </div>
      <div>
        <div className="font-medium text-slate-800">{employee.name} ({employee.code})</div>
        <div className="text-slate-500">
          {employee.department || '—'} · {employee.employment_type} · {employee.company || '—'}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1">
        <div className="text-slate-600">Payable Days</div>
        <div className="text-right font-medium">{attendance.payable_days}</div>
        <div className="text-slate-600">Present / Half / Absent</div>
        <div className="text-right font-medium">
          {attendance.present} / {attendance.half_day} / {attendance.absent}
        </div>
        <div className="text-slate-600">WOP / Paid WO / Holidays</div>
        <div className="text-right font-medium">
          {attendance.wop} / {attendance.paid_weekly_offs} / {attendance.paid_holidays}
        </div>
        <div className="text-slate-600">Gross Earned</div>
        <div className="text-right font-medium">{formatMoney(current.gross_earned)}</div>
        <div className="text-slate-600">PF / ESI / TDS</div>
        <div className="text-right font-medium">
          {formatMoney(current.pf)} / {formatMoney(current.esi)} / {formatMoney(current.tds)}
        </div>
        {current.advance > 0 && (
          <>
            <div className="text-slate-600">Advance Recovery</div>
            <div className="text-right font-medium">{formatMoney(current.advance)}</div>
          </>
        )}
        {current.loan > 0 && (
          <>
            <div className="text-slate-600">Loan EMI</div>
            <div className="text-right font-medium">{formatMoney(current.loan)}</div>
          </>
        )}
        {current.late > 0 && (
          <>
            <div className="text-slate-600">Late Deduction</div>
            <div className="text-right font-medium">{formatMoney(current.late)}</div>
          </>
        )}
        {current.early_exit > 0 && (
          <>
            <div className="text-slate-600">Early Exit Ded.</div>
            <div className="text-right font-medium">{formatMoney(current.early_exit)}</div>
          </>
        )}
        <div className="text-slate-600">Total Deductions</div>
        <div className="text-right font-medium">{formatMoney(current.total_deductions)}</div>
        <div className="text-slate-700 font-semibold">Net Salary</div>
        <div className="text-right font-semibold text-emerald-700">
          {formatMoney(current.net_salary)}
        </div>
        {current.take_home !== current.net_salary && (
          <>
            <div className="text-slate-700 font-semibold">Take Home</div>
            <div className="text-right font-semibold text-emerald-700">
              {formatMoney(current.take_home)}
            </div>
          </>
        )}
      </div>
      {previous && (
        <div className="border-t border-slate-200 pt-2">
          <div className="flex items-center justify-between">
            <span className="text-slate-600">vs {previous.label}</span>
            <span
              className={clsx(
                'font-medium',
                previous.net_change > 0 ? 'text-emerald-700' :
                  previous.net_change < 0 ? 'text-rose-700' : 'text-slate-600'
              )}
            >
              {previous.net_change > 0 ? '+' : ''}
              {formatMoney(previous.net_change)}
            </span>
          </div>
        </div>
      )}
      {(current.salary_held || current.gross_changed || attendance.is_mid_month_joiner) && (
        <div className="border-t border-slate-200 pt-2 space-y-1">
          {current.salary_held && (
            <div className="text-rose-700">⚠ Salary Held — {current.hold_reason || 'Reason not specified'}</div>
          )}
          {current.gross_changed && (
            <div className="text-amber-700">⚠ Gross changed from salary structure</div>
          )}
          {attendance.is_mid_month_joiner && (
            <div className="text-blue-700">ℹ Mid-month joiner</div>
          )}
        </div>
      )}
    </div>
  )
}

function LoadingSkeleton() {
  return (
    <div className="space-y-3 animate-pulse">
      <div className="h-4 bg-slate-200 rounded w-1/3" />
      <div className="space-y-2">
        <div className="h-3 bg-slate-200 rounded w-full" />
        <div className="h-3 bg-slate-200 rounded w-5/6" />
        <div className="h-3 bg-slate-200 rounded w-4/6" />
      </div>
      <div className="h-4 bg-slate-200 rounded w-1/3 mt-4" />
      <div className="space-y-2">
        <div className="h-3 bg-slate-200 rounded w-full" />
        <div className="h-3 bg-slate-200 rounded w-5/6" />
      </div>
      <div className="text-center text-xs text-slate-500 pt-2">Analyzing salary data…</div>
    </div>
  )
}

export default function SalaryExplainer() {
  const user = useAppStore(s => s.user)
  const isAuthenticated = useAppStore(s => s.isAuthenticated)
  const salaryExplainerOpen = useAppStore(s => s.salaryExplainerOpen)
  const toggleSalaryExplainer = useAppStore(s => s.toggleSalaryExplainer)
  const closeSalaryExplainer = useAppStore(s => s.closeSalaryExplainer)
  const selectedMonth = useAppStore(s => s.selectedMonth)
  const selectedYear = useAppStore(s => s.selectedYear)

  const userRole = normalizeRole(user?.role)
  const allowedRole = ['admin', 'hr', 'finance'].includes(userRole)

  const [search, setSearch] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [showDropdown, setShowDropdown] = useState(false)
  const [selectedEmp, setSelectedEmp] = useState(null)
  const [month, setMonth] = useState(selectedMonth)
  const [year, setYear] = useState(selectedYear)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [errorMsg, setErrorMsg] = useState('')

  const searchBoxRef = useRef(null)
  const firstRenderRef = useRef(true)

  // Keyboard shortcut: Ctrl/Cmd+Shift+E toggle; Esc closes.
  useEffect(() => {
    const handler = (e) => {
      const target = e.target
      const inField = target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
      if (!inField && (e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'e') {
        if (!allowedRole) return
        e.preventDefault()
        toggleSalaryExplainer()
      }
      if (e.key === 'Escape' && salaryExplainerOpen) {
        closeSalaryExplainer()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [allowedRole, salaryExplainerOpen, toggleSalaryExplainer, closeSalaryExplainer])

  // Sync month/year defaults from the global store when the panel opens.
  useEffect(() => {
    if (salaryExplainerOpen) {
      setMonth(selectedMonth)
      setYear(selectedYear)
      firstRenderRef.current = false
    }
  }, [salaryExplainerOpen, selectedMonth, selectedYear])

  // Close autocomplete dropdown on outside click.
  useEffect(() => {
    const handler = (e) => {
      if (searchBoxRef.current && !searchBoxRef.current.contains(e.target)) {
        setShowDropdown(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Debounced employee search.
  useEffect(() => {
    if (!search || search.trim().length < 1) {
      setSearchResults([])
      return
    }
    // Skip the fetch once the user has already selected an employee and the
    // input just mirrors their choice ("10001 - Rahul Kumar").
    if (selectedEmp && search === `${selectedEmp.code} - ${selectedEmp.name}`) {
      return
    }
    const timer = setTimeout(async () => {
      try {
        const res = await searchEmployeesForAI(search.trim())
        setSearchResults(res?.data?.data || [])
      } catch (e) {
        setSearchResults([])
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [search, selectedEmp])

  const handleSelectEmployee = (emp) => {
    setSelectedEmp(emp)
    setSearch(`${emp.code} - ${emp.name}`)
    setShowDropdown(false)
    setResult(null)
    setErrorMsg('')
  }

  const handleClearEmployee = () => {
    setSelectedEmp(null)
    setSearch('')
    setResult(null)
    setErrorMsg('')
  }

  const handleExplain = async () => {
    if (!selectedEmp) {
      setErrorMsg('Please search and select an employee first')
      return
    }
    setLoading(true)
    setErrorMsg('')
    setResult(null)
    try {
      const res = await explainSalary({
        employee_code: selectedEmp.code,
        month,
        year
      })
      const payload = res?.data
      if (!payload?.success) {
        setErrorMsg(payload?.error || 'Failed to generate explanation')
      } else {
        setResult(payload)
        if (payload.error) setErrorMsg(payload.error)
      }
    } catch (err) {
      const msg = err?.response?.data?.error || err?.message || 'Request failed'
      setErrorMsg(msg)
    } finally {
      setLoading(false)
    }
  }

  if (!isAuthenticated || !allowedRole) return null

  const yearOptions = (() => {
    const y = new Date().getFullYear()
    return [y - 2, y - 1, y, y + 1]
  })()

  const sections = result?.explanation ? parseSections(result.explanation) : []

  return (
    <>
      {/* Floating trigger button — stacked above the AbbreviationLegend's
          ? glyph (bottom-5 right-5) so the two don't overlap. */}
      {!salaryExplainerOpen && (
        <button
          onClick={toggleSalaryExplainer}
          className="fixed bottom-16 right-4 z-40 bg-blue-600 hover:bg-blue-700 text-white rounded-full shadow-lg px-4 py-2.5 flex items-center gap-2 text-sm font-medium transition-all"
          title="Salary Explainer (Ctrl+Shift+E)"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
              d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 4v-4z" />
          </svg>
          <span className="hidden sm:inline">Salary Explainer</span>
        </button>
      )}

      {/* Dim overlay on mobile so the panel feels modal. */}
      {salaryExplainerOpen && (
        <div
          className="fixed inset-0 bg-black/30 z-40"
          onClick={closeSalaryExplainer}
          aria-hidden="true"
        />
      )}

      {/* Slide-over panel */}
      <aside
        className={clsx(
          'fixed top-0 right-0 h-screen bg-white shadow-2xl border-l border-slate-200 z-50 flex flex-col transition-transform duration-200',
          'w-full sm:w-96',
          salaryExplainerOpen ? 'translate-x-0' : 'translate-x-full'
        )}
        aria-hidden={!salaryExplainerOpen}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
          <div>
            <h2 className="text-base font-semibold text-slate-800">Salary Explainer</h2>
            <p className="text-xs text-slate-500">AI-powered breakdown · Ctrl+Shift+E</p>
          </div>
          <button
            onClick={closeSalaryExplainer}
            className="p-1.5 hover:bg-slate-100 rounded text-slate-500 hover:text-slate-700"
            title="Close"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Input block */}
        <div className="px-4 py-3 border-b border-slate-200 space-y-3">
          <div className="relative" ref={searchBoxRef}>
            <input
              type="text"
              value={search}
              onChange={e => {
                setSearch(e.target.value)
                setShowDropdown(true)
                if (selectedEmp && e.target.value !== `${selectedEmp.code} - ${selectedEmp.name}`) {
                  setSelectedEmp(null)
                }
              }}
              onFocus={() => setShowDropdown(true)}
              placeholder="Employee code or name..."
              className="w-full px-3 py-2 pr-8 border border-slate-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            {search && (
              <button
                onClick={handleClearEmployee}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-sm"
                title="Clear"
                type="button"
              >
                ✕
              </button>
            )}
            {showDropdown && searchResults.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded shadow-lg max-h-60 overflow-y-auto z-20">
                {searchResults.map(emp => (
                  <button
                    key={emp.code}
                    type="button"
                    onClick={() => handleSelectEmployee(emp)}
                    className="w-full text-left px-3 py-2 hover:bg-blue-50 border-b border-slate-100 last:border-b-0 text-sm"
                  >
                    <div className="font-medium text-slate-800">
                      {emp.code} — {emp.name}
                    </div>
                    <div className="text-xs text-slate-500">
                      {emp.department || '—'} · {emp.company || '—'}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <select
              value={month}
              onChange={e => setMonth(parseInt(e.target.value))}
              className="px-2 py-2 border border-slate-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {MONTHS.map((m, i) => (
                <option key={i} value={i + 1}>{m}</option>
              ))}
            </select>
            <select
              value={year}
              onChange={e => setYear(parseInt(e.target.value))}
              className="px-2 py-2 border border-slate-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {yearOptions.map(y => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>

          <button
            onClick={handleExplain}
            disabled={loading || !selectedEmp}
            className={clsx(
              'w-full px-4 py-2 rounded font-medium text-sm transition-colors flex items-center justify-center gap-2',
              loading || !selectedEmp
                ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                : 'bg-blue-600 hover:bg-blue-700 text-white'
            )}
          >
            {loading ? (
              <>
                <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                <span>Analyzing…</span>
              </>
            ) : (
              <>
                <span>🤖</span>
                <span>Explain Salary</span>
              </>
            )}
          </button>
        </div>

        {/* Result area */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
          {!loading && !result && !errorMsg && (
            <div className="text-center text-sm text-slate-500 mt-8">
              <div className="text-3xl mb-2">💬</div>
              <div className="font-medium">Pick an employee and month</div>
              <div className="text-xs mt-1">Get a plain-language breakdown in seconds</div>
            </div>
          )}

          {loading && <LoadingSkeleton />}

          {errorMsg && !result && (
            <div className="bg-rose-50 border border-rose-200 text-rose-800 p-3 rounded text-sm">
              {errorMsg}
            </div>
          )}

          {result && (
            <>
              {/* Result header */}
              {result.data_summary && (
                <div className="border-b border-slate-200 pb-3">
                  <div className="font-semibold text-slate-800">
                    {result.data_summary.employee.name}
                    <span className="text-slate-500 font-normal ml-2">
                      ({result.data_summary.employee.code})
                    </span>
                  </div>
                  <div className="text-xs text-slate-500">
                    {result.data_summary.employee.department || '—'} ·{' '}
                    {result.data_summary.employee.company || '—'}
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    {result.data_summary.period.label}
                    {result.cached && (
                      <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 text-[10px]">
                        cached
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* Graceful-fallback banner */}
              {errorMsg && (
                <div className="bg-amber-50 border border-amber-200 text-amber-800 p-2.5 rounded text-xs">
                  {errorMsg}
                </div>
              )}

              {/* AI narrative sections */}
              {sections.length > 0 && (
                <div className="space-y-3">
                  {sections.map((sec, i) => (
                    <div key={i}>
                      <div className="text-xs font-semibold uppercase tracking-wide text-blue-700 mb-1">
                        {sec.title}
                      </div>
                      <div className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">
                        {sec.body}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Always-visible structured fallback */}
              <QuickNumbersCard summary={result.data_summary} />
            </>
          )}
        </div>
      </aside>
    </>
  )
}
