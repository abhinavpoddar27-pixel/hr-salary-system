# IMPL_PR1 — Statutory flags PR-1 (base 1d4221c)

> Planned by a separate read-only planning agent on 10 Oct 2026; reviewed and approved by the chat
> planner with the binding REVIEW CORRECTIONS at the end of this file. Where a correction and the body
> disagree, the correction wins.

## SCOPE
BUILD_PLAN §4.1 (minus PR-2 items) + §4.2–§4.5 + L19 fixes: `lwf_applicable` on 4 tables, sales `esi_number`/`uan`, `statutory_flag_batches`, a new-employee flags-off trigger, removal of the startup reset; a service + route + admin page for an audited preview → apply upload with freeze rows so no earlier month changes on re-run; every structure writer carries in-force flags and no request body can change a flag; L19 readers fixed. Out of scope: LWF computation, any recompute, payroll.js (all PR-2).

## BASE SHA
Planned on `1d4221c`. Drift: origin/main is now `d1ad7bf` (Loans PR-6, 8 commits; production already runs it — `loan_adjustments` triggers live). Overlap with this plan's files is limited to added blocks (schema.js +26 at ~3525, server.js +2 at ~365, payroll.js +8 at ~540); every line cited below is unchanged on `d1ad7bf`. Build Phase 0: rebase `feat/statutory-flags` (docs-only commits) onto origin/main after "go".

## FILES (F = fragile)
- F `backend/src/database/schema.js`: delete reset lines 816–821 (comment + 4 UPDATEs; BUILD_PLAN said 854–857). New block right after the sales indexes (~2216, i.e. before the sales backfill at ~2926): `safeAddColumn` `lwf_applicable INTEGER DEFAULT 0` on employees, salary_structures, sales_employees, sales_salary_structures; `sales_employees.esi_number TEXT`, `uan TEXT`; `statutory_flag_batches` (§4.1) + partial unique index (scope, effective_month, file_sha256) WHERE status='applied'; then `DROP TRIGGER IF EXISTS employees_statutory_default_off` + `CREATE TRIGGER … AFTER INSERT ON employees FOR EACH ROW BEGIN UPDATE employees SET pf_applicable=0, esi_applicable=0, lwf_applicable=0 WHERE id=NEW.id; END`. Sales backfill INSERT (2943): add `lwf_applicable` = 0 (migration already ran in production; inert there).
- F `backend/src/services/salaryComputation.js` 301–308: auto-create INSERT OR REPLACE also lists `lwf_applicable` (`employee.lwf_applicable || 0`). Nothing else in this file.
- NEW `backend/src/services/statutoryFlags.js`: `parseFlagFile`, `planFlagChanges`, `applyFlagChanges`, `buildUndoWorkbook`, plus exported helpers `structureForDate(db, scope, empId, key)` (mirrors compute: `effective_from <= key ORDER BY effective_from DESC, id DESC LIMIT 1`, else the latest row) and `carryFlags(db, scope, empId, key)` (that row's `{pf, esi, lwf}`, or all 0 when no structure).
- NEW `backend/src/routes/statutoryFlags.js`: router-level `requireAdmin`; multer memoryStorage, 2 MB, .xlsx/.xls/.csv only.
- `backend/server.js` (after line 231): `app.use('/api/statutory-flags', requireAuth, require('./src/routes/statutoryFlags'))`.
- `backend/src/routes/employees.js`:
  - sync helper (36–144): drop pf/esi/lwf from `updates`; its UPDATE (116–126) no longer sets pf/esi; create path (138) takes flags from `carryFlags` (none → 0) and lists lwf.
  - POST / structure insert (300): explicit flags 0,0,0.
  - PUT /:code: remove pf/esi from `allowedFields` (401), return `ignoredFields`; sync call (472–481) passes gross and pt only; basic/da INSERT (491) uses `carryFlags`.
  - PUT /:code/salary (552–703): master UPDATE (567–582) stops writing pf/esi (numbers and pt kept); sync (586–590) receives pt only; `newStructure` (612–613) drops pf/esi; same-gross UPDATE (673–685) stops writing pf/esi; INSERT (687–697) uses `carryFlags` instead of a default of 1.
  - bulk-import (865–1035): add `requireAdmin`; remove pf/esi from ON CONFLICT SET (908–909); `insertSalary` (919) flags 0 + lwf; drift-repair sync (998–1003) gross and pt only; return `ignoredFields`.
  - integrity-check (1060), integrity-fix (1145): add `requireAdmin`; fix syncs gross only; flag mismatches reported, never written.
- `backend/src/routes/salary-input.js`: approve (130–199): `effectiveFrom` must match `^\d{4}-\d{2}-\d{2}$` else 400; INSERT (166) carries pf/esi/lwf/pt, the three percent columns and pf_wage_ceiling from `structureForDate(effectiveFrom)`, ignores JSON flags; master UPDATE (178–180) sets gross only. request-change (39–75) strips flag keys and returns `ignoredFields`.
- `backend/src/routes/sales.js`: `UPDATABLE_FIELDS` (1100) — PUT /employees/:code skips pf/esi/lwf and returns `ignoredFields`; POST /employees (1304) may set them and adds `lwf_applicable` to master + structure insert/SET (1398–1411). `versionSalesStructureForGross` (1160–1228): flags from `carryFlags(F)`, components still from `cur`, lwf added to INSERT and SET. POST /employees/:code/structures (1617–1665): validate `^\d{4}-\d{2}$`, ignore body flags, flags from `carryFlags(effective_from)`.
- `backend/src/routes/financeAudit.js` 1806–1817: `LEAST` → scalar `MIN`; join the in-force row via `COALESCE(in-effect for printf('%04d-%02d-01',sc.year,sc.month), latest)`; add `pf.expectedEmployeeTotal` (additive; `match` unchanged).
- `backend/src/services/financeRedFlags.js` 91–107: same in-force join; the ESI arm also requires `sc.gross_salary <= 21000` (R1).
- Frontend: NEW `frontend/src/pages/StatutoryFlags.jsx`; `App.jsx` lazy route `/admin/statutory-flags` after line 214; `Sidebar.jsx` `adminOnly` item after Record History (182); `utils/api.js` preview/apply (multipart), batches (`fresh` no-cache), undo file (blob). `Employees.jsx` SalaryModal (55–64, 150–155): pf/esi/lwf read-only from `emp.*`, out of form and payload, link "Change via Statutory Flags". `SalaryInput.jsx` (27, 103–104, 359–363): same. `Sales/SalesEmployeeMaster.jsx` (131, 167–168, 248–249): flags read-only + LWF; create form sends no flags (new employees start 0). `frontend/dist` rebuilt.
- Tests (new): `backend/src/__tests__/helpers/statutoryFixture.js`; `statutorySchema.test.js`, `statutoryFlagsService.test.js`, `statutoryFlagsApi.test.js`, `statutoryWriters.test.js`, `statutoryWriterGuard.test.js`, `statutoryReaders.test.js`, `statutoryLoans.test.js`.

## SERVICE RULES (§4.2, L18)
- Keys: plant S=`2000-01-01`, E=`<month>-01`; sales S=`2000-01`, E=`<month>`.
- Blocking errors (whole apply refused, nothing written): missing column or repeated code (sales: repeated code+company); a matched employee with a malformed structure date; two rows on the same date at `latest` or `forE` (plant compute has no id tie-break, so compute's pick would be ambiguous).
- Row errors (row skipped and listed): unmatched code; ambiguous sales code; no structure (prevents the 2025-01-01 auto-create carrying ON flags).
- Warnings: as §4.2.
- Change test: `flagChanged` when master flags, `forE` flags, or flags on any row ≥ E differ from the file; `numberChanged` when a valid non-blank number differs from the master.
- Apply = `db.transaction(...).immediate()`: insert the batch row first (status 'applying'), re-plan inside the transaction. For each `flagChanged` row: (1) read `latest` (compute's fallback row) and `forE` before any write; (2) freeze: if no row has `effective_from <= S`, insert a full copy of `latest` dated S with `latest`'s own pre-write flags (not the master's); (3) if rows dated exactly E exist, update flags on all of them, else insert a full copy of `forE` dated E with the new flags (sales `effective_to` NULL); (4) update flags on every row with `effective_from > E`; (5) master flags, and numbers when non-blank and valid; (6) audit rows on the passed handle (not db.js `logAudit`, which uses `getDb`): stage `statutory_upload`, remark `batch:<id>`, one per changed field and one per inserted row. Finally write the summary and `undo_json`, status 'applied'.
- Copies: column list from `PRAGMA table_info` minus id/created_at/updated_at (L9); the two literal statements `INSERT INTO salary_structures (${cols})` and `INSERT INTO sales_salary_structures (${cols})` are on the guard's exemption list.
- Second apply of the same file: 0 changes, 0 inserts.

## DO NOT MODIFY
- `services/dayCalculation.js` — never.
- `routes/payroll.js` — PR-2 (L10 rebuild, CAUTION_COLS); fragile.
- `salaryComputation.js` outside 301–308 — fallback, PF/ESI blocks, totals, UPSERT, payslip are PR-2.
- `salesSalaryComputation.js` — reference only (fallback stays); LWF is PR-2.
- `services/loans/**`, `routes/loans.js` — loan PRs; this PR only adds a test. `services/recompute.js` — per-employee savepoint (K25).
- `routes/import.js` — no structure inserts; relies on the trigger.
- Leave files (`leaveEngine`, `leaveSwitchover2026`, `leaveBalanceGuard`, `routes/leaves.js`, `phase5.js`) — copy the `normaliseHeader` pattern from phase5.js; do not import or edit it.
- `financeAudit.js` outside 1806–1817 — the gross revert at 1392 is gross-only and already safe.
- `sales.js` PUT /salary/:id (2826) — PR-2.
- `exportFormats.js`, `salesExportFormats.js`, `payslipPdf.js`, `schemaReference.js`, the AI trigger — PR-2/PR-3.
- `recordHistory/dispositionMap.js` — unknown stages already surface flagged for review.
- `backend/scripts/*` simulations — see N4.
- Register pages (`SalaryComputation.jsx`, `SalesSalaryCompute.jsx`) — PR-2.
- `middleware/*`, `taDaChangeRequest.js`, `employeeProfileService.js`, `EmployeeQuickView.jsx` — read-only uses.
- Never commit `sales_master_import.sql`, xlsx/csv/db files, upload files or undo files (L1).

## STEPS (each: test → node --check → commit → PROGRESS)
1. Schema additions (columns, batch table + partial index, trigger after the columns). ≈60 lines. `feat(statutory): lwf columns, batch table, new-employee flags-off trigger`. Test: T8a, T13.
2. Remove the startup reset (816–821); add `withLiveDefaults(db)` to the fixture (rebuilds employees and salary_structures from `sqlite_master` SQL with DEFAULT 1, then runs `initSchema` again). ≈50 lines. `fix(statutory): remove the startup PF/ESI reset (L2)`. Test: T8.
3. Service read-only half: parse, plan, `structureForDate`, `carryFlags`. ≈150 lines. `feat(statutory): flag file parser and planner`. Test: T7, T14, T15 (plan).
4. Service write half: apply + undo workbook. ≈150 lines. `feat(statutory): apply with freeze/effective rows and undo file`. Test: T1–T6, T10a, T16, T17.
5. Route + mount. ≈100 lines. `feat(statutory): /api/statutory-flags preview/apply/batches`. Test: API cases.
6. Plant master writers (employees.js). ≈130 lines. `fix(statutory): employee master writers preserve flags (R10)`. Test: T9a, T8b, guards.
7. Approval + auto-create + loans: salary-input.js + salaryComputation.js 301–308. ≈60 lines. `fix(statutory): salary approval carries in-force flags; auto-create lists lwf`. Test: T9b, T11b, T12.
8. Sales writers: sales.js + schema.js backfill. ≈100 lines. `fix(statutory): sales structure writers carry in-force flags`. Test: T9c, T11.
9. Grep guard. ≈80 lines. `test(statutory): structure-insert guard`. Test: T10b.
10. L19 readers. ≈40 lines. `fix(statutory): crosscheck and red flags read the in-force structure (L19)`. Test: R1, R2.
11. Admin page + route + sidebar + api.js. ≈150 lines. `feat(statutory): admin upload page`. Test: `npm run build`.
12. Read-only flags in Employees.jsx, SalaryInput.jsx, SalesEmployeeMaster.jsx. ≈60 lines. `fix(statutory): flags read-only in master screens (L4)`. Test: build + bundle grep that no `salary_structures?.pf_applicable` remains.
13. Rebuild dist. `build(frontend): rebuild dist for statutory flags`. Test: the dist bundle contains `statutory-flags`.

## TESTS (jest, synthetic codes only, real `initSchema` on in-memory/temp-dir DBs)
- T1 One row 2025-01-01; apply Sep → a 2026-09-01 row identical except flags; Aug old flags, Sep/Oct new.
- T2 Two exact 2026-09-01 rows both updated in place; a 2026-10-15 row also updated.
- T3 Only a 2026-08-24 row + an August Stage 6 row: recompute August before and after apply, compare every salary column (timestamps excluded); September carries the flags. Repeat with only a 2026-09-06 row.
- T4 Rows 2026-04-22 + 2026-09-06 → copy dated 09-01 from the April row; Sep uses it, Oct uses 09-06; both ON.
- T5 Sales: exact 2026-09 row updated in place, else a copy; a finalized April row served by the fallback recomputes identically; copies `effective_to` NULL; code+company matching; ambiguous code → error.
- T6 Re-apply → 0 changes / 0 inserts. Different `expectedSha256` → 409. Malformed structure date → blocking error, row counts in all 4 tables unchanged.
- T7 Unmatched code skipped; malformed number → warning, not written; number used by another employee → warning; blank number leaves the master unchanged.
- T8 `initSchema` twice → uploaded flags intact (DEFAULT 1 fixture).
- T8b EESL-style upsert (the import.js:383 SQL) + POST /employees with basic>0, then Stage 7 → PF/ESI/LWF 0 on master and structure.
- T9a After an upload: PUT /:code with flags, PUT /:code/salary (same and new gross), bulk-import upsert, integrity-fix → flags on every row and the master unchanged, `ignoredFields` returned. T9b salary approval → new row carries in-force flags. T9c sales gross edit → same.
- T10a Undo workbook re-applied → original flags from E onward; freeze/E rows remain; earlier months unchanged.
- T10b Guard: scan every .js under `backend/src` except `__tests__`, multi-line, for `/INSERT\s+(OR\s+\w+\s+)?INTO\s+(sales_)?salary_structures\s*\(/`; each match's column list must contain pf_applicable, esi_applicable, lwf_applicable. Exemption list (file + literal anchor) has exactly 3 entries: `sales.js` POST /structures and the 2 statements in `statutoryFlags.js`; the test asserts the list size is 3 and that each site has its targeted test.
- T11 Sales PUT /employees/:code with a gross change and `effective_from=2026-05` after an upload → May–Aug recompute unchanged, Sep keeps the new flags.
- T11b Plant approval `effectiveFrom 2026-05-15` → May–Aug unchanged, Sep ON; bad format → 400.
- T12 (new, loans) Live loan via `loanFixture`, flags ON, recompute Sep: loan deduction respects the headroom after PF/ESI; net = gross_earned − total_deductions; August salary row and `loan_deductions` byte-identical.
- T13 Trigger: insert → flags 0; UPSERT conflict branch keeps existing flags (SQLite 3.45).
- T14 A row already ≤ S → no freeze row.
- T15 No structure → row error, nothing written for that code.
- T16 S157 shape (2026-01 closed 2026-09 + 2026-10 open) → E copy from the 2026-01 row with `effective_to` NULL; the 2026-10 row updated.
- T17 Duplicate date at `latest` → blocking error.
- API: admin 200; hr/finance/viewer 403; no token 401 (`jwtApiHarness`); .txt and >2 MB → 400; duplicate applied batch → 409.
- R1 /statutory-crosscheck → 200 (500 today) using the August in-force row. R2 August red flags after an upload → no "PF/ESI applicable but ₹0"; ESI above ₹21k not flagged.
- Baseline: tdsCalculation 3 red and flaky protectedWrite are known; only new failures count.

## VERIFICATION
- `node --check`: schema.js, salaryComputation.js, statutoryFlags service + route, server.js, employees.js, salary-input.js, sales.js, financeAudit.js, financeRedFlags.js.
- UPSERT counts unchanged in PR-1: plant 56 insert / 56 placeholders / 53 SET (52 `= excluded.*` + `is_finalised = 0`); sales 45/45/42 (41 + `computed_at`).
- Simulation-DB drift must be 0 rows: plant `SELECT employee_code FROM salary_computations WHERE ABS(net_salary-(gross_earned-total_deductions))>1;` — sales `SELECT employee_code FROM sales_salary_computations WHERE ABS(net_salary-(gross_earned+COALESCE(diwali_bonus,0)+COALESCE(incentive_amount,0)-total_deductions))>1;`
- After the production apply (RUNBOOK): V1, V6. V10: plant = 124 freeze + 124 effective, minus 1 freeze if code 87100 is in the file; sales — take the figure from the preview totals, not "8 exact / none later" (E14). V2 / V6b unchanged.

## RISKS + ROLLBACK
- Hot paths: PUT /employees/:code/salary (725 calls, last 8 Oct) and salary-input approve (311 calls, last 9 Oct) can rewrite flags today; STEPs 6–7 ship in the same PR as the upload.
- Rollback re-enables the reset (N8): plant ESI flags (no numbers on file) are wiped at the next boot. Prefer rolling forward. If a revert is unavoidable: revert the merge in the GitHub UI and redeploy; the added columns/table/trigger stay and are harmless; re-run the RUNBOOK steps after re-merge.
- Concurrency: apply uses `.immediate()`; better-sqlite3 serialises it with Stage 7.
- No automatic recompute; D3/D6 rules in RUNBOOK still govern September.

## PLAN ERRATA (checked on 1d4221c)
- E1 Reset at schema.js 818–821 (comment 816–817), not 854–857.
- E2 Compute lookup at salaryComputation.js 276–290 (in-effect 276–281, fallback 284–290, no id tie-break in either), not 289–301. Auto-create is the INSERT OR REPLACE at 301–308 (not 313–320) and does not list lwf. Sales `getLatestStructure` at 120–139 (with `id DESC`).
- E3 L3 employee insert paths: import.js 383 and 919, employees.js 292, bulk-import 879 (missing from BUILD_PLAN). Structure inserts omitting flags: employees.js 300 (not 299) and 491 (not 490) get the live DEFAULT 1.
- E4 L5: PUT /:code 384–514 (sync 472–481); PUT /:code/salary 552–703 (insert defaults to 1 at 693–694); GET self-heal 268/272; integrity-check 1060, integrity-fix 1145 (not 1111); bulk-import 865–1035 (not 831/886); financeAudit sync caller at 1392 (not ~1060), gross only.
- E5 L6: approve at 130–199; JSON flags default to 0 (159–160); master UPDATE (178–180) also overwrites flags; the frontend sends no `effectiveFrom`.
- E6 L7 lines confirmed. Only sales.js 1651 is a dynamic structure insert; 1369 inserts into `sales_employees` (not a guard site).
- E7 L11 counts confirmed. Plant ON CONFLICT is on (employee_code, month, year), no company.
- E8 L19: `LEAST` at financeAudit.js 1809 (route 1782–1847), not 1457; production SQLite 3.45.3 answers "no such function: LEAST"; `expected_pf` never returned. Red-flag query at 91–107.
- E9 Later-PR refs: L12 `getPolicyValue` 113–116 ✓; L13 AI trigger at 1715 (not 1751); L15 `CAUTION_COLS` at payroll.js 1341 (not ~1358); force-reset policy list at schema.js ~723–750 (not 759–785).
- E10 PR-1 touches salaryComputation.js (2 lines) but not payroll.js.
- E11 Live DB (read-only): DEFAULT 1 on employees and salary_structures pf/esi/pt; sales tables DEFAULT 0; no employee trigger, no lwf or sales number columns, no batch table; master PF on = 1 (22127), ESI 0; master-ON employees without a structure = 0.
- E12 Fallback: 387 rows, 300 employees, Jan–Sep, 0 finalised — confirmed.
- E13 Plant: 5 codes with only a 2026-09-06 row, and 22331/60123/60231 with later rows (22331's is 2026-09-11) — confirmed; no exact 2026-09-01 rows, no bad formats, no duplicate dates; exactly one row ≤ S (code 87100, dated 1946).
- E14 Sales: 15 exact 2026-09 rows in the table (13 from joiners added 28 Sep–6 Oct); 2 rows after E (S157 2026-10 created 9 Oct; S330 2026-10 created 6 Oct), not "none later"; no bad formats; no rows ≤ S; codes unique across companies.
- E15 usage_logs: bulk-import called once (17 Mar); integrity-fix and POST sales /structures never called.

## NEW LANDMINES
- N1 main moved to `d1ad7bf` and production runs it; rebase first.
- N2 Plant compute has no id tie-break; the service blocks ambiguous dates.
- N3 The AFTER INSERT trigger does not fire on the UPSERT conflict branch; bulk-import's `SET pf_applicable = excluded…` must be removed in code.
- N4 `backend/scripts` simulations (e.g. loans-stage7-simulation.js:85) insert employees with flags = 1; with the trigger their output changes and `--dump` parity claims no longer hold. Record it; do not edit the scripts.
- N5 (PR-2) `planStage7Loans` gets an explicit deduction list (salaryComputation.js ~683–692); LWF must be added there or the loan cap ignores it.
- N6 `logAudit` writes through `getDb()`; the service writes audit rows on the passed handle.
- N7 server.js caches GETs for 5 s; batch reads use the `fresh` (no-cache) helper.
- N8 A revert brings back the reset.
- N9 The undo file holds names and numbers: admin-only, never stored on disk.
- N10 SalaryModal builds form state before `getEmployee` resolves (percent fields show defaults) — pre-existing, out of scope; flags are fixed because they render live.
- N11 /statutory-crosscheck ignores the company filter (pre-existing).

## REVIEW CORRECTIONS (chat planner, 10 Oct 2026) — binding
Verified independently on 1d4221c: reset 816–821, compute lookup 276–290, `LEAST` 1809, the 11 structure-insert sites (schema.js 2944; salaryComputation.js 301; employees.js 138/300/491/687/920; sales.js 1196/1399/1651; salary-input.js 166) and every flag-writing UPDATE / ON CONFLICT SET. Freeze logic, trigger order, all-four reset removal, guard + exemptions and tests 1–11 are present. Approved with:
- C1 Guard, two more assertions in `statutoryWriterGuard.test.js` (same STEP 9): (a) any INSERT into `salary_structures` / `sales_salary_structures` without an explicit column list (`… INTO <table> SELECT` / `VALUES`) fails; (b) R10 guard — any `pf_applicable|esi_applicable|lwf_applicable` assignment (`col = ?`, `col = <literal>`, `col = excluded.col`) inside an UPDATE or ON CONFLICT SET on `employees`, `salary_structures`, `sales_employees`, `sales_salary_structures` fails unless the site is on an explicit allowlist pinned by file + literal anchor: `statutoryFlags.js` (service), schema.js trigger body, schema.js sales backfill ON CONFLICT (inert), sales.js `versionSalesStructureForGross` ON CONFLICT (values come from `carryFlags`), sales.js POST /employees create ON CONFLICT (allowed by §4.4). The test asserts the allowlist size.
- C2 T8b runs on the `withLiveDefaults` fixture (DEFAULT 1), otherwise it does not reproduce L3.
- C3 New T18 for the dynamic-insert exemption: POST /sales/employees/:code/structures after an upload with body `pf_applicable=1, esi_applicable=1` and `effective_from=2026-05` → stored flags = the in-force flags at 2026-05 (body ignored, `ignoredFields` returned); `2026-5` and `2026-05-01` → 400. The T10b exemption entry for this site points at T18.
- C4 T9a also covers the other sync-helper callers: GET /employees/:code self-heal and the financeAudit gross revert (1392) → flags unchanged on every row and the master.
- C5 Rebase discipline: Phase 0 rebases onto the latest origin/main (re-fetch; it was `d1ad7bf`). Immediately before shipping, fetch and rebase again; resolve only purely additive conflicts, re-run the full jest suite, and list every resolved hunk in PROGRESS.md. A conflict inside existing lines of a fragile file → `OWNER DECISION NEEDED:`.
- C6 Push gate: the repo was confirmed public on 10 Oct 2026. Nothing is pushed until the owner makes it private; the build ends with local commits only (see PROGRESS.md 10 Oct rulings).
