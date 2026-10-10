# IMPL_PR2 — LWF deduction PR-2 (base 8b9561d)

> Planned by a separate read-only planning agent on 10 Oct 2026; reviewed by the chat planner. The binding
> REVIEW CORRECTIONS at the end win over the body. **C1 narrows this PR to plant LWF** (owner releases plant
> September salaries today); the sales parts move to PR-2b.

## SCOPE
BUILD_PLAN §4.1 PR-2 items + §4.6, under R6/R7 and the 10 Oct rulings. Schema: `lwf_employee REAL DEFAULT 0`,
`lwf_employer REAL DEFAULT 0` on `salary_computations` and `sales_salary_computations`; policy keys
`lwf_employee_amount='5'`, `lwf_employer_amount='20'` (insert-if-missing); AI cache trigger dropped + recreated
with LWF. Plant Stage 7 charges ₹5 EE / ₹20 ER per month when the in-force structure row (the one compute
already picks, fallback included) has `lwf_applicable = 1` AND `grossEarned > 0`. Contractors on the list are
charged; held salaries are charged. LWF enters `total_deductions` before the cap and counts in the loan
headroom (loan stays the last deduction). Outputs show LWF. No recompute, no flag writer, no filing (PR-3), no
ESI/PF change (R6). **Nothing changes for anyone whose in-force structure has `lwf_applicable = 0`.**

## BASE SHA
`8b9561d` (= origin/main, PR #65 merged, production runs it). Build Phase 0: `git fetch origin && git log 8b9561d..origin/main --stat`; report drift in FILES.

## FILES (F = fragile; lines on 8b9561d)
- F `backend/src/database/schema.js`
  - After 1705 (`early_exit_deduction` column): `safeAddColumn('salary_computations','lwf_employee','REAL DEFAULT 0')`, same for `lwf_employer`; `insertPolicyIfMissing.run('lwf_employee_amount','5','Punjab LWF employee per month (₹) — R7')`, `insertPolicyIfMissing.run('lwf_employer_amount','20','Punjab LWF employer per month (₹) — R7')` (`insertPolicyIfMissing` const at 703, in scope). NOT in the force-reset `policyDefaults` (723–749).
  - Trigger 1713–1735: `db.exec` body → `DROP TRIGGER IF EXISTS invalidate_salary_ai_cache;` then `CREATE TRIGGER invalidate_salary_ai_cache AFTER UPDATE OF …` same 29 columns + `lwf_employee, lwf_employer` (no `IF NOT EXISTS`); WHEN/BEGIN unchanged (L13). Columns added just above, so they exist first.
  - After 2562 (`cycle_end_date`): `safeAddColumn('sales_salary_computations','lwf_employee'|'lwf_employer','REAL DEFAULT 0')` — after the CREATE at 2491.
- F `backend/src/services/salaryComputation.js` — LWF block, loan list, total, return object (exact edits below). UPSERT (849–953): columns after 864 `lwf_employee, lwf_employer,`; placeholders after 878 `?, ?,`; ON CONFLICT SET after 927 `lwf_employee = excluded.lwf_employee,` `lwf_employer = excluded.lwf_employer,`; params after 949 `comp.lwfEmployee || 0, comp.lwfEmployer || 0,`. `generatePayslipData`: after 1132 `{ label: 'LWF (Employee)', amount: comp.lwf_employee || 0 },`; after 1146 `lwfEmployer: comp.lwf_employer || 0,`.
- `backend/src/services/loans/headroom.js` 29–32: append `'lwf_employee'` to both plant and sales `PRIOR_DEDUCTION_COMPONENTS` (the only loans-engine edit; E4). Sales rows keep `lwf_employee = 0` until PR-2b, so the sales entry is inert now.
- `backend/src/services/salesSalaryComputation.js` — **moved to PR-2b (C1).**
- `backend/src/routes/sales.js` PUT `/salary/:id` 2932–2935 + register totals 2875–2881 — **moved to PR-2b (C1).**
- F `backend/src/routes/payroll.js`
  - `/salary-register` totals (223–240): `totalLWFEmployee`, `totalLWFEmployer`.
  - `/salary-register-excel`: SELECT after 287 `sc.lwf_employee, sc.lwf_employer,`; HEADERS 337 `'ESI(ER)'` followed by `'LWF(EE)', 'LWF(ER)'` (37 → 39; `NUM_COLS` derives from HEADERS, comment only); row after 376 `Math.round(r.lwf_employee||0), Math.round(r.lwf_employer||0),`; totals after 402 `sum('lwf_employee'), sum('lwf_employer'),`; `!cols` 417 insert `{ wch: 8 }, { wch: 8 },` after the four PF/ESI widths; SUMMARY sheet: after 442 `sumLWFEE`/`sumLWFER`, after 473 rows `['LWF (Employee)', …]`, `['LWF (Employer)', …]`, 487 CTC label/amount `… + LWF(ER)`.
  - `/salary-slip-excel`: header 1256–1257 → `const SUMMARY_HEADER = [...]` with `'LWF'` after `'ESI'` (20 cols); 1251 `SUMMARY_COLS = SUMMARY_HEADER.length`; row 1283 `r.lwf_employee || 0`; reducer 1309/1314 `lwf`; totals 1320 `Math.round(totals.lwf)`; `!cols` 1338 `{ wch: 8 }`; 1349 `CAUTION_COLS = ['TOT DED','NET PAYABLE','TAKE HOME'].map(h => SUMMARY_HEADER.indexOf(h))` → [16, 17, 18] (was literal [15, 16, 17], L15).
- `backend/src/services/salesExportFormats.js` — **moved to PR-2b (C1).**
- `backend/src/routes/financeAudit.js` `/report`: SELECT 66 `sc.lwf_employee, sc.lwf_employer`; row map after 168 `lwfEmployee`, `lwfEmployer`.
- `backend/src/routes/ai.js`: after 147 ``lines.push(`- LWF Employee: Rs.${comp.lwf_employee || 0}`)``; after 247 `lwf: comp.lwf_employee || 0,`.
- `backend/src/config/schemaReference.js`: 50 `lwf_employee REAL, lwf_employer REAL,`; 18 and 27 `lwf_applicable INTEGER`.
- Frontend: `pages/SalaryComputation.jsx` — LWF column `th` after 671 (`toggleSort('lwf_employee')`), `td` after 775 (`'—'` when 0), tfoot after 943; DrillDownRow 877 `colSpan` → full width (was 22 for 23 cols; N7); drill-down list 908 `['LWF (Emp)', s.lwf_employee]`, `['LWF (Empr)', s.lwf_employer]`; payslip modal 1033 `| Employer LWF: {fmtINR(payslip.lwfEmployer || 0)}`. `utils/payslipPdf.js` 53 `wlf: ps.deductions?.find(d => d.label?.includes('LWF'))?.amount || 0` (dead bulk path, no new column), 301 LWF in the employer line. `pages/FinanceAudit.jsx` 329 LWF line. `pages/Sales/SalesSalaryCompute.jsx` — **PR-2b.** `frontend/dist` rebuilt.
- Docs: `docs/statutory-flags/VERIFY.sql` V11 component check incl. `lwf_employee`; `docs/loans/PROGRESS.md` §2 SQL `+ COALESCE(lwf_employee,0)` in both sums (N2).
- Tests (new): `lwfSchema.test.js`, `lwfPlant.test.js`, `lwfOutputs.test.js` (plant parts). Edit `statutoryLoans.test.js` T12: `before` adds `+ sep.lwf_employee` and assert `lwf_employee === 5` (N3).

### Plant compute (salaryComputation.js) — exact edits
1. Insert after 583 (`}` closing the ESI block):
```js
  // ─── LWF (statutory flags PR-2, R7): ₹5 EE / ₹20 ER per month ───
  // Flag from the in-force structure; only when earned gross > 0; NOT contractor-gated;
  // a held salary is still charged. getPolicyValue may return a string (L12).
  const lwfAmt = (k, d) => { const v = parseFloat(getPolicyValue(db, k, d)); return Number.isFinite(v) && v >= 0 ? v : d; };
  const lwfOn = !!salStruct.lwf_applicable && grossEarned > 0;
  const lwfEmployee = lwfOn ? Math.round(lwfAmt('lwf_employee_amount', 5) * 100) / 100 : 0;
  const lwfEmployer = lwfOn ? Math.round(lwfAmt('lwf_employer_amount', 20) * 100) / 100 : 0;
```
2. 691 before `late_coming_deduction: lateComingDeduction, early_exit_deduction: earlyExitDeduction,` → after `… early_exit_deduction: earlyExitDeduction, lwf_employee: lwfEmployee,` (counted once `headroom.js` lists it).
3. 697 before `… + loanRecovery + lateComingDeduction + earlyExitDeduction;` → after `… + earlyExitDeduction + lwfEmployee;` (cap 701–704 unchanged; LWF inside the capped total).
4. 807 before `esiEmployee, esiEmployer,` → after `esiEmployee, esiEmployer, lwfEmployee, lwfEmployer,`.
5. Loan headroom = floor(cap% × gross_earned) − (PF + ESI + PT + TDS + advance + LOP + other + late + early + LWF).

### UPSERT counts (columns / placeholders / params / SET)
Plant 56/56/56/53 → 58/58/58/55. Sales unchanged in PR-2 (45/45/45/42; the two sales columns exist but the sales save is PR-2b).

### total_deductions writers
`salaryComputation.js:697` (cap 701–704) YES · `salesSalaryComputation.js:301–304` PR-2b · `sales.js:2932–2937` PR-2b · `payroll.js:740–748` no (410 since P3) · UPSERT `SET total_deductions = excluded` carries the computed value · `schema.js:3194` `INSERT … SELECT *` (gated, already ran) copies every column. Other UPDATEs (payroll.js 602/818, sales.js 3019/3052/3127, ai.js 457) don't touch totals.

### Readers not changed (totals already include LWF via total_deductions, or SELECT *)
employeePortal payslip, reports.js dept payroll + PF/ESI statements, employeeProfileService/EmployeeProfile.jsx, SalaryExplainer.jsx, financeVerification, financeRedFlags, driftMonitor/jobQueue identity, queryTool/sqlConsole snippets, statutoryFlags.hasPayRow, exportFormats.js (PR-3).

## DO NOT MODIFY
- `services/dayCalculation.js` — never.
- PR-1 code: `services/statutoryFlags.js`, `routes/statutoryFlags.js`, `statutoryWriterGuard.test.js`, `schema.js` 2218–2263.
- Loans engine except the `headroom.js` arrays: `stage7.js` (comment at 68 stays), ledger, close, adjustments, eligibility, `recompute.js` (K25); `applyStage7Loans` (1017) stays without try/catch.
- `exportFormats.js` (ESI file, PF ECR) — PR-3.
- `payroll.js` outside `/salary-register` totals and the two Excel handlers (hold-release, finalise, the 410 route, `payslips/bulk` 403).
- Force-reset policy list (723–749).
- Structure/flag writers: `employees.js`, `salary-input.js`, `import.js`, `sales.js` structure writers (R10).
- PR-2b files (C1): `salesSalaryComputation.js`, `sales.js`, `salesExportFormats.js`, `SalesSalaryCompute.jsx`.
- `backend/scripts/*` (verification `--dump` only); `salesPayslipPdf.js` / `SalesPayslip.jsx`.
- Never commit `frontend/dist` except `npm run build` output; never xlsx/csv/db/employee data (L1).

## STEPS (each: test → `node --check` → commit → PROGRESS; F files: quote before/after + UPSERT counts)
1. Schema — F `schema.js` + `lwfSchema.test.js`. `feat(lwf): LWF columns, policy keys 5/20, AI cache trigger includes LWF`. Tests S1–S4.
2. Plant compute + save + loan headroom — F `salaryComputation.js`, `headroom.js`, `lwfPlant.test.js`, T12 edit. `feat(lwf): plant Stage 7 LWF ₹5/₹20 (flagged, earned gross > 0), counted in the loan headroom`. Tests P1–P10.
3. (PR-2b — sales compute/save/rebuild/totals.)
4. Payslip + readers (plant) — `generatePayslipData`, F `payroll.js` `/salary-register` totals, `financeAudit.js`, `ai.js`, `schemaReference.js`. `feat(lwf): LWF on the plant payslip, register totals, finance report, AI prompt`. Tests O1, O5.
5. Excel exports (plant) — F `payroll.js` both handlers + `lwfOutputs.test.js`. `feat(lwf): LWF columns in the payroll register and salary slip summary Excel`. Test O3.
6. UI (plant) — `SalaryComputation.jsx`, `payslipPdf.js`, `FinanceAudit.jsx`; `npm run build`; commit dist in the same commit. `feat(lwf): LWF column + totals in Stage 7; employer LWF on payslip`. Proof: build + bundle grep `LWF (Emp)`, `Employer LWF`, `lwf_employee`.
7. dist check + docs — clean rebuild reproduces dist byte-identically; VERIFY.sql V11 + `docs/loans/PROGRESS.md` §2. `docs(lwf): component check includes LWF`. Proof: V11 on the sim DB = 0 rows.

## TESTS (jest, synthetic; `statutoryFixture` = S, `loanFixture` = LF, real `initSchema`)
- S1 `initSchema` twice: each new column once per table; keys `'5'`/`'20'`; an admin-set `'7'` survives re-boot. S2 trigger SQL names `lwf_employee`; updating `lwf_employee` on a row with `ai_explanation` nulls the cache. S3 old-body trigger created by hand → `initSchema` replaces it (L13). S4 fresh DB: company-UNIQUE rebuild keeps both columns and the trigger.
- P1 flag on, earned gross > 0 → 5/20 stored; `total_deductions` includes 5; net = gross_earned − total_deductions. P2 0/0 when flag off; zero-gross structure (gross_earned 0, row saved); zero attendance (no row). P3 contractor flagged → 5/20 while OT/late stay 0. P4 held (payable 3 → `salary_held = 1`) still 5/20. P5 policy `'0'` → 0; `'7.5'` → 7.5; `'abc'` → 5. P6 recompute twice → byte-identical (volatile cols stripped). P7 UPSERT round trip (flag on 5 → flag off + recompute 0) + static count 58/58/58/55. P8 drift identity 0 rows. P9 earlier month: August computed with flag off → statutory upload sets LWF from September → re-run August byte-identical (LWF 0); an unflagged colleague in September has 0/0 and total = the 10 pre-PR-2 components. P10 loan headroom: T12 setup (`LF.activeLoan` + advance so the cap binds + LWF on), `recomputeSalary` Sep → `loan_recovery` = min(3000, floor(0.5 × gross_earned) − (PF + ESI + advance + LWF)), exactly 5 less than the LWF-off run; ledger provisional = `loan_recovery`; `reconcileLoan` passes; unit `priorDeductions({lwf_employee: 5})` = 500 paise (plant and sales).
- O1 plant payslip: flag on → `{ label: 'LWF (Employee)', amount: 5 }` + `lwfEmployer` 20; off → neither. O3 `/api/payroll/salary-register-excel`: header (row 3) = data row = totals row = `!cols` = 39; LWF(EE)/LWF(ER) 5/20. `/api/payroll/salary-slip-excel` SUMMARY: header/data/totals/`!cols` 20; a held row's comments sit on TOT DED / NET PAYABLE / TAKE HOME. O5 `/finance-audit/report` returns `lwfEmployee` 5.
- Baseline: 51 suites / 915 tests green on 8b9561d; only new failures count.

## VERIFICATION
- Drift identity (sim DB, 0 rows): `SELECT employee_code FROM salary_computations WHERE ABS(net_salary-(gross_earned-total_deductions))>1;`
- V11 component check: the 10 components + `COALESCE(lwf_employee,0)` = `total_deductions` within ₹1 (production baseline: 5 known capped rows).
- UPSERT counts before/after. `node --check`: schema.js, salaryComputation.js, headroom.js, payroll.js, financeAudit.js, ai.js, schemaReference.js.
- Byte-identical for the unflagged: `git worktree add $SCRATCH/base 8b9561d` (symlink `backend/node_modules`); run `node backend/scripts/loans-stage7-simulation.js --dump <file>` in both trees; compare with `python3 -c` ignoring `lwf_employee`/`lwf_employer` (must be 0 on the branch); expect 0 differences across 210 rows.
- Phase 3 sim (`docs/statutory-flags/sim/run.py`, throwaway DB): LWF on payslip, register, both Excels, held salary, contractor, re-run of September.

## RISKS + ROLLBACK
- After deploy, the next Stage 7 charges every flagged plant employee (113 with September pay once T4 is applied) — intended (R7). Earlier months read `lwf_applicable = 0` (column default before the upload; PR-1 freeze rows protect fallback months).
- Loans: where the cap binds, the loan deducts ₹5 less (shortfall to the last instalment). Production has 0 loans.
- Rollback: revert the merge in the GitHub UI and redeploy; columns, keys and the new trigger stay (harmless). The old UPSERT does not SET `lwf_*`: after a re-run on reverted code, `UPDATE salary_computations SET lwf_employee=0, lwf_employer=0 WHERE month=? AND year=?` via the SQL Console UI with a remark, then re-run Stage 7.

## PLAN ERRATA (checked on 8b9561d)
- E1 sales PUT `/sales/salary/:id` starts 2890; rebuild 2932–2937 (not 2868–2873). E2 `payroll.js` 739–742 is the 410 manual-deductions handler (740–748), not a rebuild. E3 sum 697 ✓, cap 701–704 ✓, `planStage7Loans` call 685–693 — LWF must be computed before 685. E4 IMPL_PR1 N5 incomplete: `priorDeductions` sums only `PRIOR_DEDUCTION_COMPONENTS` (`headroom.js:28–33`) → that list must gain `'lwf_employee'`; `eligibility.js` inherits it. E5 `getPolicyValue` 113–116 returns a string. E6 AI trigger `schema.js:1713–1735` (CREATE 1715); company-UNIQUE migration (3170–3207) re-creates it from captured SQL (gated, already ran). E7 force-reset list 723–749; `insertPolicyIfMissing` 703. E8 `CAUTION_COLS` `payroll.js:1349`; `SUMMARY_COLS` 1251; summary header 1256–1257; register HEADERS 335–339 (37 cols). E9 UPSERT counts confirmed: plant 56/56/56/53 (`saveSalaryComputation` 849), sales 45/45/45/42 (380). E10 `payslipPdf.js` `wlf` (53) feeds only the 403 bulk path.

## NEW LANDMINES
N1 LWF must be in both `total_deductions` and `headroom.js`, or payslip and ledger disagree with the 50% cap. N2 the loans post-merge component check (`docs/loans/PROGRESS.md` §2) and the sim scripts' `componentShort` would flag LWF rows (₹5 short) — update the docs SQL; scripts stay (unflagged). N3 `statutoryLoans.test.js` T12 already applies LWF Y → fails after PR-2 until its `before` includes `lwf_employee` (intended edit). N4 policy garbage falls back to 5/20; admins can change the amounts via PUT `/policy`. N5 if the deductions cap fires, `lwf_employee` stays 5 while the total is capped (same class as the 5 baseline capped rows). N6 sales PUT `/salary/:id` is blocked on finalized/paid rows (PR-2b). N7 Stage 7 DrillDownRow `colSpan` was off by one. N8 sales LWF for staff outside Punjab — compliance question (OPEN_ITEMS).

## REVIEW CORRECTIONS (chat planner, 10 Oct 2026, 10:00 IST) — binding
- C1 **Scope split for today's plant payroll.** This PR = plant LWF: STEPs 1, 2, 4, 5, 6, 7 as written above (schema adds the sales columns too; `headroom.js` gets both arrays). **PR-2b** (`feat/lwf-sales`, before the 25 Oct sales close): `salesSalaryComputation.js` LWF + save (47/47/47/44), `sales.js` PUT `/salary/:id` rebuild + register totals, `generateSalesPayslipData` line, `salesExportFormats.js` (38 → 39), `SalesSalaryCompute.jsx`, tests Q1–Q6, O2, O4.
- C2 **Phase 0 pre-authorised.** If `git log 8b9561d..origin/main` touches no FILES / DO NOT MODIFY file, go straight to STEP 1. If main moved, merge it in (`--no-ff`, as PR-1 did), report drift, and continue unless a fragile-file conflict (→ OWNER DECISION NEEDED).
- C3 **"Byte-identical for the unflagged" (P9 + the worktree `--dump` comparison) is mandatory** before the PR — it is the guarantee for everyone not on the list in today's payroll.
- C4 Phase 3 sim includes a synthetic mirror of today's run: N flagged employees with pay → N × 5 / N × 20; unflagged employees' nets identical to a pre-PR-2 compute.
- C5 No push (the chat pushes). Same rules as PR-1: named-path staging, identity + trailers, synthetic data only, no production. Report back after STEP 2 and after STEP 7.
