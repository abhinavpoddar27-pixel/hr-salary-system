const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { getDb } = require('../database/db');
const { requireHrOrAdmin } = require('../middleware/roles');

// ── Salary structure sync helper ──────────────────────────────────
// Single source of truth for keeping `salary_structures` in sync with
// `employees.gross_salary` + statutory flags. Use this from EVERY code
// path that writes employees.gross_salary / pf_applicable / esi_applicable
// / pt_applicable so the pipeline's "same gross in two places" invariant
// cannot silently drift again (see employee 60052 bug, April 2026).
//
// Key properties:
//   - Uses the EXISTING basic_percent / hra_percent / da_percent from the
//     latest salary_structure (no hardcoded 50/20 fallback that trashes real
//     ratios). Only falls back to 50/20/0 if no structure exists.
//   - Scales ALL monetary components (basic, da, hra, conveyance,
//     special_allowance, other_allowances) proportionally so their sum
//     tracks the new gross — never leaves stale da/conv/other values.
//   - Propagates pf_applicable / esi_applicable / pt_applicable when
//     explicitly provided (so the employees table and salary_structures
//     agree on eligibility flags).
//   - Creates a salary_structures row if none exists.
//   - No-op if gross is 0 or null AND no flag updates requested.
//
// Call with: syncSalaryStructureFromEmployee(db, employeeId, {
//   gross_salary, pf_applicable, esi_applicable, pt_applicable
// }).
function syncSalaryStructureFromEmployee(db, employeeId, updates = {}) {
  if (!employeeId) return { synced: false, reason: 'no employee id' };

  const hasGrossUpdate = updates.gross_salary !== undefined && updates.gross_salary !== null;
  const gross = hasGrossUpdate ? parseFloat(updates.gross_salary) || 0 : null;

  const hasPfUpdate = updates.pf_applicable !== undefined;
  const hasEsiUpdate = updates.esi_applicable !== undefined;
  const hasPtUpdate = updates.pt_applicable !== undefined;

  // Nothing to sync
  if (!hasGrossUpdate && !hasPfUpdate && !hasEsiUpdate && !hasPtUpdate) {
    return { synced: false, reason: 'no tracked fields in update' };
  }

  const existing = db.prepare(
    'SELECT * FROM salary_structures WHERE employee_id = ? ORDER BY effective_from DESC LIMIT 1'
  ).get(employeeId);

  // Pull employee fallback for flags if caller didn't supply one
  const emp = db.prepare('SELECT gross_salary, pf_applicable, esi_applicable, pt_applicable FROM employees WHERE id = ?').get(employeeId);
  if (!emp) return { synced: false, reason: 'employee not found' };

  const resolvedGross = hasGrossUpdate ? gross : (existing?.gross_salary || emp.gross_salary || 0);
  const pfApp = hasPfUpdate ? (updates.pf_applicable ? 1 : 0) : (existing?.pf_applicable ?? emp.pf_applicable ?? 0);
  const esiApp = hasEsiUpdate ? (updates.esi_applicable ? 1 : 0) : (existing?.esi_applicable ?? emp.esi_applicable ?? 0);
  const ptApp = hasPtUpdate ? (updates.pt_applicable ? 1 : 0) : (existing?.pt_applicable ?? emp.pt_applicable ?? 1);

  if (existing) {
    // Preserve existing ratios. Prefer percent columns when present; fall
    // back to deriving from current component amounts so an employee whose
    // struct has da=₹5000, basic=₹10k etc. keeps the same split after a
    // gross bump.
    const prevGross = existing.gross_salary || 0;
    let basicPct = existing.basic_percent;
    let hraPct = existing.hra_percent;
    let daPct = existing.da_percent;

    const rawSum = (existing.basic || 0) + (existing.da || 0) + (existing.hra || 0)
                 + (existing.conveyance || 0) + (existing.special_allowance || 0) + (existing.other_allowances || 0);

    let basic, da, hra, conveyance, specialAllow, otherAllow;

    if (hasGrossUpdate && resolvedGross > 0 && rawSum > 0 && prevGross > 0) {
      // Proportional scale all components by new/old gross ratio — this
      // keeps da, conveyance, special_allowance, other_allowances in sync
      // too, not just basic/hra.
      const scale = resolvedGross / prevGross;
      basic = Math.round((existing.basic || 0) * scale * 100) / 100;
      da = Math.round((existing.da || 0) * scale * 100) / 100;
      hra = Math.round((existing.hra || 0) * scale * 100) / 100;
      conveyance = Math.round((existing.conveyance || 0) * scale * 100) / 100;
      specialAllow = Math.round((existing.special_allowance || 0) * scale * 100) / 100;
      otherAllow = Math.round((existing.other_allowances || 0) * scale * 100) / 100;
      // Refresh percent columns to match (keeps display consistent).
      basicPct = resolvedGross > 0 ? Math.round(basic / resolvedGross * 10000) / 100 : basicPct;
      hraPct = resolvedGross > 0 ? Math.round(hra / resolvedGross * 10000) / 100 : hraPct;
      daPct = resolvedGross > 0 ? Math.round(da / resolvedGross * 10000) / 100 : daPct;
    } else if (hasGrossUpdate && resolvedGross > 0) {
      // No usable existing breakdown — fall back to percent-based derivation
      // using whatever percents were on the row (or sensible defaults).
      basicPct = basicPct || 50;
      hraPct = hraPct || 20;
      daPct = daPct || 0;
      basic = Math.round(resolvedGross * basicPct / 100 * 100) / 100;
      hra = Math.round(resolvedGross * hraPct / 100 * 100) / 100;
      da = Math.round(resolvedGross * daPct / 100 * 100) / 100;
      conveyance = existing.conveyance || 0;
      specialAllow = existing.special_allowance || 0;
      otherAllow = Math.max(0, Math.round((resolvedGross - basic - hra - da - conveyance - specialAllow) * 100) / 100);
    } else {
      // Only flag updates — leave amounts alone.
      basic = existing.basic || 0;
      da = existing.da || 0;
      hra = existing.hra || 0;
      conveyance = existing.conveyance || 0;
      specialAllow = existing.special_allowance || 0;
      otherAllow = existing.other_allowances || 0;
    }

    db.prepare(`UPDATE salary_structures SET
        gross_salary = ?, basic = ?, da = ?, hra = ?, conveyance = ?,
        special_allowance = ?, other_allowances = ?,
        basic_percent = ?, hra_percent = ?, da_percent = ?,
        pf_applicable = ?, esi_applicable = ?, pt_applicable = ?,
        updated_at = datetime('now')
      WHERE id = ?`).run(
        resolvedGross, basic, da, hra, conveyance, specialAllow, otherAllow,
        basicPct || 50, hraPct || 20, daPct || 0,
        pfApp, esiApp, ptApp,
        existing.id
      );
    return { synced: true, action: 'updated', id: existing.id, gross: resolvedGross };
  }

  // No existing structure — create one. Only create if we have a usable gross.
  if (resolvedGross <= 0) return { synced: false, reason: 'no existing structure and gross is 0' };

  const basicPct = 50;
  const hraPct = 20;
  const basic = Math.round(resolvedGross * basicPct / 100 * 100) / 100;
  const hra = Math.round(resolvedGross * hraPct / 100 * 100) / 100;
  const result = db.prepare(`INSERT INTO salary_structures
      (employee_id, effective_from, gross_salary, basic, da, hra, conveyance, special_allowance, other_allowances,
       basic_percent, hra_percent, da_percent, pf_applicable, esi_applicable, pt_applicable, pf_wage_ceiling)
      VALUES (?, '2025-01-01', ?, ?, 0, ?, 0, 0, 0, ?, ?, 0, ?, ?, ?, 15000)`).run(
        employeeId, resolvedGross, basic, hra, basicPct, hraPct, pfApp, esiApp, ptApp
      );
  return { synced: true, action: 'created', id: result.lastInsertRowid, gross: resolvedGross };
}

// Document upload directory
const DOCS_DIR = process.env.DOCS_DIR || path.join(__dirname, '..', '..', 'uploads', 'documents');
if (!fs.existsSync(DOCS_DIR)) fs.mkdirSync(DOCS_DIR, { recursive: true });

const docUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const empDir = path.join(DOCS_DIR, req.params.code);
      if (!fs.existsSync(empDir)) fs.mkdirSync(empDir, { recursive: true });
      cb(null, empDir);
    },
    filename: (req, file, cb) => {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E3);
      cb(null, uniqueSuffix + '-' + file.originalname);
    }
  }),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowed = ['.pdf', '.jpg', '.jpeg', '.png', '.doc', '.docx', '.xls', '.xlsx'];
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, allowed.includes(ext));
  }
});

// GET all employees
router.get('/', (req, res) => {
  const db = getDb();
  const { department, company, status, search, page, limit, sort, order } = req.query;

  let where = 'WHERE 1=1';
  const params = [];

  if (department) { where += ' AND e.department = ?'; params.push(department); }
  if (company) { where += ' AND e.company = ?'; params.push(company); }
  if (status) { where += ' AND e.status = ?'; params.push(status); }
  if (search) { where += ' AND (e.name LIKE ? OR e.code LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }

  // IMPORTANT: Do NOT alias `ss.gross_salary` / `ss.pf_applicable` etc. as
  // their bare names — they would shadow `e.gross_salary` / `e.pf_applicable`
  // in better-sqlite3's result row (last column wins on name collision) and
  // silently make the list view read stale salary_structures values. Expose
  // the struct values under `struct_*` aliases so UI can still drill into
  // them, and keep `e.*` fields as the authoritative display source.
  const baseQuery = `SELECT e.*, s.name as shift_name,
    ss.gross_salary AS struct_gross_salary,
    ss.basic_percent, ss.hra_percent, ss.da_percent,
    ss.pf_applicable AS struct_pf_applicable,
    ss.esi_applicable AS struct_esi_applicable,
    ss.pt_applicable AS struct_pt_applicable,
    ss.pf_wage_ceiling,
    lp.last_present_date
    FROM employees e
    LEFT JOIN shifts s ON e.default_shift_id = s.id
    LEFT JOIN salary_structures ss ON ss.employee_id = e.id AND ss.id = (
      SELECT id FROM salary_structures WHERE employee_id = e.id ORDER BY effective_from DESC LIMIT 1
    )
    LEFT JOIN (
      SELECT employee_code, MAX(date) as last_present_date
      FROM attendance_processed
      WHERE status_final IN ('P', '½P', 'WOP', 'WO½P', 'HP', 'ED')
      GROUP BY employee_code
    ) lp ON lp.employee_code = e.code
    ${where}`;

  // If no page param, return all (backward compatible)
  if (!page) {
    const employees = db.prepare(baseQuery + ' ORDER BY e.department, e.name').all(...params);
    return res.json({ success: true, data: employees });
  }

  const { paginateQuery } = require('../utils/pagination');
  const countQuery = `SELECT COUNT(*) as cnt FROM employees e ${where}`;
  // Whitelist sortable columns to avoid SQL "no such column: e." errors when
  // an unknown or empty sort field is passed in.
  const SORTABLE = new Set(['code','name','department','designation','company','status','date_of_joining','date_of_exit','gross_salary']);
  const sortCol = sort === 'last_present_date' ? 'lp.last_present_date'
    : (sort && SORTABLE.has(sort)) ? `e.${sort}` : 'e.department, e.name';
  const result = paginateQuery(db, {
    baseQuery: baseQuery + ` ORDER BY ${sortCol} ${order === 'desc' ? 'DESC' : 'ASC'}`,
    countQuery, params, page, limit
  });
  // Override the double-sort: paginateQuery adds LIMIT/OFFSET after
  // Since we already sorted in baseQuery, use a simpler approach
  const pageNum = Math.max(1, parseInt(page) || 1);
  const pageSize = Math.min(200, Math.max(1, parseInt(limit) || 50));
  const totalRow = db.prepare(countQuery).get(...params);
  const total = totalRow?.cnt || 0;
  const offset = (pageNum - 1) * pageSize;
  const data = db.prepare(baseQuery + ` ORDER BY ${sortCol} ${order === 'desc' ? 'DESC' : 'ASC'} LIMIT ? OFFSET ?`).all(...params, pageSize, offset);

  res.json({ success: true, data, total, page: pageNum, pageSize, totalPages: Math.ceil(total / pageSize) });
});

// GET all distinct departments (declared BEFORE /:code to avoid param capture)
router.get('/departments', (req, res) => {
  const db = getDb();
  const depts = db.prepare(
    "SELECT DISTINCT department FROM employees WHERE department IS NOT NULL AND department != '' ORDER BY department"
  ).all();
  res.json({ success: true, departments: depts.map(d => d.department) });
});

// GET single employee
router.get('/:code', (req, res) => {
  const db = getDb();
  const emp = db.prepare('SELECT * FROM employees WHERE code = ?').get(req.params.code);
  if (!emp) return res.status(404).json({ success: false, error: 'Employee not found' });

  let salaryStruct = db.prepare('SELECT * FROM salary_structures WHERE employee_id = ? ORDER BY effective_from DESC LIMIT 1').get(emp.id);

  // ── Self-healing sync: if employees.gross_salary disagrees with
  // salary_structures.gross_salary (by more than a rounding epsilon), treat
  // `employees` as authoritative and repair the structure in place. Also
  // auto-creates a structure if none exists. This is the safety net for
  // legacy desync rows that pre-date the helper being wired into every
  // write path (see employee 60052, April 2026).
  const empGross = parseFloat(emp.gross_salary) || 0;
  const structGross = salaryStruct ? (parseFloat(salaryStruct.gross_salary) || 0) : 0;
  const needsRepair = empGross > 0 && Math.abs(empGross - structGross) > 1;

  if (!salaryStruct && empGross > 0) {
    syncSalaryStructureFromEmployee(db, emp.id, { gross_salary: empGross });
    salaryStruct = db.prepare('SELECT * FROM salary_structures WHERE employee_id = ? ORDER BY effective_from DESC LIMIT 1').get(emp.id);
  } else if (needsRepair) {
    console.log(`[SALARY-SYNC] Repairing ${emp.code}: employees.gross=${empGross} != salary_structures.gross=${structGross}`);
    syncSalaryStructureFromEmployee(db, emp.id, { gross_salary: empGross });
    salaryStruct = db.prepare('SELECT * FROM salary_structures WHERE employee_id = ? ORDER BY effective_from DESC LIMIT 1').get(emp.id);
  }

  const leaveBalances = db.prepare('SELECT * FROM leave_balances WHERE employee_id = ? AND year = ?').all(emp.id, new Date().getFullYear());

  res.json({ success: true, data: { ...emp, salaryStructure: salaryStruct, leaveBalances } });
});

// CREATE employee
router.post('/', (req, res) => {
  const db = getDb();
  const { code, name, fatherName, dob, gender, department, designation, company, employmentType, contractorGroup, dateOfJoining, defaultShiftId, bankAccount, ifsc, bankName, pfNumber, uan, esiNumber, basic, da, hra, conveyance, otherAllowances } = req.body;

  if (!code || !name) return res.status(400).json({ success: false, error: 'code and name are required' });

  const existing = db.prepare('SELECT id FROM employees WHERE code = ?').get(code);
  if (existing) return res.status(400).json({ success: false, error: 'Employee code already exists' });

  const result = db.prepare(`
    INSERT INTO employees (code, name, father_name, dob, gender, department, designation, company, employment_type, contractor_group, date_of_joining, default_shift_id, bank_account, ifsc, bank_name, pf_number, uan, esi_number, status, is_data_complete)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Active', 1)
  `).run(code, name, fatherName, dob, gender, department, designation, company, employmentType || 'Permanent', contractorGroup, dateOfJoining, defaultShiftId, bankAccount, ifsc, bankName, pfNumber, uan, esiNumber);

  const empId = result.lastInsertRowid;

  // Insert salary structure if provided
  if (basic > 0) {
    db.prepare(`INSERT INTO salary_structures (employee_id, effective_from, basic, da, hra, conveyance, other_allowances) VALUES (?, date('now'), ?, ?, ?, ?, ?)`).run(empId, basic || 0, da || 0, hra || 0, conveyance || 0, otherAllowances || 0);
  }

  // Initialize leave balances for current year (CL + EL only — SL abolished Apr 2026)
  const year = new Date().getFullYear();
  for (const type of ['CL', 'EL']) {
    db.prepare('INSERT OR IGNORE INTO leave_balances (employee_id, year, leave_type, opening, balance) VALUES (?, ?, ?, ?, ?)').run(empId, year, type, type === 'CL' ? 12 : 0, type === 'CL' ? 12 : 0);
  }

  res.json({ success: true, id: empId, message: 'Employee created' });
});

/**
 * PUT /api/employees/bulk-shift
 * Late Coming Phase 1: Bulk-assign a shift to multiple employees.
 * Restricted to HR + admin. Logs one audit_log row per changed employee.
 *
 * NOTE: Must be declared BEFORE `PUT /:code` so Express does not treat
 * "bulk-shift" as an employee code param.
 */
router.put('/bulk-shift', (req, res) => {
  if (req.user?.role !== 'admin' && req.user?.role !== 'hr') {
    return res.status(403).json({ success: false, error: 'HR or admin access required' });
  }
  const db = getDb();
  const { employeeCodes, shiftId, shiftCode } = req.body;
  if (!Array.isArray(employeeCodes) || !employeeCodes.length) {
    return res.status(400).json({ success: false, error: 'employeeCodes array required' });
  }
  if (!shiftId) {
    return res.status(400).json({ success: false, error: 'shiftId required' });
  }

  const shift = db.prepare('SELECT id, code FROM shifts WHERE id = ?').get(shiftId);
  if (!shift) return res.status(404).json({ success: false, error: 'Shift not found' });

  const effectiveShiftCode = shiftCode || shift.code;
  const selectEmp = db.prepare('SELECT id, code, default_shift_id, shift_code FROM employees WHERE code = ?');
  const updateStmt = db.prepare(
    "UPDATE employees SET default_shift_id = ?, shift_code = ?, updated_at = datetime('now') WHERE code = ?"
  );
  const auditStmt = db.prepare(`
    INSERT INTO audit_log (table_name, record_id, field_name, old_value, new_value, changed_by, stage, remark, employee_code, action_type)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let updated = 0;
  const username = req.user?.username || 'unknown';
  const txn = db.transaction(() => {
    for (const code of employeeCodes) {
      const emp = selectEmp.get(code);
      if (!emp) continue;
      const prevCode = emp.shift_code || '';
      updateStmt.run(shift.id, effectiveShiftCode, code);
      updated++;
      try {
        auditStmt.run(
          'employees', emp.id, 'shift_assignment',
          prevCode, effectiveShiftCode,
          username,
          'employee_master',
          `Bulk shift change from ${prevCode || '(none)'} to ${effectiveShiftCode}`,
          code,
          'shift_change'
        );
      } catch (e) { /* audit should not block bulk update */ }
    }
  });
  txn();

  res.json({ success: true, updated });
});

// UPDATE employee
router.put('/:code', (req, res) => {
  const db = getDb();
  const { code } = req.params;
  const updates = req.body;

  const emp = db.prepare('SELECT * FROM employees WHERE code = ?').get(code);
  if (!emp) return res.status(404).json({ success: false, error: 'Employee not found' });

  const allowedFields = [
    'name', 'father_name', 'dob', 'gender', 'department', 'designation', 'company',
    'employment_type', 'contractor_group', 'date_of_joining', 'date_of_exit', 'exit_reason',
    'default_shift_id', 'shift_code', 'weekly_off_day',
    'bank_account', 'account_number', 'ifsc', 'ifsc_code', 'bank_name',
    'pf_number', 'uan', 'esi_number', 'aadhar', 'pan', 'phone', 'email',
    'gross_salary', 'status', 'is_data_complete', 'is_contractor',
    // Statutory flags — must also propagate into salary_structures via
    // syncSalaryStructureFromEmployee() below so computations agree.
    'pf_applicable', 'esi_applicable', 'pt_applicable',
    // Enhanced fields
    'blood_group', 'emergency_contact_name', 'emergency_contact_phone',
    'address_current', 'address_permanent', 'marital_status', 'spouse_name',
    'qualification', 'experience_years', 'previous_employer',
    'probation_end_date', 'confirmation_date', 'category', 'notes'
  ];

  const setClauses = [];
  const params = [];

  for (const field of allowedFields) {
    if (updates[field] !== undefined) {
      setClauses.push(`${field} = ?`);
      params.push(updates[field]);
    }
  }

  // ── Auto-sync is_contractor when employment_type changes ──
  // If the user sets employment_type via the Edit form, derive is_contractor
  // from it so all downstream code (payroll, analytics, MIS, payslip PDF)
  // stays consistent. Without this, a stale is_contractor=1 set by the
  // March 2026 migration would keep firing even after HR corrects the type.
  // Only auto-sync when the caller didn't explicitly set is_contractor itself.
  if (updates.employment_type !== undefined && updates.is_contractor === undefined) {
    const newType = String(updates.employment_type || '').trim().toLowerCase();
    const shouldBeContractor = newType.includes('contract') ? 1 : 0;
    setClauses.push('is_contractor = ?');
    params.push(shouldBeContractor);
  }

  if (setClauses.length === 0) return res.json({ success: true, message: 'No updates' });

  // ── Late Coming Phase 1: Audit trail for shift assignment changes ──
  // When an HR user changes an employee's shift via the Employee Master form,
  // record the old/new shift codes so auditors can trace why an employee's
  // punctuality metrics suddenly shifted (pun intended). Uses the direct SQL
  // insert so we can stamp the actual username from req.user.
  if (updates.default_shift_id !== undefined && updates.default_shift_id !== emp.default_shift_id) {
    try {
      const oldShiftCode = emp.shift_code || (emp.default_shift_id
        ? (db.prepare('SELECT code FROM shifts WHERE id = ?').get(emp.default_shift_id)?.code || '')
        : '');
      const newShiftCode = updates.shift_code || (updates.default_shift_id
        ? (db.prepare('SELECT code FROM shifts WHERE id = ?').get(updates.default_shift_id)?.code || '')
        : '');
      db.prepare(`
        INSERT INTO audit_log (table_name, record_id, field_name, old_value, new_value, changed_by, stage, remark, employee_code, action_type)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        'employees', emp.id, 'shift_assignment',
        oldShiftCode, newShiftCode,
        req.user?.username || 'unknown',
        'employee_master',
        `Shift changed from ${oldShiftCode || '(none)'} to ${newShiftCode || '(none)'}`,
        emp.code,
        'shift_change'
      );
    } catch (e) { /* audit should not break updates */ }
  }

  setClauses.push("updated_at = datetime('now')");
  params.push(code);

  db.prepare(`UPDATE employees SET ${setClauses.join(', ')} WHERE code = ?`).run(...params);

  // ── Sync salary_structures whenever gross_salary or any statutory flag
  // changes via this generic PUT. Prevents the employees↔salary_structures
  // desync that was silently overwriting Stage 7 with stale values
  // (see employee 60052 bug, April 2026). Uses existing percentages —
  // never hardcodes 50/20 that would trash custom ratios.
  if (updates.gross_salary !== undefined
      || updates.pf_applicable !== undefined
      || updates.esi_applicable !== undefined
      || updates.pt_applicable !== undefined) {
    syncSalaryStructureFromEmployee(db, emp.id, {
      gross_salary: updates.gross_salary,
      pf_applicable: updates.pf_applicable,
      esi_applicable: updates.esi_applicable,
      pt_applicable: updates.pt_applicable
    });
  }

  // Update salary structure if provided
  if (updates.basic !== undefined || updates.da !== undefined) {
    const existing = db.prepare('SELECT id FROM salary_structures WHERE employee_id = ? ORDER BY effective_from DESC LIMIT 1').get(emp.id);
    if (existing) {
      db.prepare('UPDATE salary_structures SET basic = ?, da = ?, hra = ?, conveyance = ?, other_allowances = ? WHERE id = ?')
        .run(updates.basic || 0, updates.da || 0, updates.hra || 0, updates.conveyance || 0, updates.otherAllowances || 0, existing.id);
    } else {
      db.prepare('INSERT INTO salary_structures (employee_id, effective_from, basic, da, hra, conveyance, other_allowances) VALUES (?, date(\'now\'), ?, ?, ?, ?, ?)')
        .run(emp.id, updates.basic || 0, updates.da || 0, updates.hra || 0, updates.conveyance || 0, updates.otherAllowances || 0);
    }
  }

  res.json({ success: true, message: 'Employee updated' });
});

// GET leave balances
router.get('/:code/leaves', (req, res) => {
  const db = getDb();
  const emp = db.prepare('SELECT id FROM employees WHERE code = ?').get(req.params.code);
  if (!emp) return res.status(404).json({ success: false, error: 'Employee not found' });

  const year = req.query.year || new Date().getFullYear();
  const balances = db.prepare('SELECT * FROM leave_balances WHERE employee_id = ? AND year = ?').all(emp.id, year);
  res.json({ success: true, data: balances });
});

// UPDATE leave balance
router.put('/:code/leaves', (req, res) => {
  const db = getDb();
  const emp = db.prepare('SELECT id FROM employees WHERE code = ?').get(req.params.code);
  if (!emp) return res.status(404).json({ success: false, error: 'Employee not found' });

  const { year, leaveType, opening, used } = req.body;
  const balance = (parseFloat(opening) || 0) - (parseFloat(used) || 0);

  db.prepare(`
    INSERT INTO leave_balances (employee_id, year, leave_type, opening, used, balance)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(employee_id, year, leave_type) DO UPDATE SET
      opening = excluded.opening, used = excluded.used, balance = excluded.balance
  `).run(emp.id, year, leaveType, opening || 0, used || 0, balance);

  res.json({ success: true });
});

// UPDATE salary structure (dedicated endpoint)
// When gross_salary changes, route through salary_change_requests for finance approval.
// Non-salary fields (banking, statutory IDs, flags) are always applied immediately.
router.put('/:code/salary', requireHrOrAdmin, (req, res) => {
  const db = getDb();
  const emp = db.prepare('SELECT * FROM employees WHERE code = ?').get(req.params.code);
  if (!emp) return res.status(404).json({ success: false, error: 'Employee not found' });

  const {
    gross_salary, basic_percent, hra_percent, da_percent,
    special_allowance_percent, other_allowance,
    pf_applicable, esi_applicable, pt_applicable, pf_wage_ceiling,
    uan, esi_number, account_number, bank_name, ifsc_code
  } = req.body;

  const newGross = parseFloat(gross_salary) || 0;
  const currentGross = parseFloat(emp.gross_salary) || 0;

  // Always apply banking / statutory ID fields immediately (no approval needed)
  db.prepare(`UPDATE employees SET
    uan = ?, esi_number = ?, bank_account = ?, bank_name = ?, ifsc = ?,
    pf_applicable = ?, esi_applicable = ?, pt_applicable = ?,
    updated_at = datetime('now')
    WHERE code = ?`
  ).run(
    uan !== undefined ? uan || null : emp.uan,
    esi_number !== undefined ? esi_number || null : emp.esi_number,
    account_number !== undefined ? account_number || null : emp.bank_account,
    bank_name !== undefined ? bank_name || null : emp.bank_name,
    ifsc_code !== undefined ? ifsc_code || null : emp.ifsc,
    pf_applicable !== undefined ? (pf_applicable ? 1 : 0) : (emp.pf_applicable ?? 0),
    esi_applicable !== undefined ? (esi_applicable ? 1 : 0) : (emp.esi_applicable ?? 0),
    pt_applicable !== undefined ? (pt_applicable ? 1 : 0) : (emp.pt_applicable ?? 1),
    req.params.code
  );

  // Sync statutory flags to salary_structures (pf/esi/pt only — NOT gross)
  if (pf_applicable !== undefined || esi_applicable !== undefined || pt_applicable !== undefined) {
    try {
      syncSalaryStructureFromEmployee(db, emp.id, { pf_applicable, esi_applicable, pt_applicable });
    } catch (e) { /* silent */ }
  }

  // ── Gross is changing → route through finance approval ───────────────
  if (newGross > 0 && Math.abs(newGross - currentGross) > 0.01) {
    const requestedBy = req.user?.username || 'admin';

    const basicPct = parseFloat(basic_percent) || 50;
    const hraPct   = parseFloat(hra_percent)   || 20;
    const daPct    = parseFloat(da_percent)    || 0;
    const specialPct = parseFloat(special_allowance_percent) || 0;
    const otherAllow = parseFloat(other_allowance) || 0;

    const newStructure = {
      gross_salary:     newGross,
      basic:            Math.round(newGross * basicPct / 100 * 100) / 100,
      da:               Math.round(newGross * daPct    / 100 * 100) / 100,
      hra:              Math.round(newGross * hraPct   / 100 * 100) / 100,
      special_allowance: Math.round(newGross * specialPct / 100 * 100) / 100,
      other_allowances: otherAllow,
      basic_percent:    basicPct,
      hra_percent:      hraPct,
      da_percent:       daPct,
      pf_applicable:    pf_applicable !== undefined ? (pf_applicable ? 1 : 0) : (emp.pf_applicable ?? 0),
      esi_applicable:   esi_applicable !== undefined ? (esi_applicable ? 1 : 0) : (emp.esi_applicable ?? 0),
      pt_applicable:    pt_applicable !== undefined ? (pt_applicable ? 1 : 0) : (emp.pt_applicable ?? 1),
      pf_wage_ceiling:  pf_wage_ceiling || 15000
    };

    const currentStruct = db.prepare(
      'SELECT * FROM salary_structures WHERE employee_id = ? ORDER BY effective_from DESC LIMIT 1'
    ).get(emp.id);

    // Don't create duplicate pending requests for the same employee
    const existingPending = db.prepare(
      "SELECT id FROM salary_change_requests WHERE employee_code = ? AND status = 'Pending'"
    ).get(req.params.code);

    if (existingPending) {
      return res.json({
        success: true,
        pendingApproval: true,
        message: 'A salary change request is already pending finance approval for this employee.'
      });
    }

    db.prepare(`
      INSERT INTO salary_change_requests (
        employee_id, employee_code, requested_by, old_gross, new_gross,
        old_structure, new_structure, reason, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Pending')
    `).run(
      emp.id, req.params.code, requestedBy,
      currentGross, newGross,
      JSON.stringify(currentStruct || {}),
      JSON.stringify(newStructure),
      'Salary structure change via Employee Master'
    );

    return res.json({
      success: true,
      pendingApproval: true,
      message: 'Salary change submitted for finance approval. Current salary unchanged until approved.'
    });
  }

  // ── Gross is NOT changing — allow direct component/percentage updates ─
  if (newGross > 0 && Math.abs(newGross - currentGross) <= 0.01) {
    const basicPct = parseFloat(basic_percent) || 50;
    const hraPct   = parseFloat(hra_percent)   || 20;
    const daPct    = parseFloat(da_percent)    || 0;
    const specialPct = parseFloat(special_allowance_percent) || 0;
    const otherAllow = parseFloat(other_allowance) || 0;

    const basic      = Math.round(newGross * basicPct   / 100 * 100) / 100;
    const hra        = Math.round(newGross * hraPct     / 100 * 100) / 100;
    const da         = Math.round(newGross * daPct      / 100 * 100) / 100;
    const specialAllow = Math.round(newGross * specialPct / 100 * 100) / 100;

    const existing = db.prepare(
      'SELECT id FROM salary_structures WHERE employee_id = ? ORDER BY effective_from DESC LIMIT 1'
    ).get(emp.id);

    if (existing) {
      db.prepare(`UPDATE salary_structures SET
        gross_salary=?, basic=?, da=?, hra=?, special_allowance=?, other_allowances=?,
        basic_percent=?, hra_percent=?, da_percent=?,
        pf_applicable=?, esi_applicable=?, pt_applicable=?, pf_wage_ceiling=?,
        updated_at=datetime('now')
        WHERE id=?`).run(
          newGross, basic, da, hra, specialAllow, otherAllow,
          basicPct, hraPct, daPct,
          pf_applicable !== undefined ? (pf_applicable ? 1 : 0) : (emp.pf_applicable ?? 0),
          esi_applicable !== undefined ? (esi_applicable ? 1 : 0) : (emp.esi_applicable ?? 0),
          pt_applicable !== undefined ? (pt_applicable ? 1 : 0) : (emp.pt_applicable ?? 1),
          pf_wage_ceiling || 15000, existing.id
      );
    } else {
      db.prepare(`INSERT INTO salary_structures
        (employee_id, effective_from, gross_salary, basic, da, hra, special_allowance, other_allowances,
         basic_percent, hra_percent, da_percent, pf_applicable, esi_applicable, pt_applicable, pf_wage_ceiling)
        VALUES (?, '2025-01-01', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
          emp.id, newGross, basic, da, hra, specialAllow, otherAllow,
          basicPct, hraPct, daPct,
          pf_applicable !== undefined ? (pf_applicable ? 1 : 0) : 1,
          esi_applicable !== undefined ? (esi_applicable ? 1 : 0) : 1,
          pt_applicable !== undefined ? (pt_applicable ? 1 : 0) : 1,
          pf_wage_ceiling || 15000
      );
    }
  }

  res.json({ success: true, message: 'Salary structure updated' });
});

// MARK EMPLOYEE AS LEFT
router.put('/:code/mark-left', (req, res) => {
  const db = getDb();
  const { code } = req.params;
  const { date_of_leaving, reason } = req.body;
  const markedBy = req.user?.username || 'admin';

  const emp = db.prepare('SELECT * FROM employees WHERE code = ?').get(code);
  if (!emp) return res.status(404).json({ success: false, error: 'Employee not found' });
  if (emp.status === 'Left') return res.status(400).json({ success: false, error: 'Employee already marked as Left' });

  const { logAudit } = require('../database/db');

  const txn = db.transaction(() => {
    // 1. Set status = 'Left', is_active = 0, date_of_exit
    // Also set inactive_since (for reactivation cutoff) and auto_inactive = 0
    // so the import auto-detector treats this as a MANUAL mark, not a system guess.
    const exitDate = date_of_leaving || new Date().toISOString().split('T')[0];
    db.prepare(`UPDATE employees SET
        status = 'Left',
        is_data_complete = 0,
        date_of_exit = ?,
        exit_reason = ?,
        inactive_since = ?,
        auto_inactive = 0,
        updated_at = datetime('now')
      WHERE code = ?`)
      .run(exitDate, reason || '', exitDate, code);

    // 2. Close any active loans — write off or close
    const activeLoans = db.prepare("SELECT id, status FROM loans WHERE employee_code = ? AND status IN ('Active', 'Approved', 'Pending')").all(code);
    for (const loan of activeLoans) {
      db.prepare("UPDATE loans SET status = 'Closed', remarks = 'Auto-closed: employee left', updated_at = datetime('now') WHERE id = ?").run(loan.id);
      // Cancel pending repayments
      db.prepare("UPDATE loan_repayments SET status = 'Cancelled', remarks = 'Employee left' WHERE loan_id = ? AND status = 'Pending'").run(loan.id);
    }

    // 3. Audit log
    logAudit('employees', emp.id, 'status', emp.status, 'Left', 'employee_master', `Marked as Left by ${markedBy}. Reason: ${reason || 'Not specified'}. ${activeLoans.length} loans closed.`);
  });

  txn();
  res.json({ success: true, message: `Employee ${code} marked as Left. ${emp.name} removed from active roster.` });
});

// GET departments list
router.get('/meta/departments', (req, res) => {
  const db = getDb();
  const depts = db.prepare('SELECT DISTINCT department FROM employees WHERE department IS NOT NULL ORDER BY department').all();
  res.json({ success: true, data: depts.map(d => d.department) });
});

// ── Document Management ─────────────────────────────────

/**
 * GET /api/employees/:code/documents
 */
router.get('/:code/documents', (req, res) => {
  const db = getDb();
  const docs = db.prepare(`
    SELECT * FROM employee_documents WHERE employee_code = ? ORDER BY created_at DESC
  `).all(req.params.code);
  res.json({ success: true, data: docs });
});

/**
 * POST /api/employees/:code/documents
 * Upload a document for an employee
 */
router.post('/:code/documents', docUpload.single('file'), (req, res) => {
  const db = getDb();
  const { code } = req.params;
  const { documentType, remarks } = req.body;
  const uploadedBy = req.user?.username || 'admin';

  if (!req.file) return res.status(400).json({ success: false, error: 'No file uploaded' });

  const emp = db.prepare('SELECT id FROM employees WHERE code = ?').get(code);
  if (!emp) return res.status(404).json({ success: false, error: 'Employee not found' });

  const result = db.prepare(`
    INSERT INTO employee_documents (employee_id, employee_code, document_type, file_name, file_path, file_size, mime_type, uploaded_by, remarks)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    emp.id, code, documentType || 'Other',
    req.file.originalname, req.file.path,
    req.file.size, req.file.mimetype,
    uploadedBy, remarks || ''
  );

  res.json({ success: true, id: result.lastInsertRowid, message: 'Document uploaded' });
});

/**
 * GET /api/employees/documents/:id/download
 * Download a document
 */
router.get('/documents/:id/download', (req, res) => {
  const db = getDb();
  const doc = db.prepare('SELECT * FROM employee_documents WHERE id = ?').get(req.params.id);
  if (!doc) return res.status(404).json({ success: false, error: 'Document not found' });

  if (!fs.existsSync(doc.file_path)) {
    return res.status(404).json({ success: false, error: 'File not found on disk' });
  }

  res.download(doc.file_path, doc.file_name);
});

/**
 * DELETE /api/employees/documents/:id
 * Delete a document
 */
router.delete('/documents/:id', (req, res) => {
  const db = getDb();
  const doc = db.prepare('SELECT * FROM employee_documents WHERE id = ?').get(req.params.id);
  if (!doc) return res.status(404).json({ success: false, error: 'Document not found' });

  // Remove file from disk
  if (fs.existsSync(doc.file_path)) {
    fs.unlinkSync(doc.file_path);
  }

  db.prepare('DELETE FROM employee_documents WHERE id = ?').run(req.params.id);
  res.json({ success: true, message: 'Document deleted' });
});

/**
 * POST /api/employees/bulk-import
 * Bulk import employees from master-data-extracted.json format
 * Accepts: { employees: [...] } matching the extraction script output
 */
router.post('/bulk-import', (req, res) => {
  const db = getDb();
  const { employees: empList } = req.body;

  if (!empList || !Array.isArray(empList) || empList.length === 0) {
    return res.status(400).json({ success: false, error: 'employees array is required' });
  }

  // Add 'category' column if not exists
  try { db.exec("ALTER TABLE employees ADD COLUMN category TEXT DEFAULT ''"); } catch(e) {}

  const ACTIVE_CUTOFF = 202601; // Jan 2026

  const insertEmp = db.prepare(`
    INSERT INTO employees (
      code, name, father_name, dob, gender, department, designation, company,
      employment_type, date_of_joining, uan, aadhaar_masked, aadhar,
      bank_account, account_number, bank_name, ifsc, ifsc_code,
      gross_salary, pf_applicable, esi_applicable, pt_applicable,
      status, is_data_complete, category
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?
    )
    ON CONFLICT(code) DO UPDATE SET
      name = COALESCE(NULLIF(excluded.name, ''), employees.name),
      father_name = COALESCE(NULLIF(excluded.father_name, ''), employees.father_name),
      dob = COALESCE(excluded.dob, employees.dob),
      department = COALESCE(NULLIF(excluded.department, ''), employees.department),
      designation = COALESCE(NULLIF(excluded.designation, ''), employees.designation),
      company = COALESCE(NULLIF(excluded.company, ''), employees.company),
      employment_type = COALESCE(NULLIF(excluded.employment_type, ''), employees.employment_type),
      date_of_joining = COALESCE(excluded.date_of_joining, employees.date_of_joining),
      uan = COALESCE(NULLIF(excluded.uan, ''), employees.uan),
      bank_account = COALESCE(NULLIF(excluded.bank_account, ''), employees.bank_account),
      account_number = COALESCE(NULLIF(excluded.account_number, ''), employees.account_number),
      bank_name = COALESCE(NULLIF(excluded.bank_name, ''), employees.bank_name),
      ifsc = COALESCE(NULLIF(excluded.ifsc, ''), employees.ifsc),
      ifsc_code = COALESCE(NULLIF(excluded.ifsc_code, ''), employees.ifsc_code),
      gross_salary = CASE WHEN excluded.gross_salary > 0 THEN excluded.gross_salary ELSE employees.gross_salary END,
      pf_applicable = excluded.pf_applicable,
      esi_applicable = excluded.esi_applicable,
      -- Preserve manually marked Left/Inactive/Exited status on bulk re-import
      status = CASE
        WHEN employees.status IN ('Left', 'Inactive', 'Exited') AND employees.auto_inactive = 0 THEN employees.status
        ELSE excluded.status
      END,
      category = excluded.category,
      updated_at = datetime('now')
  `);

  const insertSalary = db.prepare(`
    INSERT INTO salary_structures (
      employee_id, effective_from, gross_salary,
      basic, da, hra, conveyance, special_allowance, other_allowances,
      basic_percent, hra_percent, da_percent,
      pf_applicable, esi_applicable, pt_applicable, pf_wage_ceiling
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertLeave = db.prepare(`
    INSERT OR IGNORE INTO leave_balances (employee_id, year, leave_type, opening, balance)
    VALUES (?, ?, ?, ?, ?)
  `);

  let inserted = 0, updated = 0, salaryCreated = 0, errors = 0;
  const errorDetails = [];

  const txn = db.transaction(() => {
    for (const emp of empList) {
      try {
        const isActive = (emp.lastSeenSortKey || 0) >= ACTIVE_CUTOFF;
        const status = isActive ? 'Active' : 'Left';

        const gross = emp.gross_salary || 0;
        const basic = emp.basic || 0;
        const pfApplicable = emp.pf_applicable !== undefined ? emp.pf_applicable : 0;
        const esiApplicable = emp.esi_applicable !== undefined ? emp.esi_applicable : 0;
        const ptApplicable = gross >= 15000 ? 1 : 0;

        const basicPct = gross > 0 ? Math.round(basic / gross * 100) : 50;
        const hraPct = gross > 0 ? Math.round((emp.hra || 0) / gross * 100) : 0;

        let empType = emp.employment_type || 'Permanent';
        if (emp.category === 'Worker') empType = 'Worker';
        else if (emp.category === 'Sales') empType = 'Sales';
        else if (emp.category === 'SILP') empType = 'SILP';
        else if (emp.category === 'Driver') empType = 'Driver';

        const existing = db.prepare('SELECT id FROM employees WHERE code = ?').get(emp.code);

        insertEmp.run(
          emp.code, emp.name, emp.father_name || '', emp.dob || null, null,
          emp.department || '', emp.designation || '', emp.company || '',
          empType, emp.date_of_joining || null,
          emp.uan || '', emp.aadhaar || '', emp.aadhaar || '',
          emp.account_number || '', emp.account_number || '',
          emp.bank_name || '', emp.ifsc || '', emp.ifsc || '',
          gross, pfApplicable, esiApplicable, ptApplicable,
          status, gross > 0 ? 1 : 0, emp.category || ''
        );

        if (existing) { updated++; } else { inserted++; }

        const empRow = db.prepare('SELECT id FROM employees WHERE code = ?').get(emp.code);
        if (!empRow) continue;

        if (gross > 0) {
          const existingSalary = db.prepare('SELECT * FROM salary_structures WHERE employee_id = ? ORDER BY effective_from DESC LIMIT 1').get(empRow.id);
          if (!existingSalary) {
            const effectiveFrom = emp.date_of_joining || '2025-04-01';
            const specialAllowance = Math.max(0, gross - basic - (emp.hra || 0) - (emp.cca || 0) - (emp.conv || 0));
            insertSalary.run(
              empRow.id, effectiveFrom, gross,
              basic, 0, emp.hra || 0, emp.conv || 0, specialAllowance, emp.cca || 0,
              basicPct, hraPct, 0,
              pfApplicable, esiApplicable, ptApplicable, 15000
            );
            salaryCreated++;
          } else if (Math.abs((existingSalary.gross_salary || 0) - gross) > 1
                     || (existingSalary.pf_applicable ?? 0) !== (pfApplicable ?? 0)
                     || (existingSalary.esi_applicable ?? 0) !== (esiApplicable ?? 0)
                     || (existingSalary.pt_applicable ?? 1) !== (ptApplicable ?? 1)) {
            // Existing structure drifted from the incoming import values —
            // repair it in the same transaction. Without this, bulk re-imports
            // silently leave Stage 7 reading stale gross from the struct while
            // employees.gross_salary shows the new value (the 60052 bug).
            syncSalaryStructureFromEmployee(db, empRow.id, {
              gross_salary: gross,
              pf_applicable: pfApplicable,
              esi_applicable: esiApplicable,
              pt_applicable: ptApplicable
            });
          }
        }

        for (const year of [2025, 2026]) {
          insertLeave.run(empRow.id, year, 'CL', 12, 12);
          insertLeave.run(empRow.id, year, 'EL', 0, 0);
        }
      } catch (err) {
        errors++;
        if (errors <= 10) errorDetails.push(`${emp.code}: ${err.message}`);
      }
    }
  });

  txn();

  const totalActive = db.prepare("SELECT COUNT(*) as cnt FROM employees WHERE status = 'Active'").get().cnt;
  const totalLeft = db.prepare("SELECT COUNT(*) as cnt FROM employees WHERE status = 'Left'").get().cnt;
  const totalAll = db.prepare("SELECT COUNT(*) as cnt FROM employees").get().cnt;
  const totalSalary = db.prepare("SELECT COUNT(*) as cnt FROM salary_structures").get().cnt;

  res.json({
    success: true,
    results: {
      inserted, updated, salaryCreated, errors,
      errorDetails: errorDetails.length > 0 ? errorDetails : undefined,
      database: { totalEmployees: totalAll, active: totalActive, left: totalLeft, salaryStructures: totalSalary }
    }
  });
});

// Bulk set is_contractor flag
router.post('/bulk-set-contractor', (req, res) => {
  const db = getDb();
  const { codes, is_contractor } = req.body;
  if (!codes || !codes.length) return res.status(400).json({ success: false, error: 'codes array required' });
  const val = is_contractor ? 1 : 0;
  const stmt = db.prepare('UPDATE employees SET is_contractor = ? WHERE code = ?');
  const txn = db.transaction(() => { for (const code of codes) stmt.run(val, code); });
  txn();
  res.json({ success: true, updated: codes.length });
});

/**
 * GET /api/employees/admin/integrity-check
 * Scans for desync between employees and salary_structures that would make
 * Stage 7 compute the wrong gross. Read-only — returns a punch list the
 * admin can repair via POST /admin/integrity-fix.
 *
 * Detects:
 *   - employees.gross_salary != salary_structures.gross_salary (non-trivial diff)
 *   - employees with no salary_structure row but non-zero gross
 *   - employees.pf_applicable / esi_applicable / pt_applicable disagree with struct
 *   - employment_type='Contract' / 'Contractor' but is_contractor=0 (and vice versa)
 */
router.get('/admin/integrity-check', (req, res) => {
  const db = getDb();

  // 1. Gross salary mismatches
  const grossMismatches = db.prepare(`
    SELECT e.code, e.name, e.department, e.status,
           e.gross_salary AS employee_gross,
           ss.gross_salary AS struct_gross,
           ABS(COALESCE(e.gross_salary, 0) - COALESCE(ss.gross_salary, 0)) AS diff
    FROM employees e
    LEFT JOIN salary_structures ss ON ss.id = (
      SELECT id FROM salary_structures WHERE employee_id = e.id ORDER BY effective_from DESC LIMIT 1
    )
    WHERE e.status = 'Active'
      AND COALESCE(e.gross_salary, 0) > 0
      AND COALESCE(ss.gross_salary, 0) > 0
      AND ABS(COALESCE(e.gross_salary, 0) - COALESCE(ss.gross_salary, 0)) > 1
    ORDER BY diff DESC
  `).all();

  // 2. Employees with gross but no structure
  const missingStruct = db.prepare(`
    SELECT e.code, e.name, e.department, e.gross_salary
    FROM employees e
    LEFT JOIN salary_structures ss ON ss.employee_id = e.id
    WHERE e.status = 'Active' AND COALESCE(e.gross_salary, 0) > 0 AND ss.id IS NULL
  `).all();

  // 3. Statutory flag mismatches
  const flagMismatches = db.prepare(`
    SELECT e.code, e.name, e.department,
           e.pf_applicable AS e_pf, ss.pf_applicable AS ss_pf,
           e.esi_applicable AS e_esi, ss.esi_applicable AS ss_esi,
           e.pt_applicable AS e_pt, ss.pt_applicable AS ss_pt
    FROM employees e
    JOIN salary_structures ss ON ss.id = (
      SELECT id FROM salary_structures WHERE employee_id = e.id ORDER BY effective_from DESC LIMIT 1
    )
    WHERE e.status = 'Active'
      AND (COALESCE(e.pf_applicable, 0) != COALESCE(ss.pf_applicable, 0)
           OR COALESCE(e.esi_applicable, 0) != COALESCE(ss.esi_applicable, 0)
           OR COALESCE(e.pt_applicable, 1) != COALESCE(ss.pt_applicable, 1))
  `).all();

  // 4. is_contractor vs employment_type mismatches
  let contractorMismatches = [];
  try {
    contractorMismatches = db.prepare(`
      SELECT code, name, department, employment_type, is_contractor
      FROM employees
      WHERE status = 'Active'
        AND ((LOWER(COALESCE(employment_type, '')) LIKE '%contract%' AND COALESCE(is_contractor, 0) = 0)
             OR (LOWER(COALESCE(employment_type, '')) NOT LIKE '%contract%' AND COALESCE(is_contractor, 0) = 1))
    `).all();
  } catch (e) {
    // is_contractor column may not exist on older deployments
    contractorMismatches = [{ error: e.message }];
  }

  res.json({
    success: true,
    summary: {
      grossMismatches: grossMismatches.length,
      missingStruct: missingStruct.length,
      flagMismatches: flagMismatches.length,
      contractorMismatches: Array.isArray(contractorMismatches) ? contractorMismatches.length : 0
    },
    data: {
      grossMismatches,
      missingStruct,
      flagMismatches,
      contractorMismatches
    }
  });
});

/**
 * POST /api/employees/admin/integrity-fix
 * Repairs the desync issues reported by /admin/integrity-check. Treats
 * `employees` table as the source of truth and scales salary_structures
 * components proportionally to match. Admin only.
 *
 * Body: { dryRun: boolean } — if true, reports what WOULD change without
 * writing. Defaults to false.
 */
router.post('/admin/integrity-fix', (req, res) => {
  const db = getDb();
  const dryRun = !!req.body?.dryRun;

  const mismatches = db.prepare(`
    SELECT e.id, e.code, e.name,
           e.gross_salary AS employee_gross,
           COALESCE(ss.gross_salary, 0) AS struct_gross,
           e.pf_applicable AS e_pf, COALESCE(ss.pf_applicable, 0) AS ss_pf,
           e.esi_applicable AS e_esi, COALESCE(ss.esi_applicable, 0) AS ss_esi,
           e.pt_applicable AS e_pt, COALESCE(ss.pt_applicable, 1) AS ss_pt,
           ss.id AS ss_id
    FROM employees e
    LEFT JOIN salary_structures ss ON ss.id = (
      SELECT id FROM salary_structures WHERE employee_id = e.id ORDER BY effective_from DESC LIMIT 1
    )
    WHERE e.status = 'Active'
      AND COALESCE(e.gross_salary, 0) > 0
      AND (
        ABS(COALESCE(e.gross_salary, 0) - COALESCE(ss.gross_salary, 0)) > 1
        OR COALESCE(e.pf_applicable, 0) != COALESCE(ss.pf_applicable, 0)
        OR COALESCE(e.esi_applicable, 0) != COALESCE(ss.esi_applicable, 0)
        OR COALESCE(e.pt_applicable, 1) != COALESCE(ss.pt_applicable, 1)
        OR ss.id IS NULL
      )
  `).all();

  const actions = [];
  if (!dryRun) {
    const txn = db.transaction(() => {
      for (const row of mismatches) {
        const result = syncSalaryStructureFromEmployee(db, row.id, {
          gross_salary: row.employee_gross,
          pf_applicable: row.e_pf,
          esi_applicable: row.e_esi,
          pt_applicable: row.e_pt
        });
        actions.push({
          code: row.code,
          name: row.name,
          before: { gross: row.struct_gross, pf: row.ss_pf, esi: row.ss_esi, pt: row.ss_pt },
          after: { gross: row.employee_gross, pf: row.e_pf, esi: row.e_esi, pt: row.e_pt },
          action: result.action || 'skipped',
          reason: result.reason || null
        });
      }
    });
    txn();
  } else {
    for (const row of mismatches) {
      actions.push({
        code: row.code,
        name: row.name,
        before: { gross: row.struct_gross, pf: row.ss_pf, esi: row.ss_esi, pt: row.ss_pt },
        after: { gross: row.employee_gross, pf: row.e_pf, esi: row.e_esi, pt: row.e_pt },
        action: row.ss_id ? 'would-update' : 'would-create'
      });
    }
  }

  res.json({
    success: true,
    dryRun,
    totalFixed: dryRun ? 0 : actions.filter(a => a.action !== 'skipped').length,
    totalFound: mismatches.length,
    actions
  });
});

module.exports = router;
module.exports.syncSalaryStructureFromEmployee = syncSalaryStructureFromEmployee;
