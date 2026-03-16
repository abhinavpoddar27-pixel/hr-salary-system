import React from 'react';

/**
 * EmptyState — Consistent empty state display.
 *
 * Usage: <EmptyState icon="📋" title="No records" message="Upload data to get started" />
 */
export default function EmptyState({ icon = '📭', title, message, action, className = '' }) {
  return (
    <div className={`flex flex-col items-center justify-center py-16 text-center ${className}`}>
      <span className="text-4xl mb-4 animate-pulse-slow">{icon}</span>
      {title && <h3 className="text-base font-semibold text-slate-700 mb-1">{title}</h3>}
      {message && <p className="text-sm text-slate-400 max-w-md">{message}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
