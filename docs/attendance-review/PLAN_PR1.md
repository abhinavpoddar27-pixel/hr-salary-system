# PR-1 Phase 0 plan — Attendance Review engine (PLAN ONLY, awaiting "go")

Branch `feat/attendance-review-engine` (from `docs/attendance-review-handoff`, base origin/main a5aec9a).
Owner decisions 10 Oct 2026: D1 approved (4 PRs, 2 tables) · D2 Option 2 + per-run overrides · D3 `docx` on backend (PR-3) ·
D4 Kuldeep loading workers excluded like Manpreet's · D5 early-exit rule configurable, default warning-only.
Repo is public: no employee codes, names or money in source, tests, seeds or commits. Codes live only in DB config rows.

## 1. D2 — selection rule (derived from Sep 2026 data, owner-approved "Option 2")
One early-exit definition everywhere: `is_early_departure=1 AND 15 < early_by_minutes < 600`, Mon–Sat, release days excluded.
Workdays lost = (counted late min + early-exit min) ÷ (shift hours × 60).
Selected (after exclusions) = late-regular ∪ early-regular ∪ double:
- late-regular: counted lates ≥ 8, worked ≥ 10, not improved.
- early-regular: early exits ≥ 8, worked ≥ 10, workdays lost ≥ 0.9, not improved.
- double: counted lates ≥ 4 AND early exits ≥ 4 AND workdays lost ≥ 0.9.
- not improved = this month > 0.6 × last month (improved = fell 40%+). Newcomer (no last-month row or < 5 worked days) is never "improved".
Action: newcomer → warning; else deduction = max(0.5, nearest 0.5 of workdays lost). Early-exit-only people with ≥ 3 exits not selected → early-exit warning.
Per-run overrides: admin include / exclude / force-warning a code with a mandatory reason, stored on the run, shown in the report.
Why: the prose rule ("this ≥ last") does not reproduce what was issued; this rule does (see private derivation doc). All numbers are config.
Expected Sep 2026 under this rule (acceptance): 17 people, 14 deductions, 12.5 days (fixture minus one person whose 4th early
exit fell on a release day — recorded as a known difference); notices = fixture (late 51, early 38); early-exit warnings 32 (fixture 31 + that person).

## 2. Service — `backend/src/services/attendanceReviewService.js` (new, pure, read-only)
`computeAttendanceReview(db, { month, year, config, releaseDays, overrides }) → result`
Steps, one exported function each (unit-tested separately):
1. `detectReleaseDays(db, ym, cfg)` — RUNBOOK query A; returns candidates; caller passes the confirmed list.
2. `detectShiftIssues(db, ym)` — query B (master shift ≠ shift used, or ≥80% days late/early); listed every month (L4).
3. `loadPersonMonth(db, ym, cfg, releaseDays)` — query C for this and last month in one pass; LAG window starts 7 days
   before last month; stayed-late = prev worked day OR prev calendar day `is_left_late=1` (mode in config); loading by
   designation pattern (config); readings ≥ 600 dropped; ½P counts 0.5 in scheduled minutes.
4. `applyExclusions(rows, cfg)` — excluded codes / departments (everything), early-exit-excluded codes (wrong shift),
   held codes (listed, no action), re-measure map `{code: {start, end, grace_late, grace_early}}` recomputed from
   `in_time_final/out_time_final` for BOTH months.
5. `classify(rows, cfg)` — late-regular / early-regular / double / newcomer per §1.
6. `actions(rows, cfg, overrides)` — action list, early-exit warnings, Option C days (computed always, applied only if
   `cfg.early_exit_rule = 'option_c'`), indicative ₹ = gross ÷ days in month × days (admin view only).
7. `notices(rows, cfg)` — late ≥ 4 counted lates; early ≥ 3 exits; codes + counts only.
8. `trend(db, …)` — company vs contract late % / early % monthly + weekly (Mon–Sat), habitual 10+, department time lost.
9. `payrollChecks(db, prevMonth)` — query D flags (double approved rows; rejected but applied; day-calc AND salary); `short_leaves` count.
Returns `{meta, criteria, releaseDaysDetected, shiftIssues, trend, departments, people, doubleDefaulters, regular,
earlyExits, actionList, earlyExitWarnings, held, noticeLate, noticeEarly, payrollChecks, gatePassCount, overridesApplied}`.
No writes to any payroll table. All SQL parameterised; months as 'YYYY-MM'.

## 3. Tables (schema.js — two additive CREATE TABLE blocks at the end of initSchema, nothing else)
```sql
CREATE TABLE IF NOT EXISTS attendance_review_config (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  effective_from TEXT NOT NULL,            -- 'YYYY-MM'
  config_json TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS attendance_review_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  month INTEGER NOT NULL, year INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','final')),
  config_snapshot TEXT NOT NULL, release_days TEXT NOT NULL DEFAULT '[]', overrides TEXT NOT NULL DEFAULT '[]',
  result_json TEXT NOT NULL,
  generated_by TEXT NOT NULL, generated_at TEXT DEFAULT (datetime('now')),
  finalised_by TEXT, finalised_at TEXT,
  UNIQUE(month, year)
);
```
No seed rows. Threshold defaults live in the service (`DEFAULT_CONFIG`, numbers only); the config row stores overrides
and every code/department list, entered by the admin. Config is versioned by `effective_from` (latest ≤ run month wins).

## 4. Endpoints — new `backend/src/routes/attendanceReview.js`
Mounted in `server.js` one line ABOVE line 199: `app.use('/api/analytics/attendance-review', requireAuth, requireAdmin, …)`
— `routes/analytics.js` is not touched. Every route admin-only (403 otherwise):
`GET /?month&year` preview (nothing saved) · `GET /config` · `PUT /config` (validates shape; `logAudit` row) ·
`POST /runs` {month, year, releaseDays[], overrides[]} create or regenerate a DRAFT (409 if final) ·
`GET /runs` · `GET /runs/:id` · `PUT /runs/:id/finalise` (locks).

## 5. Tests — `backend/src/__tests__/attendanceReview*.test.js` (jest, real initSchema via existing helpers, synthetic codes)
Each rule: grace 9/10 min; stayed-late on previous worked day and on previous calendar day (and Sunday gap); loading
exempt from lates only; reading ≥ 600 dropped; early 15/16 and 599/600 bounds; Sunday early ignored; release day
excluded; ½P worked-day + half scheduled minutes; miss punch excluded; newcomer (no row / 4 days) → warning; improved at
exactly 60% vs 61%; double at 0.89 vs 0.90 workdays; rounding 0.24→0.5, 0.74→0.5, 0.75→1.0; excluded dept/code absent
from every list; wrong-shift code absent from early lists only; re-measure applied to both months; overrides
include/exclude/warn with reason; option_c only when switched on. API: non-admin 403 on every route; final run 409 on
regenerate; preview writes nothing (row counts before = after); config PUT writes one audit_log row.
Acceptance (not in jest): `backend/scripts/attendance-review-acceptance.js <snapshot.db> <fixture.json>` — runs 2026-09,
diffs against the private fixture with the documented Option-2 difference; fixture path is an argument, never committed.

## 6. Files
New: `services/attendanceReviewService.js`, `routes/attendanceReview.js`, `__tests__/attendanceReview.test.js`,
`__tests__/attendanceReviewApi.test.js`, `scripts/attendance-review-acceptance.js`.
Changed: `server.js` (+2 lines: require + mount), `database/schema.js` (+2 CREATE TABLE blocks only),
`docs/attendance-review/PROGRESS.md`, `CLAUDE.md` (Last Session).
DO NOT MODIFY: salaryComputation.js, dayCalculation.js, payroll.js, lateComing.js, early-exits.js,
early-exit-deductions.js, short-leaves.js, routes/analytics.js, services/analytics.js, any frontend file (PR-2).

## 7. Risks
- R1 Shift hours: `shifts.duration_hours` by `shift_detected` name; NULL → 12 fallback (as in the hand run) — flagged in result.
- R2 Release days are detected, never auto-applied: the run stores the confirmed list.
- R3 Prod snapshot needed for acceptance — the check runs here against a copy, never the live DB.
- R4 Re-measure parses `HH:MM` punch strings; night shifts excluded from re-measure.
- R5 Performance: one month ≈ 300 people × 60 days; single pass, expected < 1 s.

## 8. Verification at the end of PR-1
jest full suite (baseline before vs after, no new failures); acceptance script vs fixture; salary drift
`SELECT COUNT(*) FROM salary_computations WHERE ABS(net_salary-(gross_earned-total_deductions))>1` unchanged (baseline 1, Feb 2026);
`git rev-parse HEAD == git rev-parse origin/feat/attendance-review-engine`.
