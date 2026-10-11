#!/usr/bin/env python3
"""Payable OT: the legacy "Grant Extra Duty" tab is gone (P1-07, owner Q5) — browser check.

Chromium against the BUILT dist, real hr + finance logins, scratch DATA_DIR, fictional data only
(T97xx, "TEST EMP n" — the repo is public). Seeds one salary row with ED pay and one legacy
day_corrections extra_duty row.

Checks: no Grant Extra Duty tab; the register still renders the seeded row; the pointer links to
/extra-duty-grants and opens it; POST grant / DELETE revoke from the page → 410 and the
day_corrections table is byte-identical; phone width; 0 page/console errors.

Usage:
  python3 backend/scripts/legacy-ed-grant-retired-check.py
  APP_ROOT=/tmp/wt-main python3 .../legacy-ed-grant-retired-check.py --base   # origin/main: tab present, grant writes
Needs `npm run build --prefix frontend` in APP_ROOT first. PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers.
"""
import os, shutil, sqlite3, subprocess, sys, tempfile, time, urllib.request
from playwright.sync_api import sync_playwright

ROOT = os.path.abspath(os.environ.get('APP_ROOT', os.path.join(os.path.dirname(__file__), '..', '..')))
BASE_MODE = '--base' in sys.argv
PORT = int(os.environ.get('PORT', '3107')); BASE = f'http://127.0.0.1:{PORT}'
WORK = tempfile.mkdtemp(prefix='p107-'); DB = os.path.join(WORK, 'hr_system.db')
C = 'Asian Lakto Ind Ltd'
PASS = FAIL = 0


def check(label, expected, actual):
    global PASS, FAIL
    if expected == actual: PASS += 1; print(f'  ✓ {label}')
    else: FAIL += 1; print(f'  ✗ {label} — expected {expected!r}, got {actual!r}')


def seed():
    c = sqlite3.connect(DB)
    for code, name in (('T9701', 'TEST EMP 1'), ('T9702', 'TEST EMP 2')):
        c.execute("INSERT OR IGNORE INTO employees(code,name,department,company,status,employment_type,gross_salary) "
                  "VALUES(?,?,'TEST DEPT',?,'Active','Permanent',26000)", (code, name, C))
    c.execute("INSERT INTO salary_computations(employee_code,month,year,company,gross_salary,gross_earned,"
              "total_deductions,net_salary,ot_pay,ot_days,ed_days,ed_pay,total_payable,take_home) "
              "VALUES('T9701',9,2026,?,26000,26000,0,26000,0,0,1,866.67,26000,26866.67)", (C,))
    eid = c.execute("SELECT id FROM employees WHERE code='T9702'").fetchone()[0]
    c.execute("INSERT INTO day_corrections(employee_id,employee_code,month,year,company,original_system_days,"
              "corrected_days,correction_delta,correction_reason,corrected_by,correction_type,finance_verified,remark) "
              "VALUES(?, 'T9702',9,2026,?,0,2,2,'EXTRA_DUTY','test','extra_duty',1,'legacy test row')", (eid, C))
    c.commit(); c.close()


def dc_snapshot():
    c = sqlite3.connect(DB); r = c.execute('SELECT * FROM day_corrections ORDER BY id').fetchall(); c.close(); return r


def login(b, user, pw, width=1440):
    ctx = b.new_context(viewport={'width': width, 'height': 900}); pg = ctx.new_page()
    errs, cons, bad = [], [], []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('console', lambda m: cons.append(m.text) if m.type == 'error' and 'vite.svg' not in m.text and '404' not in m.text and '410' not in m.text else None)
    pg.on('response', lambda r: bad.append(f'{r.status} {r.url}') if '/api/' in r.url and r.status >= 400 and r.status != 410 else None)
    pg.goto(BASE + '/login'); pg.get_by_placeholder('admin').fill(user); pg.get_by_placeholder('••••••••').fill(pw)
    pg.get_by_role('button', name='Sign in').click(); pg.wait_for_url(lambda u: '/login' not in u)
    return pg, errs, cons, bad


def open_page(pg):
    pg.goto(BASE + '/payable-ot'); pg.wait_for_load_state('networkidle')
    pg.locator('select').filter(has=pg.locator('option', has_text='September')).first.select_option('9')
    pg.locator('select').filter(has=pg.locator('option', has_text='2026')).first.select_option('2026')
    pg.wait_for_load_state('networkidle'); time.sleep(1)


def api(pg, method, path, body=None):
    return pg.evaluate("""async ([m, p, b]) => {
      const t = localStorage.getItem('hr_token');
      const r = await fetch('/api' + p, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) },
        credentials: 'include', body: b ? JSON.stringify(b) : undefined });
      let j = null; try { j = await r.json() } catch (e) {}
      return { status: r.status, body: j };
    }""", [method, path, body])


env = dict(os.environ, DATA_DIR=WORK, JWT_SECRET='x', PORT=str(PORT), NODE_ENV='production',
           ADMIN_PASSWORD='Admin@123', HR_PASSWORD='Indriyan@2025', FINANCE_PASSWORD='Finance@2025')
srv = subprocess.Popen(['node', f'{ROOT}/backend/server.js'], env=env, stdout=open(f'{WORK}/log', 'w'), stderr=subprocess.STDOUT)
try:
    for _ in range(80):
        try: urllib.request.urlopen(BASE + '/api/version', timeout=2); break
        except Exception: time.sleep(.5)
    seed()
    print(f'App root: {ROOT}  mode: {"BASE" if BASE_MODE else "fix"}')
    with sync_playwright() as p:
        b = p.chromium.launch()
        if BASE_MODE:
            pg, *_ = login(b, 'finance', 'Finance@2025'); open_page(pg)
            check('old code: Grant Extra Duty tab present', True, pg.get_by_role('button', name='Grant Extra Duty').count() > 0)
            before = dc_snapshot()
            r = api(pg, 'POST', '/payroll/grant-extra-duty', {'employeeCode': 'T9701', 'month': 9, 'year': 2026, 'days': 1})
            check('old code: grant answers 200 "granted"', 200, r['status'])
            check('old code: grant wrote a day_corrections row (never read by pay)', len(before) + 1, len(dc_snapshot()))
        else:
            for user, pw in (('finance', 'Finance@2025'), ('hr', 'Indriyan@2025')):
                print(f'\n— {user}: Payable OT Sep 2026 —')
                pg, errs, cons, bad = login(b, user, pw); open_page(pg)
                check(f'{user}: no Grant Extra Duty tab', 0, pg.get_by_role('button', name='Grant Extra Duty').count())
                check(f'{user}: no "Active Grants" list', 0, pg.get_by_text('Active Grants').count())
                check(f'{user}: register shows the seeded ED row', True, pg.locator('table tbody tr', has_text='T9701').count() > 0)
                check(f'{user}: Export CSV still there', True, pg.get_by_role('button', name='Export CSV').count() > 0)
                ptr = pg.get_by_test_id('ed-grant-pointer')
                check(f'{user}: pointer text shown', True, ptr.count() == 1 and 'finance approves' in ptr.inner_text())
                check(f'{user}: pointer links to /extra-duty-grants', '/extra-duty-grants',
                      ptr.get_by_role('link').get_attribute('href'))
                before = dc_snapshot()
                r = api(pg, 'POST', '/payroll/grant-extra-duty', {'employeeCode': 'T9701', 'month': 9, 'year': 2026, 'days': 1})
                check(f'{user}: POST grant → 410', 410, r['status'])
                r2 = api(pg, 'DELETE', '/payroll/revoke-extra-duty/1')
                check(f'{user}: DELETE revoke → 410', 410, r2['status'])
                check(f'{user}: day_corrections unchanged', before, dc_snapshot())
                r3 = api(pg, 'GET', '/payroll/extra-duty-grants?month=9&year=2026')
                check(f'{user}: read-only list still returns the legacy row', (200, 1), (r3['status'], len((r3['body'] or {}).get('data', []))))
                check(f'{user}: 0 page errors', [], errs)
                check(f'{user}: 0 console errors', [], cons)
                check(f'{user}: 0 API ≥ 400 (410s are the test)', [], bad)

            print('\n— user sim: finance clicks the pointer link —')
            pg, errs, cons, bad = login(b, 'finance', 'Finance@2025'); open_page(pg)
            pg.get_by_test_id('ed-grant-pointer').get_by_role('link').click(); pg.wait_for_load_state('networkidle')
            check('sim: landed on /extra-duty-grants', True, pg.url.endswith('/extra-duty-grants'))
            check('sim: 0 page errors', [], errs)

            print('\n— edge: phone width 390px (hr) —')
            pg, errs, cons, bad = login(b, 'hr', 'Indriyan@2025', width=390); open_page(pg)
            check('phone: pointer visible', True, pg.get_by_test_id('ed-grant-pointer').is_visible())
            check('phone: no Grant tab', 0, pg.get_by_role('button', name='Grant Extra Duty').count())
            check('phone: 0 page errors', [], errs)
        b.close()
finally:
    srv.terminate(); shutil.rmtree(WORK, ignore_errors=True)

print(f'\n{PASS} passed, {FAIL} failed')
sys.exit(1 if FAIL else 0)
