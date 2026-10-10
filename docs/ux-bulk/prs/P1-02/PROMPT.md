# P1-02 — Reports → Salary Register shows ₹0 (wrong field names)
Base: origin/main 96ee482 · Branch: fix/salary-register-report-fields (already created, this file committed on it)
Master plan: docs/ux-bulk/MASTER_PLAN.md §6 P1-02, §10, §11, §12 (on origin/docs/ux-bulk-master-plan until merged —
read with `git show origin/docs/ux-bulk-master-plan:docs/ux-bulk/MASTER_PLAN.md`)
Finding: H-1 · Rulings: R11 (Phase 0 gate, never push to main); Professional Tax is DISABLED (always 0, Apr 2026)

## RESUME (re-read after any compaction)
- Progress file: docs/ux-bulk/prs/P1-02/PROGRESS.md — update + commit + push after EVERY small step
  (state, done, next, rulings). Done steps are never redone; continue from the first unticked step.
- Current phase: 0 plan (STOP at the end of Phase 0 and wait for "go").

## Diagnostics already done by the planner (counts only)
- Code: Reports.jsx Salary Register (~L568–640) reads `e.total_earned`, `e.employee_pf`, `e.employee_esi`, `e.net_pay`,
  `e.professional_tax`; the CSV also uses `basic`, `hra`, `earned_basic`, `earned_hra`, `total_earned`, `employee_pf`,
  `employee_esi`, `net_pay`. The endpoint `GET /api/payroll/salary-register` (payroll.js ~L189, `sc.*` + joins) returns
  `gross_earned`, `pf_employee`, `esi_employee`, `net_salary`, `basic_earned`, `hra_earned` … → those cells render ₹0.
  The 4 total cards use server `totals` and are already right.
- Production (read-only): Sep 2026 = 211 rows (19 held), Σ gross_earned ≈ ₹37.70 lakh, Σ deductions ≈ ₹9.63 lakh,
  Σ net (not held) ≈ ₹27.29 lakh; Aug = 230 rows. payable_days is never NULL. Endpoint is shared with Stage 7 and is busy
  (1,526 calls/90 days) — so the backend must NOT change.

## Phase 0 — plan only (STOP at the end)
1. `git status` clean; `git log -1` = the commit adding this file on 96ee482.
2. Re-grep the Salary Register block in Reports.jsx and every `e.`/CSV key it uses. List the real column names from
   `backend/src/database/schema.js` (`salary_computations` CREATE + `safeAddColumn` calls) for each — read only.
3. Check whether any OTHER report block in Reports.jsx has the same wrong-name pattern (e.g. a `net_pay` read near
   ~L700). Fix ONLY the Salary Register block; list others as new register findings.
4. Write docs/ux-bulk/prs/P1-02/PLAN.md: the exact old → new key map (table + CSV), PT column removal, what is NOT
   touched, tests, verification, risks, questions. Create PROGRESS.md with a RESUME block. Commit + push. STOP.

## Scope (smallest change)
- Table cells: Earned → `gross_earned`, EE PF → `pf_employee`, EE ESI → `esi_employee`, Net Pay → `net_salary`.
- Remove the PT column (header + cell + CSV entry) and fix every `colSpan={11}` in this block to the new count.
- CSV: map every key to a real column (`basic_earned`, `hra_earned`, `gross_earned`, `pf_employee`, `esi_employee`,
  `net_salary`, `payable_days`, `total_deductions`, `gross_salary`). Drop CSV keys with no real column (e.g. monthly
  `basic`/`hra`) rather than inventing data — say which in PLAN.md.
- No backend change, no new columns (no LWF/loan columns — that would be scope creep; list as a finding if wanted).

## Targets
- frontend/src/pages/Reports.jsx → Salary Register block only (~L568–640). Nothing else.

## DO NOT MODIFY
Global list (MASTER_PLAN §10.4): salaryComputation.js, dayCalculation.js, schema.js, payroll.js, recompute.js,
Stage 7 register (SalaryComputation.jsx .salreg/COLS/pins), ED finance-review flow (#79), loans engine.
PR-specific: all backend files, api.js, every other report block in Reports.jsx, App.jsx, Sidebar.jsx.

## Build rules
- One finding = this PR only. Fictional test data only (repo is PUBLIC: no real names/codes/money anywhere).
- After the edit: `npm run build --prefix frontend`; commit frontend/dist in its own commit.
- Skills: engineering:testing-strategy for the check plan.

## Verify (MASTER_PLAN §11)
- `npm run build --prefix frontend` clean. `cd backend && npx jest` — record suites/tests before and after.
- New browser check `backend/scripts/salary-register-report-check.py` (pattern: finance-audit-readiness-check.py;
  PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers; scratch DB; fictional data incl. 1 held row + 1 PF + 1 ESI employee;
  real hr + finance logins; built dist):
  - every row's Earned / EE PF / EE ESI / Net Pay equals the DB value (not ₹0); no PT column;
  - column Σ Earned = "Gross Payroll" card; Σ Net Pay of non-held rows = "Net Payroll" card;
  - CSV download: every column non-empty for a computed row, header list matches PLAN.md;
  - expand a row → drill-down spans the full width; 0 page errors, 0 console errors, 0 API ≥ 400.
- `--base` run against an origin/main dist built in a /tmp worktree: shows the ₹0 cells (record once).
- Self-debug + user simulation + v2. No drift query needed (display only).

## Hand-off
- CLAUDE.md "Last Session" entry at the top (house style). Commit (message ends with the session attribution lines),
  push, verify HEAD == origin/<branch>. Do NOT open or merge a PR. Report: built / caught / tested (counts) /
  not tested (why) / final SHA / new findings.
  Compare: https://github.com/abhinavpoddar27-pixel/hr-salary-system/compare/main...fix/salary-register-report-fields
