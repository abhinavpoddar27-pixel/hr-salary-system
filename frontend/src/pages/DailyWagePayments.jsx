import React, { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getDWPendingLiability, getDWEntries, processDWPayment,
  getDWPayments, getDWPayment, getDWContractors, getDWPaymentSheet
} from '../utils/api'
import { useAppStore } from '../store/appStore'
import { canFinance as canFinanceFn } from '../utils/role'
import clsx from 'clsx'
import toast from 'react-hot-toast'

function fmt(n) { return (n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }

export default function DailyWagePayments() {
  const { user } = useAppStore()
  const canFinance = canFinanceFn(user)
  const qc = useQueryClient()

  const [activeTab, setActiveTab] = useState('pending')
  // Process payment state
  const [payContractorId, setPayContractorId] = useState(null)
  const [payContractorName, setPayContractorName] = useState('')
  const [selectedEntryIds, setSelectedEntryIds] = useState([])
  const [payRef, setPayRef] = useState('')
  const [payMethod, setPayMethod] = useState('Bank Transfer')
  const [payDate, setPayDate] = useState(new Date().toISOString().slice(0, 10))
  const [payRemarks, setPayRemarks] = useState('')
  const [showConfirm, setShowConfirm] = useState(false)
  // History state
  const [historySearch, setHistorySearch] = useState('')
  const [expandedPayId, setExpandedPayId] = useState(null)

  // ── Queries ─────────────────────────────────────────────────
  const { data: liabilityRes } = useQuery({
    queryKey: ['dw-pending-liability'],
    queryFn: getDWPendingLiability,
    retry: 0
  })
  const liabilities = liabilityRes?.data?.data || []
  const totalOutstanding = liabilities.reduce((s, l) => s + (l.total_liability || 0), 0)

  const { data: approvedRes } = useQuery({
    queryKey: ['dw-entries-approved-for-pay', payContractorId],
    queryFn: () => getDWEntries({ contractor_id: payContractorId, status: 'approved', limit: 200 }),
    retry: 0, enabled: !!payContractorId && activeTab === 'process'
  })
  const approvedEntries = approvedRes?.data?.data || []

  const { data: historyRes } = useQuery({
    queryKey: ['dw-payments-history'],
    queryFn: () => getDWPayments(),
    retry: 0
  })
  const payments = historyRes?.data?.data || []
  const filteredPayments = useMemo(() => {
    if (!historySearch) return payments
    const q = historySearch.toLowerCase()
    return payments.filter(p => p.payment_reference?.toLowerCase().includes(q) || p.contractor_name?.toLowerCase().includes(q))
  }, [payments, historySearch])

  // Auto-select all approved entries when switching to process tab
  React.useEffect(() => {
    if (activeTab === 'process' && approvedEntries.length > 0) {
      setSelectedEntryIds(approvedEntries.map(e => e.id))
    }
  }, [approvedEntries, activeTab])

  // ── Payment mutation ────────────────────────────────────────
  const payMut = useMutation({
    mutationFn: processDWPayment,
    onSuccess: () => {
      toast.success('Payment processed successfully')
      qc.invalidateQueries({ queryKey: ['dw-pending-liability'] })
      qc.invalidateQueries({ queryKey: ['dw-payments-history'] })
      qc.invalidateQueries({ queryKey: ['dw-entries-approved-for-pay'] })
      setActiveTab('history')
      resetPayForm()
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Payment failed')
  })

  const resetPayForm = () => {
    setPayContractorId(null); setPayContractorName(''); setSelectedEntryIds([])
    setPayRef(''); setPayMethod('Bank Transfer'); setPayRemarks(''); setShowConfirm(false)
  }

  const startPay = (contractor) => {
    setPayContractorId(contractor.contractor_id)
    setPayContractorName(contractor.contractor_name)
    setActiveTab('process')
  }

  const selectedTotal = useMemo(() =>
    approvedEntries.filter(e => selectedEntryIds.includes(e.id)).reduce((s, e) => s + (e.total_liability || 0), 0)
  , [approvedEntries, selectedEntryIds])

  const doPayment = () => {
    setShowConfirm(false)
    payMut.mutate({
      contractor_id: payContractorId,
      entry_ids: selectedEntryIds,
      payment_reference: payRef.trim(),
      payment_date: payDate,
      payment_method: payMethod,
      remarks: payRemarks.trim() || undefined
    })
  }

  const printSheet = async () => {
    try {
      const res = await getDWPaymentSheet(payContractorId, selectedEntryIds)
      const data = res?.data?.data
      if (!data) return toast.error('Failed to load payment sheet')
      const c = data.contractor
      const html = `<!DOCTYPE html><html><head><title>Payment Sheet - ${c.contractor_name}</title>
        <style>body{font-family:Arial,sans-serif;margin:20px;font-size:12px}h2{margin-bottom:4px}
        table{border-collapse:collapse;width:100%;margin:10px 0}th,td{border:1px solid #999;padding:6px 8px;text-align:left}
        th{background:#f0f0f0}tfoot td{font-weight:bold;background:#f9f9f9}.header{margin-bottom:15px}
        @media print{button{display:none}}</style></head><body>
        <div class="header"><h2>Payment Sheet</h2>
        <p><strong>${c.contractor_name}</strong> | Phone: ${c.phone_number || '—'} | Bank: ${c.bank_account || '—'}</p>
        <p>Date: ${payDate} | Reference: ${payRef || '—'} | Method: ${payMethod}</p></div>
        <table><thead><tr><th>Date</th><th>Time</th><th>Workers</th><th>Gate Ref</th><th>Wages</th><th>Commission</th><th>Total</th></tr></thead>
        <tbody>${data.entries.map(e => `<tr><td>${e.entry_date}</td><td>${e.in_time}-${e.out_time}</td><td>${e.total_worker_count}</td>
        <td>${e.gate_entry_reference}</td><td>${fmt(e.total_wage_amount)}</td><td>${fmt(e.total_commission_amount)}</td><td>${fmt(e.total_liability)}</td></tr>`).join('')}</tbody>
        <tfoot><tr><td colspan="4">Total (${data.totals.entry_count} entries, ${data.totals.total_workers} workers)</td>
        <td>${fmt(data.totals.total_wages)}</td><td>${fmt(data.totals.total_commission)}</td><td>${fmt(data.totals.total_liability)}</td></tr></tfoot></table>
        <button onclick="window.print()">Print</button></body></html>`
      const w = window.open('', '_blank')
      w.document.write(html)
      w.document.close()
    } catch { toast.error('Failed to generate payment sheet') }
  }

  // ── Role gate ───────────────────────────────────────────────
  if (!canFinance) {
    return (
      <div className="p-6 flex flex-col items-center justify-center min-h-[60vh] text-center">
        <div className="text-5xl mb-4">🔒</div>
        <h2 className="text-xl font-bold text-slate-700">Finance Access Required</h2>
        <p className="text-sm text-slate-500 mt-2">Only finance and admin users can access this page.</p>
      </div>
    )
  }

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div>
        <h1 className="text-xl font-bold text-slate-800">Payments</h1>
        <p className="text-sm text-slate-500 mt-0.5">Process payments to daily wage contractors</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-slate-200">
        {[
          { key: 'pending', label: 'Pending Liabilities' },
          { key: 'process', label: 'Process Payment' },
          { key: 'history', label: 'Payment History' }
        ].map(t => (
          <button key={t.key} onClick={() => setActiveTab(t.key)}
            className={clsx('px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
              activeTab === t.key ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-700')}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Pending Liabilities ──────────────────────────────── */}
      {activeTab === 'pending' && (
        <div className="space-y-3">
          {liabilities.length === 0 ? (
            <div className="text-center py-12 text-slate-400">No pending liabilities</div>
          ) : (
            <>
              <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                      <th className="px-4 py-3">Contractor</th>
                      <th className="px-4 py-3">Entries</th>
                      <th className="px-4 py-3">Wages Due</th>
                      <th className="px-4 py-3">Commission Due</th>
                      <th className="px-4 py-3">Total</th>
                      <th className="px-4 py-3">Terms</th>
                      <th className="px-4 py-3 w-20"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {liabilities.map(l => (
                      <tr key={l.contractor_id} className="hover:bg-slate-50">
                        <td className="px-4 py-3 font-medium text-slate-800">{l.contractor_name}</td>
                        <td className="px-4 py-3">{l.entry_count}</td>
                        <td className="px-4 py-3">{fmt(l.total_wages)}</td>
                        <td className="px-4 py-3">{fmt(l.total_commission)}</td>
                        <td className="px-4 py-3 font-semibold text-blue-700">{fmt(l.total_liability)}</td>
                        <td className="px-4 py-3 text-slate-500 capitalize">{l.payment_terms}</td>
                        <td className="px-4 py-3">
                          <button onClick={() => startPay(l)}
                            className="px-3 py-1 text-xs font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700">Pay</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-2 flex items-center justify-between">
                <span className="text-sm text-blue-700">Total Outstanding</span>
                <span className="text-lg font-bold text-blue-800">{fmt(totalOutstanding)}</span>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Process Payment ──────────────────────────────────── */}
      {activeTab === 'process' && (
        <div className="space-y-4">
          {!payContractorId ? (
            <div className="text-center py-12 text-slate-400">
              <p>Select a contractor from the Pending Liabilities tab to begin.</p>
            </div>
          ) : (
            <>
              <div className="bg-white rounded-lg border border-slate-200 p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold text-slate-800">{payContractorName}</h3>
                  <button onClick={resetPayForm} className="text-sm text-slate-500 hover:text-slate-700">Change</button>
                </div>

                {/* Entry selection */}
                <div className="space-y-1 max-h-60 overflow-y-auto">
                  {approvedEntries.length === 0 ? (
                    <p className="text-sm text-slate-400">No approved entries to pay</p>
                  ) : approvedEntries.map(e => (
                    <label key={e.id} className="flex items-center gap-3 px-2 py-1.5 rounded hover:bg-slate-50 cursor-pointer text-sm">
                      <input type="checkbox" checked={selectedEntryIds.includes(e.id)}
                        onChange={() => setSelectedEntryIds(prev => prev.includes(e.id) ? prev.filter(x => x !== e.id) : [...prev, e.id])}
                        className="rounded border-slate-300" />
                      <span className="text-slate-600">{e.entry_date}</span>
                      <span className="text-slate-500">{e.total_worker_count} workers</span>
                      <span className="ml-auto font-medium text-slate-700">{fmt(e.total_liability)}</span>
                    </label>
                  ))}
                </div>

                <div className="mt-3 bg-blue-50 rounded-lg p-3 flex items-center justify-between">
                  <span className="text-sm text-blue-700">{selectedEntryIds.length} entries selected</span>
                  <span className="text-lg font-bold text-blue-800">{fmt(selectedTotal)}</span>
                </div>
              </div>

              {/* Payment details */}
              <div className="bg-white rounded-lg border border-slate-200 p-4 space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Payment Reference *</label>
                    <input type="text" value={payRef} onChange={e => setPayRef(e.target.value)} placeholder="e.g. TXN-20260410-001"
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Payment Method</label>
                    <select value={payMethod} onChange={e => setPayMethod(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none">
                      <option>Bank Transfer</option><option>Cheque</option><option>Cash</option><option>UPI</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Payment Date</label>
                    <input type="date" value={payDate} onChange={e => setPayDate(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Remarks</label>
                  <textarea rows={2} value={payRemarks} onChange={e => setPayRemarks(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none resize-none" />
                </div>
              </div>

              <div className="flex justify-end gap-2">
                <button onClick={printSheet} disabled={selectedEntryIds.length === 0}
                  className="px-4 py-2 text-sm font-medium rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50 disabled:opacity-50">Print Payment Sheet</button>
                <button onClick={() => {
                  if (!payRef.trim()) return toast.error('Payment reference is required')
                  if (selectedEntryIds.length === 0) return toast.error('Select at least one entry')
                  setShowConfirm(true)
                }} disabled={payMut.isPending}
                  className="px-5 py-2 text-sm font-medium rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-50">
                  Mark as Paid
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Payment History ──────────────────────────────────── */}
      {activeTab === 'history' && (
        <div className="space-y-3">
          <input type="text" value={historySearch} onChange={e => setHistorySearch(e.target.value)}
            placeholder="Search by reference or contractor..."
            className="w-full max-w-sm px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" />

          {filteredPayments.length === 0 ? (
            <div className="text-center py-12 text-slate-400">No payments found</div>
          ) : (
            <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3">Contractor</th>
                    <th className="px-4 py-3">Amount</th>
                    <th className="px-4 py-3">Reference</th>
                    <th className="px-4 py-3">Method</th>
                    <th className="px-4 py-3">Processed By</th>
                    <th className="px-4 py-3 w-8"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredPayments.map(p => (
                    <React.Fragment key={p.id}>
                      <tr className={clsx('hover:bg-slate-50 cursor-pointer', expandedPayId === p.id && 'bg-blue-50/50')}
                        onClick={() => setExpandedPayId(expandedPayId === p.id ? null : p.id)}>
                        <td className="px-4 py-3">{p.payment_date}</td>
                        <td className="px-4 py-3 font-medium">{p.contractor_name}</td>
                        <td className="px-4 py-3 font-semibold text-blue-700">{fmt(p.total_amount)}</td>
                        <td className="px-4 py-3 text-slate-600">{p.payment_reference}</td>
                        <td className="px-4 py-3 text-slate-500">{p.payment_method || '—'}</td>
                        <td className="px-4 py-3 text-slate-500">{p.processed_by}</td>
                        <td className="px-4 py-3 text-slate-400">{expandedPayId === p.id ? '▲' : '▼'}</td>
                      </tr>
                      {expandedPayId === p.id && (
                        <tr><td colSpan={7} className="px-4 py-3 bg-slate-50/70">
                          <PaymentDetail paymentId={p.id} />
                        </td></tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Confirm dialog */}
      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowConfirm(false)} />
          <div className="relative bg-white rounded-lg shadow-xl p-6 w-full max-w-md">
            <h3 className="text-lg font-semibold text-slate-800 mb-2">Confirm Payment</h3>
            <p className="text-sm text-slate-600">
              Pay <strong>{fmt(selectedTotal)}</strong> to <strong>{payContractorName}</strong> for {selectedEntryIds.length} entries?
            </p>
            <p className="text-sm text-slate-500 mt-1">Reference: {payRef}</p>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setShowConfirm(false)} className="px-4 py-2 text-sm rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50">Cancel</button>
              <button onClick={doPayment} disabled={payMut.isPending}
                className="px-4 py-2 text-sm rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-50">
                {payMut.isPending ? 'Processing...' : 'Confirm Payment'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function PaymentDetail({ paymentId }) {
  const { data: res } = useQuery({
    queryKey: ['dw-payment-detail', paymentId],
    queryFn: () => getDWPayment(paymentId),
    retry: 0
  })
  const payment = res?.data?.data
  if (!payment) return <div className="text-sm text-slate-400">Loading...</div>

  return (
    <div className="space-y-2">
      {payment.remarks && <p className="text-sm text-slate-500">Remarks: {payment.remarks}</p>}
      <div className="text-xs font-medium text-slate-500 uppercase">Linked Entries ({payment.entries?.length || 0})</div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
        {(payment.entries || []).map(e => (
          <div key={e.id} className="bg-white rounded border border-slate-200 px-2 py-1.5 text-xs">
            <span className="font-medium text-slate-700">{e.entry_date}</span>
            <span className="text-slate-400 ml-2">{e.total_worker_count} workers</span>
            <span className="ml-auto float-right font-medium">{fmt(e.total_liability)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
