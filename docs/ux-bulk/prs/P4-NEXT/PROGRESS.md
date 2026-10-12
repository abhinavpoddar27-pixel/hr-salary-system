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
- [ ] P4-02 pipeline links
- [ ] P4-04 DW counts + IST today
- [ ] P4-05 sales compute blockers before compute; upload reason + Go to Compute
- [ ] P4-07 loans tile
- [ ] N-24 explainer room
- [ ] build; check script backend/scripts/next-step-links-check.py (+ --base)
- [ ] self-debug, user sim, push

## Rulings
- none needed (display only, no backend change)
