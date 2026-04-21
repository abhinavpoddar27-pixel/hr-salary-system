import React, { useState, useEffect } from 'react'
import toast from 'react-hot-toast'

const MAX_BYTES = 25 * 1024 * 1024 // mirrors backend AUDIO_MAX_BYTES
const ACCEPT = 'audio/*,.m4a,.mp3,.wav,.webm,.ogg,.opus'

function probeAudioDuration(objectUrl) {
  return new Promise((resolve, reject) => {
    const audio = new Audio()
    audio.preload = 'metadata'
    const cleanup = () => {
      audio.onloadedmetadata = null
      audio.onerror = null
    }
    audio.onloadedmetadata = () => {
      cleanup()
      const d = audio.duration
      if (!Number.isFinite(d) || d <= 0) {
        reject(new Error('duration not finite or <= 0'))
      } else {
        resolve(d)
      }
    }
    audio.onerror = () => {
      cleanup()
      reject(new Error('audio element error'))
    }
    audio.src = objectUrl
  })
}

// File picker for pre-recorded audio (WhatsApp voice note, phone recording,
// etc.). Duration probed via HTML5 Audio metadata. If the probe fails the
// file is rejected client-side (backend requires audio_duration_sec > 0).
export default function AudioUploader({ value, onChange, disabled }) {
  const [error, setError] = useState(null)
  const [url, setUrl] = useState(null)

  useEffect(() => {
    if (!value) { setUrl(null); return }
    const u = URL.createObjectURL(value)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [value])

  async function handleFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type?.startsWith('audio/') && !/\.(m4a|mp3|wav|webm|ogg|opus)$/i.test(file.name)) {
      setError('File must be an audio recording.')
      return
    }
    if (file.size > MAX_BYTES) {
      setError(`Audio too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Max 25MB.`)
      return
    }
    setError(null)

    const probeUrl = URL.createObjectURL(file)
    try {
      const durationSec = await probeAudioDuration(probeUrl)
      onChange(file, Math.max(1, Math.round(durationSec)))
    } catch (err) {
      console.warn('[AudioUploader] duration probe failed:', err.message)
      toast.error('Could not read audio duration. Try a different file format.')
      e.target.value = ''
      return
    } finally {
      URL.revokeObjectURL(probeUrl)
    }
  }

  function clear() { onChange(null); setError(null) }

  return (
    <div>
      {!value && (
        <div className="border border-dashed border-slate-300 rounded-lg p-3 text-center">
          <input
            type="file"
            accept={ACCEPT}
            onChange={handleFile}
            disabled={disabled}
            className="hidden"
            id="bug-audio-upload"
          />
          <label
            htmlFor="bug-audio-upload"
            className="cursor-pointer inline-block px-3 py-1.5 bg-white border border-slate-300 rounded-md text-sm hover:bg-slate-50"
          >
            Choose audio file
          </label>
          <p className="mt-1 text-xs text-slate-400">
            Voice note / phone recording. Keep it under 4 minutes (25MB cap).
          </p>
        </div>
      )}
      {value && url && (
        <div className="p-2 border border-slate-200 rounded-lg bg-slate-50">
          <div className="flex items-center justify-between mb-1.5">
            <div className="text-xs font-medium text-slate-700 truncate flex-1">{value.name}</div>
            <button
              type="button"
              onClick={clear}
              disabled={disabled}
              className="ml-2 text-xs text-red-600 hover:text-red-800"
            >
              Remove
            </button>
          </div>
          <audio src={url} controls className="w-full h-9" />
          <p className="text-xs text-slate-500 mt-1">
            {value.type || 'audio'} · {(value.size / 1024 / 1024).toFixed(2)} MB
          </p>
        </div>
      )}
      {error && <p className="mt-1.5 text-xs text-red-600">{error}</p>}
    </div>
  )
}
