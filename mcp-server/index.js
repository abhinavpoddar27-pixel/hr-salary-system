import express from 'express';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema
} from '@modelcontextprotocol/sdk/types.js';

const SQL_CONSOLE_URL = process.env.SQL_CONSOLE_URL;
const SQL_CONSOLE_API_KEY = process.env.SQL_CONSOLE_API_KEY;
const PORT = process.env.PORT || 7331;

if (!SQL_CONSOLE_URL) {
  console.error('[MCP] FATAL: SQL_CONSOLE_URL not set');
  process.exit(1);
}
if (!SQL_CONSOLE_API_KEY || SQL_CONSOLE_API_KEY.length < 32) {
  console.error('[MCP] FATAL: SQL_CONSOLE_API_KEY missing or <32 chars');
  process.exit(1);
}

async function callSqlConsole(sql) {
  let r;
  try {
    r = await fetch(`${SQL_CONSOLE_URL}/api/admin/sql/execute`, {
      method: 'POST',
      headers: {
        'X-SQL-Console-Key': SQL_CONSOLE_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ sql })
    });
  } catch (err) {
    return { httpStatus: 0, data: { success: false, code: 'UPSTREAM_FETCH_ERROR', reason: err.message } };
  }
  const data = await r.json().catch(() => ({ success: false, code: 'UPSTREAM_PARSE_ERROR' }));
  return { httpStatus: r.status, data };
}

function createMcpServer() {
  const server = new Server(
    { name: 'hr-sql-console', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'sql_query',
        description:
          'Run a read-only SQL query (SELECT/WITH/EXPLAIN/PRAGMA) against the HR Salary System production database. Returns columns, rows, and row count. INSERT/UPDATE/DELETE/DDL are rejected by the upstream API. Use LIMIT in queries to keep responses bounded; max 5000 rows returned per call. All queries are audited.',
        inputSchema: {
          type: 'object',
          properties: {
            sql: {
              type: 'string',
              description: 'A single SQL statement. SELECT, WITH, EXPLAIN, or PRAGMA only.'
            }
          },
          required: ['sql']
        }
      }
    ]
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name !== 'sql_query') {
      return {
        content: [{ type: 'text', text: `Unknown tool: ${request.params.name}` }],
        isError: true
      };
    }
    const sql = request.params.arguments?.sql;
    if (typeof sql !== 'string' || sql.length === 0) {
      return {
        content: [{ type: 'text', text: 'Invalid input: sql must be a non-empty string' }],
        isError: true
      };
    }

    const { httpStatus, data } = await callSqlConsole(sql);

    if (httpStatus === 200 && data && data.success) {
      const rows = Array.isArray(data.rows) ? data.rows : [];
      const columns = Array.isArray(data.columns) ? data.columns : (rows[0] ? Object.keys(rows[0]) : []);
      const rowCount = typeof data.rowCount === 'number' ? data.rowCount : rows.length;
      const summary = `${rowCount} row(s) in ${data.ms ?? '?'}ms${data.truncated ? ' (truncated at 5000)' : ''}`;
      const headerLine = columns.join(' | ');
      const bodyLines = rows.slice(0, 100).map((row) =>
        columns.map((c) => String(row[c] ?? 'NULL')).join(' | ')
      ).join('\n');
      const note = rows.length > 100 ? `\n\n(showing first 100 of ${rows.length} rows)` : '';
      return {
        content: [{
          type: 'text',
          text: `${summary}\n\n${headerLine}\n${bodyLines}${note}`
        }]
      };
    }

    const code = (data && data.code) || 'UNKNOWN';
    const reason = (data && (data.reason || data.message)) || JSON.stringify(data);
    return {
      content: [{
        type: 'text',
        text: `SQL Console error (HTTP ${httpStatus}): code=${code} reason=${reason}`
      }],
      isError: true
    };
  });

  return server;
}

const app = express();
app.use(express.json({ limit: '100kb' }));

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    service: 'hr-sql-console-mcp',
    upstream: SQL_CONSOLE_URL,
    auth: 'none',
    hasApiKey: !!SQL_CONSOLE_API_KEY
  });
});

app.post('/mcp', async (req, res) => {
  const server = createMcpServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined
  });
  res.on('close', () => {
    transport.close();
    server.close();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error('[MCP] handler error:', err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

app.listen(PORT, () => {
  console.log(`[MCP] hr-sql-console-mcp listening on :${PORT}`);
  console.log(`[MCP] upstream: ${SQL_CONSOLE_URL}`);
  console.log('[MCP] auth: NONE (publicly accessible — read-only enforced upstream)');
});
