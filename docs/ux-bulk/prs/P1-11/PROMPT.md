# P1-11 — Dashboard shows "All clear" when a call fails
Base: origin/main 3d20021 · Branch: fix/dashboard-failed-call-not-all-clear · Worktree: /home/claude/wt-p1-11
Master plan: §6 P1-11 · Finding H-4

## Diagnostics already done by the planner
- `pages/Dashboard.jsx` L83–101: each action-item call has `.catch(() => ({ success: false }))`, then a failed call
  yields count 0 → L180 renders "{label}: All clear". A failed check is shown as nothing to do.

## Phase 0 — plan only
Read the Promise.all block, how items are built from the results, and the render at ~L180. PLAN.md + PROGRESS.md,
commit, push, STOP.

## Scope (smallest change)
- Track which calls failed; a failed item renders "Couldn't check {label} — Retry" (retry refetches that block) in a
  neutral/amber style, never "All clear". Successful items unchanged.
- No backend change; the other dashboard queries (overview/trend/alerts) unchanged.

## Targets
frontend/src/pages/Dashboard.jsx → the action-items block only.

## Verify
Browser check `backend/scripts/dashboard-failed-call-check.py`: route-intercept one call to 500 → that item shows the
"Couldn't check" text, the others render normally; Retry with the intercept removed → real value; no "All clear" for
the failed one; 0 page errors (console 500 expected for the intercepted call only). `--base`: "All clear" shown.

## RESUME (re-read after any compaction)
- Progress: docs/ux-bulk/prs/P1-11/PROGRESS.md — update + commit + push after EVERY small step. Never redo a ticked step.
- Owner gave a programme-level "go" on 10 Oct 2026 ("run through so we finish"). The PLANNER approves your Phase 0:
  finish Phase 0 (PLAN.md + PROGRESS.md committed + pushed), then STOP and report. The planner replies "go" or corrections.

## DO NOT MODIFY
Global (MASTER_PLAN §10.4): salaryComputation.js, dayCalculation.js, schema.js, payroll.js, recompute.js, Stage 7 register
(SalaryComputation.jsx .salreg/COLS/pins), ED finance-review flow, loans engine. Plus everything outside Targets.

## Build rules
- One finding = this PR only. Repo is PUBLIC: fictional test data only, no real names/codes/money anywhere.
- Work ONLY in your worktree. backend/node_modules + frontend/node_modules are symlinks to the main repo (do not commit them).
- Frontend edit → `npm run build --prefix frontend`; commit frontend/dist in its own commit.
- Browser checks: PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers, scratch DB, real logins, built dist, port 3111 only.
  Pattern: backend/scripts/salary-register-report-check.py. Prove the bug once with `--base` on a main build.
- jest full suite before and after (record suites/tests).
- Self-debug pass + user-simulation pass (happy path + ≥1 edge) before hand-off.

## Hand-off
CLAUDE.md "Last Session" entry at the top (house style: branch, bug, fix, fragile, verified, not tested, found-not-fixed).
Commit messages end with the session attribution lines. Push; verify HEAD == origin/<branch>. Do NOT open/merge a PR.
Report: built / caught / tested (counts) / not tested (why) / final SHA / new findings.
