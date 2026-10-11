#!/usr/bin/env python3
"""Attendance Review — PR-3 rules (D-4 2 h rule, D-6 long lates, MP-2 missed OUT) — browser check.

Chromium against the BUILT dist, real admin + hr logins, scratch DATA_DIR, fictional codes P30xx (repo is public).
October 2026, import basis, 12-hour shift; every person has 10 clean September days (not a newcomer).
  P3001 one exit 130 min early                       → off: nothing;  on: early-exit section, WARNING (need 2, owner 11 Oct)
  P3007 two exits 130 min early                      → off: nothing;  on: 2nd 2 h exit → each ½ day = 1 day
  P3002 three exits 70 min early                     → off: warning;  on: ½ day (minutes 210 / 720 → ½)
  P3003 8 lates of 30 min + one exit 130 min early   → action list: ½ day off and on (a lone 2 h exit only adds its minutes)
  P3004 late 150 min on a full-hours day             → "Late 2 h or more": forgiven when off, counted when ticked
  P3005 7 missed OUTs, clean otherwise               → on: 5th–7th = 3 early exits of 2 h → 1½ days
  P3006 on time
Flow: preview with rules v1 (switches off) → Rules editor: 2 h rule + both ticks → v2 saved with the keys → preview follows →
draft → finalise → Send 4 to finance (1 action list + 3 early section: P3002, P3005, P3007) → rows + remarks → hr refused → phone → payroll untouched.

Usage: npm run build --prefix frontend; python3 backend/scripts/attendance-review-early-rules-check.py
"""
import datetime, json, os, sqlite3, subprocess, tempfile, time, urllib.request
from playwright.sync_api import sync_playwright

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
PORT = int(os.environ.get('PORT', '3997')); BASE = f'http://127.0.0.1:{PORT}'
WORK = tempfile.mkdtemp(prefix='ar-pr3-'); DB = os.path.join(WORK, 'hr_system.db')
C = 'Indriyan Beverages Pvt Ltd'
PASS = FAIL = 0


def check(label, expected, actual):
    global PASS, FAIL
    if expected == actual: PASS += 1; print(f'  ✓ {label}')
    else: FAIL += 1; print(f'  ✗ {label} — expected {expected!r}, got {actual!r}')


def q(sql, args=()):
    con = sqlite3.connect(DB, timeout=10); con.row_factory = sqlite3.Row
    try: return [dict(r) for r in con.execute(sql, args).fetchall()]
    finally: con.close()


def weekdays(y, m):
    d = datetime.date(y, m, 1); out = []
    while d.month == m:
        if d.weekday() != 6: out.append(d.isoformat())
        d += datetime.timedelta(days=1)
    return out


def hhmm(m): return f'{m // 60:02d}:{m % 60:02d}'


def seed():
    c = sqlite3.connect(DB)
    codes = ['P3001', 'P3002', 'P3003', 'P3004', 'P3005', 'P3006', 'P3007']
    for n, code in enumerate(codes, 1):
        c.execute("INSERT INTO employees(code,name,department,designation,company,status,employment_type,is_contractor,gross_salary,date_of_joining) "
                  "VALUES(?,?,'PRODUCTION','OPERATOR',?,'Active','Permanent',0,21600,'2024-01-01')", (code, f'TEST RULES {n}', C))

    def row(code, iso, lm=0, em=0, it=None, ot=None, mp=0, mtype=None):
        c.execute("INSERT INTO attendance_processed(employee_code,date,status_original,status_final,in_time_final,out_time_final,shift_detected,"
                  "is_late_arrival,late_by_minutes,is_early_departure,early_by_minutes,is_left_late,is_miss_punch,miss_punch_type,miss_punch_resolved,month,year,company) "
                  "VALUES(?,?,'P','P',?,?,'12-Hour Shift',?,?,?,?,0,?,?,?,?,?,?)",
                  (code, iso, it or hhmm(480 + lm), ot if ot is not None else (None if mp else hhmm(1200 - em)), 1 if lm else 0, lm, 1 if em else 0, em,
                   mp, mtype, 1 if mp else 0, int(iso[5:7]), 2026, C))
    for code in codes:
        for iso in weekdays(2026, 9)[:10]: row(code, iso)
    oct_ = weekdays(2026, 10)[:20]
    for i, iso in enumerate(oct_):
        row('P3001', iso, em=130 if i == 3 else 0)
        row('P3002', iso, em=70 if i < 3 else 0)
        row('P3003', iso, lm=30 if i < 8 else 0, em=130 if i == 10 else 0)
        row('P3004', iso, **({'lm': 150, 'it': '10:30', 'ot': '22:35'} if i == 5 else {}))
        row('P3005', iso, **({'mp': 1, 'mtype': 'MISSING_OUT'} if i < 7 else {}))
        row('P3006', iso)
        row('P3007', iso, em=130 if i in (2, 9) else 0)
    c.execute("INSERT INTO attendance_review_config(effective_from, config_json, updated_by) VALUES('2026-10', ?, 'admin')",
              (json.dumps({'early_exit_rule': 'warning'}),))
    c.commit(); c.close()


def login(ctx, user='admin', pw='Admin@123'):
    pg = ctx.new_page()
    pg.goto(BASE + '/login'); pg.get_by_placeholder('admin').fill(user); pg.get_by_placeholder('••••••••').fill(pw)
    pg.get_by_role('button', name='Sign in').click(); pg.wait_for_url(lambda u: '/login' not in u)
    return pg


def open_tab(pg):
    pg.goto(BASE + '/analytics/attendance-review'); pg.wait_for_load_state('networkidle')
    pg.locator('select').filter(has=pg.locator('option', has_text='October')).first.select_option('10')
    pg.locator('select').filter(has=pg.locator('option', has_text='2026')).first.select_option('2026')
    pg.wait_for_load_state('networkidle'); time.sleep(1.5)


def section(pg, title): return pg.locator(f'[data-section="{title}"]')


def expand(pg, title):
    s = section(pg, title)
    if s.get_by_text('expand', exact=True).count(): s.locator('button').first.click(); time.sleep(.4)
    return s


def rows(pg, title):
    s = expand(pg, title)
    return {tr.locator('td').first.inner_text().strip(): [t.strip() for t in tr.locator('td').all_inner_texts()] for tr in s.locator('tbody tr').all()}


PAYROLL = ['salary_computations', 'day_calculations', 'early_exit_deductions', 'attendance_processed']

env = dict(os.environ, DATA_DIR=WORK, JWT_SECRET='x', PORT=str(PORT), NODE_ENV='production',
           ADMIN_PASSWORD='Admin@123', HR_PASSWORD='Indriyan@2025', FINANCE_PASSWORD='Finance@2025')
srv = subprocess.Popen(['node', f'{ROOT}/backend/server.js'], env=env, stdout=open(f'{WORK}/log', 'w'), stderr=subprocess.STDOUT)
try:
    for _ in range(80):
        try: urllib.request.urlopen(BASE + '/api/version', timeout=2); break
        except Exception: time.sleep(.5)
    seed()
    before = {t: q(f'SELECT COUNT(*) n FROM {t}')[0]['n'] for t in PAYROLL}
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = login(b.new_context(viewport={'width': 1440, 'height': 1000})); errs, bad = [], []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.on('response', lambda r: bad.append(f'{r.status} {r.url}') if '/api/' in r.url and r.status >= 400 else None)
        pg.on('dialog', lambda d: d.accept())
        open_tab(pg)

        print('\n— rules v1: switches off —')
        section(pg, 'Action list').wait_for(timeout=30000)
        al = rows(pg, 'Action list')
        check('P3003 on the action list, ½ day (minutes only)', True, 'P3003' in al and any(c == '0.5' for c in al['P3003']))
        ew = rows(pg, 'Early-exit warnings')
        check('early section: P3002 warning only; P3001 / P3005 not listed', [True, False, False], ['P3002' in ew, 'P3001' in ew, 'P3005' in ew])
        check('early section shows the Option C column (rule off)', True, 'option c days' in section(pg, 'Early-exit warnings').inner_text().lower())
        ll = rows(pg, 'Late 2 h or more — check the shift')
        check('long lates: P3004 listed, forgiven by full hours', True, 'P3004' in ll and ll['P3004'][-2] == '1' and ll['P3004'][4] == '0')
        check('no "Missed OUT" section while the rule is off', 0, section(pg, 'Missed OUT counted as an early exit').count())

        print('\n— Rules editor: 2 h rule + both ticks —')
        pg.get_by_role('button', name='Rules & exclusions').click(); time.sleep(.8)
        cfg = pg.get_by_test_id('ar-config')
        check('switches start off', [False, False], [cfg.get_by_label('Long late always counted').is_checked(), cfg.get_by_label('Missed OUT counts as early exit').is_checked()])
        cfg.get_by_label('Early-exit rule').select_option('d4')
        check('editor shows the "2 h exits needed" setting at 2', '2', cfg.get_by_label('d4_half_day_min_count', exact=True).input_value())
        check('…with its plain label', True, cfg.get_by_text('number of 2 h exits in the month before each costs ½ day').count() > 0)
        cfg.get_by_label('Long late always counted').check(); cfg.get_by_label('Missed OUT counts as early exit').check()
        cfg.get_by_label('Effective from').fill('2026-10')
        cfg.get_by_role('button', name='Save as new version').click(); time.sleep(1.8)
        v = q('SELECT config_json FROM attendance_review_config ORDER BY id DESC')
        check('saved as version 2', 2, len(v))
        v2 = json.loads(v[0]['config_json'])
        check('v2 carries the three rules', ['d4', True, True], [v2.get('early_exit_rule'), v2.get('late_long_always_counted'), v2.get('missed_out_rule')])
        check('v2 carries the new thresholds (2 h exits needed = 2)', [120, 3, 5, 2], [v2['thresholds'].get('d4_half_day_minutes'), v2['thresholds'].get('d4_long_count'), v2['thresholds'].get('missed_out_from'), v2['thresholds'].get('d4_half_day_min_count')])

        print('\n— preview with the rules on —')
        open_tab(pg); section(pg, 'Action list').wait_for(timeout=30000)
        al = rows(pg, 'Action list')
        check('P3003: still ½ day (a lone 2 h exit adds only its minutes: 0.51 → ½)', True, 'P3003' in al and al['P3003'][-3] == '0.5')
        check('P3003 early cell shows "(1 ≥ 2 h)"', True, '≥ 2 h' in ' '.join(al['P3003']))
        ew = rows(pg, 'Early-exit warnings')
        check('early section: P3001 warning (1st 2 h exit), P3002 ½, P3005 1½, P3007 1 day', ['Warning', 'Deduction 0.5 d', 'Deduction 1.5 d', 'Deduction 1.0 d'],
              [ew.get('P3001', [''])[-1], ew.get('P3002', [''])[-1], ew.get('P3005', [''])[-1], ew.get('P3007', [''])[-1]])
        check('early section note explains "need 2"', True, 'from the 2nd exit of 2 h or more' in section(pg, 'Early-exit warnings').inner_text())
        check('P3005: 3 early exits incl. 3 missed OUT', True, 'incl. 3 missed OUT' in ' '.join(ew.get('P3005', [])))
        check('early section shows the 2 h rule columns', [True, True], ['2 h or more' in section(pg, 'Early-exit warnings').inner_text().lower(), '2 h rule days' in section(pg, 'Early-exit warnings').inner_text().lower()])
        ll = rows(pg, 'Late 2 h or more — check the shift')
        check('P3004 long late counted, kept though hours made up', [True, '1', '1'], ['P3004' in ll, ll.get('P3004', ['', '', '', '', ''])[4], ll.get('P3004', ['', '', '', '', '', '', ''])[6]])
        mo = rows(pg, 'Missed OUT counted as an early exit')
        check('Missed OUT: P3005 7 own, 3 counted', [True, '7', '3'], ['P3005' in mo, mo.get('P3005', ['', '', '', ''])[3], mo.get('P3005', ['', '', '', '', ''])[4]])
        pg.screenshot(path=os.path.join(WORK, 'rules-on.png'), full_page=True)

        print('\n— draft → finalise → send —')
        pg.get_by_role('button', name='Generate draft').click(); pg.get_by_text('Draft created').wait_for(timeout=15000)
        pg.wait_for_load_state('networkidle'); time.sleep(1.2)
        pg.get_by_role('button', name='Finalise').click(); pg.get_by_text('Review finalised and locked').wait_for(timeout=10000)
        pg.wait_for_load_state('networkidle'); time.sleep(1.5)
        btn = pg.get_by_test_id('ar-send-finance')
        check('button: Send 4 to finance', 'Send 4 to finance', btn.inner_text().strip())
        check('note: 3 from the early-exit section', True, '3 from the early-exit section' in pg.get_by_test_id('ar-finance-early').inner_text())
        check('nothing written before the click', 0, q('SELECT COUNT(*) n FROM late_coming_deductions')[0]['n'])
        btn.click(); pg.get_by_text('4 sent to finance', exact=False).wait_for(timeout=10000); time.sleep(.8)
        sent = {r['employee_code']: r for r in q('SELECT employee_code, deduction_days, late_count, finance_status, remark FROM late_coming_deductions')}
        check('rows: P3002 0.5, P3003 0.5, P3005 1.5, P3007 1 — all pending; P3001 (warning) not sent', {'P3002': 0.5, 'P3003': 0.5, 'P3005': 1.5, 'P3007': 1.0},
              {k: r['deduction_days'] for k, r in sent.items() if r['finance_status'] == 'pending'})
        check('early-section remark names the 2 h rule', True, 'early exits' in sent['P3007']['remark'] and 'D-4 rule' in sent['P3007']['remark'])
        check('P3007 remark: 2 exits of 2 h at ½ day', True, '2 of 2 h or more; 2 at ½ day each' in sent['P3007']['remark'])
        check('P3005 remark counts the missed OUT', True, '3 missed OUT' in sent['P3005']['remark'])
        check('P3003 remark: no ½-day charge for a lone 2 h exit', False, 'at ½ day' in sent['P3003']['remark'])
        check('second click creates nothing', 'Nothing left to send', pg.get_by_test_id('ar-send-finance').inner_text().strip())

        print('\n— hr refused, phone width —')
        hr = login(b.new_context(viewport={'width': 1280, 'height': 900}), 'hr', 'Indriyan@2025')
        st = hr.evaluate("async () => { const t = localStorage.getItem('hr_token'); const r = await fetch('/api/analytics/attendance-review/preview?month=10&year=2026', { headers: { Authorization: 'Bearer ' + t } }); return r.status }")
        check('hr: preview refused (403)', 403, st)
        ph = login(b.new_context(viewport={'width': 390, 'height': 844})); perr = []
        ph.on('pageerror', lambda e: perr.append(str(e)))
        open_tab(ph); section(ph, 'Action list').wait_for(timeout=30000)
        expand(ph, 'Late 2 h or more — check the shift')
        check('phone: no page errors', [], perr)
        check('desktop: no page errors', [], errs)
        check('no API error responses', [], [x for x in bad if '/preview' in x or '/runs' in x or '/config' in x])
    after = {t: q(f'SELECT COUNT(*) n FROM {t}')[0]['n'] for t in PAYROLL}
    check('salary / day-calc / early-exit tables / attendance untouched', before, after)
finally:
    srv.terminate()
print(f'\n{PASS} passed, {FAIL} failed  (screens in {WORK})')
raise SystemExit(1 if FAIL else 0)
