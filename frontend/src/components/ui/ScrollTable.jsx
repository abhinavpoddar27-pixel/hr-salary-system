import React, { Fragment, useMemo, useState } from 'react'
import clsx from 'clsx'

/**
 * ScrollTable — a table in its own scroll window with a header that really sticks (P2-05).
 *
 * Why: `.table-compact thead` is sticky, but most tables sit inside an `overflow-x-auto`
 * card, so the header scrolls away with the page (finding P-16). Here the table scrolls
 * INSIDE its own `overflow-auto` + max-height window, and every <th> is sticky with an
 * opaque background. Stage 7 (`.salreg`) has its own pattern and must not use this.
 *
 *   <ScrollTable
 *     columns={[{ key, header, render(row, api), className, thClassName, sortable, sortValue(row) }]}
 *     rows={rows} rowKey="id" rowProps={row => ({ 'data-x': … , className })}
 *     leading={{ header: <input …/>, cell: row => <input …/>, className: 'w-8' }}   // optional first column
 *     renderExpanded={row => <Detail/>} expandLabel={row => `details for ${row.code}`} // optional
 *     emptyText="Nothing here" maxHeight="max-h-[70vh]" api={…passed to render} />
 *
 * - Sortable column: header is a <button>; the <th> carries aria-sort. Click again to reverse.
 *   Sorting is client-side and stable; empty values sort last. `initialSort={{ key, dir }}`.
 * - Expand: a chevron <button aria-expanded aria-controls> in its own column; the detail is an
 *   extra <tr>. Opt-in — tables without renderExpanded keep exactly one <tr> per row.
 * - Classes: container `containerClassName` (default 'card'), table `tableClassName`
 *   (default 'table-compact w-full text-[11px]').
 */
export default function ScrollTable({
  columns,
  rows,
  rowKey = 'id',
  rowProps,
  leading,
  renderExpanded,
  expandLabel,
  emptyText = 'No rows',
  maxHeight = 'max-h-[70vh]',
  containerClassName = 'card',
  tableClassName = 'table-compact w-full text-[11px]',
  initialSort = null,
  api,
  testId,
}) {
  const [sort, setSort] = useState(initialSort)
  const [expanded, setExpanded] = useState(() => new Set())
  const keyOf = (row, i) => (typeof rowKey === 'function' ? rowKey(row, i) : row?.[rowKey] ?? i)

  const sortedRows = useMemo(() => {
    if (!sort?.key) return rows
    const col = columns.find(c => c.key === sort.key)
    if (!col) return rows
    const val = col.sortValue || (r => r?.[col.key])
    const dir = sort.dir === 'desc' ? -1 : 1
    const empty = v => v === null || v === undefined || v === ''
    return rows
      .map((r, i) => [r, i])
      .sort(([a, ia], [b, ib]) => {
        const va = val(a), vb = val(b)
        if (empty(va) && empty(vb)) return ia - ib
        if (empty(va)) return 1
        if (empty(vb)) return -1
        const c = (typeof va === 'number' && typeof vb === 'number') ? va - vb : String(va).localeCompare(String(vb), 'en', { numeric: true })
        return c !== 0 ? c * dir : ia - ib
      })
      .map(([r]) => r)
  }, [rows, columns, sort])

  const toggleSort = (key) => setSort(s => (s?.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }))
  const toggleExpand = (k) => setExpanded(prev => {
    const next = new Set(prev)
    next.has(k) ? next.delete(k) : next.add(k)
    return next
  })

  const colCount = columns.length + (leading ? 1 : 0) + (renderExpanded ? 1 : 0)

  return (
    <div className={clsx(containerClassName, 'overflow-auto', maxHeight)} data-scroll-table={testId || ''}>
      <table className={clsx(tableClassName, 'border-separate border-spacing-0',
        '[&_thead_th]:sticky [&_thead_th]:top-0 [&_thead_th]:z-10 [&_thead_th]:bg-slate-50')}>
        <thead>
          <tr>
            {renderExpanded && <th className="w-6"><span className="sr-only">Details</span></th>}
            {leading && <th className={leading.className}>{leading.header}</th>}
            {columns.map(c => {
              const active = sort?.key === c.key
              return (
                <th key={c.key} className={c.thClassName}
                  aria-sort={c.sortable ? (active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none') : undefined}>
                  {c.sortable ? (
                    <button type="button" onClick={() => toggleSort(c.key)} data-sort-key={c.key}
                      className="inline-flex items-center gap-1 uppercase tracking-wider font-bold hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 rounded">
                      {c.header}
                      <span aria-hidden="true" className={active ? 'text-slate-600' : 'text-slate-300'}>
                        {active ? (sort.dir === 'asc' ? '▲' : '▼') : '↕'}
                      </span>
                    </button>
                  ) : c.header}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((row, i) => {
            const k = keyOf(row, i)
            const isOpen = renderExpanded && expanded.has(k)
            const extra = rowProps ? rowProps(row) || {} : {}
            const detailId = `st-detail-${testId || 't'}-${k}`
            return (
              <Fragment key={k}>
                <tr {...extra}>
                  {renderExpanded && (
                    <td className="w-6">
                      <button type="button" onClick={() => toggleExpand(k)}
                        aria-expanded={isOpen ? 'true' : 'false'} aria-controls={detailId}
                        aria-label={`${isOpen ? 'Hide' : 'Show'} ${expandLabel ? expandLabel(row) : 'details'}`}
                        data-expand-key={k}
                        className="inline-flex h-5 w-5 items-center justify-center rounded text-slate-500 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400">
                        <span aria-hidden="true" className={clsx('transition-transform', isOpen && 'rotate-90')}>▸</span>
                      </button>
                    </td>
                  )}
                  {leading && <td className={leading.className}>{leading.cell(row)}</td>}
                  {columns.map(c => <td key={c.key} className={c.className}>{c.render ? c.render(row, api) : row?.[c.key]}</td>)}
                </tr>
                {isOpen && (
                  <tr id={detailId} data-detail-row="1">
                    <td colSpan={colCount} className="bg-slate-50">{renderExpanded(row)}</td>
                  </tr>
                )}
              </Fragment>
            )
          })}
          {sortedRows.length === 0 && (
            <tr><td colSpan={colCount} className="text-center py-8 text-slate-400">{emptyText}</td></tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
