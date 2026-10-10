#!/usr/bin/env python3
"""P1-25 F2 — Employee Master: Edit / Edit Details only for hr + admin (browser check).

Chromium against the BUILT dist, real logins (hr, finance; a viewer created through the admin API),
scratch DATA_DIR, fictional employees T25xx (repo is public). Port 3125.
  hr:       row "Edit" + drill-down "Edit Details" visible; Edit modal saves a designation change (200) and the
            row shows it; gross unchanged in the DB.
  finance:  Employee Master opens, no "Edit" / "Edit Details" (other buttons still there).
  viewer:   no "Edit" anywhere (no Employee Master permission at all).
  0 page errors, 0 console errors, 0 API >= 400 for hr and finance.

Usage:  python3 backend/scripts/employee-edit-gross-guard-check.py              # this tree's server + dist
        APP_ROOT=/tmp/wt python3 .../employee-edit-gross-guard-check.py --base  # old dist: finance sees Edit
Needs `npm run build --prefix frontend` in APP_ROOT first. PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers.
"""
import json, os, re, shutil, sqlite3, subprocess, sys, tempfile, time, urllib.request
from playwright.sync_api import sync_playwright

HERE_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
ROOT = os.path.abspath(os.environ.get('APP_ROOT', HERE_ROOT))
BASE_MODE = '--base' in sys.argv
PORT = int(os.environ.get('PORT', '3125')); BASE = f'http://127.0.0.1:{PORT}'
WORK = tempfile.mkdtemp(prefix='p125-ui-'); DB = os.path.join(WORK, 'hr_system.db')
C = 'Asian Lakto Ind Ltd'
PASS = FAIL = 0


def check(label, expected, actual):
    global PASS, FAIL
    if expected == actual: PASS += 1; print(f'  ✓ {label}')
    else: FAIL += 1; print(f'  ✗ {label} — expected {expected!r}, got {actual!r}')


def api(method, path, token=None, body=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(BASE + path, data=data, method=method,
                               headers={'Content-Type': 'application/json', **({'Authorization': f'Bearer {token}'} if token else {})})
    with urllib.request.urlopen(r, timeout=10) as res: return json.loads(res.read())


def seed():
    c = sqlite3.connect(DB)
    for code in ('T2511', 'T2512'):
        c.execute("INSERT OR IGNORE INTO employees(code,name,department,designation,company,status,employment_type,gross_salary,date_of_joining) "
                  "VALUES(?,?,'TEST DEPT','OPERATOR',?,'Active','Permanent',20000,'2024-01-01')", (code, f'TEST EMP {code}', C))
    c.commit(); c.close()


def login(b, user, pw):
    ctx = b.new_context(viewport={'width': 1440, 'height': 900})
    pg = ctx.new_page()
    errs, cons, bad = [], [], []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('console', lambda m: cons.append(m.text) if m.type == 'error' and 'vite.svg' not in m.text and '404' not in m.text else None)
    pg.on('response', lambda r: bad.append(f'{r.status} {r.url}') if '/api/' in r.url and r.status >= 400 else None)
    pg.goto(BASE + '/login'); pg.get_by_placeholder('admin').fill(user); pg.get_by_placeholder('••••••••').fill(pw)
    pg.get_by_role('button', name='Sign in').click(); pg.wait_for_url(lambda u: '/login' not in u)
    return pg, errs, cons, bad


def open_master(pg):
    pg.goto(BASE + '/employees'); pg.wait_for_load_state('networkidle'); time.sleep(1)


def row(pg, code):
    return pg.locator('table tbody tr', has_text=code).first


env = dict(os.environ, DATA_DIR=WORK, JWT_SECRET='x', PORT=str(PORT), NODE_ENV='production',
           ADMIN_PASSWORD='Admin@123', HR_PASSWORD='Indriyan@2025', FINANCE_PASSWORD='Finance@2025')
srv = subprocess.Popen(['node', f'{ROOT}/backend/server.js'], env=env, stdout=open(f'{WORK}/log', 'w'), stderr=subprocess.STDOUT)
try:
    for _ in range(80):
        try: urllib.request.urlopen(BASE + '/api/version', timeout=2); break
        except Exception: time.sleep(.5)
    seed()
    admin = api('POST', '/api/auth/login', body={'username': 'admin', 'password': 'Admin@123'})['token']
    api('POST', '/api/auth/users', admin, {'username': 'viewer25', 'password': 'Viewer@2025', 'role': 'viewer'})
    print(f'App root: {ROOT}  mode: {"BASE (old dist: finance sees Edit)" if BASE_MODE else "fix"}')

    with sync_playwright() as p:
        b = p.chromium.launch()
        if BASE_MODE:
            pg, *_ = login(b, 'finance', 'Finance@2025'); open_master(pg)
            r = row(pg, 'T2511'); r.wait_for(timeout=15000)
            check('old dist: finance sees the row "Edit" button', 1, r.get_by_role('button', name='Edit', exact=True).count())
        else:
            print('\n— hr —')
            pg, errs, cons, bad = login(b, 'hr', 'Indriyan@2025'); open_master(pg)
            r = row(pg, 'T2511'); r.wait_for(timeout=15000)
            check('hr: row Edit visible', 1, r.get_by_role('button', name='Edit', exact=True).count())
            r.locator('td').nth(2).click(); time.sleep(1)
            check('hr: drill-down Edit Details visible', True, pg.get_by_role('button', name='Edit Details').count() >= 1)
            r.get_by_role('button', name='Edit', exact=True).click()
            modal = pg.locator('div.fixed', has=pg.get_by_role('heading', name=re.compile('^Edit Employee'))).last
            modal.wait_for(timeout=10000)
            modal.locator('label:text-is("Designation") + input').fill('FITTER')
            with pg.expect_response(lambda res: res.request.method == 'PUT' and '/api/employees/T2511' in res.url) as resp:
                modal.get_by_role('button', name='Save', exact=True).click()
            check('hr: Edit modal Save → 200', 200, resp.value.status)
            time.sleep(1.5)
            c = sqlite3.connect(DB)
            check('hr: DB designation saved, gross unchanged', ('FITTER', 20000.0),
                  c.execute("SELECT designation, gross_salary FROM employees WHERE code='T2511'").fetchone()); c.close()
            check('hr: 0 page errors', [], errs); check('hr: 0 console errors', [], cons); check('hr: 0 API >= 400', [], bad)

            print('\n— finance —')
            pg, errs, cons, bad = login(b, 'finance', 'Finance@2025'); open_master(pg)
            r = row(pg, 'T2512'); r.wait_for(timeout=15000)
            check('finance: row Edit hidden', 0, r.get_by_role('button', name='Edit', exact=True).count())
            check('finance: other row buttons still there (Profile, ₹)', [1, 1],
                  [r.get_by_role('button', name='Profile').count(), r.get_by_role('button', name='₹').count()])
            r.locator('td').nth(2).click(); time.sleep(1)
            check('finance: drill-down Salary Structure shown', True, pg.get_by_role('button', name='Salary Structure').count() >= 1)
            check('finance: drill-down Edit Details hidden', 0, pg.get_by_role('button', name='Edit Details').count())
            check('finance: 0 page errors', [], errs); check('finance: 0 console errors', [], cons); check('finance: 0 API >= 400', [], bad)

            print('\n— viewer —')
            pg, errs, cons, bad = login(b, 'viewer25', 'Viewer@2025'); open_master(pg)
            check('viewer: no Edit / Edit Details anywhere', [0, 0],
                  [pg.get_by_role('button', name='Edit', exact=True).count(), pg.get_by_role('button', name='Edit Details').count()])
            check('viewer: 0 page errors', [], errs)
        b.close()
finally:
    srv.terminate(); srv.wait(timeout=10)
    shutil.rmtree(WORK, ignore_errors=True)
print(f'\n{PASS} passed, {FAIL} failed')
sys.exit(1 if FAIL else 0)
