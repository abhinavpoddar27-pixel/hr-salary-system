/**
 * Loans PR-9 (ruling Q1) — a sales loan's statement buckets every dated
 * movement by the SALES CYCLE month (SPEC §5.3: day ≥ 26 → next month), the
 * month its recoveries already carry. Plant stays on the calendar month. The
 * closing balance never changes.
 */
const LF = require('./helpers/loanFixture');
const S = require('./helpers/salesLoanFixture');

const { F, L, COMPANY, FIN } = LF;

test('sales: disbursement on the 28th and a receipt on the 27th fall in the next cycle month', () => {
  const db = F.newDb();
  S.addRep(db, { code: 'S9001', company: COMPANY, gross: 30000 });
  const loanId = S.salesLoan(db, { code: 'S9001', principal: 9000, tenure: 3, disbursedOn: '2026-10-28', asOf: '2026-10-28' });
  const r = L.recordReceipt(db, loanId, FIN, { amount: 1000, mode: 'Cash', reference: 'R1', receiptDate: '2026-11-27' }, { asOf: '2026-11-30' });
  expect(r.ok).toBe(true);
  const st = L.loanStatement(db, loanId);
  expect(st.rows.map((x) => [x.month, x.disbursed, x.cash, x.closing])).toEqual([
    ['2026-11', 9000, 0, 9000],
    ['2026-12', 0, 1000, 8000],
  ]);
  expect(st.closing).toBe(L.reconcileLoan(db, loanId).expectedBalance);
});

test('plant: the 28th and the 27th stay in their calendar month', () => {
  const db = F.newDb();
  const { loanId } = LF.activeLoan(db, { principal: 9000, tenure: 3, disbursedOn: '2026-09-28' });
  const r = L.recordReceipt(db, loanId, FIN, { amount: 1000, mode: 'Cash', reference: 'R1', receiptDate: '2026-10-27' }, { asOf: '2026-10-30' });
  expect(r.ok).toBe(true);
  const st = L.loanStatement(db, loanId);
  expect(st.rows.map((x) => [x.month, x.disbursed, x.cash, x.closing])).toEqual([
    ['2026-09', 9000, 0, 9000],
    ['2026-10', 0, 1000, 8000],
  ]);
});
