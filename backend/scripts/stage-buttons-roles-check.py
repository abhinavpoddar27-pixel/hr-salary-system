#!/usr/bin/env python3
"""STAGE-BTN — buttons the server refuses are not shown to that role — browser check.

Chromium against the BUILT dist, scratch DATA_DIR, real logins (viewer created through the admin API, hr, finance),
fictional data only (codes T9581–T9584, "TEST BTN EMP n"). Server restarted between roles (login limiter).

  viewer (permissions request forced to fail → the app fails open and mounts Stage 6/7, the only way such a role can
          see them): Stage 6 no Run / no Recalculate, plain line "Only HR, finance or admin…"; Stage 7 no Compute /
          no Finalise, plain line; 0 POSTs.
  hr: Stage 6 Run shown + no refused line; Stage 7 Compute + Finalise shown. Finance Audit: Manual Interventions row
      Approve/Reject 0, tick boxes 0, "Awaiting finance" shown; Late Coming Approve/Reject 0 + no tick boxes +
      "Awaiting finance"; Early Exit Approve/Reject 0 + plain line; Leave Requests Approve/Reject 0 + "Awaiting finance";
      no GET /comp-off/pending; 0 API ≥ 400; 0 page/console errors; 390 px.
  finance: every one of those buttons still shown; Stage 6 Run + Stage 7 Compute shown.

Usage:
  PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers PORT=3505 python3 backend/scripts/stage-buttons-roles-check.py
  APP_ROOT=/tmp/wt-base python3 backend/scripts/stage-buttons-roles-check.py --base   # old: hr sees them all
Needs `npm run build --prefix frontend` in APP_ROOT first.
"""
import datetime, json, os, re, sqlite3, subprocess, sys, tempfile, time, urllib.request
from playwright.sync_api import sync_playwright

HERE_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
ROOT = os.path.abspath(os.environ.get('APP_ROOT', HERE_ROOT))
BASE_MODE = '--base' in sys.argv
PORT = int(os.environ.get('PORT', '3505')); BASE = f'http://127.0.0.1:{PORT}'
WORK = tempfile.mkdtemp(prefix='stagebtn-'); DB = os.path.join(WORK, 'hr_system.db')
PW = {'hr': 'Indriyan@2025', 'finance': 'Finance@2025', 'admin': 'Admin@123', 'test_viewer': 'Viewer@2025'}
C = 'Asian Lakto Ind Ltd'
IST = datetime.datetime.utcnow() + datetime.timedelta(hours=5, minutes=30)
M, Y = IST.month, IST.year
d = lambda day: f'{Y}-{M:02d}-{day:02d}'
PASS = FAIL = 0


def check(label, expected, actual):
    global PASS, FAIL
    if expected == actual: PASS += 1; print(f'  ✓ {label}')
    else: FAIL += 1; print(f'  ✗ {label} — expected {expected!r}, got {actual!r}')


def ex(sql, *a):
    c = sqlite3.connect(DB); cur = c.execute(sql, a); c.commit(); rid = cur.lastrowid; c.close(); return rid


def q(sql, *a):
    c = sqlite3.connect(DB); r = c.execute(sql, a).fetchall(); c.close(); return r


env = dict(os.environ, DATA_DIR=WORK, JWT_SECRET='x', PORT=str(PORT), NODE_ENV='production',
           ADMIN_PASSWORD=PW['admin'], HR_PASSWORD=PW['hr'], FINANCE_PASSWORD=PW['finance'])
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
srv = None; RUNS = [0]


def start():
    global srv
    RUNS[0] += 1
    srv = subprocess.Popen(['node', f'{ROOT}/backend/server.js'], env=env, stdout=open(f'{WORK}/log', 'a'), stderr=subprocess.STDOUT)
    for _ in range(240):
        try:
            if opener.open(BASE + '/api/version', timeout=2).status == 200 and open(f'{WORK}/log').read().count('running on') >= RUNS[0]: return
        except Exception: pass
        time.sleep(.5)


def stop():
    srv.terminate(); srv.wait(10)


def api(path, body, tok=None):
    req = urllib.request.Request(BASE + path, data=json.dumps(body).encode(), method='POST',
                                 headers={'Content-Type': 'application/json', **({'Authorization': f'Bearer {tok}'} if tok else {})})
    return json.loads(opener.open(req, timeout=10).read())


def seed():
    for i in range(1, 5):
        ex("INSERT OR IGNORE INTO employees(code,name,department,company,status,employment_type,gross_salary) "
           "VALUES(?,?,'TEST DEPT',?,'Active','Permanent',20000)", f'T958{i}', f'TEST BTN EMP {i}', C)
    ex("INSERT INTO salary_manual_flags(employee_code,month,year,flag_type,finance_approved,system_value,manual_value,delta,notes) "
       "VALUES('T9581',?,?,'TDS_MANUAL',0,0,500,500,'test flag')", M, Y)
    ex("INSERT INTO late_coming_deductions(employee_code,month,year,company,late_count,deduction_days,remark,applied_by,finance_status) "
       "VALUES('T9582',?,?,?,6,1,'test late','hr','pending')", M, Y, C)
    det = ex("INSERT INTO early_exit_detections(employee_code,date,company) VALUES('T9583',?,?)", d(3), C)
    ex("INSERT INTO early_exit_deductions(early_exit_detection_id,employee_code,employee_name,company,date,deduction_type,"
       "deduction_amount,payroll_month,payroll_year,hr_remark,submitted_by_name) "
       "VALUES(?,'T9583','TEST BTN EMP 3',?,?,'half_day',500,?,?,'test early exit','hr')", det, C, d(3), M, Y)
    emp4 = q("SELECT id FROM employees WHERE code='T9584'")[0][0]
    la = ex("INSERT INTO leave_applications(employee_id,employee_code,leave_type,start_date,end_date,days,reason,status) "
            "VALUES(?,'T9584','EL',?,?,1,'test leave request','Pending Finance')", emp4, d(4), d(4))
    ex("INSERT INTO audit_log(table_name,record_id,field_name,old_value,new_value,changed_by,stage,remark,employee_code,action_type) "
       "VALUES('leave_applications',?,'status',NULL,'Pending Finance','hr_other','leave_request','test','T9584','leave_request_raised')", la)
    ex("INSERT INTO salary_computations(employee_code,month,year,company,gross_salary,gross_earned,net_salary,total_deductions) "
       "VALUES('T9581',?,?,?,20000,20000,20000,0)", M, Y, C)


def login(b, user, width=1440, fail_permissions=False):
    ctx = b.new_context(viewport={'width': width, 'height': 900})
    pg = ctx.new_page()
    st = {'errs': [], 'cons': [], 'bad': [], 'posts': [], 'gets': []}
    pg.on('pageerror', lambda e: st['errs'].append(str(e)))
    pg.on('console', lambda m: st['cons'].append(m.text) if m.type == 'error' else None)
    pg.on('request', lambda r: (st['posts'] if r.method != 'GET' else st['gets']).append(f'{r.method} {r.url}') if '/api/' in r.url else None)
    pg.on('response', lambda r: st['bad'].append(f'{r.status} {r.url}') if '/api/' in r.url and r.status >= 400
          and 'session-analytics' not in r.url and not (fail_permissions and '/auth/permissions' in r.url) else None)
    if fail_permissions:
        pg.route('**/api/auth/permissions', lambda route: route.fulfill(status=500, content_type='application/json', body='{"success":false}'))
    pg.goto(BASE + '/login'); pg.get_by_placeholder('admin').fill(user); pg.get_by_placeholder('••••••••').fill(PW[user])
    pg.get_by_role('button', name='Sign in').click(); pg.wait_for_url(lambda u: '/login' not in u)
    return pg, ctx, st


def go(pg, path):
    pg.goto(BASE + path); pg.wait_for_load_state('networkidle'); time.sleep(1)


def tab(pg, label):
    pg.get_by_role('button', name=re.compile('^' + re.escape(label))).first.click(); pg.wait_for_load_state('networkidle'); time.sleep(1)


def btn(pg, name):
    return pg.get_by_role('button', name=name, exact=True).count()


def stage_pages(pg, st, label, expect_buttons):
    go(pg, '/pipeline/day-calc')
    pg.locator('[data-testid="stage6-run-refused"], button:has-text("Run Day Calculation")').first.wait_for(timeout=15000)
    run = pg.get_by_role('button', name=re.compile('Run Day Calculation')).count()
    refused6 = pg.get_by_test_id('stage6-run-refused').count()
    go(pg, '/pipeline/salary')
    pg.get_by_test_id('stage7-actions').wait_for(timeout=15000); time.sleep(.5)
    comp = pg.get_by_test_id('stage7-actions').get_by_role('button', name='Compute Salary', exact=True).count()
    fin = pg.get_by_test_id('stage7-actions').get_by_role('button', name=re.compile('^Finalise')).count()
    refused7 = pg.get_by_test_id('stage7-run-refused').count()
    if expect_buttons:
        check(f'{label}: Stage 6 Run shown, no refused line', (1, 0), (run, refused6))
        check(f'{label}: Stage 7 Compute + Finalise shown, no refused line', (1, 1, 0), (comp, fin, refused7))
    elif BASE_MODE:
        check(f'old {label}: Stage 6 Run + Stage 7 Compute/Finalise shown to a refused role', (1, 1, 1), (run, comp, fin))
    else:
        check(f'{label}: Stage 6 Run hidden + plain line', (0, 1), (run, refused6))
        check(f'{label}: Stage 7 Compute + Finalise hidden + plain line', (0, 0, 1), (comp, fin, refused7))
        check(f'{label}: Stage 7 line says who can', True, 'Only HR, finance or admin' in pg.get_by_test_id('stage7-run-refused').inner_text())
        check(f'{label}: 0 POSTs', [], [x for x in st['posts'] if '/auth/login' not in x and 'session-analytics' not in x])


def finance_audit(pg, st, label, decider):
    go(pg, '/finance-audit')
    tab(pg, 'Manual Interventions')
    row = pg.get_by_role('row', name=re.compile('T9581'))
    f1 = (row.get_by_role('button', name='Approve', exact=True).count(), row.get_by_role('button', name='Reject', exact=True).count(),
          row.locator('input[type="checkbox"]').count())
    tab(pg, 'Late Coming')
    row = pg.get_by_role('row', name=re.compile('T9582'))
    f3 = (row.get_by_role('button', name='Approve', exact=True).count(), row.get_by_role('button', name='Reject', exact=True).count(),
          row.locator('input[type="checkbox"]').count())
    tab(pg, 'Early Exit')
    row = pg.get_by_role('row', name=re.compile('T9583'))
    f5 = (row.get_by_role('button', name='Approve', exact=True).count(), row.get_by_role('button', name='Reject', exact=True).count())
    f5_line = pg.get_by_test_id('early-exit-awaiting-finance').count()
    tab(pg, 'Leave Requests')
    row = pg.get_by_role('row', name=re.compile('T9584'))
    f6 = (row.get_by_role('button', name='Approve', exact=True).count(), row.get_by_role('button', name='Reject', exact=True).count())
    f6_line = row.get_by_test_id('leave-awaiting-finance').count()
    if decider:
        check(f'{label}: Manual Interventions Approve/Reject + tick box shown', (1, 1, 1), f1)
        check(f'{label}: Late Coming Approve/Reject + tick box shown', (1, 1, 1), f3)
        check(f'{label}: Early Exit Approve/Reject shown, no line', ((1, 1), 0), (f5, f5_line))
        check(f'{label}: Leave Requests Approve/Reject shown', ((1, 1), 0), (f6, f6_line))
    elif BASE_MODE:
        check(f'old {label}: every finance-only button shown to hr', True,
              f1[:2] == (1, 1) and f3[:2] == (1, 1) and f5 == (1, 1) and f6 == (1, 1))
        check(f'old {label}: Finance Audit reads /comp-off/pending (403)', True, any('/comp-off/pending' in g for g in st['gets']))
    else:
        check(f'{label}: Manual Interventions no Approve/Reject, no tick box', (0, 0, 0), f1)
        check(f'{label}: Manual Interventions says "Awaiting finance"', 1,
              pg.locator('body').count() and (go(pg, '/finance-audit') or tab(pg, 'Manual Interventions') or
                                              pg.get_by_role('row', name=re.compile('T9581')).get_by_test_id('flag-awaiting-finance').count()))
        check(f'{label}: Late Coming no Approve/Reject, no tick box', (0, 0, 0), f3)
        check(f'{label}: Early Exit no Approve/Reject + plain line', ((0, 0), 1), (f5, f5_line))
        check(f'{label}: Leave Requests no Approve/Reject + "Awaiting finance"', ((0, 0), 1), (f6, f6_line))
        check(f'{label}: no GET /comp-off/pending', [], [g for g in st['gets'] if '/comp-off/pending' in g])
        check(f'{label}: 0 POSTs/PUTs', [], [p for p in st['posts'] if 'session-analytics' not in p and '/auth/' not in p])
    return f1, f3, f5, f6


start(); seed()
print(f'App root: {ROOT}  mode: {"BASE (expect buttons for refused roles)" if BASE_MODE else "fix"}  month {M}/{Y}')
try:
    tok = api('/api/auth/login', {'username': 'admin', 'password': PW['admin']})['token']
    api('/api/auth/users', {'username': 'test_viewer', 'password': PW['test_viewer'], 'role': 'viewer', 'allowedCompanies': ['*']}, tok)
    with sync_playwright() as p:
        b = p.chromium.launch()
        print('\n— viewer (permissions read fails → fail open) —')
        pg, ctx, st = login(b, 'test_viewer', fail_permissions=True)
        stage_pages(pg, st, 'viewer', expect_buttons=False)
        if not BASE_MODE:
            # Stage 6/7 page READS (salary-stale, leave-requests) are refused for a viewer — pre-existing, recorded as a finding.
            # This PR is about buttons: the viewer must send no write and see no write button.
            check('viewer: 0 page errors', [], st['errs'])
            print('    (note) refused reads seen for viewer:', sorted({x.split('?')[0] for x in st['bad']}))
        ctx.close()
        if not BASE_MODE:
            pg, ctx, st = login(b, 'test_viewer', width=390, fail_permissions=True)
            go(pg, '/pipeline/salary'); pg.get_by_test_id('stage7-run-refused').wait_for(timeout=15000)
            bx = pg.get_by_test_id('stage7-run-refused').bounding_box()
            check('viewer 390px: Stage 7 refused line fits the width', True, bx is not None and bx['x'] >= 0 and bx['x'] + bx['width'] <= 390)
            check('viewer 390px: 0 page errors', [], st['errs'])
            ctx.close()
        stop(); start()

        print('\n— hr —')
        pg, ctx, st = login(b, 'hr')
        stage_pages(pg, st, 'hr', expect_buttons=True)
        if not BASE_MODE:
            go(pg, '/pipeline/day-calc'); st['posts'].clear()
            with pg.expect_response(lambda r: '/payroll/calculate-days' in r.url and r.request.method == 'POST', timeout=60000) as rr:
                pg.get_by_role('button', name=re.compile('Run Day Calculation')).first.click()
            check('hr: Stage 6 Run still sends one POST and gets 200', (1, 200),
                  (len([x for x in st['posts'] if '/payroll/calculate-days' in x]), rr.value.status))
            pg.wait_for_load_state('networkidle'); time.sleep(1)
        st['gets'].clear(); st['posts'].clear(); st['cons'].clear(); st['bad'].clear()
        finance_audit(pg, st, 'hr', decider=False)
        if not BASE_MODE:
            check('hr: 0 page errors', [], st['errs']); check('hr: 0 API ≥ 400', [], st['bad'])
            check('hr: 0 console errors', [], st['cons'])
        ctx.close()
        if not BASE_MODE:
            pg, ctx, st = login(b, 'hr', width=390)
            go(pg, '/finance-audit'); tab(pg, 'Late Coming')
            check('hr 390px: "Awaiting finance" on the late-coming row', 1,
                  pg.get_by_role('row', name=re.compile('T9582')).get_by_test_id('late-awaiting-finance').count())
            check('hr 390px: 0 page errors', [], st['errs'])
            ctx.close()
        stop(); start()

        print('\n— finance —')
        pg, ctx, st = login(b, 'finance')
        stage_pages(pg, st, 'finance', expect_buttons=True)
        finance_audit(pg, st, 'finance', decider=True)
        if not BASE_MODE:
            go(pg, '/finance-audit'); tab(pg, 'Late Coming')
            pg.get_by_role('row', name=re.compile('T9582')).get_by_role('button', name='Approve', exact=True).click()
            dlg = pg.get_by_role('dialog'); dlg.wait_for(timeout=5000); time.sleep(.4)
            with pg.expect_response(lambda r: '/late-coming/finance-review/' in r.url, timeout=30000) as rr:
                dlg.get_by_role('button', name='Submit', exact=True).click()
            check('finance: one late-coming Approve works (200, DB approved)', (200, [('approved',)]),
                  (rr.value.status, q("SELECT finance_status FROM late_coming_deductions WHERE employee_code='T9582'")))
            check('finance: reads /comp-off/pending (badge kept)', True, any('/comp-off/pending' in g for g in st['gets']))
            check('finance: 0 page errors', [], st['errs']); check('finance: 0 API ≥ 400', [], st['bad'])
        ctx.close()
        b.close()
finally:
    stop()
print(f'\n{PASS} passed, {FAIL} failed')
sys.exit(1 if FAIL else 0)
