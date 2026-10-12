# P3-IST — PROGRESS

## RESUME
Branch `fix/ist-today-remaining` (base origin/main 8abee969), worktree /home/claude/wt-ist, port 3405.
Read PLAN.md. Owned files only (see PLAN §2A). Do not edit utils/formatters.js, CLAUDE.md, frontend/dist.

## Steps
- [x] Phase 0: code read, full re-scan, PLAN.md written (12 owned sites, register list, backend list, Q1–Q5)
- [x] Planner GO (12 Oct) + rulings Q1–Q5
- [x] jest full suite baseline
- [x] Edits A1–A12
- [x] Build (flock), check script + `--base`
- [x] Self-debug, user simulation, v2
- [x] Merge origin/main, re-run jest + check, push, verify ls-remote

## Owner / planner rulings
Q1 keep JS rollover (no clamp). Q2 swap DailyMIS to todayIST(). Q3 include A4 + A8. Q4 backend fallbacks → register
(planner records P3-IST-BE incl. salary-structure effective_from as money). Q5 appStore.js default → register.

## CLAUDE.md entry
## Last Session — 2026-10-12 (P3-IST: remaining UTC "today" defaults → IST)
**Branch `fix/ist-today-remaining`, NOT merged.** Frontend only. Plan + log: `docs/ux-bulk/prs/P3-IST/PLAN.md`, `PROGRESS.md`.
Follow-up to P2-03. Rulings 12 Oct: Q1 keep JS setMonth rollover; Q2 DailyMIS → todayIST(); Q3 include export filename +
Employee Profile year; Q4 backend fallbacks → register (P3-IST-BE); Q5 appStore default month → register.
- **Bug:** defaults built from `new Date().toISOString()` = UTC date → yesterday between 00:00 and 05:30 IST.
- **Fix (formatters helpers, no formatters.js edit):** GatePasses create date; DW Contractors rate-change effective date;
  Employees Mark Left date + export filename; useDateSelector `date` default; Employee Profile from/to (6 months back via a
  local `minusMonthsIso`, JS rollover: 31 Aug → 3 Mar) + leave-tile year (`istYearMonth`); DW Finance Review "Recently
  Approved" date_from (`addDaysIso(todayIST(), -7)`); Dept Analytics range (same helper); DailyMIS date (was already IST
  by hand → `todayIST()`) and `nextDayAfter` → `addDaysIso`.
- **Fragile:** `minusMonthsIso` is copied in EmployeeProfile.jsx and DeptAnalytics.jsx (formatters.js not owned) — move it
  into formatters.js on its next edit. Any new "today" must use `todayIST()`.
- **Verified:** `backend/scripts/ist-today-remaining-check.py` (Chromium, built dist, browser zone UTC, clock 10 Oct 19:00
  UTC = 00:30 IST, scratch DB, hr/admin/finance, fictional T9601 + Test Gang Alpha, port 3405, server restarted once for the
  login limiter) 24/24 — every site 2026-10-11, profile/dept range 2026-04-11, DW date_from 2026-10-04, 31 Aug edge → 3 Mar,
  1 Nov edge → gate pass Nov + "November 2026", 390 px, 0 page/console errors, 0 API ≥ 400. `--base` on 8abee969 build 10/10:
  UTC 2026-10-10 values (Daily MIS already IST). jest 115/2040 before and after.
- **Not tested:** Railway; Safari/Firefox; the DailyMIS next-day column and the profile leave-tile year in the browser (code read;
  same helpers as P2-03's unit check).
- **Register (not fixed):** appStore.js default month/year (browser zone); getFullYear()/getMonth() defaults in
  SalaryExplainer, LoanImport, LoanActionModals, SalesHolidayMaster, ContractorReport; loanUi.js own +330 copy; backend UTC
  "today" fallbacks (employees.js:872 Mark Left, :580/:317 salary_structures effective_from — money, short-leaves.js:299-300;
  36 lines across 11 route files) → P3-IST-BE.
