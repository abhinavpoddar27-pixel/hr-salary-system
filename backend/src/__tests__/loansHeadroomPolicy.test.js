/**
 * Loans PR-2 — headroom (pure) and policy reader (docs/loans/SPEC.md §4, D-11, D-12).
 */
const H = require('../services/loans/headroom');
const { readLoanPolicy, DEFAULTS } = require('../services/loans/policy');
const { F } = require('./helpers/loanFixture');

describe('headroom', () => {
  test('SPEC: EMI ₹5,000 against ₹3,000 of room deducts ₹3,000, shortfall ₹2,000', () => {
    expect(H.planLoanDeduction({ duePaise: 500000, headroomPaise: 300000 })).toEqual({ deductPaise: 300000, shortfallPaise: 200000, unbornePaise: 0, frozen: false });
  });
  test('room covers the EMI; no room; negative room', () => {
    expect(H.planLoanDeduction({ duePaise: 300000, headroomPaise: 900000 }).deductPaise).toBe(300000);
    expect(H.planLoanDeduction({ duePaise: 300000, headroomPaise: 0 })).toMatchObject({ deductPaise: 0, shortfallPaise: 300000 });
    expect(H.planLoanDeduction({ duePaise: 300000, headroomPaise: -5 })).toMatchObject({ deductPaise: 0, shortfallPaise: 300000 });
  });
  test('posted amount is frozen; the unborne part is reported (K2)', () => {
    expect(H.planLoanDeduction({ duePaise: 500000, headroomPaise: 100000, postedPaise: 300000 })).toEqual({ deductPaise: 300000, shortfallPaise: 0, unbornePaise: 200000, frozen: true });
    expect(H.planLoanDeduction({ duePaise: 500000, headroomPaise: 900000, postedPaise: 300000 }).unbornePaise).toBe(0);
  });
  test('computeHeadroom = floor(cap% × base) − prior, never below 0', () => {
    expect(H.computeHeadroom({ earnedBasePaise: 2000000, capPct: 50, priorDeductionsPaise: 400000 })).toBe(600000);
    expect(H.computeHeadroom({ earnedBasePaise: 2000001, capPct: 50, priorDeductionsPaise: 0 })).toBe(1000000);
    expect(H.computeHeadroom({ earnedBasePaise: 2000000, capPct: 50, priorDeductionsPaise: 1500000 })).toBe(0);
    expect(H.computeHeadroom({ earnedBasePaise: 0, capPct: 50, priorDeductionsPaise: 0 })).toBe(0);
  });
  test('earned base and prior deductions read one definition each', () => {
    const row = { gross_earned: 25000, ot_pay: 3000, holiday_duty_pay: 1000, pf_employee: 1800, esi_employee: 0, tds: 0,
      advance_recovery: 2000, late_coming_deduction: 500, early_exit_deduction: 250, other_deductions: 100, lop_deduction: 0,
      professional_tax: 0, loan_recovery: 9999 };
    // Plant gross_earned already excludes OT and holiday duty (salaryComputation.js),
    // so they are NOT subtracted again (Loans PR-5 fix of the PR-2 definition).
    expect(H.earnedBase(row, 'plant')).toBe(2500000);
    expect(H.priorDeductions(row, 'plant')).toBe(465000); // loan_recovery never counted
    expect(H.earnedBase({ gross_earned: 18000 }, 'sales')).toBe(1800000);
    expect(H.EARNED_BASE_DEFINITION.plant.minus).toEqual([]);
    expect(H.PRIOR_DEDUCTION_COMPONENTS.plant).not.toContain('loan_recovery');
    expect(() => H.earnedBase(row, 'x')).toThrow();
  });
});

describe('readLoanPolicy', () => {
  test('reads the 17 seeded keys with no warnings', () => {
    const db = F.newDb();
    const p = readLoanPolicy(db);
    expect(p.warnings).toEqual([]);
    expect(p).toMatchObject({
      closeDay: 13, deductionCapPct: 50, maxMultipleGross: 2, maxMultipleGrossEmergency: 3, maxTenureMonths: 12,
      minServiceMonths: 6, maxActivePerPerson: 1, emiCeilingPctGross: 30, deductionLoadWarningPct: 30, heldEmiWaitDays: 60,
      maxShortfallExtensionMonths: 3, agreementRequired: true, interestRate: 0, perquisiteThreshold: 20000, emiNetFlagPct: 30,
    });
    expect(p.eligibleEmploymentTypes).toEqual(['Permanent', 'SILP', 'Worker', 'Sales']);
    expect(p.loanTypes).toEqual(['Personal', 'Emergency / medical', 'Festival advance', 'Education']);
  });
  test('admin-edited values are honoured', () => {
    const db = F.newDb();
    F.setPolicy(db, 'loan_max_tenure_months', '18');
    F.setPolicy(db, 'loan_agreement_required', 'false');
    const p = readLoanPolicy(db);
    expect(p.maxTenureMonths).toBe(18);
    expect(p.agreementRequired).toBe(false);
  });
  test('bad, out-of-range or missing values fall back with a warning, never throw', () => {
    const db = F.newDb();
    F.setPolicy(db, 'loan_types', 'not json');
    F.setPolicy(db, 'loan_deduction_cap_pct', '150');
    F.setPolicy(db, 'loan_interest_rate', '12');
    db.prepare("DELETE FROM policy_config WHERE key = 'loan_close_day'").run();
    const p = readLoanPolicy(db);
    expect(p.loanTypes).toEqual([...DEFAULTS.loanTypes]);
    expect(p.deductionCapPct).toBe(50);
    expect(p.closeDay).toBe(13);
    expect(p.interestRate).toBe(0);
    expect(p.warnings).toHaveLength(4);
  });
});
