import React from 'react'
import clsx from 'clsx'

export default function ConfirmDialog({ title, message, confirmText = 'Confirm', cancelText = 'Cancel', onConfirm, onCancel, variant = 'danger' }) {
  const btnClass = variant === 'danger'
    ? 'bg-red-600 hover:bg-red-700 text-white'
    : 'bg-amber-600 hover:bg-amber-700 text-white'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/50" onClick={onCancel} />
      <div className="relative bg-white rounded-xl shadow-xl max-w-md w-full p-6 z-10 animate-scale-in">
        <h3 className="text-lg font-semibold text-slate-800">{title}</h3>
        <p className="text-sm text-slate-600 mt-2 leading-relaxed">{message}</p>
        <div className="flex justify-end gap-3 mt-6">
          <button onClick={onCancel} className="px-4 py-2 text-sm font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors">
            {cancelText}
          </button>
          <button onClick={onConfirm} className={clsx('px-4 py-2 text-sm font-medium rounded-lg transition-colors', btnClass)}>
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  )
}
