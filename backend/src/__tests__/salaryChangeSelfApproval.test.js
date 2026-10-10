/**
 * P1-23 — the person who raised a salary change request never approves or
 * rejects it, admin included (owner ruling Q6, 11 Oct 2026). Real routers behind
 * the real requireAuth with real JWTs (jwtApiHarness). Fictional codes and money.
 */
const { startJwtApi } = require('./helpers/jwtApiHarness');
const S = require('./helpers/statutoryFixture');

const USERS = [
  { username: 'boss', role: 'admin' },
  { username: 'boss2', role: 'admin' },
  { username: 'fin1', role: 'finance' },
  { username: 'hr1', role: 'hr' },
];

let api; let db;
beforeAll(() => {
  api = startJwtApi({
    '/api/employees': '../../routes/employees',
    '/api/salary-input': '../../routes/salary-input',
  }, { users: USERS });
  db = api.db;
});
afterAll(() => api.close());

const SELF_MSG = 'You raised this request — ask another finance or admin user to decide it.';

function employee(code) {
  const e = S.plant(db, { code, gross_salary: 15000 });
  S.plantStructure(db, e, '2025-01-01', { gross_salary: 15000 });
  return e;
}

/** Everything a decision could change, to prove a refused call wrote nothing. */
function state(e, reqId) {
  return {
    structures: db.prepare('SELECT * FROM salary_structures WHERE employee_id = ? ORDER BY id').all(e.id),
    gross: db.prepare('SELECT gross_salary FROM employees WHERE id = ?').get(e.id).gross_salary,
    request: db.prepare('SELECT status, approved_by, approved_at FROM salary_change_requests WHERE id = ?').get(reqId),
    rejections: db.prepare("SELECT COUNT(*) n FROM finance_rejections WHERE source_table = 'salary_change_requests' AND source_record_id = ?").get(reqId).n,
  };
}

async function raise(as, code, gross = 18000) {
  const r = await api.request('POST', '/api/salary-input/request-change', {
    as, body: { employeeCode: code, reason: 'synthetic raise', newStructure: { basic: gross * 0.5, hra: gross * 0.2, other_allowances: gross * 0.3 } },
  });
  expect(r.status).toBe(200);
  return db.prepare("SELECT id FROM salary_change_requests WHERE employee_code = ? AND status = 'Pending' ORDER BY id DESC").get(code).id;
}

function insertRequest(e, requestedBy) {
  return Number(db.prepare(`INSERT INTO salary_change_requests (employee_id, employee_code, requested_by, old_gross, new_gross, old_structure, new_structure, reason, status)
    VALUES (?, ?, ?, 15000, 17000, '{}', ?, 't', 'Pending')`)
    .run(e.id, e.code, requestedBy, JSON.stringify({ gross_salary: 17000, basic: 8500, hra: 3400, other_allowances: 5100 })).lastInsertRowid);
}

const approve = (as, id) => api.request('PUT', `/api/salary-input/approve/${id}`, { as, body: { effectiveFrom: '2026-10-01' } });
const reject = (as, id) => api.request('PUT', `/api/salary-input/reject/${id}`, { as, body: { reason: 'synthetic reason' } });

describe('requester cannot decide their own salary change', () => {
  test('admin raises → admin approve 403 SELF_APPROVAL, nothing written', async () => {
    const e = employee('T9701');
    const id = await raise('boss', 'T9701');
    const before = state(e, id);
    const r = await approve('boss', id);
    expect(r.status).toBe(403);
    expect(r.body).toEqual({ success: false, code: 'SELF_APPROVAL', error: SELF_MSG });
    expect(state(e, id)).toEqual(before);
    expect(before.request.status).toBe('Pending');
  });

  test('admin raises → admin reject 403, no finance_rejections row, still Pending', async () => {
    const e = employee('T9702');
    const id = await raise('boss', 'T9702');
    const before = state(e, id);
    const r = await reject('boss', id);
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('SELF_APPROVAL');
    expect(state(e, id)).toEqual(before);
    expect(before.rejections).toBe(0);
  });

  test('requested_by stored with spaces / other case still blocks', async () => {
    const e = employee('T9703');
    const id = insertRequest(e, '  BOSS ');
    const before = state(e, id);
    expect((await approve('boss', id)).status).toBe(403);
    expect((await reject('boss', id)).status).toBe(403);
    expect(state(e, id)).toEqual(before);
  });

  test('request raised via Employee Master (PUT /employees/:code/salary) is blocked for its requester too', async () => {
    const e = employee('T9704');
    const r0 = await api.request('PUT', '/api/employees/T9704/salary', { as: 'boss', body: { gross_salary: 19000 } });
    expect(r0.body.pendingApproval).toBe(true);
    const id = db.prepare("SELECT id FROM salary_change_requests WHERE employee_code = 'T9704' AND status = 'Pending'").get().id;
    const before = state(e, id);
    expect((await approve('boss', id)).status).toBe(403);
    expect(state(e, id)).toEqual(before);
  });
});

describe('a second person still decides', () => {
  test('another admin approves → applied, approved_by = boss2', async () => {
    const e = employee('T9711');
    const id = await raise('boss', 'T9711');
    const r = await approve('boss2', id);
    expect(r.status).toBe(200);
    const s = state(e, id);
    expect(s.request).toMatchObject({ status: 'Approved', approved_by: 'boss2' });
    expect(s.gross).toBe(18000);
    expect(s.structures.find((x) => x.effective_from === '2026-10-01').gross_salary).toBe(18000);
  });

  test('finance approves an admin request; finance rejects another → archived', async () => {
    const e1 = employee('T9712');
    const id1 = await raise('boss', 'T9712');
    expect((await approve('fin1', id1)).status).toBe(200);
    expect(state(e1, id1).request.status).toBe('Approved');

    const e2 = employee('T9713');
    const id2 = await raise('boss', 'T9713');
    expect((await reject('fin1', id2)).status).toBe(200);
    const s2 = state(e2, id2);
    expect(s2.request).toMatchObject({ status: 'Rejected', approved_by: 'fin1' });
    expect(s2.rejections).toBe(1);
    expect(s2.gross).toBe(15000);
  });

  test('hr raises → hr approve still refused by the role guard (not SELF_APPROVAL); finance then approves', async () => {
    const e = employee('T9714');
    const id = await raise('hr1', 'T9714');
    const r = await approve('hr1', id);
    expect(r.status).toBe(403);
    expect(r.body.code).not.toBe('SELF_APPROVAL');
    expect(state(e, id).request.status).toBe('Pending');
    expect((await approve('fin1', id)).status).toBe(200);
  });

  test('legacy row with empty requested_by stays decidable', async () => {
    const e1 = employee('T9715');
    const id1 = insertRequest(e1, null);
    expect((await approve('fin1', id1)).status).toBe(200);
    const e2 = employee('T9716');
    const id2 = insertRequest(e2, '');
    expect((await reject('boss', id2)).status).toBe(200);
  });

  test('missing / processed request still 404 (before the self check)', async () => {
    expect((await approve('boss', 999999)).status).toBe(404);
    expect((await reject('boss', 999999)).status).toBe(404);
  });
});
