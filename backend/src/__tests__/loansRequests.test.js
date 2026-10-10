/**
 * Loans PR-3 — engine additions: pending change requests (services/loans/requests.js),
 * cancelLoan, the policy validator and the disbursement gate, and the
 * loan_requests table on an already-migrated database.
 */
const { initSchema } = require('../database/schema');
const {
  L, F, COMPANY, ASOF, HR, HR2, FIN, ADMIN, ADMIN2, VIEWER, SYS, plant, activeLoan, instalments, loan, events, deductAndPost,
} = require('./helpers/loanFixture');

let db;
beforeEach(() => { db = F.newDb(); });
afterEach(() => db.close());

const reqRow = (id) => db.prepare('SELECT * FROM loan_requests WHERE id = ?').get(id);
const deferReq = (loanId, actor = HR, i = 0) => L.requestChange(db, { loanId, kind: 'defer', instalmentId: instalments(db, loanId)[i].id, reason: 'leave' }, actor, { asOf: ASOF });
const enableDisbursement = () => F.setPolicy(db, 'loans_disbursement_enabled', '1');

describe('schema', () => {
  test('loan_requests + gate exist on a fresh DB', () => {
    expect(db.prepare("SELECT type FROM sqlite_master WHERE name = 'loan_requests'").get().type).toBe('table');
    expect(db.prepare("SELECT value FROM policy_config WHERE key = 'loans_disbursement_enabled'").get().value).toBe('0');
  });

  test('an already-migrated DB (flag set) gets loan_requests on the next boot; the gate is never overwritten', () => {
    db.exec('DROP INDEX uniq_loan_requests_one_pending; DROP INDEX idx_loan_requests_status; DROP TABLE loan_requests');
    F.setPolicy(db, 'loans_disbursement_enabled', '1');
    F.silently(() => initSchema(db));
    expect(db.prepare("SELECT type FROM sqlite_master WHERE name = 'loan_requests'").get().type).toBe('table');
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'uniq_loan_requests_one_pending'").get()).toBeTruthy();
    expect(db.prepare("SELECT value FROM policy_config WHERE key = 'loans_disbursement_enabled'").get().value).toBe('1');
  });

  test('CHECKs: kind, status, non-blank reason; one pending per loan', () => {
    const { loanId } = activeLoan(db);
    const ins = (over) => () => db.prepare(`INSERT INTO loan_requests (loan_id, kind, status, reason, requested_by, requested_by_role)
      VALUES (?, ?, ?, ?, 'hr1', 'hr')`).run(loanId, over.kind || 'defer', over.status || 'pending', over.reason ?? 'x');
    expect(ins({ kind: 'skip' })).toThrow(/CHECK/);
    expect(ins({ status: 'done' })).toThrow(/CHECK/);
    expect(ins({ reason: '  ' })).toThrow(/CHECK/);
    ins({})();
    expect(ins({ kind: 'write_off' })).toThrow(/UNIQUE/);
    ins({ status: 'rejected' })();
  });
});

describe('requestChange', () => {
  test('hr raises a defer: pending, dry run leaves the schedule untouched, event written', () => {
    const { loanId } = activeLoan(db);
    const before = instalments(db, loanId);
    const r = deferReq(loanId);
    expect(r.ok).toBe(true);
    expect(r.preview.added).toMatchObject({ amount: 3334, origin: 'deferred' });
    expect(instalments(db, loanId)).toEqual(before);
    expect(reqRow(r.requestId)).toMatchObject({ status: 'pending', kind: 'defer', requested_by: 'hr1', requested_by_role: 'hr' });
    expect(events(db, loanId).pop()).toMatchObject({ event: 'change_requested', actor: 'hr1' });
  });

  test('admin cannot raise (ruling B); viewer cannot; reason and kind required', () => {
    const { loanId } = activeLoan(db);
    expect(L.requestChange(db, { loanId, kind: 'write_off', reason: 'x' }, ADMIN).code).toBe('ADMIN_CANNOT_RAISE');
    expect(L.requestChange(db, { loanId, kind: 'write_off', reason: 'x' }, VIEWER).code).toBe('ROLE_NOT_ALLOWED');
    expect(L.requestChange(db, { loanId, kind: 'write_off', reason: ' ' }, HR).code).toBe('REASON_REQUIRED');
    expect(L.requestChange(db, { loanId, kind: 'close', reason: 'x' }, HR).code).toBe('KIND_INVALID');
    expect(db.prepare('SELECT COUNT(*) AS n FROM loan_requests').get().n).toBe(0);
  });

  test('second pending request refused; allowed again once decided', () => {
    const { loanId } = activeLoan(db);
    const r1 = deferReq(loanId);
    expect(L.requestChange(db, { loanId, kind: 'write_off', reason: 'x' }, FIN).code).toBe('REQUEST_ALREADY_PENDING');
    expect(L.rejectChange(db, r1.requestId, ADMIN, { reason: 'no' }).ok).toBe(true);
    expect(L.requestChange(db, { loanId, kind: 'write_off', reason: 'x' }, FIN).ok).toBe(true);
  });

  test('dry-run refusals carry the engine code', () => {
    const { loanId } = activeLoan(db);
    const [i1] = instalments(db, loanId);
    deductAndPost(db, loanId, i1, 3334);
    expect(L.requestChange(db, { loanId, kind: 'defer', instalmentId: i1.id, reason: 'x' }, HR).code).toBe('INSTALMENT_NOT_SCHEDULED');
    expect(L.requestChange(db, { loanId, kind: 'defer', reason: 'x' }, HR).code).toBe('INSTALMENT_REQUIRED');
    expect(L.requestChange(db, { loanId, kind: 'restructure', newEmi: 20000, reason: 'x' }, HR, { asOf: ASOF }).code).toBe('NOT_ELIGIBLE');
    expect(L.requestChange(db, { loanId, kind: 'restructure', newTenure: 0, reason: 'x' }, HR).code).toBe('TENURE_INVALID');
    expect(L.requestChange(db, { loanId: 9999, kind: 'write_off', reason: 'x' }, HR).code).toBe('LOAN_NOT_FOUND');
  });

  test('write-off preview on a recover-at-exit loan', () => {
    const { loanId } = activeLoan(db);
    L.flagForExit(db, loanId, SYS, {});
    const r = L.requestChange(db, { loanId, kind: 'write_off', reason: 'left, unrecoverable' }, FIN);
    expect(r.ok).toBe(true);
    expect(r.preview).toMatchObject({ status: 'settled_at_exit', writtenOff: 10000 });
    expect(loan(db, loanId).status).toBe('recover_at_exit');
  });
});

describe('approve / reject / withdraw', () => {
  test('approve applies the change with requester + approver in the reason; result stored', () => {
    const { loanId } = activeLoan(db);
    const r = deferReq(loanId);
    const a = L.approveChange(db, r.requestId, ADMIN);
    expect(a.ok).toBe(true);
    expect(instalments(db, loanId)[0].status).toBe('deferred');
    const row = reqRow(r.requestId);
    expect(row).toMatchObject({ status: 'approved', decided_by: 'boss' });
    expect(JSON.parse(row.result).added.origin).toBe('deferred');
    const deferred = events(db, loanId).find((e) => e.event === 'deferred');
    expect(deferred.reason).toContain('requested by hr1, approved by boss');
    expect(events(db, loanId).pop().event).toBe('change_approved');
  });

  test('maker-checker: hr / finance cannot approve; same username cannot', () => {
    const { loanId } = activeLoan(db);
    const r = deferReq(loanId);
    expect(L.approveChange(db, r.requestId, HR2).code).toBe('ROLE_NOT_ALLOWED');
    expect(L.approveChange(db, r.requestId, FIN).code).toBe('ROLE_NOT_ALLOWED');
    expect(L.approveChange(db, r.requestId, { username: 'HR1', role: 'admin' }).code).toBe('SELF_APPROVAL');
    expect(L.rejectChange(db, r.requestId, { username: 'hr1', role: 'admin' }, { reason: 'x' }).code).toBe('SELF_APPROVAL');
    expect(reqRow(r.requestId).status).toBe('pending');
  });

  test('a refusal at approval rolls everything back and leaves the request pending', () => {
    const { loanId } = activeLoan(db);
    const r = deferReq(loanId, HR, 2);
    L.recordReceipt(db, loanId, FIN, { amount: 3332, mode: 'cash', receiptDate: ASOF }, { asOf: ASOF });
    const eventsBefore = events(db, loanId).length;
    const a = L.approveChange(db, r.requestId, ADMIN2);
    expect(a.code).toBe('INSTALMENT_NOT_SCHEDULED');
    expect(reqRow(r.requestId)).toMatchObject({ status: 'pending', decided_by: null });
    expect(events(db, loanId).length).toBe(eventsBefore);
    expect(L.approveChange(db, 9999, ADMIN).code).toBe('REQUEST_NOT_FOUND');
  });

  test('top-up approval is refused while the disbursement gate is off (ruling A)', () => {
    const { loanId } = activeLoan(db);
    const r = L.requestChange(db, { loanId, kind: 'restructure', newTenure: 6, topupAmount: 6000, reason: 'x' }, HR, { asOf: ASOF });
    expect(r.ok).toBe(true);
    const topup = { mode: 'NEFT', reference: 'T1', disbursedOn: ASOF, agreementFilePath: 'AGR-2' };
    expect(L.approveChange(db, r.requestId, ADMIN, { topup, asOf: ASOF }).code).toBe('DISBURSEMENT_DISABLED');
    expect(loan(db, loanId).remaining_balance).toBe(10000);
    enableDisbursement();
    const a = L.approveChange(db, r.requestId, ADMIN, { topup, asOf: ASOF });
    expect(a.ok).toBe(true);
    expect(loan(db, loanId)).toMatchObject({ remaining_balance: 16000, disbursed_amount: 16000 });
    expect(L.reconcileLoan(db, loanId).ok).toBe(true);
  });

  test('write-off via request; reject needs a reason; withdraw only by the requester', () => {
    const { loanId } = activeLoan(db);
    const w = L.requestChange(db, { loanId, kind: 'write_off', reason: 'x' }, FIN);
    expect(L.rejectChange(db, w.requestId, ADMIN, {}).code).toBe('REASON_REQUIRED');
    expect(L.withdrawChange(db, w.requestId, HR).code).toBe('NOT_REQUESTER');
    expect(L.withdrawChange(db, w.requestId, FIN).ok).toBe(true);
    expect(L.withdrawChange(db, w.requestId, FIN).code).toBe('REQUEST_NOT_PENDING');
    const w2 = L.requestChange(db, { loanId, kind: 'write_off', reason: 'x' }, FIN);
    expect(L.approveChange(db, w2.requestId, ADMIN).ok).toBe(true);
    expect(loan(db, loanId).status).toBe('written_off');
    expect(L.listRequests(db, { loanId }).map((x) => x.status)).toEqual(['withdrawn', 'approved']);
  });
});

describe('cancelLoan', () => {
  const approvedLoan = () => {
    const e = plant(db);
    const r = L.requestLoan(db, { borrowerType: 'plant', employeeCode: e.code, company: COMPANY, loanType: 'Personal', principal: 6000, tenure: 3, reason: 'x' }, HR, { asOf: ASOF });
    L.approveLoan(db, r.loanId, ADMIN, { asOf: ASOF });
    return r.loanId;
  };
  test('admin cancels approved → rejected with a cancelled event; frees the one-loan slot', () => {
    const id = approvedLoan();
    expect(L.cancelLoan(db, id, HR, { reason: 'x' }).code).toBe('ROLE_NOT_ALLOWED');
    expect(L.cancelLoan(db, id, FIN, { reason: 'x' }).code).toBe('ROLE_NOT_ALLOWED');
    expect(L.cancelLoan(db, id, ADMIN, {}).code).toBe('REASON_REQUIRED');
    const r = L.cancelLoan(db, id, ADMIN, { reason: 'not needed' });
    expect(r).toMatchObject({ ok: true, status: 'rejected', cancelled: true });
    expect(events(db, id).pop()).toMatchObject({ event: 'cancelled', from_state: 'approved', to_state: 'rejected' });
    const code = loan(db, id).employee_code;
    const again = L.requestLoan(db, { borrowerType: 'plant', employeeCode: code, company: COMPANY, loanType: 'Personal', principal: 6000, tenure: 3, reason: 'y' }, HR, { asOf: ASOF });
    expect(again.ok).toBe(true);
  });
  test('only approved loans', () => {
    const { loanId } = activeLoan(db);
    expect(L.cancelLoan(db, loanId, ADMIN, { reason: 'x' }).code).toBe('ILLEGAL_TRANSITION');
    expect(L.cancelLoan(db, 9999, ADMIN, { reason: 'x' }).code).toBe('LOAN_NOT_FOUND');
  });
});

describe('policy validator and gate', () => {
  test('validatePolicyValue', () => {
    expect(L.validatePolicyValue('loan_close_day', 14)).toEqual({ ok: true, key: 'loan_close_day', value: '14' });
    expect(L.validatePolicyValue('loan_close_day', 29).code).toBe('POLICY_VALUE_INVALID');
    expect(L.validatePolicyValue('loan_types', ['Personal', 'Education'])).toMatchObject({ ok: true, value: '["Personal","Education"]' });
    expect(L.validatePolicyValue('loan_types', []).code).toBe('POLICY_VALUE_INVALID');
    expect(L.validatePolicyValue('loan_agreement_required', 'false')).toMatchObject({ ok: true, value: 'false' });
    expect(L.validatePolicyValue('loan_interest_rate', 2).code).toBe('POLICY_VALUE_INVALID');
    expect(L.validatePolicyValue('loans_disbursement_enabled', '1').code).toBe('POLICY_KEY_UNKNOWN');
    expect(L.POLICY_KEYS.map((k) => k.key)).not.toContain('loans_disbursement_enabled');
    expect(L.POLICY_KEYS).toHaveLength(17);   // Loans PR-9 added loan_emi_net_flag_pct
  });
  test('disbursementEnabled: only the exact string 1', () => {
    expect(L.disbursementEnabled(db)).toBe(false);
    for (const [v, want] of [['1', true], [' 1 ', true], ['true', false], ['0', false], ['', false]]) {
      F.setPolicy(db, 'loans_disbursement_enabled', v);
      expect([v, L.disbursementEnabled(db)]).toEqual([v, want]);
    }
    db.prepare("DELETE FROM policy_config WHERE key = 'loans_disbursement_enabled'").run();
    expect(L.disbursementEnabled(db)).toBe(false);
  });
  test('readLoanPolicy ignores the gate key (no warning, no field)', () => {
    const p = L.readLoanPolicy(db);
    expect(p.warnings).toEqual([]);
    expect(p).not.toHaveProperty('loansDisbursementEnabled');
  });
});
