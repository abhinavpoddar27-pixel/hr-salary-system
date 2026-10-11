/**
 * P1-14 — plant employees have two bank column pairs:
 *   A account_number / ifsc_code (read first by the bank NEFT file)
 *   B bank_account   / ifsc      (read by the payslip and the payroll register)
 * Before: the Employee Master salary window saved into B only, so the NEFT file
 * kept paying the OLD account in A; a B-only employee's account was wiped by any
 * save; and the window's split (read from a wrong key) was written back as 50/20.
 *
 * Driven over HTTP behind the REAL requireAuth with real JWTs. Fictional codes,
 * fictional account numbers / IFSCs only.
 */
const { startJwtApi } = require('./helpers/jwtApiHarness');
const { generateBankFile } = require('../services/exportFormats');

const COMPANY = 'Test Company Ltd';
let api;
let db;

beforeAll(() => {
  api = startJwtApi({
    '/api/employees': '../../routes/employees',
    '/api/portal': '../../routes/employeePortal',
  }, {
    users: [
      { username: 'hr1', role: 'hr' },
      { username: 'boss', role: 'admin' },
      { username: 'fin1', role: 'finance' },
      { username: 'view1', role: 'viewer' },
      { username: 'emp1', role: 'employee', employeeCode: 'T1490' },
    ],
  });
  db = api.db;
});
afterAll(async () => { await api.close(); });

let n = 0;
const nextCode = () => `T14${String(++n).padStart(2, '0')}`;
let month = 0;
const nextMonth = () => ++month; // each test gets its own NEFT month (fictional year 2091)

function addEmployee(code, bank = {}, split = {}) {
  const gross = split.gross ?? 30000;
  const id = db.prepare(`INSERT INTO employees (code, name, company, employment_type, status, date_of_joining, gross_salary,
      account_number, bank_account, ifsc_code, ifsc, bank_name)
    VALUES (?, 'SYNTH ' || ?, ?, 'Permanent', 'Active', '2024-01-01', ?, ?, ?, ?, ?, 'TEST BANK')`)
    .run(code, code, COMPANY, gross, bank.a ?? null, bank.b ?? null, bank.ia ?? null, bank.ib ?? null).lastInsertRowid;
  db.prepare(`INSERT INTO salary_structures (employee_id, effective_from, gross_salary, basic, da, hra, conveyance,
      special_allowance, other_allowances, basic_percent, hra_percent, da_percent, pf_wage_ceiling)
    VALUES (?, '2025-01-01', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 15000)`)
    .run(id, gross, split.basic ?? 12001, split.da ?? 1500, split.hra ?? 7500, split.conv ?? 1600,
      split.special ?? 900, split.other ?? 1250, split.bp ?? 40, split.hp ?? 25, split.dp ?? 5);
  return id;
}
const row = (code) => db.prepare(
  'SELECT account_number, bank_account, ifsc_code, ifsc FROM employees WHERE code = ?').get(code);
const struct = (id) => db.prepare('SELECT * FROM salary_structures WHERE employee_id = ? ORDER BY id').all(id);

function neftLineFor(code, m) {
  db.prepare(`INSERT INTO salary_computations (employee_code, month, year, company, net_salary, salary_held)
              VALUES (?, ?, 2091, ?, 1000, 0)`).run(code, m, COMPANY);
  const f = generateBankFile(db, m, 2091, COMPANY);
  return { file: f, line: f.content.split('\n').find((l) => l.includes(`SYNTH ${code}`)) || null };
}

/** What the Employee Master salary window sends (form built from the structure). */
function modalBody(id, overrides = {}) {
  const s = struct(id)[0];
  return {
    gross_salary: s.gross_salary,
    basic_percent: s.basic_percent, hra_percent: s.hra_percent, da_percent: s.da_percent,
    special_allowance_percent: s.special_allowance / s.gross_salary * 100,
    other_allowance: s.other_allowances, pf_wage_ceiling: s.pf_wage_ceiling, pt_applicable: 1,
    uan: '', esi_number: '', bank_name: 'TEST BANK',
    ...overrides,
  };
}

describe('PUT /:code/salary writes BOTH pairs and the NEFT file follows', () => {
  test('new account + IFSC → both pairs, NEFT line has the new account', async () => {
    const code = nextCode();
    const id = addEmployee(code, { a: '111100001111', b: '111100001111', ia: 'TEST0000111', ib: 'TEST0000111' });
    const r = await api.request('PUT', `/api/employees/${code}/salary`, {
      as: 'hr1', body: modalBody(id, { account_number: ' 222200002222 ', ifsc_code: 'test0000222' }),
    });
    expect(r.status).toBe(200);
    expect(row(code)).toEqual({ account_number: '222200002222', bank_account: '222200002222', ifsc_code: 'TEST0000222', ifsc: 'TEST0000222' });
    const { line } = neftLineFor(code, nextMonth());
    expect(line).toContain(',222200002222,TEST0000222,');
    expect(line).not.toContain('111100001111');
  });

  test('B-only employee: a save that sends the shown value keeps the account (and fills A)', async () => {
    const code = nextCode();
    const id = addEmployee(code, { a: '', b: '333300003333', ia: '', ib: 'TEST0000333' });
    // the window now shows B when A is empty, so it sends B back
    const r = await api.request('PUT', `/api/employees/${code}/salary`, {
      as: 'hr1', body: modalBody(id, { account_number: '333300003333', ifsc_code: 'TEST0000333' }),
    });
    expect(r.status).toBe(200);
    expect(row(code)).toEqual({ account_number: '333300003333', bank_account: '333300003333', ifsc_code: 'TEST0000333', ifsc: 'TEST0000333' });
  });

  test('bank keys left out → all four columns untouched', async () => {
    const code = nextCode();
    const id = addEmployee(code, { a: '', b: '444400004444', ia: null, ib: 'TEST0000444' });
    const before = row(code);
    const r = await api.request('PUT', `/api/employees/${code}/salary`, { as: 'hr1', body: modalBody(id) });
    expect(r.status).toBe(200);
    expect(row(code)).toEqual(before);
  });

  test('blank account / IFSC clears both pairs (Q6)', async () => {
    const code = nextCode();
    const id = addEmployee(code, { a: '555500005555', b: '555500005555', ia: 'TEST0000555', ib: 'TEST0000555' });
    const r = await api.request('PUT', `/api/employees/${code}/salary`, {
      as: 'boss', body: modalBody(id, { account_number: '  ', ifsc_code: '' }),
    });
    expect(r.status).toBe(200);
    expect(row(code)).toEqual({ account_number: null, bank_account: null, ifsc_code: null, ifsc: null });
  });

  test('both names of a pair, different values → 400 BANK_PAIR_MISMATCH, nothing written', async () => {
    const code = nextCode();
    const id = addEmployee(code, { a: '666600006666', b: '666600006666' });
    const before = row(code);
    const r = await api.request('PUT', `/api/employees/${code}/salary`, {
      as: 'hr1', body: modalBody(id, { account_number: '777700007777', bank_account: '888800008888', uan: '100000000001' }),
    });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('BANK_PAIR_MISMATCH');
    expect(row(code)).toEqual(before);
    expect(db.prepare('SELECT uan FROM employees WHERE code = ?').get(code).uan).toBeNull();
  });
});

describe('PUT /:code/salary — same gross, same split leaves the structure as it is (Q2)', () => {
  test('structure byte-identical (other allowance, special, conveyance, amounts that do not equal gross × %)', async () => {
    const code = nextCode();
    const id = addEmployee(code, {}, { basic: 12345.67 }); // amount ≠ 30000 × 40 %
    const before = struct(id);
    const r = await api.request('PUT', `/api/employees/${code}/salary`, {
      as: 'hr1', body: modalBody(id, { account_number: '121200001212' }),
    });
    expect(r.status).toBe(200);
    expect(r.body.structureUnchanged).toBe(true);
    expect(struct(id)).toEqual(before);
    expect(row(code).account_number).toBe('121200001212');
  });

  test('a changed split at the same gross still writes (today\'s behaviour)', async () => {
    const code = nextCode();
    const id = addEmployee(code);
    const r = await api.request('PUT', `/api/employees/${code}/salary`, {
      as: 'hr1', body: modalBody(id, { basic_percent: 45 }),
    });
    expect(r.status).toBe(200);
    expect(r.body.structureUnchanged).toBeUndefined();
    const s = struct(id)[0];
    expect(s.basic_percent).toBe(45);
    expect(s.basic).toBe(13500);
  });

  test('a changed gross still goes to finance approval, structure untouched', async () => {
    const code = nextCode();
    const id = addEmployee(code);
    const before = struct(id);
    const r = await api.request('PUT', `/api/employees/${code}/salary`, {
      as: 'hr1', body: modalBody(id, { gross_salary: 31000 }),
    });
    expect(r.status).toBe(200);
    expect(r.body.pendingApproval).toBe(true);
    expect(struct(id)).toEqual(before);
  });
});

describe('PUT /:code mirrors whichever name is sent', () => {
  test.each([
    [{ account_number: '131300001313', ifsc_code: 'test0000131' }],
    [{ bank_account: '131300001313', ifsc: 'TEST0000131 ' }],
  ])('%p → both pairs, NEFT has it', async (body) => {
    const code = nextCode();
    addEmployee(code, { a: '909000009090', b: '909000009090', ia: 'TEST0000909', ib: 'TEST0000909' });
    const r = await api.request('PUT', `/api/employees/${code}`, { as: 'hr1', body });
    expect(r.status).toBe(200);
    expect(row(code)).toEqual({ account_number: '131300001313', bank_account: '131300001313', ifsc_code: 'TEST0000131', ifsc: 'TEST0000131' });
    expect(neftLineFor(code, nextMonth()).line).toContain(',131300001313,TEST0000131,');
  });

  test('mismatched pair → 400, nothing written', async () => {
    const code = nextCode();
    addEmployee(code, { a: '141400001414', b: '141400001414' });
    const before = row(code);
    const r = await api.request('PUT', `/api/employees/${code}`, {
      as: 'hr1', body: { ifsc_code: 'TEST0000001', ifsc: 'TEST0000002', name: 'RENAMED' },
    });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('BANK_PAIR_MISMATCH');
    expect(row(code)).toEqual(before);
    expect(db.prepare('SELECT name FROM employees WHERE code = ?').get(code).name).toBe(`SYNTH ${code}`);
  });

  test('same value under both names is fine', async () => {
    const code = nextCode();
    addEmployee(code);
    const r = await api.request('PUT', `/api/employees/${code}`, {
      as: 'hr1', body: { account_number: '151500001515', bank_account: ' 151500001515' },
    });
    expect(r.status).toBe(200);
    expect(row(code).bank_account).toBe('151500001515');
  });
});

describe('roles', () => {
  test.each(['view1', 'fin1'])('%s → 403 on both routes, nothing written', async (who) => {
    const code = nextCode();
    const id = addEmployee(code, { a: '161600001616', b: '161600001616' });
    const before = row(code);
    expect((await api.request('PUT', `/api/employees/${code}/salary`, { as: who, body: modalBody(id, { account_number: '1' }) })).status).toBe(403);
    expect((await api.request('PUT', `/api/employees/${code}`, { as: who, body: { account_number: '1' } })).status).toBe(403);
    expect(row(code)).toEqual(before);
  });
});

describe('POST / and the employee portal write both pairs', () => {
  test('POST / bankAccount + ifsc → both pairs', async () => {
    const r = await api.request('POST', '/api/employees', {
      as: 'hr1', body: { code: 'T1480', name: 'SYNTH NEW', company: COMPANY, bankAccount: ' 171700001717', ifsc: 'test0000171' },
    });
    expect(r.status).toBeLessThan(300);
    expect(row('T1480')).toEqual({ account_number: '171700001717', bank_account: '171700001717', ifsc_code: 'TEST0000171', ifsc: 'TEST0000171' });
  });

  test('portal PATCH /bank-details → both pairs; omitted IFSC kept', async () => {
    addEmployee('T1490', { a: '181800001818', b: '181800001818', ia: 'TEST0000181', ib: 'TEST0000181' });
    const r = await api.request('PATCH', '/api/portal/bank-details', { as: 'emp1', body: { bank_account: '191900001919', bank_name: 'TEST BANK 2' } });
    expect(r.status).toBe(200);
    expect(row('T1490')).toEqual({ account_number: '191900001919', bank_account: '191900001919', ifsc_code: 'TEST0000181', ifsc: 'TEST0000181' });
  });
});

describe('NEFT read: an empty-string A no longer hides a filled-in B', () => {
  test('A = "" and B set → in the file with B', () => {
    const code = nextCode();
    addEmployee(code, { a: '', b: '202000002020', ia: '', ib: 'TEST0000202' });
    const { line, file } = neftLineFor(code, nextMonth());
    expect(line).toContain(',202000002020,TEST0000202,');
    expect(file.missing.length).toBe(0);
  });

  test('A and B both empty → still missing', () => {
    const code = nextCode();
    addEmployee(code, { a: '', b: '', ia: '', ib: null });
    const { line, file } = neftLineFor(code, nextMonth());
    expect(line).toBeNull();
    expect(file.missing.map((m) => m.employee_code)).toEqual([code]);
  });
});
