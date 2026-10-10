# IMPL_PR2b — sales LWF (base ad96604)

> Read-only planning agent, 10 Oct 2026; completes IMPL_PR2 C1. All code edits were prototyped on a scratch copy of
> ad96604 (not the repo): counts, identity, loan re-plan and the unflagged dump proven.

## SCOPE
Sales compute charges ₹5 EE / ₹20 ER (`lwf_employee_amount` / `lwf_employer_amount`; garbage/negative → 5/20, '0' → 0)
when the in-force sales structure (the row `getLatestStructure` picks, fallback included) has `lwf_applicable = 1` AND
`gross_earned > 0`; held rows charged. LWF enters `total_deductions` and BOTH sales loan salary objects (compute + HR
edit), so the loan stays last inside the 50% cap. Identity `net = gross_earned + diwali_bonus + incentive_amount −
total_deductions` (₹0 floor only with a loan, unchanged). Outputs: register totals, payslip data, Excel 38 → 39, register
UI. No schema step (columns schema.js 2581–2582, keys 1712–1713 exist). No recompute, no flag writer, no plant change.
Carry-overs: **M6 in** (V13/V14, V12 reads policy). **M1, M3, M4 out** — reasons N8–N10.

## BASE SHA
`ad96604` (#70). Phase 0: `git fetch origin && git log ad96604..origin/main --stat`, C2 rules as PR-2.
Baseline: jest **64 suites / 1047 tests** green; sales `--dump` 232 rows, lwf_* all 0.

## FILES (lines on ad96604; F = load-bearing; none of L17's four fragile files is touched)
- F `backend/src/services/salesSalaryComputation.js`
  - after 288 (ESI `}`): `const lwfAmt = (k, d) => { const v = getPolicyNumber(db, k, d); return Number.isFinite(v) && v >= 0 ? v : d; };`
    `const lwfOn = !!structure.lwf_applicable && grossEarned > 0;` `lwfEmployee|lwfEmployer = lwfOn ? Math.round(lwfAmt(key, 5|20) * 100) / 100 : 0;`
  - 303 loan object `… other_deductions: otherDeductions, lwf_employee: lwfEmployee,` · 313 `… + otherDeductions + lwfEmployee` (comment 309)
  - after 366 `lwf_employee: lwfEmployee, lwf_employer: lwfEmployer,`
  - UPSERT, appended last in each list: cols 410 `…, lwf_employee, lwf_employer`; placeholders 424 `?, ?, ?, ?`;
    SET after 467 `lwf_employee = excluded.lwf_employee, lwf_employer = excluded.lwf_employer,`; params 482
    `…, comp.lwf_employee || 0, comp.lwf_employer || 0`. **45/45/45/42 → 47/47/47/44.**
  - payslip: after 537 `{ label: 'LWF (Employee)', amount: comp.lwf_employee },` (filter drops 0); after 562 `lwfEmployer: comp.lwf_employer || 0,`
- F `backend/src/routes/sales.js`, 3 hunks: totals 2937–2943 (+`lwf_employee`, `lwf_employer`); PUT loan object 3010
  `… other_deductions: otherDed, lwf_employee: existing.lwf_employee || 0,`; PUT rebuild 3020
  `(existing.advance_recovery || 0) + (existing.lwf_employee || 0) + loanRecovery;` (comment 3015).
- `backend/src/services/salesExportFormats.js`: header 60 `'ESI Employee', 'LWF Employee', 'PT'`; row after 100
  `round2(r.lwf_employee),`; `!cols` 137 `{ wch: 8 }` after the PF/ESI `{ wch: 10 }`s → 39; JSON totals 69–72, 116–120.
- `frontend/src/pages/Sales/SalesSalaryCompute.jsx`: 456 `min-w-[1540px]`; th after 470 `LWF`; td after 498
  `fmtINR(r.lwf_employee)` (employer in `title`); tfoot 576 `colSpan={3}` → `colSpan={2}` + LWF total td + empty td.
  Header = body = tfoot = 21 (was 20). `frontend/dist` rebuilt.
- Tests: new `__tests__/lwfSales.test.js`; `helpers/salesLoanFixture.js` 67–69 `SALES_SHORT_SQL` + `COALESCE(lwf_employee,0)`.
- Docs: `VERIFY.sql`, `PROGRESS.md`, `OPEN_ITEMS.md` (N3, N10), `CLAUDE.md` §0, `sim/run_pr2b.py` + `seed_pr2b.js` (new).

## DO NOT MODIFY
`dayCalculation.js` · `salaryComputation.js` (N8) · `schema.js` · `payroll.js` · `loans/*` (headroom.js already lists
sales LWF; eligibility reads SELECT *) · `recompute.js` · statutory flags service/route/guard · `exportFormats.js` ·
`settings.js` (N9) · `employeeProfileService.js`, `EmployeeQuickView.jsx` (N10) · sales/plant payslip renderers (E6) ·
`sales.js` outside the 3 hunks (compute route, status, exports, structure writers 1328–1783 / R10) · TA/DA, `cycleUtil`,
`sundayRule`, `driftMonitor` · `backend/scripts/*` · no xlsx/csv/db/employee data (L1).

## STEPS (each: test → `node --check` → commit → PROGRESS line; named-path staging)
0. Branch `feat/lwf-sales` from origin/main; drift check; baseline jest; `git worktree add $SCRATCH/base ad96604`
   (symlink node_modules), base sales + plant `--dump`. Copy this file to `docs/statutory-flags/IMPL_PR2b.md`, PROGRESS
   per VERIFICATION. `docs(statutory): PR-2b plan; PR-1 and PR-2 done in production`.
1. Compute + save. `feat(lwf): sales LWF ₹5/₹20 (flagged, earned gross > 0) in total_deductions and the loan headroom`.
   Q1–Q5. Proof: static counts 47/47/47/44; Q fail on the old file (swap); sales `--dump` md5 = base.
2. sales.js hunks. `feat(lwf): sales salary edit keeps LWF in the total and the loan re-plan; register totals`. Q6.
   Proof: dropping only the 3010 term fails Q6 (prototype: edit loan 1000 vs recompute 995, total 10005).
3. Payslip data + Excel. `feat(lwf): LWF on the sales payslip and the sales register Excel (39 columns)`. O2, O4.
4. UI + `npm run build`, dist in the same commit. `feat(lwf): LWF column and total in the sales salary register`.
   Proof: chunk grep `lwf_employee`; clean rebuild byte-identical.
5. Docs + sims. `docs(lwf): sales component and LWF rule checks; PR-2b simulation`. C3, C4, CLAUDE.md §0.

## TESTS (`lwfSales.test.js`, synthetic; statutoryFixture sales helpers + salesLoanFixture/`startJwtApi` for routes.
IMPL_PR2 never defined Q1–Q6/O2/O4 (E1) — defined here)
- Q1 flag on → 5/20; total = 7 components + 5; identity; PF+ESI rep likewise.
- Q2 flag off → 0/0, total unchanged; days 0 no holiday → row saved, gross_earned 0, 0/0; `hold` row recomputed →
  still `hold`, 5/20; zero-gross structure → excluded.
- Q3 policy = P5 table ('0' → 0/0, '7.5'/'22.5', 'abc' / '-3' / '' / keys deleted → 5/20).
- Q4 recompute byte-identical; flag on → off + recompute → same id, 0/0; static counts, both columns in all four
  lists; HR fields + `finalized` + `neft_exported_at` survive; route compute on a `paid`+NEFT row → kept, −5, warning
  delta −5; control DB: unflagged row identical in every column, flagged differs ONLY in lwf_*, total (+5), net (−5).
- Q5 loan, cap binds → loan exactly 5 less with LWF; ledger = loan; `reconcileLoan` ok;
  `priorDeductions({lwf_employee: 5}, 'sales')` = 500; drift + component SQL 0.
- Q6 PUT as hr1: no-loan flagged row other 100 → total = fixed + 5 + 100; with a loan other 9000 → loan 995, total
  10000, then compute → same row + ledger (K30); unflagged edit = old formula; `paid` row → 409.
- M1 pin: plant upload with a no-structure employee → row error, master lwf 0; Stage 7 auto-create → lwf 0, LWF 0.
- O2 payslip (function + GET `/api/sales/payslip/:code`): `{LWF (Employee), 5}`, `lwfEmployer` 20, total = Σ lines;
  unflagged → no line.
- O4 Excel (`cellStyles: true`): header = rows = `!cols` = 39; 'LWF Employee' index 25; later columns still aligned
  with the DB row; JSON + `/salary-register` totals 5×N / 20×N.

## VERIFICATION
- Sales identity: `SELECT employee_code FROM sales_salary_computations WHERE ABS(net_salary-(gross_earned+COALESCE(diwali_bonus,0)+COALESCE(incentive_amount,0)-total_deductions))>1;` (0 rows)
- V13 sales components (0 rows; run on production now as the baseline): rows where `ABS(total_deductions − (pf_employee
  + esi_employee + professional_tax + tds + advance_recovery + loan_recovery + other_deductions + lwf_employee)) > 1`.
- V14 sales LWF rule, one month (literal 10 for October, 9 for 6A): V7's structure join; EE/ER vs `CASE WHEN
  st.lwf_applicable=1 AND sc.gross_earned>0 THEN COALESCE((SELECT CAST(value AS REAL) FROM policy_config WHERE
  key='lwf_employee_amount'),5) ELSE 0 END` (ER: employer key, 20). V12 takes the same policy read.
- UPSERT: plant 58/58/58/55 unchanged; sales 47/47/47/44. `node --check` salesSalaryComputation.js, sales.js,
  salesExportFormats.js. Full jest twice: 65 suites, 0 failures.
- C3 (mandatory): sales `--dump` base vs branch md5-identical (prototype: 232 rows, `9a426438…` both); plant `--dump` identical.
- C4 `run_pr2b.py` (PR-2 harness pattern, sales): upload → apply 2026-09 → Aug + Sep compute over HTTP; N flagged →
  N×5 / N×20; August byte-identical; Q2/Q4/Q6/O2/O4 shapes end to end; V8/V13/V14 0 rows; `--base` on ad96604:
  unflagged identical, flagged differ only by LWF. Payslip HTML: PR-2's scratch copy of the check + an LWF fixture.
- PROGRESS.md PR STATUS (STEP 0):
  - `PR-1 feat/statutory-flags — DONE: merged #65 (8b9561d). T4/T5 applied 10 Oct 10:59 IST (batches 1 and 2): V1 24/6/118, V6 57/0/139, V10 248/270.`
  - `PR-2 feat/lwf-deduction — DONE: merged #70 (ad96604) 11:11 IST. Plant September recomputed 11:17 IST: LWF 113 / ₹565 / ₹2,260; ESI 23 / ₹2,469.06 / ₹10,699.18; PF 6 / ₹9,762.86. V3/V5/V12 0 rows; V11 only the 5 known March–May rows. Against the snapshot: 113 rows exactly −₹5, 98 identical.`
  - `PR-2b feat/lwf-sales — PLANNED: IMPL_PR2b.md (base ad96604); live before HR computes October sales (close 25 Oct).`
  - LAST STEP = PR-2b plan; NEXT STEP = PR-2b STEP 1; keep "do NOT recompute sales September" until D3 is answered.

## RISKS + ROLLBACK
- Nothing moves until a sales compute of a month whose in-force structure has lwf=1 (T5 → 2026-09 on). October
  (cycle 26 Sep–25 Oct) is the first live month (≈139 × ₹5 / ₹20).
- **6A after PR-2b:** compute is NOT blocked by `finalized` / `paid` / `neft_exported_at`; it rewrites every row of the
  active September upload, carrying status, stamps and HR-entered fields. The 139 flagged with gross_earned > 0 get
  5/20 (₹695 / ₹2,780 — the register's 139 × ₹5 incl. the 10 holds); ESI on the 57 (T5) lands in the same run
  (≈ ₹6,619.43 vs ₹6,614); `finalizedRecomputeWarnings` lists each locked row
  moved > ₹1; September TA/DA is re-run too (N4). The six Other Deductions then need finalized → hold → computed /
  reviewed → edit → reviewed → finalized; **`paid` rows cannot take them** (N3). Never regenerate the NEFT file.
  Pre-check (aggregate): `SELECT status, COUNT(*), SUM(neft_exported_at IS NOT NULL) FROM sales_salary_computations WHERE month=9 AND year=2026 GROUP BY status;`
- Rollback: revert the merge in the GitHub UI, redeploy. The old UPSERT does not SET lwf_*, so rows recomputed after
  the revert keep stale lwf_* → V13 flags them; SQL Console UI with remark:
  `UPDATE sales_salary_computations SET lwf_employee=0, lwf_employer=0 WHERE month=? AND year=?`, then recompute.

## PLAN ERRATA
- E1 Q1–Q6, O2, O4 (IMPL_PR2 C1) are defined nowhere (repo, history, project doc).
- E2 PUT `/sales/salary/:id` now starts 2956 (was 2890); rebuild 3017–3022 via `salesNetWithLoanFloor`; totals 2937–2943.
- E3 PR-8 added a loan re-plan in PUT (3002–3014) whose `salary` object omits LWF; IMPL_PR2 named only the rebuild.
- E4 Sales compute plans loans from a salary object (298–305); headroom.js already lists sales `'lwf_employee'` (inert until now).
- E5 Sales UPSERT on ad96604 = 45/45/45/42 (SET incl. `computed_at = datetime('now')`).
- E6 Both sales payslip renderers map `deductions` generically → the line needs no edit; the sales payslip shows no
  employer PF/ESI, so `lwfEmployer` stays API-only (owner may ask for a visible line).
- E7 Sales `getPolicyValue` returns '0' as a string → use `getPolicyNumber` + `>= 0` (same results as plant on P5).
- E8 Baseline 64/1047 (PR-2 said 63/1036; #68 added a suite). E9 No schema step. E10 Register cells 20 → 21.
  E11 Sales Excel has no totals row; `!cols` has 38 entries.

## NEW LANDMINES
- N1 Sales LWF lives in 4 places: compute total 313, compute loan object 303, PUT rebuild 3020, PUT loan object 3010.
  Miss one → over the cap, or edit ≠ recompute (proven).
- N2 Any sales September recompute (6A or a stray click) rewrites the 187 NEFT-exported rows + 10 holds. D3 first.
- N3 `paid` is terminal → Other Deductions cannot be entered on paid rows (409).
- N4 Sales compute always re-runs TA/DA `recomputeCycle` for the cycle (outputs recomputed; inputs, stamps kept).
- N5 Holidays credited to all (v1): a days-0 row with a holiday has gross_earned > 0 → LWF charged (R7 literal). No ₹0
  floor without a loan → a tiny-gross flagged row can go negative by LWF (PR-8 Q1).
- N6 Fixture `SALES_SHORT_SQL` gains LWF; `loans-sales-simulation.js` componentShort (316) stays 7-term (unflagged).
- N7 Out-of-Punjab sales staff pay Punjab LWF (owner follows the register) — compliance item open.
- N8 M1 out: salaryComputation.js auto-create (292–315) cannot meet master lwf=1 — no-structure upload rows are errors
  (statutoryFlags.js 283) and skipped (474); no `DELETE FROM salary_structures` in backend/src; insert trigger zeroes
  flags; production V10 248 = 124 × 2, 0 row errors. Pinned by the M1 test; fragile file untouched.
- N9 M3 out: LWF keys are not on the Settings Policy tab (admin API / SQL Console only); garbage → 5/20 is the safe
  side; a warning means editing salaryComputation.js; validating PUT `/policy` would 400 every Settings save (the tab
  posts the whole config) once any key is bad.
- N10 M4 out: EmployeeProfile shows only total/PF/ESI (total has LWF); EmployeeQuickView reads `ee_pf`/`ee_esi`/
  `basic_earned`/`net_salary`, which the payslip payload never returns — blank already (pre-existing).

## REVIEW CORRECTIONS (chat planner, 10 Oct 2026 ~11:50 IST) — binding
- C1 Accepted as written (M6 in; M1/M3/M4 out with N8–N10 reasons; employer LWF on the sales payslip stays API-only, E6).
- C2 Production fact (11:45 IST): sales September = 215 `computed` (187 NEFT-exported) + 15 `hold`; 0 finalized, 0 paid;
  total_deductions 0 on all 230. So 6A (if chosen) can take Other Deductions without status moves except hold rows.
- C3 VERIFY numbering: PR-2b owns V13 (sales components) and V14 (sales LWF rule). PR-3 numbers its new checks from V15.
- C4 Phase 0 as PR-2 C2 (merge origin/main --no-ff if it moved; stop only on a fragile-file conflict). Run all steps 0–5
  without stopping; report at the end. No push (the chat pushes). Same identity/trailers/named-path rules as PR-2.
- C5 N5 (tiny-gross flagged row going negative by ₹5 with no loan): add one test that pins the current behaviour and
  note it in OPEN_ITEMS; no code change.
