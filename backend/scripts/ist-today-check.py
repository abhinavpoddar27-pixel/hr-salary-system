#!/usr/bin/env python3
"""P2-03 — IST "today" in the browser, whatever its zone (findings D-11, P-17, X-14, FinanceAudit:525).

Chromium against the BUILT dist with the browser in UTC and the browser clock at 2026-10-10 19:00 UTC
= 00:30 IST on 11 Oct (only the page's clock is moved; the server keeps real time).
Scratch DATA_DIR, real hr / finance / admin logins, fictional data (contractor "Test Gang Alpha", code T9701).

Usage:
  python3 backend/scripts/ist-today-check.py                 # this tree
  APP_ROOT=/tmp/wt-base python3 .../ist-today-check.py --base # origin/main build: records the UTC (old) behaviour
Needs `npm run build --prefix frontend` in APP_ROOT. PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers. Port 3203.
"""
import datetime as dt, os, re, sqlite3, subprocess, sys, tempfile, time, urllib.request
from playwright.sync_api import sync_playwright

HERE_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
ROOT = os.path.abspath(os.environ.get('APP_ROOT', HERE_ROOT))
BASE_MODE = '--base' in sys.argv
PORT = int(os.environ.get('PORT', '3203')); BASE = f'http://127.0.0.1:{PORT}'
WORK = tempfile.mkdtemp(prefix='ist-today-'); DB = os.path.join(WORK, 'hr_system.db')
CLOCK = dt.datetime(2026, 10, 10, 19, 0, 0, tzinfo=dt.timezone.utc)   # 00:30 IST, 11 Oct 2026
IST_TODAY, UTC_TODAY = '2026-10-11', '2026-10-10'
PASS = FAIL = 0


def check(label, expected, actual):
    global PASS, FAIL
    if expected == actual: PASS += 1; print(f'  ✓ {label}')
    else: FAIL += 1; print(f'  ✗ {label} — expected {expected!r}, got {actual!r}')


def seed():
    c = sqlite3.connect(DB)
    cid = c.execute("INSERT INTO dw_contractors(contractor_name,current_daily_wage_rate,current_commission_rate) "
                    "VALUES('Test Gang Alpha',500,20)").lastrowid
    c.execute("INSERT INTO dw_entries(contractor_id,entry_date,in_time,out_time,total_worker_count,wage_rate_applied,"
              "commission_rate_applied,total_wage_amount,total_commission_amount,total_liability,gate_entry_reference,status) "
              "VALUES(?,'2026-10-09','08:00','17:00',2,500,20,1000,40,1040,'GT-T1','approved')", (cid,))
    c.execute("INSERT OR IGNORE INTO employees(code,name,department,company,status,employment_type,gross_salary) "
              "VALUES('T9701','TEST EMP 1','TEST DEPT','Asian Lakto Ind Ltd','Active','Permanent',20000)")
    # marked 19:00 UTC on 10 Oct = 00:30 IST on 11 Oct
    c.execute("INSERT INTO manual_attendance_flags(employee_code,employee_name,company,date,month,year,evidence_type,reason,"
              "marked_by,marked_at) VALUES('T9701','TEST EMP 1','Asian Lakto Ind Ltd','2026-10-09',10,2026,'other',"
              "'Test reason','hr','2026-10-10 19:00:00')")
    c.commit(); c.close()


def login(b, user, pw, width=1440):
    ctx = b.new_context(viewport={'width': width, 'height': 900}, timezone_id='UTC')
    ctx.clock.set_system_time(CLOCK)
    pg = ctx.new_page()
    errs, cons, bad = [], [], []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('console', lambda m: cons.append(m.text) if m.type == 'error' and 'vite.svg' not in m.text and '404' not in m.text else None)
    pg.on('response', lambda r: bad.append(f'{r.status} {r.url}') if '/api/' in r.url and r.status >= 400 else None)
    pg.goto(BASE + '/login'); pg.get_by_placeholder('admin').fill(user); pg.get_by_placeholder('••••••••').fill(pw)
    pg.get_by_role('button', name='Sign in').click(); pg.wait_for_url(lambda u: '/login' not in u)
    return pg, errs, cons, bad


def selector_bits(pg):
    pills = [t.strip() for t in pg.locator('button.rounded-full').all_inner_texts()
             if t.strip() in ('Today', 'Yesterday', 'This Week', 'Last Week', 'This Month', 'Last Month')]
    years = pg.locator('select').filter(has=pg.locator('option', has_text=re.compile(r'^20\d\d$'))).first
    yopts = [o.strip() for o in years.locator('option').all_inner_texts()]
    months = pg.locator('select').filter(has=pg.locator('option', has_text='September')).first
    return pills, yopts, months, years


env = dict(os.environ, DATA_DIR=WORK, JWT_SECRET='x', PORT=str(PORT), NODE_ENV='production',
           ADMIN_PASSWORD='Admin@123', HR_PASSWORD='Indriyan@2025', FINANCE_PASSWORD='Finance@2025')
srv = subprocess.Popen(['node', f'{ROOT}/backend/server.js'], env=env, stdout=open(f'{WORK}/log', 'w'), stderr=subprocess.STDOUT)
try:
    for _ in range(80):
        try: urllib.request.urlopen(BASE + '/api/version', timeout=2); break
        except Exception: time.sleep(.5)
    seed()
    print(f'App root: {ROOT}  mode: {"BASE (expect UTC dates)" if BASE_MODE else "fix"}  browser: UTC @ {CLOCK.isoformat()}')
    with sync_playwright() as p:
        b = p.chromium.launch()
        want = UTC_TODAY if BASE_MODE else IST_TODAY

        print('\n— hr: Daily Wage Entry —')
        pg, errs, cons, bad = login(b, 'hr', 'Indriyan@2025')
        check('browser clock really is 10 Oct 19:00 UTC', '2026-10-10T19:00', pg.evaluate('new Date().toISOString().slice(0,16)'))
        pg.goto(BASE + '/daily-wage/new'); pg.wait_for_load_state('networkidle')
        di = pg.locator('input[type=date]').first
        check(f'DW Entry default date = {want}', want, di.input_value())
        check(f'DW Entry max = {want}', want, di.get_attribute('max'))

        print('\n— hr: month-mode DateSelector (Extra Duty page) —')
        pg.goto(BASE + '/extra-duty-grants'); pg.wait_for_load_state('networkidle'); time.sleep(.5)
        if not pg.locator('button.rounded-full', has_text='Last Month').count():
            pg.goto(BASE + '/pipeline/miss-punch'); pg.wait_for_load_state('networkidle'); time.sleep(.5)
        pills, yopts, months, years = selector_bits(pg)
        if BASE_MODE:
            check('old: month mode shows 6 presets', 6, len(pills))
        else:
            check('month mode presets = This Month, Last Month', ['This Month', 'Last Month'], pills)
            check('year options = 2024…2027 (IST year −2…+1)', ['2024', '2025', '2026', '2027'], yopts)
            pg.locator('button.rounded-full', has_text='Last Month').first.click(); time.sleep(.3)
            check('Last Month → September 2026', ('9', '2026'), (months.input_value(), years.input_value()))
            pg.locator('button.rounded-full', has_text='This Month').first.click(); time.sleep(.3)
            check('This Month → October 2026 (IST month)', ('10', '2026'), (months.input_value(), years.input_value()))
        check('hr: 0 page errors', [], errs); check('hr: 0 console errors', [], cons); check('hr: 0 API ≥ 400', [], bad)

        if not BASE_MODE:
            print('\n— edge: a remembered year outside the window (2023) stays selectable —')
            url = pg.url
            pg.evaluate("""() => { const k = 'hr-system-store'; const v = JSON.parse(localStorage.getItem(k) || '{"state":{}}');
                          v.state.selectedYear = 2023; v.state.selectedMonth = 3; localStorage.setItem(k, JSON.stringify(v)) }""")
            pg.goto(url); pg.wait_for_load_state('networkidle'); time.sleep(.5)
            pills, yopts, months, years = selector_bits(pg)
            check('year options include 2023 + window', ['2023', '2024', '2025', '2026', '2027'], yopts)
            check('select shows March 2023 (not blank)', ('3', '2023'), (months.input_value(), years.input_value()))
            pg.locator('button.rounded-full', has_text='This Month').first.click(); time.sleep(.3)
            check('This Month from 2023 → October 2026', ('10', '2026'), (months.input_value(), years.input_value()))
            check('edge: 0 page errors', [], errs)

        print('\n— admin: Analytics range presets —')
        pg, errs, cons, bad = login(b, 'admin', 'Admin@123')
        pg.goto(BASE + '/analytics/overview'); pg.wait_for_load_state('networkidle'); time.sleep(.5)
        pg.locator('button.rounded-full', has_text=re.compile('^Today$')).first.click(); time.sleep(.3)
        ds = pg.locator('input[type=date]')
        check(f'range Today → {want} … {want}', (want, want), (ds.nth(0).input_value(), ds.nth(1).input_value()))
        pg.locator('button.rounded-full', has_text=re.compile('^Yesterday$')).first.click(); time.sleep(.3)
        yd = '2026-10-09' if BASE_MODE else '2026-10-10'
        check(f'range Yesterday → {yd}', (yd, yd), (ds.nth(0).input_value(), ds.nth(1).input_value()))
        if not BASE_MODE:
            pg.locator('button.rounded-full', has_text=re.compile('^This Week$')).first.click(); time.sleep(.3)
            # 11 Oct 2026 is a Sunday → the IST week started Monday 5 Oct
            check('range This Week → 2026-10-05 … 2026-10-11', ('2026-10-05', IST_TODAY), (ds.nth(0).input_value(), ds.nth(1).input_value()))
            pg.locator('button.rounded-full', has_text=re.compile('^Last Month$')).first.click(); time.sleep(.3)
            check('range Last Month → 2026-09-01 … 2026-09-30', ('2026-09-01', '2026-09-30'), (ds.nth(0).input_value(), ds.nth(1).input_value()))
        check('admin: 0 page errors', [], errs)

        print('\n— finance: DW Payments + Finance Audit flags —')
        pg, errs, cons, bad = login(b, 'finance', 'Finance@2025')
        pg.goto(BASE + '/daily-wage/finance/payments'); pg.wait_for_load_state('networkidle'); time.sleep(.5)
        pg.get_by_role('button', name='Pay', exact=True).first.click(); time.sleep(.5)
        pd = pg.locator('input[type=date]').first
        check(f'DW Payments payment date = {want}', want, pd.input_value())
        pg.goto(BASE + '/finance-audit'); pg.wait_for_load_state('networkidle')
        pg.get_by_role('button', name=re.compile('Attendance Flags')).first.click(); pg.wait_for_load_state('networkidle'); time.sleep(.5)
        row = pg.locator('table tbody tr', has_text='T9701').first
        cells = [c.strip() for c in row.locator('td').all_inner_texts()]
        when = cells[6] if len(cells) > 6 else None
        check('flags "When" column', '—' if BASE_MODE else '11 Oct, 00:30', when)
        if not BASE_MODE:
            check('finance: 0 page errors', [], errs); check('finance: 0 console errors', [], cons); check('finance: 0 API ≥ 400', [], bad)

        if not BASE_MODE:
            print('\n— hr at 390 px: DW Entry —')
            pg, errs, cons, bad = login(b, 'hr', 'Indriyan@2025', width=390)
            pg.goto(BASE + '/daily-wage/new'); pg.wait_for_load_state('networkidle')
            check('390 px: DW Entry default date', IST_TODAY, pg.locator('input[type=date]').first.input_value())
            check('390 px: 0 page errors', [], errs)
        b.close()
finally:
    srv.terminate()
print(f'\n{PASS}/{PASS + FAIL} passed')
sys.exit(1 if FAIL else 0)
