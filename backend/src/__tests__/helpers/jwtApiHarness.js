/**
 * HTTP harness with REAL authentication (Loans PR-3).
 *
 * Like apiHarness.js (temp DATA_DIR, real initSchema, real routers, real
 * socket, no new dependency) but the routers sit behind the real
 * middleware/auth.js requireAuth, and requests carry real JWTs signed with the
 * test JWT_SECRET — the same token shape routes/auth.js issues at login. A
 * stubbed req.user cannot prove the role guards hold; this can.
 *
 * Users are real rows in `users` (requireAuth reads allowed_companies from it).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

function startJwtApi(mounts, { users = [] } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'loans-jwt-api-'));
  process.env.DATA_DIR = dir;
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

  const log = console.log; const warn = console.warn;
  console.log = () => {}; console.warn = () => {};
  let express; let getDb; let requireAuth; let jwt; let JWT_SECRET;
  try {
    express = require('express');
    jwt = require('jsonwebtoken');
    ({ getDb } = require('../../database/db'));
    ({ requireAuth, JWT_SECRET } = require('../../middleware/auth'));
  } finally {
    console.log = log; console.warn = warn;
  }

  const db = (() => { const l = console.log; console.log = () => {}; try { return getDb(); } finally { console.log = l; } })();

  const tokens = {};
  const addUser = ({ username, role, allowedCompanies = '*', employeeCode = null }) => {
    const info = db.prepare(`INSERT INTO users (username, password_hash, role, is_active) VALUES (?, 'x', ?, 1)`).run(username, role);
    try { db.prepare('UPDATE users SET allowed_companies = ? WHERE id = ?').run(allowedCompanies, info.lastInsertRowid); } catch { /* column optional */ }
    tokens[username] = jwt.sign({ id: info.lastInsertRowid, username, role, employee_code: employeeCode }, JWT_SECRET, { expiresIn: '1h' });
    return tokens[username];
  };
  for (const u of users) addUser(u);

  const app = express();
  app.use(express.json());
  for (const [mountPath, modulePath] of Object.entries(mounts)) {
    app.use(mountPath, requireAuth, require(modulePath));
  }
  const server = app.listen(0);

  /** as: a username from `users`, a raw token string via {token}, or null for no Authorization header. */
  const request = (method, url, { body = null, as = null, token = null } = {}) => new Promise((resolve, reject) => {
    const payload = body === null ? null : Buffer.from(JSON.stringify(body));
    const bearer = token || (as ? tokens[as] : null);
    if (as && !bearer) { reject(new Error(`no token for ${as}`)); return; }
    const req = http.request({
      host: '127.0.0.1', port: server.address().port, method, path: url,
      headers: {
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {}),
        ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch { /* not json */ }
        resolve({ status: res.statusCode, body: json, text });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });

  const close = () => new Promise((resolve) => {
    server.close(() => {
      try { db.close(); } catch { /* already closed */ }
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
      resolve();
    });
  });

  return { app, db, server, request, close, addUser, tokens, jwt, JWT_SECRET };
}

module.exports = { startJwtApi };
