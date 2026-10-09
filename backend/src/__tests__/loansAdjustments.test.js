/**
 * Loans PR-6 — opposite entries for a posted deduction (docs/loans/SPEC.md
 * §5.2 r7 and r12, K2, K22, K35; owner rulings Q1–Q3, 10 Oct 2026).
 *
 * Real schema (initSchema), real engine. ₹10,000 over 3 = ₹3,334 / ₹3,334 / ₹3,332,
 * first EMI Nov 2026.
 */
const LF = require('./helpers/loanFixture');
const { F, L, SYS, ADMIN, FIN, HR } = LF;

const posted = (db, loanId, n = 0, amount = null) => {
  const ins = LF.instalments(db, loanId)[n];
  const r = LF.deductAndPost(db, loanId, ins, amount === null ? ins.amount_due : amount);
  if (!r.ok) throw new Error(`post failed: ${r.code}`);
  return db.prepare("SELECT * FROM loan_deductions WHERE loan_id = ? AND instalment_id = ?").get(loanId, ins.id);
};

describe('loan_adjustments table', () => {
  test('exists after initSchema, is append-only, and a second initSchema is a no-op', () => {
    const db = F.newDb();
    const cols = db.prepare('PRAGMA table_info(loan_adjustments)').all().map((c) => c.name);
    expect(cols).toEqual(['id', 'loan_id', 'deduction_id', 'instalment_id', 'kind', 'amount', 'reason', 'actor', 'added_instalment_id', 'created_at']);
    const { loanId } = LF.activeLoan(db);
    const d = posted(db, loanId);
    const r = L.writeAdjustment(db, { deductionId: d.id, kind: 'reversal', amountPaise: 100000, reason: 'salary for this month was not paid' }, ADMIN);
    expect(r.ok).toBe(true);
    expect(() => db.prepare('UPDATE loan_adjustments SET amount = 1').run()).toThrow(/append-only/);
    expect(() => db.prepare('DELETE FROM loan_adjustments').run()).toThrow(/append-only/);
    F.silently(() => require('../database/schema').initSchema(db));
    expect(db.prepare('SELECT COUNT(*) AS n FROM loan_adjustments').get().n).toBe(1);
    expect(() => db.prepare("INSERT INTO loan_adjustments (loan_id, deduction_id, kind, amount, reason, actor) VALUES (?, ?, 'other', 1, 'x', 'a')").run(loanId, d.id)).toThrow(/CHECK/);
    db.close();
  });
});

describe('writeAdjustment', () => {
  test('reversal: balance back up, new last instalment (origin reversal), effective posted falls, reconciles', () => {
    const db = F.newDb();
    const { loanId } = LF.activeLoan(db);
    const d = posted(db, loanId);
    expect(LF.loan(db, loanId).remaining_balance).toBe(6666);
    const r = L.writeAdjustment(db, { deductionId: d.id, kind: 'reversal', amountPaise: 333400, reason: 'salary for this month was not paid' }, ADMIN);
    expect(r).toMatchObject({ ok: true, amount: 3334, effectivePosted: 0, alerts: [] });
    expect(r.added).toMatchObject({ origin: 'reversal', amount: 3334, month: 2, year: 2027 });
    expect(LF.loan(db, loanId).remaining_balance).toBe(10000);
    expect(L.effectivePostedPaise(db, db.prepare('SELECT * FROM loan_deductions WHERE id = ?').get(d.id))).toBe(0);
    expect(db.prepare('SELECT state, amount FROM loan_deductions WHERE id = ?').get(d.id)).toEqual({ state: 'posted', amount: 3334 }); // never edited
    const rec = L.reconcileLoan(db, loanId);
    expect(rec.problems).toEqual([]);
    expect(rec).toMatchObject({ posted: 3334, adjusted: 3334, expectedBalance: 10000 });
    expect(L.loanStatement(db, loanId).closing).toBe(10000);
    const ev = LF.events(db, loanId).find((e) => e.event === 'posted_reversed');
    expect(ev).toMatchObject({ actor: 'boss', amount: 3334 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action_type = 'loan_posted_reversed'").get().n).toBe(1);
    db.close();
  });

  test('reversal is admin only; amount cannot exceed what still stands; posted rows only; live loans only', () => {
    const db = F.newDb();
    const { loanId } = LF.activeLoan(db);
    const d = posted(db, loanId);
    const args = { deductionId: d.id, kind: 'reversal', amountPaise: 100, reason: 'test reason here' };
    expect(L.writeAdjustment(db, args, FIN).code).toBe('ROLE_NOT_ALLOWED');
    expect(L.writeAdjustment(db, args, HR).code).toBe('ROLE_NOT_ALLOWED');
    expect(L.writeAdjustment(db, args, SYS).code).toBe('ROLE_NOT_ALLOWED');
    expect(L.writeAdjustment(db, { ...args, amountPaise: 333401 }, ADMIN).code).toBe('ADJUSTMENT_ABOVE_POSTED');
    expect(L.writeAdjustment(db, { ...args, kind: 'other' }, ADMIN).code).toBe('KIND_INVALID');
    expect(L.writeAdjustment(db, { ...args, reason: ' ' }, ADMIN).code).toBe('REASON_REQUIRED');
    expect(L.writeAdjustment(db, { ...args, amountPaise: 0 }, ADMIN).code).toBe('AMOUNT_INVALID');
    expect(L.writeAdjustment(db, { ...args, amountPaise: 300000 }, ADMIN).ok).toBe(true);
    expect(L.writeAdjustment(db, { ...args, amountPaise: 33401 }, ADMIN).code).toBe('ADJUSTMENT_ABOVE_POSTED');
    // a provisional row takes no opposite entry
    const ins2 = LF.instalments(db, loanId)[1];
    const p = L.recordProvisional(db, { loanId, instalmentId: ins2.id, payroll: 'plant', month: 12, year: 2026, company: LF.COMPANY, amount: 3334 }, SYS);
    expect(L.writeAdjustment(db, { ...args, deductionId: p.deductionId }, ADMIN).code).toBe('DEDUCTION_NOT_POSTED');
    expect(L.reconcileLoan(db, loanId).problems).toEqual([]);
    db.close();
  });

  test('a completed loan takes no opposite entry (live loans only, ruling Q2)', () => {
    const db = F.newDb();
    const { loanId } = LF.activeLoan(db, { principal: 3000, tenure: 1 });
    const d = posted(db, loanId);
    expect(LF.loan(db, loanId).status).toBe('completed');
    const r = L.writeAdjustment(db, { deductionId: d.id, kind: 'reversal', amountPaise: 100, reason: 'test reason here' }, ADMIN);
    expect(r.code).toBe('LOAN_NOT_LIVE');
    expect(db.prepare('SELECT COUNT(*) AS n FROM loan_adjustments').get().n).toBe(0);
    db.close();
  });

  test('unborne counts toward the 3-month extension limit; at the limit the amount stays uncovered and finance is alerted', () => {
    const db = F.newDb();
    const { loanId } = LF.activeLoan(db, { principal: 12000, tenure: 6 });
    // three shortfalls use the three extension months
    for (let n = 0; n < 3; n++) posted(db, loanId, n, 1000);
    expect(LF.instalments(db, loanId).filter((i) => i.origin === 'shortfall')).toHaveLength(3);
    const d = db.prepare('SELECT * FROM loan_deductions WHERE loan_id = ? ORDER BY id').all(loanId)[0];
    const r = L.writeAdjustment(db, { deductionId: d.id, kind: 'unborne', amountPaise: 50000, reason: 'Stage 7 re-run: pay no longer bears it' }, SYS);
    expect(r.ok).toBe(true);
    expect(r.added).toBeNull();
    expect(r.alerts).toEqual([expect.objectContaining({ type: 'loan_extension_limit_reached', audience: 'finance', uncoveredAmount: 500 })]);
    const rec = L.reconcileLoan(db, loanId);
    expect(rec.problems).toEqual([]);
    expect(rec.uncovered).toBe(500);
    // a reversal is an admin decision: it is still placed (does not count toward the limit)
    const rv = L.writeAdjustment(db, { deductionId: d.id, kind: 'reversal', amountPaise: 50000, reason: 'admin reversal of the rest' }, ADMIN);
    expect(rv.added).toMatchObject({ origin: 'reversal', amount: 500 });
    expect(L.reconcileLoan(db, loanId).problems).toEqual([]);
    db.close();
  });
});
