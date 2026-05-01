# HR SQL Console — MCP Server

Read-only MCP bridge that lets Claude.ai query the HR Salary System
production database via the existing SQL Console API.

## Architecture

```
Claude.ai (Custom Connector)
    │  HTTPS + Bearer token
    ▼
mcp-server (this Railway service)
    │  HTTPS + X-SQL-Console-Key
    ▼
HR backend SQL Console API  (/api/admin/sql/execute)
    │  better-sqlite3 readonly handle
    ▼
SQLite (hr_system.db)
```

Two auth layers, never combined into one secret:

1. **Bearer token** between Claude.ai and this server (`MCP_BEARER_TOKEN`)
2. **API key** between this server and the SQL Console (`SQL_CONSOLE_API_KEY`) — never sent over the wire to Claude.ai

## Required env vars (Railway)

| Var                    | Purpose                                                          |
| ---------------------- | ---------------------------------------------------------------- |
| `SQL_CONSOLE_URL`      | Base URL of the HR backend (e.g. the production Railway URL)     |
| `SQL_CONSOLE_API_KEY`  | Same key the backend service exposes to read agents (≥32 chars)  |
| `MCP_BEARER_TOKEN`     | Generated fresh, ≥32 chars, used to auth Claude.ai → this server |
| `PORT`                 | Set automatically by Railway                                     |

Generate the bearer token:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

The server fails fast on boot if any of the three required vars are missing or shorter than 32 chars.

## Deploy (Railway)

1. In your existing HR project on Railway → click **+ New** → **GitHub Repo** → select `abhinavpoddar27-pixel/hr-salary-system`.
2. In the new service's **Settings**, set **Root Directory** to `mcp-server`.
3. Railway auto-detects Node (Nixpacks) and runs `npm start`.
4. Set the three env vars above on this service (do NOT touch the existing backend service's vars).
5. Wait for the deploy to go green.
6. Note the public URL Railway assigns (e.g. `https://hr-mcp-production-xxxx.up.railway.app`).
7. Verify health:

   ```bash
   curl https://<your-mcp-url>/health
   # → {"ok":true,"service":"hr-sql-console-mcp",...}
   ```

## Connect to Claude.ai

1. Settings → **Connectors** → **Add custom connector**.
2. Name: `HR SQL Console`.
3. URL: `https://<your-mcp-url>/mcp`.
4. Advanced settings → **OAuth Client Secret**: paste the value of `MCP_BEARER_TOKEN`.
5. Save.
6. In a new conversation, enable the connector via **+** → Connectors, then ask Claude to run a query like `SELECT COUNT(*) FROM employees`.
7. Verify the audit log:

   ```sql
   SELECT * FROM sql_console_audit ORDER BY id DESC LIMIT 1;
   ```

   The most recent row should have `actor='agent'`, `auth_method='api_key'`, and the SQL Claude just ran.

## What it exposes

A single tool: `sql_query(sql: string) → text result`.

Constraints inherited from the upstream SQL Console:

- Read-only — `SELECT`, `WITH`, `EXPLAIN`, and a whitelisted set of `PRAGMA` statements only.
- 5000 row hard cap per response (the tool also truncates inline rendering at 100 rows for LLM consumption).
- 30 req/min rate limit on the upstream API key.
- 10000-char SQL length cap.
- Every call audited in `sql_console_audit` with `actor='agent'` and `auth_method='api_key'`.

Anything else (`INSERT`/`UPDATE`/`DELETE`/`CREATE`/`ALTER`/`DROP`) is rejected by the upstream and the tool surfaces the rejection code/reason verbatim.

## Endpoints

| Method | Path     | Auth          | Purpose                                |
| ------ | -------- | ------------- | -------------------------------------- |
| `GET`  | `/health`| none          | Railway healthcheck + sanity probe     |
| `POST` | `/mcp`   | Bearer token  | MCP JSON-RPC over Streamable HTTP      |

`/mcp` runs the SDK's `StreamableHTTPServerTransport` in stateless mode (`sessionIdGenerator: undefined`), so each Claude.ai request gets a fresh transport. Bearer comparison uses `crypto.timingSafeEqual` with a length-equality guard.

## Security

- The bearer token is **never logged** — only its length appears in boot logs.
- The SQL Console API key is **never** forwarded to Claude.ai. It lives only in this process's env and the request to the backend.
- If `MCP_BEARER_TOKEN` leaks: rotate it via Railway env var update + reconnect Claude.ai. The `SQL_CONSOLE_API_KEY` is unaffected.
- If `SQL_CONSOLE_API_KEY` leaks: rotate it on the backend service AND copy the new value to this MCP service.

## Local development

```bash
cd mcp-server
npm install

SQL_CONSOLE_URL=https://hr-app-production-681b.up.railway.app \
SQL_CONSOLE_API_KEY=<read-agent key> \
MCP_BEARER_TOKEN=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))") \
PORT=7331 \
node index.js
```

Then in another terminal:

```bash
curl http://localhost:7331/health

curl http://localhost:7331/mcp \
  -X POST \
  -H "Authorization: Bearer $MCP_BEARER_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

## Files

- `index.js` — server, ~150 lines, single tool `sql_query`.
- `package.json` — `"type": "module"`, `npm start` runs `node index.js`.
- `.gitignore` — `node_modules/`, `.env`, `*.log`.

No state, no DB, no on-disk writes. Restarting the service is harmless.
