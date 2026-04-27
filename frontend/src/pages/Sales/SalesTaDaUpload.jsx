import React, { useState, useMemo, useRef } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import * as XLSX from 'xlsx'
import clsx from 'clsx'
import { salesTaDaUpload } from '../../utils/api'
import { useAppStore } from '../../store/appStore'
import { cycleSubtitle } from '../../utils/cycleUtil'
import CompanyFilter from '../../components/shared/CompanyFilter'

const MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// Class metadata. Headers are case-insensitive at parse time but emitted
// lower_snake_case in the template so HR can copy/paste from the existing
// backend parser convention.
const CLASS_META = {
  2: {
    name: 'Tiered DA, No TA',
    description: 'Class 2 reps: in-city + outstation day counts. No km tracking.',
    headers: ['employee_code', 'name', 'in_city_days', 'outstation_days'],
  },
  3: {
    name: 'Per-km TA',
    description: 'Class 3 reps: total km driven for the cycle.',
    headers: ['employee_code', 'name', 'total_km'],
  },
  4: {
    name: 'Tiered DA + Per-km TA',
    description: 'Class 4 reps: in-city + outstation days plus total km.',
    headers: ['employee_code', 'name', 'in_city_days', 'outstation_days', 'total_km'],
  },
  5: {
    name: 'Tiered DA + Dual-Vehicle TA',
    description: 'Class 5 reps: in-city + outstation days plus per-vehicle km (bike + car).',
    headers: ['employee_code', 'name', 'in_city_days', 'outstation_days', 'bike_km', 'car_km'],
  },
}
const CLASS_NUMS = [2, 3, 4, 5]

function MonthYearPicker({ month, year, onChange }) {
  const now = new Date()
  const thisYear = now.getFullYear()
  const years = [thisYear - 1, thisYear, thisYear + 1]
  return (
    <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1">
      <select
        value={month}
        onChange={e => onChange(parseInt(e.target.value, 10), year)}
        className="font-medium text-slate-700 bg-transparent border-none focus:outline-none cursor-pointer text-sm"
      >
        {MONTHS.slice(1).map((m, i) => (
          <option key={i + 1} value={i + 1}>{m}</option>
        ))}
      </select>
      <select
        value={year}
        onChange={e => onChange(month, parseInt(e.target.value, 10))}
        className="font-medium text-slate-700 bg-transparent border-none focus:outline-none cursor-pointer text-sm"
      >
        {years.map(y => <option key={y} value={y}>{y}</option>)}
      </select>
    </div>
  )
}

// ── Template builder (client-side .xlsx generation) ─────────────────────
function downloadTemplate(classNum, month, year) {
  const meta = CLASS_META[classNum]
  if (!meta) return
  const ws = XLSX.utils.aoa_to_sheet([meta.headers])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, `Class${classNum}`)
  const monthLabel = MONTHS[month] || ''
  const filename = `TADA_Class${classNum}_Template_${monthLabel}_${year}.xlsx`
  XLSX.writeFile(wb, filename)
}

// ── Client-side parser (preview-only) ───────────────────────────────────
// Reads the first sheet, locates the header row by scanning the first 5
// rows for one containing "employee_code" (case-insensitive), and maps
// data rows to objects keyed by lower_snake_case header. Server-side parse
// is the source of truth; this is purely UI-side preview.
async function parseFileForPreview(file) {
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type: 'array' })
  const sheetName = wb.SheetNames[0]
  if (!sheetName) {
    return { headers: [], rows: [], headerRowIndex: -1, error: 'No sheets found in file' }
  }
  const ws = wb.Sheets[sheetName]
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: '' })

  // Find header row (search first 5 rows).
  let headerRowIndex = -1
  for (let i = 0; i < Math.min(5, aoa.length); i++) {
    const cells = (aoa[i] || []).map(c => String(c || '').trim().toLowerCase())
    if (cells.some(c => c === 'employee_code')) {
      headerRowIndex = i
      break
    }
  }
  if (headerRowIndex < 0) {
    return {
      headers: [], rows: [], headerRowIndex: -1,
      error: 'Could not find a header row containing "employee_code" in the first 5 rows.',
    }
  }

  const rawHeaders = (aoa[headerRowIndex] || []).map(c => String(c || '').trim().toLowerCase())
  const dataRows = aoa.slice(headerRowIndex + 1)
  const rows = []
  for (const r of dataRows) {
    const obj = {}
    let allEmpty = true
    for (let i = 0; i < rawHeaders.length; i++) {
      const key = rawHeaders[i]
      const val = r[i]
      if (val !== '' && val !== undefined && val !== null) allEmpty = false
      obj[key] = val
    }
    if (!allEmpty) rows.push(obj)
  }
  return { headers: rawHeaders, rows, headerRowIndex, error: null }
}

// ── UploadResult (inline result block under the dropzone) ───────────────
function UploadResult({ result }) {
  if (!result) return null

  // 400 parser-error shape: { success: false, parsed, valid, invalid, errors:[] }
  if (result.kind === 'parser_error') {
    const { parsed, valid, invalid, errors } = result.payload
    return (
      <div className="space-y-2 bg-red-50 border border-red-200 rounded p-3">
        <div className="text-sm font-medium text-red-800">
          Parser found {invalid} error(s) in {parsed} row(s) ({valid} valid).
        </div>
        <p className="text-xs text-red-700">
          Fix these in the spreadsheet and re-upload. Nothing has been committed.
        </p>
        <div className="max-h-60 overflow-y-auto bg-white border border-red-200 rounded">
          <table className="w-full text-xs">
            <thead className="bg-red-100 text-red-800 sticky top-0">
              <tr>
                <th className="px-2 py-1 text-left">Row</th>
                <th className="px-2 py-1 text-left">Employee</th>
                <th className="px-2 py-1 text-left">Error</th>
              </tr>
            </thead>
            <tbody>
              {errors.map((e, i) => (
                <tr key={i} className="border-t border-red-100">
                  <td className="px-2 py-1 font-mono text-slate-600">{e.row ?? '—'}</td>
                  <td className="px-2 py-1 font-mono text-slate-700">{e.employee_code || '—'}</td>
                  <td className="px-2 py-1 text-red-700">{e.error}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  // 200 partial shape: { success: false, partial: true, succeeded:[], failed:[], note }
  if (result.kind === 'partial') {
    const { succeeded, failed, note } = result.payload
    return (
      <div className="space-y-2 bg-amber-50 border border-amber-200 rounded p-3">
        <div className="text-sm font-medium text-amber-800">
          Partial: {succeeded.length} succeeded, {failed.length} failed.
        </div>
        {note && <p className="text-xs text-amber-700">{note}</p>}
        <div className="max-h-60 overflow-y-auto bg-white border border-amber-200 rounded">
          <table className="w-full text-xs">
            <thead className="bg-amber-100 text-amber-800 sticky top-0">
              <tr>
                <th className="px-2 py-1 text-left">Employee</th>
                <th className="px-2 py-1 text-left">Error</th>
              </tr>
            </thead>
            <tbody>
              {failed.map((f, i) => (
                <tr key={i} className="border-t border-amber-100">
                  <td className="px-2 py-1 font-mono text-slate-700">{f.employee_code}</td>
                  <td className="px-2 py-1 text-amber-800">{f.error}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {succeeded.length > 0 && (
          <details className="text-xs">
            <summary className="cursor-pointer text-amber-700 hover:text-amber-900">
              Succeeded ({succeeded.length})
            </summary>
            <div className="mt-1 font-mono text-slate-600 break-words">
              {succeeded.join(', ')}
            </div>
          </details>
        )}
      </div>
    )
  }

  // 200 success shape: { success: true, data: { parsed, valid, invalid, updated, errors } }
  if (result.kind === 'success') {
    const { parsed, valid, updated } = result.payload
    return (
      <div className="bg-green-50 border border-green-200 rounded p-3">
        <div className="text-sm font-medium text-green-800">
          Uploaded {updated} row(s) ({valid} valid out of {parsed}). All committed.
        </div>
      </div>
    )
  }

  // 500 / network / unknown
  if (result.kind === 'error') {
    return (
      <div className="bg-red-50 border border-red-200 rounded p-3">
        <div className="text-sm font-medium text-red-800">Upload failed: {result.message}</div>
      </div>
    )
  }

  return null
}

// ── Single-tab body ──────────────────────────────────────────────────────
function ClassTabBody({ classNum, month, year, company, ready }) {
  const qc = useQueryClient()
  const meta = CLASS_META[classNum]
  const fileInputRef = useRef(null)

  const [file, setFile] = useState(null)
  const [parsePreview, setParsePreview] = useState(null) // { headers, rows, error }
  const [parseBusy, setParseBusy] = useState(false)
  const [uploadResult, setUploadResult] = useState(null)
  const [isDragging, setIsDragging] = useState(false)

  const resetAll = () => {
    setFile(null)
    setParsePreview(null)
    setUploadResult(null)
    setIsDragging(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleFileChosen = async (chosen) => {
    if (!chosen) return
    if (!/\.xlsx$/i.test(chosen.name)) {
      toast.error('Only .xlsx files are accepted')
      return
    }
    setFile(chosen)
    setUploadResult(null)
    setParseBusy(true)
    try {
      const preview = await parseFileForPreview(chosen)
      setParsePreview(preview)
      if (preview.error) toast.error(preview.error)
    } catch (e) {
      toast.error('Failed to read file: ' + (e?.message || 'unknown'))
      setParsePreview({ headers: [], rows: [], error: e?.message || 'parse failed' })
    } finally {
      setParseBusy(false)
    }
  }

  const onDragOver = (e) => { e.preventDefault(); setIsDragging(true) }
  const onDragLeave = (e) => { e.preventDefault(); setIsDragging(false) }
  const onDrop = async (e) => {
    e.preventDefault()
    setIsDragging(false)
    const f = e.dataTransfer?.files?.[0]
    if (f) await handleFileChosen(f)
  }

  const uploadMut = useMutation({
    mutationFn: () => salesTaDaUpload(classNum, file, { month, year, company }),
    onSuccess: (r) => {
      const body = r?.data || {}
      if (body.success === true) {
        const data = body.data || {}
        toast.success(`Uploaded ${data.updated ?? data.valid ?? 0} row(s)`)
        setUploadResult({ kind: 'success', payload: data })
        qc.invalidateQueries({ queryKey: ['sales-ta-da-register'] })
        // Clear file but keep success message visible until tab switch / new file.
        setFile(null)
        setParsePreview(null)
        if (fileInputRef.current) fileInputRef.current.value = ''
      } else if (body.partial) {
        toast(`Partial: ${(body.succeeded || []).length} ok, ${(body.failed || []).length} failed`, { icon: '⚠' })
        setUploadResult({ kind: 'partial', payload: body })
        qc.invalidateQueries({ queryKey: ['sales-ta-da-register'] })
      } else {
        // success:false without partial flag — surface as generic error.
        const msg = body.error || 'Upload returned an unexpected response'
        toast.error(msg)
        setUploadResult({ kind: 'error', message: msg })
      }
    },
    onError: (err) => {
      const status = err?.response?.status
      const body = err?.response?.data
      if (status === 400 && body && Array.isArray(body.errors)) {
        toast.error(`${body.invalid} parser error(s) — see below`)
        setUploadResult({ kind: 'parser_error', payload: body })
      } else {
        const msg = body?.error || err?.message || 'Upload failed'
        toast.error(msg)
        setUploadResult({ kind: 'error', message: msg })
      }
    },
  })

  const previewRows = parsePreview?.rows || []
  const visibleRows = useMemo(() => previewRows.slice(0, 20), [previewRows])
  const previewHasError = !!parsePreview?.error

  const canCommit = !!file && !!ready && !uploadMut.isPending && !parseBusy && !previewHasError

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-slate-800">
          Upload Class {classNum} — {meta.name}
        </h2>
        <p className="text-sm text-slate-500 mt-0.5">{meta.description}</p>
      </div>

      {/* Template download */}
      <div className="bg-white border border-slate-200 rounded p-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div>
          <div className="text-sm font-medium text-slate-700">Empty template</div>
          <p className="text-xs text-slate-500">
            Headers (case-insensitive): <span className="font-mono">{meta.headers.join(', ')}</span>
          </p>
        </div>
        <button
          type="button"
          onClick={() => downloadTemplate(classNum, month, year)}
          disabled={!month || !year}
          className="px-3 py-1.5 text-xs rounded-lg bg-slate-100 hover:bg-slate-200 disabled:opacity-50 disabled:cursor-not-allowed text-slate-700 font-medium"
        >
          Download template (.xlsx)
        </button>
      </div>

      {/* Upload zone */}
      {!ready && (
        <div className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded p-2">
          Select a company, month, and year before uploading.
        </div>
      )}

      <div
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onClick={() => ready && fileInputRef.current?.click()}
        className={clsx(
          'border-2 border-dashed rounded-lg p-6 text-center transition-colors',
          isDragging
            ? 'border-blue-400 bg-blue-50'
            : 'border-slate-300 bg-slate-50 hover:bg-slate-100',
          !ready && 'opacity-50 cursor-not-allowed',
          ready && 'cursor-pointer'
        )}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx"
          className="hidden"
          onChange={e => handleFileChosen(e.target.files?.[0])}
        />
        {!file ? (
          <>
            <p className="text-sm text-slate-600">Drag a .xlsx file here, or click to browse.</p>
            <p className="text-xs text-slate-400 mt-1">Only .xlsx files are accepted.</p>
          </>
        ) : (
          <div className="text-sm text-slate-700">
            <span className="font-mono">{file.name}</span>{' '}
            <span className="text-slate-400">({Math.round(file.size / 1024)} KB)</span>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); resetAll() }}
              className="ml-3 text-xs text-red-600 hover:text-red-800 underline"
            >
              Remove
            </button>
          </div>
        )}
      </div>

      {/* Preview */}
      {parseBusy && (
        <p className="text-sm text-slate-500">Reading file…</p>
      )}
      {parsePreview && !parseBusy && (
        <>
          {previewHasError ? (
            <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-2">
              <strong>Parse error:</strong> {parsePreview.error}
            </div>
          ) : (
            <div>
              <div className="flex items-center justify-between mb-1">
                <p className="text-xs text-slate-500">
                  {previewRows.length} data row(s). Showing first {visibleRows.length}.
                </p>
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-0.5">
                  Preview only — server validation runs on Commit
                </p>
              </div>
              <div className="bg-white rounded border border-slate-200 overflow-x-auto max-h-64 overflow-y-auto">
                <table className="min-w-[600px] w-full text-xs">
                  <thead className="bg-slate-50 text-slate-600 uppercase sticky top-0">
                    <tr>
                      {parsePreview.headers.map(h => (
                        <th key={h} className="px-2 py-1 text-left font-mono">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRows.map((row, i) => (
                      <tr key={i} className="border-t border-slate-100">
                        {parsePreview.headers.map(h => (
                          <td key={h} className="px-2 py-1 font-mono text-slate-700">
                            {row[h] === '' || row[h] === undefined || row[h] === null
                              ? <span className="text-slate-300">—</span>
                              : String(row[h])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* Commit + Cancel buttons */}
      <div className="flex items-center justify-end gap-2">
        {file && (
          <button
            type="button"
            onClick={resetAll}
            disabled={uploadMut.isPending}
            className="px-3 py-1.5 text-sm rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 disabled:opacity-50"
          >
            Cancel
          </button>
        )}
        <button
          type="button"
          onClick={() => uploadMut.mutate()}
          disabled={!canCommit}
          className="px-4 py-1.5 text-sm rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-medium"
        >
          {uploadMut.isPending ? 'Uploading…' : 'Commit'}
        </button>
      </div>

      {/* Result block */}
      <UploadResult result={uploadResult} />
    </div>
  )
}

export default function SalesTaDaUpload() {
  const {
    selectedCompany,
    selectedMonth,
    selectedYear,
    setMonthYear,
  } = useAppStore()

  const [activeClass, setActiveClass] = useState(2)

  const ready = !!selectedCompany && !!selectedMonth && !!selectedYear

  return (
    <div className="p-4 md:p-6 space-y-4">
      {/* Top bar */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Sales TA/DA Upload</h1>
          <p className="text-xs text-slate-500">
            Bulk-enter monthly TA/DA inputs by class. Server runs Phase β recompute per row.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <CompanyFilter />
          <MonthYearPicker
            month={selectedMonth}
            year={selectedYear}
            onChange={(m, y) => setMonthYear(m, y)}
          />
          <p className="text-[11px] text-indigo-600 font-medium">
            {cycleSubtitle(selectedMonth, selectedYear)}
          </p>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-slate-200">
        {CLASS_NUMS.map(c => (
          <button
            key={c}
            onClick={() => setActiveClass(c)}
            className={clsx(
              'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
              activeClass === c
                ? 'border-blue-600 text-blue-700'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            )}
          >
            Class {c}
          </button>
        ))}
      </div>

      {/* Tab body — keyed by activeClass so file/preview/result reset on tab switch. */}
      <ClassTabBody
        key={activeClass}
        classNum={activeClass}
        month={selectedMonth}
        year={selectedYear}
        company={selectedCompany}
        ready={ready}
      />
    </div>
  )
}
