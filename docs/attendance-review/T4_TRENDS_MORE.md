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
- [ ] engine: SQL band / weekday columns, distributions, waterfall, trendRow fields
- [ ] service: funnel, miss punches, top people, effects; route fields + Excel export
- [ ] tests
- [ ] UI sections + Excel button
- [ ] browser check + older scripts
- [ ] PR

## Resume
Read this file + `git log --oneline origin/main..`; continue at the first unticked line.
