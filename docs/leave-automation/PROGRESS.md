# LEAVE AUTOMATION — PROGRESS

## PHASE STATUS
- P0 ANALYSE + BUILD_PLAN — DONE (2ce9945)
- P1 SCHEMA — DONE
- P2 LEAVE ENGINE — DONE (25/25 specs green)
- P3 SHARED STAGE 6 — DONE (parity proven, 6/6 specs green)
- P4 TRIGGERS / AUTO STAGE 6 — DONE (19/19 specs green)
- P5 API — DONE (22/22 specs green)
- P6 SL REMOVAL + CL 7 — DONE (20/20 specs green)
- P7 UI — DONE (dist rebuilt and committed)
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
- backend/src/services/leaveTriggers.js (P4: NEW — queueLeaveRecalc/checkAutoStage6/flags/notify)
- backend/src/services/jobQueue.js (P4: leave_recalc + leave_nightly job types; ensureJobsTable export)
- backend/src/services/monthEndScheduler.js (P4: nightly sweep on the 09:00 IST cron; new 00:05 IST
  year-boundary cron)
- backend/src/routes/{leaves,attendance,compensatoryOff,employees,import,financeAudit}.js (P4: trigger
  call sites, all post-commit and all inside safeTrigger)
- backend/src/__tests__/leaveTriggers.test.js (P4: NEW)
- backend/src/routes/phase5.js (P5: shared role guards replace the local helper; every endpoint
  guarded; 11 new leave-automation endpoints)
- backend/src/routes/leaves.js (P5: router-level role gate — reads hr/finance/admin/viewer, writes hr/admin)
- backend/src/routes/financeAudit.js (P5: apply-leave rewritten — requireFinanceOrAdmin, creates an
  approved leave_application, hard-blocks a negative balance and a finalized month, no day_calculations
  hand-patch)
- backend/src/routes/employeePortal.js (P5: ORDER BY applied_at; leave-apply validation + employee_id)
- backend/src/__tests__/leaveApi.test.js, src/__tests__/helpers/apiHarness.js (P5: NEW)
- backend/src/services/dayCalculation.js (P6: SL leaves the day untouched; sl_used still written)
- backend/src/routes/employees.js (P6: both CL seeds use computeClEntitlement + cl_entitlement_base)
- backend/src/routes/leaves.js (P6: SL rejected on submit and on approve)
- backend/src/__tests__/slRemoval.test.js (P6: NEW)
- frontend/src/utils/api.js (P7: 16 leave-automation helpers)
- frontend/src/utils/formatters.js (P7: fmtIstTime / fmtIstDateTime)
- frontend/src/utils/abbreviations.js (P7: OD added, SL relabelled historical)
- frontend/src/components/leave/LeaveAutomationTab.jsx (P7: NEW)
- frontend/src/pages/LeaveManagement.jsx (P7: Automation tab, balances rebuild + ledger drill-down +
  CSV, approve/reject use the logged-in user + balance now→after, adjustments reason/negative gate,
  CompOffTab normalizeRole)
- frontend/src/pages/DayCalculation.jsx (P7: leave modal CL/EL/LWP + balance now→after + mandatory
  remark, OD column, stale dot, legend)
- frontend/src/pages/SalaryComputation.jsx (P7: stale banner + finalize gate + admin override modal)
- frontend/src/pages/EmployeeProfile.jsx (P7: SL tile out, days worked / EL earned in)
- frontend/src/pages/{MissPunch,Import,Settings,Reports,DailyMIS}.jsx,
  components/ui/CalendarView.jsx, components/layout/Sidebar.jsx (P7)
- backend/src/routes/payroll.js (P7: /finalise blocks on stale, admin override audited)
- backend/src/routes/reports.js (P7: leave-register monthly gains sl_used, days worked, EL earned,
  EL outside system)
- backend/src/services/employeeProfileService.js (P7: monthlyBreakdown finally carries the leave
  columns the profile's Leave tab already tried to read)
- frontend/dist/** (P7: rebuilt)

## DECISIONS
- D17 (finalize gate is server-side too): a UI-only block would be cosmetic, and the ruling asks for
  the override to be audited, which needs a server write. payroll.js /finalise now refuses while any
  day_calculations row for the month is salary_stale; an admin may override with a reason of 10+
  characters, which is written to audit_log. Second and last edit to payroll.js.
- D18 (profile leave columns): EmployeeProfile's Leave tab already read cl_used/el_used/payable_days
  off monthlyBreakdown, but the service never attached them, so every leave cell rendered zero.
  Fixed while adding Days worked / EL earned rather than building on a broken table.
- D19 (Settings keys removed): cl_per_year / el_per_year / sl_per_year existed only in the Settings
  POLICY_GROUPS list — never seeded, never read. Removed rather than left to mislead; the group is
  now "Leave Rules" and exposes the keys the engine actually reads.
- D16 (how SL is neutralised): deleting the SL branch outright would have made SL *restore* a payable
  day, because the shared code above the type switch already removes the date from daysAbsent. SL is
  therefore skipped before that block: the day stays exactly as the attendance file found it, and
  sl_used is still counted so historical rows render. Caught by the spec, not by reading.
- D14 (API test harness): no supertest in the repo, so `helpers/apiHarness.js` points DATA_DIR at a
  temp directory before database/db.js loads, mounts the routers on a bare express app with a stub
  auth middleware, and drives them over a real socket with node's own http client. No new dependency,
  and no path from a test to a real database.
- D15 (finance apply-leave + LWP): the rewrite accepts LWP as well as CL/EL. LWP moves no balance, so
  it is the honest answer when an employee has none left, instead of the old behaviour of writing the
  balance negative and warning to the console.
- D11 (debounce CAST): SQLite's strftime('%s', …) returns TEXT and every INTEGER sorts before every
  TEXT, so the first version of the debounce window compared TEXT >= INTEGER and was always true —
  the window was silently infinite. Both sides are now CAST to INTEGER. The zero-window spec is what
  caught it.
- D12 (notifications): leaveTriggers writes notifications through the db handle it was given rather
  than monthEndScheduler.createNotification, which reaches for getDb(). Same columns, same same-day
  dedupe, and it works under test.
- D13 (nightly sweep): the 09:00 IST cron queues a `leave_nightly` job rather than doing the work on
  the cron thread, so a long sweep cannot block the scheduler. One pending sweep at a time.
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
- OI-3 (pre-existing, not introduced here): `protectedWrite.test.js` fails 3 of its 28 tests on roughly
  one run in three, under jest's parallel workers. Reproduced identically on a clean origin/main
  worktree (3 fail / 6 fail alternating across 4 runs), so it is an ordering bug in that suite, not a
  regression. Only the 3 tdsCalculation failures are the documented-stable baseline.
- OI-2: `sl_per_year` does not exist in policy_config, so the Phase-1 migration's delete is a no-op.

## TEST RESULTS
- Baseline (origin/main): 157 pass / 3 fail (tdsCalculation.test.js — pre-existing).
- After P1: 157 pass / 3 fail (same 3). Schema verify script: 20/20 assertions pass, idempotent.
- After P2: 182 pass / 3 fail (same 3 TDS). leaveEngine.test.js 25/25.
- After P6: 249 pass / 3 fail (same 3 TDS). slRemoval.test.js 20/20.
- After P5: 229 pass / 3 fail (same 3 TDS). leaveApi.test.js 22/22.
- After P4: 207 pass / 3 fail (same 3 TDS). leaveTriggers.test.js 19/19.
- After P3: 188 pass / 3 fail (same 3 TDS). recomputeParity.test.js 6/6, including a field-for-field
  match against the origin/main orchestration and a proof that the legacy path hands back HR's late
  deduction on a re-run while the new path does not. Max salary drift in the spec: 0.

## NEXT
Phase 8 — self-debug pass, jest, end-to-end simulation, v2 rerun, docs.
