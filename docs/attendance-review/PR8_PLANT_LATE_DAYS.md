# PR-8 — plant-wide late days (detector + tick, like release days)

Branch `feat/attendance-review-plant-late-days` (from main fa43014). Plan item 7 ("systemic late days").
Real case: on one September day 22 people were late together in the 08:50s (a plant-wide cause — transport, gate, power).

## What
- **Detector** `detectPlantLateDays(db, month, year, cfg, to?)` on the review's basis: per Mon–Sat date, workers assessed
  that day (master: worked, no open miss punch, day mode, not a half day; import: P / WOP, no miss punch, not a night row),
  people left out of the review not counted, and people late by the engine's measure BEFORE excuses (late ≥
  `late_min_minutes`, < `misread_minutes`). Plant-wide when late ≥ `thresholds.plant_late_min_people` (15) AND
  late ÷ assessed ≥ `thresholds.plant_late_min_share` (0.25). Returns `{date, weekday, assessed, late_people, share,
  median_late_minutes}`.
- **Engine**: `computeAttendanceReview({ lateFreeDays = [], prevLateFreeDays = [] })`. Ticked days go to the person-month and
  weekly SQL (both bases) through `sqlParams` (`@lfd` / `@plfd`, same place release days go for early exits) and to the
  re-measure rows. A late on a ticked day is excused (`exl`), counted in `late_plant_excused`. Waterfall: new step
  `lates.plant_late_days` (identity measured − stayed late − full hours − loaders − plant-wide late days = counted). Result:
  `plantLateDays { detected, ticked, prev_ticked, lates_excused }`, `criteria.late_free_days`.
- **Routes**: preview `lateFreeDays=a,b` (dates in the month, else 400); `POST /runs { lateFreeDays }` saves to the new
  `late_free_days` column (omitted on regenerate keeps the draft's list, `[]` clears); `runSummary.late_free_days`; audit
  remark lists them; last month's saved list read like release days (`prevLateFreeDays`); `POST /suggestions` accepts it too.
- **Schema** (owner-approved, one line): `safeAddColumn('attendance_review_runs', 'late_free_days', "TEXT DEFAULT '[]'")`.
- **UI**: "Plant-wide late days" panel under release days / overrides: date, late / assessed, share, median minutes,
  UNTICKED checkbox; ticked days go into the preview and the saved draft; "draft matches the screen" includes them; a line
  says how many lates the ticks excuse; a final run lists them. Rules editor: the two thresholds (labels; the editor already
  carries `thresholds` whole in its form and save body).
- **Exports**: Excel Summary rows "Plant-wide late days ticked" + "Late arrivals not counted on those days" (only for
  results that know about plant-wide late days); Word pack: one sentence in the action-list method line and the notice footer.

## Owner rulings (11–12 Oct)
- Detected days start UNTICKED — nothing is forgiven without the admin ticking it.
- A ticked day = lates on that date are not counted for anyone; early exits on that date are unaffected.
- The tick is saved on the run (`late_free_days`, JSON list of YYYY-MM-DD), like release_days.

## Progress
- [x] schema line
- [x] engine: thresholds + validation, detector, SQL (both bases, weekly), re-measure, waterfall, result fields
- [x] routes: preview, POST /runs, runSummary, prev month, suggestions, audit remark
- [x] UI: panel, preview, generate, draft-matches-screen, final line, rules labels; api.js preview param
- [x] exports
- [x] jest `attendanceReviewPlantLateDays.test.js` (18; 17 fail on fa43014, the 1 that passes is the no-param control)
- [x] byte-identical check (5 configs, no ticks, base vs branch, new keys stripped): md5 equal
- [ ] browser check `backend/scripts/attendance-review-plant-late-days-check.py` + older scripts
- [ ] full jest before / after
- [ ] self-debug, user simulation, v2

## Results
- (filled in below as steps finish)

## Fragile
- Adding the two default thresholds changes `mergeConfig` output but NOT the stored config: `qualityGate`'s `rules_changed`
  compares the draft's snapshot (the STORED config, `loadConfig().config` = merged…) — see Results for whether open drafts
  show "Must fix".
- Weekly chart: the tab's weekly chart has no release-day marker, so ticked late days are not marked there either.
- Trends waterfall card (`AttendanceReviewTrendsMore.jsx`, not owned here) draws only the older late steps; the new
  `plant_late_days` step is in the data but not in that chart.
- Ladder / Trends / monthResult live computes use NO ticks for the month itself (a month without a run has none) and last
  month's saved ticks for the comparison — same as release days there.

## Session note (for CLAUDE.md, folded in by the planner)
PR-8 plant-wide late days. Config thresholds `plant_late_min_people` 15 / `plant_late_min_share` 0.25. Detector
`detectPlantLateDays`; ticks (`lateFreeDays`, default none, owner: never pre-ticked) excuse that date's lates for everyone,
early exits untouched; saved on the run in `attendance_review_runs.late_free_days` (schema: one safeAddColumn). Waterfall
step `plant_late_days`. Result `plantLateDays {detected, ticked, prev_ticked, lates_excused}`.

## Resume
Read this file + `git log --oneline fa43014..`; continue at the first unticked line.
