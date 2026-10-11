#!/usr/bin/env python3
"""PR-7 — Attendance Review escalation ladder + person history — browser check.

Chromium against the BUILT dist, real admin + hr logins, scratch DATA_DIR, fictional codes L70xx (repo is public).
Import basis, 12-hour day masters, 22 weekdays a month, late 45 min on 12 days = a late regular:
  L7001 late Aug, Sep, Oct  → October month 3 → deduction + HR hearing
  L7002 late Oct only       → month 1 → warning (rules gave a deduction)
  L7003 late Sep, Oct       → month 2 → deduction
Flow: ladder off → no Ladder column → tick "Escalation ladder" in Rules, save for Oct → Ladder column, L7002 warning,
L7001 hearing badge, totals → click L7001 → history window (Aug–Oct, months 1/2/3, finance none) → draft → Word notes
mention the HR hearing and the first-month warning → finalise (reason) → "Send 2 to finance" (warnings not sent) →
hr gets 403 on the history API → phone width. Payroll tables untouched.

Usage: npm run build --prefix frontend; python3 backend/scripts/attendance-review-ladder-check.py
"""
import datetime, json, os, sqlite3, subprocess, tempfile, time, urllib.request, zipfile, re
from playwright.sync_api import sync_playwright

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
PORT = int(os.environ.get('PORT', '3997')); BASE = f'http://127.0.0.1:{PORT}'
WORK = tempfile.mkdtemp(prefix='ar-ladder-'); DB = os.path.join(WORK, 'hr_system.db')
C = 'Indriyan Beverages Pvt Ltd'
PASS = FAIL = 0
def check(label, expected, actual):
    global PASS, FAIL
    if expected == actual: PASS += 1; print(f'  ✓ {label}')
    else: FAIL += 1; print(f'  ✗ {label} — expected {expected!r}, got {actual!r}')


def weekdays(y, m):
    d = datetime.date(y, m, 1); out = []
    while d.month == m:
        if d.weekday() != 6: out.append(d.isoformat())
        d += datetime.timedelta(days=1)
    return out


def q(sql, args=()):
    con = sqlite3.connect(DB, timeout=10); con.row_factory = sqlite3.Row
    try: return [dict(r) for r in con.execute(sql, args).fetchall()]
    finally: con.close()


def run(sql, args=()):
    con = sqlite3.connect(DB, timeout=10)
    try: con.execute(sql, args); con.commit()
    finally: con.close()



def seed():
    c = sqlite3.connect(DB)
    s12 = c.execute("SELECT id FROM shifts WHERE code='12HR'").fetchone()[0]
    late = {'L7001': (8, 9, 10), 'L7002': (10,), 'L7003': (9, 10), 'L7004': ()}
    for n, code in enumerate(late, 1):
        c.execute("INSERT INTO employees(code,name,department,designation,company,status,employment_type,is_contractor,gross_salary,date_of_joining,default_shift_id) "
                  "VALUES(?,?,'PRODUCTION','OPERATOR',?,'Active','Permanent',0,22000,'2024-01-01',?)", (code, f'TEST LADDER {n}', C, s12))
    for m in (7, 8, 9, 10):
        for i, iso in enumerate(weekdays(2026, m)[:22]):
            for code, months in late.items():
                lt = m in months and i < 12
                c.execute("INSERT INTO attendance_processed(employee_code,date,status_original,status_final,in_time_final,out_time_final,shift_detected,"
                          "is_late_arrival,late_by_minutes,is_early_departure,early_by_minutes,is_left_late,is_miss_punch,month,year,company) "
                          "VALUES(?,?,'P','P',?,'20:00','12-Hour Shift',?,?,0,0,0,0,?,?,?)", (code, iso, '08:45' if lt else '08:00', 1 if lt else 0, 45 if lt else 0, m, 2026, C))
    c.commit(); c.close()


def section(pg, title): return pg.locator(f'[data-section="{title}"]')


def open_tab(pg):
    pg.goto(BASE + '/analytics/attendance-review'); pg.wait_for_load_state('networkidle')
    pg.locator('select').filter(has=pg.locator('option', has_text='October')).first.select_option('10')
    pg.locator('select').filter(has=pg.locator('option', has_text='2026')).first.select_option('2026')
    pg.wait_for_load_state('networkidle'); time.sleep(1.5)


def login(ctx, user='admin', pw='Admin@123'):
    pg = ctx.new_page()
    pg.goto(BASE + '/login'); pg.get_by_placeholder('admin').fill(user); pg.get_by_placeholder('••••••••').fill(pw)
    pg.get_by_role('button', name='Sign in').click(); pg.wait_for_url(lambda u: '/login' not in u)
    return pg


def api(pg, method, path, body=None):
    return pg.evaluate("""async ([m, p, b]) => { const t = localStorage.getItem('hr_token');
      const r = await fetch(p, { method: m, headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined });
      let j = null; try { j = await r.json() } catch {} return { status: r.status, body: j } }""", [method, path, body])


def finalise_ui(pg):
    pg.get_by_role('button', name='Finalise').click()
    pg.get_by_test_id('ar-finalise-dialog').get_by_text('Finalising locks the review').wait_for(timeout=10000)
    box = pg.get_by_label('Reason to finalise')
    if box.count(): box.fill('Synthetic test month, checks reviewed')
    pg.get_by_test_id('ar-finalise-confirm').click()
    pg.get_by_text('Review finalised and locked').first.wait_for(timeout=10000)


def row(pg, code): return section(pg, 'Action list').locator('tbody tr', has=pg.get_by_test_id(f'ar-code-{code}'))


env = dict(os.environ, DATA_DIR=WORK, JWT_SECRET='x', PORT=str(PORT), NODE_ENV='production',
           ADMIN_PASSWORD='Admin@123', HR_PASSWORD='Indriyan@2025', FINANCE_PASSWORD='Finance@2025')
srv = subprocess.Popen(['node', f'{ROOT}/backend/server.js'], env=env, stdout=open(f'{WORK}/log', 'w'), stderr=subprocess.STDOUT)
try:
    for _ in range(80):
        try: urllib.request.urlopen(BASE + '/api/version', timeout=2); break
        except Exception: time.sleep(.5)
    seed()
    payroll_before = [q(f'SELECT COUNT(*) n FROM {t}')[0]['n'] for t in ('day_calculations', 'salary_computations', 'early_exit_deductions')]
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = login(b.new_context(viewport={'width': 1440, 'height': 900}, accept_downloads=True)); errs, bad = [], []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.on('dialog', lambda d: d.accept())
        pg.on('response', lambda r: bad.append(f'{r.status} {r.url}') if '/api/' in r.url and r.status >= 400 else None)
        open_tab(pg)

        print('\n— ladder off —')
        check('no Ladder column', 0, section(pg, 'Action list').locator('th', has_text='Ladder').count())
        check('L7002 a deduction without the ladder', True, 'Deduction' in row(pg, 'L7002').inner_text())

        print('\n— switch the ladder on in Rules (effective Oct 2026) —')
        pg.get_by_role('button', name='Rules & exclusions').click(); time.sleep(1)
        pg.get_by_label('Escalation ladder').check()
        check('counts from Aug 2026 by default', '2026-08', pg.get_by_label('Ladder counts from').input_value())
        pg.get_by_role('button', name='Save as new version').click(); time.sleep(2)
        cfg = q("SELECT effective_from, json_extract(config_json,'$.ladder_rule') lr, json_extract(config_json,'$.ladder_from') lf FROM attendance_review_config ORDER BY id DESC LIMIT 1")[0]
        check('saved version: ladder on, from 2026-08', [1, '2026-08'], [cfg['lr'], cfg['lf']])
        pg.get_by_role('button', name='Hide rules & exclusions').click()
        pg.wait_for_load_state('networkidle'); time.sleep(2)
        check('Ladder column shown', 1, section(pg, 'Action list').locator('th', has_text='Ladder').count())
        r2 = row(pg, 'L7002').inner_text()
        check('L7002: warning, first month', True, 'Warning' in r2 and '1st month' in r2)
        check('L7001: 3rd month · HR hearing badge', 1, row(pg, 'L7001').get_by_test_id('ladder-hearing').count())
        r3 = row(pg, 'L7003').inner_text()
        check('L7003: deduction, 2nd month', True, 'Deduction' in r3 and '2nd month' in r3)
        note = section(pg, 'Action list').inner_text()
        check('note: 1 turned into a warning, 1 hearing', True, '1 turned into warnings, 1 hearing(s)' in note)

        print('\n— person history —')
        pg.get_by_test_id('ar-code-L7001').click()
        win = pg.get_by_test_id('ar-person'); win.wait_for(timeout=10000); time.sleep(1.5)
        rows_txt = [win.get_by_test_id(f'ar-person-2026-{m:02d}').inner_text() for m in (8, 9, 10)]
        check('Aug–Oct rows', 3, sum(1 for t in rows_txt if t))
        check('Aug month 1, Sep month 2, Oct month 3 + hearing', [True, True, True],
              ['1st month' in rows_txt[0], '2nd month' in rows_txt[1], 'HR hearing' in rows_txt[2]])
        check('nothing sent to finance yet', 1, win.get_by_text('Nothing sent.').count())
        pg.keyboard.press('Escape'); time.sleep(.4)

        print('\n— draft, Word notes, finalise, send —')
        pg.get_by_role('button', name='Generate draft').click(); pg.get_by_text('Draft created').wait_for(timeout=15000)
        pg.wait_for_load_state('networkidle'); time.sleep(1.5)
        with pg.expect_download() as dl: pg.get_by_role('button', name='Download Word notes (draft)').click()
        dp = os.path.join(WORK, 'notes.docx'); dl.value.save_as(dp)
        xml = re.sub('<[^>]+>', '', zipfile.ZipFile(dp).read('word/document.xml').decode())
        check('Word: HR hearing paragraph', True, 'HR hearing: this is month 3 in the last 3 months' in xml)
        check('Word: first-month warning wording', True, 'This is the first month in the last 3 months' in xml)
        finalise_ui(pg); pg.wait_for_load_state('networkidle'); time.sleep(1.5)
        btn = pg.get_by_test_id('ar-send-finance')
        check('Send 2 to finance (warning not sent)', 'Send 2 to finance', btn.inner_text().strip())
        btn.click(); pg.get_by_text(re.compile('Sent 2|sent to finance', re.I)).first.wait_for(timeout=10000); time.sleep(1)
        sent = sorted(r['employee_code'] for r in q("SELECT employee_code FROM late_coming_deductions WHERE month=10 AND year=2026"))
        check('rows: L7001 + L7003', ['L7001', 'L7003'], sent)
        pg.get_by_test_id('ar-code-L7001').click(); win.wait_for(timeout=10000); time.sleep(1.5)
        check('history now lists the finance row', True, 'pending' in win.get_by_test_id('ar-person-finance').inner_text())
        pg.keyboard.press('Escape')

        print('\n— hr and phone —')
        hr = login(b.new_context(viewport={'width': 1280, 'height': 900}), 'hr', 'Indriyan@2025')
        check('hr: history API refused (403)', 403, api(hr, 'GET', '/api/analytics/attendance-review/person/L7001')['status'])
        ph = login(b.new_context(viewport={'width': 390, 'height': 844}))
        ph.on('pageerror', lambda e: errs.append(str(e)))
        open_tab(ph)
        check('phone: ladder badge visible', True, ph.get_by_test_id('ladder-hearing').first.is_visible())
        check('0 page errors', [], errs)
        check('0 API errors', [], [x for x in bad if not x.startswith('409')])
        b.close()
    check('payroll tables untouched', payroll_before, [q(f'SELECT COUNT(*) n FROM {t}')[0]['n'] for t in ('day_calculations', 'salary_computations', 'early_exit_deductions')])
finally:
    srv.terminate()
print(f'\n{PASS} passed, {FAIL} failed')
raise SystemExit(1 if FAIL else 0)
