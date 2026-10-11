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
- [ ] independent review (money PR)
- [ ] PR

## Resume
Read this file + `git log --oneline origin/main..`; continue at the first unticked line.
