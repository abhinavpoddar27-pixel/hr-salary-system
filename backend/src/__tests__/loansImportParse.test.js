/**
 * Loans PR-10 — accounts-Excel parsing (services/loans/importParse.js):
 * template, header detection, column mapping, Indian dates (day first; an
 * unreadable date makes the row invalid — never guessed), money, companies.
 */
const XLSX = require('xlsx');
const P = require('../services/loans/importParse');

const TYPES = ['Personal', 'Emergency / medical', 'Festival advance', 'Education'];
const book = (aoa, sheet = 'Sheet1') => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), sheet);
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
};
const parse = (aoa, opts = {}) => P.parseWorkbook(book(aoa), { loanTypes: TYPES, today: '2026-10-10', ...opts });
const codes = (r) => r.errors.map((e) => e.code);

describe('template', () => {
  test('round-trips through the parser with zero mapping edits', () => {
    const wb = XLSX.read(P.buildTemplate(), { type: 'buffer' });
    expect(wb.SheetNames).toEqual(['Loans', 'Read me']);
    const aoa = XLSX.utils.sheet_to_json(wb.Sheets.Loans, { header: 1 });
    expect(aoa[0]).toEqual(P.TEMPLATE_HEADERS);
    aoa.push(['', 'Ravi Kumar', 'Asian Lakto Ind Ltd', 'Production', '03-04-2026', 20000, 12000, 2000, 'Personal', 'AG-1', 'n']);
    const p = parse(aoa);
    expect(p.ok).toBe(true);
    expect(Object.keys(p.mapping).sort()).toEqual(P.FIELDS.map((f) => f.key).sort());
    expect(p.rows[0]).toMatchObject({ name: 'Ravi Kumar', company: 'Asian Lakto Ind Ltd', loanDate: '2026-04-03', outstandingPaise: 1200000, emiPaise: 200000, originalPrincipalPaise: 2000000, errors: [] });
  });
});

describe('header detection and mapping', () => {
  test('header below a title row; accounts-style synonyms', () => {
    const p = parse([['Staff loans as on 30-09-2026'], [], ['S.No', 'Emp Name', 'Firm', 'Balance', 'EMI', 'Remarks'], [1, 'A B', 'Asian Lakto', '5,000', '1,000', 'x']]);
    expect(p.ok).toBe(true);
    expect(p.headerRow).toBe(3);
    expect(p.mapping).toMatchObject({ name: 1, company: 2, outstanding: 3, emi: 4, notes: 5 });
    expect(p.rows[0]).toMatchObject({ rowNo: 4, outstandingPaise: 500000, emiPaise: 100000 });
  });
  test('missing required field → MAPPING_INVALID with the headers for the mapping step', () => {
    const p = parse([['Name', 'Company', 'Something'], ['A', 'Asian', 5]]);
    expect(p.ok).toBe(false);
    expect(p.code).toBe('MAPPING_INVALID');
    expect(p.headers.map((h) => h.text)).toEqual(['Name', 'Company', 'Something']);
  });
  test('a custom mapping wins; no company column needs a default company', () => {
    const aoa = [['Who', 'Owed', 'Monthly cut', 'X'], ['A K', 4000, 1000, null]];
    expect(parse(aoa, { mapping: { name: 0, outstanding: 1, emi: 2 } }).code).toBe('MAPPING_INVALID');
    const p = parse(aoa, { mapping: { name: 0, outstanding: 1, emi: 2 }, defaultCompany: 'Indriyan Beverages Pvt Ltd' });
    expect(p.ok).toBe(true);
    expect(p.rows[0].company).toBe('Indriyan Beverages Pvt Ltd');
  });
  test('two fields on one column are refused', () => {
    expect(P.validateMapping({ name: 0, outstanding: 1, emi: 1, company: 2 }, [0, 1, 2].map((i) => ({ index: i, text: `h${i}` }))).ok).toBe(false);
  });
});

describe('Indian dates (never guessed)', () => {
  test.each([
    ['03/04/2026', '2026-04-03'], ['03-04-2026', '2026-04-03'], ['3.4.2026', '2026-04-03'], ['2026-04-03', '2026-04-03'],
    ['13/02/2026', '2026-02-13'], ['3-Apr-2026', '2026-04-03'], ['3 April 2026', '2026-04-03'],
  ])('%s → %s', (v, iso) => expect(P.parseIndianDate(v)).toEqual({ ok: true, value: iso }));
  test.each([['02/13/2026'], ['03/04/26'], ['31/02/2026'], ['April 3'], ['yesterday'], ['2026/04/03']])('%s → unreadable', (v) => {
    expect(P.parseIndianDate(v).ok).toBe(false);
  });
  test('an Excel date serial is exact; blank is null', () => {
    expect(P.parseIndianDate(46115)).toEqual({ ok: true, value: '2026-04-03' });
    expect(P.parseIndianDate('')).toEqual({ ok: true, value: null });
  });
  test('an unreadable or future loan date makes the row invalid', () => {
    const p = parse([['Name', 'Company', 'Loan date', 'Outstanding', 'EMI'], ['A', 'Asian', '02/13/2026', 100, 10], ['B', 'Asian', '01-01-2027', 100, 10]]);
    expect(codes(p.rows[0])).toEqual(['LOAN_DATE_INVALID']);
    expect(codes(p.rows[1])).toEqual(['LOAN_DATE_IN_FUTURE']);
  });
});

describe('row validation', () => {
  const H = ['Name', 'Company', 'Outstanding', 'EMI', 'Loan type'];
  test('money: ₹ and commas; paise EMI and bad amounts are invalid (amount errors are finance-fixable)', () => {
    const p = parse([H, ['A', 'Asian', '₹ 12,000.50', 'Rs 1,000', ''], ['B', 'Asian', 5000, 999.5, ''], ['C', 'Asian', 'abc', 0, ''], ['', 'Asian', 1, 1, '']]);
    expect(p.rows[0]).toMatchObject({ outstandingPaise: 1200050, emiPaise: 100000, errors: [] });
    expect(codes(p.rows[1])).toEqual(['EMI_NOT_WHOLE_RUPEE']);
    expect(p.rows[1].amountFixable).toBe(true);
    expect(codes(p.rows[2])).toEqual(['OUTSTANDING_INVALID', 'EMI_MISSING']);
    expect(codes(p.rows[3])).toEqual(['NAME_MISSING']);
    expect(p.rows[3].amountFixable).toBe(false);
  });
  test('company aliases; anything else is invalid', () => {
    expect(P.normaliseCompany('ASIAN LACKTO')).toBe('Asian Lakto Ind Ltd');
    expect(P.normaliseCompany('Indriyan Bev.')).toBe('Indriyan Beverages Pvt Ltd');
    expect(P.normaliseCompany('asian lakto ind ltd')).toBe('Asian Lakto Ind Ltd');
    const p = parse([H, ['A', 'Contractor Co', 100, 10, '']]);
    expect(codes(p.rows[0])).toEqual(['COMPANY_INVALID']);
  });
  test('loan type mapped; blank / unknown → Personal with a warning', () => {
    const p = parse([H, ['A', 'Asian', 100, 10, 'medical'], ['B', 'Asian', 100, 10, ''], ['C', 'Asian', 100, 10, 'Vehicle']]);
    expect(p.rows.map((r) => r.loanType)).toEqual(['Emergency / medical', 'Personal', 'Personal']);
    expect(p.rows[1].warnings.map((w) => w.code)).toEqual(['LOAN_TYPE_DEFAULTED']);
    expect(p.rows[2].loanTypeOriginal).toBe('Vehicle');
  });
  test('blank lines and TOTAL rows are skipped', () => {
    const p = parse([H, ['A', 'Asian', 100, 10, ''], [null, null, null, null, null], ['TOTAL', null, 100, 10, ''], ['Grand Total', null, 1, 1, '']]);
    expect(p.rows).toHaveLength(1);
    expect(p.skipped.map((s) => s.reason)).toEqual(['total row', 'total row']);
  });
  test('an unreadable file is refused', () => {
    expect(P.parseWorkbook(Buffer.from('not a workbook at all'), { loanTypes: TYPES }).ok).toBe(false);
  });
});
