/** P5-04 — pure parsing of pasted salary-revision rows (no React); checked by backend/scripts/salary-revision-parse-check.mjs. */
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
/** dd-mm-yyyy / dd/mm/yyyy → yyyy-mm-dd (Indian order, never guessed as US). */
export function normDate(t) {
  const s = String(t || '').trim()
  if (DATE_RE.test(s)) return s
  const m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(s)
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null
}
export const cleanNum = (t) => String(t ?? '').replace(/[₹,\s]/g, '')

/**
 * One row per line: "CODE VALUE [DATE]" (tab, space or semicolon separated; a comma-only line is code,amount).
 * VALUE ending in % = % increase, else the mode decides. Amounts may carry commas / ₹.
 * Returns { rows: [{code, new_gross|pct, effective_from?}], bad: [line] }.
 */
export function parseRevisionLines(text, mode) {
  const rows = []; const bad = []
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    // Tabs (Excel copy) first; else spaces/semicolons — so "T9503 27,500" keeps its amount. A comma-only line
    // "T9501,22,000" (L3) is code + ONE amount: the first comma splits, the rest is the amount (commas stripped).
    let parts
    if (line.includes('\t')) parts = line.split(/\t+/)
    else if (/[\s;]/.test(line)) parts = line.split(/[\s;]+/)
    else { const m = /^(\S+?),(.+)$/.exec(line); parts = m ? [m[1], m[2]] : [line] }
    parts = parts.map(p => p.trim()).filter(Boolean)
    if (parts.length < 2) { bad.push(line); continue }
    const [code, value, date] = parts
    const isPct = /%$/.test(value) || mode === 'pct'
    const n = cleanNum(value.replace(/%$/, ''))
    if (n === '' || !Number.isFinite(Number(n))) { bad.push(line); continue }
    const row = { code: code.replace(/\.0$/, '') }
    if (isPct) row.pct = Number(n); else row.new_gross = Number(n)
    if (date) { const d = normDate(date); if (!d) { bad.push(line); continue } row.effective_from = d }
    rows.push(row)
  }
  return { rows, bad }
}

