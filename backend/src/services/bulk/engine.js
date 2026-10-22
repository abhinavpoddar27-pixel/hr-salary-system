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
const { notify } = require('../leaveTriggers');

const BULK_MAX_ROWS = 50;
const BULK_PREVIEW_MAX = 1000;

const KINDS = {
  'extra-duty': require('./kinds/extraDuty'),
  'salary-revision': require('./kinds/salaryRevision'), // P5-04 — first approval kind
  'master-edit': require('./kinds/masterEdit').direct,              // P5-02 — direct master fields
  'master-edit-sensitive': require('./kinds/masterEdit').sensitive, // P5-02 — bank / statutory / company / leaving (finance)
};
// P5-01: a fictional approval kind for tests and the check script only. Never set on Railway.
if (process.env.BULK_TEST_KINDS === '1') KINDS['test-approval'] = require('./kinds/testApproval');

function getKind(name) { return Object.prototype.hasOwnProperty.call(KINDS, name) ? KINDS[name] : null; }

/* ── P5-01 kind hooks. Every default is the extra-duty expression, so ED is byte-identical. ── */
// Review F5: an approval kind's inputOf and rowFromInput must mirror EXACTLY — approve rebuilds every row from the stored
// input_json via rowFromInput and re-plans it; anything inputOf drops cannot be planned again (the hash then refuses).
const DEFAULT_ROLES = { create: ['admin', 'hr'], approve: ['admin', 'finance'] };
const rolesOf = (kind) => ({ ...DEFAULT_ROLES, ...(kind.roles || {}) });
const needsApproval = (kind) => kind.requiresApproval === true;
const hashRowOf = (kind, r) => (kind.hashRow ? kind.hashRow(r)
  : [r.code, r.duty, r.plan.state, r.plan.action, r.plan.fingerprint]);
const inputOf = (kind, r) => (kind.inputOf ? kind.inputOf(r) : { code: r.code, duty_days: r.duty });
const displayExtraOf = (kind, r) => (kind.displayExtra ? kind.displayExtra(r) : { dutyDays: r.duty });
const nounOf = (kind) => kind.noun || 'grants';
const rowFromInputOf = (kind, input, rowNo) => (kind.rowFromInput ? kind.rowFromInput(input, rowNo)
  : { rowNo, code: String(input.code || ''), dutyRaw: input.duty_days, messages: [] });

/** Same username, trimmed, case-insensitive; an empty name never matches (salary-input.js P1-23 rule). */
const sameUser = (a, b) => !!a && !!b && String(a).trim().toLowerCase() === String(b).trim().toLowerCase();

/** Kinds a role may see: it may create them, or (approval kinds) decide them. */
function visibleKinds(role) {
  return Object.keys(KINDS).filter((k) => {
    const kind = KINDS[k]; const r = rolesOf(kind);
    return r.create.includes(role) || (needsApproval(kind) && r.approve.includes(role));
  });
}

const fail = (status, code, error, extra = {}) => ({ ok: false, status, code, error, ...extra });
function bulkThrow(status, code, error, extra = {}) {
  const e = new Error(error);
  e.bulk = { status, code, error, ...extra };
  throw e;
}

const APPLICABLE = (p) => p.state === 'ok' || p.state === 'warning';

function hashGroup(kindName, common, planned) {
  const kind = getKind(kindName) || {};
  const payload = {
    kind: kindName,
    common,
    rows: planned.map(r => hashRowOf(kind, r)),
  };
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function planAll(db, kind, common, rows) {
  const ctx = kind.context(db, common);
  // planRow may set r.duty / r.code (master spelling) — plan first, then copy.
  return rows.map(r => { const row = { ...r, messages: [...(r.messages || [])] }; const plan = kind.planRow(db, row, common, ctx); return { ...row, plan }; });
}

function displayRow(r, kind = {}) {
  return {
    rowNo: r.rowNo, code: r.code, ...displayExtraOf(kind, r),
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

function prepare(kindName, body, db) {
  const kind = getKind(kindName);
  if (!kind) return { res: fail(404, 'BULK_UNKNOWN_KIND', `Unknown bulk type "${kindName}"`) };
  const c = kind.normaliseCommon(body?.common || {}, db); // P5-04: a kind may read the DB for its defaults
  if (!c.ok) return { res: fail(400, 'BULK_BAD_COMMON', c.error, { fields: c.fields }) };
  const n = kind.normaliseRows(body?.rows);
  if (!n.rows.length) return { res: fail(400, 'BULK_NO_ROWS', 'Add at least one person') };
  return { kind, common: c.value, rows: n.rows };
}

/** Plan only. Groups = applicable rows in order, ≤ 50 each; every skipped row rides with group 0. */
function preview(db, kindName, body) {
  const p = prepare(kindName, body, db);
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
    ok: true, common: p.common, rows: planned.map(r => displayRow(r, p.kind)), counts: countStates(planned), groups,
    ...(needsApproval(p.kind) ? { requiresApproval: true } : {}),
    maxRows: BULK_MAX_ROWS,
  };
}

/** Apply ONE group as ONE batch. */
function apply(db, kindName, body, user) {
  const p = prepare(kindName, body, db);
  if (p.res) return p.res;
  const { kind, common, rows } = p;
  if (needsApproval(kind)) return fail(409, 'BULK_NEEDS_APPROVAL', 'This kind is sent to finance for approval — use "Send to finance"');
  if (!body.planHash) return fail(400, 'BULK_NO_PLAN', 'Check the rows first');
  if (rows.length > BULK_PREVIEW_MAX) return fail(400, 'BULK_ROW_LIMIT', `Too many rows in one request (max ${BULK_PREVIEW_MAX}); a batch saves at most ${BULK_MAX_ROWS}`);
  const options = kind.normaliseOptions(body.options || {});
  const groupId = typeof body.groupId === 'string' ? body.groupId.slice(0, 64) : null;
  const groupIndex = Number.isInteger(body.groupIndex) ? body.groupIndex : null;
  const groupSize = Number.isInteger(body.groupSize) ? body.groupSize : null;
  const period = kind.periodOf(common);

  try {
    return db.transaction(() => {
      const planned = checkedPlan(db, kindName, kind, common, rows, body.planHash);
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
        insRow.run(batchId, r.rowNo, r.code, JSON.stringify(inputOf(kind, r)),
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

/**
 * Re-plan inside the caller's transaction and refuse (throw) on: > 50 applicable rows, nothing to save,
 * any error row, plan hash mismatch. Shared by apply, submit and approve.
 */
function checkedPlan(db, kindName, kind, common, rows, planHash, { changedText } = {}) {
  const planned = planAll(db, kind, common, rows);
  const applicable = planned.filter(r => APPLICABLE(r.plan));
  if (applicable.length > BULK_MAX_ROWS) {
    bulkThrow(400, 'BULK_ROW_LIMIT', `At most ${BULK_MAX_ROWS} ${nounOf(kind)} per batch — this one has ${applicable.length}`);
  }
  if (!applicable.length) bulkThrow(400, 'BULK_NOTHING_TO_SAVE', kind.nothingToSave || 'Nothing to save — every row is already granted');
  const errors = planned.filter(r => r.plan.state === 'error');
  if (errors.length) {
    bulkThrow(409, 'BULK_ROW_ERROR', changedText || 'Some rows have problems — leave them out or fix them, then check again',
      { rows: errors.map(r => displayRow(r, kind)) });
  }
  if (hashGroup(kindName, common, planned) !== planHash) {
    bulkThrow(409, 'BULK_PLAN_CHANGED', changedText || 'Data changed since you checked — check again',
      { rows: planned.map(r => displayRow(r, kind)) });
  }
  return planned;
}

const kindLabel = (kind, name) => kind.label || name;
const say = (db, role, type, message, link) => notify(db, role, type, message, link);
const QUEUE_LINK = '/finance-verification?tab=bulk';

/** P5-01: approval kinds — save ONE group as ONE batch with status 'submitted'. Nothing is applied. */
function submit(db, kindName, body, user) {
  const p = prepare(kindName, body, db);
  if (p.res) return p.res;
  const { kind, common, rows } = p;
  if (!needsApproval(kind)) return fail(409, 'BULK_NO_APPROVAL_STAGE', 'This kind is saved directly — use Save');
  if (!body.planHash) return fail(400, 'BULK_NO_PLAN', 'Check the rows first');
  if (rows.length > BULK_PREVIEW_MAX) return fail(400, 'BULK_ROW_LIMIT', `Too many rows in one request (max ${BULK_PREVIEW_MAX}); a batch saves at most ${BULK_MAX_ROWS}`);
  const options = kind.normaliseOptions ? kind.normaliseOptions(body.options || {}) : {};
  const groupId = typeof body.groupId === 'string' ? body.groupId.slice(0, 64) : null;
  const groupIndex = Number.isInteger(body.groupIndex) ? body.groupIndex : null;
  const groupSize = Number.isInteger(body.groupSize) ? body.groupSize : null;
  const period = kind.periodOf(common);
  try {
    return db.transaction(() => {
      const planned = checkedPlan(db, kindName, kind, common, rows, body.planHash);
      const counts = countStates(planned);
      const money = kind.moneyTotal ? kind.moneyTotal(planned) : null;
      const batchId = db.prepare(`INSERT INTO bulk_batches
        (kind, company, month, year, source, status, plan_hash, row_count, ok_count, warn_count, error_count,
         skipped_count, common_json, options_json, group_id, group_index, group_size, created_by,
         submitted_by, submitted_at, money_total)
        VALUES (?, NULL, ?, ?, 'form', 'submitted', ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)`).run(
        kindName, period.month ?? null, period.year ?? null, body.planHash, planned.length, counts.ok, counts.warning,
        counts.skipped, JSON.stringify(common), JSON.stringify(options), groupId, groupIndex, groupSize, user, user,
        money === null || money === undefined ? null : Math.round(money * 100) / 100
      ).lastInsertRowid;
      const insRow = db.prepare(`INSERT INTO bulk_rows
        (batch_id, row_no, row_key, input_json, resolved_json, state, action, messages_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
      for (const r of planned) {
        insRow.run(batchId, r.rowNo, r.code, JSON.stringify(inputOf(kind, r)), JSON.stringify(r.plan.display || {}),
          r.plan.state, r.plan.action, JSON.stringify([...(r.messages || []), ...r.plan.messages]));
      }
      const applyCount = counts.ok + counts.warning;
      logAudit('bulk_batches', batchId, 'status', '', 'submitted', 'BULK_SUBMIT',
        `${kindName} ${kind.describe(common)}: ${applyCount} row(s) sent for approval, ${counts.skipped} left as is` +
        (money !== null && money !== undefined ? `, total ₹${Math.round(money * 100) / 100}` : '') +
        (groupSize ? `, batch ${(groupIndex ?? 0) + 1} of ${groupSize}` : '') + `, bulk batch #${batchId}`, user);
      say(db, 'finance', 'BULK_SUBMITTED',
        `Bulk ${kindLabel(kind, kindName)} batch #${batchId} (${applyCount} row(s)) from ${user} is waiting for approval`, QUEUE_LINK);
      return { ok: true, batchId: Number(batchId), status: 'submitted', counts: { submitted: applyCount, skipped: counts.skipped } };
    }).immediate();
  } catch (err) {
    if (err && err.bulk) return { ok: false, ...err.bulk };
    throw err;
  }
}

function loadSubmitted(db, batchId, user) {
  const batch = db.prepare('SELECT * FROM bulk_batches WHERE id = ?').get(batchId);
  if (!batch) bulkThrow(404, 'BULK_NOT_FOUND', 'Batch not found');
  const kind = getKind(batch.kind);
  if (!kind) bulkThrow(409, 'BULK_UNKNOWN_KIND', `Unknown bulk type "${batch.kind}"`);
  if (batch.status !== 'submitted') bulkThrow(409, 'BULK_NOT_SUBMITTED', `This batch is ${batch.status} — there is nothing to decide`);
  if (sameUser(user, batch.created_by)) {
    bulkThrow(403, 'SELF_APPROVAL', 'You saved this batch — ask another finance or admin user to decide it.');
  }
  return { batch, kind };
}

/**
 * P5-01: approve = re-plan from the stored rows + hash check + apply every row, all inside ONE
 * IMMEDIATE transaction (R3). Any change since submit → 409, nothing written, batch stays submitted.
 */
function approve(db, batchId, user) {
  try {
    return db.transaction(() => {
      const { batch, kind } = loadSubmitted(db, batchId, user);
      let common = {}; let options = {};
      try { common = JSON.parse(batch.common_json || '{}'); } catch { /* keep {} */ }
      try { options = JSON.parse(batch.options_json || '{}'); } catch { /* keep {} */ }
      const stored = db.prepare('SELECT * FROM bulk_rows WHERE batch_id = ? ORDER BY row_no').all(batchId);
      const rows = stored.map((s) => {
        let input = {};
        try { input = JSON.parse(s.input_json || '{}'); } catch { /* keep {} */ }
        return rowFromInputOf(kind, input, s.row_no);
      });
      const planned = checkedPlan(db, batch.kind, kind, common, rows, batch.plan_hash,
        { changedText: 'Data changed since this batch was sent — nothing was applied. Return it so they check again.' });
      const upd = db.prepare(`UPDATE bulk_rows SET state = ?, action = ?, messages_json = ?, resolved_json = ?,
        before_json = ?, after_json = ?, target_table = ?, target_id = ? WHERE batch_id = ? AND row_no = ?`);
      let applied = 0;
      for (const r of planned) {
        let res = { targetTable: null, targetId: null, before: null, after: null };
        if (APPLICABLE(r.plan)) {
          res = kind.applyRow(db, r, r.plan, common, { batchId, user, requestedBy: batch.created_by, options });
          applied++;
        }
        upd.run(r.plan.state, r.plan.action, JSON.stringify([...(r.messages || []), ...r.plan.messages]),
          JSON.stringify(r.plan.display || {}), res.before ? JSON.stringify(res.before) : null,
          res.after ? JSON.stringify(res.after) : null, res.targetTable, res.targetId, batchId, r.rowNo);
      }
      const counts = countStates(planned);
      const money = kind.moneyTotal ? kind.moneyTotal(planned) : null;
      const upd2 = db.prepare(`UPDATE bulk_batches SET status = 'applied', approved_by = ?, approved_at = datetime('now'),
        applied_at = datetime('now'), ok_count = ?, warn_count = ?, skipped_count = ?, money_total = ?
        WHERE id = ? AND status = 'submitted'`).run(user, counts.ok, counts.warning, counts.skipped,
        money === null || money === undefined ? batch.money_total : Math.round(money * 100) / 100, batchId);
      if (upd2.changes !== 1) bulkThrow(409, 'BULK_NOT_SUBMITTED', 'This batch was decided by someone else meanwhile — nothing was applied');
      logAudit('bulk_batches', batchId, 'status', 'submitted', 'applied', 'BULK_APPROVE',
        `${batch.kind} ${kind.describe(common)}: ${applied} row(s) approved and applied, raised by ${batch.created_by}` +
        (money !== null && money !== undefined ? `, total ₹${Math.round(money * 100) / 100}` : '') + `, bulk batch #${batchId}`, user);
      say(db, rolesOf(kind).create.find(r => r !== 'admin') || 'admin', 'BULK_APPROVED',
        `Bulk ${kindLabel(kind, batch.kind)} batch #${batchId} was approved by ${user} — ${applied} row(s) applied`, null);
      return { ok: true, batchId: Number(batchId), status: 'applied', counts: { applied, skipped: counts.skipped } };
    }).immediate();
  } catch (err) {
    if (err && err.bulk) return { ok: false, ...err.bulk };
    throw err;
  }
}

/** P5-01: reject (final) or return (back to the creator with a note). Reason/note ≥ 5 characters. */
function decide(db, batchId, action, reason, user) {
  const why = String(reason || '').trim();
  if (why.length < 5) {
    return fail(400, 'BULK_REASON_REQUIRED', action === 'return' ? 'Say what they should fix (at least 5 characters)' : 'Give a reason (at least 5 characters)');
  }
  const status = action === 'return' ? 'returned' : 'rejected';
  try {
    return db.transaction(() => {
      const { batch, kind } = loadSubmitted(db, batchId, user);
      const info = db.prepare(`UPDATE bulk_batches SET status = ?, decided_by = ?, decided_at = datetime('now'),
        reject_reason = CASE WHEN ? = 'rejected' THEN ? ELSE reject_reason END,
        return_note = CASE WHEN ? = 'returned' THEN ? ELSE return_note END
        WHERE id = ? AND status = 'submitted'`).run(status, user, status, why, status, why, batchId);
      if (info.changes !== 1) bulkThrow(409, 'BULK_NOT_SUBMITTED', 'This batch was decided by someone else meanwhile');
      logAudit('bulk_batches', batchId, 'status', 'submitted', status, action === 'return' ? 'BULK_RETURN' : 'BULK_REJECT',
        `${batch.kind} bulk batch #${batchId} ${status} (raised by ${batch.created_by}). ${action === 'return' ? 'Note' : 'Reason'}: "${why}"`, user);
      say(db, rolesOf(kind).create.find(r => r !== 'admin') || 'admin', action === 'return' ? 'BULK_RETURNED' : 'BULK_REJECTED',
        `Bulk ${kindLabel(kind, batch.kind)} batch #${batchId} was ${status} by ${user}: ${why}`, null);
      return { ok: true, batchId: Number(batchId), status };
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
      // Review F3 (planner ruling, Q6): an approval-kind batch is undone by a second person, never its creator.
      if (needsApproval(kind) && sameUser(user, batch.created_by)) {
        bulkThrow(403, 'SELF_APPROVAL', 'You saved this batch — ask another finance or admin user to undo it.');
      }
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
    submittedBy: b.submitted_by ?? null, submittedAt: b.submitted_at ?? null,
    approvedBy: b.approved_by ?? null, approvedAt: b.approved_at ?? null,
    decidedBy: b.decided_by ?? null, decidedAt: b.decided_at ?? null,
    rejectReason: b.reject_reason ?? null, returnNote: b.return_note ?? null,
    moneyTotal: b.money_total ?? null,
    requiresApproval: kind ? needsApproval(kind) : false,
    kindLabel: kind ? kindLabel(kind, b.kind) : b.kind,
  };
}

const BATCH_STATUSES = ['draft', 'submitted', 'approved', 'applied', 'rejected', 'returned', 'undone'];

function listBatches(db, { kind, kinds, status, month, year, limit, sinceDays } = {}) {
  let sql = 'SELECT * FROM bulk_batches WHERE 1=1';
  const args = [];
  if (kind) { sql += ' AND kind = ?'; args.push(kind); }
  if (Array.isArray(kinds)) {
    if (!kinds.length) return [];
    sql += ` AND kind IN (${kinds.map(() => '?').join(',')})`; args.push(...kinds);
  }
  if (status) {
    const list = String(status).split(',').map(s => s.trim()).filter(s => BATCH_STATUSES.includes(s));
    if (list.length) { sql += ` AND status IN (${list.map(() => '?').join(',')})`; args.push(...list); }
  }
  // Decided batches older than N days drop out of the finance queue (submitted ones always stay).
  if (sinceDays) {
    sql += ` AND (status = 'submitted' OR COALESCE(decided_at, approved_at, created_at) >= datetime('now', ?))`;
    args.push(`-${Math.min(Math.max(parseInt(sinceDays, 10) || 30, 1), 365)} days`);
  }
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
  const kind = getKind(b.kind);
  return { ...shapeBatch(b), columns: (kind && kind.reviewColumns) || null, rows };
}

module.exports = {
  preview, apply, submit, approve, decide, undo, listBatches, getBatch, getKind, rolesOf, needsApproval, visibleKinds,
  sameUser, BULK_MAX_ROWS, BULK_PREVIEW_MAX, hashGroup,
};
