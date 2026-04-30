---
name: sql-schema
description: Fetch the full database schema (tables + columns + row counts) from the SQL Console.
---

# /sql-schema — Full DB schema dump

## Required environment

- `SQL_CONSOLE_URL`
- `SQL_CONSOLE_API_KEY`

## Steps

1. Confirm both env vars are set; otherwise tell the user to set them and stop.

2. Execute:

   ```
   curl -sS -H "X-SQL-Console-Key: $SQL_CONSOLE_API_KEY" \
     "$SQL_CONSOLE_URL/api/admin/sql/schema"
   ```

3. Parse the JSON. The response shape is:

   ```
   { success: true, tables: [{ name, columns: [{name, type, notnull, pk}, ...], rowCount }, ...], cachedAt, cached }
   ```

4. Render as a hierarchical list grouped by table:

   ```
   ## <table_name>  (N rows)
   - column_name : TYPE [PK] [NOT NULL]
   - ...
   ```

5. If `cached: true`, mention "(schema cached <Xs ago>)" — the server caches schema for 60s.

## Notes

- Schema fetches are audited (status='ok', sql='/schema'). You can confirm via `/sql-query SELECT id, ts, sql FROM sql_console_audit WHERE sql='/schema' ORDER BY id DESC LIMIT 3`.
- 48 tables are expected as of Phase 1 (April/May 2026). If you see fewer than 30, the database may be partially initialized.
- Use this output to compose follow-up `/sql-query` calls — the column names and types are the source of truth, not memory of past schema.
