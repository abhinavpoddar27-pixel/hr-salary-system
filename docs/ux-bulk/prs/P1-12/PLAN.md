# P1-12 — PLAN (Phase 0)

Finding X-1 · Base origin/main 3d20021 · Branch `fix/sidebar-header-hook-order` · Worktree /home/claude/wt-p1-12
Targets: `frontend/src/components/layout/Sidebar.jsx`, `frontend/src/components/layout/Header.jsx` (+ `frontend/dist`,
+ new check script `backend/scripts/layout-hook-order-check.py`, + docs). Nothing else.

## 1. Hook inventory (read on 3d20021, line numbers as on that commit)

### Sidebar.jsx
| Component | Line | Hook | After a conditional return? |
|---|---|---|---|
| `TaDaPendingBadge` | 14 | `useQuery` | No — only hook, return at L22 is after it |
| `LeaveFlagBadge` | 36 | `useQuery` (`enabled: canSee`) | No — return at L45 is after it |
| `LoanQueueBadge` | 62 | `useQuery` (`enabled: isAdminRole`) | No — return at L72 is after it |
| `NavItem` | 199 | `React.useState` (open) | No |
| `NavItem` | 200 | `useLocation` | No |
| `NavItem` | **220** | **`React.useEffect`** (auto-open active parent, deps `[isActive]`) | **YES — after the 6 role `return null`s at L205, 207, 209, 211, 215, 217** |
| `NavItem` | 224–297 | (none) — `if (item.action) return`, `if (hasChildren) return`, final return | after all hooks, fine |
| `Sidebar` | 301 | `useAppStore()` | No — Sidebar has no early return |

Only defect in Sidebar.jsx: NavItem L220. An item that is visible renders 3 hooks; the same instance re-rendered with a
role that hides it renders 2 → React "Rendered fewer hooks than expected" (min. #300); the reverse (hidden → visible)
gives "Rendered more hooks than during the previous render" (#310).

### Header.jsx
| Component | Line | Hook | After a conditional return? |
|---|---|---|---|
| `Header` | 9 | `useAppStore()` (user, clearAuth) | No |
| `Header` | 10 | `useNavigate` | No |
| `Header` | 11 | `useState` (showUserMenu) | No |
| `Header` | 20 | `useAppStore()` (toggleSidebar) | No |
| `Header` | **46** | **`useAppStore(s => s.selectedCompany)`** — called inside an inline IIFE in JSX | **YES — after `if (!showSelector) return null` (L43)** |

The IIFE runs during Header's render, so its hook belongs to Header. `showSelector` = `allowedCompanies` includes `'*'` or
has > 1 entry. When it flips in place, Header's hook count changes 5 ↔ 4 → same crash class.

## 2. How the crash is reached in real use (honest)
Sidebar + Header live in `Layout` OUTSIDE the page `ErrorBoundary` (App.jsx L86–96); only the Sentry boundary in main.jsx
catches it → whole app shows "Something went wrong". Same-instance re-render with a changed role/companies happens when:
- `RequireAuth` → `getMe()` → `refreshUser(u)` (App.jsx ~L120) swaps the user in place after first paint. If the
  localStorage `hr_user` role / `allowedCompanies` differs from the server's (admin changed the user's role or company
  access, or a legacy role string heals to a different role), the Sidebar/Header re-render with the new values.
- Any future in-session role/company change through the store.
A plain logout → login remounts Layout (Login is outside it), so that path does not crash. Whether the refresh path
reproduces in the browser on main is what `--base` will record (see §5).

## 3. Change (smallest; zero visual/behaviour change)

### Sidebar.jsx — NavItem
- Keep L199–202 as is.
- Replace the 6 `if (...) return null` lines with one `const hidden = <same 6 conditions OR-ed>` (conditions copied
  verbatim, same comments kept).
- Keep the `React.useEffect` exactly as is (body + deps `[isActive]`), now above the return.
- Then `if (hidden) return null`. Everything below unchanged.
- Effect runs for a hidden item too: it can only `setOpen(true)` on an invisible item; if that item later becomes
  visible it shows open — the same as a freshly mounted active parent on main. No visible difference. (Not adding a
  `!hidden` guard, to keep the effect byte-identical — see Q1.)
- The child-filter block (L243–251) and the 3 badges are untouched.

### Header.jsx
- Add at the top with the other hooks: `const selectedCompany = useAppStore(s => s.selectedCompany)`.
- In the IIFE: `value={selectedCompany}`. Nothing else (the two existing `useAppStore()` calls stay as they are).

Expected diff: Sidebar ≈ +10/−12, Header +2/−1. dist rebuilt in its own commit (only the main/index chunk containing the
layout should change — confirm by hash-normalised compare against a fresh 3d20021 build).

## 4. Steps (each = commit + push + PROGRESS update)
1. jest baseline on a 3d20021 worktree under /tmp (record suites/tests).
2. Source edit (Sidebar + Header).
3. `npm run build --prefix frontend`; dist in its own commit; hash-normalised dist compare vs fresh 3d20021 build.
4. Write `backend/scripts/layout-hook-order-check.py` (pattern: salary-register-report-check.py; port 3112;
   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers; scratch DB; fictional users only; `--base` + APP_ROOT).
5. Run on branch dist; 6. run `--base` on 3d20021 dist; 7. jest after; 8. self-debug + user-simulation + v2;
9. CLAUDE.md Last Session entry; 10. final push, HEAD == origin.

## 5. Verify design — `layout-hook-order-check.py`
Scratch DB, real logins for fictional users `t_admin` (admin), `t_hr` (hr), `t_fin` (finance), `t_view` (viewer)
created in the scratch DB only.
- **A. Per-role baseline:** log in as each role, collect the visible sidebar labels (top level + every expanded parent),
  and whether the company selector is shown. Compare branch vs `--base` (main) label lists → must be identical.
- **B. In-place role switch (the bug):** the store is not on `window`, so drive the real `refreshUser` path: seed
  localStorage `hr_user` with role A (e.g. admin, `allowedCompanies ['*']`) + a valid token, and intercept
  `**/api/auth/me` (`page.route`) to return the same user with role B (and/or `allowedCompanies` of one company). On
  load the shell paints with A, then `/auth/me` swaps to B in place. Cases: admin→viewer, admin→hr, hr→admin,
  viewer→finance, companies `['*']`→one (Header). Expect: no `pageerror`, no console error mentioning hooks /
  "#300" / "#310", shell still rendered, visible labels = baseline labels for B.
- **C.** 390px phone pass (sidebar overlay open) for one role; 0 page errors, 0 API ≥ 400 overall.
- `--base`: run B on the 3d20021 dist; record whether the hook error appears. If the in-place switch cannot be driven
  on main in the browser, say so plainly and rely on the code reading + a small React render test is NOT added
  (no frontend test runner in repo).

## 6. Questions for the planner
- **Q1** Keep NavItem's `useEffect` byte-identical (runs for hidden items too, harmless) — or add `if (!hidden && ...)`
  with deps `[isActive, hidden]`? Plan: byte-identical (zero behaviour change).
- **Q2** Test mechanism: `/auth/me` intercept gives exactly ONE in-place switch per page load (`lastRefreshedToken`
  caches by token), so a chained admin→viewer→hr in one load is not reachable without exposing the store (which would
  touch a file outside Targets). Plan: one in-place switch per load, repeated for each pair in §5-B. Accept?
- **Q3** Header: also merge the two `useAppStore()` calls (L9/L20)? Plan: no — out of scope.

## 7. Risks / fragile
- A future NavItem hook must go ABOVE `if (hidden) return null`; comment added at that line.
- Badges already gate with `enabled:` and return after their hook — correct pattern, left alone.
- No ESLint in repo (`react-hooks/rules-of-hooks` would have caught both) — noted as a follow-up, not done here.
