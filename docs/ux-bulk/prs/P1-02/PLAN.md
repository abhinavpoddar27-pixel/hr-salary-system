# P1-02 — PLAN (Phase 0)
Branch `fix/salary-register-report-fields` · base origin/main 96ee482 (+ ca767ce PROMPT.md) · Finding H-1 · Rulings R11.
Status: **Phase 0 ready — waiting for "go". No source file touched.**

## 1. Re-grep (FACT)
`grep -n "net_pay\|total_earned\|employee_pf\|employee_esi\|professional_tax\|earned_basic\|earned_hra\|colSpan" frontend/src/pages/Reports.jsx`
Salary Register block = L568–643 (`activeReport === 'salary'`). Data: `getSalaryRegister` → `GET /api/payroll/salary-register`
(payroll.js L190), `SELECT sc.*` + employee/day_calculations joins + `employee_name`, `department`. `salTotals` = server totals.
- Table cells read `e.total_earned` (L623), `e.employee_pf` (L624), `e.employee_esi` (L625), `e.professional_tax` (L626),
  `e.net_pay` (L628). Correct already: `employee_code`, `employee_name`, `department`, `payable_days`, `gross_salary`,
  `total_deductions`.
- `colSpan={11}` at L614 (empty row) and L631 (DrillDownRow). 11 `<th>` at L599–609.
- CSV (L573–582) keys: `employee_code, employee_name, department, gross_salary, basic, hra, payable_days, earned_basic,
  earned_hra, total_earned, employee_pf, employee_esi, professional_tax, total_deductions, net_pay`.

## 2. Real columns (FACT, schema.js `CREATE TABLE salary_computations` + `safeAddColumn` L670–1720)
Exist: `payable_days, gross_salary, basic_earned, hra_earned, gross_earned, pf_employee, esi_employee, professional_tax
(always 0 — PT disabled Apr 2026), total_deductions, net_salary, salary_held`. Do NOT exist on the row: `basic`, `hra`,
`earned_basic`, `earned_hra`, `total_earned`, `employee_pf`, `employee_esi`, `net_pay` (no alias in the endpoint SQL).

## 3. Key map — table
| Header | Old key | New key |
|---|---|---|
| Earned | `total_earned` | `gross_earned` |
| EE PF | `employee_pf` | `pf_employee` |
| EE ESI | `employee_esi` | `esi_employee` |
| PT | `professional_tax` | **column removed** (th + td) |
| Net Pay | `net_pay` | `net_salary` |
Columns 11 → **10**: Code, Name, Dept, Days, Gross, Earned, EE PF, EE ESI, Ded., Net Pay. Both `colSpan={11}` → `{10}`.
Everything else in the block (cards, header, loading, drill-down content) unchanged.

## 4. Key map — CSV (labels unchanged except dropped ones)
| Label | Old key | New key |
|---|---|---|
| Code / Name / Dept / Gross / Payable Days / Total Ded. | unchanged | unchanged |
| Basic | `basic` | **dropped** — monthly Basic is not on the salary row (it lives in `salary_structures`); not inventing it |
| HRA | `hra` | **dropped** — same reason |
| Earned Basic | `earned_basic` | `basic_earned` |
| Earned HRA | `earned_hra` | `hra_earned` |
| Total Earned | `total_earned` | `gross_earned` |
| EE PF | `employee_pf` | `pf_employee` |
| EE ESI | `employee_esi` | `esi_employee` |
| PT | `professional_tax` | **dropped** — PT disabled, always 0 |
| Net Pay | `net_pay` | `net_salary` |
Final CSV header (12): `Code,Name,Dept,Gross,Payable Days,Earned Basic,Earned HRA,Total Earned,EE PF,EE ESI,Total Ded.,Net Pay`.

## 5. NOT touched
Backend (payroll.js endpoint shared with Stage 7, 1,526 calls/90 d), api.js, `exportToCSV` helper, the 4 total cards, every
other Reports.jsx block, App.jsx, Sidebar.jsx, schema.js, all DO-NOT-MODIFY files. No new columns (LWF, loan, OT, ED, held flag).

## 6. Other blocks — new register findings (NOT fixed here)
- **N-1 Audit Trail** (L1045, L1073, L1088): reads `created_at`; `audit_log` has `changed_at` → Timestamp column + CSV blank.
  Also `/reports/audit-trail` ignores month/year (last 1,000 rows of all time) despite the "— Month Year" title.
- **N-2 PF / ESI Statement**: frontend sends `company`, `/reports/pf-statement` + `/esi-statement` ignore it → both companies mixed.
- **N-3 Bank Transfer Sheet** (`/reports/bank-transfer`): no `salary_held = 0` filter → "Total Net Payable" includes held
  salaries (the real Bank File generator excludes them). Field names in this block are correct (`net_pay` is aliased).
- **N-4 Salary Register** (this block, not fixed): held rows are not marked, so after the fix Σ Net Pay of all rows ≠ the
  "Net Payroll" card (card excludes held). LWF / loan / late / early-exit deductions are inside "Ded." but not shown separately.
- Checked clean: Attendance Summary, Miss Punch, PF ECR, ESI Contribution, Bank File preview (keys match their endpoints).

## 7. Test plan
- `npm run build --prefix frontend` clean; dist in its own commit.
- `cd backend && npx jest` before (on base worktree) and after — no backend change, counts must be identical.
- New `backend/scripts/salary-register-report-check.py` (pattern finance-audit-readiness-check.py; built dist; scratch DB;
  `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`; fictional T9xxx employees: ≥1 PF, ≥1 ESI, 1 held, 1 neither; real hr +
  finance logins): every row's Earned / EE PF / EE ESI / Net Pay = DB value (non-zero where DB non-zero); no "PT" th; 10 th;
  Σ Earned = "Gross Payroll" card; Σ Net Pay of non-held rows = "Net Payroll" card; CSV download header = §4 list exactly and
  every cell non-empty for a computed row; expand a row → drill-down `td[colspan=10]` width = table width; 0 page errors,
  0 console errors, 0 API ≥ 400.
- `--base` on an origin/main dist built in a /tmp worktree: records the ₹0 cells + PT column (once).
- Regression: `wide-layout-check.py` not needed (Stage 7 untouched) — will run if cheap.

## 8. Risks
- Low: display-only, one file. CSV consumers (if any Excel macro keys on column position) see 3 fewer columns — Basic, HRA, PT.
- `fmtINR(undefined)` was what rendered ₹0; after the fix a genuine NULL in DB still renders ₹0 (same as before).

## 9. Questions for the owner
1. CSV: drop Basic / HRA (no data source on this row) — OK? Alternative is leave them out vs. a separate structure lookup (scope creep).
2. N-4: add a "Held" marker / column to this report now, or leave for a later PR? (Plan default: leave — not in scope.)
