# P1-25 — Employee edit (PUT /api/employees/:code) changes gross salary with no approval and no role check
Base: origin/main 0ea1409 · Branch: fix/employee-edit-no-direct-gross · Worktree: /home/claude/wt-p1-25
Found by the P1-23 independent review (finding N-12). Owner approved the fix 11 Oct 2026. MONEY PR → independent review.

## Diagnostics already done by the planner
- `routes/employees.js` `PUT /:code` (~L393): `gross_salary` is in `allowedFields`; the router is behind `requireAuth`
  only (no role guard) → any logged-in role can change a gross salary directly, with no salary_change_requests row,
  no finance approval and (it appears) no audit row. Plant Stage 7 reads `employees.gross_salary` → the next compute
  pays the new figure. `PUT /:code/salary` already routes gross changes into the approval flow (salary_change_requests,
  P1-23 adds maker-checker) — that is the ONE allowed path.
- Production (90 days): PUT /api/employees/<code> called by hr 139×, admin 5×, no other role. audit_log has 0
  employees.gross_salary rows in 180 days (the route does not log), so how often gross changed this way is unknown.
- CLAUDE.md "P4: Mark Left role guard" already lists this route's missing guard as found-not-fixed.

## Phase 0 — plan only
1. Read PUT /:code fully (incl. any structure sync it triggers), PUT /:code/salary, and what the Employees.jsx edit
   form sends (does it ever send gross_salary through updateEmployee? which form/modal?). grep every frontend caller
   of updateEmployee and every backend/script caller of PUT /api/employees/:code.
2. Decide and justify in PLAN: (a) refuse a CHANGED gross_salary on PUT /:code with 400 "Change salary through Salary
   → request a change (finance approves)" — resending the same value stays allowed (mirror the Mark Left/isExit
   pattern); (b) add `requireHrOrAdmin` to PUT /:code only (prod callers are hr/admin only — FACT above).
3. PLAN.md + PROGRESS.md, commit, push, STOP.

## Scope (smallest change)
- employees.js PUT /:code: the gross refusal (compare numerically to emp.gross_salary; unchanged value passes) +
  requireHrOrAdmin on this one route. Nothing else in the handler.
- Frontend only if the edit form actually sends gross: make the field read-only there with a link/hint to the salary
  request flow. If it never sends it, no frontend change.
- No other route (POST /employees, bulk-set-contractor, documents, bulk-import stay for P2-11).

## Targets
backend/src/routes/employees.js (PUT /:code only); frontend/src/pages/Employees.jsx only if needed.

## Verify
- jest `employeeEditGrossGuard.test.js` with real JWTs (helpers/jwtApiHarness): hr changes gross → 400, DB unchanged;
  hr resends same gross with a name change → 200; hr edits other fields → 200; viewer/finance/supervisor → 403;
  admin → same rules as hr; PUT /:code/salary still creates a pending request. Full suite before/after.
- Plant Stage 7 not touched — confirm with `git diff --stat` that salaryComputation.js is unchanged.
- Browser check `backend/scripts/employee-edit-gross-guard-check.py` (only if frontend changes; else a curl-style
  script is enough): edit form flow works, gross edit goes to the request flow; 0 errors. `--base` shows the bug.

## RESUME (re-read after any compaction)
- Progress: docs/ux-bulk/prs/P1-25/PROGRESS.md — update + commit + push after EVERY small step. Never redo a ticked step.
- Owner gave a programme-level "go" on 10 Oct 2026 ("run through so we finish"). The PLANNER approves your Phase 0:
  finish Phase 0 (PLAN.md + PROGRESS.md committed + pushed), then STOP and report. The planner replies "go" or corrections.

## DO NOT MODIFY
Global (MASTER_PLAN §10.4): salaryComputation.js, dayCalculation.js, schema.js, payroll.js, recompute.js, Stage 7 register
(SalaryComputation.jsx .salreg/COLS/pins), ED finance-review flow, loans engine. Plus everything outside Targets.

## Build rules
- One finding = this PR only. Repo is PUBLIC: fictional test data only, no real names/codes/money anywhere.
- Work ONLY in your worktree. backend/node_modules + frontend/node_modules are symlinks to the main repo (do not commit them).
- Frontend edit → `npm run build --prefix frontend`; commit frontend/dist in its own commit.
- Browser checks: PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers, scratch DB, real logins, built dist, port 3125 only.
  Pattern: backend/scripts/salary-register-report-check.py. Prove the bug once with `--base` on a main build.
- jest full suite before and after (record suites/tests).
- Self-debug pass + user-simulation pass (happy path + ≥1 edge) before hand-off.

## Hand-off
CLAUDE.md "Last Session" entry at the top (house style: branch, bug, fix, fragile, verified, not tested, found-not-fixed).
Commit messages end with the session attribution lines. Push; verify HEAD == origin/<branch>. Do NOT open/merge a PR.
Report: built / caught / tested (counts) / not tested (why) / final SHA / new findings.
