/**
 * Statutory flags PR-1 — service (STEP 3: parse + plan + lookups; STEP 4: apply + undo).
 * Synthetic codes / numbers only.
 */
const S = require('./helpers/statutoryFixture');
const SF = require('../services/statutoryFlags');

const { xlsxBuf, prow, PLANT_HDR, SALES_HDR } = S;
const parsePlant = (...rows) => SF.parseFlagFile(S.plantFile(...rows), 'plant');

describe('parseFlagFile', () => {
  test('plant: Y/N/yes/no/1/0 parsed; codes kept as text; numbers kept as digits', () => {
    const r = parsePlant(prow(91001, 'Y', 'n', 'yes', { uan: 100012345678, esi_number: 1234567890 }), prow('91002', 'No', '1', '0'));
    expect(r.ok).toBe(true);
    expect(r.rows[0]).toMatchObject({ code: '91001', esi: 1, pf: 0, lwf: 1, uan: '100012345678', esi_number: '1234567890' });
    expect(r.rows[1]).toMatchObject({ code: '91002', esi: 0, pf: 1, lwf: 0, uan: '', esi_number: '' });
  });

  test('header normalisation: mixed case and spaces', () => {
    const buf = xlsxBuf([['Code', 'ESI Applicable', 'PF  applicable', ' LWF_Applicable '], ['91003', 'Y', 'N', 'Y']]);
    const r = SF.parseFlagFile(buf, 'plant');
    expect(r.ok).toBe(true);
    expect(r.rows[0]).toMatchObject({ code: '91003', esi: 1, pf: 0, lwf: 1 });
  });

  test('missing column → blocking', () => {
    const buf = xlsxBuf([['code', 'esi_applicable', 'pf_applicable'], ['91004', 'Y', 'N']]);
    const r = SF.parseFlagFile(buf, 'plant');
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/Missing column\(s\): lwf_applicable/);
  });

  test('repeated plant code → blocking; sales same code in two companies is fine, same code+company repeats → blocking', () => {
    expect(parsePlant(prow('91005', 'Y', 'N', 'Y'), prow('91005', 'N', 'N', 'Y')).errors[0]).toMatch(/repeats row 2/);
    const ok = SF.parseFlagFile(xlsxBuf([SALES_HDR, ['Z1', S.COMPANY, 'X', 'Y', 'N', 'Y', '', '', ''], ['Z1', S.OTHER_COMPANY, 'X', 'Y', 'N', 'Y', '', '', '']]), 'sales');
    expect(ok.ok).toBe(true);
    const bad = SF.parseFlagFile(xlsxBuf([SALES_HDR, ['Z1', S.COMPANY, 'X', 'Y', 'N', 'Y', '', '', ''], ['Z1', S.COMPANY, 'X', 'N', 'N', 'Y', '', '', '']]), 'sales');
    expect(bad.ok).toBe(false);
  });

  test('unreadable Y/N value → blocking (never guessed)', () => {
    const r = parsePlant(prow('91006', 'maybe', 'N', 'Y'));
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/esi_applicable must be Y or N/);
  });

  test('CSV works the same way', () => {
    const csv = Buffer.from(`${PLANT_HDR.join(',')}\n91007,SYNTH,Worker,Y,N,Y,,100012345679,\n`);
    const r = SF.parseFlagFile(csv, 'plant');
    expect(r.ok).toBe(true);
    expect(r.rows[0]).toMatchObject({ code: '91007', esi: 1, uan: '100012345679' });
  });
});

describe('structureForDate / carryFlags mirror compute', () => {
  test('in-effect row wins; before any row → latest row (fallback); id breaks ties', () => {
    const db = S.newDb();
    const e = S.plant(db);
    S.plantStructure(db, e, '2026-04-22', { esi: 1 });
    S.plantStructure(db, e, '2026-09-06', { pf: 1 });
    expect(SF.structureForDate(db, 'plant', e.id, '2026-05-01').effective_from).toBe('2026-04-22');
    expect(SF.structureForDate(db, 'plant', e.id, '2026-10-01').effective_from).toBe('2026-09-06');
    expect(SF.structureForDate(db, 'plant', e.id, '2026-01-01').effective_from).toBe('2026-09-06'); // fallback = latest
    expect(SF.carryFlags(db, 'plant', e.id, '2026-05-01')).toEqual({ pf: 0, esi: 1, lwf: 0 });
    expect(SF.carryFlags(db, 'plant', e.id, '2026-10-01')).toEqual({ pf: 1, esi: 0, lwf: 0 });
  });

  test('no structure → carryFlags all 0', () => {
    const db = S.newDb();
    const e = S.plant(db);
    expect(SF.structureForDate(db, 'plant', e.id, '2026-09-01')).toBeNull();
    expect(SF.carryFlags(db, 'plant', e.id, '2026-09-01')).toEqual({ pf: 0, esi: 0, lwf: 0 });
  });

  test('sales uses YYYY-MM keys and id DESC like getLatestStructure', () => {
    const db = S.newDb();
    const e = S.salesEmp(db);
    S.salesStructure(db, e, '2026-01', { esi: 1, effective_to: '2026-09' });
    S.salesStructure(db, e, '2026-10', { lwf: 1 });
    expect(SF.structureForDate(db, 'sales', e.id, '2026-09').effective_from).toBe('2026-01');
    expect(SF.carryFlags(db, 'sales', e.id, '2026-11')).toEqual({ pf: 0, esi: 0, lwf: 1 });
  });
});

describe('planFlagChanges', () => {
  function plan(db, rows, scope = 'plant', month = '2026-09') {
    return SF.planFlagChanges(db, { scope, effectiveMonth: month, rows });
  }

  test('T7 unmatched code → row error, skipped; matched row changes', () => {
    const db = S.newDb();
    const e = S.plant(db);
    S.plantStructure(db, e, '2025-01-01');
    const parsed = parsePlant(prow(e.code, 'Y', 'N', 'Y'), prow('NOPE1', 'Y', 'N', 'Y')).rows;
    const p = plan(db, parsed);
    expect(p.ok).toBe(true);
    expect(p.rows[1]).toMatchObject({ matched: false, error: expect.stringMatching(/Unmatched/) });
    expect(p.rows[0]).toMatchObject({ matched: true, error: null, flagChanged: true, changed: true });
    expect(p.totals).toMatchObject({ rows: 2, matched: 1, unmatched: 1, changed: 1 });
  });

  test('T7 numbers: malformed → warning, blank → unchanged, used by another → warning, valid new → numberChanged', () => {
    const db = S.newDb();
    const a = S.plant(db, { uan: '100000000001' });
    const b = S.plant(db, { uan: '100000000002' });
    const c = S.plant(db);
    for (const e of [a, b, c]) S.plantStructure(db, e, '2025-01-01');
    const rows = parsePlant(
      prow(a.code, 'N', 'N', 'N', { uan: '12345', esi_number: 'ABCDEFGHIJ' }),
      prow(b.code, 'N', 'N', 'N', { uan: '100000000001' }),
      prow(c.code, 'N', 'N', 'N', { uan: '100000000003', esi_number: '1000000003' }),
    ).rows;
    const p = plan(db, rows);
    expect(p.rows[0].warnings.join('|')).toMatch(/Malformed UAN/);
    expect(p.rows[0].warnings.join('|')).toMatch(/Malformed ESI number/);
    expect(p.rows[0]).toMatchObject({ numberChanged: false, changed: false });
    expect(p.rows[1].warnings.join('|')).toMatch(/UAN already used by/);
    expect(p.rows[1].numberChanged).toBe(false);
    expect(p.rows[2]).toMatchObject({ numberChanged: true, changed: true, numbers: { uan: '100000000003', esi_number: '1000000003' } });
  });

  test('T15 no structure → row error (prevents the 2025-01-01 auto-create carrying ON flags)', () => {
    const db = S.newDb();
    const e = S.plant(db);
    const p = plan(db, parsePlant(prow(e.code, 'Y', 'Y', 'Y')).rows);
    expect(p.ok).toBe(true);
    expect(p.rows[0].error).toMatch(/No salary structure/);
    expect(p.totals.changed).toBe(0);
  });

  test('malformed structure date → blocking error for the whole file', () => {
    const db = S.newDb();
    const e = S.plant(db);
    S.plantStructure(db, e, '2026-9-1');
    const p = plan(db, parsePlant(prow(e.code, 'Y', 'N', 'Y')).rows);
    expect(p.ok).toBe(false);
    expect(p.blocking[0]).toMatch(/malformed effective_from/);
  });

  test('T17 (plan) duplicate date at latest → blocking; duplicate at forE → blocking; duplicate exactly at E → allowed', () => {
    const db = S.newDb();
    const a = S.plant(db); S.plantStructure(db, a, '2026-08-24'); S.plantStructure(db, a, '2026-08-24');
    expect(plan(db, parsePlant(prow(a.code, 'Y', 'N', 'Y')).rows).blocking[0]).toMatch(/latest/);

    const db2 = S.newDb();
    const b = S.plant(db2); S.plantStructure(db2, b, '2026-04-22'); S.plantStructure(db2, b, '2026-04-22'); S.plantStructure(db2, b, '2026-10-15');
    expect(plan(db2, parsePlant(prow(b.code, 'Y', 'N', 'Y')).rows).blocking[0]).toMatch(/in force at 2026-09-01/);

    const db3 = S.newDb();
    const c = S.plant(db3); S.plantStructure(db3, c, '2025-01-01'); S.plantStructure(db3, c, '2026-09-01'); S.plantStructure(db3, c, '2026-09-01');
    S.plantStructure(db3, c, '2026-10-15');
    expect(plan(db3, parsePlant(prow(c.code, 'Y', 'N', 'Y')).rows).ok).toBe(true);
  });

  test('unchanged row: master, forE and later rows already equal the file → not changed', () => {
    const db = S.newDb();
    const e = S.plant(db, { esi: 1, lwf: 1 });
    S.plantStructure(db, e, '2025-01-01', { esi: 1, lwf: 1 });
    const p = plan(db, parsePlant(prow(e.code, 'Y', 'N', 'Y')).rows);
    expect(p.rows[0]).toMatchObject({ flagChanged: false, changed: false });
  });

  test('a later row that differs still marks the employee changed', () => {
    const db = S.newDb();
    const e = S.plant(db, { esi: 1, lwf: 1 });
    S.plantStructure(db, e, '2025-01-01', { esi: 1, lwf: 1 });
    S.plantStructure(db, e, '2026-10-15', {});
    expect(plan(db, parsePlant(prow(e.code, 'Y', 'N', 'Y')).rows).rows[0].flagChanged).toBe(true);
  });

  test('warnings: ESI above ceiling, not Active, no pay row, PF without UAN', () => {
    const db = S.newDb();
    const e = S.plant(db, { gross_salary: 25000, status: 'Left' });
    S.plantStructure(db, e, '2025-01-01', { gross_salary: 25000 });
    const w = plan(db, parsePlant(prow(e.code, 'Y', 'Y', 'Y')).rows).rows[0].warnings.join('|');
    expect(w).toMatch(/above ₹21000/);
    expect(w).toMatch(/Status is 'Left'/);
    expect(w).toMatch(/No pay row for 2026-09/);
    expect(w).toMatch(/PF=Y without a UAN/);
  });

  test('sales: code+company matching; code in another company only → unmatched; ambiguous code → error', () => {
    const db = S.newDb();
    const a = S.salesEmp(db, { code: 'Z500', company: S.COMPANY });
    S.salesStructure(db, a, '2025-01');
    const rows = SF.parseFlagFile(xlsxBuf([SALES_HDR,
      ['Z500', S.COMPANY, 'X', 'Y', 'N', 'Y', '', '', ''],
      ['Z500', S.OTHER_COMPANY, 'X', 'Y', 'N', 'Y', '', '', ''],
    ]), 'sales').rows;
    const p = plan(db, rows, 'sales');
    expect(p.rows[0]).toMatchObject({ matched: true, error: null, changed: true });
    expect(p.rows[1].error).toMatch(/not in company/);
    // Ambiguous: the UNIQUE(code, company) constraint makes two exact rows impossible in the real schema,
    // so exercise the matcher directly.
    const fake = { prepare: () => ({ all: () => [{ id: 1, company: 'C' }, { id: 2, company: 'C' }] }) };
    expect(SF._internal.matchEmployee(fake, 'sales', { code: 'Z9', company: 'C' }).error).toMatch(/Ambiguous/);
  });

  test('bad effectiveMonth → blocking', () => {
    const db = S.newDb();
    expect(plan(db, [], 'plant', '2026-9').ok).toBe(false);
    expect(plan(db, [], 'plant', '2026-13').ok).toBe(false);
  });

  test('planning writes nothing', () => {
    const db = S.newDb();
    const e = S.plant(db);
    S.plantStructure(db, e, '2025-01-01');
    const before = S.counts(db);
    const snap = JSON.stringify([S.master(db, e), S.plantRows(db, e)]);
    plan(db, parsePlant(prow(e.code, 'Y', 'Y', 'Y', { uan: '100000000009' })).rows);
    expect(S.counts(db)).toEqual(before);
    expect(JSON.stringify([S.master(db, e), S.plantRows(db, e)])).toBe(snap);
  });
});

