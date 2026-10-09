/**
 * Loans PR-1 — Mark Left no longer closes loans (defect D6, K20, K21).
 *
 * Drives the real employees router over HTTP on a real initSchema() database.
 * Mark Left must flag the leaver's open plant loans for exit recovery, write one
 * loan_events row and one audit_log row per loan, and move no money.
 *
 * Loans PR-7 changed one PR-1 promise on purpose: an active loan's schedule is
 * no longer left untouched — it collapses into the final month (the month of
 * the exit date), because the whole outstanding falls due in the final payroll
 * (SPEC §5.2 r11, D-15). The flag / status / borrower_left event / audit row
 * assertions are unchanged; the consolidation's own events are checked apart.
 */
const { startApi } = require('./helpers/apiHarness');

const COMPANY = 'Indriyan Beverages Pvt Ltd';
let api;
let db;

beforeAll(() => {
  api = startApi({ '/api/employees': '../../routes/employees' }, { role: 'hr', username: 'hr1' });
  db = api.db;
});
afterAll(async () => { await api.close(); });

function addEmployee(code) {
  db.prepare(`INSERT INTO employees (code, name, company, employment_type, status, date_of_joining)
              VALUES (?, 'TEST', ?, 'Permanent', 'Active', '2024-01-01')`).run(code, COMPANY);
}
function addLoan(code, over = {}) {
  const v = { borrower_type: 'plant', status: 'active', principal: 6000, balance: 6000, ...over };
  return db.prepare(`
    INSERT INTO loans (borrower_type, employee_code, company, loan_type, principal_amount,
                       tenure_months, emi_amount, status, requested_by, remaining_balance)
    VALUES (?, ?, ?, 'Personal', ?, 3, 2000, ?, 'hr2', ?)
  `).run(v.borrower_type, code, COMPANY, v.principal, v.status, v.balance).lastInsertRowid;
}
function addInstalments(loanId) {
  const ins = db.prepare(`INSERT INTO loan_instalments (loan_id, sequence, due_month, due_year, amount_due)
                          VALUES (?, ?, ?, 2026, 2000)`);
  for (let i = 1; i <= 3; i++) ins.run(loanId, i, 9 + i);
}
const loan = (id) => db.prepare('SELECT * FROM loans WHERE id = ?').get(id);
const events = (id) => db.prepare('SELECT * FROM loan_events WHERE loan_id = ? ORDER BY id').all(id);
const loanAudits = (id) => db.prepare("SELECT * FROM audit_log WHERE table_name = 'loans' AND record_id = ?").all(id);
const markLeft = (code, body = { date_of_leaving: '2026-10-05', reason: 'Resigned' }) =>
  api.request('PUT', `/api/employees/${code}/mark-left`, { body });

test('an active loan becomes recover_at_exit; balance untouched, schedule collapses into the exit month', async () => {
  addEmployee('ML01');
  const id = addLoan('ML01');
  addInstalments(id);
  const res = await markLeft('ML01');
  expect(res.status).toBe(200);
  expect(res.body.success).toBe(true);
  expect(db.prepare("SELECT status FROM employees WHERE code = 'ML01'").get().status).toBe('Left');

  const l = loan(id);
  expect(l.status).toBe('recover_at_exit');
  expect(l.exit_flag).toBe(1);
  expect(l.exit_date).toBe('2026-10-05');
  expect(l.exit_flagged_by).toBe('hr1');
  expect(l.exit_flagged_at).toBeTruthy();
  expect(l.remaining_balance).toBe(6000);
  expect(l.written_off_amount).toBe(0);
  // Loans PR-7: exit 2026-10-05 → final month Oct 2026 holds the whole ₹6,000; Nov and Dec are cancelled.
  const inst = db.prepare('SELECT sequence, due_month, amount_due, status FROM loan_instalments WHERE loan_id = ? ORDER BY sequence').all(id);
  expect(inst).toEqual([
    { sequence: 1, due_month: 10, amount_due: 6000, status: 'scheduled' },
    { sequence: 2, due_month: 11, amount_due: 2000, status: 'cancelled' },
    { sequence: 3, due_month: 12, amount_due: 2000, status: 'cancelled' },
  ]);

  const ev = events(id);
  expect(ev.map((e) => e.event)).toEqual(['borrower_left', 'instalment_cancelled', 'instalment_cancelled', 'instalment_increased', 'exit_consolidated']);
  expect(ev[0]).toMatchObject({ event: 'borrower_left', from_state: 'active', to_state: 'recover_at_exit', amount: 6000, actor: 'hr1' });
  expect(ev[0].reason).toMatch(/2026-10-05.*Resigned/);
  const au = loanAudits(id).filter((a) => a.stage === 'loan_exit');
  expect(au).toHaveLength(1);
  expect(au[0]).toMatchObject({ field_name: 'status', old_value: 'active', new_value: 'recover_at_exit', stage: 'loan_exit' });
  const empAudit = db.prepare("SELECT remark FROM audit_log WHERE table_name = 'employees' ORDER BY id DESC LIMIT 1").get();
  expect(empAudit.remark).toMatch(/1 loan\(s\) flagged for exit recovery/);
});

test('requested and approved loans keep their status and only get the exit flag', async () => {
  addEmployee('ML02');
  const req = addLoan('ML02', { status: 'requested' });
  const appr = addLoan('ML02', { status: 'approved' });
  expect((await markLeft('ML02')).status).toBe(200);
  for (const [id, st] of [[req, 'requested'], [appr, 'approved']]) {
    expect(loan(id)).toMatchObject({ status: st, exit_flag: 1, remaining_balance: 6000 });
    expect(events(id)).toHaveLength(1);
    expect(events(id)[0]).toMatchObject({ from_state: st, to_state: st });
  }
});

test('closed-out loans and a sales loan with the same code are left alone', async () => {
  addEmployee('ML03');
  const done = addLoan('ML03', { status: 'completed', balance: 0 });
  const rej = addLoan('ML03', { status: 'rejected' });
  const sales = addLoan('ML03', { borrower_type: 'sales' });
  const before = [done, rej, sales].map(loan);
  expect((await markLeft('ML03')).status).toBe(200);
  expect([done, rej, sales].map(loan)).toEqual(before);
  for (const id of [done, rej, sales]) expect(events(id)).toEqual([]);
});

test('an employee with no loans can still be marked Left', async () => {
  addEmployee('ML04');
  const res = await markLeft('ML04', {});
  expect(res.status).toBe(200);
  expect(db.prepare("SELECT status FROM employees WHERE code = 'ML04'").get().status).toBe('Left');
});

test('reactivated (Stage 6) then marked Left again: the flag holds, no second event', async () => {
  addEmployee('ML05');
  const id = addLoan('ML05');
  expect((await markLeft('ML05')).status).toBe(200);
  const firstEvents = events(id).length;
  db.prepare("UPDATE employees SET status = 'Active' WHERE code = 'ML05'").run();   // L2-style reactivation
  expect(loan(id)).toMatchObject({ status: 'recover_at_exit', exit_flag: 1 });     // lives on the loan
  expect((await markLeft('ML05', { date_of_leaving: '2026-10-20' })).status).toBe(200);
  expect(loan(id)).toMatchObject({ status: 'recover_at_exit', exit_flag: 1, exit_date: '2026-10-05' });
  expect(events(id).filter((e) => e.event === 'borrower_left')).toHaveLength(1);
  expect(events(id)).toHaveLength(firstEvents);   // the second Mark Left writes nothing
});

test('the old loan tables are never written (the legacy view would refuse)', async () => {
  addEmployee('ML06');
  addLoan('ML06');
  expect((await markLeft('ML06')).status).toBe(200);
  expect(db.prepare("SELECT type FROM sqlite_master WHERE name = 'loan_repayments'").get().type).toBe('view');
});
