/**
 * Statutory flags PR-2 STEP 2 — plant Stage 7 LWF (R7): ₹5 employee / ₹20
 * employer per month when the in-force structure has lwf_applicable = 1 AND
 * earned gross > 0. Inside total_deductions (before the cap) and counted in the
 * loan headroom. Nothing changes for anyone whose structure has the flag off.
 *
 * Synthetic data only; real initSchema, real computeEmployeeSalary /
 * saveSalaryComputation / recomputeSalary, real loan engine, real statutory upload.
 */
const fs = require('fs');
const path = require('path');
const S = require('./helpers/statutoryFixture');
const LF = require('./helpers/loanFixture');
const H = require('../services/loans/headroom');
const { recomputeSalary } = require('../services/recompute');
const { computeEmployeeSalary } = require('../services/salaryComputation');

const COMPANY = S.COMPANY;
const salary = (db, code, month, year) => db.prepare('SELECT * FROM salary_computations WHERE employee_code = ? AND month = ? AND year = ?').get(code, month, year);
const stage7 = (db, month, year, requestId = 'lwf-test') => S.silently(() => recomputeSalary(db, { month, year, company: COMPANY, requestId }));
const setPolicy = (db, k, v) => db.prepare('UPDATE policy_config SET value = ? WHERE key = ?').run(v, k);

/** The 10 deduction components that existed before PR-2 (V11). */
const TEN = ['pf_employee', 'esi_employee', 'professional_tax', 'tds', 'advance_recovery', 'lop_deduction',
  'other_deductions', 'loan_recovery', 'late_coming_deduction', 'early_exit_deduction'];
const sumOf = (r, cols) => Math.round(cols.reduce((s, c) => s + (r[c] || 0), 0) * 100) / 100;

/** Stage 6 row + the last 8 days present (so the month-end absence hold does not fire). */
function worked(db, emp, month, year, { payable = 26, present = payable, extraDuty = 0 } = {}) {
  db.prepare(`INSERT INTO day_calculations (employee_code, month, year, company, days_present, total_payable_days, extra_duty_days, days_absent)
              VALUES (?, ?, ?, ?, ?, ?, ?, 0)`).run(emp.code, month, year, emp.company, present, payable, extraDuty);
  if (present === 0) return;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const ins = db.prepare("INSERT OR IGNORE INTO attendance_processed (employee_code, date, status_original, status_final, company, month, year) VALUES (?, ?, 'P', 'P', ?, ?, ?)");
  for (let d = last - 7; d <= last; d++) ins.run(emp.code, `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`, emp.company, month, year);
}

/** Plant employee + one structure dated 2026-01-01 with the given flags. */
function person(db, { code, lwf = 0, pf = 0, esi = 0, gross = 15000, employment_type = 'Permanent', structure = {} } = {}) {
  const emp = S.plant(db, { code, gross_salary: gross, employment_type });
  S.plantStructure(db, emp, '2026-01-01', { gross_salary: gross, lwf, pf, esi, ...structure });
  return emp;
}

describe('P1 — flag on, earned gross > 0', () => {
  test('5 / 20 stored; total_deductions includes 5; net = gross_earned − total_deductions', () => {
    const db = S.newDb();
    const a = person(db, { lwf: 1 });
    const b = person(db, { lwf: 1, pf: 1, esi: 1 });
    worked(db, a, 9, 2026); worked(db, b, 9, 2026);
    stage7(db, 9, 2026);

    const ra = salary(db, a.code, 9, 2026);
    expect(ra.gross_earned).toBeGreaterThan(0);
    expect([ra.lwf_employee, ra.lwf_employer]).toEqual([5, 20]);
    expect(ra.total_deductions).toBe(5);
    expect(ra.net_salary).toBeCloseTo(ra.gross_earned - 5, 2);
    expect(ra.total_payable).toBeCloseTo(ra.net_salary + ra.ot_pay + ra.holiday_duty_pay, 2);
    expect(ra.salary_held).toBe(0);

    const rb = salary(db, b.code, 9, 2026);
    expect([rb.lwf_employee, rb.lwf_employer]).toEqual([5, 20]);
    expect(rb.pf_employee).toBeGreaterThan(0);
    expect(rb.esi_employee).toBeGreaterThan(0);
    expect(rb.total_deductions).toBeCloseTo(sumOf(rb, TEN) + 5, 2);
    expect(rb.net_salary).toBeCloseTo(rb.gross_earned - rb.total_deductions, 2);
    // employer LWF is a cost: never in the employee's deductions or pay
    expect(rb.net_salary).toBeCloseTo(rb.gross_earned - sumOf(rb, TEN) - 5, 2);
    db.close();
  });
});

describe('P2 — no LWF without the flag or without earned gross', () => {
  test('flag off → 0 / 0 and total_deductions unchanged', () => {
    const db = S.newDb();
    const e = person(db, { lwf: 0, pf: 1, esi: 1 });
    worked(db, e, 9, 2026);
    stage7(db, 9, 2026);
    const r = salary(db, e.code, 9, 2026);
    expect([r.lwf_employee, r.lwf_employer]).toEqual([0, 0]);
    expect(r.total_deductions).toBeCloseTo(sumOf(r, TEN), 2);
    db.close();
  });

  test('flag on, zero-gross structure → row saved with gross_earned 0 and 0 / 0', () => {
    const db = S.newDb();
    const e = person(db, { lwf: 1, gross: 0, structure: { conveyance: 0, other_allowances: 0 } });
    worked(db, e, 9, 2026);
    stage7(db, 9, 2026);
    const r = salary(db, e.code, 9, 2026);
    expect(r).toBeTruthy();
    expect(r.gross_earned).toBe(0);
    expect([r.lwf_employee, r.lwf_employer]).toEqual([0, 0]);
    expect(r.total_deductions).toBe(0);
    db.close();
  });

  test('flag on, zero attendance → no salary row at all (silent skip, no LWF)', () => {
    const db = S.newDb();
    const e = person(db, { lwf: 1 });
    worked(db, e, 9, 2026, { payable: 0, present: 0 });
    const emp = db.prepare('SELECT * FROM employees WHERE id = ?').get(e.id);
    const c = S.silently(() => computeEmployeeSalary(db, emp, 9, 2026, COMPANY, 'lwf-test'));
    expect(c).toMatchObject({ success: false, silentSkip: true });
    stage7(db, 9, 2026);
    expect(salary(db, e.code, 9, 2026)).toBeUndefined();
    db.close();
  });
});

describe('P3 — contractors on the list are charged', () => {
  test('contractor with the flag → 5 / 20 while OT and late coming stay 0', () => {
    const db = S.newDb();
    const e = person(db, { lwf: 1, employment_type: 'Contract' });
    worked(db, e, 9, 2026, { extraDuty: 2 });
    db.prepare(`INSERT INTO late_coming_deductions (employee_code, month, year, company, late_count, deduction_days, remark, applied_by, finance_status)
                VALUES (?, 9, 2026, ?, 6, 1, 'synthetic', 'hr1', 'approved')`).run(e.code, COMPANY);
    stage7(db, 9, 2026);
    const r = salary(db, e.code, 9, 2026);
    expect(r.is_contractor).toBe(1);
    expect(r.ot_pay).toBe(0);
    expect(r.late_coming_deduction).toBe(0);
    expect([r.lwf_employee, r.lwf_employer]).toEqual([5, 20]);
    expect(r.total_deductions).toBe(5);
    db.close();
  });
});

describe('P4 — a held salary is still charged', () => {
  test('payable 3 → salary_held = 1, LWF 5 / 20 in the row', () => {
    const db = S.newDb();
    const e = person(db, { lwf: 1 });
    worked(db, e, 9, 2026, { payable: 3, present: 3 });
    stage7(db, 9, 2026);
    const r = salary(db, e.code, 9, 2026);
    expect(r.salary_held).toBe(1);
    expect(r.gross_earned).toBeGreaterThan(0);
    expect([r.lwf_employee, r.lwf_employer]).toEqual([5, 20]);
    expect(r.total_deductions).toBe(5);
    db.close();
  });
});

describe('P5 — amounts come from policy_config (string-safe, garbage → default)', () => {
  test.each([
    ['0', '0', 0, 0],
    ['7.5', '22.5', 7.5, 22.5],
    ['abc', 'xyz', 5, 20],
    ['-3', '', 5, 20],
  ])('employee %p / employer %p → %p / %p', (ee, er, wantEe, wantEr) => {
    const db = S.newDb();
    setPolicy(db, 'lwf_employee_amount', ee);
    setPolicy(db, 'lwf_employer_amount', er);
    const e = person(db, { lwf: 1 });
    worked(db, e, 9, 2026);
    stage7(db, 9, 2026);
    const r = salary(db, e.code, 9, 2026);
    expect([r.lwf_employee, r.lwf_employer]).toEqual([wantEe, wantEr]);
    expect(r.total_deductions).toBe(wantEe);
    db.close();
  });

  test('keys missing altogether → 5 / 20', () => {
    const db = S.newDb();
    db.prepare("DELETE FROM policy_config WHERE key IN ('lwf_employee_amount','lwf_employer_amount')").run();
    const e = person(db, { lwf: 1 });
    worked(db, e, 9, 2026);
    stage7(db, 9, 2026);
    const r = salary(db, e.code, 9, 2026);
    expect([r.lwf_employee, r.lwf_employer]).toEqual([5, 20]);
    db.close();
  });
});

describe('P6 — recompute is idempotent', () => {
  test('two Stage 7 runs → byte-identical rows (volatile columns stripped)', () => {
    const db = S.newDb();
    const a = person(db, { lwf: 1, pf: 1, esi: 1 });
    const b = person(db, { lwf: 0 });
    worked(db, a, 9, 2026); worked(db, b, 9, 2026);
    stage7(db, 9, 2026, 'run-1');
    const first = [S.strip(salary(db, a.code, 9, 2026)), S.strip(salary(db, b.code, 9, 2026))];
    stage7(db, 9, 2026, 'run-2');
    const second = [S.strip(salary(db, a.code, 9, 2026)), S.strip(salary(db, b.code, 9, 2026))];
    expect(second).toEqual(first);
    expect(first[0].lwf_employee).toBe(5);
    db.close();
  });
});

/** INSERT columns / placeholders / params / SET assignments of saveSalaryComputation's UPSERT. */
function upsertCounts() {
  const src = fs.readFileSync(path.join(__dirname, '../services/salaryComputation.js'), 'utf8');
  const body = src.slice(src.indexOf('function saveSalaryComputation('));
  const ins = body.indexOf('INSERT INTO salary_computations');
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

describe('P7 — UPSERT round trip + static counts', () => {
  test('flag on → 5 / 20; flag switched off + recompute → 0 / 0 (ON CONFLICT overwrites)', () => {
    const db = S.newDb();
    const e = person(db, { lwf: 1 });
    worked(db, e, 9, 2026);
    stage7(db, 9, 2026, 'on');
    expect(salary(db, e.code, 9, 2026)).toMatchObject({ lwf_employee: 5, lwf_employer: 20, total_deductions: 5 });
    const id = salary(db, e.code, 9, 2026).id;
    db.prepare('UPDATE salary_structures SET lwf_applicable = 0 WHERE employee_id = ?').run(e.id);
    stage7(db, 9, 2026, 'off');
    const r = salary(db, e.code, 9, 2026);
    expect(r.id).toBe(id); // same row, updated in place
    expect(r).toMatchObject({ lwf_employee: 0, lwf_employer: 0, total_deductions: 0 });
    expect(r.net_salary).toBe(r.gross_earned);
    db.close();
  });

  test('INSERT columns 58 = placeholders 58 = params 58; ON CONFLICT SET 55; LWF in all four lists', () => {
    const u = upsertCounts();
    expect(u.cols).toHaveLength(58);
    expect(u.placeholders).toBe(58);
    expect(u.params).toHaveLength(58);
    expect(u.sets).toHaveLength(55);
    expect(u.cols).toEqual(expect.arrayContaining(['lwf_employee', 'lwf_employer']));
    expect(u.sets).toEqual(expect.arrayContaining(['lwf_employee = excluded.lwf_employee', 'lwf_employer = excluded.lwf_employer']));
    const ci = u.cols.indexOf('lwf_employee');
    expect(u.params[ci]).toBe('comp.lwfEmployee || 0');
    expect(u.params[u.cols.indexOf('lwf_employer')]).toBe('comp.lwfEmployer || 0');
  });
});

describe('P8 — drift identity + component check on a mixed month', () => {
  test('flagged / unflagged / held / contractor / PF+ESI → 0 drift rows; 10 components + LWF = total', () => {
    const db = S.newDb();
    const people = [
      person(db, { lwf: 1 }), person(db, { lwf: 0 }), person(db, { lwf: 1, pf: 1, esi: 1 }),
      person(db, { lwf: 1, employment_type: 'Contract' }), person(db, { lwf: 1, gross: 30000, pf: 1 }),
    ];
    const held = person(db, { lwf: 1, pf: 1 });
    for (const p of people) worked(db, p, 9, 2026);
    worked(db, held, 9, 2026, { payable: 2, present: 2 });
    stage7(db, 9, 2026);
    expect(db.prepare('SELECT COUNT(*) AS c FROM salary_computations').get().c).toBe(6);
    expect(db.prepare('SELECT employee_code FROM salary_computations WHERE ABS(net_salary-(gross_earned-total_deductions))>1').all()).toEqual([]);
    const v11 = db.prepare(`SELECT employee_code FROM salary_computations
      WHERE ABS(total_deductions - (COALESCE(pf_employee,0)+COALESCE(esi_employee,0)+COALESCE(professional_tax,0)+COALESCE(tds,0)
        +COALESCE(advance_recovery,0)+COALESCE(lop_deduction,0)+COALESCE(other_deductions,0)+COALESCE(loan_recovery,0)
        +COALESCE(late_coming_deduction,0)+COALESCE(early_exit_deduction,0)+COALESCE(lwf_employee,0))) > 1`).all();
    expect(v11).toEqual([]);
    expect(db.prepare('SELECT SUM(lwf_employee) AS ee, SUM(lwf_employer) AS er FROM salary_computations').get()).toEqual({ ee: 25, er: 100 });
    db.close();
  });
});

describe('P9 — earlier months and unflagged colleagues are untouched', () => {
  test('August computed flag-off → upload sets LWF from September → August re-run byte-identical; colleague 0 / 0', () => {
    const db = S.newDb();
    const a = person(db, { lwf: 0, pf: 1, esi: 1 });
    const colleague = person(db, { lwf: 0, pf: 1, esi: 1 });
    worked(db, a, 8, 2026); worked(db, colleague, 8, 2026);
    stage7(db, 8, 2026, 'aug-1');
    const augA = S.strip(salary(db, a.code, 8, 2026));
    const augC = S.strip(salary(db, colleague.code, 8, 2026));
    expect([augA.lwf_employee, augA.lwf_employer]).toEqual([0, 0]);

    // the owner's upload: LWF Y for `a` only, effective 2026-09 (PF/ESI stay Y)
    const up = S.applyFile(db, 'plant', S.plantFile(S.prow(a.code, 1, 1, 1)));
    expect(up.ok).toBe(true);

    stage7(db, 8, 2026, 'aug-2');
    expect(S.strip(salary(db, a.code, 8, 2026))).toEqual(augA);
    expect(S.strip(salary(db, colleague.code, 8, 2026))).toEqual(augC);

    worked(db, a, 9, 2026); worked(db, colleague, 9, 2026);
    stage7(db, 9, 2026, 'sep-1');
    const sepA = salary(db, a.code, 9, 2026);
    const sepC = salary(db, colleague.code, 9, 2026);
    expect([sepA.lwf_employee, sepA.lwf_employer]).toEqual([5, 20]);
    expect(sepA.total_deductions).toBeCloseTo(sumOf(sepA, TEN) + 5, 2);
    expect([sepC.lwf_employee, sepC.lwf_employer]).toEqual([0, 0]);
    expect(sepC.total_deductions).toBeCloseTo(sumOf(sepC, TEN), 2);
    expect(sepC.net_salary).toBeCloseTo(sepC.gross_earned - sumOf(sepC, TEN), 2);

    // Control: the same two people and months with NO upload. The colleague's
    // September is identical in every column; `a` differs ONLY by the LWF lines.
    const ctl = S.newDb();
    const a2 = person(ctl, { code: a.code, lwf: 0, pf: 1, esi: 1 });
    const c2 = person(ctl, { code: colleague.code, lwf: 0, pf: 1, esi: 1 });
    for (const m of [8, 9]) { worked(ctl, a2, m, 2026); worked(ctl, c2, m, 2026); stage7(ctl, m, 2026, `ctl-${m}`); }
    expect(S.strip(salary(db, colleague.code, 9, 2026))).toEqual(S.strip(salary(ctl, c2.code, 9, 2026)));
    const withLwf = S.strip(sepA);
    const without = S.strip(salary(ctl, a2.code, 9, 2026));
    const changed = Object.keys(withLwf).filter((k) => withLwf[k] !== without[k]).sort();
    expect(changed).toEqual(['lwf_employee', 'lwf_employer', 'net_salary', 'take_home', 'total_deductions', 'total_payable'].sort());
    expect(withLwf.total_deductions).toBeCloseTo(without.total_deductions + 5, 2);
    expect(withLwf.net_salary).toBeCloseTo(without.net_salary - 5, 2);
    expect(withLwf.total_payable).toBeCloseTo(without.total_payable - 5, 2);
    expect(withLwf.take_home).toBeCloseTo(without.take_home - 5, 2);
    ctl.close();
    db.close();
  });
});

describe('P10 — LWF counts in the loan headroom (loan stays the last deduction)', () => {
  function loanMonth(lwf) {
    const db = LF.F.newDb();
    // Disbursed 5 Aug → EMIs Sep / Oct / Nov 2026 of ₹3,000. Gross ₹20,000; PF + ESI on.
    const { loanId, emp } = LF.activeLoan(db, { disbursedOn: '2026-08-05', principal: 9000, tenure: 3 });
    db.prepare(`INSERT INTO salary_structures (employee_id, effective_from, gross_salary, basic, hra, other_allowances,
                pf_applicable, esi_applicable, lwf_applicable) VALUES (?, '2026-01-01', 20000, 10000, 4000, 6000, 1, 1, ?)`).run(emp.id, lwf);
    // a big advance recovered in September so the 50% cap binds
    db.prepare(`INSERT INTO salary_advances (employee_code, month, year, is_eligible, advance_amount, paid, recovered, recovery_month, recovery_year)
                VALUES (?, 8, 2026, 1, 6000, 1, 0, 9, 2026)`).run(emp.code);
    worked(db, { code: emp.code, company: LF.COMPANY }, 9, 2026);
    const out = LF.F.silently(() => recomputeSalary(db, { month: 9, year: 2026, company: LF.COMPANY, requestId: `p10-${lwf}` }));
    expect(out.errors).toEqual([]);
    const sep = db.prepare('SELECT * FROM salary_computations WHERE employee_code = ? AND month = 9 AND year = 2026').get(emp.code);
    const led = db.prepare('SELECT * FROM loan_deductions WHERE loan_id = ? AND month = 9 AND year = 2026').all(loanId);
    const reconciled = LF.L.reconcileLoan(db, loanId);
    db.close();
    return { sep, led, reconciled };
  }

  test('loan_recovery = min(3000, floor(50% × gross_earned) − (PF + ESI + advance + LWF)), exactly ₹5 less than LWF off', () => {
    const off = loanMonth(0);
    const on = loanMonth(1);
    expect([off.sep.lwf_employee, on.sep.lwf_employee]).toEqual([0, 5]);
    expect(on.sep.gross_earned).toBe(off.sep.gross_earned);

    const room = (s) => Math.floor(s.gross_earned * 0.5 * 100) / 100 - (s.pf_employee + s.esi_employee + s.advance_recovery + s.lwf_employee);
    expect(on.sep.loan_recovery).toBeCloseTo(Math.min(3000, room(on.sep)), 2);
    expect(off.sep.loan_recovery).toBeCloseTo(Math.min(3000, room(off.sep)), 2);
    expect(off.sep.loan_recovery).toBeLessThan(3000); // the cap binds in both runs
    expect(on.sep.loan_recovery).toBeCloseTo(off.sep.loan_recovery - 5, 2);

    for (const r of [off, on]) {
      expect(r.sep.total_deductions).toBeCloseTo(sumOf(r.sep, TEN) + r.sep.lwf_employee, 2);
      expect(Math.abs(r.sep.net_salary - (r.sep.gross_earned - r.sep.total_deductions))).toBeLessThanOrEqual(1);
      expect(r.led).toEqual([expect.objectContaining({ state: 'provisional', amount: r.sep.loan_recovery })]);
      expect(r.reconciled.ok).toBe(true);
    }
  });

  test('unit: priorDeductions({ lwf_employee: 5 }) = 500 paise for plant and sales; loan_recovery never counted', () => {
    expect(H.priorDeductions({ lwf_employee: 5 }, 'plant')).toBe(500);
    expect(H.priorDeductions({ lwf_employee: 5 }, 'sales')).toBe(500);
    expect(H.PRIOR_DEDUCTION_COMPONENTS.plant).toContain('lwf_employee');
    expect(H.PRIOR_DEDUCTION_COMPONENTS.sales).toContain('lwf_employee');
    expect(H.PRIOR_DEDUCTION_COMPONENTS.sales).not.toContain('loan_recovery');
    // a sales salary object without the key (sales compute until PR-2b) is unchanged
    expect(H.priorDeductions({ pf_employee: 100 }, 'sales')).toBe(10000);
  });
});
