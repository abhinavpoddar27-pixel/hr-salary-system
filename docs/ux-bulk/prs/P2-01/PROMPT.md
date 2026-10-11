# P2-01 — Modal + ConfirmDialog on headlessui Dialog; useConfirm(); migrate native confirm/prompt/alert
Base: origin/main 80934af4 · Branch: feat/ui-dialog-confirm · Worktree: /home/claude/wt-p2-01 · Port: 3201
Master plan: docs/ux-bulk/MASTER_PLAN.md §6 P2 (read with: git -C /home/claude/wt-docs show HEAD:docs/ux-bulk/MASTER_PLAN.md) — P2-01, finding X-10.
## Scope
Rebuild components/ui/Modal.jsx + ConfirmDialog.jsx on @headlessui/react Dialog (check it is installed; if not, STOP and ask
— no new dependency without approval) keeping the SAME props so every existing caller works unchanged; focus trap, Esc and
backdrop close except while busy; busy disables buttons. New hooks/useConfirm.jsx returning a promise (provider mounted
where? — if it needs App.jsx/main.jsx, use a self-mounting portal instead; App.jsx is owned by P2-08).
Migrate the native window.confirm/prompt/alert calls in: PayableOT.jsx, Settings.jsx, LeaveManagement.jsx, GatePasses.jsx,
FinanceEarlyExitApprovals.jsx, Reports.jsx, SqlConsole.jsx. NOT attendanceReview/* (separate owner workstream).
DO NOT change what any action does.
## Owned files
components/ui/Modal.jsx · components/ui/ConfirmDialog.jsx · new hooks/useConfirm.jsx · the 7 pages above (dialog calls only).
## Verify
Playwright: each migrated confirm opens, Cancel sends nothing, OK performs the same request as before; Esc/Tab trap; one
existing Modal caller per major page still opens/closes (pick 6); 390px; 0 page errors. jest unchanged.

## RESUME (re-read after any compaction)
- Progress: docs/ux-bulk/prs/P2-01/PROGRESS.md — update + commit + push after EVERY small step. Never redo a ticked step.
- Owner gave a programme-level "go" ("run through so we finish"). The PLANNER approves your Phase 0:
  Phase 0 = read code, read-only diagnostics, write PLAN.md (files + functions + smallest change + tests + risks +
  questions), commit + push PLAN.md and PROGRESS.md, then STOP and report "Phase 0 ready". Wait for "go".

## FILE OWNERSHIP (new rule — this is what stops PRs conflicting)
Seven builders run in parallel. You may edit ONLY the files under "Owned files" plus new files you create
(tests, check script, docs/ux-bulk/prs/P2-01/*). If the fix needs any other existing file, STOP and ask the planner —
another builder may own it. NEVER commit frontend/dist (it is in .gitignore; Railway + CI build it).
NEVER edit CLAUDE.md — your session notes go in docs/ux-bulk/prs/P2-01/PROGRESS.md under "## CLAUDE.md entry".

## DO NOT MODIFY
Global (MASTER_PLAN §10.4): salaryComputation.js, dayCalculation.js, schema.js, payroll.js, recompute.js, Stage 7
register (SalaryComputation.jsx), ED finance-review flow, loans engine. Plus every file you do not own.

## Build rules
- One finding (or the listed group) = this PR only. Repo is PUBLIC: fictional test data only; no real names, codes,
  account numbers or per-person money anywhere (code, tests, logs, docs, PR text). Production = read-only, counts only.
- Work ONLY in your worktree. node_modules are symlinks to the main repo (never commit them).
- Browser checks: PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers, scratch DB, real logins, a LOCAL frontend build, your port
  only. Pattern: backend/scripts/salary-register-report-check.py. Prove the bug once with `--base` on an origin/main build.
- Shared machine: `flock /tmp/vite.lock npm run build --prefix frontend`; full jest as `flock /tmp/jest.lock npx jest`
  (single test files need no lock). Never `pkill` broadly — kill only PIDs you started.
- jest full suite before and after (record suites/tests). Self-debug + user simulation (happy path + ≥1 edge) + v2.

## Hand-off
1. `git fetch origin main && git merge --no-edit origin/main` (merge, never rebase/force-push); if it conflicts on a
   file you own, resolve; on a file you do not own, STOP and report. Re-run jest + your check after the merge.
2. Commit messages end with:
   Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
   Claude-Session: https://claude.ai/code/session_01EDVH6aK4ohZnH2CNKLrjyB
3. Push; verify with `git ls-remote origin <branch>` == `git rev-parse HEAD`. Do NOT open or merge a PR.
4. Report: built / caught / tested (counts) / not tested (why) / final SHA / files changed list / new findings.
