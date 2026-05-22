// Record History Timeline — top-level list component (piece #4 of 5).
//
// Self-fetches against the read-only piece #3 endpoint:
//   GET /api/admin/record-history/timeline?table=<t>&record_id=<n>
//
// Props: { tableName, recordId }
//   - Both empty/null → idle state (prompt the caller to enter values).
//   - Otherwise the component fetches on mount + on prop change.
//
// States: idle | loading | error | empty (card_count:0) | rendered.
// Empty is NOT an error — the endpoint returns 200 with cards:[] for unknown
// records (design contract). Only HTTP 4xx/5xx flip into the error branch.
//
// Durable artifact: piece #5's lookup entry point will import this component
// after determining (table, record_id) from an employee_code search. The
// harness page at /admin/record-history-dev is throwaway; this is not.

import React, { useState, useEffect } from 'react'
import api from '../../utils/api'
import TimelineCard from './TimelineCard'

export default function TimelineCardList({ tableName, recordId }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [data, setData] = useState(null)

  useEffect(() => {
    let stale = false

    if (!tableName || !recordId) {
      setLoading(false)
      setError(null)
      setData(null)
      return
    }

    const run = async () => {
      setLoading(true)
      setError(null)
      try {
        const res = await api.get('/admin/record-history/timeline', {
          params: { table: tableName, record_id: recordId },
        })
        if (!stale) setData(res.data)
      } catch (err) {
        if (stale) return
        const body = err.response?.data
        setError({
          status: err.response?.status || 0,
          message: body?.error || err.message || 'Failed to load timeline',
        })
        setData(null)
      } finally {
        if (!stale) setLoading(false)
      }
    }

    run()
    return () => { stale = true }
  }, [tableName, recordId])

  // Idle — no inputs yet
  if (!tableName || !recordId) {
    return (
      <div className="text-sm text-slate-400 italic p-4 bg-white rounded-lg border border-slate-200">
        Enter a table name and record ID above to load the timeline.
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-500 p-4">
        <div className="w-4 h-4 border-2 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
        Loading timeline for <span className="font-mono">{tableName}</span> #{recordId}…
      </div>
    )
  }

  if (error) {
    return (
      <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-3">
        <div className="font-semibold mb-0.5">Could not load timeline</div>
        <div className="text-xs">
          HTTP {error.status}: {error.message}
        </div>
      </div>
    )
  }

  if (!data) return null

  // Empty — 200 with card_count:0 (design contract — NOT a 404)
  if (data.card_count === 0) {
    return (
      <div className="text-sm text-slate-500 p-4 bg-white rounded-lg border border-slate-200">
        No history found for <span className="font-mono">{tableName}</span> #{recordId}.
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="text-xs text-slate-500">
        {data.card_count} card{data.card_count === 1 ? '' : 's'} · newest first
      </div>
      {data.cards.map(card => (
        <TimelineCard key={card.id} card={card} />
      ))}
    </div>
  )
}
