# N-MONEY — Salary flag bulk reject does not revert gross (N-16); salary-change approval zeroes a component (N-17)   ★ MONEY
Base: origin/main c942563f · Branch: fix/salary-flag-reject-revert · Worktree: /home/claude/wt-n-money · Port: 3132
Master plan: docs/ux-bulk/MASTER_PLAN.md (read with: git -C /home/claude/wt-docs show HEAD:docs/ux-bulk/MASTER_PLAN.md) — §9 register N-16, N-17 (docs branch PROGRESS.md). Money PR: planner runs an independent review before the PR.
## Findings
N-16: `PUT /api/finance-audit/bulk-approve` (financeAudit.js ~L1416) can REJECT a GROSS_STRUCTURE_CHANGE flag without the
revert the single route `PUT /approve-flag/:flagId` (~L1341) does (revert employees.gross_salary + salary_structures,
finance_rejections row, audit). Also both routes have no finance/admin role guard (router is requireAuth only).
Fix: bulk path reuses the single-route revert logic per row (one transaction); add requireFinanceOrAdmin to both.
(P1-16 already stops the UI bulk-rejecting gross changes; the API must be safe too.)
N-17: `PUT /api/salary-input/approve/:id` (salary-input.js ~L158) builds the new structure from the request JSON; a
request raised from Employee Master has no conveyance, one from Salary Input has no special allowance → approval writes
0 for the missing component. Fix: a component ABSENT from the request keeps the current structure's value (present-but-0
stays 0). Effective date: today in IST, not the UTC day.
Phase 0: production counts only — approved requests whose new_structure lacks conveyance / special; rejected
GROSS_STRUCTURE_CHANGE flags rejected via bulk (audit/finance_rejections absent).
## Owned files
backend/src/routes/financeAudit.js (approve-flag + bulk-approve only) · backend/src/routes/salary-input.js (approve only).
NOT employees.js (another builder owns it), NOT salaryComputation.js.
## Verify
jest (real JWTs): bulk reject reverts + writes rows like the single route; viewer/hr 403 on both; approve keeps absent
components, writes present 0; IST date at 00:30 IST. Drift query after a Stage 7 on fictional data = 0.

## RESUME (re-read after any compaction)
- Progress: docs/ux-bulk/prs/N-MONEY/PROGRESS.md — update + commit + push after EVERY small step. Never redo a ticked step.
- Owner gave a programme-level "go" ("run through so we finish"). The PLANNER approves your Phase 0:
  Phase 0 = read code, read-only diagnostics, write PLAN.md (files + functions + smallest change + tests + risks +
  questions), commit + push PLAN.md and PROGRESS.md, then STOP and report "Phase 0 ready". Wait for "go".

## FILE OWNERSHIP (new rule — this is what stops PRs conflicting)
Six builders run in parallel. You may edit ONLY the files under "Owned files" plus new files you create
(tests, check script, docs/ux-bulk/prs/N-MONEY/*). If the fix needs any other existing file, STOP and ask the planner —
another builder may own it. NEVER commit frontend/dist (it is in .gitignore; Railway + CI build it).
NEVER edit CLAUDE.md — your session notes go in docs/ux-bulk/prs/N-MONEY/PROGRESS.md under "## CLAUDE.md entry".

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
