const { calculateMonthlyTDS } = require('../services/tdsCalculation');

// No declaration on file. Since the March 2026 gate this means "we do not know
// this employee's regime or exemptions, so deduct nothing" — not "assume the new
// regime". The gate exists to stop a ghost deduction of about Rs 10,487 charged
// to one employee who had never filed a declaration.
const mockDb = {
  prepare: () => ({ get: () => null })
};

// A filed new-regime declaration. The three new-regime cases below predate the
// gate and used to run against mockDb, which is why they expected tax from an
// employee with nothing on file.
const declared = (over = {}) => ({
  prepare: () => ({
    get: () => ({
      regime: 'new',
      section_80c: 0,
      section_80d: 0,
      hra_exemption: 0,
      other_exemptions: 0,
      ...over
    })
  })
});

describe('TDS Calculation', () => {
  test('no declaration on file: no deduction, regime none', () => {
    const result = calculateMonthlyTDS(mockDb, 'EMP000', 300000, '2025-26');
    expect(result.monthly_tds).toBe(0);
    expect(result.annual_projected_tax).toBe(0);
    expect(result.regime).toBe('none');
    expect(result.effective_rate).toBe(0);
  });

  test('new regime: income below 7L should have zero TDS (rebate)', () => {
    // 50,000/month = 6L annual, minus 75K standard deduction = 5.25L taxable
    const result = calculateMonthlyTDS(declared(), 'EMP001', 50000, '2025-26');
    expect(result.monthly_tds).toBe(0);
    expect(result.regime).toBe('new');
  });

  test('new regime: income above 7L should have TDS', () => {
    // 80,000/month = 9.6L annual, minus 75K = 8.85L taxable
    const result = calculateMonthlyTDS(declared(), 'EMP002', 80000, '2025-26');
    expect(result.monthly_tds).toBeGreaterThan(0);
    expect(result.regime).toBe('new');
  });

  test('new regime: very high income', () => {
    // 3,00,000/month = 36L annual
    const result = calculateMonthlyTDS(declared(), 'EMP003', 300000, '2025-26');
    expect(result.monthly_tds).toBeGreaterThan(0);
    expect(result.annual_projected_tax).toBeGreaterThan(0);
    expect(result.effective_rate).toBeGreaterThan(0);
  });

  test('zero salary should have zero TDS', () => {
    const result = calculateMonthlyTDS(mockDb, 'EMP004', 0, '2025-26');
    expect(result.monthly_tds).toBe(0);
    expect(result.annual_projected_tax).toBe(0);
    expect(result.effective_rate).toBe(0);
  });

  test('zero salary with a declaration on file is still zero TDS', () => {
    const result = calculateMonthlyTDS(declared(), 'EMP004B', 0, '2025-26');
    expect(result.monthly_tds).toBe(0);
    expect(result.annual_projected_tax).toBe(0);
    expect(result.effective_rate).toBe(0);
  });

  test('old regime with declarations', () => {
    const dbWithDecl = {
      prepare: () => ({
        get: () => ({
          regime: 'old',
          section_80c: 150000,
          section_80d: 25000,
          hra_exemption: 100000,
          other_exemptions: 0
        })
      })
    };
    // 1,00,000/month = 12L annual
    const result = calculateMonthlyTDS(dbWithDecl, 'EMP005', 100000, '2025-26');
    expect(result.regime).toBe('old');
    // With deductions: 12L - 50K std - 1.5L 80C - 25K 80D - 1L HRA = 8.75L taxable
    expect(result.monthly_tds).toBeGreaterThan(0);
  });
});
