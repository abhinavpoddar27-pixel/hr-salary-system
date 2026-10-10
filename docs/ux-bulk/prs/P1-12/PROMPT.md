# P1-12 — Sidebar/Header call hooks after early returns (crash risk on role change)
Base: origin/main 3d20021 · Branch: fix/sidebar-header-hook-order · Worktree: /home/claude/wt-p1-12
Master plan: §6 P1-12 · Finding X-1

## Diagnostics already done by the planner
- `components/layout/Sidebar.jsx` NavItem (L198+): `useState`, `useLocation` at the top, then several
  `if (...) return null` (L205–217), then `React.useEffect` at L220 → hook count changes when the role/visibility
  changes → "Rendered fewer hooks than expected" crash.
- `components/layout/Header.jsx` L46: `useAppStore(s => s.selectedCompany)` is called inside JSX after
  `if (!showSelector) return null` (L43) — a hook inside a conditional render path.

## Phase 0 — plan only
List EVERY hook in NavItem and Header (and any other component in these two files) with its line and whether it sits
after a conditional return. PLAN.md + PROGRESS.md, commit, push, STOP.

## Scope (smallest change)
Move every hook above the first early return (compute a `hidden` boolean, run hooks, then `if (hidden) return null`);
lift the Header store selector to the top of the component. Zero visual/behaviour change.

## Targets
frontend/src/components/layout/Sidebar.jsx, frontend/src/components/layout/Header.jsx. Nothing else.

## Verify
Browser check `backend/scripts/layout-hook-order-check.py`: log in as admin, then switch the stored user role / mock
`/auth/me` between admin → viewer → hr without reload (or re-render via store) → no React hook error, nav items shown
per role exactly as on main (compare the visible nav labels per role against a main build); 0 errors. `--base`:
reproduce the hook-order error if reachable (record honestly if not reachable in the browser).

## RESUME (re-read after any compaction)
- Progress: docs/ux-bulk/prs/P1-12/PROGRESS.md — update + commit + push after EVERY small step. Never redo a ticked step.
- Owner gave a programme-level "go" on 10 Oct 2026 ("run through so we finish"). The PLANNER approves your Phase 0:
  finish Phase 0 (PLAN.md + PROGRESS.md committed + pushed), then STOP and report. The planner replies "go" or corrections.

## DO NOT MODIFY
Global (MASTER_PLAN §10.4): salaryComputation.js, dayCalculation.js, schema.js, payroll.js, recompute.js, Stage 7 register
(SalaryComputation.jsx .salreg/COLS/pins), ED finance-review flow, loans engine. Plus everything outside Targets.

## Build rules
- One finding = this PR only. Repo is PUBLIC: fictional test data only, no real names/codes/money anywhere.
- Work ONLY in your worktree. backend/node_modules + frontend/node_modules are symlinks to the main repo (do not commit them).
- Frontend edit → `npm run build --prefix frontend`; commit frontend/dist in its own commit.
- Browser checks: PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers, scratch DB, real logins, built dist, port 3112 only.
  Pattern: backend/scripts/salary-register-report-check.py. Prove the bug once with `--base` on a main build.
- jest full suite before and after (record suites/tests).
- Self-debug pass + user-simulation pass (happy path + ≥1 edge) before hand-off.

## Hand-off
CLAUDE.md "Last Session" entry at the top (house style: branch, bug, fix, fragile, verified, not tested, found-not-fixed).
Commit messages end with the session attribution lines. Push; verify HEAD == origin/<branch>. Do NOT open/merge a PR.
Report: built / caught / tested (counts) / not tested (why) / final SHA / new findings.
