# FRESH PROGRESS

## RESUME
Branch fix/manual-flags-fresh (base b0ed242), worktree /home/claude/wt-fresh (node_modules symlinked to wt-p6-06), port 3504.
Read PLAN.md + this file. State: BUILD DONE, verified, pushed. Nothing open on this branch.

## Planner rulings (16 Oct 2026)
- Q1 yes: delete the local copy in FinanceAudit.jsx; use the api.js helper with `fresh`; keep the instant cache patch;
  replace the 6 s timer with an immediate re-read.
- Q2 not now: the other 10 reads without `fresh` and the 16 bare-array `invalidateQueries([...])` calls are registered by
  the planner as a separate PR.

## Steps
- [x] B1 api.js L380 `...fresh` + comment
- [x] B2 FinanceAudit.jsx: local `getManualAttendanceFlagsFresh` removed, both queries (tab + badge) use
      `getManualAttendanceFlags`, timer → immediate `invalidateQueries({ queryKey: ['manual-flags'] })`, unused `import api` removed
- [x] B3 build + `backend/scripts/manual-flags-fresh-check.py` 20/20; --base on b0ed242 2/2; regression role-gaps 36/36,
      attendance-flags-verify-role 21/21
- [x] B4 jest 121/2172 (no backend change; run on the P6-06 tree, same base); push

## CLAUDE.md entry
## Last Session — 2026-10-16 (FRESH: Attendance Flags list read via api.js with no-cache; re-read at once after Verify)
**Branch `fix/manual-flags-fresh`, NOT merged.** Frontend only (`utils/api.js` 1 line, `pages/FinanceAudit.jsx` Attendance
Flags lines). Plan + log: `docs/ux-bulk/prs/FRESH/PLAN.md`, `PROGRESS.md`. Register item from P3-RG. Rulings Q1–Q2 (16 Oct).
- **Before:** `getManualAttendanceFlags` (api.js) sent no no-cache and had 0 callers; the page used a local no-cache copy
  (9e7cd18) and still re-read the list 6 s after a Verify (#160 workaround; the timer also fired after leaving the tab).
- **Now:** api.js helper sends `fresh`; the tab and its badge use it (same request, same query key); after a Verify the row is
  marked in the cache from the 200 (kept) and the list is re-read straight away; local copy and unused `import api` removed.
- **Fragile:** the cache patch still mirrors the fields the verify route writes (finance_verified, verified_by, finance_remarks).
- **Verified:** `backend/scripts/manual-flags-fresh-check.py` (Chromium, built dist, scratch DB, finance + hr, fictional T958x,
  port 3504) 20/20 — every list GET no-cache; Verify → row ✓ + badge 2→1 at once; exactly 1 re-read within 1.5 s, none at
  3–8.5 s; reload < 5 s later still verified; leaving the tab → no late GET; hr Awaiting finance, no Verify; 390 px; 0 page
  errors, 0 API ≥ 400. `--base` on b0ed242 2/2 (no re-read within 1.5 s; re-read at ~6 s). Regression role-gaps 36/36,
  attendance-flags-verify-role 21/21. jest 121/2172 unchanged.
- **Not tested:** Railway; Safari/Firefox.
- **Register (not fixed, planner):** 10 Finance Audit reads re-read after a write with no `fresh` (getFinanceReport,
  getCorrectionHistory, getCorrectionsSummary, getSalaryManualFlags, getReadinessCheck, getFinancePendingDeductions,
  getEarlyExitPendingFinance, getEarlyExitDeductions, getCompOffPending, getCompOffList) and 16 bare-array
  `invalidateQueries([...])` calls in FinanceAudit.jsx (v5 reads them as "invalidate everything").
