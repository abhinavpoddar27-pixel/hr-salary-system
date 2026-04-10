// Early Exit Detection & Deduction Routes — April 2026
//
// Detection: detect early departures, list/filter results, analytics.
// Mounted at /api/early-exits.

const express = require('express');
const router = express.Router();
const { getDb, logAudit } = require('../database/db');
const { detectEarlyExits } = require('../services/earlyExitDetection');

// ─── Role helpers ─────────────────────────────────────────
function requireHrOrAdmin(req, res, next) {
  const role = req.user?.role;
  if (role !== 'hr' && role !== 'admin') {
    return res.status(403).json({ success: false, error: 'HR or admin access required' });
  }
  next();
}

function requireHrFinanceOrAdmin(req, res, next) {
  const role = req.user?.role;
  if (role !== 'hr' && role !== 'finance' && role !== 'admin') {
    return res.status(403).json({ success: false, error: 'HR, finance, or admin access required' });
  }
  next();
}

// ────────────────────────────────────────────────────────────
// POST /detect — Run early exit detection for a date
// ────────────────────────────────────────────────────────────
router.post('/detect', requireHrOrAdmin, (req, res) => {
  try {
    const db = getDb();
    let { date } = req.body;

    // Default to yesterday
    if (!date) {
      const d = new Date();
      d.setDate(d.getDate() - 1);
      date = d.toISOString().split('T')[0];
    }

    const result = detectEarlyExits(db, date);

    return res.json({
      success: true,
      date,
      detected: result.detected,
      exempted: result.exempted,
      skipped: result.skipped
    });
  } catch (err) {
    console.error('[early-exits] POST /detect error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ────────────────────────────────────────────────────────────
// GET / — List detections with filters
// ────────────────────────────────────────────────────────────
router.get('/', requireHrFinanceOrAdmin, (req, res) => {
  try {
    const db = getDb();
    const { date_from, date_to, employee_code, department, company,
            detection_status, has_gate_pass, month, year } = req.query;

    let sql = `
      SELECT eed.*,
        edd.id as deduction_id,
        edd.deduction_type,
        edd.deduction_amount,
        edd.finance_status as deduction_finance_status
      FROM early_exit_detections eed
      LEFT JOIN early_exit_deductions edd ON edd.early_exit_detection_id = eed.id
        AND edd.finance_status != 'cancelled'
      WHERE 1=1
    `;
    const params = [];

    if (date_from) { sql += ' AND eed.date >= ?'; params.push(date_from); }
    if (date_to) { sql += ' AND eed.date <= ?'; params.push(date_to); }
    if (employee_code) { sql += ' AND eed.employee_code = ?'; params.push(employee_code); }
    if (department) { sql += ' AND eed.department = ?'; params.push(department); }
    if (company) { sql += ' AND eed.company = ?'; params.push(company); }
    if (detection_status) { sql += ' AND eed.detection_status = ?'; params.push(detection_status); }
    if (has_gate_pass !== undefined && has_gate_pass !== '') {
      sql += ' AND eed.has_gate_pass = ?'; params.push(parseInt(has_gate_pass));
    }
    if (month && year) {
      sql += " AND CAST(strftime('%m', eed.date) AS INTEGER) = ? AND CAST(strftime('%Y', eed.date) AS INTEGER) = ?";
      params.push(parseInt(month), parseInt(year));
    }

    sql += ' ORDER BY eed.date DESC, eed.flagged_minutes DESC';

    const data = db.prepare(sql).all(...params);
    return res.json({ success: true, data });
  } catch (err) {
    console.error('[early-exits] GET / error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ────────────────────────────────────────────────────────────
// GET /summary — Org-wide summary for dashboard
// ────────────────────────────────────────────────────────────
router.get('/summary', requireHrFinanceOrAdmin, (req, res) => {
  try {
    const db = getDb();
    const month = parseInt(req.query.month) || (new Date().getMonth() + 1);
    const year = parseInt(req.query.year) || new Date().getFullYear();
    const company = req.query.company;

    let whereClause = "CAST(strftime('%m', eed.date) AS INTEGER) = ? AND CAST(strftime('%Y', eed.date) AS INTEGER) = ?";
    const params = [month, year];
    if (company) { whereClause += ' AND eed.company = ?'; params.push(company); }

    const stats = db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN eed.detection_status = 'flagged' THEN 1 ELSE 0 END) as flagged,
        SUM(CASE WHEN eed.detection_status = 'exempted' THEN 1 ELSE 0 END) as exempted_count,
        SUM(CASE WHEN eed.detection_status = 'actioned' THEN 1 ELSE 0 END) as actioned,
        ROUND(AVG(CASE WHEN eed.detection_status != 'exempted' THEN eed.flagged_minutes END), 1) as avg_flagged_minutes
      FROM early_exit_detections eed
      WHERE ${whereClause}
    `).get(...params);

    // Pending finance
    const pendingFinance = db.prepare(`
      SELECT COUNT(*) as cnt FROM early_exit_deductions
      WHERE finance_status = 'pending'
        AND payroll_month = ? AND payroll_year = ?
    `).get(month, year);

    // Trend: current 30d vs previous 30d
    const now = new Date();
    const d30ago = new Date(now); d30ago.setDate(d30ago.getDate() - 30);
    const d60ago = new Date(now); d60ago.setDate(d60ago.getDate() - 60);

    let trendWhere = "eed.detection_status != 'exempted'";
    if (company) trendWhere += ` AND eed.company = '${company}'`;

    const current30 = db.prepare(`
      SELECT COUNT(*) as cnt FROM early_exit_detections eed
      WHERE eed.date >= ? AND eed.date <= ? AND ${trendWhere}
    `).get(d30ago.toISOString().split('T')[0], now.toISOString().split('T')[0]);

    const prev30 = db.prepare(`
      SELECT COUNT(*) as cnt FROM early_exit_detections eed
      WHERE eed.date >= ? AND eed.date < ? AND ${trendWhere}
    `).get(d60ago.toISOString().split('T')[0], d30ago.toISOString().split('T')[0]);

    const trend = (current30?.cnt || 0) - (prev30?.cnt || 0);

    return res.json({
      success: true,
      month, year,
      total: stats?.total || 0,
      flagged: stats?.flagged || 0,
      exempted: stats?.exempted_count || 0,
      actioned: stats?.actioned || 0,
      pending_hr: stats?.flagged || 0,
      pending_finance: pendingFinance?.cnt || 0,
      avg_flagged_minutes: stats?.avg_flagged_minutes || 0,
      trend,
      trend_direction: trend > 0 ? 'up' : trend < 0 ? 'down' : 'flat'
    });
  } catch (err) {
    console.error('[early-exits] GET /summary error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ────────────────────────────────────────────────────────────
// GET /employee/:employeeCode/analytics — Per-employee analytics
// ────────────────────────────────────────────────────────────
router.get('/employee/:employeeCode/analytics', requireHrFinanceOrAdmin, (req, res) => {
  try {
    const db = getDb();
    const { employeeCode } = req.params;
    const now = new Date();

    // 4 x 30-day windows
    const windows = [];
    for (let i = 0; i < 4; i++) {
      const endDate = new Date(now);
      endDate.setDate(endDate.getDate() - (i * 30));
      const startDate = new Date(endDate);
      startDate.setDate(startDate.getDate() - 30);

      const count = db.prepare(`
        SELECT COUNT(*) as cnt FROM early_exit_detections
        WHERE employee_code = ? AND date >= ? AND date <= ?
          AND detection_status != 'exempted'
      `).get(employeeCode, startDate.toISOString().split('T')[0], endDate.toISOString().split('T')[0]);

      windows.push({
        period: i === 0 ? 'Current' : `${i * 30}d ago`,
        start: startDate.toISOString().split('T')[0],
        end: endDate.toISOString().split('T')[0],
        count: count?.cnt || 0
      });
    }

    const currentCount = windows[0]?.count || 0;
    const prevCount = windows[1]?.count || 0;
    const isHabitual = currentCount >= 3;
    const trend = currentCount - prevCount;

    // History
    const history = db.prepare(`
      SELECT eed.*,
        edd.id as deduction_id,
        edd.deduction_type,
        edd.deduction_amount,
        edd.finance_status as deduction_finance_status,
        edd.hr_remark
      FROM early_exit_detections eed
      LEFT JOIN early_exit_deductions edd ON edd.early_exit_detection_id = eed.id
        AND edd.finance_status != 'cancelled'
      WHERE eed.employee_code = ?
      ORDER BY eed.date DESC
      LIMIT 90
    `).all(employeeCode);

    return res.json({
      success: true,
      employee_code: employeeCode,
      is_habitual: isHabitual,
      current_30d_count: currentCount,
      trend,
      trend_direction: trend > 0 ? 'up' : trend < 0 ? 'down' : 'flat',
      chart_data: windows.reverse(),
      history
    });
  } catch (err) {
    console.error('[early-exits] GET /employee/:code/analytics error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ────────────────────────────────────────────────────────────
// GET /:id — Single detection record
// ────────────────────────────────────────────────────────────
router.get('/:id', requireHrFinanceOrAdmin, (req, res) => {
  try {
    const db = getDb();
    const record = db.prepare(`
      SELECT eed.*,
        sl.leave_type as gate_pass_type, sl.duration_hours as gate_pass_duration,
        sl.remark as gate_pass_remark, sl.quota_breach as gate_pass_quota_breach,
        edd.id as deduction_id, edd.deduction_type, edd.deduction_amount,
        edd.finance_status as deduction_finance_status, edd.hr_remark, edd.finance_remark
      FROM early_exit_detections eed
      LEFT JOIN short_leaves sl ON sl.id = eed.short_leave_id
      LEFT JOIN early_exit_deductions edd ON edd.early_exit_detection_id = eed.id
        AND edd.finance_status != 'cancelled'
      WHERE eed.id = ?
    `).get(req.params.id);

    if (!record) return res.status(404).json({ success: false, error: 'Detection not found' });
    return res.json({ success: true, data: record });
  } catch (err) {
    console.error('[early-exits] GET /:id error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
