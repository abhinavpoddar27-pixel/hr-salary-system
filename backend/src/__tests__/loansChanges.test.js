/**
 * Loans PR-2 — receipts, defer, restructure, write-off (docs/loans/SPEC.md
 * §5.2 r9–r11, D-7, D-15, K35; coordinator rulings 6, 7, 8, 10).
 */
const { L, F, COMPANY, ASOF, HR, FIN, FIN2, ADMIN, ADMIN2, VIEWER, SYS, activeLoan, instalments, loan, events, deductAndPost } = require('./helpers/loanFixture');

let db;
beforeEach(() => { db = F.newDb(); });

const receipt = (loanId, amount, over = {}, actor = FIN2) => L.recordReceipt(db, loanId, actor, { amount, mode: 'cash', receiptDate: '2026-10-08', ...over }, { asOf: ASOF });
const shape = (loanId) => instalments(db, loanId).map((i) => [i.status, i.amount_due, i.origin]);
const reconciles = (loanId) => expect(L.reconcileLoan(db, loanId).problems).toEqual([]);

describe('cash receipts', () => {
  test('SPEC: ₹5,000 on 3,334 / 3,334 / 3,332 removes instalments from the end', () => {
    const { loanId } = activeLoan(db);
    const r = receipt(loanId, 5000);
    expect(r).toMatchObject({ ok: true, receiptNo: 'LR/2026-27/00001', balance: 5000, loanStatus: 'active' });
    expect(shape(loanId)).toEqual([['scheduled', 3334, 'schedule'], ['scheduled', 1666, 'schedule'], ['paid_in_cash', 3332, 'schedule']]);
    expect(JSON.parse(db.prepare('SELECT instalments_cleared FROM loan_receipts').get().instalments_cleared)).toHaveLength(2);
    reconciles(loanId);
  });
  test('full balance completes the loan; serials increase; FY boundary', () => {
    const { loanId } = activeLoan(db);
    expect(receipt(loanId, 1000).receiptNo).toBe('LR/2026-27/00001');
    expect(receipt(loanId, 1000).receiptNo).toBe('LR/2026-27/00002');
    const last = receipt(loanId, 8000);
    expect(last).toMatchObject({ receiptNo: 'LR/2026-27/00003', balance: 0, loanStatus: 'completed' });
    reconciles(loanId);
    expect(L.financialYear('2027-03-31')).toBe('2026-27');
    expect(L.financialYear('2027-04-01')).toBe('2027-28');
    expect(L.financialYear('2099-06-01')).toBe('2099-00');
  });
  test('receipt on a recover-at-exit loan settles it at exit', () => {
    const { loanId } = activeLoan(db);
    L.flagForExit(db, loanId, SYS, { exitDate: '2026-10-07' });
    expect(receipt(loanId, 10000).loanStatus).toBe('settled_at_exit');
  });
  test('guards: role, amount, balance, date, mode, state', () => {
    const { loanId } = activeLoan(db);
    expect(receipt(loanId, 100, {}, HR).code).toBe('ROLE_NOT_ALLOWED');
    expect(receipt(loanId, 100, {}, VIEWER).code).toBe('ROLE_NOT_ALLOWED');
    expect(receipt(loanId, 10000.01).code).toBe('RECEIPT_ABOVE_BALANCE');
    expect(receipt(loanId, 0).code).toBe('AMOUNT_INVALID');
    expect(receipt(loanId, 10, { receiptDate: '2026-10-10' }).code).toBe('DATE_IN_FUTURE');
    expect(receipt(loanId, 10, { mode: '' }).code).toBe('MODE_REQUIRED');
    expect(db.prepare('SELECT COUNT(*) n FROM loan_receipts').get().n).toBe(0);
    L.writeOffLoan(db, { loanId, reason: 'x', requestedBy: HR }, ADMIN);
    expect(receipt(loanId, 10).code).toBe('LOAN_NOT_LIVE');
  });
  test('receipt overlapping a provisional instalment is refused, then allowed with allowProvisional (stale reported)', () => {
    const { loanId } = activeLoan(db, { principal: 6000, tenure: 2 });
    const [i1] = instalments(db, loanId);
    const p = L.recordProvisional(db, { loanId, instalmentId: i1.id, payroll: 'plant', month: 11, year: 2026, company: COMPANY, amount: 3000 }, SYS);
    const refused = receipt(loanId, 4000);
    expect(refused.code).toBe('RECEIPT_OVERLAPS_PROVISIONAL');
    expect(db.prepare('SELECT COUNT(*) n FROM loan_receipts').get().n).toBe(0); // rolled back entirely
    expect(loan(db, loanId).remaining_balance).toBe(6000);
    const ok = receipt(loanId, 4000, { allowProvisional: true });
    expect(ok.staleDeductions).toEqual([expect.objectContaining({ deductionId: p.deductionId })]);
    expect(shape(loanId)).toEqual([['scheduled', 2000, 'schedule'], ['paid_in_cash', 3000, 'schedule']]);
    expect(db.prepare('SELECT state FROM loan_deductions').get().state).toBe('reversed');
    reconciles(loanId);
  });
  test('receipt by the requester is allowed with a warning (ruling 8)', () => {
    const { loanId } = activeLoan(db, { requester: FIN2 });
    const r = receipt(loanId, 100, {}, FIN2);
    expect(r.ok).toBe(true);
    expect(r.warnings.map((w) => w.code)).toEqual(['RECEIPT_BY_REQUESTER']);
  });
  test('receipt clears an uncovered amount first', () => {
    const { loanId } = activeLoan(db, { principal: 12000, tenure: 12 });
    const ins = instalments(db, loanId);
    for (let k = 0; k < 4; k++) deductAndPost(db, loanId, ins[k], 0); // 4th leaves ₹1,000 uncovered
    expect(L.reconcileLoan(db, loanId).uncovered).toBe(1000);
    const r = receipt(loanId, 1500);
    expect(r.cleared[0]).toEqual({ uncovered: true, amount: 1000 });
    expect(L.reconcileLoan(db, loanId)).toMatchObject({ ok: true, uncovered: 0 });
  });
});

describe('defer (replaces Skip, D8)', () => {
  test('one scheduled instalment moves to the end; the loan still completes at ₹0', () => {
    const { loanId } = activeLoan(db);
    const [i1] = instalments(db, loanId);
    const r = L.deferInstalment(db, { instalmentId: i1.id, reason: 'medical leave', requestedBy: HR }, ADMIN);
    expect(r).toMatchObject({ ok: true, added: { origin: 'deferred', amount: 3334, month: 2, year: 2027 } });
    expect(shape(loanId)[0]).toEqual(['deferred', 3334, 'schedule']);
    for (const i of instalments(db, loanId).filter((x) => x.status === 'scheduled')) deductAndPost(db, loanId, i, i.amount_due);
    expect(loan(db, loanId)).toMatchObject({ status: 'completed', remaining_balance: 0 });
    reconciles(loanId);
  });
  test('maker-checker: admin only, never own request; requester must be a requesting role', () => {
    const { loanId } = activeLoan(db);
    const [i1] = instalments(db, loanId);
    expect(L.deferInstalment(db, { instalmentId: i1.id, reason: 'x', requestedBy: HR }, FIN).code).toBe('ROLE_NOT_ALLOWED');
    expect(L.deferInstalment(db, { instalmentId: i1.id, reason: 'x', requestedBy: ADMIN }, ADMIN).code).toBe('SELF_APPROVAL');
    expect(L.deferInstalment(db, { instalmentId: i1.id, reason: 'x', requestedBy: VIEWER }, ADMIN).code).toBe('ROLE_NOT_ALLOWED');
    expect(L.deferInstalment(db, { instalmentId: i1.id, reason: '', requestedBy: HR }, ADMIN).code).toBe('REASON_REQUIRED');
    expect(L.deferInstalment(db, { instalmentId: i1.id, reason: 'x', requestedBy: ADMIN }, ADMIN2).ok).toBe(true);
  });
  test('only a scheduled instalment of an active loan', () => {
    const { loanId } = activeLoan(db);
    const [i1, i2] = instalments(db, loanId);
    deductAndPost(db, loanId, i1, 3334);
    expect(L.deferInstalment(db, { instalmentId: i1.id, reason: 'x', requestedBy: HR }, ADMIN).code).toBe('INSTALMENT_NOT_SCHEDULED');
    L.recordProvisional(db, { loanId, instalmentId: i2.id, payroll: 'plant', month: 12, year: 2026, amount: 1 }, SYS);
    expect(L.deferInstalment(db, { instalmentId: i2.id, reason: 'x', requestedBy: HR }, ADMIN).code).toBe('INSTALMENT_NOT_SCHEDULED');
  });
});

describe('restructure', () => {
  test('new tenure changes only unposted instalments', () => {
    const { loanId } = activeLoan(db, { principal: 12000, tenure: 6 });
    const ins = instalments(db, loanId);
    deductAndPost(db, loanId, ins[0], 2000);
    L.recordProvisional(db, { loanId, instalmentId: ins[1].id, payroll: 'plant', month: 12, year: 2026, company: COMPANY, amount: 2000 }, SYS);
    const r = L.restructureLoan(db, { loanId, newTenure: 4, reason: 'lower EMI', requestedBy: HR }, ADMIN, { asOf: ASOF });
    expect(r).toMatchObject({ ok: true, emi: 2000, tenure: 4, start: { month: 1, year: 2027 } });
    const after = instalments(db, loanId);
    expect(after[0]).toMatchObject({ status: 'posted', posted_amount: 2000 });
    expect(after[1]).toMatchObject({ status: 'provisional', amount_due: 2000 });
    expect(after.slice(2, 6).every((i) => i.status === 'cancelled')).toBe(true);
    expect(after.slice(6).map((i) => [i.amount_due, i.origin, i.due_month])).toEqual([[2000, 'restructure', 1], [2000, 'restructure', 2], [2000, 'restructure', 3], [2000, 'restructure', 4]]);
    expect(loan(db, loanId).emi_amount).toBe(2000);
    reconciles(loanId);
  });
  test('new EMI; uncovered amount folded in', () => {
    const { loanId } = activeLoan(db, { principal: 12000, tenure: 12 });
    const ins = instalments(db, loanId);
    for (let k = 0; k < 4; k++) deductAndPost(db, loanId, ins[k], 0);
    const r = L.restructureLoan(db, { loanId, newEmi: 5000, reason: 'catch up', requestedBy: FIN }, ADMIN, { asOf: ASOF });
    expect(r).toMatchObject({ ok: true, emi: 5000, tenure: 3 });
    expect(L.reconcileLoan(db, loanId)).toMatchObject({ ok: true, uncovered: 0 });
  });
  test('top-up raises disbursed and balance, keeps principal (ruling 6)', () => {
    const { loanId } = activeLoan(db, { principal: 10000, tenure: 3 });
    const r = L.restructureLoan(db, {
      loanId, newTenure: 6, reason: 'top-up', requestedBy: HR,
      topup: { amount: 5000, mode: 'NEFT', reference: 'UTR-T', disbursedOn: '2026-10-08', agreementFilePath: 'b.pdf' },
    }, ADMIN, { asOf: ASOF });
    expect(r.ok).toBe(true);
    expect(loan(db, loanId)).toMatchObject({ principal_amount: 10000, disbursed_amount: 15000, remaining_balance: 15000, agreement_file_path: 'b.pdf' });
    expect(events(db, loanId).map((e) => e.event)).toContain('topup_disbursed');
    reconciles(loanId);
  });
  test('refusals: terms, eligibility on new terms, exit, agreement, maker-checker', () => {
    const { loanId } = activeLoan(db);
    const base = { loanId, reason: 'x', requestedBy: HR };
    expect(L.restructureLoan(db, { ...base, newTenure: 4, newEmi: 1000 }, ADMIN).code).toBe('RESTRUCTURE_TERMS_INVALID');
    expect(L.restructureLoan(db, { ...base }, ADMIN).code).toBe('RESTRUCTURE_TERMS_INVALID');
    expect(L.restructureLoan(db, { ...base, newTenure: 13 }, ADMIN, { asOf: ASOF }).refusals.map((x) => x.code)).toContain('TENURE_OVER_LIMIT');
    expect(L.restructureLoan(db, { ...base, newEmi: 7000 }, ADMIN, { asOf: ASOF }).refusals.map((x) => x.code)).toContain('EMI_OVER_CEILING');
    expect(L.restructureLoan(db, { ...base, newTenure: 6, topup: { amount: 40000, mode: 'NEFT', reference: 'r', disbursedOn: '2026-10-08', agreementFilePath: 'c.pdf' } }, ADMIN, { asOf: ASOF }).refusals.map((x) => x.code)).toContain('AMOUNT_OVER_LIMIT');
    expect(L.restructureLoan(db, { ...base, newTenure: 6, topup: { amount: 100, mode: 'NEFT', reference: 'r', disbursedOn: '2026-10-08' } }, ADMIN, { asOf: ASOF }).code).toBe('AGREEMENT_REQUIRED');
    expect(L.restructureLoan(db, { ...base, newTenure: 6 }, FIN).code).toBe('ROLE_NOT_ALLOWED');
    expect(L.restructureLoan(db, { ...base, requestedBy: ADMIN, newTenure: 6 }, ADMIN).code).toBe('SELF_APPROVAL');
    L.flagForExit(db, loanId, SYS);
    // Loans PR-7: the flag itself collapses the schedule into the final month; the refused restructure changes nothing more.
    const atExit = shape(loanId);
    expect(L.restructureLoan(db, { ...base, newTenure: 6 }, ADMIN, { asOf: ASOF }).code).toBe('RESTRUCTURE_AT_EXIT_NOT_ALLOWED');
    expect(shape(loanId)).toEqual(atExit);
  });
});

describe('write-off', () => {
  test('active loan → written_off; listed for TDS', () => {
    const { loanId, emp } = activeLoan(db);
    deductAndPost(db, loanId, instalments(db, loanId)[0], 3334);
    const r = L.writeOffLoan(db, { loanId, reason: 'hardship', requestedBy: FIN }, ADMIN);
    expect(r).toMatchObject({ ok: true, status: 'written_off', writtenOff: 6666 });
    expect(loan(db, loanId)).toMatchObject({ remaining_balance: 0, written_off_amount: 6666, written_off_by: 'boss' });
    expect(shape(loanId).slice(1).every(([s]) => s === 'cancelled')).toBe(true);
    const now = new Date(Date.now() + 330 * 60000);
    const tds = L.writeOffsForTds(db, { month: now.getUTCMonth() + 1, year: now.getUTCFullYear() });
    expect(tds).toEqual([expect.objectContaining({ loanId, employeeCode: emp.code, amount: 6666, status: 'written_off' })]);
    reconciles(loanId);
  });
  test('recover_at_exit → settled_at_exit (coordinator ruling)', () => {
    const { loanId } = activeLoan(db);
    L.flagForExit(db, loanId, SYS);
    expect(L.writeOffLoan(db, { loanId, reason: 'left, residual', requestedBy: HR }, ADMIN).status).toBe('settled_at_exit');
    reconciles(loanId);
  });
  test('refused while provisional; maker-checker; reason; terminal', () => {
    const { loanId } = activeLoan(db);
    L.recordProvisional(db, { loanId, instalmentId: instalments(db, loanId)[0].id, payroll: 'plant', month: 11, year: 2026, amount: 3334 }, SYS);
    expect(L.writeOffLoan(db, { loanId, reason: 'x', requestedBy: HR }, ADMIN).code).toBe('WRITE_OFF_PROVISIONAL_PENDING');
    L.clearProvisional(db, { loanId, month: 11, year: 2026, payroll: 'plant' }, SYS);
    expect(L.writeOffLoan(db, { loanId, reason: 'x', requestedBy: HR }, FIN).code).toBe('ROLE_NOT_ALLOWED');
    expect(L.writeOffLoan(db, { loanId, reason: 'x', requestedBy: ADMIN }, ADMIN).code).toBe('SELF_APPROVAL');
    expect(L.writeOffLoan(db, { loanId, reason: ' ', requestedBy: HR }, ADMIN).code).toBe('REASON_REQUIRED');
    expect(L.writeOffLoan(db, { loanId, reason: 'x', requestedBy: HR }, ADMIN).ok).toBe(true);
    expect(L.writeOffLoan(db, { loanId, reason: 'x', requestedBy: HR }, ADMIN).code).toBe('ILLEGAL_TRANSITION');
  });
});
