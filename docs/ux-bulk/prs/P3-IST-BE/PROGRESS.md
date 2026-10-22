# P3-IST-BE — PROGRESS

State: **Phase 3 hand-off — built, verified, pushed. No PR (planner opens it after the independent review of M1, M2, M3, M7).**

## Done
- Re-grep of backend/src (92 raw hits), each classified A / B / C / D (PLAN §2).
- Production read-only counts (PLAN §6): window writes ~1 % of traffic; 0 known wrong money rows.

- Phase 1: `utils/istDate.js`; money sites M1–M9 (M9 = sales.js:1599 found in the Phase 1 re-grep, `.substring(0, 7)` form);
  non-money sites; imports trimmed to used names (dailyWage keeps its own istToday — Q1).
- advance paid_date and on-leave-today now pass the IST date as a SQL parameter (not `date('now','+330 minutes')`),
  so one clock decides and the pinned-clock test can see it.
- Phase 2: `istDateFallbacks.test.js` 15; full jest; --base; Stage 7 sim drift.

## Next
Planner: independent review of M1, M2, M3, M7, then open the PR.

## Rulings (planner, 22 Oct 2026)
- Q1 leave the 5 private IST copies (dailyWage, salaryChange, missPunch, attendanceReviewService, loans/close) — later clean-up.
- Q2 M7 leave /adjust + /bulk-adjust use the IST year.
- Q3 jest with pinned clock + --base proof; no Playwright.
- Q4 usage-logs stays UTC. Q5 accept "no balance" refusal 00:00–00:05 IST 1 Jan. Q6 notification de-dup stays UTC.
- Q7 no action on schema.js:3042. Q8 planner runs independent review of M1, M2, M3, M7. No PR.

## RESUME
Worktree /home/claude/wt-ist-be, branch fix/backend-ist-today (base b2badcab). Build done and pushed. Nothing left for the
builder unless review asks for changes. Later clean-up (Q1): point the private IST copies (dailyWage, salaryChange,
missPunch, attendanceReviewService, loans/close) at utils/istDate. Never `git add -A`.

## CLAUDE.md entry
## Last Session — 2026-10-22 (P3-IST-BE: backend "today" fallbacks use the IST date)
**Branch `fix/backend-ist-today`, NOT merged. Partly MONEY — independent review of M1, M2, M3, M7 before PR.**
Plan + log: `docs/ux-bulk/prs/P3-IST-BE/PLAN.md`, `PROGRESS.md`. Register item from P3-IST Q4. Rulings Q1–Q8 (22 Oct).
- **Bug:** backend fallbacks used the UTC date (`toISOString().slice(0,10)`, `getFullYear()`/`getMonth()`, SQL
  `date('now')`) → yesterday between 00:00 and 05:30 IST, last month on the 1st, last year on 1 Jan.
- **Fix:** new `utils/istDate.js` (`istToday`, `istYearMonth`, `istYear`, `istAddDays`, `istAddMonths`, `IST_TODAY_SQL`;
  fixed +05:30). Money: M1 structure `effective_from` when PUT /employees/:code inserts the first structure; M2 plant Mark
  Left exit date / inactive_since; M3 sales status→Left loan exit date; M4 sales mark-left dol; M5 new sales employee
  structure month (no DOJ); M6 advance `paid_date` (now a parameter, not SQL `date('now')`); M7 leave /adjust +
  /bulk-adjust balance year + ledger reference month/year (Q2); M8 new joiner leave year; M9 sales gross-change structure
  month. Non-money defaults: early-exits (detect "yesterday", future check, range clamp, summary month, trend windows),
  short-leaves quota month, leaves default years + on-leave-today, employees/portal leave year, daily-mis date ×7,
  analytics month/year + 6-month ranges, sales holidays year, settings compliance year, queryTool, lateComing months,
  dailyWage contractor months, phase5Features PF due, flight-risk year, monthEndScheduler (uses its own istParts).
- **Left on purpose:** stored timestamps; notification de-dup "same day" (UTC vs UTC, Q6); usage-logs stats (Q4);
  `schema.js:3042` dead migration (Q7); 5 private IST copies (Q1, later clean-up). No protected file touched.
- **Fragile:** any new business "today"/default month must use `utils/istDate`. Between 00:00 and 00:05 IST on 1 Jan,
  /adjust refuses ("no balance") until the year-boundary cron seeds the new year (Q5). The old year defaults read the
  server's LOCAL zone — they only looked right on a container set to IST.
- **Verified:** new `istDateFallbacks.test.js` 15 (Date-only fake clock, real routers + JWTs; 00:30 IST 11 Oct, 1 Nov,
  1 Jan); passes under TZ UTC / Asia/Kolkata / America/New_York; `--base` on b2badcab under TZ=UTC 10 of 10 route tests
  fail (the explicit-date control passes). Full jest 130/2309 → 131/2324 (TZ=UTC and IST). Stage 7 simulation drift 0.
- **Not tested:** Railway; browser (no frontend change); M3 has no direct test (exit date only reaches the loan flag —
  code read, same one-line swap as M4).
- **Production (read-only, last 6 months):** 1.1 % of API traffic and 303 of 46,711 audit rows fall in 00:00–05:30 IST;
  0 salary structures, 0 gate passes, 3 leave-ledger rows, 0 leaver status rows in that window. No data repair.
- **Found, not fixed:** `early-exits.js /summary` builds `'${company}'` into SQL (pre-existing string interpolation).

