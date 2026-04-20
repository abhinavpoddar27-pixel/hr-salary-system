import React, { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { useAppStore } from '../../store/appStore'
import { normalizeRole } from '../../utils/role'
import {
  getBugReport, updateBugReport, reanalyzeBugReport,
  bugReportScreenshotUrl, bugReportAudioUrl,
} from '../../api/bugReports'
import { buildTicketSummary, copyToClipboard } from '../../utils/copyTicketSummary'

const STATUSES = ['new', 'triaged', 'in_progress', 'resolved', 'wont_fix', 'duplicate']
const QUALITIES = ['good', 'acceptable', 'bad']

const CONF_COLORS = {
  high:   'bg-emerald-100 text-emerald-700',
  medium: 'bg-amber-100 text-amber-700',
  low:    'bg-red-100 text-red-700',
}

function fmtDate(s) {
  if (!s) return '—'
  try { return new Date(s.replace(' ', 'T') + 'Z').toLocaleString() } catch { return s }
}

function safeParseJson(s) {
  try { return typeof s === 'string' ? JSON.parse(s) : s } catch { return null }
}

export default function BugReportDetail() {
  const { id } = useParams()
  const nav = useNavigate()
  const user = useAppStore((s) => s.user)
  const role = normalizeRole(user?.role)
  const token = useAppStore((s) => s.token)

  const [row, setRow]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving,  setSaving]  = useState(false)
  const [notesDraft, setNotesDraft] = useState('')
  const [feedbackDraft, setFeedbackDraft] = useState('')
  const [showScreenshot, setShowScreenshot] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const res = await getBugReport(id)
      setRow(res.data?.data || res.data)
    } catch (_e) { /* toasted by interceptor */ }
    finally { setLoading(false) }
  }

  useEffect(() => { if (role === 'admin') load() }, [id, role])

  useEffect(() => {
    if (!row) return
    setNotesDraft(row.admin_notes || '')
    setFeedbackDraft(row.admin_feedback_on_extraction || '')
  }, [row?.id])

  async function patch(data) {
    setSaving(true)
    try {
      const res = await updateBugReport(id, data)
      setRow(res.data?.data || res.data)
      toast.success('Saved')
    } finally { setSaving(false) }
  }

  async function handleReanalyze() {
    try {
      await reanalyzeBugReport(id)
      toast.success('Reanalysis queued — refresh in ~30s.')
    } catch (_e) { /* toasted */ }
  }

  async function handleCopySummary() {
    const text = buildTicketSummary(row)
    const ok = await copyToClipboard(text)
    toast[ok ? 'success' : 'error'](ok ? 'Copied ticket summary to clipboard' : 'Copy failed — select & copy manually')
  }

  if (role !== 'admin') {
    return (
      <div className="p-6">
        <div className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-600">
          This page is only available to admins.
        </div>
      </div>
    )
  }
  if (loading) return <div className="p-6 text-sm text-slate-500">Loading…</div>
  if (!row)    return <div className="p-6 text-sm text-slate-500">Report not found.</div>

  const ex   = safeParseJson(row.claude_extraction_json) || {}
  const auto = safeParseJson(row.auto_context_json) || {}
  const conf = ex.summary_confidence || row.claude_summary_confidence

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link to="/admin/bug-reports" className="text-sm text-blue-600 hover:underline">← Back to inbox</Link>
          <h1 className="text-xl font-bold text-slate-800 mt-1">Report #{row.id}</h1>
          <div className="text-sm text-slate-500">
            {row.reporter_username} ({row.reporter_role}) · {fmtDate(row.created_at)}
          </div>
          <div className="text-xs text-slate-400 mt-0.5 truncate max-w-xl">
            {row.page_url || '—'}
          </div>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          {row.audio_path && (
            <a
              href={bugReportAudioUrl(row.id, token)}
              target="_blank"
              rel="noreferrer"
              className="px-3 py-1.5 text-sm rounded-md border border-slate-300 bg-white hover:bg-slate-50"
            >
              ▶ Listen
            </a>
          )}
          <select
            value={row.admin_status}
            disabled={saving}
            onChange={(e) => patch({ admin_status: e.target.value })}
            className="px-3 py-1.5 text-sm rounded-md border border-slate-300 bg-white"
          >
            {STATUSES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
          </select>
          <button
            onClick={handleReanalyze}
            disabled={saving}
            className="px-3 py-1.5 text-sm rounded-md border border-slate-300 bg-white hover:bg-slate-50"
          >
            Reanalyze
          </button>
          <button
            onClick={handleCopySummary}
            className="px-3 py-1.5 text-sm rounded-md bg-slate-800 text-white hover:bg-slate-700"
          >
            Copy ticket summary
          </button>
        </div>
      </div>

      {/* English summary */}
      <section className="bg-white border border-slate-200 rounded-lg p-4">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold text-slate-700">Summary</h2>
          {conf && (
            <span className={`text-xs px-2 py-0.5 rounded ${CONF_COLORS[conf] || 'bg-slate-100 text-slate-600'}`}>
              confidence: {conf}
            </span>
          )}
        </div>
        {row.claude_run_status === 'pending' && <p className="italic text-slate-400 text-sm">Extracting…</p>}
        {row.claude_run_status === 'failed' && (
          <p className="text-sm text-red-600">
            Extraction failed: <span className="font-mono text-xs">{row.claude_error || 'unknown error'}</span>
          </p>
        )}
        {ex.structured_summary ? (
          <p className="text-sm text-slate-700 whitespace-pre-line">{ex.structured_summary}</p>
        ) : row.claude_run_status === 'success' ? (
          <p className="italic text-slate-400 text-sm">No structured summary produced.</p>
        ) : null}
        {ex.page_identified && (
          <p className="mt-2 text-xs text-slate-500">
            Identified page: <span className="font-medium text-slate-700">{ex.page_identified}</span>
            {ex.page_confidence && <> (confidence: {ex.page_confidence})</>}
          </p>
        )}
      </section>

      {/* Screenshot */}
      <section className="bg-white border border-slate-200 rounded-lg p-4">
        <h2 className="text-sm font-semibold text-slate-700 mb-2">Screenshot</h2>
        <img
          src={bugReportScreenshotUrl(row.id, token)}
          alt="reporter screenshot"
          onClick={() => setShowScreenshot(true)}
          className="max-w-full max-h-96 rounded border border-slate-200 cursor-zoom-in"
        />
        {showScreenshot && (
          <div
            onClick={() => setShowScreenshot(false)}
            className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-6 cursor-zoom-out"
          >
            <img src={bugReportScreenshotUrl(row.id, token)} alt="" className="max-h-full max-w-full" />
          </div>
        )}
      </section>

      {/* Audio + transcript */}
      {(row.audio_path || row.transcript_english) && (
        <section className="bg-white border border-slate-200 rounded-lg p-4">
          <h2 className="text-sm font-semibold text-slate-700 mb-2">
            English transcript (auto-translated)
            {row.transcript_detected_language && (
              <span className="ml-2 text-xs font-normal text-slate-500">
                source language detected: {row.transcript_detected_language}
              </span>
            )}
          </h2>
          {row.audio_path && (
            <audio src={bugReportAudioUrl(row.id, token)} controls className="w-full h-9 mb-2" />
          )}
          {row.transcription_status === 'pending' && <p className="italic text-slate-400 text-sm">Transcribing…</p>}
          {row.transcription_status === 'batch_queued' && (
            <p className="italic text-amber-600 text-sm">In Sarvam batch queue — may take a few minutes.</p>
          )}
          {row.transcription_status === 'failed' && (
            <p className="text-sm text-red-600">
              Transcription failed: <span className="font-mono text-xs">{row.transcription_error || 'unknown error'}</span>
            </p>
          )}
          {row.transcript_english && (
            <blockquote className="text-sm text-slate-700 bg-slate-50 rounded p-3 whitespace-pre-line">
              {row.transcript_english}
            </blockquote>
          )}
          {row.user_typed_comment && !row.audio_path && (
            <blockquote className="text-sm text-slate-700 bg-slate-50 rounded p-3 whitespace-pre-line">
              {row.user_typed_comment}
            </blockquote>
          )}
        </section>
      )}
      {row.input_method === 'typed' && (
        <section className="bg-white border border-slate-200 rounded-lg p-4">
          <h2 className="text-sm font-semibold text-slate-700 mb-2">Reporter said</h2>
          <blockquote className="text-sm text-slate-700 bg-slate-50 rounded p-3 whitespace-pre-line">
            {row.user_typed_comment || <span className="italic text-slate-400">empty</span>}
          </blockquote>
        </section>
      )}

      {/* Visible data */}
      {(ex.visible_data && (
        (ex.visible_data.employees_mentioned?.length || 0) +
        (ex.visible_data.amounts_visible?.length || 0) +
        (ex.visible_data.dates_visible?.length || 0) +
        (ex.visible_data.key_values?.length || 0) > 0
      )) && (
        <section className="bg-white border border-slate-200 rounded-lg p-4">
          <h2 className="text-sm font-semibold text-slate-700 mb-2">Visible data</h2>
          <div className="space-y-1.5 text-sm">
            {ex.visible_data.employees_mentioned?.length > 0 && (
              <div><span className="font-medium text-slate-600">Employees:</span> {ex.visible_data.employees_mentioned.join(', ')}</div>
            )}
            {ex.visible_data.amounts_visible?.length > 0 && (
              <div><span className="font-medium text-slate-600">Amounts:</span> {ex.visible_data.amounts_visible.join(', ')}</div>
            )}
            {ex.visible_data.dates_visible?.length > 0 && (
              <div><span className="font-medium text-slate-600">Dates:</span> {ex.visible_data.dates_visible.join(', ')}</div>
            )}
            {ex.visible_data.key_values?.length > 0 && (
              <div>
                <div className="font-medium text-slate-600 mb-1">Key values:</div>
                <ul className="list-disc list-inside text-slate-700 space-y-0.5">
                  {ex.visible_data.key_values.map((kv, i) => (
                    <li key={i}><span className="font-mono text-xs">{kv.label}:</span> {kv.value}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Open questions */}
      {ex.open_questions?.length > 0 && (
        <section className="bg-white border border-slate-200 rounded-lg p-4">
          <h2 className="text-sm font-semibold text-slate-700 mb-2">Open questions</h2>
          <ul className="list-disc list-inside text-sm text-slate-700 space-y-1">
            {ex.open_questions.map((q, i) => <li key={i}>{q}</li>)}
          </ul>
        </section>
      )}

      {/* Auto-context */}
      <section className="bg-white border border-slate-200 rounded-lg p-4">
        <details>
          <summary className="cursor-pointer text-sm font-semibold text-slate-700">Auto-context (click to expand)</summary>
          <div className="mt-2 space-y-1 text-xs text-slate-600">
            <div><span className="font-medium">Month / Year / Company:</span> {row.selected_month || '—'} / {row.selected_year || '—'} / {row.selected_company || '—'}</div>
            <div><span className="font-medium">Viewport:</span> {auto.viewport?.width || '?'}×{auto.viewport?.height || '?'}</div>
            <div><span className="font-medium">User-agent:</span> <span className="font-mono text-[11px]">{auto.user_agent || '—'}</span></div>
            <div>
              <span className="font-medium">Recent API calls:</span>
              <ul className="mt-1 space-y-0.5 font-mono text-[11px]">
                {(auto.recent_api_calls || []).map((c, i) => (
                  <li key={i}>
                    <span className={c.status >= 400 ? 'text-red-600' : 'text-emerald-700'}>{c.status || '—'}</span>{' '}
                    {c.method} {c.url}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </details>
      </section>

      {/* Admin notes + extraction feedback */}
      <section className="bg-white border border-slate-200 rounded-lg p-4 space-y-3">
        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-1">Admin notes</label>
          <textarea
            rows={3}
            value={notesDraft}
            onChange={(e) => setNotesDraft(e.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          <button
            onClick={() => patch({ admin_notes: notesDraft })}
            disabled={saving || notesDraft === (row.admin_notes || '')}
            className="mt-2 px-3 py-1.5 text-sm rounded-md bg-blue-600 text-white disabled:opacity-50"
          >
            Save notes
          </button>
        </div>

        <div className="pt-3 border-t border-slate-100">
          <label className="block text-sm font-semibold text-slate-700 mb-1">Extraction quality</label>
          <div className="flex gap-2 mb-2">
            {QUALITIES.map((q) => (
              <button
                key={q}
                onClick={() => patch({ admin_extraction_quality: q })}
                className={`px-3 py-1 text-sm rounded-md border ${
                  row.admin_extraction_quality === q
                    ? 'bg-slate-800 text-white border-slate-800'
                    : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                }`}
              >
                {q}
              </button>
            ))}
          </div>
          <textarea
            rows={2}
            value={feedbackDraft}
            onChange={(e) => setFeedbackDraft(e.target.value)}
            placeholder="Why? (helps iterate the extraction prompt)"
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          <button
            onClick={() => patch({ admin_feedback_on_extraction: feedbackDraft })}
            disabled={saving || feedbackDraft === (row.admin_feedback_on_extraction || '')}
            className="mt-2 px-3 py-1.5 text-sm rounded-md border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-50"
          >
            Save feedback
          </button>
        </div>
      </section>

      {row.resolved_at && (
        <div className="text-xs text-slate-500 text-right">
          Resolved by {row.resolved_by || '—'} at {fmtDate(row.resolved_at)}
        </div>
      )}
    </div>
  )
}
