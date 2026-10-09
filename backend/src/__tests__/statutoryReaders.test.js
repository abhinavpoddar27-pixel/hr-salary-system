/**
 * Statutory flags PR-1 — L19 readers read the structure IN FORCE for the month.
 * R1 /statutory-crosscheck (was 500: no LEAST() in SQLite)
 * R2 red flags: no false "PF/ESI applicable but ₹0" on months before the upload;
 *    ESI above ₹21,000 is not flagged.
 */
const { startJwtApi } = require('./helpers/jwtApiHarness');
const S = require('./helpers/statutoryFixture');
const { detectRedFlags } = require('../services/financeRedFlags');

let api; let db;
beforeAll(() => {
  api = startJwtApi({ '/api/finance-audit': '../../routes/financeAudit' }, { users: [{ username: 'fin1', role: 'finance' }] });
  db = api.db;
});
afterAll(() => api.close());

const compliance = (month, year) => detectRedFlags(db, month, year).filter((f) => f.type === 'compliance_gap');

describe('R1 — /statutory-crosscheck', () => {
  test('200 (was 500); expected PF comes from the August in-force row, not the uploaded latest row', async () => {
    const e = S.plant(db, { code: 'R101', gross_salary: 20000 });
    S.plantStructure(db, e, '2025-01-01', { gross_salary: 20000, basic: 10000, da: 2000, hra: 4000, conveyance: 0, other_allowances: 4000 });
    S.plantMonth(db, e, 8, 2026);
    S.computePlant(db, e, 8, 2026);
    expect(S.applyFile(db, 'plant', S.plantFile(S.prow('R101', 0, 1, 1))).ok).toBe(true);

    const aug = await api.request('GET', '/api/finance-audit/statutory-crosscheck?month=8&year=2026', { as: 'fin1' });
    expect(aug.status).toBe(200);
    expect(aug.body.data.pf).toMatchObject({ employeeTotal: 0, expectedEmployeeTotal: 0, match: true });

    S.plantMonth(db, e, 9, 2026);
    S.computePlant(db, e, 9, 2026);
    const sep = await api.request('GET', '/api/finance-audit/statutory-crosscheck?month=9&year=2026', { as: 'fin1' });
    expect(sep.status).toBe(200);
    expect(sep.body.data.pf.expectedEmployeeTotal).toBe(1440); // 12% × min(10000+2000, 15000)
    expect(sep.body.data.pf.employeeTotal).toBeGreaterThan(0);
  });
});

describe('R2 — compliance_gap red flag', () => {
  test('August after the upload → no "applicable but ₹0"; September with ESI computed → none either', () => {
    const e = S.plant(db, { code: 'R201', gross_salary: 15000 });
    S.plantStructure(db, e, '2025-01-01', { gross_salary: 15000 });
    S.plantMonth(db, e, 8, 2026);
    S.computePlant(db, e, 8, 2026);
    expect(S.applyFile(db, 'plant', S.plantFile(S.prow('R201', 1, 1, 1))).ok).toBe(true);
    expect(compliance(8, 2026).filter((f) => f.employeeCode === 'R201')).toEqual([]);
    S.plantMonth(db, e, 9, 2026);
    S.computePlant(db, e, 9, 2026);
    expect(compliance(9, 2026).filter((f) => f.employeeCode === 'R201')).toEqual([]);
  });

  test('September flagged ON but the salary row predates the upload (₹0) → flagged; ESI above ₹21,000 → not flagged', () => {
    const a = S.plant(db, { code: 'R202', gross_salary: 15000 });
    S.plantStructure(db, a, '2025-01-01', { gross_salary: 15000 });
    const b = S.plant(db, { code: 'R203', gross_salary: 25000 });
    S.plantStructure(db, b, '2025-01-01', { gross_salary: 25000 });
    S.plantMonth(db, a, 9, 2026); S.plantMonth(db, b, 9, 2026);
    S.computePlant(db, a, 9, 2026); S.computePlant(db, b, 9, 2026); // computed before the upload → ₹0
    expect(S.applyFile(db, 'plant', S.plantFile(S.prow('R202', 1, 0, 1), S.prow('R203', 1, 0, 1))).ok).toBe(true);
    const sep = compliance(9, 2026);
    expect(sep.filter((f) => f.employeeCode === 'R202')).toHaveLength(1);
    expect(sep.filter((f) => f.employeeCode === 'R203')).toEqual([]);
  });
});
