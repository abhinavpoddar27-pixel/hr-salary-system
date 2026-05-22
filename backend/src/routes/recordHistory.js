'use strict';

// Record History Timeline — read-only diagnostic endpoints (Design C, v3, piece #3).
//
// Two GETs:
//   /timeline?table=<t>&record_id=<n>     — raw audit_log rows for one record,
//                                            piped through the existing
//                                            groupAndDiff() module, returned
//                                            inside a thin envelope.
//   /resolve?employee_code=<code>         — distinct (table_name, record_id)
//                                            pairs touching this employee.
//
// NEVER writes. Parameterised SELECT only. Mirrors the healthChecks.js admin
// pattern: outer requireAuth (in server.js) + router-level admin gate here.

const express = require('express');
const router = express.Router();
const { getDb } = require('../database/db');
const { groupAndDiff } = require('../services/recordHistory/groupAndDiff');

// Admin-only gate — applied to all routes in this file. Identical to
// healthChecks.js so future readers grep for the same string.
router.use((req, res, next) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ success: false, error: 'Admin access required' });
  }
  next();
});

// GET /api/admin/record-history/timeline?table=<t>&record_id=<n>
router.get('/timeline', (req, res) => {
  try {
    const table = typeof req.query.table === 'string' ? req.query.table.trim() : '';
    if (!table) {
      return res.status(400).json({ ok: false, error: 'table is required' });
    }
    const rawId = req.query.record_id;
    const recordId = Number.parseInt(rawId, 10);
    if (!Number.isInteger(recordId) || recordId <= 0 || String(recordId) !== String(rawId).trim()) {
      return res.status(400).json({ ok: false, error: 'record_id must be a positive integer' });
    }

    const db = getDb();
    const rows = db.prepare(`
      SELECT id, table_name, record_id, field_name, old_value, new_value,
             changed_by, changed_at, stage, remark, employee_code, action_type
      FROM audit_log
      WHERE table_name = ? AND record_id = ?
      ORDER BY id DESC
    `).all(table, recordId);

    const cards = groupAndDiff(rows);

    return res.json({
      ok: true,
      query: { table_name: table, record_id: recordId },
      card_count: cards.length,
      cards,
    });
  } catch (err) {
    console.error('[record-history/timeline] error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/admin/record-history/resolve?employee_code=<code>
router.get('/resolve', (req, res) => {
  try {
    const employeeCode = typeof req.query.employee_code === 'string'
      ? req.query.employee_code.trim()
      : '';
    if (!employeeCode) {
      return res.status(400).json({ ok: false, error: 'employee_code is required' });
    }

    const db = getDb();
    const candidates = db.prepare(`
      SELECT DISTINCT table_name, record_id
      FROM audit_log
      WHERE employee_code = ?
      ORDER BY table_name, record_id DESC
    `).all(employeeCode);

    return res.json({
      ok: true,
      employee_code: employeeCode,
      candidate_count: candidates.length,
      candidates,
    });
  } catch (err) {
    console.error('[record-history/resolve] error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
