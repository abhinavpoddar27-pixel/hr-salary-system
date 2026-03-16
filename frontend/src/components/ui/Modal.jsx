import React, { useEffect, useRef } from 'react';

/**
 * Modal — Standardized modal with backdrop blur + slide-in animation.
 *
 * Usage:
 *   <Modal open={isOpen} onClose={() => setOpen(false)} title="Edit Employee" size="lg">
 *     <ModalBody>...</ModalBody>
 *     <ModalFooter>...</ModalFooter>
 *   </Modal>
 */
export default function Modal({ open, onClose, title, children, size = 'md' }) {
  const overlayRef = useRef(null);

  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  useEffect(() => {
    const handleEsc = (e) => { if (e.key === 'Escape' && open) onClose?.(); };
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [open, onClose]);

  if (!open) return null;

  const sizeClass = {
    sm: 'max-w-md',
    md: 'max-w-lg',
    lg: 'max-w-2xl',
    xl: 'max-w-4xl',
    full: 'max-w-6xl',
  }[size] || 'max-w-lg';

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh]
        bg-slate-900/40 backdrop-blur-sm animate-fade-in"
      onClick={(e) => { if (e.target === overlayRef.current) onClose?.(); }}
    >
      <div className={`${sizeClass} w-full mx-4 bg-white rounded-2xl shadow-glass-xl
        border border-slate-200/50 animate-scale-in max-h-[80vh] flex flex-col`}>
        {/* Header */}
        {title && (
          <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
            <h3 className="text-base font-bold text-slate-800">{title}</h3>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-slate-100 transition-colors text-slate-400 hover:text-slate-600"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}
        {/* Content (scrollable) */}
        <div className="flex-1 overflow-y-auto">
          {children}
        </div>
      </div>
    </div>
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
