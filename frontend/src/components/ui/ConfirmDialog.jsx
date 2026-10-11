import React, { useRef } from 'react'
import clsx from 'clsx'
import { Dialog } from '@headlessui/react'

/**
 * ConfirmDialog — built on the headlessui Dialog (P2-01).
 * Props unchanged; the caller mounts it while it should be shown.
 * Esc and a click outside the panel = onCancel. Focus is trapped inside.
 * First focus: Cancel for a destructive (danger) confirm, Confirm otherwise.
 *
 * Optional, additive:
 *   busy        — both buttons disabled; Esc / outside click ignored
 *   children    — rendered under the message (e.g. a text input)
 *   showCancel  — false hides Cancel (alert-style, one OK button)
 *   initialFocus — a ref to focus first instead (e.g. a prompt's input)
 */
export default function ConfirmDialog({
  title, message, confirmText = 'Confirm', cancelText = 'Cancel', onConfirm, onCancel, variant = 'danger',
  busy = false, children, showCancel = true, initialFocus,
}) {
  const cancelRef = useRef(null)
  const confirmRef = useRef(null)
  const btnClass = variant === 'danger'
    ? 'bg-red-600 hover:bg-red-700 text-white'
    : 'bg-amber-600 hover:bg-amber-700 text-white'

  const destructive = variant === 'danger' && showCancel
  const dismiss = () => {
    if (busy) return
    // Alert-style (no Cancel): Esc / outside click acknowledges, same as OK.
    if (showCancel) onCancel?.()
    else onConfirm?.()
  }

  return (
    <Dialog
      as="div"
      open
      onClose={dismiss}
      initialFocus={initialFocus || (destructive ? cancelRef : confirmRef)}
      data-busy={busy ? 'true' : undefined}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      <div className="fixed inset-0 bg-black/50" aria-hidden="true" />
      <Dialog.Panel className="relative bg-white rounded-xl shadow-xl max-w-md w-full p-6 z-10 animate-scale-in">
        <Dialog.Title as="h3" className="text-lg font-semibold text-slate-800">{title}</Dialog.Title>
        <p className="text-sm text-slate-600 mt-2 leading-relaxed">{message}</p>
        {children}
        <div className="flex justify-end gap-3 mt-6">
          {showCancel && (
            <button
              type="button"
              ref={cancelRef}
              onClick={dismiss}
              disabled={busy}
              className="px-4 py-2 text-sm font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {cancelText}
            </button>
          )}
          <button
            type="button"
            ref={confirmRef}
            onClick={() => { if (!busy) onConfirm?.() }}
            disabled={busy}
            className={clsx('px-4 py-2 text-sm font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed', btnClass)}
          >
            {confirmText}
          </button>
        </div>
      </Dialog.Panel>
    </Dialog>
  )
}
