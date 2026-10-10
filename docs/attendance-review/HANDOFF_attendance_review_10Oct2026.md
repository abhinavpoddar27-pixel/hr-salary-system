# HANDOFF — Monthly Attendance Review → Analytics tab (10 Oct 2026)

**Owner:** Abhinav Poddar · **Branch:** `docs/attendance-review-handoff` (docs only, NOT merged) · **Base:** origin/main a5aec9a
**Status:** analysis done by hand for September 2026; app build designed, NOT started. Next chat starts at PR-1 Phase 0.

> The GitHub repo is **public**. Employee codes, names, the September acceptance fixture and the named exclusion list
> are in the private Claude Project only: `claude/attendance-review/exclusions.md` and
> `claude/attendance-review/sep2026_expected.json`. Do not commit them. In the app they are config rows entered by the admin.

## 1. Context
HR deducted late coming in August 2026 and ran training. Abhinav asked whether it worked, who still defaults (late,
early exit, both), and for an action pack: deduction notes, newcomer warnings, notice-board lists. Now he wants the
same review as a monthly **admin-generated report in Analytics → "Attendance Review"**, using the existing analytics API.

## 2. How we got here (decision trail)
1. Trend Aug → Sep from `attendance_processed` (worked days, miss punches excluded).
2. Ranked all defaulters; added shift columns (master vs shift the system used) → found wrong-shift cases.
3. Loading staff: late coming not assessed. Added minutes lost ÷ shift minutes = **workdays lost**.
4. Double-defaulter list (simple, action-oriented) → regular defaulters not improved.
5. Abhinav: "have you considered people leaving late, then coming late next day" → **stayed-late exemption**
   (count AND minutes).
6. Single report with his criteria → Claude Doc review report.
7. Action pack: newcomers get a warning; others deduction = workdays lost, nearest 0.5, min 0.5; notice board.
8. Exclusions added on his rulings (seniors; Manpreet piece-rate loading contractor). Early exits: no improvement →
   early-exit notice + warnings; Option C proposed for deduction.
9. Runbook + skill for one-click repeat. Then this build request.

## 3. Decisions (locked — full list in `RUNBOOK.md` §1–2)
- Worked days P/WOP/½P/WO½P, miss punches excluded. Late = late_by_minutes ≥ 10 (grace 9).
- Stayed-late exemption: `is_left_late` on previous worked day OR previous calendar day → late not counted, minutes dropped.
- Early exit: 15 < early_by_minutes < 600, Mon–Sat. Plant-wide release days (>50% of day-shift early) excluded — Sep: 3 & 25.
- Readings ≥ 600 min = night-shift misreads, dropped.
- Workdays lost = (late min + early min) ÷ (shift hours × 60). Deduction = nearest 0.5 day, min 0.5. ₹ indicative = gross ÷ days in month × days.
- Double = 4+ lates AND 4+ early. Regular = 8+ lates OR 8+ early with 10+ worked days. Not improved = this ≥ last.
- Newcomer (no last-month record or < 5 days last month) → warning only.
- Notices: late at 4+ counted lates; early at 3+ early exits. No money or minutes on notices.
- Early-exit-only → warning until a rule is approved.
- Loading staff (designation LOAD/LODING): no late assessment. Named exclusions: private doc.

## 4. Proposals NOT accepted yet
- **Option C** early-exit deduction: each exit ≥ 1 h early = ½ day; every 3 shorter exits = ½ day.
- Lates ≥ 2 h count as a half day.
- App build design in `BUILD_PLAN.md` (PR-1 engine + config tables, PR-2 tab, PR-3 exports, PR-4 write-back gated).
- `docx` npm dependency on the backend for the Word export.

## 5. Landmines
- **L1 — deduction-list selection is not fully codified.** The 18 people (15 deductions + 3 newcomer warnings) came
  from double defaulters ∪ regular-not-improved after exclusions, then Abhinav's removals. Before PR-1 codes it, derive
  the rule that reproduces the fixture exactly, or ask him. The fixture is ground truth, not the prose.
- **L2 — headline %s in the fixture were computed BEFORE the Manpreet / senior exclusions** (`note_headline`). Re-derive
  after exclusions; don't fail the acceptance test on them.
- **L3 — day calculation applies HR late-deduction days without finance approval** (three August cases). Never write
  deductions back (PR-4) until that is fixed in `dayCalculation.js`/`payroll.js` (DO-NOT-MODIFY files → own approved PR).
- **L4 — the system can measure against a different shift than the employee master** (`shift_detected` vs
  `default_shift_id`). The engine must flag these each month, not trust either blindly.
- **L5 — August early-exit data is noisy** (night shifts read ~710 min early; inconsistent grace). The 15–600 window handles it.
- **L6 — `short_leaves` (gate passes) has 0 rows ever.** Gate-pass exemption is designed but has no data.
- **L7 — repo is public.** Config with codes lives in the DB, not source. Exports carry PII and money → admin only.
- **L8 — Analytics month picker syncs to the global store** (also drives plant pipeline pages).
- **L9 — DB is SQLite** (better-sqlite3), not PostgreSQL as the project description says.

## 6. Key data (September 2026, FACT)
| Measure | Aug | Sep |
|---|---|---|
| Company staff late days, % of worked days | 27.7% | 14.4% |
| Company staff early exits | 23.3% | 18.7% |
| Contract workers late | 25.4% | 16.6% |
| Contract workers early exits | 16.0% | 19.1% |
| Habitual late-comers (10+ lates, contract) | 30 | 7 |

Improvement starts 5 Sep. Action pack: 18 people — 15 deductions = 14.5 days (≈ ₹13,221 indicative), 3 newcomer
warnings; 31 early-exit warnings; late notice 51 names; early notice 38 names.
INFERENCE: August deductions + training cut late coming roughly in half; early exits did not respond (contract got worse).

## 7. Unverified state
- Outputs were built from SQL Console pulls on 10 Oct 2026; no second-person check of the 18 deductions.
- Not yet confirmed: 7:30 shift for two people, boiler timing for one (private doc).
- Nothing in the app has been built or tested. `BUILD_PLAN.md` file/line references were read on a5aec9a only.
- `reference/*` builders were sanitised for the public repo (config-driven) and only syntax-checked, not re-run.

## 8. Open questions for Abhinav
1. Approve Option C (or another early-exit rule) from October?
2. Kuldeep contractor loading workers: piece rate (exclude) or assess early exits?
3. May loading staff leave once dispatch is done?
4. Reverse the duplicate August late deduction (private doc)?
5. Lates ≥ 2 h as half days?
6. "Previous evening" = previous worked day (used) or calendar day — currently either.
7. Start recording gate passes in `short_leaves`?
8. Fix the shift master for the wrong-shift cases.
9. Build: approve PR split, two new tables, `docx` dependency (BUILD_PLAN D1–D5).

## 9. Next actions
1. Abhinav: open a PR for this branch in the GitHub web UI and merge (docs only).
2. New chat: paste the re-entry block → Claude Code runs `PROMPT_PLAN.md` (Phase 0 = plan only, no code).
3. Abhinav approves the plan + D1–D5 → PR-1 build → verify against the private fixture → PR-2 → PR-3.
4. Late October: run the October review by hand with the skill as a second reference before trusting the app.

## 10. Re-entry block (paste into the new chat)
```
Continue the Attendance Review build (HR Salary System). Read, in order:
1. Project doc claude/attendance-review/HANDOFF.md (this handoff)
2. Repo docs/attendance-review/RUNBOOK.md and BUILD_PLAN.md (branch docs/attendance-review-handoff or main if merged)
3. Project docs claude/attendance-review/exclusions.md and claude/attendance-review/sep2026_expected.json (private)
4. docs/attendance-review/PROGRESS.md — resume from its RESUME block.
Then give me the Claude Code prompt for PR-1 Phase 0 (docs/attendance-review/PROMPT_PLAN.md). Ask me D1–D5 first.
Repo is public: no codes/names in commits.
```

Data export: `Attendance_Review_Handoff_Data_10Oct2026.xlsx` (private, sent in chat + saved in the project).
