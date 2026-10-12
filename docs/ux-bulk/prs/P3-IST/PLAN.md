# P3-IST — remaining UTC "today" sites → IST (PLAN, Phase 0)

Branch `fix/ist-today-remaining` on origin/main 8abee969. Worktree `/home/claude/wt-ist`. Port 3405.
Follow-up to P2-03 (#134), which added `todayIST()`, `toIstDateInput()`, `istYearMonth()`, `addDaysIso()`,
`isoDayOfWeek()` in `frontend/src/utils/formatters.js` (NOT edited here — every helper needed already exists).

## 1. The bug
`new Date().toISOString().slice(0,10)` (or `.split('T')[0]`) is the **UTC** date. Between 00:00 and 05:30 IST it is
yesterday, so every default "today" below is one day behind for 5½ hours a day. Date maths done with local
`setMonth/setDate` and then `toISOString()` has the same shift.

## 2. Site list (full re-scan of frontend/src)
Scan: `grep -rnE "toISOString\(\)\.(slice|split|substring)|new Date\(\)\.get(Month|FullYear|Date)\(" frontend/src`
plus a read of every `new Date(`/`getDate()`/`getMonth()` in the owned files.

### A. Owned — will fix (smallest change: one helper call each)
| # | File:line | What it is | Change |
|---|---|---|---|
| A1 | components/GatePasses.jsx:207 | Create Gate Pass default date | `useState(() => todayIST())` |
| A2 | pages/DailyWageContractors.jsx:161 | Rate change `effective_date` default | `effective_date: todayIST()` |
| A3 | pages/Employees.jsx:857 | Mark Left "date of leaving" default | `useState(() => todayIST())` |
| A4 | pages/Employees.jsx:1008 | Excel export filename date | `const dateStr = todayIST()` |
| A5 | hooks/useDateSelector.js:21 | `date` state default (no current consumer destructures `date`; DateSelector itself is IST since P2-03) | `useState(() => todayIST())` |
| A6 | pages/EmployeeProfile.jsx:37 | Profile "to" date default | `todayIST()` |
| A7 | pages/EmployeeProfile.jsx:38 | Profile "from" = 6 months back | `minusMonthsIso(todayIST(), 6)` — small local helper, UTC calendar maths on the IST date (same `setMonth` overflow semantics as today: 31 Aug − 6 → 3 Mar) |
| A8 | pages/EmployeeProfile.jsx:369 | Leave Register "this year" filter (`getFullYear()`, browser zone) | `istYearMonth().year` |
| A9 | pages/DailyWageFinanceReview.jsx:57-58 | "Recently approved" = last 7 days `date_from` | `addDaysIso(todayIST(), -7)` |
| A10 | pages/DeptAnalytics.jsx:15-18 | Range default today / today − 6 months | `todayIST()` + same 6-month helper as A7 |
| A11 | pages/DailyMIS.jsx:73-77 | Selected date default — ALREADY correct (manual +5:30 incl. zone offset) | replace with `todayIST()` — same value, one helper (Q2) |
| A12 | pages/DailyMIS.jsx:1021-1027 `nextDayAfter` | D+1 via local `setDate` on `T12:00` then UTC | `addDaysIso(dateStr, 1)` — same value in IST; wrong only in zones ≥ +12 today |

The 6-month helper (A7, A10) is defined locally in each of the two files (2 lines; formatters.js not owned):
`const d = new Date(\`${iso}T00:00:00Z\`); d.setUTCMonth(d.getUTCMonth() - n); return d.toISOString().slice(0,10)`.

### B. Not owned — register only (local browser zone; correct on IST PCs, wrong only if the browser is not in IST)
- store/appStore.js:57-58 `selectedMonth/selectedYear` default from `new Date()` local → `istYearMonth()` (global month picker default).
- components/SalaryExplainer.jsx:306, components/loans/LoanImport.jsx:80, components/loans/LoanActionModals.jsx:83,
  pages/Sales/SalesHolidayMaster.jsx:165 + :212, pages/ContractorReport.jsx:38-39 — `getFullYear()/getMonth()` local.
- components/loans/loanUi.js:121 — already IST (own +330 min copy); could use `todayIST()`.
- Timestamps (`new Date().toISOString()` full) in sessionTracker.js / apiContextBuffer.js — correct, not dates.

### C. Backend (no file owned) — for a ruling; none blocks this PR
None of the owned flows has a server-side "is it today / future" check: gate pass create allows any date (backdating
open), DW rate change accepts any `effective_date`, Mark Left uses the body date. UTC "today" is only a FALLBACK:
- routes/employees.js:872 Mark Left `exitDate = date_of_leaving || UTC today` (UI always sends a date → unreachable from UI).
- routes/employees.js:580 and :317 (`date('now')`) — new salary_structures `effective_from` = UTC date (structure written
  00:00–05:30 IST is dated yesterday). Money-adjacent (in-force row selection) — separate PR.
- routes/short-leaves.js:299-300 quota month default when no `month` query (server zone = UTC on Railway).
- Total `toISOString().slice(0,10)`/`split('T')[0]` lines in backend/src/routes: 36 across 11 files (employees, early-exits,
  usage-logs, phase5, dailyWage, attendance, analytics, sales, daily-mis, contractorReport, salary-input). Most are
  timestamps/filenames/fallbacks; needs its own audit PR (suggested P3-IST-BE).

## 3. Tests
- `backend/scripts/ist-today-remaining-check.py` (new; pattern `ist-today-check.py`): Chromium, built dist, scratch DB,
  browser zone UTC, page clock 2026-10-10 19:00 UTC = 00:30 IST 11 Oct, port 3405, hr + finance/admin logins, fictional
  data only. Checks: Gate Pass modal date = 2026-10-11 and the "Allowance for October 2026" label; DW Contractors rate
  modal effective date = 2026-10-11; Employees Mark Left date = 2026-10-11; Employee Master export filename contains
  2026-10-11 (download intercepted); Employee Profile from/to = 2026-04-11 / 2026-10-11 and leave tiles filter year 2026;
  Dept Analytics range 2026-04-11 → 2026-10-11 (request params); DW Finance Review approved-tab request `date_from=2026-10-04`;
  Daily MIS selected date 2026-10-11 and next-day text; one month-boundary clock (2026-10-31 19:00 UTC = 1 Nov 00:30 IST →
  Gate Pass label November); 390 px; 0 page/console errors, 0 API ≥ 400. `--base` on an origin/main build: the UTC
  2026-10-10 values reproduced.
- A tiny node unit check for the 6-month helper (31 Aug, 31 Mar, 11 Oct, 29 Feb leap) inside the same script or a .mjs.
- jest full suite before and after (no backend change → expect identical).

## 4. Risks
- No behaviour change except the default date. DailyMIS A11/A12 values are identical in IST — pure consolidation.
- A7/A10 overflow semantics kept on purpose (Q1). A5 has no consumer today (safe).
- Employees.jsx: only the two date lines change (shared with other builders by "date lines only" rule).
- Clock trick only moves the page clock; server stays real-time — fine because no server rule is involved.

## 5. Questions for the planner
- Q1. 6-months-back: keep JS overflow semantics (31 Aug → 3 Mar) or clamp to month end (→ 28/29 Feb… 31 Mar)? Proposed: keep.
- Q2. DailyMIS:73-77 is already correct — consolidate to `todayIST()` (proposed) or leave untouched?
- Q3. A8 (EmployeeProfile:369 `getFullYear`) and A4 (export filename) are beyond the listed sites — include (proposed)?
- Q4. Backend fallbacks in §2C: register only (proposed), none in this PR.
- Q5. appStore.js default month/year (§2B) — register, or hand to whoever owns appStore?
