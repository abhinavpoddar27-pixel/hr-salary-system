import React from 'react'

/**
 * DrillDownRow — Renders an expandable detail panel as a full-width table row.
 *
 * Usage:
 *   {isExpanded(row.id) && (
 *     <DrillDownRow colSpan={10}>
 *       <EmployeeQuickView ... />
 *     </DrillDownRow>
 *   )}
 *
 * Props:
 *   colSpan   — Number of columns the detail cell should span
 *   children  — Content to render inside the expanded area
 *   className — Additional class names for the inner container
 */
export default function DrillDownRow({ colSpan, children, className = '' }) {
  return (
    <tr className="drill-down-row">
      <td colSpan={colSpan} className="p-0 border-0">
        <div className={`bg-gradient-to-b from-slate-50 to-white border-t border-b border-blue-100 px-5 py-4 animate-slide-up ${className}`}>
          {children}
        </div>
      </td>
    </tr>
  )
}

/**
 * DrillDownChevron — Small expand/collapse indicator for table rows.
 * Place in first or last <td> of a clickable row.
 */
export function DrillDownChevron({ isExpanded }) {
  return (
    <span className={`inline-block text-blue-400 text-xs transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`}>
      ▶
    </span>
  )
}
