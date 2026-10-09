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

// ── Apply (write half) ─────────────────────────────────────────────────────

const crypto = require('crypto');
function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

const COPY_SKIP = new Set(['id', 'created_at', 'updated_at']);

/**
 * Insert a full copy of `src` dated `effectiveFrom` (L9: every column from
 * PRAGMA table_info except id/created_at/updated_at), with `flags` applied.
 * Sales copies are open (`effective_to` NULL). These two INSERTs are the only
 * structure inserts with a dynamic column list in this file; the writer guard
 * test pins them by their literal text.
 */
function copyStructure(db, scope, src, effectiveFrom, flags, batchId) {
  const { struct } = scopeTables(scope);
  const cols = db.prepare(`PRAGMA table_info(${struct})`).all().map((c) => c.name).filter((c) => !COPY_SKIP.has(c));
  const vals = cols.map((c) => {
    if (c === 'effective_from') return effectiveFrom;
    if (c === 'effective_to') return null;
    if (c === 'created_by') return `statutory_upload batch:${batchId}`;
    if (c === 'pf_applicable') return flags.pf ? 1 : 0;
    if (c === 'esi_applicable') return flags.esi ? 1 : 0;
    if (c === 'lwf_applicable') return flags.lwf ? 1 : 0;
    return src[c] === undefined ? null : src[c];
  });
  const placeholders = cols.map(() => '?').join(', ');
  const info = scope === SALES
    ? db.prepare(`INSERT INTO sales_salary_structures (${cols.join(', ')}) VALUES (${placeholders})`).run(...vals)
    : db.prepare(`INSERT INTO salary_structures (${cols.join(', ')}) VALUES (${placeholders})`).run(...vals);
  return Number(info.lastInsertRowid);
}

function setRowFlags(db, scope, rowId, flags) {
  const { struct } = scopeTables(scope);
  const extra = scope === SALES ? '' : ", updated_at = datetime('now')";
  db.prepare(`UPDATE ${struct} SET pf_applicable = ?, esi_applicable = ?, lwf_applicable = ?${extra} WHERE id = ?`)
    .run(flags.pf ? 1 : 0, flags.esi ? 1 : 0, flags.lwf ? 1 : 0, rowId);
}

function makeAudit(db, batchId, user) {
  const stmt = db.prepare(`
    INSERT INTO audit_log (table_name, record_id, field_name, old_value, new_value, changed_by, stage, remark, employee_code, action_type)
    VALUES (?, ?, ?, ?, ?, ?, 'statutory_upload', ?, ?, ?)
  `);
  return (table, recordId, field, oldV, newV, code, actionType) =>
    stmt.run(table, recordId, field, String(oldV ?? ''), String(newV ?? ''), user, `batch:${batchId}`, code, actionType);
}

function findAppliedBatch(db, scope, effectiveMonth, sha) {
  return db.prepare(`SELECT id FROM statutory_flag_batches WHERE scope = ? AND effective_month = ? AND file_sha256 = ? AND status = 'applied'`)
    .get(scope, effectiveMonth, sha) || null;
}

/**
 * applyFlagChanges(db, {scope, effectiveMonth, rows, user, fileName, sha256, expectedSha256})
 * One IMMEDIATE transaction. The batch row is inserted first ('applying'),
 * the plan is rebuilt inside the transaction (the preview is never trusted),
 * then for every changed employee:
 *   1. read `latest` (compute's fallback row) and `forE` before any write;
 *   2. FREEZE — no row dated <= S → insert a full copy of `latest` dated S
 *      with latest's own (pre-write) flags;
 *   3. rows dated exactly E → update their flags; else insert a full copy of
 *      `forE` dated E with the new flags (sales effective_to NULL);
 *   4. update the flags on every row dated after E;
 *   5. master flags, and numbers when non-blank and valid;
 *   6. audit rows on this handle.
 * Steps 2–4 run only when a structure row actually needs new flags (a
 * master-only difference never touches structures).
 * Returns {ok, status?, code?, error?, batchId, summary}.
 */
function applyFlagChanges(db, { scope, effectiveMonth, rows, user, fileName, sha256: sha, expectedSha256 }) {
  if (!sha) return { ok: false, status: 400, code: 'NO_HASH', error: 'File hash missing' };
  if (expectedSha256 && expectedSha256 !== sha) {
    return { ok: false, status: 409, code: 'HASH_MISMATCH', error: 'The file differs from the one previewed — preview it again' };
  }
  const dup = findAppliedBatch(db, scope, effectiveMonth, sha);
  if (dup) return { ok: false, status: 409, code: 'DUPLICATE_BATCH', batchId: dup.id, error: `This file was already applied for ${scope} ${effectiveMonth} (batch ${dup.id})` };

  const actor = user || 'admin';
  const run = db.transaction(() => {
    if (findAppliedBatch(db, scope, effectiveMonth, sha)) {
      const e = new Error('duplicate'); e.code = 'DUPLICATE_BATCH'; throw e;
    }
    const batchId = Number(db.prepare(`
      INSERT INTO statutory_flag_batches (scope, effective_month, file_name, file_sha256, row_count, status, applied_by)
      VALUES (?, ?, ?, ?, ?, 'applying', ?)
    `).run(scope, effectiveMonth, fileName || null, sha, (rows || []).length, actor).lastInsertRowid);

    const plan = planFlagChanges(db, { scope, effectiveMonth, rows });
    if (!plan.ok) { const e = new Error('blocked'); e.code = 'BLOCKED'; e.blocking = plan.blocking; throw e; }

    const { master, struct } = scopeTables(scope);
    const { S, E } = plan.keys;
    const audit = makeAudit(db, batchId, actor);
    const undoRows = [];
    const counts = { employees: 0, flagEmployees: 0, numberEmployees: 0, freezeRows: 0, effectiveRows: 0, rowsUpdatedAtE: 0, laterRowsUpdated: 0 };

    for (const p of plan.rows) {
      if (!p.matched || p.error || !p.changed) continue;
      counts.employees++;
      const emp = db.prepare(`SELECT * FROM ${master} WHERE id = ?`).get(p.employeeId);
      const all = db.prepare(`SELECT * FROM ${struct} WHERE employee_id = ? ORDER BY effective_from, id`).all(emp.id);
      const latest = latestStructure(db, scope, emp.id);          // 1. before any write
      const forE = structureForDate(db, scope, emp.id, E);
      const undo = {
        code: emp.code, company: emp.company, name: emp.name,
        master: flagsOf(emp), beforeE: flagsOf(forE),
        numbers: { esi_number: emp.esi_number || null, uan: emp.uan || null },
        structures: all.map((r) => ({ id: r.id, effective_from: r.effective_from, ...flagsOf(r) })),
        inserted: [],
      };

      if (p.flagChanged) {
        counts.flagEmployees++;
        const structNeedsChange = !sameFlags(flagsOf(forE), p.after)
          || all.some((r) => r.effective_from >= E && !sameFlags(flagsOf(r), p.after));
        if (structNeedsChange) {
          // 2. freeze
          if (!all.some((r) => r.effective_from <= S)) {
            const id = copyStructure(db, scope, latest, S, flagsOf(latest), batchId);
            counts.freezeRows++;
            undo.inserted.push({ id, effective_from: S, kind: 'freeze' });
            audit(struct, id, 'structure_row', '', `freeze ${S} = copy of #${latest.id} (${latest.effective_from}), flags unchanged`, emp.code, 'statutory_freeze_row');
          }
          // 3. effective row at E
          const atE = all.filter((r) => r.effective_from === E);
          if (atE.length) {
            for (const r of atE) {
              if (sameFlags(flagsOf(r), p.after)) continue;
              setRowFlags(db, scope, r.id, p.after);
              counts.rowsUpdatedAtE++;
              for (const k of FLAG_KEYS) if ((r[FLAG_COL[k]] ? 1 : 0) !== p.after[k]) audit(struct, r.id, FLAG_COL[k], r[FLAG_COL[k]] ? 1 : 0, p.after[k], emp.code, 'statutory_flag_change');
            }
          } else {
            const id = copyStructure(db, scope, forE, E, p.after, batchId);
            counts.effectiveRows++;
            undo.inserted.push({ id, effective_from: E, kind: 'effective' });
            audit(struct, id, 'structure_row', '', `effective ${E} = copy of #${forE.id} (${forE.effective_from}), flags esi=${p.after.esi} pf=${p.after.pf} lwf=${p.after.lwf}`, emp.code, 'statutory_effective_row');
          }
          // 4. every later row
          for (const r of all.filter((x) => x.effective_from > E)) {
            if (sameFlags(flagsOf(r), p.after)) continue;
            setRowFlags(db, scope, r.id, p.after);
            counts.laterRowsUpdated++;
            for (const k of FLAG_KEYS) if ((r[FLAG_COL[k]] ? 1 : 0) !== p.after[k]) audit(struct, r.id, FLAG_COL[k], r[FLAG_COL[k]] ? 1 : 0, p.after[k], emp.code, 'statutory_flag_change');
          }
        }
        // 5a. master flags
        const before = flagsOf(emp);
        if (!sameFlags(before, p.after)) {
          if (scope === SALES) {
            db.prepare(`UPDATE sales_employees SET pf_applicable = ?, esi_applicable = ?, lwf_applicable = ?, updated_at = datetime('now'), updated_by = ? WHERE id = ?`)
              .run(p.after.pf, p.after.esi, p.after.lwf, actor, emp.id);
          } else {
            db.prepare(`UPDATE employees SET pf_applicable = ?, esi_applicable = ?, lwf_applicable = ?, updated_at = datetime('now') WHERE id = ?`)
              .run(p.after.pf, p.after.esi, p.after.lwf, emp.id);
          }
          for (const k of FLAG_KEYS) if (before[k] !== p.after[k]) audit(master, emp.id, FLAG_COL[k], before[k], p.after[k], emp.code, 'statutory_flag_change');
        }
      }
      // 5b. numbers (non-blank, valid, not used elsewhere — decided by the planner)
      if (p.numberChanged) {
        counts.numberEmployees++;
        for (const col of ['esi_number', 'uan']) {
          const v = p.numbers[col];
          if (!v) continue;
          db.prepare(`UPDATE ${master} SET ${col} = ? WHERE id = ?`).run(v, emp.id);
          audit(master, emp.id, col, emp[col] || '', v, emp.code, 'statutory_number_change');
        }
      }
      undoRows.push(undo);
    }

    const summary = { totals: plan.totals, counts, keys: { S, E } };
    const undoJson = { scope, effectiveMonth, batchId, rows: undoRows };
    db.prepare(`UPDATE statutory_flag_batches SET status = 'applied', changed_count = ?, summary_json = ?, undo_json = ? WHERE id = ?`)
      .run(counts.employees, JSON.stringify(summary), JSON.stringify(undoJson), batchId);
    return { batchId, summary };
  });

  try {
    const out = run.immediate();
    return { ok: true, ...out };
  } catch (e) {
    if (e.code === 'BLOCKED') return { ok: false, status: 400, code: 'BLOCKED', error: 'The file cannot be applied', blocking: e.blocking };
    if (e.code === 'DUPLICATE_BATCH' || /UNIQUE constraint failed: statutory_flag_batches/.test(e.message)) {
      return { ok: false, status: 409, code: 'DUPLICATE_BATCH', error: `This file was already applied for ${scope} ${effectiveMonth}` };
    }
    throw e;
  }
}

/**
 * The before-values of an applied batch, in the upload layout, as an .xlsx
 * buffer (never written to disk — N9: it holds names). Flags are the ones
 * that were in force at the effective month (what compute used). Number
 * columns are left blank: blank means "unchanged", so numbers the batch added
 * stay. Re-applying it restores the flags from E onward; the freeze and
 * effective rows stay (carrying the original flags again).
 */
function buildUndoWorkbook(db, batchId) {
  const b = db.prepare('SELECT * FROM statutory_flag_batches WHERE id = ?').get(batchId);
  if (!b) return { ok: false, status: 404, error: 'Batch not found' };
  if (b.status !== 'applied' || !b.undo_json) return { ok: false, status: 409, error: `Batch ${batchId} is '${b.status}' — nothing to undo` };
  const u = JSON.parse(b.undo_json);
  const yn = (v) => (v ? 'Y' : 'N');
  const note = `undo of batch ${b.id}`;
  const aoa = b.scope === SALES
    ? [['code', 'company', 'name', 'esi_applicable', 'pf_applicable', 'lwf_applicable', 'esi_number', 'uan', 'note']]
    : [['code', 'name', 'type', 'esi_applicable', 'pf_applicable', 'lwf_applicable', 'esi_number', 'uan', 'note']];
  for (const r of u.rows) {
    const f = r.beforeE;
    if (b.scope === SALES) aoa.push([r.code, r.company, r.name, yn(f.esi), yn(f.pf), yn(f.lwf), '', '', note]);
    else aoa.push([r.code, r.name, '', yn(f.esi), yn(f.pf), yn(f.lwf), '', '', note]);
  }
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  // codes as text so leading zeros / long codes survive a round trip
  for (let i = 2; i <= aoa.length; i++) { const c = ws[`A${i}`]; if (c) { c.t = 's'; c.v = String(c.v); } }
  XLSX.utils.book_append_sheet(wb, ws, 'flags');
  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  return { ok: true, buffer, fileName: `statutory_flags_undo_${b.scope}_${b.effective_month}_batch${b.id}.xlsx`, rows: u.rows.length, scope: b.scope, effectiveMonth: b.effective_month };
}

function listBatches(db, { limit = 50 } = {}) {
  return db.prepare(`
    SELECT id, scope, effective_month, file_name, file_sha256, row_count, changed_count, status, applied_by, applied_at, summary_json
      FROM statutory_flag_batches ORDER BY id DESC LIMIT ?
  `).all(limit).map((r) => ({ ...r, summary: r.summary_json ? JSON.parse(r.summary_json) : null, summary_json: undefined }));
}

module.exports = {
  PLANT, SALES, FLAG_KEYS, FLAG_COL, ESI_THRESHOLD,
  normaliseHeader, parseYesNo, parseFlagFile, planFlagChanges,
  applyFlagChanges, buildUndoWorkbook, listBatches, sha256,
  structureForDate, carryFlags, latestStructure, keysFor, monthKey, scopeTables,
  // internals exposed for tests and the write half
  _internal: { flagsOf, sameFlags, matchEmployee, DATE_RE, MONTH_RE },
};
