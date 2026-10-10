/**
 * Statutory flags PR-1 — schema additions (STEP 1) and the startup reset
 * removal (STEP 2). Synthetic data only.
 */
const S = require('./helpers/statutoryFixture');
const { initSchema } = require('../database/schema');

const cols = (db, t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);

describe('T8a — schema additions are present and idempotent', () => {
  test('lwf_applicable on all four tables, sales numbers, batch table, partial index, trigger', () => {
    const db = S.newDb();
    for (const t of ['employees', 'salary_structures', 'sales_employees', 'sales_salary_structures']) {
      const c = db.prepare(`PRAGMA table_info(${t})`).all().find((x) => x.name === 'lwf_applicable');
      expect(c).toBeTruthy();
      expect(String(c.dflt_value)).toBe('0');
    }
    expect(cols(db, 'sales_employees')).toEqual(expect.arrayContaining(['esi_number', 'uan']));
    expect(cols(db, 'statutory_flag_batches')).toEqual([
      'id', 'scope', 'effective_month', 'file_name', 'file_sha256', 'row_count', 'changed_count',
      'status', 'applied_by', 'applied_at', 'summary_json', 'undo_json',
    ]);
    const idx = db.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND name='uniq_statutory_flag_batches_applied'").get();
    expect(idx.sql).toMatch(/WHERE status = 'applied'/);
    const trg = db.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name='employees_statutory_default_off'").get();
    expect(trg.sql).toMatch(/AFTER INSERT ON employees/);
  });

  test('initSchema twice → no error, one trigger, columns unchanged', () => {
    const db = S.newDb();
    const before = cols(db, 'employees');
    S.silently(() => initSchema(db));
    expect(cols(db, 'employees')).toEqual(before);
    const n = db.prepare("SELECT COUNT(*) AS c FROM sqlite_master WHERE type='trigger' AND name='employees_statutory_default_off'").get().c;
    expect(n).toBe(1);
  });

  test('partial unique index: two applied batches with the same scope+month+sha → refused; applying/failed rows are free', () => {
    const db = S.newDb();
    const ins = db.prepare("INSERT INTO statutory_flag_batches (scope, effective_month, file_sha256, status) VALUES ('plant', '2026-09', 'abc', ?)");
    ins.run('applied');
    expect(() => ins.run('applied')).toThrow(/UNIQUE/);
    expect(() => ins.run('applying')).not.toThrow();
    expect(() => ins.run('failed')).not.toThrow();
    expect(() => db.prepare("INSERT INTO statutory_flag_batches (scope, effective_month, file_sha256, status) VALUES ('sales', '2026-09', 'abc', 'applied')").run()).not.toThrow();
    expect(() => db.prepare("INSERT INTO statutory_flag_batches (scope, effective_month, file_sha256, status) VALUES ('other', '2026-09', 'x', 'applied')").run()).toThrow(/CHECK/);
  });
});

describe('T8 — no startup reset (L2), on the production-shaped DEFAULT 1 tables', () => {
  test('withLiveDefaults reproduces production defaults and keeps the trigger', () => {
    const db = S.withLiveDefaults(S.newDb());
    expect(String(S.dflt(db, 'employees', 'pf_applicable'))).toBe('1');
    expect(String(S.dflt(db, 'employees', 'esi_applicable'))).toBe('1');
    expect(String(S.dflt(db, 'salary_structures', 'pf_applicable'))).toBe('1');
    expect(String(S.dflt(db, 'salary_structures', 'esi_applicable'))).toBe('1');
    expect(String(S.dflt(db, 'employees', 'lwf_applicable'))).toBe('0');
    const trg = db.prepare("SELECT COUNT(*) AS c FROM sqlite_master WHERE type='trigger' AND name='employees_statutory_default_off'").get().c;
    expect(trg).toBe(1);
    // the omitted-flag insert (L3) lands at 0 via the trigger
    db.prepare("INSERT INTO employees (code, name, company) VALUES ('T8X', 'X', ?)").run(S.COMPANY);
    expect(db.prepare("SELECT pf_applicable p, esi_applicable e, lwf_applicable l FROM employees WHERE code='T8X'").get())
      .toEqual({ p: 0, e: 0, l: 0 });
  });

  test('initSchema twice → uploaded flags (no ESI/UAN/PF numbers) stay ON in master and structures', () => {
    const db = S.withLiveDefaults(S.newDb());
    const a = S.plant(db, { esi: 1, lwf: 1 });               // ESI without an ESI number (plant reality)
    const b = S.plant(db, { pf: 1, esi: 1, lwf: 1 });        // PF without UAN / PF number
    S.plantStructure(db, a, '2026-09-01', { esi: 1, lwf: 1 });
    S.plantStructure(db, b, '2026-09-01', { pf: 1, esi: 1, lwf: 1 });
    S.silently(() => require('../database/schema').initSchema(db));
    S.silently(() => require('../database/schema').initSchema(db));
    expect(S.flags(S.master(db, a))).toEqual({ pf: 0, esi: 1, lwf: 1 });
    expect(S.flags(S.master(db, b))).toEqual({ pf: 1, esi: 1, lwf: 1 });
    expect(S.flags(S.plantRows(db, a)[0])).toEqual({ pf: 0, esi: 1, lwf: 1 });
    expect(S.flags(S.plantRows(db, b)[0])).toEqual({ pf: 1, esi: 1, lwf: 1 });
  });

  test('schema.js no longer contains any of the four reset UPDATEs', () => {
    const src = require('fs').readFileSync(require.resolve('../database/schema'), 'utf8');
    expect(src).not.toMatch(/UPDATE employees SET pf_applicable = 0 WHERE pf_applicable = 1/);
    expect(src).not.toMatch(/UPDATE employees SET esi_applicable = 0 WHERE esi_applicable = 1/);
    expect(src).not.toMatch(/UPDATE salary_structures SET pf_applicable = 0 WHERE pf_applicable = 1/);
    expect(src).not.toMatch(/UPDATE salary_structures SET esi_applicable = 0 WHERE esi_applicable = 1/);
  });
});

describe('T13 — new-employee flags-off trigger', () => {
  test('a plain insert that asks for flags ON lands with PF/ESI/LWF 0', () => {
    const db = S.newDb();
    db.prepare(`INSERT INTO employees (code, name, company, pf_applicable, esi_applicable, lwf_applicable)
                VALUES ('T1', 'X', ?, 1, 1, 1)`).run(S.COMPANY);
    const e = db.prepare("SELECT pf_applicable, esi_applicable, lwf_applicable FROM employees WHERE code='T1'").get();
    expect(e).toEqual({ pf_applicable: 0, esi_applicable: 0, lwf_applicable: 0 });
  });

  test('an insert that omits the flags lands at 0 (DEFAULT 1 case: see T8 in STEP 2)', () => {
    const db = S.newDb();
    db.prepare("INSERT INTO employees (code, name, company) VALUES ('T2', 'X', ?)").run(S.COMPANY);
    const e = db.prepare("SELECT pf_applicable, esi_applicable, lwf_applicable FROM employees WHERE code='T2'").get();
    expect(e).toEqual({ pf_applicable: 0, esi_applicable: 0, lwf_applicable: 0 });
  });

  test('UPSERT conflict branch keeps existing flags (the trigger does not fire on it)', () => {
    const db = S.newDb();
    const emp = S.plant(db, { code: 'T3', pf: 1, esi: 1, lwf: 1 });
    // import.js:383 shape
    db.prepare(`
      INSERT INTO employees (code, name, department, company, status, is_data_complete)
      VALUES (?, COALESCE(NULLIF(?, ''), ?), ?, ?, 'Active', 0)
      ON CONFLICT(code) DO UPDATE SET
        name = COALESCE(NULLIF(excluded.name, ''), employees.name),
        department = COALESCE(NULLIF(excluded.department, ''), employees.department),
        updated_at = datetime('now')
    `).run('T3', 'NEW NAME', 'T3', 'STORES', S.COMPANY);
    expect(S.flags(S.master(db, emp))).toEqual({ pf: 1, esi: 1, lwf: 1 });
  });

  test('flags can still be switched on after insert (the upload path)', () => {
    const db = S.newDb();
    const emp = S.plant(db, { code: 'T4' });
    db.prepare('UPDATE employees SET esi_applicable = 1, lwf_applicable = 1 WHERE id = ?').run(emp.id);
    expect(S.flags(S.master(db, emp))).toEqual({ pf: 0, esi: 1, lwf: 1 });
  });
});
