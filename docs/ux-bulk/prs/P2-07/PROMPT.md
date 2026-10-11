# P2-07 — parseCodes + PeoplePicker; EmployeeSearchSelect aria fix
Base: origin/main 80934af4 · Branch: feat/people-picker-parse-codes · Worktree: /home/claude/wt-p2-07 · Port: 3207
Master plan: docs/ux-bulk/MASTER_PLAN.md §6 P2 (read with: git -C /home/claude/wt-docs show HEAD:docs/ux-bulk/MASTER_PLAN.md) — P2-07.
## Scope
utils/parseCodes.js (split newline/comma/tab/semicolon/space; keep tokens matching the employee-code pattern derived from
the master (codes are TEXT, keep leading zeros; sales codes like S123 exist); report ignored tokens; dedupe; keep order).
components/bulk/PeoplePicker.jsx (active employees, optional Left with warning badge; grouped by department largest first;
search name/code/department; tick whole department; selected tray with count + remove). Not wired into any page yet.
Fix EmployeeSearchSelect aria-activedescendant. Production read (counts only): code formats in use (lengths, prefixes).
## Owned files
new utils/parseCodes.js · new components/bulk/PeoplePicker.jsx · components/shared/EmployeeSearchSelect.jsx.
## Verify
Unit tests for the parser (frontend has no test runner? — use a node script under backend/scripts or add a jest test
in backend that requires the ESM file via a small CJS copy? Decide smallest at Phase 0). Playwright on a tiny harness page
or Storybook-less mount: picker search/tick/tray; aria check on EmployeeSearchSelect in Leave Management; 0 errors.

## RESUME (re-read after any compaction)
- Progress: docs/ux-bulk/prs/P2-07/PROGRESS.md — update + commit + push after EVERY small step. Never redo a ticked step.
- Owner gave a programme-level "go" ("run through so we finish"). The PLANNER approves your Phase 0:
  Phase 0 = read code, read-only diagnostics, write PLAN.md (files + functions + smallest change + tests + risks +
  questions), commit + push PLAN.md and PROGRESS.md, then STOP and report "Phase 0 ready". Wait for "go".

## FILE OWNERSHIP (new rule — this is what stops PRs conflicting)
Seven builders run in parallel. You may edit ONLY the files under "Owned files" plus new files you create
(tests, check script, docs/ux-bulk/prs/P2-07/*). If the fix needs any other existing file, STOP and ask the planner —
another builder may own it. NEVER commit frontend/dist (it is in .gitignore; Railway + CI build it).
NEVER edit CLAUDE.md — your session notes go in docs/ux-bulk/prs/P2-07/PROGRESS.md under "## CLAUDE.md entry".

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
