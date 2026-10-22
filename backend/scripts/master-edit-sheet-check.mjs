// P5-02 review fixes 4 + 5 — the employee master sheet helper (frontend/src/utils/masterEditSheet.js), run in node.
// Leaving date round trip: build → write .xlsx → read back (no cellDates, as the panel does) → readSheet → splitRows.
// Run in several zones: for z in UTC Asia/Kolkata America/Los_Angeles Pacific/Kiritimati; do TZ=$z node backend/scripts/master-edit-sheet-check.mjs; done
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
// The browser build resolves 'xlsx' to its ES module (package "module" field, which exports SSF); plain node would load
// the CommonJS build. Load the helper against the ES module, as vite does, from a temp copy.
const here = path.dirname(fileURLToPath(import.meta.url))
const xlsxUrl = pathToFileURL(path.join(here, '../../frontend/node_modules/xlsx/xlsx.mjs')).href
const src = fs.readFileSync(path.join(here, '../../frontend/src/utils/masterEditSheet.js'), 'utf8').replace("from 'xlsx'", `from '${xlsxUrl}'`)
const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'me-sheet-')), 'masterEditSheet.mjs')
fs.writeFileSync(tmp, src)
const XLSX = await import(xlsxUrl)
const { buildSheet, readSheet, splitRows, dateCellText, longNumberCell } = await import(pathToFileURL(tmp).href)

let pass = 0; let fail = 0
const check = (label, want, got) => {
  const ok = JSON.stringify(want) === JSON.stringify(got)
  ok ? pass++ : fail++
  console.log(`  ${ok ? '✓' : '✗'} ${label}${ok ? '' : ` — expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`}`)
}
const meta = {
  fields: [{ key: 'department', label: 'Department', kind: 'direct' }, { key: 'account', label: 'Bank account', kind: 'sensitive' },
    { key: 'exit', label: 'Leaving', kind: 'exit' }],
  refused: { gross: 'Use Bulk salary revision' },
}
const fields = [{ key: 'department', label: 'Department' }, { key: 'account', label: 'Bank account' }, { key: 'exit', label: 'Leaving' }]
const roundTrip = (wb) => XLSX.read(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }), { type: 'array' })

console.log(`TZ=${process.env.TZ || '(default)'}`)
// 1. Leaving date typed as a real Excel date (serial) in the downloaded sheet.
const wb = buildSheet([{ code: 'T8001', name: 'Test Person A', values: { department: 'TEST DEPT', account: '1111000011' } },
  { code: 'T8002', name: 'Test Person B', values: { department: 'TEST DEPT', account: '2222000022' } }], fields, [])
const ws = wb.Sheets.Employees
const hdr = XLSX.utils.sheet_to_json(ws, { header: 1 })[0]
const col = (h) => hdr.indexOf(h)
const put = (r, c, cell) => { ws[XLSX.utils.encode_cell({ r, c })] = cell }
for (const [day, serial] of [['2026-10-05', 46300], ['2026-03-01', 46082], ['2024-02-29', 45351], ['2026-12-31', 46387]]) {
  put(1, col('Leaving date'), { t: 'n', v: serial, z: 'dd-mm-yyyy' })
  put(1, col('Leaving reason'), { t: 's', v: 'Resigned (test)' })
  const got = readSheet(roundTrip(wb), meta)
  check(`serial ${serial} → ${day}`, day, got.rows.find(r => r.code === 'T8001')?.changes.exit?.date)
}
// 2. Text dates stay as typed (the server reads DD-MM-YYYY and YYYY-MM-DD).
put(1, col('Leaving date'), { t: 's', v: '05-10-2026' })
check('text date kept', '05-10-2026', readSheet(roundTrip(wb), meta).rows[0].changes.exit.date)
check('dateCellText(46300)', '2026-10-05', dateCellText(46300))
check('dateCellText(text)', '2026-10-05', dateCellText('2026-10-05'))
// 3. Exit row goes to the exit section only.
const sp = splitRows(readSheet(roundTrip(wb), meta).rows, meta)
check('exit row in the exit section', [['T8001'], []], [sp.exit.map(r => r.code), sp.details.map(r => r.code)])

// 4. Bank account as a long number cell → flagged; a text cell or a short number is not.
put(1, col('Leaving date'), { t: 's', v: '' }); put(1, col('Leaving reason'), { t: 's', v: '' })
put(2, col('Bank account'), { t: 'n', v: 12345678901234567890 })
const g = readSheet(roundTrip(wb), meta)
const b = g.rows.find(r => r.code === 'T8002')
check('long number account cell flagged', ['account'], b?.numeric)
check('flag reaches the finance section', ['account'], splitRows(g.rows, meta).details[0]?.numeric)
put(2, col('Bank account'), { t: 's', v: '12345678901234567890' })
check('long account as text not flagged', undefined, readSheet(roundTrip(wb), meta).rows.find(r => r.code === 'T8002')?.numeric)
put(2, col('Bank account'), { t: 'n', v: 333344445555 })
const short = readSheet(roundTrip(wb), meta).rows.find(r => r.code === 'T8002')
check('12-digit number cell read whole, not flagged', ['333344445555', undefined], [short?.changes.account, short?.numeric])
check('longNumberCell', [true, false, false], [longNumberCell(1234567890123456), longNumberCell(123456789012345), longNumberCell('1234567890123456')])

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
