/**
 * parseCodes — turn pasted text (an Excel column, a CSV row, a chat message)
 * into a clean list of employee codes.
 *
 *   parseCodes(text, knownCodes?) → { codes, unknown, ignored, duplicates, total }
 *
 * - Splits on newline, comma, tab, semicolon and space.
 * - Strips surrounding quotes (CSV), brackets/sentence punctuation, and a trailing ".0" on an all-digit token
 *   (some Excel/CSV exports write 12345 as "12345.0").
 * - Codes are TEXT: tokens are never turned into numbers, so a leading zero is
 *   kept and "01234" is not the same code as "1234".
 * - With `knownCodes` (the employee master): a token is kept only when it is a
 *   master code (case-insensitive; the master spelling is returned, so "s012"
 *   gives "S012"). Production has codes that fit no simple pattern (a word, a
 *   code starting with "/"), so the master list — not a regex — decides.
 *   Code-shaped tokens that are not in the master go to `unknown`
 *   ("not found"); everything else (names, headers) goes to `ignored`.
 * - Without `knownCodes` (null/undefined): fallback pattern mode — code-shaped
 *   tokens go to `codes`, the rest to `ignored`, `unknown` is always empty.
 * - Order of first appearance is kept; repeats are dropped and listed in
 *   `duplicates` (each repeated code once, in master spelling).
 *
 * Pure, no imports — also loaded directly by node in
 * backend/scripts/parse-codes-check.mjs.
 */

// A letter prefix (sales "S123") or "/" followed by digits, or plain digits.
const CODE_SHAPE = /^(?:[A-Za-z]{0,2}|\/)\d{3,8}$/

export function splitTokens(text) {
  if (text == null) return []
  return String(text)
    .split(/[\s,;]+/)
    .map(cleanToken)
    .filter(Boolean)
}

function cleanToken(raw) {
  let t = String(raw).trim()
  // Strip matching quote pairs, repeatedly ('"12345"' → 12345).
  while (t.length >= 2 && /^["'`]/.test(t) && t[t.length - 1] === t[0]) t = t.slice(1, -1).trim()
  // Stray single quote left by Excel text-prefix ('01234).
  t = t.replace(/^['"`]+|['"`]+$/g, '')
  // Sentence punctuation around a code in mixed text ("(90001)", "S901.").
  t = t.replace(/^[([{]+/, '').replace(/[.:)\]}!?]+$/, '')
  if (/^\d+\.0+$/.test(t)) t = t.replace(/\.0+$/, '')
  return t
}

export function isCodeShaped(token) {
  return CODE_SHAPE.test(String(token || ''))
}

export default function parseCodes(text, knownCodes = null) {
  const tokens = splitTokens(text)
  const useMaster = Array.isArray(knownCodes)
  const master = new Map()
  if (useMaster) {
    for (const c of knownCodes) {
      if (c == null) continue
      const s = String(c).trim()
      if (s && !master.has(s.toUpperCase())) master.set(s.toUpperCase(), s)
    }
  }

  const codes = []
  const unknown = []
  const ignored = []
  const seen = new Set()
  const dupSet = new Set()
  const duplicates = []
  const seenUnknown = new Set()

  for (const tok of tokens) {
    let code = null
    if (useMaster) code = master.get(tok.toUpperCase()) || null
    else if (isCodeShaped(tok)) code = tok

    if (code != null) {
      const key = code.toUpperCase()
      if (seen.has(key)) {
        if (!dupSet.has(key)) { dupSet.add(key); duplicates.push(code) }
      } else {
        seen.add(key)
        codes.push(code)
      }
    } else if (useMaster && isCodeShaped(tok)) {
      const key = tok.toUpperCase()
      if (!seenUnknown.has(key)) { seenUnknown.add(key); unknown.push(tok) }
    } else {
      ignored.push(tok)
    }
  }

  return { codes, unknown, ignored, duplicates, total: tokens.length }
}

export { parseCodes }
