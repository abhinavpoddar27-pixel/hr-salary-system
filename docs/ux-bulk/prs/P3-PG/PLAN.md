# P3-PG — role guard on payroll Stage 6 / Stage 7 / finalise routes

Branch `fix/payroll-stage-role-guard` (on origin/main 8abee969). Port 3402. MONEY / PROTECTED-FILE PR — owner approved
this edit of `payroll.js` on 12 Oct 2026. Independent review before the PR.

## 1. Finding (CLAUDE.md P2-11 "Owner list"; P2-11 PLAN.md §payroll.js, Q7)
`app.use('/api/payroll', requireAuth, …)` (server.js:198) is the only gate on:
| Route | Line | Today |
|---|---|---|
| POST /api/payroll/calculate-days | payroll.js:14 | any logged-in role (viewer, supervisor, employee login) runs Stage 6 for the whole month |
| POST /api/payroll/compute-salary | payroll.js:127 | any logged-in role runs Stage 7 (rewrites salary_computations, posts provisional loan rows) |
| POST /api/payroll/finalise | payroll.js:761 | any role reaches the finance sign-off check and, if signed off, finalises the month; only the stale override is admin |

Usage (planner, prod usage_logs, 90 d, POST): calculate-days hr 77 / admin 33 / finance 5; compute-salary hr 97 / admin 34 /
finance 8; finalise admin 2 / finance 2 (P2-11 also saw hr 7 older). No other role. Owner ruling: hr + finance + admin on all
three → drops nobody.

## 2. Smallest change (payroll.js — guard lines + the import only)
- Line 6: keep `const { requireFinanceOrAdmin, roleIn } = require('../middleware/roles');` (roleIn already imported). Add ONE
  local line under the imports, the exact form P2-11 used in attendance.js / analytics.js / taxDeclarations.js (roles.js has no
  export for this set and is not owned):
  `const requireHrFinanceOrAdmin = (req, res, next) => (roleIn(req, 'admin', 'hr', 'finance') ? next() : res.status(403).json({ success: false, error: 'HR, finance or admin access required' }));`
  (same 403 body shape `{success:false, error}` as middleware/roles.js; same text as P2-11's local helpers.)
- `router.post('/calculate-days', requireHrFinanceOrAdmin, (req, res) => {`
- `router.post('/compute-salary', requireHrFinanceOrAdmin, (req, res) => {`
- `router.post('/finalise', requireHrFinanceOrAdmin, (req, res) => {`
Nothing else in payroll.js changes: handler bodies, the admin stale-override, the sign-off gate, other routes untouched.
The guard runs before `getDb()` / body parsing in the handler → a refused call writes nothing (no 400 leak about missing month).
Roles go through `normalizeRole` (legacy "Finance Team" / "HR Manager" still pass; blank / unknown → viewer → 403).

Not routed through this guard (unchanged, by design): job queue `salary_compute` / `day_calculate` (POST /jobs is admin only
since P2-11), reimport recompute (import upload is hr+admin), nightly leave sweep (server-side).

## 3. Tests
**New `backend/src/__tests__/payrollStageRoleGuard.test.js`** — `startJwtApi({'/api/payroll': routes/payroll})` (real
requireAuth, real JWTs), users admin / hr / finance / viewer / supervisor / employee, plus a legacy "Finance Team" role.
Fictional seed (one employee T9xxx, one month of attendance, monthly_imports row) so the handlers really run.
- viewer / supervisor / employee × 3 routes → 403, body `{success:false, error:'HR, finance or admin access required'}`;
  row count + content hash of `day_calculations`, `salary_computations`, `monthly_imports` (and `audit_log` count) identical
  before/after each refused call. Refused with a VALID body (month/year) so the 403 is proven to come before the handler.
- no token → 401 (requireAuth, unchanged).
- hr / finance / admin / "Finance Team": calculate-days → 200 + day_calculations row written; compute-salary → 200 +
  salary_computations row; finalise → not 403 (400 stale / 403 `requiresFinanceApproval` from the existing sign-off gate,
  then 200 once a `finance_month_signoff` approved row is seeded). The sign-off 403 is distinguished by
  `requiresFinanceApproval: true`, not confused with the role 403.
- Stale override still admin-only (hr/finance with a reason → 400 `overridable:false`).
- Prove on base: run the new file against origin/main 8abee969 (worktree) → the refused-role cases fail there.

**New `backend/scripts/payroll-stage-guard-check.js`** — boots real `server.js` on port 3402 with a scratch DATA_DIR, real
`/api/auth/login` for admin/hr/finance/viewer (+ a fictional supervisor user), drives the three routes, checks 403 vs not-403
and table checksums via the scratch DB; `--base` against an 8abee969 worktree shows viewer reaching 200. Pattern:
`backend/scripts/route-guards-check.js` (login limiter 5/15 min per IP → restart server between sections, as P2-08 noted).

**Regression:** full jest before and after (`flock /tmp/jest.lock npx jest`), plus `backendRouteGuards.test.js` and
`route-guards-check.js` unchanged and green; existing payroll tests (recomputeParity, holdRelease*, legacy*, finalise stale).

## 4. P2-11 artefacts
`backendRouteGuards.test.js` and `scripts/route-guards-check.js` do NOT list these three routes (grep: no `payroll`,
`calculate-days`, `compute-salary`, `finalise`). Only P2-11's PLAN.md lists them as "left open for the owner" (Q7) — a doc,
not a test. No change needed to merged P2-11 files.

## 5. Frontend callers (read only — no frontend change)
- `DayCalculation.jsx:118` `calculateDays` (Run / Recalculate), `SalaryComputation.jsx:96` `computeSalary`, `:129`
  `finaliseSalary` — via `utils/api.js:106/110/114`. Stage 6/7 pages are reachable through `/pipeline/*` routes for any logged
  in user; buttons are not role-gated in the UI. hr/finance/admin unaffected. viewer/supervisor (no `pipeline` permission in
  permissions.js, so no sidebar link) would now get the 403 toast from the global error handler if they deep-link and click.
  Follow-up (not this PR, file not owned): hide Run/Compute/Finalise for roles outside hr/finance/admin.

## 6. Risks
- Money file: change is 4 lines; reviewer can diff `git diff origin/main -- backend/src/routes/payroll.js` = exactly those.
- A real user whose stored role is something unnormalisable (→ viewer) and who runs payroll today would be locked out —
  usage_logs show none in 90 days.
- Tests that call these routes with a stubbed `req.user` of another role? Will grep all __tests__ for the three paths
  and run them; any failure is reported, not "fixed" by widening the guard.

## 7. Questions for the planner
- Q1: Local one-line helper in payroll.js (P2-11 pattern) rather than a new export in roles.js (not owned) — OK?
- Q2: 403 text "HR, finance or admin access required" (same as P2-11's local helpers) — OK?
- Q3: finalise for hr — owner ruling includes hr (hr used it before the 90-day window). Confirm hr stays allowed.
