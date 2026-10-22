# P5-02: Phase 0 plan. Employee master bulk edit
Branch `feat/bulk-master-edit` (worktree `/home/claude/wt-p502`, off main `b2badcab`). Port 3506.
This PR is **MONEY-ADJACENT** (bank details, Left / loans, company), so an independent review follows.
Spec: MASTER_PLAN §6 P5-02 and §7.4 B2.

Rulings that apply:
- **Q3 (owner):** finance approves the sensitive fields only. Everything else applies directly, with audit rows.
- **Q11 (owner):** company can be changed in bulk, with finance approval.
- **R2:** sensitive fields need finance approval.
- **R3:** a batch is all-or-nothing.
- **R5 + Q2:** at most 50 rows per batch, split automatically.
- **R8:** never enter the same thing twice.
- **R10:** PF / ESI / LWF flags are excluded.
- **Q6:** a second person always decides.

Status: **Phase 0. No code written.**

## 1. Facts

### FACT (code). Every path that writes the employee master today
| Field (column) | Single path today | Guard | Audit today |
|---|---|---|---|
| default shift (`default_shift_id` + `shift_code`) | `PUT /employees/:code` (L419); `PUT /employees/bulk-shift` (L363) | hr/admin | `audit_log` field `shift_assignment`, stage `employee_master`, action `shift_change` (both paths, different remark text) |
| department, designation, contractor_group | `PUT /:code` | hr/admin | **none** |
| bank_name, account (`account_number` + `bank_account`), IFSC (`ifsc_code` + `ifsc`) | `PUT /:code`, `PUT /:code/salary` | hr/admin; `readBankPairs` → 400 `BANK_PAIR_MISMATCH`; writes all four columns | `auditBankChange`: last 4 characters only, stage `bank_details_change`. bank_name has no audit. |
| pan, uan, esi_number | `PUT /:code`; uan and esi_number also via the Statutory Flags upload (`statutoryFlags.js` `ESI_NUMBER_RE` / `UAN_RE` / `numberInUse`) | hr/admin (upload: admin) | **none** on `PUT /:code`; the upload audits |
| company | `PUT /:code` | hr/admin | **none** |
| status → Left | `PUT /:code/mark-left` (L846) only. `PUT /:code` refuses an exit (P4). | hr/admin | `logAudit` status row; loans flagged (`recover_at_exit`, `loan_events`, `consolidateForExit`, alerts after commit) |
| gross / components | `PUT /:code/salary` → `salary_change_requests` (finance). `PUT /:code` refuses: `GROSS_CHANGE_NEEDS_APPROVAL` / `SALARY_CHANGE_NEEDS_APPROVAL`. | — | already covered by **P5-04** (salary revision kind) |
| pf / esi / lwf flags | Statutory Flags upload only. `PUT /:code` lists them in `ignoredFields`. | admin | R10 + `statutoryWriterGuard.test.js` |
| employment_type (also re-derives `is_contractor`), weekly_off_day, category | `PUT /:code` | hr/admin | none (employment_type only from the leave switchover) |

Two gaps follow from this table:
- **Gap A (FACT):** the single `PUT /:code` lets HR change bank, PAN, UAN, ESI and company **directly**, with no finance step. Once this PR lands, the bulk path asks finance for something the single path does not. **Q10.**
- **Gap B (FACT):** plant `employees` has **no `punch_no` and no `reporting_manager` column**. Those columns exist on `sales_employees` only. For plant, the punch number IS `employees.code`, the biometric key every attendance table joins on. MASTER_PLAN lists both as direct fields. **Q1.**

### FACT (code). What reads each field
- **department:** payroll reads it only through the third fallback of `isContractorForPayroll`, which applies when `employment_type` is blank AND `is_contractor = 0`. Production has 0 Active rows with a blank `employment_type` (see below), so a department change cannot move pay today. The kind still guards it (see §4).
- **company:** Stage 6 tags each row through `normalizeCompany` (master company when it is canonical). The UNIQUE key no longer contains company (`migration_drop_company_from_unique_v1` = 1 in production). So a company change does **not** create duplicate rows. Instead, the next Stage 6/7 run of **any** open month re-tags that employee's row to the new company. That moves the row between the two companies' NEFT, ECR and ESI files, even for an old month whose bank file has already gone out. Plant loans match on code only, and sales is a separate table, so neither is touched.
- **CANONICAL_COMPANIES:** `Asian Lakto Ind Ltd` and `Indriyan Beverages Pvt Ltd` (salaryComputation.js L43; loans `VALID_COMPANIES` is the same list).

### FACT (production, read-only, counts only, 22 Oct 2026)
- **Employees:** 1,229 total, 389 Active.
- **Active employees, by field:**
  - Departments: 90 distinct.
  - Designations: 104 distinct, 8 blank.
  - contractor_group: 0 distinct (all blank).
  - Shifts: 5 of 8 defined shifts in use; 200 Active employees have no `default_shift_id`.
  - employment_type: 0 blank.
  - Company labels: 10 distinct (dirty).
- **Statutory numbers (Active):** UAN set on 10, PAN on 0, ESI number on 0. 0 duplicate values of UAN, ESI or PAN across all employees, and 0 malformed.
- **Bank (Active):** 177 have no account in either pair, 180 have no IFSC.
- **Last 90 days, `audit_log` on employees:**
  - shift_assignment: 488
  - status (Mark Left): 61
  - Statutory upload rows: 149
  - No department, designation or bank audit rows exist, because those paths write none.
- **Last 90 days, usage_logs:** `PUT /:code/salary` 158, `PUT /:code` 134, mark-left 64, bulk-shift 5.
- **Payroll months:** 9 open (they have Stage 7 rows and are not finalised), covering 510 distinct employees.
- **Loans:** 5 Active employees have an open plant loan (requested, approved or active).

INFERENCE: the work HR actually does in volume is shift assignment (~5 a day) and Mark Left (~20 a month). The biggest data gap the bulk path can close is bank details, which ~177 Active employees lack.

## 2. Proposal: two kinds, one screen

### Kind 1: `master-edit`, direct (no approval, like extra duty)
- **Fields (allowlist):** `shift` (resolves to `default_shift_id` + `shift_code`), `department`, `designation`, `contractor_group`.
- **Roles:** create hr/admin. Undo hr/admin, with a reason.
- **Apply:** each row writes only its changed fields and appends `updated_at`.
  - A shift change goes through a new shared helper, `services/employeeMaster.js setShift(db, emp, shift, user, remark)`. It writes the **same** `shift_assignment` / `employee_master` / `shift_change` audit row as `PUT /bulk-shift`. `PUT /bulk-shift` is re-pointed to the same helper, so its remark text stays byte-identical.
  - department, designation and contractor_group each get one audit row per change: stage `MASTER_BULK_EDIT`, action `master_bulk_edit`. This audit is new and applies to the bulk path only.

### Kind 2: `master-edit-sensitive`, finance approval (like salary revision)
- **Fields (allowlist):**
  - `bank_name`, `account`, `ifsc`. Account and IFSC go through `readBankPairs`, write all four columns, and are audited by `auditBankChange(..., via: 'bulk batch #N')`. bank_name gets its own audit row.
  - `pan`, `uan`, `esi_number`.
  - `company`.
  - `exit` (date_of_leaving + reason).
- **Roles:** create hr/admin. Approve, reject or return: finance/admin, never the creator (`SELF_APPROVAL`, already in the engine). Undo finance/admin.
- **Common:** `section: 'details' | 'exit'`. The screen always sends exits as their own batches (ruling below), so that a bank batch never becomes impossible to undo because it also holds a Left row.
- **Exit apply:** the body of `PUT /:code/mark-left` (L870–930) is moved verbatim into `services/employeeExit.js markLeft(db, emp, {exitDate, reason, user}) → {loanSummary, exitAlerts}`. The function opens no transaction of its own (the caller's is used). The route becomes: lookup → `db.transaction(() => markLeft(...))()` → `notifyAlerts` → the same JSON. The kind calls `markLeft` inside the engine's approve transaction.
  - `exitAlerts` are sent with `notifyAlerts` inside the transaction, just before commit. A roll-back drops them too, which is acceptable because they are best effort. **Q8.**
  - Parity is proven by `markLeftRoleGuard.test.js`, the loans exit tests and `loans-exit-simulation.js`, all run unmodified.

### Why two kinds
The engine is one approval flag per kind (`requiresApproval`, P5-01). It has no per-row approval, and adding one would mean changing the engine. Two kinds keep the engine untouched. One upload is split by field:
- Direct cells → `master-edit` batches. They apply on Save.
- Sensitive cells → `master-edit-sensitive` batches. They are sent to finance.

A row that edits both kinds of field appears in both batches, each holding only its own fields.

### Excluded (the plan refuses the column, with a plain message)
| Column | Message |
|---|---|
| code | — |
| gross and every component | "use Salary → Salary revision" (P5-04) |
| PF / ESI / LWF flags | "use Statutory flags" (R10) |
| status other than Left | Reactivation stays single-entry. **Q7.** |
| employment_type, weekly_off_day, category | These move pay or leave. **Q2.** |
| name, father's name, DOB, phone, email, addresses and other personal fields | **Q3.** |
| punch_no, reporting_manager | No plant column. **Q1.** |

## 3. UI
**Entry:** Employee Master → a "Bulk edit" button (hr/admin) opens an **inline panel** `components/bulk/EmployeeMasterBulkEdit.jsx`. It is not a Modal, because `useConfirm` dialogs must not open inside a Modal. The panel has two modes.

### Mode C: export → edit → upload
1. Choose fields (checkboxes, grouped Direct / Needs finance) and the people. The default is the list's current filter; PeoplePicker can tick people.
2. "Download sheet" builds an xlsx client-side (XLSX, as P5-04 does):
   - Sheet `Employees`: Code, Name (read-only, for reference), then one column per chosen field with its current value.
   - Hidden sheet `_meta`: per code, a JSON of the exported values, the field list and the export time.
   - Shift is exported as the shift **code**. A data-validation list is not possible with community SheetJS, so a "Shifts" reference sheet is included instead.
3. "Upload edited sheet": only cells that differ from `_meta` count as edits. Unchanged cells are ignored, even if the master changed since the export.
   - For each edited cell, the server compares the master's current value with the `_meta` value. If they differ, the row is an error: "changed since you downloaded (now X)". This is the stale-export check the spec asks for.
   - A sheet without `_meta` (hand-made) is accepted. Every non-blank cell then counts as an edit, with a warning. **Q9.**

### Selection action
On the Employees list, the existing checkbox selection gains "Set field for N selected" (field + one value). It opens the same panel with those rows pre-filled.
- The old `BulkShiftModal` is replaced by this action, because the shift goes through the engine and becomes undoable. The `PUT /bulk-shift` route stays for API callers (5 calls in 90 days), re-pointed to the shared helper. **Q12.**

### Check table (both modes)
- One row per person.
- Changed cells are shown old → new. Sensitive cells carry a "finance" chip.
- States: ok / warning / error / skipped (no change).
- "Leave out N rows with problems".
- Save bar: "Save 37 changes now (1 batch) · Send 12 to finance (1 batch)". One confirm, then the direct groups go to `apply` and the sensitive groups to `submit`.
- Result screen lists the batches, with Undo per direct batch and "Check these again" for any refused batch.
- `useDraft` keeps the parsed upload.

### Finance side
Batches land in the existing `BulkApprovalQueue` (Finance Verification → Bulk batches, P5-01), through the kind's `reviewColumns`:
- Code, Name, field, old, new.
- Bank account and IFSC shown **in full** to finance (they need it to check the proof), with masking everywhere else. **Q6.**

### Other UI
- `BulkBatchList` on the panel shows recent batches of both kinds.
- No new page, so no new permissions key. The panel lives on Employees, which is already guarded.

## 4. Row checks (`planRow`)

### Common to both kinds
- **Not found:** error.
- **Code case:** codes are matched case-insensitively and the master spelling is returned (the P5-04 `findEmployee` pattern).
- **Status:** an employee who is not Active is an error for every field except an exit with the person already Left, which is `skipped` ("already Left").
- **No change:** a field equal to its current value is `skipped`.
- **Repeated code:** merged, first one kept, with a message.
- **Fingerprint:** `[emp.id, updated_at, the current value of each edited field]` per row. A change between check and save, or between send and approve, fails the plan hash, so nothing is applied.

### Direct kind
- **shift:** must be an existing `shifts.code`. Unknown → error.
- **department / designation:** trimmed, ≤ 100 characters, may be new.
  - A value that is not yet in use is a warning ("new department"), so that typos are seen.
  - Guard: if the employee's `employment_type` is blank and the new department changes `deptMatchesContractorKeyword`, the row is an error ("would change contractor status — set employment type first"). Production has 0 such rows today.
- **Blank cell:** clears the value only for designation and contractor_group. A department or shift can never be cleared in bulk.

### Sensitive kind
- **account:** digits only after trimming, 6–20 long.
- **IFSC:** `^[A-Z]{4}0[A-Z0-9]{6}$` after upper-casing.
- **Account and IFSC together:** an account without an IFSC (neither sent nor already stored) gives a warning.
- **Duplicate account:** an account already held by another employee is a warning, not an error, because family members sometimes share one. **Q5.**
- **PAN:** `^[A-Z]{5}[0-9]{4}[A-Z]$`. Already held by another employee → error.
- **UAN / ESI number:** use `statutoryFlags` `UAN_RE` / `ESI_NUMBER_RE` / `numberInUse`, the same checks as the statutory upload. Held by another employee, or repeated within the upload → error for all rows holding it (the statutory upload's rule).
- **company:** must be canonical. The open-month rule is **Q4**. My recommendation:
  - Error if the employee has a Stage 7 row in any open month **other than the latest open month**, or in any month whose bank file (`neft_exported`, plant) has gone out. Message: "salary already computed for <Mon YYYY> under <old company> — finalise those months first".
  - Otherwise ok, with the note "re-run Stage 6 and 7 for <latest open month> (All companies)".
- **exit:**
  - `date_of_leaving` is required, a real date, not after IST today, and not before DOJ.
  - Error if the exit month is finalised.
  - The reason is required (≥ 5 characters; the single dialog allows blank). **Q8.**
  - Warning "N open loan(s) will be flagged for recovery from the final salary".
  - Warning "salary already computed for <Mon> — re-run Stage 6/7".

## 5. Undo (`undoable` / `undoRow`, per the engine: whole batch or nothing)
- **Direct kind:** a row is undoable while every edited field still equals what the batch wrote. Undo restores the old value.
  - A shift undo goes through `setShift`, which writes a new `shift_assignment` audit row.
  - Every other field writes an audit row with stage `BULK_UNDO`.
- **Sensitive kind, details:** same rule as the direct kind. For company there is one more condition: no new Stage 7 row has been written for that employee since approval, using the same fingerprint as P5-04 `stage7Rows`. Bank undo calls `auditBankChange` again.
- **Sensitive kind, exit:** **never undoable.** Mark Left has already consolidated the loan schedules, and reactivation follows other rules. The batch list says "reactivate by hand". **Q7.**

## 6. Files (owned list)
### New
- `backend/src/services/bulk/kinds/masterEdit.js`: both kinds and their shared field table.
- `backend/src/services/employeeExit.js`: `markLeft`, moved from employees.js.
- `backend/src/services/employeeMaster.js`: `setShift`, field allowlists, validators.
- `frontend/src/components/bulk/EmployeeMasterBulkEdit.jsx`
- `frontend/src/utils/masterEditSheet.js`: export, `_meta`, and the parse / diff of the upload.
- `backend/src/__tests__/bulkMasterEdit.test.js`
- `backend/scripts/bulk-master-edit-check.py`

### Edited
| File | Change |
|---|---|
| `services/bulk/engine.js` | 2 lines in `KINDS` only |
| `routes/bulk.js` | 1 read: `GET /bulk/master-edit/meta` (shifts, departments, designations, canonical companies); hr/admin |
| `routes/employees.js` | Mark Left body → `markLeft` call; bulk-shift loop → `setShift` call. **No other line changes** (PUT /:code untouched). |
| `frontend/src/pages/Employees.jsx` | Bulk edit button + panel mount; selection action replaces BulkShiftModal |
| `frontend/src/utils/bulkApi.js` | Meta helper |

### Not touched
- schema.js / bulkSchema.js: no new column.
- salaryComputation.js, dayCalculation.js, payroll.js, recompute.js.
- The loans engine (only called).
- statutoryFlags.js (only its validators are imported).
- salary-input.js and the P5-04 kind.
- PUT /:code and PUT /:code/salary.

## 7. Tests (`bulkMasterEdit.test.js`, real JWTs through `routes/bulk.js`)
### Allowlist
- Flags, gross, components, code, employment_type and unknown columns are refused per row with the right message.
- The writer guard and the statutory tests still pass.

### Direct kind
- shift / department / designation applied.
- The shift audit row is equal to the one `PUT /bulk-shift` writes (parity against the verbatim origin/main handler).
- No-change cells are skipped. An unknown shift is an error.
- A contractor-keyword department on a blank employment_type is an error.
- 51 rows → split into 50 + 1; more than 50 in one apply → refused.
- Hash change between check and save → 409.
- Undo restores the old values; it is refused after a later edit.

### Sensitive kind
- Submit writes nothing to `employees`.
- Approve by the creator → 403 `SELF_APPROVAL`; another finance or admin user applies it.
  - Bank: all four columns written, masked audit rows.
  - PAN, UAN and ESI number written; duplicates refused, and a duplicate within the upload refuses every row that holds it.
- Company:
  - non-canonical → error;
  - open-month rule (Q4 as ruled) → error;
  - a valid change, re-run in one open month → row re-tagged; drift query 0.
- Data changed between submit and approve → 409, nothing written.
- Return and reject leave the master untouched.

### Exit
- Approve → status Left, dates set, loans `recover_at_exit` + `loan_events` + consolidation identical to the single route (twin-DB parity).
- Future date, date before DOJ, finalised month, already Left → refused.
- Exit batch undo → refused.

### Roles and parity
- Roles: viewer/supervisor/finance cannot create (403); hr cannot approve (403); no token → 401.
- Parity suites, run unmodified: `markLeftRoleGuard`, `salesExitRoleGuard`, loans exit tests, `bulkExtraDuty`, `bulkApproval`, `bulkSalaryRevision`, `employeeEditGrossGuard`, `employeeBankColumns`, `statutoryWriterGuard`. Then the full suite.

## 8. Check script (`bulk-master-edit-check.py`, port 3506, built dist, scratch DB, fictional T5xxx)
### Happy path
1. As hr: export shift + department + bank for a filter.
2. Edit the cells in Python (openpyxl or a built xlsx) and upload.
3. Check table: changed cells only, finance chips.
4. "Save N now · Send M to finance". The direct rows are in the DB with audit rows; the sensitive rows are not.
5. Undo the direct batch.
6. Selection action "Set shift for 3".
7. Restart the server and log in as finance: the queue shows full bank values; approve → DB.
8. The self-approval case: an admin who created the batch is refused.

### Edge cases
- A stale export: master changed after the download → row error.
- A duplicate UAN.
- An exit batch with a loan borrower → approve → loan flagged; Undo refused.
- A hand-made sheet without `_meta`.
- 390 px width.
- 0 page errors and 0 unexpected API responses ≥ 400.

### `--base` on b2badcab
No Bulk edit button, and `/api/bulk/master-edit/preview` → 404.

## 9. Risks
1. **The company re-tag moves money between company bank files for already-paid open months.** Hence the Q4 rule; it is reviewed independently.
2. **Mark Left extraction:** the transaction boundary moves into the caller. `logAudit` must stay on the same handle, which is true because `getDb()` is the same connection (P3-01 note).
3. **The two-kind split** means one upload can produce, say, "1 saved, 1 waiting for finance". The result screen must say so plainly.
4. **Gap A:** until the single path is gated too, someone can bypass finance by editing one employee at a time. This is not fixed here (Q10).
5. **Hidden `_meta` sheet:** Excel may drop it if the user copies the cells into a new workbook. The upload then falls back to "every cell is an edit + warning" (Q9).

## 10. Questions
- **Q1:** Plant has no `punch_no` or `reporting_manager` column, and the plant punch number is the employee code, which is excluded. Drop both from P5-02? (Recommend yes. Adding columns nobody reads is not worth it, and a code change is a separate, risky job.)
- **Q2:** `employment_type` (re-derives `is_contractor`, which changes the pay path), `weekly_off_day` (Stage 6) and `category`. Exclude them from bulk? (Recommend exclude for now. Each one moves pay or leave and needs its own ruling.)
- **Q3:** Personal fields (name, father's name, DOB, gender, phone, email, addresses, blood group, emergency contact). Add them as direct fields, or leave them out of v1? (Recommend leaving them out of v1. They are not in the spec, and their main use is the new-joiner flow, P5-03.)
- **Q4:** Company change rule. Options:
  - (a) Refuse when the employee has a Stage 7 row in any open month except the latest open month, or one whose NEFT file has gone out; otherwise apply, with a note to re-run the latest month. **Recommended.**
  - (b) Refuse whenever any open-month Stage 7 row exists. This is the safest option, but production has 9 open months, so in practice it blocks almost everyone until old months are finalised.
  - (c) Allow always, with a warning only.
- **Q5:** A bank account already held by another employee: warning or error? (Recommend a warning.) A PAN, UAN or ESI number already held by another employee is an error.
- **Q6:** Should finance see the full bank account and IFSC in the approval queue? (Recommend yes, because they check them against the proof. Audit rows stay masked.)
- **Q7:** Exits in bulk are never undoable, and reactivation (Left → Active) stays single-entry. OK?
- **Q8:** For bulk exits:
  - Require a reason of ≥ 5 characters? The single dialog allows a blank one.
  - Refuse an exit dated in a finalised month? The single route allows it.

  Recommend yes to both, for bulk only.
- **Q9:** Is a hand-made sheet without the hidden `_meta` sheet accepted, with every non-blank cell treated as an edit plus a warning? Or refused ("download the sheet from the app")? (Recommend accepted with the warning, because HR often re-types sheets.)
- **Q10:** Gap A. The single `PUT /employees/:code` still writes bank, PAN, UAN, ESI and company directly, with no finance step. Leave it as is in this PR and register a follow-up? (Recommend: register it, don't fix it here. Changing the single path changes HR's daily screen and needs its own UI.)
- **Q11:** Is `contractor_group` worth keeping as a direct field? 0 Active employees use it.
- **Q12:** May the "Set field for N selected" action replace the existing Bulk Shift modal, so the shift goes through the engine and becomes undoable? `PUT /bulk-shift` stays, re-pointed to the shared helper with the same audit text.
- **Q13:** Batch size. At 50 per batch, a whole-plant shift change (389 people) is 8 direct batches and saves in one click. Sensitive batches would be up to 8 separate finance approvals. Is that acceptable, or should the sensitive kind keep 50 and the screen just say "8 batches"? (Recommend keeping 50: R5.)
