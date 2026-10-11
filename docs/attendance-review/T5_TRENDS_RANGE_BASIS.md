# T5 — Trends: 18-month range, rules version per month, basis switch (plan G3 + G4)

Branch `feat/attendance-review-trends-basis` on origin/main fa43014. Read only — no engine maths changed, no new tables.

## What
- **G3 range:** `TREND_MAX` 12 → 18 (`/trends`, `/trends/export.xlsx`, `/person/:code`). UI range 3 / 6 / 12 / 18 months.
- **G4 rules version:** every Trends row carries `rules: { version, effective_from, from }`:
  stored run → `result.configSource` (`from: 'run'`); older run without it → the saved config version (effective ≤ that month)
  whose merged config equals the run's `config_snapshot` (`from: 'snapshot'`; built-in defaults → version null); no match →
  `rules: null` (unknown). Live month → `loadConfig(...).source` (`from: 'live'`, null source = built-in defaults).
  Screen: per-month label "v7 · master shift" in the source line + table column. Excel `Months` sheet: "Rules version" column.
- **G4 basis switch:** `basis=master|import` on `/trends` and `/trends/export.xlsx`. Absent / '' = today (stored runs win).
  Present = every month computed live with `assessment_basis` forced, stored runs ignored, no overrides; rows `source: 'live'`,
  `what_if: true`; response `what_if: { basis }`. Invalid → 400. UI "Measured on: As saved | Master shift | Import shift" +
  amber what-if line. Excel name gets `_what-if-<basis>`, From column "what-if (live)", audit remark says what-if.

## Progress
- [x] route: TREND_MAX 18, basis param, rules per row, export
- [x] service trendRow `rules`; workbook column
- [x] jest `attendanceReviewTrendsBasis.test.js` 11 (all 11 fail on fa43014's route/service/exports)
- [x] UI: range 18, rules label, basis control + what-if line; api.js two lines (commit 7b78efd)
- [x] full jest before (fa43014: 107 suites / 1669, 1 failing = statutoryWriters T9b, date-dependent, pre-existing)
- [ ] full jest after
- [ ] browser check `attendance-review-trends-basis-check.py` + re-run trends + trends-more checks
- [x] 18-month timing (~300 people)
- [ ] self-debug, user simulation, v2

## Results
- 18-month timing, scratch DB, 300 synthetic people × 18 months × 24 days (129,600 rows), every month live:
  as saved (import basis) 12.6 s; `basis=import` 9.5 s; `basis=master` 61.6 s (~3.4 s a month — the master-basis SQL).

## Fragile
- `storedRunRules` matches an old run's snapshot to a saved version by content (sorted-key JSON of the merged config).
  A version saved later with identical content to an earlier one returns the newest such version ≤ that month.

## Session note (for CLAUDE.md, folded in by the planner)
T5 Trends: range up to 18 months; each month carries the rules version it was made with (`rules`); `basis=master|import`
gives a what-if view computed live on that basis (never the saved review).

## Resume
Read this file + `git log --oneline fa43014..`; continue at the first unticked line.
