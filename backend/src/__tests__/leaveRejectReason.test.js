/**
 * P1-06 — PUT /api/leaves/:id/reject stores the reason it is sent.
 * Real JWT auth (jwtApiHarness), real initSchema, fictional employee T9601.
 *
 * The screen used to send `{ rejection_reason, rejected_by }` while the route
 * reads `req.body.reason`, so every rejection was saved with ''. The screen now
 * sends `{ reason }`; these tests pin the route contract it relies on.
 */
const { startJwtApi } = require('./helpers/jwtApiHarness');

const BASE = '/api/leaves';
const USERS = [{ username: 'hr1', role: 'hr' }, { username: 'fin', role: 'finance' }, { username: 'vw', role: 'viewer' }];
let api; let db; let empId;

beforeAll(() => {
  api = startJwtApi({ [BASE]: '../../routes/leaves' }, { users: USERS });
  db = api.db;
  empId = db.prepare(`INSERT INTO employees (code, name, department, company, employment_type, status, date_of_joining, gross_salary)
    VALUES ('T9601', 'Test Person One', 'TESTING', 'Test Co', 'Permanent', 'Active', '2025-01-01', 20000)`).run().lastInsertRowid;
});
afterAll(() => api.close());

const pending = (start) => db.prepare(`INSERT INTO leave_applications (employee_id, employee_code, leave_type, start_date, end_date, days, reason, status)
  VALUES (?, 'T9601', 'CL', ?, ?, 1, 'family function', 'Pending')`).run(empId, start, start).lastInsertRowid;
const row = (id) => db.prepare('SELECT status, rejection_reason, approved_by FROM leave_applications WHERE id = ?').get(id);

test('hr rejects with { reason } — the reason is stored, rejecter from the login', async () => {
  const id = pending('2026-11-02');
  const r = await api.request('PUT', `${BASE}/${id}/reject`, { as: 'hr1', body: { reason: 'Peak dispatch week' } });
  expect(r.status).toBe(200);
  expect(row(id)).toEqual({ status: 'Rejected', rejection_reason: 'Peak dispatch week', approved_by: 'hr1' });
});

test('finance may reject too, and the reason is stored', async () => {
  const id = pending('2026-11-03');
  const r = await api.request('PUT', `${BASE}/${id}/reject`, { as: 'fin', body: { reason: 'No leave balance left' } });
  expect(r.status).toBe(200);
  expect(row(id)).toMatchObject({ status: 'Rejected', rejection_reason: 'No leave balance left', approved_by: 'fin' });
});

test('the old screen body { rejection_reason } stores an empty reason (why the key matters)', async () => {
  const id = pending('2026-11-04');
  const r = await api.request('PUT', `${BASE}/${id}/reject`, { as: 'hr1', body: { rejection_reason: 'Peak dispatch week', rejected_by: 'someone' } });
  expect(r.status).toBe(200);
  expect(row(id)).toMatchObject({ status: 'Rejected', rejection_reason: '', approved_by: 'hr1' });
});

test('a viewer cannot reject (403), anonymous gets 401; the row stays Pending', async () => {
  const id = pending('2026-11-05');
  expect((await api.request('PUT', `${BASE}/${id}/reject`, { as: 'vw', body: { reason: 'Not allowed here' } })).status).toBe(403);
  expect((await api.request('PUT', `${BASE}/${id}/reject`, { body: { reason: 'Not allowed here' } })).status).toBe(401);
  expect(row(id)).toMatchObject({ status: 'Pending', rejection_reason: null });
});

test('GET /api/leaves returns rejection_reason and approved_by (the list reads them)', async () => {
  const r = await api.request('GET', `${BASE}?status=Rejected`, { as: 'hr1' });
  expect(r.status).toBe(200);
  const rows = r.body.data || r.body;
  const hit = rows.find((x) => x.rejection_reason === 'Peak dispatch week');
  expect(hit).toMatchObject({ status: 'Rejected', approved_by: 'hr1', employee_code: 'T9601' });
});
