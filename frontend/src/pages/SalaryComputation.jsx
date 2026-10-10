import React, { useState, useMemo, useLayoutEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { getSalaryRegister, computeSalary, finaliseSalary, getPayslip, getMonthEndChecklist, getSalaryComparison, downloadSalarySlipExcel, releaseHeldSalary, getDayCalcStaleness, getSalaryStale, getLoanPayslipBalance } from '../utils/api'
import { useAppStore } from '../store/appStore'
import CompanyFilter from '../components/shared/CompanyFilter'
import DateSelector from '../components/common/DateSelector'
import useDateSelector from '../hooks/useDateSelector'
import PipelineProgress from '../components/pipeline/PipelineProgress'
import { fmtINR, monthYearLabel } from '../utils/formatters'
import { normalizeRole } from '../utils/role'
import { Abbr } from '../components/ui/Tooltip'
import AbbreviationLegend from '../components/ui/AbbreviationLegend'
import CalendarView from '../components/ui/CalendarView'
import Modal, { ModalBody, ModalFooter } from '../components/ui/Modal'
import clsx from 'clsx'
import DrillDownRow, { DrillDownChevron } from '../components/ui/DrillDownRow'
import EmployeeQuickView from '../components/ui/EmployeeQuickView'
import api from '../utils/api'
import { downloadPayslipPDF } from '../utils/payslipPdf'
import ConfirmDialog from '../components/ui/ConfirmDialog'
import { canFinance as canFinanceFn } from '../utils/role'
import ReleaseHoldModal from '../components/ui/ReleaseHoldModal'

export default function SalaryComputation() {
  const { month, year, dateProps } = useDateSelector({ mode: 'month', syncToStore: true })
  const { selectedCompany, user } = useAppStore()
  // Salary never recomputes by itself (owner ruling 5). Stage 6 marks its rows
  // salary_stale and this banner is how HR finds out.
  const [staleOpen, setStaleOpen] = useState(false)
  const [overrideReason, setOverrideReason] = useState('')
  const [showOverride, setShowOverride] = useState(false)
  const qc = useQueryClient()
  // Held-salary release is gated to finance/admin on the backend; mirror
  // that here so HR users don't see a Release button they can't actually
  // click. Both pages (Stage 7 + Finance Verify) use the same gate.
  const canFinance = canFinanceFn(user)
  const [showDetails, setShowDetails] = useState(null)
  const [calendarEmployee, setCalendarEmployee] = useState(null)
  const [payslipEmployee, setPayslipEmployee] = useState(null)
  const [filterDept, setFilterDept] = useState('')
  // Initial filter view honours ?filter=held deep-link from Finance
  // Verification → Held Salaries tab so the cross-page navigation
  // lands on the held rows immediately.
  const [searchParams] = useSearchParams()
  const [filterView, setFilterView] = useState(searchParams.get('filter') === 'held' ? 'held' : 'all')
  const [searchQuery, setSearchQuery] = useState('')
  const [confirmAction, setConfirmAction] = useState(null)
  const [sortCol, setSortCol] = useState('')
  const [sortDir, setSortDir] = useState('asc')
  const toggleSort = (col) => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('desc') }
  }
  const sortIndicator = (col) => sortCol === col ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''

  const { data: res, isLoading, refetch } = useQuery({
    queryKey: ['salary-register', month, year, selectedCompany],
    queryFn: () => getSalaryRegister(month, year, selectedCompany),
    retry: 0
  })

  const allSalaries = res?.data?.data || []

  const salaries = useMemo(() => {
    let filtered = allSalaries
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      filtered = filtered.filter(s =>
        (s.employee_name || '').toLowerCase().includes(q) ||
        (s.employee_code || '').toLowerCase().includes(q) ||
        (s.department || '').toLowerCase().includes(q)
      )
    }
    if (filterDept) filtered = filtered.filter(s => s.department?.toLowerCase().includes(filterDept.toLowerCase()))
    if (filterView === 'held') filtered = filtered.filter(s => s.salary_held)
    if (filterView === 'changed') filtered = filtered.filter(s => s.gross_changed)
    if (filterView === 'active') filtered = filtered.filter(s => !s.salary_held)
    if (filterView === 'returning') filtered = filtered.filter(s => s.was_left_returned)
    if (filterView === 'newjoiners') {
      filtered = filtered.filter(s => {
        if (!s?.date_of_joining) return false
        const doj = new Date(s.date_of_joining + 'T12:00:00')
        if (isNaN(doj)) return false
        const ps = new Date(year, month - 1, 1)
        const pe = new Date(year, month, 0)
        return doj >= ps && doj <= pe
      })
    }
    return filtered
  }, [allSalaries, filterDept, filterView, searchQuery, month, year])

  const [computeResult, setComputeResult] = useState(null)
  const computeMutation = useMutation({
    mutationFn: () => computeSalary({ month: month, year: year, company: selectedCompany }),
    onSuccess: (r) => {
      const d = r.data
      setComputeResult(d)
      if (d.processed > 0) {
        let msg = `Salary computed for ${d.processed} employees`
        if (d.held?.length) msg += ` | ${d.held.length} held`
        toast.success(msg)
      }
      if (d.excluded?.length) {
        toast(`${d.excluded.length} employee(s) skipped — missing salary structure or day calculation`, { icon: '⚠️', duration: 6000 })
      }
      if (d.errors > 0) {
        toast.error(`${d.errors} error(s) during computation`)
      }
      if (d.processed === 0 && !d.excluded?.length && d.errors === 0) {
        toast.error('No employees found. Ensure Day Calculation (Stage 6) is complete.')
      }
      refetch()
    }
  })

  const { data: staleRes } = useQuery({
    queryKey: ['salary-stale', month, year, selectedCompany],
    queryFn: () => getSalaryStale({ month, year, company: selectedCompany || undefined }),
    refetchInterval: 60 * 1000,
    retry: 0,
  })
  const staleCodes = staleRes?.data?.employeeCodes || []
  const staleCount = staleRes?.data?.count || 0
  const isAdmin = normalizeRole(user?.role) === 'admin'

  const finaliseMutation = useMutation({
    mutationFn: (opts = {}) => finaliseSalary({ month: month, year: year, company: selectedCompany, ...opts }),
    onSuccess: () => { toast.success('Salary finalised!'); refetch() }
  })

  // April 2026: the hold-release endpoint is now gated by requireFinanceOrAdmin
  // AND requires release_notes (paper-verification reference). The button opens
  // the shared ReleaseHoldModal — same flow used by the Finance Verify Held tab
  // and the new Held Salaries Register. Every release writes a row to
  // salary_hold_releases so there's a queryable audit trail.
  const [releaseEmployee, setReleaseEmployee] = useState(null)
  const releaseHoldMutation = useMutation({
    mutationFn: ({ code, notes }) => api.put(`/payroll/salary/${code}/hold-release`, {
      month, year, company: selectedCompany, release_notes: notes
    }),
    onSuccess: () => {
      toast.success('Salary hold released — audit row recorded')
      setReleaseEmployee(null)
      refetch()
      qc.invalidateQueries({ queryKey: ['fin-held'] })
      qc.invalidateQueries({ queryKey: ['held-register-current'] })
      qc.invalidateQueries({ queryKey: ['held-register-history'] })
    },
    onError: (e) => toast.error(e?.response?.data?.error || 'Release failed')
  })

  const { data: payslipRes } = useQuery({
    queryKey: ['payslip', payslipEmployee, month, year],
    queryFn: () => getPayslip(payslipEmployee, month, year),
    enabled: !!payslipEmployee
  })
  const payslip = payslipRes?.data?.data
  // Loans PR-9: the payslip's loan balance line is a separate read; any error
  // (or a role without loan access) simply shows no line.
  const { data: loanBalRes } = useQuery({
    queryKey: ['payslip-loan-balance', payslipEmployee, month, year],
    queryFn: () => getLoanPayslipBalance({ payroll: 'plant', employeeCode: payslipEmployee, month, year }),
    enabled: !!payslipEmployee,
    retry: 0
  })
  const loanBalance = loanBalRes?.data?.data?.show ? loanBalRes.data.data : null

  // April 2026: day-calc staleness check for the "Recompute Stage 6"
  // banner. Salary Computation is downstream of Stage 6, so if Stage 6
  // is stale, Stage 7 numbers are also stale. Read-only here — the
  // recompute action lives on the Stage 6 page (link supplied).
  const { data: stalenessRes } = useQuery({
    queryKey: ['day-calc-staleness', month, year, selectedCompany],
    queryFn: () => getDayCalcStaleness(month, year, selectedCompany || undefined),
    refetchInterval: 30000,
    retry: 0
  })
  const staleness = stalenessRes?.data || {}

  // Month-end checklist
  const { data: checklistRes } = useQuery({
    queryKey: ['month-end-checklist', month, year, selectedCompany],
    queryFn: () => getMonthEndChecklist(month, year, selectedCompany),
    retry: 0
  })
  const checklist = checklistRes?.data?.data || []
  const checklistSummary = checklistRes?.data?.summary || {}
  // Passed checks fold into one line; warnings / errors always shown (display only).
  const [showPassed, setShowPassed] = useState(false)
  const checklistPassed = checklist.filter(i => i.status === 'ok')
  const checklistOpen = checklist.filter(i => i.status !== 'ok')
  const renderCheckItem = (item) => (
    <div key={item.id} className={clsx('px-3 py-2 rounded-lg text-xs', item.status === 'ok' && 'bg-green-50', item.status === 'warning' && 'bg-amber-50', item.status === 'error' && 'bg-red-50')}>
      <div className="flex items-center gap-2">
        <span>{item.status === 'ok' ? '✅' : item.status === 'warning' ? '⚠️' : '❌'}</span>
        <div className="flex-1">
          <span className="font-medium">{item.label}</span>
          {item.count > 0 && item.status !== 'ok' && <span className="ml-1 text-slate-500">({item.count})</span>}
        </div>
        {item.link && item.status !== 'ok' && (
          <a href={item.link} className="text-blue-600 hover:underline text-xs shrink-0">Fix</a>
        )}
      </div>
      {item.detail && item.status !== 'ok' && (
        <div className="mt-1 ml-6 text-[11px] text-slate-500 leading-snug">{item.detail}</div>
      )}
    </div>
  )

  // Salary comparison
  const [showComparison, setShowComparison] = useState(false)
  const { data: comparisonRes, isLoading: comparisonLoading } = useQuery({
    queryKey: ['salary-comparison', month, year, selectedCompany],
    queryFn: () => getSalaryComparison(month, year, selectedCompany),
    enabled: showComparison,
    retry: 0
  })
  const comparisonData = comparisonRes?.data?.data || []
  const comparisonSummary = comparisonRes?.data?.summary || {}

  const [pdfLoading, setPdfLoading] = useState(false)
  async function handleDownloadPayslip() {
    if (!payslip) return
    setPdfLoading(true)
    try {
      await downloadPayslipPDF(payslip, null, loanBalance)
      toast.success('Payslip PDF downloaded')
    } catch { toast.error('PDF generation failed') }
    finally { setPdfLoading(false) }
  }

  const [excelLoading, setExcelLoading] = useState(false)
  async function handleExcelSlip() {
    setExcelLoading(true)
    try {
      const res = await downloadSalarySlipExcel(month, year, selectedCompany)
      const blob = new Blob([res.data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `Salary_Slip_${month}_${year}.xlsx`
      a.click()
      URL.revokeObjectURL(url)
      toast.success('Salary slip Excel downloaded')
    } catch { toast.error('Excel generation failed') }
    finally { setExcelLoading(false) }
  }

  const [registerLoading, setRegisterLoading] = useState(false)
  async function handleDownloadRegister() {
    setRegisterLoading(true)
    try {
      const res = await api.get('/payroll/salary-register-excel', {
        params: { month, year, company: selectedCompany || undefined },
        responseType: 'blob'
      })
      const blob = new Blob([res.data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `Payroll_Register_${month}_${year}.xlsx`
      a.click()
      URL.revokeObjectURL(url)
      toast.success('Payroll register downloaded')
    } catch { toast.error('Register download failed') }
    finally { setRegisterLoading(false) }
  }

  const computedTotals = useMemo(() => {
    const active = allSalaries.filter(s => !s.salary_held)
    return {
      gross: allSalaries.reduce((s, r) => s + (r.gross_earned || 0), 0),
      pf: allSalaries.reduce((s, r) => s + (r.pf_employee || 0) + (r.pf_employer || 0), 0),
      esi: allSalaries.reduce((s, r) => s + (r.esi_employee || 0) + (r.esi_employer || 0), 0),
      net: active.reduce((s, r) => s + (r.net_salary || 0), 0),
      heldNet: allSalaries.filter(s => s.salary_held).reduce((s, r) => s + (r.net_salary || 0), 0),
      otPay: allSalaries.reduce((s, r) => s + (r.ot_pay || 0), 0),
      edPay: allSalaries.reduce((s, r) => s + (r.ed_pay || 0), 0),
      takeHome: active.reduce((s, r) => s + (r.take_home || r.total_payable || r.net_salary || 0), 0),
      edEmployees: allSalaries.filter(s => (s.ed_pay || 0) > 0).length,
    }
  }, [allSalaries])

  const heldCount = allSalaries.filter(s => s.salary_held).length
  const changedCount = allSalaries.filter(s => s.gross_changed).length
  const returningCount = allSalaries.filter(s => s.was_left_returned).length

  // ── DOJ helpers (April 2026) ──────────────────────────────────
  // A "new joiner" is anyone who joined within the current period and
  // therefore got pre-DOJ holidays excluded from their pay.
  const isNewJoinerForPeriod = (s) => {
    if (!s?.date_of_joining) return false
    const doj = new Date(s.date_of_joining + 'T12:00:00')
    if (isNaN(doj)) return false
    const periodStart = new Date(year, month - 1, 1)
    const periodEnd = new Date(year, month, 0)
    return doj >= periodStart && doj <= periodEnd
  }
  const fmtDOJ = (iso) => {
    if (!iso) return '—'
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
    if (!m) return iso
    return `${m[3]}/${m[2]}/${m[1]}`
  }
  const newJoinerCount = allSalaries.filter(isNewJoinerForPeriod).length

  // ── Salary register: column model (display only) ─────────────────────
  // One list drives the header, body cells, totals row and the drill-down
  // colSpan, so hiding a column can never leave them out of step.
  const REG_VIEWS = [
    { key: 'review', label: 'Review', title: 'Employee, days, gross, earned, OT/ED, deductions, net, take home' },
    { key: 'statutory', label: 'Statutory', title: 'Review + PF, ESI, LWF' },
    { key: 'all', label: 'Everything', title: 'Every column' },
  ]
  const R = ['review', 'statutory', 'all'], S = ['statutory', 'all'], A = ['all']
  const REG_VIEW_KEY = 'salreg.view.v1'
  const [regView, setRegView] = useState(() => {
    try {
      const v = window.localStorage.getItem(REG_VIEW_KEY)
      if (v === 'review' || v === 'statutory' || v === 'all') return v
    } catch { /* storage blocked — fall through to the width default */ }
    return (typeof window !== 'undefined' && window.innerWidth < 768) ? 'review' : 'all'
  })
  const chooseRegView = (v) => {
    setRegView(v)
    try { window.localStorage.setItem(REG_VIEW_KEY, v) } catch { /* not remembered; still switches */ }
  }
  const sumOf = (rows, f) => rows.reduce((t, r) => t + (f(r) || 0), 0)
  const takeHomeOf = (r) => r.take_home || r.total_payable || r.net_salary
  const muted = (v, cls) => (v ? cls : 'salreg-mute')
  const pill = 'inline-block max-w-full truncate align-middle text-[10px] leading-4 px-1.5 rounded border'
  const isCont = (s) => {
    // Prefer live employment_type from employee master over the stale
    // is_contractor on the salary_computations row.
    const empType = String(s.employment_type || '').trim().toLowerCase()
    return empType ? empType.includes('contract') : !!s.is_contractor
  }
  const heldTitle = (s) => (s.salary_held ? `Held: ${s.hold_reason || 'No reason specified'}` : undefined)
  const leaveCol = (key, label, field, title, txt, onCls) => ({
    key, label, sort: field, title, views: A, thCls: `!${txt} text-center`,
    tdCls: (s) => clsx('text-center font-mono', (s[field] || 0) > 0 ? `${onCls} ${txt} font-semibold` : 'salreg-mute'),
    render: (s) => ((s[field] || 0) > 0 ? s[field] : '—'),
    footCls: `font-mono text-center ${txt}`,
    foot: (rows) => sumOf(rows, r => r[field]) || '—',
  })
  const REG_COLS = [
    { key: 'emp', label: 'Emp', sort: 'employee_name', views: R, pin: 'l', w: 280, edge: 'r',
      render: (s, expanded) => (
        <div className="flex items-start gap-1.5 min-w-0">
          <span className="pt-px"><DrillDownChevron isExpanded={expanded} /></span>
          <div className="min-w-0 flex-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
            <span className="font-medium text-[12px] text-slate-800 truncate max-w-[150px]" title={s.employee_name || s.employee_code}>{s.employee_name || s.employee_code}</span>
            <span className="text-[10px] text-slate-400 font-mono shrink-0">{s.employee_code}</span>
            {s.gross_changed ? (
              <span className={clsx(pill, 'max-w-[150px] bg-blue-50 text-blue-700 border-blue-200')} title={`Gross changed: ${fmtINR(s.prev_month_gross)} → ${fmtINR(s.gross_salary)}`}>
                Gross {fmtINR(s.prev_month_gross)} → {fmtINR(s.gross_salary)}
              </span>
            ) : null}
            {s.was_left_returned ? (
              <span className={clsx(pill, 'bg-orange-50 text-orange-700 border-orange-200')} title="Returning — was previously marked as Left">Returning</span>
            ) : null}
            {isNewJoinerForPeriod(s) ? (
              <span className={clsx(pill, 'max-w-[150px] bg-emerald-50 text-emerald-700 border-emerald-200')}
                title={`New Joiner — DOJ ${fmtDOJ(s.date_of_joining)}${s.holidays_before_doj > 0 ? ` (${s.holidays_before_doj} holiday${s.holidays_before_doj > 1 ? 's' : ''} excluded)` : ''}`}>
                New Joiner {fmtDOJ(s.date_of_joining)}{s.holidays_before_doj > 0 && ` (${s.holidays_before_doj} hol. excl.)`}
              </span>
            ) : null}
            {s.salary_held ? (
              <span className={clsx(pill, 'max-w-[170px] bg-red-50 text-red-700 border-red-200')} title={`Held: ${s.hold_reason || ''}`} data-testid="held-reason">
                Held: {s.hold_reason}
              </span>
            ) : null}
            {s.finance_remark && !s.salary_held ? (
              <span className={clsx(pill, 'max-w-[170px] bg-yellow-50 text-yellow-700 border-yellow-200')} title={s.finance_remark}>{s.finance_remark}</span>
            ) : null}
          </div>
        </div>
      ),
      footCls: 'whitespace-nowrap', foot: (rows) => `Totals — ${rows.length} shown`,
    },
    { key: 'dept', label: 'Dept', sort: 'department', views: R, tdCls: () => 'text-slate-500',
      render: (s) => (
        <div className="flex items-center gap-1 min-w-0 max-w-[200px]">
          <span className="truncate" title={s.department || ''}>{s.department}</span>
          {isCont(s) ? <span className="shrink-0 text-[9px] px-1 py-0.5 rounded bg-amber-100 text-amber-700">CONT</span> : null}
        </div>
      ),
    },
    { key: 'doj', label: 'DOJ', sort: 'date_of_joining', title: 'Date of Joining', views: A,
      tdCls: () => 'text-slate-500 font-mono text-[10px] whitespace-nowrap', tdTitle: (s) => s.date_of_joining || '',
      render: (s) => fmtDOJ(s.date_of_joining) },
    { key: 'days', label: 'Days', sort: 'payable_days', views: R, thCls: 'text-center',
      tdCls: () => 'text-center font-mono whitespace-nowrap',
      render: (s) => (
        <>
          {s.payable_days}
          {(s.ot_days || 0) > 0 && (
            <span className="ml-1 text-[9px] text-cyan-600">{s.regular_days || s.payable_days}+{s.ot_days} OT</span>
          )}
        </>
      ) },
    { key: 'gross', label: 'Gross', sort: 'gross_salary', views: R, title: 'Monthly gross salary',
      tdCls: (s) => clsx('font-mono whitespace-nowrap', muted(s.gross_salary, '')),
      render: (s) => fmtINR(s.gross_salary),
      footCls: 'font-mono whitespace-nowrap', foot: (rows) => fmtINR(sumOf(rows, r => r.gross_salary)) },
    { key: 'earned', label: 'Earned', sort: 'gross_earned', views: R,
      tdCls: (s) => clsx('font-mono whitespace-nowrap', muted(s.gross_earned, '')),
      render: (s) => fmtINR(s.gross_earned),
      footCls: 'font-mono whitespace-nowrap', footTitle: 'Sum of Earned — equals the Total Gross card when the filter is All',
      foot: (rows) => fmtINR(sumOf(rows, r => r.gross_earned)) },
    { key: 'oted', label: 'OT / ED', sort: 'ot_pay', title: 'OT (punch-detected) and ED (finance-approved grants), shown separately', views: R,
      tdCls: () => 'font-mono whitespace-nowrap',
      render: (s) => (
        <>
          {(s.ot_pay || 0) > 0 && (
            <div className="text-cyan-600">
              {fmtINR(s.ot_pay)} <span className="text-[9px] text-slate-400">OT {s.ot_days || 0}×{fmtINR(s.ot_daily_rate || 0)}</span>
            </div>
          )}
          {(s.ed_pay || 0) > 0 && (
            <div className="text-purple-600">
              {fmtINR(s.ed_pay)} <span className="text-[9px] text-slate-400">ED {s.ed_days || 0}×{fmtINR(s.ot_daily_rate || 0)}</span>
            </div>
          )}
          {!(s.ot_pay || 0) && !(s.ed_pay || 0) && '—'}
        </>
      ),
      footCls: 'font-mono whitespace-nowrap',
      foot: (rows) => (
        <>
          <div className="text-cyan-600">OT {fmtINR(sumOf(rows, r => r.ot_pay))}</div>
          <div className="text-purple-600">ED {fmtINR(sumOf(rows, r => r.ed_pay))}</div>
        </>
      ) },
    { key: 'pf', label: 'PF', sort: 'pf_employee', views: S,
      tdCls: (s) => clsx('font-mono whitespace-nowrap', muted(s.pf_employee, 'text-indigo-600')),
      render: (s) => fmtINR(s.pf_employee),
      footCls: 'font-mono whitespace-nowrap text-indigo-600', foot: (rows) => fmtINR(sumOf(rows, r => r.pf_employee)) },
    { key: 'esi', label: 'ESI', sort: 'esi_employee', views: S,
      tdCls: (s) => clsx('font-mono whitespace-nowrap', muted(s.esi_employee, 'text-purple-600')),
      render: (s) => fmtINR(s.esi_employee),
      footCls: 'font-mono whitespace-nowrap text-purple-600', foot: (rows) => fmtINR(sumOf(rows, r => r.esi_employee)) },
    { key: 'lwf', label: 'LWF', sort: 'lwf_employee', views: S,
      title: 'Punjab Labour Welfare Fund — employee share (employer share in the drill-down)',
      tdCls: (s) => clsx('font-mono whitespace-nowrap', (s.lwf_employee || 0) > 0 ? 'text-teal-700' : 'salreg-mute-soft'),
      tdTitle: (s) => ((s.lwf_employee || 0) > 0 ? `LWF employee ${fmtINR(s.lwf_employee)} · employer ${fmtINR(s.lwf_employer || 0)}` : ''),
      render: (s) => ((s.lwf_employee || 0) > 0 ? fmtINR(s.lwf_employee) : '—'),
      footCls: 'font-mono whitespace-nowrap text-teal-700', foot: (rows) => fmtINR(sumOf(rows, r => r.lwf_employee)) },
    { key: 'adv', label: 'Adv', views: A,
      tdCls: (s) => clsx('font-mono whitespace-nowrap', muted(s.advance_recovery, '')),
      render: (s) => fmtINR(s.advance_recovery),
      footCls: 'font-mono whitespace-nowrap', foot: (rows) => fmtINR(sumOf(rows, r => r.advance_recovery)) },
    { key: 'loan', label: 'Loan', views: A,
      tdCls: (s) => clsx('font-mono whitespace-nowrap', muted(s.loan_recovery, '')),
      render: (s) => fmtINR(s.loan_recovery),
      footCls: 'font-mono whitespace-nowrap', foot: (rows) => fmtINR(sumOf(rows, r => r.loan_recovery)) },
    { key: 'late', label: 'Late', sort: 'late_coming_deduction', title: 'Finance-approved late coming deduction', views: A,
      tdCls: (s) => clsx('font-mono whitespace-nowrap', (s.late_coming_deduction || 0) > 0 ? 'bg-amber-50 text-amber-700 font-semibold' : 'salreg-mute-soft'),
      tdTitle: (s) => ((s.late_coming_deduction || 0) > 0 ? 'Finance-approved late coming deduction' : ''),
      render: (s) => ((s.late_coming_deduction || 0) > 0 ? fmtINR(s.late_coming_deduction) : '—'),
      footCls: 'font-mono whitespace-nowrap text-amber-700', foot: (rows) => fmtINR(sumOf(rows, r => r.late_coming_deduction)) },
    { key: 'early', label: 'Early Exit', sort: 'early_exit_deduction', title: 'Finance-approved early exit deduction', views: A,
      tdCls: (s) => clsx('font-mono whitespace-nowrap', (s.early_exit_deduction || 0) > 0 ? 'bg-rose-50 text-rose-700 font-semibold' : 'salreg-mute-soft'),
      tdTitle: (s) => ((s.early_exit_deduction || 0) > 0 ? 'Finance-approved early exit deduction' : ''),
      render: (s) => ((s.early_exit_deduction || 0) > 0 ? fmtINR(s.early_exit_deduction) : '—'),
      footCls: 'font-mono whitespace-nowrap text-rose-700', foot: (rows) => fmtINR(sumOf(rows, r => r.early_exit_deduction)) },
    leaveCol('cl', 'CL', 'cl_days', 'Casual Leave days consumed this month', 'text-amber-700', 'bg-amber-50'),
    leaveCol('el', 'EL', 'el_days', 'Earned Leave days consumed this month', 'text-green-700', 'bg-green-50'),
    leaveCol('lwp', 'LWP', 'lwp_days', 'Leave Without Pay days', 'text-orange-700', 'bg-orange-50'),
    leaveCol('od', 'OD', 'od_days', 'On-Duty / Comp-Off days (finance approved)', 'text-blue-700', 'bg-blue-50'),
    leaveCol('sl', 'SL', 'short_leave_days', 'Short Leave (gate pass) days-equivalent', 'text-slate-700', 'bg-slate-100'),
    leaveCol('ua', 'UA', 'uninformed_absent_days', 'Uninformed Absent days', 'text-red-700', 'bg-red-50'),
    { key: 'ded', label: 'Ded', sort: 'total_deductions', views: R,
      tdCls: (s) => clsx('font-mono whitespace-nowrap', muted(s.total_deductions, 'text-red-600'), s.salary_held && 'cell-caution'),
      tdTitle: heldTitle, render: (s) => fmtINR(s.total_deductions),
      footCls: 'font-mono whitespace-nowrap text-red-600', foot: (rows) => fmtINR(sumOf(rows, r => r.total_deductions)) },
    { key: 'net', label: 'Net', sort: 'net_salary', views: R, pin: 'r', right: 328, w: 96, edge: 'l', pinCls: 'pin-net',
      title: 'Net = Gross Earned − Deductions (base only, no OT)', thCls: 'text-slate-600',
      tdCls: (s) => clsx('font-mono whitespace-nowrap', muted(s.net_salary, 'text-slate-700'), s.salary_held && 'cell-caution'),
      tdTitle: heldTitle, render: (s) => fmtINR(s.net_salary),
      footCls: 'font-mono whitespace-nowrap text-slate-700', footTitle: 'Held salaries are not included',
      foot: (rows) => fmtINR(sumOf(rows.filter(r => !r.salary_held), r => r.net_salary)) },
    { key: 'take', label: 'Take Home', sort: 'take_home', views: R, pin: 'r', right: 224, w: 104, pinCls: 'pin-take',
      title: 'Take Home = Net + OT + Holiday Duty + ED (actual amount paid)', thCls: 'text-emerald-700',
      tdCls: (s) => clsx('font-bold font-mono whitespace-nowrap', muted(takeHomeOf(s), 'text-emerald-700'), s.salary_held && 'cell-caution'),
      tdTitle: heldTitle, render: (s) => fmtINR(takeHomeOf(s)),
      footCls: 'font-mono whitespace-nowrap text-emerald-700',
      footTitle: 'Held salaries are not included — equals the Take Home card when the filter is All',
      foot: (rows) => fmtINR(sumOf(rows.filter(r => !r.salary_held), takeHomeOf)) },
    { key: 'status', label: '', views: R, pin: 'r', right: 104, w: 120,
      render: (s) => (
        s.is_finalised ? (
          <span className="badge-green text-xs">Final</span>
        ) : s.salary_held ? (
          <div className="flex items-center gap-1 whitespace-nowrap">
            <span className="inline-flex items-center gap-0.5 text-xs px-1.5 py-0.5 rounded bg-red-100 text-red-700 border border-red-200 font-semibold"
              title={`Held: ${s.hold_reason || 'No reason specified'}`}>
              <span aria-hidden="true">⚠</span> Held
            </span>
            {/* Release gated to finance/admin — matches requireFinanceOrAdmin
                on the backend. Opens the shared ReleaseHoldModal. */}
            {canFinance && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  setReleaseEmployee({
                    code: s.employee_code,
                    name: s.employee_name,
                    department: s.department,
                    hold_reason: s.hold_reason,
                    net_salary: s.net_salary,
                    month, year
                  })
                }}
                className="btn-ghost text-xs px-1 py-0.5 text-blue-600"
              >
                Release
              </button>
            )}
          </div>
        ) : (
          <span className="badge-yellow text-xs">Draft</span>
        )
      ) },
    { key: 'actions', label: '', views: R, pin: 'r', right: 0, w: 104,
      render: (s) => (
        <div className="flex items-center gap-0.5 whitespace-nowrap">
          <button onClick={() => setShowDetails(showDetails === s.employee_code ? null : s.employee_code)} className="btn-ghost text-xs px-1 py-0.5 text-blue-600">
            {showDetails === s.employee_code ? '▲' : '▼'}
          </button>
          <button onClick={() => setPayslipEmployee(s.employee_code)} className="btn-ghost text-xs px-1 py-0.5 text-slate-500" title="Payslip">
            Slip
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); setCalendarEmployee({ code: s.employee_code, name: s.employee_name || s.employee_code }); }}
            className="btn-ghost text-xs px-1 py-0.5 text-blue-600" title="Calendar"
          >
            Cal
          </button>
        </div>
      ) },
  ]
  const regVisible = REG_COLS.filter(c => c.views.includes(regView))
  const pinProps = (c, part, extra) => ({
    className: clsx(
      part === 'th' && c.thCls,
      part === 'th' && c.sort && 'cursor-pointer select-none',
      part === 'tf' && c.footCls,
      c.pin && 'pin', c.pin === 'l' && 'pin-l', c.pin === 'r' && 'pin-r',
      c.edge === 'r' && 'pin-edge-r', c.edge === 'l' && 'pin-edge-l', c.pinCls, extra
    ) || undefined,
    // Offsets/widths as CSS variables: only applied from md up (see .salreg in index.css),
    // so on phones nothing is pinned — not even the sticky header cells.
    style: c.pin ? { '--pin-off': `${c.pin === 'l' ? 0 : c.right}px`, '--pin-w': `${c.w}px` } : undefined,
  })
  const sortedSalaries = useMemo(() => [...salaries].sort((a, b) => {
    if (!sortCol) return 0;
    let va = a[sortCol] ?? '', vb = b[sortCol] ?? '';
    if (typeof va === 'string') { va = va.toLowerCase(); vb = (vb || '').toLowerCase(); }
    return va < vb ? (sortDir === 'asc' ? -1 : 1) : va > vb ? (sortDir === 'asc' ? 1 : -1) : 0;
  }), [salaries, sortCol, sortDir])
  // The drill-down sticks to the visible width of the register's scroll box.
  const regScrollRef = useRef(null)
  const [regBoxW, setRegBoxW] = useState(0)
  const hasRegRows = salaries.length > 0
  useLayoutEffect(() => {
    const el = regScrollRef.current
    if (!el) return undefined
    const update = () => setRegBoxW(el.clientWidth)
    update()
    if (typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [hasRegRows])

  return (
    <div className="animate-fade-in">
      <PipelineProgress stageStatus={{ 1:'done', 2:'done', 3:'done', 4:'done', 5:'done', 6:'done', 7:'active' }} />

      <div className="p-4 md:p-6 space-y-5 w-full min-w-0">
        {/* Header: title + actions on row 1 (wraps on phones), filters on row 2. */}
        <div className="space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="section-title">Stage 7: Salary Computation</h2>
              <p className="section-subtitle mt-1">{monthYearLabel(month, year)} — Compute, review, and finalise salary.</p>
            </div>
            <div className="flex flex-wrap gap-2" data-testid="stage7-actions">
              <button onClick={() => computeMutation.mutate()} disabled={computeMutation.isPending} className="btn-primary whitespace-nowrap">
                {computeMutation.isPending ? 'Computing...' : 'Compute Salary'}
              </button>
              {allSalaries.length > 0 && !allSalaries[0]?.is_finalised && (
                staleCount > 0 && !isAdmin ? (
                  <button
                    disabled
                    className="btn-success whitespace-nowrap opacity-50 cursor-not-allowed"
                    title={`${staleCount} employee(s) have a day calculation newer than their salary. Compute Salary first.`}
                  >
                    Finalise
                  </button>
                ) : staleCount > 0 && isAdmin ? (
                  <button onClick={() => setShowOverride(true)} className="btn-success whitespace-nowrap" title="Finalising with stale day calculations requires a reason">
                    Finalise (override)
                  </button>
                ) : (
                  <button onClick={() => setConfirmAction('finalise')} disabled={finaliseMutation.isPending} className="btn-success whitespace-nowrap">
                    {finaliseMutation.isPending ? 'Finalising...' : 'Finalise'}
                  </button>
                )
              )}
              {allSalaries.length > 0 && (
                <button onClick={handleExcelSlip} disabled={excelLoading}
                  className="px-3 py-2 text-sm bg-green-100 text-green-700 rounded-lg hover:bg-green-200 transition-colors font-medium whitespace-nowrap">
                  {excelLoading ? 'Generating...' : 'Salary Slip (Excel)'}
                </button>
              )}
              {allSalaries.length > 0 && (
                <button onClick={handleDownloadRegister} disabled={registerLoading}
                  className="px-3 py-2 text-sm bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200 transition-colors font-medium whitespace-nowrap"
                  title="Download full payroll register as Excel">
                  {registerLoading ? 'Generating...' : 'Download Register'}
                </button>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <CompanyFilter />
            <DateSelector {...dateProps} />
          </div>
        </div>

        {/* Skipped employees alert */}
        {computeResult?.excluded?.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
            <h4 className="font-semibold text-amber-800 text-sm">{computeResult.excluded.length} Employee(s) Skipped</h4>
            <p className="text-xs text-amber-600 mt-1">These employees were excluded from salary computation. Click "Set Salary" to add their salary structure.</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {computeResult.excluded.map(e => (
                <a key={e.code} href={`/employees?search=${e.code}`}
                  className="text-xs bg-white border border-amber-300 text-amber-700 px-2 py-1 rounded hover:bg-amber-100 transition-colors">
                  {e.code} {e.name} — {e.reason}
                </a>
              ))}
            </div>
          </div>
        )}

        {/* Summary Cards */}
        {allSalaries.length > 0 && (
          <div className="grid gap-4 grid-cols-[repeat(auto-fit,minmax(150px,1fr))]" data-testid="stage7-cards">
            <div className="stat-card border-l-4 border-l-blue-400">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Total Gross</span>
              <span className="text-xl font-bold text-slate-800">{fmtINR(computedTotals.gross)}</span>
              <span className="text-xs text-slate-400">{allSalaries.length} employees</span>
            </div>
            <div className="stat-card border-l-4 border-l-indigo-400">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider"><Abbr code="PF">PF</Abbr> (Both)</span>
              <span className="text-xl font-bold text-indigo-600">{fmtINR(computedTotals.pf)}</span>
            </div>
            <div className="stat-card border-l-4 border-l-purple-400">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider"><Abbr code="ESI">ESI</Abbr> (Both)</span>
              <span className="text-xl font-bold text-purple-600">{fmtINR(computedTotals.esi)}</span>
            </div>
            <div className="stat-card border-l-4 border-l-cyan-400">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">OT Pay</span>
              <span className="text-xl font-bold text-cyan-700">{fmtINR(computedTotals.otPay)}</span>
              <span className="text-xs text-slate-400">Punch-detected</span>
            </div>
            <div className="stat-card border-l-4 border-l-fuchsia-400">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">ED Pay</span>
              <span className="text-xl font-bold text-fuchsia-700">{fmtINR(computedTotals.edPay)}</span>
              <span className="text-xs text-slate-400">{computedTotals.edEmployees} emp · finance approved</span>
            </div>
            <div className="stat-card border-l-4 border-l-emerald-400">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Take Home</span>
              <span className="text-xl font-bold text-emerald-700">{fmtINR(computedTotals.takeHome)}</span>
              {heldCount > 0 && <span className="text-xs text-amber-600">{heldCount} held ({fmtINR(computedTotals.heldNet)})</span>}
            </div>
            <div className="stat-card border-l-4 border-l-amber-400">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Flags</span>
              <div className="flex flex-wrap gap-2 mt-1">
                {changedCount > 0 && (
                  <span className="text-xs px-2 py-1 rounded-lg bg-amber-100 text-amber-700 border border-amber-200 font-semibold whitespace-nowrap">{changedCount} changed</span>
                )}
                {heldCount > 0 && (
                  <span className="text-xs px-2 py-1 rounded-lg bg-red-100 text-red-700 border border-red-200 font-semibold whitespace-nowrap">{heldCount} held</span>
                )}
                {!changedCount && !heldCount && <span className="text-sm text-slate-400">None</span>}
              </div>
            </div>
          </div>
        )}

        {/* Month-End Checklist — warnings/errors always open; passed checks fold into one line. */}
        {checklist.length > 0 && (
          <div className="card p-4" data-testid="stage7-checklist">
            <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
              <h3 className="text-sm font-bold text-slate-700">Pre-Finalization Checklist</h3>
              <div className="flex gap-2 text-xs">
                {checklistSummary.warnings > 0 && <span className="px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full font-medium">{checklistSummary.warnings} warning{checklistSummary.warnings > 1 ? 's' : ''}</span>}
                {checklistSummary.errors > 0 && <span className="px-2 py-0.5 bg-red-100 text-red-700 rounded-full font-medium">{checklistSummary.errors} error{checklistSummary.errors > 1 ? 's' : ''}</span>}
              </div>
            </div>
            {checklistOpen.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-2">
                {checklistOpen.map(renderCheckItem)}
              </div>
            )}
            {checklistPassed.length > 0 && (
              <button type="button" onClick={() => setShowPassed(v => !v)} data-testid="checklist-passed-toggle"
                className={clsx('text-xs text-green-700 hover:underline', checklistOpen.length > 0 && 'mt-2')}>
                ✅ {checklistPassed.length} of {checklist.length} checks passed — {showPassed ? 'hide' : 'show'}
              </button>
            )}
            {showPassed && checklistPassed.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-2 mt-2">
                {checklistPassed.map(renderCheckItem)}
              </div>
            )}
          </div>
        )}

        {/* Salary Comparison Toggle */}
        {allSalaries.length > 0 && (
          <div className="flex gap-2">
            <button onClick={() => setShowComparison(!showComparison)} className={clsx('btn-ghost text-xs px-3 py-1.5 rounded-lg border', showComparison ? 'bg-blue-50 border-blue-200 text-blue-700' : 'border-slate-200')}>
              {showComparison ? 'Hide Comparison' : 'Month-over-Month Comparison'}
            </button>
          </div>
        )}

        {/* Salary Comparison Panel */}
        {showComparison && (
          <div className="card p-4 animate-slide-up">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-slate-700">Salary Comparison — Anomalies</h3>
              {comparisonSummary.total > 0 && (
                <div className="flex gap-2 text-xs">
                  {comparisonSummary.new > 0 && <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full">{comparisonSummary.new} new</span>}
                  {comparisonSummary.missing > 0 && <span className="px-2 py-0.5 bg-red-100 text-red-700 rounded-full">{comparisonSummary.missing} missing</span>}
                  {comparisonSummary.largeChange > 0 && <span className="px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full">{comparisonSummary.largeChange} large change</span>}
                </div>
              )}
            </div>
            {comparisonLoading ? <div className="text-center text-slate-400 py-4">Loading...</div> : comparisonData.length === 0 ? (
              <div className="text-center text-green-600 py-4 text-sm">No anomalies detected — all salaries are within normal range.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="table-compact w-full text-xs">
                  <thead>
                    <tr><th>Employee</th><th>Dept</th><th className="text-right">Prev Net</th><th className="text-right">Curr Net</th><th className="text-right">Change</th><th>Flags</th></tr>
                  </thead>
                  <tbody>
                    {comparisonData.map(c => (
                      <tr key={c.employee_code} className={clsx(
                        c.flags.includes('MISSING') && 'bg-red-50',
                        c.flags.includes('LARGE_CHANGE') && 'bg-amber-50',
                        c.flags.includes('NEW') && 'bg-blue-50'
                      )}>
                        <td><span className="font-medium">{c.employee_name}</span><br/><span className="text-slate-400 font-mono">{c.employee_code}</span></td>
                        <td>{c.department}</td>
                        <td className="text-right font-mono">{c.prev_net ? fmtINR(c.prev_net) : '—'}</td>
                        <td className="text-right font-mono">{fmtINR(c.net_salary)}</td>
                        <td className={clsx('text-right font-mono', c.net_change_pct > 20 && 'text-green-600', c.net_change_pct < -20 && 'text-red-600')}>
                          {c.net_change_pct !== undefined ? `${c.net_change_pct > 0 ? '+' : ''}${c.net_change_pct}%` : '—'}
                        </td>
                        <td>
                          <div className="flex gap-1 flex-wrap">
                            {c.flags.map(f => (
                              <span key={f} className={clsx('px-1.5 py-0.5 rounded text-[10px] font-medium',
                                f === 'MISSING' && 'bg-red-100 text-red-700',
                                f === 'LARGE_CHANGE' && 'bg-amber-100 text-amber-700',
                                f === 'NEW' && 'bg-blue-100 text-blue-700',
                                f === 'HELD' && 'bg-amber-100 text-amber-700',
                                f === 'GROSS_CHANGED' && 'bg-purple-100 text-purple-700',
                                f === 'MODERATE_CHANGE' && 'bg-yellow-100 text-yellow-700'
                              )}>{f.replace('_', ' ')}</span>
                            ))}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Filters */}
        {allSalaries.length > 0 && (
          <div className="flex gap-3 items-end flex-wrap">
            <div>
              <input type="text" placeholder="Search name, code, dept..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="input w-56 text-sm" />
            </div>
            <div className="flex gap-1">
              {[
                { key: 'all', label: 'All', count: allSalaries.length },
                { key: 'active', label: 'Active', count: allSalaries.length - heldCount },
                { key: 'held', label: 'Held', count: heldCount },
                { key: 'changed', label: 'Changed', count: changedCount },
                ...(returningCount > 0 ? [{ key: 'returning', label: 'Returning', count: returningCount }] : []),
                ...(newJoinerCount > 0 ? [{ key: 'newjoiners', label: 'New Joiners', count: newJoinerCount }] : []),
              ].map(f => (
                <button key={f.key}
                  onClick={() => setFilterView(f.key)}
                  className={clsx('px-3 py-1.5 rounded-lg text-xs font-medium transition-all border',
                    filterView === f.key
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                  )}
                >
                  {f.label} ({f.count})
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Day calculation moved after salary was computed. Salary is never
            recomputed automatically — HR clicks Compute (owner ruling 5). */}
        {staleCount > 0 && (
          <div className="rounded-lg border border-amber-400 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-lg" aria-hidden="true">⚠</span>
              <div className="flex-1 min-w-0">
                <div className="font-semibold">
                  Day calculation changed for {staleCount} employee{staleCount === 1 ? '' : 's'} since salary was computed. Click Compute Salary to refresh.
                </div>
                <button
                  type="button"
                  onClick={() => setStaleOpen(v => !v)}
                  className="text-xs text-amber-800 underline mt-0.5"
                >
                  {staleOpen ? 'Hide' : 'Show'} the {staleCount} employee code{staleCount === 1 ? '' : 's'}
                </button>
              </div>
              <button
                onClick={() => computeMutation.mutate()}
                disabled={computeMutation.isPending}
                className="btn-primary text-sm shrink-0"
              >
                {computeMutation.isPending ? 'Computing…' : 'Compute Salary'}
              </button>
            </div>
            {staleOpen && (
              <div className="mt-2 flex flex-wrap gap-1 max-h-32 overflow-y-auto">
                {staleCodes.map(c => (
                  <span key={c} className="badge-gray text-[11px]">{c}</span>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Stage 6 staleness banner (April 2026). Read-only mirror of
            the Day Calculation page's recompute banner — Stage 7
            depends on Stage 6, so if Stage 6 is stale so is Stage 7.
            Link navigates to /pipeline/day-calc where the user can
            trigger the actual recompute. */}
        {staleness.stale && (
          <div className="rounded-lg border border-amber-400 bg-amber-50 px-4 py-3 text-sm text-amber-900 flex flex-wrap items-center gap-3">
            <span className="text-lg">⚠</span>
            <div className="flex-1 min-w-0">
              <div className="font-semibold">
                Stage 6 is stale — {staleness.changedMissPunches} miss punch{staleness.changedMissPunches === 1 ? '' : 'es'} changed finance status since last day calc
              </div>
              <div className="text-xs text-amber-800 mt-0.5">
                Salary numbers below reflect pre-approval days. Re-run Stage 6 first, then recompute salaries here.
              </div>
            </div>
            <Link to="/pipeline/day-calc" className="btn-primary text-sm shrink-0">
              Open Stage 6 →
            </Link>
          </div>
        )}

        {/* Held Salaries ↔ Finance Verification interlink banner.
            Surfaces only when the user is viewing the "Held" filter
            so the cross-page navigation is contextual. Works both
            ways — the Finance Verify → Held tab has the reciprocal
            link back here. */}
        {filterView === 'held' && heldCount > 0 && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-xs text-amber-900 flex items-center gap-3">
            <span className="font-semibold">⚠ {heldCount} held salaries</span>
            <span className="text-amber-800">
              {canFinance
                ? 'Click Release on any row to unlock the salary, or review them in Finance Verification.'
                : 'Finance must release these before the month can be finalised.'}
            </span>
            <Link to="/finance-verification?tab=held" className="ml-auto text-blue-600 hover:underline font-medium shrink-0">
              Review in Finance Verify →
            </Link>
            <Link to="/held-salaries" className="text-blue-600 hover:underline font-medium shrink-0">
              Open Release Register →
            </Link>
          </div>
        )}

        {/* Calendar Panel */}
        {calendarEmployee && (
          <div className="card p-5 animate-slide-up">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-slate-700">
                Daily Attendance: {calendarEmployee.name} ({calendarEmployee.code})
              </h3>
              <button onClick={() => setCalendarEmployee(null)} className="btn-ghost text-xs">Close</button>
            </div>
            <CalendarView employeeCode={calendarEmployee.code} month={month} year={year} />
          </div>
        )}

        {/* Excluded/Error employees after compute */}
        {computeResult && (computeResult.excluded?.length > 0 || computeResult.errorDetails?.length > 0) && (
          <div className="card p-4 bg-amber-50 border-amber-200">
            <h4 className="text-sm font-bold text-amber-800 mb-2">
              {computeResult.excluded?.length || 0} employee(s) skipped during salary computation
            </h4>
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {(computeResult.excluded || []).map(e => (
                <div key={e.code} className="flex items-center justify-between text-xs bg-white rounded-lg px-3 py-1.5 border border-amber-100">
                  <div>
                    <span className="font-mono text-slate-500">{e.code}</span>
                    <span className="ml-2 font-medium text-slate-700">{e.name}</span>
                    <span className="ml-2 text-amber-600">{e.reason}</span>
                  </div>
                  <a href="/employees" className="text-blue-600 hover:underline text-xs shrink-0 ml-2">Set Salary</a>
                </div>
              ))}
              {(computeResult.errorDetails || []).map(e => (
                <div key={e.employeeCode} className="flex items-center text-xs bg-red-50 rounded-lg px-3 py-1.5 border border-red-100">
                  <span className="font-mono text-slate-500">{e.employeeCode}</span>
                  <span className="ml-2 text-red-600">{e.error}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Empty State */}
        {allSalaries.length === 0 && !isLoading && (
          <div className="card p-8 text-center">
            <div className="text-4xl mb-3">₹</div>
            <h3 className="font-semibold text-slate-700 mb-2">No salary data</h3>
            <p className="text-slate-500 mb-4">Complete Day Calculation (Stage 6) first, then compute salary.</p>
          </div>
        )}

        {/* Salary Register Table — its own scroll window (sticky header / totals,
            pinned Employee + Net / Take Home / actions from md up). Columns come
            from REG_COLS so header, body, totals and the drill-down colSpan stay in step. */}
        {salaries.length > 0 && (
          <div className="card overflow-hidden" data-testid="salary-register">
            <div className="card-header flex flex-wrap items-center justify-between gap-2 !px-4 !py-3">
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-semibold text-slate-700">Salary Register — {salaries.length} records</span>
                {!!allSalaries[0]?.is_finalised && <span className="badge-green text-xs">Finalised</span>}
              </div>
              <div className="flex rounded-lg border border-slate-200 overflow-hidden text-xs" role="group" aria-label="Columns" data-testid="register-view">
                {REG_VIEWS.map(v => (
                  <button key={v.key} type="button" onClick={() => chooseRegView(v.key)} data-testid={`register-view-${v.key}`}
                    aria-pressed={regView === v.key}
                    className={clsx('px-3 py-1.5 font-medium whitespace-nowrap transition-colors', regView === v.key ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50')}
                    title={v.title}>
                    {v.label} ({REG_COLS.filter(c => c.views.includes(v.key)).length})
                  </button>
                ))}
              </div>
            </div>
            <div ref={regScrollRef} className="salreg-box overflow-auto md:max-h-[calc(100vh-10rem)]" data-testid="register-scroll">
              <table className="salreg min-w-full table-compact text-[11px]">
                <thead>
                  <tr>
                    {regVisible.map(c => (
                      <th key={c.key} {...pinProps(c, 'th')}
                        onClick={c.sort ? () => toggleSort(c.sort) : undefined}
                        title={c.title}>
                        {c.label}{c.sort ? sortIndicator(c.sort) : ''}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortedSalaries.map(s => {
                    const expanded = showDetails === s.employee_code
                    return (
                      <React.Fragment key={s.employee_code}>
                        <tr onClick={() => setShowDetails(expanded ? null : s.employee_code)} className={clsx(
                          'transition-colors cursor-pointer hover:bg-blue-50/50',
                          expanded && 'bg-blue-50/70 row-expanded',
                          s.salary_held && !expanded && 'bg-amber-50/60 row-held',
                          s.gross_changed && !s.salary_held && !expanded && 'bg-blue-50/30 row-changed'
                        )}>
                          {regVisible.map(c => {
                            const p = pinProps(c, 'td', c.tdCls ? c.tdCls(s) : undefined)
                            return <td key={c.key} className={p.className} style={p.style} title={c.tdTitle ? c.tdTitle(s) || undefined : undefined}>{c.render(s, expanded)}</td>
                          })}
                        </tr>
                        {expanded && (
                          <DrillDownRow colSpan={regVisible.length}>
                            {/* Sticks to the visible part of the scroll window so the
                                whole breakdown reads without scrolling sideways. */}
                            <div className="sticky left-5" style={regBoxW ? { width: Math.max(280, regBoxW - 40) } : undefined} data-testid="register-drilldown">
                            <EmployeeQuickView
                              employeeCode={s.employee_code}
                              contextContent={
                                <div className="grid grid-cols-2 gap-4 text-xs">
                                  <div>
                                    <p className="font-semibold mb-1 text-slate-600">Earnings</p>
                                    <div className="space-y-0.5">
                                      {[
                                        ['Basic', s.basic_earned],
                                        ['DA', s.da_earned],
                                        ['HRA', s.hra_earned],
                                        ['Conv.', s.conveyance_earned],
                                        ['Other', s.other_allowances_earned],
                                        ['OT', s.ot_pay],
                                        ['Holiday Duty', s.holiday_duty_pay],
                                        ['Extra Duty (ED)', s.ed_pay]
                                      ].map(([k,v]) => v > 0 && (
                                        <div key={k} className="flex justify-between"><span>{k}</span><span className="font-mono font-medium">{fmtINR(v)}</span></div>
                                      ))}
                                      {(s.take_home || s.total_payable) > 0 && (
                                        <div className="flex justify-between mt-1 pt-1 border-t border-slate-200 font-bold text-emerald-700">
                                          <span>Take Home</span>
                                          <span className="font-mono">{fmtINR(s.take_home || s.total_payable)}</span>
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                  <div>
                                    <p className="font-semibold mb-1 text-slate-600">Deductions</p>
                                    <div className="space-y-0.5">
                                      {[['PF (Emp)', s.pf_employee], ['PF (Empr)', s.pf_employer], ['ESI (Emp)', s.esi_employee], ['ESI (Empr)', s.esi_employer], ['LWF (Emp)', s.lwf_employee], ['LWF (Empr)', s.lwf_employer], ['TDS', s.tds], ['LOP', s.lop_deduction], ['Advance', s.advance_recovery], ['Loan EMI', s.loan_recovery], ['Late Coming', s.late_coming_deduction], ['Early Exit', s.early_exit_deduction], ['Other', s.other_deductions]].map(([k,v]) => v > 0 && (
                                        <div key={k} className="flex justify-between"><span>{k}</span><span className="font-mono font-medium text-red-600">{fmtINR(v)}</span></div>
                                      ))}
                                    </div>
                                    {!!s.gross_changed && (
                                      <div className="mt-2 p-2 bg-blue-50 rounded-lg border border-blue-200">
                                        <span className="text-xs text-blue-700 font-semibold">Gross Changed:</span>
                                        <span className="text-xs text-blue-600 ml-1">{fmtINR(s.prev_month_gross)} → {fmtINR(s.gross_salary)}</span>
                                      </div>
                                    )}
                                    {!!s.salary_held && (
                                      <div className="mt-2 p-2 bg-amber-50 rounded-lg border border-amber-200">
                                        <span className="text-xs text-amber-700 font-semibold">Held:</span>
                                        <span className="text-xs text-amber-600 ml-1">{s.hold_reason}</span>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              }
                            />
                            </div>
                          </DrillDownRow>
                        )}
                      </React.Fragment>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr className="font-bold text-xs" data-testid="register-totals">
                    {regVisible.map(c => (
                      <td key={c.key} {...pinProps(c, 'tf')} title={c.footTitle}>
                        {c.foot ? c.foot(salaries) : null}
                      </td>
                    ))}
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}

        {/* Payslip Modal */}
        <Modal open={!!payslipEmployee} onClose={() => setPayslipEmployee(null)} title={`Payslip — ${payslip?.employee?.name || payslipEmployee}`} size="lg">
          {payslip && (
            <ModalBody>
              <div className="space-y-4 text-sm">
                <div className="text-center border-b pb-3">
                  <h3 className="font-bold text-lg">{payslip.employee.company || 'Company'}</h3>
                  <p className="text-xs text-slate-500">Salary Slip for {payslip.period.period}</p>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div><span className="text-slate-500">Name:</span> <span className="font-medium">{payslip.employee.name}</span></div>
                  <div><span className="text-slate-500">Code:</span> <span className="font-mono">{payslip.employee.code}</span></div>
                  <div><span className="text-slate-500">Dept:</span> {payslip.employee.department}</div>
                  <div><span className="text-slate-500">Designation:</span> {payslip.employee.designation}</div>
                  <div><span className="text-slate-500"><Abbr code="UAN">UAN</Abbr>:</span> <span className="font-mono">{payslip.employee.uan || '—'}</span></div>
                  <div><span className="text-slate-500">Bank:</span> <span className="font-mono">{payslip.employee.bank_account || '—'}</span></div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <h4 className="font-semibold text-xs text-slate-500 uppercase mb-2 border-b pb-1">Earnings</h4>
                    {payslip.earnings.map(e => (
                      <div key={e.label} className="flex justify-between py-0.5 text-xs">
                        <span>{e.label}</span><span className="font-mono">{fmtINR(e.amount)}</span>
                      </div>
                    ))}
                    <div className="flex justify-between py-1 border-t mt-1 font-bold text-xs">
                      <span>Gross Earned</span><span className="font-mono">{fmtINR(payslip.grossEarned)}</span>
                    </div>
                  </div>
                  <div>
                    <h4 className="font-semibold text-xs text-slate-500 uppercase mb-2 border-b pb-1">Deductions</h4>
                    {payslip.deductions.map(d => (
                      <div key={d.label} className="flex justify-between py-0.5 text-xs">
                        <span>{d.label}</span><span className="font-mono text-red-600">{fmtINR(d.amount)}</span>
                      </div>
                    ))}
                    <div className="flex justify-between py-1 border-t mt-1 font-bold text-xs">
                      <span>Total Deductions</span><span className="font-mono text-red-600">{fmtINR(payslip.totalDeductions)}</span>
                    </div>
                  </div>
                </div>
                <div className="bg-green-50 p-3 rounded-xl border border-green-200 flex justify-between items-center">
                  <span className="font-bold text-green-800">Net Salary</span>
                  <span className="text-xl font-bold text-green-700 font-mono">{fmtINR(payslip.netSalary)}</span>
                </div>
                {loanBalance && (
                  <div className="bg-slate-50 px-3 py-2 rounded-xl border border-slate-200 space-y-0.5" data-testid="payslip-loan-balance">
                    {loanBalance.loans.map((l) => (
                      <div key={l.loanId} className="flex justify-between text-xs">
                        <span className="text-slate-600">{loanBalance.loans.length > 1 ? `Loan #${l.loanId} (${l.loanType}) outstanding after this month's EMI` : "Loan outstanding after this month's EMI"}</span>
                        <span className="font-mono font-semibold">{fmtINR(l.outstandingAfter)}</span>
                      </div>
                    ))}
                  </div>
                )}
                {((payslip.otPay || 0) > 0 || (payslip.edPay || 0) > 0 || (payslip.holidayDutyPay || 0) > 0) && (
                  <div className="bg-emerald-50 p-3 rounded-xl border border-emerald-200 space-y-1">
                    {(payslip.otPay || 0) > 0 && (
                      <div className="flex justify-between text-xs"><span className="text-slate-600">+ OT Pay</span><span className="font-mono text-cyan-700">{fmtINR(payslip.otPay)}</span></div>
                    )}
                    {(payslip.holidayDutyPay || 0) > 0 && (
                      <div className="flex justify-between text-xs"><span className="text-slate-600">+ Holiday Duty Pay</span><span className="font-mono text-purple-700">{fmtINR(payslip.holidayDutyPay)}</span></div>
                    )}
                    {(payslip.edPay || 0) > 0 && (
                      <div className="flex justify-between text-xs"><span className="text-slate-600">+ Extra Duty Pay ({payslip.edDays || 0}d)</span><span className="font-mono text-fuchsia-700">{fmtINR(payslip.edPay)}</span></div>
                    )}
                    <div className="flex justify-between pt-1 border-t border-emerald-200 font-bold">
                      <span className="text-emerald-800">Take Home</span>
                      <span className="text-xl font-bold text-emerald-700 font-mono">{fmtINR(payslip.takeHome || payslip.totalPayable || payslip.netSalary)}</span>
                    </div>
                  </div>
                )}
                {(!!payslip.grossChanged || !!payslip.salaryHeld) && (
                  <div className="flex gap-2">
                    {payslip.grossChanged ? <span className="salary-change-flag text-xs px-2 py-1 rounded-lg print-visible">Gross Changed: {fmtINR(payslip.prevMonthGross)} → Current</span> : null}
                    {payslip.salaryHeld ? <span className="salary-held-flag text-xs px-2 py-1 rounded-lg print-visible">Held: {payslip.holdReason}</span> : null}
                  </div>
                )}
                <div className="text-xs text-slate-500 border-t pt-2">
                  Employer PF: {fmtINR(payslip.pfEmployer)} | Employer ESI: {fmtINR(payslip.esiEmployer)}{(payslip.lwfEmployer || 0) > 0 ? ` | Employer LWF: ${fmtINR(payslip.lwfEmployer)}` : ''}
                </div>
              </div>
            </ModalBody>
          )}
          <ModalFooter>
            <button onClick={handleDownloadPayslip} disabled={pdfLoading} className="btn-primary text-sm">{pdfLoading ? 'Generating...' : 'Download PDF'}</button>
            <button onClick={() => window.print()} className="btn-secondary text-sm">Print</button>
            <button onClick={() => setPayslipEmployee(null)} className="btn-ghost text-sm">Close</button>
          </ModalFooter>
        </Modal>

        <AbbreviationLegend keys={['PF', 'EPF', 'EPS', 'ESI', 'LOP', 'DA', 'HRA', 'OT', 'TDS', 'EMI', 'NEFT', 'IFSC', 'UAN']} />

        {confirmAction === 'finalise' && (
          <ConfirmDialog
            title="Finalise Salary"
            message={`This will finalise salary for ${monthYearLabel(month, year)} (${allSalaries.length} employees). Finalised salaries cannot be recomputed without admin intervention. Are you sure?`}
            confirmText="Yes, Finalise"
            variant="warning"
            onConfirm={() => { setConfirmAction(null); finaliseMutation.mutate({}) }}
            onCancel={() => setConfirmAction(null)}
          />
        )}

      {/* Admin override: finalising while Stage 6 is newer than Stage 7 needs a
          written reason, which the backend records in audit_log. */}
      <Modal open={showOverride} onClose={() => setShowOverride(false)} title="Finalise with stale day calculations?" size="md">
        <ModalBody>
          <p className="text-sm text-slate-700">
            Day calculation changed for <span className="font-semibold">{staleCount}</span> employee
            {staleCount === 1 ? '' : 's'} after salary was computed. Finalising now locks in the older
            salary figures.
          </p>
          <p className="text-sm text-slate-700 mt-2">
            The safe path is to click <span className="font-medium">Compute Salary</span> first. If you
            are finalising anyway, say why — it is recorded against this month.
          </p>
          <label className="text-xs font-medium text-slate-600 block mb-1 mt-4">
            Reason (at least 10 characters)
          </label>
          <textarea
            className="input w-full"
            rows={3}
            value={overrideReason}
            onChange={(e) => setOverrideReason(e.target.value)}
            placeholder="e.g. Bank file already sent; the changed days are next month's correction"
          />
        </ModalBody>
        <ModalFooter>
          <button className="btn-ghost" onClick={() => setShowOverride(false)}>Cancel</button>
          <button
            className="btn-primary"
            onClick={() => { computeMutation.mutate(); setShowOverride(false); setOverrideReason('') }}
          >
            Compute Salary instead
          </button>
          <button
            className="btn-success"
            disabled={overrideReason.trim().length < 10 || finaliseMutation.isPending}
            onClick={() => {
              finaliseMutation.mutate({ staleOverrideReason: overrideReason.trim() })
              setShowOverride(false)
              setOverrideReason('')
            }}
          >
            Finalise anyway
          </button>
        </ModalFooter>
      </Modal>

        {/* Shared release modal — same component used by Finance Verify
            Held tab and the Held Salaries Register. Guarantees the
            paper-verification notes requirement is enforced from every
            entry point. */}
        <ReleaseHoldModal
          open={!!releaseEmployee}
          onClose={() => setReleaseEmployee(null)}
          employee={releaseEmployee}
          pending={releaseHoldMutation.isPending}
          onSubmit={(notes) => releaseHoldMutation.mutate({ code: releaseEmployee.code, notes })}
        />
      </div>
    </div>
  )
}
