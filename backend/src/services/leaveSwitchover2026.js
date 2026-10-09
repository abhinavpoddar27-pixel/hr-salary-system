/**
 * Leave switchover 2026 — one-time preparation of the 2026 leave data so the
 * owner can apply balances through the app (PROMPT.md §3.4, rulings R-A…R-H).
 *
 *   previewSwitchover(db)            runs every change inside a transaction,
 *                                    computes the 2026 leave plan, then ROLLS
 *                                    BACK. Writes nothing.
 *   applySwitchover(db, {...})       backs the database file up, then makes the
 *                                    same changes for real in one transaction,
 *                                    with an audit_log row per change and the
 *                                    guard key `leave_switchover_2026_v1`.
 *
 * What it changes (and nothing else):
 *   R-A  employment_type -> 'Permanent' for the listed codes, only when Active
 *        and currently typed as the listed old_type. `category` is NOT touched.
 *   R-B/C policy_config: el_days_per_leave 21, el_eligibility_days 180,
 *        cl_entitlement_base 4, cl_annual_entitlement 4.
 *   R-F  an offsetting Debit row for leave_transactions #1, #3, #2.
 *   R-G  2026 CL opening = new entitlement, 2026 EL opening = 0, for Active
 *        Permanent employees that already have the row. used/balance untouched.
 *
 * What it never does: applyLeavePlan, leave_automation_enabled, schema, any
 * year other than 2026, any row deletion.
 *
 * Like services/loans: functions return { ok:false, code, status, error } on a
 * refusal and never throw a class across the module boundary (jest realms), and
 * audit rows go on the passed db handle, not db.js logAudit (which uses getDb()).
 */
const fs = require('fs');
const path = require('path');
const { computeClEntitlement } = require('./phase5Features');
const { computeLeavePlan, selectEligibleEmployees } = require('./leaveEngine');
const RETYPE_LIST = require('../config/leaveSwitchover2026Codes');

const YEAR = 2026;
const CONFIRM_PHRASE = 'SWITCHOVER 2026';
const GUARD_KEY = 'leave_switchover_2026_v1';
const STAGE = 'leave_switchover_2026';

const POLICY_TARGET = Object.freeze([
  ['el_days_per_leave', '21', 'Days worked that earn one EL day'],
  ['el_eligibility_days', '180', 'Days worked in the calendar year before EL starts accruing'],
  ['cl_entitlement_base', '4', 'CL days per year (pro-rated by joining quarter)'],
  ['cl_annual_entitlement', '4', 'CL days per year'],
]);

/** R-F: HR's hand accrual estimates the engine now computes. Order as ruled. */
const SUPERSEDED = Object.freeze([
  { id: 1, employee_code: '19954', leave_type: 'EL', days: 10 },
  { id: 3, employee_code: '23700', leave_type: 'EL', days: 9 },
  { id: 2, employee_code: '23700', leave_type: 'CL', days: 3 },
]);

const offsetReason = (id) => `Superseded by computed accrual — leave switchover 2026 (offsets txn #${id})`;

const doubleCountText = (month, year) =>
  `Possible double count: outside-app leave uploaded for ${month}/${year} and the app also has leave corrections that month. Confirm with HR before applying.`;

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const norm = (v) => String(v ?? '').trim().toLowerCase();

/** Thrown only inside our own transactions to force a ROLLBACK; never escapes. */
const ROLLBACK = Symbol('leave-switchover-rollback');

function audit(db, { table, recordId, field, oldValue, newValue, actor, remark, employeeCode = null, action }) {
  db.prepare(`
    INSERT INTO audit_log (table_name, record_id, field_name, old_value, new_value,
                           changed_by, stage, remark, employee_code, action_type)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(table, recordId, field, String(oldValue ?? ''), String(newValue ?? ''),
    actor, STAGE, remark, employeeCode, action);
}

function guardRow(db) {
  return db.prepare('SELECT value FROM policy_config WHERE key = ?').get(GUARD_KEY) || null;
}

// ────────────────────────────────────────────────────────────────────────────
// The four mutations. Each one returns what it did; `log` is null in preview.
// ────────────────────────────────────────────────────────────────────────────

function retype(db, log) {
  const find = db.prepare('SELECT id, code, name, department, status, employment_type, category FROM employees WHERE code = ?');
  const upd = db.prepare("UPDATE employees SET employment_type = 'Permanent', updated_at = datetime('now') WHERE id = ?");
  const changed = [];
  const skipped = [];
  for (const { code, old_type: oldType } of RETYPE_LIST) {
    const e = find.get(code); // employees.code is UNIQUE
    if (!e) { skipped.push({ code, reason: 'No employee with that code' }); continue; }
    if (e.status !== 'Active') {
      skipped.push({ code, name: e.name, status: e.status, current_type: e.employment_type, reason: `Status is ${e.status}, not Active` });
      continue;
    }
    if (norm(e.employment_type) === 'permanent') {
      // Typically: the switchover has already been applied.
      skipped.push({ code, name: e.name, status: e.status, current_type: e.employment_type, reason: 'Already Permanent' });
      continue;
    }
    if (norm(e.employment_type) !== norm(oldType)) {
      skipped.push({
        code, name: e.name, status: e.status, current_type: e.employment_type,
        reason: `Type is ${e.employment_type || '(blank)'}, expected ${oldType}`,
      });
      continue;
    }
    upd.run(e.id);
    changed.push({ code, name: e.name, department: e.department, old_type: e.employment_type, category: e.category || null });
    if (log) {
      audit(db, {
        table: 'employees', recordId: e.id, field: 'employment_type',
        oldValue: e.employment_type, newValue: 'Permanent', actor: log.actor,
        remark: `Retyped Permanent (owner ruling R-A). ${log.note}`, employeeCode: code, action: 'switchover_retype',
      });
    }
  }
  // Amendment B: bulk import (routes/employees.js) derives employment_type from
  // `category`; these rows keep their old category and could be retyped back.
  const atRisk = changed.filter((c) => ['silp', 'worker'].includes(norm(c.category)));
  return {
    changed, skipped,
    category_revert_risk: { count: atRisk.length, codes: atRisk.map((c) => c.code) },
  };
}

function setPolicy(db, log) {
  const get = db.prepare('SELECT value FROM policy_config WHERE key = ?');
  const upd = db.prepare("UPDATE policy_config SET value = ?, updated_at = datetime('now') WHERE key = ?");
  const ins = db.prepare('INSERT INTO policy_config (key, value, description) VALUES (?, ?, ?)');
  return POLICY_TARGET.map(([key, value, description]) => {
    const before = get.get(key)?.value ?? null;
    const changed = before === null || String(before).trim() !== value;
    if (changed) {
      if (before === null) ins.run(key, value, description); else upd.run(value, key);
      if (log) {
        audit(db, {
          table: 'policy_config', recordId: 0, field: key, oldValue: before, newValue: value,
          actor: log.actor, remark: `Leave switchover 2026 (rulings R-B/R-C). ${log.note}`, action: 'switchover_policy',
        });
      }
    }
    return { key, before, after: value, changed };
  });
}

function addOffsets(db, log) {
  const orig = db.prepare('SELECT * FROM leave_transactions WHERE id = ?');
  const existing = db.prepare('SELECT id FROM leave_transactions WHERE reason = ? LIMIT 1');
  const ins = db.prepare(`
    INSERT INTO leave_transactions
      (employee_id, employee_code, company, leave_type, transaction_type, days,
       balance_after, reference_month, reference_year, reason, approved_by)
    VALUES (?, ?, ?, ?, 'Debit', ?, NULL, ?, ?, ?, ?)
  `);
  return SUPERSEDED.map((s) => {
    const t = orig.get(s.id);
    const base = { offsets_txn_id: s.id, employee_code: s.employee_code, leave_type: s.leave_type, days: s.days };
    if (!t) return { ...base, status: 'skipped', reason: `Transaction #${s.id} not found` };
    const matches = t.employee_code === s.employee_code && t.leave_type === s.leave_type
      && t.transaction_type === 'Credit' && Number(t.days) === s.days;
    if (!matches) {
      return {
        ...base, status: 'skipped',
        reason: `Transaction #${s.id} is ${t.employee_code} ${t.leave_type} ${t.transaction_type} ${t.days}, not the ruled ${s.employee_code} ${s.leave_type} Credit ${s.days}`,
      };
    }
    const reason = offsetReason(s.id);
    const dup = existing.get(reason);
    if (dup) return { ...base, status: 'skipped', reason: `Offset already recorded (txn #${dup.id})` };
    const info = ins.run(t.employee_id, t.employee_code, t.company, t.leave_type, t.days,
      t.reference_month, t.reference_year, reason, log ? log.actor : 'preview');
    if (log) {
      audit(db, {
        table: 'leave_transactions', recordId: info.lastInsertRowid, field: 'offset',
        oldValue: null, newValue: `Debit ${t.days} ${t.leave_type}`, actor: log.actor,
        remark: `${reason}. ${log.note}`, employeeCode: t.employee_code, action: 'switchover_offset',
      });
    }
    return {
      ...base, status: log ? 'added' : 'to_add', company: t.company,
      reference_month: t.reference_month, reference_year: t.reference_year,
      ...(log ? { new_txn_id: Number(info.lastInsertRowid) } : {}),
    };
  });
}

function setOpenings(db, log) {
  const clBase = Number(db.prepare("SELECT value FROM policy_config WHERE key = 'cl_entitlement_base'").get()?.value);
  const bal = db.prepare('SELECT id, opening FROM leave_balances WHERE employee_id = ? AND year = ? AND leave_type = ?');
  const upd = db.prepare('UPDATE leave_balances SET opening = ? WHERE id = ?');
  const rows = [];
  // Same population the engine uses: Active, Permanent, not a contractor.
  for (const emp of selectEligibleEmployees(db, null)) {
    for (const [type, target] of [['CL', computeClEntitlement(emp.date_of_joining, YEAR, clBase)], ['EL', 0]]) {
      const b = bal.get(emp.id, YEAR, type);
      if (!b) continue; // R-G: never create rows; the engine inserts missing ones.
      if (Number(b.opening) === target) continue;
      upd.run(target, b.id);
      rows.push({ code: emp.code, name: emp.name, leave_type: type, before: Number(b.opening), after: target });
      if (log) {
        audit(db, {
          table: 'leave_balances', recordId: b.id, field: 'opening', oldValue: b.opening, newValue: target,
          actor: log.actor, remark: `2026 ${type} opening reset (owner ruling R-G). ${log.note}`,
          employeeCode: emp.code, action: 'switchover_opening',
        });
      }
    }
  }
  return {
    cl_changed: rows.filter((r) => r.leave_type === 'CL').length,
    el_changed: rows.filter((r) => r.leave_type === 'EL').length,
    rows,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Reporting
// ────────────────────────────────────────────────────────────────────────────

/** Amendment A: grants and an in-app leave correction in the same month. */
function doubleCountFlags(db) {
  return db.prepare(`
    SELECT g.employee_code AS code, g.year, g.month
    FROM leave_external_grants g
    WHERE g.is_active = 1 AND g.year = ?
      AND EXISTS (
        SELECT 1 FROM attendance_processed ap
        WHERE ap.employee_code = g.employee_code
          AND ap.correction_source = 'leave_correction'
          AND ap.date LIKE printf('%04d-%02d-%%', g.year, g.month)
      )
    GROUP BY g.employee_code, g.year, g.month
    ORDER BY g.employee_code, g.month
  `).all(YEAR).map((f) => ({ ...f, text: doubleCountText(f.month, f.year) }));
}

function summarise(db, plan, flags) {
  const names = new Map(db.prepare('SELECT code, name FROM employees').all().map((e) => [e.code, e.name]));
  const flagsBy = new Map();
  for (const f of flags) {
    if (!flagsBy.has(f.code)) flagsBy.set(f.code, []);
    flagsBy.get(f.code).push(f.text);
  }
  const employees = plan.employees.map((e) => ({
    code: e.employee_code,
    name: names.get(e.employee_code) || null,
    department: e.department,
    company: e.company,
    date_of_joining: e.date_of_joining,
    days_worked: e.days_worked_ytd,
    eligible: e.eligible,
    el: {
      opening: e.el.opening, earned: e.el.earned, used: e.el.used, external: e.el.external,
      adjustments: e.el.adjustments, balance: e.el.new_balance,
    },
    cl: {
      opening: e.cl.opening, entitlement: e.cl.computed_opening, used: e.cl.used, external: e.cl.external,
      adjustments: e.cl.adjustments, balance: e.cl.new_balance,
    },
    total: e.new_balance,
    reasons: [...e.reasons, ...(flagsBy.get(e.employee_code) || [])],
  }));
  const negatives = [];
  for (const e of employees) {
    if (e.el.balance < 0) negatives.push({ code: e.code, name: e.name, leave_type: 'EL', balance: e.el.balance });
    if (e.cl.balance < 0) negatives.push({ code: e.code, name: e.name, leave_type: 'CL', balance: e.cl.balance });
  }
  return { employees, negatives };
}

/** Every mutation, then the plan. `log` = null for preview. */
function runAll(db, log) {
  const retyped = retype(db, log);
  const policy = setPolicy(db, log);
  const offsets = addOffsets(db, log);
  const openings = setOpenings(db, log);
  const plan = computeLeavePlan(db, { year: YEAR });
  const flags = doubleCountFlags(db);
  const { employees, negatives } = summarise(db, plan, flags);
  return {
    year: YEAR,
    retype: retyped,
    policy,
    cl_openings: openings,
    offsets,
    plan: { months_covered: plan.months_covered, policy: plan.policy, totals: plan.totals,
      unresolved_finance_rows: plan.unresolved_finance_rows },
    employees,
    negatives,
    double_count_flags: flags,
    totals: {
      employees: employees.length,
      retyped: retyped.changed.length,
      skipped: retyped.skipped.length,
      category_revert_risk: retyped.category_revert_risk.count,
      policy_changed: policy.filter((p) => p.changed).length,
      cl_openings_changed: openings.cl_changed,
      el_openings_changed: openings.el_changed,
      offsets: offsets.filter((o) => o.status !== 'skipped').length,
      el_eligible: employees.filter((e) => e.eligible).length,
      el_total: r2(employees.reduce((a, e) => a + e.el.balance, 0)),
      cl_total: r2(employees.reduce((a, e) => a + e.cl.balance, 0)),
      negative_balances: negatives.length,
      double_count_flags: flags.length,
    },
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────────────

/** Dry run. Every change happens inside a transaction that is always rolled back. */
function previewSwitchover(db) {
  const guard = guardRow(db);
  let captured = null;
  try {
    db.transaction(() => {
      captured = runAll(db, null);
      throw ROLLBACK;
    })();
  } catch (err) {
    if (err !== ROLLBACK) return { ok: false, status: 500, code: 'PREVIEW_FAILED', error: err.message };
  }
  return {
    ok: true,
    dry_run: true,
    already_applied: !!guard,
    applied_at: guard ? guard.value : null,
    ...captured,
  };
}

function backupDirFor(db) {
  return path.join(process.env.DATA_DIR || path.dirname(db.name), 'backups');
}

/**
 * The real thing. Backup first (abort on failure), then one transaction.
 * Never calls applyLeavePlan and never touches leave_automation_enabled.
 */
async function applySwitchover(db, { confirm, note, actor = 'admin', backupDir = null } = {}) {
  if (confirm !== CONFIRM_PHRASE) {
    return { ok: false, status: 400, code: 'CONFIRM_PHRASE', error: `Type ${CONFIRM_PHRASE} to confirm.` };
  }
  const existing = guardRow(db);
  if (existing) {
    return { ok: false, status: 409, code: 'ALREADY_APPLIED', error: `The 2026 switchover was already applied (${existing.value}).` };
  }
  if (db.memory || !db.name || db.name === ':memory:') {
    return { ok: false, status: 500, code: 'NO_BACKUP_TARGET', error: 'In-memory database: nothing to back up, refusing to apply.' };
  }

  const dir = backupDir || backupDirFor(db);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(dir, `pre-leave-switchover-${stamp}.db`);
  try {
    fs.mkdirSync(dir, { recursive: true });
    await db.backup(backupPath);
    if (!fs.existsSync(backupPath) || fs.statSync(backupPath).size === 0) throw new Error('backup file is empty');
  } catch (err) {
    return { ok: false, status: 500, code: 'BACKUP_FAILED', error: `Backup failed, nothing changed: ${err.message}` };
  }

  const log = { actor, note: note ? String(note).slice(0, 500) : 'No note.' };
  let result = null;
  let refused = null;
  try {
    db.transaction(() => {
      // The backup is async, so another request could have applied meanwhile.
      const again = guardRow(db);
      if (again) { refused = again; throw ROLLBACK; }
      result = runAll(db, log);
      const at = new Date().toISOString();
      db.prepare('INSERT INTO policy_config (key, value, description) VALUES (?, ?, ?)')
        .run(GUARD_KEY, at, `Leave switchover 2026 applied by ${actor}; backup ${path.basename(backupPath)}`);
      audit(db, {
        table: 'policy_config', recordId: 0, field: GUARD_KEY, oldValue: null, newValue: at, actor,
        remark: `Leave switchover 2026 applied: ${result.totals.retyped} retyped, ${result.totals.policy_changed} policy keys, `
          + `${result.totals.offsets} offsets, ${result.totals.cl_openings_changed} CL + ${result.totals.el_openings_changed} EL openings. `
          + `Backup ${backupPath}. ${log.note}`,
        action: 'switchover_applied',
      });
      result.applied_at = at;
    })();
  } catch (err) {
    if (err === ROLLBACK) {
      return { ok: false, status: 409, code: 'ALREADY_APPLIED', error: `The 2026 switchover was already applied (${refused.value}).`, backup_path: backupPath };
    }
    return { ok: false, status: 500, code: 'APPLY_FAILED', error: `Apply failed and was rolled back: ${err.message}`, backup_path: backupPath };
  }
  return { ok: true, dry_run: false, already_applied: true, ...result, backup_path: backupPath };
}

module.exports = {
  previewSwitchover,
  applySwitchover,
  backupDirFor,
  CONFIRM_PHRASE,
  GUARD_KEY,
  POLICY_TARGET,
  SUPERSEDED,
  RETYPE_LIST,
  offsetReason,
  doubleCountText,
};
