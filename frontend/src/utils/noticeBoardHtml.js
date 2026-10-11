/**
 * The mid-month attendance notice (Attendance Review → Notice board) as one A4 HTML document.
 * The same document is shown on screen (iframe preview) and printed, so the screen is exactly what goes on the wall.
 * Names + codes + counts only — no money, no minutes (owner ruling D-9). Hindi + English throughout.
 */

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const day = (iso) => { if (!iso) return ''; const [y, m, d] = iso.split('-').map(Number); return `${d} ${MONTHS[m - 1]} ${y}` }
const istStamp = (t) => {
  if (!t) return ''
  const d = new Date(`${String(t).replace(' ', 'T')}Z`)
  return isNaN(d) ? t : d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

/**
 * @param board  GET /board or POST /board/prints data (meta, listed, spotless, footer)
 * @param print  { number, printed_at, printed_by } after a print is recorded; null for the on-screen draft
 */
export function noticeBoardHtml(board, print = null) {
  const m = board.meta; const th = m.thresholds
  const covered = m.covered_to || m.to
  const rows = board.listed.map((x, i) => `
    <tr>
      <td class="n">${i + 1}</td><td class="code">${esc(x.code)}</td><td>${esc(x.name)}</td><td class="dept">${esc(x.department)}</td>
      <td class="c${x.flags.late ? ' hit' : ''}">${x.lates}</td>
      <td class="c${x.flags.early ? ' hit' : ''}">${x.early_exits}</td>
      <td class="c${x.flags.missed ? ' hit' : ''}">${x.missed_punches}</td>
    </tr>`).join('')
  const spot = board.spotless.map((x) => `<li><span class="nm">${esc(x.name)}</span> <span class="code">${esc(x.code)}</span></li>`).join('')
  const ref = print
    ? `Notice No. ${esc(print.number)} · printed ${esc(istStamp(print.printed_at))} by ${esc(print.printed_by)}`
    : 'DRAFT — not yet printed'
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Attendance notice ${esc(day(m.from))} – ${esc(day(covered))}</title>
<style>
  @page { size: A4 portrait; margin: 12mm 11mm 14mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; background: #fff; color: #111; }
  body { font: 10.5pt/1.35 "Noto Sans", "Noto Sans Devanagari", "Nirmala UI", Mangal, Arial, sans-serif; padding: 0; }
  .sheet { max-width: 188mm; margin: 0 auto; }
  @media screen { body { padding: 12mm 11mm; } }
  header { border-bottom: 2.5px solid #111; padding-bottom: 6px; margin-bottom: 8px; display: flex; justify-content: space-between; gap: 12px; align-items: flex-end; }
  h1 { font-size: 19pt; margin: 0; letter-spacing: .02em; }
  h1 .hi { font-weight: 600; margin-left: 8px; }
  .period { font-size: 12pt; font-weight: 600; margin-top: 2px; }
  .ref { font-size: 8.5pt; color: #444; text-align: right; white-space: nowrap; }
  .ref.draft { color: #b45309; font-weight: 700; }
  h2 { font-size: 12pt; margin: 12px 0 4px; }
  h2 .hi { font-weight: 500; }
  .rule { font-size: 9pt; color: #333; margin: 0 0 5px; }
  table { width: 100%; border-collapse: collapse; }
  thead { display: table-header-group; }
  tr { page-break-inside: avoid; }
  th, td { border: 1px solid #555; padding: 3px 5px; vertical-align: top; }
  th { background: #eee; font-size: 9pt; text-align: left; }
  th.c, td.c { text-align: center; width: 15mm; }
  td.n { width: 8mm; text-align: right; color: #555; }
  td.code, .code { font-family: "Roboto Mono", Consolas, monospace; font-size: 9.5pt; }
  td.dept { font-size: 9pt; }
  td.hit { font-weight: 800; font-size: 12pt; background: #f3f3f3; }
  .empty { border: 1px dashed #888; padding: 10px; text-align: center; color: #333; }
  ul.spot { columns: 3; column-gap: 8mm; margin: 0; padding: 0; list-style: none; font-size: 9.5pt; }
  ul.spot li { break-inside: avoid; padding: 1px 0; border-bottom: 1px dotted #ccc; }
  ul.spot .code { color: #444; font-size: 8.5pt; }
  footer { margin-top: 12px; border-top: 2px solid #111; padding-top: 6px; font-size: 10pt; }
  footer p { margin: 0 0 5px; }
  footer .hi { font-size: 10.5pt; }
  .small { font-size: 8pt; color: #555; }
</style></head>
<body><div class="sheet">
  <header>
    <div>
      <h1>Attendance Notice <span class="hi">हाज़िरी सूचना</span></h1>
      <div class="period">${esc(day(m.from))} – ${esc(day(covered))}${m.company ? ` · ${esc(m.company)}` : ''}</div>
    </div>
    <div class="ref${print ? '' : ' draft'}">${ref}</div>
  </header>

  <h2>Late coming, early leaving and missed punches so far <span class="hi">· अब तक देर से आना, जल्दी जाना और पंच छूटना</span></h2>
  <p class="rule">Named: ${th.late} or more late arrivals, ${th.early} or more early exits, or ${th.missed} or more missed punches. The figure that put a name here is in bold.<br>
  नाम तब है जब: ${th.late} या अधिक बार देर से आए, ${th.early} या अधिक बार जल्दी गए, या ${th.missed} या अधिक बार पंच छूटा। जिस कारण नाम आया, वह संख्या मोटे अक्षरों में है।</p>
  ${board.listed.length ? `<table>
    <thead><tr><th>#</th><th>Code<br>कोड</th><th>Name<br>नाम</th><th>Department<br>विभाग</th>
      <th class="c">Late<br>देर से आए</th><th class="c">Left early<br>जल्दी गए</th><th class="c">Missed punch<br>पंच छूटा</th></tr></thead>
    <tbody>${rows}</tbody></table>`
    : '<div class="empty">No one so far. <span class="hi">अब तक किसी का नाम नहीं।</span></div>'}

  <h2>On time every day <span class="hi">· रोज़ समय पर</span></h2>
  <p class="rule">No late arrival, no early exit and no missed punch so far — thank you. <span class="hi">अब तक न देर, न जल्दी, न पंच छूटा — धन्यवाद।</span></p>
  ${board.spotless.length ? `<ul class="spot">${spot}</ul>` : '<div class="empty">—</div>'}

  <footer>
    <p class="hi">${esc(board.footer.hi)}</p>
    <p>${esc(board.footer.en)}</p>
    <p class="small">Counts from attendance up to ${esc(day(covered))}. Corrections: see HR. · गलती लगे तो HR से मिलें।</p>
  </footer>
</div></body></html>`
}
