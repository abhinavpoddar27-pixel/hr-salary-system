const express = require('express');
const router = express.Router();
const { getDb } = require('../database/db');
const { requireHrOrAdmin, requireFinanceOrAdmin } = require('../middleware/roles');

// ── Helper: write DW audit log ────────────────────────────────
function dwAudit(db, entityType, entityId, action, oldValues, newValues, user) {
  db.prepare(`
    INSERT INTO dw_audit_log (entity_type, entity_id, action, old_values, new_values, performed_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(entityType, entityId, action, oldValues ? JSON.stringify(oldValues) : null, newValues ? JSON.stringify(newValues) : null, user);
}

// ═══════════════════════════════════════════════════════════════
//  CONTRACTOR MASTER CRUD
// ═══════════════════════════════════════════════════════════════

// GET / — List all contractors (optionally filter by is_active)
router.get('/contractors', (req, res) => {
  const db = getDb();
  const { is_active, search } = req.query;
  let query = 'SELECT * FROM dw_contractors WHERE 1=1';
  const params = [];
  if (is_active !== undefined && is_active !== '') {
    query += ' AND is_active = ?';
    params.push(Number(is_active));
  }
  if (search) {
    query += ' AND (contractor_name LIKE ? OR phone_number LIKE ? OR email LIKE ?)';
    const s = `%${search}%`;
    params.push(s, s, s);
  }
  query += ' ORDER BY contractor_name ASC';
  const data = db.prepare(query).all(...params);
  res.json({ success: true, data });
});

// GET /contractors/:id — Single contractor detail
router.get('/contractors/:id', (req, res) => {
  const db = getDb();
  const contractor = db.prepare('SELECT * FROM dw_contractors WHERE id = ?').get(req.params.id);
  if (!contractor) return res.status(404).json({ success: false, error: 'Contractor not found' });
  res.json({ success: true, data: contractor });
});

// POST /contractors — Create a new contractor (HR/admin)
router.post('/contractors', requireHrOrAdmin, (req, res) => {
  const db = getDb();
  const { contractor_name, phone_number, email, bank_account, current_daily_wage_rate, current_commission_rate, payment_terms } = req.body;
  if (!contractor_name) return res.status(400).json({ success: false, error: 'contractor_name is required' });
  if (current_daily_wage_rate == null || current_daily_wage_rate < 0) {
    return res.status(400).json({ success: false, error: 'current_daily_wage_rate must be >= 0' });
  }
  if (current_commission_rate == null || current_commission_rate < 0) {
    return res.status(400).json({ success: false, error: 'current_commission_rate must be >= 0' });
  }

  // Check uniqueness
  const existing = db.prepare('SELECT id FROM dw_contractors WHERE contractor_name = ?').get(contractor_name);
  if (existing) return res.status(409).json({ success: false, error: 'Contractor with this name already exists' });

  const result = db.prepare(`
    INSERT INTO dw_contractors (contractor_name, phone_number, email, bank_account, current_daily_wage_rate, current_commission_rate, payment_terms, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    contractor_name.trim(),
    phone_number || null,
    email || null,
    bank_account || null,
    Number(current_daily_wage_rate) || 0,
    Number(current_commission_rate) || 0,
    payment_terms || 'monthly',
    req.user?.username || 'system'
  );

  dwAudit(db, 'contractor', result.lastInsertRowid, 'create', null, req.body, req.user?.username || 'system');
  res.json({ success: true, id: result.lastInsertRowid });
});

// PUT /contractors/:id — Update contractor details (HR/admin)
router.put('/contractors/:id', requireHrOrAdmin, (req, res) => {
  const db = getDb();
  const contractor = db.prepare('SELECT * FROM dw_contractors WHERE id = ?').get(req.params.id);
  if (!contractor) return res.status(404).json({ success: false, error: 'Contractor not found' });

  const { contractor_name, phone_number, email, bank_account, payment_terms, is_active } = req.body;

  // If name is being changed, check uniqueness
  if (contractor_name && contractor_name.trim() !== contractor.contractor_name) {
    const dup = db.prepare('SELECT id FROM dw_contractors WHERE contractor_name = ? AND id != ?').get(contractor_name.trim(), req.params.id);
    if (dup) return res.status(409).json({ success: false, error: 'Contractor with this name already exists' });
  }

  db.prepare(`
    UPDATE dw_contractors SET
      contractor_name = COALESCE(?, contractor_name),
      phone_number = COALESCE(?, phone_number),
      email = COALESCE(?, email),
      bank_account = COALESCE(?, bank_account),
      payment_terms = COALESCE(?, payment_terms),
      is_active = COALESCE(?, is_active),
      updated_at = datetime('now')
    WHERE id = ?
  `).run(
    contractor_name ? contractor_name.trim() : null,
    phone_number !== undefined ? phone_number : null,
    email !== undefined ? email : null,
    bank_account !== undefined ? bank_account : null,
    payment_terms || null,
    is_active !== undefined ? Number(is_active) : null,
    req.params.id
  );

  dwAudit(db, 'contractor', Number(req.params.id), 'update', contractor, req.body, req.user?.username || 'system');
  const updated = db.prepare('SELECT * FROM dw_contractors WHERE id = ?').get(req.params.id);
  res.json({ success: true, data: updated });
});

// PUT /contractors/:id/deactivate — Soft-delete (HR/admin)
router.put('/contractors/:id/deactivate', requireHrOrAdmin, (req, res) => {
  const db = getDb();
  const contractor = db.prepare('SELECT * FROM dw_contractors WHERE id = ?').get(req.params.id);
  if (!contractor) return res.status(404).json({ success: false, error: 'Contractor not found' });
  if (contractor.is_active === 0) return res.status(400).json({ success: false, error: 'Contractor is already inactive' });

  db.prepare('UPDATE dw_contractors SET is_active = 0, updated_at = datetime(\'now\') WHERE id = ?').run(req.params.id);
  dwAudit(db, 'contractor', Number(req.params.id), 'deactivate', { is_active: 1 }, { is_active: 0 }, req.user?.username || 'system');
  res.json({ success: true, message: 'Contractor deactivated' });
});

// PUT /contractors/:id/reactivate — Reactivate (HR/admin)
router.put('/contractors/:id/reactivate', requireHrOrAdmin, (req, res) => {
  const db = getDb();
  const contractor = db.prepare('SELECT * FROM dw_contractors WHERE id = ?').get(req.params.id);
  if (!contractor) return res.status(404).json({ success: false, error: 'Contractor not found' });
  if (contractor.is_active === 1) return res.status(400).json({ success: false, error: 'Contractor is already active' });

  db.prepare('UPDATE dw_contractors SET is_active = 1, updated_at = datetime(\'now\') WHERE id = ?').run(req.params.id);
  dwAudit(db, 'contractor', Number(req.params.id), 'reactivate', { is_active: 0 }, { is_active: 1 }, req.user?.username || 'system');
  res.json({ success: true, message: 'Contractor reactivated' });
});

// ═══════════════════════════════════════════════════════════════
//  RATE MANAGEMENT
// ═══════════════════════════════════════════════════════════════

// GET /contractors/:id/rates — Rate history for a contractor
router.get('/contractors/:id/rates', (req, res) => {
  const db = getDb();
  const contractor = db.prepare('SELECT id FROM dw_contractors WHERE id = ?').get(req.params.id);
  if (!contractor) return res.status(404).json({ success: false, error: 'Contractor not found' });

  const data = db.prepare(`
    SELECT * FROM dw_rate_history WHERE contractor_id = ? ORDER BY effective_date DESC, id DESC
  `).all(req.params.id);
  res.json({ success: true, data });
});

// POST /contractors/:id/rates — Propose a rate change (HR/admin)
router.post('/contractors/:id/rates', requireHrOrAdmin, (req, res) => {
  const db = getDb();
  const contractor = db.prepare('SELECT * FROM dw_contractors WHERE id = ?').get(req.params.id);
  if (!contractor) return res.status(404).json({ success: false, error: 'Contractor not found' });

  const { new_wage_rate, new_commission_rate, effective_date, remarks } = req.body;
  if (new_wage_rate == null || new_wage_rate < 0) {
    return res.status(400).json({ success: false, error: 'new_wage_rate must be >= 0' });
  }
  if (new_commission_rate == null || new_commission_rate < 0) {
    return res.status(400).json({ success: false, error: 'new_commission_rate must be >= 0' });
  }
  if (!effective_date) return res.status(400).json({ success: false, error: 'effective_date is required' });

  const result = db.prepare(`
    INSERT INTO dw_rate_history (contractor_id, old_wage_rate, new_wage_rate, old_commission_rate, new_commission_rate, effective_date, proposed_by, remarks)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    req.params.id,
    contractor.current_daily_wage_rate,
    Number(new_wage_rate),
    contractor.current_commission_rate,
    Number(new_commission_rate),
    effective_date,
    req.user?.username || 'system',
    remarks || null
  );

  dwAudit(db, 'rate_change', result.lastInsertRowid, 'propose', {
    wage_rate: contractor.current_daily_wage_rate,
    commission_rate: contractor.current_commission_rate
  }, {
    wage_rate: Number(new_wage_rate),
    commission_rate: Number(new_commission_rate),
    effective_date
  }, req.user?.username || 'system');

  res.json({ success: true, id: result.lastInsertRowid });
});

// PUT /rates/:id/approve — Finance approves a rate change
router.put('/rates/:id/approve', requireFinanceOrAdmin, (req, res) => {
  const db = getDb();
  const rate = db.prepare('SELECT * FROM dw_rate_history WHERE id = ?').get(req.params.id);
  if (!rate) return res.status(404).json({ success: false, error: 'Rate change not found' });
  if (rate.approval_status !== 'pending') {
    return res.status(400).json({ success: false, error: `Rate change is already ${rate.approval_status}` });
  }

  const user = req.user?.username || 'system';
  const doApprove = db.transaction(() => {
    // Approve the rate change
    db.prepare(`
      UPDATE dw_rate_history SET approval_status = 'approved', approved_by = ?, approved_at = datetime('now')
      WHERE id = ?
    `).run(user, req.params.id);

    // Update the contractor's current rates
    db.prepare(`
      UPDATE dw_contractors SET current_daily_wage_rate = ?, current_commission_rate = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(rate.new_wage_rate, rate.new_commission_rate, rate.contractor_id);
  });

  doApprove();

  dwAudit(db, 'rate_change', Number(req.params.id), 'approve', { approval_status: 'pending' }, { approval_status: 'approved' }, user);
  res.json({ success: true, message: 'Rate change approved and applied' });
});

// PUT /rates/:id/reject — Finance rejects a rate change
router.put('/rates/:id/reject', requireFinanceOrAdmin, (req, res) => {
  const db = getDb();
  const rate = db.prepare('SELECT * FROM dw_rate_history WHERE id = ?').get(req.params.id);
  if (!rate) return res.status(404).json({ success: false, error: 'Rate change not found' });
  if (rate.approval_status !== 'pending') {
    return res.status(400).json({ success: false, error: `Rate change is already ${rate.approval_status}` });
  }

  const { remarks } = req.body;
  const user = req.user?.username || 'system';
  db.prepare(`
    UPDATE dw_rate_history SET approval_status = 'rejected', approved_by = ?, approved_at = datetime('now'), remarks = COALESCE(?, remarks)
    WHERE id = ?
  `).run(user, remarks || null, req.params.id);

  dwAudit(db, 'rate_change', Number(req.params.id), 'reject', { approval_status: 'pending' }, { approval_status: 'rejected', remarks }, user);
  res.json({ success: true, message: 'Rate change rejected' });
});

// GET /rates/pending — All pending rate changes (for finance review queue)
router.get('/rates/pending', (req, res) => {
  const db = getDb();
  const data = db.prepare(`
    SELECT rh.*, c.contractor_name
    FROM dw_rate_history rh
    JOIN dw_contractors c ON c.id = rh.contractor_id
    WHERE rh.approval_status = 'pending'
    ORDER BY rh.proposed_at DESC
  `).all();
  res.json({ success: true, data });
});

// GET /contractors/:id/summary — Contractor summary with stats
router.get('/contractors/:id/summary', (req, res) => {
  const db = getDb();
  const contractor = db.prepare('SELECT * FROM dw_contractors WHERE id = ?').get(req.params.id);
  if (!contractor) return res.status(404).json({ success: false, error: 'Contractor not found' });

  const totalEntries = db.prepare('SELECT COUNT(*) as count FROM dw_entries WHERE contractor_id = ?').get(req.params.id);
  const totalWorkers = db.prepare('SELECT COALESCE(SUM(total_worker_count), 0) as total FROM dw_entries WHERE contractor_id = ?').get(req.params.id);
  const totalLiability = db.prepare('SELECT COALESCE(SUM(total_liability), 0) as total FROM dw_entries WHERE contractor_id = ?').get(req.params.id);
  const totalPaid = db.prepare(`
    SELECT COALESCE(SUM(p.total_amount), 0) as total
    FROM dw_payments p WHERE p.contractor_id = ?
  `).get(req.params.id);
  const pendingRateChanges = db.prepare(
    "SELECT COUNT(*) as count FROM dw_rate_history WHERE contractor_id = ? AND approval_status = 'pending'"
  ).get(req.params.id);

  res.json({
    success: true,
    data: {
      ...contractor,
      total_entries: totalEntries.count,
      total_workers_deployed: totalWorkers.total,
      total_liability: Math.round(totalLiability.total * 100) / 100,
      total_paid: Math.round(totalPaid.total * 100) / 100,
      outstanding: Math.round((totalLiability.total - totalPaid.total) * 100) / 100,
      pending_rate_changes: pendingRateChanges.count
    }
  });
});

// ═══════════════════════════════════════════════════════════════
//  ENTRY CREATION, LISTING & MANAGEMENT
// ═══════════════════════════════════════════════════════════════

// ── Shared validation helper for a single entry row ──────────
function validateEntryRow(db, row, rowIndex) {
  const errors = [];
  const prefix = rowIndex != null ? `Row ${rowIndex + 1}: ` : '';

  // 1. contractor — resolved before calling this
  if (!row._contractor) {
    errors.push({ row: rowIndex, field: 'contractor', error: `${prefix}Contractor not found or inactive` });
    return errors; // can't continue without contractor
  }

  // 2. entry_date — valid ISO, not future
  if (!row.entry_date || !/^\d{4}-\d{2}-\d{2}$/.test(row.entry_date)) {
    errors.push({ row: rowIndex, field: 'entry_date', error: `${prefix}entry_date must be a valid YYYY-MM-DD date` });
  } else {
    const d = new Date(row.entry_date + 'T00:00:00');
    if (isNaN(d.getTime())) {
      errors.push({ row: rowIndex, field: 'entry_date', error: `${prefix}entry_date is not a valid date` });
    }
    const today = new Date().toISOString().slice(0, 10);
    if (row.entry_date > today) {
      errors.push({ row: rowIndex, field: 'entry_date', error: `${prefix}entry_date cannot be in the future` });
    }
  }

  // 3. in_time < out_time
  if (!row.in_time || !row.out_time) {
    errors.push({ row: rowIndex, field: 'in_time/out_time', error: `${prefix}in_time and out_time are required` });
  } else if (row.in_time >= row.out_time) {
    errors.push({ row: rowIndex, field: 'in_time', error: `${prefix}in_time must be before out_time` });
  }

  // 4. total_worker_count
  const wc = Number(row.total_worker_count);
  if (!Number.isInteger(wc) || wc <= 0) {
    errors.push({ row: rowIndex, field: 'total_worker_count', error: `${prefix}total_worker_count must be a positive integer` });
  }

  // 5-8. department_allocations
  const allocs = row.department_allocations;
  if (!Array.isArray(allocs) || allocs.length === 0) {
    errors.push({ row: rowIndex, field: 'department_allocations', error: `${prefix}department_allocations must be a non-empty array` });
  } else {
    let allocSum = 0;
    for (let i = 0; i < allocs.length; i++) {
      const a = allocs[i];
      if (!a.department || typeof a.department !== 'string' || !a.department.trim()) {
        errors.push({ row: rowIndex, field: `department_allocations[${i}].department`, error: `${prefix}Department name at index ${i} is empty` });
      }
      const ac = Number(a.worker_count);
      if (!Number.isInteger(ac) || ac <= 0) {
        errors.push({ row: rowIndex, field: `department_allocations[${i}].worker_count`, error: `${prefix}worker_count at index ${i} must be a positive integer` });
      }
      allocSum += ac;
    }
    if (Number.isInteger(wc) && wc > 0 && allocSum !== wc) {
      errors.push({ row: rowIndex, field: 'department_allocations', error: `${prefix}Sum of department worker counts (${allocSum}) does not match total_worker_count (${wc})` });
    }
  }

  // 9. gate_entry_reference
  if (!row.gate_entry_reference || !String(row.gate_entry_reference).trim()) {
    errors.push({ row: rowIndex, field: 'gate_entry_reference', error: `${prefix}gate_entry_reference is required` });
  }

  // 10. duplicate check — (contractor, date, normalised gate ref) is unique
  if (row.entry_date && row._contractor && row.gate_entry_reference) {
    const dup = db.prepare(`
      SELECT id, entry_date, in_time, out_time, gate_entry_reference FROM dw_entries
      WHERE contractor_id = ? AND entry_date = ?
        AND LOWER(TRIM(gate_entry_reference)) = LOWER(TRIM(?))
    `).get(
      row._contractor.id,
      row.entry_date,
      String(row.gate_entry_reference)
    );
    if (dup) {
      errors.push({
        row: rowIndex,
        field: 'duplicate',
        error: `${prefix}An entry already exists for this contractor on this date with Gate Entry "${dup.gate_entry_reference}". Use a different Gate Entry Reference.`,
        duplicate: dup
      });
    }
  }

  return errors;
}

// ── Insert a single entry + allocations (called inside a transaction) ──
function insertEntry(db, row, user, company) {
  const c = row._contractor;
  const wageRate = c.current_daily_wage_rate;
  const commRate = c.current_commission_rate;
  const wc = Number(row.total_worker_count);
  const totalWage = Math.round(wc * wageRate * 100) / 100;
  const totalComm = Math.round(wc * commRate * 100) / 100;
  const totalLiability = Math.round((totalWage + totalComm) * 100) / 100;

  const result = db.prepare(`
    INSERT INTO dw_entries (contractor_id, entry_date, in_time, out_time,
      total_worker_count, wage_rate_applied, commission_rate_applied,
      total_wage_amount, total_commission_amount, total_liability,
      gate_entry_reference, notes, status, created_by, company)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'hr_entered', ?, ?)
  `).run(
    c.id, row.entry_date, row.in_time, row.out_time,
    wc, wageRate, commRate,
    totalWage, totalComm, totalLiability,
    String(row.gate_entry_reference).trim(), row.notes || null,
    user, company || ''
  );
  const entryId = result.lastInsertRowid;

  const insertAlloc = db.prepare(`
    INSERT INTO dw_department_allocations (entry_id, department, worker_count, allocated_wage_amount, allocated_commission_amount)
    VALUES (?, ?, ?, ?, ?)
  `);
  for (const a of row.department_allocations) {
    const awc = Number(a.worker_count);
    insertAlloc.run(
      entryId,
      a.department.trim(),
      awc,
      Math.round(awc * wageRate * 100) / 100,
      Math.round(awc * commRate * 100) / 100
    );
  }

  return entryId;
}

// GET /entries/template — XLSX template structure (static routes BEFORE :id)
router.get('/entries/template', (req, res) => {
  res.json({
    success: true,
    data: {
      columns: [
        'Date (YYYY-MM-DD)', 'Contractor Name', 'In-Time (HH:MM)', 'Out-Time (HH:MM)',
        'Total Workers', 'Department Allocations (Dept1:Count,Dept2:Count)',
        'Gate Entry Ref', 'Notes'
      ],
      example: [
        '2026-04-10', 'Rajesh Kumar', '08:00', '17:00', '20',
        'Manufacturing:6,Scrap:4,Admin:10', 'GE-2026-04-10-001', 'Seasonal workers'
      ]
    }
  });
});

// POST /entries/check-duplicates — Pre-save duplicate check
router.post('/entries/check-duplicates', (req, res) => {
  const db = getDb();
  const { contractor_id, entry_date, gate_entry_reference } = req.body;
  if (!contractor_id || !entry_date || !gate_entry_reference) {
    return res.status(400).json({ success: false, error: 'contractor_id, entry_date, gate_entry_reference are required' });
  }
  const duplicates = db.prepare(`
    SELECT e.id, e.entry_date, e.in_time, e.out_time, e.total_worker_count, e.status,
           e.gate_entry_reference, c.contractor_name
    FROM dw_entries e
    JOIN dw_contractors c ON c.id = e.contractor_id
    WHERE e.contractor_id = ? AND e.entry_date = ?
      AND LOWER(TRIM(e.gate_entry_reference)) = LOWER(TRIM(?))
  `).all(contractor_id, entry_date, String(gate_entry_reference));
  res.json({ success: true, data: { duplicates } });
});

// POST /entries/batch-import — Batch import (HR/admin)
router.post('/entries/batch-import', requireHrOrAdmin, (req, res) => {
  const db = getDb();
  const { entries } = req.body;
  if (!Array.isArray(entries) || entries.length === 0) {
    return res.status(400).json({ success: false, error: 'entries must be a non-empty array' });
  }
  if (entries.length > 500) {
    return res.status(400).json({ success: false, error: 'Maximum 500 entries per batch' });
  }

  const user = req.user?.username || 'system';
  const allErrors = [];

  // Phase 1: resolve contractors and validate all rows
  const resolvedRows = entries.map((row, idx) => {
    // Resolve contractor_name → contractor
    let contractor = null;
    if (row.contractor_name) {
      contractor = db.prepare(
        'SELECT * FROM dw_contractors WHERE contractor_name = ? COLLATE NOCASE AND is_active = 1'
      ).get(row.contractor_name.trim());
      if (!contractor) {
        allErrors.push({ row: idx, field: 'contractor_name', error: `Row ${idx + 1}: Contractor "${row.contractor_name}" not found or inactive` });
      }
    } else {
      allErrors.push({ row: idx, field: 'contractor_name', error: `Row ${idx + 1}: contractor_name is required` });
    }

    // Parse department allocations from "Dept1:Count,Dept2:Count" string format
    let department_allocations = row.department_allocations;
    if (typeof department_allocations === 'string') {
      department_allocations = department_allocations.split(',').map(pair => {
        const [department, count] = pair.split(':').map(s => s.trim());
        return { department, worker_count: Number(count) || 0 };
      }).filter(a => a.department);
    }

    const resolved = { ...row, department_allocations, _contractor: contractor };
    const rowErrors = validateEntryRow(db, resolved, idx);
    allErrors.push(...rowErrors);
    return resolved;
  });

  if (allErrors.length > 0) {
    return res.status(400).json({
      success: false,
      errors: allErrors,
      valid_count: entries.length - new Set(allErrors.map(e => e.row)).size,
      invalid_count: new Set(allErrors.map(e => e.row)).size
    });
  }

  // Phase 2: insert all in a single transaction
  const doImport = db.transaction(() => {
    const ids = [];
    for (const row of resolvedRows) {
      const entryId = insertEntry(db, row, user, req.body.company || req.query.company);
      dwAudit(db, 'entry', entryId, 'batch_create', null, {
        contractor_id: row._contractor.id, entry_date: row.entry_date,
        total_worker_count: row.total_worker_count
      }, user);
      ids.push(entryId);
    }
    return ids;
  });

  const ids = doImport();
  res.json({ success: true, imported: ids.length, ids });
});

// POST /entries — Create single entry (HR/admin)
router.post('/entries', requireHrOrAdmin, (req, res) => {
  const db = getDb();
  const user = req.user?.username || 'system';
  const { contractor_id } = req.body;

  // Resolve contractor
  if (!contractor_id) return res.status(400).json({ success: false, error: 'contractor_id is required' });
  const contractor = db.prepare('SELECT * FROM dw_contractors WHERE id = ? AND is_active = 1').get(contractor_id);
  if (!contractor) return res.status(400).json({ success: false, error: 'Contractor not found or inactive' });

  // Check contractor has rates set (either initial or at least one approved rate change)
  if (contractor.current_daily_wage_rate <= 0 && contractor.current_commission_rate <= 0) {
    return res.status(400).json({ success: false, error: 'Contractor has no rates configured. Set wage or commission rate first.' });
  }

  const row = { ...req.body, _contractor: contractor };
  const errors = validateEntryRow(db, row, null);

  // If duplicate found, return 409
  const dupError = errors.find(e => e.field === 'duplicate');
  if (dupError) {
    return res.status(409).json({ success: false, error: 'Duplicate entry detected', duplicate: dupError.duplicate });
  }
  if (errors.length > 0) {
    return res.status(400).json({ success: false, error: errors[0].error, errors });
  }

  const doCreate = db.transaction(() => {
    const entryId = insertEntry(db, row, user, req.body.company || req.query.company);
    dwAudit(db, 'entry', entryId, 'create', null, {
      contractor_id, entry_date: req.body.entry_date,
      total_worker_count: req.body.total_worker_count,
      gate_entry_reference: req.body.gate_entry_reference
    }, user);
    return entryId;
  });

  const entryId = doCreate();

  // Return the created entry with allocations
  const entry = db.prepare('SELECT * FROM dw_entries WHERE id = ?').get(entryId);
  const allocations = db.prepare('SELECT * FROM dw_department_allocations WHERE entry_id = ?').all(entryId);
  res.json({ success: true, data: { ...entry, department_allocations: allocations } });
});

// GET /entries — List entries with pagination and filters
router.get('/entries', (req, res) => {
  const db = getDb();
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 25));
  const offset = (page - 1) * limit;

  let where = 'WHERE 1=1';
  const params = [];

  if (req.query.contractor_id) {
    where += ' AND e.contractor_id = ?';
    params.push(Number(req.query.contractor_id));
  }
  if (req.query.date_from) {
    where += ' AND e.entry_date >= ?';
    params.push(req.query.date_from);
  }
  if (req.query.date_to) {
    where += ' AND e.entry_date <= ?';
    params.push(req.query.date_to);
  }
  if (req.query.status) {
    where += ' AND e.status = ?';
    params.push(req.query.status);
  }
  if (req.query.search) {
    where += ' AND (e.gate_entry_reference LIKE ? OR e.notes LIKE ?)';
    const s = `%${req.query.search}%`;
    params.push(s, s);
  }
  if (req.query.department) {
    where += ' AND e.id IN (SELECT entry_id FROM dw_department_allocations WHERE department = ?)';
    params.push(req.query.department);
  }

  // Count total
  const countRow = db.prepare(`SELECT COUNT(*) as total FROM dw_entries e ${where}`).get(...params);
  const total = countRow.total;

  // Fetch page
  const entries = db.prepare(`
    SELECT e.*, c.contractor_name
    FROM dw_entries e
    JOIN dw_contractors c ON c.id = e.contractor_id
    ${where}
    ORDER BY e.entry_date DESC, e.id DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  // Fetch allocations for all entries in this page
  if (entries.length > 0) {
    const entryIds = entries.map(e => e.id);
    const placeholders = entryIds.map(() => '?').join(',');
    const allocs = db.prepare(
      `SELECT * FROM dw_department_allocations WHERE entry_id IN (${placeholders}) ORDER BY department`
    ).all(...entryIds);
    const allocMap = {};
    for (const a of allocs) {
      if (!allocMap[a.entry_id]) allocMap[a.entry_id] = [];
      allocMap[a.entry_id].push(a);
    }
    for (const e of entries) {
      e.department_allocations = allocMap[e.id] || [];
    }
  }

  // Summary counts
  const summary = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = 'hr_entered' THEN 1 ELSE 0 END) as hr_entered,
      SUM(CASE WHEN status = 'pending_finance' THEN 1 ELSE 0 END) as pending_finance,
      SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) as approved,
      SUM(CASE WHEN status = 'needs_correction' THEN 1 ELSE 0 END) as needs_correction,
      SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END) as paid,
      SUM(CASE WHEN status = 'flagged' THEN 1 ELSE 0 END) as flagged,
      SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) as rejected
    FROM dw_entries
  `).get();

  res.json({
    success: true,
    data: entries,
    pagination: { page, pageSize: limit, total, totalPages: Math.ceil(total / limit) },
    summary
  });
});

// GET /entries/:id — Single entry detail
router.get('/entries/:id', (req, res) => {
  const db = getDb();
  const entry = db.prepare(`
    SELECT e.*, c.contractor_name, c.phone_number as contractor_phone, c.is_active as contractor_active
    FROM dw_entries e
    JOIN dw_contractors c ON c.id = e.contractor_id
    WHERE e.id = ?
  `).get(req.params.id);
  if (!entry) return res.status(404).json({ success: false, error: 'Entry not found' });

  const allocations = db.prepare(
    'SELECT * FROM dw_department_allocations WHERE entry_id = ? ORDER BY department'
  ).all(req.params.id);

  const approvals = db.prepare(
    'SELECT * FROM dw_approvals WHERE entry_id = ? ORDER BY acted_at DESC'
  ).all(req.params.id);

  res.json({ success: true, data: { ...entry, department_allocations: allocations, approval_history: approvals } });
});

// PUT /entries/:id — Update entry (HR only, before approval)
router.put('/entries/:id', requireHrOrAdmin, (req, res) => {
  const db = getDb();
  const user = req.user?.username || 'system';
  const entry = db.prepare('SELECT * FROM dw_entries WHERE id = ?').get(req.params.id);
  if (!entry) return res.status(404).json({ success: false, error: 'Entry not found' });

  // Only editable in hr_entered or needs_correction status
  if (entry.status !== 'hr_entered' && entry.status !== 'needs_correction') {
    return res.status(403).json({ success: false, error: 'Cannot edit approved entries' });
  }

  const contractor = db.prepare('SELECT * FROM dw_contractors WHERE id = ? AND is_active = 1').get(entry.contractor_id);
  if (!contractor) return res.status(400).json({ success: false, error: 'Contractor not found or inactive' });

  const row = { ...req.body, _contractor: contractor };
  // Use existing values as fallback for partial updates
  if (!row.entry_date) row.entry_date = entry.entry_date;
  if (!row.in_time) row.in_time = entry.in_time;
  if (!row.out_time) row.out_time = entry.out_time;
  if (row.total_worker_count == null) row.total_worker_count = entry.total_worker_count;
  if (!row.gate_entry_reference) row.gate_entry_reference = entry.gate_entry_reference;

  const errors = validateEntryRow(db, row, null).filter(e => {
    // Ignore duplicate detection against the entry itself
    if (e.field === 'duplicate' && e.duplicate && e.duplicate.id === entry.id) return false;
    return true;
  });

  const dupError = errors.find(e => e.field === 'duplicate');
  if (dupError) {
    return res.status(409).json({ success: false, error: 'Duplicate entry detected', duplicate: dupError.duplicate });
  }
  if (errors.length > 0) {
    return res.status(400).json({ success: false, error: errors[0].error, errors });
  }

  const wageRate = contractor.current_daily_wage_rate;
  const commRate = contractor.current_commission_rate;
  const wc = Number(row.total_worker_count);
  const totalWage = Math.round(wc * wageRate * 100) / 100;
  const totalComm = Math.round(wc * commRate * 100) / 100;
  const totalLiability = Math.round((totalWage + totalComm) * 100) / 100;
  const newStatus = entry.status === 'needs_correction' ? 'hr_entered' : entry.status;

  const doUpdate = db.transaction(() => {
    db.prepare(`
      UPDATE dw_entries SET
        entry_date = ?, in_time = ?, out_time = ?,
        total_worker_count = ?, wage_rate_applied = ?, commission_rate_applied = ?,
        total_wage_amount = ?, total_commission_amount = ?, total_liability = ?,
        gate_entry_reference = ?, notes = ?, status = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(
      row.entry_date, row.in_time, row.out_time,
      wc, wageRate, commRate,
      totalWage, totalComm, totalLiability,
      String(row.gate_entry_reference).trim(), row.notes || null, newStatus,
      req.params.id
    );

    // Replace allocations
    db.prepare('DELETE FROM dw_department_allocations WHERE entry_id = ?').run(req.params.id);
    const insertAlloc = db.prepare(`
      INSERT INTO dw_department_allocations (entry_id, department, worker_count, allocated_wage_amount, allocated_commission_amount)
      VALUES (?, ?, ?, ?, ?)
    `);
    for (const a of row.department_allocations) {
      const awc = Number(a.worker_count);
      insertAlloc.run(
        req.params.id,
        a.department.trim(),
        awc,
        Math.round(awc * wageRate * 100) / 100,
        Math.round(awc * commRate * 100) / 100
      );
    }
  });

  doUpdate();

  dwAudit(db, 'entry', Number(req.params.id), 'update', entry, {
    entry_date: row.entry_date, total_worker_count: wc,
    status: newStatus
  }, user);

  const updated = db.prepare('SELECT * FROM dw_entries WHERE id = ?').get(req.params.id);
  const allocations = db.prepare('SELECT * FROM dw_department_allocations WHERE entry_id = ?').all(req.params.id);
  res.json({ success: true, data: { ...updated, department_allocations: allocations } });
});

// ═══════════════════════════════════════════════════════════════
//  HR SUBMIT WORKFLOW
// ═══════════════════════════════════════════════════════════════

// PUT /entries/:id/submit — HR submits entry for finance review
router.put('/entries/:id/submit', requireHrOrAdmin, (req, res) => {
  const db = getDb();
  const user = req.user?.username || 'system';
  const entry = db.prepare('SELECT * FROM dw_entries WHERE id = ?').get(req.params.id);
  if (!entry) return res.status(404).json({ success: false, error: 'Entry not found' });
  if (entry.status !== 'hr_entered') {
    return res.status(400).json({ success: false, error: `Cannot submit entry with status "${entry.status}". Only hr_entered entries can be submitted.` });
  }

  db.prepare("UPDATE dw_entries SET status = 'pending_finance', updated_at = datetime('now') WHERE id = ?").run(req.params.id);
  db.prepare("INSERT INTO dw_approvals (entry_id, action, remarks, acted_by) VALUES (?, 'submitted', ?, ?)").run(req.params.id, req.body.remarks || null, user);
  dwAudit(db, 'entry', Number(req.params.id), 'submit', { status: 'hr_entered' }, { status: 'pending_finance' }, user);
  res.json({ success: true, message: 'Entry submitted for finance review' });
});

// POST /entries/batch-submit — HR submits multiple entries
router.post('/entries/batch-submit', requireHrOrAdmin, (req, res) => {
  const db = getDb();
  const user = req.user?.username || 'system';
  const { entry_ids } = req.body;
  if (!Array.isArray(entry_ids) || entry_ids.length === 0) {
    return res.status(400).json({ success: false, error: 'entry_ids must be a non-empty array' });
  }

  // Validate all are hr_entered
  const placeholders = entry_ids.map(() => '?').join(',');
  const entries = db.prepare(`SELECT id, status FROM dw_entries WHERE id IN (${placeholders})`).all(...entry_ids);
  if (entries.length !== entry_ids.length) {
    return res.status(400).json({ success: false, error: `Found ${entries.length} of ${entry_ids.length} entries` });
  }
  const invalid = entries.filter(e => e.status !== 'hr_entered');
  if (invalid.length > 0) {
    return res.status(400).json({ success: false, error: `${invalid.length} entries are not in hr_entered status`, invalid_ids: invalid.map(e => e.id) });
  }

  const doBatchSubmit = db.transaction(() => {
    const updStmt = db.prepare("UPDATE dw_entries SET status = 'pending_finance', updated_at = datetime('now') WHERE id = ?");
    const appStmt = db.prepare("INSERT INTO dw_approvals (entry_id, action, remarks, acted_by) VALUES (?, 'submitted', ?, ?)");
    for (const id of entry_ids) {
      updStmt.run(id);
      appStmt.run(id, req.body.remarks || null, user);
      dwAudit(db, 'entry', id, 'submit', { status: 'hr_entered' }, { status: 'pending_finance' }, user);
    }
  });
  doBatchSubmit();
  res.json({ success: true, submitted: entry_ids.length });
});

// ═══════════════════════════════════════════════════════════════
//  FINANCE APPROVAL WORKFLOW
// ═══════════════════════════════════════════════════════════════

// GET /finance/pending — Entries pending finance review with contractor context
router.get('/finance/pending', (req, res) => {
  const db = getDb();
  const entries = db.prepare(`
    SELECT e.*, c.contractor_name, c.phone_number as contractor_phone
    FROM dw_entries e
    JOIN dw_contractors c ON c.id = e.contractor_id
    WHERE e.status = 'pending_finance'
    ORDER BY e.entry_date DESC, e.id DESC
  `).all();

  // Fetch allocations + contractor context for each entry
  const allocStmt = db.prepare('SELECT * FROM dw_department_allocations WHERE entry_id = ? ORDER BY department');
  const ctxStmt = db.prepare(`
    SELECT
      COUNT(*) as entries_this_month,
      SUM(total_worker_count) as workers_this_month,
      SUM(total_liability) as spend_this_month,
      AVG(wage_rate_applied) as avg_rate
    FROM dw_entries
    WHERE contractor_id = ? AND entry_date LIKE ? AND status IN ('approved','paid')
  `);

  for (const entry of entries) {
    entry.department_allocations = allocStmt.all(entry.id);
    const monthPrefix = entry.entry_date.slice(0, 7); // YYYY-MM
    entry.contractor_context = ctxStmt.get(entry.contractor_id, monthPrefix + '%') || {
      entries_this_month: 0, workers_this_month: 0, spend_this_month: 0, avg_rate: 0
    };
  }

  res.json({ success: true, data: entries, count: entries.length });
});

// PUT /entries/:id/approve — Finance approves entry
router.put('/entries/:id/approve', requireFinanceOrAdmin, (req, res) => {
  const db = getDb();
  const user = req.user?.username || 'system';
  const entry = db.prepare('SELECT * FROM dw_entries WHERE id = ?').get(req.params.id);
  if (!entry) return res.status(404).json({ success: false, error: 'Entry not found' });
  if (entry.status !== 'pending_finance') {
    return res.status(400).json({ success: false, error: `Cannot approve entry with status "${entry.status}". Must be pending_finance.` });
  }

  db.prepare("UPDATE dw_entries SET status = 'approved', updated_at = datetime('now') WHERE id = ?").run(req.params.id);
  db.prepare("INSERT INTO dw_approvals (entry_id, action, remarks, acted_by) VALUES (?, 'approved', ?, ?)").run(req.params.id, req.body.remarks || null, user);
  dwAudit(db, 'entry', Number(req.params.id), 'approve', { status: 'pending_finance' }, { status: 'approved' }, user);
  res.json({ success: true, message: 'Entry approved' });
});

// PUT /entries/:id/reject — Finance rejects entry (returns to HR)
router.put('/entries/:id/reject', requireFinanceOrAdmin, (req, res) => {
  const db = getDb();
  const user = req.user?.username || 'system';
  const { remarks } = req.body;
  if (!remarks || !remarks.trim()) return res.status(400).json({ success: false, error: 'remarks are required for rejection' });

  const entry = db.prepare('SELECT * FROM dw_entries WHERE id = ?').get(req.params.id);
  if (!entry) return res.status(404).json({ success: false, error: 'Entry not found' });
  if (entry.status !== 'pending_finance') {
    return res.status(400).json({ success: false, error: `Cannot reject entry with status "${entry.status}". Must be pending_finance.` });
  }

  db.prepare("UPDATE dw_entries SET status = 'rejected', updated_at = datetime('now') WHERE id = ?").run(req.params.id);
  db.prepare("INSERT INTO dw_approvals (entry_id, action, remarks, acted_by) VALUES (?, 'rejected', ?, ?)").run(req.params.id, remarks.trim(), user);
  dwAudit(db, 'entry', Number(req.params.id), 'reject', { status: 'pending_finance' }, { status: 'rejected', remarks: remarks.trim() }, user);
  res.json({ success: true, message: 'Entry rejected (terminal). HR must create a fresh entry to resubmit.' });
});

// PUT /entries/:id/needs-correction — Finance marks entry for correction
router.put('/entries/:id/needs-correction', requireFinanceOrAdmin, (req, res) => {
  const db = getDb();
  const user = req.user?.username || 'system';
  const { remarks } = req.body;
  if (!remarks || !remarks.trim()) return res.status(400).json({ success: false, error: 'remarks are required' });

  const entry = db.prepare('SELECT * FROM dw_entries WHERE id = ?').get(req.params.id);
  if (!entry) return res.status(404).json({ success: false, error: 'Entry not found' });
  if (entry.status !== 'pending_finance') {
    return res.status(400).json({ success: false, error: `Cannot mark needs-correction for status "${entry.status}". Must be pending_finance.` });
  }

  db.prepare("UPDATE dw_entries SET status = 'needs_correction', updated_at = datetime('now') WHERE id = ?").run(req.params.id);
  db.prepare("INSERT INTO dw_approvals (entry_id, action, remarks, acted_by) VALUES (?, 'needs_correction', ?, ?)").run(req.params.id, remarks.trim(), user);
  dwAudit(db, 'entry', Number(req.params.id), 'needs_correction', { status: 'pending_finance' }, { status: 'needs_correction', remarks: remarks.trim() }, user);
  res.json({ success: true, message: 'Entry marked for correction' });
});

// PUT /entries/:id/flag — Finance flags entry
router.put('/entries/:id/flag', requireFinanceOrAdmin, (req, res) => {
  const db = getDb();
  const user = req.user?.username || 'system';
  const { remarks } = req.body;
  if (!remarks || !remarks.trim()) return res.status(400).json({ success: false, error: 'remarks are required for flagging' });

  const entry = db.prepare('SELECT * FROM dw_entries WHERE id = ?').get(req.params.id);
  if (!entry) return res.status(404).json({ success: false, error: 'Entry not found' });
  if (entry.status !== 'pending_finance') {
    return res.status(400).json({ success: false, error: `Cannot flag entry with status "${entry.status}". Must be pending_finance.` });
  }

  db.prepare("UPDATE dw_entries SET status = 'flagged', updated_at = datetime('now') WHERE id = ?").run(req.params.id);
  db.prepare("INSERT INTO dw_approvals (entry_id, action, remarks, acted_by) VALUES (?, 'flagged', ?, ?)").run(req.params.id, remarks.trim(), user);
  dwAudit(db, 'entry', Number(req.params.id), 'flag', { status: 'pending_finance' }, { status: 'flagged', remarks: remarks.trim() }, user);
  res.json({ success: true, message: 'Entry flagged' });
});

// PUT /entries/:id/reopen — Finance reopens an approved entry
router.put('/entries/:id/reopen', requireFinanceOrAdmin, (req, res) => {
  const db = getDb();
  const user = req.user?.username || 'system';
  const { remarks } = req.body;
  if (!remarks || !remarks.trim()) return res.status(400).json({ success: false, error: 'remarks are required for reopening' });

  const entry = db.prepare('SELECT * FROM dw_entries WHERE id = ?').get(req.params.id);
  if (!entry) return res.status(404).json({ success: false, error: 'Entry not found' });
  if (entry.status !== 'approved') {
    return res.status(400).json({ success: false, error: `Cannot reopen entry with status "${entry.status}". Must be approved.` });
  }

  db.prepare("UPDATE dw_entries SET status = 'pending_finance', updated_at = datetime('now') WHERE id = ?").run(req.params.id);
  db.prepare("INSERT INTO dw_approvals (entry_id, action, remarks, acted_by) VALUES (?, 'reopened', ?, ?)").run(req.params.id, remarks.trim(), user);
  dwAudit(db, 'entry', Number(req.params.id), 'reopen', { status: 'approved' }, { status: 'pending_finance', remarks: remarks.trim() }, user);
  res.json({ success: true, message: 'Entry reopened for review' });
});

// POST /entries/batch-approve — Finance bulk-approves entries
router.post('/entries/batch-approve', requireFinanceOrAdmin, (req, res) => {
  const db = getDb();
  const user = req.user?.username || 'system';
  const { entry_ids, remarks } = req.body;
  if (!Array.isArray(entry_ids) || entry_ids.length === 0) {
    return res.status(400).json({ success: false, error: 'entry_ids must be a non-empty array' });
  }

  const placeholders = entry_ids.map(() => '?').join(',');
  const entries = db.prepare(`SELECT id, status FROM dw_entries WHERE id IN (${placeholders})`).all(...entry_ids);
  if (entries.length !== entry_ids.length) {
    return res.status(400).json({ success: false, error: `Found ${entries.length} of ${entry_ids.length} entries` });
  }
  const invalid = entries.filter(e => e.status !== 'pending_finance');
  if (invalid.length > 0) {
    return res.status(400).json({ success: false, error: `${invalid.length} entries are not in pending_finance status`, invalid_ids: invalid.map(e => e.id) });
  }

  const doBatch = db.transaction(() => {
    const updStmt = db.prepare("UPDATE dw_entries SET status = 'approved', updated_at = datetime('now') WHERE id = ?");
    const appStmt = db.prepare("INSERT INTO dw_approvals (entry_id, action, remarks, acted_by) VALUES (?, 'approved', ?, ?)");
    for (const id of entry_ids) {
      updStmt.run(id);
      appStmt.run(id, remarks || null, user);
      dwAudit(db, 'entry', id, 'approve', { status: 'pending_finance' }, { status: 'approved' }, user);
    }
  });
  doBatch();
  res.json({ success: true, approved: entry_ids.length });
});

// ═══════════════════════════════════════════════════════════════
//  PAYMENT PROCESSING
// ═══════════════════════════════════════════════════════════════

// GET /payments/pending-liability — Aggregated pending liabilities per contractor
router.get('/payments/pending-liability', (req, res) => {
  const db = getDb();
  const data = db.prepare(`
    SELECT c.id as contractor_id, c.contractor_name, c.payment_terms,
      COUNT(e.id) as entry_count,
      SUM(e.total_wage_amount) as total_wages,
      SUM(e.total_commission_amount) as total_commission,
      SUM(e.total_liability) as total_liability,
      MIN(e.entry_date) as oldest_entry_date
    FROM dw_entries e
    JOIN dw_contractors c ON e.contractor_id = c.id
    WHERE e.status = 'approved'
    GROUP BY c.id
    ORDER BY total_liability DESC
  `).all();

  // Round amounts
  for (const row of data) {
    row.total_wages = Math.round((row.total_wages || 0) * 100) / 100;
    row.total_commission = Math.round((row.total_commission || 0) * 100) / 100;
    row.total_liability = Math.round((row.total_liability || 0) * 100) / 100;
  }

  res.json({ success: true, data });
});

// POST /payments — Process a payment
router.post('/payments', requireFinanceOrAdmin, (req, res) => {
  const db = getDb();
  const user = req.user?.username || 'system';
  const { contractor_id, entry_ids, payment_reference, payment_date, payment_method, remarks } = req.body;

  if (!contractor_id) return res.status(400).json({ success: false, error: 'contractor_id is required' });
  if (!Array.isArray(entry_ids) || entry_ids.length === 0) {
    return res.status(400).json({ success: false, error: 'entry_ids must be a non-empty array' });
  }
  if (!payment_reference || !payment_reference.trim()) {
    return res.status(400).json({ success: false, error: 'payment_reference is required' });
  }
  if (!payment_date) return res.status(400).json({ success: false, error: 'payment_date is required' });

  // Check payment_reference uniqueness
  const existingRef = db.prepare('SELECT id FROM dw_payments WHERE payment_reference = ?').get(payment_reference.trim());
  if (existingRef) return res.status(409).json({ success: false, error: 'payment_reference already exists' });

  // Validate all entries belong to this contractor and are approved
  const placeholders = entry_ids.map(() => '?').join(',');
  const entries = db.prepare(`SELECT id, contractor_id, status, total_liability FROM dw_entries WHERE id IN (${placeholders})`).all(...entry_ids);
  if (entries.length !== entry_ids.length) {
    return res.status(400).json({ success: false, error: `Found ${entries.length} of ${entry_ids.length} entries` });
  }
  const wrongContractor = entries.filter(e => e.contractor_id !== Number(contractor_id));
  if (wrongContractor.length > 0) {
    return res.status(400).json({ success: false, error: `${wrongContractor.length} entries do not belong to contractor ${contractor_id}` });
  }
  const notApproved = entries.filter(e => e.status !== 'approved');
  if (notApproved.length > 0) {
    return res.status(400).json({ success: false, error: `${notApproved.length} entries are not in approved status`, invalid_ids: notApproved.map(e => e.id) });
  }

  const totalAmount = Math.round(entries.reduce((sum, e) => sum + (e.total_liability || 0), 0) * 100) / 100;

  const doPayment = db.transaction(() => {
    const payResult = db.prepare(`
      INSERT INTO dw_payments (contractor_id, payment_reference, payment_date, total_amount, payment_method, remarks, processed_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(contractor_id, payment_reference.trim(), payment_date, totalAmount, payment_method || null, remarks || null, user);
    const paymentId = payResult.lastInsertRowid;

    const linkStmt = db.prepare('INSERT INTO dw_payment_entries (payment_id, entry_id) VALUES (?, ?)');
    const updStmt = db.prepare("UPDATE dw_entries SET status = 'paid', updated_at = datetime('now') WHERE id = ?");
    for (const id of entry_ids) {
      linkStmt.run(paymentId, id);
      updStmt.run(id);
    }

    dwAudit(db, 'payment', paymentId, 'create', null, {
      contractor_id, entry_ids, payment_reference: payment_reference.trim(),
      total_amount: totalAmount
    }, user);

    return paymentId;
  });

  const paymentId = doPayment();
  const payment = db.prepare('SELECT * FROM dw_payments WHERE id = ?').get(paymentId);
  res.json({ success: true, data: payment });
});

// GET /payments — List payments
router.get('/payments', (req, res) => {
  const db = getDb();
  let where = 'WHERE 1=1';
  const params = [];

  if (req.query.contractor_id) {
    where += ' AND p.contractor_id = ?';
    params.push(Number(req.query.contractor_id));
  }
  if (req.query.date_from) {
    where += ' AND p.payment_date >= ?';
    params.push(req.query.date_from);
  }
  if (req.query.date_to) {
    where += ' AND p.payment_date <= ?';
    params.push(req.query.date_to);
  }

  const data = db.prepare(`
    SELECT p.*, c.contractor_name
    FROM dw_payments p
    JOIN dw_contractors c ON c.id = p.contractor_id
    ${where}
    ORDER BY p.payment_date DESC, p.id DESC
  `).all(...params);

  res.json({ success: true, data });
});

// GET /payments/:id — Payment detail with linked entries
router.get('/payments/:id', (req, res) => {
  const db = getDb();
  const payment = db.prepare(`
    SELECT p.*, c.contractor_name, c.phone_number as contractor_phone
    FROM dw_payments p
    JOIN dw_contractors c ON c.id = p.contractor_id
    WHERE p.id = ?
  `).get(req.params.id);
  if (!payment) return res.status(404).json({ success: false, error: 'Payment not found' });

  const entries = db.prepare(`
    SELECT e.* FROM dw_entries e
    JOIN dw_payment_entries pe ON pe.entry_id = e.id
    WHERE pe.payment_id = ?
    ORDER BY e.entry_date
  `).all(req.params.id);

  res.json({ success: true, data: { ...payment, entries } });
});

// GET /contractors/:id/payment-history — Payment history for a contractor
router.get('/contractors/:id/payment-history', (req, res) => {
  const db = getDb();
  const contractor = db.prepare('SELECT id, contractor_name FROM dw_contractors WHERE id = ?').get(req.params.id);
  if (!contractor) return res.status(404).json({ success: false, error: 'Contractor not found' });

  const payments = db.prepare(`
    SELECT p.*, (SELECT COUNT(*) FROM dw_payment_entries pe WHERE pe.payment_id = p.id) as entry_count
    FROM dw_payments p
    WHERE p.contractor_id = ?
    ORDER BY p.payment_date DESC
  `).all(req.params.id);

  const totalPaid = payments.reduce((sum, p) => sum + (p.total_amount || 0), 0);

  res.json({
    success: true,
    data: {
      contractor_name: contractor.contractor_name,
      payments,
      total_paid: Math.round(totalPaid * 100) / 100,
      payment_count: payments.length
    }
  });
});

// ═══════════════════════════════════════════════════════════════
//  AUDIT LOG & DASHBOARD
// ═══════════════════════════════════════════════════════════════

// GET /audit-log — Paginated, filterable audit log
router.get('/audit-log', (req, res) => {
  const db = getDb();
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
  const offset = (page - 1) * limit;

  let where = 'WHERE 1=1';
  const params = [];
  if (req.query.entity_type) { where += ' AND entity_type = ?'; params.push(req.query.entity_type); }
  if (req.query.date_from) { where += ' AND performed_at >= ?'; params.push(req.query.date_from); }
  if (req.query.date_to) { where += " AND performed_at <= ? || ' 23:59:59'"; params.push(req.query.date_to); }
  if (req.query.performed_by) { where += ' AND performed_by = ?'; params.push(req.query.performed_by); }

  const countRow = db.prepare(`SELECT COUNT(*) as total FROM dw_audit_log ${where}`).get(...params);
  const data = db.prepare(`SELECT * FROM dw_audit_log ${where} ORDER BY performed_at DESC LIMIT ? OFFSET ?`).all(...params, limit, offset);

  res.json({
    success: true,
    data,
    pagination: { page, pageSize: limit, total: countRow.total, totalPages: Math.ceil(countRow.total / limit) }
  });
});

// GET /dashboard — Aggregate stats for DW module
router.get('/dashboard', (req, res) => {
  const db = getDb();

  const pendingLiability = db.prepare(
    "SELECT COALESCE(SUM(total_liability), 0) as total FROM dw_entries WHERE status = 'approved'"
  ).get();
  const pendingReview = db.prepare(
    "SELECT COUNT(*) as count FROM dw_entries WHERE status = 'pending_finance'"
  ).get();
  const rateChangesPending = db.prepare(
    "SELECT COUNT(*) as count FROM dw_rate_history WHERE approval_status = 'pending'"
  ).get();
  const flaggedEntries = db.prepare(
    "SELECT COUNT(*) as count FROM dw_entries WHERE status = 'flagged'"
  ).get();
  const recentActivity = db.prepare(
    'SELECT * FROM dw_audit_log ORDER BY performed_at DESC LIMIT 10'
  ).all();

  res.json({
    success: true,
    data: {
      pending_liability_total: Math.round((pendingLiability.total || 0) * 100) / 100,
      entries_pending_review: pendingReview.count,
      rate_changes_pending: rateChangesPending.count,
      flagged_entries: flaggedEntries.count,
      recent_activity: recentActivity
    }
  });
});

// ═══════════════════════════════════════════════════════════════
//  REPORTS
// ═══════════════════════════════════════════════════════════════

// GET /reports/daily-mis — Per-contractor summary for a single date
router.get('/reports/daily-mis', (req, res) => {
  const db = getDb();
  const { date } = req.query;
  if (!date) return res.status(400).json({ success: false, error: 'date query param is required' });

  const contractors = db.prepare(`
    SELECT c.id as contractor_id, c.contractor_name,
      SUM(e.total_worker_count) as workers,
      SUM(e.total_wage_amount) as wages,
      SUM(e.total_commission_amount) as commission,
      SUM(e.total_liability) as liability
    FROM dw_entries e
    JOIN dw_contractors c ON e.contractor_id = c.id
    WHERE e.entry_date = ? AND e.status IN ('approved','paid')
    GROUP BY c.id
    ORDER BY c.contractor_name
  `).all(date);

  const department_totals = db.prepare(`
    SELECT da.department,
      SUM(da.worker_count) as workers,
      SUM(da.allocated_wage_amount) as wages,
      SUM(da.allocated_commission_amount) as commission,
      SUM(da.allocated_wage_amount + da.allocated_commission_amount) as total
    FROM dw_department_allocations da
    JOIN dw_entries e ON da.entry_id = e.id
    WHERE e.entry_date = ? AND e.status IN ('approved','paid')
    GROUP BY da.department
    ORDER BY total DESC
  `).all(date);

  const grand_total = {
    workers: contractors.reduce((s, c) => s + (c.workers || 0), 0),
    wages: Math.round(contractors.reduce((s, c) => s + (c.wages || 0), 0) * 100) / 100,
    commission: Math.round(contractors.reduce((s, c) => s + (c.commission || 0), 0) * 100) / 100,
    liability: Math.round(contractors.reduce((s, c) => s + (c.liability || 0), 0) * 100) / 100
  };

  res.json({ success: true, data: { date, contractors, department_totals, grand_total } });
});

// GET /reports/monthly — Monthly rollup grouped by contractor
router.get('/reports/monthly', (req, res) => {
  const db = getDb();
  const { month, year, company } = req.query;
  if (!month || !year) return res.status(400).json({ success: false, error: 'month and year query params are required' });
  const monthPrefix = `${year}-${String(month).padStart(2, '0')}`;

  const companyFilter = company ? ' AND e.company = ?' : '';
  const companyParams = company ? [company] : [];

  const contractors = db.prepare(`
    SELECT c.id as contractor_id, c.contractor_name,
      COUNT(DISTINCT e.entry_date) as total_days_worked,
      SUM(e.total_worker_count) as total_worker_days,
      AVG(e.wage_rate_applied) as avg_rate,
      SUM(e.total_wage_amount) as total_wages,
      SUM(e.total_commission_amount) as total_commission,
      SUM(e.total_liability) as total_liability
    FROM dw_entries e
    JOIN dw_contractors c ON e.contractor_id = c.id
    WHERE e.entry_date LIKE ? AND e.status IN ('approved','paid')${companyFilter}
    GROUP BY c.id
    ORDER BY total_liability DESC
  `).all(monthPrefix + '%', ...companyParams);

  // Enrich each contractor with department breakdown and payment status
  const deptStmt = db.prepare(`
    SELECT da.department, SUM(da.worker_count) as workers
    FROM dw_department_allocations da
    JOIN dw_entries e ON da.entry_id = e.id
    WHERE e.contractor_id = ? AND e.entry_date LIKE ? AND e.status IN ('approved','paid')${companyFilter}
    GROUP BY da.department ORDER BY workers DESC
  `);
  const paidStmt = db.prepare(`
    SELECT COALESCE(SUM(e.total_liability), 0) as paid
    FROM dw_entries e
    WHERE e.contractor_id = ? AND e.entry_date LIKE ? AND e.status = 'paid'${companyFilter}
  `);

  for (const c of contractors) {
    c.avg_rate = Math.round((c.avg_rate || 0) * 100) / 100;
    c.total_wages = Math.round((c.total_wages || 0) * 100) / 100;
    c.total_commission = Math.round((c.total_commission || 0) * 100) / 100;
    c.total_liability = Math.round((c.total_liability || 0) * 100) / 100;
    c.department_breakdown = deptStmt.all(c.contractor_id, monthPrefix + '%', ...companyParams);
    const paid = paidStmt.get(c.contractor_id, monthPrefix + '%', ...companyParams);
    c.payment_status = {
      paid: Math.round((paid.paid || 0) * 100) / 100,
      outstanding: Math.round((c.total_liability - (paid.paid || 0)) * 100) / 100
    };
  }

  const grand_totals = {
    total_days_worked: contractors.reduce((s, c) => s + (c.total_days_worked || 0), 0),
    total_worker_days: contractors.reduce((s, c) => s + (c.total_worker_days || 0), 0),
    total_wages: Math.round(contractors.reduce((s, c) => s + (c.total_wages || 0), 0) * 100) / 100,
    total_commission: Math.round(contractors.reduce((s, c) => s + (c.total_commission || 0), 0) * 100) / 100,
    total_liability: Math.round(contractors.reduce((s, c) => s + (c.total_liability || 0), 0) * 100) / 100,
    total_paid: Math.round(contractors.reduce((s, c) => s + (c.payment_status.paid || 0), 0) * 100) / 100,
    total_outstanding: Math.round(contractors.reduce((s, c) => s + (c.payment_status.outstanding || 0), 0) * 100) / 100
  };

  res.json({ success: true, data: { month: Number(month), year: Number(year), contractors, grand_totals } });
});

// GET /reports/department-cost — Department-wise cost breakdown
router.get('/reports/department-cost', (req, res) => {
  const db = getDb();
  const { month, year, company } = req.query;
  if (!month || !year) return res.status(400).json({ success: false, error: 'month and year query params are required' });
  const monthPrefix = `${year}-${String(month).padStart(2, '0')}`;

  const companyFilter = company ? ' AND e.company = ?' : '';
  const companyParams = company ? [company] : [];

  const departments = db.prepare(`
    SELECT da.department,
      SUM(da.worker_count) as worker_days,
      SUM(da.allocated_wage_amount) as wage_cost,
      SUM(da.allocated_commission_amount) as commission_cost,
      SUM(da.allocated_wage_amount + da.allocated_commission_amount) as total_cost
    FROM dw_department_allocations da
    JOIN dw_entries e ON da.entry_id = e.id
    WHERE e.entry_date LIKE ? AND e.status IN ('approved','paid')${companyFilter}
    GROUP BY da.department ORDER BY total_cost DESC
  `).all(monthPrefix + '%', ...companyParams);

  for (const d of departments) {
    d.wage_cost = Math.round((d.wage_cost || 0) * 100) / 100;
    d.commission_cost = Math.round((d.commission_cost || 0) * 100) / 100;
    d.total_cost = Math.round((d.total_cost || 0) * 100) / 100;
  }

  const grand_total = {
    worker_days: departments.reduce((s, d) => s + (d.worker_days || 0), 0),
    wage_cost: Math.round(departments.reduce((s, d) => s + (d.wage_cost || 0), 0) * 100) / 100,
    commission_cost: Math.round(departments.reduce((s, d) => s + (d.commission_cost || 0), 0) * 100) / 100,
    total_cost: Math.round(departments.reduce((s, d) => s + (d.total_cost || 0), 0) * 100) / 100
  };

  res.json({ success: true, data: { month: Number(month), year: Number(year), departments, grand_total } });
});

// GET /reports/contractor-summary/:id — Contractor snapshot with trends
router.get('/reports/contractor-summary/:id', (req, res) => {
  const db = getDb();
  const contractor = db.prepare('SELECT * FROM dw_contractors WHERE id = ?').get(req.params.id);
  if (!contractor) return res.status(404).json({ success: false, error: 'Contractor not found' });

  const rateHistory = db.prepare(
    'SELECT * FROM dw_rate_history WHERE contractor_id = ? ORDER BY effective_date DESC LIMIT 10'
  ).all(req.params.id);

  // Current month stats
  const now = new Date();
  const curPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const thisMonth = db.prepare(`
    SELECT COALESCE(SUM(total_worker_count), 0) as worker_days,
           COALESCE(SUM(total_liability), 0) as total_spend
    FROM dw_entries WHERE contractor_id = ? AND entry_date LIKE ? AND status IN ('approved','paid')
  `).get(req.params.id, curPrefix + '%');

  // Last 6 months trend
  const trend = [];
  for (let i = 0; i < 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const prefix = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const row = db.prepare(`
      SELECT COALESCE(SUM(total_worker_count), 0) as worker_days,
             COALESCE(SUM(total_liability), 0) as total_spend
      FROM dw_entries WHERE contractor_id = ? AND entry_date LIKE ? AND status IN ('approved','paid')
    `).get(req.params.id, prefix + '%');
    trend.push({
      month: d.getMonth() + 1, year: d.getFullYear(),
      worker_days: row.worker_days,
      total_spend: Math.round((row.total_spend || 0) * 100) / 100
    });
  }

  // Payment summary
  const paymentSummary = db.prepare(`
    SELECT COUNT(*) as payment_count, COALESCE(SUM(total_amount), 0) as total_paid
    FROM dw_payments WHERE contractor_id = ?
  `).get(req.params.id);

  res.json({
    success: true,
    data: {
      contractor,
      rate_history: rateHistory,
      this_month: { worker_days: thisMonth.worker_days, total_spend: Math.round((thisMonth.total_spend || 0) * 100) / 100 },
      trend,
      payment_summary: {
        payment_count: paymentSummary.payment_count,
        total_paid: Math.round((paymentSummary.total_paid || 0) * 100) / 100
      }
    }
  });
});

// GET /reports/payment-sheet/:contractorId — Printable payment sheet
router.get('/reports/payment-sheet/:contractorId', (req, res) => {
  const db = getDb();
  const contractor = db.prepare('SELECT * FROM dw_contractors WHERE id = ?').get(req.params.contractorId);
  if (!contractor) return res.status(404).json({ success: false, error: 'Contractor not found' });

  const { entry_ids } = req.query;
  if (!entry_ids) return res.status(400).json({ success: false, error: 'entry_ids query param is required (comma-separated)' });

  const ids = String(entry_ids).split(',').map(s => Number(s.trim())).filter(n => n > 0);
  if (ids.length === 0) return res.status(400).json({ success: false, error: 'No valid entry IDs provided' });

  const placeholders = ids.map(() => '?').join(',');
  const entries = db.prepare(`
    SELECT e.* FROM dw_entries e
    WHERE e.id IN (${placeholders}) AND e.contractor_id = ? AND e.status IN ('approved','paid')
    ORDER BY e.entry_date, e.in_time
  `).all(...ids, req.params.contractorId);

  // Fetch allocations for each entry
  const allocStmt = db.prepare('SELECT * FROM dw_department_allocations WHERE entry_id = ? ORDER BY department');
  for (const e of entries) {
    e.department_allocations = allocStmt.all(e.id);
  }

  const totals = {
    total_workers: entries.reduce((s, e) => s + (e.total_worker_count || 0), 0),
    total_wages: Math.round(entries.reduce((s, e) => s + (e.total_wage_amount || 0), 0) * 100) / 100,
    total_commission: Math.round(entries.reduce((s, e) => s + (e.total_commission_amount || 0), 0) * 100) / 100,
    total_liability: Math.round(entries.reduce((s, e) => s + (e.total_liability || 0), 0) * 100) / 100,
    entry_count: entries.length
  };

  res.json({ success: true, data: { contractor, entries, totals } });
});

// GET /reports/pending-liabilities — Like /payments/pending-liability but with department breakdown
router.get('/reports/pending-liabilities', (req, res) => {
  const db = getDb();
  const contractors = db.prepare(`
    SELECT c.id as contractor_id, c.contractor_name, c.payment_terms,
      COUNT(e.id) as entry_count,
      SUM(e.total_wage_amount) as total_wages,
      SUM(e.total_commission_amount) as total_commission,
      SUM(e.total_liability) as total_liability,
      MIN(e.entry_date) as oldest_entry_date
    FROM dw_entries e
    JOIN dw_contractors c ON e.contractor_id = c.id
    WHERE e.status = 'approved'
    GROUP BY c.id
    ORDER BY total_liability DESC
  `).all();

  const deptStmt = db.prepare(`
    SELECT da.department, SUM(da.worker_count) as workers,
      SUM(da.allocated_wage_amount + da.allocated_commission_amount) as cost
    FROM dw_department_allocations da
    JOIN dw_entries e ON da.entry_id = e.id
    WHERE e.contractor_id = ? AND e.status = 'approved'
    GROUP BY da.department ORDER BY cost DESC
  `);

  for (const c of contractors) {
    c.total_wages = Math.round((c.total_wages || 0) * 100) / 100;
    c.total_commission = Math.round((c.total_commission || 0) * 100) / 100;
    c.total_liability = Math.round((c.total_liability || 0) * 100) / 100;
    c.department_breakdown = deptStmt.all(c.contractor_id);
  }

  const grand_total = {
    entry_count: contractors.reduce((s, c) => s + (c.entry_count || 0), 0),
    total_liability: Math.round(contractors.reduce((s, c) => s + (c.total_liability || 0), 0) * 100) / 100
  };

  res.json({ success: true, data: { contractors, grand_total } });
});

// GET /reports/seasonal-trends — Last 12 months of monthly totals
router.get('/reports/seasonal-trends', (req, res) => {
  const db = getDb();
  const months = [];
  const now = new Date();

  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const prefix = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const row = db.prepare(`
      SELECT
        COALESCE(SUM(total_worker_count), 0) as worker_days,
        COALESCE(SUM(total_wage_amount), 0) as total_wages,
        COALESCE(SUM(total_commission_amount), 0) as total_commission,
        COALESCE(SUM(total_liability), 0) as total_liability,
        COUNT(DISTINCT contractor_id) as contractor_count
      FROM dw_entries
      WHERE entry_date LIKE ? AND status IN ('approved','paid')
    `).get(prefix + '%');
    months.push({
      month: d.getMonth() + 1,
      year: d.getFullYear(),
      worker_days: row.worker_days,
      total_wages: Math.round((row.total_wages || 0) * 100) / 100,
      total_commission: Math.round((row.total_commission || 0) * 100) / 100,
      total_liability: Math.round((row.total_liability || 0) * 100) / 100,
      contractor_count: row.contractor_count
    });
  }

  res.json({ success: true, data: months });
});

// GET /audit — DW audit log (legacy — kept for backward compat)
router.get('/audit', (req, res) => {
  const db = getDb();
  const { entity_type, entity_id, limit: lim } = req.query;
  let query = 'SELECT * FROM dw_audit_log WHERE 1=1';
  const params = [];
  if (entity_type) { query += ' AND entity_type = ?'; params.push(entity_type); }
  if (entity_id) { query += ' AND entity_id = ?'; params.push(Number(entity_id)); }
  query += ' ORDER BY performed_at DESC';
  query += ` LIMIT ${Math.min(Number(lim) || 100, 500)}`;
  const data = db.prepare(query).all(...params);
  res.json({ success: true, data });
});

module.exports = router;
