# P2-11 — PROGRESS

## RESUME
Branch fix/backend-route-guards (base origin/main 80934af4), worktree /home/claude/wt-p2-11, port 3211.
State: BUILT, merged origin/main fa430144, pushed. Hand-off done.

## Steps
- [x] Phase 0: scan every write route behind requireAuth only (208 routes, 38 routers) → 35 unguarded + payroll.js list
- [x] Phase 0: production usage_logs counts by role/route (90 days + older), read-only
- [x] Phase 0: PLAN.md (table, change, tests, risks, Q1–Q7)
- [x] Planner "go" + rulings
- [x] Baseline full jest (flock)
- [x] Guards per file + backendRouteGuards.test.js
- [x] Full jest after; live check script (+ --base)
- [x] merge origin/main, push, report

## Rulings (planner, 11 Oct 2026)
- Q1 go with the 35-route table. Q2 DELETE /import/:id admin only. Q3 KEEP finance on PUT /attendance/record/:id and
  POST /attendance/recalculate-metrics (hr/finance/admin) — never drop a role that has ever used a route.
  Q4 POST /jobs admin only. Q5 POST /employees guard only. Q6 manual-flags verify finance+admin. Q7 payroll.js listed for owner.
- Do NOT touch dailyWage.js (P2-03). Check stageNum validation in POST /import/stage/:stage/complete; one-line whitelist + test
  allowed if it can inject, else report.

## Results
- Baseline jest 105 suites / 1649. After: 106 / 1940; after merging origin/main fa430144: 108 / 1960.
- New backendRouteGuards.test.js 291 tests (35 routes × 7 logins refused/allowed, 401s, concrete effects, uploads,
  stage whitelist); 176 of them fail on 80934af4.
- backend/scripts/route-guards-check.js (real server.js, port 3211, real logins) 22/22; --base on 80934af4 6/6
  (viewer reactivates a Left employee, deletes a month import, queues a job).

## CLAUDE.md entry
## Last Session — 2026-10-11 (P2-11: role guards on 35 write routes that sat behind requireAuth only)
**Branch `fix/backend-route-guards`, NOT merged.** Plan + log: `docs/ux-bulk/prs/P2-11/PLAN.md`, `PROGRESS.md`. Findings N-13,
N-11 (night-shift confirm/reject), P4 follow-ups. Rulings 11 Oct: Q2 DELETE import admin only; Q3 finance KEPT on
PUT /attendance/record/:id + recalculate-metrics (finance used them before July); Q4 POST /jobs admin only; Q6 manual-flag
verify finance+admin; never drop a role that has ever used a route.
- **Bug:** 35 POST/PUT/PATCH/DELETE routes were reachable by any logged-in role (viewer / supervisor / employee login):
  delete a month's import (raw + processed attendance + day_calculations), mark employees Left/Active, mark advances paid,
  queue salary_compute / leave jobs, write punch/day corrections, upload/delete employee documents, create employees.
- **Fix (guard lines + imports only):** hr+admin on import upload/stage/reconciliation, attendance miss-punch resolve +
  bulk, night-shift confirm/reject, record shift, deduplicate, employees POST / documents / bulk-set-contractor,
  analytics detect-inactive / auto-detect-left / reactivate-employee, advance ×5, lifecycle POST. hr/finance/admin on
  attendance record PUT + recalculate-metrics, analytics alerts generate/read + ai-review, finance-audit day/punch
  correction, tax-declarations PUT. finance+admin on holiday audit review + manual-flag verify. admin on DELETE
  /import/:id and POST /jobs. Upload guards sit before multer (refused file never written). Same 403 bodies as
  middleware/roles.js. Stage route: `!(stageNum >= 1 && stageNum <= 7)` — "abc" gave stage_NaN_done → 500, now 400
  (parseInt means no text can reach the SQL; no injection).
- **Left open on purpose:** notifications read flags, session-analytics events, POST /bug-reports, daily-wage
  check-duplicates (read-only; dailyWage.js owned by P2-03).
- **Fragile:** analytics.js / attendance.js / taxDeclarations.js each have a one-line local requireHrFinanceOrAdmin
  (roles.js has no export for it). Settings has its own local requireAdmin (raw role compare) — untouched.
- **Owner list (payroll.js, DO NOT MODIFY):** POST /calculate-days and /compute-salary have no role guard (90 d:
  admin, hr, finance used them) — any role incl. viewer can run Stage 6/7; POST /finalise has no role guard beyond the
  admin stale override. Suggested: hr/finance/admin on all three.
- **Verified:** jest 105/1649 → 108/1960 after merge; new backendRouteGuards.test.js 291 (176 fail on 80934af4);
  route-guards-check.js 22/22, --base 6/6.
- **Not tested:** Railway; browser (no frontend change). **Follow-ups:** hide buttons a refused role can still see
  (hr: Finance Audit manual-flag Verify); GET /api/tax-declarations/:code readable by any role; POST /employees still
  takes gross on create with no approval (N-13 semantics).
