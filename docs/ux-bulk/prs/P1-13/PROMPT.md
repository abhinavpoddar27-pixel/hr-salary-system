# P1-13 — Finance Verification ignores the selected company (incl. sign-off)
Base: origin/main c942563f · Branch: fix/finverify-company-scope · Worktree: /home/claude/wt-p1-13 · Port: 3113
Master plan: docs/ux-bulk/MASTER_PLAN.md (read with: git -C /home/claude/wt-docs show HEAD:docs/ux-bulk/MASTER_PLAN.md) — §6 P1-13, §9 F-4. Also folds in N-18 part "sign-off ignores company".
## Finding F-4 (High)
Finance Verification (`pages/FinanceVerification.jsx`) shows a company filter, but its API calls (`utils/api.js` ~L388–439)
and SQL (`routes/financeVerification.js`, ~L198–210 and the /signoff + /signoff-status handlers) ignore it: counts,
red flags and the month sign-off mix both companies. `finance_month_signoff` is UNIQUE(month, year, company).
## Scope (decide the smallest correct option at Phase 0)
Pass company through every finance-verification read + the sign-off, scoped in SQL; OR, if per-company sign-off is
not how finance works, keep one sign-off for "all" and make the screen say so. Check production (counts only): rows in
finance_month_signoff by company, and whether both companies have salary rows in recent months. Put the choice in
PLAN.md as a question. Empty company = all companies (current behaviour) must still work.
## Owned files
frontend/src/pages/FinanceVerification.jsx · backend/src/routes/financeVerification.js · backend/src/services/financeRedFlags.js
(only if needed) · frontend/src/utils/api.js — ONLY the finance-verification helpers block (another builder edits other
api.js lines; keep your hunks inside that block).
## Verify
jest: per-company counts/red flags/sign-off with two fictional companies. Playwright (finance): switch company → numbers
change and match SQL; sign-off scoped; "All" unchanged. `--base`: company switch changes nothing.

## RESUME (re-read after any compaction)
- Progress: docs/ux-bulk/prs/P1-13/PROGRESS.md — update + commit + push after EVERY small step. Never redo a ticked step.
- Owner gave a programme-level "go" ("run through so we finish"). The PLANNER approves your Phase 0:
  Phase 0 = read code, read-only diagnostics, write PLAN.md (files + functions + smallest change + tests + risks +
  questions), commit + push PLAN.md and PROGRESS.md, then STOP and report "Phase 0 ready". Wait for "go".

## FILE OWNERSHIP (new rule — this is what stops PRs conflicting)
Six builders run in parallel. You may edit ONLY the files under "Owned files" plus new files you create
(tests, check script, docs/ux-bulk/prs/P1-13/*). If the fix needs any other existing file, STOP and ask the planner —
another builder may own it. NEVER commit frontend/dist (it is in .gitignore; Railway + CI build it).
NEVER edit CLAUDE.md — your session notes go in docs/ux-bulk/prs/P1-13/PROGRESS.md under "## CLAUDE.md entry".

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
