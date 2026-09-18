# Leave automation — open items

Things this build did not close, each with what it would take.

## Pre-existing, not introduced here

**OI-1 — `initSchema` is not idempotent on the very first boot.**
Boot 1 and boot 2 of a fresh database differ by one `policy_config` row:
`migration_miss_punch_finance_queue_v1` only stamps on the second boot. Reproduced
identically on a clean `origin/main` worktree, so it predates this work. Boot 2 and
boot 3 are identical, so it settles.
*Needs:* the guard block at `schema.js:934-945` to stamp on the same boot it runs, or
to run after the column it depends on is added.

**OI-2 — `protectedWrite.test.js` fails 3 of its 28 tests on roughly one run in three.**
Under jest's parallel workers, not alone. Reproduced on a clean `origin/main` worktree
(3-fail and 6-fail runs alternating). Only the 3 `tdsCalculation` failures are the
stable documented baseline.
*Needs:* whatever shared state those three tests race on — likely a module-level
singleton — isolated per test.

**OI-3 — the TDS suite is red.** 3 failures, documented in CLAUDE.md §12 as a real
payroll-accuracy concern that pre-dates Wave 2. Untouched here.

## Introduced by the rulings, deliberately

**OI-4 — CL and EL both lapse on 31 December, with no carry-forward and no encashment.**
The owner accepted this after being warned it likely conflicts with the OSH Code's
treatment of earned leave. Recorded here so it is not mistaken for an oversight.
*Needs:* a legal read, and if it changes, `runYearEndLapse` in `leaveEngine.js` plus
the year-boundary cron.

**OI-5 — a CL opening HR set by hand is never overwritten.**
`applyLeavePlan` updates `accrued`, `used` and `balance` but never `opening`, so an
employee seeded with the old 12-day CL keeps 12 until someone changes it. The preview's
Notes column says when the stored opening disagrees with the entitlement for that DOJ.
*Needs:* an owner decision on whether to bulk-correct those openings, and a one-time
script if so.

**OI-6 — `sl_per_year` was never in `policy_config`.**
Defect (l) assumed `cl_per_year` / `el_per_year` / `sl_per_year` were seeded keys. They
existed only in the Settings UI list and were read by nothing. The Phase 1 migration's
delete is therefore a no-op, and the three were removed from Settings.

## Smaller, and safe to leave

**OI-7 — historical leave edits made on the Day Calculation screen are not converted.**
Per ruling 10, September's leaves get re-entered through Leave Management. Rows written
by the old finance apply-leave path are detected and excluded from the adjustment
total, and reported as `unresolved_finance_rows` in the preview, but they are not
turned into leave applications.
*Needs:* a migration that reads `attendance_processed` rows with
`correction_source = 'leave_correction'` and creates a matching approved application
for each — only worth doing if the owner wants the old corrections to survive a Stage 6
re-run.

**OI-8 — the leave engine walks every eligible employee on every run.**
About 300 employees × 12 months × 2 leave types. Fine at this size; the whole
simulation runs in under a second. If the business doubles, `computeLeavePlan` should
take a month floor rather than always starting at January.

**OI-9 — `queueLeaveRecalc` merges by company-month, not by employee.**
Two changes to different employees in the same company-month inside the debounce
window become one job covering both. That is the point, but it means the job's
`reasons` array can list several unrelated causes.

**OI-10 — the Automation tab's Balances columns need admin.**
`GET /leave-recompute/preview` is admin-only, so for an HR user the Earned / Used
(outside) / Adjustments / Days worked columns read "—". The balance itself, which
comes from `leave_balances`, still shows.
*Needs:* either widening the preview endpoint to HR, or a slimmer HR-visible summary.
