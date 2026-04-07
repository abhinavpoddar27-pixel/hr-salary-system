---
name: ship-feature
description: Full quality pipeline for HR Salary System changes
---

# /ship — HR Salary System Feature Pipeline

Triggered by: `/ship [feature description]`

## PHASE A: Context Load (mandatory, cannot skip)

1. Read `CLAUDE.md` — load architecture map, pipeline dependency graph, database schema, salary calculation docs
2. Identify which pipeline stages, database tables, salary components, or reporting modules this feature touches
3. Read CLAUDE.md Section 3 entries for every affected pipeline stage
4. Read CLAUDE.md Section 5 if the feature touches salary calculation, day calculation, or any earned/deduction amounts
5. If the feature touches multiple pipeline stages or the salary engine: flag as **HIGH COUPLING** — trace the full chain from the earliest affected stage through salary computation to payslip/finance output

## PHASE B: Plan (use subagent)

Use a subagent to read every file that will be affected and report their current state. The subagent reads only — it does NOT modify files.

Additional checks during planning:
- If the feature adds/modifies a database table: check `schema.js` for UNIQUE constraints that might conflict
- If the feature changes an API endpoint's response shape: list every frontend component that calls that endpoint
- If the feature changes a pipeline stage's output table: list every downstream stage and consumer that queries it

**Gate:** Present the plan listing every file to be created or modified, with a one-line change description each. Wait for user approval before proceeding.

## PHASE C: Build

Implement the approved plan.

After implementation:
- Run lint (`npm run lint`, or the project's equivalent)
- **Gate:** lint must pass with 0 errors. Fix before proceeding.

## PHASE D: Test (use subagent)

Use a subagent to run:

1. Start the backend server and test affected API endpoints with curl (verify response shapes, status codes, error handling)
2. If the change affects salary computation: run a test computation for at least one employee and verify:
   - (a) earned ratio ≤ 1.0 for base components
   - (b) `net_salary = gross_earned - total_deductions`
   - (c) PF/ESI calculated correctly against ceiling values
3. If the change affects the pipeline: run stages in sequence and verify each stage's output table has expected row counts
4. If no test files exist, explicitly report: "⚠ No automated tests found for [module]. Coverage gap — tested manually via curl."

**Gate:** all tests must pass. Gaps are flagged but do not block.

## PHASE E: Pipeline Cascade Audit (NO subagent — do this in main context)

Re-read CLAUDE.md Section 3 (Pipeline Dependency Map) and Section 5 (Salary Calculation).

For each changed pipeline stage or module, check ALL of these:

1. **TABLE SCHEMA**: Did the output table's columns change (added, renamed, type changed)? → Read every downstream stage's service file and every SQL query that selects from this table. Verify column references still match.
2. **ROW CARDINALITY**: Did the stage start producing more or fewer rows? (e.g., one row per employee vs. one row per employee per week) → Read every downstream JOIN and aggregation that assumes a specific cardinality.
3. **COMPUTED VALUES**: Did any computed field's range or meaning change? → Check salary computation's input expectations and every finance report column.
4. **UNIQUE CONSTRAINTS**: Does the change risk violating any `UNIQUE(employee_code, month, year, company)` constraint during re-processing? → Check upsert/INSERT logic.
5. **SALARY COMPONENTS**: Did any salary component calculation change? → Verify: (a) earned ratio cap, (b) PF/ESI wage base, (c) gross = sum of all earned components, (d) net = gross - deductions.
6. **PAYSLIP FORMAT**: Does the change affect what appears on payslips? → Read `generatePayslipData()` in `salaryComputation.js` and verify field names still match.
7. **FINANCE AUDIT**: Does the change affect what the finance audit report displays? → Read `financeAudit.js` report endpoint and verify column references.
8. **CSV/EXCEL EXPORTS**: Does the change affect any export function's column mapping? → Check all export endpoints.
9. **FRONTEND DISPLAY**: Does any changed field get displayed in a React component? → Verify the component reads the correct field name and handles the new value range (null safety, formatting, conditional rendering).

If ANY check reveals a mismatch: list the specific downstream files that MUST be updated, and update them now. Do NOT mark the task complete until every downstream dependency is verified or fixed.

## PHASE F: Report

Output this structured report:

```
/ship Report — HR Salary System
═══════════════════════════════════════
Feature: [description]
Pipeline stages affected: [list]
Database tables modified: [list]
Files modified: [list with one-line change description each]
Files created: [list]
Downstream cascade verified:
  Salary computation: PASS/FAIL/NOT AFFECTED
  Day calculation: PASS/FAIL/NOT AFFECTED
  Finance audit report: PASS/FAIL/NOT AFFECTED
  Payslip generation: PASS/FAIL/NOT AFFECTED
  CSV/Excel exports: PASS/FAIL/NOT AFFECTED
  Frontend components: PASS/FAIL (list each checked)
Lint: PASS/FAIL
Tests: PASS/FAIL/NO TESTS (note coverage gaps)
Cascade audit: PASS / [list of unresolved mismatches]
═══════════════════════════════════════
Overall: GO ✅ / NO-GO ❌
```
