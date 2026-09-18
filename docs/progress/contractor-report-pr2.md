# PROGRESS — Contractor Report (PR-2, read-only)

Branch: `feat/contractor-report` (from `main` @ 2a0d1f0)
Prompt copy: `docs/prompts/contractor-report-pr2.md`

## STATE
Phase 2 complete — awaiting owner `go` at the Phase 2 gate.
Backend shipped: config + pure service + 3 GET routes + 44 jest tests. Verified
end to end against real April production aggregates.

## DONE
- [x] P0.1 preflight: clean tree (0 dirty), main fast-forwarded to `2a0d1f0`, SQL Console MCP reachable (`SELECT 1` → 1).
- [x] P0.1 preflight gap + resolution: `~/Downloads/contractor-report-prototype.html` is not reachable from this container (session runs in a **remote sandbox**, not on the Mac). Owner uploaded the prototype mid-turn; it was read in full from the session upload path. It is NOT committed (embeds real employee names).
- [x] P0.2 branch `feat/contractor-report` created off main.
- [x] P0.2 prompt copied to `docs/prompts/contractor-report-pr2.md`.
- [x] P0.2 this PROGRESS file created.
- [x] P0.3 package manager + test runner detected.
- [x] P0.4 repo read (mounts, guards, classification, router, sidebar, api client, styling refs, DB columns).
- [x] P0.5 PLAN written (below).
- [x] P1 all 13 acceptance numbers reproduced on production (see NUMBERS).
- [x] P2.1 `backend/src/config/contractorReportConfig.js` — every rule, one file.
- [x] P2.2 `backend/src/services/contractorReport.js` — monthReport / dayReport /
      gridReport / contractorNamesForMonth. Read-only; one query per dataset.
- [x] P2.3 `backend/src/routes/contractorReport.js` — 3 GETs, validation, role gate.
- [x] P2.4 `backend/server.js` — exactly ONE mount line added (verified by
      `git diff --stat backend/server.js` → `1 +`).
- [x] P2.5 `backend/src/__tests__/contractorReport.test.js` — 44 tests, all pass.
- [x] P2.6 self-debug pass (see PHASE 2 VERIFICATION).

## NEXT
Owner `go` → Phase 3 (frontend page, nav, route, committed dist, user simulation).

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

### Owner rulings at the Phase 1 gate (19 Sep 2026)

**R-6 `company = 'ASIAN'` is invalid** and counts toward the unknown-company %.
**No company-mapping rules anywhere in the report** — it must agree with the value
payroll stores. That record is fixed at source in the company clean-up, not here.

**R-7 Add alias `SONU CONT` → `[Sonu]`.** The grey "not mapped" badge is reserved
for names never seen before.

**R-8 `SAJJAN+JIWAN LAL (12-H)`** has no live entries in April–May, so its
both-source special case (compare against Sajan **and** Jiwan Lal) is covered by a
**unit-test fixture**.

**R-9 Rupees display rounded to whole rupees** (₹22,736). The API payload keeps
exact values; rounding is a frontend concern only.

**R-10** The config must carry a comment that the department normaliser's **rule
order is load-bearing**, citing the 9 May `UTILITY (…ZEERA (400) PROD-5…)` entry
and its 21 heads.

**R-11** Allocation integrity confirmed for all 158 non-test April–May entries
(157 approved/paid + 1 `hr_entered`): one allocation each, heads tie. No action.

### Deltas found during P0.4 (carried forward)
- `employees.contractor_group` EXISTS but is **not used** per R-3.
- `dw_entries` has NO department column. DW department + per-department heads live
  in `dw_department_allocations (entry_id, department, worker_count,
  allocated_wage_amount, allocated_commission_amount)`. `dw_entries.total_worker_count`
  is the entry-level head count. Per R-1 the `allocated_commission_amount` column is
  never read.

## NUMBERS — Phase 1 (read-only production SQL, 19 Sep 2026)

### ACCEPTANCE: 13 / 13 MATCH. Nothing bent to fit.

| Check | Expected | Actual | |
|---|---|---|---|
| Apr biometric heads / day / night | 2,278 / 1,951 / 327 | 2,278 / 1,951 / 327 | PASS |
| Apr man-days vs Σ day_calculations | 2,238 = 2,238, 0 mismatches | 2,238 = 2,238, 0 | PASS |
| Apr DW heads / cost | 699 / Rs 4,44,930 | 699 / Rs 4,44,930 | PASS |
| Apr both-source days / max double pay | 21 all Pappu / Rs 22,736 | 21 all Pappu / Rs 22,735.71 | PASS |
| Apr two-DW-record days | 1 - 4 Apr Pappu 12xRs600 + PAPPU CONT 2xRs650 | 1 - 2026-04-04 Pappu, same two records | PASS |
| Apr pre-joining | 3 workers; 60285 = 21 days | 3 (60285=21, 60287=14, 60296=1) | PASS |
| May biometric heads / day / night | 2,590 / 2,197 / 393 | 2,590 / 2,197 / 393 | PASS |
| May man-days / day / night | 2,587.5 / 2,195 / 392.5 | 2,587.5 / 2,195 / 392.5 | PASS |
| May DW heads / cost | 827 / Rs 5,13,670 | 827 / Rs 5,13,670 | PASS |
| May both-source | 5 days all Meera (8,9,13,14,23) / Rs 12,000 | exactly those 5 dates / Rs 12,000 | PASS |
| May tie-out mismatches | 1 - 60298: 19 vs 22 | 1 - 60298 RANI: 19 vs 22 | PASS |
| 23 May | bio 105 (88/17), DW 53, total 158; Meera 71 (65/6) + 10 | identical | PASS |
| 9 May DW departments | Utility 21, Zeera 13, Production night 13, Godown 1 | identical | PASS |

Apr heads 2278 - man-days 2238 = 40 reconciles as 36 pre-DOJ heads + 4 (8 eligible half-days x 0.5).

### R-2 Population disagreement: exactly ONE bucket, 11 employees
Locked rule = 334 employees. `isContractorForPayroll` = 345. Locked is a strict
subset; there is no employee the locked rule adds.

The only disagreement is the **11 SECURITY contract employees** the ruling excludes.
All 11 are classified by `isContractorForPayroll` through the **employment_type**
path (not the flag, not the keyword heuristic).

| code | name | dept | employment_type | is_contractor | Apr man-days | May man-days |
|---|---|---|---|---|---|---|
| 23710 | GURDEEP SINGH | SECURITY | Contract | 0 | 30 | 26 |
| 23683 | GURMEET SINGH SUP | SECURITY | Contract | 0 | 28 | 12 |
| 23711 | SUKHCHAIN SINGH | SECURITY | Contract | 0 | 17 | 3 |
| 23692 | DIDAR SINGH | SECURITY | Contract | 0 | 15 | 11 |
| 23691 | SUKHVEER SINGH | SECURITY | Contract | 0 | 11 | 0 |
| 23685 | AJAY MASSI GUARD | SECURITY | Contract | 0 | 3 | 0 |
| 23622 | NARINDER SINGH GUARD | SECURITY | Contract | 0 | 0 | 0 |
| 23660 | CHRANJIT SINGH GUARD | SECURITY | Contract | 0 | 0 | 0 |
| 23686 | KARANVEER SINGH GUARD | SECURITY | Contract | 0 | 0 | 0 |
| 23733 | MANJINDER SINGH | SECURITY | Contract | 1 | 0 | 15 |
| 23762 | DINESH KUMAR | SECURITY | Contract | 1 | 0 | 0 |
| | | | | **totals** | **104** | **67** |

**Why there is only one bucket:** all 1,221 employees have a non-empty
`employment_type`, so `isContractorForPayroll` never reaches its `is_contractor`
fallback (0 rows) or its dept-keyword fallback (0 rows). Both are dead paths on
this dataset. The classifiers can therefore differ *only* by the SECURITY /
BISLERI WORKERS exclusion.

**BISLERI WORKERS excludes nobody** — its 10 employees are Permanent/Worker, no
Contract. The exclusion is a no-op under the locked rule (it would only bite under
the dept-keyword heuristic, where BISLERI is a contractor keyword). Kept anyway.

### R-3 contractor_group: re-confirmed, not used
345 contract employees, `contractor_group` blank on **345 / 345**. Column not read.

### R-5 DW allocation integrity, April-May: clean
157 approved/paid non-test entries. **0** with zero allocation rows, **0** with more
than one, **157** with exactly one. **0** heads mismatches, **0** cost mismatches
(`SUM(worker_count)` = `total_worker_count` and `SUM(allocated_wage_amount)` =
`total_wage_amount` on every entry). The "Not recorded" bucket is currently empty
but is still implemented defensively.
Also confirmed `total_wage_amount` = `total_worker_count * wage_rate_applied` exactly.

### Department normaliser coverage, April-May: 100%
7 normalised departments, every allocation row matched a rule, zero fall-throughs:
Production 1,408 (6 typed variants) - Utility 36 (2) - Production night 29 (3) -
Painting 22 (3) - Zeera 400 ml line 17 (3) - Godown 10 (1) - Store 4 (3).
Sum 1,526 = 699 + 827.
`housekeeping` / `etp` / `mistri` do not fire in this window; kept for other months.

**Order is load-bearing** - proof from 9 May: the typed string
`UTILITY (SUGAR-7, SYRUP-1,PULP-2,HK-2,ZEERA (400) PROD-5,,BOILER-1,MOULDING-2, OTHER-1`
contains both "zeera" and "prod", and only the starts-with-`utility` rule running
first puts its 21 heads under Utility. Reordering the rules changes the 9 May answer.

### Contractor alias coverage, April-May: 100% on both sides
Biometric: 16 distinct departments over the 345 contract employees. 14 mapped,
SECURITY excluded, and **SONU CONT (1 employee) is unmapped** - it has **0** present
days in April-May, so it never surfaces in this window. The "not mapped" grey badge
path is dead here but must still ship (that employee can punch next month).
Daily wage: all 13 contractor names present in April-May are mapped. `MEERA CONT`
and `SAJJAN+JIWAN LAL (12-H)` from the ruling have no entries in this window - the
latter's "compare against Sajan AND Jiwan Lal" special case is therefore UNTESTED
against live data and will be covered by a unit-test fixture instead.

### Company data quality (drives the yellow banner + the company filter)
Contract employee `company`, 334 in population: `Asian Lakto Ind Ltd` 94,
`Default` 132, literal string `null` 98, blank 7, `Indriyan Beverages Pvt Ltd` 2,
`ASIAN` 1. Only **96 of 334** carry a valid company.

Man-days with no valid company: **April 1,044.5 / 2,238 = 46.7%**,
**May 1,517.5 / 2,587.5 = 58.6%**. Banner is well justified.
Valid-company split - April: Asian Lakto 1,142.5, Indriyan 51.
May: Asian Lakto 1,015, Indriyan 55.

`dw_entries.company`: 157 blank + 6 `Indriyan Beverages Pvt Ltd` in April-May.
Daily wage is effectively **not** company-split, which is why the company filter
applies to biometric workers only (as the prompt specifies).

**OPEN QUESTION for the owner:** `ASIAN` (1 employee) is treated as *invalid* -
not silently mapped to `Asian Lakto Ind Ltd`. Confirm or correct.

### Other exception counts (April / May)
- Punching after exit date: 4 employees / 27 days, then 5 / 41.
- No joining date on record: 22 employees / 304 present days, then 18 / 303.
- DW entries not approved (non-test): 4 entries / 41 heads across April-May, of which
  3 belong to the two test contractors, leaving **1** real one (JIWAN LAL CONT).
  Test rows are excluded from this section per the ruling and listed only under
  "Test entries to void".
- Test entries to void: 5 entries / 39 heads (RAJESH KUMAR 3/30, SURESH SINGH 2/9).
- Employees present in the month: April 131, May 153.

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


---

# PHASE 2 VERIFICATION

## Unit tests — 44 new, all pass
`npm test --prefix backend -- src/__tests__/contractorReport.test.js` → 44/44.
Covers: weights (½P / WO½P), night split on the punch-in date, pre-joining clip,
no exit-date clip, both-source + max double pay, the R-8 combined-record fixture,
PAPPU + PAPPU CONT folding to one contractor with two records, same-record-twice
NOT being a duplicate, test-entry exclusion, not-approved handling, the department
normaliser (including the 9 May rule-order regression guard), unknown aliases kept,
tie-out (match / mismatch / no row), company filter, unknown-company ratio, grid
department filtering, MEERA+MRREA folding, and a read-only assertion.

## Full backend suite — baseline unchanged
| | main (clean) | this branch |
|---|---|---|
| tests | 253 | 297 (+44) |
| `tdsCalculation` failures | 3 | 3 |
| `protectedWrite` failures | 0 or 3 (flaky) | 0 or 3 (flaky) |

Both pre-existing and documented (CLAUDE.md §12 and OPEN_ITEMS OI-2). Verified by
stashing this branch's backend changes and re-running on the clean tree: 6 failures
(3 TDS + 3 protectedWrite flake). Two consecutive runs on this branch gave 3 then 6
failures — the flake, reproduced, not caused here. **My 44 pass in every run.**

## Production replay — the strongest check
April 2026's real aggregates were pulled from production (de-identified: bucket
counts by date × department × night × status × pre-DOJ, plus the daily-wage entries),
replayed into an in-memory database, and run through the actual service.

Fixture integrity was checked against production first: 349 buckets / 2,278 heads /
1,951 day / 327 night / 36 pre-DOJ heads, and DW 72 entries / 699 heads / ₹4,44,930.
(The first transcription dropped one bucket — 348/2,277 — and was caught by that
checksum before any assertion ran.)

All 13 checks reproduced exactly through the service:
heads 2,278 · day 1,951 · night 327 · man-days 2,238 · day 1,916 · night 322 ·
DW heads 699 · DW cost ₹4,44,930 · both-source 21 (all Pappu) · max double pay
₹22,735.71 · two-DW-record days 1 (4 Apr Pappu, PAPPU CONT 2×650 + PAPPU 12×600) ·
DW not approved non-test 1 · test entries 5. Contractors 13, unmapped 0, department
breakdown Production 698 + Godown 1.

## HTTP route harness — 50/50
The real router booted over HTTP against a fixture: happy paths on all three
endpoints, the company filter narrowing biometric but not daily wage, dept
normalisation and typed-text retention, both-source, tie-out (ties / mismatch /
no payroll row), a daily-wage-only contractor rendering an empty grid rather than a
400, all 12 validation branches → 400, hr/finance/admin → 200, viewer/employee/no-role
→ 403 on all three endpoints, and a row-count check proving the routes wrote nothing.

**Three harness bugs were found and fixed, no product bugs:** two assertions had the
wrong expected tie-out values (E1's man-days is 1, not the 1.5 month total, so it
*ties*), and `get(path, role = 'hr')`'s default parameter meant the "no role" case
was silently running as HR — masking the one genuinely security-relevant assertion.
After fixing, no-role correctly 403s. A real tie-out *mismatch* employee was then
added so that branch is proven over HTTP too, and the equivalent cases were added to
the permanent jest suite.

## Two efficiency fixes from the adversarial re-read
1. `gridReport` was fetching the whole month's attendance and discarding other gangs
   in JS. It now resolves the alias map to a department list up front and filters in
   SQL (`CFG.departmentsForContractor`).
2. `/grid` validated an unknown `?contractor=` by building an entire `monthReport`.
   It now uses `contractorNamesForMonth`, two small DISTINCT queries.

## Scope discipline
`git diff --stat main` for `salaryComputation.js`, `dayCalculation.js`, `schema.js`,
`payroll.js`, `exportFormats.js`, `employeeClassification.js`, `dailyWage.js`,
`DailyMIS.jsx`, `AttendanceRegister.jsx` → **empty**. `backend/server.js` → **1 +**.
No schema changes, no writes, no new npm dependencies.
