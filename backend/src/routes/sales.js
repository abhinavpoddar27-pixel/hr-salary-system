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
const { requireHrOrAdmin, requirePermission, requireAdmin } = require('../middleware/roles');
const {
  parseSalesCoordinatorFile,
  normalizeName,
  normalizeManager,
  normalizeCity,
} = require('../services/salesCoordinatorParser');
const taDa = require('../services/taDaChangeRequest');
const taDaCompute = require('../services/salesTaDaComputation');
const { parseTaDaUpload } = require('../services/salesTaDaUploadParser');
// Phase 4 fix E: working-days for the cycle is needed at upload-preview
// time to flag rows where coordinator-reported `sheet_days_given` exceeds
// what the cycle physically allows. Reuse the same helpers Phase 3 compute
// uses so the formula stays single-source-of-truth.
const { deriveCycle: deriveCycleE, countSundaysInCycle: countSundaysE } = require('../services/cycleUtil');
const { countGazettedHolidaysInCycle: countHolidaysE } = require('../services/salesSalaryComputation');
// Phase 1 Sales Template Model (May 2026): pre-populated XLSX generator.
const { generateTemplate } = require('../services/salesTemplateGenerator');
// Phase 2 Sales Template Model (May 2026): 8-step validator + persister.
const { parseAndValidate: parseTemplateUpload } = require('../services/salesTemplateParser');

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
// Phase 3 — TA/DA compute + register + per-employee detail + inputs PATCH.
// Registered BEFORE router.use(requireHrOrAdmin) so the explicit
// requirePermission('sales-tada-compute') gate is the only access check.
// HR has 'sales-tada-compute'; admin inherits via '*'. Finance does NOT
// have this permission (compute is HR-initiated; finance reviews via the
// existing sales-tada-approve flow).
// ══════════════════════════════════════════════════════════════════════

// POST /api/sales/ta-da/compute — manual recompute of a cycle (or single employee)
router.post('/ta-da/compute',
  requirePermission('sales-tada-compute'),
  (req, res) => {
    try {
      const body = req.body || {};
      const month = parseInt(body.month, 10);
      const year  = parseInt(body.year, 10);
      const company = (body.company || '').trim();
      const employeeCode = body.employeeCode ? String(body.employeeCode).trim() : null;

      if (!month || !year || !company) {
        return res.status(400).json({ success: false, error: 'month, year, and company are required' });
      }

      let cycle;
      try {
        cycle = deriveCycle(month, year);
      } catch (e) {
        return res.status(400).json({ success: false, error: `Invalid cycle for ${month}/${year}: ${e.message}` });
      }

      const db = getDb();
      const user = req.user?.username || 'unknown';

      const summary = taDaCompute.recomputeCycle(db, {
        month, year, company,
        cycleStart: cycle.start, cycleEnd: cycle.end,
        computedBy: user,
        requestId: req.requestId || null,
        triggerSource: 'manual:compute_endpoint',
        employeeCode,
      });

      writeAuditP2(db, 'sales_ta_da_computations', {
        recordId: 0,
        field: 'recompute',
        oldVal: '',
        newVal: JSON.stringify({ month, year, company, employeeCode, summary }),
        user,
        actionType: 'tada_compute_manual',
        remark: `Manual TA/DA recompute ${month}/${year}/${company}${employeeCode ? ` (single: ${employeeCode})` : ''}`,
        empCode: employeeCode || '',
      });

      res.json({
        success: true,
        data: {
          month, year, company,
          computed: summary.computed,
          partial: summary.partial,
          flagged: summary.flagged,
          errors: summary.errors,
        },
      });
    } catch (e) {
      console.error('[ta-da/compute]', e?.stack || e);
      res.status(500).json({ success: false, error: e?.message || 'compute failed' });
    }
  });

// GET /api/sales/ta-da/register — paginated list with totals + status counts
router.get('/ta-da/register',
  requirePermission('sales-tada-compute'),
  (req, res) => {
    try {
      const month = parseInt(req.query.month, 10);
      const year  = parseInt(req.query.year, 10);
      const company = (req.query.company || '').trim();
      const status = req.query.status ? String(req.query.status).trim() : null;
      const taDaClassRaw = req.query.ta_da_class;
      const taDaClass = (taDaClassRaw !== undefined && taDaClassRaw !== '')
        ? parseInt(taDaClassRaw, 10) : null;
      const page = Math.max(1, parseInt(req.query.page, 10) || 1);
      const pageSize = Math.min(1000, Math.max(1, parseInt(req.query.pageSize, 10) || 200));

      if (!month || !year || !company) {
        return res.status(400).json({ success: false, error: 'month, year, and company are required' });
      }

      const db = getDb();

      const where = ['c.month = ?', 'c.year = ?', 'c.company = ?'];
      const params = [month, year, company];
      if (status) { where.push('c.status = ?'); params.push(status); }
      if (taDaClass !== null && Number.isInteger(taDaClass)) {
        where.push('c.ta_da_class_at_compute = ?');
        params.push(taDaClass);
      }
      const whereSql = where.join(' AND ');

      const offset = (page - 1) * pageSize;
      const rows = db.prepare(`
        SELECT
          c.*,
          e.name AS employee_name,
          e.headquarters,
          e.state,
          e.designation,
          e.reporting_manager,
          e.ta_da_class AS current_ta_da_class,
          mi.in_city_days,
          mi.outstation_days,
          mi.total_km,
          mi.bike_km,
          mi.car_km,
          mi.notes  AS input_notes,
          mi.source AS input_source,
          mi.source_detail AS input_source_detail
        FROM sales_ta_da_computations c
        JOIN sales_employees e ON e.id = c.employee_id
        LEFT JOIN sales_ta_da_monthly_inputs mi
          ON mi.employee_id = c.employee_id
         AND mi.month = c.month AND mi.year = c.year AND mi.company = c.company
        WHERE ${whereSql}
        ORDER BY e.code ASC
        LIMIT ? OFFSET ?
      `).all(...params, pageSize, offset);

      const totalsRow = db.prepare(`
        SELECT
          COALESCE(SUM(c.total_da), 0)      AS total_da,
          COALESCE(SUM(c.total_ta), 0)      AS total_ta,
          COALESCE(SUM(c.total_payable), 0) AS total_payable,
          COUNT(*)                           AS count
        FROM sales_ta_da_computations c
        JOIN sales_employees e ON e.id = c.employee_id
        WHERE ${whereSql}
      `).get(...params);

      const statusCountsRow = db.prepare(`
        SELECT
          SUM(CASE WHEN c.status = 'computed'        THEN 1 ELSE 0 END) AS computed,
          SUM(CASE WHEN c.status = 'partial'         THEN 1 ELSE 0 END) AS partial,
          SUM(CASE WHEN c.status = 'flag_for_review' THEN 1 ELSE 0 END) AS flag_for_review,
          SUM(CASE WHEN c.status = 'paid'            THEN 1 ELSE 0 END) AS paid
        FROM sales_ta_da_computations c
        WHERE c.month = ? AND c.year = ? AND c.company = ?
      `).get(month, year, company);

      res.json({
        success: true,
        data: {
          rows,
          totals: {
            total_da:      totalsRow.total_da      || 0,
            total_ta:      totalsRow.total_ta      || 0,
            total_payable: totalsRow.total_payable || 0,
            count:         totalsRow.count         || 0,
          },
          statusCounts: {
            computed:        statusCountsRow.computed        || 0,
            partial:         statusCountsRow.partial         || 0,
            flag_for_review: statusCountsRow.flag_for_review || 0,
            paid:            statusCountsRow.paid            || 0,
          },
          page,
          pageSize,
        },
      });
    } catch (e) {
      console.error('[ta-da/register]', e?.stack || e);
      res.status(500).json({ success: false, error: e?.message || 'register failed' });
    }
  });

// GET /api/sales/ta-da/employee/:code — detail modal payload
router.get('/ta-da/employee/:code',
  requirePermission('sales-tada-compute'),
  (req, res) => {
    try {
      const code = req.params.code;
      const month = parseInt(req.query.month, 10);
      const year  = parseInt(req.query.year, 10);
      const company = (req.query.company || '').trim();

      if (!month || !year || !company) {
        return res.status(400).json({ success: false, error: 'month, year, and company are required' });
      }

      const db = getDb();
      const employee = db.prepare(`
        SELECT * FROM sales_employees WHERE code = ? AND company = ?
      `).get(code, company);
      if (!employee) {
        return res.status(404).json({ success: false, error: 'employee not found' });
      }

      let cycle;
      try {
        cycle = deriveCycle(month, year);
      } catch (e) {
        return res.status(400).json({ success: false, error: `Invalid cycle: ${e.message}` });
      }

      const { computation, monthlyInput } = taDaCompute.getComputation(db, {
        employeeCode: code, month, year, company,
      });

      res.json({
        success: true,
        data: {
          employee,
          computation,
          monthly_input: monthlyInput,
          cycle: {
            start: cycle.start,
            end: cycle.end,
            length_days: cycle.lengthDays,
          },
        },
      });
    } catch (e) {
      console.error('[ta-da/employee]', e?.stack || e);
      res.status(500).json({ success: false, error: e?.message || 'fetch failed' });
    }
  });

// PATCH /api/sales/ta-da/inputs/:code — HR/finance enters split + km, triggers Phase β
router.patch('/ta-da/inputs/:code',
  requirePermission('sales-tada-compute'),
  (req, res) => {
    try {
      const code = req.params.code;
      const month = parseInt(req.query.month, 10);
      const year  = parseInt(req.query.year, 10);
      const company = (req.query.company || '').trim();

      if (!month || !year || !company) {
        return res.status(400).json({ success: false, error: 'month, year, and company are required' });
      }

      const ALLOWED = ['in_city_days', 'outstation_days', 'total_km', 'bike_km', 'car_km', 'notes'];
      const NUMERIC = new Set(['in_city_days', 'outstation_days', 'total_km', 'bike_km', 'car_km']);

      const body = req.body || {};
      const patch = {};
      for (const key of ALLOWED) {
        if (Object.prototype.hasOwnProperty.call(body, key)) patch[key] = body[key];
      }
      if (Object.keys(patch).length === 0) {
        return res.status(400).json({ success: false, error: 'no valid fields to update' });
      }

      // Numeric fields must be >= 0 (null is allowed — clears the field).
      for (const key of Object.keys(patch)) {
        if (!NUMERIC.has(key)) continue;
        if (patch[key] === null || patch[key] === undefined || patch[key] === '') {
          patch[key] = null;
          continue;
        }
        const n = typeof patch[key] === 'number' ? patch[key] : parseFloat(patch[key]);
        if (!Number.isFinite(n) || n < 0) {
          return res.status(400).json({ success: false, error: `${key} must be a non-negative number` });
        }
        patch[key] = n;
      }

      const db = getDb();
      const employee = db.prepare(`
        SELECT * FROM sales_employees WHERE code = ? AND company = ?
      `).get(code, company);
      if (!employee) {
        return res.status(404).json({ success: false, error: 'employee not found' });
      }

      let cycle;
      try {
        cycle = deriveCycle(month, year);
      } catch (e) {
        return res.status(400).json({ success: false, error: `Invalid cycle: ${e.message}` });
      }

      const existing = db.prepare(`
        SELECT * FROM sales_ta_da_monthly_inputs
         WHERE employee_id = ? AND month = ? AND year = ? AND company = ?
      `).get(employee.id, month, year, company);

      // Resolve days_worked for cross-field validation.
      // Existing row → use its days_worked; otherwise look up attendance
      // (sales_monthly_input.sheet_days_given) so a brand-new employee can
      // PATCH without first running the cycle compute.
      let daysWorked;
      if (existing) {
        daysWorked = existing.days_worked;
      } else {
        const attRow = db.prepare(`
          SELECT smi.sheet_days_given
            FROM sales_monthly_input smi
            JOIN sales_uploads su ON su.id = smi.upload_id
           WHERE smi.employee_code = ? AND smi.month = ? AND smi.year = ? AND smi.company = ?
             AND su.status IN ('matched', 'computed')
           ORDER BY su.uploaded_at DESC
           LIMIT 1
        `).get(code, month, year, company);
        daysWorked = attRow ? Math.round(parseFloat(attRow.sheet_days_given) || 0) : 0;
      }

      // Merge patch over existing (or defaults) — used for cross-field validation
      // AND as the row body for INSERT-on-no-existing-row.
      const merged = {
        in_city_days:    existing ? existing.in_city_days    : null,
        outstation_days: existing ? existing.outstation_days : null,
        total_km:        existing ? existing.total_km        : null,
        bike_km:         existing ? existing.bike_km         : null,
        car_km:          existing ? existing.car_km          : null,
        notes:           existing ? existing.notes           : null,
      };
      for (const key of ALLOWED) {
        if (Object.prototype.hasOwnProperty.call(patch, key)) merged[key] = patch[key];
      }

      // Cross-field: in_city + outstation must not exceed days_worked.
      const ic = merged.in_city_days;
      const os = merged.outstation_days;
      if (ic !== null && os !== null && Number.isFinite(ic) && Number.isFinite(os)) {
        const sum = ic + os;
        if (sum > daysWorked) {
          return res.status(400).json({
            success: false,
            error: `split exceeds days_worked (${ic} + ${os} > ${daysWorked})`,
          });
        }
      }

      const user = req.user?.username || 'unknown';
      const sourceDetail = `PATCH by ${user}`;

      db.transaction(() => {
        if (existing) {
          db.prepare(`
            UPDATE sales_ta_da_monthly_inputs
               SET in_city_days     = ?,
                   outstation_days  = ?,
                   total_km         = ?,
                   bike_km          = ?,
                   car_km           = ?,
                   notes            = ?,
                   source           = 'manual',
                   source_detail    = ?,
                   cycle_start_date = ?,
                   cycle_end_date   = ?,
                   updated_at       = datetime('now'),
                   updated_by       = ?
             WHERE id = ?
          `).run(
            merged.in_city_days, merged.outstation_days,
            merged.total_km, merged.bike_km, merged.car_km,
            merged.notes,
            sourceDetail,
            cycle.start, cycle.end,
            user,
            existing.id
          );
        } else {
          db.prepare(`
            INSERT INTO sales_ta_da_monthly_inputs
              (employee_id, employee_code, month, year, company,
               cycle_start_date, cycle_end_date,
               days_worked, in_city_days, outstation_days,
               total_km, bike_km, car_km,
               source, source_detail, notes,
               created_at, created_by, updated_at, updated_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                    'manual', ?, ?,
                    datetime('now'), ?, datetime('now'), ?)
          `).run(
            employee.id, code, month, year, company,
            cycle.start, cycle.end,
            daysWorked,
            merged.in_city_days, merged.outstation_days,
            merged.total_km, merged.bike_km, merged.car_km,
            sourceDetail, merged.notes,
            user, user
          );
        }
      })();

      writeAuditP2(db, 'sales_ta_da_monthly_inputs', {
        recordId: existing ? existing.id : 0,
        field: 'inputs_patch',
        oldVal: existing ? JSON.stringify({
          in_city_days:    existing.in_city_days,
          outstation_days: existing.outstation_days,
          total_km:        existing.total_km,
          bike_km:         existing.bike_km,
          car_km:          existing.car_km,
          notes:           existing.notes,
        }) : '',
        newVal: JSON.stringify(merged),
        user,
        actionType: 'tada_inputs_patch',
        remark: `PATCH inputs ${code} ${month}/${year}/${company}`,
        empCode: code,
      });

      // Trigger Phase β recompute for this single employee.
      const summary = taDaCompute.recomputeCycle(db, {
        month, year, company,
        cycleStart: cycle.start, cycleEnd: cycle.end,
        computedBy: user,
        requestId: req.requestId || null,
        triggerSource: 'manual:inputs_patch',
        employeeCode: code,
      });
      if (summary.errors && summary.errors.length > 0) {
        return res.status(500).json({
          success: false,
          error: `recompute failed: ${summary.errors[0].error}`,
        });
      }

      const { computation } = taDaCompute.getComputation(db, {
        employeeCode: code, month, year, company,
      });

      res.json({ success: true, data: { computation } });
    } catch (e) {
      console.error('[ta-da/inputs]', e?.stack || e);
      res.status(500).json({ success: false, error: e?.message || 'patch failed' });
    }
  });

// ──────────────────────────────────────────────────────────────────────
// TA/DA upload (Phase β template) + payable exports + payslip JSON.
// A separate multer instance is declared here (same config as the
// coordinator-sheet `salesUpload` further down the file) so the upload
// route can be registered before that const exists in module scope.
// ──────────────────────────────────────────────────────────────────────
const taDaUploadDir = path.join(__dirname, '../../../uploads/sales');
try { fs.mkdirSync(taDaUploadDir, { recursive: true }); } catch (e) { /* ignore */ }
const taDaUpload = multer({
  dest: taDaUploadDir,
  fileFilter: (req, file, cb) => {
    const n = (file.originalname || '').toLowerCase();
    if (n.endsWith('.xls') || n.endsWith('.xlsx')) cb(null, true);
    else cb(new Error('Only .xls and .xlsx files are accepted'));
  },
  limits: { fileSize: 10 * 1024 * 1024 },
});

const TA_DA_TEMPLATE_CLASSES = new Set([2, 3, 4, 5]);
const MONTHS_SHORT_TADA = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// GET /api/sales/ta-da/template-data/:class?month=&year=&company=
// Returns active sales employees of the given class with pre-fillable
// fields (code, name, city, days_worked) for client-side template
// generation. Read-only; no side effects.
router.get('/ta-da/template-data/:class',
  requirePermission('sales-tada-compute'),
  (req, res) => {
    try {
      const classNum = parseInt(req.params.class, 10);
      if (!TA_DA_TEMPLATE_CLASSES.has(classNum)) {
        return res.status(400).json({
          success: false,
          error: `class must be 2, 3, 4, or 5 (got ${req.params.class})`,
        });
      }

      const month = parseInt(req.query.month, 10);
      const year = parseInt(req.query.year, 10);
      const company = (req.query.company || '').trim();

      if (!month || month < 1 || month > 12 ||
          !year  || year  < 2020 || year  > 2100 ||
          !company) {
        return res.status(400).json({
          success: false,
          error: 'month, year, and company query params are required',
        });
      }

      const db = getDb();
      const employees = db.prepare(`
        SELECT e.code,
               e.name,
               e.city_of_operation AS city,
               COALESCE(mi.days_worked, smi.sheet_days_given) AS days_worked
          FROM sales_employees e
          LEFT JOIN sales_ta_da_monthly_inputs mi
            ON mi.employee_id = e.id
           AND mi.month = ?
           AND mi.year = ?
           AND mi.company = ?
          LEFT JOIN sales_monthly_input smi
            ON smi.employee_code = e.code
           AND smi.month = ?
           AND smi.year = ?
           AND smi.company = ?
         WHERE e.company = ?
           AND e.status = 'Active'
           AND e.ta_da_class = ?
         ORDER BY e.name ASC
      `).all(month, year, company, month, year, company, company, classNum);

      res.json({
        success: true,
        data: { class: classNum, month, year, company, employees },
      });
    } catch (e) {
      console.error('[ta-da/template-data]', e?.stack || e);
      res.status(500).json({ success: false, error: e?.message || 'template-data failed' });
    }
  });

// POST /api/sales/ta-da/upload/:class — Phase β bulk upload
router.post('/ta-da/upload/:class',
  requirePermission('sales-tada-compute'),
  taDaUpload.single('file'),
  (req, res) => {
    const filePath = req.file ? req.file.path : null;
    try {
      const classNum = parseInt(req.params.class, 10);
      if (!TA_DA_TEMPLATE_CLASSES.has(classNum)) {
        if (filePath) { try { fs.unlinkSync(filePath); } catch (e) { /* ignore */ } }
        return res.status(400).json({ success: false, error: `class must be 2, 3, 4, or 5 (got ${req.params.class})` });
      }

      if (!req.file) {
        return res.status(400).json({ success: false, error: 'file is required (multipart field name: file)' });
      }

      const body = req.body || {};
      const month = parseInt(body.month, 10);
      const year  = parseInt(body.year, 10);
      const company = (body.company || '').trim();
      if (!month || !year || !company) {
        try { fs.unlinkSync(filePath); } catch (e) { /* ignore */ }
        return res.status(400).json({ success: false, error: 'month, year, and company are required' });
      }

      let cycle;
      try {
        cycle = deriveCycle(month, year);
      } catch (e) {
        try { fs.unlinkSync(filePath); } catch (er) { /* ignore */ }
        return res.status(400).json({ success: false, error: `Invalid cycle: ${e.message}` });
      }

      const db = getDb();
      const user = req.user?.username || 'unknown';

      // Build sales_employees_lookup for the company.
      // days_worked_for_cycle: prefer existing TA/DA monthly_inputs row
      // (which carries upload/manual edits), else fall back to attendance
      // (sales_monthly_input.sheet_days_given), else 0.
      const empRows = db.prepare(`
        SELECT e.code, e.ta_da_class,
               mi.days_worked       AS mi_days,
               smi.sheet_days_given AS att_days
          FROM sales_employees e
          LEFT JOIN sales_ta_da_monthly_inputs mi
            ON mi.employee_id = e.id AND mi.month = ? AND mi.year = ? AND mi.company = ?
          LEFT JOIN sales_monthly_input smi
            ON smi.employee_code = e.code AND smi.month = ? AND smi.year = ? AND smi.company = ?
         WHERE e.company = ? AND e.status = 'Active'
      `).all(month, year, company, month, year, company, company);

      const lookup = new Map();
      for (const r of empRows) {
        const days = r.mi_days != null
          ? parseFloat(r.mi_days) || 0
          : (r.att_days != null ? Math.round(parseFloat(r.att_days) || 0) : 0);
        lookup.set(r.code, {
          ta_da_class: r.ta_da_class,
          days_worked_for_cycle: days,
        });
      }

      const buf = fs.readFileSync(filePath);
      const { rows, errors } = parseTaDaUpload(buf, classNum, lookup);

      // Cleanup the uploaded temp file regardless of outcome (we don't
      // archive Phase β templates — the data lives in monthly_inputs).
      try { fs.unlinkSync(filePath); } catch (e) { /* ignore */ }

      if (errors.length > 0) {
        return res.status(400).json({
          success: false,
          parsed: errors.length,
          valid: 0,
          invalid: errors.length,
          errors,
        });
      }

      const filename = req.file.originalname || 'tada-upload.xlsx';
      const sourceDetail = `upload:class${classNum}:${filename}`;

      const updated = [];
      const computeErrors = [];

      // Per-row UPSERT with source='upload' + per-row recompute.
      for (const row of rows) {
        try {
          const employee = db.prepare(`
            SELECT * FROM sales_employees WHERE code = ? AND company = ?
          `).get(row.employee_code, company);
          if (!employee) {
            computeErrors.push({ employee_code: row.employee_code, error: 'employee disappeared mid-upload' });
            continue;
          }

          const existing = db.prepare(`
            SELECT * FROM sales_ta_da_monthly_inputs
             WHERE employee_id = ? AND month = ? AND year = ? AND company = ?
          `).get(employee.id, month, year, company);

          const merged = {
            in_city_days:    row.in_city_days    !== undefined ? row.in_city_days    : (existing ? existing.in_city_days    : null),
            outstation_days: row.outstation_days !== undefined ? row.outstation_days : (existing ? existing.outstation_days : null),
            total_km:        row.total_km        !== undefined ? row.total_km        : (existing ? existing.total_km        : null),
            bike_km:         row.bike_km         !== undefined ? row.bike_km         : (existing ? existing.bike_km         : null),
            car_km:          row.car_km          !== undefined ? row.car_km          : (existing ? existing.car_km          : null),
          };

          const daysWorked = existing ? existing.days_worked
            : ((lookup.get(row.employee_code) || {}).days_worked_for_cycle || 0);

          db.transaction(() => {
            if (existing) {
              db.prepare(`
                UPDATE sales_ta_da_monthly_inputs
                   SET in_city_days     = ?,
                       outstation_days  = ?,
                       total_km         = ?,
                       bike_km          = ?,
                       car_km           = ?,
                       source           = 'upload',
                       source_detail    = ?,
                       cycle_start_date = ?,
                       cycle_end_date   = ?,
                       updated_at       = datetime('now'),
                       updated_by       = ?
                 WHERE id = ?
              `).run(
                merged.in_city_days, merged.outstation_days,
                merged.total_km, merged.bike_km, merged.car_km,
                sourceDetail,
                cycle.start, cycle.end,
                user,
                existing.id
              );
            } else {
              db.prepare(`
                INSERT INTO sales_ta_da_monthly_inputs
                  (employee_id, employee_code, month, year, company,
                   cycle_start_date, cycle_end_date,
                   days_worked, in_city_days, outstation_days,
                   total_km, bike_km, car_km,
                   source, source_detail, notes,
                   created_at, created_by, updated_at, updated_by)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                        'upload', ?, NULL,
                        datetime('now'), ?, datetime('now'), ?)
              `).run(
                employee.id, row.employee_code, month, year, company,
                cycle.start, cycle.end,
                daysWorked,
                merged.in_city_days, merged.outstation_days,
                merged.total_km, merged.bike_km, merged.car_km,
                sourceDetail,
                user, user
              );
            }
          })();

          const summary = taDaCompute.recomputeCycle(db, {
            month, year, company,
            cycleStart: cycle.start, cycleEnd: cycle.end,
            computedBy: user,
            requestId: req.requestId || null,
            triggerSource: 'manual:tada_upload',
            employeeCode: row.employee_code,
          });
          if (summary.errors && summary.errors.length > 0) {
            computeErrors.push({ employee_code: row.employee_code, error: summary.errors[0].error });
            continue;
          }
          updated.push(row.employee_code);
        } catch (rowErr) {
          computeErrors.push({ employee_code: row.employee_code, error: rowErr.message });
        }
      }

      writeAuditP2(db, 'sales_ta_da_monthly_inputs', {
        recordId: 0,
        field: 'template_upload',
        oldVal: '',
        newVal: JSON.stringify({ classNum, filename, count: rows.length, updated: updated.length }),
        user,
        actionType: 'tada_template_upload',
        remark: `Class ${classNum} TA/DA template uploaded: ${filename} (${rows.length} rows)`,
        empCode: '',
      });

      // Mid-loop failure ⇒ some rows committed before the error.
      // Surface partial-failure shape so HR can re-upload only the failed rows.
      if (computeErrors.length > 0) {
        return res.status(200).json({
          success: false,
          data: {
            parsed: rows.length,
            valid: rows.length - computeErrors.length,
            invalid: computeErrors.length,
            errors: [],
          },
          partial: true,
          succeeded: updated,
          failed: computeErrors,
          note: 'Some rows committed before error. Re-upload only the failed rows after fixing.',
        });
      }

      res.json({
        success: true,
        data: {
          parsed: rows.length,
          valid: rows.length,
          invalid: 0,
          updated: updated.length,
          errors: [],
        },
      });
    } catch (e) {
      if (filePath) { try { fs.unlinkSync(filePath); } catch (er) { /* ignore */ } }
      console.error('[ta-da/upload]', e?.stack || e);
      res.status(500).json({ success: false, error: e?.message || 'upload failed' });
    }
  });

// GET /api/sales/ta-da/export/excel — preview JSON or .xlsx download
router.get('/ta-da/export/excel',
  requirePermission('sales-tada-payable-export'),
  (req, res) => {
    try {
      const month = parseInt(req.query.month, 10);
      const year  = parseInt(req.query.year, 10);
      const company = (req.query.company || '').trim();
      const status = req.query.status ? String(req.query.status).trim() : null;
      const download = String(req.query.download || '').toLowerCase() === 'true';

      if (!month || !year || !company) {
        return res.status(400).json({ success: false, error: 'month, year, and company are required' });
      }

      const db = getDb();
      const { generateSalesTaDaExcel } = require('../services/salesExportFormats');
      const result = generateSalesTaDaExcel(db, month, year, company, status);

      if (!download) {
        return res.json({
          success: true,
          data: { rows: result.rows, count: result.count },
        });
      }

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
      res.setHeader('Content-Length', result.content.length);
      res.send(result.content);
    } catch (e) {
      console.error('[ta-da/export/excel]', e?.stack || e);
      res.status(500).json({ success: false, error: e?.message || 'excel export failed' });
    }
  });

// GET /api/sales/ta-da/export/neft — preview JSON or .csv download (stamps neft_exported_at on download)
router.get('/ta-da/export/neft',
  requirePermission('sales-tada-payable-export'),
  (req, res) => {
    try {
      const month = parseInt(req.query.month, 10);
      const year  = parseInt(req.query.year, 10);
      const company = (req.query.company || '').trim();
      const modeRaw = (req.query.mode || 'computed_only').toLowerCase();
      const mode = (modeRaw === 'all') ? 'all' : 'computed_only';
      const download = String(req.query.download || '').toLowerCase() === 'true';

      if (!month || !year || !company) {
        return res.status(400).json({ success: false, error: 'month, year, and company are required' });
      }

      const db = getDb();
      const user = req.user?.username || 'unknown';
      const { generateSalesTaDaNEFT } = require('../services/salesExportFormats');
      const result = generateSalesTaDaNEFT(db, month, year, company, mode);

      if (result.missing.length > 0) {
        const codes = result.missing.map(m => m.employee_code).join(',');
        res.setHeader('X-Missing-Bank-Details', codes);
      }

      if (!download) {
        return res.json({
          success: true,
          data: {
            rows: result.rows,
            missing: result.missing,
            totals: result.totals,
            mode,
          },
        });
      }

      // download=true → stamp neft_exported_at + audit, then send CSV.
      const stamp = db.prepare(`
        UPDATE sales_ta_da_computations
           SET neft_exported_at = datetime('now'),
               neft_exported_by = ?
         WHERE id = ?
      `);
      db.transaction(() => {
        for (const id of result.eligibleIds) stamp.run(user, id);
      })();

      writeAuditP2(db, 'sales_ta_da_computations', {
        recordId: 0,
        field: 'neft_export',
        oldVal: '',
        newVal: JSON.stringify({
          month, year, company, mode,
          count: result.totals.count,
          totalAmount: result.totals.totalAmount,
        }),
        user,
        actionType: 'tada_neft_export',
        remark: `TA/DA NEFT export ${month}/${year}/${company} (${mode}, ${result.totals.count} rows)`,
        empCode: '',
      });

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
      res.send(result.content);
    } catch (e) {
      console.error('[ta-da/export/neft]', e?.stack || e);
      res.status(500).json({ success: false, error: e?.message || 'neft export failed' });
    }
  });

// GET /api/sales/ta-da/export/payslip/:code — structured JSON for client-side PDF render
router.get('/ta-da/export/payslip/:code',
  requirePermission('sales-tada-payable-export'),
  (req, res) => {
    try {
      const code = req.params.code;
      const month = parseInt(req.query.month, 10);
      const year  = parseInt(req.query.year, 10);
      const company = (req.query.company || '').trim();

      if (!month || !year || !company) {
        return res.status(400).json({ success: false, error: 'month, year, and company are required' });
      }

      const db = getDb();
      const employee = db.prepare(`
        SELECT * FROM sales_employees WHERE code = ? AND company = ?
      `).get(code, company);
      if (!employee) {
        return res.status(404).json({ success: false, error: 'employee not found' });
      }

      const { computation, monthlyInput } = taDaCompute.getComputation(db, {
        employeeCode: code, month, year, company,
      });
      if (!computation) {
        return res.status(404).json({ success: false, error: 'no TA/DA computation for this cycle' });
      }

      let cycle;
      try {
        cycle = deriveCycle(month, year);
      } catch (e) {
        return res.status(400).json({ success: false, error: `Invalid cycle: ${e.message}` });
      }

      const CLASS_LABELS = {
        0: 'Class 0 — Review required',
        1: 'Class 1 — Fixed DA package',
        2: 'Class 2 — Tiered DA, no TA',
        3: 'Class 3 — Flat DA + per-km TA',
        4: 'Class 4 — Tiered DA + per-km TA',
        5: 'Class 5 — Tiered DA + dual-vehicle TA',
      };
      const STATUS_LABELS = {
        computed: 'Computed',
        partial: 'Partial — awaiting Phase β inputs',
        flag_for_review: 'Flagged for HR review',
        paid: 'Paid',
      };

      const companyInfo = (() => {
        try {
          const cc = db.prepare(`SELECT * FROM company_config WHERE name = ? LIMIT 1`).get(company);
          return cc || { name: company };
        } catch (e) { return { name: company }; }
      })();

      res.json({
        success: true,
        data: {
          company: companyInfo,
          cycle: {
            start: cycle.start,
            end: cycle.end,
            length_days: cycle.lengthDays,
          },
          employee: {
            code: employee.code,
            name: employee.name,
            designation: employee.designation,
            hq: employee.headquarters,
            city_of_operation: employee.city_of_operation,
            reporting_manager: employee.reporting_manager,
            doj: employee.doj,
            class: employee.ta_da_class,
            class_label: CLASS_LABELS[employee.ta_da_class] || `Class ${employee.ta_da_class}`,
            bank: {
              bank_name: employee.bank_name,
              account_no: employee.account_no,
              ifsc: employee.ifsc,
            },
          },
          computation,
          inputs: monthlyInput,
          rates: {
            da_rate: employee.da_rate,
            da_outstation_rate: employee.da_outstation_rate,
            ta_rate_primary: employee.ta_rate_primary,
            ta_rate_secondary: employee.ta_rate_secondary,
          },
          status: {
            value: computation.status,
            label: STATUS_LABELS[computation.status] || computation.status,
            is_draft: !['computed', 'paid'].includes(computation.status),
          },
        },
      });
    } catch (e) {
      console.error('[ta-da/export/payslip]', e?.stack || e);
      res.status(500).json({ success: false, error: e?.message || 'payslip fetch failed' });
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

// ── GET /api/sales/template — Phase 1 Sales Template Model (May 2026)
// Returns a pre-populated XLSX (Sheet 1 "Input" + hidden "_meta" sheet)
// for HR to fill Days Given and re-upload. No side effects beyond the
// audit row in sales_template_downloads. Gated by requireHrOrAdmin via
// the file-wide router.use() above (matching /employees behaviour).
router.get('/template', (req, res) => {
  const month = parseInt(req.query.month, 10);
  const year = parseInt(req.query.year, 10);
  const company = (req.query.company || '').trim();
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    return res.status(400).json({ success: false, error: 'month must be an integer 1-12' });
  }
  if (!Number.isInteger(year) || year < 2024 || year > 2030) {
    return res.status(400).json({ success: false, error: 'year must be an integer 2024-2030' });
  }
  if (!company) {
    return res.status(400).json({ success: false, error: 'company query param required' });
  }

  const db = getDb();
  const generatedBy = (req.user && req.user.username) || 'unknown';
  let result;
  try {
    result = generateTemplate(db, { month, year, company, generatedBy });
  } catch (e) {
    console.error('[sales-template] generation failed:', e.message);
    return res.status(500).json({ success: false, error: e.message });
  }
  if (result.employeeCount === 0) {
    return res.status(404).json({
      success: false,
      error: 'No eligible sales employees for this month/year/company',
    });
  }

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
  res.setHeader('Content-Length', result.buffer.length);
  res.setHeader('X-Master-Snapshot-Hash', result.hash);
  res.setHeader('X-Employee-Count', String(result.employeeCount));
  res.send(result.buffer);
});

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

  // `code` is auto-assigned server-side when omitted (S### per company,
  // race-safe via transaction below). HR-supplied codes are accepted for
  // scripted/migration use cases but flagged in audit.
  const required = ['name', 'company', 'bank_name', 'account_no', 'ifsc'];
  const missing = required.filter(f => !body[f] || String(body[f]).trim() === '');
  if (missing.length) {
    return res.status(400).json({ success: false, error: `Missing required field(s): ${missing.join(', ')}` });
  }

  // Salary-component coherence: if any of the four are supplied, all four +
  // a positive gross_salary must be supplied AND must sum to gross_salary
  // (±1 tolerance). This is the wiring for atomic structure-row creation.
  // When NONE are supplied, behavior is unchanged (employee row only,
  // preserving scripted/migration callers).
  const componentFields = ['basic', 'hra', 'cca', 'conveyance'];
  const anyComponent = componentFields.some(f => body[f] !== undefined && body[f] !== '');
  const allComponents = componentFields.every(f => body[f] !== undefined && body[f] !== '');
  const grossSupplied = body.gross_salary !== undefined && body.gross_salary !== '' && Number(body.gross_salary) > 0;
  if (anyComponent && (!allComponents || !grossSupplied)) {
    return res.status(400).json({
      success: false,
      error: 'Salary components require all four (basic, hra, cca, conveyance) and a positive gross_salary'
    });
  }
  if (allComponents && grossSupplied) {
    const sum = Number(body.basic) + Number(body.hra) + Number(body.cca) + Number(body.conveyance);
    const expected = Number(body.gross_salary);
    const diff = Math.abs(sum - expected);
    if (diff > 1) {
      return res.status(400).json({
        success: false,
        error: `Salary components must sum to gross_salary (got ${sum}, expected ${expected}, diff ${diff})`
      });
    }
  }
  const writeStructure = allComponents && grossSupplied;

  if (body.status && !VALID_STATUSES.includes(body.status)) {
    return res.status(400).json({ success: false, error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}` });
  }

  const explicitCode = body.code && String(body.code).trim() !== ''
    ? String(body.code).trim()
    : null;

  // Build the column/value set excluding `code` — code is added inside the
  // transaction once it's resolved (auto-assigned or validated explicit).
  const cols = ['name', 'company', 'created_by', 'updated_by'];
  const values = [body.name, body.company, user, user];
  for (const f of UPDATABLE_FIELDS) {
    if (['code', 'company'].includes(f)) continue; // company already added; code handled below
    if (f === 'name') continue;                    // already added
    if (body[f] === undefined) continue;
    cols.push(f);
    values.push(body[f]);
  }

  try {
    // SELECT-MAX + INSERT in a single transaction so simultaneous creates
    // can't collide on the auto-assigned code. Explicit-code path is also
    // wrapped — uniqueness check + insert run as one unit.
    const result = db.transaction(() => {
      let assignedCode;
      let codeWasExplicit = false;

      if (explicitCode) {
        codeWasExplicit = true;
        const dup = db.prepare('SELECT id FROM sales_employees WHERE code = ? AND company = ?')
                      .get(explicitCode, body.company);
        if (dup) {
          // Throw to abort the transaction; caught below and surfaced as 409.
          const err = new Error(`Sales employee ${explicitCode} already exists in ${body.company}`);
          err.statusCode = 409;
          throw err;
        }
        assignedCode = explicitCode;
      } else {
        const nextN = db.prepare(
          'SELECT COALESCE(MAX(CAST(SUBSTR(code, 2) AS INTEGER)), 0) + 1 AS next FROM sales_employees WHERE company = ?'
        ).get(body.company).next;
        // Pad to 3 digits while < 1000; widens naturally past S999.
        assignedCode = 'S' + (nextN < 1000 ? String(nextN).padStart(3, '0') : String(nextN));
      }

      const insertCols = ['code', ...cols];
      const insertVals = [assignedCode, ...values];
      const placeholders = insertCols.map(() => '?').join(', ');
      const info = db.prepare(
        `INSERT INTO sales_employees (${insertCols.join(', ')}) VALUES (${placeholders})`
      ).run(...insertVals);

      writeAudit(db, {
        recordId: info.lastInsertRowid,
        empCode: assignedCode,
        field: 'created',
        oldVal: '',
        newVal: body.name,
        user,
        actionType: codeWasExplicit ? 'create_with_explicit_code' : 'create',
        remark: codeWasExplicit
          ? `Sales employee created in ${body.company} with HR-supplied code (auto-assign bypassed)`
          : `Sales employee created in ${body.company} (code auto-assigned)`,
      });

      if (writeStructure) {
        const effectiveFrom = new Date().toISOString().slice(0, 7);
        const grossNum = Number(body.gross_salary);
        db.prepare(
          `INSERT INTO sales_salary_structures (
             employee_id, created_by, effective_from,
             basic, hra, cca, conveyance, gross_salary,
             pf_applicable, esi_applicable, pt_applicable
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          info.lastInsertRowid,
          user,
          effectiveFrom,
          Number(body.basic),
          Number(body.hra),
          Number(body.cca),
          Number(body.conveyance),
          grossNum,
          body.pf_applicable === undefined ? 0 : (body.pf_applicable ? 1 : 0),
          body.esi_applicable === undefined ? 0 : (body.esi_applicable ? 1 : 0),
          body.pt_applicable === undefined ? 0 : (body.pt_applicable ? 1 : 0),
        );
        writeAudit(db, {
          recordId: info.lastInsertRowid,
          empCode: assignedCode,
          field: 'structure_created',
          oldVal: '',
          newVal: String(grossNum),
          user,
          actionType: codeWasExplicit ? 'create_with_explicit_code' : 'create',
          remark: `Structure row inserted with effective_from=${effectiveFrom}, gross=${grossNum}`,
        });
      }

      const row = db.prepare('SELECT * FROM sales_employees WHERE id = ?').get(info.lastInsertRowid);
      return row;
    })();

    res.status(201).json({ success: true, data: result });
  } catch (e) {
    if (e && e.statusCode === 409) {
      return res.status(409).json({ success: false, error: e.message });
    }
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

// POST /api/sales/holidays — admin-only (Phase 4 fix A): writes affect total_days
// for every active sales employee in the cycle, so HR is locked out per design.
router.post('/holidays', requireAdmin, (req, res) => {
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

// PUT /api/sales/holidays/:id — admin-only (Phase 4 fix A).
// Updates holiday_name / applicable_states / is_gazetted only.
router.put('/holidays/:id', requireAdmin, (req, res) => {
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

// DELETE /api/sales/holidays/:id — admin-only (Phase 4 fix A).
// Hard delete (Phase 2; no Stage 3 refs yet). Blocked if a finalized
// salary computation already references this holiday's month.
router.delete('/holidays/:id', requireAdmin, (req, res) => {
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

// ── POST /api/sales/upload-template — Phase 2 (May 2026)
// Multipart upload (field "file") of an XLSX produced by the Phase 1
// /api/sales/template endpoint. Reuses the existing salesUpload multer
// instance: 10MB cap, .xls/.xlsx only, file-on-disk dest. The parser
// reads from disk into a Buffer and runs all 8 validation steps + the
// success persistence transaction. Gated by the file-wide
// requireHrOrAdmin (line ~1088). Existing legacy /upload endpoints below
// remain functional for Tab 2 of the UI.
router.post('/upload-template', salesUpload.single('file'), (req, res) => {
  const db = getDb();
  const uploadedBy = (req.user && req.user.username) || 'unknown';
  const file = req.file;
  if (!file) {
    return res.status(400).json({ success: false, error: 'No file uploaded (field name: file)' });
  }
  const month = parseInt(req.body.month, 10);
  const year = parseInt(req.body.year, 10);
  const company = (req.body.company || '').trim();
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    return res.status(400).json({ success: false, error: 'month must be an integer 1-12' });
  }
  if (!Number.isInteger(year) || year < 2024 || year > 2030) {
    return res.status(400).json({ success: false, error: 'year must be an integer 2024-2030' });
  }
  if (!company) {
    return res.status(400).json({ success: false, error: 'company is required' });
  }

  let buf;
  try {
    buf = fs.readFileSync(file.path);
  } catch (e) {
    console.error('[sales-upload-template] read failed:', e.message);
    return res.status(500).json({ success: false, error: 'failed to read uploaded file' });
  }

  let result;
  try {
    result = parseTemplateUpload(db, {
      fileBuffer: buf,
      month, year, company,
      uploadedBy,
      filename: file.originalname,
    });
  } catch (e) {
    console.error('[sales-upload-template] parse failed:', e.message, e.stack);
    return res.status(500).json({ success: false, error: 'template parse error' });
  }

  if (result.success) {
    return res.status(200).json(result);
  }
  return res.status(422).json(result);
});

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

  // Month / year / company resolution (Phase 4 fix D):
  //   request body (HR explicit picker) → parser auto-detect → error
  // Body wins so HR can override the parser's guess for retroactive uploads
  // or edge cases around the 25/26 cycle boundary. Falls back to parser-
  // detected values when the body is missing/invalid (preserves backward
  // compat for non-UI consumers).
  const bodyMonth = parseInt(req.body.month, 10);
  const bodyYear  = parseInt(req.body.year, 10);
  const bodyCompany = (req.body.company || '').trim();
  const month = (Number.isInteger(bodyMonth) && bodyMonth >= 1 && bodyMonth <= 12)
    ? bodyMonth
    : (parseResult.month || null);
  const year = (Number.isInteger(bodyYear) && bodyYear >= 2024 && bodyYear <= 2030)
    ? bodyYear
    : (parseResult.year || null);
  const company = bodyCompany || parseResult.company || null;
  if (!Number.isInteger(bodyMonth) || !Number.isInteger(bodyYear) || !bodyCompany) {
    console.warn(`[sales-upload] body cycle missing/invalid; falling back to parser-detected ${month}/${year} for ${company || '(unknown company)'}`);
  }

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

  // Phase 4 fix E: working-days = calendarDays − Sundays − non-Sunday gazetted
  // holidays. Same formula Phase 3 compute uses, so rows flagged here line
  // up with what the compute engine would do downstream.
  const cycle = deriveCycleE(upload.month, upload.year);
  const sundays = countSundaysE(cycle.start, cycle.end);
  const { workingDayHolidays } = countHolidaysE(db, cycle.start, cycle.end, upload.company);
  const workingDaysForCycle = cycle.lengthDays - sundays - workingDayHolidays;

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

  const bucket = { matched: [], low: [], unmatched: [], excess: [] };
  let excessCount = 0;
  for (const r of rows) {
    const resolved = r.employee_code ? {
      code: r.resolved_code, name: r.resolved_name,
      designation: r.resolved_designation, reporting_manager: r.resolved_manager,
      city_of_operation: r.resolved_city,
    } : null;
    // Strip the flattened resolved_* keys from the row
    const { resolved_code, resolved_name, resolved_designation, resolved_manager, resolved_city, ...rowOnly } = r;

    // Excess-days flag is ORTHOGONAL to the matching tier — a Matched row
    // can also appear in the Excess Days tab. Skip rows with no/zero/NaN
    // days_given (validation only triggers on a positive integer).
    const daysGiven = Number(r.sheet_days_given);
    const hasExcessDays = Number.isFinite(daysGiven) && daysGiven > 0
      && daysGiven > workingDaysForCycle;
    const excessDaysValue = hasExcessDays ? Math.max(0, daysGiven - workingDaysForCycle) : 0;

    const enriched = {
      ...rowOnly,
      resolved_employee: resolved,
      working_days_for_cycle: workingDaysForCycle,
      has_excess_days: hasExcessDays,
      excess_days_value: excessDaysValue,
    };

    if (r.match_confidence === 'low') bucket.low.push(enriched);
    else if (r.match_confidence === 'unmatched') bucket.unmatched.push(enriched);
    else bucket.matched.push(enriched); // exact / high / medium / manual

    if (hasExcessDays) {
      bucket.excess.push(enriched);
      excessCount++;
    }
  }

  const summary = {
    total_rows: rows.length,
    matched_count: bucket.matched.length,
    low_confidence_count: bucket.low.length,
    unmatched_count: bucket.unmatched.length,
    excess_days_count: excessCount,
    working_days_for_cycle: workingDaysForCycle,
    cycle_start: cycle.start,
    cycle_end: cycle.end,
  };

  res.json({ success: true, data: { upload, ...bucket, summary } });
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
// Body (optional): { excess_days_actions: [{ rowId, action, edited_days_given? }, ...] }
//   action ∈ 'accept' | 'edit' | 'reject'. Rows with has_excess_days=true that
//   are NOT in this array default to 'reject' (safe default — explicit choice
//   forced for over-payments). Phase 4 fix E.
router.post('/upload/:uploadId/confirm', (req, res) => {
  const db = getDb();
  const user = req.user?.username || 'unknown';
  const uploadId = parseInt(req.params.uploadId, 10);
  if (!uploadId) return res.status(400).json({ success: false, error: 'Invalid uploadId' });

  const upload = db.prepare('SELECT * FROM sales_uploads WHERE id = ?').get(uploadId);
  if (!upload) return res.status(404).json({ success: false, error: 'Upload not found' });

  // ── Phase 4 fix E: excess-days actions are processed FIRST, BEFORE the
  // unmatched-block guard, so HR can use 'reject' to drop doubly-broken
  // rows (excess days AND unmatched) and still confirm the rest.
  const cycle = deriveCycleE(upload.month, upload.year);
  const sundays = countSundaysE(cycle.start, cycle.end);
  const { workingDayHolidays } = countHolidaysE(db, cycle.start, cycle.end, upload.company);
  const workingDaysForCycle = cycle.lengthDays - sundays - workingDayHolidays;

  // Map of {rowId → action} from request body.
  const reqActions = Array.isArray(req.body?.excess_days_actions) ? req.body.excess_days_actions : [];
  const actionByRowId = new Map();
  for (const a of reqActions) {
    const rid = parseInt(a?.rowId, 10);
    const act = String(a?.action || '').toLowerCase();
    if (rid && ['accept', 'edit', 'reject'].includes(act)) {
      actionByRowId.set(rid, { action: act, edited: a?.edited_days_given });
    }
  }

  // All rows currently in this upload that have excess days. We re-derive
  // here (not from request body) so the source of truth is always the DB.
  const excessRows = db.prepare(`
    SELECT id, employee_code, sheet_employee_name, sheet_city,
           sheet_reporting_manager, sheet_days_given, match_confidence
      FROM sales_monthly_input
     WHERE upload_id = ?
       AND sheet_days_given IS NOT NULL
       AND CAST(sheet_days_given AS REAL) > ?
  `).all(uploadId, workingDaysForCycle);

  const excessSummary = { accepted: 0, edited: 0, rejected: 0, defaulted_rejects: 0 };

  // Process excess actions inside a single transaction so partial failure
  // doesn't half-mutate the upload.
  const processExcess = db.transaction(() => {
    for (const er of excessRows) {
      const explicit = actionByRowId.get(er.id);
      const action = explicit?.action || 'reject';
      const source = explicit ? 'ui_explicit' : 'default_auto';

      // Forensic snapshot — captures full row contents so the deletion is
      // recoverable from audit_log alone (per fix E hard requirement).
      const snapshot = JSON.stringify({
        rowId: er.id,
        sheet_employee_name: er.sheet_employee_name,
        sheet_days_given: er.sheet_days_given,
        sheet_city: er.sheet_city,
        sheet_reporting_manager: er.sheet_reporting_manager,
        match_confidence: er.match_confidence,
        employee_code: er.employee_code,
        working_days_for_cycle: workingDaysForCycle,
      });

      if (action === 'accept') {
        excessSummary.accepted++;
        const newVal = JSON.stringify({ action: 'accept', source, edited_days: null });
        writeAuditP2(db, 'sales_monthly_input', {
          recordId: er.id, field: 'excess_days_action',
          oldVal: snapshot, newVal,
          user, actionType: 'excess_days_accept',
          remark: `[source: ${source}] Accepted excess days_given=${er.sheet_days_given} > working=${workingDaysForCycle} for ${er.sheet_employee_name || er.employee_code}`,
          empCode: er.employee_code,
        });
      } else if (action === 'edit') {
        const editedRaw = Number(explicit?.edited);
        if (!Number.isFinite(editedRaw) || editedRaw <= 0 || editedRaw > workingDaysForCycle) {
          throw new Error(`Row ${er.id}: edited_days_given must be a positive number ≤ working_days (${workingDaysForCycle}); got ${explicit?.edited}`);
        }
        const editedDays = Math.round(editedRaw * 100) / 100;
        db.prepare('UPDATE sales_monthly_input SET sheet_days_given = ? WHERE id = ?')
          .run(editedDays, er.id);
        excessSummary.edited++;
        const newVal = JSON.stringify({ action: 'edit', source, edited_days: editedDays });
        writeAuditP2(db, 'sales_monthly_input', {
          recordId: er.id, field: 'sheet_days_given',
          oldVal: snapshot, newVal,
          user, actionType: 'excess_days_edit',
          remark: `[source: ${source}] Edited days_given ${er.sheet_days_given} → ${editedDays} (working=${workingDaysForCycle}) for ${er.sheet_employee_name || er.employee_code}`,
          empCode: er.employee_code,
        });
      } else { // reject (explicit or defaulted)
        db.prepare('DELETE FROM sales_monthly_input WHERE id = ?').run(er.id);
        excessSummary.rejected++;
        if (source === 'default_auto') excessSummary.defaulted_rejects++;
        const newVal = JSON.stringify({ action: 'reject', source, edited_days: null });
        writeAuditP2(db, 'sales_monthly_input', {
          recordId: er.id, field: 'excess_days_action',
          oldVal: snapshot, newVal,
          user, actionType: 'excess_days_reject',
          remark: `[source: ${source}] Rejected (DELETED) row days_given=${er.sheet_days_given} > working=${workingDaysForCycle} for ${er.sheet_employee_name || er.employee_code}; full row in old_value`,
          empCode: er.employee_code,
        });
      }
    }
    // Refresh upload row counts to reflect reject-deletions.
    const counts = db.prepare(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN employee_code IS NOT NULL THEN 1 ELSE 0 END) AS matched,
        SUM(CASE WHEN employee_code IS NULL     THEN 1 ELSE 0 END) AS unmatched
      FROM sales_monthly_input WHERE upload_id = ?
    `).get(uploadId);
    db.prepare(`
      UPDATE sales_uploads
         SET total_rows = ?, matched_rows = ?, unmatched_rows = ?
       WHERE id = ?
    `).run(counts.total || 0, counts.matched || 0, counts.unmatched || 0, uploadId);
  });

  try { processExcess(); }
  catch (e) {
    return res.status(400).json({ success: false, error: e.message });
  }

  // ── Existing unmatched-block guard runs AFTER excess processing ──
  const stillUnmatched = db.prepare(`
    SELECT COUNT(*) AS c FROM sales_monthly_input WHERE upload_id = ? AND employee_code IS NULL
  `).get(uploadId).c;

  if (stillUnmatched > 0) {
    return res.status(400).json({
      success: false,
      error: `Cannot confirm — ${stillUnmatched} row(s) are still unmatched. Resolve every Low / Unmatched row first.`,
      data: { unmatchedCount: stillUnmatched, excessProcessed: excessSummary },
    });
  }

  db.prepare("UPDATE sales_uploads SET status = 'matched' WHERE id = ?").run(uploadId);

  writeAuditP2(db, 'sales_uploads', {
    recordId: uploadId, field: 'status', oldVal: upload.status, newVal: 'matched',
    user, actionType: 'confirm',
    remark: `Sales upload #${uploadId} matches confirmed; excess-days summary: ${JSON.stringify(excessSummary)}`,
  });

  const updated = db.prepare('SELECT * FROM sales_uploads WHERE id = ?').get(uploadId);
  res.json({
    success: true,
    data: updated,
    excess_days_summary: excessSummary,
    message: 'Matches confirmed; ready for Phase 3 compute.',
  });
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

// ── GET /api/sales/compute/readiness ────────────────────────────────
// Pre-compute readiness check. Surfaces master-data gaps that will
// cause compute to skip employees or downstream exports to exclude
// them. Read-only; no side effects. Compute is NOT gated by this —
// the banner is informational, HR's call to proceed.
router.get('/compute/readiness', (req, res) => {
  const month = parseInt(req.query.month, 10);
  const year  = parseInt(req.query.year, 10);
  const company = (req.query.company || '').trim();

  if (!month || month < 1 || month > 12 ||
      !year  || year  < 2020 || year > 2100 ||
      !company) {
    return res.status(400).json({
      success: false,
      error: 'month, year, and company query params are required',
    });
  }

  try {
    const db = getDb();

    const employees = db.prepare(`
      SELECT id, code, name, city_of_operation AS city,
             gross_salary, ta_da_class,
             da_rate, da_outstation_rate,
             ta_rate_primary, ta_rate_secondary,
             bank_name, account_no, ifsc,
             pf_applicable, pt_applicable, state
        FROM sales_employees
       WHERE company = ? AND status = 'Active'
       ORDER BY name ASC
    `).all(company);

    const uploadCount = db.prepare(`
      SELECT COUNT(*) AS cnt FROM sales_monthly_input
       WHERE month = ? AND year = ? AND company = ?
    `).get(month, year, company).cnt;

    const inUpload = new Set(db.prepare(`
      SELECT DISTINCT employee_code FROM sales_monthly_input
       WHERE month = ? AND year = ? AND company = ?
    `).all(month, year, company).map(r => r.employee_code));

    // Pending TA/DA changes — scoped to this company via JOIN
    // (sales_ta_da_change_requests has no company column of its own).
    const pendingTaDa = new Set(db.prepare(`
      SELECT DISTINCT r.employee_code
        FROM sales_ta_da_change_requests r
        JOIN sales_employees e ON e.id = r.employee_id
       WHERE r.status = 'pending' AND e.company = ?
    `).all(company).map(r => r.employee_code));

    const issues = [];
    let okCount = 0;

    for (const e of employees) {
      const empIssues = [];

      // BLOCKERS — compute will skip these or produce zero output
      if (e.ta_da_class === null || e.ta_da_class === undefined) {
        empIssues.push({
          severity: 'warning',
          reason_code: 'NO_TADA_CLASS',
          reason_label: 'No TA/DA class assigned — TA/DA register will show flag_for_review; salary unaffected',
        });
      } else if (e.ta_da_class === 0) {
        empIssues.push({
          severity: 'warning',
          reason_code: 'FLAG_FOR_REVIEW',
          reason_label: 'TA/DA class set to 0 (flag for review) — TA/DA register will show flag_for_review; salary unaffected',
        });
      } else {
        const cls = e.ta_da_class;
        const rateMissing =
          (cls === 1 && !e.da_rate) ||
          (cls === 2 && (!e.da_rate || !e.da_outstation_rate)) ||
          (cls === 3 && (!e.da_rate || !e.ta_rate_primary)) ||
          (cls === 4 && (!e.da_rate || !e.da_outstation_rate || !e.ta_rate_primary)) ||
          (cls === 5 && (!e.da_rate || !e.da_outstation_rate || !e.ta_rate_primary || !e.ta_rate_secondary));
        if (rateMissing) {
          empIssues.push({
            severity: 'warning',
            reason_code: 'RATES_MISSING',
            reason_label: `Class ${cls} rates incomplete in master — TA/DA will compute partial; salary unaffected`,
          });
        }
      }

      if (!e.gross_salary || e.gross_salary === 0) {
        empIssues.push({
          severity: 'blocker',
          reason_code: 'NO_SALARY',
          reason_label: 'No gross salary set in master',
        });
      }

      // WARNINGS — compute runs, but downstream may exclude / be incomplete
      if (uploadCount > 0 && !inUpload.has(e.code)) {
        empIssues.push({
          severity: 'warning',
          reason_code: 'EMPLOYEE_NOT_IN_UPLOAD',
          reason_label: 'Not present in coordinator upload for this cycle',
        });
      }

      if (!e.bank_name || !e.account_no || !e.ifsc) {
        empIssues.push({
          severity: 'warning',
          reason_code: 'BANK_INCOMPLETE',
          reason_label: 'Bank details incomplete — will be excluded from NEFT',
        });
      }

      if (e.pt_applicable === 1 && (!e.state || String(e.state).trim() === '')) {
        empIssues.push({
          severity: 'warning',
          reason_code: 'PT_NO_STATE',
          reason_label: 'PT applicable but state is empty',
        });
      }

      if (pendingTaDa.has(e.code)) {
        empIssues.push({
          severity: 'warning',
          reason_code: 'PENDING_TADA_REQUEST',
          reason_label: 'Has a pending TA/DA change request',
        });
      }

      if (empIssues.length === 0) {
        okCount++;
      } else {
        for (const issue of empIssues) {
          issues.push({
            code: e.code,
            name: e.name,
            city: e.city,
            ta_da_class: e.ta_da_class,
            ...issue,
          });
        }
      }
    }

    const cycleWarnings = [];
    if (uploadCount === 0 && employees.length > 0) {
      cycleWarnings.push({
        severity: 'warning',
        reason_code: 'NO_ATTENDANCE_UPLOADED',
        reason_label: 'No coordinator upload found for this cycle yet',
      });
    }

    const blockerCount = issues.filter(i => i.severity === 'blocker').length;
    const warningCount = issues.filter(i => i.severity === 'warning').length
                       + cycleWarnings.length;

    res.json({
      success: true,
      data: {
        month, year, company,
        summary: {
          blockers: blockerCount,
          warnings: warningCount,
          ok: okCount,
          total: employees.length,
        },
        cycle_warnings: cycleWarnings,
        issues,
      },
    });
  } catch (e) {
    console.error('[sales/compute/readiness]', e?.stack || e);
    res.status(500).json({ success: false, error: e?.message || 'readiness check failed' });
  }
});

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

  // Phase α auto-trigger — runs OUTSIDE the per-employee salary txn loop.
  // Failure here logs but never fails the salary response.
  let taDaSummary = null;
  try {
    taDaSummary = taDaCompute.recomputeCycle(db, {
      month, year, company,
      cycleStart, cycleEnd,
      computedBy: user,
      requestId: req.requestId,
      triggerSource: 'auto:salary_compute',
    });
  } catch (taDaErr) {
    console.error(`[sales-tada-auto] ${month}/${year} ${company}: ${taDaErr.message}`);
    if (taDaErr.stack) console.error(taDaErr.stack.split('\n').slice(0, 5).join('\n'));
    taDaSummary = { error: taDaErr.message };
  }

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
    taDaSummary,
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
