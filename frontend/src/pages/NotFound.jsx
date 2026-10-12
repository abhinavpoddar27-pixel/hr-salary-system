import React from 'react'
import { Link, useLocation } from 'react-router-dom'

/** P8-06: unknown URL — say so, show the address, link home (was a silent redirect to "/"). */
export default function NotFound() {
  const location = useLocation()
  return (
    <div className="flex items-center justify-center p-6 md:p-10" data-testid="not-found">
      <div className="max-w-md w-full bg-white border border-slate-200 rounded-xl p-6 text-center shadow-sm">
        <div className="text-3xl mb-2" aria-hidden="true">🧭</div>
        <h2 className="text-lg font-semibold text-slate-800">Page not found</h2>
        <p className="text-sm text-slate-500 mt-2">
          There is no page at <code className="px-1 py-0.5 bg-slate-100 rounded text-slate-700 break-all">{location.pathname}</code>.
        </p>
        <Link to="/" className="inline-block mt-4 text-sm font-medium text-blue-600 hover:text-blue-800">Go to Dashboard</Link>
      </div>
    </div>
  )
}
