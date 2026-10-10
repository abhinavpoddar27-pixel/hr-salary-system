// Loans PR-4 — the Loans page, rebuilt on the PR-3 API (backend/src/routes/loans.js).
// SPEC §7: HR raises, the admin decides, finance pays out and records receipts,
// nobody approves their own request. The server enforces every rule; this page
// hides what a role can never do and explains what the loan's state blocks.
import React, { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router-dom'
import clsx from 'clsx'
import { getLoans, getLoanStats } from '../utils/api'
import { useAppStore } from '../store/appStore'
import CompanyFilter from '../components/shared/CompanyFilter'
import RequestLoanModal from '../components/loans/RequestLoanModal'
import ApprovalQueue from '../components/loans/ApprovalQueue'
import DueThisMonth from '../components/loans/DueThisMonth'
import LoanPolicy from '../components/loans/LoanPolicy'
import LoanClose from '../components/loans/LoanClose'
import LoanReports from '../components/loans/LoanReports'
import LoanImport from '../components/loans/LoanImport'
import {
  loanCaps, LOAN_STATE, CLOSED_STATES, KIND_LABEL, stateCls, stateLabel, rupees, monthLabel, GATE_OFF_TEXT,
} from '../components/loans/loanUi'

const STATUS_TABS = [
  { id: 'all', label: 'All', match: () => true },
  { id: 'requested', label: 'Requested', match: (s) => s === 'requested' },
  { id: 'approved', label: 'Approved (to pay)', match: (s) => s === 'approved' },
  { id: 'active', label: 'Active', match: (s) => s === 'active' },
  { id: 'recover_at_exit', label: 'Recover at exit', match: (s) => s === 'recover_at_exit' },
  { id: 'closed', label: 'Closed', match: (s) => CLOSED_STATES.includes(s) },
  { id: 'rejected', label: 'Rejected / cancelled', match: (s) => s === 'rejected' },
]

function Tile({ label, value, sub, accent, testid }) {
  return (
    <div className={clsx('stat-card border-l-4', accent)} data-testid={testid}>
      <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">{label}</span>
      <span className="text-2xl font-bold text-slate-800">{value}</span>
      {sub && <span className="text-xs text-slate-500">{sub}</span>}
    </div>
  )
}

export default function Loans() {
  const { selectedCompany, user } = useAppStore()
  const caps = loanCaps(user)
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const [showCreate, setShowCreate] = useState(false)
  const [statusTab, setStatusTab] = useState('all')
  const [typeFilter, setTypeFilter] = useState('')
  const [search, setSearch] = useState('')

  const companyParam = selectedCompany ? { company: selectedCompany } : {}
  const { data: statsRes } = useQuery({
    queryKey: ['loan-stats', selectedCompany],
    queryFn: () => getLoanStats(companyParam),
    retry: 0,
  })
  const stats = statsRes?.data?.data
  const { data: listRes, isLoading } = useQuery({
    queryKey: ['loans', selectedCompany],
    queryFn: () => getLoans(companyParam),
    retry: 0,
  })
  const allLoans = listRes?.data?.data || []

  const waiting = (stats?.pendingApprovals?.loans || 0) + (stats?.pendingApprovals?.changes || 0)
  const tab = params.get('tab') || (caps.canDecide && waiting > 0 ? 'queue' : 'loans')
  const setTab = (t) => setParams((p) => { const n = new URLSearchParams(p); n.set('tab', t); return n }, { replace: true })

  const loansById = useMemo(() => Object.fromEntries(allLoans.map((l) => [l.id, l])), [allLoans])
  const namesByCode = useMemo(() => Object.fromEntries(allLoans.map((l) => [l.employee_code, l.employee_name])), [allLoans])
  const types = useMemo(() => [...new Set(allLoans.map((l) => l.loan_type))].sort(), [allLoans])

  const loans = useMemo(() => {
    const st = STATUS_TABS.find((t) => t.id === statusTab) || STATUS_TABS[0]
    const q = search.trim().toLowerCase()
    return allLoans.filter((l) => st.match(l.status)
      && (!typeFilter || l.loan_type === typeFilter)
      && (!q || String(l.employee_code).toLowerCase().includes(q) || String(l.employee_name || '').toLowerCase().includes(q)))
  }, [allLoans, statusTab, typeFilter, search])

  const TABS = [
    { id: 'queue', label: 'Approval queue', count: waiting },
    { id: 'loans', label: 'Loans', count: allLoans.length },
    { id: 'due', label: 'Due this month' },
    { id: 'close', label: 'Monthly close' },
    { id: 'reports', label: 'Reports' },
    { id: 'settings', label: 'Settings' },
    ...(['hr', 'finance', 'admin', 'viewer'].includes(caps.role) ? [{ id: 'import', label: 'Import' }] : []),
  ]

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-screen-xl animate-fade-in">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h2 className="section-title">Loan Management</h2>
          <p className="section-subtitle mt-1">
            Interest-free employee loans. HR raises, the admin approves, finance records the payout and cash receipts.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <CompanyFilter />
          {caps.canRaise && (
            <button onClick={() => setShowCreate(true)} className="btn-primary" data-testid="new-loan">+ Request loan</button>
          )}
          {caps.canDecide && (
            <span className="text-xs text-slate-500 bg-slate-100 rounded-lg px-2 py-1.5">HR raises loans; admin approves</span>
          )}
        </div>
      </div>

      {stats && !stats.disbursementEnabled && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800" data-testid="gate-banner">
          {GATE_OFF_TEXT}
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Tile label="Outstanding" value={rupees(stats?.outstanding || 0)} sub="active + recover at exit" accent="border-l-purple-400" testid="tile-outstanding" />
        <Tile label="Due this month" value={stats?.dueThisMonth?.count ?? 0}
          sub={stats ? `${rupees(stats.dueThisMonth.amount)} · ${monthLabel(stats.dueThisMonth.month, stats.dueThisMonth.year)}` : ''} accent="border-l-blue-400" />
        <Tile label="Provisional" value={stats?.provisional?.count ?? 0} sub={stats ? rupees(stats.provisional.amount) : ''} accent="border-l-amber-400" />
        <Tile label="Deferred" value={stats?.deferred?.count ?? 0} sub="instalments moved to the end" accent="border-l-slate-400" />
        <Tile label="Waiting for admin" value={waiting}
          sub={stats ? `${stats.pendingApprovals.loans} loan${stats.pendingApprovals.loans === 1 ? '' : 's'} · ${stats.pendingApprovals.changes} change${stats.pendingApprovals.changes === 1 ? '' : 's'}` : ''}
          accent="border-l-red-400" testid="tile-waiting" />
      </div>

      <div className="flex gap-1 border-b border-slate-200">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} data-testid={`tab-${t.id}`}
            className={clsx('px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
              tab === t.id ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-800')}>
            {t.label}
            {t.count !== undefined && t.count > 0 && (
              <span className={clsx('ml-1.5 text-xs px-1.5 rounded-full', t.id === 'queue' ? 'bg-red-500 text-white' : 'bg-slate-100 text-slate-600')}>{t.count}</span>
            )}
          </button>
        ))}
      </div>

      {tab === 'queue' && <ApprovalQueue caps={caps} disbursementEnabled={!!stats?.disbursementEnabled} namesByCode={namesByCode} />}
      {tab === 'due' && <DueThisMonth loansById={loansById} />}
      {tab === 'close' && <LoanClose />}
      {tab === 'reports' && <LoanReports />}
      {tab === 'import' && <LoanImport caps={caps} />}
      {tab === 'settings' && <LoanPolicy caps={caps} />}
      {tab === 'loans' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex gap-1 flex-wrap">
              {STATUS_TABS.map((t) => {
                const n = allLoans.filter((l) => t.match(l.status)).length
                return (
                  <button key={t.id} onClick={() => setStatusTab(t.id)}
                    className={clsx('px-3 py-1.5 rounded-lg text-xs font-medium', statusTab === t.id ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100')}>
                    {t.label} <span className="opacity-70">({n})</span>
                  </button>
                )
              })}
            </div>
            <div className="flex gap-2">
              <input className="input text-sm w-48" placeholder="Search code or name" value={search} onChange={(e) => setSearch(e.target.value)} />
              <select className="select text-sm w-44" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
                <option value="">All types</option>
                {types.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>
          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="table-compact w-full min-w-[1000px]" data-testid="loan-list">
                <thead><tr>
                  <th>#</th><th>Borrower</th><th>Company</th><th>Type</th><th className="text-right">Principal</th>
                  <th className="text-right">EMI</th><th className="text-center">Tenure</th><th className="text-right">Balance</th><th>Status</th><th>Requested</th>
                </tr></thead>
                <tbody>
                  {isLoading ? <tr><td colSpan={10} className="text-center py-10 text-slate-400">Loading…</td></tr>
                    : loans.length === 0 ? (
                      <tr><td colSpan={10} className="text-center py-10 text-slate-400">
                        No loans here.{caps.canRaise ? ' Use "+ Request loan" to raise one.' : ''}
                      </td></tr>
                    ) : loans.map((l) => (
                      <tr key={l.id} className="cursor-pointer hover:bg-blue-50/50" onClick={() => navigate(`/loans/${l.id}`)} data-testid={`loan-row-${l.id}`}>
                        <td className="text-xs text-slate-400">{l.id}</td>
                        <td>
                          <div className="text-sm font-medium">{l.employee_name || l.employee_code}</div>
                          <div className="text-[11px] text-slate-400 font-mono">
                            {l.employee_code}{l.department ? ` · ${l.department}` : ''}
                            {l.borrower_type === 'sales' && <span className="ml-1 font-sans font-semibold px-1 rounded bg-violet-100 text-violet-700">Sales</span>}
                          </div>
                        </td>
                        <td className="text-xs">{l.company}</td>
                        <td className="text-xs">{l.loan_type}{l.exit_flag === 1 && <span className="ml-1 text-[10px] font-bold text-orange-700">EXIT</span>}</td>
                        <td className="text-right font-mono">{rupees(l.principal_amount)}</td>
                        <td className="text-right font-mono">{rupees(l.emi_amount)}</td>
                        <td className="text-center">{l.tenure_months}m</td>
                        <td className="text-right font-mono">{l.disbursed_amount !== null ? rupees(l.remaining_balance) : '—'}</td>
                        <td>
                          <span className={clsx('text-xs px-2 py-0.5 rounded-full font-medium', stateCls(LOAN_STATE, l.status))}>{stateLabel(LOAN_STATE, l.status)}</span>
                          {l.pending_request && <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded bg-purple-100 text-purple-800">{KIND_LABEL[l.pending_request]} pending</span>}
                        </td>
                        <td className="text-xs text-slate-500">
                          {l.requested_by}
                          {l.status === 'requested' && <div className={clsx(l.waiting_days >= 3 && 'text-red-600 font-semibold')}>waiting {l.waiting_days} d</div>}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {showCreate && (
        <RequestLoanModal onClose={() => setShowCreate(false)} onCreated={(id) => {
          setShowCreate(false)
          qc.invalidateQueries({ queryKey: ['loans'] })
          qc.invalidateQueries({ queryKey: ['loan-stats'] })
          qc.invalidateQueries({ queryKey: ['loan-queue'] })
          if (id) navigate(`/loans/${id}`)
        }} />
      )}
    </div>
  )
}
