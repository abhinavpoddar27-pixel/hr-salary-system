#!/usr/bin/env python3
"""P2-02 (finding X-17): one API failure shows exactly ONE error toast — browser check.

Chromium against the BUILT dist, real hr login, scratch DATA_DIR (no employee data needed: every failure is forced
with page.route, so nothing is written). Fictional values only (repo is public).

Cases (each on a fresh page load, toasts counted as visible [role=status] in react-hot-toast's container):
  A  Stage 6 Run (mutation, page onError) forced 409 / 403 / 500 → 1 toast, page text (= server text here)
  A4 R4: the replaced toast is still visible 3.5 s after the failure (timer not shortened)
  B  Stage 3 shifts query (no onError, react-query retry 1) forced 500 → 2 requests, 1 toast, server text
  C  Stage 6 Run network error (aborted) → 1 toast, page text "Calculation failed"
  D  Stage 6 Run 401 → redirected to /login, no error toast there (only the P2-08 session-expired notice)
  E  Reports → Leave Reports → Download Excel (blob) forced 500 → 1 toast "Download failed"
  F  two DIFFERENT failures 2 s apart → 2 toasts (no over-merge)
  G  Sales TA/DA upload forced 400 with row errors → rows in the result table, 1 summary toast
  H  validation-only toast (.txt file on TA/DA upload, no API call) → 1 toast
  I  390 px phone: case A once → 1 toast; 0 page errors overall

Usage:
  python3 backend/scripts/toast-dedup-check.py                    # this tree (expects the fix)
  APP_ROOT=/path/to/origin-main python3 .../toast-dedup-check.py --base   # records the double toasts
Needs `npm run build --prefix frontend` in APP_ROOT first. PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers. PORT default 3404.
"""
import json, os, subprocess, sys, tempfile, time, urllib.request
from playwright.sync_api import sync_playwright

HERE_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
ROOT = os.path.abspath(os.environ.get('APP_ROOT', HERE_ROOT))
BASE_MODE = '--base' in sys.argv
PORT = int(os.environ.get('PORT', '3404')); BASE = f'http://127.0.0.1:{PORT}'
WORK = tempfile.mkdtemp(prefix='toast-dedup-')
PASS = FAIL = 0
PAGE_ERRORS = []


def check(label, expected, actual):
    global PASS, FAIL
    if expected == actual: PASS += 1; print(f'  ✓ {label}')
    else: FAIL += 1; print(f'  ✗ {label} — expected {expected!r}, got {actual!r}')


TOASTS_JS = """() => [...document.querySelectorAll('[role=status]')]
  .filter(e => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e.parentElement);
                 return r.width > 0 && r.height > 0 && s.opacity !== '0' })
  .map(e => e.textContent.trim())"""


def toasts(pg, settle=1.2):
    if settle:  # wait (≤ 4 s) for the first toast, then let any second one arrive
        for _ in range(16):
            if pg.evaluate(TOASTS_JS): break
            time.sleep(.25)
    time.sleep(settle)
    return pg.evaluate(TOASTS_JS)


STATE = None  # one real login, reused (server login limiter is 5 per 15 min per IP)


def new_page(b, width=1440):
    global STATE
    if STATE is None:
        ctx = b.new_context(); pg = ctx.new_page()
        pg.goto(BASE + '/login'); pg.get_by_placeholder('admin').fill('hr'); pg.get_by_placeholder('••••••••').fill('Indriyan@2025')
        pg.get_by_role('button', name='Sign in').click(); pg.wait_for_url(lambda u: '/login' not in u)
        STATE = ctx.storage_state(); ctx.close()
    ctx = b.new_context(viewport={'width': width, 'height': 900}, accept_downloads=True, storage_state=STATE)
    pg = ctx.new_page()
    pg.on('pageerror', lambda e: PAGE_ERRORS.append(str(e)))
    return pg


def fulfill_json(status, body):
    return lambda route: route.fulfill(status=status, content_type='application/json', body=json.dumps(body))


def open_stage6(pg):
    pg.goto(BASE + '/pipeline/day-calc'); pg.wait_for_load_state('networkidle'); time.sleep(.5)


def run_stage6(pg):
    pg.get_by_role('button', name='▶ Run Day Calculation').first.click()


env = dict(os.environ, DATA_DIR=WORK, JWT_SECRET='x', PORT=str(PORT), NODE_ENV='production',
           ADMIN_PASSWORD='Admin@123', HR_PASSWORD='Indriyan@2025', FINANCE_PASSWORD='Finance@2025')
srv = subprocess.Popen(['node', f'{ROOT}/backend/server.js'], env=env, stdout=open(f'{WORK}/log', 'w'), stderr=subprocess.STDOUT)
try:
    for _ in range(80):
        try: urllib.request.urlopen(BASE + '/api/version', timeout=2); break
        except Exception: time.sleep(.5)
    print(f'App root: {ROOT}  mode: {"BASE (expect double toasts)" if BASE_MODE else "fix"}')
    with sync_playwright() as p:
        b = p.chromium.launch()
        exp = (lambda base, fix: base) if BASE_MODE else (lambda base, fix: fix)

        # ── A: mutation with page onError ──
        for status, text in ((409, 'TEST 409 already done'), (403, 'TEST 403 not allowed'), (500, 'TEST 500 boom')):
            print(f'\n— A: Stage 6 Run forced {status} —')
            pg = new_page(b); open_stage6(pg)
            pg.route('**/api/payroll/calculate-days', fulfill_json(status, {'success': False, 'error': text}))
            t0 = time.time(); run_stage6(pg)
            got = toasts(pg)
            check(f'A {status}: toast count', exp(2, 1), len(got))
            check(f'A {status}: every toast says the text', True, all(text in t for t in got))
            if status == 409 and not BASE_MODE:
                time.sleep(max(0, 3.5 - (time.time() - t0)))
                check('A4 (R4): toast still visible 3.5 s after the failure', 1, len(toasts(pg, 0)))
                time.sleep(4.0)
                check('A4: toast gone ~7.5 s after the failure', 0, len(toasts(pg, 0)))
            pg.context.close()

        # ── B: query without onError, react-query retry 1 ──
        print('\n— B: Stage 3 shifts query forced 500 (retry 1) —')
        pg = new_page(b); hits = []
        def shifts_500(route):
            hits.append(1); route.fulfill(status=500, content_type='application/json', body=json.dumps({'success': False, 'error': 'TEST shifts down'}))
        pg.route('**/api/settings/shifts', shifts_500)
        pg.goto(BASE + '/pipeline/shift-check'); pg.bring_to_front()
        most, got, retry_seen = 0, [], None
        for _ in range(60):  # poll: the most toasts on screen at once while the query fails, retries, fails again
            now = pg.evaluate(TOASTS_JS)
            if len(now) >= len(got): got = now
            most = max(most, len(now))
            if len(hits) >= 2 and retry_seen is None: retry_seen = time.time()
            if retry_seen and time.time() - retry_seen > 1.5: break
            time.sleep(.25)
        print('    hits', len(hits), 'most toasts at once', most)
        check('B: the query was tried twice (retry)', 2, len(hits))
        check('B: most toasts on screen at once', exp(2, 1), most)
        check('B: toast text = server text', True, bool(got) and all('TEST shifts down' in t for t in got))
        pg.context.close()

        # ── C: network error ──
        print('\n— C: Stage 6 Run network error —')
        pg = new_page(b); open_stage6(pg)
        pg.route('**/api/payroll/calculate-days', lambda r: r.abort())
        run_stage6(pg); got = toasts(pg)
        check('C: toast count', exp(2, 1), len(got))
        check('C: page text shown', True, any('Calculation failed' in t for t in got))
        if not BASE_MODE: check('C: no "Network Error" toast left', False, any('Network Error' in t for t in got))
        pg.context.close()

        # ── D: 401 ──
        print('\n— D: Stage 6 Run 401 —')
        pg = new_page(b); open_stage6(pg)
        pg.route('**/api/payroll/calculate-days', fulfill_json(401, {'error': 'TEST expired'}))
        run_stage6(pg); pg.wait_for_url(lambda u: '/login' in u, timeout=10000); pg.wait_for_load_state('networkidle')
        check('D: on /login', True, '/login' in pg.url)
        got = toasts(pg)  # the P2-08 "session expired" notice is a role=status element too
        check('D: no error toast on the login page (only the session-expired notice)', [],
              [t for t in got if 'session expired' not in t.lower()])
        check('D: session-expired notice shown', True, any('session expired' in t.lower() for t in got))
        pg.context.close()

        # ── E: blob download ──
        print('\n— E: Reports Leave Reports download forced 500 —')
        pg = new_page(b)
        pg.route(lambda u: '/api/reports/leave-register' in u and 'download=xlsx' in u,
                 fulfill_json(500, {'success': False, 'error': 'TEST xlsx failed'}))
        pg.goto(BASE + '/reports'); pg.wait_for_load_state('networkidle')
        pg.get_by_role('button', name='Leave Reports').first.click(); pg.wait_for_load_state('networkidle'); time.sleep(.5)
        pg.get_by_role('button', name='⬇ Download Excel').click(); got = toasts(pg)
        check('E: toast count', exp(2, 1), len(got))
        check('E: page text "Download failed" shown', True, any('Download failed' in t for t in got))
        pg.context.close()

        # ── F: two different failures ──
        print('\n— F: two different failures 2 s apart —')
        pg = new_page(b); open_stage6(pg)
        seq = ['TEST first failure', 'TEST second failure']
        pg.route('**/api/payroll/calculate-days', lambda r: r.fulfill(status=409, content_type='application/json',
                 body=json.dumps({'error': seq.pop(0)})))
        run_stage6(pg); time.sleep(2.0); run_stage6(pg); got = toasts(pg)
        check('F: toast count', exp(4, 2), len(got))
        check('F: both texts visible', True, any('first' in t for t in got) and any('second' in t for t in got))
        pg.context.close()

        # ── G + H: Sales TA/DA upload ──
        print('\n— G/H: Sales TA/DA upload —')
        import openpyxl
        xlsx = os.path.join(WORK, 'tada_class2.xlsx'); wb = openpyxl.Workbook(); ws = wb.active
        ws.append(['employee_code', 'name', 'city', 'in_city_days', 'outstation_days'])
        ws.append(['S9901', 'TEST REP ONE', 'TEST CITY', 10, 2]); ws.append(['S9902', 'TEST REP TWO', 'TEST CITY', 99, 0]); wb.save(xlsx)
        txt = os.path.join(WORK, 'not_excel.txt'); open(txt, 'w').write('x')
        pg = new_page(b)
        pg.route(lambda u: '/api/sales/ta-da' in u and 'upload' in u and 'template' not in u,
                 fulfill_json(400, {'success': False, 'parsed': 2, 'valid': 1, 'invalid': 1,
                                    'errors': [{'row': 3, 'employee_code': 'S9902', 'error': 'TEST days exceed cycle'}]}))
        pg.goto(BASE + '/sales/ta-da-upload'); pg.wait_for_load_state('networkidle')
        sel = pg.locator('select').filter(has=pg.locator('option', has_text='All Companies')).first
        sel.select_option(index=1); pg.wait_for_load_state('networkidle'); time.sleep(.5)
        pg.locator('input[type=file]').set_input_files(txt); got = toasts(pg)
        check('H: validation-only toast count', 1, len(got))
        check('H: text', True, any('Only .xlsx' in t for t in got))
        time.sleep(4.5)
        pg.locator('input[type=file]').set_input_files(xlsx); time.sleep(1.5)
        pg.get_by_role('button', name='Commit').click(); got = toasts(pg)
        check('G: toast count', exp(2, 1), len(got))
        check('G: summary toast "see below"', True, any('see below' in t for t in got))
        check('G: row error shown in the result table', 1, pg.locator('table td', has_text='TEST days exceed cycle').count())
        check('G: the row error is NOT a toast', False, any('TEST days exceed cycle' in t for t in got))
        pg.context.close()

        # ── I: phone ──
        print('\n— I: 390 px —')
        pg = new_page(b, width=390); open_stage6(pg)
        pg.route('**/api/payroll/calculate-days', fulfill_json(409, {'error': 'TEST phone 409'}))
        pg.wait_for_load_state('networkidle')
        pg.get_by_role('button', name='▶ Run Day Calculation').first.evaluate('b => b.click()')  # mobile drawer overlays it
        got = toasts(pg)
        check('I: toast count at 390 px', exp(2, 1), len(got))
        pg.context.close()

        check('0 page errors', [], PAGE_ERRORS)
        b.close()
finally:
    srv.terminate()
    try: srv.wait(timeout=10)
    except Exception: srv.kill()

print(f'\n{PASS} passed, {FAIL} failed')
sys.exit(1 if FAIL else 0)
