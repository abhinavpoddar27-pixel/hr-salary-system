# CL payable from September 2026 — PROGRESS

**Branch:** `fix/cl-payable` · **Owner ruling:** 12 Oct 2026 — "change the rule and make CL payable".
**Trigger:** accounts (12 Oct) — 23525 and 23698: "EL CL amount not add".

## Rule
- From the **September 2026** payroll (`CL_PAID_FROM = 2026*12+9` in `dayCalculation.js`), an approved CL on an
  absent working day restores the payable day, exactly like EL.
- Months **before** September 2026 keep the old rule (CL relabels the absence, pay unchanged), so re-running a
  settled month never changes its pay. Production has CL in June 2025 (85 employees, 195.5 days) — untouched.
- LWP stays unpaid. SL stays abolished. Contractors are unaffected (their path ignores leave).
- CL on a day already worked, or on a Sunday/holiday, adds nothing (same as EL).

## What changed
- `backend/src/services/dayCalculation.js` only (protected file, owner-approved): CL branch, one constant, the
  integrity-check sum, comments. Salary computation, schema, routes, UI untouched.
- New `backend/src/__tests__/clPayable.test.js` (10 tests; 5 fail on the old code, 5 are controls).
- New `backend/scripts/cl-payable-simulation.js` — real Stage 6 + Stage 7 on a scratch DB.

## What it hits
- **Stage 6** `total_payable_days` rises by the CL days on absent days, for any month ≥ Sep 2026 that is re-run.
- **Stage 7** `gross_earned` / `net_salary` rise (gross ÷ days-in-month per CL day); ESI follows gross; PF
  follows basic+DA; loan 50% headroom grows; the "< 5 payable days" auto-hold fires less.
- **Leave automation**: the nightly sweep (03:30 IST) refreshes Stage 6 for the current + previous IST month
  (Sep + Oct, not finalised) — September day calculations will pick the rule up on their own and be marked
  "salary needs recompute". **Stage 7 stays a manual HR run.**
- **Not changed (decide separately):** CL/EL days still don't count toward weekly-off eligibility (both
  23525 and 23698 lost 27 Sep for that); CL still isn't counted as "days worked" for EL accrual.

## Production expectation (read-only, 12 Oct)
- September 2026: 18 employees, 40 CL days, ≈ ₹42,333 at their per-day rates (before PF/ESI effects).
- 23525: +3 days (₹4,200). 23698: +1 day (₹1,733.33).

## Verified
- jest 112 suites / 2011 → 113 / 2021, all pass.
- `node scripts/cl-payable-simulation.js` 9/9 (CL = EL pay, +3 days = ₹4,200 on ₹42,000, August unchanged,
  drift 0); same script on the old code 5/9 (the 4 CL-pay checks fail).
- `leave-automation-simulation.js` 70/70, `leave-switchover-simulation.js` all checks passed.

## Not tested
- Railway; production data through the screens.

## Owner steps after merge
1. Decide: September bank transfer already gone out? If **yes** → pay the CL difference as arrears in October
   (do NOT re-run September Stage 7 and regenerate the bank file). If **no** → run Stage 6 (All companies) and
   Stage 7 for September, then check the drift query.
2. Sanity after any re-run:
   `SELECT employee_code, total_payable_days, cl_used FROM day_calculations WHERE month=9 AND year=2026 AND cl_used>0`
