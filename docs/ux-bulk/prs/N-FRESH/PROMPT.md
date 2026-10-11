# N-FRESH — Lists stale up to 5 s after an action (N-9, N-7) + finance 403 on every Miss Punch visit (N-15)
Base: origin/main c942563f · Branch: fix/fresh-reads-after-actions · Worktree: /home/claude/wt-n-fresh · Port: 3133
Master plan: docs/ux-bulk/MASTER_PLAN.md (read with: git -C /home/claude/wt-docs show HEAD:docs/ux-bulk/MASTER_PLAN.md) — §9 register N-7, N-9, N-15 (docs branch PROGRESS.md).
## Findings
server.js answers every GET with Cache-Control: private, max-age=5. Reads that must reflect a just-made change send
`fresh` (no-cache) in utils/api.js. Missing on: getDayCalculations (Stage 6 list after Run — N-7), miss-punches list
(after resolve/approve), night-shifts list (after confirm/reject) — N-9. Also after those mutations the pages refetch
only the current query; other filter chips stay stale (invalidate the query-key prefix).
N-15: Miss Punch page calls GET /features/leave-automation/status for every role; route is hr/admin → finance gets a 403
+ console error every visit. Fix: only call it for hr/admin.
## Owned files
frontend/src/utils/api.js — ONLY the getDayCalculations / getMissPunches / getNightShifts helpers (another builder edits
the finance-verification block) · frontend/src/pages/DayCalculation.jsx · frontend/src/pages/MissPunch.jsx ·
frontend/src/pages/NightShift.jsx (query invalidation only).
## Verify
Playwright: action then immediate list read (< 5 s) shows the change on Stage 6, Miss Punch (all chips), Night Shift;
finance opens Miss Punch with 0 console errors and 0 API ≥ 400. `--base` shows each stale read and the 403.

## RESUME (re-read after any compaction)
- Progress: docs/ux-bulk/prs/N-FRESH/PROGRESS.md — update + commit + push after EVERY small step. Never redo a ticked step.
- Owner gave a programme-level "go" ("run through so we finish"). The PLANNER approves your Phase 0:
  Phase 0 = read code, read-only diagnostics, write PLAN.md (files + functions + smallest change + tests + risks +
  questions), commit + push PLAN.md and PROGRESS.md, then STOP and report "Phase 0 ready". Wait for "go".

## FILE OWNERSHIP (new rule — this is what stops PRs conflicting)
Six builders run in parallel. You may edit ONLY the files under "Owned files" plus new files you create
(tests, check script, docs/ux-bulk/prs/N-FRESH/*). If the fix needs any other existing file, STOP and ask the planner —
another builder may own it. NEVER commit frontend/dist (it is in .gitignore; Railway + CI build it).
NEVER edit CLAUDE.md — your session notes go in docs/ux-bulk/prs/N-FRESH/PROGRESS.md under "## CLAUDE.md entry".

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
