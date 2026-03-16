import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { getShifts, createShift, updateShift, getHolidays, createHoliday, deleteHoliday, getPolicyConfig, updatePolicyConfig } from '../utils/api'
import { useAppStore } from '../store/appStore'

const MONTH_NAMES = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

// ─── Shift Tab ─────────────────────────────────────────────────────
function ShiftsTab() {
  const qc = useQueryClient()
  const [editId, setEditId] = useState(null)
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState({
    name: '', code: '', startTime: '09:00', endTime: '18:00',
    graceMinutes: 15, isOvernight: false, breakMinutes: 30,
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
    setForm({ name: '', code: '', startTime: '09:00', endTime: '18:00', graceMinutes: 15, isOvernight: false, breakMinutes: 30, minHoursFullDay: 8, minHoursHalfDay: 4 })
  }
  function startEdit(shift) {
    setEditId(shift.id)
    setForm({
      name: shift.name, code: shift.code, startTime: shift.start_time, endTime: shift.end_time,
      graceMinutes: shift.grace_minutes, isOvernight: !!shift.is_overnight, breakMinutes: shift.break_minutes || 0,
      minHoursFullDay: shift.min_hours_full_day, minHoursHalfDay: shift.min_hours_half_day
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-slate-500">Configure shift timings, grace periods, and minimum hours</p>
        <button onClick={() => setShowCreate(true)} className="btn-primary text-sm">+ Add Shift</button>
      </div>

      <div className="card overflow-hidden">
        <table className="table-compact w-full">
          <thead>
            <tr>
              <th>Code</th><th>Name</th><th>Start</th><th>End</th>
              <th className="text-center">Grace (min)</th>
              <th className="text-center">Break (min)</th>
              <th className="text-center">Min Full Day (h)</th>
              <th className="text-center">Min Half Day (h)</th>
              <th className="text-center">Overnight</th>
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

      {/* Create/Edit Form */}
      {(showCreate || editId) && (
        <div className="card p-5">
          <h4 className="font-semibold text-slate-700 mb-4">{editId ? 'Edit Shift' : 'New Shift'}</h4>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="label">Shift Name</label>
              <input type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="input" placeholder="Day Shift" />
            </div>
            <div>
              <label className="label">Code</label>
              <input type="text" value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value.toUpperCase() }))} className="input font-mono" placeholder="DAY" disabled={!!editId} />
            </div>
            <div>
              <label className="label">Start Time</label>
              <input type="time" value={form.startTime} onChange={e => setForm(f => ({ ...f, startTime: e.target.value }))} className="input" />
            </div>
            <div>
              <label className="label">End Time</label>
              <input type="time" value={form.endTime} onChange={e => setForm(f => ({ ...f, endTime: e.target.value }))} className="input" />
            </div>
            <div>
              <label className="label">Grace Period (min)</label>
              <input type="number" value={form.graceMinutes} onChange={e => setForm(f => ({ ...f, graceMinutes: parseInt(e.target.value) }))} className="input" min="0" max="120" />
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
            <div className="flex items-end pb-1">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={form.isOvernight} onChange={e => setForm(f => ({ ...f, isOvernight: e.target.checked }))} className="rounded" />
                Overnight Shift
              </label>
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
      {/* Add Holiday Form */}
      <div className="card p-4">
        <h4 className="font-semibold text-slate-700 mb-3">Add Holiday</h4>
        <div className="grid grid-cols-5 gap-3">
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

// ─── Main Component ────────────────────────────────────────────────
export default function Settings() {
  const [activeTab, setActiveTab] = useState('shifts')

  const TABS = [
    { id: 'shifts', label: '🕐 Shifts' },
    { id: 'holidays', label: '📅 Holidays' },
    { id: 'policy', label: '⚙️ Policy Config' }
  ]

  return (
    <div className="p-6 space-y-6">
      <div>
        <h2 className="text-lg font-bold text-slate-800">Settings</h2>
        <p className="text-sm text-slate-500">Shift master, holidays, and salary policy configuration</p>
      </div>

      {/* Tabs */}
      <div className="border-b border-slate-200 flex gap-0">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              activeTab === t.id ? 'border-brand-600 text-brand-600' : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === 'shifts' && <ShiftsTab />}
      {activeTab === 'holidays' && <HolidaysTab />}
      {activeTab === 'policy' && <PolicyTab />}
    </div>
  )
}
