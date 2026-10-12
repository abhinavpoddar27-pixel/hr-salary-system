#!/usr/bin/env node
/**
 * P3-PG — role guard on POST /api/payroll/calculate-days, /compute-salary, /finalise (HTTP check).
 *
 * Boots the REAL backend/server.js on a scratch DATA_DIR (port 3402), real logins (admin / hr / finance seeded by
 * server.js; a viewer and a supervisor created through POST /api/auth/users), fictional employees T98xx with a
 * month of attendance and an approved finance sign-off, then drives the three routes per role.
 *
 * Usage:
 *   node backend/scripts/payroll-stage-guard-check.js                     # this tree (expects the guard)
 *   APP_ROOT=/path/to/origin-main-worktree node .../payroll-stage-guard-check.js --base   # old code: viewer gets through
 * Stops only the server process it started. Five logins = the login limiter's budget (5 / 15 min per IP).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { spawn } = require('child_process');

const HERE_ROOT = path.resolve(__dirname, '..', '..');
const ROOT = path.resolve(process.env.APP_ROOT || HERE_ROOT);
const BASE_MODE = process.argv.includes('--base');
const PORT = Number(process.env.PORT || 3402);
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'p3pg-check-'));
const C = 'Indriyan Beverages Pvt Ltd'; // a canonical label (normalizeCompany refuses unknown ones); employees are fictional
const MON = 9; const YEAR = 2026;
const BODY = { month: MON, year: YEAR, company: C };
const Database = require(path.join(HERE_ROOT, 'backend', 'node_modules', 'better-sqlite3'));

let pass = 0; let fail = 0;
const check = (label, expected, actual) => {
  const ok = JSON.stringify(expected) === JSON.stringify(actual);
  if (ok) { pass++; console.log(`  ✓ ${label}`); } else { fail++; console.log(`  ✗ ${label} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); }
};
function req(method, url, { token, body } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const r = http.request({ host: '127.0.0.1', port: PORT, method, path: url, headers: {
      ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    } }, (res) => {
      const chunks = []; res.on('data', (c) => chunks.push(c));
      res.on('end', () => { const t = Buffer.concat(chunks).toString(); let j = null; try { j = JSON.parse(t); } catch { /* */ } resolve({ status: res.statusCode, body: j }); });
    });
    r.on('error', reject); if (payload) r.write(payload); r.end();
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const login = async (u, p) => (await req('POST', '/api/auth/login', { body: { username: u, password: p } })).body?.token;

(async () => {
  const env = { ...process.env, DATA_DIR: WORK, JWT_SECRET: 'x', PORT: String(PORT), NODE_ENV: 'production',
    ADMIN_PASSWORD: 'Admin@123', HR_PASSWORD: 'Indriyan@2025', FINANCE_PASSWORD: 'Finance@2025' };
  const log = fs.openSync(path.join(WORK, 'server.log'), 'w');
  const srv = spawn('node', [path.join(ROOT, 'backend', 'server.js')], { env, stdio: ['ignore', log, log] });
  try {
    let up = false;
    for (let i = 0; i < 80 && !up; i++) { try { up = (await req('GET', '/api/version')).status === 200; } catch { await sleep(500); } }
    if (!up) throw new Error('server did not start — see ' + path.join(WORK, 'server.log'));
    console.log(`App root: ${ROOT}  mode: ${BASE_MODE ? 'BASE (expect viewer to get through)' : 'fix'}`);

    const admin = await login('admin', 'Admin@123');
    const hr = await login('hr', 'Indriyan@2025');
    const fin = await login('finance', 'Finance@2025');
    await req('POST', '/api/auth/users', { token: admin, body: { username: 'viewer3402', password: 'Viewer@2025', role: 'viewer' } });
    await req('POST', '/api/auth/users', { token: admin, body: { username: 'super3402', password: 'Super@2025', role: 'supervisor' } });
    const viewer = await login('viewer3402', 'Viewer@2025');
    const sup = await login('super3402', 'Super@2025');
    check('five real logins', [true, true, true, true, true], [admin, hr, fin, viewer, sup].map(Boolean));

    const db = new Database(path.join(WORK, 'hr_system.db'));
    for (const code of ['T9801', 'T9802']) {
      const id = db.prepare(`INSERT INTO employees (code, name, department, company, status, employment_type, date_of_joining, gross_salary)
        VALUES (?, 'TEST WORKER', 'PRODUCTION', ?, 'Active', 'Permanent', '2024-01-01', 20000)`).run(code, C).lastInsertRowid;
      for (let d = 1; d <= 30; d++) {
        const date = `${YEAR}-${String(MON).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const st = new Date(Date.UTC(YEAR, MON - 1, d)).getUTCDay() === 0 ? 'WO' : 'P';
        db.prepare(`INSERT INTO attendance_processed (employee_id, employee_code, date, month, year, company, status_original, status_final, is_night_out_only)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`).run(id, code, date, MON, YEAR, C, st, st);
      }
    }
    db.prepare(`INSERT INTO monthly_imports (month, year, company, file_name, status) VALUES (?, ?, ?, 't.xls', 'imported')`).run(MON, YEAR, C);
    db.prepare(`INSERT INTO finance_month_signoff (month, year, company, status, signed_by) VALUES (?, ?, '', 'approved', 'finance')`).run(MON, YEAR);
    const count = (t) => db.prepare(`SELECT COUNT(*) AS c FROM ${t} WHERE month = ? AND year = ?`).get(MON, YEAR).c;
    const finalised = () => db.prepare('SELECT COUNT(*) AS c FROM monthly_imports WHERE is_finalised = 1').get().c;
    const unfinalise = () => { db.prepare('UPDATE salary_computations SET is_finalised = 0').run(); db.prepare('UPDATE monthly_imports SET is_finalised = 0').run(); };
    const snap = () => ['day_calculations', 'salary_computations', 'monthly_imports'].map((t) =>
      crypto.createHash('sha256').update(JSON.stringify(db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all())).digest('hex'));

    if (BASE_MODE) {
      let r = await req('POST', '/api/payroll/calculate-days', { token: viewer, body: BODY });
      check('BASE: viewer runs Stage 6 (200)', 200, r.status);
      check('BASE: day_calculations written by viewer', 2, count('day_calculations'));
      r = await req('POST', '/api/payroll/compute-salary', { token: sup, body: BODY });
      check('BASE: supervisor runs Stage 7 (200)', 200, r.status);
      check('BASE: salary_computations written by supervisor', 2, count('salary_computations'));
      r = await req('POST', '/api/payroll/finalise', { token: viewer, body: BODY });
      check('BASE: viewer finalises the month (200)', 200, r.status);
      check('BASE: month finalised', 1, finalised());
    } else {
      // Admin builds the month first so the refused calls would have real work to do.
      let r = await req('POST', '/api/payroll/calculate-days', { token: admin, body: BODY });
      check('admin Stage 6 → 200', 200, r.status);
      r = await req('POST', '/api/payroll/compute-salary', { token: admin, body: BODY });
      check('admin Stage 7 → 200', 200, r.status);
      check('2 day rows + 2 salary rows', [2, 2], [count('day_calculations'), count('salary_computations')]);

      const before = snap();
      for (const [name, t] of [['viewer', viewer], ['supervisor', sup]]) {
        for (const route of ['calculate-days', 'compute-salary', 'finalise']) {
          r = await req('POST', `/api/payroll/${route}`, { token: t, body: BODY });
          check(`${name} ${route} → 403 "HR, finance or admin access required"`, [403, 'HR, finance or admin access required'], [r.status, r.body?.error]);
        }
      }
      check('day_calculations / salary_computations / monthly_imports unchanged after the refused calls', before, snap());
      check('month not finalised', 0, finalised());
      r = await req('POST', '/api/payroll/calculate-days', { body: BODY });
      check('no token → 401', 401, r.status);

      r = await req('POST', '/api/payroll/calculate-days', { token: hr, body: BODY });
      check('hr Stage 6 → 200', 200, r.status);
      r = await req('POST', '/api/payroll/calculate-days', { token: fin, body: BODY });
      check('finance Stage 6 → 200', 200, r.status);
      r = await req('POST', '/api/payroll/compute-salary', { token: hr, body: BODY });
      check('hr Stage 7 → 200', 200, r.status);
      r = await req('POST', '/api/payroll/compute-salary', { token: fin, body: BODY });
      check('finance Stage 7 → 200', 200, r.status);
      for (const [name, t] of [['finance', fin], ['hr', hr], ['admin', admin]]) {
        r = await req('POST', '/api/payroll/finalise', { token: t, body: BODY });
        check(`${name} finalise → 200 + month finalised`, [200, 1], [r.status, finalised()]);
        unfinalise();
      }
      db.prepare("UPDATE finance_month_signoff SET status = 'rejected'").run();
      r = await req('POST', '/api/payroll/finalise', { token: fin, body: BODY });
      check('sign-off gate still answers its own 403 (requiresFinanceApproval)', [403, true], [r.status, r.body?.requiresFinanceApproval]);
    }
    db.close();
  } finally {
    srv.kill();
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
