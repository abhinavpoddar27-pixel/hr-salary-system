#!/usr/bin/env python3
"""Leave Management → Reject keeps the reason (P1-06, finding H-3) — browser check.

Chromium against the BUILT dist, real hr + finance logins, scratch DATA_DIR with fictional data
(employee codes T96xx, names "TEST LEAVE n" — the repo is public). Seeds Pending CL applications in the
current month (the page's default month).

Fix mode: a reason shorter than 5 characters (or only spaces) keeps Confirm Reject disabled; a valid reason
rejects the row, the reason shows under the status and in the expanded detail, and the DB value equals the
typed (trimmed) text. Also: reopening the modal starts empty; finance can reject; 390px phone; 0 errors.

Usage:
  python3 backend/scripts/leave-reject-reason-check.py               # this tree's server + dist
  APP_ROOT=/tmp/wt python3 .../leave-reject-reason-check.py --base   # another tree (e.g. origin/main):
                                                                     # Confirm accepts any text, DB reason ''
Needs `npm run build --prefix frontend` in APP_ROOT first. PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers.
"""
import datetime, os, re, shutil, sqlite3, subprocess, sys, tempfile, time, urllib.request
from playwright.sync_api import sync_playwright

HERE_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
ROOT = os.path.abspath(os.environ.get('APP_ROOT', HERE_ROOT))
BASE_MODE = '--base' in sys.argv
PORT = int(os.environ.get('PORT', '3106')); BASE = f'http://127.0.0.1:{PORT}'
WORK = tempfile.mkdtemp(prefix='leave-rej-'); DB = os.path.join(WORK, 'hr_system.db')
C = 'Asian Lakto Ind Ltd'
TODAY = datetime.date.today()
Y, M = TODAY.year, TODAY.month
PASS = FAIL = 0
LEAVES = {  # code -> day of the current month
    'T9601': 20, 'T9602': 21, 'T9603': 22, 'T9604': 23,
}


def check(label, expected, actual):
    global PASS, FAIL
    if expected == actual: PASS += 1; print(f'  ✓ {label}')
    else: FAIL += 1; print(f'  ✗ {label} — expected {expected!r}, got {actual!r}')


def seed():
    c = sqlite3.connect(DB)
    for i, (code, day) in enumerate(LEAVES.items(), 1):
        c.execute("INSERT OR IGNORE INTO employees(code,name,department,company,status,employment_type,gross_salary,date_of_joining) "
                  "VALUES(?,?,'TEST DEPT',?,'Active','Permanent',20000,'2025-01-01')", (code, f'TEST LEAVE {i}', C))
        eid = c.execute('SELECT id FROM employees WHERE code=?', (code,)).fetchone()[0]
        d = f'{Y}-{M:02d}-{day:02d}'
        c.execute("INSERT INTO leave_applications(employee_id,employee_code,leave_type,start_date,end_date,days,reason,status) "
                  "VALUES(?,?,'CL',?,?,1,'family function','Pending')", (eid, code, d, d))
    c.commit(); c.close()


def db_row(code):
    c = sqlite3.connect(DB)
    r = c.execute('SELECT status, rejection_reason, approved_by FROM leave_applications WHERE employee_code=?', (code,)).fetchone()
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
    pg.goto(BASE + '/leave-management'); pg.wait_for_load_state('networkidle')
    pg.get_by_text('TEST LEAVE 1').first.wait_for(timeout=15000)
    return pg, errs, cons, bad


def row_of(pg, code):
    return pg.locator('table tbody > tr', has=pg.get_by_text(code, exact=False)).filter(has_not=pg.locator('td[colspan]')).first


def open_reject(pg, code):
    row_of(pg, code).get_by_role('button', name='Reject').click()
    modal_title = pg.get_by_role('heading', name='Reject Leave')
    modal_title.wait_for(timeout=5000)
    return pg.locator('textarea').last, pg.get_by_role('button', name=re.compile('Confirm Reject|Rejecting'))


def wait_status(code, want, tries=40):
    for _ in range(tries):
        r = db_row(code)
        if r and r[0] == want: return r
        time.sleep(.25)
    return db_row(code)


env = dict(os.environ, DATA_DIR=WORK, JWT_SECRET='x', PORT=str(PORT), NODE_ENV='production',
           ADMIN_PASSWORD='Admin@123', HR_PASSWORD='Indriyan@2025', FINANCE_PASSWORD='Finance@2025')
srv = subprocess.Popen(['node', f'{ROOT}/backend/server.js'], env=env, stdout=open(f'{WORK}/log', 'w'), stderr=subprocess.STDOUT)
try:
    for _ in range(80):
        try: urllib.request.urlopen(BASE + '/api/version', timeout=2); break
        except Exception: time.sleep(.5)
    seed()
    print(f'App root: {ROOT}  mode: {"BASE (expect empty reason stored)" if BASE_MODE else "fix"}  month: {M}/{Y}')

    with sync_playwright() as p:
        b = p.chromium.launch()
        if BASE_MODE:
            pg, errs, cons, bad = login(b, 'hr', 'Indriyan@2025')
            ta, btn = open_reject(pg, 'T9601')
            ta.fill('abc')
            check('old code: Confirm enabled with a 3-char reason', True, btn.is_enabled())
            ta.fill('Peak dispatch week')
            btn.click()
            r = wait_status('T9601', 'Rejected')
            check('old code: row Rejected', 'Rejected', r[0])
            check("old code: DB rejection_reason is '' (typed text dropped)", '', r[1])
            b.close()
        else:
            print('\n— hr: reject with a reason —')
            pg, errs, cons, bad = login(b, 'hr', 'Indriyan@2025')
            ta, btn = open_reject(pg, 'T9601')
            check('empty reason → Confirm disabled', False, btn.is_enabled())
            ta.fill('abcd')
            check('4-char reason → Confirm disabled', False, btn.is_enabled())
            ta.fill('      ')
            check('spaces-only reason → Confirm disabled', False, btn.is_enabled())
            ta.fill('  ab  cd  ')
            check('"ab  cd" (5 chars trimmed incl. inner spaces) → enabled', True, btn.is_enabled())
            ta.fill(' a ')
            check('hint shows the requirement', 1, pg.get_by_text(re.compile('At least 5 characters')).count())
            typed = '  Peak dispatch week, please re-apply next month  '
            ta.fill(typed)
            check('valid reason → Confirm enabled', True, btn.is_enabled())
            btn.click()
            r = wait_status('T9601', 'Rejected')
            check('DB: row Rejected', 'Rejected', r[0])
            check('DB: rejection_reason == typed text (trimmed)', typed.strip(), r[1])
            check('DB: rejected by hr (from the login)', 'hr', r[2])
            pg.wait_for_load_state('networkidle'); time.sleep(1)
            row = row_of(pg, 'T9601')
            line = row.locator('[data-testid="rejection-reason"]')
            check('row: status pill Rejected', 1, row.get_by_text('Rejected', exact=True).count())
            check('row: reason line visible', True, line.count() == 1 and line.is_visible())
            check('row: reason line text', f'by hr: {typed.strip()}', line.inner_text().strip())
            check('row: full reason in tooltip', typed.strip(), line.get_attribute('title'))
            # The Reject button click bubbles to the row and already expanded it (pre-existing); expand only if closed.
            det = pg.locator('[data-testid="rejection-reason-detail"]')
            if det.count() == 0:
                row.locator('td').nth(1).click(); time.sleep(1.5)
            det.first.wait_for(timeout=10000)
            check('detail: rejection reason shown in full', True, det.count() == 1 and typed.strip() in det.inner_text())
            check('detail: rejected by hr', True, 'rejected by hr' in det.inner_text())

            print('\n— edge: reopen starts empty; Rejected tab lists it —')
            ta, btn = open_reject(pg, 'T9602')
            ta.fill('half typed reason')
            pg.get_by_role('button', name='Cancel', exact=True).last.click(); time.sleep(.5)
            ta, btn = open_reject(pg, 'T9602')
            check('reopened modal is empty', '', ta.input_value())
            check('reopened Confirm disabled', False, btn.is_enabled())
            pg.get_by_role('button', name='Cancel', exact=True).last.click(); time.sleep(.5)
            check('T9602 still Pending in DB', 'Pending', db_row('T9602')[0])
            pg.get_by_role('button', name='Rejected', exact=True).click(); pg.wait_for_load_state('networkidle'); time.sleep(1)
            check('Rejected tab: T9601 reason visible', 1, pg.locator('[data-testid="rejection-reason"]', has_text='Peak dispatch week').count())
            check('hr: 0 page errors', [], errs)
            check('hr: 0 console errors', [], cons)
            check('hr: 0 API ≥ 400', [], bad)

            print('\n— finance rejects —')
            pg, errs, cons, bad = login(b, 'finance', 'Finance@2025')
            ta, btn = open_reject(pg, 'T9603')
            ta.fill('No balance left')
            btn.click()
            r = wait_status('T9603', 'Rejected')
            check('finance: DB reason stored', ('Rejected', 'No balance left', 'finance'), r)
            check('finance: 0 page errors', [], errs)
            check('finance: 0 API ≥ 400', [], bad)

            print('\n— legacy row with an empty reason shows a dash —')
            c = sqlite3.connect(DB); c.execute("UPDATE leave_applications SET status='Rejected', rejection_reason='', approved_by='hr' WHERE employee_code='T9604'"); c.commit(); c.close()
            print('\n— phone width 390px (hr) —')
            pg, errs, cons, bad = login(b, 'hr', 'Indriyan@2025', width=390)
            line = row_of(pg, 'T9604').locator('[data-testid="rejection-reason"]')
            check('legacy empty reason → "by hr: —"', 'by hr: —', line.inner_text().strip())
            line1 = row_of(pg, 'T9601').locator('[data-testid="rejection-reason"]')
            check('phone: T9601 reason line present', 1, line1.count())
            check('phone: 0 page errors', [], errs)
            check('phone: 0 API ≥ 400', [], bad)
            b.close()
finally:
    srv.terminate(); shutil.rmtree(WORK, ignore_errors=True)

print(f'\n{PASS} passed, {FAIL} failed')
sys.exit(1 if FAIL else 0)
