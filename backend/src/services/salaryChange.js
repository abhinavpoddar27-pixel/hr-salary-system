/**
 * Salary change approval (P5-04, ruling Q-B7). The helpers and the approve body moved verbatim
 * from routes/salary-input.js; PUT /api/salary-input/approve/:id is now a thin call to
 * approveSalaryChange(), with the same responses. The bulk salary revision kind calls the same
 * function inside the bulk approve transaction, so a revision is approved exactly like a single
 * request (N-17 kept components, N-MONEY2 percents, N-PF ceiling, R10 flags carried).
 */
const { structureForDate, structureDatedAfter } = require('./statutoryFlags');

/** 'YYYY-MM-DD' with month 01–12 and a day that exists in that month (leap years included). */
function isCalendarDate(v) {
  const m = /^(\d{4})-(0[1-9]|1[0-2])-(\d{2})$/.exec(String(v));
  if (!m) return false;
  const day = Number(m[3]);
  return day >= 1 && day <= new Date(Date.UTC(Number(m[1]), Number(m[2]), 0)).getUTCDate();
}

// Statutory flags PR-1 (R10): PF / ESI / LWF change only through the statutory
// upload. A salary change request never carries them; approval copies them
// (with pt, the percent columns and pf_wage_ceiling) from the structure in
// force at the new row's own date.
const STATUTORY_FLAG_FIELDS = ['pf_applicable', 'esi_applicable', 'lwf_applicable'];

// N-17 (11 Oct 2026): a salary change request names only some components —
// Salary Input sends no special_allowance, Employee Master no conveyance. A
// component ABSENT from the request keeps the value of the structure in force
// at the approval date; a component present (0 included) is written as sent.
// Gross: the request's explicit gross_salary when it has one, else the sum of
// the resolved components (planner ruling Q3a). The pending list returns the
// same result as `approval_preview`, so finance sees what approval will write.
const COMPONENT_KEYS = ['basic', 'da', 'hra', 'conveyance', 'special_allowance', 'other_allowances'];
const present = (v) => v !== undefined && v !== null && v !== '';
const money = (v) => Math.round((parseFloat(v) || 0) * 100) / 100;

// N-MONEY2 (F-1): a split change from Employee Master carries basic/hra/da
// percentages. Approval writes them (the window reads the percent columns, and a
// later gross change rebuilds the split from them). A request without them keeps
// the in-force row's percents, as before.
const PERCENT_KEYS = ['basic_percent', 'hra_percent', 'da_percent'];
function requestedPercents(newStructure) {
  const out = {};
  for (const k of PERCENT_KEYS) {
    const v = (newStructure || {})[k];
    if (!present(v)) continue;
    const n = Number(v);
    if (Number.isFinite(n) && n >= 0 && n <= 100) out[k] = n;
  }
  return out;
}

// N-PF (owner ruling 16 Oct 2026): a PF wage ceiling change from Employee Master
// is approved like a split change. The request's ceiling is written only when it
// differs from the request's own snapshot (old_structure; none → 15000), so the
// many older requests that just echo the ceiling keep the in-force value. null = none.
function requestedCeiling(newStructure, oldStructure) {
  const v = (newStructure || {}).pf_wage_ceiling;
  if (!present(v)) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  const o = (oldStructure || {}).pf_wage_ceiling;
  const was = present(o) && Number.isFinite(Number(o)) ? Number(o) : 15000;
  return Math.abs(n - was) > 0.01 ? n : null;
}

function resolveApproval(newStructure, current) {
  const ns = newStructure || {};
  const cur = current || {};
  const components = {};
  const kept = [];
  for (const k of COMPONENT_KEYS) {
    if (present(ns[k])) components[k] = parseFloat(ns[k]) || 0;
    else { components[k] = parseFloat(cur[k]) || 0; kept.push(k); }
  }
  const sum = money(COMPONENT_KEYS.reduce((t, k) => t + components[k], 0));
  const gross = present(ns.gross_salary) && (parseFloat(ns.gross_salary) || 0) > 0 ? parseFloat(ns.gross_salary) : sum;
  return { components, kept, gross, componentSum: sum };
}

/** Today's date in India (UTC+05:30) as YYYY-MM-DD — never the UTC day. */
function istToday(now = Date.now()) {
  return new Date(now + 330 * 60000).toISOString().slice(0, 10);
}

// P1-23 (owner ruling Q6, 11 Oct 2026): the person who raised a salary change
// never decides it — admin included. Username compare, trimmed, case-insensitive;
// an empty requested_by (legacy rows) blocks nobody.
const sameUser = (a, b) => !!a && !!b && String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
const SELF_APPROVAL = {
  success: false,
  code: 'SELF_APPROVAL',
  error: 'You raised this request — ask another finance or admin user to decide it.',
};

/**
 * Approve one Pending salary_change_requests row and apply it to salary_structures +
 * employees.gross_salary. Runs its own db.transaction (a savepoint when the caller already holds one).
 *   actor        — the deciding username for the self-approval check (req.user?.username)
 *   approvedBy   — written to approved_by (route: username || 'admin')
 *   effectiveFrom — 'YYYY-MM-DD'; missing → today in IST
 * Returns { ok:true, effectiveFrom, gross, keptComponents, employeeId, sameDate }
 *      or { ok:false, status, body } where body is the route's JSON reply (unchanged texts).
 */
function approveSalaryChange(db, { id, actor, approvedBy, effectiveFrom: requestedDate }) {
  const request = db.prepare('SELECT * FROM salary_change_requests WHERE id = ? AND status = ?').get(id, 'Pending');
  if (!request) return { ok: false, status: 404, body: { success: false, error: 'Request not found or already processed' } };
  if (sameUser(actor, request.requested_by)) return { ok: false, status: 403, body: SELF_APPROVAL };

  let newStructure;
  try { newStructure = JSON.parse(request.new_structure); } catch { newStructure = {}; }
  let oldStructure;
  try { oldStructure = JSON.parse(request.old_structure); } catch { oldStructure = {}; }
  const ceiling = requestedCeiling(newStructure, oldStructure);

  const emp = db.prepare('SELECT id FROM employees WHERE code = ?').get(request.employee_code);
  if (!emp) return { ok: false, status: 404, body: { success: false, error: 'Employee not found' } };

  const effectiveFrom = requestedDate || istToday();
  // A real calendar date only (review fix 5): a bogus later-dated row such as
  // '2026-13-01' would block every honest approval after it (STRUCTURE_DATED_LATER).
  if (!isCalendarDate(effectiveFrom)) {
    return { ok: false, status: 400, body: { success: false, error: 'effectiveFrom must be a real date, YYYY-MM-DD (e.g. 2026-09-01)' } };
  }

  // Resolved inside the transaction (below): a component absent from the
  // request keeps the in-force value (N-17); gross = explicit or the sum.
  // employees.gross_salary and salary_structures.gross_salary are both set
  // to it so they stay in sync.
  let newBasic, newDa, newHra, newConv, newOther, newSpecial, newGross, keptComponents, sameDateRow;

  const txn = db.transaction(() => {
    // A row dated after effectiveFrom would shadow the new one from its date
    // on (compute reads the row in force) — refuse, nothing written, request
    // stays Pending (10 Oct 2026 ruling, statutory flags PR-1 review).
    const later = structureDatedAfter(db, 'plant', emp.id, effectiveFrom);
    if (later) { const err = new Error(later.error); err.statutory = later; throw err; }

    const resolved = resolveApproval(newStructure, structureForDate(db, 'plant', emp.id, effectiveFrom));
    ({ basic: newBasic, da: newDa, hra: newHra, conveyance: newConv,
       other_allowances: newOther, special_allowance: newSpecial } = resolved.components);
    newGross = resolved.gross;
    keptComponents = resolved.kept;

    const pcts = requestedPercents(newStructure);
    const sameDate = db.prepare('SELECT id FROM salary_structures WHERE employee_id = ? AND effective_from = ?').all(emp.id, effectiveFrom);
    sameDateRow = sameDate.length > 0;
    if (sameDate.length) {
      // A row already dated effectiveFrom: update its gross + components in
      // place. It keeps its own flags, pt, pf_wage_ceiling (and the percents the
      // request does not name) — a
      // same-date twin would tie, and plant compute has no id tie-break.
      db.prepare(`
        UPDATE salary_structures SET
          gross_salary = ?, basic = ?, da = ?, hra = ?, conveyance = ?, special_allowance = ?, other_allowances = ?,
          updated_at = datetime('now')
        WHERE employee_id = ? AND effective_from = ?
      `).run(newGross, newBasic, newDa, newHra, newConv, newSpecial, newOther, emp.id, effectiveFrom);
      // F-1: percentages the request names are written too (others keep the row's own).
      for (const [col, val] of Object.entries(pcts)) {
        db.prepare(`UPDATE salary_structures SET ${col} = ? WHERE employee_id = ? AND effective_from = ?`).run(val, emp.id, effectiveFrom);
      }
      // N-PF: a requested ceiling change is written too.
      if (ceiling !== null) {
        db.prepare('UPDATE salary_structures SET pf_wage_ceiling = ? WHERE employee_id = ? AND effective_from = ?').run(ceiling, emp.id, effectiveFrom);
      }
    } else {
      // Flags, pt, pf_wage_ceiling (and any percent column the request does not
      // name) come from the row compute uses at the new row's own date (in force,
      // else latest) — never a default. Read inside the
      // transaction, before the insert.
      const inForce = structureForDate(db, 'plant', emp.id, effectiveFrom) || {};
      const carry = (col, dflt) => (inForce[col] === undefined || inForce[col] === null ? dflt : inForce[col]);
      // F-1: a percent the request names wins; otherwise the in-force row's.
      const pct = (col, dflt) => (pcts[col] !== undefined ? pcts[col] : carry(col, dflt));

      // Insert new salary structure WITH gross_salary so the latest-by-
      // effective_from lookup returns a consistent figure.
      db.prepare(`
        INSERT INTO salary_structures (
          employee_id, gross_salary, basic, da, hra, conveyance, special_allowance, other_allowances,
          basic_percent, da_percent, hra_percent,
          pf_applicable, esi_applicable, lwf_applicable, pt_applicable, pf_wage_ceiling, effective_from
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        emp.id, newGross, newBasic, newDa, newHra, newConv, newSpecial, newOther,
        pct('basic_percent', 50), pct('da_percent', 0), pct('hra_percent', 20),
        carry('pf_applicable', 0) ? 1 : 0, carry('esi_applicable', 0) ? 1 : 0, carry('lwf_applicable', 0) ? 1 : 0,
        carry('pt_applicable', 1) ? 1 : 0, ceiling !== null ? ceiling : carry('pf_wage_ceiling', 15000),
        effectiveFrom
      );
    }

    // Sync employees.gross_salary so the master row agrees with the
    // just-approved structure. Flags are not touched (statutory upload only).
    db.prepare(`UPDATE employees SET
        gross_salary = ?, updated_at = datetime('now')
      WHERE id = ?`).run(newGross, emp.id);

    // Update request status
    db.prepare(`
      UPDATE salary_change_requests SET
        status = 'Approved', approved_by = ?, approved_at = datetime('now')
      WHERE id = ?
    `).run(approvedBy, id);
  });
  try {
    txn();
  } catch (e) {
    if (e.statutory) {
      return { ok: false, status: e.statutory.status, body: { success: false, error: e.statutory.error, code: e.statutory.code, latestDate: e.statutory.latestDate } };
    }
    throw e;
  }

  return { ok: true, effectiveFrom, gross: newGross, keptComponents, employeeId: emp.id, sameDate: sameDateRow };
}

module.exports = {
  isCalendarDate, STATUTORY_FLAG_FIELDS, COMPONENT_KEYS, present, money, PERCENT_KEYS, requestedPercents, requestedCeiling,
  resolveApproval, istToday, sameUser, SELF_APPROVAL, approveSalaryChange,
};
