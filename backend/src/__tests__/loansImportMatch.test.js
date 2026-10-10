/**
 * Loans PR-10 — name-to-code matching (services/loans/importMatch.js, K37).
 * Proposals only; the tiers and the pool rules.
 */
const F = require('./helpers/leaveFixture');
const M = require('../services/loans/importMatch');

const AL = 'Asian Lakto Ind Ltd';
const IND = 'Indriyan Beverages Pvt Ltd';
let db;
let n = 0;
const plant = (name, over = {}) => F.addEmployee(db, { code: `M${String(++n).padStart(4, '0')}`, name, company: AL, ...over });
const sales = (name, over = {}) => db.prepare("INSERT INTO sales_employees (code, name, company, status, doj, gross_salary) VALUES (?, ?, ?, ?, '2025-01-01', 20000)")
  .run(over.code || `S${String(++n).padStart(4, '0')}`, name, over.company || IND, over.status || 'Active');
const match = (name, company = AL, department = null) => M.matchRow(M.loadPool(db, company), { name, department });

beforeEach(() => { db = F.newDb(); });

describe('normaliser', () => {
  test.each([
    ['  ravi   kumar ', 'RAVI KUMAR'], ['R.K. Sharma', 'R K SHARMA'], ['Mr. Ravi Kumar', 'RAVI KUMAR'], ['Smt Sunita-Devi', 'SUNITA DEVI'],
    ['MR', 'MR'], ["D'Souza", 'D SOUZA'],
  ])('%s → %s', (a, b) => expect(M.normalizeImportName(a)).toBe(b));
});

describe('tiers', () => {
  test('exact: one Active person → pre-selected', () => {
    const e = plant('RAVI KUMAR');
    const m = match('Mr. Ravi  Kumar');
    expect(m.tier).toBe('exact');
    expect(m.selected).toMatchObject({ borrowerType: 'plant', code: e.code });
  });
  test('ambiguous: shared name, none pre-selected without a department', () => {
    plant('SUNIL', { department: 'PRODUCTION' }); plant('SUNIL', { department: 'STORE' });
    const m = match('Sunil');
    expect(m.tier).toBe('ambiguous');
    expect(m.candidates).toHaveLength(2);
    expect(m.selected).toBeNull();
  });
  test('ambiguous resolved by department → pre-selected "department"', () => {
    plant('SUNIL', { department: 'PRODUCTION' }); const s = plant('SUNIL', { department: 'STORE' });
    const m = match('Sunil', AL, 'store');
    expect(m.selected).toMatchObject({ code: s.code, by: 'department' });
  });
  test('ambiguous with the same department stays unselected', () => {
    plant('SUNIL', { department: 'STORE' }); plant('SUNIL', { department: 'STORE' });
    expect(match('Sunil', AL, 'Store').selected).toBeNull();
  });
  test('close: one-letter typo, swapped order, initials — never pre-selected', () => {
    const a = plant('MANPREET SINGH'); const b = plant('KUMAR RAJESH'); const c = plant('RAJ KUMAR SHARMA');
    const t1 = match('Manpret Singh');
    expect(t1.tier).toBe('close');
    expect(t1.selected).toBeNull();
    expect(t1.candidates[0]).toMatchObject({ code: a.code, reason: '1 letter different' });
    expect(match('Rajesh Kumar').candidates[0]).toMatchObject({ code: b.code, reason: 'same words, different order' });
    expect(match('R K Sharma').candidates[0]).toMatchObject({ code: c.code, reason: 'initials' });
  });
  test('close plant candidates must match the department when one is given', () => {
    plant('MANPREET SINGH', { department: 'STORE' });
    expect(match('Manpret Singh', AL, 'Production').tier).toBe('none');
    expect(match('Manpret Singh', AL, 'Store').tier).toBe('close');
  });
  test('a word missing ("SHUBHAM" ↔ "SHUBHAM KUMAR") is close spelling; a different surname is not', () => {
    expect(M.closeScore('SHUBHAM KUMAR', 'SHUBHAM')).toMatchObject({ reason: 'a word missing' });
    expect(M.nameCheck('Shubham Kumar', 'SHUBHAM').result).toBe('close');
    expect(M.nameCheck('Rohan Mehta', 'ROHAN KUMAR').result).toBe('mismatch');
    expect(M.nameCheck('Kiram Arora', 'KIRAN ARORA').result).toBe('close');
    expect(M.nameCheck('', 'ANYONE').result).toBe('same');
  });
  test('short names allow only one letter of difference', () => {
    plant('ANIL');
    expect(match('AMIT').tier).toBe('none');
    expect(match('ANIK').tier).toBe('close');
  });
  test('inactive: name only on a Left person → settle outside the app', () => {
    plant('OLD HAND', { status: 'Left' });
    const m = match('Old Hand');
    expect(m.tier).toBe('inactive');
    expect(m.candidates[0].status).toBe('Left');
  });
  test('none', () => expect(match('Nobody Here').tier).toBe('none'));
});

describe('pool rules', () => {
  test('plant: same company or company unknown; other known company excluded', () => {
    plant('A ONE', { company: null }); plant('A ONE', { company: 'Default' });
    plant('A ONE', { company: IND, employment_type: 'Permanent' });
    const m = match('A One', AL);
    expect(m.tier).toBe('ambiguous');
    expect(m.candidates.map((c) => c.company)).toEqual([null, null]);
  });
  test('a plant row typed Sales is never a candidate; the sales master is (same company only)', () => {
    plant('SALES REP', { company: IND, employment_type: 'Sales' });
    sales('SALES REP', { code: 'S9001' });
    sales('SALES REP', { code: 'S9002', company: AL });
    const m = match('Sales Rep', IND);
    expect(m.tier).toBe('exact');
    expect(m.selected).toMatchObject({ borrowerType: 'sales', code: 'S9001', company: IND });
  });
  test('levenshtein and initials helpers', () => {
    expect(M.levenshtein('KITTEN', 'SITTING')).toBe(3);
    expect(M.initialsMatch('R K SHARMA', 'RAJ KUMAR SHARMA')).toBe(true);
    expect(M.initialsMatch('R K VERMA', 'RAJ KUMAR SHARMA')).toBe(false);
  });
});
