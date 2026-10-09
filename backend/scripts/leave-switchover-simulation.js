#!/usr/bin/env node
/**
 * Leave switchover 2026 — end-to-end simulation (PROMPT.md §7, amendment D).
 *
 *   node backend/scripts/leave-switchover-simulation.js
 *
 * Builds a throw-away database in a temp DATA_DIR shaped like production on
 * 9 Oct 2026 (read-only facts in docs/leave-switchover-2026/PROGRESS.md):
 * the 98 SILP/Worker employees from permanent-codes.json with their real
 * Jan–Sep days worked, stale CL openings 6/7/12 with used 12, the 12
 * leave_transactions rows verbatim, the in-app leave corrections behind
 * #4–#11, plus Permanent / Sales / Left / Contract bystanders. Then it drives
 * the real routes over a socket:
 *
 *   upload the owner's xlsx (dry run, commit) -> switchover preview ->
 *   switchover apply -> leave-recompute apply -> second switchover apply
 *
 * and asserts the owner's four reference employees, offsets netting to zero,
 * the second apply being refused with balances unchanged, Sep salary identical
 * before/after the retype, and drift = 0. Never touches a real database.
 * Exit code 0 = every assertion held.
 */
const fs = require('fs');
const path = require('path');

const DOCS = path.join(__dirname, '../../docs/leave-switchover-2026');
const CODES = JSON.parse(fs.readFileSync(path.join(DOCS, 'permanent-codes.json'), 'utf8'));
const SHEET = path.join(DOCS, 'leave-outside-system-2026.xlsx');

const { startApi } = require('../src/__tests__/helpers/apiHarness');
const { uploadGrants } = require('../src/__tests__/helpers/grantsUpload');
const F = require('../src/__tests__/helpers/leaveFixture');
const { tableMd5 } = require('../src/__tests__/helpers/switchoverFixture');
const { recomputeSalary } = require('../src/services/recompute');
const { RETYPE_LIST, CONFIRM_PHRASE, offsetReason } = require('../src/services/leaveSwitchover2026');

const YEAR = 2026;
const CO = 'Indriyan Beverages Pvt Ltd';
let failures = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
};

// ── Seed ────────────────────────────────────────────────────────────────────
function seed(db) {
  const SAMPLES = new Set(['14686', '17575', '23540', '19954']);
  const nullDoj = new Set(CODES.employees.slice(40, 53).map((e) => e.code).filter((c) => !SAMPLES.has(c)).slice(0, 12));
  const joined2026 = CODES.employees.slice(63).map((e) => e.code); // 35 joiners, like production

  const emps = {};
  CODES.employees.forEach((c, i) => {
    let doj = '2022-04-01';
    if (nullDoj.has(c.code)) doj = null;
    const j = joined2026.indexOf(c.code);
    if (j >= 0) doj = `2026-${String(1 + (j % 9)).padStart(2, '0')}-${j % 2 ? '01' : '15'}`;
    const e = F.addEmployee(db, { code: c.code, name: c.name, department: c.department, company: CO, employment_type: c.old_type });
    db.prepare('UPDATE employees SET date_of_joining = ?, category = ? WHERE id = ?').run(doj, c.old_type, e.id);
    if (i < 2) db.prepare('UPDATE employees SET is_contractor = 1 WHERE id = ?').run(e.id); // 2 legacy flags, like prod
    emps[c.code] = { ...e, date_of_joining: doj };
    const opening = i < 17 ? 6 : i < 88 ? 7 : 12;
    F.setBalance(db, e, 'CL', YEAR, { opening, used: 12, balance: 0 });
    F.setBalance(db, e, 'EL', YEAR, { opening: 0, used: 0, balance: 0 });
    // Real Jan–Sep days worked, spread over nine Stage-6 rows.
    const total = Number(c.days_worked_jan_sep) || 0;
    const whole = Math.floor(total);
    const half = total - whole > 0 ? 1 : 0;
    const per = Math.floor(whole / 9);
    for (let m = 1; m <= 9; m += 1) {
      const present = m === 9 ? whole - per * 8 : per;
      F.addDayCalc(db, e, m, YEAR, {
        days_present: present, days_half_present: m === 9 ? half : 0,
        total_payable_days: Math.min(30, present + 0.5 * (m === 9 ? half : 0) + 4),
      });
    }
    db.prepare(`INSERT INTO salary_structures (employee_id, basic, hra, gross_salary, effective_from, pf_applicable, esi_applicable)
                VALUES (?, 10000, 4000, 20000, '2024-01-01', 1, 1)`).run(e.id);
  });

  // Bystanders.
  const extra = (code, type, over = {}) => F.addEmployee(db, { code, company: CO, employment_type: type, date_of_joining: '2021-01-01', ...over });
  emps['23725'] = extra('23725', 'Permanent');
  F.setBalance(db, emps['23725'], 'CL', YEAR, { opening: 0, used: 2, balance: -2 });
  F.setBalance(db, emps['23725'], 'EL', YEAR, { opening: 0, used: 5, balance: -5 });
  emps['23152'] = extra('23152', 'Permanent');
  F.setBalance(db, emps['23152'], 'CL', YEAR, { opening: 12, balance: 12 });
  for (let m = 1; m <= 9; m += 1) { F.addWorkedMonth(db, emps['23725'], m, YEAR, 24); F.addWorkedMonth(db, emps['23152'], m, YEAR, 25); }
  extra('P0001', 'Permanent');                              // no 2026 rows: the engine inserts them later
  const sales = extra('S0001', 'Sales');
  F.setBalance(db, sales, 'CL', YEAR, { opening: 12, balance: 12 });
  const left = extra('L0001', 'SILP', { status: 'Left' });
  F.setBalance(db, left, 'CL', YEAR, { opening: 12, used: 4, balance: 8 });
  extra('C0001', 'Contract');

  // The 12 leave_transactions rows, verbatim from production.
  const tx = db.prepare(`
    INSERT INTO leave_transactions (id, employee_id, employee_code, company, leave_type, transaction_type, days,
                                    balance_after, reference_month, reference_year, reason, approved_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, 2026, ?, ?)`);
  [
    [1, '19954', 'EL', 'Credit', 10, 8, 'till june leave', 'admin'],
    [2, '23700', 'CL', 'Credit', 3, 8, '', 'admin'],
    [3, '23700', 'EL', 'Credit', 9, 8, '', 'admin'],
    [4, '23700', 'EL', 'Debit', 1, 8, 'urgent', 'hr1'],
    [5, '23725', 'EL', 'Debit', 1, 8, 'urgent', 'hr1'],
    [6, '23725', 'CL', 'Debit', 1, 8, 'urgent', 'hr1'],
    [7, '23725', 'EL', 'Debit', 1, 8, 'urgent', 'hr1'],
    [8, '23725', 'EL', 'Debit', 1, 8, 'urgent', 'hr1'],
    [9, '23725', 'CL', 'Debit', 1, 8, 'urgent', 'hr1'],
    [10, '23725', 'EL', 'Debit', 1, 8, 'urgent', 'hr1'],
    [11, '23725', 'EL', 'Debit', 1, 8, 'ur', 'hr1'],
    [12, '23700', 'CL', 'Debit', 1, 9, '', 'admin'],
  ].forEach(([id, code, type, kind, days, month, reason, by]) => {
    tx.run(id, emps[code].id, code, CO, type, kind, days, month, reason, by);
  });
  // The finance apply-leave corrections behind #4–#11 (Aug 2026).
  const ap = db.prepare(`INSERT INTO attendance_processed (employee_code, date, month, year, company, status_original, status_final, correction_source)
                         VALUES (?, ?, 8, 2026, ?, 'A', ?, 'leave_correction')`);
  for (const d of [17, 24, 26, 28, 29]) ap.run('23725', `2026-08-${d}`, CO, 'EL');
  for (const d of [27, 31]) ap.run('23725', `2026-08-${d}`, CO, 'CL');
  ap.run('23700', '2026-08-31', CO, 'EL');

  db.prepare(`INSERT INTO monthly_imports (month, year, company, file_name, status, stage_1_done)
              VALUES (9, 2026, ?, 'sim.xls', 'imported', 1)`).run(CO);
  return emps;
}

const MONEY = ['gross_earned', 'basic_earned', 'hra_earned', 'pf_employee', 'pf_employer', 'esi_employee', 'esi_employer',
  'ot_pay', 'ed_pay', 'total_deductions', 'net_salary', 'total_payable', 'take_home', 'payable_days'];
function salarySnapshot(db) {
  F.silently(() => recomputeSalary(db, { month: 9, year: YEAR, company: CO }));
  return db.prepare(`SELECT employee_code, ${MONEY.join(', ')} FROM salary_computations WHERE month = 9 AND year = ? ORDER BY employee_code`).all(YEAR);
}

// ── Run ─────────────────────────────────────────────────────────────────────
async function main() {
  const api = F.silently(() => startApi({ '/api/features': '../../routes/phase5' }, { username: 'simulation' }));
  const { db } = api;
  try {
    const emps = seed(db);
    console.log(`Fixture: ${Object.keys(emps).length} employees, DATA_DIR=${process.env.DATA_DIR}`);
    check('embedded retype list equals permanent-codes.json',
      JSON.stringify(RETYPE_LIST.map((r) => [r.code, r.old_type])) === JSON.stringify(CODES.employees.map((r) => [r.code, r.old_type])));

    const salaryBefore = salarySnapshot(db);

    // 1. Upload the owner's sheet.
    const buf = fs.readFileSync(SHEET);
    const dry = await uploadGrants(api, buf, '', path.basename(SHEET));
    check('upload dry run: 44 rows, 44 accepted', dry.status === 200 && dry.body.totals.accepted === 44 && dry.body.totals.rejected === 0,
      JSON.stringify(dry.body && dry.body.totals));
    const commit = await uploadGrants(api, buf, '?dryRun=false', path.basename(SHEET));
    const cl = db.prepare("SELECT COALESCE(SUM(days),0) d FROM leave_external_grants WHERE leave_type='CL'").get().d;
    const el = db.prepare("SELECT COALESCE(SUM(days),0) d FROM leave_external_grants WHERE leave_type='EL'").get().d;
    check('upload commit stored CL 76 + EL 57 days', commit.status === 200 && cl === 76 && el === 57, `CL ${cl}, EL ${el}`);

    // 2. Preview (must not write).
    const fp = () => ['leave_balances', 'employees', 'leave_transactions', 'policy_config'].map((t) => tableMd5(db, t)).join(':');
    const beforePreview = fp();
    const preview = await api.request('GET', '/api/features/leave-switchover-2026/preview');
    check('preview 200 and tables byte-identical after it', preview.status === 200 && fp() === beforePreview);
    const t = preview.body.totals;
    // Fixture categories mirror the old types, so all 98 carry the revert risk.
    check('preview: 98 retyped, 0 skipped, 98 at category-revert risk', t.retyped === 98 && t.skipped === 0 && t.category_revert_risk === 98,
      `retyped ${t.retyped}, skipped ${t.skipped}, category risk ${t.category_revert_risk}`);
    check('preview: double-count flags = 23725 Aug + 23700 Aug', preview.body.double_count_flags.map((f) => `${f.code}/${f.month}`).join(',') === '23700/8,23725/8',
      preview.body.double_count_flags.map((f) => `${f.code}/${f.month}`).join(','));

    // 3. Apply the switchover.
    const applied = await api.request('POST', '/api/features/leave-switchover-2026/apply', { body: { confirm: CONFIRM_PHRASE, note: 'simulation' } });
    check('switchover apply 200 with a backup file', applied.status === 200 && fs.existsSync(applied.body.backup_path), applied.body.backup_path);
    check('apply totals == preview totals', JSON.stringify(applied.body.totals) === JSON.stringify(t));
    check('leave_automation_enabled still false; no ledger rows yet',
      db.prepare("SELECT value FROM policy_config WHERE key='leave_automation_enabled'").get().value === 'false'
      && db.prepare('SELECT COUNT(*) c FROM leave_accrual_ledger').get().c === 0);

    // Offsets net to zero per (employee, type, month 8) for #1-#3.
    const net = db.prepare(`
      SELECT employee_code, leave_type, SUM(CASE transaction_type WHEN 'Credit' THEN days ELSE -days END) n
      FROM leave_transactions WHERE reference_month = 8 AND (id IN (1,2,3) OR reason LIKE 'Superseded by computed accrual%')
      GROUP BY 1, 2 ORDER BY 1, 2`).all();
    check('offsets net to 0 per (employee, type, month 8)', net.length === 3 && net.every((r) => r.n === 0),
      net.map((r) => `${r.employee_code} ${r.leave_type} ${r.n}`).join('; '));
    check('three offset rows, originals untouched', [1, 2, 3].every((id) => db.prepare('SELECT 1 FROM leave_transactions WHERE reason = ?').get(offsetReason(id)))
      && db.prepare("SELECT COUNT(*) c FROM leave_transactions WHERE id <= 12").get().c === 12);

    // 4. The owner's own step: leave recompute apply (automation stays off).
    const rec = await api.request('POST', '/api/features/leave-recompute/apply', { body: { year: YEAR, confirm: true, note: 'simulation' } });
    check('leave-recompute apply 200', rec.status === 200, JSON.stringify(rec.body && (rec.body.error || rec.body.totals)));

    const balOf = (code, type) => db.prepare(`SELECT lb.* FROM leave_balances lb JOIN employees e ON e.id = lb.employee_id
                                             WHERE e.code = ? AND lb.year = 2026 AND lb.leave_type = ?`).get(code, type);
    const ledgerYtd = (code) => db.prepare(`SELECT el_earned_ytd, paid_days_ytd FROM leave_accrual_ledger
                                            WHERE employee_code = ? AND year = 2026 AND leave_type = 'EL' ORDER BY month DESC LIMIT 1`).get(code);
    const expected = [
      { code: '14686', worked: 260, earned: 12, el: 12, cl: 4 },
      { code: '17575', worked: 233.5, earned: 11, el: 6, cl: 0 },
      { code: '23540', worked: 161, earned: 0, el: -5, cl: 0 },
      { code: '19954', worked: 220, earned: 10, el: 4, cl: 0 },
    ];
    const rows = [];
    for (const x of expected) {
      const y = ledgerYtd(x.code);
      const got = { worked: y.paid_days_ytd, earned: y.el_earned_ytd, el: balOf(x.code, 'EL').balance, cl: balOf(x.code, 'CL').balance };
      const ok = got.worked === x.worked && got.earned === x.earned && got.el === x.el && got.cl === x.cl;
      check(`${x.code}: worked ${x.worked}, EL earned ${x.earned}, EL ${x.el}, CL ${x.cl}`, ok, JSON.stringify(got));
      rows.push({ code: x.code, ...got, cl_opening: balOf(x.code, 'CL').opening, ok });
    }

    // 5. Second switchover apply is refused; balances unchanged.
    const balMd5 = tableMd5(db, 'leave_balances');
    const second = await api.request('POST', '/api/features/leave-switchover-2026/apply', { body: { confirm: CONFIRM_PHRASE } });
    check('second switchover apply refused (409), leave_balances unchanged', second.status === 409 && tableMd5(db, 'leave_balances') === balMd5);

    // 6. Salary neutral at scale + drift.
    const salaryAfter = salarySnapshot(db);
    check(`Sep salary identical for ${salaryBefore.length} employees before/after retype`,
      salaryBefore.length > 90 && JSON.stringify(salaryAfter) === JSON.stringify(salaryBefore));
    const drift = db.prepare(`SELECT COUNT(*) c FROM salary_computations WHERE ABS(net_salary-(gross_earned-total_deductions)) > 1`).get().c;
    check('drift > Rs 1 = 0 rows', drift === 0, `${drift}`);

    // Summary.
    const all = db.prepare(`SELECT e.code, lb.leave_type, lb.balance FROM leave_balances lb JOIN employees e ON e.id = lb.employee_id
                            WHERE lb.year = 2026 AND lb.leave_type IN ('CL','EL') AND LOWER(e.employment_type) = 'permanent' AND e.status = 'Active'`).all();
    console.log('\nReference employees (after switchover + leave recompute):');
    console.log('  code   | worked | EL earned | EL bal | CL opening | CL bal | ok');
    for (const r of rows) {
      console.log(`  ${r.code.padEnd(6)} | ${String(r.worked).padStart(6)} | ${String(r.earned).padStart(9)} | ${String(r.el).padStart(6)} | ${String(r.cl_opening).padStart(10)} | ${String(r.cl).padStart(6)} | ${r.ok ? 'yes' : 'NO'}`);
    }
    const sum = (type) => Math.round(all.filter((r) => r.leave_type === type).reduce((a, r) => a + r.balance, 0) * 100) / 100;
    console.log(`\nPreview totals: ${JSON.stringify(t)}`);
    console.log(`Active Permanent after: ${new Set(all.map((r) => r.code)).size} employees; EL total ${sum('EL')}, CL total ${sum('CL')}; `
      + `negatives EL ${all.filter((r) => r.leave_type === 'EL' && r.balance < 0).length}, CL ${all.filter((r) => r.leave_type === 'CL' && r.balance < 0).length}`);
  } finally {
    await api.close();
  }
  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
