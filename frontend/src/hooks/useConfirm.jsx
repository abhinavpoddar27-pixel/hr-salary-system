import React, { useLayoutEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import ConfirmDialog from '../components/ui/ConfirmDialog'

/**
 * useConfirm (P2-01) — promise-based replacements for window.confirm /
 * window.prompt / window.alert, drawn with ConfirmDialog.
 *
 *   const ok = await confirmDialog({ title, message, confirmText, variant })   // true | false
 *   const text = await promptDialog({ title, message, confirmText })          // string | null
 *   await alertDialog({ title, message })                                     // resolves on OK
 *
 *   const { confirm, prompt, alert } = useConfirm()   // same three functions
 *
 * Self-mounting: the first call adds <div id="hr-dialog-root"> to <body> and
 * renders a small host there in its own React root, so no provider is needed
 * in App.jsx / main.jsx. One dialog at a time; later calls wait their turn.
 * The host has no router / react-query context — it only shows text, an
 * optional text input and buttons.
 *
 * Do not raise one of these from INSIDE an open <Modal>: the Modal would see
 * the click on this dialog as an outside click and close itself.
 */

let root = null
let push = null
const pending = []

function ensureHost() {
  if (root || typeof document === 'undefined') return
  const el = document.createElement('div')
  el.id = 'hr-dialog-root'
  document.body.appendChild(el)
  root = createRoot(el)
  root.render(<DialogHost />)
}

function enqueue(kind, opts) {
  return new Promise((resolve) => {
    const item = { kind, opts: opts || {}, resolve, id: Math.random().toString(36).slice(2) }
    if (push) push(item)
    else pending.push(item)
    ensureHost()
  })
}

function asOpts(opts) {
  return typeof opts === 'string' ? { message: opts } : (opts || {})
}

export function confirmDialog(opts) { return enqueue('confirm', asOpts(opts)) }
export function promptDialog(opts) { return enqueue('prompt', asOpts(opts)) }
export function alertDialog(opts) { return enqueue('alert', asOpts(opts)) }

const API = { confirm: confirmDialog, prompt: promptDialog, alert: alertDialog }
export function useConfirm() { return API }
export default useConfirm

function DialogHost() {
  const [queue, setQueue] = useState([])

  useLayoutEffect(() => {
    push = (item) => setQueue(q => [...q, item])
    if (pending.length) {
      const drained = pending.splice(0)
      setQueue(q => [...q, ...drained])
    }
    return () => { push = null }
  }, [])

  const current = queue[0]
  if (!current) return null

  const finish = (value) => {
    current.resolve(value)
    setQueue(q => q.slice(1))
  }

  return <OneDialog key={current.id} item={current} finish={finish} />
}

function OneDialog({ item, finish: finishOnce }) {
  const { kind, opts } = item
  const [text, setText] = useState(opts.defaultValue || '')
  const inputRef = useRef(null)
  // A double click (or Enter + click) must answer once — a second answer would
  // drop the NEXT queued dialog.
  const answered = useRef(false)
  // A dialog that follows another (queue, or prompt → alert) ignores answers in its first
  // 300 ms, so the second click of a double click cannot answer it unseen.
  const shownAt = useRef(Date.now())
  const finish = (value) => {
    if (answered.current) return
    if (Date.now() - shownAt.current < 300) return
    answered.current = true
    finishOnce(value)
  }

  const message = (
    <span className="block whitespace-pre-line break-words max-h-[55vh] overflow-y-auto">{opts.message}</span>
  )

  if (kind === 'alert') {
    return (
      <ConfirmDialog
        title={opts.title || 'Notice'}
        message={message}
        confirmText={opts.confirmText || 'OK'}
        variant={opts.variant || 'warning'}
        showCancel={false}
        onConfirm={() => finish(undefined)}
        onCancel={() => finish(undefined)}
      />
    )
  }

  if (kind === 'prompt') {
    return (
      <ConfirmDialog
        title={opts.title || 'Enter a value'}
        message={message}
        confirmText={opts.confirmText || 'OK'}
        cancelText={opts.cancelText || 'Cancel'}
        variant={opts.variant || 'warning'}
        initialFocus={inputRef}
        onConfirm={() => finish(text)}
        onCancel={() => finish(null)}
      >
        <input
          ref={inputRef}
          type="text"
          value={text}
          aria-label={opts.inputLabel || opts.title || 'Value'}
          placeholder={opts.placeholder || ''}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); finish(text) } }}
          className="mt-3 w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </ConfirmDialog>
    )
  }

  return (
    <ConfirmDialog
      title={opts.title || 'Are you sure?'}
      message={message}
      confirmText={opts.confirmText || 'Confirm'}
      cancelText={opts.cancelText || 'Cancel'}
      variant={opts.variant || 'danger'}
      onConfirm={() => finish(true)}
      onCancel={() => finish(false)}
    />
  )
}
