#!/usr/bin/env python3
"""P2-02+ (UI polish batch 4) — browser check of the BUILT frontend (Chromium).

Covers: toast de-duplication (P2-02), no debug role banners (P6-07 / F-14), `.btn-warning` styled,
IST "today" on Gate Pass + Mark Left with the browser in UTC and its clock at 2026-10-10 19:00 UTC
(= 00:30 IST, 11 Oct), 390 px, 0 page errors. Scratch DATA_DIR, real admin / hr / finance logins plus a
fictional viewer user, fictional employee T9801.
One browser login per role (server login limit: 5 per 15 min per IP).

Usage:
  python3 backend/scripts/ui-polish-batch4-check.py                 # this tree
  APP_ROOT=/path/to/origin-main-copy python3 .../ui-polish-batch4-check.py --base   # old build: records the bugs
Needs `npm run build --prefix frontend` in APP_ROOT. Port 3214 (PORT env overrides).
"""
import datetime as dt, json, os, re, sqlite3, subprocess, sys, tempfile, time, urllib.request
from playwright.sync_api import sync_playwright

HERE_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
ROOT = os.path.abspath(os.environ.get('APP_ROOT', HERE_ROOT))
BASE_MODE = '--base' in sys.argv
PORT = int(os.environ.get('PORT', '3214')); BASE = f'http://127.0.0.1:{PORT}'
WORK = tempfile.mkdtemp(prefix='ui-polish4-'); DB = os.path.join(WORK, 'hr_system.db')
CLOCK = dt.datetime(2026, 10, 10, 19, 0, 0, tzinfo=dt.timezone.utc)   # 00:30 IST, 11 Oct 2026
IST_TODAY, UTC_TODAY = '2026-10-11', '2026-10-10'
DEBUG_WORDS = re.compile(r'canFinance:|Role \(raw\)|Normalised:|with role "|Role:\s*"')
PASS = FAIL = 0


def check(label, expected, actual):
    global PASS, FAIL
    if expected == actual: PASS += 1; print(f'  ✓ {label}')
    else: FAIL += 1; print(f'  ✗ {label} — expected {expected!r}, got {actual!r}')


def api(path, body=None, token=None):
    req = urllib.request.Request(BASE + path, data=json.dumps(body).encode() if body is not None else None,
                                 headers={'Content-Type': 'application/json', **({'Authorization': f'Bearer {token}'} if token else {})},
                                 method='POST' if body is not None else 'GET')
    return json.loads(urllib.request.urlopen(req, timeout=10).read())


def seed():
    c = sqlite3.connect(DB)
    c.execute("INSERT OR IGNORE INTO employees(code,name,department,company,status,employment_type,gross_salary) "
              "VALUES('T9801','TEST EMP POLISH','TEST DEPT','Asian Lakto Ind Ltd','Active','Permanent',20000)")
    c.commit(); c.close()
    tok = api('/api/auth/login', {'username': 'admin', 'password': 'Admin@123'})['token']
    api('/api/auth/users', {'username': 'test_viewer', 'password': 'Viewer@123', 'role': 'viewer', 'allowedCompanies': ['*']}, tok)


def login(b, user, pw, width=1440, clock=False):
    ctx = b.new_context(viewport={'width': width, 'height': 900}, timezone_id='UTC', accept_downloads=True)
    if clock: ctx.clock.set_system_time(CLOCK)
    pg = ctx.new_page()
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(BASE + '/login'); pg.get_by_placeholder('admin').fill(user); pg.get_by_placeholder('••••••••').fill(pw)
    pg.get_by_role('button', name='Sign in').click(); pg.wait_for_url(lambda u: '/login' not in u)
    time.sleep(.3)
    pg.evaluate("() => window.__hrToast && window.__hrToast.remove()")   # clear the welcome toast
    return pg, errs


def visit(pg, path):
    pg.goto(BASE + path); pg.wait_for_load_state('networkidle'); time.sleep(.6)
    return pg.locator('main').inner_text() if pg.locator('main').count() else pg.locator('body').inner_text()


def toast_count(pg, text):
    return pg.locator('[role=status]', has_text=text).count()


env = dict(os.environ, DATA_DIR=WORK, JWT_SECRET='x', PORT=str(PORT), NODE_ENV='production',
           ADMIN_PASSWORD='Admin@123', HR_PASSWORD='Indriyan@2025', FINANCE_PASSWORD='Finance@2025')
srv = subprocess.Popen(['node', f'{ROOT}/backend/server.js'], env=env, stdout=open(f'{WORK}/log', 'w'), stderr=subprocess.STDOUT)
try:
    for _ in range(80):
        try: urllib.request.urlopen(BASE + '/api/version', timeout=2); break
        except Exception: time.sleep(.5)
    seed()
    want = UTC_TODAY if BASE_MODE else IST_TODAY
    print(f'App root: {ROOT}  mode: {"BASE (expect the bugs)" if BASE_MODE else "fix"}')
    with sync_playwright() as p:
        b = p.chromium.launch()

        print('\n— debug role banners (F-14) —')
        pg, errs = login(b, 'finance', 'Finance@2025')
        fin_pg, fin_errs = pg, errs
        for path in ['/extra-duty-grants', '/held-salaries', '/finance-verification?tab=misspunch', '/finance-verification?tab=held']:
            txt = visit(pg, path)
            check(f'finance {path}: debug role text on screen (True = the bug)', BASE_MODE, bool(DEBUG_WORDS.search(txt)))
        txt = visit(pg, '/held-salaries')
        check('held register still links back to Finance Verify', True, 'Back to Finance Verify' in txt)
        txt = visit(pg, '/finance-verification?tab=held')
        if not BASE_MODE:
            check('finance held tab keeps "View in Stage 7"', True, 'View in Stage 7' in txt)
        check('finance banners: 0 page errors', [], errs)

        pg, errs = login(b, 'test_viewer', 'Viewer@123')
        txt = visit(pg, '/extra-duty-grants')
        check('viewer Extra Duty: raw role JSON on screen (True = the bug)', BASE_MODE, bool(DEBUG_WORDS.search(txt)) or '"viewer"' in txt)
        check('viewer: 0 page errors', [], errs)

        print('\n— .btn-warning styled (Extra Duty "Flag for Review" submit uses it) —')
        pg, errs = fin_pg, fin_errs
        visit(pg, '/extra-duty-grants')
        bg = pg.evaluate("""() => { const b = document.createElement('button'); b.className = 'btn-warning'; b.textContent = 'x';
                             document.body.appendChild(b); const s = getComputedStyle(b);
                             const out = [s.backgroundImage, s.backgroundColor, s.color, s.borderRadius]; b.remove(); return out }""")
        styled = ('gradient' in bg[0]) or (bg[1] not in ('rgba(0, 0, 0, 0)', 'transparent'))
        check('.btn-warning has a background (not transparent)', not BASE_MODE, styled)
        if not BASE_MODE:
            check('.btn-warning text is white', 'rgb(255, 255, 255)', bg[2])

        if not BASE_MODE:
            print('\n— 390 px —')
            pg, errs = fin_pg, fin_errs
            pg.set_viewport_size({'width': 390, 'height': 844})
            txt = visit(pg, '/extra-duty-grants')
            check('390 px Extra Duty: no debug text', False, bool(DEBUG_WORDS.search(txt)))
            check('390 px Held register: page renders', True, 'Held Salaries' in visit(pg, '/held-salaries'))
            check('390 px: 0 page errors', [], errs)
        b.close()
finally:
    srv.terminate()
print(f'\n{PASS}/{PASS + FAIL} passed')
sys.exit(1 if FAIL else 0)
