import React, { useEffect, useMemo, useRef, useState } from 'react'

/**
 * Type-to-search employee picker. Replaces a <select> over hundreds of
 * employees: the user types part of a code or a name and picks from the
 * matches. Keyboard: ↑/↓ move, Enter picks, Esc closes.
 *
 * Props:
 *   employees   [{ code, name, department? }]
 *   value       selected employee code ('' when none)
 *   onChange    (code) => void — '' when cleared
 *   placeholder input placeholder
 *   inputClassName  classes for the input (defaults to the app's `input w-full`)
 */
const MAX_RESULTS = 50

export default function EmployeeSearchSelect({
  employees = [],
  value = '',
  onChange,
  placeholder = 'Type code or name…',
  inputClassName = 'input w-full',
  id,
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const boxRef = useRef(null)
  const listRef = useRef(null)

  const selected = useMemo(
    () => employees.find((e) => String(e.code) === String(value)) || null,
    [employees, value]
  )

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return employees.slice(0, MAX_RESULTS)
    const out = []
    for (const e of employees) {
      const code = String(e.code || '').toLowerCase()
      const name = String(e.name || '').toLowerCase()
      if (code.includes(q) || name.includes(q)) out.push(e)
    }
    // Exact / prefix code matches first, then the rest in their original order.
    out.sort((a, b) => rank(a, q) - rank(b, q))
    return out.slice(0, MAX_RESULTS)
  }, [employees, query])

  useEffect(() => { setActive(0) }, [query])

  // Close when clicking outside.
  useEffect(() => {
    if (!open) return undefined
    const onDown = (ev) => {
      if (boxRef.current && !boxRef.current.contains(ev.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  // Keep the highlighted row in view.
  useEffect(() => {
    const el = listRef.current?.children?.[active]
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' })
  }, [active])

  const pick = (emp) => {
    onChange?.(emp ? String(emp.code) : '')
    setQuery('')
    setOpen(false)
  }

  const onKeyDown = (ev) => {
    if (ev.key === 'ArrowDown') {
      ev.preventDefault()
      setOpen(true)
      setActive((i) => Math.min(i + 1, Math.max(matches.length - 1, 0)))
    } else if (ev.key === 'ArrowUp') {
      ev.preventDefault()
      setActive((i) => Math.max(i - 1, 0))
    } else if (ev.key === 'Enter') {
      if (open && matches[active]) {
        ev.preventDefault()
        pick(matches[active])
      }
    } else if (ev.key === 'Escape' && open) {
      // Close only the list. Modal.jsx closes on a document-level Escape, so
      // without this the whole form (and what was typed) would be lost.
      // With the list already closed, Escape reaches the modal as before.
      ev.preventDefault()
      ev.stopPropagation()
      setOpen(false)
    }
  }

  // While the list is closed and someone is selected, show "code – name".
  const shown = open ? query : (selected ? `${selected.code} – ${selected.name}` : query)

  return (
    <div className="relative" ref={boxRef}>
      <input
        id={id}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        autoComplete="off"
        className={`${inputClassName} pr-8`}
        placeholder={selected ? `${selected.code} – ${selected.name}` : placeholder}
        value={shown}
        onFocus={() => { setQuery(''); setOpen(true) }}
        // A click on a box that is still focused (e.g. right after a pick)
        // fires no focus event, so open the list here too.
        onClick={() => { if (!open) { setQuery(''); setOpen(true) } }}
        onChange={(e) => {
          let typed = e.target.value
          // Typing straight after a pick: the box was showing "code – name";
          // start a fresh search with only what was just typed.
          if (!open && selected) {
            const label = `${selected.code} – ${selected.name}`
            typed = typed.startsWith(label) ? typed.slice(label.length) : typed
          }
          setQuery(typed)
          setOpen(true)
        }}
        onKeyDown={onKeyDown}
      />
      {selected && !open && (
        <button
          type="button"
          aria-label="Clear employee"
          className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 text-sm leading-none"
          onClick={() => pick(null)}
        >
          ✕
        </button>
      )}
      {open && (
        <ul
          ref={listRef}
          role="listbox"
          className="absolute z-50 mt-1 w-full max-h-64 overflow-auto rounded-md border border-slate-200 bg-white shadow-lg text-sm"
        >
          {matches.length === 0 ? (
            <li className="px-3 py-2 text-slate-400">No employee matches “{query}”</li>
          ) : matches.map((e, i) => (
            <li
              key={e.code}
              role="option"
              aria-selected={String(e.code) === String(value)}
              className={`px-3 py-1.5 cursor-pointer flex justify-between gap-2 ${
                i === active ? 'bg-blue-50' : ''
              } ${String(e.code) === String(value) ? 'font-semibold' : ''}`}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(ev) => { ev.preventDefault(); pick(e) }}
            >
              <span><span className="font-mono text-slate-700">{e.code}</span> – {e.name}</span>
              {e.department && <span className="text-xs text-slate-400 truncate">{e.department}</span>}
            </li>
          ))}
          {matches.length === MAX_RESULTS && (
            <li className="px-3 py-1.5 text-[11px] text-slate-400 border-t">Showing the first {MAX_RESULTS} — type more to narrow.</li>
          )}
        </ul>
      )}
    </div>
  )
}

function rank(e, q) {
  const code = String(e.code || '').toLowerCase()
  if (code === q) return 0
  if (code.startsWith(q)) return 1
  if (String(e.name || '').toLowerCase().startsWith(q)) return 2
  return 3
}
