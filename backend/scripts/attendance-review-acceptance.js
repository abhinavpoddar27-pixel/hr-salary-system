#!/usr/bin/env node
/**
 * Attendance Review — acceptance check against a PRIVATE fixture (never commit the fixture or the config with codes).
 *
 * Mode A (database file):
 *   node scripts/attendance-review-acceptance.js db <snapshot.db> <config.json> <fixture.json> [--release 2026-09-03,2026-09-25]
 * Mode B (rows pulled through the read-only SQL Console — no database file needed):
 *   node scripts/attendance-review-acceptance.js print-sql <month> <year> <config.json> [--release …]   → SQL to paste into the console
 *   node scripts/attendance-review-acceptance.js rows <rows.txt> <remeasure-days.txt> <config.json> <fixture.json> [--release …]
 *     rows.txt: one line per person-month, '|' separated, columns ROW_COLS below (output of the first printed query)
 *     remeasure-days.txt: c|d|st|mp|it|ot|ll per day for the re-measured codes (output of the second printed query)
 *
 * Expected differences are read from fixture.known_differences (code list) and reported, not failed.
 * Prints PASS/FAIL per list; exit code 1 on any unexpected difference.
 */
const fs = require('fs');
const path = require('path');
const S = require(path.join(__dirname, '..', 'src', 'services', 'attendanceReviewService'));

const SQL_COLS = ['code', 'ym', 'worked_days', 'worked_units', 'sched_min', 'shift_h', 'shift_h_missing', 'late_raw', 'late_excused', 'lates', 'late_min',
  'early_exits', 'early_min', 'early_long', 'ms_days', 'early_short', 'early_short_min', 'early_short_long', 'early_wm_sum', 'late_full_excused'];
const ROW_COLS = [...SQL_COLS, 'department', 'designation', 'is_contractor', 'employment_type'];
const NUM = new Set(SQL_COLS.slice(2).concat(['is_contractor']));

function arg(name) { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; }
const release = (arg('--release') || '').split(',').filter(Boolean);
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

function printSql(month, year, cfgPath) {
  const cfg = S.mergeConfig(readJson(cfgPath));
  const p = S.sqlParams(month, year, cfg, release, []);
  const inner = S.inlineParams(S.PERSON_MONTH_SQL, p);
  const cols = SQL_COLS.map((c) => `COALESCE(q.${c},'')`).join("||'|'||");
  console.log('-- 1) person-month rows (page with LIMIT/OFFSET if needed)');
  console.log(`SELECT ${cols}||'|'||COALESCE(REPLACE(e.department,'|','/'),'')||'|'||COALESCE(REPLACE(e.designation,'|','/'),'')||'|'||COALESCE(e.is_contractor,0)||'|'||COALESCE(e.employment_type,'') AS r
FROM (${inner.trim()}) q LEFT JOIN employees e ON e.id = (SELECT MIN(id) FROM employees WHERE code = q.code) ORDER BY q.code, q.ym;`);
  const codes = Object.keys(cfg.remeasure);
  if (codes.length) {
    console.log('\n-- 2) daily rows for re-measured codes');
    console.log(`SELECT employee_code||'|'||date||'|'||status_final||'|'||COALESCE(is_miss_punch,0)||'|'||COALESCE(in_time_final,'')||'|'||COALESCE(out_time_final,'')||'|'||COALESCE(is_left_late,0) AS r
FROM attendance_processed WHERE employee_code IN (${codes.map((c) => `'${c}'`).join(',')}) AND date BETWEEN '${p.from}' AND '${p.to}' ORDER BY employee_code, date;`);
  }
}

function parseRows(file) {
  return fs.readFileSync(file, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#') && l !== 'r').map((l) => {
    const v = l.split('|'); const o = {};
    ROW_COLS.forEach((c, i) => { o[c] = NUM.has(c) ? Number(v[i] || 0) : (v[i] || ''); });
    o.code = String(o.code); return o;
  });
}

/** Re-measure from pasted daily rows: load them into an in-memory table the engine can read. */
function remeasureFromFile(file, month, year, cfg) {
  const Database = require('better-sqlite3');
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE attendance_processed (employee_code TEXT, date TEXT, status_final TEXT, is_miss_punch INTEGER, in_time_final TEXT, out_time_final TEXT, is_left_late INTEGER)`);
  const ins = db.prepare('INSERT INTO attendance_processed VALUES (?, ?, ?, ?, ?, ?, ?)');
  if (file && fs.existsSync(file)) {
    for (const l of fs.readFileSync(file, 'utf8').split(/\r?\n/).map((x) => x.trim()).filter((x) => x && x !== 'r' && !x.startsWith('#'))) {
      const [c, d, st, mp, it, ot, ll] = l.split('|'); ins.run(c, d, st, Number(mp), it || null, ot || null, Number(ll));
    }
  }
  return S.remeasureRows(db, month, year, cfg, release, []);
}

function fromRows(rowsFile, remFile, cfgPath, fixturePath) {
  const fixture = readJson(fixturePath);
  const [year, month] = fixture.month.split('-').map(Number);
  const cfg = S.mergeConfig(readJson(cfgPath));
  const rows = parseRows(rowsFile);
  const empMap = new Map();
  for (const r of rows) if (!empMap.has(r.code)) empMap.set(r.code, { department: r.department, designation: r.designation, is_contractor: r.is_contractor, employment_type: r.employment_type, gross_salary: 0 });
  const rem = remeasureFromFile(remFile, month, year, cfg);
  const pm = S.prevMonth(month, year);
  const ym = `${year}-${String(month).padStart(2, '0')}`; const prev = `${pm.year}-${String(pm.month).padStart(2, '0')}`;
  const byCode = S.buildPeople(rows, rem, empMap, cfg, ym, prev);
  const { kept } = S.applyExclusions(byCode, cfg);
  S.classify(kept, cfg);
  const act = S.actions(kept, cfg, [], month, year);
  const nt = S.notices(kept, cfg);
  return compare(fixture, { actionList: act.actionList, earlyExitWarnings: act.earlyExitWarnings, noticeLate: nt.noticeLate, noticeEarly: nt.noticeEarly });
}

function fromDb(dbPath, cfgPath, fixturePath) {
  const Database = require('better-sqlite3');
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  const fixture = readJson(fixturePath);
  const [year, month] = fixture.month.split('-').map(Number);
  const r = S.computeAttendanceReview(db, { month, year, config: readJson(cfgPath), releaseDays: release, prevReleaseDays: [] });
  return compare(fixture, r);
}

function compare(fx, r) {
  const known = new Set((fx.known_differences || []).map(String));
  let unexpected = 0;
  const report = (label, got, want, key) => {
    const g = new Map(got.map((x) => [String(x.code), x])); const w = new Map(want.map((x) => [String(x.code), x]));
    const missing = [...w.keys()].filter((c) => !g.has(c)); const extra = [...g.keys()].filter((c) => !w.has(c));
    const changed = [...w.keys()].filter((c) => g.has(c) && key.some((k) => k.cmp(g.get(c)) !== k.want(w.get(c))))
      .map((c) => `${c} (${key.map((k) => `${k.name} ${k.cmp(g.get(c))} vs ${k.want(w.get(c))}`).join(', ')})`);
    const bad = [...missing, ...extra].filter((c) => !known.has(c)).length + changed.filter((s) => !known.has(s.split(' ')[0])).length;
    unexpected += bad;
    console.log(`${bad ? 'FAIL' : 'PASS'}  ${label}: got ${got.length}, fixture ${want.length}`
      + (missing.length ? ` | missing ${missing.map((c) => (known.has(c) ? `${c}*` : c)).join(' ')}` : '')
      + (extra.length ? ` | extra ${extra.map((c) => (known.has(c) ? `${c}*` : c)).join(' ')}` : '')
      + (changed.length ? ` | changed ${changed.join('; ')}` : ''));
  };
  report('Action list', r.actionList, fx.action_list, [
    { name: 'action', cmp: (g) => (g.action === 'deduction' ? 'Deduction note' : 'Warning note'), want: (w) => w.action },
    { name: 'days', cmp: (g) => g.deduction_days, want: (w) => w.deduction_days }]);
  report('Early-exit warnings', r.earlyExitWarnings, fx.early_exit_warnings, [
    { name: 'exits', cmp: (g) => g.early_exits, want: (w) => w.early_exits }, { name: 'optC', cmp: (g) => g.option_c_days, want: (w) => w.option_c_days }]);
  report('Late notice', r.noticeLate, fx.notice_late_comers, [{ name: 'late', cmp: (g) => g.late_days, want: (w) => w.late_days }]);
  report('Early notice', r.noticeEarly, fx.notice_early_leavers, [{ name: 'early', cmp: (g) => g.early_exits, want: (w) => w.early_exits }]);
  const ded = r.actionList.filter((a) => a.action === 'deduction');
  console.log(`Totals: ${r.actionList.length} people, ${ded.length} deductions, ${ded.reduce((s, a) => s + a.deduction_days, 0)} days`
    + ` (fixture ${fx.action_totals.people} / ${fx.action_totals.deduction_notes} / ${fx.action_totals.deduction_days})`);
  if (known.size) console.log(`* = documented known difference (${[...known].join(', ')})`);
  console.log(unexpected ? `RESULT: FAIL (${unexpected} unexpected)` : 'RESULT: PASS');
  return unexpected;
}

const [mode, a1, a2, a3, a4] = process.argv.slice(2);
let code = 0;
if (mode === 'print-sql') printSql(Number(a1), Number(a2), a3);
else if (mode === 'rows') code = fromRows(a1, a2, a3, a4) ? 1 : 0;
else if (mode === 'db') code = fromDb(a1, a2, a3) ? 1 : 0;
else { console.error('usage: see header of scripts/attendance-review-acceptance.js'); code = 2; }
process.exit(code);
