/**
 * A real HTTP harness for the route specs, with no new dependency.
 *
 * Points DATA_DIR at a fresh temp directory BEFORE database/db.js is required,
 * mounts the routers on a bare express app with a stub auth middleware, and
 * drives them over a real socket with node's own http client. Nothing here can
 * reach a real database.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

function startApi(mounts, { role = 'admin', username = 'tester', employeeCode = null } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'leave-api-'));
  process.env.DATA_DIR = dir;
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

  const log = console.log; const warn = console.warn;
  console.log = () => {}; console.warn = () => {};
  let express; let getDb;
  try {
    express = require('express');
    ({ getDb } = require('../../database/db'));
  } finally {
    console.log = log; console.warn = warn;
  }

  const app = express();
  app.use(express.json());
  // Stub auth. The real one is JWT; every route below reads req.user only.
  const current = { role, username, employee_code: employeeCode };
  app.use((req, res, next) => {
    req.user = {
      ...current,
      ...(req.headers['x-test-role'] ? { role: req.headers['x-test-role'] } : {}),
      ...(req.headers['x-test-employee-code'] ? { employee_code: req.headers['x-test-employee-code'] } : {}),
    };
    req.requestId = 'test';
    next();
  });
  for (const [mountPath, modulePath] of Object.entries(mounts)) {
    app.use(mountPath, require(modulePath));
  }

  const db = (() => { const l = console.log; console.log = () => {}; try { return getDb(); } finally { console.log = l; } })();
  const server = app.listen(0);

  const request = (method, url, { body = null, role: asRole = null, raw = false, employeeCode: asEmp = null } = {}) => new Promise((resolve, reject) => {
    const payload = body === null ? null : Buffer.from(JSON.stringify(body));
    const req = http.request({
      host: '127.0.0.1', port: server.address().port, method, path: url,
      headers: {
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {}),
        ...(asRole ? { 'x-test-role': asRole } : {}),
        ...(asEmp ? { 'x-test-employee-code': asEmp } : {}),
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        if (!raw) { try { json = JSON.parse(text); } catch { /* not json */ } }
        resolve({ status: res.statusCode, headers: res.headers, body: json, text });
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

  return { app, db, server, request, close, dataDir: dir };
}

module.exports = { startApi };
