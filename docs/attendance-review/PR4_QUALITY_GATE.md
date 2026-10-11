# PR-4 — data-quality check before Finalise

Branch `feat/attendance-review-quality-gate` (on main 01c89070). Plan: private `PLAN_enforcement_v2.md` §PR-4.

## Why
11 Oct 2026: the September draft (rules v7, missed-OUT rule on) charged a night worker 6.5 days because his master
shift is a day shift and his unpaired nights were read as missed OUTs. Nothing stopped Finalise. The plan's guard for
"a wrong master is wrong everywhere" was this PR.

## What
`qualityGate(db, run, { now })` in the engine, read from the STORED draft + a few live reads. Three levels:
- **stop** — Finalise refused, cannot be acknowledged: `rules_changed` (rules in force differ from the draft's — regenerate).
- **check** — Finalise needs a typed reason (≥ 10 chars), recorded in audit_log (stage `ATTENDANCE_REVIEW_GATE`):
  `month_not_over`, `data_ends_early` (last attendance date > 3 days before month end), `shift_doubt` (a deduction for
  someone whose master shift looks wrong: master-fit suggestion / late or early on ≥ master_fit_share of worked days
  (≥ master_fit_min_days) / mostly night work with missed OUTs counted), `miss_punch_open` (worked miss-punch days not
  fixed, bulk days left out).
- **note** — shown only: not-assessed days of listed people, out-not-verified days, people with no master, master-fit
  suggestions with the proposed shift, bulk-failure days, half days.

API: `GET /runs/:id/quality`; `PUT /runs/:id/finalise` body `{ acknowledge }` → 409 `QUALITY_GATE` with the gate when
a stop exists or checks exist without a reason. No schema change. Protected files untouched.

UI: "Before you finalise" panel on a draft; Finalise opens a window listing the checks with a reason box.

## Progress
- [x] engine `qualityGate` + `nowDate`
- [x] routes
- [x] tests (new + existing finalise calls get an acknowledgement / clock)
- [ ] UI panel + finalise window
- [ ] browser check + existing scripts updated
- [ ] self-debug, user sim, PR

## Resume
Read this file, `git log --oneline origin/main..`, then continue at the first unticked line.
