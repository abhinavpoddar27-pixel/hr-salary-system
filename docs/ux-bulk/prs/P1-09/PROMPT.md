# P1-09 — Miss Punch "all resolved" banner is based on the current filter, not real pending work
Base: origin/main 3d20021 · Branch: fix/misspunch-all-resolved-banner · Worktree: /home/claude/wt-p1-09
Master plan: `git show origin/docs/ux-bulk-master-plan:docs/ux-bulk/MASTER_PLAN.md` §6 P1-09 · Finding P-5

## Diagnostics already done by the planner
- `pages/MissPunch.jsx`: pendingCount/resolvedCount (L216–218) count only the rows of the CURRENT filter; the "all
  resolved" banner (~L581) uses them, so filtering to e.g. Approved shows "all resolved" while HR/finance still have
  work. `summary.hrPending` / `summary.financePending` (L302–314) are the real counts.
- Do NOT touch the stray "0" at L417 area (`rec.miss_punch_resolved && …`) — that is P1-24, a separate PR.

## Phase 0 — plan only
Read the banner, the counts, the summary source and the filter chips. PLAN.md + PROGRESS.md, commit, push, STOP.

## Scope (smallest change)
Banner shows only when `(summary.hrPending || 0) + (summary.financePending || 0) === 0` AND the summary loaded
(not on error/loading). The "X of Y resolved" progress text may stay filter-based but must not claim "all done".

## Targets
frontend/src/pages/MissPunch.jsx → the banner condition (+ progress label only if it misleads). Nothing else.

## Verify
Browser check `backend/scripts/misspunch-banner-check.py`: fictional month with 2 HR-pending + 1 finance-pending + 3
approved rows; filter Approved → NO banner; resolve/approve everything → banner shows; summary call failing (route
intercept 500) → no banner; 0 errors. `--base`: banner wrongly shown on the Approved filter.

## RESUME (re-read after any compaction)
- Progress: docs/ux-bulk/prs/P1-09/PROGRESS.md — update + commit + push after EVERY small step. Never redo a ticked step.
- Owner gave a programme-level "go" on 10 Oct 2026 ("run through so we finish"). The PLANNER approves your Phase 0:
  finish Phase 0 (PLAN.md + PROGRESS.md committed + pushed), then STOP and report. The planner replies "go" or corrections.

## DO NOT MODIFY
Global (MASTER_PLAN §10.4): salaryComputation.js, dayCalculation.js, schema.js, payroll.js, recompute.js, Stage 7 register
(SalaryComputation.jsx .salreg/COLS/pins), ED finance-review flow, loans engine. Plus everything outside Targets.

## Build rules
- One finding = this PR only. Repo is PUBLIC: fictional test data only, no real names/codes/money anywhere.
- Work ONLY in your worktree. backend/node_modules + frontend/node_modules are symlinks to the main repo (do not commit them).
- Frontend edit → `npm run build --prefix frontend`; commit frontend/dist in its own commit.
- Browser checks: PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers, scratch DB, real logins, built dist, port 3109 only.
  Pattern: backend/scripts/salary-register-report-check.py. Prove the bug once with `--base` on a main build.
- jest full suite before and after (record suites/tests).
- Self-debug pass + user-simulation pass (happy path + ≥1 edge) before hand-off.

## Hand-off
CLAUDE.md "Last Session" entry at the top (house style: branch, bug, fix, fragile, verified, not tested, found-not-fixed).
Commit messages end with the session attribution lines. Push; verify HEAD == origin/<branch>. Do NOT open/merge a PR.
Report: built / caught / tested (counts) / not tested (why) / final SHA / new findings.
