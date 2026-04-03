const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { getDb } = require('../database/db');

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

  const baseQuery = `SELECT e.*, s.name as shift_name,
    ss.gross_salary, ss.basic_percent, ss.hra_percent, ss.da_percent,
    ss.pf_applicable, ss.esi_applicable, ss.pt_applicable, ss.pf_wage_ceiling
    FROM employees e
    LEFT JOIN shifts s ON e.default_shift_id = s.id
    LEFT JOIN salary_structures ss ON ss.employee_id = e.id AND ss.id = (
      SELECT id FROM salary_structures WHERE employee_id = e.id ORDER BY effective_from DESC LIMIT 1
    ) ${where}`;

  // If no page param, return all (backward compatible)
  if (!page) {
    const employees = db.prepare(baseQuery + ' ORDER BY e.department, e.name').all(...params);
    return res.json({ success: true, data: employees });
  }

  const { paginateQuery } = require('../utils/pagination');
  const countQuery = `SELECT COUNT(*) as cnt FROM employees e ${where}`;
  const sortCol = sort ? `e.${sort}` : 'e.department, e.name';
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

// GET single employee
router.get('/:code', (req, res) => {
  const db = getDb();
  const emp = db.prepare('SELECT * FROM employees WHERE code = ?').get(req.params.code);
  if (!emp) return res.status(404).json({ success: false, error: 'Employee not found' });

  const salaryStruct = db.prepare('SELECT * FROM salary_structures WHERE employee_id = ? ORDER BY effective_from DESC LIMIT 1').get(emp.id);
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

  // Initialize leave balances for current year
  const year = new Date().getFullYear();
  for (const type of ['CL', 'EL', 'SL']) {
    db.prepare('INSERT OR IGNORE INTO leave_balances (employee_id, year, leave_type, opening, balance) VALUES (?, ?, ?, ?, ?)').run(empId, year, type, type === 'CL' ? 12 : 0, type === 'CL' ? 12 : 0);
  }

  res.json({ success: true, id: empId, message: 'Employee created' });
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
    'gross_salary', 'status', 'is_data_complete',
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

  if (setClauses.length === 0) return res.json({ success: true, message: 'No updates' });

  setClauses.push("updated_at = datetime('now')");
  params.push(code);

  db.prepare(`UPDATE employees SET ${setClauses.join(', ')} WHERE code = ?`).run(...params);

  // Auto-create/update salary structure when gross_salary is updated
  if (updates.gross_salary !== undefined && parseFloat(updates.gross_salary) > 0) {
    const gross = parseFloat(updates.gross_salary);
    const existing = db.prepare('SELECT id FROM salary_structures WHERE employee_id = ? ORDER BY effective_from DESC LIMIT 1').get(emp.id);
    if (existing) {
      const basicPct = 50, hraPct = 20;
      db.prepare(`UPDATE salary_structures SET gross_salary=?, basic=?, hra=?, updated_at=datetime('now') WHERE id=?`)
        .run(gross, gross * basicPct / 100, gross * hraPct / 100, existing.id);
    } else {
      const basicPct = 50, hraPct = 20;
      db.prepare(`INSERT INTO salary_structures
        (employee_id, effective_from, gross_salary, basic, da, hra, special_allowance, other_allowances,
         basic_percent, hra_percent, da_percent, pf_applicable, esi_applicable, pt_applicable, pf_wage_ceiling)
        VALUES (?, '2025-01-01', ?, ?, 0, ?, 0, 0, ?, ?, 0, ?, ?, ?, 15000)`).run(
          emp.id, gross, gross * basicPct / 100, gross * hraPct / 100,
          basicPct, hraPct,
          emp.pf_applicable || 0, emp.esi_applicable || 0, emp.pt_applicable ?? 1
      );
    }
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
router.put('/:code/salary', (req, res) => {
  const db = getDb();
  const emp = db.prepare('SELECT id FROM employees WHERE code = ?').get(req.params.code);
  if (!emp) return res.status(404).json({ success: false, error: 'Employee not found' });

  const {
    gross_salary, basic_percent, hra_percent, da_percent,
    special_allowance_percent, other_allowance,
    pf_applicable, esi_applicable, pt_applicable, pf_wage_ceiling,
    uan, esi_number, account_number, bank_name, ifsc_code
  } = req.body;

  const gross = parseFloat(gross_salary) || 0;
  const basicPct = parseFloat(basic_percent) || 50;
  const hraPct = parseFloat(hra_percent) || 20;
  const daPct = parseFloat(da_percent) || 0;
  const specialPct = parseFloat(special_allowance_percent) || 0;
  const otherAllow = parseFloat(other_allowance) || 0;

  const basic = gross * basicPct / 100;
  const hra = gross * hraPct / 100;
  const da = gross * daPct / 100;
  const specialAllow = gross * specialPct / 100;

  // Update employee banking/statutory fields
  db.prepare(`UPDATE employees SET uan=?, esi_number=?, bank_account=?, bank_name=?, ifsc=?, updated_at=datetime('now') WHERE code=?`)
    .run(uan || null, esi_number || null, account_number || null, bank_name || null, ifsc_code || null, req.params.code);

  // Upsert salary structure
  const existing = db.prepare('SELECT id FROM salary_structures WHERE employee_id = ? ORDER BY effective_from DESC LIMIT 1').get(emp.id);
  if (existing) {
    db.prepare(`UPDATE salary_structures SET
      gross_salary=?, basic=?, da=?, hra=?, special_allowance=?, other_allowances=?,
      basic_percent=?, hra_percent=?, da_percent=?,
      pf_applicable=?, esi_applicable=?, pt_applicable=?, pf_wage_ceiling=?,
      updated_at=datetime('now')
      WHERE id=?`).run(
        gross, basic, da, hra, specialAllow, otherAllow,
        basicPct, hraPct, daPct,
        pf_applicable ?? 0, esi_applicable ?? 0, pt_applicable ?? 1, pf_wage_ceiling || 15000,
        existing.id
    );
  } else {
    db.prepare(`INSERT INTO salary_structures
      (employee_id, effective_from, gross_salary, basic, da, hra, special_allowance, other_allowances,
       basic_percent, hra_percent, da_percent, pf_applicable, esi_applicable, pt_applicable, pf_wage_ceiling)
      VALUES (?, date('now'), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        emp.id, gross, basic, da, hra, specialAllow, otherAllow,
        basicPct, hraPct, daPct,
        pf_applicable ?? 1, esi_applicable ?? 1, pt_applicable ?? 1, pf_wage_ceiling || 15000
    );
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
    db.prepare(`UPDATE employees SET status = 'Left', is_data_complete = 0, date_of_exit = ?, exit_reason = ?, updated_at = datetime('now') WHERE code = ?`)
      .run(date_of_leaving || new Date().toISOString().split('T')[0], reason || '', code);

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
      status = excluded.status,
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
          const existingSalary = db.prepare('SELECT id FROM salary_structures WHERE employee_id = ?').get(empRow.id);
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
          }
        }

        for (const year of [2025, 2026]) {
          insertLeave.run(empRow.id, year, 'CL', 12, 12);
          insertLeave.run(empRow.id, year, 'EL', 0, 0);
          insertLeave.run(empRow.id, year, 'SL', 0, 0);
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

module.exports = router;
