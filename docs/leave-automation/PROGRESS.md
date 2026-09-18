# LEAVE AUTOMATION — PROGRESS

## PHASE STATUS
- P0 ANALYSE + BUILD_PLAN — DONE (2ce9945)
- P1 SCHEMA — DONE
- P2 LEAVE ENGINE — not started
- P3 SHARED STAGE 6 — not started
- P4 TRIGGERS / AUTO STAGE 6 — not started
- P5 API — not started
- P6 SL REMOVAL + CL 7 — not started
- P7 UI — not started
- P8 SELF-DEBUG + SIM + V2 — not started
- P9 SHIP — not started

## FILES TOUCHED
- backend/src/database/schema.js (P1: +3 tables, +3 cols, +8 policy keys, 1 guarded migration)
- backend/src/config/schemaReference.js (P1: leave tables + leave columns)

## DECISIONS
- D1 (manual-vs-finance discriminator): only 4 writers of `leave_transactions` exist —
  phase5Features:421 ('Year-End Lapse'), leaves.js:397 /adjust, leaves.js:517 /bulk-adjust,
  financeAudit.js:622 apply-leave. Manual adjustments = `transaction_type IN ('Credit','Debit')`
  MINUS the finance shape. Finance rows are identified by correlating (employee, leave_type,
  reference_month, reference_year) against the count of `attendance_processed` rows with
  `correction_source='leave_correction'` and matching `status_final`; that many Debit/days=1 rows
  are consumed as finance rows and returned in `unresolved_finance_rows`. Chosen over
  `approved_by='admin'` (leaves.js hardcodes it; a real admin user would collide).
- D2: `cl_per_year`/`el_per_year`/`sl_per_year` exist ONLY in Settings.jsx POLICY_GROUPS (:318-320),
  never in schema.js and read by nothing. They are removed from the UI in Phase 7 rather than migrated.
- D3: `el_eligibility_days` was already seeded idempotently at schema.js:1617; the Phase-1 block
  re-asserts it with INSERT OR IGNORE (no-op) so the full key set lives in one place.
- D0: Branch is `feat/leave-automation` off origin/main (3806a6d) per the prompt's explicit instruction,
  which overrides the harness default branch.

## OPEN ITEMS
- OI-1 (pre-existing, not introduced here): schema.js boot 1 != boot 2 because
  `migration_miss_punch_finance_queue_v1` only stamps on the second boot. Verified identical on
  origin/main via git stash. Boot 2 == boot 3, so it stabilises. Fix belongs to that migration block.
- OI-2: `sl_per_year` does not exist in policy_config, so the Phase-1 migration's delete is a no-op.

## TEST RESULTS
- Baseline (origin/main): 157 pass / 3 fail (tdsCalculation.test.js — pre-existing).
- After P1: 157 pass / 3 fail (same 3). Schema verify script: 20/20 assertions pass, idempotent.

## NEXT
Phase 2 — backend/src/services/leaveEngine.js.
