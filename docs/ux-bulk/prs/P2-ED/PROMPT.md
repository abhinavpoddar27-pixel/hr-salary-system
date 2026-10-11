# P2-04 + P2-05 + P2-06 — Button/IconButton/StatusBadge, ScrollTable, ReviewQueue; Extra Duty page adopts them
Base: origin/main 80934af4 · Branch: feat/ed-shared-components · Worktree: /home/claude/wt-p2-ed · Port: 3204
Master plan: docs/ux-bulk/MASTER_PLAN.md §6 P2 (read with: git -C /home/claude/wt-docs show HEAD:docs/ux-bulk/MASTER_PLAN.md) — P2-04, P2-05, P2-06. One PR because all three adopt on ExtraDutyGrants.jsx (avoids three PRs conflicting).
## Scope
P2-04: components/ui/Button.jsx (primary/secondary/ghost/danger, sizes, busy), IconButton (required label → aria-label +
title), StatusBadge + utils/statusMap.js (ED, miss punch, leave, salary change, loans, DW, bulk batch states — map only;
adopt only on the ED page). P2-05: components/ui/ScrollTable.jsx (own overflow container, max-h, border-separate, sticky
thead, chevron <button> expand, sortable headers as buttons). Never touch Stage 7 .salreg. P2-06: components/bulk/
ReviewQueue.jsx extracted from the ED finance tab — behaviour of #79 is the spec (chips with counts, client order,
header box selection rules, selection clears on filter/tab change, fixed bottom bar, tinted rejected rows); props per plan.
ED page: ZERO behaviour change — backend/scripts/ed-finance-review-ux-check.py must stay 25/25, ed-return-browser-check.py
16/16.
## Owned files
pages/ExtraDutyGrants.jsx · new components/ui/Button.jsx, IconButton.jsx, StatusBadge.jsx, ScrollTable.jsx ·
new utils/statusMap.js · new components/bulk/ReviewQueue.jsx.
## Verify
The two ED scripts unchanged and green; a new component check (render each variant, keyboard on chevron/sort buttons);
390px; 0 errors.

## RESUME (re-read after any compaction)
- Progress: docs/ux-bulk/prs/P2-ED/PROGRESS.md — update + commit + push after EVERY small step. Never redo a ticked step.
- Owner gave a programme-level "go" ("run through so we finish"). The PLANNER approves your Phase 0:
  Phase 0 = read code, read-only diagnostics, write PLAN.md (files + functions + smallest change + tests + risks +
  questions), commit + push PLAN.md and PROGRESS.md, then STOP and report "Phase 0 ready". Wait for "go".

## FILE OWNERSHIP (new rule — this is what stops PRs conflicting)
Seven builders run in parallel. You may edit ONLY the files under "Owned files" plus new files you create
(tests, check script, docs/ux-bulk/prs/P2-ED/*). If the fix needs any other existing file, STOP and ask the planner —
another builder may own it. NEVER commit frontend/dist (it is in .gitignore; Railway + CI build it).
NEVER edit CLAUDE.md — your session notes go in docs/ux-bulk/prs/P2-ED/PROGRESS.md under "## CLAUDE.md entry".

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
