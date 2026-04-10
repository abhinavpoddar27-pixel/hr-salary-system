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
