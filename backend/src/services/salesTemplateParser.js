// Sales Template Parser — Phase 2 (May 2026)
//
// Validates an HR-uploaded XLSX produced by /api/sales/template (Phase 1).
// 8-step fail-fast validator. Every failed upload writes a sales_uploads
// row with status='rejected' so the audit trail captures the attempt.
//
// On success: persists the upload + per-row sales_monthly_input rows in
// a single transaction, links the matching sales_template_downloads row,
// and returns { success: true, uploadId, totalRows, message }.
//
// On rejection: returns { success: false, rejectionReason, rejectionDetails,
// uploadId } where uploadId is the new (or pre-existing) rejected row.

const crypto = require('crypto');
const XLSX = require('xlsx');
const {
  computeMasterHash,
  getEligibleEmployees,
  monthBounds,
} = require('./salesMasterHash');

function readMetaSheet(wb) {
  const ws = wb.Sheets['_meta'];
  if (!ws) return null;
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
  const meta = {};
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 2) continue;
    const [k, v] = row;
    if (k && k !== 'key') meta[String(k)] = v == null ? null : String(v);
  }
  return meta;
}

function readInputSheet(wb) {
  const ws = wb.Sheets['Input'];
  if (!ws) return null;
  // header row at row 1; sheet_to_json maps to objects keyed by header text
  return XLSX.utils.sheet_to_json(ws, { defval: null });
}

function buildRejectionRow(db, {
  month, year, company, filename, fileHash, uploadedBy,
  reason, details,
}) {
  const notes = JSON.stringify({ reason, details: details || null });
  // INSERT OR IGNORE: if the same (month, year, company, file_hash) is already
  // in the rejected pile, just point at the existing row instead of erroring.
  let info;
  try {
    info = db.prepare(`
      INSERT OR IGNORE INTO sales_uploads
        (month, year, company, filename, file_hash, total_rows, matched_rows,
         unmatched_rows, status, uploaded_by, notes, upload_source)
      VALUES (?, ?, ?, ?, ?, 0, 0, 0, 'rejected', ?, ?, 'template')
    `).run(month, year, company, filename, fileHash, uploadedBy, notes);
  } catch (e) {
    // Fall through to lookup — may be a concurrent insert.
    info = { changes: 0 };
  }
  if (info.changes === 1) return info.lastInsertRowid;
  const existing = db.prepare(`
    SELECT id FROM sales_uploads
    WHERE month=? AND year=? AND company=? AND file_hash=? AND status='rejected'
    ORDER BY id DESC LIMIT 1
  `).get(month, year, company, fileHash);
  if (existing) {
    // Refresh notes/uploaded_at on the existing rejected row so the audit
    // shows the latest reason if HR retried with the same bytes.
    try {
      db.prepare(`
        UPDATE sales_uploads
        SET notes=?, uploaded_at=datetime('now'), uploaded_by=?
        WHERE id=?
      `).run(notes, uploadedBy, existing.id);
    } catch (e) { /* best-effort */ }
    return existing.id;
  }
  return null;
}

function parseAndValidate(db, { fileBuffer, month, year, company, uploadedBy, filename }) {
  if (!db) throw new Error('db handle required');
  if (!Buffer.isBuffer(fileBuffer)) throw new Error('fileBuffer must be a Buffer');
  const m = Number(month), y = Number(year);
  if (!Number.isInteger(m) || m < 1 || m > 12) throw new Error('invalid month');
  if (!Number.isInteger(y)) throw new Error('invalid year');
  if (!company || typeof company !== 'string') throw new Error('company required');
  if (!uploadedBy) throw new Error('uploadedBy required');
  const fname = filename || `template_upload_${y}-${String(m).padStart(2, '0')}.xlsx`;
  const fileHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');

  // Pre-check: same exact file already accepted?
  const dupSuccess = db.prepare(`
    SELECT id, status FROM sales_uploads
    WHERE month=? AND year=? AND company=? AND file_hash=?
      AND status IN ('matched','computed','finalized','superseded','paid')
    LIMIT 1
  `).get(m, y, company, fileHash);
  if (dupSuccess) {
    return {
      success: false,
      rejectionReason: 'duplicate_file',
      rejectionDetails: { existingUploadId: dupSuccess.id, status: dupSuccess.status },
      uploadId: dupSuccess.id,
    };
  }

  const reject = (reason, details) => {
    const id = buildRejectionRow(db, {
      month: m, year: y, company, filename: fname, fileHash, uploadedBy, reason, details,
    });
    return { success: false, rejectionReason: reason, rejectionDetails: details || null, uploadId: id };
  };

  // Step 1 — parse workbook
  let wb;
  try {
    wb = XLSX.read(fileBuffer, { type: 'buffer' });
  } catch (e) {
    return reject('not_a_valid_xlsx', { error: e.message });
  }
  if (!wb || !wb.SheetNames || !wb.SheetNames.length) {
    return reject('not_a_valid_xlsx', { error: 'workbook has no sheets' });
  }

  // Step 2 — meta sheet
  const meta = readMetaSheet(wb);
  if (!meta) return reject('missing_meta_sheet', null);
  const need = ['month', 'year', 'company', 'master_snapshot_hash', 'employee_count'];
  for (const k of need) {
    if (meta[k] == null || meta[k] === '') {
      return reject('missing_meta_sheet', { missingKey: k });
    }
  }

  // Step 3 — cycle match
  const metaMonth = Number(meta.month);
  const metaYear = Number(meta.year);
  const metaCompany = String(meta.company);
  if (metaMonth !== m || metaYear !== y || metaCompany !== company) {
    return reject('cycle_mismatch', {
      template: { month: metaMonth, year: metaYear, company: metaCompany },
      url: { month: m, year: y, company },
    });
  }

  // Step 4 — known template
  const metaHash = String(meta.master_snapshot_hash);
  const downloadRow = db.prepare(`
    SELECT id, downloaded_at, employee_count
    FROM sales_template_downloads
    WHERE master_snapshot_hash=? AND month=? AND year=? AND company=?
    ORDER BY downloaded_at DESC LIMIT 1
  `).get(metaHash, m, y, company);
  if (!downloadRow) {
    return reject('unknown_template', {
      hash: metaHash,
      hint: 'No matching sales_template_downloads row. Re-download the template.',
    });
  }

  // Step 5 — master drift check
  const currentHash = computeMasterHash(db, m, y, company);
  if (currentHash !== metaHash) {
    const currentEligible = getEligibleEmployees(db, m, y, company);
    const currentCodes = new Set(currentEligible.map((e) => e.code));
    // Re-derive what the template SHOULD have included by reading the Input
    // sheet's Employee Code column. (The hash function only consumes
    // identity-shaping fields; we don't have a stored copy of those rows.)
    const inputForDiff = readInputSheet(wb) || [];
    const templateCodes = new Set(
      inputForDiff
        .map((r) => (r['Employee Code'] != null ? String(r['Employee Code']) : null))
        .filter(Boolean)
    );
    const added = [...currentCodes].filter((c) => !templateCodes.has(c));
    const removed = [...templateCodes].filter((c) => !currentCodes.has(c));
    return reject('master_drift', {
      template_hash: metaHash,
      current_hash: currentHash,
      added_since_download: added,
      removed_since_download: removed,
    });
  }

  // Step 6 — per-row validation
  const inputRows = readInputSheet(wb);
  if (!inputRows) return reject('missing_meta_sheet', { missing: 'Input sheet' });

  const { end } = monthBounds(m, y);
  const calendarDays = new Date(y, m, 0).getDate();
  const eligible = getEligibleEmployees(db, m, y, company);
  const eligibleByCode = new Map(eligible.map((e) => [e.code, e]));
  const masterByCode = new Map();
  if (eligible.length) {
    const placeholders = eligible.map(() => '?').join(',');
    const codes = eligible.map((e) => e.code);
    const rows = db.prepare(
      `SELECT code, name FROM sales_employees WHERE company=? AND code IN (${placeholders})`
    ).all(company, ...codes);
    for (const r of rows) masterByCode.set(r.code, r);
  }

  const unknownEmployees = [];
  const invalidDays = [];
  const duplicates = [];
  const seenCodes = new Set();
  const validRows = [];

  for (let i = 0; i < inputRows.length; i++) {
    const r = inputRows[i];
    const sheetRowNumber = i + 2; // header is row 1, first data row is 2
    const codeRaw = r['Employee Code'];
    const code = codeRaw != null ? String(codeRaw).trim() : '';
    if (!code) {
      // empty Employee Code in a data row: surface as unknown_employee
      unknownEmployees.push({ row: sheetRowNumber, code: '(empty)' });
      continue;
    }
    if (!eligibleByCode.has(code)) {
      unknownEmployees.push({ row: sheetRowNumber, code });
      continue;
    }
    if (seenCodes.has(code)) {
      duplicates.push({ row: sheetRowNumber, code });
      continue;
    }
    seenCodes.add(code);
    const daysRaw = r['Days Given'];
    const days = typeof daysRaw === 'number' ? daysRaw : Number(daysRaw);
    if (daysRaw === null || daysRaw === undefined || daysRaw === '' || !Number.isFinite(days)) {
      invalidDays.push({ row: sheetRowNumber, code, value: daysRaw });
      continue;
    }
    if (days < 0 || days > calendarDays) {
      invalidDays.push({ row: sheetRowNumber, code, value: days, max: calendarDays });
      continue;
    }
    validRows.push({ row: sheetRowNumber, code, days });
  }

  if (unknownEmployees.length) {
    return reject('unknown_employee', { rows: unknownEmployees, count: unknownEmployees.length });
  }
  if (duplicates.length) {
    return reject('duplicate_employee', { rows: duplicates, count: duplicates.length });
  }
  if (invalidDays.length) {
    return reject('invalid_days_given', {
      rows: invalidDays,
      count: invalidDays.length,
      max: calendarDays,
    });
  }

  // Step 7 — row count
  const expectedCount = Number(meta.employee_count);
  if (!Number.isInteger(expectedCount) || validRows.length !== expectedCount) {
    return reject('row_count_mismatch', {
      meta_count: expectedCount,
      input_rows: inputRows.length,
      valid_rows: validRows.length,
    });
  }

  // Step 8 — persist
  const templateGeneratedAt = meta.generated_at || null;
  const persistTxn = db.transaction(() => {
    const insUpload = db.prepare(`
      INSERT INTO sales_uploads
        (month, year, company, filename, file_hash, total_rows, matched_rows,
         unmatched_rows, status, uploaded_by, notes, master_snapshot_hash,
         template_generated_at, upload_source)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'matched', ?, NULL, ?, ?, 'template')
    `);
    const info = insUpload.run(
      m, y, company, fname, fileHash,
      validRows.length, validRows.length,
      uploadedBy, metaHash, templateGeneratedAt
    );
    const newUploadId = info.lastInsertRowid;

    const insRow = db.prepare(`
      INSERT INTO sales_monthly_input
        (month, year, company, upload_id, sheet_row_number, sheet_employee_name,
         sheet_days_given, employee_code, match_confidence, match_method, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'exact', 'employee_code', ?)
    `);
    for (const v of validRows) {
      const masterName = (masterByCode.get(v.code) && masterByCode.get(v.code).name) || v.code;
      insRow.run(m, y, company, newUploadId, v.row, masterName, v.days, v.code, uploadedBy);
    }

    db.prepare(`
      UPDATE sales_template_downloads
      SET matched_upload_id=?
      WHERE id=(
        SELECT id FROM sales_template_downloads
        WHERE master_snapshot_hash=? AND month=? AND year=? AND company=?
          AND matched_upload_id IS NULL
        ORDER BY downloaded_at DESC LIMIT 1
      )
    `).run(newUploadId, metaHash, m, y, company);

    return newUploadId;
  });

  let uploadId;
  try {
    uploadId = persistTxn();
  } catch (e) {
    // Persist threw — rebuild a rejected row so the attempt isn't lost.
    const rid = buildRejectionRow(db, {
      month: m, year: y, company, filename: fname, fileHash, uploadedBy,
      reason: 'persist_failed', details: { error: e.message },
    });
    return {
      success: false,
      rejectionReason: 'persist_failed',
      rejectionDetails: { error: e.message },
      uploadId: rid,
    };
  }

  return {
    success: true,
    uploadId,
    totalRows: validRows.length,
    message: 'Template accepted',
  };
}

module.exports = { parseAndValidate };
