-- ============================================================================
-- April 2026 salary cleanup — Option C3 (delete-only, no company-tag rename)
--
-- File:    scripts/cleanup/april-2026-salary-dedup.sql
-- Branch:  claude/payroll-data-cleanup-qqybY
-- Drafted: Claude (2026-05-05)
-- Executes: Abhinav, via SQL Console UI (/preview → /commit), human-in-loop
-- Strategy: delete the 257 stale `''`-tagged salary_computations rows that have
--           a `'null'`/`'Default'` canonical counterpart, and the 429 stale
--           April-stamped day_calculations rows that have a May-stamped
--           canonical counterpart. NO company-tag renaming. Tag distribution
--           remains `''` / `'null'` / `'Default'` exactly as Feb/Mar 2026.
--
-- Pre-cleanup state (verified via MCP HR_SQL_Console, 2026-05-05 11:07-11:08):
--   salary_computations Apr 2026: 531 rows / 274 unique employees
--                                 drift_rows=0 / sum_net=4,008,802.34
--     ''       = 266   ('' rows: 246 with null pair + 11 with Default pair + 9 stale-only)
--     'null'   = 254   (246 with blank pair + 8 null-only)
--     'Default'= 11    (all 11 have a blank counterpart, none have a null counterpart)
--
--   day_calculations    Apr 2026: 876 rows
--     stale     (updated_at LIKE '2026-04-%', all blank-tagged) = 430
--     canonical (updated_at LIKE '2026-05-%', null + Default)  = 446
--     Pre-flight (will-delete) = 429 (≤ 500-row snapshot cap ✓)
--     Stale-only survivor = 1 row (employee_code 23569, TARUN SINGH THAKUR —
--       orphaned preview row in day_calculations only, no matching
--       salary_computations row, all-zero values; expected and harmless)
--     Canonical-only = 17 rows (May rows for employees with no April stale)
--
-- Validator confirmation (backend/src/routes/sqlConsole.js:378–460):
--   The DELETE...WHERE...IN (SELECT ...) shape used here is accepted by
--   /preview. Validator layer 6 only rejects literal JOIN inside UPDATE/DELETE
--   (`\bJOIN\b`); subqueries in IN clauses are legal. captureRowsBefore()
--   (line 685) extracts the WHERE clause via extractWhereClause() and pastes
--   it into a SELECT, which SQLite handles correctly with subqueries.
--
-- Caps (CLAUDE.md §9.1):
--   SNAPSHOT_ROW_CAP=500       (B.1=257 ✓, B.2=429 ✓)
--   WRITE_AFFECTED_ROW_CAP=1000 (both ✓)
--   TXN_TTL_MS=60_000          (single-statement, well within TTL)
--
-- NOTE: Each DELETE is its own /preview → /commit cycle (Phase 2 is single-
-- statement per preview). Both target protected tables, so each commit
-- writes a row to sql_console_write_snapshots automatically.
-- ============================================================================


-- ============================================================================
-- PHASE A — Backups (DDL — execute via direct DB shell OR SQL Console with
--                          X-SQL-Console-DDL-Token if SQL_CONSOLE_DDL_TOKEN set)
-- ============================================================================
-- These standalone backup tables are belt-and-braces alongside the SQL
-- Console snapshot rows. Re-execution is idempotent via IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS salary_computations_apr2026_backup AS
  SELECT * FROM salary_computations WHERE month=4 AND year=2026;
-- expect: 531 rows

CREATE TABLE IF NOT EXISTS day_calculations_apr2026_backup AS
  SELECT * FROM day_calculations    WHERE month=4 AND year=2026;
-- expect: 876 rows

-- Backup row-count sanity (read-only — run before proceeding to Phase B):
--   SELECT COUNT(*) FROM salary_computations_apr2026_backup;  -- expect 531
--   SELECT COUNT(*) FROM day_calculations_apr2026_backup;     -- expect 876
--   SELECT 'live',   ROUND(SUM(net_salary),2) FROM salary_computations WHERE month=4 AND year=2026
--   UNION ALL
--   SELECT 'backup', ROUND(SUM(net_salary),2) FROM salary_computations_apr2026_backup;
--   -- both must equal 4008802.34


-- ============================================================================
-- PRE-FLIGHT (read-only — confirms snapshot cap & matches locked C1/C2/C3)
-- ============================================================================

-- C1: Will-delete count from day_calculations (must be < 500 snapshot cap)
SELECT COUNT(*) AS will_delete_daycalc
FROM day_calculations
WHERE month=4 AND year=2026
  AND updated_at LIKE '2026-04-%'
  AND employee_code IN (
    SELECT employee_code FROM day_calculations
    WHERE month=4 AND year=2026
      AND updated_at LIKE '2026-05-%'
  );
-- expect: 429   (locked from 2026-05-05 pre-flight)

-- C2: Stale-only survivors in day_calculations (April-stamped, no May counterpart)
SELECT COUNT(*) AS stale_only_survives
FROM day_calculations
WHERE month=4 AND year=2026
  AND updated_at LIKE '2026-04-%'
  AND employee_code NOT IN (
    SELECT employee_code FROM day_calculations
    WHERE month=4 AND year=2026
      AND updated_at LIKE '2026-05-%'
  );
-- expect: 1   (employee 23569 TARUN SINGH THAKUR, all-zero orphan preview)

-- C3: Canonical-only rows (May-stamped, no April stale) — sanity, no action
SELECT COUNT(*) AS canonical_only
FROM day_calculations
WHERE month=4 AND year=2026
  AND updated_at LIKE '2026-05-%'
  AND employee_code NOT IN (
    SELECT employee_code FROM day_calculations
    WHERE month=4 AND year=2026
      AND updated_at LIKE '2026-04-%'
  );
-- expect: 17

-- Identity check:  C1 + C2 = 430 (= total stale)  AND  C1 ≤ 446 (= total canonical)


-- ============================================================================
-- PHASE B.1 — DELETE on salary_computations  (DML — SQL Console /preview → /commit)
--
-- Removes 257 stale blank-tagged April rows that have a 'null' or 'Default'
-- canonical counterpart for the same employee_code.
-- Survivors: 9 stale-only blank rows
--   ('10021','12004','12005','23587','23726','23732','60292','60293','60296')
-- Snapshot rows_before count: 257  (< 500 cap ✓)
-- ============================================================================

DELETE FROM salary_computations
WHERE month=4 AND year=2026
  AND company=''
  AND employee_code IN (
    SELECT employee_code
    FROM salary_computations
    WHERE month=4 AND year=2026
      AND company IN ('null','Default')
  );


-- ============================================================================
-- PHASE B.2 — DELETE on day_calculations  (DML — SQL Console /preview → /commit)
--
-- Removes 429 April-stamped (2026-04-14) blank-tagged rows where the same
-- employee_code has a May-stamped (2026-05-03) canonical row.
-- Survivor: 1 stale-only April row (employee 23569 TARUN, all-zero orphan).
-- Snapshot rows_before count: 429  (< 500 cap ✓)
-- ============================================================================

DELETE FROM day_calculations
WHERE month=4 AND year=2026
  AND updated_at LIKE '2026-04-%'
  AND employee_code IN (
    SELECT employee_code
    FROM day_calculations
    WHERE month=4 AND year=2026
      AND updated_at LIKE '2026-05-%'
  );


-- ============================================================================
-- POST-DELETE VERIFICATION (V1–V8) — read-only, run after both /commit calls
-- ============================================================================

-- V1: Row count = unique employees = 274
SELECT COUNT(*) AS row_count, COUNT(DISTINCT employee_code) AS unique_emps
FROM salary_computations WHERE month=4 AND year=2026;
-- expect: row_count=274, unique_emps=274

-- V2: No remaining duplicates
SELECT COUNT(*) AS dup_emps FROM (
  SELECT employee_code FROM salary_computations
  WHERE month=4 AND year=2026
  GROUP BY employee_code HAVING COUNT(*) > 1
);
-- expect: 0

-- V3: Tag distribution (C3 = no rename)
SELECT company, COUNT(*) AS n
FROM salary_computations WHERE month=4 AND year=2026
GROUP BY company ORDER BY n DESC;
-- expect: 'null'=254, 'Default'=11, ''=9

-- V4: Drift max ≤ ₹1.00, drift_rows = 0
SELECT MAX(ABS(net_salary - (gross_earned - total_deductions))) AS max_drift,
       SUM(CASE WHEN ABS(net_salary - (gross_earned - total_deductions)) > 1
                THEN 1 ELSE 0 END) AS drift_rows
FROM salary_computations WHERE month=4 AND year=2026;
-- expect: max_drift ≤ 1.0, drift_rows = 0

-- V5: 9 stale-only employees still present
SELECT COUNT(*) AS stale_only_present
FROM salary_computations
WHERE month=4 AND year=2026
  AND employee_code IN ('10021','12004','12005','23587','23726','23732','60292','60293','60296');
-- expect: 9

-- V6: Sum of net_salary
SELECT ROUND(SUM(net_salary),2) AS sum_net_apr
FROM salary_computations WHERE month=4 AND year=2026;
-- expect: ~3,138,000   (was 4,008,802.34 — drop ≈ 870,800 = sum of 257 stale rows)

-- V7: Per-row drift sanity (CLAUDE.md §8 mandate, top 20 by drift)
SELECT employee_code, company, net_salary, gross_earned, total_deductions,
       ROUND(ABS(net_salary - (gross_earned - total_deductions)), 2) AS drift
FROM salary_computations WHERE month=4 AND year=2026
ORDER BY drift DESC LIMIT 20;
-- expect: every row drift ≤ 1.0

-- V8: day_calculations post-state
SELECT
  COUNT(*) AS daycalc_rows_apr,
  COUNT(DISTINCT employee_code) AS unique_emps,
  SUM(CASE WHEN updated_at LIKE '2026-04-%' THEN 1 ELSE 0 END) AS still_stale,
  SUM(CASE WHEN updated_at LIKE '2026-05-%' THEN 1 ELSE 0 END) AS canonical
FROM day_calculations WHERE month=4 AND year=2026;
-- expect: daycalc_rows_apr=447, still_stale=1 (TARUN 23569), canonical=446


-- ============================================================================
-- ROLLBACK PATH (if any V check fails)
-- ============================================================================
-- The two commits are already on disk by the time V runs. To restore:
--
--   Option A — SQL Console snapshot restore (preferred; preserves audit trail):
--     POST /api/admin/sql/snapshot/<audit_id>/restore
--     for each of the two commits' audit rows. Then commit each restore txn.
--
--   Option B — Manual restore from Phase A backup tables:
--     -- (each statement is its own /preview cycle; both DELETE+INSERT pairs
--     --  exceed 500-row snapshot cap, so route via direct DB shell instead)
--     DELETE FROM salary_computations WHERE month=4 AND year=2026;
--     INSERT INTO salary_computations SELECT * FROM salary_computations_apr2026_backup;
--     DELETE FROM day_calculations    WHERE month=4 AND year=2026;
--     INSERT INTO day_calculations    SELECT * FROM day_calculations_apr2026_backup;
--
-- After successful V1–V8, the backup tables can be dropped after a 30-day
-- retention window (≈ 2026-06-05):
--   DROP TABLE salary_computations_apr2026_backup;
--   DROP TABLE day_calculations_apr2026_backup;
-- ============================================================================
