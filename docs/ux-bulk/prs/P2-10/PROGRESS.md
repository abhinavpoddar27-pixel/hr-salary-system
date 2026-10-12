# P2-10 + P8-06 PROGRESS

## RESUME
Branch `feat/permissions-nav-guard`, worktree /home/claude/wt-p2-10, port 3403. Read PLAN.md. BUILT + checked — hand-off done (see Steps). Do NOT edit files you do not own; do NOT touch utils/api.js; never commit dist.

## Steps
- [x] Read head, common rules, CLAUDE.md (PR rules, P1-12 hook order)
- [x] Read permissions.js, auth.js /permissions, App.jsx, Sidebar.jsx, Header.jsx, Login.jsx, index.html, vite.config.js
- [x] Built dist, ran `phase0-diag.py` (scratch DB, 5 roles): BEFORE sidebar sets + per-route 403s
- [x] Production read-only counts: users per role; page views per role 90 d (counts only)
- [x] PLAN.md with BEFORE/AFTER role × nav-item table + questions
- [x] Planner go + rulings
- [x] jest baseline (flock): 115 suites / 2040 tests
- [x] permissions.js additions + permissionsMatrix.test.js 15 (2 fail on the old matrix: hr, finance)
- [x] usePermissions.js, NoAccess.jsx, NotFound.jsx (+ utils/appInfo.js)
- [x] Sidebar perm keys; App Guard + 404; Header Settings gate
- [x] Name + version define (Login, Sidebar, index.html, vite.config.js) — build OK, dist shows v1.0.0 · <sha>
- [x] permissions-nav-check.py 80/80; --base on an 8abee969 build 7/7
- [x] self-debug: (1) /analytics/attendance-review opened for hr/finance (splat route) → Guard `subPerms`; (2) fail-open
      check raced the retry → waits for the amber line; (3) leftover server from a crashed run answered the next run → the
      script now refuses a busy port and kills its servers at exit. v2 = these fixes.
- [x] merge origin/main (already up to date at 8abee969); jest after 116 suites / 2055 tests (before 115 / 2040)
- [x] push

## Rulings (12 Oct)
- Owner: Q5 (A) follow the matrix — viewer 5 items, supervisor 2, other pages "You don't have access". Q3 (a) /settings/* admin only.
- Planner: Q1 yes — permissions.js additions in PLAN §3.1 (additions only, no sales keys) + jest test pinning admin/hr/finance
  see today's sidebar. Q2 fail open + amber "Couldn't load your access" line. Q4 "HR & Salary System", company names as
  Sidebar sub-line. Q6 "v<pkg> · <shortsha>", RAILWAY_GIT_COMMIT_SHA first, fallback "dev".
- R3 + supervisor on-leave-today 403 → planner registers (not this PR).

## CLAUDE.md entry
## Last Session — 2026-10-12 (P2-10 + P8-06: one permissions source for nav, routes and Header; 404 page; one name + build version)
**Branch `feat/permissions-nav-guard`, NOT merged.** Plan + log: `docs/ux-bulk/prs/P2-10/PLAN.md`, `PROGRESS.md`. Findings X-2,
X-8, X-15, X-16. Rulings 12 Oct: Q5 (A) viewer/supervisor follow the matrix; Q3 (a) `/settings/*` admin only; Q1 matrix additions;
Q2 fail open + amber line; Q4 "HR & Salary System"; Q6 "v<pkg> · <shortsha>".
- **Before:** Sidebar used 6 hand-written role flags; items without a flag showed to every role (viewer 47 items, supervisor 46,
  incl. pages that 403 for them — Finance Audit, Early Exit); every route opened for any logged-in role; Header "Settings" for all;
  unknown URL silently → "/"; three product names and two hard-coded versions (v1.0 / v1.1.0).
- **Now:** `hooks/usePermissions.js` loads `GET /api/auth/permissions` once per user (query key = token + username + role;
  no-cache; staleTime ∞) → `can(key)` / `canAny`. Sidebar items carry `perm` (parent shows when a child is visible); App.jsx wraps
  every page in `<Guard perm>` → loader while loading, `components/NoAccess.jsx` ("You don't have access", no redirect, no toast,
  page never mounted) when refused; Header Settings = `can('settings')`. `pages/NotFound.jsx` for unknown URLs (signed out →
  login → back to the URL → 404). `utils/appInfo.js` PRODUCT_NAME / COMPANY_LINE / VERSION_TEXT from vite `define`
  (`__APP_VERSION__` = frontend package.json, `__BUILD_SHA__` = RAILWAY_GIT_COMMIT_SHA → SOURCE_COMMIT → GIT_COMMIT → git → 'dev').
  `permissions.js` additions only: hr += finance-verification, extra-duty-grants, payable-ot, contractor-report, salary-explainer;
  finance += daily-mis, import, shift-verify, night-shift, corrections, day-calc, salary-advance, leave-management, workforce,
  analytics, contractor-report, daily-wage-finance, salary-explainer. No sales key changed (sales.js requirePermission).
- **Visible change:** admin/hr/finance sidebar identical; viewer = Dashboard, Daily MIS, Payroll ▸ Loans, Reports; supervisor =
  Dashboard, Daily MIS; hr/finance lose Header Settings and get "You don't have access" on `/settings/*` and admin pages;
  unknown URL → 404; sidebar logo "HR & Salary System / Indriyan Beverages · Asian Lakto", footer `user (role)` + version.
- **Fragile:** (1) a new page needs a key in permissions.js AND `perm` in Sidebar AND `<Guard perm>` in App.jsx — a page with a
  key no role holds is admin-only. (2) Analytics is one splat route: Attendance Review refused via `subPerms`. (3) Fail open
  (permissions request fails): every page except the ADMIN_ONLY_KEYS list in usePermissions.js (admin keeps all) + amber line —
  keep that list in step with admin-only keys. (4) Nav follows the SERVER's role for the token, not the stored user object.
  (5) The NavItem hook-order rule (P1-12) still holds; Guard and Header call the hook before any return.
- **Verified:** jest 115/2040 → 116/2055 (new `permissionsMatrix.test.js` 15; 2 fail on the old matrix — hr + finance would lose
  pages). `backend/scripts/permissions-nav-check.py` (Chromium, built dist, scratch DB, real logins 5 roles, server restarted per
  role for the login limiter, port 3403) 80/80 — sidebar per role = expected (admin/hr/finance = the 8abee969 measurement),
  every allowed page opens, every other page NoAccess with 0 page requests / 0 4xx / URL kept / no toast, Header Settings admin
  only, 404 + home link, signed-out 404 return, name + version on Login/Sidebar/tab title, in-place role change (no hook error),
  permissions 500 → amber line + fail open, 390 px. `--base` on 8abee969 7/7 (viewer 47, supervisor 46, hr Settings, "/" redirect,
  admin/hr/finance sets = the fix's sets).
- **Not tested:** Railway (that RAILWAY_GIT_COMMIT_SHA reaches the vite build); Safari/Firefox.
- **Script to update (not owned):** `backend/scripts/layout-hook-order-check.py` 54/58 — its 4 "labels = target role" asserts fake
  the stored role while the token keeps the real role; the nav now follows the server (token) role by design. Its crash checks pass.
- **Found, not fixed:** viewer can read most of the hidden pages' data through the API (reads unguarded — R3, planner registered);
  supervisor Daily MIS → 403 `/leaves/on-leave-today`.
