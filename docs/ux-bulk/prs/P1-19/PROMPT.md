# P1-19 — Sales Mark Left always uses today's date
Base: origin/main 868f5389 · Branch: fix/sales-mark-left-date · Worktree: /home/claude/wt-p1-19 · Port: 3119
Master plan: docs/ux-bulk/MASTER_PLAN.md §6 + §9 row for P1-19 (on branch docs/ux-bulk-progress-10oct — read with: git -C /home/claude/wt-docs show HEAD:docs/ux-bulk/MASTER_PLAN.md)

## Finding S-3 (High)
Sales → Employee Master → Mark Left (`pages/Sales/SalesEmployeeMaster.jsx` ~L659, L811–816) always sends today's date.
## Scope
A required "Leaving date" field in the Mark Left dialog (default empty; not in the future; not before DOJ if DOJ known),
sent to the existing sales mark-left route. Read `routes/sales.js` mark-left to use its existing body key (it may already
accept a date). Backend change only if the route ignores any date — then ask at Phase 0.
## Targets
frontend/src/pages/Sales/SalesEmployeeMaster.jsx.
## Verify
Playwright (hr): pick a past date → DB stores that date; empty / future → button disabled with a hint; Cancel sends
nothing; 390px; 0 errors. `--base`: today's date stored regardless.


## RESUME (re-read after any compaction)
- Progress: docs/ux-bulk/prs/P1-19/PROGRESS.md — update + commit + push after EVERY small step. Never redo a ticked step.
- Owner gave a programme-level "go" on 10 Oct 2026 ("run through so we finish"). The PLANNER approves your Phase 0:
  finish Phase 0 (PLAN.md + PROGRESS.md committed + pushed), then STOP and report. The planner replies "go" or corrections.

## DO NOT MODIFY
Global (MASTER_PLAN §10.4): salaryComputation.js, dayCalculation.js, schema.js, payroll.js, recompute.js, Stage 7 register
(SalaryComputation.jsx .salreg/COLS/pins), ED finance-review flow, loans engine. Plus everything outside Targets.

## Build rules
- One finding = this PR only. Repo is PUBLIC: fictional test data only, no real names/codes/money anywhere.
- Work ONLY in your worktree. backend/node_modules + frontend/node_modules are symlinks to the main repo (do not commit them).
- Frontend edit → `npm run build --prefix frontend`; commit frontend/dist in its own commit.
- Browser checks: PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers, scratch DB, real logins, built dist, port 3119 only.
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
