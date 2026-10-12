#!/usr/bin/env python3
"""P2-10 (X-2, X-8): menu, routes and Header "Settings" follow the permission matrix — browser check.

Chromium against the BUILT dist, scratch DATA_DIR, fictional users only (the repo is public). Real UI logins for
admin, hr, finance (seeded by the server) and a fictional viewer + supervisor (created through the admin API with a
JWT signed by the scratch server's own secret — the login limiter allows only 5 logins per 15 min).

Checks (fix mode):
  A. per role: sidebar labels (every parent expanded) = the expected list below (= the matrix in
     backend/src/config/permissions.js mapped through frontend/src/utils/permissions.js); 0 page errors.
  B. per role: every forbidden URL shows "You don't have access to this page", the page itself never mounts
     (0 API >= 400 while it is open), sidebar still there.
  C. per role: every allowed URL in the sample opens (no no-access view, 0 page errors).
  D. Header user menu: "Settings" only for admin.
  E. permissions still loading (request held 2 s): no menu item and no page content yet, no Settings flash; then
     everything appears.
  F. permissions request failing: a plain error + "Try again" — retry loads the page.
  G. in-place role change through an intercepted /auth/me (+ /auth/permissions answering the new role):
     no crash, no React hook error, menu = the new role's menu, a URL the new role may not open shows no-access.
  H. 390 px phone (viewer): drawer labels = viewer labels; no-access view fits (no sideways scroll).
  I. the server really refuses the data behind the hidden pages (API probes with each role's token).
Base mode (`--base`, APP_ROOT = an origin/main tree with its built dist): a viewer opens a forbidden URL (the
page mounts and its API calls fail with 403) and sees "Settings" in the Header menu.

Usage:
  python3 backend/scripts/permissions-nav-check.py
  APP_ROOT=/path/to/origin-main-tree python3 backend/scripts/permissions-nav-check.py --base
Needs `npm run build --prefix frontend` in APP_ROOT first. PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers.
"""
import json, os, re, subprocess, sys, tempfile, time, urllib.request, urllib.error
from playwright.sync_api import sync_playwright

HERE_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
ROOT = os.path.abspath(os.environ.get('APP_ROOT', HERE_ROOT))
BASE_MODE = '--base' in sys.argv
PORT = int(os.environ.get('PORT', '3210')); BASE = f'http://127.0.0.1:{PORT}'
WORK = tempfile.mkdtemp(prefix='perm-nav-')
PASS = FAIL = 0
CREDS = {'admin': ('admin', 'Admin@123'), 'hr': ('hr', 'Indriyan@2025'), 'finance': ('finance', 'Finance@2025'),
         'viewer': ('test_viewer', 'Viewer@2025'), 'supervisor': ('test_super', 'Super@2025')}
HOOK_ERR = re.compile(r'hooks|Minified React error #(300|310)|Rendered (fewer|more) hooks', re.I)
NO_ACCESS = "You don't have access to this page"
# Pre-existing on origin/main, not part of P2-10: the unload beacon of session analytics goes out without a token
# (401), and a few pages a role may open make one side call the server refuses for that role (same before and after).
KNOWN = ('/api/session-analytics/events', '/leaves/on-leave-today', '/features/salary-stale',
         '/finance-audit/leave-requests', '/comp-off/pending', '/late-coming/finance-pending',
         '/early-exit-deductions/finance/pending')

COMMON = ['Dashboard', 'Daily MIS', 'Payroll', '1. Import', '2. Miss Punches', '3. Shift Check', '4. Night Shift',
          '5. Corrections', '6. Day Calc', '7. Salary', 'Held Salaries Register', 'Salary Advance', 'Payable OT',
          'Salary Input']
WORKFORCE = ['Workforce', 'Headcount & Composition', 'Hiring & Attrition', 'Contractor Management']
ANALYTICS = ['Attendance Analytics', 'Overview', 'Absenteeism', 'Punctuality', 'Overtime', 'Working Hours']
COMPLIANCE = ['Compliance', 'PF Compliance', 'ESI Compliance', 'Labour Law', 'Compliance Calendar']
MID = ['Reports', 'Finance Audit', 'Finance Verify', 'Extra Duty', 'Alerts', 'Employees']
DW = ['Daily Wage', 'Records', 'New Entry', 'Batch Import', 'Contractors', 'Reports']
DW_FIN = ['Finance Review', 'Payments', 'Dashboard', 'Audit Log']
SALES_HR = ['Sales', 'Sales Employees', 'Sales Holidays', 'Upload Sheet', 'Compute Salaries', 'TA/DA Register', 'TA/DA Upload']
TAIL = ['Employee Profile', 'Dept Analytics']
ADMIN_TAIL = ['Session Analytics', 'Query Tool', 'SQL Console', 'Bug Reports', 'Record History', 'Statutory Flags',
              'Settings', 'Shift Master', 'Holiday Master', 'Policy Config', 'Audit Trail', 'Usage Logs', 'User Management']

EXPECTED = {
    'admin': COMMON + ['Loans', 'Leave Management'] + WORKFORCE + ['Contractor Report'] + ANALYTICS
             + ['Early Exit', 'Attendance Review', 'Late Coming'] + COMPLIANCE + MID + DW + DW_FIN + SALES_HR
             + ['TA/DA Approvals'] + TAIL + ['Salary Explainer'] + ADMIN_TAIL,
    'hr': COMMON + ['Loans', 'Leave Management'] + WORKFORCE + ['Contractor Report'] + ANALYTICS
          + ['Early Exit', 'Late Coming'] + COMPLIANCE + MID + DW + SALES_HR + TAIL + ['Salary Explainer'],
    'finance': COMMON + ['Loans', 'Leave Management'] + WORKFORCE + ['Contractor Report'] + ANALYTICS
               + ['Early Exit', 'Late Coming'] + COMPLIANCE + MID + DW + DW_FIN + ['Sales', 'TA/DA Approvals'] + TAIL
               + ['Salary Explainer'],
    'viewer': COMMON + ['Loans', 'Leave Management'] + WORKFORCE + ANALYTICS + ['Late Coming'] + COMPLIANCE + MID
              + DW + TAIL,
    'supervisor': COMMON + WORKFORCE + ANALYTICS + ['Late Coming'] + COMPLIANCE + MID + DW + TAIL,
}
ADMIN_URLS = ['/session-analytics', '/admin/query-tool', '/admin/sql-console', '/admin/bug-reports',
              '/admin/record-history', '/admin/statutory-flags', '/settings/policy', '/settings/users',
              '/analytics/attendance-review']
SALES_HR_URLS = ['/sales/employees', '/sales/holidays', '/sales/upload', '/sales/compute', '/sales/ta-da-register',
                 '/sales/ta-da-upload', '/sales/payslip/S901']
DW_FIN_URLS = ['/daily-wage/finance/review', '/daily-wage/finance/payments', '/daily-wage/finance/dashboard', '/daily-wage/audit']
FORBIDDEN = {
    'hr': ADMIN_URLS + DW_FIN_URLS,
    'finance': ADMIN_URLS + SALES_HR_URLS,
    'viewer': ADMIN_URLS + SALES_HR_URLS + DW_FIN_URLS + ['/sales/ta-da-approvals', '/analytics/early-exit', '/workforce/contractor-report'],
    'supervisor': ADMIN_URLS + SALES_HR_URLS + DW_FIN_URLS + ['/sales/ta-da-approvals', '/analytics/early-exit',
                                                              '/workforce/contractor-report', '/loans', '/leave-management'],
}
ALLOWED = {
    'admin': ['/', '/settings/policy', '/admin/sql-console', '/analytics/attendance-review', '/sales/compute', '/daily-wage/audit'],
    'hr': ['/', '/pipeline/import', '/pipeline/salary', '/extra-duty-grants', '/payable-ot', '/finance-verification',
           '/workforce/contractor-report', '/sales/compute', '/sales/ta-da-approvals', '/leave-management', '/employees', '/alerts'],
    'finance': ['/', '/daily-mis', '/pipeline/day-calc', '/finance-audit', '/leave-management', '/analytics/overview',
                '/analytics/early-exit', '/workforce/contractor-report', '/daily-wage/finance/review', '/sales/ta-da-approvals', '/loans'],
    'viewer': ['/', '/daily-mis', '/pipeline/miss-punch', '/held-salaries', '/loans', '/leave-management', '/analytics/punctuality',
               '/reports', '/employees', '/daily-wage', '/employee-profile', '/dept-analytics'],
    'supervisor': ['/', '/daily-mis', '/pipeline/import', '/salary-input', '/analytics/overview', '/compliance/pf',
                   '/reports', '/employees', '/daily-wage/reports'],
}
# Data the hidden pages need — the server must refuse it (I).
PROBES = {
    'viewer': ['/api/sales/salary-register?month=9&year=2026&company=X', '/api/sales/holidays?company=X',
               '/api/sales/ta-da-requests', '/api/early-exits/mtd-summary?month=9&year=2026',
               '/api/analytics/attendance-review/config', '/api/query-tool/saved'],
    'supervisor': ['/api/loans', '/api/leaves', '/api/sales/employees'],
    'finance': ['/api/sales/salary-register?month=9&year=2026&company=X', '/api/sales/ta-da/register?month=9&year=2026&company=X',
                '/api/analytics/attendance-review/config'],
    'hr': ['/api/analytics/attendance-review/config', '/api/query-tool/saved'],
}


def check(label, expected, actual):
    global PASS, FAIL
    if expected == actual: PASS += 1; print(f'  ✓ {label}')
    else: FAIL += 1; print(f'  ✗ {label} — expected {expected!r}, got {actual!r}')


def api(path, body=None, token=None):
    req = urllib.request.Request(BASE + path, data=json.dumps(body).encode() if body is not None else None,
                                 headers={'Content-Type': 'application/json', **({'Authorization': f'Bearer {token}'} if token else {})})
    return json.loads(urllib.request.urlopen(req, timeout=10).read())


def status(path, token):
    try:
        urllib.request.urlopen(urllib.request.Request(BASE + path, headers={'Authorization': f'Bearer {token}'}), timeout=10)
        return 200
    except urllib.error.HTTPError as e:
        return e.code


def mint(uid, username, role):
    js = f"console.log(require('jsonwebtoken').sign({{id:{uid},username:'{username}',role:'{role}'}},'x',{{expiresIn:'2h'}}))"
    return subprocess.check_output(['node', '-e', js], cwd=f'{ROOT}/backend').decode().strip()


def new_page(b, width=1440):
    ctx = b.new_context(viewport={'width': width, 'height': 900})
    pg = ctx.new_page()
    log = {'errs': [], 'cons': [], 'bad': []}
    pg.on('pageerror', lambda e: log['errs'].append(str(e)))
    pg.on('console', lambda m: log['cons'].append(m.text) if m.type == 'error' and 'vite.svg' not in m.text
          and 'status of 40' not in m.text and not any(k in m.text for k in KNOWN) else None)
    pg.on('response', lambda r: log['bad'].append(f'{r.status} {r.url.split(BASE)[-1]}')
          if '/api/' in r.url and r.status >= 400 and not any(k in r.url for k in KNOWN) else None)
    return pg, log


SESSIONS = {}


def login(pg, role, land='/', wait=True):
    if role in SESSIONS:
        tok, user = SESSIONS[role]
        pg.goto(BASE + '/login')
        pg.evaluate('([t, u]) => { localStorage.setItem("hr_token", t); localStorage.setItem("hr_user", u) }', [tok, user])
        pg.goto(BASE + land)
        if wait: pg.wait_for_load_state('networkidle')
        return
    user, pw = CREDS[role]
    pg.goto(BASE + '/login'); pg.get_by_placeholder('admin').fill(user); pg.get_by_placeholder('••••••••').fill(pw)
    pg.get_by_role('button', name='Sign in').click(); pg.wait_for_url(lambda u: '/login' not in u)
    pg.wait_for_load_state('networkidle')
    SESSIONS[role] = tuple(pg.evaluate('() => [localStorage.getItem("hr_token"), localStorage.getItem("hr_user")]'))


def expand_all(pg):
    for _ in range(60):
        btn = pg.locator('aside nav li > button', has_text='▼').first
        if btn.count() == 0: return
        btn.click(); time.sleep(.05)


def labels(pg):
    expand_all(pg)
    return pg.evaluate("""() => Array.from(document.querySelectorAll('aside nav li > a, aside nav li > button'))
        .map(e => e.innerText.replace(/[▲▼]/g, '').trim().split('\\n').pop().replace(/\\s+\\d+$/, '').trim()).filter(Boolean)""")


def goto(pg, path):
    pg.goto(BASE + path)
    try: pg.wait_for_load_state('networkidle', timeout=10000)
    except Exception: pass
    time.sleep(.3)


def no_access_shown(pg):
    return pg.get_by_text(NO_ACCESS).count() > 0


def settings_in_menu(pg):
    pg.locator('header button', has=pg.locator('svg path[fill-rule="evenodd"]')).last.click(); time.sleep(.2)
    shown = pg.locator('header').get_by_role('button', name='Settings', exact=True).count() > 0
    pg.keyboard.press('Escape'); pg.mouse.click(5, 880); time.sleep(.1)
    return shown


env = dict(os.environ, DATA_DIR=WORK, JWT_SECRET='x', PORT=str(PORT), NODE_ENV='production',
           ADMIN_PASSWORD='Admin@123', HR_PASSWORD='Indriyan@2025', FINANCE_PASSWORD='Finance@2025')
srv = subprocess.Popen(['node', f'{ROOT}/backend/server.js'], env=env, stdout=open(f'{WORK}/log', 'w'), stderr=subprocess.STDOUT)
try:
    for _ in range(80):
        try: urllib.request.urlopen(BASE + '/api/version', timeout=2); break
        except Exception: time.sleep(.5)
    admin_tok = mint(1, 'admin', 'admin')
    for role in ('viewer', 'supervisor'):
        u, pw = CREDS[role]
        api('/api/auth/users', {'username': u, 'password': pw, 'role': role, 'allowedCompanies': ['*']}, admin_tok)
    print(f'App root: {ROOT}  mode: {"BASE (origin/main behaviour)" if BASE_MODE else "fix"}')

    with sync_playwright() as p:
        b = p.chromium.launch()

        if BASE_MODE:
            pg, log = new_page(b); login(pg, 'viewer')
            goto(pg, '/analytics/early-exit')
            early_403 = [x for x in log['bad'] if x.startswith('403') and 'early-exit' in x]
            check('old code: viewer opens /analytics/early-exit — page mounts, no no-access view', False, no_access_shown(pg))
            check('old code: …and its data calls fail with 403', True, len(early_403) > 0)
            log['bad'].clear(); goto(pg, '/sales/employees')
            check('old code: viewer opens /sales/employees — page mounts, API 403s', (False, True),
                  (no_access_shown(pg), any(x.startswith('403') and '/api/sales/' in x for x in log['bad'])))
            check('old code: viewer sees "Settings" in the Header menu', True, settings_in_menu(pg))
            check('old code: viewer menu shows "Early Exit"', True, 'Early Exit' in labels(pg))
            pg.context.close(); b.close()
            print(f'\n{PASS} passed, {FAIL} failed')
            raise SystemExit(1 if FAIL else 0)

        tokens = {}
        print('\n— A/C/D. per role: menu, allowed URLs, Header Settings —')
        for role in ('admin', 'hr', 'finance', 'viewer', 'supervisor'):
            pg, log = new_page(b); login(pg, role); tokens[role] = SESSIONS[role][0]
            got = labels(pg)
            check(f'{role}: menu = expected ({len(EXPECTED[role])} items)', EXPECTED[role], got)
            check(f'{role}: Header "Settings" shown = {role == "admin"}', role == 'admin', settings_in_menu(pg))
            for url in ALLOWED[role]:
                goto(pg, url)
                check(f'{role}: {url} opens', (False, []), (no_access_shown(pg), log['errs']))
            check(f'{role}: 0 page errors, 0 console errors', ([], []), (log['errs'], log['cons']))
            pg.context.close()

        print('\n— B. forbidden URLs show the no-access view and the page never mounts —')
        for role, urls in FORBIDDEN.items():
            pg, log = new_page(b); login(pg, role)
            for url in urls:
                log['bad'].clear()
                goto(pg, url)
                check(f'{role}: {url} → no-access view, menu still there, 0 API >= 400',
                      (True, True, []), (no_access_shown(pg), pg.locator('aside nav li').count() > 0, list(log['bad'])))
            # the "Go to Dashboard" link works
            pg.get_by_role('link', name='Go to Dashboard').click(); pg.wait_for_load_state('networkidle')
            check(f'{role}: "Go to Dashboard" opens the dashboard', ('/', False), (pg.evaluate('location.pathname'), no_access_shown(pg)))
            check(f'{role}: 0 page errors', [], log['errs'])
            pg.context.close()

        print('\n— E. while permissions load nothing shows —')
        pg, log = new_page(b)
        held = []
        # hold the request (sync Playwright: never sleep inside a handler — it would block the event loop)
        pg.route('**/api/auth/permissions', lambda route, _req: held.append(route))
        login(pg, 'viewer', '/sales/compute', wait=False); pg.wait_for_timeout(1500)
        early = (pg.locator('aside nav li').count(), pg.locator('main').get_by_text('Sales Salary Register').count(),
                 no_access_shown(pg), pg.get_by_text('Loading...').count() > 0)
        pg.wait_for_timeout(300)
        no_settings = settings_in_menu(pg)
        check('loading: Header "Settings" not shown', False, no_settings)
        for r in held: r.continue_()
        check('loading: 0 menu items, page not mounted, no no-access yet, loader shown', (0, 0, False, True), early)
        pg.wait_for_load_state('networkidle'); time.sleep(.5)
        check('loaded: no-access view + full viewer menu', (True, EXPECTED['viewer']), (no_access_shown(pg), labels(pg)))
        pg.unroute('**/api/auth/permissions'); pg.context.close()

        print('\n— F. permissions request failing —')
        pg, log = new_page(b)
        state = {'fail': True}

        def flaky(route, _req):
            if state['fail']: route.fulfill(status=500, content_type='application/json', body='{"success":false}')
            else: route.continue_()
        pg.route('**/api/auth/permissions', flaky)
        login(pg, 'hr', '/employees', wait=False); pg.wait_for_timeout(9000)
        check('fail: plain error + Try again (page) + Retry (menu), page not mounted',
              (True, True, 0), (pg.get_by_text("Couldn't load what your role can open").count() > 0,
                                pg.get_by_test_id('nav-perm-error').count() > 0, pg.locator('main').get_by_text('Employee Master').count()))
        state['fail'] = False
        pg.get_by_role('button', name='Try again').click(); pg.wait_for_load_state('networkidle'); time.sleep(.5)
        check('fail → retry: page opens, hr menu back', (True, EXPECTED['hr']),
              (pg.locator('main').get_by_text('Employee Master').count() > 0, labels(pg)))
        check('fail: 0 page errors', [], log['errs'])
        pg.unroute('**/api/auth/permissions'); pg.context.close()

        print('\n— G. role changed in place (intercepted /auth/me + /auth/permissions) —')
        perms_of = {r: api('/api/auth/permissions', token=tokens[r]) for r in tokens}
        for a, bb, route_ in [('hr', 'viewer', '/sales/compute'), ('admin', 'supervisor', '/settings/policy'),
                              ('viewer', 'finance', '/'), ('finance', 'hr', '/daily-wage/finance/review')]:
            pg, log = new_page(b); login(pg, a); goto(pg, route_)
            before_ok = not no_access_shown(pg)
            me = json.dumps({'success': True, 'user': {'id': 999, 'username': CREDS[a][0], 'role': bb, 'allowedCompanies': ['*'], 'onboarding_completed': 1}})
            pr = json.dumps(perms_of[bb])

            def h_me(route, _req, body=me):
                time.sleep(.8); route.fulfill(status=200, content_type='application/json', body=body)

            calls = {'n': 0}

            def h_perm(route, _req, body=pr, calls=calls):
                # first request = the token's own role (before the /auth/me swap); later ones answer the new role
                calls['n'] += 1
                route.continue_() if calls['n'] == 1 else route.fulfill(status=200, content_type='application/json', body=body)
            pg.route('**/api/auth/me', h_me)
            pg.route('**/api/auth/permissions', h_perm)
            pg.reload(); pg.wait_for_load_state('networkidle'); time.sleep(2)
            hook = [e for e in log['errs'] + log['cons'] if HOOK_ERR.search(e)]
            stored = pg.evaluate("() => JSON.parse(localStorage.getItem('hr_user')||'{}').role")
            check(f'{a}→{bb} on {route_}: stored role swapped, no hook error, no page error', (bb, [], []), (stored, hook, log['errs']))
            check(f'{a}→{bb}: menu = {bb} menu', EXPECTED[bb], labels(pg))
            expect_block = route_ in FORBIDDEN.get(bb, [])
            check(f'{a}→{bb}: {route_} opened for {a} = True, no-access for {bb} = {expect_block}',
                  (True, expect_block), (before_ok, no_access_shown(pg)))
            pg.context.close()

        print('\n— H. 390 px phone (viewer) —')
        pg, log = new_page(b, 390); login(pg, 'viewer')
        if not pg.locator('aside nav li').first.is_visible():
            pg.get_by_label('Open menu').click(); time.sleep(.4)
        check('390: drawer = viewer menu', EXPECTED['viewer'], labels(pg))
        goto(pg, '/settings/users')
        sideways = pg.evaluate('() => document.documentElement.scrollWidth > window.innerWidth + 1')
        check('390: no-access view shown, no sideways scroll, 0 page errors', (True, False, []), (no_access_shown(pg), sideways, log['errs']))
        pg.context.close()

        print('\n— I. the server refuses the data behind hidden pages —')
        for role, paths in PROBES.items():
            for pth in paths:
                check(f'{role}: GET {pth.split("?")[0]} → 403', 403, status(pth, tokens[role]))
        b.close()
finally:
    srv.terminate()
print(f'\n{PASS} passed, {FAIL} failed')
sys.exit(1 if FAIL else 0)
