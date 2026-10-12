#!/usr/bin/env python3
"""P3-IST — remaining "today" defaults follow IST, whatever the browser zone.

Chromium against the BUILT dist, browser zone UTC, browser clock 2026-10-10 19:00 UTC = 00:30 IST on 11 Oct
(only the page clock moves; the server keeps real time). Scratch DATA_DIR, real hr / finance / admin logins,
fictional data only (contractor "Test Gang Alpha", employee T9601 "TEST EMP 1").

Sites: Gate Pass create date + allowance month, DW Contractors rate-change effective date, Employees Mark Left
date + export filename, Employee Profile from/to, Dept Analytics range (request params), DW Finance Review
"Recently Approved" date_from (request param), Daily MIS date. Edge: 31 Aug IST (6-months-back rollover) and
1 Nov IST (month boundary on the gate pass allowance label).

Usage:
  python3 backend/scripts/ist-today-remaining-check.py
  APP_ROOT=/tmp/wt-base python3 .../ist-today-remaining-check.py --base   # origin/main build: UTC (old) values
Needs `npm run build --prefix frontend` in APP_ROOT. PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers. Port 3405.
"""
import datetime as dt, os, re, sqlite3, subprocess, sys, tempfile, time, urllib.parse, urllib.request
from playwright.sync_api import sync_playwright

HERE_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
ROOT = os.path.abspath(os.environ.get('APP_ROOT', HERE_ROOT))
BASE_MODE = '--base' in sys.argv
PORT = int(os.environ.get('PORT', '3405')); BASE = f'http://127.0.0.1:{PORT}'
WORK = tempfile.mkdtemp(prefix='ist-remaining-'); DB = os.path.join(WORK, 'hr_system.db')
UTC = dt.timezone.utc
CLOCK = dt.datetime(2026, 10, 10, 19, 0, 0, tzinfo=UTC)        # 00:30 IST, 11 Oct 2026
PASS = FAIL = 0


def check(label, expected, actual):
    global PASS, FAIL
    if expected == actual: PASS += 1; print(f'  ✓ {label}')
    else: FAIL += 1; print(f'  ✗ {label} — expected {expected!r}, got {actual!r}')


def seed():
    c = sqlite3.connect(DB)
    c.execute("INSERT INTO dw_contractors(contractor_name,current_daily_wage_rate,current_commission_rate) "
              "VALUES('Test Gang Alpha',500,20)")
    c.execute("INSERT OR IGNORE INTO employees(code,name,department,company,status,employment_type,gross_salary) "
              "VALUES('T9601','TEST EMP 1','TEST DEPT','Asian Lakto Ind Ltd','Active','Permanent',20000)")
    c.commit(); c.close()


def login(b, user, pw, clock=CLOCK, width=1440):
    ctx = b.new_context(viewport={'width': width, 'height': 900}, timezone_id='UTC', accept_downloads=True)
    ctx.clock.set_system_time(clock)
    pg = ctx.new_page()
    errs, cons, bad, reqs = [], [], [], []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('console', lambda m: cons.append(m.text) if m.type == 'error' and 'vite.svg' not in m.text and '404' not in m.text else None)
    pg.on('response', lambda r: bad.append(f'{r.status} {r.url}') if '/api/' in r.url and r.status >= 400 else None)
    pg.on('request', lambda r: reqs.append(r.url) if '/api/' in r.url else None)
    pg.goto(BASE + '/login'); pg.get_by_placeholder('admin').fill(user); pg.get_by_placeholder('••••••••').fill(pw)
    pg.get_by_role('button', name='Sign in').click(); pg.wait_for_url(lambda u: '/login' not in u)
    return pg, errs, cons, bad, reqs


def q(url, key):
    return (urllib.parse.parse_qs(urllib.parse.urlparse(url).query).get(key) or [None])[0]


def gate_pass_modal(pg):
    pg.goto(BASE + '/leave-management'); pg.wait_for_load_state('networkidle')
    pg.get_by_role('button', name='Gate Passes').first.click(); pg.wait_for_load_state('networkidle')
    pg.get_by_role('button', name=re.compile(r'New Gate Pass')).first.click(); time.sleep(.4)
    dlg = pg.get_by_role('dialog')
    dlg.get_by_placeholder('Search by name or code...').fill('T9601'); time.sleep(.3)
    dlg.get_by_role('button', name=re.compile('T9601')).first.click(); pg.wait_for_load_state('networkidle'); time.sleep(.3)
    label = dlg.locator('label', has_text='Allowance for').first.inner_text().strip()
    return dlg.locator('input[type=date]').first.input_value(), label


def profile_dates(pg):
    pg.goto(BASE + '/employee-profile'); pg.wait_for_load_state('networkidle')
    ds = pg.locator('input[type=date]')
    return ds.nth(0).input_value(), ds.nth(1).input_value()


env = dict(os.environ, DATA_DIR=WORK, JWT_SECRET='x', PORT=str(PORT), NODE_ENV='production',
           ADMIN_PASSWORD='Admin@123', HR_PASSWORD='Indriyan@2025', FINANCE_PASSWORD='Finance@2025')
def start_server():
    s = subprocess.Popen(['node', f'{ROOT}/backend/server.js'], env=env, stdout=open(f'{WORK}/log', 'a'), stderr=subprocess.STDOUT)
    for _ in range(80):
        try: urllib.request.urlopen(BASE + '/api/version', timeout=2); break
        except Exception: time.sleep(.5)
    return s


srv = start_server()
try:
    seed()
    print(f'App root: {ROOT}  mode: {"BASE (expect UTC dates)" if BASE_MODE else "fix"}  browser: UTC @ {CLOCK.isoformat()}')
    want = '2026-10-10' if BASE_MODE else '2026-10-11'
    with sync_playwright() as p:
        b = p.chromium.launch()

        print('\n— hr @ 00:30 IST 11 Oct —')
        pg, errs, cons, bad, reqs = login(b, 'hr', 'Indriyan@2025')
        check('browser clock is 10 Oct 19:00 UTC', '2026-10-10T19:00', pg.evaluate('new Date().toISOString().slice(0,16)'))
        d, lbl = gate_pass_modal(pg)
        check(f'Gate Pass date = {want}', want, d)
        check('Gate Pass allowance month = October 2026', 'Allowance for October 2026', lbl)
        pg.keyboard.press('Escape'); time.sleep(.3)

        pg.goto(BASE + '/daily-wage/contractors'); pg.wait_for_load_state('networkidle')
        pg.locator('tr', has_text='Test Gang Alpha').first.click(); time.sleep(.3)
        pg.get_by_role('button', name='Rate Change').first.click(); time.sleep(.3)
        check(f'DW rate change effective date = {want}', want, pg.locator('input[type=date]').first.input_value())

        pg.goto(BASE + '/employees'); pg.wait_for_load_state('networkidle')
        with pg.expect_download() as dl:
            pg.get_by_role('button', name='Export .xlsx').click()
        fn = dl.value.suggested_filename
        check(f'Employee export filename has {want}', True, fn.endswith(f'_{want}.xlsx'))
        pg.locator('tr', has_text='T9601').get_by_role('button', name='Mark Left').first.click(); time.sleep(.3)
        ml = pg.locator('div.max-w-md', has=pg.locator('h3', has_text='Mark Employee as Left'))
        check(f'Mark Left date = {want}', want, ml.locator('input[type=date]').first.input_value())
        ml.get_by_role('button', name='Cancel').click(); time.sleep(.3)

        pg.goto(BASE + '/daily-mis'); pg.wait_for_load_state('networkidle')
        # Daily MIS already computed IST by hand before this PR (now todayIST()) → IST in both modes
        check('Daily MIS date = 2026-10-11 (IST before and after)', '2026-10-11', pg.locator('input[type=date]').first.input_value())

        fr, to = profile_dates(pg)
        check('Employee Profile from/to', ('2026-04-10', want) if BASE_MODE else ('2026-04-11', want), (fr, to))
        if not BASE_MODE:
            check('hr: 0 page errors', [], errs); check('hr: 0 console errors', [], cons); check('hr: 0 API ≥ 400', [], bad)

        print('\n— admin: Dept Analytics range (request params) —')
        pg, errs, cons, bad, reqs = login(b, 'admin', 'Admin@123')
        pg.goto(BASE + '/dept-analytics'); pg.wait_for_load_state('networkidle'); time.sleep(.5)
        r = next((u for u in reqs if '/analytics/department-dashboard' in u), '')
        check('Dept Analytics request from/to', ('2026-04-10', want) if BASE_MODE else ('2026-04-11', want), (q(r, 'from'), q(r, 'to')))
        if not BASE_MODE:
            check('admin: 0 page errors', [], errs)

        print('\n— finance: DW Finance Review "Recently Approved" —')
        pg, errs, cons, bad, reqs = login(b, 'finance', 'Finance@2025')
        pg.goto(BASE + '/daily-wage/finance/review'); pg.wait_for_load_state('networkidle')
        reqs.clear()
        pg.get_by_role('button', name=re.compile('Recently Approved')).first.click(); pg.wait_for_load_state('networkidle'); time.sleep(.4)
        r = next((u for u in reqs if '/daily-wage/entries' in u and 'status=approved' in u), '')
        check('Recently Approved date_from', '2026-10-03' if BASE_MODE else '2026-10-04', q(r, 'date_from'))
        if not BASE_MODE:
            check('finance: 0 page errors', [], errs); check('finance: 0 console errors', [], cons); check('finance: 0 API ≥ 400', [], bad)

        if not BASE_MODE:
            # server.js login limiter is 5 per 15 min per IP — restart for a fresh window
            srv.terminate(); srv.wait(); srv = start_server()
            print('\n— edge: 00:30 IST 31 Aug (6 months back keeps JS rollover) —')
            pg, errs, *_ = login(b, 'hr', 'Indriyan@2025', clock=dt.datetime(2026, 8, 30, 19, 0, tzinfo=UTC))
            check('Profile from/to on 31 Aug', ('2026-03-03', '2026-08-31'), profile_dates(pg))

            print('\n— edge: 00:30 IST 1 Nov (month boundary) —')
            pg, errs, *_ = login(b, 'hr', 'Indriyan@2025', clock=dt.datetime(2026, 10, 31, 19, 0, tzinfo=UTC))
            d, lbl = gate_pass_modal(pg)
            check('Gate Pass date = 2026-11-01', '2026-11-01', d)
            check('allowance month = November 2026', 'Allowance for November 2026', lbl)
            check('edges: 0 page errors', [], errs)

            print('\n— hr at 390 px —')
            pg, errs, *_ = login(b, 'hr', 'Indriyan@2025', width=390)
            d, _ = gate_pass_modal(pg)
            check('390 px: Gate Pass date', '2026-10-11', d)
            check('390 px: no sideways scroll', True, pg.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1'))
            check('390 px: 0 page errors', [], errs)
        b.close()
finally:
    srv.terminate()
print(f'\n{PASS}/{PASS + FAIL} passed')
sys.exit(1 if FAIL else 0)
