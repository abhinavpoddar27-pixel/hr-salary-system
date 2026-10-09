// Loans PR-4 — instalments due in a month (replaces the retired
// /deductions and /monthly-recovery views). GET /api/loans/due.
import React from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import DateSelector from '../common/DateSelector'
import useDateSelector from '../../hooks/useDateSelector'
import { getLoansDue } from '../../utils/api'
import { INSTALMENT_STATE, ORIGIN_LABEL, stateCls, stateLabel, rupees, monthLabel } from './loanUi'

export default function DueThisMonth({ loansById }) {
  const navigate = useNavigate()
  const { month, year, dateProps } = useDateSelector({ mode: 'month', syncToStore: true })
  const { data, isLoading, error } = useQuery({
    queryKey: ['loans-due', month, year],
    queryFn: () => getLoansDue(month, year),
    retry: 0,
  })
  const rows = data?.data?.data || []
  const totalOpen = data?.data?.totalOpen || 0
  const posted = rows.filter((r) => r.status === 'posted').reduce((s, r) => s + Number(r.amount_due || 0), 0)

  return (
    <div className="space-y-3" data-testid="due-this-month">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="text-sm text-slate-600">
          Instalments due in <strong>{monthLabel(month, year)}</strong> on active and recover-at-exit loans.
          Stage 7 deducts them (from Loans PR-5); the monthly loan close posts them (PR-6).
        </div>
        <DateSelector {...dateProps} compact />
      </div>
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table-compact w-full">
            <thead><tr>
              <th>Loan</th><th>Borrower</th><th>Company</th><th>Type</th><th className="text-center">Instalment</th>
              <th className="text-right">Amount due</th><th>Status</th><th>Origin</th>
            </tr></thead>
            <tbody>
              {isLoading ? <tr><td colSpan={8} className="text-center py-8 text-slate-400">Loading…</td></tr>
                : error ? <tr><td colSpan={8} className="text-center py-8 text-red-600">Could not load the due list</td></tr>
                  : rows.length === 0 ? <tr><td colSpan={8} className="text-center py-8 text-slate-400">Nothing is due in {monthLabel(month, year)}.</td></tr>
                    : rows.map((r) => {
                      const l = loansById?.[r.loan_id]
                      return (
                        <tr key={r.instalment_id} className="cursor-pointer hover:bg-blue-50/50" onClick={() => navigate(`/loans/${r.loan_id}`)}>
                          <td className="text-xs text-blue-700">#{r.loan_id}</td>
                          <td>
                            <div className="text-sm">{l?.employee_name || r.employee_code}</div>
                            <div className="text-[11px] text-slate-400 font-mono">{r.employee_code}{l?.department ? ` · ${l.department}` : ''}</div>
                          </td>
                          <td className="text-xs">{r.company}</td>
                          <td className="text-xs">{r.loan_type}</td>
                          <td className="text-center text-xs">#{r.sequence}</td>
                          <td className="text-right font-mono">{rupees(r.amount_due)}</td>
                          <td><span className={`text-xs px-2 py-0.5 rounded-full ${stateCls(INSTALMENT_STATE, r.status)}`}>{stateLabel(INSTALMENT_STATE, r.status)}</span></td>
                          <td className="text-xs">{ORIGIN_LABEL[r.origin] || r.origin}</td>
                        </tr>
                      )
                    })}
            </tbody>
            {rows.length > 0 && (
              <tfoot><tr className="font-semibold">
                <td colSpan={5} className="text-right text-xs">Still to recover (scheduled + provisional) · posted</td>
                <td className="text-right font-mono">{rupees(totalOpen)}</td>
                <td colSpan={2} className="text-xs font-mono">posted {rupees(posted)}</td>
              </tr></tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  )
}
