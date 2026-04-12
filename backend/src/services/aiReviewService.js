'use strict';
/**
 * AI-powered qualitative employee review service.
 * Calls the Anthropic Claude API with pre-digested profile metrics
 * and returns a structured narrative assessment.
 *
 * This is the ONLY async code in the backend — all DB calls remain synchronous
 * (better-sqlite3). The async boundary is exclusively around the fetch() to the
 * Anthropic API.
 */

const { computeProfileRange } = require('./employeeProfileService');

// ── System prompt ─────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are a senior HR analyst conducting a confidential performance and attendance review for a manufacturing company (Indriyan Beverages / Asian Lakto Ind. Ltd.) in India.

You will receive structured employee data covering attendance metrics, behavioral patterns, salary information, and department benchmarks for a specific date range.

Your task is to produce a structured qualitative review with these exact sections:

## EXECUTIVE SUMMARY
2-3 sentences capturing the employee's overall standing. Lead with the most important finding. Be direct — this is for HR decision-makers, not the employee.

## KEY STRENGTHS
Bullet points (2-4 items). Only include strengths backed by specific numbers from the data. Example: "Attendance rate of 94.2% exceeds department average by 6.3 points." Do NOT invent strengths not supported by the data. If there are no clear strengths, say so honestly.

## AREAS OF CONCERN
Bullet points, ordered by severity (Critical → High → Medium → Low). Each concern must reference the specific pattern or metric that triggered it. Include the pattern score where available. If no concerns, state "No significant concerns identified."

## RISK ASSESSMENT
One paragraph interpreting the composite scores:
- Flight Risk score (0-100): <30 = Low, 30-45 = Moderate, 45-60 = Elevated, >60 = High
- Engagement score (0-100): >75 = Strong, 50-75 = Moderate, <50 = Concerning
- Reliability score (0-100): >80 = Excellent, 60-80 = Acceptable, <60 = Below Standard
Contextualize these scores — don't just restate the numbers. Explain what they mean for THIS employee in THIS role.

## RECOMMENDATIONS
3-5 specific, actionable, time-bound recommendations. Each must follow the format:
"[Action] — [Rationale based on data] — [Timeline]"
Example: "Schedule a 1:1 retention conversation — flight risk score of 62 with overtime cliff pattern detected — within 1 week"
Prioritize by urgency. For contractors, focus on operational recommendations. For permanent staff, balance discipline with retention.

## DEPARTMENT CONTEXT
2-3 sentences comparing this employee against their department and organization benchmarks. Call out where they are significantly above or below average. If they are the best or worst in a specific metric, say so.

RULES:
- Every claim must be grounded in the provided data. Never fabricate numbers.
- Use the employee's name naturally throughout (not "the employee").
- Be candid. If performance is poor, say so directly with evidence.
- For contractors: focus on reliability, attendance consistency, OT compliance. Skip retention language.
- For new joiners (tenure < 3 months): be gentler on benchmarks, focus on stabilization trajectory.
- If a pattern has severity "Critical", it MUST appear in your first sentence.
- Keep the total response under 600 words. HR managers are busy.
- Do NOT include legal advice, termination recommendations, or disciplinary actions — those are HR's call.
- Use Indian HR terminology where appropriate (PF, ESI, DA, gross salary).`;

// ── Payload builder ───────────────────────────────────────────────────────────
/**
 * Condenses profileData into a compact LLM-friendly object (~1500–2500 tokens).
 * Raw arrays of 500+ daily records are NOT sent — only derived summaries.
 */
function buildReviewPayload(profileData, patternAnalysis) {
  const {
    employee, kpis, streaks, regularityScore,
    monthlyBreakdown, departmentComparison, salaryHistory,
    corrections, behavioralPatterns
  } = profileData;

  return {
    identity: {
      name:           employee.name,
      code:           employee.code,
      department:     employee.department,
      designation:    employee.designation,
      company:        employee.company,
      employmentType: employee.employment_type,
      tenureMonths:   employee.tenureMonths,
      status:         employee.status,
      shiftCode:      employee.shift_code,
      dateOfJoining:  employee.date_of_joining
    },

    attendance: {
      attendanceRate:          kpis.attendanceRate,
      absenteeismRate:         kpis.absenteeismRate,
      totalAbsences:           kpis.totalAbsences,
      workingDays:             kpis.workingDays,
      presentDays:             kpis.presentDays,
      lateCount:               kpis.lateCount,
      lateRate:                kpis.lateRate,
      avgLateMinutes:          kpis.avgLateMinutes,
      earlyExitCount:          kpis.earlyExitCount,
      earlyExitRate:           kpis.earlyExitRate,
      avgEarlyMinutes:         kpis.avgEarlyMinutes,
      avgHoursWorked:          kpis.avgHoursWorked,
      otDays:                  kpis.otDays,
      wopDays:                 kpis.wopDays,
      halfDayCount:            kpis.halfDayCount,
      missPunchCount:          kpis.missPunchCount,
      missPunchResolutionRate: kpis.missPunchResolutionRate,
      nightShiftDays:          kpis.nightShiftDays,
      holidayDutyDays:         kpis.holidayDutyDays,
      edDaysApproved:          kpis.edDaysApproved
    },

    streaks: {
      maxPresentStreak: streaks?.maxPresentStreak,
      maxAbsentStreak:  streaks?.maxAbsentStreak,
      currentStreak:    streaks?.currentStreak
    },

    regularityScore,

    comparison: departmentComparison ? {
      deptName: departmentComparison.departmentName,
      deptSize: departmentComparison.employeeCountInDept,
      vsDepart: {
        attendanceGap: Math.round((kpis.attendanceRate - (departmentComparison.department?.attendanceRate || 0)) * 10) / 10,
        lateGap:       Math.round((kpis.lateRate       - (departmentComparison.department?.lateRate       || 0)) * 10) / 10,
        hoursGap:      Math.round(((kpis.avgHoursWorked || 0) - (departmentComparison.department?.avgHours || 0)) * 100) / 100
      },
      vsOrg: {
        attendanceGap: Math.round((kpis.attendanceRate - (departmentComparison.org?.attendanceRate || 0)) * 10) / 10,
        lateGap:       Math.round((kpis.lateRate       - (departmentComparison.org?.lateRate       || 0)) * 10) / 10
      }
    } : null,

    // Monthly trend — compact (rates only, not raw counts)
    monthlyTrend: (monthlyBreakdown || []).map(m => ({
      period:         `${m.year}-${String(m.month).padStart(2, '0')}`,
      attendanceRate: m.attendanceRate,
      lateRate:       m.lateRate,
      avgHours:       m.avgHours,
      otDays:         m.otDays,
      absences:       m.absences
    })),

    // Salary totals only — not per-month breakdown
    salary: salaryHistory?.totals ? {
      totalGrossEarned:   salaryHistory.totals.totalGrossEarned,
      totalNetSalary:     salaryHistory.totals.totalNetSalary,
      totalTakeHome:      salaryHistory.totals.totalTakeHome,
      totalDeductions:    salaryHistory.totals.totalDeductions,
      totalOTPay:         salaryHistory.totals.totalOTPay,
      totalEDPay:         salaryHistory.totals.totalEDPay,
      monthsWithHold:     (salaryHistory.months || []).filter(m => m.salary_held).length,
      monthsWithWarning:  (salaryHistory.months || []).filter(m => m.salary_warning).length,
      grossChanged:       (salaryHistory.months || []).some(m => m.gross_changed)
    } : null,

    // Corrections — counts only
    corrections: {
      dayCorrections:     corrections?.dayCorrections?.length    || 0,
      punchCorrections:   corrections?.punchCorrections?.length  || 0,
      lateDeductions:     corrections?.lateDeductions?.length    || 0,
      lateDeductionDays:  (corrections?.lateDeductions || [])
                            .reduce((s, d) => s + (d.deduction_days || 0), 0)
    },

    // Pattern analysis — the intelligence layer
    patterns: {
      detected: (patternAnalysis?.patterns || []).map(p => ({
        id:        p.id,
        severity:  p.severity,
        label:     p.label,
        detail:    p.detail,
        score:     p.score,
        category:  p.category,
        hrAction:  p.hrAction
      })),
      compositeScores: patternAnalysis?.compositeScores || {},
      summary:         patternAnalysis?.summary         || {}
    },

    behavioralTrend: behavioralPatterns?.overallTrend || 'stable',
    aggregatedBehavioralPatterns: (behavioralPatterns?.aggregatedPatterns || []).map(p => ({
      type:            p.type,
      severity:        p.severity,
      label:           p.label,
      occurrenceCount: p.occurrenceCount,
      latestDetail:    p.latestDetail
    }))
  };
}

// ── Section parser ────────────────────────────────────────────────────────────
function parseSections(narrative) {
  const sections = {};
  const sectionMap = {
    'EXECUTIVE SUMMARY': 'executiveSummary',
    'KEY STRENGTHS':     'strengths',
    'AREAS OF CONCERN':  'concerns',
    'RISK ASSESSMENT':   'riskAssessment',
    'RECOMMENDATIONS':   'recommendations',
    'DEPARTMENT CONTEXT':'departmentContext'
  };

  for (const [heading, key] of Object.entries(sectionMap)) {
    // Match ## HEADING (case-insensitive) + content until next ## or end-of-string
    const regex = new RegExp(
      `##\\s*${heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^\\n]*\\n([\\s\\S]*?)(?=\\n##|$)`,
      'i'
    );
    const match = narrative.match(regex);
    sections[key] = match ? match[1].trim() : null;
  }

  return sections;
}

// ── Claude API caller ─────────────────────────────────────────────────────────
async function callClaudeAPI(systemPrompt, dataPayload) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      success: false,
      error: 'ANTHROPIC_API_KEY not configured. Set it in Railway environment variables.'
    };
  }

  const firstPeriod = dataPayload.monthlyTrend?.[0]?.period || 'N/A';
  const lastPeriod  = dataPayload.monthlyTrend?.[dataPayload.monthlyTrend.length - 1]?.period || 'N/A';

  const userMessage = `Here is the employee data for review. Analyze it and produce the structured assessment.

Employee Data:
${JSON.stringify(dataPayload, null, 2)}

Date range analyzed: ${firstPeriod} to ${lastPeriod}`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model:      'claude-sonnet-4-20250514',
        max_tokens: 1500,
        system:     systemPrompt,
        messages:   [{ role: 'user', content: userMessage }]
      })
    });

    if (!response.ok) {
      const errBody = await response.text();
      console.error('[AI Review] API error:', response.status, errBody);
      return {
        success: false,
        error: `Claude API returned ${response.status}: ${errBody.substring(0, 200)}`
      };
    }

    const data = await response.json();
    const text = (data.content || [])
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('\n');

    if (!text) {
      return { success: false, error: 'Claude API returned empty response' };
    }

    return { success: true, narrative: text, usage: data.usage };
  } catch (err) {
    console.error('[AI Review] fetch error:', err.message);
    return { success: false, error: 'Failed to reach Claude API: ' + err.message };
  }
}

// ── Main exported function ────────────────────────────────────────────────────
/**
 * Generate an AI-powered qualitative review for an employee.
 * Synchronous data gathering → async Claude API call → structured result.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} employeeCode
 * @param {string} startDate  'YYYY-MM-DD'
 * @param {string} endDate    'YYYY-MM-DD'
 * @returns {Promise<{success: boolean, review?: object, error?: string}>}
 */
async function generateAIReview(db, employeeCode, startDate, endDate) {
  // 1. Gather all data synchronously (includes patternAnalysis via Section L)
  const profileData = computeProfileRange(db, employeeCode, startDate, endDate);
  if (!profileData) {
    return { success: false, error: 'Employee not found' };
  }

  // 2. Reuse patternAnalysis already computed in profileData (Phase 2a wired it in)
  //    Fall back to fresh computation if somehow absent (shouldn't happen)
  let patternAnalysis = profileData.patternAnalysis;
  if (!patternAnalysis) {
    try {
      const { analyzeEmployeePatterns } = require('./patternEngine');
      patternAnalysis = analyzeEmployeePatterns(db, employeeCode, startDate, endDate, {
        employee:          profileData.employee,
        kpis:              profileData.kpis,
        shift:             profileData.employee.shift,
        monthlyBreakdown:  profileData.monthlyBreakdown,
        behavioralPatterns:profileData.behavioralPatterns,
        regularityScore:   profileData.regularityScore
      });
    } catch (e) {
      console.warn('[AI Review] Pattern engine unavailable:', e.message);
      patternAnalysis = { patterns: [], compositeScores: {}, summary: {} };
    }
  }

  // 3. Build compact payload for the LLM
  const payload = buildReviewPayload(profileData, patternAnalysis);

  // 4. Call Claude API (the one async operation)
  const result = await callClaudeAPI(SYSTEM_PROMPT, payload);
  if (!result.success) return result;

  // 5. Parse markdown sections from the narrative
  const sections = parseSections(result.narrative);

  return {
    success: true,
    review: {
      narrative:    result.narrative,
      sections,
      generatedAt:  new Date().toISOString(),
      model:        'claude-sonnet-4-20250514',
      usage:        result.usage,
      dataRange:    { from: startDate, to: endDate },
      employeeCode,
      employeeName: profileData.employee?.name
    }
  };
}

module.exports = { generateAIReview };
