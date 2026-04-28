import React, { useState, useRef, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import clsx from 'clsx'
import {
  salesUploadFile,
  salesUploadPreview,
  salesUploadMatch,
  salesUploadConfirm,
  getSalesEmployees,
} from '../../utils/api'
import { useAppStore } from '../../store/appStore'
import CompanyFilter from '../../components/shared/CompanyFilter'
import DateSelector from '../../components/common/DateSelector'
import useDateSelector from '../../hooks/useDateSelector'

const MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const CONFIDENCE_COLOURS = {
  exact:     'bg-green-100 text-green-800',
  high:      'bg-green-100 text-green-700',
  medium:    'bg-blue-100 text-blue-700',
  low:       'bg-amber-100 text-amber-800',
  unmatched: 'bg-red-100 text-red-700',
  manual:    'bg-purple-100 text-purple-700',
}

function ConfidenceBadge({ v }) {
  return (
    <span className={clsx('text-xs px-2 py-0.5 rounded font-medium', CONFIDENCE_COLOURS[v] || 'bg-slate-100 text-slate-600')}>
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
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Upload Coordinator Sheet</h1>
          <p className="text-xs text-slate-500">
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

      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => !uploadMut.isPending && fileInputRef.current?.click()}
        className={clsx(
          'border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition',
          dragOver ? 'border-blue-500 bg-blue-50' : 'border-slate-300 bg-white hover:border-blue-400',
          uploadMut.isPending && 'opacity-60 cursor-wait'
        )}
      >
        <input ref={fileInputRef} type="file" accept=".xls,.xlsx" className="hidden"
          onChange={e => handleFile(e.target.files?.[0])} />
        <div className="text-4xl mb-2">📄</div>
        {uploadMut.isPending ? (
          <p className="text-sm text-slate-600">Parsing sheet and running auto-match…</p>
        ) : (
          <>
            <p className="text-sm font-medium text-slate-700">Drop XLS/XLSX here, or click to browse</p>
            <p className="text-xs text-slate-500 mt-1">Max 10MB · one file per upload</p>
          </>
        )}
      </div>

      {collision && (
        <div className="bg-amber-50 border border-amber-300 rounded-lg p-3 text-sm text-amber-900">
          <div className="font-medium">Duplicate file</div>
          <div className="text-xs mt-1">{collision.error}</div>
          <button
            onClick={() => onUploaded({ uploadId: collision.data.existingUploadId })}
            className="mt-2 px-3 py-1 text-xs bg-amber-600 hover:bg-amber-700 text-white rounded">
            Open existing upload #{collision.data.existingUploadId}
          </button>
        </div>
      )}
    </div>
  )
}

// ══════════ Preview view ══════════
function PreviewView({ uploadId, onBack }) {
  const qc = useQueryClient()
  const [tab, setTab] = useState('matched')

  const { data: res, isLoading } = useQuery({
    queryKey: ['sales-upload-preview', uploadId],
    queryFn: () => salesUploadPreview(uploadId),
    refetchOnWindowFocus: false,
  })
  const data = res?.data?.data
  const matched = data?.matched || []
  const low = data?.low || []
  const unmatched = data?.unmatched || []
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
    mutationFn: () => salesUploadConfirm(uploadId),
    onSuccess: () => {
      toast.success('Matches confirmed — ready for Phase 3 compute')
      qc.invalidateQueries({ queryKey: ['sales-upload-preview', uploadId] })
    },
    onError: (err) => toast.error(err?.response?.data?.error || 'Confirm failed'),
  })

  const canConfirm = low.length === 0 && unmatched.length === 0 && upload?.status === 'uploaded'
  const isLocked = upload?.status !== 'uploaded'

  const rowsForTab = tab === 'matched' ? matched : tab === 'low' ? low : unmatched

  if (isLoading) {
    return <div className="p-4 md:p-6 text-sm text-slate-400">Loading upload #{uploadId}…</div>
  }
  if (!data) {
    return <div className="p-4 md:p-6 text-sm text-red-600">Could not load upload #{uploadId}.</div>
  }

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Upload #{upload.id} — Preview</h1>
          <p className="text-xs text-slate-500">
            {upload.filename} · {MONTHS[upload.month]} {upload.year} · {upload.company} · {upload.total_rows} rows
          </p>
          <p className="text-xs mt-1">
            Status: <span className={clsx('inline-block px-2 py-0.5 rounded font-medium',
              upload.status === 'matched' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700')}>
              {upload.status}
            </span>
            {isLocked && <span className="ml-2 text-amber-700">(locked — matches already confirmed)</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={onBack}
            className="px-3 py-1.5 text-sm rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700">
            ← Upload another
          </button>
          <button
            onClick={() => confirmMut.mutate()}
            disabled={!canConfirm || confirmMut.isPending}
            className={clsx('px-4 py-1.5 text-sm rounded-lg font-medium',
              canConfirm ? 'bg-blue-600 hover:bg-blue-700 text-white' : 'bg-slate-200 text-slate-400 cursor-not-allowed')}>
            {confirmMut.isPending ? 'Confirming…' : 'Confirm Matches'}
          </button>
        </div>
      </div>

      <div className="flex gap-1 border-b border-slate-200">
        {[
          { k: 'matched',   label: 'Matched',   count: matched.length,   colour: 'text-green-700' },
          { k: 'low',       label: 'Low',       count: low.length,       colour: 'text-amber-700' },
          { k: 'unmatched', label: 'Unmatched', count: unmatched.length, colour: 'text-red-700' },
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
        <div className="bg-white rounded-lg border border-slate-200 p-8 text-center text-sm text-slate-400">
          No rows in this tab.
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-slate-200 overflow-x-auto">
          <table className="min-w-[900px] w-full text-sm">
            <thead className="bg-slate-50 text-slate-600 text-xs uppercase">
              <tr>
                <th className="px-3 py-2 text-left">Sheet #</th>
                <th className="px-3 py-2 text-left">Sheet Name</th>
                <th className="px-3 py-2 text-left">City</th>
                <th className="px-3 py-2 text-left">Manager</th>
                <th className="px-3 py-2 text-left">Days</th>
                <th className="px-3 py-2 text-left">Confidence</th>
                <th className="px-3 py-2 text-left">Resolved</th>
              </tr>
            </thead>
            <tbody>
              {rowsForTab.map(r => (
                <tr key={r.id} className="border-t border-slate-100">
                  <td className="px-3 py-2 text-xs text-slate-500">{r.sheet_row_number}</td>
                  <td className="px-3 py-2 font-medium text-slate-800">{r.sheet_employee_name}</td>
                  <td className="px-3 py-2 text-slate-600">{r.sheet_city || '—'}</td>
                  <td className="px-3 py-2 text-slate-600">{r.sheet_reporting_manager || '—'}</td>
                  <td className="px-3 py-2 font-mono text-sm">{r.sheet_days_given}</td>
                  <td className="px-3 py-2">
                    <ConfidenceBadge v={r.match_confidence} />
                    <div className="text-[10px] text-slate-400 mt-0.5">{r.match_method}</div>
                  </td>
                  <td className="px-3 py-2">
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
      )}
    </div>
  )
}

// ══════════ Top-level page ══════════
export default function SalesUpload() {
  const [currentUploadId, setCurrentUploadId] = useState(null)

  if (currentUploadId) {
    return <PreviewView uploadId={currentUploadId} onBack={() => setCurrentUploadId(null)} />
  }
  return <UploadView onUploaded={(data) => setCurrentUploadId(data.uploadId)} />
}
