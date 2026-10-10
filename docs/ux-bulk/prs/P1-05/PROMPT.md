# P1-05 — Stage 6 Apply Leave form keeps the previous employee's values
Base: origin/main 18bef07 · Branch: fix/stage6-leave-form-reset · Worktree: /home/claude/wt-p1-05
Master plan: `git show origin/docs/ux-bulk-master-plan:docs/ux-bulk/MASTER_PLAN.md` §6 P1-05 · Finding P-3

## Diagnostics already done by the planner
- `pages/DayCalculation.jsx`: `leaveForm` state (~L154) is reset only on a successful submit (~L201). Opening the
  Apply Leave window for employee B after typing for A (then cancelling / closing) shows A's date, type and reason —
  a leave can be sent for the wrong person/day. Note P1-04 (#90) already edited this file (calcMutation + header) —
  do not touch those parts.

## Phase 0 — plan only
Find every place the Apply Leave window opens and closes (open handler, cancel, ✕, Esc/backdrop, after success).
PLAN.md + PROGRESS.md, commit, push, STOP.

## Scope (smallest change)
Reset leaveForm to its initial value whenever the window opens for an employee and when it is cancelled/closed.
Nothing else (balance display, HR→finance request flow untouched).

## Targets
frontend/src/pages/DayCalculation.jsx → the Apply Leave open/close handlers only.

## Verify
Browser check `backend/scripts/stage6-leave-form-reset-check.py`: open window for A, set type/date/reason, cancel;
open for B → empty form; repeat with ✕ and Esc; submit for B → request row is for B with B's values; 0 errors.
`--base`: B's window shows A's values.

## RESUME (re-read after any compaction)
- Progress: docs/ux-bulk/prs/P1-05/PROGRESS.md — update + commit + push after EVERY small step. Never redo a ticked step.
- Owner gave a programme-level "go" on 10 Oct 2026 ("run through so we finish"). The PLANNER approves your Phase 0:
  finish Phase 0 (PLAN.md + PROGRESS.md committed + pushed), then STOP and report. The planner replies "go" or corrections.

## DO NOT MODIFY
Global (MASTER_PLAN §10.4): salaryComputation.js, dayCalculation.js, schema.js, payroll.js, recompute.js, Stage 7 register
(SalaryComputation.jsx .salreg/COLS/pins), ED finance-review flow, loans engine. Plus everything outside Targets.

## Build rules
- One finding = this PR only. Repo is PUBLIC: fictional test data only, no real names/codes/money anywhere.
- Work ONLY in your worktree. backend/node_modules + frontend/node_modules are symlinks to the main repo (do not commit them).
- Frontend edit → `npm run build --prefix frontend`; commit frontend/dist in its own commit.
- Browser checks: PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers, scratch DB, real logins, built dist, port 3105 only.
  Pattern: backend/scripts/salary-register-report-check.py. Prove the bug once with `--base` on a main build.
- jest full suite before and after (record suites/tests).
- Self-debug pass + user-simulation pass (happy path + ≥1 edge) before hand-off.

## Hand-off
CLAUDE.md "Last Session" entry at the top (house style: branch, bug, fix, fragile, verified, not tested, found-not-fixed).
Commit messages end with the session attribution lines. Push; verify HEAD == origin/<branch>. Do NOT open/merge a PR.
Report: built / caught / tested (counts) / not tested (why) / final SHA / new findings.
