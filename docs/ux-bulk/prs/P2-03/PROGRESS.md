# P2-03 PROGRESS
## RESUME
Branch feat/formatters-ist-today · worktree /home/claude/wt-p2-03 · port 3203. Read PLAN.md. Owned: utils/formatters.js,
components/common/DateSelector.jsx, pages/FinanceAudit.jsx (L525 only), pages/DailyWageEntry.jsx, pages/DailyWagePayments.jsx.
## Steps
- [x] Phase 0: code read, PLAN.md written (questions Q1–Q5); planner said go 11 Oct.
- [x] jest baseline: 105 suites / 1649 tests
- [x] formatters.js helpers + YEAR_OPTIONS
- [x] DateSelector presets / years
- [x] DW Entry + Payments
- [x] FinanceAudit L525
- [x] backend dailyWage.js L317 IST + dwEntryIstToday.test.js 3 (1 fails on old route)
- [x] unit check `backend/scripts/ist-today-unit-check.mjs` 24/24 under TZ=UTC, America/New_York, Asia/Kolkata, Pacific/Kiritimati
- [x] Playwright `backend/scripts/ist-today-check.py` 26/26; `--base` on an 80934af4 build 12/12 (UTC dates, 6 month presets, flags "When" = —)
- [x] merged origin/main (no owned file touched); jest 108 suites / 1672 after merge; checks re-run 26/26, 24/24, 3/3; pushed
## Rulings
Planner 11 Oct: go. Q1 yes (own dailyWage.js future-date line + jest). Q2 keep selected year. Q3 IST for range/date presets. Q4 date + IST time (fmtIstDateTime). Q5 OK. Other UTC sites stay findings.
## CLAUDE.md entry
## Last Session — 2026-10-11 (P2-03: IST "today", DateSelector month presets + year window, DW dates, Finance Audit flag time)
**Branch `feat/formatters-ist-today`, NOT merged.** Plan + log: `docs/ux-bulk/prs/P2-03/PLAN.md`, `PROGRESS.md`. Findings D-11, P-17, X-14 (+ FinanceAudit:525).
- **Bugs:** "today" was `new Date().toISOString().slice(0,10)` = the UTC date, so between 00:00 and 05:30 IST it was yesterday:
  Daily Wage Entry default date AND its `max` (today's IST date could not be picked), DW Payments payment date, every
  DateSelector preset (range/date mode mixed UTC dates with browser-zone weekdays). Month mode had 6 presets, 4 of which
  just meant "this month". `YEAR_OPTIONS` was hard-coded 2024–2027. Finance Audit → Attendance Flags "When" read
  `f.created_at`, a column `manual_attendance_flags` does not have (`marked_at`) → "—" on every row. Backend
  `routes/dailyWage.js` validateEntryRow judged "future" on the server's UTC date, so an IST-today entry saved before
  05:30 IST was refused.
- **Fix:** `utils/formatters.js` adds `todayIST()`, `toIstDateInput()` (stored server time read as UTC; plain YYYY-MM-DD
  unchanged), `istYearMonth()`, `addDaysIso()`, `isoDayOfWeek()`; fixed +05:30 (no Intl, no DST). `YEAR_OPTIONS` = IST
  year −2…+1 (computed at load). DateSelector: month mode shows This Month / Last Month only; all presets + the date
  default are IST; a selected year outside the window is kept in the list (ruling Q2). DW Entry `today = todayIST()`,
  DW Payments `useState(() => todayIST())`. FinanceAudit L525 → `fmtIstDateTime(f.marked_at)` ("11 Oct, 00:30").
  dailyWage.js L317 → IST today (planner ruling Q1). No dist committed.
- **Fragile:** `YEAR_OPTIONS` is fixed for the life of the tab (a tab open over New Year keeps last year's window until
  reload). Month-mode Today/Yesterday/This Week/Last Week are gone by design. Any new "today" must use `todayIST()`.
- **Verified:** jest 105/1649 → 108/1672 (after merging origin/main; new `dwEntryIstToday.test.js` 3, the 00:30 IST
  accept test fails on the old route). `TZ=… node backend/scripts/ist-today-unit-check.mjs` 24/24 in 4 zones.
  `backend/scripts/ist-today-check.py` (Chromium, built dist, browser zone UTC, clock 10 Oct 19:00 UTC = 00:30 IST,
  hr/admin/finance, fictional contractor + T9701, port 3203) 26/26 — DW Entry value + max 2026-10-11, month presets 2,
  Last/This Month, years 2024–2027, remembered 2023 kept and selectable, Analytics range Today/Yesterday/This Week/Last
  Month in IST, DW Payments date, flags "When" = "11 Oct, 00:30", 390 px, 0 page/console errors, 0 API ≥ 400.
  `--base` on 80934af4 12/12: UTC dates, 6 presets, "When" = "—".
- **Not tested:** Railway; Safari/Firefox; a real DW save from the browser before 05:30 IST (server clock is real; covered by jest).
- **Found, not fixed (other UTC "today" sites, not owned):** GatePasses.jsx:206 (pass date), DailyWageContractors.jsx:161
  (rate effective_date), Employees.jsx:857 (Mark Left date) + :1008, useDateSelector.js:21, EmployeeProfile.jsx:37-38,
  DailyWageFinanceReview.jsx:58, DeptAnalytics.jsx:17-18, DailyMIS.jsx:1026. Also: FinanceAudit flags table reads
  `f.verified` (likely not a column — `verified_by` carries it).
