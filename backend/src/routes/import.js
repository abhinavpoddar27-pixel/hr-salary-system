const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { getDb, logAudit } = require('../database/db');
const { parseEESLFile, extractEmployees, getImportSummary } = require('../services/parser');
const { pairNightShifts, applyPairingToDb } = require('../services/nightShift');
const { detectMissPunches, applyMissPunchFlags } = require('../services/missPunch');

const upload = multer({
  dest: path.join(__dirname, '../../../uploads'),
  fileFilter: (req, file, cb) => {
    if (file.originalname.toLowerCase().endsWith('.xls') || file.originalname.toLowerCase().endsWith('.xlsx')) {
      cb(null, true);
    } else {
      cb(new Error('Only .xls files are accepted'));
    }
  },
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB
});

/**
 * POST /api/import/upload
 * Upload and parse one or more EESL .xls files
 */
router.post('/upload', upload.array('files', 20), async (req, res) => {
  const db = getDb();
  const files = req.files;

  if (!files || files.length === 0) {
    return res.status(400).json({ success: false, error: 'No files uploaded' });
  }

  const results = [];

  for (const file of files) {
    try {
      const parseResult = await parseEESLFile(file.path);

      if (!parseResult.success) {
        results.push({ file: file.originalname, success: false, error: parseResult.error });
        continue;
      }

      const { month, year, allRecords, sheets } = parseResult;

      // Process each sheet independently
      for (const sheet of sheets) {
        const { company, records } = sheet;

        // Check for existing import
        const existing = db.prepare(
          'SELECT id, reimport_count FROM monthly_imports WHERE month = ? AND year = ? AND company = ?'
        ).get(month, year, company);

        const overwrite = req.body.overwrite === 'true';
        const isReimport = !!(existing && overwrite);

        if (existing && !overwrite) {
          results.push({
            file: file.originalname,
            sheet: sheet.sheetName,
            success: false,
            error: `Data for ${company} ${month}/${year} already exists. Set overwrite=true to replace.`,
            existingImportId: existing.id
          });
          continue;
        }

        let importId;
        let upsertStats = { inserted: 0, updated: 0 };

        if (isReimport) {
          // ── REIMPORT: Upsert strategy ──
          // 1. Update the monthly_imports record (keep same ID, bump reimport count)
          importId = existing.id;
          db.prepare(`
            UPDATE monthly_imports SET
              file_name = ?, record_count = ?, employee_count = ?,
              sheet_name = ?, reimport_count = reimport_count + 1,
              last_reimported_at = datetime('now'), imported_at = datetime('now'),
              stage_1_done = 1, stage_2_done = 0, stage_3_done = 0,
              stage_4_done = 0, stage_5_done = 0, stage_6_done = 0, stage_7_done = 0
            WHERE id = ?
          `).run(file.originalname, records.length, sheet.employeeCount, sheet.sheetName, importId);

          // 2. attendance_raw: append-only archive (new import_id via a fresh sub-record)
          //    We keep old raw records for history. Insert new ones with same import_id.
          //    But first, clear old raw records for this import (they're archived by the audit trail)
          db.prepare('DELETE FROM attendance_raw WHERE import_id = ?').run(importId);

          // 3. Clear night shift pairs (will be re-detected)
          db.prepare('DELETE FROM night_shift_pairs WHERE month = ? AND year = ? AND company = ?')
            .run(month, year, company);

          // 4. Upsert attendance_processed with audit logging
          const getExisting = db.prepare(`
            SELECT id, status_final, in_time_final, out_time_final
            FROM attendance_processed WHERE employee_code = ? AND date = ? AND company = ?
          `);
          const updateProcessed = db.prepare(`
            UPDATE attendance_processed SET
              raw_id = NULL, employee_id = ?, status_original = ?, status_final = ?,
              in_time_original = ?, in_time_final = ?,
              out_time_original = ?, out_time_final = ?,
              actual_hours = NULL, is_night_shift = 0, night_pair_date = NULL,
              night_pair_confidence = NULL, is_night_out_only = 0,
              is_miss_punch = 0, miss_punch_type = NULL, miss_punch_resolved = 0,
              correction_source = NULL, correction_remark = NULL,
              is_late_arrival = 0, late_by_minutes = 0,
              is_early_departure = 0, early_by_minutes = 0,
              is_overtime = 0, overtime_minutes = 0,
              stage_2_done = 0, stage_3_done = 0, stage_4_done = 0, stage_5_done = 0
            WHERE employee_code = ? AND date = ? AND company = ?
          `);
          const insertProcessed = db.prepare(`
            INSERT INTO attendance_processed (
              employee_id, employee_code, date, status_original, status_final,
              in_time_original, in_time_final, out_time_original, out_time_final,
              actual_hours, month, year, company
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)
          `);

          const upsertTxn = db.transaction((recs) => {
            for (const r of recs) {
              const empRow = db.prepare('SELECT id FROM employees WHERE code = ?').get(r.employeeCode);
              const empId = empRow ? empRow.id : null;
              const existingRec = getExisting.get(r.employeeCode, r.date, r.company);

              if (existingRec) {
                // Log changes to audit_log before overwriting
                if (existingRec.status_final !== r.status || existingRec.in_time_final !== r.inTime || existingRec.out_time_final !== r.outTime) {
                  logAudit('attendance_processed', existingRec.id, 'reimport',
                    JSON.stringify({ status: existingRec.status_final, in: existingRec.in_time_final, out: existingRec.out_time_final }),
                    JSON.stringify({ status: r.status, in: r.inTime, out: r.outTime }),
                    'reimport', `EESL reimport: ${file.originalname}`
                  );
                  updateProcessed.run(empId, r.status, r.status, r.inTime, r.inTime, r.outTime, r.outTime,
                    r.employeeCode, r.date, r.company);
                  upsertStats.updated++;
                }
                // If data is identical, skip (no-op)
              } else {
                insertProcessed.run(empId, r.employeeCode, r.date, r.status, r.status,
                  r.inTime, r.inTime, r.outTime, r.outTime, month, year, r.company);
                upsertStats.inserted++;
              }
            }
          });
          upsertTxn(records);

        } else {
          // ── FRESH IMPORT: Standard insert ──
          const importInsert = db.prepare(`
            INSERT INTO monthly_imports (month, year, file_name, record_count, employee_count, sheet_name, company, status, stage_1_done)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'imported', 1)
          `);
          const importRow = importInsert.run(month, year, file.originalname, records.length, sheet.employeeCount, sheet.sheetName, company);
          importId = importRow.lastInsertRowid;
          upsertStats.inserted = records.length;
        }

        // Insert raw records (always — serves as append-only archive)
        const insertRaw = db.prepare(`
          INSERT OR IGNORE INTO attendance_raw (import_id, employee_code, employee_name, department, company, date, day_of_week, status_code, in_time, out_time, total_hours_eesl)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        const insertRawTxn = db.transaction((recs) => {
          for (const r of recs) {
            insertRaw.run(importId, r.employeeCode, r.employeeName, r.department, r.company, r.date, r.dayOfWeek, r.status, r.inTime, r.outTime, r.totalHours);
          }
        });
        insertRawTxn(records);

        // Auto-populate or update employee master
        const employees = extractEmployees(records);
        const upsertEmp = db.prepare(`
          INSERT INTO employees (code, name, department, company, status, is_data_complete)
          VALUES (?, COALESCE(NULLIF(?, ''), ?), ?, ?, 'Active', 0)
          ON CONFLICT(code) DO UPDATE SET
            name = COALESCE(NULLIF(excluded.name, ''), employees.name),
            department = COALESCE(NULLIF(excluded.department, ''), employees.department),
            updated_at = datetime('now')
        `);
        const empTxn = db.transaction((emps) => {
          for (const e of emps) upsertEmp.run(e.code, e.name, e.code, e.department, e.company);
        });
        empTxn(employees);

        // For fresh imports only: bulk insert processed records
        if (!isReimport) {
          const bulkInsertProcessed = db.prepare(`
            INSERT OR IGNORE INTO attendance_processed (
              raw_id, employee_id, employee_code, date, status_original, status_final,
              in_time_original, in_time_final, out_time_original, out_time_final,
              actual_hours, month, year, company
            )
            SELECT ar.id, e.id, ar.employee_code, ar.date,
              ar.status_code, ar.status_code,
              ar.in_time, ar.in_time,
              ar.out_time, ar.out_time,
              NULL,
              ?, ?, ?
            FROM attendance_raw ar
            LEFT JOIN employees e ON ar.employee_code = e.code
            WHERE ar.import_id = ?
          `);
          bulkInsertProcessed.run(month, year, company, importId);
        }

        // Auto-run night shift pairing
        const processedRecords = db.prepare(`
          SELECT * FROM attendance_processed WHERE month = ? AND year = ? AND company = ?
        `).all(month, year, company);

        const { pairs, updatedRecords, boundaryFlags } = pairNightShifts(processedRecords);
        applyPairingToDb(db, pairs, updatedRecords, month, year, company);

        // Detect miss punches
        const updatedProcessed = db.prepare(`
          SELECT * FROM attendance_processed WHERE month = ? AND year = ? AND company = ?
        `).all(month, year, company);
        const missPunches = detectMissPunches(updatedProcessed);
        applyMissPunchFlags(db, missPunches);

        // ── Post-import: calculate actual_hours, detect late arrivals & night shifts ──
        const postProcessRecords = db.prepare(`
          SELECT ap.id, ap.in_time_original, ap.out_time_original, ap.in_time_final, ap.out_time_final,
                 ap.status_original, ap.is_night_shift, ap.is_night_out_only,
                 e.default_shift_id, e.shift_code
          FROM attendance_processed ap
          LEFT JOIN employees e ON ap.employee_code = e.code
          WHERE ap.month = ? AND ap.year = ? AND ap.company = ?
        `).all(month, year, company);

        // Get all shifts for lookup
        const allShifts = db.prepare('SELECT * FROM shifts').all();
        const shiftByCode = {};
        const shiftById = {};
        for (const s of allShifts) { shiftByCode[s.code] = s; shiftById[s.id] = s; }
        const defaultDayShift = shiftByCode['DAY'] || allShifts[0];
        const defaultNightShift = shiftByCode['NIGHT'];

        // Get OT threshold from policy config
        const otThresholdRow = db.prepare("SELECT value FROM policy_config WHERE key = 'ot_threshold_hours'").get();
        const otThresholdHours = parseFloat(otThresholdRow?.value || '12');

        const updatePost = db.prepare(`
          UPDATE attendance_processed SET
            actual_hours = ?, is_late_arrival = ?, late_by_minutes = ?,
            is_early_departure = ?, early_by_minutes = ?,
            is_overtime = ?, overtime_minutes = ?,
            is_night_shift = CASE WHEN ? = 1 THEN 1 ELSE is_night_shift END,
            shift_id = COALESCE(shift_id, ?), shift_detected = COALESCE(shift_detected, ?)
          WHERE id = ?
        `);

        const postTxn = db.transaction(() => {
          for (const rec of postProcessRecords) {
            if (rec.is_night_out_only) continue;
            const inTime = rec.in_time_final || rec.in_time_original;
            const outTime = rec.out_time_final || rec.out_time_original;
            if (!inTime) continue;

            // Calculate actual hours
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

            // Detect night shift from in_time (>= 18:00 or < 06:00)
            const [inH] = inTime.split(':').map(Number);
            const isNight = (!isNaN(inH) && (inH >= 19 || inH < 6)) || rec.is_night_shift === 1;

            // Pick shift based on time
            const empShift = rec.default_shift_id ? shiftById[rec.default_shift_id] : null;
            const shift = isNight ? (defaultNightShift || empShift || defaultDayShift) : (empShift || defaultDayShift);

            const status = rec.status_original;
            const isPresent = status === 'P' || status === 'WOP';
            const inMin = inH * 60 + (parseInt(inTime.split(':')[1]) || 0);

            // Detect late arrival
            let isLate = 0, lateBy = 0;
            if (inTime && shift && shift.start_time && isPresent) {
              const [sh, sm] = shift.start_time.split(':').map(Number);
              if (!isNaN(inH) && !isNaN(sh)) {
                let diffMin = inMin - (sh * 60 + sm);
                if (isNight && diffMin < -600) diffMin += 1440;
                if (!isNight && diffMin < 0) diffMin = 0;
                const grace = shift.grace_minutes || 9;
                if (diffMin > grace) {
                  isLate = 1;
                  lateBy = diffMin;
                }
              }
            }

            // Detect early departure
            let isEarly = 0, earlyBy = 0;
            if (outTime && shift && shift.end_time && isPresent && status !== '½P' && status !== 'WO½P') {
              const [oh2, om2] = outTime.split(':').map(Number);
              const [eh, em] = shift.end_time.split(':').map(Number);
              if (!isNaN(oh2) && !isNaN(eh)) {
                let outMin = oh2 * 60 + om2;
                let endMin = eh * 60 + em;
                // Handle overnight shift end (e.g., end_time=08:00 for night shift)
                if (isNight && endMin < 720) endMin += 1440;
                if (isNight && outMin < 720) outMin += 1440;
                const diffMin = endMin - outMin;
                const grace = shift.grace_minutes || 9;
                if (diffMin > grace) {
                  isEarly = 1;
                  earlyBy = diffMin;
                }
              }
            }

            // Detect overtime
            let isOT = 0, otMinutes = 0;
            if (actualHours && actualHours > otThresholdHours && isPresent) {
              isOT = 1;
              otMinutes = Math.round((actualHours - otThresholdHours) * 60);
            }

            updatePost.run(
              actualHours, isLate, lateBy,
              isEarly, earlyBy,
              isOT, otMinutes,
              isNight ? 1 : 0,
              shift?.id || null, shift?.name || null,
              rec.id
            );
          }
        });
        postTxn();

        const summary = getImportSummary(parseResult);

        results.push({
          file: file.originalname,
          sheet: sheet.sheetName,
          success: true,
          importId,
          month, year, company,
          isReimport,
          employeeCount: sheet.employeeCount,
          recordCount: records.length,
          upsertStats,
          nightShiftPairs: pairs.length,
          missPunches: missPunches.length,
          boundaryFlags: boundaryFlags.length,
          summary
        });
      }
    } catch (err) {
      console.error('Import error for file', file.originalname, ':', err);
      results.push({ file: file.originalname, success: false, error: err.message });
    } finally {
      // Clean up temp file
      try { fs.unlinkSync(file.path); } catch (e) {}
    }
  }

  // Auto-detect left employees after successful import (non-blocking)
  const successfulImports = results.filter(r => r.success);
  if (successfulImports.length > 0) {
    setTimeout(() => {
      try {
        const dbRef = getDb();
        // Gather unique month/year combos from successful imports
        const monthYearPairs = new Map();
        for (const r of successfulImports) {
          const key = `${r.month}-${r.year}`;
          if (!monthYearPairs.has(key)) monthYearPairs.set(key, { month: r.month, year: r.year });
        }

        for (const { month: im, year: iy } of monthYearPairs.values()) {
          const allEmps = dbRef.prepare(`
            SELECT DISTINCT ap.employee_code, e.id as emp_id, e.name, e.department, e.employment_type, e.status, e.inactive_since
            FROM attendance_processed ap
            LEFT JOIN employees e ON ap.employee_code = e.code
            WHERE ap.month = ? AND ap.year = ? AND ap.is_night_out_only = 0
          `).all(im, iy);

          for (const emp of allEmps) {
            if (emp.status === 'Exited') continue;

            // Auto-reactivation: if Left/Inactive and has new present records after inactive_since
            if ((emp.status === 'Left' || emp.status === 'Inactive') && emp.inactive_since) {
              const newPresent = dbRef.prepare(`
                SELECT COUNT(*) as cnt FROM attendance_processed
                WHERE employee_code = ? AND is_night_out_only = 0
                AND date > ?
                AND (COALESCE(status_final, status_original) IN ('P','½P','WOP','WO½P'))
              `).get(emp.employee_code, emp.inactive_since);

              if (newPresent && newPresent.cnt > 0) {
                dbRef.prepare(`
                  UPDATE employees SET status = 'Active', auto_inactive = 0, was_left_returned = 1,
                  updated_at = datetime('now')
                  WHERE code = ?
                `).run(emp.employee_code);
                continue;
              }
            }

            if (emp.status === 'Left' || emp.status === 'Inactive') continue;

            // Mark as Left if absent 14+ consecutive days
            const lastPresent = dbRef.prepare(`
              SELECT MAX(date) as last_date FROM attendance_processed
              WHERE employee_code = ? AND is_night_out_only = 0
              AND (COALESCE(status_final, status_original) IN ('P','½P','WOP','WO½P'))
            `).get(emp.employee_code);

            const latestRecord = dbRef.prepare(`
              SELECT MAX(date) as last_date FROM attendance_processed
              WHERE employee_code = ? AND is_night_out_only = 0 AND month = ? AND year = ?
            `).get(emp.employee_code, im, iy);

            if (!lastPresent?.last_date && latestRecord?.last_date) {
              dbRef.prepare(`
                UPDATE employees SET status = 'Left', auto_inactive = 1,
                inactive_since = ?, updated_at = datetime('now')
                WHERE code = ? AND status NOT IN ('Exited', 'Left', 'Inactive')
              `).run(latestRecord.last_date, emp.employee_code);
              continue;
            }

            if (lastPresent?.last_date && latestRecord?.last_date) {
              const lastPresentDate = new Date(lastPresent.last_date + 'T12:00:00');
              const latestDate = new Date(latestRecord.last_date + 'T12:00:00');
              const diffDays = Math.floor((latestDate - lastPresentDate) / (1000 * 60 * 60 * 24));

              if (diffDays >= 14) {
                dbRef.prepare(`
                  UPDATE employees SET status = 'Left', auto_inactive = 1,
                  inactive_since = ?, updated_at = datetime('now')
                  WHERE code = ? AND status NOT IN ('Exited', 'Left', 'Inactive')
                `).run(lastPresent.last_date, emp.employee_code);
              }
            }
          }
        }
        console.log('✅ Auto-detect left employees completed after import');
      } catch (err) {
        console.error('Auto-detect left error:', err.message);
      }
    }, 100);
  }

  res.json({ success: true, results });
});

/**
 * GET /api/import/history
 * List all imports
 */
router.get('/history', (req, res) => {
  const db = getDb();
  const imports = db.prepare(`
    SELECT * FROM monthly_imports ORDER BY year DESC, month DESC, company ASC
  `).all();
  res.json({ success: true, data: imports });
});

/**
 * GET /api/import/summary/:month/:year
 * Get import summary for a month
 */
router.get('/summary/:month/:year', (req, res) => {
  const db = getDb();
  const { month, year } = req.params;

  const imports = db.prepare('SELECT * FROM monthly_imports WHERE month = ? AND year = ?').all(month, year);
  if (!imports.length) return res.json({ success: false, error: 'No import found for this month' });

  const totalEmployees = db.prepare(`
    SELECT COUNT(DISTINCT employee_code) as count
    FROM attendance_processed WHERE month = ? AND year = ?
  `).get(month, year);

  const missPunchCount = db.prepare(`
    SELECT COUNT(*) as count FROM attendance_processed
    WHERE month = ? AND year = ? AND is_miss_punch = 1
  `).get(month, year);

  const missPunchResolved = db.prepare(`
    SELECT COUNT(*) as count FROM attendance_processed
    WHERE month = ? AND year = ? AND is_miss_punch = 1 AND miss_punch_resolved = 1
  `).get(month, year);

  const nightPairs = db.prepare(`
    SELECT COUNT(*) as count FROM night_shift_pairs WHERE month = ? AND year = ?
  `).get(month, year);

  const deptBreakdown = db.prepare(`
    SELECT e.department, COUNT(DISTINCT ap.employee_code) as employees
    FROM attendance_processed ap
    LEFT JOIN employees e ON ap.employee_code = e.code
    WHERE ap.month = ? AND ap.year = ? AND ap.is_night_out_only = 0
    GROUP BY e.department ORDER BY employees DESC
  `).all(month, year);

  res.json({
    success: true,
    data: {
      imports,
      totalEmployees: totalEmployees.count,
      missPunches: { total: missPunchCount.count, resolved: missPunchResolved.count, pending: missPunchCount.count - missPunchResolved.count },
      nightShiftPairs: nightPairs.count,
      departmentBreakdown: deptBreakdown,
      pipelineStatus: imports[0] ? {
        stage1: imports[0].stage_1_done,
        stage2: imports[0].stage_2_done,
        stage3: imports[0].stage_3_done,
        stage4: imports[0].stage_4_done,
        stage5: imports[0].stage_5_done,
        stage6: imports[0].stage_6_done,
        stage7: imports[0].stage_7_done,
      } : null
    }
  });
});

/**
 * POST /api/import/stage/:stage/complete
 * Mark a pipeline stage as complete
 */
router.post('/stage/:stage/complete', (req, res) => {
  const db = getDb();
  const { stage } = req.params;
  const { month, year, company } = req.body;

  const stageNum = parseInt(stage);
  if (stageNum < 1 || stageNum > 7) return res.status(400).json({ success: false, error: 'Invalid stage number' });

  db.prepare(`UPDATE monthly_imports SET stage_${stageNum}_done = 1 WHERE month = ? AND year = ?`)
    .run(month || req.body.month, year || req.body.year);

  res.json({ success: true, message: `Stage ${stageNum} marked as complete` });
});

/**
 * DELETE /api/import/:importId
 * Delete an import
 */
router.delete('/:importId', (req, res) => {
  const db = getDb();
  const { importId } = req.params;

  const imp = db.prepare('SELECT * FROM monthly_imports WHERE id = ?').get(importId);
  if (!imp) return res.status(404).json({ success: false, error: 'Import not found' });

  if (imp.is_finalised) return res.status(400).json({ success: false, error: 'Cannot delete a finalised month' });

  const txn = db.transaction(() => {
    db.prepare('DELETE FROM attendance_raw WHERE import_id = ?').run(importId);
    db.prepare('DELETE FROM attendance_processed WHERE month = ? AND year = ? AND company = ?').run(imp.month, imp.year, imp.company);
    db.prepare('DELETE FROM night_shift_pairs WHERE month = ? AND year = ? AND company = ?').run(imp.month, imp.year, imp.company);
    db.prepare('DELETE FROM day_calculations WHERE month = ? AND year = ? AND company = ?').run(imp.month, imp.year, imp.company);
    db.prepare('DELETE FROM monthly_imports WHERE id = ?').run(importId);
  });
  txn();

  res.json({ success: true, message: 'Import deleted successfully' });
});

/**
 * GET /api/import/reconciliation/:month/:year
 * Post-import reconciliation: compare EESL data with employee master
 */
router.get('/reconciliation/:month/:year', (req, res) => {
  const db = getDb();
  const { month, year } = req.params;
  const { company } = req.query;

  // Employees found in EESL attendance data for this month
  const eeslEmployees = db.prepare(`
    SELECT DISTINCT ap.employee_code, ap.company,
           COALESCE(ar.employee_name, '') as eesl_name,
           COALESCE(ar.department, '') as eesl_department,
           COUNT(ap.id) as punch_records,
           SUM(CASE WHEN ap.status_final IN ('P', 'WOP', '½P', 'WO½P') AND ap.is_night_out_only = 0 THEN 1 ELSE 0 END) as present_records
    FROM attendance_processed ap
    LEFT JOIN attendance_raw ar ON ar.employee_code = ap.employee_code AND ar.company = ap.company
    WHERE ap.month = ? AND ap.year = ?
    ${company ? 'AND ap.company = ?' : ''}
    AND ap.is_night_out_only = 0
    GROUP BY ap.employee_code, ap.company
  `).all(...[month, year, company].filter(Boolean));

  // Active employees in master
  const masterEmployees = db.prepare(`
    SELECT code, name, department, company, status
    FROM employees
    WHERE status = 'Active'
    ${company ? 'AND company = ?' : ''}
  `).all(...(company ? [company] : []));

  const eeslCodes = new Set(eeslEmployees.map(e => e.employee_code));
  const masterCodes = new Set(masterEmployees.map(e => e.code));

  // Matched: in both EESL and master
  const matched = eeslEmployees.filter(e => masterCodes.has(e.employee_code));

  // New in EESL (not in master)
  const newInEesl = eeslEmployees.filter(e => !masterCodes.has(e.employee_code));

  // Missing from EESL (in master but not in EESL)
  const missingFromEesl = masterEmployees.filter(e => !eeslCodes.has(e.code));

  // Zero punch employees (in EESL but 0 present records)
  const zeroPunch = eeslEmployees.filter(e => e.present_records === 0);

  // Company-wise breakdown
  const byCompany = {};
  for (const e of eeslEmployees) {
    const c = e.company || 'Unknown';
    if (!byCompany[c]) byCompany[c] = { total: 0, matched: 0, new: 0, records: 0 };
    byCompany[c].total++;
    byCompany[c].records += e.punch_records;
    if (masterCodes.has(e.employee_code)) byCompany[c].matched++;
    else byCompany[c].new++;
  }

  res.json({
    success: true,
    data: {
      matched: matched.map(e => ({ code: e.employee_code, name: e.eesl_name, company: e.company, records: e.punch_records, present: e.present_records })),
      newInEesl: newInEesl.map(e => ({ code: e.employee_code, name: e.eesl_name, company: e.company, department: e.eesl_department, records: e.punch_records })),
      missingFromEesl: missingFromEesl.map(e => ({ code: e.code, name: e.name, company: e.company, department: e.department })),
      zeroPunch: zeroPunch.map(e => ({ code: e.employee_code, name: e.eesl_name, company: e.company })),
      byCompany,
    },
    summary: {
      eeslTotal: eeslEmployees.length,
      masterTotal: masterEmployees.length,
      matched: matched.length,
      newInEesl: newInEesl.length,
      missingFromEesl: missingFromEesl.length,
      zeroPunch: zeroPunch.length,
      totalRecords: eeslEmployees.reduce((s, e) => s + e.punch_records, 0),
    },
    month, year
  });
});

module.exports = router;
