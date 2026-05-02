const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { getDb, logAudit } = require('../database/db');
const { parseEESLFile, extractEmployees, getImportSummary } = require('../services/parser');
const { pairNightShifts, applyPairingToDb } = require('../services/nightShift');
const { detectMissPunches, applyMissPunchFlags } = require('../services/missPunch');
const { calcShiftMetrics } = require('../utils/shiftMetrics');
const { calculateDays, saveDayCalculation } = require('../services/dayCalculation');
const { computeEmployeeSalary, saveSalaryComputation } = require('../services/salaryComputation');
const { isContractorForPayroll } = require('../utils/employeeClassification');

function friendlyParseError(errorMsg) {
  if (!errorMsg) return 'Import failed due to an unexpected error. Please verify the file and try again.';
  const msg = errorMsg.toLowerCase();
  if (msg.includes('date range')) return "This file doesn't appear to be in EESL biometric format. Please upload the .xls file exported from your EESL machine.";
  if (msg.includes('landmark') || msg.includes('day header') || msg.includes('day columns')) return "Could not find the expected data structure in this file. Make sure it's an unmodified EESL export.";
  if (msg.includes('no employee') || msg.includes('no sheets')) return "The file was recognized but contains no employee attendance data. Check if the correct date range was exported.";
  if (msg.includes('not supported') || msg.includes('invalid')) return "This file format is not supported. Please upload a .xls or .xlsx file from the EESL biometric system.";
  return 'Import failed due to an unexpected error. Please verify the file and try again.';
}

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
        results.push({ file: file.originalname, success: false, error: parseResult.error, userMessage: friendlyParseError(parseResult.error) });
        continue;
      }

      // ── Multi-month rejection (route-level guard) ──
      // A file whose date range crosses a month boundary cannot be filed under
      // a single monthly_imports row safely. Even with the parser's day-number/
      // weekday cross-checks, multi-month uploads create ambiguous semantics
      // for `attendance_processed.month/year` (records would be stamped under
      // the start month even when their date is in the next month). This is
      // the second line of defence that makes the 2026-05-02 corruption class
      // impossible regardless of UI behaviour.
      if (parseResult.endMonth !== parseResult.month || parseResult.endYear !== parseResult.year) {
        results.push({
          file: file.originalname,
          success: false,
          error: 'Multi-month file rejected',
          userMessage: `This file spans ${parseResult.startDate} to ${parseResult.endDate}, which crosses a month boundary. Please re-export from EESL with a single-month range (1st to last day of one month) and try again.`
        });
        continue;
      }

      // ── UI/file month reconciliation ──
      // If the frontend sends month+year in the upload body, confirm the file's
      // detected month/year matches what HR selected on screen. This catches
      // operator errors like "selected April but uploaded March file".
      // No-op when frontend doesn't pass these fields.
      const uiMonth = req.body.month ? parseInt(req.body.month) : null;
      const uiYear = req.body.year ? parseInt(req.body.year) : null;
      if (uiMonth && uiYear && (uiMonth !== parseResult.month || uiYear !== parseResult.year)) {
        results.push({
          file: file.originalname,
          success: false,
          error: 'UI/file month mismatch',
          userMessage: `You selected ${uiMonth}/${uiYear} in the page but this file's date range is ${parseResult.startDate} to ${parseResult.endDate} (month ${parseResult.month}/${parseResult.year}). Please re-select the correct month and try again, or re-export from EESL for the month you selected.`
        });
        continue;
      }

      const { month, year, allRecords, sheets } = parseResult;

      // Process each sheet independently
      for (const sheet of sheets) {
        let { company, records } = sheet;

        // ── Robust company resolution ──────────────────────────
        // Strategy: try multiple sources to determine the real company name
        if (!company || company === sheet.sheetName) {
          company = null;

          // 1. Try employee master — scan ALL unique codes until we find a match
          const allCodes = [...new Set(records.map(r => r.employeeCode))];
          for (const code of allCodes) {
            const emp = db.prepare("SELECT company FROM employees WHERE code = ? AND company IS NOT NULL AND company != ''").get(code);
            if (emp?.company) { company = emp.company; break; }
          }

          // 2. Try attendance_raw from previous imports — employees may have been imported before
          if (!company) {
            for (const code of allCodes.slice(0, 50)) {
              const raw = db.prepare("SELECT company FROM attendance_raw WHERE employee_code = ? AND company IS NOT NULL AND company != '' LIMIT 1").get(code);
              if (raw?.company) { company = raw.company; break; }
            }
          }

          // 3. Try matching by sheet index — in this EESL system, Sheet1 is typically the first company
          //    and Sheet2 is the second. Look at what companies exist in previous imports.
          if (!company) {
            const sheetIdx = sheets.indexOf(sheet);
            const knownCompanies = db.prepare(
              "SELECT DISTINCT company FROM monthly_imports WHERE company IS NOT NULL AND company NOT LIKE 'Sheet%' ORDER BY company"
            ).all().map(c => c.company);
            if (knownCompanies.length > 0 && sheetIdx < knownCompanies.length) {
              company = knownCompanies[sheetIdx];
            }
          }

          // 4. Last resort: use sheet name
          company = company || sheet.sheetName;

          // Propagate resolved company to all records
          sheet.company = company;
          for (const r of records) { if (!r.company) r.company = company; }
        }

        // ── Check for existing import — auto-upsert if same month ──
        const existing = db.prepare(
          'SELECT id, reimport_count FROM monthly_imports WHERE month = ? AND year = ? AND company = ?'
        ).get(month, year, company);

        // Clean up legacy data: migrate any stale company names (Sheet1/Sheet2/Default/NULL) to real company
        if (!existing) {
          const staleNames = [sheet.sheetName, 'Sheet1', 'Sheet2', 'Default'];
          for (const staleName of staleNames) {
            const legacyImport = db.prepare(
              'SELECT id FROM monthly_imports WHERE month = ? AND year = ? AND company = ?'
            ).get(month, year, staleName);
            if (legacyImport) {
              db.prepare('UPDATE monthly_imports SET company = ? WHERE id = ?').run(company, legacyImport.id);
              db.prepare('UPDATE attendance_raw SET company = ? WHERE import_id = ?').run(company, legacyImport.id);
              db.prepare('UPDATE attendance_processed SET company = ? WHERE month = ? AND year = ? AND company = ?')
                .run(company, month, year, staleName);
            }
          }
          // Also migrate records with NULL company for this month
          db.prepare('UPDATE attendance_processed SET company = ? WHERE month = ? AND year = ? AND company IS NULL')
            .run(company, month, year);
          // attendance_raw has no month/year columns — join via import_id → monthly_imports
          db.prepare(`UPDATE attendance_raw SET company = ?
            WHERE import_id IN (
              SELECT id FROM monthly_imports WHERE month = ? AND year = ?
            ) AND company IS NULL`).run(company, month, year);

          // Deduplicate: if migration created conflicts with the unique index,
          // keep only the newest record per (employee_code, date, company)
          db.prepare(`
            DELETE FROM attendance_processed WHERE id NOT IN (
              SELECT MAX(id) FROM attendance_processed
              WHERE month = ? AND year = ? AND company = ?
              GROUP BY employee_code, date, company
            ) AND month = ? AND year = ? AND company = ?
          `).run(month, year, company, month, year, company);
        }

        // Re-check after potential migration
        const existingAfterMigration = db.prepare(
          'SELECT id, reimport_count FROM monthly_imports WHERE month = ? AND year = ? AND company = ?'
        ).get(month, year, company);

        const overwrite = req.body.overwrite === 'true';
        // Auto-upsert: if data exists, always upsert (don't block the user)
        const isReimport = !!existingAfterMigration;

        let importId;
        let upsertStats = { inserted: 0, updated: 0 };
        // Reimport-only counters; initialized so the per-file response can
        // safely read them even on fresh imports (where they stay 0/null).
        let correctionSnapshot = [];
        let replayedCount = 0;
        let skippedCount = 0;
        let recomputeStats = null;

        if (isReimport) {
          // ── REIMPORT: Upsert strategy ──
          // 1. Update the monthly_imports record (keep same ID, bump reimport count)
          importId = existingAfterMigration.id;
          db.prepare(`
            UPDATE monthly_imports SET
              file_name = ?, record_count = ?, employee_count = ?,
              sheet_name = ?, reimport_count = reimport_count + 1,
              last_reimported_at = datetime('now'), imported_at = datetime('now'),
              stage_1_done = 1, stage_2_done = 0, stage_3_done = 0,
              stage_4_done = 0, stage_5_done = 0, stage_6_done = 0, stage_7_done = 0
            WHERE id = ?
          `).run(file.originalname, records.length, sheet.employeeCount, sheet.sheetName, importId);

          // 2. Clear old raw records — first detach from attendance_processed to avoid FK violation
          db.prepare('UPDATE attendance_processed SET raw_id = NULL WHERE raw_id IN (SELECT id FROM attendance_raw WHERE import_id = ?)').run(importId);
          db.prepare('DELETE FROM attendance_raw WHERE import_id = ?').run(importId);

          // 3. Clear night shift pairs (will be re-detected)
          db.prepare('DELETE FROM night_shift_pairs WHERE month = ? AND year = ? AND company = ?')
            .run(month, year, company);

          // ── REIMPORT SAFETY: snapshot manual corrections before overwriting ──
          // The updateProcessed below zeroes miss_punch_resolved, correction_source,
          // correction_remark, etc. We capture those rows first and replay them
          // after the upsert so HR's resolution work survives a reimport.
          correctionSnapshot = db.prepare(`
            SELECT employee_code, date, status_final, in_time_final, out_time_final,
                   miss_punch_resolved, correction_source, correction_remark,
                   miss_punch_finance_status, miss_punch_finance_reviewed_by,
                   miss_punch_finance_reviewed_at, miss_punch_finance_notes,
                   actual_hours
            FROM attendance_processed
            WHERE month = ? AND year = ? AND company = ?
              AND (miss_punch_resolved = 1 OR correction_source IS NOT NULL OR correction_remark IS NOT NULL)
          `).all(month, year, company);
          console.log(`[reimport] Snapshotted ${correctionSnapshot.length} manual corrections for ${month}/${year} ${company}`);

          // 4. Upsert attendance_processed with audit logging
          const getExisting = db.prepare(`
            SELECT id, status_final, in_time_final, out_time_final, company
            FROM attendance_processed WHERE employee_code = ? AND date = ?
          `);
          const updateProcessed = db.prepare(`
            UPDATE attendance_processed SET
              raw_id = NULL, employee_id = ?, status_original = ?, status_final = ?,
              in_time_original = ?, in_time_final = ?,
              out_time_original = ?, out_time_final = ?,
              company = ?,
              actual_hours = NULL, is_night_shift = 0, night_pair_date = NULL,
              night_pair_confidence = NULL, is_night_out_only = 0,
              is_miss_punch = 0, miss_punch_type = NULL, miss_punch_resolved = 0,
              correction_source = NULL, correction_remark = NULL,
              is_late_arrival = 0, late_by_minutes = 0,
              is_early_departure = 0, early_by_minutes = 0,
              is_overtime = 0, overtime_minutes = 0,
              stage_2_done = 0, stage_3_done = 0, stage_4_done = 0, stage_5_done = 0
            WHERE employee_code = ? AND date = ?
          `);
          const insertProcessed = db.prepare(`
            INSERT INTO attendance_processed (
              employee_id, employee_code, date, status_original, status_final,
              in_time_original, in_time_final, out_time_original, out_time_final,
              actual_hours, month, year, company
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)
            ON CONFLICT(employee_code, date) DO UPDATE SET
              employee_id = excluded.employee_id,
              status_original = excluded.status_original,
              status_final = excluded.status_final,
              in_time_original = excluded.in_time_original,
              in_time_final = excluded.in_time_final,
              out_time_original = excluded.out_time_original,
              out_time_final = excluded.out_time_final,
              month = excluded.month,
              year = excluded.year,
              company = excluded.company
          `);

          const upsertTxn = db.transaction((recs) => {
            for (const r of recs) {
              const empRow = db.prepare('SELECT id FROM employees WHERE code = ?').get(r.employeeCode);
              const empId = empRow ? empRow.id : null;
              const existingRec = getExisting.get(r.employeeCode, r.date);

              if (existingRec) {
                // Log changes to audit_log before overwriting
                if (existingRec.status_final !== r.status || existingRec.in_time_final !== r.inTime || existingRec.out_time_final !== r.outTime || existingRec.company !== r.company) {
                  logAudit('attendance_processed', existingRec.id, 'reimport',
                    JSON.stringify({ status: existingRec.status_final, in: existingRec.in_time_final, out: existingRec.out_time_final, company: existingRec.company }),
                    JSON.stringify({ status: r.status, in: r.inTime, out: r.outTime, company: r.company }),
                    'reimport', `EESL reimport: ${file.originalname}`
                  );
                  updateProcessed.run(empId, r.status, r.status, r.inTime, r.inTime, r.outTime, r.outTime,
                    r.company, r.employeeCode, r.date);
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

          // ── REIMPORT SAFETY: replay snapshotted corrections ──
          // Strategy: only replay if the new (clean) data still shows a miss-punch
          // shape similar to what was originally resolved. If the new data is
          // already complete (both IN+OUT present and status is P-class), the
          // previous resolution is moot and we DO NOT replay — the new data
          // supersedes the old correction. This avoids stamping stale 'HR_MANUAL'
          // metadata onto rows that no longer need correcting.
          const replayTxn = db.transaction(() => {
            for (const snap of correctionSnapshot) {
              const newRow = db.prepare(`
                SELECT id, status_final, in_time_final, out_time_final, is_miss_punch
                FROM attendance_processed
                WHERE employee_code = ? AND date = ? AND company = ?
              `).get(snap.employee_code, snap.date, company);
              if (!newRow) { skippedCount++; continue; }

              const newIsComplete = newRow.in_time_final && newRow.out_time_final &&
                                    ['P', 'WOP', '½P', 'WO½P'].includes(newRow.status_final);
              if (newIsComplete) { skippedCount++; continue; }

              db.prepare(`
                UPDATE attendance_processed SET
                  status_final = ?, in_time_final = ?, out_time_final = ?,
                  miss_punch_resolved = ?, correction_source = ?, correction_remark = ?,
                  miss_punch_finance_status = ?, miss_punch_finance_reviewed_by = ?,
                  miss_punch_finance_reviewed_at = ?, miss_punch_finance_notes = ?,
                  actual_hours = ?, stage_2_done = 1
                WHERE id = ?
              `).run(
                snap.status_final, snap.in_time_final, snap.out_time_final,
                snap.miss_punch_resolved, snap.correction_source, snap.correction_remark,
                snap.miss_punch_finance_status, snap.miss_punch_finance_reviewed_by,
                snap.miss_punch_finance_reviewed_at, snap.miss_punch_finance_notes,
                snap.actual_hours, newRow.id
              );

              logAudit('attendance_processed', newRow.id, 'reimport_replay',
                JSON.stringify({ status: newRow.status_final, in: newRow.in_time_final, out: newRow.out_time_final }),
                JSON.stringify({ status: snap.status_final, in: snap.in_time_final, out: snap.out_time_final }),
                'reimport_replay', `Restored manual correction (source: ${snap.correction_source || 'unknown'})`
              );
              replayedCount++;
            }
          });
          replayTxn();
          console.log(`[reimport] Replayed ${replayedCount} corrections; skipped ${skippedCount} (data now complete or row missing)`);

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
            ON CONFLICT(employee_code, date) DO UPDATE SET
              raw_id = excluded.raw_id,
              employee_id = excluded.employee_id,
              status_original = excluded.status_original,
              status_final = excluded.status_final,
              in_time_original = excluded.in_time_original,
              in_time_final = excluded.in_time_final,
              out_time_original = excluded.out_time_original,
              out_time_final = excluded.out_time_final,
              company = excluded.company
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

        // Get all shifts for lookup. The employee's assigned shift (via
        // default_shift_id or shift_code) is always used — night vs day timings
        // come from the shift's own night_start_time/night_end_time columns,
        // not from a separate global NIGHT shift row.
        const allShifts = db.prepare('SELECT * FROM shifts').all();
        const shiftByCode = {};
        const shiftById = {};
        for (const s of allShifts) { shiftByCode[s.code] = s; shiftById[s.id] = s; }
        const defaultDayShift = shiftByCode['DAY'] || allShifts[0];

        // Get OT threshold from policy config
        const otThresholdRow = db.prepare("SELECT value FROM policy_config WHERE key = 'ot_threshold_hours'").get();
        const otThresholdHours = parseFloat(otThresholdRow?.value || '12');

        const updatePost = db.prepare(`
          UPDATE attendance_processed SET
            actual_hours = ?, is_late_arrival = ?, late_by_minutes = ?,
            is_early_departure = ?, early_by_minutes = ?,
            is_overtime = ?, overtime_minutes = ?,
            is_left_late = ?, left_late_minutes = ?,
            is_night_shift = CASE WHEN ? = 1 THEN 1 ELSE is_night_shift END,
            shift_id = ?, shift_detected = ?
          WHERE id = ?
        `);

        const postTxn = db.transaction(() => {
          for (const rec of postProcessRecords) {
            if (rec.is_night_out_only) continue;
            const inTime = rec.in_time_final || rec.in_time_original;
            const outTime = rec.out_time_final || rec.out_time_original;
            if (!inTime) continue;

            const empShift = rec.default_shift_id ? shiftById[rec.default_shift_id]
                           : (rec.shift_code ? shiftByCode[rec.shift_code] : null);
            const shift = empShift || defaultDayShift;

            const m = calcShiftMetrics({
              inTime, outTime,
              statusOriginal: rec.status_original,
              shift,
              otThresholdHours
            });

            updatePost.run(
              m.actualHours, m.isLate, m.lateBy,
              m.isEarly, m.earlyBy,
              m.isOT, m.otMinutes,
              m.isLeftLate, m.leftLateMinutes,
              m.isNight,
              shift?.id || null, shift?.name || null,
              rec.id
            );
          }
        });
        postTxn();

        // ── REIMPORT SAFETY: auto-recompute downstream tables ──
        // Day-calc and salary-compute that ran on the corrupted pre-reimport
        // data are now stale. Run them now, synchronously, so HR doesn't have
        // to click "Compute Days" + "Compute Salary" manually after a recovery
        // reimport. Wrapped in a try/catch so a recompute failure surfaces in
        // the response without 500'ing the entire upload.
        if (isReimport) {
          try {
            recomputeStats = runReimportRecompute(db, month, year, company, req.requestId);
          } catch (recomputeErr) {
            console.error('[reimport] Auto-recompute failed:', recomputeErr.message);
            recomputeStats = { error: recomputeErr.message };
          }
        }

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
          manualCorrectionsSnapshot: correctionSnapshot.length,
          manualCorrectionsReplayed: replayedCount,
          manualCorrectionsSkipped: skippedCount,
          recomputed: isReimport,
          recomputeStats,
          summary
        });
      }
    } catch (err) {
      console.error('Import error for file', file.originalname, ':', err);
      results.push({ file: file.originalname, success: false, error: err.message, userMessage: friendlyParseError(err.message) });
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
            SELECT DISTINCT ap.employee_code, e.id as emp_id, e.name, e.department, e.employment_type, e.status, e.inactive_since, e.auto_inactive
            FROM attendance_processed ap
            LEFT JOIN employees e ON ap.employee_code = e.code
            WHERE ap.month = ? AND ap.year = ? AND ap.is_night_out_only = 0
          `).all(im, iy);

          for (const emp of allEmps) {
            if (emp.status === 'Exited') continue;

            // Auto-reactivation: ONLY for auto-detected inactives (auto_inactive=1).
            // Manual "Mark Left" actions by HR must never be overridden by reimports.
            if ((emp.status === 'Left' || emp.status === 'Inactive') && emp.inactive_since && emp.auto_inactive === 1) {
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
  // Use subquery for raw data to avoid cartesian join inflation
  const eeslEmployees = db.prepare(`
    SELECT ap.employee_code, ap.company,
           COALESCE(raw_info.employee_name, e.name, '') as eesl_name,
           COALESCE(raw_info.department, e.department, '') as eesl_department,
           COUNT(ap.id) as punch_records,
           SUM(CASE WHEN ap.status_final IN ('P', 'WOP', '½P', 'WO½P') THEN 1 ELSE 0 END) as present_records
    FROM attendance_processed ap
    LEFT JOIN employees e ON e.code = ap.employee_code
    LEFT JOIN (
      SELECT employee_code, company,
             MAX(employee_name) as employee_name,
             MAX(department) as department
      FROM attendance_raw
      GROUP BY employee_code, company
    ) raw_info ON raw_info.employee_code = ap.employee_code AND raw_info.company = ap.company
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

/**
 * POST /api/import/reconciliation/update-departments
 * Bulk update employee departments from reconciliation corrections.
 * HR corrects departments in EESL; this endpoint syncs those corrections to the master.
 * Also updates attendance_raw records for consistency.
 */
router.post('/reconciliation/update-departments', (req, res) => {
  const db = getDb();
  const { corrections } = req.body;
  // corrections: [{ code, department, company? }]

  if (!corrections || !Array.isArray(corrections) || corrections.length === 0) {
    return res.status(400).json({ success: false, error: 'No corrections provided' });
  }

  const updateEmp = db.prepare(`
    UPDATE employees SET department = ?, updated_at = datetime('now') WHERE code = ?
  `);
  const updateRaw = db.prepare(`
    UPDATE attendance_raw SET department = ? WHERE employee_code = ?
  `);

  let updated = 0;
  const txn = db.transaction(() => {
    for (const c of corrections) {
      if (!c.code || !c.department) continue;
      const dept = String(c.department).trim();
      const result = updateEmp.run(dept, c.code);
      if (result.changes > 0) {
        updated++;
        updateRaw.run(dept, c.code);
        logAudit('employees', null, 'department_correction',
          null, JSON.stringify({ code: c.code, department: dept }),
          req.user?.username || 'hr', 'Department corrected from reconciliation'
        );
      }
    }
  });
  txn();

  res.json({ success: true, updated, message: `Updated ${updated} employee department(s)` });
});

/**
 * POST /api/import/reconciliation/add-to-master
 * Add new EESL employees to the master with their EESL department.
 */
router.post('/reconciliation/add-to-master', (req, res) => {
  const db = getDb();
  const { employees } = req.body;
  // employees: [{ code, name, department, company }]

  if (!employees || !Array.isArray(employees) || employees.length === 0) {
    return res.status(400).json({ success: false, error: 'No employees provided' });
  }

  const upsertEmp = db.prepare(`
    INSERT INTO employees (code, name, department, company, status, is_data_complete)
    VALUES (?, ?, ?, ?, 'Active', 0)
    ON CONFLICT(code) DO UPDATE SET
      name = COALESCE(NULLIF(excluded.name, ''), employees.name),
      department = COALESCE(NULLIF(excluded.department, ''), employees.department),
      company = COALESCE(NULLIF(excluded.company, ''), employees.company),
      -- Preserve manually marked Left/Inactive/Exited status; only set Active otherwise
      status = CASE
        WHEN employees.status IN ('Left', 'Inactive', 'Exited') AND employees.auto_inactive = 0 THEN employees.status
        ELSE 'Active'
      END,
      updated_at = datetime('now')
  `);

  let added = 0;
  const txn = db.transaction(() => {
    for (const e of employees) {
      if (!e.code) continue;
      upsertEmp.run(e.code, e.name || e.code, e.department || '', e.company || '');
      added++;
    }
  });
  txn();

  res.json({ success: true, added, message: `Added/updated ${added} employee(s) in master` });
});

// ── REIMPORT AUTO-RECOMPUTE HELPER ──
// On reimport, day_calculations and salary_computations that ran on the
// pre-reimport (corrupted) data are stale. This helper deletes them and
// re-runs the day-calc + salary-compute orchestration so the user doesn't
// have to click "Compute Days" + "Compute Salary" manually after a recovery
// reimport.
//
// The orchestration logic below is COPIED verbatim from
// backend/src/routes/payroll.js POST /calculate-days and POST /compute-salary.
// It deliberately duplicates ~70 lines of loop body so this recovery flow
// doesn't take a hard dependency on payroll.js refactor scheduling.
//
// TODO: extract to backend/src/services/recompute.js when payroll.js refactor
// is in scope. Until then, both copies must stay in sync — change one, change
// both.
function runReimportRecompute(db, month, year, company, requestId) {
  const startTime = Date.now();
  console.log(`[reimport] Recompute started for ${month}/${year} ${company}`);

  const stats = { dayCalcRows: 0, salaryRows: 0, dayCalcErrors: 0, salaryErrors: 0 };

  // 1. Delete stale downstream rows for this cycle
  const dayCalcDel = db.prepare(
    'DELETE FROM day_calculations WHERE month = ? AND year = ? AND company = ?'
  ).run(month, year, company);
  const salaryDel = db.prepare(
    'DELETE FROM salary_computations WHERE month = ? AND year = ? AND company = ?'
  ).run(month, year, company);
  console.log(
    `[reimport] Cleared ${dayCalcDel.changes} day_calculations + ${salaryDel.changes} salary_computations rows for ${month}/${year} ${company}`
  );

  // 2. Day calculation — orchestration copied from payroll.js POST /calculate-days
  // Ghost cleanup pass — normalises blank ghost rows to status 'A' so day-calc
  // sees consistent data. Same query as payroll.js.
  db.prepare(`
    UPDATE attendance_processed
    SET status_original = CASE
          WHEN status_original IS NULL OR status_original = '' THEN 'A'
          ELSE status_original
        END,
        status_final = 'A'
    WHERE month = ? AND year = ? AND company = ?
    AND (status_final IS NULL OR status_final = '')
    AND (status_original IS NULL OR status_original = '')
    AND (in_time_original IS NULL OR in_time_original = '')
    AND (out_time_original IS NULL OR out_time_original = '')
    AND is_night_out_only = 0
  `).run(month, year, company);

  const empCodes = db.prepare(`
    SELECT DISTINCT ap.employee_code
    FROM attendance_processed ap
    LEFT JOIN employees e ON ap.employee_code = e.code
    WHERE ap.month = ? AND ap.year = ? AND ap.company = ?
    AND ap.is_night_out_only = 0
    AND (e.status IS NULL OR e.status NOT IN ('Exited'))
  `).all(month, year, company).map(r => r.employee_code);

  if (empCodes.length > 0) {
    db.prepare(`
      UPDATE employees SET status = 'Active', was_left_returned = 1, updated_at = datetime('now')
      WHERE code IN (${empCodes.map(() => '?').join(',')})
      AND status = 'Left'
    `).run(...empCodes);
  }

  const monthStr = String(month).padStart(2, '0');
  const holidays = db.prepare(`
    SELECT date, name, type, applicable_to
    FROM holidays WHERE date LIKE ?
  `).all(`${year}-${monthStr}-%`);

  const dayCalcTxn = db.transaction(() => {
    for (const empCode of empCodes) {
      try {
        const emp = db.prepare('SELECT id FROM employees WHERE code = ?').get(empCode);
        const records = db.prepare(`
          SELECT * FROM attendance_processed
          WHERE employee_code = ? AND month = ? AND year = ? AND company = ?
        `).all(empCode, month, year, company);

        const leaveBalances = { CL: 0, EL: 0, SL: 0 };
        if (emp) {
          const lbs = db.prepare('SELECT * FROM leave_balances WHERE employee_id = ? AND year = ?').all(emp.id, year);
          for (const lb of lbs) leaveBalances[lb.leave_type] = lb.balance || 0;
        }

        const empFull = db.prepare('SELECT * FROM employees WHERE code = ?').get(empCode);
        const isContract = isContractorForPayroll(empFull);

        // Auto-create PENDING extra_duty_grants from WOP/WO½P (idempotent via UQ)
        if (!isContract) {
          const wopInsert = db.prepare(`
            INSERT OR IGNORE INTO extra_duty_grants
              (employee_code, employee_id, grant_date, month, year, company,
               grant_type, duty_days, verification_source, remarks,
               linked_attendance_id, status, finance_status, requested_by)
            VALUES (?, ?, ?, ?, ?, ?, 'OVERNIGHT_STAY', ?, 'BIOMETRIC_AUTO',
                    'Auto-detected from attendance WOP status', ?, 'PENDING',
                    'UNREVIEWED', 'system')
          `);
          for (const rec of records) {
            const status = rec.status_final || rec.status_original || '';
            if (status !== 'WOP' && status !== 'WO½P') continue;
            const dutyDays = status === 'WO½P' ? 0.5 : 1.0;
            wopInsert.run(
              empCode, emp?.id, rec.date, parseInt(month), parseInt(year),
              company || rec.company || '', dutyDays, rec.id
            );
          }
        }

        let manualExtraDutyDays = 0;
        let financeEDDays = 0;
        if (!isContract) {
          try {
            const wopDates = new Set(
              records
                .filter(r => {
                  const s = r.status_final || r.status_original || '';
                  return s === 'WOP' || s === 'WO½P';
                })
                .map(r => r.date)
            );
            const approvedGrants = db.prepare(`
              SELECT grant_date, duty_days FROM extra_duty_grants
              WHERE employee_code = ? AND month = ? AND year = ?
                AND status = 'APPROVED' AND finance_status = 'FINANCE_APPROVED'
                AND grant_type != 'PRE_BIOMETRIC_ACTIVATION'
            `).all(empCode, month, year);
            const filtered = approvedGrants.filter(g => !wopDates.has(g.grant_date));
            manualExtraDutyDays = filtered.reduce((sum, g) => sum + (g.duty_days || 0), 0);
            financeEDDays = manualExtraDutyDays;
          } catch (_) {}
        }

        const lastDay = new Date(year, month, 0).getDate();
        const monthStartDate = `${year}-${monthStr}-01`;
        const monthEndDate = `${year}-${monthStr}-${String(lastDay).padStart(2, '0')}`;

        const approvedLeaves = db.prepare(`
          SELECT leave_type, start_date, end_date, days, status
          FROM leave_applications
          WHERE employee_code = ?
            AND status = 'Approved'
            AND start_date <= ?
            AND end_date >= ?
        `).all(empCode, monthEndDate, monthStartDate);

        let approvedCompOff = [];
        try {
          approvedCompOff = db.prepare(`
            SELECT start_date, end_date, duty_days, finance_status
            FROM compensatory_off_requests
            WHERE employee_code = ?
              AND month = ? AND year = ?
              AND finance_status = 'approved'
          `).all(empCode, parseInt(month), parseInt(year));
        } catch (_) {}

        const calcResult = calculateDays(
          empCode, parseInt(month), parseInt(year), company || '',
          records, leaveBalances, holidays,
          {
            isContractor: isContract,
            weeklyOffDay: empFull?.weekly_off_day ?? 0,
            employmentType: empFull?.employment_type || 'Permanent',
            manualExtraDutyDays,
            financeEDDays,
            dateOfJoining: empFull?.date_of_joining || null,
            approvedLeaves,
            approvedCompOff
          },
          requestId
        );
        calcResult.employeeId = emp?.id;
        saveDayCalculation(db, calcResult);
        stats.dayCalcRows++;
      } catch (err) {
        console.error(`[reimport] day-calc failed for ${empCode}: ${err.message}`);
        stats.dayCalcErrors++;
      }
    }
  });
  dayCalcTxn();
  db.prepare('UPDATE monthly_imports SET stage_6_done = 1 WHERE month = ? AND year = ? AND company = ?')
    .run(month, year, company);

  // 3. Salary computation — orchestration copied from payroll.js POST /compute-salary
  const employees = db.prepare(`
    SELECT DISTINCT e.*
    FROM employees e
    INNER JOIN day_calculations dc ON e.code = dc.employee_code
    WHERE dc.month = ? AND dc.year = ? AND dc.company = ?
    AND (e.status IS NULL OR e.status NOT IN ('Exited'))
  `).all(month, year, company);

  const salaryTxn = db.transaction(() => {
    for (const emp of employees) {
      try {
        const comp = computeEmployeeSalary(db, emp, parseInt(month), parseInt(year), company || '', requestId);
        if (comp.success) {
          saveSalaryComputation(db, comp);
          stats.salaryRows++;
        } else if (!comp.excluded && !comp.silentSkip) {
          stats.salaryErrors++;
        }
      } catch (err) {
        console.error(`[reimport] salary-compute failed for ${emp.code}: ${err.message}`);
        stats.salaryErrors++;
      }
    }
  });
  salaryTxn();
  db.prepare('UPDATE monthly_imports SET stage_7_done = 1 WHERE month = ? AND year = ? AND company = ?')
    .run(month, year, company);

  const elapsedMs = Date.now() - startTime;
  console.log(
    `[reimport] Recompute completed in ${elapsedMs}ms — dayCalc=${stats.dayCalcRows} salary=${stats.salaryRows} ` +
    `(dayCalcErrors=${stats.dayCalcErrors} salaryErrors=${stats.salaryErrors})`
  );
  return { ...stats, elapsedMs };
}

module.exports = router;
