# P1-15 — Finance Verification: flag reason + Approve gate
Base: origin/main 868f5389 · Branch: fix/finverify-flag-reason · Worktree: /home/claude/wt-p1-15 · Port: 3115
Master plan: docs/ux-bulk/MASTER_PLAN.md §6 + §9 row for P1-15 (on branch docs/ux-bulk-progress-10oct — read with: git -C /home/claude/wt-docs show HEAD:docs/ux-bulk/MASTER_PLAN.md)

## Finding F-12 (Med)
Finance Verification (`pages/FinanceVerification.jsx`, ~L288): the "Flag" action stores a fixed text instead of asking
for a reason, and the month "Approve" (sign-off) stays enabled while employees are still flagged.
## Scope
Flag asks for a reason (≥ 5 chars, like P1-06's reject reason) and sends it; the Approve/sign-off button is disabled
with "N still flagged" while any employee in scope is flagged. Read the server routes first
(`routes/financeVerification.js` /status, /bulk-verify, /signoff) — if the server already refuses sign-off with open
flags, mirror its rule exactly; if it does not, a UI gate only (server change → ask the planner at Phase 0).
## Targets
frontend/src/pages/FinanceVerification.jsx (+ utils/api.js only if a param is missing).
## Verify
Playwright check script (finance login): flag needs reason; reason stored; Approve disabled with count while flagged,
enabled after verify; 390px; 0 errors. `--base` shows fixed text + Approve enabled.


## RESUME (re-read after any compaction)
- Progress: docs/ux-bulk/prs/P1-15/PROGRESS.md — update + commit + push after EVERY small step. Never redo a ticked step.
- Owner gave a programme-level "go" on 10 Oct 2026 ("run through so we finish"). The PLANNER approves your Phase 0:
  finish Phase 0 (PLAN.md + PROGRESS.md committed + pushed), then STOP and report. The planner replies "go" or corrections.

## DO NOT MODIFY
Global (MASTER_PLAN §10.4): salaryComputation.js, dayCalculation.js, schema.js, payroll.js, recompute.js, Stage 7 register
(SalaryComputation.jsx .salreg/COLS/pins), ED finance-review flow, loans engine. Plus everything outside Targets.

## Build rules
- One finding = this PR only. Repo is PUBLIC: fictional test data only, no real names/codes/money anywhere.
- Work ONLY in your worktree. backend/node_modules + frontend/node_modules are symlinks to the main repo (do not commit them).
- Frontend edit → `npm run build --prefix frontend`; commit frontend/dist in its own commit.
- Browser checks: PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers, scratch DB, real logins, built dist, port 3115 only.
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
