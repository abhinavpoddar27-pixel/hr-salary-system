# Leave is charged only for what it pays (Sep 2026 onward) — PROGRESS

**Branch:** `fix/half-day-leave` · **Owner ruling:** 12 Oct 2026 (build list item 4).
**Trigger:** an EL entered for a weekly off + a half day paid ₹0 and still took 1 EL day.

## Rule (`dayCalculation.js`, protected, owner-approved; `LEAVE_CHARGED_AS_PAID_FROM = 2026*12+9`)
EL / paid CL on:
- an absent working day → pays the day, counts 1 (unchanged)
- a half day (½P / HP) → pays the absent half, counts 0.5 (was: pays 0, counts 1)
- a day already worked → pays nothing, counts 0 (was: counts 1)
LWP on a worked or half day no longer deducts a day (was: −1). LWP on an absent day unchanged.
The count is what `el_used` / `cl_used` store; the leave engine debits the balance from it.
Half-day leave also counts toward the weekly off (0.5). Months before Sep 2026 unchanged.

## Production, Sep 2026 (read-only)
- 1 EL on a half day (1 person): +0.5 day pay, EL charged 0.5 instead of 1.
- 2 EL on days already worked (2 people): pay unchanged, EL charged 0 instead of 1.
- No LWP in September.

## Verified
- New `halfDayLeave.test.js` 11 (7 fail on the old code). `clPayable.test.js`: CL on a worked day now counts 0 (intended).
- jest 116 suites / 2051, all pass. cl-payable sim 9/9, leave-automation sim 70/70, switchover sim all pass.

## Not tested
- Railway; production data through the screens.

## Owner steps after merge
Run Stage 6 (All companies) then Stage 7 for September. The leave balances follow at the next 03:30 IST leave sweep
(or Leave Management → Automation → recompute).

## CLAUDE.md entry
**Leave charged only for what it pays (fix/half-day-leave).** From Sep 2026 (`LEAVE_CHARGED_AS_PAID_FROM`): EL / paid CL on
an absent day = 1, on a ½P/HP day = 0.5 (absent half paid), on a worked day = 0; LWP never cuts a worked day. `el_used` /
`cl_used` store the paid count, so the leave engine debits only that. Half-day leave counts 0.5 toward the weekly off.
Fragile: `halfDates` is built next to `absentDates`; any new half-day status must be added in both places.
Found, not fixed: leaveEngine "days worked" = days_present + 0.5 × days_half_present, but days_half_present already
holds 0.5 per ½P day — a half day counts 0.25 toward EL accrual (needs its own ruling).
