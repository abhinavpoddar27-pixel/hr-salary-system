#!/usr/bin/env python3
"""Stage 6 Apply Leave window starts empty for every employee (P1-05, finding P-3) — browser check.

Chromium against the BUILT dist, real hr login (hr path = "Send to finance" → a 'Pending Finance'
leave_applications row), scratch DATA_DIR with fictional data (codes T950x, names "TEST LEAVEFORM n" — the
repo is public). September 2026: every employee P Mon–Sat, WO Sundays, plus two absent days each, so the
Absent cell shows the "Apply Leave" button. Leave balances CL 3 / EL 5 for the current calendar year.

Fix mode: for each way to dismiss the window (Cancel, ✕, Esc, backdrop) — type values for A, dismiss, open
for B → type CL, date empty, reason empty, submit disabled. Reopen A → empty. Submit for B → exactly one
request row, for B, with B's date/type/reason. Phone width 390px. 0 page/console errors, 0 API ≥ 400.

Usage:
  python3 backend/scripts/stage6-leave-form-reset-check.py               # this tree's server + dist
  APP_ROOT=/tmp/wt python3 .../stage6-leave-form-reset-check.py --base   # another tree (e.g. origin/main):
                                                                         # B's window shows A's values
Needs `npm run build --prefix frontend` in APP_ROOT first. PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers.
"""
import datetime, json, os, re, shutil, sqlite3, subprocess, sys, tempfile, time, urllib.request
from playwright.sync_api import sync_playwright

HERE_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
ROOT = os.path.abspath(os.environ.get('APP_ROOT', HERE_ROOT))
BASE_MODE = '--base' in sys.argv
PORT = int(os.environ.get('PORT', '3105')); BASE = f'http://127.0.0.1:{PORT}'
WORK = tempfile.mkdtemp(prefix='stage6-leaveform-'); DB = os.path.join(WORK, 'hr_system.db')
C = 'Asian Lakto Ind Ltd'
# code -> absent dates in Sep 2026 (all Mon–Sat)
EMPS = {'T9501': ['2026-09-08', '2026-09-09'], 'T9502': ['2026-09-15', '2026-09-16']}
A, B = 'T9501', 'T9502'
EMPTY = ('CL', '', '')
BAL_YEAR = datetime.date.today().year  # GET /leaves/balances/:code reads the current calendar year
PASS = FAIL = 0


def check(label, expected, actual):
    global PASS, FAIL
    if expected == actual: PASS += 1; print(f'  ✓ {label}')
    else: FAIL += 1; print(f'  ✗ {label} — expected {expected!r}, got {actual!r}')


def seed():
    c = sqlite3.connect(DB)
    for i, (code, absent) in enumerate(EMPS.items(), 1):
        c.execute("INSERT OR IGNORE INTO employees(code,name,department,company,status,employment_type,gross_salary,"
                  "date_of_joining,weekly_off_day) VALUES(?,?,'TEST DEPT',?,'Active','Permanent',20000,'2025-01-01',0)",
                  (code, f'TEST LEAVEFORM {i}', C))
        eid = c.execute('SELECT id FROM employees WHERE code=?', (code,)).fetchone()[0]
        for lt, bal in (('CL', 3), ('EL', 5)):
            c.execute("INSERT OR REPLACE INTO leave_balances(employee_id,year,leave_type,opening,balance) VALUES(?,?,?,?,?)",
                      (eid, BAL_YEAR, lt, bal, bal))
        for d in range(1, 31):
            dt = datetime.date(2026, 9, d)
            iso = dt.isoformat()
            st = 'WO' if dt.weekday() == 6 else ('A' if iso in absent else 'P')
            tin, tout = ('09:00', '18:00') if st == 'P' else ('', '')
            c.execute("INSERT INTO attendance_processed(employee_code,date,status_original,status_final,in_time_original,"
                      "in_time_final,out_time_original,out_time_final,month,year,company,stage_5_done) "
                      "VALUES(?,?,?,?,?,?,?,?,9,2026,?,1)", (code, iso, st, st, tin, tin, tout, tout, C))
    c.execute("INSERT OR IGNORE INTO monthly_imports(month,year,company,stage_1_done,stage_5_done) VALUES(9,2026,?,1,1)", (C,))
    c.commit(); c.close()


def api(path, body, tok):
    req = urllib.request.Request(BASE + path, data=json.dumps(body).encode(),
                                 headers={'Content-Type': 'application/json', **({'Authorization': f'Bearer {tok}'} if tok else {})})
    return json.loads(urllib.request.urlopen(req).read())


def requests_rows():
    c = sqlite3.connect(DB)
    r = c.execute("SELECT employee_code, leave_type, start_date, reason, status FROM leave_applications ORDER BY id").fetchall()
    c.close(); return r


def login(b, user, pw, width=1440):
    ctx = b.new_context(viewport={'width': width, 'height': 900})
    pg = ctx.new_page()
    errs, cons, bad = [], [], []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('console', lambda m: cons.append(m.text) if m.type == 'error' and 'vite.svg' not in m.text and '404' not in m.text else None)
    pg.on('response', lambda r: bad.append(f'{r.status} {r.url}') if '/api/' in r.url and r.status >= 400 else None)
    pg.goto(BASE + '/login'); pg.get_by_placeholder('admin').fill(user); pg.get_by_placeholder('••••••••').fill(pw)
    pg.get_by_role('button', name='Sign in').click(); pg.wait_for_url(lambda u: '/login' not in u)
    pg.goto(BASE + '/pipeline/day-calc'); pg.wait_for_load_state('networkidle')
    pg.locator('select').filter(has=pg.locator('option', has_text='September')).first.select_option('9')
    pg.locator('select').filter(has=pg.locator('option', has_text='2026')).first.select_option('2026')
    pg.wait_for_load_state('networkidle')
    pg.get_by_text('TEST LEAVEFORM 1').first.wait_for(timeout=15000)
    return pg, errs, cons, bad


def modal(pg):
    return pg.locator('div.fixed.inset-0').filter(has=pg.locator('h3', has_text='Apply Leave:'))


def open_for(pg, code):
    row = pg.locator('table tbody > tr', has=pg.get_by_text(code, exact=True)).first
    row.get_by_role('button', name='Apply Leave').click()
    m = modal(pg); m.wait_for(timeout=5000)
    check(f'window opened for {code}', True, m.locator('h3').inner_text().strip().startswith('Apply Leave:') and code in m.inner_text())
    return m


def form(m):
    return (m.locator('select').first.input_value(), m.locator('input[type=date]').input_value(),
            m.locator('input[type=text]').input_value())


def fill(m, lt, date, reason):
    m.locator('select').first.select_option(lt)
    m.locator('input[type=date]').fill(date)
    m.locator('input[type=text]').fill(reason)


def submit_btn(m):
    return m.get_by_role('button', name=re.compile('^(Send to finance|Apply Leave|Sending...|Applying...)$'))


def dismiss(pg, how):
    m = modal(pg)
    if how == 'Cancel': m.get_by_role('button', name='Cancel', exact=True).click()
    elif how == '✕': m.locator('h3 + button').click()
    elif how == 'Esc': pg.keyboard.press('Escape')
    elif how == 'backdrop': pg.mouse.click(5, 5)
    modal(pg).wait_for(state='detached', timeout=5000)


env = dict(os.environ, DATA_DIR=WORK, JWT_SECRET='x', PORT=str(PORT), NODE_ENV='production',
           ADMIN_PASSWORD='Admin@123', HR_PASSWORD='Indriyan@2025', FINANCE_PASSWORD='Finance@2025')
srv = subprocess.Popen(['node', f'{ROOT}/backend/server.js'], env=env, stdout=open(f'{WORK}/log', 'w'), stderr=subprocess.STDOUT)
try:
    for _ in range(80):
        try: urllib.request.urlopen(BASE + '/api/version', timeout=2); break
        except Exception: time.sleep(.5)
    seed()
    tok = api('/api/auth/login', {'username': 'admin', 'password': 'Admin@123'}, None)['token']
    r = api('/api/payroll/calculate-days', {'month': 9, 'year': 2026, 'company': ''}, tok)
    print(f'App root: {ROOT}  mode: {"BASE (expect A values in B window)" if BASE_MODE else "fix"}  stage6: {r.get("success")}')

    with sync_playwright() as p:
        b = p.chromium.launch()
        if BASE_MODE:
            pg, errs, cons, bad = login(b, 'hr', 'Indriyan@2025')
            m = open_for(pg, A)
            fill(m, 'EL', EMPS[A][0], 'test A cancel')
            dismiss(pg, 'Cancel')
            m = open_for(pg, B)
            check("old code: B's window shows A's values", ('EL', EMPS[A][0], 'test A cancel'), form(m))
            check('old code: submit enabled for B with A values', True, submit_btn(m).is_enabled())
            b.close()
        else:
            pg, errs, cons, bad = login(b, 'hr', 'Indriyan@2025')
            for how in ('Cancel', '✕', 'Esc', 'backdrop'):
                print(f'\n— dismiss with {how} —')
                m = open_for(pg, A)
                check(f'{how}: A opens empty', EMPTY, form(m))
                fill(m, 'EL', EMPS[A][0], f'test A {how}')
                check(f'{how}: A typed', ('EL', EMPS[A][0], f'test A {how}'), form(m))
                dismiss(pg, how)
                m = open_for(pg, B)
                check(f'{how}: B opens empty', EMPTY, form(m))
                check(f'{how}: B submit disabled (no reason)', False, submit_btn(m).is_enabled())
                dismiss(pg, 'Cancel')
            check('no request rows after dismissals', [], requests_rows())

            print('\n— reopen the SAME employee after closing (ruling Q1: reset) —')
            m = open_for(pg, A); fill(m, 'EL', EMPS[A][1], 'half typed'); dismiss(pg, '✕')
            m = open_for(pg, A)
            check('A reopened empty', EMPTY, form(m))
            dismiss(pg, 'Esc')

            print('\n— submit for B after typing for A —')
            m = open_for(pg, A); fill(m, 'EL', EMPS[A][0], 'test A then closed'); dismiss(pg, 'Cancel')
            m = open_for(pg, B)
            check('B empty before typing', EMPTY, form(m))
            fill(m, 'EL', EMPS[B][0], 'test B request')
            with pg.expect_response(lambda r: '/corrections/apply-leave' in r.url and r.request.method == 'POST') as resp:
                submit_btn(m).click()
            check('POST 200', 200, resp.value.status)
            check('POST body is for B with B values', {'employee_code': B, 'date': EMPS[B][0], 'leave_type': 'EL', 'reason': 'test B request'},
                  {k: resp.value.request.post_data_json.get(k) for k in ('employee_code', 'date', 'leave_type', 'reason')})
            modal(pg).wait_for(state='detached', timeout=5000)
            check('one request row, for B, B values', [(B, 'EL', EMPS[B][0], 'test B request', 'Pending Finance')], requests_rows())
            time.sleep(.5)
            m = open_for(pg, B)
            check('B reopened after submit → empty', EMPTY, form(m))
            dismiss(pg, 'Cancel')
            check('0 page errors', [], errs); check('0 console errors', [], cons); check('0 API ≥ 400', [], bad)

            print('\n— edge: a refused submit keeps the window and the typed values —')
            m = open_for(pg, A)
            fill(m, 'EL', '2026-09-10', 'test A not absent')  # a P day → server 404 "No absent record"
            with pg.expect_response(lambda r: '/corrections/apply-leave' in r.url and r.request.method == 'POST') as resp:
                submit_btn(m).click()
            check('refused: POST 404', 404, resp.value.status)
            time.sleep(.5)
            check('refused: window still open', 1, modal(pg).count())
            check('refused: values kept', ('EL', '2026-09-10', 'test A not absent'), form(modal(pg)))
            dismiss(pg, 'Cancel')
            m = open_for(pg, B)
            check('refused then closed: B opens empty', EMPTY, form(m))
            dismiss(pg, 'Cancel')
            check('refused: still one request row', 1, len(requests_rows()))
            check('refused: 0 page errors', [], errs)
            check('refused: only the expected 404', [u for u in bad if '/corrections/apply-leave' in u], bad)

            print('\n— phone width 390px —')
            pg, errs, cons, bad = login(b, 'hr', 'Indriyan@2025', width=390)
            m = open_for(pg, A); fill(m, 'CL', EMPS[A][1], 'phone A'); dismiss(pg, 'backdrop')
            m = open_for(pg, B)
            check('phone: B opens empty', EMPTY, form(m))
            dismiss(pg, 'Esc')
            check('phone: 0 page errors', [], errs); check('phone: 0 API ≥ 400', [], bad)
            b.close()
finally:
    srv.terminate(); shutil.rmtree(WORK, ignore_errors=True)

print(f'\n{PASS} passed, {FAIL} failed')
sys.exit(1 if FAIL else 0)
