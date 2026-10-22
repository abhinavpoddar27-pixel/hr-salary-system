# P3-IST-BE — backend "today" fallbacks use the IST date (PLAN, Phase 0)

Branch `fix/backend-ist-today` off main b2badcab. Port 3505. Partly MONEY.

## 1. Problem
The server clock is UTC. A fallback written as `new Date().toISOString().slice(0,10)` / `.split('T')[0]`,
`new Date().getFullYear()` / `getMonth()+1`, or SQL `date('now')` gives the UTC date. Between 00:00 and 05:30 IST
that is **yesterday** (and on the 1st of a month / 1 January, last month / last year). The frontend side was done in
P2-03 / P3-IST (#134, #159); this PR does the backend register (P3-IST Q4).

## 2. Full re-grep (backend/src, routes + services, tests excluded)
Patterns: `toISOString().slice(0,10|7)`, `.split('T')[0]`, `.substring(0,10|7)`, `new Date().getFullYear()`,
`getMonth()`, `now.getDate()`, `date('now')`, `CURRENT_DATE`, `datetime('now')` used as a date. 92 raw hits;
each read in context. Line numbers are on b2badcab.

### (A) Business date / period default that must be IST today → FIX
**Money / money-adjacent (flagged — independent review recommended):**
| # | Site | What it decides |
|---|---|---|
| M1 | `routes/employees.js:595` (PUT /:code, no structure exists) | `salary_structures.effective_from` of a newly inserted structure (+ `carryFlags` date). Money. |
| M2 | `routes/employees.js:874` (PUT /:code/mark-left, no `date_of_leaving`) | `date_of_exit` + `inactive_since` → loan final month (`finalMonthOf` reads exit_date), Stage 6 reactivation cutoff. |
| M3 | `routes/sales.js:1661` (sales PUT status → Left/Exited, no `dol`) | `exitDate` passed to `flagSalesBorrowerForExit` → sales loan final cycle. |
| M4 | `routes/sales.js:1696` (sales mark-left, no `dol`) | stored `dol` + loan final cycle (UI always sends `dol` since P1-19; API callers only). |
| M5 | `routes/sales.js:1493` (sales POST /employees, no DOJ) | first `sales_salary_structures.effective_from` (YYYY-MM). On the 1st 00:00–05:30 IST → last month. |
| M6 | `routes/advance.js:69, :85` (mark advance paid) | `salary_advances.paid_date = date('now')` → IST date. Record only (recovery keys on month/year). |
| M7 | `routes/leaves.js:501, :524-535, :627, :649-653, :670` (/adjust, /bulk-adjust) | which YEAR's leave balance is moved + the ledger row's month/year. On 1 Jan 00:00–05:30 IST it moves last year's EL (paid leave). |
| M9 | `routes/sales.js:1599` (sales PUT /employees/:code, gross changed, no `effective_from`) | month of the new sales structure version (found in Phase 1 re-grep: `.substring(0, 7)` form). On the 1st 00:00–05:30 IST → last month's cycle. Money. |
| M8 | `routes/employees.js:338` (POST /employees) | year of the opening leave balance + CL pro-rata for a new joiner. |

**Non-money (default period / "today" checks):**
- `routes/short-leaves.js:299-300` quota default month/year.
- `routes/early-exits.js:84` detect default "yesterday", `:88` future-date refusal, `:130` range clamp to today,
  `:219-220` summary default month/year, `:246-261` 30/60-day trend windows, `:295-310` 4×30-day windows.
- `routes/leaves.js:425, :457, :686, :706` default year; `:795` SQL `date('now') BETWEEN start_date AND end_date`
  (on-leave-today list — shows yesterday's leavers until 05:30 IST).
- `routes/employees.js:284, :612, :627`; `routes/employeePortal.js:51` default leave year.
- `routes/daily-mis.js:20, 42, 54, 66, 78, 101, 175` default date (UI sends a date; API fallback).
- `routes/analytics.js:580-581, 725-726` default month/year; `:819/824, 861/866, 903/908, 931/936` default range.
- `routes/sales.js:1863` holidays year; `routes/settings.js:281` compliance year; `routes/queryTool.js:107-108`.
- `routes/lateComing.js:317` last-N-months tuples (UTC month).
- `routes/dailyWage.js:1544, 1554, 1673` contractor "this month" + trend months (server-local = UTC month).
- `services/phase5Features.js:302` days until PF due date.
- `services/patternEngine/flightRiskPatterns.js:114` leave-balance year.
- `services/monthEndScheduler.js:36-48` `checkPipelineStatus` day-of-month / which month to check (same file already
  has an `istParts()` helper at :103 — reuse it).

### (B) Stored timestamp or internally-consistent UTC comparison → LEAVE
- every `datetime('now')` column default / `*_at = datetime('now')` (schema + routes).
- notification de-dup "same day": `services/leaveTriggers.js:41`, `services/monthEndScheduler.js:23`,
  `services/loans/notify.js:13` — compare a UTC `created_at` against the UTC day, so they agree with each other.
  (Effect: de-dup window runs 05:30→05:30 IST. Harmless.)
- `routes/usage-logs.js:56, 64, 107, 115, 138` — admin usage stats on UTC `created_at` (see Q4).
- `services/backupScheduler.js:44` commit message; `services/loans/close.js:69` `sqlUtc`; `dryRun.js:349` id;
  `services/recompute.js:382` run id; `salaryComputation.js:1186` `generatedAt`.

### (D) Not "today" — date arithmetic on a given date → LEAVE
`patternEngine/individualPatterns.js:46,51`, `dailyMIS.js:213,477`, `advanceCalculation.js:54`,
`attendanceReviewService.js:253`, `leaveEngine.js:74,187`, `early-exits.js:144, 515-519`, `phase5.js:175`,
`attendance.js:11`, `bulk/kinds/extraDuty.js:34`, `dailyWage.js:33`, `contractorReport.js(route):50`,
`deptAnalyticsService.js:120`, `orgMetricsService.js:280` (local-midnight month end — correct only while the
server TZ is UTC; noted, not changed).

### Already IST (no change)
`dailyWage.js istToday`, `salaryChange.js istToday` (salary approval effective date — N-17/F-b already fixed),
`missPunch.js istToday`, `attendanceReviewService.js istToday`, `leaveEngine.js istToday` (returns an object),
`loans/months.js todayIst`, `loans/close.js istToday`, `loans/reconcile.js istDate`, `loans/reports.js istMonthNow`,
`earlyExitDetection.js`, `contractorReport.js` (SQL `date('now','+05:30')`), `monthEndScheduler.js istParts`.
Loans engine dates and ED / DW dates are already IST → no money change there.

### (C) Protected files — LIST ONLY, not touched
- `database/schema.js:3042` — one-time sales structure backfill migration (`migration_sales_structures_backfill_indriyan_v1`,
  already ran in production) uses the UTC month for orphans without DOJ. Dead after its flag; leave.
- `services/dayCalculation.js:430` — date iteration (D). `services/recompute.js:382`, `salaryComputation.js:1186` — (B).
- `routes/payroll.js` — no UTC-today site found.

## 3. The change (smallest)
1. **New `backend/src/utils/istDate.js`** (no deps):
   `istToday(now = Date.now()) → 'YYYY-MM-DD'`, `istYearMonth(now) → {year, month}`, `istYear(now)`,
   `istAddDays(iso, n)`, and `IST_TODAY_SQL = "date('now','+330 minutes')"`. Fixed +05:30, no DST, same formula as
   the existing copies (`Date.now() + 330*60000`, UTC fields).
2. Replace each (A) site with the helper — a one-line change per site, logic otherwise unchanged
   (e.g. early-exits "yesterday" = `istAddDays(istToday(), -1)`; trend windows end at `istToday()`).
3. Existing private copies are left as they are (Q1 offers repointing them to the helper).
4. No schema change, no frontend change, no protected file.

## 4. NOT touched
Protected files (§2 C); (B) timestamps; loans engine; ED finance-review; any response shape; frontend.

## 5. Tests
- New `backend/src/__tests__/istDateFallbacks.test.js`, clock pinned with `jest.useFakeTimers().setSystemTime`:
  - helper: 2026-10-10T19:00Z → '2026-10-11'; 2026-10-10T18:29Z → '2026-10-10'; 2026-12-31T19:00Z → year 2027,
    month 1; 2026-10-31T19:00Z → {2026, 11}.
  - routes on a scratch DB through the real router + real JWT (existing pattern, e.g. markLeftRoleGuard.test.js):
    M2 Mark Left no date → `date_of_exit` '2026-10-11'; M4 sales mark-left no dol → '2026-10-11'; M1 PUT with basic/da
    and no structure → `effective_from` '2026-10-11'; M6 mark advance paid → paid_date '2026-10-11'; M7 /adjust at
    2026-12-31T19:00Z → balance row year 2027; leaves on-leave-today includes a leave starting 2026-10-11;
    early-exits detect with date '2026-10-11' at 00:30 IST not refused as future; short-leaves quota default month
    11 at 2026-10-31T19:00Z.
  - Each route test must FAIL on b2badcab (run the suite against an origin/main worktree = `--base`).
- Full jest suite under `flock /tmp/jest.lock`.
- No frontend change → no Playwright script (Q3). A node check script `backend/scripts/ist-be-check.js` cannot move
  the real server's clock without a test knob; jest with fake timers is the proof.
- Money: drift query on the scratch DB after the suite (no compute path changes; expect 0).

## 6. Production impact (read-only, counts only, last 6 months)
| Table | rows written | of them 18:30–24:00 UTC (00:00–05:30 IST) |
|---|---|---|
| usage_logs (all API traffic) | 263,533 | 2,841 (1.1 %) |
| audit_log | 46,711 | 303 |
| salary_structures | 537 | 0 |
| short_leaves | 74 | 0 |
| leave_transactions | 15 | 3 |
| audit_log Mark Left / status rows (plant 71, sales 109) | 180 | 0 |
| employees / sales leavers whose exit date = the UTC day of the write, written in the window | — | 0 / 0 |
| salary_advances paid (no time column — cannot size) | 992 | n/a |
So: no stored money-relevant row is known to be wrong today; this PR prevents future ones. No data repair.

## 7. Risks
- A site that silently relied on the UTC date for an exact match with a UTC-stored value. Each (A) site compares
  against a stored business date (YYYY-MM-DD / month / year), not a timestamp — checked per site. The (B) list is the
  ones where this would bite, and they are left alone.
- `leaves.js /adjust` on 1 Jan 00:00–05:30 IST now moves the NEW year's balance — that row may not exist yet
  (seeded at 00:05 IST by the year-boundary cron, ok after 00:05). Before 00:05 IST it returns the guard's
  "no balance" refusal instead of moving last year's (Q5).
- Copies of the same formula remain in 7 files (Q1).

## 8. Questions
- **Q1** Repoint the existing private copies (`dailyWage.js`, `salaryChange.js`, `missPunch.js`,
  `attendanceReviewService.js`, `loans/close.js`) to the new helper in this PR, or leave them (zero-risk)? Loans is
  "DO NOT MODIFY engine" — my default: leave all copies, only new sites use the helper.
- **Q2** M7 leave /adjust & /bulk-adjust year: OK to switch to the IST year (money-adjacent: EL is paid leave)?
- **Q3** OK that verification is jest-only (fake clock) with `--base` on an origin/main worktree, no Playwright script
  (no frontend change)?
- **Q4** `usage-logs.js` "today / last 7 / 30 days" — leave on UTC (admin stats, B) or shift to IST windows
  (`created_at >= datetime(<IST today>,'-330 minutes')`)? Default: leave.
- **Q5** /adjust between 00:00 and 00:05 IST on 1 Jan: accept "no balance row" refusal (default), or fall back to
  last year?
- **Q6** Notification de-dup (B) left on UTC day — confirm.
- **Q7** `schema.js:3042` (dead one-time migration) — list only, confirm no action.
- **Q8** Independent money review before PR (M1–M8)? Recommended for M1/M2/M3/M7.
