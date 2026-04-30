---
name: sql-query
description: Run a read-only SELECT/WITH/EXPLAIN/PRAGMA against the production HR Salary System database via the SQL Console API. Returns columns + rows.
---

# /sql-query — Production read-only SQL

Use this command to run a single read-only SQL statement against the live HR Salary System database. The endpoint refuses anything that isn't `SELECT`, `WITH`, `EXPLAIN`, or a whitelisted `PRAGMA`, and the database file handle on the server is opened read-only — writes are blocked at two layers.

## Required environment

Set these in your local shell before calling the command:

- `SQL_CONSOLE_URL` — e.g. `https://hr-app-production-681b.up.railway.app`
- `SQL_CONSOLE_API_KEY` — the bearer key from Railway env vars (≥32 chars)

## Steps

1. Read `$SQL_CONSOLE_URL` and `$SQL_CONSOLE_API_KEY` from environment. If either is missing, stop and tell the user to set them.

2. Take the user's SQL string and JSON-escape it into a body. Use `jq` (or a printf with proper escaping) — never paste user-supplied SQL directly into a heredoc without escaping.

3. Execute:

   ```
   curl -sS -X POST "$SQL_CONSOLE_URL/api/admin/sql/execute" \
     -H "X-SQL-Console-Key: $SQL_CONSOLE_API_KEY" \
     -H "Content-Type: application/json" \
     --data-binary "$JSON_BODY"
   ```

   where `$JSON_BODY` is `{"sql": "<the user's SQL>"}` properly escaped (e.g. via `jq -n --arg s "$USER_SQL" '{sql: $s}'`).

4. Parse the JSON response.

   - If `success: true`:
     - Print `OK — N rows in Mms` (use `rowCount` and `ms`)
     - Print the column list and the rows as a markdown table
     - Cap terminal output at 50 rows; if more, mention how many were truncated
     - If `truncated: true`, warn that the server capped at 5000 rows
     - If `slow: true`, warn that the query took >10s

   - If `success: false`:
     - Print the `code` (e.g. `STATEMENT_NOT_ALLOWED`, `WRITE_BLOCKED_BY_FILE_HANDLE`, `BAD_API_KEY`, `RATE_LIMITED`) and `reason`
     - **Do NOT retry.** Surface the error to the user — they need to see the rejection reason.

5. **Never attempt INSERT/UPDATE/DELETE/DDL via this command.** The endpoint will reject; do not loop.

## Example

User: `/sql-query SELECT COUNT(*) FROM employees WHERE status='Active'`

Expected response:
```
OK — 1 rows in 4ms
| COUNT(*) |
| -------- |
| 213      |
```

## Notes

- The endpoint accepts raw SQL only — no JSON parameter binding in Phase 1. Inline values directly into the SQL string. Validate that any user-provided integers/dates are well-formed before substituting.
- Every call is logged to `sql_console_audit` with actor, IP, ms, and either rowCount or rejectReason. You can verify your own calls via `/sql-query SELECT id, ts, status, sql FROM sql_console_audit ORDER BY id DESC LIMIT 5`.
- Rate limit: 30 requests / 60s on the API-key path. If you hit `RATE_LIMITED`, wait a minute.
