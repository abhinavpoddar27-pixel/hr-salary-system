/**
 * Simple in-process job queue using SQLite.
 * Jobs run sequentially in the background via setInterval.
 */
const { getDb } = require('../database/db');

function initJobQueue() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      params TEXT,
      status TEXT DEFAULT 'pending',
      progress INTEGER DEFAULT 0,
      result TEXT,
      error TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      started_at TEXT,
      completed_at TEXT
    )
  `);
}

function enqueue(type, params) {
  const db = getDb();
  const result = db.prepare('INSERT INTO jobs (type, params) VALUES (?, ?)').run(type, JSON.stringify(params));
  return result.lastInsertRowid;
}

function getJob(id) {
  const db = getDb();
  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
  if (job && job.result) {
    try { job.result = JSON.parse(job.result); } catch {}
  }
  if (job && job.params) {
    try { job.params = JSON.parse(job.params); } catch {}
  }
  return job;
}

function updateJob(id, fields) {
  const db = getDb();
  const sets = Object.entries(fields).map(([k, v]) => `${k} = ?`);
  const vals = Object.values(fields);
  db.prepare(`UPDATE jobs SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id);
}

async function processNext() {
  const db = getDb();
  const job = db.prepare("SELECT * FROM jobs WHERE status = 'pending' ORDER BY created_at ASC LIMIT 1").get();
  if (!job) return;

  updateJob(job.id, { status: 'running', started_at: new Date().toISOString() });

  try {
    const params = JSON.parse(job.params || '{}');
    let result;

    if (job.type === 'salary_compute') {
      const { computeEmployeeSalary, saveSalaryComputation } = require('./salaryComputation');
      const { month, year, company } = params;
      const employees = db.prepare(`
        SELECT DISTINCT e.* FROM employees e
        INNER JOIN day_calculations dc ON e.code = dc.employee_code
        WHERE dc.month = ? AND dc.year = ? ${company ? 'AND dc.company = ?' : ''}
        AND (e.status IS NULL OR e.status NOT IN ('Exited'))
      `).all(...[month, year, company].filter(Boolean));

      const results = [], excluded = [], errors = [];
      const total = employees.length;
      for (let i = 0; i < total; i++) {
        const emp = employees[i];
        try {
          const comp = computeEmployeeSalary(db, emp, parseInt(month), parseInt(year), company || '');
          if (comp.success) { saveSalaryComputation(db, comp); results.push(comp); }
          else if (comp.excluded) { excluded.push({ code: comp.employeeCode, name: emp.name, reason: comp.reason }); }
        } catch (e) { errors.push({ code: emp.code, error: e.message }); }
        if (i % 10 === 0) updateJob(job.id, { progress: Math.round((i / total) * 100) });
      }
      db.prepare('UPDATE monthly_imports SET stage_7_done = 1 WHERE month = ? AND year = ?').run(month, year);
      result = { processed: results.length, excluded, errors: errors.length, held: results.filter(r => r.salaryHeld).length };

    } else if (job.type === 'day_calculate') {
      const { calculateDays, saveDayCalculation } = require('./dayCalculation');
      const { month, year, company } = params;
      const empCodes = db.prepare(`
        SELECT DISTINCT ap.employee_code FROM attendance_processed ap
        LEFT JOIN employees e ON ap.employee_code = e.code
        WHERE ap.month = ? AND ap.year = ? ${company ? 'AND ap.company = ?' : ''}
        AND ap.is_night_out_only = 0 AND (e.status IS NULL OR e.status NOT IN ('Exited'))
      `).all(...[month, year, company].filter(Boolean)).map(r => r.employee_code);

      const monthStr = String(month).padStart(2, '0');
      const holidays = db.prepare('SELECT date FROM holidays WHERE date LIKE ?').all(`${year}-${monthStr}-%`);
      const results = [], errors = [];
      const total = empCodes.length;
      // Phase 2 (April 2026): contractor detection helper
      const { isContractorForPayroll } = require('../utils/employeeClassification');
      const monthStrLeave = String(month).padStart(2, '0');
      const monthStartDate = `${year}-${monthStrLeave}-01`;
      const lastDay = new Date(year, month, 0).getDate();
      const monthEndDate = `${year}-${monthStrLeave}-${String(lastDay).padStart(2, '0')}`;

      for (let i = 0; i < total; i++) {
        const empCode = empCodes[i];
        try {
          const emp = db.prepare('SELECT id FROM employees WHERE code = ?').get(empCode);
          const empFull = db.prepare('SELECT * FROM employees WHERE code = ?').get(empCode);
          const records = db.prepare(`SELECT * FROM attendance_processed WHERE employee_code = ? AND month = ? AND year = ? ${company ? 'AND company = ?' : ''}`).all(...[empCode, month, year, company].filter(Boolean));
          const leaveBalances = { CL: 0, EL: 0, SL: 0 };
          if (emp) {
            const lbs = db.prepare('SELECT * FROM leave_balances WHERE employee_id = ? AND year = ?').all(emp.id, year);
            for (const lb of lbs) leaveBalances[lb.leave_type] = lb.balance || 0;
          }

          // Phase 2: approved leaves + finance-approved comp-off grants
          const approvedLeaves = db.prepare(`
            SELECT leave_type, start_date, end_date, days, status
            FROM leave_applications
            WHERE employee_code = ? AND status = 'Approved'
              AND start_date <= ? AND end_date >= ?
          `).all(empCode, monthEndDate, monthStartDate);

          const approvedCompOff = db.prepare(`
            SELECT start_date, end_date, finance_status
            FROM compensatory_off_requests
            WHERE employee_code = ? AND month = ? AND year = ?
              AND finance_status = 'approved'
          `).all(empCode, parseInt(month), parseInt(year));

          const calcResult = calculateDays(
            empCode, parseInt(month), parseInt(year), company || '',
            records, leaveBalances, holidays,
            {
              isContractor: isContractorForPayroll(empFull),
              weeklyOffDay: empFull?.weekly_off_day ?? 0,
              employmentType: empFull?.employment_type || 'Permanent',
              dateOfJoining: empFull?.date_of_joining || null,
              approvedLeaves,
              approvedCompOff
            }
          );
          calcResult.employeeId = emp?.id;
          saveDayCalculation(db, calcResult);
          results.push(calcResult);
        } catch (e) { errors.push({ code: empCode, error: e.message }); }
        if (i % 10 === 0) updateJob(job.id, { progress: Math.round((i / total) * 100) });
      }
      result = { processed: results.length, errors: errors.length };
    } else {
      result = { error: `Unknown job type: ${job.type}` };
    }

    updateJob(job.id, { status: 'completed', progress: 100, result: JSON.stringify(result), completed_at: new Date().toISOString() });
  } catch (err) {
    updateJob(job.id, { status: 'failed', error: err.message, completed_at: new Date().toISOString() });
  }
}

function startWorker() {
  initJobQueue();
  setInterval(() => {
    try { processNext(); } catch (e) { console.error('[JobQueue] Worker error:', e.message); }
  }, 2000);
  console.log('🔄 Job queue worker started');
}

module.exports = { enqueue, getJob, startWorker, initJobQueue };
