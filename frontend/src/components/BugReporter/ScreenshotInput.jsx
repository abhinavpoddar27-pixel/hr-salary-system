import React, { useState, useRef, useEffect } from 'react'

const MAX_BYTES = 10 * 1024 * 1024 // matches backend SCREENSHOT_MAX_BYTES
const ACCEPT = 'image/png,image/jpeg,image/webp,image/gif'

// Screenshot picker with a tiny preview thumbnail. No canvas compression —
// the backend caps at 10MB so we just enforce client-side and let the user
// re-pick if they exceed. Paste-from-clipboard is the other common path;
// we listen for `paste` events while the modal is open so users can Ctrl-V
// after taking a screenshot with their OS tool.
export default function ScreenshotInput({ value, onChange, disabled }) {
  const [error, setError] = useState(null)
  const inputRef = useRef(null)
  const [previewUrl, setPreviewUrl] = useState(null)

  useEffect(() => {
    if (!value) { setPreviewUrl(null); return }
    const url = URL.createObjectURL(value)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [value])

  useEffect(() => {
    const onPaste = (e) => {
      if (disabled) return
      const items = e.clipboardData?.items || []
      for (const item of items) {
        if (item.type?.startsWith('image/')) {
          const file = item.getAsFile()
          if (file) { accept(file); e.preventDefault(); return }
        }
      }
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  }, [disabled])

  function accept(file) {
    if (!file) return
    if (!file.type?.startsWith('image/')) {
      setError('File must be an image (PNG, JPEG, WebP, GIF).')
      return
    }
    if (file.size > MAX_BYTES) {
      setError(`Screenshot too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Max 10MB.`)
      return
    }
    setError(null)
    onChange(file)
  }

  function handleFile(e) {
    const file = e.target.files?.[0]
    accept(file)
  }

  function clear() {
    onChange(null)
    setError(null)
    if (inputRef.current) inputRef.current.value = ''
  }

  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-1.5">
        Screenshot <span className="text-red-600">*</span>
      </label>
      {!value && (
        <div className="border-2 border-dashed border-slate-300 rounded-lg p-4 text-center">
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            onChange={handleFile}
            disabled={disabled}
            className="hidden"
            id="bug-screenshot-input"
          />
          <label
            htmlFor="bug-screenshot-input"
            className="cursor-pointer inline-block px-3 py-1.5 bg-white border border-slate-300 rounded-md text-sm hover:bg-slate-50"
          >
            Choose file
          </label>
          <p className="mt-2 text-xs text-slate-500">
            or press <kbd className="px-1 py-0.5 border border-slate-300 rounded text-[10px]">Ctrl</kbd>+<kbd className="px-1 py-0.5 border border-slate-300 rounded text-[10px]">V</kbd> to paste
          </p>
          <p className="text-xs text-slate-400 mt-1">PNG / JPEG / WebP, max 10MB</p>
        </div>
      )}
      {value && previewUrl && (
        <div className="flex items-start gap-3 p-2 border border-slate-200 rounded-lg bg-slate-50">
          <img src={previewUrl} alt="screenshot preview" className="w-24 h-24 object-contain rounded bg-white border border-slate-100" />
          <div className="flex-1 min-w-0">
            <div className="text-xs font-medium text-slate-700 truncate">{value.name}</div>
            <div className="text-xs text-slate-500">
              {value.type} · {(value.size / 1024).toFixed(0)} KB
            </div>
            <button
              type="button"
              onClick={clear}
              disabled={disabled}
              className="mt-1 text-xs text-red-600 hover:text-red-800"
            >
              Remove
            </button>
          </div>
        </div>
      )}
      {error && <p className="mt-1.5 text-xs text-red-600">{error}</p>}
    </div>
  )
}
