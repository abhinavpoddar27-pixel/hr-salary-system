#!/usr/bin/env python3
"""Reports → Payslips: no bulk-payslip button / no 403 (P1-21, finding H-9) — browser check.

Bulk payslips are disabled by company policy: GET /api/payroll/payslips/bulk always answers 403.
The fix replaces the Reports "Download All Payslips (PDF)" button with a note + "Open Stage 7" link.

Chromium against the BUILT dist, real hr + finance logins, scratch DATA_DIR with fictional data
(codes T21xx, names "TEST EMP n" — the repo is public).

Usage:
  python3 backend/scripts/reports-bulk-payslips-check.py               # this tree's server + dist
  APP_ROOT=/tmp/wt python3 .../reports-bulk-payslips-check.py --base   # another tree (e.g. origin/main):
                                                                        # records the click → 403
Needs `npm run build --prefix frontend` in APP_ROOT first. PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers.
"""
import os, re, shutil, sqlite3, subprocess, sys, tempfile, time, urllib.request
from playwright.sync_api import sync_playwright

HERE_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
ROOT = os.path.abspath(os.environ.get('APP_ROOT', HERE_ROOT))
BASE_MODE = '--base' in sys.argv
PORT = int(os.environ.get('PORT', '3121')); BASE = f'http://127.0.0.1:{PORT}'
WORK = tempfile.mkdtemp(prefix='p121-'); DB = os.path.join(WORK, 'hr_system.db')
C = 'Asian Lakto Ind Ltd'
PASS = FAIL = 0
NOTE = 'Bulk payslips are disabled by company policy.'


def check(label, expected, actual):
    global PASS, FAIL
    if expected == actual: PASS += 1; print(f'  ✓ {label}')
    else: FAIL += 1; print(f'  ✗ {label} — expected {expected!r}, got {actual!r}')


def seed():
    c = sqlite3.connect(DB)
    for i, (code, gross, net) in enumerate((('T2101', 30000, 28200), ('T2102', 20000, 18650)), 1):
        c.execute("INSERT OR IGNORE INTO employees(code,name,department,company,status,employment_type,gross_salary) "
                  "VALUES(?,?,'TEST DEPT',?,'Active','Permanent',?)", (code, f'TEST EMP {i}', C, gross))
        c.execute("INSERT INTO day_calculations(employee_code,month,year,company,total_payable_days) VALUES(?,9,2026,?,26)", (code, C))
        c.execute("INSERT INTO salary_computations(employee_code,month,year,company,payable_days,gross_salary,basic_earned,"
                  "gross_earned,total_deductions,net_salary,salary_held) VALUES(?,9,2026,?,26,?,?,?,?,?,0)",
                  (code, C, gross, gross / 2, gross, gross - net, net))
    c.commit(); c.close()


def login(b, user, pw, width=1440):
    ctx = b.new_context(viewport={'width': width, 'height': 900})
    pg = ctx.new_page()
    errs, cons, bad, bulk = [], [], [], []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('console', lambda m: cons.append(m.text) if m.type == 'error' and 'vite.svg' not in m.text and '404' not in m.text else None)
    pg.on('request', lambda r: bulk.append(r.url) if 'payslips/bulk' in r.url else None)
    pg.on('response', lambda r: bad.append(f'{r.status} {r.url}') if '/api/' in r.url and r.status >= 400 else None)
    pg.goto(BASE + '/login'); pg.get_by_placeholder('admin').fill(user); pg.get_by_placeholder('••••••••').fill(pw)
    pg.get_by_role('button', name='Sign in').click(); pg.wait_for_url(lambda u: '/login' not in u)
    return pg, errs, cons, bad, bulk


def open_tab(pg, name_re):
    pg.goto(BASE + '/reports'); pg.wait_for_load_state('networkidle')
    pg.locator('select').filter(has=pg.locator('option', has_text='September')).first.select_option('9')
    pg.locator('select').filter(has=pg.locator('option', has_text='2026')).first.select_option('2026')
    pg.get_by_role('button', name=re.compile(name_re)).first.click()
    pg.wait_for_load_state('networkidle'); time.sleep(1)


env = dict(os.environ, DATA_DIR=WORK, JWT_SECRET='x', PORT=str(PORT), NODE_ENV='production',
           ADMIN_PASSWORD='Admin@123', HR_PASSWORD='Indriyan@2025', FINANCE_PASSWORD='Finance@2025')
srv = subprocess.Popen(['node', f'{ROOT}/backend/server.js'], env=env, stdout=open(f'{WORK}/log', 'w'), stderr=subprocess.STDOUT)
try:
    for _ in range(80):
        try: urllib.request.urlopen(BASE + '/api/version', timeout=2); break
        except Exception: time.sleep(.5)
    seed()
    print(f'App root: {ROOT}  mode: {"BASE (expect click → 403)" if BASE_MODE else "fix"}')

    with sync_playwright() as p:
        b = p.chromium.launch()
        if BASE_MODE:
            pg, errs, cons, bad, bulk = login(b, 'hr', 'Indriyan@2025')
            open_tab(pg, r'^Payslips \(Bulk PDF\)')
            btn = pg.get_by_role('button', name='Download All Payslips (PDF)')
            check('old code: bulk button present', 1, btn.count())
            with pg.expect_response(lambda r: 'payslips/bulk' in r.url) as resp:
                btn.click()
            check('old code: click → GET /payslips/bulk', True, len(bulk) >= 1)
            check('old code: answer 403', 403, resp.value.status)
            check('old code: error toast', True, pg.get_by_text('Failed to generate payslips').count() > 0)
            b.close()
        else:
            for user, pw in (('hr', 'Indriyan@2025'), ('finance', 'Finance@2025')):
                print(f'\n— {user}: Reports → Payslips —')
                pg, errs, cons, bad, bulk = login(b, user, pw)
                pg.goto(BASE + '/reports'); pg.wait_for_load_state('networkidle')
                item = pg.get_by_role('button', name=re.compile(r'^Payslips'))
                item.first.wait_for(timeout=10000)
                check(f'{user}: list item labelled "Payslips"', 1, item.count())
                check(f'{user}: old label "Payslips (Bulk PDF)" gone', 0, pg.get_by_text('Payslips (Bulk PDF)').count())
                open_tab(pg, r'^Payslips')
                note = pg.get_by_test_id('bulk-payslips-disabled-note')
                check(f'{user}: note visible', True, note.is_visible())
                check(f'{user}: note text', True, NOTE in note.inner_text())
                check(f'{user}: heading Payslips — Sep 2026', 1, pg.get_by_role('heading', name='Payslips — Sep 2026').count())
                check(f'{user}: no "Download All Payslips" button', 0, pg.get_by_text('Download All Payslips').count())
                # other tabs still open
                pg.get_by_role('button', name=re.compile('^Salary Register')).click(); pg.wait_for_load_state('networkidle'); time.sleep(1)
                check(f'{user}: Salary Register tab still works (T2101 row)', True, pg.get_by_text('T2101').count() > 0)
                pg.get_by_role('button', name=re.compile('^Attendance Summary')).click(); pg.wait_for_load_state('networkidle'); time.sleep(.5)
                pg.get_by_role('button', name=re.compile(r'^Payslips')).first.click(); time.sleep(.5)
                link = pg.get_by_test_id('open-stage7-link')
                check(f'{user}: "Open Stage 7" link href', '/pipeline/salary', link.get_attribute('href'))
                link.click(); pg.wait_for_url(lambda u: u.endswith('/pipeline/salary'), timeout=10000)
                pg.wait_for_load_state('networkidle'); time.sleep(1.5)
                check(f'{user}: link opens Stage 7', True, pg.url.endswith('/pipeline/salary'))
                ps = pg.locator('button[title="Payslip"]')
                if ps.count() > 0:
                    ps.first.click(); time.sleep(1.5)
                    check(f'{user}: Stage 7 individual payslip opens', True, pg.get_by_text(re.compile(r'^Payslip — ')).count() > 0)
                else:
                    check(f'{user}: Stage 7 shows a Payslip button for the seeded month', True, False)
                check(f'{user}: 0 requests to /payslips/bulk', [], bulk)
                check(f'{user}: 0 page errors', [], errs)
                check(f'{user}: 0 console errors', [], cons)
                check(f'{user}: 0 API ≥ 400', [], bad)

            print('\n— phone width 390px (hr) —')
            pg, errs, cons, bad, bulk = login(b, 'hr', 'Indriyan@2025', width=390)
            open_tab(pg, r'^Payslips')
            note = pg.get_by_test_id('bulk-payslips-disabled-note')
            check('phone: note visible', True, note.is_visible())
            box = note.bounding_box()
            check('phone: note fits the screen', True, box['x'] >= 0 and box['x'] + box['width'] <= 391)
            check('phone: 0 requests to /payslips/bulk', [], bulk)
            check('phone: 0 page errors', [], errs)
            check('phone: 0 API ≥ 400', [], bad)
            b.close()
finally:
    srv.terminate(); shutil.rmtree(WORK, ignore_errors=True)

print(f'\n{PASS} passed, {FAIL} failed')
sys.exit(1 if FAIL else 0)
