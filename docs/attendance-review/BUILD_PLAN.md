# Attendance Review — app build plan (PROPOSED, not yet approved)

Goal: the monthly late-coming / early-exit review that was produced by hand for September 2026
(see `RUNBOOK.md`) becomes a tab in **Analytics** that the **admin** generates once a month, with the
same rules and the same result. Acceptance = the app reproduces the private fixture `claude/attendance-review/sep2026_expected.json` (Claude Project, not in this public repo)
for September 2026 on a production snapshot.

Status of every item below: **proposal**. Abhinav must approve the PR split, the new tables and the
`docx` dependency before Claude Code writes code (Phase 0 plan gate).

## Where it lives (verified in the repo, origin/main a5aec9a)
- Page: `frontend/src/pages/Analytics.jsx` (1308 lines). Tabs are a `TABS` array (line ~103) +
  `<Route path=…>` (line ~1299): overview, absenteeism, punctuality, overtime, hours, early-exit.
  New tab: `{ id: 'attendance-review', label: 'Attendance Review', path: '/analytics/attendance-review' }`,
  shown to admin only.
- API: `backend/server.js:199` mounts `/api/analytics` (requireAuth) → `backend/src/routes/analytics.js`
  (951 lines; services in `backend/src/services/analytics.js`, e.g. `computePunctualityReport`).
  Admin guard: `requireAdmin` in `backend/src/middleware/roles.js`.
- Related existing routes (read only, do not change in PR-1..3): `routes/lateComing.js`
  (late_coming_deductions, finance review), `routes/early-exits.js` (early_exit_detections),
  `routes/early-exit-deductions.js`, `routes/short-leaves.js` (gate passes / short leave — table is empty).
- Libraries: backend has `xlsx` (SheetJS). **No `docx` package** — Word export needs a new dependency
  (decision D3) or a client-side build.
- DB: SQLite via better-sqlite3 (not PostgreSQL, despite the project description).

## Proposed PRs (one PR = one concern; deploy and verify each before the next)

**PR-1 `feat/attendance-review-engine` — backend compute + config, read-only**
- New `backend/src/services/attendanceReviewService.js`: `computeAttendanceReview(db, {month, year, config, releaseDays})`
  returns `{meta, criteria, trend:{monthly, weekly}, departments, people, doubleDefaulters,
  regularNotImproved:{late, early, improved}, earlyExits, releaseDaysDetected, shiftIssues,
  actionList, noticeLate, noticeEarly, payrollChecks, gatePassCount}` — every rule from RUNBOOK §1–2,
  each threshold read from `config`, none hard-coded.
- New tables (schema.js is FRAGILE — needs explicit approval):
  - `attendance_review_config` (id, effective_from, config_json, updated_by, updated_at) — exclusions,
    wrong-shift list, re-measure map, held codes, thresholds, rounding, early-exit rule mode.
    Seed = the 10 Oct 2026 rulings (RUNBOOK §1–2).
  - `attendance_review_runs` (id, month, year, status 'draft'|'final', config_snapshot, release_days,
    result_json, generated_by, generated_at, finalised_by, finalised_at, UNIQUE(month, year)).
    Draft can be regenerated; final is locked.
- Endpoints (all `requireAdmin`), under `/api/analytics/attendance-review`:
  `GET /?month&year` (preview, nothing saved) · `GET /config` · `PUT /config` (audit_log row) ·
  `POST /runs` (generate/regenerate draft; body `releaseDays[]`) · `GET /runs` · `GET /runs/:id` ·
  `PUT /runs/:id/finalise`.
- Tests: jest on a fixture DB + a script that runs the service for 2026-09 against a production
  snapshot and diffs against the private fixture (path passed as an argument).

**PR-2 `feat/attendance-review-tab` — frontend tab**
- Analytics → Attendance Review (admin only): month picker (reuse the page's); "Detected release days"
  checkboxes to confirm; Generate / Regenerate / Finalise; sections in the report order (summary,
  trend chart company late % / early % weekly, department table, double defaulters with priority,
  regular not improved, early exits, shift issues, payroll checks); read-only view of the rules with
  a link to edit config. `frontend/dist` rebuilt and committed.

**PR-3 `feat/attendance-review-exports` — downloads**
- `GET /runs/:id/export.xlsx` (SheetJS): Defaulters, By Department, Shift issues, All staff, Summary, Notes.
- `GET /runs/:id/export.docx`: action list (landscape), Late Coming notice, Leaving Early notice, one note
  per person (deduction / newcomer warning / early-exit warning). Port `reference/notes_builder.js`.
- Verify by rendering the docx to PDF and looking at each page type.

**PR-4 (later, gated) — write-back**
- Push approved deductions into `late_coming_deductions` as `finance_status='pending'` — ONLY after the
  day-calculation bug (applies HR late days without finance approval) is fixed and verified.
- Early-exit deductions (Option C) once Abhinav approves the rule. Gate-pass exemption once
  `short_leaves` is in use.

## Fragile files — DO NOT MODIFY in PR-1..3
`salaryComputation.js`, `dayCalculation.js`, `payroll.js`; `schema.js` only for the two CREATE TABLE
statements in PR-1, after explicit approval. Also untouched: `lateComing.js`, `early-exits.js`,
`early-exit-deductions.js`, `short-leaves.js`, the existing Analytics tabs.

## Decisions needed before PR-1
- D1 Approve the PR split and the two tables.
- D2 Selection rule for the deduction list (see HANDOFF "Landmines" L1) — codify it.
- D3 Word export: add `docx` to backend (recommended) or build the docx in the browser.
- D4 Kuldeep loading workers: exclude like Manpreet's, or assess early exits.
- D5 Early-exit rule from October: warning only, or Option C.
