import React from 'react'
import { useAppStore } from '../../store/appStore'
import useNewBugReportCount from '../../hooks/useNewBugReportCount'

// Global floating button — bottom-left so it doesn't collide with the
// AbbreviationLegend "?" button (bottom-right) or the Salary Explainer
// trigger. Mounted once in Layout so every authenticated page shows it.
// Visible to all authenticated roles; admin also sees a "new" count badge
// fed by the /count poller (hook returns 0 for non-admins).
export default function BugReportButton() {
  const openBugReport = useAppStore((s) => s.openBugReportModal)
  const newCount = useNewBugReportCount()

  return (
    <button
      type="button"
      onClick={openBugReport}
      title="Report an issue  (Ctrl+Shift+B)"
      className="fixed bottom-4 left-4 z-40 flex items-center gap-2 px-3 py-2
        bg-amber-500 hover:bg-amber-600 text-white text-sm font-medium rounded-full
        shadow-lg border border-amber-600 transition-colors"
    >
      <span aria-hidden>🐞</span>
      <span>Report an issue</span>
      {newCount > 0 && (
        <span className="inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 rounded-full bg-white text-amber-700 text-[11px] font-bold">
          {newCount > 99 ? '99+' : newCount}
        </span>
      )}
    </button>
  )
}
