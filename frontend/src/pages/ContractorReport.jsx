// Contractor Report — read-only page. (PR-2, Sep 2026)
//
// Four tabs: Day Report, Daily Wage Register, Grid View, Exceptions.
// There is deliberately NO Commission tab and no Excel button: contractor
// commission rates are admin-set in the contractor master and are a later PR
// (AMENDMENT 1, 19 Sep 2026). Light theme only.
//
// Nothing on this page writes. Every call is a GET.
import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAppStore } from '../store/appStore'
import { getContractorMonthReport, getContractorGridReport } from '../utils/api'
import DayReportTab from '../components/contractorReport/DayReportTab'
import DailyWageRegisterTab from '../components/contractorReport/DailyWageRegisterTab'
import GridViewTab from '../components/contractorReport/GridViewTab'
import ExceptionsTab from '../components/contractorReport/ExceptionsTab'
import {
  money, days1, int, monthLabel, MONTHS, StatCard, Segmented,
  UnknownCompanyBanner, Loading, ErrorState,
} from '../components/contractorReport/shared'

const YEARS = [2024, 2025, 2026, 2027, 2028, 2029, 2030]
const DEFAULT_CONTRACTOR = 'Meera'

const TABS = [
  { value: 'day', label: 'Day Report' },
  { value: 'register', label: 'Daily Wage Register' },
  { value: 'grid', label: 'Grid View' },
  { value: 'exceptions', label: 'Exceptions' },
]

const ALLOWED_ROLES = ['hr', 'finance', 'admin']

export default function ContractorReport() {
  const { user, selectedMonth, selectedYear, selectedCompany } = useAppStore()
  const allowed = ALLOWED_ROLES.includes(user?.role)

  const [month, setMonth] = useState(selectedMonth || new Date().getMonth() + 1)
  const [year, setYear] = useState(selectedYear || new Date().getFullYear())
  const [contractor, setContractor] = useState('')
  const [tab, setTab] = useState('day')
  const [date, setDate] = useState(null)
  const [openContractor, setOpenContractor] = useState(null)
  const [gridContractor, setGridContractor] = useState(DEFAULT_CONTRACTOR)

  const company = selectedCompany || ''

  const { data: res, isLoading, error } = useQuery({
    queryKey: ['contractor-report-month', month, year, company],
    queryFn: () => getContractorMonthReport({ month, year, company: company || undefined }),
    enabled: allowed,
  })
  const report = res?.data?.data

  // Keep the day picker inside the month being viewed.
  useEffect(() => {
    if (!report?.days?.length) return
    if (!date || !report.days.some((d) => d.date === date)) setDate(report.days[0].date)
  }, [report, date])

  // A contractor chosen in the header may not exist in another month.
  useEffect(() => {
    if (report && contractor && !report.contractors.includes(contractor)) setContractor('')
  }, [report, contractor])

  // Grid defaults to Meera, falling back to whoever is biggest that month.
  useEffect(() => {
    if (!report?.contractors?.length) return
    const wanted = contractor || gridContractor
    if (report.contractors.includes(wanted)) {
      if (gridContractor !== wanted) setGridContractor(wanted)
    } else {
      setGridContractor(report.contractors[0])
    }
  }, [report, contractor]) // eslint-disable-line react-hooks/exhaustive-deps

  const {
    data: gridRes, isLoading: gridLoading, error: gridError,
  } = useQuery({
    queryKey: ['contractor-report-grid', month, year, gridContractor, company],
    queryFn: () => getContractorGridReport({ month, year, contractor: gridContractor, company: company || undefined }),
    enabled: allowed && tab === 'grid' && !!gridContractor,
  })
  const grid = gridRes?.data?.data

  const stats = useMemo(() => {
    if (!report) return null
    if (!contractor) return report.totals.stats
    const t = report.totals.perContractor[contractor]
    if (!t) return report.totals.stats
    const both = report.exceptions.both.filter((o) => o.contractor === contractor).length
    return { ...t, bothSourceDays: both }
  }, [report, contractor])

  const exceptionCount = useMemo(() => {
    if (!report) return 0
    if (!contractor) return report.exceptions.count
    const x = report.exceptions
    const keep = (o) => o.contractor === contractor
    return x.both.filter(keep).length + x.dup.filter(keep).length + x.pre.filter(keep).length +
      x.tie.filter(keep).length + x.aft.filter(keep).length + x.nodoj.filter(keep).length +
      x.pend.filter(keep).length
  }, [report, contractor])


  const openDay = (d, c = null) => {
    setDate(d)
    setOpenContractor(c)
    setTab('day')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // Same shape as the SQL Console's admin gate. The backend enforces this too
  // (every endpoint is HR/finance/admin); this is the client-side courtesy so a
  // viewer who types the URL gets the app's normal denial state, not a page that
  // renders and then fails three API calls.
  if (!allowed) {
    return (
      <div className="p-8 max-w-2xl mx-auto">
        <div className="bg-red-50 border border-red-300 rounded p-4 text-red-800">
          <h2 className="font-semibold mb-1">HR, finance, or admin access required</h2>
          <p className="text-sm">The Contractor Report is restricted to HR, finance and admin users.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 md:p-6 space-y-5">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="section-title">Contractor Report</h1>
          <p className="section-subtitle">
            Biometric attendance and daily-wage gate entries for contract labour, side by side.
            {report ? ` ${monthLabel(report.month)} ${report.year}.` : ''}
          </p>
        </div>
        <div className="flex items-end gap-3 flex-wrap">
          <div>
            <label className="label" htmlFor="cr-month">Month</label>
            <select id="cr-month" className="select w-36" value={month} onChange={(e) => setMonth(Number(e.target.value))}>
              {MONTHS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="cr-year">Year</label>
            <select id="cr-year" className="select w-28" value={year} onChange={(e) => setYear(Number(e.target.value))}>
              {YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="cr-contractor">Contractor</label>
            <select
              id="cr-contractor" className="select w-52" value={contractor}
              onChange={(e) => { setContractor(e.target.value); setOpenContractor(null) }}
            >
              <option value="">All contractors</option>
              {(report?.contractors || []).map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>
      </div>

      {report && (
        <UnknownCompanyBanner ratio={report.unknownCompanyRatio} month={report.month} company={company} />
      )}

      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
          <StatCard label="Biometric man-days" value={days1(stats.manDays)} accent="border-l-blue-400" />
          <StatCard label="Day shift" value={days1(stats.manDaysDay)} accent="border-l-amber-400" />
          <StatCard label="Night shift" value={days1(stats.manDaysNight)} accent="border-l-purple-400" />
          <StatCard label="Daily-wage worker-days" value={int(stats.dwHeads)} accent="border-l-slate-400" />
          <StatCard label="Daily-wage cost" value={money(stats.dwCost)} accent="border-l-emerald-400" />
          <StatCard
            label="Both-source days" value={int(stats.bothSourceDays || 0)}
            accent="border-l-red-400" alert={(stats.bothSourceDays || 0) > 0}
          />
        </div>
      )}

      <div role="tablist" className="flex gap-1 bg-slate-100 rounded-xl p-1 w-fit">
        {TABS.map((t) => (
          <button
            key={t.value} role="tab" type="button" aria-selected={tab === t.value}
            onClick={() => setTab(t.value)}
            className={[
              'px-5 py-2 text-sm font-semibold rounded-lg transition-all inline-flex items-center gap-2',
              tab === t.value ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-700',
            ].join(' ')}
          >
            {t.label}
            {t.value === 'exceptions' && exceptionCount > 0 && (
              <span className="badge-red px-1.5 py-0">{exceptionCount}</span>
            )}
          </button>
        ))}
      </div>

      {isLoading && <div className="card"><Loading label="Loading the month…" /></div>}
      {error && <div className="card"><ErrorState error={error} /></div>}

      {!isLoading && !error && report && (
        <>
          {tab === 'day' && (
            <DayReportTab
              date={date} setDate={setDate} days={report.days} company={company}
              openContractor={openContractor} setOpenContractor={setOpenContractor}
            />
          )}
          {tab === 'register' && (
            <DailyWageRegisterTab report={report} contractor={contractor} onOpenDay={openDay} />
          )}
          {tab === 'grid' && (
            <GridViewTab
              report={grid} isLoading={gridLoading} error={gridError}
              contractor={gridContractor} contractors={report.contractors}
              setContractor={setGridContractor} onOpenDay={openDay}
            />
          )}
          {tab === 'exceptions' && (
            <ExceptionsTab report={report} contractor={contractor} onOpenDay={openDay} />
          )}
        </>
      )}
    </div>
  )
}
