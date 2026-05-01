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

// Phase 2 — mirror of backend stripCommentsAndStrings. Used only for the
// write-intent UX gate; the backend validator is the real guard.
function stripCommentsAndStringsClient(sql) {
  let s = String(sql)
  s = s.replace(/\/\*[\s\S]*?\*\//g, '')
  s = s.replace(/--[^\n]*/g, '')
  s = s.replace(/'(?:''|[^'])*'/g, "''")
  s = s.replace(/"(?:""|[^"])*"/g, '""')
  return s
}

function detectWriteIntent(sql) {
  const stripped = stripCommentsAndStringsClient(sql).trim().toUpperCase()
  return /^(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|REPLACE)\b/.test(stripped)
}

function isDdlIntent(sql) {
  const stripped = stripCommentsAndStringsClient(sql).trim().toUpperCase()
  return /^(CREATE|ALTER|DROP|REPLACE)\b/.test(stripped)
}

// Compare two row objects by every key; return Set of column names whose
// values differ (used to highlight UPDATE diffs).
function changedColumns(before, after) {
  if (!before || !after) return new Set()
  const out = new Set()
  const keys = new Set([...Object.keys(before), ...Object.keys(after)])
  for (const k of keys) {
    const a = before[k], b = after[k]
    if (a === null && b === null) continue
    if (a !== b) out.add(k)
  }
  return out
}

function formatCellValue(v) {
  if (v === null || v === undefined) return null
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
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

  // ── Phase 2: write flow state ────────────────────────────────
  // step transitions: null → 'preview-input' → 'diff' → 'confirm' → null
  // Or: null → 'snapshots' (browser) → 'diff' (after restore preview) → 'confirm'
  const [writeFlowStep, setWriteFlowStep] = useState(null)
  const [pendingRemark, setPendingRemark] = useState('')
  const [pendingDdlToken, setPendingDdlToken] = useState('')
  const [pendingAcceptUnscoped, setPendingAcceptUnscoped] = useState(false)
  const [unscopedConfirmText, setUnscopedConfirmText] = useState('')
  const [previewData, setPreviewData] = useState(null)
  const [previewError, setPreviewError] = useState(null)
  const [previewBusy, setPreviewBusy] = useState(false)
  const [confirmRemarkInput, setConfirmRemarkInput] = useState('')
  const [confirmError, setConfirmError] = useState(null)
  const [committing, setCommitting] = useState(false)
  const [snapshotsList, setSnapshotsList] = useState([])
  const [snapshotsLoading, setSnapshotsLoading] = useState(false)
  const [snapshotsOpen, setSnapshotsOpen] = useState(false)
  const [now, setNow] = useState(Date.now())
  const [lastCommitToast, setLastCommitToast] = useState(null)

  const snippetsBtnRef = useRef(null)
  const historyBtnRef = useRef(null)
  const snapshotsBtnRef = useRef(null)

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

  // Phase 2: write flow entry point. Detects intent client-side; the
  // backend's validateWriteSql is the real guard. Reads keep the existing
  // runQuery code path unchanged.
  const handleRun = useCallback(() => {
    const text = sqlText.trim()
    if (!text) return
    if (detectWriteIntent(text)) {
      setPendingRemark('')
      setPendingDdlToken('')
      setPendingAcceptUnscoped(false)
      setUnscopedConfirmText('')
      setPreviewError(null)
      setPreviewData(null)
      setLastCommitToast(null)
      setError(null)
      setWriteFlowStep('preview-input')
      return
    }
    runQuery()
  }, [sqlText, runQuery])

  const handleEditorKeyDown = (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      handleRun()
    }
  }

  // Submit /preview, transition to DiffView on success.
  const submitPreview = useCallback(async () => {
    setPreviewBusy(true)
    setPreviewError(null)
    try {
      const body = {
        sql: sqlText.trim(),
        remark: pendingRemark.trim()
      }
      if (pendingAcceptUnscoped) body.acceptUnscopedWrite = true
      const headers = {}
      if (pendingDdlToken) headers['X-SQL-Console-DDL-Token'] = pendingDdlToken
      const res = await api.post('/admin/sql/preview', body, { headers })
      setPreviewData(res.data)
      setWriteFlowStep('diff')
      loadHistory()
    } catch (err) {
      const data = err.response?.data || {}
      const code = data.code || 'NETWORK_ERROR'
      const reason = data.reason || err.message
      // UNSCOPED_WRITE_BLOCKED: surface a confirmation request inline.
      if (code === 'UNSCOPED_WRITE_BLOCKED') {
        setPendingAcceptUnscoped(false)
        setUnscopedConfirmText('')
        setPreviewError({ code, reason, needsUnscopedConfirm: true })
      } else {
        setPreviewError({ code, reason })
      }
    } finally {
      setPreviewBusy(false)
    }
  }, [sqlText, pendingRemark, pendingAcceptUnscoped, pendingDdlToken, loadHistory])

  const closeWriteFlow = useCallback(() => {
    setWriteFlowStep(null)
    setPreviewData(null)
    setPreviewError(null)
    setPendingRemark('')
    setPendingDdlToken('')
    setPendingAcceptUnscoped(false)
    setUnscopedConfirmText('')
    setConfirmRemarkInput('')
    setConfirmError(null)
  }, [])

  const rollbackPreview = useCallback(async () => {
    if (previewData?.txn_id) {
      try {
        await api.post(`/admin/sql/rollback/${previewData.txn_id}`)
      } catch { /* tolerate; the txn may have already been auto-rolled back */ }
    }
    closeWriteFlow()
    loadHistory()
  }, [previewData, closeWriteFlow, loadHistory])

  // Countdown timer — anchored on Date.now() comparison so it works even
  // when the tab is in the background (setInterval can be throttled but
  // the diff is recomputed on next render).
  useEffect(() => {
    if (writeFlowStep !== 'diff' && writeFlowStep !== 'confirm') return
    const i = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(i)
  }, [writeFlowStep])

  const expiresMs = previewData ? new Date(previewData.expires_at).getTime() : 0
  const remainingSec = previewData ? Math.max(0, Math.floor((expiresMs - now) / 1000)) : 0

  // When the timer hits 0 mid-flow, fire a best-effort rollback. The server
  // has its own TTL handler, so this is just to get the UI back to a clean
  // state ASAP.
  useEffect(() => {
    if ((writeFlowStep === 'diff' || writeFlowStep === 'confirm')
        && previewData && remainingSec === 0) {
      rollbackPreview()
    }
  }, [remainingSec, writeFlowStep, previewData, rollbackPreview])

  const executeCommit = useCallback(async () => {
    if (!previewData) return
    setCommitting(true)
    setConfirmError(null)
    try {
      const res = await api.post(
        `/admin/sql/commit/${previewData.txn_id}`,
        { confirmRemark: confirmRemarkInput }
      )
      const summary = res.data
      setLastCommitToast({
        audit_id: summary.audit_id,
        affected_rows: summary.affected_rows,
        snapshot_id: summary.snapshot_id,
        drift_check: summary.drift_check,
        table_name: summary.table_name
      })
      closeWriteFlow()
      loadHistory()
    } catch (err) {
      const data = err.response?.data || {}
      setConfirmError({
        code: data.code || 'NETWORK_ERROR',
        reason: data.reason || err.message
      })
    } finally {
      setCommitting(false)
    }
  }, [previewData, confirmRemarkInput, closeWriteFlow, loadHistory])

  const loadSnapshots = useCallback(async () => {
    setSnapshotsLoading(true)
    try {
      const sql = `SELECT s.id, s.audit_id, s.table_name, s.affected_count, s.ts, a.remark, a.actor
FROM sql_console_write_snapshots s
JOIN sql_console_audit a ON a.id = s.audit_id
WHERE a.status = 'ok'
ORDER BY s.id DESC
LIMIT 50`
      const res = await api.post('/admin/sql/execute', { sql })
      setSnapshotsList(res.data?.rows || [])
    } catch {
      setSnapshotsList([])
    } finally {
      setSnapshotsLoading(false)
    }
  }, [])

  const startRestore = useCallback(async (auditId) => {
    const remark = window.prompt(
      'Restore snapshot — describe why (≥10 characters):',
      ''
    )
    if (remark == null) return
    if (remark.trim().length < 10) {
      window.alert('Restore aborted: remark must be at least 10 characters.')
      return
    }
    setSnapshotsOpen(false)
    try {
      const res = await api.post(
        `/admin/sql/snapshot/${auditId}/restore`,
        { remark: remark.trim() }
      )
      setPreviewData(res.data)
      setWriteFlowStep('diff')
      setLastCommitToast(null)
    } catch (err) {
      const data = err.response?.data || {}
      window.alert(`Restore failed: ${data.code || 'ERROR'} — ${data.reason || err.message}`)
    }
  }, [])

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
            ⚠ Reads (SELECT/WITH/EXPLAIN/PRAGMA) run instantly. Writes (INSERT/UPDATE/DELETE)
            require remark + preview + commit. Every action is audited. Admin access only.
          </div>

          {lastCommitToast && (
            <div className="bg-green-50 border border-green-300 text-green-900 rounded px-3 py-2 text-sm mb-4 flex items-start justify-between">
              <div>
                <div className="font-semibold">
                  Write committed — audit_id #{lastCommitToast.audit_id}
                  {lastCommitToast.table_name ? ` on ${lastCommitToast.table_name}` : ''}
                </div>
                <div className="text-xs mt-0.5">
                  {lastCommitToast.affected_rows} row(s) changed.
                  {lastCommitToast.snapshot_id != null && (
                    <> Snapshot #{lastCommitToast.snapshot_id} stored — restore from the Snapshots dropdown.</>
                  )}
                  {lastCommitToast.drift_check?.ran && (
                    <> Drift check: {lastCommitToast.drift_check.drift_count} row(s) over ₹1 threshold
                      {lastCommitToast.drift_check.warning ? ' — investigate.' : '.'}</>
                  )}
                </div>
              </div>
              <button
                onClick={() => setLastCommitToast(null)}
                className="text-green-700 hover:text-green-900 text-xs"
              >dismiss</button>
            </div>
          )}

          {/* Toolbar */}
          <div className="flex flex-wrap items-center gap-2 mb-2 relative">
            <div className="relative">
              <button
                ref={snippetsBtnRef}
                onClick={() => { setSnippetsOpen(o => !o); setHistoryOpen(false); setSnapshotsOpen(false) }}
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
                onClick={() => { setHistoryOpen(o => !o); setSnippetsOpen(false); setSnapshotsOpen(false); if (!historyOpen) loadHistory() }}
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

            <div className="relative">
              <button
                ref={snapshotsBtnRef}
                onClick={() => {
                  setSnapshotsOpen(o => !o)
                  setSnippetsOpen(false)
                  setHistoryOpen(false)
                  if (!snapshotsOpen) loadSnapshots()
                }}
                className="px-3 py-1.5 text-sm border border-slate-300 rounded bg-white hover:bg-slate-50"
              >
                Snapshots ▾
              </button>
              {snapshotsOpen && (
                <div className="absolute z-20 mt-1 w-[32rem] max-h-96 overflow-y-auto bg-white border border-slate-200 rounded shadow-lg">
                  {snapshotsLoading && (
                    <div className="px-3 py-2 text-sm text-slate-500">Loading…</div>
                  )}
                  {!snapshotsLoading && snapshotsList.length === 0 && (
                    <div className="px-3 py-2 text-sm text-slate-500">
                      No snapshots yet. Snapshots are created when an admin commits a write
                      to a protected table (employees, salary_computations, day_calculations,
                      attendance_processed, salary_structures).
                    </div>
                  )}
                  {snapshotsList.map(row => (
                    <div
                      key={row.id}
                      className="px-3 py-2 border-b border-slate-100 last:border-0 hover:bg-blue-50"
                    >
                      <div className="flex items-center gap-2 text-xs">
                        <span className="px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 font-medium">
                          #{row.audit_id}
                        </span>
                        <span className="font-mono text-slate-700">{row.table_name}</span>
                        <span className="text-slate-400 tabular-nums">{row.affected_count} row(s)</span>
                        <span className="text-slate-500">{relativeTime(row.ts)}</span>
                        <span className="text-slate-500">by {row.actor}</span>
                      </div>
                      <div className="text-xs text-slate-700 mt-0.5">
                        {row.remark ? `“${row.remark}”` : <span className="italic text-slate-400">no remark</span>}
                      </div>
                      <button
                        onClick={() => startRestore(row.audit_id)}
                        className="mt-1 text-xs text-blue-600 hover:underline"
                      >
                        Restore this snapshot →
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex-1" />

            <button
              onClick={handleRun}
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

      {/* ── Phase 2: Preview Input Modal ───────────────────────── */}
      {writeFlowStep === 'preview-input' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-40 p-4">
          <div className="bg-white rounded shadow-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
              <h2 className="text-base font-semibold text-slate-900">
                Preview write — describe why
              </h2>
              <button onClick={closeWriteFlow} className="text-slate-500 hover:text-slate-800">✕</button>
            </div>
            <div className="p-4 space-y-3">
              <div>
                <label className="text-xs font-medium text-slate-600 mb-1 block">SQL</label>
                <pre className="text-xs font-mono bg-slate-50 border border-slate-200 rounded p-2 max-h-32 overflow-auto whitespace-pre-wrap">{sqlText}</pre>
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600 mb-1 block">
                  Remark (≥ 10 characters, recorded in audit log)
                </label>
                <textarea
                  value={pendingRemark}
                  onChange={(e) => setPendingRemark(e.target.value)}
                  rows={3}
                  className="w-full text-sm border border-slate-300 rounded p-2 focus:outline-none focus:border-blue-500"
                  placeholder="Why are you making this change?"
                />
                <div className="text-[11px] text-slate-500 mt-0.5 tabular-nums">
                  {pendingRemark.trim().length} / 10
                </div>
              </div>
              {isDdlIntent(sqlText) && (
                <div>
                  <label className="text-xs font-medium text-slate-600 mb-1 block">
                    DDL token (CREATE / ALTER / DROP requires X-SQL-Console-DDL-Token)
                  </label>
                  <input
                    type="password"
                    value={pendingDdlToken}
                    onChange={(e) => setPendingDdlToken(e.target.value)}
                    className="w-full text-sm border border-slate-300 rounded p-2 font-mono focus:outline-none focus:border-blue-500"
                    placeholder="paste SQL_CONSOLE_DDL_TOKEN here"
                  />
                </div>
              )}
              {previewError && (
                <div className="bg-red-50 border border-red-300 text-red-900 rounded p-3 text-sm">
                  <div className="font-semibold">{previewError.code}</div>
                  <div className="text-xs mt-0.5">{previewError.reason}</div>
                  {previewError.needsUnscopedConfirm && (
                    <div className="mt-2 pt-2 border-t border-red-200">
                      <p className="text-xs">
                        This UPDATE/DELETE has no WHERE clause and would touch every row.
                        Type <span className="font-mono font-bold">CONFIRM</span> below to proceed:
                      </p>
                      <input
                        type="text"
                        value={unscopedConfirmText}
                        onChange={(e) => {
                          setUnscopedConfirmText(e.target.value)
                          setPendingAcceptUnscoped(e.target.value === 'CONFIRM')
                        }}
                        className="mt-1 w-full text-sm border border-red-300 rounded p-2 font-mono"
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="px-4 py-3 border-t border-slate-200 flex items-center justify-end gap-2">
              <button
                onClick={closeWriteFlow}
                disabled={previewBusy}
                className="px-3 py-1.5 text-sm border border-slate-300 rounded bg-white hover:bg-slate-50 disabled:opacity-50"
              >Cancel</button>
              <button
                onClick={submitPreview}
                disabled={previewBusy || pendingRemark.trim().length < 10 ||
                          (previewError?.needsUnscopedConfirm && !pendingAcceptUnscoped)}
                className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed"
              >
                {previewBusy ? 'Previewing…' : 'Preview write'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Phase 2: Diff View ─────────────────────────────────── */}
      {writeFlowStep === 'diff' && previewData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-40 p-4">
          <div className="bg-white rounded shadow-lg max-w-5xl w-full max-h-[90vh] overflow-y-auto">
            <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text-slate-900">
                  PREVIEW — {previewData.op}{previewData.inverse_op ? ` (${previewData.inverse_op})` : ''}{' '}
                  on {previewData.table_name}
                </h2>
                <div className="text-xs text-slate-500 mt-0.5">
                  txn_id: <span className="font-mono">{previewData.txn_id}</span> ·
                  expires in <span className={`font-bold tabular-nums ${remainingSec <= 10 ? 'text-red-600' : 'text-slate-700'}`}>
                    {remainingSec}s
                  </span>
                </div>
              </div>
              <button onClick={rollbackPreview} className="text-slate-500 hover:text-slate-800">✕</button>
            </div>
            <div className="p-4 space-y-3">
              <div className="bg-slate-50 border border-slate-200 rounded p-3 text-xs">
                <div className="text-slate-500 uppercase font-semibold mb-1">Remark</div>
                <div className="text-slate-800">“{previewData.remark}”</div>
              </div>
              <div className="text-sm">
                <span className="font-semibold tabular-nums text-blue-700">{previewData.affected_rows}</span>
                <span className="text-slate-700"> row(s) will be changed</span>
                {!previewData.is_protected_table && (
                  <span className="text-slate-500 italic ml-2">(non-protected table — no row-level diff captured)</span>
                )}
                {previewData.restored_from_audit_id != null && (
                  <span className="text-purple-700 ml-2">
                    · restoring from audit_id #{previewData.restored_from_audit_id}
                  </span>
                )}
              </div>
              <details className="text-xs">
                <summary className="cursor-pointer text-slate-600 hover:text-slate-900">SQL (click to expand)</summary>
                <pre className="mt-1 font-mono bg-slate-50 border border-slate-200 rounded p-2 max-h-40 overflow-auto whitespace-pre-wrap">{previewData.sql}</pre>
              </details>

              {previewData.is_protected_table && (
                <div className="border border-slate-200 rounded overflow-hidden">
                  <div className="bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700">Row-level diff</div>
                  <div className="overflow-auto max-h-96">
                    <DiffTable
                      op={previewData.op === 'RESTORE' ? previewData.inverse_op : previewData.op}
                      rowsBefore={previewData.rows_before || []}
                      rowsAfter={previewData.rows_after || []}
                    />
                  </div>
                </div>
              )}
            </div>
            <div className="px-4 py-3 border-t border-slate-200 flex items-center justify-end gap-2 bg-slate-50">
              <button
                onClick={rollbackPreview}
                className="px-3 py-1.5 text-sm border border-red-300 text-red-700 rounded bg-white hover:bg-red-50"
              >
                Cancel — Rollback
              </button>
              <button
                onClick={() => {
                  setConfirmRemarkInput('')
                  setConfirmError(null)
                  setWriteFlowStep('confirm')
                }}
                className="px-4 py-1.5 text-sm bg-green-600 text-white rounded hover:bg-green-700"
              >
                Commit →
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Phase 2: Confirm Commit Modal ──────────────────────── */}
      {writeFlowStep === 'confirm' && previewData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-40 p-4">
          <div className="bg-white rounded shadow-lg max-w-2xl w-full">
            <div className="px-4 py-3 border-b border-slate-200">
              <h2 className="text-base font-semibold text-slate-900">
                Confirm commit — re-type remark
              </h2>
              <div className="text-xs text-slate-500 mt-0.5">
                expires in <span className={`font-bold tabular-nums ${remainingSec <= 10 ? 'text-red-600' : 'text-slate-700'}`}>{remainingSec}s</span>
              </div>
            </div>
            <div className="p-4 space-y-3 text-sm">
              <div className="bg-slate-50 border border-slate-200 rounded p-3 space-y-1 text-xs">
                <div><span className="text-slate-500">Table:</span> <span className="font-mono">{previewData.table_name}</span></div>
                <div><span className="text-slate-500">Op:</span> {previewData.op}{previewData.inverse_op ? ` (${previewData.inverse_op})` : ''}</div>
                <div><span className="text-slate-500">Affected rows:</span> <span className="tabular-nums font-semibold">{previewData.affected_rows}</span></div>
                <div><span className="text-slate-500">Remark:</span> “{previewData.remark}”</div>
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600 mb-1 block">
                  Re-type the remark exactly to confirm
                </label>
                <input
                  type="text"
                  value={confirmRemarkInput}
                  onChange={(e) => setConfirmRemarkInput(e.target.value)}
                  className={`w-full text-sm border rounded p-2 focus:outline-none ${
                    confirmError?.code === 'REMARK_MISMATCH'
                      ? 'border-red-400 focus:border-red-500'
                      : 'border-slate-300 focus:border-blue-500'
                  }`}
                  placeholder={previewData.remark}
                  autoFocus
                />
              </div>
              {confirmError && (
                <div className="bg-red-50 border border-red-300 text-red-900 rounded p-3 text-sm">
                  <div className="font-semibold">{confirmError.code}</div>
                  <div className="text-xs mt-0.5">{confirmError.reason}</div>
                </div>
              )}
            </div>
            <div className="px-4 py-3 border-t border-slate-200 flex items-center justify-end gap-2 bg-slate-50">
              <button
                onClick={() => setWriteFlowStep('diff')}
                disabled={committing}
                className="px-3 py-1.5 text-sm border border-slate-300 rounded bg-white hover:bg-slate-50 disabled:opacity-50"
              >← Back to diff</button>
              <button
                onClick={executeCommit}
                disabled={committing || confirmRemarkInput !== previewData.remark}
                className="px-4 py-1.5 text-sm bg-green-600 text-white rounded hover:bg-green-700 disabled:bg-slate-300 disabled:cursor-not-allowed"
              >
                {committing ? 'Committing…' : 'Confirm Commit'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Phase 2: row-level diff renderer ─────────────────────────
// Shows changed-only columns by default for UPDATE; full row for INSERT/DELETE.
// Caps display at 50 rows; user is told if there are more.
function DiffTable({ op, rowsBefore, rowsAfter }) {
  if (op === 'INSERT') {
    return <SimpleRowList tone="green" label="will be inserted" rows={rowsAfter} />
  }
  if (op === 'DELETE') {
    return <SimpleRowList tone="red" label="will be deleted" rows={rowsBefore} />
  }
  // UPDATE — pair rows_before[i] with rows_after[i] (both sourced from
  // backend in matched order).
  const pairs = []
  const maxLen = Math.max(rowsBefore.length, rowsAfter.length)
  for (let i = 0; i < Math.min(maxLen, 50); i++) {
    pairs.push({ before: rowsBefore[i] || {}, after: rowsAfter[i] || {} })
  }
  if (pairs.length === 0) {
    return <div className="px-3 py-3 text-xs text-slate-500">No row-level data captured.</div>
  }
  return (
    <div className="divide-y divide-slate-200">
      {pairs.map((p, idx) => {
        const changed = changedColumns(p.before, p.after)
        const colsToShow = changed.size > 0
          ? [...changed]
          : Object.keys(p.before).slice(0, 6)
        return (
          <div key={idx} className="px-3 py-2">
            <div className="text-[11px] font-semibold text-slate-500 mb-1">
              Row {idx + 1} {changed.size > 0 && <span>({changed.size} field(s) changed)</span>}
            </div>
            <table className="text-xs w-full">
              <thead>
                <tr className="text-slate-500">
                  <th className="text-left font-medium pr-2">Column</th>
                  <th className="text-left font-medium pr-2">Before</th>
                  <th className="text-left font-medium">After</th>
                </tr>
              </thead>
              <tbody>
                {colsToShow.map(col => {
                  const isChanged = changed.has(col)
                  return (
                    <tr key={col} className={isChanged ? 'bg-amber-50' : ''}>
                      <td className="font-mono pr-2 align-top">{col}</td>
                      <td className="font-mono pr-2 text-slate-700 align-top">
                        {formatCellValue(p.before[col]) ?? <span className="text-slate-400">NULL</span>}
                      </td>
                      <td className={`font-mono align-top ${isChanged ? 'text-green-700 font-semibold' : 'text-slate-700'}`}>
                        {formatCellValue(p.after[col]) ?? <span className="text-slate-400">NULL</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )
      })}
      {maxLen > 50 && (
        <div className="px-3 py-2 text-xs text-slate-500">
          Showing first 50 of {maxLen} affected rows.
        </div>
      )}
    </div>
  )
}

function SimpleRowList({ tone, label, rows }) {
  if (!rows || rows.length === 0) {
    return <div className="px-3 py-3 text-xs text-slate-500">No rows captured.</div>
  }
  const palette = tone === 'green'
    ? 'bg-green-50 border-green-200 text-green-900'
    : 'bg-red-50 border-red-200 text-red-900'
  const display = rows.slice(0, 50)
  const cols = Object.keys(display[0]).slice(0, 8)
  return (
    <div className={`border-t ${palette}`}>
      <div className="px-3 py-1.5 text-xs font-semibold">{rows.length} row(s) {label}</div>
      <div className="overflow-x-auto">
        <table className="text-xs w-full">
          <thead>
            <tr>
              {cols.map(c => (
                <th key={c} className="text-left font-medium px-2 py-1 border-t border-b border-slate-200">{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {display.map((r, i) => (
              <tr key={i} className="border-b border-slate-100">
                {cols.map(c => (
                  <td key={c} className="font-mono px-2 py-1 align-top">
                    {formatCellValue(r[c]) ?? <span className="text-slate-400">NULL</span>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > 50 && (
        <div className="px-3 py-1.5 text-xs">Showing first 50 of {rows.length}.</div>
      )}
    </div>
  )
}
