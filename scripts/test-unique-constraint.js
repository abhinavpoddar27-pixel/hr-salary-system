// Synthetic test for the May 2026 UNIQUE-constraint migration on
// salary_computations + day_calculations. Uses an in-memory SQLite so
// production data is never touched. Confirms:
//   1. duplicate (emp,month,year) with different company tags is rejected
//   2. UPSERT with the new conflict key updates in place
//   3. different employees same month/year coexist
//   4. same employee different month coexist

const path = require('path');
// better-sqlite3 lives in backend/node_modules; resolve from there.
const Database = require(path.join(__dirname, '..', 'backend', 'node_modules', 'better-sqlite3'));

const db = new Database(':memory:');

// Recreate minimal salary_computations table with NEW constraint
db.exec(`
  CREATE TABLE salary_computations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_code TEXT NOT NULL,
    month INTEGER NOT NULL,
    year INTEGER NOT NULL,
    company TEXT,
    net_salary REAL,
    UNIQUE(employee_code, month, year)
  );
`);

let pass = 0, fail = 0;
const test = (label, fn) => {
  try { fn(); console.log(`  PASS  ${label}`); pass++; }
  catch (e) { console.log(`  FAIL  ${label}: ${e.message}`); fail++; }
};

console.log('UNIQUE constraint test — Phase 3\n');

// Case 1: same emp+month+year, different company → must FAIL
test('different company tags for same (emp,month,year) cannot coexist', () => {
  db.prepare('INSERT INTO salary_computations (employee_code, month, year, company, net_salary) VALUES (?, ?, ?, ?, ?)').run('10003', 4, 2026, 'Asian Lakto Ind Ltd', 1000);
  try {
    db.prepare('INSERT INTO salary_computations (employee_code, month, year, company, net_salary) VALUES (?, ?, ?, ?, ?)').run('10003', 4, 2026, '', 1000);
    throw new Error('Expected UNIQUE violation, but INSERT succeeded');
  } catch (e) {
    if (!e.message.includes('UNIQUE constraint failed')) throw new Error(`Wrong error: ${e.message}`);
  }
});

// Case 2: UPSERT with new conflict clause → updates existing row, doesn't INSERT
test('UPSERT on (emp,month,year) updates existing row regardless of company tag', () => {
  const before = db.prepare('SELECT COUNT(*) as cnt FROM salary_computations WHERE employee_code=? AND month=4 AND year=2026').get('10003').cnt;
  db.prepare(`
    INSERT INTO salary_computations (employee_code, month, year, company, net_salary)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(employee_code, month, year) DO UPDATE SET company=excluded.company, net_salary=excluded.net_salary
  `).run('10003', 4, 2026, 'Indriyan Beverages Pvt Ltd', 2000);
  const after = db.prepare('SELECT COUNT(*) as cnt FROM salary_computations WHERE employee_code=? AND month=4 AND year=2026').get('10003').cnt;
  if (before !== 1 || after !== 1) throw new Error(`Row count changed: before=${before} after=${after}`);
  const row = db.prepare('SELECT * FROM salary_computations WHERE employee_code=? AND month=4 AND year=2026').get('10003');
  if (row.company !== 'Indriyan Beverages Pvt Ltd' || row.net_salary !== 2000) throw new Error(`Update didn't apply: ${JSON.stringify(row)}`);
});

// Case 3: Different employee, same month/year → both rows allowed
test('different employees for same month/year coexist', () => {
  db.prepare('INSERT INTO salary_computations (employee_code, month, year, company, net_salary) VALUES (?, ?, ?, ?, ?)').run('10005', 4, 2026, 'Asian Lakto Ind Ltd', 3000);
  const cnt = db.prepare('SELECT COUNT(*) as cnt FROM salary_computations WHERE month=4 AND year=2026').get().cnt;
  if (cnt !== 2) throw new Error(`Expected 2 rows, got ${cnt}`);
});

// Case 4: Same employee, different month → both rows allowed
test('same employee for different months coexist', () => {
  db.prepare('INSERT INTO salary_computations (employee_code, month, year, company, net_salary) VALUES (?, ?, ?, ?, ?)').run('10003', 5, 2026, 'Asian Lakto Ind Ltd', 4000);
  const cnt = db.prepare('SELECT COUNT(*) as cnt FROM salary_computations WHERE employee_code=?').get('10003').cnt;
  if (cnt !== 2) throw new Error(`Expected 2 rows, got ${cnt}`);
});

console.log(`\nResult: ${pass}/${pass+fail} cases passed`);
if (fail > 0) process.exit(1);
