#!/usr/bin/env node
/**
 * Loans PR-10 — accounts-Excel import simulation (docs/loans/SPEC.md D-9, K36,
 * K37; coordinator rulings 10 Oct 2026).
 *
 *   node backend/scripts/loans-import-simulation.js           # 25-row import, then plant Sep–Nov / sales Oct–Nov 2026 payroll and closes
 *   node backend/scripts/loans-import-simulation.js --empty   # same calendar, no import: no loan row, close or import row written
 *
 * Real schema (JWT harness: temp DATA_DIR, real initSchema), the REAL import
 * routes over HTTP with real JWTs (hr1 uploads and confirms names, fin1
 * confirms balances, boss approves), the real plant Stage 7 (recomputeSalary),
 * the real sales compute over HTTP, and the real loan close on an injected
 * clock. Names and codes are synthetic.
 *
 * The 25-row file: 16 clean plant rows (one EMI above its outstanding, one
 * borrower whose deduction room is short), 3 misspellings (one letter, swapped
 * order, initials), 2 sales reps, 1 shared name settled by department, 1 name
 * nobody has (stays out), 1 exact duplicate line (stays out), 1 name found only
 * on a Left employee ("Left — settle outside the app"). Finance corrects one
 * balance. Cutover month PER PAYROLL in the one batch (owner facts, 10 Oct
 * 2026): plant = Sep 2026 (plant Sep Stage 7 already computed, not yet paid →
 * re-run); sales = Oct 2026 (sales Sep already computed and its NEFT exported
 * with no loan deduction).
 *
 * Checks: 22 loans, 3 left out, re-upload refused (409); every loan reconciles
 * to the paisa after every step; cutover check flags exactly the EMI-differs and
 * headroom-short rows before Stage 7 and the short deduction after it, with the
 * month per row (plant Sep, sales Oct); the plant Sep borrowers are listed as
 * "Stage 7 already computed"; sales Sep carries no loan; payslip loan_recovery =
 * ledger; Σ posted = Σ payslip loan recovery per month and payroll; plant drift
 * 0, sales drift 0, component-short 0; a Stage 7 re-run after the close changes
 * nothing. Exit 0 only if all pass.
 */
const XLSX = require('xlsx');
const http = require('http');

const EMPTY = process.argv.includes('--empty');
const { log: realLog, error: realError, warn: realWarn } = console;
const quiet = () => { console.log = () => {}; console.warn = () => {}; console.error = () => {}; };
const loud = () => { console.log = realLog; console.warn = realWarn; console.error = realError; };

quiet();
const { startJwtApi } = require('../src/__tests__/helpers/jwtApiHarness');
const api = startJwtApi({ '/api/loans/import': '../../routes/loanImport', '/api/loans': '../../routes/loans', '/api/sales': '../../routes/sales' },
  { users: [{ username: 'hr1', role: 'hr' }, { username: 'fin1', role: 'finance' }, { username: 'boss', role: 'admin' }] });
const db = api.db;
const { recomputeSalary } = require('../src/services/recompute');
const L = require('../src/services/loans');
const C = require('../src/services/loans/close');
loud();

const AL = 'Asian Lakto Ind Ltd';
const IND = 'Indriyan Beverages Pvt Ltd';
const failures = [];
const check = (cond, msg) => { if (!cond) failures.push(msg); };
const lastDay = (m, y) => new Date(Date.UTC(y, m, 0)).getUTCDate();

// ── plant workforce (Asian Lakto; two with an unknown master company, K7) ────
const NAMES = ['RAJESH KUMAR', 'SUNITA DEVI', 'AMANDEEP SINGH', 'POOJA RANI', 'VIJAY PAL', 'HARPREET KAUR', 'SANJAY YADAV', 'MEENA KUMARI',
  'GURPREET SINGH', 'ANIL SHARMA', 'KAVITA SAINI', 'RAMESH CHAND', 'NEHA VERMA', 'DEEPAK THAKUR', 'SEEMA GUPTA', 'MOHAN LAL',
  'MANPREET SINGH', 'KUMAR RAKESH', 'RAJ KUMAR SHARMA', 'SURINDER PAL', 'SURINDER PAL', 'BALJIT KAUR', 'TARSEM LAL', 'OLD HAND'];
const insEmp = db.prepare(`INSERT INTO employees (code, name, department, company, employment_type, status, date_of_joining, is_contractor, weekly_off_day, gross_salary)
                           VALUES (?, ?, ?, ?, 'Permanent', ?, '2023-04-01', 0, 0, ?)`);
const plant = [];
NAMES.forEach((name, i) => {
  const code = `IMP${String(i + 1).padStart(3, '0')}`;
  const dept = name === 'SURINDER PAL' ? (plant.some((p) => p.name === name) ? 'STORE' : 'PRODUCTION') : 'PRODUCTION';
  const status = name === 'OLD HAND' ? 'Left' : 'Active';
  const company = i === 3 ? null : i === 9 ? 'Default' : AL;
  insEmp.run(code, name, dept, company, status, 18000 + (i % 6) * 1000);
  plant.push({ code, name, dept, status });
});
// 6 non-borrowers so the payroll is not only borrowers
for (let i = 0; i < 6; i++) insEmp.run(`OTH${i + 1}`, `OTHER WORKER ${i + 1}`, 'PRODUCTION', AL, 'Active', 16000);
const payrollCodes = [...plant.filter((p) => p.status === 'Active').map((p) => p.code), ...[1, 2, 3, 4, 5, 6].map((i) => `OTH${i}`)];
const codeOf = (name, dept) => plant.find((p) => p.name === name && (!dept || p.dept === dept)).code;
const SHORT = codeOf('MEENA KUMARI');            // big advance every month → room short
const insDc = db.prepare(`INSERT INTO day_calculations (employee_code, month, year, company, days_present, days_half_present, days_wop,
                            cl_used, el_used, sl_used, od_days, lop_days, total_payable_days, paid_sundays, paid_holidays, days_absent)
                          VALUES (?, ?, ?, ?, 26, 0, 0, 0, 0, 0, 0, 0, 26, 0, 0, 0)`);
const insAtt = db.prepare(`INSERT OR IGNORE INTO attendance_processed (employee_code, date, status_original, status_final, company, month, year)
                           VALUES (?, ?, 'P', 'P', ?, ?, ?)`);
const insAdv = db.prepare(`INSERT INTO salary_advances (employee_code, month, year, is_eligible, advance_amount, paid, recovered, recovery_month, recovery_year)
                           VALUES (?, ?, ?, 1, ?, 1, 0, ?, ?)`);
for (const [m, y] of [[8, 2026], [9, 2026], [10, 2026], [11, 2026]]) {
  for (const code of payrollCodes) {
    insDc.run(code, m, y, AL);
    for (let d = lastDay(m, y) - 7; d <= lastDay(m, y); d++) insAtt.run(code, `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`, AL, m, y);
  }
  insAdv.run(SHORT, m === 1 ? 12 : m - 1, m === 1 ? y - 1 : y, 8000, m, y);   // gross 25,000 → cap 12,500; PF/ESI + 8,000 advance
}
db.prepare('UPDATE employees SET gross_salary = 25000 WHERE code = ?').run(SHORT);

// ── sales workforce (Indriyan) ───────────────────────────────────────────────
const insRep = db.prepare(`INSERT INTO sales_employees (code, name, company, status, doj, gross_salary, designation, headquarters, bank_name, account_no, ifsc)
                           VALUES (?, ?, ?, 'Active', '2024-04-01', ?, 'SO', 'HQ', 'BANK', ?, 'IFSC0000001')`);
const insStruct = db.prepare(`INSERT INTO sales_salary_structures (employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, pf_applicable, esi_applicable, pt_applicable, created_by)
                              VALUES (?, '2024-04', ?, 0, 0, 0, ?, 0, 0, 0, 'sim')`);
const REPS = [['SIMS01', 'PARAMJIT SINGH'], ['SIMS02', 'ROHIT MEHRA'], ['SIMS03', 'NARESH KUMAR'], ['SIMS04', 'ANJU BALA']];
for (const [code, name] of REPS) insStruct.run(insRep.run(code, name, IND, 30000, `AC${code}`).lastInsertRowid, 30000, 30000);
function salesUpload(month, year) {
  db.prepare('UPDATE sales_uploads SET is_active = 0 WHERE month = ? AND year = ? AND company = ?').run(month, year, IND);
  const up = db.prepare(`INSERT INTO sales_uploads (month, year, company, filename, file_hash, total_rows, matched_rows, unmatched_rows, status, uploaded_by, is_active)
                         VALUES (?, ?, ?, 'sim.xlsx', ?, ?, ?, 0, 'matched', 'hr1', 1)`).run(month, year, IND, `imp-${month}-${year}`, REPS.length, REPS.length).lastInsertRowid;
  const ins = db.prepare(`INSERT INTO sales_monthly_input (month, year, company, upload_id, sheet_row_number, sheet_employee_name, sheet_days_given, employee_code, match_confidence, match_method)
                          VALUES (?, ?, ?, ?, ?, 'SIM', 30, ?, 'exact', 'sim')`);
  REPS.forEach(([code], i) => ins.run(month, year, IND, up, i + 1, code));
}

// ── helpers ─────────────────────────────────────────────────────────────────
function postFile(url, as, file, fields = {}) {
  const boundary = `----sim${Date.now()}`;
  const parts = Object.entries(fields).map(([k, v]) => Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="accounts_loans.xlsx"\r\nContent-Type: application/octet-stream\r\n\r\n`), file, Buffer.from(`\r\n--${boundary}--\r\n`));
  const body = Buffer.concat(parts);
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: api.server.address().port, method: 'POST', path: url,
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': body.length, Authorization: `Bearer ${api.tokens[as]}` } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => { let j = null; try { j = JSON.parse(Buffer.concat(chunks).toString()); } catch { /* */ } resolve({ status: res.statusCode, body: j }); });
    });
    req.on('error', reject);
    req.write(body); req.end();
  });
}
const req = async (method, url, as, body) => { quiet(); try { return await api.request(method, url, { as, body }); } finally { loud(); } };
const stage7 = (m, y, rid) => { quiet(); try { return recomputeSalary(db, { month: m, year: y, company: AL, requestId: rid }); } finally { loud(); } };
const salesCompute = async (m, y) => {
  const r = await req('POST', '/api/sales/compute', 'hr1', { month: m, year: y, company: IND });
  check(r.status === 200, `sales compute ${m}/${y}: ${r.status} ${r.text}`);
};
const close = (payroll, m, y, now) => { quiet(); try { return C.runLoanClose(db, { payroll, month: m, year: y, trigger: 'manual', actor: { username: 'fin1', role: 'finance' }, now }); } finally { loud(); } };
const reconcileAll = (label) => {
  const r = L.reconcileAll(db);
  check(r.ok, `${label}: ${r.mismatches.length} loan(s) do not reconcile — ${JSON.stringify(r.mismatches.map((x) => [x.loanId, x.problems]))}`);
  return r.checked;
};
const plantDrift = () => db.prepare('SELECT COUNT(*) AS n FROM salary_computations WHERE ABS(net_salary - (gross_earned - total_deductions)) > 1').get().n;
const salesDrift = () => db.prepare(`SELECT COUNT(*) AS n FROM sales_salary_computations
  WHERE ABS(net_salary - (gross_earned + COALESCE(diwali_bonus,0) + COALESCE(incentive_amount,0) - total_deductions)) > 1`).get().n;
const componentShort = () => db.prepare(`SELECT COUNT(*) AS n FROM salary_computations
  WHERE ABS(total_deductions - (COALESCE(pf_employee,0) + COALESCE(esi_employee,0) + COALESCE(professional_tax,0) + COALESCE(tds,0)
    + COALESCE(advance_recovery,0) + COALESCE(lop_deduction,0) + COALESCE(other_deductions,0) + COALESCE(loan_recovery,0)
    + COALESCE(late_coming_deduction,0) + COALESCE(early_exit_deduction,0) + COALESCE(lwf_employee,0))) > 1`).get().n;
/** Σ payslip loan_recovery vs Σ ledger (provisional + effective posted) per payroll + month. */
function payslipVsLedger(m, y) {
  const plantSlip = db.prepare('SELECT COALESCE(SUM(loan_recovery),0) s FROM salary_computations WHERE month = ? AND year = ?').get(m, y).s;
  const salesSlip = db.prepare('SELECT COALESCE(SUM(loan_recovery),0) s FROM sales_salary_computations WHERE month = ? AND year = ?').get(m, y).s;
  const ledger = (p) => db.prepare(`SELECT COALESCE(SUM(d.amount - COALESCE((SELECT SUM(a.amount) FROM loan_adjustments a WHERE a.deduction_id = d.id), 0)), 0) s
                                      FROM loan_deductions d WHERE d.payroll = ? AND d.month = ? AND d.year = ? AND d.state IN ('provisional','posted')`).get(p, m, y).s;
  return { plantSlip: Math.round(plantSlip * 100), plantLedger: Math.round(ledger('plant') * 100), salesSlip: Math.round(salesSlip * 100), salesLedger: Math.round(ledger('sales') * 100) };
}

// ── the accounts file ───────────────────────────────────────────────────────
const H = ['S.No', 'Employee Name', 'Firm', 'Dept', 'Date of Loan', 'Loan Amount', 'Balance Outstanding', 'Monthly EMI', 'Purpose', 'Agreement No', 'Remarks'];
const rows = [];
const add = (name, firm, dept, date, principal, out, emi, purpose = '', ag = '') => rows.push([rows.length + 1, name, firm, dept, date, principal, out, emi, purpose, ag, '']);
const clean = NAMES.slice(0, 16);
clean.forEach((n, i) => add(n.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()), i % 3 ? 'Asian Lakto' : 'ASIAN LAKTO IND LTD', 'Production',
  `${String(5 + i).padStart(2, '0')}/0${1 + (i % 8)}/2026`, 20000 + i * 1000, 6000 + i * 500, 2000 + (i % 4) * 500, i % 5 === 0 ? 'Medical' : 'Personal', `AG-${100 + i}`));
rows[5][6] = 1200; rows[5][7] = 2500;                                    // EMI above outstanding → one instalment, EMI_DIFFERS
add('Manpret Singh', 'Asian Lakto', 'Production', '12-03-2026', 15000, 9000, 3000);  // one letter
add('Rakesh Kumar', 'Asian Lakto', '', '', 12000, 8000, 2000);                     // swapped order
add('R K Sharma', 'Asian Lakto', 'Production', '', 10000, 5000, 2500);              // initials
add('Paramjit Singh', 'Indriyan', '', '01-02-2026', 30000, 12000, 4000, 'Personal', 'SAG-1');  // sales rep
add('Rohit  Mehra', 'Indriyan Beverages', '', '', '', 6000, 3000);                // sales rep
add('Surinder Pal', 'Asian Lakto', 'Store', '', 9000, 7000, 3500);                 // shared name, settled by department
add('Kuldeep Raj', 'Asian Lakto', '', '', 5000, 3000, 1000);                       // nobody has this name → out
rows.push([rows.length + 1, ...rows[1].slice(1)]);                                // exact duplicate of row 2 → out
add('Old Hand', 'Asian Lakto', '', '', 8000, 4000, 1000);                          // only on a Left employee → Left section
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['STAFF LOANS — accounts register, opening September 2026'], [], H, ...rows]), 'Loans');
const FILE = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

// ════════════════════════════════════════════════════════════════════════════
async function main() {
  const t0 = Date.now();
  check(rows.length === 25, `the file must have 25 rows (has ${rows.length})`);
  let batchId = null;
  // Before the import: plant Aug paid; plant Sep computed but NOT paid (no loan
  // yet); sales Sep computed and its NEFT exported with no loan deduction.
  stage7(8, 2026, 'aug');
  stage7(9, 2026, 'sep-before');
  salesUpload(9, 2026);
  await salesCompute(9, 2026);
  db.prepare("UPDATE sales_salary_computations SET neft_exported_at = '2026-10-07 11:00:00' WHERE month = 9 AND year = 2026").run();
  const PLANT_M = { plantCutoverMonth: 9, plantCutoverYear: 2026 };
  const BOTH_M = { ...PLANT_M, salesCutoverMonth: 10, salesCutoverYear: 2026 };
  const monthOf = (r) => `${r.month.year}-${String(r.month.month).padStart(2, '0')}`;
  if (!EMPTY) {
    // 1. HR uploads (automatic mapping from the accounts headers)
    const parse = await postFile('/api/loans/import/parse', 'hr1', FILE);
    check(parse.status === 200 && parse.body.data.rowCount === 25, `parse: ${parse.status} ${JSON.stringify(parse.body && parse.body.data && parse.body.data.mapping)}`);
    const up = await postFile('/api/loans/import/batches', 'hr1', FILE);
    check(up.status === 201, `upload: ${up.status} ${JSON.stringify(up.body)}`);
    batchId = up.body.data.batchId;
    const c = up.body.data.counts;
    check(c.duplicate === 1 && c.inactive === 1 && c.none === 1 && c.close === 3 && c.ambiguous === 1, `upload tiers: ${JSON.stringify(c)}`);
    const again = await postFile('/api/loans/import/batches', 'fin1', FILE);
    check(again.status === 409, `re-upload must be 409, got ${again.status}`);

    // 2. HR confirms every proposal; for close / ambiguous rows the right person
    let d = (await req('GET', `/api/loans/import/batches/${batchId}`, 'hr1')).body.data;
    const want = { 'Manpret Singh': codeOf('MANPREET SINGH'), 'Rakesh Kumar': codeOf('KUMAR RAKESH'), 'R K Sharma': codeOf('RAJ KUMAR SHARMA'), 'Surinder Pal': codeOf('SURINDER PAL', 'STORE') };
    for (const r of d.rows.filter((x) => x.state === 'needs_match')) {
      const code = want[r.name] || r.employee_code;
      const bt = r.candidates.find((x) => x.code === code).borrowerType;
      check(!want[r.name] || r.candidates.some((x) => x.code === code), `row ${r.row_no}: the right person is not among the candidates`);
      const res = await req('POST', `/api/loans/import/batches/${batchId}/rows/${r.id}/match`, 'hr1', { borrowerType: bt, employeeCode: code });
      check(res.status === 200, `match row ${r.row_no}: ${res.status} ${res.text}`);
    }
    check(d.rows.find((x) => x.name === 'Surinder Pal').employee_code === codeOf('SURINDER PAL', 'STORE'), 'shared name: department did not pre-select the Store person');
    // 3. finance confirms every balance; corrects one (Sunita Devi: ledger says ₹6,300 / ₹2,500)
    d = (await req('GET', `/api/loans/import/batches/${batchId}`, 'fin1')).body.data;
    const blocked = await req('POST', `/api/loans/import/batches/${batchId}/approve`, 'boss', BOTH_M);
    check(blocked.status === 400 && blocked.body.code === 'ROWS_NOT_DECIDED', `approve before finance must be refused: ${blocked.status}`);
    for (const r of d.rows.filter((x) => x.state === 'needs_balance')) {
      const body = r.name === 'Sunita Devi' ? { outstanding: 6300, emi: 2500, note: 'ledger balance on 31 Aug' } : {};
      const res = await req('POST', `/api/loans/import/batches/${batchId}/rows/${r.id}/balance`, 'fin1', body);
      check(res.status === 200, `balance row ${r.row_no}: ${res.status} ${res.text}`);
    }
    d = (await req('GET', `/api/loans/import/batches/${batchId}?plantCutoverMonth=9&plantCutoverYear=2026&salesCutoverMonth=10&salesCutoverYear=2026`, 'boss')).body.data;
    check(d.approval.canApprove && d.approval.totals.loans === 22, `approval panel: ${JSON.stringify(d.approval.blockers)} loans ${d.approval.totals.loans}`);
    check(d.approval.byPayroll.plant.loans === 20 && d.approval.byPayroll.sales.loans === 2, `by payroll: ${JSON.stringify(d.approval.byPayroll)}`);
    check(d.sections.left.length === 1 && d.sections.unmatched.length === 1 && d.sections.duplicate.length === 1, `sections: ${JSON.stringify(d.sections)}`);
    const s7 = d.approval.stage7Computed;
    check(s7.length === 20 && s7.every((x) => x.borrowerType === 'plant' && x.month.month === 9), `Stage 7 already computed: plant Sep borrowers only (${s7.length})`);
    // one approval names a month per payroll; the sales month cannot be left out
    const noSales = await req('POST', `/api/loans/import/batches/${batchId}/approve`, 'boss', PLANT_M);
    check(noSales.status === 400 && noSales.body.code === 'MONTH_INVALID' && noSales.body.payroll === 'sales', `approve without the sales month: ${noSales.status} ${noSales.text}`);
    // 4. the admin approves: plant Sep 2026, sales Oct 2026 (the real clock: 10 Oct 2026)
    const a = await req('POST', `/api/loans/import/batches/${batchId}/approve`, 'boss', { ...BOTH_M, note: 'plant Sep, sales Oct' });
    check(a.status === 201, `approve: ${a.status} ${a.text}`);
    check(a.body.data.loans.length === 22 && a.body.data.leftOut.length === 3, `approve: ${a.body.data.loans.length} loans, ${a.body.data.leftOut.length} left out`);
    check(JSON.stringify(a.body.data.cutover) === JSON.stringify({ plant: { month: 9, year: 2026 }, sales: { month: 10, year: 2026 } }), `cutover: ${JSON.stringify(a.body.data.cutover)}`);
    check(a.body.data.stage7Computed.length === 20, `approve: Stage 7 already computed for ${a.body.data.stage7Computed.length}`);
    check(JSON.stringify(a.body.data.leftOut.map((x) => x.section).sort()) === JSON.stringify(['duplicate', 'left', 'unmatched']), `left out: ${JSON.stringify(a.body.data.leftOut)}`);
    const sun = a.body.data.loans.find((l) => l.name === 'Sunita Devi');
    check(sun && sun.outstanding === 6300 && sun.emi === 2500, 'finance correction not used for Sunita Devi');
    const salesLoans = a.body.data.loans.filter((l) => l.borrowerType === 'sales');
    check(salesLoans.length === 2 && salesLoans.every((l) => l.firstEmi.month === 10), 'two sales loans, first EMI Oct');
    check(a.body.data.loans.filter((l) => l.borrowerType === 'plant').every((l) => l.firstEmi.month === 9), 'plant loans: first EMI Sep');
    check(db.prepare("SELECT COUNT(*) n FROM loans WHERE borrower_type = 'plant' AND disbursed_on = '2026-08-31'").get().n === 20, 'plant opening date 31 Aug');
    check(db.prepare("SELECT COUNT(*) n FROM loans WHERE borrower_type = 'sales' AND disbursed_on = '2026-09-25'").get().n === 2, 'sales opening date 25 Sep');
    check(reconcileAll('after import') === 22, 'reconcile count after import');
    check(db.prepare("SELECT COUNT(*) n FROM loan_events WHERE event = 'disbursed'").get().n === 0, 'an import must never write a disbursed event');
    // cutover check before the Sep re-run / Oct sales compute: the month per row
    const cc = (await req('GET', `/api/loans/import/batches/${batchId}/cutover-check`, 'fin1')).body.data;
    const flagged = (f) => cc.rows.filter((r) => r.flags.includes(f)).map((r) => r.name).sort();
    check(JSON.stringify(flagged('EMI_DIFFERS')) === JSON.stringify(['Harpreet Kaur']), `EMI_DIFFERS: ${flagged('EMI_DIFFERS')}`);
    check(JSON.stringify(flagged('HEADROOM_SHORT')) === JSON.stringify(['Meena Kumari']), `HEADROOM_SHORT: ${flagged('HEADROOM_SHORT')}`);
    check(cc.rows.every((r) => monthOf(r) === (r.payroll === 'plant' ? '2026-09' : '2026-10')), `cutover check months: ${JSON.stringify(cc.rows.map((r) => [r.payroll, r.month]))}`);
    check(cc.rows.filter((r) => r.payroll === 'plant').every((r) => r.flags.includes('NOT_DEDUCTED')), 'plant rows: Sep computed before the import → NOT_DEDUCTED');
    check(cc.rows.filter((r) => r.payroll === 'sales').every((r) => r.flags.includes('STAGE7_PENDING')), 'sales rows: Oct not computed → STAGE7_PENDING');
  }

  // 5. Plant September: Stage 7 re-run (twice: identical); sales September re-run carries no loan; plant close 13 Oct.
  stage7(9, 2026, 'sep-a');
  const sepA = JSON.stringify(db.prepare('SELECT * FROM loan_deductions ORDER BY id').all().map((r) => [r.loan_id, r.amount, r.state]));
  stage7(9, 2026, 'sep-b');
  check(JSON.stringify(db.prepare('SELECT * FROM loan_deductions ORDER BY id').all().map((r) => [r.loan_id, r.amount, r.state])) === sepA, 'Sep: a re-run changed the ledger');
  await salesCompute(9, 2026);
  let pv = payslipVsLedger(9, 2026);
  check(pv.plantSlip === pv.plantLedger && pv.salesSlip === 0 && pv.salesLedger === 0, `Sep payslip ≠ ledger (sales must carry no loan): ${JSON.stringify(pv)}`);
  if (!EMPTY) {
    check(pv.plantSlip > 0, 'plant Sep must carry the first EMIs');
    const cc = (await req('GET', `/api/loans/import/batches/${batchId}/cutover-check`, 'fin1')).body.data;
    const flags = Object.fromEntries(cc.rows.map((r) => [r.name, r.flags.join(',')]));
    check(flags['Meena Kumari'] === 'HEADROOM_SHORT,DEDUCTED_SHORT', `Meena Kumari after Stage 7: ${flags['Meena Kumari']}`);
    check(flags['Harpreet Kaur'] === 'EMI_DIFFERS', `Harpreet Kaur after Stage 7: ${flags['Harpreet Kaur']}`);
    const ok = cc.rows.filter((r) => r.payroll === 'plant' && !['Meena Kumari', 'Harpreet Kaur'].includes(r.name));
    check(ok.every((r) => r.flags.length === 0 && r.deduction && r.deduction.amount === r.appInstalment), `clean plant rows after Stage 7: ${JSON.stringify(ok.filter((r) => r.flags.length).map((r) => [r.name, r.flags]))}`);
    check(ok.every((r) => r.appInstalment === r.excelEmi || r.name === 'Sunita Devi'), 'app EMI must equal the Excel EMI for clean rows');
    reconcileAll('after Sep Stage 7');
  }
  const cS = close('plant', 9, 2026, new Date('2026-10-13T00:45:00Z'));
  const cSs = close('sales', 9, 2026, new Date('2026-10-13T00:46:00Z'));
  check(cSs.code === 'NOT_NEEDED', `sales Sep close must be NOT_NEEDED (no loan due), got ${cSs.code || 'ok'}`);
  if (!EMPTY) {
    check(cS.ok, `plant Sep close: ${cS.code || 'ok'}`);
    reconcileAll('after Sep close');
  } else check(cS.code === 'NOT_NEEDED', `empty: Sep close should be NOT_NEEDED (${cS.code})`);
  const slipBefore = JSON.stringify(db.prepare('SELECT employee_code, loan_recovery, net_salary FROM salary_computations WHERE month = 9 AND year = 2026 ORDER BY employee_code').all());
  stage7(9, 2026, 'sep-after-close');
  check(JSON.stringify(db.prepare('SELECT employee_code, loan_recovery, net_salary FROM salary_computations WHERE month = 9 AND year = 2026 ORDER BY employee_code').all()) === slipBefore, 'Sep re-run after the close changed payslips');

  // 6. October: plant Stage 7 + sales compute (the sales first EMI), closes 13 Nov.
  salesUpload(10, 2026);
  stage7(10, 2026, 'oct-a');
  await salesCompute(10, 2026);
  const octA = JSON.stringify(db.prepare('SELECT * FROM loan_deductions ORDER BY id').all().map((r) => [r.loan_id, r.amount, r.state]));
  await salesCompute(10, 2026);
  check(JSON.stringify(db.prepare('SELECT * FROM loan_deductions ORDER BY id').all().map((r) => [r.loan_id, r.amount, r.state])) === octA, 'Oct: a sales re-run changed the ledger');
  pv = payslipVsLedger(10, 2026);
  check(pv.plantSlip === pv.plantLedger && pv.salesSlip === pv.salesLedger, `Oct payslip ≠ ledger before close: ${JSON.stringify(pv)}`);
  if (!EMPTY) {
    check(pv.salesSlip > 0, 'sales Oct must carry the first EMIs');
    const cc = (await req('GET', `/api/loans/import/batches/${batchId}/cutover-check`, 'fin1')).body.data;
    const sales = cc.rows.filter((r) => r.payroll === 'sales');
    check(sales.every((r) => r.flags.length === 0 && r.deduction && r.deduction.amount === r.appInstalment && monthOf(r) === '2026-10'), `sales rows after the Oct compute: ${JSON.stringify(sales.map((r) => [r.name, r.flags]))}`);
  }
  const cO = close('plant', 10, 2026, new Date('2026-11-13T00:45:00Z'));
  const cOs = close('sales', 10, 2026, new Date('2026-11-13T00:46:00Z'));
  if (!EMPTY) {
    check(cO.ok && cOs.ok, `Oct closes: plant ${cO.code || 'ok'} sales ${cOs.code || 'ok'}`);
    reconcileAll('after Oct close');
  } else check(cO.code === 'NOT_NEEDED' && cOs.code === 'NOT_NEEDED', `empty: Oct closes should be NOT_NEEDED (${cO.code}, ${cOs.code})`);

  // 7. November: both payrolls, closes 13 Dec.
  salesUpload(11, 2026);
  stage7(11, 2026, 'nov-a');
  await salesCompute(11, 2026);
  pv = payslipVsLedger(11, 2026);
  check(pv.plantSlip === pv.plantLedger && pv.salesSlip === pv.salesLedger, `Nov payslip ≠ ledger: ${JSON.stringify(pv)}`);
  const cN = close('plant', 11, 2026, new Date('2026-12-13T00:45:00Z'));
  const cNs = close('sales', 11, 2026, new Date('2026-12-13T00:46:00Z'));
  if (!EMPTY) {
    check(cN.ok && cNs.ok, `Nov closes: plant ${cN.code || 'ok'} sales ${cNs.code || 'ok'}`);
    reconcileAll('after Nov close');
  }
  for (const [m, y] of [[9, 2026], [10, 2026], [11, 2026]]) {
    const p = payslipVsLedger(m, y);
    check(p.plantSlip === p.plantLedger && p.salesSlip === p.salesLedger, `${m}/${y} payslip ≠ ledger after the closes: ${JSON.stringify(p)}`);
  }
  check(plantDrift() === 0, `plant drift rows: ${plantDrift()}`);
  check(salesDrift() === 0, `sales drift rows: ${salesDrift()}`);
  check(componentShort() === 0, `component-short rows: ${componentShort()}`);

  // summary — non-borrower rows (OTH*, sales SIMS03/04) must hash the same in full and --empty mode
  const nonBorrowers = JSON.stringify([
    ...db.prepare("SELECT employee_code, month, gross_earned, total_deductions, net_salary FROM salary_computations WHERE employee_code LIKE 'OTH%' ORDER BY employee_code, month").all(),
    ...db.prepare("SELECT employee_code, month, gross_earned, total_deductions, net_salary FROM sales_salary_computations WHERE employee_code IN ('SIMS03','SIMS04') ORDER BY employee_code, month").all(),
  ]);
  const s = {
    nonBorrowerHash: require('crypto').createHash('md5').update(nonBorrowers).digest('hex').slice(0, 12),
    loans: db.prepare('SELECT COUNT(*) n FROM loans').get().n,
    byStatus: Object.fromEntries(db.prepare('SELECT status, COUNT(*) n FROM loans GROUP BY status').all().map((r) => [r.status, r.n])),
    imported: db.prepare('SELECT ROUND(COALESCE(SUM(disbursed_amount),0),2) s FROM loans').get().s,
    posted: db.prepare("SELECT ROUND(COALESCE(SUM(amount),0),2) s FROM loan_deductions WHERE state = 'posted'").get().s,
    balance: db.prepare('SELECT ROUND(COALESCE(SUM(remaining_balance),0),2) s FROM loans').get().s,
    shortfallInstalments: db.prepare("SELECT COUNT(*) n FROM loan_instalments WHERE origin = 'shortfall'").get().n,
    closes: db.prepare('SELECT COUNT(*) n FROM loan_closes').get().n,
    importRows: db.prepare('SELECT COUNT(*) n FROM loan_import_rows').get().n,
  };
  if (EMPTY) check(s.loans === 0 && s.closes === 0 && s.importRows === 0, `empty mode wrote loan data: ${JSON.stringify(s)}`);
  else {
    check(s.byStatus.completed >= 1, 'the EMI-above-outstanding loan should complete at the Sep close');
    check(s.shortfallInstalments >= 1, 'the short-room borrower should have a shortfall instalment');
    check(Math.round((s.imported - s.posted) * 100) === Math.round(s.balance * 100), `imported − posted ≠ balance: ${JSON.stringify(s)}`);
  }
  console.log(`[loans-import-sim${EMPTY ? ' --empty' : ''}] ${JSON.stringify(s)} · plant drift ${plantDrift()} · sales drift ${salesDrift()} · component-short ${componentShort()} · ${Date.now() - t0} ms`);
  quiet();
  await api.close();
  loud();
  if (failures.length) {
    console.error(`FAIL (${failures.length}):`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log('PASS');
}

main().catch((e) => { loud(); console.error(e); process.exit(1); });
