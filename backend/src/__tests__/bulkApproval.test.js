/**
 * P5-01 — bulk engine approval stage. Real routers behind the REAL requireAuth with real JWTs, on a temp
 * DB built by initSchema(). Uses the TEST-ONLY kind 'test-approval' (registered because BULK_TEST_KINDS=1
 * is set before the engine loads). Fictional codes only.
 */
process.env.BULK_TEST_KINDS = '1';
const { startJwtApi } = require('./helpers/jwtApiHarness');

let api; let db;
const KIND = 'test-approval';
const preview = (rows, as = 'hr1', common = { note: 'test' }) => api.request('POST', `/api/bulk/${KIND}/preview`, { as, body: { common, rows } });
const submit = (rows, planHash, as = 'hr1', extra = {}, common = { note: 'test' }) =>
  api.request('POST', `/api/bulk/${KIND}/submit`, { as, body: { common, rows, planHash, ...extra } });
const act = (id, what, as, body = {}) => api.request('POST', `/api/bulk/batches/${id}/${what}`, { as, body });
const rowsOf = (n, from = 9501, amount = 100) => Array.from({ length: n }, (_, i) => ({ code: `T${from + i}`, amount: amount + i }));

/** Preview then submit every group; returns batch ids. */
async function sendAll(rows, as = 'hr1') {
  const p = await preview(rows, as);
  expect(p.status).toBe(200);
  const byNo = new Map(p.body.rows.map(r => [r.rowNo, r]));
  const ids = [];
  for (const g of p.body.groups) {
    const r = await submit(g.rowNos.map(n => ({ code: byNo.get(n).code, amount: byNo.get(n).amount })), g.planHash, as,
      { groupId: 'g1', groupIndex: g.index, groupSize: p.body.groups.length });
    expect(r.status).toBe(200);
    ids.push(r.body.batchId);
  }
  return ids;
}
const target = () => db.prepare('SELECT * FROM bulk_test_target ORDER BY code').all();
const batch = (id) => db.prepare('SELECT * FROM bulk_batches WHERE id = ?').get(id);
const audits = (stage) => db.prepare('SELECT * FROM audit_log WHERE stage = ? ORDER BY id').all(stage);

beforeAll(() => {
  api = startJwtApi({ '/api/bulk': '../../routes/bulk' }, { users: [
    { username: 'hr1', role: 'hr' }, { username: 'hr2', role: 'hr' }, { username: 'fin1', role: 'finance' },
    { username: 'fin2', role: 'finance' }, { username: 'admin1', role: 'admin' }, { username: 'admin2', role: 'admin' },
    { username: 'view1', role: 'viewer' },
  ] });
  db = api.db;
  db.exec('CREATE TABLE IF NOT EXISTS bulk_test_target (id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL UNIQUE, amount REAL NOT NULL, requested_by TEXT, approved_by TEXT, note TEXT)');
});
afterAll(() => api.close());
beforeEach(() => {
  db.exec('DELETE FROM bulk_test_target; DELETE FROM bulk_rows; DELETE FROM bulk_batches; DELETE FROM audit_log; DELETE FROM notifications;');
});

describe('schema', () => {
  test('approval columns exist (added-if-missing)', () => {
    const cols = db.prepare('PRAGMA table_info(bulk_batches)').all().map(c => c.name);
    for (const c of ['submitted_by', 'submitted_at', 'approved_by', 'approved_at', 'decided_by', 'decided_at', 'reject_reason', 'return_note', 'money_total']) {
      expect(cols).toContain(c);
    }
    require('../database/bulkSchema').initBulkSchema(db); // second run is a no-op
  });
});

describe('submit', () => {
  test('saves as submitted, applies nothing, audits, notifies finance once', async () => {
    const [id] = await sendAll(rowsOf(3));
    const b = batch(id);
    expect(b.status).toBe('submitted');
    expect(b.submitted_by).toBe('hr1');
    expect(b.money_total).toBe(100 + 101 + 102);
    expect(target()).toHaveLength(0);
    expect(db.prepare('SELECT COUNT(*) n FROM bulk_rows WHERE batch_id = ?').get(id).n).toBe(3);
    expect(audits('BULK_SUBMIT')).toHaveLength(1);
    const n = db.prepare("SELECT * FROM notifications WHERE type = 'BULK_SUBMITTED'").all();
    expect(n).toHaveLength(1);
    expect(n[0].role_target).toBe('finance');
    expect(n[0].link).toBe('/finance-verification?tab=bulk');
  });
  test('apply on an approval kind is refused; preview says requiresApproval', async () => {
    const p = await preview(rowsOf(1));
    expect(p.body.requiresApproval).toBe(true);
    const r = await api.request('POST', `/api/bulk/${KIND}/apply`, { as: 'hr1', body: { common: { note: 'test' }, rows: rowsOf(1), planHash: p.body.groups[0].planHash } });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('BULK_NEEDS_APPROVAL');
  });
  test('submit on a direct kind is refused', async () => {
    const r = await api.request('POST', '/api/bulk/extra-duty/submit', { as: 'hr1', body: { common: { grant_date: '2026-09-23', verification_source: 'Gate Register' }, rows: ['T1'], planHash: 'x' } });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('BULK_NO_APPROVAL_STAGE');
  });
  test('error rows and a changed plan are refused at submit', async () => {
    const p = await preview([{ code: 'T9501', amount: 0 }, { code: 'T9502', amount: 5 }]);
    const r = await submit([{ code: 'T9501', amount: 0 }, { code: 'T9502', amount: 5 }], p.body.groups[0].planHash);
    expect(r.status).toBe(409); expect(r.body.code).toBe('BULK_ROW_ERROR');
    const p2 = await preview([{ code: 'T9502', amount: 5 }]);
    db.prepare("INSERT INTO bulk_test_target (code, amount) VALUES ('T9502', 1)").run();
    const r2 = await submit([{ code: 'T9502', amount: 5 }], p2.body.groups[0].planHash);
    expect(r2.status).toBe(409); expect(r2.body.code).toBe('BULK_PLAN_CHANGED');
    expect(db.prepare('SELECT COUNT(*) n FROM bulk_batches').get().n).toBe(0);
  });
  test('cap: 51 applicable rows refused in one batch; 109 → 3 groups → 3 submitted batches sharing a group id', async () => {
    const p = await preview(rowsOf(51));
    const all = p.body.rows.map(r => ({ code: r.code, amount: r.amount }));
    const r = await submit(all, p.body.groups[0].planHash);
    expect(r.status).toBe(400); expect(r.body.code).toBe('BULK_ROW_LIMIT');
    const ids = await sendAll(rowsOf(109));
    expect(ids).toHaveLength(3);
    const rows = db.prepare('SELECT group_id, row_count, status FROM bulk_batches ORDER BY id').all();
    expect(rows.map(x => x.row_count)).toEqual([50, 50, 9]);
    expect(new Set(rows.map(x => x.group_id))).toEqual(new Set(['g1']));
    expect(rows.every(x => x.status === 'submitted')).toBe(true);
  });
});

describe('approve / reject / return', () => {
  test('finance approves → applied; rows written with requester + approver; audits', async () => {
    const [id] = await sendAll(rowsOf(4));
    const r = await act(id, 'approve', 'fin1');
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('applied');
    const b = batch(id);
    expect(b.status).toBe('applied'); expect(b.approved_by).toBe('fin1'); expect(b.applied_at).toBeTruthy();
    const t = target();
    expect(t).toHaveLength(4);
    expect(t.every(x => x.requested_by === 'hr1' && x.approved_by === 'fin1')).toBe(true);
    expect(db.prepare('SELECT COUNT(*) n FROM bulk_rows WHERE batch_id = ? AND target_id IS NOT NULL').get(id).n).toBe(4);
    expect(audits('BULK_APPROVE')).toHaveLength(1);
    expect(db.prepare("SELECT COUNT(*) n FROM notifications WHERE type = 'BULK_APPROVED'").get().n).toBe(1);
  });
  test('self-approval refused for admin too (case-insensitive); another admin succeeds', async () => {
    const [id] = await sendAll(rowsOf(2), 'admin1');
    db.prepare("UPDATE bulk_batches SET created_by = ' ADMIN1 ' WHERE id = ?").run(id);
    for (const what of ['approve', 'reject', 'return']) {
      const r = await act(id, what, 'admin1', { reason: 'some reason', note: 'some note' });
      expect(r.status).toBe(403);
      expect(r.body.code).toBe('SELF_APPROVAL');
    }
    expect(target()).toHaveLength(0);
    expect(batch(id).status).toBe('submitted');
    expect((await act(id, 'approve', 'admin2')).status).toBe(200);
    expect(target()).toHaveLength(2);
  });
  test('role guard: hr / viewer cannot decide; finance cannot create; viewer cannot list', async () => {
    const [id] = await sendAll(rowsOf(1));
    for (const as of ['hr1', 'hr2', 'view1']) {
      for (const what of ['approve', 'reject', 'return']) {
        expect((await act(id, what, as, { reason: 'some reason' })).status).toBe(403);
      }
    }
    for (const as of ['fin1', 'view1']) {
      expect((await preview(rowsOf(1), as)).status).toBe(403);
      expect((await submit(rowsOf(1), 'x', as)).status).toBe(403);
    }
    expect((await api.request('GET', '/api/bulk/batches', { as: 'view1' })).status).toBe(403);
    expect((await api.request('GET', `/api/bulk/batches/${id}`, { as: 'view1' })).status).toBe(403);
    expect((await api.request('POST', `/api/bulk/batches/${id}/approve`, {})).status).toBe(401);
    expect(batch(id).status).toBe('submitted');
  });
  test('data changed between submit and approve → 409, nothing written, still submitted', async () => {
    const [id] = await sendAll(rowsOf(3));
    db.prepare("INSERT INTO bulk_test_target (code, amount) VALUES ('T9502', 7)").run();
    const r = await act(id, 'approve', 'fin1');
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('BULK_PLAN_CHANGED');
    expect(r.body.error).toMatch(/Return it/);
    expect(target()).toHaveLength(1);
    expect(batch(id).status).toBe('submitted');
    expect(audits('BULK_APPROVE')).toHaveLength(0);
  });
  test('all-or-nothing: a throw on row 37 of 40 writes nothing (no rows, no audit), batch stays submitted', async () => {
    const rows = rowsOf(40);
    rows[36].amount = 13013;
    const [id] = await sendAll(rows);
    await expect(Promise.resolve(act(id, 'approve', 'fin1'))).resolves.toHaveProperty('status', 500);
    expect(target()).toHaveLength(0);
    expect(batch(id).status).toBe('submitted');
    expect(audits('BULK_APPROVE')).toHaveLength(0);
    expect(db.prepare('SELECT COUNT(*) n FROM bulk_rows WHERE batch_id = ? AND target_id IS NOT NULL').get(id).n).toBe(0);
  });
  test('reject needs ≥ 5 characters; reject and return store reason/note; decided batches cannot be approved', async () => {
    const [a, b] = await sendAll([...rowsOf(1, 9501)]).then(async (x) => [x[0], (await sendAll(rowsOf(1, 9601)))[0]]);
    expect((await act(a, 'reject', 'fin1', { reason: 'nope' })).status).toBe(400);
    expect((await act(a, 'reject', 'fin1', { reason: '  no gate entry  ' })).status).toBe(200);
    expect(batch(a).status).toBe('rejected'); expect(batch(a).reject_reason).toBe('no gate entry'); expect(batch(a).decided_by).toBe('fin1');
    expect((await act(b, 'return', 'fin1', { note: 'abc' })).status).toBe(400);
    expect((await act(b, 'return', 'fin1', { note: 'wrong amounts' })).status).toBe(200);
    expect(batch(b).status).toBe('returned'); expect(batch(b).return_note).toBe('wrong amounts');
    for (const id of [a, b]) {
      const r = await act(id, 'approve', 'fin2');
      expect(r.status).toBe(409); expect(r.body.code).toBe('BULK_NOT_SUBMITTED');
    }
    expect(target()).toHaveLength(0);
    expect(audits('BULK_REJECT')).toHaveLength(1);
    expect(audits('BULK_RETURN')).toHaveLength(1);
    expect(db.prepare("SELECT COUNT(*) n FROM notifications WHERE type IN ('BULK_REJECTED','BULK_RETURNED') AND role_target = 'hr'").get().n).toBe(2);
  });
  test('double approve: the second call gets 409, nothing applied twice', async () => {
    const [id] = await sendAll(rowsOf(2));
    const [r1, r2] = await Promise.all([act(id, 'approve', 'fin1'), act(id, 'approve', 'fin2')]);
    expect([r1.status, r2.status].sort()).toEqual([200, 409]);
    expect(target()).toHaveLength(2);
    expect(audits('BULK_APPROVE')).toHaveLength(1);
  });
  test('unknown / bad batch id', async () => {
    expect((await act(99999, 'approve', 'fin1')).status).toBe(404);
    expect((await act('abc', 'approve', 'fin1')).status).toBe(400);
  });
});

describe('undo (Q-A2) and reads', () => {
  test('undo of an applied approval batch: finance/admin with reason; hr refused; blocked when moved on', async () => {
    const [id] = await sendAll(rowsOf(2));
    expect((await api.request('POST', `/api/bulk/batches/${id}/undo`, { as: 'fin1', body: { reason: 'too early' } })).body.code).toBe('BULK_NOT_UNDOABLE');
    await act(id, 'approve', 'fin1');
    expect((await api.request('POST', `/api/bulk/batches/${id}/undo`, { as: 'hr1', body: { reason: 'wrong batch' } })).status).toBe(403);
    expect((await api.request('POST', `/api/bulk/batches/${id}/undo`, { as: 'fin2', body: { reason: 'abc' } })).status).toBe(400);
    db.prepare("UPDATE bulk_test_target SET note = 'edited' WHERE code = 'T9501'").run();
    const blocked = await api.request('POST', `/api/bulk/batches/${id}/undo`, { as: 'fin2', body: { reason: 'wrong batch' } });
    expect(blocked.status).toBe(409); expect(blocked.body.code).toBe('BULK_UNDO_BLOCKED');
    db.prepare("UPDATE bulk_test_target SET note = 'test' WHERE code = 'T9501'").run();
    const ok = await api.request('POST', `/api/bulk/batches/${id}/undo`, { as: 'fin2', body: { reason: 'wrong batch' } });
    expect(ok.status).toBe(200);
    expect(target()).toHaveLength(0);
    expect(batch(id).status).toBe('undone');
  });
  test('lists: finance sees approval kinds only; status filter; hr sees its kinds; detail carries columns + note', async () => {
    const [a] = await sendAll(rowsOf(1, 9501));
    const [b] = await sendAll(rowsOf(1, 9601));
    await act(b, 'return', 'fin1', { note: 'check amounts' });
    const fin = await api.request('GET', '/api/bulk/batches?status=submitted,returned&sinceDays=30', { as: 'fin1' });
    expect(fin.status).toBe(200);
    expect(fin.body.data.map(x => x.id).sort()).toEqual([a, b].sort());
    expect(fin.body.data.every(x => x.kind === KIND && x.requiresApproval)).toBe(true);
    const sub = await api.request('GET', '/api/bulk/batches?status=submitted', { as: 'fin1' });
    expect(sub.body.data.map(x => x.id)).toEqual([a]);
    expect((await api.request('GET', '/api/bulk/batches?kind=extra-duty', { as: 'fin1' })).status).toBe(403);
    const hr = await api.request('GET', `/api/bulk/batches?kind=${KIND}`, { as: 'hr1' });
    const ret = hr.body.data.find(x => x.id === b);
    expect(ret.status).toBe('returned'); expect(ret.returnNote).toBe('check amounts'); expect(ret.decidedBy).toBe('fin1');
    const det = await api.request('GET', `/api/bulk/batches/${a}`, { as: 'fin1' });
    expect(det.status).toBe(200);
    expect(det.body.data.columns.map(c => c.key)).toEqual(['code', 'name', 'amountOld', 'amountNew']);
    expect(det.body.data.rows[0]).toMatchObject({ code: 'T9501', amountNew: 100 });
    expect(det.body.data.moneyTotal).toBe(100);
  });
});
