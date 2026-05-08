import React, { useState, useRef, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import clsx from 'clsx'
import {
  salesUploadFile,
  salesUploadPreview,
  salesUploadMatch,
  salesUploadConfirm,
  getSalesEmployees,
  salesTemplateDownloadUrl,
  salesUploadTemplate,
} from '../../utils/api'
import { useAppStore } from '../../store/appStore'
import CompanyFilter from '../../components/shared/CompanyFilter'
import DateSelector from '../../components/common/DateSelector'
import useDateSelector from '../../hooks/useDateSelector'

const MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const CONFIDENCE_BADGE = {
  exact:     'badge-green',
  high:      'badge-green',
  medium:    'badge-blue',
  low:       'badge-yellow',
  unmatched: 'badge-red',
  manual:    'badge-purple',
}

function ConfidenceBadge({ v }) {
  return (
    <span className={clsx(CONFIDENCE_BADGE[v] || 'badge-gray', 'text-[10px]')}>
      {v || '—'}
    </span>
  )
}

// ══════════ Match picker for unmatched / low rows ══════════
function EmployeePicker({ company, initialQuery = '', onPick, disabled }) {
  const [q, setQ] = useState(initialQuery)

  const { data: res, isFetching } = useQuery({
    queryKey: ['sales-employees-picker', company, q],
    queryFn: () => getSalesEmployees({ company, status: 'Active' }),
    enabled: !!company && q.length >= 2,
    staleTime: 60000,
  })
  const all = res?.data?.data || []
  const filtered = useMemo(() => {
    const needle = q.toUpperCase().trim()
    if (!needle || needle.length < 2) return []
    return all.filter(e =>
      (e.name || '').toUpperCase().includes(needle) ||
      (e.code || '').toUpperCase().includes(needle)
    ).slice(0, 15)
  }, [all, q])

  return (
    <div className="relative">
      <input
        type="text"
        value={q}
        disabled={disabled}
        onChange={e => setQ(e.target.value)}
        placeholder="Type 2+ chars of name or code…"
        className="w-full border border-slate-300 rounded px-2 py-1 text-xs"
      />
      {q.length >= 2 && (
        <div className="absolute z-10 mt-1 w-full max-h-56 overflow-y-auto bg-white border border-slate-200 rounded-lg shadow-lg">
          {isFetching && filtered.length === 0 && (
            <div className="px-2 py-1.5 text-xs text-slate-400">Searching…</div>
          )}
          {!isFetching && filtered.length === 0 && (
            <div className="px-2 py-1.5 text-xs text-slate-400">No matches.</div>
          )}
          {filtered.map(e => (
            <button key={e.code} type="button"
              onClick={() => { onPick(e); setQ('') }}
              className="w-full text-left px-2 py-1.5 text-xs hover:bg-blue-50 border-b border-slate-100 last:border-0">
              <span className="font-mono text-slate-500 mr-2">{e.code}</span>
              <span className="text-slate-800">{e.name}</span>
              {e.city_of_operation && <span className="text-slate-400 ml-2">· {e.city_of_operation}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ══════════ Template upload view (Phase 2 — preferred path) ══════════
const REJECTION_TITLE = {
  not_a_valid_xlsx:    'Not a valid Excel file',
  missing_meta_sheet:  'Template metadata sheet missing',
  cycle_mismatch:      'Cycle mismatch',
  unknown_template:    'Unknown template',
  master_drift:        'Sales master changed since download',
  unknown_employee:    'Employee Code not in current master',
  invalid_days_given:  'Days Given is missing or out of range',
  duplicate_employee:  'Same Employee Code on more than one row',
  row_count_mismatch:  'Row count differs from template metadata',
  duplicate_file:      'This exact file was already uploaded',
  persist_failed:      'Database error while saving',
}

function formatRelative(date) {
  const ms = Date.now() - date.getTime()
  const sec = Math.floor(ms / 1000)
  if (sec < 60) return 'just now'
  if (sec < 3600) return `${Math.floor(sec / 60)} min ago`
  if (sec < 86400) return `${Math.floor(sec / 3600)} hr ago`
  return `${Math.floor(sec / 86400)} day(s) ago`
}

function RejectionCard({ rejection }) {
  if (!rejection) return null
  const reason = rejection.rejectionReason
  const d = rejection.rejectionDetails || {}
  return (
    <div className="card border-red-200">
      <div className="card-body">
        <div className="text-sm">
          <div className="font-semibold text-red-700">{REJECTION_TITLE[reason] || reason}</div>
          <div className="text-xs text-slate-500 mt-0.5">Audit row #{rejection.uploadId} (status=rejected)</div>
          <div className="mt-3 space-y-1 text-xs text-slate-700">
            {reason === 'cycle_mismatch' && (
              <div>Template was generated for <span className="font-mono">{d.template?.month}/{d.template?.year} · {d.template?.company}</span> but you're uploading for <span className="font-mono">{d.url?.month}/{d.url?.year} · {d.url?.company}</span>.</div>
            )}
            {reason === 'master_drift' && (
              <div className="space-y-1">
                <div>The sales master changed between download and upload. Re-download the template.</div>
                {Array.isArray(d.added_since_download) && d.added_since_download.length > 0 && (
                  <div><span className="font-medium">Added:</span> <span className="font-mono">{d.added_since_download.join(', ')}</span></div>
                )}
                {Array.isArray(d.removed_since_download) && d.removed_since_download.length > 0 && (
                  <div><span className="font-medium">Removed:</span> <span className="font-mono">{d.removed_since_download.join(', ')}</span></div>
                )}
              </div>
            )}
            {reason === 'unknown_employee' && Array.isArray(d.rows) && (
              <div>{d.count} row(s) reference codes not in the current master:
                <div className="font-mono mt-1 max-h-32 overflow-auto bg-slate-50 rounded px-2 py-1">
                  {d.rows.slice(0, 50).map(r => `row ${r.row}: ${r.code}`).join(' · ')}{d.rows.length > 50 ? ' …' : ''}
                </div>
              </div>
            )}
            {reason === 'invalid_days_given' && Array.isArray(d.rows) && (
              <div>{d.count} row(s) have missing/non-numeric Days Given (must be 0–{d.max}):
                <div className="font-mono mt-1 max-h-32 overflow-auto bg-slate-50 rounded px-2 py-1">
                  {d.rows.slice(0, 50).map(r => `row ${r.row}: ${r.code} (${r.value ?? 'empty'})`).join(' · ')}{d.rows.length > 50 ? ' …' : ''}
                </div>
              </div>
            )}
            {reason === 'duplicate_employee' && Array.isArray(d.rows) && (
              <div>{d.count} duplicate code(s):
                <div className="font-mono mt-1 max-h-32 overflow-auto bg-slate-50 rounded px-2 py-1">
                  {d.rows.map(r => `row ${r.row}: ${r.code}`).join(' · ')}
                </div>
              </div>
            )}
            {reason === 'row_count_mismatch' && (
              <div>Template metadata says {d.meta_count} employees but the Input sheet has {d.input_rows} rows ({d.valid_rows} valid).</div>
            )}
            {reason === 'unknown_template' && (
              <div>The template's snapshot hash isn't in <span className="font-mono">sales_template_downloads</span>. Did you hand-craft the file, or was the row deleted? Re-download from this page.</div>
            )}
            {reason === 'duplicate_file' && (
              <div>An accepted upload with the same exact bytes already exists (#{d.existingUploadId}).</div>
            )}
            {reason === 'not_a_valid_xlsx' && (
              <div>Excel couldn't parse the file. {d?.error ? <span className="font-mono">{d.error}</span> : null}</div>
            )}
            {reason === 'missing_meta_sheet' && (
              <div>The hidden <span className="font-mono">_meta</span> sheet is missing or incomplete{d?.missingKey ? <> (missing key <span className="font-mono">{d.missingKey}</span>)</> : null}. Re-download the template — don't copy/paste rows into a blank sheet.</div>
            )}
            {reason === 'persist_failed' && (
              <div>Server failed to save: <span className="font-mono">{d.error}</span></div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function TemplateUploadView() {
  const navigate = useNavigate()
  const { selectedCompany, selectedMonth, selectedYear } = useAppStore()
  const { dateProps } = useDateSelector({ mode: 'month', syncToStore: true })
  const fileInputRef = useRef(null)
  const [dragOver, setDragOver] = useState(false)
  const [rejection, setRejection] = useState(null)

  const cycleReady = !!selectedCompany && !!selectedMonth && !!selectedYear

  const { data: empRes } = useQuery({
    queryKey: ['sales-employees-freshness', selectedCompany],
    queryFn: () => getSalesEmployees({ company: selectedCompany }),
    enabled: !!selectedCompany,
    staleTime: 60000,
  })
  const lastUpdate = useMemo(() => {
    const rows = empRes?.data?.data || []
    let max = 0
    for (const e of rows) {
      const t = e.updated_at ? new Date(e.updated_at).getTime() : 0
      if (t > max) max = t
    }
    return max ? new Date(max) : null
  }, [empRes])
  const stale = lastUpdate ? (Date.now() - lastUpdate.getTime() > 24 * 3600 * 1000) : true

  const handleDownload = () => {
    if (!cycleReady) { toast.error('Select month, year, company first'); return }
    const url = salesTemplateDownloadUrl({ month: selectedMonth, year: selectedYear, company: selectedCompany })
    window.open(url, '_blank')
  }

  const uploadMut = useMutation({
    mutationFn: ({ file }) => salesUploadTemplate({ file, month: selectedMonth, year: selectedYear, company: selectedCompany }),
    onSuccess: (res) => {
      const body = res.data
      if (body && body.success) {
        setRejection(null)
        toast.success(`Template accepted — ${body.totalRows} rows uploaded`)
        navigate('/sales/compute')
      } else {
        setRejection(body)
      }
    },
    onError: (err) => {
      const body = err?.response?.data
      if (body && body.success === false) {
        setRejection(body)
      } else {
        toast.error(body?.error || 'Upload failed')
      }
    },
  })

  const handleFile = (file) => {
    if (!file) return
    if (!cycleReady) { toast.error('Select month, year, company first'); return }
    if (file.size > 10 * 1024 * 1024) { toast.error('File is larger than 10MB'); return }
    setRejection(null)
    uploadMut.mutate({ file })
  }

  const onDrop = (e) => {
    e.preventDefault(); setDragOver(false)
    handleFile(e.dataTransfer.files?.[0])
  }

  return (
    <div className="p-4 md:p-6 space-y-5 animate-fade-in">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h1 className="section-title">Upload Salary Template</h1>
          <p className="section-subtitle mt-1">
            Download the pre-populated template for the cycle below, fill the
            Days Given column, and upload. The template carries a snapshot hash
            so the system can detect master changes and reject stale uploads.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <CompanyFilter />
          <DateSelector {...dateProps} />
        </div>
      </div>

      {selectedCompany && (
        <div className={clsx('card', stale ? 'border-amber-200' : 'border-slate-200')}>
          <div className="card-body py-3 text-sm">
            <span className="font-medium text-slate-700">Sales master last updated:</span>{' '}
            <span className={stale ? 'text-amber-800' : 'text-slate-700'}>
              {lastUpdate ? `${formatRelative(lastUpdate)} (${lastUpdate.toLocaleString()})` : '—'}
            </span>
            {stale && (
              <div className="text-xs text-amber-700 mt-1">
                Verify the master is up to date before downloading. Add joiners and mark exits in <span className="font-mono">Sales → Master</span>.
              </div>
            )}
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-body space-y-4">
          <button
            onClick={handleDownload}
            disabled={!cycleReady}
            className={clsx('btn-primary', !cycleReady && 'opacity-60 cursor-not-allowed')}
          >
            Download Template
            {cycleReady && (
              <span className="ml-2 text-xs opacity-90">
                ({MONTHS[selectedMonth]} {selectedYear} — {selectedCompany})
              </span>
            )}
          </button>

          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            onClick={() => !uploadMut.isPending && fileInputRef.current?.click()}
            className={clsx(
              'border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors',
              dragOver ? 'border-blue-400 bg-blue-50' : 'border-slate-200 hover:border-blue-300 hover:bg-slate-50',
              uploadMut.isPending && 'opacity-60 cursor-wait'
            )}
          >
            <input ref={fileInputRef} type="file" accept=".xls,.xlsx" className="hidden"
              onChange={e => handleFile(e.target.files?.[0])} />
            <div className="text-4xl mb-3">📄</div>
            {uploadMut.isPending ? (
              <p className="text-slate-600 font-medium">Validating and saving template…</p>
            ) : (
              <>
                <p className="text-slate-600 font-medium">Drop the filled template here, or click to browse</p>
                <p className="text-slate-400 text-sm mt-1">XLSX produced by the Download button above</p>
              </>
            )}
          </div>
        </div>
      </div>

      <RejectionCard rejection={rejection} />
    </div>
  )
}

// ══════════ Upload view ══════════
function UploadView({ onUploaded }) {
  const { selectedCompany, selectedMonth, selectedYear } = useAppStore()
  // Phase 4 fix D: explicit cycle picker. Mirrors the Salary Register
  // pattern — useDateSelector with syncToStore writes back to useAppStore
  // so HR's cycle context is shared across sales pages. Picker values
  // are sent in the multipart form data and the backend now uses them
  // as primary, falling back to parser auto-detection only if absent.
  const { dateProps } = useDateSelector({ mode: 'month', syncToStore: true })
  const fileInputRef = useRef(null)
  const [dragOver, setDragOver] = useState(false)
  const [collision, setCollision] = useState(null)

  const uploadMut = useMutation({
    mutationFn: (fd) => salesUploadFile(fd),
    onSuccess: (res) => {
      toast.success('Sheet parsed and auto-matched')
      onUploaded(res.data.data)
    },
    onError: (err) => {
      const status = err?.response?.status
      const body = err?.response?.data
      if (status === 409 && body?.data?.existingUploadId) {
        setCollision(body)
      } else {
        toast.error(body?.error || 'Upload failed')
      }
    },
  })

  const handleFile = (file) => {
    if (!file) return
    if (!selectedCompany) { toast.error('Select a company first'); return }
    if (file.size > 10 * 1024 * 1024) { toast.error('File is larger than 10MB'); return }
    const fd = new FormData()
    fd.append('file', file)
    fd.append('company', selectedCompany)
    if (selectedMonth) fd.append('month', String(selectedMonth))
    if (selectedYear) fd.append('year', String(selectedYear))
    setCollision(null)
    uploadMut.mutate(fd)
  }

  const onDrop = (e) => {
    e.preventDefault(); setDragOver(false)
    const f = e.dataTransfer.files?.[0]
    handleFile(f)
  }

  return (
    <div className="p-4 md:p-6 space-y-5 animate-fade-in">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h1 className="section-title">Upload Coordinator Sheet</h1>
          <p className="section-subtitle mt-1">
            Upload the monthly Excel from the sales coordinator. The picker values below
            (<span className="font-medium">{selectedCompany || '—'}</span>,
            {' '}{MONTHS[selectedMonth] || '—'} {selectedYear || ''}) define the cycle the
            sheet attaches to; if you leave them blank, the backend falls back to whatever
            month/year/company the parser detects from the file.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <CompanyFilter />
          <DateSelector {...dateProps} />
        </div>
      </div>

      <div className="card">
        <div className="card-body">
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            onClick={() => !uploadMut.isPending && fileInputRef.current?.click()}
            className={clsx(
              'border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors',
              dragOver ? 'border-blue-400 bg-blue-50' : 'border-slate-200 hover:border-blue-300 hover:bg-slate-50',
              uploadMut.isPending && 'opacity-60 cursor-wait'
            )}
          >
            <input ref={fileInputRef} type="file" accept=".xls,.xlsx" className="hidden"
              onChange={e => handleFile(e.target.files?.[0])} />
            <div className="text-4xl mb-3">📄</div>
            {uploadMut.isPending ? (
              <p className="text-slate-600 font-medium">Parsing sheet and running auto-match…</p>
            ) : (
              <>
                <p className="text-slate-600 font-medium">Drop XLS/XLSX here, or click to browse</p>
                <p className="text-slate-400 text-sm mt-1">Max 10MB · one file per upload</p>
              </>
            )}
          </div>
        </div>
      </div>

      {collision && (
        <div className="card border-amber-200">
          <div className="card-body">
            <div className="text-sm text-amber-900">
              <div className="font-semibold">Duplicate file</div>
              <div className="text-xs mt-1">{collision.error}</div>
              <button
                onClick={() => onUploaded({ uploadId: collision.data.existingUploadId })}
                className="mt-3 btn-primary btn-sm">
                Open existing upload #{collision.data.existingUploadId}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ══════════ Excess Days table (Phase 4 fix E) ══════════
const ROW_BG = {
  pending: 'bg-amber-50',
  accept:  'bg-green-50',
  edit:    'bg-blue-50',
  reject:  'bg-red-50',
}
function ExcessTable({ rows, workingDays, state, isLocked, setState }) {
  const setRow = (id, patch) => setState(s => ({ ...s, [id]: { ...(s[id] || { action: 'pending' }), ...patch } }))
  return (
    <div className="card overflow-hidden">
      <div className="card-header">
        <span className="font-semibold text-slate-700">Excess days — review</span>
        <span className="badge-yellow text-[10px]">{rows.length}</span>
      </div>
      <div className="overflow-x-auto">
      <table className="min-w-[900px] w-full text-sm">
        <thead className="bg-slate-50 text-[11px] font-bold text-slate-400 uppercase tracking-wider">
          <tr>
            <th className="px-3 py-2 text-left">Sheet Name</th>
            <th className="px-3 py-2 text-left">Code</th>
            <th className="px-3 py-2 text-left">Days Given</th>
            <th className="px-3 py-2 text-left">Working</th>
            <th className="px-3 py-2 text-left">Excess</th>
            <th className="px-3 py-2 text-left">Action</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => {
            const s = state[r.id] || { action: 'pending' }
            return (
              <tr key={r.id} className={clsx('border-t border-slate-100', ROW_BG[s.action])}>
                <td className="px-3 py-2 font-medium text-slate-800">{r.sheet_employee_name || '—'}</td>
                <td className="px-3 py-2 font-mono text-xs text-slate-500">{r.employee_code || <span className="text-red-600">unmatched</span>}</td>
                <td className="px-3 py-2 font-mono">{r.sheet_days_given}</td>
                <td className="px-3 py-2 font-mono text-slate-500">{workingDays}</td>
                <td className="px-3 py-2 font-mono text-orange-700 font-bold">+{r.excess_days_value}</td>
                <td className="px-3 py-2 space-x-1 whitespace-nowrap">
                  {isLocked ? <span className="text-xs text-slate-400">locked</span> : (<>
                    <button onClick={() => setRow(r.id, { action: 'accept' })}
                      className={clsx('px-2 py-0.5 text-xs rounded', s.action === 'accept' ? 'bg-green-600 text-white' : 'bg-green-100 text-green-800 hover:bg-green-200')}>
                      Accept as-is
                    </button>
                    <input type="number" min="0" step="0.5" value={s.edited ?? ''}
                      placeholder={String(workingDays)}
                      onChange={e => setRow(r.id, { edited: e.target.value })}
                      onFocus={() => setRow(r.id, { action: 'edit' })}
                      className="w-16 border rounded px-1 text-xs py-0.5" />
                    <button
                      disabled={!Number.isFinite(Number(s.edited)) || Number(s.edited) <= 0 || Number(s.edited) > workingDays}
                      onClick={() => setRow(r.id, { action: 'edit' })}
                      className={clsx('px-2 py-0.5 text-xs rounded',
                        s.action === 'edit' ? 'bg-blue-600 text-white' : 'bg-blue-100 text-blue-800 hover:bg-blue-200',
                        'disabled:opacity-40 disabled:cursor-not-allowed')}>
                      Save edit
                    </button>
                    <button onClick={() => setRow(r.id, { action: 'reject' })}
                      className={clsx('px-2 py-0.5 text-xs rounded', s.action === 'reject' ? 'bg-red-600 text-white' : 'bg-red-100 text-red-800 hover:bg-red-200')}>
                      Reject
                    </button>
                  </>)}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      </div>
    </div>
  )
}

// ══════════ Preview view ══════════
function PreviewView({ uploadId, onBack }) {
  const qc = useQueryClient()
  const [tab, setTab] = useState('matched')
  // Phase 4 fix E: per-row excess action state. Map { rowId → { action, edited } }.
  // action ∈ 'pending' | 'accept' | 'edit' | 'reject'. New uploads start all
  // excess rows as 'pending' — Confirm is blocked until none are pending.
  const [excessActions, setExcessActions] = useState({})

  const { data: res, isLoading } = useQuery({
    queryKey: ['sales-upload-preview', uploadId],
    queryFn: () => salesUploadPreview(uploadId),
    refetchOnWindowFocus: false,
  })
  const data = res?.data?.data
  const matched = data?.matched || []
  const low = data?.low || []
  const unmatched = data?.unmatched || []
  const excess = data?.excess || []
  const summary = data?.summary || {}
  const workingDays = summary.working_days_for_cycle ?? null
  const upload = data?.upload

  const matchMut = useMutation({
    mutationFn: ({ rowId, employee_code, company }) =>
      salesUploadMatch(uploadId, rowId, { employee_code, company }),
    onSuccess: () => {
      toast.success('Row linked')
      qc.invalidateQueries({ queryKey: ['sales-upload-preview', uploadId] })
    },
    onError: (err) => toast.error(err?.response?.data?.error || 'Match failed'),
  })

  const confirmMut = useMutation({
    mutationFn: () => {
      const excess_days_actions = excess
        .map(r => {
          const s = excessActions[r.id]
          if (!s || s.action === 'pending') return null
          return {
            rowId: r.id,
            action: s.action,
            edited_days_given: s.action === 'edit' ? Number(s.edited) : undefined,
          }
        })
        .filter(Boolean)
      return salesUploadConfirm(uploadId, { excess_days_actions })
    },
    onSuccess: (r) => {
      const sum = r?.data?.excess_days_summary
      toast.success(sum
        ? `Confirmed — excess: ${sum.accepted} accepted, ${sum.edited} edited, ${sum.rejected} rejected`
        : 'Matches confirmed — ready for Phase 3 compute')
      qc.invalidateQueries({ queryKey: ['sales-upload-preview', uploadId] })
    },
    onError: (err) => toast.error(err?.response?.data?.error || 'Confirm failed'),
  })

  // Excess rows must all have a non-pending action before Confirm enables.
  const excessAllResolved = excess.every(r => {
    const s = excessActions[r.id]
    return s && s.action !== 'pending'
  })
  const canConfirm = low.length === 0 && unmatched.length === 0
    && excessAllResolved && upload?.status === 'uploaded'
  const isLocked = upload?.status !== 'uploaded'

  const rowsForTab = tab === 'matched' ? matched
    : tab === 'low' ? low
    : tab === 'unmatched' ? unmatched
    : excess

  if (isLoading) {
    return (
      <div className="p-4 md:p-6 animate-fade-in">
        <div className="card p-6 text-sm text-slate-400">Loading upload #{uploadId}…</div>
      </div>
    )
  }
  if (!data) {
    return (
      <div className="p-4 md:p-6 animate-fade-in">
        <div className="card p-6 text-sm text-red-600">Could not load upload #{uploadId}.</div>
      </div>
    )
  }

  return (
    <div className="p-4 md:p-6 space-y-5 animate-fade-in">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h1 className="section-title">Upload #{upload.id} — Preview</h1>
          <p className="section-subtitle mt-1">
            {upload.filename} · {MONTHS[upload.month]} {upload.year} · {upload.company} · {upload.total_rows} rows
          </p>
          <div className="flex flex-wrap items-center gap-2 mt-2 text-xs">
            <span>Status:</span>
            <span className={clsx(upload.status === 'matched' ? 'badge-green' : 'badge-blue', 'text-[10px]')}>
              {upload.status}
            </span>
            {isLocked && <span className="text-amber-700">(locked — matches already confirmed)</span>}
            {workingDays != null && (
              <span className="text-slate-500">· Working days: {workingDays}</span>
            )}
            {excess.length > 0 && (
              <span className={clsx(excessAllResolved ? 'badge-green' : 'badge-yellow', 'text-[10px]')}>
                {excess.length} row{excess.length === 1 ? '' : 's'} with excess days
                {excessAllResolved ? ' · all resolved' : ' · needs review'}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={onBack} className="btn-secondary btn-sm">
            ← Upload another
          </button>
          <button
            onClick={() => confirmMut.mutate()}
            disabled={!canConfirm || confirmMut.isPending}
            className="btn-primary btn-sm">
            {confirmMut.isPending ? 'Confirming…' : 'Confirm Matches'}
          </button>
        </div>
      </div>

      <div className="flex gap-1 border-b border-slate-200">
        {[
          { k: 'matched',   label: 'Matched',   count: matched.length,   colour: 'text-green-700' },
          { k: 'low',       label: 'Low',       count: low.length,       colour: 'text-amber-700' },
          { k: 'unmatched', label: 'Unmatched', count: unmatched.length, colour: 'text-red-700' },
          { k: 'excess',    label: 'Excess Days', count: excess.length,  colour: 'text-orange-700' },
        ].map(t => (
          <button key={t.k} onClick={() => setTab(t.k)}
            className={clsx(
              'px-4 py-2 text-sm font-medium border-b-2 transition',
              tab === t.k ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-600 hover:text-slate-800'
            )}>
            {t.label} <span className={clsx('ml-1 text-xs', t.colour)}>({t.count})</span>
          </button>
        ))}
      </div>

      {rowsForTab.length === 0 ? (
        <div className="card p-8 text-center">
          <div className="text-3xl mb-2">📭</div>
          <h3 className="font-semibold text-slate-700 mb-1">No rows in this tab</h3>
          <p className="text-sm text-slate-500">Switch tabs above to view matched, low-confidence, unmatched, or excess rows.</p>
        </div>
      ) : tab === 'excess' ? (
        <ExcessTable
          rows={excess}
          workingDays={workingDays}
          state={excessActions}
          isLocked={isLocked}
          setState={setExcessActions}
        />
      ) : (
        <div className="card overflow-hidden">
          <div className="card-header">
            <span className="font-semibold text-slate-700">
              {tab === 'matched' ? 'Matched' : tab === 'low' ? 'Low confidence' : 'Unmatched'} rows
            </span>
            <span className="badge-gray text-[10px]">{rowsForTab.length}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] table-compact text-sm">
              <thead>
                <tr>
                  <th>Sheet #</th>
                  <th>Sheet Name</th>
                  <th>City</th>
                  <th>Manager</th>
                  <th>Days</th>
                  <th>Confidence</th>
                  <th>Resolved</th>
                </tr>
              </thead>
              <tbody>
                {rowsForTab.map(r => (
                  <tr key={r.id}>
                    <td className="text-xs text-slate-500">{r.sheet_row_number}</td>
                    <td className="font-medium text-slate-800">{r.sheet_employee_name}</td>
                    <td className="text-slate-600">{r.sheet_city || '—'}</td>
                    <td className="text-slate-600">{r.sheet_reporting_manager || '—'}</td>
                    <td className="font-mono text-sm">{r.sheet_days_given}</td>
                    <td>
                      <ConfidenceBadge v={r.match_confidence} />
                      <div className="text-[10px] text-slate-400 mt-0.5">{r.match_method}</div>
                    </td>
                    <td>
                      {r.resolved_employee ? (
                        <div>
                          <span className="font-mono text-xs text-slate-500">{r.resolved_employee.code}</span>
                          <span className="ml-2 text-slate-800">{r.resolved_employee.name}</span>
                        </div>
                      ) : (
                        isLocked ? <span className="text-xs text-slate-400">—</span> : (
                          <EmployeePicker
                            company={upload.company}
                            initialQuery={r.sheet_employee_name || ''}
                            onPick={(emp) => matchMut.mutate({ rowId: r.id, employee_code: emp.code, company: upload.company })}
                            disabled={matchMut.isPending}
                          />
                        )
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

// ══════════ Top-level page ══════════
function LegacyTab() {
  const [currentUploadId, setCurrentUploadId] = useState(null)
  if (currentUploadId) {
    return <PreviewView uploadId={currentUploadId} onBack={() => setCurrentUploadId(null)} />
  }
  return <UploadView onUploaded={(data) => setCurrentUploadId(data.uploadId)} />
}

export default function SalesUpload() {
  const [tab, setTab] = useState('template')
  return (
    <div>
      <div className="px-4 md:px-6 pt-4 md:pt-6">
        <div className="flex gap-1 border-b border-slate-200">
          <button
            type="button"
            onClick={() => setTab('template')}
            className={clsx(
              'px-4 py-2 text-sm font-medium border-b-2 -mb-px',
              tab === 'template' ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-700'
            )}
          >
            Template <span className="text-xs opacity-70">(recommended)</span>
          </button>
          <button
            type="button"
            onClick={() => setTab('legacy')}
            className={clsx(
              'px-4 py-2 text-sm font-medium border-b-2 -mb-px',
              tab === 'legacy' ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-700'
            )}
          >
            Coordinator Sheet <span className="text-xs opacity-70">(legacy)</span>
          </button>
        </div>
      </div>
      {tab === 'template' ? <TemplateUploadView /> : <LegacyTab />}
    </div>
  )
}
