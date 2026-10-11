#!/usr/bin/env python3
"""Finance Verification: Flag asks for a reason; sign-off Approve gated while flagged (P1-15, finding F-12) — browser check.

Chromium against the BUILT dist, real finance login, scratch DATA_DIR, fictional data only (codes T956x,
names "TEST EMP n" — the repo is public). Seeds salary rows for the CURRENT month (the page's default):
T9561 clean, T9562 held (→ a salary_held red flag), T9563 clean.

Usage:
  python3 backend/scripts/finverify-flag-reason-check.py               # this tree
  APP_ROOT=/tmp/wt python3 .../finverify-flag-reason-check.py --base   # old tree: fixed text, Approve open while flagged
Needs `npm run build --prefix frontend` in APP_ROOT first. PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers.
"""
import datetime, json, os, re, shutil, sqlite3, subprocess, sys, tempfile, time, urllib.request
from playwright.sync_api import sync_playwright

HERE_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
ROOT = os.path.abspath(os.environ.get('APP_ROOT', HERE_ROOT))
BASE_MODE = '--base' in sys.argv
PORT = int(os.environ.get('PORT', '3115')); BASE = f'http://127.0.0.1:{PORT}'
WORK = tempfile.mkdtemp(prefix='finverify-'); DB = os.path.join(WORK, 'hr_system.db')
C = 'Asian Lakto Ind Ltd'
TODAY = datetime.date.today(); M, Y = TODAY.month, TODAY.year
PASS = FAIL = 0
ROWS = [('T9561', 0, ''), ('T9562', 1, 'Test hold'), ('T9563', 0, '')]


def check(label, expected, actual):
    global PASS, FAIL
    if expected == actual: PASS += 1; print(f'  ✓ {label}')
    else: FAIL += 1; print(f'  ✗ {label} — expected {expected!r}, got {actual!r}')


def q(sql, *a):
    c = sqlite3.connect(DB); r = c.execute(sql, a).fetchall(); c.close(); return r


def ex(sql, *a):
    c = sqlite3.connect(DB); c.execute(sql, a); c.commit(); c.close()


def seed():
    for i, (code, held, why) in enumerate(ROWS, 1):
        ex("INSERT OR IGNORE INTO employees(code,name,department,company,status,employment_type,gross_salary) "
           "VALUES(?,?,'TEST DEPT',?,'Active','Permanent',20000)", code, f'TEST EMP {i}', C)
        ex("INSERT INTO day_calculations(employee_code,month,year,company,total_payable_days) VALUES(?,?,?,?,26)", code, M, Y, C)
        ex("INSERT INTO salary_computations(employee_code,month,year,company,payable_days,gross_salary,gross_earned,"
           "total_deductions,net_salary,salary_held,hold_reason) VALUES(?,?,?,?,26,20000,20000,0,20000,?,?)",
           code, M, Y, C, held, why)


def status(code):
    r = q("SELECT status, flag_reason, flag_category FROM finance_audit_status WHERE employee_code=? AND month=? AND year=?", code, M, Y)
    return r[0] if r else None


def login(b, width=1440):
    ctx = b.new_context(viewport={'width': width, 'height': 900})
    pg = ctx.new_page()
    errs, cons, bad, posts = [], [], [], []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('console', lambda m: cons.append(m.text) if m.type == 'error' and 'vite.svg' not in m.text and '404' not in m.text else None)
    pg.on('response', lambda r: bad.append(f'{r.status} {r.url}') if '/api/' in r.url and r.status >= 400 else None)
    pg.on('request', lambda r: posts.append((r.url.split('/api/')[-1], r.post_data_json)) if r.method == 'POST' and '/finance-verify/' in r.url else None)
    pg.goto(BASE + '/login'); pg.get_by_placeholder('admin').fill('finance'); pg.get_by_placeholder('••••••••').fill('Finance@2025')
    pg.get_by_role('button', name='Sign in').click(); pg.wait_for_url(lambda u: '/login' not in u)
    pg.goto(BASE + '/finance-verification'); pg.wait_for_load_state('networkidle'); time.sleep(.8)
    return pg, errs, cons, bad, posts


def tab(pg, name):
    pg.get_by_role('button', name=re.compile('^' + re.escape(name))).first.click(); pg.wait_for_load_state('networkidle'); time.sleep(.6)


def emp_row(pg, code):
    return pg.locator('tr', has=pg.get_by_text(code, exact=True)).first


def open_signoff(pg):
    tab(pg, 'Audit Dashboard'); pg.get_by_role('button', name='Sign Off Month').click(); time.sleep(.5)
    return pg.get_by_role('button', name='Approve', exact=True)


def close_modal(pg):
    pg.keyboard.press('Escape'); time.sleep(.3)


def status_posts(posts): return [p for p in posts if p[0].startswith('finance-verify/status')]


env = dict(os.environ, DATA_DIR=WORK, JWT_SECRET='x', PORT=str(PORT), NODE_ENV='production',
           ADMIN_PASSWORD='Admin@123', HR_PASSWORD='Indriyan@2025', FINANCE_PASSWORD='Finance@2025')
srv = subprocess.Popen(['node', f'{ROOT}/backend/server.js'], env=env, stdout=open(f'{WORK}/log', 'w'), stderr=subprocess.STDOUT)
try:
    for _ in range(80):
        try: urllib.request.urlopen(BASE + '/api/version', timeout=2); break
        except Exception: time.sleep(.5)
    seed()
    print(f'App root: {ROOT}  mode: {"BASE (expect fixed text + open Approve)" if BASE_MODE else "fix"}  month {M}/{Y}')
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg, errs, cons, bad, posts = login(b)
        if BASE_MODE:
            tab(pg, 'Employee Review')
            emp_row(pg, 'T9561').get_by_title('Flag').click(); time.sleep(1)
            check('old: ⚠ posts at once (no dialog)', 0, pg.get_by_text('Reason for flagging').count())
            sp = status_posts(posts)
            check('old: flag reason = fixed text', 'Flagged for review', sp[-1][1].get('flagReason') if sp else None)
            check('old: DB stored fixed text', ('flagged', 'Flagged for review', None), status('T9561'))
            approve = open_signoff(pg)
            check('old: Approve enabled while 1 flagged', True, approve.is_enabled())
            with pg.expect_response(lambda r: '/finance-verify/signoff' in r.url and r.request.method == 'POST') as rr:
                approve.click()
            check('old: click goes to the server, which refuses with 400', 400, rr.value.status)
            check('old: no signoff row written', [], q("SELECT status FROM finance_month_signoff"))
            b.close()
        else:
            print('\n— clean month: Approve open —')
            approve = open_signoff(pg)
            check('clean: Approve enabled', True, approve.is_enabled())
            check('clean: no "still flagged" line', 0, pg.get_by_test_id('signoff-open-flags').count())
            close_modal(pg)

            print('\n— Employee Review ⚠ needs a reason —')
            tab(pg, 'Employee Review')
            emp_row(pg, 'T9561').get_by_title('Flag').click(); time.sleep(.4)
            inp, ok = pg.get_by_test_id('flag-reason-input'), pg.get_by_test_id('flag-confirm')
            check('dialog opens, textarea empty', '', inp.input_value())
            check('empty → Confirm disabled', False, ok.is_enabled())
            inp.fill('abcd'); check('4 chars → disabled', False, ok.is_enabled())
            inp.fill('        '); check('spaces only → disabled', False, ok.is_enabled())
            ok.click(force=True); time.sleep(.4)
            check('forced click on disabled Confirm sends nothing', 0, len(status_posts(posts)))
            pg.get_by_role('button', name='Cancel').click(); time.sleep(.4)
            check('Cancel: no POST, no DB row', (0, None), (len(status_posts(posts)), status('T9561')))
            emp_row(pg, 'T9561').get_by_title('Flag').click(); time.sleep(.4)
            check('reopen: textarea empty again', '', inp.input_value())
            inp.fill('abcde'); check('5 chars → enabled', True, ok.is_enabled())
            inp.fill('  Bank IFSC missing  '); ok.click(); time.sleep(1.2)
            check('POST body reason = trimmed text', 'Bank IFSC missing', status_posts(posts)[-1][1].get('flagReason'))
            check('DB: flagged + reason, no category', ('flagged', 'Bank IFSC missing', None), status('T9561'))
            check('dialog closed after success', 0, pg.get_by_test_id('flag-reason-input').count())
            check('row shows the stored reason', 'Bank IFSC missing', emp_row(pg, 'T9561').get_by_test_id('flag-reason').inner_text())

            print('\n— Red Flags card Flag: pre-filled, editable —')
            tab(pg, 'Red Flags')
            card = pg.locator('div.card, div.border', has=pg.get_by_text('(T9562)')).last
            card.get_by_role('button', name='Flag', exact=True).click(); time.sleep(.4)
            check('pre-filled with the detector description', 'Salary on hold: Test hold', inp.input_value())
            check('pre-filled → Confirm enabled', True, ok.is_enabled())
            inp.fill('Salary on hold: Test hold - check joining papers'); ok.click(); time.sleep(1.2)
            check('DB: edited reason + category salary_held',
                  ('flagged', 'Salary on hold: Test hold - check joining papers', 'salary_held'), status('T9562'))

            print('\n— sign-off gate —')
            approve = open_signoff(pg)
            check('2 flagged → Approve disabled', False, approve.is_enabled())
            check('line says 2 still flagged', True, pg.get_by_test_id('signoff-open-flags').inner_text().startswith('2 still flagged'))
            approve.click(force=True); time.sleep(.5)
            check('forced click → no signoff POST', 0, len([x for x in posts if x[0].startswith('finance-verify/signoff')]))
            check('Reject textarea still reachable', 1, pg.get_by_placeholder('Rejection reason (required)...').count())
            close_modal(pg)
            tab(pg, 'Employee Review')
            emp_row(pg, 'T9561').get_by_title('Verify').click(); time.sleep(1)
            approve = open_signoff(pg)
            check('verify one → "1 still flagged" at once (no-cache)', True,
                  pg.get_by_test_id('signoff-open-flags').inner_text().startswith('1 still flagged'))
            close_modal(pg)
            tab(pg, 'Employee Review')
            emp_row(pg, 'T9562').get_by_title('Verify').click(); time.sleep(1)
            ex("INSERT INTO finance_audit_status(employee_code,month,year,status,verified_by) VALUES('T9563',?,?,'rejected','test')", M, Y)
            pg.reload(); pg.wait_for_load_state('networkidle'); time.sleep(.8)
            approve = open_signoff(pg)
            check('a rejected row also blocks (server rule)', (False, True),
                  (approve.is_enabled(), pg.get_by_test_id('signoff-open-flags').inner_text().startswith('1 still flagged')))
            close_modal(pg)
            tab(pg, 'Employee Review')
            emp_row(pg, 'T9563').get_by_title('Verify').click(); time.sleep(1)
            approve = open_signoff(pg)
            check('all verified → Approve enabled, no line', (True, 0), (approve.is_enabled(), pg.get_by_test_id('signoff-open-flags').count()))
            approve.click(); time.sleep(1.2)
            check('DB: signoff approved', [('approved',)], q("SELECT status FROM finance_month_signoff WHERE month=? AND year=?", M, Y))
            check('0 page errors', [], errs)
            check('0 console errors', [], cons)
            check('0 API ≥ 400', [], bad)

            print('\n— phone width 390px —')
            ex("DELETE FROM finance_audit_status WHERE employee_code='T9561'")
            pg, errs, cons, bad, posts = login(b, width=390)
            tab(pg, 'Employee Review')
            emp_row(pg, 'T9561').get_by_title('Flag').click(force=True); time.sleep(.4)
            ok = pg.get_by_test_id('flag-confirm'); ok.scroll_into_view_if_needed()
            bb = ok.bounding_box()
            check('phone: Confirm inside the viewport', True, bb is not None and bb['x'] >= 0 and bb['x'] + bb['width'] <= 390)
            pg.get_by_test_id('flag-reason-input').fill('Phone flag test'); ok.click(); time.sleep(1)
            check('phone: DB reason stored', ('flagged', 'Phone flag test', None), status('T9561'))
            check('phone: 0 page errors', [], errs)
            check('phone: 0 API ≥ 400', [], bad)
            b.close()
finally:
    srv.terminate(); shutil.rmtree(WORK, ignore_errors=True)

print(f'\n{PASS} passed, {FAIL} failed')
sys.exit(1 if FAIL else 0)
