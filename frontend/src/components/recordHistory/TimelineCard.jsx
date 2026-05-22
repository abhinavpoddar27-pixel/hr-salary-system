// Record History Timeline — single Card (piece #4 of 5).
//
// Renders one logical-action Card produced by groupAndDiff (piece #2).
// Layout: optional informational ribbon → header (severity dot, label, time)
//   → metadata (changed_by, field count) → subtitle (render-as-is) → body.
//
// Render rules (design §3/§5/§6/§7):
//   - severity dot:   low=slate-300, normal=blue-500, high=red-500
//   - system_write:   de-emphasised (greyed background + slate text + smaller heading)
//   - excluded:       greyed harder, dashed border
//   - isNoop=true:    collapse body to "N repeated saves — no change ▾", expand on click
//   - flaggedForReview present: NEUTRAL/amber INFO ribbon "Needs mapping" — this is the
//                     unknown-fallback signal (map row 45), routine, not an alarm. Never
//                     red, never ⚠. Present-or-absent on the card — never synthesized.
//   - subtitle:       render the server-supplied string AS-IS (backend §6 masked it).

import React, { useState } from 'react'
import clsx from 'clsx'
import TimelineField from './TimelineField'

const SEVERITY_DOT = {
  low:    'bg-slate-300',
  normal: 'bg-blue-500',
  high:   'bg-red-500',
}

// SQLite naive timestamp "YYYY-MM-DD HH:MM:SS" → "22 May 2026, 10:30".
// Naive timestamps are treated as UTC for consistency; users see local time.
function formatTimestamp(ts) {
  if (!ts || typeof ts !== 'string') return ''
  try {
    const iso = ts.includes('T') ? ts : ts.replace(' ', 'T') + 'Z'
    const d = new Date(iso)
    if (isNaN(d.getTime())) return ts
    return d.toLocaleString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: false,
    })
  } catch {
    return ts
  }
}

export default function TimelineCard({ card }) {
  const [expanded, setExpanded] = useState(false)

  const isSystemWrite = card.category === 'system_write'
  const isExcluded    = card.category === 'excluded'
  const dotColour     = SEVERITY_DOT[card.severity] || SEVERITY_DOT.low
  const fields        = Array.isArray(card.fields) ? card.fields : []
  const fieldCount    = fields.length

  return (
    <div
      className={clsx(
        'rounded-lg border p-4 transition-colors',
        isSystemWrite
          ? 'bg-slate-50 border-slate-200'
          : 'bg-white border-slate-200 shadow-glass-sm',
        isExcluded && 'border-dashed bg-slate-50/60',
      )}
    >
      {/* Informational ribbon — unknown-fallback signal, NOT an alert */}
      {card.flaggedForReview && (
        <div className="mb-2 inline-flex items-center gap-1.5 text-[11px] font-medium text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-0.5">
          <span aria-hidden="true">ℹ</span>
          <span>Needs mapping</span>
          <span className="font-normal text-amber-700/80">
            · unrecognized change type — informational
          </span>
        </div>
      )}

      {/* Header: severity dot · label · timestamp */}
      <div className="flex items-center gap-3 mb-1">
        <span
          className={clsx('w-2.5 h-2.5 rounded-full shrink-0', dotColour)}
          aria-label={`severity ${card.severity || 'low'}`}
          title={`severity: ${card.severity || 'low'}`}
        />
        <div
          className={clsx(
            'flex-1 font-semibold',
            isSystemWrite ? 'text-sm text-slate-600' : 'text-[15px] text-slate-800',
            isExcluded && 'text-slate-400',
          )}
        >
          {card.label || '(unlabeled change)'}
        </div>
        <div
          className={clsx(
            'text-xs whitespace-nowrap',
            isSystemWrite ? 'text-slate-400' : 'text-slate-500',
          )}
          title={card.changed_at || ''}
        >
          {formatTimestamp(card.changed_at)}
        </div>
      </div>

      {/* Metadata line */}
      <div className={clsx('text-xs mb-2', isSystemWrite ? 'text-slate-400' : 'text-slate-500')}>
        <span className="font-medium">{card.changed_by || '—'}</span>
        <span className="mx-1.5">·</span>
        <span>{fieldCount} field{fieldCount === 1 ? '' : 's'}</span>
        {isSystemWrite && (
          <>
            <span className="mx-1.5">·</span>
            <span className="text-slate-400">system write</span>
          </>
        )}
      </div>

      {/* Subtitle — server already masked (§6); render as-is */}
      {card.subtitle && (
        <div
          className={clsx(
            'text-xs italic mb-2 px-2 py-1 border-l-2',
            isSystemWrite
              ? 'text-slate-400 bg-slate-100/60 border-slate-200'
              : 'text-slate-600 bg-slate-50 border-slate-200',
          )}
        >
          {card.subtitle}
        </div>
      )}

      {/* Body — collapsed for no-op cards until expanded */}
      {card.isNoop && !expanded ? (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="text-xs text-slate-500 hover:text-slate-700 hover:underline underline-offset-2"
        >
          {fieldCount} repeated save{fieldCount === 1 ? '' : 's'} — no change. Show details ▾
        </button>
      ) : (
        <>
          {fieldCount > 0 && (
            <ul className="space-y-1 ml-1">
              {fields.map(f => (
                <TimelineField key={f.id} field={f} />
              ))}
            </ul>
          )}
          {card.isNoop && (
            <button
              type="button"
              onClick={() => setExpanded(false)}
              className="mt-1 text-xs text-slate-400 hover:text-slate-600"
            >
              ▴ Collapse
            </button>
          )}
        </>
      )}
    </div>
  )
}
