# P1-17 — Import: dead Overwrite checkbox; month not sent
Base: origin/main 868f5389 · Branch: fix/import-month-and-dead-checkbox · Worktree: /home/claude/wt-p1-17 · Port: 3117
Master plan: docs/ux-bulk/MASTER_PLAN.md §6 + §9 row for P1-17 (on branch docs/ux-bulk-progress-10oct — read with: git -C /home/claude/wt-docs show HEAD:docs/ux-bulk/MASTER_PLAN.md)

## Findings P-7, P-8 (Med)
Stage 1 Import (`pages/Import.jsx` ~L232–234, L310–313): an "Overwrite" checkbox does nothing; and the selected
month/year is not sent with the upload, so the server's UI-vs-file month check (`routes/import.js` POST /upload, reads
`req.body.month/year`) never fires.
## Scope
Remove the dead checkbox. When the selected month is already imported, show "This month is already imported — Stage 6
and 7 will be recomputed and manual corrections replayed" before upload. Append month + year to the FormData so the
server's mismatch refusal fires; show the server's `userMessage` on refusal. Backend untouched.
## Targets
frontend/src/pages/Import.jsx (+ utils/api.js upload helper only if it drops fields).
## Verify
Playwright (hr): build a small fictional EESL file in the script (see backend/src/__tests__/parser.test.js for the
synthetic layout); upload with the wrong month selected → refusal message shown, DB row counts unchanged; right month →
imports; re-import warning shown; no checkbox. `--base`: wrong month imports silently.


## RESUME (re-read after any compaction)
- Progress: docs/ux-bulk/prs/P1-17/PROGRESS.md — update + commit + push after EVERY small step. Never redo a ticked step.
- Owner gave a programme-level "go" on 10 Oct 2026 ("run through so we finish"). The PLANNER approves your Phase 0:
  finish Phase 0 (PLAN.md + PROGRESS.md committed + pushed), then STOP and report. The planner replies "go" or corrections.

## DO NOT MODIFY
Global (MASTER_PLAN §10.4): salaryComputation.js, dayCalculation.js, schema.js, payroll.js, recompute.js, Stage 7 register
(SalaryComputation.jsx .salreg/COLS/pins), ED finance-review flow, loans engine. Plus everything outside Targets.

## Build rules
- One finding = this PR only. Repo is PUBLIC: fictional test data only, no real names/codes/money anywhere.
- Work ONLY in your worktree. backend/node_modules + frontend/node_modules are symlinks to the main repo (do not commit them).
- Frontend edit → `npm run build --prefix frontend`; commit frontend/dist in its own commit.
- Browser checks: PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers, scratch DB, real logins, built dist, port 3117 only.
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
