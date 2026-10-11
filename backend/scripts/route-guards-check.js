#!/usr/bin/env node
/**
 * P2-11 — role guards on write routes that sat behind requireAuth only (HTTP check).
 *
 * Boots the REAL backend/server.js on a scratch DATA_DIR (port 3211), real logins
 * (admin / hr / finance seeded by server.js; a viewer created through POST /api/auth/users),
 * fictional rows T21xx, then drives a sample of the 35 guarded routes.
 *
 * Usage:
 *   node backend/scripts/route-guards-check.js                       # this tree (expects the guards)
 *   APP_ROOT=/path/to/origin-main-worktree node .../route-guards-check.js --base   # old code: viewer gets through
 * Stops only the server process it started.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const HERE_ROOT = path.resolve(__dirname, '..', '..');
const ROOT = path.resolve(process.env.APP_ROOT || HERE_ROOT);
const BASE_MODE = process.argv.includes('--base');
const PORT = Number(process.env.PORT || 3211);
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'p211-check-'));
const C = 'Test Company Ltd';
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
    await req('POST', '/api/auth/users', { token: admin, body: { username: 'viewer211', password: 'Viewer@2025', role: 'viewer' } });
    const viewer = await login('viewer211', 'Viewer@2025');
    check('four real logins', [true, true, true, true], [admin, hr, fin, viewer].map(Boolean));

    const db = new Database(path.join(WORK, 'hr_system.db'));
    db.prepare(`INSERT INTO employees (code, name, company, status, employment_type, date_of_joining) VALUES ('T2101', 'TEST', ?, 'Left', 'Permanent', '2024-01-01')`).run(C);
    const impId = db.prepare(`INSERT INTO monthly_imports (month, year, company, file_name) VALUES (8, 2026, ?, 't.xls')`).run(C).lastInsertRowid;
    const status = () => db.prepare(`SELECT status FROM employees WHERE code = 'T2101'`).get().status;
    const imports = () => db.prepare('SELECT COUNT(*) AS c FROM monthly_imports WHERE id = ?').get(impId).c;

    if (BASE_MODE) {
      let r = await req('POST', '/api/analytics/reactivate-employee', { token: viewer, body: { code: 'T2101' } });
      check('BASE: viewer reactivates a Left employee (200)', 200, r.status);
      check('BASE: employee now Active', 'Active', status());
      r = await req('DELETE', `/api/import/${impId}`, { token: viewer });
      check('BASE: viewer deletes a month import (200)', 200, r.status);
      check('BASE: import gone', 0, imports());
      r = await req('POST', '/api/jobs', { token: viewer, body: { type: 'leave_nightly', params: {} } });
      check('BASE: viewer queues a job (200)', 200, r.status);
    } else {
      const refused = [
        ['POST', '/api/analytics/reactivate-employee', viewer, { code: 'T2101' }],
        ['POST', '/api/analytics/reactivate-employee', fin, { code: 'T2101' }],
        ['DELETE', `/api/import/${impId}`, viewer, undefined],
        ['DELETE', `/api/import/${impId}`, hr, undefined],
        ['POST', '/api/jobs', hr, { type: 'leave_nightly', params: {} }],
        ['POST', '/api/attendance/night-shifts/1/reject', viewer, {}],
        ['POST', '/api/employees', viewer, { code: 'T2102', name: 'TEST' }],
        ['PUT', '/api/advance/1/mark-paid', fin, {}],
        ['POST', '/api/finance-audit/punch-correction', viewer, {}],
        ['PUT', '/api/finance-audit/manual-flags/1/verify', hr, {}],
        ['PUT', '/api/settings/holidays/audit-log/1/review', hr, {}],
      ];
      for (const [m, u, t, b] of refused) {
        const r = await req(m, u, { token: t, body: b });
        check(`${m} ${u} refused → 403`, 403, r.status);
      }
      check('employee still Left', 'Left', status());
      check('import still there', 1, imports());
      check('no employee T2102 created', 0, db.prepare(`SELECT COUNT(*) AS c FROM employees WHERE code = 'T2102'`).get().c);

      let r = await req('POST', '/api/analytics/reactivate-employee', { token: hr, body: { code: 'T2101' } });
      check('hr reactivates → 200', 200, r.status);
      check('employee Active', 'Active', status());
      r = await req('POST', '/api/attendance/recalculate-metrics', { token: fin, body: { month: 9, year: 2026 } });
      check('finance recalculate-metrics still allowed (not 403)', true, r.status !== 403);
      r = await req('POST', '/api/employees', { token: hr, body: { code: 'T2103', name: 'TEST', company: C } });
      check('hr creates employee → 200', 200, r.status);
      r = await req('POST', '/api/import/stage/abc/complete', { token: hr, body: { month: 8, year: 2026 } });
      check('stage "abc" → 400 (not 500)', 400, r.status);
      r = await req('DELETE', `/api/import/${impId}`, { token: admin });
      check('admin deletes the import → 200', 200, r.status);
      check('import gone', 0, imports());
    }
    db.close();
  } finally {
    srv.kill();
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
