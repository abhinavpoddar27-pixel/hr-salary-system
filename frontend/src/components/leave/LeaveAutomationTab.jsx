import React, { useState, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import clsx from 'clsx'
import Modal from '../ui/Modal'
import ConfirmDialog from '../ui/ConfirmDialog'
import {
  getLeaveRecomputePreview, downloadLeaveRecomputePreview, applyLeaveRecompute,
  updateLeaveAutomationSettings, getLeaveChangeFlags, clearLeaveChangeFlag,
  uploadLeaveExternalGrants, acknowledgeNoExternalGrants,
  getLeaveExternalGrants, deleteLeaveExternalGrant, downloadLeaveLapseReport,
} from '../../utils/api'
import { fmtIstDateTime } from '../../utils/formatters'
import LeaveSwitchoverCard from './LeaveSwitchoverCard'

function saveBlob(res, filename) {
  const url = URL.createObjectURL(new Blob([res.data]))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function Card({ title, children, tone = 'default' }) {
  return (
    <div className={clsx('card p-4', tone === 'warn' && 'border-amber-300 bg-amber-50/40')}>
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">{title}</div>
      {children}
    </div>
  )
}

function Toggle({ label, hint, checked, onChange, disabled, busy }) {
  return (
    <label className="flex items-start gap-3 cursor-pointer">
      <input
        type="checkbox"
        className="mt-1"
        checked={!!checked}
        disabled={disabled || busy}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>
        <span className="block text-sm font-medium text-slate-800">
          {label}{' '}
          <span className={clsx('badge text-[10px] align-middle', checked ? 'badge-green' : 'badge-gray')}>
            {checked ? 'ON' : 'OFF'}
          </span>
        </span>
        <span className="block text-xs text-slate-500 mt-0.5">{hint}</span>
      </span>
    </label>
  )
}

/**
 * Admin-only control surface for leave automation.
 *
 * The apply button stays disabled until the owner has either uploaded the list
 * of earned leave given outside the system or said there is none — the backend
 * enforces the same rule, this just explains why.
 */
export default function LeaveAutomationTab({ year, status }) {
  const queryClient = useQueryClient()
  const fileRef = useRef(null)

  const [previewOpen, setPreviewOpen] = useState(false)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [dryRunResult, setDryRunResult] = useState(null)
  const [pendingFile, setPendingFile] = useState(null)
  const [dragOver, setDragOver] = useState(false)
  const [confirmText, setConfirmText] = useState('')
  const [applyNote, setApplyNote] = useState('')
  // P6-06: confirm before a switch change (A5/E1), "There is none" (E2) and removing an outside grant (A4).
  // { kind: 'switch', key, value } | { kind: 'ackNone' } | { kind: 'removeGrant', g }
  const [confirm, setConfirm] = useState(null)
  const confirmInFlight = useRef(false) // isPending lags a render — a double click must send one request

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['leave-automation-status'] })
    queryClient.invalidateQueries({ queryKey: ['leave-change-flags'] })
    queryClient.invalidateQueries({ queryKey: ['leave-change-flags-count'] })
    queryClient.invalidateQueries({ queryKey: ['leave-external-grants'] })
    queryClient.invalidateQueries({ queryKey: ['leave-balances-list'] })
    queryClient.invalidateQueries({ queryKey: ['leave-recompute-preview'] })
  }

  const automationOn = !!status?.automation_enabled
  const autoStage6On = !!status?.auto_stage6_enabled
  const grantsOnFile = status?.external_grants_on_file || 0
  const acknowledged = !!status?.external_grants_acknowledged
  const canApply = grantsOnFile > 0 || acknowledged

  const settings = useMutation({
    mutationFn: (data) => updateLeaveAutomationSettings(data),
    onSuccess: (res) => {
      toast.success(res?.data?.changed?.length ? 'Setting saved' : 'Already set')
      setConfirm(null)
      invalidate()
    },
    onError: (err) => toast.error(err?.response?.data?.error || 'Could not save the setting'),
    onSettled: () => { confirmInFlight.current = false },
  })

  const { data: flagsRes, isLoading: flagsLoading, isError: flagsError } = useQuery({
    queryKey: ['leave-change-flags', year],
    queryFn: () => getLeaveChangeFlags({ year }),
    retry: 0,
  })
  const flags = flagsRes?.data?.data || []

  const { data: grantsRes } = useQuery({
    queryKey: ['leave-external-grants', year],
    queryFn: () => getLeaveExternalGrants({ year }),
    retry: 0,
  })
  const grants = grantsRes?.data?.data || []

  const clearFlag = useMutation({
    mutationFn: (id) => clearLeaveChangeFlag(id),
    onSuccess: () => { toast.success('Flag cleared'); invalidate() },
    onError: (err) => toast.error(err?.response?.data?.error || 'Could not clear the flag'),
  })

  const preview = useQuery({
    queryKey: ['leave-recompute-preview', year],
    queryFn: () => getLeaveRecomputePreview({ year }),
    enabled: previewOpen,
    retry: 0,
  })
  const plan = preview.data?.data

  const apply = useMutation({
    mutationFn: () => applyLeaveRecompute({ year, confirm: true, note: applyNote.trim() || undefined }),
    onSuccess: (res) => {
      toast.success(`Applied — ${res?.data?.totals?.changed ?? 0} employee(s) changed`)
      setPreviewOpen(false)
      setConfirmText('')
      setApplyNote('')
      invalidate()
    },
    onError: (err) => toast.error(err?.response?.data?.error || 'Could not apply the recompute'),
  })

  const upload = useMutation({
    mutationFn: ({ file, dryRun }) => {
      const fd = new FormData()
      fd.append('file', file)
      return uploadLeaveExternalGrants(fd, dryRun)
    },
    onSuccess: (res, vars) => {
      setDryRunResult(res.data)
      if (!vars.dryRun) {
        toast.success(`${res.data.totals.accepted} row(s) recorded`)
        setUploadOpen(false)
        setPendingFile(null)
        invalidate()
      }
    },
    onError: (err) => toast.error(err?.response?.data?.error || 'Could not read that file'),
  })

  const ackNone = useMutation({
    mutationFn: () => acknowledgeNoExternalGrants(),
    onSuccess: () => { toast.success('Recorded — nothing was given outside the system'); setConfirm(null); invalidate() },
    onError: (err) => toast.error(err?.response?.data?.error || 'Could not record that'),
    onSettled: () => { confirmInFlight.current = false },
  })

  const removeGrant = useMutation({
    mutationFn: (id) => deleteLeaveExternalGrant(id),
    onSuccess: () => { toast.success('Grant removed'); setConfirm(null); invalidate() },
    onError: (err) => toast.error(err?.response?.data?.error || 'Could not remove that grant'),
    onSettled: () => { confirmInFlight.current = false },
  })

  const confirmBusy = settings.isPending || ackNone.isPending || removeGrant.isPending
  const runConfirm = () => {
    if (!confirm || confirmInFlight.current) return
    confirmInFlight.current = true
    if (confirm.kind === 'switch') settings.mutate({ [confirm.key]: confirm.value })
    else if (confirm.kind === 'ackNone') ackNone.mutate()
    else removeGrant.mutate(confirm.g.id)
  }
  const confirmCopy = (() => {
    if (!confirm) return null
    if (confirm.kind === 'switch' && confirm.key === 'automation_enabled') {
      return confirm.value
        ? { title: 'Turn leave automation on?', confirmText: 'Turn on', variant: 'danger',
            message: 'From now on, earned and casual leave balances are recalculated and saved for every employee whenever attendance or an approval changes. A finalized month is never changed.' }
        : { title: 'Turn leave automation off?', confirmText: 'Turn off', variant: 'danger',
            message: 'Leave balances stop updating until it is turned back on. Balances already saved stay as they are.' }
    }
    if (confirm.kind === 'switch') {
      return confirm.value
        ? { title: 'Turn automatic day calculation on?', confirmText: 'Turn on', variant: 'danger',
            message: 'Stage 6 will run by itself for a month the first time every miss punch in it is resolved by HR and decided by finance. Salary is not recomputed by this.' }
        : { title: 'Turn automatic day calculation off?', confirmText: 'Turn off', variant: 'danger',
            message: 'Stage 6 will run only when someone runs it by hand.' }
    }
    if (confirm.kind === 'ackNone') {
      return { title: 'Record that no leave was given outside the system?', confirmText: 'Record "none"', variant: 'danger',
        message: 'This unblocks writing leave balances from a recompute. It cannot be undone here — if you later find leave that was given outside the app, upload the list.' }
    }
    const g = confirm.g
    return { title: 'Remove this outside-the-system grant?', confirmText: 'Remove grant', variant: 'danger',
      message: `${g.employee_code} · ${g.leave_type || 'EL'} · ${g.days} day(s) · ${g.month}/${g.year} · ${String(g.mode).replace(/_/g, ' ')}. Balances recomputed after this will no longer count it. This cannot be undone here, and the same row cannot be uploaded again.` }
  })()

  const takeFile = (file) => {
    if (!file) return
    setPendingFile(file)
    setDryRunResult(null)
    upload.mutate({ file, dryRun: true })
  }

  return (
    <div className="space-y-5">
      {/* ── 2026 switchover (one-time) ─────────────────────────────────── */}
      <LeaveSwitchoverCard />

      {/* ── Switches ───────────────────────────────────────────────────── */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Switches">
          <div className="space-y-4">
            <Toggle
              label="Leave automation"
              hint="Recompute earned and casual leave whenever attendance or an approval changes. Off means nothing is written."
              checked={automationOn}
              busy={settings.isPending}
              onChange={(v) => setConfirm({ kind: 'switch', key: 'automation_enabled', value: v })}
            />
            <Toggle
              label="Automatic day calculation"
              hint="Run Stage 6 by itself the first time every miss punch for a month is resolved by HR and decided by finance."
              checked={autoStage6On}
              busy={settings.isPending}
              onChange={(v) => setConfirm({ kind: 'switch', key: 'auto_stage6_enabled', value: v })}
            />
          </div>
        </Card>

        <Card title="Queue and last runs">
          {!status ? (
            <div className="text-sm text-slate-400">Loading…</div>
          ) : (
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-600">Jobs waiting</span>
                <span className="font-mono font-semibold">{status.queue_depth ?? 0}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600">Last nightly sweep</span>
                <span className="text-slate-700">
                  {status.last_nightly?.started_at ? fmtIstDateTime(status.last_nightly.started_at) : 'not yet'}
                </span>
              </div>
              <div className="pt-2 border-t border-slate-100 space-y-1">
                {(status.last_runs || []).length === 0 ? (
                  <div className="text-xs text-slate-400">No recomputes recorded yet.</div>
                ) : (
                  status.last_runs.map((r) => (
                    <div key={r.scope} className="flex justify-between text-xs">
                      <span className="text-slate-500">{r.scope}</span>
                      <span className="text-slate-600">
                        {fmtIstDateTime(r.started_at)}{' '}
                        <span className={clsx('badge text-[10px]', r.status === 'ok' ? 'badge-green' : 'badge-yellow')}>
                          {r.status}
                        </span>
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </Card>
      </div>

      {/* ── Actions ────────────────────────────────────────────────────── */}
      <Card title="Earned leave">
        <div className="flex flex-wrap gap-2">
          <button className="btn-primary text-sm" onClick={() => setPreviewOpen(true)}>
            Preview EL recompute
          </button>
          <button className="btn-ghost text-sm" onClick={() => setUploadOpen(true)}>
            Upload leave-given list (EL / CL)
          </button>
          <button
            className="btn-ghost text-sm"
            onClick={() => downloadLeaveLapseReport({ year })
              .then((res) => saveBlob(res, `leave_lapse_${year}.csv`))
              .catch(() => toast.error('Could not build the lapse report'))}
          >
            Download lapse report
          </button>
        </div>
        <div className="mt-3 text-xs text-slate-600">
          {canApply ? (
            <span>
              {grantsOnFile > 0
                ? `${grantsOnFile} outside-the-system grant(s) on file for ${year}.`
                : 'Recorded: nothing was given outside the system.'}{' '}
              Applying a recompute is unblocked.
            </span>
          ) : (
            <span className="text-amber-700">
              Before balances can be written, upload the list of earned leave already given outside the
              system — or say there is none.{' '}
              <button
                className="underline font-medium"
                disabled={ackNone.isPending}
                onClick={() => setConfirm({ kind: 'ackNone' })}
              >
                There is none
              </button>
            </span>
          )}
        </div>

        {grants.length > 0 && (
          <div className="mt-3 overflow-x-auto">
            <table className="table-compact w-full text-xs">
              <thead>
                <tr>
                  <th>Code</th><th>Month</th><th>Type</th><th className="text-center">Days</th><th>How given</th><th>Remark</th><th />
                </tr>
              </thead>
              <tbody>
                {grants.map((g) => (
                  <tr key={g.id}>
                    <td className="font-mono">{g.employee_code}</td>
                    <td>{g.month}/{g.year}</td>
                    <td>{g.leave_type || 'EL'}</td>
                    <td className="text-center">{g.days}</td>
                    <td>{String(g.mode).replace(/_/g, ' ')}</td>
                    <td className="text-slate-500">{g.remark || '—'}</td>
                    <td className="text-right">
                      <button
                        className="text-red-600 hover:underline"
                        disabled={removeGrant.isPending}
                        onClick={() => setConfirm({ kind: 'removeGrant', g })}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* ── Flags ──────────────────────────────────────────────────────── */}
      <Card title="Changes that landed on a finalized month" tone={flags.length ? 'warn' : 'default'}>
        {flagsLoading ? (
          <div className="text-sm text-slate-400">Loading…</div>
        ) : flagsError ? (
          <div className="text-sm text-slate-400">Could not load the flags.</div>
        ) : flags.length === 0 ? (
          <div className="text-sm text-slate-500">
            Nothing outstanding. A finalized month is never recalculated — if something changes against
            one, it is listed here instead.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="table-compact w-full text-xs">
              <thead>
                <tr><th>Employee</th><th>Period</th><th>What changed</th><th>Detail</th><th>Raised</th><th /></tr>
              </thead>
              <tbody>
                {flags.map((f) => (
                  <tr key={f.id}>
                    <td className="font-mono">{f.employee_code || '—'}</td>
                    <td>{f.month}/{f.year}</td>
                    <td>{String(f.reason).replace(/_/g, ' ')}</td>
                    <td className="text-slate-500">{f.detail || '—'}</td>
                    <td className="text-slate-500">{fmtIstDateTime(f.created_at)}</td>
                    <td className="text-right">
                      <button
                        className="btn-ghost text-xs"
                        disabled={clearFlag.isPending}
                        onClick={() => clearFlag.mutate(f.id)}
                      >
                        Clear
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {confirmCopy && (
        <ConfirmDialog
          title={confirmCopy.title}
          message={<span data-testid="leave-auto-confirm">{confirmCopy.message}</span>}
          confirmText={confirmBusy ? 'Saving…' : confirmCopy.confirmText}
          variant={confirmCopy.variant}
          busy={confirmBusy}
          onConfirm={runConfirm}
          onCancel={() => setConfirm(null)}
        />
      )}

      {/* ── Preview modal ──────────────────────────────────────────────── */}
      <Modal open={previewOpen} onClose={() => setPreviewOpen(false)} title={`EL recompute preview — ${year}`} size="xl">
        <div className="p-4 space-y-4">
          {preview.isLoading ? (
            <div className="text-sm text-slate-400">Working out what would change…</div>
          ) : preview.isError ? (
            <div className="text-sm text-red-600">Could not build the preview.</div>
          ) : !plan ? null : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  { label: 'Employees', value: plan.totals.employees },
                  { label: 'Would change', value: plan.totals.changed },
                  { label: 'EL eligible', value: plan.totals.eligible },
                  { label: 'Net day change', value: plan.totals.net_delta },
                ].map((k) => (
                  <div key={k.label} className="bg-slate-50 rounded-lg p-3 text-center">
                    <div className="text-xl font-bold text-slate-800">{k.value}</div>
                    <div className="text-[11px] text-slate-500">{k.label}</div>
                  </div>
                ))}
              </div>

              {plan.unresolved_finance_rows?.length > 0 && (
                <div className="text-xs bg-amber-50 border border-amber-200 rounded-lg p-2 text-amber-800">
                  {plan.unresolved_finance_rows.length} balance movement(s) came from the finance
                  correction screen rather than a manual adjustment, and are excluded so they are not
                  counted twice.
                </div>
              )}

              <div className="max-h-80 overflow-auto border border-slate-200 rounded-lg">
                <table className="table-compact w-full text-xs">
                  <thead className="sticky top-0 bg-white">
                    <tr>
                      <th>Code</th>
                      <th className="text-center">Days worked</th>
                      <th className="text-center">Eligible</th>
                      <th className="text-center">Now</th>
                      <th className="text-center">New</th>
                      <th className="text-center">Change</th>
                      <th>Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {plan.employees.length === 0 ? (
                      <tr><td colSpan={7} className="text-center py-6 text-slate-400">No eligible employees.</td></tr>
                    ) : plan.employees.map((e) => (
                      <tr key={e.employee_code}>
                        <td className="font-mono">{e.employee_code}</td>
                        <td className="text-center">{e.days_worked_ytd}</td>
                        <td className="text-center">
                          {e.eligible
                            ? <span className="badge-green text-[10px]">yes</span>
                            : <span className="badge-yellow text-[10px]">{e.days_to_eligibility} to go</span>}
                        </td>
                        <td className="text-center">{e.current_balance}</td>
                        <td className="text-center font-semibold">{e.new_balance}</td>
                        <td className={clsx('text-center font-mono', e.delta > 0 ? 'text-green-700' : e.delta < 0 ? 'text-red-600' : 'text-slate-400')}>
                          {e.delta > 0 ? `+${e.delta}` : e.delta}
                        </td>
                        <td className="text-slate-500">{e.reasons?.join(' · ') || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-wrap items-end gap-3">
                <button
                  className="btn-ghost text-sm"
                  onClick={() => downloadLeaveRecomputePreview({ year })
                    .then((res) => saveBlob(res, `leave_recompute_preview_${year}.csv`))
                    .catch(() => toast.error('Could not download the CSV'))}
                >
                  Download CSV
                </button>
                <div className="flex-1 min-w-[16rem]">
                  <label className="text-xs font-medium text-slate-600 block mb-1">Note (optional)</label>
                  <input
                    className="input w-full text-sm"
                    value={applyNote}
                    onChange={(e) => setApplyNote(e.target.value)}
                    placeholder="Why you are applying this now"
                  />
                </div>
              </div>

              {!canApply ? (
                <div className="text-xs bg-amber-50 border border-amber-200 rounded-lg p-2 text-amber-800">
                  Applying is blocked until the outside-the-system EL list is uploaded, or you record
                  that there is none.
                </div>
              ) : (
                <div className="flex flex-wrap items-end gap-3">
                  <div className="flex-1 min-w-[16rem]">
                    <label className="text-xs font-medium text-slate-600 block mb-1">
                      Type <span className="font-mono">APPLY {year}</span> to confirm
                    </label>
                    <input
                      className="input w-full text-sm"
                      value={confirmText}
                      onChange={(e) => setConfirmText(e.target.value)}
                      placeholder={`APPLY ${year}`}
                    />
                  </div>
                  <button
                    className="btn-primary text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                    disabled={confirmText.trim() !== `APPLY ${year}` || apply.isPending}
                    onClick={() => apply.mutate()}
                  >
                    {apply.isPending ? 'Applying…' : 'Apply to balances'}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </Modal>

      {/* ── Upload modal ───────────────────────────────────────────────── */}
      <Modal open={uploadOpen} onClose={() => { setUploadOpen(false); setDryRunResult(null); setPendingFile(null) }}
        title="Upload leave (EL / CL) given outside the system" size="lg">
        <div className="p-4 space-y-4">
          <p className="text-sm text-slate-600">
            One row per grant. Columns: Employee Code, Employee Name, Company, Year, Month,
            Leave Type (EL or CL; blank means EL), Days (the older &ldquo;EL Days&rdquo; header still works),
            How Given (Leave taken / Paid in salary / Paid in cash &mdash; CL can only be Leave taken),
            Paid In Salary Month, Paid In Salary Year, Remark. CL taken outside the app counts as CL
            used, never as days worked; EL taken counts as days worked.
          </p>

          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); takeFile(e.dataTransfer.files?.[0]) }}
            onClick={() => fileRef.current?.click()}
            className={clsx(
              'border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors',
              dragOver ? 'border-brand-400 bg-brand-50' : 'border-slate-300 hover:border-slate-400'
            )}
          >
            <div className="text-sm text-slate-600">
              {pendingFile ? pendingFile.name : 'Drop the .xlsx or .csv here, or click to choose'}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={(e) => takeFile(e.target.files?.[0])}
            />
          </div>

          {upload.isPending && <div className="text-sm text-slate-400">Reading the sheet…</div>}

          {dryRunResult && (
            <>
              <div className="flex gap-4 text-sm">
                <span>{dryRunResult.totals.rows} row(s)</span>
                <span className="text-green-700">{dryRunResult.totals.accepted} accepted</span>
                <span className="text-red-600">{dryRunResult.totals.rejected} rejected</span>
              </div>
              <div className="max-h-64 overflow-auto border border-slate-200 rounded-lg">
                <table className="table-compact w-full text-xs">
                  <thead className="sticky top-0 bg-white">
                    <tr><th>Row</th><th>Code</th><th>Result</th><th>Why</th></tr>
                  </thead>
                  <tbody>
                    {dryRunResult.rows.map((r, i) => (
                      <tr key={i}>
                        <td>{r.row}</td>
                        <td className="font-mono">{r.employee_code || '—'}</td>
                        <td>
                          {r.accepted
                            ? <span className="badge-green text-[10px]">accepted</span>
                            : <span className="badge text-[10px] bg-red-100 text-red-700">rejected</span>}
                        </td>
                        <td className="text-slate-500">{r.accepted ? `${r.leave_type || 'EL'} ${r.days} day(s), ${String(r.mode).replace(/_/g, ' ')}` : r.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex justify-end gap-2">
                <button className="btn-ghost text-sm" onClick={() => { setDryRunResult(null); setPendingFile(null) }}>
                  Choose another file
                </button>
                <button
                  className="btn-primary text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                  disabled={!dryRunResult.totals.accepted || upload.isPending}
                  onClick={() => upload.mutate({ file: pendingFile, dryRun: false })}
                  title={dryRunResult.totals.accepted ? '' : 'Nothing in this file can be recorded'}
                >
                  Commit {dryRunResult.totals.accepted} row(s)
                </button>
              </div>
            </>
          )}
        </div>
      </Modal>
    </div>
  )
}
