/**
 * File-backed fixture for the leave-switchover specs. applySwitchover backs the
 * database file up, so these tests need a real file in a temp directory.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const { initSchema } = require('../../database/schema');
const F = require('./leaveFixture');

function newFileDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'switchover-'));
  const db = new Database(path.join(dir, 'hr_system.db'));
  db.pragma('journal_mode = WAL');
  F.silently(() => initSchema(db));
  const cleanup = () => {
    try { db.close(); } catch { /* already closed */ }
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  };
  return { db, dir, cleanup };
}

/** md5 of a whole table, ordered by id — the "nothing changed" fingerprint. */
function tableMd5(db, table) {
  const rows = db.prepare(`SELECT * FROM ${table} ORDER BY id`).all();
  return crypto.createHash('md5').update(JSON.stringify(rows)).digest('hex');
}

function fingerprint(db, tables = ['leave_balances', 'employees', 'leave_transactions', 'policy_config', 'audit_log']) {
  const out = {};
  for (const t of tables) {
    out[t] = { md5: tableMd5(db, t), rows: db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get().c };
  }
  return out;
}

function addEmp(db, code, type, over = {}) {
  return F.addEmployee(db, { code, employment_type: type, date_of_joining: '2023-01-01', ...over });
}

/** Insert a leave_transactions row with an explicit id (to mirror production #1-#12). */
function addTxnWithId(db, id, emp, over) {
  const t = { leave_type: 'EL', transaction_type: 'Credit', days: 1, reference_month: 8, reference_year: 2026,
    reason: '', approved_by: 'admin', ...over };
  db.prepare(`
    INSERT INTO leave_transactions
      (id, employee_id, employee_code, company, leave_type, transaction_type, days,
       balance_after, reference_month, reference_year, reason, approved_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)
  `).run(id, emp.id, emp.code, emp.company ?? null, t.leave_type, t.transaction_type, t.days,
    t.reference_month, t.reference_year, t.reason, t.approved_by);
}

/** The three ruled hand credits, as on production (ref 8/2026). */
function addRuledCredits(db, e19954, e23700) {
  addTxnWithId(db, 1, e19954, { leave_type: 'EL', days: 10, reason: 'till june leave' });
  addTxnWithId(db, 2, e23700, { leave_type: 'CL', days: 3 });
  addTxnWithId(db, 3, e23700, { leave_type: 'EL', days: 9 });
}

module.exports = { newFileDb, tableMd5, fingerprint, addEmp, addTxnWithId, addRuledCredits };
