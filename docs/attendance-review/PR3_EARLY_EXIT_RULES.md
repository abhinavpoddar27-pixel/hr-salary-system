# PR-3 — early-exit rules, long lates, missed-OUT offence

Branch `feat/attendance-review-early-exit-rules` (from main 9dddfbe0, PR-5 #111 merged). Private plan: project
`claude/attendance-review/PLAN_enforcement_v2.md` (D-4, D-6, MP-2). Engine only + tab/editor/exports; no payroll table,
no schema change, no protected file.

## Owner rulings this builds
- **D-4** an early exit of 2 h or more = half a day; 3+ early exits of 60+ min in a month = a minutes deduction.
- **D-6** a late of 2 h or more is always counted, even when the hours were made up; it is listed as a possible shift problem.
- **MP-2** from a person's 5th own missed punch in the month (bulk-failure days not counted), each missed OUT counts as an
  early exit of 2 h (= half a day under D-4).

## Switches (all OFF until the admin saves a rules version that turns them on — old months and stored runs keep their meaning)
| Key | Values | Default |
|---|---|---|
| `early_exit_rule` | `warning` · `option_c` · **`d4`** (new) | `warning` |
| `late_long_always_counted` | true / false (D-6) | false |
| `missed_out_rule` | true / false (MP-2) | false |
| thresholds `long_late_minutes` 120, `d4_half_day_minutes` 120, `d4_long_minutes` 60, `d4_long_count` 3, `missed_out_from` 5, `missed_out_minutes` 120 | numbers | as shown |

## D-4 in the engine (`early_exit_rule: 'd4'`)
Per person, on the month's **counted** early exits (after Sunday / half day / release day / full hours / exemptions):
- `half` = exits ≥ 120 min → ½ day each.
- if exits ≥ 60 min (2 h ones included) number 3 or more → the minutes of the 60–119 min exits ÷ shift minutes.
- `d4_days` = 0.5 × half + minutes part, rounded to the ½ day (minimum ½) when > 0.
- **Action list** (late regular / early regular / double): deduction = round(late minutes ÷ shift + max(early minutes ÷ shift,
  D-4 early part)) — never less than before.
- **Not on the action list** (early-exit section): `d4_days` > 0 → deduction line (newcomer → warning), like Option C today.
- Exits under 60 min stay warning-only (the notice and the 3+ early warning list still show them).

## D-6
SQL: a late of ≥ `long_late_minutes` can no longer be excused by full hours (the stayed-late excuse, D-5, still applies).
New per-person `long_lates` / `long_late_hours_kept` (would have been excused). Result `longLates[]` → tab section
"Late 2 h or more — check the shift" and an Excel sheet. Re-measure rows follow the same rule.

## MP-2
Personal missed punches = worked-status rows with is_miss_punch, not on a bulk-failure day (≥ `bulk_miss_punch_day`
plant-wide), ordered by date. From the `missed_out_from`-th, each MISSING_OUT / NIGHT_UNPAIRED day is a **synthetic early exit
of `missed_out_minutes`** (counted in early exits, minutes, ≥ 2 h exits). Those dates are taken out of the measured early
exits so a gate-register out on the same day is not counted twice. Not for loaders / early-exempt people (no early exits).
Both months (this and last) for the "improved" check.

## Finance hand-off
Early-exit section deductions (D-4 or Option C) go to finance with Send too — one pending `late_coming_deductions` row per
person (same as action-list rows; remark says "early exits"). Per-date `early_exit_deductions` rows are NOT written:
that table needs an `early_exit_detections` id per date, which the master basis does not produce.

## Accept
- jest: D-4 half days, the 3-of-60 minutes trigger, action-list max(), section line, newcomer warning; D-6 kept late +
  list; MP-2 from the 5th, bulk days skipped, no double count with a gate-register exit, loader exempt; switches off =
  the same counts and deductions as before; send includes section deductions.
- browser: editor saves the three switches; tab shows the long-late section and D-4 lines; Send count.
- live read-only: September with the switches on (numbers in the PR).

## Live expectation (read-only, September 2026, v5 rules + all three switches on; engine SQL inlined in the SQL Console)
- D-4: 60 people with at least one counted early exit of 2 h+ (77 exits = 38.5 days); 47 of them have just that one exit;
  10 reach the 3-long-exits minutes rule (+4.4 days). About ₹33,175 at gross ÷ 30 before rounding. 27 of the 60 are
  contract workers (their deductions reach pay only after PR-2b).
- D-6: 23 people with 28 counted lates of 2 h+; 6 of those lates are counted only because of D-6.
- MP-2: 3 people (2, 3 and 12 missed OUTs from the 5th on). The 12 belong to the night worker still waiting for the
  19:00–07:00 master (MP-4) — fix the master before turning MP-2 on.
- The re-measure row in v5 was not applied in this SQL (one person), so these are close, not exact.
