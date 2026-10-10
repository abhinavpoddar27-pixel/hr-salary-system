/**
 * Statutory flags PR-2b — sales LWF (R7): ₹5 employee / ₹20 employer per month
 * when the in-force sales structure (the row getLatestStructure picks, fallback
 * included) has lwf_applicable = 1 AND gross_earned > 0. Held rows are charged.
 * LWF(EE) is inside total_deductions and in BOTH sales loan salary objects (compute
 * + HR edit), so the loan stays the last deduction inside the 50% cap. Identity:
 * net = gross_earned + diwali_bonus + incentive_amount − total_deductions.
 * Nothing changes for anyone whose in-force sales structure has lwf_applicable = 0.
 *
 * IMPL_PR2 never defined Q1–Q6 / O2 / O4 (E1); IMPL_PR2b TESTS defines them.
 * Synthetic data only; real initSchema, real computeSalesEmployee /
 * saveSalesSalaryComputation, real loan engine, real statutory upload, and the
 * real sales routes over HTTP with real JWTs.
 */
const fs = require('fs');
const path = require('path');
const S = require('./helpers/statutoryFixture');
const SL = require('./helpers/salesLoanFixture');
const H = require('../services/loans/headroom');
const { computeSalesEmployee } = require('../services/salesSalaryComputation');
const { deriveCycle } = require('../services/cycleUtil');
const { startJwtApi } = require('./helpers/jwtApiHarness');

const CO = S.COMPANY; // = SL.IND
/** The 7 sales deduction components that existed before PR-2b (V13 minus LWF). */
const SEVEN = ['pf_employee', 'esi_employee', 'professional_tax', 'tds', 'advance_recovery', 'loan_recovery', 'other_deductions'];
const sumOf = (r, cols) => Math.round(cols.reduce((s, c) => s + (r[c] || 0), 0) * 100) / 100;
const identityNet = (r) => (r.gross_earned || 0) + (r.diwali_bonus || 0) + (r.incentive_amount || 0) - (r.total_deductions || 0);
const salesRow = (db, code, month, year, company = CO) => db.prepare(
  'SELECT * FROM sales_salary_computations WHERE employee_code = ? AND month = ? AND year = ? AND company = ?',
).get(code, month, year, company);
const setPolicy = (db, k, v) => db.prepare('UPDATE policy_config SET value = ? WHERE key = ?').run(v, k);

/** Sales rep + one structure dated 2026-01 (basic 50% / hra 20% / cca 10% / conveyance 20%). */
function rep(db, { code, lwf = 0, pf = 0, esi = 0, gross = 18000 } = {}) {
  const e = S.salesEmp(db, { code, gross_salary: gross });
  S.salesStructure(db, e, '2026-01', { gross_salary: gross, lwf, pf, esi });
  return e;
}

describe('Q1 — flag on: 5 / 20 inside total_deductions', () => {
  test('LWF only → 5 / 20; total = 7 components + 5; identity holds', () => {
    const db = S.newDb();
    const a = rep(db, { lwf: 1 });
    const r = S.computeSales(db, a, 10, 2026, 24);
    expect(r.gross_earned).toBeGreaterThan(0);
    expect([r.lwf_employee, r.lwf_employer]).toEqual([5, 20]);
    expect(r.total_deductions).toBe(5);
    expect(r.total_deductions).toBeCloseTo(sumOf(r, SEVEN) + 5, 2);
    expect(r.net_salary).toBeCloseTo(identityNet(r), 2);
    expect(r.net_salary).toBeCloseTo(r.gross_earned - 5, 2);
    db.close();
  });

  test('PF + ESI rep → PF, ESI and LWF all in the total; employer LWF never in the employee total', () => {
    const db = S.newDb();
    const b = rep(db, { lwf: 1, pf: 1, esi: 1 });
    const r = S.computeSales(db, b, 10, 2026, 24);
    expect(r.pf_employee).toBeGreaterThan(0);
    expect(r.esi_employee).toBeGreaterThan(0);
    expect([r.lwf_employee, r.lwf_employer]).toEqual([5, 20]);
    expect(r.total_deductions).toBeCloseTo(sumOf(r, SEVEN) + 5, 2);
    expect(r.net_salary).toBeCloseTo(identityNet(r), 2);
    expect(r.net_salary).toBeCloseTo(r.gross_earned - sumOf(r, SEVEN) - 5, 2);
    db.close();
  });
});

describe('Q2 — no LWF without the flag or without earned gross; held rows charged', () => {
  test('flag off → 0 / 0 and total = the 7 components', () => {
    const db = S.newDb();
    const e = rep(db, { lwf: 0, pf: 1, esi: 1 });
    const r = S.computeSales(db, e, 10, 2026, 24);
    expect([r.lwf_employee, r.lwf_employer]).toEqual([0, 0]);
    expect(r.total_deductions).toBeCloseTo(sumOf(r, SEVEN), 2);
    expect(r.net_salary).toBeCloseTo(identityNet(r), 2);
    db.close();
  });

  test('flag on, 0 days given, no holiday → row saved, gross_earned 0, 0 / 0', () => {
    const db = S.newDb();
    const e = rep(db, { lwf: 1 });
    const r = S.computeSales(db, e, 10, 2026, 0);
    expect(r).toBeTruthy();
    expect(r.gross_earned).toBe(0);
    expect([r.lwf_employee, r.lwf_employer]).toEqual([0, 0]);
    expect(r.total_deductions).toBe(0);
    expect(r.net_salary).toBe(0);
    db.close();
  });

  test('a row on hold, recomputed → still hold (reason kept), charged 5 / 20', () => {
    const db = S.newDb();
    const e = rep(db, { lwf: 1 });
    S.computeSales(db, e, 10, 2026, 24);
    db.prepare("UPDATE sales_salary_computations SET status = 'hold', hold_reason = 'synthetic hold' WHERE employee_code = ?").run(e.code);
    const r = S.computeSales(db, e, 10, 2026, 24);
    expect([r.status, r.hold_reason]).toEqual(['hold', 'synthetic hold']);
    expect([r.lwf_employee, r.lwf_employer]).toEqual([5, 20]);
    expect(r.total_deductions).toBe(5);
    db.close();
  });

  test('flag on, zero-gross structure → excluded (no row, no LWF)', () => {
    const db = S.newDb();
    const e = rep(db, { lwf: 1, gross: 0 });
    const cy = deriveCycle(10, 2026);
    const emp = db.prepare('SELECT * FROM sales_employees WHERE id = ?').get(e.id);
    const c = S.silently(() => computeSalesEmployee(db, {
      salesEmployee: emp, monthlyInputRow: { sheet_days_given: 24 }, cycleStart: cy.start, cycleEnd: cy.end,
      month: 10, year: 2026, company: CO, requestId: 'q2', user: 'test',
    }));
    expect(c).toMatchObject({ success: false, excluded: true, reason: 'zero_gross_in_structure' });
    expect(salesRow(db, e.code, 10, 2026)).toBeUndefined();
    db.close();
  });
});

describe('C5 / N5 pin — a tiny-gross flagged row with no loan can go negative by LWF (current behaviour)', () => {
  test('0 days given + one gazetted holiday → gross_earned > 0 (R7 literal) → LWF 5; no ₹0 floor without a loan', () => {
    const db = S.newDb();
    const e = rep(db, { lwf: 1, gross: 120 });
    db.prepare("INSERT INTO sales_holidays (holiday_date, holiday_name, company, is_gazetted) VALUES ('2026-10-02', 'SYNTH HOLIDAY', ?, 1)").run(CO);
    const r = S.computeSales(db, e, 10, 2026, 0);
    expect(r.gazetted_holidays_paid).toBe(1);
    expect(r.gross_earned).toBeGreaterThan(0);
    expect(r.gross_earned).toBeLessThan(5);
    expect([r.lwf_employee, r.lwf_employer, r.loan_recovery]).toEqual([5, 20, 0]);
    expect(r.total_deductions).toBe(5);
    expect(r.net_salary).toBeLessThan(0); // pinned: PR-8 Q1 floors only rows that carry a loan
    expect(r.net_salary).toBeCloseTo(r.gross_earned - 5, 2);
    expect(r.net_salary).toBeCloseTo(identityNet(r), 2); // V8 identity still holds
    db.close();
  });
});

describe('Q3 — amounts come from policy_config (same results as plant P5)', () => {
  test.each([
    ['0', '0', 0, 0],
    ['7.5', '22.5', 7.5, 22.5],
    ['abc', 'xyz', 5, 20],
    ['-3', '', 5, 20],
  ])('employee %p / employer %p → %p / %p', (ee, er, wantEe, wantEr) => {
    const db = S.newDb();
    setPolicy(db, 'lwf_employee_amount', ee);
    setPolicy(db, 'lwf_employer_amount', er);
    const e = rep(db, { lwf: 1 });
    const r = S.computeSales(db, e, 10, 2026, 24);
    expect([r.lwf_employee, r.lwf_employer]).toEqual([wantEe, wantEr]);
    expect(r.total_deductions).toBe(wantEe);
    expect(r.net_salary).toBeCloseTo(identityNet(r), 2);
    db.close();
  });

  test('keys deleted → 5 / 20', () => {
    const db = S.newDb();
    db.prepare("DELETE FROM policy_config WHERE key IN ('lwf_employee_amount','lwf_employer_amount')").run();
    const e = rep(db, { lwf: 1 });
    const r = S.computeSales(db, e, 10, 2026, 24);
    expect([r.lwf_employee, r.lwf_employer]).toEqual([5, 20]);
    db.close();
  });
});

/** INSERT columns / placeholders / params / SET assignments of saveSalesSalaryComputation's UPSERT. */
function salesUpsertCounts() {
  const src = fs.readFileSync(path.join(__dirname, '../services/salesSalaryComputation.js'), 'utf8');
  const body = src.slice(src.indexOf('function saveSalesSalaryComputation('));
  const ins = body.indexOf('INSERT INTO sales_salary_computations');
  const open = body.indexOf('(', ins);
  const values = body.indexOf(') VALUES (', open);
  const cols = body.slice(open + 1, values).split(',').map((s) => s.trim()).filter(Boolean);
  const phEnd = body.indexOf(')', values + 10);
  const placeholders = (body.slice(values + 10, phEnd).match(/\?/g) || []).length;
  const setStart = body.indexOf('DO UPDATE SET', phEnd);
  const setEnd = body.indexOf('`)', setStart);
  const sets = body.slice(setStart + 'DO UPDATE SET'.length, setEnd).split(',').map((s) => s.trim()).filter((s) => /^\w+\s*=/.test(s));
  let depth = 0; let cur = ''; const params = [];
  for (let i = body.indexOf('.run(', setEnd) + 5; i < body.length; i++) {
    const ch = body[i];
    if ('([{'.includes(ch)) depth++;
    if (')]}'.includes(ch)) { if (depth === 0) break; depth--; }
    if (ch === ',' && depth === 0) { params.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) params.push(cur.trim());
  return { cols, placeholders, params: params.filter(Boolean), sets };
}

describe('Q4 — recompute, UPSERT round trip, carried fields, unflagged control', () => {
  test('two computes → byte-identical rows (volatile columns stripped)', () => {
    const db = S.newDb();
    const a = rep(db, { lwf: 1, pf: 1, esi: 1 });
    const b = rep(db, { lwf: 0 });
    const first = [S.computeSales(db, a, 10, 2026, 24), S.computeSales(db, b, 10, 2026, 24)];
    const second = [S.computeSales(db, a, 10, 2026, 24), S.computeSales(db, b, 10, 2026, 24)];
    expect(second).toEqual(first);
    expect(first[0].lwf_employee).toBe(5);
    db.close();
  });

  test('flag on → 5 / 20; flag switched off + recompute → same row id, 0 / 0 (ON CONFLICT overwrites)', () => {
    const db = S.newDb();
    const e = rep(db, { lwf: 1 });
    S.computeSales(db, e, 10, 2026, 24);
    const on = salesRow(db, e.code, 10, 2026);
    expect(on).toMatchObject({ lwf_employee: 5, lwf_employer: 20, total_deductions: 5 });
    db.prepare('UPDATE sales_salary_structures SET lwf_applicable = 0 WHERE employee_id = ?').run(e.id);
    S.computeSales(db, e, 10, 2026, 24);
    const off = salesRow(db, e.code, 10, 2026);
    expect(off.id).toBe(on.id);
    expect(off).toMatchObject({ lwf_employee: 0, lwf_employer: 0, total_deductions: 0 });
    expect(off.net_salary).toBe(off.gross_earned);
    db.close();
  });

  test('static: INSERT columns 47 = placeholders 47 = params 47; ON CONFLICT SET 44; LWF in all four lists', () => {
    const u = salesUpsertCounts();
    expect(u.cols).toHaveLength(47);
    expect(u.placeholders).toBe(47);
    expect(u.params).toHaveLength(47);
    expect(u.sets).toHaveLength(44);
    expect(u.cols.slice(-2)).toEqual(['lwf_employee', 'lwf_employer']);
    expect(u.sets).toEqual(expect.arrayContaining(['lwf_employee = excluded.lwf_employee', 'lwf_employer = excluded.lwf_employer']));
    expect(u.params[u.cols.indexOf('lwf_employee')]).toBe('comp.lwf_employee || 0');
    expect(u.params[u.cols.indexOf('lwf_employer')]).toBe('comp.lwf_employer || 0');
  });

  test('HR-entered fields, finalized and NEFT stamps survive a recompute; LWF joins the total', () => {
    const db = S.newDb();
    const e = rep(db, { lwf: 1 });
    S.computeSales(db, e, 10, 2026, 24);
    db.prepare(`UPDATE sales_salary_computations SET incentive_amount = 1500, diwali_bonus = 2000, other_deductions = 300,
                hold_reason = 'kept', status = 'finalized', finalized_at = '2026-10-28 10:00:00', finalized_by = 'boss',
                neft_exported_at = '2026-10-29 09:00:00', payslip_generated_at = '2026-10-29 09:05:00' WHERE employee_code = ?`).run(e.code);
    const r = S.computeSales(db, e, 10, 2026, 24);
    expect(r).toMatchObject({
      incentive_amount: 1500, diwali_bonus: 2000, other_deductions: 300, hold_reason: 'kept', status: 'finalized',
      finalized_at: '2026-10-28 10:00:00', finalized_by: 'boss',
      neft_exported_at: '2026-10-29 09:00:00', payslip_generated_at: '2026-10-29 09:05:00',
      lwf_employee: 5, lwf_employer: 20, total_deductions: 305,
    });
    expect(r.net_salary).toBeCloseTo(r.gross_earned + 2000 + 1500 - 305, 2);
    db.close();
  });

  test('control DB: unflagged row identical in every column; flagged differs ONLY in lwf_*, total (+5), net (−5); August untouched', () => {
    const db = S.newDb();
    const a = rep(db, { code: 'QC1', pf: 1, esi: 1 });
    const b = rep(db, { code: 'QC2', pf: 1, esi: 1 });
    const augA = S.computeSales(db, a, 8, 2026, 24);
    const augB = S.computeSales(db, b, 8, 2026, 24);
    expect([augA.lwf_employee, augA.lwf_employer]).toEqual([0, 0]);

    // the owner's T5 upload: LWF Y for QC1 only, effective 2026-09 (PF / ESI stay Y)
    expect(S.applyFile(db, 'sales', S.salesFile(S.srow('QC1', CO, 1, 1, 1))).ok).toBe(true);
    expect(S.computeSales(db, a, 8, 2026, 24)).toEqual(augA); // August re-run byte-identical
    expect(S.computeSales(db, b, 8, 2026, 24)).toEqual(augB);

    const sepA = S.computeSales(db, a, 9, 2026, 24);
    const sepB = S.computeSales(db, b, 9, 2026, 24);
    expect([sepA.lwf_employee, sepA.lwf_employer]).toEqual([5, 20]);
    expect([sepB.lwf_employee, sepB.lwf_employer]).toEqual([0, 0]);

    const ctl = S.newDb();
    const a2 = rep(ctl, { code: 'QC1', pf: 1, esi: 1 });
    const b2 = rep(ctl, { code: 'QC2', pf: 1, esi: 1 });
    for (const m of [8, 9]) { S.computeSales(ctl, a2, m, 2026, 24); S.computeSales(ctl, b2, m, 2026, 24); }
    const ctlA = S.strip(salesRow(ctl, 'QC1', 9, 2026));
    const ctlB = S.strip(salesRow(ctl, 'QC2', 9, 2026));
    expect(sepB).toEqual(ctlB);
    const changed = Object.keys(sepA).filter((k) => sepA[k] !== ctlA[k]).sort();
    expect(changed).toEqual(['lwf_employee', 'lwf_employer', 'net_salary', 'total_deductions']);
    expect(sepA.total_deductions).toBeCloseTo(ctlA.total_deductions + 5, 2);
    expect(sepA.net_salary).toBeCloseTo(ctlA.net_salary - 5, 2);
    ctl.close();
    db.close();
  });
});

// ── One real-JWT HTTP API for every route test in this file (getDb() is a per-module
// singleton, so a second startJwtApi would get the closed handle). Tests isolate by
// company + month: Q4 route = Indriyan Oct 2026, Q6 = Asian Lakto Nov 2026,
// O2 / O4 = Indriyan Dec 2026.
let api;
beforeAll(() => {
  api = startJwtApi({ '/api/sales': '../../routes/sales', '/api/loans': '../../routes/loans' },
    { users: [{ username: 'hr1', role: 'hr' }, { username: 'fin1', role: 'finance' }] });
});
afterAll(() => api.close());

async function compute(month, year, company = CO) {
  const { log, warn, error } = console;
  console.log = () => {}; console.warn = () => {}; console.error = () => {};
  try {
    const r = await api.request('POST', '/api/sales/compute', { as: 'hr1', body: { month, year, company } });
    if (r.status !== 200) throw new Error(`compute ${r.status} ${r.text}`);
    return r.body.data;
  } finally { console.log = log; console.warn = warn; console.error = error; }
}

describe('Q4 route — POST /api/sales/compute over a paid + NEFT-exported row', () => {
  test('not blocked: status + stamps kept, net −5, finalizedRecomputeWarnings delta −5', async () => {
    const db = api.db;
    const e = SL.addRep(db, { code: 'QP1' }); // ₹20,000, basic = gross, no PF / ESI
    SL.setUpload(db, { month: 10, year: 2026, rows: [{ code: 'QP1', days: 30 }] });
    await compute(10, 2026);
    db.prepare(`UPDATE sales_salary_computations SET status = 'paid', finalized_at = '2026-10-27 10:00:00', finalized_by = 'boss',
                neft_exported_at = '2026-10-28 09:00:00' WHERE employee_code = 'QP1'`).run();
    const before = S.strip(salesRow(db, 'QP1', 10, 2026));
    expect([before.lwf_employee, before.net_salary]).toEqual([0, 20000]);

    db.prepare('UPDATE sales_salary_structures SET lwf_applicable = 1 WHERE employee_id = ?').run(e.id);
    const out = await compute(10, 2026);
    expect(out.finalizedRecomputeWarnings).toEqual([{
      employee_code: 'QP1', prev_status: 'paid', prev_net_salary: 20000, new_net_salary: 19995, delta: -5,
    }]);
    const after = S.strip(salesRow(db, 'QP1', 10, 2026));
    expect(after).toMatchObject({
      status: 'paid', finalized_at: '2026-10-27 10:00:00', finalized_by: 'boss', neft_exported_at: '2026-10-28 09:00:00',
      lwf_employee: 5, lwf_employer: 20, total_deductions: 5, net_salary: 19995,
    });
    const changed = Object.keys(after).filter((k) => after[k] !== before[k]).sort();
    expect(changed).toEqual(['lwf_employee', 'lwf_employer', 'net_salary', 'total_deductions']);
    expect(db.prepare(SL.SALES_DRIFT_SQL).get().n).toBe(0);
    expect(db.prepare(SL.SALES_SHORT_SQL).get().n).toBe(0);
  });
});

describe('Q5 — LWF counts in the sales loan headroom (loan stays last)', () => {
  function loanCase(lwf) {
    const db = S.newDb();
    const e = SL.addRep(db, { code: 'LQ1' }); // ₹20,000, cap ₹10,000
    db.prepare('UPDATE sales_salary_structures SET lwf_applicable = ? WHERE employee_id = ?').run(lwf, e.id);
    const loanId = SL.salesLoan(db, { code: 'LQ1' }); // ₹10,000 / 3 disbursed 5 Oct → ₹3,334 in Nov
    SL.setUpload(db, { month: 11, year: 2026, rows: [{ code: 'LQ1', days: 31 }] });
    SL.computeSalesMonth(db, { month: 11, year: 2026, runId: 'q5-1' });
    // other deductions ₹8,000 so the cap binds
    db.prepare("UPDATE sales_salary_computations SET other_deductions = 8000 WHERE employee_code = 'LQ1' AND month = 11 AND year = 2026").run();
    SL.computeSalesMonth(db, { month: 11, year: 2026, runId: 'q5-2' });
    const row = SL.salaryRow(db, 'LQ1', 11, 2026);
    const led = db.prepare("SELECT * FROM loan_deductions WHERE loan_id = ? AND month = 11 AND year = 2026 AND payroll = 'sales'").all(loanId);
    const reconciled = SL.L.reconcileLoan(db, loanId);
    const drift = db.prepare(SL.SALES_DRIFT_SQL).get().n;
    const short = db.prepare(SL.SALES_SHORT_SQL).get().n;
    db.close();
    return { row, led, reconciled, drift, short };
  }

  test('cap binds → the loan is exactly ₹5 less with LWF; ledger = loan; reconcile ok; drift + component 0', () => {
    const off = loanCase(0);
    const on = loanCase(1);
    expect(off.row).toMatchObject({ gross_earned: 20000, lwf_employee: 0, loan_recovery: 2000, total_deductions: 10000, net_salary: 10000 });
    expect(on.row).toMatchObject({ gross_earned: 20000, lwf_employee: 5, lwf_employer: 20, loan_recovery: 1995, total_deductions: 10000, net_salary: 10000 });
    expect(on.row.loan_recovery).toBeCloseTo(off.row.loan_recovery - 5, 2);
    for (const r of [off, on]) {
      expect(r.led).toEqual([expect.objectContaining({ state: 'provisional', amount: r.row.loan_recovery })]);
      expect(r.reconciled.ok).toBe(true);
      expect([r.drift, r.short]).toEqual([0, 0]);
    }
  });

  test('unit: priorDeductions({ lwf_employee: 5 }, "sales") = 500 paise', () => {
    expect(H.priorDeductions({ lwf_employee: 5 }, 'sales')).toBe(500);
    expect(H.PRIOR_DEDUCTION_COMPONENTS.sales).toContain('lwf_employee');
  });
});

describe('M1 pin — the plant auto-create cannot meet a flagged master (N8; salaryComputation.js untouched)', () => {
  test('upload row for a no-structure employee → row error, master lwf 0; Stage 7 auto-create → structure lwf 0, LWF 0 / 0', () => {
    const db = S.newDb();
    const e = S.plant(db, { gross_salary: 15000 }); // insert trigger zeroes the flags; no structure row
    expect(S.plantRows(db, e)).toHaveLength(0);
    const SF = require('../services/statutoryFlags');
    const buf = S.plantFile(S.prow(e.code, 0, 0, 1));
    const p = SF.planFlagChanges(db, { scope: 'plant', effectiveMonth: '2026-09', rows: SF.parseFlagFile(buf, 'plant').rows });
    expect(p.rows[0].error).toMatch(/No salary structure/);
    const up = S.applyFile(db, 'plant', buf);
    expect(up.ok).toBe(true);
    expect(up.summary.counts.employees).toBe(0);
    expect(S.master(db, e).lwf_applicable).toBe(0);

    S.plantMonth(db, e, 9, 2026);
    const r = S.computePlant(db, e, 9, 2026); // auto-creates the 2025-01-01 structure from the master
    const rows = S.plantRows(db, e);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ effective_from: '2025-01-01', lwf_applicable: 0 });
    expect([r.lwf_employee, r.lwf_employer]).toEqual([0, 0]);
    db.close();
  });
});

describe('Q6 — HR edit (PUT /api/sales/salary/:id) keeps LWF in the total and in the loan re-plan; register totals', () => {
  let db;
  const ALI = SL.ALI;
  const computeAli = (month, year) => compute(month, year, ALI);
  const put = async (id, body) => {
    const { error } = console; console.error = () => {};
    try { return await api.request('PUT', `/api/sales/salary/${id}`, { as: 'hr1', body }); } finally { console.error = error; }
  };
  const flag = (e) => db.prepare('UPDATE sales_salary_structures SET lwf_applicable = 1 WHERE employee_id = ?').run(e.id);
  const row = (code, month = 11) => SL.salaryRow(db, code, month, 2026, ALI);
  const ded = (loanId) => db.prepare("SELECT * FROM loan_deductions WHERE loan_id = ? AND month = 11 AND year = 2026 AND payroll = 'sales'").get(loanId);
  const clean = (code) => {
    expect(db.prepare(`${SL.SALES_DRIFT_SQL} AND employee_code = ?`).get(code).n).toBe(0);
    expect(db.prepare(`${SL.SALES_SHORT_SQL} AND employee_code = ?`).get(code).n).toBe(0);
  };

  beforeAll(async () => {
    db = api.db;
    const f1 = SL.addRep(db, { code: 'Q6F', company: ALI, pf: 1, esi: 1 }); flag(f1); // flagged, PF + ESI, no loan
    SL.addRep(db, { code: 'Q6U', company: ALI, pf: 1, esi: 1 });                    // unflagged, PF + ESI, no loan
    const f2 = SL.addRep(db, { code: 'Q6L', company: ALI }); flag(f2);              // flagged, with a loan
    SL.addRep(db, { code: 'Q6P', company: ALI });                                   // unflagged, will be paid
    SL.setUpload(db, { month: 11, year: 2026, company: ALI, rows: ['Q6F', 'Q6U', 'Q6L', 'Q6P'].map((code) => ({ code, days: 31 })) });
  });

  test('no-loan flagged row: other 100 → total = PF + ESI + 5 + 100; recompute gives the same row', async () => {
    const loanId = SL.salesLoan(db, { code: 'Q6L', company: ALI });
    await computeAli(11, 2026);
    expect(ded(loanId)).toMatchObject({ amount: 3334, state: 'provisional' });
    const r0 = row('Q6F');
    expect([r0.lwf_employee, r0.lwf_employer]).toEqual([5, 20]);
    const r = await put(r0.id, { other_deductions: 100 });
    expect(r.status).toBe(200);
    const fixed = r0.pf_employee + r0.esi_employee + r0.professional_tax + r0.tds + r0.advance_recovery;
    expect(r.body.data.total_deductions).toBeCloseTo(fixed + 5 + 100, 2);
    expect(r.body.data.net_salary).toBeCloseTo(r0.gross_earned - (fixed + 5 + 100), 2);
    expect(r.body.data.loan_recovery).toBe(0);
    clean('Q6F');
    const edited = S.strip(row('Q6F'));
    await computeAli(11, 2026);
    expect(S.strip(row('Q6F'))).toEqual(edited);
  });

  test('with a loan: other 9000 → loan 995 (LWF ranks above it), total 10000; compute → same row + ledger (K30)', async () => {
    const loanId = db.prepare("SELECT id FROM loans WHERE employee_code = 'Q6L'").get().id;
    const r0 = row('Q6L');
    expect(r0).toMatchObject({ gross_earned: 20000, lwf_employee: 5, loan_recovery: 3334, total_deductions: 3339, net_salary: 16661 });
    const r = await put(r0.id, { other_deductions: 9000 });
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ other_deductions: 9000, lwf_employee: 5, loan_recovery: 995, total_deductions: 10000, net_salary: 10000 });
    expect(ded(loanId)).toMatchObject({ amount: 995, state: 'provisional' });
    clean('Q6L');
    const edited = S.strip(row('Q6L'));
    // the ledger row itself, minus which run last touched it (run_id) and its timestamps
    const ledgerOf = () => { const { run_id: _r, created_at: _c, updated_at: _u, ...rest } = ded(loanId); return rest; };
    const ledger = ledgerOf();
    const events = db.prepare('SELECT COUNT(*) AS n FROM loan_events WHERE loan_id = ?').get(loanId).n;
    await computeAli(11, 2026);
    expect(S.strip(row('Q6L'))).toEqual(edited);
    expect(ledgerOf()).toEqual(ledger);
    expect(db.prepare('SELECT COUNT(*) AS n FROM loan_events WHERE loan_id = ?').get(loanId).n).toBe(events);
    expect(SL.L.reconcileLoan(db, loanId).ok).toBe(true);
  });

  test('unflagged edit = the old formula (no LWF term)', async () => {
    const r0 = row('Q6U');
    expect([r0.lwf_employee, r0.lwf_employer]).toEqual([0, 0]);
    const r = await put(r0.id, { other_deductions: 100 });
    const fixed = r0.pf_employee + r0.esi_employee + r0.professional_tax + r0.tds + r0.advance_recovery;
    expect(r.body.data.total_deductions).toBeCloseTo(fixed + 100, 2);
    expect(r.body.data.net_salary).toBeCloseTo(r0.gross_earned - fixed - 100, 2);
    clean('Q6U');
  });

  test('a paid row cannot be edited → 409 (N3), nothing written', async () => {
    const r0 = row('Q6P');
    db.prepare("UPDATE sales_salary_computations SET status = 'paid', neft_exported_at = '2026-11-28 09:00:00' WHERE id = ?").run(r0.id);
    const before = row('Q6P');
    const r = await put(r0.id, { other_deductions: 100 });
    expect(r.status).toBe(409);
    expect(row('Q6P')).toEqual(before);
  });

  test('GET /salary-register totals carry LWF: 5 × N / 20 × N', async () => {
    const reg = await api.request('GET', `/api/sales/salary-register?month=11&year=2026&company=${encodeURIComponent(ALI)}`, { as: 'hr1' });
    expect(reg.status).toBe(200);
    const n = reg.body.data.rows.filter((x) => x.lwf_employee > 0).length;
    expect(n).toBe(2);
    expect([reg.body.data.totals.lwf_employee, reg.body.data.totals.lwf_employer]).toEqual([5 * n, 20 * n]);
    const sumDed = Math.round(reg.body.data.rows.reduce((s, x) => s + x.total_deductions, 0) * 100) / 100;
    expect(reg.body.data.totals.total_deductions).toBe(sumDed);
  });
});

describe('O2 / O4 — LWF on the sales payslip and in the sales register Excel (39 columns)', () => {
  const XLSX = require('xlsx');
  const http = require('http');
  const { generateSalesPayslipData } = require('../services/salesSalaryComputation');
  const { generateSalesExcel } = require('../services/salesExportFormats');
  const M = 12; const Y = 2026;
  let db;
  const q = `month=${M}&year=${Y}&company=${encodeURIComponent(CO)}`;
  /** Raw bytes over the same JWT API (the harness's request() decodes bodies as text). */
  const rawGet = (url, as = 'hr1') => new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: api.server.address().port, path: url, headers: { Authorization: `Bearer ${api.tokens[as]}` } }, (res) => {
      const chunks = []; res.on('data', (c) => chunks.push(c)); res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
    }).on('error', reject);
  });

  beforeAll(async () => {
    db = api.db;
    const flag = (e) => db.prepare('UPDATE sales_salary_structures SET lwf_applicable = 1 WHERE employee_id = ?').run(e.id);
    flag(SL.addRep(db, { code: 'OF1', pf: 1, esi: 1 }));
    flag(SL.addRep(db, { code: 'OF2', gross: 15000 }));
    SL.addRep(db, { code: 'OU1', pf: 1, esi: 1 });
    SL.setUpload(db, { month: M, year: Y, rows: [{ code: 'OF1', days: 31 }, { code: 'OF2', days: 20 }, { code: 'OU1', days: 31 }] });
    await compute(M, Y);
    db.prepare(`UPDATE sales_salary_computations SET other_deductions = 250 WHERE employee_code = 'OF1' AND month = ? AND year = ?`).run(M, Y);
    await compute(M, Y);
  });

  test('O2 payslip (function + GET /api/sales/payslip/:code): LWF (Employee) 5, lwfEmployer 20, total = Σ lines; unflagged → no line', async () => {
    const fn = generateSalesPayslipData(db, 'OF1', M, Y, CO);
    expect(fn.success).toBe(true);
    expect(fn.deductions).toEqual(expect.arrayContaining([{ label: 'LWF (Employee)', amount: 5 }]));
    expect(fn.lwfEmployer).toBe(20);
    expect(Math.round(fn.deductions.reduce((s, d) => s + d.amount, 0) * 100) / 100).toBe(fn.totalDeductions);
    expect(fn.netSalary).toBeCloseTo(fn.totalEarnings - fn.totalDeductions, 2);

    const r = await api.request('GET', `/api/sales/payslip/OF1?${q}`, { as: 'hr1' });
    expect(r.status).toBe(200);
    expect(r.body.data.deductions).toEqual(fn.deductions);
    expect(r.body.data.lwfEmployer).toBe(20);
    expect(r.body.data.totalDeductions).toBe(fn.totalDeductions);

    const u = await api.request('GET', `/api/sales/payslip/OU1?${q}`, { as: 'hr1' });
    expect(u.status).toBe(200);
    expect(u.body.data.deductions.some((d) => /LWF/.test(d.label))).toBe(false);
    expect(u.body.data.lwfEmployer).toBe(0);
    expect(Math.round(u.body.data.deductions.reduce((s, d) => s + d.amount, 0) * 100) / 100).toBe(u.body.data.totalDeductions);
  });

  test('O4 Excel: header = every row = !cols = 39; "LWF Employee" at index 25; every column aligned with the DB row', async () => {
    const res = await rawGet(`/api/sales/export/salary-register?${q}&download=true`);
    expect(res.status).toBe(200);
    const wb = XLSX.read(res.body, { type: 'buffer', cellStyles: true });
    const ws = wb.Sheets['Sales Salary Register'];
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    const hdr = aoa[0];
    expect(hdr).toHaveLength(39);
    expect(XLSX.utils.decode_range(ws['!ref']).e.c + 1).toBe(39);
    expect(ws['!cols']).toHaveLength(39);
    expect(hdr.indexOf('LWF Employee')).toBe(25);
    expect(hdr.slice(23, 27)).toEqual(['PF Employee', 'ESI Employee', 'LWF Employee', 'PT']);
    expect(aoa.slice(1).every((row) => row.length === 39)).toBe(true);
    expect(aoa).toHaveLength(4); // header + 3 rows

    const COL = {
      Code: 'employee_code', 'Days Given': 'days_given', 'Gross (Earned)': 'gross_earned', 'PF Employee': 'pf_employee',
      'ESI Employee': 'esi_employee', 'LWF Employee': 'lwf_employee', PT: 'professional_tax', TDS: 'tds',
      'Advance Recovery': 'advance_recovery', 'Loan Recovery': 'loan_recovery', 'Other Deductions': 'other_deductions',
      'Total Deductions': 'total_deductions', 'Diwali Bonus': 'diwali_bonus', Incentive: 'incentive_amount',
      'Net Salary': 'net_salary', Status: 'status', 'Account Number': 'account_no', IFSC: 'ifsc',
    };
    for (const row of aoa.slice(1)) {
      const code = row[0];
      const dbRow = db.prepare(`SELECT c.*, e.account_no, e.ifsc FROM sales_salary_computations c
        JOIN sales_employees e ON e.code = c.employee_code AND e.company = c.company
        WHERE c.employee_code = ? AND c.month = ? AND c.year = ? AND c.company = ?`).get(code, M, Y, CO);
      for (const [h, col] of Object.entries(COL)) {
        const v = dbRow[col];
        expect([code, h, row[hdr.indexOf(h)]]).toEqual([code, h, typeof v === 'number' ? Math.round(v * 100) / 100 : v]);
      }
    }
    const of1 = aoa.find((r) => r[0] === 'OF1');
    const ou1 = aoa.find((r) => r[0] === 'OU1');
    expect([of1[25], ou1[25]]).toEqual([5, 0]);
    // function output is the same workbook
    const fnWb = XLSX.read(generateSalesExcel(db, M, Y, CO).content, { type: 'buffer' });
    expect(XLSX.utils.sheet_to_json(fnWb.Sheets['Sales Salary Register'], { header: 1, defval: '' })).toEqual(aoa);
  });

  test('O4 totals: export JSON preview + GET /salary-register → LWF 5 × N / 20 × N', async () => {
    const n = 2;
    const pv = await api.request('GET', `/api/sales/export/salary-register?${q}`, { as: 'hr1' });
    expect(pv.status).toBe(200);
    expect([pv.body.data.totals.lwf_employee, pv.body.data.totals.lwf_employer]).toEqual([5 * n, 20 * n]);
    const reg = await api.request('GET', `/api/sales/salary-register?${q}`, { as: 'hr1' });
    expect([reg.body.data.totals.lwf_employee, reg.body.data.totals.lwf_employer]).toEqual([5 * n, 20 * n]);
    expect(reg.body.data.totals.total_deductions).toBe(pv.body.data.totals.total_deductions);
    expect(db.prepare(`${SL.SALES_DRIFT_SQL} AND month = ? AND year = ?`).get(M, Y).n).toBe(0);
    expect(db.prepare(`${SL.SALES_SHORT_SQL} AND month = ? AND year = ?`).get(M, Y).n).toBe(0);
  });
});
