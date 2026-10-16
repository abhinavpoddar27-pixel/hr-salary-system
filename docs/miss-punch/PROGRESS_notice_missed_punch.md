# PR-B — missed punches on the notices (`feat/notice-missed-punch`)

Owner ruling 16 Oct 2026: people should be told about missed punches through the monthly Attendance Review
notice and the mid-month (1st–15th) notice board. Names, codes and counts only.

## Change (`attendanceReviewService.js`, `attendanceReviewExports.js`, `AttendanceReviewTab.jsx`)
- New `personalMissPunches(db, from, to, skipDays)` — every flagged miss punch, **any day status**
  (a single-punch day EESL marks absent counts; before this only P/WOP/½P/WO½P rows were counted).
- Mid-month board uses it (bulk-failure days ≥ `bulk_miss_punch_day` and admin-skipped days still left out,
  today not counted). Board UI unchanged.
- Monthly review result gains `noticeMissed` = people with ≥ `board_miss_punch_min` (existing key, 3) own
  missed punches in the month, bulk days left out, days before today IST only, left-out / held people not
  listed. No new config key → no "rules changed" on open drafts, rules editor untouched.
- Shown: tab tile "Missed-punch notice" + section "Notice board — missed punches"; Excel sheet
  "Notice missed punch" + Summary row; Word pack gets a "Missed Punches" notice page after "Leaving Early"
  only when someone is named (each notice stays one page, like the other two).
- Stored runs from before this PR have no `noticeMissed`: tile shows "—", section says regenerate,
  exports write an empty sheet and no Word page.
- No money, no deduction, no payroll write.

## Production effect (read-only, SQL Console)
September 2026, full month, bulk days 3 + 12 Sep left out: 19 people at 3+ under the old worked-only count,
29 with every flagged miss punch counted. Existing non-worked flagged rows: Aug 53, Sep 68, Oct (so far) 13 —
these are days HR converted / marked absent that still carry the flag. After PR-A, October single-punch days
add to this.

## Verified
- New `attendanceReviewMissedNotice.test.js` 5 (4 of the first 4 fail on main b0ed242): board counts an absent
  single-punch day; monthly list threshold / bulk day / today / held / left-out; empty before the month;
  result + workbook (incl. an old result without the key); Word page present only when named.
- `attendanceReviewExports.test.js` sheet list updated (+1 sheet, on purpose). Full jest 122 / 2177.
- `backend/scripts/attendance-review-missed-notice-check.py` (Chromium, built dist, admin, scratch DB) 11/11:
  tile, section rows, draft → Excel has the sheet, 1440 + 390 px, no sideways scroll, 0 page errors.
- Regression: `attendance-review-board-check.py` 36/36; `attendance-review-tab-check.py` 48/49 — the one
  failure ("HR: admin-only message") fails the same on main (P2-10 shows "You don't have access" instead).

## Fragile
- `personalMissPunches` and the board's skip list must stay the same rule for board and monthly notice.
- The monthly notice uses the real IST "today", so a review for the current month counts up to yesterday.

## Independent review notes (16 Oct)
- No bugs found. Known differences, by design: the monthly list does not use the board's hand-skipped days
  (those are per print); the MP-2 missed-OUT rule (`missedOutPlan`, off by default) still counts worked days
  only, so its "personal missed punches" can be lower than the notice count. The Word one-punch sentence is
  printed only from October 2026. A long October list runs onto a second page (a Word table flows; the
  one-page rule of #163 is the printed mid-month board, unchanged).
- From October, single-punch rows (PR #164) also count toward the 40-a-day bulk-failure threshold.

## Not tested
Railway; a printed Word page on the HR PC.
