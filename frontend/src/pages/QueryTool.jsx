import React, { useState, useEffect, useCallback } from 'react'
import { useAppStore } from '../store/appStore'
import api from '../utils/api'

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function exportCSV(columns, rows) {
  const header = columns.join(',')
  const body = rows.map(r => columns.map(c => {
    const val = r[c]
    if (val === null || val === undefined) return ''
    const str = String(val)
    return str.includes(',') || str.includes('"') || str.includes('\n')
      ? `"${str.replace(/"/g, '""')}"` : str
  }).join(',')).join('\n')
  const csv = header + '\n' + body
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = `query-results-${Date.now()}.csv`; a.click()
  URL.revokeObjectURL(url)
}

export default function QueryTool() {
  const storeMonth = useAppStore(s => s.selectedMonth)
  const storeYear = useAppStore(s => s.selectedYear)

  const [month, setMonth] = useState(storeMonth)
  const [year, setYear] = useState(storeYear)
  const [mode, setMode] = useState('natural') // 'natural' | 'sql'
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [sqlExpanded, setSqlExpanded] = useState(false)
  const [savedQueries, setSavedQueries] = useState([])
  const [sortCol, setSortCol] = useState(null)
  const [sortDir, setSortDir] = useState('asc')

  // Fetch saved queries on mount
  useEffect(() => {
    api.get('/query-tool/saved')
      .then(res => setSavedQueries(res.data?.data || []))
      .catch(() => {})
  }, [])

  const runQuery = useCallback(async (overrideQuery, overrideMode) => {
    const q = overrideQuery || query
    const m = overrideMode || mode
    if (!q.trim()) return

    setLoading(true)
    setError(null)
    setResult(null)
    setSortCol(null)

    try {
      const res = await api.post('/query-tool/run', {
        mode: m,
        query: q,
        month,
        year
      })
      setResult(res.data)
      setSqlExpanded(m === 'natural') // auto-expand SQL for natural language mode
    } catch (err) {
      const data = err.response?.data
      setError(data?.error || err.message || 'Request failed')
      if (data?.sql) {
        setResult({ sql: data.sql })
        setSqlExpanded(true)
      }
    } finally {
      setLoading(false)
    }
  }, [query, mode, month, year])

  const handleSavedQuery = (saved) => {
    // Replace :month and :year placeholders with selected values
    const sql = saved.query
      .replace(/:month/g, String(month))
      .replace(/:year/g, String(year))
    setMode('sql')
    setQuery(sql)
    runQuery(sql, 'sql')
  }

  const handleKeyDown = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault()
      runQuery()
    }
  }

  const handleSort = (col) => {
    if (sortCol === col) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortCol(col)
      setSortDir('asc')
    }
  }

  // Sort rows
  const sortedRows = React.useMemo(() => {
    if (!result?.rows || !sortCol) return result?.rows || []
    return [...result.rows].sort((a, b) => {
      const va = a[sortCol], vb = b[sortCol]
      if (va === null || va === undefined) return 1
      if (vb === null || vb === undefined) return -1
      if (typeof va === 'number' && typeof vb === 'number') {
        return sortDir === 'asc' ? va - vb : vb - va
      }
      const sa = String(va).toLowerCase(), sb = String(vb).toLowerCase()
      return sortDir === 'asc' ? sa.localeCompare(sb) : sb.localeCompare(sa)
    })
  }, [result?.rows, sortCol, sortDir])

  return (
    <div className="space-y-4">
      {/* Header with month/year selector */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-800">Database Query Tool</h2>
          <p className="text-sm text-slate-500">Ask questions in English or paste raw SQL. SELECT-only, 100-row limit.</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={month}
            onChange={e => setMonth(Number(e.target.value))}
            className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm bg-white"
          >
            {MONTHS.map((m, i) => (
              <option key={i} value={i + 1}>{m}</option>
            ))}
          </select>
          <select
            value={year}
            onChange={e => setYear(Number(e.target.value))}
            className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm bg-white"
          >
            {[2024, 2025, 2026, 2027].map(y => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Saved Queries */}
      {savedQueries.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs font-medium text-slate-500 mb-2 uppercase tracking-wide">Saved Diagnostic Queries</p>
          <div className="flex flex-wrap gap-2">
            {savedQueries.map(sq => (
              <button
                key={sq.id}
                onClick={() => handleSavedQuery(sq)}
                disabled={loading}
                className="px-3 py-1.5 text-xs font-medium bg-slate-100 hover:bg-blue-50 hover:text-blue-700 text-slate-700 rounded-lg border border-slate-200 hover:border-blue-200 transition-colors disabled:opacity-50"
                title={sq.description}
              >
                {sq.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Mode tabs + Query input */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
        <div className="flex gap-1 border-b border-slate-200 pb-2">
          <button
            onClick={() => setMode('natural')}
            className={`px-4 py-1.5 text-sm font-medium rounded-t-lg transition-colors ${
              mode === 'natural'
                ? 'bg-blue-50 text-blue-700 border-b-2 border-blue-600'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            Ask in English
          </button>
          <button
            onClick={() => setMode('sql')}
            className={`px-4 py-1.5 text-sm font-medium rounded-t-lg transition-colors ${
              mode === 'sql'
                ? 'bg-blue-50 text-blue-700 border-b-2 border-blue-600'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            Paste SQL
          </button>
        </div>

        <textarea
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={mode === 'natural'
            ? 'e.g. "Show me employees with net salary above 30000 this month"'
            : 'SELECT employee_code, name FROM employees WHERE status=\'Active\' LIMIT 10'
          }
          rows={mode === 'sql' ? 6 : 3}
          className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-y"
        />

        <div className="flex items-center justify-between">
          <p className="text-xs text-slate-400">Ctrl+Enter to run</p>
          <button
            onClick={() => runQuery()}
            disabled={loading || !query.trim()}
            className="px-5 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
          >
            {loading && (
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            )}
            {loading ? 'Running...' : 'Run Query'}
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4">
          <p className="text-sm text-red-700 font-medium">Error</p>
          <p className="text-sm text-red-600 mt-1 font-mono whitespace-pre-wrap">{error}</p>
        </div>
      )}

      {/* Generated SQL (collapsible) */}
      {result?.sql && (
        <div className="bg-white border border-slate-200 rounded-xl">
          <button
            onClick={() => setSqlExpanded(!sqlExpanded)}
            className="w-full flex items-center justify-between px-4 py-3 text-sm text-slate-600 hover:bg-slate-50 rounded-xl"
          >
            <span className="font-medium">Generated SQL</span>
            <span className="text-xs">{sqlExpanded ? '▲' : '▼'}</span>
          </button>
          {sqlExpanded && (
            <div className="px-4 pb-4">
              <pre className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs font-mono text-slate-700 overflow-x-auto whitespace-pre-wrap">
                {result.sql}
              </pre>
            </div>
          )}
        </div>
      )}

      {/* Results table */}
      {result?.success && (
        <div className="bg-white border border-slate-200 rounded-xl">
          {/* Results header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium text-slate-700">
                {result.rowCount} row{result.rowCount !== 1 ? 's' : ''}
              </span>
              {result.truncated && (
                <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">
                  Truncated at {MAX_ROWS_DISPLAY}
                </span>
              )}
              <span className="text-xs text-slate-400">{result.duration}ms</span>
            </div>
            {result.rows.length > 0 && (
              <button
                onClick={() => exportCSV(result.columns, result.rows)}
                className="px-3 py-1.5 text-xs font-medium bg-green-50 text-green-700 hover:bg-green-100 rounded-lg border border-green-200 transition-colors"
              >
                Export CSV
              </button>
            )}
          </div>

          {/* Table */}
          {result.rows.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    {result.columns.map(col => (
                      <th
                        key={col}
                        onClick={() => handleSort(col)}
                        className="px-3 py-2 text-left text-xs font-medium text-slate-500 uppercase tracking-wider cursor-pointer hover:bg-slate-100 select-none whitespace-nowrap"
                      >
                        {col}
                        {sortCol === col && (
                          <span className="ml-1">{sortDir === 'asc' ? '↑' : '↓'}</span>
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {sortedRows.map((row, i) => (
                    <tr key={i} className="hover:bg-slate-50">
                      {result.columns.map(col => (
                        <td key={col} className="px-3 py-2 text-slate-700 whitespace-nowrap font-mono text-xs">
                          {row[col] === null || row[col] === undefined
                            ? <span className="text-slate-300 italic">NULL</span>
                            : typeof row[col] === 'number'
                              ? row[col].toLocaleString('en-IN')
                              : String(row[col])
                          }
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="px-4 py-8 text-center text-sm text-slate-400">
              Query returned no results
            </div>
          )}
        </div>
      )}
    </div>
  )
}

const MAX_ROWS_DISPLAY = 100
