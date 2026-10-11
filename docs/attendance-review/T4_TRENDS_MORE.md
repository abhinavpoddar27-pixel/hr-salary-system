# T4 — Trends: the rest of the analytics

Branch `feat/attendance-review-trends-t4`, **stacked on PR-7** (`feat/attendance-review-ladder`, #124) — merge #124 first.
Plan v2 Part B G6–G13 and the report sections not yet in the app. Same engine, no new tables, read only.

## Per month (in each Trends row)
- **waterfall** — lates: measured → excused (stayed late / full hours / loaders) → counted; early exits: measured →
  excused (full hours) → not assessed (exempt) → + missed OUT → counted; ₹ value of the time lost (gross ÷ days ÷ shift).
- **distribution** — counted lates by band (< 15, 15–29, 30–59, 60–119, 120+ min), early exits by band (< 30, 30–59,
  60–119, 120+), both by weekday.
- **quality** — unassessable days, half days, out not verified, gate-register days, open miss punches.
- **funnel** — listed → deductions decided → sent to finance → approved → in salary; ₹ in salary for late deductions.
- **miss punches** — own missed punches, bulk-failure days and their rows, fixed / open, counted as early (MP-2).
## Across the range
- **top people** with pattern labels (late most days / early most days / both / repeat) — click opens the PR-7 history.
- **effect** — people with a note in month M: their late + early count in M vs M+1; people named on a notice board:
  per-working-day rate before vs after the print.
- **Excel** — `GET /trends/export.xlsx?from&to`.

## Progress
- [x] engine: SQL band / weekday columns, distributions, waterfall, trendRow fields
- [x] service: funnel, miss punches, top people, effects; route fields + Excel export
- [x] tests (`attendanceReviewTrendsMore.test.js` 11)
- [x] UI sections + Excel button (`AttendanceReviewTrendsMore.jsx`; follows "Show as tables")
- [x] browser check + older scripts
- [x] PR

## Results (11 Oct 2026)
- jest 102 suites / 1594 (new `attendanceReviewTrendsMore.test.js` 11: waterfall identities, bands / weekdays add up,
  ₹ value formula, MP-2 in the 120+ band, old stored results read as empty, top people labels, effects maths, funnel,
  miss punches, API fields, workbook sheets + audit + hr 403).
- `backend/scripts/attendance-review-trends-more-check.py` 26/26 (10 cards, chart drawn, table = API, top person label,
  effect rows, history window from top people, Excel 5 sheets, phone, 0 errors, nothing written but the export audit row).
- Re-run: trends 31, ladder 22, tab 49, board 36, send-to-finance 28, quality gate 33.

## Fragile
- Months whose stored run predates this PR have no waterfall / distribution (shown as "not available") until regenerated.
- Bands and weekdays come from the shared person-month SQL; re-measured people add 0 there.
- The note effect compares counts (not rates) month to month; the board effect uses Mon–Sat days as working days.

## Session note (for CLAUDE.md, folded in by the planner)
T4 Trends: waterfall / distribution in every review result (`monthAnalytics`); trendRow + funnel, miss punches,
top people, effects; `GET /trends/export.xlsx`. Stacked on PR-7.

## Resume
Read this file + `git log --oneline origin/main..`; continue at the first unticked line.
