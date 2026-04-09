// Centralised role-gate middleware. Until April 2026 these were
// duplicated inline in extraDutyGrants.js / financeVerification.js,
// and missing entirely from financeAudit.js / salary-input.js — which
// is how miss-punch finance approval and gross-salary change approval
// ended up callable by any logged-in user. Single source of truth so
// the same gate is enforced everywhere.
//
// Roles are run through normalizeRole() from auth.js so a legacy user
// row with "Finance" / "Finance Team" / "finance " never silently
// fails the gate — same canonical form the frontend uses.

const { normalizeRole } = require('../routes/auth');

function roleIn(req, ...allowed) {
  const r = normalizeRole(req.user?.role);
  return allowed.includes(r);
}

function requireHrOrAdmin(req, res, next) {
  if (roleIn(req, 'admin', 'hr')) return next();
  return res.status(403).json({ success: false, error: 'HR or admin access required' });
}

function requireFinanceOrAdmin(req, res, next) {
  if (roleIn(req, 'admin', 'finance')) return next();
  return res.status(403).json({ success: false, error: 'Finance or admin access required' });
}

function requireAdmin(req, res, next) {
  if (roleIn(req, 'admin')) return next();
  return res.status(403).json({ success: false, error: 'Admin access required' });
}

module.exports = { roleIn, requireHrOrAdmin, requireFinanceOrAdmin, requireAdmin };
