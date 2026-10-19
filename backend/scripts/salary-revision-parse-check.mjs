// P5-04 — unit check of the pasted-row parser (frontend/src/utils/revisionParse.js). Run: node backend/scripts/salary-revision-parse-check.mjs
import { parseRevisionLines } from '../../frontend/src/utils/revisionParse.js'
let pass = 0, fail = 0
const eq = (label, exp, got) => { const ok = JSON.stringify(exp) === JSON.stringify(got); ok ? pass++ : fail++; console.log(`${ok ? '  ✓' : '  ✗'} ${label}${ok ? '' : ` — expected ${JSON.stringify(exp)}, got ${JSON.stringify(got)}`}`) }
const p = (t, m = 'gross') => parseRevisionLines(t, m)
eq('space: code amount', [{ code: 'T9501', new_gross: 22000 }], p('T9501 22000').rows)
eq('space + Indian commas keep the amount', [{ code: 'T9503', new_gross: 27500 }], p('T9503 27,500').rows)
eq('L3: comma-only line "T9501,22,000" = one amount', [{ code: 'T9501', new_gross: 22000 }], p('T9501,22,000').rows)
eq('L3: comma-only line "T9501,22000"', [{ code: 'T9501', new_gross: 22000 }], p('T9501,22000').rows)
eq('L3: comma-only with lakh commas', [{ code: 'T9501', new_gross: 122000 }], p('T9501,1,22,000').rows)
eq('tab (Excel copy) with date dd-mm-yyyy', [{ code: 'T9504', new_gross: 122000, effective_from: '2026-12-01' }], p('T9504\t1,22,000\t01-12-2026').rows)
eq('% suffix', [{ code: 'T9502', pct: 10 }], p('T9502 10%').rows)
eq('% mode', [{ code: 'T9502', pct: 5 }], p('T9502 5', 'pct').rows)
eq('semicolon', [{ code: 'T9505', new_gross: 21000 }], p('T9505;21000').rows)
eq('bad lines reported', ['not-a-row', 'T9507 abc'], p('not-a-row\nT9507 abc').bad)
eq('blank lines ignored', 1, p('\n\nT9501 1\n\n').rows.length)
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
