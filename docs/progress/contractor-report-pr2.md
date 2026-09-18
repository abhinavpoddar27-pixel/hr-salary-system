# PROGRESS — Contractor Report (PR-2, read-only)

Branch: `feat/contractor-report` (from `main` @ 2a0d1f0)
Prompt copy: `docs/prompts/contractor-report-pr2.md`

## STATE
Phase 0 complete — awaiting owner `go` at the Phase 0 gate.
Preflight prototype gap RESOLVED (owner uploaded the file mid-turn).

## DONE
- [x] P0.1 preflight: clean tree (0 dirty), main fast-forwarded to `2a0d1f0`, SQL Console MCP reachable (`SELECT 1` → 1).
- [x] P0.1 preflight gap + resolution: `~/Downloads/contractor-report-prototype.html` is not reachable from this container (session runs in a **remote sandbox**, not on the Mac). Owner uploaded the prototype mid-turn; it was read in full from the session upload path. It is NOT committed (embeds real employee names).
- [x] P0.2 branch `feat/contractor-report` created off main.
- [x] P0.2 prompt copied to `docs/prompts/contractor-report-pr2.md`.
- [x] P0.2 this PROGRESS file created.
- [x] P0.3 package manager + test runner detected.
- [x] P0.4 repo read (mounts, guards, classification, router, sidebar, api client, styling refs, DB columns).
- [x] P0.5 PLAN written (below).

## NEXT
Owner decision on the prototype (see BLOCKERS), then `go` → Phase 1 (prove numbers on production).

## BLOCKERS
None. (B-1 prototype-unavailable was resolved by the owner's upload.)

Note for a future resumed session: the prototype lives only in this session's
upload area, not in the repo. If a later session needs it again the owner must
re-upload it.

## RULINGS

### Locked by the prompt
All owner rulings are in the prompt copy (`docs/prompts/contractor-report-pr2.md`,
"OWNER RULINGS"). Encoded verbatim in `backend/src/config/contractorReportConfig.js`.

### Owner rulings at the Phase 0 gate (19 Sep 2026)

**R-0 Branch.** Use `feat/contractor-report`. Explicit permission to push **this
branch and only this branch** in Phase 4. **Never push to main.**

**R-1 AMENDMENT 1 — Commission tab removed from this PR entirely.** The contractor
commission rate is fixed by admin in the contractor master. HR and Finance never
enter, edit, preview or override a rate. No rate input anywhere.
- Drop `CommissionTab.jsx`, the "Also pay on daily-wage heads" checkbox, any rate
  field, any commission role guard, and their tests.
- Tabs are: **Day Report, Daily Wage Register, Grid View, Exceptions** (4, not 5).
- **Keep** `manDays`, `manDaysDay`, `manDaysNight` in the payloads — a later PR
  prices them from the master.
- **Do not read or show** `dw_contractors.current_commission_rate` or any
  `dw_entries` commission field (`commission_rate_applied`,
  `total_commission_amount`, `total_liability`,
  `dw_department_allocations.allocated_commission_amount`).
- Appended verbatim to the prompt copy.
- Consequence: no `requireFinanceOrAdmin` gate is needed anywhere. All three
  endpoints are `requireHrFinanceOrAdmin`.

**R-2 (A) Population rule stands.** Keep the locked rule. Phase 1 must list every
employee where `isContractorForPayroll` and the locked rule disagree — code,
department, employment_type, which path classified them, April and May man-days.
**Information only; no logic change.**

**R-3 (B) `contractor_group` is not used.** It was blank for all 345 contract
employees on 19 Sep. Phase 1 re-confirms the count; the column is not read.

**R-4 (C) normDept + Excel.** Use the ruling's superset with `"Not recorded"` for
empty text. Drop the Excel button.

**R-5 DW departments come from `dw_department_allocations`.** Per department,
`heads = worker_count`, `cost = allocated_wage_amount`. An entry with **no**
allocation row goes under **"Not recorded"**. Phase 1 must additionally report,
for April–May: entries with 0 allocation rows, entries with >1, and entries whose
allocation total differs from `dw_entries.total_worker_count`.

### Deltas found during P0.4 (carried forward)
- `employees.contractor_group` EXISTS but is **not used** per R-3.
- `dw_entries` has NO department column. DW department + per-department heads live
  in `dw_department_allocations (entry_id, department, worker_count,
  allocated_wage_amount, allocated_commission_amount)`. `dw_entries.total_worker_count`
  is the entry-level head count. Per R-1 the `allocated_commission_amount` column is
  never read.

## NUMBERS
None yet — Phase 1 not started.

## ENVIRONMENT FACTS
- Package manager: **npm** (lockfiles at root, `backend/`, `frontend/`; no yarn/pnpm).
- Test runner: **jest** — `npm test --prefix backend` → `jest --forceExit`.
- `backend/jest.config.js`: `roots: ['<rootDir>/src']`, `testMatch: ['**/__tests__/**/*.test.js']`.
  → new test MUST live at `backend/src/__tests__/contractorReport.test.js` to be discovered.
- Frontend build: `npm run build --prefix frontend` (Vite). `frontend/dist/` is committed and served by Railway.

---

# PLAN (Phase 0 output)

## Files to CREATE (all new) — 10 files after AMENDMENT 1 (was 11)
| File | Purpose |
|---|---|
| `backend/src/config/contractorReportConfig.js` | The single rules file. Biometric alias map, DW alias map, excluded depts, test contractors, present weights, dept normaliser, role normaliser, display-name resolver. A later PR replaces this with a master table. |
| `backend/src/services/contractorReport.js` | Pure functions `monthReport(db, opts)`, `dayReport(db, opts)`, `gridReport(db, opts)`. No writes. One query per dataset — no N+1. |
| `backend/src/routes/contractorReport.js` | 3 GET routes + param validation + role gates. |
| `backend/src/__tests__/contractorReport.test.js` | jest, in-memory better-sqlite3 fixture. (Path is forced by `roots:['<rootDir>/src']`.) |
| `frontend/src/pages/ContractorReport.jsx` | Page shell: header selects, stat cards, banner, tab strip, tab router. |
| `frontend/src/components/contractorReport/DayReportTab.jsx` | Tab 1 (contractor / department toggle, expandable rows). |
| `frontend/src/components/contractorReport/DailyWageRegisterTab.jsx` | Tab 2. |
| `frontend/src/components/contractorReport/GridViewTab.jsx` | Tab 3 (grid, selection panel, keyboard nav, filters). |
| `frontend/src/components/contractorReport/ExceptionsTab.jsx` | Tab 4. |
| `frontend/src/components/contractorReport/shared.jsx` | Badges, chips, formatters (`fmt`, `f1`, `dl`), shared bits used by 3+ tabs. |

## Files to EDIT — exactly 3 lines in 3 existing files
| File | Line | Change |
|---|---|---|
| `backend/server.js` | after line 230 (`/api/admin/record-history`) | `app.use('/api/contractor-report', requireAuth, require('./src/routes/contractorReport'));` |
| `frontend/src/App.jsx` | immediately before line 189 (`/workforce/*`) | `<Route path="/workforce/contractor-report" element={<RequireAuth><Layout title="Contractor Report"><ContractorReport /></Layout></RequireAuth>} />` + its `React.lazy` import (counts as the same one-route change; the import line is mechanical and unavoidable — flagged at the gate). |
| `frontend/src/components/layout/Sidebar.jsx` | after line 82 (`Contractor Management`) | `{ label: 'Contractor Report', to: '/workforce/contractor-report' },` |

`/workforce/contractor-report` is more specific than `/workforce/*`, so React Router v6 ranks it first regardless of order. It renders as its own page (own `Layout` title), NOT as a tab inside `WorkforceAnalytics` — that page is not in the allowed-edit list.

## Endpoints
All `GET`, all mounted behind the app-level `requireAuth`, all read-only.

### 1. `GET /api/contractor-report/month`
Gate: `requireHrFinanceOrAdmin` (local helper, mirroring `early-exits.js` — `roles.js` has no such export).
Params: `month` 1–12 (req), `year` 2024–2030 (req), `company` (opt).
```
{ success, data: {
  days: [{ date, dow, isSunday }],
  contractors: [ '<display name>', ... ],            // sorted by (manDays + dwHeads) desc
  cells: { '<date>': { '<contractor>': {
      bioDay, bioNight, bio,                          // head counts
      manDays, manDaysDay, manDaysNight,              // weighted, pre-DOJ excluded
      dwHeads, dwCost, dwRecords, dwPending,
      deptBreakdown: [{ dept, typed, heads, cost }]
  } } },
  totals: { perContractor: { '<c>': {bio,manDays,manDaysDay,manDaysNight,dwHeads,dwCost} },
            stats: { manDays, manDaysDay, manDaysNight, dwHeads, dwCost, bothSourceDays } },
  unknownCompanyRatio,                                // for the yellow banner
  exceptions: { both[], dup[], pre[], aft[], nodoj[], tie[], pend[], test[] }
} }
```

### 2. `GET /api/contractor-report/day`
Gate: `requireHrFinanceOrAdmin`. Params: `date` ISO (req), `company` (opt).
```
{ success, data: { date, contractors: [{ name, unmapped,
    bioDay, bioNight, bio, dwHeads, dwCost, dwRecords, dwPending,
    employees: [{ code, name, role, night, status, doj, preJoining, noDoj }],
    dwEntries: [{ id, rawName, typedDept, dept, heads, rate, amount, status, gateRef }]
}] } }
```

### 3. `GET /api/contractor-report/grid`
Gate: `requireHrFinanceOrAdmin`. Params: `month`, `year`, `contractor` (req, must resolve to a known display name), `company` (opt).
```
{ success, data: { contractor, days: [...],
  employees: [{ code, name, role, doj, doe, company,
    cells: { '<date>': { status, night, preJoining } },
    stats: { dayShifts, nightShifts, halfDays, wop, absent, weeklyOff, preJoining,
             manDays, payrollDays, tie, firstPunch, lastPunch } }],
  footer: { '<date>': { bioDay, bioNight, dwHeads, bothSource } } } }
```

**No commission endpoint, no commission gate** (AMENDMENT 1). All three routes use
the same `requireHrFinanceOrAdmin` gate. `manDays` / `manDaysDay` / `manDaysNight`
stay in the `/month` payload for the later pricing PR.
Validation failures → `400 {success:false, error:'<message>'}`.

## `isContractorForPayroll` vs the locked population rule — THEY DIFFER
`utils/employeeClassification.js` (DO NOT MODIFY, and not used here) cascades:
`employment_type` contains "contract" → else `is_contractor === 1` → else dept-keyword heuristic.

The locked rule is narrower and adds an exclusion:
1. **Only** `employment_type LIKE '%contract%'` (case-insensitive). No `is_contractor` fallback, no dept-keyword fallback.
2. **Plus** exclude departments `SECURITY` and `BISLERI WORKERS`.

So the report's population is a strict subset of the payroll population on the fallback paths, and also drops 2 departments the payroll classifier would keep. Phase 1 will quantify the delta (how many employees each path adds/drops) and report it before any code is written.

## Phase 1 query list (read-only, MCP SQL Console)
1. Population delta: locked rule vs `isContractorForPayroll` equivalent SQL.
2. `employees.contractor_group` contents (undocumented column — is it a better identity source than the dept alias map?).
3. April + May biometric heads / day / night / man-days, per the weights.
4. April + May DW heads + cost (approved+paid, test contractors excluded), from `dw_entries` ⨝ `dw_department_allocations`.
5. Both-source contractor-days + max double pay.
6. Two-DW-records-one-day.
7. Pre-joining, post-exit, no-DOJ.
8. Tie-out vs `day_calculations.total_payable_days`.
9. 23 May and 9 May spot checks.
10. `SELECT DISTINCT company FROM dw_entries` (for the company filter).
11. Unmapped contractor names on both sides (so nothing is silently dropped).
12. (R-5) DW allocation integrity, April–May: entries with 0 allocation rows, entries
    with >1, entries whose `SUM(worker_count)` differs from `total_worker_count`.
13. (R-2) Full disagreement list: locked rule vs `isContractorForPayroll`, with the
    classifying path and April/May man-days per employee.
14. (R-3) Re-confirm `contractor_group` is blank for all contract employees (expect 345).
