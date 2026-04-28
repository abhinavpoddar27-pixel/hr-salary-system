import React, { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import clsx from 'clsx'
import {
  salesHolidaysList,
  salesHolidayCreate,
  salesHolidayUpdate,
  salesHolidayDelete,
} from '../../utils/api'
import { useAppStore } from '../../store/appStore'
import { isAdmin } from '../../utils/role'
import Modal from '../../components/ui/Modal'
import ConfirmDialog from '../../components/ui/ConfirmDialog'
import CompanyFilter from '../../components/shared/CompanyFilter'

// Common Indian state abbreviations — expand as HR requests. "All" (empty array
// or null) is the default, meaning the holiday applies to every state.
const STATE_OPTIONS = [
  'Punjab', 'Haryana', 'Delhi', 'Uttar Pradesh', 'Uttarakhand', 'Himachal Pradesh',
  'Rajasthan', 'Gujarat', 'Maharashtra', 'Karnataka', 'Tamil Nadu', 'Kerala',
  'West Bengal', 'Bihar', 'Jharkhand', 'Madhya Pradesh', 'Chhattisgarh', 'Odisha',
  'Andhra Pradesh', 'Telangana', 'Assam', 'Jammu and Kashmir', 'Goa',
]

function parseStates(raw) {
  if (!raw) return []
  if (Array.isArray(raw)) return raw
  try { return JSON.parse(raw) } catch { return [] }
}

function statesLabel(raw) {
  const arr = parseStates(raw)
  if (!arr || arr.length === 0) return 'All'
  if (arr.length <= 2) return arr.join(', ')
  return `${arr.length} states`
}

function HolidayForm({ initial, isEdit, company, onSubmit, onCancel, submitting }) {
  const [form, setForm] = useState(() => ({
    holiday_date: initial?.holiday_date || '',
    holiday_name: initial?.holiday_name || '',
    applicable_states: parseStates(initial?.applicable_states),
    is_gazetted: initial?.is_gazetted ?? 1,
  }))
  const [errors, setErrors] = useState({})

  const set = (k, v) => setForm(prev => ({ ...prev, [k]: v }))

  const toggleState = (s) => {
    setForm(prev => {
      const arr = prev.applicable_states.includes(s)
        ? prev.applicable_states.filter(x => x !== s)
        : [...prev.applicable_states, s]
      return { ...prev, applicable_states: arr }
    })
  }

  const setAll = () => setForm(prev => ({ ...prev, applicable_states: [] }))

  const validate = () => {
    const errs = {}
    if (!isEdit && !form.holiday_date) errs.holiday_date = 'Required'
    if (!form.holiday_name?.trim()) errs.holiday_name = 'Required'
    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!validate()) { toast.error('Please fill required fields'); return }
    const payload = {
      holiday_name: form.holiday_name.trim(),
      applicable_states: form.applicable_states,  // empty array → backend stores NULL = "all"
      is_gazetted: form.is_gazetted ? 1 : 0,
    }
    if (!isEdit) {
      payload.holiday_date = form.holiday_date
      payload.company = company
    }
    onSubmit(payload)
  }

  const lbl = (t) => <span className="block text-xs font-medium text-slate-600 mb-1">{t}</span>

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          {lbl('Date *')}
          <input type="date" disabled={isEdit} value={form.holiday_date}
            onChange={e => set('holiday_date', e.target.value)}
            className={clsx('w-full border rounded-lg px-2 py-1.5 text-sm',
              errors.holiday_date ? 'border-red-400' : 'border-slate-300',
              isEdit && 'bg-slate-100')} />
          {errors.holiday_date && <p className="text-xs text-red-600 mt-1">{errors.holiday_date}</p>}
        </div>
        <div>
          {lbl('Company')}
          <input disabled value={company} className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm bg-slate-100" />
        </div>
      </div>

      <div>
        {lbl('Holiday Name *')}
        <input value={form.holiday_name} onChange={e => set('holiday_name', e.target.value)}
          className={clsx('w-full border rounded-lg px-2 py-1.5 text-sm',
            errors.holiday_name ? 'border-red-400' : 'border-slate-300')} />
        {errors.holiday_name && <p className="text-xs text-red-600 mt-1">{errors.holiday_name}</p>}
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-slate-600">Applicable States</span>
          <button type="button" onClick={setAll}
            className="text-xs text-blue-600 hover:underline">
            Set to All (clear list)
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5 p-2 border border-slate-200 rounded-lg bg-slate-50 max-h-40 overflow-y-auto">
          {form.applicable_states.length === 0 ? (
            <span className="text-xs text-slate-500 italic">All states (default — no restriction)</span>
          ) : null}
          {STATE_OPTIONS.map(s => {
            const on = form.applicable_states.includes(s)
            return (
              <button key={s} type="button" onClick={() => toggleState(s)}
                className={clsx('px-2 py-0.5 rounded-full text-xs border transition',
                  on ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white border-slate-300 text-slate-600 hover:border-blue-400')}>
                {s}
              </button>
            )
          })}
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" checked={!!form.is_gazetted}
          onChange={e => set('is_gazetted', e.target.checked ? 1 : 0)} />
        Gazetted holiday
      </label>

      <div className="flex justify-end gap-2 pt-2 border-t">
        <button type="button" onClick={onCancel}
          className="px-3 py-1.5 text-sm rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700">
          Cancel
        </button>
        <button type="submit" disabled={submitting}
          className="px-4 py-1.5 text-sm rounded-lg bg-blue-600 hover:bg-blue-700 text-white disabled:bg-slate-400">
          {submitting ? 'Saving…' : (isEdit ? 'Save changes' : 'Add Holiday')}
        </button>
      </div>
    </form>
  )
}

export default function SalesHolidayMaster() {
  const qc = useQueryClient()
  const { selectedCompany, user } = useAppStore()
  // Phase 4 fix A: holiday writes are admin-only — adding/editing/deleting
  // a holiday changes total_days for every active sales employee in the
  // affected cycle, so HR can read but not write.
  const admin = isAdmin(user)

  const [year, setYear] = useState(new Date().getFullYear())
  const [modalMode, setModalMode] = useState(null) // 'create' | 'edit'
  const [editing, setEditing] = useState(null)
  const [confirmDel, setConfirmDel] = useState(null)

  const { data: res, isLoading } = useQuery({
    queryKey: ['sales-holidays', selectedCompany, year],
    queryFn: () => salesHolidaysList({ company: selectedCompany, year }),
    enabled: !!selectedCompany,
    retry: 0,
  })
  const rows = res?.data?.data || []

  const createMut = useMutation({
    mutationFn: (data) => salesHolidayCreate(data),
    onSuccess: () => {
      toast.success('Sales holiday added')
      qc.invalidateQueries({ queryKey: ['sales-holidays'] })
      setModalMode(null); setEditing(null)
    },
    onError: (err) => toast.error(err?.response?.data?.error || 'Create failed'),
  })

  const updateMut = useMutation({
    mutationFn: ({ id, data }) => salesHolidayUpdate(id, data),
    onSuccess: () => {
      toast.success('Sales holiday updated')
      qc.invalidateQueries({ queryKey: ['sales-holidays'] })
      setModalMode(null); setEditing(null)
    },
    onError: (err) => toast.error(err?.response?.data?.error || 'Update failed'),
  })

  const deleteMut = useMutation({
    mutationFn: (id) => salesHolidayDelete(id),
    onSuccess: () => {
      toast.success('Sales holiday deleted')
      qc.invalidateQueries({ queryKey: ['sales-holidays'] })
      setConfirmDel(null)
    },
    onError: (err) => toast.error(err?.response?.data?.error || 'Delete failed'),
  })

  const openCreate = () => { setEditing(null); setModalMode('create') }
  const openEdit = (row) => { setEditing(row); setModalMode('edit') }

  const yearOpts = useMemo(() => {
    const y = new Date().getFullYear()
    return [y - 1, y, y + 1, y + 2]
  }, [])

  const handleSubmit = (payload) => {
    if (modalMode === 'edit') {
      updateMut.mutate({ id: editing.id, data: payload })
    } else {
      createMut.mutate(payload)
    }
  }

  if (!selectedCompany) {
    return (
      <div className="p-4 md:p-6">
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-800">
          Please select a company from the header to manage sales holidays.
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Sales Holidays</h1>
          <p className="text-xs text-slate-500">Holiday calendar scoped per-company. Used by Phase 3 salary compute.</p>
        </div>
        <div className="flex items-center gap-2">
          <CompanyFilter />
          <select value={year} onChange={e => setYear(parseInt(e.target.value, 10))}
            className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm bg-white">
            {yearOpts.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          {admin && (
            <button onClick={openCreate}
              className="px-3 py-1.5 text-sm rounded-lg bg-blue-600 hover:bg-blue-700 text-white">
              + Add Holiday
            </button>
          )}
        </div>
      </div>

      {!admin && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-800">
          Holiday changes are admin-only. Contact admin to add, edit, or delete sales holidays.
        </div>
      )}

      <div className="bg-white rounded-lg border border-slate-200 overflow-x-auto">
        <table className="min-w-[700px] w-full text-sm">
          <thead className="bg-slate-50 text-slate-600 text-xs uppercase">
            <tr>
              <th className="px-3 py-2 text-left">Date</th>
              <th className="px-3 py-2 text-left">Name</th>
              <th className="px-3 py-2 text-left">States</th>
              <th className="px-3 py-2 text-left">Gazetted</th>
              <th className="px-3 py-2 text-left">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={5} className="px-3 py-4 text-center text-slate-400 text-xs">Loading…</td></tr>
            )}
            {!isLoading && rows.length === 0 && (
              <tr><td colSpan={5} className="px-3 py-8 text-center text-slate-400 text-sm">
                No sales holidays for {selectedCompany} in {year}.
              </td></tr>
            )}
            {rows.map(r => (
              <tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="px-3 py-2 font-mono text-xs">{r.holiday_date}</td>
                <td className="px-3 py-2 font-medium text-slate-800">{r.holiday_name}</td>
                <td className="px-3 py-2 text-slate-600">
                  <span className={clsx('text-xs px-2 py-0.5 rounded',
                    parseStates(r.applicable_states).length === 0
                      ? 'bg-blue-50 text-blue-700' : 'bg-slate-100 text-slate-600')}>
                    {statesLabel(r.applicable_states)}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <span className={clsx('text-xs px-2 py-0.5 rounded font-medium',
                    r.is_gazetted ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-600')}>
                    {r.is_gazetted ? 'Gazetted' : 'Restricted'}
                  </span>
                </td>
                <td className="px-3 py-2">
                  {admin ? (
                    <div className="flex gap-2 text-xs">
                      <button onClick={() => openEdit(r)} className="text-blue-600 hover:text-blue-800">Edit</button>
                      <button onClick={() => setConfirmDel(r)} className="text-red-600 hover:text-red-800">Delete</button>
                    </div>
                  ) : (
                    <span className="text-xs text-slate-400">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modalMode && (
        <Modal open onClose={() => { setModalMode(null); setEditing(null) }}
          title={modalMode === 'edit' ? `Edit holiday — ${editing?.holiday_date}` : 'Add sales holiday'}
          size="md">
          <HolidayForm
            initial={editing} isEdit={modalMode === 'edit'}
            company={selectedCompany}
            onSubmit={handleSubmit}
            onCancel={() => { setModalMode(null); setEditing(null) }}
            submitting={createMut.isPending || updateMut.isPending}
          />
        </Modal>
      )}

      {confirmDel && (
        <ConfirmDialog
          title={`Delete ${confirmDel.holiday_date}?`}
          message={`Delete "${confirmDel.holiday_name}" for ${confirmDel.company}? This is a hard delete — Phase 3 compute will no longer credit this holiday.`}
          confirmText="Delete"
          cancelText="Cancel"
          onCancel={() => setConfirmDel(null)}
          onConfirm={() => deleteMut.mutate(confirmDel.id)}
        />
      )}
    </div>
  )
}
