#!/usr/bin/env python3
"""Stage 6 always runs for all companies (P1-04, finding P-2) — browser check.

Chromium against the BUILT dist, real logins, scratch DATA_DIR with fictional data (codes T96xx, names
"TEST EMP n" — the repo is public). September 2026, two companies:
  company A 'Asian Lakto Ind Ltd'        T9601, T9602, and T9605 whose month is SPLIT across labels
                                         (1–15 under A, 16–30 under 'Default') — the row a filtered run cuts
  company B 'Indriyan Beverages Pvt Ltd' T9603, T9604
Every employee: P Mon–Sat, WO on Sundays → 30 payable days when the whole month is read.

Usage:
  python3 backend/scripts/stage6-all-companies-check.py               # this tree's server + dist
  APP_ROOT=/tmp/wt python3 .../stage6-all-companies-check.py --base   # another tree (e.g. origin/main):
                                                                       # records the old company-scoped run
Needs `npm run build --prefix frontend` in APP_ROOT first. PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers.
"""
import datetime, json, os, re, shutil, sqlite3, subprocess, sys, tempfile, time, urllib.request
from playwright.sync_api import sync_playwright

HERE_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
ROOT = os.path.abspath(os.environ.get('APP_ROOT', HERE_ROOT))
BASE_MODE = '--base' in sys.argv
PORT = int(os.environ.get('PORT', '3104')); BASE = f'http://127.0.0.1:{PORT}'
WORK = tempfile.mkdtemp(prefix='stage6-all-'); DB = os.path.join(WORK, 'hr_system.db')
A, B = 'Asian Lakto Ind Ltd', 'Indriyan Beverages Pvt Ltd'
EMPS = [('T9601', A), ('T9602', A), ('T9603', B), ('T9604', B), ('T9605', A)]
SPLIT = 'T9605'
A_CODES = [c for c, co in EMPS if co == A]; B_CODES = [c for c, co in EMPS if co == B]
FULL = 30.0
PASS = FAIL = 0


def check(label, expected, actual):
    global PASS, FAIL
    if expected == actual: PASS += 1; print(f'  ✓ {label}')
    else: FAIL += 1; print(f'  ✗ {label} — expected {expected!r}, got {actual!r}')


def seed():
    c = sqlite3.connect(DB)
    for i, (code, co) in enumerate(EMPS, 1):
        c.execute("INSERT OR IGNORE INTO employees(code,name,department,company,status,employment_type,gross_salary,"
                  "date_of_joining,weekly_off_day) VALUES(?,?,'TEST DEPT',?,'Active','Permanent',20000,'2025-01-01',0)",
                  (code, f'TEST EMP {i}', co))
    for d in range(1, 31):
        dt = datetime.date(2026, 9, d)
        st = 'WO' if dt.weekday() == 6 else 'P'
        tin, tout = ('', '') if st == 'WO' else ('09:00', '18:00')
        for code, co in EMPS:
            label = 'Default' if (code == SPLIT and d > 15) else co
            c.execute("INSERT INTO attendance_processed(employee_code,date,status_original,status_final,in_time_original,"
                      "in_time_final,out_time_original,out_time_final,month,year,company,stage_5_done) "
                      "VALUES(?,?,?,?,?,?,?,?,9,2026,?,1)", (code, dt.isoformat(), st, st, tin, tin, tout, tout, label))
    for label in (A, B, 'Default'):
        c.execute("INSERT OR IGNORE INTO monthly_imports(month,year,company,stage_1_done,stage_5_done) VALUES(9,2026,?,1,1)", (label,))
    c.commit(); c.close()


def db_rows():
    c = sqlite3.connect(DB)
    r = {code: (co, days) for code, co, days in c.execute(
        "SELECT employee_code, company, total_payable_days FROM day_calculations WHERE month=9 AND year=2026")}
    c.close(); return r


def clear_rows():
    c = sqlite3.connect(DB); c.execute("DELETE FROM day_calculations WHERE month=9 AND year=2026"); c.commit(); c.close()


def api_login(user, pw):
    req = urllib.request.Request(BASE + '/api/auth/login', data=json.dumps({'username': user, 'password': pw}).encode(),
                                 headers={'Content-Type': 'application/json'})
    return json.loads(urllib.request.urlopen(req).read())['token']


def make_restricted_user():
    tok = api_login('admin', 'Admin@123')
    req = urllib.request.Request(BASE + '/api/auth/users', headers={'Content-Type': 'application/json', 'Authorization': f'Bearer {tok}'},
                                 data=json.dumps({'username': 'hra', 'password': 'Test@2026', 'role': 'hr', 'allowedCompanies': [A]}).encode())
    urllib.request.urlopen(req).read()


def login(b, user, pw, width=1440):
    ctx = b.new_context(viewport={'width': width, 'height': 900})
    pg = ctx.new_page()
    errs, cons, bad = [], [], []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('console', lambda m: cons.append(m.text) if m.type == 'error' and 'vite.svg' not in m.text and '404' not in m.text else None)
    pg.on('response', lambda r: bad.append(f'{r.status} {r.url}') if '/api/' in r.url and r.status >= 400 else None)
    pg.goto(BASE + '/login'); pg.get_by_placeholder('admin').fill(user); pg.get_by_placeholder('••••••••').fill(pw)
    pg.get_by_role('button', name='Sign in').click(); pg.wait_for_url(lambda u: '/login' not in u)
    return pg, errs, cons, bad


def open_stage6(pg, company=None):
    pg.goto(BASE + '/pipeline/day-calc'); pg.wait_for_load_state('networkidle')
    pg.locator('select').filter(has=pg.locator('option', has_text='September')).first.select_option('9')
    pg.locator('select').filter(has=pg.locator('option', has_text='2026')).first.select_option('2026')
    if company is not None:
        # the page's own CompanyFilter (the header has a second one with display names; both set the store)
        sel = pg.locator('select').filter(has=pg.locator('option', has_text=A)).first
        sel.wait_for(state='attached', timeout=10000)
        sel.select_option(company)
    pg.wait_for_load_state('networkidle'); time.sleep(0.8)


def run(pg):
    btn = pg.get_by_role('button', name=re.compile('Run Day Calculation'))
    with pg.expect_response(lambda r: '/api/payroll/calculate-days' in r.url and r.request.method == 'POST') as resp:
        btn.click()
    r = resp.value
    body = r.request.post_data_json
    pg.wait_for_load_state('networkidle'); time.sleep(1.2)
    return body, r.status


def note(pg):
    return pg.get_by_test_id('stage6-all-companies-note')


def listed_codes(pg):
    # The list GET carries the server's 'private, max-age=5' cache header, so the refetch right after the run can
    # get the browser's pre-run copy (pre-existing, found-not-fixed). Re-open the page after 6 s to read the list.
    time.sleep(6); pg.reload(); pg.wait_for_load_state('networkidle')
    pg.locator('table tbody tr').first.wait_for(timeout=15000)
    txt = pg.locator('table tbody').first.inner_text() if pg.locator('table tbody').count() else ''
    return sorted(c for c, _ in EMPS if c in txt)


env = dict(os.environ, DATA_DIR=WORK, JWT_SECRET='x', PORT=str(PORT), NODE_ENV='production',
           ADMIN_PASSWORD='Admin@123', HR_PASSWORD='Indriyan@2025', FINANCE_PASSWORD='Finance@2025')
srv = subprocess.Popen(['node', f'{ROOT}/backend/server.js'], env=env, stdout=open(f'{WORK}/log', 'w'), stderr=subprocess.STDOUT)
try:
    for _ in range(80):
        try: urllib.request.urlopen(BASE + '/api/version', timeout=2); break
        except Exception: time.sleep(.5)
    seed()
    print(f'App root: {ROOT}  mode: {"BASE (expect company-scoped run)" if BASE_MODE else "fix"}')

    with sync_playwright() as p:
        b = p.chromium.launch()
        if BASE_MODE:
            pg, errs, cons, bad = login(b, 'hr', 'Indriyan@2025')
            open_stage6(pg, A)
            body, status = run(pg)
            rows = db_rows()
            print('  POST body:', body); print('  rows:', rows)
            check('old code: POST body carries the selected company', A, body.get('company'))
            check('old code: split employee cut (payable < full month)', True, rows.get(SPLIT, (None, FULL))[1] < FULL)
            check('old code: company B employees not computed', [], [c for c in B_CODES if c in rows])
            check('old code: no all-companies note', 0, note(pg).count())
            b.close()
        else:
            print('\n— hr, company A selected: Run —')
            pg, errs, cons, bad = login(b, 'hr', 'Indriyan@2025')
            open_stage6(pg, A)
            check('note visible with a company selected', True, note(pg).is_visible())
            check('note wording', "Day calculation always runs for all companies, so no employee's days are cut. "
                  f"The list below still shows {A} only.", note(pg).inner_text().strip())
            body, status = run(pg)
            rows = db_rows()
            check('POST body company is "" (all companies)', '', body.get('company'))
            check('POST 200', 200, status)
            check('every employee in both companies has a row', sorted(c for c, _ in EMPS), sorted(rows))
            check('every row = full month (30 payable days)', {c: FULL for c, _ in EMPS}, {c: rows[c][1] for c in rows})
            check('split employee not cut', FULL, rows.get(SPLIT, (None, None))[1])
            check('row companies from the master', {c: co for c, co in EMPS}, {c: rows[c][0] for c in rows})
            check('toast says all companies', 1, pg.get_by_text(re.compile(r'Day calculation complete for 5 employees \(all companies\)')).count())
            check('list still filtered to A', sorted(A_CODES), listed_codes(pg))
            check('0 page errors', [], errs); check('0 console errors', [], cons); check('0 API ≥ 400', [], bad)

            print('\n— hr, All Companies: note hidden, body "" —')
            clear_rows()
            sel = pg.locator('select').filter(has=pg.locator('option', has_text='All Companies')).first
            sel.select_option(''); pg.wait_for_load_state('networkidle'); time.sleep(0.8)
            check('note hidden with All Companies', 0, note(pg).count())
            body, status = run(pg)
            check('POST body company is ""', '', body.get('company'))
            check('5 rows, all full month', {c: FULL for c, _ in EMPS}, {c: v[1] for c, v in db_rows().items()})
            check('list shows both companies', sorted(c for c, _ in EMPS), listed_codes(pg))
            check('0 page errors', [], errs); check('0 API ≥ 400', [], bad)

            print('\n— company-restricted hr user (allowed A only; company auto-selected) —')
            clear_rows(); make_restricted_user()
            pg, errs, cons, bad = login(b, 'hra', 'Test@2026')
            open_stage6(pg)
            check('restricted: A auto-selected → note visible', True, note(pg).is_visible())
            body, status = run(pg)
            check('restricted: POST body company is ""', '', body.get('company'))
            check('restricted: B rows recalculated too (Q1 ruling)', {c: FULL for c in B_CODES},
                  {c: v[1] for c, v in db_rows().items() if c in B_CODES})
            check('restricted: list shows A only', sorted(A_CODES), listed_codes(pg))
            check('restricted: 0 page errors', [], errs)

            print('\n— phone width 390px (hr, company A) —')
            pg, errs, cons, bad = login(b, 'hr', 'Indriyan@2025', width=390)
            open_stage6(pg, A)
            n = note(pg)
            check('phone: note visible', True, n.is_visible())
            box = n.bounding_box()
            bb = pg.get_by_role('button', name=re.compile('Run Day Calculation')).bounding_box()
            check('phone: Run button inside the viewport (header wraps)', True, bb['x'] >= 0 and bb['x'] + bb['width'] <= 390)
            check('phone: note inside the viewport', True, box['x'] >= 0 and box['x'] + box['width'] <= 390)
            check('phone: 0 page errors', [], errs)
            b.close()
finally:
    srv.terminate(); shutil.rmtree(WORK, ignore_errors=True)

print(f'\n{PASS} passed, {FAIL} failed')
sys.exit(1 if FAIL else 0)
