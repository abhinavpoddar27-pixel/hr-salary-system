# P5-02: progress log
Branch `feat/bulk-master-edit` (off main b2badcab). Worktree `/home/claude/wt-p502`. Port 3506. This PR is MONEY-ADJACENT.

## State
**Phase 0 is done.** `PLAN.md` is written and pushed. I'm waiting for the planner to reply "go" and rule on Q1–Q13 (PLAN §10). No code has been written yet.

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

## Next
After "go":
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
- **Pending:** planner rulings on PLAN Q1–Q13.

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
