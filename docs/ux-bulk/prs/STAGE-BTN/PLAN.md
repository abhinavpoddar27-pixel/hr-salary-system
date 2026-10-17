# STAGE-BTN — hide Stage 6 / 7 / finalise (and other finance-only) buttons a role is refused

Branch `fix/stage67-button-roles` off origin/main 892f7f73 · worktree /home/claude/wt-stage67 · port 3505 · Phase 0 (plan only).
Owner approved touching the protected Stage 6/7 PAGES for buttons only. payroll.js, `.salreg`, `COLS`, pin offsets and every
computation untouched.

## 1. What a refused role actually sees today (re-grepped on 892f7f73)
Server gates (`backend/src/routes/payroll.js` L7 local `requireHrFinanceOrAdmin`): `POST /calculate-days` L15,
`/compute-salary` L128, `/finalise` L762 → hr / finance / admin only (P3-PG #156).

**Since P2-10 (#157), the Stage 6 and Stage 7 PAGES are route-guarded** (`App.jsx` L204–205 `<Guard perm="day-calc">` /
`<Guard perm="salary">`). `permissions.js`: `day-calc` and `salary` are held ONLY by hr and finance (admin `*`); supervisor
(`dashboard, supervisor-dashboard, notifications, daily-mis`) and viewer (`dashboard, reports, notifications, daily-mis,
loans`) and employee (`portal`) get `NoAccess` — the page is never mounted. **So in the normal case no refused role can
see the Run / Compute / Finalise buttons any more**; the CLAUDE.md "buttons still shown to every role" note (P3-PG) predates
P2-10. Two residual cases remain:
- **R1 fail-open:** if `GET /auth/permissions` fails, `usePermissions` fails open — every non-admin-only page opens for
  every role (P2-10 ruling Q2). Then viewer/supervisor DO see Stage 6 "▶ Run Day Calculation" (DayCalculation.jsx L261)
  + "Recalculate Days" (L293), Stage 7 "Compute Salary" (SalaryComputation.jsx L595, L845 stale banner, L1221 override
  modal) and "Finalise" / "Finalise (override)" (L599–615, L1188 confirm, L1229) → each click = 403 toast.
- **R2 matrix vs gate drift:** the page key and the server gate are two lists. Today they agree (pages = hr/finance/admin,
  gate = hr/finance/admin). A future role given `salary` read access (e.g. viewer for the register) would see the buttons.
A role-gated button keeps the two in step at the point of action.

**Finance Audit (P2-11 follow-up):** the Attendance Flags Verify for hr was **already fixed in P3-RG #160**
(`FinanceAudit.jsx` L456–457 `canVerify`, "Awaiting finance" L553). Other finance-only buttons on the SAME page are still
shown to hr (route `finance-audit` is held by hr) — all finance+admin on the server:
| # | Tab / button | Line | Route gate | Shown to hr today |
|---|---|---|---|---|
| F1 | Manual Interventions — row Approve / Reject | L895–896 | `PUT /approve-flag/:id` requireFinanceOrAdmin (L1501) | yes (row checkbox too) |
| F2 | Manual Interventions — Approve All / Reject All bar + row tick boxes | L840–841, isSelectable | `PUT /bulk-approve` (L1525) | yes |
| F3 | Late Coming — Bulk Approve / Bulk Reject + row Approve / Reject | L1201–1202, L1248–1249 | `lateComing.js` finance-review / bulk-review requireFinanceOrAdmin | yes (prod: hr made 3 refused calls in 90 d) |
| F4 | Comp Off / OD — Approve/Reject Selected + row | L1852–1859, L1903–1907 | `compensatoryOff.js` finance-review / bulk-review requireFinanceOrAdmin | tab content not reachable for hr? — the tab is listed; its list read `/comp-off/pending` is finance+admin → hr sees 403 + empty list, buttons not drawn (no rows) |
| F5 | Early Exit — Approve / Reject (`components/FinanceEarlyExitApprovals.jsx` L126–141) | | `early-exit-deductions.js` /:id/approve, /reject requireFinanceOrAdmin | yes, if rows load |
| F6 | Leave Requests — Approve / Reject (L1663–1673) | | finance+admin | already disabled by `can_decide`? NO — `can_decide` is only "not the requester"; hr who did not raise it sees enabled buttons |
Late Coming "Reverse" already gated (`canReverse` L1054).

## 2. Production (read-only, 17 Oct, counts only)
- users: admin 1, finance 1, hr 4, viewer 1 (no supervisor / employee logins).
- usage_logs 90 d, POST/PUT by role: calc-days hr 79 / finance 11 / admin 35; compute-salary hr 97 / finance 17 / admin 40;
  finalise finance 2 / admin 3; salary-flag approve admin 7; late-coming finance-review finance 23 / **hr 3 (refused)**;
  0 non-hr/finance/admin calls to any of these routes. So the only real 403s from a shown button are hr on Finance Audit.
- `salary_manual_flags` pending = 1,597 (hr sees Approve/Reject on every one of them today).

## 3. Smallest change
One role source: `normalizeRole` / `canFinance` from `utils/role.js` (already used by FinanceAudit.jsx L21/L457 and
SalaryComputation.jsx L12/L23/L38) — the server's role gate mirrored, same as P3-RG's `canVerify` and Stage 7's Release.
Add to `utils/role.js` ONE helper (Q1): `canRunPayroll(user) = ['admin','hr','finance'].includes(normalizeRole(user?.role))`.

**Stage 6 `pages/DayCalculation.jsx` (buttons only):** `const canRun = canRunPayroll(user)`; header Run button and the
stale-banner Recalculate button render only when `canRun`; else one plain line in the header: "Only HR, finance or admin
can run the day calculation." (`data-testid="stage6-run-refused"`). Stale banner text stays (it is information).
**Stage 7 `pages/SalaryComputation.jsx` (buttons only — `.salreg`, `COLS`, pins, register untouched):**
`const canRun = canRunPayroll(user)`; inside `data-testid="stage7-actions"` the Compute + Finalise buttons render only when
`canRun`; else "Only HR, finance or admin can compute or finalise salary." (`stage7-run-refused`); stale-banner Compute
(L845) hidden when `!canRun`; the override modal can only be opened from the hidden Finalise button (no change needed).
Salary Slip (Excel) and payslip buttons unchanged (reads).
**Finance Audit `pages/FinanceAudit.jsx` (Q2 scope):** one page-level `canFinanceAct = canFinance(user)` reused by:
F1/F2 — Actions cell shows the status pill only + "Awaiting finance" (same wording as P3-RG), tick boxes not drawn, bulk bar
not drawn; F3 — row Approve/Reject + bulk buttons + tick boxes hidden, "Awaiting finance"; F6 — Approve/Reject hidden for
non-finance ("Awaiting finance"). F5 (`FinanceEarlyExitApprovals.jsx`) — `showActions` false for non-finance (Q3).
Also replace `canReverse`'s raw `String(role).toLowerCase()` with `canFinance` (same answer, normalised).
No backend change, no api.js change, no permissions.js change.

## 4. NOT touched
payroll.js, salaryComputation.js, dayCalculation.js, recompute.js, schema.js, `.salreg` / `COLS` / pin offsets /
register body in SalaryComputation.jsx, every mutation/computation/handler body (buttons' render conditions only),
financeAudit.js / lateComing.js / compensatoryOff.js routes, App.jsx Guard, usePermissions, permissions.js, CLAUDE.md.

## 5. Tests / verification
- No backend change → full jest before = after (sanity run under `flock /tmp/jest.lock`).
- `flock /tmp/vite.lock npm run build --prefix frontend`.
- NEW `backend/scripts/stage-buttons-roles-check.py` (built dist, scratch DB, port 3505, fictional T95xx, real logins per
  role, server restart per role for the login limiter):
  - hr / finance / admin: Stage 6 Run + Recalculate (when stale) visible; Stage 7 Compute + Finalise visible; one click each
    still sends the request (200) — no regression.
  - viewer with `/auth/permissions` forced to 500 (fail-open, page mounts): Stage 6 + 7 show the refused line, 0 Run /
    Compute / Finalise buttons, 0 POSTs, 0 API ≥ 400 from the page's actions.
  - hr on Finance Audit: Manual Interventions 0 Approve/Reject/tick/bulk, "Awaiting finance"; Late Coming 0 approve buttons;
    Leave Requests 0 Approve/Reject; Early Exit 0 actions; 0 PUT/POST; 0 page errors. finance: all present, one approve works.
  - 390 px width for Stage 7 header with the refused line.
  - `--base` on 892f7f73 must FAIL: viewer fail-open sees Run → 403; hr sees Approve on interventions → 403.
- Regression: role-gaps-check.py (P3-RG), wide-layout-check.py (Stage 7 register unchanged), interventions-reject-all-check.py.

## 6. Risks
- Hiding is UI only; the server stays the gate (unchanged). `normalizeRole` falls back to viewer for unknown labels → such a
  user sees the refused line (correct: the server refuses them too).
- Check scripts that click Approve on Finance Audit as hr (none known; existing ones use finance) would break.
- Pre-existing, not fixed: Finance Audit parent calls `/comp-off/pending` for every role → hr 403 + console error (CLAUDE.md
  P3-RG "found, not fixed") — keep out unless Q4 says yes.

## 7. Questions (recommended answer in **bold**)
- Q1. Helper: add `canRunPayroll` to `utils/role.js` (one shared helper) or inline the role list on each page? **Add the
  helper** (Stage 6 + Stage 7 share it; mirrors payroll.js's `requireHrFinanceOrAdmin`).
- Q2. Hide or disable? **Hide, with one plain line saying who can** (P3-RG pattern; a disabled Finalise beside a live
  register invites clicks).
- Q3. Scope on Finance Audit: only the item named (already done in P3-RG), or all finance-only buttons F1–F6 shown to hr?
  **All of F1, F2, F3, F5, F6** (same 403 class; F4 shows no rows to hr). FinanceEarlyExitApprovals.jsx is outside the
  named pages — OK to touch its `showActions` only? **Yes.**
- Q4. Also gate the parent's `/comp-off/pending` badge read to finance/admin (removes hr's 403 + console error on every
  Finance Audit load)? **Yes, 1 line (`enabled: canFinanceAct`)** — say no if you want it kept separate.
- Q5. Since P2-10 already blocks viewer/supervisor from the Stage 6/7 pages, is the Stage 6/7 part still wanted (it only
  matters for fail-open / future matrix drift)? **Yes** — cheap, and it closes the planner register item.
