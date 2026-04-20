import React, { useState } from 'react'

// Collapsed-by-default summary of the auto-context we're about to send. Gives
// the reporter visibility into "what else goes with this report" so they can
// trust that we're not uploading anything surprising. Only the URL path (not
// query values — apiContextBuffer redacts those) is shown.
export default function AutoContextPreview({ context }) {
  const [open, setOpen] = useState(false)
  if (!context) return null

  const apis = context.recent_api_calls || []
  return (
    <div className="border border-slate-200 rounded-lg bg-slate-50">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2 text-xs text-slate-600 hover:text-slate-800"
      >
        <span>What we're sending (auto-context)</span>
        <span>{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div className="px-3 pb-3 text-xs space-y-2 text-slate-600">
          <div>
            <span className="font-semibold text-slate-700">Page:</span>{' '}
            <span className="font-mono">{context.path || '—'}</span>
          </div>
          <div>
            <span className="font-semibold text-slate-700">Viewport:</span>{' '}
            {context.viewport?.width}×{context.viewport?.height}
          </div>
          <div>
            <span className="font-semibold text-slate-700">Last {apis.length} API call{apis.length === 1 ? '' : 's'}:</span>
            {apis.length === 0 ? (
              <div className="italic text-slate-400">none recorded</div>
            ) : (
              <ul className="mt-1 space-y-0.5 font-mono">
                {apis.map((c, i) => (
                  <li key={i} className="truncate">
                    <span className={c.status >= 400 ? 'text-red-600' : 'text-emerald-700'}>
                      {c.status || '—'}
                    </span>{' '}
                    {c.method} {c.url}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <p className="text-[11px] italic text-slate-400 pt-1 border-t border-slate-200">
            No request bodies or form data are captured — only URLs, response codes, and viewport.
          </p>
        </div>
      )}
    </div>
  )
}
