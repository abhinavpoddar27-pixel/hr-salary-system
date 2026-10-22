#!/usr/bin/env python3
"""FRESH-3 — the last 18 bare-array invalidateQueries([...]) calls become prefix filters; the reads they refresh go no-cache.

Chromium against the BUILT dist, real admin / hr / finance logins, scratch DATA_DIR, fictional data only
(codes T95xx, names "TEST FRESH3 n"). Current month.

For each action the script records every GET in the 2.5 s after the click:
  - the read(s) the action really changes are re-read with Cache-Control: no-cache, and the screen shows the change
    even though the action happens < 5 s after the page loaded (inside the server's max-age=5 window)
  - NO other GET fires (a bare array refreshed every active query: permissions, companies, …)
Actions: Settings (admin) shift create, holiday add + remove, policy save, user create; Compliance (admin) generate;
Employees (hr) edit from the drill-down (drill-down + list + departments), bulk shift (drill-down re-read);
Import reconciliation (hr) add to master → Employee Master current at once; Workforce (hr) detect inactive
(org-overview, headcount, attrition re-read); Finance Verification (finance) bulk verify. 390 px pass, 0 page errors,
0 API ≥ 400. Static: 0 bare-array calls in frontend/src.
--base (origin/main tree): every action fires unrelated GETs and the re-reads carry no no-cache; 18 bare-array calls.

Usage:
  PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers PORT=3501 python3 backend/scripts/fresh3-check.py
  APP_ROOT=/tmp/wt-base PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers PORT=3501 python3 backend/scripts/fresh3-check.py --base
Needs `npm run build --prefix frontend` in APP_ROOT first.
"""
import datetime, os, re, sqlite3, subprocess, sys, tempfile, time, urllib.request
from playwright.sync_api import sync_playwright

HERE_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
ROOT = os.path.abspath(os.environ.get('APP_ROOT', HERE_ROOT))
BASE_MODE = '--base' in sys.argv
PORT = int(os.environ.get('PORT', '3501')); BASE = f'http://127.0.0.1:{PORT}'
WORK = tempfile.mkdtemp(prefix='fresh3-'); DB = os.path.join(WORK, 'hr_system.db')
C = 'Asian Lakto Ind Ltd'
TODAY = datetime.date.today(); M, Y = TODAY.month, TODAY.year
PASS = FAIL = 0
PW = {'hr': 'Indriyan@2025', 'finance': 'Finance@2025', 'admin': 'Admin@123'}
IGNORE = ('/session-analytics', '/auth/heartbeat')


def check(label, expected, actual):
    global PASS, FAIL
    if expected == actual: PASS += 1; print(f'  ✓ {label}')
    else: FAIL += 1; print(f'  ✗ {label} — expected {expected!r}, got {actual!r}')


def q(sql, *a):
    c = sqlite3.connect(DB); r = c.execute(sql, a).fetchall(); c.close(); return r


def ex(sql, *a):
    c = sqlite3.connect(DB); c.execute(sql, a); c.commit(); c.close()


def seed():
    for n in range(1, 4):
        ex("INSERT OR IGNORE INTO employees(code,name,department,designation,company,status,employment_type,gross_salary) "
           "VALUES(?,?,'TEST DEPT','Operator',?,'Active','Permanent',26000)", f'T950{n}', f'TEST FRESH3 {n}', C)
        ex("INSERT INTO salary_computations(employee_code,month,year,company,gross_salary,gross_earned,total_deductions,net_salary,payable_days) "
           "VALUES(?,?,?,?,26000,26000,0,26000,26)", f'T950{n}', M, Y, C)
    # Two codes punching in EESL but not in the master → reconciliation "new in EESL"
    for code in ('T9591', 'T9592'):
        for dd in (1, 2):
            ex("INSERT INTO attendance_processed(employee_code,date,status_original,status_final,month,year,company) "
               "VALUES(?,?,'P','P',?,?,?)", code, f'{Y}-{M:02d}-{dd:02d}', M, Y, C)
        ex("INSERT INTO attendance_raw(employee_code,employee_name,department,date,company) VALUES(?,?,'TEST RECON',?,?)",
           code, f'TEST FRESH3 R{code[-1]}', f'{Y}-{M:02d}-01', C)


def login(b, user):
    ctx = b.new_context(viewport={'width': 1440, 'height': 900})
    pg = ctx.new_page()
    st = {'errs': [], 'bad': [], 'reqs': []}
    pg.on('pageerror', lambda e: st['errs'].append(str(e)))
    pg.on('response', lambda r: st['bad'].append(f'{r.status} {r.url}') if '/api/' in r.url and r.status >= 400
          and 'session-analytics' not in r.url else None)

    def on_req(r):
        if '/api/' in r.url:
            path = r.url.split('/api', 1)[1].split('?')[0]
            st['reqs'].append((time.monotonic(), r.method, path, r.headers.get('cache-control') or ''))
    pg.on('request', on_req)
    pg.goto(BASE + '/login'); pg.get_by_placeholder('admin').fill(user); pg.get_by_placeholder('••••••••').fill(PW[user])
    pg.get_by_role('button', name='Sign in').click(); pg.wait_for_url(lambda u: '/login' not in u)
    pg.wait_for_load_state('networkidle')
    return pg, ctx, st


def go(pg, path):
    pg.goto(BASE + path); pg.wait_for_load_state('networkidle'); pg.wait_for_timeout(500)


def act(label, pg, st, fn, expect, window=2500):
    """Run fn, then report: re-reads of each `expect` path (all no-cache?) and every other GET (unrelated)."""
    t0 = time.monotonic()
    fn()
    pg.wait_for_timeout(window)
    gets = [r for r in st['reqs'] if r[1] == 'GET' and r[0] >= t0 and not any(i in r[2] for i in IGNORE)]
    hits = {e: [r for r in gets if e in r[2]] for e in expect}
    unrelated = sorted({r[2] for r in gets if not any(e in r[2] for e in expect)})
    if BASE_MODE:
        check(f'old {label}: unrelated GETs fire (bare array refreshes everything)', True, len(unrelated) >= 1)
    else:
        for e, rs in hits.items():
            check(f'{label}: {e} re-read with no-cache', (True, True), (len(rs) >= 1, all('no-cache' in r[3] for r in rs)))
        check(f'{label}: no unrelated GET', [], unrelated)
    return hits


def visible(pg, text, timeout=1500):
    try:
        pg.get_by_text(text).first.wait_for(timeout=timeout); return True
    except Exception: return False


env = dict(os.environ, DATA_DIR=WORK, JWT_SECRET='x', PORT=str(PORT), NODE_ENV='production',
           ADMIN_PASSWORD=PW['admin'], HR_PASSWORD=PW['hr'], FINANCE_PASSWORD=PW['finance'])
srv = subprocess.Popen(['node', f'{ROOT}/backend/server.js'], env=env, stdout=open(f'{WORK}/log', 'w'), stderr=subprocess.STDOUT)
try:
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    for _ in range(240):
        try:
            if opener.open(BASE + '/api/version', timeout=2).status == 200 and 'running on' in open(f'{WORK}/log').read(): break
        except Exception: pass
        time.sleep(.5)
    seed()
    bare = 0
    for dp, _, fs in os.walk(f'{ROOT}/frontend/src'):
        for f in fs:
            if f.endswith(('.js', '.jsx')):
                bare += len(re.findall(r'(invalidateQueries|refetchQueries|resetQueries|removeQueries)\(\s*\[', open(os.path.join(dp, f)).read()))
    print(f'App root: {ROOT}  mode: {"BASE (expect the old behaviour)" if BASE_MODE else "fix"}  month {M}/{Y}')
    check('static: bare-array invalidate/refetch calls in frontend/src', 18 if BASE_MODE else 0, bare)

    with sync_playwright() as p:
        b = p.chromium.launch()
        all_states = []

        # ───────────────────── admin: Settings + Compliance ─────────────────────
        print('\n— admin —')
        pg, ctx, st = login(b, 'admin'); all_states.append(st)
        go(pg, '/settings/shifts'); pg.get_by_role('button', name='+ Add Shift').wait_for(timeout=15000)

        def shift_create():
            pg.get_by_role('button', name='+ Add Shift').click()
            pg.get_by_placeholder('12-Hour Shift').fill('TEST FRESH3 SHIFT'); pg.get_by_placeholder('12HR').fill('TF3')
            pg.locator('input[type=time]').first.fill('09:00')
            pg.get_by_role('button', name='Create', exact=True).click()
        act('shift create', pg, st, shift_create, ['/settings/shifts'])
        if not BASE_MODE:
            check('shift create: TF3 row shown at once', True, pg.locator('tbody tr', has_text='TEST FRESH3 SHIFT').count() == 1)

        go(pg, '/settings/holidays'); pg.get_by_role('button', name='Add Holiday').wait_for(timeout=15000)

        def holiday_add():
            pg.locator('input[type=date]').first.fill(f'{Y}-12-30'); pg.get_by_placeholder('e.g. Diwali').fill('TEST FRESH3 HOLIDAY')
            # Festival, not National: the UI sends no reason and the route refuses a National removal without one (pre-existing)
            pg.locator('select').filter(has=pg.locator('option', has_text='Festival')).first.select_option('Festival')
            pg.get_by_role('button', name='Add Holiday').click()
        act('holiday add', pg, st, holiday_add, ['/settings/holidays'])
        shown = pg.locator('tbody tr', has_text='TEST FRESH3 HOLIDAY').count()
        if BASE_MODE:
            check('old holiday add: new row NOT shown (re-read served from the 5 s browser cache)', 0, shown)
            pg.wait_for_timeout(5600); go(pg, '/settings/holidays')  # past the 5 s browser cache
            pg.locator('tbody tr', has_text='TEST FRESH3 HOLIDAY').wait_for(timeout=15000)
        else:
            check('holiday add: row shown at once', 1, shown)

        def holiday_remove():
            pg.locator('tbody tr', has_text='TEST FRESH3 HOLIDAY').get_by_role('button', name='Remove').click()
            pg.wait_for_timeout(450); pg.get_by_role('dialog').last.get_by_role('button', name='Remove').click()
        act('holiday remove', pg, st, holiday_remove, ['/settings/holidays'])
        check('holiday remove: DB row soft-deleted', [(0,)], q("SELECT is_active FROM holidays WHERE name='TEST FRESH3 HOLIDAY'"))
        if not BASE_MODE:
            check('holiday remove: row gone at once', 0, pg.locator('tbody tr', has_text='TEST FRESH3 HOLIDAY').count())

        go(pg, '/settings/policy'); pg.get_by_role('button', name='Save All Policy Settings').wait_for(timeout=15000)
        act('policy save', pg, st, lambda: pg.get_by_role('button', name='Save All Policy Settings').click(), ['/settings/policy'])

        go(pg, '/settings/users'); pg.get_by_role('button', name='+ Add User').wait_for(timeout=15000)

        def user_create():
            pg.get_by_role('button', name='+ Add User').click()
            pg.get_by_placeholder('johndoe').fill('test_fresh3'); pg.get_by_placeholder('Min 6 characters').fill('Fresh3pass')
            pg.get_by_role('button', name='Create User').click()
        act('user create', pg, st, user_create, ['/auth/users'])
        check('user create: DB row', [('test_fresh3',)], q("SELECT username FROM users WHERE username='test_fresh3'"))
        if not BASE_MODE:
            check('user create: row shown at once', True, pg.locator('tbody tr', has_text='test_fresh3').count() >= 1)

        go(pg, '/compliance'); pg.get_by_role('button', name=re.compile('Generate Calendar')).wait_for(timeout=15000)
        act('compliance generate', pg, st, lambda: pg.get_by_role('button', name=re.compile('Generate Calendar')).click(),
            ['/settings/compliance'])
        n_items = q('SELECT COUNT(*) FROM compliance_items WHERE year=?', Y)[0][0]
        check('compliance generate: DB items created', True, n_items > 0)
        if not BASE_MODE:
            check('compliance generate: list filled at once', False, pg.get_by_text('No compliance items found').count() > 0)
        ctx.close()

        # ───────────────────── hr: Employees, Import, Workforce ─────────────────────
        print('\n— hr —')
        pg, ctx, st = login(b, 'hr'); all_states.append(st)
        go(pg, '/employees'); pg.locator('tbody tr', has_text='T9501').first.wait_for(timeout=15000)
        pg.locator('tbody tr', has_text='T9501').first.click()
        pg.get_by_role('button', name='Edit Details').wait_for(timeout=10000); pg.wait_for_timeout(400)

        def emp_edit():
            pg.get_by_role('button', name='Edit Details').click(); pg.wait_for_timeout(300)
            dlg = pg.locator('div.fixed').filter(has=pg.get_by_role('button', name='Save', exact=True)).last
            dlg.locator('label:has-text("Full Name") + input').fill('TEST FRESH3 1 EDITED')
            dlg.locator('label:has-text("Department") + input').fill('TEST FRESH3 NEWDEPT')
            dlg.get_by_role('button', name='Save', exact=True).click()
        act('employee edit', pg, st, emp_edit, ['/employees/T9501', '/employees/departments', '/employees'])
        check('employee edit: DB name + department', [('TEST FRESH3 1 EDITED', 'TEST FRESH3 NEWDEPT')],
              q("SELECT name, department FROM employees WHERE code='T9501'"))
        if not BASE_MODE:
            dd = pg.locator('tr', has_text='Quick Actions').first.inner_text() if pg.locator('tr', has_text='Quick Actions').count() else ''
            check('employee edit: open drill-down shows the new name + department',
                  (True, True), ('TEST FRESH3 1 EDITED' in dd, 'TEST FRESH3 NEWDEPT' in dd))
            check('employee edit: list row shows the new name', True,
                  pg.locator('tbody tr', has_text='T9501').first.inner_text().find('TEST FRESH3 1 EDITED') >= 0)

        def bulk_shift():
            pg.locator('tbody tr', has_text='T9501').first.locator('input[type=checkbox]').check()
            pg.get_by_role('button', name='Assign Shift').click(); pg.wait_for_timeout(300)
            sel = pg.locator('div.fixed select').last
            opt = sel.locator('option', has_text='9HR').first.get_attribute('value')
            sel.select_option(opt); pg.get_by_role('button', name=re.compile(r'^Assign 9HR')).click()
        act('bulk shift', pg, st, bulk_shift, ['/employees/T9501', '/employees'])
        check('bulk shift: DB shift_code 9HR', [('9HR',)], q("SELECT shift_code FROM employees WHERE code='T9501'"))

        # Import reconciliation → add to master; Employee Master must be current at once on return (staleTime 30 s)
        go(pg, '/pipeline/import')
        pg.get_by_role('button', name='Show Import Reconciliation').click()
        pg.get_by_role('button', name=re.compile(r'Add All 2 to Master')).wait_for(timeout=15000)
        act('recon add to master', pg, st, lambda: pg.get_by_role('button', name=re.compile(r'Add All 2 to Master')).click(),
            ['/import/reconciliation'])
        check('recon: DB master has the 2 new codes', 2, q("SELECT COUNT(*) FROM employees WHERE code IN ('T9591','T9592')")[0][0])
        if not BASE_MODE:
            check('recon: "Add All" offer gone at once', 0, pg.get_by_role('button', name=re.compile('Add All')).count())
        pg.get_by_role('link', name=re.compile('Employee Master')).first.click() if pg.get_by_role('link', name=re.compile('Employee Master')).count() else go(pg, '/employees')
        pg.wait_for_timeout(1500)
        if not BASE_MODE:
            check('recon: Employee Master shows T9591 without a reload', True, pg.locator('tbody tr', has_text='T9591').count() >= 1)

        # Headcount tab first, so org-overview + headcount-trend are cached (staleTime 30 s) when detect runs on Attrition
        go(pg, '/workforce/headcount'); pg.wait_for_timeout(800)
        pg.get_by_role('link', name='Hiring & Attrition').first.click()
        pg.get_by_role('button', name='Detect Inactive').wait_for(timeout=15000)
        act('detect inactive', pg, st, lambda: pg.get_by_role('button', name='Detect Inactive').click(),
            ['/analytics/attrition', '/analytics/inactive-employees'])
        t0 = time.monotonic()
        pg.get_by_role('link', name='Headcount & Composition').first.click(); pg.wait_for_timeout(2000)
        back = [r for r in st['reqs'] if r[1] == 'GET' and r[0] >= t0 and ('/analytics/overview' in r[2] or '/analytics/headcount-trend' in r[2])]
        if not BASE_MODE:
            check('detect inactive: Headcount tab re-reads overview + headcount (no-cache) though inside the 30 s staleTime',
                  (True, True, True), (any('/overview' in r[2] for r in back), any('headcount-trend' in r[2] for r in back),
                                       all('no-cache' in r[3] for r in back)))

        pg.set_viewport_size({'width': 390, 'height': 844}); go(pg, '/employees')
        check('390 px: Employee Master renders', True, pg.locator('tbody tr', has_text='T9502').count() >= 1)
        ctx.close()

        # ───────────────────── finance: Finance Verification bulk verify ─────────────────────
        print('\n— finance —')
        pg, ctx, st = login(b, 'finance'); all_states.append(st)
        go(pg, '/finance-verification')
        btn = pg.get_by_role('button', name='Bulk Verify Clean Employees'); btn.wait_for(timeout=15000)
        act('bulk verify', pg, st, lambda: btn.click(), ['/finance-verify/dashboard', '/finance-verify/employees'])
        check('bulk verify: DB rows verified', True, q("SELECT COUNT(*) FROM finance_audit_status WHERE status='verified'")[0][0] >= 1)
        ctx.close()

        errs = [e for s in all_states for e in s['errs']]
        bad = [x for s in all_states for x in s['bad']]
        print()
        check('0 page errors', [], errs)
        check('0 API ≥ 400', [], bad)
        b.close()
finally:
    srv.terminate()
print(f'\n{PASS} passed, {FAIL} failed')
sys.exit(1 if FAIL else 0)
