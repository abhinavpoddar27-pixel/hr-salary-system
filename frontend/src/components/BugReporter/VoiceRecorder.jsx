import React, { useState, useRef, useEffect } from 'react'

const MAX_SEC = 120 // hard cap — plan §4.5
const MIME_CHAIN = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4;codecs=mp4a.40.2', // Safari iOS
  'audio/mp4',
  'audio/mpeg',
]

function pickMime() {
  if (typeof MediaRecorder === 'undefined') return null
  for (const m of MIME_CHAIN) {
    try { if (MediaRecorder.isTypeSupported(m)) return m } catch (_e) { /* continue */ }
  }
  return null // browser picks default
}

function ext(mime) {
  if (!mime) return 'bin'
  if (mime.includes('webm')) return 'webm'
  if (mime.includes('mp4'))  return 'm4a'
  if (mime.includes('mpeg')) return 'mp3'
  if (mime.includes('ogg'))  return 'ogg'
  return 'bin'
}

// In-browser voice capture. MediaRecorder with a fallback mime chain so iOS
// Safari (which rejects webm-opus) still works. 120s cap enforced in-component;
// no post-processing beyond turning the chunks into a Blob.
export default function VoiceRecorder({ value, onChange, disabled }) {
  const [recording, setRecording] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState(null)
  const [previewUrl, setPreviewUrl] = useState(null)
  const recorderRef = useRef(null)
  const chunksRef = useRef([])
  const streamRef = useRef(null)
  const tickRef = useRef(null)
  const startRef = useRef(0)

  useEffect(() => {
    if (!value) { setPreviewUrl(null); return }
    const u = URL.createObjectURL(value)
    setPreviewUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [value])

  useEffect(() => () => {
    // On unmount, stop any in-flight recorder so the mic indicator clears.
    try { recorderRef.current?.stop() } catch (_e) { /* ignore */ }
    try { streamRef.current?.getTracks().forEach(t => t.stop()) } catch (_e) { /* ignore */ }
    if (tickRef.current) clearInterval(tickRef.current)
  }, [])

  async function start() {
    setError(null)
    if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setError('Voice recording is not supported in this browser. Use "Upload audio" or "Type instead".')
      return
    }
    let stream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (e) {
      setError(
        e?.name === 'NotAllowedError'
          ? 'Microphone permission denied. Grant access in browser settings and try again.'
          : `Couldn't access microphone: ${e?.message || 'unknown error'}.`
      )
      return
    }
    streamRef.current = stream
    const mimeType = pickMime()
    let recorder
    try {
      recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream)
    } catch (_e) {
      try { recorder = new MediaRecorder(stream) } catch (e2) {
        setError(`Recorder init failed: ${e2.message}`)
        stream.getTracks().forEach(t => t.stop())
        return
      }
    }

    chunksRef.current = []
    recorder.ondataavailable = (e) => { if (e.data?.size > 0) chunksRef.current.push(e.data) }
    recorder.onstop = () => {
      const type = recorder.mimeType || mimeType || 'audio/webm'
      const blob = new Blob(chunksRef.current, { type })
      const file = new File([blob], `recording.${ext(type)}`, { type })
      const durationSec = Math.max(1, Math.floor((Date.now() - startRef.current) / 1000))
      onChange(file, durationSec)
      try { streamRef.current?.getTracks().forEach(t => t.stop()) } catch (_e) { /* ignore */ }
      streamRef.current = null
      setRecording(false)
      if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null }
    }

    recorderRef.current = recorder
    startRef.current = Date.now()
    setElapsed(0)
    recorder.start(250)
    setRecording(true)
    tickRef.current = setInterval(() => {
      const s = Math.floor((Date.now() - startRef.current) / 1000)
      setElapsed(s)
      if (s >= MAX_SEC) stop()
    }, 250)
  }

  function stop() {
    try { recorderRef.current?.stop() } catch (_e) { /* ignore */ }
  }

  function clear() {
    onChange(null)
    setElapsed(0)
  }

  const mm = String(Math.floor(elapsed / 60)).padStart(2, '0')
  const ss = String(elapsed % 60).padStart(2, '0')

  return (
    <div>
      {!recording && !value && (
        <button
          type="button"
          onClick={start}
          disabled={disabled}
          className="w-full px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm font-medium hover:bg-red-100 disabled:opacity-50"
        >
          🎙️ Start recording (max 2 min)
        </button>
      )}
      {recording && (
        <div className="p-3 border border-red-300 bg-red-50 rounded-lg flex items-center gap-3">
          <span className="w-2.5 h-2.5 bg-red-600 rounded-full animate-pulse" />
          <span className="text-sm font-medium text-red-700">Recording — {mm}:{ss}</span>
          <button
            type="button"
            onClick={stop}
            className="ml-auto px-3 py-1 bg-red-600 text-white text-sm rounded hover:bg-red-700"
          >
            Stop
          </button>
        </div>
      )}
      {!recording && value && previewUrl && (
        <div className="p-2 border border-slate-200 rounded-lg bg-slate-50">
          <div className="flex items-center justify-between mb-1.5">
            <div className="text-xs font-medium text-slate-700">Recorded: {value.name}</div>
            <button
              type="button"
              onClick={clear}
              disabled={disabled}
              className="text-xs text-red-600 hover:text-red-800"
            >
              Discard & re-record
            </button>
          </div>
          <audio src={previewUrl} controls className="w-full h-9" />
          <p className="text-xs text-slate-500 mt-1">
            {value.type || 'audio'} · {(value.size / 1024).toFixed(0)} KB
          </p>
        </div>
      )}
      {error && <p className="mt-1.5 text-xs text-red-600">{error}</p>}
    </div>
  )
}
