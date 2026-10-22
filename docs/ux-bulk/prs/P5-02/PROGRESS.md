# P5-02: progress log
Branch `feat/bulk-master-edit` (off main b2badcab). Worktree `/home/claude/wt-p502`. Port 3506. This PR is MONEY-ADJACENT.

## State
Phase 1 build in progress. Backend done and pushed (4bfd308a): extraction, both kinds, meta/export reads, 20 tests green
(+ 14 related suites, 223 tests). Next: frontend panel + selection action, then check script.

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

## Next (old plan list)
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
Read `PLAN.md`, then this file. If there are no rulings below, stop and wait. Otherwise start at "Next" step 1.

Do not touch any of these files:
- `PUT /:code`
- `salaryComputation`, `dayCalculation`, `payroll`, `recompute`
- `schema.js`
- the loans engine

Stage files by name, never with `git add -A`.

## CLAUDE.md entry
(I fill this in at hand-off.)
