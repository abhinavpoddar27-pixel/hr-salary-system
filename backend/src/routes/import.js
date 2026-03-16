const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { getDb } = require('../database/db');
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
          'SELECT id FROM monthly_imports WHERE month = ? AND year = ? AND company = ?'
        ).get(month, year, company);

        const overwrite = req.body.overwrite === 'true';

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

        // Delete existing data if overwriting
        if (existing && overwrite) {
          db.prepare('DELETE FROM attendance_raw WHERE import_id = ?').run(existing.id);
          db.prepare('DELETE FROM attendance_processed WHERE month = ? AND year = ? AND company = ?').run(month, year, company);
          db.prepare('DELETE FROM night_shift_pairs WHERE month = ? AND year = ? AND company = ?').run(month, year, company);
          db.prepare('DELETE FROM monthly_imports WHERE id = ?').run(existing.id);
        }

        // Insert import record
        const importInsert = db.prepare(`
          INSERT INTO monthly_imports (month, year, file_name, record_count, employee_count, sheet_name, company, status, stage_1_done)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'imported', 1)
        `);
        const importRow = importInsert.run(month, year, file.originalname, records.length, sheet.employeeCount, sheet.sheetName, company);
        const importId = importRow.lastInsertRowid;

        // Insert raw records in batches
        const insertRaw = db.prepare(`
          INSERT INTO attendance_raw (import_id, employee_code, employee_name, department, company, date, day_of_week, status_code, in_time, out_time, total_hours_eesl)
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
          VALUES (?, ?, ?, ?, 'Active', 0)
          ON CONFLICT(code) DO UPDATE SET
            name = COALESCE(NULLIF(excluded.name, ''), employees.name),
            department = COALESCE(NULLIF(excluded.department, ''), employees.department),
            updated_at = datetime('now')
        `);
        const empTxn = db.transaction((emps) => {
          for (const e of emps) upsertEmp.run(e.code, e.name, e.department, e.company);
        });
        empTxn(employees);

        // Insert processed records
        const insertProcessed = db.prepare(`
          INSERT INTO attendance_processed (
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
        insertProcessed.run(month, year, company, importId);

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

        const summary = getImportSummary(parseResult);

        results.push({
          file: file.originalname,
          sheet: sheet.sheetName,
          success: true,
          importId,
          month, year, company,
          employeeCount: sheet.employeeCount,
          recordCount: records.length,
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

module.exports = router;
