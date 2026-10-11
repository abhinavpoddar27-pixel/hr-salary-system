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
- [x] UI panel + finalise window (`AttendanceReviewQuality.jsx`)
- [x] browser check + existing scripts updated
- [x] self-debug, user sim, PR

## Results (11 Oct 2026)
- jest 100 suites / 1574 (new `attendanceReviewQualityGate.test.js` 7; three older tests now finalise with a reason —
  the API test also asserts the 409 first).
- `backend/scripts/attendance-review-quality-gate-check.py` 33/33 (Chromium, built dist, admin + hr, G40xx, port 3996):
  2 checks shown, reason < 10 keeps the button off, Cancel = no PUT, rules saved after the draft = Must fix + Finalise
  disabled + direct PUT 409, regenerate clears, overnight master clears the night reason, fixed miss punch clears that
  check, double click = 1 PUT, reason in audit_log and on the final run, hr 403, phone 390, 0 page errors, payroll untouched.
- Re-run with the new finalise window: tab 49/49, send-to-finance 28/28, early-rules 33/33, trends 31/31 (API finalise
  now sends a reason), master-basis 26/26, suggestions 29/29, board 36/36.
- Live replay (read-only, Sep 2026 draft run 1, rules v7): 5 deductions flagged as a possible wrong master (11.5 of the
  17 days); no open miss punches; notes for other master-fit, no-master, out-not-verified, half days and bulk days.
  Names and codes are in the private project doc `claude/attendance-review/OWNER_STEPS.md`.

## Fragile
- `rules_changed` compares the draft's config snapshot string with the config in force now. A later PR that adds a
  default config key makes every open draft show "Must fix" until regenerated (intended: the numbers would change).
- The night check uses `is_night_shift` / "Night Shift" on worked rows and treats a master with end < start as overnight.
- Scripts that finalise through the UI use `finalise_ui()`; API callers must send `acknowledge` when checks exist.

## Session note (for CLAUDE.md, folded in by the planner)
PR-4 data-quality gate before Finalise. Engine `qualityGate` + `nowDate`; `GET /runs/:id/quality`; finalise takes
`{acknowledge}` (≥ 10 chars) past checks, refused on stops (409 QUALITY_GATE); reason in audit_log stage
ATTENDANCE_REVIEW_GATE. UI: "Before you finalise" panel + finalise window. No schema change, no protected file.

## Resume
Read this file, `git log --oneline origin/main..`, then continue at the first unticked line.
