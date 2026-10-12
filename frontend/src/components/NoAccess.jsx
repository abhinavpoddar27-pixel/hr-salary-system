import React from 'react'
import { Link } from 'react-router-dom'

/**
 * P2-10: shown in place of a page the signed-in role may not open (key from usePermissions).
 * Not a redirect, not an error toast, and the page itself is never mounted (so it sends no requests).
 */
export default function NoAccess({ role }) {
  return (
    <div className="flex items-center justify-center p-6 md:p-10" data-testid="no-access">
      <div className="max-w-md w-full bg-white border border-slate-200 rounded-xl p-6 text-center shadow-sm">
        <div className="text-3xl mb-2" aria-hidden="true">🔒</div>
        <h2 className="text-lg font-semibold text-slate-800">You don't have access to this page</h2>
        <p className="text-sm text-slate-500 mt-2">
          {role ? <>Your role (<span className="font-medium capitalize">{role}</span>) can't open this page.</> : 'Your role can\'t open this page.'}
          {' '}If you need it, ask an admin.
        </p>
        <Link to="/" className="inline-block mt-4 text-sm font-medium text-blue-600 hover:text-blue-800">Go to Dashboard</Link>
      </div>
    </div>
  )
}
