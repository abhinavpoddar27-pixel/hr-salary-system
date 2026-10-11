# PR-3 progress (read this first after a context reset)

Resume: branch feat/attendance-review-early-exit-rules; plan docs/attendance-review/PR3_EARLY_EXIT_RULES.md.
Owner choice 11 Oct: "PR-5 then PR-3, back to back" — PR-5 merged (#111) 11 Oct 07:35 UTC.

- [x] Plan written
- [x] Engine: config keys + SQL (D-6, D-4 columns, MP-2 exclusion) + JS (MP-2, D-4, longLates)
- [x] Finance send includes early-section deductions
- [x] Jest tests (8 new; full 99 / 1565)
- [x] Tab + Rules editor + exports
- [x] dist rebuilt
- [x] Browser check 29/29; older checks re-run green
- [x] Live read-only September numbers (in the plan doc)
- [x] CLAUDE.md entry, diff scan, PR

## Session note (moved from CLAUDE.md — main rule 11 Oct: feature PRs do not edit CLAUDE.md)

### Last Session — 2026-10-11 (Attendance enforcement PR-3: 2 h early-exit rule, long lates, missed OUT)
**Branch `feat/attendance-review-early-exit-rules` (on main 9dddfbe0, PR-5 #111 merged), NOT merged.** Plan: `docs/attendance-review/PR3_EARLY_EXIT_RULES.md`;
private plan D-4 / D-6 / MP-2.
- **Three switches, all OFF until the admin saves a rules version that turns them on** (old months / stored runs / Trends keep
  their meaning): `early_exit_rule: 'd4'` (new value), `late_long_always_counted`, `missed_out_rule`. Thresholds
  `long_late_minutes` 120, `d4_half_day_minutes` 120, `d4_long_minutes` 60, `d4_long_count` 3, `missed_out_from` 5, `missed_out_minutes` 120.
- **D-4:** on COUNTED early exits: ½ day per exit ≥ 2 h; if exits ≥ 60 min (2 h ones included) ≥ 3, also the 60–119 min ones'
  minutes ÷ shift. Action list: deduction = round(late min ÷ shift + max(early min ÷ shift, D-4 raw)) — never less than before.
  Early-exit section: one 2 h exit is enough to be listed; `d4_days` > 0 → deduction (newcomer → warning). SQL adds
  `early_half / early_mid / early_mid_min` (+ short-day versions picked by the shift check in applyExclusions).
- **D-6:** a late ≥ 120 min is not excused by full hours when on (stayed-late still excuses). New `long_lates`, `long_late_kept`,
  `long_late_forgiven`; result `longLates[]` → tab "Late 2 h or more — check the shift" + Excel sheet (shown with the switch off too).
- **MP-2:** `missedOutPlan()` = own missed punches (worked status, is_miss_punch, not a bulk day ≥ `bulk_miss_punch_day`), date
  order; from the 5th, each MISSING_OUT / NIGHT_UNPAIRED = a synthetic early exit of 120 min (`applyMissedOut`, after exclusions;
  loaders / early-exempt not charged). Those dates go into SQL param `@mp2` ('code|date') and are taken out of measured early
  exits (no double count with a gate-register out). Result `missedOut{}` → tab section + Excel sheet "Missed OUT".
- **Send to finance** now also sends early-exit-section deductions (one `late_coming_deductions` row per person, remark
  "early exits … (D-4 rule)"); per-date `early_exit_deductions` still NOT written (needs a detection id per date).
- **UI:** Rules editor: early rule option "2 h rule", two ticks, labels for the new thresholds (form + save body carry the keys —
  fragile #1 of PR-5 still applies). Tab: notes, "(n ≥ 2 h)" / "incl. n missed OUT" cells, 2 h rule columns, two new sections,
  Finance "incl. n from the early-exit section". Word pack wording follows the rule. dist rebuilt.
- **Fragile:** (1) weekly trend does not include MP-2 synthetic exits (monthly figures do). (2) A person whose ONLY worked days
  were missed punches has no person-month row, so MP-2 cannot charge them. (3) MP-2 on a wrong night master turns
  NIGHT_UNPAIRED rows into charges — fix masters (MP-4) before turning it on.
- **Live expectation (read-only, Sep 2026, v5 rules + all three on, engine SQL inlined):** 60 people with ≥ 1 counted 2 h+ exit
  (77 exits = 38.5 days), 47 of them with just one; 10 people reach the 3-long-exit minutes rule (+4.4 days); ≈ ₹33,175 at gross ÷ 30
  before rounding; 27 of the 60 are contract workers. D-6: 23 people / 28 counted 2 h+ lates, 6 only because of D-6. MP-2: 3 people
  (2 / 3 / 12 days), the 12-day one is the night worker waiting for the 19:00–07:00 master (MP-4).
- **Verified:** new `attendanceReviewEarlyExitRules.test.js` 9; exports test sheet list updated on purpose; jest 99 suites / 1566;
  `scripts/attendance-review-early-rules-check.py` 29/29 (rules off → editor on → v2 keys → preview → draft → finalise → Send 4 incl. 3
  early-section rows + remarks → hr 403 → phone → payroll untouched); tab 49, trends 31, suggestions 29, master 26, send-to-finance 28,
  board 36 re-run green. **Not tested:** Railway; production data in the UI.
