import React, { useState } from 'react'
import Button from '../ui/Button'
import { getEdPeopleOnDate } from '../../utils/bulkApi'
import { fmtDate } from '../../utils/formatters'

/**
 * CopyFromDate (P3-01) — "add everyone who was granted on an earlier date".
 * Props: onAdd(codes, info) · activeCodes (Set of codes that are Active in the master;
 * people who have left since are not added and are counted in the message).
 */
export default function CopyFromDate({ onAdd, activeCodes }) {
  const [date, setDate] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  const run = async () => {
    if (!date) return
    setBusy(true); setMsg('')
    try {
      const res = await getEdPeopleOnDate(date)
      const people = res?.data?.data || []
      const codes = people.map(p => String(p.code))
      const keep = activeCodes ? codes.filter(c => activeCodes.has(c)) : codes
      const left = codes.length - keep.length
      onAdd?.(keep, { date, total: codes.length, left })
      setMsg(codes.length
        ? `${keep.length} people from ${fmtDate(date)} added` + (left ? ` · ${left} not added (no longer active)` : '')
        : `Nobody was granted on ${fmtDate(date)}`)
    } catch {
      setMsg('Could not load that date — try again')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-md border border-slate-200 p-2 space-y-2 text-sm" data-testid="copy-from-date">
      <label className="block text-xs font-medium text-slate-600" htmlFor="cfd-date">Copy the people granted on an earlier date</label>
      <div className="flex flex-wrap items-center gap-2">
        <input id="cfd-date" type="date" className="input w-44" value={date} onChange={e => setDate(e.target.value)} />
        <Button variant="secondary" size="sm" onClick={run} disabled={!date} busy={busy} busyLabel="Loading...">Add these people</Button>
      </div>
      {msg && <div className="text-xs text-slate-600" data-testid="copy-from-date-msg">{msg}</div>}
    </div>
  )
}
