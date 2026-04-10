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

  // 10. duplicate check
  if (row.entry_date && row.in_time && row.out_time && row._contractor) {
    const dup = db.prepare(`
      SELECT id, entry_date, in_time, out_time FROM dw_entries
      WHERE contractor_id = ? AND entry_date = ?
        AND NOT (out_time <= ? OR in_time >= ?)
    `).get(row._contractor.id, row.entry_date, row.in_time, row.out_time);
    if (dup) {
      errors.push({ row: rowIndex, field: 'duplicate', error: `${prefix}Duplicate entry detected`, duplicate: dup });
    }
  }

  return errors;
}

// ── Insert a single entry + allocations (called inside a transaction) ──
function insertEntry(db, row, user) {
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
      gate_entry_reference, notes, status, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'hr_entered', ?)
  `).run(
    c.id, row.entry_date, row.in_time, row.out_time,
    wc, wageRate, commRate,
    totalWage, totalComm, totalLiability,
    String(row.gate_entry_reference).trim(), row.notes || null,
    user
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
  const { contractor_id, entry_date, in_time, out_time } = req.body;
  if (!contractor_id || !entry_date || !in_time || !out_time) {
    return res.status(400).json({ success: false, error: 'contractor_id, entry_date, in_time, out_time are required' });
  }
  const duplicates = db.prepare(`
    SELECT e.id, e.entry_date, e.in_time, e.out_time, e.total_worker_count, e.status, c.contractor_name
    FROM dw_entries e
    JOIN dw_contractors c ON c.id = e.contractor_id
    WHERE e.contractor_id = ? AND e.entry_date = ?
      AND NOT (e.out_time <= ? OR e.in_time >= ?)
    ORDER BY e.in_time
  `).all(contractor_id, entry_date, in_time, out_time);
  res.json({ success: true, duplicates });
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
      const entryId = insertEntry(db, row, user);
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
    const entryId = insertEntry(db, row, user);
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
      SUM(CASE WHEN status = 'flagged' THEN 1 ELSE 0 END) as flagged
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

// GET /audit — DW audit log (filterable)
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
