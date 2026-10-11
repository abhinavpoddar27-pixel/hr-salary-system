/**
 * N-MONEY (11 Oct 2026) — real routers behind the real requireAuth, real JWTs.
 *  N-16: PUT /finance-audit/bulk-approve rejected GROSS_STRUCTURE_CHANGE flags
 *        without the gross revert the single route does; neither route had a
 *        finance/admin guard; the single route's revert was not atomic.
 *  N-17: PUT /salary-input/approve/:id wrote 0 for a component the request did
 *        not name; the default effective date was the UTC day, not IST.
 * Fictional codes and money only.
 */
const { startJwtApi } = require('./helpers/jwtApiHarness');
const S = require('./helpers/statutoryFixture');

const USERS = [
  { username: 'boss', role: 'admin' },
  { username: 'fin1', role: 'finance' },
  { username: 'hr1', role: 'hr' },
  { username: 'view1', role: 'viewer' },
  { username: 'sup1', role: 'supervisor' },
];

let api; let db;
beforeAll(() => {
  api = startJwtApi({
    '/api/finance-audit': '../../routes/financeAudit',
    '/api/salary-input': '../../routes/salary-input',
  }, { users: USERS });
  db = api.db;
});
afterAll(() => api.close());

let codeSeq = 0;
const code = () => `T96${String(++codeSeq).padStart(2, '0')}`;

/** Employee whose gross moved 15000 → 18000 this month, with the Stage 7 flag. */
function grossChanged({ oldGross = 15000, newGross = 18000 } = {}) {
  const e = S.plant(db, { code: code(), gross_salary: newGross });
  S.plantStructure(db, e, '2025-01-01', { gross_salary: newGross });
  const flagId = Number(db.prepare(`INSERT INTO salary_manual_flags
      (employee_code, month, year, flag_type, field_name, system_value, manual_value, delta, changed_by, notes)
      VALUES (?, 9, 2026, 'GROSS_STRUCTURE_CHANGE', 'gross_salary', ?, ?, ?, 'system', 'synthetic')`)
    .run(e.code, oldGross, newGross, newGross - oldGross).lastInsertRowid);
  return { e, flagId };
}

function otherFlag(type = 'MANUAL_TDS') {
  const e = S.plant(db, { code: code() });
  S.plantStructure(db, e, '2025-01-01');
  return Number(db.prepare(`INSERT INTO salary_manual_flags
      (employee_code, month, year, flag_type, field_name, system_value, manual_value, delta, changed_by, notes)
      VALUES (?, 9, 2026, ?, 'tds', 0, 500, 500, 'system', 'synthetic')`).run(e.code, type).lastInsertRowid);
}

/** Everything a flag decision may write, for one employee + flag. */
function snapshot(e, flagId) {
  return {
    gross: db.prepare('SELECT gross_salary FROM employees WHERE id = ?').get(e.id).gross_salary,
    structures: db.prepare('SELECT gross_salary, basic, da, hra, conveyance, special_allowance, other_allowances FROM salary_structures WHERE employee_id = ? ORDER BY id').all(e.id),
    flag: db.prepare('SELECT finance_approved, approved_by FROM salary_manual_flags WHERE id = ?').get(flagId),
    approvals: db.prepare('SELECT status, reviewed_by, comments FROM finance_approvals WHERE flag_id = ? ORDER BY id').all(flagId),
    rejections: db.prepare("SELECT rejection_type, rejection_reason, rejected_by FROM finance_rejections WHERE source_table = 'salary_manual_flags' AND source_record_id = ? ORDER BY id").all(flagId),
    flagAudit: db.prepare("SELECT stage, old_value, new_value, changed_by FROM audit_log WHERE table_name = 'salary_manual_flags' AND record_id = ? ORDER BY id").all(String(flagId)),
    grossAudit: db.prepare("SELECT stage, old_value, new_value, changed_by FROM audit_log WHERE table_name = 'employees' AND record_id = ? AND stage = 'FINANCE_GROSS_REVERT' ORDER BY id").all(String(e.id)),
  };
}

const single = (as, id, body) => api.request('PUT', `/api/finance-audit/approve-flag/${id}`, { as, body });
const bulk = (as, body) => api.request('PUT', '/api/finance-audit/bulk-approve', { as, body });
const REJECT = { status: 'REJECTED', comments: 'synthetic reject' };

describe('N-16 role guard on approve-flag and bulk-approve', () => {
  test.each(['hr1', 'view1', 'sup1'])('%s → 403 on both, nothing written', async (who) => {
    const { e, flagId } = grossChanged();
    const before = snapshot(e, flagId);
    const a = await single(who, flagId, REJECT);
    const b = await bulk(who, { flagIds: [flagId], ...REJECT });
    expect(a.status).toBe(403);
    expect(b.status).toBe(403);
    expect(snapshot(e, flagId)).toEqual(before);
  });

  test('no token → 401', async () => {
    const { flagId } = grossChanged();
    expect((await single(null, flagId, REJECT)).status).toBe(401);
    expect((await bulk(null, { flagIds: [flagId], ...REJECT })).status).toBe(401);
  });

  test('finance and admin may decide', async () => {
    const a = grossChanged(); const b = grossChanged();
    expect((await single('fin1', a.flagId, { status: 'APPROVED' })).status).toBe(200);
    expect((await bulk('boss', { flagIds: [b.flagId], status: 'APPROVED' })).status).toBe(200);
  });
});

describe('N-16 bulk reject reverts the gross exactly like the single route', () => {
  test('same rows written by single and bulk', async () => {
    const s = grossChanged(); const b = grossChanged();
    const rs = await single('fin1', s.flagId, REJECT);
    const rb = await bulk('fin1', { flagIds: [b.flagId], ...REJECT });
    expect(rs.status).toBe(200);
    expect(rb.status).toBe(200);
    expect(rb.body.count).toBe(1);
    const ss = snapshot(s.e, s.flagId); const sb = snapshot(b.e, b.flagId);
    expect(sb).toEqual(ss);
    expect(sb.gross).toBe(15000);
    expect(sb.structures[0].gross_salary).toBe(15000);
    expect(sb.flag.finance_approved).toBe(-1);
    expect(sb.rejections).toHaveLength(1);
    expect(sb.rejections[0].rejection_type).toBe('GROSS_STRUCTURE_CHANGE_REVERT');
    expect(sb.flagAudit.map((r) => r.stage)).toEqual(['FINANCE_FLAG_REJECT']);
    expect(sb.grossAudit).toHaveLength(1);
  });

  test('mixed batch: gross flag reverted, TDS flag only marked', async () => {
    const g = grossChanged(); const t = otherFlag();
    const r = await bulk('boss', { flagIds: [g.flagId, t], ...REJECT });
    expect(r.status).toBe(200);
    expect(r.body.count).toBe(2);
    expect(snapshot(g.e, g.flagId).gross).toBe(15000);
    expect(db.prepare('SELECT finance_approved FROM salary_manual_flags WHERE id = ?').get(t).finance_approved).toBe(-1);
    expect(db.prepare("SELECT COUNT(*) n FROM finance_rejections WHERE source_table = 'salary_manual_flags' AND source_record_id = ?").get(t).n).toBe(0);
  });

  test('bulk approve writes the same audit row the single route writes', async () => {
    const t = otherFlag();
    await bulk('fin1', { flagIds: [t], status: 'APPROVED' });
    const rows = db.prepare("SELECT stage FROM audit_log WHERE table_name = 'salary_manual_flags' AND record_id = ?").all(String(t));
    expect(rows.map((r) => r.stage)).toEqual(['FINANCE_FLAG_APPROVE']);
  });

  test('a flag already rejected is not reverted twice', async () => {
    const { e, flagId } = grossChanged();
    await single('fin1', flagId, REJECT);
    const r = await bulk('fin1', { flagIds: [flagId], ...REJECT });
    expect(r.status).toBe(200);
    const s = snapshot(e, flagId);
    expect(s.rejections).toHaveLength(1);
    expect(s.grossAudit).toHaveLength(1);
    expect(s.gross).toBe(15000);
  });

  test('gross moved since the flag (> ₹1) → 409 GROSS_MOVED_SINCE, whole batch unwritten', async () => {
    const ok = grossChanged(); const moved = grossChanged();
    db.prepare('UPDATE employees SET gross_salary = 21000 WHERE id = ?').run(moved.e.id);
    const b1 = snapshot(ok.e, ok.flagId); const b2 = snapshot(moved.e, moved.flagId);
    const r = await bulk('fin1', { flagIds: [ok.flagId, moved.flagId], ...REJECT });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('GROSS_MOVED_SINCE');
    expect(r.body.flagId).toBe(moved.flagId);
    expect(r.body.error).toMatch(/no longer the value this flag was raised for/);
    expect(snapshot(ok.e, ok.flagId)).toEqual(b1);
    expect(snapshot(moved.e, moved.flagId)).toEqual(b2);
    const s = await single('fin1', moved.flagId, REJECT);
    expect(s.status).toBe(409);
    expect(snapshot(moved.e, moved.flagId)).toEqual(b2);
  });

  test('within ₹1 still reverts', async () => {
    const { e, flagId } = grossChanged();
    db.prepare('UPDATE employees SET gross_salary = 18000.6 WHERE id = ?').run(e.id);
    expect((await single('fin1', flagId, REJECT)).status).toBe(200);
    expect(snapshot(e, flagId).gross).toBe(15000);
  });

  test('a revert that fails → 500 and nothing written (single and bulk)', async () => {
    const ok = grossChanged(); const bad = grossChanged();
    db.exec(`CREATE TRIGGER nmoney_block BEFORE UPDATE OF gross_salary ON employees
      WHEN NEW.code = '${bad.e.code}' BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END`);
    try {
      const b1 = snapshot(ok.e, ok.flagId); const b2 = snapshot(bad.e, bad.flagId);
      const rb = await bulk('fin1', { flagIds: [ok.flagId, bad.flagId], ...REJECT });
      expect(rb.status).toBe(500);
      expect(snapshot(ok.e, ok.flagId)).toEqual(b1);
      expect(snapshot(bad.e, bad.flagId)).toEqual(b2);
      const rs = await single('fin1', bad.flagId, REJECT);
      expect(rs.status).toBe(500);
      expect(snapshot(bad.e, bad.flagId)).toEqual(b2);
    } finally {
      db.exec('DROP TRIGGER nmoney_block');
    }
  });
});

describe('N-17 salary change approval keeps components the request did not name', () => {
  function emp(over = {}) {
    const e = S.plant(db, { code: code(), gross_salary: 20000 });
    S.plantStructure(db, e, '2025-01-01', {
      gross_salary: 20000, basic: 10000, da: 0, hra: 4000, conveyance: 1600, special_allowance: 2000, other_allowances: 2400, ...over,
    });
    return e;
  }
  function request(e, newStructure) {
    return Number(db.prepare(`INSERT INTO salary_change_requests (employee_id, employee_code, requested_by, old_gross, new_gross, old_structure, new_structure, reason, status)
      VALUES (?, ?, 'hr1', 20000, 0, '{}', ?, 't', 'Pending')`).run(e.id, e.code, JSON.stringify(newStructure)).lastInsertRowid);
  }
  const latest = (e) => db.prepare('SELECT * FROM salary_structures WHERE employee_id = ? ORDER BY effective_from DESC, id DESC LIMIT 1').get(e.id);
  const approve = (id, body = { effectiveFrom: '2026-10-01' }) => api.request('PUT', `/api/salary-input/approve/${id}`, { as: 'fin1', body });

  test('Employee Master shape (no conveyance): conveyance kept, explicit gross written', async () => {
    const e = emp();
    const id = request(e, { gross_salary: 22000, basic: 11000, da: 0, hra: 4400, special_allowance: 2200, other_allowances: 2800 });
    const r = await approve(id);
    expect(r.status).toBe(200);
    expect(r.body.keptComponents).toEqual(['conveyance']);
    const s = latest(e);
    expect(s.conveyance).toBe(1600);
    expect(s.gross_salary).toBe(22000);
    expect(s.basic).toBe(11000);
    expect(db.prepare('SELECT gross_salary FROM employees WHERE id = ?').get(e.id).gross_salary).toBe(22000);
  });

  test('Salary Input shape (no special, no gross): special kept, gross = sum of resolved components', async () => {
    const e = emp();
    const id = request(e, { basic: 11000, da: 0, hra: 4400, conveyance: 1600, other_allowances: 2000 });
    const r = await approve(id);
    expect(r.status).toBe(200);
    const s = latest(e);
    expect(s.special_allowance).toBe(2000);
    expect(s.gross_salary).toBe(11000 + 4400 + 1600 + 2000 + 2000);
    expect(r.body.gross).toBe(21000);
  });

  test('a component sent as 0 is written as 0', async () => {
    const e = emp();
    const id = request(e, { basic: 11000, da: 0, hra: 4400, conveyance: 0, special_allowance: 0, other_allowances: 2000 });
    expect((await approve(id)).status).toBe(200);
    const s = latest(e);
    expect(s.conveyance).toBe(0);
    expect(s.special_allowance).toBe(0);
    expect(s.gross_salary).toBe(17400);
  });

  test('same-date update path keeps absent components too', async () => {
    const e = emp();
    S.plantStructure(db, e, '2026-10-01', { gross_salary: 20000, basic: 10000, hra: 4000, conveyance: 1800, special_allowance: 2000, other_allowances: 2200 });
    const id = request(e, { gross_salary: 21000, basic: 10500, da: 0, hra: 4200, special_allowance: 2100, other_allowances: 2400 });
    expect((await approve(id)).status).toBe(200);
    expect(latest(e).conveyance).toBe(1800);
  });

  test('pending list shows what approval will write', async () => {
    const e = emp();
    request(e, { basic: 11000, da: 0, hra: 4400, conveyance: 1600, other_allowances: 2000 });
    const r = await api.request('GET', '/api/salary-input/pending-changes', { as: 'fin1' });
    const row = r.body.data.find((x) => x.employee_code === e.code);
    expect(row.approval_preview.kept).toEqual(['special_allowance']);
    expect(row.approval_preview.components.special_allowance).toBe(2000);
    expect(row.approval_preview.gross).toBe(21000);
  });

  test('default effective date is today in IST (00:30 IST = previous UTC day)', async () => {
    const e = emp();
    const id = request(e, { gross_salary: 21000, basic: 10500, da: 0, hra: 4200, conveyance: 1600, special_allowance: 2100, other_allowances: 2600 });
    jest.useFakeTimers({
      now: Date.parse('2026-10-10T19:00:00Z'),
      doNotFake: ['nextTick', 'setImmediate', 'clearImmediate', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask', 'hrtime', 'performance'],
    });
    try {
      const r = await approve(id, {});
      expect(r.status).toBe(200);
    } finally {
      jest.useRealTimers();
    }
    expect(latest(e).effective_from).toBe('2026-10-11');
  });
});
