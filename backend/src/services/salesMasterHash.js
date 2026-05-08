// Sales Master Hash — Phase 1 Template Model (May 2026)
//
// Pure utility for producing a deterministic snapshot of the sales master
// for a given (month, year, company). The hash captures the identity-
// shaping fields (code, status, DOJ, DOL) of every employee that is
// eligible to appear on a salary template for that month, so Phase 2 can
// reject uploads stamped against a stale snapshot.
//
// Eligibility: employees of the given company where
//   status = 'Active', OR
//   dol falls within the requested month (still owed final settlement).
//
// Determinism: rows are sorted by `code`, JSON-serialized, then sha256
// hashed. Same inputs always produce the same 64-char hex digest.

const crypto = require('crypto');

function monthBounds(month, year) {
  const m = String(month).padStart(2, '0');
  const lastDay = new Date(year, month, 0).getDate();
  const d = String(lastDay).padStart(2, '0');
  return { start: `${year}-${m}-01`, end: `${year}-${m}-${d}` };
}

function getEligibleEmployees(db, month, year, company) {
  if (!db) throw new Error('db handle required');
  const m = Number(month), y = Number(year);
  if (!Number.isInteger(m) || m < 1 || m > 12) throw new Error('invalid month');
  if (!Number.isInteger(y)) throw new Error('invalid year');
  if (!company || typeof company !== 'string') throw new Error('company required');

  const { start, end } = monthBounds(m, y);

  const rows = db.prepare(`
    SELECT code, status, doj, dol
    FROM sales_employees
    WHERE company = ?
      AND (
        status = 'Active'
        OR (dol IS NOT NULL AND dol >= ? AND dol <= ?)
      )
    ORDER BY code ASC
  `).all(company, start, end);

  return rows.map((r) => ({
    code: r.code,
    status: r.status,
    doj: r.doj || null,
    dol: r.dol || null,
  }));
}

function computeMasterHash(db, month, year, company) {
  const eligible = getEligibleEmployees(db, month, year, company);
  const canonical = JSON.stringify(eligible);
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

module.exports = { computeMasterHash, getEligibleEmployees, monthBounds };
