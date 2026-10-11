# P2-03 — PLAN (Phase 0)
Base origin/main 80934af4 · branch feat/formatters-ist-today · findings X-14, D-11, P-17, X-11 (part, new-code rule only).

## 1. What is wrong today (FACT, read from code)
| # | Where | Bug |
|---|---|---|
| A | `pages/DailyWageEntry.jsx:67` | `today = new Date().toISOString().slice(0,10)` = UTC date. Used as the default entry date AND as `max={today}` on the date input (L233) and as the edit fallback (L49). Between 00:00 and 05:30 IST the default is YESTERDAY and the picker refuses today's IST date. |
| B | `pages/DailyWagePayments.jsx:26` | Payment date default = UTC date → yesterday between 00:00 and 05:30 IST (goes into `dw_payments.payment_date` and the printed slip). |
| C | `components/common/DateSelector.jsx:36, 95-103` | `singleDate` default + every preset ("today", "yesterday", week Mondays) built with `toISOString()` (UTC) while `getDay()/getMonth()` use the browser zone — mixed clocks. Month-mode "This Month"/"Last Month" use the browser zone, not IST. |
| D | `DateSelector.jsx:110-130` (P-17) | Month mode shows 6 presets; Today / Yesterday / This Week all do exactly what This Month does; Last Week is ≈ This Month too. Only This Month / Last Month mean anything. |
| E | `utils/formatters.js:86` (X-14) | `YEAR_OPTIONS = [2024,2025,2026,2027]` hard-coded — from Jan 2028 the current year is missing from every month selector. |
| F | `pages/FinanceAudit.jsx:525` (Manual Attendance Flags tab, "When" column) | Reads `f.created_at` — **that column does not exist** on `manual_attendance_flags` (schema.js L1181 has `marked_at`; route `SELECT *` … `ORDER BY marked_at`). So the "When" column shows "—" on every row. Even with the right column, `new Date('YYYY-MM-DD HH:MM:SS').toLocaleDateString()` treats the stored UTC time as browser-local (wrong IST date for anything marked 18:30–23:59 UTC), prints in the browser's locale (US browsers → M/D/YYYY, the DD-MM/MM-DD trap), and Safari returns "Invalid Date" for that string shape. |

## 2. Smallest change (owned files only)
1. `utils/formatters.js`
   - `todayIST(now = new Date())` → `'YYYY-MM-DD'` of `now` in Asia/Kolkata. Implementation: `new Date(now.getTime() + 330*60000).toISOString().slice(0,10)` (fixed +05:30, India has no DST; same approach as `loanUi.js:121` and `DailyMIS.jsx:77`; no Intl dependency, so identical in every browser zone).
   - `toIstDateInput(date)` → `'YYYY-MM-DD'` IST for a Date / epoch ms / stored server string (`'YYYY-MM-DD HH:MM:SS'` treated as UTC, like `fmtIstTime`); `''` for empty/invalid. Plain `'YYYY-MM-DD'` input is returned as-is (already a calendar date, no shift).
   - `istYearMonth(now)` helper → `{ year, month }` in IST (used by DateSelector presets + YEAR_OPTIONS).
   - `addDaysIso(iso, n)` small pure helper (UTC arithmetic on a date-only string) for yesterday/week presets.
   - `fmtIstDate(stored)` → `'11-Oct-2026'` (same DD-Mon-YYYY shape as `fmtDate`) for a stored UTC timestamp — used by fix F.
   - `YEAR_OPTIONS` = IST current year −2 … +1 (computed at module load; in 2026 = 2024…2027, unchanged list today).
2. `components/common/DateSelector.jsx`
   - Month mode presets: **This Month / Last Month only** (both IST). Range mode keeps its 6 presets and date mode its 2, but all computed from `todayIST()` + `addDaysIso` (Monday-start week in IST). `singleDate` default `todayIST()`.
   - Year select: `YEAR_OPTIONS`, plus the currently selected year if it falls outside that window (so a store/URL year like 2023 never renders a blank select). Question Q2.
3. `pages/DailyWageEntry.jsx` — `const today = todayIST()` (one line + import). Default, `max`, edit fallback all follow.
4. `pages/DailyWagePayments.jsx` — `useState(todayIST)` (one line + import).
5. `pages/FinanceAudit.jsx:525` — `{f.marked_at ? fmtIstDate(f.marked_at) : '—'}` (one line + import). No other change in that file.

Nothing in backend, store, hooks, or any non-owned page.

## 3. Other UTC "today" sites in the frontend (LISTED, not fixed — not owned)
| File:line | Use | Note |
|---|---|---|
| hooks/useDateSelector.js:21 | `date` state default | feeds pages; only date mode (unused today) |
| components/GatePasses.jsx:206 | gate pass date default | **money-adjacent** (wrong day before 05:30 IST) |
| pages/Employees.jsx:857 | Mark Left date default | wrong exit date before 05:30 IST |
| pages/Employees.jsx:1008 | export filename date | cosmetic |
| pages/EmployeeProfile.jsx:37-38 | range default today / 6 months ago | cosmetic |
| pages/DailyWageContractors.jsx:161 | rate change `effective_date` default | **money-adjacent** (DW rate effective date) |
| pages/DailyWageFinanceReview.jsx:58 | `date_from` filter | filter edge |
| pages/DeptAnalytics.jsx:17-18 | range defaults | cosmetic |
| pages/DailyMIS.jsx:1026 | date maths (check in P9) | — |
| store/appStore.js:57-58 | default month/year = browser zone | browser in IST = fine |
Already IST-correct: components/loans/loanUi.js:121, pages/DailyMIS.jsx:77. Suggest one P9 sweep PR (or extend P2-03 if the planner hands over those files).

## 4. Tests
- `frontend/scripts/` is not a thing — new node script `backend/scripts/ist-today-unit-check.mjs` (imports `frontend/src/utils/formatters.js` as ESM; run with `TZ=UTC node`): todayIST at 2026-10-10T18:29Z (=23:59 IST 10 Oct) → `2026-10-10`; 18:31Z (=00:01 IST 11 Oct) → `2026-10-11`; month/year rollover 2026-12-31T18:31Z → 2027-01-01 / istYearMonth {2027,1}; toIstDateInput on stored `'2026-10-10 19:00:00'` → `2026-10-11`, on `'2026-10-10'` unchanged, on '' / garbage → ''; fmtIstDate; YEAR_OPTIONS; run again with `TZ=America/New_York` and `TZ=Asia/Kolkata` → same answers.
- Playwright `backend/scripts/ist-today-check.py` (Chromium, `timezone_id='UTC'`, `page.clock` fixed at 2026-10-10T19:00Z = 00:30 IST 11 Oct, local dist build, scratch DB, port 3203, real hr/finance/admin logins, fictional data):
  DW Entry date input value = 2026-10-11 and `max` = 2026-10-11; DW Payments payment date = 2026-10-11; a month-mode DateSelector page shows exactly 2 presets (This Month → Oct 2026, Last Month → Sep 2026), year options 2024…2027; Analytics range presets Today/Yesterday = 11/10 Oct; Finance Audit manual-flags "When" shows the IST date for a flag marked at 19:00 UTC; 390 px; 0 page/console errors, 0 API ≥ 400. `--base` on an origin/main build: DW Entry = 2026-10-10, flags "When" = "—", month mode 6 presets.
- jest full suite before/after (frontend-only change; expect unchanged counts).

## 5. Risks
- `YEAR_OPTIONS` is evaluated once at module load: a tab left open across New Year keeps last year's window until reload (acceptable).
- Removing month-mode Today/Yesterday/This Week/Last Week changes muscle memory; behaviour of the remaining two is identical to before when the browser is in IST.
- Fixed +05:30 offset assumes India never adopts DST (true since 1945).
- DW Entry: the **backend** future-date check (`routes/dailyWage.js:317`, `new Date().toISOString()` on Railway = UTC) is NOT owned. After this PR, an entry dated IST-today saved between 00:00 and 05:30 IST is refused by the server ("entry_date cannot be in the future") instead of being blocked by the picker. See Q1.

## 6. Questions for the planner
- **Q1 (blocking for DW Entry):** may I also take `backend/src/routes/dailyWage.js` L317 (one line: compare with IST today, + a jest test)? Without it the fix moves the 00:00–05:30 IST failure from the picker to the Save button. Alternative: ship frontend only and log as a finding.
- Q2: DateSelector year select — include the selected year when it is outside −2…+1 (my proposal), or clamp to the window?
- Q3: OK to also make range/date presets (Analytics range mode) IST — same file, same bug (P-17 names L92)? I plan yes.
- Q4: FinanceAudit L525 — column is `marked_at` (created_at does not exist). Show date only (`11-Oct-2026`) or date + IST time (`11 Oct, 00:30` via existing `fmtIstDateTime`)? I propose date + time since the column is "When".
- Q5: unit-check location — `backend/scripts/ist-today-unit-check.mjs` OK (no frontend test runner exists)?
