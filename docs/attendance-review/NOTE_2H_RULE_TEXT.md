# Note wording: the 2-hour rule on an action-list deduction

**Branch** `fix/attendance-note-2h-rule` · exports only (`attendanceReviewExports.js`), no engine change.

- **Bug:** on the action list (D-4 on) the deduction = late time + the larger of early minutes and the 2-hour charge
  (each 2 h+ exit, incl. missed OUTs from the 5th own missed punch, = ½ day). When the 2-hour charge was larger, the
  personal note said "34 h 23 min = 2.87 workdays … deduction of 6.5 days" with no reason for the gap.
  Sep 2026 replay: 1 of 14 action-list notes affected.
- **Fix:** that note now adds one paragraph: how many 2 h+ days, how many were missed punches, the minutes of other
  1 h+ exits, and the early-leaving charge in days. No sentence when the minutes are the larger part.
  "Department / Role" no longer shows a trailing dash when the role is blank.
- **Verified:** new test in `attendanceReviewExports.test.js` (fails on main); attendance-review jest 15 suites / 197.
  Word file rebuilt from the September draft (local copy of production rows, engine output identical to the stored
  draft: 14 on the action list, 17 days, 76 early section) and the note read in a PDF render.
