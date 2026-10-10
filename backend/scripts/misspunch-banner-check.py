#!/usr/bin/env python3
"""Stage 2 Miss Punch: the "All miss punches resolved!" banner follows real pending work, not the current
status chip (P1-09, finding P-5) — browser check.

Chromium against the BUILT dist, real hr + finance logins, scratch DATA_DIR with fictional data (codes T97xx,
names "TEST EMP n" — the repo is public). Seeds September 2026 miss punches:
  T9701, T9702  HR pending           T9703  finance pending
  T9704–T9706   finance approved     T9707  finance-REJECTED, back with HR (resolved = 0)
Moves rows through the real routes (hr resolves, finance approves) between phases.

Usage:
  python3 backend/scripts/misspunch-banner-check.py               # this tree's server + dist
  APP_ROOT=/tmp/wt python3 .../misspunch-banner-check.py --base   # another tree (e.g. origin/main):
                                                                  # records the banner wrongly shown
Needs `npm run build --prefix frontend` in APP_ROOT first. PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers.
"""
import os, re, shutil, sqlite3, subprocess, sys, tempfile, time, urllib.request
from playwright.sync_api import sync_playwright

HERE_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
ROOT = os.path.abspath(os.environ.get('APP_ROOT', HERE_ROOT))
BASE_MODE = '--base' in sys.argv
PORT = int(os.environ.get('PORT', '3109')); BASE = f'http://127.0.0.1:{PORT}'
WORK = tempfile.mkdtemp(prefix='mp-banner-'); DB = os.path.join(WORK, 'hr_system.db')
C = 'Asian Lakto Ind Ltd'
BANNER = 'All miss punches resolved!'
PASS = FAIL = 0

# code, date, dept, type, resolved, finance_status, in, out
ROWS = [
    ('T9701', '2026-09-02', 'TEST DEPT A', 'MISSING_OUT', 0, None,       '09:00', None),
    ('T9702', '2026-09-03', 'TEST DEPT A', 'MISSING_IN',  0, None,       None,    '18:00'),
    ('T9703', '2026-09-04', 'TEST DEPT B', 'MISSING_OUT', 1, 'pending',  '09:00', '18:00'),
    ('T9704', '2026-09-05', 'TEST DEPT B', 'MISSING_OUT', 1, 'approved', '09:00', '18:00'),
    ('T9705', '2026-09-07', 'TEST DEPT B', 'MISSING_IN',  1, 'approved', '09:00', '18:00'),
    ('T9706', '2026-09-08', 'TEST DEPT B', 'NO_PUNCH',    1, 'approved', '09:00', '18:00'),
    ('T9707', '2026-09-09', 'TEST DEPT A', 'MISSING_OUT', 0, 'rejected', '09:00', None),
]
IDS = {}


def check(label, expected, actual):
    global PASS, FAIL
    if expected == actual: PASS += 1; print(f'  ✓ {label}')
    else: FAIL += 1; print(f'  ✗ {label} — expected {expected!r}, got {actual!r}')


def seed():
    c = sqlite3.connect(DB)
    for i, (code, date, dept, typ, res, fs, tin, tout) in enumerate(ROWS, 1):
        c.execute("INSERT OR IGNORE INTO employees(code,name,department,company,status,employment_type,gross_salary) "
                  "VALUES(?,?,?,?,'Active','Permanent',20000)", (code, f'TEST EMP {i}', dept, C))
        cur = c.execute(
            "INSERT INTO attendance_processed(employee_code,date,month,year,company,status_original,status_final,"
            "in_time_original,out_time_original,in_time_final,out_time_final,is_miss_punch,miss_punch_type,"
            "miss_punch_resolved,miss_punch_finance_status) VALUES(?,?,9,2026,?,'P','P',?,?,?,?,1,?,?,?)",
            (code, date, C, tin, tout, tin if res else None, tout if res else None, typ, res, fs))
        IDS[code] = cur.lastrowid
    c.commit(); c.close()


# Pre-existing, NOT P1-09: the page always calls GET /features/leave-automation/status, which is hr/admin only,
# so a finance login gets a 403 (+ console error) on every visit. Filtered here and reported as found-not-fixed.
KNOWN = 'leave-automation/status'


def login(b, user, pw):
    ctx = b.new_context(viewport={'width': 1440, 'height': 900})
    pg = ctx.new_page()
    errs, cons, bad = [], [], []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('console', lambda m: cons.append(m.text) if m.type == 'error' and 'vite.svg' not in m.text and '404' not in m.text
            and not (user == 'finance' and (KNOWN in m.text or '403 (Forbidden)' in m.text)) else None)
    pg.on('response', lambda r: bad.append(f'{r.status} {r.url}') if '/api/' in r.url and r.status >= 400
          and not (user == 'finance' and KNOWN in r.url and r.status == 403) else None)
    pg.goto(BASE + '/login'); pg.get_by_placeholder('admin').fill(user); pg.get_by_placeholder('••••••••').fill(pw)
    pg.get_by_role('button', name='Sign in').click(); pg.wait_for_url(lambda u: '/login' not in u)
    return pg, errs, cons, bad


def open_page(pg):
    pg.goto(BASE + '/pipeline/miss-punch'); pg.wait_for_load_state('networkidle')
    pg.locator('select').filter(has=pg.locator('option', has_text='September')).first.select_option('9')
    pg.locator('select').filter(has=pg.locator('option', has_text='2026')).first.select_option('2026')
    pg.wait_for_load_state('networkidle'); time.sleep(1)


def chip(pg, name):
    pg.get_by_role('button', name=re.compile('^' + name + r' \(')).click()
    pg.wait_for_load_state('networkidle'); time.sleep(0.8)


def banner(pg):
    return pg.get_by_text(BANNER, exact=True).count() > 0


def progress_label(pg):
    return pg.locator('div.card', has=pg.get_by_text('Resolution Progress', exact=True)).first \
             .locator('span.text-sm.text-slate-500').first.inner_text().strip()


def auth(pg):
    return {'Authorization': 'Bearer ' + pg.evaluate("localStorage.getItem('hr_token')")}


def hr_resolve(pg, code):
    r = pg.request.post(f'{BASE}/api/attendance/miss-punches/{IDS[code]}/resolve',
                        data={'inTime': '09:00', 'outTime': '18:00', 'source': 'Gate Register', 'remark': 'test fix'}, headers=auth(pg))
    check(f'hr resolves {code} (HTTP 200)', 200, r.status)


def fin_approve(pg, code):
    r = pg.request.post(f'{BASE}/api/finance-audit/miss-punch/{IDS[code]}/approve', data={'notes': 'ok'}, headers=auth(pg))
    check(f'finance approves {code} (HTTP 200)', 200, r.status)


env = dict(os.environ, DATA_DIR=WORK, JWT_SECRET='x', PORT=str(PORT), NODE_ENV='production',
           ADMIN_PASSWORD='Admin@123', HR_PASSWORD='Indriyan@2025', FINANCE_PASSWORD='Finance@2025')
srv = subprocess.Popen(['node', f'{ROOT}/backend/server.js'], env=env, stdout=open(f'{WORK}/log', 'w'), stderr=subprocess.STDOUT)
try:
    for _ in range(80):
        try: urllib.request.urlopen(BASE + '/api/version', timeout=2); break
        except Exception: time.sleep(.5)
    seed()
    print(f'App root: {ROOT}  mode: {"BASE (expect banner wrongly shown)" if BASE_MODE else "fix"}')

    with sync_playwright() as p:
        b = p.chromium.launch()
        hr, herrs, hcons, hbad = login(b, 'hr', 'Indriyan@2025')
        fin, ferrs, fcons, fbad = login(b, 'finance', 'Finance@2025')

        print('\n— A: 2 HR pending + 1 finance pending + 3 approved + 1 rejected-with-HR —')
        open_page(hr)
        if BASE_MODE:
            chip(hr, 'All'); check('old code: All chip → no banner', False, banner(hr))
            chip(hr, 'Approved'); check('old code: Approved chip → banner WRONGLY shown', True, banner(hr))
            chip(hr, 'Finance Pending'); check('old code: Finance Pending chip → banner WRONGLY shown', True, banner(hr))
            check('old code: Finance Pending chip label "1 of 1 resolved" (no filter note)', '1 of 1 resolved', progress_label(hr))
            b.close()
        else:
            chip(hr, 'All')
            check('A: All chip → no banner', False, banner(hr))
            check('A: All chip label has no "(this filter)"', '4 of 7 resolved', progress_label(hr))
            chip(hr, 'Approved')
            check('A: Approved chip → no banner (the bug)', False, banner(hr))
            check('A: Approved chip label says "(this filter)"', '3 of 3 resolved (this filter)', progress_label(hr))
            chip(hr, 'Finance Pending')
            check('A: Finance Pending chip → no banner', False, banner(hr))
            chip(hr, 'Rejected')
            check('A: Rejected chip → no banner', False, banner(hr))

            print('\n— B: everything done except the finance-rejected row waiting for HR —')
            for code in ('T9701', 'T9702'): hr_resolve(hr, code)
            for code in ('T9701', 'T9702', 'T9703'): fin_approve(fin, code)
            time.sleep(6)
            open_page(hr)
            for name in ('All', 'Approved', 'Finance Pending'):
                chip(hr, name)
                check(f'B: {name} chip → no banner (rejected row still with HR)', False, banner(hr))

            print('\n— C: HR re-resolves the rejected row, finance approves → all done —')
            hr_resolve(hr, 'T9707')
            time.sleep(6)  # server.js sends Cache-Control max-age=5 on GETs; the page's miss-punch read is not no-cache
            print('  (user-sim: finance clicks ✓ Approve on the last row in the UI)')
            open_page(fin); chip(fin, 'Finance Pending')
            check('C: finance sees 1 row to approve, no banner yet', (1, False),
                  (fin.get_by_role('button', name='✓ Approve').count(), banner(fin)))
            fin.get_by_role('button', name='✓ Approve').first.click()
            fin.get_by_text('Approved — Stage 6 recalculation required').wait_for(timeout=10000)
            chip(fin, 'All')
            try:
                fin.get_by_text(BANNER, exact=True).wait_for(timeout=12000); shown = True
            except Exception:
                shown = False
            # Pre-existing, NOT P1-09 (found-not-fixed): the approve only refetch()es the current chip's query,
            # other chips are served from react-query (global staleTime 30 s), and the GET is not sent no-cache
            # while server.js answers GETs with Cache-Control max-age=5. So right after the last approve the page
            # still shows the old summary. Recorded, not counted.
            print(f'  · observed: banner within 12 s of the UI approve, no reload = {shown} (stale cache, pre-existing)')
            time.sleep(6); open_page(fin); chip(fin, 'All')
            check('C: after a reload finance sees the banner', True, banner(fin))
            time.sleep(6)
            open_page(hr)
            chip(hr, 'All')
            check('C: All chip → banner shows', True, banner(hr))
            check('C: All chip label', '7 of 7 resolved', progress_label(hr))
            chip(hr, 'Approved')
            check('C: Approved chip → banner shows', True, banner(hr))
            chip(hr, 'HR Pending')
            check('C: HR Pending chip (0 rows) → banner still shows (month is clear)', True, banner(hr))
            chip(hr, 'All')
            hr.locator('input[placeholder="Filter dept..."]').fill('TEST DEPT A')
            hr.wait_for_load_state('networkidle'); time.sleep(1)
            check('C: department filter set → banner hidden', False, banner(hr))
            hr.locator('input[placeholder="Filter dept..."]').fill('')
            hr.wait_for_load_state('networkidle'); time.sleep(1)
            check('C: department filter cleared → banner back', True, banner(hr))

            print('\n— C (finance login) —')
            open_page(fin); chip(fin, 'All')
            check('C: finance sees the banner', True, banner(fin))

            check('hr: 0 page errors', [], herrs); check('hr: 0 console errors', [], hcons); check('hr: 0 API ≥ 400', [], hbad)
            check('finance: 0 page errors', [], ferrs); check('finance: 0 console errors', [], fcons); check('finance: 0 API ≥ 400', [], fbad)

            print('\n— D: miss-punch call fails (route intercept → 500) —')
            pg, errs, cons, bad = login(b, 'hr', 'Indriyan@2025')
            pg.route(re.compile(r'.*/api/attendance/miss-punches\?.*'),
                     lambda route: route.fulfill(status=500, content_type='application/json', body='{"success":false,"error":"test"}'))
            open_page(pg)
            check('D: 500 on the summary call → no banner', False, banner(pg))
            check('D: 0 page errors', [], errs)
            check('D: the only API ≥ 400 are the intercepted 500s', True, len(bad) > 0 and all(x.startswith('500 ') and 'miss-punches' in x for x in bad))
            b.close()
finally:
    srv.terminate(); shutil.rmtree(WORK, ignore_errors=True)

print(f'\n{PASS} passed, {FAIL} failed')
sys.exit(1 if FAIL else 0)
