# PR-2b — contractor late / early-exit deductions reach worker pay

Branch `feat/contractor-deductions-reach-pay` (on main c0d03075). Owner ruling D-3 (10 Oct 2026): contractor worker pay
is calculated in this app, so a finance-approved late-coming or early-exit deduction for a contractor is taken from the
worker's pay the same way as for company staff. Owner-approved change to the protected `salaryComputation.js`.

## Change (salaryComputation.js, the two deduction blocks only)
- The `!isContract` gate on `late_coming_deductions` and `early_exit_deductions` is replaced by
  `chargeLateEarly = !isContract || payroll month >= CONTRACTOR_LATE_EARLY_FROM (Sep 2026)`.
- Rate unchanged: late = approved days × gross ÷ calendar days (the contractor's own day rate — their base pay is
  payable ÷ calendar days × gross); early = the stored rupee amount.
- OT, ED and holiday-duty gating for contractors untouched. Reset/apply flags and audit unchanged.
- Why a start month: older months may hold an approved contractor row that was never charged (it was skipped); a
  re-run of an already-paid month must not start charging it now.
- UI: the Send-to-finance note for contractors now says their deductions reach pay.

## Progress
- [x] code
- [x] jest: new `contractorDeductionsReachPay.test.js` 7 (3 fail on main); `lwfPlant` P3 updated on purpose (contractor late row now 500); full suite 101 / 1581
- [x] simulation `backend/scripts/contractor-deductions-simulation.js` (60 people × Aug–Oct 2026, main vs branch):
  10 of 180 rows differ — all contractor rows from Sep 2026 with an approved late / early row, only in the deduction,
  total, net, payable and take-home fields, net down by exactly the deduction; 0 staff rows and 0 pre-Sep rows move;
  drift 0. `loans-stage7-simulation --dump` and `loans-sales-simulation --dump` byte-identical main vs branch.
- [x] independent review (money PR): SHIP. Types safe (recomputeSalary parseInts month/year), applied flags safe,
  loan headroom already counts late/early, no other reader assumes contractors carry none. Follow-ups taken: tests for an
  `is_contractor` flag with a Permanent type (staff), Jan 2027, August early row not flagged (suite now 8).
  Left as is (existing rule): when the deductions cap fires the late/early columns keep the full amount while the total
  is capped — likelier for short-attendance contractors. Review label "contractor" in the Attendance Review uses
  `is_contractor OR employment_type='Contract'`, payroll uses `isContractorForPayroll` — money identical from Sep 2026.
- [x] browser: send-to-finance check 28/28 with the new contractor note
- [x] PR

## Before the next September Stage 7 re-run (owner / finance)
Approved contractor rows for September will be taken on the re-run. If the plant September bank transfer already went
out, agree first whether they move to October. (The plant bank file writes no audit row, so the app can't tell.)

## Session note (for CLAUDE.md, folded in by the planner)
PR-2b: finance-approved late / early deductions are taken from contractor pay from Sep 2026 payroll
(`CONTRACTOR_LATE_EARLY_FROM` in salaryComputation.js; OT / ED / holiday duty still contractor-free).

## Resume
Read this file + `git log --oneline origin/main..`; continue at the first unticked line.
