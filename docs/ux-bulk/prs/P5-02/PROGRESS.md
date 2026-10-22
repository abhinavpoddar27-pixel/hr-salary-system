# P5-02: progress log
Branch `feat/bulk-master-edit` (off main b2badcab). Worktree `/home/claude/wt-p502`. Port 3506. This PR is MONEY-ADJACENT.

## State
BUILT, verified, handed to the planner for independent review (MONEY-ADJACENT). No PR opened (ruling).

## Done
- Read the following:
  - `employees.js` (PUT /:code, bulk-shift, mark-left, the bank pair)
  - the bulk engine
  - `routes/bulk.js`
  - the `salaryRevision` and `extraDuty` kinds
  - `bankPair.js`
  - the `statutoryFlags` exports
  - `employeeClassification`
  - `normalizeCompany`
- Ran the production read-only counts. The results are in PLAN §1.
- Found two gaps (PLAN §1):
  - **Gap A:** the single edit writes bank, PAN, UAN, ESI number and company with no finance step.
  - **Gap B:** the plant has no `punch_no` or `reporting_manager` column.

## Done (Phase 1)
- services/employeeExit.js markLeft + services/employeeMaster.js setShift; routes re-pointed (4946f1e0).
- kinds/masterEdit.js (direct + sensitive), engine KINDS +2, routes/bulk.js meta + export, bulkMasterEdit.test.js 20.

- Frontend: `components/bulk/EmployeeMasterBulkEdit.jsx` (set one value / sheet), `utils/masterEditSheet.js`, Employees page
  "Bulk edit" + "Set field for N" (replaces the Assign Shift window), BulkBatchList for both kinds (ed2f6795).
- `backend/scripts/bulk-master-edit-check.py` 37/37, `--base` on b2badcab 3/3; full jest 131 suites / 2329 tests.

- **Independent review (22 Oct): SHIP WITH FIXES — applied:** (1) approving a company change sets
  `day_calculations.salary_stale = 1` on that person's open-month rows in the same txn; (2) bank-file check also matches
  `/api/reports/bank-transfer` reads, filtered in SQL by month/year; (3) account / PAN / UAN / ESI masked (last 4) in every
  message; hr sees masked values in preview display and batch detail, finance/admin full; export only the ticked columns;
  (4) sheet date serials via `XLSX.SSF.parse_date_code`, workbook read without cellDates; (5) a numeric bank-account cell
  with > 15 digits refused ("type the account as text"); (7) leaving date before a finalised month in which the person was
  paid refused. 6 and 8: no change (8 registered).
- **Register (for the planner):** R-a plant bank file needs a real export stamp (today: usage_logs heuristic);
  R-b single PUT /:code writes bank/PAN/UAN/ESI/company with no finance step (Q10); R-c designation changes in bulk can
  change the contract-loader early-exit exemption in Attendance Review (review item 8).

## Next (old plan list — all done)
1. Extract `markLeft` into `services/employeeExit.js` and `setShift` into `services/employeeMaster.js`. Run the parity suites.
2. Build the `masterEdit.js` kinds and add the 2-line `KINDS` entry.
3. Add the meta route.
4. Write the tests.
5. Build the UI panel, the sheet util and the Employees selection action.
6. Write the check script and add `--base`.
7. Run the full verification.

## Rulings
- **Owner Q3:** only sensitive fields go to finance; the rest apply directly with audit rows.
- **Owner Q11:** company can be changed in bulk, with finance approval.
- **Planner rulings, 22 Oct (go):** Q1 drop punch_no/reporting_manager · Q2 exclude employment_type/weekly_off_day/category ·
  Q3 personal fields out · Q4 (owner) option (a): refuse company change with Stage 7 rows in any open month other than the
  latest, or in a month whose bank (NEFT) file has gone out; the text says why · Q5 duplicate account = warning shown to
  finance, duplicate PAN/UAN/ESI = error · Q6 finance sees full account + IFSC, audit masked · Q7 exits never undoable,
  reactivation single-entry · Q8 exit reason ≥ 5 chars + no exit in a finalised month · Q9 accept a sheet without _meta with a
  warning · Q10 (owner) register the single-edit gap, do NOT change PUT /:code · Q11 keep contractor_group · Q12 replace the
  Bulk Shift window, route stays re-pointed to setShift with identical audit text · Q13 keep the 50 cap. No PR.
- **Builder decision:** "bank file has gone out" for plant = a usage_logs row for GET /api/reports/bank-salary-file with
  download=true for that month/year (any company). The plant route keeps no export stamp; production has 0 such downloads
  (Jan/Mar/Jun/Sep 2026 previews only) — flag to planner.

## RESUME
Build finished. Next is the planner's independent review; apply its fixes on this branch, re-run the check script
(`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers PORT=3506 python3 backend/scripts/bulk-master-edit-check.py`) and the full jest.

Do not touch any of these files:
- `PUT /:code`
- `salaryComputation`, `dayCalculation`, `payroll`, `recompute`
- `schema.js`
- the loans engine

Stage files by name, never with `git add -A`.

## CLAUDE.md entry
## Last Session — 2026-10-22 (P5-02: employee master bulk edit — set one value or edit a sheet; finance approves sensitive fields)
**Branch `feat/bulk-master-edit`, NOT merged. MONEY-ADJACENT — independent review before PR.** Plan + log: `docs/ux-bulk/prs/P5-02/`.
Owner rulings Q3, Q4 (a), Q10, Q11; planner Q1–Q13 (22 Oct).
- **Two bulk kinds** (`services/bulk/kinds/masterEdit.js`, engine KINDS +2): `master-edit` applies at once — shift (via
  `setShift`, same audit text as bulk-shift), department, designation, contractor_group; audit stage MASTER_BULK_EDIT; undo
  while values equal what the batch wrote. `master-edit-sensitive` waits for finance/admin (never the sender — SELF_APPROVAL):
  bank name / account / IFSC (all four columns via bankPair, masked audit), PAN, UAN, ESI number (masked audit), company, and
  leaving (exit) batches (`markLeft`, never undoable). Refused with a reason: gross/components (→ bulk salary revision),
  PF/ESI/LWF flags (→ Statutory Flags), employment_type, weekly_off_day, category, code, status, punch_no, reporting_manager,
  personal fields.
- **Review fixes:** company approval marks open-month `day_calculations.salary_stale = 1` (finalise then refuses until
  Stage 6/7 re-run; the warning text stays); account / PAN / UAN / ESI shown as last 4 in every message and, for hr, in
  preview display + batch detail (finance/admin see full; `bulk_rows` keep full values to apply); export = ticked columns only;
  sheet dates via `XLSX.SSF.parse_date_code`; a > 15-digit numeric account cell refused; leaving date before a finalised
  paid month refused.
- **Checks:** stale cell vs the downloaded sheet (`_meta`) → error; sheet without `_meta` → warning (Q9); department change that
  flips the contractor keyword when employment_type is blank → error; PAN/UAN/ESI held by another employee or repeated in the
  list → error; shared bank account → warning (Q5); exit: real date, not future (IST), not before DOJ, reason ≥ 5, month not
  finalised (Q8), loans named. Company (Q4a): Stage 7 row in an open month other than the latest → error; in the latest open
  month after its bank file was downloaded → error; else warning "re-run Stage 6 and 7 (All companies) after approval".
- **Extracted, not copied:** `services/employeeExit.js markLeft` and `services/employeeMaster.js setShift`; Mark Left and
  PUT /bulk-shift call them; parity tests vs the verbatim b2badcab handlers. PUT /:code untouched (Q10).
- **Routes:** `GET /api/bulk/master-edit/meta`, `POST /api/bulk/master-edit/export` (hr/admin). **UI:** Employee Master
  "Bulk edit" + "Set field for N" (ticked rows) → inline panel (one value, or download sheet → edit → upload); three sections
  (saved now / to finance / leaving); "Save N now · Send M to finance"; result with Undo. Finance approves in Finance Verification
  → Bulk batches (full account + IFSC shown, Q6). The old Assign Shift window is gone.
- **Fragile:** (1) "bank file has gone out" for plant = a usage_logs row for `/api/reports/bank-salary-file?…download=true`
  or any `/api/reports/bank-transfer` read for that month/year (no export stamp exists; production has 0 such downloads) —
  SQL filter in `bankFileDownloaded`. Masking for hr lives in `routes/bulk.js redactFor` + the kind's `redactRow` —
  a new sensitive field must be added to `MASKED_FIELDS`. The workbook must be read WITHOUT `cellDates`. (2) LEGACY_SHIFT_CODES is a second copy in the panel — keep in
  step with the shift list filter. (3) Exits are never undoable. (4) Sheet cells are compared as text to `_meta`; a cell Excel
  reformats counts as a change and is then checked. (5) Q10 register: single PUT /:code still writes bank/PAN/UAN/ESI/company
  with no finance step.
- **Verified:** new `bulkMasterEdit.test.js` 27 (parity, direct, sensitive, exit, 7 review-fix tests); full jest 131 suites /
  2336. `node backend/scripts/master-edit-sheet-check.mjs` 13/13 in UTC, Asia/Kolkata, America/Los_Angeles, Pacific/Kiritimati
  (leaving-date serial round trip incl. 29 Feb, long-number account flag).
  `backend/scripts/bulk-master-edit-check.py` (Chromium, built dist, scratch DB, hr/finance/admin, fictional T80xx, port 3506)
  38/38 (incl. hr sees the account as last 4) — set field for 3 (double click → 1 batch, shift audit = bulk-shift text), sheet download/edit/upload, stale + bad
  account refused, leave out, undo, leaving with a loan, no-_meta warning, 390 px, finance sees full account and approves both,
  four bank columns + masked audit, Left + loan recover_at_exit, admin self-approval 403, drift 0, 0 page/console errors,
  0 API ≥ 400. `--base` on b2badcab 3/3 (no Bulk edit, old Assign Shift window, kind 404).
- **Not tested:** Railway; production data; Safari/Firefox; a real Excel round trip (openpyxl in the script); sheets > 50
  rows across several batches in the browser (jest covers the 50 + 1 split).
