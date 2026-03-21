import React, { useState, useCallback } from 'react'
import { useDropzone } from 'react-dropzone'
import { useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { uploadFiles, getImportHistory, getImportReconciliation, updateDepartmentsFromReconciliation, addEmployeesToMaster } from '../utils/api'
import { useQuery } from '@tanstack/react-query'
import { useAppStore } from '../store/appStore'
import CompanyFilter from '../components/shared/CompanyFilter'
import DateSelector from '../components/common/DateSelector'
import useDateSelector from '../hooks/useDateSelector'
import PipelineProgress from '../components/pipeline/PipelineProgress'
import { fmtDate, fmtDateTime, monthYearLabel } from '../utils/formatters'
import clsx from 'clsx'

function ReconciliationPanel({ month, year }) {
  const [showRecon, setShowRecon] = useState(false)
  const [deptEdits, setDeptEdits] = useState({}) // { code: editedDept }
  const [saving, setSaving] = useState(false)
  const queryClient = useQueryClient()
  const { selectedCompany } = useAppStore()
  const { data: reconRes, isLoading } = useQuery({
    queryKey: ['reconciliation', month, year, selectedCompany],
    queryFn: () => getImportReconciliation(month, year, selectedCompany),
    enabled: showRecon,
    retry: 0
  })
  const recon = reconRes?.data?.data || null
  const summary = reconRes?.data?.summary || {}

  const handleDeptEdit = (code, dept) => {
    setDeptEdits(prev => ({ ...prev, [code]: dept }))
  }

  const handleSaveDeptCorrections = async () => {
    const corrections = Object.entries(deptEdits)
      .filter(([_, dept]) => dept && dept.trim())
      .map(([code, department]) => ({ code, department: department.trim() }))

    if (corrections.length === 0) return toast.error('No department changes to save')

    setSaving(true)
    try {
      const res = await updateDepartmentsFromReconciliation(corrections)
      toast.success(res.data.message)
      setDeptEdits({})
      queryClient.invalidateQueries(['reconciliation'])
    } catch (err) {
      toast.error('Failed: ' + (err.response?.data?.error || err.message))
    } finally {
      setSaving(false)
    }
  }

  const handleAddAllToMaster = async () => {
    if (!recon?.newInEesl?.length) return
    setSaving(true)
    try {
      const employees = recon.newInEesl.map(e => ({
        code: e.code,
        name: e.name,
        department: deptEdits[e.code] || e.department,
        company: e.company
      }))
      const res = await addEmployeesToMaster(employees)
      toast.success(res.data.message)
      setDeptEdits({})
      queryClient.invalidateQueries(['reconciliation'])
    } catch (err) {
      toast.error('Failed: ' + (err.response?.data?.error || err.message))
    } finally {
      setSaving(false)
    }
  }

  const hasDeptEdits = Object.keys(deptEdits).length > 0

  if (!showRecon) {
    return (
      <button onClick={() => setShowRecon(true)} className="btn-ghost text-xs border border-slate-200 px-3 py-1.5 rounded-lg">
        Show Import Reconciliation
      </button>
    )
  }

  return (
    <div className="card p-4 animate-slide-up">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-bold text-slate-700">Import Reconciliation</h3>
        <button onClick={() => setShowRecon(false)} className="btn-ghost text-xs">Hide</button>
      </div>
      {isLoading ? <div className="text-center text-slate-400 py-4">Loading...</div> : !recon ? (
        <div className="text-center text-slate-400 py-4 text-sm">No import data for this month</div>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-green-50 rounded-lg px-3 py-2 text-center">
              <div className="text-lg font-bold text-green-700">{summary.matched}</div>
              <div className="text-xs text-green-600">Matched</div>
            </div>
            <div className={clsx('rounded-lg px-3 py-2 text-center', summary.newInEesl > 0 ? 'bg-amber-50' : 'bg-slate-50')}>
              <div className={clsx('text-lg font-bold', summary.newInEesl > 0 ? 'text-amber-700' : 'text-slate-400')}>{summary.newInEesl}</div>
              <div className="text-xs text-slate-500">New in EESL</div>
            </div>
            <div className={clsx('rounded-lg px-3 py-2 text-center', summary.missingFromEesl > 0 ? 'bg-red-50' : 'bg-slate-50')}>
              <div className={clsx('text-lg font-bold', summary.missingFromEesl > 0 ? 'text-red-600' : 'text-slate-400')}>{summary.missingFromEesl}</div>
              <div className="text-xs text-slate-500">Missing from EESL</div>
            </div>
            <div className="bg-blue-50 rounded-lg px-3 py-2 text-center">
              <div className="text-lg font-bold text-blue-700">{summary.totalRecords}</div>
              <div className="text-xs text-blue-600">Total Records</div>
            </div>
          </div>

          {recon.newInEesl?.length > 0 && (
            <div className="bg-amber-50 rounded-lg p-3">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-xs font-semibold text-amber-800">New Employees in EESL (not in master)</h4>
                <button
                  onClick={handleAddAllToMaster}
                  disabled={saving}
                  className="text-xs bg-amber-600 text-white px-2.5 py-1 rounded-md hover:bg-amber-700 disabled:opacity-50"
                >
                  {saving ? 'Saving...' : `Add All ${recon.newInEesl.length} to Master`}
                </button>
              </div>
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {recon.newInEesl.map(e => (
                  <div key={e.code} className="flex items-center gap-2 text-xs text-amber-700">
                    <span className="font-mono w-14 shrink-0">{e.code}</span>
                    <span className="truncate flex-1">{e.name}</span>
                    <input
                      type="text"
                      value={deptEdits[e.code] !== undefined ? deptEdits[e.code] : (e.department || '')}
                      onChange={ev => handleDeptEdit(e.code, ev.target.value)}
                      placeholder="Department"
                      className="w-36 px-1.5 py-0.5 border border-amber-300 rounded text-xs bg-white focus:outline-none focus:ring-1 focus:ring-amber-400"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {recon.missingFromEesl?.length > 0 && (
            <div className="bg-red-50 rounded-lg p-3">
              <h4 className="text-xs font-semibold text-red-800 mb-2">Active Employees Missing from EESL</h4>
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {recon.missingFromEesl.map(e => (
                  <div key={e.code} className="flex items-center gap-2 text-xs text-red-700">
                    <span className="font-mono w-14 shrink-0">{e.code}</span>
                    <span className="truncate flex-1">{e.name}</span>
                    <input
                      type="text"
                      value={deptEdits[e.code] !== undefined ? deptEdits[e.code] : (e.department || '')}
                      onChange={ev => handleDeptEdit(e.code, ev.target.value)}
                      placeholder="Department"
                      className="w-36 px-1.5 py-0.5 border border-red-300 rounded text-xs bg-white focus:outline-none focus:ring-1 focus:ring-red-400"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {hasDeptEdits && (
            <div className="flex justify-end">
              <button
                onClick={handleSaveDeptCorrections}
                disabled={saving}
                className="text-xs bg-blue-600 text-white px-3 py-1.5 rounded-md hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? 'Saving...' : `Save ${Object.keys(deptEdits).length} Department Correction(s) to Master`}
              </button>
            </div>
          )}

          {recon.zeroPunch?.length > 0 && (
            <div className="bg-slate-50 rounded-lg p-3">
              <h4 className="text-xs font-semibold text-slate-700 mb-1">Zero Punch Employees ({recon.zeroPunch.length})</h4>
              <div className="space-y-0.5 max-h-24 overflow-y-auto">
                {recon.zeroPunch.map(e => (
                  <div key={e.code} className="text-xs text-slate-600"><span className="font-mono">{e.code}</span> — {e.name}</div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function Import() {
  const { month, year, dateProps } = useDateSelector({ mode: 'month', syncToStore: true })
  const { selectedCompany } = useAppStore()
  const queryClient = useQueryClient()
  const [uploading, setUploading] = useState(false)
  const [uploadResults, setUploadResults] = useState(null)
  const [selectedFiles, setSelectedFiles] = useState([])
  const [overwrite, setOverwrite] = useState(false)

  const { data: historyRes, refetch: refetchHistory } = useQuery({
    queryKey: ['import-history', selectedCompany],
    queryFn: () => getImportHistory({ company: selectedCompany }),
    retry: 0
  })

  const history = historyRes?.data?.data || []

  const onDrop = useCallback((accepted) => {
    setSelectedFiles(prev => {
      const names = new Set(prev.map(f => f.name))
      const newFiles = accepted.filter(f => !names.has(f.name))
      return [...prev, ...newFiles]
    })
  }, [])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'application/vnd.ms-excel': ['.xls'], 'application/octet-stream': ['.xls'] },
    multiple: true
  })

  const removeFile = (name) => setSelectedFiles(prev => prev.filter(f => f.name !== name))

  const handleUpload = async () => {
    if (!selectedFiles.length) return toast.error('Please select .xls files first')
    setUploading(true)
    setUploadResults(null)

    try {
      const fd = new FormData()
      selectedFiles.forEach(f => fd.append('files', f))
      fd.append('overwrite', String(overwrite))

      const res = await uploadFiles(fd)
      const results = res.data.results || []

      setUploadResults(results)

      const succeeded = results.filter(r => r.success)
      const failed = results.filter(r => !r.success)

      if (succeeded.length > 0) {
        toast.success(`Imported ${succeeded.length} sheet(s) successfully`)
        setSelectedFiles([])
        refetchHistory()
        queryClient.invalidateQueries(['org-overview'])
      }
      if (failed.length > 0) {
        toast.error(`${failed.length} file(s) failed to import`)
      }
    } catch (err) {
      toast.error('Upload failed: ' + (err.response?.data?.error || err.message))
    } finally {
      setUploading(false)
    }
  }

  const MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

  return (
    <div>
      <PipelineProgress stageStatus={{ 1: 'active' }} />

      <div className="p-6 space-y-6 max-w-5xl">
        <div>
          <h2 className="text-lg font-bold text-slate-800">Stage 1: Import Attendance Data</h2>
          <p className="text-sm text-slate-500 mt-1">Upload EESL biometric attendance .xls files. Both Sheet1 (Asian Lakto Ind Ltd) and Sheet2 (Default) will be parsed automatically.</p>
        </div>

        <div className="flex items-center gap-3">
          <DateSelector {...dateProps} />
          <CompanyFilter />
        </div>

        {/* File Drop Zone */}
        <div className="card">
          <div className="card-header">
            <h3 className="font-semibold text-slate-700">Upload EESL Files</h3>
            <label className="flex items-center gap-2 text-sm text-slate-500 cursor-pointer">
              <input type="checkbox" checked={overwrite} onChange={e => setOverwrite(e.target.checked)} className="rounded" />
              Overwrite if month already imported
            </label>
          </div>
          <div className="card-body space-y-4">
            <div
              {...getRootProps()}
              className={clsx(
                'border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors',
                isDragActive ? 'border-blue-400 bg-blue-50' : 'border-slate-200 hover:border-blue-300 hover:bg-slate-50'
              )}
            >
              <input {...getInputProps()} />
              <div className="text-4xl mb-3">📂</div>
              {isDragActive ? (
                <p className="text-blue-600 font-medium">Drop the files here...</p>
              ) : (
                <>
                  <p className="text-slate-600 font-medium">Drag & drop EESL .xls files here</p>
                  <p className="text-slate-400 text-sm mt-1">or click to browse — multiple files supported (one per month)</p>
                </>
              )}
            </div>

            {/* Selected files */}
            {selectedFiles.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-slate-600 uppercase tracking-wide">{selectedFiles.length} file(s) selected</p>
                {selectedFiles.map(f => (
                  <div key={f.name} className="flex items-center gap-3 bg-slate-50 rounded-lg px-3 py-2 text-sm">
                    <span className="text-lg">📄</span>
                    <span className="flex-1 truncate text-slate-700">{f.name}</span>
                    <span className="text-slate-400">{(f.size / 1024).toFixed(0)} KB</span>
                    <button onClick={() => removeFile(f.name)} className="text-red-400 hover:text-red-600 text-xs px-1">✕</button>
                  </div>
                ))}
                <button
                  onClick={handleUpload}
                  disabled={uploading}
                  className="btn-primary w-full justify-center mt-3"
                >
                  {uploading ? (
                    <><span className="animate-spin">⏳</span> Parsing files...</>
                  ) : (
                    <><span>📤</span> Upload & Parse {selectedFiles.length} file(s)</>
                  )}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Upload Results */}
        {uploadResults && (
          <div className="card">
            <div className="card-header">
              <h3 className="font-semibold text-slate-700">Import Results</h3>
              <span className={clsx('badge', uploadResults.every(r => r.success) ? 'badge-green' : 'badge-yellow')}>
                {uploadResults.filter(r => r.success).length}/{uploadResults.length} succeeded
              </span>
            </div>
            <div className="divide-y divide-slate-100">
              {uploadResults.map((result, i) => (
                <div key={i} className="p-4">
                  <div className="flex items-start gap-3">
                    <span className="text-xl">{result.success ? '✅' : '❌'}</span>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-slate-700 text-sm">{result.file}</span>
                        {result.sheet && <span className="badge-gray">{result.sheet}</span>}
                      </div>

                      {result.success ? (
                        <div className="mt-2 grid grid-cols-2 md:grid-cols-4 gap-3">
                          <div className="bg-blue-50 rounded-lg p-2 text-center">
                            <div className="text-lg font-bold text-blue-700">{result.employeeCount}</div>
                            <div className="text-xs text-blue-500">Employees</div>
                          </div>
                          <div className="bg-green-50 rounded-lg p-2 text-center">
                            <div className="text-lg font-bold text-green-700">{result.recordCount}</div>
                            <div className="text-xs text-green-500">Records</div>
                          </div>
                          <div className="bg-purple-50 rounded-lg p-2 text-center">
                            <div className="text-lg font-bold text-purple-700">{result.nightShiftPairs}</div>
                            <div className="text-xs text-purple-500">Night Shift Pairs</div>
                          </div>
                          <div className="bg-yellow-50 rounded-lg p-2 text-center">
                            <div className="text-lg font-bold text-yellow-700">{result.missPunches}</div>
                            <div className="text-xs text-yellow-500">Miss Punches</div>
                          </div>
                        </div>
                      ) : (
                        <p className="text-sm text-red-600 mt-1">{result.error}</p>
                      )}

                      {result.success && result.summary && (
                        <div className="mt-2">
                          <p className="text-xs font-medium text-slate-500 mb-1">Departments:</p>
                          <div className="flex flex-wrap gap-1.5">
                            {(result.summary.departments || []).map(d => (
                              <span key={d.department} className="badge-gray text-xs">
                                {d.department}: {d.employees}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Reconciliation Panel */}
        <ReconciliationPanel month={month} year={year} />

        {/* Import History */}
        {history.length > 0 && (
          <div className="card">
            <div className="card-header">
              <h3 className="font-semibold text-slate-700">Import History</h3>
              <span className="badge-gray">{history.length} imports</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full table-compact">
                <thead>
                  <tr>
                    <th>Month</th>
                    <th>Company</th>
                    <th>Employees</th>
                    <th>Records</th>
                    <th>Imported At</th>
                    <th>Pipeline Status</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map(imp => (
                    <tr key={imp.id}>
                      <td className="font-medium">{MONTHS[imp.month]} {imp.year}</td>
                      <td>{imp.company}</td>
                      <td>{imp.employee_count}</td>
                      <td>{imp.record_count}</td>
                      <td className="text-slate-500">{fmtDateTime(imp.imported_at)}</td>
                      <td>
                        <div className="flex gap-0.5">
                          {[1,2,3,4,5,6,7].map(s => (
                            <div key={s} className={clsx('w-4 h-4 rounded-sm text-xs flex items-center justify-center',
                              imp[`stage_${s}_done`] ? 'bg-green-500 text-white' : 'bg-slate-200 text-slate-400'
                            )}>
                              {s}
                            </div>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
