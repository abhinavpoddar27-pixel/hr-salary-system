// P5-02 — employee master bulk edit: the export sheet and reading it back.
//
// Sheet "Employees": Code, Name (reference only), then one column per chosen field (current values).
// Sheet "Shifts": the shift codes that can be typed in the Shift column (community SheetJS has no drop-downs).
// Hidden sheet "_meta": one row per person — code + the exported values as JSON. On upload only cells that differ
// from _meta count as changes, and the server refuses a change whose master value moved since the download.
// A sheet without _meta (copied into a new workbook, typed by hand) is still read: every filled cell is a change
// (the server leaves cells equal to the master alone, and warns — ruling Q9).
import * as XLSX from 'xlsx'

export const EXIT_DATE = 'Leaving date'
export const EXIT_REASON = 'Leaving reason'
const META_SHEET = '_meta'
const REF_HEADERS = new Set(['code', 'name', 'employee code', 'emp code'])

const norm = (h) => String(h ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const key = (h) => norm(h).replace(/ /g, '_')

/** Cell → text. Numbers never in exponent form (12-digit UANs, long account numbers); dates → YYYY-MM-DD. */
export function cellText(v) {
  if (v === null || v === undefined) return ''
  if (v instanceof Date) {
    const y = v.getFullYear(); const m = String(v.getMonth() + 1).padStart(2, '0'); const d = String(v.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }
  if (typeof v === 'number') return Number.isInteger(v) ? v.toFixed(0) : String(v)
  return String(v).trim()
}

/**
 * @param {object[]} rows  [{ code, name, values: { field: value } }] from POST /bulk/master-edit/export
 * @param {object[]} fields [{ key, label }] chosen fields in order ('exit' adds Leaving date + Leaving reason)
 * @param {object[]} shifts [{ code, name, start_time, end_time }]
 */
export function buildSheet(rows, fields, shifts = []) {
  const cols = fields.flatMap(f => (f.key === 'exit' ? [EXIT_DATE, EXIT_REASON] : [f.label]))
  const aoa = [['Code', 'Name', ...cols]]
  for (const r of rows) {
    aoa.push([r.code, r.name || '', ...fields.flatMap(f => (f.key === 'exit' ? ['', ''] : [String(r.values?.[f.key] ?? '')]))])
  }
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  // Every value cell as text so Excel keeps 12-digit numbers whole.
  for (let R = 1; R < aoa.length; R++) for (let C = 0; C < aoa[0].length; C++) {
    const ref = XLSX.utils.encode_cell({ r: R, c: C })
    if (ws[ref]) { ws[ref].t = 's'; ws[ref].z = '@' }
  }
  ws['!cols'] = aoa[0].map((h, i) => ({ wch: i === 1 ? 26 : Math.max(12, String(h).length + 4) }))
  XLSX.utils.book_append_sheet(wb, ws, 'Employees')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Shift code', 'Name', 'From', 'To'],
    ...shifts.map(s => [s.code, s.name || '', s.start_time || '', s.end_time || ''])]), 'Shifts')
  const meta = [[JSON.stringify({ v: 1, fields: fields.map(f => f.key), at: new Date().toISOString() })],
    ...rows.map(r => [r.code, JSON.stringify(Object.fromEntries(fields.filter(f => f.key !== 'exit').map(f => [f.key, String(r.values?.[f.key] ?? '')])))])]
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(meta), META_SHEET)
  wb.Workbook = { Sheets: [{ Hidden: 0 }, { Hidden: 0 }, { Hidden: 1 }] }
  return wb
}

/**
 * Read an uploaded workbook.
 * @param {object} wb  XLSX workbook (read with cellDates: true)
 * @param {object} meta  GET /bulk/master-edit/meta data (fields, refused)
 * @returns {{ rows: [{code, changes, base?, noMeta?}], noMeta: boolean, columns: string[], ignored: string[], error?: string }}
 */
export function readSheet(wb, meta) {
  const sheetName = wb.SheetNames.find(n => n !== META_SHEET && n.toLowerCase() !== 'shifts') || wb.SheetNames[0]
  const aoa = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: '', raw: true })
  if (!aoa.length) return { rows: [], noMeta: true, columns: [], ignored: [], error: 'The sheet is empty' }
  const byLabel = new Map()
  for (const f of meta?.fields || []) { byLabel.set(norm(f.label), f.key); byLabel.set(norm(f.key), f.key) }
  const header = aoa[0].map(h => cellText(h))
  const codeCol = header.findIndex(h => ['code', 'employee code', 'emp code', 'emp. code'].includes(norm(h)) || norm(h) === 'emp code')
  if (codeCol < 0) return { rows: [], noMeta: true, columns: [], ignored: [], error: 'No "Code" column in the first row' }
  const cols = []; const ignored = []
  header.forEach((h, i) => {
    if (i === codeCol || !h || REF_HEADERS.has(norm(h))) return
    if (norm(h) === norm(EXIT_DATE)) cols.push({ i, field: 'exit', part: 'date' })
    else if (norm(h) === norm(EXIT_REASON)) cols.push({ i, field: 'exit', part: 'reason' })
    else if (byLabel.has(norm(h))) cols.push({ i, field: byLabel.get(norm(h)) })
    else if (meta?.refused && meta.refused[key(h)]) cols.push({ i, field: key(h) }) // the server refuses it with the reason
    else ignored.push(h)
  })
  // _meta
  let base = null
  const ms = wb.Sheets[META_SHEET]
  if (ms) {
    base = new Map()
    for (const r of XLSX.utils.sheet_to_json(ms, { header: 1, defval: '', raw: false }).slice(1)) {
      try { if (r[0]) base.set(String(r[0]).trim().toLowerCase(), JSON.parse(r[1] || '{}')) } catch { /* skip */ }
    }
  }
  const rows = []
  for (const r of aoa.slice(1)) {
    const code = cellText(r[codeCol])
    if (!code) continue
    const b = base ? base.get(code.toLowerCase()) : null
    const changes = {}; const rowBase = {}
    let exit = null
    for (const c of cols) {
      const v = cellText(r[c.i])
      if (c.field === 'exit') { if (v) { exit = exit || { date: '', reason: '' }; exit[c.part] = v } continue }
      if (b && c.field in b) {
        if (v === String(b[c.field] ?? '')) continue
        changes[c.field] = v; rowBase[c.field] = b[c.field]
      } else if (v !== '') {
        changes[c.field] = v
      }
    }
    if (exit) changes.exit = exit
    if (!Object.keys(changes).length) continue
    rows.push({ code, changes, ...(Object.keys(rowBase).length ? { base: rowBase } : {}), ...(b ? {} : { noMeta: true }) })
  }
  return { rows, noMeta: !base, columns: cols.map(c => header[c.i]), ignored }
}

/**
 * Split rows by where each change goes. Returns { direct, details, exit } — each a list of input rows for one kind.
 * A change to a field that is neither (refused / unknown) rides with `direct`, so the server names the reason.
 */
export function splitRows(rows, meta) {
  const kindOf = Object.fromEntries((meta?.fields || []).map(f => [f.key, f.kind]))
  const out = { direct: [], details: [], exit: [] }
  for (const r of rows) {
    const parts = { direct: {}, details: {}, exit: {} }
    for (const [f, v] of Object.entries(r.changes)) {
      const k = kindOf[f] === 'sensitive' ? 'details' : kindOf[f] === 'exit' ? 'exit' : 'direct'
      parts[k][f] = v
    }
    for (const k of Object.keys(out)) {
      if (!Object.keys(parts[k]).length) continue
      const b = r.base ? Object.fromEntries(Object.entries(r.base).filter(([f]) => f in parts[k])) : null
      out[k].push({ code: r.code, changes: parts[k], ...(b && Object.keys(b).length ? { base: b } : {}), ...(r.noMeta ? { noMeta: true } : {}) })
    }
  }
  return out
}
