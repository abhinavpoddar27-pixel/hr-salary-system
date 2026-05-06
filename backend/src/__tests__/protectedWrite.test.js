const Database = require('better-sqlite3');
const { protectedWrite } = require('../services/protectedWrite');

// ── Test fixture: fresh in-memory DB per test ────────────────────────────────
//
// Each test gets its own DB. No shared state. Schema mirrors the relevant
// pieces of the real protected_writes audit table plus two fixture tables
// (`widgets` non-payroll, `salary_computations` payroll for the defence-in-
// depth gate).

function setupDb() {
  const db = new Database(':memory:');
  db.pragma('journal_mode = MEMORY');

  db.exec(`
    CREATE TABLE protected_writes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      operation_id TEXT NOT NULL,
      idempotency_key TEXT,
      table_name TEXT NOT NULL,
      operation TEXT NOT NULL CHECK (operation IN ('insert','update','delete','upsert')),
      scope_json TEXT,
      row_count INTEGER NOT NULL,
      dry_run INTEGER NOT NULL DEFAULT 0,
      forced_large_change INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL CHECK (status IN ('success','aborted_invariant','aborted_threshold','aborted_idempotent','error')),
      aborted_reason TEXT,
      triggered_by TEXT,
      reason TEXT,
      duration_ms INTEGER,
      executed_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE widgets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      name TEXT,
      value INTEGER,
      status TEXT
    );

    CREATE TABLE salary_computations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_code TEXT NOT NULL,
      month INTEGER NOT NULL,
      year INTEGER NOT NULL,
      gross REAL,
      UNIQUE (employee_code, month, year)
    );
  `);
  return db;
}

function countWidgets(db) { return db.prepare('SELECT COUNT(*) AS c FROM widgets').get().c; }
function countAuditRows(db) { return db.prepare('SELECT COUNT(*) AS c FROM protected_writes').get().c; }
function lastAudit(db) { return db.prepare('SELECT * FROM protected_writes ORDER BY id DESC LIMIT 1').get(); }

let logSpy;
beforeEach(() => {
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  if (logSpy) logSpy.mockRestore();
});

// ── Validation (T01–T06) ─────────────────────────────────────────────────────

describe('protectedWrite — validation', () => {
  test('T01 rejects missing required field (table, operation, rows for insert)', async () => {
    const db = setupDb();
    await expect(protectedWrite(db, { operation: 'insert', rows: [{ code: 'X' }] }))
      .rejects.toThrow(/table is required/);
    await expect(protectedWrite(db, { table: 'widgets', rows: [{ code: 'X' }] }))
      .rejects.toThrow(/operation must be/);
    await expect(protectedWrite(db, { table: 'widgets', operation: 'insert' }))
      .rejects.toThrow(/insert requires non-empty rows/);
    expect(countAuditRows(db)).toBe(0); // validation failures do NOT audit
  });

  test('T02 rejects unknown keys', async () => {
    const db = setupDb();
    await expect(protectedWrite(db, {
      table: 'widgets', operation: 'insert', rows: [{ code: 'X' }], spurious: 1,
    })).rejects.toThrow(/Unknown opt key: spurious/);
  });

  test('T03 rejects unknown table name', async () => {
    const db = setupDb();
    await expect(protectedWrite(db, {
      table: 'no_such_table', operation: 'insert', rows: [{ code: 'X' }],
    })).rejects.toThrow(/table "no_such_table" does not exist/);
  });

  test('T04 rejects delete without allowDelete=true', async () => {
    const db = setupDb();
    await expect(protectedWrite(db, {
      table: 'widgets', operation: 'delete', where: { sql: 'id = ?', params: [1] },
    })).rejects.toThrow(/allowDelete: true/);
  });

  test('T05 rejects upsert without conflictKey', async () => {
    const db = setupDb();
    await expect(protectedWrite(db, {
      table: 'widgets', operation: 'upsert', rows: [{ code: 'X', name: 'a' }],
      setColumns: ['name'],
    })).rejects.toThrow(/conflictKey/);
  });

  test('T06 rejects upsert without setColumns', async () => {
    const db = setupDb();
    await expect(protectedWrite(db, {
      table: 'widgets', operation: 'upsert', rows: [{ code: 'X', name: 'a' }],
      conflictKey: ['code'],
    })).rejects.toThrow(/setColumns/);
  });
});

// ── UPSERT column alignment defence (T07–T09) ────────────────────────────────

describe('protectedWrite — UPSERT column-list defence (Stage 7 root cause)', () => {
  test('T07 rejects upsert when setColumns OMITS a column present in rows[0]', async () => {
    const db = setupDb();
    const result = await protectedWrite(db, {
      table: 'widgets', operation: 'upsert',
      rows: [{ code: 'W1', name: 'a', value: 1 }],
      conflictKey: ['code'],
      setColumns: ['name'], // omits "value" → mismatch
    });
    expect(result.status).toBe('aborted_invariant');
    expect(result.reason).toMatch(/UPSERT_COLUMN_MISMATCH/);
    expect(countWidgets(db)).toBe(0); // nothing inserted
    expect(lastAudit(db).status).toBe('aborted_invariant');
  });

  test('T08 rejects upsert when setColumns INCLUDES a column NOT in rows[0]', async () => {
    const db = setupDb();
    const result = await protectedWrite(db, {
      table: 'widgets', operation: 'upsert',
      rows: [{ code: 'W1', name: 'a' }],
      conflictKey: ['code'],
      setColumns: ['name', 'value'], // "value" is not in rows[0]
    });
    expect(result.status).toBe('aborted_invariant');
    expect(result.reason).toMatch(/UPSERT_COLUMN_MISMATCH/);
  });

  test('T09 accepts upsert when setColumns exactly matches rows[0] minus conflictKey', async () => {
    const db = setupDb();
    const result = await protectedWrite(db, {
      table: 'widgets', operation: 'upsert',
      rows: [{ code: 'W1', name: 'a', value: 1, status: 'active' }],
      conflictKey: ['code'],
      setColumns: ['name', 'value', 'status'],
    });
    expect(result.status).toBe('success');
    expect(countWidgets(db)).toBe(1);
  });
});

// ── Idempotency defence (T10–T12) ────────────────────────────────────────────

describe('protectedWrite — idempotency', () => {
  test('T10 same idempotencyKey within window → second call aborted_idempotent, no second insert', async () => {
    const db = setupDb();
    const opts = {
      table: 'widgets', operation: 'insert',
      rows: [{ code: 'A' }],
      idempotencyKey: 'KEY1', idempotencyWindowMinutes: 60,
    };
    const r1 = await protectedWrite(db, opts);
    expect(r1.status).toBe('success');
    // Second call with same key + same payload (different instance, simulating retry)
    const r2 = await protectedWrite(db, {
      ...opts, rows: [{ code: 'B' }], // different rows; idempotency should still hit
    });
    expect(r2.status).toBe('aborted_idempotent');
    expect(r2.reason).toMatch(/IDEMPOTENT_HIT/);
    expect(countWidgets(db)).toBe(1); // only the first call's row exists
    // Two audit rows: one success, one aborted_idempotent
    expect(countAuditRows(db)).toBe(2);
    const rows = db.prepare('SELECT status FROM protected_writes ORDER BY id ASC').all();
    expect(rows.map((r) => r.status)).toEqual(['success', 'aborted_idempotent']);
  });

  test('T11 same idempotencyKey OUTSIDE window → second call executes normally', async () => {
    const db = setupDb();
    // Simulate a stale prior call by directly inserting an audit row with an
    // old executed_at. With window=60, a row from -2 hours ago is out of window.
    db.prepare(`
      INSERT INTO protected_writes (operation_id, idempotency_key, table_name, operation,
        row_count, status, executed_at)
      VALUES ('stale-op', 'STALE', 'widgets', 'insert', 1, 'success', datetime('now', '-2 hours'))
    `).run();
    const r = await protectedWrite(db, {
      table: 'widgets', operation: 'insert',
      rows: [{ code: 'X' }],
      idempotencyKey: 'STALE', idempotencyWindowMinutes: 60,
    });
    expect(r.status).toBe('success');
    expect(countWidgets(db)).toBe(1);
  });

  test('T12 missing idempotencyKey → no idempotency check, executes normally', async () => {
    const db = setupDb();
    const r1 = await protectedWrite(db, {
      table: 'widgets', operation: 'insert', rows: [{ code: 'A' }],
    });
    const r2 = await protectedWrite(db, {
      table: 'widgets', operation: 'insert', rows: [{ code: 'B' }],
    });
    expect(r1.status).toBe('success');
    expect(r2.status).toBe('success');
    expect(countWidgets(db)).toBe(2);
  });
});

// ── Pre-write invariants (T13–T16) ───────────────────────────────────────────

describe('protectedWrite — invariants', () => {
  test('T13 invariant returning true → executes', async () => {
    const db = setupDb();
    const r = await protectedWrite(db, {
      table: 'widgets', operation: 'insert',
      rows: [{ code: 'W1' }],
      invariants: [() => true],
    });
    expect(r.status).toBe('success');
    expect(countWidgets(db)).toBe(1);
  });

  test('T14 invariant returning string → aborted_invariant with that reason', async () => {
    const db = setupDb();
    const r = await protectedWrite(db, {
      table: 'widgets', operation: 'insert', rows: [{ code: 'W1' }],
      invariants: [() => 'GROSS_NEGATIVE: gross_earned cannot be negative'],
    });
    expect(r.status).toBe('aborted_invariant');
    expect(r.reason).toBe('GROSS_NEGATIVE: gross_earned cannot be negative');
    expect(countWidgets(db)).toBe(0);
    expect(lastAudit(db).aborted_reason).toBe('GROSS_NEGATIVE: gross_earned cannot be negative');
  });

  test('T15 multiple invariants, last one fails → cites only the failing one\'s reason', async () => {
    const db = setupDb();
    const r = await protectedWrite(db, {
      table: 'widgets', operation: 'insert', rows: [{ code: 'W1' }],
      invariants: [
        () => true,
        () => true,
        () => 'BLAME_THE_LAST',
      ],
    });
    expect(r.status).toBe('aborted_invariant');
    expect(r.reason).toBe('BLAME_THE_LAST');
  });

  test('T16 invariant that throws → status=error, re-thrown to caller', async () => {
    const db = setupDb();
    const boom = new Error('invariant exploded');
    await expect(protectedWrite(db, {
      table: 'widgets', operation: 'insert', rows: [{ code: 'W1' }],
      invariants: [() => { throw boom; }],
    })).rejects.toThrow('invariant exploded');
    // Audit row written with status='error'
    const audit = lastAudit(db);
    expect(audit.status).toBe('error');
    expect(audit.aborted_reason).toBe('invariant exploded');
    expect(countWidgets(db)).toBe(0);
  });
});

// ── Threshold defence (T17–T20) ──────────────────────────────────────────────

describe('protectedWrite — threshold', () => {
  function seedWidgets(db, n) {
    const stmt = db.prepare('INSERT INTO widgets (code, status) VALUES (?, ?)');
    const tx = db.transaction(() => {
      for (let i = 0; i < n; i++) stmt.run(`C${i}`, 'old');
    });
    tx();
  }

  test('T17 update affecting >50 rows without forceLargeChange → aborted_threshold', async () => {
    const db = setupDb();
    seedWidgets(db, 60);
    const r = await protectedWrite(db, {
      table: 'widgets', operation: 'update',
      rows: [{ status: 'new' }],
      where: { sql: 'status = ?', params: ['old'] }, // matches 60
    });
    expect(r.status).toBe('aborted_threshold');
    expect(r.row_count).toBe(60);
    // No widgets were updated
    expect(db.prepare("SELECT COUNT(*) AS c FROM widgets WHERE status = 'old'").get().c).toBe(60);
  });

  test('T18 update affecting >50 rows WITH forceLargeChange=true → executes', async () => {
    const db = setupDb();
    seedWidgets(db, 60);
    const r = await protectedWrite(db, {
      table: 'widgets', operation: 'update',
      rows: [{ status: 'new' }],
      where: { sql: 'status = ?', params: ['old'] },
      forceLargeChange: true,
    });
    expect(r.status).toBe('success');
    expect(r.row_count).toBe(60);
    expect(db.prepare("SELECT COUNT(*) AS c FROM widgets WHERE status = 'new'").get().c).toBe(60);
  });

  test('T19 delete on payroll table without forceLargeChange (even 1 row) → aborted_threshold (defence-in-depth)', async () => {
    const db = setupDb();
    db.prepare('INSERT INTO salary_computations (employee_code, month, year, gross) VALUES (?, ?, ?, ?)')
      .run('E1', 4, 2026, 50000);
    const r = await protectedWrite(db, {
      table: 'salary_computations', operation: 'delete', allowDelete: true,
      where: { sql: 'id = ?', params: [1] },
    });
    expect(r.status).toBe('aborted_threshold');
    expect(r.reason).toMatch(/THRESHOLD_PAYROLL_DELETE/);
    expect(db.prepare('SELECT COUNT(*) AS c FROM salary_computations').get().c).toBe(1);
  });

  test('T20 delete on NON-payroll table affecting <50 rows with allowDelete → executes', async () => {
    const db = setupDb();
    db.prepare('INSERT INTO widgets (code) VALUES (?)').run('W1');
    const r = await protectedWrite(db, {
      table: 'widgets', operation: 'delete', allowDelete: true,
      where: { sql: 'code = ?', params: ['W1'] },
    });
    expect(r.status).toBe('success');
    expect(r.row_count).toBe(1);
    expect(countWidgets(db)).toBe(0);
  });
});

// ── Dry-run (T21–T23) ────────────────────────────────────────────────────────

describe('protectedWrite — dry run', () => {
  test('T21 dryRun=true on insert → would_insert = N, no rows actually inserted', async () => {
    const db = setupDb();
    const r = await protectedWrite(db, {
      table: 'widgets', operation: 'insert',
      rows: [{ code: 'A' }, { code: 'B' }, { code: 'C' }],
      dryRun: true,
    });
    expect(r.status).toBe('dry_run');
    expect(r.would_insert).toBe(3);
    expect(countWidgets(db)).toBe(0);
    // Audit row marked dry_run=1, status=success
    const a = lastAudit(db);
    expect(a.dry_run).toBe(1);
    expect(a.status).toBe('success');
  });

  test('T22 dryRun=true on update → would_update = N, no rows changed', async () => {
    const db = setupDb();
    db.prepare('INSERT INTO widgets (code, status) VALUES (?, ?)').run('A', 'old');
    db.prepare('INSERT INTO widgets (code, status) VALUES (?, ?)').run('B', 'old');
    db.prepare('INSERT INTO widgets (code, status) VALUES (?, ?)').run('C', 'kept');
    const r = await protectedWrite(db, {
      table: 'widgets', operation: 'update',
      rows: [{ status: 'new' }],
      where: { sql: 'status = ?', params: ['old'] },
      dryRun: true,
    });
    expect(r.status).toBe('dry_run');
    expect(r.would_update).toBe(2);
    // No actual change
    expect(db.prepare("SELECT COUNT(*) AS c FROM widgets WHERE status = 'old'").get().c).toBe(2);
    expect(db.prepare("SELECT COUNT(*) AS c FROM widgets WHERE status = 'new'").get().c).toBe(0);
  });

  test('T23 dryRun=true on upsert with mix of new + existing → would_insert and would_update both correct', async () => {
    const db = setupDb();
    db.prepare('INSERT INTO widgets (code, name) VALUES (?, ?)').run('EXIST1', 'orig1');
    db.prepare('INSERT INTO widgets (code, name) VALUES (?, ?)').run('EXIST2', 'orig2');
    const r = await protectedWrite(db, {
      table: 'widgets', operation: 'upsert',
      rows: [
        { code: 'EXIST1', name: 'updated1' }, // hits existing
        { code: 'NEW1', name: 'new1' },        // new
        { code: 'EXIST2', name: 'updated2' }, // hits existing
        { code: 'NEW2', name: 'new2' },        // new
      ],
      conflictKey: ['code'],
      setColumns: ['name'],
      dryRun: true,
    });
    expect(r.status).toBe('dry_run');
    expect(r.would_update).toBe(2);
    expect(r.would_insert).toBe(2);
    expect(countWidgets(db)).toBe(2); // unchanged
    expect(db.prepare('SELECT name FROM widgets WHERE code = ?').get('EXIST1').name).toBe('orig1');
  });
});

// ── Audit log (T24–T26) ──────────────────────────────────────────────────────

describe('protectedWrite — audit log', () => {
  test('T24 every call (success / abort / error) writes exactly one row to protected_writes', async () => {
    const db = setupDb();

    // Success
    await protectedWrite(db, { table: 'widgets', operation: 'insert', rows: [{ code: 'A' }] });
    expect(countAuditRows(db)).toBe(1);

    // aborted_invariant (UPSERT mismatch — setColumns names a real column
    // that isn't in rows[0], which trips the alignment check rather than
    // the empty-array validator)
    await protectedWrite(db, {
      table: 'widgets', operation: 'upsert', rows: [{ code: 'B', name: 'x' }],
      conflictKey: ['code'], setColumns: ['value'],
    });
    expect(countAuditRows(db)).toBe(2);

    // aborted_threshold (>50 update without force)
    const stmt = db.prepare('INSERT INTO widgets (code, status) VALUES (?, ?)');
    const tx = db.transaction(() => { for (let i = 0; i < 60; i++) stmt.run(`X${i}`, 'old'); });
    tx();
    await protectedWrite(db, {
      table: 'widgets', operation: 'update', rows: [{ status: 'new' }],
      where: { sql: 'status = ?', params: ['old'] },
    });
    expect(countAuditRows(db)).toBe(3);

    // aborted_idempotent
    await protectedWrite(db, {
      table: 'widgets', operation: 'insert', rows: [{ code: 'IDEM' }],
      idempotencyKey: 'IDEM-K',
    });
    expect(countAuditRows(db)).toBe(4);
    await protectedWrite(db, {
      table: 'widgets', operation: 'insert', rows: [{ code: 'OTHER' }],
      idempotencyKey: 'IDEM-K',
    });
    expect(countAuditRows(db)).toBe(5);

    // error path (UNIQUE violation throws inside txn)
    await expect(protectedWrite(db, {
      table: 'widgets', operation: 'insert', rows: [{ code: 'A' }], // collides with first insert
    })).rejects.toThrow();
    expect(countAuditRows(db)).toBe(6);

    const statuses = db.prepare('SELECT status FROM protected_writes ORDER BY id').all().map((r) => r.status);
    expect(statuses).toEqual([
      'success', 'aborted_invariant', 'aborted_threshold', 'success', 'aborted_idempotent', 'error',
    ]);
  });

  test('T25 protected_writes row contains operation_id, table_name, operation, status, row_count, duration_ms, triggered_by, reason', async () => {
    const db = setupDb();
    const r = await protectedWrite(db, {
      table: 'widgets', operation: 'insert', rows: [{ code: 'A' }],
      triggeredBy: 'cron:salary_recompute',
      reason: 'test fixture for T25',
      scope: { month: 4, year: 2026 },
    });
    const a = lastAudit(db);
    expect(a.operation_id).toBe(r.operation_id);
    expect(a.operation_id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(a.table_name).toBe('widgets');
    expect(a.operation).toBe('insert');
    expect(a.status).toBe('success');
    expect(a.row_count).toBe(1);
    expect(a.duration_ms).toBeGreaterThanOrEqual(0);
    expect(a.triggered_by).toBe('cron:salary_recompute');
    expect(a.reason).toBe('test fixture for T25');
    expect(JSON.parse(a.scope_json)).toEqual({ month: 4, year: 2026 });
  });

  test('T26 status=error row contains aborted_reason from the thrown error', async () => {
    const db = setupDb();
    db.prepare('INSERT INTO widgets (code) VALUES (?)').run('A');
    await expect(protectedWrite(db, {
      table: 'widgets', operation: 'insert', rows: [{ code: 'A' }],
    })).rejects.toThrow(/UNIQUE/);
    const a = lastAudit(db);
    expect(a.status).toBe('error');
    expect(a.aborted_reason).toMatch(/UNIQUE/);
  });
});

// ── Transaction safety (T27) ─────────────────────────────────────────────────

describe('protectedWrite — transaction safety', () => {
  test('T27 UNIQUE violation in multi-row insert → entire transaction rolls back, status=error, zero rows inserted', async () => {
    const db = setupDb();
    db.prepare('INSERT INTO widgets (code) VALUES (?)').run('EXISTING');
    expect(countWidgets(db)).toBe(1);
    await expect(protectedWrite(db, {
      table: 'widgets', operation: 'insert',
      rows: [
        { code: 'NEW1' },     // would succeed alone
        { code: 'EXISTING' }, // collides → throws
        { code: 'NEW2' },     // never reached
      ],
    })).rejects.toThrow();
    // Atomicity: no partial state. Only the pre-seeded EXISTING remains.
    expect(countWidgets(db)).toBe(1);
    expect(db.prepare('SELECT code FROM widgets').get().code).toBe('EXISTING');
    const a = lastAudit(db);
    expect(a.status).toBe('error');
  });
});

// ── Snapshot stub (T28) ──────────────────────────────────────────────────────

describe('protectedWrite — snapshot stub', () => {
  test('T28 destructive operation logs the snapshot-stub line and proceeds', async () => {
    const db = setupDb();
    db.prepare('INSERT INTO widgets (code, status) VALUES (?, ?)').run('A', 'old');
    const r = await protectedWrite(db, {
      table: 'widgets', operation: 'update',
      rows: [{ status: 'new' }],
      where: { sql: 'code = ?', params: ['A'] },
    });
    expect(r.status).toBe('success');
    // The stub IS called, but does nothing operational.
    expect(logSpy).toHaveBeenCalledWith('[protectedWrite] snapshot stub — Phase 3 will implement');
  });
});
