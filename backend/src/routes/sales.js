// Sales Salary Module.
//   Phase 1: employee master + salary structures (see commit 78df719).
//   Phase 2: holiday master + coordinator sheet upload + matching preview.
// Parallel to plant pipeline, shares no tables. Every :code endpoint
// requires ?company=X because codes are scoped per company, not globally
// (design §4A Q2). Status transitions are manual only (§4A Q3).

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const { getDb } = require('../database/db');
const { requireHrOrAdmin } = require('../middleware/roles');
const {
  parseSalesCoordinatorFile,
  normalizeName,
  normalizeManager,
  normalizeCity,
} = require('../services/salesCoordinatorParser');

router.use(requireHrOrAdmin);

const IMMUTABLE_FIELDS = new Set(['id', 'code', 'company', 'created_at', 'created_by']);

const UPDATABLE_FIELDS = [
  'name', 'aadhaar', 'pan', 'dob', 'doj', 'dol',
  'contact', 'personal_contact',
  'state', 'headquarters', 'city_of_operation', 'reporting_manager',
  'designation', 'punch_no', 'working_hours',
  'gross_salary', 'pf_applicable', 'esi_applicable', 'pt_applicable',
  'bank_name', 'account_no', 'ifsc',
  'status',
  'predecessor_type', 'predecessor_id', 'predecessor_code'
];

const VALID_STATUSES = ['Active', 'Inactive', 'Left', 'Exited'];

function writeAudit(db, { recordId, empCode, field, oldVal, newVal, user, actionType, remark }) {
  try {
    db.prepare(`
      INSERT INTO audit_log
        (table_name, record_id, field_name, old_value, new_value, changed_by, stage, remark, employee_code, action_type)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'sales_employees', recordId, field,
      String(oldVal ?? ''), String(newVal ?? ''),
      user || 'unknown', 'sales_employee_master',
      remark || '', empCode || '', actionType || 'update'
    );
  } catch (e) { /* audit must not break writes */ }
}

function requireCompany(req, res) {
  const company = (req.query.company || '').trim();
  if (!company) {
    res.status(400).json({ success: false, error: 'company query param required' });
    return null;
  }
  return company;
}

// ── GET /api/sales/employees — list with filters ───────────────────
router.get('/employees', (req, res) => {
  const db = getDb();
  const { company, status, state, manager, hq } = req.query;

  const clauses = [];
  const params = [];
  if (company) { clauses.push('company = ?'); params.push(company); }
  if (status)  { clauses.push('status = ?');  params.push(status); }
  if (state)   { clauses.push('state = ?');   params.push(state); }
  if (manager) { clauses.push('reporting_manager LIKE ?'); params.push(`%${manager}%`); }
  if (hq)      { clauses.push('headquarters LIKE ?');      params.push(`%${hq}%`); }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = db.prepare(`SELECT * FROM sales_employees ${where} ORDER BY name ASC`).all(...params);
  res.json({ success: true, data: rows });
});

// ── GET /api/sales/employees/:code?company=X ───────────────────────
router.get('/employees/:code', (req, res) => {
  const company = requireCompany(req, res);
  if (!company) return;

  const db = getDb();
  const row = db.prepare('SELECT * FROM sales_employees WHERE code = ? AND company = ?')
                .get(req.params.code, company);
  if (!row) return res.status(404).json({ success: false, error: 'Sales employee not found' });
  res.json({ success: true, data: row });
});

// ── POST /api/sales/employees — create ─────────────────────────────
router.post('/employees', (req, res) => {
  const db = getDb();
  const body = req.body || {};
  const user = req.user?.username || 'unknown';

  const required = ['code', 'name', 'company', 'bank_name', 'account_no', 'ifsc'];
  const missing = required.filter(f => !body[f] || String(body[f]).trim() === '');
  if (missing.length) {
    return res.status(400).json({ success: false, error: `Missing required field(s): ${missing.join(', ')}` });
  }

  if (body.status && !VALID_STATUSES.includes(body.status)) {
    return res.status(400).json({ success: false, error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}` });
  }

  const existing = db.prepare('SELECT id FROM sales_employees WHERE code = ? AND company = ?')
                     .get(body.code, body.company);
  if (existing) {
    return res.status(409).json({ success: false, error: `Sales employee ${body.code} already exists in ${body.company}` });
  }

  // Only include columns the caller actually supplied — keeps SQLite DEFAULT
  // values (e.g. status='Active', pf_applicable=0) in effect for omitted fields.
  const cols = ['code', 'name', 'company', 'created_by', 'updated_by'];
  const values = [body.code, body.name, body.company, user, user];
  for (const f of UPDATABLE_FIELDS) {
    if (['code', 'company'].includes(f)) continue; // already added
    if (f === 'name') continue;                    // already added
    if (body[f] === undefined) continue;
    cols.push(f);
    values.push(body[f]);
  }
  const placeholders = cols.map(() => '?').join(', ');

  try {
    const info = db.prepare(
      `INSERT INTO sales_employees (${cols.join(', ')}) VALUES (${placeholders})`
    ).run(...values);

    writeAudit(db, {
      recordId: info.lastInsertRowid,
      empCode: body.code,
      field: 'created',
      oldVal: '',
      newVal: body.name,
      user,
      actionType: 'create',
      remark: `Sales employee created in ${body.company}`
    });

    const row = db.prepare('SELECT * FROM sales_employees WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json({ success: true, data: row });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

// ── PUT /api/sales/employees/:code?company=X — update ──────────────
router.put('/employees/:code', (req, res) => {
  const company = requireCompany(req, res);
  if (!company) return;

  const db = getDb();
  const user = req.user?.username || 'unknown';
  const body = req.body || {};

  const existing = db.prepare('SELECT * FROM sales_employees WHERE code = ? AND company = ?')
                     .get(req.params.code, company);
  if (!existing) return res.status(404).json({ success: false, error: 'Sales employee not found' });

  if (body.status !== undefined && !VALID_STATUSES.includes(body.status)) {
    return res.status(400).json({ success: false, error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}` });
  }

  const setClauses = [];
  const params = [];
  const changedFields = [];

  for (const field of UPDATABLE_FIELDS) {
    if (IMMUTABLE_FIELDS.has(field)) continue;
    if (body[field] === undefined) continue;
    setClauses.push(`${field} = ?`);
    params.push(body[field]);
    if (String(existing[field] ?? '') !== String(body[field] ?? '')) {
      changedFields.push({ field, oldVal: existing[field], newVal: body[field] });
    }
  }

  if (setClauses.length === 0) {
    return res.json({ success: true, message: 'No updates', data: existing });
  }

  setClauses.push('updated_by = ?'); params.push(user);
  setClauses.push("updated_at = datetime('now')");
  params.push(req.params.code, company);

  db.prepare(
    `UPDATE sales_employees SET ${setClauses.join(', ')} WHERE code = ? AND company = ?`
  ).run(...params);

  for (const ch of changedFields) {
    writeAudit(db, {
      recordId: existing.id,
      empCode: existing.code,
      field: ch.field,
      oldVal: ch.oldVal,
      newVal: ch.newVal,
      user,
      actionType: 'update',
      remark: `Sales employee ${existing.code} field ${ch.field} updated`
    });
  }

  const updated = db.prepare('SELECT * FROM sales_employees WHERE code = ? AND company = ?')
                    .get(req.params.code, company);
  res.json({ success: true, data: updated });
});

// ── PUT /api/sales/employees/:code/mark-left?company=X ─────────────
router.put('/employees/:code/mark-left', (req, res) => {
  const company = requireCompany(req, res);
  if (!company) return;

  const db = getDb();
  const user = req.user?.username || 'unknown';
  const body = req.body || {};

  const existing = db.prepare('SELECT * FROM sales_employees WHERE code = ? AND company = ?')
                     .get(req.params.code, company);
  if (!existing) return res.status(404).json({ success: false, error: 'Sales employee not found' });
  if (existing.status === 'Left') {
    return res.status(400).json({ success: false, error: 'Sales employee already marked as Left' });
  }

  const dol = body.dol || new Date().toISOString().split('T')[0];
  const reason = body.reason || '';

  db.prepare(`
    UPDATE sales_employees
       SET status = 'Left',
           dol = ?,
           updated_by = ?,
           updated_at = datetime('now')
     WHERE code = ? AND company = ?
  `).run(dol, user, req.params.code, company);

  writeAudit(db, {
    recordId: existing.id,
    empCode: existing.code,
    field: 'status',
    oldVal: existing.status,
    newVal: 'Left',
    user,
    actionType: 'mark_left',
    remark: `Marked as Left (dol=${dol})${reason ? `. Reason: ${reason}` : ''}`
  });

  const updated = db.prepare('SELECT * FROM sales_employees WHERE code = ? AND company = ?')
                    .get(req.params.code, company);
  res.json({ success: true, data: updated, message: `Sales employee ${existing.code} marked as Left` });
});

// ── GET /api/sales/employees/:code/structures?company=X ────────────
router.get('/employees/:code/structures', (req, res) => {
  const company = requireCompany(req, res);
  if (!company) return;

  const db = getDb();
  const emp = db.prepare('SELECT id FROM sales_employees WHERE code = ? AND company = ?')
                .get(req.params.code, company);
  if (!emp) return res.status(404).json({ success: false, error: 'Sales employee not found' });

  const rows = db.prepare(
    'SELECT * FROM sales_salary_structures WHERE employee_id = ? ORDER BY effective_from DESC'
  ).all(emp.id);
  res.json({ success: true, data: rows });
});

// ── POST /api/sales/employees/:code/structures?company=X ───────────
// Phase 1: insert only. No supersede semantics (effective_to not auto-set
// on prior row). Phase 3 will layer the effective-from supersede logic.
router.post('/employees/:code/structures', (req, res) => {
  const company = requireCompany(req, res);
  if (!company) return;

  const db = getDb();
  const user = req.user?.username || 'unknown';
  const body = req.body || {};

  const emp = db.prepare('SELECT id FROM sales_employees WHERE code = ? AND company = ?')
                .get(req.params.code, company);
  if (!emp) return res.status(404).json({ success: false, error: 'Sales employee not found' });

  if (!body.effective_from || !String(body.effective_from).trim()) {
    return res.status(400).json({ success: false, error: 'effective_from is required (YYYY-MM)' });
  }

  // Only include columns the caller actually supplied so SQLite DEFAULT
  // values (e.g. pf_applicable=0) apply for omitted fields.
  const cols = ['employee_id', 'created_by', 'effective_from'];
  const values = [emp.id, user, body.effective_from];
  const optional = [
    'effective_to', 'basic', 'hra', 'cca', 'conveyance', 'gross_salary',
    'pf_applicable', 'esi_applicable', 'pt_applicable',
    'pf_wage_ceiling_override', 'notes'
  ];
  for (const f of optional) {
    if (body[f] === undefined) continue;
    cols.push(f);
    values.push(body[f]);
  }
  const placeholders = cols.map(() => '?').join(', ');

  try {
    const info = db.prepare(
      `INSERT INTO sales_salary_structures (${cols.join(', ')}) VALUES (${placeholders})`
    ).run(...values);
    const row = db.prepare('SELECT * FROM sales_salary_structures WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json({ success: true, data: row });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) {
      return res.status(409).json({
        success: false,
        error: `A structure already exists with effective_from=${body.effective_from} for this employee`
      });
    }
    return res.status(500).json({ success: false, error: e.message });
  }
});

// ════════════════════════════════════════════════════════════════════
// Phase 2 — Holidays + coordinator sheet upload & matching
// ════════════════════════════════════════════════════════════════════

// ── Audit helper specialised for holidays / uploads ───────────────────
function writeAuditP2(db, table, { recordId, field, oldVal, newVal, user, actionType, remark, empCode }) {
  try {
    db.prepare(`
      INSERT INTO audit_log
        (table_name, record_id, field_name, old_value, new_value, changed_by, stage, remark, employee_code, action_type)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      table, recordId, field,
      String(oldVal ?? ''), String(newVal ?? ''),
      user || 'unknown', 'sales_' + (table.replace(/^sales_/, '')),
      remark || '', empCode || '', actionType || 'update'
    );
  } catch (e) { /* audit must not break writes */ }
}

// ══════════ Holiday master ════════════════════════════════════════════

// GET /api/sales/holidays?company=X&year=YYYY
router.get('/holidays', (req, res) => {
  const company = (req.query.company || '').trim();
  if (!company) return res.status(400).json({ success: false, error: 'company query param required' });
  const year = parseInt(req.query.year, 10) || new Date().getFullYear();

  const db = getDb();
  const rows = db.prepare(`
    SELECT * FROM sales_holidays
     WHERE company = ?
       AND strftime('%Y', holiday_date) = ?
     ORDER BY holiday_date ASC
  `).all(company, String(year));
  res.json({ success: true, data: rows });
});

// POST /api/sales/holidays
router.post('/holidays', (req, res) => {
  const db = getDb();
  const user = req.user?.username || 'unknown';
  const body = req.body || {};

  const missing = ['holiday_date', 'holiday_name', 'company']
    .filter(f => !body[f] || String(body[f]).trim() === '');
  if (missing.length) {
    return res.status(400).json({ success: false, error: `Missing required field(s): ${missing.join(', ')}` });
  }

  // applicable_states accepts array (we JSON.stringify) or string (pass-through)
  let states = body.applicable_states;
  if (Array.isArray(states)) {
    states = states.length === 0 ? null : JSON.stringify(states);
  } else if (states === '' || states === undefined) {
    states = null;
  }

  const isGazetted = body.is_gazetted === undefined ? 1 : (body.is_gazetted ? 1 : 0);

  try {
    const info = db.prepare(`
      INSERT INTO sales_holidays (holiday_date, holiday_name, company, applicable_states, is_gazetted)
      VALUES (?, ?, ?, ?, ?)
    `).run(body.holiday_date, body.holiday_name, body.company, states, isGazetted);

    writeAuditP2(db, 'sales_holidays', {
      recordId: info.lastInsertRowid, field: 'created', oldVal: '', newVal: body.holiday_name,
      user, actionType: 'create',
      remark: `Holiday ${body.holiday_date} (${body.company})`,
    });

    const row = db.prepare('SELECT * FROM sales_holidays WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json({ success: true, data: row });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) {
      return res.status(409).json({
        success: false,
        error: `A sales holiday on ${body.holiday_date} already exists for ${body.company}`,
      });
    }
    return res.status(500).json({ success: false, error: e.message });
  }
});

// PUT /api/sales/holidays/:id — update holiday_name / applicable_states / is_gazetted only
router.put('/holidays/:id', (req, res) => {
  const db = getDb();
  const user = req.user?.username || 'unknown';
  const body = req.body || {};

  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ success: false, error: 'Invalid id' });

  const existing = db.prepare('SELECT * FROM sales_holidays WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ success: false, error: 'Sales holiday not found' });

  const sets = [];
  const params = [];
  if (body.holiday_name !== undefined) { sets.push('holiday_name = ?'); params.push(body.holiday_name); }
  if (body.applicable_states !== undefined) {
    let s = body.applicable_states;
    if (Array.isArray(s)) s = s.length === 0 ? null : JSON.stringify(s);
    else if (s === '') s = null;
    sets.push('applicable_states = ?'); params.push(s);
  }
  if (body.is_gazetted !== undefined) {
    sets.push('is_gazetted = ?'); params.push(body.is_gazetted ? 1 : 0);
  }
  if (sets.length === 0) return res.json({ success: true, message: 'No updates', data: existing });

  params.push(id);
  db.prepare(`UPDATE sales_holidays SET ${sets.join(', ')} WHERE id = ?`).run(...params);

  writeAuditP2(db, 'sales_holidays', {
    recordId: id, field: 'updated', oldVal: existing.holiday_name, newVal: body.holiday_name ?? existing.holiday_name,
    user, actionType: 'update',
    remark: `Holiday ${existing.holiday_date} (${existing.company}) updated`,
  });

  const row = db.prepare('SELECT * FROM sales_holidays WHERE id = ?').get(id);
  res.json({ success: true, data: row });
});

// DELETE /api/sales/holidays/:id — hard delete (Phase 2; no Stage 3 refs yet)
router.delete('/holidays/:id', (req, res) => {
  const db = getDb();
  const user = req.user?.username || 'unknown';
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ success: false, error: 'Invalid id' });

  const existing = db.prepare('SELECT * FROM sales_holidays WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ success: false, error: 'Sales holiday not found' });

  // Phase 3 guard: block hard-delete if a finalized sales salary
  // computation exists for the same (company, year, month) the holiday
  // falls in. Soft-delete is not implemented in Phase 2/3 — HR must
  // explicitly un-finalize the computation first (via PUT /salary/:id/status).
  const blockers = db.prepare(`
    SELECT DISTINCT month, year FROM sales_salary_computations
     WHERE company = ? AND status = 'finalized'
       AND month = CAST(strftime('%m', ?) AS INTEGER)
       AND year  = CAST(strftime('%Y', ?) AS INTEGER)
  `).all(existing.company, existing.holiday_date, existing.holiday_date);
  if (blockers.length > 0) {
    const monthsDesc = blockers.map(b => `${b.month}/${b.year}`).join(', ');
    return res.status(409).json({
      success: false,
      error: `Cannot delete holiday: referenced by finalized salary computation(s) for month(s) ${monthsDesc}`,
      data: { blockingMonths: blockers },
    });
  }

  db.prepare('DELETE FROM sales_holidays WHERE id = ?').run(id);

  writeAuditP2(db, 'sales_holidays', {
    recordId: id, field: 'deleted', oldVal: existing.holiday_name, newVal: '',
    user, actionType: 'delete',
    remark: `Holiday ${existing.holiday_date} (${existing.company}) deleted`,
  });

  res.json({ success: true, message: `Sales holiday ${existing.holiday_date} deleted` });
});

// ══════════ Coordinator sheet upload & matching ══════════════════════

const salesUploadDir = path.join(__dirname, '../../../uploads/sales');
try { fs.mkdirSync(salesUploadDir, { recursive: true }); } catch (e) { /* ignore */ }

const salesUpload = multer({
  dest: salesUploadDir,
  fileFilter: (req, file, cb) => {
    const n = file.originalname.toLowerCase();
    if (n.endsWith('.xls') || n.endsWith('.xlsx')) cb(null, true);
    else cb(new Error('Only .xls and .xlsx files are accepted'));
  },
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
});

function sha256OfFile(filePath) {
  const h = crypto.createHash('sha256');
  h.update(fs.readFileSync(filePath));
  return h.digest('hex');
}

// Run the tiered matcher against sales_employees for a single parsed row.
// Returns { employee_code, match_confidence, match_method }.
function matchRow(db, company, parsed) {
  // Tier 1 — Exact by punch_no
  const punch = (parsed.sheet_punch_no || '').trim();
  if (punch) {
    const hits = db.prepare(`
      SELECT code FROM sales_employees
       WHERE company = ? AND status = 'Active'
         AND punch_no IS NOT NULL AND punch_no != '' AND punch_no = ?
    `).all(company, punch);
    if (hits.length === 1) {
      return { employee_code: hits[0].code, match_confidence: 'exact', match_method: 'punch_no' };
    }
  }

  // Pull Active candidates for this company once, then do JS-side normalised compare.
  const candidates = db.prepare(`
    SELECT code, name, reporting_manager, city_of_operation
      FROM sales_employees
     WHERE company = ? AND status = 'Active'
  `).all(company);

  const sheetN = normalizeName(parsed.sheet_employee_name);
  const sheetM = normalizeManager(parsed.sheet_reporting_manager);
  const sheetC = normalizeCity(parsed.sheet_city);

  // Tier 2 — High: name+manager+city
  const highMatches = candidates.filter(e =>
    normalizeName(e.name) === sheetN &&
    normalizeManager(e.reporting_manager) === sheetM &&
    normalizeCity(e.city_of_operation) === sheetC &&
    sheetM && sheetC // both sheet fields present
  );
  if (highMatches.length === 1) {
    return { employee_code: highMatches[0].code, match_confidence: 'high', match_method: 'name+manager+city' };
  }

  // Tier 3 — Medium: name+city
  const medMatches = candidates.filter(e =>
    normalizeName(e.name) === sheetN &&
    normalizeCity(e.city_of_operation) === sheetC &&
    sheetC // sheet city present
  );
  if (medMatches.length === 1) {
    return { employee_code: medMatches[0].code, match_confidence: 'medium', match_method: 'name+city' };
  }

  // Tier 4 — Low: name only
  const nameMatches = candidates.filter(e => normalizeName(e.name) === sheetN);
  if (nameMatches.length >= 2) {
    return { employee_code: null, match_confidence: 'low', match_method: 'name_only_ambiguous' };
  }
  if (nameMatches.length === 1) {
    // Single name match but name+manager+city didn't line up → still low (HR confirms)
    return { employee_code: null, match_confidence: 'low', match_method: 'name_only_one_candidate' };
  }

  // Tier 5 — Unmatched
  return { employee_code: null, match_confidence: 'unmatched', match_method: 'no_match' };
}

// POST /api/sales/upload — multipart; field name "file"
router.post('/upload', salesUpload.single('file'), (req, res) => {
  const db = getDb();
  const user = req.user?.username || 'unknown';
  const file = req.file;

  if (!file) {
    return res.status(400).json({ success: false, error: 'No file uploaded (field name must be "file")' });
  }

  let parseResult;
  try {
    parseResult = parseSalesCoordinatorFile(file.path);
  } catch (e) {
    try { fs.unlinkSync(file.path); } catch {}
    return res.status(500).json({ success: false, error: `Parser crashed: ${e.message}` });
  }

  if (!parseResult.success) {
    try { fs.unlinkSync(file.path); } catch {}
    return res.status(400).json({ success: false, error: parseResult.error });
  }

  // Month / year / company resolution — parser result → request body → error
  const month = parseResult.month || parseInt(req.body.month, 10) || null;
  const year  = parseResult.year  || parseInt(req.body.year, 10)  || null;
  const company = parseResult.company || (req.body.company || '').trim() || null;

  if (!month || !year || !company) {
    try { fs.unlinkSync(file.path); } catch {}
    return res.status(400).json({
      success: false,
      error: 'Month/year/company could not be determined from filename, sheet header, or request body. Include month, year, and company in the multipart body as a fallback.',
    });
  }

  // File hash for dedup
  let fileHash;
  try { fileHash = sha256OfFile(file.path); }
  catch (e) { return res.status(500).json({ success: false, error: `Hash failed: ${e.message}` }); }

  // Collision check — same (month, year, company, file_hash) already uploaded?
  const existing = db.prepare(`
    SELECT id, status, filename, total_rows FROM sales_uploads
     WHERE month = ? AND year = ? AND company = ? AND file_hash = ?
  `).get(month, year, company, fileHash);
  if (existing) {
    try { fs.unlinkSync(file.path); } catch {}
    return res.status(409).json({
      success: false,
      error: `This file has already been uploaded for ${month}/${year} ${company}. Existing upload #${existing.id} (status: ${existing.status}).`,
      data: { existingUploadId: existing.id, status: existing.status, filename: existing.filename },
    });
  }

  // Insert upload row + monthly_input rows + run matcher — all in one txn
  const txn = db.transaction(() => {
    const insertUpload = db.prepare(`
      INSERT INTO sales_uploads
        (month, year, company, filename, file_hash, total_rows,
         matched_rows, unmatched_rows, status, uploaded_by)
      VALUES (?, ?, ?, ?, ?, ?, 0, 0, 'uploaded', ?)
    `);
    const u = insertUpload.run(month, year, company, file.originalname, fileHash, parseResult.rows.length, user);
    const uploadId = u.lastInsertRowid;

    const insertInput = db.prepare(`
      INSERT INTO sales_monthly_input
        (month, year, company, upload_id,
         sheet_row_number, sheet_state, sheet_reporting_manager, sheet_employee_name,
         sheet_designation, sheet_city, sheet_punch_no, sheet_doj, sheet_dol,
         sheet_days_given, sheet_remarks,
         employee_code, match_confidence, match_method,
         created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    let matched = 0, unmatched = 0;
    for (const row of parseResult.rows) {
      const mr = matchRow(db, company, row);
      if (mr.employee_code) matched++; else unmatched++;
      insertInput.run(
        month, year, company, uploadId,
        row.sheet_row_number,
        row.sheet_state, row.sheet_reporting_manager, row.sheet_employee_name,
        row.sheet_designation, row.sheet_city, row.sheet_punch_no,
        row.sheet_doj, row.sheet_dol,
        row.sheet_days_given, row.sheet_remarks,
        mr.employee_code, mr.match_confidence, mr.match_method,
        user
      );
    }

    db.prepare('UPDATE sales_uploads SET matched_rows = ?, unmatched_rows = ? WHERE id = ?')
      .run(matched, unmatched, uploadId);

    writeAuditP2(db, 'sales_uploads', {
      recordId: uploadId, field: 'uploaded', oldVal: '', newVal: file.originalname,
      user, actionType: 'create',
      remark: `Sales sheet ${file.originalname} for ${month}/${year} ${company} — ${parseResult.rows.length} rows (${matched} matched, ${unmatched} unmatched)`,
    });

    return { uploadId, totalRows: parseResult.rows.length, matchedRows: matched, unmatchedRows: unmatched };
  });

  let result;
  try { result = txn(); }
  catch (e) {
    try { fs.unlinkSync(file.path); } catch {}
    return res.status(500).json({ success: false, error: `Upload txn failed: ${e.message}` });
  }

  res.status(201).json({
    success: true,
    data: {
      uploadId: result.uploadId,
      totalRows: result.totalRows,
      matchedRows: result.matchedRows,
      unmatchedRows: result.unmatchedRows,
      month, year, company,
      filename: file.originalname,
    },
  });
});

// GET /api/sales/upload/:uploadId/preview
router.get('/upload/:uploadId/preview', (req, res) => {
  const db = getDb();
  const uploadId = parseInt(req.params.uploadId, 10);
  if (!uploadId) return res.status(400).json({ success: false, error: 'Invalid uploadId' });

  const upload = db.prepare('SELECT * FROM sales_uploads WHERE id = ?').get(uploadId);
  if (!upload) return res.status(404).json({ success: false, error: 'Upload not found' });

  const rows = db.prepare(`
    SELECT i.*,
           e.code AS resolved_code, e.name AS resolved_name,
           e.designation AS resolved_designation,
           e.reporting_manager AS resolved_manager,
           e.city_of_operation AS resolved_city
      FROM sales_monthly_input i
 LEFT JOIN sales_employees e
        ON e.code = i.employee_code AND e.company = i.company
     WHERE i.upload_id = ?
  ORDER BY i.sheet_row_number ASC
  `).all(uploadId);

  const bucket = { matched: [], low: [], unmatched: [] };
  for (const r of rows) {
    const resolved = r.employee_code ? {
      code: r.resolved_code, name: r.resolved_name,
      designation: r.resolved_designation, reporting_manager: r.resolved_manager,
      city_of_operation: r.resolved_city,
    } : null;
    // Strip the flattened resolved_* keys from the row
    const { resolved_code, resolved_name, resolved_designation, resolved_manager, resolved_city, ...rowOnly } = r;
    const enriched = { ...rowOnly, resolved_employee: resolved };

    if (r.match_confidence === 'low') bucket.low.push(enriched);
    else if (r.match_confidence === 'unmatched') bucket.unmatched.push(enriched);
    else bucket.matched.push(enriched); // exact / high / medium / manual
  }

  res.json({ success: true, data: { upload, ...bucket } });
});

// PUT /api/sales/upload/:uploadId/match/:rowId — manual HR link
router.put('/upload/:uploadId/match/:rowId', (req, res) => {
  const db = getDb();
  const user = req.user?.username || 'unknown';
  const uploadId = parseInt(req.params.uploadId, 10);
  const rowId = parseInt(req.params.rowId, 10);
  const { employee_code, company } = req.body || {};

  if (!uploadId || !rowId) return res.status(400).json({ success: false, error: 'Invalid uploadId or rowId' });
  if (!employee_code || !company) {
    return res.status(400).json({ success: false, error: 'employee_code and company are required in the body' });
  }

  const row = db.prepare('SELECT * FROM sales_monthly_input WHERE id = ? AND upload_id = ?').get(rowId, uploadId);
  if (!row) return res.status(404).json({ success: false, error: 'Upload row not found' });

  if (company !== row.company) {
    return res.status(400).json({ success: false, error: `Cross-company match not allowed — row company is ${row.company}` });
  }

  const emp = db.prepare('SELECT id, name FROM sales_employees WHERE code = ? AND company = ?')
                .get(employee_code, company);
  if (!emp) return res.status(404).json({ success: false, error: `Sales employee ${employee_code} not found in ${company}` });

  db.prepare(`
    UPDATE sales_monthly_input
       SET employee_code = ?, match_confidence = 'manual', match_method = 'hr_manual'
     WHERE id = ?
  `).run(employee_code, rowId);

  // Recompute upload counts
  const counts = db.prepare(`
    SELECT
      SUM(CASE WHEN employee_code IS NOT NULL THEN 1 ELSE 0 END) AS matched,
      SUM(CASE WHEN employee_code IS NULL     THEN 1 ELSE 0 END) AS unmatched
    FROM sales_monthly_input WHERE upload_id = ?
  `).get(uploadId);
  db.prepare('UPDATE sales_uploads SET matched_rows = ?, unmatched_rows = ? WHERE id = ?')
    .run(counts.matched || 0, counts.unmatched || 0, uploadId);

  writeAuditP2(db, 'sales_monthly_input', {
    recordId: rowId, field: 'employee_code',
    oldVal: row.employee_code, newVal: employee_code,
    user, actionType: 'manual_match',
    remark: `HR linked sheet row "${row.sheet_employee_name}" → ${employee_code}`,
    empCode: employee_code,
  });

  const updated = db.prepare('SELECT * FROM sales_monthly_input WHERE id = ?').get(rowId);
  res.json({ success: true, data: updated });
});

// POST /api/sales/upload/:uploadId/confirm — lock matches
router.post('/upload/:uploadId/confirm', (req, res) => {
  const db = getDb();
  const user = req.user?.username || 'unknown';
  const uploadId = parseInt(req.params.uploadId, 10);
  if (!uploadId) return res.status(400).json({ success: false, error: 'Invalid uploadId' });

  const upload = db.prepare('SELECT * FROM sales_uploads WHERE id = ?').get(uploadId);
  if (!upload) return res.status(404).json({ success: false, error: 'Upload not found' });

  const stillUnmatched = db.prepare(`
    SELECT COUNT(*) AS c FROM sales_monthly_input WHERE upload_id = ? AND employee_code IS NULL
  `).get(uploadId).c;

  if (stillUnmatched > 0) {
    return res.status(400).json({
      success: false,
      error: `Cannot confirm — ${stillUnmatched} row(s) are still unmatched. Resolve every Low / Unmatched row first.`,
      data: { unmatchedCount: stillUnmatched },
    });
  }

  db.prepare("UPDATE sales_uploads SET status = 'matched' WHERE id = ?").run(uploadId);

  writeAuditP2(db, 'sales_uploads', {
    recordId: uploadId, field: 'status', oldVal: upload.status, newVal: 'matched',
    user, actionType: 'confirm',
    remark: `Sales upload #${uploadId} matches confirmed`,
  });

  const updated = db.prepare('SELECT * FROM sales_uploads WHERE id = ?').get(uploadId);
  res.json({ success: true, data: updated, message: 'Matches confirmed; ready for Phase 3 compute.' });
});

// ════════════════════════════════════════════════════════════════════
// Phase 3 — Compute engine + salary register + payslip
// (Q5 reversal: Diwali ledger removed; diwali_bonus is the only Diwali term)
// ════════════════════════════════════════════════════════════════════

const {
  computeSalesEmployee,
  saveSalesSalaryComputation,
  generateSalesPayslipData,
} = require('../services/salesSalaryComputation');

const VALID_COMP_STATUSES = ['computed', 'reviewed', 'finalized', 'paid', 'hold'];

// Allowed status transitions. Phase 3 is permissive but blocks regressions
// from finalized/paid back to computed (those should require admin).
const ALLOWED_STATUS_MOVES = {
  computed:  ['reviewed', 'hold'],
  reviewed:  ['computed', 'finalized', 'hold'],
  finalized: ['paid', 'hold'],
  paid:      [],              // terminal
  hold:      ['computed', 'reviewed'],
};

// ── POST /api/sales/compute ─────────────────────────────────────────
router.post('/compute', (req, res) => {
  const db = getDb();
  const user = req.user?.username || 'unknown';
  const body = req.body || {};
  const month = parseInt(body.month, 10);
  const year  = parseInt(body.year, 10);
  const company = (body.company || '').trim();

  if (!month || !year || !company) {
    return res.status(400).json({ success: false, error: 'month, year, and company are required in the body' });
  }

  // Supersede semantics: latest matched upload per (month, year, company) wins.
  const upload = db.prepare(`
    SELECT * FROM sales_uploads
     WHERE month = ? AND year = ? AND company = ? AND status IN ('matched', 'computed')
  ORDER BY uploaded_at DESC, id DESC
     LIMIT 1
  `).get(month, year, company);
  if (!upload) {
    return res.status(400).json({
      success: false, reason: 'no_confirmed_upload',
      error: `No confirmed sales upload for ${month}/${year} ${company}. Upload + confirm first.`,
    });
  }

  const rows = db.prepare(`
    SELECT i.*, e.id AS sales_employee_id
      FROM sales_monthly_input i
 LEFT JOIN sales_employees e ON e.code = i.employee_code AND e.company = i.company
     WHERE i.upload_id = ? AND i.employee_code IS NOT NULL
  `).all(upload.id);

  const results = [];
  const excluded = [];
  const errors = [];
  const finalizedRecomputeWarnings = [];

  for (const row of rows) {
    if (!row.sales_employee_id) {
      excluded.push({ employee_code: row.employee_code, reason: 'employee_not_found' });
      continue;
    }
    const salesEmployee = db.prepare('SELECT * FROM sales_employees WHERE id = ?').get(row.sales_employee_id);

    try {
      // Per-employee transaction so one bad row doesn't roll back all.
      const perTxn = db.transaction(() => {
        // Capture previous net_salary for finalized-recompute-warning logic.
        const prev = db.prepare(`
          SELECT net_salary, status FROM sales_salary_computations
           WHERE employee_code=? AND month=? AND year=? AND company=?
        `).get(row.employee_code, month, year, company);

        const comp = computeSalesEmployee(db, {
          salesEmployee, monthlyInputRow: row, month, year, company,
          requestId: req.requestId, user,
        });
        if (!comp.success) {
          if (comp.excluded) excluded.push({ employee_code: row.employee_code, reason: comp.reason });
          else errors.push({ employee_code: row.employee_code, error: comp.error });
          return;
        }
        saveSalesSalaryComputation(db, comp);

        // Flag recomputes that silently change money on a locked row.
        if (prev && ['finalized', 'paid'].includes(prev.status) &&
            Math.abs((prev.net_salary || 0) - comp.net_salary) > 1) {
          finalizedRecomputeWarnings.push({
            employee_code: row.employee_code,
            prev_status: prev.status,
            prev_net_salary: prev.net_salary,
            new_net_salary: comp.net_salary,
            delta: Math.round((comp.net_salary - prev.net_salary) * 100) / 100,
          });
        }

        results.push({
          employee_code: comp.employee_code,
          net_salary: comp.net_salary,
          earned_ratio: comp.earned_ratio,
          status: comp.status,
        });
      });
      perTxn();
    } catch (perErr) {
      console.error(`[sales-compute] ${row.employee_code} ${month}/${year}: ${perErr.message}`);
      if (perErr.stack) console.error(perErr.stack.split('\n').slice(0, 5).join('\n'));
      errors.push({ employee_code: row.employee_code, error: perErr.message });
    }
  }

  // Stamp the winning upload as 'computed' so the UI knows Phase 3 has run.
  db.prepare("UPDATE sales_uploads SET status = 'computed' WHERE id = ?").run(upload.id);

  writeAuditP2(db, 'sales_salary_computations', {
    recordId: upload.id, field: 'compute_run', oldVal: '', newVal: `${results.length} computed`,
    user, actionType: 'compute',
    remark: `Sales compute: upload #${upload.id}, ${results.length} OK, ${excluded.length} excluded, ${errors.length} errors`,
  });

  res.json({
    success: true,
    data: {
      uploadId: upload.id,
      month, year, company,
      computed: results.length,
      excluded,
      errors,
      finalizedRecomputeWarnings,
    },
  });
});

// ── GET /api/sales/salary-register ───────────────────────────────────
router.get('/salary-register', (req, res) => {
  const db = getDb();
  const month = parseInt(req.query.month, 10);
  const year  = parseInt(req.query.year, 10);
  const company = (req.query.company || '').trim();
  if (!month || !year || !company) {
    return res.status(400).json({ success: false, error: 'month, year, and company query params are required' });
  }

  const rows = db.prepare(`
    SELECT c.*,
           e.name, e.headquarters, e.city_of_operation,
           e.designation, e.bank_name, e.account_no, e.ifsc,
           e.status AS employee_status
      FROM sales_salary_computations c
 LEFT JOIN sales_employees e ON e.code = c.employee_code AND e.company = c.company
     WHERE c.month = ? AND c.year = ? AND c.company = ?
  ORDER BY e.name ASC
  `).all(month, year, company);

  const totals = rows.reduce((acc, r) => ({
    gross_earned: acc.gross_earned + (r.gross_earned || 0),
    total_deductions: acc.total_deductions + (r.total_deductions || 0),
    net_salary: acc.net_salary + (r.net_salary || 0),
    incentive_amount: acc.incentive_amount + (r.incentive_amount || 0),
    diwali_bonus: acc.diwali_bonus + (r.diwali_bonus || 0),
  }), { gross_earned: 0, total_deductions: 0, net_salary: 0, incentive_amount: 0, diwali_bonus: 0 });

  const round2 = (n) => Math.round(n * 100) / 100;
  Object.keys(totals).forEach(k => totals[k] = round2(totals[k]));

  res.json({ success: true, data: { rows, totals, count: rows.length } });
});

// ── PUT /api/sales/salary/:id — HR manual override ───────────────────
router.put('/salary/:id', (req, res) => {
  const db = getDb();
  const user = req.user?.username || 'unknown';
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ success: false, error: 'Invalid id' });
  const body = req.body || {};

  const existing = db.prepare('SELECT * FROM sales_salary_computations WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ success: false, error: 'Sales salary row not found' });

  // Locked-status guard — HR should un-finalize first via /status endpoint.
  if (['finalized', 'paid'].includes(existing.status)) {
    return res.status(409).json({
      success: false,
      error: `Cannot edit: row is ${existing.status}. Use PUT /salary/:id/status to move it back to 'reviewed' first.`,
    });
  }

  const updates = {};
  // Q5 reversal: diwali_recovery dropped from allowlist (column kept dead);
  // diwali_bonus added so HR can enter the Oct/Nov one-off bonus via this path.
  for (const k of ['incentive_amount', 'diwali_bonus', 'other_deductions']) {
    if (body[k] !== undefined) {
      const n = parseFloat(body[k]);
      if (!Number.isFinite(n) || n < 0) {
        return res.status(400).json({ success: false, error: `${k} must be a non-negative number` });
      }
      updates[k] = Math.round(n * 100) / 100;
    }
  }
  if (body.hold_reason !== undefined) updates.hold_reason = body.hold_reason || null;

  if (Object.keys(updates).length === 0) {
    return res.json({ success: true, message: 'No updates', data: existing });
  }

  const incentive   = updates.incentive_amount ?? existing.incentive_amount ?? 0;
  const diwaliBonus = updates.diwali_bonus     ?? existing.diwali_bonus     ?? 0;
  const otherDed    = updates.other_deductions ?? existing.other_deductions ?? 0;

  // Rebuild total_deductions from the non-editable components + other_deductions.
  // (diwali_recovery is 0 per Q5 reversal — not in the sum.)
  const fixedDeductions =
    (existing.pf_employee || 0) + (existing.esi_employee || 0) +
    (existing.professional_tax || 0) + (existing.tds || 0) +
    (existing.advance_recovery || 0) + (existing.loan_recovery || 0);
  const newTotalDed = Math.round((fixedDeductions + otherDed) * 100) / 100;
  const newNetSalary = Math.round(((existing.gross_earned || 0) + diwaliBonus + incentive - newTotalDed) * 100) / 100;

  const perTxn = db.transaction(() => {
    const sets = [];
    const params = [];
    for (const [k, v] of Object.entries(updates)) {
      sets.push(`${k} = ?`);
      params.push(v);
    }
    sets.push('total_deductions = ?'); params.push(newTotalDed);
    sets.push('net_salary = ?');       params.push(newNetSalary);
    params.push(id);

    db.prepare(`UPDATE sales_salary_computations SET ${sets.join(', ')} WHERE id = ?`).run(...params);

    writeAuditP2(db, 'sales_salary_computations', {
      recordId: id, field: Object.keys(updates).join(','),
      oldVal: JSON.stringify({
        incentive_amount: existing.incentive_amount,
        diwali_bonus: existing.diwali_bonus,
        other_deductions: existing.other_deductions,
        hold_reason: existing.hold_reason,
      }),
      newVal: JSON.stringify(updates),
      user, actionType: 'manual_override', empCode: existing.employee_code,
      remark: `HR override: net ${existing.net_salary} → ${newNetSalary}`,
    });
  });
  perTxn();

  const updated = db.prepare('SELECT * FROM sales_salary_computations WHERE id = ?').get(id);
  res.json({ success: true, data: updated });
});

// ── PUT /api/sales/salary/:id/status ─────────────────────────────────
router.put('/salary/:id/status', (req, res) => {
  const db = getDb();
  const user = req.user?.username || 'unknown';
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ success: false, error: 'Invalid id' });

  const body = req.body || {};
  const next = (body.status || '').trim();
  if (!VALID_COMP_STATUSES.includes(next)) {
    return res.status(400).json({
      success: false,
      error: `status must be one of: ${VALID_COMP_STATUSES.join(', ')}`,
    });
  }

  const existing = db.prepare('SELECT * FROM sales_salary_computations WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ success: false, error: 'Sales salary row not found' });

  const allowed = ALLOWED_STATUS_MOVES[existing.status] || [];
  if (next !== existing.status && !allowed.includes(next)) {
    return res.status(400).json({
      success: false,
      error: `Invalid transition: ${existing.status} → ${next}. Allowed from ${existing.status}: ${allowed.join(', ') || '(terminal)'}`,
    });
  }

  const sets = ['status = ?'];
  const params = [next];
  if (next === 'finalized') {
    sets.push("finalized_at = datetime('now')", 'finalized_by = ?');
    params.push(user);
  }
  if (next === 'hold' && body.reason) {
    sets.push('hold_reason = ?'); params.push(body.reason);
  }
  params.push(id);

  db.prepare(`UPDATE sales_salary_computations SET ${sets.join(', ')} WHERE id = ?`).run(...params);

  writeAuditP2(db, 'sales_salary_computations', {
    recordId: id, field: 'status', oldVal: existing.status, newVal: next,
    user, actionType: 'status_change', empCode: existing.employee_code,
    remark: body.reason || `status ${existing.status} → ${next}`,
  });

  const updated = db.prepare('SELECT * FROM sales_salary_computations WHERE id = ?').get(id);
  res.json({ success: true, data: updated });
});

// ── GET /api/sales/payslip/:code?month=M&year=Y&company=C ────────────
router.get('/payslip/:code', (req, res) => {
  const db = getDb();
  const code = req.params.code;
  const month = parseInt(req.query.month, 10);
  const year  = parseInt(req.query.year, 10);
  const company = (req.query.company || '').trim();
  if (!month || !year || !company) {
    return res.status(400).json({ success: false, error: 'month, year, and company query params are required' });
  }

  const result = generateSalesPayslipData(db, code, month, year, company);
  if (!result.success) {
    return res.status(404).json(result);
  }
  res.json({ success: true, data: result });
});

module.exports = router;
