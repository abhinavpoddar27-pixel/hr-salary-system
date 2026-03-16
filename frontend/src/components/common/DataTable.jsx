import React, { useState, useMemo } from 'react'
import clsx from 'clsx'

export default function DataTable({
  columns, data, loading, onRowClick,
  selectable, selectedRows, onSelectionChange,
  className, emptyMessage = 'No data found',
  pageSize = 50
}) {
  const [sortCol, setSortCol] = useState(null)
  const [sortDir, setSortDir] = useState('asc')
  const [page, setPage] = useState(0)
  const [filter, setFilter] = useState('')

  const handleSort = (col) => {
    if (col.key === sortCol) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col.key); setSortDir('asc') }
  }

  const filtered = useMemo(() => {
    if (!filter) return data || []
    const f = filter.toLowerCase()
    return (data || []).filter(row => columns.some(col => {
      const val = col.accessor ? col.accessor(row) : row[col.key]
      return String(val || '').toLowerCase().includes(f)
    }))
  }, [data, filter, columns])

  const sorted = useMemo(() => {
    if (!sortCol) return filtered
    return [...filtered].sort((a, b) => {
      const col = columns.find(c => c.key === sortCol)
      const av = col?.accessor ? col.accessor(a) : a[sortCol]
      const bv = col?.accessor ? col.accessor(b) : b[sortCol]
      if (av == null) return 1
      if (bv == null) return -1
      const cmp = typeof av === 'number' ? av - bv : String(av).localeCompare(String(bv))
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [filtered, sortCol, sortDir])

  const totalPages = Math.ceil(sorted.length / pageSize)
  const paged = sorted.slice(page * pageSize, (page + 1) * pageSize)

  const allSelected = selectable && paged.length > 0 && paged.every(r => selectedRows?.has(r.id))

  const toggleAll = () => {
    if (allSelected) {
      const next = new Set(selectedRows)
      paged.forEach(r => next.delete(r.id))
      onSelectionChange(next)
    } else {
      const next = new Set(selectedRows)
      paged.forEach(r => next.add(r.id))
      onSelectionChange(next)
    }
  }

  const toggleRow = (id) => {
    const next = new Set(selectedRows)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    onSelectionChange(next)
  }

  return (
    <div className={clsx('flex flex-col', className)}>
      {/* Filter */}
      <div className="flex items-center gap-3 mb-3">
        <input
          type="search"
          placeholder="Search..."
          value={filter}
          onChange={e => { setFilter(e.target.value); setPage(0) }}
          className="input w-64"
        />
        <span className="text-xs text-slate-500">{sorted.length} records</span>
        {selectable && selectedRows?.size > 0 && (
          <span className="badge-blue">{selectedRows.size} selected</span>
        )}
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full table-compact">
          <thead>
            <tr>
              {selectable && (
                <th className="w-8 px-3">
                  <input type="checkbox" checked={allSelected} onChange={toggleAll} className="rounded" />
                </th>
              )}
              {columns.map(col => (
                <th
                  key={col.key}
                  onClick={() => col.sortable !== false && handleSort(col)}
                  className={clsx(col.sortable !== false && 'cursor-pointer hover:bg-slate-100', col.className)}
                  style={col.width ? { width: col.width } : undefined}
                >
                  <div className="flex items-center gap-1">
                    {col.label}
                    {sortCol === col.key && <span className="text-blue-500">{sortDir === 'asc' ? '↑' : '↓'}</span>}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i}>
                  {columns.map((_, j) => (
                    <td key={j}><div className="h-4 bg-slate-100 rounded animate-pulse" /></td>
                  ))}
                </tr>
              ))
            ) : paged.length === 0 ? (
              <tr>
                <td colSpan={columns.length + (selectable ? 1 : 0)} className="text-center py-8 text-slate-400">
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              paged.map((row, i) => (
                <tr
                  key={row.id || i}
                  onClick={() => onRowClick && onRowClick(row)}
                  className={clsx(onRowClick && 'cursor-pointer')}
                >
                  {selectable && (
                    <td onClick={e => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selectedRows?.has(row.id)}
                        onChange={() => toggleRow(row.id)}
                        className="rounded"
                      />
                    </td>
                  )}
                  {columns.map(col => (
                    <td key={col.key} className={col.tdClass}>
                      {col.render ? col.render(row) : (col.accessor ? col.accessor(row) : row[col.key]) ?? '—'}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center gap-2 mt-3 text-sm">
          <button onClick={() => setPage(0)} disabled={page === 0} className="btn-secondary px-2 py-1 text-xs">«</button>
          <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} className="btn-secondary px-2 py-1 text-xs">‹</button>
          <span className="text-slate-500">Page {page + 1} of {totalPages}</span>
          <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1} className="btn-secondary px-2 py-1 text-xs">›</button>
          <button onClick={() => setPage(totalPages - 1)} disabled={page >= totalPages - 1} className="btn-secondary px-2 py-1 text-xs">»</button>
        </div>
      )}
    </div>
  )
}
