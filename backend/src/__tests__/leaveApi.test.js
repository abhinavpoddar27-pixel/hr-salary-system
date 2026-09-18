/**
 * Route-level specs for the leave-automation API, driven over a real socket.
 * The harness points DATA_DIR at a temp directory before database/db.js loads,
 * so nothing here can touch a real database.
 */
const { startApi } = require('./helpers/apiHarness');

const YEAR = 2026;
const CO = 'Indriyan Beverages Pvt Ltd';

let api;
let db;

beforeAll(() => {
  api = startApi({
    '/api/features': '../../routes/phase5',
    '/api/leaves': '../../routes/leaves',
    '/api/portal': '../../routes/employeePortal',
    '/api/finance-audit': '../../routes/financeAudit',
  });
  db = api.db;
});

afterAll(async () => { await api.close(); });

beforeEach(() => {
  for (const t of ['leave_external_grants', 'leave_change_flags', 'leave_recompute_runs',
    'leave_balances', 'leave_applications', 'leave_transactions', 'day_calculations',
    'monthly_imports', 'employees', 'leave_accrual_ledger', 'attendance_processed', 'audit_log']) {
    db.prepare(`DELETE FROM ${t}`).run();
  }
  db.prepare("UPDATE policy_config SET value = 'false' WHERE key = 'leave_automation_enabled'").run();
  db.prepare("UPDATE policy_config SET value = 'false' WHERE key = 'leave_external_grants_acknowledged'").run();
});

function addEmployee(code, over = {}) {
  const info = db.prepare(`
    INSERT INTO employees (code, name, department, company, employment_type, status, date_of_joining, gross_salary)
    VALUES (?, ?, 'PRODUCTION', ?, ?, 'Active', ?, 20000)
  `).run(code, over.name || 'TEST NAME', over.company ?? CO,
    over.employment_type || 'Permanent', over.date_of_joining || '2023-01-01');
  return { code, id: info.lastInsertRowid };
}

function addDayCalc(emp, month, days) {
  db.prepare(`
    INSERT INTO day_calculations (employee_code, month, year, company, days_present, total_payable_days)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(emp.code, month, YEAR, CO, days, days);
}

describe('role guards', () => {
  test('the recompute preview is admin only', async () => {
    expect((await api.request('GET', `/api/features/leave-recompute/preview?year=${YEAR}`, { role: 'hr' })).status).toBe(403);
    expect((await api.request('GET', `/api/features/leave-recompute/preview?year=${YEAR}`, { role: 'finance' })).status).toBe(403);
    expect((await api.request('GET', `/api/features/leave-recompute/preview?year=${YEAR}`, { role: 'viewer' })).status).toBe(403);
    expect((await api.request('GET', `/api/features/leave-recompute/preview?year=${YEAR}`, { role: 'admin' })).status).toBe(200);
  });

  test('POST /accrue-leaves is no longer wide open (defect j)', async () => {
    const denied = await api.request('POST', '/api/features/accrue-leaves', { body: { month: 1, year: YEAR }, role: 'viewer' });
    expect(denied.status).toBe(403);
    expect((await api.request('POST', '/api/features/accrue-leaves', { body: { month: 1, year: YEAR }, role: 'hr' })).status).toBe(200);
  });

  test('automation status is HR or admin; settings are admin only', async () => {
    expect((await api.request('GET', '/api/features/leave-automation/status', { role: 'hr' })).status).toBe(200);
    expect((await api.request('GET', '/api/features/leave-automation/status', { role: 'viewer' })).status).toBe(403);
    expect((await api.request('POST', '/api/features/leave-automation/settings', { body: { automation_enabled: true }, role: 'hr' })).status).toBe(403);
    expect((await api.request('POST', '/api/features/leave-automation/settings', { body: { automation_enabled: true }, role: 'admin' })).status).toBe(200);
  });

  test('/api/leaves reads are open to viewers, writes are not (defect k)', async () => {
    expect((await api.request('GET', '/api/leaves', { role: 'viewer' })).status).toBe(200);
    expect((await api.request('GET', '/api/leaves', { role: 'finance' })).status).toBe(200);

    const asViewer = await api.request('POST', '/api/leaves/adjust', {
      body: { employee_code: 'X', leave_type: 'EL', transaction_type: 'Credit', days: 5, reason: 'nope' },
      role: 'viewer',
    });
    expect(asViewer.status).toBe(403);
    expect((await api.request('PUT', '/api/leaves/1/approve', { role: 'finance' })).status).toBe(403);
  });
});

describe('leave-recompute preview and apply (ruling 9)', () => {
  test('preview is a dry run and reports why apply is blocked', async () => {
    const e = addEmployee('A100');
    addDayCalc(e, 1, 26);

    const before = db.prepare('SELECT COUNT(*) c FROM leave_accrual_ledger').get().c;
    const res = await api.request('GET', `/api/features/leave-recompute/preview?year=${YEAR}`);
    expect(res.status).toBe(200);
    expect(res.body.can_apply).toBe(false);
    expect(res.body.totals.employees).toBe(1);
    expect(res.body.employees[0].employee_code).toBe('A100');
    expect(res.body.employees[0].days_worked_ytd).toBe(26);
    expect(db.prepare('SELECT COUNT(*) c FROM leave_accrual_ledger').get().c).toBe(before);
  });

  test('preview carries employee codes only, never names', async () => {
    addEmployee('A101', { name: 'REAL PERSON NAME' });
    const res = await api.request('GET', `/api/features/leave-recompute/preview?year=${YEAR}`);
    expect(JSON.stringify(res.body)).not.toContain('REAL PERSON NAME');
    const csv = await api.request('GET', `/api/features/leave-recompute/preview?year=${YEAR}&format=csv`, { raw: true });
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.text.charCodeAt(0)).toBe(0xFEFF); // UTF-8 BOM
    expect(csv.text).toContain('A101');
    expect(csv.text).not.toContain('REAL PERSON NAME');
    // Separate year and month integer columns — no DD-MM-YYYY strings.
    expect(csv.text).not.toMatch(/\d{2}-\d{2}-\d{4}/);
  });

  test('apply refuses until the outside-system EL list is uploaded or waived', async () => {
    const e = addEmployee('A102');
    addDayCalc(e, 1, 26);

    const blocked = await api.request('POST', '/api/features/leave-recompute/apply', { body: { year: YEAR, confirm: true } });
    expect(blocked.status).toBe(409);
    expect(blocked.body.reason).toBe('external_grants_not_acknowledged');
    expect(db.prepare('SELECT COUNT(*) c FROM leave_accrual_ledger').get().c).toBe(0);

    expect((await api.request('POST', '/api/features/leave-external-grants/acknowledge-none')).status).toBe(200);

    const ok = await api.request('POST', '/api/features/leave-recompute/apply', { body: { year: YEAR, confirm: true, note: 'first run' } });
    expect(ok.status).toBe(200);
    expect(ok.body.written.ledger).toBeGreaterThan(0);
    expect(db.prepare('SELECT COUNT(*) c FROM leave_accrual_ledger').get().c).toBeGreaterThan(0);
  });

  test('apply without confirm: true is refused', async () => {
    const res = await api.request('POST', '/api/features/leave-recompute/apply', { body: { year: YEAR } });
    expect(res.status).toBe(400);
  });
});

describe('external EL grants', () => {
  const XLSX = require('xlsx');
  const sheet = (rows) => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Sheet1');
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  };

  const upload = (buffer, query = '') => new Promise((resolve, reject) => {
    const http = require('http');
    const boundary = '----leavetest';
    const head = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="el.xlsx"\r\n` +
      'Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n'
    );
    const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
    const payload = Buffer.concat([head, buffer, tail]);
    const req = http.request({
      host: '127.0.0.1', port: api.server.address().port, method: 'POST',
      path: `/api/features/leave-external-grants/upload${query}`,
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': payload.length },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
        resolve({ status: res.statusCode, body: json, text });
      });
    });
    req.on('error', reject);
    req.write(payload); req.end();
  });

  test('a dry run reports accept/reject per row and writes nothing', async () => {
    addEmployee('G001');
    addEmployee('G002', { employment_type: 'Contract' });
    const buf = sheet([
      { 'Employee Code': 'G001', 'Employee Name': 'X', Company: CO, Year: YEAR, Month: 3, 'EL Days': 2, 'How Given': 'Leave taken', Remark: 'ok' },
      { 'Employee Code': 'G002', 'Employee Name': 'Y', Company: CO, Year: YEAR, Month: 3, 'EL Days': 1, 'How Given': 'Paid in cash', Remark: '' },
      { 'Employee Code': 'NOPE', 'Employee Name': 'Z', Company: CO, Year: YEAR, Month: 3, 'EL Days': 1, 'How Given': 'Leave taken', Remark: '' },
      { 'Employee Code': 'G001', 'Employee Name': 'X', Company: CO, Year: YEAR, Month: 13, 'EL Days': 1, 'How Given': 'Leave taken', Remark: '' },
      { 'Employee Code': 'G001', 'Employee Name': 'X', Company: CO, Year: YEAR, Month: 4, 'EL Days': 1, 'How Given': 'Sent by post', Remark: '' },
    ]);

    const dry = await upload(buf);
    expect(dry.status).toBe(200);
    expect(dry.body.dryRun).toBe(true);
    expect(dry.body.totals).toEqual({ rows: 5, accepted: 1, rejected: 4 });
    const reasons = dry.body.rows.filter((r) => !r.accepted).map((r) => r.reason);
    expect(reasons).toEqual(expect.arrayContaining([
      'Contractors do not accrue leave',
      'No employee with that code',
      'Month must be 1-12',
      expect.stringContaining('How Given'),
    ]));
    expect(db.prepare('SELECT COUNT(*) c FROM leave_external_grants').get().c).toBe(0);
  });

  test('a committed upload inserts and unblocks apply', async () => {
    addEmployee('G010');
    const buf = sheet([
      { 'Employee Code': 'G010', Year: YEAR, Month: 5, 'EL Days': 3, 'How Given': 'Paid in salary', 'Paid In Salary Month': 6, 'Paid In Salary Year': YEAR },
    ]);
    const res = await upload(buf, '?dryRun=false');
    expect(res.status).toBe(200);
    expect(res.body.totals.accepted).toBe(1);

    const row = db.prepare('SELECT * FROM leave_external_grants').get();
    expect(row.mode).toBe('paid_salary');
    expect(row.days).toBe(3);
    expect(row.paid_month).toBe(6);
    expect(db.prepare("SELECT value FROM policy_config WHERE key='leave_external_grants_acknowledged'").get().value).toBe('true');

    // Re-uploading the same row is rejected as a duplicate.
    expect((await upload(buf, '?dryRun=false')).body.totals.rejected).toBe(1);

    // And it is soft-deletable.
    const del = await api.request('DELETE', `/api/features/leave-external-grants/${row.id}`);
    expect(del.status).toBe(200);
    expect(db.prepare('SELECT is_active FROM leave_external_grants WHERE id = ?').get(row.id).is_active).toBe(0);
  });
});

describe('automation status, flags and staleness', () => {
  test('status reports the switches, flags and stale counts', async () => {
    const e = addEmployee('S001');
    addDayCalc(e, 3, 20);
    db.prepare("UPDATE day_calculations SET salary_stale = 1 WHERE employee_code = 'S001'").run();
    db.prepare(`INSERT INTO leave_change_flags (employee_code, company, month, year, reason) VALUES ('S001', ?, 3, ?, 'leave_approved')`).run(CO, YEAR);

    const res = await api.request('GET', `/api/features/leave-automation/status?year=${YEAR}`);
    expect(res.status).toBe(200);
    expect(res.body.automation_enabled).toBe(false);
    expect(res.body.auto_stage6_enabled).toBe(true);
    expect(res.body.open_flags).toBe(1);
    expect(res.body.stale_salary).toEqual([{ month: 3, year: YEAR, company: CO, c: 1 }]);
  });

  test('settings flip the policy keys and report what changed', async () => {
    const on = await api.request('POST', '/api/features/leave-automation/settings', { body: { automation_enabled: true } });
    expect(on.body.automation_enabled).toBe(true);
    expect(on.body.changed).toEqual([{ key: 'leave_automation_enabled', from: 'false', to: 'true' }]);
    // Setting it again is a no-op, not a second audit entry.
    const again = await api.request('POST', '/api/features/leave-automation/settings', { body: { automation_enabled: true } });
    expect(again.body.changed).toEqual([]);
  });

  test('a flag can be cleared once', async () => {
    db.prepare(`INSERT INTO leave_change_flags (employee_code, company, month, year, reason) VALUES ('F1', ?, 3, ?, 'x')`).run(CO, YEAR);
    const list = await api.request('GET', `/api/features/leave-change-flags?year=${YEAR}`, { role: 'hr' });
    expect(list.body.count).toBe(1);
    const id = list.body.data[0].id;
    expect((await api.request('POST', `/api/features/leave-change-flags/${id}/clear`, { role: 'hr' })).status).toBe(200);
    expect((await api.request('POST', `/api/features/leave-change-flags/${id}/clear`, { role: 'hr' })).status).toBe(404);
    expect((await api.request('GET', `/api/features/leave-change-flags?year=${YEAR}`, { role: 'hr' })).body.count).toBe(0);
  });

  test('salary-stale returns a count and the codes', async () => {
    const e = addEmployee('S010');
    addDayCalc(e, 4, 20);
    db.prepare("UPDATE day_calculations SET salary_stale = 1").run();
    const res = await api.request('GET', `/api/features/salary-stale?month=4&year=${YEAR}&company=${encodeURIComponent(CO)}`, { role: 'hr' });
    expect(res.body).toMatchObject({ count: 1, employeeCodes: ['S010'] });
  });

  test('the lapse report previews without writing', async () => {
    const e = addEmployee('L001');
    db.prepare('INSERT INTO leave_balances (employee_id, year, leave_type, opening, balance) VALUES (?, ?, ?, 7, 4)').run(e.id, YEAR, 'CL');
    const res = await api.request('GET', `/api/features/leave-lapse-report?year=${YEAR}`, { role: 'finance' });
    expect(res.body.already_run).toBe(false);
    expect(res.body.totals).toEqual({ rows: 1, cl_days: 4, el_days: 0 });
    expect(db.prepare('SELECT balance FROM leave_balances WHERE employee_id = ?').get(e.id).balance).toBe(4);
  });
});

describe('employee portal (defect i)', () => {
  test('leave history orders by applied_at instead of a column that does not exist', async () => {
    const e = addEmployee('P001');
    const ins = db.prepare(`INSERT INTO leave_applications (employee_id, employee_code, leave_type, start_date, end_date, days, status, applied_at)
                VALUES (?, 'P001', 'EL', ?, ?, 1, 'Approved', ?)`);
    ins.run(e.id, '2026-03-01', '2026-03-01', '2026-03-01 10:00:00');
    ins.run(e.id, '2026-04-01', '2026-04-01', '2026-04-05 10:00:00');

    const res = await api.request('GET', '/api/portal/leave-history', { role: 'employee', employeeCode: 'P001' });
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0].start_date).toBe('2026-04-01'); // newest first
  });

  test('leave-apply validates the type, the dates, the balance and the month', async () => {
    const e = addEmployee('P002');
    const as = { role: 'employee', employeeCode: 'P002' };
    const apply = (body) => api.request('POST', '/api/portal/leave-apply', { body, ...as });

    const bad = await apply({ leave_type: 'SL', start_date: '2026-03-01', end_date: '2026-03-01', days: 1 });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toContain('SL is no longer supported');

    expect((await apply({ leave_type: 'EL', start_date: '2026-03-05', end_date: '2026-03-01', days: 1 })).status).toBe(400);
    expect((await apply({ leave_type: 'EL', start_date: '2026-03-01', end_date: '2026-03-01', days: -2 })).status).toBe(400);

    // No balance yet.
    const broke = await apply({ leave_type: 'EL', start_date: '2026-03-01', end_date: '2026-03-01', days: 1 });
    expect(broke.status).toBe(400);
    expect(broke.body.error).toContain('Insufficient EL balance');

    db.prepare('INSERT INTO leave_balances (employee_id, year, leave_type, opening, balance) VALUES (?, ?, ?, 5, 5)').run(e.id, YEAR, 'EL');

    // Finalized month is closed.
    db.prepare(`INSERT INTO monthly_imports (month, year, company, file_name, status, is_finalised)
                VALUES (3, ?, ?, 'x.xls', 'imported', 1)`).run(YEAR, CO);
    const finalized = await apply({ leave_type: 'EL', start_date: '2026-03-01', end_date: '2026-03-01', days: 1 });
    expect(finalized.status).toBe(400);
    expect(finalized.body.error).toContain('finalized month');

    // An open month with balance goes through, and employee_id is set.
    const ok = await apply({ leave_type: 'EL', start_date: '2026-04-01', end_date: '2026-04-01', days: 1 });
    expect(ok.status).toBe(200);
    const app = db.prepare("SELECT * FROM leave_applications WHERE employee_code = 'P002'").get();
    expect(app.employee_id).toBe(e.id);
    expect(app.status).toBe('Pending');
  });
});

describe('finance apply-leave rewrite (defect h)', () => {
  const absent = (emp, date) => db.prepare(`
    INSERT INTO attendance_processed (employee_code, date, month, year, company, status_original, status_final, is_night_out_only)
    VALUES (?, ?, 3, ?, ?, 'A', 'A', 0)
  `).run(emp.code, date, YEAR, CO);

  const post = (body, role = 'finance') =>
    api.request('POST', '/api/finance-audit/corrections/apply-leave', { body, role });

  test('HR cannot reach it; finance and admin can', async () => {
    expect((await post({}, 'hr')).status).toBe(403);
    expect((await post({}, 'viewer')).status).toBe(403);
    expect((await post({}, 'finance')).status).toBe(400); // past the gate, missing fields
  });

  test('a negative balance is blocked rather than written into the red', async () => {
    const e = addEmployee('FA01');
    absent(e, '2026-03-10');
    const res = await post({ employee_code: 'FA01', date: '2026-03-10', leave_type: 'CL', month: 3, year: YEAR, reason: 'sick' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('balance is 0');
    expect(db.prepare("SELECT status_final FROM attendance_processed WHERE employee_code='FA01'").get().status_final).toBe('A');
  });

  test('a finalized month is refused', async () => {
    const e = addEmployee('FA02');
    absent(e, '2026-03-10');
    db.prepare('INSERT INTO leave_balances (employee_id, year, leave_type, opening, balance) VALUES (?, ?, ?, 7, 7)').run(e.id, YEAR, 'CL');
    db.prepare(`INSERT INTO monthly_imports (month, year, company, file_name, status, is_finalised)
                VALUES (3, ?, ?, 'x.xls', 'imported', 1)`).run(YEAR, CO);
    const res = await post({ employee_code: 'FA02', date: '2026-03-10', leave_type: 'CL', month: 3, year: YEAR, reason: 'sick' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('finalized month');
  });

  test('a valid correction creates an approved application and no longer hand-patches day_calculations', async () => {
    const e = addEmployee('FA03');
    absent(e, '2026-03-11');
    db.prepare('INSERT INTO leave_balances (employee_id, year, leave_type, opening, balance) VALUES (?, ?, ?, 7, 7)').run(e.id, YEAR, 'CL');
    addDayCalc(e, 3, 20);
    const before = db.prepare("SELECT total_payable_days, cl_used FROM day_calculations WHERE employee_code='FA03'").get();

    const res = await post({ employee_code: 'FA03', date: '2026-03-11', leave_type: 'CL', month: 3, year: YEAR, reason: 'family emergency' });
    expect(res.status).toBe(200);
    expect(res.body.application_id).toBeTruthy();
    expect(res.body.new_balance).toBe(6);

    const app = db.prepare('SELECT * FROM leave_applications WHERE id = ?').get(res.body.application_id);
    expect(app).toMatchObject({ employee_code: 'FA03', leave_type: 'CL', status: 'Approved', days: 1 });
    expect(app.employee_id).toBe(e.id);
    expect(db.prepare("SELECT status_final, correction_source FROM attendance_processed WHERE employee_code='FA03'").get())
      .toEqual({ status_final: 'CL', correction_source: 'leave_correction' });

    // day_calculations is Stage 6's to own now.
    expect(db.prepare("SELECT total_payable_days, cl_used FROM day_calculations WHERE employee_code='FA03'").get()).toEqual(before);
  });

  test('a missing reason is refused', async () => {
    const e = addEmployee('FA04');
    absent(e, '2026-03-12');
    db.prepare('INSERT INTO leave_balances (employee_id, year, leave_type, opening, balance) VALUES (?, ?, ?, 7, 7)').run(e.id, YEAR, 'CL');
    const res = await post({ employee_code: 'FA04', date: '2026-03-12', leave_type: 'CL', month: 3, year: YEAR, reason: '   ' });
    expect(res.status).toBe(400);
  });
});
