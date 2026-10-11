import React, { useEffect, useMemo, useRef, useState } from 'react'
import parseCodes from '../../utils/parseCodes'

/**
 * PeoplePicker — choose many employees at once (P2-07; used by bulk entry, P3-01).
 *
 * Three ways to add people, all feeding one selected tray:
 *   1. Paste codes (an Excel column, a CSV row, a message) → parseCodes()
 *   2. Tick people, or tick a whole department
 *   3. Search by name / code / department, then tick
 *
 * Props-only: the CALLER fetches employees. To offer the "Include people who have
 * left" toggle, pass Active AND Left employees (e.g. getEmployees() without a
 * status filter) and set `allowLeft`. With only Active employees passed, the
 * toggle has nothing to add.
 *
 * Props:
 *   employees   [{ code, name, department?, status? }]  status 'Left'/'Exited' = has left
 *   value       array of selected codes (text)
 *   onChange    (codes) => void
 *   allowLeft   show the "Include people who have left" toggle (default false)
 *   maxHeight   CSS max-height of the department list (default '24rem')
 */
const NO_DEPT = 'No department'
const isLeft = (e) => /^(left|exited)$/i.test(String(e?.status || '').trim())

export default function PeoplePicker({
  employees = [],
  value = [],
  onChange,
  allowLeft = false,
  maxHeight = '24rem',
}) {
  const [search, setSearch] = useState('')
  const [includeLeft, setIncludeLeft] = useState(false)
  const [openDepts, setOpenDepts] = useState(() => new Set())
  const [paste, setPaste] = useState('')
  const [pasteResult, setPasteResult] = useState(null)

  const showLeft = allowLeft && includeLeft
  const selected = useMemo(() => (Array.isArray(value) ? value.map(String) : []), [value])
  const selectedSet = useMemo(() => new Set(selected), [selected])

  const byCode = useMemo(() => {
    const m = new Map()
    for (const e of employees) if (e && e.code != null) m.set(String(e.code), e)
    return m
  }, [employees])

  const leftCount = useMemo(() => employees.filter(isLeft).length, [employees])

  // People offered for ticking: Active, plus Left when the toggle is on.
  const pool = useMemo(
    () => employees.filter((e) => e && e.code != null && (showLeft || !isLeft(e))),
    [employees, showLeft]
  )

  // Department groups, largest first (ties by name), "No department" last.
  const groups = useMemo(() => {
    const m = new Map()
    for (const e of pool) {
      const d = String(e.department || '').trim() || NO_DEPT
      if (!m.has(d)) m.set(d, [])
      m.get(d).push(e)
    }
    const q = search.trim().toLowerCase()
    const out = []
    for (const [dept, people] of m) {
      const sorted = [...people].sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))
      const deptHit = q && dept.toLowerCase().includes(q)
      const visible = !q || deptHit
        ? sorted
        : sorted.filter((e) =>
            String(e.code).toLowerCase().includes(q) || String(e.name || '').toLowerCase().includes(q))
      if (visible.length) out.push({ dept, size: people.length, visible })
    }
    out.sort((a, b) => {
      if (a.dept === NO_DEPT) return 1
      if (b.dept === NO_DEPT) return -1
      return b.size - a.size || a.dept.localeCompare(b.dept)
    })
    return out
  }, [pool, search])

  const searching = search.trim() !== ''
  const visibleCount = groups.reduce((n, g) => n + g.visible.length, 0)

  const setSelected = (codes) => onChange?.(codes)
  const addCodes = (codes) => {
    const next = [...selected]
    const have = new Set(next)
    for (const c of codes) if (!have.has(c)) { have.add(c); next.push(c) }
    setSelected(next)
  }
  const removeCodes = (codes) => {
    const drop = new Set(codes.map(String))
    setSelected(selected.filter((c) => !drop.has(c)))
  }
  const toggleOne = (code) => (selectedSet.has(code) ? removeCodes([code]) : addCodes([code]))
  const toggleDept = (g) => {
    const codes = g.visible.map((e) => String(e.code))
    const all = codes.every((c) => selectedSet.has(c))
    if (all) removeCodes(codes)
    else addCodes(codes)
  }
  const toggleOpen = (dept) =>
    setOpenDepts((s) => {
      const n = new Set(s)
      n.has(dept) ? n.delete(dept) : n.add(dept)
      return n
    })

  const onPasteAdd = () => {
    const res = parseCodes(paste, [...byCode.keys()])
    const add = []
    const hasLeft = []
    for (const c of res.codes) {
      if (isLeft(byCode.get(c)) && !showLeft) hasLeft.push(c)
      else add.push(c)
    }
    const already = add.filter((c) => selectedSet.has(c))
    addCodes(add)
    setPasteResult({
      added: add.length - already.length,
      already: already.length,
      notFound: res.unknown,
      hasLeft,
      ignored: res.ignored.length,
      duplicates: res.duplicates.length,
    })
    if (add.length) setPaste('')
  }

  return (
    <div className="space-y-3 text-sm" data-testid="people-picker">
      {/* Paste */}
      <div className="rounded-md border border-slate-200 p-2 space-y-2">
        <label className="block text-xs font-medium text-slate-600" htmlFor="pp-paste">
          Paste employee codes (one per line, or separated by commas / spaces)
        </label>
        <textarea
          id="pp-paste"
          data-testid="pp-paste"
          className="input w-full font-mono text-xs"
          rows={3}
          value={paste}
          onChange={(e) => setPaste(e.target.value)}
          placeholder={'e.g. copy the code column from Excel'}
        />
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="btn-secondary text-xs"
            data-testid="pp-paste-add"
            disabled={!paste.trim()}
            onClick={onPasteAdd}
          >
            Add pasted codes
          </button>
          {pasteResult && (
            <span className="text-xs text-slate-600" data-testid="pp-paste-result" role="status">
              Added {pasteResult.added}
              {pasteResult.already > 0 && ` · ${pasteResult.already} already selected`}
              {pasteResult.duplicates > 0 && ` · ${pasteResult.duplicates} repeated`}
              {pasteResult.ignored > 0 && ` · ignored ${pasteResult.ignored} word${pasteResult.ignored === 1 ? '' : 's'}`}
            </span>
          )}
        </div>
        {pasteResult?.notFound?.length > 0 && (
          <p className="text-xs text-red-700" data-testid="pp-not-found">
            Not found: {pasteResult.notFound.join(', ')}
          </p>
        )}
        {pasteResult?.hasLeft?.length > 0 && (
          <p className="text-xs text-amber-700" data-testid="pp-has-left">
            Has left (not added{allowLeft ? ' — tick "Include people who have left" to add' : ''}): {pasteResult.hasLeft.join(', ')}
          </p>
        )}
      </div>

      {/* Search + Left toggle */}
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          data-testid="pp-search"
          aria-label="Search by name, code or department"
          className="input flex-1 min-w-[12rem]"
          placeholder="Search name, code or department…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {allowLeft && (
          <label className="flex items-center gap-1.5 text-xs text-slate-600">
            <input
              type="checkbox"
              data-testid="pp-include-left"
              checked={includeLeft}
              onChange={(e) => setIncludeLeft(e.target.checked)}
            />
            Include people who have left{leftCount ? ` (${leftCount})` : ''}
          </label>
        )}
      </div>

      {/* Departments */}
      <div className="rounded-md border border-slate-200 overflow-auto" style={{ maxHeight }} data-testid="pp-groups">
        {groups.length === 0 ? (
          <p className="px-3 py-4 text-slate-400" data-testid="pp-empty">
            {searching ? `Nobody matches “${search}”` : 'No employees to show'}
          </p>
        ) : groups.map((g) => {
          const codes = g.visible.map((e) => String(e.code))
          const n = codes.filter((c) => selectedSet.has(c)).length
          const expanded = searching || openDepts.has(g.dept)
          return (
            <div key={g.dept} className="border-b border-slate-100 last:border-b-0" data-testid="pp-group" data-dept={g.dept}>
              <div className="flex items-center gap-2 px-2 py-1.5 bg-slate-50 sticky top-0">
                <DeptCheckbox
                  all={n === codes.length && n > 0}
                  some={n > 0 && n < codes.length}
                  label={`Tick all of ${g.dept}`}
                  onChange={() => toggleDept(g)}
                />
                <button
                  type="button"
                  className="flex-1 text-left font-medium text-slate-700 flex items-center gap-2"
                  aria-expanded={expanded}
                  data-testid="pp-group-toggle"
                  onClick={() => toggleOpen(g.dept)}
                  disabled={searching}
                >
                  <span aria-hidden="true">{expanded ? '▾' : '▸'}</span>
                  <span>{g.dept}</span>
                  <span className="text-xs text-slate-400 font-normal" data-testid="pp-group-count">
                    {n} of {codes.length} ticked{searching && codes.length !== g.size ? ` · ${g.size} in department` : ''}
                  </span>
                </button>
              </div>
              {expanded && (
                <ul>
                  {g.visible.map((e) => {
                    const code = String(e.code)
                    const left = isLeft(e)
                    return (
                      <li key={code}>
                        <label className="flex items-center gap-2 px-3 py-1 hover:bg-blue-50 cursor-pointer" data-testid="pp-person" data-code={code}>
                          <input type="checkbox" checked={selectedSet.has(code)} onChange={() => toggleOne(code)} />
                          <span className="font-mono text-slate-700">{code}</span>
                          <span className="truncate">{e.name}</span>
                          {left && (
                            <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800" data-testid="pp-left-badge">
                              Left
                            </span>
                          )}
                        </label>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          )
        })}
      </div>
      {searching && groups.length > 0 && (
        <p className="text-xs text-slate-500">{visibleCount} match{visibleCount === 1 ? '' : 'es'} — the department box ticks only the matches shown.</p>
      )}

      {/* Selected tray */}
      <div className="rounded-md border border-blue-200 bg-blue-50/40 p-2" data-testid="pp-tray">
        <div className="flex items-center justify-between mb-1">
          <span className="font-medium text-slate-700" data-testid="pp-count">{selected.length} selected</span>
          {selected.length > 0 && (
            <button type="button" className="text-xs text-slate-500 hover:text-red-700" data-testid="pp-clear" onClick={() => setSelected([])}>
              Clear all
            </button>
          )}
        </div>
        {selected.length === 0 ? (
          <p className="text-xs text-slate-400">Nobody selected yet.</p>
        ) : (
          <div className="flex flex-wrap gap-1 max-h-40 overflow-auto">
            {selected.map((c) => {
              const e = byCode.get(c)
              return (
                <span key={c} className="inline-flex items-center gap-1 rounded bg-white border border-slate-200 px-1.5 py-0.5 text-xs" data-testid="pp-chip" data-code={c}>
                  <span className="font-mono">{c}</span>
                  {e?.name && <span className="text-slate-500 max-w-[10rem] truncate">{e.name}</span>}
                  {isLeft(e) && <span className="text-amber-700">(left)</span>}
                  <button
                    type="button"
                    aria-label={`Remove ${c}`}
                    className="text-slate-400 hover:text-red-700 leading-none"
                    onClick={() => removeCodes([c])}
                  >
                    ✕
                  </button>
                </span>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function DeptCheckbox({ all, some, label, onChange }) {
  const ref = useRef(null)
  useEffect(() => { if (ref.current) ref.current.indeterminate = some }, [some])
  return (
    <input
      ref={ref}
      type="checkbox"
      aria-label={label}
      data-testid="pp-group-check"
      checked={all}
      aria-checked={some ? 'mixed' : all}
      onChange={onChange}
    />
  )
}
