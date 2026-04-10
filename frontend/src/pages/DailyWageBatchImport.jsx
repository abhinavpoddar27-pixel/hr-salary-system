import React, { useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import { batchImportDWEntries, getDWEntryTemplate } from '../utils/api'
import { useDropzone } from 'react-dropzone'
import * as XLSX from 'xlsx'
import clsx from 'clsx'
import toast from 'react-hot-toast'

export default function DailyWageBatchImport() {
  const navigate = useNavigate()
  const [step, setStep] = useState(1) // 1=upload, 2=review, 3=done
  const [parsedRows, setParsedRows] = useState([])
  const [errors, setErrors] = useState([])
  const [fileName, setFileName] = useState('')

  // ── Template download ───────────────────────────────────────
  const downloadTemplate = async () => {
    try {
      const res = await getDWEntryTemplate()
      const tpl = res?.data?.data
      if (!tpl) return toast.error('Failed to get template')
      const ws = XLSX.utils.aoa_to_sheet([tpl.columns, tpl.example])
      // Set column widths
      ws['!cols'] = tpl.columns.map(c => ({ wch: Math.max(c.length + 2, 15) }))
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, 'Template')
      XLSX.writeFile(wb, 'daily-wage-import-template.xlsx')
      toast.success('Template downloaded')
    } catch {
      toast.error('Failed to download template')
    }
  }

  // ── File parsing ────────────────────────────────────────────
  const parseFile = useCallback((file) => {
    setFileName(file.name)
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: 'array' })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
        if (raw.length < 2) { toast.error('File is empty or has no data rows'); return }

        // Skip header row, map to entry objects
        const rows = raw.slice(1).filter(r => r.some(cell => String(cell).trim())).map((r) => {
          // Parse department allocations from "Dept1:Count,Dept2:Count" format
          const allocStr = String(r[5] || '')
          const department_allocations = allocStr.split(',').map(pair => {
            const [dept, count] = pair.split(':').map(s => s.trim())
            return { department: dept || '', worker_count: Number(count) || 0 }
          }).filter(a => a.department)

          // Format date — handle both string and Excel serial dates
          let dateVal = r[0]
          if (typeof dateVal === 'number') {
            const d = XLSX.SSF.parse_date_code(dateVal)
            dateVal = `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`
          }

          return {
            contractor_name: String(r[1] || '').trim(),
            entry_date: String(dateVal || '').trim(),
            in_time: String(r[2] || '').trim(),
            out_time: String(r[3] || '').trim(),
            total_worker_count: Number(r[4]) || 0,
            department_allocations,
            gate_entry_reference: String(r[6] || '').trim(),
            notes: String(r[7] || '').trim()
          }
        })

        if (rows.length === 0) { toast.error('No valid data rows found'); return }
        setParsedRows(rows)
        setErrors([])
        setStep(2)
      } catch (err) {
        toast.error('Failed to parse file: ' + err.message)
      }
    }
    reader.readAsArrayBuffer(file)
  }, [])

  const onDrop = useCallback((accepted) => {
    if (accepted.length > 0) parseFile(accepted[0])
  }, [parseFile])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
      'text/csv': ['.csv']
    },
    maxFiles: 1
  })

  // ── Import mutation ─────────────────────────────────────────
  const importMut = useMutation({
    mutationFn: (entries) => batchImportDWEntries(entries),
    onSuccess: (res) => {
      const count = res?.data?.imported || parsedRows.length
      toast.success(`${count} entries imported successfully`)
      setStep(3)
      setTimeout(() => navigate('/daily-wage'), 1500)
    },
    onError: (e) => {
      const data = e.response?.data
      if (data?.errors) {
        setErrors(data.errors)
        toast.error(`${data.invalid_count || data.errors.length} rows have errors`)
      } else {
        toast.error(data?.error || 'Import failed')
      }
    }
  })

  const doImport = () => importMut.mutate(parsedRows)

  // ── Row error lookup ────────────────────────────────────────
  const getRowErrors = (idx) => errors.filter(e => e.row === idx)

  // ═══════════════════════════════════════════════════════════
  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Batch Import</h1>
          <p className="text-sm text-slate-500 mt-0.5">Import multiple daily wage entries from a spreadsheet</p>
        </div>
        <button onClick={() => navigate('/daily-wage')} className="text-sm text-slate-500 hover:text-slate-700">Back to Records</button>
      </div>

      {/* Steps indicator */}
      <div className="flex items-center gap-2 text-sm">
        {['Upload File', 'Review & Import', 'Done'].map((label, i) => (
          <React.Fragment key={i}>
            {i > 0 && <div className="w-8 h-px bg-slate-300" />}
            <span className={clsx('flex items-center gap-1.5', step > i + 1 ? 'text-green-600' : step === i + 1 ? 'text-blue-600 font-semibold' : 'text-slate-400')}>
              <span className={clsx('w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold',
                step > i + 1 ? 'bg-green-100 text-green-700' : step === i + 1 ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-400')}>
                {step > i + 1 ? '✓' : i + 1}
              </span>
              {label}
            </span>
          </React.Fragment>
        ))}
      </div>

      {/* Step 1: Upload */}
      {step === 1 && (
        <div className="space-y-4">
          <div className="bg-white rounded-lg border border-slate-200 p-6">
            <h3 className="text-sm font-semibold text-slate-700 mb-3">1. Download the template</h3>
            <button onClick={downloadTemplate}
              className="px-4 py-2 text-sm font-medium rounded-lg border border-blue-300 text-blue-600 bg-blue-50 hover:bg-blue-100">
              Download Template (.xlsx)
            </button>
            <p className="text-xs text-slate-400 mt-2">Fill in the template with your daily wage data. Department allocations use "Dept:Count,Dept:Count" format.</p>
          </div>

          <div className="bg-white rounded-lg border border-slate-200 p-6">
            <h3 className="text-sm font-semibold text-slate-700 mb-3">2. Upload your file</h3>
            <div {...getRootProps()}
              className={clsx('border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors',
                isDragActive ? 'border-blue-400 bg-blue-50' : 'border-slate-300 hover:border-blue-300 hover:bg-slate-50')}>
              <input {...getInputProps()} />
              <div className="text-3xl mb-2">📂</div>
              <p className="text-sm text-slate-600">{isDragActive ? 'Drop file here...' : 'Drag & drop an .xlsx or .csv file, or click to browse'}</p>
              <p className="text-xs text-slate-400 mt-1">Maximum 500 entries per batch</p>
            </div>
          </div>
        </div>
      )}

      {/* Step 2: Review */}
      {step === 2 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="text-sm text-slate-600">
              <strong>{parsedRows.length}</strong> rows parsed from <strong>{fileName}</strong>
              {errors.length > 0 && <span className="text-red-600 ml-2">({new Set(errors.map(e => e.row)).size} rows with errors)</span>}
            </div>
            <div className="flex gap-2">
              <button onClick={() => { setStep(1); setParsedRows([]); setErrors([]) }}
                className="px-3 py-1.5 text-sm font-medium rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50">Re-upload</button>
              {errors.length === 0 && (
                <button onClick={doImport} disabled={importMut.isPending}
                  className="px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
                  {importMut.isPending ? 'Importing...' : `Import ${parsedRows.length} Entries`}
                </button>
              )}
            </div>
          </div>

          {errors.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
              Fix the errors below and re-upload. No partial imports — all rows must be valid.
            </div>
          )}

          <div className="bg-white rounded-lg border border-slate-200 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                  <th className="px-3 py-2 w-8">#</th>
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Contractor</th>
                  <th className="px-3 py-2">Time</th>
                  <th className="px-3 py-2">Workers</th>
                  <th className="px-3 py-2">Departments</th>
                  <th className="px-3 py-2">Gate Ref</th>
                  <th className="px-3 py-2 w-8"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {parsedRows.map((row, idx) => {
                  const rowErrs = getRowErrors(idx)
                  const hasErr = rowErrs.length > 0
                  return (
                    <React.Fragment key={idx}>
                      <tr className={clsx(hasErr ? 'bg-red-50/50' : 'hover:bg-slate-50')}>
                        <td className="px-3 py-2 text-slate-400">{idx + 1}</td>
                        <td className="px-3 py-2">{row.entry_date}</td>
                        <td className="px-3 py-2 font-medium">{row.contractor_name}</td>
                        <td className="px-3 py-2 text-slate-500">{row.in_time} — {row.out_time}</td>
                        <td className="px-3 py-2">{row.total_worker_count}</td>
                        <td className="px-3 py-2 text-slate-500 text-xs">
                          {row.department_allocations.map(a => `${a.department}:${a.worker_count}`).join(', ')}
                        </td>
                        <td className="px-3 py-2 text-slate-500">{row.gate_entry_reference}</td>
                        <td className="px-3 py-2">{hasErr ? <span className="text-red-500">✗</span> : <span className="text-green-500">✓</span>}</td>
                      </tr>
                      {hasErr && (
                        <tr className="bg-red-50/30">
                          <td colSpan={8} className="px-3 py-1 text-xs text-red-600">
                            {rowErrs.map((e, i) => <div key={i}>{e.error}</div>)}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Step 3: Done */}
      {step === 3 && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-8 text-center">
          <div className="text-4xl mb-3">✓</div>
          <h3 className="text-lg font-semibold text-green-700">Import Complete</h3>
          <p className="text-sm text-green-600 mt-1">Redirecting to records...</p>
        </div>
      )}
    </div>
  )
}
