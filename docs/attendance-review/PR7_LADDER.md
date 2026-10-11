# PR-7 — escalation ladder + person history

Branch `feat/attendance-review-ladder`. Owner rulings D-10 (warning → deduction → deduction + HR hearing) and
"count August and September too" (history from Aug 2026; repeat offenders start October at step 2 or 3).

## Rule (config `ladder_rule`, default off — switched on in a rules version)
- A **strike month** = the person is on that month's action list or early-exit section (any action). Months come from
  the stored run (final, else draft), else computed live with that month's rules (no ladder, no overrides).
- **Step** for month M = strike months among the last `ladder_window_months` (3) months up to M, counting only months
  from `ladder_from` (2026-08).
- Step 1: a deduction becomes a **warning** (first month in 3). Step 2: deduction as computed. Step ≥ 3: deduction +
  **HR hearing** flag (note says so). An admin override on the person wins over the ladder. Newcomers stay warnings.
- Every listed person carries `ladder { step, months[], hearing?, downgraded_days? }`.

## Person history
`GET /api/analytics/attendance-review/person/:code?from=YYYY-MM&to=YYYY-MM` (admin): per month late days, early exits,
action, days, ladder step, source (final / draft / live); board appearances (board print records); finance rows sent by
review runs and their status. UI: click a code in the action list → history window.

## Progress
- [ ] engine: config keys, strike history, applyLadder, totals
- [ ] person history API
- [ ] tests
- [ ] UI: Step column + hearing badge, rules editor tick, person history window, Word note hearing line
- [ ] browser check + older scripts
- [ ] PR

## Resume
Read this file + `git log --oneline origin/main..`; continue at the first unticked line.
