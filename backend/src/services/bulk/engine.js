/**
 * Bulk entry engine (P3-01, MASTER_PLAN §7.2). Generic; kinds live in ./kinds.
 *
 *   preview → nothing written; rows planned; applicable rows split into groups
 *             of ≤ 50, each with its own plan hash.
 *   apply   → ONE group = ONE batch, inside ONE IMMEDIATE transaction: re-plan,
 *             refuse on any change (hash) or error row, then write every row or
 *             none (all-or-nothing, owner ruling R3).
 *   undo    → whole batch or nothing; refused while any row has moved on.
 *
 * Functions never throw to the caller: they return { ok:false, status, code, error }.
 * (Plain objects, not error classes — instanceof is unreliable across jest realms.)
 */
const crypto = require('crypto');
const { logAudit } = require('../../database/db');

const BULK_MAX_ROWS = 50;
const BULK_PREVIEW_MAX = 1000;

const KINDS = {
  'extra-duty': require('./kinds/extraDuty'),
};

function getKind(name) { return Object.prototype.hasOwnProperty.call(KINDS, name) ? KINDS[name] : null; }

const fail = (status, code, error, extra = {}) => ({ ok: false, status, code, error, ...extra });
function bulkThrow(status, code, error, extra = {}) {
  const e = new Error(error);
  e.bulk = { status, code, error, ...extra };
  throw e;
}

const APPLICABLE = (p) => p.state === 'ok' || p.state === 'warning';

function hashGroup(kindName, common, planned) {
  const payload = {
    kind: kindName,
    common,
    rows: planned.map(r => [r.code, r.duty, r.plan.state, r.plan.action, r.plan.fingerprint]),
  };
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function planAll(db, kind, common, rows) {
  const ctx = kind.context(db, common);
  // planRow may set r.duty / r.code (master spelling) — plan first, then copy.
  return rows.map(r => { const row = { ...r, messages: [...(r.messages || [])] }; const plan = kind.planRow(db, row, common, ctx); return { ...row, plan }; });
}

function displayRow(r) {
  return {
    rowNo: r.rowNo, code: r.code, dutyDays: r.duty,
    state: r.plan.state, action: r.plan.action,
    messages: [...(r.messages || []), ...r.plan.messages],
    ...r.plan.display,
  };
}

function countStates(planned) {
  const c = { total: planned.length, ok: 0, warning: 0, error: 0, skipped: 0 };
  for (const r of planned) c[r.plan.state]++;
  return c;
}

function prepare(kindName, body) {
  const kind = getKind(kindName);
  if (!kind) return { res: fail(404, 'BULK_UNKNOWN_KIND', `Unknown bulk type "${kindName}"`) };
  const c = kind.normaliseCommon(body?.common || {});
  if (!c.ok) return { res: fail(400, 'BULK_BAD_COMMON', c.error, { fields: c.fields }) };
  const n = kind.normaliseRows(body?.rows);
  if (!n.rows.length) return { res: fail(400, 'BULK_NO_ROWS', 'Add at least one person') };
  return { kind, common: c.value, rows: n.rows };
}

/** Plan only. Groups = applicable rows in order, ≤ 50 each; every skipped row rides with group 0. */
function preview(db, kindName, body) {
  const p = prepare(kindName, body);
  if (p.res) return p.res;
  if (p.rows.length > BULK_PREVIEW_MAX) return fail(400, 'BULK_PREVIEW_LIMIT', `Check at most ${BULK_PREVIEW_MAX} people at a time`);
  const planned = planAll(db, p.kind, p.common, p.rows);
  const applicable = planned.filter(r => APPLICABLE(r.plan));
  const skipped = planned.filter(r => r.plan.state === 'skipped');
  const groups = [];
  for (let i = 0; i < applicable.length; i += BULK_MAX_ROWS) {
    const members = applicable.slice(i, i + BULK_MAX_ROWS);
    if (i === 0) members.push(...skipped);
    members.sort((a, b) => a.rowNo - b.rowNo);
    groups.push({
      index: groups.length,
      rowNos: members.map(r => r.rowNo),
      applyCount: members.filter(r => APPLICABLE(r.plan)).length,
      planHash: hashGroup(kindName, p.common, members),
    });
  }
  return {
    ok: true, common: p.common, rows: planned.map(displayRow), counts: countStates(planned), groups,
    maxRows: BULK_MAX_ROWS,
  };
}

/** Apply ONE group as ONE batch. */
function apply(db, kindName, body, user) {
  const p = prepare(kindName, body);
  if (p.res) return p.res;
  const { kind, common, rows } = p;
  if (!body.planHash) return fail(400, 'BULK_NO_PLAN', 'Check the rows first');
  if (rows.length > BULK_PREVIEW_MAX) return fail(400, 'BULK_ROW_LIMIT', `At most ${BULK_MAX_ROWS} grants per batch`);
  const options = kind.normaliseOptions(body.options || {});
  const groupId = typeof body.groupId === 'string' ? body.groupId.slice(0, 64) : null;
  const groupIndex = Number.isInteger(body.groupIndex) ? body.groupIndex : null;
  const groupSize = Number.isInteger(body.groupSize) ? body.groupSize : null;
  const period = kind.periodOf(common);

  try {
    return db.transaction(() => {
      const planned = planAll(db, kind, common, rows);
      const applicable = planned.filter(r => APPLICABLE(r.plan));
      if (applicable.length > BULK_MAX_ROWS) {
        bulkThrow(400, 'BULK_ROW_LIMIT', `At most ${BULK_MAX_ROWS} grants per batch — this one has ${applicable.length}`);
      }
      if (!applicable.length) bulkThrow(400, 'BULK_NOTHING_TO_SAVE', 'Nothing to save — every row is already granted');
      const errors = planned.filter(r => r.plan.state === 'error');
      if (errors.length) {
        bulkThrow(409, 'BULK_ROW_ERROR', 'Some rows have problems — leave them out or fix them, then check again',
          { rows: errors.map(displayRow) });
      }
      if (hashGroup(kindName, common, planned) !== body.planHash) {
        bulkThrow(409, 'BULK_PLAN_CHANGED', 'Data changed since you checked — check again', { rows: planned.map(displayRow) });
      }
      const counts = countStates(planned);
      const batchId = db.prepare(`INSERT INTO bulk_batches
        (kind, company, month, year, source, status, plan_hash, row_count, ok_count, warn_count, error_count,
         skipped_count, common_json, options_json, group_id, group_index, group_size, created_by, applied_at)
        VALUES (?, NULL, ?, ?, 'form', 'applied', ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`).run(
        kindName, period.month, period.year, body.planHash, planned.length, counts.ok, counts.warning,
        counts.skipped, JSON.stringify(common), JSON.stringify(options), groupId, groupIndex, groupSize, user
      ).lastInsertRowid;
      const insRow = db.prepare(`INSERT INTO bulk_rows
        (batch_id, row_no, row_key, input_json, resolved_json, state, action, messages_json, before_json, after_json, target_table, target_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      const result = { created: 0, updated: 0, skipped: 0, approved: 0 };
      for (const r of planned) {
        let applied = { targetTable: null, targetId: null, before: null, after: null };
        if (APPLICABLE(r.plan)) {
          applied = kind.applyRow(db, r, r.plan, common, { batchId, user, options });
          if (r.plan.action === 'create') result.created++; else result.updated++;
          if (applied.approved) result.approved++;
        } else {
          result.skipped++;
        }
        insRow.run(batchId, r.rowNo, r.code, JSON.stringify({ code: r.code, duty_days: r.duty }),
          JSON.stringify(r.plan.display), r.plan.state, r.plan.action,
          JSON.stringify([...(r.messages || []), ...r.plan.messages]),
          applied.before ? JSON.stringify(applied.before) : null,
          applied.after ? JSON.stringify(applied.after) : null,
          applied.targetTable, applied.targetId);
      }
      logAudit('bulk_batches', batchId, 'status', '', 'applied', 'BULK_CREATE',
        `${kindName} ${kind.describe(common)}: created ${result.created}, replaced ${result.updated}, skipped ${result.skipped}` +
        `, HR-approved ${options.hrApprove ? 'yes' : 'no'}` +
        (groupSize ? `, batch ${(groupIndex ?? 0) + 1} of ${groupSize}` : '') + `, bulk batch #${batchId}`, user);
      return { ok: true, batchId: Number(batchId), counts: result };
    }).immediate();
  } catch (err) {
    if (err && err.bulk) return { ok: false, ...err.bulk };
    throw err;
  }
}

function undo(db, batchId, reason, user) {
  const why = String(reason || '').trim();
  if (why.length < 5) return fail(400, 'BULK_REASON_REQUIRED', 'Give a reason (at least 5 characters)');
  try {
    return db.transaction(() => {
      const batch = db.prepare('SELECT * FROM bulk_batches WHERE id = ?').get(batchId);
      if (!batch) bulkThrow(404, 'BULK_NOT_FOUND', 'Batch not found');
      if (batch.status !== 'applied') bulkThrow(409, 'BULK_NOT_UNDOABLE', `This batch is ${batch.status} — it cannot be undone`);
      const kind = getKind(batch.kind);
      if (!kind) bulkThrow(409, 'BULK_UNKNOWN_KIND', `Unknown bulk type "${batch.kind}"`);
      const rows = db.prepare(`SELECT * FROM bulk_rows WHERE batch_id = ? AND target_id IS NOT NULL AND undone = 0
        AND state IN ('ok','warning') ORDER BY row_no`).all(batchId);
      const blocked = [];
      for (const r of rows) {
        const u = kind.undoable(db, r, batch);
        if (!u.ok) blocked.push({ rowNo: r.row_no, code: r.row_key, reason: u.reason });
      }
      if (blocked.length) {
        bulkThrow(409, 'BULK_UNDO_BLOCKED',
          `${blocked.length} of ${rows.length} rows have moved on — nothing was undone`, { rows: blocked });
      }
      for (const r of rows) kind.undoRow(db, r, batch, user, why);
      db.prepare('UPDATE bulk_rows SET undone = 1 WHERE batch_id = ? AND target_id IS NOT NULL').run(batchId);
      db.prepare(`UPDATE bulk_batches SET status = 'undone', undone_by = ?, undone_at = datetime('now'), undo_reason = ?
        WHERE id = ? AND status = 'applied'`).run(user, why, batchId);
      logAudit('bulk_batches', batchId, 'status', 'applied', 'undone', 'BULK_UNDO',
        `${batch.kind} bulk batch #${batchId}: ${rows.length} row(s) undone. Reason: "${why}"`, user);
      return { ok: true, undone: rows.length };
    }).immediate();
  } catch (err) {
    if (err && err.bulk) return { ok: false, ...err.bulk };
    throw err;
  }
}

function shapeBatch(b) {
  let common = {};
  try { common = JSON.parse(b.common_json || '{}'); } catch { /* keep {} */ }
  let options = {};
  try { options = JSON.parse(b.options_json || '{}'); } catch { /* keep {} */ }
  const kind = getKind(b.kind);
  return {
    id: b.id, kind: b.kind, month: b.month, year: b.year, status: b.status,
    rowCount: b.row_count, okCount: b.ok_count, warnCount: b.warn_count, skippedCount: b.skipped_count,
    applyCount: (b.ok_count || 0) + (b.warn_count || 0),
    summary: kind ? kind.describe(common) : '', common, options,
    groupId: b.group_id, groupIndex: b.group_index, groupSize: b.group_size,
    createdBy: b.created_by, createdAt: b.created_at,
    undoneBy: b.undone_by, undoneAt: b.undone_at, undoReason: b.undo_reason,
  };
}

function listBatches(db, { kind, month, year, limit } = {}) {
  let sql = 'SELECT * FROM bulk_batches WHERE 1=1';
  const args = [];
  if (kind) { sql += ' AND kind = ?'; args.push(kind); }
  if (month) { sql += ' AND month = ?'; args.push(parseInt(month, 10)); }
  if (year) { sql += ' AND year = ?'; args.push(parseInt(year, 10)); }
  const n = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
  sql += ` ORDER BY id DESC LIMIT ${n}`;
  return db.prepare(sql).all(...args).map(shapeBatch);
}

function getBatch(db, id) {
  const b = db.prepare('SELECT * FROM bulk_batches WHERE id = ?').get(id);
  if (!b) return null;
  const rows = db.prepare('SELECT * FROM bulk_rows WHERE batch_id = ? ORDER BY row_no').all(id).map(r => {
    let display = {}; let messages = [];
    try { display = JSON.parse(r.resolved_json || '{}'); } catch { /* keep */ }
    try { messages = JSON.parse(r.messages_json || '[]'); } catch { /* keep */ }
    return { rowNo: r.row_no, code: r.row_key, state: r.state, action: r.action, messages,
      targetId: r.target_id, undone: !!r.undone, ...display };
  });
  return { ...shapeBatch(b), rows };
}

module.exports = { preview, apply, undo, listBatches, getBatch, getKind, BULK_MAX_ROWS, BULK_PREVIEW_MAX, hashGroup };
