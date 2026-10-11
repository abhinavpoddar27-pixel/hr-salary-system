# P1-21 — Reports: bulk payslips button always 403
Base: origin/main 868f5389 · Branch: fix/reports-bulk-payslips-403 · Worktree: /home/claude/wt-p1-21 · Port: 3121
Master plan: docs/ux-bulk/MASTER_PLAN.md §6 + §9 row for P1-21 (on branch docs/ux-bulk-progress-10oct — read with: git -C /home/claude/wt-docs show HEAD:docs/ux-bulk/MASTER_PLAN.md)

## Finding H-9 (Med)
Reports (`pages/Reports.jsx` ~L342, L1022): a "bulk payslips" button always gets a 403 (bulk payslips are disabled by
policy; `GET /payroll/payslips/bulk` returns 403 on purpose).
## Scope
Remove the button and its handler/import, or replace it with a plain "Bulk payslips are disabled by policy — download
individual payslips from Stage 7" note. Do not touch the server route or Stage 7.
## Targets
frontend/src/pages/Reports.jsx (+ remove a now-dead api.js helper only if nothing else imports it).
## Verify
Playwright (hr + finance): no request to /payslips/bulk from the page; note visible; 0 page/console errors, 0 API ≥ 400.
`--base`: click → 403.


## RESUME (re-read after any compaction)
- Progress: docs/ux-bulk/prs/P1-21/PROGRESS.md — update + commit + push after EVERY small step. Never redo a ticked step.
- Owner gave a programme-level "go" on 10 Oct 2026 ("run through so we finish"). The PLANNER approves your Phase 0:
  finish Phase 0 (PLAN.md + PROGRESS.md committed + pushed), then STOP and report. The planner replies "go" or corrections.

## DO NOT MODIFY
Global (MASTER_PLAN §10.4): salaryComputation.js, dayCalculation.js, schema.js, payroll.js, recompute.js, Stage 7 register
(SalaryComputation.jsx .salreg/COLS/pins), ED finance-review flow, loans engine. Plus everything outside Targets.

## Build rules
- One finding = this PR only. Repo is PUBLIC: fictional test data only, no real names/codes/money anywhere.
- Work ONLY in your worktree. backend/node_modules + frontend/node_modules are symlinks to the main repo (do not commit them).
- Frontend edit → `npm run build --prefix frontend`; commit frontend/dist in its own commit.
- Browser checks: PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers, scratch DB, real logins, built dist, port 3121 only.
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
