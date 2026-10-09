/**
 * Shared in-memory fixture for the Loans PR-2 engine suites.
 * Real initSchema() (via leaveFixture.newDb) — the PR-1 loan tables, triggers
 * and policy keys exactly as production has them.
 */
const F = require('./leaveFixture');
const L = require('../../services/loans');

const COMPANY = 'Indriyan Beverages Pvt Ltd';
const OTHER_COMPANY = 'Asian Lakto Ind Ltd';
const ASOF = '2026-10-09';

const HR = { username: 'hr1', role: 'hr' };
const HR2 = { username: 'hr2', role: 'hr' };
const FIN = { username: 'fin1', role: 'finance' };
const FIN2 = { username: 'fin2', role: 'finance' };
const ADMIN = { username: 'boss', role: 'admin' };
const ADMIN2 = { username: 'boss2', role: 'admin' };
const VIEWER = { username: 'view1', role: 'viewer' };
const SYS = { username: 'system', role: 'system' };

let seq = 1;
function plant(db, over = {}) {
  const code = over.code || `P${String(seq++).padStart(4, '0')}`;
  const e = F.addEmployee(db, { date_of_joining: '2025-01-01', ...over, code });
  if (over.gross_salary !== undefined) db.prepare('UPDATE employees SET gross_salary = ? WHERE code = ?').run(over.gross_salary, code);
  return e;
}

function sales(db, over = {}) {
  const code = over.code || `S${String(seq++).padStart(4, '0')}`;
  const company = over.company || COMPANY;
  const info = db.prepare(`INSERT INTO sales_employees (code, name, company, status, doj, gross_salary)
                           VALUES (?, 'TEST SALES', ?, ?, ?, ?)`)
    .run(code, company, over.status || 'Active', over.doj === undefined ? '2025-01-01' : over.doj, over.gross_salary ?? 20000);
  return { code, company, id: info.lastInsertRowid };
}

/** requested → approved → active in one go; returns the loan id. */
function activeLoan(db, over = {}) {
  const emp = over.emp || plant(db);
  const r = L.requestLoan(db, {
    borrowerType: over.borrowerType || 'plant', employeeCode: emp.code, company: over.company || COMPANY,
    loanType: over.loanType || 'Personal', principal: over.principal ?? 10000, tenure: over.tenure ?? 3, reason: 'test',
  }, over.requester || HR, { asOf: ASOF });
  if (!r.ok) throw new Error(`request failed: ${r.code} ${r.message}`);
  const a = L.approveLoan(db, r.loanId, ADMIN, { asOf: ASOF });
  if (!a.ok) throw new Error(`approve failed: ${a.code}`);
  const d = L.disburseLoan(db, r.loanId, FIN, {
    mode: 'NEFT', reference: 'UTR-1', disbursedOn: over.disbursedOn || '2026-10-05', agreementFilePath: 'agreements/a.pdf',
    firstEmiMonth: over.firstEmiMonth,
  }, { asOf: ASOF });
  if (!d.ok) throw new Error(`disburse failed: ${d.code} ${d.message}`);
  return { loanId: r.loanId, emp };
}

const instalments = (db, loanId) => db.prepare('SELECT * FROM loan_instalments WHERE loan_id = ? ORDER BY sequence').all(loanId);
const loan = (db, loanId) => db.prepare('SELECT * FROM loans WHERE id = ?').get(loanId);
const events = (db, loanId) => db.prepare('SELECT * FROM loan_events WHERE loan_id = ? ORDER BY id').all(loanId);

/** Stage 7 + close for one instalment in one go (what PR-5/PR-6 will do). */
function deductAndPost(db, loanId, ins, amount, payroll = 'plant') {
  const p = L.recordProvisional(db, { loanId, instalmentId: ins.id, payroll, month: ins.due_month, year: ins.due_year, company: COMPANY, amount }, SYS);
  if (!p.ok) throw new Error(`provisional failed: ${p.code} ${p.message}`);
  return L.postDeduction(db, { deductionId: p.deductionId }, SYS);
}

module.exports = {
  F, L, COMPANY, OTHER_COMPANY, ASOF, HR, HR2, FIN, FIN2, ADMIN, ADMIN2, VIEWER, SYS,
  plant, sales, activeLoan, instalments, loan, events, deductAndPost,
};
