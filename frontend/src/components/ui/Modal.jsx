import React, { useRef } from 'react';
import { Dialog } from '@headlessui/react';

const noop = () => {};

/**
 * Modal — Standardized modal with backdrop blur + slide-in animation.
 * Built on the headlessui Dialog (P2-01): focus stays inside while open
 * (Tab / Shift-Tab cycle), Esc and a click outside the panel close it,
 * page scroll is locked, and focus returns to the opener on close.
 *
 * Usage (props unchanged — every existing caller keeps working):
 *   <Modal open={isOpen} onClose={() => setOpen(false)} title="Edit Employee" size="lg">
 *     <ModalBody>...</ModalBody>
 *     <ModalFooter>...</ModalFooter>
 *   </Modal>
 *
 * Optional `busy`: while true, Esc / outside click / ✕ do nothing (the
 * caller disables its own action buttons).
 * `show` is accepted and ignored, exactly as before (callers that pass it
 * mount the modal only when it should be open).
 */
export default function Modal({ open = true, onClose, title, children, size = 'md', busy = false }) {
  const panelRef = useRef(null);

  const sizeClass = {
    sm: 'max-w-md',
    md: 'max-w-lg',
    lg: 'max-w-2xl',
    xl: 'max-w-4xl',
    full: 'max-w-6xl',
  }[size] || 'max-w-lg';

  const close = () => { if (!busy) onClose?.(); };

  return (
    <Dialog
      as="div"
      open={!!open}
      onClose={close}
      initialFocus={panelRef}
      data-busy={busy ? 'true' : undefined}
      className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh]
        bg-slate-900/40 backdrop-blur-sm animate-fade-in"
    >
      <Dialog.Panel
        ref={panelRef}
        tabIndex={-1}
        className={`${sizeClass} w-full mx-4 bg-white rounded-2xl shadow-glass-xl
        border border-slate-200/50 animate-scale-in max-h-[80vh] flex flex-col outline-none`}
      >
        {/* Header */}
        {title && (
          <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
            <Dialog.Title as="h3" className="text-base font-bold text-slate-800">{title}</Dialog.Title>
            <button
              type="button"
              onClick={close}
              disabled={busy}
              aria-label="Close"
              title="Close"
              className="p-1.5 rounded-lg hover:bg-slate-100 transition-colors text-slate-400 hover:text-slate-600 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}
        {/* Content (scrollable) */}
        <div className="flex-1 overflow-y-auto">
          {children}
        </div>
      </Dialog.Panel>
    </Dialog>
  );
}

export function ModalBody({ children, className = '' }) {
  return <div className={`px-6 py-5 ${className}`}>{children}</div>;
}

export function ModalFooter({ children, className = '' }) {
  return (
    <div className={`px-6 py-4 border-t border-slate-100 flex items-center justify-end gap-3 ${className}`}>
      {children}
    </div>
  );
}
