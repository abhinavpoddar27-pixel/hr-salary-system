/**
 * Q-B6 (22 Oct 2026) — a gross change finance has already approved is not asked again.
 *
 * Stage 7 (salaryComputation.js, protected) raises a GROSS_STRUCTURE_CHANGE row in salary_manual_flags whenever the
 * master gross differs from the previous month's saved gross. When that new gross came from a salary change request a
 * finance/admin user already approved (single Salary Input / Employee Master request, or a bulk salary revision — both
 * go through services/salaryChange.approveSalaryChange), Manual Interventions asked finance to approve it a second time.
 *
 * "Stamp on read": the two readers (GET /finance-audit/salary-manual-flags and /readiness-check) call
 * syncGrossFlagPreapprovals(db, month, year) first. It
 *   - stamps a PENDING gross flag finance_approved = 1 when its request (grossRequestForFlag: the employee's latest
 *     approved gross-changing request, new gross = the flag's new gross ± ₹1) was approved by a named person who is
 *     not the requester. approved_by = that approver (never invented). One finance_approvals row tagged
 *     "[auto req #N …]" + one audit_log row (stage FLAG_PREAPPROVED) naming the request, bulk batch and approver.
 *   - withdraws an auto-approval (back to pending, audit FLAG_PREAPPROVAL_WITHDRAWN) when the flag no longer matches
 *     the request it was stamped for (Stage 7's flag UPSERT keeps finance_approved when the values change), and
 *     re-stamps it when a newer eligible request now matches.
 *   - never touches a finalised month, a flag finance decided by hand (approved / rejected / cleared), or any other
 *     flag type.
 * Writes go on the passed db handle (audit included), in one transaction. Idempotent: a second call writes nothing.
 */

const GROSS_FLAG = 'GROSS_STRUCTURE_CHANGE';
const GROSS_MOVED_TOLERANCE = 1; // rupees — same rule decideManualFlag uses (N-MONEY Q1)
const AUTO_TAG_RE = /^\[auto req #(\d+)(?: batch #(\d+))?\]/;

const sameUser = (a, b) => !!a && !!b && String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
const isPerson = (u) => !!u && !['system', 'salary_compute'].includes(String(u).trim().toLowerCase());

/**
 * The salary change request behind a GROSS_STRUCTURE_CHANGE flag, when it can be
 * identified reliably: the employee's LATEST approved request that changed the
 * gross, and its new gross is the flag's new gross (± ₹1). Else null.
 * (Moved unchanged from routes/financeAudit.js — decideManualFlag uses this same function.)
 */
function grossRequestForFlag(db, flag) {
  if (flag.flag_type !== GROSS_FLAG) return null;
  const reqRow = db.prepare(`
    SELECT * FROM salary_change_requests
    WHERE employee_code = ? AND status = 'Approved' AND ABS(COALESCE(new_gross,0) - COALESCE(old_gross,0)) > 0.01
    ORDER BY COALESCE(approved_at, created_at) DESC, id DESC LIMIT 1
  `).get(flag.employee_code);
  if (!reqRow) return null;
  return Math.abs((Number(reqRow.new_gross) || 0) - (parseFloat(flag.manual_value) || 0)) <= GROSS_MOVED_TOLERANCE ? reqRow : null;
}

/** The request may stand in for finance's flag decision: a named approver who is not the requester. */
function eligibleRequest(db, flag) {
  const req = grossRequestForFlag(db, flag);
  if (!req) return null;
  if (!isPerson(req.approved_by)) return null;
  if (sameUser(req.approved_by, req.requested_by)) return null;
  return req;
}

function bulkBatchOf(db, requestId) {
  const r = db.prepare(`SELECT batch_id FROM bulk_rows WHERE target_table = 'salary_change_requests' AND target_id = ?
    AND undone = 0 ORDER BY id DESC LIMIT 1`).get(requestId);
  return r ? r.batch_id : null;
}

function monthFinalised(db, month, year) {
  return !!db.prepare('SELECT 1 x FROM monthly_imports WHERE month = ? AND year = ? AND is_finalised = 1 LIMIT 1').get(month, year);
}

/** The latest finance_approvals row of a flag, parsed when it is an auto-stamp. */
function latestDecision(db, flagId) {
  const row = db.prepare('SELECT * FROM finance_approvals WHERE flag_id = ? ORDER BY id DESC LIMIT 1').get(flagId);
  if (!row) return null;
  const m = AUTO_TAG_RE.exec(String(row.comments || ''));
  return { row, auto: !!m && row.status === 'APPROVED', requestId: m ? Number(m[1]) : null, batchId: m && m[2] ? Number(m[2]) : null };
}

function audit(db, flag, oldVal, newVal, stage, remark) {
  db.prepare(`INSERT INTO audit_log (table_name, record_id, field_name, old_value, new_value, changed_by, stage, remark)
    VALUES ('salary_manual_flags', ?, 'finance_approved', ?, ?, 'system', ?, ?)`)
    .run(String(flag.id), String(oldVal), String(newVal), stage, remark);
}

function stamp(db, flag, req) {
  const batchId = bulkBatchOf(db, req.id);
  const approvedOn = String(req.approved_at || '').slice(0, 10);
  const via = batchId ? `salary change request #${req.id} (bulk batch #${batchId})` : `salary change request #${req.id}`;
  const tag = `[auto req #${req.id}${batchId ? ` batch #${batchId}` : ''}]`;
  const info = db.prepare(`UPDATE salary_manual_flags SET finance_approved = 1, approved_by = ?, approved_at = COALESCE(?, datetime('now'))
    WHERE id = ? AND finance_approved = 0`).run(req.approved_by, req.approved_at || null, flag.id);
  if (info.changes !== 1) return false;
  db.prepare(`INSERT INTO finance_approvals (employee_code, month, year, flag_id, status, reviewed_by, reviewed_at, comments)
    VALUES (?, ?, ?, ?, 'APPROVED', ?, datetime('now'), ?)`)
    .run(flag.employee_code, flag.month, flag.year, flag.id, req.approved_by,
      `${tag} Approved with ${via} by ${req.approved_by}${approvedOn ? ` on ${approvedOn}` : ''} — not asked again`);
  audit(db, flag, 0, 1, 'FLAG_PREAPPROVED',
    `${flag.employee_code} ${flag.month}/${flag.year}: gross ${flag.system_value} → ${flag.manual_value} already approved with ${via} `
    + `by ${req.approved_by} (requested by ${req.requested_by || '—'})`);
  return true;
}

function withdraw(db, flag, dec, reason) {
  const info = db.prepare(`UPDATE salary_manual_flags SET finance_approved = 0, approved_by = NULL, approved_at = NULL
    WHERE id = ? AND finance_approved = 1`).run(flag.id);
  if (info.changes !== 1) return false;
  db.prepare(`INSERT INTO finance_approvals (employee_code, month, year, flag_id, status, reviewed_by, reviewed_at, comments)
    VALUES (?, ?, ?, ?, 'WITHDRAWN', 'system', datetime('now'), ?)`)
    .run(flag.employee_code, flag.month, flag.year, flag.id, `[auto-withdrawn req #${dec.requestId}] ${reason}`);
  audit(db, flag, 1, 0, 'FLAG_PREAPPROVAL_WITHDRAWN',
    `${flag.employee_code} ${flag.month}/${flag.year}: auto-approval from salary change request #${dec.requestId} withdrawn — ${reason}`);
  return true;
}

/**
 * Stamp / withdraw the gross flags of one month. Returns { stamped, withdrawn, skippedFinalised }.
 */
function syncGrossFlagPreapprovals(db, month, year) {
  const m = parseInt(month, 10); const y = parseInt(year, 10);
  const out = { stamped: 0, withdrawn: 0, skippedFinalised: false };
  if (!m || !y) return out;
  if (monthFinalised(db, m, y)) { out.skippedFinalised = true; return out; }
  db.transaction(() => {
    const flags = db.prepare(`SELECT * FROM salary_manual_flags WHERE month = ? AND year = ? AND flag_type = ?
      AND finance_approved IN (0, 1) ORDER BY id`).all(m, y, GROSS_FLAG);
    for (const flag of flags) {
      let approved = Number(flag.finance_approved);
      if (approved === 1) {
        const dec = latestDecision(db, flag.id);
        if (!dec || !dec.auto) continue; // a person approved it by hand — leave it
        const req = eligibleRequest(db, flag);
        if (req && req.id === dec.requestId) continue; // still the request it was stamped for
        const reason = req
          ? `the flag now matches a newer approved request #${req.id}`
          : `the flag's new gross ${flag.manual_value} no longer matches an approved salary change request`;
        if (withdraw(db, flag, dec, reason)) { out.withdrawn++; approved = 0; flag.finance_approved = 0; }
        if (!req) continue;
      }
      if (approved !== 0) continue;
      const req = eligibleRequest(db, flag);
      if (req && stamp(db, flag, req)) out.stamped++;
    }
  })();
  return out;
}

/** For the list reader: flagId → { request_id, batch_id, approved_by } of the auto-stamped, still-approved flags. */
function preapprovalInfo(db, flags) {
  const map = {};
  for (const f of flags) {
    if (f.flag_type !== GROSS_FLAG || Number(f.finance_approved) !== 1) continue;
    const dec = latestDecision(db, f.id);
    if (dec && dec.auto) map[f.id] = { request_id: dec.requestId, batch_id: dec.batchId, approved_by: dec.row.reviewed_by };
  }
  return map;
}

module.exports = {
  grossRequestForFlag, eligibleRequest, syncGrossFlagPreapprovals, preapprovalInfo,
  GROSS_MOVED_TOLERANCE, AUTO_TAG_RE,
};
