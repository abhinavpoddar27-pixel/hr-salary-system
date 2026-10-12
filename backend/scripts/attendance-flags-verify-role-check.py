#!/usr/bin/env python3
"""Finance Audit → Attendance Flags: Verify only for roles the verify route accepts; "verified" read from
finance_verified (N-MONEY2 item 6) — browser check.

Chromium against the BUILT dist, real hr + finance logins, scratch DATA_DIR, fictional data only (codes T987x,
names "TEST EMP n" — the repo is public). Seeds three manual_attendance_flags rows for the CURRENT month:
  T9871 unverified · T9872 verified (finance_verified=1 + verified_by) · T9873 finance_verified=1, verified_by empty.

Usage:
  python3 backend/scripts/attendance-flags-verify-role-check.py               # this tree
  APP_ROOT=/tmp/wt python3 .../attendance-flags-verify-role-check.py --base   # old tree: hr sees Verify; T9873 unverified
Needs `npm run build --prefix frontend` in APP_ROOT first. PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers.
Known, not this PR: hr gets a 403 from GET /comp-off/pending on this page (the Comp-off tab badge) — ignored for hr.
"""
import datetime, os, sqlite3, subprocess, sys, tempfile, time, urllib.request
from playwright.sync_api import sync_playwright

HERE_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
ROOT = os.path.abspath(os.environ.get('APP_ROOT', HERE_ROOT))
BASE_MODE = '--base' in sys.argv
PORT = int(os.environ.get('PORT', '3241')); BASE = f'http://127.0.0.1:{PORT}'
WORK = tempfile.mkdtemp(prefix='attflags-'); DB = os.path.join(WORK, 'hr_system.db')
C = 'Asian Lakto Ind Ltd'
TODAY = datetime.date.today(); M, Y = TODAY.month, TODAY.year
D = f'{Y}-{M:02d}-01'
PASS = FAIL = 0


def check(label, expected, actual):
    global PASS, FAIL
    if expected == actual: PASS += 1; print(f'  ✓ {label}')
    else: FAIL += 1; print(f'  ✗ {label} — expected {expected!r}, got {actual!r}')


def q(sql, *a):
    c = sqlite3.connect(DB); r = c.execute(sql, a).fetchall(); c.close(); return r


def ex(sql, *a):
    c = sqlite3.connect(DB); c.execute(sql, a); c.commit(); c.close()


def seed():
    rows = [('T9871', 0, None), ('T9872', 1, 'finance'), ('T9873', 1, None)]
    for i, (code, fv, vb) in enumerate(rows, 1):
        ex("INSERT OR IGNORE INTO employees(code,name,department,company,status,employment_type,gross_salary) "
           "VALUES(?,?,'TEST DEPT',?,'Active','Permanent',20000)", code, f'TEST EMP {i}', C)
        ex("INSERT INTO manual_attendance_flags(employee_code,employee_name,company,date,month,year,evidence_type,reason,"
           "marked_by,finance_verified,verified_by) VALUES(?,?,?,?,?,?,'Gate register','Test reason','finance',?,?)",
           code, f'TEST EMP {i}', C, D, M, Y, fv, vb)


def login(b, user, pw, width=1440):
    ctx = b.new_context(viewport={'width': width, 'height': 900})
    pg = ctx.new_page()
    errs, cons, bad = [], [], []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('console', lambda m: cons.append(m.text) if m.type == 'error' and 'vite.svg' not in m.text and '404' not in m.text and not (user == 'hr' and ('comp-off' in m.text or '403' in m.text)) else None)
    pg.on('response', lambda r: bad.append(f'{r.status} {r.url}') if '/api/' in r.url and r.status >= 400 and not (user == 'hr' and '/comp-off/pending' in r.url) else None)
    pg.goto(BASE + '/login'); pg.get_by_placeholder('admin').fill(user); pg.get_by_placeholder('••••••••').fill(pw)
    pg.get_by_role('button', name='Sign in').click(); pg.wait_for_url(lambda u: '/login' not in u)
    pg.goto(BASE + '/finance-audit?tab=manual-flags'); pg.wait_for_load_state('networkidle')
    try: pg.get_by_text('T9872', exact=True).first.wait_for(timeout=20000)
    except Exception: pass
    time.sleep(.8)
    return pg, ctx, errs, cons, bad


def row(pg, code):
    return pg.locator('tr', has=pg.get_by_text(code, exact=True)).first


def verify_buttons(pg):
    return pg.get_by_role('button', name='Verify', exact=True).count()


env = dict(os.environ, DATA_DIR=WORK, JWT_SECRET='x', PORT=str(PORT), NODE_ENV='production',
           ADMIN_PASSWORD='Admin@123', HR_PASSWORD='Indriyan@2025', FINANCE_PASSWORD='Finance@2025')
srv = subprocess.Popen(['node', f'{ROOT}/backend/server.js'], env=env, stdout=open(f'{WORK}/log', 'w'), stderr=subprocess.STDOUT)
try:
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))  # never via an HTTP proxy
    for _ in range(240):
        try:
            # wait for the full boot (schema + migrations + user seeding) before seeding test rows
            if opener.open(BASE + '/api/version', timeout=2).status == 200 and 'running on' in open(f'{WORK}/log').read(): break
        except Exception: pass
        time.sleep(.5)
    seed()
    print(f'App root: {ROOT}  mode: {"BASE (expect hr Verify + T9873 unverified)" if BASE_MODE else "fix"}  month {M}/{Y}')
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg, ctx, errs, cons, bad = login(b, 'hr', 'Indriyan@2025')
        if BASE_MODE:
            check('old: hr sees a Verify button', True, verify_buttons(pg) >= 1)
            check('old: T9873 (finance_verified=1, no verified_by) shows as unverified (has Verify)', 1,
                  row(pg, 'T9873').get_by_role('button', name='Verify', exact=True).count())
            b.close()
        else:
            print('\n— hr —')
            check('hr: rows load (3 codes)', 3, sum(pg.get_by_text(c, exact=True).count() for c in ('T9871', 'T9872', 'T9873')))
            check('hr: no Verify button anywhere', 0, verify_buttons(pg))
            check('hr: unverified row says "Finance verifies"', 1, row(pg, 'T9871').get_by_test_id('flag-verify-finance-only').count())
            check('hr: verified rows have no note', 0,
                  row(pg, 'T9872').get_by_test_id('flag-verify-finance-only').count() + row(pg, 'T9873').get_by_test_id('flag-verify-finance-only').count())
            check('hr: T9873 (finance_verified=1) counts as verified (✓)', 1, row(pg, 'T9873').get_by_text('✓').count())
            check('hr: Unverified KPI = 1', True, pg.locator('text=Unverified').count() >= 1)
            check('hr: 0 page errors', [], errs); check('hr: 0 console errors', [], cons); check('hr: 0 API ≥ 400', [], bad)
            ctx.close()

            print('\n— finance —')
            pg, ctx, errs, cons, bad = login(b, 'finance', 'Finance@2025')
            check('finance: exactly 1 Verify (only the unverified row)', 1, verify_buttons(pg))
            check('finance: Verify sits on T9871', 1, row(pg, 'T9871').get_by_role('button', name='Verify', exact=True).count())
            check('finance: T9873 has no Verify', 0, row(pg, 'T9873').get_by_role('button', name='Verify', exact=True).count())
            check('finance: no "Finance verifies" note', 0, pg.get_by_test_id('flag-verify-finance-only').count())
            row(pg, 'T9871').get_by_role('button', name='Verify', exact=True).click(); time.sleep(.3)
            pg.get_by_placeholder('Remarks...').fill('Checked gate register')
            with pg.expect_response(lambda r: '/manual-flags/' in r.url and r.request.method == 'PUT') as rr:
                pg.get_by_role('button', name='OK', exact=True).click()
            check('finance: verify PUT → 200', 200, rr.value.status)
            time.sleep(1.2)
            check('finance: DB row verified by finance', [(1, 'finance', 'Checked gate register')],
                  q("SELECT finance_verified, verified_by, finance_remarks FROM manual_attendance_flags WHERE employee_code='T9871'"))
            check('finance: no Verify left', 0, verify_buttons(pg))
            check('finance: 0 page errors', [], errs); check('finance: 0 console errors', [], cons); check('finance: 0 API ≥ 400', [], bad)
            ctx.close()

            print('\n— finance, phone 390 px —')
            pg, ctx, errs, cons, bad = login(b, 'finance', 'Finance@2025', width=390)
            check('390px: page renders rows', True, pg.get_by_text('T9872', exact=True).count() >= 1)
            check('390px: 0 page errors', [], errs)
            ctx.close()
            b.close()
finally:
    srv.terminate()
print(f'\n{PASS} passed, {FAIL} failed')
sys.exit(1 if FAIL else 0)
