import React, { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import clsx from 'clsx'
import {
  salesTaDaRequestsList,
  salesTaDaRequestApprove,
  salesTaDaRequestReject,
} from '../../utils/api'
import { useAppStore } from '../../store/appStore'
import Modal from '../../components/ui/Modal'
import ConfirmDialog from '../../components/ui/ConfirmDialog'
import {
  classLabel,
  RATE_FIELD_LABELS,
  STATUS_BADGE,
  relativeTime,
} from '../../utils/taDaClassLabels'

const STATUS_OPTIONS = ['pending', 'approved', 'rejected', 'superseded', 'cancelled', 'all']

// Render a small inline diff for fields that actually changed.
function ChangeSummary({ r }) {
  const fields = [
    ['Class',  'old_ta_da_class',         'new_ta_da_class'],
    ['DA',     'old_da_rate',             'new_da_rate'],
    ['DA-out', 'old_da_outstation_rate',  'new_da_outstation_rate'],
    ['TA-pri', 'old_ta_rate_primary',     'new_ta_rate_primary'],
    ['TA-sec', 'old_ta_rate_secondary',   'new_ta_rate_secondary'],
  ]
  const changes = fields.filter(([, ok, nk]) => String(r[ok] ?? '') !== String(r[nk] ?? ''))
  if (changes.length === 0) return <span className="text-xs text-slate-400">no rate changes</span>
  return (
    <div className="flex flex-wrap gap-2 text-xs">
      {changes.map(([lab, ok, nk]) => (
        <span key={lab} className="inline-flex items-center gap-1 bg-slate-50 border border-slate-200 rounded px-1.5 py-0.5">
          <span className="text-slate-500">{lab}:</span>
          <span className="font-mono text-slate-600">{r[ok] ?? '—'}</span>
          <span className="text-slate-400">→</span>
          <span className="font-mono text-slate-900 font-medium">{r[nk] ?? '—'}</span>
        </span>
      ))}
    </div>
  )
}

function FullDiffTable({ r }) {
  const fields = [
    ['Class',  'old_ta_da_class',         'new_ta_da_class'],
    ['DA',     'old_da_rate',             'new_da_rate'],
    ['DA-out', 'old_da_outstation_rate',  'new_da_outstation_rate'],
    ['TA-pri', 'old_ta_rate_primary',     'new_ta_rate_primary'],
    ['TA-sec', 'old_ta_rate_secondary',   'new_ta_rate_secondary'],
    ['Notes',  'old_ta_da_notes',         'new_ta_da_notes'],
  ]
  return (
    <table className="w-full text-xs border border-slate-200 rounded">
      <thead className="bg-slate-50 text-slate-600">
        <tr>
          <th className="px-2 py-1 text-left">Field</th>
          <th className="px-2 py-1 text-left">Old</th>
          <th className="px-2 py-1 text-left">New</th>
        </tr>
      </thead>
      <tbody>
        {fields.map(([lab, ok, nk]) => {
          const ov = r[ok], nv = r[nk]
          const changed = String(ov ?? '') !== String(nv ?? '')
          return (
            <tr key={lab} className={clsx('border-t border-slate-100', changed && 'bg-amber-50')}>
              <td className="px-2 py-1 text-slate-500">{lab}</td>
              <td className="px-2 py-1 font-mono text-slate-600">{ov ?? '—'}</td>
              <td className={clsx('px-2 py-1 font-mono', changed ? 'text-slate-900 font-medium' : 'text-slate-600')}>
                {nv ?? '—'}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function RejectModal({ request, onClose, onSubmitted }) {
  const [reason, setReason] = useState('')
  const mutation = useMutation({
    mutationFn: ({ id, rejection_reason }) => salesTaDaRequestReject(id, { rejection_reason }),
    onSuccess: () => {
      toast.success('Request rejected')
      onSubmitted && onSubmitted()
      onClose()
    },
    onError: (err) => {
      const status = err?.response?.status
      const msg = err?.response?.data?.error || 'Reject failed'
      if (status === 409) {
        const actual = err?.response?.data?.actual_status
        toast.error(`Already ${actual || 'resolved'} by someone else`)
        onSubmitted && onSubmitted()
        onClose()
      } else {
        toast.error(msg)
      }
    },
  })

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!reason.trim()) {
      toast.error('Rejection reason is required')
      return
    }
    mutation.mutate({ id: request.id, rejection_reason: reason.trim() })
  }

  return (
    <Modal open onClose={onClose} title={`Reject request #${request.id} — ${request.employee_code}`} size="md">
      <form onSubmit={handleSubmit} className="space-y-4">
        <p className="text-xs text-slate-600">
          Tell HR why this change is being rejected. The reason will be visible on the request.
        </p>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Rejection reason *</label>
          <textarea rows={4} value={reason} onChange={e => setReason(e.target.value)}
            placeholder="e.g. Wrong class — should be Class 4 not Class 3 per HR policy"
            className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm" />
        </div>
        <div className="flex justify-end gap-2 pt-2 border-t">
          <button type="button" onClick={onClose}
            className="px-3 py-1.5 text-sm rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700">
            Cancel
          </button>
          <button type="submit" disabled={mutation.isPending}
            className="px-4 py-1.5 text-sm rounded-lg bg-red-600 hover:bg-red-700 text-white disabled:bg-slate-400">
            {mutation.isPending ? 'Rejecting…' : 'Reject request'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

export default function SalesTaDaApprovals() {
  const qc = useQueryClient()
  const { user } = useAppStore()
  const currentUsername = user?.username || ''

  const [statusFilter, setStatusFilter] = useState('pending')
  const [expandedId, setExpandedId] = useState(null)
  const [confirmApprove, setConfirmApprove] = useState(null)  // request or null
  const [rejectFor, setRejectFor] = useState(null)            // request or null

  const params = useMemo(() => {
    return statusFilter && statusFilter !== 'all' ? { status: statusFilter } : {}
  }, [statusFilter])

  const { data: res, isLoading, refetch } = useQuery({
    queryKey: ['ta-da-approvals-list', params],
    queryFn: () => salesTaDaRequestsList(params),
    retry: 0,
  })
  const requests = res?.data?.data || []

  const approveMut = useMutation({
    mutationFn: (id) => salesTaDaRequestApprove(id),
    onSuccess: () => {
      toast.success('Request approved — employee rates updated')
      qc.invalidateQueries({ queryKey: ['ta-da-approvals-list'] })
      qc.invalidateQueries({ queryKey: ['ta-da-pending-list'] })
      qc.invalidateQueries({ queryKey: ['ta-da-pending-count'] })
      qc.invalidateQueries({ queryKey: ['sales-employees'] })
      setConfirmApprove(null)
    },
    onError: (err) => {
      const status = err?.response?.status
      const msg = err?.response?.data?.error || 'Approve failed'
      if (status === 403) {
        toast.error("You can't approve your own request")
      } else if (status === 409) {
        const actual = err?.response?.data?.actual_status
        toast.error(`Already ${actual || 'resolved'} by someone else`)
      } else {
        toast.error(msg)
      }
      qc.invalidateQueries({ queryKey: ['ta-da-approvals-list'] })
      setConfirmApprove(null)
    },
  })

  const refreshAll = () => {
    qc.invalidateQueries({ queryKey: ['ta-da-approvals-list'] })
    qc.invalidateQueries({ queryKey: ['ta-da-pending-list'] })
    qc.invalidateQueries({ queryKey: ['ta-da-pending-count'] })
    qc.invalidateQueries({ queryKey: ['sales-employees'] })
  }

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-800">TA/DA Approvals</h1>
          <p className="text-xs text-slate-500">Sales rate change requests submitted by HR. You cannot approve your own requests.</p>
        </div>
        <div className="flex items-center gap-2">
          <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setExpandedId(null) }}
            className="border border-slate-300 rounded px-2 py-1 text-xs bg-white capitalize">
            {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <button onClick={() => refetch()}
            className="px-3 py-1.5 text-sm rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700">
            Refresh
          </button>
        </div>
      </div>

      <div className="bg-white rounded-lg border border-slate-200 overflow-x-auto">
        <table className="min-w-[1000px] w-full text-sm">
          <thead className="bg-slate-50 text-slate-600 text-xs uppercase">
            <tr>
              <th className="px-3 py-2 text-left w-10"></th>
              <th className="px-3 py-2 text-left">#</th>
              <th className="px-3 py-2 text-left">Employee</th>
              <th className="px-3 py-2 text-left">Change</th>
              <th className="px-3 py-2 text-left">Requested</th>
              <th className="px-3 py-2 text-left">Status</th>
              <th className="px-3 py-2 text-left">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-slate-400 text-xs">Loading…</td></tr>
            )}
            {!isLoading && requests.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-12 text-center text-slate-400 text-sm">
                No {statusFilter === 'all' ? '' : statusFilter} requests.
              </td></tr>
            )}
            {requests.map(r => {
              const expanded = expandedId === r.id
              const badge = STATUS_BADGE[r.status] || { label: r.status, classes: 'bg-slate-100 text-slate-700' }
              const isOwnRequest = r.requested_by === currentUsername
              return (
                <React.Fragment key={r.id}>
                  <tr className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer"
                      onClick={() => setExpandedId(expanded ? null : r.id)}>
                    <td className="px-3 py-2 text-slate-400 text-xs">{expanded ? '▼' : '▸'}</td>
                    <td className="px-3 py-2 font-mono text-xs text-slate-500">{r.id}</td>
                    <td className="px-3 py-2">
                      <div className="font-mono text-xs text-slate-500">{r.employee_code}</div>
                      <div className="text-sm font-medium text-slate-800">{r.employee_name || '—'}</div>
                    </td>
                    <td className="px-3 py-2"><ChangeSummary r={r} /></td>
                    <td className="px-3 py-2 text-xs">
                      <div className="text-slate-700">{r.requested_by}</div>
                      <div className="text-slate-500">{relativeTime(r.requested_at)}</div>
                    </td>
                    <td className="px-3 py-2">
                      <span className={clsx('inline-block px-2 py-0.5 rounded-full text-xs font-medium border', badge.classes)}>
                        {badge.label}
                      </span>
                    </td>
                    <td className="px-3 py-2" onClick={e => e.stopPropagation()}>
                      {r.status === 'pending' ? (
                        <div className="flex gap-2 text-xs">
                          <button
                            onClick={() => setConfirmApprove(r)}
                            disabled={isOwnRequest}
                            title={isOwnRequest ? "You can't approve your own request" : 'Approve and update employee rates'}
                            className="px-2 py-1 rounded bg-green-600 hover:bg-green-700 text-white disabled:bg-slate-300 disabled:cursor-not-allowed">
                            Approve
                          </button>
                          <button
                            onClick={() => setRejectFor(r)}
                            disabled={isOwnRequest}
                            title={isOwnRequest ? "You can't reject your own request" : 'Reject with reason'}
                            className="px-2 py-1 rounded bg-red-600 hover:bg-red-700 text-white disabled:bg-slate-300 disabled:cursor-not-allowed">
                            Reject
                          </button>
                        </div>
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                    </td>
                  </tr>
                  {expanded && (
                    <tr className="bg-slate-50 border-t border-slate-100">
                      <td colSpan={7} className="px-3 py-3">
                        <div className="space-y-3 max-w-3xl">
                          <FullDiffTable r={r} />
                          {r.reason && (
                            <div className="text-xs text-slate-700 bg-white border border-slate-200 rounded p-2">
                              <strong>Reason:</strong> {r.reason}
                            </div>
                          )}
                          {r.new_ta_da_notes && (
                            <div className="text-xs text-slate-600">
                              <strong>Notes:</strong> {r.new_ta_da_notes}
                            </div>
                          )}
                          {r.rejection_reason && (
                            <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2">
                              <strong>Rejection reason:</strong> {r.rejection_reason}
                            </div>
                          )}
                          {r.resolved_by && (
                            <div className="text-xs text-slate-500">
                              Resolved by <strong className="text-slate-700">{r.resolved_by}</strong> {relativeTime(r.resolved_at)}
                            </div>
                          )}
                          {r.superseded_by_request_id && (
                            <div className="text-xs text-slate-500">Superseded by request #{r.superseded_by_request_id}</div>
                          )}
                          {r.applied_at && (
                            <div className="text-xs text-green-700">Applied to employee on {r.applied_at}</div>
                          )}
                          {isOwnRequest && r.status === 'pending' && (
                            <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded p-2">
                              You submitted this request. Approval/rejection is disabled — another reviewer must resolve it.
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              )
            })}
          </tbody>
        </table>
      </div>

      {confirmApprove && (
        <ConfirmDialog
          title={`Approve request #${confirmApprove.id}?`}
          message={`This will update ${confirmApprove.employee_code}'s live TA/DA rates immediately. Future TA/DA computations will use the new values. Proceed?`}
          confirmText="Approve & apply"
          cancelText="Cancel"
          onCancel={() => setConfirmApprove(null)}
          onConfirm={() => approveMut.mutate(confirmApprove.id)}
        />
      )}

      {rejectFor && (
        <RejectModal
          request={rejectFor}
          onClose={() => setRejectFor(null)}
          onSubmitted={refreshAll}
        />
      )}
    </div>
  )
}
