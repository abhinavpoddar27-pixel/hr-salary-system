#!/usr/bin/env node
/**
 * Loans PR-9 — payslip HTML byte check (plant + sales).
 *
 *   node backend/scripts/loans-payslip-html-check.mjs [baseRef]     # default origin/main
 *
 * Renders fixture payslips with the BASE version of frontend/src/utils/payslipPdf.js
 * and salesPayslipPdf.js (read with `git show <baseRef>:…`) and with the working
 * tree's version, with Date frozen, and checks:
 *   1. a payslip with NO loan balance renders byte-identical HTML on both;
 *   2. with a loan balance, the branch output = the base output + exactly one
 *      inserted loan-balance block (nothing else moves).
 * The PDF itself is html2pdf of this HTML, so identical HTML = identical PDF input.
 * Exit 0 = every check passed. Synthetic data only.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const BASE = process.argv[2] || 'origin/main'
const SRC = 'frontend/src/utils'

// Freeze the clock: the sales payslip prints "Generated: <now>".
const FIXED = new Date('2026-11-05T06:30:00Z').getTime()
const RealDate = Date
globalThis.Date = class extends RealDate {
  constructor(...a) { super(...(a.length ? a : [FIXED])) }
  static now() { return FIXED }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'payslip-html-'))
const baseDir = path.join(tmp, 'base'); const headDir = path.join(tmp, 'head')
fs.mkdirSync(baseDir); fs.mkdirSync(headDir)
const show = (f) => execFileSync('git', ['-C', ROOT, 'show', `${BASE}:${SRC}/${f}`], { encoding: 'utf8' })
// The base files do not export the HTML builders: add a named export to the temp copy only.
fs.writeFileSync(path.join(baseDir, 'payslipPdf.js'), `${show('payslipPdf.js')}\nexport { generatePayslipHTML };\n`)
fs.writeFileSync(path.join(baseDir, 'salesPayslipPdf.js'), `${show('salesPayslipPdf.js')}\nexport { generateSalesPayslipHTML };\n`)
// Vite resolves extension-less imports; plain node needs the '.js'.
for (const f of ['payslipPdf.js', 'salesPayslipPdf.js']) {
  fs.writeFileSync(path.join(headDir, f), fs.readFileSync(path.join(ROOT, SRC, f), 'utf8').replace(/from '\.\/payslipPdf'/g, "from './payslipPdf.js'"))
}
fs.writeFileSync(path.join(tmp, 'package.json'), '{"type":"module"}')

const base = {
  plant: (await import(pathToFileURL(path.join(baseDir, 'payslipPdf.js')))).generatePayslipHTML,
  sales: (await import(pathToFileURL(path.join(baseDir, 'salesPayslipPdf.js')))).generateSalesPayslipHTML,
}
const head = {
  plant: (await import(pathToFileURL(path.join(headDir, 'payslipPdf.js')))).generatePayslipHTML,
  sales: (await import(pathToFileURL(path.join(headDir, 'salesPayslipPdf.js')))).generateSalesPayslipHTML,
}

const emp = { code: 'T001', name: 'TEST EMPLOYEE', department: 'PRODUCTION', designation: 'OPERATOR', company: 'Indriyan Beverages Pvt Ltd', uan: '', bank_account: '', date_of_joining: '2024-01-15' }
const plantBase = {
  employee: emp, period: { month: 10, year: 2026, monthName: 'October', period: 'October 2026' },
  attendance: { days_present: 24, paid_sundays: 4, total_payable_days: 28, lop_days: 0 },
  leaveSummary: {}, earnings: [{ label: 'Basic Pay', amount: 12000 }, { label: 'HRA (House Rent Allowance)', amount: 4800 }],
  deductions: [{ label: 'PF (Employee)', amount: 1440 }], grossEarned: 16800, totalDeductions: 1440, netSalary: 15360,
  pfEmployer: 1440, esiEmployer: 0, otPay: 0, edPay: 0, holidayDutyPay: 0, totalPayable: 15360, takeHome: 15360,
}
const PLANT = [
  plantBase,
  { ...plantBase, otPay: 1200, edPay: 600, edDays: 1, holidayDutyPay: 0, takeHome: 17160, leaveSummary: { cl: 1, lwp: 2, uninformedAbsent: 1 } },
  { ...plantBase, salaryHeld: 1, holdReason: 'payable < 5', deductions: [...plantBase.deductions, { label: 'Loan EMI', amount: 3334 }], totalDeductions: 4774, netSalary: 12026 },
  { ...plantBase, deductions: [], totalDeductions: 0, netSalary: 0, earnings: [] },
]
const salesBase = {
  employee: { code: 'S001', name: 'REP', designation: 'SO', reporting_manager: 'MGR', headquarters: 'HQ', city_of_operation: 'CITY', doj: '2024-01-01', company: 'Indriyan Beverages Pvt Ltd' },
  period: { month: 10, year: 2026 }, days: { days_given: 25, sundays_paid: 4, gazetted_holidays_paid: 1, total_days: 30, calendar_days: 30, earned_ratio: 1 },
  earnings: [{ label: 'Basic', amount: 20000 }], totalEarnings: 20000, deductions: [{ label: 'Loan EMI', amount: 3000 }], totalDeductions: 3000, netSalary: 17000,
  status: 'computed', bank: { bank_name: 'BANK', account_no: 'AC1', ifsc: 'IFSC0001' }, computedAt: '2026-11-03 10:00:00', finalizedAt: null, finalizedBy: null,
}
const SALES = [
  salesBase,
  { ...salesBase, status: 'finalized', finalizedAt: '2026-11-04 09:00:00', finalizedBy: 'hr1', bank: {} },
  { ...salesBase, deductions: [], totalDeductions: 0, netSalary: 20000 },
]
const ONE = { show: true, loans: [{ loanId: 7, loanType: 'Personal', outstandingAfter: 6666, emiThisMonth: 3334, emiState: 'posted' }], total: 6666 }
const TWO = { show: true, loans: [{ loanId: 7, loanType: 'Personal', outstandingAfter: 6666 }, { loanId: 9, loanType: 'Education', outstandingAfter: 1234.5 }], total: 7900.5 }

const fails = []
let checks = 0
const check = (ok, msg) => { checks += 1; if (!ok) fails.push(msg) }

function insertionOnly(a, b) {
  // b must be a with exactly one inserted span.
  let i = 0
  while (i < a.length && a[i] === b[i]) i += 1
  let j = 0
  while (j < a.length - i && a[a.length - 1 - j] === b[b.length - 1 - j]) j += 1
  return { ok: a.length + (b.length - a.length) === b.length && i + j === a.length, inserted: b.slice(i, b.length - j) }
}

for (const [kind, fixtures] of [['plant', PLANT], ['sales', SALES]]) {
  fixtures.forEach((fx, n) => {
    const b = kind === 'plant' ? base.plant(fx, null) : base.sales(fx)
    for (const [label, lb] of [['no balance arg', undefined], ['null', null], ['show:false', { show: false, loans: [], total: 0 }]]) {
      const h = kind === 'plant' ? head.plant(fx, null, lb) : head.sales(fx, lb)
      check(h === b, `${kind} #${n} (${label}): HTML differs from ${BASE}`)
    }
    for (const [label, lb, count] of [['one loan', ONE, 1], ['two loans', TWO, 2]]) {
      const h = kind === 'plant' ? head.plant(fx, null, lb) : head.sales(fx, lb)
      const ins = insertionOnly(b, h)
      check(ins.ok, `${kind} #${n} (${label}): more than one insertion`)
      check((ins.inserted.match(/data-loan-balance="1"/g) || []).length === 1, `${kind} #${n} (${label}): loan block not inserted exactly once`)
      check((ins.inserted.match(/outstanding after this month's EMI/g) || []).length === count, `${kind} #${n} (${label}): ${count} line(s) expected`)
      check(ins.inserted.includes('6,666'), `${kind} #${n} (${label}): amount missing`)
    }
  })
}

fs.rmSync(tmp, { recursive: true, force: true })
console.log(`payslip HTML check vs ${BASE}: ${checks - fails.length}/${checks} passed (plant ${PLANT.length} + sales ${SALES.length} fixtures)`)
for (const f of fails) console.log(`  FAIL ${f}`)
process.exit(fails.length ? 1 : 0)
