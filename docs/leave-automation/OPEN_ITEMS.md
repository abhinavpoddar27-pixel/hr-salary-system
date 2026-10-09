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

## Leave switchover 2026 (9 Oct 2026, branch `feat/leave-switchover-2026`)

Owner rulings, final (full text in `docs/leave-switchover-2026/PROMPT.md` §2):
- **R-A** 98 SILP/Worker employees (`permanent-codes.json`) become Permanent — only if Active and
  still typed as listed. `employment_type` only; `category` is left alone. Salary unaffected.
- **R-B** EL = 1 per **21** days worked, rounded down, nothing until **180** days worked in the year.
- **R-C** CL = **4** a year, pro-rated by joining **quarter** (Jan–Mar 4, Apr–Jun 3, Jul–Sep 2,
  Oct–Dec 1); mid-month joiners roll to the next month; a mid-December joiner gets 0.
- **R-D** CL taken outside the app counts as CL used, never as days worked. EL taken outside
  counts as days worked.
- **R-E** Outside-system leave is uploaded through the grants upload, which now takes an optional
  Leave Type (EL default, CL) and a Days column (`EL Days` still accepted). CL can only be
  "Leave taken". Duplicates within one sheet are per-row errors.
- **R-F** `leave_transactions` #1, #3, #2 (HR's hand accrual credits) are neutralised by
  offsetting Debit rows; the originals are never edited or deleted.
- **R-G** 2026 CL opening = new entitlement, EL opening = 0, on existing rows of Active Permanent
  employees; `used`/`balance` left to the engine; no rows created.
- **R-H** Negative balances stay visible; CL and EL still lapse 31 Dec; sales excluded.

**OI-11 — window between merge and switchover apply (accepted).**
After this branch is deployed and before the owner clicks Apply on the switchover card, the
CL formula is already quarterly but `cl_entitlement_base` is still 7 — so e.g. an October joiner
created in that window gets ceil(7×3/12) = 2 instead of the old 3 (and the new 1). The apply sets
the base to 4; the CL opening reset (R-G) then corrects every existing Active Permanent row.

**OI-12 — the retype can be undone by a bulk employee import.**
`routes/employees.js:954-958` derives `employment_type` from `category` on bulk import
(`category='SILP'` → `SILP`, `'Worker'` → `Worker`). The 98 keep their old category, so a later
bulk import of a sheet carrying that category would set them back. The switchover preview counts
them ("Category still SILP/Worker").
*Needs:* an owner decision — fix the category on those rows, or stop the bulk import from
overriding a non-empty `employment_type`.

**OI-13 — possible double count of August leave for 23725 and 23700.**
Their August leave is in the owner's outside-app sheet AND in `attendance_processed` as
`correction_source='leave_correction'` rows (the old finance apply-leave path). Today Stage 6
counts none of it (`el_used`/`cl_used` 0 for August) and `partitionTransactions` absorbs
txns #4–#11 as finance rows, so it is counted once — via the upload. If August Stage 6 is
re-run and counts those statuses, it would be counted twice. The switchover preview flags
every employee with both in the same month ("Possible double count…"); information only.
*Needs:* HR to confirm per employee before the leave recompute is applied.

**OI-14 — `backend/scripts/reseed-leave-balances-2026.js` left as is.**
It calls `computeClEntitlement` without a base, so its default moves from 7 to 4 with the new
quarterly formula. One-off script, not run by anything; leave it alone.

**OI-15 — a soft-deleted outside-system grant still blocks re-uploading the same row.**
Pre-existing: the duplicate check and the table's UNIQUE key both ignore `is_active`, so after
"delete" the same (code, year, month, type, how given) is still rejected as "Already recorded".
*Needs:* reactivate-on-upload or a hard delete; not changed here.

