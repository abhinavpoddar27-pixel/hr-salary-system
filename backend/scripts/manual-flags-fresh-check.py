#!/usr/bin/env python3
"""FRESH — Finance Audit → Attendance Flags reads the list no-cache via api.js and re-reads at once after Verify
(no 6 s timer) — browser check.

Chromium against the BUILT dist, real hr + finance logins, scratch DATA_DIR, fictional data only (codes T958x,
names "TEST EMP n"). Seeds two unverified flags for the CURRENT month.

Checks (fix): every GET /finance-audit/manual-flags carries Cache-Control: no-cache; Verify → row ✓ and tab badge 1 → 0
at once; one re-read of the list within 1.5 s of the PUT and none between 3 s and 8 s; reload < 5 s later still
verified; second Verify then leaving the tab within 2 s → no list GET at ~6 s; hr sees "Awaiting finance", no Verify;
390 px; 0 page errors, 0 API ≥ 400 (except hr's known /comp-off/pending 403).
--base (old tree): the re-read arrives ~6 s after the PUT, none within 1.5 s.

Usage:
  PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers PORT=3503 python3 backend/scripts/manual-flags-fresh-check.py
  APP_ROOT=/tmp/wt-base python3 backend/scripts/manual-flags-fresh-check.py --base
Needs `npm run build --prefix frontend` in APP_ROOT first.
"""
import datetime, os, sqlite3, subprocess, sys, tempfile, time, urllib.request
from playwright.sync_api import sync_playwright

HERE_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
ROOT = os.path.abspath(os.environ.get('APP_ROOT', HERE_ROOT))
BASE_MODE = '--base' in sys.argv
PORT = int(os.environ.get('PORT', '3503')); BASE = f'http://127.0.0.1:{PORT}'
WORK = tempfile.mkdtemp(prefix='fresh-'); DB = os.path.join(WORK, 'hr_system.db')
C = 'Asian Lakto Ind Ltd'
TODAY = datetime.date.today(); M, Y = TODAY.month, TODAY.year
D = f'{Y}-{M:02d}-01'
PASS = FAIL = 0
PW = {'hr': 'Indriyan@2025', 'finance': 'Finance@2025'}


def check(label, expected, actual):
    global PASS, FAIL
    if expected == actual: PASS += 1; print(f'  ✓ {label}')
    else: FAIL += 1; print(f'  ✗ {label} — expected {expected!r}, got {actual!r}')


def q(sql, *a):
    c = sqlite3.connect(DB); r = c.execute(sql, a).fetchall(); c.close(); return r


def ex(sql, *a):
    c = sqlite3.connect(DB); c.execute(sql, a); c.commit(); c.close()


def seed():
    for i, code in enumerate(('T9581', 'T9582'), 1):
        ex("INSERT OR IGNORE INTO employees(code,name,department,company,status,employment_type,gross_salary) "
           "VALUES(?,?,'TEST DEPT',?,'Active','Permanent',20000)", code, f'TEST EMP {i}', C)
        ex("INSERT INTO manual_attendance_flags(employee_code,employee_name,company,date,month,year,evidence_type,reason,"
           "marked_by,finance_verified,verified_by) VALUES(?,?,?,?,?,?,'Gate register','Test reason','hr',0,NULL)",
           code, f'TEST EMP {i}', C, D, M, Y)


def login(b, user, width=1440):
    ctx = b.new_context(viewport={'width': width, 'height': 900})
    pg = ctx.new_page()
    st = {'errs': [], 'bad': [], 'gets': [], 'puts': []}
    pg.on('pageerror', lambda e: st['errs'].append(str(e)))
    pg.on('response', lambda r: st['bad'].append(f'{r.status} {r.url}') if '/api/' in r.url and r.status >= 400
          and not r.url.split('?')[0].endswith('/comp-off/pending') and 'session-analytics' not in r.url else None)

    def on_req(r):
        if '/finance-audit/manual-flags' in r.url:
            if r.method == 'GET': st['gets'].append((time.monotonic(), (r.headers.get('cache-control') or '')))
            elif r.method == 'PUT': st['puts'].append(time.monotonic())
    pg.on('request', on_req)
    pg.goto(BASE + '/login'); pg.get_by_placeholder('admin').fill(user); pg.get_by_placeholder('••••••••').fill(PW[user])
    pg.get_by_role('button', name='Sign in').click(); pg.wait_for_url(lambda u: '/login' not in u)
    pg.goto(BASE + '/finance-audit?tab=manual-flags'); pg.wait_for_load_state('networkidle')
    try: pg.get_by_text('T9582', exact=True).first.wait_for(timeout=20000)
    except Exception: pass
    pg.wait_for_timeout(800)
    return pg, ctx, st


def row(pg, code):
    return pg.locator('tr', has=pg.get_by_text(code, exact=True)).first


def badge(pg):
    t = pg.get_by_role('button', name='Attendance Flags').first.inner_text()
    digits = ''.join(ch for ch in t if ch.isdigit())
    return int(digits) if digits else 0


def verify(pg, code, remark):
    row(pg, code).get_by_role('button', name='Verify', exact=True).click(); pg.wait_for_timeout(300)
    pg.get_by_placeholder('Remarks...').fill(remark)
    pg.get_by_role('button', name='OK', exact=True).click()


env = dict(os.environ, DATA_DIR=WORK, JWT_SECRET='x', PORT=str(PORT), NODE_ENV='production',
           ADMIN_PASSWORD='Admin@123', HR_PASSWORD=PW['hr'], FINANCE_PASSWORD=PW['finance'])
srv = subprocess.Popen(['node', f'{ROOT}/backend/server.js'], env=env, stdout=open(f'{WORK}/log', 'w'), stderr=subprocess.STDOUT)
try:
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    for _ in range(240):
        try:
            if opener.open(BASE + '/api/version', timeout=2).status == 200 and 'running on' in open(f'{WORK}/log').read(): break
        except Exception: pass
        time.sleep(.5)
    seed()
    print(f'App root: {ROOT}  mode: {"BASE (expect the re-read at ~6 s)" if BASE_MODE else "fix"}  month {M}/{Y}')
    with sync_playwright() as p:
        b = p.chromium.launch()
        print('\n— finance —')
        pg, ctx, st = login(b, 'finance')
        if not BASE_MODE:
            check('finance: list GETs sent no-cache', True, len(st['gets']) >= 1 and all('no-cache' in h for _, h in st['gets']))
            check('finance: 2 Verify buttons, badge 2', (2, 2), (pg.get_by_role('button', name='Verify', exact=True).count(), badge(pg)))
        st['gets'].clear()
        verify(pg, 'T9581', 'Checked gate register')
        pg.wait_for_timeout(300)
        t_put = st['puts'][0] if st['puts'] else time.monotonic()
        if not BASE_MODE:
            check('finance: row ✓ at once (no Verify on T9581)', 0, row(pg, 'T9581').get_by_role('button', name='Verify', exact=True).count())
            check('finance: badge 1 at once', 1, badge(pg))
        pg.wait_for_timeout(1200)
        early = [t for t, _ in st['gets'] if t - t_put <= 1.5]
        pg.wait_for_timeout(7000)
        late = [t for t, _ in st['gets'] if 3 <= t - t_put <= 8.5]
        if BASE_MODE:
            check('old: no list re-read within 1.5 s of the PUT', 0, len(early))
            check('old: list re-read arrives between 3 s and 8.5 s (the 6 s timer)', True, len(late) >= 1)
        else:
            check('finance: exactly 1 list re-read within 1.5 s of the PUT', 1, len(early))
            check('finance: the re-read is no-cache', True, all('no-cache' in h for _, h in st['gets']))
            check('finance: no list re-read between 3 s and 8.5 s (no timer)', 0, len(late))
            check('finance: DB row verified', [(1, 'finance', 'Checked gate register')],
                  q("SELECT finance_verified, verified_by, finance_remarks FROM manual_attendance_flags WHERE employee_code='T9581'"))
            # reload inside the server cache window: still verified
            verify(pg, 'T9582', 'Checked again'); pg.wait_for_timeout(1000)
            pg.reload(); pg.wait_for_load_state('networkidle')
            try: pg.get_by_text('T9582', exact=True).first.wait_for(timeout=15000)
            except Exception: pass
            pg.wait_for_timeout(600)
            check('finance: reload < 5 s after Verify shows both verified', (0, 0), (pg.get_by_role('button', name='Verify', exact=True).count(), badge(pg)))
            check('finance: 0 page errors', [], st['errs']); check('finance: 0 API ≥ 400', [], st['bad'])
        ctx.close()

        if not BASE_MODE:
            # leaving the tab right after a Verify fires no late request
            ex("UPDATE manual_attendance_flags SET finance_verified=0, verified_by=NULL, finance_remarks=NULL WHERE employee_code='T9582'")
            pg, ctx, st = login(b, 'finance')
            st['gets'].clear()
            verify(pg, 'T9582', 'Checked once more'); pg.wait_for_timeout(500)
            t_put = st['puts'][-1]
            pg.get_by_role('button', name='Finance Report').first.click(); pg.wait_for_timeout(1000)
            n_after_leave = len(st['gets'])
            pg.wait_for_timeout(7000)
            check('finance: leaving the tab — no list GET at ~6 s', n_after_leave, len(st['gets']))
            check('finance: leaving the tab — 0 page errors', [], st['errs'])
            ctx.close()

            print('\n— hr —')
            pg, ctx, st = login(b, 'hr')
            ex("UPDATE manual_attendance_flags SET finance_verified=0, verified_by=NULL WHERE employee_code='T9581'")
            pg.reload(); pg.wait_for_load_state('networkidle'); pg.wait_for_timeout(1200)
            check('hr: no Verify button', 0, pg.get_by_role('button', name='Verify', exact=True).count())
            check('hr: unverified row says "Awaiting finance"', 1, row(pg, 'T9581').get_by_test_id('flag-awaiting-finance').count())
            check('hr: list GETs sent no-cache', True, len(st['gets']) >= 1 and all('no-cache' in h for _, h in st['gets']))
            check('hr: 0 page errors', [], st['errs']); check('hr: 0 API ≥ 400', [], st['bad'])
            ctx.close()

            print('\n— finance, phone 390 px —')
            pg, ctx, st = login(b, 'finance', width=390)
            check('390px: rows render', True, pg.get_by_text('T9582', exact=True).count() >= 1)
            check('390px: 0 page errors', [], st['errs'])
            ctx.close()
        b.close()
finally:
    srv.terminate()
print(f'\n{PASS} passed, {FAIL} failed')
sys.exit(1 if FAIL else 0)
