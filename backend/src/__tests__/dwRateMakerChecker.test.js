/**
 * G2 — DW rate change maker-checker: the person who proposed a rate change can never approve or reject it
 * (trimmed, case-insensitive; admin included — same rule as P1-23 / P5-01 SELF_APPROVAL).
 * Real requireAuth + JWTs, fictional contractors.
 */
const { startJwtApi } = require('./helpers/jwtApiHarness');

const BASE = '/api/daily-wage';
let api; let db; let n = 0;

beforeAll(() => {
  api = startJwtApi({ [BASE]: '../../routes/dailyWage' }, {
    users: [
      { username: 'admin1', role: 'admin' }, { username: 'admin2', role: 'admin' },
      { username: 'fin1', role: 'finance' }, { username: 'hr1', role: 'hr' },
    ],
  });
  db = api.db;
});
afterAll(() => api.close());

function setup({ proposedBy, effective = '2026-10-01' } = {}) {
  const cid = db.prepare(`INSERT INTO dw_contractors (contractor_name, current_daily_wage_rate, current_commission_rate)
    VALUES (?, 500, 20)`).run(`MC Gang ${++n}`).lastInsertRowid;
  db.prepare(`INSERT INTO dw_entries (contractor_id, entry_date, in_time, out_time, total_worker_count, wage_rate_applied,
    commission_rate_applied, total_wage_amount, total_commission_amount, total_liability, gate_entry_reference, status)
    VALUES (?, '2026-10-05', '08:00', '17:00', 3, 500, 20, 1500, 60, 1560, ?, 'hr_entered')`).run(cid, `MC-${n}`);
  const rid = db.prepare(`INSERT INTO dw_rate_history (contractor_id, old_wage_rate, new_wage_rate, old_commission_rate,
    new_commission_rate, effective_date, proposed_by) VALUES (?, 500, 600, 20, 25, ?, ?)`).run(cid, effective, proposedBy).lastInsertRowid;
  return { cid, rid };
}
const snap = (cid, rid) => JSON.stringify({
  h: db.prepare('SELECT * FROM dw_rate_history WHERE id = ?').get(rid),
  c: db.prepare('SELECT * FROM dw_contractors WHERE id = ?').get(cid),
  e: db.prepare('SELECT * FROM dw_entries WHERE contractor_id = ?').all(cid),
  a: db.prepare("SELECT COUNT(*) n FROM dw_audit_log").get().n,
});
const approve = (rid, as) => api.request('PUT', `${BASE}/rates/${rid}/approve`, { as });
const reject = (rid, as) => api.request('PUT', `${BASE}/rates/${rid}/reject`, { as, body: { remarks: 'not agreed' } });

test('admin proposes → same admin approve 403 SELF_APPROVAL, nothing written', async () => {
  const { cid, rid } = setup({ proposedBy: 'admin1' });
  const before = snap(cid, rid);
  const r = await approve(rid, 'admin1');
  expect(r.status).toBe(403);
  expect(r.body).toMatchObject({ success: false, code: 'SELF_APPROVAL' });
  expect(snap(cid, rid)).toBe(before);
});

test('admin proposes → same admin reject 403, nothing written', async () => {
  const { cid, rid } = setup({ proposedBy: 'admin1' });
  const before = snap(cid, rid);
  const r = await reject(rid, 'admin1');
  expect(r.status).toBe(403);
  expect(r.body.code).toBe('SELF_APPROVAL');
  expect(snap(cid, rid)).toBe(before);
});

test('case / space variant of the proposer is still refused', async () => {
  const { cid, rid } = setup({ proposedBy: '  ADMIN1 ' });
  const before = snap(cid, rid);
  expect((await approve(rid, 'admin1')).status).toBe(403);
  expect((await reject(rid, 'admin1')).status).toBe(403);
  expect(snap(cid, rid)).toBe(before);
});

test('a second admin approves an admin-raised change (and the G1 re-price runs)', async () => {
  const { cid, rid } = setup({ proposedBy: 'admin1' });
  const r = await approve(rid, 'admin2');
  expect(r.status).toBe(200);
  expect(r.body.repriced.count).toBe(1);
  expect(db.prepare('SELECT approval_status, approved_by FROM dw_rate_history WHERE id = ?').get(rid)).toEqual({ approval_status: 'approved', approved_by: 'admin2' });
  expect(db.prepare('SELECT total_liability FROM dw_entries WHERE contractor_id = ?').get(cid).total_liability).toBe(1875);
});

test('finance approves / rejects an hr proposal', async () => {
  const a = setup({ proposedBy: 'hr1' });
  expect((await approve(a.rid, 'fin1')).status).toBe(200);
  const b = setup({ proposedBy: 'hr1' });
  const r = await reject(b.rid, 'fin1');
  expect(r.status).toBe(200);
  expect(db.prepare('SELECT approval_status FROM dw_rate_history WHERE id = ?').get(b.rid).approval_status).toBe('rejected');
});

test('hr still refused by the role guard (not the self check)', async () => {
  const { rid } = setup({ proposedBy: 'hr1' });
  const r = await approve(rid, 'hr1');
  expect(r.status).toBe(403);
  expect(r.body.code).toBeUndefined();
});

test('legacy row with empty / NULL proposed_by stays decidable', async () => {
  const a = setup({ proposedBy: '' });
  expect((await approve(a.rid, 'admin1')).status).toBe(200);
  const b = setup({ proposedBy: null });
  expect((await reject(b.rid, 'admin1')).status).toBe(200);
});

test('unknown id → 404 and already-decided → 400 come before the self check', async () => {
  expect((await approve(999999, 'admin1')).status).toBe(404);
  const { rid } = setup({ proposedBy: 'admin1' });
  db.prepare("UPDATE dw_rate_history SET approval_status = 'approved' WHERE id = ?").run(rid);
  expect((await approve(rid, 'admin1')).status).toBe(400);
  expect((await reject(rid, 'admin1')).status).toBe(400);
});

test('a change proposed through the route records the proposer and blocks them', async () => {
  const cid = db.prepare(`INSERT INTO dw_contractors (contractor_name, current_daily_wage_rate, current_commission_rate)
    VALUES (?, 500, 20)`).run(`MC Gang ${++n}`).lastInsertRowid;
  const p = await api.request('POST', `${BASE}/contractors/${cid}/rates`, { as: 'admin1', body: { new_wage_rate: 600, new_commission_rate: 25, effective_date: '2026-10-01' } });
  expect(p.body.success).toBe(true);
  expect((await approve(p.body.id, 'admin1')).body.code).toBe('SELF_APPROVAL');
  expect((await approve(p.body.id, 'fin1')).status).toBe(200);
});
