/**
 * Bulk kinds: employee master edit (P5-02, MASTER_PLAN §7.4 B2). Owner rulings Q3 + Q11; planner rulings Q1–Q13 (22 Oct 2026).
 *
 *   master-edit            direct — shift, department, designation, contractor group. Applied on Save, audit row per field.
 *   master-edit-sensitive  finance approval — bank name / account / IFSC, PAN, UAN, ESI number, company (section 'details');
 *                          leaving the company (section 'exit'). Applied only when a finance/admin user who did not send the
 *                          batch approves it (engine approve = one IMMEDIATE transaction, all-or-nothing).
 *
 * One input row = one person: { code, changes: { field: value }, base?: { field: value as exported }, noMeta?: bool }.
 * `base` comes from the hidden _meta sheet of an exported file: a field whose master value moved since the export is an
 * error ("changed since you downloaded"). A sheet without _meta (noMeta) is accepted with a warning (ruling Q9).
 *
 * Same writers as the single paths (extract, never copy):
 *   shift   → services/employeeMaster.setShift  (= PUT /employees/bulk-shift: same update, same shift_assignment audit)
 *   bank    → services/bankPair readBankPairs + all four columns + auditBankChange (= P1-14 rule)
 *   exit    → services/employeeExit.markLeft     (= PUT /employees/:code/mark-left: status, dates, loan exit flagging)
 *
 * Never here: gross / components (salary revision, P5-04), PF / ESI / LWF flags (statutory upload, R10), code,
 * employment_type / weekly_off_day / category (Q2), personal fields (Q3), punch_no / reporting_manager (no plant column, Q1).
 */
const { setShift } = require('../../employeeMaster');
const { markLeft } = require('../../employeeExit');
const { readBankPairs, auditBankChange, maskTail, normAccount, normIfsc } = require('../../bankPair');
const { ESI_NUMBER_RE, UAN_RE } = require('../../statutoryFlags');
const { deptMatchesContractorKeyword } = require('../../../utils/employeeClassification');
const { isCalendarDate, istToday } = require('../../salaryChange');
const { notifyAlerts } = require('../../loans/notify');

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const CANONICAL_COMPANIES = ['Asian Lakto Ind Ltd', 'Indriyan Beverages Pvt Ltd'];
const TEXT_MAX = 100;
const EXIT_REASON_MIN = 5;
const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const ACCOUNT_RE = /^[0-9]{6,20}$/;

/** Field labels, which kind owns each field, and the employees column(s) it reads. */
const FIELDS = {
  shift: { label: 'Shift', kind: 'direct' },
  department: { label: 'Department', kind: 'direct', col: 'department' },
  designation: { label: 'Designation', kind: 'direct', col: 'designation' },
  contractor_group: { label: 'Contractor group', kind: 'direct', col: 'contractor_group' },
  bank_name: { label: 'Bank name', kind: 'sensitive', col: 'bank_name' },
  account: { label: 'Bank account', kind: 'sensitive' },
  ifsc: { label: 'IFSC', kind: 'sensitive' },
  pan: { label: 'PAN', kind: 'sensitive', col: 'pan' },
  uan: { label: 'UAN', kind: 'sensitive', col: 'uan' },
  esi_number: { label: 'ESI number', kind: 'sensitive', col: 'esi_number' },
  company: { label: 'Company', kind: 'sensitive', col: 'company' },
  exit: { label: 'Leaving', kind: 'exit' },
};
const DIRECT_FIELDS = Object.keys(FIELDS).filter(f => FIELDS[f].kind === 'direct');
const DETAIL_FIELDS = Object.keys(FIELDS).filter(f => FIELDS[f].kind === 'sensitive');

/** Columns that can never be changed here, with the plain reason shown on the row. */
const REFUSED = (() => {
  const m = {};
  for (const f of ['pf_applicable', 'esi_applicable', 'lwf_applicable', 'pf', 'esi', 'lwf']) m[f] = 'PF / ESI / LWF flags change only through Statutory flags';
  for (const f of ['gross', 'gross_salary', 'basic', 'da', 'hra', 'conveyance', 'special_allowance', 'other_allowances', 'salary']) m[f] = 'salary changes go through Salary → Bulk salary revision';
  for (const f of ['employment_type', 'weekly_off_day', 'category', 'is_contractor']) m[f] = 'cannot be changed in bulk — it moves pay or leave; edit the person one by one';
  m.code = 'the employee code cannot be changed';
  m.status = 'use the Leaving columns (leaving date + reason); bringing someone back is done one by one';
  m.punch_no = 'plant employees have no punch number field — the punch number is the employee code';
  m.reporting_manager = 'plant employees have no reporting manager field';
  for (const f of ['name', 'father_name', 'dob', 'gender', 'phone', 'email', 'address_current', 'address_permanent', 'aadhar',
    'blood_group', 'emergency_contact_name', 'emergency_contact_phone', 'date_of_joining', 'pf_number']) {
    m[f] = 'personal fields are not edited in bulk';
  }
  return m;
})();

const r2 = (x) => Math.round(x * 100) / 100;
const txt = (v) => (v === null || v === undefined ? '' : String(v).trim());
const blank = (v) => txt(v) === '';
const monthIdx = (y, m) => Number(y) * 12 + Number(m);
const monLabel = (m, y) => `${MONTHS[m - 1]} ${y}`;
const ddmmyyyy = (iso) => (/^\d{4}-\d{2}-\d{2}/.test(String(iso || '')) ? `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}` : String(iso || ''));
const digits = (v) => txt(v).replace(/\s+/g, '');

/** Accept YYYY-MM-DD or DD-MM-YYYY / DD/MM/YYYY (day first, never guessed the other way). */
function normDate(v) {
  const s = txt(v);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(s);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return s;
}

function findEmployee(db, code) {
  const exact = db.prepare('SELECT * FROM employees WHERE code = ?').get(code);
  if (exact) return exact;
  const ci = db.prepare('SELECT * FROM employees WHERE code = ? COLLATE NOCASE').all(code);
  return ci.length === 1 ? ci[0] : null;
}

/** The value a field holds now (what the sheet exports and what the stale check compares). */
function currentValue(db, emp, field) {
  if (field === 'shift') {
    if (emp.default_shift_id) {
      const s = db.prepare('SELECT code FROM shifts WHERE id = ?').get(emp.default_shift_id);
      if (s) return s.code;
    }
    return '';
  }
  if (field === 'account') return normAccount(emp.account_number) ?? normAccount(emp.bank_account) ?? '';
  if (field === 'ifsc') return normIfsc(emp.ifsc_code) ?? normIfsc(emp.ifsc) ?? '';
  if (field === 'exit') return emp.status === 'Left' ? txt(emp.date_of_exit) : '';
  return txt(emp[FIELDS[field].col]);
}
const sameText = (a, b) => txt(a).toUpperCase() === txt(b).toUpperCase();

/* ── Open payroll months (same definition as P5-04 / Q-EM: Stage 7 rows, not finalised) ── */
function openMonths(db) {
  return db.prepare(`SELECT s.year y, s.month m FROM salary_computations s
      WHERE NOT EXISTS (SELECT 1 FROM monthly_imports f WHERE f.year = s.year AND f.month = s.month AND f.is_finalised = 1)
      GROUP BY s.year, s.month ORDER BY s.year, s.month`).all();
}
function stage7OpenRows(db, code) {
  return db.prepare(`SELECT month, year, company, net_salary FROM salary_computations s WHERE employee_code = ?
      AND NOT EXISTS (SELECT 1 FROM monthly_imports f WHERE f.year = s.year AND f.month = s.month AND f.is_finalised = 1)
    ORDER BY year, month`).all(code);
}
/**
 * Has the plant bank (NEFT) file for a month gone out? The plant routes keep no export stamp, so the only record is
 * usage_logs (path = the request URL with its query): a download of GET /api/reports/bank-salary-file?…&download=true,
 * or any read of GET /api/reports/bank-transfer (the bank transfer sheet, saved as CSV in the browser) for that month
 * and year, any company. Conservative. Filtered in SQL (review fix 2) — this runs inside the IMMEDIATE batch txn.
 */
const QS = "('&' || substr(path, instr(path, '?') + 1) || '&')";
function bankFileDownloaded(db, month, year) {
  const m = String(parseInt(month, 10)); const y = String(parseInt(year, 10));
  try {
    return !!db.prepare(`SELECT 1 FROM usage_logs
      WHERE ((path LIKE '/api/reports/bank-salary-file?%' AND ${QS} LIKE '%&download=true&%')
             OR path LIKE '/api/reports/bank-transfer?%')
        AND (${QS} LIKE '%&month=' || ? || '&%' OR ${QS} LIKE '%&month=0' || ? || '&%')
        AND ${QS} LIKE '%&year=' || ? || '&%'
      LIMIT 1`).get(m, m, y);
  } catch { return false; }
}
/** The latest finalised month in which this person was paid (Stage 7 row), or null. */
function lastFinalisedPaidMonth(db, code) {
  return db.prepare(`SELECT s.month, s.year FROM salary_computations s
      JOIN monthly_imports f ON f.month = s.month AND f.year = s.year AND f.is_finalised = 1
    WHERE s.employee_code = ? ORDER BY s.year DESC, s.month DESC LIMIT 1`).get(code) || null;
}
function finalisedMonth(db, month, year) {
  return !!db.prepare('SELECT 1 FROM monthly_imports WHERE month = ? AND year = ? AND is_finalised = 1 LIMIT 1').get(month, year);
}

/** Another employee holding this value in col (normalised the same way on both sides). */
function holderOf(db, col, value, empId, { upper = false } = {}) {
  const expr = upper ? `UPPER(REPLACE(TRIM(${col}), ' ', ''))` : `REPLACE(TRIM(${col}), ' ', '')`;
  const hit = db.prepare(`SELECT code FROM employees WHERE ${expr} = ? AND id != ? LIMIT 1`).get(value, empId);
  return hit ? hit.code : null;
}
function accountHolder(db, value, empId) {
  const hit = db.prepare(`SELECT code FROM employees WHERE id != ? AND
      (TRIM(account_number) = ? OR TRIM(bank_account) = ?) LIMIT 1`).get(empId, value, value);
  return hit ? hit.code : null;
}

/* ── Personal numbers: shown as the last 4 only, except to finance / admin (review fix 3, ruling Q6) ── */
const MASKED_FIELDS = new Set(['account', 'pan', 'uan', 'esi_number']);
const maskIf = (field, v) => (MASKED_FIELDS.has(field) && !blank(v) ? maskTail(String(v)) : v);

/* ── Rows ── */
function rowFromInput(input, rowNo) {
  const obj = input && typeof input === 'object' ? input : { code: input };
  const changes = {};
  if (obj.changes && typeof obj.changes === 'object') {
    for (const [k, v] of Object.entries(obj.changes)) changes[String(k).trim().toLowerCase()] = v;
  }
  const base = {};
  if (obj.base && typeof obj.base === 'object') {
    for (const [k, v] of Object.entries(obj.base)) base[String(k).trim().toLowerCase()] = v;
  }
  // numeric: fields whose sheet cell was a number, not text (a long account loses digits in Excel — review fix 5).
  const numeric = Array.isArray(obj.numeric) ? obj.numeric.map(v => String(v).trim().toLowerCase()).filter(Boolean) : [];
  return { rowNo, code: txt(obj.code), changes, base, noMeta: obj.noMeta === true, numeric, messages: [] };
}
const inputOf = (r) => ({ code: r.code, changes: r.changes, base: r.base, noMeta: r.noMeta === true,
  ...(r.numeric && r.numeric.length ? { numeric: r.numeric } : {}) });

/** Repeated codes are merged (first kept). For the sensitive kind, a PAN / UAN / ESI number repeated in the list is an error on every row holding it. */
function makeNormaliseRows(withDupCheck) {
  return function normaliseRows(input) {
    const out = []; const seen = new Map();
    for (const raw of Array.isArray(input) ? input : []) {
      const code = txt(raw && typeof raw === 'object' ? raw.code : raw);
      if (!code) continue;
      const key = code.toLowerCase();
      if (seen.has(key)) {
        const first = seen.get(key);
        if (!first.messages.includes('Listed more than once — kept once')) first.messages.push('Listed more than once — kept once');
        continue;
      }
      const row = rowFromInput(raw, out.length + 1);
      seen.set(key, row);
      out.push(row);
    }
    if (withDupCheck) {
      for (const [field, norm] of [['pan', v => txt(v).toUpperCase().replace(/\s+/g, '')], ['uan', digits], ['esi_number', digits]]) {
        const by = new Map();
        for (const r of out) {
          if (!(field in r.changes) || blank(r.changes[field])) continue;
          const v = norm(r.changes[field]);
          if (!by.has(v)) by.set(v, []);
          by.get(v).push(r);
        }
        for (const list of by.values()) {
          if (list.length < 2) continue;
          for (const r of list) {
            r.dupInList = r.dupInList || {};
            r.dupInList[field] = list.filter(o => o !== r).map(o => o.code).join(', ');
          }
        }
      }
    }
    return { rows: out };
  };
}

/* ── Shared plan helpers ── */
function baseChecks(db, row, allowed, ctx) {
  const messages = [];
  const emp = findEmployee(db, row.code);
  const display = { code: emp ? emp.code : row.code, name: emp?.name || '', department: emp?.department || '', company: emp?.company || '',
    changeText: '', changes: [] };
  const fields = Object.keys(row.changes);
  const fail = (m) => { messages.push(m); return { ok: false, emp, messages, display }; };
  if (!emp) return fail('Not found in the employee master');
  row.code = emp.code;
  if (!fields.length) return fail('Nothing to change in this row');
  for (const f of fields) {
    if (REFUSED[f]) return fail(`${f}: ${REFUSED[f]}`);
    if (!FIELDS[f]) return fail(`${f}: not a field that can be edited in bulk`);
    if (!allowed.includes(f)) {
      if (FIELDS[f].kind === 'direct') return fail(`${FIELDS[f].label} is saved directly, not sent to finance — use Save`);
      if (f === 'exit') return fail('Leaving rows go in their own batch, separate from other changes');
      if (allowed.includes('exit')) return fail(`${FIELDS[f].label} goes in a separate batch from leaving`);
      return fail(`${FIELDS[f].label} needs finance approval — it goes in a "Send to finance" batch`);
    }
  }
  if (row.noMeta) messages.push('No download record in this sheet — every filled cell is treated as a change (cells equal to the master are left as they are)');
  // Stale export: the master moved since the sheet was downloaded.
  for (const f of fields) {
    if (!(f in row.base)) continue;
    const now = currentValue(db, emp, f);
    if (!sameText(now, row.base[f])) return fail(`${FIELDS[f].label} changed since you downloaded the sheet (now "${maskIf(f, now) || 'blank'}") — download again`);
  }
  return { ok: true, emp, messages, display, fields, ctx };
}
function describeChange(field, oldV, newV) {
  const show = (v) => (blank(v) ? 'blank' : String(v));
  return `${FIELDS[field].label}: ${show(oldV)} → ${show(newV)}`;
}

/* ═══════════════ Kind 1: master-edit (direct) ═══════════════ */
function directContext(db) {
  const shifts = new Map(db.prepare('SELECT id, code, name FROM shifts').all().map(s => [s.code.toUpperCase(), s]));
  const set = (col) => new Set(db.prepare(`SELECT DISTINCT UPPER(TRIM(${col})) v FROM employees WHERE TRIM(COALESCE(${col}, '')) != ''`).all().map(r => r.v));
  return { shifts, departments: set('department'), designations: set('designation'), groups: set('contractor_group') };
}

function planDirect(db, row, common, ctx) {
  const b = baseChecks(db, row, DIRECT_FIELDS, ctx);
  const { emp, messages, display } = b;
  const base = (state, action, extra = {}) => ({ state, action, messages, display, fingerprint: extra.fingerprint ?? null, ...extra });
  if (!b.ok) return base('error', 'conflict');
  if (String(emp.status || '').trim().toLowerCase() !== 'active') { messages.push(`Not active (${emp.status || 'no status'})`); return base('error', 'conflict'); }

  const changes = [];   // [{field, col(s), old, new}]
  const warn = [];
  for (const f of b.fields) {
    const raw = row.changes[f];
    const oldV = currentValue(db, emp, f);
    if (f === 'shift') {
      if (blank(raw)) { messages.push('Shift cannot be cleared in bulk'); return base('error', 'conflict'); }
      const s = ctx.shifts.get(txt(raw).toUpperCase());
      if (!s) { messages.push(`Shift "${txt(raw)}" does not exist — use a shift code from the Shifts sheet`); return base('error', 'conflict'); }
      if (emp.default_shift_id === s.id && txt(emp.shift_code) === s.code) continue;
      changes.push({ field: f, old: oldV, new: s.code, shiftId: s.id });
      continue;
    }
    const v = txt(raw);
    if (v.length > TEXT_MAX) { messages.push(`${FIELDS[f].label} is too long (max ${TEXT_MAX} characters)`); return base('error', 'conflict'); }
    if (f === 'department' && !v) { messages.push('Department cannot be cleared'); return base('error', 'conflict'); }
    if (v === oldV) continue;
    if (f === 'department' && !txt(emp.employment_type) && Number(emp.is_contractor) !== 1
      && deptMatchesContractorKeyword(oldV) !== deptMatchesContractorKeyword(v)) {
      messages.push('This department name would change whether payroll treats the person as a contractor — set their employment type first (one by one)');
      return base('error', 'conflict');
    }
    const known = f === 'department' ? ctx.departments : f === 'designation' ? ctx.designations : ctx.groups;
    if (v && !known.has(v.toUpperCase())) warn.push(`New ${FIELDS[f].label.toLowerCase()} "${v}" — no one else has it; check the spelling`);
    if (!v) warn.push(`${FIELDS[f].label} will be cleared`);
    changes.push({ field: f, old: oldV, new: v || null });
  }
  display.changes = changes.map(c => ({ field: c.field, label: FIELDS[c.field].label, old: c.old, new: c.new ?? '' }));
  display.changeText = display.changes.map(c => describeChange(c.field, c.old, c.new)).join('; ');
  const fingerprint = [emp.id, emp.updated_at, ...b.fields.map(f => [f, currentValue(db, emp, f)])];
  if (!changes.length) { messages.push('No change — the master already has these values'); return base('skipped', 'noop', { fingerprint, emp, changes }); }
  messages.push(...warn);
  return base(warn.length ? 'warning' : 'ok', 'update', { fingerprint, emp, changes });
}

function auditField(db, emp, col, oldV, newV, user, stage, remark) {
  db.prepare(`INSERT INTO audit_log (table_name, record_id, field_name, old_value, new_value, changed_by, stage, remark, employee_code, action_type)
    VALUES ('employees', ?, ?, ?, ?, ?, ?, ?, ?, 'master_bulk_edit')`).run(emp.id, col, String(oldV ?? ''), String(newV ?? ''), user || 'unknown', stage, remark, emp.code);
}
const snapshotCols = (db, id, cols) => db.prepare(`SELECT ${['id', 'updated_at', ...cols].join(', ')} FROM employees WHERE id = ?`).get(id);
const DIRECT_COLS = { shift: ['default_shift_id', 'shift_code'], department: ['department'], designation: ['designation'], contractor_group: ['contractor_group'] };

function applyDirect(db, row, plan, common, { batchId, user }) {
  const emp = plan.emp;
  const cols = [...new Set(plan.changes.flatMap(c => DIRECT_COLS[c.field]))];
  const before = snapshotCols(db, emp.id, cols);
  for (const c of plan.changes) {
    if (c.field === 'shift') {
      setShift(db, db.prepare('SELECT id, code, shift_code FROM employees WHERE id = ?').get(emp.id), { id: c.shiftId }, c.new, user);
      continue;
    }
    db.prepare(`UPDATE employees SET ${c.field} = ?, updated_at = datetime('now') WHERE id = ?`).run(c.new, emp.id);
    auditField(db, emp, c.field, c.old, c.new, user, 'MASTER_BULK_EDIT', `${FIELDS[c.field].label} changed in bulk batch #${batchId}`);
  }
  const after = snapshotCols(db, emp.id, cols);
  return { targetTable: 'employees', targetId: emp.id, before: { cols, row: before }, after: { cols, row: after } };
}

const parse = (s) => { try { return JSON.parse(s || 'null'); } catch { return null; } };
function undoableFields(db, bulkRow) {
  const after = parse(bulkRow.after_json);
  if (!after || !after.row) return { ok: false, reason: 'Nothing recorded to undo' };
  const now = snapshotCols(db, after.row.id, after.cols);
  if (!now) return { ok: false, reason: 'The employee is gone' };
  for (const c of after.cols) {
    if (JSON.stringify(now[c] ?? null) !== JSON.stringify(after.row[c] ?? null)) return { ok: false, reason: `${c} was changed again since` };
  }
  return { ok: true };
}
function undoDirect(db, bulkRow, batch, user, reason) {
  const before = parse(bulkRow.before_json); const after = parse(bulkRow.after_json);
  const id = after.row.id;
  const emp = db.prepare('SELECT id, code, shift_code FROM employees WHERE id = ?').get(id);
  const remark = `Undo of bulk batch #${batch.id}. Reason: "${reason}"`;
  if (after.cols.includes('default_shift_id')) setShift(db, emp, { id: before.row.default_shift_id }, before.row.shift_code, user);
  for (const c of after.cols.filter(c => c !== 'default_shift_id' && c !== 'shift_code')) {
    db.prepare(`UPDATE employees SET ${c} = ?, updated_at = datetime('now') WHERE id = ?`).run(before.row[c], id);
    auditField(db, emp, c, after.row[c], before.row[c], user, 'BULK_UNDO', remark);
  }
}

/* ═══════════════ Kind 2: master-edit-sensitive (finance approval) ═══════════════ */
function sensitiveContext(db) {
  const open = openMonths(db);
  const latest = open.length ? open[open.length - 1] : null;
  return { latestOpen: latest, today: istToday() };
}

function planDetails(db, row, ctx, b) {
  const { emp, messages, display } = b;
  const changes = []; const warn = [];
  const err = (m) => { messages.push(m); return { error: true }; };
  for (const f of b.fields) {
    const raw = row.changes[f];
    const oldV = currentValue(db, emp, f);
    let v;
    if (f === 'account') {
      if ((row.numeric || []).includes('account')) return err('Bank account is a number cell in the sheet, so Excel may have changed its last digits — type the account as text');
      v = digits(raw);
      if (v && !ACCOUNT_RE.test(v)) return err('Bank account must be 6 to 20 digits');
    } else if (f === 'ifsc') {
      v = digits(raw).toUpperCase();
      if (v && !IFSC_RE.test(v)) return err('IFSC must look like ABCD0123456 (4 letters, 0, 6 letters or digits)');
    } else if (f === 'pan') {
      v = digits(raw).toUpperCase();
      if (v && !PAN_RE.test(v)) return err('PAN must look like ABCDE1234F');
    } else if (f === 'uan') {
      v = digits(raw);
      if (v && !UAN_RE.test(v)) return err('UAN must be 12 digits');
    } else if (f === 'esi_number') {
      v = digits(raw);
      if (v && !ESI_NUMBER_RE.test(v)) return err('ESI number must be 10 digits');
    } else if (f === 'company') {
      v = txt(raw);
      if (!CANONICAL_COMPANIES.includes(v)) return err(`Company must be exactly one of: ${CANONICAL_COMPANIES.join(' / ')}`);
    } else {
      v = txt(raw);
      if (v.length > TEXT_MAX) return err(`${FIELDS[f].label} is too long (max ${TEXT_MAX} characters)`);
    }
    if (v === txt(oldV) || (f === 'pan' && v === txt(oldV).toUpperCase())) continue;
    if (row.dupInList && row.dupInList[f]) return err(`${FIELDS[f].label} ${maskIf(f, v)} is also given for ${row.dupInList[f]} in this list — one person each`);
    if (v && (f === 'pan' || f === 'uan' || f === 'esi_number')) {
      const other = holderOf(db, f, v, emp.id, { upper: f === 'pan' });
      if (other) return err(`${FIELDS[f].label} ${maskIf(f, v)} already belongs to employee ${other}`);
    }
    if (v && f === 'account') {
      const other = accountHolder(db, v, emp.id);
      if (other) warn.push(`Bank account ${maskIf(f, v)} is also on employee ${other} — check it is right`);
    }
    if (!v) warn.push(`${FIELDS[f].label} will be cleared`);
    if (f === 'company') {
      const rows = stage7OpenRows(db, emp.code);
      const L = ctx.latestOpen;
      const older = rows.filter(r => !L || monthIdx(r.year, r.month) !== monthIdx(L.y, L.m));
      if (older.length) {
        const o = older[0];
        return err(`Salary for ${monLabel(o.month, o.year)} is already computed under "${o.company || 'blank'}" and that month is not finalised — `
          + `a re-run would move the row to ${v}'s bank and PF files. Finalise ${older.length === 1 ? 'that month' : 'those months'} first`);
      }
      const inLatest = rows.find(r => L && monthIdx(r.year, r.month) === monthIdx(L.y, L.m));
      if (inLatest && bankFileDownloaded(db, L.m, L.y)) {
        return err(`The bank (NEFT) file for ${monLabel(L.m, L.y)} has already been downloaded with this person under "${inLatest.company || 'blank'}" — `
          + `change the company after ${monLabel(L.m, L.y)} is finalised`);
      }
      if (inLatest) warn.push(`Salary for ${monLabel(L.m, L.y)} is already computed — re-run Stage 6 and 7 for it (All companies) after approval`);
    }
    changes.push({ field: f, old: oldV, new: v || null });
  }
  // Account without an IFSC anywhere.
  const acct = changes.find(c => c.field === 'account');
  if (acct && acct.new) {
    const ifscAfter = changes.find(c => c.field === 'ifsc')?.new ?? currentValue(db, emp, 'ifsc');
    if (!ifscAfter) warn.push('No IFSC on record — the bank file needs one');
  }
  display.changes = changes.map(c => ({ field: c.field, label: FIELDS[c.field].label, old: c.old, new: c.new ?? '' }));
  display.changeText = display.changes.map(c => describeChange(c.field, c.old, c.new)).join('; ');
  return { changes, warn };
}

function planExit(db, row, ctx, b) {
  const { emp, messages, display } = b;
  const ex = row.changes.exit && typeof row.changes.exit === 'object' ? row.changes.exit : { date: row.changes.exit };
  const date = normDate(ex.date);
  const reason = txt(ex.reason);
  const err = (m) => { messages.push(m); return { error: true }; };
  display.exitDate = date; display.exitReason = reason;
  if (!isCalendarDate(date)) return err('Leaving date must be a real date (DD-MM-YYYY)');
  if (date > ctx.today) return err(`Leaving date ${ddmmyyyy(date)} is in the future`);
  const doj = txt(emp.date_of_joining);
  if (/^\d{4}-\d{2}-\d{2}$/.test(doj) && date < doj) return err(`Leaving date is before the joining date (${ddmmyyyy(doj)})`);
  if (reason.length < EXIT_REASON_MIN) return err(`Give a reason for leaving (at least ${EXIT_REASON_MIN} characters)`);
  const m = Number(date.slice(5, 7)); const y = Number(date.slice(0, 4));
  if (finalisedMonth(db, m, y)) return err(`Payroll for ${monLabel(m, y)} is finalised — the leaving date cannot be in it`);
  const lastPaid = lastFinalisedPaidMonth(db, emp.code);
  if (lastPaid && monthIdx(y, m) < monthIdx(lastPaid.year, lastPaid.month)) {
    return err(`This person was paid in ${monLabel(lastPaid.month, lastPaid.year)}, which is finalised — the leaving date cannot be in an earlier month`);
  }
  const warn = [];
  const loans = db.prepare(`SELECT COUNT(*) n FROM loans WHERE borrower_type = 'plant' AND employee_code = ?
    AND status IN ('requested','approved','active') AND exit_flag = 0`).get(emp.code);
  if (loans && loans.n) warn.push(`${loans.n} open loan(s) will be flagged for recovery from the final salary`);
  const computed = stage7OpenRows(db, emp.code).filter(r => monthIdx(r.year, r.month) >= monthIdx(y, m));
  if (computed.length) warn.push(`Salary for ${monLabel(computed[0].month, computed[0].year)} is already computed — re-run Stage 6 and 7 after approval`);
  display.changes = [{ field: 'exit', label: 'Leaving', old: '', new: `${ddmmyyyy(date)} — ${reason}` }];
  display.changeText = `Leaves on ${ddmmyyyy(date)}: ${reason}`;
  return { changes: [{ field: 'exit', date, reason }], warn };
}

function planSensitive(db, row, common, ctx) {
  const allowed = common.section === 'exit' ? ['exit'] : DETAIL_FIELDS;
  const b = baseChecks(db, row, allowed, ctx);
  const { emp, messages, display } = b;
  const base = (state, action, extra = {}) => ({ state, action, messages, display, fingerprint: extra.fingerprint ?? null, ...extra });
  if (!b.ok) return base('error', 'conflict');
  const status = String(emp.status || '').trim().toLowerCase();
  if (common.section === 'exit' && status === 'left') { messages.push(`Already Left (${ddmmyyyy(emp.date_of_exit) || 'no date'})`); return base('skipped', 'noop', { fingerprint: [emp.id, emp.status], emp, changes: [] }); }
  if (status !== 'active') { messages.push(`Not active (${emp.status || 'no status'})`); return base('error', 'conflict'); }
  const res = common.section === 'exit' ? planExit(db, row, ctx, b) : planDetails(db, row, ctx, b);
  if (res.error) return base('error', 'conflict');
  const fingerprint = [emp.id, emp.updated_at, emp.status, ...b.fields.map(f => [f, currentValue(db, emp, f)]),
    b.fields.includes('company') ? stage7OpenRows(db, emp.code) : null];
  if (!res.changes.length) { messages.push('No change — the master already has these values'); return base('skipped', 'noop', { fingerprint, emp, changes: [] }); }
  messages.push(...res.warn);
  return base(res.warn.length ? 'warning' : 'ok', 'update', { fingerprint, emp, changes: res.changes });
}

const SENSITIVE_COLS = {
  bank_name: ['bank_name'], account: ['account_number', 'bank_account'], ifsc: ['ifsc_code', 'ifsc'],
  pan: ['pan'], uan: ['uan'], esi_number: ['esi_number'], company: ['company'],
};

function applySensitive(db, row, plan, common, { batchId, user, requestedBy }) {
  const emp = db.prepare('SELECT * FROM employees WHERE id = ?').get(plan.emp.id);
  const remark = (what) => `${what} — bulk batch #${batchId}, sent by ${requestedBy}, approved by ${user}`;
  if (common.section === 'exit') {
    const c = plan.changes[0];
    const out = markLeft(db, emp, { date_of_leaving: c.date, reason: c.reason, markedBy: requestedBy, username: user });
    auditField(db, emp, 'status', emp.status, 'Left', user, 'MASTER_BULK_EXIT', remark(`Leaving date ${c.date}`));
    notifyAlerts(db, out.exitAlerts);
    return { targetTable: 'employees', targetId: emp.id, before: { status: emp.status, date_of_exit: emp.date_of_exit },
      after: { exit: true, exitDate: out.exitDate, loans: out.loanSummary } };
  }
  const cols = [...new Set(plan.changes.flatMap(c => SENSITIVE_COLS[c.field]))];
  const before = snapshotCols(db, emp.id, cols);
  const bankBody = {};
  for (const c of plan.changes) {
    if (c.field === 'account') bankBody.account_number = c.new;
    else if (c.field === 'ifsc') bankBody.ifsc_code = c.new;
  }
  if (Object.keys(bankBody).length) {
    const pairs = readBankPairs(bankBody);
    const set = []; const args = [];
    if (pairs.account.present) { set.push('account_number = ?', 'bank_account = ?'); args.push(pairs.account.value, pairs.account.value); }
    if (pairs.ifsc.present) { set.push('ifsc_code = ?', 'ifsc = ?'); args.push(pairs.ifsc.value, pairs.ifsc.value); }
    db.prepare(`UPDATE employees SET ${set.join(', ')}, updated_at = datetime('now') WHERE id = ?`).run(...args, emp.id);
    auditBankChange(db, { emp, employeeId: emp.id, employeeCode: emp.code, account: pairs.account, ifsc: pairs.ifsc, user, via: `bulk batch #${batchId}` });
  }
  for (const c of plan.changes) {
    if (c.field === 'account' || c.field === 'ifsc') continue;
    db.prepare(`UPDATE employees SET ${c.field} = ?, updated_at = datetime('now') WHERE id = ?`).run(c.new, emp.id);
    const masked = c.field === 'pan' || c.field === 'uan' || c.field === 'esi_number';
    auditField(db, emp, c.field, masked ? maskTail(c.old) : c.old, masked ? maskTail(c.new) : c.new, user, 'MASTER_BULK_EDIT_FINANCE',
      remark(`${FIELDS[c.field].label} changed`));
  }
  if (cols.includes('company')) {
    // Review fix 1: open-month day calculations are now stale, so /finalise refuses until Stage 6/7 are re-run.
    db.prepare(`UPDATE day_calculations SET salary_stale = 1 WHERE employee_code = ?
      AND NOT EXISTS (SELECT 1 FROM monthly_imports f WHERE f.year = day_calculations.year AND f.month = day_calculations.month AND f.is_finalised = 1)`)
      .run(emp.code);
  }
  const after = snapshotCols(db, emp.id, cols);
  const stage7 = cols.includes('company') ? stage7OpenRows(db, emp.code) : null;
  return { targetTable: 'employees', targetId: emp.id, before: { cols, row: before }, after: { cols, row: after, stage7 } };
}

function undoableSensitive(db, bulkRow) {
  const after = parse(bulkRow.after_json);
  if (after && after.exit) return { ok: false, reason: 'A leaving entry cannot be undone in bulk — bring the person back from the Employee Master' };
  const u = undoableFields(db, bulkRow);
  if (!u.ok) return u;
  if (after.stage7 && JSON.stringify(stage7OpenRows(db, bulkRow.row_key)) !== JSON.stringify(after.stage7)) {
    return { ok: false, reason: 'Salary (Stage 7) was computed under the new company since — undo is not safe' };
  }
  return { ok: true };
}
function undoSensitive(db, bulkRow, batch, user, reason) {
  const before = parse(bulkRow.before_json); const after = parse(bulkRow.after_json);
  const id = after.row.id;
  const emp = db.prepare('SELECT * FROM employees WHERE id = ?').get(id);
  const set = after.cols.map(c => `${c} = ?`);
  db.prepare(`UPDATE employees SET ${set.join(', ')}, updated_at = datetime('now') WHERE id = ?`).run(...after.cols.map(c => before.row[c]), id);
  const remark = `Undo of bulk batch #${batch.id}. Reason: "${reason}"`;
  if (after.cols.includes('account_number') || after.cols.includes('ifsc_code')) {
    auditBankChange(db, { emp, employeeId: id, employeeCode: emp.code,
      account: after.cols.includes('account_number') ? { present: true, value: normAccount(before.row.account_number) } : { present: false },
      ifsc: after.cols.includes('ifsc_code') ? { present: true, value: normIfsc(before.row.ifsc_code) } : { present: false },
      user, via: `undo of bulk batch #${batch.id}` });
  }
  for (const c of after.cols.filter(c => !['account_number', 'bank_account', 'ifsc_code', 'ifsc'].includes(c))) {
    const masked = c === 'pan' || c === 'uan' || c === 'esi_number';
    auditField(db, emp, c, masked ? maskTail(after.row[c]) : after.row[c], masked ? maskTail(before.row[c]) : before.row[c], user, 'BULK_UNDO', remark);
  }
}

/* ── Kind objects ── */
const hashRow = (r) => [r.code, JSON.stringify(r.changes), r.plan.state, r.plan.action, r.plan.fingerprint];
const displayExtra = (r) => ({ input: inputOf(r) });
const reviewColumns = [
  { key: 'code', label: 'Code', type: 'text' }, { key: 'name', label: 'Name', type: 'text' },
  { key: 'company', label: 'Company now', type: 'text' }, { key: 'changeText', label: 'Change', type: 'text' },
];
const fieldList = (rows) => [...new Set((rows || []).flatMap(r => Object.keys(r.changes || {})))];
const normaliseOptions = () => ({});
const periodOf = () => ({ month: null, year: null });

const direct = {
  name: 'master-edit', label: 'employee master edit', noun: 'people',
  nothingToSave: 'Nothing to save — every row already has these values',
  roles: { create: ['admin', 'hr'], approve: ['admin', 'finance'] },
  hashRow, inputOf, rowFromInput, displayExtra, reviewColumns,
  normaliseCommon: (c) => ({ ok: true, value: { source: c && c.source === 'selection' ? 'selection' : 'sheet', fields: Array.isArray(c?.fields) ? c.fields.map(String).slice(0, 20) : [] } }),
  normaliseRows: makeNormaliseRows(false), normaliseOptions, periodOf,
  describe: (c) => `${c?.fields?.length ? c.fields.map(f => FIELDS[f]?.label || f).join(', ') : 'master fields'} (${c?.source === 'selection' ? 'selected people' : 'sheet'})`,
  context: (db) => directContext(db),
  planRow: planDirect, applyRow: applyDirect, undoable: undoableFields, undoRow: undoDirect,
};

const sensitive = {
  name: 'master-edit-sensitive', label: 'employee master edit (finance)', noun: 'people', requiresApproval: true,
  nothingToSave: 'Nothing to send — every row already has these values',
  roles: { create: ['admin', 'hr'], approve: ['admin', 'finance'] },
  hashRow, inputOf, rowFromInput, displayExtra, reviewColumns,
  normaliseCommon: (c) => {
    const section = c && c.section === 'exit' ? 'exit' : 'details';
    return { ok: true, value: { section, source: c && c.source === 'selection' ? 'selection' : 'sheet', fields: Array.isArray(c?.fields) ? c.fields.map(String).slice(0, 20) : [] } };
  },
  normaliseRows: makeNormaliseRows(true), normaliseOptions, periodOf,
  describe: (c) => (c?.section === 'exit' ? 'leaving the company' : `${c?.fields?.length ? c.fields.map(f => FIELDS[f]?.label || f).join(', ') : 'bank / statutory / company'}`),
  context: (db) => sensitiveContext(db),
  planRow: planSensitive, applyRow: applySensitive, undoable: undoableSensitive, undoRow: undoSensitive,
};

/**
 * Review fix 3: what a role other than finance / admin sees of a row (preview, refused rows, batch detail).
 * Account, PAN, UAN and ESI number → last 4. keepInput: the creator's own preview keeps `input` (the panel saves
 * from it); everywhere else the input is masked too.
 */
function redactRow(row, { keepInput = false } = {}) {
  if (!row || typeof row !== 'object') return row;
  const out = { ...row };
  if (Array.isArray(row.changes)) {
    out.changes = row.changes.map(c => ({ ...c, old: maskIf(c.field, c.old), new: maskIf(c.field, c.new) }));
    if (out.changes.some(c => MASKED_FIELDS.has(c.field)) && out.changes.every(c => FIELDS[c.field])) {
      out.changeText = out.changes.filter(c => c.field !== 'exit').map(c => describeChange(c.field, c.old, c.new)).join('; ') || row.changeText;
    }
  }
  if (!keepInput && row.input && typeof row.input === 'object') {
    const mask = (o) => (o && typeof o === 'object' ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, maskIf(k, v)])) : o);
    out.input = { ...row.input, changes: mask(row.input.changes), base: mask(row.input.base) };
  }
  return out;
}
sensitive.redactRow = redactRow;

/** Read helper for the screen: shifts, departments, designations, contractor groups, companies + field table. */
function meta(db) {
  const list = (col) => db.prepare(`SELECT TRIM(${col}) v, COUNT(*) n FROM employees WHERE status = 'Active' AND TRIM(COALESCE(${col}, '')) != ''
    GROUP BY TRIM(${col}) ORDER BY n DESC, v`).all().map(r => r.v);
  return {
    fields: Object.entries(FIELDS).map(([key, f]) => ({ key, label: f.label, kind: f.kind })),
    shifts: db.prepare('SELECT id, code, name, start_time, end_time FROM shifts ORDER BY code').all(),
    departments: list('department'), designations: list('designation'), contractorGroups: list('contractor_group'),
    companies: CANONICAL_COMPANIES, refused: REFUSED,
  };
}

/** Current values of the chosen fields for the export sheet (and its _meta). Codes optional (else all Active). */
function exportRows(db, { fields, codes }) {
  const keep = (fields || []).filter(f => FIELDS[f] && f !== 'exit');
  let emps;
  if (Array.isArray(codes) && codes.length) {
    const ph = codes.map(() => '?').join(',');
    emps = db.prepare(`SELECT * FROM employees WHERE code IN (${ph}) ORDER BY code`).all(...codes.map(String));
  } else {
    emps = db.prepare("SELECT * FROM employees WHERE status = 'Active' ORDER BY code").all();
  }
  return emps.map(e => ({ code: e.code, name: e.name, department: e.department || '', status: e.status,
    values: Object.fromEntries(keep.map(f => [f, currentValue(db, e, f)])) }));
}

module.exports = { direct, sensitive, meta, exportRows, FIELDS, REFUSED, DIRECT_FIELDS, DETAIL_FIELDS, CANONICAL_COMPANIES, currentValue, bankFileDownloaded,
  redactRow, MASKED_FIELDS };
