# P2-10 + P8-06 — one permissions source for nav / routes / Header; 404 page; one product name + build version

Branch `feat/permissions-nav-guard` (on origin/main 8abee969) · Port 3403 · Findings X-2, X-8, X-15, X-16.
Status: **built** (rulings 12 Oct in PROGRESS.md). Fail-open keeps admin-only pages refused (ADMIN_ONLY_KEYS).

## 1. What is there today (FACT, read on 8abee969)
- `backend/src/config/permissions.js` holds a role → page-key matrix. `GET /api/auth/permissions` returns
  `{success, role, permissions}` for the logged-in user (normalised role). Only `requirePermission(...)` in
  `routes/sales.js` reads the matrix on the server; every other route uses its own role check (or none for reads).
  `getUserPermissions()` already exists in `utils/api.js` and has **no caller** (I can import it — no api.js edit).
- `Sidebar.jsx`: visibility is 6 hand-written flags (`adminOnly`, `financeOnly`, `hrFinanceOrAdmin`, `salesAllowed`,
  `tadaApprover`, `loansRead`) checked twice (item + child filter). Items without a flag show to **every** role.
- `App.jsx`: every route is `RequireAuth` only — any logged-in role opens any page by URL. `path="*"` →
  `<Navigate to="/">` (silent redirect, X-15).
- `Header.jsx`: user menu "Settings" → `/settings/policy` for every role (X-8). Fallback title "HR & Salary System".
- Product name (X-16): Login "HR Intelligence Platform" + footer "HR & Salary Processing System v1.0"; Sidebar
  "Asian Lakto / HR & Payroll System" + footer "Indriyan Beverages / v1.1.0"; index.html "HR & Salary System —
  Indriyan Beverages / Asian Lakto Ind. Ltd."; both package.json are 1.0.0. Two different hard-coded versions.
- `Settings.jsx` has **no** page-level admin gate: HR can open it and edit shifts (Shift Master start/duration is an
  HR task per CLAUDE.md; grace is admin-only inside the page). `Analytics.jsx` already hides the Attendance Review
  tab for non-admin.

## 2. Read-only diagnostics (scratch DB, built dist, 5 roles, script `phase0-diag.py`)
Sidebar labels collected per role with every parent expanded; every nav route visited; API responses ≥ 400 logged.
Visible items today: admin 75 · hr 56 · finance 55 · viewer 47 · supervisor 46. Header "Settings": all 5 roles.

Server 403s seen on page load (empty scratch DB, so pages that wait for a month/company pick fire nothing):
| Page | viewer | supervisor | hr | finance |
|---|---|---|---|---|
| Finance Audit | 4 × 403 (comp-off pending, ED/early-exit pending, leave-requests, late-coming pending) | same 4 | 1 × 403 comp-off/pending | — |
| Analytics → Early Exit | 4 × 403 (whole tab empty) | 4 × 403 | — | — |
| Stage 6 Day Calc | 403 leave-requests | 403 | — | — |
| Stage 7 Salary | 403 features/salary-stale | 403 | — | — |
| Loans, Loan detail | — | 403 (already hidden in nav) | — | — |
| Leave Management | — | 403 GET /leaves | — | — |
| Sales Employees (URL only, hidden in nav) | 403 | 403 | — | 403 |
| TA/DA Approvals (URL only) | 403 | 403 | — | — |
| Query Tool (URL only) | 403 | 403 | 403 | 403 |
| Daily MIS | — | 403 leaves/on-leave-today | — | — |
Every role: `401 POST /api/session-analytics/events` on every load (known, P1-12 note; not this PR).

Production (read-only, counts only): active users admin 1, hr 4, finance 1, viewer 1, supervisor 0.
Page views last 90 days (session_events): finance uses Import, Shift Check, Night Shift, Corrections, Day Calc,
Leave Management, Daily MIS, Analytics, Salary Advance, Workforce report, Daily Wage — **none of these are in the
finance matrix**. HR uses Extra Duty (297), Finance Verify (35), Payable OT (22) — **not in the hr matrix**.
Viewer: 6 views (Dashboard 2, Miss Punch 1, Finance Audit 1, Held Salaries 1 old URL, Login 1).
⇒ The matrix as it stands is stale. Gating the nav on it unchanged would remove pages HR and finance use daily.

## 3. Proposal
### 3.1 Make the matrix true (needs ruling Q1 — owned file "only if a key is missing — ask first")
`permissions.js` additions only (no key removed, no sales key touched → `requirePermission` in sales.js unchanged):
- hr += `finance-verification`, `extra-duty-grants`, `payable-ot`, `contractor-report`, `salary-explainer`
- finance += `daily-mis`, `import`, `shift-verify`, `night-shift`, `corrections`, `day-calc`, `salary-advance`,
  `leave-management`, `workforce`, `analytics`, `contractor-report`, `daily-wage-finance`, `salary-explainer`
- New keys (`contractor-report`, `salary-explainer`, `daily-wage-finance`) replace the hand-written flags
  `hrFinanceOrAdmin` / `financeOnly`. Admin-only items use keys no role lists (`settings`, `sql-console`,
  `query-tool`, `bug-reports`, `record-history`, `statutory-flags`, `session-analytics`, `attendance-review`)
  → only admin (`*`).
With these, **admin, hr and finance see exactly what they see today** (table below).

### 3.2 Frontend
- NEW `hooks/usePermissions.js`: `useQuery(['auth-permissions', token, username, role], getUserPermissions,
  {staleTime: Infinity, enabled: isAuthenticated})` → `{ ready, failed, can(key), canAny(keys) }`. `'*'` = all.
  Query key carries token + role, so a login as someone else or the `/auth/me` role refresh refetches (P1-12 case).
  Also exports `PAGE_KEYS` (path → key) so Sidebar and App use one map.
- `Sidebar.jsx`: each item gets `perm: '<key>'`; the 6 flags and `LOAN_READ_ROLES` go; one `isVisible(item)` =
  `can(item.perm)`; a parent shows if it has a visible child. All hooks stay above `if (hidden) return null`
  (P1-12). Badges keep their own role checks (unchanged). Before permissions load: gated items not rendered
  (Dashboard always) — no flash of items that then disappear.
- `App.jsx`: a `Guard perm=…` wrapper inside `Layout` → `PageLoader` while loading, `<NoAccess/>` when `!can`,
  else the page. Same key as the nav item. Extra routes: `/loans/:id` → loans; `/sales/payslip/:code` →
  `sales-register`; `/admin/bug-reports/:id` → bug-reports; `/workforce/*` → workforce; `/analytics/*` →
  canAny(analytics, late-coming, early-exit); `/settings/*` → see Q3; `/pipeline` redirect unchanged.
- NEW `components/NoAccess.jsx`: "You don't have access to this page" + role + "Go to Dashboard" link. No toast,
  no redirect, no API call.
- `Header.jsx`: "Settings" item only when `can('settings')` (admin). Hook call at the top (P1-12).
- NEW `pages/NotFound.jsx` (P8-06): `path="*"` → inside `RequireAuth` + `Layout`: "Page not found" + the URL +
  "Go to Dashboard". Signed-out unknown URL → login → back to the same URL → 404 (P2-08 return path).
- One product name (Q4) in Login (h1 + footer), Sidebar logo + footer, index.html `<title>`, Header fallback.
- Build version: `vite.config.js` `define: { __APP_VERSION__: frontend package.json version,
  __BUILD_SHA__: RAILWAY_GIT_COMMIT_SHA → SOURCE_COMMIT → GIT_COMMIT → \`git rev-parse --short HEAD\` → 'dev' }`
  (same env chain as backend `/api/version`; first 7 chars). Shown as "v1.0.0 · abc1234" on Login footer and
  Sidebar footer. No hard-coded version left.

### 3.3 Error / fail behaviour
- Permissions request fails (network / 5xx): nav and routes **fail open** to today's behaviour? → Q2.
  My recommendation: retry once; then show nav items and pages as allowed (server is the real guard) plus a small
  amber line in the sidebar footer "Couldn't load your access — showing all pages". A 401 is handled by api.js.

## 4. Role × nav-item table — BEFORE (measured) vs AFTER (proposal 3.1 + Q5 option A)
✓ = shown before and after · · = hidden before and after · **−HIDE** = shown today, hidden after · **+ADD** none.
| Nav item | key | admin | hr | finance | viewer | supervisor |
|---|---|---|---|---|---|---|
| Dashboard | `dashboard` | ✓ | ✓ | ✓ | ✓ | ✓ |
| Daily MIS | `daily-mis` | ✓ | ✓ | ✓ | ✓ | ✓ |
| Payroll (parent) | `*any-child` | ✓ | ✓ | ✓ | ✓ | **−HIDE** |
| 1. Import | `import` | ✓ | ✓ | ✓ | **−HIDE** | **−HIDE** |
| 2. Miss Punches | `miss-punch` | ✓ | ✓ | ✓ | **−HIDE** | **−HIDE** |
| 3. Shift Check | `shift-verify` | ✓ | ✓ | ✓ | **−HIDE** | **−HIDE** |
| 4. Night Shift | `night-shift` | ✓ | ✓ | ✓ | **−HIDE** | **−HIDE** |
| 5. Corrections | `corrections` | ✓ | ✓ | ✓ | **−HIDE** | **−HIDE** |
| 6. Day Calc | `day-calc` | ✓ | ✓ | ✓ | **−HIDE** | **−HIDE** |
| 7. Salary | `salary` | ✓ | ✓ | ✓ | **−HIDE** | **−HIDE** |
| Held Salaries Register | `held-salaries-register` | ✓ | ✓ | ✓ | **−HIDE** | **−HIDE** |
| Salary Advance | `salary-advance` | ✓ | ✓ | ✓ | **−HIDE** | **−HIDE** |
| Payable OT | `payable-ot` | ✓ | ✓ | ✓ | **−HIDE** | **−HIDE** |
| Salary Input | `salary-input` | ✓ | ✓ | ✓ | **−HIDE** | **−HIDE** |
| Loans | `loans` | ✓ | ✓ | ✓ | ✓ | · |
| Leave Management | `leave-management` | ✓ | ✓ | ✓ | **−HIDE** | **−HIDE** |
| Workforce (parent) | `*any-child` | ✓ | ✓ | ✓ | **−HIDE** | **−HIDE** |
| Headcount & Composition | `workforce` | ✓ | ✓ | ✓ | **−HIDE** | **−HIDE** |
| Hiring & Attrition | `workforce` | ✓ | ✓ | ✓ | **−HIDE** | **−HIDE** |
| Contractor Management | `workforce` | ✓ | ✓ | ✓ | **−HIDE** | **−HIDE** |
| Contractor Report | `contractor-report` | ✓ | ✓ | ✓ | · | · |
| Attendance Analytics (parent) | `*any-child` | ✓ | ✓ | ✓ | **−HIDE** | **−HIDE** |
| Overview | `analytics` | ✓ | ✓ | ✓ | **−HIDE** | **−HIDE** |
| Absenteeism | `analytics` | ✓ | ✓ | ✓ | **−HIDE** | **−HIDE** |
| Punctuality | `late-coming` | ✓ | ✓ | ✓ | **−HIDE** | **−HIDE** |
| Overtime | `analytics` | ✓ | ✓ | ✓ | **−HIDE** | **−HIDE** |
| Working Hours | `analytics` | ✓ | ✓ | ✓ | **−HIDE** | **−HIDE** |
| Early Exit | `early-exit` | ✓ | ✓ | ✓ | **−HIDE** | **−HIDE** |
| Attendance Review | `attendance-review` | ✓ | · | · | · | · |
| Late Coming | `late-coming` | ✓ | ✓ | ✓ | **−HIDE** | **−HIDE** |
| Compliance (parent) | `*any-child` | ✓ | ✓ | ✓ | **−HIDE** | **−HIDE** |
| PF Compliance | `compliance` | ✓ | ✓ | ✓ | **−HIDE** | **−HIDE** |
| ESI Compliance | `compliance` | ✓ | ✓ | ✓ | **−HIDE** | **−HIDE** |
| Labour Law | `compliance` | ✓ | ✓ | ✓ | **−HIDE** | **−HIDE** |
| Compliance Calendar | `compliance` | ✓ | ✓ | ✓ | **−HIDE** | **−HIDE** |
| Reports | `reports` | ✓ | ✓ | ✓ | ✓ | **−HIDE** |
| Finance Audit | `finance-audit` | ✓ | ✓ | ✓ | **−HIDE** | **−HIDE** |
| Finance Verify | `finance-verification` | ✓ | ✓ | ✓ | **−HIDE** | **−HIDE** |
| Extra Duty | `extra-duty-grants` | ✓ | ✓ | ✓ | **−HIDE** | **−HIDE** |
| Alerts | `alerts` | ✓ | ✓ | ✓ | **−HIDE** | **−HIDE** |
| Employees | `employees` | ✓ | ✓ | ✓ | **−HIDE** | **−HIDE** |
| Daily Wage (parent) | `*any-child` | ✓ | ✓ | ✓ | **−HIDE** | **−HIDE** |
| DW Records | `daily-wage` | ✓ | ✓ | ✓ | **−HIDE** | **−HIDE** |
| DW New Entry | `daily-wage` | ✓ | ✓ | ✓ | **−HIDE** | **−HIDE** |
| DW Batch Import | `daily-wage` | ✓ | ✓ | ✓ | **−HIDE** | **−HIDE** |
| DW Contractors | `daily-wage` | ✓ | ✓ | ✓ | **−HIDE** | **−HIDE** |
| DW Reports | `daily-wage` | ✓ | ✓ | ✓ | **−HIDE** | **−HIDE** |
| DW Finance Review | `daily-wage-finance` | ✓ | · | ✓ | · | · |
| DW Payments | `daily-wage-finance` | ✓ | · | ✓ | · | · |
| DW Dashboard | `daily-wage-finance` | ✓ | · | ✓ | · | · |
| DW Audit Log | `daily-wage-finance` | ✓ | · | ✓ | · | · |
| Sales (parent) | `*any-child` | ✓ | ✓ | ✓ | · | · |
| Sales Employees | `sales-employees` | ✓ | ✓ | · | · | · |
| Sales Holidays | `sales-holidays` | ✓ | ✓ | · | · | · |
| Upload Sheet | `sales-upload` | ✓ | ✓ | · | · | · |
| Compute Salaries | `sales-compute` | ✓ | ✓ | · | · | · |
| TA/DA Register | `sales-tada-compute` | ✓ | ✓ | · | · | · |
| TA/DA Upload | `sales-tada-compute` | ✓ | ✓ | · | · | · |
| TA/DA Approvals | `sales-tada-approve` | ✓ | · | ✓ | · | · |
| Employee Profile | `employee-profile` | ✓ | ✓ | ✓ | **−HIDE** | **−HIDE** |
| Dept Analytics | `dept-analytics` | ✓ | ✓ | ✓ | **−HIDE** | **−HIDE** |
| Salary Explainer | `salary-explainer` | ✓ | ✓ | ✓ | · | · |
| Session Analytics | `session-analytics` | ✓ | · | · | · | · |
| Query Tool | `query-tool` | ✓ | · | · | · | · |
| SQL Console | `sql-console` | ✓ | · | · | · | · |
| Bug Reports | `bug-reports` | ✓ | · | · | · | · |
| Record History | `record-history` | ✓ | · | · | · | · |
| Statutory Flags | `statutory-flags` | ✓ | · | · | · | · |
| Settings (parent) | `settings` | ✓ | · | · | · | · |
| Shift Master | `settings` | ✓ | · | · | · | · |
| Holiday Master | `settings` | ✓ | · | · | · | · |
| Policy Config | `settings` | ✓ | · | · | · | · |
| Audit Trail | `settings` | ✓ | · | · | · | · |
| Usage Logs | `settings` | ✓ | · | · | · | · |
| User Management | `settings` | ✓ | · | · | · | · |


### 4.1 Every visible difference, per role
- **admin**: none in the sidebar. New: unknown URL → 404 page (was silent redirect to Dashboard). Name/version.
- **hr**: sidebar none. Header user menu loses "Settings" (X-8). `/settings/*` by URL: see Q3. URL-only pages hr
  is not given (Query Tool, SQL Console, Bug Reports, Record History, Statutory Flags, Session Analytics, TA/DA
  Approvals, DW finance pages, Attendance Review) → "You don't have access" instead of a half-empty page / 403s.
- **finance**: sidebar none. Header loses "Settings". URL-only: Sales HR pages (Sales Employees 403s today),
  Query Tool etc. → NoAccess.
- **viewer** (1 user in production): sidebar 47 → 5 items — Dashboard, Daily MIS, Payroll ▸ Loans, Reports.
  Hidden: all 7 pipeline stages, Held Salaries, Salary Advance, Payable OT, Salary Input, Leave Management,
  Workforce, Attendance Analytics (incl. Early Exit which 403s), Late Coming, Compliance, Finance Audit (403s),
  Finance Verify, Extra Duty, Alerts, Employees, Daily Wage, Employee Profile, Dept Analytics. Header "Settings" gone.
  Opening those URLs → NoAccess. (Viewer opened Miss Punch and Finance Audit once each in 90 days.)
- **supervisor** (0 users in production): sidebar 46 → 2 items — Dashboard, Daily MIS. Everything else NoAccess.
- **all roles**: unknown URL → 404 page; one product name; build version from the build.

## 5. Files
Edit: `frontend/src/App.jsx`, `frontend/src/components/layout/Sidebar.jsx`, `frontend/src/components/layout/Header.jsx`,
`frontend/src/pages/Login.jsx` (name + version line only), `frontend/index.html` (title only),
`frontend/vite.config.js` (define only), `backend/src/config/permissions.js` (additions only — **after Q1**).
New: `frontend/src/hooks/usePermissions.js`, `frontend/src/components/NoAccess.jsx`, `frontend/src/pages/NotFound.jsx`,
`backend/scripts/permissions-nav-check.py`, `backend/src/__tests__/permissionsMatrix.test.js` (pins the additions:
admin/hr/finance keep every key they had; `/auth/permissions` per role), docs here.
Not touched: `utils/api.js` (import `getUserPermissions` only), every page file, every route except none.

## 6. Tests
- jest full suite before/after (flock). New `permissionsMatrix.test.js`: matrix additions; old keys all kept;
  `requirePermission` sales keys unchanged per role; GET /auth/permissions for 5 roles with real JWTs.
- `backend/scripts/permissions-nav-check.py` (Chromium, built dist, scratch DB, real logins for 5 roles — restarts the
  server between roles because of the 5/15-min login limiter; port 3403):
  sidebar label set per role == AFTER table (admin/hr/finance == BEFORE exactly); every nav route opens without
  NoAccess for allowed roles; each disallowed route shows NoAccess, 0 API requests to that page's endpoints, no toast;
  Header Settings admin only; `/no-such-page` → 404 with home link (signed in) and login → back → 404 (signed out);
  in-place role switch via intercepted `/auth/me` (P1-12 pattern) → nav follows, no hook error; permissions 500 →
  fail-open behaviour per Q2; title + Login + Sidebar name identical; version text = build define (not "v1.1.0");
  390 px drawer; 0 page errors. `--base` on an 8abee969 build: viewer sees 47 items, Header Settings for hr,
  `/no-such-page` lands on `/`.

## 7. Risks
- R1 Stale matrix — mitigated by 3.1; if the planner prefers not to touch permissions.js, the only way to keep
  hr/finance unchanged is a frontend-side map, i.e. a second source (defeats X-2).
- R2 Matrix changes for finance/hr widen nothing on the server except `requirePermission` callers (sales.js, sales
  keys only — none added). Verified by grep: no other server reader.
- R3 Hiding pages for viewer is cosmetic: most GETs behind those pages have no role guard (viewer can read the
  salary register through the API). Data exposure finding for P2-11/backend — not fixed here.
- R4 Loading flash: gated items/pages wait for one small request; staleTime Infinity per user.
- R5 Analytics sub-tabs (Overview/Absenteeism/…) are one route; the route is opened if any of the three keys
  is held; tab-level hiding inside Analytics.jsx is not mine (only nav children are gated).
- R6 Vite define of the git SHA: Railway build may have no `.git`; RAILWAY_GIT_COMMIT_SHA is set at build time on
  Railway (backend already relies on it at runtime). Fallback 'dev'.

## 8. Questions for the planner
- **Q1** May I add the keys in 3.1 to `permissions.js` (additions only)? Without them HR loses Extra Duty / Finance
  Verify / Payable OT and finance loses Stages 1,3,4,5,6, Leave, Daily MIS, Analytics, Workforce, Salary Advance.
- **Q2** Permissions request fails: fail open (recommended, with the amber line) or fail closed (Dashboard only)?
- **Q3** `/settings/*` for HR: HR opens Settings today (Shift Master edits are an HR task; 1 visit in 90 days).
  (a) admin only — HR gets NoAccess (strict X-8); (b) give hr a `settings-shifts` key and keep the route open to hr
  while nav + Header Settings stay admin-only; (c) keep `/settings/*` open to everyone by URL as today.
  Recommendation (a) unless the owner says HR edits shifts — then (b).
- **Q4** One product name: "HR & Salary System" (already the Header fallback + start of the title)? Sidebar logo
  sub-line keeps the company ("Indriyan Beverages · Asian Lakto")?
- **Q5** viewer/supervisor: (A) the matrix as is (table above — viewer 5 items, supervisor 2) — recommended; or
  (B) only hide pages that 403 for them (Finance Audit, Early Exit, Leave for supervisor) and keep the rest.
- **Q6** Version text: "v1.0.0 · abc1234" (package version + short SHA) on Login and Sidebar footer — OK?
