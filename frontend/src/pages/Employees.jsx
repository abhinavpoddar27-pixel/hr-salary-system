import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { getEmployees, getEmployee, updateEmployee, updateSalaryStructure, getLeaveBalances, updateLeaveBalance } from '../utils/api'
import { fmtINR } from '../utils/formatters'
import { useAppStore } from '../store/appStore'

function SalaryModal({ employee, onClose }) {
  const qc = useQueryClient()
  const { selectedYear } = useAppStore()

  const { data: empRes } = useQuery({
    queryKey: ['employee-detail', employee.code],
    queryFn: () => getEmployee(employee.code),
    retry: 0
  })
  const emp = empRes?.data?.data || employee

  const [form, setForm] = useState({
    gross_salary: emp.gross_salary || emp.salary_structures?.gross_salary || '',
    basic_percent: emp.salary_structures?.basic_percent || 50,
    hra_percent: emp.salary_structures?.hra_percent || 20,
    da_percent: emp.salary_structures?.da_percent || 0,
    special_allowance_percent: emp.salary_structures?.special_allowance_percent || 0,
    other_allowance: emp.salary_structures?.other_allowance || 0,
    pf_applicable: emp.salary_structures?.pf_applicable ?? 1,
    esi_applicable: emp.salary_structures?.esi_applicable ?? 1,
    pt_applicable: emp.salary_structures?.pt_applicable ?? 1,
    pf_wage_ceiling: emp.salary_structures?.pf_wage_ceiling || 15000,
    uan: emp.uan || '',
    esi_number: emp.esi_number || '',
    account_number: emp.account_number || '',
    bank_name: emp.bank_name || '',
    ifsc_code: emp.ifsc_code || ''
  })

  const updateMutation = useMutation({
    mutationFn: (data) => updateSalaryStructure(employee.code, data),
    onSuccess: () => { toast.success('Salary structure saved'); qc.invalidateQueries(['employee-detail', employee.code]); onClose() }
  })

  const gross = parseFloat(form.gross_salary) || 0
  const basic = (gross * (form.basic_percent / 100)).toFixed(2)
  const hra = (gross * (form.hra_percent / 100)).toFixed(2)
  const da = (gross * (form.da_percent / 100)).toFixed(2)
  const special = (gross * (form.special_allowance_percent / 100)).toFixed(2)
  const other = parseFloat(form.other_allowance || 0)
  const total = (parseFloat(basic) + parseFloat(hra) + parseFloat(da) + parseFloat(special) + other).toFixed(2)

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="p-5 border-b">
          <h3 className="font-bold text-slate-800">Salary Structure — {emp.name}</h3>
          <p className="text-xs text-slate-500">{emp.code} · {emp.department}</p>
        </div>
        <div className="p-5 space-y-4">
          {/* Gross salary */}
          <div>
            <label className="label">Gross Monthly Salary (₹)</label>
            <input type="number" value={form.gross_salary} onChange={e => setForm(f => ({ ...f, gross_salary: e.target.value }))} className="input text-lg font-bold" placeholder="0" />
          </div>

          {/* Breakdown */}
          <div className="grid grid-cols-2 gap-3">
            {[
              { key: 'basic_percent', label: 'Basic %' },
              { key: 'hra_percent', label: 'HRA %' },
              { key: 'da_percent', label: 'DA %' },
              { key: 'special_allowance_percent', label: 'Special Allowance %' }
            ].map(f => (
              <div key={f.key}>
                <label className="label">{f.label}</label>
                <input type="number" value={form[f.key]} onChange={e => setForm(prev => ({ ...prev, [f.key]: e.target.value }))} className="input" min="0" max="100" />
              </div>
            ))}
            <div>
              <label className="label">Other Allowance (₹)</label>
              <input type="number" value={form.other_allowance} onChange={e => setForm(f => ({ ...f, other_allowance: e.target.value }))} className="input" />
            </div>
            <div>
              <label className="label">PF Wage Ceiling (₹)</label>
              <input type="number" value={form.pf_wage_ceiling} onChange={e => setForm(f => ({ ...f, pf_wage_ceiling: e.target.value }))} className="input" />
            </div>
          </div>

          {/* Preview */}
          <div className="bg-slate-50 rounded-lg p-3 text-sm">
            <div className="font-semibold text-slate-600 mb-2">Structure Preview</div>
            <div className="grid grid-cols-2 gap-1.5 text-xs">
              {[['Basic', basic], ['HRA', hra], ['DA', da], ['Special Allow.', special], ['Other Allow.', other]].map(([k, v]) => (
                <div key={k} className="flex justify-between">
                  <span className="text-slate-500">{k}</span>
                  <span className="font-medium">{fmtINR(parseFloat(v))}</span>
                </div>
              ))}
              <div className="flex justify-between col-span-2 border-t pt-1 font-bold">
                <span>Total</span>
                <span className={Math.abs(parseFloat(total) - gross) > 0.5 ? 'text-red-500' : 'text-green-600'}>{fmtINR(parseFloat(total))}</span>
              </div>
            </div>
          </div>

          {/* Applicability */}
          <div className="flex gap-4">
            {[['pf_applicable', 'PF'], ['esi_applicable', 'ESI'], ['pt_applicable', 'PT']].map(([k, label]) => (
              <label key={k} className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={!!form[k]} onChange={e => setForm(f => ({ ...f, [k]: e.target.checked ? 1 : 0 }))} className="rounded" />
                {label} Applicable
              </label>
            ))}
          </div>

          {/* Banking */}
          <div className="border-t pt-4">
            <div className="text-sm font-semibold text-slate-600 mb-2">Banking & Statutory</div>
            <div className="grid grid-cols-2 gap-3">
              {[
                { key: 'uan', label: 'UAN (PF)', placeholder: 'Universal Account Number' },
                { key: 'esi_number', label: 'ESI Number', placeholder: 'ESI Registration No.' },
                { key: 'account_number', label: 'Bank Account No.', placeholder: 'XXXXXXXXXXXXXXXX' },
                { key: 'bank_name', label: 'Bank Name', placeholder: 'e.g. SBI' },
                { key: 'ifsc_code', label: 'IFSC Code', placeholder: 'e.g. SBIN0001234' }
              ].map(f => (
                <div key={f.key}>
                  <label className="label">{f.label}</label>
                  <input type="text" value={form[f.key]} onChange={e => setForm(prev => ({ ...prev, [f.key]: e.target.value }))} className="input font-mono" placeholder={f.placeholder} />
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="p-5 border-t flex gap-2">
          <button onClick={() => updateMutation.mutate(form)} disabled={updateMutation.isPending} className="btn-primary flex-1">
            {updateMutation.isPending ? 'Saving...' : 'Save Structure'}
          </button>
          <button onClick={onClose} className="btn-secondary">Cancel</button>
        </div>
      </div>
    </div>
  )
}

function EditEmployeeModal({ employee, onClose }) {
  const qc = useQueryClient()
  const [form, setForm] = useState({
    name: employee.name || '',
    department: employee.department || '',
    designation: employee.designation || '',
    date_of_joining: employee.date_of_joining || '',
    employment_type: employee.employment_type || 'Permanent',
    shift_code: employee.shift_code || 'DAY',
    weekly_off_day: employee.weekly_off_day ?? 0,
    phone: employee.phone || '',
    email: employee.email || '',
    aadhar: employee.aadhar || '',
    pan: employee.pan || ''
  })

  const updateMutation = useMutation({
    mutationFn: (data) => updateEmployee(employee.code, data),
    onSuccess: () => { toast.success('Employee updated'); qc.invalidateQueries(['employees']); onClose() }
  })

  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="p-5 border-b">
          <h3 className="font-bold text-slate-800">Edit Employee — {employee.name}</h3>
          <p className="text-xs text-slate-500">{employee.code}</p>
        </div>
        <div className="p-5 grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="label">Full Name</label>
            <input type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="input" />
          </div>
          <div>
            <label className="label">Department</label>
            <input type="text" value={form.department} onChange={e => setForm(f => ({ ...f, department: e.target.value }))} className="input" />
          </div>
          <div>
            <label className="label">Designation</label>
            <input type="text" value={form.designation} onChange={e => setForm(f => ({ ...f, designation: e.target.value }))} className="input" />
          </div>
          <div>
            <label className="label">Date of Joining</label>
            <input type="date" value={form.date_of_joining} onChange={e => setForm(f => ({ ...f, date_of_joining: e.target.value }))} className="input" />
          </div>
          <div>
            <label className="label">Employment Type</label>
            <select value={form.employment_type} onChange={e => setForm(f => ({ ...f, employment_type: e.target.value }))} className="select">
              {['Permanent', 'Contract', 'Temporary', 'Probation'].map(t => <option key={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Shift Code</label>
            <select value={form.shift_code} onChange={e => setForm(f => ({ ...f, shift_code: e.target.value }))} className="select">
              {['DAY', 'NIGHT', 'GEN'].map(s => <option key={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Weekly Off Day</label>
            <select value={form.weekly_off_day} onChange={e => setForm(f => ({ ...f, weekly_off_day: parseInt(e.target.value) }))} className="select">
              {DAYS.map((d, i) => <option key={i} value={i}>{d}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Phone</label>
            <input type="text" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} className="input" />
          </div>
          <div>
            <label className="label">Email</label>
            <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} className="input" />
          </div>
          <div>
            <label className="label">Aadhar No.</label>
            <input type="text" value={form.aadhar} onChange={e => setForm(f => ({ ...f, aadhar: e.target.value }))} className="input font-mono" />
          </div>
          <div>
            <label className="label">PAN No.</label>
            <input type="text" value={form.pan} onChange={e => setForm(f => ({ ...f, pan: e.target.value.toUpperCase() }))} className="input font-mono" />
          </div>
        </div>
        <div className="p-5 border-t flex gap-2">
          <button onClick={() => updateMutation.mutate(form)} disabled={updateMutation.isPending} className="btn-primary flex-1">
            {updateMutation.isPending ? 'Saving...' : 'Save'}
          </button>
          <button onClick={onClose} className="btn-secondary">Cancel</button>
        </div>
      </div>
    </div>
  )
}

export default function Employees() {
  const { selectedMonth, selectedYear } = useAppStore()
  const [search, setSearch] = useState('')
  const [deptFilter, setDeptFilter] = useState('')
  const [editEmp, setEditEmp] = useState(null)
  const [salaryEmp, setSalaryEmp] = useState(null)
  const [sortField, setSortField] = useState('name')
  const [sortDir, setSortDir] = useState('asc')

  const { data: empsRes, isLoading } = useQuery({
    queryKey: ['employees'],
    queryFn: () => getEmployees({}),
    retry: 0
  })
  const employees = empsRes?.data?.data || []

  const departments = [...new Set(employees.map(e => e.department).filter(Boolean))].sort()

  const filtered = employees
    .filter(e => {
      if (deptFilter && e.department !== deptFilter) return false
      if (search && !e.name?.toLowerCase().includes(search.toLowerCase()) && !e.code?.includes(search)) return false
      return true
    })
    .sort((a, b) => {
      const va = a[sortField] || ''
      const vb = b[sortField] || ''
      return sortDir === 'asc' ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va))
    })

  function toggleSort(field) {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortField(field); setSortDir('asc') }
  }

  const SortIcon = ({ field }) => (
    <span className="ml-1 text-slate-400">
      {sortField === field ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}
    </span>
  )

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-800">Employee Master</h2>
          <p className="text-sm text-slate-500">{employees.length} employees · auto-synced from biometric data</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-3">
        <input
          type="search"
          placeholder="Search by name or code..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="input flex-1 max-w-xs"
        />
        <select value={deptFilter} onChange={e => setDeptFilter(e.target.value)} className="select max-w-[200px]">
          <option value="">All Departments</option>
          {departments.map(d => <option key={d}>{d}</option>)}
        </select>
        <div className="text-sm text-slate-400 self-center">{filtered.length} employees</div>
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-slate-400">Loading employees...</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="table-compact w-full">
              <thead>
                <tr>
                  <th className="cursor-pointer" onClick={() => toggleSort('code')}>
                    Code <SortIcon field="code" />
                  </th>
                  <th className="cursor-pointer" onClick={() => toggleSort('name')}>
                    Name <SortIcon field="name" />
                  </th>
                  <th className="cursor-pointer" onClick={() => toggleSort('department')}>
                    Department <SortIcon field="department" />
                  </th>
                  <th>Designation</th>
                  <th className="cursor-pointer" onClick={() => toggleSort('employment_type')}>
                    Type <SortIcon field="employment_type" />
                  </th>
                  <th>Shift</th>
                  <th className="text-right">Gross</th>
                  <th className="text-center">PF</th>
                  <th className="text-center">ESI</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={10} className="text-center py-8 text-slate-400">No employees found</td></tr>
                ) : filtered.map(e => (
                  <tr key={e.code}>
                    <td className="font-mono text-sm text-slate-600">{e.code}</td>
                    <td className="font-medium text-slate-800">{e.name}</td>
                    <td className="text-slate-600">{e.department}</td>
                    <td className="text-slate-500">{e.designation || '—'}</td>
                    <td>
                      <span className={`badge text-xs ${e.employment_type === 'Permanent' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                        {e.employment_type || 'Permanent'}
                      </span>
                    </td>
                    <td className="text-slate-500">{e.shift_code || 'DAY'}</td>
                    <td className="text-right font-medium">{e.gross_salary ? fmtINR(e.gross_salary) : <span className="text-slate-300">Not Set</span>}</td>
                    <td className="text-center">{e.pf_applicable !== 0 ? <span className="text-green-500 text-xs">✓</span> : <span className="text-slate-300 text-xs">—</span>}</td>
                    <td className="text-center">{e.esi_applicable !== 0 ? <span className="text-green-500 text-xs">✓</span> : <span className="text-slate-300 text-xs">—</span>}</td>
                    <td>
                      <div className="flex gap-1.5">
                        <button onClick={() => setEditEmp(e)} className="btn-secondary text-xs py-0.5 px-2">Edit</button>
                        <button onClick={() => setSalaryEmp(e)} className="text-xs py-0.5 px-2 bg-brand-50 text-brand-600 rounded hover:bg-brand-100 border border-brand-200">₹ Salary</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editEmp && <EditEmployeeModal employee={editEmp} onClose={() => setEditEmp(null)} />}
      {salaryEmp && <SalaryModal employee={salaryEmp} onClose={() => setSalaryEmp(null)} />}
    </div>
  )
}
