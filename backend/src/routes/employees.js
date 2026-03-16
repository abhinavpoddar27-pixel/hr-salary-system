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
  const { department, company, status, search } = req.query;

  let query = `SELECT e.*, s.name as shift_name,
    ss.gross_salary, ss.basic_percent, ss.hra_percent, ss.da_percent,
    ss.pf_applicable, ss.esi_applicable, ss.pt_applicable, ss.pf_wage_ceiling
    FROM employees e
    LEFT JOIN shifts s ON e.default_shift_id = s.id
    LEFT JOIN salary_structures ss ON ss.employee_id = e.id AND ss.id = (
      SELECT id FROM salary_structures WHERE employee_id = e.id ORDER BY effective_from DESC LIMIT 1
    )
    WHERE 1=1`;
  const params = [];

  if (department) { query += ' AND e.department = ?'; params.push(department); }
  if (company) { query += ' AND e.company = ?'; params.push(company); }
  if (status) { query += ' AND e.status = ?'; params.push(status); }
  if (search) { query += ' AND (e.name LIKE ? OR e.code LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }

  query += ' ORDER BY e.department, e.name';

  const employees = db.prepare(query).all(...params);
  res.json({ success: true, data: employees });
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
    'status', 'is_data_complete',
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
        pf_applicable ?? 1, esi_applicable ?? 1, pt_applicable ?? 1, pf_wage_ceiling || 15000,
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

module.exports = router;
