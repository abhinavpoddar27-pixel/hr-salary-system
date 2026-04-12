import React, { useState, useEffect, useRef } from 'react';
import { ABBREVIATIONS } from '../../utils/abbreviations';

/**
 * AbbreviationLegend — Global floating ? button (fixed bottom-right).
 * Opens a searchable modal listing all HR abbreviations by category.
 *
 * Mount once inside the authenticated Layout (App.jsx).
 * Existing per-page usages that pass a `keys` prop silently become no-ops.
 *
 * Keyboard shortcut: press ? (when not in an input/textarea) to toggle.
 */
export default function AbbreviationLegend({ keys = [] }) {
  // Backward-compat guard: per-page usages with keys prop → render nothing.
  // The single global instance in Layout handles everything.
  if (keys.length > 0) return null;

  return <LegendButton />;
}

function LegendButton() {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const searchRef = useRef(null);

  // Keyboard shortcut: ? toggles modal (when not typing in an input/textarea)
  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === 'Escape' && open) {
        setOpen(false);
        setSearch('');
        return;
      }
      if (
        e.key === '?' &&
        !['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName) &&
        !e.target.isContentEditable
      ) {
        setOpen(o => !o);
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open]);

  // Lock body scroll when modal is open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
      // Auto-focus search after a tick so the transition settles
      setTimeout(() => searchRef.current?.focus(), 50);
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  const handleClose = () => {
    setOpen(false);
    setSearch('');
  };

  // Filter categories/entries by search term
  const q = search.trim().toLowerCase();
  const filtered = ABBREVIATIONS.map(cat => ({
    ...cat,
    entries: q
      ? cat.entries.filter(e =>
          e.abbr.toLowerCase().includes(q) ||
          e.meaning.toLowerCase().includes(q) ||
          (e.note || '').toLowerCase().includes(q)
        )
      : cat.entries,
  })).filter(cat => cat.entries.length > 0);

  const noResults = q && filtered.length === 0;

  return (
    <>
      {/* Floating trigger button */}
      <button
        onClick={() => setOpen(true)}
        aria-label="Open abbreviation legend"
        className="fixed bottom-5 right-5 z-50 w-8 h-8 rounded-full
                   bg-gray-500 hover:bg-gray-600 text-white text-sm
                   font-bold shadow-lg flex items-center justify-center
                   cursor-pointer transition-colors"
      >
        ?
      </button>

      {/* Modal */}
      {open && (
        <>
          {/* Overlay */}
          <div
            className="fixed inset-0 z-40 bg-slate-900/40 backdrop-blur-sm"
            onClick={handleClose}
            aria-hidden="true"
          />

          {/* Panel */}
          <div
            className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2
                       z-50 w-full max-w-lg max-h-[80vh] bg-white rounded-lg
                       shadow-xl flex flex-col"
            role="dialog"
            aria-modal="true"
            aria-label="Abbreviation Legend"
            onClick={e => e.stopPropagation()}
          >
            {/* Sticky header */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-200 shrink-0">
              <span className="font-semibold text-slate-800 text-sm whitespace-nowrap">
                Abbreviation Legend
              </span>
              <input
                ref={searchRef}
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search..."
                className="flex-1 text-sm px-2 py-1 rounded border border-gray-200
                           focus:outline-none focus:ring-1 focus:ring-blue-300
                           placeholder-gray-400"
              />
              <button
                onClick={handleClose}
                aria-label="Close"
                className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600
                           transition-colors shrink-0"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Scrollable content */}
            <div className="overflow-y-auto flex-1">
              {noResults ? (
                <p className="px-4 py-6 text-sm text-gray-400 text-center">
                  No results for &ldquo;{search}&rdquo;
                </p>
              ) : (
                filtered.map(cat => (
                  <div key={cat.category}>
                    <p className="text-xs font-semibold uppercase tracking-wider
                                  text-gray-500 px-4 pt-4 pb-1">
                      {cat.category}
                    </p>
                    {cat.entries.map(entry => (
                      <div
                        key={entry.abbr}
                        className="flex items-start gap-3 px-4 py-2 hover:bg-gray-50"
                      >
                        {/* Abbr tag */}
                        <span className="shrink-0 w-20 font-mono text-sm font-semibold
                                         text-blue-700 bg-blue-50 px-2 py-0.5 rounded
                                         text-center leading-5">
                          {entry.abbr}
                        </span>
                        {/* Meaning + note */}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-slate-800 leading-5">
                            {entry.meaning}
                          </p>
                          {entry.note && (
                            <p className="text-xs text-gray-500 mt-0.5 leading-tight">
                              {entry.note}
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ))
              )}
              {/* Bottom padding */}
              <div className="h-3" />
            </div>
          </div>
        </>
      )}
    </>
  );
}
