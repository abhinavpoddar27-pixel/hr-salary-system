/**
 * Loans PR-10 — import engine (services/loans/importer.js; SPEC D-9, K36, K37;
 * coordinator rulings 10 Oct 2026). Maker-checker, opening-balance loans that
 * reconcile exactly, first EMI = the cutover month, idempotency, gate interplay,
 * the Left section, finance corrections, the cutover check.
 */
const XLSX = require('xlsx');
const { F, L, ADMIN, VIEWER, SYS } = require('./helpers/loanFixture');

const AL = 'Asian Lakto Ind Ltd';
const IND = 'Indriyan Beverages Pvt Ltd';
const HR = { username: 'hr1', role: 'hr' };
const HR2 = { username: 'hr2', role: 'hr' };
const FIN = { username: 'fin1', role: 'finance' };
const NOW = new Date('2026-10-10T06:00:00Z');
const NOV = { cutoverMonth: 11, cutoverYear: 2026 };
const H = ['Name', 'Company', 'Department', 'Loan date', 'Original principal', 'Outstanding', 'EMI', 'Loan type', 'Agreement ref', 'Notes'];

let db;
let seq = 0;
const plant = (name, over = {}) => F.addEmployee(db, { code: `I${String(++seq).padStart(4, '0')}`, name, company: AL, date_of_joining: '2024-01-01', ...over });
const salesRep = (name, code, over = {}) => db.prepare("INSERT INTO sales_employees (code, name, company, status, doj, gross_salary) VALUES (?, ?, ?, ?, '2025-01-01', 30000)")
  .run(code, name, over.company || IND, over.status || 'Active');
const book = (rows, head = H) => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([head, ...rows]), 'Loans');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
};
const upload = (rows, actor = HR, extra = {}) => L.createBatch(db, { fileName: 'accounts.xlsx', buffer: book(rows), ...extra }, actor);
const detail = (id, o = {}) => L.batchDetail(db, id, { now: NOW, ...o });
const rowOf = (d, rowNo) => d.rows.find((r) => r.row_no === rowNo);
const approve = (id, actor = ADMIN, m = NOV) => L.approveBatch(db, { batchId: id, ...m, note: 'go' }, actor, { now: NOW });

/** HR confirms every proposal (or the first candidate), finance confirms every balance as in the Excel. */
function confirmAll(id) {
  for (const r of detail(id).rows) {
    if (r.state === 'out') continue;
    const pick = r.candidates[0];
    if (r.match_status !== 'confirmed' && pick) {
      const res = L.confirmMatch(db, { batchId: id, rowId: r.id, borrowerType: pick.borrowerType, employeeCode: pick.code }, HR);
      if (!res.ok) throw new Error(`match row ${r.row_no}: ${res.code} ${res.message}`);
    }
  }
  for (const r of detail(id).rows) {
    if (r.state === 'needs_balance') {
      const res = L.confirmBalance(db, { batchId: id, rowId: r.id }, FIN);
      if (!res.ok) throw new Error(`balance row ${r.row_no}: ${res.code} ${res.message}`);
    }
  }
}

beforeEach(() => { db = F.newDb(); seq = 0; });

describe('upload', () => {
  test('parses, proposes, flags duplicates and invalid rows; audit row written', () => {
    plant('RAVI KUMAR'); plant('MANPREET SINGH');
    const r = upload([
      ['Ravi Kumar', 'Asian Lakto', 'Production', '01-04-2026', 20000, 12000, 2000, 'Personal', 'AG-1', ''],
      ['Manpret Singh', 'Asian Lakto', '', '', '', 6000, 1500, '', '', ''],
      ['Ravi Kumar', 'Asian Lakto', 'Production', '01-04-2026', 20000, 12000, 2000, 'Personal', 'AG-1', ''],
      ['Ghost Person', 'Asian Lakto', '', '', '', 1000, 500, '', '', ''],
      ['Bad Emi', 'Asian Lakto', '', '', '', 1000, 99.5, '', '', ''],
    ]);
    expect(r.ok).toBe(true);
    expect(r.counts).toMatchObject({ rows: 5, duplicate: 1, invalid: 1, exact: 1, close: 1, none: 2 });
    const d = detail(r.batchId);
    expect(rowOf(d, 2)).toMatchObject({ match_tier: 'exact', state: 'needs_match', employee_code: 'I0001' });
    expect(rowOf(d, 4)).toMatchObject({ parse_status: 'duplicate', state: 'out', outReason: 'duplicate' });
    expect(rowOf(d, 5)).toMatchObject({ state: 'out', outReason: 'unmatched' });
    expect(rowOf(d, 6)).toMatchObject({ parse_status: 'invalid', amountFixable: true });
    expect(db.prepare("SELECT COUNT(*) n FROM audit_log WHERE action_type = 'loan_import_upload'").get().n).toBe(1);
    expect(db.prepare('SELECT COUNT(*) n FROM loans').get().n).toBe(0);
  });
  test('roles: admin and viewer cannot upload', () => {
    expect(upload([['A', 'Asian', '', '', '', 1, 1, '', '', '']], ADMIN).code).toBe('ROLE_NOT_ALLOWED');
    expect(upload([['A', 'Asian', '', '', '', 1, 1, '', '', '']], VIEWER).code).toBe('ROLE_NOT_ALLOWED');
    expect(upload([['A', 'Asian', '', '', '', 1, 1, '', '', '']], FIN).ok).toBe(true);
  });
  test('the same file twice → 409-class refusal; discarding frees it', () => {
    const rows = [['A', 'Asian', '', '', '', 100, 10, '', '', '']];
    const a = upload(rows);
    const b = upload(rows);
    expect(b).toMatchObject({ ok: false, code: 'IMPORT_FILE_ALREADY_UPLOADED', batchId: a.batchId });
    expect(L.discardBatch(db, { batchId: a.batchId, reason: 'x' }, HR2).code).toBe('NOT_UPLOADER');
    expect(L.discardBatch(db, { batchId: a.batchId, reason: 'wrong file' }, HR).ok).toBe(true);
    expect(upload(rows).ok).toBe(true);
  });
  test('a company-restricted user cannot upload another company\'s rows', () => {
    const r = L.createBatch(db, { fileName: 'x.xlsx', buffer: book([['A', 'Indriyan', '', '', '', 100, 10, '', '', '']]) }, HR, { companies: [AL] });
    expect(r.code).toBe('COMPANY_NOT_ALLOWED');
  });
});

describe('HR match / finance balance', () => {
  test('HR only for matches, finance only for balances', () => {
    plant('RAVI KUMAR');
    const { batchId } = upload([['Ravi Kumar', 'Asian', '', '', '', 1000, 500, '', '', '']]);
    const row = detail(batchId).rows[0];
    expect(L.confirmMatch(db, { batchId, rowId: row.id, borrowerType: 'plant', employeeCode: 'I0001' }, FIN).code).toBe('ROLE_NOT_ALLOWED');
    expect(L.confirmMatch(db, { batchId, rowId: row.id, borrowerType: 'plant', employeeCode: 'I0001' }, ADMIN).code).toBe('ROLE_NOT_ALLOWED');
    expect(L.confirmBalance(db, { batchId, rowId: row.id }, HR).code).toBe('ROLE_NOT_ALLOWED');
    expect(L.confirmMatch(db, { batchId, rowId: row.id, borrowerType: 'plant', employeeCode: 'I0001' }, HR).ok).toBe(true);
    expect(L.confirmBalance(db, { batchId, rowId: row.id }, FIN).ok).toBe(true);
    expect(detail(batchId).rows[0].state).toBe('in');
  });
  test('a pick outside the candidates needs a note; non-Active, Sales-typed plant rows and other-company sales are refused', () => {
    plant('RAVI KUMAR'); const other = plant('SOMEONE ELSE'); const left = plant('GONE MAN', { status: 'Left' });
    const st = plant('SALES TYPE', { employment_type: 'Sales' }); salesRep('REP ONE', 'S1', { company: IND });
    const { batchId } = upload([['Ravi Kumar', 'Asian', '', '', '', 1000, 500, '', '', '']]);
    const rid = detail(batchId).rows[0].id;
    const m = (o) => L.confirmMatch(db, { batchId, rowId: rid, borrowerType: 'plant', ...o }, HR);
    expect(m({ employeeCode: other.code }).code).toBe('NOTE_REQUIRED');
    expect(m({ employeeCode: other.code, note: 'accounts confirmed by phone' }).ok).toBe(true);
    expect(m({ employeeCode: left.code, note: 'xxxxxxx' }).code).toBe('BORROWER_NOT_ACTIVE');
    expect(m({ employeeCode: st.code, note: 'xxxxxxx' }).code).toBe('SALES_USE_SALES_MASTER');
    expect(L.confirmMatch(db, { batchId, rowId: rid, borrowerType: 'sales', employeeCode: 'S1', note: 'xxxxxxx' }, HR).code).toBe('EMPLOYEE_NOT_FOUND');
  });
  test('finance may correct outstanding / EMI only with a note; the Excel values stay on the row; audited', () => {
    plant('RAVI KUMAR');
    const { batchId } = upload([['Ravi Kumar', 'Asian', '', '', '', 1000, 500, '', '', '']]);
    const rid = detail(batchId).rows[0].id;
    expect(L.confirmBalance(db, { batchId, rowId: rid, outstanding: 900 }, FIN).code).toBe('NOTE_REQUIRED');
    expect(L.confirmBalance(db, { batchId, rowId: rid, outstanding: 900, emi: 450.5, note: 'per ledger' }, FIN).code).toBe('EMI_NOT_WHOLE_RUPEE');
    const r = L.confirmBalance(db, { batchId, rowId: rid, outstanding: 900, emi: 450, note: 'per ledger 30 Sep' }, FIN);
    expect(r).toMatchObject({ ok: true, changed: true });
    const row = detail(batchId).rows[0];
    expect(row).toMatchObject({ outstanding: 1000, emi: 500, confirmed_outstanding: 900, confirmed_emi: 450, balance_note: 'per ledger 30 Sep' });
    expect(db.prepare("SELECT COUNT(*) n FROM audit_log WHERE action_type = 'loan_import_balance_confirmed' AND remark LIKE '%CHANGED%'").get().n).toBe(1);
  });
  test('a paise-EMI row becomes importable once finance confirms a whole-rupee EMI', () => {
    plant('RAVI KUMAR');
    const { batchId } = upload([['Ravi Kumar', 'Asian', '', '', '', 1000, 499.5, '', '', '']]);
    const rid = detail(batchId).rows[0].id;
    L.confirmMatch(db, { batchId, rowId: rid, borrowerType: 'plant', employeeCode: 'I0001' }, HR);
    expect(detail(batchId).rows[0].state).toBe('needs_balance');
    expect(L.confirmBalance(db, { batchId, rowId: rid, emi: 500, note: 'rounded to the rupee' }, FIN).ok).toBe(true);
    expect(detail(batchId).rows[0]).toMatchObject({ state: 'in', parse_status: 'ok', parse_errors: [] });
  });
});

describe('approval', () => {
  function readyBatch() {
    plant('RAVI KUMAR', { department: 'PRODUCTION' });
    plant('BALA DEVI');
    salesRep('SALES ONE', 'S0101');
    const r = upload([
      ['Ravi Kumar', 'Asian Lakto', 'Production', '01-04-2026', 20000, 10000, 3000, 'Personal', 'AG-1', 'n1'],
      ['Bala Devi', 'Asian Lakto', '', '', '', 1500, 2000, 'Education', '', ''],
      ['Sales One', 'Indriyan', '', '', '', 7000, 2500, '', 'AG-3', ''],
      ['Nobody', 'Asian Lakto', '', '', '', 500, 100, '', '', ''],
    ]);
    confirmAll(r.batchId);
    return r.batchId;
  }

  test('creates opening-balance loans: fields, schedule, first EMI = M, reconciliation, events, no disbursed event', () => {
    const id = readyBatch();
    const a = approve(id);
    expect(a.ok).toBe(true);
    expect(a.loans).toHaveLength(3);
    expect(a.leftOut).toEqual([expect.objectContaining({ rowNo: 5, section: 'unmatched', reason: 'No employee matched' })]);
    const [ravi, bala, rep] = a.loans.map((l) => db.prepare('SELECT * FROM loans WHERE id = ?').get(l.loanId));
    expect(ravi).toMatchObject({
      status: 'active', borrower_type: 'plant', company: AL, principal_amount: 10000, disbursed_amount: 10000, remaining_balance: 10000,
      emi_amount: 3000, tenure_months: 4, disbursement_mode: 'Opening balance (import)', disbursement_reference: `IMPORT-${id}-R2`,
      disbursed_on: '2026-10-31', disbursed_by: 'fin1', requested_by: 'hr1', decided_by: 'boss', first_emi_month: 11, first_emi_year: 2026,
      agreement_file_path: 'AG-1', remarks: 'n1',
    });
    const ins = db.prepare('SELECT due_month, due_year, amount_due, origin FROM loan_instalments WHERE loan_id = ? ORDER BY sequence').all(ravi.id);
    expect(ins.map((i) => [i.due_month, i.amount_due])).toEqual([[11, 3000], [12, 3000], [1, 3000], [2, 1000]]);
    expect(ins.every((i) => i.origin === 'schedule')).toBe(true);
    expect(bala).toMatchObject({ tenure_months: 1, emi_amount: 2000, agreement_file_path: null, loan_type: 'Education' });
    expect(db.prepare('SELECT amount_due FROM loan_instalments WHERE loan_id = ?').all(bala.id)).toEqual([{ amount_due: 1500 }]);
    expect(rep).toMatchObject({ borrower_type: 'sales', company: IND, disbursed_on: '2026-10-25', first_emi_month: 11 });
    for (const l of [ravi, bala, rep]) {
      expect(L.reconcileLoan(db, l.id).ok).toBe(true);
      const ev = db.prepare('SELECT event FROM loan_events WHERE loan_id = ?').all(l.id).map((e) => e.event);
      expect(ev).toEqual(['imported']);
    }
    expect(db.prepare("SELECT reason FROM loan_events WHERE loan_id = ?").get(ravi.id).reason).toMatch(/confirmed by hr1.*balance confirmed by fin1.*approved by boss/);
    expect(db.prepare("SELECT COUNT(*) n FROM audit_log WHERE action_type IN ('loan_imported','loan_import_approve')").get().n).toBe(4);
    const b = detail(id);
    expect(b.batch).toMatchObject({ status: 'approved', plant_cutover_month: 11, sales_cutover_month: 11, approved_by: 'boss' });
    expect(b.batch.cutover).toEqual({ plant: { month: 11, year: 2026 }, sales: { month: 11, year: 2026 } });
    expect(a.loans.map((l) => l.cutover)).toEqual([{ month: 11, year: 2026 }, { month: 11, year: 2026 }, { month: 11, year: 2026 }]);
    expect(rowOf(b, 5)).toMatchObject({ outcome: 'left_out' });
    expect(L.importOfLoan(db, ravi.id)).toEqual({ batchId: id, rowNo: 2 });
  });

  test('statement: opening in Oct, recoveries from Nov, no negative month; posting Nov reconciles', () => {
    const id = readyBatch();
    const a = approve(id);
    const loanId = a.loans[0].loanId;
    const nov = db.prepare('SELECT * FROM loan_instalments WHERE loan_id = ? AND sequence = 1').get(loanId);
    const p = L.recordProvisional(db, { loanId, instalmentId: nov.id, payroll: 'plant', month: 11, year: 2026, company: AL, amount: 3000 }, SYS);
    expect(p.ok).toBe(true);
    expect(L.postDeduction(db, { deductionId: p.deductionId }, SYS).ok).toBe(true);
    const st = L.loanStatement(db, loanId);
    expect(st.rows[0]).toMatchObject({ month: '2026-10', opening: 0, disbursed: 10000, closing: 10000 });
    expect(st.rows[1]).toMatchObject({ month: '2026-11', recovered: 3000, closing: 7000 });
    expect(st.rows.every((r) => r.closing >= 0)).toBe(true);
    expect(L.reconcileLoan(db, loanId)).toMatchObject({ ok: true, balance: 7000 });
  });

  test('blocked until every row is decided; exclude counts as a decision', () => {
    plant('RAVI KUMAR'); plant('BALA DEVI');
    const { batchId } = upload([['Ravi Kumar', 'Asian', '', '', '', 1000, 500, '', '', ''], ['Bala Devi', 'Asian', '', '', '', 800, 400, '', '', '']]);
    const [r1, r2] = detail(batchId).rows;
    L.confirmMatch(db, { batchId, rowId: r1.id, borrowerType: 'plant', employeeCode: 'I0001' }, HR);
    let a = approve(batchId);
    expect(a.code).toBe('ROWS_NOT_DECIDED');
    expect(a.blockers.map((b) => b.code).sort()).toEqual(['NEEDS_FINANCE_BALANCE', 'NEEDS_HR_MATCH']);
    L.excludeRow(db, { batchId, rowId: r2.id, reason: 'paid off in cash' }, HR);
    expect(approve(batchId).blockers).toEqual([expect.objectContaining({ code: 'NEEDS_FINANCE_BALANCE' })]);
    L.confirmBalance(db, { batchId, rowId: r1.id }, FIN);
    a = approve(batchId);
    expect(a.ok).toBe(true);
    expect(a.leftOut).toEqual([expect.objectContaining({ section: 'excluded', detail: 'paid off in cash' })]);
  });

  test('maker-checker: hr / finance cannot approve; an approver who uploaded or confirmed is refused', () => {
    const id = readyBatch();
    expect(approve(id, HR).code).toBe('ROLE_NOT_ALLOWED');
    expect(approve(id, FIN).code).toBe('ROLE_NOT_ALLOWED');
    expect(approve(id, { username: 'hr1', role: 'admin' }).code).toBe('SELF_APPROVAL');
    expect(approve(id, { username: 'FIN1', role: 'admin' }).code).toBe('SELF_APPROVAL');
    expect(approve(id).ok).toBe(true);
  });

  test('cutover month: not before last month (IST), not a closed month for a payroll in the batch', () => {
    const id = readyBatch();
    expect(approve(id, ADMIN, { cutoverMonth: 8, cutoverYear: 2026 }).code).toBe('CUTOVER_TOO_EARLY');
    db.prepare("INSERT INTO loan_closes (month, year, payroll, run_by) VALUES (11, 2026, 'sales', 'system')").run();
    const r = approve(id, ADMIN, { cutoverMonth: 11, cutoverYear: 2026 });
    expect(r).toMatchObject({ code: 'CUTOVER_TOO_EARLY', payroll: 'sales', earliest: { month: 12, year: 2026 } });
    expect(detail(id).approval.earliestCutover).toEqual({ plant: { month: 9, year: 2026 }, sales: { month: 12, year: 2026 } });
    const ok = approve(id, ADMIN, { cutoverMonth: 12, cutoverYear: 2026 });
    expect(ok.ok).toBe(true);
    expect(ok.loans[0].firstEmi).toEqual({ month: 12, year: 2026 });
    expect(db.prepare('SELECT disbursed_on FROM loans WHERE id = ?').get(ok.loans[0].loanId).disbursed_on).toBe('2026-11-30');
  });

  test('September (last month) is allowed on 10 Oct; a sales close does not block a plant-only batch', () => {
    plant('RAVI KUMAR');
    db.prepare("INSERT INTO loan_closes (month, year, payroll, run_by) VALUES (9, 2026, 'sales', 'system')").run();
    const { batchId } = upload([['Ravi Kumar', 'Asian', '', '', '', 1000, 500, '', '', '']]);
    confirmAll(batchId);
    const a = approve(batchId, ADMIN, { cutoverMonth: 9, cutoverYear: 2026 });
    expect(a.ok).toBe(true);
    expect(db.prepare('SELECT disbursed_on, first_emi_month FROM loans').get()).toEqual({ disbursed_on: '2026-08-31', first_emi_month: 9 });
  });

  test('import works with the disbursement gate off and on', () => {
    expect(L.disbursementEnabled(db)).toBe(false);
    const id = readyBatch();
    expect(approve(id).ok).toBe(true);
    db.prepare("UPDATE policy_config SET value = '1' WHERE key = 'loans_disbursement_enabled'").run();
    plant('THIRD ONE');
    const { batchId } = upload([['Third One', 'Asian', '', '', '', 900, 300, '', '', '']]);
    confirmAll(batchId);
    expect(approve(batchId).ok).toBe(true);
  });

  test('idempotent: a second approval is refused; an edited file cannot import the same loan again', () => {
    const id = readyBatch();
    expect(approve(id).ok).toBe(true);
    expect(approve(id).code).toBe('BATCH_NOT_IN_REVIEW');
    const r = upload([
      ['Ravi Kumar', 'Asian Lakto', 'Production', '01-04-2026', 20000, 9000, 3000, 'Personal', 'AG-1', 'edited'],
      ['Bala Devi', 'Asian Lakto', '', '', '', 1500, 2000, 'Education', 'NEW-REF', ''],
    ]);
    confirmAll(r.batchId);
    const a = approve(r.batchId);
    expect(a.ok).toBe(true);
    expect(a.loans.map((l) => l.rowNo)).toEqual([3]);
    expect(a.leftOut[0]).toMatchObject({ rowNo: 2, section: 'already_imported' });
    expect(db.prepare('SELECT COUNT(*) n FROM loans').get().n).toBe(4);
  });

  test('all or nothing: a borrower who left after the HR confirmation stops the whole batch', () => {
    const id = readyBatch();
    db.prepare("UPDATE employees SET status = 'Left' WHERE code = 'I0002'").run();
    const a = approve(id);
    expect(a).toMatchObject({ ok: false, code: 'BORROWER_NOT_ACTIVE', rowNo: 3 });
    expect(db.prepare('SELECT COUNT(*) n FROM loans').get().n).toBe(0);
    expect(detail(id).batch.status).toBe('review');
  });

  test('a name found only on a Left employee goes to the "Left — settle outside the app" section', () => {
    plant('OLD HAND', { status: 'Left' }); plant('RAVI KUMAR');
    const { batchId } = upload([['Old Hand', 'Asian', '', '', '', 1000, 500, '', '', ''], ['Ravi Kumar', 'Asian', '', '', '', 1000, 500, '', '', '']]);
    const d = detail(batchId);
    expect(d.sections.left).toEqual([rowOf(d, 2).id]);
    confirmAll(batchId);
    const a = approve(batchId);
    expect(a.leftOut).toEqual([expect.objectContaining({ rowNo: 2, section: 'left', reason: 'Left — settle outside the app' })]);
  });

  test('warnings never block: no DOJ, contract, second loan, headroom short, agreement missing, Stage 7 already computed', () => {
    plant('NO DOJ'); plant('CON TRACT', { employment_type: 'Contract' }); plant('TWO LOANS');
    db.prepare("UPDATE employees SET date_of_joining = NULL WHERE code = 'I0001'").run();
    db.prepare("INSERT INTO salary_computations (employee_code, month, year, company, gross_earned, advance_recovery, total_deductions, net_salary) VALUES ('I0003', 9, 2026, ?, 4000, 1900, 1900, 2100)").run(AL);
    db.prepare("INSERT INTO salary_computations (employee_code, month, year, company, gross_earned, advance_recovery, total_deductions, net_salary) VALUES ('I0003', 11, 2026, ?, 4000, 1900, 1900, 2100)").run(AL);
    const { batchId } = upload([
      ['No Doj', 'Asian', '', '', '', 1000, 500, '', 'A', ''], ['Con Tract', 'Asian', '', '', '', 1000, 500, '', 'B', ''],
      ['Two Loans', 'Asian', '', '01-01-2026', '', 1000, 500, '', '', ''], ['Two Loans', 'Asian', '', '01-02-2026', '', 2000, 500, '', '', ''],
    ]);
    confirmAll(batchId);
    const d = detail(batchId, { cutover: { plant: { month: 11, year: 2026 } } });
    const codesOf = (n) => rowOf(d, n).warnings.map((w) => w.code);
    expect(codesOf(2)).toContain('SERVICE_UNKNOWN');
    expect(codesOf(3)).toContain('CONTRACT_WORKER');
    expect(codesOf(4)).toEqual(expect.arrayContaining(['HEADROOM_SHORT', 'AGREEMENT_MISSING', 'SECOND_LOAN_IN_BATCH']));
    expect(d.approval.stage7Computed.map((x) => x.rowNo)).toEqual([4, 5]);
    const a = approve(batchId);
    expect(a.ok).toBe(true);
    expect(a.loans).toHaveLength(4);
    expect(a.stage7Computed).toHaveLength(2);
    expect(a.loans[3].warnings).toContain('SECOND_LOAN');
  });
});

describe('cutover check', () => {
  test('flags EMI_DIFFERS, STAGE7_PENDING, HEADROOM_SHORT; then the deduction', () => {
    plant('RAVI KUMAR'); plant('BALA DEVI');
    db.prepare("INSERT INTO salary_computations (employee_code, month, year, company, gross_earned, total_deductions, net_salary) VALUES ('I0002', 10, 2026, ?, 3000, 1200, 1800)").run(AL);
    db.prepare("UPDATE salary_computations SET advance_recovery = 1200 WHERE employee_code = 'I0002'").run();
    const { batchId } = upload([['Ravi Kumar', 'Asian', '', '', '', 10000, 3000, '', '', ''], ['Bala Devi', 'Asian', '', '', '', 1500, 2000, '', '', '']]);
    confirmAll(batchId);
    expect(L.cutoverCheck(db, batchId).code).toBe('BATCH_NOT_APPROVED');
    const a = approve(batchId);
    let c = L.cutoverCheck(db, batchId);
    expect(c.ok).toBe(true);
    const ravi = c.rows.find((r) => r.employeeCode === 'I0001');
    const bala = c.rows.find((r) => r.employeeCode === 'I0002');
    expect(ravi).toMatchObject({ excelEmi: 3000, appInstalment: 3000, flags: ['STAGE7_PENDING'], projectedHeadroom: null });
    expect(bala.flags).toEqual(['EMI_DIFFERS', 'HEADROOM_SHORT', 'STAGE7_PENDING']);
    expect(bala).toMatchObject({ appInstalment: 1500, projectedHeadroom: 300 });
    const loanId = a.loans[0].loanId;
    const ins = db.prepare('SELECT * FROM loan_instalments WHERE loan_id = ? AND sequence = 1').get(loanId);
    db.prepare("INSERT INTO salary_computations (employee_code, month, year, company, gross_earned, total_deductions, net_salary, loan_recovery) VALUES ('I0001', 11, 2026, ?, 20000, 3000, 17000, 3000)").run(AL);
    L.recordProvisional(db, { loanId, instalmentId: ins.id, payroll: 'plant', month: 11, year: 2026, company: AL, amount: 3000 }, SYS);
    c = L.cutoverCheck(db, batchId);
    expect(c.rows.find((r) => r.employeeCode === 'I0001')).toMatchObject({ flags: [], deduction: { state: 'provisional', amount: 3000 }, payslipLoan: 3000, netSalary: 17000 });
    expect(c.totals).toMatchObject({ loans: 2, excelEmi: 5000, appInstalment: 4500, deducted: 3000, flagged: 1 });
    expect(L.cutoverCheckXlsx(c).length).toBeGreaterThan(1000);
  });
});

describe('reports label imported loans (ruling Q11)', () => {
  test('outstanding register and perquisite list show "Opening balance (import)", not a payout', () => {
    plant('BIG LOAN');
    const { batchId } = upload([['Big Loan', 'Asian', '', '', '', 25000, 5000, '', 'AG', '']]);
    confirmAll(batchId);
    approve(batchId);
    const reg = L.outstandingRegister(db);
    expect(reg.rows[0]).toMatchObject({ disbursed: 25000, openingImported: 25000, disbursedAs: 'Opening balance (import)' });
    expect(reg.totals).toMatchObject({ disbursed: 25000, openingImported: 25000, balance: 25000 });
    const perq = L.perquisiteList(db, { from: { month: 10, year: 2026 }, to: { month: 10, year: 2026 } });
    expect(perq.months[0].borrowers[0]).toMatchObject({ peak: 25000, openingImported: 25000, paidOutAs: 'Opening balance (import)' });
    const sheets = L.reportSheets('outstanding', reg);
    expect(sheets[0].columns.map((c) => c[1])).toContain('Disbursed as');
  });
});
