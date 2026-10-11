# PR-3 follow-up — 2 h rule "need 2" (owner ruling 11 Oct 2026, 16:43 IST)

Branch `feat/attendance-review-d4-need-two` (on main after #119). Engine + editor label + notes; no payroll table, no schema change.

## Rule
- New threshold `d4_half_day_min_count` (default **2**). A counted early exit of 2 h or more costs ½ day only once the month
  has at least this many of them; then each one does (2 exits = 1 day).
- With fewer (one 2 h exit): no ½-day charge. That exit is listed in the early-exit section as a **warning** and counts as an
  ordinary long exit — if the month has 3+ exits of 60 min or more, its minutes join the minutes deduction.
- `1` restores PR-3 as first built (the 1st 2 h exit already costs ½ day). The rule is still OFF until a rules version sets
  `early_exit_rule: 'd4'`.
- Action list: early part = max(early minutes, D-4 charge) as before; a lone 2 h exit adds only its minutes.
- Finance remark (early section): "…, N of 2 h or more; N at ½ day each (D-4 rule)" — the "at ½ day" part only when charged.

## Code
- `attendanceReviewService.js`: threshold; SQL `early_half_min` / `early_short_half_min`; remeasure + MP-2 add 2 h minutes;
  `d4Early` applies the count; early section lists a single 2 h exit as a warning; remark.
- Editor label, tab note, Word wording follow the setting.

## Verified
- jest 99 suites / 1567 (new "need 2" test; four PR-3 tests pinned to count 1 so the old path stays covered).
- `scripts/attendance-review-early-rules-check.py` 33/33 (adds P3007 with two 2 h exits; P3001 now a warning; P3003 stays ½;
  editor shows the setting at 2; finance rows + remarks); send-to-finance check 28/28.

## Expected effect, September 2026 (INFERENCE from the PR-3 read-only numbers)
Of the 60 people with a counted 2 h+ exit, 47 had only one → warning instead of ½ day (some may still be charged by the
minutes rule if they had 3+ exits of 60+ min). 13 people with 2+ such exits keep ½ day each (30 exits = 15 days).
