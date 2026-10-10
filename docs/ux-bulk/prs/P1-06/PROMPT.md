# P1-06 — Leave rejection reason is dropped; require it
Base: origin/main 2d96842 · Branch: fix/leave-rejection-reason · Worktree: /home/claude/wt-p1-06
Master plan: §6 P1-06 · Finding H-3

## Diagnostics already done by the planner
- Code: `pages/LeaveManagement.jsx` L423 sends `{ rejection_reason, rejected_by }`; `routes/leaves.js` L296–304
  `PUT /:id/reject` reads `req.body.reason` and stores `reason || ''` → every rejection stores an empty reason.
- Production: 1 rejected leave ever, its reason is empty (consistent with the bug). Sentry: not checked by planner — check.

## Phase 0 — plan only
Clean tree; read the reject mutation, reject modal (~L645–665), the list rows that could show the reason (~L577, ~L624),
the route, and utils/api.js rejectLeave. PLAN.md + PROGRESS.md, commit, push, STOP.

## Scope (smallest change)
- Frontend sends `reason` (route unchanged — prefer no backend change; if the route must also accept `rejection_reason`
  say why in PLAN).
- Confirm Reject disabled until the trimmed reason has ≥ 5 characters (hint text says so).
- Rejected rows show the rejection reason (expanded detail at least) — read the field the list API already returns;
  if it does not return it, report instead of changing the backend.

## Targets
frontend/src/pages/LeaveManagement.jsx (reject mutation, reject modal, rejected-row display). Nothing else unless PLAN justifies.

## Verify
- jest route test (new `leaveRejectReason.test.js` with real JWTs, pattern in __tests__/helpers/jwtApiHarness): reason stored.
- Browser check `backend/scripts/leave-reject-reason-check.py`: short reason → button disabled; valid reason → row
  Rejected with the reason visible; DB value equals typed text; 0 errors. `--base`: reason stored empty.

## RESUME (re-read after any compaction)
- Progress: docs/ux-bulk/prs/P1-06/PROGRESS.md — update + commit + push after EVERY small step. Never redo a ticked step.
- Owner gave a programme-level "go" on 10 Oct 2026 ("run through so we finish"). The PLANNER approves your Phase 0:
  finish Phase 0 (PLAN.md + PROGRESS.md committed + pushed), then STOP and report. The planner replies "go" or corrections.

## DO NOT MODIFY
Global (MASTER_PLAN §10.4): salaryComputation.js, dayCalculation.js, schema.js, payroll.js, recompute.js, Stage 7 register
(SalaryComputation.jsx .salreg/COLS/pins), ED finance-review flow, loans engine. Plus everything outside Targets.

## Build rules
- One finding = this PR only. Repo is PUBLIC: fictional test data only, no real names/codes/money anywhere.
- Work ONLY in your worktree. backend/node_modules + frontend/node_modules are symlinks to the main repo (do not commit them).
- Frontend edit → `npm run build --prefix frontend`; commit frontend/dist in its own commit.
- Browser checks: PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers, scratch DB, real logins, built dist, port 3106 only.
  Pattern: backend/scripts/salary-register-report-check.py. Prove the bug once with `--base` on a main build.
- jest full suite before and after (record suites/tests).
- Self-debug pass + user-simulation pass (happy path + ≥1 edge) before hand-off.

## Hand-off
CLAUDE.md "Last Session" entry at the top (house style: branch, bug, fix, fragile, verified, not tested, found-not-fixed).
Commit messages end with the session attribution lines. Push; verify HEAD == origin/<branch>. Do NOT open/merge a PR.
Report: built / caught / tested (counts) / not tested (why) / final SHA / new findings.
