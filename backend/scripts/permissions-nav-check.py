#!/usr/bin/env python3
"""P2-10 + P8-06 — one permissions source for nav / routes / Header; 404 page; product name + build version.

Chromium against the BUILT dist, scratch DATA_DIR (no data — nothing about people), real logins for
admin / hr / finance / viewer / supervisor (viewer + supervisor are fictional users created by admin).
The server's login limiter allows 5 logins per 15 min per IP, so the server is restarted per role
(same scratch DB).

Usage:
  python3 backend/scripts/permissions-nav-check.py                    # this tree
  APP_ROOT=/tmp/base python3 .../permissions-nav-check.py --base      # an 8abee969 build: records the old
                                                                       # behaviour (viewer 47 items, Settings for hr,
                                                                       # unknown URL → "/")
Needs `npm run build --prefix frontend` in APP_ROOT first. PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers. Port 3403.
"""
import atexit, json, os, re, subprocess, sys, tempfile, time, urllib.request
from playwright.sync_api import sync_playwright

HERE_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
ROOT = os.path.abspath(os.environ.get('APP_ROOT', HERE_ROOT))
BASE_MODE = '--base' in sys.argv
PORT = int(os.environ.get('PORT', '3403')); BASE = f'http://127.0.0.1:{PORT}'
WORK = tempfile.mkdtemp(prefix='perm-nav-')
PASS = FAIL = 0
USERS = {'admin': ('admin', 'Admin@123'), 'hr': ('hr', 'Indriyan@2025'), 'finance': ('finance', 'Finance@2025'),
         'viewer': ('test_viewer', 'Viewer@2025'), 'supervisor': ('test_super', 'Super@2025')}

# Sidebar entries (href, or '#Label' for parents/actions) — admin sees all of them (measured on 8abee969).
ALL = ["/", "/daily-mis", "#Payroll", "/pipeline/import", "/pipeline/miss-punch", "/pipeline/shift-check",
       "/pipeline/night-shift", "/pipeline/corrections", "/pipeline/day-calc", "/pipeline/salary", "/held-salaries",
       "/salary-advance", "/payable-ot", "/salary-input", "/loans", "/leave-management", "#Workforce",
       "/workforce/headcount", "/workforce/attrition", "/workforce/contractors", "/workforce/contractor-report",
       "#Attendance Analytics", "/analytics/overview", "/analytics/absenteeism", "/analytics/punctuality",
       "/analytics/overtime", "/analytics/hours", "/analytics/early-exit", "/analytics/attendance-review",
       "/analytics/punctuality", "#Compliance", "/compliance/pf", "/compliance/esi", "/compliance/labour-law",
       "/compliance/calendar", "/reports", "/finance-audit", "/finance-verification", "/extra-duty-grants", "/alerts",
       "/employees", "#Daily Wage", "/daily-wage", "/daily-wage/new", "/daily-wage/import", "/daily-wage/contractors",
       "/daily-wage/reports", "/daily-wage/finance/review", "/daily-wage/finance/payments",
       "/daily-wage/finance/dashboard", "/daily-wage/audit", "#Sales", "/sales/employees", "/sales/holidays",
       "/sales/upload", "/sales/compute", "/sales/ta-da-register", "/sales/ta-da-upload", "/sales/ta-da-approvals",
       "/employee-profile", "/dept-analytics", "#Salary Explainer", "/session-analytics", "/admin/query-tool",
       "/admin/sql-console", "/admin/bug-reports", "/admin/record-history", "/admin/statutory-flags", "#Settings",
       "/settings/shifts", "/settings/holidays", "/settings/policy", "/settings/audit", "/settings/usage-logs",
       "/settings/users"]
ADMIN_ONLY = ["/analytics/attendance-review", "/session-analytics", "/admin/query-tool", "/admin/sql-console",
              "/admin/bug-reports", "/admin/record-history", "/admin/statutory-flags", "#Settings", "/settings/shifts",
              "/settings/holidays", "/settings/policy", "/settings/audit", "/settings/usage-logs", "/settings/users"]
DW_FIN = ["/daily-wage/finance/review", "/daily-wage/finance/payments", "/daily-wage/finance/dashboard", "/daily-wage/audit"]
SALES_HR = ["/sales/employees", "/sales/holidays", "/sales/upload", "/sales/compute", "/sales/ta-da-register", "/sales/ta-da-upload"]
EXPECT = {
    'admin': ALL,
    'hr': [x for x in ALL if x not in ADMIN_ONLY + DW_FIN + ["/sales/ta-da-approvals"]],      # = today (8abee969)
    'finance': [x for x in ALL if x not in ADMIN_ONLY + SALES_HR],                             # = today (8abee969)
    'viewer': ["/", "/daily-mis", "#Payroll", "/loans", "/reports"],                           # ruling Q5 A
    'supervisor': ["/", "/daily-mis"],
}
# Page → allowed roles (what App.jsx routes must open; everything else = "You don't have access").
def allowed_routes(role):
    s = set(x for x in EXPECT[role] if x.startswith('/'))
    if role == 'admin': s |= {'/loans/1', '/sales/payslip/X1', '/admin/bug-reports/1'}
    if role in ('hr', 'finance', 'viewer'): s.add('/loans/1')
    if role == 'hr': s.add('/sales/payslip/X1')
    return s
ROUTES = list(dict.fromkeys([x for x in ALL if x.startswith('/')] + ['/loans/1', '/sales/payslip/X1', '/admin/bug-reports/1']))
BACKGROUND = ('/api/auth/', '/api/notifications', '/api/session-analytics', '/api/loans/stats', '/api/features/leave-change-flags',
              '/api/sales/ta-da-requests/pending-count', '/api/version')


def check(label, expected, actual):
    global PASS, FAIL
    if expected == actual: PASS += 1; print(f'  ✓ {label}')
    else: FAIL += 1; print(f'  ✗ {label} — expected {expected!r}, got {actual!r}')


def api(path, body=None, tok=None):
    req = urllib.request.Request(BASE + path, data=json.dumps(body).encode() if body is not None else None,
                                 headers={'Content-Type': 'application/json', **({'Authorization': 'Bearer ' + tok} if tok else {})})
    return json.loads(urllib.request.urlopen(req).read())


SERVERS = []
atexit.register(lambda: [x.kill() for x in SERVERS if x.poll() is None])


def start_server():
    try:
        urllib.request.urlopen(BASE + '/api/version', timeout=2)
        raise SystemExit(f'port {PORT} is already in use — stop that server first')
    except SystemExit: raise
    except Exception: pass
    env = dict(os.environ, DATA_DIR=WORK, JWT_SECRET='x', PORT=str(PORT), NODE_ENV='production',
               ADMIN_PASSWORD='Admin@123', HR_PASSWORD='Indriyan@2025', FINANCE_PASSWORD='Finance@2025')
    srv = subprocess.Popen(['node', f'{ROOT}/backend/server.js'], env=env, stdout=open(f'{WORK}/log', 'a'), stderr=subprocess.STDOUT)
    SERVERS.append(srv)
    for _ in range(80):
        try: urllib.request.urlopen(BASE + '/api/version', timeout=2); return srv
        except Exception: time.sleep(.5)
    raise SystemExit('server did not start')


def stop_server(srv):
    srv.terminate()
    try: srv.wait(10)
    except Exception: srv.kill()


class Watch:
    def __init__(self, pg):
        self.errs, self.cons, self.bad, self.reqs = [], [], [], []
        pg.on('pageerror', lambda e: self.errs.append(str(e)[:160]))
        pg.on('console', lambda m: self.cons.append(m.text[:160]) if m.type == 'error' else None)
        pg.on('response', lambda r: self.bad.append(f'{r.status} {r.request.method} {re.sub(r"[?].*", "", r.url.replace(BASE, ""))}')
              if '/api/' in r.url and r.status >= 400 else None)
        pg.on('request', lambda r: self.reqs.append(re.sub(r'[?].*', '', r.url.replace(BASE, ''))) if '/api/' in r.url else None)

    def clear(self):
        self.errs.clear(); self.cons.clear(); self.bad.clear(); self.reqs.clear()


def login_ui(pg, user, pw):
    pg.goto(BASE + '/login'); pg.get_by_placeholder('admin').fill(user); pg.get_by_placeholder('••••••••').fill(pw)
    pg.get_by_role('button', name='Sign in').click(); pg.wait_for_url(lambda u: '/login' not in u)
    pg.wait_for_load_state('networkidle'); time.sleep(1)


def sidebar_entries(pg):
    for _ in range(3):
        for btn in pg.locator('aside nav > ul > li > button').all():
            if '▼' in (btn.inner_text() or ''): btn.click(); time.sleep(.05)
    out = []
    for el in pg.locator('aside nav a, aside nav button').all():
        href = el.get_attribute('href')
        out.append(href if href else '#' + re.sub(r'\s+', ' ', el.inner_text()).replace('▲', '').replace('▼', '').strip().split(' ', 1)[-1])
    return out


def header_settings(pg):
    pg.locator('header button').last.click(); time.sleep(.2)
    n = pg.locator('header').get_by_role('button', name='Settings', exact=True).count()
    pg.mouse.click(5, 400); time.sleep(.1)
    return n > 0


def unexpected(bad):
    return [b for b in bad if '/api/session-analytics/events' not in b]


def run_role(b, role, admin_setup=False):
    u, pw = USERS[role]
    srv = start_server()
    try:
        if admin_setup:
            tok = api('/api/auth/login', {'username': 'admin', 'password': 'Admin@123'})['token']
            api('/api/auth/users', {'username': 'test_viewer', 'password': 'Viewer@2025', 'role': 'viewer', 'allowedCompanies': ['*']}, tok)
            api('/api/auth/users', {'username': 'test_super', 'password': 'Super@2025', 'role': 'supervisor', 'allowedCompanies': ['*']}, tok)
        ctx = b.new_context(viewport={'width': 1440, 'height': 900}); pg = ctx.new_page(); w = Watch(pg)
        print(f'\n— {role} —')
        login_ui(pg, u, pw)
        got = sidebar_entries(pg)
        if BASE_MODE:
            return {'role': role, 'entries': got, 'settings': header_settings(pg), 'pg': pg, 'ctx': ctx, 'w': w, 'srv': srv}
        check(f'{role}: sidebar entries = expected ({len(EXPECT[role])})', EXPECT[role], got)
        check(f'{role}: Header "Settings" only for admin', role == 'admin', header_settings(pg))
        check(f'{role}: product name in sidebar', 'HR & Salary System', pg.get_by_test_id('product-name').inner_text())
        ver = pg.get_by_test_id('app-version').inner_text()
        check(f'{role}: build version text "v1.0.0 · <sha>"', True, bool(re.fullmatch(r'v1\.0\.0 · ([0-9a-f]{7}|dev)', ver)))
        check(f'{role}: no amber access line', 0, pg.get_by_test_id('perms-failed').count())
        allowed = allowed_routes(role)
        wrong_open, wrong_block, leaks = [], [], []
        for r in ROUTES:
            w.clear()
            pg.goto(BASE + r); pg.wait_for_load_state('networkidle'); time.sleep(.4)
            blocked = pg.get_by_test_id('no-access').count() > 0
            if r in allowed and blocked: wrong_block.append(r)
            if r not in allowed:
                if not blocked: wrong_open.append(r)
                page_calls = [x for x in w.reqs if not x.startswith(BACKGROUND)]
                if page_calls or unexpected(w.bad): leaks.append((r, page_calls[:3], unexpected(w.bad)[:3]))
        check(f'{role}: every allowed page opens (no "You don\'t have access")', [], wrong_block)
        check(f'{role}: every other page shows "You don\'t have access"', [], wrong_open)
        check(f'{role}: refused pages send no page request and get no 4xx', [], leaks)
        refused = [r for r in ROUTES if r not in allowed]
        if refused:
            pg.goto(BASE + refused[0]); pg.wait_for_load_state('networkidle'); time.sleep(.3)
            check(f'{role}: refused page keeps its URL (no redirect), no toast', (refused[0], 0),
                  (pg.url.replace(BASE, ''), pg.locator('[role="status"]').count()))
        # 404
        w.clear(); pg.goto(BASE + '/no-such-page'); pg.wait_for_load_state('networkidle')
        check(f'{role}: unknown URL → 404 page, URL kept', (1, '/no-such-page'),
              (pg.get_by_test_id('not-found').count(), pg.url.replace(BASE, '')))
        check(f'{role}: 404 header title', 'Page not found', pg.locator('header h1').inner_text())
        pg.get_by_test_id('not-found').get_by_role('link', name='Go to Dashboard').click(); pg.wait_for_load_state('networkidle')
        check(f'{role}: 404 "Go to Dashboard" → /', '/', pg.url.replace(BASE, ''))
        check(f'{role}: 0 page errors', [], w.errs)
        return {'role': role, 'pg': pg, 'ctx': ctx, 'w': w, 'srv': srv}
    except Exception:
        stop_server(srv); raise


def done(st):
    st['ctx'].close(); stop_server(st['srv'])


with sync_playwright() as p:
    b = p.chromium.launch()
    print(f'App root: {ROOT}  mode: {"BASE" if BASE_MODE else "fix"}')
    if BASE_MODE:
        res = {}
        for role in USERS:
            st = run_role(b, role, admin_setup=(role == 'admin'))
            res[role] = st
            if role == 'hr':
                st['pg'].goto(BASE + '/no-such-page'); st['pg'].wait_for_load_state('networkidle')
                res['hr_404_url'] = st['pg'].url.replace(BASE, '')
            done(st)
        check('old code: viewer sees 47 sidebar entries', 47, len(res['viewer']['entries']))
        check('old code: supervisor sees 46 sidebar entries', 46, len(res['supervisor']['entries']))
        check('old code: hr has Header "Settings"', True, res['hr']['settings'])
        check('old code: unknown URL silently lands on "/"', '/', res['hr_404_url'])
        check('old code: hr sidebar = today (what the fix must keep)', EXPECT['hr'], res['hr']['entries'])
        check('old code: finance sidebar = today (what the fix must keep)', EXPECT['finance'], res['finance']['entries'])
        check('old code: admin sidebar = today', EXPECT['admin'], res['admin']['entries'])
    else:
        # admin + in-place role switch (P1-12 case) + fail-open
        st = run_role(b, 'admin', admin_setup=True); pg, w = st['pg'], st['w']
        print('\n— admin: role changes in place (stale stored role healed by /auth/me) —')
        me = pg.evaluate("() => JSON.parse(localStorage.getItem('hr_user'))")
        fake_me = dict(me, role='viewer')
        perms_viewer = {'success': True, 'role': 'viewer', 'permissions': ['dashboard', 'reports', 'notifications', 'daily-mis', 'loans']}
        pg.route('**/api/auth/me', lambda r: r.fulfill(status=200, content_type='application/json', body=json.dumps({'success': True, 'user': fake_me})))
        pg.route('**/api/auth/permissions', lambda r: r.fulfill(status=200, content_type='application/json', body=json.dumps(perms_viewer)))
        # a new token string makes RequireAuth refresh /auth/me once (module cache is per token)
        pg.evaluate("() => localStorage.setItem('hr_token', localStorage.getItem('hr_token') + '')")
        w.clear(); pg.goto(BASE + '/reports'); pg.wait_for_load_state('networkidle'); time.sleep(1.5)
        check('switch: nav follows the new role (viewer set)', EXPECT['viewer'], sidebar_entries(pg))
        check('switch: no React hook error', [], [e for e in w.errs + w.cons if 'Minified React error' in e or 'hook' in e.lower()])
        pg.goto(BASE + '/admin/sql-console'); pg.wait_for_load_state('networkidle')
        check('switch: admin page now refused', 1, pg.get_by_test_id('no-access').count())
        pg.unroute('**/api/auth/me'); pg.unroute('**/api/auth/permissions')
        done(st)

        st = run_role(b, 'hr'); pg, w = st['pg'], st['w']
        print('\n— hr: permissions request fails → fail open (ruling Q2) —')
        pg.route('**/api/auth/permissions', lambda r: r.fulfill(status=500, content_type='application/json', body='{"success":false,"error":"test failure"}'))
        pg.evaluate("() => { localStorage.setItem('hr_token', localStorage.getItem('hr_token')) }")
        w.clear(); pg.reload(); pg.wait_for_load_state('networkidle'); time.sleep(3)
        check('fail: amber "Couldn\'t load your access" line', 1, pg.get_by_test_id('perms-failed').count())
        got = sidebar_entries(pg)
        check('fail: every non-admin entry shown, admin-only entries hidden', [x for x in ALL if x not in ADMIN_ONLY], got)
        pg.goto(BASE + '/pipeline/day-calc'); pg.wait_for_load_state('networkidle')
        pg.get_by_test_id('perms-failed').wait_for(timeout=15000)
        check('fail: a page opens (no "You don\'t have access")', (0, True),
              (pg.get_by_test_id('no-access').count(), 'Stage 6' in pg.locator('header h1').inner_text()))
        pg.goto(BASE + '/admin/sql-console'); pg.wait_for_load_state('networkidle')
        pg.get_by_test_id('perms-failed').wait_for(timeout=15000)
        check('fail: admin page still refused', 1, pg.get_by_test_id('no-access').count())
        check('fail: 0 page errors', [], w.errs)
        pg.unroute('**/api/auth/permissions')
        print('\n— hr: signed out, unknown URL → login → back to the same URL → 404 —')
        pg.evaluate("() => { localStorage.removeItem('hr_token'); localStorage.removeItem('hr_user') }")
        pg.goto(BASE + '/no-such-page'); pg.wait_for_url(lambda u: '/login' in u)
        check('signed out: unknown URL asks to sign in', True, '/login' in pg.url)
        check('login page: product name', 'HR & Salary System', pg.get_by_test_id('product-name').inner_text())
        check('login page: version line', True, bool(re.fullmatch(r'HR & Salary System v1\.0\.0 · ([0-9a-f]{7}|dev)',
                                                              pg.get_by_test_id('app-version').inner_text())))
        check('browser tab title', 'HR & Salary System', pg.title())
        pg.get_by_placeholder('admin').fill('hr'); pg.get_by_placeholder('••••••••').fill('Indriyan@2025')
        pg.get_by_role('button', name='Sign in').click(); pg.wait_for_url(lambda u: '/login' not in u); pg.wait_for_load_state('networkidle')
        check('after login: back on /no-such-page with the 404 page', ('/no-such-page', 1),
              (pg.url.replace(BASE, ''), pg.get_by_test_id('not-found').count()))
        done(st)

        st = run_role(b, 'finance'); done(st)
        st = run_role(b, 'viewer'); pg, w = st['pg'], st['w']
        print('\n— viewer: phone width 390 px —')
        pg.set_viewport_size({'width': 390, 'height': 844}); pg.goto(BASE + '/'); pg.wait_for_load_state('networkidle')
        if '-translate-x-full' in (pg.locator('aside').get_attribute('class') or ''):   # drawer closed → open it
            pg.get_by_role('button', name='Open menu').click(); time.sleep(.4)
        vis = [e for e in sidebar_entries(pg)]
        check('390 px: drawer shows the viewer set', EXPECT['viewer'], vis)
        check('390 px: no sideways scroll', True, pg.evaluate('document.documentElement.scrollWidth <= window.innerWidth'))
        pg.goto(BASE + '/finance-audit'); pg.wait_for_load_state('networkidle')
        check('390 px: refused page fits the screen', True, pg.evaluate('document.documentElement.scrollWidth <= window.innerWidth'))
        done(st)
        st = run_role(b, 'supervisor'); done(st)
    b.close()

print(f'\n{PASS} passed, {FAIL} failed')
sys.exit(1 if FAIL else 0)
