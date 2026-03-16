import React, { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { getAttendanceRegister, updateAttendanceRecord, getEmployees } from '../utils/api'
import { useAppStore } from '../store/appStore'
import PipelineProgress from '../components/pipeline/PipelineProgress'
import { statusColor } from '../utils/formatters'
import clsx from 'clsx'

function CellEditor({ record, onSave, onClose }) {
  const [status, setStatus] = useState(record.status_final || record.status_original || '')
  const [inTime, setInTime] = useState(record.in_time_final || record.in_time_original || '')
  const [outTime, setOutTime] = useState(record.out_time_final || record.out_time_original || '')
  const [remark, setRemark] = useState(record.correction_remark || '')

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-xl p-5 w-80 shadow-xl" onClick={e => e.stopPropagation()}>
        <h3 className="font-bold text-slate-800 mb-3 text-sm">Edit: {record.employee_name} — {record.date}</h3>
        <div className="space-y-3">
          <div>
            <label className="label">Status</label>
            <select value={status} onChange={e => setStatus(e.target.value)} className="select">
              {['P','A','WO','WOP','½P','WO½P'].map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="label">IN Time</label>
            <input type="time" value={inTime} onChange={e => setInTime(e.target.value)} className="input" />
          </div>
          <div>
            <label className="label">OUT Time</label>
            <input type="time" value={outTime} onChange={e => setOutTime(e.target.value)} className="input" />
          </div>
          <div>
            <label className="label">Remark</label>
            <input type="text" value={remark} onChange={e => setRemark(e.target.value)} placeholder="Correction note..." className="input" />
          </div>
        </div>
        <div className="flex gap-2 mt-4">
          <button onClick={() => onSave({ statusFinal: status, inTimeFinal: inTime, outTimeFinal: outTime, remark })} className="btn-primary flex-1">Save</button>
          <button onClick={onClose} className="btn-secondary">Cancel</button>
        </div>
      </div>
    </div>
  )
}

export default function AttendanceRegister() {
  const { selectedMonth, selectedYear } = useAppStore()
  const [selectedEmp, setSelectedEmp] = useState('')
  const [editRecord, setEditRecord] = useState(null)
  const [searchEmp, setSearchEmp] = useState('')

  const { data: empsRes } = useQuery({ queryKey: ['employees'], queryFn: () => getEmployees({}), retry: 0 })
  const employees = empsRes?.data?.data || []
  const filteredEmps = employees.filter(e => !searchEmp || e.name?.toLowerCase().includes(searchEmp.toLowerCase()) || e.code?.includes(searchEmp))

  const { data: res, isLoading, refetch } = useQuery({
    queryKey: ['attendance-register', selectedMonth, selectedYear, selectedEmp],
    queryFn: () => getAttendanceRegister({ month: selectedMonth, year: selectedYear, employeeCode: selectedEmp }),
    enabled: !!selectedEmp,
    retry: 0
  })

  const records = res?.data?.data || []
  const daysInMonth = new Date(selectedYear, selectedMonth, 0).getDate()
  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1)

  const recordByDay = {}
  for (const r of records) {
    const day = parseInt(r.date.split('-')[2])
    recordByDay[day] = r
  }

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => updateAttendanceRecord(id, data),
    onSuccess: () => { toast.success('Updated'); setEditRecord(null); refetch() }
  })

  function cellClass(rec) {
    if (!rec) return 'bg-slate-50 text-slate-300'
    const status = rec.status_final || rec.status_original
    if (rec.is_miss_punch && !rec.miss_punch_resolved) return 'bg-red-100 text-red-700 ring-1 ring-red-300'
    if (rec.stage_5_done || rec.correction_remark) return 'bg-amber-50 text-amber-700'
    if (rec.is_night_shift && !rec.is_night_out_only) return 'bg-purple-50 text-purple-700'
    if (rec.is_night_out_only) return 'hidden'
    return statusColor(status) || 'bg-slate-50 text-slate-400'
  }

  return (
    <div>
      <PipelineProgress stageStatus={{ 1: 'done', 2: 'done', 3: 'done', 4: 'done', 5: 'active' }} />
      <div className="p-6 space-y-4">
        <div>
          <h2 className="text-lg font-bold text-slate-800">Stage 5: Manual Corrections & Attendance Register</h2>
          <p className="text-sm text-slate-500">Click any cell to edit. Green=OK, Yellow=Corrected, Red=Issue, Purple=Night shift, Grey=Week Off.</p>
        </div>

        <div className="flex gap-3">
          <div className="flex-1 max-w-xs">
            <label className="label">Select Employee</label>
            <input type="search" placeholder="Search by name or code..." value={searchEmp} onChange={e => setSearchEmp(e.target.value)} className="input mb-1" />
            {searchEmp && filteredEmps.length > 0 && (
              <div className="border border-slate-200 rounded-lg max-h-40 overflow-y-auto bg-white shadow-lg">
                {filteredEmps.slice(0, 10).map(e => (
                  <button key={e.code} onClick={() => { setSelectedEmp(e.code); setSearchEmp('') }} className="w-full text-left px-3 py-2 hover:bg-slate-50 text-sm">
                    <span className="font-medium">{e.name}</span> <span className="text-slate-400">{e.code}</span> <span className="text-xs text-slate-400">{e.department}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {selectedEmp && (
          <div className="card overflow-hidden">
            <div className="card-header">
              <h3 className="font-semibold text-slate-700">
                {employees.find(e => e.code === selectedEmp)?.name} — {['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][selectedMonth]} {selectedYear}
              </h3>
              <div className="flex gap-2 text-xs">
                <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-green-200 inline-block" />Present</span>
                <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-red-200 inline-block" />Absent</span>
                <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-purple-200 inline-block" />Night</span>
                <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-amber-200 inline-block" />Corrected</span>
              </div>
            </div>
            <div className="overflow-x-auto p-4">
              {isLoading ? (
                <div className="text-center py-6 text-slate-400">Loading...</div>
              ) : (
                <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${daysInMonth}, minmax(52px, 1fr))` }}>
                  {days.map(d => {
                    const rec = recordByDay[d]
                    const dow = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][new Date(`${selectedYear}-${String(selectedMonth).padStart(2,'0')}-${String(d).padStart(2,'0')}`).getDay()]
                    const status = rec ? (rec.status_final || rec.status_original) : '?'
                    const isSun = dow === 'Sun'

                    return (
                      <div
                        key={d}
                        onClick={() => rec && setEditRecord(rec)}
                        className={clsx(
                          'rounded-lg p-1.5 text-center text-xs cursor-pointer hover:ring-2 hover:ring-blue-400 transition-all min-h-[60px] flex flex-col',
                          isSun ? 'bg-slate-100 text-slate-400' : cellClass(rec)
                        )}
                      >
                        <div className="font-bold">{d}</div>
                        <div className="text-xs opacity-70">{dow}</div>
                        <div className="font-semibold mt-0.5">{status}</div>
                        {rec?.in_time_final && <div className="text-xs opacity-70">{rec.in_time_final}</div>}
                        {rec?.out_time_final && <div className="text-xs opacity-70">{rec.out_time_final}</div>}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {!selectedEmp && (
          <div className="card p-8 text-center text-slate-400">
            <div className="text-4xl mb-2">👤</div>
            <p>Search for an employee to view their attendance register</p>
          </div>
        )}
      </div>

      {editRecord && (
        <CellEditor
          record={editRecord}
          onSave={(data) => updateMutation.mutate({ id: editRecord.id, data })}
          onClose={() => setEditRecord(null)}
        />
      )}
    </div>
  )
}
