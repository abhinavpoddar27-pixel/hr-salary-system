# PR — Contractor Report 2.1

**Branch:** `feat/contractor-report-2-1` → `main` (base `3f0041f`, the PR #44 squash merge of PR-2)
**Read-only.** No writes, no schema change, no new dependency, no lockfile change, no new route or nav.

---

## What changes

### A · Grid View shows the people who worked
The grid was built from `attendance_processed`, so it listed whoever had a *row* — and a gang that
worked no days at all rendered as an empty table. It now opens on the people who actually worked,
with **"Show people with no punch this month (N)"** (off by default) revealing the idle Active
roster, greyed, under a **"No punch this month"** divider. The split is the primary sort key, so it
holds under every sort the tab offers. Title reads `<Contractor> · <Month> · X worked · Y no punch`.

The grid's contractor picker had to be widened too: `report.contractors` is "who appears in this
month's data", so **Moti Lal's 18 idle workers could not be selected at all** — precisely the gang
this split exists to show. A separate `gridContractors` adds anyone with an Active roster, filtered
to names the `/grid` route accepts. `contractors` itself is untouched, so the header filter, the
per-contractor totals and every exception list behave exactly as before.

### B · New exception — "Active on roster, no punch for 30+ days"
Active population employees whose last day of weight > 0 is more than 30 days before today, or who
never punched. Measured against **today, not the selected month** — a roster that has gone stale
does not become fresh because you paged back to April. Sorted longest-silent first, never-punched
on top. Someone hired days ago and yet to punch is not flagged; with no joining date on record they
are. Flag only — nothing here writes, and marking people Left stays in Employees.

### C · The payroll tie-out uses payroll's own status rule
Stage 6 reads `effectiveStatusForDay()`, which ignores an HR miss-punch resolution until Finance
approves it. This report reads `status_final`. The two disagree on exactly the rows where a
correction is still awaiting Finance — **all ten of September 2026's "mismatches" were false**,
explained by eleven Gate Register corrections that turned a punched `P` into an `A`.

`effectiveStatusForDay` is exported and pure, so it is **imported, not mirrored**, and
`dayCalculation.js` is untouched. The section splits in two:

- **HR corrections waiting for Finance** — code, name, contractor, date, punched as, HR marked as,
  source, finance status. Only rows where the two views actually differ; a resolution landing on the
  same status cannot move a man-day.
- **Biometric days don't match payroll days** — the genuine remainder only.

In Grid View a pending day carries a dashed amber outline and the panel reads *"Punched P; HR marked
A from Gate Register; Finance review pending — payroll still pays this day as P."*
**Heads and man-days everywhere else still read `status_final`.**

---

## Verification

**Production, read-only — all 11 acceptance checks reproduced exactly, zero drift:**

| Check | Expected | Actual |
|---|---|---|
| Sept: the 10 "mismatches" | 0 unexplained | **0** |
| Sept: pending correction days | 11, exact dates | **11**, exact |
| Sept: company-wide P/WOP→A pending | 20 | **20** |
| May: unexplained | 1 — 60298 RANI 19 vs 22 | **1**, 19 vs 22 |
| April: unexplained | 0 | **0** |
| April/May heads + man-days (PR-2) | 2278/1951/327, 2238; 2590/2197/393, 2587.5 | all exact |
| Active contract employees | 320 | **320** |
| No punch 30+ days | 231, incl. 7 never | **231**, **7** |
| Gangs with no Sept punch | 9 gangs | exact |
| Meera September grid | 51 worked · 124 no punch | **51 · 124** |

April–August miss punches are **all finance-approved**, so change C is provably a no-op for the
PR-2 baseline — that is why April stays at 0 and May keeps its single genuine mismatch.

- **27 assertions** replaying the real September rows of all ten flagged employees through the
  service: 11 corrections, 0 unexplained, every one of the ten now ties.
- **88 contractor-report unit tests** (50 from PR-2, unchanged and passing).
- **341 backend tests** — 3 TDS + the flaky `protectedWrite`, the documented baseline, unchanged.
- **36 browser checks** driving the built page in Chromium: toggle on/off, a gang with nobody
  working, a pending-correction cell, both new sections, and the April/May regression.

## Code review
Run at high effort: **13 findings, all fixed**, each locked by a regression test (R1–R8). Two were
reachable on production data — a day with no status at all was painted as awaiting Finance (**318
such cells in December 2025**), and payroll's `HP` half-day was weighed at zero, manufacturing the
exact false mismatch this PR removes. Full table in `docs/progress/contractor-report-2-1.md`
RULING 6.

## Files
`backend/src/config/contractorReportConfig.js` · `backend/src/services/contractorReport.js` ·
`backend/src/__tests__/contractorReport.test.js` · `frontend/src/pages/ContractorReport.jsx` ·
`frontend/src/components/contractorReport/{GridViewTab,ExceptionsTab}.jsx` · `frontend/dist` · docs.

**DO-NOT-MODIFY diff: empty. Lockfile and package.json diff: empty.** `server.js`, `App.jsx`,
`Sidebar.jsx` and `routes/contractorReport.js` are untouched.
