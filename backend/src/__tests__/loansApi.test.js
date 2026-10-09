/**
 * Loans PR-3 — the loan API over HTTP with REAL JWT auth.
 *
 * The real routes/loans.js and routes/employeePortal.js sit behind the real
 * middleware/auth.js requireAuth on a temp DATA_DIR with the real initSchema.
 * Every request carries a JWT signed exactly like routes/auth.js login does.
 *
 * Covers: every endpoint × role (SPEC §7), every maker-checker refusal, the
 * coordinator's rulings (A: disbursement gate; B: admin cannot raise; Q3–Q16),
 * the retired endpoints (410), the portal filter (D12), audit rows, and an
 * end-to-end life cycle raise → approve → disburse → defer → receipt →
 * restructure → close-out by receipt.
 */
const { startJwtApi } = require('./helpers/jwtApiHarness');

const IND = 'Indriyan Beverages Pvt Ltd';
const ALI = 'Asian Lakto Ind Ltd';

let api;
let db;
let L;
let todayIst;
let seq = 0;

const USERS = [
  { username: 'boss', role: 'admin' },
  { username: 'boss2', role: 'admin' },
  { username: 'hr1', role: 'hr' },
  { username: 'hr2', role: 'hr' },
  { username: 'hrAsian', role: 'hr', allowedCompanies: ALI },
  { username: 'fin1', role: 'finance' },
  { username: 'fin2', role: 'finance' },
  { username: 'view1', role: 'viewer' },
  { username: 'sup1', role: 'supervisor' },
  { username: 'emp1', role: 'employee', employeeCode: 'PORTAL1' },
];
const ALL_ROLES_AS = { admin: 'boss', hr: 'hr1', finance: 'fin1', viewer: 'view1', supervisor: 'sup1', employee: 'emp1' };

beforeAll(() => {
  api = startJwtApi({ '/api/loans': '../../routes/loans', '/api/portal': '../../routes/employeePortal' }, { users: USERS });
  db = api.db;
  L = require('../services/loans');
  ({ todayIst } = require('../services/loans/months'));
});
afterAll(() => api.close());

// ── fixtures ────────────────────────────────────────────────────────────────

function employee(over = {}) {
  const code = over.code || `P${String(++seq).padStart(4, '0')}`;
  db.prepare(`INSERT INTO employees (code, name, department, company, employment_type, status, date_of_joining, is_contractor, gross_salary)
              VALUES (?, 'TEST EMP', 'PRODUCTION', ?, ?, 'Active', '2024-01-01', 0, ?)`)
    .run(code, over.company || IND, over.employment_type || 'Permanent', over.gross ?? 20000);
  return code;
}
const setGate = (v) => db.prepare("UPDATE policy_config SET value = ? WHERE key = 'loans_disbursement_enabled'").run(String(v));
const gateValue = () => db.prepare("SELECT value FROM policy_config WHERE key = 'loans_disbursement_enabled'").get().value;
const loanRow = (id) => db.prepare('SELECT * FROM loans WHERE id = ?').get(id);
const events = (id) => db.prepare('SELECT * FROM loan_events WHERE loan_id = ? ORDER BY id').all(id);
const audits = (id) => db.prepare("SELECT * FROM audit_log WHERE table_name = 'loans' AND record_id = ? ORDER BY id").all(id);
const instalments = (id) => db.prepare('SELECT * FROM loan_instalments WHERE loan_id = ? ORDER BY sequence').all(id);
const counts = () => ({
  loans: db.prepare('SELECT COUNT(*) AS n FROM loans').get().n,
  events: db.prepare('SELECT COUNT(*) AS n FROM loan_events').get().n,
  requests: db.prepare('SELECT COUNT(*) AS n FROM loan_requests').get().n,
  receipts: db.prepare('SELECT COUNT(*) AS n FROM loan_receipts').get().n,
  instalments: db.prepare('SELECT COUNT(*) AS n FROM loan_instalments').get().n,
  policy: db.prepare("SELECT GROUP_CONCAT(key || '=' || value, ';') AS v FROM policy_config WHERE key LIKE 'loan%'").get().v,
});

const body = (over = {}) => ({
  borrowerType: 'plant', employeeCode: over.employeeCode || employee(), company: IND, loanType: 'Personal', principal: 12000, tenure: 3,
  reason: 'family need', ...over,
});

const disburseBody = (over = {}) => ({ mode: 'NEFT', reference: 'UTR123', disbursedOn: todayIst(), agreementRef: 'HR-FILE/LOAN/001', ...over });

async function raise(as = 'hr1', over = {}) {
  const r = await api.request('POST', '/api/loans', { as, body: body(over) });
  if (r.status !== 201) throw new Error(`raise failed ${r.status} ${r.text}`);
  return r.body.data.loanId;
}
async function approved(as = 'hr1', over = {}) {
  const id = await raise(as, over);
  const r = await api.request('PUT', `/api/loans/${id}/approve`, { as: 'boss', body: {} });
  if (r.status !== 200) throw new Error(`approve failed ${r.status} ${r.text}`);
  return id;
}
async function active(as = 'hr1', over = {}) {
  const id = await approved(as, over);
  setGate(1);
  const r = await api.request('POST', `/api/loans/${id}/disburse`, { as: 'fin1', body: disburseBody() });
  setGate(0);
  if (r.status !== 200) throw new Error(`disburse failed ${r.status} ${r.text}`);
  return id;
}
async function pendingRequest(loanId, as = 'hr1', b = null) {
  const ins = instalments(loanId).find((i) => i.status === 'scheduled');
  const r = await api.request('POST', `/api/loans/${loanId}/requests`, { as, body: b || { kind: 'defer', instalmentId: ins.id, reason: 'medical leave' } });
  if (r.status !== 201) throw new Error(`request failed ${r.status} ${r.text}`);
  return r.body.data.requestId;
}

// ── 0. schema + gate seed ───────────────────────────────────────────────────

describe('schema and seed', () => {
  test('loan_requests exists with the one-pending index; gate seeded 0', () => {
    expect(db.prepare("SELECT type FROM sqlite_master WHERE name = 'loan_requests'").get().type).toBe('table');
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'uniq_loan_requests_one_pending'").get()).toBeTruthy();
    expect(gateValue()).toBe('0');
  });
});

// ── 1. authentication ───────────────────────────────────────────────────────

describe('authentication (real requireAuth)', () => {
  test.each([
    ['GET', '/api/loans'], ['POST', '/api/loans'], ['PUT', '/api/loans/1/approve'], ['POST', '/api/loans/1/disburse'],
    ['GET', '/api/loans/deductions'], ['POST', '/api/loans/requests/1/approve'],
  ])('%s %s: no token → 401, bad token → 401, wrong secret → 401', async (method, url) => {
    expect((await api.request(method, url, { body: {} })).status).toBe(401);
    expect((await api.request(method, url, { body: {}, token: 'not-a-jwt' })).status).toBe(401);
    const forged = api.jwt.sign({ id: 1, username: 'boss', role: 'admin' }, 'some-other-secret');
    expect((await api.request(method, url, { body: {}, token: forged })).status).toBe(401);
  });
});

// ── 2. the role matrix (SPEC §7) ────────────────────────────────────────────

describe('role matrix: every endpoint × role', () => {
  let loanId; let requestId;
  beforeAll(async () => {
    loanId = await active('hr2');
    requestId = await pendingRequest(loanId, 'hr2');
  });

  const READ = ['admin', 'hr', 'finance', 'viewer'];
  const reads = () => [
    ['GET', '/api/loans'], ['GET', '/api/loans/stats'], ['GET', '/api/loans/types'], ['GET', '/api/loans/policy'],
    ['GET', '/api/loans/queue'], ['GET', '/api/loans/due?month=10&year=2026'], ['GET', '/api/loans/employee/P0001'],
    ['GET', '/api/loans/requests'], ['GET', `/api/loans/${loanId}`], ['GET', `/api/loans/${loanId}/statement`],
  ];

  test('reads: admin / hr / finance / viewer 200; supervisor / employee 403', async () => {
    for (const [method, url] of reads()) {
      for (const [role, as] of Object.entries(ALL_ROLES_AS)) {
        const r = await api.request(method, url, { as });
        if (READ.includes(role)) expect([method, url, role, r.status]).toEqual([method, url, role, 200]);
        else expect([method, url, role, r.status, r.body.code]).toEqual([method, url, role, 403, 'ROLE_NOT_ALLOWED']);
      }
    }
  });

  // [method, path, body, roles allowed through the guard, code for admin when it is refused]
  const writes = () => [
    ['POST', '/api/loans/eligibility', body(), ['admin', 'hr', 'finance']],
    ['POST', '/api/loans', body(), ['hr', 'finance'], 'ADMIN_CANNOT_RAISE'],
    ['PUT', `/api/loans/${loanId}/approve`, {}, ['admin']],
    ['PUT', `/api/loans/${loanId}/reject`, { reason: 'x' }, ['admin']],
    ['POST', `/api/loans/${loanId}/cancel`, { reason: 'x' }, ['admin']],
    ['POST', `/api/loans/${loanId}/disburse`, disburseBody(), ['finance', 'admin']],
    ['POST', `/api/loans/${loanId}/receipts`, { amount: 1, mode: 'cash', receiptDate: todayIst() }, ['finance', 'admin']],
    ['POST', `/api/loans/${loanId}/requests`, { kind: 'write_off', reason: 'x' }, ['hr', 'finance'], 'ADMIN_CANNOT_RAISE'],
    ['POST', `/api/loans/requests/${requestId}/approve`, {}, ['admin']],
    ['POST', `/api/loans/requests/${requestId}/reject`, { reason: 'x' }, ['admin']],
    ['POST', `/api/loans/requests/${requestId}/withdraw`, {}, ['hr', 'finance']],
    ['PUT', '/api/loans/policy', { values: { loan_close_day: 14 }, reason: 'x' }, ['admin']],
  ];

  test('writes: every role outside the cell gets 403 and nothing is written', async () => {
    for (const [method, url, b, allowed, adminCode] of writes()) {
      for (const [role, as] of Object.entries(ALL_ROLES_AS)) {
        if (allowed.includes(role)) continue;
        const before = counts();
        const r = await api.request(method, url, { as, body: b });
        const code = role === 'admin' && adminCode ? adminCode : 'ROLE_NOT_ALLOWED';
        expect([method, url, role, r.status, r.body.code]).toEqual([method, url, role, 403, code]);
        expect(counts()).toEqual(before);
      }
    }
  });

  test('viewer gets 403 on every write', async () => {
    for (const [method, url, b] of writes()) {
      expect((await api.request(method, url, { as: 'view1', body: b })).status).toBe(403);
    }
  });

  test('hr and finance get 403 on approve, reject, cancel, approve-change, reject-change and policy', async () => {
    for (const as of ['hr1', 'fin1']) {
      for (const [method, url, b] of [
        ['PUT', `/api/loans/${loanId}/approve`, {}], ['PUT', `/api/loans/${loanId}/reject`, { reason: 'x' }],
        ['POST', `/api/loans/${loanId}/cancel`, { reason: 'x' }],
        ['POST', `/api/loans/requests/${requestId}/approve`, {}], ['POST', `/api/loans/requests/${requestId}/reject`, { reason: 'x' }],
        ['PUT', '/api/loans/policy', { values: { loan_close_day: 14 }, reason: 'x' }],
      ]) {
        expect([as, url, (await api.request(method, url, { as, body: b })).status]).toEqual([as, url, 403]);
      }
    }
  });
});

// ── 3. raising a loan ───────────────────────────────────────────────────────

describe('raise', () => {
  test('hr raises: 201 requested, event + audit with reason, admin notified', async () => {
    const r = await api.request('POST', '/api/loans', { as: 'hr1', body: body({ reason: 'school fees' }) });
    expect(r.status).toBe(201);
    const id = r.body.data.loanId;
    expect(loanRow(id).status).toBe('requested');
    expect(loanRow(id).requested_by).toBe('hr1');
    expect(r.body.data.schedulePreview.map((x) => x.amount)).toEqual([4000, 4000, 4000]);
    const a = audits(id);
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ changed_by: 'hr1', action_type: 'loan_requested' });
    expect(a[0].remark).toContain('school fees');
    const n = db.prepare("SELECT * FROM notifications WHERE type = 'LOAN_REQUESTED' AND message LIKE ?").get(`Loan #${id} %`);
    expect(n.role_target).toBe('admin');
  });

  test('finance may raise; Emergency / medical is flagged URGENT', async () => {
    const r = await api.request('POST', '/api/loans', { as: 'fin1', body: body({ loanType: 'Emergency / medical', principal: 50000, tenure: 12 }) });
    expect(r.status).toBe(201);
    expect(r.body.data.urgent).toBe(true);
    const n = db.prepare("SELECT message FROM notifications WHERE message LIKE ?").get(`URGENT: Loan #${r.body.data.loanId} %`);
    expect(n).toBeTruthy();
  });

  test('ruling B: the admin cannot raise a loan (403 ADMIN_CANNOT_RAISE, nothing written)', async () => {
    const before = counts();
    const r = await api.request('POST', '/api/loans', { as: 'boss', body: body() });
    expect(r.status).toBe(403);
    expect(r.body).toMatchObject({ code: 'ADMIN_CANNOT_RAISE', error: 'HR raises loans; admin approves' });
    expect(counts()).toEqual(before);
  });

  test.each([['Default'], ['default'], ['null'], [''], ['   '], ['Some Other Co']])('company %p is refused (400)', async (company) => {
    const before = counts();
    const r = await api.request('POST', '/api/loans', { as: 'hr1', body: body({ company }) });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('NOT_ELIGIBLE');
    expect(r.body.refusals.map((x) => x.code)).toContain('COMPANY_INVALID');
    expect(counts()).toEqual(before);
  });

  test('sales borrowers wait for PR-8', async () => {
    const r = await api.request('POST', '/api/loans', { as: 'hr1', body: body({ borrowerType: 'sales' }) });
    expect([r.status, r.body.code]).toEqual([400, 'SALES_LOANS_NOT_YET_ENABLED']);
  });

  test('eligibility refusals come back as a list; missing reason refused', async () => {
    const r = await api.request('POST', '/api/loans', { as: 'hr1', body: body({ principal: 100000, tenure: 13, loanType: 'Salary Advance' }) });
    expect(r.status).toBe(400);
    const codes = r.body.refusals.map((x) => x.code);
    expect(codes).toEqual(expect.arrayContaining(['AMOUNT_OVER_LIMIT', 'TENURE_OVER_LIMIT']));
    expect((await api.request('POST', '/api/loans', { as: 'hr1', body: body({ reason: '' }) })).body.code).toBe('REASON_REQUIRED');
  });

  test('a contract worker is refused', async () => {
    const code = employee({ employment_type: 'Contract' });
    const r = await api.request('POST', '/api/loans', { as: 'hr1', body: body({ employeeCode: code }) });
    expect(r.status).toBe(400);
    expect(r.body.refusals.map((x) => x.code)).toContain('CONTRACT_NOT_ELIGIBLE');
  });

  test('POST /eligibility previews without writing', async () => {
    const before = counts();
    const r = await api.request('POST', '/api/loans/eligibility', { as: 'hr1', body: body() });
    expect(r.status).toBe(200);
    expect(r.body.data.eligible).toBe(true);
    expect(r.body.data.emi).toBe(4000);
    expect(counts()).toEqual(before);
  });
});

// ── 4. approve / reject / cancel ────────────────────────────────────────────

describe('decide', () => {
  test('admin approves: approved, audit, finance + hr notified', async () => {
    const id = await raise();
    const r = await api.request('PUT', `/api/loans/${id}/approve`, { as: 'boss', body: { reason: 'ok' } });
    expect(r.status).toBe(200);
    expect(loanRow(id)).toMatchObject({ status: 'approved', decided_by: 'boss' });
    expect(audits(id).map((a) => a.action_type)).toEqual(['loan_requested', 'loan_approved']);
    const n = db.prepare("SELECT role_target FROM notifications WHERE type = 'LOAN_APPROVED' AND message LIKE ? ORDER BY role_target").all(`Loan #${id} %`);
    expect(n.map((x) => x.role_target)).toEqual(['finance', 'hr']);
  });

  test('the admin cannot approve or reject a loan raised under their name (engine-raised legacy row)', async () => {
    // The API never lets an admin raise (ruling B); the engine's self-approval guard is the backstop.
    const raised = L.requestLoan(db, body(), { username: 'boss', role: 'admin' });
    expect(raised.ok).toBe(true);
    let r = await api.request('PUT', `/api/loans/${raised.loanId}/approve`, { as: 'boss', body: {} });
    expect([r.status, r.body.code]).toEqual([403, 'SELF_APPROVAL']);
    r = await api.request('PUT', `/api/loans/${raised.loanId}/reject`, { as: 'boss', body: { reason: 'no' } });
    expect([r.status, r.body.code]).toEqual([403, 'SELF_APPROVAL']);
    expect(loanRow(raised.loanId).status).toBe('requested');
    r = await api.request('PUT', `/api/loans/${raised.loanId}/approve`, { as: 'boss2', body: {} });
    expect(r.status).toBe(200);
  });

  test('self-approval is case-insensitive on the username', async () => {
    const raised = L.requestLoan(db, body(), { username: 'BOSS', role: 'hr' });
    const r = await api.request('PUT', `/api/loans/${raised.loanId}/approve`, { as: 'boss', body: {} });
    expect([r.status, r.body.code]).toEqual([403, 'SELF_APPROVAL']);
  });

  test('reject needs a reason; then rejected with the reason in the audit row', async () => {
    const id = await raise();
    expect((await api.request('PUT', `/api/loans/${id}/reject`, { as: 'boss', body: {} })).body.code).toBe('REASON_REQUIRED');
    const r = await api.request('PUT', `/api/loans/${id}/reject`, { as: 'boss', body: { reason: 'over-borrowed' } });
    expect(r.status).toBe(200);
    expect(loanRow(id).status).toBe('rejected');
    const a = audits(id).pop();
    expect(a).toMatchObject({ action_type: 'loan_rejected', changed_by: 'boss' });
    expect(a.remark).toContain('over-borrowed');
    expect((await api.request('PUT', `/api/loans/${id}/approve`, { as: 'boss', body: {} })).body.code).toBe('ILLEGAL_TRANSITION');
  });

  test('exit-flagged: approve refused (400); disburse refused (400) even with the gate on', async () => {
    const id = await raise();
    L.flagForExit(db, id, { username: 'system', role: 'system' }, { exitDate: todayIst() });
    let r = await api.request('PUT', `/api/loans/${id}/approve`, { as: 'boss', body: {} });
    expect([r.status, r.body.code]).toEqual([400, 'LOAN_EXIT_FLAGGED']);

    const id2 = await approved();
    L.flagForExit(db, id2, { username: 'system', role: 'system' }, { exitDate: todayIst() });
    setGate(1);
    r = await api.request('POST', `/api/loans/${id2}/disburse`, { as: 'fin1', body: disburseBody() });
    setGate(0);
    expect([r.status, r.body.code]).toEqual([400, 'LOAN_EXIT_FLAGGED']);
    expect(loanRow(id2).status).toBe('approved');
  });

  test('admin cancels an approved loan: rejected + cancelled event + audit; hr / finance notified', async () => {
    const id = await approved();
    expect((await api.request('POST', `/api/loans/${id}/cancel`, { as: 'boss', body: {} })).body.code).toBe('REASON_REQUIRED');
    const r = await api.request('POST', `/api/loans/${id}/cancel`, { as: 'boss', body: { reason: 'employee no longer needs it' } });
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ status: 'rejected', cancelled: true });
    expect(loanRow(id).decision_reason).toBe('Cancelled after approval: employee no longer needs it');
    const e = events(id).pop();
    expect(e).toMatchObject({ event: 'cancelled', from_state: 'approved', to_state: 'rejected', actor: 'boss' });
    expect(audits(id).pop().action_type).toBe('loan_cancelled');
    expect(db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE type = 'LOAN_CANCELLED' AND message LIKE ?").get(`Loan #${id} %`).n).toBe(2);
  });

  test('cancel works on an exit-flagged approved loan; refused on requested and active loans', async () => {
    const id = await approved();
    L.flagForExit(db, id, { username: 'system', role: 'system' }, {});
    expect((await api.request('POST', `/api/loans/${id}/cancel`, { as: 'boss', body: { reason: 'left' } })).status).toBe(200);
    const req = await raise();
    expect((await api.request('POST', `/api/loans/${req}/cancel`, { as: 'boss', body: { reason: 'x' } })).body.code).toBe('ILLEGAL_TRANSITION');
    const act = await active();
    expect((await api.request('POST', `/api/loans/${act}/cancel`, { as: 'boss', body: { reason: 'x' } })).body.code).toBe('ILLEGAL_TRANSITION');
  });

  test('404 for a missing or malformed id', async () => {
    expect((await api.request('GET', '/api/loans/999999', { as: 'hr1' })).status).toBe(404);
    expect((await api.request('GET', '/api/loans/abc', { as: 'hr1' })).status).toBe(404);
    expect((await api.request('PUT', '/api/loans/999999/approve', { as: 'boss', body: {} })).body.code).toBe('LOAN_NOT_FOUND');
  });
});

// ── 5. disbursement + the gate (ruling A) ───────────────────────────────────

describe('disburse', () => {
  test('gate 0: 409 DISBURSEMENT_DISABLED and nothing written', async () => {
    const id = await approved();
    expect(gateValue()).toBe('0');
    const before = counts();
    const r = await api.request('POST', `/api/loans/${id}/disburse`, { as: 'fin1', body: disburseBody() });
    expect([r.status, r.body.code]).toEqual([409, 'DISBURSEMENT_DISABLED']);
    expect(counts()).toEqual(before);
    expect(loanRow(id).status).toBe('approved');
  });

  test('gate: anything but exactly "1" is off', async () => {
    const id = await approved();
    for (const v of ['true', 'yes', ' 2', '']) {
      setGate(v);
      expect((await api.request('POST', `/api/loans/${id}/disburse`, { as: 'fin1', body: disburseBody() })).body.code).toBe('DISBURSEMENT_DISABLED');
    }
    setGate(0);
  });

  test('PUT /policy cannot switch the gate on', async () => {
    const r = await api.request('PUT', '/api/loans/policy', { as: 'boss', body: { values: { loans_disbursement_enabled: '1' }, reason: 'go live' } });
    expect([r.status, r.body.code]).toEqual([400, 'POLICY_KEY_LOCKED']);
    expect(gateValue()).toBe('0');
    const mixed = await api.request('PUT', '/api/loans/policy', { as: 'boss', body: { values: { loan_close_day: 12, loans_disbursement_enabled: 1 }, reason: 'x' } });
    expect(mixed.body.code).toBe('POLICY_KEY_LOCKED');
    expect(db.prepare("SELECT value FROM policy_config WHERE key = 'loan_close_day'").get().value).toBe('13');
  });

  test('role / self checks come before the gate', async () => {
    const id = await approved('fin1');
    let r = await api.request('POST', `/api/loans/${id}/disburse`, { as: 'fin1', body: disburseBody() });
    expect([r.status, r.body.code]).toEqual([403, 'SELF_DISBURSEMENT']);
    r = await api.request('POST', `/api/loans/${id}/disburse`, { as: 'hr1', body: disburseBody() });
    expect(r.status).toBe(403);
  });

  test('gate 1: agreement required (3–200 chars); then active with schedule, audit, mode/reference', async () => {
    const id = await approved();
    setGate(1);
    try {
      const before = counts();
      for (const [ref, code] of [[undefined, 'AGREEMENT_REQUIRED'], ['  ', 'AGREEMENT_REQUIRED'], ['ab', 'AGREEMENT_REF_INVALID'], ['x'.repeat(201), 'AGREEMENT_REF_INVALID']]) {
        const r = await api.request('POST', `/api/loans/${id}/disburse`, { as: 'fin1', body: disburseBody({ agreementRef: ref }) });
        expect([ref && ref.length, r.status, r.body.code]).toEqual([ref && ref.length, 400, code]);
      }
      expect(counts()).toEqual(before);
      const r = await api.request('POST', `/api/loans/${id}/disburse`, { as: 'fin1', body: disburseBody({ agreementRef: 'DMS/AGR/2026/0007' }) });
      expect(r.status).toBe(200);
      expect(r.body.data.schedule.map((x) => x.amount)).toEqual([4000, 4000, 4000]);
      expect(loanRow(id)).toMatchObject({
        status: 'active', disbursed_by: 'fin1', disbursement_mode: 'NEFT', disbursement_reference: 'UTR123',
        agreement_file_path: 'DMS/AGR/2026/0007', remaining_balance: 12000,
      });
      const a = audits(id).pop();
      expect(a).toMatchObject({ action_type: 'loan_disbursed', changed_by: 'fin1' });
      expect(a.remark).toContain('UTR123');
    } finally { setGate(0); }
  });

  test('admin may record a disbursement (not of a loan they requested)', async () => {
    const id = await approved();
    setGate(1);
    const r = await api.request('POST', `/api/loans/${id}/disburse`, { as: 'boss', body: disburseBody() });
    setGate(0);
    expect(r.status).toBe(200);
  });
});

// ── 6. receipts ─────────────────────────────────────────────────────────────

describe('receipts', () => {
  test('finance records a numbered receipt; audit; above balance refused; requester warned', async () => {
    const id = await active('fin2');
    const r = await api.request('POST', `/api/loans/${id}/receipts`, { as: 'fin1', body: { amount: 3000, mode: 'cash', receiptDate: todayIst(), reference: 'R1' } });
    expect(r.status).toBe(201);
    expect(r.body.data.receiptNo).toMatch(/^LR\/\d{4}-\d{2}\/\d{5}$/);
    expect(r.body.data.balance).toBe(9000);
    const a = audits(id).pop();
    expect(a).toMatchObject({ action_type: 'loan_receipt', changed_by: 'fin1' });
    expect(a.remark).toContain(r.body.data.receiptNo);
    expect((await api.request('POST', `/api/loans/${id}/receipts`, { as: 'fin1', body: { amount: 99999, mode: 'cash', receiptDate: todayIst() } })).body.code).toBe('RECEIPT_ABOVE_BALANCE');
    const own = await api.request('POST', `/api/loans/${id}/receipts`, { as: 'fin2', body: { amount: 100, mode: 'cash', receiptDate: todayIst() } });
    expect(own.status).toBe(201);
    expect(own.body.data.warnings.map((w) => w.code)).toEqual(['RECEIPT_BY_REQUESTER']);
  });

  test('a receipt on a non-live loan is refused', async () => {
    const id = await approved();
    const r = await api.request('POST', `/api/loans/${id}/receipts`, { as: 'fin1', body: { amount: 10, mode: 'cash', receiptDate: todayIst() } });
    expect([r.status, r.body.code]).toEqual([400, 'LOAN_NOT_LIVE']);
  });
});

// ── 7. change requests ──────────────────────────────────────────────────────

describe('change requests', () => {
  test('defer: hr raises (dry run preview) → pending; second request 409; admin approves', async () => {
    const id = await active();
    const [i1] = instalments(id);
    const r = await api.request('POST', `/api/loans/${id}/requests`, { as: 'hr1', body: { kind: 'defer', instalmentId: i1.id, reason: 'medical leave' } });
    expect(r.status).toBe(201);
    expect(r.body.data.status).toBe('pending');
    expect(r.body.data.preview.added.amount).toBe(4000);
    expect(instalments(id).length).toBe(3);                                      // dry run rolled back
    expect(events(id).filter((e) => e.event === 'deferred')).toHaveLength(0);
    expect(audits(id).pop()).toMatchObject({ action_type: 'loan_change_requested', changed_by: 'hr1' });
    expect(db.prepare("SELECT role_target FROM notifications WHERE type = 'LOAN_CHANGE_REQUESTED' AND message LIKE ?").get(`Defer request #${r.body.data.requestId} %`).role_target).toBe('admin');

    const dup = await api.request('POST', `/api/loans/${id}/requests`, { as: 'fin1', body: { kind: 'write_off', reason: 'x' } });
    expect([dup.status, dup.body.code]).toEqual([409, 'REQUEST_ALREADY_PENDING']);

    const ok = await api.request('POST', `/api/loans/requests/${r.body.data.requestId}/approve`, { as: 'boss', body: {} });
    expect(ok.status).toBe(200);
    expect(instalments(id).map((i) => [i.status, i.origin])).toEqual([['deferred', 'schedule'], ['scheduled', 'schedule'], ['scheduled', 'schedule'], ['scheduled', 'deferred']]);
    const deferredAudit = audits(id).find((a) => a.action_type === 'loan_deferred');
    expect(deferredAudit.changed_by).toBe('boss');
    expect(deferredAudit.remark).toContain('medical leave');
    expect(db.prepare('SELECT status, decided_by FROM loan_requests WHERE id = ?').get(r.body.data.requestId)).toEqual({ status: 'approved', decided_by: 'boss' });
    const again = await api.request('POST', `/api/loans/requests/${r.body.data.requestId}/approve`, { as: 'boss', body: {} });
    expect([again.status, again.body.code]).toEqual([409, 'REQUEST_NOT_PENDING']);
  });

  test('ruling B: the admin cannot raise a change request', async () => {
    const id = await active();
    const before = counts();
    const r = await api.request('POST', `/api/loans/${id}/requests`, { as: 'boss', body: { kind: 'write_off', reason: 'x' } });
    expect([r.status, r.body.code, r.body.error]).toEqual([403, 'ADMIN_CANNOT_RAISE', 'HR raises loans; admin approves']);
    expect(counts()).toEqual(before);
    // and the engine refuses the same when called directly
    expect(L.requestChange(db, { loanId: id, kind: 'write_off', reason: 'x' }, { username: 'boss', role: 'admin' }).code).toBe('ADMIN_CANNOT_RAISE');
  });

  test('the admin cannot approve a change raised under their own name (legacy row)', async () => {
    const id = await active();
    const rid = db.prepare(`INSERT INTO loan_requests (loan_id, kind, payload, reason, requested_by, requested_by_role)
                            VALUES (?, 'write_off', '{}', 'x', 'boss', 'hr')`).run(id).lastInsertRowid;
    const r = await api.request('POST', `/api/loans/requests/${rid}/approve`, { as: 'boss', body: {} });
    expect([r.status, r.body.code]).toEqual([403, 'SELF_APPROVAL']);
    expect((await api.request('POST', `/api/loans/requests/${rid}/reject`, { as: 'boss', body: { reason: 'x' } })).body.code).toBe('SELF_APPROVAL');
    expect((await api.request('POST', `/api/loans/requests/${rid}/approve`, { as: 'boss2', body: {} })).status).toBe(200);
    expect(loanRow(id).status).toBe('written_off');
  });

  test('withdraw: only the requester; reject needs a reason', async () => {
    const id = await active();
    const rid = await pendingRequest(id, 'hr1');
    expect((await api.request('POST', `/api/loans/requests/${rid}/withdraw`, { as: 'hr2', body: {} })).body.code).toBe('NOT_REQUESTER');
    expect((await api.request('POST', `/api/loans/requests/${rid}/withdraw`, { as: 'hr1', body: {} })).status).toBe(200);
    const rid2 = await pendingRequest(id, 'fin1');
    expect((await api.request('POST', `/api/loans/requests/${rid2}/reject`, { as: 'boss', body: {} })).body.code).toBe('REASON_REQUIRED');
    const rj = await api.request('POST', `/api/loans/requests/${rid2}/reject`, { as: 'boss', body: { reason: 'not justified' } });
    expect(rj.status).toBe(200);
    expect(instalments(id).every((i) => i.status === 'scheduled')).toBe(true);
    expect(events(id).map((e) => e.event).slice(-4)).toEqual(['change_requested', 'change_withdrawn', 'change_requested', 'change_rejected']);
  });

  test('dry run refuses an impossible request at once', async () => {
    const id = await active();
    const other = await active();
    let r = await api.request('POST', `/api/loans/${id}/requests`, { as: 'hr1', body: { kind: 'defer', instalmentId: instalments(other)[0].id, reason: 'x' } });
    expect([r.status, r.body.code]).toEqual([404, 'INSTALMENT_NOT_FOUND']);
    r = await api.request('POST', `/api/loans/${id}/requests`, { as: 'hr1', body: { kind: 'restructure', newTenure: 13, reason: 'x' } });
    expect([r.status, r.body.code]).toEqual([400, 'NOT_ELIGIBLE']);
    r = await api.request('POST', `/api/loans/${id}/requests`, { as: 'hr1', body: { kind: 'restructure', newTenure: 4, newEmi: 100, reason: 'x' } });
    expect(r.body.code).toBe('RESTRUCTURE_TERMS_INVALID');
    r = await api.request('POST', `/api/loans/${id}/requests`, { as: 'hr1', body: { kind: 'skip', reason: 'x' } });
    expect(r.body.code).toBe('KIND_INVALID');
    const req = await raise();
    r = await api.request('POST', `/api/loans/${req}/requests`, { as: 'hr1', body: { kind: 'write_off', reason: 'x' } });
    expect(r.body.code).toBe('LOAN_NOT_LIVE');
    expect(db.prepare('SELECT COUNT(*) AS n FROM loan_requests WHERE loan_id IN (?, ?)').get(id, req).n).toBe(0);
  });

  test('a request that went stale is refused at approval and stays pending', async () => {
    const id = await active();
    const last = instalments(id)[2];
    const rid = await pendingRequest(id, 'hr1', { kind: 'defer', instalmentId: last.id, reason: 'x' });
    // a receipt clears the schedule from the end → the last instalment is paid in cash
    expect((await api.request('POST', `/api/loans/${id}/receipts`, { as: 'fin1', body: { amount: 4000, mode: 'cash', receiptDate: todayIst() } })).status).toBe(201);
    const r = await api.request('POST', `/api/loans/requests/${rid}/approve`, { as: 'boss', body: {} });
    expect([r.status, r.body.code]).toEqual([400, 'INSTALMENT_NOT_SCHEDULED']);
    expect(db.prepare('SELECT status FROM loan_requests WHERE id = ?').get(rid).status).toBe('pending');
    expect((await api.request('POST', `/api/loans/requests/${rid}/reject`, { as: 'boss', body: { reason: 'stale' } })).status).toBe(200);
  });

  test('restructure with a top-up: request allowed at gate 0, approval 409 until the gate is on', async () => {
    const id = await active();
    const r = await api.request('POST', `/api/loans/${id}/requests`, { as: 'hr1', body: { kind: 'restructure', newTenure: 6, topupAmount: 6000, reason: 'wedding' } });
    expect(r.status).toBe(201);
    const rid = r.body.data.requestId;
    let a = await api.request('POST', `/api/loans/requests/${rid}/approve`, { as: 'boss', body: disburseBody() });
    expect([a.status, a.body.code]).toEqual([409, 'DISBURSEMENT_DISABLED']);
    expect(db.prepare('SELECT status FROM loan_requests WHERE id = ?').get(rid).status).toBe('pending');
    setGate(1);
    try {
      a = await api.request('POST', `/api/loans/requests/${rid}/approve`, { as: 'boss', body: disburseBody({ agreementRef: '' }) });
      expect(a.body.code).toBe('AGREEMENT_REQUIRED');
      a = await api.request('POST', `/api/loans/requests/${rid}/approve`, { as: 'boss', body: disburseBody({ agreementRef: 'AGR-TOPUP-1' }) });
      expect(a.status).toBe(200);
    } finally { setGate(0); }
    expect(loanRow(id)).toMatchObject({ remaining_balance: 18000, disbursed_amount: 18000, principal_amount: 12000 });
    expect(L.reconcileLoan(db, id).ok).toBe(true);
  });

  test('restructure without top-up and write-off go through at gate 0', async () => {
    const id = await active();
    let rid = (await api.request('POST', `/api/loans/${id}/requests`, { as: 'fin1', body: { kind: 'restructure', newTenure: 4, reason: 'lower EMI' } })).body.data.requestId;
    expect((await api.request('POST', `/api/loans/requests/${rid}/approve`, { as: 'boss', body: {} })).status).toBe(200);
    expect(loanRow(id).emi_amount).toBe(3000);
    expect(audits(id).some((a) => a.action_type === 'loan_restructured' && a.changed_by === 'boss')).toBe(true);
    rid = (await api.request('POST', `/api/loans/${id}/requests`, { as: 'fin1', body: { kind: 'write_off', reason: 'uncollectable' } })).body.data.requestId;
    const w = await api.request('POST', `/api/loans/requests/${rid}/approve`, { as: 'boss', body: {} });
    expect(w.status).toBe(200);
    expect(loanRow(id)).toMatchObject({ status: 'written_off', remaining_balance: 0, written_off_amount: 12000 });
    const wa = audits(id).find((a) => a.action_type === 'loan_written_off');
    expect(wa.changed_by).toBe('boss');
    expect(wa.remark).toContain('uncollectable');
    expect(L.reconcileLoan(db, id).ok).toBe(true);
  });
});

// ── 8. reads ────────────────────────────────────────────────────────────────

describe('reads', () => {
  test('detail of a requested loan carries the approval check; queue lists Emergency first', async () => {
    const normal = await raise();
    const urgent = await raise('hr1', { loanType: 'Emergency / medical' });
    const d = await api.request('GET', `/api/loans/${normal}`, { as: 'boss' });
    expect(d.body.data.approvalCheck).toMatchObject({ eligible: true, exitFlagged: false });
    const q = await api.request('GET', '/api/loans/queue', { as: 'boss' });
    const ids = q.body.data.loans.map((l) => l.id);
    expect(ids.indexOf(urgent)).toBeLessThan(ids.indexOf(normal));
    expect(q.body.data.loans[0].urgent).toBe(true);
  });

  test('employee tab keeps paidEmis / totalRecovered and counts cash', async () => {
    const code = employee();
    const id = await active('hr1', { employeeCode: code });
    await api.request('POST', `/api/loans/${id}/receipts`, { as: 'fin1', body: { amount: 4000, mode: 'cash', receiptDate: todayIst() } });
    const r = await api.request('GET', `/api/loans/employee/${code}`, { as: 'hr1' });
    expect(r.body.data).toHaveLength(1);
    expect(r.body.data[0]).toMatchObject({ paidEmis: 1, totalRecovered: 4000, recoveredByCash: 4000, remainingEmis: 2 });
  });

  test('stats, due, types, policy, statement', async () => {
    const s = await api.request('GET', '/api/loans/stats', { as: 'view1' });
    expect(s.body.data.disbursementEnabled).toBe(false);
    expect(s.body.data.outstanding).toBeGreaterThan(0);
    const due = await api.request('GET', '/api/loans/due', { as: 'hr1' });
    expect(due.body.code).toBe('MONTH_REQUIRED');
    expect((await api.request('GET', '/api/loans/types', { as: 'hr1' })).body.data).toEqual(['Personal', 'Emergency / medical', 'Festival advance', 'Education']);
    const p = await api.request('GET', '/api/loans/policy', { as: 'view1' });
    expect(p.body.data.editableKeys).not.toContain('loans_disbursement_enabled');
    expect(p.body.data.raw.loans_disbursement_enabled).toBe('0');
    const id = await active();
    const st = await api.request('GET', `/api/loans/${id}/statement`, { as: 'view1' });
    expect(st.body.data.closing).toBe(12000);
  });

  test('company RBAC: a user limited to one company sees and touches only that company', async () => {
    const ind = await raise();
    const aliCode = employee({ company: ALI });
    const ali = await raise('hr1', { employeeCode: aliCode, company: ALI });
    const list = await api.request('GET', '/api/loans', { as: 'hrAsian' });
    expect(list.body.data.every((l) => l.company === ALI)).toBe(true);
    expect(list.body.data.map((l) => l.id)).toContain(ali);
    expect((await api.request('GET', `/api/loans/${ind}`, { as: 'hrAsian' })).body.code).toBe('COMPANY_NOT_ALLOWED');
    const r = await api.request('POST', '/api/loans', { as: 'hrAsian', body: body() });
    expect([r.status, r.body.code]).toEqual([403, 'COMPANY_NOT_ALLOWED']);
    expect((await api.request('POST', '/api/loans', { as: 'hrAsian', body: body({ employeeCode: employee({ company: ALI }), company: ALI }) })).status).toBe(201);
  });
});

// ── 9. policy ───────────────────────────────────────────────────────────────

describe('policy (admin)', () => {
  test('valid change: written + one audit row per changed key; invalid / unknown / no reason refused', async () => {
    expect((await api.request('PUT', '/api/loans/policy', { as: 'boss', body: { values: { loan_close_day: 14 } } })).body.code).toBe('REASON_REQUIRED');
    expect((await api.request('PUT', '/api/loans/policy', { as: 'boss', body: { values: { loan_close_day: 40 }, reason: 'x' } })).body.code).toBe('POLICY_VALUE_INVALID');
    expect((await api.request('PUT', '/api/loans/policy', { as: 'boss', body: { values: { loan_interest_rate: 5 }, reason: 'x' } })).body.code).toBe('POLICY_VALUE_INVALID');
    expect((await api.request('PUT', '/api/loans/policy', { as: 'boss', body: { values: { salary_divisor: 30 }, reason: 'x' } })).body.code).toBe('POLICY_KEY_UNKNOWN');
    const r = await api.request('PUT', '/api/loans/policy', { as: 'boss', body: { values: { loan_close_day: 14, loan_max_tenure_months: 12 }, reason: 'payroll date moved' } });
    expect(r.status).toBe(200);
    expect(r.body.data.changed).toEqual([{ key: 'loan_close_day', from: '13', to: '14' }]);   // tenure unchanged → no row
    const a = db.prepare("SELECT * FROM audit_log WHERE table_name = 'policy_config' AND field_name = 'loan_close_day' ORDER BY id DESC").get();
    expect(a).toMatchObject({ old_value: '13', new_value: '14', changed_by: 'boss', remark: 'payroll date moved', action_type: 'loan_policy_change' });
    await api.request('PUT', '/api/loans/policy', { as: 'boss', body: { values: { loan_close_day: 13 }, reason: 'back' } });
  });
});

// ── 10. retired endpoints ───────────────────────────────────────────────────

describe('retired endpoints (410)', () => {
  test.each([
    ['POST', '/api/loans/process-deductions'], ['GET', '/api/loans/deductions?month=10&year=2026'],
    ['GET', '/api/loans/monthly-recovery/10/2026'], ['POST', '/api/loans/1/recover'], ['POST', '/api/loans/1/skip'],
    ['PUT', '/api/loans/1/close'],
  ])('%s %s → 410 for every role, nothing written', async (method, url) => {
    for (const as of Object.values(ALL_ROLES_AS)) {
      const before = counts();
      const r = await api.request(method, url, { as, body: { month: 10, year: 2026, amount: 100 } });
      expect([as, r.status, r.body.code]).toEqual([as, 410, 'ENDPOINT_RETIRED']);
      expect(counts()).toEqual(before);
    }
  });
});

// ── 11. portal (D12) ────────────────────────────────────────────────────────

describe('employee portal', () => {
  test('shows the employee\'s own loans, never rejected ones, without internal fields', async () => {
    employee({ code: 'PORTAL1' });
    const live = await active('hr1', { employeeCode: 'PORTAL1' });
    // reject needs a second open-loan slot: reject the live one's sibling raised via the engine
    const rejected = L.requestLoan(db, body({ employeeCode: employee() }), { username: 'hr2', role: 'hr' });
    db.prepare("UPDATE loans SET employee_code = 'PORTAL1', status = 'rejected' WHERE id = ?").run(rejected.loanId);
    const r = await api.request('GET', '/api/portal/loans', { as: 'emp1' });
    expect(r.status).toBe(200);
    expect(r.body.data.map((l) => l.id)).toEqual([live]);
    expect(r.body.data[0]).not.toHaveProperty('agreement_file_path');
    expect(r.body.data[0]).not.toHaveProperty('decision_reason');
    expect(r.body.data[0].status).toBe('active');
  });
});

// ── 12. end to end over HTTP ────────────────────────────────────────────────

describe('end to end', () => {
  test('raise → approve → disburse → defer → receipt → restructure → final receipt → completed; salary tables untouched', async () => {
    db.prepare(`INSERT INTO salary_computations (employee_code, month, year, company, gross_salary, gross_earned, total_deductions, net_salary)
                VALUES ('E2E-OTHER', 9, 2026, ?, 20000, 20000, 1000, 19000)`).run(IND);
    const salaryBefore = db.prepare('SELECT COUNT(*) AS n, SUM(net_salary) AS net, SUM(loan_recovery) AS loan FROM salary_computations').get();
    const salesBefore = db.prepare('SELECT COUNT(*) AS n FROM sales_salary_computations').get();
    const code = employee();

    const raised = await api.request('POST', '/api/loans', { as: 'hr1', body: body({ employeeCode: code, principal: 12000, tenure: 3, reason: 'house repair' }) });
    expect(raised.status).toBe(201);
    const id = raised.body.data.loanId;
    expect((await api.request('PUT', `/api/loans/${id}/approve`, { as: 'boss', body: { reason: 'ok' } })).status).toBe(200);
    expect((await api.request('POST', `/api/loans/${id}/disburse`, { as: 'fin1', body: disburseBody() })).body.code).toBe('DISBURSEMENT_DISABLED');
    setGate(1);                                        // set directly in the test DB (ruling A)
    try {
      expect((await api.request('POST', `/api/loans/${id}/disburse`, { as: 'fin1', body: disburseBody() })).status).toBe(200);
    } finally { setGate(0); }

    const [i1] = instalments(id);
    const rid = (await api.request('POST', `/api/loans/${id}/requests`, { as: 'hr1', body: { kind: 'defer', instalmentId: i1.id, reason: 'leave' } })).body.data.requestId;
    expect((await api.request('POST', `/api/loans/requests/${rid}/approve`, { as: 'boss', body: {} })).status).toBe(200);

    expect((await api.request('POST', `/api/loans/${id}/receipts`, { as: 'fin1', body: { amount: 2000, mode: 'cash', receiptDate: todayIst() } })).status).toBe(201);

    const rid2 = (await api.request('POST', `/api/loans/${id}/requests`, { as: 'fin1', body: { kind: 'restructure', newTenure: 2, reason: 'faster' } })).body.data.requestId;
    expect((await api.request('POST', `/api/loans/requests/${rid2}/approve`, { as: 'boss', body: {} })).status).toBe(200);
    expect(loanRow(id).remaining_balance).toBe(10000);

    const last = await api.request('POST', `/api/loans/${id}/receipts`, { as: 'fin2', body: { amount: 10000, mode: 'cheque', reference: 'CHQ-1', receiptDate: todayIst() } });
    expect(last.status).toBe(201);
    expect(last.body.data.loanStatus).toBe('completed');

    const detail = (await api.request('GET', `/api/loans/${id}`, { as: 'view1' })).body.data;
    expect(detail.status).toBe('completed');
    expect(detail.remaining_balance).toBe(0);
    expect(detail.reconciliation).toMatchObject({ ok: true, balance: 0, receipts: 12000 });
    expect(detail.receipts).toHaveLength(2);
    expect(detail.requests.map((r) => [r.kind, r.status])).toEqual([['defer', 'approved'], ['restructure', 'approved']]);
    expect((await api.request('GET', `/api/loans/${id}/statement`, { as: 'view1' })).body.data.closing).toBe(0);

    const actions = audits(id).map((a) => a.action_type);
    for (const a of ['loan_requested', 'loan_approved', 'loan_disbursed', 'loan_change_requested', 'loan_deferred',
      'loan_change_approved', 'loan_receipt', 'loan_restructured', 'loan_completed']) expect(actions).toContain(a);
    expect(audits(id).every((a) => a.changed_by)).toBe(true);

    expect(db.prepare('SELECT COUNT(*) AS n, SUM(net_salary) AS net, SUM(loan_recovery) AS loan FROM salary_computations').get()).toEqual(salaryBefore);
    expect(db.prepare('SELECT COUNT(*) AS n FROM sales_salary_computations').get()).toEqual(salesBefore);
    expect(db.prepare('SELECT COUNT(*) AS n FROM salary_computations WHERE ABS(net_salary - (gross_earned - total_deductions)) > 1').get().n).toBe(0);
  });

  test('every live and finished loan reconciles', () => {
    const all = L.reconcileAll(db);
    expect(all.mismatches).toEqual([]);
    expect(all.checked).toBeGreaterThan(5);
  });
});
