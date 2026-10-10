/**
 * Statutory flags PR-3 — ESI numbers / UANs.
 *   F12  the rules the sales master uses are the very regexes / holder lookup the
 *        statutory upload (planFlagChanges) uses — exported, not copied.
 * Synthetic codes and numbers only.
 */
const S = require('./helpers/statutoryFixture');
const SF = require('../services/statutoryFlags');

// Every sample is judged by the exported regex AND by the upload planner; both must agree.
const SAMPLES = {
  esi_number: ['1000000001', '100000000', '10000000011', '10000 00002', ' 1000000003 ', 'ABCDEFGHIJ', '١٢٣٤٥٦٧٨٩٠', '10000-00004'],
  uan: ['100000000001', '10000000001', '1000000000011', '1000 0000 0002', 'UAN100000003', '١٠٠٠٠٠٠٠٠٠٠٤'],
};

describe('F12 — the exported rules are the upload planner rules', () => {
  test('ESI_NUMBER_RE = 10 ASCII digits, UAN_RE = 12 ASCII digits; numberInUse exported', () => {
    expect(SF.ESI_NUMBER_RE).toBeInstanceOf(RegExp);
    expect(SF.UAN_RE).toBeInstanceOf(RegExp);
    expect(SF.ESI_NUMBER_RE.source).toBe('^\\d{10}$');
    expect(SF.UAN_RE.source).toBe('^\\d{12}$');
    expect(typeof SF.numberInUse).toBe('function');
  });

  for (const [col, re, label] of [['esi_number', 'ESI_NUMBER_RE', 'Malformed ESI number'], ['uan', 'UAN_RE', 'Malformed UAN']]) {
    test(`${col}: planFlagChanges calls a value malformed exactly when ${re} rejects it (spaces stripped)`, () => {
      const db = S.newDb();
      const verdicts = [];
      for (const v of SAMPLES[col]) {
        const e = S.plant(db, {});
        S.plantStructure(db, e, '2025-01-01', {});
        const rows = SF.parseFlagFile(S.plantFile(S.prow(e.code, 0, 0, 0, { [col]: v })), 'plant').rows;
        const p = SF.planFlagChanges(db, { scope: 'plant', effectiveMonth: '2026-09', rows }).rows[0];
        const planner = p.warnings.some((w) => w.startsWith(label));
        const exported = !SF[re].test(v.replace(/\s+/g, ''));
        verdicts.push([v, planner, exported]);
        // a value the planner accepts is the value the master would store
        if (!planner) expect(p.numbers[col]).toBe(v.replace(/\s+/g, ''));
      }
      for (const [v, planner, exported] of verdicts) expect({ v, malformed: planner }).toEqual({ v, malformed: exported });
      expect(verdicts.some(([, p]) => p)).toBe(true);    // both kinds present
      expect(verdicts.some(([, p]) => !p)).toBe(true);
      db.close();
    });
  }

  test('numberInUse: the holder code within the same master, never the employee itself', () => {
    const db = S.newDb();
    const a = S.salesEmp(db, { esi_number: '1000000101', uan: '100000000101' });
    const b = S.salesEmp(db, {});
    const c = S.salesEmp(db, { company: S.OTHER_COMPANY });
    expect(SF.numberInUse(db, 'sales', 'esi_number', '1000000101', b.id)).toBe(a.code);
    expect(SF.numberInUse(db, 'sales', 'uan', '100000000101', c.id)).toBe(a.code);   // N3: across sales companies
    expect(SF.numberInUse(db, 'sales', 'esi_number', '1000000101', a.id)).toBeNull();
    expect(SF.numberInUse(db, 'sales', 'esi_number', '1000000102', -1)).toBeNull();
    expect(SF.numberInUse(db, 'plant', 'esi_number', '1000000101', -1)).toBeNull();   // plant master is a different master
    db.close();
  });
});
