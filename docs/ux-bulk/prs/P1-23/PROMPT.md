# P1-23 — Salary change: the requester must never approve (or reject) their own request
Base: origin/main 18bef07 · Branch: fix/salary-change-no-self-approval · Worktree: /home/claude/wt-p1-23
Master plan: §6 P1-23 · Finding F-3 · **Owner ruling Q6 (11 Oct 2026): NO — second person always, admin included.**
MONEY PR → independent review before PR.

## Diagnostics already done by the planner
- `routes/salary-input.js`: `POST /request-change` (hr/admin) stores `requested_by`; `PUT /approve/:id` and
  `PUT /reject/:id` are `requireFinanceOrAdmin` and never compare the deciding user with `requested_by` → an admin
  can raise and approve their own salary change.
- Production: 290 approved / 8 rejected / 2 pending; 2 approved rows were decided by their own requester (counts only).

## Phase 0 — plan only
Read request-change, approve, reject, and how SalaryInput.jsx shows the approve/reject buttons and who requested.
Check whether any other route applies a salary_change_requests row (grep). PLAN.md + PROGRESS.md, commit, push, STOP.

## Scope (smallest change)
- approve + reject: if `req.user.username === row.requested_by` → 403 `SELF_APPROVAL` "You raised this request —
  another finance or admin user must decide it." Checked before any write. Compare case-insensitively, trimmed.
- SalaryInput.jsx: for the requester, Approve/Reject disabled with that reason as tooltip/text.
- No schema change; no change to what approval applies.

## Targets
backend/src/routes/salary-input.js (approve + reject guards only), frontend/src/pages/SalaryInput.jsx (buttons only).
NOTE: salary-input.js approve applies structures — touch ONLY the guard lines, nothing in the apply logic.

## Verify
- jest `salaryChangeSelfApproval.test.js` with real JWTs (helpers/jwtApiHarness): admin raises → admin approve 403,
  row still Pending, structure unchanged; admin reject 403; another admin / finance can approve → applied; hr cannot
  approve (existing 403 kept). Full suite before/after.
- Browser check `backend/scripts/salary-change-self-approval-check.py`: requester sees disabled buttons with the
  reason; second user approves; 0 errors. `--base`: requester approves own request.

## RESUME (re-read after any compaction)
- Progress: docs/ux-bulk/prs/P1-23/PROGRESS.md — update + commit + push after EVERY small step. Never redo a ticked step.
- Owner gave a programme-level "go" on 10 Oct 2026 ("run through so we finish"). The PLANNER approves your Phase 0:
  finish Phase 0 (PLAN.md + PROGRESS.md committed + pushed), then STOP and report. The planner replies "go" or corrections.

## DO NOT MODIFY
Global (MASTER_PLAN §10.4): salaryComputation.js, dayCalculation.js, schema.js, payroll.js, recompute.js, Stage 7 register
(SalaryComputation.jsx .salreg/COLS/pins), ED finance-review flow, loans engine. Plus everything outside Targets.

## Build rules
- One finding = this PR only. Repo is PUBLIC: fictional test data only, no real names/codes/money anywhere.
- Work ONLY in your worktree. backend/node_modules + frontend/node_modules are symlinks to the main repo (do not commit them).
- Frontend edit → `npm run build --prefix frontend`; commit frontend/dist in its own commit.
- Browser checks: PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers, scratch DB, real logins, built dist, port 3123 only.
  Pattern: backend/scripts/salary-register-report-check.py. Prove the bug once with `--base` on a main build.
- jest full suite before and after (record suites/tests).
- Self-debug pass + user-simulation pass (happy path + ≥1 edge) before hand-off.

## Hand-off
CLAUDE.md "Last Session" entry at the top (house style: branch, bug, fix, fragile, verified, not tested, found-not-fixed).
Commit messages end with the session attribution lines. Push; verify HEAD == origin/<branch>. Do NOT open/merge a PR.
Report: built / caught / tested (counts) / not tested (why) / final SHA / new findings.
