/**
 * P2-03 — POST /api/daily-wage/entries: "not in the future" is judged on the IST calendar.
 * The server clock is UTC; between 00:00 and 05:30 IST a UTC date is still yesterday, so
 * today's IST entry used to be refused as "in the future". Real JWT auth, fictional contractor.
 */
const { startJwtApi } = require('./helpers/jwtApiHarness');

const BASE = '/api/daily-wage';
let api; let db; let contractorId; let gate = 0;

beforeAll(() => {
  api = startJwtApi({ [BASE]: '../../routes/dailyWage' }, { users: [{ username: 'hr1', role: 'hr' }] });
  db = api.db;
  contractorId = db.prepare(`INSERT INTO dw_contractors (contractor_name, current_daily_wage_rate, current_commission_rate)
    VALUES ('Test Gang Alpha', 500, 20)`).run().lastInsertRowid;
});
afterEach(() => jest.restoreAllMocks());
afterAll(() => api.close());

const body = (entry_date) => ({
  contractor_id: contractorId, entry_date, in_time: '08:00', out_time: '17:00',
  total_worker_count: 2, gate_entry_reference: `GT-${++gate}`,
  department_allocations: [{ department: 'TESTING', worker_count: 2 }],
});
// The route reads the clock through Date.now(); pin it (the rest of the app keeps the real clock).
const at = (iso) => { jest.restoreAllMocks(); jest.spyOn(Date, 'now').mockReturnValue(Date.parse(iso)); };

test('00:30 IST on 11 Oct (19:00 UTC on 10 Oct): an entry dated 11 Oct is accepted', async () => {
  at('2026-10-10T19:00:00Z');
  const r = await api.request('POST', `${BASE}/entries`, { as: 'hr1', body: body('2026-10-11') });
  expect(r.body.success).toBe(true);
  expect(db.prepare("SELECT COUNT(*) n FROM dw_entries WHERE entry_date = '2026-10-11'").get().n).toBe(1);
});

test('00:30 IST on 11 Oct: an entry dated 12 Oct is still refused as the future', async () => {
  at('2026-10-10T19:00:00Z');
  const r = await api.request('POST', `${BASE}/entries`, { as: 'hr1', body: body('2026-10-12') });
  expect(r.status).toBe(400);
  expect(r.body.error).toMatch(/future/);
});

test('23:59 IST on 10 Oct (18:29 UTC): 11 Oct is the future, 10 Oct is fine', async () => {
  at('2026-10-10T18:29:00Z');
  const fut = await api.request('POST', `${BASE}/entries`, { as: 'hr1', body: body('2026-10-11') });
  expect(fut.status).toBe(400);
  expect(fut.body.error).toMatch(/future/);
  const ok = await api.request('POST', `${BASE}/entries`, { as: 'hr1', body: body('2026-10-10') });
  expect(ok.body.success).toBe(true);
});
