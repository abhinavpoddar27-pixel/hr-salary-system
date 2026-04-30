// ============================================================
// TEMPORARY: Sales Sunday-rule leniency update (2 → 3)
// Added: 2026-04-30
// Removal commit: must follow within same PR/session
// Hardcoded scope — does not accept value from request body.
// Affects only policy_config.sales_leniency. Plant uses a
// hardcoded constant in dayCalculation.js and is unaffected.
// ============================================================

const express = require('express');
const router = express.Router();
const { getDb } = require('../database/db');
const { requireAdmin } = require('../middleware/roles');

router.use(requireAdmin);

const KEY = 'sales_leniency';
const EXPECTED_OLD = '2';
const NEW_VALUE = '3';

// POST /api/admin/temp/update-sales-leniency
// No request body required. Hardcoded transition: '2' → '3'.
router.post('/temp/update-sales-leniency', (req, res) => {
  const db = getDb();
  const username = req.user?.username || 'unknown';

  try {
    // Pre-check: read current value. Refuse to run if missing or already changed.
    const current = db.prepare(
      'SELECT value, updated_at FROM policy_config WHERE key = ?'
    ).get(KEY);

    if (!current) {
      return res.status(400).json({
        success: false,
        error: `policy_config.${KEY} not found. Refusing to run — seed required first.`,
      });
    }
    if (current.value !== EXPECTED_OLD) {
      return res.status(400).json({
        success: false,
        error: `policy_config.${KEY} is '${current.value}', expected '${EXPECTED_OLD}'. Refusing to run — current state diverges from documented baseline.`,
        current_value: current.value,
        expected_old: EXPECTED_OLD,
      });
    }

    // Audit entry #1: read marker (operation started, before write).
    const readAudit = db.prepare(`
      INSERT INTO audit_log
        (table_name, record_id, field_name, old_value, new_value, changed_by, stage, remark, action_type)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'policy_config', 0, KEY,
      current.value, current.value,
      username, 'policy_change',
      `Pre-change snapshot of policy_config.${KEY} before leniency 2→3 update.`,
      'policy_read'
    );

    // Transactional update + audit write #2.
    const txn = db.transaction(() => {
      const result = db.prepare(`
        UPDATE policy_config
           SET value = ?, updated_at = datetime('now')
         WHERE key = ?
      `).run(NEW_VALUE, KEY);

      if (result.changes !== 1) {
        throw new Error(`UPDATE affected ${result.changes} rows, expected exactly 1. ABORTING.`);
      }

      const writeAudit = db.prepare(`
        INSERT INTO audit_log
          (table_name, record_id, field_name, old_value, new_value, changed_by, stage, remark, action_type)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        'policy_config', 0, KEY,
        EXPECTED_OLD, NEW_VALUE,
        username, 'policy_change',
        `Sales Sunday-rule leniency raised from ${EXPECTED_OLD} to ${NEW_VALUE} via /api/admin/temp/update-sales-leniency. Plant unaffected (hardcoded constant in dayCalculation.js:47).`,
        'policy_change'
      );

      return writeAudit.lastInsertRowid;
    });

    const writeAuditId = txn();

    // Post-verify.
    const after = db.prepare('SELECT value, updated_at FROM policy_config WHERE key = ?').get(KEY);

    return res.json({
      success: true,
      key: KEY,
      old_value: EXPECTED_OLD,
      new_value: NEW_VALUE,
      verified_value: after?.value || null,
      updated_at: after?.updated_at || null,
      audit_log_ids: [readAudit.lastInsertRowid, writeAuditId],
    });
  } catch (err) {
    console.error('[admin/update-sales-leniency]', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
