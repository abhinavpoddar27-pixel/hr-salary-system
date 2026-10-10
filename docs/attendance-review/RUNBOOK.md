# Monthly Late Coming & Early Exit Review — Runbook

Full write-up (decision trail, rules, SQL, templates): https://claude.ai/code/artifact/95a237d4-1403-46a3-9c93-3f484ba18a19


# Monthly late coming & early exit review

Run for one calendar month (argument: "October 2026"). Compare it with the previous month. Data: HR SQL Console only (read-only, SQLite). Full method with the reasoning: Claude Doc "Monthly Late Coming & Early Exit Review — Method and Runbook" and project doc `claude/attendance-review-runbook.md`. The September 2026 outputs are the reference copies.

Never change a rule below without a new ruling from Abhinav in the current chat. When he gives one, apply it and tell him to add it to the runbook's rules section with the date.

## 0. Preflight (stop if any fails)
- Last imported date in `attendance_processed` = last day of the month.
- Miss punches for the month resolved (`is_miss_punch=1 AND miss_punch_resolved=0` count ≈ 0). If not, say so and ask whether to continue.
- The month's salary is not yet finalised (deductions must land in it).

## 1. Locked rules
- Worked days: `status_final IN ('P','WOP','½P','WO½P')`, `COALESCE(is_miss_punch,0)=0`.
- Late day: `is_late_arrival=1 AND late_by_minutes>=10` (grace 9).
- Stayed-late exemption (ruling 04-Sep-2026): a late morning is NOT counted if `is_left_late=1` on the previous WORKED day (LAG over worked rows) or the previous calendar day. Remove it from the count AND the minutes.
- Early exit: `is_early_departure=1 AND early_by_minutes>15 AND early_by_minutes<600`, Monday–Saturday only.
- Plant-wide early release: a day when >50% of day-shift workers left early is excluded from early exits (Sep 2026: 3 Sep, 25 Sep). Confirm new ones with Abhinav.
- Readings of 600+ minutes late or early are night-shift misreads: drop them.
- Time lost = counted late minutes + early-exit minutes. Workdays lost = time lost ÷ (person's shift hours × 60). Shift hours from `shifts.duration_hours` of the shift used (`shift_detected`).
- Deduction = workdays lost rounded to the NEAREST 0.5 day, minimum 0.5 day. Indicative ₹ = monthly gross ÷ days in month × days (payroll gives the final figure).
- Double defaulter: 4+ counted lates AND 4+ early exits. Regular: 8+ counted lates OR 8+ early exits with 10+ days worked. Not improved: this month ≥ last month.
- Newcomer: no previous-month record or under 5 days worked last month → warning note only, no deduction.
- Early-exit-only cases (3+ early exits, not on the deduction list) → warning note only, until an early-exit deduction rule is approved (proposed Option C: each exit 1 h+ early = ½ day; every 3 shorter exits = ½ day).

## 2. Exclusions and special treatment
- Loading staff (designation contains LOAD or LODING): late coming NOT assessed; early exits counted.
- Manpreet contractor workers (`department='MANPREET CON'`): piece-rate loading — excluded from everything (no deductions, notes or notices).
- Named exclusions and special cases (senior employees left out of every output; night worker set up on a day shift; wrong-shift list; one person re-measured on his master shift; contractor loading workers whose early exits are held) are **employee-specific and kept out of this public repo**. Source of truth: private project doc `claude/attendance-review/exclusions.md`; in the app they live in the `attendance_review_config` table, entered via the admin screen — never hard-coded in source or seeded in schema.js.
- Run the shift check every month (step 3). New suspected wrong-shift cases: ask before excluding. When a shift is fixed, drop the person from the list.

## 3. Procedure
1. Release days (query A). 2. Shift check (query B). 3. Person-month for this month and last (query C), then apply exclusions, release days, wrong-shift re-measure. 4. Time and workdays lost per person and per department (denominator = scheduled minutes of EVERYONE who worked: Σ worked days × shift hours × 60, ½P = half). 5. Trend company vs contract, weekly late % and early % (Mon–Sat), habitual (10+ lates) and double-defaulter counts. 6. Select: double defaulters, regular not improved, early exits 3+. Mark newcomers. 7. Set actions (deduction / warning). 8. Query D on last month's deductions vs payroll. 9. Build outputs. 10. Run the checks.

Query A
```sql
SELECT date, COUNT(*) worked, SUM(is_early_departure=1 AND early_by_minutes>15 AND early_by_minutes<600) early
FROM attendance_processed WHERE substr(date,1,7)='YYYY-MM' AND status_final IN ('P','WOP','½P','WO½P')
AND COALESCE(is_miss_punch,0)=0 AND is_night_shift=0 AND strftime('%w',date)<>'0'
GROUP BY date HAVING early*1.0/worked > 0.5 ORDER BY date
```
Query B
```sql
SELECT e.code, e.department, s.name master_shift, a.shift_detected used_shift, COUNT(*) days,
MIN(a.in_time_final) min_in, MAX(a.in_time_final) max_in, MIN(a.out_time_final) min_out, MAX(a.out_time_final) max_out,
SUM(a.is_late_arrival) late, SUM(a.is_early_departure) early
FROM attendance_processed a JOIN employees e ON e.code=a.employee_code LEFT JOIN shifts s ON s.id=e.default_shift_id
WHERE substr(a.date,1,7)='YYYY-MM' AND a.status_final IN ('P','WOP') AND COALESCE(a.is_miss_punch,0)=0 AND a.is_night_shift=0
GROUP BY e.code, a.shift_detected
HAVING days>=10 AND ((s.name<>a.shift_detected) OR early>=0.8*days OR late>=0.8*days)
```
Query C (set the date window to start ~7 days before the month so LAG sees the previous worked day)
```sql
WITH w AS (SELECT a.*, LAG(a.is_left_late) OVER (PARTITION BY a.employee_code ORDER BY a.date) prev_left_late
 FROM attendance_processed a WHERE a.date BETWEEN 'YYYY-MM-PREV25' AND 'YYYY-MM-LAST'
 AND a.status_final IN ('P','WOP','½P','WO½P') AND COALESCE(a.is_miss_punch,0)=0),
x AS (SELECT w.*, e.name, e.department, e.designation,
 CASE WHEN e.is_contractor=1 OR e.employment_type='Contract' THEN 'Contract' ELSE 'Company' END grp,
 CASE WHEN UPPER(COALESCE(e.designation,'')) LIKE '%LOAD%' OR UPPER(COALESCE(e.designation,'')) LIKE '%LODING%' THEN 1 ELSE 0 END loading,
 COALESCE(sh.duration_hours,12) shift_h
 FROM w JOIN employees e ON e.code=w.employee_code LEFT JOIN shifts sh ON sh.name=w.shift_detected
 WHERE substr(w.date,1,7)='YYYY-MM')
SELECT employee_code, name, department, designation, grp, loading, MAX(shift_h) shift_h, COUNT(*) worked_days,
 SUM(is_late_arrival=1 AND late_by_minutes>=10) late_days,
 SUM(is_late_arrival=1 AND late_by_minutes>=10 AND COALESCE(prev_left_late,0)=1) stayed_late_excused,
 SUM(CASE WHEN loading=0 AND is_late_arrival=1 AND late_by_minutes>=10 AND late_by_minutes<600 AND COALESCE(prev_left_late,0)=0 THEN 1 ELSE 0 END) counted_lates,
 SUM(CASE WHEN loading=0 AND is_late_arrival=1 AND late_by_minutes>=10 AND late_by_minutes<600 AND COALESCE(prev_left_late,0)=0 THEN late_by_minutes ELSE 0 END) late_min,
 SUM(is_early_departure=1 AND early_by_minutes>15 AND early_by_minutes<600 AND strftime('%w',date)<>'0') early_exits,
 SUM(CASE WHEN is_early_departure=1 AND early_by_minutes>15 AND early_by_minutes<600 AND strftime('%w',date)<>'0' THEN early_by_minutes ELSE 0 END) early_min
FROM x GROUP BY employee_code
```
Add `AND date NOT IN (<release days>)` to the early-exit sums once release days are confirmed. Also pull, per early exit, buckets ≤30, 31–60, 61–120, >120 min (needed for the early-exit list and Option C).

Query D (last month's late deductions vs payroll)
```sql
SELECT d.employee_code, d.late_count, d.deduction_days, d.finance_status, d.is_applied_to_salary,
 dc.late_deduction_days daycalc_days, s.late_coming_deduction salary_amount
FROM late_coming_deductions d
LEFT JOIN day_calculations dc ON dc.employee_code=d.employee_code AND dc.month=d.month AND dc.year=d.year
LEFT JOIN salary_computations s ON s.employee_code=d.employee_code AND s.month=d.month AND s.year=d.year
WHERE d.month=PREV_M AND d.year=PREV_Y ORDER BY d.employee_code
```
Flag: two approved rows for one person; finance-rejected row with day-calc days still applied; day-calc days AND a salary deduction for the same lates. Also: `SELECT COUNT(*) FROM short_leaves WHERE date LIKE 'YYYY-MM%'` — report whether gate passes are now being recorded.

For each person also pull master shift, the shift used most days and average IN/OUT on day shifts (for the shift columns). Gross salary from `employees.gross_salary` for the ₹ estimate.

## 4. Outputs (same shape every month)
1. Chat summary: FACT / INFERENCE / OPINION, trend vs last month, new release days, new wrong-shift suspects, decisions needed. Indian notation (₹, lakh, crore).
2. Review report as a Claude Doc, sections: Summary · Criteria used · What changed (weekly line chart: company late % and early %; Jul-style monthly table company vs contract) · Time lost by department · Double defaulters (priority Act now / Warn / Watch) · Regular defaulters not improved (late; early; improved-but-regular) · Shift setup fixes and loading staff · Payroll errors · Recommendations and decisions.
3. Word file `<Mon>_Late_Early_Action_Notes.docx` (A4, Arial; build with docx-js, reuse `claude/attendance-review/notes_builder.js` from the project if present):
   - Page 1 (landscape): action list — #, code, name, dept – role, late days, early days, time lost, workdays lost, action, deduction, indicative ₹, remark; total row; "before issuing" line. Second table: early-exit warning notes.
   - Notice "Late Coming – <Month>": everyone with 4+ counted lates; policy points (9-min grace; stayed-late exemption; time lost deducted in half-day steps; leaving early without gate pass treated the same); S.No, code, name, department, late days; 3 working days to dispute; date, HR Manager. No money.
   - Notice "Leaving Early – <Month>": everyone with 3+ early exits; gate-pass rule; release days not counted.
   - One note per page, Ref HR/ATT/<MON><YY>/NN, date, To, department/role, subject, facts table (this month, last month), action text, "copy to contractor" for contractor workers, signature lines for HR Manager and employee. Three templates: deduction note, newcomer warning, early-exit warning.
   - Render to PDF and look at each page type before sending.
4. Data workbook `<Mon>_Late_Early_Defaulters.xlsx` (openpyxl + recalc, formulas for totals/%/workdays): Defaulters (ranked by workdays lost), By Department, Shift issues, All staff, Summary, Notes.

## 5. Checks before handing over
- Grep every output for excluded names and codes → must be 0.
- Deductions follow the rounding rule and the total adds up; newcomers have no deduction.
- No wrong-shift person has an early-exit deduction; release days excluded.
- Notices carry no money or minutes; names cleaned (no trailing digits, known misspellings fixed).
- Remind Abhinav of every OPEN decision in the runbook and of the pre-issue confirmations listed in the private exclusions doc.
