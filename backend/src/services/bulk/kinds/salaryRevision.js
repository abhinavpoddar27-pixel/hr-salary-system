/**
 * Bulk kind: salary revision (P5-04, MASTER_PLAN §6 P5-04 / §7.4 B3). The first APPROVAL kind:
 * HR sends a batch, a finance/admin user who did not send it approves (Q6), and only then is
 * anything written (engine approve = one IMMEDIATE transaction, all-or-nothing, R3).
 *
 * Same logic as the single path, nothing written twice:
 *   new_structure  = services/salarySplit.buildRevisionStructure  (= what PUT /employees/:code/salary requests)
 *   kept components = services/salaryChange.resolveApproval        (N-17: conveyance etc. kept, ruling Q-B4)
 *   apply          = a salary_change_requests row (requested_by = batch creator) approved through
 *                    services/salaryChange.approveSalaryChange      (= PUT /salary-input/approve/:id)
 * Plus per-row audit rows (stage SALARY_REVISION_BULK) — this path only; the single path is unchanged.
 */
const { logAudit } = require('../../../database/db');
const { isMonthFinalized } = require('../../leaveTriggers');
const { structureForDate, structureDatedAfter } = require('../../statutoryFlags');
const { buildRevisionStructure } = require('../../salarySplit');
const { resolveApproval, approveSalaryChange, isCalendarDate, istToday } = require('../../salaryChange');

const NAME = 'salary-revision';
/** Ruling Q-B2: in % mode the new gross is rounded to ₹1. */
const REVISION_GROSS_ROUND = 1;
const PCT_MIN = -50;
const PCT_MAX = 100;
const BIG_CHANGE_PCT = 25;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const COMPONENTS = ['basic', 'da', 'hra', 'conveyance', 'special_allowance', 'other_allowances'];
const STAGE = 'SALARY_REVISION_BULK';

const r2 = (x) => Math.round(x * 100) / 100;
const ddmmyyyy = (iso) => (/^\d{4}-\d{2}-\d{2}/.test(String(iso || '')) ? `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}` : String(iso || ''));
const monthIdx = (iso) => Number(iso.slice(0, 4)) * 12 + Number(iso.slice(5, 7));
const monthLabelOf = (iso) => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
const blank = (v) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

/** 1st of the current IST month. */
function firstOfThisMonthIST(now = Date.now()) {
  return `${istToday(now).slice(0, 7)}-01`;
}

/**
 * H1 (planner ruling, supersedes Q-B3): Stage 7 pays employees.gross_salary for EVERY month it computes, whatever the
 * structure's date. So a revision may only take effect from the FIRST OPEN payroll month: the earliest month that is not
 * finalised and has data (a monthly_imports row or salary_computations rows). Months after it cannot be held for later.
 * Returns 'YYYY-MM-01' or null when no unfinalised month has data.
 */
function firstOpenMonth(db) {
  const r = db.prepare(`SELECT y, m FROM (
      SELECT year y, month m FROM monthly_imports GROUP BY year, month HAVING MAX(COALESCE(is_finalised, 0)) = 0
      UNION SELECT s.year, s.month FROM salary_computations s
        WHERE NOT EXISTS (SELECT 1 FROM monthly_imports f WHERE f.year = s.year AND f.month = s.month AND f.is_finalised = 1)
    ) ORDER BY y, m LIMIT 1`).get();
  return r ? `${r.y}-${String(r.m).padStart(2, '0')}-01` : null;
}
/** Default effective date (H1 b): 1st of the first open payroll month, else 1st of the current IST month. */
const defaultEffectiveFrom = (db) => (db && firstOpenMonth(db)) || firstOfThisMonthIST();

function normaliseCommon(c, db) {
  const effective_from = blank(c.effective_from) ? defaultEffectiveFrom(db) : String(c.effective_from).trim();
  const fields = {};
  if (!isCalendarDate(effective_from)) fields.effective_from = 'Pick a valid effective date';
  const reason = String(c.reason ?? '').trim();
  if (reason.length > 200) fields.reason = 'Reason is too long (max 200 characters)';
  if (Object.keys(fields).length) return { ok: false, error: Object.values(fields)[0], fields };
  return { ok: true, value: { effective_from, reason, month: Number(effective_from.slice(5, 7)), year: Number(effective_from.slice(0, 4)) } };
}

/** rows: [{code, new_gross?, pct?, effective_from?}]. A repeated code is merged (first kept). */
function normaliseRows(input) {
  const out = []; const seen = new Map();
  for (const raw of Array.isArray(input) ? input : []) {
    const obj = raw && typeof raw === 'object' ? raw : { code: raw };
    const code = String(obj.code ?? '').trim();
    if (!code) continue;
    const key = code.toLowerCase();
    if (seen.has(key)) {
      const first = seen.get(key);
      if (!first.messages.includes('Listed more than once — kept once')) first.messages.push('Listed more than once — kept once');
      continue;
    }
    const row = rowFromInput(obj, out.length + 1);
    seen.set(key, row);
    out.push(row);
  }
  return { rows: out };
}

function rowFromInput(input, rowNo) {
  return {
    rowNo, code: String(input.code ?? '').trim(),
    grossRaw: blank(input.new_gross) ? null : input.new_gross,
    pctRaw: blank(input.pct) ? null : input.pct,
    dateRaw: blank(input.effective_from) ? null : String(input.effective_from).trim(),
    messages: [],
  };
}

const normaliseOptions = () => ({});
const periodOf = (c) => ({ month: c.month, year: c.year });
const describe = (c) => (c && c.effective_from ? `from ${ddmmyyyy(c.effective_from)}${c.reason ? ` · ${c.reason}` : ''}` : '');
const context = (db) => ({ firstOpen: firstOpenMonth(db) });

function findEmployee(db, code) {
  const exact = db.prepare('SELECT * FROM employees WHERE code = ?').get(code);
  if (exact) return exact;
  const ci = db.prepare('SELECT * FROM employees WHERE code = ? COLLATE NOCASE').all(code);
  return ci.length === 1 ? ci[0] : null;
}
/** The latest structure the way PUT /employees/:code/salary reads it (the split source). */
const latestStructureOf = (db, empId) => db.prepare('SELECT * FROM salary_structures WHERE employee_id = ? ORDER BY effective_from DESC LIMIT 1').get(empId) || null;
const pendingRequestOf = (db, code) => db.prepare("SELECT id FROM salary_change_requests WHERE employee_code = ? AND status = 'Pending' ORDER BY id LIMIT 1").get(code) || null;
/**
 * Stage 7 rows of this employee for EVERY unfinalised month (H1 c) — Stage 7 pays the master gross for any month it
 * re-runs, so a re-run of an earlier open month after approval also used the new pay. The "Stage 7 used it" signal.
 */
function stage7Rows(db, code) {
  return db.prepare(`SELECT month, year, company, gross_salary, gross_earned, total_deductions, net_salary
    FROM salary_computations s WHERE employee_code = ?
      AND NOT EXISTS (SELECT 1 FROM monthly_imports f WHERE f.year = s.year AND f.month = s.month AND f.is_finalised = 1)
    ORDER BY year, month, company`).all(code);
}
/** Stage 7 rows of this employee for the effective month and later (the "re-run Stage 7 for <Mon>" note). */
function stage7RowsFrom(db, code, date) {
  return db.prepare(`SELECT month, year FROM salary_computations WHERE employee_code = ? AND (year * 12 + month) >= ?
    ORDER BY year, month`).all(code, monthIdx(date));
}
function finalisedFrom(db, date) {
  return db.prepare(`SELECT month, year FROM monthly_imports WHERE is_finalised = 1 AND (year * 12 + month) >= ?
    ORDER BY year, month LIMIT 1`).get(monthIdx(date)) || null;
}

function num(v) {
  if (typeof v === 'number') return v;
  const s = String(v).replace(/[₹,\s]/g, '').replace(/%$/, '');
  return s === '' ? NaN : Number(s);
}

/** @returns { state, action, messages[], display, fingerprint, emp?, ... } */
function planRow(db, row, common, ctx = {}) {
  const messages = [];
  const date = row.dateRaw || common.effective_from;
  row.date = date;
  const emp = isCalendarDate(date) ? findEmployee(db, row.code) : null;
  const display = { code: emp ? emp.code : row.code, name: emp?.name || '', department: emp?.department || '', effectiveFrom: date,
    pct: null, oldGross: emp ? r2(Number(emp.gross_salary) || 0) : null, newGross: null, delta: null };
  const base = (state, action, extra = {}) => ({ state, action, messages, display, fingerprint: extra.fingerprint ?? null, ...extra });
  const err = (m) => { messages.push(m); return base('error', 'conflict'); };

  if (!isCalendarDate(date)) return err('Effective date must be a real date (YYYY-MM-DD)');
  if (!emp) return err('Not found in the employee master');
  row.code = emp.code;
  if (String(emp.status || '').trim().toLowerCase() !== 'active') return err(`Not active (${emp.status || 'no status'})`);
  const hasGross = row.grossRaw !== null; const hasPct = row.pctRaw !== null;
  if (hasGross === hasPct) return err('Give either the new gross or the % increase — one of them');
  const oldGross = r2(Number(emp.gross_salary) || 0);
  let newGross;
  if (hasPct) {
    const pct = num(row.pctRaw);
    if (!Number.isFinite(pct) || pct < PCT_MIN || pct > PCT_MAX) return err(`% increase must be between ${PCT_MIN} and ${PCT_MAX}`);
    if (!(oldGross > 0)) return err('No current gross on record — give the new gross instead of a %');
    display.pct = pct;
    newGross = Math.round(oldGross * (1 + pct / 100) / REVISION_GROSS_ROUND) * REVISION_GROSS_ROUND;
  } else {
    newGross = num(row.grossRaw);
    if (!Number.isFinite(newGross)) return err('New gross must be a number');
    newGross = r2(newGross);
  }
  if (!(newGross > 0)) return err('New gross must be more than ₹0');
  row.newGross = newGross;
  display.newGross = newGross;
  display.delta = r2(newGross - oldGross);

  const fin = finalisedFrom(db, date);
  if (fin) return err(`Payroll for ${MONTHS[fin.month - 1]} ${fin.year} is finalised — pick a date after it`);
  // H1 a: the effective month must not be later than the first open payroll month.
  if (ctx.firstOpen && monthIdx(date) > monthIdx(ctx.firstOpen)) {
    return err(`Effective month must be the first open payroll month (${monthLabelOf(ctx.firstOpen)}) — the app cannot hold a salary change for a later month`);
  }
  const later = structureDatedAfter(db, 'plant', emp.id, date);
  if (later) return err(`A salary structure dated ${ddmmyyyy(later.latestDate)} already exists — date this change on or after it`);
  const pending = pendingRequestOf(db, emp.code);
  if (pending) return err(`A salary change for this person is already waiting for finance (request #${pending.id}) — decide that one first`);

  const latest = latestStructureOf(db, emp.id);
  const inForce = structureForDate(db, 'plant', emp.id, date);
  const newStructure = buildRevisionStructure(latest, newGross, emp.pt_applicable ?? 1);
  const resolved = resolveApproval(newStructure, inForce);
  for (const k of COMPONENTS) {
    display[`old_${k}`] = inForce ? r2(Number(inForce[k]) || 0) : null;
    display[`new_${k}`] = r2(resolved.components[k]);
  }
  const s7 = stage7RowsFrom(db, emp.code, date);
  const fingerprint = {
    emp: [emp.id, String(emp.status || ''), oldGross, emp.pt_applicable ?? null],
    latest: latest ? [latest.id, latest.effective_from, latest.gross_salary, latest.updated_at] : null,
    inForce: inForce ? [inForce.id, inForce.updated_at] : null,
  };
  const extra = { fingerprint, emp, latest, newStructure, resolved };

  if (Math.abs(newGross - oldGross) <= 0.01) { messages.push('Already at this gross — left as it is'); return base('skipped', 'noop', extra); }

  const warn = [];
  if (!latest) warn.push('No salary structure on record — created with the default split (Basic 50%, HRA 20%)');
  if (oldGross > 0 && Math.abs(newGross - oldGross) / oldGross * 100 > BIG_CHANGE_PCT) {
    warn.push(`Change of more than ${BIG_CHANGE_PCT}% (${r2((newGross - oldGross) / oldGross * 100)}%) — check it is right`);
  }
  if (date.slice(8, 10) !== '01') warn.push(`Not the 1st — after approval, every month's salary computed from then on pays the new gross (${monthLabelOf(date)} included); the date only marks the structure`);
  const conv = resolved.components.conveyance || 0;
  if (conv > 0 && resolved.kept.includes('conveyance')) warn.push(`Conveyance ${conv} kept on top of the split, as a single approval does`);
  messages.push(...warn);
  // Q-B5: a note only — it does not change the row's state, so a Stage 7 run between "send" and
  // "approve" does not refuse the batch (the undo fingerprint is taken at approval).
  if (s7.length) {
    const first = s7[0];
    messages.push(`Salary for ${MONTHS[first.month - 1]} ${first.year} is already computed — re-run Stage 7 for it after approval`);
  }
  return base(warn.length ? 'warning' : 'ok', latest && latest.effective_from === date ? 'update' : 'create', extra);
}

function applyRow(db, row, plan, common, { batchId, user, requestedBy }) {
  const emp = plan.emp;
  const date = row.date;
  const structBefore = db.prepare('SELECT * FROM salary_structures WHERE employee_id = ? AND effective_from = ?').get(emp.id, date) || null;
  const empBefore = db.prepare('SELECT gross_salary, updated_at FROM employees WHERE id = ?').get(emp.id);
  const reqId = Number(db.prepare(`INSERT INTO salary_change_requests (
      employee_id, employee_code, requested_by, old_gross, new_gross, old_structure, new_structure, reason, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Pending')`).run(
    emp.id, emp.code, requestedBy, Number(emp.gross_salary) || 0, row.newGross,
    JSON.stringify(plan.latest || {}), JSON.stringify(plan.newStructure),
    `Salary revision — bulk batch #${batchId}${common.reason ? `: ${common.reason}` : ''}`
  ).lastInsertRowid);
  const r = approveSalaryChange(db, { id: reqId, actor: user, approvedBy: user, effectiveFrom: date });
  if (!r.ok) {
    const e = new Error(r.body?.error || 'Approval refused');
    e.bulk = { status: r.status === 403 ? 403 : 409, code: r.body?.code || 'BULK_PLAN_CHANGED', error: `${emp.code}: ${r.body?.error || 'approval refused'} — nothing was applied` };
    throw e;
  }
  const structAfter = db.prepare('SELECT * FROM salary_structures WHERE employee_id = ? AND effective_from = ?').get(emp.id, date);
  const empAfter = db.prepare('SELECT gross_salary, updated_at FROM employees WHERE id = ?').get(emp.id);
  const remark = `${emp.code}: gross ${empBefore.gross_salary} → ${r.gross} from ${date}, raised by ${requestedBy}, bulk batch #${batchId}`;
  logAudit('salary_change_requests', reqId, 'status', 'Pending', 'Approved', STAGE, remark, user);
  logAudit('employees', emp.id, 'gross_salary', empBefore.gross_salary, empAfter.gross_salary, STAGE, remark, user);
  logAudit('salary_structures', structAfter.id, 'gross_salary', structBefore ? structBefore.gross_salary : '', structAfter.gross_salary, STAGE,
    `${remark} (${r.sameDate ? 'same-date row updated' : 'new row'})`, user);
  return {
    targetTable: 'salary_change_requests', targetId: reqId,
    before: { struct: structBefore, emp: empBefore },
    after: { requestId: reqId, employeeId: emp.id, effectiveFrom: date, sameDate: r.sameDate, struct: structAfter, emp: empAfter,
      stage7: stage7Rows(db, emp.code) },
  };
}

const parse = (s) => { try { return JSON.parse(s || 'null'); } catch { return null; } };
const sameRow = (a, b) => {
  if (!a || !b) return false;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) if (JSON.stringify(a[k] ?? null) !== JSON.stringify(b[k] ?? null)) return false;
  return true;
};

/** Undo only while nothing has moved on (R4): request, gross, structure row, later rows, finalise, Stage 7. */
function undoable(db, bulkRow) {
  const after = parse(bulkRow.after_json);
  if (!after) return { ok: false, reason: 'Nothing recorded to undo' };
  const req = db.prepare('SELECT status, employee_code FROM salary_change_requests WHERE id = ?').get(after.requestId);
  if (!req || req.status !== 'Approved') return { ok: false, reason: `The salary change is ${req ? req.status : 'gone'}` };
  const laterReq = db.prepare(`SELECT id, status FROM salary_change_requests WHERE employee_code = ? AND id > ?
    AND status IN ('Pending', 'Approved') ORDER BY id LIMIT 1`).get(req.employee_code, after.requestId);
  if (laterReq) return { ok: false, reason: `A later salary change exists (request #${laterReq.id}, ${laterReq.status})` };
  const emp = db.prepare('SELECT gross_salary FROM employees WHERE id = ?').get(after.employeeId);
  if (!emp || JSON.stringify(emp.gross_salary) !== JSON.stringify(after.emp.gross_salary)) return { ok: false, reason: 'Gross in the employee master changed since' };
  const cur = after.struct ? db.prepare('SELECT * FROM salary_structures WHERE id = ?').get(after.struct.id) : null;
  if (!sameRow(cur, after.struct)) return { ok: false, reason: 'The salary structure changed since' };
  const laterStruct = db.prepare('SELECT effective_from FROM salary_structures WHERE employee_id = ? AND effective_from > ? LIMIT 1').get(after.employeeId, after.effectiveFrom);
  if (laterStruct) return { ok: false, reason: `A later salary structure exists (from ${ddmmyyyy(laterStruct.effective_from)})` };
  const fin = finalisedFrom(db, after.effectiveFrom);
  if (fin) return { ok: false, reason: `Payroll for ${MONTHS[fin.month - 1]} ${fin.year} is finalised` };
  if (JSON.stringify(stage7Rows(db, req.employee_code)) !== JSON.stringify(after.stage7 || [])) {
    return { ok: false, reason: 'Salary (Stage 7) was computed with the new pay since — undo is not safe' };
  }
  return { ok: true };
}

function undoRow(db, bulkRow, batch, user, reason) {
  const before = parse(bulkRow.before_json) || {};
  const after = parse(bulkRow.after_json);
  if (before.struct) {
    const cols = Object.keys(before.struct).filter(k => k !== 'id');
    db.prepare(`UPDATE salary_structures SET ${cols.map(c => `"${c}" = ?`).join(', ')} WHERE id = ?`).run(...cols.map(c => before.struct[c]), before.struct.id);
  } else {
    db.prepare('DELETE FROM salary_structures WHERE id = ?').run(after.struct.id);
  }
  // Gross back exactly; updated_at back too unless something else touched the master row since.
  db.prepare(`UPDATE employees SET gross_salary = ?, updated_at = CASE WHEN updated_at IS ? THEN ? ELSE updated_at END WHERE id = ?`)
    .run(before.emp.gross_salary, after.emp.updated_at, before.emp.updated_at, after.employeeId);
  db.prepare("UPDATE salary_change_requests SET status = 'Reverted' WHERE id = ? AND status = 'Approved'").run(after.requestId);
  const remark = `${bulkRow.row_key}: undo of bulk batch #${batch.id}. Reason: "${reason}"`;
  logAudit('salary_change_requests', after.requestId, 'status', 'Approved', 'Reverted', 'BULK_UNDO', remark, user);
  logAudit('employees', after.employeeId, 'gross_salary', after.emp.gross_salary, before.emp.gross_salary, 'BULK_UNDO', remark, user);
  logAudit('salary_structures', after.struct.id, 'gross_salary', after.struct.gross_salary, before.struct ? before.struct.gross_salary : '',
    'BULK_UNDO', `${remark} (${before.struct ? 'same-date row restored' : 'row removed'})`, user);
}

const APPLICABLE = (p) => p.state === 'ok' || p.state === 'warning';

module.exports = {
  name: NAME, label: 'salary revision', noun: 'revisions', requiresApproval: true,
  nothingToSave: 'Nothing to send — everyone listed already has that gross',
  roles: { create: ['admin', 'hr'], approve: ['admin', 'finance'] },
  hashRow: (r) => [r.code, r.date ?? null, r.newGross ?? null, r.plan.state, r.plan.action, r.plan.fingerprint],
  inputOf: (r) => ({ code: r.code, new_gross: r.grossRaw, pct: r.pctRaw, effective_from: r.dateRaw }),
  rowFromInput,
  // The row's own input rides back on the preview so the screen sends exactly what it checked (codes repeated in
  // the paste are merged, so preview rows cannot be matched to pasted lines by position).
  displayExtra: (r) => ({ input: { code: r.code, new_gross: r.grossRaw, pct: r.pctRaw, effective_from: r.dateRaw } }),
  moneyTotal: (planned) => r2(planned.filter(r => APPLICABLE(r.plan)).reduce((s, r) => s + (r.plan.display.delta || 0), 0)),
  reviewColumns: [
    { key: 'code', label: 'Code', type: 'text' }, { key: 'name', label: 'Name', type: 'text' },
    { key: 'effectiveFrom', label: 'From', type: 'date' },
    { key: 'oldGross', label: 'Gross now', type: 'money' }, { key: 'newGross', label: 'Gross new', type: 'money' },
    { key: 'delta', label: 'Change / month', type: 'money' }, { key: 'pct', label: '%', type: 'pct' },
    { key: 'old_basic', label: 'Basic now', type: 'money' }, { key: 'new_basic', label: 'Basic new', type: 'money' },
    { key: 'old_da', label: 'DA now', type: 'money' }, { key: 'new_da', label: 'DA new', type: 'money' },
    { key: 'old_hra', label: 'HRA now', type: 'money' }, { key: 'new_hra', label: 'HRA new', type: 'money' },
    { key: 'old_conveyance', label: 'Conv. now', type: 'money' }, { key: 'new_conveyance', label: 'Conv. new', type: 'money' },
    { key: 'old_special_allowance', label: 'Special now', type: 'money' }, { key: 'new_special_allowance', label: 'Special new', type: 'money' },
    { key: 'old_other_allowances', label: 'Other now', type: 'money' }, { key: 'new_other_allowances', label: 'Other new', type: 'money' },
  ],
  normaliseCommon, normaliseRows, normaliseOptions, periodOf, describe, context,
  planRow, applyRow, undoable, undoRow,
  REVISION_GROSS_ROUND, firstOpenMonth, defaultEffectiveFrom,
};
