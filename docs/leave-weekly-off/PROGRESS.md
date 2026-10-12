# Paid leave keeps the weekly off + leftover salary rows removed — PROGRESS

**Branch:** `fix/leave-weekly-off-and-stale-salary-row` · **Owner ruling:** 12 Oct 2026 ("Yes fix them").

## Fix 1 — paid leave counts toward weekly-off eligibility (Sep 2026 onward)
- `dayCalculation.js` (protected, owner-approved): new `LEAVE_COUNTS_FOR_WEEKLY_OFF_FROM = 2026*12+9`.
  EL — and CL once paid — that covers an absent working day is added to `effectivePresent`.
  LWP never counts. SL is ignored. Leave on a day already worked adds nothing. Months before Sep 2026 unchanged.
- The old comment already said EL should push effectivePresent; the code never did.
- `clPayable.test.js`: two expectations raised by the restored weekly off (intended).
- Production estimate, Sep 2026 (read-only, upper bound — assumes every leave day sat on an absent day):
  16 permanent employees get 1–2 more weekly offs, 18 days, ≈ ₹18,000 gross. 23525 and 23698 each get 27 Sep back.

## Fix 2 — Stage 7 removes a leftover salary row when attendance is now zero
- `recompute.js` `recomputeSalary`: on the zero-attendance skip, an earlier salary row for that employee-month
  is deleted, its recovered advances are released, and an `audit_log` row is written
  (`action_type='stale_salary_row_removed'`). Kept and reported (`staleSalaryRows.kept`) when the row is
  finalised or carries a loan deduction. Return gains `staleSalaryRows {removed, kept}` (additive).
- Production case: 60348 Sep 2026 — Stage 6 0 days, salary row 1 day / ₹533.33 (held). Removed on the next Stage 7.

## Verified
- New `leaveWeeklyOffAndStaleRow.test.js` 13 (9 fail on the old code; 4 controls pass).
- jest 114 suites / 2034, all pass. cl-payable sim 9/9, leave-automation sim 70/70, switchover sim all pass.

## Not tested
- Railway; production data through the screens.

## Owner steps after merge
1. Bank file for September not sent → Stage 6 (All companies) then Stage 7 for September, then download the bank file.
   Already sent → pay the difference as arrears; do not regenerate the September file.
2. Check: `SELECT employee_code, paid_sundays, total_payable_days FROM day_calculations WHERE month=9 AND year=2026 AND employee_code IN ('23525','23698')` → paid_sundays 4, payable 28.
3. Check 60348 has no September salary row.
