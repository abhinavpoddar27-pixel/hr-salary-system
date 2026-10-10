#!/usr/bin/env python3
"""Sidebar / Header survive an in-place role or company-access change (P1-12, finding X-1) — browser check.

Chromium against the BUILT dist, real logins (one UI login per role; later pages reuse that session's token) (admin / hr / finance seeded by the server, plus a fictional
viewer `test_viewer` created through the admin API), scratch DATA_DIR — no real data (the repo is public).

How the in-place switch is driven: RequireAuth refreshes the stored user from GET /api/auth/me once per
token per page load and swaps it into the store WITHOUT remounting the layout. The check logs in for real as
role A, then reloads the page with /api/auth/me intercepted to answer role B (delayed so the shell first paints
as A). That is exactly the path that crashes when a hook sits after a conditional return.

Checks:
  A. per role (real login, no switch): the visible sidebar labels (every parent expanded) + company selector.
  B. in-place switch A→B: no page error, no React hook error, shell still rendered, labels = the A-check labels
     of role B, company selector = expected for B.
  C. 390px phone, hr: drawer opens, labels = hr labels, 0 errors.
  Overall: 0 page errors, 0 console errors (besides the known vite.svg 404), 0 API >= 400 in A + C (in B the
  token is still role A while the UI shows role B, so role-B reads may 403 — printed, not asserted).

Usage:
  python3 backend/scripts/layout-hook-order-check.py              # this tree's server + dist
  APP_ROOT=/tmp/wt python3 .../layout-hook-order-check.py --base  # another tree (e.g. origin/main): records
                                                                  # whether the switch crashes the old layout
  python3 .../layout-hook-order-check.py --dump-labels FILE       # also write the per-role labels as JSON
Needs `npm run build --prefix frontend` in APP_ROOT first. PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers.
"""
import json, os, re, subprocess, sys, tempfile, time, urllib.request
from playwright.sync_api import sync_playwright

HERE_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
ROOT = os.path.abspath(os.environ.get('APP_ROOT', HERE_ROOT))
BASE_MODE = '--base' in sys.argv
DUMP = sys.argv[sys.argv.index('--dump-labels') + 1] if '--dump-labels' in sys.argv else None
PORT = int(os.environ.get('PORT', '3112')); BASE = f'http://127.0.0.1:{PORT}'
WORK = tempfile.mkdtemp(prefix='hook-order-')
ONE_CO = 'Asian Lakto Ind Ltd'
PASS = FAIL = 0
CREDS = {'admin': ('admin', 'Admin@123'), 'hr': ('hr', 'Indriyan@2025'), 'finance': ('finance', 'Finance@2025'),
         'viewer': ('test_viewer', 'Viewer@2025')}
HOOK_ERR = re.compile(r'hooks|Minified React error #(300|310)|Rendered (fewer|more) hooks', re.I)

# (A role, B role, B allowedCompanies, start route)
SWITCHES = [
    ('admin', 'viewer', ['*'], '/loans'),
    ('admin', 'hr', ['*'], '/'),
    ('hr', 'admin', ['*'], '/'),
    ('viewer', 'finance', ['*'], '/'),
    ('admin', 'admin', [ONE_CO], '/'),   # Header: company selector disappears in place
    ('hr', 'hr', [ONE_CO], '/'),
]


def check(label, expected, actual):
    global PASS, FAIL
    if expected == actual: PASS += 1; print(f'  ✓ {label}')
    else: FAIL += 1; print(f'  ✗ {label} — expected {expected!r}, got {actual!r}')


def api(path, body=None, token=None):
    req = urllib.request.Request(BASE + path, data=json.dumps(body).encode() if body is not None else None,
                                 headers={'Content-Type': 'application/json', **({'Authorization': f'Bearer {token}'} if token else {})})
    return json.loads(urllib.request.urlopen(req, timeout=10).read())


def new_page(b, width=1440):
    ctx = b.new_context(viewport={'width': width, 'height': 900})
    pg = ctx.new_page()
    log = {'errs': [], 'cons': [], 'bad': []}
    pg.on('pageerror', lambda e: log['errs'].append(str(e)))
    pg.on('console', lambda m: log['cons'].append(m.text) if m.type == 'error' and 'vite.svg' not in m.text and '404' not in m.text else None)
    pg.on('response', lambda r: log['bad'].append(f'{r.status} {r.url}') if '/api/' in r.url and r.status >= 400 else None)
    return pg, log


SESSIONS = {}  # role -> (token, stored user) from its one real UI login (login is rate-limited: 5 / window)


def login(pg, role):
    if role in SESSIONS:  # reuse the real session of this role
        tok, user = SESSIONS[role]
        pg.goto(BASE + '/login')
        pg.evaluate('([t, u]) => { localStorage.setItem("hr_token", t); localStorage.setItem("hr_user", u) }', [tok, user])
        pg.goto(BASE + '/'); pg.wait_for_load_state('networkidle')
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
        .map(e => e.innerText.replace(/[▲▼]/g, '').replace(/\\s+\\d+$/, '').trim()).filter(Boolean)""")


def selector_shown(pg):
    return pg.locator('header select', has=pg.locator('option', has_text='All Companies')).count() > 0


def crashed(pg):
    return pg.get_by_text('Something went wrong').count() > 0 or pg.locator('aside nav').count() == 0


env = dict(os.environ, DATA_DIR=WORK, JWT_SECRET='x', PORT=str(PORT), NODE_ENV='production',
           ADMIN_PASSWORD='Admin@123', HR_PASSWORD='Indriyan@2025', FINANCE_PASSWORD='Finance@2025')
srv = subprocess.Popen(['node', f'{ROOT}/backend/server.js'], env=env, stdout=open(f'{WORK}/log', 'w'), stderr=subprocess.STDOUT)
try:
    for _ in range(80):
        try: urllib.request.urlopen(BASE + '/api/version', timeout=2); break
        except Exception: time.sleep(.5)
    tok = api('/api/auth/login', {'username': 'admin', 'password': 'Admin@123'})['token']
    api('/api/auth/users', {'username': 'test_viewer', 'password': 'Viewer@2025', 'role': 'viewer', 'allowedCompanies': ['*']}, tok)
    print(f'App root: {ROOT}  mode: {"BASE (records whether the old layout crashes)" if BASE_MODE else "fix"}')

    with sync_playwright() as p:
        b = p.chromium.launch()
        base_labels, base_sel, all_bad = {}, {}, []

        print('\n— A. per role, real login, no switch —')
        for role in ('admin', 'hr', 'finance', 'viewer'):
            pg, log = new_page(b)
            login(pg, role)
            base_labels[role] = labels(pg); base_sel[role] = selector_shown(pg)
            print(f'  {role}: {len(base_labels[role])} labels, company selector {base_sel[role]}')
            check(f'{role}: shell rendered, 0 page errors', (False, []), (crashed(pg), log['errs']))
            check(f'{role}: 0 console errors', [], log['cons'])
            all_bad += log['bad']; pg.context.close()
        check('viewer sees fewer items than admin', True, len(base_labels['viewer']) < len(base_labels['admin']))
        if DUMP: json.dump({'labels': base_labels, 'selector': base_sel}, open(DUMP, 'w'), indent=1)

        print('\n— B. in-place switch via the /auth/me refresh —')
        for a, bb, comps, route in SWITCHES:
            name = f'{a}→{bb}' + (f' companies→{comps}' if comps != ['*'] else '') + f' on {route}'
            pg, log = new_page(b)
            login(pg, a)
            if route != '/': pg.goto(BASE + route); pg.wait_for_load_state('networkidle')
            before = labels(pg)
            me = {'id': 999, 'username': CREDS[a][0], 'role': bb, 'allowedCompanies': comps, 'onboarding_completed': 1}

            body = json.dumps({'success': True, 'user': me})

            def handle(route, _req, body=body):
                time.sleep(.8)  # let the shell paint as role A first
                route.fulfill(status=200, content_type='application/json', body=body)
            pg.route('**/api/auth/me', handle)
            pg.reload(); pg.wait_for_load_state('networkidle'); time.sleep(1.5)
            stored_role = pg.evaluate("() => JSON.parse(localStorage.getItem('hr_user')||'{}').role")
            hook_errs = [e for e in log['errs'] + log['cons'] if HOOK_ERR.search(e)]
            if BASE_MODE:
                print(f'  {name}: crashed={crashed(pg)} hook errors={len(hook_errs)} '
                      f'{(hook_errs[0][:140] if hook_errs else "")}')
                check(f'old code: {name} crashes the layout with a React hook error', (True, True),
                      (crashed(pg), bool(hook_errs)))
                pg.context.close(); continue
            check(f'{name}: /auth/me swapped the stored role in place', bb, stored_role)
            check(f'{name}: before the switch the labels were those of {a}', base_labels[a], before)
            check(f'{name}: no React hook error', [], hook_errs)
            check(f'{name}: shell still rendered, 0 page errors', (False, []), (crashed(pg), log['errs']))
            check(f'{name}: labels = {bb} labels', base_labels[bb], labels(pg))
            expect_sel = comps == ['*'] or len(comps) > 1
            check(f'{name}: company selector shown = {expect_sel}', expect_sel, selector_shown(pg))
            # user keeps working after the switch: open the last visible menu link, still no error
            link = pg.locator('aside nav li > a').last
            href = link.get_attribute('href'); link.click(); pg.wait_for_load_state('networkidle'); time.sleep(.5)
            check(f'{name}: after the switch, menu link {href} opens with no error', (href, False, []),
                  (pg.evaluate('() => location.pathname'), crashed(pg), log['errs']))
            if expect_sel:
                pg.locator('header select').first.select_option(ONE_CO); time.sleep(.3)
                check(f'{name}: company selector still works', ONE_CO, pg.locator('header select').first.input_value())
            # Not asserted: the reload sends the session-analytics unload beacon without a token (401, pre-existing), and the UI believes role B while the token is still role A, so B-only reads
            # (bug-report count, TA/DA pending count, ...) can 403 — an artefact of the mock, listed for the record.
            if log['bad']: print(f'    (reload beacon / mock role mismatch, not asserted) API >= 400: {sorted(set(log["bad"]))}')
            pg.context.close()

        if not BASE_MODE:
            print('\n— C. 390px phone, hr —')
            pg, log = new_page(b, 390)
            login(pg, 'hr')
            if pg.locator('aside nav li').first.is_visible() is False:
                pg.get_by_label('Open menu').click(); time.sleep(.4)
            check('390: drawer shows hr labels', base_labels['hr'], labels(pg))
            check('390: 0 page / console errors', ([], []), (log['errs'], log['cons']))
            all_bad += log['bad']; pg.context.close()
            check('0 API responses >= 400 overall', [], all_bad)
        b.close()
finally:
    srv.terminate()
print(f'\n{PASS} passed, {FAIL} failed')
sys.exit(1 if FAIL else 0)
