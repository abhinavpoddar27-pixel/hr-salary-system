# P2-10 — Permissions source for nav, routes and Header Settings (X-2, X-8)

Branch `feat/permissions-nav-routes` (from origin/main 8abee96). Pushed, PR not opened (planner opens it).

## RESUME
1. Read this file. 2. `git log --oneline origin/main..HEAD`. 3. Everything below "State" is done; only owner questions remain.

## State
- [x] Survey of today's reach (built origin/main dist, every role × route, API status) — table below
- [x] Page-key mapping (route → key) — `frontend/src/utils/permissions.js` `ROUTE_KEYS`, listed below
- [x] permissions.js keys added only where a role already reached the page
- [x] frontend helper + Sidebar + App route guard + Header Settings
- [x] jest `authPermissionsMatrix.test.js` 15 (2 fail on the old matrix); full suite 115/2040 → 116/2055
- [x] `backend/scripts/permissions-nav-check.py` 184/184; `--base` on origin/main 5/5
- [x] pushed

## What changed
- **No new endpoint.** `GET /api/auth/permissions` (auth.js) and `getUserPermissions` (api.js) already existed and had no
  caller. auth.js, api.js and appStore.js are untouched.
- `backend/src/config/permissions.js`: page keys added per role (below). The backend reads only the `sales-tada-*` keys
  (requirePermission); those are unchanged, so **no API access changed**.
- `frontend/src/utils/permissions.js` (new): `ROUTE_KEYS` (route prefix → page keys, any one opens; longest prefix wins;
  unknown path refused except for admin '*'), `keysForPath`, `hasKey`, `canOpenPath`, `usePermissions()` →
  `{ready, failed, retry, role, can(key), canPath(path)}`. react-query key `['auth-permissions', username, role]`,
  staleTime Infinity, retry 2. A role changed in place (the /auth/me refresh) fetches again.
- `Sidebar.jsx`: the flags `adminOnly`, `financeOnly`, `hrFinanceOrAdmin`, `salesAllowed`, `tadaApprover`, `loansRead`
  and `LOAN_READ_ROLES` are gone. An item shows when `canPath(item.to)`; an item with `perm` uses that key; a parent shows
  when any child shows. Only two items carry `perm` (their menu key differs from their route): **Late Coming**
  (`late-coming`, route /analytics/punctuality also opens with `analytics`) and **TA/DA Approvals**
  (`sales-tada-approve`; the URL also opens with `sales-tada-request` because HR can read the list today), plus the
  **Salary Explainer** action (`salary-explainer`, no route). Until permissions are in, the menu is empty; on failure a
  small "Couldn't load the menu · Retry". All hooks stay above the `if (hidden) return null` (P1-12).
- `App.jsx`: `PageGate` inside `Layout` (inside ErrorBoundary/Suspense). Not ready → page loader (page not mounted);
  failed → "Couldn't load what your role can open … Try again"; refused → `NoAccess`: "You don't have access to this
  page — Your role (x) can't open this page. Ask an admin if you need it." + "Go to Dashboard". The page component never
  mounts, so it sends none of its API calls. No redirect.
- `Header.jsx`: "Settings" in the user menu only when `can('settings')` (admin) — X-8.

## Route → page key
| Route | Key(s) | | Route | Key(s) |
|---|---|---|---|---|
| `/` | dashboard | | `/compliance/*` | compliance |
| `/daily-mis` | daily-mis | | `/reports` | reports |
| `/pipeline` (redirect), `/pipeline/import` | import | | `/finance-audit` | finance-audit |
| `/pipeline/miss-punch` | miss-punch | | `/finance-verification` | finance-verification |
| `/pipeline/shift-check` | shift-verify | | `/extra-duty-grants` | extra-duty-grants |
| `/pipeline/night-shift` | night-shift | | `/alerts` | alerts |
| `/pipeline/corrections` | corrections | | `/employees` | employees |
| `/pipeline/day-calc` | day-calc | | `/daily-wage`, `/new`, `/import`, `/contractors`, `/reports` | daily-wage |
| `/pipeline/salary` | salary | | `/daily-wage/finance/*`, `/daily-wage/audit` | daily-wage-finance (new) |
| `/held-salaries` | held-salaries-register | | `/sales/employees` | sales-employees |
| `/salary-advance` | salary-advance | | `/sales/holidays` | sales-holidays |
| `/payable-ot` | payable-ot | | `/sales/upload` | sales-upload |
| `/salary-input` | salary-input | | `/sales/compute` | sales-compute |
| `/loans`, `/loans/:id` | loans | | `/sales/payslip/:code` | sales-register |
| `/leave-management` | leave-management | | `/sales/ta-da-register`, `/sales/ta-da-upload` | sales-tada-compute |
| `/workforce/*` | workforce | | `/sales/ta-da-approvals` | sales-tada-approve or sales-tada-request (menu: approve only) |
| `/workforce/contractor-report` | contractor-report (new) | | `/employee-profile` | employee-profile |
| `/analytics/*` | analytics | | `/dept-analytics` | dept-analytics |
| `/analytics/punctuality` | analytics or late-coming (menu "Late Coming": late-coming) | | `/session-analytics` | session-analytics (new, admin) |
| `/analytics/early-exit` | early-exit | | `/admin/query-tool`, `/sql-console`, `/bug-reports(/:id)`, `/record-history`, `/statutory-flags` | one key each (new, admin) |
| `/analytics/attendance-review` | attendance-review (new, admin) | | `/settings/*` + Header Settings | settings (new, admin) |
| Salary Explainer (menu action) | salary-explainer (new) | | | |

## Keys added to the matrix (and why)
Rule applied: a key goes to a role only if, before P2-10, that role could open the page and its data loaded (survey
below). Admin-only keys are not listed for any role (admin has `*`).
- **hr** + `payable-ot`, `finance-verification`, `extra-duty-grants`, `contractor-report`, `salary-explainer` — the menu
  showed them to HR and their data loads for HR (extra duty: HR creates grants).
- **finance** + `daily-mis`, `import`, `shift-verify`, `night-shift`, `corrections`, `day-calc`, `salary-advance`,
  `leave-management`, `workforce`, `contractor-report`, `analytics`, `daily-wage-finance`, `salary-explainer` — same reason.
- **viewer** + 24 read pages (pipeline stages, held, advance, payable OT, salary input, leave, workforce, analytics,
  late coming, compliance, finance audit, finance verify, extra duty, alerts, employees, daily wage, profile, dept analytics).
- **supervisor** + the viewer list without loans and leave (their data is refused) plus reports.
- **employee** + the supervisor list (an employee login opens the same layout and reads the same pages today; 0 such users).
- New keys: `contractor-report`, `daily-wage-finance`, `salary-explainer` (granted), `attendance-review`,
  `session-analytics`, `query-tool`, `sql-console`, `bug-reports`, `record-history`, `statutory-flags`, `settings`
  (admin only) — the matrix had no key for these pages.

## Role × page, before → after
Survey: built dist, scratch DB, every route opened per role, API calls recorded (`open` = page data loads;
`open·N×403` = page loads, N side calls refused — same before and after; `403` = every data call refused;
`page-gate` = the page itself already showed "Admin/Finance access required"; **no-access** = P2-10 view).
Admin: every page opens, before and after.

| Page | hr | finance | viewer | supervisor | employee |
|---|---|---|---|---|---|
| `/` | open | open | open | open | open |
| `/daily-mis` | open | open | open | open·1×403 | open·1×403 |
| `/pipeline/import` | open | open | open | open | open |
| `/pipeline/miss-punch` | open | open | open | open | open |
| `/pipeline/shift-check` | open | open | open | open | open |
| `/pipeline/night-shift` | open | open | open | open | open |
| `/pipeline/corrections` | open | open | open | open | open |
| `/pipeline/day-calc` | open | open | open·1×403 | open·1×403 | open·1×403 |
| `/pipeline/salary` | open | open | open·1×403 | open·1×403 | open·1×403 |
| `/held-salaries` | open | open | open | open | open |
| `/salary-advance` | open | open | open | open | open |
| `/payable-ot` | open | open | open | open | open |
| `/salary-input` | open | open | open | open | open |
| `/loans` | open | open | open | 403 → **no-access** | 403 → **no-access** |
| `/leave-management` | open | open | open | open·1×403 → **no-access** ‡ | open·1×403 → **no-access** ‡ |
| `/workforce/headcount` | open | open | open | open | open |
| `/workforce/attrition` | open | open | open | open | open |
| `/workforce/contractors` | open | open | open | open | open |
| `/workforce/contractor-report` | open | open | page-gate → **no-access** | page-gate → **no-access** | page-gate → **no-access** |
| `/analytics/overview` | open | open | open | open | open |
| `/analytics/absenteeism` | open | open | open | open | open |
| `/analytics/punctuality` | open | open | open | open | open |
| `/analytics/overtime` | open | open | open | open | open |
| `/analytics/hours` | open | open | open | open | open |
| `/analytics/early-exit` | open | open | 403 → **no-access** | 403 → **no-access** | 403 → **no-access** |
| `/analytics/attendance-review` | open → **no-access** ‡ | open → **no-access** ‡ | open → **no-access** ‡ | open → **no-access** ‡ | open → **no-access** ‡ |
| `/compliance/pf` | open | open | open | open | open |
| `/compliance/esi` | open | open | open | open | open |
| `/compliance/labour-law` | open | open | open | open | open |
| `/compliance/calendar` | open | open | open | open | open |
| `/reports` | open | open | open | open | open |
| `/finance-audit` | open·1×403 | open | open·4×403 | open·4×403 | open·4×403 |
| `/finance-verification` | open | open | open | open | open |
| `/extra-duty-grants` | open | open | open | open | open |
| `/alerts` | open | open | open | open | open |
| `/employees` | open | open | open | open | open |
| `/daily-wage` | open | open | open | open | open |
| `/daily-wage/new` | open | open | open | open | open |
| `/daily-wage/import` | open | open | open | open | open |
| `/daily-wage/contractors` | open | open | open | open | open |
| `/daily-wage/reports` | open | open | open | open | open |
| `/daily-wage/finance/review` | page-gate → **no-access** | open | page-gate → **no-access** | page-gate → **no-access** | page-gate → **no-access** |
| `/daily-wage/finance/payments` | page-gate → **no-access** | open | page-gate → **no-access** | page-gate → **no-access** | page-gate → **no-access** |
| `/daily-wage/finance/dashboard` | page-gate → **no-access** | open | page-gate → **no-access** | page-gate → **no-access** | page-gate → **no-access** |
| `/daily-wage/audit` | page-gate → **no-access** | open | page-gate → **no-access** | page-gate → **no-access** | page-gate → **no-access** |
| `/sales/employees` | open | open·1×403 → **no-access** ‡ | 403 → **no-access** | 403 → **no-access** | 403 → **no-access** |
| `/sales/holidays` | open | open → **no-access** ‡ | open → **no-access** ‡ | open → **no-access** ‡ | open → **no-access** ‡ |
| `/sales/upload` | open | open → **no-access** ‡ | open → **no-access** ‡ | open → **no-access** ‡ | open → **no-access** ‡ |
| `/sales/compute` | open | open → **no-access** ‡ | open → **no-access** ‡ | open → **no-access** ‡ | open → **no-access** ‡ |
| `/sales/ta-da-register` | open | open → **no-access** ‡ | open → **no-access** ‡ | open → **no-access** ‡ | open → **no-access** ‡ |
| `/sales/ta-da-upload` | open | open → **no-access** ‡ | open → **no-access** ‡ | open → **no-access** ‡ | open → **no-access** ‡ |
| `/sales/ta-da-approvals` | open | open | 403 → **no-access** | 403 → **no-access** | 403 → **no-access** |
| `/sales/payslip/S901` | open | open → **no-access** ‡ | open → **no-access** ‡ | open → **no-access** ‡ | open → **no-access** ‡ |
| `/employee-profile` | open | open | open | open | open |
| `/dept-analytics` | open | open | open | open | open |
| `/session-analytics` | page-gate → **no-access** | page-gate → **no-access** | page-gate → **no-access** | page-gate → **no-access** | page-gate → **no-access** |
| `/admin/query-tool` | 403 → **no-access** | 403 → **no-access** | 403 → **no-access** | 403 → **no-access** | 403 → **no-access** |
| `/admin/sql-console` | page-gate → **no-access** | page-gate → **no-access** | page-gate → **no-access** | page-gate → **no-access** | page-gate → **no-access** |
| `/admin/bug-reports` | page-gate → **no-access** | page-gate → **no-access** | page-gate → **no-access** | page-gate → **no-access** | page-gate → **no-access** |
| `/admin/record-history` | page-gate → **no-access** | page-gate → **no-access** | page-gate → **no-access** | page-gate → **no-access** | page-gate → **no-access** |
| `/admin/statutory-flags` | page-gate → **no-access** | page-gate → **no-access** | page-gate → **no-access** | page-gate → **no-access** | page-gate → **no-access** |
| `/settings/shifts` | page-gate → **no-access** | page-gate → **no-access** | page-gate → **no-access** | page-gate → **no-access** | page-gate → **no-access** |
| `/settings/holidays` | page-gate → **no-access** | page-gate → **no-access** | page-gate → **no-access** | page-gate → **no-access** | page-gate → **no-access** |
| `/settings/policy` | page-gate → **no-access** | page-gate → **no-access** | page-gate → **no-access** | page-gate → **no-access** | page-gate → **no-access** |
| `/settings/audit` | page-gate → **no-access** | page-gate → **no-access** | page-gate → **no-access** | page-gate → **no-access** | page-gate → **no-access** |
| `/settings/usage-logs` | page-gate → **no-access** | page-gate → **no-access** | page-gate → **no-access** | page-gate → **no-access** | page-gate → **no-access** |
| `/settings/users` | page-gate → **no-access** | page-gate → **no-access** | page-gate → **no-access** | page-gate → **no-access** | page-gate → **no-access** |

‡ = before P2-10 the page shell rendered, but nothing on it works for that role; hidden by P2-10 because the matrix and
the server both refuse it:
- `/sales/*` (finance, viewer, supervisor, employee): every sales data/action route sits behind
  `router.use(requireHrOrAdmin)` (sales.js L1139) or `requirePermission('sales-tada-compute')`; the survey shows "open"
  only because no company was selected, so the page made no data call. Probe in the check: GET
  `/api/sales/salary-register`, `/sales/holidays`, `/sales/ta-da/register`, `/sales/employees` → 403. (Finance's sales
  ESI button on Compute is disabled without register rows, which finance cannot load.)
- `/analytics/attendance-review` (all non-admin): the router is `requireAdmin`; for others the Analytics page just fell
  back to the overview tab at that URL.
- `/leave-management` (supervisor, employee): the leave list `GET /api/leaves` → 403.

Menu changes (sidebar, every parent expanded): **viewer** loses "Early Exit" (all its data 403); **supervisor** loses
"Leave Management" (leave list 403); every other role's menu is identical to origin/main (same items, same order).
Header "Settings": before shown to every role (non-admin got the "Admin Access Required" page); after admin only.

## Verified
- jest: `authPermissionsMatrix.test.js` 15 — endpoint per role over HTTP with real JWTs (incl. "HR Manager" → hr, unknown
  → viewer, no token 401), no old key removed, sales-tada-* unchanged, admin-only keys granted to nobody else, every
  frontend route key granted or admin-only, P2-10 additions present. On the old matrix 2 fail (orphan keys, additions).
  Full suite 115 suites / 2040 → 116 / 2055, all green.
- `backend/scripts/permissions-nav-check.py` (Chromium, built dist, scratch DB, real UI logins admin/hr/finance/fictional
  test_viewer/test_super) **184/184**: menus = expected per role; Header Settings admin only; allowed URL samples open;
  every forbidden URL → no-access, menu still there, **0 API ≥ 400** while on it, "Go to Dashboard" works; permissions
  held 1.5 s → 0 menu items, page not mounted, loader, no Settings; permissions 500 ×3 → error + Try again → page opens;
  in-place role change via intercepted /auth/me + /auth/permissions (hr→viewer, admin→supervisor, viewer→finance,
  finance→hr): no hook/page error, menu = new role, forbidden URL shows no-access; 390 px drawer + no-access fits;
  server refuses the data behind hidden pages (13 probes → 403).
- `--base` on an origin/main build 5/5: viewer opens /analytics/early-exit and /sales/employees (page mounts, API 403s),
  sees Header "Settings", menu shows "Early Exit".
- Regression: `dashboard-failed-call-check.py` 66/66; `errorboundary-sentry-check.py` 36/36 (fake-DSN build).
  `layout-hook-order-check.py` 54/58 — the 4 "labels = role B" checks fail **by design**: that script changes only the
  /auth/me answer, and the menu now follows the server's permission list for the token (still role A). No crash / hook
  error checks fail. My check's section G covers the same switch with /auth/permissions intercepted too.

## Fragile
1. Every new page needs a `ROUTE_KEYS` entry in `utils/permissions.js` (an unknown path is refused for non-admins) and,
   for non-admin access, its key in `backend/src/config/permissions.js`. The jest test fails on a route key no role has.
2. Menu and route follow the **token's** role (what the server enforces), not the role /auth/me puts in the store; after
   an admin changes someone's role, the menu changes at their next login.
3. A role change in place refetches permissions; while that runs the page is unmounted (unsaved input on it is lost) — rare.
4. Badges (TA/DA pending, leave flags, loan queue) keep their own role checks — they decide counts, not visibility.

## Not done / not tested
- Railway; Safari/Firefox; a real employee-role login (0 such users).
- `layout-hook-order-check.py` not updated (not owned) — see Verified.

## Owner question (not decided here)
- **Q-P2-10-a:** viewer, supervisor and employee can read most payroll pages (pipeline stages, salary register, finance
  audit/verify, employees …) because those GET routes have no role guard. P2-10 keeps that (rule: do not change reach).
  Cutting it needs a ruling on which pages each read-only role should keep, a backend read-guard PR, then removing the
  keys. Recommendation (OPINION): viewer keeps dashboard, Daily MIS, reports, loans (its original list); supervisor and
  employee keep dashboard + Daily MIS.
- **Q-P2-10-b:** viewer Finance Audit loads with 4 refused side calls (late, early-exit, comp-off, leave queues) — kept
  reachable because readiness and flags load. Hide it for viewer?

## CLAUDE.md entry
## Last Session — 2026-10-12 (P2-10: menu, routes and Header Settings follow one permission matrix)
**Branch `feat/permissions-nav-routes`, NOT merged.** Plan + log: `docs/ux-bulk/prs/P2-10/PROGRESS.md`. Findings X-2, X-8.
- **Before:** Sidebar hid items with ad-hoc role flags; every route opened for any logged-in role (forbidden pages
  mounted and their API calls 403'd); Header "Settings" showed for every role.
- **Now:** `utils/permissions.js` maps each route to page keys; `usePermissions()` (GET /api/auth/permissions, cached per
  user+role) gives `can`/`canPath`. Sidebar (flags removed), App.jsx `PageGate` ("You don't have access to this page",
  page never mounts) and Header Settings (admin) all use it. Nothing shows while loading; failure → Retry.
- **Matrix:** keys added only where a role already used the page (survey: role × page table in PROGRESS); sales-tada-*
  unchanged → no API access change. Hidden for non-admins only where the server already refuses the data.
- **Fragile:** a new page needs a ROUTE_KEYS entry + matrix key (jest pins orphans). Menu follows the token's role.
- **Verified:** jest 116/2055 (new authPermissionsMatrix 15); permissions-nav-check.py 184/184, `--base` 5/5.
- **Open:** Q-P2-10-a (read-only roles still read most payroll pages — needs ruling + backend read guards).
