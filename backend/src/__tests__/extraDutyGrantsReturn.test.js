/**
 * Finance "Return for correction" on extra-duty grants (Oct 2026).
 *
 * Finance's only tools used to be approve and reject. Reject is final and
 * UNIQUE(employee_code, grant_date, month, year) stops HR re-entering the
 * date, so a grant entered as 1.0 day when 0.5 was due could never be fixed.
 * A returned grant goes back to HR, who re-enters it through POST / (same id)
 * and it lands in finance's queue again as UNREVIEWED.
 *
 * Driven over a real socket through the shared apiHarness: real database/db.js
 * on a temp DATA_DIR (real initSchema, real audit_log), the real roles
 * middleware, and the real payroll routes for Stage 6 / Stage 7 / finalise.
 */
const { startApi } = require('./helpers/apiHarness');
const { isMonthFinalized } = require('../services/leaveTriggers');

const MONTH = 9;
const YEAR = 2026;
const CO = 'Asian Lakto Ind Ltd';
const EMP = '23388';
const DATE = '2026-09-07'; // a Monday, like the 19 rows finance rejected on 24 Sep
const REVIEWED_AT = '2026-09-24 11:57:51';

let api;
let db;

beforeAll(() => {
  api = startApi({
    '/api/extra-duty-grants': '../../routes/extraDutyGrants',
    '/api/payroll': '../../routes/payroll',
  });
  db = api.db;
});

afterAll(async () => { await api.close(); });

let errSpy;
let logSpy;
beforeEach(() => {
  for (const t of ['extra_duty_grants', 'audit_log', 'attendance_processed', 'day_calculations',
    'salary_computations', 'salary_structures', 'monthly_imports', 'finance_month_signoff',
    'finance_rejections', 'notifications', 'employees']) {
    db.prepare(`DELETE FROM ${t}`).run();
  }
  // Same company spread as prod's monthly_imports for Sep 2026.
  const mi = db.prepare(`INSERT INTO monthly_imports (month, year, company, file_name, status, stage_1_done)
    VALUES (?, ?, ?, 'test.xls', 'imported', 1)`);
  for (const c of [CO, 'Default', 'null']) mi.run(MONTH, YEAR, c);
  addEmployee(EMP);
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => { jest.restoreAllMocks(); });

// ── Fixtures ─────────────────────────────────────────────────────────────────

function addEmployee(code) {
  const info = db.prepare(`
    INSERT INTO employees (code, name, department, company, employment_type, status, date_of_joining, gross_salary, weekly_off_day)
    VALUES (?, 'TEST NAME', 'PRODUCTION', ?, 'Permanent', 'Active', '2024-01-01', 20000, 0)
  `).run(code, CO);
  db.prepare(`
    INSERT INTO salary_structures (employee_id, basic, hra, gross_salary, effective_from, pf_applicable, esi_applicable)
    VALUES (?, 10000, 10000, 20000, '2024-01-01', 0, 0)
  `).run(info.lastInsertRowid);
  return info.lastInsertRowid;
}

/** A full September of attendance: P Mon-Sat, WO on Sundays (no WOP, so Stage 6 auto-creates nothing). */
function seedAttendance(code) {
  const ins = db.prepare(`
    INSERT INTO attendance_processed (employee_code, date, month, year, company, status_original, status_final,
      in_time_original, out_time_original, is_night_out_only, is_miss_punch)
    VALUES (?, ?, ?, ?, ?, ?, ?, '08:00', '18:00', 0, 0)
  `);
  for (let d = 1; d <= 30; d += 1) {
    const date = `${YEAR}-09-${String(d).padStart(2, '0')}`;
    const status = new Date(`${date}T12:00:00Z`).getUTCDay() === 0 ? 'WO' : 'P';
    ins.run(code, date, MONTH, YEAR, CO, status, status);
  }
}

/** One grant as prod stores it: company '' and the 24 Sep finance review stamp. */
function addGrant(over = {}) {
  const g = {
    employee_code: EMP, grant_date: DATE, company: '', grant_type: 'OVERNIGHT_STAY', duty_days: 1,
    verification_source: 'Gate Register', reference_number: 'GR-0907', remarks: 'stayed overnight',
    status: 'APPROVED', finance_status: 'UNREVIEWED', is_processed: 0, linked_attendance_id: null,
    finance_flag_reason: null, finance_reviewed_by: null, finance_reviewed_at: null, ...over,
  };
  const info = db.prepare(`
    INSERT INTO extra_duty_grants (employee_code, grant_date, month, year, company, grant_type, duty_days,
      verification_source, reference_number, remarks, status, finance_status, is_processed, linked_attendance_id,
      finance_flag_reason, finance_reviewed_by, finance_reviewed_at, requested_by, requested_at, approved_by, approved_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'hr1', '2026-09-21 04:00:00', 'hr1', '2026-09-22 04:20:51')
  `).run(g.employee_code, g.grant_date, MONTH, YEAR, g.company, g.grant_type, g.duty_days,
    g.verification_source, g.reference_number, g.remarks, g.status, g.finance_status, g.is_processed,
    g.linked_attendance_id, g.finance_flag_reason, g.finance_reviewed_by, g.finance_reviewed_at);
  return Number(info.lastInsertRowid);
}

const grant = (id) => db.prepare('SELECT * FROM extra_duty_grants WHERE id = ?').get(id);
const allGrants = () => db.prepare('SELECT * FROM extra_duty_grants ORDER BY id').all();
const auditRows = () => db.prepare(
  "SELECT record_id, field_name, old_value, new_value, changed_by, stage, remark FROM audit_log WHERE table_name = 'extra_duty_grants' ORDER BY id"
).all();
const finaliseMonthFor = (company) => db.prepare('UPDATE monthly_imports SET is_finalised = 1 WHERE month = ? AND year = ? AND company = ?')
  .run(MONTH, YEAR, company);

const asFinance = { role: 'finance' };
const asHr = { role: 'hr' };
const doReturn = (id, reason = 'Only 0.5 day was due', opts = asFinance) =>
  api.request('POST', `/api/extra-duty-grants/${id}/finance-return`, { body: { finance_flag_reason: reason }, ...opts });
const hrPost = (over = {}) => api.request('POST', '/api/extra-duty-grants', {
  body: {
    employee_code: EMP, grant_date: DATE, month: MONTH, year: YEAR, company: CO,
    grant_type: 'EXTENDED_SHIFT', duty_days: 0.5, verification_source: 'Production Office',
    reference_number: 'PO-77', remarks: 'half shift after power cut', original_punch_date: '2026-09-07',
    ...over,
  },
  ...asHr,
});
const financeApprove = (id) => api.request('POST', `/api/extra-duty-grants/${id}/finance-approve`, asFinance);

function runStages() {
  const days = () => api.request('POST', '/api/payroll/calculate-days', { body: { month: MONTH, year: YEAR, company: CO } });
  const salary = () => api.request('POST', '/api/payroll/compute-salary', { body: { month: MONTH, year: YEAR, company: CO } });
  return days().then((d) => {
    expect(d.status).toBe(200);
    return salary();
  }).then((s) => {
    expect(s.status).toBe(200);
    expect(s.body.errors).toBe(0);
    return db.prepare('SELECT * FROM salary_computations WHERE employee_code = ? AND month = ? AND year = ?').get(EMP, MONTH, YEAR);
  });
}

const GENERIC_CONFLICT = (row) =>
  `A grant already exists for this employee on ${DATE} (status: ${row.status}, finance: ${row.finance_status}, source: ${row.verification_source}). Open that row instead.`;

// ── R1–R3: POST /:id/finance-return ──────────────────────────────────────────

describe('POST /:id/finance-return', () => {
  test.each(['UNREVIEWED', 'FINANCE_REJECTED', 'FINANCE_APPROVED'])(
    'returns a grant from %s: only the finance columns move, one audit row', async (from) => {
      const reviewed = from === 'UNREVIEWED' ? {} : { finance_reviewed_by: 'finance', finance_reviewed_at: REVIEWED_AT, finance_flag_reason: 'power cut' };
      const id = addGrant({ finance_status: from, ...reviewed });
      seedAttendance(EMP);
      const attBefore = db.prepare('SELECT * FROM attendance_processed ORDER BY id').all();
      const before = grant(id);

      const res = await doReturn(id, '  Only 0.5 day was due  ');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true });
      const after = grant(id);
      expect(after.finance_status).toBe('FINANCE_RETURNED');
      expect(after.finance_flag_reason).toBe('Only 0.5 day was due');
      expect(after.finance_reviewed_by).toBe('tester');
      expect(after.finance_reviewed_at).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
      expect(after.finance_reviewed_at).not.toBe(REVIEWED_AT);
      const strip = ({ finance_status, finance_flag_reason, finance_reviewed_by, finance_reviewed_at, ...rest }) => rest;
      expect(strip(after)).toEqual(strip(before)); // status, duty_days, everything else untouched
      expect(db.prepare('SELECT * FROM attendance_processed ORDER BY id').all()).toEqual(attBefore);
      expect(auditRows()).toEqual([{
        record_id: id, field_name: 'finance_status', old_value: from, new_value: 'FINANCE_RETURNED',
        changed_by: 'tester', stage: 'FINANCE_RETURN', remark: 'Only 0.5 day was due (old duty_days=1)',
      }]);
    });

  test.each(['UNREVIEWED', 'FINANCE_REJECTED', 'FINANCE_APPROVED'])(
    'a grant returned from %s pays 0 ED at Stage 7', async (from) => {
      seedAttendance(EMP);
      const id = addGrant({ finance_status: from });
      const pre = await runStages();
      expect(pre.ed_days).toBe(from === 'FINANCE_APPROVED' ? 1 : 0);

      expect((await doReturn(id)).status).toBe(200);
      const post = await runStages();
      expect(post.ed_days).toBe(0);
      expect(post.ed_pay).toBe(0);
      expect(post.finance_extra_duty).toBe(0);
    });

  test.each([
    ['HR status PENDING', { status: 'PENDING' }, 'HR status is PENDING'],
    ['HR status REJECTED', { status: 'REJECTED' }, 'HR status is REJECTED'],
    ['pre-biometric grant', { grant_type: 'PRE_BIOMETRIC_ACTIVATION', verification_source: 'HR_NEW_JOINER' }, 'pre-biometric grants cannot be returned'],
    ['processed grant', { is_processed: 1 }, 'already processed'],
    ['finance-flagged grant', { finance_status: 'FINANCE_FLAGGED' }, 'finance status is FINANCE_FLAGGED'],
    ['already returned grant', { finance_status: 'FINANCE_RETURNED' }, 'finance status is FINANCE_RETURNED'],
  ])('409 and nothing changes for a %s', async (_label, over, msg) => {
    const id = addGrant(over);
    const before = allGrants();
    const res = await doReturn(id);
    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain(msg);
    expect(res.body.grant_id).toBe(id);
    expect(allGrants()).toEqual(before);
    expect(auditRows()).toEqual([]);
  });

  test('409 and nothing changes once the month is finalised (grant company is blank)', async () => {
    const id = addGrant({ finance_status: 'FINANCE_REJECTED', finance_reviewed_at: REVIEWED_AT, finance_flag_reason: 'power cut' });
    finaliseMonthFor(CO); // finalise only ever stamps the real company names, never ''
    const before = allGrants();
    const res = await doReturn(id);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('Cannot return this grant: 9/2026 is finalised.');
    expect(allGrants()).toEqual(before);
    expect(auditRows()).toEqual([]);
  });

  test.each([[undefined], [''], ['   '], [42]])('400 when the reason is %p', async (reason) => {
    const id = addGrant();
    const before = allGrants();
    const res = await api.request('POST', `/api/extra-duty-grants/${id}/finance-return`, {
      body: reason === undefined ? {} : { finance_flag_reason: reason }, ...asFinance,
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Return reason required');
    expect(allGrants()).toEqual(before);
    expect(auditRows()).toEqual([]);
  });

  test('404 for an unknown id', async () => {
    const res = await doReturn(999999);
    expect(res.status).toBe(404);
  });

  test.each(['hr', 'viewer'])('same guard as finance-reject: %s gets 403 from both', async (role) => {
    const id = addGrant();
    const before = allGrants();
    const ret = await doReturn(id, 'x', { role });
    const rej = await api.request('POST', `/api/extra-duty-grants/${id}/finance-reject`, { body: { finance_flag_reason: 'x' }, role });
    expect(ret.status).toBe(403);
    expect(rej.status).toBe(403);
    expect(ret.body.error).toBe(rej.body.error);
    expect(allGrants()).toEqual(before);
  });
});

// ── R4: HR re-entry through POST / ───────────────────────────────────────────

describe('HR re-entry of a returned grant (POST /)', () => {
  test('updates the same row in place and sends it back to finance as UNREVIEWED', async () => {
    const id = addGrant({ finance_status: 'FINANCE_RETURNED', finance_reviewed_by: 'finance',
      finance_reviewed_at: REVIEWED_AT, finance_flag_reason: 'Only 0.5 day was due' });
    const before = grant(id);
    const others = db.prepare('SELECT COUNT(*) AS n FROM extra_duty_grants').get().n;

    const res = await hrPost();

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, id });
    expect(db.prepare('SELECT COUNT(*) AS n FROM extra_duty_grants').get().n).toBe(others);
    const after = grant(id);
    expect(after).toMatchObject({
      duty_days: 0.5, grant_type: 'EXTENDED_SHIFT', verification_source: 'Production Office',
      reference_number: 'PO-77', remarks: 'half shift after power cut', original_punch_date: '2026-09-07',
      requested_by: 'tester', status: 'APPROVED', approved_by: 'tester',
      finance_status: 'UNREVIEWED', finance_reviewed_by: null, finance_reviewed_at: null,
      // untouched
      employee_code: EMP, grant_date: DATE, month: MONTH, year: YEAR, company: '',
      employee_id: before.employee_id, linked_attendance_id: null, is_processed: 0,
      finance_flag_reason: 'Only 0.5 day was due',
    });
    expect(after.requested_at).not.toBe(before.requested_at);
    expect(after.approved_at).not.toBe(before.approved_at);
    expect(auditRows()).toEqual([{
      record_id: id, field_name: 'finance_status', old_value: 'FINANCE_RETURNED', new_value: 'UNREVIEWED',
      changed_by: 'tester', stage: 'HR_RESUBMIT',
      remark: `${EMP} ${DATE}: HR re-entered after finance return, duty_days 1 -> 0.5. `
        + 'Old: grant_type=OVERNIGHT_STAY, verification_source=Gate Register, reference_number="GR-0907", '
        + 'remarks="stayed overnight", original_punch_date="", requested_by=hr1',
    }]);
  });

  test('omitted optional fields take the same defaults as a fresh grant', async () => {
    const id = addGrant({ finance_status: 'FINANCE_RETURNED' });
    const res = await api.request('POST', '/api/extra-duty-grants', {
      body: { employee_code: EMP, grant_date: DATE, month: MONTH, year: YEAR, verification_source: 'Gate Register' },
      ...asHr,
    });
    expect(res.status).toBe(200);
    expect(grant(id)).toMatchObject({
      duty_days: 1, grant_type: 'OVERNIGHT_STAY', reference_number: '', remarks: '', original_punch_date: '',
      finance_status: 'UNREVIEWED',
    });
  });

  test('a pre-biometric request cannot take over a returned grant: generic 409, nothing changes', async () => {
    const id = addGrant({ finance_status: 'FINANCE_RETURNED' });
    const before = allGrants();
    const res = await hrPost({ grant_type: 'PRE_BIOMETRIC_ACTIVATION' });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ success: false, error: GENERIC_CONFLICT(grant(id)), grant_id: id });
    expect(allGrants()).toEqual(before);
    expect(auditRows()).toEqual([]);
  });

  test('refused on a finalised month: 409, nothing changes', async () => {
    const id = addGrant({ finance_status: 'FINANCE_RETURNED' });
    finaliseMonthFor('Default');
    const before = allGrants();
    const res = await hrPost();
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ success: false, error: 'Cannot re-enter this grant: 9/2026 is finalised.', grant_id: id });
    expect(allGrants()).toEqual(before);
    expect(auditRows()).toEqual([]);
  });
});

// ── R5: the 409 for a finance-rejected row ───────────────────────────────────

describe('POST / on a finance-rejected grant', () => {
  test('returnable grant: names the rejection and tells HR to ask for a Return', async () => {
    // prod row 69557 stores its reason with a trailing newline
    const id = addGrant({ finance_status: 'FINANCE_REJECTED', finance_reviewed_by: 'finance',
      finance_reviewed_at: REVIEWED_AT, finance_flag_reason: 'power cut\n' });
    const before = allGrants();
    const res = await hrPost();
    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      success: false,
      error: 'Rejected by finance on 2026-09-24: power cut. Ask finance to Return it for correction.',
      grant_id: id,
    });
    expect(allGrants()).toEqual(before);
    expect(auditRows()).toEqual([]);
  });

  test('missing stamp and reason still produce a readable message', async () => {
    addGrant({ finance_status: 'FINANCE_REJECTED' });
    const res = await hrPost();
    expect(res.body.error).toBe('Rejected by finance on an unknown date: no reason recorded. Ask finance to Return it for correction.');
  });

  test.each([
    ['still HR-pending', { status: 'PENDING' }, () => {}],
    ['pre-biometric', { grant_type: 'PRE_BIOMETRIC_ACTIVATION', verification_source: 'HR_NEW_JOINER' }, () => {}],
    ['in a finalised month', {}, () => finaliseMonthFor(CO)],
  ])('not returnable (%s): generic 409 text', async (_label, over, prep) => {
    const id = addGrant({ finance_status: 'FINANCE_REJECTED', finance_reviewed_at: REVIEWED_AT, finance_flag_reason: 'power cut', ...over });
    prep();
    const before = allGrants();
    const res = await hrPost();
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ success: false, error: GENERIC_CONFLICT(grant(id)), grant_id: id });
    expect(allGrants()).toEqual(before);
  });
});

// ── R6: never approved, never bulk-approved, never finalised past ───────────

describe('a returned grant is never approved while it waits on HR', () => {
  test('finance-approve answers 409 and changes nothing', async () => {
    const id = addGrant({ finance_status: 'FINANCE_RETURNED' });
    const before = allGrants();
    const res = await financeApprove(id);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('This grant was returned to HR for correction. Approve it after HR re-enters it.');
    expect(res.body.grant_id).toBe(id);
    expect(allGrants()).toEqual(before);
    expect(auditRows()).toEqual([]);
  });

  test('bulk-finance-approve skips it and approves the rest', async () => {
    const returned = addGrant({ finance_status: 'FINANCE_RETURNED' });
    const open = addGrant({ grant_date: '2026-09-08' });
    const returnedBefore = grant(returned);
    const res = await api.request('POST', '/api/extra-duty-grants/bulk-finance-approve', { body: { ids: [returned, open, 999999] }, ...asFinance });
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
    expect(grant(returned)).toEqual(returnedBefore);
    expect(grant(open).finance_status).toBe('FINANCE_APPROVED');
    expect(auditRows().map((a) => [a.record_id, a.stage])).toEqual([[open, 'FINANCE_BULK_APPROVE']]);
  });

  test('summaries count returned grants and the finance queue still lists rejected and approved rows', async () => {
    addGrant({ finance_status: 'FINANCE_RETURNED' });
    addGrant({ grant_date: '2026-09-08', finance_status: 'FINANCE_REJECTED' });
    addGrant({ grant_date: '2026-09-09', finance_status: 'FINANCE_APPROVED' });
    const sum = await api.request('GET', `/api/extra-duty-grants/summary?month=${MONTH}&year=${YEAR}`, asFinance);
    expect(sum.body.data).toMatchObject({ financeReturned: 1, financeRejected: 1, financeApproved: 1 });
    const queue = await api.request('GET', `/api/extra-duty-grants/finance-review?month=${MONTH}&year=${YEAR}`, asFinance);
    expect(queue.body.summary).toMatchObject({ total: 3, returned: 1, approved: 1, unreviewed: 0 });
    expect(queue.body.data.map((g) => g.finance_status).sort()).toEqual(['FINANCE_APPROVED', 'FINANCE_REJECTED', 'FINANCE_RETURNED']);
  });
});

describe('finalise (payroll.js) treats a returned grant as pending', () => {
  const finalise = () => api.request('POST', '/api/payroll/finalise', { body: { month: MONTH, year: YEAR }, role: 'admin' });

  test('blocked while returned, still blocked after HR re-entry, allowed once finance approves', async () => {
    db.prepare("INSERT INTO finance_month_signoff (month, year, company, status, signed_by) VALUES (?, ?, ?, 'approved', 'finance')")
      .run(MONTH, YEAR, CO);
    const id = addGrant({ finance_status: 'FINANCE_REJECTED', finance_reviewed_at: REVIEWED_AT, finance_flag_reason: 'power cut' });

    // Baseline: a rejected grant is a finished decision and does not block
    // finalise. Re-open the month afterwards so the return path can be driven.
    let res = await finalise();
    expect(res.status).toBe(200);
    db.prepare('UPDATE monthly_imports SET is_finalised = 0, finalised_at = NULL').run();

    expect((await doReturn(id)).status).toBe(200);
    res = await finalise();
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ pendingGrants: 1, error: 'Cannot finalise: 1 extra duty grant(s) pending finance review.' });
    expect(db.prepare('SELECT SUM(is_finalised) AS n FROM monthly_imports').get().n).toBe(0);

    expect((await hrPost()).status).toBe(200);
    res = await finalise();
    expect(res.status).toBe(400);
    expect(res.body.pendingGrants).toBe(1);

    expect((await financeApprove(id)).status).toBe(200);
    res = await finalise();
    expect(res.status).toBe(200);
    expect(db.prepare('SELECT COUNT(*) AS n FROM monthly_imports WHERE is_finalised = 1').get().n).toBe(3);
  });
});

describe('isMonthFinalized (services/leaveTriggers) with company null', () => {
  test('is month-wide: true for a finalised month whatever company the grant carries', async () => {
    expect(isMonthFinalized(db, null, MONTH, YEAR)).toBe(false);
    expect(isMonthFinalized(db, '', MONTH, YEAR)).toBe(false);
    db.prepare("INSERT INTO finance_month_signoff (month, year, company, status, signed_by) VALUES (?, ?, ?, 'approved', 'finance')")
      .run(MONTH, YEAR, CO);
    const res = await api.request('POST', '/api/payroll/finalise', { body: { month: MONTH, year: YEAR }, role: 'admin' });
    expect(res.status).toBe(200);
    expect(isMonthFinalized(db, null, MONTH, YEAR)).toBe(true);
    expect(isMonthFinalized(db, '', MONTH, YEAR)).toBe(true);
    expect(isMonthFinalized(db, null, '9', '2026')).toBe(true);
    expect(isMonthFinalized(db, null, 10, YEAR)).toBe(false);
  });
});

// ── The whole round trip on Stage 6 / Stage 7 ────────────────────────────────

describe('end to end: 1.0 day rejected → returned → HR enters 0.5 → finance approves', () => {
  test('salary shows 0.5 ED days and the drift check stays within a rupee', async () => {
    seedAttendance(EMP);
    const id = addGrant({ finance_status: 'FINANCE_REJECTED', finance_reviewed_by: 'finance',
      finance_reviewed_at: REVIEWED_AT, finance_flag_reason: 'power cut' });

    let sc = await runStages();
    expect(sc.ed_days).toBe(0);

    // HR's first attempt hits the R5 message
    expect((await hrPost()).status).toBe(409);
    expect((await doReturn(id, 'Only 0.5 day was due')).status).toBe(200);
    sc = await runStages();
    expect(sc.ed_days).toBe(0);

    const re = await hrPost();
    expect(re.body).toEqual({ success: true, id });
    sc = await runStages();
    expect(sc.ed_days).toBe(0); // UNREVIEWED pays nothing yet

    expect((await financeApprove(id)).status).toBe(200);
    sc = await runStages();
    expect(sc.ed_days).toBe(0.5);
    expect(sc.finance_extra_duty).toBe(0.5);
    expect(sc.ed_pay).toBeCloseTo(0.5 * (20000 / 30), 2);

    const drift = db.prepare(`
      SELECT employee_code, net_salary, gross_earned, total_deductions,
             ABS(net_salary - (gross_earned - total_deductions)) AS drift
      FROM salary_computations WHERE month = 9 AND year = 2026 ORDER BY drift DESC LIMIT 20
    `).all();
    expect(drift.length).toBeGreaterThan(0);
    expect(Math.max(...drift.map((r) => r.drift))).toBeLessThanOrEqual(1);

    expect(auditRows().map((a) => a.stage)).toEqual(['FINANCE_RETURN', 'HR_RESUBMIT', 'FINANCE_APPROVE']);
    expect(db.prepare('SELECT COUNT(*) AS n FROM extra_duty_grants').get().n).toBe(1);
  });
});
