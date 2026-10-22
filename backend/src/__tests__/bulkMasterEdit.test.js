/**
 * P5-02 — bulk employee master edit. Two kinds on the bulk engine:
 *   master-edit            direct (shift, department, designation, contractor group)
 *   master-edit-sensitive  finance approval (bank, PAN, UAN, ESI number, company; leaving)
 * Real routers behind the REAL requireAuth with real JWTs, on a temp DB built by initSchema(). Fictional codes (T80xx).
 * Parity: PUT /employees/bulk-shift and /:code/mark-left are compared with the verbatim b2badcab handlers.
 */
const { startJwtApi } = require('./helpers/jwtApiHarness');

let api; let db;
const CO = 'Indriyan Beverages Pvt Ltd';
const CO2 = 'Asian Lakto Ind Ltd';

beforeAll(() => {
  api = startJwtApi({
    '/api/bulk': '../../routes/bulk',
    '/api/employees': '../../routes/employees',
    '/api/old-emp': require.resolve('./helpers/__p502OldEmployeeRoutes'),
  }, { users: [
    { username: 'hr1', role: 'hr' }, { username: 'fin1', role: 'finance' }, { username: 'admin1', role: 'admin' },
    { username: 'view1', role: 'viewer' }, { username: 'sup1', role: 'supervisor' },
  ] });
  db = api.db;
  db.prepare("INSERT OR IGNORE INTO shifts (code, name, start_time, end_time) VALUES ('ZZA', 'Test shift A', '08:00', '20:00')").run();
  db.prepare("INSERT OR IGNORE INTO shifts (code, name, start_time, end_time) VALUES ('ZZB', 'Test shift B', '09:00', '19:00')").run();
});
afterAll(() => api.close());

const RESET = `DELETE FROM bulk_rows; DELETE FROM bulk_batches; DELETE FROM audit_log; DELETE FROM notifications;
  DELETE FROM salary_computations; DELETE FROM day_calculations;
  DELETE FROM monthly_imports; DELETE FROM usage_logs; DELETE FROM employees;`;
beforeEach(() => { db.exec(RESET); });

const shiftId = (code) => db.prepare('SELECT id FROM shifts WHERE code = ?').get(code).id;
let seq = 0;
function person(over = {}) {
  const code = over.code || `T80${String(++seq).padStart(2, '0')}`;
  const v = { name: 'TEST PERSON', department: 'PRODUCTION', designation: 'OPERATOR', company: CO, employment_type: 'Permanent',
    status: 'Active', date_of_joining: '2024-01-01', ...over };
  const id = db.prepare(`INSERT INTO employees (code, name, department, designation, company, employment_type, status, date_of_joining,
      default_shift_id, shift_code, account_number, bank_account, ifsc_code, ifsc, bank_name, pan, uan, esi_number, contractor_group, is_contractor)
    VALUES (@code, @name, @department, @designation, @company, @employment_type, @status, @date_of_joining, @default_shift_id, @shift_code,
      @account, @account, @ifsc, @ifsc, @bank_name, @pan, @uan, @esi_number, @contractor_group, @is_contractor)`).run({
    code, default_shift_id: null, shift_code: 'DAY', account: null, ifsc: null, bank_name: null, pan: null, uan: null, esi_number: null,
    contractor_group: null, is_contractor: 0, ...v,
  }).lastInsertRowid;
  return { id: Number(id), code };
}
const emp = (p) => db.prepare('SELECT * FROM employees WHERE id = ?').get(p.id);
const audits = (where = '1=1') => db.prepare(`SELECT * FROM audit_log WHERE ${where} ORDER BY id`).all();
const post = (url, body, as = 'hr1') => api.request('POST', url, { as, body });

async function check(kind, rows, common = {}, as = 'hr1') {
  const p = await post(`/api/bulk/${kind}/preview`, { common, rows }, as);
  return p;
}
/** Preview then save (apply / submit) every group. */
async function save(kind, rows, common = {}, as = 'hr1') {
  const p = await check(kind, rows, common, as);
  expect(p.status).toBe(200);
  const byNo = new Map(p.body.rows.map(r => [r.rowNo, r]));
  const verb = p.body.requiresApproval ? 'submit' : 'apply';
  const out = [];
  for (const g of p.body.groups) {
    out.push(await post(`/api/bulk/${kind}/${verb}`, { common, planHash: g.planHash, groupId: 'g', groupIndex: g.index,
      groupSize: p.body.groups.length, rows: g.rowNos.map(n => byNo.get(n).input) }, as));
  }
  return { p, out };
}
const act = (id, what, as, body = {}) => post(`/api/bulk/batches/${id}/${what}`, body, as);

/* ── parity: the extracted helpers change nothing on the single routes ── */
const VOL = new Set(['id', 'created_at', 'updated_at', 'changed_at', 'exit_flagged_at', 'loan_id', 'record_id', 'instalment_id']);
const clean = (rows) => rows.map(r => Object.fromEntries(Object.entries(r).filter(([k]) => !VOL.has(k))));
/** Everything a code touched, with the code itself replaced so two runs on two codes compare equal. */
function snapshot(code) {
  return JSON.parse(JSON.stringify(rawSnapshot(code)).split(code).join('CODE'));
}
function rawSnapshot(code) {
  return {
    emp: clean(db.prepare('SELECT * FROM employees WHERE code = ?').all(code)),
    loans: clean(db.prepare('SELECT * FROM loans WHERE employee_code = ? ORDER BY id').all(code)),
    inst: clean(db.prepare('SELECT i.* FROM loan_instalments i JOIN loans l ON l.id = i.loan_id WHERE l.employee_code = ? ORDER BY i.id').all(code)),
    events: clean(db.prepare('SELECT e.* FROM loan_events e JOIN loans l ON l.id = e.loan_id WHERE l.employee_code = ? ORDER BY e.id').all(code)),
    audit: clean(db.prepare('SELECT * FROM audit_log ORDER BY id').all()),
    notes: clean(db.prepare('SELECT * FROM notifications ORDER BY id').all()),
  };
}
function addLoan(code, status = 'active') {
  const id = db.prepare(`INSERT INTO loans (borrower_type, employee_code, company, loan_type, principal_amount, tenure_months, emi_amount,
    status, requested_by, remaining_balance) VALUES ('plant', ?, ?, 'Personal', 6000, 3, 2000, ?, 'hr2', 6000)`).run(code, CO, status).lastInsertRowid;
  const ins = db.prepare('INSERT INTO loan_instalments (loan_id, sequence, due_month, due_year, amount_due) VALUES (?, ?, ?, 2026, 2000)');
  if (status === 'active') for (let i = 1; i <= 3; i++) ins.run(id, i, 9 + i);
  return Number(id);
}

describe('parity with the b2badcab handlers', () => {
  test('PUT /bulk-shift: same reply, same employees rows, same audit rows', async () => {
    const results = [];
    for (const base of ['/api/old-emp', '/api/employees']) {
      db.exec(RESET);
      const a = person({ code: 'T8901', default_shift_id: shiftId('ZZA'), shift_code: 'ZZA' });
      person({ code: 'T8902', shift_code: '' });
      const res = await api.request('PUT', `${base}/bulk-shift`, { as: 'hr1', body: { employeeCodes: ['T8901', 'T8902', 'NOPE'], shiftId: shiftId('ZZB') } });
      results.push({ res: res.body, a: snapshot('T8901'), b: snapshot('T8902') });
      expect(emp(a).shift_code).toBe('ZZB');
    }
    expect(results[1]).toEqual(results[0]);
    expect(results[0].a.audit.length).toBe(2);
  });

  test('PUT /:code/mark-left: same reply, employee, loans, instalments, events, audit, notifications', async () => {
    const results = [];
    for (const [base, code] of [['/api/old-emp', 'T8911'], ['/api/employees', 'T8912']]) {
      db.exec(RESET);
      person({ code });
      addLoan(code, 'active'); addLoan(code, 'requested');
      const res = await api.request('PUT', `${base}/${code}/mark-left`, { as: 'hr1', body: { date_of_leaving: '2026-10-05', reason: 'Resigned' } });
      const again = await api.request('PUT', `${base}/${code}/mark-left`, { as: 'hr1', body: { date_of_leaving: '2026-10-05' } });
      const missing = await api.request('PUT', `${base}/NOPE/mark-left`, { as: 'hr1', body: {} });
      const body = JSON.parse(JSON.stringify(res.body).replace(/"loanId":\d+/g, '"loanId":0').split(code).join('CODE'));
      results.push({ res: body, again: again.status, missing: missing.status, s: snapshot(code) });
    }
    expect(results[1]).toEqual(results[0]);
    expect(results[0].s.loans[0].status).toBe('recover_at_exit');
  });
});

/* ── direct kind ── */
describe('master-edit (direct)', () => {
  test('shift, department, designation apply on Save with audit rows; shift audit = the bulk-shift audit', async () => {
    const a = person({ default_shift_id: shiftId('ZZA'), shift_code: 'ZZA' });
    const b = person();
    const { p, out } = await save('master-edit', [
      { code: a.code, changes: { shift: 'zzb', department: 'STORE', designation: 'HELPER' } },
      { code: b.code, changes: { designation: 'OPERATOR' } }, // no change
    ], { fields: ['shift', 'department', 'designation'] });
    expect(p.body.requiresApproval).toBeUndefined();
    const [ra, rb] = p.body.rows;
    expect(ra.state).toBe('warning'); // STORE / HELPER are new values
    expect(ra.changeText).toMatch(/Shift: ZZA → ZZB/);
    expect(rb.state).toBe('skipped');
    expect(out[0].status).toBe(200);
    const e = emp(a);
    expect([e.default_shift_id, e.shift_code, e.department, e.designation]).toEqual([shiftId('ZZB'), 'ZZB', 'STORE', 'HELPER']);
    const shiftAudit = clean(audits("field_name = 'shift_assignment'"));
    // The same change through PUT /bulk-shift writes exactly this row.
    db.exec(RESET);
    const c = person({ code: a.code, default_shift_id: shiftId('ZZA'), shift_code: 'ZZA' });
    await api.request('PUT', '/api/employees/bulk-shift', { as: 'hr1', body: { employeeCodes: [c.code], shiftId: shiftId('ZZB') } });
    expect(clean(audits("field_name = 'shift_assignment'"))).toEqual(shiftAudit);
  });

  test('field audit rows + the batch summary row', async () => {
    const a = person();
    await save('master-edit', [{ code: a.code, changes: { department: 'PRODUCTION', designation: 'SUPERVISOR' } }], { fields: ['designation'] });
    const rows = audits("stage = 'MASTER_BULK_EDIT'");
    expect(rows).toHaveLength(1);
    expect([rows[0].field_name, rows[0].old_value, rows[0].new_value, rows[0].changed_by, rows[0].employee_code]).toEqual(['designation', 'OPERATOR', 'SUPERVISOR', 'hr1', a.code]);
    expect(audits("stage = 'BULK_CREATE'")).toHaveLength(1);
  });

  test('row checks: refused columns, sensitive field, not found, not active, unknown shift, blank department, repeat', async () => {
    const a = person(); const left = person({ status: 'Left' });
    const cases = [
      [{ pf_applicable: 1 }, /Statutory flags/], [{ gross_salary: 30000 }, /salary revision/i], [{ employment_type: 'Contract' }, /cannot be changed in bulk/],
      [{ status: 'Left' }, /Leaving columns/], [{ punch_no: '1' }, /no punch number/], [{ reporting_manager: 'X' }, /no reporting manager/],
      [{ name: 'X' }, /personal fields/], [{ code: 'T1' }, /code cannot be changed/], [{ uan: '123456789012' }, /needs finance approval/],
      [{ shift: 'NOPE' }, /does not exist/], [{ shift: '' }, /cannot be cleared/], [{ department: ' ' }, /cannot be cleared/],
      [{ whatever: 1 }, /not a field/], [{}, /Nothing to change/],
    ];
    for (const [changes, re] of cases) {
      const r = await check('master-edit', [{ code: a.code, changes }]);
      expect(r.body.rows[0].state).toBe('error');
      expect(r.body.rows[0].messages.join(' ')).toMatch(re);
    }
    const r = await check('master-edit', [{ code: 'NOPE', changes: { designation: 'X' } }, { code: left.code, changes: { designation: 'X' } },
      { code: a.code.toLowerCase(), changes: { designation: 'OPERATOR 2' } }, { code: a.code, changes: { designation: 'Y' } }]);
    expect(r.body.rows.map(x => x.state)).toEqual(['error', 'error', 'warning']);
    expect(r.body.rows[1].messages.join(' ')).toMatch(/Not active/);
    expect(r.body.rows[2].code).toBe(a.code);
    expect(r.body.rows[2].messages.join(' ')).toMatch(/Listed more than once/);
  });

  test('a department that would flip contractor status on a blank employment type is refused', async () => {
    const a = person({ employment_type: '' });
    const r = await check('master-edit', [{ code: a.code, changes: { department: 'MEERA CONT' } }]);
    expect(r.body.rows[0].state).toBe('error');
    expect(r.body.rows[0].messages.join(' ')).toMatch(/contractor/);
    const b = person();
    const r2 = await check('master-edit', [{ code: b.code, changes: { department: 'MEERA CONT' } }]);
    expect(r2.body.rows[0].state).toBe('warning');
  });

  test('stale export (base) is an error; matching base is fine; a sheet without _meta warns', async () => {
    const a = person();
    const stale = await check('master-edit', [{ code: a.code, changes: { designation: 'X' }, base: { designation: 'SOMETHING ELSE' } }]);
    expect(stale.body.rows[0].messages.join(' ')).toMatch(/changed since you downloaded/);
    const fine = await check('master-edit', [{ code: a.code, changes: { designation: 'OPERATOR 2' }, base: { designation: 'operator' } }]);
    expect(fine.body.rows[0].state).toBe('warning'); // new designation
    const noMeta = await check('master-edit', [{ code: a.code, changes: { designation: 'OPERATOR' }, noMeta: true }]);
    expect(noMeta.body.rows[0].state).toBe('skipped');
    expect(noMeta.body.rows[0].messages.join(' ')).toMatch(/No download record/);
  });

  test('51 people → 50 + 1; more than 50 in one save refused; data changed after check → 409, nothing written', async () => {
    const ps = Array.from({ length: 51 }, () => person());
    const rows = ps.map(x => ({ code: x.code, changes: { designation: 'OPERATOR' === 'X' ? '' : 'PACKER' } }));
    const p = await check('master-edit', rows);
    expect(p.body.groups.map(g => g.applyCount)).toEqual([50, 1]);
    const all = await post('/api/bulk/master-edit/apply', { common: {}, planHash: p.body.groups[0].planHash, rows });
    expect(all.status).toBe(400);
    expect(all.body.code).toBe('BULK_ROW_LIMIT');
    const g = p.body.groups[1];
    const byNo = new Map(p.body.rows.map(r => [r.rowNo, r]));
    db.prepare("UPDATE employees SET designation = 'MOVED', updated_at = '2030-01-01' WHERE code = ?").run(byNo.get(g.rowNos[0]).code);
    const res = await post('/api/bulk/master-edit/apply', { common: {}, planHash: g.planHash, rows: g.rowNos.map(n => byNo.get(n).input) });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('BULK_PLAN_CHANGED');
    expect(db.prepare("SELECT COUNT(*) n FROM employees WHERE designation = 'PACKER'").get().n).toBe(0);
  });

  test('undo restores the old values (shift via setShift); refused after a later edit', async () => {
    const a = person({ default_shift_id: shiftId('ZZA'), shift_code: 'ZZA' }); const b = person();
    const { out } = await save('master-edit', [{ code: a.code, changes: { shift: 'ZZB', designation: 'PACKER' } }]);
    const id = out[0].body.batchId;
    const u = await act(id, 'undo', 'hr1', { reason: 'wrong sheet' });
    expect(u.status).toBe(200);
    const e = emp(a);
    expect([e.default_shift_id, e.shift_code, e.designation]).toEqual([shiftId('ZZA'), 'ZZA', 'OPERATOR']);
    expect(audits("field_name = 'shift_assignment'")).toHaveLength(2);
    const { out: out2 } = await save('master-edit', [{ code: b.code, changes: { designation: 'PACKER' } }]);
    db.prepare("UPDATE employees SET designation = 'LATER' WHERE id = ?").run(b.id);
    const u2 = await act(out2[0].body.batchId, 'undo', 'hr1', { reason: 'wrong sheet' });
    expect(u2.status).toBe(409);
    expect(u2.body.code).toBe('BULK_UNDO_BLOCKED');
    expect(emp(b).designation).toBe('LATER');
  });

  test('roles: finance / viewer / supervisor cannot check or save; no token 401; direct kind has no submit', async () => {
    const a = person();
    for (const as of ['fin1', 'view1', 'sup1']) {
      expect((await check('master-edit', [{ code: a.code, changes: { designation: 'X' } }], {}, as)).status).toBe(403);
    }
    expect((await api.request('POST', '/api/bulk/master-edit/preview', { body: {} })).status).toBe(401);
    const p = await check('master-edit', [{ code: a.code, changes: { designation: 'PACKER' } }]);
    const s = await post('/api/bulk/master-edit/submit', { common: {}, planHash: p.body.groups[0].planHash, rows: [p.body.rows[0].input] });
    expect(s.status).toBe(409);
    expect((await api.request('GET', '/api/bulk/master-edit/meta', { as: 'fin1' })).status).toBe(403);
    const m = await api.request('GET', '/api/bulk/master-edit/meta', { as: 'hr1' });
    expect(m.status).toBe(200);
    expect(m.body.data.companies).toEqual([CO2, CO]);
  });

  test('export returns current values for the chosen fields', async () => {
    const a = person({ default_shift_id: shiftId('ZZA'), shift_code: 'ZZA', account: '1234567890', ifsc: 'SBIN0001234' });
    const r = await post('/api/bulk/master-edit/export', { fields: ['shift', 'account', 'ifsc', 'company'], codes: [a.code] });
    expect(r.status).toBe(200);
    expect(r.body.data[0].values).toEqual({ shift: 'ZZA', account: '1234567890', ifsc: 'SBIN0001234', company: CO });
    expect((await post('/api/bulk/master-edit/export', { fields: [] })).status).toBe(400);
  });
});

/* ── sensitive kind ── */
describe('master-edit-sensitive (finance approval)', () => {
  test('submit writes nothing; own batch refused; finance applies bank (4 columns, masked audit), PAN, UAN, ESI', async () => {
    const a = person({ account: '1111111111', ifsc: 'SBIN0000001' });
    const { p, out } = await save('master-edit-sensitive', [{ code: a.code, changes: {
      account: '22223333 44', ifsc: 'hdfc0000002', bank_name: 'HDFC', pan: 'abcde1234f', uan: '100000000001', esi_number: '2000000001' } }]);
    expect(p.body.requiresApproval).toBe(true);
    expect(p.body.rows[0].changeText).toMatch(/Bank account: \*\*\*\*1111 → \*\*\*\*3344/); // hr sees the last 4 (review fix 3)
    const id = out[0].body.batchId;
    expect(emp(a).account_number).toBe('1111111111');
    expect((await act(id, 'approve', 'hr1')).status).toBe(403);
    // admin sending, admin approving their own: refused
    const ok = await act(id, 'approve', 'fin1');
    expect(ok.status).toBe(200);
    const e = emp(a);
    expect([e.account_number, e.bank_account, e.ifsc_code, e.ifsc, e.bank_name, e.pan, e.uan, e.esi_number])
      .toEqual(['2222333344', '2222333344', 'HDFC0000002', 'HDFC0000002', 'HDFC', 'ABCDE1234F', '100000000001', '2000000001']);
    const bank = audits("stage = 'bank_details_change'");
    expect(bank.map(r => [r.field_name, r.old_value, r.new_value])).toEqual([['account_number', '****1111', '****3344'], ['ifsc_code', '****0001', '****0002']]);
    const pan = audits("stage = 'MASTER_BULK_EDIT_FINANCE' AND field_name = 'pan'")[0];
    expect(pan.new_value).toBe('****234F');
    expect(pan.remark).toMatch(/sent by hr1, approved by fin1/);
  });

  test('admin cannot approve a batch they sent', async () => {
    const a = person();
    const { out } = await save('master-edit-sensitive', [{ code: a.code, changes: { bank_name: 'SBI' } }], {}, 'admin1');
    const r = await act(out[0].body.batchId, 'approve', 'admin1');
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('SELF_APPROVAL');
  });

  test('duplicates: PAN / UAN / ESI held by another or repeated in the list → error; shared bank account → warning', async () => {
    const other = person({ pan: 'ZZZZZ9999Z', uan: '100000000009', esi_number: '2000000009', account: '5555555555' });
    const a = person(); const b = person(); const c = person();
    const r = await check('master-edit-sensitive', [
      { code: a.code, changes: { pan: 'zzzzz9999z' } },
      { code: b.code, changes: { uan: '100000000005' } }, { code: c.code, changes: { uan: '1000 0000 0005' } },
      { code: a.code + 'X', changes: {} },
    ]);
    expect(r.body.rows[0].messages.join(' ')).toMatch(new RegExp(`already belongs to employee ${other.code}`));
    expect(r.body.rows[1].messages.join(' ')).toMatch(new RegExp(`also given for ${c.code}`));
    expect(r.body.rows[2].messages.join(' ')).toMatch(new RegExp(`also given for ${b.code}`));
    const w = await check('master-edit-sensitive', [{ code: a.code, changes: { account: '5555555555', ifsc: 'SBIN0000003' } }]);
    expect(w.body.rows[0].state).toBe('warning');
    expect(w.body.rows[0].messages.join(' ')).toMatch(new RegExp(`also on employee ${other.code}`));
    const e1 = await check('master-edit-sensitive', [{ code: b.code, changes: { esi_number: '2000000009' } }]);
    expect(e1.body.rows[0].state).toBe('error');
  });

  test('format checks and the no-IFSC warning', async () => {
    const a = person();
    for (const [changes, re] of [[{ account: '12AB' }, /6 to 20 digits/], [{ ifsc: 'SBIN1234567' }, /IFSC must/], [{ pan: 'ABC12' }, /PAN must/],
      [{ uan: '123' }, /12 digits/], [{ esi_number: '123' }, /10 digits/], [{ company: 'Indriyan' }, /Company must be exactly/],
      [{ shift: 'ZZA' }, /saved directly/], [{ exit: { date: '2026-10-01', reason: 'Resigned' } }, /own batch/]]) {
      const r = await check('master-edit-sensitive', [{ code: a.code, changes }]);
      expect(r.body.rows[0].state).toBe('error');
      expect(r.body.rows[0].messages.join(' ')).toMatch(re);
    }
    const w = await check('master-edit-sensitive', [{ code: a.code, changes: { account: '1234567890' } }]);
    expect(w.body.rows[0].messages.join(' ')).toMatch(/No IFSC on record/);
  });

  test('company: older open month → refused; latest open month with the bank file downloaded → refused; else warn + re-tag', async () => {
    const sal = (code, m, y, company) => db.prepare(`INSERT INTO salary_computations (employee_code, month, year, company, gross_salary,
      gross_earned, total_deductions, net_salary) VALUES (?, ?, ?, ?, 20000, 20000, 1000, 19000)`).run(code, m, y, company);
    const a = person(); const b = person(); const c = person();
    sal(a.code, 8, 2026, CO); sal(a.code, 9, 2026, CO); // Aug open + Sep open → Aug is older
    sal(b.code, 9, 2026, CO);
    sal(c.code, 9, 2026, CO);
    const r1 = await check('master-edit-sensitive', [{ code: a.code, changes: { company: CO2 } }]);
    expect(r1.body.rows[0].state).toBe('error');
    expect(r1.body.rows[0].messages.join(' ')).toMatch(/Salary for Aug 2026 is already computed under "Indriyan Beverages Pvt Ltd" and that month is not finalised/);
    db.prepare("INSERT INTO monthly_imports (month, year, company, is_finalised) VALUES (8, 2026, ?, 1)").run(CO);
    const r1b = await check('master-edit-sensitive', [{ code: a.code, changes: { company: CO2 } }]);
    expect(r1b.body.rows[0].state).toBe('warning');
    db.prepare(`INSERT INTO usage_logs (username, role, action, method, path) VALUES ('fin1', 'finance', 'GET /bank-salary-file', 'GET',
      '/api/reports/bank-salary-file?month=9&year=2026&company=&download=true')`).run();
    const r2 = await check('master-edit-sensitive', [{ code: b.code, changes: { company: CO2 } }]);
    expect(r2.body.rows[0].messages.join(' ')).toMatch(/bank \(NEFT\) file for Sep 2026 has already been downloaded/);
    db.exec('DELETE FROM usage_logs');
    const { p, out } = await save('master-edit-sensitive', [{ code: c.code, changes: { company: CO2 } }]);
    expect(p.body.rows[0].messages.join(' ')).toMatch(/Salary for Sep 2026 is already computed — re-run Stage 6 and 7/);
    expect((await act(out[0].body.batchId, 'approve', 'fin1')).status).toBe(200);
    expect(emp(c).company).toBe(CO2);
    const { normalizeCompany } = require('../services/salaryComputation');
    expect(normalizeCompany(db, c.code, '', 9, 2026)).toBe(CO2);
    expect(db.prepare('SELECT COUNT(*) n FROM salary_computations WHERE month = 9 AND year = 2026 AND ABS(net_salary-(gross_earned-total_deductions))>1').get().n).toBe(0);
  });

  test('data changed between send and approve → 409, nothing written; return and reject leave the master alone', async () => {
    const a = person(); const b = person();
    const { out } = await save('master-edit-sensitive', [{ code: a.code, changes: { bank_name: 'SBI' } }]);
    db.prepare("UPDATE employees SET bank_name = 'PNB', updated_at = '2030-01-01' WHERE id = ?").run(a.id);
    const r = await act(out[0].body.batchId, 'approve', 'fin1');
    expect(r.status).toBe(409);
    expect(emp(a).bank_name).toBe('PNB');
    const { out: o2 } = await save('master-edit-sensitive', [{ code: b.code, changes: { bank_name: 'SBI' } }]);
    expect((await act(o2[0].body.batchId, 'return', 'fin1', { note: 'wrong bank' })).status).toBe(200);
    expect(emp(b).bank_name).toBeNull();
  });

  test('undo restores bank + PAN; refused for company once Stage 7 ran under the new company', async () => {
    const a = person({ account: '1111111111', ifsc: 'SBIN0000001' });
    const { out } = await save('master-edit-sensitive', [{ code: a.code, changes: { account: '2222222222', pan: 'ABCDE1234F' } }]);
    await act(out[0].body.batchId, 'approve', 'fin1');
    expect((await act(out[0].body.batchId, 'undo', 'hr1', { reason: 'wrong file' })).status).toBe(403);
    const u = await act(out[0].body.batchId, 'undo', 'fin1', { reason: 'wrong file' });
    expect(u.status).toBe(200);
    expect([emp(a).account_number, emp(a).bank_account, emp(a).pan]).toEqual(['1111111111', '1111111111', null]);
    const c = person();
    const { out: o2 } = await save('master-edit-sensitive', [{ code: c.code, changes: { company: CO2 } }]);
    await act(o2[0].body.batchId, 'approve', 'fin1');
    db.prepare(`INSERT INTO salary_computations (employee_code, month, year, company, gross_salary, gross_earned, total_deductions, net_salary)
      VALUES (?, 10, 2026, ?, 20000, 20000, 0, 20000)`).run(c.code, CO2);
    const u2 = await act(o2[0].body.batchId, 'undo', 'fin1', { reason: 'wrong file' });
    expect(u2.status).toBe(409);
    expect(u2.body.rows[0].reason).toMatch(/Stage 7/);
  });
});

/* ── leaving (exit section) ── */
describe('master-edit-sensitive — leaving', () => {
  test('approve = Mark Left: same employee + loan effect as the single route; never undoable', async () => {
    const single = person({ code: 'T8951' }); addLoan(single.code);
    await api.request('PUT', `/api/employees/${single.code}/mark-left`, { as: 'hr1', body: { date_of_leaving: '2026-10-05', reason: 'Resigned job' } });
    const viaRoute = snapshot(single.code);
    db.exec(RESET);
    const b = person({ code: 'T8952' }); addLoan(b.code);
    const { p, out } = await save('master-edit-sensitive', [{ code: b.code, changes: { exit: { date: '05-10-2026', reason: 'Resigned job' } } }], { section: 'exit' });
    expect(p.body.rows[0].messages.join(' ')).toMatch(/1 open loan\(s\) will be flagged/);
    expect(emp(b).status).toBe('Active');
    expect((await act(out[0].body.batchId, 'approve', 'fin1')).status).toBe(200);
    const viaBulk = snapshot(b.code);
    expect(viaBulk.emp).toEqual(viaRoute.emp);
    expect(viaBulk.loans).toEqual(viaRoute.loans);
    expect(viaBulk.inst).toEqual(viaRoute.inst);
    expect(viaBulk.events.map(e => ({ ...e, actor: 'x' }))).toEqual(viaRoute.events.map(e => ({ ...e, actor: 'x' })));
    expect(audits("stage = 'MASTER_BULK_EXIT'")).toHaveLength(1);
    const u = await act(out[0].body.batchId, 'undo', 'fin1', { reason: 'wrong person' });
    expect(u.status).toBe(409);
    expect(u.body.rows[0].reason).toMatch(/cannot be undone in bulk/);
    expect(emp(b).status).toBe('Left');
  });

  test('leaving checks: future, before joining, finalised month, short reason, bad date, already Left, mixed with details', async () => {
    const a = person({ date_of_joining: '2026-06-01' }); const left = person({ status: 'Left', date_of_exit: '2026-05-01' });
    db.prepare("INSERT INTO monthly_imports (month, year, company, is_finalised) VALUES (7, 2026, ?, 1)").run(CO);
    const X = (exit) => ({ code: a.code, changes: { exit } });
    const r = await check('master-edit-sensitive', [X({ date: '2099-01-01', reason: 'Resigned' })], { section: 'exit' });
    expect(r.body.rows[0].messages.join(' ')).toMatch(/in the future/);
    for (const [exit, re] of [[{ date: '2026-05-01', reason: 'Resigned' }, /before the joining date/], [{ date: '2026-07-10', reason: 'Resigned' }, /Jul 2026 is finalised/],
      [{ date: '2026-08-10', reason: 'abc' }, /at least 5/], [{ date: '31-02-2026', reason: 'Resigned' }, /real date/]]) {
      const x = await check('master-edit-sensitive', [X(exit)], { section: 'exit' });
      expect(x.body.rows[0].state).toBe('error');
      expect(x.body.rows[0].messages.join(' ')).toMatch(re);
    }
    const s = await check('master-edit-sensitive', [{ code: left.code, changes: { exit: { date: '2026-08-10', reason: 'Resigned' } } }], { section: 'exit' });
    expect(s.body.rows[0].state).toBe('skipped');
    const mixed = await check('master-edit-sensitive', [{ code: a.code, changes: { exit: { date: '2026-08-10', reason: 'Resigned' }, bank_name: 'SBI' } }], { section: 'exit' });
    expect(mixed.body.rows[0].messages.join(' ')).toMatch(/separate batch from leaving/);
  });
});

/* ── P5-02 independent review fixes ── */
describe('review fixes', () => {
  const sal = (code, m, y, company = CO) => db.prepare(`INSERT INTO salary_computations (employee_code, month, year, company, gross_salary,
    gross_earned, total_deductions, net_salary) VALUES (?, ?, ?, ?, 20000, 20000, 1000, 19000)`).run(code, m, y, company);
  const dc = (code, m, y) => db.prepare(`INSERT INTO day_calculations (employee_code, month, year, company, total_payable_days, salary_stale)
    VALUES (?, ?, ?, ?, 26, 0)`).run(code, m, y, CO);
  const stale = (code) => db.prepare('SELECT month, salary_stale FROM day_calculations WHERE employee_code = ? ORDER BY year, month').all(code)
    .map(r => [r.month, r.salary_stale]);

  test('fix 1: approving a company change marks that person\'s open-month day calculations stale (finalised month left alone)', async () => {
    const c = person(); const other = person();
    db.prepare("INSERT INTO monthly_imports (month, year, company, is_finalised) VALUES (8, 2026, ?, 1)").run(CO);
    sal(c.code, 9, 2026); dc(c.code, 8, 2026); dc(c.code, 9, 2026); dc(other.code, 9, 2026);
    const { p, out } = await save('master-edit-sensitive', [{ code: c.code, changes: { company: CO2 } }]);
    expect(p.body.rows[0].messages.join(' ')).toMatch(/re-run Stage 6 and 7 for it \(All companies\) after approval/);
    expect(stale(c.code)).toEqual([[8, 0], [9, 0]]); // sending writes nothing
    expect((await act(out[0].body.batchId, 'approve', 'fin1')).status).toBe(200);
    expect(stale(c.code)).toEqual([[8, 0], [9, 1]]);
    expect(stale(other.code)).toEqual([[9, 0]]);
    // the payroll /finalise gate counts exactly these rows
    expect(db.prepare('SELECT COUNT(*) AS cnt FROM day_calculations WHERE salary_stale = 1 AND month = ? AND year = ?').get(9, 2026).cnt).toBe(1);
    // a bank-only change does not touch day calculations
    const { out: o2 } = await save('master-edit-sensitive', [{ code: other.code, changes: { bank_name: 'TEST BANK' } }]);
    expect((await act(o2[0].body.batchId, 'approve', 'fin1')).status).toBe(200);
    expect(stale(other.code)).toEqual([[9, 0]]);
  });

  test('fix 2: bank file sent = bank-salary-file download or bank-transfer read for that month and year (SQL filter)', () => {
    const { bankFileDownloaded } = require('../services/bulk/kinds/masterEdit');
    const log = (path) => db.prepare(`INSERT INTO usage_logs (username, role, action, method, path) VALUES ('fin1', 'finance', 'GET', 'GET', ?)`).run(path);
    log('/api/reports/bank-salary-file?month=1&year=2026&company=X'); // preview only
    log('/api/reports/bank-salary-file?month=10&year=2025&download=true');
    expect(bankFileDownloaded(db, 1, 2026)).toBe(false);
    expect(bankFileDownloaded(db, 10, 2026)).toBe(false); // other year
    expect(bankFileDownloaded(db, 1, 2025)).toBe(false); // month=10 is not month=1
    expect(bankFileDownloaded(db, 10, 2025)).toBe(true);
    log('/api/reports/bank-transfer?month=9&year=2026&company=Indriyan%20Beverages%20Pvt%20Ltd');
    expect(bankFileDownloaded(db, 9, 2026)).toBe(true);
    log('/api/reports/bank-salary-file?year=2026&download=true&month=03');
    expect(bankFileDownloaded(db, 3, 2026)).toBe(true);
    expect(bankFileDownloaded(db, '3', '2026')).toBe(true);
    log('/api/reports/bank-transfer-other?month=4&year=2026');
    expect(bankFileDownloaded(db, 4, 2026)).toBe(false);
  });

  test('fix 3: messages never carry a full account / PAN / UAN / ESI number', async () => {
    const other = person({ pan: 'ZZZZZ9999Z', uan: '100000000009', esi_number: '2000000009', account: '5555555555' });
    const a = person({ account: '1234567890' }); const b = person(); const c = person();
    const r = await check('master-edit-sensitive', [
      { code: a.code, changes: { pan: 'ZZZZZ9999Z' } }, { code: b.code, changes: { uan: '100000000005' } },
      { code: c.code, changes: { uan: '100000000005' } },
    ]);
    const w = await check('master-edit-sensitive', [{ code: b.code, changes: { account: '5555555555', ifsc: 'SBIN0000003' } }]);
    const e = await check('master-edit-sensitive', [{ code: c.code, changes: { esi_number: '2000000009' } }]);
    const st = await check('master-edit-sensitive', [{ code: a.code, changes: { account: '7777777777' }, base: { account: '9999999999' } }]);
    const all = [r, w, e, st].flatMap(x => x.body.rows.flatMap(row => row.messages)).join(' | ');
    for (const full of ['ZZZZZ9999Z', '100000000005', '100000000009', '5555555555', '2000000009', '1234567890']) expect(all).not.toContain(full);
    expect(all).toMatch(/\*\*\*\*999Z already belongs to employee/);
    expect(all).toMatch(/\*\*\*\*5555 is also on employee/);
    expect(all).toMatch(/now "\*\*\*\*7890"/);
  });

  test('fix 3: hr sees masked values in preview display and batch detail (input kept only in its own preview); finance/admin see full', async () => {
    const a = person({ account: '1234567890', ifsc: 'SBIN0000001', pan: 'ABCDE1234F' });
    const p = await check('master-edit-sensitive', [{ code: a.code, changes: { account: '2222000022', pan: 'PQRSX6789Z' } }]);
    const row = p.body.rows[0];
    expect(row.changeText).not.toMatch(/2222000022|1234567890|PQRSX6789Z|ABCDE1234F/);
    expect(row.changeText).toMatch(/\*\*\*\*7890 → \*\*\*\*0022/);
    expect(row.changes.find(c => c.field === 'pan').new).toBe('****789Z');
    expect(row.input.changes).toEqual({ account: '2222000022', pan: 'PQRSX6789Z' }); // the panel saves from it
    const { out } = await save('master-edit-sensitive', [{ code: a.code, changes: { account: '2222000022', pan: 'PQRSX6789Z' } }]);
    const id = out[0].body.batchId;
    const asHr = await api.request('GET', `/api/bulk/batches/${id}`, { as: 'hr1' });
    expect(JSON.stringify(asHr.body)).not.toMatch(/2222000022|1234567890|PQRSX6789Z|ABCDE1234F/);
    expect(asHr.body.data.rows[0].changeText).toMatch(/\*\*\*\*7890 → \*\*\*\*0022/);
    for (const who of ['fin1', 'admin1']) {
      const full = await api.request('GET', `/api/bulk/batches/${id}`, { as: who });
      expect(full.body.data.rows[0].changeText).toMatch(/1234567890 → 2222000022/);
      expect(full.body.data.rows[0].changes.find(c => c.field === 'pan').new).toBe('PQRSX6789Z');
    }
    // stored rows keep the full values, so approval applies them
    expect((await act(id, 'approve', 'fin1')).status).toBe(200);
    expect([emp(a).account_number, emp(a).pan]).toEqual(['2222000022', 'PQRSX6789Z']);
  });

  test('fix 3: export carries only the ticked columns', async () => {
    const a = person({ account: '1234567890', pan: 'ABCDE1234F', uan: '100000000001' });
    const r = await post('/api/bulk/master-edit/export', { fields: ['department'], codes: [a.code] });
    expect(r.body.data[0].values).toEqual({ department: 'PRODUCTION' });
    expect(JSON.stringify(r.body)).not.toMatch(/1234567890|ABCDE1234F|100000000001/);
    const r2 = await post('/api/bulk/master-edit/export', { fields: ['account'], codes: [a.code] });
    expect(r2.body.data[0].values).toEqual({ account: '1234567890' });
  });

  test('fix 5: a bank account that was a number cell (more than 15 digits) is refused', async () => {
    const a = person();
    const r = await check('master-edit-sensitive', [{ code: a.code, changes: { account: '12345678901234560000' }, numeric: ['account'] }]);
    expect(r.body.rows[0].state).toBe('error');
    expect(r.body.rows[0].messages.join(' ')).toMatch(/type the account as text/);
    const ok = await check('master-edit-sensitive', [{ code: a.code, changes: { account: '1234567890', ifsc: 'SBIN0000001' } }]);
    expect(ok.body.rows[0].state).toBe('ok');
  });

  test('fix 7: leaving date before a finalised month in which the person was paid is refused', async () => {
    const a = person(); const b = person();
    db.prepare("INSERT INTO monthly_imports (month, year, company, is_finalised) VALUES (9, 2026, ?, 1)").run(CO);
    sal(a.code, 9, 2026);
    const r = await check('master-edit-sensitive', [{ code: a.code, changes: { exit: { date: '2026-08-20', reason: 'Resigned' } } }], { section: 'exit' });
    expect(r.body.rows[0].state).toBe('error');
    expect(r.body.rows[0].messages.join(' ')).toMatch(/paid in Sep 2026, which is finalised — the leaving date cannot be in an earlier month/);
    const ok = await check('master-edit-sensitive', [{ code: a.code, changes: { exit: { date: '2026-10-05', reason: 'Resigned' } } }], { section: 'exit' });
    expect(ok.body.rows[0].state).toBe('ok');
    const unpaid = await check('master-edit-sensitive', [{ code: b.code, changes: { exit: { date: '2026-08-20', reason: 'Resigned' } } }], { section: 'exit' });
    expect(unpaid.body.rows[0].state).toBe('ok');
  });
});
