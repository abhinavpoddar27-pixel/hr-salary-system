# PR-9 — person drill-down: every day of the month (plan item G10)

Branch `feat/attendance-review-person-days` (stacked on PR-8 `feat/attendance-review-plant-late-days` #144 — merge #144 first; base main 92ff32fd). Read only — no table written, no schema change, no
protected file.

## What
- Service `personMonthDays(db, code, month, year, { releaseDays, prevReleaseDays, config })` → `{ code, name, month, year,
  basis, rule_version, release_days, person, days[], totals, engine, consistent }`. One entry per calendar day: status, in /
  out (final), `times_from` machine | gate_register | missing, shift used (name, start–end, hours, mode) or
  `not_assessed_reason`, late / early minutes as measured, `late` / `early` = `counted` | `excused:<reason>` | `none`, notes.
- Inputs: the month's stored run (final, else draft) → its config snapshot + confirmed release days; else rules in force +
  detected release days (as Trends). Previous month's release days = its run's.
- Route `GET /api/analytics/attendance-review/person/:code/days?month&year` (admin; 400 bad month / code; 404 no attendance).
- UI: person history window → each month row has an expand control → day table (scrolls in its own box).

## Reused SQL vs JS
- **Reused SQL:** the engine's own `IMPORT_BASE` / `MASTER_BASE` + the `PERSON_MONTH_TAIL` CTE chain (pl → w → x → y → z)
  up to its aggregate SELECT, sliced off at runtime (`DAY_TAIL_CUT`) and joined per day. So isl / exc / fhl / lng / exl /
  ise / short are the engine's own expressions (stayed late, full hours, D-6, release day, Sunday, misread, MP-2 dates
  taken out, gate pass, out not verified, half day, not-assessed modes).
- **Reused JS:** missedOutPlan, loadPersonMonth, remeasureRows, buildPeople, applyExclusions, applyMissedOut — person-level
  steps (left out, loader, early-exempt / contract loader, shift-fit on/off, MP-2 counts) come from the engine itself.
- **Re-implemented in JS:** `remeasureDays` (per-day copy of `remeasureRows` for one code). Keep both in step.
- Per-day verdict labels (which excuse) are a reading of the engine's flags; the counted set is the engine's.

## Progress
- [x] service personMonthDays + personMonthInputs (exported first)
- [x] route
- [x] jest (invariant on both bases, every excuse kind, 400/404/403, nothing written) — 17
- [x] api.js + UI
- [x] PR-8 ticks followed (late_free_days from the run; verdict `excused:plant_late_day`; re-measure too)
- [x] browser check 31/31 + older scripts
- [x] self-debug / user simulation / v2

## Results
- jest `attendanceReviewPersonDays.test.js` 17 (invariant for every person under 4 rule sets × both bases, every excuse
  kind named, PR-8 tick, stored-run vs live inputs, null with no attendance, API 400/404/403/401, nothing written,
  history route not shadowed). Full suite (on top of PR-8) 111 suites / 1999 tests, all green.
- Browser `attendance-review-person-days-check.py` 31/31 (31 day rows = API, totals = month row, release-day reason,
  live September on the master basis, re-measured day, no-master / night / 404 / 400 / hr 403, phone 390, nothing written).
  Re-run: ladder 22, tab 49, plant-late-days 29.
- v2 (planner review, 12 Oct): (1) made the drill-down follow PR-8's ticked plant-wide late days — without it, after both
  PRs merge the day list would show a ticked day's late as counted while the review excused it (invariant broken).
  (2) Phone: the day table sat inside the months table's own scroll box (two nested sideways scrolls; 555 px wide on a
  390 px screen). Opened months now render BELOW the months table ("Every day — Oct 2026"), each in its own scroll box.

## Fragile
- `DAY_TAIL_CUT` slices `PERSON_MONTH_TAIL` at `\nSELECT c AS code, ym, COUNT(*)` — if that SELECT line changes, the
  function throws (loud, not wrong).
- `remeasureDays` mirrors `remeasureRows` by hand (incl. the PR-8 plant-day excuse) — change both.
- One request runs the plant-wide month SQL and filters to the person (≈ 1 s on the master basis for ~300 people; ≈ 0.4 s once #143's MATERIALIZED change is in).

## Session note (for CLAUDE.md, folded in by the planner)
PR-9 (G10) person day drill-down: `GET /person/:code/days?month&year` → `personMonthDays` (engine SQL reused per day;
only re-measure re-implemented in JS as `remeasureDays`); inputs = the month's stored run (config snapshot, release days,
plant-wide late days) else rules in force + detected release days; `consistent` = counted days/minutes equal the engine.
UI: person history → expand a month → every day below the months table.

## Resume
Read this file + `git log --oneline fa43014..`; continue at the first unticked line.
