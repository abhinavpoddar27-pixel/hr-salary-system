#!/usr/bin/env python3
"""
Wide-layout screenshot harness — renders 9 pages at 3 viewports so a layout change
can be compared before / after. Read-only with respect to app code; SCRATCH DATABASE ONLY.

  python3 backend/scripts/wide-layout-render.py <repo_root_to_serve> <out_dir>

  * Boots <repo_root>/backend/server.js with NODE_ENV=production on a fresh temp DATA_DIR
    (never a real DB), so it serves <repo_root>/frontend/dist. Port: $RENDER_PORT, else
    $PORT, else the first free port from 3997.
  * Seeds fictional data for September 2026 (64 plant employees, 8 departments, both
    companies, attendance, miss punches, night pairs, leave, OD, advances, late / early-exit
    deductions, ED grants, salary change requests, loans through the real loan engine) and
    then runs the REAL Stage 6 + Stage 7 (services/recompute.js) so the register is
    internally consistent. Also seeds 1-10 Oct 2026 attendance for Daily MIS (today).
  * Logs in ONCE (admin) and reuses the storage state for every viewport.
  * Screens: <slug>__<width>__viewport.png / __full.png for 2560x1440, 1440x900, 390x844.
    Stage 7 also: __register-right.png (register scrolled to its right edge) and
    __row-expanded.png (first row clicked).
  * <out_dir>/report.json: per page — page errors, console errors, API responses >= 400,
    document / <main> horizontal overflow, bounding boxes of main / page root / content wrapper.
  * Exit 0 only if every page rendered rows at every viewport and there were no page errors.
  * The server is always killed on exit and the temp DATA_DIR removed.

Needs Python Playwright + Chromium (PLAYWRIGHT_BROWSERS_PATH, default /opt/pw-browsers).
"""
import atexit
import json
import os
import shutil
import signal
import socket
import sqlite3
import subprocess
import sys
import tempfile
import time
import urllib.request
from datetime import datetime, timezone

os.environ.setdefault('PLAYWRIGHT_BROWSERS_PATH', '/opt/pw-browsers')
from playwright.sync_api import sync_playwright  # noqa: E402

VIEWPORTS = [(2560, 1440), (1440, 900), (390, 844)]
MONTH, YEAR = 9, 2026
ADMIN_USER, ADMIN_PASS = 'admin', 'Admin@123'

# slug, path (LOAN_ID filled in after seeding), row selector that proves content
PAGES = [
    ('stage7-salary', '/pipeline/salary', 'table:has(th:has-text("Take Home")) tbody tr'),
    ('miss-punch', '/pipeline/miss-punch', 'table tbody tr'),
    ('shift-check', '/pipeline/shift-check', 'table tbody tr'),
    ('night-shift', '/pipeline/night-shift', 'table tbody tr'),
    ('daily-mis', '/daily-mis', 'table tbody tr'),
    ('salary-input', '/salary-input', 'table tbody tr'),
    ('salary-advance', '/salary-advance', 'table tbody tr'),
    ('loans', '/loans?tab=loans', '[data-testid="loan-list"] tbody tr'),
    ('loan-detail', '/loans/{LOAN_ID}', '[data-testid="schedule"] tbody tr'),
]

SERVER = {'proc': None, 'work': None}


def free_port():
    for env in ('RENDER_PORT', 'PORT'):
        if os.environ.get(env):
            return int(os.environ[env])
    for p in range(3997, 4100):
        with socket.socket() as s:
            try:
                s.bind(('127.0.0.1', p))
                return p
            except OSError:
                continue
    raise SystemExit('no free port')


def stop_server():
    proc = SERVER.get('proc')
    if proc and proc.poll() is None:
        try:
            os.killpg(proc.pid, signal.SIGTERM)
            proc.wait(timeout=10)
        except Exception:
            try:
                os.killpg(proc.pid, signal.SIGKILL)
            except Exception:
                pass
    SERVER['proc'] = None
    if SERVER.get('work'):
        shutil.rmtree(SERVER['work'], ignore_errors=True)
        SERVER['work'] = None


atexit.register(stop_server)
for _sig in (signal.SIGINT, signal.SIGTERM):
    signal.signal(_sig, lambda *_: (stop_server(), sys.exit(130)))


# ── Seed (runs in node against the scratch DB, after the server ran its migrations) ──

SEED_JS = r"""
// Scratch DB only. argv: ROOT DB_PATH. Fictional people. Deterministic (seeded PRNG).
const [ROOT, DB] = process.argv.slice(2);
const Database = require(`${ROOT}/backend/node_modules/better-sqlite3`);
const db = new Database(DB);
db.pragma('busy_timeout = 15000');
// salaryComputation's logAudit() opens a SECOND connection through getDb(); inside the
// Stage 7 transaction that would wait on our own write lock. Audit rows are irrelevant here.
require(`${ROOT}/backend/src/database/db`).logAudit = () => {};
const L = require(`${ROOT}/backend/src/services/loans`);
const { recomputeDays, recomputeSalary } = require(`${ROOT}/backend/src/services/recompute`);
const quiet = (fn) => { const o = [console.log, console.warn, console.error]; console.log = console.warn = console.error = () => {}; try { return fn(); } finally { [console.log, console.warn, console.error] = o; } };

let seed = 20260910;
const rnd = () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const pad = (n) => String(n).padStart(2, '0');
const IND = 'Indriyan Beverages Pvt Ltd', ASL = 'Asian Lakto Ind Ltd', YEAR = 2026;
const DEPTS = ['PRODUCTION', 'PACKING', 'QUALITY CONTROL', 'STORES & LOGISTICS', 'MAINTENANCE', 'ADMIN & ACCOUNTS',
  'PET BOTTLING LINE 3 - BLOW MOULDING & FILLING', 'UTILITY (BOILER, COMPRESSOR & RO PLANT)'];
const FIRST = ['Arjun', 'Baldev', 'Charan', 'Daljeet', 'Ekam', 'Fateh', 'Gagan', 'Harleen', 'Inderjit', 'Jasleen', 'Kamal', 'Lovepreet',
  'Manjot', 'Navneet', 'Onkar', 'Parminder', 'Rajbir', 'Simran', 'Tejinder', 'Ujjwal', 'Vikram', 'Waryam', 'Yashpal', 'Zorawar'];
const LAST = ['Sandhu', 'Gill', 'Brar', 'Dhillon', 'Grewal', 'Sidhu', 'Bains', 'Cheema', 'Virk', 'Mann', 'Sekhon', 'Bajwa', 'Kaur', 'Sharma', 'Verma'];
const LONG = ['Sukhwinderpal Singh Randhawa-Grewal', 'Harpreet Kaur Dhaliwal Sekhon Bajwa', 'Mohinderjeet Singh Kahlon Aulakh', 'Ravinderpal Kaur Chahal Pannu Sohal'];
const SHIFT = { '12HR': 4, '10HR': 5, '9HR': 6, 'NIGHT': 2 };

// ── employees ──
const emps = [];
for (let i = 0; i < 64; i++) {
  const code = String(7101 + i);
  const company = i % 3 === 2 ? ASL : IND;
  const dept = DEPTS[i % 8];
  const name = i < 4 ? LONG[i] : `${pick(FIRST)} ${pick(LAST)}`;
  let type = 'Permanent';
  if (i % 9 === 5) type = 'Contract'; else if (i % 11 === 3) type = 'Worker'; else if (i % 13 === 7) type = 'SILP';
  const gross = [12500, 14800, 16200, 18000, 19500, 20800, 22000, 24000, 26500, 31000, 38000, 46000][Math.floor(rnd() * 12)];
  const doj = [40, 41, 42].includes(i) ? `2026-09-${pad([8, 15, 21][i - 40])}` : `${2019 + Math.floor(rnd() * 6)}-${pad(1 + Math.floor(rnd() * 12))}-${pad(1 + Math.floor(rnd() * 27))}`;
  const shift = i % 16 === 9 ? 'NIGHT' : pick(['12HR', '12HR', '10HR', '9HR']);
  emps.push({ i, code, company, dept, name, type, gross, doj, shift,
    pf: i % 10 === 1 ? 1 : 0, esi: (gross <= 21000 && i % 3 !== 1) ? 1 : 0, lwf: i % 2,
    returned: [11, 27, 50].includes(i) ? 1 : 0, bank: [17, 33, 49, 58].includes(i) ? '' : `50100${code}88${i}` });
}
const insEmp = db.prepare(`INSERT INTO employees (code, name, department, designation, company, status, employment_type, is_contractor,
  gross_salary, date_of_joining, default_shift_id, shift_code, weekly_off_day, account_number, bank_account, ifsc, bank_name, was_left_returned)
  VALUES (?, ?, ?, ?, ?, 'Active', ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`);
const insStruct = db.prepare(`INSERT INTO salary_structures (employee_id, effective_from, gross_salary, basic, da, hra, conveyance, other_allowances,
  basic_percent, hra_percent, da_percent, pf_applicable, esi_applicable, lwf_applicable, pt_applicable, pf_wage_ceiling)
  VALUES (?, '2025-01-01', ?, ?, 0, ?, ?, ?, 50, 20, 0, ?, ?, ?, 0, 15000)`);
db.transaction(() => {
  for (const e of emps) {
    const r = insEmp.run(e.code, e.name, e.dept, pick(['Operator', 'Helper', 'Supervisor', 'Technician', 'Executive', 'Senior Machine Operator']),
      e.company, e.type, e.type === 'Contract' ? 1 : 0, e.gross, e.doj, SHIFT[e.shift], e.shift, e.bank, e.bank,
      e.bank ? 'PUNB0123400' : '', e.bank ? 'Punjab National Bank' : '', e.returned);
    e.id = r.lastInsertRowid;
    const basic = Math.round(e.gross * 0.5), hra = Math.round(e.gross * 0.2), conv = 1600;
    insStruct.run(e.id, e.gross, basic, hra, conv, e.gross - basic - hra - conv, e.pf, e.esi, e.lwf);
  }
})();

// ── attendance: September (Stage 6 input) and 1-10 October (Daily MIS) ──
const insAtt = db.prepare(`INSERT INTO attendance_processed (employee_id, employee_code, date, status_original, status_final,
  in_time_original, out_time_original, in_time_final, out_time_final, actual_hours, shift_id, shift_detected, is_night_shift,
  is_late_arrival, late_by_minutes, is_early_departure, early_by_minutes, is_overtime, overtime_minutes,
  is_miss_punch, miss_punch_type, miss_punch_resolved, miss_punch_finance_status, correction_remark,
  is_left_late, left_late_minutes, month, year, company, stage_2_done, stage_3_done, stage_4_done, stage_5_done)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, 1, 1)`);
const dow = (d) => new Date(d + 'T12:00:00').getDay();
// Absence plan for September (day numbers) and its purpose.
const plan = {};
const absent = (i, days) => { plan[i] = (plan[i] || []).concat(days); };
absent(6, [10, 11]); absent(14, [16, 17]); absent(22, [8]); absent(30, [23, 24, 25]); absent(38, [2, 3]); // CL / EL / LWP targets
absent(46, [14]); absent(54, [29]); absent(62, [9, 10]); absent(7, [18]); absent(15, [22]); absent(23, [11]);
absent(31, [3]); absent(39, [15]); absent(47, [7]); absent(55, [24]); absent(63, [1]);
const heldLow = [19, 35, 44], heldStreak = [21, 37], streakLeave = [29], released = [44];
const wopEmps = [0, 8, 16, 24, 32, 48, 56, 60];
const halfDays = { 12: [9], 20: [16, 17], 28: [23], 36: [5], 52: [25] };
const nightIns = [];
const mpCandidates = [];
function day(e, date, month, mode) {
  const n = Number(date.slice(8, 10));
  const sun = dow(date) === 0;
  const sh = e.shift; const night = sh === 'NIGHT';
  const start = night ? 20 * 60 : (sh === '9HR' ? 9 * 60 + 30 : sh === '10HR' ? 9 * 60 : 8 * 60);
  const len = sh === '9HR' ? 9 : sh === '10HR' ? 10 : 12;
  let status = 'P';
  if (sun) status = (month === 9 && wopEmps.includes(e.i) && n !== 6) ? 'WOP' : 'WO';
  if (mode === 'low') status = sun ? 'WO' : ([2, 3, 4].includes(n) ? 'P' : 'A');
  if (mode === 'streak' && n >= 21 && !sun) status = 'A';
  if ((plan[e.i] || []).includes(n) && month === 9) status = 'A';
  if (month === 9 && (halfDays[e.i] || []).includes(n)) status = '½P';
  if (month === 10 && !sun && rnd() < 0.06) status = 'A';
  if (status === 'WO' || status === 'A') {
    insAtt.run(e.id, e.code, date, status, status, null, null, null, null, 0, SHIFT[sh], sh, 0, 0, 0, 0, 0, 0, 0, 0, null, 0, null, null, 0, 0, month, YEAR, e.company);
    return;
  }
  const late = rnd() < 0.12 ? 10 + Math.floor(rnd() * 70) : Math.floor(rnd() * 8);
  const inM = start - 6 + late;
  const outM = start + len * 60 + (status === '½P' ? -len * 30 : Math.floor(rnd() * 40) - 5);
  const t = (m) => `${pad(Math.floor(((m % 1440) + 1440) % 1440 / 60))}:${pad(((m % 60) + 60) % 60)}`;
  const isLate = late > 9 ? 1 : 0;
  let outT = t(outM);
  if (month === 10 && n === 10 && !night && rnd() < 0.55) outT = null; // still punched in today
  const leftLate = outM - (start + len * 60) >= 20 ? outM - (start + len * 60) : 0;
  const r = insAtt.run(e.id, e.code, date, status, status, t(inM), outT, t(inM), outT, outT ? Math.round((outM - inM) / 6) / 10 : 0,
    SHIFT[sh], sh, night ? 1 : 0, isLate, isLate ? late - 6 : 0, 0, 0, 0, 0, 0, null, 0, null, null, leftLate ? 1 : 0, leftLate, month, YEAR, e.company);
  if (month === 9 && night && n < 30 && !sun) nightIns.push({ e, id: r.lastInsertRowid, date, inT: t(inM), outT: t(outM), hours: Math.round((outM - inM) / 6) / 10 });
  if (month === 9 && status === 'P' && !sun && !night && e.i % 4 === 1 && n % 7 === 3) mpCandidates.push({ id: r.lastInsertRowid, e, date });
}
db.transaction(() => {
  for (const e of emps) {
    const mode = heldLow.includes(e.i) ? 'low' : (heldStreak.includes(e.i) || streakLeave.includes(e.i)) ? 'streak' : 'normal';
    for (let d = 1; d <= 30; d++) {
      const date = `2026-09-${pad(d)}`;
      if (date < e.doj) continue;
      day(e, date, 9, mode);
    }
    for (let d = 1; d <= 10; d++) day(e, `2026-10-${pad(d)}`, 10, 'normal');
  }
})();

// ── miss punches: hr-pending / finance-pending / approved / rejected ──
const states = ['hr', 'hr', 'fin', 'ok', 'hr', 'rej', 'fin', 'ok'];
const updMp = db.prepare(`UPDATE attendance_processed SET is_miss_punch = 1, miss_punch_type = ?, status_original = '½P',
  status_final = ?, out_time_original = CASE WHEN ? = 'MISSING_OUT' THEN NULL ELSE out_time_original END,
  in_time_original = CASE WHEN ? = 'MISSING_IN' THEN NULL ELSE in_time_original END,
  miss_punch_resolved = ?, miss_punch_finance_status = ?, correction_remark = ? WHERE id = ?`);
let mpCount = 0;
db.transaction(() => {
  mpCandidates.slice(0, 28).forEach((c, k) => {
    const s = states[k % states.length];
    const type = k % 3 === 0 ? 'MISSING_IN' : 'MISSING_OUT';
    updMp.run(type, s === 'hr' ? '½P' : 'P', type, type, s === 'hr' ? 0 : 1,
      s === 'ok' ? 'approved' : s === 'rej' ? 'rejected' : s === 'fin' ? 'pending' : null,
      s === 'hr' ? null : 'Gate register checked — supervisor confirmed shift', c.id);
    mpCount++;
  });
})();

// ── night shift pairs ──
const insPair = db.prepare(`INSERT INTO night_shift_pairs (employee_code, in_record_id, out_record_id, in_date, out_date, in_time, out_time,
  calculated_hours, confidence, is_confirmed, is_rejected, month, year, company) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, 0, 9, 2026, ?)`);
nightIns.slice(0, 40).forEach((p, k) => {
  const nd = new Date(p.date + 'T12:00:00'); nd.setDate(nd.getDate() + 1);
  insPair.run(p.e.code, p.id, p.date, nd.toISOString().slice(0, 10), p.inT, p.outT, p.hours,
    ['high', 'high', 'medium', 'low'][k % 4], k % 3 === 0 ? 1 : 0, p.e.company);
});

// ── leave (CL / EL / LWP), OD, held-with-leave ──
const insLeave = db.prepare(`INSERT INTO leave_applications (employee_id, employee_code, leave_type, start_date, end_date, days, reason, status, approved_by, approved_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, 'Approved', 'hr', '2026-09-28 10:00:00')`);
const leave = (i, type, a, b) => { const e = emps[i]; insLeave.run(e.id, e.code, type, `2026-09-${pad(a)}`, `2026-09-${pad(b)}`, b - a + 1, 'Family function'); };
leave(6, 'CL', 10, 11); leave(14, 'EL', 16, 17); leave(22, 'CL', 8, 8); leave(30, 'EL', 23, 25); leave(38, 'LWP', 2, 3);
leave(46, 'CL', 14, 14); leave(54, 'EL', 29, 29); leave(62, 'LWP', 9, 10); leave(29, 'CL', 21, 22);
const insOd = db.prepare(`INSERT INTO compensatory_off_requests (employee_code, employee_id, start_date, end_date, days, month, year, company,
  reason, hr_remark, applied_by, finance_status, finance_reviewed_by) VALUES (?, ?, ?, ?, 1, 9, 2026, ?, 'Worked on Sunday dispatch', 'Verified', 'hr', 'approved', 'finance')`);
for (const [i, d] of [[7, 18], [15, 22], [23, 11]]) { const e = emps[i]; insOd.run(e.code, e.id, `2026-09-${pad(d)}`, `2026-09-${pad(d)}`, e.company); }
const insRel = db.prepare(`INSERT INTO salary_hold_releases (employee_code, employee_name, department, month, year, company, hold_reason, hold_amount, released_by, release_notes)
  VALUES (?, ?, ?, 9, 2026, ?, 'Low payable days', 0, 'finance', 'Medical certificate seen — paper file 14/09')`);
for (const i of released) { const e = emps[i]; insRel.run(e.code, e.name, e.dept, e.company); }

// ── ED grants (finance approved), late + early-exit deductions, advances ──
const insEd = db.prepare(`INSERT INTO extra_duty_grants (employee_code, employee_id, grant_date, month, year, company, grant_type, duty_days,
  verification_source, remarks, status, requested_by, approved_by, approved_at, finance_status, finance_reviewed_by, finance_reviewed_at)
  VALUES (?, ?, ?, 9, 2026, ?, 'OVERNIGHT_STAY', ?, 'GATE_REGISTER', 'Overnight dispatch loading', 'APPROVED', 'hr', 'hr', '2026-09-29', 'FINANCE_APPROVED', 'finance', '2026-09-30')`);
for (const [i, d, dd] of [[1, 9, 1], [2, 15, 0.5], [9, 23, 1], [17, 17, 1], [25, 11, 1], [25, 18, 1]]) { const e = emps[i]; insEd.run(e.code, e.id, `2026-09-${pad(d)}`, e.company, dd); }
const insLate = db.prepare(`INSERT INTO late_coming_deductions (employee_code, employee_id, month, year, company, late_count, deduction_days, remark,
  applied_by, applied_at, finance_status, finance_reviewed_by) VALUES (?, ?, 9, 2026, ?, ?, ?, 'Repeated late arrival after warning', 'hr', ?, ?, ?)`);
[[3, 0.5, 'approved'], [10, 1, 'approved'], [18, 1.5, 'approved'], [26, 2, 'approved'], [34, 1, 'pending'], [42, 0.5, 'pending']].forEach(([i, d, s], k) => {
  const e = emps[i]; insLate.run(e.code, e.id, e.company, 5 + k, d, `2026-09-30 1${k}:00:00`, s, s === 'approved' ? 'finance' : null);
});
const insDet = db.prepare(`INSERT INTO early_exit_detections (employee_id, employee_code, employee_name, department, company, date, shift_code, shift_end_time,
  actual_punch_out_time, minutes_early, flagged_minutes) VALUES (?, ?, ?, ?, ?, ?, ?, '20:00', '18:10', 110, 110)`);
const insEe = db.prepare(`INSERT INTO early_exit_deductions (early_exit_detection_id, employee_id, employee_code, employee_name, department, company, date,
  deduction_type, deduction_amount, payroll_month, payroll_year, hr_remark, submitted_by, finance_status, finance_reviewed_by)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 9, 2026, 'Left without gate pass', 'hr', 'approved', 'finance')`);
for (const [i, d, type, amt] of [[4, 8, 'half_day', 312.5], [13, 15, 'full_day', 640], [45, 22, 'half_day', 250]]) {
  const e = emps[i]; const date = `2026-09-${pad(d)}`;
  const det = insDet.run(e.id, e.code, e.name, e.dept, e.company, date, e.shift);
  insEe.run(det.lastInsertRowid, e.id, e.code, e.name, e.dept, e.company, date, type, amt);
}
const insAdv = db.prepare(`INSERT INTO salary_advances (employee_id, employee_code, month, year, working_days_1_to_15, is_eligible, advance_amount,
  calculation_date, paid, paid_date, payment_mode, recovered, recovery_month, recovery_year, remark) VALUES (?, ?, 9, 2026, ?, ?, ?, '2026-09-16', ?, ?, ?, 0, 9, 2026, ?)`);
emps.slice(0, 34).forEach((e, k) => {
  if (e.type === 'Contract' || e.doj >= '2026-09-01') return;
  const eligible = k % 6 !== 4 ? 1 : 0;
  const amt = eligible ? Math.round(e.gross * 0.25 / 100) * 100 : 0;
  const remark = k === 7 ? 'NO_ADVANCE' : k === 12 ? 'REDUCED' : null;
  const paid = eligible && k % 3 !== 2 && remark !== 'NO_ADVANCE' ? 1 : 0;
  insAdv.run(e.id, e.code, eligible ? 13 : 9, eligible, remark === 'NO_ADVANCE' ? 0 : remark === 'REDUCED' ? 1500 : amt,
    paid, paid ? '2026-09-17' : null, paid ? 'Bank Transfer' : null, remark);
});

// ── August salary rows (previous-month gross for the "gross changed" badge) ──
const insAug = db.prepare(`INSERT INTO salary_computations (employee_id, employee_code, month, year, company, gross_salary, gross_earned, total_deductions, net_salary, payable_days)
  VALUES (?, ?, 8, 2026, ?, ?, ?, 0, ?, 31)`);
const changed = [5, 13, 26, 34, 51, 57];
for (const e of emps) {
  if (e.doj >= '2026-09-01') continue;
  const g = changed.includes(e.i) ? e.gross - 1500 : e.gross;
  insAug.run(e.id, e.code, e.company, g, g, g);
}

// ── salary change requests (Salary Input) ──
const insScr = db.prepare(`INSERT INTO salary_change_requests (employee_id, employee_code, requested_by, old_gross, new_gross, old_structure, new_structure,
  reason, status, approved_by, approved_at, created_at) VALUES (?, ?, 'hr', ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
emps.slice(0, 14).forEach((e, k) => {
  const ng = e.gross + 1000 + 500 * (k % 4);
  const st = k < 6 ? 'Pending' : k % 2 ? 'Approved' : 'Rejected';
  insScr.run(e.id, e.code, e.gross, ng, JSON.stringify({ basic: e.gross / 2, hra: e.gross * 0.2 }), JSON.stringify({ basic: ng / 2, hra: ng * 0.2, conveyance: 1600, other_allowances: ng * 0.3 - 1600 }),
    ['Annual increment', 'Promotion to supervisor', 'Market correction', 'Probation confirmed'][k % 4], st,
    st === 'Pending' ? null : 'finance', st === 'Pending' ? null : '2026-09-20 11:00:00', `2026-09-${pad(5 + k)} 10:00:00`);
});

// ── monthly imports (pipeline / checklist) ──
for (const c of [IND, ASL]) {
  db.prepare(`INSERT INTO monthly_imports (month, year, file_name, company, status, record_count, employee_count, stage_1_done, stage_2_done, stage_3_done, stage_4_done, stage_5_done)
    VALUES (9, 2026, ?, ?, 'imported', 1900, 64, 1, 1, 1, 1, 1)`).run(`EESL_SEP_2026_${c.split(' ')[0]}.xls`, c);
  db.prepare(`INSERT INTO monthly_imports (month, year, file_name, company, status, record_count, employee_count, stage_1_done)
    VALUES (10, 2026, ?, ?, 'imported', 640, 64, 1)`).run(`EESL_OCT_2026_${c.split(' ')[0]}.xls`, c);
}

// ── loans through the real engine ──
const HR = { username: 'hr', role: 'hr' }, AD = { username: 'admin', role: 'admin' }, FI = { username: 'finance', role: 'finance' };
const loanIds = [];
const borrowers = emps.filter((e) => e.type === 'Permanent' && e.doj < '2025-12-01' && !heldLow.includes(e.i) && !heldStreak.includes(e.i)).slice(4, 11);
borrowers.forEach((e, k) => {
  const principal = Math.min(e.gross, [12000, 18000, 24000, 9000, 15000, 20000, 10000][k]);
  const tenure = [6, 6, 8, 3, 5, 10, 4][k];
  const asOf = k < 3 ? '2026-06-05' : '2026-07-06';
  const r = L.requestLoan(db, { borrowerType: 'plant', employeeCode: e.code, company: e.company, loanType: k === 3 ? 'Festival advance' : 'Personal', principal, tenure, reason: 'Household expense' }, HR, { asOf: k < 5 ? asOf : '2026-10-08' });
  if (!r.ok) throw new Error(`request ${e.code}: ${r.code} ${r.message}`);
  loanIds.push(r.loanId);
  if (k === 5) return; // left at "requested"
  const a = L.approveLoan(db, r.loanId, AD, { asOf: k < 5 ? asOf : '2026-10-08' });
  if (!a.ok) throw new Error(`approve ${e.code}: ${a.code}`);
  if (k === 6) return; // approved, waiting for disbursement
  const on = k < 3 ? '2026-06-15' : '2026-07-15';
  const d = L.disburseLoan(db, r.loanId, FI, { mode: 'Bank transfer', reference: `UTR${e.code}${k}`, disbursedOn: on, agreementFilePath: `DMS-LOAN-${e.code}` }, { asOf: k < 3 ? '2026-06-20' : '2026-07-20' });
  if (!d.ok) throw new Error(`disburse ${e.code}: ${d.code} ${d.message}`);
});

// ── the REAL Stage 6 + Stage 7 for September ──
const days = quiet(() => recomputeDays(db, { month: 9, year: 2026, company: '', requestId: 'wide-render' }));
const sal = quiet(() => recomputeSalary(db, { month: 9, year: 2026, company: '', requestId: 'wide-render' }));
const q = (sql) => db.prepare(sql).get();
process.stdout.write(JSON.stringify({
  employees: emps.length, loanIds, loanDetailId: loanIds[0], missPunches: mpCount, nightPairs: Math.min(nightIns.length, 40),
  stage6: { ok: days.results.length, errors: days.errors.length },
  stage7: { ok: sal.results.length, errors: sal.errors, excluded: sal.excluded.length, held: sal.held.length, loanRecorded: sal.loans.recorded },
  register: q(`SELECT COUNT(*) n, SUM(salary_held) held, SUM(gross_changed) changed, SUM(pf_employee>0) pf, SUM(esi_employee>0) esi,
     SUM(lwf_employee>0) lwf, SUM(loan_recovery>0) loan, SUM(advance_recovery>0) adv, SUM(late_coming_deduction>0) late,
     SUM(early_exit_deduction>0) early, SUM(ot_pay>0) ot, SUM(ed_pay>0) ed, SUM(cl_days>0) cl, SUM(el_days>0) el,
     SUM(uninformed_absent_days>0) ua, SUM(finance_remark IS NOT NULL AND finance_remark != '') remark,
     SUM(ABS(net_salary - (gross_earned - total_deductions)) > 1) drift FROM salary_computations WHERE month = 9 AND year = 2026`),
}));
"""


def boot(repo, port, work):
    env = dict(os.environ, DATA_DIR=work, UPLOADS_DIR=os.path.join(work, 'uploads'), JWT_SECRET='wide-render-secret',
               PORT=str(port), NODE_ENV='production', ADMIN_PASSWORD=ADMIN_PASS, HR_PASSWORD='Indriyan@2025',
               FINANCE_PASSWORD='Finance@2025', TZ='Asia/Kolkata')
    for k in ('BACKUP_CRON_ENABLED', 'SQL_CONSOLE_ENABLED', 'DRIFT_MONITOR_ENABLED', 'ANTHROPIC_API_KEY'):
        env.pop(k, None)
    log = open(os.path.join(work, 'server.log'), 'w')
    SERVER['proc'] = subprocess.Popen(['node', os.path.join(repo, 'backend', 'server.js')], cwd=work, env=env,
                                      stdout=log, stderr=log, start_new_session=True)
    for _ in range(120):
        if SERVER['proc'].poll() is not None:
            raise SystemExit('server exited during boot — see ' + os.path.join(work, 'server.log'))
        try:
            urllib.request.urlopen(f'http://127.0.0.1:{port}/api/version', timeout=1)
            return
        except Exception:
            time.sleep(0.5)
    raise SystemExit('server did not come up')


def seed(repo, work):
    js = os.path.join(work, 'seed.js')
    with open(js, 'w') as f:
        f.write(SEED_JS)
    env = dict(os.environ, DATA_DIR=work, JWT_SECRET='wide-render-secret', TZ='Asia/Kolkata')
    out = subprocess.run(['node', js, repo, os.path.join(work, 'hr_system.db')], env=env, capture_output=True, text=True, timeout=300)
    if out.returncode != 0:
        raise SystemExit('seed failed:\n' + out.stderr[-3000:])
    return json.loads(out.stdout)


METRICS_JS = r"""() => {
  const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height), right: Math.round(r.right) }; };
  const se = document.scrollingElement;
  const main = document.querySelector('main');
  const root = main ? main.querySelector(':scope > div') || main.firstElementChild : null;
  // content wrapper: the first element (root or its children) carrying a max-w-* / p-* layout class, else root
  let wrap = root;
  if (root) {
    const cands = [root, ...root.children];
    wrap = cands.find((el) => /(^|\s)max-w-/.test(el.className || '')) || cands.find((el) => el.tagName === 'DIV' && /(^|\s)p-\d/.test(el.className || '')) || root;
  }
  return {
    document: { scrollWidth: se.scrollWidth, clientWidth: se.clientWidth, overflow: se.scrollWidth > se.clientWidth },
    main: main ? { scrollWidth: main.scrollWidth, clientWidth: main.clientWidth, overflow: main.scrollWidth > main.clientWidth } : null,
    mainBox: box(main), pageRootBox: box(root),
    contentWrapper: wrap ? { className: String(wrap.className || '').slice(0, 160), box: box(wrap),
      usedWidthPct: main ? Math.round(100 * wrap.getBoundingClientRect().width / main.clientWidth) : null } : null,
  };
}"""

REGISTER_JS = r"""(mode) => {
  const tables = [...document.querySelectorAll('table')].filter((t) => [...t.querySelectorAll('th')].some((th) => th.textContent.includes('Take Home')));
  if (!tables.length) return null;
  const t = tables[0];
  let c = t.parentElement;
  while (c && c !== document.body && !/(auto|scroll)/.test(getComputedStyle(c).overflowX)) c = c.parentElement;
  if (!c || c === document.body) return null;
  const main = document.querySelector('main');
  if (mode === 'right') {
    const card = c.closest('.card') || c;
    main.scrollTop += card.getBoundingClientRect().top - main.getBoundingClientRect().top - 8;
    c.scrollLeft = c.scrollWidth;
  } else if (mode === 'reset') {
    c.scrollLeft = 0;
  } else if (mode === 'row') {
    const tr = t.querySelector('tbody tr');
    main.scrollTop += tr.getBoundingClientRect().top - main.getBoundingClientRect().top - 60;
  }
  return { scrollWidth: c.scrollWidth, clientWidth: c.clientWidth, scrollLeft: Math.round(c.scrollLeft), tableWidth: Math.round(t.getBoundingClientRect().width) };
}"""


def full_shot(page, path, w, h):
    tall = page.evaluate("""() => { const m = document.querySelector('main'); const se = document.scrollingElement;
        return Math.max(se.scrollHeight, m ? m.scrollHeight + m.getBoundingClientRect().top : 0); }""")
    page.set_viewport_size({'width': w, 'height': int(min(max(h, tall + 20), 16000))})
    page.wait_for_timeout(500)
    page.screenshot(path=path, full_page=True)
    page.set_viewport_size({'width': w, 'height': h})
    page.wait_for_timeout(300)


def main():
    if len(sys.argv) < 3:
        raise SystemExit('usage: wide-layout-render.py <repo_root_to_serve> <out_dir>')
    repo, out = os.path.abspath(sys.argv[1]), os.path.abspath(sys.argv[2])
    if not os.path.exists(os.path.join(repo, 'frontend', 'dist', 'index.html')):
        raise SystemExit(f'{repo}/frontend/dist is missing — build the frontend first')
    os.makedirs(out, exist_ok=True)
    for f in os.listdir(out):
        if f.endswith('.png') or f == 'report.json':
            os.remove(os.path.join(out, f))
    port = free_port()
    base = f'http://127.0.0.1:{port}'
    work = tempfile.mkdtemp(prefix='wide-render-')
    SERVER['work'] = work
    report = {'repo': repo, 'out_dir': out, 'port': port, 'started': datetime.now(timezone.utc).isoformat(),
              'viewports': [f'{w}x{h}' for w, h in VIEWPORTS], 'pages': {}}
    ok = True
    try:
        boot(repo, port, work)
        seeded = seed(repo, work)
        report['seed'] = seeded
        print('seed:', json.dumps(seeded['register']))
        loan_id = seeded['loanDetailId']

        with sync_playwright() as p:
            browser = p.chromium.launch()
            # ── one login, reused for every viewport ──
            ctx = browser.new_context(viewport={'width': 1440, 'height': 900}, timezone_id='Asia/Kolkata')
            pg = ctx.new_page()
            pg.goto(f'{base}/login')
            pg.get_by_placeholder('admin').fill(ADMIN_USER)
            pg.get_by_placeholder('••••••••').fill(ADMIN_PASS)
            pg.get_by_role('button', name='Sign in').click()
            pg.wait_for_url(lambda u: '/login' not in u, timeout=20000)
            state = ctx.storage_state()
            ctx.close()

            for slug, path, row_sel in PAGES:
                path = path.replace('{LOAN_ID}', str(loan_id))
                rec = {'path': path, 'pageErrors': [], 'consoleErrors': [], 'failedApi': [], 'viewports': {}}
                report['pages'][slug] = rec
                for w, h in VIEWPORTS:
                    vp = f'{w}x{h}'
                    ctx = browser.new_context(viewport={'width': w, 'height': h}, storage_state=state, timezone_id='Asia/Kolkata')
                    collapsed = 'true' if w < 768 else 'false'
                    ctx.add_init_script(f"""try {{ localStorage.setItem('hr-system-store', JSON.stringify({{ state: {{
                        selectedMonth: {MONTH}, selectedYear: {YEAR}, sidebarCollapsed: {collapsed}, selectedCompany: '',
                        dateRangeMode: 'month', dateRangeStart: '', dateRangeEnd: '' }}, version: 0 }})); }} catch (e) {{}}""")
                    page = ctx.new_page()
                    page.on('pageerror', lambda e, v=vp: rec['pageErrors'].append(f'{v}: {e}'))
                    page.on('console', lambda m, v=vp: m.type == 'error' and rec['consoleErrors'].append(f'{v}: {m.text[:300]}'))
                    page.on('response', lambda r, v=vp: (r.status >= 400 and '/api/' in r.url)
                            and rec['failedApi'].append(f'{v}: {r.status} {r.request.method} {r.url.replace(base, "")}'))
                    vrec = {}
                    try:
                        page.goto(base + path, wait_until='domcontentloaded')
                        try:
                            page.wait_for_load_state('networkidle', timeout=20000)
                        except Exception:
                            pass
                        try:
                            page.locator(row_sel).first.wait_for(timeout=20000)
                        except Exception:
                            pass
                        page.wait_for_timeout(900)  # fade-in animation
                        vrec['rows'] = page.locator(row_sel).count()
                        vrec['rendered'] = vrec['rows'] > 0 and '/login' not in page.url
                        vrec.update(page.evaluate(METRICS_JS))
                        page.screenshot(path=os.path.join(out, f'{slug}__{w}__viewport.png'))
                        full_shot(page, os.path.join(out, f'{slug}__{w}__full.png'), w, h)
                        if slug == 'stage7-salary' and vrec['rendered']:
                            vrec['register'] = page.evaluate(REGISTER_JS, 'right')
                            page.wait_for_timeout(400)
                            page.screenshot(path=os.path.join(out, f'{slug}__{w}__register-right.png'))
                            page.evaluate(REGISTER_JS, 'reset')
                            page.locator(row_sel).first.locator('td').nth(2).click()
                            page.wait_for_timeout(700)
                            page.evaluate(REGISTER_JS, 'row')
                            page.wait_for_timeout(400)
                            page.screenshot(path=os.path.join(out, f'{slug}__{w}__row-expanded.png'))
                    except Exception as e:  # record and carry on
                        vrec['rendered'] = False
                        vrec['exception'] = repr(e)[:400]
                    rec['viewports'][vp] = vrec
                    ctx.close()
                rec['rendered'] = all(v.get('rendered') for v in rec['viewports'].values())
                if not rec['rendered'] or rec['pageErrors']:
                    ok = False
            browser.close()
    finally:
        stop_server()
        report['finished'] = datetime.now(timezone.utc).isoformat()
        report['pass'] = ok and bool(report['pages'])
        with open(os.path.join(out, 'report.json'), 'w') as f:
            json.dump(report, f, indent=2)

    # ── summary ──
    print(f"\n{'page':16} {'rendered':8} {'rows@2560/1440/390':20} {'pgErr':5} {'cons':4} {'api>=400':8} {'docOverflow':12} {'mainOverflow':12} wrapper width@2560")
    for slug, rec in report['pages'].items():
        vs = rec['viewports']
        rows = '/'.join(str(vs.get(f'{w}x{h}', {}).get('rows', '-')) for w, h in VIEWPORTS)
        dov = ''.join('Y' if (vs.get(f'{w}x{h}', {}).get('document') or {}).get('overflow') else 'n' for w, h in VIEWPORTS)
        mov = ''.join('Y' if (vs.get(f'{w}x{h}', {}).get('main') or {}).get('overflow') else 'n' for w, h in VIEWPORTS)
        cw = (vs.get('2560x1440', {}).get('contentWrapper') or {})
        wbox = cw.get('box') or {}
        print(f"{slug:16} {str(rec['rendered']):8} {rows:20} {len(rec['pageErrors']):5} {len(rec['consoleErrors']):4} "
              f"{len(rec['failedApi']):8} {dov:12} {mov:12} {wbox.get('width')}px ({cw.get('usedWidthPct')}% of main)")
    files = sorted(f for f in os.listdir(out) if f.endswith('.png'))
    print(f"\n{len(files)} PNGs + report.json in {out}  —  {'PASS' if report['pass'] else 'FAIL'}")
    sys.exit(0 if report['pass'] else 1)


if __name__ == '__main__':
    main()
