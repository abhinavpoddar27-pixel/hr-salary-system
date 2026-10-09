#!/usr/bin/env node
/**
 * Loans PR-8 — sales loans simulation (docs/loans/SPEC.md §5.2 r4–r8, r11,
 * §5.3; D-5, D-14, D-15; K8, K10, K12, K22, K28–K31; rulings Q1–Q8).
 *
 *   node backend/scripts/loans-sales-simulation.js                 # full: 7 sales loans, Nov 2026 – Mar 2027
 *   node backend/scripts/loans-sales-simulation.js --dump out.json # no-loan month only: every sales salary row
 *   node backend/scripts/loans-sales-simulation.js --empty         # the full calendar with no loans: the loan job writes nothing
 *
 * Real schema (via the JWT harness: temp DATA_DIR, real initSchema), the REAL
 * sales routes over HTTP with real JWTs (POST /api/sales/compute,
 * PUT /api/sales/salary/:id, PUT /api/sales/salary/:id/status, mark-left),
 * the real loan engine and the real runDailyLoanJobs on an injected clock.
 * Codes and names are synthetic.
 *
 * --dump uses only things that exist on the PR-8 base (origin/feat/loans-pr7):
 * the harness, the sales routes and initSchema. The same command on a
 * throw-away base worktree and on the branch must give byte-identical files —
 * a sales month with no loans is unchanged by PR-8, including a row whose net
 * is negative (other deductions above earnings, like production row 9415):
 * the ₹0 floor applies only to rows carrying a loan (ruling Q1).
 *
 * Full mode — the synthetic workforce (shaped like Sep 2026 production: 230
 * Indriyan rows, 15 on hold, a few other deductions, one negative net; 2 Asian
 * Lakto reps, one sharing a code with an Indriyan rep) plus 7 loans:
 *   A  ₹12,000/3 normal                                  → posted Nov, Dec, Jan → completed
 *   B  ₹12,000/3 HR other-deductions edit in Nov (K30)   → Nov short → shortfall instalment → completed
 *   C  ₹9,000/3  Nov row on hold, released 20 Dec        → held at the Nov close, posted by the sweep
 *   D  ₹9,000/3  Nov row on hold, never released         → day 60: moved to the end; release refused (K28)
 *                                                          until the month is recomputed; then released
 *   E  ₹12,000/3 Mark Left 27 Dec (dol 27 Dec → Jan cycle, Q4) → Jan final payroll short → exit residual
 *                                                          → finance receipt → settled_at_exit
 *   F  ₹6,000/3  Asian Lakto, code shared with an Indriyan rep (K8, Q2) → only the ALI row carries it
 *   G  ₹6,000/3  disbursed 28 Oct (Q3)                   → first EMI Dec
 * Each sales month M: computed (twice, identical) on the 5th of M+1; closed on
 * the 13th; the daily job runs every day. Checks: every loan reconciles to the
 * paisa every day; sales payslip = ledger; sales drift
 * ABS(net − (gross_earned + diwali_bonus + incentive − total_deductions)) > 1
 * = 0 and component-short = 0; a posted row cannot go to Hold (K31);
 * non-borrower rows are identical to the same calendar run with no loans
 * (a child process, --empty); plant tables untouched. Exit 0 only if all pass.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const args = process.argv.slice(2);
const dumpIdx = args.indexOf('--dump');
const DUMP = dumpIdx >= 0 ? args[dumpIdx + 1] : null;
if (dumpIdx >= 0 && !DUMP) { console.error('--dump needs a file path'); process.exit(2); }
const EMPTY = args.includes('--empty');
const ROWS_OUT = (() => { const i = args.indexOf('--rows-out'); return i >= 0 ? args[i + 1] : null; })();

const { log: realLog, error: realError, warn: realWarn } = console;
const quiet = () => { console.log = () => {}; console.warn = () => {}; console.error = () => {}; };
const loud = () => { console.log = realLog; console.warn = realWarn; console.error = realError; };

quiet();
const { startJwtApi } = require('../src/__tests__/helpers/jwtApiHarness');
const api = startJwtApi({ '/api/sales': '../../routes/sales' },
  { users: [{ username: 'hr1', role: 'hr' }, { username: 'boss', role: 'admin' }, { username: 'fin1', role: 'finance' }] });
const db = api.db;
loud();

const IND = 'Indriyan Beverages Pvt Ltd';
const ALI = 'Asian Lakto Ind Ltd';
const failures = [];
const check = (cond, msg) => { if (!cond) failures.push(msg); };

// ── deterministic PRNG (mulberry32) ─────────────────────────────────────────
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
const rand = rng(20261010);
const pick = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));

// ── workforce ────────────────────────────────────────────────────────────────
const insRep = db.prepare(`INSERT INTO sales_employees (code, name, company, status, doj, gross_salary, designation, headquarters, bank_name, account_no, ifsc)
                           VALUES (?, ?, ?, 'Active', '2024-04-01', ?, 'SO', 'HQ', 'BANK', ?, 'IFSC0000001')`);
const insStruct = db.prepare(`INSERT INTO sales_salary_structures (employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, pf_applicable, esi_applicable, pt_applicable, created_by)
                              VALUES (?, '2024-04', ?, ?, ?, ?, ?, ?, ?, 0, 'sim')`);
function addRep(code, company, gross, { pf = 0, esi = 0, split = true } = {}) {
  const id = insRep.run(code, `SIM REP ${code}`, company, gross, `AC${code}${company.slice(0, 3)}`).lastInsertRowid;
  const basic = split ? Math.round(gross * 0.5) : gross;
  const hra = split ? Math.round(gross * 0.25) : 0;
  const cca = split ? Math.round(gross * 0.15) : 0;
  insStruct.run(id, basic, hra, cca, gross - basic - hra - cca, gross, pf, esi);
  return code;
}

const reps = [];          // {code, company, days(m) -> number}
for (let i = 1; i <= 230; i++) {
  const code = `Z${String(i).padStart(3, '0')}`;
  const gross = pick(12, 45) * 1000;
  addRep(code, IND, gross, { pf: rand() < 0.3 ? 1 : 0, esi: gross <= 21000 && rand() < 0.5 ? 1 : 0 });
  reps.push({ code, company: IND, base: pick(18, 31) });
}
// Borrowers: fixed shape, 31 days every month, ₹30,000 (₹15,000 cap at a full month).
const ROLE = { A: 'Z001', B: 'Z002', C: 'Z003', D: 'Z004', E: 'Z005', G: 'Z007', F: 'Z006' };
for (const code of Object.values(ROLE)) {
  db.prepare('UPDATE sales_employees SET gross_salary = 30000 WHERE code = ? AND company = ?').run(code, IND);
  db.prepare(`UPDATE sales_salary_structures SET basic = 30000, hra = 0, cca = 0, conveyance = 0, gross_salary = 30000, pf_applicable = 0, esi_applicable = 0
               WHERE employee_id = (SELECT id FROM sales_employees WHERE code = ? AND company = ?)`).run(code, IND);
  reps.find((r) => r.code === code).base = 31;
}
// Asian Lakto: Z006 shares its code with Indriyan Z006 (another person); Z901 alone.
addRep(ROLE.F, ALI, 30000, { split: false });
addRep('Z901', ALI, 18000);
reps.push({ code: ROLE.F, company: ALI, base: 31 }, { code: 'Z901', company: ALI, base: 26 });

const HOLD = reps.filter((r) => r.company === IND && !Object.values(ROLE).includes(r.code)).slice(0, 15).map((r) => r.code);
const OTHER_DED = { Z020: 1500, Z021: 800, Z022: 2500 };     // ordinary HR other deductions
const NEGATIVE = 'Z030';                                       // other deductions above earnings, no loan

// ── helpers ─────────────────────────────────────────────────────────────────
async function compute(month, year, company) {
  quiet();
  try {
    const r = await api.request('POST', '/api/sales/compute', { as: 'hr1', body: { month, year, company } });
    if (r.status !== 200) throw new Error(`compute ${month}/${year} ${company}: ${r.status} ${r.text}`);
    return r.body.data;
  } finally { loud(); }
}
const rowOf = (code, month, year, company = IND) => db.prepare('SELECT * FROM sales_salary_computations WHERE employee_code = ? AND month = ? AND year = ? AND company = ?').get(code, month, year, company);
const put = (id, body) => api.request('PUT', `/api/sales/salary/${id}`, { as: 'hr1', body });
const status = (id, to) => api.request('PUT', `/api/sales/salary/${id}/status`, { as: 'hr1', body: { status: to } });

const left = new Map();   // code|company → cycle month index after which they are gone
function setUpload(month, year, company) {
  db.prepare('UPDATE sales_uploads SET is_active = 0 WHERE month = ? AND year = ? AND company = ?').run(month, year, company);
  const list = reps.filter((r) => r.company === company && !(left.has(`${r.code}|${company}`) && year * 12 + month > left.get(`${r.code}|${company}`)));
  const up = db.prepare(`INSERT INTO sales_uploads (month, year, company, filename, file_hash, total_rows, matched_rows, unmatched_rows, status, uploaded_by, is_active)
                         VALUES (?, ?, ?, 'sim.xlsx', ?, ?, ?, 0, 'matched', 'hr1', 1)`)
    .run(month, year, company, `sim-${month}-${year}-${company}`, list.length, list.length).lastInsertRowid;
  const ins = db.prepare(`INSERT INTO sales_monthly_input (month, year, company, upload_id, sheet_row_number, sheet_employee_name, sheet_days_given, employee_code, match_confidence, match_method)
                          VALUES (?, ?, ?, ?, ?, 'SIM', ?, ?, 'exact', 'sim')`);
  list.forEach((r, i) => {
    let days = Math.min(31, r.base + ((month + i) % 3) - 1);
    if (r.code === ROLE.E && company === IND && year === 2027 && month === 1) days = 2;   // leaver: 2 days in the Jan cycle
    ins.run(month, year, company, up, i + 1, Math.max(0, days), r.code);
  });
}

/** One sales month the way HR runs it: upload, compute, HR edits, holds, compute again. */
async function runMonth(month, year, hooks = {}) {
  for (const company of [IND, ALI]) setUpload(month, year, company);
  await compute(month, year, IND);
  await compute(month, year, ALI);
  for (const [code, amt] of Object.entries(OTHER_DED)) await put(rowOf(code, month, year).id, { other_deductions: amt });
  await put(rowOf(NEGATIVE, month, year).id, { other_deductions: 60000 });
  await put(rowOf('Z040', month, year).id, { incentive_amount: 3000 });
  if (hooks.edits) await hooks.edits();
  for (const code of HOLD) {
    const r = rowOf(code, month, year);
    if (r && r.status !== 'hold') await status(r.id, 'hold');
  }
  if (hooks.holds) await hooks.holds();
  // A second compute: HR-entered values carried forward, everything identical.
  const snap = () => db.prepare('SELECT * FROM sales_salary_computations WHERE month = ? AND year = ? ORDER BY company, employee_code').all(month, year)
    .map((r) => { const x = { ...r }; delete x.computed_at; delete x.sunday_rule_trace; return x; });
  const before = snap();
  const ledgerBefore = db.prepare("SELECT * FROM loan_deductions WHERE payroll = 'sales' AND month = ? AND year = ? ORDER BY id").all(month, year)
    .map((r) => { const x = { ...r }; delete x.run_id; delete x.updated_at; return x; });
  await compute(month, year, IND);
  await compute(month, year, ALI);
  check(JSON.stringify(snap()) === JSON.stringify(before), `${month}/${year}: second compute changed salary rows`);
  const ledgerAfter = db.prepare("SELECT * FROM loan_deductions WHERE payroll = 'sales' AND month = ? AND year = ? ORDER BY id").all(month, year)
    .map((r) => { const x = { ...r }; delete x.run_id; delete x.updated_at; return x; });
  check(JSON.stringify(ledgerAfter) === JSON.stringify(ledgerBefore), `${month}/${year}: second compute changed the loan ledger`);
}

function salesRows() {
  return db.prepare('SELECT * FROM sales_salary_computations ORDER BY year, month, company, employee_code').all()
    .map((r) => {
      const x = { ...r };
      delete x.id; delete x.computed_at;
      // the trace carries its own compute timestamp
      try { const t = JSON.parse(x.sunday_rule_trace); delete t.computedAt; x.sunday_rule_trace = JSON.stringify(t); } catch { /* keep */ }
      return x;
    });
}

// ════════════════════════════════════════════════════════════════════════════
async function dumpMode() {
  await runMonth(9, 2026);
  const rows = salesRows();
  fs.writeFileSync(DUMP, `${JSON.stringify(rows, null, 1)}\n`);
  const neg = rows.filter((r) => r.net_salary < 0).length;
  console.log(`[sales-sim --dump] ${rows.length} sales salary rows written to ${DUMP} (${rows.filter((r) => r.status === 'hold').length} on hold, ${neg} with negative net)`);
}

// ════════════════════════════════════════════════════════════════════════════
async function fullMode() {
  const L = require('../src/services/loans');
  const C = require('../src/services/loans/close');
  const HR = { username: 'hr1', role: 'hr' };
  const ADMIN = { username: 'boss', role: 'admin' };
  const FIN = { username: 'fin1', role: 'finance' };
  const at = (y, m, d) => new Date(Date.UTC(y, m - 1, d, 0, 45, 0));   // 06:15 IST
  const key = (d) => d.toISOString().slice(0, 10);
  const plantBefore = ['salary_computations', 'day_calculations', 'attendance_processed', 'employees']
    .map((t) => `${t}:${db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n}`).join(',');

  const loan = {};
  function salesLoan(role, code, company, principal, tenure, disbursedOn) {
    const asOf = disbursedOn;
    const r = L.requestLoan(db, { borrowerType: 'sales', employeeCode: code, company, loanType: 'Personal', principal, tenure, reason: 'sim' }, HR, { asOf });
    if (!r.ok) throw new Error(`${role}: request ${r.code} ${r.message}`);
    if (!L.approveLoan(db, r.loanId, ADMIN, { asOf }).ok) throw new Error(`${role}: approve`);
    const d = L.disburseLoan(db, r.loanId, FIN, { mode: 'NEFT', reference: `UTR-${role}`, disbursedOn, agreementFilePath: `AGR/${role}` }, { asOf });
    if (!d.ok) throw new Error(`${role}: disburse ${d.code} ${d.message}`);
    loan[role] = { id: r.loanId, code, company, first: d.firstEmiMonth };
  }
  if (!EMPTY) {
    salesLoan('A', ROLE.A, IND, 12000, 3, '2026-10-05');
    salesLoan('B', ROLE.B, IND, 12000, 3, '2026-10-05');
    salesLoan('C', ROLE.C, IND, 9000, 3, '2026-10-05');
    salesLoan('D', ROLE.D, IND, 9000, 3, '2026-10-05');
    salesLoan('E', ROLE.E, IND, 12000, 3, '2026-10-05');
    salesLoan('F', ROLE.F, ALI, 6000, 3, '2026-10-05');
    salesLoan('G', ROLE.G, IND, 6000, 3, '2026-10-28');
    check(loan.G.first.month === 12 && loan.G.first.year === 2026, `G: first EMI should be Dec 2026 (Q3), got ${JSON.stringify(loan.G.first)}`);
    check(loan.A.first.month === 11, 'A: first EMI should be Nov 2026');
  }
  const borrowers = new Set(Object.values(loan).map((l) => `${l.code}|${l.company}`));

  const computeDays = { '2026-12-05': [11, 2026], '2027-01-05': [12, 2026], '2027-02-05': [1, 2027], '2027-03-05': [2, 2027], '2027-04-05': [3, 2027] };
  const computed = [];
  let dReleaseRefused = false;
  let dReleased = false;
  let k31 = null;

  for (let t = at(2026, 11, 1); t <= at(2027, 4, 20); t = new Date(t.getTime() + 86400000)) {
    const day = key(t);
    if (computeDays[day]) {
      const [m, y] = computeDays[day];
      await runMonth(m, y, {
        edits: async () => {
          if (m === 11) {
            // B: HR enters ₹12,000 of other deductions in Nov → the loan re-plans to the room left (K30).
            // Done in the no-loan run too, so the two runs differ only by the loans.
            const r = await put(rowOf(ROLE.B, 11, 2026).id, { other_deductions: 12000 });
            if (!EMPTY) check(r.status === 200 && r.body.data.loan_recovery === 3000, `B: K30 edit should leave ₹3,000 (got ${r.status} ${r.body && r.body.data && r.body.data.loan_recovery})`);
          }
        },
        holds: async () => {
          if (m === 11) {
            for (const code of [ROLE.C, ROLE.D]) await status(rowOf(code, 11, 2026).id, 'hold');
          }
        },
      });
      computed.push([m, y]);
    }
    // Mark Left E on 27 Dec (leaving date 27 Dec → final payroll = the Jan 2027 cycle).
    if (day === '2026-12-27') {
      const r = await api.request('PUT', `/api/sales/employees/${ROLE.E}/mark-left?company=${encodeURIComponent(IND)}`, { as: 'hr1', body: { dol: '2026-12-27', reason: 'resigned' } });
      check(r.status === 200, `E: mark-left ${r.status}`);
      if (!EMPTY) {
        check(r.body.loans.length === 1 && r.body.loans[0].finalMonth && r.body.loans[0].finalMonth.month === 1 && r.body.loans[0].finalMonth.year === 2027,
          `E: final payroll should be Jan 2027 (Q4): ${JSON.stringify(r.body.loans)}`);
      }
      left.set(`${ROLE.E}|${IND}`, 2027 * 12 + 1);
    }
    // C's Nov hold is released on 20 Dec.
    if (day === '2026-12-20') await status(rowOf(ROLE.C, 11, 2026).id, 'computed');

    quiet();
    let job;
    try { job = C.runDailyLoanJobs(db, { now: t }); } finally { loud(); }
    if (job.errors.length) check(false, `${day}: daily job errors ${job.errors.join('; ')}`);

    // D: once the sweep has moved the held Nov instalment, release is refused until the month is recomputed.
    if (!EMPTY && !dReleased && job.sweep && job.sweep.movedRows && job.sweep.movedRows.some((x) => x.loanId === loan.D.id)) {
      const r1 = await status(rowOf(ROLE.D, 11, 2026).id, 'computed');
      dReleaseRefused = r1.status === 409 && r1.body.code === 'LOAN_ROW_STALE';
      await compute(11, 2026, IND);
      const r2 = await status(rowOf(ROLE.D, 11, 2026).id, 'computed');
      dReleased = r2.status === 200;
    }
    // E: the Jan close leaves an exit residual → finance takes a cash receipt on 20 Feb.
    if (!EMPTY && day === '2027-02-20') {
      const l = L.getLoan(db, loan.E.id);
      check(l.status === 'recover_at_exit' && l.remaining_balance > 0, `E: should still owe an exit residual on 20 Feb (${l.status} ₹${l.remaining_balance})`);
      const rec = L.recordReceipt(db, loan.E.id, FIN, { amount: l.remaining_balance, mode: 'Cash', reference: 'CASH-E', receiptDate: day }, { asOf: day });
      check(rec.ok, `E: receipt ${rec.code} ${rec.message}`);
    }
    // K31: after the Nov close, A's posted Nov row cannot go to Hold.
    if (!EMPTY && day === '2026-12-14' && !k31) {
      const r = await status(rowOf(ROLE.A, 11, 2026).id, 'hold');
      k31 = r.status === 409 && r.body.code === 'LOAN_POSTED_NO_HOLD';
    }

    // ── daily checks ──────────────────────────────────────────────────────
    for (const l of Object.values(loan)) {
      const rec = L.reconcileLoan(db, l.id);
      if (!rec.ok) check(false, `${day}: loan ${l.id} does not reconcile: ${JSON.stringify(rec.problems)}`);
    }
    for (const [m, y] of computed) {
      const c = C.checkPayslipLedger(db, { payroll: 'sales', month: m, year: y });
      if (!c.ok) check(false, `${day}: sales ${m}/${y} payslip ≠ ledger ${JSON.stringify(c.mismatches)}`);
    }
  }

  // ── end-state checks ─────────────────────────────────────────────────────
  const drift = db.prepare(`SELECT COUNT(*) AS n FROM sales_salary_computations
    WHERE ABS(net_salary - (gross_earned + COALESCE(diwali_bonus,0) + COALESCE(incentive_amount,0) - total_deductions)) > 1`).get().n;
  const short = db.prepare(`SELECT COUNT(*) AS n FROM sales_salary_computations
    WHERE ABS(total_deductions - (COALESCE(pf_employee,0) + COALESCE(esi_employee,0) + COALESCE(professional_tax,0) + COALESCE(tds,0)
          + COALESCE(advance_recovery,0) + COALESCE(loan_recovery,0) + COALESCE(other_deductions,0))) > 0.005`).get().n;
  check(drift === 0, `sales drift rows: ${drift}`);
  check(short === 0, `sales component-short rows: ${short}`);
  const plantAfter = ['salary_computations', 'day_calculations', 'attendance_processed', 'employees']
    .map((t) => `${t}:${db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n}`).join(',');
  check(plantAfter === plantBefore, `plant tables changed: ${plantBefore} → ${plantAfter}`);
  const negatives = db.prepare('SELECT COUNT(*) AS n FROM sales_salary_computations WHERE net_salary < 0').get().n;
  check(negatives === computed.length, `the no-loan negative-net row should stay negative every month (Q1): ${negatives}`);

  const closes = db.prepare("SELECT month, year, posted_count, posted_amount, held_count, shortfall_count, no_salary_count, reconciliation_ok FROM loan_closes WHERE payroll = 'sales' ORDER BY year, month").all();
  const summary = {};
  if (EMPTY) {
    check(closes.length === 0, `--empty: ${closes.length} sales loan close rows written`);
    for (const t of ['loans', 'loan_instalments', 'loan_deductions', 'loan_events', 'loan_adjustments', 'loan_receipts']) {
      const n = db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;
      check(n === 0, `--empty: ${t} has ${n} rows`);
    }
    check(db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE type LIKE 'LOAN_%'").get().n === 0, '--empty: loan notifications written');
  } else {
    const st = (r) => L.getLoan(db, loan[r].id);
    const ins = (r) => db.prepare('SELECT due_month, due_year, amount_due, status, origin, posted_amount FROM loan_instalments WHERE loan_id = ? ORDER BY sequence').all(loan[r].id);
    for (const r of Object.keys(loan)) summary[r] = { status: st(r).status, balance: st(r).remaining_balance, instalments: ins(r).map((i) => `${i.due_month}/${i.due_year} ${i.status}${i.origin !== 'schedule' ? `(${i.origin})` : ''} ₹${i.posted_amount ?? i.amount_due}`) };
    check(st('A').status === 'completed', `A: ${st('A').status}`);
    check(st('B').status === 'completed' && ins('B').some((i) => i.origin === 'shortfall'), `B: ${JSON.stringify(summary.B)}`);
    check(st('C').status === 'completed', `C: ${JSON.stringify(summary.C)}`);
    check(dReleaseRefused, 'D: release should be refused (409 LOAN_ROW_STALE) before the recompute');
    check(dReleased, 'D: release should succeed after the recompute');
    check(ins('D').some((i) => i.origin === 'held'), `D: the held Nov instalment should have moved to the end: ${JSON.stringify(summary.D)}`);
    check(st('E').status === 'settled_at_exit' && st('E').remaining_balance === 0, `E: ${JSON.stringify(summary.E)}`);
    check(st('F').status === 'completed', `F: ${JSON.stringify(summary.F)}`);
    const indF = db.prepare('SELECT COALESCE(SUM(loan_recovery), 0) AS v FROM sales_salary_computations WHERE employee_code = ? AND company = ?').get(ROLE.F, IND).v;
    check(indF === 0, `F: the Indriyan person sharing the code must carry no loan (got ₹${indF})`);
    check(st('G').status === 'completed' && ins('G')[0].due_month === 12, `G: ${JSON.stringify(summary.G)}`);
    check(k31 === true, 'K31: holding a row with a posted loan should be refused with 409 LOAN_POSTED_NO_HOLD');
    check(closes.length >= 4 && closes.every((c) => c.reconciliation_ok === 1), `sales closes: ${JSON.stringify(closes)}`);
  }

  // Non-borrower rows identical to the same calendar with no loans (child process).
  if (ROWS_OUT) fs.writeFileSync(ROWS_OUT, JSON.stringify(salesRows()));
  if (!EMPTY) {
    const tmp = path.join(require('os').tmpdir(), `sales-sim-noloans-${process.pid}.json`);
    execFileSync(process.execPath, [__filename, '--empty', '--rows-out', tmp], { stdio: 'ignore' });
    const base = new Map(JSON.parse(fs.readFileSync(tmp, 'utf8')).map((r) => [`${r.employee_code}|${r.company}|${r.month}|${r.year}`, r]));
    fs.rmSync(tmp, { force: true });
    let same = 0; let diffNon = 0; let diffBorrowerOther = 0;
    const LOAN_COLS = new Set(['loan_recovery', 'total_deductions', 'net_salary', 'status']);
    for (const r of salesRows()) {
      const b = base.get(`${r.employee_code}|${r.company}|${r.month}|${r.year}`);
      if (!b) { check(false, `row ${r.employee_code} ${r.month}/${r.year} missing from the no-loan run`); continue; }
      if (borrowers.has(`${r.employee_code}|${r.company}`)) {
        const extra = Object.keys(r).filter((k) => !LOAN_COLS.has(k) && JSON.stringify(r[k]) !== JSON.stringify(b[k]));
        if (extra.length) { diffBorrowerOther += 1; check(false, `borrower ${r.employee_code} ${r.month}/${r.year} differs outside the loan columns: ${extra.join(',')}`); }
      } else if (JSON.stringify(r) === JSON.stringify(b)) same += 1;
      else { diffNon += 1; check(false, `non-borrower ${r.employee_code} ${r.company} ${r.month}/${r.year} differs from the no-loan run`); }
    }
    summary.nonBorrowerRowsIdentical = same;
    summary.nonBorrowerRowsDifferent = diffNon;
    summary.borrowerRowsDifferingOutsideLoanColumns = diffBorrowerOther;
  }

  const rows = db.prepare('SELECT COUNT(*) AS n FROM sales_salary_computations').get().n;
  console.log(`[sales-sim${EMPTY ? ' --empty' : ''}] ${computed.length} sales months, ${rows} salary rows; drift ${drift}; component-short ${short}; sales closes ${closes.length}`);
  if (!EMPTY) {
    for (const c of closes) console.log(`  close ${c.month}/${c.year}: posted ${c.posted_count} (₹${c.posted_amount}), held ${c.held_count}, shortfall ${c.shortfall_count}, no salary ${c.no_salary_count}, recon ${c.reconciliation_ok}`);
    for (const [r, s] of Object.entries(summary)) console.log(`  ${r}: ${typeof s === 'object' ? `${s.status} ₹${s.balance} | ${s.instalments.join(' · ')}` : s}`);
  }
}

(async () => {
  try {
    if (DUMP) await dumpMode();
    else await fullMode();
  } catch (e) {
    loud();
    failures.push(`exception: ${e.stack || e.message}`);
  }
  await api.close();
  if (failures.length) {
    console.error(`FAIL (${failures.length})`);
    for (const f of failures.slice(0, 40)) console.error(`  - ${f}`);
    process.exit(1);
  }
  if (!DUMP) console.log('PASS');
  process.exit(0);
})();
