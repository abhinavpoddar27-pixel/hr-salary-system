#!/usr/bin/env node
/**
 * Loans PR-5 — plant Stage 7 simulation (docs/loans/SPEC.md §5.1, §5.2 r4–r5, D-11, D-12, K23, K25, K29).
 *
 *   node backend/scripts/loans-stage7-simulation.js                 # all checks (branch)
 *   node backend/scripts/loans-stage7-simulation.js --dump out.json # no-loan month only: write every salary row
 *
 * In-memory database built by the real initSchema(); nothing touches a file
 * except the --dump output. A synthetic month shaped like Sep 2026 production
 * (211 plant rows over two companies: 76 contractors, ~21 held, 14 OT,
 * 82 holiday duty, 150 advances, 85 ED grants, a few late-coming deductions).
 * Codes and names are synthetic.
 *
 * --dump uses only APIs that exist on origin/main before PR-5 (initSchema,
 * recomputeSalary), so the same command on a throw-away origin/main worktree
 * and on the branch must give byte-identical files: with no loans on the
 * books, PR-5 changes nothing.
 *
 * Full mode (branch only):
 *   A  no loans                     → baseline rows; drift 0; component-short 0
 *   B  + 5 loans (normal, shortfall, held, OT worker, zero headroom)
 *                                   → non-borrower rows identical to A; borrowers differ only in
 *                                     loan_recovery / total_deductions / net / total_payable / take_home;
 *                                     each loan amount = min(due, headroom); balance never moves
 *   C  Stage 7 again                → identical rows, identical ledger rows, no new loan events
 *   D  reimport (delete one company's salary rows, recompute it)
 *                                   → identical again
 *   reconcileLoan clean for every loan after every step.
 * Exit 0 only if every check passes.
 */
const fs = require('fs');
const Database = require('better-sqlite3');
const { initSchema } = require('../src/database/schema');
const { recomputeSalary } = require('../src/services/recompute');

const args = process.argv.slice(2);
const dumpIdx = args.indexOf('--dump');
const DUMP = dumpIdx >= 0 ? args[dumpIdx + 1] : null;
if (dumpIdx >= 0 && !DUMP) { console.error('--dump needs a file path'); process.exit(2); }

const M = 11;
const Y = 2026;
const COMPANIES = ['Indriyan Beverages Pvt Ltd', 'Asian Lakto Ind Ltd'];

function silently(fn) {
  const { log, error, warn } = console;
  console.log = () => {}; console.error = () => {}; console.warn = () => {};
  try { return fn(); } finally { console.log = log; console.error = error; console.warn = warn; }
}

// Deterministic PRNG (mulberry32) — same month on every run, on every branch.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Builds the synthetic month. Returns the employee list with the traits used to pick borrowers. */
function buildMonth(db) {
  const r = rng(20260930);
  const pick = (n) => Math.floor(r() * n);
  const N = 211;
  const contractors = new Set();
  while (contractors.size < 76) contractors.add(pick(N));
  const held = new Set();
  while (held.size < 21) held.add(pick(N));
  const perm = [...Array(N).keys()].filter((i) => !contractors.has(i));
  const ot = new Set();
  while (ot.size < 14) ot.add(perm[pick(perm.length)]);
  const hd = new Set();
  while (hd.size < 82) hd.add(perm[pick(perm.length)]); // contractors get no holiday-duty pay
  const adv = new Set();
  while (adv.size < 150) adv.add(pick(N));
  const ed = new Set();
  while (ed.size < 85) ed.add(perm[pick(perm.length)]); // nor ED
  const late = new Set();
  while (late.size < 12) late.add(perm[pick(perm.length)]);

  const insEmp = db.prepare(`INSERT INTO employees (code, name, department, company, employment_type, status, date_of_joining,
                               is_contractor, weekly_off_day, gross_salary, pf_applicable, esi_applicable)
                             VALUES (?, ?, ?, ?, ?, 'Active', ?, ?, 0, ?, ?, ?)`);
  const insDc = db.prepare(`INSERT INTO day_calculations (employee_code, month, year, company, days_present, days_half_present, days_wop,
                              cl_used, el_used, sl_used, od_days, lop_days, total_payable_days, paid_sundays, paid_holidays, days_absent,
                              total_working_days, extra_duty_days, holiday_duty_days, ot_hours)
                            VALUES (?, ?, ?, ?, ?, 0, ?, 0, 0, 0, 0, ?, ?, ?, ?, ?, 26, ?, ?, ?)`);
  const insAdv = db.prepare(`INSERT INTO salary_advances (employee_code, month, year, is_eligible, advance_amount, paid, recovered, recovery_month, recovery_year)
                             VALUES (?, 10, 2026, 1, ?, 1, 0, ?, ?)`);
  const insEd = db.prepare(`INSERT INTO extra_duty_grants (employee_code, grant_date, month, year, company, duty_days, verification_source,
                              status, finance_status, requested_by, approved_by)
                            VALUES (?, ?, ?, ?, ?, ?, 'SIM', 'APPROVED', 'FINANCE_APPROVED', 'hr1', 'hr1')`);
  const insLate = db.prepare(`INSERT INTO late_coming_deductions (employee_code, month, year, company, late_count, deduction_days, remark,
                                applied_by, applied_at, finance_status)
                              VALUES (?, ?, ?, ?, ?, ?, 'sim', 'hr1', '2026-11-28 10:00:00', 'approved')`);
  // The month-end absence streak check reads attendance_processed: present rows for the last week.
  const insAtt = db.prepare(`INSERT INTO attendance_processed (employee_code, date, status_original, status_final, company)
                             VALUES (?, ?, 'P', 'P', ?)`);

  const emps = [];
  for (let i = 0; i < N; i++) {
    const code = `SIM${String(i + 1).padStart(3, '0')}`;
    const company = COMPANIES[i % 2];
    const isContract = contractors.has(i);
    const gross = isContract ? 9000 + pick(8) * 500 : 12000 + pick(34) * 1000;
    const pf = !isContract && r() < 0.7 ? 1 : 0;
    const esi = gross <= 21000 ? 1 : 0;
    insEmp.run(code, `SIM EMPLOYEE ${i + 1}`, isContract ? 'CONT LABOUR' : 'PRODUCTION', company,
      isContract ? 'Contract' : 'Permanent', '2024-04-01', isContract ? 1 : 0, gross, pf, esi);

    const isHeld = held.has(i);
    let present = isHeld ? 1 + pick(3) : 18 + pick(9);
    if (i === 7) present = 0; // one zero-attendance row (silent skip)
    const wop = isHeld || i === 7 ? 0 : pick(2);
    const sundays = isHeld ? 0 : 4;
    const holidays = isHeld ? 0 : 1;
    const payable = isHeld ? present : Math.min(30, present + wop + sundays + holidays);
    const absent = Math.max(0, 26 - present);
    insDc.run(code, M, Y, company, present, wop, 0, payable, sundays, holidays, absent,
      ot.has(i) ? 1 + pick(5) : 0, hd.has(i) ? 1 + pick(2) : 0, ot.has(i) ? pick(12) : 0);

    if (!isHeld && present > 0) for (let d = 23; d <= 30; d++) insAtt.run(code, `2026-11-${d}`, company);
    // Held rows earn too little for an advance; one there would trip the existing deductions clip.
    if (adv.has(i) && !isHeld) insAdv.run(code, 1000 + pick(6) * 500, M, Y);
    if (ed.has(i)) {
      const n = 1 + pick(3);
      for (let k = 0; k < n; k++) insEd.run(code, `2026-11-${String(3 + k * 7).padStart(2, '0')}`, M, Y, company, 1);
    }
    if (late.has(i) && !isHeld) insLate.run(code, M, Y, company, 3 + pick(5), [0.5, 1, 1.5][pick(3)]);
    emps.push({ code, company, isContract, isHeld, ot: ot.has(i), hd: hd.has(i), adv: adv.has(i), gross });
  }
  // The zero-headroom borrower: a deliberately large advance on a permanent, non-held, no-OT row.
  const zero = emps.find((e) => !e.isContract && !e.isHeld && !e.ot && !e.adv && e.gross >= 20000 && e.code !== 'SIM008');
  insAdv.run(zero.code, Math.round(zero.gross * 0.6), M, Y);
  zero.adv = true; zero.zeroRoom = true;
  return emps;
}

function newDb() {
  const db = new Database(':memory:');
  silently(() => initSchema(db));
  return db;
}

function stage7(db, runId, companies = COMPANIES, opts = {}) {
  const outs = [];
  for (const company of companies) {
    outs.push(silently(() => recomputeSalary(db, { month: M, year: Y, company, requestId: `${runId}-${company.split(' ')[0]}`, ...opts })));
  }
  return outs;
}

const TS = ['computed_at', 'created_at', 'updated_at'];
function salaryRows(db) {
  return db.prepare('SELECT * FROM salary_computations WHERE month = ? AND year = ? ORDER BY employee_code, company').all(M, Y)
    .map((row) => { const r = { ...row }; for (const k of TS) delete r[k]; return r; });
}

function driftCount(db) {
  return db.prepare('SELECT COUNT(*) AS n FROM salary_computations WHERE ABS(net_salary - (gross_earned - total_deductions)) > 1').get().n;
}
function componentShort(db) {
  return db.prepare(`SELECT COUNT(*) AS n FROM salary_computations
    WHERE ABS(total_deductions - (COALESCE(pf_employee,0) + COALESCE(esi_employee,0)
      + COALESCE(professional_tax,0) + COALESCE(tds,0) + COALESCE(advance_recovery,0)
      + COALESCE(lop_deduction,0) + COALESCE(other_deductions,0) + COALESCE(loan_recovery,0)
      + COALESCE(late_coming_deduction,0) + COALESCE(early_exit_deduction,0))) > 1`).get().n;
}

// ── --dump: the no-loan month only, identical on origin/main and the branch ──
if (DUMP) {
  const db = newDb();
  buildMonth(db);
  stage7(db, 'dump');
  const rows = salaryRows(db);
  fs.writeFileSync(DUMP, `${JSON.stringify(rows, null, 1)}\n`);
  console.log(`dumped ${rows.length} salary rows to ${DUMP}; drift=${driftCount(db)} component-short=${componentShort(db)}`);
  process.exit(0);
}

// ── Full mode ──
const L = require('../src/services/loans');
const { planStage7Loans } = require('../src/services/loans/stage7');
const { toPaise, toRupees } = L.money;
const HR = { username: 'hr1', role: 'hr' };
const FIN = { username: 'fin1', role: 'finance' };
const ADMIN = { username: 'admin1', role: 'admin' };
const ASOF = '2026-10-09';

const failures = [];
const check = (cond, msg) => { if (!cond) failures.push(msg); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function setPolicy(db, key, value) {
  db.prepare('INSERT OR REPLACE INTO policy_config (key, value, description) VALUES (?, ?, COALESCE((SELECT description FROM policy_config WHERE key = ?), ?))')
    .run(key, String(value), key, key);
}

function giveLoan(db, emp, principal, tenure) {
  const r = L.requestLoan(db, { borrowerType: 'plant', employeeCode: emp.code, company: emp.company, loanType: 'Personal', principal, tenure, reason: 'sim' }, HR, { asOf: ASOF });
  if (!r.ok) throw new Error(`request ${emp.code}: ${r.code} ${r.message}`);
  const a = L.approveLoan(db, r.loanId, ADMIN, { asOf: ASOF });
  if (!a.ok) throw new Error(`approve ${emp.code}: ${a.code} ${a.message}`);
  const d = L.disburseLoan(db, r.loanId, FIN, { mode: 'NEFT', reference: `UTR-${emp.code}`, disbursedOn: '2026-10-05', agreementFilePath: 'agreements/sim.pdf' }, { asOf: ASOF });
  if (!d.ok) throw new Error(`disburse ${emp.code}: ${d.code} ${d.message}`);
  return r.loanId;
}

function ledger(db) {
  return {
    deductions: db.prepare('SELECT * FROM loan_deductions ORDER BY id').all().map((d) => { const x = { ...d }; delete x.run_id; delete x.updated_at; delete x.created_at; return x; }),
    instalments: db.prepare('SELECT * FROM loan_instalments ORDER BY id').all().map((i) => { const x = { ...i }; delete x.updated_at; delete x.created_at; return x; }),
    loans: db.prepare('SELECT * FROM loans ORDER BY id').all().map((l) => { const x = { ...l }; delete x.updated_at; return x; }),
    events: db.prepare('SELECT COUNT(*) AS n FROM loan_events').get().n,
  };
}

function cleanChecks(db, label) {
  check(driftCount(db) === 0, `${label}: drift rows = ${driftCount(db)}`);
  check(componentShort(db) === 0, `${label}: component-short rows = ${componentShort(db)}`);
}

function reconcileAll(db, loanIds, label) {
  for (const id of loanIds) {
    const rec = L.reconcileLoan(db, id);
    check(rec.ok, `${label}: reconcileLoan(${id}) not clean: ${JSON.stringify(rec).slice(0, 200)}`);
  }
}

// A — no loans
const dbA = newDb();
buildMonth(dbA);
stage7(dbA, 'A');
const rowsA = salaryRows(dbA);
cleanChecks(dbA, 'A');
check(rowsA.every((r) => r.loan_recovery === 0), 'A: some loan_recovery is not 0');
check(dbA.prepare('SELECT COUNT(*) AS n FROM loan_deductions').get().n === 0, 'A: loan_deductions not empty');
const heldA = rowsA.filter((r) => r.salary_held === 1).length;
const otA = rowsA.filter((r) => r.ot_pay > 0).length;
const hdA = rowsA.filter((r) => r.holiday_duty_pay > 0).length;
const advA = rowsA.filter((r) => r.advance_recovery > 0).length;
const edA = rowsA.filter((r) => r.ed_pay > 0).length;
console.log(`A  no loans: ${rowsA.length} rows (held ${heldA}, OT ${otA}, holiday duty ${hdA}, advances ${advA}, ED ${edA}); drift ${driftCount(dbA)}; component-short ${componentShort(dbA)}`);

// B — five borrowers
const dbB = newDb();
const emps = buildMonth(dbB);
setPolicy(dbB, 'loan_emi_ceiling_pct_gross', 100);
const rowA = (code) => rowsA.find((r) => r.employee_code === code);
const permOk = (e) => !e.isContract && rowA(e.code) && rowA(e.code).salary_held === 0;
const borrowers = {
  normal: emps.find((e) => permOk(e) && !e.adv && !e.ot && !e.hd && !e.zeroRoom),
  shortfall: emps.find((e) => permOk(e) && e.adv && !e.ot && !e.zeroRoom),
  held: emps.find((e) => !e.isContract && rowA(e.code) && rowA(e.code).salary_held === 1),
  ot: emps.find((e) => permOk(e) && e.ot && rowA(e.code).holiday_duty_pay > 0) || emps.find((e) => permOk(e) && e.ot),
  zero: emps.find((e) => e.zeroRoom),
};
for (const [k, e] of Object.entries(borrowers)) if (!e) throw new Error(`no candidate for the ${k} borrower`);
// Shortfall: an EMI bigger than the room left after the advance.
const roomOf = (code) => {
  const r = rowA(code);
  return toRupees(Math.max(0, Math.floor(toPaise(r.gross_earned) * 50 / 100)
    - toPaise(r.pf_employee + r.esi_employee + r.professional_tax + r.tds + r.advance_recovery + r.lop_deduction
      + r.other_deductions + r.late_coming_deduction + r.early_exit_deduction)));
};
const sfRoom = roomOf(borrowers.shortfall.code);
const loanIds = {
  normal: giveLoan(dbB, borrowers.normal, 9000, 3),
  shortfall: giveLoan(dbB, borrowers.shortfall, Math.ceil((sfRoom + 1500) * 3 / 100) * 100, 3),
  held: giveLoan(dbB, borrowers.held, 6000, 3),
  ot: giveLoan(dbB, borrowers.ot, 6000, 3),
  zero: giveLoan(dbB, borrowers.zero, 6000, 3),
};
const ids = Object.values(loanIds);
const outB = stage7(dbB, 'B');
const rowsB = salaryRows(dbB);
cleanChecks(dbB, 'B');
reconcileAll(dbB, ids, 'B');

const borrowerCodes = new Set(Object.values(borrowers).map((e) => e.code));
const LOAN_COLS = new Set(['loan_recovery', 'total_deductions', 'net_salary', 'total_payable', 'take_home']);
check(rowsB.length === rowsA.length, `B: ${rowsB.length} rows vs A ${rowsA.length}`);
for (let i = 0; i < rowsA.length; i++) {
  const a = rowsA[i]; const b = rowsB[i];
  if (!b || a.employee_code !== b.employee_code) { check(false, `B: row ${i} order differs`); continue; }
  if (!borrowerCodes.has(a.employee_code)) {
    check(same(a, b), `B: non-borrower ${a.employee_code} changed`);
  } else {
    for (const k of Object.keys(a)) {
      if (!LOAN_COLS.has(k)) check(same(a[k], b[k]), `B: borrower ${a.employee_code} column ${k} changed (${a[k]} → ${b[k]})`);
    }
    const lr = b.loan_recovery;
    check(Math.abs(b.total_deductions - (a.total_deductions + lr)) <= 0.01, `B: ${a.employee_code} total_deductions not A + loan`);
    check(Math.abs(b.net_salary - (a.net_salary - lr)) <= 0.01, `B: ${a.employee_code} net not A − loan`);
    check(Math.abs(b.total_payable - (a.total_payable - lr)) <= 0.01, `B: ${a.employee_code} total_payable not A − loan`);
    check(Math.abs(b.take_home - (a.take_home - lr)) <= 0.01, `B: ${a.employee_code} take_home not A − loan`);
    check(!b.salary_warning, `B: ${a.employee_code} clipped (${b.salary_warning})`);
  }
}
// Each loan: min(due, headroom), recorded provisional, balance unchanged.
const ledB = ledger(dbB);
for (const [k, id] of Object.entries(loanIds)) {
  const e = borrowers[k];
  const ins = dbB.prepare('SELECT * FROM loan_instalments WHERE loan_id = ? ORDER BY sequence').all(id);
  const loan = dbB.prepare('SELECT * FROM loans WHERE id = ?').get(id);
  const ded = dbB.prepare('SELECT * FROM loan_deductions WHERE loan_id = ?').all(id);
  const expected = Math.min(ins[0].amount_due, roomOf(e.code));
  const got = rowsB.find((r) => r.employee_code === e.code).loan_recovery;
  check(Math.abs(got - expected) <= 0.01, `B: ${k} (${e.code}) loan_recovery ${got}, expected min(due ${ins[0].amount_due}, room ${roomOf(e.code)}) = ${expected}`);
  check(ded.length === 1 && ded[0].state === 'provisional' && Math.abs(ded[0].amount - got) <= 0.001, `B: ${k} ledger row wrong: ${JSON.stringify(ded)}`);
  check(ins[0].due_month === M && ins[0].due_year === Y && ins[0].status === 'provisional', `B: ${k} first instalment not provisional for ${M}/${Y}`);
  check(ins.slice(1).every((x) => x.status === 'scheduled'), `B: ${k} later instalments moved`);
  check(loan.remaining_balance === loan.principal_amount && loan.status === 'active', `B: ${k} balance/status moved`);
  // planStage7Loans agrees with what was written (read-only call).
  const r = rowsB.find((x) => x.employee_code === e.code);
  const plan = planStage7Loans(dbB, { employeeCode: e.code, month: M, year: Y, payroll: 'plant', salary: r });
  check(Math.abs(plan.totalRupees - got) <= 0.01, `B: ${k} re-plan ${plan.totalRupees} ≠ ${got}`);
}
check(rowsB.find((r) => r.employee_code === borrowers.zero.code).loan_recovery === 0, 'B: zero-headroom borrower deducted something');
check(rowsB.find((r) => r.employee_code === borrowers.shortfall.code).loan_recovery < dbB.prepare('SELECT amount_due FROM loan_instalments WHERE loan_id = ? AND sequence = 1').get(loanIds.shortfall).amount_due,
  'B: shortfall borrower was not short');
check(rowsB.find((r) => r.employee_code === borrowers.held.code).salary_held === 1, 'B: held borrower not held');
check(rowsB.find((r) => r.employee_code === borrowers.ot.code).ot_pay > 0, 'B: OT borrower has no OT');
const recordedB = outB.reduce((s, o) => s + o.loans.recorded, 0);
check(recordedB === 5, `B: recorded ${recordedB}, expected 5`);
console.log(`B  + 5 loans: ${Object.entries(loanIds).map(([k]) => `${k} ${borrowers[k].code} ₹${rowsB.find((r) => r.employee_code === borrowers[k].code).loan_recovery}`).join(' · ')}`);

// C — run again
const outC = stage7(dbB, 'C');
check(same(salaryRows(dbB), rowsB), 'C: salary rows changed on re-run');
check(same(ledger(dbB), ledB), 'C: loan ledger changed on re-run (rows or event count)');
check(outC.reduce((s, o) => s + o.loans.recorded + o.loans.cleared + o.loans.orphansCleared, 0) === 0, 'C: re-run wrote ledger changes');
cleanChecks(dbB, 'C');
reconcileAll(dbB, ids, 'C');
console.log(`C  re-run: rows identical ${same(salaryRows(dbB), rowsB)}, ledger identical ${same(ledger(dbB), ledB)}, events ${ledger(dbB).events}`);

// D — reimport shape for one company (import.js runReimportRecompute: delete, then recompute)
dbB.prepare('DELETE FROM salary_computations WHERE month = ? AND year = ? AND company = ?').run(M, Y, COMPANIES[0]);
const outD = stage7(dbB, 'D', [COMPANIES[0]], { scopeStampToCompany: true });
const rowsD = salaryRows(dbB).map((r) => { const x = { ...r }; delete x.id; return x; });
const rowsBnoId = rowsB.map((r) => { const x = { ...r }; delete x.id; return x; });
check(same(rowsD, rowsBnoId), 'D: rows after reimport differ (ignoring id)');
check(same(ledger(dbB), ledB), 'D: loan ledger changed after reimport');
check(outD[0].loans.orphansCleared === 0, 'D: orphan sweep cleared something');
cleanChecks(dbB, 'D');
reconcileAll(dbB, ids, 'D');
console.log(`D  reimport ${COMPANIES[0]}: rows identical ${same(rowsD, rowsBnoId)}, ledger identical ${same(ledger(dbB), ledB)}`);

console.log(`drift: A ${driftCount(dbA)}, B/C/D ${driftCount(dbB)} · component-short: A ${componentShort(dbA)}, B/C/D ${componentShort(dbB)}`);
if (failures.length) {
  console.error(`\nFAILED (${failures.length}):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('\nALL CHECKS PASSED');
process.exit(0);
