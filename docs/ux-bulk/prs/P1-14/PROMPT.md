# P1-14 — Employee bank edits write the wrong column pair; salary split reset on save   ★ MONEY
Base: origin/main c942563f · Branch: fix/employee-bank-columns · Worktree: /home/claude/wt-p1-14 · Port: 3114
Master plan: docs/ux-bulk/MASTER_PLAN.md (read with: git -C /home/claude/wt-docs show HEAD:docs/ux-bulk/MASTER_PLAN.md) — §6 P1-14, §9 H-2. Money PR: the planner runs an independent review before the PR goes up.
## Finding H-2 (High)
employees has TWO bank column pairs: bank_account/ifsc and account_number/ifsc_code. Employee Master edits
(`pages/Employees.jsx` ~L56–71 → `PUT /api/employees/:code/salary` ~L614–650 and the PUT /:code allowlist ~L458) write one
pair, while exports (`services/exportFormats.js` ~L155 bank file, sales/other readers) may read the other → an edited
account can miss the NEFT file. Also the modal's salary split resets on save (reads the wrong key; should read the
salaryStructure key).
## Scope
Phase 0: list EVERY reader and writer of both pairs (grep whole backend), and read production counts only:
active employees where the two pairs differ / one pair empty and the other set. Decide ONE canonical pair; every writer
writes both pairs (or the canonical one + mirror) so all readers see the edit. Fix the split-reset. No data repair in
this PR (report counts; repair is an owner decision). Never print account/IFSC values — counts only.
## Owned files
frontend/src/pages/Employees.jsx · backend/src/routes/employees.js · backend/src/services/exportFormats.js (read path only,
only if needed — NEFT bytes for unchanged data must stay identical; prove with an md5 before/after on a scratch DB).
## Verify
jest: edit bank via PUT /:code/salary and PUT /:code → NEFT export shows the new account (fictional); split preserved;
viewer still 403. Playwright (hr): edit → save → reopen shows new values + same split. `--base` proves the miss.

## RESUME (re-read after any compaction)
- Progress: docs/ux-bulk/prs/P1-14/PROGRESS.md — update + commit + push after EVERY small step. Never redo a ticked step.
- Owner gave a programme-level "go" ("run through so we finish"). The PLANNER approves your Phase 0:
  Phase 0 = read code, read-only diagnostics, write PLAN.md (files + functions + smallest change + tests + risks +
  questions), commit + push PLAN.md and PROGRESS.md, then STOP and report "Phase 0 ready". Wait for "go".

## FILE OWNERSHIP (new rule — this is what stops PRs conflicting)
Six builders run in parallel. You may edit ONLY the files under "Owned files" plus new files you create
(tests, check script, docs/ux-bulk/prs/P1-14/*). If the fix needs any other existing file, STOP and ask the planner —
another builder may own it. NEVER commit frontend/dist (it is in .gitignore; Railway + CI build it).
NEVER edit CLAUDE.md — your session notes go in docs/ux-bulk/prs/P1-14/PROGRESS.md under "## CLAUDE.md entry".

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
