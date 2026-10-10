# Claude Code prompt — Attendance Review PR-1, Phase 0 (PLAN ONLY)

```
TASK: Plan (do NOT write code) PR-1 "attendance review engine" for the HR Salary System.

READ FIRST: CLAUDE.md (Last Session), docs/attendance-review/{RUNBOOK,BUILD_PLAN,HANDOFF_attendance_review_10Oct2026,PROGRESS}.md,
backend/src/routes/analytics.js, backend/src/services/analytics.js (computePunctualityReport),
backend/src/middleware/roles.js, backend/server.js (analytics mount ~l.199), backend/src/database/schema.js (table style only).

PHASE 0 — PLAN GATE. Output a plan and STOP for approval. The plan must give:
1. Service API: computeAttendanceReview(db,{month,year,config,releaseDays}) — return shape, one function per RUNBOOK rule,
   each threshold read from config (nothing hard-coded, no employee codes in source).
2. SQL for each step (reuse RUNBOOK queries A–D), incl. stayed-late LAG window starting ~7 days before the month.
3. The deduction-list selection rule (HANDOFF L1) — propose it; it must reproduce the private fixture exactly.
4. Tables attendance_review_config + attendance_review_runs (exact DDL, idempotent, additive), with NO seeded codes.
5. Endpoints under /api/analytics/attendance-review, all requireAdmin; read-only on payroll tables.
6. Tests: jest fixture DB (synthetic codes) covering each rule + edge cases (newcomer, release day, ½P, loading, night misread,
   stayed-late on calendar vs worked day). Acceptance script that diffs 2026-09 on a prod snapshot vs the private fixture
   (fixture path passed as an argument, file never committed).
7. Risks and the exact file list.

DO NOT MODIFY: salaryComputation.js, dayCalculation.js, payroll.js, lateComing.js, early-exits.js,
early-exit-deductions.js, short-leaves.js, existing Analytics tabs. schema.js: only the two CREATE TABLE blocks, after approval.
RULES: feature branch feat/attendance-review-engine; never push to main; after push verify
git rev-parse HEAD == git rev-parse origin/<branch>. Repo is PUBLIC: no employee codes, names or money in commits.
Update docs/attendance-review/PROGRESS.md (RESUME block) at each checkpoint.
FINISH (after build, not now): run the salary drift query
SELECT COUNT(*) FROM salary_computations WHERE ABS(net_salary-(gross_earned-total_deductions))>1 — stop if > 1
(known baseline 1 row, 2/2026).
```
