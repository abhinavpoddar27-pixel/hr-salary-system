import React, { useState, useMemo, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { getFinanceAuditDashboard, getFinanceAuditEmployees, getFinanceRedFlags, setFinanceAuditStatus, bulkVerifyEmployees, submitFinanceSignoff, getFinanceSignoffStatus, addFinanceComment, getFinanceComments } from '../utils/api'
import { useAppStore } from '../store/appStore'
import DateSelector from '../components/common/DateSelector'
import useDateSelector from '../hooks/useDateSelector'
import CompanyFilter from '../components/shared/CompanyFilter'
import { fmtINR } from '../utils/formatters'
import { canFinance as canFinanceFn } from '../utils/role'
import clsx from 'clsx'
import toast from 'react-hot-toast'
import Modal from '../components/ui/Modal'

function KPI({ label, value, color = 'blue' }) {
  const colors = { blue: 'text-blue-700', green: 'text-green-700', red: 'text-red-700', amber: 'text-amber-700', purple: 'text-purple-700' }
  return <div className="card p-3"><div className={clsx('text-xl font-bold', colors[color])}>{value}</div><div className="text-[10px] text-slate-400 uppercase font-medium">{label}</div></div>
}

export default function FinanceVerification() {
  const { month, year, dateProps } = useDateSelector({ mode: 'month', syncToStore: true })
  const { selectedCompany, user } = useAppStore()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const deepTab = searchParams.get('tab')
  const deepFilter = searchParams.get('filter')
  const [activeTab, setActiveTab] = useState(deepTab === 'redflags' ? 'flags' : 'dashboard')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [signoffModal, setSignoffModal] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  const [expandedFlags, setExpandedFlags] = useState(new Set())
  const [flagCategory, setFlagCategory] = useState(deepFilter || 'all')
  const qc = useQueryClient()

  const { data: dashRes } = useQuery({ queryKey: ['fin-dash', month, year], queryFn: () => getFinanceAuditDashboard(month, year), retry: 0 })
  const dash = dashRes?.data?.data
  const { data: empRes } = useQuery({ queryKey: ['fin-emps', month, year, search, statusFilter], queryFn: () => getFinanceAuditEmployees(month, year, { search, status: statusFilter }), retry: 0 })
  const employees = empRes?.data?.data || []
  const { data: flagRes } = useQuery({ queryKey: ['fin-flags', month, year], queryFn: () => getFinanceRedFlags(month, year), retry: 0 })
  const redFlags = flagRes?.data?.data || []
  const { data: soRes } = useQuery({ queryKey: ['fin-signoff', month, year], queryFn: () => getFinanceSignoffStatus(month, year), retry: 0 })
  const signoff = soRes?.data?.data

  const verifyMut = useMutation({ mutationFn: setFinanceAuditStatus, onSuccess: () => { qc.invalidateQueries(['fin-dash']); qc.invalidateQueries(['fin-emps']); toast.success('Status updated') } })
  const bulkMut = useMutation({ mutationFn: bulkVerifyEmployees, onSuccess: (r) => { qc.invalidateQueries(['fin-dash']); qc.invalidateQueries(['fin-emps']); toast.success(`${r.data.verified} employees verified`) } })
  const signoffMut = useMutation({ mutationFn: submitFinanceSignoff, onSuccess: () => { qc.invalidateQueries(['fin-signoff']); qc.invalidateQueries(['fin-dash']); setSignoffModal(false); toast.success('Sign-off submitted') }, onError: (e) => toast.error(e.response?.data?.error || 'Failed') })

  // Canonical role check — see frontend/src/utils/role.js. A plain
  // `includes(user.role)` used to silently fail for legacy rows that
  // stored "Finance" / "Finance Team" / "finance " instead of "finance".
  const canAct = canFinanceFn(user)
  const tabs = [{ id: 'dashboard', label: 'Audit Dashboard' }, { id: 'employees', label: 'Employee Review' }, { id: 'flags', label: `Red Flags (${redFlags.length})` }]

  return (
    <div className="p-6 space-y-5 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="section-title">Finance Verification & Audit</h2>
          <p className="section-subtitle mt-1">Review, verify, and sign off salary computations</p>
        </div>
        <div className="flex items-center gap-3">
          <CompanyFilter />
          <DateSelector {...dateProps} />
        </div>
      </div>

      {/* Sign-off banner */}
      {signoff?.status === 'approved' && (
        <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3 text-sm text-green-800 flex items-center gap-2">
          <span>✅</span> Approved by {signoff.signed_by} — salary can be finalised.
        </div>
      )}
      {signoff?.status === 'rejected' && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-800">
          <span>❌</span> Rejected by {signoff.signed_by}: {signoff.rejection_reason}
        </div>
      )}

      {/* Tabs */}
      <div className="border-b border-slate-200 flex gap-0 overflow-x-auto">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            className={clsx('px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap',
              activeTab === t.id ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700')}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Dashboard Tab */}
      {activeTab === 'dashboard' && dash && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
            <KPI label="Total Employees" value={dash.summary.totalEmployees} />
            <KPI label="Verified" value={dash.summary.verified} color="green" />
            <KPI label="Flagged" value={dash.summary.flagged} color="amber" />
            <KPI label="Rejected" value={dash.summary.rejected} color="red" />
            <KPI label="Pending" value={dash.summary.pending} color="purple" />
            <KPI label="Total Net" value={fmtINR(dash.summary.totalNetSalary)} color="blue" />
            <KPI label="Held" value={dash.summary.heldSalaries} color="red" />
          </div>

          {/* Progress */}
          <div className="card p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium">Audit Progress</span>
              <span className="text-sm text-slate-500">{dash.summary.verified}/{dash.summary.totalEmployees} verified</span>
            </div>
            <div className="h-3 bg-slate-100 rounded-full overflow-hidden">
              <div className="h-full bg-green-500 transition-all" style={{ width: `${dash.summary.totalEmployees > 0 ? (dash.summary.verified / dash.summary.totalEmployees * 100) : 0}%` }} />
            </div>
          </div>

          {/* Red flag summary */}
          {Object.keys(dash.redFlagSummary).length > 0 && (
            <div className="card p-4">
              <h3 className="text-sm font-semibold mb-3">Red Flags ({dash.redFlagCount})</h3>
              <div className="flex flex-wrap gap-2">
                {Object.entries(dash.redFlagSummary).map(([type, count]) => (
                  <span key={type} className="text-xs bg-red-50 text-red-700 px-2 py-1 rounded-full border border-red-200">{type.replace(/_/g, ' ')} ({count})</span>
                ))}
              </div>
            </div>
          )}

          {/* Actions */}
          {canAct && (
            <div className="flex gap-3">
              <button onClick={() => bulkMut.mutate({ month, year, filter: 'no-red-flags' })} disabled={bulkMut.isPending} className="btn-primary text-sm">
                {bulkMut.isPending ? 'Verifying...' : 'Bulk Verify Clean Employees'}
              </button>
              <button onClick={() => setSignoffModal(true)} className="btn-success text-sm">Sign Off Month</button>
            </div>
          )}
        </div>
      )}

      {/* Employee Review Tab */}
      {activeTab === 'employees' && (
        <div className="space-y-3">
          <div className="flex gap-3 items-center">
            <input type="text" placeholder="Search name or code..." value={search} onChange={e => setSearch(e.target.value)} className="input w-56 text-sm" />
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="input text-sm w-36">
              <option value="">All</option>
              <option value="verified">Verified</option>
              <option value="flagged">Flagged</option>
              <option value="rejected">Rejected</option>
            </select>
          </div>
          <div className="card overflow-x-auto">
            <table className="table-compact w-full text-[11px]">
              <thead>
                <tr>
                  <th>Employee</th><th>Dept</th><th>Days</th><th>Gross</th><th>Earned</th><th>Ded</th><th>Net</th><th>Flags</th><th>Status</th>
                  {canAct && <th>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {employees.map(s => {
                  const empFlags = redFlags.filter(f => f.employeeCode === s.employee_code)
                  return (
                    <tr key={s.employee_code} className={clsx(s.audit_status === 'flagged' && 'bg-amber-50', s.audit_status === 'rejected' && 'bg-red-50')}>
                      <td className="font-medium">{s.employee_name || s.employee_code}<div className="text-[10px] text-slate-400">{s.employee_code}</div></td>
                      <td className="text-slate-500">{s.department}</td>
                      <td className="font-mono text-center">{s.payable_days}</td>
                      <td className="font-mono">{fmtINR(s.gross_salary)}</td>
                      <td className="font-mono">{fmtINR(s.gross_earned)}</td>
                      <td className="font-mono text-red-600">{fmtINR(s.total_deductions)}</td>
                      <td className="font-mono font-bold text-green-700">{fmtINR(s.net_salary)}</td>
                      <td>{empFlags.length > 0 ? <span className="text-xs bg-red-100 text-red-700 px-1.5 py-0.5 rounded-full">{empFlags.length}</span> : '—'}</td>
                      <td>
                        {s.audit_status === 'verified' && <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">Verified</span>}
                        {s.audit_status === 'flagged' && <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">Flagged</span>}
                        {s.audit_status === 'rejected' && <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full">Rejected</span>}
                        {!s.audit_status && <span className="text-xs text-slate-400">Pending</span>}
                      </td>
                      {canAct && (
                        <td className="flex gap-1">
                          <button onClick={() => verifyMut.mutate({ employeeCode: s.employee_code, month, year, status: 'verified' })} className="text-green-600 hover:bg-green-50 px-1 py-0.5 rounded text-[10px]" title="Verify">✓</button>
                          <button onClick={() => verifyMut.mutate({ employeeCode: s.employee_code, month, year, status: 'flagged', flagReason: 'Flagged for review' })} className="text-amber-600 hover:bg-amber-50 px-1 py-0.5 rounded text-[10px]" title="Flag">⚠</button>
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Red Flags Tab */}
      {activeTab === 'flags' && (() => {
        const categories = {};
        for (const f of redFlags) categories[f.type] = (categories[f.type] || 0) + 1;
        const filteredFlags = flagCategory === 'all' ? redFlags : redFlags.filter(f => f.type === flagCategory);
        const toggleExpand = (id) => {
          setExpandedFlags(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
        };

        return (
          <div className="space-y-3">
            {/* Category filter bar */}
            <div className="flex flex-wrap gap-2">
              <button onClick={() => { setFlagCategory('all'); setExpandedFlags(new Set()); }}
                className={clsx('text-xs px-3 py-1.5 rounded-full border transition-colors', flagCategory === 'all' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50')}>
                All ({redFlags.length})
              </button>
              {Object.entries(categories).map(([type, count]) => (
                <button key={type} onClick={() => { setFlagCategory(type); setExpandedFlags(new Set()); }}
                  className={clsx('text-xs px-3 py-1.5 rounded-full border transition-colors', flagCategory === type ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50')}>
                  {type.replace(/_/g, ' ')} ({count})
                </button>
              ))}
            </div>

            {filteredFlags.length === 0 && <div className="text-center py-12 text-slate-400">No red flags in this category</div>}
            {filteredFlags.map(f => {
              const fid = f.id || `${f.employeeCode}_${f.type}`;
              const isExpanded = expandedFlags.has(fid);
              return (
                <div key={fid} className={clsx('card border-l-4 cursor-pointer transition-all', f.severity === 'critical' ? 'border-red-500' : f.severity === 'warning' ? 'border-amber-500' : 'border-blue-500')} onClick={() => toggleExpand(fid)}>
                  <div className="p-3 flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={clsx('text-xs px-2 py-0.5 rounded-full font-medium', f.severity === 'critical' ? 'bg-red-100 text-red-700' : f.severity === 'warning' ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700')}>{f.severity}</span>
                        <span className="text-xs text-slate-500">{f.type.replace(/_/g, ' ')}</span>
                        <span className="text-[10px] text-slate-400 ml-auto">{isExpanded ? '▼' : '▶'}</span>
                      </div>
                      <div className="text-sm font-medium mt-1">{f.employeeName} ({f.employeeCode})</div>
                      <div className="text-xs text-slate-600 mt-0.5">{f.department} — {f.description}</div>
                    </div>
                    {canAct && (
                      <div className="flex gap-1 shrink-0 ml-2" onClick={e => e.stopPropagation()}>
                        <button onClick={() => verifyMut.mutate({ employeeCode: f.employeeCode, month, year, status: 'verified' })} className="text-green-600 hover:bg-green-50 px-2 py-1 rounded text-xs">Verify</button>
                        <button onClick={() => verifyMut.mutate({ employeeCode: f.employeeCode, month, year, status: 'flagged', flagReason: f.description, flagCategory: f.type })} className="text-amber-600 hover:bg-amber-50 px-2 py-1 rounded text-xs">Flag</button>
                      </div>
                    )}
                  </div>
                  {isExpanded && (
                    <div className="px-3 pb-3 pt-2 border-t border-slate-100 space-y-2 text-xs">
                      <div className="text-slate-500">{f.suggestedAction}</div>
                      {f.details && (
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                          {f.details.grossSalary != null && <div><span className="text-slate-400">Gross</span><div className="font-mono font-medium">{fmtINR(f.details.grossSalary)}</div></div>}
                          {f.details.grossEarned != null && <div><span className="text-slate-400">Earned</span><div className="font-mono font-medium">{fmtINR(f.details.grossEarned)}</div></div>}
                          {f.details.netSalary != null && <div><span className="text-slate-400">Net</span><div className="font-mono font-medium">{fmtINR(f.details.netSalary)}</div></div>}
                          {f.details.advance != null && <div><span className="text-slate-400">Advance</span><div className="font-mono font-medium">{fmtINR(f.details.advance)}</div></div>}
                          {f.details.daysAbsent != null && <div><span className="text-slate-400">Days Absent</span><div className="font-mono font-medium">{f.details.daysAbsent}</div></div>}
                          {f.details.net != null && <div><span className="text-slate-400">Net</span><div className="font-mono font-medium">{fmtINR(f.details.net)}</div></div>}
                        </div>
                      )}
                      <button onClick={(e) => { e.stopPropagation(); navigate(`/finance-audit?tab=${f.type === 'salary_held' ? 'interventions' : f.type === 'high_absenteeism' ? 'manual-flags' : 'report'}&employee=${f.employeeCode}&month=${month}&year=${year}`); }}
                        className="text-blue-600 hover:underline text-[11px] font-medium">
                        {f.type === 'salary_held' ? 'Review Hold in Finance Audit →' : 'View in Finance Audit →'}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        );
      })()}

      {/* Sign-off Modal */}
      {signoffModal && (
        <Modal onClose={() => setSignoffModal(false)} title="Monthly Sign-Off">
          <div className="space-y-4">
            <div className="text-sm">
              <p><strong>Total Employees:</strong> {dash?.summary.totalEmployees}</p>
              <p><strong>Verified:</strong> {dash?.summary.verified}</p>
              <p><strong>Flagged:</strong> {dash?.summary.flagged}</p>
              <p><strong>Total Net Salary:</strong> {fmtINR(dash?.summary.totalNetSalary || 0)}</p>
            </div>
            <div className="flex gap-3">
              <button onClick={() => signoffMut.mutate({ month, year, status: 'approved' })} disabled={signoffMut.isPending} className="btn-success text-sm flex-1">
                Approve
              </button>
              <div className="flex-1">
                <textarea value={rejectReason} onChange={e => setRejectReason(e.target.value)} placeholder="Rejection reason (required)..." className="input w-full h-16 text-sm mb-2" />
                <button onClick={() => signoffMut.mutate({ month, year, status: 'rejected', rejectionReason: rejectReason })} disabled={signoffMut.isPending || !rejectReason} className="btn-danger text-sm w-full">
                  Reject
                </button>
              </div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
