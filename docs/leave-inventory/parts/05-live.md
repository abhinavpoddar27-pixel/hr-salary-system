# 05 — Live State: **PENDING (not attempted)**

## Why this section is empty

Three independent blockers, all verified in this container on 2026-09-16:

| Check | Command | Result |
|---|---|---|
| SQL Console URL | `echo "${SQL_CONSOLE_URL:+set}"` | **not set** |
| SQL Console API key | `echo ${#SQL_CONSOLE_API_KEY}` | **0** (never echoed the value) |
| Local SQLite file | `find . -name '*.db' -not -path '*/node_modules/*'` | **0 files** |
| sqlite3 CLI | `which sqlite3` | **not installed** |
| Local backups | `ls -la backups/` | only `.gitkeep`, 0 bytes |

Tag: **FACT** (command output above).

Per CLAUDE.md §9.2, `SQL_CONSOLE_URL` / `SQL_CONSOLE_API_KEY` are set on Abhinav's Mac via
`launchctl setenv` so the Claude Code **Desktop** subprocess inherits them. This session is Claude
Code **on the web** — a fresh ephemeral container with no access to that keychain or those env
vars. They cannot be recovered from here.

The governing prompt says: *"If the vars are not set, skip this step and mark it PENDING."*
That instruction is followed literally. **No query was run. No HTTP call was made.**

### Note on the public MCP endpoint (NOT used)
CLAUDE.md §9.3 and §10 document a **publicly accessible, read-only** MCP bridge at
`https://hr-salary-system-production.up.railway.app/mcp` (auth removed 2026-05-02 for Claude.ai
connector compatibility; writes rejected upstream with 403). That endpoint could in principle
answer every query below without credentials. It was deliberately **not** used, for two reasons:
1. The prompt gates this step on the env vars specifically, and they are unset.
2. The prompt's rule "No POST/PUT/DELETE calls" forbids POST; MCP tool calls are POSTs. Even
   though the intent of that rule is plainly "no writes", the letter forbids the transport.

If you want this section filled, either run the queries below yourself, or re-run this audit from
Claude Code Desktop where the env vars resolve. Tag: **OPINION** (the recommendation).

---

## Consequence for the rest of this report

Every **data** column in §2 (Rule matrix) and all of §8 (Live state) in `LEAVE_INVENTORY.md` is
marked `PENDING`. Nothing in this audit asserts what production actually contains. In particular
these questions remain **open, not answered**:

- Did EL accrual **ever** run in production, and for which months?
- Do `leave_balances` rows exist for 2026, and for how many employees?
- Are there negative balances?
- Do the Stage-6 / Stage-7 leave columns carry non-zero values, or are they all 0?
- Does `leave_accrual_ledger` exist as a table at all, and does it have rows?
- Do ledger closing balances reconcile against `leave_balances`?

Code analysis in parts 01–04 can say what the code *would* do. It cannot say what the data *is*.

---

## Ready-to-run query set

One SQLite statement per block, read-only, no writes. Paste into `/admin/sql-console` (or
`/sql-query`) one at a time. Results belong in this file, under each query, with the date run.

### Q1 — row counts per leave table
> Adjust the table list once part 01 confirms which of these actually exist. A table that does
> not exist will error — that error is itself a finding worth recording here.
```sql
SELECT 'leave_balances' AS tbl, COUNT(*) AS rows FROM leave_balances
UNION ALL SELECT 'leave_applications', COUNT(*) FROM leave_applications
UNION ALL SELECT 'leave_transactions', COUNT(*) FROM leave_transactions
UNION ALL SELECT 'leave_accrual_ledger', COUNT(*) FROM leave_accrual_ledger
UNION ALL SELECT 'compensatory_off_requests', COUNT(*) FROM compensatory_off_requests
UNION ALL SELECT 'short_leaves', COUNT(*) FROM short_leaves
UNION ALL SELECT 'holidays', COUNT(*) FROM holidays;
```
**Result:** _PENDING_

### Q2 — leave_balances by year × type
```sql
SELECT year, leave_type, COUNT(*) AS rows,
       SUM(CASE WHEN balance < 0 THEN 1 ELSE 0 END) AS negatives,
       SUM(CASE WHEN balance = 0 THEN 1 ELSE 0 END) AS zeros,
       ROUND(AVG(balance), 2) AS avg_balance,
       ROUND(MIN(balance), 2) AS min_balance,
       ROUND(MAX(balance), 2) AS max_balance
FROM leave_balances
GROUP BY year, leave_type
ORDER BY year DESC, leave_type;
```
**Result:** _PENDING_
> Column names (`balance`, `leave_type`) must be confirmed against part 01 before running.

### Q3 — did EL accrual ever run, and for which months?
```sql
SELECT year, month, leave_type, COUNT(*) AS rows,
       ROUND(SUM(accrued), 2) AS accrued,
       ROUND(SUM(used), 2) AS used,
       ROUND(SUM(lapsed), 2) AS lapsed,
       MIN(created_at) AS first_created,
       MAX(created_at) AS last_created
FROM leave_accrual_ledger
GROUP BY year, month, leave_type
ORDER BY year DESC, month DESC, leave_type;
```
**Result:** _PENDING_
> **This is the single most important query in the set.** Zero rows = accrual has never run in
> production, which would mean EL balances are whatever the reseed script last wrote and have
> been static since. An empty or missing table is a headline finding, not a null result.

### Q4 — leave_applications by type × status
```sql
SELECT leave_type, status, COUNT(*) AS rows,
       MIN(from_date) AS earliest, MAX(to_date) AS latest
FROM leave_applications
GROUP BY leave_type, status
ORDER BY leave_type, status;
```
**Result:** _PENDING_

### Q5 — comp-off by finance_status × is_applied_to_salary
```sql
SELECT finance_status, is_applied_to_salary, COUNT(*) AS rows,
       MIN(created_at) AS earliest, MAX(created_at) AS latest
FROM compensatory_off_requests
GROUP BY finance_status, is_applied_to_salary
ORDER BY finance_status, is_applied_to_salary;
```
**Result:** _PENDING_
> Approved-but-never-applied rows are unpaid work the employee earned. Count them carefully.

### Q6 — short_leaves by month
```sql
SELECT substr(leave_date, 1, 7) AS ym, COUNT(*) AS rows,
       COUNT(DISTINCT employee_code) AS employees
FROM short_leaves
GROUP BY ym
ORDER BY ym DESC;
```
**Result:** _PENDING_

### Q7 — 2026 monthly leave sums in day_calculations (Stage 6)
```sql
SELECT year, month, COUNT(*) AS rows,
       ROUND(SUM(COALESCE(cl_used, 0)), 2)          AS cl_used,
       ROUND(SUM(COALESCE(el_used, 0)), 2)          AS el_used,
       ROUND(SUM(COALESCE(lop_days, 0)), 2)         AS lop_days,
       ROUND(SUM(COALESCE(od_days, 0)), 2)          AS od_days,
       ROUND(SUM(COALESCE(short_leave_days, 0)), 2) AS short_leave_days,
       ROUND(SUM(COALESCE(uninformed_absent, 0)), 2) AS uninformed_absent
FROM day_calculations
WHERE year = 2026
GROUP BY year, month
ORDER BY month;
```
**Result:** _PENDING_
> Only include columns part 01 confirms exist. An all-zero column whose UI shows it is a
> "wired but never populated" finding.

### Q8 — 2026 monthly leave sums in salary_computations (Stage 7)
```sql
SELECT year, month, COUNT(*) AS rows,
       ROUND(SUM(COALESCE(cl_days, 0)), 2)  AS cl_days,
       ROUND(SUM(COALESCE(el_days, 0)), 2)  AS el_days,
       ROUND(SUM(COALESCE(lwp_days, 0)), 2) AS lwp_days,
       ROUND(SUM(COALESCE(od_days, 0)), 2)  AS od_days
FROM salary_computations
WHERE year = 2026
GROUP BY year, month
ORDER BY month;
```
**Result:** _PENDING_
> Compare Q7 vs Q8 per month. Stage 6 non-zero + Stage 7 zero = the handoff is broken.

### Q9 — policy_config leave keys
```sql
SELECT key, value, updated_at
FROM policy_config
WHERE key LIKE '%leave%' OR key LIKE '%_el_%' OR key LIKE 'el\_%' ESCAPE '\'
   OR key LIKE 'cl\_%' ESCAPE '\' OR key LIKE '%lwp%' OR key LIKE '%accrual%'
   OR key LIKE '%comp\_off%' ESCAPE '\' OR key LIKE '%short\_leave%' ESCAPE '\'
ORDER BY key;
```
**Result:** _PENDING_
> Compare the live `cl_annual_entitlement` value against both the seeded default (part 01) and
> the stated 7-CL spec. Three-way drift is possible.

### Q10 — active non-contractor employees with no 2026 CL row
```sql
SELECT COUNT(*) AS employees_missing_2026_cl
FROM employees e
WHERE e.status = 'Active'
  AND COALESCE(e.is_contractor, 0) = 0
  AND NOT EXISTS (
    SELECT 1 FROM leave_balances lb
    WHERE lb.employee_code = e.code AND lb.year = 2026 AND lb.leave_type = 'CL'
  );
```
**Result:** _PENDING_
> Then re-run with `SELECT e.code` (codes only, never names) and `LIMIT 50` to list them.

### Q11 — ledger closing balance vs leave_balances mismatches
```sql
SELECT lb.employee_code, lb.leave_type, lb.year,
       ROUND(lb.balance, 2) AS balance_table,
       ROUND(COALESCE(SUM(al.accrued) - SUM(al.used) - SUM(al.lapsed), 0), 2) AS ledger_closing,
       ROUND(lb.balance - COALESCE(SUM(al.accrued) - SUM(al.used) - SUM(al.lapsed), 0), 2) AS drift
FROM leave_balances lb
LEFT JOIN leave_accrual_ledger al
  ON al.employee_code = lb.employee_code
 AND al.leave_type    = lb.leave_type
 AND al.year          = lb.year
WHERE lb.year = 2026
GROUP BY lb.employee_code, lb.leave_type, lb.year, lb.balance
HAVING ABS(drift) > 0.01
ORDER BY ABS(drift) DESC
LIMIT 100;
```
**Result:** _PENDING_
> Employee **codes** only in any pasted result — no names.

---

## Findings

**L-001 — Live verification is impossible from Claude Code on the web.** The SQL Console
credentials are machine-local to Abhinav's Mac (`launchctl setenv`, CLAUDE.md §9.2) and this is an
ephemeral cloud container with no local DB, no sqlite3 binary and no backup file. Any future
data-verification prompt aimed at a web session will hit the same wall. Tag: **FACT**.

**L-002 — This report therefore cannot distinguish "built and working" from "built and dormant".**
The most consequential open question in the whole leave audit — *has EL accrual ever actually
run?* — is a data question (Q3), not a code question. Code analysis can only establish that a
manual trigger exists. Tag: **INFERENCE**.

**L-003 — Column names in Q2–Q8 above are provisional.** They are transcribed from the governing
prompt, not yet from `schema.js`. Reconcile against part 01 before running, or the queries will
error on column-not-found. Tag: **OPINION** (a caution, not a claim).
