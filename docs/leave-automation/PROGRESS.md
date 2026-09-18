# LEAVE AUTOMATION — PROGRESS

## PHASE STATUS
- P0 ANALYSE + BUILD_PLAN — DONE (2ce9945)
- P1 SCHEMA — DONE
- P2 LEAVE ENGINE — DONE (25/25 specs green)
- P3 SHARED STAGE 6 — DONE (parity proven, 6/6 specs green)
- P4 TRIGGERS / AUTO STAGE 6 — not started
- P5 API — not started
- P6 SL REMOVAL + CL 7 — not started
- P7 UI — not started
- P8 SELF-DEBUG + SIM + V2 — not started
- P9 SHIP — not started

## FILES TOUCHED
- backend/src/database/schema.js (P1: +3 tables, +3 cols, +8 policy keys, 1 guarded migration)
- backend/src/config/schemaReference.js (P1: leave tables + leave columns)
- backend/src/services/leaveEngine.js (P2: NEW — computeLeavePlan/applyLeavePlan/recomputeLeaves/
  runYearEndLapse/seedYearOpenings)
- backend/src/services/phase5Features.js (P2: runLeaveAccrual -> thin wrapper; computeClEntitlement
  gains a `base` param sourced from cl_entitlement_base)
- backend/src/__tests__/leaveEngine.test.js, src/__tests__/helpers/leaveFixture.js (P2: NEW)
- backend/src/services/recompute.js (P3: NEW — recomputeDays/recomputeSalary/countStaleSalary)
- backend/src/routes/payroll.js (P3: /calculate-days + /compute-salary now call the service; dead
  imports trimmed. This is the one sanctioned edit to payroll.js.)
- backend/src/services/jobQueue.js (P3: day_calculate + salary_compute call the service)
- backend/src/routes/import.js (P3: runReimportRecompute calls the service; dead imports trimmed)
- backend/src/__tests__/recomputeParity.test.js, src/__tests__/helpers/legacyStage6.js (P3: NEW)

## DECISIONS
- D8 (parity proof): `helpers/legacyStage6.js` is generated from `git show origin/main:.../payroll.js`
  lines 34-249 with only three edits (function wrapper, req.requestId -> 'legacy', two require paths
  rebased). The spec runs it and recompute.js against two copies of one seeded DB and asserts
  day_calculations matches on every column except salary_stale / leave_recomputed_at / updated_at.
- D9 (stage stamp scope): payroll.js has always stamped stage_6_done/stage_7_done by month+year only;
  import.js has always scoped by company. recomputeDays/recomputeSalary take `scopeStampToCompany`
  so each caller keeps its historic shape rather than silently changing one of them.
- D10 (canonical company names): salaryComputation.normalizeCompany only accepts
  'Asian Lakto Ind Ltd' / 'Indriyan Beverages Pvt Ltd'. Test fixtures use those exact strings.
- D4 (leave_balances.opening): applyLeavePlan updates accrued/used/balance only and never overwrites
  `opening`, so an opening HR set by hand survives. computeLeavePlan uses the stored opening when a row
  exists and the computed entitlement only when it does not; when the two differ it says so in
  `summary.reasons` so the owner sees it in the preview instead of the engine silently rewriting money.
- D5 (ledger horizon): the plan walks January -> min(current IST month, 12), extended to cover any month
  that actually carries data. Future months are never written.
- D6 (contractor test): `isContractorForPayroll` treats a non-empty `employment_type` as the source of
  truth, so 'Permanent' + stale `is_contractor=1` IS leave-eligible by design. The spec exercises the
  real skip paths (blank employment_type + is_contractor, and 'Contract'/'Contractual') instead.
- D7 (circular require): `phase5Features.runLeaveAccrual` requires `leaveEngine` lazily at call time so
  `leaveEngine` can import `computeClEntitlement` from it without a module-load cycle.
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
- After P2: 182 pass / 3 fail (same 3 TDS). leaveEngine.test.js 25/25.
- After P3: 188 pass / 3 fail (same 3 TDS). recomputeParity.test.js 6/6, including a field-for-field
  match against the origin/main orchestration and a proof that the legacy path hands back HR's late
  deduction on a re-run while the new path does not. Max salary drift in the spec: 0.

## NEXT
Phase 4 — backend/src/services/leaveTriggers.js + job types + call sites + scheduler.
