import React, { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import clsx from 'clsx'
import Modal from '../ui/Modal'
import { useAppStore } from '../../store/appStore'
import { normalizeRole } from '../../utils/role'
import { getLeaveSwitchoverPreview, applyLeaveSwitchover } from '../../utils/api'
import { fmtIstDateTime } from '../../utils/formatters'

const PHRASE = 'SWITCHOVER 2026'

function Tile({ label, value, tone = 'default' }) {
  return (
    <div className={clsx('rounded-lg border px-3 py-2', tone === 'warn' ? 'border-amber-200 bg-amber-50' : 'border-slate-200 bg-white')}>
      <div className="text-[11px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className="text-lg font-semibold text-slate-800">{value ?? '—'}</div>
    </div>
  )
}

function csvCell(v) {
  if (v === null || v === undefined) return ''
  const s = String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function downloadCsv(rows) {
  const header = ['Employee Code', 'Name', 'Department', 'Days Worked', 'EL Eligible',
    'EL Earned', 'EL Used', 'EL Outside App', 'EL Adjustments', 'EL Balance',
    'CL Opening', 'CL Used', 'CL Outside App', 'CL Adjustments', 'CL Balance', 'Total', 'Notes']
  const body = rows.map((e) => [e.code, e.name, e.department, e.days_worked, e.eligible ? 'yes' : 'no',
    e.el.earned, e.el.used, e.el.external, e.el.adjustments, e.el.balance,
    e.cl.opening, e.cl.used, e.cl.external, e.cl.adjustments, e.cl.balance, e.total, (e.reasons || []).join(' | ')])
  const text = '﻿' + [header, ...body].map((r) => r.map(csvCell).join(',')).join('\r\n')
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = 'leave_switchover_2026_preview.csv'
  a.click()
  URL.revokeObjectURL(url)
}

/**
 * One-time 2026 leave switchover (owner rulings R-A…R-H). Admin only.
 * Preview is a rolled-back dry run; Apply backs the database up first and needs
 * the typed phrase. Neither applies balances or switches automation on.
 */
export default function LeaveSwitchoverCard() {
  const user = useAppStore((s) => s.user)
  const isAdmin = normalizeRole(user?.role) === 'admin'
  const queryClient = useQueryClient()

  const [requested, setRequested] = useState(false)
  const [filter, setFilter] = useState('')
  const [onlyAttention, setOnlyAttention] = useState(false)
  const [applyOpen, setApplyOpen] = useState(false)
  const [typed, setTyped] = useState('')
  const [note, setNote] = useState('')
  const [applied, setApplied] = useState(null)
  const [backupPath, setBackupPath] = useState(null)

  const preview = useQuery({
    queryKey: ['leave-switchover-2026-preview'],
    queryFn: () => getLeaveSwitchoverPreview(),
    enabled: isAdmin && requested,
    retry: 0,
  })
  const data = applied || preview.data?.data
  const done = !!(applied || data?.already_applied)

  const apply = useMutation({
    mutationFn: () => applyLeaveSwitchover({ confirm: typed.trim(), note: note.trim() || undefined }),
    onSuccess: (res) => {
      setApplied(res.data)
      setBackupPath(res.data.backup_path)
      setApplyOpen(false)
      setTyped('')
      setNote('')
      toast.success(`Switchover applied — ${res.data.totals.retyped} retyped. Backup saved.`)
      queryClient.invalidateQueries({ queryKey: ['leave-switchover-2026-preview'] })
      queryClient.invalidateQueries({ queryKey: ['leave-automation-status'] })
      queryClient.invalidateQueries({ queryKey: ['leave-recompute-preview'] })
      queryClient.invalidateQueries({ queryKey: ['leave-balances-list'] })
    },
    onError: (err) => toast.error(err?.response?.data?.error || 'Could not apply the switchover'),
  })

  const rows = useMemo(() => {
    const list = data?.employees || []
    const q = filter.trim().toLowerCase()
    return list.filter((e) => {
      if (onlyAttention && !(e.el.balance < 0 || e.cl.balance < 0 || (e.reasons || []).some((r) => r.startsWith('Possible double count')))) return false
      if (!q) return true
      return [e.code, e.name, e.department].some((v) => String(v || '').toLowerCase().includes(q))
    })
  }, [data, filter, onlyAttention])

  if (!isAdmin) return null
  const t = data?.totals
  // Backup space (preview only; null once applied or when the server can't measure).
  const bc = !done ? data?.backup_check : null
  const noSpace = !!(bc && bc.ok === false)

  return (
    <div className="card p-4 border-brand-200">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">2026 switchover</div>
          <p className="text-sm text-slate-600 mt-1 max-w-3xl">
            Retypes the 98 SILP/Worker employees the owner ruled Permanent, sets EL to 1 per 21 days worked
            (from 180 days) and CL to 4 by joining quarter, offsets HR&rsquo;s three hand credits and resets
            the 2026 openings. It does not apply balances and does not switch automation on.
          </p>
        </div>
        <div className="flex gap-2">
          <button className="btn-ghost text-sm"
            onClick={() => { setApplied(null); if (requested) preview.refetch(); else setRequested(true) }}
            disabled={preview.isFetching}>
            {preview.isFetching ? 'Previewing…' : 'Preview'}
          </button>
          <button className="btn-primary text-sm disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={!data || done || apply.isPending || noSpace}
            title={noSpace ? 'Not enough free space on the volume for the backup' : undefined}
            onClick={() => setApplyOpen(true)}>
            Apply
          </button>
        </div>
      </div>

      {preview.isError && (
        <div className="mt-3 text-xs bg-red-50 border border-red-200 rounded-lg p-2 text-red-700">
          {preview.error?.response?.data?.error || 'Preview failed'}
        </div>
      )}

      {bc && (
        <div className={clsx('mt-3 text-xs rounded-lg p-2 border',
          bc.ok ? 'bg-slate-50 border-slate-200 text-slate-600' : 'bg-red-50 border-red-200 text-red-700')}>
          {bc.ok ? 'The backup taken before Apply ' : 'Apply is blocked: the backup '}
          needs about {bc.needed_mb} MB
          {bc.space_known ? <>; {bc.free_mb} MB free on the volume</> : <>; free space could not be measured</>}
          {bc.reclaimable_mb > 0 && <> (+{bc.reclaimable_mb} MB from {bc.stale_files.length} leftover file{bc.stale_files.length === 1 ? '' : 's'} of failed attempts, removed automatically on Apply)</>}
          .{!bc.ok && <> Grow the Railway volume, then click Preview again.</>}
        </div>
      )}

      {done && (
        <div className="mt-3 text-sm bg-green-50 border border-green-200 rounded-lg p-3 text-green-800">
          <div className="font-medium">
            Applied{data?.applied_at ? ` on ${fmtIstDateTime(data.applied_at)}` : ''}.
            {backupPath && <span className="font-normal"> Backup: <span className="font-mono text-xs">{backupPath}</span></span>}
          </div>
          <div className="mt-1">Next: Preview EL recompute &rarr; Apply in this tab, then turn Automation ON.</div>
        </div>
      )}

      {data && (
        <div className="mt-4 space-y-4">
          <div className="grid gap-2 grid-cols-2 md:grid-cols-4 lg:grid-cols-6">
            <Tile label="Retyped" value={t.retyped} />
            <Tile label="Skipped" value={t.skipped} tone={t.skipped ? 'warn' : 'default'} />
            <Tile label="Policy keys changed" value={t.policy_changed} />
            <Tile label="CL / EL openings reset" value={`${t.cl_openings_changed} / ${t.el_openings_changed}`} />
            <Tile label="Offsets" value={t.offsets} />
            <Tile label="Employees in plan" value={t.employees} />
            <Tile label="EL eligible" value={t.el_eligible} />
            <Tile label="EL total" value={t.el_total} />
            <Tile label="CL total" value={t.cl_total} />
            <Tile label="Negative balances" value={t.negative_balances} tone={t.negative_balances ? 'warn' : 'default'} />
            <Tile label="Possible double counts" value={t.double_count_flags} tone={t.double_count_flags ? 'warn' : 'default'} />
            <Tile label="Category still SILP/Worker" value={t.category_revert_risk} tone={t.category_revert_risk ? 'warn' : 'default'} />
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="text-xs border border-slate-200 rounded-lg p-3">
              <div className="font-semibold text-slate-600 mb-1">Policy</div>
              {data.policy.map((p) => (
                <div key={p.key} className="flex justify-between">
                  <span className="font-mono text-slate-500">{p.key}</span>
                  <span className={clsx(p.changed ? 'text-slate-800 font-medium' : 'text-slate-400')}>
                    {p.before ?? '—'} &rarr; {p.after}
                  </span>
                </div>
              ))}
            </div>
            <div className="text-xs border border-slate-200 rounded-lg p-3">
              <div className="font-semibold text-slate-600 mb-1">Hand credits offset</div>
              {data.offsets.map((o) => (
                <div key={o.offsets_txn_id} className="flex justify-between gap-2">
                  <span>#{o.offsets_txn_id} · {o.employee_code} {o.leave_type} {o.days}</span>
                  <span className={clsx(o.status === 'skipped' ? 'text-amber-700' : 'text-slate-600')}>
                    {o.status === 'skipped' ? o.reason : o.status === 'added' ? 'offset added' : 'will be offset'}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {(data.double_count_flags?.length > 0 || data.retype.skipped.some((s) => !(done && s.reason === 'Already Permanent')) || t.category_revert_risk > 0) && (
            <div className="text-xs bg-amber-50 border border-amber-200 rounded-lg p-3 text-amber-800 space-y-1">
              {data.double_count_flags.map((f) => (
                <div key={`${f.code}-${f.month}`}><span className="font-mono">{f.code}</span>: {f.text}</div>
              ))}
              {data.retype.skipped.filter((s) => !(done && s.reason === 'Already Permanent')).map((s) => (
                <div key={s.code}><span className="font-mono">{s.code}</span> not retyped: {s.reason}</div>
              ))}
              {t.category_revert_risk > 0 && (
                <div>
                  {t.category_revert_risk} retyped employee(s) still carry category SILP/Worker. A later bulk employee import
                  derives the type from category and could set them back — check the sheet before any bulk import.
                </div>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <input className="input text-sm w-64" placeholder="Filter by code, name or department"
              value={filter} onChange={(e) => setFilter(e.target.value)} />
            <label className="text-xs text-slate-600 flex items-center gap-1">
              <input type="checkbox" checked={onlyAttention} onChange={(e) => setOnlyAttention(e.target.checked)} />
              Only negatives and possible double counts
            </label>
            <span className="text-xs text-slate-400">{rows.length} of {data.employees.length}</span>
            <button className="btn-ghost text-sm ml-auto" onClick={() => downloadCsv(rows)}>Download CSV</button>
          </div>

          <div className="max-h-96 overflow-auto border border-slate-200 rounded-lg">
            <table className="table-compact w-full text-xs">
              <thead className="sticky top-0 bg-white">
                <tr>
                  <th>Code</th><th>Name</th><th>Dept</th>
                  <th className="text-center">Days worked</th>
                  <th className="text-center">EL earned</th><th className="text-center">EL used</th>
                  <th className="text-center">EL outside</th><th className="text-center">EL bal</th>
                  <th className="text-center">CL open</th><th className="text-center">CL used</th>
                  <th className="text-center">CL outside</th><th className="text-center">CL bal</th>
                  <th className="text-center">Total</th><th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr><td colSpan={14} className="text-center py-6 text-slate-400">No rows.</td></tr>
                ) : rows.map((e) => (
                  <tr key={e.code}>
                    <td className="font-mono">{e.code}</td>
                    <td>{e.name || '—'}</td>
                    <td className="text-slate-500">{e.department || '—'}</td>
                    <td className="text-center">{e.days_worked}</td>
                    <td className="text-center">{e.el.earned}</td>
                    <td className="text-center">{e.el.used}</td>
                    <td className="text-center">{e.el.external}</td>
                    <td className={clsx('text-center font-semibold', e.el.balance < 0 && 'text-red-600')}>{e.el.balance}</td>
                    <td className="text-center">{e.cl.opening}</td>
                    <td className="text-center">{e.cl.used}</td>
                    <td className="text-center">{e.cl.external}</td>
                    <td className={clsx('text-center font-semibold', e.cl.balance < 0 && 'text-red-600')}>{e.cl.balance}</td>
                    <td className="text-center">{e.total}</td>
                    <td className="text-slate-500">{e.reasons?.join(' · ') || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Modal open={applyOpen} onClose={() => setApplyOpen(false)} title="Apply the 2026 leave switchover" size="md">
        <div className="p-4 space-y-3 text-sm">
          <p className="text-slate-600">
            The database is backed up first. Then, in one step: {t?.retyped ?? 0} employee(s) become Permanent,
            {' '}{t?.policy_changed ?? 0} policy key(s) change, {t?.offsets ?? 0} hand credit(s) are offset and
            {' '}{(t?.cl_openings_changed ?? 0) + (t?.el_openings_changed ?? 0)} 2026 opening(s) are reset.
            Balances are not applied and automation stays off. This can only be done once.
          </p>
          <div>
            <label className="text-xs font-medium text-slate-600 block mb-1">Note (optional)</label>
            <input className="input w-full text-sm" value={note} onChange={(e) => setNote(e.target.value)}
              placeholder="Why you are applying this now" />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-600 block mb-1">
              Type <span className="font-mono">{PHRASE}</span> to confirm
            </label>
            <input className="input w-full text-sm" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={PHRASE} />
          </div>
          <div className="flex justify-end gap-2">
            <button className="btn-ghost text-sm" onClick={() => setApplyOpen(false)}>Cancel</button>
            <button className="btn-primary text-sm disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={typed.trim() !== PHRASE || apply.isPending} onClick={() => apply.mutate()}>
              {apply.isPending ? 'Applying…' : 'Apply switchover'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
