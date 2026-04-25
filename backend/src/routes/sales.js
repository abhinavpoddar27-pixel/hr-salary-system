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
const { requireHrOrAdmin, requirePermission } = require('../middleware/roles');
const {
  parseSalesCoordinatorFile,
  normalizeName,
  normalizeManager,
  normalizeCity,
} = require('../services/salesCoordinatorParser');
const taDa = require('../services/taDaChangeRequest');
const taDaCompute = require('../services/salesTaDaComputation');
const { deriveCycle: deriveCycleTopLevel } = require('../services/cycleUtil');

// ══════════════════════════════════════════════════════════════════════
// Phase 2 — TA/DA change-request workflow.
// Registered BEFORE router.use(requireHrOrAdmin) so finance can reach
// the approve/reject endpoints. Each route carries its own
// requirePermission(...) gate. HR endpoints require 'sales-tada-request',
// finance endpoints require 'sales-tada-approve'; admin inherits via '*'.
// ══════════════════════════════════════════════════════════════════════

function sendTaDaError(res, e, fallbackMsg) {
  const status = e?.statusCode || 500;
  const body = { success: false, error: e?.message || fallbackMsg || 'internal error' };
  if (e?.actualStatus) body.actual_status = e.actualStatus;
  if (status >= 500) console.error('[ta-da]', e?.stack || e);
  return res.status(status).json(body);
}

// GET /api/sales/ta-da-requests?status=&employee_code=
router.get('/ta-da-requests',
  requirePermission('sales-tada-approve', 'sales-tada-request'),
  (req, res) => {
    try {
      const rows = taDa.listRequests(getDb(), {
        status: req.query.status ? String(req.query.status) : null,
        employee_code: req.query.employee_code ? String(req.query.employee_code) : null,
      });
      res.json({ success: true, data: rows });
    } catch (e) { sendTaDaError(res, e, 'list failed'); }
  });

// GET /api/sales/ta-da-requests/pending-count — navbar badge source
router.get('/ta-da-requests/pending-count',
  requirePermission('sales-tada-approve', 'sales-tada-request'),
  (req, res) => {
    try {
      const count = taDa.countPending(getDb());
      res.json({ success: true, count });
    } catch (e) { sendTaDaError(res, e, 'count failed'); }
  });

// GET /api/sales/ta-da-requests/employee/:code
router.get('/ta-da-requests/employee/:code',
  requirePermission('sales-tada-approve', 'sales-tada-request'),
  (req, res) => {
    try {
      const rows = taDa.getRequestsByEmployee(getDb(), req.params.code);
      res.json({ success: true, data: rows });
    } catch (e) { sendTaDaError(res, e, 'history failed'); }
  });

// GET /api/sales/ta-da-requests/:id
router.get('/ta-da-requests/:id',
  requirePermission('sales-tada-approve', 'sales-tada-request'),
  (req, res) => {
    try {
      const row = taDa.getRequestById(getDb(), parseInt(req.params.id, 10));
      if (!row) return res.status(404).json({ success: false, error: 'request not found' });
      res.json({ success: true, data: row });
    } catch (e) { sendTaDaError(res, e, 'fetch failed'); }
  });

// POST /api/sales/ta-da-requests — HR creates
router.post('/ta-da-requests',
  requirePermission('sales-tada-request'),
  (req, res) => {
    try {
      const result = taDa.createRequest(getDb(), req.body || {}, req.user?.username);
      res.status(201).json({ success: true, data: result.request, supersededId: result.supersededId });
    } catch (e) { sendTaDaError(res, e, 'create failed'); }
  });

// POST /api/sales/ta-da-requests/:id/approve — Finance approves
router.post('/ta-da-requests/:id/approve',
  requirePermission('sales-tada-approve'),
  (req, res) => {
    try {
      const row = taDa.approveRequest(getDb(), parseInt(req.params.id, 10), req.user?.username);
      res.json({ success: true, data: row });
    } catch (e) { sendTaDaError(res, e, 'approve failed'); }
  });

// POST /api/sales/ta-da-requests/:id/reject — Finance rejects with required reason
router.post('/ta-da-requests/:id/reject',
  requirePermission('sales-tada-approve'),
  (req, res) => {
    try {
      const row = taDa.rejectRequest(getDb(), parseInt(req.params.id, 10), req.body || {}, req.user?.username);
      res.json({ success: true, data: row });
    } catch (e) { sendTaDaError(res, e, 'reject failed'); }
  });

// POST /api/sales/ta-da-requests/:id/cancel — HR cancels their own pending request
router.post('/ta-da-requests/:id/cancel',
  requirePermission('sales-tada-request'),
  (req, res) => {
    try {
      const row = taDa.cancelRequest(getDb(), parseInt(req.params.id, 10), req.user?.username);
      res.json({ success: true, data: row });
    } catch (e) { sendTaDaError(res, e, 'cancel failed'); }
  });

// ══════════════════════════════════════════════════════════════════════
// Phase 3 — TA/DA compute pipeline (compute / register / employee / inputs).
// Registered BEFORE router.use(requireHrOrAdmin). Each route carries its
// own requirePermission('sales-tada-compute') gate. HR + admin inherit
// via permissions.js; admin gets '*'.
//
// Mount: /api/sales/ta-da/* — hyphenated, matching the Phase 2 ta-da-requests
// convention.
// ══════════════════════════════════════════════════════════════════════

const TADA_COMP_STATUSES = new Set(['computed', 'partial', 'flag_for_review', 'paid']);
const TADA_INPUT_FIELDS = new Set([
  'in_city_days', 'outstation_days', 'total_km', 'bike_km', 'car_km', 'notes',
]);

function validateTaDaCycleParams(src) {
  const month = parseInt(src.month, 10);
  const year = parseInt(src.year, 10);
  const company = (src.company || '').toString().trim();
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    const err = new Error('month must be 1-12'); err.statusCode = 400; throw err;
  }
  if (!Number.isInteger(year) || year < 2024) {
    const err = new Error('year must be >= 2024'); err.statusCode = 400; throw err;
  }
  if (!company) {
    const err = new Error('company is required'); err.statusCode = 400; throw err;
  }
  return { month, year, company };
}

function tadaWriteAudit(db, { actionType, empCode, user, metadata }) {
  try {
    db.prepare(`
      INSERT INTO audit_log
        (table_name, record_id, field_name, old_value, new_value, changed_by, stage, remark, employee_code, action_type)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'sales_ta_da_computations', null, null,
      '', JSON.stringify(metadata || {}),
      user || 'unknown', 'sales_tada_compute',
      '', empCode || '', actionType
    );
  } catch (e) { /* audit must not break writes */ }
}

// POST /api/sales/ta-da/compute — recompute one cycle (or one employee).
router.post('/ta-da/compute',
  requirePermission('sales-tada-compute'),
  (req, res) => {
    try {
      const body = req.body || {};
      const { month, year, company } = validateTaDaCycleParams(body);
      const employeeCode = body.employeeCode ? String(body.employeeCode).trim() : null;
      const cycle = deriveCycleTopLevel(month, year);
      const user = req.user?.username || 'unknown';
      const db = getDb();

      const summary = taDaCompute.recomputeCycle(db, {
        month, year, company,
        cycleStart: cycle.start, cycleEnd: cycle.end,
        computedBy: user,
        requestId: req.requestId || null,
        triggerSource: 'manual:compute_endpoint',
        employeeCode: employeeCode || undefined,
      });

      tadaWriteAudit(db, {
        actionType: 'tada_compute_manual',
        empCode: employeeCode,
        user,
        metadata: {
          month, year, company, employeeCode,
          triggerSource: 'manual:compute_endpoint',
          counts: {
            computed: summary.computed,
            partial: summary.partial,
            flagged: summary.flagged,
            errors: summary.errors.length,
          },
        },
      });

      res.json({
        success: true,
        data: {
          month, year, company,
          cycleStart: cycle.start,
          cycleEnd: cycle.end,
          computed: summary.computed,
          partial: summary.partial,
          flagged: summary.flagged,
          errors: summary.errors,
        },
      });
    } catch (e) {
      const status = e.statusCode || 500;
      if (status >= 500) console.error('[ta-da/compute]', e?.stack || e);
      res.status(status).json({ success: false, error: e.message || 'compute failed' });
    }
  });

// GET /api/sales/ta-da/register — paged list with totals + statusCounts.
router.get('/ta-da/register',
  requirePermission('sales-tada-compute'),
  (req, res) => {
    try {
      const { month, year, company } = validateTaDaCycleParams(req.query);

      const status = req.query.status ? String(req.query.status).trim() : null;
      if (status && !TADA_COMP_STATUSES.has(status)) {
        return res.status(400).json({ success: false, error: 'invalid status filter' });
      }
      let taDaClass = null;
      if (req.query.ta_da_class !== undefined && req.query.ta_da_class !== '') {
        const c = parseInt(req.query.ta_da_class, 10);
        if (!Number.isInteger(c) || c < 0 || c > 5) {
          return res.status(400).json({ success: false, error: 'ta_da_class must be 0-5' });
        }
        taDaClass = c;
      }

      const page = Math.max(1, parseInt(req.query.page, 10) || 1);
      let pageSize = parseInt(req.query.pageSize, 10) || 200;
      if (pageSize < 1) pageSize = 200;
      if (pageSize > 500) pageSize = 500;

      const db = getDb();
      const cycle = deriveCycleTopLevel(month, year);

      // statusCounts: across ALL rows in the cycle (ignores status/class filters
      // so the badges show full picture).
      const statusRows = db.prepare(`
        SELECT status, COUNT(*) AS n
        FROM sales_ta_da_computations
        WHERE month = ? AND year = ? AND company = ?
        GROUP BY status
      `).all(month, year, company);
      const statusCounts = { computed: 0, partial: 0, flag_for_review: 0, paid: 0 };
      for (const r of statusRows) {
        if (statusCounts.hasOwnProperty(r.status)) statusCounts[r.status] = r.n;
      }

      const filterClauses = [];
      const filterParams = [month, year, company];
      if (status) { filterClauses.push('c.status = ?'); filterParams.push(status); }
      if (taDaClass !== null) {
        filterClauses.push('c.ta_da_class_at_compute = ?');
        filterParams.push(taDaClass);
      }
      const filterSql = filterClauses.length ? ' AND ' + filterClauses.join(' AND ') : '';

      // Totals: across ALL rows matching status/class filters (NOT just this page).
      const totals = db.prepare(`
        SELECT
          COALESCE(SUM(c.total_da), 0)      AS total_da,
          COALESCE(SUM(c.total_ta), 0)      AS total_ta,
          COALESCE(SUM(c.total_payable), 0) AS total_payable,
          COUNT(*)                          AS count
        FROM sales_ta_da_computations c
        WHERE c.month = ? AND c.year = ? AND c.company = ?
        ${filterSql}
      `).get(...filterParams);

      // Page rows: LEFT JOIN employee + monthly_input.
      const offset = (page - 1) * pageSize;
      const rows = db.prepare(`
        SELECT
          e.code, e.name, e.designation, e.headquarters AS hq, e.city_of_operation,
          c.ta_da_class_at_compute, c.status,
          c.days_worked_at_compute,
          c.in_city_days_at_compute, c.outstation_days_at_compute,
          c.total_km_at_compute, c.bike_km_at_compute, c.car_km_at_compute,
          c.da_local_amount, c.da_outstation_amount, c.total_da,
          c.ta_primary_amount, c.ta_secondary_amount, c.total_ta,
          c.total_payable,
          c.computation_notes, c.computed_at, c.computed_by,
          c.neft_exported_at, c.neft_exported_by, c.paid_at,
          mi.in_city_days  AS current_in_city_days,
          mi.outstation_days AS current_outstation_days,
          mi.total_km      AS current_total_km,
          mi.bike_km       AS current_bike_km,
          mi.car_km        AS current_car_km,
          mi.source        AS input_source,
          mi.notes         AS input_notes
        FROM sales_ta_da_computations c
        JOIN sales_employees e
          ON e.id = c.employee_id
        LEFT JOIN sales_ta_da_monthly_inputs mi
          ON mi.employee_id = c.employee_id
         AND mi.month = c.month
         AND mi.year = c.year
         AND mi.company = c.company
        WHERE c.month = ? AND c.year = ? AND c.company = ?
        ${filterSql}
        ORDER BY e.code ASC
        LIMIT ? OFFSET ?
      `).all(...filterParams, pageSize, offset);

      res.json({
        success: true,
        data: {
          rows,
          totals: {
            total_da: totals.total_da || 0,
            total_ta: totals.total_ta || 0,
            total_payable: totals.total_payable || 0,
            count: totals.count || 0,
          },
          statusCounts,
          page,
          pageSize,
          cycle: { start: cycle.start, end: cycle.end, length_days: cycle.lengthDays },
        },
      });
    } catch (e) {
      const code = e.statusCode || 500;
      if (code >= 500) console.error('[ta-da/register]', e?.stack || e);
      res.status(code).json({ success: false, error: e.message || 'register failed' });
    }
  });

// GET /api/sales/ta-da/employee/:code — full snapshot for one employee.
router.get('/ta-da/employee/:code',
  requirePermission('sales-tada-compute'),
  (req, res) => {
    try {
      const { month, year, company } = validateTaDaCycleParams(req.query);
      const code = String(req.params.code || '').trim();
      if (!code) {
        return res.status(400).json({ success: false, error: 'employee code required' });
      }

      const db = getDb();
      const cycle = deriveCycleTopLevel(month, year);

      const employee = db.prepare(`
        SELECT *
        FROM sales_employees
        WHERE code = ? AND company = ?
      `).get(code, company);

      if (!employee) {
        return res.status(404).json({ success: false, error: 'employee not found' });
      }

      const computation = db.prepare(`
        SELECT * FROM sales_ta_da_computations
        WHERE employee_id = ? AND month = ? AND year = ? AND company = ?
      `).get(employee.id, month, year, company) || null;

      const monthly_input = db.prepare(`
        SELECT * FROM sales_ta_da_monthly_inputs
        WHERE employee_id = ? AND month = ? AND year = ? AND company = ?
      `).get(employee.id, month, year, company) || null;

      res.json({
        success: true,
        data: {
          employee,
          computation,
          monthly_input,
          cycle: { start: cycle.start, end: cycle.end, length_days: cycle.lengthDays },
        },
      });
    } catch (e) {
      const code = e.statusCode || 500;
      if (code >= 500) console.error('[ta-da/employee]', e?.stack || e);
      res.status(code).json({ success: false, error: e.message || 'employee fetch failed' });
    }
  });

// PATCH /api/sales/ta-da/inputs/:code — HR edits β fields, auto-recomputes.
router.patch('/ta-da/inputs/:code',
  requirePermission('sales-tada-compute'),
  (req, res) => {
    try {
      const { month, year, company } = validateTaDaCycleParams(req.query);
      const code = String(req.params.code || '').trim();
      if (!code) {
        return res.status(400).json({ success: false, error: 'employee code required' });
      }
      const body = req.body || {};

      // Reject unknown fields.
      for (const k of Object.keys(body)) {
        if (!TADA_INPUT_FIELDS.has(k)) {
          return res.status(400).json({ success: false, error: `unknown field: ${k}` });
        }
      }

      // Numeric fields ≥ 0.
      const numericFields = ['in_city_days', 'outstation_days', 'total_km', 'bike_km', 'car_km'];
      const sanitized = {};
      for (const f of numericFields) {
        if (body[f] === undefined) continue;
        if (body[f] === null) { sanitized[f] = null; continue; }
        const n = Number(body[f]);
        if (!Number.isFinite(n) || n < 0) {
          return res.status(400).json({ success: false, error: `${f} must be ≥ 0` });
        }
        sanitized[f] = n;
      }
      if (body.notes !== undefined) {
        sanitized.notes = body.notes === null ? null : String(body.notes);
      }

      const db = getDb();
      const cycle = deriveCycleTopLevel(month, year);
      const user = req.user?.username || 'unknown';

      const employee = db.prepare(`
        SELECT id, code, ta_da_class
        FROM sales_employees WHERE code = ? AND company = ?
      `).get(code, company);
      if (!employee) {
        return res.status(404).json({ success: false, error: 'employee not found' });
      }

      const existingInput = db.prepare(`
        SELECT * FROM sales_ta_da_monthly_inputs
        WHERE employee_id = ? AND month = ? AND year = ? AND company = ?
      `).get(employee.id, month, year, company);

      // Resolve effective days_worked for cross-validation.
      let daysWorked = existingInput ? existingInput.days_worked : null;
      if (daysWorked === null || daysWorked === undefined) {
        const sheetRow = db.prepare(`
          SELECT smi.sheet_days_given AS d
          FROM sales_monthly_input smi
          JOIN sales_uploads su ON su.id = smi.upload_id
          WHERE smi.employee_code = ? AND smi.month = ? AND smi.year = ? AND smi.company = ?
            AND su.status IN ('matched','computed')
          ORDER BY su.uploaded_at DESC LIMIT 1
        `).get(code, month, year, company);
        daysWorked = sheetRow ? Number(sheetRow.d) : 0;
      }

      // Effective in_city + outstation after merge.
      const effInCity = sanitized.in_city_days !== undefined
        ? sanitized.in_city_days
        : (existingInput ? existingInput.in_city_days : null);
      const effOutstation = sanitized.outstation_days !== undefined
        ? sanitized.outstation_days
        : (existingInput ? existingInput.outstation_days : null);

      if (effInCity !== null && effOutstation !== null && daysWorked) {
        const sum = Number(effInCity) + Number(effOutstation);
        if (sum > daysWorked) {
          return res.status(400).json({
            success: false,
            error: `split exceeds days worked (${effInCity} + ${effOutstation} > ${daysWorked})`,
          });
        }
      }

      // Soft warning: Class 5 bike/car partial state.
      const warnings = [];
      if (Number(employee.ta_da_class) === 5) {
        const effBike = sanitized.bike_km !== undefined
          ? sanitized.bike_km
          : (existingInput ? existingInput.bike_km : null);
        const effCar = sanitized.car_km !== undefined
          ? sanitized.car_km
          : (existingInput ? existingInput.car_km : null);
        if ((effBike === null) !== (effCar === null)) {
          warnings.push('Class 5: bike_km and car_km should both be present or both null');
        }
      }

      // UPSERT input as 'manual' source. Preserve fields not in body.
      const fieldsChanged = Object.keys(sanitized);
      const txn = db.transaction(() => {
        if (existingInput) {
          db.prepare(`
            UPDATE sales_ta_da_monthly_inputs
            SET in_city_days   = COALESCE(?, in_city_days),
                outstation_days = COALESCE(?, outstation_days),
                total_km       = COALESCE(?, total_km),
                bike_km        = COALESCE(?, bike_km),
                car_km         = COALESCE(?, car_km),
                notes          = COALESCE(?, notes),
                source         = 'manual',
                source_detail  = ?,
                cycle_start_date = ?,
                cycle_end_date   = ?,
                updated_at     = datetime('now'),
                updated_by     = ?
            WHERE id = ?
          `).run(
            sanitized.in_city_days  !== undefined ? sanitized.in_city_days  : null,
            sanitized.outstation_days !== undefined ? sanitized.outstation_days : null,
            sanitized.total_km      !== undefined ? sanitized.total_km      : null,
            sanitized.bike_km       !== undefined ? sanitized.bike_km       : null,
            sanitized.car_km        !== undefined ? sanitized.car_km        : null,
            sanitized.notes         !== undefined ? sanitized.notes         : null,
            `PATCH by ${user}`,
            cycle.start, cycle.end,
            user,
            existingInput.id
          );
        } else {
          db.prepare(`
            INSERT INTO sales_ta_da_monthly_inputs (
              employee_id, employee_code, month, year, company,
              cycle_start_date, cycle_end_date,
              days_worked, in_city_days, outstation_days,
              total_km, bike_km, car_km,
              source, source_detail, notes,
              created_at, created_by, updated_at, updated_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                      'manual', ?, ?,
                      datetime('now'), ?, datetime('now'), ?)
          `).run(
            employee.id, code, month, year, company,
            cycle.start, cycle.end,
            daysWorked || 0,
            sanitized.in_city_days !== undefined ? sanitized.in_city_days : null,
            sanitized.outstation_days !== undefined ? sanitized.outstation_days : null,
            sanitized.total_km !== undefined ? sanitized.total_km : null,
            sanitized.bike_km  !== undefined ? sanitized.bike_km  : null,
            sanitized.car_km   !== undefined ? sanitized.car_km   : null,
            `PATCH by ${user}`,
            sanitized.notes !== undefined ? sanitized.notes : null,
            user, user
          );
        }
      });
      txn();

      tadaWriteAudit(db, {
        actionType: 'tada_inputs_patch',
        empCode: code,
        user,
        metadata: { employeeCode: code, month, year, company, fields_changed: fieldsChanged },
      });

      // Auto-recompute Phase β for this employee.
      const summary = taDaCompute.recomputeCycle(db, {
        month, year, company,
        cycleStart: cycle.start, cycleEnd: cycle.end,
        computedBy: user,
        requestId: req.requestId || null,
        triggerSource: 'manual:inputs_patch',
        employeeCode: code,
      });

      const computeError = summary.errors.find(x => x.employeeCode === code);

      const monthly_input = db.prepare(`
        SELECT * FROM sales_ta_da_monthly_inputs
        WHERE employee_id = ? AND month = ? AND year = ? AND company = ?
      `).get(employee.id, month, year, company);

      const computation = db.prepare(`
        SELECT * FROM sales_ta_da_computations
        WHERE employee_id = ? AND month = ? AND year = ? AND company = ?
      `).get(employee.id, month, year, company);

      res.json({
        success: true,
        data: {
          monthly_input,
          computation,
          warnings,
          compute_error: computeError ? computeError.error : null,
        },
      });
    } catch (e) {
      const code = e.statusCode || 500;
      if (code >= 500) console.error('[ta-da/inputs PATCH]', e?.stack || e);
      res.status(code).json({ success: false, error: e.message || 'inputs patch failed' });
    }
  });

// ══════════════════════════════════════════════════════════════════════
// Phase 3 — TA/DA upload + exports + payslip.
// All gated via per-route requirePermission(...). Local multer instance
// uses memoryStorage so the parser receives a Buffer directly (no disk
// round-trip; avoids TDZ collision with `salesUpload` declared lower in
// the file).
// ══════════════════════════════════════════════════════════════════════

const { parseTaDaUpload } = require('../services/salesTaDaUploadParser');
const {
  generateSalesTaDaExcel,
  generateSalesTaDaNEFT,
} = require('../services/salesExportFormats');

const taDaUpload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    const n = (file.originalname || '').toLowerCase();
    if (n.endsWith('.xls') || n.endsWith('.xlsx')) cb(null, true);
    else cb(new Error('Only .xls and .xlsx files are accepted'));
  },
  limits: { fileSize: 10 * 1024 * 1024 },
});

const TADA_CLASS_LABELS = {
  0: 'Class 0 — flag for review',
  1: 'Class 1 — flat DA only',
  2: 'Class 2 — split DA',
  3: 'Class 3 — flat DA + flat TA',
  4: 'Class 4 — split DA + flat TA',
  5: 'Class 5 — split DA + tiered TA (bike + car)',
};

const MONTHS_SHORT_LOCAL = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// 5. POST /api/sales/ta-da/upload/:class — class-template upload.
router.post('/ta-da/upload/:class',
  requirePermission('sales-tada-compute'),
  taDaUpload.single('file'),
  (req, res) => {
    try {
      const classNum = parseInt(req.params.class, 10);
      if (![2, 3, 4, 5].includes(classNum)) {
        return res.status(400).json({ success: false, error: 'class must be 2, 3, 4, or 5' });
      }
      if (!req.file || !req.file.buffer) {
        return res.status(400).json({ success: false, error: 'file upload required' });
      }
      const { month, year, company } = validateTaDaCycleParams(req.body || {});
      const cycle = deriveCycleTopLevel(month, year);
      const user = req.user?.username || 'unknown';
      const filename = req.file.originalname || 'upload.xlsx';
      const db = getDb();

      // Build sales_employees_lookup for this company.
      // days_worked_for_cycle resolution order:
      //   1. existing sales_ta_da_monthly_inputs.days_worked
      //   2. latest matched/computed sales_monthly_input.sheet_days_given
      //   3. 0
      const empRows = db.prepare(`
        SELECT e.id, e.code, e.ta_da_class
        FROM sales_employees e
        WHERE e.company = ?
      `).all(company);

      const lookup = new Map();
      const inputRowStmt = db.prepare(`
        SELECT days_worked FROM sales_ta_da_monthly_inputs
        WHERE employee_id = ? AND month = ? AND year = ? AND company = ?
      `);
      const sheetRowStmt = db.prepare(`
        SELECT smi.sheet_days_given AS d
        FROM sales_monthly_input smi
        JOIN sales_uploads su ON su.id = smi.upload_id
        WHERE smi.employee_code = ? AND smi.month = ? AND smi.year = ? AND smi.company = ?
          AND su.status IN ('matched','computed')
        ORDER BY su.uploaded_at DESC LIMIT 1
      `);
      for (const e of empRows) {
        let days = 0;
        const inp = inputRowStmt.get(e.id, month, year, company);
        if (inp && inp.days_worked !== null && inp.days_worked !== undefined) {
          days = Number(inp.days_worked) || 0;
        } else {
          const sh = sheetRowStmt.get(e.code, month, year, company);
          days = sh && sh.d !== null ? (Number(sh.d) || 0) : 0;
        }
        lookup.set(e.code, { ta_da_class: e.ta_da_class, days_worked_for_cycle: days });
      }

      const { rows, errors } = parseTaDaUpload(req.file.buffer, classNum, lookup);

      if (errors.length > 0) {
        return res.status(400).json({
          success: false,
          parsed: rows.length + errors.length,
          valid: rows.length,
          errors,
        });
      }

      // All rows valid: per-row UPSERT + auto-recompute. Track succeeded/failed.
      const succeeded = [];
      const failed = [];

      const upsertManual = db.prepare(`
        INSERT INTO sales_ta_da_monthly_inputs (
          employee_id, employee_code, month, year, company,
          cycle_start_date, cycle_end_date,
          days_worked, in_city_days, outstation_days,
          total_km, bike_km, car_km,
          source, source_detail, notes,
          created_at, created_by, updated_at, updated_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                  'upload', ?, NULL,
                  datetime('now'), ?, datetime('now'), ?)
        ON CONFLICT(employee_id, month, year, company) DO UPDATE SET
          in_city_days   = excluded.in_city_days,
          outstation_days = excluded.outstation_days,
          total_km       = excluded.total_km,
          bike_km        = excluded.bike_km,
          car_km         = excluded.car_km,
          days_worked    = excluded.days_worked,
          source         = 'upload',
          source_detail  = excluded.source_detail,
          cycle_start_date = excluded.cycle_start_date,
          cycle_end_date   = excluded.cycle_end_date,
          updated_at     = datetime('now'),
          updated_by     = excluded.updated_by
      `);

      const empIdByCode = new Map(empRows.map(e => [e.code, e.id]));
      const sourceDetail = `upload:class${classNum}:${filename}`;

      for (const row of rows) {
        const empId = empIdByCode.get(row.employee_code);
        try {
          const txn = db.transaction(() => {
            upsertManual.run(
              empId, row.employee_code, month, year, company,
              cycle.start, cycle.end,
              row.days_worked || 0,
              row.in_city_days !== undefined ? row.in_city_days : null,
              row.outstation_days !== undefined ? row.outstation_days : null,
              row.total_km !== undefined ? row.total_km : null,
              row.bike_km !== undefined ? row.bike_km : null,
              row.car_km !== undefined ? row.car_km : null,
              sourceDetail, user, user
            );
          });
          txn();

          const summary = taDaCompute.recomputeCycle(db, {
            month, year, company,
            cycleStart: cycle.start, cycleEnd: cycle.end,
            computedBy: user,
            requestId: req.requestId || null,
            triggerSource: 'manual:upload',
            employeeCode: row.employee_code,
          });
          const errMatch = summary.errors.find(x => x.employeeCode === row.employee_code);
          if (errMatch) {
            failed.push({ employee_code: row.employee_code, error: errMatch.error });
          } else {
            succeeded.push(row.employee_code);
          }
        } catch (perRowErr) {
          failed.push({
            employee_code: row.employee_code,
            error: perRowErr.message || String(perRowErr),
          });
        }
      }

      tadaWriteAudit(db, {
        actionType: 'tada_template_upload',
        empCode: null,
        user,
        metadata: {
          classNum, filename,
          parsed: rows.length, valid: rows.length,
          succeeded_count: succeeded.length,
          failed_count: failed.length,
        },
      });

      if (failed.length > 0) {
        return res.status(207).json({
          success: false,
          partial: true,
          data: {
            parsed: rows.length, valid: rows.length, invalid: 0,
            errors: [],
          },
          succeeded,
          failed,
          note: 'Some rows committed before error. Re-upload only the failed rows after fixing.',
        });
      }

      return res.json({
        success: true,
        data: {
          parsed: rows.length,
          valid: rows.length,
          invalid: 0,
          updated: succeeded.length,
          errors: [],
        },
      });
    } catch (e) {
      const status = e.statusCode || 500;
      if (status >= 500) console.error('[ta-da/upload]', e?.stack || e);
      res.status(status).json({ success: false, error: e.message || 'upload failed' });
    }
  });

// 6. GET /api/sales/ta-da/export/excel — JSON preview or .xlsx download.
router.get('/ta-da/export/excel',
  requirePermission('sales-tada-payable-export'),
  (req, res) => {
    try {
      const { month, year, company } = validateTaDaCycleParams(req.query);
      const status = req.query.status ? String(req.query.status).trim() : null;
      if (status && !TADA_COMP_STATUSES.has(status)) {
        return res.status(400).json({ success: false, error: 'invalid status filter' });
      }
      const download = String(req.query.download || '').toLowerCase() === 'true';
      const db = getDb();

      const params = [month, year, company];
      let statusFilter = '';
      if (status) { statusFilter = ' AND c.status = ?'; params.push(status); }

      const rows = db.prepare(`
        SELECT
          e.code, e.name, e.designation, e.headquarters AS hq, e.city_of_operation,
          e.reporting_manager,
          c.ta_da_class_at_compute, c.status,
          c.days_worked_at_compute,
          c.in_city_days_at_compute, c.outstation_days_at_compute,
          c.total_km_at_compute, c.bike_km_at_compute, c.car_km_at_compute,
          c.da_local_amount, c.da_outstation_amount, c.total_da,
          c.ta_primary_amount, c.ta_secondary_amount, c.total_ta,
          c.total_payable
        FROM sales_ta_da_computations c
        JOIN sales_employees e ON e.id = c.employee_id
        WHERE c.month = ? AND c.year = ? AND c.company = ?
        ${statusFilter}
        ORDER BY e.code ASC
      `).all(...params);

      if (!download) {
        return res.json({ success: true, data: { rows, count: rows.length } });
      }

      const out = generateSalesTaDaExcel(rows, { month, year, company });
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${out.filename}"`);
      return res.end(out.content);
    } catch (e) {
      const code = e.statusCode || 500;
      if (code >= 500) console.error('[ta-da/export/excel]', e?.stack || e);
      res.status(code).json({ success: false, error: e.message || 'excel export failed' });
    }
  });

// 7. GET /api/sales/ta-da/export/neft — JSON preview or CSV download + audit stamp.
router.get('/ta-da/export/neft',
  requirePermission('sales-tada-payable-export'),
  (req, res) => {
    try {
      const { month, year, company } = validateTaDaCycleParams(req.query);
      const mode = String(req.query.mode || 'computed_only').trim();
      if (!['computed_only', 'all'].includes(mode)) {
        return res.status(400).json({ success: false, error: "mode must be 'computed_only' or 'all'" });
      }
      const download = String(req.query.download || '').toLowerCase() === 'true';
      const user = req.user?.username || 'unknown';
      const db = getDb();

      const statusClause = mode === 'all'
        ? "AND c.status IN ('computed','partial')"
        : "AND c.status = 'computed'";

      const rows = db.prepare(`
        SELECT
          c.id AS computation_id, c.employee_id,
          e.code, e.name, e.doj, e.bank_name, e.account_no, e.ifsc,
          c.total_payable, c.status
        FROM sales_ta_da_computations c
        JOIN sales_employees e ON e.id = c.employee_id
        WHERE c.month = ? AND c.year = ? AND c.company = ?
          AND c.total_payable > 0
          ${statusClause}
        ORDER BY e.name ASC, e.code ASC
      `).all(month, year, company);

      const built = generateSalesTaDaNEFT(rows, { month, year, company });
      res.setHeader('X-Missing-Bank-Details', built.missing.join(','));

      if (!download) {
        return res.json({
          success: true,
          data: {
            count: built.totals.count,
            totalAmount: built.totals.totalAmount,
            missing: built.missing,
            mode,
          },
        });
      }

      // Stamp neft_exported_at + audit row in a single txn.
      const stamp = db.prepare(`
        UPDATE sales_ta_da_computations
        SET neft_exported_at = datetime('now'),
            neft_exported_by = ?
        WHERE id = ?
      `);
      const txn = db.transaction(() => {
        for (const r of built.eligible) stamp.run(user, r.computation_id);
      });
      txn();

      tadaWriteAudit(db, {
        actionType: 'tada_neft_export',
        empCode: null,
        user,
        metadata: {
          month, year, company, mode,
          count: built.totals.count,
          missing_count: built.totals.missingCount,
        },
      });

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${built.filename}"`);
      return res.end(built.csv);
    } catch (e) {
      const code = e.statusCode || 500;
      if (code >= 500) console.error('[ta-da/export/neft]', e?.stack || e);
      res.status(code).json({ success: false, error: e.message || 'neft export failed' });
    }
  });

// 8. GET /api/sales/ta-da/export/payslip/:code — structured JSON for a single payslip.
router.get('/ta-da/export/payslip/:code',
  requirePermission('sales-tada-payable-export'),
  (req, res) => {
    try {
      const { month, year, company } = validateTaDaCycleParams(req.query);
      const code = String(req.params.code || '').trim();
      if (!code) return res.status(400).json({ success: false, error: 'employee code required' });

      const db = getDb();
      const cycle = deriveCycleTopLevel(month, year);

      const employee = db.prepare(`
        SELECT * FROM sales_employees WHERE code = ? AND company = ?
      `).get(code, company);
      if (!employee) {
        return res.status(404).json({ success: false, error: 'employee not found' });
      }

      const computation = db.prepare(`
        SELECT * FROM sales_ta_da_computations
        WHERE employee_id = ? AND month = ? AND year = ? AND company = ?
      `).get(employee.id, month, year, company);
      if (!computation) {
        return res.status(404).json({ success: false, error: 'no computation for this cycle' });
      }

      const monthly_input = db.prepare(`
        SELECT * FROM sales_ta_da_monthly_inputs
        WHERE employee_id = ? AND month = ? AND year = ? AND company = ?
      `).get(employee.id, month, year, company) || null;

      const cls = Number(employee.ta_da_class);
      const isDraft = !['computed', 'paid'].includes(computation.status);

      res.json({
        success: true,
        data: {
          company: { name: company },
          cycle: { start: cycle.start, end: cycle.end, length_days: cycle.lengthDays },
          period: { month, year, label: `${MONTHS_SHORT_LOCAL[month]} ${year}` },
          employee: {
            code: employee.code,
            name: employee.name,
            designation: employee.designation,
            hq: employee.headquarters,
            city_of_operation: employee.city_of_operation,
            reporting_manager: employee.reporting_manager,
            doj: employee.doj,
            ta_da_class: cls,
            class_label: TADA_CLASS_LABELS[cls] || `Class ${cls}`,
            bank: {
              bank_name: employee.bank_name,
              account_no: employee.account_no,
              ifsc: employee.ifsc,
            },
          },
          computation,
          monthly_input,
          rates: {
            da_rate: employee.da_rate,
            da_outstation_rate: employee.da_outstation_rate,
            ta_rate_primary: employee.ta_rate_primary,
            ta_rate_secondary: employee.ta_rate_secondary,
          },
          status: {
            value: computation.status,
            label: computation.status,
            is_draft: isDraft,
          },
        },
      });
    } catch (e) {
      const code = e.statusCode || 500;
      if (code >= 500) console.error('[ta-da/export/payslip]', e?.stack || e);
      res.status(code).json({ success: false, error: e.message || 'payslip fetch failed' });
    }
  });

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
const { deriveCycle } = require('../services/cycleUtil');

const {
  generateSalesExcel,
  generateSalesNEFT,
} = require('../services/salesExportFormats');

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

  // Phase 1 cycle refactor: derive canonical cycle bounds (M-1)-26 … M-25.
  let cycleStart, cycleEnd;
  try {
    const cyc = deriveCycle(month, year);
    cycleStart = cyc.start; cycleEnd = cyc.end;
  } catch (e) {
    return res.status(400).json({ success: false, error: `Invalid cycle for ${month}/${year}: ${e.message}` });
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
          salesEmployee, monthlyInputRow: row,
          cycleStart, cycleEnd, month, year, company,
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

  // Phase 4 guardrail: cannot flip to paid until the NEFT file has been
  // exported for this row. Prevents marking rows paid that never actually
  // made it into a bank upload batch.
  if (next === 'paid' && !existing.neft_exported_at) {
    return res.status(400).json({
      success: false,
      error: 'Cannot mark paid: NEFT file has not been exported for this employee yet. Export Bank NEFT first.',
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

  // Phase 4: stamp payslip_generated_at as an audit trail for "last time
  // this payslip was viewed / downloaded". Carried across recompute by the
  // UPSERT pre-read in saveSalesSalaryComputation.
  try {
    db.prepare(`
      UPDATE sales_salary_computations
         SET payslip_generated_at = datetime('now')
       WHERE employee_code = ? AND month = ? AND year = ? AND company = ?
    `).run(code, month, year, company);
  } catch (e) { /* audit must not break payslip delivery */ }

  res.json({ success: true, data: result });
});

// ════════════════════════════════════════════════════════════════════
// Phase 4 — Exports (Excel register, Bank NEFT CSV)
// ════════════════════════════════════════════════════════════════════

// GET /api/sales/export/salary-register?month&year&company[&download=true]
router.get('/export/salary-register', (req, res) => {
  const db = getDb();
  const month = parseInt(req.query.month, 10);
  const year = parseInt(req.query.year, 10);
  const company = (req.query.company || '').trim();
  const download = req.query.download === 'true';

  if (!month || !year || !company) {
    return res.status(400).json({ success: false, error: 'month, year, and company query params are required' });
  }

  let result;
  try {
    result = generateSalesExcel(db, month, year, company);
  } catch (e) {
    return res.status(500).json({ success: false, error: `Excel generation failed: ${e.message}` });
  }

  if (download) {
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    return res.end(result.content);
  }

  // JSON preview — strip buffer, return rows + totals.
  res.json({
    success: true,
    data: {
      filename: result.filename,
      rowCount: result.count,
      totals: result.totals,
      employees: result.employees,
    },
  });
});

// GET /api/sales/export/bank-neft?month&year&company[&download=true]
// Side-effect on download=true: stamps neft_exported_at on every row
// included in the file, transactionally with file generation. The paid-
// transition guardrail reads this column.
router.get('/export/bank-neft', (req, res) => {
  const db = getDb();
  const user = req.user?.username || 'unknown';
  const month = parseInt(req.query.month, 10);
  const year = parseInt(req.query.year, 10);
  const company = (req.query.company || '').trim();
  const download = req.query.download === 'true';

  if (!month || !year || !company) {
    return res.status(400).json({ success: false, error: 'month, year, and company query params are required' });
  }

  let result;
  try {
    if (download) {
      // Generate + stamp in one txn so partial failure doesn't half-write
      // the audit flag. If stamping throws, the file isn't returned either.
      const txn = db.transaction(() => {
        const r = generateSalesNEFT(db, month, year, company);
        if (r.eligibleIds.length > 0) {
          const stamp = db.prepare(
            "UPDATE sales_salary_computations SET neft_exported_at = datetime('now') WHERE id = ?"
          );
          for (const id of r.eligibleIds) stamp.run(id);
        }
        writeAuditP2(db, 'sales_salary_computations', {
          recordId: 0, field: 'neft_exported', oldVal: '', newVal: `${r.eligibleIds.length} rows`,
          user, actionType: 'neft_export',
          remark: `NEFT export ${month}/${year} ${company} — ${r.eligibleIds.length} rows, ${r.missing.length} missing bank details`,
        });
        return r;
      });
      result = txn();
    } else {
      result = generateSalesNEFT(db, month, year, company);
    }
  } catch (e) {
    return res.status(500).json({ success: false, error: `NEFT generation failed: ${e.message}` });
  }

  if (download) {
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    return res.send(result.content);
  }

  // JSON preview — surface `missing[]` so the frontend can prompt HR.
  res.json({
    success: true,
    data: {
      filename: result.filename,
      employees: result.employees,
      missing: result.missing,
      totals: result.totals,
    },
  });
});

module.exports = router;
