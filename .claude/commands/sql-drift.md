---
name: sql-drift
description: Run the salary drift sanity check for a given month/year via the SQL Console. Surfaces rows where ABS(net - (gross_earned - total_deductions)) > 1.
---

# /sql-drift — Salary drift detector

Salary drift is the single highest-priority sanity check on `salary_computations`: every row must satisfy `net_salary == gross_earned - total_deductions` to within ₹1 of rounding tolerance. Drift > ₹1 means a recompute path skipped a deduction or double-applied a bucket — STOP and investigate before paying.

## Required environment

- `SQL_CONSOLE_URL`
- `SQL_CONSOLE_API_KEY`

## Arguments

- `$1` — month (1-12)
- `$2` — year (e.g. 2026)

## Steps

1. Validate `$1` is an integer in [1, 12] and `$2` is an integer in [2024, 2030]. If either is malformed, refuse and ask the user to re-issue with valid args. **Never silently coerce or default.**

2. Build the SQL by inlining the validated integers:

   ```
   SELECT employee_code, month, year, net_salary, gross_earned, total_deductions,
          ABS(net_salary - (gross_earned - total_deductions)) AS drift
   FROM salary_computations
   WHERE month = <month_int> AND year = <year_int>
   ORDER BY drift DESC
   LIMIT 20;
   ```

3. Run via the same mechanism as `/sql-query` — POST to `/api/admin/sql/execute` with the API key header.

4. Parse the response:
   - Print total rowCount and ms
   - Render the result as a markdown table
   - **Highlight rows where `drift > 1` in red** (use ANSI `[31m...[0m` if writing to terminal, otherwise prefix with `🚨`)
   - If 0 rows match (compute hasn't run for that month), say so explicitly — don't pretend everything is fine
   - If all 20 rows have `drift <= 1.0`, print `✅ No drift detected — top 20 rows all within ₹1 tolerance.`

5. **Note:** the `/execute` endpoint does not accept JSON parameter binding in Phase 1. Inlining the integers is intentional. The validation in step 1 is the only safety net.

## Example

User: `/sql-drift 4 2026`

Expected output (clean case):
```
0 rows with drift > 1 (top 20 rows all within ₹1 tolerance) — 23ms
✅ No drift detected.
```

Drift detected:
```
3 rows with drift > 1 — STOP before finalising
| employee_code | month | year | net_salary | gross_earned | total_deductions | drift  |
| 19222         | 4     | 2026 | 84500.00   | 84500.00     | 0.02             | 84500  | 🚨
| ...
```
