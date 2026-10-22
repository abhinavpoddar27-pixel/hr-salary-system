/**
 * Q-B6 (22 Oct 2026) — a gross change finance already approved (single request or bulk salary revision)
 * is not asked again in Manual Interventions. Real routers (finance-audit, salary-input, bulk) behind the real
 * requireAuth with real JWTs; real Stage 7 (computeEmployeeSalary + saveSalaryComputation) raises the flag.
 * Fictional codes (T94xx) and money only.
 */
const { startJwtApi } = require('./helpers/jwtApiHarness');
const S = require('./helpers/statutoryFixture');

let api; let db;
beforeAll(() => {
  api = startJwtApi({
    '/api/finance-audit': '../../routes/financeAudit',
    '/api/salary-input': '../../routes/salary-input',
    '/api/bulk': '../../routes/bulk',
  }, { users: [
    { username: 'hr1', role: 'hr' }, { username: 'fin1', role: 'finance' }, { username: 'fin2', role: 'finance' },
    { username: 'boss', role: 'admin' }, { username: 'view1', role: 'viewer' },
  ] });
  db = api.db;
});
afterAll(() => api.close());
beforeEach(() => {
  db.exec(`DELETE FROM bulk_rows; DELETE FROM bulk_batches; DELETE FROM audit_log; DELETE FROM finance_approvals;
    DELETE FROM finance_rejections; DELETE FROM salary_manual_flags; DELETE FROM salary_change_requests;
    DELETE FROM salary_computations; DELETE FROM day_calculations; DELETE FROM salary_structures;
    DELETE FROM employees; DELETE FROM monthly_imports; DELETE FROM notifications;`);
  // Aug 2026 is finalised → Sep 2026 is the first open payroll month (bulk revisions must be dated in it).
  db.prepare("INSERT INTO monthly_imports (month, year, company, is_finalised) VALUES (8, 2026, ?, 1)").run(S.COMPANY);
});

let seq = 0;
const nextCode = () => `T94${String(++seq).padStart(2, '0')}`;

/** Employee on ₹15,000 with Aug + Sep Stage 7 already run at the old gross. */
function person(gross = 15000) {
  const e = S.plant(db, { code: nextCode(), gross_salary: gross });
  S.plantStructure(db, e, '2025-01-01', { gross_salary: gross });
  S.plantMonth(db, e, 8, 2026); S.plantMonth(db, e, 9, 2026);
  S.computePlant(db, e, 8, 2026); S.computePlant(db, e, 9, 2026);
  return e;
}
/** A Pending request raised by `by` (HR) — what Salary Input / Employee Master write. */
function raise(e, newGross, by = 'hr1') {
  const latest = db.prepare('SELECT * FROM salary_structures WHERE employee_id = ? ORDER BY effective_from DESC LIMIT 1').get(e.id);
  const ns = { gross_salary: newGross, basic: newGross * 0.5, da: 0, hra: newGross * 0.2, conveyance: 300,
    special_allowance: 0, other_allowances: newGross * 0.3 - 300 };
  return Number(db.prepare(`INSERT INTO salary_change_requests (employee_id, employee_code, requested_by, old_gross, new_gross,
    old_structure, new_structure, reason, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'synthetic', 'Pending')`)
    .run(e.id, e.code, by, latest.gross_salary, newGross, JSON.stringify(latest), JSON.stringify(ns)).lastInsertRowid);
}
const approve = (id, as = 'fin1', effectiveFrom = '2026-09-01') => api.request('PUT', `/api/salary-input/approve/${id}`, { as, body: { effectiveFrom } });
const flagOf = (e, m = 9) => db.prepare("SELECT * FROM salary_manual_flags WHERE employee_code = ? AND month = ? AND year = 2026 AND flag_type = 'GROSS_STRUCTURE_CHANGE'").get(e.code, m);
const list = (as = 'fin1', m = 9) => api.request('GET', `/api/finance-audit/salary-manual-flags?month=${m}&year=2026`, { as });
const ready = (as = 'fin1', m = 9) => api.request('GET', `/api/finance-audit/readiness-check?month=${m}&year=2026`, { as });
const stage7 = (e, m = 9) => S.computePlant(db, e, m, 2026);
const auditRows = (flagId) => db.prepare("SELECT stage, changed_by, remark FROM audit_log WHERE table_name = 'salary_manual_flags' AND record_id = ? ORDER BY id").all(String(flagId));
const approvals = (flagId) => db.prepare('SELECT status, reviewed_by, comments FROM finance_approvals WHERE flag_id = ? ORDER BY id').all(flagId);
const drift = () => db.prepare('SELECT COUNT(*) n FROM salary_computations WHERE month = 9 AND year = 2026 AND ABS(net_salary-(gross_earned-total_deductions))>1').get().n;
const grossPending = (m = 9) => db.prepare("SELECT COUNT(*) n FROM salary_manual_flags WHERE month = ? AND year = 2026 AND finance_approved = 0 AND flag_type = 'GROSS_STRUCTURE_CHANGE'").get(m).n;
const smfPending = (m = 9) => db.prepare("SELECT COUNT(*) n FROM salary_manual_flags WHERE month = ? AND year = 2026 AND finance_approved = 0 AND flag_type NOT IN ('PUNCH_CORRECTION','DAY_CORRECTION')").get(m).n;

/** Single path: HR raises, fin1 approves, Stage 7 re-run raises the flag. */
async function approvedChange(newGross = 18000, { by = 'hr1', approver = 'fin1' } = {}) {
  const e = person();
  const id = raise(e, newGross, by);
  const r = await approve(id, approver);
  expect(r.status).toBe(200);
  stage7(e);
  const f = flagOf(e);
  expect(f).toBeTruthy();
  expect(f.finance_approved).toBe(0); // Stage 7 writes it pending, as before
  return { e, id, f };
}

describe('single approved salary change — stamped, not asked again', () => {
  test('list read stamps it with the original approver, request named, audit row', async () => {
    const { id, f } = await approvedChange();
    const r = await list();
    expect(r.status).toBe(200);
    const row = r.body.data.find((x) => x.id === f.id);
    expect(row.finance_approved).toBe(1);
    expect(row.approved_by).toBe('fin1');
    expect(row.preapproved).toEqual({ request_id: id, batch_id: null, approved_by: 'fin1' });
    expect(r.body.data.filter((x) => x.flag_type === 'GROSS_STRUCTURE_CHANGE' && x.finance_approved === 0)).toHaveLength(0);
    expect(approvals(f.id)).toEqual([expect.objectContaining({ status: 'APPROVED', reviewed_by: 'fin1' })]);
    expect(approvals(f.id)[0].comments).toMatch(new RegExp(`^\\[auto req #${id}\\] Approved with salary change request #${id} by fin1`));
    const a = auditRows(f.id);
    expect(a).toHaveLength(1);
    expect(a[0].stage).toBe('FLAG_PREAPPROVED');
    expect(a[0].remark).toMatch(/requested by hr1/);
    expect(drift()).toBe(0);
  });

  test('readiness read stamps too: no UNAPPROVED_MANUAL_FLAGS blocker', async () => {
    await approvedChange();
    const r = await ready();
    expect(r.status).toBe(200);
    // the blocker counts only what is still pending; the gross flag is no longer among them
    const blk = (r.body.blockers || r.body.data?.blockers || []).find((b) => b.type === 'UNAPPROVED_MANUAL_FLAGS');
    expect(grossPending()).toBe(0);
    expect(blk ? blk.count : 0).toBe(smfPending());
  });

  test('idempotent: a second read writes nothing', async () => {
    const { f } = await approvedChange();
    await list(); await list(); await ready();
    expect(approvals(f.id)).toHaveLength(1);
    expect(auditRows(f.id)).toHaveLength(1);
  });

  test('any role reading stamps it — still with the approver, never the reader', async () => {
    const { f } = await approvedChange();
    expect((await ready('view1')).status).toBe(200);
    const g = flagOf({ code: f.employee_code });
    expect(g.finance_approved).toBe(1);
    expect(g.approved_by).toBe('fin1');
  });

  test('Stage 7 re-run keeps the stamp (UPSERT never resets finance_approved)', async () => {
    const { e, f } = await approvedChange();
    await list();
    stage7(e); stage7(e);
    const g = flagOf(e);
    expect(g.id).toBe(f.id);
    expect(g.finance_approved).toBe(1);
    await list();
    expect(approvals(f.id)).toHaveLength(1);
    expect(auditRows(f.id)).toHaveLength(1);
  });

  test('gross moved to a value with no approved request → auto-approval withdrawn, back to pending', async () => {
    const { e, f } = await approvedChange(18000);
    await list();
    db.prepare('UPDATE employees SET gross_salary = 19500 WHERE id = ?').run(e.id); // legacy direct change, no request
    stage7(e);
    expect(flagOf(e).finance_approved).toBe(1); // Stage 7 kept the old approval on new values
    const r = await list();
    const row = r.body.data.find((x) => x.id === f.id);
    expect(row.finance_approved).toBe(0);
    expect(row.approved_by).toBeNull();
    expect(row.preapproved).toBeUndefined();
    expect(auditRows(f.id).map((x) => x.stage)).toEqual(['FLAG_PREAPPROVED', 'FLAG_PREAPPROVAL_WITHDRAWN']);
    expect(approvals(f.id).map((x) => x.status)).toEqual(['APPROVED', 'WITHDRAWN']);
    await list();
    expect(auditRows(f.id)).toHaveLength(2); // stays withdrawn, nothing more written
  });

  test('a newer approved request takes over → withdrawn and re-stamped for the new request', async () => {
    const { e, id, f } = await approvedChange(18000);
    await list();
    const id2 = raise(e, 20000);
    expect((await approve(id2, 'fin2')).status).toBe(200);
    stage7(e);
    const row = (await list()).body.data.find((x) => x.id === f.id);
    expect(row.finance_approved).toBe(1);
    expect(row.approved_by).toBe('fin2');
    expect(row.preapproved.request_id).toBe(id2);
    expect(id2).not.toBe(id);
    expect(auditRows(f.id).map((x) => x.stage)).toEqual(['FLAG_PREAPPROVED', 'FLAG_PREAPPROVAL_WITHDRAWN', 'FLAG_PREAPPROVED']);
  });

  test('finance reject of a stamped flag still puts the gross back exactly as today', async () => {
    const { e, id, f } = await approvedChange(18000);
    await list();
    const r = await api.request('PUT', `/api/finance-audit/approve-flag/${f.id}`, { as: 'fin2', body: { status: 'REJECTED', comments: 'synthetic reject' } });
    expect(r.status).toBe(200);
    expect(r.body.reverted).toBe(true);
    expect(db.prepare('SELECT gross_salary FROM employees WHERE id = ?').get(e.id).gross_salary).toBe(15000);
    expect(flagOf(e).finance_approved).toBe(-1);
    expect(db.prepare('SELECT status FROM salary_change_requests WHERE id = ?').get(id).status).toBe('Reverted');
    await list(); // a rejected flag is never stamped again
    expect(flagOf(e).finance_approved).toBe(-1);
  });

  test('a flag approved by hand is left alone even if values change', async () => {
    const { e, f } = await approvedChange(18000);
    // finance decides first, by hand (before any read stamps it)
    expect((await api.request('PUT', `/api/finance-audit/approve-flag/${f.id}`, { as: 'fin2', body: { status: 'APPROVED' } })).status).toBe(200);
    db.prepare('UPDATE employees SET gross_salary = 19500 WHERE id = ?').run(e.id);
    stage7(e);
    await list();
    expect(flagOf(e).finance_approved).toBe(1);
    expect(flagOf(e).approved_by).toBe('fin2');
    expect(auditRows(f.id).map((x) => x.stage)).toEqual(['FINANCE_FLAG_APPROVE']);
  });
});

describe('never stamped', () => {
  test('self-approved request (approver = requester, legacy row) stays pending', async () => {
    const e = person();
    const id = raise(e, 18000, 'boss');
    // the route refuses self-approval now; legacy prod rows exist — write the approval as it was stored
    db.prepare("UPDATE salary_change_requests SET status = 'Approved', approved_by = 'Boss ', approved_at = datetime('now') WHERE id = ?").run(id);
    db.prepare('UPDATE employees SET gross_salary = 18000 WHERE id = ?').run(e.id);
    stage7(e);
    await list(); await ready();
    expect(flagOf(e).finance_approved).toBe(0);
    expect(auditRows(flagOf(e).id)).toHaveLength(0);
  });

  test('approver not named (blank / system) stays pending', async () => {
    const e = person();
    const id = raise(e, 18000);
    db.prepare("UPDATE salary_change_requests SET status = 'Approved', approved_by = 'system', approved_at = datetime('now') WHERE id = ?").run(id);
    db.prepare('UPDATE employees SET gross_salary = 18000 WHERE id = ?').run(e.id);
    stage7(e);
    await list();
    expect(flagOf(e).finance_approved).toBe(0);
  });

  test('flag new gross ≠ approved request (> ₹1) stays pending', async () => {
    const e = person();
    const id = raise(e, 18000);
    expect((await approve(id)).status).toBe(200);
    db.prepare('UPDATE employees SET gross_salary = 18005 WHERE id = ?').run(e.id);
    stage7(e);
    await list();
    expect(flagOf(e).finance_approved).toBe(0);
  });

  test('no request at all (like the 3 Feb flags) stays pending', async () => {
    const e = person();
    db.prepare('UPDATE employees SET gross_salary = 18000 WHERE id = ?').run(e.id);
    stage7(e);
    await list();
    expect(flagOf(e).finance_approved).toBe(0);
  });

  test('finalised month is untouched (flag stays pending, nothing written)', async () => {
    const e = person();
    const id = raise(e, 18000);
    expect((await approve(id)).status).toBe(200);
    // a pending gross flag sitting in finalised August
    const fid = Number(db.prepare(`INSERT INTO salary_manual_flags (employee_code, month, year, flag_type, field_name, system_value, manual_value, delta, changed_by, notes)
      VALUES (?, 8, 2026, 'GROSS_STRUCTURE_CHANGE', 'gross_salary', 15000, 18000, 3000, 'system', 'synthetic')`).run(e.code).lastInsertRowid);
    expect((await list('fin1', 8)).status).toBe(200);
    expect((await ready('fin1', 8)).status).toBe(200);
    expect(db.prepare('SELECT finance_approved FROM salary_manual_flags WHERE id = ?').get(fid).finance_approved).toBe(0);
    expect(auditRows(fid)).toHaveLength(0);
    expect(approvals(fid)).toHaveLength(0);
  });

  test('other flag types are never stamped', async () => {
    const e = person();
    const fid = Number(db.prepare(`INSERT INTO salary_manual_flags (employee_code, month, year, flag_type, field_name, system_value, manual_value, delta, changed_by, notes)
      VALUES (?, 9, 2026, 'MANUAL_TDS', 'tds', 0, 500, 500, 'system', 'synthetic')`).run(e.code).lastInsertRowid);
    await list();
    expect(db.prepare('SELECT finance_approved FROM salary_manual_flags WHERE id = ?').get(fid).finance_approved).toBe(0);
  });
});

describe('bulk salary revision', () => {
  test('batch approved by fin1 → Stage 7 flag stamped with the batch number', async () => {
    const e = person();
    const common = { effective_from: '2026-09-01' };
    const p = await api.request('POST', '/api/bulk/salary-revision/preview', { as: 'hr1', body: { common, rows: [{ code: e.code, new_gross: 18000 }] } });
    expect(p.status).toBe(200);
    const g = p.body.groups[0];
    const s = await api.request('POST', '/api/bulk/salary-revision/submit', { as: 'hr1', body: {
      common, planHash: g.planHash, groupId: 'g1', groupIndex: g.index, groupSize: 1, rows: [{ code: e.code, new_gross: 18000 }] } });
    expect(s.status).toBe(200);
    const batchId = s.body.batchId;
    expect((await api.request('POST', `/api/bulk/batches/${batchId}/approve`, { as: 'fin1', body: {} })).status).toBe(200);
    stage7(e);
    const f = flagOf(e);
    expect(f.finance_approved).toBe(0);
    const row = (await list()).body.data.find((x) => x.id === f.id);
    expect(row.finance_approved).toBe(1);
    expect(row.approved_by).toBe('fin1');
    expect(row.preapproved.batch_id).toBe(batchId);
    expect(approvals(f.id)[0].comments).toMatch(new RegExp(`bulk batch #${batchId}\\) by fin1`));
    expect(drift()).toBe(0);
  });
});
