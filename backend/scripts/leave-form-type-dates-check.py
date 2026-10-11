#!/usr/bin/env python3
"""Leave Management → Apply Leave: only CL/EL/LWP offered; end date before start blocked (P1-20, finding H-7).

Chromium against the BUILT dist, real hr login, scratch DATA_DIR with fictional data (employee codes T96xx,
names "TEST LEAVEFORM n" — the repo is public). Seeds CL/EL balances for the current year.

Fix mode: the type list is exactly CL / EL / LWP; end < start shows a hint, disables Submit and sends no POST;
fixing the end date clears the hint and sets Days to the range length; a valid CL range and an LWP day submit;
same-day range = 1 day; 390px phone; 0 page/console errors, 0 API >= 400.

Usage:
  python3 backend/scripts/leave-form-type-dates-check.py               # this tree's server + dist
  APP_ROOT=/tmp/wt python3 .../leave-form-type-dates-check.py --base   # another tree (e.g. origin/main):
                                                                       # Comp Off offered -> 400; end < start saved
Needs `npm run build --prefix frontend` in APP_ROOT first. PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers.
"""
import datetime, os, shutil, sqlite3, subprocess, sys, tempfile, time, urllib.request
from playwright.sync_api import sync_playwright

HERE_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
ROOT = os.path.abspath(os.environ.get('APP_ROOT', HERE_ROOT))
BASE_MODE = '--base' in sys.argv
PORT = int(os.environ.get('PORT', '3120')); BASE = f'http://127.0.0.1:{PORT}'
WORK = tempfile.mkdtemp(prefix='leave-form-'); DB = os.path.join(WORK, 'hr_system.db')
C = 'Asian Lakto Ind Ltd'
TODAY = datetime.date.today()
Y, M = TODAY.year, TODAY.month
EMPS = ['T9651', 'T9652', 'T9653', 'T9654']
PASS = FAIL = 0


def d(day): return f'{Y}-{M:02d}-{day:02d}'


def check(label, expected, actual):
    global PASS, FAIL
    if expected == actual: PASS += 1; print(f'  ✓ {label}')
    else: FAIL += 1; print(f'  ✗ {label} — expected {expected!r}, got {actual!r}')


def seed():
    c = sqlite3.connect(DB)
    for i, code in enumerate(EMPS, 1):
        c.execute("INSERT OR IGNORE INTO employees(code,name,department,company,status,employment_type,gross_salary,date_of_joining) "
                  "VALUES(?,?,'TEST DEPT',?,'Active','Permanent',20000,'2025-01-01')", (code, f'TEST LEAVEFORM {i}', C))
        eid = c.execute('SELECT id FROM employees WHERE code=?', (code,)).fetchone()[0]
        for lt, bal in (('CL', 4), ('EL', 10)):
            c.execute("INSERT OR REPLACE INTO leave_balances(employee_id,year,leave_type,opening,balance) VALUES(?,?,?,?,?)",
                      (eid, Y, lt, bal, bal))
    c.commit(); c.close()


def rows(code):
    c = sqlite3.connect(DB)
    r = c.execute('SELECT leave_type,start_date,end_date,days,status FROM leave_applications WHERE employee_code=? ORDER BY id',
                  (code,)).fetchall()
    c.close(); return r


def wait_rows(code, n, tries=40):
    for _ in range(tries):
        r = rows(code)
        if len(r) >= n: return r
        time.sleep(.25)
    return rows(code)


def login(b, width=1440):
    ctx = b.new_context(viewport={'width': width, 'height': 900})
    pg = ctx.new_page()
    errs, cons, bad, posts = [], [], [], []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('console', lambda m: cons.append(m.text) if m.type == 'error' and 'vite.svg' not in m.text and '404' not in m.text else None)
    pg.on('response', lambda r: bad.append(f'{r.status} {r.url}') if '/api/' in r.url and r.status >= 400 else None)
    pg.on('request', lambda r: posts.append(r.url) if r.method == 'POST' and r.url.rstrip('/').endswith('/api/leaves') else None)
    pg.goto(BASE + '/login'); pg.get_by_placeholder('admin').fill('hr'); pg.get_by_placeholder('••••••••').fill('Indriyan@2025')
    pg.get_by_role('button', name='Sign in').click(); pg.wait_for_url(lambda u: '/login' not in u)
    pg.goto(BASE + '/leave-management'); pg.wait_for_load_state('networkidle')
    return pg, errs, cons, bad, posts


class Form:
    def __init__(self, pg):
        self.pg = pg
        pg.get_by_role('button', name='+ Apply Leave').click()
        pg.get_by_role('heading', name='Apply for Leave').wait_for(timeout=5000)
        self.modal = pg.locator('div', has=pg.get_by_role('heading', name='Apply for Leave')).last

    def pick(self, code):
        box = self.pg.get_by_placeholder('Type code or name…')
        box.fill(code); time.sleep(.4); box.press('Enter'); time.sleep(.6)

    @property
    def type_select(self):
        return self.pg.locator('select', has=self.pg.locator('option[value="LWP"]')).last

    def dates(self, start, end):
        di = self.pg.locator('input[type="date"]')
        di.nth(di.count() - 2).fill(start); di.nth(di.count() - 1).fill(end); time.sleep(.3)

    def days(self):
        return self.pg.locator('input[type="number"][step="0.5"]').last.input_value()

    def remark(self, txt):
        self.pg.get_by_placeholder('Mandatory HR note', exact=False).fill(txt)

    @property
    def submit(self):
        return self.pg.get_by_role('button', name='Submit Application')

    def hint(self):
        return self.pg.locator('[data-testid="leave-date-hint"]').count()


env = dict(os.environ, DATA_DIR=WORK, JWT_SECRET='x', PORT=str(PORT), NODE_ENV='production',
           ADMIN_PASSWORD='Admin@123', HR_PASSWORD='Indriyan@2025', FINANCE_PASSWORD='Finance@2025')
srv = subprocess.Popen(['node', f'{ROOT}/backend/server.js'], env=env, stdout=open(f'{WORK}/log', 'w'), stderr=subprocess.STDOUT)
try:
    for _ in range(80):
        try: urllib.request.urlopen(BASE + '/api/version', timeout=2); break
        except Exception: time.sleep(.5)
    seed()
    print(f'App root: {ROOT}  mode: {"BASE (expect Comp Off + reversed range accepted)" if BASE_MODE else "fix"}  month: {M}/{Y}')

    with sync_playwright() as p:
        b = p.chromium.launch()
        if BASE_MODE:
            pg, errs, cons, bad, posts = login(b)
            f = Form(pg); f.pick('T9651')
            opts = f.type_select.locator('option').evaluate_all('o => o.map(x => x.value)')
            check('old code: Comp Off offered', True, 'Comp Off' in opts)
            f.type_select.select_option('Comp Off'); f.dates(d(5), d(5)); f.remark('fictional test remark')
            check('old code: Submit enabled for Comp Off', True, f.submit.is_enabled())
            with pg.expect_response(lambda r: r.request.method == 'POST' and r.url.rstrip('/').endswith('/api/leaves')) as resp:
                f.submit.click()
            check('old code: Comp Off submit → API 400', 400, resp.value.status)
            check('old code: no Comp Off row saved', [], rows('T9651'))
            f.type_select.select_option('LWP'); f.dates(d(20), d(10))
            check('old code: end < start shows Days 1', '1', f.days())
            check('old code: Submit enabled with end < start', True, f.submit.is_enabled())
            f.submit.click()
            r = wait_rows('T9651', 1)
            check('old code: reversed range saved', [('LWP', d(20), d(10), 1.0, 'Pending')], r)
            b.close()
        else:
            print('\n— type list —')
            pg, errs, cons, bad, posts = login(b)
            f = Form(pg); f.pick('T9651')
            opts = f.type_select.locator('option').evaluate_all('o => o.map(x => x.value)')
            check('Apply Leave types are exactly CL/EL/LWP', ['CL', 'EL', 'LWP'], opts)
            filt = pg.locator('select', has=pg.locator('option[value="All"]')).first
            check('Applications filter unchanged (still lists Comp Off, ruling Q1)', True,
                  'Comp Off' in filt.locator('option').evaluate_all('o => o.map(x => x.value)'))

            print('\n— end before start —')
            f.remark('fictional test remark')
            f.dates(d(10), d(12))
            check('valid 3-day range → Days 3', '3', f.days())
            check('valid range → no hint', 0, f.hint())
            # Change only the end date (filling start first would pass through a valid 1-day range).
            pg.locator('input[type="date"]').last.fill(d(9)); time.sleep(.3)
            check('end < start → hint shown', 1, f.hint())
            check('hint text', 'End date must be on or after the start date.',
                  pg.locator('[data-testid="leave-date-hint"]').inner_text().strip())
            check('end < start → Submit disabled', False, f.submit.is_enabled())
            check('end < start → Days keeps last value (ruling Q2)', '3', f.days())
            f.submit.click(force=True); time.sleep(.8)
            check('forced click on disabled Submit → no POST', [], posts)
            check('end-date input has min = start', d(10), pg.locator('input[type="date"]').last.get_attribute('min'))
            f.dates(d(12), d(14))
            check('fixed range → hint gone', 0, f.hint())
            check('fixed range → Days 3', '3', f.days())
            check('fixed range → Submit enabled', True, f.submit.is_enabled())
            f.submit.click()
            r = wait_rows('T9651', 1)
            check('CL 12–14 saved as 3 days Pending', [('CL', d(12), d(14), 3.0, 'Pending')], r)

            print('\n— same-day range and LWP —')
            pg.wait_for_load_state('networkidle'); time.sleep(.5)
            f = Form(pg); f.pick('T9652'); f.type_select.select_option('LWP')
            f.dates(d(6), d(6)); f.remark('fictional test remark')
            check('same-day range → Days 1', '1', f.days())
            check('same-day range → no hint', 0, f.hint())
            f.submit.click()
            r = wait_rows('T9652', 1)
            check('LWP same day saved', [('LWP', d(6), d(6), 1.0, 'Pending')], r)

            print('\n— start moved after end (edit the start, not the end) —')
            pg.wait_for_load_state('networkidle'); time.sleep(.5)
            f = Form(pg); f.pick('T9653'); f.remark('fictional test remark')
            f.dates(d(3), d(4))
            di = pg.locator('input[type="date"]'); di.nth(di.count() - 2).fill(d(8)); time.sleep(.3)
            check('start after end → hint + disabled', (1, False), (f.hint(), f.submit.is_enabled()))
            pg.get_by_role('button', name='Cancel', exact=True).last.click(); time.sleep(.5)
            check('T9653 nothing saved', [], rows('T9653'))
            check('POSTs sent = 2 (only the two valid submits)', 2, len(posts))
            check('0 page errors', [], errs)
            check('0 console errors', [], cons)
            check('0 API ≥ 400', [], bad)

            print('\n— phone width 390px —')
            pg, errs, cons, bad, posts = login(b, width=390)
            f = Form(pg); f.pick('T9654'); f.remark('fictional test remark')
            f.dates(d(18), d(16))
            check('phone: hint visible', True, pg.locator('[data-testid="leave-date-hint"]').is_visible())
            check('phone: Submit disabled', False, f.submit.is_enabled())
            f.dates(d(16), d(17)); f.type_select.select_option('EL')
            f.submit.click()
            r = wait_rows('T9654', 1)
            check('phone: EL 16–17 saved as 2 days', [('EL', d(16), d(17), 2.0, 'Pending')], r)
            check('phone: 0 page errors', [], errs)
            check('phone: 0 API ≥ 400', [], bad)
            b.close()
finally:
    srv.terminate(); shutil.rmtree(WORK, ignore_errors=True)

print(f'\n{PASS} passed, {FAIL} failed')
sys.exit(1 if FAIL else 0)
