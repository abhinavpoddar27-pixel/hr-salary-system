#!/usr/bin/env node
// Checks frontend/src/utils/parseCodes.js (P2-07). Fictional codes only.
// Run: node backend/scripts/parse-codes-check.mjs   (exit 1 on any failure)
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const target = process.argv[2] || path.join(here, '..', '..', 'frontend', 'src', 'utils', 'parseCodes.js')
const mod = await import(pathToFileURL(path.resolve(target)).href)
const parseCodes = mod.default
const { splitTokens, isCodeShaped } = mod

// Fictional master: 5-digit plant codes, a 4-digit one, a leading-zero one,
// sales S-codes, a word code and a "/"-code (shapes seen in production).
const MASTER = ['90001', '90002', '90003', '9004', '01234', 'S901', 'S902', 'ZEBRA', '/9905', '900006']

let pass = 0, fail = 0
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)
function check(name, got, want) {
  if (eq(got, want)) { pass++; console.log('PASS', name) }
  else { fail++; console.log('FAIL', name, '\n   got ', JSON.stringify(got), '\n   want', JSON.stringify(want)) }
}
const P = (t, m = MASTER) => parseCodes(t, m)

check('excel column \\n', P('90001\n90002\n90003\n').codes, ['90001', '90002', '90003'])
check('excel column \\r\\n', P('90001\r\n90002\r\n').codes, ['90001', '90002'])
check('excel 2 columns (tab) code+name', P('90001\tAsha Rani\n90002\tVijay').codes, ['90001', '90002'])
check('excel 2 columns ignored words', P('90001\tAsha Rani\n90002\tVijay').ignored, ['Asha', 'Rani', 'Vijay'])
check('csv quoted', P('"90001","90002",\'90003\'').codes, ['90001', '90002', '90003'])
check('semicolon', P('90001;90002 ; 90003').codes, ['90001', '90002', '90003'])
check('mixed text', P('please add 90001 and 90002, also S901.').codes, ['90001', '90002', 'S901'])
check('mixed text punctuation stripped', P('(90001) S901. 90002: 90003!').codes, ['90001', 'S901', '90002', '90003'])
check('duplicates removed, order kept', P('90003 90001 90003 90001 90002').codes, ['90003', '90001', '90002'])
check('duplicates listed once', P('90003 90001 90003 90001 90003').duplicates, ['90003', '90001'])
check('case-insensitive returns master spelling', P('s901 S902 zebra').codes, ['S901', 'S902', 'ZEBRA'])
check('duplicate by case', P('S901 s901').duplicates, ['S901'])
check('leading zero kept', P('01234').codes, ['01234'])
check('1234 is not 01234', P('1234').codes, [])
check('1234 reported unknown', P('1234').unknown, ['1234'])
check('word code from master', P('ZEBRA').codes, ['ZEBRA'])
check('slash code from master', P('/9905').codes, ['/9905'])
check('excel .0 suffix', P('90001.0\n90002.00').codes, ['90001', '90002'])
check('excel text prefix quote', P("'01234").codes, ['01234'])
check('unknown code-shaped', P('90001 99999 S999').unknown, ['99999', 'S999'])
check('unknown deduped', P('99999 99999').unknown, ['99999'])
check('headers ignored', P('Code\tName\nEmp.Code').ignored, ['Code', 'Name', 'Emp.Code'])
check('empty string', P(''), { codes: [], unknown: [], ignored: [], duplicates: [], total: 0 })
check('null text', P(null).codes, [])
check('only spaces', P('   \n\t  ').total, 0)
check('total counts tokens', P('90001 x 90001').total, 3)
check('6-digit code', P('900006').codes, ['900006'])
check('master with numbers as items', parseCodes('90001', [90001, '90002']).codes, ['90001'])
check('master null entries skipped', parseCodes('90001', [null, '90001']).codes, ['90001'])
// Fallback (no master list)
check('fallback keeps code-shaped', parseCodes('90001 S901 abc 1234 /9905', null).codes, ['90001', 'S901', '1234', '/9905'])
check('fallback ignores words', parseCodes('90001 abc', null).ignored, ['abc'])
check('fallback unknown empty', parseCodes('90001 abc', undefined).unknown, [])
check('fallback dedupe', parseCodes('90001 90001', null).codes, ['90001'])
check('splitTokens', splitTokens(' a, b;c\td\ne '), ['a', 'b', 'c', 'd', 'e'])
check('isCodeShaped 12', isCodeShaped('12'), false)
check('isCodeShaped S901', isCodeShaped('S901'), true)
check('big list 300 in order', P(Array.from({ length: 3 }, () => MASTER.join('\n')).join('\n')).codes.length, MASTER.length)

console.log(`\n${pass}/${pass + fail} passed`)
process.exit(fail ? 1 : 0)
