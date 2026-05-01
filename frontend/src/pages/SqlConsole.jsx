import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { sql, SQLite } from '@codemirror/lang-sql'
import api from '../utils/api'
import { useAppStore } from '../store/appStore'

function exportCSV(columns, rows, filename) {
  const cols = columns && columns.length ? columns : (rows[0] ? Object.keys(rows[0]) : [])
  const escape = (val) => {
    if (val === null || val === undefined) return ''
    const str = typeof val === 'object' ? JSON.stringify(val) : String(val)
    return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str
  }
  const header = cols.map(escape).join(',')
  const body = rows.map(r => cols.map(c => escape(r[c])).join(',')).join('\n')
  const csv = header + '\n' + body
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename || `sql-console-${Date.now()}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

function relativeTime(ts) {
  if (!ts) return ''
  try {
    const t = typeof ts === 'string' ? new Date(ts.replace(' ', 'T') + 'Z') : new Date(ts)
    const diff = Math.floor((Date.now() - t.getTime()) / 1000)
    if (diff < 60) return `${diff}s ago`
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
    return `${Math.floor(diff / 86400)}d ago`
  } catch { return String(ts) }
}

export default function SqlConsole() {
  const user = useAppStore(s => s.user)
  const [sqlText, setSqlText] = useState('')
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState(null)
  const [error, setError] = useState(null)
  const [schema, setSchema] = useState(null)
  const [schemaLoading, setSchemaLoading] = useState(false)
  const [snippets, setSnippets] = useState([])
  const [history, setHistory] = useState([])
  const [snippetsOpen, setSnippetsOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [expandedTables, setExpandedTables] = useState({})
  const [sortCol, setSortCol] = useState(null)
  const [sortDir, setSortDir] = useState('asc')

  const snippetsBtnRef = useRef(null)
  const historyBtnRef = useRef(null)

  const isAdmin = user && user.role === 'admin'

  const loadSchema = useCallback(async () => {
    setSchemaLoading(true)
    try {
      const res = await api.get('/admin/sql/schema')
      setSchema(res.data)
    } catch (err) {
      setSchema({ error: err.response?.data?.reason || err.message })
    } finally {
      setSchemaLoading(false)
    }
  }, [])

  const loadSnippets = useCallback(async () => {
    try {
      const res = await api.get('/admin/sql/snippets')
      setSnippets(res.data?.snippets || [])
    } catch { /* swallow */ }
  }, [])

  const loadHistory = useCallback(async () => {
    try {
      const res = await api.get('/admin/sql/history?limit=50')
      setHistory(res.data?.history || [])
    } catch { /* swallow */ }
  }, [])

  useEffect(() => {
    if (!isAdmin) return
    loadSchema()
    loadSnippets()
    loadHistory()
  }, [isAdmin, loadSchema, loadSnippets, loadHistory])

  const schemaForCompletion = useMemo(() => {
    const out = {}
    if (schema?.tables) {
      for (const t of schema.tables) {
        out[t.name] = (t.columns || []).map(c => c.name)
      }
    }
    return out
  }, [schema])

  const runQuery = useCallback(async () => {
    const text = sqlText.trim()
    if (!text) return
    setLoading(true)
    setError(null)
    setSortCol(null)
    try {
      const res = await api.post('/admin/sql/execute', { sql: text })
      setResults(res.data)
      // Refresh history list (silent failure ok)
      loadHistory()
    } catch (err) {
      const data = err.response?.data
      setError({
        code: data?.code || 'NETWORK_ERROR',
        reason: data?.reason || err.message
      })
    } finally {
      setLoading(false)
    }
  }, [sqlText, loadHistory])

  const handleEditorKeyDown = (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      runQuery()
    }
  }

  const insertText = (text) => {
    setSqlText(prev => {
      if (!prev || !prev.trim()) return text
      return prev + (prev.endsWith('\n') ? '' : '\n') + text
    })
  }

  const onTableClick = (tableName) => {
    insertText(`SELECT * FROM ${tableName} LIMIT 100;`)
  }

  const toggleTableExpand = (tableName) => {
    setExpandedTables(prev => ({ ...prev, [tableName]: !prev[tableName] }))
  }

  const onColumnClick = (columnName) => {
    insertText(columnName)
  }

  const sortedRows = useMemo(() => {
    if (!results?.rows || !sortCol) return results?.rows || []
    const rows = [...results.rows]
    rows.sort((a, b) => {
      const av = a[sortCol]
      const bv = b[sortCol]
      if (av == null && bv == null) return 0
      if (av == null) return 1
      if (bv == null) return -1
      if (typeof av === 'number' && typeof bv === 'number') return sortDir === 'asc' ? av - bv : bv - av
      const as = String(av), bs = String(bv)
      return sortDir === 'asc' ? as.localeCompare(bs) : bs.localeCompare(as)
    })
    return rows
  }, [results, sortCol, sortDir])

  const handleSort = (col) => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('asc') }
  }

  if (!isAdmin) {
    return (
      <div className="p-8 max-w-2xl mx-auto">
        <div className="bg-red-50 border border-red-300 rounded p-4 text-red-800">
          <h2 className="font-semibold mb-1">Admin access required</h2>
          <p className="text-sm">SQL Console is restricted to admin users.</p>
        </div>
      </div>
    )
  }

  const displayedRows = sortedRows.slice(0, 200)
  const moreRows = (results?.rowCount || 0) > 200

  return (
    <div className="flex h-full overflow-hidden bg-slate-50">
      {/* LEFT: schema sidebar */}
      <aside className="w-64 shrink-0 border-r border-slate-200 bg-white overflow-y-auto hidden md:block">
        <div className="p-3 border-b flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-700 uppercase">Schema</span>
          <button
            onClick={loadSchema}
            className="text-xs text-blue-600 hover:underline"
            disabled={schemaLoading}
          >
            {schemaLoading ? '…' : 'Refresh'}
          </button>
        </div>
        <div className="p-2 text-sm">
          {schemaLoading && !schema && <div className="text-slate-500 px-2 py-1">Loading…</div>}
          {schema?.error && <div className="text-red-600 px-2 py-1 text-xs">{schema.error}</div>}
          {schema?.tables?.map(t => (
            <div key={t.name} className="mb-1">
              <div className="flex items-center gap-1">
                <button
                  onClick={() => toggleTableExpand(t.name)}
                  className="text-slate-400 hover:text-slate-700 w-4 text-xs"
                  title="Expand columns"
                >
                  {expandedTables[t.name] ? '▾' : '▸'}
                </button>
                <button
                  onClick={() => onTableClick(t.name)}
                  className="flex-1 text-left font-mono text-xs text-slate-800 hover:text-blue-700 hover:bg-blue-50 px-1 py-0.5 rounded"
                  title="Insert SELECT * FROM"
                >
                  {t.name}
                </button>
                <span className="text-[10px] text-slate-400 tabular-nums">
                  {t.rowCount == null ? '—' : t.rowCount.toLocaleString()}
                </span>
              </div>
              {expandedTables[t.name] && (
                <ul className="ml-5 mt-0.5">
                  {(t.columns || []).map(c => (
                    <li key={c.name}>
                      <button
                        onClick={() => onColumnClick(c.name)}
                        className="text-left text-[11px] font-mono text-slate-600 hover:text-blue-700 px-1 py-0.5 rounded w-full"
                        title="Insert column name"
                      >
                        {c.name} <span className="text-slate-400">{c.type}{c.pk ? ' PK' : ''}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      </aside>

      {/* CENTER: editor + results */}
      <main className="flex-1 overflow-y-auto">
        <div className="p-4 max-w-7xl mx-auto">
          <h1 className="text-xl font-semibold text-slate-900 mb-2">SQL Console (Read-Only)</h1>
          <div className="bg-amber-50 border border-amber-300 text-amber-900 rounded px-3 py-2 text-sm mb-4">
            ⚠ READ-ONLY CONSOLE. Allowed: SELECT, WITH, EXPLAIN, PRAGMA. All queries are audited. Admin access only.
          </div>

          {/* Toolbar */}
          <div className="flex flex-wrap items-center gap-2 mb-2 relative">
            <div className="relative">
              <button
                ref={snippetsBtnRef}
                onClick={() => { setSnippetsOpen(o => !o); setHistoryOpen(false) }}
                className="px-3 py-1.5 text-sm border border-slate-300 rounded bg-white hover:bg-slate-50"
              >
                Snippets ▾
              </button>
              {snippetsOpen && (
                <div className="absolute z-20 mt-1 w-96 max-h-96 overflow-y-auto bg-white border border-slate-200 rounded shadow-lg">
                  {Object.entries(snippets.reduce((acc, s) => {
                    (acc[s.group] = acc[s.group] || []).push(s); return acc
                  }, {})).map(([group, list]) => (
                    <div key={group}>
                      <div className="text-[11px] font-semibold uppercase text-slate-500 px-3 py-1 bg-slate-50 sticky top-0">{group}</div>
                      {list.map((s, i) => (
                        <button
                          key={`${group}-${i}`}
                          onClick={() => { setSqlText(s.sql); setSnippetsOpen(false) }}
                          className="block w-full text-left px-3 py-2 hover:bg-blue-50 border-b border-slate-100 last:border-0"
                        >
                          <div className="text-sm font-medium text-slate-800">{s.name}</div>
                          <div className="text-xs text-slate-500 mt-0.5">{s.description}</div>
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="relative">
              <button
                ref={historyBtnRef}
                onClick={() => { setHistoryOpen(o => !o); setSnippetsOpen(false); if (!historyOpen) loadHistory() }}
                className="px-3 py-1.5 text-sm border border-slate-300 rounded bg-white hover:bg-slate-50"
              >
                History ▾
              </button>
              {historyOpen && (
                <div className="absolute z-20 mt-1 w-[28rem] max-h-96 overflow-y-auto bg-white border border-slate-200 rounded shadow-lg">
                  {history.length === 0 && <div className="px-3 py-2 text-sm text-slate-500">No history yet</div>}
                  {history.map(h => (
                    <button
                      key={h.id}
                      onClick={() => { setSqlText(h.sql || ''); setHistoryOpen(false) }}
                      className="block w-full text-left px-3 py-2 hover:bg-blue-50 border-b border-slate-100 last:border-0"
                    >
                      <div className="flex items-center gap-2 text-xs">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                          h.status === 'ok' ? 'bg-green-100 text-green-700' :
                          h.status === 'rejected' ? 'bg-red-100 text-red-700' :
                          'bg-amber-100 text-amber-700'
                        }`}>{h.status}</span>
                        <span className="text-slate-500">{relativeTime(h.ts)}</span>
                        {h.ms != null && <span className="text-slate-400 tabular-nums">{h.ms}ms</span>}
                        {h.row_count != null && <span className="text-slate-400 tabular-nums">{h.row_count} rows</span>}
                      </div>
                      <div className="font-mono text-xs text-slate-700 mt-0.5 truncate">
                        {(h.sql || '').slice(0, 80)}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="flex-1" />

            <button
              onClick={runQuery}
              disabled={loading || !sqlText.trim()}
              className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed"
            >
              {loading ? 'Running…' : 'Run (⌘+Enter)'}
            </button>
          </div>

          {/* Editor */}
          <div className="border border-slate-300 rounded overflow-hidden mb-4 bg-white" onKeyDown={handleEditorKeyDown}>
            <CodeMirror
              value={sqlText}
              height="280px"
              theme="light"
              extensions={[sql({ dialect: SQLite, schema: schemaForCompletion, upperCaseKeywords: true })]}
              onChange={(v) => setSqlText(v)}
              basicSetup={{ lineNumbers: true, foldGutter: false, highlightActiveLine: true }}
            />
          </div>

          {/* Error callout */}
          {error && (
            <div className="bg-red-50 border border-red-300 text-red-900 rounded p-3 text-sm mb-4">
              <div className="font-semibold">{error.code}</div>
              <div className="font-mono text-xs mt-1">{error.reason}</div>
            </div>
          )}

          {/* Results */}
          {results && (
            <div className="bg-white border border-slate-200 rounded">
              <div className="flex items-center justify-between px-3 py-2 border-b border-slate-200 text-sm">
                <div className="text-slate-700">
                  <span className="font-medium">{results.rowCount}</span> rows in <span className="font-medium">{results.ms}ms</span>
                </div>
                <button
                  onClick={() => exportCSV(results.columns, results.rows)}
                  disabled={!results.rows?.length}
                  className="text-xs text-blue-600 hover:underline disabled:text-slate-400"
                >
                  Download CSV
                </button>
              </div>
              {results.truncated && (
                <div className="bg-orange-50 border-b border-orange-200 text-orange-900 px-3 py-2 text-xs">
                  Result capped at {results.rowCount} rows — refine your query for full data.
                </div>
              )}
              {results.slow && (
                <div className="bg-amber-50 border-b border-amber-200 text-amber-900 px-3 py-2 text-xs">
                  Query took &gt;10s; consider adding WHERE / LIMIT.
                </div>
              )}
              <div className="overflow-auto" style={{ maxHeight: '60vh' }}>
                {results.rows?.length === 0 ? (
                  <div className="px-3 py-6 text-center text-sm text-slate-500">No rows</div>
                ) : (
                  <table className="min-w-full text-xs">
                    <thead className="bg-slate-100 sticky top-0">
                      <tr>
                        {(results.columns || []).map(c => (
                          <th
                            key={c}
                            onClick={() => handleSort(c)}
                            className="px-2 py-1.5 text-left font-medium text-slate-700 border-b border-slate-200 cursor-pointer hover:bg-slate-200 whitespace-nowrap"
                          >
                            {c}{sortCol === c ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {displayedRows.map((r, i) => (
                        <tr key={i} className="hover:bg-blue-50 border-b border-slate-100">
                          {(results.columns || []).map(c => (
                            <td key={c} className="px-2 py-1 font-mono text-slate-800 whitespace-nowrap">
                              {r[c] == null ? <span className="text-slate-400">NULL</span> :
                                typeof r[c] === 'object' ? JSON.stringify(r[c]) : String(r[c])}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
              {moreRows && (
                <div className="px-3 py-2 text-xs text-slate-500 border-t border-slate-200">
                  Showing first 200 of {results.rowCount} — Download CSV for full results.
                </div>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
