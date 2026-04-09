import React, { useState, useEffect } from 'react'
import Modal, { ModalBody, ModalFooter } from './Modal'
import { fmtINR } from '../../utils/formatters'

/**
 * ReleaseHoldModal — shared release flow for held salaries.
 *
 * Used by three entry points (April 2026):
 *   - Stage 7 Salary Computation per-row Release button
 *   - Finance Verification → Held Salaries tab
 *   - Held Salaries Register → Currently Held tab
 *
 * Consolidating the UI here guarantees every release path enforces the
 * same paper-verification notes requirement and writes the same audit
 * row to salary_hold_releases (via the gated
 * /api/payroll/salary/:code/hold-release endpoint).
 *
 * Props:
 *   open      — bool, modal visibility
 *   onClose   — () => void
 *   employee  — { code, name, department, hold_reason, net_salary, month, year } or null
 *   pending   — bool, disable Submit while the mutation is running
 *   onSubmit  — (releaseNotes: string) => void, called when Submit is clicked
 */
export default function ReleaseHoldModal({ open, onClose, employee, pending, onSubmit }) {
  const [notes, setNotes] = useState('')

  // Reset the notes field every time the modal opens for a new row.
  // Without this a stale note from the previous release leaks into
  // the next one — a subtle but dangerous audit-trail bug.
  useEffect(() => {
    if (open) setNotes('')
  }, [open, employee?.code])

  const canSubmit = notes.trim().length > 0 && !pending

  const handleSubmit = () => {
    if (!canSubmit) return
    onSubmit(notes.trim())
  }

  return (
    <Modal open={open} onClose={onClose} title="Release Held Salary" size="md">
      <ModalBody>
        {employee && (
          <div className="space-y-3">
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs">
              <div className="font-semibold text-amber-900">{employee.name || employee.code}
                <span className="text-slate-500 font-normal"> ({employee.code})</span>
              </div>
              <div className="text-slate-600 mt-1">{employee.department}</div>
              {employee.net_salary != null && (
                <div className="text-slate-600 mt-1">Net salary: <span className="font-mono font-semibold text-slate-800">{fmtINR(employee.net_salary)}</span></div>
              )}
              {employee.hold_reason && (
                <div className="mt-2 pt-2 border-t border-amber-200">
                  <div className="text-[10px] uppercase tracking-wide text-amber-700 font-semibold">Hold reason</div>
                  <div className="text-amber-900 mt-0.5">{employee.hold_reason}</div>
                </div>
              )}
            </div>
            <div>
              <label className="label">
                Release Notes <span className="text-red-500">*</span>
              </label>
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                className="input w-full h-24 text-sm"
                placeholder="Paper verification reference — e.g. &quot;HR manager sign-off form 2026-04-08-07&quot;, &quot;Verified attendance register pages 14-15&quot;, etc."
                autoFocus
              />
              <div className="text-[10px] text-slate-400 mt-1">
                This note is permanently stored in the release audit trail and appears on the Release Report.
              </div>
            </div>
          </div>
        )}
      </ModalBody>
      <ModalFooter>
        <button
          onClick={handleSubmit}
          disabled={!canSubmit}
          className="btn-primary text-sm"
          title={canSubmit ? 'Release this salary' : 'Notes are required'}
        >
          {pending ? 'Releasing...' : 'Release Salary'}
        </button>
        <button onClick={onClose} className="btn-ghost text-sm">Cancel</button>
      </ModalFooter>
    </Modal>
  )
}
