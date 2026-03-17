import { useState, useCallback } from 'react'

/**
 * useExpandableRows — Shared hook for managing expandable table row state.
 *
 * Usage:
 *   const { expandedId, toggle, isExpanded, collapseAll } = useExpandableRows()
 *
 *   <tr onClick={() => toggle(row.id)} className={isExpanded(row.id) ? 'bg-blue-50' : ''}>
 *     ...
 *   </tr>
 *   {isExpanded(row.id) && <DrillDownRow colSpan={N}>...detail...</DrillDownRow>}
 *
 * By default, only one row can be expanded at a time (accordion mode).
 * Pass { multiple: true } for multi-expand mode.
 */
export default function useExpandableRows({ multiple = false } = {}) {
  const [expandedId, setExpandedId] = useState(null)
  const [expandedIds, setExpandedIds] = useState(new Set())

  const toggle = useCallback((id) => {
    if (multiple) {
      setExpandedIds(prev => {
        const next = new Set(prev)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        return next
      })
    } else {
      setExpandedId(prev => prev === id ? null : id)
    }
  }, [multiple])

  const isExpanded = useCallback((id) => {
    return multiple ? expandedIds.has(id) : expandedId === id
  }, [multiple, expandedId, expandedIds])

  const collapseAll = useCallback(() => {
    setExpandedId(null)
    setExpandedIds(new Set())
  }, [])

  return { expandedId, expandedIds, toggle, isExpanded, collapseAll }
}
