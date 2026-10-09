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


// ════════════════════════════ STEP 4 — apply + undo ════════════════════════════

const apply = (db, buf, scope = 'plant', month = '2026-09') => S.applyFile(db, scope, buf, month);
const rowAt = (rows, d) => rows.filter((r) => r.effective_from === d);
const SALARY_COLS_EQ = (a, b) => expect(a).toEqual(b);

describe('T1 — single 2025-01-01 row', () => {
  test('apply Sep → a 2026-09-01 row identical except flags; Aug old flags, Sep/Oct new', () => {
    const db = S.newDb();
    const e = S.plant(db);
    S.plantStructure(db, e, '2025-01-01', { gross_salary: 15000, basic: 7000, da: 500, hra: 3000, conveyance: 1200, other_allowances: 3300 });
    const r = apply(db, S.plantFile(S.prow(e.code, 1, 1, 1)));
    expect(r.ok).toBe(true);
    const rows = S.plantRows(db, e);
    // freeze row at S too: no row was dated <= 2000-01-01 (see T14)
    expect(rows.map((x) => x.effective_from)).toEqual(['2000-01-01', '2025-01-01', '2026-09-01']);
    const [frz, old, neu] = rows;
    expect(S.flags(frz)).toEqual({ pf: 0, esi: 0, lwf: 0 });
    const strip = (x) => { const { id, effective_from, created_at, updated_at, pf_applicable, esi_applicable, lwf_applicable, ...rest } = x; return rest; };
    expect(strip(neu)).toEqual(strip(old));
    expect(S.flags(old)).toEqual({ pf: 0, esi: 0, lwf: 0 });
    expect(S.flags(neu)).toEqual({ pf: 1, esi: 1, lwf: 1 });
    expect(SF.carryFlags(db, 'plant', e.id, '2026-08-01')).toEqual({ pf: 0, esi: 0, lwf: 0 });
    expect(SF.carryFlags(db, 'plant', e.id, '2026-09-01')).toEqual({ pf: 1, esi: 1, lwf: 1 });
    expect(SF.carryFlags(db, 'plant', e.id, '2026-10-01')).toEqual({ pf: 1, esi: 1, lwf: 1 });
    expect(S.flags(S.master(db, e))).toEqual({ pf: 1, esi: 1, lwf: 1 });
  });
});

describe('T14 / freeze rule', () => {
  test('a row already <= S (2000-01-01) → no freeze row', () => {
    const db = S.newDb();
    const e = S.plant(db);
    S.plantStructure(db, e, '1946-06-01');
    apply(db, S.plantFile(S.prow(e.code, 1, 0, 1)));
    expect(S.plantRows(db, e).map((x) => x.effective_from)).toEqual(['1946-06-01', '2026-09-01']);
  });

  test('a 2025-01-01 row (not <= S) → in-effect rows earlier than E stay served by themselves; freeze row added at S', () => {
    const db = S.newDb();
    const e = S.plant(db);
    S.plantStructure(db, e, '2025-01-01');
    apply(db, S.plantFile(S.prow(e.code, 1, 0, 1)));
    // freeze is added because no row <= 2000-01-01 existed
    const rows = S.plantRows(db, e).map((x) => x.effective_from);
    expect(rows).toEqual(['2000-01-01', '2025-01-01', '2026-09-01']);
  });
});

describe('T2 — exact E rows updated in place, later rows too', () => {
  test('two 2026-09-01 rows + a 2026-10-15 row', () => {
    const db = S.newDb();
    const e = S.plant(db);
    S.plantStructure(db, e, '2025-01-01');
    S.plantStructure(db, e, '2026-09-01');
    S.plantStructure(db, e, '2026-09-01');
    S.plantStructure(db, e, '2026-10-15');
    const r = apply(db, S.plantFile(S.prow(e.code, 1, 0, 1)));
    expect(r.ok).toBe(true);
    const rows = S.plantRows(db, e);
    expect(rowAt(rows, '2026-09-01').map(S.flags)).toEqual([{ pf: 0, esi: 1, lwf: 1 }, { pf: 0, esi: 1, lwf: 1 }]);
    expect(S.flags(rowAt(rows, '2026-10-15')[0])).toEqual({ pf: 0, esi: 1, lwf: 1 });
    expect(S.flags(rowAt(rows, '2025-01-01')[0])).toEqual({ pf: 0, esi: 0, lwf: 0 });
    expect(r.summary.counts).toMatchObject({ rowsUpdatedAtE: 2, laterRowsUpdated: 1, effectiveRows: 0 });
  });
});

describe('T3 — fallback months recompute identically', () => {
  for (const only of ['2026-08-24', '2026-09-06']) {
    test(`only a ${only} row + an August pay row → August byte-identical, September carries flags`, () => {
      const db = S.newDb();
      const e = S.plant(db, { gross_salary: 15000 });
      S.plantStructure(db, e, only, { gross_salary: 15000, basic: 7500, hra: 3000, conveyance: 0, other_allowances: 4500 });
      S.plantMonth(db, e, 8, 2026);
      S.plantMonth(db, e, 9, 2026);
      const augBefore = S.computePlant(db, e, 8, 2026);
      expect(augBefore.esi_employee).toBe(0);
      apply(db, S.plantFile(S.prow(e.code, 1, 1, 1)));
      const augAfter = S.computePlant(db, e, 8, 2026);
      SALARY_COLS_EQ(augAfter, augBefore);
      const sep = S.computePlant(db, e, 9, 2026);
      expect(sep.esi_employee).toBeGreaterThan(0);
      expect(sep.pf_employee).toBeGreaterThan(0);
      expect(Math.abs(sep.net_salary - (sep.gross_earned - sep.total_deductions))).toBeLessThanOrEqual(1);
      // freeze row exists with the old flags, a copy of the only row
      const rows = S.plantRows(db, e);
      expect(S.flags(rowAt(rows, '2000-01-01')[0])).toEqual({ pf: 0, esi: 0, lwf: 0 });
    });
  }
});

describe('T4 — copy at E comes from the April row, the 09-06 row keeps serving October', () => {
  test('rows 2026-04-22 + 2026-09-06', () => {
    const db = S.newDb();
    const e = S.plant(db);
    S.plantStructure(db, e, '2026-04-22', { basic: 7001 });
    S.plantStructure(db, e, '2026-09-06', { basic: 7002 });
    apply(db, S.plantFile(S.prow(e.code, 1, 0, 1)));
    const rows = S.plantRows(db, e);
    expect(rows.map((x) => x.effective_from)).toEqual(['2000-01-01', '2026-04-22', '2026-09-01', '2026-09-06']);
    expect(rowAt(rows, '2026-09-01')[0].basic).toBe(7001);
    expect(rowAt(rows, '2000-01-01')[0].basic).toBe(7002); // freeze = copy of latest (the fallback row)
    expect(SF.structureForDate(db, 'plant', e.id, '2026-09-01').basic).toBe(7001);
    expect(SF.structureForDate(db, 'plant', e.id, '2026-10-01').basic).toBe(7002);
    expect(SF.carryFlags(db, 'plant', e.id, '2026-09-01')).toEqual({ pf: 0, esi: 1, lwf: 1 });
    expect(SF.carryFlags(db, 'plant', e.id, '2026-10-01')).toEqual({ pf: 0, esi: 1, lwf: 1 });
    expect(SF.carryFlags(db, 'plant', e.id, '2026-03-01')).toEqual({ pf: 0, esi: 0, lwf: 0 }); // fallback → freeze
    expect(SF.structureForDate(db, 'plant', e.id, '2026-03-01').basic).toBe(7002);           // same components as before
  });
});

describe('T5 — sales', () => {
  test('exact 2026-09 row updated in place; otherwise copy with effective_to NULL; fallback-served April recomputes identically', () => {
    const db = S.newDb();
    const a = S.salesEmp(db, { code: 'Z101' });
    S.salesStructure(db, a, '2026-09', {});
    const b = S.salesEmp(db, { code: 'Z102', gross_salary: 18000 });
    S.salesStructure(db, b, '2026-05', { effective_to: '2026-08' });   // closed row: April is served by fallback
    const aprBefore = S.computeSales(db, b, 4, 2026);
    const r = apply(db, S.salesFile(S.srow('Z101', S.COMPANY, 1, 0, 1), S.srow('Z102', S.COMPANY, 1, 0, 1)), 'sales');
    expect(r.ok).toBe(true);
    const ra = S.salesRows(db, a);
    expect(ra.map((x) => x.effective_from)).toEqual(['2000-01', '2026-09']);
    expect(S.flags(rowAt(ra, '2026-09')[0])).toEqual({ pf: 0, esi: 1, lwf: 1 });
    const rb = S.salesRows(db, b);
    expect(rb.map((x) => x.effective_from)).toEqual(['2000-01', '2026-05', '2026-09']);
    expect(rowAt(rb, '2026-09')[0].effective_to).toBeNull();
    expect(rowAt(rb, '2000-01')[0].effective_to).toBeNull();
    expect(rowAt(rb, '2026-05')[0].effective_to).toBe('2026-08');
    expect(S.computeSales(db, b, 4, 2026)).toEqual(aprBefore);
    const sep = S.computeSales(db, b, 9, 2026);
    expect(sep.esi_employee).toBeGreaterThan(0);
    expect(S.flags(S.salesMaster(db, b))).toEqual({ pf: 0, esi: 1, lwf: 1 });
  });

  test('sales numbers written to the master', () => {
    const db = S.newDb();
    const a = S.salesEmp(db, { code: 'Z103' });
    S.salesStructure(db, a, '2025-01');
    apply(db, S.salesFile(S.srow('Z103', S.COMPANY, 1, 0, 1, { esi_number: '2000000001', uan: '200000000001' })), 'sales');
    expect(S.salesMaster(db, a)).toMatchObject({ esi_number: '2000000001', uan: '200000000001' });
  });
});

describe('T16 — S157 shape (closed row + later open row)', () => {
  test('2026-01 closed 2026-09 + 2026-10 open → E copy from the 2026-01 row with effective_to NULL; 2026-10 updated', () => {
    const db = S.newDb();
    const e = S.salesEmp(db, { code: 'Z157' });
    S.salesStructure(db, e, '2026-01', { effective_to: '2026-09', basic: 9001 });
    S.salesStructure(db, e, '2026-10', { basic: 9002 });
    apply(db, S.salesFile(S.srow('Z157', S.COMPANY, 1, 0, 1)), 'sales');
    const rows = S.salesRows(db, e);
    expect(rows.map((x) => x.effective_from)).toEqual(['2000-01', '2026-01', '2026-09', '2026-10']);
    const e9 = rowAt(rows, '2026-09')[0];
    expect(e9).toMatchObject({ basic: 9001, effective_to: null, esi_applicable: 1, lwf_applicable: 1 });
    expect(S.flags(rowAt(rows, '2026-10')[0])).toEqual({ pf: 0, esi: 1, lwf: 1 });
    expect(rowAt(rows, '2000-01')[0]).toMatchObject({ basic: 9002, esi_applicable: 0 }); // freeze = latest
  });
});

describe('T6 — re-apply, hash, malformed date', () => {
  test('second apply of the same file → 409 duplicate; a different file with the same content → 0 changes, 0 inserts', () => {
    const db = S.newDb();
    const e = S.plant(db);
    S.plantStructure(db, e, '2025-01-01');
    const buf = S.plantFile(S.prow(e.code, 1, 0, 1, { uan: '300000000001' }));
    expect(apply(db, buf).ok).toBe(true);
    const counts = S.counts(db);
    const again = apply(db, buf);
    expect(again).toMatchObject({ ok: false, status: 409, code: 'DUPLICATE_BATCH' });
    // same rows, different bytes (a note) → a new batch that changes nothing
    const buf2 = S.xlsxBuf([S.PLANT_HDR, [e.code, 'SYNTH', 'Worker', 'Y', 'N', 'Y', '', '300000000001', 'second']]);
    const r2 = apply(db, buf2);
    expect(r2.ok).toBe(true);
    expect(r2.summary.counts).toMatchObject({ employees: 0, freezeRows: 0, effectiveRows: 0 });
    expect(S.counts(db)).toEqual(counts);
  });

  test('expectedSha256 differs → 409 HASH_MISMATCH, nothing written', () => {
    const db = S.newDb();
    const e = S.plant(db);
    S.plantStructure(db, e, '2025-01-01');
    const buf = S.plantFile(S.prow(e.code, 1, 0, 1));
    const parsed = SF.parseFlagFile(buf, 'plant');
    const before = S.counts(db);
    const r = SF.applyFlagChanges(db, { scope: 'plant', effectiveMonth: '2026-09', rows: parsed.rows, user: 'x', sha256: SF.sha256(buf), expectedSha256: 'deadbeef' });
    expect(r).toMatchObject({ ok: false, status: 409, code: 'HASH_MISMATCH' });
    expect(S.counts(db)).toEqual(before);
    expect(db.prepare('SELECT COUNT(*) c FROM statutory_flag_batches').get().c).toBe(0);
  });

  test('malformed structure date → blocking, row counts in all 4 tables unchanged, no batch row left', () => {
    const db = S.newDb();
    const ok = S.plant(db); S.plantStructure(db, ok, '2025-01-01');
    const bad = S.plant(db); S.plantStructure(db, bad, '01-09-2026');
    const before = S.counts(db);
    const snap = JSON.stringify([S.master(db, ok), S.plantRows(db, ok)]);
    const r = apply(db, S.plantFile(S.prow(ok.code, 1, 0, 1), S.prow(bad.code, 1, 0, 1)));
    expect(r).toMatchObject({ ok: false, status: 400, code: 'BLOCKED' });
    expect(S.counts(db)).toEqual(before);
    expect(JSON.stringify([S.master(db, ok), S.plantRows(db, ok)])).toBe(snap);
    expect(db.prepare('SELECT COUNT(*) c FROM statutory_flag_batches').get().c).toBe(0);
  });
});

describe('T17 — duplicate date at latest → blocking error', () => {
  test('nothing written', () => {
    const db = S.newDb();
    const e = S.plant(db);
    S.plantStructure(db, e, '2026-08-24'); S.plantStructure(db, e, '2026-08-24');
    const before = S.counts(db);
    expect(apply(db, S.plantFile(S.prow(e.code, 1, 0, 1)))).toMatchObject({ ok: false, code: 'BLOCKED' });
    expect(S.counts(db)).toEqual(before);
  });
});

describe('row errors do not block the rest', () => {
  test('unmatched + no-structure rows skipped; others applied', () => {
    const db = S.newDb();
    const a = S.plant(db); S.plantStructure(db, a, '2025-01-01');
    const nos = S.plant(db);
    const r = apply(db, S.plantFile(S.prow(a.code, 1, 0, 1), S.prow('NOPE9', 1, 0, 1), S.prow(nos.code, 1, 1, 1)));
    expect(r.ok).toBe(true);
    expect(r.summary.counts.employees).toBe(1);
    expect(S.flags(S.master(db, nos))).toEqual({ pf: 0, esi: 0, lwf: 0 });
    expect(S.plantRows(db, nos)).toEqual([]);
  });

  test('a master-only difference never touches structures', () => {
    const db = S.newDb();
    const e = S.plant(db); // master 0/0/0
    S.plantStructure(db, e, '2025-01-01', { esi: 1, lwf: 1 });
    const r = apply(db, S.plantFile(S.prow(e.code, 1, 0, 1)));
    expect(r.summary.counts).toMatchObject({ employees: 1, freezeRows: 0, effectiveRows: 0 });
    expect(S.plantRows(db, e).length).toBe(1);
    expect(S.flags(S.master(db, e))).toEqual({ pf: 0, esi: 1, lwf: 1 });
  });
});

describe('audit + batch rows', () => {
  test('audit on the passed handle: one per changed field + one per inserted row; batch applied with summary + undo', () => {
    const db = S.newDb();
    const e = S.plant(db);
    S.plantStructure(db, e, '2025-01-01');
    const r = apply(db, S.plantFile(S.prow(e.code, 1, 0, 1, { esi_number: '4000000001' })));
    const audit = db.prepare("SELECT * FROM audit_log WHERE stage = 'statutory_upload' ORDER BY id").all();
    expect(audit.every((a) => a.remark === `batch:${r.batchId}` && a.changed_by === 'boss' && a.employee_code === e.code)).toBe(true);
    const kinds = audit.map((a) => `${a.table_name}:${a.field_name}:${a.action_type}`);
    expect(kinds).toEqual([
      'salary_structures:structure_row:statutory_freeze_row',
      'salary_structures:structure_row:statutory_effective_row',
      'employees:esi_applicable:statutory_flag_change',
      'employees:lwf_applicable:statutory_flag_change',
      'employees:esi_number:statutory_number_change',
    ]);
    const b = db.prepare('SELECT * FROM statutory_flag_batches WHERE id = ?').get(r.batchId);
    expect(b).toMatchObject({ status: 'applied', scope: 'plant', effective_month: '2026-09', changed_count: 1, row_count: 1 });
    expect(JSON.parse(b.undo_json).rows[0]).toMatchObject({ code: e.code, beforeE: { esi: 0, pf: 0, lwf: 0 } });
  });
});

describe('T10a — undo workbook', () => {
  test('re-applying the undo file restores the original flags from E on; freeze/E rows remain; earlier months unchanged', () => {
    const db = S.newDb();
    const e = S.plant(db, { gross_salary: 15000 });
    S.plantStructure(db, e, '2026-08-24', { gross_salary: 15000 });
    S.plantStructure(db, e, '2026-10-15', { gross_salary: 15000 });
    S.plantMonth(db, e, 8, 2026);
    const aug0 = S.computePlant(db, e, 8, 2026);
    const r = apply(db, S.plantFile(S.prow(e.code, 1, 1, 1, { uan: '500000000001' })));
    const u = SF.buildUndoWorkbook(db, r.batchId);
    expect(u.ok).toBe(true);
    expect(u.fileName).toMatch(/undo_plant_2026-09_batch/);
    const parsed = SF.parseFlagFile(u.buffer, 'plant');
    expect(parsed.ok).toBe(true);
    expect(parsed.rows[0]).toMatchObject({ code: e.code, esi: 0, pf: 0, lwf: 0, uan: '' });
    const ru = S.applyFile(db, 'plant', u.buffer);
    expect(ru.ok).toBe(true);
    const rows = S.plantRows(db, e);
    expect(rows.map((x) => x.effective_from)).toEqual(['2000-01-01', '2026-08-24', '2026-09-01', '2026-10-15']);
    expect(rows.map(S.flags).every((f) => f.pf === 0 && f.esi === 0 && f.lwf === 0)).toBe(true);
    expect(S.flags(S.master(db, e))).toEqual({ pf: 0, esi: 0, lwf: 0 });
    expect(S.master(db, e).uan).toBe('500000000001'); // blank = unchanged
    expect(S.computePlant(db, e, 8, 2026)).toEqual(aug0);
  });

  test('undo of a missing / non-applied batch → error', () => {
    const db = S.newDb();
    expect(SF.buildUndoWorkbook(db, 99)).toMatchObject({ ok: false, status: 404 });
  });
});
