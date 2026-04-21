import React, { useState, useEffect, useMemo } from 'react'
import toast from 'react-hot-toast'
import Modal, { ModalBody, ModalFooter } from '../ui/Modal'
import ScreenshotInput from './ScreenshotInput'
import AudioUploader from './AudioUploader'
import VoiceRecorder from './VoiceRecorder'
import AutoContextPreview from './AutoContextPreview'
import { useAppStore } from '../../store/appStore'
import { buildAutoContext } from '../../utils/apiContextBuffer'
import { submitBugReport } from '../../api/bugReports'

// Infers a friendly "page name" from the current URL. Matches the canonical
// names in policy_config.bug_report_known_pages_json so Claude's extraction
// doesn't fall back to "Other / Cannot identify".
function inferPageName(pathname) {
  if (!pathname) return null
  const map = [
    [/^\/pipeline\/salary/,       'Salary Computation (Stage 7 results, list of employees with net/gross/deductions)'],
    [/^\/pipeline\/day-calc/,     'Day Calculation (Stage 6, per-employee day-by-day attendance)'],
    [/^\/pipeline\/corrections/,  'Attendance Register (raw attendance, calendar grid view)'],
    [/^\/pipeline\/miss-punch/,   'Miss Punch Resolution (Stage 2, list of incomplete punches)'],
    [/^\/finance-audit/,          'Finance Audit Dashboard (3-tab view: audit / employee review / red flags)'],
    [/^\/finance-verification/,   'Finance Verification (miss-punch and extra-duty review queues)'],
    [/^\/analytics\/punctuality/, 'Late Coming Management (Analytics → Punctuality)'],
    [/^\/employees/,              'Employee Master (employee list, edit modal)'],
    [/^\/salary-advance/,         'Salary Advance / Loan Recovery'],
    [/^\/settings\/shifts/,       'Settings → Shifts (shift master)'],
    [/^\/daily-mis/,              'Daily MIS (today\'s attendance summary)'],
    [/^\/held-salaries/,          'Held Salaries Register'],
    [/^\/extra-duty-grants/,      'Extra Duty Grants'],
    [/^\/payable-ot/,             'OT & ED Payable Register'],
    [/^\/reports/,                'Reports / Exports (PF ECR, ESI, Bank NEFT)'],
    [/^\/admin\/query-tool/,      'Query Tool (admin SQL workbench)'],
    [/^\/session-analytics/,      'Session Analytics (admin)'],
  ]
  for (const [re, name] of map) if (re.test(pathname)) return name
  return null
}

export default function BugReportModal() {
  const open    = useAppStore((s) => s.bugReportModalOpen)
  const close   = useAppStore((s) => s.closeBugReportModal)
  const user    = useAppStore((s) => s.user)
  const selMonth = useAppStore((s) => s.selectedMonth)
  const selYear  = useAppStore((s) => s.selectedYear)
  const selCo    = useAppStore((s) => s.selectedCompany)

  const [inputMethod, setInputMethod] = useState('recorded')
  const [screenshot,  setScreenshot]  = useState(null)
  const [audio,       setAudio]       = useState(null)
  const [audioSource, setAudioSource] = useState(null)
  const [typedComment, setTypedComment] = useState('')
  const [submitting,   setSubmitting]   = useState(false)
  const [autoContext,  setAutoContext]  = useState(null)

  // Snapshot auto-context the instant the modal opens. Doing this eagerly
  // (not at submit time) guarantees we capture the API-call ring exactly as
  // it was when the user decided something looked wrong, not whatever has
  // happened during the 30s they spent composing.
  useEffect(() => {
    if (!open) return
    setAutoContext(buildAutoContext())
  }, [open])

  // Reset form state on close so the next open starts clean.
  useEffect(() => {
    if (open) return
    setInputMethod('recorded')
    setScreenshot(null)
    setAudio(null)
    setAudioSource(null)
    setTypedComment('')
    setSubmitting(false)
    setAutoContext(null)
  }, [open])

  const pageName = useMemo(() => inferPageName(autoContext?.path), [autoContext])

  function switchMethod(m) {
    setInputMethod(m)
    // Keep screenshot across method switches — only audio/typed are path-specific.
    setAudio(null)
    setAudioSource(m === 'recorded' ? 'recorded' : m === 'uploaded' ? 'uploaded' : null)
    if (m !== 'typed') setTypedComment('')
  }

  function validate() {
    if (!screenshot) return 'Please attach a screenshot.'
    if (inputMethod === 'recorded' && !audio) return 'Please record your description, or switch to Upload / Type.'
    if (inputMethod === 'uploaded' && !audio) return 'Please choose an audio file.'
    if (inputMethod === 'typed' && !typedComment.trim()) return 'Please type a description.'
    return null
  }

  async function handleSubmit() {
    const err = validate()
    if (err) { toast.error(err); return }
    setSubmitting(true)
    try {
      const fd = new FormData()
      fd.append('screenshot', screenshot)
      if (audio) fd.append('audio', audio)
      const payload = {
        input_method: inputMethod,
        audio_source: inputMethod === 'typed' ? null : (audioSource || inputMethod),
        user_typed_comment: inputMethod === 'typed' ? typedComment.trim() : null,
        page_url: window.location.href,
        page_name: pageName,
        selected_month: selMonth || null,
        selected_year:  selYear  || null,
        selected_company: selCo || null,
        reporter_username: user?.username || 'unknown',
        reporter_role: user?.role || 'unknown',
        auto_context: autoContext,
      }
      fd.append('payload', JSON.stringify(payload))
      await submitBugReport(fd)
      toast.success('Reported, thanks — we\'ll look at it.')
      close()
    } catch (e) {
      // Rate-limit is the one error worth surfacing inline in addition to the
      // global toast interceptor — the user may want to copy their typed text
      // before closing.
      if (e?.response?.status === 429) {
        toast.error('Too many reports in the last hour — please try again later.')
      }
      // Other errors already toasted by the axios interceptor; re-enable submit.
      setSubmitting(false)
    }
  }

  if (!open) return null

  return (
    <Modal open={open} onClose={submitting ? undefined : close} title="Report an issue" size="lg">
      <ModalBody className="space-y-4">
        {pageName && (
          <div className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded px-2 py-1.5">
            Detected page: <span className="font-medium text-slate-700">{pageName}</span>
          </div>
        )}

        <ScreenshotInput value={screenshot} onChange={setScreenshot} disabled={submitting} />

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">
            Describe the issue <span className="text-red-600">*</span>
          </label>
          <div className="flex gap-1.5 mb-2">
            {[
              { key: 'recorded', label: 'Record now' },
              { key: 'uploaded', label: 'Upload audio' },
              { key: 'typed',    label: 'Type instead' },
            ].map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => switchMethod(tab.key)}
                disabled={submitting}
                className={`px-3 py-1.5 text-sm rounded-md border transition-colors ${
                  inputMethod === tab.key
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {inputMethod === 'recorded' && (
            <VoiceRecorder value={audio} onChange={(f) => { setAudio(f); setAudioSource('recorded') }} disabled={submitting} />
          )}
          {inputMethod === 'uploaded' && (
            <AudioUploader value={audio} onChange={(f) => { setAudio(f); setAudioSource('uploaded') }} disabled={submitting} />
          )}
          {inputMethod === 'typed' && (
            <textarea
              value={typedComment}
              onChange={(e) => setTypedComment(e.target.value)}
              disabled={submitting}
              rows={4}
              maxLength={2000}
              placeholder="What did you expect? What actually happened?"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          )}
        </div>

        <AutoContextPreview context={autoContext} />
      </ModalBody>
      <ModalFooter>
        <button
          type="button"
          onClick={close}
          disabled={submitting}
          className="px-4 py-2 text-sm rounded-md border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitting}
          className="px-4 py-2 text-sm rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {submitting ? 'Submitting…' : 'Submit report'}
        </button>
      </ModalFooter>
    </Modal>
  )
}
