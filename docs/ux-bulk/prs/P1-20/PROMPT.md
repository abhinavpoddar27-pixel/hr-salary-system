# P1-20 — Leave form: Comp Off offered; end before start accepted
Base: origin/main 868f5389 · Branch: fix/leave-form-type-and-dates · Worktree: /home/claude/wt-p1-20 · Port: 3120
Master plan: docs/ux-bulk/MASTER_PLAN.md §6 + §9 row for P1-20 (on branch docs/ux-bulk-progress-10oct — read with: git -C /home/claude/wt-docs show HEAD:docs/ux-bulk/MASTER_PLAN.md)

## Finding H-7 (Med)
Leave Management → Apply Leave (`pages/LeaveManagement.jsx` ~L31, L75–80) offers "Comp Off", which the server refuses,
and accepts an end date before the start date (counted as 1 day).
## Scope
Remove Comp Off from the Apply Leave type list (comp-off has its own tab — leave that tab alone). End date ≥ start
date: submit disabled with a hint, and the day count shown never goes below 1 for a valid range. Server untouched
(check what types `POST /api/leaves` accepts and offer exactly those).
## Targets
frontend/src/pages/LeaveManagement.jsx (Apply Leave form only).
## Verify
Playwright (hr): no Comp Off option; end < start → disabled + hint; valid range submits; 0 errors. `--base`: Comp Off
offered → server error; end < start submits.


## RESUME (re-read after any compaction)
- Progress: docs/ux-bulk/prs/P1-20/PROGRESS.md — update + commit + push after EVERY small step. Never redo a ticked step.
- Owner gave a programme-level "go" on 10 Oct 2026 ("run through so we finish"). The PLANNER approves your Phase 0:
  finish Phase 0 (PLAN.md + PROGRESS.md committed + pushed), then STOP and report. The planner replies "go" or corrections.

## DO NOT MODIFY
Global (MASTER_PLAN §10.4): salaryComputation.js, dayCalculation.js, schema.js, payroll.js, recompute.js, Stage 7 register
(SalaryComputation.jsx .salreg/COLS/pins), ED finance-review flow, loans engine. Plus everything outside Targets.

## Build rules
- One finding = this PR only. Repo is PUBLIC: fictional test data only, no real names/codes/money anywhere.
- Work ONLY in your worktree. backend/node_modules + frontend/node_modules are symlinks to the main repo (do not commit them).
- Frontend edit → `npm run build --prefix frontend`; commit frontend/dist in its own commit.
- Browser checks: PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers, scratch DB, real logins, built dist, port 3120 only.
  Pattern: backend/scripts/salary-register-report-check.py. Prove the bug once with `--base` on a main build.
- jest full suite before and after (record suites/tests).
- Self-debug pass + user-simulation pass (happy path + ≥1 edge) before hand-off.

## Hand-off
CLAUDE.md "Last Session" entry at the top (house style: branch, bug, fix, fragile, verified, not tested, found-not-fixed).
Commit messages end with the session attribution lines. Push; verify HEAD == origin/<branch>. Do NOT open/merge a PR.
Report: built / caught / tested (counts) / not tested (why) / final SHA / new findings.
- Parallel builders share this machine: wrap EVERY frontend build as `flock /tmp/vite.lock npm run build --prefix frontend`
  and every FULL jest run as `flock /tmp/jest.lock npx jest` (single test files need no lock). Never `pkill` broadly —
  kill only PIDs you started. Use only your port.
