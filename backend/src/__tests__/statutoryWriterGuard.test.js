/**
 * Statutory flags PR-1 — source guards (T10b + review correction C1).
 *
 * Scans every .js under backend/src (tests excluded), multi-line, so a new
 * structure writer or flag writer cannot slip in without the flags handled:
 *   T10b  every INSERT into salary_structures / sales_salary_structures lists
 *         pf_applicable, esi_applicable and lwf_applicable in its column list
 *         (dynamic column lists are on a pinned exemption list of exactly 3,
 *         each with its own targeted test);
 *   C1a   no INSERT into those tables without an explicit column list;
 *   C1b   no pf/esi/lwf assignment inside an UPDATE ... SET or ON CONFLICT
 *         DO UPDATE SET on employees / salary_structures / sales_employees /
 *         sales_salary_structures, except on a pinned allowlist (R10).
 * Allowlist / exemption sizes are asserted, and every entry must still match
 * a real site (no stale entries).
 */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..');
const TESTS = __dirname;
const FLAG_COLS = ['pf_applicable', 'esi_applicable', 'lwf_applicable'];
const FLAG_TABLES = ['employees', 'salary_structures', 'sales_employees', 'sales_salary_structures'];

function walk(dir, out = []) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) {
      if (f === '__tests__' || f === 'node_modules') continue;
      walk(p, out);
    } else if (f.endsWith('.js')) out.push(p);
  }
  return out;
}
const FILES = walk(SRC).map((p) => ({ rel: path.relative(SRC, p).split(path.sep).join('/'), src: fs.readFileSync(p, 'utf8') }));
const lineOf = (src, idx) => src.slice(0, idx).split('\n').length;

/** The text inside the balanced parentheses starting at src[open] === '('. */
function balanced(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '(') depth++;
    else if (src[i] === ')') { depth--; if (depth === 0) return src.slice(open + 1, i); }
  }
  return src.slice(open + 1);
}

/** Nearest preceding `function name(` or `router.method('path'` — the site's context. */
function contextOf(src, idx) {
  const re = /(?:function\s+(\w+)\s*\()|(?:router\.(get|post|put|delete)\(\s*'([^']+)')/g;
  let m; let last = null;
  while ((m = re.exec(src)) && m.index < idx) last = m[1] ? `function ${m[1]}` : `router.${m[2]} ${m[3]}`;
  return last;
}

// ── T10b exemptions: dynamic column lists (exactly 3) ─────────────────────
const INSERT_EXEMPTIONS = [
  { file: 'routes/sales.js', context: "router.post /employees/:code/structures", test: 'T18 (C3) — POST /sales/employees/:code/structures' },
  { file: 'services/statutoryFlags.js', literal: 'INSERT INTO sales_salary_structures (${cols.join', test: 'T5 — sales' },
  { file: 'services/statutoryFlags.js', literal: 'INSERT INTO salary_structures (${cols.join', test: 'T1 — single 2025-01-01 row' },
];

// ── C1b allowlist: flag assignments in UPDATE SET / ON CONFLICT SET (exactly 5) ──
const ASSIGN_ALLOWLIST = [
  { file: 'services/statutoryFlags.js', why: 'the statutory upload service — the only flag writer (R10)', max: 3 },
  { file: 'database/schema.js', near: 'employees_statutory_default_off', why: 'new-employee flags-off trigger body', max: 1 },
  { file: 'database/schema.js', near: 'migration_sales_structures_backfill_indriyan_v1', why: 'sales backfill ON CONFLICT (inert: migration already ran)', max: 1 },
  { file: 'routes/sales.js', context: 'function versionSalesStructureForGross', why: 'gross versioning ON CONFLICT — values from carryFlags', max: 1 },
  { file: 'routes/sales.js', context: 'router.post /employees', why: 'sales create ON CONFLICT — create may set flags (§4.4)', max: 1 },
];

function matchesEntry(entry, file, src, idx, window) {
  if (entry.file !== file) return false;
  if (entry.literal && !src.startsWith(entry.literal, idx)) return false;
  if (entry.context && contextOf(src, idx) !== entry.context) return false;
  if (entry.near && !(src.slice(Math.max(0, idx - 3000), idx).includes(entry.near) || window.includes(entry.near))) return false;
  return true;
}

// ── scanners ─────────────────────────────────────────────────────────────
function structureInserts() {
  const out = [];
  const re = /INSERT\s+(?:OR\s+\w+\s+)?INTO\s+(sales_salary_structures|salary_structures)\b/g;
  for (const { rel, src } of FILES) {
    let m;
    while ((m = re.exec(src))) {
      const after = m.index + m[0].length;
      const rest = src.slice(after);
      const lead = rest.match(/^\s*/)[0].length;
      const hasList = rest[lead] === '(';
      const list = hasList ? balanced(src, after + lead) : null;
      out.push({ file: rel, line: lineOf(src, m.index), idx: m.index, src, table: m[1], hasList, list, text: src.slice(m.index, m.index + 160) });
    }
  }
  return out;
}

function setSegments() {
  const out = [];
  const upd = /\bUPDATE\s+(\$\{[^}]+\}|\w+)\s+SET\b/g;
  const conflict = /\bON\s+CONFLICT\s*\([^)]*\)\s*DO\s+UPDATE\s+SET\b/g;
  const segmentFrom = (src, start) => {
    const tail = src.slice(start, start + 2500);
    const stop = tail.search(/`|\bWHERE\b|"\)|'\)/);
    return stop === -1 ? tail : tail.slice(0, stop);
  };
  for (const { rel, src } of FILES) {
    let m;
    while ((m = upd.exec(src))) {
      const table = m[1];
      if (!table.startsWith('${') && !FLAG_TABLES.includes(table)) continue;
      out.push({ file: rel, line: lineOf(src, m.index), idx: m.index, src, kind: 'UPDATE', table, seg: segmentFrom(src, m.index + m[0].length) });
    }
    while ((m = conflict.exec(src))) {
      const before = src.slice(Math.max(0, m.index - 3000), m.index);
      const ins = [...before.matchAll(/INSERT\s+(?:OR\s+\w+\s+)?INTO\s+(\w+)/g)].pop();
      const table = ins ? ins[1] : '?';
      if (!FLAG_TABLES.includes(table)) continue;
      out.push({ file: rel, line: lineOf(src, m.index), idx: m.index, src, kind: 'ON CONFLICT', table, seg: segmentFrom(src, m.index + m[0].length) });
    }
  }
  return out;
}

const FLAG_ASSIGN = /\b(pf_applicable|esi_applicable|lwf_applicable)\s*=/;

describe('T10b — every structure INSERT lists pf/esi/lwf', () => {
  const sites = structureInserts();

  test('the scan finds the known writers (sanity)', () => {
    expect(sites.length).toBeGreaterThanOrEqual(12);
    const files = new Set(sites.map((s) => s.file));
    for (const f of ['routes/employees.js', 'routes/salary-input.js', 'routes/sales.js', 'services/salaryComputation.js', 'database/schema.js', 'services/statutoryFlags.js']) {
      expect(files.has(f)).toBe(true);
    }
  });

  test('exemption list has exactly 3 entries, each matching exactly one site, each with an existing targeted test', () => {
    expect(INSERT_EXEMPTIONS).toHaveLength(3);
    const testSrc = fs.readdirSync(TESTS).filter((f) => f.endsWith('.test.js')).map((f) => fs.readFileSync(path.join(TESTS, f), 'utf8')).join('\n');
    for (const e of INSERT_EXEMPTIONS) {
      const hits = sites.filter((s) => matchesEntry(e, s.file, s.src, s.idx, s.text));
      expect({ entry: e.literal || e.context, hits: hits.length }).toEqual({ entry: e.literal || e.context, hits: 1 });
      expect(testSrc.includes(e.test)).toBe(true);
    }
  });

  test('every non-exempt INSERT names pf_applicable, esi_applicable and lwf_applicable in its column list', () => {
    const bad = [];
    for (const s of sites) {
      if (INSERT_EXEMPTIONS.some((e) => matchesEntry(e, s.file, s.src, s.idx, s.text))) continue;
      const missing = FLAG_COLS.filter((c) => !new RegExp(`\\b${c}\\b`).test(s.list || ''));
      if (missing.length) bad.push(`${s.file}:${s.line} missing ${missing.join(', ')}`);
    }
    expect(bad).toEqual([]);
  });
});

describe('C1a — no structure INSERT without an explicit column list', () => {
  test('INSERT INTO (sales_)salary_structures SELECT / VALUES (no list) is refused', () => {
    const bad = structureInserts().filter((s) => !s.hasList).map((s) => `${s.file}:${s.line}`);
    expect(bad).toEqual([]);
  });

  test('the scanner would catch one (self-check)', () => {
    const src = 'db.prepare(`INSERT INTO salary_structures SELECT * FROM x`)';
    const m = /INSERT\s+(?:OR\s+\w+\s+)?INTO\s+(sales_salary_structures|salary_structures)\b/.exec(src);
    const rest = src.slice(m.index + m[0].length);
    expect(rest[rest.match(/^\s*/)[0].length]).not.toBe('(');
  });
});

describe('C1b — R10: flags are assigned only on the pinned allowlist', () => {
  const segs = setSegments().filter((s) => FLAG_ASSIGN.test(s.seg));

  test('allowlist has exactly 5 entries and none is stale', () => {
    expect(ASSIGN_ALLOWLIST).toHaveLength(5);
    for (const a of ASSIGN_ALLOWLIST) {
      const hits = segs.filter((s) => matchesEntry(a, s.file, s.src, s.idx, s.seg));
      expect({ entry: a.why, ok: hits.length >= 1 && hits.length <= a.max }).toEqual({ entry: a.why, ok: true });
    }
  });

  test('no other UPDATE SET / ON CONFLICT SET writes pf/esi/lwf on the four flag tables', () => {
    const bad = segs
      .filter((s) => !ASSIGN_ALLOWLIST.some((a) => matchesEntry(a, s.file, s.src, s.idx, s.seg)))
      .map((s) => `${s.file}:${s.line} ${s.kind} ${s.table}: ${s.seg.replace(/\s+/g, ' ').slice(0, 120)}`);
    expect(bad).toEqual([]);
  });

  test('dynamic SET builders cannot carry the flags either', () => {
    const emp = FILES.find((f) => f.rel === 'routes/employees.js').src;
    const allowed = emp.match(/const allowedFields = \[([\s\S]*?)\];/)[1];
    for (const c of FLAG_COLS) expect(allowed.includes(`'${c}'`)).toBe(false);
    const sales = FILES.find((f) => f.rel === 'routes/sales.js').src;
    const put = sales.slice(sales.indexOf("router.put('/employees/:code',"), sales.indexOf("router.put('/employees/:code/mark-left'"));
    expect(put).toMatch(/if \(STATUTORY_FLAG_FIELDS\.includes\(field\)\) continue;/);
  });

  test('the scanner would catch a stray writer (self-check)', () => {
    const seg = ' pf_applicable = ?, updated_at = datetime(\'now\') ';
    expect(FLAG_ASSIGN.test(seg)).toBe(true);
    expect(FLAG_ASSIGN.test(' gross_salary = ?, pt_applicable = ? ')).toBe(false);
  });
});
