#!/usr/bin/env python3
"""Sales → Employee Master → Mark Left stores the chosen leaving date (P1-19, finding S-3) — browser check.

Chromium against the BUILT dist, real hr login, scratch DATA_DIR with fictional sales reps (codes S90x,
names "TEST REP n" — the repo is public).

Usage:
  python3 backend/scripts/sales-mark-left-date-check.py               # this tree's server + dist
  APP_ROOT=/tmp/wt python3 .../sales-mark-left-date-check.py --base   # another tree (e.g. origin/main):
                                                                       # records "today stored regardless"
Needs `npm run build --prefix frontend` in APP_ROOT first. PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers.
"""
import datetime, json, os, re, shutil, sqlite3, subprocess, sys, tempfile, time, urllib.request
from playwright.sync_api import sync_playwright

HERE_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
ROOT = os.path.abspath(os.environ.get('APP_ROOT', HERE_ROOT))
BASE_MODE = '--base' in sys.argv
PORT = int(os.environ.get('PORT', '3119')); BASE = f'http://127.0.0.1:{PORT}'
WORK = tempfile.mkdtemp(prefix='sales-ml-'); DB = os.path.join(WORK, 'hr_system.db')
C = 'Indriyan Beverages'
PASS = FAIL = 0
statuses = []
TODAY = datetime.date.today()
FUTURE = (TODAY + datetime.timedelta(days=5)).isoformat()

# code, name, doj
REPS = [('S901', 'TEST REP 1', '2026-01-15'), ('S902', 'TEST REP 2', '2025-06-01'),
        ('S903', 'TEST REP 3', None), ('S904', 'TEST REP 4', '2025-03-01'), ('S905', 'TEST REP 5', '2025-03-01')]


def check(label, expected, actual):
    global PASS, FAIL
    if expected == actual: PASS += 1; print(f'  ✓ {label}')
    else: FAIL += 1; print(f'  ✗ {label} — expected {expected!r}, got {actual!r}')


def seed():
    c = sqlite3.connect(DB)
    for code, name, doj in REPS:
        c.execute("INSERT INTO sales_employees(code,name,doj,company,status,gross_salary,designation) "
                  "VALUES(?,?,?,?,'Active',20000,'TEST')", (code, name, doj, C))
    c.commit(); c.close()


def rep(code):
    c = sqlite3.connect(DB); r = c.execute("SELECT status, dol FROM sales_employees WHERE code=?", (code,)).fetchone()
    c.close(); return r


def audit_remark(code):
    c = sqlite3.connect(DB)
    r = c.execute("SELECT remark FROM audit_log WHERE employee_code=? AND action_type='mark_left' ORDER BY id DESC LIMIT 1",
                  (code,)).fetchone()
    c.close(); return r[0] if r else None


def login(b, width=1440):
    ctx = b.new_context(viewport={'width': width, 'height': 900})
    pg = ctx.new_page()
    errs, cons, bad, puts = [], [], [], []
    statuses.clear()
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('console', lambda m: cons.append(m.text) if m.type == 'error' and 'vite.svg' not in m.text and '404' not in m.text else None)
    pg.on('response', lambda r: bad.append(f'{r.status} {r.url}') if '/api/' in r.url and r.status >= 400 else None)
    pg.on('response', lambda r: statuses.append(r.status) if r.request.method == 'PUT' and '/mark-left' in r.url else None)
    pg.on('request', lambda r: puts.append((r.url, r.post_data)) if r.method == 'PUT' and '/mark-left' in r.url else None)
    pg.goto(BASE + '/login'); pg.get_by_placeholder('admin').fill('hr'); pg.get_by_placeholder('••••••••').fill('Indriyan@2025')
    pg.get_by_role('button', name='Sign in').click(); pg.wait_for_url(lambda u: '/login' not in u)
    pg.goto(BASE + '/sales/employees'); pg.wait_for_load_state('networkidle')
    pg.locator('tr', has_text='S901').first.wait_for()
    return pg, errs, cons, bad, puts


def open_dialog(pg, code):
    pg.locator('tr', has_text=code).first.get_by_role('button', name='Mark Left').click()
    if not BASE_MODE:
        pg.get_by_test_id('sales-mark-left-dialog').wait_for()


def dialog_open(pg):
    return pg.get_by_test_id('sales-mark-left-dialog').count()


env = dict(os.environ, DATA_DIR=WORK, JWT_SECRET='x', PORT=str(PORT), NODE_ENV='production',
           ADMIN_PASSWORD='Admin@123', HR_PASSWORD='Indriyan@2025', FINANCE_PASSWORD='Finance@2025')
srv = subprocess.Popen(['node', f'{ROOT}/backend/server.js'], env=env, stdout=open(f'{WORK}/log', 'w'), stderr=subprocess.STDOUT)
try:
    for _ in range(80):
        try: urllib.request.urlopen(BASE + '/api/version', timeout=2); break
        except Exception: time.sleep(.5)
    seed()
    print(f'App root: {ROOT}  mode: {"BASE (expect today stored)" if BASE_MODE else "fix"}')

    with sync_playwright() as p:
        b = p.chromium.launch()
        if BASE_MODE:
            pg, errs, cons, bad, puts = login(b)
            open_dialog(pg, 'S901')
            check('base: no leaving-date field', 0, pg.locator('input[type=date]').count())
            pg.locator('div.fixed button', has_text='Mark Left').last.click()
            pg.wait_for_load_state('networkidle'); pg.wait_for_timeout(500)
            check('base: PUT body has no dol', 1, sum(1 for _, d in puts if 'dol' not in (d or '')))
            st, dol = rep('S901')
            check('base: status Left', 'Left', st)
            check('base: dol = today (UTC) regardless', datetime.datetime.utcnow().date().isoformat(), dol)
        else:
            pg, errs, cons, bad, puts = login(b)
            print('— S901 (DOJ 15-01-2026): validation then a past date —')
            open_dialog(pg, 'S901')
            dol_in = pg.get_by_test_id('sales-mark-left-dol'); btn = pg.get_by_test_id('sales-mark-left-confirm')
            hint = pg.get_by_test_id('sales-mark-left-hint')
            check('opens empty', '', dol_in.input_value())
            check('empty: button disabled', True, btn.is_disabled())
            check('empty: hint', 'Pick the leaving date', hint.inner_text())
            check('max = today (local)', TODAY.isoformat(), dol_in.get_attribute('max'))
            check('min = DOJ', '2026-01-15', dol_in.get_attribute('min'))
            dol_in.fill(FUTURE)
            check('future: button disabled', True, btn.is_disabled())
            check('future: hint', "Leaving date can't be in the future", hint.inner_text())
            dol_in.fill('2025-12-01')
            check('before DOJ: button disabled', True, btn.is_disabled())
            check('before DOJ: hint', "Leaving date can't be before the joining date (15-01-2026)", hint.inner_text())
            dol_in.fill(TODAY.isoformat())
            check('today: button enabled', False, btn.is_disabled())
            dol_in.fill('2026-09-20')
            check('past date: button enabled, no hint', (False, 0), (btn.is_disabled(), hint.count()))
            btn.click(); pg.wait_for_load_state('networkidle'); pg.wait_for_timeout(700)
            check('one PUT sent', 1, len(puts))
            check('PUT body = {dol}', {'dol': '2026-09-20'}, json.loads(puts[0][1] or '{}'))
            check('DB status Left + dol = chosen date', ('Left', '2026-09-20'), rep('S901'))
            check('audit remark carries the date', True, 'dol=2026-09-20' in (audit_remark('S901') or ''))
            check('dialog closed after save', 0, dialog_open(pg))
            check('row shows Left', True, 'Left' in pg.locator('tr', has_text='S901').first.inner_text())

            print('— S902: every way out sends nothing —')
            for way in ('Cancel', 'close-x', 'backdrop', 'Escape'):
                open_dialog(pg, 'S902')
                check(f'{way}: reopened empty', '', pg.get_by_test_id('sales-mark-left-dol').input_value())
                pg.get_by_test_id('sales-mark-left-dol').fill('2026-08-10')
                if way == 'Cancel': pg.get_by_test_id('sales-mark-left-dialog').get_by_role('button', name='Cancel').click()
                elif way == 'close-x': pg.locator('div.fixed h3', has_text='Mark S902').locator('xpath=..').locator('button').click()
                elif way == 'backdrop': pg.mouse.click(720, 880)
                else: pg.keyboard.press('Escape')
                pg.wait_for_timeout(300)
                check(f'{way}: dialog closed', 0, dialog_open(pg))
            check('no PUT for S902', 1, len(puts))
            check('S902 still Active, no dol', ('Active', None), rep('S902'))

            print('— S903 (no DOJ): any past date allowed —')
            open_dialog(pg, 'S903')
            check('no DOJ: no min', None, pg.get_by_test_id('sales-mark-left-dol').get_attribute('min'))
            pg.get_by_test_id('sales-mark-left-dol').fill('2020-01-01')
            check('no DOJ: old date enabled', False, pg.get_by_test_id('sales-mark-left-confirm').is_disabled())
            pg.get_by_test_id('sales-mark-left-confirm').dblclick(); pg.wait_for_load_state('networkidle'); pg.wait_for_timeout(700)
            check('double click: one PUT', 2, len(puts))
            check('S903 dol stored', ('Left', '2020-01-01'), rep('S903'))
            check('0 page errors', [], errs)
            check('0 console errors', [], cons)
            pg.wait_for_timeout(500)
            check('every mark-left PUT answered 200', [200, 200], statuses)
            check('0 API ≥ 400', [], bad)

            print('— phone 390px: S904 —')
            pg, errs, cons, bad, puts = login(b, width=390)
            open_dialog(pg, 'S904')
            box = pg.get_by_test_id('sales-mark-left-confirm').bounding_box()
            check('phone: confirm button inside the screen', True, box is not None and box['x'] + box['width'] <= 390)
            pg.get_by_test_id('sales-mark-left-dol').fill('2026-07-31')
            pg.get_by_test_id('sales-mark-left-confirm').click(); pg.wait_for_load_state('networkidle'); pg.wait_for_timeout(700)
            check('phone: dol stored', ('Left', '2026-07-31'), rep('S904'))
            check('phone: 0 page errors', [], errs)
            check('phone: 0 API ≥ 400', [], bad)
            check('S905 untouched', ('Active', None), rep('S905'))
        b.close()
finally:
    srv.terminate(); shutil.rmtree(WORK, ignore_errors=True)

print(f'\n{PASS} passed, {FAIL} failed')
sys.exit(1 if FAIL else 0)
