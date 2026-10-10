#!/usr/bin/env python3
"""Dashboard: a failed action check must not read as "All clear" (P1-11, finding H-4) — browser check.

Chromium against the BUILT dist, real admin + finance logins, scratch DATA_DIR with fictional data
(employee codes T97xx, names "TEST EMP n" — the repo is public). Seeds the current month so every
action item has a non-zero real value: 2 held salaries, 3 pending manual flags, 1 pending late
deduction, 4 miss punches awaiting finance.

For each of the four action calls in turn the route is intercepted (HTTP 500, and once a
HTTP 200 {"success": false}) → that item must say "Couldn't check …" (admin list) / "—" +
"Couldn't check" (finance card), the other three show real values, the finance banner never says
"All caught up"; then the intercept is removed and Retry must bring the real value back.

Usage:
  python3 backend/scripts/dashboard-failed-call-check.py                 # this tree's server + dist
  APP_ROOT=/tmp/wt python3 .../dashboard-failed-call-check.py --base     # another tree (e.g. origin/main):
                                                                          # records the old "All clear" / green 0
Needs `npm run build --prefix frontend` in APP_ROOT first. PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers.
"""
import datetime, os, re, shutil, sqlite3, subprocess, sys, tempfile, time, urllib.request
from playwright.sync_api import sync_playwright

HERE_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
ROOT = os.path.abspath(os.environ.get('APP_ROOT', HERE_ROOT))
BASE_MODE = '--base' in sys.argv
PORT = int(os.environ.get('PORT', '3111')); BASE = f'http://127.0.0.1:{PORT}'
WORK = tempfile.mkdtemp(prefix='dash-fail-'); DB = os.path.join(WORK, 'hr_system.db')
C = 'Asian Lakto Ind Ltd'
NOW = datetime.date.today(); M, Y = NOW.month, NOW.year
PASS = FAIL = 0

# key → (route glob, admin label, finance card label, expected real count)
ITEMS = {
    'heldSalaries':     ('**/api/payroll/salary-register?*',          'Held Salaries need review',            'Held Salaries',     2),
    'manualFlags':      ('**/api/finance-audit/salary-manual-flags?*', 'Manual flags pending approval',        'Manual Flags',      3),
    'lateDeductions':   ('**/api/late-coming/deductions?*',           'Late deductions pending review',       'Late Deductions',   1),
    'missPunchFinance': ('**/api/attendance/miss-punches?*',          'Miss punches awaiting finance review', 'Miss Punch Review', 4),
}
PATHS = {'heldSalaries': '/api/payroll/salary-register', 'manualFlags': '/api/finance-audit/salary-manual-flags',
         'lateDeductions': '/api/late-coming/deductions', 'missPunchFinance': '/api/attendance/miss-punches'}


def check(label, expected, actual):
    global PASS, FAIL
    if expected == actual: PASS += 1; print(f'  ✓ {label}')
    else: FAIL += 1; print(f'  ✗ {label} — expected {expected!r}, got {actual!r}')


def seed():
    c = sqlite3.connect(DB)
    for i in range(1, 6):
        code = f'T97{i:02d}'
        c.execute("INSERT OR IGNORE INTO employees(code,name,department,company,status,employment_type,gross_salary) "
                  "VALUES(?,?,'TEST DEPT',?,'Active','Permanent',20000)", (code, f'TEST EMP {i}', C))
    # 3 salary rows, 2 held
    for i, held in ((1, 1), (2, 1), (3, 0)):
        c.execute("INSERT INTO salary_computations(employee_code,month,year,company,payable_days,gross_salary,gross_earned,"
                  "total_deductions,net_salary,salary_held,hold_reason) VALUES(?,?,?,?,26,20000,20000,0,20000,?,?)",
                  (f'T97{i:02d}', M, Y, C, held, 'Test hold' if held else ''))
    # 3 pending manual flags
    for i, ft in ((1, 'TEST_FLAG_A'), (2, 'TEST_FLAG_B'), (3, 'TEST_FLAG_C')):
        c.execute("INSERT INTO salary_manual_flags(employee_code,month,year,flag_type,finance_approved) VALUES(?,?,?,?,0)",
                  (f'T97{i:02d}', M, Y, ft))
    # 1 pending late deduction
    c.execute("INSERT INTO late_coming_deductions(employee_code,month,year,company,late_count,deduction_days,remark,applied_by,"
              "finance_status) VALUES('T9704',?,?,?,5,1,'test remark','hr','pending')", (M, Y, C))
    # 4 miss punches resolved by HR, awaiting finance
    for d in range(1, 5):
        c.execute("INSERT INTO attendance_processed(employee_code,date,month,year,company,is_miss_punch,miss_punch_type,"
                  "miss_punch_resolved,status_original,status_final) VALUES('T9705',?,?,?,?,1,'MISSING_OUT',1,'P','P')",
                  (f'{Y}-{M:02d}-{d:02d}', M, Y, C))
    c.commit(); c.close()


SESS = {}


def session(b, user, pw, width=1440):
    """One login per user+width (the login route is rate-limited); counters reset per test."""
    k = (user, width)
    if k not in SESS: SESS[k] = login(b, user, pw, width)
    pg, st = SESS[k]
    for key in list(ITEMS):
        if PATHS[key] in st['allowed']: clear_route(pg, st, key)
    st['errs'].clear(); st['cons'].clear(); st['bad'].clear()
    return pg, st


def login(b, user, pw, width=1440):
    ctx = b.new_context(viewport={'width': width, 'height': 900})
    pg = ctx.new_page()
    st = {'errs': [], 'cons': [], 'bad': [], 'allowed': []}
    pg.on('pageerror', lambda e: st['errs'].append(str(e)))

    def on_console(m):
        if m.type != 'error' or 'vite.svg' in m.text: return
        loc = (m.location or {}).get('url', '')
        txt = m.text + ' ' + loc
        if any(p in txt or p.replace('/api', '', 1) in txt for p in st['allowed']): return   # the intercepted call's own error
        st['cons'].append(m.text)
    pg.on('console', on_console)

    def on_resp(r):
        if '/api/' in r.url and r.status >= 400 and not any(p in r.url for p in st['allowed']):
            st['bad'].append(f'{r.status} {r.url}')
    pg.on('response', on_resp)
    pg.goto(BASE + '/login'); pg.get_by_placeholder('admin').fill(user); pg.get_by_placeholder('••••••••').fill(pw)
    pg.get_by_role('button', name='Sign in').click(); pg.wait_for_url(lambda u: '/login' not in u)
    return pg, st


def open_dash(pg):
    pg.goto(BASE + '/'); pg.wait_for_load_state('networkidle'); time.sleep(1.2)


def admin_rows(pg):
    box = pg.locator('div.bg-white.rounded-lg.shadow', has=pg.get_by_text('Pending Actions', exact=True)).first
    box.wait_for(timeout=15000)
    return [r.inner_text().strip() for r in box.locator('div.divide-y > div').all()]


def fin_cards(pg):
    grid = pg.locator('div.grid', has=pg.get_by_text('Held Salaries', exact=True)).first
    grid.wait_for(timeout=15000)
    return [c.inner_text().strip() for c in grid.locator(':scope > *').all()]


def fin_banner(pg):
    return pg.locator('div.rounded-lg.p-4 > div.font-semibold').first.inner_text().strip()


def fail_route(pg, st, key, mode='500'):
    glob = ITEMS[key][0]
    st['allowed'].append(PATHS[key])
    if mode == '500':
        pg.route(glob, lambda r: r.fulfill(status=500, content_type='application/json', body='{"success":false,"error":"test"}'))
    else:
        pg.route(glob, lambda r: r.fulfill(status=200, content_type='application/json', body='{"success":false}'))


def clear_route(pg, st, key):
    pg.unroute(ITEMS[key][0]); st['allowed'].remove(PATHS[key])


env = dict(os.environ, DATA_DIR=WORK, JWT_SECRET='x', PORT=str(PORT), NODE_ENV='production',
           ADMIN_PASSWORD='Admin@123', HR_PASSWORD='Indriyan@2025', FINANCE_PASSWORD='Finance@2025')
srv = subprocess.Popen(['node', f'{ROOT}/backend/server.js'], env=env, stdout=open(f'{WORK}/log', 'w'), stderr=subprocess.STDOUT)
try:
    for _ in range(80):
        try: urllib.request.urlopen(BASE + '/api/version', timeout=2); break
        except Exception: time.sleep(.5)
    seed()
    print(f'App root: {ROOT}  mode: {"BASE (expect All clear / green 0)" if BASE_MODE else "fix"}  month: {M}/{Y}')

    with sync_playwright() as p:
        b = p.chromium.launch()
        if BASE_MODE:
            pg, st = session(b, 'admin', 'Admin@123')
            fail_route(pg, st, 'lateDeductions'); open_dash(pg)
            rows = admin_rows(pg)
            check('old code (admin): failed late-deductions call shows "All clear"', True,
                  any('Late deductions pending review: All clear' in r for r in rows))
            pg, st = session(b, 'finance', 'Finance@2025')
            for k in ITEMS: fail_route(pg, st, k)
            open_dash(pg)
            check('old code (finance): all 4 calls failed → cards show 0', ['0'] * 4, [c.split('\n')[0] for c in fin_cards(pg)])
            check('old code (finance): banner says "All caught up"', 'All caught up — nothing pending', fin_banner(pg))
            b.close()
        else:
            # ── control: nothing fails ──
            print('\n— control: no intercept —')
            pg, st = session(b, 'admin', 'Admin@123'); open_dash(pg)
            rows = admin_rows(pg)
            for k, (_, lab, _, n) in ITEMS.items():
                check(f'admin control: "{n} {lab}"', True, any(r.startswith(f'{n} {lab}') for r in rows))
            check('admin control: no "Couldn\'t check"', False, any("Couldn't check" in r for r in rows))
            pg, st = session(b, 'finance', 'Finance@2025'); open_dash(pg)
            check('finance control: card counts', [str(v[3]) for v in ITEMS.values()], [c.split('\n')[0] for c in fin_cards(pg)])
            check('finance control: banner', '10 item(s) need your attention', fin_banner(pg))

            # ── each call fails in turn (admin list) ──
            for key, (glob, lab, flab, n) in ITEMS.items():
                print(f'\n— admin: {key} returns 500 —')
                pg, st = session(b, 'admin', 'Admin@123')
                fail_route(pg, st, key); open_dash(pg)
                rows = admin_rows(pg)
                check(f'{key}: shows "Couldn\'t check {lab}"', True, any(r.startswith(f"Couldn't check {lab}") for r in rows))
                check(f'{key}: no "All clear" for it', False, any(f'{lab}: All clear' in r for r in rows))
                for k2, (_, lab2, _, n2) in ITEMS.items():
                    if k2 == key: continue
                    check(f'{key}: other item "{n2} {lab2}" unchanged', True, any(r.startswith(f'{n2} {lab2}') for r in rows))
                clear_route(pg, st, key)
                pg.locator(f'[data-action-failed="{key}"]').get_by_role('button', name='Retry').click()
                pg.get_by_text(f'{n} {lab}', exact=True).wait_for(timeout=10000)
                rows = admin_rows(pg)
                check(f'{key}: after Retry shows real "{n} {lab}"', True, any(r.startswith(f'{n} {lab}') for r in rows))
                check(f'{key}: after Retry no "Couldn\'t check"', False, any("Couldn't check" in r for r in rows))
                check(f'{key}: 0 page errors', [], st['errs'])
                check(f'{key}: 0 unexpected console errors', [], st['cons'])
                check(f'{key}: 0 unexpected API ≥ 400', [], st['bad'])

            # ── finance workbench: 200 + success:false (Q3) on manual flags, then retry ──
            print('\n— finance: manual flags → 200 {success:false} —')
            pg, st = session(b, 'finance', 'Finance@2025')
            fail_route(pg, st, 'manualFlags', mode='200'); open_dash(pg)
            cards = fin_cards(pg)
            check('finance: manual flags card shows "—"', '—', cards[1].split('\n')[0])
            check('finance: manual flags card says Couldn\'t check', True, "Couldn't check" in cards[1])
            check('finance: other cards real', ['2', '1', '4'], [cards[i].split('\n')[0] for i in (0, 2, 3)])
            check('finance: banner', "7 item(s) need your attention · 1 check(s) couldn't load — retry above", fin_banner(pg))
            url_before = pg.url
            clear_route(pg, st, 'manualFlags')
            pg.locator('[data-action-failed="manualFlags"]').get_by_role('button', name='Retry').click()
            pg.wait_for_function("() => !document.querySelector('[data-action-failed]')", timeout=10000)
            check('finance: Retry did not navigate', url_before, pg.url)
            check('finance: after Retry cards real', ['2', '3', '1', '4'], [c.split('\n')[0] for c in fin_cards(pg)])
            check('finance: after Retry banner', '10 item(s) need your attention', fin_banner(pg))
            check('finance: 0 page errors', [], st['errs'])
            check('finance: 0 unexpected console errors', [], st['cons'])

            # ── edge: all four fail, retry one while it still fails, then fix it ──
            print('\n— finance edge: all 4 fail; retry while still failing —')
            pg, st = session(b, 'finance', 'Finance@2025')
            for k in ITEMS: fail_route(pg, st, k)
            open_dash(pg)
            check('edge: 4 cards show "—"', ['—'] * 4, [c.split('\n')[0] for c in fin_cards(pg)])
            check('edge: banner never "All caught up"', "4 check(s) couldn't load — retry above", fin_banner(pg))
            pg.locator('[data-action-failed="lateDeductions"]').get_by_role('button', name='Retry').click(); time.sleep(1.5)
            check('edge: retry still failing → still "Couldn\'t check"', 1, pg.locator('[data-action-failed="lateDeductions"]').count())
            check('edge: Retry button re-enabled', True, pg.locator('[data-action-failed="lateDeductions"]').get_by_role('button', name='Retry').is_enabled())
            clear_route(pg, st, 'lateDeductions')
            pg.locator('[data-action-failed="lateDeductions"]').get_by_role('button', name='Retry').click()
            pg.wait_for_function("() => !document.querySelector('[data-action-failed=\"lateDeductions\"]')", timeout=10000)
            check('edge: late card real after fix', '1', fin_cards(pg)[2].split('\n')[0])
            check('edge: banner', "1 item(s) need your attention · 3 check(s) couldn't load — retry above", fin_banner(pg))
            check('edge: 0 page errors', [], st['errs'])

            # ── phone width ──
            print('\n— phone 390px (admin, miss punch fails) —')
            pg, st = session(b, 'admin', 'Admin@123', width=390)
            fail_route(pg, st, 'missPunchFinance'); open_dash(pg)
            rows = admin_rows(pg)
            check('phone: Couldn\'t check shown', True, any(r.startswith("Couldn't check Miss punches") for r in rows))
            btn = pg.locator('[data-action-failed="missPunchFinance"]').get_by_role('button', name='Retry').bounding_box()
            check('phone: Retry button on screen', True, btn is not None and btn['x'] + btn['width'] <= 390)
            check('phone: 0 page errors', [], st['errs'])
            b.close()
finally:
    srv.terminate(); shutil.rmtree(WORK, ignore_errors=True)

print(f'\n{PASS} passed, {FAIL} failed')
sys.exit(1 if FAIL else 0)
