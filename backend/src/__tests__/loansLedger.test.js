/**
 * Loans PR-2 — ledger building blocks (docs/loans/SPEC.md §5.1, §5.2 r4–r8,
 * D-5, D-19; coordinator rulings 1 and 3). PR-5 / PR-6 call these.
 */
const { L, F, COMPANY, ASOF, FIN, ADMIN, HR, VIEWER, SYS, activeLoan, instalments, loan, events, deductAndPost } = require('./helpers/loanFixture');

let db;
beforeEach(() => { db = F.newDb(); });

const prov = (loanId, ins, amount, over = {}) => L.recordProvisional(db, {
  loanId, instalmentId: ins.id, payroll: 'plant', month: ins.due_month, year: ins.due_year, company: COMPANY, amount, ...over,
}, SYS);
const deductions = (loanId) => db.prepare('SELECT * FROM loan_deductions WHERE loan_id = ? ORDER BY id').all(loanId);
const reconciles = (loanId) => expect(L.reconcileLoan(db, loanId).problems).toEqual([]);

describe('recordProvisional (Stage 7 building block)', () => {
  test('a re-run gives identical rows and writes no extra event (D1)', () => {
    const { loanId } = activeLoan(db);
    const [i1] = instalments(db, loanId);
    const a = prov(loanId, i1, 3334, { runId: 'run-1' });
    const before = JSON.stringify(deductions(loanId).map(({ updated_at, run_id, ...r }) => r));
    const nEvents = events(db, loanId).length;
    const b = prov(loanId, i1, 3334, { runId: 'run-2' });
    expect(a.deductionId).toBe(b.deductionId);
    expect(b.changed).toBe(false);
    expect(JSON.stringify(deductions(loanId).map(({ updated_at, run_id, ...r }) => r))).toBe(before);
    expect(deductions(loanId)[0].run_id).toBe('run-2');
    expect(events(db, loanId)).toHaveLength(nEvents);
    expect(instalments(db, loanId)[0].status).toBe('provisional');
    expect(loan(db, loanId).remaining_balance).toBe(10000); // Stage 7 never moves the balance
  });
  test('a re-run with a different amount updates the same row', () => {
    const { loanId } = activeLoan(db);
    const [i1] = instalments(db, loanId);
    prov(loanId, i1, 3334);
    const r = prov(loanId, i1, 2000);
    expect(r).toMatchObject({ ok: true, changed: true, amount: 2000 });
    expect(deductions(loanId)).toHaveLength(1);
    expect(deductions(loanId)[0].amount).toBe(2000);
  });
  test('guards: payroll, live loan, amount above due, wrong instalment, role', () => {
    const { loanId } = activeLoan(db);
    const [i1, i2] = instalments(db, loanId);
    expect(prov(loanId, i1, 100, { payroll: 'sales' }).code).toBe('PAYROLL_MISMATCH');
    expect(prov(loanId, i1, 3335).code).toBe('DEDUCTION_ABOVE_DUE');
    expect(prov(loanId, { id: 9999, due_month: 11, due_year: 2026 }, 1).code).toBe('INSTALMENT_NOT_FOUND');
    expect(L.recordProvisional(db, { loanId, instalmentId: i1.id, payroll: 'plant', month: 11, year: 2026, amount: 1 }, VIEWER).code).toBe('ROLE_NOT_ALLOWED');
    expect(L.recordProvisional(db, { loanId, instalmentId: i1.id, payroll: 'plant', month: 11, year: 2026, amount: 1 }, HR).code).toBe('ROLE_NOT_ALLOWED');
    prov(loanId, i1, 3334);
    // a second month cannot claim an instalment that is provisional for another month
    expect(L.recordProvisional(db, { loanId, instalmentId: i1.id, payroll: 'plant', month: 12, year: 2026, amount: 1 }, SYS).code).toBe('INSTALMENT_NOT_OPEN');
    expect(prov(loanId, i2, 3334).ok).toBe(true);
  });
  test('posted month is frozen', () => {
    const { loanId } = activeLoan(db);
    const [i1] = instalments(db, loanId);
    deductAndPost(db, loanId, i1, 3334);
    const r = prov(loanId, i1, 3000);
    expect(r).toMatchObject({ ok: false, code: 'POSTED_FROZEN', postedAmount: 3334 });
  });
  test('clearProvisional: skipped employee on a re-run (K29)', () => {
    const { loanId } = activeLoan(db);
    const [i1] = instalments(db, loanId);
    prov(loanId, i1, 3334);
    expect(L.clearProvisional(db, { loanId, month: 11, year: 2026, payroll: 'plant' }, SYS)).toMatchObject({ ok: true, changed: true });
    expect(deductions(loanId)[0].state).toBe('reversed');
    expect(instalments(db, loanId)[0].status).toBe('scheduled');
    expect(L.clearProvisional(db, { loanId, month: 11, year: 2026, payroll: 'plant' }, SYS).changed).toBe(false);
    // the next run brings the same row back
    expect(prov(loanId, i1, 3334).ok).toBe(true);
    expect(deductions(loanId)).toHaveLength(1);
    expect(deductions(loanId)[0].state).toBe('provisional');
  });
});

describe('postDeduction (loan close building block)', () => {
  test('full post: frozen amount, balance falls, posted state', () => {
    const { loanId } = activeLoan(db);
    const [i1] = instalments(db, loanId);
    const r = deductAndPost(db, loanId, i1, 3334);
    expect(r).toMatchObject({ ok: true, posted: 3334, shortfall: 0, added: null, alerts: [] });
    expect(loan(db, loanId).remaining_balance).toBe(6666);
    expect(instalments(db, loanId)[0]).toMatchObject({ status: 'posted', posted_amount: 3334 });
    expect(deductions(loanId)[0].state).toBe('posted');
    reconciles(loanId);
  });
  test('SPEC: EMI ₹5,000, room ₹3,000 → posts ₹3,000, adds ₹2,000 as a new last instalment', () => {
    const { loanId } = activeLoan(db, { principal: 15000, tenure: 3 });
    const [i1] = instalments(db, loanId);
    const r = deductAndPost(db, loanId, i1, 3000);
    expect(r).toMatchObject({ ok: true, posted: 3000, shortfall: 2000, added: { amount: 2000, origin: 'shortfall', month: 2, year: 2027, sequence: 4 } });
    expect(instalments(db, loanId).map((i) => [i.status, i.amount_due, i.origin])).toEqual([
      ['posted', 5000, 'schedule'], ['scheduled', 5000, 'schedule'], ['scheduled', 5000, 'schedule'], ['scheduled', 2000, 'shortfall'],
    ]);
    expect(instalments(db, loanId)[3].source_instalment_id).toBe(i1.id);
    reconciles(loanId);
  });
  test('zero deduction: instalment deferred, whole amount moved to the end', () => {
    const { loanId } = activeLoan(db);
    const [i1] = instalments(db, loanId);
    const r = deductAndPost(db, loanId, i1, 0);
    expect(r).toMatchObject({ posted: 0, shortfall: 3334, added: { amount: 3334, origin: 'shortfall' } });
    expect(instalments(db, loanId)[0].status).toBe('deferred');
    expect(loan(db, loanId).remaining_balance).toBe(10000);
    reconciles(loanId);
  });
  test('paying every instalment completes the loan', () => {
    const { loanId } = activeLoan(db);
    for (const i of instalments(db, loanId)) deductAndPost(db, loanId, i, i.amount_due);
    expect(loan(db, loanId)).toMatchObject({ status: 'completed', remaining_balance: 0 });
    expect(events(db, loanId).map((e) => e.event).slice(-1)).toEqual(['completed']);
    reconciles(loanId);
  });
  test('recover_at_exit loan reaching ₹0 is settled_at_exit automatically', () => {
    const { loanId } = activeLoan(db, { principal: 3000, tenure: 1 });
    L.flagForExit(db, loanId, SYS, { exitDate: '2026-11-15' });
    deductAndPost(db, loanId, instalments(db, loanId)[0], 3000);
    expect(loan(db, loanId).status).toBe('settled_at_exit');
    reconciles(loanId);
  });
  test('only provisional rows post; a posted row cannot post twice', () => {
    const { loanId } = activeLoan(db);
    const [i1] = instalments(db, loanId);
    const p = prov(loanId, i1, 3334);
    expect(L.postDeduction(db, { deductionId: p.deductionId }, SYS).ok).toBe(true);
    expect(L.postDeduction(db, { deductionId: p.deductionId }, SYS).code).toBe('DEDUCTION_NOT_PROVISIONAL');
    expect(L.postDeduction(db, { deductionId: 999 }, SYS).code).toBe('DEDUCTION_NOT_FOUND');
    expect(loan(db, loanId).remaining_balance).toBe(6666);
  });
  test('close id is recorded on deduction and instalment', () => {
    const { loanId } = activeLoan(db);
    const closeId = db.prepare("INSERT INTO loan_closes (month, year, payroll, run_by) VALUES (11, 2026, 'plant', 'fin1')").run().lastInsertRowid;
    const [i1] = instalments(db, loanId);
    const p = prov(loanId, i1, 3334);
    L.postDeduction(db, { deductionId: p.deductionId, closeId }, FIN);
    expect(deductions(loanId)[0].posted_close_id).toBe(closeId);
    expect(instalments(db, loanId)[0].posted_close_id).toBe(closeId);
  });
});

describe('extension limit (D-19, ruling 3)', () => {
  test('three automatic moves allowed; the fourth adds nothing, alerts finance, keeps reconciliation', () => {
    const { loanId, emp } = activeLoan(db, { principal: 12000, tenure: 12 });
    const ins = instalments(db, loanId);
    for (let k = 0; k < 3; k++) {
      const r = deductAndPost(db, loanId, ins[k], 0);
      expect(r.alerts).toEqual([]);
      expect(r.added.origin).toBe('shortfall');
    }
    expect(instalments(db, loanId)).toHaveLength(15);
    const fourth = deductAndPost(db, loanId, ins[3], 400);
    expect(fourth.added).toBeNull();
    expect(fourth.alerts).toHaveLength(1);
    expect(fourth.alerts[0]).toMatchObject({
      type: 'loan_extension_limit_reached', audience: 'finance', loanId, employeeCode: emp.code, company: COMPANY,
      borrowerType: 'plant', origin: 'shortfall', uncoveredAmount: 600, extensionMonthsUsed: 3, extensionLimit: 3,
    });
    expect(instalments(db, loanId)).toHaveLength(15);
    expect(events(db, loanId).some((e) => e.event === 'extension_limit_reached' && e.amount === 600)).toBe(true);
    const rec = L.reconcileLoan(db, loanId);
    expect(rec).toMatchObject({ ok: true, uncovered: 600 });
  });
  test('approved defers do not count toward the limit', () => {
    const { loanId } = activeLoan(db, { principal: 12000, tenure: 12 });
    const ins = instalments(db, loanId);
    for (let k = 4; k < 8; k++) expect(L.deferInstalment(db, { instalmentId: ins[k].id, reason: 'festival', requestedBy: HR }, ADMIN).ok).toBe(true);
    for (let k = 0; k < 3; k++) expect(deductAndPost(db, loanId, ins[k], 0).alerts).toEqual([]);
  });
  test('a restructure resets the counter', () => {
    const { loanId } = activeLoan(db, { principal: 12000, tenure: 12 });
    const ins = instalments(db, loanId);
    for (let k = 0; k < 3; k++) deductAndPost(db, loanId, ins[k], 0);
    expect(L.restructureLoan(db, { loanId, newTenure: 10, reason: 'reset', requestedBy: FIN }, ADMIN, { asOf: ASOF }).ok).toBe(true);
    const next = instalments(db, loanId).find((i) => i.status === 'scheduled');
    expect(deductAndPost(db, loanId, next, 0).alerts).toEqual([]);
    expect(L.reconcileLoan(db, loanId).ok).toBe(true);
  });
});

describe('moveInstalmentToEnd (no salary / held)', () => {
  test('no salary: scheduled instalment moves to the end', () => {
    const { loanId } = activeLoan(db);
    const [i1] = instalments(db, loanId);
    const r = L.moveInstalmentToEnd(db, { instalmentId: i1.id, reason: 'no_salary' }, SYS);
    expect(r).toMatchObject({ ok: true, added: { origin: 'no_salary', amount: 3334, month: 2, year: 2027 }, staleDeductions: [] });
    expect(instalments(db, loanId)[0].status).toBe('deferred');
    reconciles(loanId);
  });
  test('held past the wait: provisional deduction reversed and reported stale (K28)', () => {
    const { loanId } = activeLoan(db);
    const [i1] = instalments(db, loanId);
    const p = prov(loanId, i1, 3334);
    const r = L.moveInstalmentToEnd(db, { instalmentId: i1.id, reason: 'held' }, SYS);
    expect(r.staleDeductions).toEqual([expect.objectContaining({ deductionId: p.deductionId, month: 11, year: 2026, payroll: 'plant' })]);
    expect(deductions(loanId)[0].state).toBe('reversed');
    expect(r.added.origin).toBe('held');
    reconciles(loanId);
  });
  test('a moved instalment never lands in a month already closed', () => {
    const { loanId } = activeLoan(db, { principal: 3000, tenure: 1 }); // single instalment, Nov 2026
    for (const [m, y] of [[11, 2026], [12, 2026], [1, 2027], [2, 2027]]) {
      db.prepare("INSERT INTO loan_closes (month, year, payroll, run_by) VALUES (?, ?, 'plant', 'fin1')").run(m, y);
    }
    const [i1] = instalments(db, loanId);
    const r = L.moveInstalmentToEnd(db, { instalmentId: i1.id, reason: 'held' }, SYS);
    expect(r.added).toMatchObject({ month: 3, year: 2027 }); // not Dec 2026
  });
  test('guards', () => {
    const { loanId } = activeLoan(db);
    const [i1] = instalments(db, loanId);
    expect(L.moveInstalmentToEnd(db, { instalmentId: i1.id, reason: 'whim' }, SYS).code).toBe('REASON_INVALID');
    deductAndPost(db, loanId, i1, 3334);
    expect(L.moveInstalmentToEnd(db, { instalmentId: i1.id, reason: 'no_salary' }, SYS).code).toBe('INSTALMENT_NOT_OPEN');
  });
});
