/**
 * Bulk entry API (P3-01). Mounted at /api/bulk behind requireAuth.
 * HR / admin only for now (planner ruling Q-B, 12 Oct 2026) — same roles as a
 * single extra duty create. Engine: services/bulk/engine.js.
 */
const express = require('express');
const router = express.Router();
const { getDb } = require('../database/db');
const { requireHrOrAdmin } = require('../middleware/roles');
const engine = require('../services/bulk/engine');
const extraDuty = require('../services/bulk/kinds/extraDuty');

router.use(requireHrOrAdmin);

const send = (res, r) => {
  if (r && r.ok === false) {
    const { status = 400, ok, ...body } = r;
    return res.status(status).json({ success: false, ...body });
  }
  const { ok, ...body } = r;
  return res.json({ success: true, ...body });
};
const userOf = (req) => req.user?.username || 'hr';

// Kind-specific read helpers (registered before /:kind/…).
router.get('/extra-duty/employees', (req, res) => {
  res.json({ success: true, data: extraDuty.employeesLite(getDb()) });
});
router.get('/extra-duty/people', (req, res) => {
  const date = String(req.query.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ success: false, error: 'Pick a date' });
  res.json({ success: true, data: extraDuty.peopleOnDate(getDb(), date) });
});

router.get('/batches', (req, res) => {
  const { kind, month, year, limit } = req.query;
  res.json({ success: true, data: engine.listBatches(getDb(), { kind, month, year, limit }) });
});
router.get('/batches/:id', (req, res) => {
  const b = engine.getBatch(getDb(), parseInt(req.params.id, 10));
  if (!b) return res.status(404).json({ success: false, error: 'Batch not found' });
  res.json({ success: true, data: b });
});
router.post('/batches/:id/undo', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ success: false, error: 'Bad batch id' });
  send(res, engine.undo(getDb(), id, req.body?.reason, userOf(req)));
});

router.post('/:kind/preview', (req, res) => send(res, engine.preview(getDb(), req.params.kind, req.body || {})));
router.post('/:kind/apply', (req, res) => send(res, engine.apply(getDb(), req.params.kind, req.body || {}, userOf(req))));

module.exports = router;
