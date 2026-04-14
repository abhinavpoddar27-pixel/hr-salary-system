import React, { useState, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import * as XLSX from 'xlsx'
import { getEmployees, getEmployee, createEmployee, updateEmployee, updateSalaryStructure, getLeaveBalances, updateLeaveBalance, getEmployeeDocuments, uploadEmployeeDocument, deleteEmployeeDocument, getEmployeeLoans, markEmployeeLeft, getShifts, bulkAssignShift, getLateComingEmployeeHistory, getDepartments } from '../utils/api'
import { fmtINR } from '../utils/formatters'
import { useAppStore } from '../store/appStore'
import Modal from '../components/ui/Modal'
import CalendarView from '../components/ui/CalendarView'
import { Abbr } from '../components/ui/Tooltip'
import CompanyFilter from '../components/shared/CompanyFilter'
import clsx from 'clsx'
import useExpandableRows from '../hooks/useExpandableRows'
import DrillDownRow, { DrillDownChevron } from '../components/ui/DrillDownRow'
import EmployeeQuickView from '../components/ui/EmployeeQuickView'

// Late Coming Phase 1 follow-up: the shifts table still contains legacy
// DAY/NIGHT/GEN/DUBLE rows because historical attendance records reference
// them. HR should only assign employees to the three canonical Phase 1
// shifts going forward, so filter these codes out of the Employee Master
// picker. Any new shift admin adds later (e.g. "11HR") automatically
// appears because the filter is a blacklist of known-legacy codes, not a
// whitelist.
const LEGACY_SHIFT_CODES = new Set(['DAY', 'NIGHT', 'GEN', 'DUBLE'])
const isLegacyShiftCode = (code) => !code || LEGACY_SHIFT_CODES.has(code)
const isContractorEmployee = (e) => e.is_contractor === 1 || e.employment_type === 'Contract' || e.employment_type === 'Temporary'

function formatLastPresent(dateStr) {
  if (!dateStr) return { text: 'No data', daysAgo: null }
  const d = new Date(dateStr + 'T00:00:00')
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const diff = Math.floor((today - d) / 86400000)
  if (diff === 0) return { text: 'Today', daysAgo: 0 }
  if (diff === 1) return { text: '1d ago', daysAgo: 1 }
  if (diff <= 7) return { text: `${diff}d ago`, daysAgo: diff }
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return { text: `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`, daysAgo: diff }
}

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
    onSuccess: (response) => {
      const data = response?.data || response
      if (data?.pendingApproval) {
        toast.success('Salary change submitted for finance approval', { duration: 5000 })
      } else {
        toast.success('Salary structure saved')
      }
      qc.invalidateQueries(['employee-detail', employee.code])
      onClose()
    }
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
            {[['pf_applicable', 'PF'], ['esi_applicable', 'ESI']].map(([k, label]) => (
              <label key={k} className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={!!form[k]} onChange={e => setForm(f => ({ ...f, [k]: e.target.checked ? 1 : 0 }))} className="rounded" />
                {label} Applicable
              </label>
            ))}
            <label className="flex items-center gap-2 text-sm cursor-not-allowed opacity-50">
              <input type="checkbox" checked={!!form.pt_applicable} onChange={e => setForm(f => ({ ...f, pt_applicable: e.target.checked ? 1 : 0 }))} className="rounded" disabled />
              PT Applicable <span className="text-[10px] text-slate-400">(Currently disabled)</span>
            </label>
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
  const isNew = !employee.code // Adding new employee vs editing existing
  const [form, setForm] = useState({
    code: employee.code || '',
    name: employee.name || '',
    department: employee.department || '',
    designation: employee.designation || '',
    company: employee.company || '',
    date_of_joining: employee.date_of_joining || '',
    employment_type: employee.employment_type || 'Permanent',
    shift_code: employee.shift_code || '',
    default_shift_id: employee.default_shift_id || null,
    weekly_off_day: employee.weekly_off_day ?? 0,
    phone: employee.phone || '',
    email: employee.email || '',
    aadhar: employee.aadhar || '',
    pan: employee.pan || ''
  })

  // Fetch departments for the searchable combobox
  const { data: deptRes } = useQuery({ queryKey: ['departments'], queryFn: getDepartments, retry: 0, staleTime: 300000 })
  const deptList = deptRes?.data?.departments || []
  const isNewDept = form.department && !deptList.some(d => d.toLowerCase() === form.department.toLowerCase())

  // Late Coming Phase 1: fetch real shifts for the dropdown so HR can assign
  // 12HR / 10HR / 9HR (plus any admin-defined custom shift). Legacy
  // DAY/NIGHT/GEN/DUBLE rows are filtered out here so HR cannot
  // accidentally reassign someone to a deprecated shift.
  const { data: shiftsRes } = useQuery({ queryKey: ['shifts'], queryFn: getShifts, retry: 0 })
  const shifts = shiftsRes?.data?.data || []
  const assignableShifts = shifts.filter(s => !LEGACY_SHIFT_CODES.has(s.code))

  const saveMutation = useMutation({
    mutationFn: (data) => isNew ? createEmployee(data) : updateEmployee(employee.code, data),
    onSuccess: () => { toast.success(isNew ? 'Employee created' : 'Employee updated'); qc.invalidateQueries(['employees']); onClose() },
    onError: (err) => toast.error(err?.response?.data?.error || 'Save failed')
  })

  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="p-5 border-b">
          <h3 className="font-bold text-slate-800">{isNew ? 'Add New Employee' : `Edit Employee — ${employee.name}`}</h3>
          {!isNew && <p className="text-xs text-slate-500">{employee.code}</p>}
        </div>
        <div className="p-5 grid grid-cols-2 gap-3">
          {isNew && (
            <div className="col-span-2">
              <label className="label">Employee Code *</label>
              <input type="text" value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value }))} className="input font-mono" placeholder="e.g. 12345" />
            </div>
          )}
          <div className="col-span-2">
            <label className="label">Full Name *</label>
            <input type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="input" />
          </div>
          <div>
            <label className="label">Department</label>
            <input type="text" list="dept-list" value={form.department} onChange={e => setForm(f => ({ ...f, department: e.target.value }))} className="input" autoComplete="off" />
            <datalist id="dept-list">
              {deptList.map(d => <option key={d} value={d} />)}
            </datalist>
            {isNewDept && form.department && (
              <div className="text-[10px] text-amber-600 italic mt-0.5">New department: {form.department}</div>
            )}
          </div>
          <div>
            <label className="label">Designation</label>
            <input type="text" value={form.designation} onChange={e => setForm(f => ({ ...f, designation: e.target.value }))} className="input" />
          </div>
          {isNew && (
            <div className="col-span-2">
              <label className="label">Company</label>
              <input type="text" value={form.company} onChange={e => setForm(f => ({ ...f, company: e.target.value }))} className="input" placeholder="e.g. Asian Lakto Ind Ltd" />
            </div>
          )}
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
          <div className="col-span-2">
            <label className="label">Shift</label>
            <select
              value={assignableShifts.some(s => s.id === form.default_shift_id) ? form.default_shift_id : ''}
              onChange={e => {
                const id = e.target.value ? parseInt(e.target.value) : null
                const chosen = assignableShifts.find(s => s.id === id)
                setForm(f => ({
                  ...f,
                  default_shift_id: id,
                  shift_code: chosen?.code || ''
                }))
              }}
              className="select"
            >
              <option value="">— Select shift —</option>
              {assignableShifts.map(s => (
                <option key={s.id} value={s.id}>
                  {s.code} ({s.start_time} - {s.end_time})
                </option>
              ))}
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
          <button onClick={() => {
            if (isNew && (!form.code || !form.name)) return toast.error('Employee code and name are required')
            saveMutation.mutate(form)
          }} disabled={saveMutation.isPending} className="btn-primary flex-1">
            {saveMutation.isPending ? 'Saving...' : isNew ? 'Create Employee' : 'Save'}
          </button>
          <button onClick={onClose} className="btn-secondary">Cancel</button>
        </div>
      </div>
    </div>
  )
}

function EmployeeProfileModal({ employee, onClose }) {
  const { selectedMonth, selectedYear } = useAppStore()
  const profileNav = useNavigate()
  const qc = useQueryClient()
  const [activeTab, setActiveTab] = useState('info')
  const fileRef = useRef(null)
  const [docType, setDocType] = useState('Other')

  const { data: empRes } = useQuery({
    queryKey: ['employee-detail', employee.code],
    queryFn: () => getEmployee(employee.code),
    retry: 0
  })
  const emp = empRes?.data?.data || employee

  const { data: docsRes, refetch: refetchDocs } = useQuery({
    queryKey: ['employee-docs', employee.code],
    queryFn: () => getEmployeeDocuments(employee.code),
    retry: 0,
    enabled: activeTab === 'documents'
  })
  const docs = docsRes?.data?.data || []

  const { data: loansRes } = useQuery({
    queryKey: ['employee-loans', employee.code],
    queryFn: () => getEmployeeLoans(employee.code),
    retry: 0,
    enabled: activeTab === 'loans'
  })
  const loans = loansRes?.data?.data || []

  const uploadMutation = useMutation({
    mutationFn: (formData) => uploadEmployeeDocument(employee.code, formData),
    onSuccess: () => { toast.success('Document uploaded'); refetchDocs(); }
  })

  const deleteMutation = useMutation({
    mutationFn: (id) => deleteEmployeeDocument(id),
    onSuccess: () => { toast.success('Document deleted'); refetchDocs(); }
  })

  const handleUpload = () => {
    const file = fileRef.current?.files[0]
    if (!file) return toast.error('Select a file first')
    const fd = new FormData()
    fd.append('file', file)
    fd.append('documentType', docType)
    uploadMutation.mutate(fd)
    fileRef.current.value = ''
  }

  const DOC_TYPES = ['Resume', 'Interview Form', 'Offer Letter', 'Joining Form', 'ID Proof', 'Address Proof', 'Education Certificate', 'Experience Letter', 'PF Transfer Form', 'Other']
  const PROFILE_TABS = [
    { id: 'info', label: 'Personal' },
    { id: 'employment', label: 'Employment' },
    { id: 'attendance', label: 'Attendance' },
    { id: 'latecoming', label: 'Late Coming' },
    { id: 'documents', label: 'Documents' },
    { id: 'loans', label: 'Loans' },
  ]

  // Late Coming history — 12 months, fetched lazily
  const { data: lcHistoryRes } = useQuery({
    queryKey: ['employee-late-history', employee.code],
    queryFn: () => getLateComingEmployeeHistory(employee.code, 12),
    retry: 0,
    enabled: activeTab === 'latecoming'
  })
  const lcHistory = lcHistoryRes?.data?.data || []
  const lcCurrent = lcHistory[0] || {}
  const lcPrev = lcHistory[1] || {}
  const lcTrend = (lcCurrent.late_count || 0) - (lcPrev.late_count || 0)
  const lcAllDeductions = lcHistory.flatMap(m =>
    (m.deductions || []).map(d => ({ ...d, _month: m.month, _year: m.year }))
  ).sort((a, b) => (b.applied_at || '').localeCompare(a.applied_at || ''))

  return (
    <Modal title={`${emp.name || employee.code}`} onClose={onClose} size="lg">
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center gap-4 pb-3 border-b">
          <div className="w-14 h-14 bg-blue-100 rounded-2xl flex items-center justify-center text-blue-600 text-xl font-bold">
            {(emp.name || '?')[0]}
          </div>
          <div>
            <div className="text-lg font-bold text-slate-800">{emp.name}</div>
            <div className="text-sm text-slate-500">{emp.code} · {emp.department} · {emp.designation}</div>
            <div className="flex gap-2 mt-1 items-center">
              <span className={clsx('text-xs px-2 py-0.5 rounded-full font-medium',
                emp.status === 'Active' ? 'bg-green-100 text-green-700' :
                emp.status === 'Exited' ? 'bg-red-200 text-red-800' :
                'bg-red-100 text-red-700'
              )}>{emp.status || 'Active'}</span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-700">{emp.employment_type || 'Permanent'}</span>
              <button onClick={() => { onClose(); profileNav(`/employee-profile?code=${emp.code}`) }} className="text-[10px] text-violet-600 hover:text-violet-800 underline ml-auto">
                View Full Intelligence Profile &rarr;
              </button>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b">
          {PROFILE_TABS.map(t => (
            <button key={t.id} onClick={() => setActiveTab(t.id)}
              className={clsx('px-3 py-2 text-sm font-medium border-b-2 transition-colors',
                activeTab === t.id ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'
              )}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Personal Info */}
        {activeTab === 'info' && (
          <div className="grid grid-cols-2 gap-3 text-sm">
            {[
              ['Father Name', emp.father_name],
              ['DOB', emp.dob],
              ['Gender', emp.gender],
              ['Blood Group', emp.blood_group],
              ['Marital Status', emp.marital_status],
              ['Spouse Name', emp.spouse_name],
              ['Phone', emp.phone],
              ['Email', emp.email],
              ['Aadhar', emp.aadhar],
              ['PAN', emp.pan],
              ['Emergency Contact', emp.emergency_contact_name],
              ['Emergency Phone', emp.emergency_contact_phone],
              ['Current Address', emp.address_current],
              ['Permanent Address', emp.address_permanent],
              ['Qualification', emp.qualification],
              ['Category', emp.category],
            ].map(([label, val]) => (
              <div key={label} className="flex flex-col">
                <span className="text-xs text-slate-400">{label}</span>
                <span className="text-slate-700 font-medium">{val || '—'}</span>
              </div>
            ))}
          </div>
        )}

        {/* Employment */}
        {activeTab === 'employment' && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 text-sm">
              {[
                ['Date of Joining', emp.date_of_joining],
                ['Company', emp.company],
                ['Department', emp.department],
                ['Designation', emp.designation],
                ['Shift', isLegacyShiftCode(emp.shift_code) ? '— needs shift' : emp.shift_code],
                ['Employment Type', emp.employment_type],
                ['Weekly Off', ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][emp.weekly_off_day || 0]],
                ['PF Number', emp.pf_number],
                ['UAN', emp.uan],
                ['ESI Number', emp.esi_number],
                ['Bank Account', emp.bank_account || emp.account_number],
                ['Bank', emp.bank_name],
                ['IFSC', emp.ifsc || emp.ifsc_code],
                ['Probation End', emp.probation_end_date],
                ['Confirmation Date', emp.confirmation_date],
                ['Previous Employer', emp.previous_employer],
                ...((emp.status === 'Left' || emp.status === 'Exited') ? [
                  ['Date of Exit', emp.date_of_exit || emp.date_of_leaving],
                  ['Exit Reason', emp.exit_reason],
                ] : []),
              ].map(([label, val]) => (
                <div key={label} className="flex flex-col">
                  <span className="text-xs text-slate-400">{label}</span>
                  <span className="text-slate-700 font-medium font-mono">{val || '—'}</span>
                </div>
              ))}
            </div>
            {emp.salaryStructure && (
              <div className="bg-slate-50 rounded-xl p-3">
                <h4 className="text-xs font-bold text-slate-500 uppercase mb-2">Current Salary Structure</h4>
                <div className="grid grid-cols-3 gap-2 text-sm">
                  <div><span className="text-slate-400 text-xs">Gross</span><div className="font-bold">{fmtINR(emp.salaryStructure.gross_salary || emp.gross_salary || 0)}</div></div>
                  <div><span className="text-slate-400 text-xs">Basic</span><div>{fmtINR(emp.salaryStructure.basic || 0)}</div></div>
                  <div><span className="text-slate-400 text-xs">HRA</span><div>{fmtINR(emp.salaryStructure.hra || 0)}</div></div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Attendance Calendar */}
        {activeTab === 'attendance' && (
          <div>
            <CalendarView employeeCode={employee.code} month={selectedMonth} year={selectedYear} />
          </div>
        )}

        {/* Late Coming History (Phase 2) */}
        {activeTab === 'latecoming' && (
          <div className="space-y-4">
            {/* Current shift badge */}
            <div className="flex items-center gap-3">
              <div className="px-3 py-2 bg-blue-50 border border-blue-200 rounded-lg">
                <div className="text-[10px] text-slate-500 uppercase font-semibold">Current Shift</div>
                <div className="text-sm font-bold text-blue-700">
                  {emp.shift_code || '—'}
                  {emp.shift_start_time && <span className="text-xs text-blue-500 ml-2">{emp.shift_start_time} – {emp.shift_end_time}</span>}
                </div>
              </div>
              <div className="px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg">
                <div className="text-[10px] text-slate-500 uppercase font-semibold">Late This Month</div>
                <div className="text-sm font-bold text-amber-700">
                  {lcCurrent.late_count || 0}
                  {lcTrend !== 0 && (
                    <span className={clsx('text-[10px] ml-1', lcTrend > 0 ? 'text-red-600' : 'text-green-600')}>
                      {lcTrend > 0 ? '↑' : '↓'} {Math.abs(lcTrend)}
                    </span>
                  )}
                </div>
              </div>
              <div className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg">
                <div className="text-[10px] text-slate-500 uppercase font-semibold">Late Last Month</div>
                <div className="text-sm font-bold text-slate-700">{lcPrev.late_count || 0}</div>
              </div>
              <div className="px-3 py-2 bg-orange-50 border border-orange-200 rounded-lg">
                <div className="text-[10px] text-slate-500 uppercase font-semibold">Left Late This Month</div>
                <div className="text-sm font-bold text-orange-700">{lcCurrent.left_late_count || 0}</div>
              </div>
            </div>

            {/* Month-by-month late counts */}
            <div>
              <div className="text-xs font-semibold text-slate-600 mb-2">Monthly Late Coming — Last 12 Months</div>
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b text-[10px] text-slate-500 uppercase">
                    <th className="py-1 text-left">Month</th>
                    <th className="py-1 text-right">Late Count</th>
                    <th className="py-1 text-right">Avg Min</th>
                    <th className="py-1 text-right">Left Late</th>
                    <th className="py-1 text-right">Deductions</th>
                  </tr>
                </thead>
                <tbody>
                  {lcHistory.map(h => {
                    const mName = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][h.month] || h.month
                    return (
                      <tr key={`${h.year}-${h.month}`} className="border-b border-slate-100">
                        <td className="py-1.5 font-medium">{mName} {h.year}</td>
                        <td className="py-1.5 text-right font-mono">{h.late_count}</td>
                        <td className="py-1.5 text-right font-mono">{h.avg_late_minutes}</td>
                        <td className="py-1.5 text-right font-mono">{h.left_late_count}</td>
                        <td className="py-1.5 text-right font-mono">
                          {(h.deductions || []).length > 0 ? (
                            (h.deductions || []).reduce((s, d) => s + Number(d.deduction_days || 0), 0) + 'd'
                          ) : '—'}
                        </td>
                      </tr>
                    )
                  })}
                  {lcHistory.length === 0 && (
                    <tr><td colSpan={5} className="py-4 text-center text-slate-400">No history yet</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Deduction full history */}
            <div>
              <div className="text-xs font-semibold text-slate-600 mb-2">Deduction History</div>
              {lcAllDeductions.length === 0 ? (
                <div className="text-center py-4 text-slate-400 text-xs">No deductions applied yet</div>
              ) : (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b text-[10px] text-slate-500 uppercase">
                      <th className="py-1 text-left">Month</th>
                      <th className="py-1 text-right">Days</th>
                      <th className="py-1 text-left">HR Remark</th>
                      <th className="py-1 text-left">Status</th>
                      <th className="py-1 text-left">Finance Remark</th>
                      <th className="py-1 text-center">In Salary</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lcAllDeductions.map(d => {
                      const mName = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d._month] || d._month
                      const badge = d.finance_status === 'approved'
                        ? 'bg-green-100 text-green-700'
                        : d.finance_status === 'rejected'
                          ? 'bg-red-100 text-red-700'
                          : 'bg-amber-100 text-amber-700'
                      return (
                        <tr key={d.id} className="border-b border-slate-100">
                          <td className="py-1.5 font-medium">{mName} {d._year}</td>
                          <td className="py-1.5 text-right font-mono">{d.deduction_days}</td>
                          <td className="py-1.5 text-slate-600 max-w-[160px] truncate" title={d.remark}>{d.remark}</td>
                          <td className="py-1.5">
                            <span className={clsx('text-[10px] px-2 py-0.5 rounded-full', badge)}>{d.finance_status}</span>
                          </td>
                          <td className="py-1.5 text-slate-500 max-w-[160px] truncate" title={d.finance_remark}>{d.finance_remark || '—'}</td>
                          <td className="py-1.5 text-center">{d.is_applied_to_salary ? '✓' : '—'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

        {/* Documents */}
        {activeTab === 'documents' && (
          <div className="space-y-3">
            <div className="flex gap-2 items-end">
              <div>
                <label className="label">Type</label>
                <select value={docType} onChange={e => setDocType(e.target.value)} className="select text-sm w-40">
                  {DOC_TYPES.map(t => <option key={t}>{t}</option>)}
                </select>
              </div>
              <div className="flex-1">
                <label className="label">File</label>
                <input type="file" ref={fileRef} className="input text-sm" />
              </div>
              <button onClick={handleUpload} disabled={uploadMutation.isPending} className="btn-primary text-sm">
                {uploadMutation.isPending ? 'Uploading...' : 'Upload'}
              </button>
            </div>

            {docs.length === 0 ? (
              <div className="text-center py-6 text-slate-400 text-sm">No documents uploaded yet</div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-xs text-slate-500">
                    <th className="py-1 text-left">Type</th>
                    <th className="py-1 text-left">File Name</th>
                    <th className="py-1 text-right">Size</th>
                    <th className="py-1 text-left">Uploaded</th>
                    <th className="py-1">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {docs.map(d => (
                    <tr key={d.id} className="border-b border-slate-100">
                      <td className="py-1.5"><span className="bg-slate-100 px-2 py-0.5 rounded text-xs">{d.document_type}</span></td>
                      <td className="py-1.5 font-medium">{d.file_name}</td>
                      <td className="py-1.5 text-right text-slate-400">{d.file_size ? `${(d.file_size / 1024).toFixed(0)} KB` : '—'}</td>
                      <td className="py-1.5 text-slate-400 text-xs">{d.created_at?.split('T')[0]}</td>
                      <td className="py-1.5">
                        <button onClick={() => deleteMutation.mutate(d.id)}
                          className="text-red-500 text-xs hover:text-red-700">Delete</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* Loans */}
        {activeTab === 'loans' && (
          <div>
            {loans.length === 0 ? (
              <div className="text-center py-6 text-slate-400 text-sm">No loans found</div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-xs text-slate-500">
                    <th className="py-1 text-left">Type</th>
                    <th className="py-1 text-right">Principal</th>
                    <th className="py-1 text-right"><Abbr code="EMI">EMI</Abbr></th>
                    <th className="py-1 text-center">Tenure</th>
                    <th className="py-1 text-right">Recovered</th>
                    <th className="py-1">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {loans.map(l => (
                    <tr key={l.id} className="border-b border-slate-100">
                      <td className="py-1.5 font-medium">{l.loan_type}</td>
                      <td className="py-1.5 text-right font-mono">{fmtINR(l.principal_amount)}</td>
                      <td className="py-1.5 text-right font-mono">{fmtINR(l.emi_amount)}</td>
                      <td className="py-1.5 text-center">{l.tenure_months}m ({l.paidEmis || 0}/{l.tenure_months})</td>
                      <td className="py-1.5 text-right font-mono text-green-600">{fmtINR(l.totalRecovered || 0)}</td>
                      <td className="py-1.5">
                        <span className={clsx('text-xs px-2 py-0.5 rounded-full',
                          l.status === 'Active' ? 'bg-green-100 text-green-700' :
                          l.status === 'Completed' ? 'bg-blue-100 text-blue-700' :
                          'bg-slate-100 text-slate-600'
                        )}>{l.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}

function MarkLeftModal({ employee, onClose }) {
  const qc = useQueryClient()
  const [dateOfLeaving, setDateOfLeaving] = useState(new Date().toISOString().split('T')[0])
  const [reason, setReason] = useState('')

  const mutation = useMutation({
    mutationFn: () => markEmployeeLeft(employee.code, { date_of_leaving: dateOfLeaving, reason }),
    onSuccess: () => {
      toast.success(`${employee.name} marked as left`)
      qc.invalidateQueries({ queryKey: ['employees'] })
      qc.refetchQueries({ queryKey: ['employees'] })
      onClose()
    },
    onError: (err) => {
      const msg = err?.response?.data?.error || err?.message || 'Failed to mark employee as left'
      toast.error(msg)
    }
  })

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
        <div className="p-5 border-b">
          <h3 className="font-bold text-slate-800">Mark Employee as Left</h3>
          <p className="text-xs text-slate-500">{employee.code} · {employee.name}</p>
        </div>
        <div className="p-5 space-y-4">
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
            This will deactivate the employee and close all active loans.
          </div>
          <div>
            <label className="label">Date of Leaving</label>
            <input type="date" value={dateOfLeaving} onChange={e => setDateOfLeaving(e.target.value)} className="input" />
          </div>
          <div>
            <label className="label">Reason</label>
            <input type="text" value={reason} onChange={e => setReason(e.target.value)} className="input" placeholder="e.g. Resignation, Termination..." />
          </div>
        </div>
        <div className="p-5 border-t flex gap-2">
          <button onClick={() => mutation.mutate()} disabled={mutation.isPending} className="flex-1 bg-red-600 hover:bg-red-700 text-white font-medium py-2 px-4 rounded-lg text-sm disabled:opacity-50">
            {mutation.isPending ? 'Processing...' : 'Confirm — Mark as Left'}
          </button>
          <button onClick={onClose} className="btn-secondary">Cancel</button>
        </div>
      </div>
    </div>
  )
}

export default function Employees() {
  const { selectedMonth, selectedYear, selectedCompany, user } = useAppStore()
  const navigate = useNavigate()
  const canBulkAssignShift = user?.role === 'admin' || user?.role === 'hr'
  const [search, setSearch] = useState('')
  const [deptFilter, setDeptFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('All')
  const [editEmp, setEditEmp] = useState(null)
  const [salaryEmp, setSalaryEmp] = useState(null)
  const [profileEmp, setProfileEmp] = useState(null)
  const [statusFilter, setStatusFilter] = useState('Active')
  const [markLeftEmp, setMarkLeftEmp] = useState(null)
  const [sortField, setSortField] = useState('name')
  const [sortDir, setSortDir] = useState('asc')
  // Late Coming Phase 1: bulk-select + bulk shift assignment state
  const [selectedCodes, setSelectedCodes] = useState(new Set())
  const [showBulkShift, setShowBulkShift] = useState(false)
  const { toggle, isExpanded } = useExpandableRows()
  const qcEmp = useQueryClient()

  const { data: empsRes, isLoading } = useQuery({
    queryKey: ['employees', selectedCompany, statusFilter],
    queryFn: () => getEmployees({ status: statusFilter === 'All' ? undefined : statusFilter, company: selectedCompany }),
    retry: 0
  })
  const employees = empsRes?.data?.data || []
  const { data: shiftsListRes } = useQuery({ queryKey: ['shifts'], queryFn: getShifts, retry: 0 })
  const allShifts = shiftsListRes?.data?.data || []
  const { data: deptsRes } = useQuery({ queryKey: ['departments'], queryFn: getDepartments, retry: 0, staleTime: 300000 })
  const allDepartments = deptsRes?.data?.departments || []

  const toggleSelect = (code) => {
    setSelectedCodes(prev => {
      const next = new Set(prev)
      if (next.has(code)) next.delete(code)
      else next.add(code)
      return next
    })
  }
  const clearSelection = () => setSelectedCodes(new Set())

  const bulkShiftMutation = useMutation({
    mutationFn: ({ shiftId, shiftCode }) => bulkAssignShift(Array.from(selectedCodes), shiftId, shiftCode),
    onSuccess: (res) => {
      toast.success(`Shift updated for ${res?.data?.updated || selectedCodes.size} employees`)
      qcEmp.invalidateQueries(['employees'])
      clearSelection()
      setShowBulkShift(false)
    },
    onError: (err) => toast.error(err?.response?.data?.error || 'Bulk shift assignment failed')
  })

  const departments = allDepartments.length > 0 ? allDepartments : [...new Set(employees.map(e => e.department).filter(Boolean))].sort()

  const filtered = employees
    .filter(e => {
      if (deptFilter && e.department !== deptFilter) return false
      if (search && !e.name?.toLowerCase().includes(search.toLowerCase()) && !e.code?.includes(search)) return false
      if (typeFilter === 'Contractor' && !isContractorEmployee(e)) return false
      if (typeFilter === 'Permanent' && isContractorEmployee(e)) return false
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

  function exportExcel() {
    if (filtered.length === 0) return toast.error('No data to export')
    const rows = filtered.map(e => ({
      'Code': e.code,
      'Name': e.name,
      'Department': e.department || '',
      'Designation': e.designation || '',
      'Company': e.company || '',
      'Employment Type': e.employment_type || 'Permanent',
      'Shift': e.shift_code || '',
      'Gross Salary': e.gross_salary || 0,
      'PF Applicable': e.pf_applicable ? 'Yes' : 'No',
      'ESI Applicable': e.esi_applicable ? 'Yes' : 'No',
      'Date of Joining': e.date_of_joining || '',
      'Last Present': e.last_present_date || '',
      'Status': e.status || 'Active',
      ...((e.status === 'Left' || e.status === 'Exited') ? {
        'Date of Exit': e.date_of_exit || e.date_of_leaving || '',
        'Exit Reason': e.exit_reason || '',
      } : {}),
    }))
    const ws = XLSX.utils.json_to_sheet(rows)
    ws['!cols'] = [{ wch: 8 }, { wch: 25 }, { wch: 18 }, { wch: 18 }, { wch: 22 }, { wch: 14 }, { wch: 8 }, { wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 14 }, { wch: 10 }, { wch: 14 }, { wch: 20 }]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Employees')
    const dateStr = new Date().toISOString().split('T')[0]
    XLSX.writeFile(wb, `Employee_Master_${selectedCompany || 'All'}_${dateStr}.xlsx`)
    toast.success('Employee data exported')
  }

  const SortIcon = ({ field }) => (
    <span className="ml-1 text-slate-400">
      {sortField === field ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}
    </span>
  )

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-800">Employee Master</h2>
          <p className="text-sm text-slate-500">{employees.length} employees · auto-synced from biometric data</p>
        </div>
        <CompanyFilter />
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap items-center">
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
        <div className="flex bg-slate-100 rounded-lg p-0.5 gap-0.5">
          {['All', 'Permanent', 'Contractor'].map(t => (
            <button key={t} onClick={() => setTypeFilter(t)}
              className={clsx('px-2.5 py-1 text-xs font-medium rounded-md transition-colors',
                typeFilter === t ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              )}>
              {t}
            </button>
          ))}
        </div>
        <div className="flex bg-slate-100 rounded-lg p-0.5 gap-0.5">
          {['Active', 'Left', 'Exited', 'All'].map(s => (
            <button key={s} onClick={() => setStatusFilter(s)}
              className={clsx('px-3 py-1 text-xs font-medium rounded-md transition-colors',
                statusFilter === s
                  ? s === 'Exited' ? 'bg-white text-red-700 shadow-sm' : 'bg-white text-slate-800 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              )}>
              {s}
            </button>
          ))}
        </div>
        <div className="text-sm text-slate-400 self-center">{filtered.length} employees</div>
        <div className="ml-auto flex items-center gap-2">
          {/* Late Coming Phase 1: Bulk shift assignment toolbar */}
          {canBulkAssignShift && selectedCodes.size > 0 && (
            <>
              <span className="text-sm text-slate-600">{selectedCodes.size} selected</span>
              <button onClick={() => setShowBulkShift(true)} className="btn-secondary text-sm">
                Assign Shift
              </button>
              <button onClick={clearSelection} className="text-xs text-slate-400 hover:text-slate-600">Clear</button>
            </>
          )}
          <button onClick={exportExcel} className="px-3 py-1.5 text-sm font-medium rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50">
            Export .xlsx
          </button>
          <button onClick={() => setEditEmp({ code: '', name: '', department: '', designation: '', date_of_joining: '', employment_type: 'Permanent', shift_code: '', default_shift_id: null, weekly_off_day: 0, phone: '', email: '', aadhar: '', pan: '' })} className="btn-primary text-sm">
            + Add Employee
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-slate-400">Loading employees...</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="table-compact w-full min-w-[900px]">
              <thead>
                <tr>
                  {canBulkAssignShift && (
                    <th className="w-8 text-center">
                      <input
                        type="checkbox"
                        checked={filtered.length > 0 && filtered.every(e => selectedCodes.has(e.code))}
                        onChange={(ev) => {
                          if (ev.target.checked) {
                            setSelectedCodes(new Set(filtered.map(e => e.code)))
                          } else {
                            clearSelection()
                          }
                        }}
                      />
                    </th>
                  )}
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
                  <th className="cursor-pointer" onClick={() => toggleSort('last_present_date')}>
                    Last Present <SortIcon field="last_present_date" />
                  </th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={canBulkAssignShift ? 12 : 11} className="text-center py-8 text-slate-400">No employees found</td></tr>
                ) : filtered.map(e => (
                  <React.Fragment key={e.code}>
                    <tr onClick={() => toggle(e.code)} className={clsx('cursor-pointer transition-colors hover:bg-blue-50/50', isExpanded(e.code) && 'bg-blue-50', (e.status === 'Left' || e.status === 'Exited') && 'opacity-60', isContractorEmployee(e) && 'border-l-3 border-l-amber-400')}>
                      {canBulkAssignShift && (
                        <td className="text-center" onClick={(ev) => ev.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={selectedCodes.has(e.code)}
                            onChange={() => toggleSelect(e.code)}
                          />
                        </td>
                      )}
                      <td className="font-mono text-sm text-slate-600"><DrillDownChevron isExpanded={isExpanded(e.code)} /> {e.code}</td>
                      <td className="font-medium text-slate-800">
                        <div>{e.name}
                          {(e.status === 'Left' || e.status === 'Exited') && (
                            <span className={clsx('ml-2 text-[10px] px-1.5 py-0.5 rounded-full font-semibold align-middle',
                              e.status === 'Exited' ? 'bg-red-200 text-red-800' : 'bg-red-100 text-red-600'
                            )} title={e.exit_reason || undefined}>{e.status}</span>
                          )}
                        </div>
                        {(e.status === 'Left' || e.status === 'Exited') && (e.date_of_exit || e.date_of_leaving) && (
                          <div className="text-[10px] text-slate-400 font-normal">{e.status}: {e.date_of_exit || e.date_of_leaving}</div>
                        )}
                      </td>
                      <td className="text-slate-600">{e.department}</td>
                      <td className="text-slate-500">{e.designation || '—'}</td>
                      <td>
                        <span className={`badge text-xs ${e.employment_type === 'Permanent' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                          {e.employment_type || 'Permanent'}
                        </span>
                      </td>
                      <td>
                        {isLegacyShiftCode(e.shift_code)
                          ? <span className="text-[10px] px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full font-semibold">— needs shift</span>
                          : <span className="text-slate-600 font-mono text-xs">{e.shift_code}</span>}
                      </td>
                      <td className="text-right font-medium">
                        {e.gross_salary ? (
                          <div>
                            {fmtINR(e.gross_salary)}
                            {isContractorEmployee(e) && <div className="text-[9px] text-amber-600 font-normal">(pro-rata)</div>}
                          </div>
                        ) : <span className="text-slate-300">Not Set</span>}
                      </td>
                      <td className="text-center">{isContractorEmployee(e) && !e.pf_applicable ? <span className="text-slate-400 text-[10px]">N/A</span> : e.pf_applicable !== 0 ? <span className="text-green-500 text-xs">✓</span> : <span className="text-slate-300 text-xs">—</span>}</td>
                      <td className="text-center">{isContractorEmployee(e) && !e.esi_applicable ? <span className="text-slate-400 text-[10px]">N/A</span> : e.esi_applicable !== 0 ? <span className="text-green-500 text-xs">✓</span> : <span className="text-slate-300 text-xs">—</span>}</td>
                      {(() => {
                        const lp = formatLastPresent(e.last_present_date)
                        const isInactive = e.status === 'Left' || e.status === 'Exited'
                        const colorCls = isInactive ? 'text-slate-400'
                          : lp.daysAgo === null ? 'text-slate-300'
                          : lp.daysAgo <= 1 ? 'text-green-600'
                          : lp.daysAgo <= 7 ? 'text-slate-600'
                          : lp.daysAgo <= 14 ? 'text-amber-600'
                          : 'text-red-600'
                        return (
                          <td className={clsx('text-xs', colorCls)}>
                            {lp.daysAgo !== null && lp.daysAgo >= 15 && !isInactive && <span className="mr-0.5">&#x26A0;</span>}
                            {lp.text}
                          </td>
                        )
                      })()}
                      <td>
                        <div className="flex gap-1.5">
                          <button onClick={(ev) => { ev.stopPropagation(); setProfileEmp(e) }} className="text-xs py-0.5 px-2 bg-blue-50 text-blue-700 rounded hover:bg-blue-100 border border-blue-200">Profile</button>
                          <button onClick={(ev) => { ev.stopPropagation(); navigate(`/employee-profile?code=${e.code}`) }} className="text-xs py-0.5 px-2 bg-violet-50 text-violet-700 rounded hover:bg-violet-100 border border-violet-200" title="Full Intelligence Profile">Intel</button>
                          <button onClick={(ev) => { ev.stopPropagation(); setEditEmp(e) }} className="btn-secondary text-xs py-0.5 px-2">Edit</button>
                          <button onClick={(ev) => { ev.stopPropagation(); setSalaryEmp(e) }} className="text-xs py-0.5 px-2 bg-brand-50 text-brand-600 rounded hover:bg-brand-100 border border-brand-200">₹</button>
                          {e.status !== 'Left' && e.status !== 'Exited' && (
                            <button onClick={(ev) => { ev.stopPropagation(); setMarkLeftEmp(e) }} className="text-xs py-0.5 px-2 bg-red-50 text-red-600 rounded hover:bg-red-100 border border-red-200">Mark Left</button>
                          )}
                        </div>
                      </td>
                    </tr>
                    {isExpanded(e.code) && (
                      <DrillDownRow colSpan={canBulkAssignShift ? 12 : 11}>
                        <EmployeeQuickView
                          employeeCode={e.code}
                          contextContent={
                            <div>
                              <div className="text-xs font-semibold text-slate-500 mb-2">Quick Actions</div>
                              <div className="flex gap-2">
                                <button onClick={() => setProfileEmp(e)} className="text-xs py-1.5 px-3 bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100 border border-blue-200 font-medium">View Full Profile</button>
                                <button onClick={() => setEditEmp(e)} className="text-xs py-1.5 px-3 bg-slate-50 text-slate-700 rounded-lg hover:bg-slate-100 border border-slate-200 font-medium">Edit Details</button>
                                <button onClick={() => setSalaryEmp(e)} className="text-xs py-1.5 px-3 bg-green-50 text-green-700 rounded-lg hover:bg-green-100 border border-green-200 font-medium">Salary Structure</button>
                              </div>
                            </div>
                          }
                        />
                      </DrillDownRow>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editEmp && <EditEmployeeModal employee={editEmp} onClose={() => setEditEmp(null)} />}
      {salaryEmp && <SalaryModal employee={salaryEmp} onClose={() => setSalaryEmp(null)} />}
      {profileEmp && <EmployeeProfileModal employee={profileEmp} onClose={() => setProfileEmp(null)} />}
      {markLeftEmp && <MarkLeftModal employee={markLeftEmp} onClose={() => setMarkLeftEmp(null)} />}

      {/* Late Coming Phase 1: Bulk shift assignment modal */}
      {showBulkShift && (
        <BulkShiftModal
          count={selectedCodes.size}
          shifts={allShifts.filter(s => !LEGACY_SHIFT_CODES.has(s.code))}
          onConfirm={(shiftId, shiftCode) => bulkShiftMutation.mutate({ shiftId, shiftCode })}
          isPending={bulkShiftMutation.isPending}
          onClose={() => setShowBulkShift(false)}
        />
      )}
    </div>
  )
}

function BulkShiftModal({ count, shifts, onConfirm, onClose, isPending }) {
  const [shiftId, setShiftId] = useState('')
  const chosen = shifts.find(s => s.id === parseInt(shiftId))
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
        <div className="p-5 border-b">
          <h3 className="font-bold text-slate-800">Assign Shift</h3>
          <p className="text-xs text-slate-500">Applies to {count} selected employees</p>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="label">Shift</label>
            <select value={shiftId} onChange={e => setShiftId(e.target.value)} className="select">
              <option value="">— Select shift —</option>
              {shifts.map(s => (
                <option key={s.id} value={s.id}>
                  {s.code} ({s.start_time} - {s.end_time})
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="p-5 border-t flex gap-2">
          <button
            disabled={!chosen || isPending}
            onClick={() => onConfirm(chosen.id, chosen.code)}
            className="btn-primary flex-1 disabled:opacity-50"
          >
            {isPending ? 'Saving…' : `Assign ${chosen?.code || '…'} to ${count}`}
          </button>
          <button onClick={onClose} className="btn-secondary">Cancel</button>
        </div>
      </div>
    </div>
  )
}
