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
- [x] engine: config keys, strike history, applyLadder, totals
- [x] person history API
- [x] tests (`attendanceReviewLadder.test.js` 8)
- [x] UI: Ladder column + badges (both lists), rules editor tick + "count months from", person history window (click a code), Word notes (first-month warning wording, HR hearing paragraph), Excel Ladder column
- [x] browser check + older scripts
- [x] PR

## Results (11 Oct 2026)
- jest 101 suites / 1583 (new `attendanceReviewLadder.test.js` 9).
- `backend/scripts/attendance-review-ladder-check.py` 22/22 (Chromium, built dist, admin + hr, L70xx): ladder off → no
  column; tick in Rules → saved version ladder on from 2026-08; month-1 person a warning (rules' days shown), month-2 a
  deduction, month-3 a deduction + HR hearing badge; note counts; history window months 1/2/3; Word notes wording; finalise
  → "Send 2 to finance" (the warning is not sent) → rows; history shows the sent row; hr 403; phone; 0 errors.
- Re-run: tab 49, suggestions 29, master basis 26, early rules 33, send-to-finance 28, trends 31, quality gate 33, board 36.
- Live replay (read-only, Sep 2026 draft + Aug draft as history): if the ladder were on for September, 12 of the 28
  deductions (19 days) would be first-month warnings; 16 (17 days) stay; no hearings yet (only Aug + Sep count).

## Fragile
- Adding the ladder keys changes the default config, so every open draft shows PR-4's "rules changed" until regenerated.
- History months use whatever run is stored (final, else draft) — regenerating an earlier month's draft changes later
  months' steps. Finalise months in order.
- A live history month costs one engine run (≈ 0.3 s); Trends shares a cache so a 12-month range adds at most two.
- The editor rebuilds config from its form: `ladder_rule` / `ladder_from` are in both the form and the save body.

## Session note (for CLAUDE.md, folded in by the planner)
PR-7 escalation ladder (D-10) + person history. Config `ladder_rule` (off by default), `ladder_from` (2026-08),
thresholds `ladder_window_months` 3 / `ladder_deduction_from` 2 / `ladder_hearing_from` 3. Strike month = on the action
list or early section (any action) in the stored run (final/draft) or a live computation. `GET /person/:code`.

## Resume
Read this file + `git log --oneline origin/main..`; continue at the first unticked line.
