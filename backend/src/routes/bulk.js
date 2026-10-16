/**
 * Bulk entry API (P3-01, approval stage P5-01). Mounted at /api/bulk behind requireAuth.
 * Role gates are per route (P5-01): create/check/save/submit = the kind's `roles.create`
 * (extra duty: hr/admin, unchanged — planner ruling Q-B, 12 Oct 2026); approve/reject/return =
 * finance/admin (and the kind's `roles.approve`). Engine: services/bulk/engine.js.
 */
const express = require('express');
const router = express.Router();
const { getDb } = require('../database/db');
const { requireHrOrAdmin, requireFinanceOrAdmin } = require('../middleware/roles');
const { normalizeRole } = require('./auth');
const engine = require('../services/bulk/engine');
const extraDuty = require('../services/bulk/kinds/extraDuty');

const send = (res, r) => {
  if (r && r.ok === false) {
    const { status = 400, ok, ...body } = r;
    return res.status(status).json({ success: false, ...body });
  }
  const { ok, ...body } = r;
  return res.json({ success: true, ...body });
};
const userOf = (req) => req.user?.username || 'hr';
const roleOf = (req) => normalizeRole(req.user?.role);

const ROLE_WORD = { admin: 'admin', hr: 'HR', finance: 'Finance', viewer: 'viewer', supervisor: 'supervisor' };
/** Same 403 text as middleware/roles.js for the usual pairs (ED stays byte-identical). */
function deny(res, roles) {
  const set = [...roles].sort().join(',');
  const error = set === 'admin,hr' ? 'HR or admin access required'
    : set === 'admin,finance' ? 'Finance or admin access required'
    : `${roles.filter(r => r !== 'admin').map(r => ROLE_WORD[r] || r).join(', ')} or admin access required`;
  return res.status(403).json({ success: false, error });
}
const READ_ROLES = ['admin', 'hr', 'finance'];

/** :kind routes — the kind's create roles. Unknown kind → hr/admin gate, then the engine's 404. */
function gateCreate(req, res, next) {
  const kind = engine.getKind(req.params.kind);
  if (!kind) return requireHrOrAdmin(req, res, next);
  const roles = engine.rolesOf(kind).create;
  return roles.includes(roleOf(req)) ? next() : deny(res, roles);
}

function batchKind(req) {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return { id: null };
  const b = getDb().prepare('SELECT kind FROM bulk_batches WHERE id = ?').get(id);
  return { id, batch: b, kind: b ? engine.getKind(b.kind) : null };
}

// Kind-specific read helpers (registered before /:kind/…).
router.get('/extra-duty/employees', requireHrOrAdmin, (req, res) => {
  res.json({ success: true, data: extraDuty.employeesLite(getDb()) });
});
router.get('/extra-duty/people', requireHrOrAdmin, (req, res) => {
  const date = String(req.query.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ success: false, error: 'Pick a date' });
  res.json({ success: true, data: extraDuty.peopleOnDate(getDb(), date) });
});

// Lists: only kinds the role may create, or (approval kinds) decide. Asking for any other kind → 403.
router.get('/batches', (req, res) => {
  const role = roleOf(req);
  if (!READ_ROLES.includes(role)) return deny(res, ['admin', 'hr']);
  const { kind, status, month, year, limit, sinceDays, approval } = req.query;
  // approval=1 → the finance queue: approval kinds only (admin would otherwise also see extra-duty batches).
  const visible = engine.visibleKinds(role).filter(k => approval !== '1' || engine.needsApproval(engine.getKind(k)));
  if (kind && !visible.includes(kind)) {
    const k = engine.getKind(kind);
    return deny(res, k ? engine.rolesOf(k).create : ['admin', 'hr']);
  }
  // Review F1: a read role with no visible kinds (e.g. admin's ?approval=1 queue when no approval kind is
  // registered) gets an empty list, never a 403 — Finance Verification loads it on every visit.
  if (!kind && !visible.length) return res.json({ success: true, data: [] });
  res.json({ success: true, data: engine.listBatches(getDb(), { kind, kinds: kind ? undefined : visible, status, month, year, limit, sinceDays }) });
});
router.get('/batches/:id', (req, res) => {
  const role = roleOf(req);
  if (!READ_ROLES.includes(role)) return deny(res, ['admin', 'hr']);
  const { id, batch, kind } = batchKind(req);
  if (!batch) {
    if (role !== 'admin' && role !== 'hr') return deny(res, ['admin', 'hr']);
    return res.status(404).json({ success: false, error: 'Batch not found' });
  }
  if (!engine.visibleKinds(role).includes(batch.kind)) return deny(res, kind ? engine.rolesOf(kind).create : ['admin', 'hr']);
  res.json({ success: true, data: engine.getBatch(getDb(), id) });
});

// Undo: direct kinds = their create roles (ED hr/admin, unchanged); approval kinds = finance/admin
// with a reason (ruling Q-A2) — undo reverses a finance decision.
router.post('/batches/:id/undo', (req, res) => {
  const { id, batch, kind } = batchKind(req);
  if (!batch || !kind) {
    if (!['admin', 'hr'].includes(roleOf(req))) return deny(res, ['admin', 'hr']);
    if (!Number.isInteger(id)) return res.status(400).json({ success: false, error: 'Bad batch id' });
    return send(res, engine.undo(getDb(), id, req.body?.reason, userOf(req)));
  }
  const roles = engine.needsApproval(kind) ? engine.rolesOf(kind).approve : engine.rolesOf(kind).create;
  if (!roles.includes(roleOf(req))) return deny(res, roles);
  send(res, engine.undo(getDb(), id, req.body?.reason, userOf(req)));
});

// Finance decisions on submitted batches (P5-01).
function gateDecide(req, res, next) {
  const { batch, kind } = batchKind(req);
  if (!batch || !kind) return next(); // engine answers 404 / 409
  const roles = engine.rolesOf(kind).approve;
  return roles.includes(roleOf(req)) ? next() : deny(res, roles);
}
const batchIdOr400 = (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) { res.status(400).json({ success: false, error: 'Bad batch id' }); return null; }
  return id;
};
router.post('/batches/:id/approve', requireFinanceOrAdmin, gateDecide, (req, res) => {
  const id = batchIdOr400(req, res); if (id === null) return;
  send(res, engine.approve(getDb(), id, userOf(req)));
});
router.post('/batches/:id/reject', requireFinanceOrAdmin, gateDecide, (req, res) => {
  const id = batchIdOr400(req, res); if (id === null) return;
  send(res, engine.decide(getDb(), id, 'reject', req.body?.reason, userOf(req)));
});
router.post('/batches/:id/return', requireFinanceOrAdmin, gateDecide, (req, res) => {
  const id = batchIdOr400(req, res); if (id === null) return;
  send(res, engine.decide(getDb(), id, 'return', req.body?.note ?? req.body?.reason, userOf(req)));
});

router.post('/:kind/preview', gateCreate, (req, res) => send(res, engine.preview(getDb(), req.params.kind, req.body || {})));
router.post('/:kind/apply', gateCreate, (req, res) => send(res, engine.apply(getDb(), req.params.kind, req.body || {}, userOf(req))));
router.post('/:kind/submit', gateCreate, (req, res) => send(res, engine.submit(getDb(), req.params.kind, req.body || {}, userOf(req))));

module.exports = router;
