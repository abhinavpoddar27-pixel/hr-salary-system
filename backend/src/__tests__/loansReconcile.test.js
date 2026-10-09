/**
 * Loans PR-2 — reconciliation, statement, audit mirror (docs/loans/SPEC.md §5.2 r12–r13, K34).
 */
const { L, F, COMPANY, HR, FIN2, ADMIN, SYS, activeLoan, instalments, loan, deductAndPost } = require('./helpers/loanFixture');

let db;
beforeEach(() => { db = F.newDb(); });

test('statement closing equals the reconciliation figure after posts, receipt, shortfall and top-up', () => {
  const { loanId } = activeLoan(db, { principal: 12000, tenure: 6 });
  const ins = instalments(db, loanId);
  deductAndPost(db, loanId, ins[0], 2000);
  deductAndPost(db, loanId, ins[1], 500);
  L.recordReceipt(db, loanId, FIN2, { amount: 1234.56, mode: 'cash', receiptDate: '2026-10-08' }, { asOf: '2026-10-09' });
  L.restructureLoan(db, { loanId, newTenure: 5, reason: 'r', requestedBy: HR, topup: { amount: 3000, mode: 'NEFT', reference: 'T', disbursedOn: '2026-10-08', agreementFilePath: 'x.pdf' } }, ADMIN, { asOf: '2026-10-09' });
  const rec = L.reconcileLoan(db, loanId);
  const st = L.loanStatement(db, loanId);
  expect(rec.ok).toBe(true);
  expect(st.closing).toBe(rec.expectedBalance);
  expect(st.closing).toBe(loan(db, loanId).remaining_balance);
  expect(rec).toMatchObject({ disbursed: 15000, posted: 2500, receipts: 1234.56 });
  expect(st.rows[0]).toMatchObject({ month: '2026-10', disbursed: 15000 });
  expect(st.rows.find((r) => r.month === '2026-11')).toMatchObject({ recovered: 2000 });
});

test('a tampered balance is reported, as is an open schedule above the balance', () => {
  const { loanId } = activeLoan(db);
  db.prepare('UPDATE loans SET remaining_balance = 9000 WHERE id = ?').run(loanId);
  const r = L.reconcileLoan(db, loanId);
  expect(r.ok).toBe(false);
  expect(r.problems.join(' ')).toMatch(/≠ disbursed/);
  expect(r.problems.join(' ')).toMatch(/exceed the balance/);
  expect(L.reconcileAll(db)).toMatchObject({ ok: false, checked: 1 });
});

test('reconcileAll ignores undisbursed loans; every engine event is mirrored in audit_log', () => {
  const { loanId } = activeLoan(db);
  for (const i of instalments(db, loanId)) deductAndPost(db, loanId, i, i.amount_due);
  L.requestLoan(db, { borrowerType: 'plant', employeeCode: 'nobody', company: COMPANY, loanType: 'Personal', principal: 1, tenure: 1, reason: 'x' }, HR);
  expect(L.reconcileAll(db)).toMatchObject({ ok: true, checked: 1 });
  const ev = db.prepare('SELECT COUNT(*) n FROM loan_events').get().n;
  const au = db.prepare("SELECT COUNT(*) n FROM audit_log WHERE stage = 'loans'").get().n;
  expect(au).toBe(ev);
  expect(loan(db, loanId).status).toBe('completed');
});

test('a rejected refusal leaves no partial rows (transaction rolls back)', () => {
  const { loanId } = activeLoan(db, { principal: 6000, tenure: 2 });
  const [i1] = instalments(db, loanId);
  L.recordProvisional(db, { loanId, instalmentId: i1.id, payroll: 'plant', month: 11, year: 2026, amount: 3000 }, SYS);
  const before = db.prepare('SELECT COUNT(*) n FROM loan_events').get().n;
  expect(L.recordReceipt(db, loanId, FIN2, { amount: 5000, mode: 'cash', receiptDate: '2026-10-08' }, { asOf: '2026-10-09' }).code).toBe('RECEIPT_OVERLAPS_PROVISIONAL');
  expect(db.prepare('SELECT COUNT(*) n FROM loan_events').get().n).toBe(before);
  expect(instalments(db, loanId).map((i) => i.status)).toEqual(['provisional', 'scheduled']);
});

test('the engine works inside a caller savepoint (PR-5 per-employee savepoint)', () => {
  const { loanId } = activeLoan(db);
  const [i1] = instalments(db, loanId);
  expect(() => db.transaction(() => {
    L.recordProvisional(db, { loanId, instalmentId: i1.id, payroll: 'plant', month: 11, year: 2026, amount: 3334 }, SYS);
    throw new Error('employee failed mid-Stage 7');
  })()).toThrow('employee failed');
  expect(db.prepare('SELECT COUNT(*) n FROM loan_deductions').get().n).toBe(0);
  expect(instalments(db, loanId)[0].status).toBe('scheduled');
});

test('the engine never writes a salary table', () => {
  const tables = ['salary_computations', 'sales_salary_computations', 'day_calculations', 'employees', 'sales_employees'];
  const count = () => tables.map((t) => db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all());
  const emp = require('./helpers/loanFixture').plant(db);
  db.prepare(`INSERT INTO salary_computations (employee_code, month, year, company, gross_salary, gross_earned, total_deductions, net_salary, loan_recovery)
              VALUES (?, 9, 2026, ?, 20000, 20000, 1800, 18200, 0)`).run(emp.code, COMPANY);
  const before = JSON.stringify(count());
  const { loanId } = activeLoan(db, { emp });
  for (const i of instalments(db, loanId)) deductAndPost(db, loanId, i, i.amount_due);
  expect(JSON.stringify(count())).toBe(before);
});

test('the 12-month simulation script exits 0 (SPEC §9.3 gate A → B)', () => {
  const { execFileSync } = require('child_process');
  const path = require('path');
  const out = execFileSync(process.execPath, [path.join(__dirname, '..', '..', 'scripts', 'loans-engine-simulation.js')], { encoding: 'utf8' });
  expect(out).toMatch(/12 months simulated; every loan reconciles to the paisa every month/);
});
