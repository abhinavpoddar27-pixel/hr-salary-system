'use strict';
/**
 * Phase 2b — Contractor-specific Pattern Detectors (6.1 – 6.2)
 * Both return null immediately for permanent employees.
 */

const { isContractorForPayroll } = require('../../utils/employeeClassification');

function clamp(v, lo = 0, hi = 100) { return Math.max(lo, Math.min(hi, v)); }
function r1(x) { return Math.round(x * 10) / 10; }

const PRESENT      = ['P', 'WOP', '½P', 'WO½P'];
const FULL_PRESENT = ['P', 'WOP'];
const HALF_PRESENT = ['½P', 'WO½P'];

// ── 6.1 Contractor Instability ─────────────────────────────────────────────
function detectContractorInstability(records, context) {
  const { employee, monthlyBreakdown } = context;
  if (!isContractorForPayroll(employee)) return null;

  const mb = (monthlyBreakdown || []).filter(m => m.workingDays > 0);
  if (mb.length < 2) return null;

  const rates = mb.map(m => m.workingDays > 0 ? m.presentDays / m.workingDays : 0);
  const avgRate = rates.reduce((s, v) => s + v, 0) / rates.length;
  const mean    = avgRate;
  const variance = rates.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / rates.length;
  const stddev   = Math.sqrt(variance);

  const stabilityScore = Math.max(0, Math.min(100, Math.round(avgRate * 60 + (1 - stddev) * 40)));

  if (stabilityScore >= 50) return null;

  return {
    id: 'CONTRACTOR_INSTABILITY',
    detected: true,
    severity: stabilityScore < 30 ? 'High' : 'Medium',
    score: 100 - stabilityScore,
    category: 'contractor',
    label: 'Contractor Attendance Instability',
    detail: `Stability score ${stabilityScore}/100 — avg attendance ${Math.round(avgRate * 100)}% with ${Math.round(stddev * 100)}% month-to-month variance`,
    evidence: {
      monthlyRates: mb.map(m => ({ month: m.month, year: m.year, rate: r1(m.workingDays > 0 ? m.presentDays / m.workingDays : 0) })),
      avgRate: r1(avgRate), stddev: r1(stddev), stabilityScore
    },
    hrAction: 'Unreliable contractor — consider replacement or conversion to permanent if valuable',
    value: stabilityScore
  };
}

// ── 6.2 Contractor OT Exploitation ────────────────────────────────────────
function detectContractorOTExploitation(records, context) {
  const { db, employee, startDate, endDate } = context;
  if (!isContractorForPayroll(employee)) return null;

  const dept = employee.department;

  // Contractor total OT hours
  const contractorOTHours = records
    .filter(r => r.is_overtime && r.overtime_minutes > 0)
    .reduce((s, r) => s + (r.overtime_minutes || 0), 0) / 60;

  // Department permanent employee avg OT hours
  let deptPermAvgOT = 0;
  try {
    const row = dept ? db.prepare(`
      SELECT AVG(sub.total_ot) AS avg_perm_ot FROM (
        SELECT SUM(ap.overtime_minutes) / 60.0 AS total_ot
        FROM attendance_processed ap
        LEFT JOIN employees e ON ap.employee_code = e.code
        WHERE ap.date BETWEEN ? AND ? AND ap.is_night_out_only = 0
          AND e.department = ?
          AND (e.employment_type IS NULL OR LOWER(e.employment_type) NOT LIKE '%contract%')
          AND ap.is_overtime = 1
        GROUP BY ap.employee_code
      ) sub
    `).get(startDate, endDate, dept) : null;
    deptPermAvgOT = row ? (row.avg_perm_ot || 0) : 0;
  } catch (_) {}

  // Quarterly OT check (Factories Act ~50h/quarter)
  const quarterlyOT = {};
  for (const r of records) {
    if (!r.is_overtime || !r.overtime_minutes) continue;
    const [y, m] = r.date.split('-').map(Number);
    const q = `${y}-Q${Math.ceil(m / 3)}`;
    quarterlyOT[q] = (quarterlyOT[q] || 0) + r.overtime_minutes / 60;
  }
  const legalFlag = Object.values(quarterlyOT).some(h => h > 50);

  const disparity = contractorOTHours / Math.max(deptPermAvgOT, 0.1);

  if (disparity <= 2.0 && !legalFlag) return null;

  return {
    id: 'CONTRACTOR_OT_EXPLOITATION',
    detected: true,
    severity: legalFlag ? 'Critical' : disparity > 3.0 ? 'High' : 'Medium',
    score: clamp(Math.round(disparity * 30)),
    category: 'contractor',
    label: legalFlag ? 'Contractor OT — Legal Risk' : 'Contractor OT Disparity',
    detail: legalFlag
      ? `OT exceeds Factories Act 50h/quarter limit in ${Object.entries(quarterlyOT).filter(([, h]) => h > 50).map(([q]) => q).join(', ')}`
      : `Contractor OT ${Math.round(contractorOTHours)}h vs dept perm avg ${Math.round(deptPermAvgOT)}h (${Math.round(disparity * 10) / 10}× ratio)`,
    evidence: {
      contractorOTHours: Math.round(contractorOTHours * 10) / 10,
      deptPermanentAvgOT: Math.round(deptPermAvgOT * 10) / 10,
      disparity: Math.round(disparity * 10) / 10,
      quarterlyOT: Object.entries(quarterlyOT).map(([q, h]) => ({ quarter: q, hours: Math.round(h * 10) / 10 })),
      legalRisk: legalFlag
    },
    hrAction: legalFlag
      ? 'LEGAL RISK: Contractor OT exceeds Factories Act quarterly limit of 50 hours. Immediate remediation required.'
      : 'Contractor working disproportionate overtime vs permanent staff — review workload distribution',
    value: Math.round(disparity * 10) / 10
  };
}

module.exports = { detectContractorInstability, detectContractorOTExploitation };
