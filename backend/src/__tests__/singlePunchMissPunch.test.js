/**
 * Single-punch days become miss punches (owner ruling 16 Oct 2026).
 * EESL marks a day with ONE punch "A" (a lone evening check-out is read as a late check-in).
 * From 1 Oct 2026 such a day is raised as a miss punch; resolving it with times makes it a worked day.
 * Synthetic codes only (SP…).
 */
const { newDb, setPolicy } = require('./helpers/leaveFixture');

let mockDb = null;
jest.mock('../database/db', () => ({
  getDb: () => mockDb,
  logAudit: (table, id, field, oldV, newV, stage, remark) => {
    mockDb.prepare(`INSERT INTO audit_log (table_name, record_id, field_name, old_value, new_value, stage, remark)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(table, id, field, oldV == null ? null : String(oldV), newV == null ? null : String(newV), stage, remark);
  },
}));

const { detectMissPunches, applyMissPunchFlags, resolveMissPunch } = require('../services/missPunch');
const { effectiveStatusForDay } = require('../services/dayCalculation');

const TODAY = '2026-10-16';

function emp(db, code, shift = '12HR') {
  const s = db.prepare('SELECT id FROM shifts WHERE code = ?').get(shift);
  db.prepare(`INSERT INTO employees (code, name, department, company, employment_type, status, date_of_joining, default_shift_id, shift_code)
    VALUES (?, ?, 'OPR', 'Asian Lakto Ind Ltd', 'Permanent', 'Active', '2025-01-02', ?, ?)`).run(code, `Test ${code}`, s ? s.id : null, shift);
}
/** One processed row as EESL sends it (status_original = status_final). */
function row(db, code, date, st, it = null, ot = null, extra = {}) {
  return db.prepare(`INSERT INTO attendance_processed (employee_code, date, status_original, status_final,
      in_time_original, in_time_final, out_time_original, out_time_final, is_night_shift, is_night_out_only, night_pair_date,
      month, year, company)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Asian Lakto Ind Ltd')`)
    .run(code, date, st, extra.final || st, it, it, ot, ot, extra.night || 0, extra.outOnly || 0, extra.pair || null,
      Number(date.slice(5, 7)), Number(date.slice(0, 4))).lastInsertRowid;
}
const all = (db) => db.prepare('SELECT * FROM attendance_processed ORDER BY employee_code, date').all();
const get = (db, id) => db.prepare('SELECT * FROM attendance_processed WHERE id = ?').get(id);
const detect = (db, opts = {}) => detectMissPunches(all(db), { today: TODAY, ...opts });
const types = (list) => Object.fromEntries(list.map((m) => [`${m.employee_code}|${m.date}`, m.issue_type]));

describe('detection', () => {
  beforeEach(() => { mockDb = newDb(); });

  test("23675's September pattern on an October date: lone evening punch, next morning worked → Missing IN", () => {
    emp(mockDb, 'SP1');
    row(mockDb, 'SP1', '2026-10-06', 'P', '08:00', '20:00');
    row(mockDb, 'SP1', '2026-10-07', 'A', '19:22', null, { night: 1 }); // EESL: 38 min → A, app read it as a night IN
    row(mockDb, 'SP1', '2026-10-08', 'P', '08:02', '20:01');
    expect(types(detect(mockDb))).toEqual({ 'SP1|2026-10-07': 'MISSING_IN' });
  });

  test('the same pattern in September is left alone (no clean-up of past months)', () => {
    emp(mockDb, 'SP2');
    row(mockDb, 'SP2', '2026-09-02', 'A', '19:22', null, { night: 1 });
    row(mockDb, 'SP2', '2026-09-03', 'P', '08:02', '20:00');
    expect(detect(mockDb)).toEqual([]);
  });

  test('lone morning punch on an absent day → Missing OUT', () => {
    emp(mockDb, 'SP3');
    row(mockDb, 'SP3', '2026-10-09', 'A', '08:05', null);
    row(mockDb, 'SP3', '2026-10-10', 'P', '08:00', '20:00');
    expect(types(detect(mockDb))).toEqual({ 'SP3|2026-10-09': 'MISSING_OUT' });
  });

  test('lone OUT time only → Missing IN; weekly off with one punch is raised too', () => {
    emp(mockDb, 'SP4');
    row(mockDb, 'SP4', '2026-10-05', 'A', null, '19:40');
    row(mockDb, 'SP4', '2026-10-11', 'WO', '08:10', null); // Sunday
    expect(types(detect(mockDb))).toEqual({ 'SP4|2026-10-05': 'MISSING_IN', 'SP4|2026-10-11': 'MISSING_OUT' });
  });

  test('not raised: no punch at all, both punches, HR re-labelled, part of a night pair', () => {
    emp(mockDb, 'SP5');
    row(mockDb, 'SP5', '2026-10-05', 'A');                                  // no punch — real absence
    row(mockDb, 'SP5', '2026-10-06', 'A', '08:00', '09:00');                // both punches (short day)
    row(mockDb, 'SP5', '2026-10-07', 'P', '08:02', null, { final: 'A' });   // HR marked absent
    row(mockDb, 'SP5', '2026-10-08', 'A', '20:00', null, { night: 1, pair: '2026-10-09' }); // paired night IN
    row(mockDb, 'SP5', '2026-10-09', 'A', null, '08:00', { outOnly: 1 });   // night OUT-only half
    row(mockDb, 'SP5', '2026-10-10', 'P', '08:00', '20:00');
    const out = types(detect(mockDb));
    expect(out['SP5|2026-10-05']).toBeUndefined();
    expect(out['SP5|2026-10-06']).toBeUndefined();
    expect(out['SP5|2026-10-07']).toBeUndefined();
    expect(out['SP5|2026-10-08']).toBeUndefined();
    expect(out['SP5|2026-10-09']).toBeUndefined();
  });

  test('an open day is not a miss punch until the next day is in (or two days pass)', () => {
    emp(mockDb, 'SP6');
    row(mockDb, 'SP6', '2026-10-15', 'A', '19:50', null, { night: 1 }); // yesterday, no 16 Oct row yet
    expect(detect(mockDb)).toEqual([]);
    expect(types(detect(mockDb, { today: '2026-10-17' }))).toEqual({ 'SP6|2026-10-15': 'MISSING_IN' });
    row(mockDb, 'SP6', '2026-10-16', 'A', '08:00', null);               // next day has a punch (itself still open today)
    expect(types(detect(mockDb))).toEqual({ 'SP6|2026-10-15': 'MISSING_IN' });
  });

  test("a month's last day is closed once the month is over", () => {
    emp(mockDb, 'SP7');
    row(mockDb, 'SP7', '2026-10-31', 'A', '19:30', null);
    expect(detect(mockDb, { today: '2026-10-31' })).toEqual([]);
    expect(types(detect(mockDb, { today: '2026-11-01' }))).toEqual({ 'SP7|2026-10-31': 'MISSING_IN' });
  });

  test('existing rules are unchanged (present-status rows)', () => {
    emp(mockDb, 'SP8');
    row(mockDb, 'SP8', '2026-09-10', 'P', '08:00', null);
    row(mockDb, 'SP8', '2026-09-11', 'P', null, '20:00');
    row(mockDb, 'SP8', '2026-09-12', 'P');
    row(mockDb, 'SP8', '2026-09-13', 'WOP', '20:10', null);
    row(mockDb, 'SP8', '2026-09-14', 'P', '08:00', '20:00');
    expect(types(detect(mockDb))).toEqual({
      'SP8|2026-09-10': 'MISSING_OUT', 'SP8|2026-09-11': 'MISSING_IN', 'SP8|2026-09-12': 'NO_PUNCH', 'SP8|2026-09-13': 'NIGHT_UNPAIRED',
    });
    // byte-for-byte the same list with the new rule switched off
    expect(detect(mockDb)).toEqual(detect(mockDb, { singlePunchFrom: null }));
  });

  test("policy 'off' turns the rule off; a date moves the start", () => {
    emp(mockDb, 'SP9');
    row(mockDb, 'SP9', '2026-10-07', 'A', '19:22', null);
    row(mockDb, 'SP9', '2026-10-08', 'P', '08:00', '20:00');
    setPolicy(mockDb, 'single_punch_miss_punch_from', 'off');
    expect(detectMissPunches(all(mockDb), { today: TODAY })).toEqual([]);
    setPolicy(mockDb, 'single_punch_miss_punch_from', '2026-10-08');
    expect(detectMissPunches(all(mockDb), { today: TODAY })).toEqual([]);
    setPolicy(mockDb, 'single_punch_miss_punch_from', '2026-10-01');
    expect(detectMissPunches(all(mockDb), { today: TODAY })).toHaveLength(1);
  });
});

describe('resolving a single-punch day', () => {
  let id;
  beforeEach(() => {
    mockDb = newDb();
    emp(mockDb, 'SR1');
    id = row(mockDb, 'SR1', '2026-10-07', 'A', '19:22', null, { night: 1 });
    row(mockDb, 'SR1', '2026-10-08', 'P', '08:02', '20:01');
    applyMissPunchFlags(mockDb, detect(mockDb));
  });

  test('flagged and on the Miss Punch list shape', () => {
    expect(get(mockDb, id)).toMatchObject({ is_miss_punch: 1, miss_punch_type: 'MISSING_IN', status_final: 'A' });
  });

  test('HR enters IN 08:00 / OUT 19:22 → P, audited; Stage 6 waits for finance, then counts it present', () => {
    resolveMissPunch(mockDb, id, { inTime: '08:00', outTime: '19:22', source: 'Gate Register', remark: 'gate book' });
    const r = get(mockDb, id);
    expect(r).toMatchObject({ status_final: 'P', in_time_final: '08:00', out_time_final: '19:22', miss_punch_resolved: 1, miss_punch_finance_status: 'pending', is_night_shift: 0 });
    expect(effectiveStatusForDay(r)).toBe('A'); // finance has not approved yet
    mockDb.prepare("UPDATE attendance_processed SET miss_punch_finance_status = 'approved' WHERE id = ?").run(id);
    expect(effectiveStatusForDay(get(mockDb, id))).toBe('P');
    const a = mockDb.prepare("SELECT * FROM audit_log WHERE record_id = ? AND field_name = 'status_final'").get(id);
    expect(a).toMatchObject({ old_value: 'A', new_value: 'P', stage: 'Stage 2' });
  });

  test('short hours → ½P; very short → status left alone', () => {
    resolveMissPunch(mockDb, id, { inTime: '13:30', outTime: '19:22', source: 'Gate Register', remark: '' });
    expect(get(mockDb, id).status_final).toBe('½P');
    mockDb.prepare("UPDATE attendance_processed SET status_final = 'A' WHERE id = ?").run(id);
    resolveMissPunch(mockDb, id, { inTime: '17:30', outTime: '19:22', source: 'Gate Register', remark: '' });
    expect(get(mockDb, id).status_final).toBe('A');
  });

  test('"mark absent" (convert) still keeps the day absent', () => {
    resolveMissPunch(mockDb, id, { source: 'Gate Register', remark: 'not in', convertToLeave: true });
    expect(get(mockDb, id).status_final).toBe('A');
  });

  test('weekly-off single punch resolved → WOP', () => {
    const wo = row(mockDb, 'SR1', '2026-10-11', 'WO', '08:10', null);
    row(mockDb, 'SR1', '2026-10-12', 'P', '08:00', '20:00');
    applyMissPunchFlags(mockDb, detect(mockDb));
    resolveMissPunch(mockDb, wo, { inTime: '08:10', outTime: '19:55', source: 'Gate Register', remark: '' });
    expect(get(mockDb, wo).status_final).toBe('WOP');
  });

  test('an ordinary present-day miss punch resolves exactly as before (status untouched)', () => {
    const p = row(mockDb, 'SR1', '2026-09-21', 'P', '08:02', null);
    row(mockDb, 'SR1', '2026-09-22', 'P', '08:00', '20:00');
    applyMissPunchFlags(mockDb, detect(mockDb));
    expect(get(mockDb, p)).toMatchObject({ is_miss_punch: 1, miss_punch_type: 'MISSING_OUT' });
    resolveMissPunch(mockDb, p, { inTime: '08:02', outTime: '20:00', source: 'Gate Register', remark: '' });
    expect(get(mockDb, p).status_final).toBe('P');
    expect(mockDb.prepare("SELECT COUNT(*) n FROM audit_log WHERE record_id = ? AND field_name = 'status_final'").get(p).n).toBe(0);
  });
});
