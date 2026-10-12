# P4-NEXT — next-step links batch (P4-02, P4-04, P4-05, P4-07, N-24)

Branch `feat/next-step-links-batch4` from origin/main 8abee96. Builder rules: scratchpad BUILDER_RULES.md.

## RESUME
Read this file, then `git log --oneline origin/main..HEAD`. Continue at the first unticked item in "Plan".

## Diagnosis (12 Oct 2026)
- P4-02 (P-12): plain text at MissPunch "Proceed to Stage 3", MissPunch auto-Stage-6 banner ("Run Stage 6 by hand" /
  "Run manually from Stage 6"), NightShift "Proceed to Stage 5", Import result "waiting on N miss punch(es) …" and
  "re-run it from Stage 6" / "Run Stage 6 by hand". ShiftVerification / AttendanceRegister / DayCalculation have no such text.
  Month context = the global store (every pipeline page uses useDateSelector syncToStore) → a plain <Link> keeps the month.
- P4-04 (D-2): DailyWageFinanceReview tab queries run only when their tab is open → counts empty until clicked.
  GET /daily-wage/entries already returns a global `summary` (pending_finance, needs_correction, flagged…), so one
  light call `getDWEntries({limit:1})` gives the counts; "approved last 7 days" = pagination.total of a limit-1 call.
  No backend change. Line ~58 used UTC "today" − 7 → `addDaysIso(todayIST(), -7)`.
- P4-05 (S-4): SalesSalaryCompute renders the readiness banner only in register mode; pre-compute mode returns early
  without it. Fix: one render helper used in both modes; cycle warnings (no upload yet) shown up front with a link to Upload.
  (S-6): SalesUpload Confirm disabled with no reason; after confirm no next step. Add reason text + "Go to Compute" link
  (sets the store month/year/company to the upload's before navigating).
- P4-07 (F-18): Loans tiles have no "Approved — to disburse"; the list already has an `approved` status chip.
  Tile for finance/admin (caps.canPay) = loans in state `approved`, click → Loans tab + Approved filter.
- N-24: SalaryExplainer floating button (fixed bottom-16 right-4) sits over the last rows of the page's scroll area
  (`<main>` in App.jsx Layout, not owned). Fix inside SalaryExplainer.jsx: while the button shows, give `<main>` bottom
  padding so the last row can scroll clear of it (restored on unmount).

## Plan
- [x] PROGRESS.md
- [x] P4-02 pipeline links (9001246)
- [x] P4-04 DW counts + IST today (3b19be6)
- [x] P4-05 sales compute blockers before compute; upload reason + Go to Compute (6ef4825)
- [x] P4-07 loans tile (9651917)
- [x] N-24 explainer room (5fa71b7)
- [x] build; check script backend/scripts/next-step-links-check.py 51/51, --base 28/28 (c773768)
- [x] self-debug (toast wording "Phase 3 compute" → plain), user sim (the check is the happy path + edges), push

## Found while testing (fixed here, same files)
- Sales upload preview refetch after a manual match got the browser's 5-second copy (server.js max-age=5) → the
  row stayed "Unmatched" and Confirm stayed off. New helper `salesUploadPreviewFresh` (no-cache), added next to
  `salesUploadPreview` (old helper left in place, now unused). `--base` proves it (Confirm still off right after linking).
- Compute page readiness (staleTime 30 s) kept "no coordinator upload yet" after an upload → confirm + template upload
  invalidate `['sales-readiness']`.

## Regression runs
misspunch-banner 33/33 · nightshift-reject-confirm 44/44 · fresh-reads 39/39 · sales-neft-confirm 40/40 ·
import-month 38/38 · loans-ui-browser-check 235/236 and 234/236 (the failing items differ per run and also fail on
origin/main: "close tab (sales) confirm names the sales payroll", "bulk: …" — count() without a wait; not this PR).

## Not done / notes
- MissPunch auto-Stage-6 banner when automation is ON and waiting shows the two counts as buttons (no Stage 6 link —
  Stage 6 runs by itself there). ShiftVerification / AttendanceRegister / DayCalculation had no next-step text.
- The Import "waiting on N" check intercepts the upload response (rendering only); the import itself is covered by
  import-month-check.py.
- At 390 px Miss Punch still scrolls sideways (known mobile item).

## CLAUDE.md entry
## Last Session — 2026-10-12 (P4-NEXT: next-step links, DW queue counts, sales blockers + Go to Compute, loans to-disburse tile, explainer room)
**Branch `feat/next-step-links-batch4`, NOT merged.** Frontend only. Plan + log: `docs/ux-bulk/prs/P4-NEXT/PROGRESS.md`. Findings P-12, D-2, S-4, S-6, F-18, N-24.
- **P4-02:** Miss Punch "Go to Stage 3", Night Shift "Go to Stage 5", Stage 6 links in the auto-Stage-6 banner, its waiting counts open their chip; Import "waiting on N with HR / finance" → `/pipeline/miss-punch?state=hr-pending|finance-pending` (MissPunch honours known `?state=` keys). Month = global store.
- **P4-04:** DW Finance Review count cards (pending / needs correction / flagged / approved 7 d) from GET /entries `summary` (limit 1) — load with the page; tab badges same counts; 7-day window = `addDaysIso(todayIST(), -7)`.
- **P4-05:** Sales Compute readiness banner in pre-compute mode too; cycle warning "no upload" shown up front + Upload link. Sales Upload: plain reason under a disabled Confirm; after confirm "Go to Compute" (sets store month/year/company to the upload's). Preview read is now no-cache (`salesUploadPreviewFresh`) — a match used to look undone for 5 s; confirm/template upload invalidate `['sales-readiness']`.
- **P4-07:** Loans tile "Approved — to disburse" (finance/admin = `caps.canPay`): count + ₹ principal of `approved` loans; click → Loans tab, Approved filter.
- **N-24:** while the Salary Explainer button shows, `<main>` gets 7rem bottom padding (set/restored from SalaryExplainer.jsx).
- **Fragile:** N-24 padding is set on `document.querySelector('main')` (Layout in App.jsx) — a second `<main>` or a Layout change breaks it. DW counts rely on GET /entries returning the whole-table `summary`.
- **Verified:** `backend/scripts/next-step-links-check.py` 51/51 (hr + finance, built dist, 1440 + 390 px, 0 errors / 0 API ≥ 400); `--base` on 8abee96 28/28 (no links, no pre-compute banner, no reason, stale preview, explainer covers the last row). No backend source change (jest not affected).
- **Not tested:** Railway; Safari/Firefox; the real import path for the "waiting on" line (response intercepted).


## Rulings
- none needed (display only, no backend change)
