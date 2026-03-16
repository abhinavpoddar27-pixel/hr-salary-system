import React, { useState } from 'react';
import { getPageAbbreviations } from '../../utils/abbreviations';

/**
 * AbbreviationLegend — Collapsible panel at the bottom of a page
 * listing all abbreviations used on that page.
 *
 * Usage: <AbbreviationLegend keys={['LOP', 'PF', 'ESI', 'PT', 'DA', 'HRA']} />
 */
export default function AbbreviationLegend({ keys = [], title = 'Abbreviations Used' }) {
  const [open, setOpen] = useState(false);
  const items = getPageAbbreviations(keys);

  if (items.length === 0) return null;

  return (
    <div className="mt-6 card-solid overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full px-5 py-3 flex items-center justify-between text-left
          hover:bg-slate-50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm text-slate-400">ℹ️</span>
          <span className="text-sm font-semibold text-slate-600">{title}</span>
          <span className="badge-gray text-[10px]">{items.length}</span>
        </div>
        <svg
          className={`w-4 h-4 text-slate-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="px-5 pb-4 animate-slide-up">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-x-6 gap-y-2 pt-2 border-t border-slate-100">
            {items.map(item => (
              <div key={item.key} className="flex items-start gap-2 py-1.5">
                <span className="inline-block min-w-[40px] px-1.5 py-0.5 text-[11px] font-bold text-center
                  bg-slate-100 text-slate-600 rounded font-mono">
                  {item.key}
                </span>
                <div className="flex-1 min-w-0">
                  <span className="text-xs font-semibold text-slate-700">{item.full}</span>
                  <p className="text-[11px] text-slate-400 leading-tight mt-0.5">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
