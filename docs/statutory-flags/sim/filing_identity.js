#!/usr/bin/env node
/* Statutory flags PR-3 — plant filing files: byte identity between two code trees. THROWAWAY DB ONLY.
 *
 *   node docs/statutory-flags/sim/filing_identity.js --root <tree> --run 1|2 --out <file.json>
 *   node docs/statutory-flags/sim/filing_identity.js --compare <branch.json> <base.json>
 *
 * --root   a checkout of the repo (the branch, or a `git worktree` at the base with backend/node_modules
 *          symlinked). Its own db.js / schema / exportFormats.js / routes/reports.js are loaded.
 * --run 1  a fully populated synthetic month: two companies, 20 employees — 8 PF rows, 12 ESI rows, 20 bank rows,
 *          every UAN 12 digits, every ESI number 10 digits, every bank account + IFSC present.
 * --run 2  the same month with 3 bad UANs (blank, spaces only, 11 digits) and 2 blank ESI numbers.
 * Captures ECR / ESI / bank × {company A, company B, all}: generator content, filename, employees, totals, missing, and
 * the route's JSON + download + X-Missing-* header (reports router mounted behind a stub `hr` user).
 * --compare  run 1: content md5, filename, employees, route download and route JSON rows identical; totals equal on
 *            the base keys; the branch adds only missingCount / missingEE / missingER (all 0); no header.
 *            run 2: base lines − branch lines = exactly the bad rows = branch `missing` = the header codes; bank identical.
 * Synthetic codes / names / numbers only. Exit 0 only when every check passes.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');

const arg = (k) => { const i = process.argv.indexOf(k); return i === -1 ? null : process.argv[i + 1]; };
const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');
const A = 'Indriyan Beverages Pvt Ltd';
const B = 'Asian Lakto Ind Ltd';
const MONTH = 10; const YEAR = 2026;
const BAD_UAN = { 0: '', 1: '   ', 2: '10000000001' };       // run 2: PF rows 0–2
const BAD_ESI = { 10: null, 11: '' };                         // run 2: ESI rows 10–11

if (process.argv.includes('--compare')) {
  const i = process.argv.indexOf('--compare');
  const br = JSON.parse(fs.readFileSync(process.argv[i + 1], 'utf8'));
  const bs = JSON.parse(fs.readFileSync(process.argv[i + 2], 'utf8'));
  const fails = []; let checks = 0;
  const ok = (cond, msg) => { checks++; if (!cond) fails.push(msg); };
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  ok(br.run === bs.run, `runs differ ${br.run} vs ${bs.run}`);
  for (const key of Object.keys(bs.files)) {
    const b = br.files[key]; const s = bs.files[key];
    const [kind] = key.split(':');
    ok(b.filename === s.filename && b.route.filename === s.route.filename, `${key}: filename ${b.filename} vs ${s.filename}`);
    if (kind === 'bank' || br.run === 1) {
      ok(b.md5 === s.md5, `${key}: content md5 ${b.md5} vs ${s.md5}`);
      ok(b.route.downloadMd5 === s.route.downloadMd5, `${key}: route download md5 differs`);
      ok(same(b.employees, s.employees), `${key}: employees differ`);
      ok(same(b.route.data, s.route.data), `${key}: route JSON rows differ`);
      for (const k of Object.keys(s.totals)) ok(same(b.totals[k], s.totals[k]), `${key}: totals.${k} ${b.totals[k]} vs ${s.totals[k]}`);
      const extra = Object.keys(b.totals).filter((k) => !(k in s.totals));
      if (kind === 'bank') ok(extra.length === 0, `${key}: bank totals gained ${extra}`);
      else ok(same(extra.sort(), ['missingCount', 'missingEE', 'missingER']) && extra.every((k) => b.totals[k] === 0), `${key}: new totals keys ${extra} / ${extra.map((k) => b.totals[k])}`);
      ok(b.route.header === null && s.route.header === null, `${key}: header ${b.route.header} / ${s.route.header}`);
      if (kind !== 'bank') ok(same(b.missing, []), `${key}: missing ${JSON.stringify(b.missing)}`);
    } else {
      // run 2, ECR / ESI: the branch leaves out exactly the bad rows; everything else is the base line, in order
      const bad = new Set(s.employees.filter((e) => e.bad).map((e) => e.employee_code));
      const kept = s.lines.filter((_, n) => !bad.has(s.employees[n].employee_code));
      const dropped = s.lines.filter((_, n) => bad.has(s.employees[n].employee_code));
      ok(same(b.lines, kept), `${key}: branch lines ≠ base lines minus the bad rows`);
      ok(dropped.length === bad.size && s.lines.length - b.lines.length === bad.size, `${key}: ${s.lines.length} − ${b.lines.length} ≠ ${bad.size}`);
      ok(same([...(b.missing || []).map((m) => m.employee_code)].sort(), [...bad].sort()), `${key}: missing ${JSON.stringify(b.missing)} ≠ bad ${[...bad]}`);
      ok(same((b.route.header || '').split(',').filter(Boolean).sort(), [...bad].sort()), `${key}: header '${b.route.header}' ≠ bad ${[...bad]}`);
      ok(s.route.header === null, `${key}: base sent a header`);
      ok(b.route.downloadMd5 === md5(b.lines.join('\n')), `${key}: branch download ≠ branch content`);
      ok(b.totals.count === b.lines.length && b.totals.missingCount === bad.size, `${key}: counts ${b.totals.count}/${b.totals.missingCount}`);
    }
  }
  console.log(`compare run ${br.run}: ${checks - fails.length}/${checks} checks passed over ${Object.keys(bs.files).length} files`);
  for (const f of fails) console.log('  FAIL', f);
  process.exit(fails.length ? 1 : 0);
}

const ROOT = path.resolve(arg('--root'));
const RUN = Number(arg('--run') || 1);
const OUT = arg('--out');
const BACKEND = path.join(ROOT, 'backend');
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'filing-identity-'));
process.env.DATA_DIR = DATA;
process.env.NODE_ENV = 'test';

const quiet = (fn) => { const l = console.log, w = console.warn, e = console.error; console.log = console.warn = console.error = () => {};
  try { return fn(); } finally { console.log = l; console.warn = w; console.error = e; } };
const { getDb } = require(path.join(BACKEND, 'src/database/db'));
const db = quiet(() => getDb());
const gen = require(path.join(BACKEND, 'src/services/exportFormats'));

// ── seed: 20 employees, both companies; PF rows 0–7, ESI rows 4–15, bank rows 0–19 ──
const insE = db.prepare(`INSERT INTO employees (code, name, department, company, status, date_of_joining, uan, esi_number, account_number, ifsc_code, bank_name)
                         VALUES (?, ?, ?, ?, 'Active', ?, ?, ?, ?, ?, 'SYNTH BANK')`);
const insS = db.prepare(`INSERT INTO salary_computations (employee_code, month, year, company, gross_salary, gross_earned, payable_days,
                           pf_wages, pf_employee, pf_employer, eps, esi_wages, esi_employee, esi_employer, total_deductions, net_salary, salary_held)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`);
const insD = db.prepare(`INSERT INTO day_calculations (employee_code, month, year, company, total_calendar_days, total_sundays, total_holidays, total_payable_days)
                         VALUES (?, ?, ?, ?, 31, 4, 1, ?)`);
const bad = new Set();
for (let i = 0; i < 20; i++) {
  const code = `FI${String(100 + i)}`;
  const company = i % 2 ? A : B;
  const gross = Math.round((11800 + i * 913.17) * 100) / 100;
  const pfOn = i < 8; const esiOn = i >= 4 && i < 16;
  const pfWages = Math.min(Math.round(gross * 0.5 * 100) / 100, 15000);
  let uan = `10${String(9000000000 + i)}`;            // 12 digits
  let esiNo = `30${String(80000000 + i)}`;            // 10 digits
  if (RUN === 2 && i in BAD_UAN) { uan = BAD_UAN[i]; bad.add(code); }
  if (RUN === 2 && i in BAD_ESI) { esiNo = BAD_ESI[i]; bad.add(code); }
  const doj = i % 6 === 0 ? `${YEAR}-${String(MONTH).padStart(2, '0')}-1${i % 10}` : '2023-07-15';
  const pfEE = pfOn ? Math.round(pfWages * 0.12 * 100) / 100 : 0;
  const esiEE = esiOn ? Math.round(gross * 0.0075 * 100) / 100 : 0;
  insE.run(code, `Synth ${i % 3 ? 'Worker' : 'helper|night'} ${i}`, i % 4 ? 'PRODUCTION' : 'STORE', company, doj, uan, esiNo, `7100${20000 + i}`, 'SYNB0000777');
  insS.run(code, MONTH, YEAR, company, gross, gross, 26 - (i % 5), pfOn ? pfWages : 0, pfEE, pfEE, pfOn ? Math.min(Math.round(pfWages * 0.0833 * 100) / 100, 1250) : 0,
    esiOn ? gross : 0, esiEE, esiOn ? Math.round(gross * 0.0325 * 100) / 100 : 0, pfEE + esiEE, Math.round((gross - pfEE - esiEE) * 100) / 100);
  insD.run(code, MONTH, YEAR, company, 26 - (i % 5));
}

// ── the reports router behind a stub `hr` user (both trees: base has no role gate here, branch passes hr) ──
const express = require(path.join(BACKEND, 'node_modules/express'));
const app = express();
app.use((req, _res, next) => { req.user = { id: 1, username: 'sim-hr', role: 'hr' }; next(); });
app.use('/api/reports', require(path.join(BACKEND, 'src/routes/reports')));
const server = app.listen(0);
const get = (url) => new Promise((resolve, reject) => {
  http.get({ host: '127.0.0.1', port: server.address().port, path: url }, (res) => {
    const chunks = []; res.on('data', (c) => chunks.push(c));
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }));
  }).on('error', reject);
});

(async () => {
  const files = {};
  const KINDS = [['ecr', 'generatePFECR', 'pf-ecr', 'x-missing-uan'], ['esi', 'generateESIFile', 'esi-contribution', 'x-missing-esi-number'],
    ['bank', 'generateBankFile', 'bank-salary-file', null]];
  for (const [kind, fn, route, hdr] of KINDS) {
    for (const [tag, co] of [['A', A], ['B', B], ['all', undefined]]) {
      const r = gen[fn](db, MONTH, YEAR, co);
      const q = `?month=${MONTH}&year=${YEAR}${co ? `&company=${encodeURIComponent(co)}` : ''}`;
      const j = await get(`/api/reports/${route}${q}`);
      const d = await get(`/api/reports/${route}${q}&download=true`);
      if (j.status !== 200 || d.status !== 200) throw new Error(`${route} ${tag}: ${j.status}/${d.status}`);
      const jb = JSON.parse(j.text);
      files[`${kind}:${tag}`] = {
        md5: md5(r.content), filename: r.filename, lines: kind === 'bank' ? [] : r.content.split('\n').filter((l, n, a) => !(a.length === 1 && l === '')),
        employees: r.employees.map((e) => ({ ...e, ...(bad.has(e.employee_code) ? { bad: true } : {}) })),
        totals: r.totals, missing: kind === 'bank' ? null : (r.missing ?? null),
        route: { filename: (d.headers['content-disposition'] || '').replace(/^.*filename="([^"]+)".*$/, '$1'), downloadMd5: md5(d.text), data: jb.data,
          header: hdr ? (j.headers[hdr] ?? null) : null, downloadHeader: hdr ? (d.headers[hdr] ?? null) : null },
      };
      if (hdr && files[`${kind}:${tag}`].route.header !== files[`${kind}:${tag}`].route.downloadHeader) throw new Error(`${route} ${tag}: JSON and download headers differ`);
    }
  }
  const out = { root: ROOT, run: RUN, bad: [...bad].sort(), files };
  if (OUT) fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
  const summary = Object.entries(files).map(([k, f]) => `${k} ${f.totals.count}${f.missing ? `/${f.missing.length}` : ''}`).join('  ');
  console.log(`run ${RUN} on ${ROOT}: ${summary}`);
  server.close(); db.close(); fs.rmSync(DATA, { recursive: true, force: true });
})().catch((e) => { console.error(e); server.close(); process.exit(1); });
