import React from 'react';

/**
 * Skeleton loader for various content shapes.
 *
 * Usage:
 *   <Skeleton h="20px" w="160px" />
 *   <Skeleton variant="card" />
 *   <Skeleton variant="row" count={5} />
 */
export default function Skeleton({ variant = 'line', h, w, className = '', count = 1 }) {
  if (variant === 'card') {
    return (
      <div className={`card p-5 space-y-4 ${className}`}>
        <div className="skeleton h-4 w-1/3 rounded" />
        <div className="skeleton h-8 w-2/3 rounded" />
        <div className="skeleton h-3 w-1/2 rounded" />
      </div>
    );
  }

  if (variant === 'stat') {
    return (
      <div className={`stat-card ${className}`}>
        <div className="skeleton h-3 w-16 rounded" />
        <div className="skeleton h-7 w-24 rounded mt-1" />
        <div className="skeleton h-2.5 w-12 rounded mt-1" />
      </div>
    );
  }

  if (variant === 'row') {
    return (
      <div className={`space-y-2 ${className}`}>
        {Array.from({ length: count }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 py-2">
            <div className="skeleton h-4 w-20 rounded" />
            <div className="skeleton h-4 flex-1 rounded" />
            <div className="skeleton h-4 w-16 rounded" />
            <div className="skeleton h-4 w-12 rounded" />
          </div>
        ))}
      </div>
    );
  }

  if (variant === 'table') {
    return (
      <div className={`space-y-1 ${className}`}>
        <div className="flex gap-3 py-2 border-b border-slate-100">
          {[1,2,3,4,5].map(i => <div key={i} className="skeleton h-3 flex-1 rounded" />)}
        </div>
        {Array.from({ length: count }).map((_, i) => (
          <div key={i} className="flex gap-3 py-3">
            {[1,2,3,4,5].map(j => <div key={j} className="skeleton h-4 flex-1 rounded" />)}
          </div>
        ))}
      </div>
    );
  }

  // Default: line
  return (
    <div className="space-y-2">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className={`skeleton rounded ${className}`}
          style={{ height: h || '16px', width: w || '100%' }}
        />
      ))}
    </div>
  );
}
