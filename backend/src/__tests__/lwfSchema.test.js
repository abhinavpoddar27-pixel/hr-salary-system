/**
 * Statutory flags PR-2 STEP 1 — LWF schema: columns on both salary outputs,
 * policy keys 5 / 20 (insert-if-missing), AI cache trigger includes LWF.
 * Synthetic data only; real initSchema on in-memory databases.
 */
const S = require('./helpers/statutoryFixture');
const { initSchema } = require('../database/schema');

const cols = (db, t) => db.prepare(`PRAGMA table_info(${t})`).all();
const colNames = (db, t) => cols(db, t).map((c) => c.name);
const policy = (db, k) => db.prepare('SELECT value FROM policy_config WHERE key = ?').get(k);
const triggerRow = (db) => db.prepare("SELECT tbl_name, sql FROM sqlite_master WHERE type='trigger' AND name='invalidate_salary_ai_cache'").get();
const triggerCount = (db) => db.prepare("SELECT COUNT(*) AS c FROM sqlite_master WHERE type='trigger' AND name='invalidate_salary_ai_cache'").get().c;
/** The column list of the trigger's AFTER UPDATE OF clause. */
const triggerCols = (sql) => sql.match(/AFTER UPDATE OF([\s\S]*?)\bON\s+"?salary_computations"?/i)[1]
  .split(',').map((s) => s.trim()).filter(Boolean);

const OLD_29 = [
  'payable_days', 'gross_salary', 'basic_earned', 'da_earned', 'hra_earned',
  'conveyance_earned', 'other_allowances_earned', 'ot_pay', 'gross_earned',
  'pf_employee', 'esi_employee', 'professional_tax', 'tds', 'advance_recovery',
  'loan_recovery', 'lop_deduction', 'other_deductions', 'total_deductions',
  'net_salary', 'late_coming_deduction', 'early_exit_deduction',
  'ed_pay', 'ed_days', 'holiday_duty_pay', 'take_home', 'total_payable',
  'salary_held', 'hold_reason', 'gross_changed',
];
const OLD_TRIGGER_SQL = `
  CREATE TRIGGER IF NOT EXISTS invalidate_salary_ai_cache
  AFTER UPDATE OF ${OLD_29.join(', ')}
  ON salary_computations
  FOR EACH ROW
  WHEN NEW.ai_explanation IS NOT NULL
  BEGIN
    UPDATE salary_computations
    SET ai_explanation = NULL, ai_explanation_at = NULL
    WHERE id = NEW.id;
  END;`;

function cachedRow(db, code = 'T7001') {
  const info = db.prepare(`INSERT INTO salary_computations (employee_code, month, year, company, gross_earned, net_salary, ai_explanation, ai_explanation_at)
                           VALUES (?, 9, 2026, ?, 15000, 15000, 'cached narrative', '2026-10-01 10:00:00')`).run(code, S.COMPANY);
  return Number(info.lastInsertRowid);
}
const cache = (db, id) => db.prepare('SELECT ai_explanation, ai_explanation_at FROM salary_computations WHERE id = ?').get(id);

describe('S1 — columns + policy keys, idempotent', () => {
  test('both tables carry lwf_employee / lwf_employer REAL DEFAULT 0, exactly once, after two boots', () => {
    const db = S.newDb();
    S.silently(() => initSchema(db));
    for (const t of ['salary_computations', 'sales_salary_computations']) {
      for (const c of ['lwf_employee', 'lwf_employer']) {
        const hits = cols(db, t).filter((x) => x.name === c);
        expect(hits).toHaveLength(1);
        expect(hits[0].type).toBe('REAL');
        expect(String(hits[0].dflt_value)).toBe('0');
      }
    }
    db.close();
  });

  test("keys seeded '5' / '20'; an admin-set value survives a re-boot (never force-reset)", () => {
    const db = S.newDb();
    expect(policy(db, 'lwf_employee_amount').value).toBe('5');
    expect(policy(db, 'lwf_employer_amount').value).toBe('20');
    db.prepare("UPDATE policy_config SET value = '7' WHERE key = 'lwf_employee_amount'").run();
    db.prepare("UPDATE policy_config SET value = '25' WHERE key = 'lwf_employer_amount'").run();
    S.silently(() => initSchema(db));
    expect(policy(db, 'lwf_employee_amount').value).toBe('7');
    expect(policy(db, 'lwf_employer_amount').value).toBe('25');
    expect(db.prepare("SELECT COUNT(*) AS c FROM policy_config WHERE key IN ('lwf_employee_amount','lwf_employer_amount')").get().c).toBe(2);
    db.close();
  });
});

describe('S2 — AI cache trigger includes LWF', () => {
  test('trigger lists the 29 old columns + lwf_employee, lwf_employer; one trigger after two boots', () => {
    const db = S.newDb();
    S.silently(() => initSchema(db));
    expect(triggerCount(db)).toBe(1);
    const t = triggerRow(db);
    expect(t.tbl_name).toBe('salary_computations');
    expect(triggerCols(t.sql)).toEqual([...OLD_29, 'lwf_employee', 'lwf_employer']);
    db.close();
  });

  test('updating lwf_employee or lwf_employer nulls the cached narrative; an unwatched column does not', () => {
    const db = S.newDb();
    const a = cachedRow(db, 'T7001');
    db.prepare('UPDATE salary_computations SET lwf_employee = 5 WHERE id = ?').run(a);
    expect(cache(db, a)).toEqual({ ai_explanation: null, ai_explanation_at: null });

    const b = cachedRow(db, 'T7002');
    db.prepare('UPDATE salary_computations SET lwf_employer = 20 WHERE id = ?').run(b);
    expect(cache(db, b)).toEqual({ ai_explanation: null, ai_explanation_at: null });

    const c = cachedRow(db, 'T7003');
    db.prepare("UPDATE salary_computations SET finance_remark = 'note' WHERE id = ?").run(c);
    expect(cache(db, c).ai_explanation).toBe('cached narrative');
    db.close();
  });
});

describe('S3 — an existing DB with the old trigger (L13) is upgraded on boot', () => {
  test('pre-PR-2 shape (no LWF columns, no keys, old 29-column trigger) → initSchema adds columns, keys, new trigger', () => {
    const db = S.newDb();
    // Rebuild the pre-PR-2 shape by hand.
    db.exec('DROP TRIGGER invalidate_salary_ai_cache;');
    for (const t of ['salary_computations', 'sales_salary_computations']) {
      db.exec(`ALTER TABLE ${t} DROP COLUMN lwf_employee;`);
      db.exec(`ALTER TABLE ${t} DROP COLUMN lwf_employer;`);
    }
    db.prepare("DELETE FROM policy_config WHERE key IN ('lwf_employee_amount','lwf_employer_amount')").run();
    db.exec(OLD_TRIGGER_SQL);
    expect(triggerCols(triggerRow(db).sql)).toEqual(OLD_29);
    const id = cachedRow(db, 'T7010');
    expect(colNames(db, 'salary_computations')).not.toContain('lwf_employee');

    S.silently(() => initSchema(db));

    expect(colNames(db, 'salary_computations')).toEqual(expect.arrayContaining(['lwf_employee', 'lwf_employer']));
    expect(colNames(db, 'sales_salary_computations')).toEqual(expect.arrayContaining(['lwf_employee', 'lwf_employer']));
    // the existing row reads 0 for the new columns and keeps its cache until something changes
    const row = db.prepare('SELECT lwf_employee, lwf_employer, ai_explanation FROM salary_computations WHERE id = ?').get(id);
    expect(row).toEqual({ lwf_employee: 0, lwf_employer: 0, ai_explanation: 'cached narrative' });
    expect(policy(db, 'lwf_employee_amount').value).toBe('5');
    expect(policy(db, 'lwf_employer_amount').value).toBe('20');
    expect(triggerCount(db)).toBe(1);
    expect(triggerCols(triggerRow(db).sql)).toEqual([...OLD_29, 'lwf_employee', 'lwf_employer']);
    db.prepare('UPDATE salary_computations SET lwf_employee = 5 WHERE id = ?').run(id);
    expect(cache(db, id).ai_explanation).toBeNull();
    db.close();
  });
});

describe('S4 — company-UNIQUE rebuild keeps the LWF columns and the trigger', () => {
  test('fresh DB: migration ran, live table has LWF + (code, month, year) UNIQUE + the LWF trigger', () => {
    const db = S.newDb();
    expect(policy(db, 'migration_drop_company_from_unique_v1').value).toBe('1');
    const create = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='salary_computations'").get().sql;
    expect(create).toMatch(/UNIQUE\s*\(\s*employee_code\s*,\s*month\s*,\s*year\s*\)/i);
    expect(colNames(db, 'salary_computations')).toEqual(expect.arrayContaining(['lwf_employee', 'lwf_employer']));
    const t = triggerRow(db);
    expect(t.tbl_name).toBe('salary_computations');
    expect(triggerCols(t.sql)).toEqual([...OLD_29, 'lwf_employee', 'lwf_employer']);
    db.close();
  });

  test('re-running the rebuild (flag cleared) carries existing LWF values and re-attaches the trigger to the live table', () => {
    const db = S.newDb();
    const id = cachedRow(db, 'T7020');
    db.prepare('UPDATE salary_computations SET lwf_employee = 5, lwf_employer = 20 WHERE id = ?').run(id); // nulls the cache (watched)
    db.prepare('UPDATE salary_computations SET ai_explanation = ? WHERE id = ?').run('again', id); // re-cache (unwatched)
    db.prepare("DELETE FROM policy_config WHERE key = 'migration_drop_company_from_unique_v1'").run();

    S.silently(() => initSchema(db));

    expect(policy(db, 'migration_drop_company_from_unique_v1').value).toBe('1');
    const row = db.prepare("SELECT lwf_employee, lwf_employer, ai_explanation FROM salary_computations WHERE employee_code = 'T7020'").get();
    expect(row).toEqual({ lwf_employee: 5, lwf_employer: 20, ai_explanation: 'again' });
    expect(triggerCount(db)).toBe(1);
    const t = triggerRow(db);
    expect(t.tbl_name).toBe('salary_computations');
    expect(triggerCols(t.sql)).toEqual([...OLD_29, 'lwf_employee', 'lwf_employer']);
    db.prepare("UPDATE salary_computations SET lwf_employer = 0 WHERE employee_code = 'T7020'").run();
    expect(db.prepare("SELECT ai_explanation FROM salary_computations WHERE employee_code = 'T7020'").get().ai_explanation).toBeNull();
    db.close();
  });
});
