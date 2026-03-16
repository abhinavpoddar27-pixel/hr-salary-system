import React, { useState, useMemo } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { fmtINR } from '../utils/formatters'
import { Abbr } from '../components/ui/Tooltip'
import AbbreviationLegend from '../components/ui/AbbreviationLegend'
import Modal, { ModalBody, ModalFooter } from '../components/ui/Modal'
import clsx from 'clsx'
import api from '../utils/api'

export default function SalaryInput() {
  const [filterDept, setFilterDept] = useState('')
  const [editEmployee, setEditEmployee] = useState(null)
  const [editForm, setEditForm] = useState({ basic: 0, da: 0, hra: 0, conveyance: 0, other_allowances: 0, pf_applicable: 1, esi_applicable: 1 })
  const [reason, setReason] = useState('')
  const [tab, setTab] = useState('employees') // employees | pending | history

  // All employees with salary structures
  const { data: empRes, refetch: refetchEmps } = useQuery({
    queryKey: ['salary-input-all'],
    queryFn: () => api.get('/salary-input/all')
  })

  // Pending change requests
  const { data: pendingRes, refetch: refetchPending } = useQuery({
    queryKey: ['salary-input-pending'],
    queryFn: () => api.get('/salary-input/pending-changes')
  })

  // All history
  const { data: historyRes } = useQuery({
    queryKey: ['salary-input-history'],
    queryFn: () => api.get('/salary-input/all-changes'),
    enabled: tab === 'history'
  })

  const employees = empRes?.data?.data || []
  const pendingChanges = pendingRes?.data?.data || []
  const history = historyRes?.data?.data || []

  const filteredEmployees = useMemo(() => {
    if (!filterDept) return employees
    return employees.filter(e => e.department?.toLowerCase().includes(filterDept.toLowerCase()))
  }, [employees, filterDept])

  const requestChangeMutation = useMutation({
    mutationFn: () => api.post('/salary-input/request-change', {
      employeeCode: editEmployee.code,
      newStructure: editForm,
      reason
    }),
    onSuccess: () => {
      toast.success('Salary change request submitted for approval')
      setEditEmployee(null)
      setReason('')
      refetchPending()
    }
  })

  const approveMutation = useMutation({
    mutationFn: (id) => api.put(`/salary-input/approve/${id}`),
    onSuccess: () => { toast.success('Salary change approved'); refetchPending(); refetchEmps() }
  })

  const rejectMutation = useMutation({
    mutationFn: (id) => api.put(`/salary-input/reject/${id}`),
    onSuccess: () => { toast.success('Salary change rejected'); refetchPending() }
  })

  const openEdit = (emp) => {
    setEditEmployee(emp)
    setEditForm({
      basic: emp.basic || 0,
      da: emp.da || 0,
      hra: emp.hra || 0,
      conveyance: emp.conveyance || 0,
      other_allowances: emp.other_allowances || 0,
      pf_applicable: emp.pf_applicable ?? 1,
      esi_applicable: emp.esi_applicable ?? 1,
    })
    setReason('')
  }

  const newGross = (editForm.basic || 0) + (editForm.da || 0) + (editForm.hra || 0) + (editForm.conveyance || 0) + (editForm.other_allowances || 0)

  return (
    <div className="animate-fade-in">
      <div className="p-6 space-y-5 max-w-screen-xl">
        <div>
          <h2 className="section-title">Salary Input & Changes</h2>
          <p className="section-subtitle mt-1">View and manage employee salary structures. Changes require admin approval.</p>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-slate-200 pb-0">
          {[
            { key: 'employees', label: 'Employee Salaries', count: employees.length },
            { key: 'pending', label: 'Pending Approvals', count: pendingChanges.length },
            { key: 'history', label: 'Change History' },
          ].map(t => (
            <button key={t.key}
              onClick={() => setTab(t.key)}
              className={clsx('px-4 py-2 text-sm font-medium rounded-t-lg transition-colors -mb-px',
                tab === t.key
                  ? 'bg-white text-blue-700 border border-slate-200 border-b-white'
                  : 'text-slate-500 hover:text-slate-700'
              )}
            >
              {t.label}
              {t.count !== undefined && <span className="ml-1.5 text-xs bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded-full">{t.count}</span>}
            </button>
          ))}
        </div>

        {/* Employee Salaries Tab */}
        {tab === 'employees' && (
          <>
            <div>
              <label className="label"><Abbr code="Dept">Dept</Abbr> Filter</label>
              <input type="text" placeholder="Filter department..." value={filterDept} onChange={e => setFilterDept(e.target.value)} className="input w-48" />
            </div>
            <div className="card overflow-hidden">
              <div className="card-header">
                <span className="font-semibold text-slate-700">Employee Salary Structures — {filteredEmployees.length} records</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full table-compact text-xs">
                  <thead>
                    <tr>
                      <th><Abbr code="Emp">Employee</Abbr></th>
                      <th><Abbr code="Dept">Dept</Abbr></th>
                      <th>Designation</th>
                      <th>Basic</th>
                      <th><Abbr code="DA">DA</Abbr></th>
                      <th><Abbr code="HRA">HRA</Abbr></th>
                      <th>Conv.</th>
                      <th>Other</th>
                      <th>Gross</th>
                      <th><Abbr code="PF">PF</Abbr></th>
                      <th><Abbr code="ESI">ESI</Abbr></th>
                      <th>Effective</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredEmployees.map(e => (
                      <tr key={e.code}>
                        <td>
                          <div className="font-medium text-sm">{e.name || e.code}</div>
                          <div className="text-xs text-slate-400 font-mono">{e.code}</div>
                        </td>
                        <td className="text-xs text-slate-600">{e.department}</td>
                        <td className="text-xs text-slate-600">{e.designation}</td>
                        <td className="font-mono">{fmtINR(e.basic)}</td>
                        <td className="font-mono">{fmtINR(e.da)}</td>
                        <td className="font-mono">{fmtINR(e.hra)}</td>
                        <td className="font-mono">{fmtINR(e.conveyance)}</td>
                        <td className="font-mono">{fmtINR(e.other_allowances)}</td>
                        <td className="font-mono font-bold">{fmtINR(e.gross_salary)}</td>
                        <td>{e.pf_applicable ? <span className="badge-green text-xs">Yes</span> : <span className="text-slate-400">No</span>}</td>
                        <td>{e.esi_applicable ? <span className="badge-green text-xs">Yes</span> : <span className="text-slate-400">No</span>}</td>
                        <td className="font-mono text-xs">{e.effective_from || '—'}</td>
                        <td>
                          <button onClick={() => openEdit(e)} className="btn-ghost text-xs text-blue-600">Edit</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {/* Pending Approvals Tab */}
        {tab === 'pending' && (
          <div className="space-y-3">
            {pendingChanges.length === 0 ? (
              <div className="card p-8 text-center">
                <p className="text-slate-500">No pending salary change requests.</p>
              </div>
            ) : pendingChanges.map(req => {
              const ns = req.new_structure || {}
              const os = req.old_structure || {}
              return (
                <div key={req.id} className="card p-4 border-l-4 border-l-amber-400">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="font-medium text-sm">{req.employee_name} <span className="font-mono text-xs text-slate-400">({req.employee_code})</span></div>
                      <div className="text-xs text-slate-500">{req.department} | Requested by {req.requested_by}</div>
                      {req.reason && <div className="text-xs text-slate-600 mt-1">Reason: {req.reason}</div>}
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => approveMutation.mutate(req.id)} className="btn-primary text-xs">Approve</button>
                      <button onClick={() => rejectMutation.mutate(req.id)} className="btn-ghost text-xs text-red-600">Reject</button>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4 mt-3 text-xs">
                    <div className="bg-slate-50 p-2 rounded-lg">
                      <p className="font-semibold text-slate-500 mb-1">Current</p>
                      <p>Basic: {fmtINR(os.basic)} | DA: {fmtINR(os.da)} | HRA: {fmtINR(os.hra)}</p>
                      <p className="font-bold">Gross: {fmtINR(req.old_gross)}</p>
                    </div>
                    <div className="bg-blue-50 p-2 rounded-lg">
                      <p className="font-semibold text-blue-600 mb-1">Proposed</p>
                      <p>Basic: {fmtINR(ns.basic)} | DA: {fmtINR(ns.da)} | HRA: {fmtINR(ns.hra)}</p>
                      <p className="font-bold">Gross: {fmtINR(req.new_gross)}</p>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* History Tab */}
        {tab === 'history' && (
          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full table-compact text-xs">
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th>Old Gross</th>
                    <th>New Gross</th>
                    <th>Change</th>
                    <th>Requested By</th>
                    <th>Status</th>
                    <th>Approved By</th>
                    <th>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map(h => (
                    <tr key={h.id}>
                      <td>
                        <div className="font-medium">{h.employee_name}</div>
                        <div className="text-xs text-slate-400">{h.employee_code}</div>
                      </td>
                      <td className="font-mono">{fmtINR(h.old_gross)}</td>
                      <td className="font-mono">{fmtINR(h.new_gross)}</td>
                      <td className={clsx('font-mono font-bold', h.new_gross > h.old_gross ? 'text-green-600' : 'text-red-600')}>
                        {h.new_gross > h.old_gross ? '+' : ''}{fmtINR(h.new_gross - h.old_gross)}
                      </td>
                      <td>{h.requested_by}</td>
                      <td>
                        {h.status === 'Approved' && <span className="badge-green text-xs">Approved</span>}
                        {h.status === 'Rejected' && <span className="badge-red text-xs">Rejected</span>}
                        {h.status === 'Pending' && <span className="badge-yellow text-xs">Pending</span>}
                      </td>
                      <td>{h.approved_by || '—'}</td>
                      <td className="font-mono text-xs">{h.created_at?.split('T')[0] || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Edit Modal */}
        <Modal open={!!editEmployee} onClose={() => setEditEmployee(null)} title={`Edit Salary — ${editEmployee?.name}`} size="md">
          <ModalBody>
            <div className="space-y-3">
              <div className="text-xs text-slate-500 mb-2">
                Current Gross: <span className="font-bold font-mono">{fmtINR(editEmployee?.gross_salary)}</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { key: 'basic', label: 'Basic' },
                  { key: 'da', label: 'DA' },
                  { key: 'hra', label: 'HRA' },
                  { key: 'conveyance', label: 'Conveyance' },
                  { key: 'other_allowances', label: 'Other Allowances' },
                ].map(f => (
                  <div key={f.key}>
                    <label className="label">{f.label}</label>
                    <input
                      type="number" className="input"
                      value={editForm[f.key]}
                      onChange={e => setEditForm(prev => ({ ...prev, [f.key]: parseFloat(e.target.value) || 0 }))}
                    />
                  </div>
                ))}
              </div>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={!!editForm.pf_applicable} onChange={e => setEditForm(prev => ({ ...prev, pf_applicable: e.target.checked ? 1 : 0 }))} className="rounded" />
                  <Abbr code="PF">PF</Abbr> Applicable
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={!!editForm.esi_applicable} onChange={e => setEditForm(prev => ({ ...prev, esi_applicable: e.target.checked ? 1 : 0 }))} className="rounded" />
                  <Abbr code="ESI">ESI</Abbr> Applicable
                </label>
              </div>
              <div className="bg-blue-50 p-3 rounded-xl border border-blue-200">
                <span className="text-sm text-blue-700">New Gross: </span>
                <span className="text-lg font-bold text-blue-800 font-mono">{fmtINR(newGross)}</span>
                {editEmployee?.gross_salary && newGross !== editEmployee.gross_salary && (
                  <span className={clsx('ml-2 text-sm font-bold', newGross > editEmployee.gross_salary ? 'text-green-600' : 'text-red-600')}>
                    ({newGross > editEmployee.gross_salary ? '+' : ''}{fmtINR(newGross - editEmployee.gross_salary)})
                  </span>
                )}
              </div>
              <div>
                <label className="label">Reason for Change</label>
                <textarea className="textarea w-full" rows={2} value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g., Annual increment, promotion..." />
              </div>
            </div>
          </ModalBody>
          <ModalFooter>
            <button onClick={() => requestChangeMutation.mutate()} disabled={requestChangeMutation.isPending} className="btn-primary text-sm">
              {requestChangeMutation.isPending ? 'Submitting...' : 'Submit for Approval'}
            </button>
            <button onClick={() => setEditEmployee(null)} className="btn-ghost text-sm">Cancel</button>
          </ModalFooter>
        </Modal>

        <AbbreviationLegend keys={['PF', 'ESI', 'DA', 'HRA', 'Dept', 'Emp']} />
      </div>
    </div>
  )
}
