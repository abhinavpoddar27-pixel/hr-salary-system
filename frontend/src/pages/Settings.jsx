import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Routes, Route, NavLink, Navigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import {
  getShifts, createShift, updateShift,
  getHolidays, createHoliday, deleteHoliday,
  getPolicyConfig, updatePolicyConfig,
  getUsageLogs, getUsageLogsSummary,
  getUsers, createUser, updateUser, getAuditTrail
} from '../utils/api'
import { useAppStore } from '../store/appStore'
import clsx from 'clsx'
import useExpandableRows from '../hooks/useExpandableRows'
import DrillDownRow, { DrillDownChevron } from '../components/ui/DrillDownRow'

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

// ─── Shift Tab ─────────────────────────────────────────────────────
// Late Coming Phase 1: HR can edit start time + duration (end time is auto-
// calculated and read-only). Only admin can change the grace period, which
// is fixed at 9 minutes by plant policy.
function calcEndTimeFromDuration(startTime, durationHours) {
  const parts = String(startTime || '').split(':').map(Number)
  const sh = parts[0], sm = parts[1] || 0
  const dur = parseFloat(durationHours)
  if (isNaN(sh) || isNaN(dur)) return ''
  let totalMin = sh * 60 + sm + Math.round(dur * 60)
  totalMin = ((totalMin % (24 * 60)) + 24 * 60) % (24 * 60)
  const eh = Math.floor(totalMin / 60)
  const em = totalMin % 60
  return `${String(eh).padStart(2, '0')}:${String(em).padStart(2, '0')}`
}

function ShiftsTab() {
  const qc = useQueryClient()
  const { user } = useAppStore()
  const isAdmin = user?.role === 'admin'
  const [editId, setEditId] = useState(null)
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState({
    name: '', code: '', startTime: '09:00', durationHours: 9,
    graceMinutes: 9, breakMinutes: 0,
    minHoursFullDay: 8, minHoursHalfDay: 4
  })

  const { data } = useQuery({ queryKey: ['shifts'], queryFn: getShifts, retry: 0 })
  const shifts = data?.data?.data || []

  const createMutation = useMutation({
    mutationFn: (d) => createShift(d),
    onSuccess: () => { toast.success('Shift created'); qc.invalidateQueries(['shifts']); setShowCreate(false); resetForm() }
  })
  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => updateShift(id, data),
    onSuccess: () => { toast.success('Shift updated'); qc.invalidateQueries(['shifts']); setEditId(null); resetForm() }
  })

  function resetForm() {
    setForm({ name: '', code: '', startTime: '09:00', durationHours: 9, graceMinutes: 9, breakMinutes: 0, minHoursFullDay: 8, minHoursHalfDay: 4 })
  }
  function startEdit(shift) {
    setEditId(shift.id)
    setForm({
      name: shift.name, code: shift.code,
      startTime: shift.start_time,
      durationHours: shift.duration_hours || 9,
      graceMinutes: shift.grace_minutes,
      breakMinutes: shift.break_minutes || 0,
      minHoursFullDay: shift.min_hours_full_day,
      minHoursHalfDay: shift.min_hours_half_day
    })
  }

  const autoEndTime = calcEndTimeFromDuration(form.startTime, form.durationHours)

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-slate-500">Configure shift timings and grace periods. End time is auto-calculated from start + duration.</p>
        <button onClick={() => setShowCreate(true)} className="btn-primary text-sm">+ Add Shift</button>
      </div>

      <div className="card overflow-hidden">
        <table className="table-compact w-full">
          <thead>
            <tr>
              <th>Code</th><th>Name</th><th>Start</th><th>End</th>
              <th className="text-center">Duration (h)</th>
              <th className="text-center">Grace (min)</th>
              <th className="text-center">Break (min)</th>
              <th className="text-center">Min Full Day (h)</th>
              <th className="text-center">Min Half Day (h)</th>
              <th className="text-center">Night</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {shifts.map(s => (
              <tr key={s.id}>
                <td className="font-mono font-bold text-brand-600">{s.code}</td>
                <td className="font-medium">{s.name}</td>
                <td>{s.start_time}</td>
                <td>{s.end_time}</td>
                <td className="text-center">{s.duration_hours ?? '—'}</td>
                <td className="text-center">{s.grace_minutes}</td>
                <td className="text-center">{s.break_minutes}</td>
                <td className="text-center">{s.min_hours_full_day}</td>
                <td className="text-center">{s.min_hours_half_day}</td>
                <td className="text-center">{s.is_overnight ? '🌙' : '—'}</td>
                <td><button onClick={() => startEdit(s)} className="btn-secondary text-xs">Edit</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {(showCreate || editId) && (
        <div className="card p-5">
          <h4 className="font-semibold text-slate-700 mb-4">{editId ? 'Edit Shift' : 'New Shift'}</h4>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="label">Shift Name</label>
              <input type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="input" placeholder="12-Hour Shift" />
            </div>
            <div>
              <label className="label">Code</label>
              <input type="text" value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value.toUpperCase() }))} className="input font-mono" placeholder="12HR" disabled={!!editId} />
            </div>
            <div>
              <label className="label">Start Time</label>
              <input type="time" value={form.startTime} onChange={e => setForm(f => ({ ...f, startTime: e.target.value }))} className="input" />
            </div>
            <div>
              <label className="label">Duration (hours)</label>
              <input type="number" value={form.durationHours} onChange={e => setForm(f => ({ ...f, durationHours: parseFloat(e.target.value) }))} className="input" step="0.5" min="1" max="24" />
            </div>
            <div>
              <label className="label">End Time (auto-calculated)</label>
              <input type="time" value={autoEndTime} readOnly className="input bg-slate-100 cursor-not-allowed" />
              <p className="text-xs text-slate-400 mt-1">End time auto-calculated from start time + duration</p>
            </div>
            <div>
              <label className="label">
                Grace Period (min)
                {!isAdmin && <span className="text-xs text-slate-400 ml-1">(admin only)</span>}
              </label>
              <input
                type="number"
                value={form.graceMinutes}
                onChange={e => setForm(f => ({ ...f, graceMinutes: parseInt(e.target.value) }))}
                className={`input ${!isAdmin ? 'bg-slate-100 cursor-not-allowed' : ''}`}
                min="0" max="120"
                disabled={!isAdmin}
              />
            </div>
            <div>
              <label className="label">Break (min)</label>
              <input type="number" value={form.breakMinutes} onChange={e => setForm(f => ({ ...f, breakMinutes: parseInt(e.target.value) }))} className="input" min="0" />
            </div>
            <div>
              <label className="label">Min Hours Full Day</label>
              <input type="number" value={form.minHoursFullDay} onChange={e => setForm(f => ({ ...f, minHoursFullDay: parseFloat(e.target.value) }))} className="input" step="0.5" />
            </div>
            <div>
              <label className="label">Min Hours Half Day</label>
              <input type="number" value={form.minHoursHalfDay} onChange={e => setForm(f => ({ ...f, minHoursHalfDay: parseFloat(e.target.value) }))} className="input" step="0.5" />
            </div>
          </div>
          <div className="flex gap-2 mt-4">
            <button
              onClick={() => editId ? updateMutation.mutate({ id: editId, data: form }) : createMutation.mutate(form)}
              disabled={createMutation.isPending || updateMutation.isPending}
              className="btn-primary"
            >
              {editId ? 'Update' : 'Create'}
            </button>
            <button onClick={() => { setEditId(null); setShowCreate(false); resetForm() }} className="btn-secondary">Cancel</button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Holidays Tab ──────────────────────────────────────────────────
function HolidaysTab() {
  const qc = useQueryClient()
  const { selectedYear } = useAppStore()
  const [form, setForm] = useState({ date: '', name: '', type: 'National', isRecurring: false, applicableTo: 'All' })

  const { data } = useQuery({
    queryKey: ['holidays', selectedYear],
    queryFn: () => getHolidays(selectedYear),
    retry: 0
  })
  const holidays = data?.data?.data || []

  const createMutation = useMutation({
    mutationFn: (d) => createHoliday(d),
    onSuccess: () => { toast.success('Holiday added'); qc.invalidateQueries(['holidays', selectedYear]); setForm({ date: '', name: '', type: 'National', isRecurring: false, applicableTo: 'All' }) }
  })
  const deleteMutation = useMutation({
    mutationFn: (id) => deleteHoliday(id),
    onSuccess: () => { toast.success('Holiday removed'); qc.invalidateQueries(['holidays', selectedYear]) }
  })

  return (
    <div className="space-y-4">
      <div className="card p-4">
        <h4 className="font-semibold text-slate-700 mb-3">Add Holiday</h4>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
          <div>
            <label className="label">Date</label>
            <input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} className="input" />
          </div>
          <div className="col-span-2">
            <label className="label">Holiday Name</label>
            <input type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="input" placeholder="e.g. Diwali" />
          </div>
          <div>
            <label className="label">Type</label>
            <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))} className="select">
              {['National', 'State', 'Restricted', 'Festival'].map(t => <option key={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Applicable To</label>
            <select value={form.applicableTo} onChange={e => setForm(f => ({ ...f, applicableTo: e.target.value }))} className="select">
              {['All', 'Permanent', 'Contract'].map(t => <option key={t}>{t}</option>)}
            </select>
          </div>
        </div>
        <div className="flex items-center gap-4 mt-3">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={form.isRecurring} onChange={e => setForm(f => ({ ...f, isRecurring: e.target.checked }))} className="rounded" />
            Recurring Every Year
          </label>
          <button onClick={() => createMutation.mutate(form)} disabled={!form.date || !form.name || createMutation.isPending} className="btn-primary text-sm">
            Add Holiday
          </button>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="card-header">
          <h4 className="font-semibold text-slate-700">Holidays — {selectedYear}</h4>
          <span className="text-sm text-slate-400">{holidays.length} holidays</span>
        </div>
        <div className="overflow-x-auto">
          <table className="table-compact w-full">
            <thead>
              <tr>
                <th>Date</th><th>Name</th><th>Type</th>
                <th className="text-center">Day</th>
                <th className="text-center">Recurring</th>
                <th>Applicable</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {holidays.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-6 text-slate-400">No holidays configured for {selectedYear}</td></tr>
              ) : holidays.map(h => (
                <tr key={h.id}>
                  <td className="font-mono">{h.date}</td>
                  <td className="font-medium">{h.name}</td>
                  <td><span className={`badge text-xs ${h.type === 'National' ? 'bg-blue-100 text-blue-700' : h.type === 'Festival' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600'}`}>{h.type}</span></td>
                  <td className="text-center text-slate-500">{DAYS[new Date(h.date).getDay()]}</td>
                  <td className="text-center">{h.is_recurring ? '✓' : '—'}</td>
                  <td>{h.applicable_to}</td>
                  <td>
                    <button onClick={() => { if (window.confirm('Remove this holiday?')) deleteMutation.mutate(h.id) }} className="text-xs text-red-500 hover:text-red-700">Remove</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ─── Policy Tab ────────────────────────────────────────────────────
function PolicyTab() {
  const qc = useQueryClient()

  const { data } = useQuery({ queryKey: ['policy'], queryFn: getPolicyConfig, retry: 0 })
  const raw = data?.data?.data || {}
  const [form, setForm] = useState({})

  React.useEffect(() => {
    if (Object.keys(raw).length > 0 && Object.keys(form).length === 0) {
      setForm(raw)
    }
  }, [raw])

  const updateMutation = useMutation({
    mutationFn: (d) => updatePolicyConfig(d),
    onSuccess: () => { toast.success('Policy saved'); qc.invalidateQueries(['policy']) }
  })

  const POLICY_GROUPS = [
    {
      title: 'Salary Calculation',
      keys: [
        { key: 'salary_divisor', label: 'Salary Divisor (days)', hint: 'Typically 26 or 30' },
        { key: 'pf_wage_ceiling', label: 'PF Wage Ceiling (₹)', hint: '15000 for statutory ceiling' },
        { key: 'esi_gross_limit', label: 'ESI Gross Limit (₹)', hint: '21000 — exempt above this' },
        { key: 'overtime_rate_multiplier', label: 'Overtime Rate Multiplier', hint: '1.5 = 1.5x regular rate' }
      ]
    },
    {
      title: 'Sunday & Leave Rules',
      keys: [
        { key: 'paid_sunday_min_days', label: 'Min Days for Paid Sunday', hint: 'Days worked in week to earn paid Sunday' },
        { key: 'cl_per_year', label: 'CL per Year', hint: 'Casual Leave entitlement' },
        { key: 'el_per_year', label: 'EL per Year', hint: 'Earned Leave entitlement' },
        { key: 'sl_per_year', label: 'SL per Year', hint: 'Sick Leave entitlement' }
      ]
    },
    {
      title: 'Night Shift',
      keys: [
        { key: 'night_shift_in_min_hour', label: 'Night Shift IN min hour', hint: '18 = 6 PM' },
        { key: 'night_shift_out_max_hour', label: 'Night Shift OUT max hour', hint: '12 = noon next day' },
        { key: 'night_shift_allowance', label: 'Night Shift Allowance (₹)', hint: 'Fixed nightly allowance' }
      ]
    },
    {
      title: 'Attendance',
      keys: [
        { key: 'late_grace_minutes', label: 'Late Grace Minutes', hint: 'Late arrival grace period' },
        { key: 'early_out_grace_minutes', label: 'Early Out Grace (min)', hint: 'Early departure grace period' },
        { key: 'half_day_late_minutes', label: 'Half Day if Late (min)', hint: 'Mark half day if late > this' }
      ]
    },
    {
      title: 'Salary Advance',
      keys: [
        { key: 'advance_cutoff_date', label: 'Advance Cutoff Day', hint: 'Count working days from 1st to this date (default: 15)' },
        { key: 'advance_min_working_days', label: 'Min Working Days', hint: 'Min days to qualify for advance (default: 9)' },
        { key: 'advance_fraction', label: 'Advance Fraction', hint: '0.3333 = 1/3 of gross salary' }
      ]
    }
  ]

  return (
    <div className="space-y-6">
      {POLICY_GROUPS.map(group => (
        <div key={group.title} className="card p-5">
          <h4 className="font-semibold text-slate-700 mb-4">{group.title}</h4>
          <div className="grid grid-cols-2 gap-4">
            {group.keys.map(({ key, label, hint }) => (
              <div key={key}>
                <label className="label">{label}</label>
                <input
                  type="text"
                  value={form[key] ?? ''}
                  onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                  className="input"
                />
                {hint && <p className="text-xs text-slate-400 mt-0.5">{hint}</p>}
              </div>
            ))}
          </div>
        </div>
      ))}

      <button onClick={() => updateMutation.mutate(form)} disabled={updateMutation.isPending} className="btn-primary">
        {updateMutation.isPending ? 'Saving...' : 'Save All Policy Settings'}
      </button>
    </div>
  )
}

// ─── Audit Trail Tab ───────────────────────────────────────────────
function AuditTab() {
  const { selectedMonth, selectedYear } = useAppStore()
  const { toggle, isExpanded } = useExpandableRows()

  const { data: auditRes, isLoading } = useQuery({
    queryKey: ['audit-trail', selectedMonth, selectedYear],
    queryFn: () => getAuditTrail(selectedMonth, selectedYear),
    retry: 0
  })
  const audits = auditRes?.data?.data || []

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500">Audit trail of key actions for {selectedMonth}/{selectedYear}</p>
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table-compact w-full">
            <thead>
              <tr>
                <th>Date</th><th>User</th><th>Action</th><th>Details</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={4} className="text-center py-8 text-slate-400">Loading...</td></tr>
              ) : audits.length === 0 ? (
                <tr><td colSpan={4} className="text-center py-8 text-slate-400">No audit entries</td></tr>
              ) : audits.map((a, i) => (
                <React.Fragment key={a.id || i}>
                  <tr onClick={() => toggle(a.id || i)} className={clsx('cursor-pointer transition-colors hover:bg-blue-50/50', isExpanded(a.id || i) && 'bg-blue-50')}>
                    <td className="text-xs font-mono"><DrillDownChevron isExpanded={isExpanded(a.id || i)} /> {a.created_at?.replace('T', ' ').split('.')[0]}</td>
                    <td className="font-medium">{a.performed_by || '—'}</td>
                    <td>{a.action}</td>
                    <td className="text-sm text-slate-500 max-w-xs truncate">{a.details}</td>
                  </tr>
                  {isExpanded(a.id || i) && (
                    <DrillDownRow colSpan={4}>
                      <div className="space-y-3">
                        <div className="text-xs font-semibold text-slate-500">Full Audit Details</div>
                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                          <div className="bg-white rounded-lg border border-slate-100 px-3 py-2">
                            <div className="text-[10px] text-slate-400 uppercase">Timestamp</div>
                            <div className="text-xs font-medium text-slate-700 font-mono">{a.created_at?.replace('T', ' ').split('.')[0]}</div>
                          </div>
                          <div className="bg-white rounded-lg border border-slate-100 px-3 py-2">
                            <div className="text-[10px] text-slate-400 uppercase">Performed By</div>
                            <div className="text-xs font-medium text-slate-700">{a.performed_by || '—'}</div>
                          </div>
                          <div className="bg-white rounded-lg border border-slate-100 px-3 py-2">
                            <div className="text-[10px] text-slate-400 uppercase">Action</div>
                            <div className="text-xs font-medium text-blue-700">{a.action}</div>
                          </div>
                          {a.entity_type && (
                            <div className="bg-white rounded-lg border border-slate-100 px-3 py-2">
                              <div className="text-[10px] text-slate-400 uppercase">Entity</div>
                              <div className="text-xs font-medium text-slate-700">{a.entity_type} {a.entity_id ? `#${a.entity_id}` : ''}</div>
                            </div>
                          )}
                        </div>
                        {a.details && (
                          <div className="bg-white rounded-lg border border-slate-100 px-3 py-2">
                            <div className="text-[10px] text-slate-400 uppercase mb-1">Details</div>
                            <div className="text-xs text-slate-700 whitespace-pre-wrap">{a.details}</div>
                          </div>
                        )}
                        {(a.before_value || a.after_value) && (
                          <div className="grid grid-cols-2 gap-3">
                            {a.before_value && (
                              <div className="bg-red-50 rounded-lg border border-red-100 px-3 py-2">
                                <div className="text-[10px] text-red-400 uppercase mb-1">Before</div>
                                <div className="text-xs text-red-700 font-mono whitespace-pre-wrap">{typeof a.before_value === 'object' ? JSON.stringify(a.before_value, null, 2) : a.before_value}</div>
                              </div>
                            )}
                            {a.after_value && (
                              <div className="bg-green-50 rounded-lg border border-green-100 px-3 py-2">
                                <div className="text-[10px] text-green-400 uppercase mb-1">After</div>
                                <div className="text-xs text-green-700 font-mono whitespace-pre-wrap">{typeof a.after_value === 'object' ? JSON.stringify(a.after_value, null, 2) : a.after_value}</div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </DrillDownRow>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ─── Usage Logs Tab (Admin Only) ──────────────────────────────────
function UsageLogsTab() {
  const [page, setPage] = useState(1)
  const [filters, setFilters] = useState({ username: '', action: '', dateFrom: '', dateTo: '' })
  const { toggle, isExpanded } = useExpandableRows()

  const { data: logsRes, isLoading } = useQuery({
    queryKey: ['usage-logs', page, filters],
    queryFn: () => getUsageLogs({ page, limit: 50, ...filters }),
    retry: 0
  })
  const logs = logsRes?.data?.data || []
  const pagination = logsRes?.data?.pagination || {}

  const { data: summaryRes } = useQuery({
    queryKey: ['usage-logs-summary'],
    queryFn: getUsageLogsSummary,
    retry: 0
  })
  const summary = summaryRes?.data?.data || {}

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500">All API activity logs — admin only</p>

      {/* Summary Cards */}
      {summary.userSummary && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {summary.userSummary.slice(0, 4).map((u, i) => (
            <div key={i} className="card p-3">
              <div className="text-xl font-bold text-slate-800">{u.total_actions}</div>
              <div className="text-xs text-slate-500">{u.username} ({u.role})</div>
              <div className="text-xs text-slate-400 mt-0.5">Last: {u.last_active?.split('T')[0]}</div>
            </div>
          ))}
        </div>
      )}

      {/* Feature usage */}
      {summary.featureUsage && summary.featureUsage.length > 0 && (
        <div className="card p-4">
          <h4 className="text-sm font-bold text-slate-600 mb-2">Top Features</h4>
          <div className="flex flex-wrap gap-2">
            {summary.featureUsage.slice(0, 10).map((f, i) => (
              <span key={i} className="bg-slate-100 text-xs px-3 py-1.5 rounded-full font-mono">
                {f.path} <span className="font-bold text-blue-600">{f.count}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-3 items-end">
        <div>
          <label className="label">User</label>
          <input type="text" value={filters.username} onChange={e => setFilters(f => ({ ...f, username: e.target.value }))}
            className="input text-sm w-32" placeholder="username" />
        </div>
        <div>
          <label className="label">Action</label>
          <select value={filters.action} onChange={e => setFilters(f => ({ ...f, action: e.target.value }))} className="select text-sm w-28">
            <option value="">All</option>
            <option value="GET">GET</option>
            <option value="POST">POST</option>
            <option value="PUT">PUT</option>
            <option value="DELETE">DELETE</option>
          </select>
        </div>
        <div>
          <label className="label">From</label>
          <input type="date" value={filters.dateFrom} onChange={e => setFilters(f => ({ ...f, dateFrom: e.target.value }))} className="input text-sm" />
        </div>
        <div>
          <label className="label">To</label>
          <input type="date" value={filters.dateTo} onChange={e => setFilters(f => ({ ...f, dateTo: e.target.value }))} className="input text-sm" />
        </div>
        <button onClick={() => setPage(1)} className="btn-secondary text-sm">Filter</button>
      </div>

      {/* Logs Table */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table-compact w-full">
            <thead>
              <tr>
                <th>Time</th><th>User</th><th>Role</th>
                <th>Method</th><th>Path</th><th>IP</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={6} className="text-center py-8 text-slate-400">Loading logs...</td></tr>
              ) : logs.length === 0 ? (
                <tr><td colSpan={6} className="text-center py-8 text-slate-400">No logs found</td></tr>
              ) : logs.map((l, i) => (
                <React.Fragment key={l.id || i}>
                  <tr onClick={() => toggle(l.id || i)} className={clsx('cursor-pointer transition-colors hover:bg-blue-50/50', isExpanded(l.id || i) && 'bg-blue-50')}>
                    <td className="text-xs font-mono whitespace-nowrap"><DrillDownChevron isExpanded={isExpanded(l.id || i)} /> {l.created_at?.replace('T', ' ').split('.')[0]}</td>
                    <td className="font-medium text-sm">{l.username}</td>
                    <td><span className={clsx('text-xs px-2 py-0.5 rounded-full',
                      l.role === 'admin' ? 'bg-purple-100 text-purple-700' : l.role === 'hr' ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-600'
                    )}>{l.role}</span></td>
                    <td><span className={clsx('text-xs font-mono font-bold',
                      l.method === 'GET' ? 'text-green-600' : l.method === 'POST' ? 'text-blue-600' : l.method === 'PUT' ? 'text-amber-600' : 'text-red-600'
                    )}>{l.method}</span></td>
                    <td className="font-mono text-xs text-slate-500 max-w-xs truncate">{l.path}</td>
                    <td className="text-xs text-slate-400">{l.ip_address}</td>
                  </tr>
                  {isExpanded(l.id || i) && (
                    <DrillDownRow colSpan={6}>
                      <div className="space-y-3">
                        <div className="text-xs font-semibold text-slate-500">Request Details</div>
                        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                          <div className="bg-white rounded-lg border border-slate-100 px-3 py-2">
                            <div className="text-[10px] text-slate-400 uppercase">Method</div>
                            <div className={clsx('text-sm font-bold font-mono',
                              l.method === 'GET' ? 'text-green-600' : l.method === 'POST' ? 'text-blue-600' : l.method === 'PUT' ? 'text-amber-600' : 'text-red-600'
                            )}>{l.method}</div>
                          </div>
                          <div className="bg-white rounded-lg border border-slate-100 px-3 py-2">
                            <div className="text-[10px] text-slate-400 uppercase">Path</div>
                            <div className="text-xs font-medium text-slate-700 font-mono break-all">{l.path}</div>
                          </div>
                          <div className="bg-white rounded-lg border border-slate-100 px-3 py-2">
                            <div className="text-[10px] text-slate-400 uppercase">Status</div>
                            <div className={clsx('text-sm font-bold',
                              l.status_code >= 200 && l.status_code < 300 ? 'text-green-600' :
                              l.status_code >= 400 ? 'text-red-600' : 'text-slate-700'
                            )}>{l.status_code || '—'}</div>
                          </div>
                          <div className="bg-white rounded-lg border border-slate-100 px-3 py-2">
                            <div className="text-[10px] text-slate-400 uppercase">User</div>
                            <div className="text-xs font-medium text-slate-700">{l.username} ({l.role})</div>
                          </div>
                          <div className="bg-white rounded-lg border border-slate-100 px-3 py-2">
                            <div className="text-[10px] text-slate-400 uppercase">IP Address</div>
                            <div className="text-xs font-medium text-slate-700 font-mono">{l.ip_address || '—'}</div>
                          </div>
                          {l.response_time != null && (
                            <div className="bg-white rounded-lg border border-slate-100 px-3 py-2">
                              <div className="text-[10px] text-slate-400 uppercase">Response Time</div>
                              <div className="text-xs font-medium text-slate-700">{l.response_time}ms</div>
                            </div>
                          )}
                          <div className="bg-white rounded-lg border border-slate-100 px-3 py-2">
                            <div className="text-[10px] text-slate-400 uppercase">Timestamp</div>
                            <div className="text-xs font-medium text-slate-700 font-mono">{l.created_at?.replace('T', ' ').split('.')[0]}</div>
                          </div>
                          {l.user_agent && (
                            <div className="bg-white rounded-lg border border-slate-100 px-3 py-2 col-span-2">
                              <div className="text-[10px] text-slate-400 uppercase">User Agent</div>
                              <div className="text-xs text-slate-600 truncate">{l.user_agent}</div>
                            </div>
                          )}
                        </div>
                      </div>
                    </DrillDownRow>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      {pagination.totalPages > 1 && (
        <div className="flex justify-center gap-2 items-center">
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1} className="btn-secondary text-sm">Prev</button>
          <span className="text-sm text-slate-500">Page {page} of {pagination.totalPages} ({pagination.total} entries)</span>
          <button onClick={() => setPage(p => Math.min(pagination.totalPages, p + 1))} disabled={page >= pagination.totalPages} className="btn-secondary text-sm">Next</button>
        </div>
      )}
    </div>
  )
}

// ─── User Management Tab (Admin Only) ──────────────────────────────
function UserManagementTab() {
  const qc = useQueryClient()
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState({ username: '', password: '', role: 'viewer', allowedCompanies: ['*'] })
  // Edit-user modal state. `editing` holds the row being edited (null = closed).
  // Password is optional in edit — only sent if the admin types a new one,
  // matching the partial-update behaviour of PUT /api/auth/users/:id.
  const [editing, setEditing] = useState(null)
  const [editForm, setEditForm] = useState({ role: 'viewer', allowedCompanies: ['*'], password: '' })

  const { data: usersRes, isLoading } = useQuery({
    queryKey: ['users'],
    queryFn: getUsers,
    retry: 0
  })
  const users = usersRes?.data?.data || []

  const createMutation = useMutation({
    mutationFn: (d) => createUser(d),
    onSuccess: () => {
      toast.success('User created')
      qc.invalidateQueries(['users'])
      setShowCreate(false)
      setForm({ username: '', password: '', role: 'viewer', allowedCompanies: ['*'] })
    }
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }) => updateUser(id, payload),
    onSuccess: () => {
      toast.success('User updated')
      qc.invalidateQueries(['users'])
      setEditing(null)
      setEditForm({ role: 'viewer', allowedCompanies: ['*'], password: '' })
    },
    onError: (e) => toast.error(e?.response?.data?.error || 'Update failed')
  })

  const openEdit = (u) => {
    setEditing(u)
    setEditForm({
      role: u.role || 'viewer',
      allowedCompanies: u.allowedCompanies || ['*'],
      password: ''
    })
  }
  const submitEdit = () => {
    if (!editing) return
    const payload = {
      role: editForm.role,
      allowedCompanies: editForm.allowedCompanies,
    }
    if (editForm.password && editForm.password.length >= 6) payload.password = editForm.password
    updateMutation.mutate({ id: editing.id, payload })
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-slate-500">Manage system users and their roles</p>
        <button onClick={() => setShowCreate(!showCreate)} className="btn-primary text-sm">+ Add User</button>
      </div>

      {showCreate && (
        <div className="card p-5">
          <h4 className="font-semibold text-slate-700 mb-3">Create New User</h4>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="label">Username</label>
              <input type="text" value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))} className="input" placeholder="johndoe" />
            </div>
            <div>
              <label className="label">Password</label>
              <input type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} className="input" placeholder="Min 6 characters" />
            </div>
            <div>
              <label className="label">Role</label>
              <select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))} className="select">
                <option value="viewer">Viewer (Read Only)</option>
                <option value="employee">Employee (Self-service portal)</option>
                <option value="supervisor">Supervisor</option>
                <option value="hr">HR (Payroll + Employee Master)</option>
                <option value="finance">Finance (Audit, Verify, Approvals)</option>
                <option value="admin">Admin (Full Access)</option>
              </select>
            </div>
            <div>
              <label className="label">Company Access</label>
              <select
                value={form.allowedCompanies?.includes('*') ? '*' : form.allowedCompanies?.join(',') || '*'}
                onChange={e => {
                  const v = e.target.value
                  setForm(f => ({ ...f, allowedCompanies: v === '*' ? ['*'] : v.split(',') }))
                }}
                className="select"
              >
                <option value="*">All Companies</option>
                <option value="Indriyan Beverages Pvt Ltd">Indriyan Beverages Only</option>
                <option value="Asian Lakto Ind Ltd">Asian Lakto Only</option>
                <option value="Indriyan Beverages Pvt Ltd,Asian Lakto Ind Ltd">Both (Explicit)</option>
              </select>
            </div>
          </div>
          <div className="mt-3 text-xs text-slate-400">
            <strong>Roles:</strong> Viewer = read only | Employee = self-service portal | Supervisor = team dashboards | HR = payroll & employee master | Finance = salary review, extra-duty / gross-salary / miss-punch approval, held-salary release | Admin = full access
          </div>
          <div className="flex gap-2 mt-3">
            <button onClick={() => createMutation.mutate(form)} disabled={!form.username || !form.password || createMutation.isPending} className="btn-primary text-sm">
              {createMutation.isPending ? 'Creating...' : 'Create User'}
            </button>
            <button onClick={() => setShowCreate(false)} className="btn-secondary text-sm">Cancel</button>
          </div>
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table-compact w-full">
            <thead>
              <tr>
                <th>ID</th><th>Username</th><th>Role</th><th>Companies</th><th>Created</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={6} className="text-center py-8 text-slate-400">Loading...</td></tr>
              ) : users.length === 0 ? (
                <tr><td colSpan={6} className="text-center py-8 text-slate-400">No users found</td></tr>
              ) : users.map(u => (
                <tr key={u.id}>
                  <td className="text-slate-400">{u.id}</td>
                  <td className="font-medium">{u.username}</td>
                  <td>
                    <span className={clsx('text-xs px-2 py-0.5 rounded-full font-medium',
                      u.role === 'admin' ? 'bg-purple-100 text-purple-700' :
                      u.role === 'finance' ? 'bg-green-100 text-green-700' :
                      u.role === 'hr' ? 'bg-blue-100 text-blue-700' :
                      u.role === 'supervisor' ? 'bg-amber-100 text-amber-700' :
                      u.role === 'employee' ? 'bg-cyan-100 text-cyan-700' :
                      'bg-slate-100 text-slate-600'
                    )}>{u.role}</span>
                  </td>
                  <td className="text-xs">
                    {u.allowedCompanies?.includes('*')
                      ? <span className="text-green-600">All</span>
                      : (u.allowedCompanies || []).map(c => <div key={c} className="text-slate-600">{c.replace(' Pvt Ltd', '').replace(' Ind Ltd', '')}</div>)
                    }
                  </td>
                  <td className="text-slate-400 text-sm">{u.created_at?.split('T')[0] || '—'}</td>
                  <td>
                    <button onClick={() => openEdit(u)} className="text-blue-600 hover:bg-blue-50 px-2 py-1 rounded text-xs font-medium">Edit</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Edit User modal (April 2026) ───────────────────────
          Wired to PUT /api/auth/users/:id which already supports
          partial updates and runs normalizeRole() on the incoming
          role. Lets the admin fix any role typo (or change company
          access / reset a password) without needing a code change
          or direct DB access. */}
      {editing && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setEditing(null)}>
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-5" onClick={e => e.stopPropagation()}>
            <h4 className="font-semibold text-slate-700 mb-1">Edit User</h4>
            <p className="text-xs text-slate-400 mb-4">Updating <strong>{editing.username}</strong> (id {editing.id}).</p>
            <div className="space-y-3">
              <div>
                <label className="label">Role</label>
                <select value={editForm.role} onChange={e => setEditForm(f => ({ ...f, role: e.target.value }))} className="select">
                  <option value="viewer">Viewer (Read Only)</option>
                  <option value="employee">Employee (Self-service portal)</option>
                  <option value="supervisor">Supervisor</option>
                  <option value="hr">HR (Payroll + Employee Master)</option>
                  <option value="finance">Finance (Audit, Verify, Approvals)</option>
                  <option value="admin">Admin (Full Access)</option>
                </select>
              </div>
              <div>
                <label className="label">Company Access</label>
                <select
                  value={editForm.allowedCompanies?.includes('*') ? '*' : editForm.allowedCompanies?.join(',') || '*'}
                  onChange={e => {
                    const v = e.target.value
                    setEditForm(f => ({ ...f, allowedCompanies: v === '*' ? ['*'] : v.split(',') }))
                  }}
                  className="select"
                >
                  <option value="*">All Companies</option>
                  <option value="Indriyan Beverages Pvt Ltd">Indriyan Beverages Only</option>
                  <option value="Asian Lakto Ind Ltd">Asian Lakto Only</option>
                  <option value="Indriyan Beverages Pvt Ltd,Asian Lakto Ind Ltd">Both (Explicit)</option>
                </select>
              </div>
              <div>
                <label className="label">New Password (optional)</label>
                <input
                  type="password"
                  value={editForm.password}
                  onChange={e => setEditForm(f => ({ ...f, password: e.target.value }))}
                  className="input"
                  placeholder="Leave blank to keep current password"
                />
                <div className="text-[10px] text-slate-400 mt-1">Min 6 characters if changing.</div>
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={submitEdit} disabled={updateMutation.isPending} className="btn-primary text-sm flex-1">
                {updateMutation.isPending ? 'Saving...' : 'Save Changes'}
              </button>
              <button onClick={() => setEditing(null)} className="btn-secondary text-sm">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Main Settings Component with Routes ────────────────────────────
const SETTINGS_TABS = [
  { id: 'shifts', label: '🕐 Shifts', path: '/settings/shifts' },
  { id: 'holidays', label: '📅 Holidays', path: '/settings/holidays' },
  { id: 'policy', label: '⚙️ Policy', path: '/settings/policy' },
  { id: 'audit', label: '📋 Audit Trail', path: '/settings/audit' },
  { id: 'usage-logs', label: '📊 Usage Logs', path: '/settings/usage-logs', adminOnly: true },
  { id: 'users', label: '👥 Users', path: '/settings/users', adminOnly: true },
]

export default function Settings() {
  const { user } = useAppStore()
  const userRole = user?.role || 'viewer'

  // Block non-admin users entirely
  if (userRole !== 'admin') {
    return (
      <div className="p-4 md:p-6 flex items-center justify-center min-h-[50vh]">
        <div className="text-center">
          <div className="text-4xl mb-3">🔒</div>
          <h2 className="text-lg font-semibold text-slate-700">Admin Access Required</h2>
          <p className="text-sm text-slate-500 mt-1">Settings can only be modified by administrators.</p>
        </div>
      </div>
    )
  }

  const visibleTabs = SETTINGS_TABS.filter(t => !t.adminOnly || userRole === 'admin')

  return (
    <div className="p-4 md:p-6 space-y-6 animate-fade-in">
      <div>
        <h2 className="section-title">Settings</h2>
        <p className="section-subtitle mt-1">Shift master, holidays, salary policy, and system configuration</p>
      </div>

      <div className="border-b border-slate-200 flex gap-0 overflow-x-auto">
        {visibleTabs.map(t => (
          <NavLink key={t.id} to={t.path}
            className={({ isActive }) => clsx('px-5 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap',
              isActive ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'
            )}>{t.label}</NavLink>
        ))}
      </div>

      <Routes>
        <Route index element={<Navigate to="shifts" replace />} />
        <Route path="shifts" element={<ShiftsTab />} />
        <Route path="holidays" element={<HolidaysTab />} />
        <Route path="policy" element={<PolicyTab />} />
        <Route path="audit" element={<AuditTab />} />
        <Route path="usage-logs" element={<UsageLogsTab />} />
        <Route path="users" element={<UserManagementTab />} />
      </Routes>
    </div>
  )
}
