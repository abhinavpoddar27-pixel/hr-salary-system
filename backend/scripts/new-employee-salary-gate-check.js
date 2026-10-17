#!/usr/bin/env node
/**
 * N-13 — new employee salary goes through finance (HTTP check, owner ruling 17 Oct 2026).
 *
 * Boots the REAL backend/server.js on a scratch DATA_DIR (port 3502) with real logins (admin / hr / finance
 * seeded by server.js) and fictional codes T13xx, then:
 *   - hr + admin: POST /api/employees with a salary field → 400 SALARY_VIA_SALARY_INPUT, nothing written
 *   - hr: POST /api/employees without salary (empty salary keys too) → 200
 *   - admin: POST /api/employees/bulk-import with a gross → employee row, NO gross / structure, one Pending request
 *   - finance: GET /api/salary-input/pending-changes shows it (requested_by admin)
 *   - admin approve → 403 SELF_APPROVAL; finance approve → 200, gross + structure written
 *   - drift query on the scratch DB → 0
 *
 * Usage:
 *   node backend/scripts/new-employee-salary-gate-check.js
 *   APP_ROOT=/path/to/origin-main-worktree node backend/scripts/new-employee-salary-gate-check.js --base   # old code: must FAIL
 * Stops only the server process it started. Three logins (limiter budget is 5 / 15 min per IP).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const HERE_ROOT = path.resolve(__dirname, '..', '..');
const ROOT = path.resolve(process.env.APP_ROOT || HERE_ROOT);
const BASE_MODE = process.argv.includes('--base');
const PORT = Number(process.env.PORT || 3502);
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'n13-check-'));
const C = 'Indriyan Beverages Pvt Ltd';
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
    console.log(`App root: ${ROOT}  mode: ${BASE_MODE ? 'BASE (expect failures)' : 'fix'}`);

    const admin = await login('admin', 'Admin@123');
    const hr = await login('hr', 'Indriyan@2025');
    const fin = await login('finance', 'Finance@2025');
    check('three real logins', [true, true, true], [admin, hr, fin].map(Boolean));
    const db = new Database(path.join(WORK, 'hr_system.db'));
    const n = (sql, ...p) => db.prepare(sql).get(...p).n;
    const counts = () => [n('SELECT COUNT(*) n FROM employees'), n('SELECT COUNT(*) n FROM salary_structures'), n('SELECT COUNT(*) n FROM salary_change_requests')];

    console.log('\n[1] POST /api/employees with salary → 400, nothing written');
    for (const [who, token, code] of [['hr', hr, 'T1301'], ['admin', admin, 'T1302']]) {
      const before = counts();
      const r = await req('POST', '/api/employees', { token, body: { code, name: 'TEST NEW', company: C, basic: 9000, hra: 3600 } });
      check(`${who}: status 400`, 400, r.status);
      check(`${who}: code SALARY_VIA_SALARY_INPUT`, 'SALARY_VIA_SALARY_INPUT', r.body?.code);
      check(`${who}: message`, 'Create the employee first, then set salary in Salary Input (finance approves it).', r.body?.error);
      check(`${who}: employees / structures / requests unchanged`, before, counts());
    }
    const g = await req('POST', '/api/employees', { token: hr, body: { code: 'T1303', name: 'TEST NEW', company: C, gross_salary: 15000 } });
    check('hr: gross_salary on create → 400', 400, g.status);

    console.log('\n[2] POST /api/employees without salary → 200');
    const ok = await req('POST', '/api/employees', { token: hr, body: { code: 'T1304', name: 'TEST NEW', company: C, department: 'PRODUCTION', dateOfJoining: '2026-10-01' } });
    check('hr: no salary → 200', 200, ok.status);
    const empty = await req('POST', '/api/employees', { token: hr, body: { code: 'T1305', name: 'TEST NEW', company: C, basic: 0, hra: '', da: null } });
    check('hr: empty salary keys → 200', 200, empty.status);
    check('no structure for either', 0, n("SELECT COUNT(*) n FROM salary_structures s JOIN employees e ON e.id = s.employee_id WHERE e.code IN ('T1304','T1305')"));

    console.log('\n[3] bulk-import with gross → pending request, nothing paid yet');
    const bi = await req('POST', '/api/employees/bulk-import', { token: admin, body: { employees: [
      { code: 'T1310', name: 'TEST BULK', company: C, gross_salary: 18000, basic: 9000, hra: 3600, lastSeenSortKey: 202609 },
    ] } });
    check('bulk-import 200', 200, bi.status);
    check('row report', [{ code: 'T1310', employee: 'created', salary: 'request_raised' }], bi.body?.results?.rows);
    check('employees.gross_salary not written', 0, db.prepare("SELECT gross_salary g FROM employees WHERE code = 'T1310'").get()?.g);
    check('no salary_structures row', 0, n("SELECT COUNT(*) n FROM salary_structures s JOIN employees e ON e.id = s.employee_id WHERE e.code = 'T1310'"));
    const pend = await req('GET', '/api/salary-input/pending-changes', { token: fin });
    const row = (pend.body?.data || []).find((x) => x.employee_code === 'T1310');
    check('finance sees the pending request', true, !!row);
    check('requested_by = importing admin', 'admin', row?.requested_by);
    check('new_gross 18000', 18000, row?.new_gross);

    console.log('\n[4] approval');
    const self = await req('PUT', `/api/salary-input/approve/${row?.id}`, { token: admin, body: { effectiveFrom: '2026-10-01' } });
    check('admin approves own import request → 403', 403, self.status);
    check('code SELF_APPROVAL', 'SELF_APPROVAL', self.body?.code);
    const ap = await req('PUT', `/api/salary-input/approve/${row?.id}`, { token: fin, body: { effectiveFrom: '2026-10-01' } });
    check('finance approves → 200', 200, ap.status);
    check('gross written after approval', 18000, db.prepare("SELECT gross_salary g FROM employees WHERE code = 'T1310'").get()?.g);
    check('one structure after approval', 1, n("SELECT COUNT(*) n FROM salary_structures s JOIN employees e ON e.id = s.employee_id WHERE e.code = 'T1310'"));

    console.log('\n[5] drift');
    check('salary drift rows (all months)', 0, n('SELECT COUNT(*) n FROM salary_computations WHERE ABS(net_salary - (gross_earned - total_deductions)) > 1'));
    db.close();
  } catch (e) {
    fail++; console.log('  ✗ crashed:', e.message);
  } finally {
    srv.kill('SIGTERM');
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  if (BASE_MODE) {
    console.log(fail > 0 ? 'BASE: failures seen — the check catches the old behaviour ✓' : 'BASE: no failures — the check does NOT catch the old behaviour ✗');
    process.exit(fail > 0 ? 0 : 1);
  }
  process.exit(fail ? 1 : 0);
})();
