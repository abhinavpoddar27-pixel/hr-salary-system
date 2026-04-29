// ============================================================
// TEMPORARY: Mar 2026 Indriyan misattribution cleanup
// Added: 2026-04-29
// Removal commit: must follow within same PR/session
// Hardcoded scope — does not accept SQL from request body.
// ============================================================
//
// One-shot admin endpoint to delete misattributed Mar 2026 Indriyan
// sales data (5 tables, ~848 rows). Backups are retained as
// _backup_2026_04_28_sales_* tables. A rollback endpoint is provided
// for the same scope. SQL is fully hardcoded — no SQL parameter
// accepted from the request body.
//
// Both routes require admin auth via requireAdmin middleware.
//
// REMOVE THIS FILE AND ITS server.js MOUNT IN COMMIT 2.

const express = require('express');
const router = express.Router();
const { getDb } = require('../database/db');
const { requireAdmin } = require('../middleware/roles');

// All routes in this file are admin-only.
router.use(requireAdmin);

const COMPANY = 'Indriyan Beverages Pvt Ltd';
const MONTH = 3;
const YEAR = 2026;

// ── POST /api/admin/cleanup-mar-2026-indriyan ──────────────────
router.post('/cleanup-mar-2026-indriyan', (req, res) => {
  const db = getDb();
  const username = req.user?.username || 'unknown';

  try {
    // Pre-check: how many rows currently exist for the cleanup scope?
    const preChecks = {
      uploads: db.prepare(
        `SELECT COUNT(*) AS c FROM sales_uploads WHERE month=? AND year=? AND company=?`
      ).get(MONTH, YEAR, COMPANY).c,
      monthly_input: db.prepare(
        `SELECT COUNT(*) AS c FROM sales_monthly_input WHERE month=? AND year=? AND company=?`
      ).get(MONTH, YEAR, COMPANY).c,
      salary_computations: db.prepare(
        `SELECT COUNT(*) AS c FROM sales_salary_computations WHERE month=? AND year=? AND company=?`
      ).get(MONTH, YEAR, COMPANY).c,
      ta_da_computations: db.prepare(
        `SELECT COUNT(*) AS c FROM sales_ta_da_computations WHERE month=? AND year=? AND company=?`
      ).get(MONTH, YEAR, COMPANY).c,
      ta_da_monthly_inputs: db.prepare(
        `SELECT COUNT(*) AS c FROM sales_ta_da_monthly_inputs WHERE month=? AND year=? AND company=?`
      ).get(MONTH, YEAR, COMPANY).c,
    };

    // Sanity gate: refuse to run if counts deviate >10% from the
    // expected snapshot taken during diagnosis. Stops accidental
    // re-runs after data has been re-uploaded.
    const expected = {
      uploads: 2,
      monthly_input: 346,
      salary_computations: 164,
      ta_da_computations: 168,
      ta_da_monthly_inputs: 168,
    };
    const tolerancePct = 0.10;
    for (const [tbl, exp] of Object.entries(expected)) {
      const actual = preChecks[tbl];
      const diffPct = Math.abs(actual - exp) / exp;
      if (diffPct > tolerancePct) {
        return res.status(400).json({
          success: false,
          error: `Pre-check failed: ${tbl} has ${actual} rows, expected ~${exp} (±${tolerancePct * 100}%). Refusing to run.`,
          preChecks,
          expected,
        });
      }
    }

    // Snapshot backups (CREATE IF NOT EXISTS so re-runs don't clobber).
    db.exec(`
      CREATE TABLE IF NOT EXISTS _backup_2026_04_28_sales_uploads AS
        SELECT * FROM sales_uploads WHERE month=${MONTH} AND year=${YEAR} AND company='${COMPANY}';
      CREATE TABLE IF NOT EXISTS _backup_2026_04_28_sales_monthly_input AS
        SELECT * FROM sales_monthly_input WHERE month=${MONTH} AND year=${YEAR} AND company='${COMPANY}';
      CREATE TABLE IF NOT EXISTS _backup_2026_04_28_sales_salary_computations AS
        SELECT * FROM sales_salary_computations WHERE month=${MONTH} AND year=${YEAR} AND company='${COMPANY}';
      CREATE TABLE IF NOT EXISTS _backup_2026_04_28_sales_ta_da_computations AS
        SELECT * FROM sales_ta_da_computations WHERE month=${MONTH} AND year=${YEAR} AND company='${COMPANY}';
      CREATE TABLE IF NOT EXISTS _backup_2026_04_28_sales_ta_da_monthly_inputs AS
        SELECT * FROM sales_ta_da_monthly_inputs WHERE month=${MONTH} AND year=${YEAR} AND company='${COMPANY}';
    `);

    // Verify backup row counts match pre-check (defends against the
    // CREATE-IF-NOT-EXISTS race where a partial earlier snapshot is reused).
    const backupCounts = {
      uploads: db.prepare(`SELECT COUNT(*) AS c FROM _backup_2026_04_28_sales_uploads`).get().c,
      monthly_input: db.prepare(`SELECT COUNT(*) AS c FROM _backup_2026_04_28_sales_monthly_input`).get().c,
      salary_computations: db.prepare(`SELECT COUNT(*) AS c FROM _backup_2026_04_28_sales_salary_computations`).get().c,
      ta_da_computations: db.prepare(`SELECT COUNT(*) AS c FROM _backup_2026_04_28_sales_ta_da_computations`).get().c,
      ta_da_monthly_inputs: db.prepare(`SELECT COUNT(*) AS c FROM _backup_2026_04_28_sales_ta_da_monthly_inputs`).get().c,
    };
    for (const [tbl, exp] of Object.entries(preChecks)) {
      if (backupCounts[tbl] !== exp) {
        return res.status(500).json({
          success: false,
          error: `Backup count mismatch: ${tbl} pre-check=${exp}, backup=${backupCounts[tbl]}. ABORTING before DELETE.`,
          preChecks,
          backupCounts,
        });
      }
    }

    // Transactional DELETE in FK-safe order (children before parents).
    const deleteAll = db.transaction(() => {
      const r1 = db.prepare(
        `DELETE FROM sales_ta_da_computations WHERE month=? AND year=? AND company=?`
      ).run(MONTH, YEAR, COMPANY);
      const r2 = db.prepare(
        `DELETE FROM sales_ta_da_monthly_inputs WHERE month=? AND year=? AND company=?`
      ).run(MONTH, YEAR, COMPANY);
      const r3 = db.prepare(
        `DELETE FROM sales_salary_computations WHERE month=? AND year=? AND company=?`
      ).run(MONTH, YEAR, COMPANY);
      const r4 = db.prepare(
        `DELETE FROM sales_monthly_input WHERE month=? AND year=? AND company=?`
      ).run(MONTH, YEAR, COMPANY);
      const r5 = db.prepare(
        `DELETE FROM sales_uploads WHERE month=? AND year=? AND company=?`
      ).run(MONTH, YEAR, COMPANY);

      const deleted = {
        ta_da_computations: r1.changes,
        ta_da_monthly_inputs: r2.changes,
        salary_computations: r3.changes,
        monthly_input: r4.changes,
        uploads: r5.changes,
      };

      db.prepare(`
        INSERT INTO audit_log
          (table_name, record_id, field_name, old_value, new_value, changed_by, stage, remark)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        'sales_data_correction',
        0,
        'mar_2026_indriyan_delete',
        JSON.stringify(preChecks),
        JSON.stringify({ uploads: 0, monthly_input: 0, salary_computations: 0, ta_da_computations: 0, ta_da_monthly_inputs: 0 }),
        username,
        'production_correction',
        `Deleted Mar 2026 Indriyan rows via /admin/cleanup-mar-2026-indriyan endpoint. Misattribution from 2026-04-28 upload. Affected rows: ta_da_comp=${r1.changes}, ta_da_inputs=${r2.changes}, salary_comp=${r3.changes}, monthly_input=${r4.changes}, uploads=${r5.changes}. Backups: _backup_2026_04_28_sales_*. No NEFT exported.`
      );

      return deleted;
    });

    const deleted = deleteAll();

    // Post-verify: Mar 2026 Indriyan should now be empty across all 5 tables.
    const postChecks = {
      uploads: db.prepare(
        `SELECT COUNT(*) AS c FROM sales_uploads WHERE month=? AND year=? AND company=?`
      ).get(MONTH, YEAR, COMPANY).c,
      monthly_input: db.prepare(
        `SELECT COUNT(*) AS c FROM sales_monthly_input WHERE month=? AND year=? AND company=?`
      ).get(MONTH, YEAR, COMPANY).c,
      salary_computations: db.prepare(
        `SELECT COUNT(*) AS c FROM sales_salary_computations WHERE month=? AND year=? AND company=?`
      ).get(MONTH, YEAR, COMPANY).c,
      ta_da_computations: db.prepare(
        `SELECT COUNT(*) AS c FROM sales_ta_da_computations WHERE month=? AND year=? AND company=?`
      ).get(MONTH, YEAR, COMPANY).c,
      ta_da_monthly_inputs: db.prepare(
        `SELECT COUNT(*) AS c FROM sales_ta_da_monthly_inputs WHERE month=? AND year=? AND company=?`
      ).get(MONTH, YEAR, COMPANY).c,
    };

    return res.json({
      success: true,
      preChecks,
      deleted,
      postChecks,
      backupTables: [
        '_backup_2026_04_28_sales_uploads',
        '_backup_2026_04_28_sales_monthly_input',
        '_backup_2026_04_28_sales_salary_computations',
        '_backup_2026_04_28_sales_ta_da_computations',
        '_backup_2026_04_28_sales_ta_da_monthly_inputs',
      ],
      message: 'Cleanup complete. Endpoint should be removed in next commit.',
    });
  } catch (err) {
    console.error('cleanup-mar-2026-indriyan error:', err);
    return res.status(500).json({ success: false, error: err.message, stack: err.stack });
  }
});

// ── POST /api/admin/rollback-mar-2026-indriyan ─────────────────
router.post('/rollback-mar-2026-indriyan', (req, res) => {
  const db = getDb();
  const username = req.user?.username || 'unknown';

  try {
    // Verify backup tables exist before attempting restore.
    const backupExists = db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='_backup_2026_04_28_sales_uploads'`
    ).get();
    if (!backupExists) {
      return res.status(400).json({ success: false, error: 'Backup tables not found. Cannot rollback.' });
    }

    // Safety: refuse rollback if Mar 2026 Indriyan rows currently exist —
    // INSERT-from-backup would collide on PRIMARY KEY. Tells the operator
    // that the target scope is non-empty (likely re-uploaded after delete).
    const collisionCheck = db.prepare(
      `SELECT COUNT(*) AS c FROM sales_uploads WHERE month=? AND year=? AND company=?`
    ).get(MONTH, YEAR, COMPANY).c;
    if (collisionCheck > 0) {
      return res.status(400).json({
        success: false,
        error: `Mar 2026 Indriyan rows already exist (${collisionCheck} in sales_uploads). Rollback would collide with PRIMARY KEY. Manually clear current rows first if rollback is still wanted.`,
      });
    }

    const restoreAll = db.transaction(() => {
      // Restore parents before children for FK safety.
      const r1 = db.prepare(`INSERT INTO sales_uploads SELECT * FROM _backup_2026_04_28_sales_uploads`).run();
      const r2 = db.prepare(`INSERT INTO sales_monthly_input SELECT * FROM _backup_2026_04_28_sales_monthly_input`).run();
      const r3 = db.prepare(`INSERT INTO sales_salary_computations SELECT * FROM _backup_2026_04_28_sales_salary_computations`).run();
      const r4 = db.prepare(`INSERT INTO sales_ta_da_computations SELECT * FROM _backup_2026_04_28_sales_ta_da_computations`).run();
      const r5 = db.prepare(`INSERT INTO sales_ta_da_monthly_inputs SELECT * FROM _backup_2026_04_28_sales_ta_da_monthly_inputs`).run();

      const restored = {
        uploads: r1.changes,
        monthly_input: r2.changes,
        salary_computations: r3.changes,
        ta_da_computations: r4.changes,
        ta_da_monthly_inputs: r5.changes,
      };

      db.prepare(`
        INSERT INTO audit_log
          (table_name, record_id, field_name, old_value, new_value, changed_by, stage, remark)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        'sales_data_correction',
        0,
        'mar_2026_indriyan_rollback',
        '{"deleted":true}',
        '{"restored":true}',
        username,
        'production_correction',
        `Rolled back Mar 2026 Indriyan deletion. Restored from _backup_2026_04_28_sales_*. Rows: uploads=${r1.changes}, monthly=${r2.changes}, salary=${r3.changes}, tada_comp=${r4.changes}, tada_inputs=${r5.changes}.`
      );

      return restored;
    });

    const restored = restoreAll();
    return res.json({ success: true, restored, message: 'Rollback complete.' });
  } catch (err) {
    console.error('rollback-mar-2026-indriyan error:', err);
    return res.status(500).json({ success: false, error: err.message, stack: err.stack });
  }
});

// ============================================================
// END TEMPORARY CLEANUP ROUTES
// ============================================================

module.exports = router;
