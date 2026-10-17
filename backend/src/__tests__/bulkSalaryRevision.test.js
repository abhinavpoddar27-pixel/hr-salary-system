/**
 * P5-04 — bulk salary revision (first approval kind on the P5-01 engine). MONEY.
 * Real routers (bulk, employees, salary-input) behind the REAL requireAuth with real JWTs, on a temp DB
 * built by initSchema(). Fictional codes (T95xx) and money only.
 */
const { startJwtApi } = require('./helpers/jwtApiHarness');
const S = require('./helpers/statutoryFixture');

let api; let db;
const KIND = 'salary-revision';
const EFF = '2026-11-01';

beforeAll(() => {
  api = startJwtApi({
    '/api/bulk': '../../routes/bulk',
    '/api/employees': '../../routes/employees',
    '/api/salary-input': '../../routes/salary-input',
  }, { users: [
    { username: 'hr1', role: 'hr' }, { username: 'fin1', role: 'finance' }, { username: 'fin2', role: 'finance' },
    { username: 'admin1', role: 'admin' }, { username: 'view1', role: 'viewer' },
  ] });
  db = api.db;
});
afterAll(() => api.close());
beforeEach(() => {
  db.exec(`DELETE FROM bulk_rows; DELETE FROM bulk_batches; DELETE FROM audit_log; DELETE FROM notifications;
    DELETE FROM salary_change_requests; DELETE FROM salary_computations; DELETE FROM salary_structures;
    DELETE FROM employees; DELETE FROM monthly_imports;`);
  db.exec('DROP TRIGGER IF EXISTS p504_fail');
});

let seq = 0;
const nextCode = () => `T95${String(++seq).padStart(2, '0')}`;
/** Active employee with a structure dated 2025-01-01 (fixture: conveyance 300 on top of the split). */
function person(gross = 20000, over = {}) {
  const e = S.plant(db, { code: nextCode(), gross_salary: gross, ...(over.emp || {}) });
  if (over.noStructure) return e;
  S.plantStructure(db, e, over.from || '2025-01-01', { gross_salary: gross, pf: 1, lwf: 1, pt: 1, pf_wage_ceiling: 15000, ...(over.struct || {}) });
  return e;
}
const preview = (rows, common = { effective_from: EFF }, as = 'hr1') => api.request('POST', `/api/bulk/${KIND}/preview`, { as, body: { common, rows } });
const submitGroup = (p, g, common = { effective_from: EFF }, as = 'hr1') => {
  const byNo = new Map(p.body.rows.map(r => [r.rowNo, r]));
  return api.request('POST', `/api/bulk/${KIND}/submit`, { as, body: {
    common, planHash: g.planHash, groupId: 'g1', groupIndex: g.index, groupSize: p.body.groups.length,
    rows: g.rowNos.map(n => byNo.get(n).__input),
  } });
};
/** Preview + submit every group. rows carry their own input; returns { ids, p }. */
async function send(rows, common = { effective_from: EFF }, as = 'hr1') {
  const p = await preview(rows, common, as);
  expect(p.status).toBe(200);
  // rows come back in order; attach the input that produced each one
  p.body.rows.forEach((r, i) => { r.__input = rows[i]; });
  const ids = [];
  for (const g of p.body.groups) {
    const s = await submitGroup(p, g, common, as);
    expect(s.status).toBe(200);
    ids.push(s.body.batchId);
  }
  return { ids, p };
}
const act = (id, what, as, body = {}) => api.request('POST', `/api/bulk/batches/${id}/${what}`, { as, body });
const latest = (e) => db.prepare('SELECT * FROM salary_structures WHERE employee_id = ? ORDER BY effective_from DESC, id DESC LIMIT 1').get(e.id);
const structs = (e) => db.prepare('SELECT * FROM salary_structures WHERE employee_id = ? ORDER BY effective_from, id').all(e.id);
const gross = (e) => db.prepare('SELECT gross_salary FROM employees WHERE id = ?').get(e.id).gross_salary;
const requests = (e) => db.prepare('SELECT * FROM salary_change_requests WHERE employee_code = ? ORDER BY id').all(e.code);
const strip = (r) => { const { id, employee_id, created_at, updated_at, ...rest } = r; return rest; };
const snapshotMoney = () => JSON.stringify({
  s: db.prepare('SELECT * FROM salary_structures ORDER BY id').all(),
  e: db.prepare('SELECT id, gross_salary, updated_at FROM employees ORDER BY id').all(),
  r: db.prepare('SELECT * FROM salary_change_requests ORDER BY id').all(),
});

describe('preview — modes, rounding, row checks', () => {
  test('gross mode and % mode (rounded to ₹1); components follow the stored split; conveyance kept', async () => {
    const a = person(20000); const b = person(18333);
    const p = await preview([{ code: a.code, new_gross: 22000 }, { code: b.code, pct: 7 }]);
    expect(p.status).toBe(200);
    const [ra, rb] = p.body.rows;
    expect(ra.state).toBe('warning'); // conveyance kept on top
    expect(ra.newGross).toBe(22000);
    expect(ra.delta).toBe(2000);
    expect(ra.new_basic).toBe(11000); expect(ra.new_hra).toBe(4400);
    expect(ra.new_conveyance).toBe(300);
    expect(ra.messages.join(' ')).toMatch(/Conveyance 300 kept/);
    expect(rb.newGross).toBe(Math.round(18333 * 1.07)); // 19616
    expect(rb.pct).toBe(7);
    expect(p.body.requiresApproval).toBe(true);
    expect(p.body.groups).toHaveLength(1);
  });

  test('errors, skipped, warnings', async () => {
    const ok = person(20000, { struct: { conveyance: 0, other_allowances: 6000 } });
    const left = person(20000, { emp: { status: 'Left' } });
    const same = person(25000);
    const pend = person(20000);
    db.prepare(`INSERT INTO salary_change_requests (employee_id, employee_code, requested_by, old_gross, new_gross, old_structure, new_structure, status)
      VALUES (?, ?, 'hr1', 20000, 21000, '{}', '{}', 'Pending')`).run(pend.id, pend.code);
    const later = person(20000, { from: '2026-12-01' });
    const noStruct = person(20000, { noStructure: true });
    const big = person(10000, { struct: { conveyance: 0, other_allowances: 3000 } });
    const p = await preview([
      { code: ok.code, new_gross: 21000, effective_from: '2026-11-15' },
      { code: 'T9999' , new_gross: 1000 },
      { code: left.code, new_gross: 21000 },
      { code: ok.code, pct: 5 }, // repeat → merged
      { code: same.code, new_gross: 25000 },
      { code: pend.code, new_gross: 21000 },
      { code: later.code, new_gross: 21000 },
      { code: noStruct.code, new_gross: 21000 },
      { code: big.code, pct: 30 },
      { code: nextCode(), new_gross: 1, pct: 1 },
    ]);
    const by = Object.fromEntries(p.body.rows.map(r => [r.code, r]));
    expect(by[ok.code].state).toBe('warning');
    expect(by[ok.code].messages.join(' ')).toMatch(/Not the 1st/);
    expect(by[ok.code].messages.join(' ')).toMatch(/Listed more than once/);
    expect(by.T9999.state).toBe('error');
    expect(by[left.code].messages.join(' ')).toMatch(/Not active/);
    expect(by[same.code].state).toBe('skipped');
    expect(by[pend.code].state).toBe('error');
    expect(by[pend.code].messages.join(' ')).toMatch(/already waiting for finance \(request #\d+\)/);
    expect(by[later.code].messages.join(' ')).toMatch(/already exists/);
    expect(by[noStruct.code].state).toBe('warning');
    expect(by[noStruct.code].messages.join(' ')).toMatch(/default split/);
    expect(by[big.code].messages.join(' ')).toMatch(/more than 25%/);
    expect(p.body.rows.filter(r => r.state === 'error').length).toBe(5);
  });

  test('a finalised month (Q-B5) is an error row; a past open month gets a re-run note', async () => {
    const a = person(20000); const b = person(20000);
    db.prepare("INSERT INTO monthly_imports (month, year, company, is_finalised) VALUES (11, 2026, 'X', 1)").run();
    db.prepare("INSERT INTO salary_computations (employee_code, month, year, company, gross_salary, net_salary) VALUES (?, 12, 2026, 'X', 20000, 19000)").run(b.code);
    const p = await preview([{ code: a.code, new_gross: 21000 }, { code: b.code, new_gross: 21000, effective_from: '2026-12-01' }]);
    expect(p.body.rows[0].state).toBe('error');
    expect(p.body.rows[0].messages.join(' ')).toMatch(/finalised/);
    expect(p.body.rows[1].state).not.toBe('error');
    expect(p.body.rows[1].messages.join(' ')).toMatch(/re-run Stage 7/);
  });

  test('roles: finance and viewer cannot check or send; no token 401', async () => {
    expect((await preview([{ code: 'T1', new_gross: 1 }], undefined, 'fin1')).status).toBe(403);
    expect((await preview([{ code: 'T1', new_gross: 1 }], undefined, 'view1')).status).toBe(403);
    expect((await api.request('POST', `/api/bulk/${KIND}/preview`, { body: {} })).status).toBe(401);
  });

  test('51 rows → split into groups of ≤ 50; one submit of 51 is refused', async () => {
    const people = Array.from({ length: 51 }, () => person(20000, { struct: { conveyance: 0, other_allowances: 6000 } }));
    const rows = people.map(e => ({ code: e.code, new_gross: 20500 }));
    const p = await preview(rows);
    expect(p.body.groups.map(g => g.applyCount)).toEqual([50, 1]);
    const r = await api.request('POST', `/api/bulk/${KIND}/submit`, { as: 'hr1', body: { common: { effective_from: EFF }, rows, planHash: p.body.groups[0].planHash } });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('BULK_ROW_LIMIT');
  });
});

describe('submit → approve', () => {
  test('submit writes no salary table; money total = Σ change; finance approves → structures, gross, requests, audit', async () => {
    const a = person(20000); const b = person(30000);
    const before = snapshotMoney();
    const { ids } = await send([{ code: a.code, new_gross: 22000 }, { code: b.code, pct: 10 }]);
    expect(snapshotMoney()).toBe(before);
    const bt = db.prepare('SELECT * FROM bulk_batches WHERE id = ?').get(ids[0]);
    expect(bt.status).toBe('submitted');
    expect(bt.money_total).toBe(2000 + 3000);

    const r = await act(ids[0], 'approve', 'fin1');
    expect(r.status).toBe(200);
    expect(gross(a)).toBe(22000); expect(gross(b)).toBe(33000);
    const la = latest(a);
    expect(la.effective_from).toBe(EFF);
    expect(la.gross_salary).toBe(22000);
    expect(la.basic).toBe(11000); expect(la.hra).toBe(4400); expect(la.conveyance).toBe(300);
    // R10: flags, pt and ceiling come from the row in force
    expect([la.pf_applicable, la.lwf_applicable, la.pt_applicable, la.pf_wage_ceiling]).toEqual([1, 1, 1, 15000]);
    const [req] = requests(a);
    expect(req.status).toBe('Approved');
    expect(req.requested_by).toBe('hr1');
    expect(req.approved_by).toBe('fin1');
    expect(req.reason).toMatch(new RegExp(`bulk batch #${ids[0]}`));
    const audit = db.prepare("SELECT * FROM audit_log WHERE stage = 'SALARY_REVISION_BULK' ORDER BY id").all();
    expect(audit).toHaveLength(6); // 3 per person
    expect(audit.map(x => x.table_name).sort()).toEqual(['employees', 'employees', 'salary_change_requests', 'salary_change_requests', 'salary_structures', 'salary_structures']);
    expect(audit.every(x => x.changed_by === 'fin1')).toBe(true);
    expect(db.prepare("SELECT COUNT(*) n FROM audit_log WHERE stage = 'BULK_APPROVE'").get().n).toBe(1);
  });

  test('parity: bulk approval writes the same structure + gross as the single Employee Master → Salary Input path', async () => {
    const a = person(20000); const b = person(20000);
    const { ids } = await send([{ code: a.code, new_gross: 23456 }]);
    expect((await act(ids[0], 'approve', 'fin1')).status).toBe(200);
    // single path for b: HR raises from Employee Master, finance approves with the same date
    const s = await api.request('PUT', `/api/employees/${b.code}/salary`, { as: 'hr1', body: { gross_salary: 23456 } });
    expect(s.body.pendingApproval).toBe(true);
    const [rq] = requests(b);
    const ap = await api.request('PUT', `/api/salary-input/approve/${rq.id}`, { as: 'fin1', body: { effectiveFrom: EFF } });
    expect(ap.status).toBe(200);
    expect(structs(a).map(strip)).toEqual(structs(b).map(strip));
    expect(gross(a)).toBe(gross(b));
    const ra = requests(a)[0]; const rb = requests(b)[0];
    expect(JSON.parse(ra.new_structure)).toEqual(JSON.parse(rb.new_structure));
    expect([ra.old_gross, ra.new_gross, ra.status, ra.approved_by]).toEqual([rb.old_gross, rb.new_gross, rb.status, rb.approved_by]);
  });

  test('same-date row is updated in place (action update)', async () => {
    const a = person(20000, { from: EFF });
    const { p, ids } = await send([{ code: a.code, new_gross: 21000 }]);
    expect(p.body.rows[0].action).toBe('update');
    expect((await act(ids[0], 'approve', 'fin1')).status).toBe(200);
    expect(structs(a)).toHaveLength(1);
    expect(latest(a).gross_salary).toBe(21000);
  });

  test('self-approval refused (admin who sent it cannot approve; another finance user can)', async () => {
    const a = person(20000);
    const { ids } = await send([{ code: a.code, new_gross: 21000 }], undefined, 'admin1');
    const r = await act(ids[0], 'approve', 'admin1');
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('SELF_APPROVAL');
    expect(gross(a)).toBe(20000);
    expect((await act(ids[0], 'approve', 'fin2')).status).toBe(200);
  });

  test('Q-B8: a single-path request raised after submit → approve refused, nothing written, batch stays submitted', async () => {
    const a = person(20000); const b = person(20000);
    const { ids } = await send([{ code: a.code, new_gross: 21000 }, { code: b.code, new_gross: 21000 }]);
    expect((await api.request('PUT', `/api/employees/${b.code}/salary`, { as: 'hr1', body: { gross_salary: 25000 } })).body.pendingApproval).toBe(true);
    const before = snapshotMoney();
    const r = await act(ids[0], 'approve', 'fin1');
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('BULK_ROW_ERROR');
    expect(r.body.rows.map(x => x.code)).toContain(b.code);
    expect(snapshotMoney()).toBe(before);
    expect(db.prepare('SELECT status FROM bulk_batches WHERE id = ?').get(ids[0]).status).toBe('submitted');
    expect((await act(ids[0], 'return', 'fin1', { note: 'decide the single request first' })).status).toBe(200);
  });

  test('a failure on the 2nd row of a batch → nothing written at all (R3)', async () => {
    const a = person(20000); const b = person(20000);
    const { ids } = await send([{ code: a.code, new_gross: 21000 }, { code: b.code, new_gross: 13013 }]);
    db.exec('CREATE TRIGGER p504_fail BEFORE INSERT ON salary_structures WHEN NEW.gross_salary = 13013 BEGIN SELECT RAISE(ABORT, \'forced\'); END');
    const before = snapshotMoney();
    const auditBefore = db.prepare('SELECT COUNT(*) n FROM audit_log').get().n;
    const r = await act(ids[0], 'approve', 'fin1');
    expect(r.status).toBe(500);
    expect(snapshotMoney()).toBe(before);
    expect(db.prepare('SELECT COUNT(*) n FROM audit_log').get().n).toBe(auditBefore);
    expect(db.prepare('SELECT status FROM bulk_batches WHERE id = ?').get(ids[0]).status).toBe('submitted');
  });

  test('a later-dated structure added after submit → approve refused', async () => {
    const a = person(20000); const b = person(20000);
    const { ids } = await send([{ code: a.code, new_gross: 21000 }, { code: b.code, new_gross: 21000 }]);
    S.plantStructure(db, a, '2026-12-01', { gross_salary: 20000 });
    const r = await act(ids[0], 'approve', 'fin1');
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('BULK_ROW_ERROR');
    expect(gross(a)).toBe(20000); expect(gross(b)).toBe(20000);
  });

  test('a finalised month after an earlier effective date also refuses the row (no retro change to a finalised month)', async () => {
    const a = person(20000); const b = person(20000);
    db.prepare("INSERT INTO monthly_imports (month, year, company, is_finalised) VALUES (12, 2026, 'X', 1)").run();
    const p = await preview([{ code: a.code, new_gross: 21000 }, { code: b.code, new_gross: 21000, effective_from: '2027-01-01' }]);
    expect(p.body.rows[0].state).toBe('error');
    expect(p.body.rows[0].messages.join(' ')).toMatch(/Dec 2026 is finalised/);
    expect(p.body.rows[1].state).not.toBe('error');
  });
});

describe('H1 — first open payroll month (planner ruling, supersedes Q-B3)', () => {
  const kind = () => require('../services/bulk/kinds/salaryRevision');
  test('(a) an effective month later than the first open month (Stage 7 rows, not finalised) is refused; equal is fine', async () => {
    const a = person(20000); const b = person(20000);
    db.prepare("INSERT INTO monthly_imports (month, year, company, is_finalised) VALUES (10, 2026, 'X', 0)").run();
    db.prepare("INSERT INTO salary_computations (employee_code, month, year, company, gross_salary, net_salary) VALUES ('T0000', 10, 2026, 'X', 1, 1)").run();
    const p = await preview([{ code: a.code, new_gross: 21000 }, { code: b.code, new_gross: 21000, effective_from: '2026-10-01' }]);
    expect(p.body.rows[0].state).toBe('error');
    expect(p.body.rows[0].messages.join(' ')).toMatch(/Effective month must be the first open payroll month \(Oct 2026\) — the app cannot hold a salary change for a later month/);
    expect(p.body.rows[1].state).not.toBe('error');
  });
  test('(a) an unfinalised month with Stage 7 rows only (no import row) also counts; finalised months do not', async () => {
    const a = person(20000);
    db.prepare("INSERT INTO monthly_imports (month, year, company, is_finalised) VALUES (8, 2026, 'X', 1)").run();
    db.prepare("INSERT INTO salary_computations (employee_code, month, year, company, gross_salary, net_salary) VALUES ('T0000', 8, 2026, 'X', 1, 1)").run();
    db.prepare("INSERT INTO salary_computations (employee_code, month, year, company, gross_salary, net_salary) VALUES ('T0000', 9, 2026, 'X', 1, 1)").run();
    expect(kind().firstOpenMonth(db)).toBe('2026-09-01');
    const p = await preview([{ code: a.code, new_gross: 21000 }]);
    expect(p.body.rows[0].messages.join(' ')).toMatch(/\(Sep 2026\)/);
  });
  test('(a) re-checked at approve: Stage 7 run for an earlier month after submit → approve refused, nothing written', async () => {
    const a = person(20000); const b = person(20000);
    const { ids } = await send([{ code: a.code, new_gross: 21000 }, { code: b.code, new_gross: 21000, effective_from: '2026-10-01' }]);
    db.prepare("INSERT INTO salary_computations (employee_code, month, year, company, gross_salary, net_salary) VALUES ('T0000', 10, 2026, 'X', 1, 1)").run();
    const before = snapshotMoney();
    const r = await act(ids[0], 'approve', 'fin1');
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('BULK_ROW_ERROR');
    expect(r.body.rows.map(x => x.code)).toEqual([a.code]);
    expect(snapshotMoney()).toBe(before);
  });
  test('(b) default effective date = 1st of the first open month; none → 1st of the current IST month', async () => {
    const a = person(20000);
    const istMonth = `${new Date(Date.now() + 330 * 60000).toISOString().slice(0, 7)}-01`;
    expect(kind().defaultEffectiveFrom(db)).toBe(istMonth);
    let d = await api.request('GET', '/api/bulk/salary-revision/defaults', { as: 'hr1' });
    expect(d.body.data).toEqual({ effective_from: istMonth, firstOpen: null });
    db.prepare("INSERT INTO monthly_imports (month, year, company, is_finalised) VALUES (9, 2026, 'X', 1)").run();
    db.prepare("INSERT INTO monthly_imports (month, year, company, is_finalised) VALUES (10, 2026, 'X', 0)").run();
    db.prepare("INSERT INTO monthly_imports (month, year, company, is_finalised) VALUES (11, 2026, 'X', 0)").run();
    db.prepare("INSERT INTO salary_computations (employee_code, month, year, company, gross_salary, net_salary) VALUES ('T0000', 9, 2026, 'X', 1, 1)").run();
    db.prepare("INSERT INTO salary_computations (employee_code, month, year, company, gross_salary, net_salary) VALUES ('T0000', 10, 2026, 'X', 1, 1)").run();
    db.prepare("INSERT INTO salary_computations (employee_code, month, year, company, gross_salary, net_salary) VALUES ('T0000', 11, 2026, 'X', 1, 1)").run();
    d = await api.request('GET', '/api/bulk/salary-revision/defaults', { as: 'hr1' });
    expect(d.body.data).toEqual({ effective_from: '2026-10-01', firstOpen: '2026-10-01' });
    expect((await api.request('GET', '/api/bulk/salary-revision/defaults', { as: 'fin1' })).status).toBe(403);
    const p = await preview([{ code: a.code, new_gross: 21000 }], {});
    expect(p.body.common.effective_from).toBe('2026-10-01');
    expect(p.body.rows[0].state).not.toBe('error');
  });
  test('(c) undo blocked by a Stage 7 re-run of an EARLIER open month after approval', async () => {
    const a = person(20000);
    db.prepare("INSERT INTO monthly_imports (month, year, company, is_finalised) VALUES (10, 2026, 'X', 0)").run();
    db.prepare("INSERT INTO salary_computations (employee_code, month, year, company, gross_salary, net_salary) VALUES (?, 10, 2026, 'X', 20000, 19000)").run(a.code);
    const { ids } = await send([{ code: a.code, new_gross: 21000 }], { effective_from: '2026-10-01' });
    expect((await act(ids[0], 'approve', 'fin1')).status).toBe(200);
    // a later-dated revision can't be made (H1 a), so "earlier month" = October re-run with the new master gross
    db.prepare("UPDATE salary_computations SET gross_salary = 21000, net_salary = 20000 WHERE employee_code = ? AND month = 10").run(a.code);
    const r = await act(ids[0], 'undo', 'fin2', { reason: 'wrong list' });
    expect(r.status).toBe(409);
    expect(r.body.rows[0].reason).toMatch(/Stage 7/);
  });
  test('(c) fingerprint covers months BEFORE the effective month too (rows added there block undo)', async () => {
    const a = person(20000);
    const id = (await send([{ code: a.code, new_gross: 21000 }])).ids[0];
    expect((await act(id, 'approve', 'fin1')).status).toBe(200);
    db.prepare("INSERT INTO salary_computations (employee_code, month, year, company, gross_salary, net_salary) VALUES (?, 9, 2026, 'X', 21000, 20000)").run(a.code);
    const r = await act(id, 'undo', 'fin2', { reason: 'wrong list' });
    expect(r.status).toBe(409);
    expect(r.body.rows[0].reason).toMatch(/Stage 7/);
  });
  test('Q-EM (a) an import-only unfinalised older month (no Stage 7 rows) is ignored', async () => {
    const a = person(20000);
    db.prepare("INSERT INTO monthly_imports (month, year, company, is_finalised) VALUES (4, 2025, 'X', 0)").run();
    db.prepare("INSERT INTO monthly_imports (month, year, company, is_finalised) VALUES (7, 2025, 'X', 0)").run();
    expect(kind().firstOpenMonth(db)).toBeNull();
    db.prepare("INSERT INTO monthly_imports (month, year, company, is_finalised) VALUES (11, 2026, 'X', 0)").run();
    db.prepare("INSERT INTO salary_computations (employee_code, month, year, company, gross_salary, net_salary) VALUES ('T0000', 11, 2026, 'X', 1, 1)").run();
    expect(kind().firstOpenMonth(db)).toBe('2026-11-01');
    const d = await api.request('GET', '/api/bulk/salary-revision/defaults', { as: 'hr1' });
    expect(d.body.data).toEqual({ effective_from: '2026-11-01', firstOpen: '2026-11-01' });
    const p = await preview([{ code: a.code, new_gross: 21000 }]);
    expect(p.body.rows[0].state).not.toBe('error');
  });
  test('Q-EM (b) Feb–Sep finalised, Oct has Stage 7 rows → first open = Oct 2026; 1 Nov refused, 1 Oct allowed', async () => {
    const a = person(20000); const b = person(20000);
    for (let m = 2; m <= 9; m++) {
      db.prepare("INSERT INTO monthly_imports (month, year, company, is_finalised) VALUES (?, 2026, 'X', 1)").run(m);
      db.prepare("INSERT INTO salary_computations (employee_code, month, year, company, gross_salary, net_salary) VALUES ('T0000', ?, 2026, 'X', 1, 1)").run(m);
    }
    db.prepare("INSERT INTO monthly_imports (month, year, company, is_finalised) VALUES (10, 2026, 'X', 0)").run();
    db.prepare("INSERT INTO salary_computations (employee_code, month, year, company, gross_salary, net_salary) VALUES ('T0000', 10, 2026, 'X', 1, 1)").run();
    db.prepare("INSERT INTO monthly_imports (month, year, company, is_finalised) VALUES (11, 2026, 'X', 0)").run();
    expect(kind().firstOpenMonth(db)).toBe('2026-10-01');
    const p = await preview([{ code: a.code, new_gross: 21000, effective_from: '2026-11-01' }, { code: b.code, new_gross: 21000, effective_from: '2026-10-01' }], { effective_from: '2026-10-01' });
    expect(p.body.rows[0].state).toBe('error');
    expect(p.body.rows[0].messages.join(' ')).toMatch(/first open payroll month \(Oct 2026\)/);
    expect(p.body.rows[1].state).not.toBe('error');
  });
  test('Q-EM (c) nothing open (every Stage 7 month finalised, imports only elsewhere) → 1st of the current IST month', async () => {
    const istMonth = `${new Date(Date.now() + 330 * 60000).toISOString().slice(0, 7)}-01`;
    db.prepare("INSERT INTO monthly_imports (month, year, company, is_finalised) VALUES (9, 2026, 'X', 1)").run();
    db.prepare("INSERT INTO salary_computations (employee_code, month, year, company, gross_salary, net_salary) VALUES ('T0000', 9, 2026, 'X', 1, 1)").run();
    db.prepare("INSERT INTO monthly_imports (month, year, company, is_finalised) VALUES (5, 2025, 'X', 0)").run();
    expect(kind().firstOpenMonth(db)).toBeNull();
    expect(kind().defaultEffectiveFrom(db)).toBe(istMonth);
  });
  test('(d) the not-the-1st warning says pay follows the gross for every month computed after approval', async () => {
    const a = person(20000, { struct: { conveyance: 0, other_allowances: 6000 } });
    const p = await preview([{ code: a.code, new_gross: 21000, effective_from: '2026-11-15' }]);
    expect(p.body.rows[0].messages.join(' ')).toMatch(/every month's salary computed from then on pays the new gross/);
  });
});

describe('undo (finance/admin, reason)', () => {
  async function applied(rows) {
    const { ids } = await send(rows);
    expect((await act(ids[0], 'approve', 'fin1')).status).toBe(200);
    return ids[0];
  }

  test('undo restores structures + gross exactly and marks the requests Reverted; hr cannot undo', async () => {
    const a = person(20000); const b = person(20000, { from: EFF });
    const beforeA = structs(a); const beforeB = structs(b);
    const empBefore = db.prepare('SELECT id, gross_salary, updated_at FROM employees WHERE id IN (?, ?) ORDER BY id').all(a.id, b.id);
    const id = await applied([{ code: a.code, new_gross: 21000 }, { code: b.code, new_gross: 22000 }]);
    expect((await act(id, 'undo', 'hr1', { reason: 'wrong list' })).status).toBe(403);
    const r = await act(id, 'undo', 'fin2', { reason: 'wrong list' });
    expect(r.status).toBe(200);
    expect(structs(a)).toEqual(beforeA);
    expect(structs(b)).toEqual(beforeB);
    expect(db.prepare('SELECT id, gross_salary, updated_at FROM employees WHERE id IN (?, ?) ORDER BY id').all(a.id, b.id)).toEqual(empBefore);
    expect(requests(a)[0].status).toBe('Reverted');
    expect(db.prepare("SELECT COUNT(*) n FROM audit_log WHERE stage = 'BULK_UNDO' AND table_name != 'bulk_batches'").get().n).toBe(6);
  });

  test('blocked after Stage 7 used the period', async () => {
    const a = person(20000);
    const id = await applied([{ code: a.code, new_gross: 21000 }]);
    db.prepare("INSERT INTO salary_computations (employee_code, month, year, company, gross_salary, net_salary) VALUES (?, 11, 2026, 'X', 21000, 20000)").run(a.code);
    const r = await act(id, 'undo', 'fin1', { reason: 'wrong list' });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('BULK_UNDO_BLOCKED');
    expect(r.body.rows[0].reason).toMatch(/Stage 7/);
    expect(gross(a)).toBe(21000);
  });

  test('blocked after a later change and when the month is finalised', async () => {
    const a = person(20000); const b = person(20000);
    const id1 = await applied([{ code: a.code, new_gross: 21000 }]);
    db.prepare("UPDATE employees SET gross_salary = 21500 WHERE id = ?").run(a.id);
    const r1 = await act(id1, 'undo', 'fin1', { reason: 'wrong list' });
    expect(r1.status).toBe(409);
    expect(r1.body.rows[0].reason).toMatch(/Gross in the employee master changed/);
    const id2 = await applied([{ code: b.code, new_gross: 21000 }]);
    db.prepare("INSERT INTO monthly_imports (month, year, company, is_finalised) VALUES (11, 2026, 'X', 1)").run();
    const r2 = await act(id2, 'undo', 'fin1', { reason: 'wrong list' });
    expect(r2.status).toBe(409);
    expect(r2.body.rows[0].reason).toMatch(/finalised/);
  });
});
