/**
 * TDS Auto-Calculation Service
 * Indian income tax slabs for FY 2025-26
 */

// New regime slabs (FY 2025-26)
const NEW_REGIME_SLABS = [
  { limit: 400000, rate: 0 },
  { limit: 800000, rate: 0.05 },
  { limit: 1200000, rate: 0.10 },
  { limit: 1600000, rate: 0.15 },
  { limit: 2000000, rate: 0.20 },
  { limit: 2400000, rate: 0.25 },
  { limit: Infinity, rate: 0.30 }
];
const NEW_REGIME_STANDARD_DEDUCTION = 75000;

// Old regime slabs
const OLD_REGIME_SLABS = [
  { limit: 250000, rate: 0 },
  { limit: 500000, rate: 0.05 },
  { limit: 1000000, rate: 0.20 },
  { limit: Infinity, rate: 0.30 }
];
const OLD_REGIME_STANDARD_DEDUCTION = 50000;

function calculateTax(taxableIncome, slabs) {
  let tax = 0;
  let prev = 0;
  for (const slab of slabs) {
    if (taxableIncome <= prev) break;
    const slabIncome = Math.min(taxableIncome, slab.limit) - prev;
    if (slabIncome > 0) tax += slabIncome * slab.rate;
    prev = slab.limit;
  }
  // Health & Education Cess 4%
  tax = Math.round(tax * 1.04);
  return tax;
}

/**
 * Calculate monthly TDS for an employee
 * @param {Object} db - database connection
 * @param {string} employeeCode
 * @param {number} grossMonthly - monthly gross salary
 * @param {string} financialYear - e.g., '2025-26'
 * @returns {{ monthly_tds, annual_projected_tax, regime, effective_rate }}
 */
function calculateMonthlyTDS(db, employeeCode, grossMonthly, financialYear) {
  // Check for tax declaration
  let declaration = null;
  try {
    declaration = db.prepare('SELECT * FROM tax_declarations WHERE employee_code = ? AND financial_year = ?').get(employeeCode, financialYear);
  } catch {}

  // TDS gate: only auto-deduct when the employee has filed a tax declaration.
  // Without a declaration we cannot know the regime, exemptions, or even whether
  // the employee is tax-liable under this payroll (e.g. SILP / consultant cases).
  // Prior to this gate every employee earning > Rs.7L/yr got an auto-deduction —
  // e.g. SL Verma (23234) Rs.10,487 ghost deduction for Mar 2026. Matches the
  // documented behaviour in CLAUDE.md ("Auto-calculated from tax_declarations table").
  if (!declaration) {
    return {
      monthly_tds: 0,
      annual_projected_tax: 0,
      regime: 'none',
      effective_rate: 0
    };
  }

  const regime = declaration?.regime || 'new';
  const annualGross = grossMonthly * 12;

  let taxableIncome;
  if (regime === 'new') {
    taxableIncome = annualGross - NEW_REGIME_STANDARD_DEDUCTION;
  } else {
    const section80c = declaration?.section_80c || 0;
    const section80d = declaration?.section_80d || 0;
    const hraExemption = declaration?.hra_exemption || 0;
    const otherExemptions = declaration?.other_exemptions || 0;
    taxableIncome = annualGross - OLD_REGIME_STANDARD_DEDUCTION - section80c - section80d - hraExemption - otherExemptions;
  }

  taxableIncome = Math.max(0, taxableIncome);
  const slabs = regime === 'new' ? NEW_REGIME_SLABS : OLD_REGIME_SLABS;
  const annualTax = calculateTax(taxableIncome, slabs);

  // Rebate u/s 87A: if taxable income <= 7L (new) or 5L (old), tax is nil
  let finalTax = annualTax;
  if (regime === 'new' && taxableIncome <= 700000) finalTax = 0;
  if (regime === 'old' && taxableIncome <= 500000) finalTax = 0;

  const monthlyTDS = Math.round(finalTax / 12);
  const effectiveRate = annualGross > 0 ? Math.round(finalTax / annualGross * 10000) / 100 : 0;

  return {
    monthly_tds: monthlyTDS,
    annual_projected_tax: finalTax,
    regime,
    effective_rate: effectiveRate
  };
}

module.exports = { calculateMonthlyTDS };
