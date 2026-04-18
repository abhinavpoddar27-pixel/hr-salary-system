-- ═══════════════════════════════════════════════════════════════════
-- Backfill: dw_entries rows whose last approval action is 'rejected'
-- but whose current status is still 'hr_entered' (pre-fix bounce-back).
--
-- Context: before 2026-04-18, finance reject flipped entries back to
-- 'hr_entered' instead of terminal 'rejected'. Those rows now block new
-- HR entries for the same contractor+date+time-window via the duplicate
-- check in validateEntryRow().
--
-- Design decision: run DIAGNOSTIC first, eyeball the sample, then
-- uncomment and run the UPDATE under a transaction.
--
-- DO NOT run this script as part of a deploy. It is a one-off backfill.
-- ═══════════════════════════════════════════════════════════════════


-- ── Step 1: COUNT rows that will be affected ────────────────────────
SELECT COUNT(*) AS rows_to_backfill
FROM dw_entries e
WHERE e.status = 'hr_entered'
  AND (
    SELECT a.action FROM dw_approvals a
    WHERE a.entry_id = e.id
    ORDER BY a.acted_at DESC, a.id DESC LIMIT 1
  ) = 'rejected';


-- ── Step 2: SAMPLE 10 rows (visual inspection) ──────────────────────
SELECT
  e.id,
  e.contractor_id,
  c.contractor_name,
  e.entry_date,
  e.in_time,
  e.out_time,
  e.total_worker_count,
  e.total_liability,
  e.status AS current_status,
  (SELECT a.action FROM dw_approvals a WHERE a.entry_id = e.id
   ORDER BY a.acted_at DESC, a.id DESC LIMIT 1) AS last_action,
  (SELECT a.acted_at FROM dw_approvals a WHERE a.entry_id = e.id
   ORDER BY a.acted_at DESC, a.id DESC LIMIT 1) AS last_acted_at,
  (SELECT a.remarks FROM dw_approvals a WHERE a.entry_id = e.id
   ORDER BY a.acted_at DESC, a.id DESC LIMIT 1) AS last_remarks
FROM dw_entries e
JOIN dw_contractors c ON c.id = e.contractor_id
WHERE e.status = 'hr_entered'
  AND (
    SELECT a.action FROM dw_approvals a WHERE a.entry_id = e.id
    ORDER BY a.acted_at DESC, a.id DESC LIMIT 1
  ) = 'rejected'
ORDER BY e.id DESC
LIMIT 10;


-- ── Step 3: UPDATE (COMMENTED OUT. Do NOT run without manual review.)
--
-- Uncomment the block below only after reviewing Step 1 count and
-- Step 2 sample. Run inside a transaction so it can be rolled back.
--
-- BEGIN TRANSACTION;
--
-- UPDATE dw_entries
-- SET status = 'rejected', updated_at = datetime('now')
-- WHERE status = 'hr_entered'
--   AND (
--     SELECT a.action FROM dw_approvals a
--     WHERE a.entry_id = dw_entries.id
--     ORDER BY a.acted_at DESC, a.id DESC LIMIT 1
--   ) = 'rejected';
--
-- -- Post-update verification — must equal Step 1 count:
-- SELECT COUNT(*) AS backfilled FROM dw_entries WHERE status = 'rejected';
--
-- -- If count matches the Step 1 result, COMMIT. Otherwise ROLLBACK.
-- COMMIT;
-- -- ROLLBACK;  -- use if verification fails
