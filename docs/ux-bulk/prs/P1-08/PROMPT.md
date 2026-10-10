# P1-08 — Stage 5 grid not refreshed after a correction is saved
Base: origin/main 2d96842 · Branch: fix/stage5-grid-refresh · Worktree: /home/claude/wt-p1-08
Master plan: §6 P1-08 · Finding P-4

## Diagnostics already done by the planner
- Code: `pages/AttendanceRegister.jsx` updateMutation (~L303–310) onSuccess only calls refetchSummary(); the per-employee
  grid query key is `['attendance-register', month, year, employee_code]` (L130) and is never invalidated, so the saved
  status shows only after a reload. pbaMutation (~L325) already invalidates the right key — copy that pattern.
- Production: 76 Stage 5 record edits in 90 days.

## Phase 0 — plan only
Clean tree; read updateMutation, recalcMutation, the grid query and how the edited record maps to an employee code.
PLAN.md + PROGRESS.md, commit, push, STOP.

## Scope (smallest change)
- updateMutation onSuccess also invalidates `['attendance-register', month, year]` (prefix → every open employee grid).
  Consider the same for recalcMutation only if it also changes grid cells (say so in PLAN). No other change.

## Targets
frontend/src/pages/AttendanceRegister.jsx → updateMutation (+ recalcMutation if justified).

## Verify
- Browser check `backend/scripts/stage5-grid-refresh-check.py`: open an employee grid, change a day's status, save →
  the cell shows the new status without reload (and the server 5 s GET cache does not serve the old copy — if it does,
  the fix needs `no-cache` on that read; report it); 0 errors. `--base`: cell stays stale.

## RESUME (re-read after any compaction)
- Progress: docs/ux-bulk/prs/P1-08/PROGRESS.md — update + commit + push after EVERY small step. Never redo a ticked step.
- Owner gave a programme-level "go" on 10 Oct 2026 ("run through so we finish"). The PLANNER approves your Phase 0:
  finish Phase 0 (PLAN.md + PROGRESS.md committed + pushed), then STOP and report. The planner replies "go" or corrections.

## DO NOT MODIFY
Global (MASTER_PLAN §10.4): salaryComputation.js, dayCalculation.js, schema.js, payroll.js, recompute.js, Stage 7 register
(SalaryComputation.jsx .salreg/COLS/pins), ED finance-review flow, loans engine. Plus everything outside Targets.

## Build rules
- One finding = this PR only. Repo is PUBLIC: fictional test data only, no real names/codes/money anywhere.
- Work ONLY in your worktree. backend/node_modules + frontend/node_modules are symlinks to the main repo (do not commit them).
- Frontend edit → `npm run build --prefix frontend`; commit frontend/dist in its own commit.
- Browser checks: PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers, scratch DB, real logins, built dist, port 3108 only.
  Pattern: backend/scripts/salary-register-report-check.py. Prove the bug once with `--base` on a main build.
- jest full suite before and after (record suites/tests).
- Self-debug pass + user-simulation pass (happy path + ≥1 edge) before hand-off.

## Hand-off
CLAUDE.md "Last Session" entry at the top (house style: branch, bug, fix, fragile, verified, not tested, found-not-fixed).
Commit messages end with the session attribution lines. Push; verify HEAD == origin/<branch>. Do NOT open/merge a PR.
Report: built / caught / tested (counts) / not tested (why) / final SHA / new findings.
