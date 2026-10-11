// P2-03 — unit check for the IST date helpers in frontend/src/utils/formatters.js.
// Run under several process zones; every answer must be the same:
//   TZ=UTC node backend/scripts/ist-today-unit-check.mjs
//   TZ=America/New_York node backend/scripts/ist-today-unit-check.mjs
//   TZ=Asia/Kolkata node backend/scripts/ist-today-unit-check.mjs
import { pathToFileURL } from 'node:url'
import path from 'node:path'

const here = path.dirname(new URL(import.meta.url).pathname)
const f = await import(pathToFileURL(path.join(here, '../../frontend/src/utils/formatters.js')).href)

let pass = 0, fail = 0
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  ok ? pass++ : fail++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`}`)
}

eq('todayIST at 23:59 IST 10 Oct (18:29Z)', f.todayIST(new Date('2026-10-10T18:29:00Z')), '2026-10-10')
eq('todayIST at 00:01 IST 11 Oct (18:31Z)', f.todayIST(new Date('2026-10-10T18:31:00Z')), '2026-10-11')
eq('todayIST at 00:30 IST 11 Oct (19:00Z)', f.todayIST(new Date('2026-10-10T19:00:00Z')), '2026-10-11')
eq('todayIST at 05:29 IST (23:59Z)', f.todayIST(new Date('2026-10-10T23:59:00Z')), '2026-10-11')
eq('todayIST year rollover 00:01 IST 1 Jan', f.todayIST(new Date('2026-12-31T18:31:00Z')), '2027-01-01')
eq('todayIST takes epoch ms', f.todayIST(Date.parse('2026-10-10T19:00:00Z')), '2026-10-11')
eq('todayIST() with no arg is a YYYY-MM-DD', /^\d{4}-\d{2}-\d{2}$/.test(f.todayIST()), true)
eq('istYearMonth at year rollover', f.istYearMonth(new Date('2026-12-31T18:31:00Z')), { year: 2027, month: 1 })
eq('istYearMonth 23:59 IST 31 Dec', f.istYearMonth(new Date('2026-12-31T18:29:00Z')), { year: 2026, month: 12 })
eq('toIstDateInput stored UTC 19:00 → next IST day', f.toIstDateInput('2026-10-10 19:00:00'), '2026-10-11')
eq('toIstDateInput stored UTC 10:00 → same day', f.toIstDateInput('2026-10-10 10:00:00'), '2026-10-10')
eq('toIstDateInput ISO with Z', f.toIstDateInput('2026-10-10T19:00:00Z'), '2026-10-11')
eq('toIstDateInput ISO with +05:30', f.toIstDateInput('2026-10-11T00:30:00+05:30'), '2026-10-11')
eq('toIstDateInput plain date unchanged', f.toIstDateInput('2026-10-10'), '2026-10-10')
eq('toIstDateInput Date', f.toIstDateInput(new Date('2026-10-10T19:00:00Z')), '2026-10-11')
eq('toIstDateInput empty', f.toIstDateInput(''), '')
eq('toIstDateInput null', f.toIstDateInput(null), '')
eq('toIstDateInput garbage', f.toIstDateInput('not a date'), '')
eq('addDaysIso -1 across month', f.addDaysIso('2026-10-01', -1), '2026-09-30')
eq('addDaysIso +1 leap day', f.addDaysIso('2028-02-28', 1), '2028-02-29')
eq('isoDayOfWeek 11 Oct 2026 = Sunday', f.isoDayOfWeek('2026-10-11'), 0)
eq('isoDayOfWeek 12 Oct 2026 = Monday', f.isoDayOfWeek('2026-10-12'), 1)
const y = f.istYearMonth().year
eq('YEAR_OPTIONS = IST year −2…+1', f.YEAR_OPTIONS.map(o => o.value), [y - 2, y - 1, y, y + 1])
eq('fmtIstDateTime stored 19:00 UTC', f.fmtIstDateTime('2026-10-10 19:00:00'), '11 Oct, 00:30')

console.log(`\nTZ=${process.env.TZ || '(unset)'}  ${pass}/${pass + fail} passed`)
process.exit(fail ? 1 : 0)
