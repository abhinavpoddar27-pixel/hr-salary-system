# T5 — Trends: 18-month range, rules version per month, basis switch (plan G3 + G4)

Branch `feat/attendance-review-trends-basis` (rebased on origin/main ee0c276a after UI/UX batch 3). Read only — no engine maths changed, no new tables.

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
- [x] full jest after (ee0c276a base): 110 suites / 1975 tests, 1 failing = statutoryWriters T9b (date-dependent, fixed by open PR #140, not this branch). Old trends test updated on purpose: 19 months now refused (was 13).
- [x] browser check `attendance-review-trends-basis-check.py` 32/32; re-run trends 31/31, trends-more 26/26, ladder 22/22, master-basis 26/26
- [x] 18-month timing (~300 people)
- [x] self-debug + user simulation → v2: the 18-month what-if on the master basis took ~62 s (over the 60 s axios timeout, and better-sqlite3 blocks the whole app meanwhile). Fixed by materializing the m1 / m3 / m5 steps of MASTER_BASE: one month 3.2 s → 0.86 s (300 people), all five master SQLs byte-identical (new jest test compares against the plain chain).

## Results
- 18-month timing, scratch DB, 300 synthetic people × 18 months × 24 days (129,600 rows), every month live:
  as saved (import basis) 12.6 s; `basis=import` 9.5 s; `basis=master` 61.6 s (~3.4 s a month — the master-basis SQL).

## Perf (v2)
- `MASTER_BASE` steps m1, m3, m5 are `AS MATERIALIZED` (SQLite ≥ 3.35; bundled 3.45.3). Without it SQLite flattens the CTE chain and
  repeats each derived CASE expression wherever a later step uses it. 300 people × 1 month: PM SQL 1.65 s → 0.37 s, weekly 1.2 s → 0.17 s.
- INFERENCE: an 18-month what-if on the master basis ≈ 15 s for ~300 people (was ~62 s).

## Fragile
- Do not remove `MATERIALIZED` from MASTER_BASE without re-timing; the identity test only proves equal results, not speed.
- `storedRunRules` matches an old run's snapshot to a saved version by content (sorted-key JSON of the merged config).
  A version saved later with identical content to an earlier one returns the newest such version ≤ that month.

## Session note (for CLAUDE.md, folded in by the planner)
T5 Trends: range up to 18 months; each month carries the rules version it was made with (`rules`); `basis=master|import`
gives a what-if view computed live on that basis (never the saved review).

## Resume
Read this file + `git log --oneline fa43014..`; continue at the first unticked line.
