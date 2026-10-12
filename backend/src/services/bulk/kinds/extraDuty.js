/**
 * Bulk kind: Extra duty grants (P3-01, B1). Owner rulings R1–R6, Q1, Q2 (MASTER_PLAN §2/§7.4).
 *
 * Common values are set once (date, type, duty days, source, reference, remark);
 * month/year come from the date; company always from each person's master record.
 * Writes go through services/extraDuty/createGrant.writeGrant — the same code the
 * single "+ New Grant" route uses. PRE_BIOMETRIC_ACTIVATION is not offered (it
 * creates attendance rows; it stays single-entry).
 */
const { logAudit } = require('../../../database/db');
const { writeGrant, findExisting, isUntouchedAuto, upgradeAuditRemark } = require('../../extraDuty/createGrant');
const { isMonthFinalized } = require('../../leaveTriggers');

const NAME = 'extra-duty';
const GRANT_TYPES = ['OVERNIGHT_STAY', 'EXTENDED_SHIFT', 'OTHER'];
const SOURCES = ['Gate Register', 'Production Office', 'Supervisor Confirmed', 'Other'];
const DUTY_DAYS = [0.5, 1, 1.5, 2];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const HR_LABEL = { PENDING: 'pending', APPROVED: 'approved', REJECTED: 'rejected' };
const FIN_LABEL = { UNREVIEWED: 'unreviewed', FINANCE_APPROVED: 'approved', FINANCE_FLAGGED: 'flagged', FINANCE_REJECTED: 'rejected' };

const ddmmyyyy = (iso) => (/^\d{4}-\d{2}-\d{2}/.test(String(iso || '')) ? `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}` : String(iso || ''));
const monthLabel = (m, y) => `${MONTHS[m - 1]} ${y}`;

function parseDuty(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return DUTY_DAYS.includes(n) ? n : NaN;
}

function validIsoDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s || ''))) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function normaliseCommon(c) {
  const fields = {};
  const grant_date = String(c.grant_date || '').trim();
  if (!validIsoDate(grant_date)) fields.grant_date = 'Pick a valid date';
  const grant_type = String(c.grant_type || 'OVERNIGHT_STAY').trim();
  if (!GRANT_TYPES.includes(grant_type)) fields.grant_type = 'Type must be Overnight Stay, Extended Shift or Other';
  const duty = parseDuty(c.duty_days ?? 1);
  if (duty === null || Number.isNaN(duty)) fields.duty_days = 'Duty days must be 0.5, 1, 1.5 or 2';
  const verification_source = String(c.verification_source || '').trim();
  if (!SOURCES.includes(verification_source)) fields.verification_source = `Source must be one of: ${SOURCES.join(', ')}`;
  const reference_number = String(c.reference_number ?? '').trim();
  if (reference_number.length > 100) fields.reference_number = 'Reference is too long (max 100 characters)';
  const remarks = String(c.remarks ?? '').trim();
  if (remarks.length > 500) fields.remarks = 'Remark is too long (max 500 characters)';
  if (Object.keys(fields).length) return { ok: false, error: Object.values(fields)[0], fields };
  return {
    ok: true,
    value: {
      grant_date, grant_type, duty_days: duty, verification_source, reference_number, remarks,
      month: parseInt(grant_date.slice(5, 7), 10), year: parseInt(grant_date.slice(0, 4), 10),
    },
  };
}

/** rows: [{code, duty_days?}] or ['code', …]. Duplicates merged (first kept). */
function normaliseRows(input) {
  const list = Array.isArray(input) ? input : [];
  const out = [];
  const seen = new Map();
  for (const raw of list) {
    const code = String((raw && typeof raw === 'object') ? (raw.code ?? '') : (raw ?? '')).trim();
    if (!code) continue;
    const key = code.toLowerCase();
    if (seen.has(key)) {
      const first = seen.get(key);
      if (!first.messages.includes('Listed more than once — kept once')) first.messages.push('Listed more than once — kept once');
      continue;
    }
    const row = { rowNo: out.length + 1, code, dutyRaw: (raw && typeof raw === 'object') ? raw.duty_days : undefined, messages: [] };
    seen.set(key, row);
    out.push(row);
  }
  return { rows: out };
}

function normaliseOptions(o) { return { hrApprove: o.hrApprove === true }; }
function periodOf(common) { return { month: common.month, year: common.year }; }
function describe(common) {
  if (!common || !common.grant_date) return '';
  return `${ddmmyyyy(common.grant_date)} · ${common.duty_days} day(s) · ${String(common.grant_type || '').replace(/_/g, ' ').toLowerCase()}`;
}

function context(db, common) {
  return { finalised: isMonthFinalized(db, null, common.month, common.year) };
}

function findEmployee(db, code) {
  const sel = 'SELECT id, code, name, department, company, status, date_of_exit FROM employees';
  const exact = db.prepare(`${sel} WHERE code = ?`).get(code);
  if (exact) return exact;
  const ci = db.prepare(`${sel} WHERE code = ? COLLATE NOCASE`).all(code);
  return ci.length === 1 ? ci[0] : null;
}

const cleanCompany = (c) => {
  const s = String(c ?? '').trim();
  return (!s || s.toLowerCase() === 'null' || s.toLowerCase() === 'undefined') ? '' : s;
};

function fingerprintOf(emp, existing, finalised) {
  return {
    emp: emp ? [emp.id, emp.code, String(emp.status || ''), emp.company ?? null] : null,
    grant: existing ? [existing.id, existing.status, existing.finance_status, existing.verification_source,
      existing.duty_days, existing.is_processed ? 1 : 0, existing.requested_at, existing.approved_at] : null,
    finalised: !!finalised,
  };
}

/** @returns { state, action, messages[], display, fingerprint, emp?, existing? } */
function planRow(db, row, common, ctx) {
  const messages = [];
  const emp = findEmployee(db, row.code);
  const d = parseDuty(row.dutyRaw);
  row.duty = d === null ? common.duty_days : d;
  const display = {
    code: emp ? emp.code : row.code, name: emp?.name || '', department: emp?.department || '',
    company: emp ? cleanCompany(emp.company) : '', employeeStatus: emp?.status || '',
  };
  const base = (state, action, existing = null) => ({
    state, action, messages, display: { ...display, dutyDays: row.duty, existingId: existing?.id || null },
    fingerprint: fingerprintOf(emp, existing, ctx.finalised), emp, existing,
  });
  if (Number.isNaN(d)) { messages.push('Duty days must be 0.5, 1, 1.5 or 2'); return base('error', 'conflict'); }
  if (!emp) { messages.push('Not found in the employee master'); return base('error', 'conflict'); }
  row.code = emp.code; // master spelling
  if (ctx.finalised) {
    messages.push(`Payroll for ${monthLabel(common.month, common.year)} is finalised — no new grants for this month`);
    return base('error', 'conflict');
  }
  if (String(emp.status || '').trim().toLowerCase() !== 'active') {
    messages.push(`Not active (${emp.status || 'no status'}${emp.date_of_exit ? `, left on ${ddmmyyyy(emp.date_of_exit)}` : ''})`);
    return base('error', 'conflict');
  }
  const existing = findExisting(db, emp.code, common.grant_date, common.month, common.year);
  if (existing) {
    if (isUntouchedAuto(existing)) {
      messages.push('Will replace the system entry for this date (worked weekly off)');
      return base('warning', 'update', existing);
    }
    let m = `Already granted for ${ddmmyyyy(common.grant_date)} (HR: ${HR_LABEL[existing.status] || existing.status}, ` +
      `finance: ${FIN_LABEL[existing.finance_status] || existing.finance_status}) — left as it is`;
    if (existing.verification_source === 'BIOMETRIC_AUTO') m = `A system entry for ${ddmmyyyy(common.grant_date)} is already in review — left as it is`;
    else if (existing.status === 'APPROVED' && existing.finance_status === 'FINANCE_REJECTED') m += '; finance rejected it — ask finance to use "Return to HR"';
    messages.push(m);
    return base('skipped', 'noop', existing);
  }
  if (!cleanCompany(emp.company)) {
    messages.push('No company in the employee master — saved without one');
    return base('warning', 'create');
  }
  return base('ok', 'create');
}

function applyRow(db, row, plan, common, { batchId, user, options }) {
  const emp = plan.emp;
  const outcome = writeGrant(db, {
    employee_code: emp.code, employee_id: emp.id, grant_date: common.grant_date, month: common.month, year: common.year,
    company: cleanCompany(emp.company), grant_type: common.grant_type, duty_days: row.duty,
    verification_source: common.verification_source, reference_number: common.reference_number,
    remarks: common.remarks, original_punch_date: '',
  }, user);
  const expected = plan.action === 'create' ? 'created' : 'upgraded';
  if (outcome.kind !== expected) {
    const e = new Error('Data changed since you checked — check again');
    e.bulk = { status: 409, code: 'BULK_PLAN_CHANGED', error: e.message };
    throw e;
  }
  const id = Number(outcome.id);
  if (outcome.kind === 'created') {
    logAudit('extra_duty_grants', id, 'id', '', String(id), 'HR_BULK_CREATE',
      `${emp.code} ${common.grant_date}: ${row.duty} day(s) ${common.grant_type}, bulk batch #${batchId}`, user);
  } else {
    logAudit('extra_duty_grants', id, 'verification_source', 'BIOMETRIC_AUTO', common.verification_source, 'HR_UPGRADE_AUTO',
      upgradeAuditRemark(emp.code, common.grant_date, outcome.old, row.duty, common.grant_type) + ` (bulk batch #${batchId})`, user);
  }
  let approved = false;
  if (options.hrApprove) {
    // Same write as POST /:id/approve, by the saving user (owner Q1).
    const info = db.prepare(`UPDATE extra_duty_grants SET status = 'APPROVED', approved_by = ?, approved_at = datetime('now')
      WHERE id = ? AND status = 'PENDING'`).run(user, id);
    if (info.changes === 1) {
      approved = true;
      logAudit('extra_duty_grants', id, 'status', 'PENDING', 'APPROVED', 'HR_BULK_CREATE_APPROVE',
        `${emp.code} ${common.grant_date}: ${row.duty} day(s), bulk batch #${batchId}`, user);
    }
  }
  const after = db.prepare('SELECT * FROM extra_duty_grants WHERE id = ?').get(id);
  return { targetTable: 'extra_duty_grants', targetId: id, before: outcome.old || null, after, approved };
}

function undoable(db, bulkRow, batch) {
  const g = db.prepare('SELECT * FROM extra_duty_grants WHERE id = ?').get(bulkRow.target_id);
  if (!g) return { ok: false, reason: 'The grant no longer exists' };
  let after = {};
  try { after = JSON.parse(bulkRow.after_json || '{}'); } catch { /* keep {} */ }
  if (g.finance_status !== 'UNREVIEWED') return { ok: false, reason: `Finance has reviewed it (${FIN_LABEL[g.finance_status] || g.finance_status})` };
  if (g.is_processed) return { ok: false, reason: 'Already used in salary' };
  if (isMonthFinalized(db, null, g.month, g.year)) return { ok: false, reason: `Payroll for ${monthLabel(g.month, g.year)} is finalised` };
  if (g.status !== after.status || (g.approved_by || null) !== (after.approved_by || null) || (g.approved_at || null) !== (after.approved_at || null)) {
    return { ok: false, reason: `HR status changed since the batch (now ${HR_LABEL[g.status] || g.status})` };
  }
  // Review F1: the WHOLE current row must equal the after-image written by the batch — every column of
  // SELECT *, none ignored (a finance reject → "Return to HR" round trip ends with the same status/finance
  // fields but leaves finance_notes; any later write to any column means someone acted on the row).
  const keys = new Set([...Object.keys(g), ...Object.keys(after)]);
  for (const k of keys) {
    if (JSON.stringify(g[k] ?? null) !== JSON.stringify(after[k] ?? null)) return { ok: false, reason: 'Changed since the batch' };
  }
  return { ok: true };
}

function undoRow(db, bulkRow, batch, user, reason) {
  const id = bulkRow.target_id;
  if (bulkRow.action === 'create') {
    db.prepare('DELETE FROM extra_duty_grants WHERE id = ?').run(id);
    logAudit('extra_duty_grants', id, 'id', String(id), '', 'BULK_UNDO',
      `${bulkRow.row_key}: grant removed by undo of bulk batch #${batch.id}. Reason: "${reason}"`, user);
    return;
  }
  // update: restore the replaced system entry exactly (every column of the before-image).
  const before = JSON.parse(bulkRow.before_json);
  const cols = Object.keys(before).filter(k => k !== 'id');
  db.prepare(`UPDATE extra_duty_grants SET ${cols.map(c => `"${c}" = ?`).join(', ')} WHERE id = ?`)
    .run(...cols.map(c => before[c]), id);
  logAudit('extra_duty_grants', id, 'verification_source', String(JSON.parse(bulkRow.after_json || '{}').verification_source || ''),
    String(before.verification_source || ''), 'BULK_UNDO',
    `${bulkRow.row_key}: system entry restored by undo of bulk batch #${batch.id}. Reason: "${reason}"`, user);
}

// ── read helpers for the screen ──
function peopleOnDate(db, date) {
  return db.prepare(`SELECT DISTINCT g.employee_code AS code, e.name, e.department, e.status
    FROM extra_duty_grants g LEFT JOIN employees e ON e.code = g.employee_code
    WHERE g.grant_date = ? AND g.verification_source != 'BIOMETRIC_AUTO' AND g.status != 'REJECTED'
      AND g.finance_status != 'FINANCE_REJECTED' AND g.grant_type != 'PRE_BIOMETRIC_ACTIVATION'
    ORDER BY g.employee_code`).all(date);
}

function employeesLite(db) {
  return db.prepare('SELECT code, name, department, company, status FROM employees ORDER BY code').all();
}

module.exports = {
  name: NAME, GRANT_TYPES, SOURCES, DUTY_DAYS,
  normaliseCommon, normaliseRows, normaliseOptions, periodOf, describe, context,
  planRow, applyRow, undoable, undoRow, peopleOnDate, employeesLite,
};
