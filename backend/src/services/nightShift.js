/**
 * Night Shift Auto-Pairing Service
 *
 * The EESL biometric system treats each calendar date independently.
 * Night shift workers punch IN on Day N (evening ~20:00) but punch OUT
 * on Day N+1 (morning ~08:00). This service pairs those cross-midnight records.
 *
 * From actual data analysis (Sep 2025):
 * ~190 night-shift IN punches per month have no OUT time.
 * The corresponding OUT appears on the next calendar day.
 */

const { parseHoursToDecimal } = require('./parser');

/**
 * Parse HH:MM to minutes from midnight
 */
function timeToMinutes(timeStr) {
  if (!timeStr) return -1;
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + m;
}

/**
 * Calculate hours between night IN and next-day OUT
 */
function calcNightShiftHours(inTime, outTime) {
  const inMins = timeToMinutes(inTime);
  const outMins = timeToMinutes(outTime);
  // Night shift: IN in evening, OUT next morning
  // If OUT is < IN, add 24 hours to OUT
  const totalMins = outMins < inMins ? (24 * 60 - inMins + outMins) : (outMins - inMins);
  return Math.round(totalMins) / 60;
}

/**
 * Determine pairing confidence level
 * High: IN ≥ 19:00, OUT ≤ 09:00, hours 9-14
 * Medium: IN ≥ 18:00, OUT ≤ 12:00, hours 7-16
 * Low: anything else
 */
function getPairingConfidence(inTime, outTime) {
  const inMins = timeToMinutes(inTime);
  const outMins = timeToMinutes(outTime);
  const hours = calcNightShiftHours(inTime, outTime);

  const inHour = Math.floor(inMins / 60);
  const outHour = Math.floor(outMins / 60);

  if (inHour >= 19 && outHour <= 9 && hours >= 9 && hours <= 14) return 'high';
  if (inHour >= 18 && outHour <= 12 && hours >= 7 && hours <= 16) return 'medium';
  return 'low';
}

/**
 * Main pairing function.
 *
 * @param {Array} records - attendance_processed records (one per employee per day)
 *                          Each record: { id, employee_code, date, status_final, in_time_final, out_time_final, ... }
 * @returns {Object} { pairs, updatedRecords, boundaryFlags }
 *   pairs: Array of { inRecordId, outRecordId, inDate, outDate, inTime, outTime, hours, confidence }
 *   updatedRecords: Map of recordId → { changes }
 *   boundaryFlags: Records near month boundary that couldn't be paired
 */
function pairNightShifts(records) {
  const pairs = [];
  const updatedRecords = {};
  const boundaryFlags = [];

  // Build lookup: employeeCode → sorted records by date
  const byEmployee = {};
  for (const rec of records) {
    const key = rec.employee_code;
    if (!byEmployee[key]) byEmployee[key] = [];
    byEmployee[key].push(rec);
  }

  // Sort each employee's records by date
  for (const key of Object.keys(byEmployee)) {
    byEmployee[key].sort((a, b) => a.date.localeCompare(b.date));
  }

  // Process each employee's records
  for (const [empCode, empRecords] of Object.entries(byEmployee)) {
    for (let i = 0; i < empRecords.length; i++) {
      const rec = empRecords[i];

      // Skip if already paired, not present, or both times exist
      if (updatedRecords[rec.id]?.is_night_shift) continue;

      const inTime = rec.in_time_final || rec.in_time_original;
      const outTime = rec.out_time_final || rec.out_time_original;
      const status = rec.status_final || rec.status_original;

      const isPresent = ['P', 'WOP', '½P', 'WO½P'].includes(status);
      if (!isPresent) continue;

      const inHour = inTime ? parseInt(inTime.split(':')[0]) : -1;
      const hasOut = !!outTime;
      const hasIn = !!inTime;

      // Case 1: Has IN ≥ 18:00, no OUT → likely night shift IN
      if (hasIn && !hasOut && inHour >= 18) {
        // Look for next day's record with orphan OUT
        const nextRec = empRecords[i + 1];

        if (!nextRec) {
          // Month boundary — IN on last day, OUT in next month
          boundaryFlags.push({
            employeeCode: empCode,
            date: rec.date,
            inTime,
            issue: 'MONTH_BOUNDARY_IN',
            description: `Night shift IN on ${rec.date} at ${inTime} — OUT punch expected in next month's file`
          });
          continue;
        }

        // Check if next record is the next calendar day
        const inDate = new Date(rec.date);
        const nextDate = new Date(nextRec.date);
        const dayDiff = Math.round((nextDate - inDate) / (1000 * 60 * 60 * 24));

        if (dayDiff !== 1) continue; // Not consecutive days

        const nextInTime = nextRec.in_time_final || nextRec.in_time_original;
        const nextOutTime = nextRec.out_time_final || nextRec.out_time_original;
        const nextStatus = nextRec.status_final || nextRec.status_original;
        const nextOutHour = nextOutTime ? parseInt(nextOutTime.split(':')[0]) : -1;

        // Next day should have OUT ≤ 12:00 (could be orphan OUT or have both IN+OUT for double shift)
        const isNextDayOrphanOut = nextOutTime && nextOutHour <= 12 && !nextInTime;
        const isNextDayWithOut = nextOutTime && nextOutHour <= 12;

        if (isNextDayOrphanOut || (nextStatus === 'P' && isNextDayWithOut && !nextInTime)) {
          const hours = calcNightShiftHours(inTime, nextOutTime);
          const confidence = getPairingConfidence(inTime, nextOutTime);

          pairs.push({
            employeeCode: empCode,
            inRecordId: rec.id,
            outRecordId: nextRec.id,
            inDate: rec.date,
            outDate: nextRec.date,
            inTime,
            outTime: nextOutTime,
            calculatedHours: Math.round(hours * 100) / 100,
            confidence
          });

          // Mark IN record as night shift
          updatedRecords[rec.id] = {
            is_night_shift: 1,
            night_pair_date: nextRec.date,
            night_pair_confidence: confidence,
            out_time_final: nextOutTime,
            actual_hours: Math.round(hours * 100) / 100,
            is_miss_punch: 0
          };

          // Mark OUT record as night shift OUT-only (don't double-count)
          updatedRecords[nextRec.id] = {
            is_night_out_only: 1,
            is_night_shift: 1,
            night_pair_date: rec.date
          };
        } else if (!nextOutTime && !nextInTime) {
          // Both times missing on next day — can't pair reliably
          boundaryFlags.push({
            employeeCode: empCode,
            date: rec.date,
            inTime,
            nextDate: nextRec.date,
            issue: 'UNPAIRED_NO_NEXT_OUT',
            description: `Night shift IN at ${inTime} on ${rec.date} — next day (${nextRec.date}) has no punch at all`
          });
        }
      }

      // Case 2: Has OUT ≤ 10:00, no IN → likely night shift OUT (orphan)
      else if (hasOut && !hasIn) {
        const outHour = parseInt(outTime.split(':')[0]);
        if (outHour <= 10) {
          // Check if previous day has IN ≥ 18:00 without OUT
          const prevRec = empRecords[i - 1];

          if (!prevRec) {
            // Month boundary — OUT on first day, IN in previous month
            boundaryFlags.push({
              employeeCode: empCode,
              date: rec.date,
              outTime,
              issue: 'MONTH_BOUNDARY_OUT',
              description: `Night shift OUT on ${rec.date} at ${outTime} — IN punch expected in previous month's file`
            });
            continue;
          }

          // This should already be handled by Case 1 above
          // But mark it if not already paired
          if (!updatedRecords[rec.id]) {
            updatedRecords[rec.id] = {
              is_night_out_only: 1
            };
          }
        }
      }
    }
  }

  return { pairs, updatedRecords, boundaryFlags };
}

/**
 * Apply pairing results to database records
 * @param {Object} db - better-sqlite3 database instance
 * @param {Array} pairs - from pairNightShifts
 * @param {Object} updatedRecords - from pairNightShifts
 * @param {number} month
 * @param {number} year
 * @param {string} company
 */
function applyPairingToDb(db, pairs, updatedRecords, month, year, company) {
  const updateRecord = db.prepare(`
    UPDATE attendance_processed SET
      is_night_shift = COALESCE(?, is_night_shift),
      night_pair_date = COALESCE(?, night_pair_date),
      night_pair_confidence = COALESCE(?, night_pair_confidence),
      out_time_final = COALESCE(?, out_time_final),
      actual_hours = COALESCE(?, actual_hours),
      is_miss_punch = COALESCE(?, is_miss_punch),
      is_night_out_only = COALESCE(?, is_night_out_only),
      stage_4_done = 1
    WHERE id = ?
  `);

  const insertPair = db.prepare(`
    INSERT OR REPLACE INTO night_shift_pairs
    (employee_code, in_record_id, out_record_id, in_date, out_date, in_time, out_time, calculated_hours, confidence, is_confirmed, month, year, company)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const txn = db.transaction(() => {
    // Apply record updates
    for (const [recordId, changes] of Object.entries(updatedRecords)) {
      updateRecord.run(
        changes.is_night_shift !== undefined ? changes.is_night_shift : null,
        changes.night_pair_date || null,
        changes.night_pair_confidence || null,
        changes.out_time_final || null,
        changes.actual_hours !== undefined ? changes.actual_hours : null,
        changes.is_miss_punch !== undefined ? changes.is_miss_punch : null,
        changes.is_night_out_only !== undefined ? changes.is_night_out_only : null,
        parseInt(recordId)
      );
    }

    // Insert pair records
    for (const pair of pairs) {
      const autoConfirm = pair.confidence === 'high' ? 1 : 0;
      insertPair.run(
        pair.employeeCode,
        pair.inRecordId,
        pair.outRecordId,
        pair.inDate,
        pair.outDate,
        pair.inTime,
        pair.outTime,
        pair.calculatedHours,
        pair.confidence,
        autoConfirm,
        month, year, company
      );
    }
  });

  txn();

  return {
    pairsCreated: pairs.length,
    recordsUpdated: Object.keys(updatedRecords).length,
    highConfidence: pairs.filter(p => p.confidence === 'high').length,
    mediumConfidence: pairs.filter(p => p.confidence === 'medium').length,
    lowConfidence: pairs.filter(p => p.confidence === 'low').length
  };
}

module.exports = { pairNightShifts, applyPairingToDb, calcNightShiftHours, getPairingConfidence };
