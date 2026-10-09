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
