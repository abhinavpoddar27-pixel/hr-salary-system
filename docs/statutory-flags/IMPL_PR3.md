# IMPL_PR3 — Statutory filing (base ad96604 + PR-2b)
> Read-only planning agent, 10 Oct 2026. Lines are on ad96604. In ⚠2b files, re-locate by anchor text.

## SCOPE
BUILD_PLAN §4.7:
- (a) Sales master edits `esi_number` / `uan` under the upload's rules (ESI_NUMBER_RE, UAN_RE, held by another employee → refuse). Audited. Flags stay read-only (R10).
- (b) `generateSalesESIFile`, mirroring the plant ESI file, with a route and a button.
- (c) Plant ECR, plant ESI and sales ESI leave out rows with a blank or malformed identifier. Those rows go in `missing[]` with an `X-Missing-UAN` / `X-Missing-ESI-Number` header. The UI confirms before download.
- (d) A read-only LWF register; last step, can be dropped.
- (e) M2 handled on the read side.

No schema, UPSERT or money-logic change. No sales ECR (sales PF = 0, R4).

## BASE SHA
Base is ad96604. The planner's jest run: **64 suites / 1047 tests green**. PR-3 stacks on **PR-2b**. Phase 0: `git log ad96604..origin/main --stat`. Branch `feat/statutory-filing` from origin/main once PR-2b is merged, else from `origin/feat/lwf-sales`. Re-baseline jest. (d) needs PR-2b's sales `lwf_employee`.

## FILES (F = fragile/identity-sensitive; ⚠2b = PR-2b touches it too)
- `services/statutoryFlags.js` exports 610–616: add `ESI_NUMBER_RE, UAN_RE, numberInUse` (38–39, 222). Only this line.
- F `services/exportFormats.js`:
  - ECR loop 30–53: the UAN, whitespace-stripped (31), blank → `missing` reason `none`; fails UAN_RE → `malformed`; then `continue`.
  - ESI loop 87–105: same at 88 with ESI_NUMBER_RE.
  - Returns: `employees` = rows written; `missing[] {employee_code, employee_name, ee, er, reason}`; totals over written rows plus `missingCount / missingEE / missingER`.
  - SQL, order, line builders and filenames unchanged. `generateBankFile` untouched.
- `routes/reports.js` `/pf-ecr` 243–257, `/esi-contribution` 260–274: set the header when there are missing rows (JSON and download; codes comma-joined, sanitised `[A-Za-z0-9_-]`); JSON gains `missing`. NEW `GET /lwf-register[?download=xlsx]` with `requireHrFinanceOrAdmin` (8–14).
- NEW `services/lwfRegister.js`:
  - Plant `salary_computations` + sales `sales_salary_computations` rows with LWF > 0, joined to their masters (sales on code+company).
  - Columns: payroll, company, code, name, EE, ER. Plant rows add `capped`/`shortfall` (the V11 component sum − `total_deductions`).
  - Company subtotals and a total. XLSX header width = row width.
- ⚠2b `services/salesExportFormats.js`: NEW `generateSalesESIFile`, before `module.exports` (377).
  - Reads `sales_salary_computations c JOIN sales_employees e` (code+company) for month/year/company, ordered by `e.name, code`.
  - **Include** when `esi_employee>0` OR (`carryFlags(db,'sales',e.id,monthKey('sales',YYYY-MM)).esi` AND `gross_monthly <= parseFloat(policy esi_threshold‖21000)`). Hold rows are included.
  - Line = plant builder on `[ip, NAME, round(total_days), round(gross_earned), round(esi_employee), reason]`. Reason 1 = DOJ inside `cycle_start_date..cycle_end_date` (NULL → `deriveCycle`).
  - Same `missing`/totals as plant. Filename `Sales_ESI_<Mon>_<YYYY>_<Company_>.txt`.
- F ⚠2b `routes/sales.js` — the gate at 1099 stays. The guard needs 1495 `if (STATUTORY_FLAG_FIELDS.includes(field)) continue;` **verbatim**.
  - `UPDATABLE_FIELDS` 1103–1112 += `'esi_number','uan'`. Never add them to `STATUTORY_FLAG_FIELDS` 1117.
  - Require at 1118 += the 3 exports. NEW `checkStatutoryNumbers(db, body, existing)`:
    - normalise (strip spaces; '' → null);
    - unchanged vs the stored value (normalised) → `delete body[col]`;
    - malformed → 400 `INVALID_ESI_NUMBER` / `INVALID_UAN`;
    - `numberInUse(db,'sales',col,v,existing?.id ?? -1)` → 409 `NUMBER_IN_USE` + `heldBy`.
  - Call sites: POST `/employees` after the doj check (1350); PUT `/employees/:code` after the status check (1486). Both before any write. The existing `writeAudit` (1543–1554) logs the change.
  - Require 2531–2534 += `generateSalesESIFile`. NEW `GET /export/esi-contribution`, after `/export/bank-neft` (3278), shaped like `/export/salary-register`: 400 without month/year/company, header, JSON `{filename, employees, missing, totals}` or a text/plain download. Read-only.
- `frontend/src/utils/api.js`: `salesExportESI(params, download)` (pattern 613–624; preview uses `fresh`, 160); `getLWFRegister` / `downloadLWFRegister`; `getPFECR` / `getESIContribution` (286, 288) send `fresh`.
- `pages/Sales/SalesEmployeeMaster.jsx`: `ESI number` / `UAN` inputs in 249–261; `validate()` 147–159 regexes when non-blank; `handleSubmit` 168–178 '' → null; badge "ESI no. missing" when `esi_applicable && !esi_number`.
- NEW `components/sales/SalesEsiExportButton.jsx`: preview → when there are missing rows, confirm (codes + ₹, "NOT in the file") → blob download (pattern SalesSalaryCompute 219–260).
- ⚠2b `pages/Sales/SalesSalaryCompute.jsx`: **only** one import and one `<SalesEsiExportButton/>` after the NEFT button (328–334).
- `pages/Reports.jsx`:
  - ECR 744–791 and ESI 794–838: an amber missing panel (bank pattern 859–872); `window.confirm` before download when there are missing rows; cards show written count + missing count/₹.
  - List 235–247: `lwf-register` tab.
- ⚠2b `frontend/dist`: rebuilt in each UI commit.
- Tests NEW: `statutoryFilingPlant`, `statutoryFilingSales`, `statutoryNumbers`, `lwfRegister` (.test.js). Scripts `docs/statutory-flags/sim/filing_identity.js` and `run_pr3.py`.
- ⚠2b docs: VERIFY.sql (V13, V14), RUNBOOK T7, PROGRESS.md, CLAUDE.md.

## DO NOT MODIFY
- `dayCalculation.js`, `salaryComputation.js` (M2 is read-only), `salesSalaryComputation.js` (PR-2b), `schema.js`, `payroll.js`. UPSERTs unchanged (plant 58/58/58/55).
- PR-1 beyond the exports line; `statutoryWriterGuard.test.js` passes **unedited** (3 / 5).
- `services/loans/**`, `recompute.js`, `generateBankFile`, sales Excel / NEFT / TA/DA exporters.
- `sales.js` outside the listed hunks (PUT `/salary/:id` + register totals = PR-2b; structure writers; TA/DA).
- `employees.js`, `salary-input.js`, `import.js`, sales payslip files, `backend/scripts/*`.

## STEPS (each: test → `node --check` → named-path commit → PROGRESS)
1. Exports. `refactor(statutory): export ESI/UAN rules for reuse`. F12.
2. Plant missing handling. `feat(filing): ECR and ESI list missing UAN / ESI numbers instead of writing blanks`. F1–F4 + identity run.
3. Sales ESI file + route. `feat(filing): sales ESI contribution file`. F5, F6.
4. Sales numbers. `feat(filing): sales master edits ESI number / UAN under the upload's rules`. F7, F8; guard unedited and green.
5. LWF register. `feat(filing): LWF register (plant + sales) for the Punjab remittance`. F10, F11.
6. UI-a: api, master, button, SalesSalaryCompute, dist. `feat(filing): ESI/UAN fields + sales ESI export`. Proof: build + bundle grep `esi-contribution`, `ESI no. missing`.
7. UI-b: Reports panels + LWF tab, dist. `feat(filing): missing lists + LWF register on Reports`. Proof: bundle grep `lwf-register`.
8. Final identity run, run_pr3.py, VERIFY V13/V14, RUNBOOK T7, clean rebuild = dist. `docs(filing): …`.

## TESTS (jest; statutoryFixture / jwtApiHarness; synthetic only)
- F1: a fully populated plant month. ECR and ESI content = golden strings built with the pre-PR-3 line builder; `missing` []; no header.
- F2 ECR: blank, spaces-only and 11-digit UANs are excluded (reasons none/none/malformed). Totals cover written rows only; missingCount 3; header on JSON and download; no line starts with `|`.
- F3: F2 for ESI.
- F4: bank content md5 = golden.
- F5 sales selection: in — flagged ESI>0; flagged ≤21k 0 days (`|0|0|0|0`); unflagged ESI>0; hold. Out — >21k; unflagged 0; other company. Days, wages, cycle reason correct.
- F6 route: 400 without company; filename; header; hr/admin 200, finance/viewer 403; DB unchanged.
- F7 PUT: valid with spaces → stored normalised + audit (stage `sales_employee_master`); malformed 400; held 409 `heldBy` (nothing written); unchanged legacy bad value + name edit → 200; '' → NULL audited; flags → `ignoredFields`, structures unchanged.
- F8 POST: valid / 400 / 409; nothing created on refusal.
- F10 register: plant 5/20 + sales rows; unflagged absent; subtotals; XLSX widths; viewer 403.
- F11 (M2): flagged plant row, other deductions > gross → `lwf_employee` 5, total = gross; register `capped` + `shortfall`; ECR/ESI unaffected.
- F12: exported regexes = those `planFlagChanges` uses.

## VERIFICATION
- **Byte-identical plant files:**
  - `git worktree add $SCRATCH/base <PR-2b head>` (symlink node_modules); `node docs/statutory-flags/sim/filing_identity.js --root <tree>` in both trees.
  - Same synthetic DB: two companies, 8 PF + 12 ESI + 20 bank rows, every number valid.
  - ECR / ESI / bank × {A, B, all}: content md5 and filename equal; `employees` deep-equal; totals equal on the old keys; only new keys `missing*`.
  - Run 2 (3 bad UANs, 2 blank ESI numbers): base lines − branch lines = exactly those rows = `missing` = header codes.
- Jest twice (guard unedited). `node --check` on the 6 backend files. DO-NOT-MODIFY diff 0. UPSERT counts unchanged.
- VERIFY V13: capped LWF rows (V11 sum, `lwf_employee>0`); expect 0. V14: per month and payroll, counts of PF>0 without a 12-digit UAN and ESI>0 without a 10-digit ESI number — HR's fix list.
- run_pr3.py (real server, throwaway DATA_DIR): hr number edits ok/409/400; sales ESI download; Reports missing panels + LWF tab; drift 0.

## RISKS + ROLLBACK
- Excluded rows → the portal sees less than was deducted. Guarded by confirm + header + missing ₹ + RUNBOOK T7.
- No plant ESI numbers yet → the plant ESI file is empty (~23 missing) until the plant file is re-uploaded with numbers.
- A previously written non-12-digit UAN is now excluded: run V14 before deploy.
- Rollback: revert the merge in the GitHub UI; no schema change; valid numbers entered stay.

## PLAN ERRATA (ad96604)
- E1 §4.7 `exportFormats.js:71` ✓ (ESI). ECR at 14, bank at 121.
- E2 Sales rows lack `esi_wages`/`payable_days`. Wages = `gross_earned` (ESI base, salesSalaryComputation.js 285–288); days = `total_days`.
- E3 The number rules aren't exported (statutoryFlags.js 610–616).
- E4 Sales PUT silently drops `esi_number`/`uan` (not in 1103–1112). The edit form already sends them (`...initial`, 142).
- E5 `/api/reports` is `requireAuth` only (server.js:200): viewer can download ECR/ESI/bank.
- E6 The ECR NCP (exportFormats.js 48–49; Reports.jsx 782) subtracts Sundays/holidays and the payable days that already include them → 3 absences show as NCP 0. Pre-existing; kept for identity.
- E7 Plant reason code "1 = joined this month" (95–102). The UI (Reports.jsx 829) has no month-end bound.
- E8 Sales has no deductions cap (309–321) → M2 is plant-only.
- E9 Production capped rows (V11) = 5, all Mar–May 2026, before LWF (Sep) → 0 capped LWF rows. In tests, DEDUCTIONS_EXCEED_EARNINGS appears only in loansStage7 (asserts '').
- **M2 proposal: file what is due.** The ECR carries the EE share on EPF wages, the ESI file carries wages, LWF is flat. [INFERENCE] Liability doesn't depend on recovery, so a cap shortfall is an employer cost; a "recovered" figure is arbitrary (the cap acts on the total). Register `capped`/`shortfall`; V13 monthly; F11.

## NEW LANDMINES
- N1 Never file with missing > 0.
- N2 Validate a number only when it changed, or a legacy bad value blocks unrelated edits.
- N3 `numberInUse` checks the same master only; one person under two sales companies → 409 (as the upload).
- N4 The sales flag is read at file time → rows with `esi_employee>0` always kept.
- N5 Sales month = 26→25 cycle (R8).
- N6 Sanitise header values (Node throws on bad chars).
- N7 5-second GET cache (server.js:146) → previews send `fresh`.
- N8 Keep sales.js 1495 verbatim.

## OWNER DECISIONS
- D-F1 **Portal formats** [INFERENCE; confirm with a file the portal accepted]:
  - ESIC uses an Excel template: IP, name, days, wages, reason (0 none, 1 on leave, 2 left…), last working day. No IP-contribution column.
  - EPFO ECR 2.0 uses `#~#`, not `|`.
  - The NCP fix (E6).
  - Default: PR-3 mirrors the plant formats byte-for-byte; PR-3b fixes the formats before the October filing (due 15 Nov).
- D-F2 Missing rows: exclude + warn (default) or block the download.
- D-F3 M2: remit the due amount, employer bears the shortfall (default).
- D-F4 Gate the plant filing endpoints to hr/finance/admin? Default: unchanged; new endpoints gated.
- D-F5 LWF register in PR-3 (default yes; STEPs 5 and 7 can be dropped).
- D-F6 Sales lists flagged zero-wage IPs with 0 days; plant lists contributors only (default as briefed).

## REVIEW CORRECTIONS (chat planner + owner answers, 10 Oct 2026 ~12:20 IST) — binding
- C1 Base: branch `feat/statutory-filing` from `origin/feat/lwf-sales` (dcad556, PR #73 open). If #73 is merged when you
  start, branch from origin/main instead. Phase 0 as PR-2 C2.
- C2 D-F1 (owner): KEEP the current ESI / ECR layouts in PR-3. Record the format findings (ECR `#~#` separator, NCP days
  undercount at exportFormats.js 48–49, ESIC template columns / reason codes) in OPEN_ITEMS as a PR-3b item due before
  the October filing (15 Nov). Do not change line builders.
- C3 D-F2 default: leave out + `missing[]` + header + confirm dialog; RUNBOOK T7 rule "missing must be 0 before filing".
- C4 D-F4 (owner): restrict the plant filing downloads in reports.js that carry UANs / ESI numbers / bank accounts
  (`/pf-ecr`, `/esi-contribution`, the bank salary file, plus any other export there serving those identifiers — list
  them) to hr / finance / admin, using the existing role helper. New endpoints the same. Test: viewer 403, hr/finance/admin
  200. Check the Reports page: no role that keeps access may lose a button; viewer sees a clear message, not a crash.
- C5 D-F3 default (M2): file the amount due; LWF register marks capped rows. D-F5: LWF register IN. D-F6 default.
- C6 VERIFY numbering: PR-2b owns V13/V14 → PR-3's new checks start at V15 (rename any V14 in this plan).
- C7 Owner: sales_master_import.sql stays (not in scope). D3 open: never recompute sales September in any test against
  production; synthetic only.
