/**
 * Statutory flags PR-3 — plant filing files (exportFormats.js + routes/reports.js).
 *   F1  a fully populated month (every UAN / ESI number valid): ECR and ESI content are the
 *       golden strings of the pre-PR-3 line builders (copied below verbatim); missing []; no header.
 *   F2  ECR: blank, spaces-only and 11-digit UANs are left out (reasons none / none / malformed);
 *       totals cover the written rows only; missingCount 3; header on JSON and download; no line
 *       starts with '|'.
 *   F3  F2 for the ESI file (blank / spaces / 9-digit ESI numbers).
 *   F4  the bank file is untouched: content md5 = the golden md5 of the dcad556 generator.
 * Synthetic codes, names and numbers only.
 */
const crypto = require('crypto');
const http = require('http');
const S = require('./helpers/statutoryFixture');
const { generatePFECR, generateESIFile, generateBankFile } = require('../services/exportFormats');
const { startJwtApi } = require('./helpers/jwtApiHarness');

const A = S.COMPANY;
const B = S.OTHER_COMPANY;
const MONTH = 10; const YEAR = 2026;
const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');

/** One plant employee-month: master, salary row and day-calc row (no compute — fixed numbers). */
function seedRow(db, i, over = {}) {
  const company = over.company || (i % 2 ? A : B);
  const code = over.code || `P${String(7000 + i)}`;
  const gross = 12000 + i * 731.37;
  const pfOn = over.pf ?? i < 8;
  const esiOn = over.esi ?? (i >= 8 || i % 3 === 0);
  const pfWages = Math.min(gross * 0.5, 15000);
  db.prepare(`INSERT INTO employees (code, name, department, company, status, date_of_joining, uan, esi_number, account_number, ifsc_code, bank_name)
              VALUES (?, ?, 'PRODUCTION', ?, 'Active', ?, ?, ?, ?, ?, 'SYNTH BANK')`)
    .run(code, over.name || `Synth Worker ${i}`, company, over.doj || (i % 5 === 0 ? `${YEAR}-${String(MONTH).padStart(2, '0')}-0${(i % 9) + 1}` : '2024-03-01'),
      over.uan !== undefined ? over.uan : `1000${String(70000000 + i)}`, over.esi_number !== undefined ? over.esi_number : `20${String(70000000 + i)}`,
      over.account ?? `5000${10000 + i}`, over.ifsc ?? 'SYNB0000123');
  db.prepare(`INSERT INTO salary_computations (employee_code, month, year, company, gross_salary, gross_earned, payable_days,
                pf_wages, pf_employee, pf_employer, eps, esi_wages, esi_employee, esi_employer, total_deductions, net_salary, salary_held)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`)
    .run(code, MONTH, YEAR, company, gross, gross, 25 - (i % 4),
      pfOn ? pfWages : 0, pfOn ? pfWages * 0.12 : 0, pfOn ? pfWages * 0.12 : 0, pfOn ? Math.min(pfWages * 0.0833, 1250) : 0,
      esiOn ? gross : 0, esiOn ? gross * 0.0075 : 0, esiOn ? gross * 0.0325 : 0, 0, gross - (pfOn ? pfWages * 0.12 : 0) - (esiOn ? gross * 0.0075 : 0));
  db.prepare(`INSERT INTO day_calculations (employee_code, month, year, company, total_calendar_days, total_sundays, total_holidays, total_payable_days)
              VALUES (?, ?, ?, ?, 31, 4, 1, ?)`).run(code, MONTH, YEAR, company, 25 - (i % 4));
  return code;
}
/** 20 employees, both companies: 8 PF, 12+ ESI, 20 bank rows — every identifier valid. */
function fullMonth(db) { for (let i = 0; i < 20; i++) seedRow(db, i); }

// ── the pre-PR-3 line builders (exportFormats.js on dcad556, loops verbatim) ──
function legacyECRLines(employees) {
  const lines = [];
  for (const emp of employees) {
    const uan = (emp.uan || '').replace(/\s/g, '');
    const name = (emp.employee_name || '').toUpperCase().replace(/\|/g, ' ');
    const grossWages = Math.round(emp.gross_earned || 0);
    const epfWages = Math.round(emp.pf_wages || 0);
    const epsWages = Math.round(emp.pf_wages || 0);
    const edliWages = Math.round(emp.pf_wages || 0);
    const eePF = Math.round(emp.pf_employee || 0);
    const eps = Math.round(emp.eps || 0);
    const erPFDiff = Math.round((emp.pf_employer || 0) - (emp.eps || 0));
    const calendarDays = emp.total_calendar_days || 30;
    const ncpDays = Math.max(0, Math.round(calendarDays - (emp.total_sundays || 0) - (emp.total_holidays || 0) - (emp.payable_days || 0)));
    lines.push([uan, name, grossWages, epfWages, epsWages, edliWages, eePF, eps, erPFDiff, ncpDays, 0].join('|'));
  }
  return lines.join('\n');
}
function legacyESILines(employees, month, year) {
  const lines = [];
  for (const emp of employees) {
    const ipNumber = (emp.esi_number || '').replace(/\s/g, '');
    const name = (emp.employee_name || '').toUpperCase().replace(/\|/g, ' ');
    const noDays = Math.round(emp.payable_days || 0);
    const totalWages = Math.round(emp.esi_wages || 0);
    const ipContribution = Math.round(emp.esi_employee || 0);
    let reasonCode = 0;
    if (emp.date_of_joining) {
      const doj = new Date(emp.date_of_joining);
      if (doj >= new Date(year, month - 1, 1) && doj <= new Date(year, month, 0)) reasonCode = 1;
    }
    lines.push([ipNumber, name, noDays, totalWages, ipContribution, reasonCode].join('|'));
  }
  return lines.join('\n');
}
// pre-PR-3 query rows (same SQL as the generators, so the golden strings use the same input)
const ecrRows = (db, company) => db.prepare(`
    SELECT sc.employee_code, e.name as employee_name, e.uan, e.pf_number, sc.gross_earned, sc.pf_wages, sc.pf_employee, sc.pf_employer, sc.eps,
           sc.payable_days, dc.total_calendar_days, dc.total_sundays, dc.total_holidays
    FROM salary_computations sc LEFT JOIN employees e ON sc.employee_code = e.code
    LEFT JOIN day_calculations dc ON sc.employee_code = dc.employee_code AND sc.month = dc.month AND sc.year = dc.year
    WHERE sc.month = ? AND sc.year = ? ${company ? 'AND sc.company = ?' : ''} AND (COALESCE(sc.pf_employee, 0) + COALESCE(sc.pf_employer, 0)) > 0
    ORDER BY e.name`).all(...[MONTH, YEAR, company].filter(Boolean));
const esiRows = (db, company) => db.prepare(`
    SELECT sc.employee_code, e.name as employee_name, e.esi_number, sc.esi_wages, sc.esi_employee, sc.esi_employer, sc.payable_days,
           dc.total_calendar_days, dc.total_sundays, dc.total_holidays, e.date_of_joining
    FROM salary_computations sc LEFT JOIN employees e ON sc.employee_code = e.code
    LEFT JOIN day_calculations dc ON sc.employee_code = dc.employee_code AND sc.month = dc.month AND sc.year = dc.year
    WHERE sc.month = ? AND sc.year = ? ${company ? 'AND sc.company = ?' : ''} AND (COALESCE(sc.esi_employee, 0) + COALESCE(sc.esi_employer, 0)) > 0
    ORDER BY e.name`).all(...[MONTH, YEAR, company].filter(Boolean));

describe('F1 — a fully populated month: the files are the pre-PR-3 files', () => {
  test('ECR + ESI content = golden strings for A, B and all; missing []; old totals unchanged', () => {
    const db = S.newDb();
    fullMonth(db);
    for (const co of [A, B, undefined]) {
      const ecr = generatePFECR(db, MONTH, YEAR, co);
      const esi = generateESIFile(db, MONTH, YEAR, co);
      const er = ecrRows(db, co); const sr = esiRows(db, co);
      expect(ecr.content).toBe(legacyECRLines(er));
      expect(esi.content).toBe(legacyESILines(sr, MONTH, YEAR));
      expect(ecr.employees).toEqual(er);
      expect(esi.employees).toEqual(sr);
      expect([ecr.missing, esi.missing]).toEqual([[], []]);
      expect(ecr.totals).toEqual({
        count: er.length,
        totalEPFWages: er.reduce((s, e) => s + Math.round(e.pf_wages || 0), 0),
        totalEEPF: er.reduce((s, e) => s + Math.round(e.pf_employee || 0), 0),
        totalEPS: er.reduce((s, e) => s + Math.round(e.eps || 0), 0),
        totalERPF: er.reduce((s, e) => s + Math.round((e.pf_employer || 0) - (e.eps || 0)), 0),
        missingCount: 0, missingEE: 0, missingER: 0,
      });
      expect(esi.totals).toEqual({
        count: sr.length,
        totalWages: sr.reduce((s, e) => s + Math.round(e.esi_wages || 0), 0),
        totalEEESI: sr.reduce((s, e) => s + Math.round(e.esi_employee || 0), 0),
        totalERESI: sr.reduce((s, e) => s + Math.round(e.esi_employer || 0), 0),
        missingCount: 0, missingEE: 0, missingER: 0,
      });
      expect([ecr.filename, esi.filename]).toEqual(['ECR_Oct_2026.txt', 'ESI_Oct_2026.txt']);
    }
    expect(generatePFECR(db, MONTH, YEAR).employees).toHaveLength(8);
    expect(generateESIFile(db, MONTH, YEAR).employees.length).toBeGreaterThanOrEqual(12);
    db.close();
  });
});

describe('F2 / F3 — rows without a valid identifier are listed, not written', () => {
  test('ECR: blank, spaces-only, 11-digit UAN → missing (none / none / malformed); totals over written rows', () => {
    const db = S.newDb();
    fullMonth(db);
    seedRow(db, 30, { code: 'PX01', name: 'Synth Blank', uan: '', pf: true, esi: false });
    seedRow(db, 31, { code: 'PX02', name: 'Synth Spaces', uan: '   ', pf: true, esi: false });
    seedRow(db, 32, { code: 'PX03', name: 'Synth Short', uan: '10000000001', pf: true, esi: false });
    const full = generatePFECR(db, MONTH, YEAR);
    const valid = ecrRows(db).filter((e) => !['PX01', 'PX02', 'PX03'].includes(e.employee_code));
    expect(full.content).toBe(legacyECRLines(valid));
    expect(full.content.split('\n').some((l) => l.startsWith('|'))).toBe(false);
    expect(full.content).not.toMatch(/SYNTH (BLANK|SPACES|SHORT)/);
    expect(full.missing.map((m) => [m.employee_code, m.reason]).sort()).toEqual([['PX01', 'none'], ['PX02', 'none'], ['PX03', 'malformed']]);
    const bad = ecrRows(db).filter((e) => e.employee_code.startsWith('PX'));
    for (const m of full.missing) {
      const r = bad.find((x) => x.employee_code === m.employee_code);
      expect([m.ee, m.er]).toEqual([Math.round(r.pf_employee * 100) / 100, Math.round(r.pf_employer * 100) / 100]);
    }
    expect(full.totals.count).toBe(8);
    expect(full.totals.totalEEPF).toBe(valid.reduce((s, e) => s + Math.round(e.pf_employee), 0));
    expect(full.totals.missingCount).toBe(3);
    expect(full.totals.missingEE).toBeCloseTo(bad.reduce((s, e) => s + e.pf_employee, 0), 2);
    expect(full.totals.missingER).toBeCloseTo(bad.reduce((s, e) => s + e.pf_employer, 0), 2);
    db.close();
  });

  test('ESI: blank, spaces-only, 9-digit ESI number → missing; the file keeps every valid line', () => {
    const db = S.newDb();
    fullMonth(db);
    seedRow(db, 40, { code: 'PY01', name: 'Synth Esi Blank', esi_number: null, pf: false, esi: true });
    seedRow(db, 41, { code: 'PY02', name: 'Synth Esi Spaces', esi_number: ' ', pf: false, esi: true });
    seedRow(db, 42, { code: 'PY03', name: 'Synth Esi Short', esi_number: '200000001', pf: false, esi: true });
    const r = generateESIFile(db, MONTH, YEAR);
    const valid = esiRows(db).filter((e) => !e.employee_code.startsWith('PY'));
    expect(r.content).toBe(legacyESILines(valid, MONTH, YEAR));
    expect(r.content.split('\n').some((l) => l.startsWith('|'))).toBe(false);
    expect(r.missing.map((m) => [m.employee_code, m.reason]).sort()).toEqual([['PY01', 'none'], ['PY02', 'none'], ['PY03', 'malformed']]);
    expect(r.totals.count).toBe(valid.length);
    expect(r.totals.totalEEESI).toBe(valid.reduce((s, e) => s + Math.round(e.esi_employee), 0));
    expect(r.totals.missingCount).toBe(3);
    db.close();
  });
});

describe('F4 — the bank file is untouched', () => {
  test('bank content md5 = golden (dcad556 generator on this fixture)', () => {
    const db = S.newDb();
    fullMonth(db);
    seedRow(db, 50, { code: 'PZ01', account: '', pf: false, esi: false });   // missing bank details path unchanged
    const all = generateBankFile(db, MONTH, YEAR);
    const a = generateBankFile(db, MONTH, YEAR, A);
    expect({ all: md5(all.content), a: md5(a.content) }).toEqual({ all: BANK_MD5_ALL, a: BANK_MD5_A });
    expect(all.totals).toEqual(BANK_TOTALS_ALL);
    expect(all.missing.map((m) => m.employee_code)).toEqual(['PZ01']);
    db.close();
  });
});

// Golden values: generateBankFile of dcad556 (before PR-3) on the fixture above.
const BANK_MD5_ALL = '12d9bf602e78cc81f8ffc089d8c214b4';
const BANK_MD5_A = 'b05049b236fb1d790cafcb21c901c7ac';
const BANK_TOTALS_ALL = { count: 20, totalAmount: 369683.62, missingCount: 1 };

// ── routes/reports.js over HTTP with real JWTs (one harness per file, D-9) ──
let api;
beforeAll(() => {
  api = startJwtApi({ '/api/reports': '../../routes/reports' }, {
    users: [{ username: 'hr1', role: 'hr' }, { username: 'fin1', role: 'finance' }, { username: 'adm1', role: 'admin' }, { username: 'view1', role: 'viewer' }],
  });
  fullMonth(api.db);
  seedRow(api.db, 60, { code: 'PW-01', name: 'Synth Route Blank', uan: null, esi_number: null, pf: true, esi: true, company: A });
  seedRow(api.db, 61, { code: 'PW 02', name: 'Synth Route Short', uan: '123', esi_number: '123', pf: true, esi: true, company: A });
});
afterAll(() => api.close());

/** GET with headers (the shared harness returns no headers). */
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

describe('F2 / F3 over HTTP — header on the JSON preview and on the download', () => {
  const CQ = encodeURIComponent(A);
  test('ECR: X-Missing-UAN = sanitised codes; JSON lists missing; download has no such line', async () => {
    const j = await get(`/api/reports/pf-ecr?month=${MONTH}&year=${YEAR}&company=${CQ}`, 'hr1');
    expect(j.status).toBe(200);
    expect(j.headers['x-missing-uan']).toBe('PW-01,PW02');
    expect(j.json.missing.map((m) => [m.employee_code, m.reason])).toEqual([['PW-01', 'none'], ['PW 02', 'malformed']]);
    expect(j.json.totals.missingCount).toBe(2);
    expect(j.json.data.some((e) => e.employee_code.startsWith('PW'))).toBe(false);
    const d = await get(`/api/reports/pf-ecr?month=${MONTH}&year=${YEAR}&company=${CQ}&download=true`, 'hr1');
    expect(d.status).toBe(200);
    expect(d.headers['x-missing-uan']).toBe('PW-01,PW02');
    expect(d.headers['content-disposition']).toBe('attachment; filename="ECR_Oct_2026.txt"');
    expect(d.text).not.toMatch(/SYNTH ROUTE/);
    expect(d.text.split('\n').some((l) => l.startsWith('|'))).toBe(false);
  });

  test('ESI: X-Missing-ESI-Number on JSON + download', async () => {
    const j = await get(`/api/reports/esi-contribution?month=${MONTH}&year=${YEAR}&company=${CQ}`, 'fin1');
    expect(j.headers['x-missing-esi-number']).toBe('PW-01,PW02');
    expect(j.json.missing).toHaveLength(2);
    const d = await get(`/api/reports/esi-contribution?month=${MONTH}&year=${YEAR}&company=${CQ}&download=true`, 'adm1');
    expect(d.headers['x-missing-esi-number']).toBe('PW-01,PW02');
    expect(d.text).not.toMatch(/SYNTH ROUTE/);
  });

  test('a company with nothing missing → no header at all', async () => {
    const j = await get(`/api/reports/pf-ecr?month=${MONTH}&year=${YEAR}&company=${encodeURIComponent(B)}`, 'hr1');
    expect(j.status).toBe(200);
    expect(j.headers['x-missing-uan']).toBeUndefined();
    expect(j.json.missing).toEqual([]);
  });
});
