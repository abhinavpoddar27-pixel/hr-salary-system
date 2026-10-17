/**
 * G1 — a DW contractor rate change applies from its effective date.
 * Owner ruling 17 Oct 2026 ("drafts only"): on approval, drafts (hr_entered / needs_correction) dated
 * on/after the effective date are re-priced; anything with finance, approved, flagged, paid or
 * rejected keeps the rate it was saved with. Real JWT auth, fictional contractors.
 */
const { startJwtApi } = require('./helpers/jwtApiHarness');

const BASE = '/api/daily-wage';
let api; let db; let gate = 0;

beforeAll(() => {
  api = startJwtApi({ [BASE]: '../../routes/dailyWage' }, {
    users: [{ username: 'hr1', role: 'hr' }, { username: 'fin1', role: 'finance' }],
  });
  db = api.db;
});
afterEach(() => jest.restoreAllMocks());
afterAll(() => api.close());

// Pin "now" (IST 17 Oct 2026, 12:00) — the route reads the clock through Date.now().
const at = (iso) => { jest.restoreAllMocks(); jest.spyOn(Date, 'now').mockReturnValue(Date.parse(iso)); };
const NOW = '2026-10-17T06:30:00Z';

let gangNo = 0;
function gang(wage = 500, comm = 20) {
  return db.prepare(`INSERT INTO dw_contractors (contractor_name, current_daily_wage_rate, current_commission_rate)
    VALUES (?, ?, ?)`).run(`Test Gang ${++gangNo}`, wage, comm).lastInsertRowid;
}
const entryBody = (cid, date, workers = 3, allocs = null) => ({
  contractor_id: cid, entry_date: date, in_time: '08:00', out_time: '17:00',
  total_worker_count: workers, gate_entry_reference: `GT-${++gate}`,
  department_allocations: allocs || [{ department: 'TESTING', worker_count: workers }],
});
async function addEntry(cid, date, workers = 3, allocs = null) {
  const r = await api.request('POST', `${BASE}/entries`, { as: 'hr1', body: entryBody(cid, date, workers, allocs) });
  expect(r.body.success).toBe(true);
  return r.body.data.id;
}
async function propose(cid, effective, wage = 600, comm = 25) {
  const r = await api.request('POST', `${BASE}/contractors/${cid}/rates`, {
    as: 'hr1', body: { new_wage_rate: wage, new_commission_rate: comm, effective_date: effective },
  });
  expect(r.body.success).toBe(true);
  return r.body.id;
}
const approve = (id) => api.request('PUT', `${BASE}/rates/${id}/approve`, { as: 'fin1' });
const entry = (id) => db.prepare('SELECT * FROM dw_entries WHERE id = ?').get(id);
const allocs = (id) => db.prepare('SELECT * FROM dw_department_allocations WHERE entry_id = ? ORDER BY id').all(id);
const contractor = (id) => db.prepare('SELECT * FROM dw_contractors WHERE id = ?').get(id);
const sumLiability = (cid) => db.prepare('SELECT ROUND(COALESCE(SUM(total_liability),0),2) s FROM dw_entries WHERE contractor_id = ?').get(cid).s;

test('past-dated change: drafts on/after the date re-priced, everything else and earlier entries kept', async () => {
  at(NOW);
  const cid = gang();
  const before = await addEntry(cid, '2026-10-05');                 // draft, before effective date
  const draft = await addEntry(cid, '2026-10-12');                  // draft, after → re-priced
  const corr = await addEntry(cid, '2026-10-13');                   // needs_correction → re-priced
  const pend = await addEntry(cid, '2026-10-14');                   // pending_finance → kept
  const appr = await addEntry(cid, '2026-10-15');                   // approved → kept
  const paid = await addEntry(cid, '2026-10-16');                   // paid → kept
  const flag = await addEntry(cid, '2026-10-11');                   // flagged → kept
  const rej = await addEntry(cid, '2026-10-11', 2);                 // rejected → kept
  const st = db.prepare('UPDATE dw_entries SET status = ? WHERE id = ?');
  st.run('needs_correction', corr); st.run('pending_finance', pend); st.run('approved', appr);
  st.run('paid', paid); st.run('flagged', flag); st.run('rejected', rej);
  const keptSnap = [before, pend, appr, paid, flag, rej].map(id => ({ e: entry(id), a: allocs(id) }));
  const sumBefore = sumLiability(cid);

  const rid = await propose(cid, '2026-10-10');
  const imp = await api.request('GET', `${BASE}/rates/${rid}/impact`, { as: 'fin1' });
  expect(imp.body.data).toMatchObject({ drafts_to_reprice: 2, applies_now: true });
  expect(imp.body.data.kept.count).toBe(5);

  const r = await approve(rid);
  expect(r.status).toBe(200);
  expect(r.body.repriced.count).toBe(2);
  expect(r.body.repriced.ids.sort()).toEqual([draft, corr].sort());
  expect(r.body.kept).toEqual({ count: 5, byStatus: { pending_finance: 1, approved: 1, paid: 1, flagged: 1, rejected: 1 } });
  expect(r.body.message).toMatch(/dated 2026-10-10 onward/);

  for (const id of [draft, corr]) {
    const e = entry(id);
    expect(e).toMatchObject({ wage_rate_applied: 600, commission_rate_applied: 25, total_wage_amount: 1800, total_commission_amount: 75, total_liability: 1875 });
    expect(allocs(id)[0]).toMatchObject({ allocated_wage_amount: 1800, allocated_commission_amount: 75 });
  }
  // Kept rows are byte-identical (entry + allocations).
  [before, pend, appr, paid, flag, rej].forEach((id, i) => {
    expect(entry(id)).toEqual(keptSnap[i].e);
    expect(allocs(id)).toEqual(keptSnap[i].a);
  });
  // Money proof: total moved by exactly the re-priced drafts' delta.
  expect(r.body.repriced.liability_delta).toBe(2 * (1875 - 1560));
  expect(Math.round((sumLiability(cid) - sumBefore) * 100) / 100).toBe(r.body.repriced.liability_delta);
  // One audit row per re-priced draft.
  const aud = db.prepare("SELECT entity_id FROM dw_audit_log WHERE entity_type='entry' AND action='reprice_rate_change' AND entity_id IN (?,?)").all(draft, corr);
  expect(aud).toHaveLength(2);
  expect(contractor(cid)).toMatchObject({ current_daily_wage_rate: 600, current_commission_rate: 25 });
});

test('after a past-dated approval a back-dated new entry gets the OLD rate, a later one the new', async () => {
  at(NOW);
  const cid = gang();
  await approve(await propose(cid, '2026-10-10'));
  const early = await addEntry(cid, '2026-10-09');
  const late = await addEntry(cid, '2026-10-10');
  expect(entry(early)).toMatchObject({ wage_rate_applied: 500, commission_rate_applied: 20, total_liability: 1560 });
  expect(entry(late)).toMatchObject({ wage_rate_applied: 600, commission_rate_applied: 25, total_liability: 1875 });
});

test('future-dated change: current rates stay until the date, entries priced by their date, promoted on the day', async () => {
  at(NOW);
  const cid = gang();
  const rid = await propose(cid, '2026-10-20');
  const r = await approve(rid);
  expect(r.body.applies_now).toBe(false);
  expect(r.body.message).toMatch(/current rates stay until then/);
  expect(contractor(cid)).toMatchObject({ current_daily_wage_rate: 500, current_commission_rate: 20 });
  const today = await addEntry(cid, '2026-10-17');
  expect(entry(today).wage_rate_applied).toBe(500);
  // rate-on shows the future rate for that date and the old one for today
  const ro1 = await api.request('GET', `${BASE}/contractors/${cid}/rate-on?date=2026-10-21`, { as: 'hr1' });
  expect(ro1.body.data).toMatchObject({ wage_rate: 600, commission_rate: 25, source: 'rate_change' });
  const ro2 = await api.request('GET', `${BASE}/contractors/${cid}/rate-on?date=2026-10-17`, { as: 'hr1' });
  expect(ro2.body.data).toMatchObject({ wage_rate: 500, commission_rate: 20, source: 'before_change' });
  // the day comes (IST 20 Oct) → a contractor read promotes current_*
  at('2026-10-19T19:00:00Z');
  api.addUser({ username: 'hr_day20', role: 'hr' }); // token issued at the mocked time (1 h expiry)
  const list = await api.request('GET', `${BASE}/contractors`, { as: 'hr_day20' });
  expect(list.body.data.find(c => c.id === cid)).toMatchObject({ current_daily_wage_rate: 600, current_commission_rate: 25 });
  const r2 = await api.request('POST', `${BASE}/entries`, { as: 'hr_day20', body: entryBody(cid, '2026-10-20') });
  expect(entry(r2.body.data.id).wage_rate_applied).toBe(600);
});

test('two approved changes: each date gets the latest change effective by then; tie → highest id', async () => {
  at(NOW);
  const cid = gang();
  await approve(await propose(cid, '2026-09-01', 550, 21));
  await approve(await propose(cid, '2026-10-01', 600, 22));
  await approve(await propose(cid, '2026-10-01', 650, 23));
  const q = async (d) => (await api.request('GET', `${BASE}/contractors/${cid}/rate-on?date=${d}`, { as: 'hr1' })).body.data;
  expect(await q('2026-08-31')).toMatchObject({ wage_rate: 500, commission_rate: 20 });
  expect(await q('2026-09-15')).toMatchObject({ wage_rate: 550, commission_rate: 21 });
  expect(await q('2026-10-05')).toMatchObject({ wage_rate: 650, commission_rate: 23 });
});

test('no rate history: priced at the contractor master rates (unchanged behaviour)', async () => {
  at(NOW);
  const cid = gang(410, 15);
  const e = await addEntry(cid, '2026-10-01', 2);
  expect(entry(e)).toMatchObject({ wage_rate_applied: 410, commission_rate_applied: 15, total_wage_amount: 820, total_commission_amount: 30, total_liability: 850 });
});

test('editing a draft across the effective date re-prices it at its new date', async () => {
  at(NOW);
  const cid = gang();
  await approve(await propose(cid, '2026-10-10'));
  const id = await addEntry(cid, '2026-10-12');
  expect(entry(id).wage_rate_applied).toBe(600);
  const r = await api.request('PUT', `${BASE}/entries/${id}`, { as: 'hr1', body: { ...entryBody(cid, '2026-10-08'), gate_entry_reference: entry(id).gate_entry_reference } });
  expect(r.body.success).toBe(true);
  expect(entry(id)).toMatchObject({ entry_date: '2026-10-08', wage_rate_applied: 500, total_liability: 1560 });
});

test('batch import prices each row at its own date; split allocations sum to the totals', async () => {
  at(NOW);
  const cid = gang();
  await approve(await propose(cid, '2026-10-10'));
  const name = contractor(cid).contractor_name;
  const rows = ['2026-10-09', '2026-10-11'].map(d => ({
    contractor_name: name, entry_date: d, in_time: '08:00', out_time: '17:00', total_worker_count: 3,
    department_allocations: 'Prod:2,Store:1', gate_entry_reference: `BI-${++gate}`,
  }));
  const r = await api.request('POST', `${BASE}/entries/batch-import`, { as: 'hr1', body: { entries: rows } });
  expect(r.body.success).toBe(true);
  const [a, b] = r.body.ids.map(entry);
  expect(a.wage_rate_applied).toBe(500);
  expect(b.wage_rate_applied).toBe(600);
  for (const e of [a, b]) {
    const al = allocs(e.id);
    const w = al.reduce((s, x) => s + x.allocated_wage_amount, 0);
    const c = al.reduce((s, x) => s + x.allocated_commission_amount, 0);
    expect(Math.round(w * 100) / 100).toBe(e.total_wage_amount);
    expect(Math.round(c * 100) / 100).toBe(e.total_commission_amount);
  }
});

test('propose: effective_date must be a real YYYY-MM-DD date → 400, nothing written', async () => {
  at(NOW);
  const cid = gang();
  const n = () => db.prepare('SELECT COUNT(*) n FROM dw_rate_history WHERE contractor_id = ?').get(cid).n;
  for (const bad of ['10-10-2026', '2026-02-30', '2026-13-01', 'tomorrow', '2026-1-5']) {
    const r = await api.request('POST', `${BASE}/contractors/${cid}/rates`, { as: 'hr1', body: { new_wage_rate: 600, new_commission_rate: 25, effective_date: bad } });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/real date/);
  }
  expect(n()).toBe(0);
});

test('rate-on: bad date → 400, unknown contractor → 404', async () => {
  const cid = gang();
  expect((await api.request('GET', `${BASE}/contractors/${cid}/rate-on?date=2026-02-30`, { as: 'hr1' })).status).toBe(400);
  expect((await api.request('GET', `${BASE}/contractors/999999/rate-on?date=2026-10-01`, { as: 'hr1' })).status).toBe(404);
});

test('a draft already at the new rate is not re-priced and gets no audit row', async () => {
  at(NOW);
  const cid = gang();
  await approve(await propose(cid, '2026-10-10'));            // first change → 600/25
  const id = await addEntry(cid, '2026-10-12');                // already 600/25
  const r = await approve(await propose(cid, '2026-10-11', 600, 25)); // same rates again
  expect(r.body.repriced.count).toBe(0);
  expect(db.prepare("SELECT COUNT(*) n FROM dw_audit_log WHERE entity_type='entry' AND action='reprice_rate_change' AND entity_id = ?").get(id).n).toBe(0);
});
