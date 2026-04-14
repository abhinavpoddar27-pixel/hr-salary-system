/**
 * Salary Explainer — AI-powered salary breakdown route.
 *
 * Endpoints:
 *  - POST /api/ai/explain-salary   — role-gated to admin/hr/finance
 *  - GET  /api/ai/employee-search  — autocomplete for the explainer panel
 *
 * All queries here are READ-ONLY against pipeline tables. The only writes
 * are to `salary_computations.ai_explanation` / `ai_explanation_at` to
 * cache successful Anthropic responses. A schema-level trigger invalidates
 * that cache automatically whenever any salary column is recomputed.
 */

const express = require('express');
const { getDb } = require('../database/db');

const router = express.Router();

const MONTHS = [
  '', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

if (!process.env.ANTHROPIC_API_KEY) {
  console.warn('⚠️  ANTHROPIC_API_KEY not set — Salary Explainer AI will return data only, no explanations');
}

const SALARY_EXPLAINER_SYSTEM_PROMPT = `You are a payroll analyst for an Indian manufacturing company (Indriyan Beverages / Asian Lakto Ind. Ltd.). You explain salary calculations in simple, clear language that HR staff can read back to employees.

PAYROLL RULES:
- Permanent employees: base entitlement = working days + paid weekly offs + paid holidays. Absent days subtract. WOP (worked on weekly off) adds.
- Salary divisor: 26 if payable <= 26, else calendar days of the month.
- earnedRatio = payableDays / divisor (capped at 1.0 for base components)
- Each base component (Basic, DA, HRA, Conveyance, Other) = monthly amount * earnedRatio
- OT rate: gross / calendar days of month (NOT divisor 26)
- PF: 12% of min(Basic + DA, Rs.15,000 ceiling), only if PF applicable
- ESI: 0.75% of gross earned, only if monthly gross <= Rs.21,000
- Professional Tax: currently DISABLED (always Rs.0)
- Contractors: strictly gross / daysInMonth * daysPresent. No weekly offs, no holidays.
- ED (Extra Duty) pay is separate from OT, not part of gross earned.
- net_salary = gross_earned - total_deductions
- take_home = net_salary + ot_pay + holiday_duty_pay + ed_pay

FORMAT RULES:
- Use Rs. symbol for all amounts (or the rupee glyph if available)
- Show math: "Rs.24,000 x 28/31 = Rs.21,677"
- Use short section headers: SUMMARY, EARNINGS, DEDUCTIONS, CHANGES, FLAGS
- Keep each section 2-4 lines max
- If something doesn't add up, say so clearly — never guess
- Use simple Hindi-English terms where natural (like "weekly off", "half day", "present")
- Never mention "AI" or "Claude" — speak as if you are the payroll system explaining itself`;

function buildExplainerPrompt(data) {
  const { employee, comp, prevComp, dayCalc, lateDeductions, loans, corrections } = data;

  const prevLabel = prevComp ? `${MONTHS[prevComp.month]} ${prevComp.year}` : null;

  const lines = [];
  lines.push(`Explain this employee's salary for ${MONTHS[comp.month]} ${comp.year}.`);
  lines.push(prevComp
    ? 'Compare with last month and explain changes.'
    : 'No previous month data available.');
  lines.push('');
  lines.push('EMPLOYEE:');
  lines.push(`- Code: ${employee.code}, Name: ${employee.name}`);
  lines.push(`- Department: ${employee.department || 'N/A'}, Type: ${employee.employment_type || (employee.is_contractor ? 'Contractor' : 'Permanent')}`);
  lines.push(`- Gross Monthly: Rs.${comp.gross_salary}, Date of Joining: ${employee.date_of_joining || 'N/A'}`);
  lines.push('');
  lines.push('ATTENDANCE (Day Calculation):');
  lines.push(`- Calendar Days: ${dayCalc.total_calendar_days}, Working Days: ${dayCalc.total_working_days}`);
  lines.push(`- Present: ${dayCalc.days_present}, Half Day: ${dayCalc.days_half_present}, Absent: ${dayCalc.days_absent}`);
  lines.push(`- WOP (worked weekly off): ${dayCalc.days_wop}`);
  lines.push(`- Paid Weekly Offs: ${dayCalc.paid_sundays}, Unpaid Weekly Offs: ${dayCalc.unpaid_sundays}`);
  lines.push(`- Weekly Off Rule: ${dayCalc.weekly_off_note || dayCalc.sunday_note || 'N/A'}`);
  lines.push(`- Paid Holidays: ${dayCalc.paid_holidays}`);
  lines.push(`- OT Hours: ${dayCalc.ot_hours}, Extra Duty Days: ${dayCalc.extra_duty_days || 0}`);
  lines.push(`- Holiday Duty Days: ${dayCalc.holiday_duty_days || 0}`);
  lines.push(`- Late Count: ${dayCalc.late_count || 0}`);
  lines.push(`- Total Payable Days: ${dayCalc.total_payable_days}`);
  if (dayCalc.is_mid_month_joiner) {
    lines.push(`- Mid-Month Joiner: Yes (DOJ: ${dayCalc.date_of_joining || employee.date_of_joining || 'N/A'})`);
  } else {
    lines.push('- Mid-Month Joiner: No');
  }
  lines.push('');
  lines.push('CURRENT MONTH SALARY:');
  lines.push(`- Payable Days: ${comp.payable_days}, Gross Salary: Rs.${comp.gross_salary}`);
  lines.push(`- Basic Earned: Rs.${comp.basic_earned}, DA: Rs.${comp.da_earned}, HRA: Rs.${comp.hra_earned}`);
  lines.push(`- Conveyance: Rs.${comp.conveyance_earned}, Other Allowances: Rs.${comp.other_allowances_earned}`);
  lines.push(`- OT Pay: Rs.${comp.ot_pay || 0}, Holiday Duty Pay: Rs.${comp.holiday_duty_pay || 0}, ED Pay: Rs.${comp.ed_pay || 0}`);
  lines.push(`- Gross Earned: Rs.${comp.gross_earned}`);
  lines.push(`- PF Employee: Rs.${comp.pf_employee}, ESI Employee: Rs.${comp.esi_employee}`);
  lines.push(`- TDS: Rs.${comp.tds || 0}, Advance Recovery: Rs.${comp.advance_recovery || 0}`);
  lines.push(`- Loan Recovery: Rs.${comp.loan_recovery || 0}`);
  lines.push(`- Late Coming Deduction: Rs.${comp.late_coming_deduction || 0}`);
  lines.push(`- Early Exit Deduction: Rs.${comp.early_exit_deduction || 0}`);
  lines.push(`- Other Deductions: Rs.${comp.other_deductions || 0}`);
  lines.push(`- Total Deductions: Rs.${comp.total_deductions}`);
  lines.push(`- Net Salary: Rs.${comp.net_salary}`);
  const takeHome = comp.take_home || (comp.net_salary + (comp.ot_pay || 0) + (comp.holiday_duty_pay || 0) + (comp.ed_pay || 0));
  lines.push(`- Take Home: Rs.${takeHome}`);
  lines.push(`- Salary Held: ${comp.salary_held ? 'YES — Reason: ' + (comp.hold_reason || 'Not specified') : 'No'}`);
  lines.push(`- Gross Changed from Structure: ${comp.gross_changed ? 'YES' : 'No'}`);

  if (prevComp) {
    lines.push('');
    lines.push(`PREVIOUS MONTH (${prevLabel}):`);
    lines.push(`- Payable Days: ${prevComp.payable_days}, Gross Earned: Rs.${prevComp.gross_earned}`);
    lines.push(`- Net Salary: Rs.${prevComp.net_salary}, Total Deductions: Rs.${prevComp.total_deductions}`);
    lines.push(`- OT Pay: Rs.${prevComp.ot_pay || 0}, PF: Rs.${prevComp.pf_employee}, ESI: Rs.${prevComp.esi_employee}`);
    lines.push(`- Advance Recovery: Rs.${prevComp.advance_recovery || 0}, Loan Recovery: Rs.${prevComp.loan_recovery || 0}`);
    lines.push(`- Late Coming: Rs.${prevComp.late_coming_deduction || 0}`);
  }

  if (lateDeductions.length > 0) {
    const totalDays = lateDeductions.reduce((s, d) => s + (d.deduction_days || 0), 0);
    lines.push('');
    lines.push(`LATE COMING DEDUCTIONS: ${lateDeductions.length} approved, total ${totalDays} days`);
  }

  if (comp.advance_recovery > 0) {
    lines.push('');
    lines.push(`ADVANCE RECOVERY: Rs.${comp.advance_recovery}`);
  }

  if (loans.length > 0) {
    lines.push('');
    lines.push(`ACTIVE LOANS: ${loans.map(l => `${l.loan_type} — EMI Rs.${l.emi_this_month || l.emi_amount}`).join('; ')}`);
  }

  if (corrections.length > 0) {
    lines.push('');
    const summary = corrections.map(c => {
      const parts = [`${c.field_name || 'field'}: ${c.old_value ?? 'null'} -> ${c.new_value ?? 'null'}`];
      if (c.remark) parts.push(`(${c.remark})`);
      return parts.join(' ');
    }).join('; ');
    lines.push(`MANUAL CORRECTIONS THIS MONTH: ${summary}`);
  }

  lines.push('');
  lines.push(`Respond with SUMMARY, EARNINGS, DEDUCTIONS${prevComp ? ', CHANGES' : ''}, and FLAGS (if any unusual items).`);

  return lines.join('\n');
}

/**
 * Build a structured summary the UI can always render, even when the
 * Anthropic call fails or the API key is missing.
 */
function buildDataSummary(employee, comp, prevComp, dayCalc, prevMonth, prevYear) {
  return {
    employee: {
      code: employee.code,
      name: employee.name,
      department: employee.department || '',
      company: employee.company || '',
      employment_type: employee.employment_type || (employee.is_contractor ? 'Contractor' : 'Permanent'),
      date_of_joining: employee.date_of_joining || ''
    },
    period: {
      month: parseInt(comp.month),
      year: parseInt(comp.year),
      label: `${MONTHS[comp.month]} ${comp.year}`
    },
    attendance: {
      calendar_days: dayCalc.total_calendar_days || null,
      working_days: dayCalc.total_working_days || null,
      payable_days: comp.payable_days,
      present: dayCalc.days_present || 0,
      half_day: dayCalc.days_half_present || 0,
      absent: dayCalc.days_absent || 0,
      wop: dayCalc.days_wop || 0,
      paid_weekly_offs: dayCalc.paid_sundays || 0,
      paid_holidays: dayCalc.paid_holidays || 0,
      ot_hours: dayCalc.ot_hours || 0,
      ed_days: dayCalc.extra_duty_days || 0,
      is_mid_month_joiner: !!dayCalc.is_mid_month_joiner
    },
    current: {
      gross_salary: comp.gross_salary,
      gross_earned: comp.gross_earned,
      basic: comp.basic_earned,
      da: comp.da_earned,
      hra: comp.hra_earned,
      conveyance: comp.conveyance_earned,
      other: comp.other_allowances_earned,
      ot_pay: comp.ot_pay || 0,
      holiday_duty_pay: comp.holiday_duty_pay || 0,
      ed_pay: comp.ed_pay || 0,
      pf: comp.pf_employee || 0,
      esi: comp.esi_employee || 0,
      tds: comp.tds || 0,
      advance: comp.advance_recovery || 0,
      loan: comp.loan_recovery || 0,
      late: comp.late_coming_deduction || 0,
      early_exit: comp.early_exit_deduction || 0,
      other_deductions: comp.other_deductions || 0,
      total_deductions: comp.total_deductions,
      net_salary: comp.net_salary,
      take_home: comp.take_home || (comp.net_salary + (comp.ot_pay || 0) + (comp.holiday_duty_pay || 0) + (comp.ed_pay || 0)),
      salary_held: !!comp.salary_held,
      hold_reason: comp.hold_reason || '',
      gross_changed: !!comp.gross_changed
    },
    previous: prevComp ? {
      label: `${MONTHS[prevMonth]} ${prevYear}`,
      payable_days: prevComp.payable_days,
      gross_earned: prevComp.gross_earned,
      net_salary: prevComp.net_salary,
      total_deductions: prevComp.total_deductions,
      net_change: Math.round((comp.net_salary - prevComp.net_salary) * 100) / 100
    } : null
  };
}

/**
 * GET /api/ai/employee-search?q=term
 * Autocomplete helper for the explainer panel.
 */
router.get('/employee-search', (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json({ success: true, data: [] });
  const db = getDb();
  const term = `%${q}%`;
  const results = db.prepare(`
    SELECT code, name, department, company
    FROM employees
    WHERE status = 'Active' AND (code LIKE ? OR name LIKE ?)
    ORDER BY name
    LIMIT 10
  `).all(term, term);
  res.json({ success: true, data: results });
});

/**
 * POST /api/ai/explain-salary
 * Body: { employee_code, month, year }
 * Response: { success, explanation, data_summary, cached, error? }
 */
router.post('/explain-salary', async (req, res) => {
  const role = req.user?.role;
  if (!['admin', 'hr', 'finance'].includes(role)) {
    return res.status(403).json({
      success: false,
      error: 'Salary explanations restricted to HR, Finance, and Admin roles'
    });
  }

  const { employee_code, month, year } = req.body || {};
  if (!employee_code || !month || !year) {
    return res.status(400).json({
      success: false,
      error: 'employee_code, month, and year are required'
    });
  }

  const monthInt = parseInt(month);
  const yearInt = parseInt(year);
  if (!monthInt || monthInt < 1 || monthInt > 12 || !yearInt) {
    return res.status(400).json({ success: false, error: 'Invalid month or year' });
  }

  const db = getDb();

  const employee = db.prepare('SELECT * FROM employees WHERE code = ?').get(employee_code);
  if (!employee) {
    return res.status(404).json({
      success: false,
      error: `Employee ${employee_code} not found`
    });
  }

  const comp = db.prepare(
    'SELECT * FROM salary_computations WHERE employee_code = ? AND month = ? AND year = ?'
  ).get(employee_code, monthInt, yearInt);

  if (!comp) {
    return res.json({
      success: false,
      error: `No salary data found for ${employee.name} in ${MONTHS[monthInt]} ${yearInt}. Run salary computation first.`
    });
  }

  let prevMonth = monthInt - 1;
  let prevYear = yearInt;
  if (prevMonth === 0) { prevMonth = 12; prevYear--; }
  const prevComp = db.prepare(
    'SELECT * FROM salary_computations WHERE employee_code = ? AND month = ? AND year = ?'
  ).get(employee_code, prevMonth, prevYear);

  const dayCalc = db.prepare(
    'SELECT * FROM day_calculations WHERE employee_code = ? AND month = ? AND year = ?'
  ).get(employee_code, monthInt, yearInt) || {};

  const lateDeductions = db.prepare(`
    SELECT * FROM late_coming_deductions
    WHERE employee_code = ? AND month = ? AND year = ? AND finance_status = 'approved'
  `).all(employee_code, monthInt, yearInt);

  const loans = db.prepare(`
    SELECT l.*,
      (SELECT SUM(emi_amount) FROM loan_repayments
        WHERE loan_id = l.id AND month = ? AND year = ? AND deducted_from_salary = 1) AS emi_this_month
    FROM loans l
    WHERE l.employee_code = ? AND l.status IN ('Active', 'active')
  `).all(monthInt, yearInt, employee_code);

  const corrections = db.prepare(`
    SELECT field_name, old_value, new_value, remark, stage, changed_at
    FROM audit_log
    WHERE employee_code = ? AND changed_at LIKE ?
      AND action_type IN ('correction', 'leave_correction', 'mark_present', 'punch_correction')
    ORDER BY changed_at DESC LIMIT 10
  `).all(employee_code, `${yearInt}-${String(monthInt).padStart(2, '0')}%`);

  const dataSummary = buildDataSummary(employee, comp, prevComp, dayCalc, prevMonth, prevYear);

  // Cache hit: the invalidation trigger nulls ai_explanation whenever any
  // salary column is updated, so a non-null value is guaranteed fresh.
  if (comp.ai_explanation && comp.ai_explanation_at) {
    return res.json({
      success: true,
      explanation: comp.ai_explanation,
      data_summary: dataSummary,
      cached: true,
      cached_at: comp.ai_explanation_at
    });
  }

  // No API key → graceful fallback: data only, no narrative.
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.json({
      success: true,
      explanation: null,
      data_summary: dataSummary,
      cached: false,
      error: 'AI explanation unavailable — API key not configured'
    });
  }

  try {
    const userPrompt = buildExplainerPrompt({
      employee, comp, prevComp, dayCalc, lateDeductions, loans, corrections
    });

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1500,
        system: SALARY_EXPLAINER_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userPrompt }]
      })
    });

    if (!response.ok) {
      const errBody = await response.text();
      console.error('[ai.js] Anthropic API error:', response.status, errBody.slice(0, 300));
      return res.json({
        success: true,
        explanation: null,
        data_summary: dataSummary,
        cached: false,
        error: `AI explanation unavailable — API returned ${response.status}`
      });
    }

    const result = await response.json();
    const explanation = result?.content?.[0]?.text || '';

    if (!explanation) {
      return res.json({
        success: true,
        explanation: null,
        data_summary: dataSummary,
        cached: false,
        error: 'AI returned empty response'
      });
    }

    // Persist cache. The invalidation trigger in schema.js will null these
    // fields automatically if any salary column is subsequently recomputed.
    try {
      db.prepare(`
        UPDATE salary_computations
        SET ai_explanation = ?, ai_explanation_at = datetime('now')
        WHERE employee_code = ? AND month = ? AND year = ?
      `).run(explanation, employee_code, monthInt, yearInt);
    } catch (cacheErr) {
      console.error('[ai.js] Cache write failed (non-fatal):', cacheErr.message);
    }

    res.json({
      success: true,
      explanation,
      data_summary: dataSummary,
      cached: false
    });
  } catch (err) {
    console.error('[ai.js] Explainer error:', err.message);
    res.json({
      success: true,
      explanation: null,
      data_summary: dataSummary,
      cached: false,
      error: `AI explanation unavailable — ${err.message}`
    });
  }
});

module.exports = router;
