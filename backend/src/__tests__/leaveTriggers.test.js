const {
  safeTrigger, queueLeaveRecalc, isMonthFinalized, checkAutoStage6, autoStage6Status, missPunchBacklog,
} = require('../services/leaveTriggers');
const { ensureJobsTable } = require('../services/jobQueue');
const F = require('./helpers/leaveFixture');

const MONTH = 3;
const YEAR = 2026;
const CO = 'Indriyan Beverages Pvt Ltd';

function newDb({ automation = true } = {}) {
  const db = F.newDb();
  ensureJobsTable(db);
  if (automation) F.enableAutomation(db);
  return db;
}

function addImport(db, over = {}) {
  db.prepare(`
    INSERT INTO monthly_imports (month, year, company, file_name, status, stage_1_done, stage_6_done, is_finalised)
    VALUES (?, ?, ?, 'x.xls', 'imported', 1, ?, ?)
  `).run(MONTH, YEAR, CO, over.stage_6_done ?? 0, over.is_finalised ?? 0);
}

function addMissPunch(db, emp, date, { resolved = 0, finance = null } = {}) {
  db.prepare(`
    INSERT INTO attendance_processed
      (employee_code, date, month, year, company, status_original, status_final,
       is_miss_punch, miss_punch_resolved, miss_punch_finance_status, is_night_out_only)
    VALUES (?, ?, ?, ?, ?, 'P', 'P', 1, ?, ?, 0)
  `).run(emp.code, date, MONTH, YEAR, CO, resolved, finance);
}

const jobs = (db, type) => db.prepare('SELECT * FROM jobs WHERE type = ? ORDER BY id').all(type);
const params = (job) => JSON.parse(job.params || '{}');

describe('queueLeaveRecalc — debounce', () => {
  test('two events inside the window merge into one job', () => {
    const db = newDb();
    const a = queueLeaveRecalc(db, { company: CO, month: MONTH, year: YEAR, employeeCodes: ['E1'], reason: 'leave_approved' });
    const b = queueLeaveRecalc(db, { company: CO, month: MONTH, year: YEAR, employeeCodes: ['E2'], reason: 'leave_cancelled' });

    expect(a.queued).toBe(true);
    expect(b.queued).toBe(false);
    expect(b.merged).toBe(true);
    expect(b.jobId).toBe(a.jobId);

    const all = jobs(db, 'leave_recalc');
    expect(all).toHaveLength(1);
    expect(params(all[0]).employeeCodes.sort()).toEqual(['E1', 'E2']);
    expect(params(all[0]).reasons.sort()).toEqual(['leave_approved', 'leave_cancelled']);
    db.close();
  });

  test('fifty bulk resolutions still produce one job', () => {
    const db = newDb();
    for (let i = 0; i < 50; i += 1) {
      queueLeaveRecalc(db, { company: CO, month: MONTH, year: YEAR, employeeCodes: [`E${i}`], reason: 'miss_punch' });
    }
    expect(jobs(db, 'leave_recalc')).toHaveLength(1);
    expect(params(jobs(db, 'leave_recalc')[0]).employeeCodes).toHaveLength(50);
    db.close();
  });

  test('a whole-month event widens a merged job from a code list to everyone', () => {
    const db = newDb();
    queueLeaveRecalc(db, { company: CO, month: MONTH, year: YEAR, employeeCodes: ['E1'], reason: 'one' });
    queueLeaveRecalc(db, { company: CO, month: MONTH, year: YEAR, employeeCodes: null, reason: 'all' });
    expect(params(jobs(db, 'leave_recalc')[0]).employeeCodes).toBeNull();
    db.close();
  });

  test('a different company-month gets its own job', () => {
    const db = newDb();
    queueLeaveRecalc(db, { company: CO, month: 3, year: YEAR, reason: 'a' });
    queueLeaveRecalc(db, { company: CO, month: 4, year: YEAR, reason: 'b' });
    queueLeaveRecalc(db, { company: 'Asian Lakto Ind Ltd', month: 3, year: YEAR, reason: 'c' });
    expect(jobs(db, 'leave_recalc')).toHaveLength(3);
    db.close();
  });

  test('a zero-second debounce window stops the merge', () => {
    const db = newDb();
    F.setPolicy(db, 'leave_recompute_debounce_seconds', '-1');
    queueLeaveRecalc(db, { company: CO, month: MONTH, year: YEAR, reason: 'a' });
    queueLeaveRecalc(db, { company: CO, month: MONTH, year: YEAR, reason: 'b' });
    expect(jobs(db, 'leave_recalc')).toHaveLength(2);
    db.close();
  });
});

describe('queueLeaveRecalc — gates', () => {
  test('a finalized month raises a flag and queues nothing (ruling 4)', () => {
    const db = newDb();
    addImport(db, { is_finalised: 1 });
    const out = queueLeaveRecalc(db, {
      company: CO, month: MONTH, year: YEAR, employeeCodes: ['E9'],
      reason: 'leave_approved', actor: 'hr1',
    });

    expect(out.queued).toBe(false);
    expect(out.reason).toBe('month_finalized');
    expect(jobs(db, 'leave_recalc')).toHaveLength(0);

    const flag = db.prepare('SELECT * FROM leave_change_flags WHERE id = ?').get(out.flagId);
    expect(flag.month).toBe(MONTH);
    expect(flag.year).toBe(YEAR);
    expect(flag.employee_code).toBe('E9');
    expect(flag.reason).toBe('leave_approved');
    expect(flag.cleared_at).toBeNull();
    db.close();
  });

  test('automation off records skipped_disabled and queues nothing', () => {
    const db = newDb({ automation: false });
    const out = queueLeaveRecalc(db, { company: CO, month: MONTH, year: YEAR, reason: 'leave_approved', actor: 'hr1' });
    expect(out.queued).toBe(false);
    expect(out.reason).toBe('automation_disabled');
    expect(jobs(db, 'leave_recalc')).toHaveLength(0);
    const run = db.prepare('SELECT * FROM leave_recompute_runs WHERE id = ?').get(out.runId);
    expect(run.status).toBe('skipped_disabled');
    expect(run.scope).toBe('trigger');
    db.close();
  });

  test('isMonthFinalized reads monthly_imports', () => {
    const db = newDb();
    expect(isMonthFinalized(db, CO, MONTH, YEAR)).toBe(false);
    addImport(db, { is_finalised: 1 });
    expect(isMonthFinalized(db, CO, MONTH, YEAR)).toBe(true);
    expect(isMonthFinalized(db, CO, 4, YEAR)).toBe(false);
    db.close();
  });
});

describe('safeTrigger', () => {
  test('a throwing trigger does not break its caller', () => {
    const boom = () => { throw new Error('database is on fire'); };
    let out;
    expect(() => { out = safeTrigger('test', boom); }).not.toThrow();
    expect(out.error).toBe('database is on fire');
  });

  test('a working trigger returns its value', () => {
    expect(safeTrigger('test', () => ({ ok: 1 }))).toEqual({ ok: 1 });
  });
});

describe('checkAutoStage6 (ruling 6)', () => {
  const setup = (over = {}) => {
    const db = newDb();
    addImport(db, over);
    const e = F.addEmployee(db, { code: 'M001', company: CO });
    return { db, e };
  };

  test('does not fire while HR still has miss punches to resolve', () => {
    const { db, e } = setup();
    addMissPunch(db, e, '2026-03-05', { resolved: 0 });
    const out = checkAutoStage6(db, CO, MONTH, YEAR);
    expect(out.fired).toBe(false);
    expect(out.reason).toBe('miss_punches_outstanding');
    expect(out.backlog).toEqual({ awaitingHr: 1, awaitingFinance: 0, total: 1 });
    expect(jobs(db, 'day_calculate')).toHaveLength(0);
    db.close();
  });

  test('does not fire while finance has yet to decide an HR-resolved punch', () => {
    const { db, e } = setup();
    addMissPunch(db, e, '2026-03-05', { resolved: 1, finance: 'pending' });
    const out = checkAutoStage6(db, CO, MONTH, YEAR);
    expect(out.fired).toBe(false);
    expect(out.backlog).toEqual({ awaitingHr: 0, awaitingFinance: 1, total: 1 });
    db.close();
  });

  test('a NULL or blank finance status also counts as undecided', () => {
    for (const finance of [null, '']) {
      const { db, e } = setup();
      addMissPunch(db, e, '2026-03-05', { resolved: 1, finance });
      expect(checkAutoStage6(db, CO, MONTH, YEAR).fired).toBe(false);
      db.close();
    }
  });

  test('fires once both counters reach zero, and stamps the time', () => {
    const { db, e } = setup();
    addMissPunch(db, e, '2026-03-05', { resolved: 1, finance: 'approved' });
    addMissPunch(db, e, '2026-03-06', { resolved: 1, finance: 'rejected' });

    const out = checkAutoStage6(db, CO, MONTH, YEAR, { actor: 'finance1' });
    expect(out.fired).toBe(true);
    expect(jobs(db, 'day_calculate')).toHaveLength(1);
    expect(jobs(db, 'leave_recalc')).toHaveLength(1);
    // Stage 6 runs in the day_calculate job, so the leave job must not redo it.
    expect(params(jobs(db, 'leave_recalc')[0]).skipDays).toBe(true);

    const mi = db.prepare('SELECT stage_6_auto_at FROM monthly_imports WHERE month=? AND year=?').get(MONTH, YEAR);
    expect(mi.stage_6_auto_at).toBeTruthy();
    expect(db.prepare("SELECT COUNT(*) c FROM notifications WHERE type='AUTO_STAGE6_QUEUED'").get().c).toBe(1);
    db.close();
  });

  test('only the first run is automatic', () => {
    const { db, e } = setup({ stage_6_done: 1 });
    addMissPunch(db, e, '2026-03-05', { resolved: 1, finance: 'approved' });
    const out = checkAutoStage6(db, CO, MONTH, YEAR);
    expect(out.fired).toBe(false);
    expect(out.reason).toBe('stage_6_already_done');
    db.close();
  });

  test('a finalized month never fires', () => {
    const { db, e } = setup({ is_finalised: 1 });
    addMissPunch(db, e, '2026-03-05', { resolved: 1, finance: 'approved' });
    expect(checkAutoStage6(db, CO, MONTH, YEAR).reason).toBe('month_finalized');
    db.close();
  });

  test('the switch turns it off', () => {
    const { db, e } = setup();
    F.setPolicy(db, 'leave_auto_stage6_enabled', 'false');
    addMissPunch(db, e, '2026-03-05', { resolved: 1, finance: 'approved' });
    expect(checkAutoStage6(db, CO, MONTH, YEAR).reason).toBe('auto_stage6_disabled');
    db.close();
  });

  test('no import for the period means nothing to run', () => {
    const db = newDb();
    expect(checkAutoStage6(db, CO, MONTH, YEAR).reason).toBe('no_import');
    db.close();
  });

  test('autoStage6Status reports what the screens show', () => {
    const { db, e } = setup();
    addMissPunch(db, e, '2026-03-05', { resolved: 0 });
    addMissPunch(db, e, '2026-03-06', { resolved: 1, finance: 'pending' });
    const s = autoStage6Status(db, CO, MONTH, YEAR);
    expect(s).toMatchObject({
      enabled: true, hasImport: true, stageSixDone: false, finalized: false,
      awaitingHr: 1, awaitingFinance: 1, autoRanAt: null,
    });
    expect(missPunchBacklog(db, CO, MONTH, YEAR).total).toBe(2);
    db.close();
  });
});
