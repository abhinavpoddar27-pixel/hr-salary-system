# N-REP — Reports: Bank Transfer Sheet includes held salaries (N-3), PF/ESI Statement ignore company (N-2), Audit Trail blank times + ignores month (N-1)
Base: origin/main c942563f · Branch: fix/reports-company-held-audit · Worktree: /home/claude/wt-n-rep · Port: 3131
Master plan: docs/ux-bulk/MASTER_PLAN.md (read with: git -C /home/claude/wt-docs show HEAD:docs/ux-bulk/MASTER_PLAN.md) — §9 register N-1, N-2, N-3 (in docs/ux-bulk/PROGRESS.md on the docs branch). Three findings, ONE file → one PR
(avoids three PRs conflicting on reports.js). N-3 is money-adjacent: the planner reviews it independently.
## Findings
N-3: Reports → Bank Transfer Sheet has no salary_held = 0 filter → its total includes held salaries (the bank NEFT file
already excludes them — compare with exportFormats generateBankFile). Fix: exclude held rows (show them in a separate
"held — not in this sheet" count/total if the endpoint returns totals).
N-2: PF Statement and ESI Statement endpoints ignore the company param → both companies mixed. Fix: scope by company
(blank = all, as other reports).
N-1: Audit Trail reads created_at (column is changed_at) → blank timestamps; ignores month/year (returns last 1,000 rows
of all time). Fix: read changed_at; filter by the selected month/year (IST).
## Owned files
backend/src/routes/reports.js · frontend/src/pages/Reports.jsx (only the Bank Transfer / PF / ESI / Audit Trail blocks).
NOT exportFormats.js, NOT api.js.
## Verify
jest (new reportsCorrectness.test.js): held excluded + totals; PF/ESI per company; audit times present + month filter.
Playwright (hr/finance): each report shows the right rows; 0 errors. `--base` proves each bug.

## RESUME (re-read after any compaction)
- Progress: docs/ux-bulk/prs/N-REP/PROGRESS.md — update + commit + push after EVERY small step. Never redo a ticked step.
- Owner gave a programme-level "go" ("run through so we finish"). The PLANNER approves your Phase 0:
  Phase 0 = read code, read-only diagnostics, write PLAN.md (files + functions + smallest change + tests + risks +
  questions), commit + push PLAN.md and PROGRESS.md, then STOP and report "Phase 0 ready". Wait for "go".

## FILE OWNERSHIP (new rule — this is what stops PRs conflicting)
Six builders run in parallel. You may edit ONLY the files under "Owned files" plus new files you create
(tests, check script, docs/ux-bulk/prs/N-REP/*). If the fix needs any other existing file, STOP and ask the planner —
another builder may own it. NEVER commit frontend/dist (it is in .gitignore; Railway + CI build it).
NEVER edit CLAUDE.md — your session notes go in docs/ux-bulk/prs/N-REP/PROGRESS.md under "## CLAUDE.md entry".

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
