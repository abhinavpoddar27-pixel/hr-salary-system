/**
 * Statutory flags PR-3 — the sales ESI contribution file (salesExportFormats.generateSalesESIFile)
 * and its route GET /api/sales/export/esi-contribution.
 *   F5  selection — IN: flagged with ESI > 0; flagged ≤ ₹21k with 0 days (`|0|0|0|0`); a row with
 *       ESI > 0 whose flag is off at file time (N4); a held row. OUT: gross above the threshold;
 *       unflagged without ESI; another company. Days = round(total_days), wages = round(gross_earned),
 *       reason 1 = DOJ inside the sales cycle (26 Sep – 25 Oct for October), NULL cycle → deriveCycle.
 *       Missing / malformed IP numbers → `missing`, never a line.
 *   F6  route — 400 without month / year / company; filename; X-Missing-ESI-Number; hr / finance /
 *       admin 200, viewer 403 (owner ruling C4); the DB is unchanged (read-only).
 * Real initSchema, real sales compute, real routes behind real JWTs. Synthetic data only.
 */
const http = require('http');
const S = require('./helpers/statutoryFixture');
const { generateSalesESIFile } = require('../services/salesExportFormats');
const { startJwtApi } = require('./helpers/jwtApiHarness');

const CO = S.COMPANY;
const OTHER = S.OTHER_COMPANY;
const M = 10; const Y = 2026;

/** Sales rep with one 2026-01 structure, computed for October 2026 with `days` given. */
function rep(db, { code, name, esi = 0, gross = 18000, esiNo = null, doj = '2025-01-01', company = CO, days = 24 }) {
  const e = S.salesEmp(db, { code, gross_salary: gross, esi_number: esiNo, doj, company });
  db.prepare('UPDATE sales_employees SET name = ? WHERE id = ?').run(name || `Synth Rep ${code}`, e.id);
  S.salesStructure(db, e, '2026-01', { gross_salary: gross, esi });
  S.computeSales(db, e, M, Y, days);
  return e;
}
const row = (db, code, company = CO) => db.prepare('SELECT * FROM sales_salary_computations WHERE employee_code = ? AND month = ? AND year = ? AND company = ?').get(code, M, Y, company);

/** The October cast (codes are synthetic). */
function cast(db) {
  rep(db, { code: 'E01', name: 'Alpha one', esi: 1, esiNo: '4000000001' });                                  // IN  ESI > 0
  rep(db, { code: 'E02', name: 'Bravo|two', esi: 1, esiNo: '4000000002', days: 0 });                         // IN  flagged, 0 days
  const e3 = rep(db, { code: 'E03', name: 'Charlie', esi: 1, esiNo: '4000000003' });                        // IN  flag off at file time
  db.prepare('UPDATE sales_salary_structures SET esi_applicable = 0 WHERE employee_id = ?').run(e3.id);
  rep(db, { code: 'E04', name: 'Delta', esi: 1, esiNo: '4000000004' });                                      // IN  hold
  db.prepare("UPDATE sales_salary_computations SET status = 'hold', hold_reason = 'sim' WHERE employee_code = 'E04'").run();
  rep(db, { code: 'E05', name: 'Echo', esi: 1, esiNo: '4000 000 005', doj: '2026-09-28' });                 // IN  joined inside the cycle (not in Oct)
  rep(db, { code: 'E06', name: 'Foxtrot', esi: 1, esiNo: '4000000006', doj: '2026-10-27' });                // IN  joined in Oct, after the cycle
  rep(db, { code: 'E07', name: 'Golf', esi: 1, esiNo: '4000000007', gross: 25000 });                         // OUT above ₹21k
  rep(db, { code: 'E08', name: 'Hotel', esi: 0, esiNo: '4000000008' });                                      // OUT unflagged, no ESI
  rep(db, { code: 'E09', name: 'India', esi: 1, esiNo: '4000000009', company: OTHER });                     // OUT other company
  rep(db, { code: 'E10', name: 'Juliet', esi: 1, esiNo: null });                                             // missing: none
  rep(db, { code: 'E11', name: 'Kilo', esi: 1, esiNo: '40000' });                                            // missing: malformed
}
const lineOf = (r, ip, name, reason) => [ip, name, Math.round(r.total_days), Math.round(r.gross_earned), Math.round(r.esi_employee), reason].join('|');

describe('F5 — who is in the sales ESI file, and what each line says', () => {
  test('selection, line fields, cycle reason, missing', () => {
    const db = S.newDb();
    cast(db);
    expect(row(db, 'E01').esi_employee).toBeGreaterThan(0);
    expect(row(db, 'E02').gross_earned).toBe(0);
    expect(row(db, 'E07').esi_employee).toBe(0);
    const f = generateSalesESIFile(db, M, Y, CO);
    expect(f.filename).toBe('Sales_ESI_Oct_2026_Indriyan_Beverages_Pvt_Ltd.txt');
    expect(f.employees.map((r) => r.employee_code)).toEqual(['E01', 'E02', 'E03', 'E04', 'E05', 'E06']);   // ORDER BY name, code
    const expected = [
      lineOf(row(db, 'E01'), '4000000001', 'ALPHA ONE', 0),
      '4000000002|BRAVO TWO|0|0|0|0',
      lineOf(row(db, 'E03'), '4000000003', 'CHARLIE', 0),
      lineOf(row(db, 'E04'), '4000000004', 'DELTA', 0),
      lineOf(row(db, 'E05'), '4000000005', 'ECHO', 1),
      lineOf(row(db, 'E06'), '4000000006', 'FOXTROT', 0),
    ];
    expect(f.content).toBe(expected.join('\n'));
    for (const c of ['E01', 'E03', 'E04', 'E05', 'E06']) expect(row(db, c).esi_employee).toBeGreaterThan(0);
    expect(f.missing.map((m) => [m.employee_code, m.reason])).toEqual([['E10', 'none'], ['E11', 'malformed']]);
    expect(f.missing[0]).toMatchObject({ employee_name: 'Juliet', ee: Math.round(row(db, 'E10').esi_employee * 100) / 100, er: Math.round(row(db, 'E10').esi_employer * 100) / 100 });
    const written = f.employees;
    expect(f.totals).toEqual({
      count: 6,
      totalWages: written.reduce((s, r) => s + Math.round(r.gross_earned), 0),
      totalEEESI: written.reduce((s, r) => s + Math.round(r.esi_employee), 0),
      totalERESI: written.reduce((s, r) => s + Math.round(r.esi_employer), 0),
      missingCount: 2,
      missingEE: Math.round((row(db, 'E10').esi_employee + row(db, 'E11').esi_employee) * 100) / 100,
      missingER: Math.round((row(db, 'E10').esi_employer + row(db, 'E11').esi_employer) * 100) / 100,
    });
    expect(f.content.split('\n').some((l) => l.startsWith('|'))).toBe(false);
    // the other company's file holds only its own rep
    expect(generateSalesESIFile(db, M, Y, OTHER).employees.map((r) => r.employee_code)).toEqual(['E09']);
    db.close();
  });

  test('NULL cycle dates fall back to deriveCycle; the ESI threshold is the policy value', () => {
    const db = S.newDb();
    cast(db);
    db.prepare("UPDATE sales_salary_computations SET cycle_start_date = NULL, cycle_end_date = NULL WHERE employee_code IN ('E05', 'E06')").run();
    const f = generateSalesESIFile(db, M, Y, CO);
    expect(f.content.split('\n').filter((l) => /\|(ECHO|FOXTROT)\|/.test(l)).map((l) => l.split('|')[5])).toEqual(['1', '0']);
    // threshold 17000: E02 (flagged, gross 18000, nothing deducted) drops out; rows with a contribution stay
    db.prepare("UPDATE policy_config SET value = '17000' WHERE key = 'esi_threshold'").run();
    expect(generateSalesESIFile(db, M, Y, CO).employees.map((r) => r.employee_code)).toEqual(['E01', 'E03', 'E04', 'E05', 'E06']);
    db.close();
  });
});

// ── route (one harness per file, D-9) ──
let api;
beforeAll(() => {
  api = startJwtApi({ '/api/sales': '../../routes/sales' }, {
    users: [{ username: 'hr1', role: 'hr' }, { username: 'fin1', role: 'finance' }, { username: 'adm1', role: 'admin' }, { username: 'view1', role: 'viewer' }],
  });
  S.silently(() => cast(api.db));
});
afterAll(() => api.close());

function get(url, as) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: api.server.address().port, method: 'GET', path: url,
      headers: as ? { Authorization: `Bearer ${api.tokens[as]}` } : {} }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null; try { json = JSON.parse(text); } catch { /* text */ }
        resolve({ status: res.statusCode, headers: res.headers, json, text });
      });
    });
    r.on('error', reject); r.end();
  });
}
const snapshot = () => JSON.stringify({
  rows: api.db.prepare('SELECT * FROM sales_salary_computations ORDER BY id').all(),
  audit: api.db.prepare('SELECT COUNT(*) AS c FROM audit_log').get().c,
  masters: api.db.prepare('SELECT * FROM sales_employees ORDER BY id').all(),
});

describe('F6 — GET /api/sales/export/esi-contribution', () => {
  const CQ = encodeURIComponent(CO);
  const URL = `/api/sales/export/esi-contribution?month=${M}&year=${Y}&company=${CQ}`;

  test('400 without month / year / company (or a month outside 1–12)', async () => {
    for (const u of [`/api/sales/export/esi-contribution?month=${M}&year=${Y}`, `/api/sales/export/esi-contribution?year=${Y}&company=${CQ}`,
      `/api/sales/export/esi-contribution?month=${M}&company=${CQ}`, `/api/sales/export/esi-contribution?month=13&year=${Y}&company=${CQ}`]) {
      const r = await get(u, 'hr1');
      expect([u, r.status, r.json.success]).toEqual([u, 400, false]);
    }
  });

  test('JSON preview: filename, rows, missing, totals, header', async () => {
    const r = await get(URL, 'hr1');
    expect(r.status).toBe(200);
    expect(r.json.data.filename).toBe('Sales_ESI_Oct_2026_Indriyan_Beverages_Pvt_Ltd.txt');
    expect(r.json.data.employees.map((e) => e.employee_code)).toEqual(['E01', 'E02', 'E03', 'E04', 'E05', 'E06']);
    expect(r.json.data.missing.map((m) => m.employee_code)).toEqual(['E10', 'E11']);
    expect(r.json.data.totals).toMatchObject({ count: 6, missingCount: 2 });
    expect(r.headers['x-missing-esi-number']).toBe('E10,E11');
  });

  test('download = the generator content, attachment filename, same header; the DB is unchanged', async () => {
    const before = snapshot();
    const r = await get(`${URL}&download=true`, 'adm1');
    expect(r.status).toBe(200);
    expect(r.headers['content-disposition']).toBe('attachment; filename="Sales_ESI_Oct_2026_Indriyan_Beverages_Pvt_Ltd.txt"');
    expect(r.headers['content-type']).toMatch(/^text\/plain/);
    expect(r.headers['x-missing-esi-number']).toBe('E10,E11');
    expect(r.text).toBe(generateSalesESIFile(api.db, M, Y, CO).content);
    expect(r.text.split('\n')).toHaveLength(6);
    expect(snapshot()).toBe(before);
  });

  test('hr / finance / admin 200; viewer 403; no token 401 (C4)', async () => {
    for (const as of ['hr1', 'fin1', 'adm1']) {
      expect([as, (await get(URL, as)).status]).toEqual([as, 200]);
      expect([as, (await get(`${URL}&download=true`, as)).status]).toEqual([as, 200]);
    }
    const v = await get(`${URL}&download=true`, 'view1');
    expect(v.status).toBe(403);
    expect(v.headers['x-missing-esi-number']).toBeUndefined();
    expect((await get(URL, null)).status).toBe(401);
    // the rest of the sales router stays HR / admin only (finance 403, unchanged)
    expect((await get(`/api/sales/export/salary-register?month=${M}&year=${Y}&company=${CQ}`, 'fin1')).status).toBe(403);
  });
});
