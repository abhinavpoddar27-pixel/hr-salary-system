# P2-11 — Backend role guards on unguarded write routes — PLAN (Phase 0)

Base: origin/main 80934af4 · Branch: fix/backend-route-guards · Port 3211
Findings: N-13 (POST /employees on create), N-11 / P1-10 F-c (night-shift confirm/reject), P4 follow-ups
(bulk-set-contractor, documents POST/DELETE, analytics auto-detect-left, import/upload), plus everything below.

## 1. How the list was built
- Every `router.post|put|patch|delete` in every router mounted in `backend/server.js` behind `requireAuth` only
  (38 routers, 208 write routes) was scanned for route middleware, a `router.use(...)` gate above it, or an in-handler
  role check (`req.user.role`, `roleIn`, `isAdmin`). Script-assisted, then each hit read by hand.
- Already gated, no change: attendanceReview / statutoryFlags (`router.use(requireAdmin)`), leaves.js (`router.use` role
  gate), queryTool (`router.use` admin), sales.js (own guards above L1139, `router.use(requireHrOrAdmin)` below), loans +
  loanImport (`allow(...)`), dailyWage, extraDutyGrants, financeVerification, lateComing, compOff, short-leaves,
  early-exits, early-exit-deductions, salary-input, phase5, reports, healthChecks, recordHistory, contractorReport,
  auth `/users` (inline admin), employees `PUT /bulk-shift` + settings `POST/PUT /shifts` (inline hr/admin),
  ai `POST /explain-salary` (inline hr/finance/admin), bug-reports admin routes.
- Usage: production `usage_logs` (read-only, counts by role/route only). Window: last 90 days (from 13 Jul 2026);
  logs start 17 Mar 2026, so the "older" column covers 17 Mar → 12 Jul. Active users: admin 1, hr 4, finance 1, viewer 1
  (no supervisor / employee users).

## 2. The routes (write, requireAuth only, no role check)
Roles: "90d" = roles that called it in the last 90 days (count); "older" = 17 Mar–12 Jul.

| # | Route | file:line | 90d | older | Proposed guard |
|---|---|---|---|---|---|
| 1 | POST /api/import/upload | import.js:40 | hr 38 | admin, hr | requireHrOrAdmin (BEFORE `upload.array`, so a refused file is never written) |
| 2 | POST /api/import/stage/:stage/complete | import.js:741 | — | — | requireHrOrAdmin |
| 3 | DELETE /api/import/:importId | import.js:759 | — | — | **requireAdmin** — deletes a month's raw + processed attendance, night pairs and day_calculations (Q2) |
| 4 | POST /api/import/reconciliation/update-departments | import.js:874 | — | hr | requireHrOrAdmin |
| 5 | POST /api/import/reconciliation/add-to-master | import.js:915 | — | hr | requireHrOrAdmin |
| 6 | POST /api/attendance/miss-punches/:id/resolve | attendance.js:149 | hr 929 | admin, hr | requireHrOrAdmin |
| 7 | POST /api/attendance/miss-punches/bulk-resolve | attendance.js:179 | hr 21 | (in 6) | requireHrOrAdmin |
| 8 | POST /api/attendance/night-shifts/:id/confirm | attendance.js:248 | — | — | requireHrOrAdmin (N-11) |
| 9 | POST /api/attendance/night-shifts/:id/reject | attendance.js:260 | — | — | requireHrOrAdmin (N-11) |
| 10 | PUT /api/attendance/record/:id | attendance.js:287 | hr 73 | admin, hr, **finance 2** | requireHrOrAdmin — **Q3** (finance used it before July) |
| 11 | PUT /api/attendance/record/:id/shift | attendance.js:522 | hr 3 | (in 10) | requireHrOrAdmin |
| 12 | POST /api/attendance/recalculate-metrics | attendance.js:594 | admin 1 | admin, hr, **finance 1** | requireHrOrAdmin — **Q3** |
| 13 | POST /api/attendance/deduplicate | attendance.js:682 | — | hr | requireHrOrAdmin |
| 14 | POST /api/employees | employees.js:290 | hr 11 | hr | requireHrOrAdmin (guard only; gross-on-create stays as is — Q5) |
| 15 | POST /api/employees/:code/documents | employees.js:958 | — | — | requireHrOrAdmin (before `docUpload`) |
| 16 | DELETE /api/employees/documents/:id | employees.js:1002 | — | — | requireHrOrAdmin |
| 17 | POST /api/employees/bulk-set-contractor | employees.js:1192 | — | — | requireHrOrAdmin (no UI caller) |
| 18 | POST /api/analytics/alerts/generate | analytics.js:263 | — | — | hr / finance / admin (both roles have the `alerts` page) |
| 19 | PUT /api/analytics/alerts/:id/read | analytics.js:277 | — | — | hr / finance / admin |
| 20 | POST /api/analytics/detect-inactive | analytics.js:350 | — | admin | requireHrOrAdmin (marks employees Left) |
| 21 | POST /api/analytics/auto-detect-left | analytics.js:380 | — | — | requireHrOrAdmin (marks employees Left; no UI caller) |
| 22 | POST /api/analytics/reactivate-employee | analytics.js:530 | — | — | requireHrOrAdmin (sets status Active) |
| 23 | POST /api/analytics/employee/:code/ai-review | analytics.js:851 | — | admin, hr | hr / finance / admin (finance has `employee-profile`; paid API call) |
| 24 | PUT /api/settings/holidays/audit-log/:id/review | settings.js:219 | — | — | requireFinanceOrAdmin (stamps `finance_reviewed`) |
| 25 | POST /api/advance/calculate | advance.js:10 | hr 13 | admin, hr | requireHrOrAdmin |
| 26 | PUT /api/advance/:id/mark-paid | advance.js:62 | hr 364 | admin, hr | requireHrOrAdmin |
| 27 | PUT /api/advance/batch-mark-paid | advance.js:79 | hr 1 | (in 26) | requireHrOrAdmin |
| 28 | PUT /api/advance/:id/set-remark | advance.js:121 | hr 934 | (in 26) | requireHrOrAdmin |
| 29 | PUT /api/advance/batch-remark | advance.js:143 | hr 1 | (in 26) | requireHrOrAdmin |
| 30 | POST /api/lifecycle | lifecycle.js:29 | — | — | requireHrOrAdmin |
| 31 | POST /api/finance-audit/day-correction | financeAudit.js:230 | — | — | hr / finance / admin (existing local `requireHrFinanceOrAdmin`) |
| 32 | POST /api/finance-audit/punch-correction | financeAudit.js:302 | — | — | hr / finance / admin (writes attendance_processed) |
| 33 | PUT /api/finance-audit/manual-flags/:id/verify | financeAudit.js:1143 | — | — | requireFinanceOrAdmin ("finance verifies") — Q6 |
| 34 | POST /api/jobs | jobs.js:5 | — | — | **requireAdmin** — any role can queue `salary_compute` / `day_calculate` / `leave_recalc` / `leave_nightly`; no UI caller (`createJob` unused) — Q4 |
| 35 | PUT /api/tax-declarations/:employeeCode | taxDeclarations.js:15 | — | — | hr / finance / admin (no UI caller) |

Left open on purpose (not changed): `PATCH /api/notifications/:id/read` + `/mark-all-read` (per-role read flag, every
role), `POST /api/session-analytics/events` (every role, viewer 11 calls), `POST /api/bug-reports` (every user may report),
`POST /api/daily-wage/entries/check-duplicates` (read-only lookup; hr 17), auth heartbeat / change-password / onboarding.

**No row is "OWNER RULING NEEDED" under the 90-day rule**: every proposed guard keeps every role that called the route in
the last 90 days. Two rows (10, 12) would drop finance, who called them before July — Q3.

### payroll.js — unguarded, DO NOT MODIFY here (for the owner)
| Route | file:line | 90d | Note |
|---|---|---|---|
| POST /api/payroll/calculate-days | payroll.js:14 | admin 30, hr 77, **finance 4** | any role (viewer too) can run Stage 6 |
| POST /api/payroll/compute-salary | payroll.js:127 | admin 30, hr 97, **finance 6** | any role can run Stage 7 |
| POST /api/payroll/finalise | payroll.js:761 | admin 2, finance 2 (all 4 refused) | only the stale-override is admin; otherwise any role; hr 7 older |
| PUT /salary/:code/manual-deductions, PUT /day-calculations/:code/late-deduction, POST /grant-extra-duty, DELETE /revoke-extra-duty/:id | 751 / 845 / 1646 / 1649 | hr 2 (late-deduction) | all answer 410 and write nothing — harmless |
Suggested owner follow-up: hr/finance/admin on calculate-days + compute-salary + finalise (keeps every 90-day caller).

## 3. The change (smallest)
- Add the guard as route middleware on each listed line — e.g. `router.post('/upload', requireHrOrAdmin, upload.array(...)`.
  Imports from `middleware/roles.js` (`requireHrOrAdmin`, `requireFinanceOrAdmin`, `requireAdmin`, `roleIn`).
  hr/finance/admin in analytics.js and taxDeclarations.js: a one-line local
  `const requireHrFinanceOrAdmin = (req, res, next) => roleIn(req,'admin','hr','finance') ? next() : res.status(403).json({ success:false, error:'HR, finance or admin access required' });`
  (roles.js has no such export and is not mine; financeAudit.js already has one at L574 — reuse it).
- Refused → 403 `{ success:false, error }` before any read or write, same body as the existing guards.
- No handler body, SQL, or money logic touched. No frontend change.

Files: import.js, attendance.js, employees.js, analytics.js, settings.js, advance.js, lifecycle.js, financeAudit.js,
jobs.js, taxDeclarations.js (guard lines + imports only). New: `backend/src/__tests__/backendRouteGuards.test.js`.

## 4. Tests
New `backendRouteGuards.test.js` — real `requireAuth`, real JWTs (pattern: employeeEditGrossGuard / markLeftRoleGuard),
scratch DB, the real routers mounted as in server.js. For every route in §2: each excluded role (viewer, supervisor,
employee, and finance/hr where excluded) → 403 and the guarded table unchanged (row-count / hash check on the table the
route writes); each allowed role → NOT 403 (reaches the handler; 200 or the handler's own 400/404 with a minimal body).
Upload routes: refused role → 403 and no file left in the uploads dir. Anonymous → 401. Then full suite (flock) before
and after; expect existing tests unchanged (they call these routes as admin / hr — checked: earlyExitGatePass uses admin
for recalculate-metrics; statutoryWriters / employeeBankColumns use hr/admin for writes).
Live check: `backend/scripts/route-guards-check.js` on port 3211 (real server.js, real logins): viewer + finance hit a
sample of guarded routes → 403, hr/admin → unchanged; `--base` on an origin/main worktree shows viewer getting 200.

## 5. Risks
- A screen a refused role can still open shows a button that now 403s: Import (finance has no `import` page — ok),
  Settings holiday review (hr has no Settings — ok), FinanceAudit manual-flag verify (hr has `finance-audit`; if hr ever
  clicks Verify → 403, Q6). Frontend hiding = follow-up list, not this PR.
- Rows 10/12 for finance (Q3). Row 3 admin-only (Q2) — hr loses "delete an import" (0 calls ever).
- Job worker / schedulers call services directly, not these routes — unaffected.

## 6. Questions for the planner
- **Q1** Approve the table as proposed (35 routes)?
- **Q2** DELETE /api/import/:id → admin only, or hr + admin? (0 calls ever; wipes a whole month's attendance + day calc.)
- **Q3** PUT /attendance/record/:id and POST /recalculate-metrics → hr + admin drops finance (finance used them 2× and 1×
  before July, 0 in 90 days). OK, or keep finance on them?
- **Q4** POST /api/jobs → admin only (no UI caller), or hr + admin?
- **Q5** POST /api/employees still accepts gross_salary + components on create with no approval (N-13 / P1-25 "found").
  Guard only here, semantics left — confirm out of scope.
- **Q6** manual-flags verify → finance + admin only (hr has the Finance Audit page but 0 calls), or hr/finance/admin?
- **Q7** payroll.js calculate-days / compute-salary / finalise stay open (DO NOT MODIFY) — listed for the owner; OK?
