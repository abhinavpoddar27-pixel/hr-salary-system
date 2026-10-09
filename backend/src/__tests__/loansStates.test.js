/**
 * Loans PR-2 — state machine + maker-checker (docs/loans/SPEC.md §5.4, §5.5, §7, D-3, D-25, K35).
 */
const { L, F, COMPANY, ASOF, HR, HR2, FIN, FIN2, ADMIN, ADMIN2, VIEWER, SYS, plant, activeLoan, instalments, loan, events } = require('./helpers/loanFixture');
const S = require('../services/loans/states');

let db;
beforeEach(() => { db = F.newDb(); });

const req = (emp, actor = HR, over = {}) => L.requestLoan(db, {
  borrowerType: 'plant', employeeCode: emp.code, company: COMPANY, loanType: 'Personal', principal: 10000, tenure: 3, reason: 'family', ...over,
}, actor, { asOf: ASOF });
const disb = (id, actor = FIN, over = {}) => L.disburseLoan(db, id, actor, { mode: 'NEFT', reference: 'UTR9', disbursedOn: '2026-10-05', agreementFilePath: 'a.pdf', ...over }, { asOf: ASOF });

describe('state tables', () => {
  test('every loan state has an entry; terminal states have none', () => {
    for (const s of S.LOAN_STATES) expect(Array.isArray(S.LOAN_TRANSITIONS[s])).toBe(true);
    for (const s of ['rejected', 'completed', 'settled_at_exit', 'written_off']) expect(S.LOAN_TRANSITIONS[s]).toEqual([]);
    for (const s of S.INSTALMENT_STATES) expect(Array.isArray(S.INSTALMENT_TRANSITIONS[s])).toBe(true);
  });
  test('legal and illegal edges', () => {
    expect(S.assertTransition('loan', 'requested', 'approved').ok).toBe(true);
    expect(S.assertTransition('loan', 'recover_at_exit', 'settled_at_exit').ok).toBe(true);
    expect(S.assertTransition('loan', 'requested', 'active').code).toBe('ILLEGAL_TRANSITION');
    expect(S.assertTransition('loan', 'completed', 'active').ok).toBe(false);
    expect(S.assertTransition('loan', 'recover_at_exit', 'written_off').ok).toBe(false);
    expect(S.assertTransition('instalment', 'posted', 'scheduled').ok).toBe(false);
    expect(S.assertTransition('instalment', 'scheduled', 'posted').ok).toBe(false);
    expect(S.assertTransition('instalment', 'provisional', 'posted').ok).toBe(true);
  });
  test('the CHECK constraints accept every state the engine knows', () => {
    const e = plant(db);
    for (const s of S.LOAN_STATES) {
      expect(() => db.prepare(`INSERT INTO loans (borrower_type, employee_code, company, loan_type, principal_amount, tenure_months, status, requested_by)
                               VALUES ('plant', ?, ?, 'Personal', 1, 1, ?, 'x')`).run(e.code, COMPANY, s)).not.toThrow();
    }
  });
});

describe('maker-checker matrix (§7)', () => {
  test.each([
    ['request', HR, true], ['request', FIN, true], ['request', ADMIN, true], ['request', VIEWER, false],
    ['approve', ADMIN, true], ['approve', HR, false], ['approve', FIN, false], ['approve', VIEWER, false],
    ['disburse', FIN, true], ['disburse', ADMIN, true], ['disburse', HR, false],
    ['receipt', FIN, true], ['receipt', ADMIN, true], ['receipt', HR, false], ['receipt', VIEWER, false],
    ['approve_change', ADMIN, true], ['approve_change', FIN, false],
    ['request', { username: 'e1', role: 'employee' }, false], ['request', { username: 's1', role: 'supervisor' }, false],
  ])('%s by %o → %s', (action, actor, ok) => {
    expect(S.checkActor(action, actor).ok).toBe(ok);
  });
  test('roles are trimmed / lower-cased; missing actor refused', () => {
    expect(S.checkActor('approve', { username: 'boss', role: ' Admin ' }).ok).toBe(true);
    expect(S.checkActor('approve', null).code).toBe('ACTOR_REQUIRED');
    expect(S.checkActor('approve', { username: '', role: 'admin' }).code).toBe('ACTOR_REQUIRED');
  });
  test('self-approval refused, case-insensitively', () => {
    expect(S.checkActor('approve', ADMIN, { requestedBy: 'BOSS ' }).code).toBe('SELF_APPROVAL');
    expect(S.checkActor('disburse', FIN, { requestedBy: 'fin1' }).code).toBe('SELF_DISBURSEMENT');
  });
});

describe('request → approve → disburse', () => {
  test('happy path writes events and audit rows', () => {
    const e = plant(db);
    const r = req(e);
    expect(r).toMatchObject({ ok: true, status: 'requested', emi: 3334 });
    expect(L.approveLoan(db, r.loanId, ADMIN, { asOf: ASOF })).toMatchObject({ ok: true, status: 'approved' });
    expect(instalments(db, r.loanId)).toHaveLength(0); // ruling 11: rows only at disbursement
    const d = disb(r.loanId);
    expect(d).toMatchObject({ ok: true, status: 'active', firstEmiMonth: { month: 11, year: 2026 } });
    const l = loan(db, r.loanId);
    expect(l).toMatchObject({ status: 'active', remaining_balance: 10000, disbursed_amount: 10000, emi_amount: 3334, interest_rate: 0, first_emi_month: 11, first_emi_year: 2026 });
    expect(instalments(db, r.loanId).map((i) => i.amount_due)).toEqual([3334, 3334, 3332]);
    expect(events(db, r.loanId).map((x) => x.event)).toEqual(['requested', 'approved', 'disbursed']);
    expect(db.prepare("SELECT COUNT(*) n FROM audit_log WHERE table_name = 'loans' AND record_id = ?").get(r.loanId).n).toBe(3);
    const audit = db.prepare("SELECT * FROM audit_log WHERE action_type = 'loan_approved'").get();
    expect(audit).toMatchObject({ changed_by: 'boss', old_value: 'requested', new_value: 'approved', employee_code: e.code, stage: 'loans' });
  });
  test('viewer cannot request; refusals carry every reason', () => {
    expect(req(plant(db), VIEWER).code).toBe('ROLE_NOT_ALLOWED');
    const r = req(plant(db, { employment_type: 'Contract' }), HR, { principal: 999999, tenure: 20 });
    expect(r.code).toBe('NOT_ELIGIBLE');
    expect(r.refusals.map((x) => x.code)).toEqual(expect.arrayContaining(['CONTRACT_NOT_ELIGIBLE', 'TENURE_OVER_LIMIT', 'AMOUNT_OVER_LIMIT']));
    expect(db.prepare('SELECT COUNT(*) n FROM loans').get().n).toBe(0);
  });
  test('reason required', () => {
    expect(req(plant(db), HR, { reason: '  ' }).code).toBe('REASON_REQUIRED');
  });
  test('HR and finance cannot approve or reject; admin cannot approve own request', () => {
    const r = req(plant(db), ADMIN);
    expect(L.approveLoan(db, r.loanId, HR).code).toBe('ROLE_NOT_ALLOWED');
    expect(L.approveLoan(db, r.loanId, FIN).code).toBe('ROLE_NOT_ALLOWED');
    expect(L.rejectLoan(db, r.loanId, FIN, { reason: 'no' }).code).toBe('ROLE_NOT_ALLOWED');
    expect(L.approveLoan(db, r.loanId, ADMIN).code).toBe('SELF_APPROVAL');
    expect(L.rejectLoan(db, r.loanId, ADMIN, { reason: 'no' }).code).toBe('SELF_APPROVAL');
    expect(L.approveLoan(db, r.loanId, ADMIN2, { asOf: ASOF }).ok).toBe(true); // another admin may
    expect(loan(db, r.loanId).status).toBe('approved');
  });
  test('reject needs a reason and is terminal', () => {
    const r = req(plant(db));
    expect(L.rejectLoan(db, r.loanId, ADMIN, {}).code).toBe('REASON_REQUIRED');
    expect(L.rejectLoan(db, r.loanId, ADMIN, { reason: 'too soon' })).toMatchObject({ ok: true, status: 'rejected' });
    expect(L.approveLoan(db, r.loanId, ADMIN).code).toBe('ILLEGAL_TRANSITION');
    expect(disb(r.loanId).code).toBe('ILLEGAL_TRANSITION');
  });
  test('approval re-checks eligibility', () => {
    const e = plant(db);
    const r = req(e);
    db.prepare("UPDATE employees SET gross_salary = 4000 WHERE code = ?").run(e.code);
    expect(L.approveLoan(db, r.loanId, ADMIN, { asOf: ASOF }).code).toBe('NOT_ELIGIBLE');
    expect(loan(db, r.loanId).status).toBe('requested');
  });
  test('double approve: second call is refused (state already moved)', () => {
    const r = req(plant(db));
    expect(L.approveLoan(db, r.loanId, ADMIN, { asOf: ASOF }).ok).toBe(true);
    expect(L.approveLoan(db, r.loanId, ADMIN2, { asOf: ASOF }).code).toBe('ILLEGAL_TRANSITION');
    expect(events(db, r.loanId).filter((x) => x.event === 'approved')).toHaveLength(1);
  });
  test('exit-flagged loan cannot be approved or disbursed (PR-1 ruling)', () => {
    const r1 = req(plant(db));
    expect(L.flagForExit(db, r1.loanId, HR, { exitDate: '2026-10-08' })).toMatchObject({ ok: true, status: 'requested' });
    expect(L.approveLoan(db, r1.loanId, ADMIN).code).toBe('LOAN_EXIT_FLAGGED');
    const r2 = req(plant(db));
    L.approveLoan(db, r2.loanId, ADMIN, { asOf: ASOF });
    L.flagForExit(db, r2.loanId, SYS, { exitDate: '2026-10-08' });
    expect(disb(r2.loanId).code).toBe('LOAN_EXIT_FLAGGED');
  });
  test('disbursement rules: agreement, requester, amount, date, mode, reference', () => {
    const r = req(plant(db), FIN);
    L.approveLoan(db, r.loanId, ADMIN, { asOf: ASOF });
    expect(disb(r.loanId, FIN).code).toBe('SELF_DISBURSEMENT');
    expect(disb(r.loanId, HR).code).toBe('ROLE_NOT_ALLOWED');
    expect(disb(r.loanId, FIN2, { agreementFilePath: '' }).code).toBe('AGREEMENT_REQUIRED');
    expect(disb(r.loanId, FIN2, { amount: 9999 }).code).toBe('DISBURSED_AMOUNT_MISMATCH');
    expect(disb(r.loanId, FIN2, { disbursedOn: '2026-10-10' }).code).toBe('DATE_IN_FUTURE');
    expect(disb(r.loanId, FIN2, { disbursedOn: '05-10-2026' }).code).toBe('DATE_INVALID');
    expect(disb(r.loanId, FIN2, { mode: '' }).code).toBe('MODE_REQUIRED');
    expect(disb(r.loanId, FIN2, { reference: '' }).code).toBe('REFERENCE_REQUIRED');
    expect(disb(r.loanId, FIN2, { firstEmiMonth: { month: 10, year: 2026 } }).code).toBe('FIRST_EMI_TOO_EARLY');
    expect(loan(db, r.loanId).status).toBe('approved');
    expect(instalments(db, r.loanId)).toHaveLength(0);
    expect(disb(r.loanId, FIN2, { amount: 10000, firstEmiMonth: { month: 1, year: 2027 } })).toMatchObject({ ok: true, firstEmiMonth: { month: 1, year: 2027 } });
  });
  test('agreement not required when policy says so', () => {
    F.setPolicy(db, 'loan_agreement_required', 'false');
    const r = req(plant(db));
    L.approveLoan(db, r.loanId, ADMIN, { asOf: ASOF });
    expect(disb(r.loanId, FIN, { agreementFilePath: '' }).ok).toBe(true);
  });
  test('first EMI month skips a month already closed', () => {
    db.prepare("INSERT INTO loan_closes (month, year, payroll, run_by) VALUES (11, 2026, 'plant', 'fin1')").run();
    db.prepare("INSERT INTO loan_closes (month, year, payroll, run_by) VALUES (12, 2026, 'sales', 'fin1')").run();
    const r = req(plant(db));
    L.approveLoan(db, r.loanId, ADMIN, { asOf: ASOF });
    expect(disb(r.loanId).firstEmiMonth).toEqual({ month: 12, year: 2026 }); // the sales close does not count
  });
  test('flagForExit: active → recover_at_exit, idempotent, HR/system only', () => {
    const { loanId } = activeLoan(db);
    expect(L.flagForExit(db, loanId, FIN).code).toBe('ROLE_NOT_ALLOWED');
    expect(L.flagForExit(db, loanId, SYS, { exitDate: '2026-11-30' })).toMatchObject({ ok: true, status: 'recover_at_exit' });
    expect(L.flagForExit(db, loanId, SYS)).toMatchObject({ ok: true, alreadyFlagged: true });
    expect(loan(db, loanId)).toMatchObject({ exit_flag: 1, exit_date: '2026-11-30', remaining_balance: 10000 });
  });
  test('loan_events stays append-only', () => {
    const { loanId } = activeLoan(db);
    expect(() => db.prepare('UPDATE loan_events SET amount = 0 WHERE loan_id = ?').run(loanId)).toThrow(/append-only/);
    expect(() => db.prepare('DELETE FROM loan_events WHERE loan_id = ?').run(loanId)).toThrow(/append-only/);
  });
  test('unknown loan', () => {
    expect(L.approveLoan(db, 999, ADMIN).code).toBe('LOAN_NOT_FOUND');
    expect(disb(999).code).toBe('LOAN_NOT_FOUND');
    expect(L.rejectLoan(db, 999, ADMIN, { reason: 'x' }).code).toBe('LOAN_NOT_FOUND');
  });
  test('HR2 raising and another HR is irrelevant; finance may raise', () => {
    expect(req(plant(db), HR2).ok).toBe(true);
    expect(req(plant(db), FIN).ok).toBe(true);
  });
});
