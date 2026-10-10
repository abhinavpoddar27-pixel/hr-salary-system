#!/usr/bin/env node
/**
 * P1-25 — PUT /api/employees/:code refuses a gross change and is hr + admin only (HTTP check).
 *
 * Boots the REAL backend/server.js on a scratch DATA_DIR (port 3125), real logins
 * (admin / hr / finance seeded by server.js from env passwords; a viewer created
 * through POST /api/auth/users), fictional employees T25xx, then drives the edit
 * route exactly as the Employee Master Edit modal does.
 *
 * Usage:
 *   node backend/scripts/employee-edit-gross-guard-check.js              # this tree (expects the fix)
 *   APP_ROOT=/path/to/origin-main-worktree node .../employee-edit-gross-guard-check.js --base
 *                                                                         # old code: shows the bug
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
const PORT = Number(process.env.PORT || 3125);
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'p125-check-'));
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
    console.log(`App root: ${ROOT}  mode: ${BASE_MODE ? 'BASE (expect the bug)' : 'fix'}`);

    const admin = await login('admin', 'Admin@123');
    const hr = await login('hr', 'Indriyan@2025');
    const fin = await login('finance', 'Finance@2025');
    await req('POST', '/api/auth/users', { token: admin, body: { username: 'viewer25', password: 'Viewer@2025', role: 'viewer' } });
    const viewer = await login('viewer25', 'Viewer@2025');
    check('four real logins', [true, true, true, true], [admin, hr, fin, viewer].map(Boolean));

    const db = new Database(path.join(WORK, 'hr_system.db'));
    const add = (code, gross) => {
      const id = db.prepare(`INSERT INTO employees (code, name, department, designation, company, status, employment_type, date_of_joining, gross_salary)
        VALUES (?, 'TEST EMP', 'TEST DEPT', 'OPERATOR', ?, 'Active', 'Permanent', '2024-01-01', ?)`).run(code, C, gross).lastInsertRowid;
      if (gross) db.prepare(`INSERT INTO salary_structures (employee_id, effective_from, gross_salary, basic, hra, basic_percent, hra_percent)
        VALUES (?, '2025-01-01', ?, ?, ?, 50, 20)`).run(id, gross, gross / 2, gross / 5);
    };
    add('T2501', 20000); add('T2502', 20000); add('T2503', null); add('T2504', 20000);
    const emp = (code) => db.prepare('SELECT name, designation, gross_salary FROM employees WHERE code = ?').get(code);
    const struct = (code) => db.prepare('SELECT s.gross_salary, s.basic FROM salary_structures s JOIN employees e ON e.id = s.employee_id WHERE e.code = ? ORDER BY s.id DESC').get(code);
    const pending = (code) => db.prepare("SELECT COUNT(*) AS c FROM salary_change_requests WHERE employee_code = ? AND status = 'Pending'").get(code).c;
    // Exactly the keys EditEmployeeModal sends (Employees.jsx form state) — no gross_salary.
    const modal = (code, over = {}) => ({ code, name: 'TEST EMP', department: 'TEST DEPT', designation: 'OPERATOR', company: C,
      date_of_joining: '2024-01-01', employment_type: 'Permanent', shift_code: '', default_shift_id: null, weekly_off_day: 0,
      phone: '', email: '', aadhar: '', pan: '', ...over });

    if (BASE_MODE) {
      console.log('\n— old code —');
      const r1 = await req('PUT', '/api/employees/T2501', { token: hr, body: { gross_salary: 25000 } });
      check('old code: hr gross change via PUT /:code → 200', 200, r1.status);
      check('old code: employees.gross_salary moved 20000 → 25000 with no request', [25000, 0], [emp('T2501').gross_salary, pending('T2501')]);
      check('old code: salary_structures rescaled too', 25000, struct('T2501').gross_salary);
      const r2 = await req('PUT', '/api/employees/T2502', { token: viewer, body: { gross_salary: 30000 } });
      check('old code: VIEWER gross change → 200', 200, r2.status);
      check('old code: viewer moved gross to 30000', 30000, emp('T2502').gross_salary);
      const r3 = await req('PUT', '/api/employees/T2504', { token: fin, body: { name: 'BY FINANCE' } });
      check('old code: finance edit → 200', 200, r3.status);
    } else {
      console.log('\n— Edit modal (hr, admin) —');
      let r = await req('PUT', '/api/employees/T2501', { token: hr, body: modal('T2501', { designation: 'FITTER', phone: '9000000001' }) });
      check('hr Edit-modal save → 200', 200, r.status);
      check('designation + gross after', ['FITTER', 20000], [emp('T2501').designation, emp('T2501').gross_salary]);
      r = await req('PUT', '/api/employees/T2501', { token: admin, body: modal('T2501', { name: 'TEST EMP RENAMED' }) });
      check('admin Edit-modal save → 200', 200, r.status);

      console.log('\n— gross change refused —');
      for (const [who, tok] of [['hr', hr], ['admin', admin]]) {
        const before = [emp('T2502'), struct('T2502'), pending('T2502')];
        r = await req('PUT', '/api/employees/T2502', { token: tok, body: { gross_salary: 25000, name: 'X' } });
        check(`${who} gross 20000 → 25000 → 400 GROSS_CHANGE_NEEDS_APPROVAL`, [400, 'GROSS_CHANGE_NEEDS_APPROVAL'], [r.status, r.body?.code]);
        check(`${who}: employee, structure, requests unchanged`, before, [emp('T2502'), struct('T2502'), pending('T2502')]);
      }
      check('error text points to the salary request', true, /request a change/.test(r.body?.error || ''));
      r = await req('PUT', '/api/employees/T2503', { token: hr, body: { gross_salary: 15000 } });
      check('first gross on an employee with none → 400', 400, r.status);
      check('T2503 gross still empty', null, emp('T2503').gross_salary);
      r = await req('PUT', '/api/employees/T2502', { token: hr, body: { gross_salary: '20000.00', name: 'SAME GROSS' } });
      check('re-sending the same gross (string) → 200, name saved', [200, 'SAME GROSS', 20000], [r.status, emp('T2502').name, emp('T2502').gross_salary]);

      console.log('\n— the approval path —');
      r = await req('PUT', '/api/employees/T2502/salary', { token: hr, body: { gross_salary: 25000 } });
      check('hr PUT /:code/salary 25000 → 200 pendingApproval', [200, true], [r.status, r.body?.pendingApproval]);
      check('one Pending request, gross still 20000', [1, 20000], [pending('T2502'), emp('T2502').gross_salary]);

      console.log('\n— role guard —');
      for (const [who, tok] of [['finance', fin], ['viewer', viewer]]) {
        const before = emp('T2504');
        r = await req('PUT', '/api/employees/T2504', { token: tok, body: { name: `BY ${who}`, gross_salary: 99000 } });
        check(`${who} PUT /:code → 403`, 403, r.status);
        check(`${who}: nothing written`, before, emp('T2504'));
      }
      r = await req('PUT', '/api/employees/T2504', { body: { name: 'X' } });
      check('no token → 401', 401, r.status);
      r = await req('PUT', '/api/employees/NOPE25', { token: hr, body: { name: 'X' } });
      check('missing employee as hr → 404', 404, r.status);
      r = await req('PUT', '/api/employees/T2504', { token: hr, body: { status: 'Left' } });
      check('P4 exit refusal unchanged → 400', 400, r.status);
      r = await req('GET', '/api/employees/T2504', { token: hr });
      check('GET /:code still 200', 200, r.status);
    }
    db.close();
  } catch (e) {
    fail++; console.log('  ✗ ERROR', e.message);
  } finally {
    srv.kill('SIGTERM');
    await sleep(500);
    try { fs.rmSync(WORK, { recursive: true, force: true }); } catch { /* best effort */ }
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
