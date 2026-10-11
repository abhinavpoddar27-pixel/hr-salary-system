# P2-03 — IST "today", date input helpers, DateSelector month list, year options
Base: origin/main 80934af4 · Branch: feat/formatters-ist-today · Worktree: /home/claude/wt-p2-03 · Port: 3203
Master plan: docs/ux-bulk/MASTER_PLAN.md §6 P2 (read with: git -C /home/claude/wt-docs show HEAD:docs/ux-bulk/MASTER_PLAN.md) — P2-03.
## Scope
utils/formatters.js: add todayIST() (YYYY-MM-DD in Asia/Kolkata regardless of browser zone) and toIstDateInput(date).
components/common/DateSelector.jsx: month mode quick picks This Month / Last Month only; YEAR_OPTIONS = current year −2…+1
(IST). Fix FinanceAudit.jsx ~L525 (find the date bug the plan names; describe it in PLAN.md). Daily Wage Entry + Payments
pages: "today" defaults use todayIST(). ESLint rule is OUT (no ESLint in repo). Grep every other "today" = new Date()
.toISOString().slice(0,10) in the frontend and LIST them in PLAN.md (fix only the ones in owned files).
## Owned files
utils/formatters.js · components/common/DateSelector.jsx · pages/FinanceAudit.jsx (that one fix only) ·
pages/DailyWageEntry.jsx · the DW payments page (find it).
## Verify
jest-free unit check (node script) for todayIST at 23:59 IST / 00:01 IST with a UTC clock; Playwright with the browser
timezone set to UTC at 00:30 IST: DW Entry default = IST date; DateSelector years/month picks; 0 errors. --base shows UTC date.

## RESUME (re-read after any compaction)
- Progress: docs/ux-bulk/prs/P2-03/PROGRESS.md — update + commit + push after EVERY small step. Never redo a ticked step.
- Owner gave a programme-level "go" ("run through so we finish"). The PLANNER approves your Phase 0:
  Phase 0 = read code, read-only diagnostics, write PLAN.md (files + functions + smallest change + tests + risks +
  questions), commit + push PLAN.md and PROGRESS.md, then STOP and report "Phase 0 ready". Wait for "go".

## FILE OWNERSHIP (new rule — this is what stops PRs conflicting)
Seven builders run in parallel. You may edit ONLY the files under "Owned files" plus new files you create
(tests, check script, docs/ux-bulk/prs/P2-03/*). If the fix needs any other existing file, STOP and ask the planner —
another builder may own it. NEVER commit frontend/dist (it is in .gitignore; Railway + CI build it).
NEVER edit CLAUDE.md — your session notes go in docs/ux-bulk/prs/P2-03/PROGRESS.md under "## CLAUDE.md entry".

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
