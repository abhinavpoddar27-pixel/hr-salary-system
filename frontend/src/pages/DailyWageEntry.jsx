import React, { useState, useMemo, useRef, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useMutation } from '@tanstack/react-query'
import { getDWContractors, getDWEntry, createDWEntry, updateDWEntry, submitDWEntry, checkDWDuplicates } from '../utils/api'
import { useAppStore } from '../store/appStore'
import clsx from 'clsx'
import toast from 'react-hot-toast'

function fmt(n) { return (n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }

export default function DailyWageEntry() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const editId = searchParams.get('edit')
  const isEditMode = !!editId
  const selectedCompany = useAppStore(s => s.selectedCompany)

  // ── Contractor search dropdown ──────────────────────────────
  const [cSearch, setCSearch] = useState('')
  const [cOpen, setCOpen] = useState(false)
  const [selectedContractor, setSelectedContractor] = useState(null)
  const dropRef = useRef(null)
  const [editLoaded, setEditLoaded] = useState(false)

  const { data: cRes } = useQuery({
    queryKey: ['dw-contractors-active'],
    queryFn: () => getDWContractors({ is_active: 1 }),
    retry: 0
  })
  const allContractors = cRes?.data?.data || []
  const filteredContractors = useMemo(() => {
    if (!cSearch) return allContractors
    const q = cSearch.toLowerCase()
    return allContractors.filter(c => c.contractor_name.toLowerCase().includes(q))
  }, [allContractors, cSearch])

  useEffect(() => {
    const handler = (e) => { if (dropRef.current && !dropRef.current.contains(e.target)) setCOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // ── Edit mode: fetch entry and pre-populate ─────────────────
  useEffect(() => {
    if (!editId || editLoaded || allContractors.length === 0) return
    getDWEntry(editId).then(res => {
      const e = res?.data?.data
      if (!e) return
      setEntryDate(e.entry_date || today)
      setInTime(e.in_time || '08:00')
      setOutTime(e.out_time || '17:00')
      setTotalWorkers(String(e.total_worker_count || ''))
      setGateRef(e.gate_entry_reference || '')
      setNotes(e.notes || '')
      if (e.department_allocations?.length > 0) {
        setAllocations(e.department_allocations.map(a => ({
          department: a.department || '', worker_count: String(a.worker_count || '')
        })))
      }
      const contractor = allContractors.find(c => c.id === e.contractor_id)
      if (contractor) setSelectedContractor(contractor)
      setEditLoaded(true)
    }).catch(() => {})
  }, [editId, editLoaded, allContractors])

  // ── Form state ──────────────────────────────────────────────
  const today = new Date().toISOString().slice(0, 10)
  const [entryDate, setEntryDate] = useState(today)
  const [inTime, setInTime] = useState('08:00')
  const [outTime, setOutTime] = useState('17:00')
  const [totalWorkers, setTotalWorkers] = useState('')
  const [gateRef, setGateRef] = useState('')
  const [notes, setNotes] = useState('')
  const [allocations, setAllocations] = useState([{ department: '', worker_count: '' }])
  const [showDupConfirm, setShowDupConfirm] = useState(false)
  const [dupInfo, setDupInfo] = useState(null)
  const [submitAfterSave, setSubmitAfterSave] = useState(false)
  const [contractorError, setContractorError] = useState(false)

  // ── Computed values ─────────────────────────────────────────
  const wageRate = selectedContractor?.current_daily_wage_rate || 0
  const commRate = selectedContractor?.current_commission_rate || 0
  const totalWC = Number(totalWorkers) || 0
  const allocSum = allocations.reduce((s, a) => s + (Number(a.worker_count) || 0), 0)
  const allocMatch = totalWC > 0 && allocSum === totalWC

  const duration = useMemo(() => {
    if (!inTime || !outTime) return ''
    const [ih, im] = inTime.split(':').map(Number)
    const [oh, om] = outTime.split(':').map(Number)
    const mins = (oh * 60 + om) - (ih * 60 + im)
    if (mins <= 0) return 'Invalid'
    const h = Math.floor(mins / 60)
    const m = mins % 60
    return `${h}h ${m}m`
  }, [inTime, outTime])

  const costSummary = useMemo(() => ({
    totalWage: Math.round(totalWC * wageRate * 100) / 100,
    totalComm: Math.round(totalWC * commRate * 100) / 100,
    totalLiability: Math.round(totalWC * (wageRate + commRate) * 100) / 100
  }), [totalWC, wageRate, commRate])

  // ── Allocation helpers ──────────────────────────────────────
  const updateAlloc = (idx, field, val) => {
    setAllocations(prev => prev.map((a, i) => i === idx ? { ...a, [field]: val } : a))
  }
  const addAlloc = () => setAllocations(prev => [...prev, { department: '', worker_count: '' }])
  const removeAlloc = (idx) => setAllocations(prev => prev.filter((_, i) => i !== idx))

  // ── Mutations ───────────────────────────────────────────────
  const createMut = useMutation({
    mutationFn: (body) => isEditMode ? updateDWEntry(editId, body) : createDWEntry(body),
    onSuccess: async (res) => {
      const entryId = isEditMode ? Number(editId) : res?.data?.data?.id
      if (submitAfterSave && entryId) {
        try {
          await submitDWEntry(entryId)
          toast.success(isEditMode ? 'Entry updated and submitted for review' : 'Entry created and submitted for review')
        } catch {
          toast.success(isEditMode ? 'Entry updated (submit failed — you can submit from records)' : 'Entry created (submit failed — you can submit from records)')
        }
      } else {
        toast.success(isEditMode ? 'Entry updated' : 'Entry saved as draft')
      }
      navigate('/daily-wage')
    },
    onError: (e) => toast.error(e.response?.data?.error || (isEditMode ? 'Failed to update entry' : 'Failed to create entry'))
  })

  // ── Save handler ────────────────────────────────────────────
  const doSave = async (andSubmit) => {
    setSubmitAfterSave(andSubmit)
    const body = {
      contractor_id: selectedContractor?.id,
      entry_date: entryDate,
      in_time: inTime,
      out_time: outTime,
      total_worker_count: totalWC,
      department_allocations: allocations.map(a => ({ department: a.department.trim(), worker_count: Number(a.worker_count) || 0 })).filter(a => a.department),
      gate_entry_reference: gateRef.trim(),
      notes: notes.trim() || undefined,
      company: selectedCompany || ''
    }

    // Basic client-side checks
    setContractorError(false)
    if (!selectedContractor) {
      setContractorError(true)
      return toast.error('Select a contractor')
    }
    if (!entryDate) return toast.error('Enter a date')
    if (!inTime || !outTime || inTime >= outTime) return toast.error('Check in/out times')
    if (totalWC <= 0) return toast.error('Enter total workers')
    if (!allocMatch) return toast.error('Department allocation must match total workers')
    if (!gateRef.trim()) return toast.error('Enter gate entry reference')

    // Duplicate check (skip for edit mode — we're updating the same entry)
    if (!isEditMode) {
      try {
        const dupRes = await checkDWDuplicates({ contractor_id: selectedContractor.id, entry_date: entryDate, in_time: inTime, out_time: outTime })
        const dups = dupRes?.data?.duplicates || []
        if (dups.length > 0) {
          setDupInfo(dups[0])
          setShowDupConfirm(true)
          return
        }
      } catch { /* proceed if check fails */ }
    }

    createMut.mutate(body)
  }

  const goToExisting = () => {
    const id = dupInfo?.id
    setShowDupConfirm(false)
    if (id) navigate(`/daily-wage/new?edit=${id}`)
  }

  // ═══════════════════════════════════════════════════════════
  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-800">{isEditMode ? 'Edit Daily Wage Entry' : 'New Daily Wage Entry'}</h1>
          <p className="text-sm text-slate-500 mt-0.5">{isEditMode ? 'Update daily wage worker entry' : 'Record daily wage worker attendance'}</p>
        </div>
        <button onClick={() => navigate('/daily-wage')} className="text-sm text-slate-500 hover:text-slate-700">Back to Records</button>
      </div>

      {/* Contractor Search */}
      <div className="bg-white rounded-lg border border-slate-200 p-4">
        <label className="block text-xs font-semibold text-slate-500 uppercase mb-2">Contractor *</label>
        <div className="relative" ref={dropRef}>
          <input type="text" placeholder="Search contractor..." value={selectedContractor ? selectedContractor.contractor_name : cSearch}
            onChange={e => { setCSearch(e.target.value); setSelectedContractor(null); setCOpen(true); setContractorError(false) }}
            onFocus={() => setCOpen(true)}
            className={clsx('w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none',
              contractorError ? 'border-red-500 bg-red-50' : 'border-slate-300')} />
          {selectedContractor && (
            <button onClick={() => { setSelectedContractor(null); setCSearch('') }}
              className="absolute right-2 top-2 text-slate-400 hover:text-slate-600">&times;</button>
          )}
          {cOpen && !selectedContractor && (
            <div className="absolute z-20 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
              {filteredContractors.length === 0 ? (
                <div className="px-3 py-2 text-sm text-slate-400">No contractors found</div>
              ) : filteredContractors.map(c => (
                <div key={c.id} onClick={() => { setSelectedContractor(c); setCSearch(''); setCOpen(false); setContractorError(false) }}
                  className="px-3 py-2 text-sm hover:bg-blue-50 cursor-pointer flex justify-between">
                  <span className="font-medium text-slate-700">{c.contractor_name}</span>
                  <span className="text-slate-400">Wage: {fmt(c.current_daily_wage_rate)} | Comm: {fmt(c.current_commission_rate)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        {contractorError && <p className="text-xs text-red-600 mt-1">Contractor is required</p>}
        {selectedContractor && (
          <div className="mt-2 flex items-center gap-4 text-sm bg-blue-50 rounded-lg px-3 py-2">
            <span className="text-slate-600">Wage Rate: <strong className="text-blue-700">{fmt(wageRate)}</strong></span>
            <span className="text-slate-600">Commission: <strong className="text-blue-700">{fmt(commRate)}</strong></span>
            <span className="text-slate-600">Total/Worker: <strong className="text-blue-700">{fmt(wageRate + commRate)}</strong></span>
          </div>
        )}
      </div>

      {/* Date & Time */}
      <div className="bg-white rounded-lg border border-slate-200 p-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Date *</label>
            <input type="date" value={entryDate} max={today} onChange={e => setEntryDate(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">In Time *</label>
            <input type="time" value={inTime} onChange={e => setInTime(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Out Time *</label>
            <input type="time" value={outTime} onChange={e => setOutTime(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Duration</label>
            <div className={clsx('px-3 py-2 text-sm rounded-lg border', duration === 'Invalid' ? 'border-red-300 bg-red-50 text-red-600' : 'border-slate-200 bg-slate-50 text-slate-700')}>
              {duration || '—'}
            </div>
          </div>
        </div>
      </div>

      {/* Workers & Departments */}
      <div className="bg-white rounded-lg border border-slate-200 p-4 space-y-3">
        <div className="flex items-end gap-4">
          <div className="w-40">
            <label className="block text-xs font-medium text-slate-600 mb-1">Total Workers *</label>
            <input type="number" min="1" value={totalWorkers} onChange={e => setTotalWorkers(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" />
          </div>
          <div className="flex items-center gap-2 text-sm pb-2">
            <span className={clsx('inline-flex items-center gap-1', allocMatch ? 'text-green-600' : totalWC > 0 ? 'text-red-500' : 'text-slate-400')}>
              {allocMatch ? '✓' : totalWC > 0 ? '✗' : '—'} Allocated: {allocSum} / {totalWC || 0}
            </span>
          </div>
        </div>

        <div className="space-y-2">
          <div className="grid grid-cols-12 gap-2 text-xs font-medium text-slate-500 uppercase px-1">
            <div className="col-span-4">Department</div>
            <div className="col-span-2">Workers</div>
            <div className="col-span-2">Wage</div>
            <div className="col-span-2">Commission</div>
            <div className="col-span-2"></div>
          </div>
          {allocations.map((a, idx) => {
            const awc = Number(a.worker_count) || 0
            return (
              <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                <input type="text" placeholder="Department name" value={a.department} onChange={e => updateAlloc(idx, 'department', e.target.value)}
                  className="col-span-4 px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" />
                <input type="number" min="1" placeholder="0" value={a.worker_count} onChange={e => updateAlloc(idx, 'worker_count', e.target.value)}
                  className="col-span-2 px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" />
                <div className="col-span-2 text-sm text-slate-500 px-1">{fmt(awc * wageRate)}</div>
                <div className="col-span-2 text-sm text-slate-500 px-1">{fmt(awc * commRate)}</div>
                <div className="col-span-2 flex justify-end">
                  {allocations.length > 1 && (
                    <button onClick={() => removeAlloc(idx)} className="text-red-400 hover:text-red-600 text-sm px-2">Remove</button>
                  )}
                </div>
              </div>
            )
          })}
          <button onClick={addAlloc} className="text-sm text-blue-600 hover:text-blue-700 font-medium">+ Add Department</button>
        </div>
      </div>

      {/* Gate Entry & Notes */}
      <div className="bg-white rounded-lg border border-slate-200 p-4 space-y-3">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Gate Entry Reference *</label>
          <input type="text" value={gateRef} onChange={e => setGateRef(e.target.value)} placeholder="e.g. GE-2026-04-10-001"
            className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Notes</label>
          <textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional notes..."
            className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none resize-none" />
        </div>
      </div>

      {/* Cost Summary */}
      {selectedContractor && totalWC > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <h3 className="text-xs font-semibold text-blue-600 uppercase mb-2">Cost Summary</h3>
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div><span className="text-slate-500">Total Wages:</span> <strong className="text-slate-700">{fmt(costSummary.totalWage)}</strong></div>
            <div><span className="text-slate-500">Total Commission:</span> <strong className="text-slate-700">{fmt(costSummary.totalComm)}</strong></div>
            <div><span className="text-slate-500">Total Liability:</span> <strong className="text-blue-700 text-base">{fmt(costSummary.totalLiability)}</strong></div>
          </div>
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex justify-end gap-3">
        <button onClick={() => navigate('/daily-wage')} className="px-4 py-2 text-sm font-medium rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50">Cancel</button>
        <button onClick={() => doSave(false)} disabled={createMut.isPending}
          className="px-4 py-2 text-sm font-medium rounded-lg border border-blue-300 text-blue-600 bg-blue-50 hover:bg-blue-100 disabled:opacity-50">
          {createMut.isPending ? 'Saving...' : 'Save as Draft'}
        </button>
        <button onClick={() => doSave(true)} disabled={createMut.isPending}
          className="px-5 py-2 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
          {createMut.isPending ? 'Saving...' : 'Save & Submit for Review'}
        </button>
      </div>

      {/* Duplicate Confirm Dialog */}
      {showDupConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowDupConfirm(false)} />
          <div className="relative bg-white rounded-lg shadow-xl p-6 w-full max-w-md">
            <h3 className="text-lg font-semibold text-amber-700 mb-2">Duplicate Detected</h3>
            <p className="text-sm text-slate-600 mb-1">An overlapping entry already exists for this contractor on {dupInfo?.entry_date}:</p>
            <div className="bg-amber-50 rounded-lg p-3 text-sm mb-4">
              <p>Time: {dupInfo?.in_time} — {dupInfo?.out_time}</p>
              <p>Workers: {dupInfo?.total_worker_count} | Status: {dupInfo?.status}</p>
            </div>
            <p className="text-sm text-slate-600 mb-4">A live entry already covers this slot. Open the existing entry to edit it, or cancel and adjust your time window.</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowDupConfirm(false)} className="px-4 py-2 text-sm rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50">Cancel</button>
              <button onClick={goToExisting} disabled={!dupInfo?.id} className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">Go to existing entry</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
