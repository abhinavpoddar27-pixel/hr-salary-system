/**
 * Leave switchover 2026 — preview is a pure rollback, apply is guarded, backed
 * up, audited and idempotent-by-refusal (PROMPT.md §3.4, §7; rulings R-A…R-H).
 */
const fs = require('fs');
const path = require('path');
const F = require('./helpers/leaveFixture');
const S = require('./helpers/switchoverFixture');
const {
  previewSwitchover, applySwitchover, CONFIRM_PHRASE, GUARD_KEY, RETYPE_LIST, offsetReason, doubleCountText,
} = require('../services/leaveSwitchover2026');
const { computeLeavePlan, partitionTransactions } = require('../services/leaveEngine');

const YEAR = 2026;
const policy = (db, key) => db.prepare('SELECT value FROM policy_config WHERE key = ?').get(key)?.value ?? null;
const typeOf = (db, code) => db.prepare('SELECT employment_type FROM employees WHERE code = ?').get(code).employment_type;
const bal = (db, emp, type, year = YEAR) => F.getBalance(db, emp, type, year);

/** A small production-shaped world. */
function seed(db) {
  const e = {
    silp: S.addEmp(db, '14686', 'SILP'),
    worker: S.addEmp(db, '18989', 'Worker'),
    e17575: S.addEmp(db, '17575', 'SILP'),
    e19954: S.addEmp(db, '19954', 'Worker'),
    e23700: S.addEmp(db, '23700', 'SILP'),
    wrongType: S.addEmp(db, '23540', 'Contract'),            // listed as SILP -> skip
    left: S.addEmp(db, '22129', 'SILP', { status: 'Left' }), // listed, not Active -> skip
    already: S.addEmp(db, '23725', 'Permanent', { date_of_joining: '2026-08-10' }),
    offList: S.addEmp(db, '99001', 'SILP'),                  // not listed -> untouched
  };
  db.prepare("UPDATE employees SET category = employment_type WHERE code IN ('14686', '18989')").run();
  for (const k of ['silp', 'worker', 'e17575', 'e19954', 'e23700', 'already', 'offList']) {
    F.setBalance(db, e[k], 'CL', YEAR, { opening: 7, used: 12, balance: 0 });
    F.setBalance(db, e[k], 'EL', YEAR, { opening: 0, balance: 0 });
  }
  F.setBalance(db, e.worker, 'CL', YEAR, { opening: 12, used: 12, balance: 0 });
  F.setBalance(db, e.worker, 'CL', 2025, { opening: 12, used: 3, balance: 9 }); // other year
  F.setBalance(db, e.silp, 'EL', YEAR, { opening: 2, balance: 2 });
  S.addRuledCredits(db, e.e19954, e.e23700);
  S.addTxnWithId(db, 4, e.e23700, { transaction_type: 'Debit', days: 1, reason: 'urgent', approved_by: 'hr1' });
  return e;
}

describe('the embedded retype list', () => {
  test('equals docs/leave-switchover-2026/permanent-codes.json (code + old_type)', () => {
    const file = path.join(__dirname, '../../../docs/leave-switchover-2026/permanent-codes.json');
    if (!fs.existsSync(file)) return; // committed with the docs (commit 6)
    const json = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(json.count).toBe(98);
    expect(RETYPE_LIST.map((r) => [r.code, r.old_type])).toEqual(json.employees.map((r) => [r.code, r.old_type]));
  });
});

describe('preview', () => {
  test('runs everything inside a transaction and rolls it back — byte-identical tables', () => {
    const { db, cleanup } = S.newFileDb();
    seed(db);
    const before = S.fingerprint(db);
    const out = previewSwitchover(db);
    expect(out.ok).toBe(true);
    expect(out.dry_run).toBe(true);
    expect(S.fingerprint(db)).toEqual(before);
    expect(db.prepare('SELECT COUNT(*) c FROM leave_accrual_ledger').get().c).toBe(0);
    // A second preview is identical too.
    const again = previewSwitchover(db);
    expect(again.totals).toEqual(out.totals);
    expect(S.fingerprint(db)).toEqual(before);
    cleanup();
  });

  test('reports retyped, skipped (with reason), policy before -> after, openings and offsets', () => {
    const { db, cleanup } = S.newFileDb();
    seed(db);
    const out = previewSwitchover(db);
    const changed = out.retype.changed.map((c) => c.code).sort();
    expect(changed).toEqual(['14686', '17575', '18989', '19954', '23700']);
    const skip = Object.fromEntries(out.retype.skipped.map((s) => [s.code, s.reason]));
    expect(skip['23540']).toBe('Type is Contract, expected SILP');
    expect(skip['22129']).toBe('Status is Left, not Active');
    expect(skip['23712']).toBe('No employee with that code');
    expect(out.retype.skipped.length).toBe(98 - 5);
    expect(out.retype.category_revert_risk).toEqual({ count: 2, codes: ['14686', '18989'] });

    expect(out.policy).toEqual([
      { key: 'el_days_per_leave', before: '20', after: '21', changed: true },
      { key: 'el_eligibility_days', before: '180', after: '180', changed: false },
      { key: 'cl_entitlement_base', before: '7', after: '4', changed: true },
      { key: 'cl_annual_entitlement', before: '7', after: '4', changed: true },
    ]);
    // 5 retyped + 23725 already Permanent (DOJ 10 Aug -> effective Sep -> 2).
    const cl = Object.fromEntries(out.cl_openings.rows.filter((r) => r.leave_type === 'CL').map((r) => [r.code, [r.before, r.after]]));
    expect(cl).toEqual({
      14686: [7, 4], 17575: [7, 4], 18989: [12, 4], 19954: [7, 4], 23700: [7, 4], 23725: [7, 2],
    });
    expect(out.cl_openings.el_changed).toBe(1); // 14686 EL opening 2 -> 0
    expect(out.offsets.map((o) => [o.offsets_txn_id, o.status])).toEqual([[1, 'to_add'], [3, 'to_add'], [2, 'to_add']]);
    expect(out.totals).toMatchObject({ retyped: 5, policy_changed: 3, cl_openings_changed: 6, el_openings_changed: 1, offsets: 3 });
    // Names are present (admin-only route; owner asked for them).
    expect(out.employees.find((e) => e.code === '14686').name).toBe('TEST EMPLOYEE');
    // The off-list SILP is not in the leave population.
    expect(out.employees.map((e) => e.code)).not.toContain('99001');
    cleanup();
  });
});

describe('apply', () => {
  test('wrong phrase is refused and nothing changes', async () => {
    const { db, cleanup } = S.newFileDb();
    seed(db);
    const before = S.fingerprint(db);
    for (const confirm of [undefined, '', 'switchover 2026', 'APPLY 2026', true]) {
      const out = await applySwitchover(db, { confirm });
      expect(out).toMatchObject({ ok: false, status: 400, code: 'CONFIRM_PHRASE' });
    }
    expect(S.fingerprint(db)).toEqual(before);
    cleanup();
  });

  test('backs up, applies R-A/R-B/R-C/R-F/R-G in one go with audit rows, and is refused the second time', async () => {
    const { db, dir, cleanup } = S.newFileDb();
    const e = seed(db);
    const preview = previewSwitchover(db);
    const autoBefore = policy(db, 'leave_automation_enabled');

    const out = await applySwitchover(db, { confirm: CONFIRM_PHRASE, note: 'test run', actor: 'owner', backupDir: path.join(dir, 'backups') });
    expect(out.ok).toBe(true);
    expect(fs.existsSync(out.backup_path)).toBe(true);
    expect(fs.statSync(out.backup_path).size).toBeGreaterThan(0);
    expect(out.totals).toEqual(preview.totals); // apply == preview

    // The backup is the pre-switchover database.
    const Database = require('better-sqlite3');
    const snap = new Database(out.backup_path, { readonly: true });
    expect(snap.prepare("SELECT employment_type FROM employees WHERE code = '14686'").get().employment_type).toBe('SILP');
    snap.close();

    // R-A
    for (const code of ['14686', '17575', '18989', '19954', '23700']) expect(typeOf(db, code)).toBe('Permanent');
    expect(typeOf(db, '23540')).toBe('Contract');
    expect(typeOf(db, '22129')).toBe('SILP');
    expect(typeOf(db, '99001')).toBe('SILP');
    expect(db.prepare("SELECT category FROM employees WHERE code = '14686'").get().category).toBe('SILP'); // category untouched
    // R-B / R-C
    expect(policy(db, 'el_days_per_leave')).toBe('21');
    expect(policy(db, 'el_eligibility_days')).toBe('180');
    expect(policy(db, 'cl_entitlement_base')).toBe('4');
    expect(policy(db, 'cl_annual_entitlement')).toBe('4');
    expect(policy(db, GUARD_KEY)).toBeTruthy();
    // R-G: openings only; used/balance untouched; other years untouched; no rows created
    expect(bal(db, e.worker, 'CL')).toMatchObject({ opening: 4, used: 12, balance: 0 });
    expect(bal(db, e.silp, 'EL')).toMatchObject({ opening: 0, balance: 2 });
    expect(bal(db, e.already, 'CL').opening).toBe(2);
    expect(bal(db, e.worker, 'CL', 2025)).toMatchObject({ opening: 12, used: 3, balance: 9 });
    expect(bal(db, e.offList, 'CL').opening).toBe(7);
    expect(db.prepare('SELECT COUNT(*) c FROM leave_balances').get().c).toBe(7 * 2 + 1);
    // Never applies balances, never touches the switch.
    expect(db.prepare('SELECT COUNT(*) c FROM leave_accrual_ledger').get().c).toBe(0);
    expect(policy(db, 'leave_automation_enabled')).toBe(autoBefore);

    // Audit: 5 retype + 3 policy + 3 offsets + 7 openings + 1 guard.
    const audits = db.prepare("SELECT action_type, COUNT(*) c FROM audit_log WHERE stage = 'leave_switchover_2026' GROUP BY action_type").all();
    expect(Object.fromEntries(audits.map((a) => [a.action_type, a.c]))).toEqual({
      switchover_retype: 5, switchover_policy: 3, switchover_offset: 3, switchover_opening: 7, switchover_applied: 1,
    });
    expect(db.prepare("SELECT changed_by FROM audit_log WHERE action_type = 'switchover_retype' LIMIT 1").get().changed_by).toBe('owner');

    // Second apply refused, nothing moves.
    const after = S.fingerprint(db);
    const second = await applySwitchover(db, { confirm: CONFIRM_PHRASE, backupDir: path.join(dir, 'backups') });
    expect(second).toMatchObject({ ok: false, status: 409, code: 'ALREADY_APPLIED' });
    expect(S.fingerprint(db)).toEqual(after);
    // ...and preview now says so, and finds nothing left to do.
    const p2 = previewSwitchover(db);
    expect(p2.already_applied).toBe(true);
    expect(p2.totals).toMatchObject({ retyped: 0, policy_changed: 0, offsets: 0, cl_openings_changed: 0 });
    cleanup();
  });

  test('offsets mirror the originals, net to zero per (employee, type, month), and read as manual', async () => {
    const { db, dir, cleanup } = S.newFileDb();
    seed(db);
    await applySwitchover(db, { confirm: CONFIRM_PHRASE, backupDir: path.join(dir, 'b') });
    const originals = db.prepare('SELECT * FROM leave_transactions WHERE id IN (1, 2, 3) ORDER BY id').all();
    expect(originals.map((o) => [o.id, o.transaction_type, o.days])).toEqual([[1, 'Credit', 10], [2, 'Credit', 3], [3, 'Credit', 9]]);
    for (const o of originals) {
      const off = db.prepare('SELECT * FROM leave_transactions WHERE reason = ?').get(offsetReason(o.id));
      expect(off).toMatchObject({
        employee_id: o.employee_id, employee_code: o.employee_code, company: o.company, leave_type: o.leave_type,
        transaction_type: 'Debit', days: o.days, reference_month: o.reference_month, reference_year: o.reference_year,
      });
    }
    const net = db.prepare(`
      SELECT employee_code, leave_type, reference_month,
             SUM(CASE transaction_type WHEN 'Credit' THEN days ELSE -days END) AS n
      FROM leave_transactions WHERE id <> 4 GROUP BY 1, 2, 3
    `).all();
    expect(net.every((r) => r.n === 0)).toBe(true);
    const { finance } = partitionTransactions(db, YEAR, ['19954', '23700']);
    expect(finance.map((t) => t.reason).filter((r) => /switchover/.test(r))).toEqual([]);
    const plan = computeLeavePlan(db, { year: YEAR });
    expect(plan.employees.find((x) => x.employee_code === '19954').el.adjustments).toBe(0);
    expect(plan.employees.find((x) => x.employee_code === '23700').cl.adjustments).toBe(0);
    expect(plan.employees.find((x) => x.employee_code === '23700').el.adjustments).toBe(-1); // #4 untouched
    cleanup();
  });

  test('a transaction id that is not the ruled row is skipped, not offset', async () => {
    const { db, dir, cleanup } = S.newFileDb();
    const a = S.addEmp(db, '19954', 'Worker');
    const b = S.addEmp(db, '23700', 'SILP');
    S.addTxnWithId(db, 1, a, { leave_type: 'EL', days: 7 }); // wrong days
    S.addTxnWithId(db, 3, b, { leave_type: 'EL', days: 9 });
    const out = await applySwitchover(db, { confirm: CONFIRM_PHRASE, backupDir: path.join(dir, 'b') });
    const by = Object.fromEntries(out.offsets.map((o) => [o.offsets_txn_id, o]));
    expect(by[1].status).toBe('skipped');
    expect(by[1].reason).toMatch(/not the ruled 19954 EL Credit 10/);
    expect(by[2]).toMatchObject({ status: 'skipped', reason: 'Transaction #2 not found' });
    expect(by[3].status).toBe('added');
    expect(db.prepare("SELECT COUNT(*) c FROM leave_transactions WHERE transaction_type = 'Debit'").get().c).toBe(1);
    cleanup();
  });

  test('refuses an in-memory database (nothing to back up)', async () => {
    const db = F.newDb();
    const out = await applySwitchover(db, { confirm: CONFIRM_PHRASE });
    expect(out).toMatchObject({ ok: false, code: 'NO_BACKUP_TARGET' });
    expect(policy(db, GUARD_KEY)).toBeNull();
    db.close();
  });

  test('a failed backup aborts before any change', async () => {
    const { db, dir, cleanup } = S.newFileDb();
    seed(db);
    const before = S.fingerprint(db);
    const blocker = path.join(dir, 'not-a-dir');
    fs.writeFileSync(blocker, 'x');
    const out = await applySwitchover(db, { confirm: CONFIRM_PHRASE, backupDir: path.join(blocker, 'backups') });
    expect(out).toMatchObject({ ok: false, code: 'BACKUP_FAILED' });
    expect(S.fingerprint(db)).toEqual(before);
    cleanup();
  });
});

describe('double-count flag (amendment A)', () => {
  test('grants and an in-app leave correction in the same month are flagged, and apply still runs', async () => {
    const { db, dir, cleanup } = S.newFileDb();
    const a = S.addEmp(db, '23725', 'Permanent');
    const b = S.addEmp(db, '23700', 'SILP');
    F.addExternalGrant(db, a, { month: 8, leave_type: 'EL', days: 5 });
    F.addExternalGrant(db, a, { month: 8, leave_type: 'CL', days: 2 });
    F.addExternalGrant(db, b, { month: 7, leave_type: 'EL', days: 1 }); // correction is in Aug, not Jul
    const ap = db.prepare(`INSERT INTO attendance_processed (employee_code, date, month, year, company, status_original, status_final, correction_source)
                           VALUES (?, ?, 8, 2026, ?, 'A', ?, 'leave_correction')`);
    ap.run('23725', '2026-08-17', a.company, 'EL');
    ap.run('23725', '2026-08-27', a.company, 'CL');
    ap.run('23700', '2026-08-31', b.company, 'EL');

    const out = previewSwitchover(db);
    expect(out.double_count_flags).toEqual([{ code: '23725', year: 2026, month: 8, text: doubleCountText(8, 2026) }]);
    expect(out.totals.double_count_flags).toBe(1);
    expect(out.employees.find((x) => x.code === '23725').reasons).toContain(
      'Possible double count: outside-app leave uploaded for 8/2026 and the app also has leave corrections that month. Confirm with HR before applying.'
    );
    expect(out.employees.find((x) => x.code === '23700').reasons.join(' ')).not.toMatch(/double count/);

    const applied = await applySwitchover(db, { confirm: CONFIRM_PHRASE, backupDir: path.join(dir, 'b') });
    expect(applied.ok).toBe(true);
    expect(applied.totals.double_count_flags).toBe(1);
    cleanup();
  });
});

describe('routes', () => {
  const { startApi } = require('./helpers/apiHarness');
  let api;
  beforeAll(() => { api = startApi({ '/api/features': '../../routes/phase5' }); });
  afterAll(async () => { await api.close(); });

  test('preview and apply are admin only; apply needs the phrase; apply writes a backup under DATA_DIR', async () => {
    for (const role of ['hr', 'finance', 'viewer']) {
      expect((await api.request('GET', '/api/features/leave-switchover-2026/preview', { role })).status).toBe(403);
      expect((await api.request('POST', '/api/features/leave-switchover-2026/apply', { role, body: { confirm: CONFIRM_PHRASE } })).status).toBe(403);
    }
    const p = await api.request('GET', '/api/features/leave-switchover-2026/preview');
    expect(p.status).toBe(200);
    expect(p.body.success).toBe(true);
    expect(p.body.dry_run).toBe(true);

    const bad = await api.request('POST', '/api/features/leave-switchover-2026/apply', { body: { confirm: 'yes' } });
    expect(bad.status).toBe(400);

    const ok = await api.request('POST', '/api/features/leave-switchover-2026/apply', { body: { confirm: CONFIRM_PHRASE, note: 'route test' } });
    expect(ok.status).toBe(200);
    expect(ok.body.backup_path.startsWith(path.join(process.env.DATA_DIR, 'backups'))).toBe(true);
    expect(fs.existsSync(ok.body.backup_path)).toBe(true);

    const again = await api.request('POST', '/api/features/leave-switchover-2026/apply', { body: { confirm: CONFIRM_PHRASE } });
    expect(again.status).toBe(409);
  });
});
