import React, { useEffect, useRef } from 'react'

// P2-08 — idle sign-out countdown. Own small dialog on purpose (components/ui/Modal.jsx is being
// rebuilt in P2-01). Esc does NOT close it: closing is not consent to stay. Only the two buttons act.
function fmt(sec) {
  const s = Math.max(0, sec | 0)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export default function SessionTimeoutDialog({ warningOpen, secondsLeft, staySignedIn, signOutNow }) {
  const stayRef = useRef(null)
  const outRef = useRef(null)

  useEffect(() => {
    if (warningOpen) stayRef.current?.focus()
  }, [warningOpen])

  if (!warningOpen) return null

  const onKeyDown = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); return }
    if (e.key === 'Tab') {
      // keep focus on the two buttons
      e.preventDefault()
      const next = document.activeElement === stayRef.current ? outRef.current : stayRef.current
      next?.focus()
    }
  }

  return (
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center bg-slate-900/60 p-4"
      data-testid="session-timeout-dialog"
      onKeyDown={onKeyDown}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="session-timeout-title"
        aria-describedby="session-timeout-desc"
        className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl"
      >
        <h2 id="session-timeout-title" className="text-lg font-semibold text-slate-800">Still there?</h2>
        <p id="session-timeout-desc" className="mt-2 text-sm text-slate-600">
          You&apos;ll be signed out in{' '}
          <span role="timer" data-testid="session-timeout-countdown" className="font-mono font-semibold text-slate-900">
            {fmt(secondsLeft)}
          </span>{' '}
          because there has been no activity. After you sign in again you&apos;ll come back to this page.
        </p>
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button ref={outRef} type="button" onClick={signOutNow}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">
            Sign out now
          </button>
          <button ref={stayRef} type="button" onClick={staySignedIn}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
            Stay signed in
          </button>
        </div>
      </div>
    </div>
  )
}
