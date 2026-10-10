# STATUTORY FLAGS + LWF — BUILD PLAN (v2, 9 Oct 2026)

Owner: Abhinav. Written in chat from live DB reads (HR SQL Console) + a read-only clone of `main` @ `ae4830f`,
then reviewed by an independent agent against code and live data (v2 folds in that review).
Line numbers are from `ae4830f` — **re-verify every one before editing** (the planning session does this).

## 0. GOAL
Turn ESI / PF / a new LWF deduction on for **exactly the employees HR marked in the manual registers**
(never everyone under a threshold), effective from the **September 2026** wage month, for plant and
sales, through one audited upload screen (preview → apply). Stage 7 and sales compute then produce the
deductions, **no earlier month changes if re-run**, and no other code path can silently undo the flags.

## 1. OWNER RULINGS (final — do not re-ask)
- R1 ESI ceiling stays ₹21,000; engine skips ESI in any month gross > ₹21,000 (unchanged behaviour).
- R2 Master edited **only** for employees in the upload file. No threshold-based mass enable.
- R3 Plant: the **August 2026** register marking is used for September. "DRIVER" row ignored.
- R4 PF stays with the existing 6: 17360, 18054, 19222, 21825, 22331, 21498; app formula
  (12% × min(basic+DA, ₹15,000)) replaces HR's flat ₹1,800; PF ceiling ₹15,000 for September.
- R5 The 7 UAN holders without PF stay out; 22127 (PF ON today) is switched OFF by the upload.
- R6 No ESI/PF on OT/ED (already true; do not change).
- R7 LWF ₹5 employee / ₹20 employer per month, per-employee flag, only in months with earned gross > 0.
  Contractors on the list are charged.
- R8 Effective wage month = September 2026 (plant calendar Sep; sales cycle 26 Aug–25 Sep = month 9).
- R9 Sales ESI list: OPEN_ITEMS D1 (file built from the September register = 57).
- R10 Flags change only through the upload page from now on (OPEN_ITEMS D2, default yes).

## 2. THE DATA (counts the preview must reproduce)
Upload files stay **outside the repo** (names + ESI numbers; L1).

| File | Rows | ESI=Y | PF=Y | LWF=Y | Changed vs today |
|---|---|---|---|---|---|
| plant_statutory_flags_2026-09.xlsx | 125 | 24 | 6 | 118 | 124 (23152 unchanged) |
| sales_statutory_flags_2026-09.xlsx | 139 | 57 | 0 | 139 | 139 (+46 ESI numbers) |

Plant columns `code,name,type,esi_applicable,pf_applicable,lwf_applicable,esi_number,uan,note`;
sales `code,company,name,esi_applicable,pf_applicable,lwf_applicable,esi_number,uan,note`. Y/N.
Blank number = leave unchanged.

Expected September effect (9 Oct data):
- Plant ESI 23 people (23666 has no Sep pay) → EE ₹2,450.74, ER ₹10,619.82
- Plant PF 6 → EE ₹9,762.86 (per-person split in the private claude.ai project doc), EPS ₹6,777.05
- Plant LWF 113 with Sep pay → EE ₹565, ER ₹2,260
- Sales ESI 57 → app ≈ ₹6,619.43 vs register ₹6,614 (rounding); Sales LWF 139 → ₹695

## 3. LANDMINES
- L1 **Repo was reported anonymously readable on 9 Oct** (owner to make it private before T0). Even
  when private: never commit upload files, register extracts, names+numbers,
  employee lists. Stage named paths only — never `git add -A` / `git add .`. Fixtures synthetic.
- L2 **Startup reset** `schema.js:854-857` zeroes PF (no UAN/PF no.) and ESI (no ESI no.) on every boot,
  across all structure rows. Plant ESI numbers don't exist → uploads would be wiped. Remove all four.
- L3 **Live defaults are 1.** Live `employees` and `salary_structures`: `pf_applicable`, `esi_applicable`
  DEFAULT **1** (PRAGMA-verified; schema.js text says 0). Sales tables DEFAULT 0. Inserts that omit flags:
  `import.js:383` (EESL import upsert — the main new-joiner path; 398 rows with is_data_complete=0),
  `import.js:919` (reconciliation add-to-master), `employees.js:281-300` (POST /, incl. structure at :299),
  `employees.js:490` (PUT /:code structure insert), `salaryComputation.js:313-320` (auto-create copies
  master flags), `employees.js:137-141` (sync create path, from master). L2 masks all of this today.
- L4 **Salary modal bug** `Employees.jsx:60-61` reads `emp.salary_structures?.*`; API returns
  `salaryStructure` → PF/ESI default 1 on every Salary save. Same `?? 1` pattern in `SalaryInput.jsx:27,103-104,359-363`.
- L5 **In-place structure sync** `syncSalaryStructureFromEmployee` (`employees.js:35-144`) overwrites the latest
  row's flags from `employees.*`. Callers: `PUT /:code` (~471-481), `PUT /:code/salary` (master flags 563-577,
  sync 581-585, direct UPDATE 667-680, insert 682-692 defaulting flags to 1), `GET /:code` self-heal (~267/271),
  `/admin/integrity-fix` (1111, no role guard), `POST /bulk-import` (831/886, no role guard), financeAudit (~1060).
- L6 **Salary approval** `salary-input.js:130-190` (insert ~166) writes a row dated today (or unvalidated
  `req.body.effectiveFrom`) with flags from stale request JSON (default 0); omits pt/percent/pf_wage_ceiling.
- L7 **Sales structure writers:** `PUT /employees/:code` (`sales.js:1439-1552`) writes flags to master only;
  `versionSalesStructureForGross` (`sales.js:1160-1228`, every gross edit) carries pf/esi/pt but not lwf;
  `POST /employees/:code/structures` (`sales.js:1617-1665`, API only) takes flags from body, any date format;
  sales backfill `schema.js:~2980`.
- L8 **Formats + matching.** Plant `YYYY-MM-DD`, matched `<= 'YYYY-MM-01'`, no id tie-break, no UNIQUE.
  Sales `YYYY-MM`, UNIQUE(employee_id, effective_from), `effective_to` exists (S054, S157, S330 have closed rows).
- L9 **Structure copies carry every column** except id/created/updated (and sales `effective_to` → NULL);
  a zero-component row makes compute re-derive 50/20 (`salaryComputation.js:~411-419`).
- L10 **Fixed-list deduction rebuilds:** `salaryComputation.js:697`, `salesSalaryComputation.js:301-304`,
  `sales.js:2868-2873`, `payroll.js:739-742`.
- L11 **UPSERTs:** plant 56 insert / 56 placeholders / 53 SET; sales 45 / 45 / 42. New columns in all four places.
- L12 `getPolicyValue` (`salaryComputation.js:111-114`) can return a string — `parseFloat` it.
- L13 AI cache trigger (`schema.js:1751`) is `CREATE TRIGGER IF NOT EXISTS` → editing its column list does
  nothing in production. `DROP TRIGGER IF EXISTS invalidate_salary_ai_cache` then recreate.
- L14 Sales recompute touches `finalized`/`paid` rows; sales Sep was exported to bank 7 Oct (187 rows). OPEN_ITEMS D3.
- L15 Index-sensitive exports: `payroll.js` salary-slip-excel `CAUTION_COLS` (~1358), tfoot `colSpan`s.
- L16 Railway serves committed `frontend/dist/` — rebuild + commit after frontend changes.
- L17 Fragile files (plan gate): `salaryComputation.js`, `dayCalculation.js`, `schema.js`, `payroll.js`.
  This build touches all but `dayCalculation.js`.
- **L18 FALLBACK TRAP (blocker found in review).** Plant (`salaryComputation.js:289-301`) and sales
  (`salesSalaryComputation.js:121-136`) use the **latest row regardless of date** when no row is in effect.
  387 plant computation rows (300 employees, Jan–Sep 2026, none finalised) and 66 sales April rows
  (finalized) were computed this way; 70 of the 125 plant codes and 26 sales codes are affected.
  A naive forward-dated row (or updating a later-dated row) therefore changes earlier months on any re-run.
  §4.2 freeze rows exist to stop this.
- L19 `financeAudit.js:1457` `/statutory-crosscheck` uses `LEAST()` (not SQLite) — already broken; and
  `financeRedFlags.js:91-100` reads the latest structure → will raise false "PF/ESI applicable but ₹0"
  on August rows after the upload. Fix both to use the in-effect row (PR-1, small).

## 4. DESIGN

### 4.1 Schema (PR-1, additive, `safeAddColumn`)
- `lwf_applicable INTEGER DEFAULT 0` on `employees`, `salary_structures`, `sales_employees`,
  `sales_salary_structures`; `sales_employees.esi_number TEXT`, `sales_employees.uan TEXT`.
- `statutory_flag_batches(id INTEGER PK, scope TEXT CHECK(scope IN('plant','sales')), effective_month TEXT,
  file_name TEXT, file_sha256 TEXT, row_count INT, changed_count INT, status TEXT, applied_by TEXT,
  applied_at TEXT DEFAULT (datetime('now')), summary_json TEXT, undo_json TEXT)`.
- Trigger `employees_statutory_default_off`: `AFTER INSERT ON employees` → set pf/esi/lwf = 0 for NEW.id
  (the upload never inserts employees). Neutralises L3 for every employee insert path. Create it **after**
  the `lwf_applicable` `safeAddColumn` calls (it references the column; wrong order breaks every insert).
- Remove the four startup-reset statements (L2).
- PR-2: `lwf_employee REAL DEFAULT 0, lwf_employer REAL DEFAULT 0` on both computation tables; policy
  `lwf_employee_amount=5`, `lwf_employer_amount=20` via `insertPolicyIfMissing` (not the force-reset list
  `schema.js:759-785`); drop+recreate the AI cache trigger with the LWF columns (L13).

### 4.2 Service `backend/src/services/statutoryFlags.js` (new)
- `parseFlagFile(buffer, scope)` — header-normalised (`phase5.js:385-400` pattern); Y/N/1/0/yes/no;
  codes as text; reject on missing column or repeated code (sales: repeated code+company).
- `planFlagChanges(db, {scope, effectiveMonth:'YYYY-MM', rows})` → per row
  `{code, matched, before, after, changed, warnings[], error}`.
  Match: plant by `employees.code`; sales by `code` + `company` (file column; if a code matches more than
  one sales employee → error). Unmatched → error, skipped; never creates employees.
  Warnings: ESI=Y with gross > 21,000; status ≠ Active; no pay row for the month; PF=Y without UAN/PF no.;
  malformed number (ESI 10 digits, UAN 12 — not written); number used by another employee.
  Error: any structure row with a malformed date (plant `^\d{4}-\d{2}-\d{2}$`, sales `^\d{4}-\d{2}$`).
- `applyFlagChanges(db, {scope, effectiveMonth, rows, user, fileName, sha256})` — ONE transaction:
  0. Insert the batch row (status 'applying') first; **re-plan inside the transaction** (never trust the preview).
  For each matched, changed row (plant: `S='2000-01-01'`, `E='YYYY-MM-01'`; sales: `S='2000-01'`, `E='YYYY-MM'`):
  1. `latest` = row compute's fallback would pick (max effective_from[, max id]);
     `forE` = row compute would pick for E (in-effect, else `latest`). Both read **before** any write.
  2. **Freeze:** if no row has `effective_from <= S`, insert a full copy of `latest` dated S with the
     **current** flags. Months that used the fallback now resolve to this frozen copy — same components,
     same flags → any re-run of an earlier month is unchanged.
  3. **Effective row:** if rows dated exactly E exist → update flags on all of them; else insert a full copy
     of `forE` dated E with the new flags (sales `effective_to` NULL).
  4. Update flags on every row with `effective_from > E`.
  5. Master row: flags; numbers when non-blank and valid.
  6. `logAudit` per changed field and one row per inserted structure row (freeze / effective), stage
     `statutory_upload`, remark `batch:<id>`.
  Finally write summary + `undo_json`, status 'applied'. Any error → whole transaction rolls back.
- Idempotent: second apply → 0 changed rows, 0 inserts (freeze exists, E row exists, values equal).
- `buildUndoWorkbook(batchId)` → before-values in the upload layout. Limits (state in UI): blank numbers
  mean "unchanged", so added numbers stay; freeze/effective rows stay (with original flags restored).
- Live 9 Oct: plant file — 0 without a structure, 0 exact-date, 5 with only a 2026-09-06 row
  (23765, 23767, 60346, 60347, 60351), 3 more with later rows (22331, 60123, 60231). Sales — 8 exact
  `2026-09`, none later, 0 bad formats.

### 4.3 Route `backend/src/routes/statutoryFlags.js` → `/api/statutory-flags` (mount in `server.js` with `requireAuth`)
- `POST /preview` (multipart `file`, `scope`, `effectiveMonth`) — admin (page is `adminOnly`).
- `POST /apply` (same + `expectedSha256`) — **admin only**; 409 on hash mismatch or duplicate applied
  batch (same sha+scope+month).
- `GET /batches`, `GET /batches/:id/undo-file` — admin. multer memoryStorage, 2 MB, .xlsx/.xls/.csv.
- Add `statutory_upload` to `recordHistory/dispositionMap.js` if that map needs every stage.

### 4.4 Single path for flags (R10) — every writer must preserve flags
Rule: every `INSERT INTO salary_structures` / `sales_salary_structures` (and every in-place UPDATE of a
structure) lists `pf_applicable, esi_applicable, lwf_applicable` explicitly, **carried from the row in
effect at the new row's own effective date, using the same fallback as compute** — never from the latest
row (after an upload the latest row is the new-flag row; copying it into a back-dated row reopens L18).
Brand-new employees get 0. No endpoint changes flags from a request body except the upload.
- `employees.js`: POST / (:281-300 incl. :299), PUT /:code (:383-512 incl. :490), PUT /:code/salary
  (:547-697), sync helper (:35-144 incl. create :137), bulk-import (:831-1000, add `requireAdmin`, keep
  existing flags on conflict), integrity-check/fix (add `requireAdmin`). Flag fields in bodies → ignored,
  returned as `ignoredFields`.
- `salary-input.js` approve (~:166): carry flags + pt + percent columns + pf_wage_ceiling from the row in
  effect; validate `effectiveFrom` format.
- `import.js:383`, `:919`: rely on the employees trigger; any structure insert lists flags explicitly.
- `salaryComputation.js:313-320` auto-create: flags from master (master is 0 for new rows via trigger) —
  confirm it lists `lwf_applicable`.
- Sales: `PUT /employees/:code` ignores flag fields on update; `versionSalesStructureForGross`
  (`sales.js:1160-1228`, accepts back-dated `effective_from`, in active use for arrears) takes all three
  flags from the row in effect at its target month F, not the latest open row; `POST /employees/:code/structures` carries flags from in-effect row, validates `YYYY-MM`;
  `POST /employees` (create) may set flags (dated structure); sales backfill (`schema.js:~2980`) carries lwf.
- Frontend: Employees.jsx Salary modal, SalaryInput.jsx, SalesEmployeeMaster.jsx → flags read-only (real
  values, fix L4) with a link "Change via Statutory Flags".
- Guard test: a jest test scans `backend/src` (multi-line template strings included) for
  `INSERT INTO salary_structures` / `sales_salary_structures` / `INSERT OR REPLACE INTO salary_structures`
  and fails if a statement omits `pf_applicable`, `esi_applicable` or `lwf_applicable`. Sites built from
  dynamic column lists (`sales.js:~1369`, `~1651`) go on an explicit exemption list in the test, each
  with its own targeted test instead.

### 4.5 Admin page `/admin/statutory-flags`
Scope (Plant/Sales) · month (default 2026-09) · file drop · Preview (before → after per flag, warnings,
errors, "changed only" filter) · totals · Apply (admin, confirm quoting counts) · batch history + undo file
with its limits. Lazy route `App.jsx`, `adminOnly` sidebar item, client calls in `utils/api.js`.

### 4.6 LWF engine (PR-2)
- Plant compute: `lwfEmployee/lwfEmployer = salStruct.lwf_applicable && grossEarned > 0 ? policy : 0`; add
  `lwfEmployee` to `totalDeductions` (L697) before the cap (701-704); not contractor-gated.
- `saveSalaryComputation` +2 cols in all four places; `generatePayslipData` deduction `LWF (Employee)` +
  `lwfEmployer` in employer block. Sales compute/save/payslip the same (sales identity:
  `net = gross_earned + diwali_bonus + incentive_amount − total_deductions`).
- L10 rebuilds include `lwf_employee`. Outputs: Stage 7 register UI + tfoot, salary-register Excel,
  salary-slip-excel (mind `CAUTION_COLS`), sales register UI + `salesExportFormats.js` (38→39), `payslipPdf.js`
  `wlf` placeholder, register totals objects, financeAudit `/report`, `schemaReference.js`, AI trigger (L13).

### 4.7 Filing (PR-3)
Sales master UI shows/edits `esi_number`, `uan` (numbers, not flags); `generateSalesESIFile` mirroring
`exportFormats.js:71` + route + button; PF ECR and both ESI files return `missing[]` + warning header
instead of writing blank identifiers.

## 5. PR SEQUENCE (one PR per session pair; deploy + verify before the next)
| PR | Branch | Contents |
|---|---|---|
| PR-1 | feat/statutory-flags | 4.1 (minus PR-2 items) · 4.2 · 4.3 · 4.4 · 4.5 · L19 fixes |
| PR-2 | feat/lwf-deduction | 4.1 PR-2 items · 4.6 |
| PR-3 | feat/statutory-filing | 4.7 |
RUNBOOK operations start after PR-1 **and** PR-2 are live.

## 6. TESTS (jest, synthetic only)
PR-1:
1. Structure 2025-01-01 → apply Sep → row 2026-09-01 identical except flags; Aug unchanged, Sep/Oct new.
2. Existing 2026-09-01 row(s) → all updated in place; a 2026-10-15 row also updated.
3. **Fallback:** only a 2026-08-24 row + an August pay row → apply Sep → August recompute byte-identical
   (freeze row used), September has flags. Same with only a 2026-09-06 row.
4. Rows 2026-04-22 + 2026-09-06 → copy dated 09-01 from the April row; Sep uses it, Oct uses 09-06; both ON.
5. Sales: in-place on UNIQUE `2026-09`; copy otherwise; April (fallback-served, finalized) unchanged on re-run;
   `effective_to` NULL on copies; code+company matching; ambiguous code → error.
6. Re-apply → 0 changes, 0 inserts. Hash mismatch → 409. Malformed structure date → error, nothing written.
7. Unmatched code / malformed number / duplicate number / blank number behaviour.
8. `initSchema` twice → uploaded flags intact (L2). EESL-import style insert + Stage 7 → PF/ESI/LWF 0
   (tables created with DEFAULT 1 in the fixture to reproduce L3).
9. PUT /:code, PUT /:code/salary, salary approval, sales gross edit after an upload → PF/ESI/LWF unchanged.
10. Undo workbook re-applied → original flags. Grep guard test (4.4).
11. **Back-dated sales gross edit after an upload** (`PUT /sales/employees/:code` with
    `effective_from=2026-05`) → May–Aug recompute unchanged; September keeps the new flags.
    Same idea for plant salary approval with a back-dated `effectiveFrom`.
PR-2: LWF 5/20 when flagged and gross>0; 0 when gross 0 or flag off; contractor charged; held still charged;
identity holds; recompute stable; UPSERT round trip; `PUT /sales/salary/:id` keeps LWF; payslip line;
Excel header width = row width.
Baseline red: tdsCalculation (3), protectedWrite flaky — report only new failures.

## 7. DONE MEANS
Tests green (no new failures), `node --check` clean, dist rebuilt+committed, branch pushed and SHAs match,
PR opened by the owner in the GitHub web UI, PROGRESS.md + CLAUDE.md Section 0 updated.
