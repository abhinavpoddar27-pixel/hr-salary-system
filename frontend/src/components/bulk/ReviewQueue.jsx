import React, { useMemo, useState } from 'react'
import clsx from 'clsx'
import ScrollTable from '../ui/ScrollTable'
import Button from '../ui/Button'
import Modal from '../ui/Modal'
import ConfirmDialog from '../ui/ConfirmDialog'
import { fmtINR2 } from '../../utils/formatters'

/**
 * ReviewQueue — a finance-style review list with filter chips, bulk selection and a fixed
 * action bar (P2-06). Extracted from the Extra Duty Finance Review tab (#79); that tab's
 * behaviour is the spec:
 *   - chips "Label (count)"; All = every row, other chips count rows whose statusOf matches;
 *   - rows ordered by `order[status]` (unknown = 9), stable;
 *   - header box ticks every row in the current view eligible for ANY action — except on the
 *     "all" filter, where only rows eligible for `allFilterActions` are ticked (so one click
 *     never mixes e.g. approve + return); disabled when there is nothing to tick;
 *   - a row box is disabled when the row is eligible for no action;
 *   - selection clears on filter change and after a successful action (a tab change on the
 *     page unmounts the queue, which clears it too);
 *   - fixed bottom bar "N selected · one button per action with eligible picks · Clear".
 *
 * Props
 *   rows, rowKey='id', statusOf(row)
 *   filters: [{ id, label, tone?: 'red'|'amber', rowClass? }]  — first should be { id: 'all' };
 *            null = plain list (no chips, every row)
 *   order: { [status]: rank } — null keeps the server order
 *   columns: ScrollTable columns; render(row, api) gets api.openAction(actionId, ids)
 *   rowProps(row): extra <tr> attributes (className is merged with the filter's rowClass)
 *   selectable: show boxes + bar (e.g. only for finance)
 *   allFilterActions: action ids the header box uses on the "all" filter
 *   actions: [{ id, label(n), variant, eligible(row), run(ids, reason?) → Promise,
 *               busy?, busyLabel?, needsReason?, minReasonLen=5, reasonTitle(n), reasonIntro,
 *               reasonPlaceholder, submitLabel, submitBusyLabel, submitVariant='primary',
 *               confirmText?(n, total), confirmTitle?, confirmLabel? }]
 *   moneyOf(row)?: number — shows the ₹ total of the selected rows in the bar
 *   filtersTestId='rq-filters', filterHint(counts, filterId)?, emptyText, emptyFilterText,
 *   maxHeight (ScrollTable window)
 * Toasts belong to the caller's run() (react-query onSuccess), not here.
 */
export default function ReviewQueue({
  rows,
  rowKey = 'id',
  statusOf,
  filters = null,
  order = null,
  columns,
  rowProps,
  selectable = false,
  allFilterActions = [],
  actions = [],
  moneyOf,
  filtersTestId = 'rq-filters',
  filterHint,
  emptyText = 'No rows',
  emptyFilterText = 'No rows in this filter',
  maxHeight,
}) {
  const [filter, setFilter] = useState('all')
  const [selected, setSelected] = useState([])
  const [reasonFor, setReasonFor] = useState(null)   // { action, ids }
  const [reason, setReason] = useState('')
  const [confirmFor, setConfirmFor] = useState(null) // { action, ids }
  const [running, setRunning] = useState(false)

  const idOf = (r) => (typeof rowKey === 'function' ? rowKey(r) : r[rowKey])
  const filterList = filters || []
  const filterById = useMemo(() => Object.fromEntries(filterList.map(f => [f.id, f])), [filters]) // eslint-disable-line react-hooks/exhaustive-deps

  const counts = useMemo(() => {
    const c = { all: rows.length }
    for (const f of filterList) if (f.id !== 'all') c[f.id] = 0
    for (const r of rows) { const s = statusOf(r); if (s !== 'all' && c[s] !== undefined) c[s]++ }
    return c
  }, [rows, filters, statusOf])

  const view = useMemo(() => {
    const list = filter === 'all' ? rows.slice() : rows.filter(r => statusOf(r) === filter)
    if (!order) return list
    return list.sort((a, b) => (order[statusOf(a)] ?? 9) - (order[statusOf(b)] ?? 9))
  }, [rows, filter, statusOf, order])

  // Eligible ids per action, over ALL rows (as in #79).
  const eligibleIds = useMemo(() => {
    const m = {}
    for (const a of actions) m[a.id] = rows.filter(r => a.eligible(r)).map(idOf)
    return m
  }, [rows, actions]) // eslint-disable-line react-hooks/exhaustive-deps
  const isEligibleAny = (id) => actions.some(a => eligibleIds[a.id].includes(id))

  const headerIds = useMemo(() => view
    .map(idOf)
    .filter(id => (filter === 'all'
      ? allFilterActions.some(aid => (eligibleIds[aid] || []).includes(id))
      : isEligibleAny(id))), [view, filter, allFilterActions, eligibleIds]) // eslint-disable-line react-hooks/exhaustive-deps
  const allSelected = headerIds.length > 0 && headerIds.every(id => selected.includes(id))
  const toggleSelectAll = () => setSelected(allSelected ? [] : headerIds)
  const toggleSelect = (id) => setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  const changeFilter = (id) => { setFilter(id); setSelected([]) }

  const selectedFor = (a) => selected.filter(id => eligibleIds[a.id].includes(id))
  const moneyTotal = (ids) => {
    if (!moneyOf) return 0
    const set = new Set(ids)
    return rows.reduce((s, r) => (set.has(idOf(r)) ? s + (Number(moneyOf(r)) || 0) : s), 0)
  }

  const runAction = (action, ids, why) => {
    setRunning(true)
    return Promise.resolve()
      .then(() => action.run(ids, why))
      .then(() => { setReasonFor(null); setReason(''); setConfirmFor(null); setSelected([]) })
      .catch(() => { /* caller's mutation shows the error; keep the window + selection */ })
      .finally(() => setRunning(false))
  }
  const openAction = (actionId, ids) => {
    const action = actions.find(a => a.id === actionId)
    if (!action || !ids?.length) return
    if (action.needsReason) { setReasonFor({ action, ids }); setReason(''); return }
    if (action.confirmText) { setConfirmFor({ action, ids }); return }
    runAction(action, ids)
  }
  const api = { openAction }

  const showBar = selectable && selected.length > 0
  const tableRowProps = (r) => {
    const extra = rowProps ? rowProps(r) || {} : {}
    return { ...extra, className: clsx(filterById[statusOf(r)]?.rowClass || '', extra.className) || undefined }
  }

  const leading = selectable ? {
    className: 'w-8',
    header: (
      <input type="checkbox"
        checked={allSelected}
        disabled={headerIds.length === 0}
        onChange={toggleSelectAll}
        data-testid="select-all"
        aria-label={filter === 'all' ? 'Select all unreviewed rows' : 'Select all rows in this view'}
        title={filter === 'all' ? 'Select all unreviewed rows' : 'Select all rows in this view'} />
    ),
    cell: (r) => {
      const id = idOf(r)
      return (
        <input type="checkbox"
          disabled={!isEligibleAny(id)}
          checked={selected.includes(id)}
          onChange={() => toggleSelect(id)} />
      )
    },
  } : null

  const ra = reasonFor?.action
  const reasonOk = reason.trim().length >= (ra?.minReasonLen ?? 5)

  return (
    <>
      {filters && <div className="flex flex-wrap items-center gap-2" data-testid={filtersTestId}>
        {filters.map(f => {
          const active = filter === f.id
          const n = counts[f.id] ?? 0
          return (
            <button key={f.id} type="button" onClick={() => changeFilter(f.id)}
              data-filter={f.id} aria-pressed={active ? 'true' : 'false'}
              className={clsx('px-3 py-1 rounded-full text-xs font-medium border transition-colors',
                active
                  ? (f.tone === 'red' ? 'bg-red-600 text-white border-red-600' : f.tone === 'amber' ? 'bg-amber-500 text-white border-amber-500' : 'bg-blue-600 text-white border-blue-600')
                  : (f.tone === 'red' && n > 0 ? 'bg-red-50 text-red-700 border-red-200 hover:bg-red-100' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'))}>
              {f.label} ({n})
            </button>
          )
        })}
        {filterHint ? filterHint(counts, filter) : null}
      </div>}

      <ScrollTable
        columns={columns}
        rows={view}
        rowKey={rowKey}
        rowProps={tableRowProps}
        leading={leading}
        api={api}
        maxHeight={maxHeight}
        emptyText={rows.length === 0 ? emptyText : emptyFilterText}
        testId="review-queue"
      />

      {/* Fixed action bar — stays on screen while a long list scrolls. */}
      {showBar && (
        <>
          <div className="h-20" aria-hidden="true" />
          <div data-testid="bulk-bar" className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 flex flex-wrap items-center gap-2 bg-white border border-slate-200 shadow-lg rounded-xl px-4 py-2.5">
            <span className="text-sm text-slate-700 font-medium">{selected.length} selected</span>
            {moneyOf && <span className="text-sm text-slate-500" data-testid="bulk-total">· {fmtINR2(moneyTotal(selected))}</span>}
            {actions.map(a => {
              const ids = selectedFor(a)
              if (ids.length === 0) return null
              return (
                <Button key={a.id} variant={a.variant || 'primary'} className="text-sm"
                  busy={!!a.busy} busyLabel={a.busyLabel}
                  onClick={() => openAction(a.id, ids)}>
                  {a.label(ids.length)}
                </Button>
              )
            })}
            <button type="button" onClick={() => setSelected([])} className="text-xs text-slate-500 hover:text-slate-800 px-2">Clear</button>
          </div>
        </>
      )}

      {reasonFor && (
        <Modal onClose={() => setReasonFor(null)} title={ra.reasonTitle ? ra.reasonTitle(reasonFor.ids.length) : 'Reason'}>
          <div className="space-y-3">
            {ra.reasonIntro && <p className="text-xs text-slate-600">{ra.reasonIntro}</p>}
            {ra.confirmText && <p className="text-xs text-slate-800 font-medium">{ra.confirmText(reasonFor.ids.length, moneyTotal(reasonFor.ids))}</p>}
            <textarea value={reason} onChange={e => setReason(e.target.value)}
              className="input w-full h-20" placeholder={ra.reasonPlaceholder || 'Reason (required)'} />
            <Button variant={ra.submitVariant || 'primary'} className="w-full"
              onClick={() => runAction(ra, reasonFor.ids, reason.trim())}
              disabled={!reasonOk || running}>
              {running ? (ra.submitBusyLabel || 'Working...') : (ra.submitLabel || 'Submit')}
            </Button>
          </div>
        </Modal>
      )}

      {confirmFor && (
        <ConfirmDialog
          title={confirmFor.action.confirmTitle || 'Please confirm'}
          message={confirmFor.action.confirmText(confirmFor.ids.length, moneyTotal(confirmFor.ids))}
          confirmText={running ? 'Working...' : (confirmFor.action.confirmLabel || 'Confirm')}
          variant={confirmFor.action.variant === 'danger' ? 'danger' : 'warning'}
          onCancel={() => { if (!running) setConfirmFor(null) }}
          onConfirm={() => { if (!running) runAction(confirmFor.action, confirmFor.ids) }}
        />
      )}
    </>
  )
}
