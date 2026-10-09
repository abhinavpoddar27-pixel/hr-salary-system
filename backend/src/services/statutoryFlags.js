/**
 * Statutory flags (PF / ESI / LWF) — audited upload service (BUILD_PLAN §4.2).
 *
 * Flags change ONLY through this service from PR-1 on (ruling R10). An upload
 * is previewed (planFlagChanges, read-only) and then applied (applyFlagChanges,
 * one IMMEDIATE transaction that re-plans inside the transaction).
 *
 * The fallback trap (L18): plant and sales compute use the row in effect for the
 * month, else the LATEST row regardless of date. Months served by that fallback
 * would change on any re-run if we simply dated a new row at the effective month
 * or updated a later row. So apply first FREEZES the current state in a copy of
 * the latest row dated S (2000-01-01 / 2000-01), which every earlier month then
 * resolves to, and only then writes the new flags from E onwards.
 *
 * Keys: plant S='2000-01-01', E='<YYYY-MM>-01' (YYYY-MM-DD dates);
 *       sales S='2000-01',    E='<YYYY-MM>'    (YYYY-MM dates).
 *
 * Every audit row is written on the db handle passed in (N6), never via
 * db.js logAudit (which uses getDb()).
 */
const XLSX = require('xlsx');

const PLANT = 'plant';
const SALES = 'sales';
const FLAG_KEYS = ['esi', 'pf', 'lwf'];
const FLAG_COL = { esi: 'esi_applicable', pf: 'pf_applicable', lwf: 'lwf_applicable' };
const ESI_THRESHOLD = 21000;

const REQUIRED_COLUMNS = {
  plant: ['code', 'esi_applicable', 'pf_applicable', 'lwf_applicable'],
  sales: ['code', 'company', 'esi_applicable', 'pf_applicable', 'lwf_applicable'],
};
// Optional columns read when present (name/type/note are display-only).
const OPTIONAL_COLUMNS = ['name', 'type', 'esi_number', 'uan', 'note'];

const DATE_RE = { plant: /^\d{4}-\d{2}-\d{2}$/, sales: /^\d{4}-\d{2}$/ };
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const ESI_NUMBER_RE = /^\d{10}$/;
const UAN_RE = /^\d{12}$/;

function scopeTables(scope) {
  return scope === SALES
    ? { master: 'sales_employees', struct: 'sales_salary_structures' }
    : { master: 'employees', struct: 'salary_structures' };
}

function keysFor(scope, effectiveMonth) {
  return scope === SALES
    ? { S: '2000-01', E: effectiveMonth }
    : { S: '2000-01-01', E: `${effectiveMonth}-01` };
}

/** "YYYY-MM" → the key compute uses for that month (plant YYYY-MM-01, sales YYYY-MM). */
function monthKey(scope, yyyymm) {
  return scope === SALES ? yyyymm : `${yyyymm}-01`;
}

// ── Header + value parsing (phase5.js normaliseHeader pattern, copied) ─────

function normaliseHeader(h) {
  return String(h || '').trim().toLowerCase().replace(/\s+/g, ' ').replace(/ /g, '_');
}

function parseYesNo(v) {
  const s = String(v ?? '').trim().toLowerCase();
  if (['y', 'yes', '1', 'true'].includes(s)) return 1;
  if (['n', 'no', '0', 'false'].includes(s)) return 0;
  return null;
}

function cellText(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isInteger(v) ? v.toFixed(0) : String(v);
  return String(v).trim();
}

/**
 * parseFlagFile(buffer, scope) → { ok, rows, errors }
 * Blocking errors (ok=false): unreadable file, missing column, repeated code
 * (sales: repeated code+company). Per-row value problems (a Y/N cell that is
 * neither) are also blocking — the file is the owner's instruction and a flag
 * we cannot read must never be guessed.
 */
function parseFlagFile(buffer, scope) {
  if (scope !== PLANT && scope !== SALES) return { ok: false, rows: [], errors: [`Unknown scope '${scope}'`] };
  let raw;
  try {
    const wb = XLSX.read(buffer, { type: 'buffer', cellDates: false });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    if (!sheet) return { ok: false, rows: [], errors: ['The file has no sheet'] };
    // raw:true — formatted text turns a 12-digit UAN into '1.00012E+11'.
    raw = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: true });
  } catch (e) {
    return { ok: false, rows: [], errors: [`Could not read the file: ${e.message}`] };
  }
  if (!raw.length) return { ok: false, rows: [], errors: ['The file has no data rows'] };

  const headers = new Set(Object.keys(raw[0]).map(normaliseHeader));
  const missing = REQUIRED_COLUMNS[scope].filter((c) => !headers.has(c));
  if (missing.length) return { ok: false, rows: [], errors: [`Missing column(s): ${missing.join(', ')}`] };

  const errors = [];
  const seen = new Map();
  const rows = [];
  raw.forEach((r, i) => {
    const row = {};
    for (const [k, v] of Object.entries(r)) row[normaliseHeader(k)] = v;
    const line = i + 2;
    const code = cellText(row.code);
    if (!code) return; // fully blank line
    const company = scope === SALES ? cellText(row.company) : null;
    const key = scope === SALES ? `${code}|${company}` : code;
    if (seen.has(key)) {
      errors.push(`Row ${line}: code ${code}${scope === SALES ? ` / ${company}` : ''} repeats row ${seen.get(key)}`);
      return;
    }
    seen.set(key, line);
    const out = {
      line, code, company,
      name: cellText(row.name) || null,
      esi: parseYesNo(row.esi_applicable),
      pf: parseYesNo(row.pf_applicable),
      lwf: parseYesNo(row.lwf_applicable),
      esi_number: cellText(row.esi_number),
      uan: cellText(row.uan),
      note: cellText(row.note) || null,
    };
    for (const k of FLAG_KEYS) {
      if (out[k] === null) errors.push(`Row ${line}: ${FLAG_COL[k]} must be Y or N (got '${cellText(row[FLAG_COL[k]])}')`);
    }
    if (scope === SALES && !company) errors.push(`Row ${line}: company is blank`);
    rows.push(out);
  });
  if (!rows.length && !errors.length) errors.push('The file has no data rows');
  return { ok: errors.length === 0, rows, errors };
}

// ── Structure lookups (mirror compute exactly) ─────────────────────────────

/**
 * The structure row compute would use for `key` (plant 'YYYY-MM-DD' month
 * start, sales 'YYYY-MM'): in effect (`effective_from <= key`), else the latest
 * row regardless of date. Order: effective_from DESC, id DESC (plant compute
 * has no id tie-break; the planner blocks ties so the pick is never ambiguous).
 */
function structureForDate(db, scope, empId, key) {
  const { struct } = scopeTables(scope);
  return db.prepare(`SELECT * FROM ${struct} WHERE employee_id = ? AND effective_from <= ? ORDER BY effective_from DESC, id DESC LIMIT 1`).get(empId, key)
    || db.prepare(`SELECT * FROM ${struct} WHERE employee_id = ? ORDER BY effective_from DESC, id DESC LIMIT 1`).get(empId)
    || null;
}

/** Flags of the row in force at `key` — {pf, esi, lwf}; all 0 when the employee has no structure. */
function carryFlags(db, scope, empId, key) {
  const r = structureForDate(db, scope, empId, key);
  return {
    pf: r && r.pf_applicable ? 1 : 0,
    esi: r && r.esi_applicable ? 1 : 0,
    lwf: r && r.lwf_applicable ? 1 : 0,
  };
}

function latestStructure(db, scope, empId) {
  const { struct } = scopeTables(scope);
  return db.prepare(`SELECT * FROM ${struct} WHERE employee_id = ? ORDER BY effective_from DESC, id DESC LIMIT 1`).get(empId) || null;
}

const flagsOf = (r) => ({ esi: r.esi_applicable ? 1 : 0, pf: r.pf_applicable ? 1 : 0, lwf: r.lwf_applicable ? 1 : 0 });
const sameFlags = (a, b) => FLAG_KEYS.every((k) => (a[k] ? 1 : 0) === (b[k] ? 1 : 0));

// ── Planner ────────────────────────────────────────────────────────────────

function matchEmployee(db, scope, row) {
  if (scope === PLANT) {
    const e = db.prepare('SELECT * FROM employees WHERE code = ?').get(row.code);
    return e ? { emp: e } : { error: 'Unmatched code — no plant employee with this code' };
  }
  const all = db.prepare('SELECT * FROM sales_employees WHERE code = ?').all(row.code);
  const exact = all.filter((e) => e.company === row.company);
  if (exact.length === 1) return { emp: exact[0] };
  if (exact.length > 1) return { error: `Ambiguous — ${exact.length} sales employees with code ${row.code} in ${row.company}` };
  if (all.length === 0) return { error: 'Unmatched code — no sales employee with this code' };
  return { error: `Unmatched — code ${row.code} exists, but not in company '${row.company}'` };
}

function hasPayRow(db, scope, emp, effectiveMonth) {
  const [y, m] = effectiveMonth.split('-').map(Number);
  const t = scope === SALES ? 'sales_salary_computations' : 'salary_computations';
  const company = scope === SALES ? ' AND company = ?' : '';
  const args = scope === SALES ? [emp.code, m, y, emp.company] : [emp.code, m, y];
  try {
    return !!db.prepare(`SELECT 1 FROM ${t} WHERE employee_code = ? AND month = ? AND year = ?${company} LIMIT 1`).get(...args);
  } catch (e) { return false; }
}

function numberInUse(db, scope, col, value, empId) {
  const { master } = scopeTables(scope);
  const hit = db.prepare(`SELECT code FROM ${master} WHERE ${col} = ? AND id != ? LIMIT 1`).get(value, empId);
  return hit ? hit.code : null;
}

/**
 * planFlagChanges(db, {scope, effectiveMonth, rows}) → read-only plan.
 * Returns { ok, blocking[], rows[], totals }. Each row:
 *   { line, code, company, name, matched, error, warnings[], before, after,
 *     beforeE, flagChanged, numbers: {esi_number, uan}, numberChanged, changed }
 * `ok=false` when anything blocks the whole apply (nothing would be written).
 */
function planFlagChanges(db, { scope, effectiveMonth, rows }) {
  const blocking = [];
  if (scope !== PLANT && scope !== SALES) blocking.push(`Unknown scope '${scope}'`);
  if (!MONTH_RE.test(String(effectiveMonth || ''))) blocking.push(`effectiveMonth must be YYYY-MM (got '${effectiveMonth}')`);
  if (blocking.length) return { ok: false, blocking, rows: [], totals: emptyTotals() };

  const { struct } = scopeTables(scope);
  const { S, E } = keysFor(scope, effectiveMonth);
  const out = [];

  for (const row of rows || []) {
    const p = {
      line: row.line, code: row.code, company: row.company, name: row.name,
      matched: false, error: null, warnings: [],
      after: { esi: row.esi ? 1 : 0, pf: row.pf ? 1 : 0, lwf: row.lwf ? 1 : 0 },
      before: null, beforeE: null, flagChanged: false, numberChanged: false, changed: false,
      numbers: { esi_number: null, uan: null },
      structures: 0,
    };
    out.push(p);
    const m = matchEmployee(db, scope, row);
    if (m.error) { p.error = m.error; continue; }
    const emp = m.emp;
    p.matched = true;
    p.employeeId = emp.id;
    p.company = emp.company;
    p.name = p.name || emp.name;

    const all = db.prepare(`SELECT * FROM ${struct} WHERE employee_id = ? ORDER BY effective_from, id`).all(emp.id);
    p.structures = all.length;
    const bad = all.filter((r) => !DATE_RE[scope].test(String(r.effective_from || '')));
    if (bad.length) {
      blocking.push(`${row.code}: structure row(s) ${bad.map((r) => `#${r.id} '${r.effective_from}'`).join(', ')} have a malformed effective_from`);
      p.error = 'Malformed structure date (blocks the apply)';
      continue;
    }
    if (!all.length) { p.error = 'No salary structure — cannot carry flags (set the salary first)'; p.matched = true; continue; }

    const latest = latestStructure(db, scope, emp.id);
    const forE = structureForDate(db, scope, emp.id, E);
    const dupAt = (from) => all.filter((r) => r.effective_from === from).length > 1;
    if (dupAt(latest.effective_from)) {
      blocking.push(`${row.code}: two structure rows dated ${latest.effective_from} (latest) — compute's pick is ambiguous`);
      p.error = 'Duplicate structure date (blocks the apply)';
      continue;
    }
    if (forE && forE.effective_from !== E && dupAt(forE.effective_from)) {
      blocking.push(`${row.code}: two structure rows dated ${forE.effective_from} (in force at ${E}) — compute's pick is ambiguous`);
      p.error = 'Duplicate structure date (blocks the apply)';
      continue;
    }

    p.before = { esi: emp.esi_applicable ? 1 : 0, pf: emp.pf_applicable ? 1 : 0, lwf: emp.lwf_applicable ? 1 : 0 };
    p.beforeE = flagsOf(forE);
    const atOrAfterE = all.filter((r) => r.effective_from >= E);
    p.flagChanged = !sameFlags(p.before, p.after) || !sameFlags(p.beforeE, p.after)
      || atOrAfterE.some((r) => !sameFlags(flagsOf(r), p.after));

    // Numbers: blank = leave unchanged; malformed = warning, not written.
    for (const [col, re, label] of [['esi_number', ESI_NUMBER_RE, 'ESI number (10 digits)'], ['uan', UAN_RE, 'UAN (12 digits)']]) {
      const v = (row[col] || '').replace(/\s+/g, '');
      if (!v) continue;
      if (!re.test(v)) { p.warnings.push(`Malformed ${label} — not written`); continue; }
      const other = numberInUse(db, scope, col, v, emp.id);
      if (other) { p.warnings.push(`${col === 'uan' ? 'UAN' : 'ESI number'} already used by ${other} — not written`); continue; }
      if (String(emp[col] || '') !== v) { p.numbers[col] = v; p.numberChanged = true; }
    }

    // Warnings (§4.2)
    const gross = scope === SALES ? (forE.gross_salary || emp.gross_salary || 0) : (emp.gross_salary || forE.gross_salary || 0);
    if (p.after.esi && gross > ESI_THRESHOLD) p.warnings.push(`ESI=Y but gross ₹${gross} is above ₹${ESI_THRESHOLD} — ESI will not be deducted while gross stays above the ceiling`);
    if (emp.status !== 'Active') p.warnings.push(`Status is '${emp.status}'`);
    if (!hasPayRow(db, scope, emp, effectiveMonth)) p.warnings.push(`No pay row for ${effectiveMonth}`);
    if (p.after.pf) {
      const uan = p.numbers.uan || emp.uan;
      const pfNo = scope === PLANT ? emp.pf_number : null;
      if (!uan && !pfNo) p.warnings.push('PF=Y without a UAN / PF number');
    }

    p.changed = p.flagChanged || p.numberChanged;
  }

  return { ok: blocking.length === 0, blocking, rows: out, totals: totalsOf(out), keys: { S, E } };
}

function emptyTotals() {
  return { rows: 0, matched: 0, unmatched: 0, errors: 0, changed: 0, unchanged: 0, flagChanged: 0, numbersAdded: 0,
    after: { esi: 0, pf: 0, lwf: 0 }, warnings: 0 };
}

function totalsOf(rows) {
  const t = emptyTotals();
  for (const r of rows) {
    t.rows++;
    if (r.error) t.errors++;
    if (!r.matched) t.unmatched++;
    if (r.matched && !r.error) {
      t.matched++;
      if (r.changed) t.changed++; else t.unchanged++;
      if (r.flagChanged) t.flagChanged++;
      t.numbersAdded += (r.numbers.esi_number ? 1 : 0) + (r.numbers.uan ? 1 : 0);
      for (const k of FLAG_KEYS) t.after[k] += r.after[k];
    }
    t.warnings += r.warnings.length;
  }
  return t;
}

module.exports = {
  PLANT, SALES, FLAG_KEYS, FLAG_COL, ESI_THRESHOLD,
  normaliseHeader, parseYesNo, parseFlagFile, planFlagChanges,
  structureForDate, carryFlags, latestStructure, keysFor, monthKey, scopeTables,
  // internals exposed for tests and the write half
  _internal: { flagsOf, sameFlags, matchEmployee, DATE_RE, MONTH_RE },
};
