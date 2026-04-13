const express = require('express');
const router = express.Router();
const { getDb, logAudit } = require('../database/db');
const { resolveMissPunch, bulkResolveMissPunches } = require('../services/missPunch');
const { applyPairingToDb } = require('../services/nightShift');

/**
 * GET /api/attendance/processed
 * Get processed attendance records with filters
 */
router.get('/processed', (req, res) => {
  const db = getDb();
  const { month, year, company, department, employeeCode, isMissPunch, isNightShift } = req.query;

  let query = `
    SELECT ap.*, e.name as employee_name, e.department, e.designation
    FROM attendance_processed ap
    LEFT JOIN employees e ON ap.employee_code = e.code
    WHERE 1=1
  `;
  const params = [];

  if (month) { query += ' AND ap.month = ?'; params.push(month); }
  if (year) { query += ' AND ap.year = ?'; params.push(year); }
  if (company) { query += ' AND ap.company = ?'; params.push(company); }
  if (department) { query += ' AND e.department = ?'; params.push(department); }
  if (employeeCode) { query += ' AND ap.employee_code = ?'; params.push(employeeCode); }
  if (isMissPunch === 'true') { query += ' AND ap.is_miss_punch = 1'; }
  if (isNightShift === 'true') { query += ' AND ap.is_night_shift = 1 AND ap.is_night_out_only = 0'; }

  query += ' AND ap.is_night_out_only = 0 ORDER BY e.department, ap.employee_code, ap.date';

  const records = db.prepare(query).all(...params);
  res.json({ success: true, data: records, count: records.length });
});

/**
 * GET /api/attendance/miss-punches
 * Get miss punch records with summary
 */
router.get('/miss-punches', (req, res) => {
  const db = getDb();
  const { month, year, company, department, resolved, state } = req.query;

  let query = `
    SELECT ap.*, e.name as employee_name, e.department, e.designation
    FROM attendance_processed ap
    LEFT JOIN employees e ON ap.employee_code = e.code
    WHERE ap.is_miss_punch = 1
  `;
  const params = [];

  if (month) { query += ' AND ap.month = ?'; params.push(month); }
  if (year) { query += ' AND ap.year = ?'; params.push(year); }
  if (company) { query += ' AND ap.company = ?'; params.push(company); }
  if (department) { query += ' AND e.department = ?'; params.push(department); }

  // Legacy `resolved` filter kept for backwards compat. Prefer the new
  // `state` filter (April 2026) which maps the full HR→Finance workflow:
  //   hr-pending      — HR hasn't actioned OR finance rejected it (HR
  //                     needs to re-resolve; Stage 6 credits ½P in the
  //                     rejected case)
  //   finance-pending — HR resolved, finance hasn't reviewed yet
  //   approved        — finance said yes (flows into Stage 6/7)
  //   rejected        — finance said no (½P credit, visible in Stage 2)
  //   all (default)   — nothing hidden
  if (resolved === 'false') { query += ' AND ap.miss_punch_resolved = 0'; }
  if (resolved === 'true') { query += ' AND ap.miss_punch_resolved = 1'; }

  if (state === 'hr-pending') {
    query += " AND ap.miss_punch_resolved = 0";
  } else if (state === 'finance-pending') {
    query += " AND ap.miss_punch_resolved = 1 AND (ap.miss_punch_finance_status IS NULL OR ap.miss_punch_finance_status = '' OR ap.miss_punch_finance_status = 'pending')";
  } else if (state === 'approved') {
    query += " AND ap.miss_punch_finance_status = 'approved'";
  } else if (state === 'rejected') {
    query += " AND ap.miss_punch_finance_status = 'rejected'";
  }
  // state === 'all' (or unspecified) → no extra filter

  query += ' ORDER BY e.department, ap.employee_code, ap.date';

  const records = db.prepare(query).all(...params);

  // ── Full-pipeline summary (April 2026) ────────────────────
  // Compute buckets over the FULL month (unfiltered by state) so the
  // Stage 2 chip row shows correct totals even when a state filter is
  // active. Without this, clicking a chip would reload the page with
  // zero counts on the other chips.
  let fullQ = `SELECT is_miss_punch, miss_punch_resolved, miss_punch_finance_status,
                       miss_punch_type, ap.company
                FROM attendance_processed ap
                LEFT JOIN employees e ON ap.employee_code = e.code
                WHERE ap.is_miss_punch = 1`;
  const fullP = [];
  if (month) { fullQ += ' AND ap.month = ?'; fullP.push(month); }
  if (year) { fullQ += ' AND ap.year = ?'; fullP.push(year); }
  if (company) { fullQ += ' AND ap.company = ?'; fullP.push(company); }
  if (department) { fullQ += ' AND e.department = ?'; fullP.push(department); }
  const allForCounts = db.prepare(fullQ).all(...fullP);

  const classify = (r) => {
    const fs = r.miss_punch_finance_status;
    if (fs === 'approved') return 'approved';
    if (fs === 'rejected') return 'rejected';
    if (r.miss_punch_resolved === 1) return 'financePending';
    return 'hrPending';
  };

  const summary = {
    total: allForCounts.length,
    // Legacy keys (kept for backwards compat with callers still using the
    // old resolved/pending summary shape — analytics.js, dashboard widgets)
    resolved: allForCounts.filter(r => r.miss_punch_resolved).length,
    pending: allForCounts.filter(r => !r.miss_punch_resolved).length,
    // New pipeline split used by the Stage 2 + Finance Verify count banners
    hrPending: 0,
    financePending: 0,
    approved: 0,
    rejected: 0,
    byType: {},
    byDepartment: {}
  };
  for (const r of allForCounts) {
    summary[classify(r)]++;
    const type = r.miss_punch_type || 'UNKNOWN';
    summary.byType[type] = (summary.byType[type] || 0) + 1;
  }
  // By-department view only tracks records in the CURRENT filter slice
  // so the per-department panel reflects what the user is looking at.
  for (const r of records) {
    const dept = r.department || 'Unknown';
    if (!summary.byDepartment[dept]) summary.byDepartment[dept] = { total: 0, resolved: 0 };
    summary.byDepartment[dept].total++;
    if (r.miss_punch_resolved) summary.byDepartment[dept].resolved++;
  }

  res.json({ success: true, data: records, summary });
});

/**
 * POST /api/attendance/miss-punches/:id/resolve
 * Resolve a single miss punch
 */
router.post('/miss-punches/:id/resolve', (req, res) => {
  const db = getDb();
  const { id } = req.params;
  const { inTime, outTime, source, remark, convertToLeave, leaveType } = req.body;

  resolveMissPunch(db, parseInt(id), { inTime, outTime, source, remark, convertToLeave, leaveType });
  res.json({ success: true, message: 'Miss punch resolved' });
});

/**
 * POST /api/attendance/miss-punches/bulk-resolve
 * Bulk resolve multiple miss punches
 */
router.post('/miss-punches/bulk-resolve', (req, res) => {
  const db = getDb();
  const { recordIds, inTime, outTime, source, remark } = req.body;

  if (!recordIds || !Array.isArray(recordIds)) {
    return res.status(400).json({ success: false, error: 'recordIds array required' });
  }

  const result = bulkResolveMissPunches(db, recordIds, { inTime, outTime, source, remark });
  res.json({ success: true, result });
});

/**
 * GET /api/attendance/night-shifts
 * Get night shift pairing data
 */
router.get('/night-shifts', (req, res) => {
  const db = getDb();
  const { month, year, company } = req.query;

  let query = `
    SELECT nsp.*,
      e.name as employee_name, e.department
    FROM night_shift_pairs nsp
    LEFT JOIN employees e ON nsp.employee_code = e.code
    WHERE 1=1
  `;
  const params = [];

  if (month) { query += ' AND nsp.month = ?'; params.push(month); }
  if (year) { query += ' AND nsp.year = ?'; params.push(year); }
  if (company) { query += ' AND nsp.company = ?'; params.push(company); }

  query += ' ORDER BY e.department, nsp.employee_code, nsp.in_date';

  const pairs = db.prepare(query).all(...params);

  const summary = {
    total: pairs.length,
    confirmed: pairs.filter(p => p.is_confirmed).length,
    pending: pairs.filter(p => !p.is_confirmed && !p.is_rejected).length,
    highConfidence: pairs.filter(p => p.confidence === 'high').length,
    mediumConfidence: pairs.filter(p => p.confidence === 'medium').length,
    lowConfidence: pairs.filter(p => p.confidence === 'low').length
  };

  res.json({ success: true, data: pairs, summary });
});

/**
 * POST /api/attendance/night-shifts/:id/confirm
 * Confirm a night shift pairing
 */
router.post('/night-shifts/:id/confirm', (req, res) => {
  const db = getDb();
  const { id } = req.params;

  db.prepare('UPDATE night_shift_pairs SET is_confirmed = 1, is_rejected = 0 WHERE id = ?').run(id);
  res.json({ success: true });
});

/**
 * POST /api/attendance/night-shifts/:id/reject
 * Reject a night shift pairing
 */
router.post('/night-shifts/:id/reject', (req, res) => {
  const db = getDb();
  const { id } = req.params;

  const pair = db.prepare('SELECT * FROM night_shift_pairs WHERE id = ?').get(id);
  if (!pair) return res.status(404).json({ success: false, error: 'Pair not found' });

  db.prepare('UPDATE night_shift_pairs SET is_rejected = 1, is_confirmed = 0 WHERE id = ?').run(id);

  // Revert the IN record
  db.prepare(`UPDATE attendance_processed SET
    is_night_shift = 0, night_pair_date = NULL, out_time_final = NULL,
    is_miss_punch = 1, miss_punch_type = 'MISSING_OUT', miss_punch_resolved = 0
    WHERE id = ?`).run(pair.in_record_id);

  // Revert the OUT record
  db.prepare(`UPDATE attendance_processed SET
    is_night_out_only = 0, is_night_shift = 0, night_pair_date = NULL
    WHERE id = ?`).run(pair.out_record_id);

  res.json({ success: true });
});

/**
 * PUT /api/attendance/record/:id
 * Manual correction of attendance record
 */
router.put('/record/:id', (req, res) => {
  const db = getDb();
  const { id } = req.params;
  const { statusFinal, inTimeFinal, outTimeFinal, remark } = req.body;

  const existing = db.prepare('SELECT * FROM attendance_processed WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ success: false, error: 'Record not found' });

  const updates = {};
  if (statusFinal !== undefined) updates.status_final = statusFinal;
  if (inTimeFinal !== undefined) updates.in_time_final = inTimeFinal;
  if (outTimeFinal !== undefined) updates.out_time_final = outTimeFinal;
  if (remark !== undefined) updates.correction_remark = remark;
  updates.stage_5_done = 1;

  // Calculate actual hours if both times available
  const inT = inTimeFinal || existing.in_time_final;
  const outT = outTimeFinal || existing.out_time_final;
  if (inT && outT) {
    const [ih, im] = inT.split(':').map(Number);
    const [oh, om] = outT.split(':').map(Number);
    let hrs = (oh * 60 + om - (ih * 60 + im)) / 60;
    if (hrs < 0) hrs += 24;
    updates.actual_hours = Math.round(hrs * 100) / 100;
  }

  const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
  db.prepare(`UPDATE attendance_processed SET ${setClauses} WHERE id = ?`).run(...Object.values(updates), id);

  // Audit
  for (const [key, newVal] of Object.entries(updates)) {
    const oldVal = existing[key];
    if (String(oldVal) !== String(newVal)) {
      logAudit('attendance_processed', id, key, oldVal, newVal, 'Stage 5', remark || 'Manual correction');
    }
  }

  res.json({ success: true });
});

/**
 * GET /api/attendance/monthly-summary
 * Return per-employee attendance summary for a month
 * Used by Stage 5 to auto-display all employees
 */
router.get('/monthly-summary', (req, res) => {
  const db = getDb();
  const { month, year } = req.query;

  if (!month || !year) {
    return res.status(400).json({ success: false, error: 'month and year required' });
  }

  // Auto-recalculate metrics if most records have NULL actual_hours (one-time fix for pre-existing data)
  const nullHoursCount = db.prepare(`
    SELECT COUNT(*) as cnt FROM attendance_processed
    WHERE month = ? AND year = ? AND actual_hours IS NULL AND is_night_out_only = 0
    AND COALESCE(in_time_final, in_time_original) IS NOT NULL
    AND COALESCE(out_time_final, out_time_original) IS NOT NULL
  `).get(month, year);

  if (nullHoursCount.cnt > 10) {
    // Auto-recalculate in background
    const recsToFix = db.prepare(`
      SELECT ap.id, ap.in_time_original, ap.out_time_original, ap.in_time_final, ap.out_time_final,
             ap.status_original, ap.is_night_shift, ap.is_night_out_only,
             e.default_shift_id, e.shift_code
      FROM attendance_processed ap
      LEFT JOIN employees e ON ap.employee_code = e.code
      WHERE ap.month = ? AND ap.year = ?
    `).all(month, year);

    const allShifts = db.prepare('SELECT * FROM shifts').all();
    const shiftById = {};
    const shiftByCode = {};
    for (const s of allShifts) { shiftById[s.id] = s; shiftByCode[s.code] = s; }
    const defaultDayShift = shiftByCode['DAY'] || allShifts[0];
    const defaultNightShift = shiftByCode['NIGHT'];

    const fixStmt = db.prepare(`
      UPDATE attendance_processed SET
        actual_hours = COALESCE(?, actual_hours),
        is_late_arrival = CASE WHEN actual_hours IS NULL THEN ? ELSE is_late_arrival END,
        late_by_minutes = CASE WHEN actual_hours IS NULL THEN ? ELSE late_by_minutes END,
        is_night_shift = CASE WHEN ? = 1 THEN 1 ELSE is_night_shift END
      WHERE id = ?
    `);

    const fixTxn = db.transaction(() => {
      for (const rec of recsToFix) {
        if (rec.is_night_out_only) continue;
        const inTime = rec.in_time_final || rec.in_time_original;
        const outTime = rec.out_time_final || rec.out_time_original;
        if (!inTime) continue;

        let actualHours = null;
        if (inTime && outTime) {
          const [ih, im] = inTime.split(':').map(Number);
          const [oh, om] = outTime.split(':').map(Number);
          if (!isNaN(ih) && !isNaN(oh)) {
            let hrs = (oh * 60 + om - (ih * 60 + im)) / 60;
            if (hrs < 0) hrs += 24;
            actualHours = Math.round(hrs * 100) / 100;
          }
        }

        const [inH] = inTime.split(':').map(Number);
        const isNight = (!isNaN(inH) && (inH >= 19 || inH < 6)) || rec.is_night_shift === 1;
        const empShift = rec.default_shift_id ? shiftById[rec.default_shift_id]
                       : (rec.shift_code ? shiftByCode[rec.shift_code] : null);
        const shift = isNight ? (defaultNightShift || empShift || defaultDayShift) : (empShift || defaultDayShift);

        let isLate = 0, lateBy = 0;
        if (inTime && shift?.start_time && (rec.status_original === 'P' || rec.status_original === 'WOP')) {
          const [sh, sm] = shift.start_time.split(':').map(Number);
          if (!isNaN(inH) && !isNaN(sh)) {
            let diffMin = (inH * 60 + (parseInt(inTime.split(':')[1]) || 0)) - (sh * 60 + sm);
            if (isNight && diffMin < -600) diffMin += 1440;
            if (!isNight && diffMin < 0) diffMin = 0;
            if (diffMin > (shift.grace_minutes || 9)) { isLate = 1; lateBy = diffMin; }
          }
        }

        fixStmt.run(actualHours, isLate, lateBy, isNight ? 1 : 0, rec.id);
      }
    });
    fixTxn();
  }

  const records = db.prepare(`
    SELECT
      ap.employee_code,
      e.name as employee_name,
      e.department,
      e.status as employee_status,
      COUNT(CASE WHEN ap.is_night_out_only = 0 THEN 1 END) as total_records,
      SUM(CASE WHEN ap.is_night_out_only = 0 AND (COALESCE(ap.status_final, ap.status_original) IN ('P','WOP')) THEN 1
               WHEN ap.is_night_out_only = 0 AND (COALESCE(ap.status_final, ap.status_original) IN ('½P','WO½P')) THEN 0.5
               ELSE 0 END) as present_days,
      SUM(CASE WHEN ap.is_night_out_only = 0 AND COALESCE(ap.status_final, ap.status_original) = 'A' THEN 1 ELSE 0 END) as absent_days,
      SUM(CASE WHEN ap.is_night_out_only = 0 AND COALESCE(ap.status_final, ap.status_original) IN ('½P','WO½P') THEN 1 ELSE 0 END) as half_days,
      SUM(CASE WHEN ap.is_night_out_only = 0 AND COALESCE(ap.status_final, ap.status_original) IN ('WO','WOP','WO½P') THEN 1 ELSE 0 END) as week_offs,
      SUM(CASE WHEN ap.is_late_arrival = 1 AND ap.is_night_out_only = 0 THEN 1 ELSE 0 END) as late_days,
      SUM(CASE WHEN ap.is_night_out_only = 0 AND (ap.correction_remark IS NOT NULL AND ap.correction_remark != '') THEN 1 ELSE 0 END) as corrected_records,
      ROUND(AVG(CASE WHEN ap.actual_hours > 0 AND ap.is_night_out_only = 0 THEN ap.actual_hours END), 1) as avg_hours,
      SUM(CASE WHEN ap.is_miss_punch = 1 AND ap.miss_punch_resolved = 0 THEN 1 ELSE 0 END) as unresolved_miss_punches,
      SUM(CASE WHEN ap.is_night_out_only = 0 AND (
        ap.is_night_shift = 1
        OR (COALESCE(ap.in_time_final, ap.in_time_original) >= '19:00')
        OR (COALESCE(ap.in_time_final, ap.in_time_original) < '06:00' AND COALESCE(ap.in_time_final, ap.in_time_original) != '')
      ) THEN 1 ELSE 0 END) as night_shifts
    FROM attendance_processed ap
    LEFT JOIN employees e ON ap.employee_code = e.code
    WHERE ap.month = ? AND ap.year = ?
    AND (e.status IS NULL OR e.status != 'Left')
    GROUP BY ap.employee_code
    ORDER BY e.department, e.name
  `).all(month, year);

  res.json({ success: true, data: records });
});

/**
 * GET /api/attendance/register
 * Get full month grid for one employee
 */
router.get('/register', (req, res) => {
  const db = getDb();
  const { month, year, employeeCode, company } = req.query;

  const records = db.prepare(`
    SELECT ap.*, e.name as employee_name, e.department, e.designation,
           s.name as shift_name, s.start_time as shift_start, s.end_time as shift_end
    FROM attendance_processed ap
    LEFT JOIN employees e ON ap.employee_code = e.code
    LEFT JOIN shifts s ON ap.shift_id = s.id
    WHERE ap.month = ? AND ap.year = ?
    ${employeeCode ? 'AND ap.employee_code = ?' : ''}
    ${company ? 'AND ap.company = ?' : ''}
    ORDER BY ap.employee_code, ap.date
  `).all(...[month, year, employeeCode, company].filter(Boolean));

  res.json({ success: true, data: records });
});

/**
 * GET /api/attendance/daily/:code
 * Get daily attendance for an employee for calendar view
 */
router.get('/daily/:code', (req, res) => {
  const db = getDb();
  const { code } = req.params;
  const { month, year } = req.query;

  if (!month || !year) {
    return res.status(400).json({ success: false, error: 'month and year required' });
  }

  const records = db.prepare(`
    SELECT id, date, status_original, status_final,
      in_time_original, in_time_final, out_time_original, out_time_final,
      actual_hours, is_night_shift, is_miss_punch, miss_punch_type,
      miss_punch_resolved, is_late_arrival, late_by_minutes,
      overtime_minutes, correction_remark
    FROM attendance_processed
    WHERE employee_code = ? AND month = ? AND year = ? AND is_night_out_only = 0
    ORDER BY date
  `).all(code, month, year);

  res.json({ success: true, data: records });
});

/**
 * PUT /api/attendance/record/:id/shift
 * Update shift assignment for a record and recalculate late/early metrics
 */
router.put('/record/:id/shift', (req, res) => {
  const db = getDb();
  const { id } = req.params;
  const { shiftId } = req.body;

  const record = db.prepare('SELECT * FROM attendance_processed WHERE id = ?').get(id);
  if (!record) return res.status(404).json({ success: false, error: 'Record not found' });

  const shift = db.prepare('SELECT * FROM shifts WHERE id = ?').get(shiftId);
  if (!shift) return res.status(404).json({ success: false, error: 'Shift not found' });

  // Recalculate late arrival based on new shift
  let isLate = 0, lateBy = 0;
  const inTime = record.in_time_final || record.in_time_original;
  if (inTime && shift.start_time) {
    const [ih, im] = inTime.split(':').map(Number);
    const [sh, sm] = shift.start_time.split(':').map(Number);
    const grace = shift.grace_minutes || 0;
    const diffMin = (ih * 60 + im) - (sh * 60 + sm);
    if (diffMin > grace) {
      isLate = 1;
      lateBy = diffMin;
    }
  }

  db.prepare(`
    UPDATE attendance_processed SET
      shift_id = ?, shift_detected = ?,
      is_late_arrival = ?, late_by_minutes = ?
    WHERE id = ?
  `).run(shiftId, shift.name, isLate, lateBy, id);

  logAudit('attendance_processed', id, 'shift_id', record.shift_id, shiftId, 'Stage 3', `Shift changed to ${shift.name}`);

  res.json({ success: true, data: { shiftId, shiftName: shift.name, isLate, lateBy } });
});

/**
 * GET /api/attendance/validation-status
 * Check if all records are ready to proceed
 */
router.get('/validation-status', (req, res) => {
  const db = getDb();
  const { month, year, company } = req.query;

  const pendingMissPunches = db.prepare(`
    SELECT COUNT(*) as count FROM attendance_processed
    WHERE month = ? AND year = ? AND is_miss_punch = 1 AND miss_punch_resolved = 0
  `).get(month, year);

  const pendingNightShifts = db.prepare(`
    SELECT COUNT(*) as count FROM night_shift_pairs
    WHERE month = ? AND year = ? AND is_confirmed = 0 AND is_rejected = 0 AND confidence IN ('medium', 'low')
  `).get(month, year);

  const totalIssues = pendingMissPunches.count + pendingNightShifts.count;

  res.json({
    success: true,
    data: {
      pendingMissPunches: pendingMissPunches.count,
      pendingNightShifts: pendingNightShifts.count,
      totalIssues,
      isReadyToProcess: totalIssues === 0
    }
  });
});

/**
 * POST /api/attendance/recalculate-metrics
 * Recalculate actual_hours, late arrivals, and night shift flags for existing data
 */
router.post('/recalculate-metrics', (req, res) => {
  const db = getDb();
  const { month, year } = req.body;

  if (!month || !year) return res.status(400).json({ success: false, error: 'month and year required' });

  const records = db.prepare(`
    SELECT ap.id, ap.in_time_original, ap.out_time_original, ap.in_time_final, ap.out_time_final,
           ap.status_original, ap.is_night_shift, ap.is_night_out_only,
           e.default_shift_id, e.shift_code
    FROM attendance_processed ap
    LEFT JOIN employees e ON ap.employee_code = e.code
    WHERE ap.month = ? AND ap.year = ?
  `).all(month, year);

  const allShifts = db.prepare('SELECT * FROM shifts').all();
  const shiftByCode = {};
  const shiftById = {};
  for (const s of allShifts) { shiftByCode[s.code] = s; shiftById[s.id] = s; }
  const defaultDayShift = shiftByCode['DAY'] || allShifts[0];
  const defaultNightShift = shiftByCode['NIGHT'];

  // Late Coming Phase 1: also persist is_left_late / left_late_minutes here so
  // HR can re-run the recalc after assigning shifts and see the new data
  // reflected in analytics without a full re-import.
  const updateStmt = db.prepare(`
    UPDATE attendance_processed SET
      actual_hours = COALESCE(?, actual_hours),
      is_late_arrival = ?, late_by_minutes = ?,
      is_left_late = ?, left_late_minutes = ?,
      is_night_shift = CASE WHEN ? = 1 THEN 1 ELSE is_night_shift END,
      shift_id = COALESCE(shift_id, ?), shift_detected = COALESCE(shift_detected, ?)
    WHERE id = ?
  `);

  let updated = 0;
  const txn = db.transaction(() => {
    for (const rec of records) {
      if (rec.is_night_out_only) continue;
      const inTime = rec.in_time_final || rec.in_time_original;
      const outTime = rec.out_time_final || rec.out_time_original;
      if (!inTime) continue;

      let actualHours = null;
      if (inTime && outTime) {
        const [ih, im] = inTime.split(':').map(Number);
        const [oh, om] = outTime.split(':').map(Number);
        if (!isNaN(ih) && !isNaN(oh)) {
          let hrs = (oh * 60 + om - (ih * 60 + im)) / 60;
          if (hrs < 0) hrs += 24;
          actualHours = Math.round(hrs * 100) / 100;
        }
      }

      const [inH] = inTime.split(':').map(Number);
      const isNight = (!isNaN(inH) && (inH >= 19 || inH < 6)) || rec.is_night_shift === 1;

      const empShift = rec.default_shift_id ? shiftById[rec.default_shift_id]
                     : (rec.shift_code ? shiftByCode[rec.shift_code] : null);
      const shift = isNight ? (defaultNightShift || empShift || defaultDayShift) : (empShift || defaultDayShift);

      let isLate = 0, lateBy = 0;
      const status = rec.status_original;
      const isPresent = status === 'P' || status === 'WOP';
      if (inTime && shift && shift.start_time && isPresent) {
        const [sh, sm] = shift.start_time.split(':').map(Number);
        if (!isNaN(inH) && !isNaN(sh)) {
          let diffMin = (inH * 60 + (parseInt(inTime.split(':')[1]) || 0)) - (sh * 60 + sm);
          if (isNight && diffMin < -600) diffMin += 1440;
          if (!isNight && diffMin < 0) diffMin = 0;
          const grace = shift.grace_minutes || 9;
          if (diffMin > grace) {
            isLate = 1;
            lateBy = diffMin;
          }
        }
      }

      // Late Coming Phase 1: left-late detection (20+ min past shift end).
      let isLeftLate = 0, leftLateMinutes = 0;
      if (outTime && shift && shift.end_time && isPresent) {
        const [oh3, om3] = outTime.split(':').map(Number);
        const [eh3, em3] = shift.end_time.split(':').map(Number);
        if (!isNaN(oh3) && !isNaN(eh3)) {
          let outMin = oh3 * 60 + (om3 || 0);
          let endMin = eh3 * 60 + (em3 || 0);
          if (isNight) {
            if (endMin < 12 * 60) endMin += 24 * 60;
            if (outMin < 12 * 60) outMin += 24 * 60;
          }
          const diff = outMin - endMin;
          if (diff >= 20) {
            isLeftLate = 1;
            leftLateMinutes = diff;
          }
        }
      }

      updateStmt.run(
        actualHours, isLate, lateBy, isLeftLate, leftLateMinutes,
        isNight ? 1 : 0, shift?.id || null, shift?.name || null, rec.id
      );
      updated++;
    }
  });
  txn();

  res.json({ success: true, message: `Recalculated metrics for ${updated} records`, updated });
});

/**
 * POST /api/attendance/deduplicate
 * Comprehensive cleanup: deduplicate attendance_processed by employee+date.
 * Disables FK checks for safe bulk cleanup, then re-enables.
 */
router.post('/deduplicate', (req, res) => {
  try {
    const db = getDb();
    const { month, year } = req.body;
    if (!month || !year) return res.status(400).json({ success: false, error: 'month and year required' });

    const stats = { duplicatesRemoved: 0, companyFixed: 0, missPunchesDetected: 0 };

    // IMPORTANT: Disable FK checks for this cleanup operation
    db.pragma('foreign_keys = OFF');

    // Get ALL attendance_processed records for this month
    const allRecs = db.prepare(
      'SELECT id, employee_code, date, company FROM attendance_processed WHERE month = ? AND year = ?'
    ).all(month, year);

    // Determine real company name
    const staleSet = new Set(['Sheet1', 'Sheet2', 'Default', 'null', '']);
    const isStale = (c) => !c || staleSet.has(c);
    const realCompanies = [...new Set(allRecs.map(r => r.company).filter(c => c && !isStale(c)))];
    const mainCompany = realCompanies[0] || 'Asian Lakto Ind Ltd';

    // Group by employee_code + date → keep best record, delete rest
    const groups = {};
    for (const rec of allRecs) {
      const key = rec.employee_code + '|' + rec.date;
      if (!groups[key]) groups[key] = [];
      groups[key].push(rec);
    }

    const idsToDelete = new Set();
    const idsToFixCompany = [];

    for (const recs of Object.values(groups)) {
      // Sort: real company first, then newest
      recs.sort((a, b) => {
        const aR = isStale(a.company) ? 0 : 1;
        const bR = isStale(b.company) ? 0 : 1;
        if (bR !== aR) return bR - aR;
        return b.id - a.id;
      });
      // Keep first, delete rest
      for (let i = 1; i < recs.length; i++) idsToDelete.add(recs[i].id);
      // Fix keeper's company if stale
      if (isStale(recs[0].company)) idsToFixCompany.push(recs[0].id);
    }

    // Execute all changes in one transaction (FK checks OFF so no constraint issues)
    const txn = db.transaction(() => {
      // Delete duplicates
      const delStmt = db.prepare('DELETE FROM attendance_processed WHERE id = ?');
      for (const id of idsToDelete) delStmt.run(id);
      stats.duplicatesRemoved = idsToDelete.size;

      // Fix stale company names on kept records
      const updStmt = db.prepare('UPDATE attendance_processed SET company = ? WHERE id = ?');
      for (const id of idsToFixCompany) { updStmt.run(mainCompany, id); stats.companyFixed++; }

      // Clean orphaned night_shift_pairs
      db.prepare(`DELETE FROM night_shift_pairs WHERE month = ? AND year = ?`).run(month, year);

      // Skip attendance_raw and monthly_imports cleanup — they have complex FK/unique constraints
      // These are archival tables and don't affect the user-facing miss punch view

      // Re-run miss punch detection
      db.prepare('UPDATE attendance_processed SET is_miss_punch = 0, miss_punch_type = NULL WHERE month = ? AND year = ?')
        .run(month, year);
    });
    txn();

    // Re-enable FK checks
    db.pragma('foreign_keys = ON');

    // Detect miss punches on clean data
    const { detectMissPunches, applyMissPunchFlags } = require('../services/missPunch');
    const cleanRecs = db.prepare('SELECT * FROM attendance_processed WHERE month = ? AND year = ?').all(month, year);
    const missPunches = detectMissPunches(cleanRecs);
    applyMissPunchFlags(db, missPunches);
    stats.missPunchesDetected = missPunches.length;

    res.json({
      success: true,
      message: `Removed ${stats.duplicatesRemoved} duplicates, fixed ${stats.companyFixed} company names, detected ${stats.missPunchesDetected} miss punches`,
      stats
    });
  } catch (err) {
    const db = getDb();
    db.pragma('foreign_keys = ON'); // ensure re-enabled on error
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
