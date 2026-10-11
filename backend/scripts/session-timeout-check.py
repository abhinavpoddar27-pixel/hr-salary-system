#!/usr/bin/env python3
"""P2-08 — idle sign-out countdown, return path after re-login, useDraft hook — browser check.

Chromium against the BUILT dist, scratch DATA_DIR, real hr + finance logins (no employee data needed).
The idle timeout is shortened with the documented test knob (localStorage `hr_idle_test_ms` /
`hr_idle_test_warn_ms`, which can only shorten it). useDraft runs in the standalone harness
backend/scripts/p2-08-harness/ (built to a temp dir, served through page.route — no app route).

Usage:
  python3 backend/scripts/session-timeout-check.py                # this tree
  APP_ROOT=/tmp/base python3 .../session-timeout-check.py --base  # origin/main build: no dialog, lands on "/"
Needs `npm run build --prefix frontend` in APP_ROOT first. PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers. PORT default 3208.
"""
import json, mimetypes, os, re, shutil, subprocess, sys, tempfile, time, urllib.request
from playwright.sync_api import sync_playwright

HERE_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
ROOT = os.path.abspath(os.environ.get('APP_ROOT', HERE_ROOT))
BASE_MODE = '--base' in sys.argv
PORT = int(os.environ.get('PORT', '3208')); BASE = f'http://127.0.0.1:{PORT}'
WORK = tempfile.mkdtemp(prefix='p208-')
HARNESS_OUT = os.path.join(WORK, 'harness')
PASS = FAIL = 0
USERS = {'hr': 'Indriyan@2025', 'finance': 'Finance@2025'}
LIMIT_MS, WARN_MS = 16000, 10000          # dialog after ~6 s idle, sign-out after ~16 s
DIALOG = '[data-testid="session-timeout-dialog"]'


def check(label, expected, actual):
    global PASS, FAIL
    if expected == actual: PASS += 1; print(f'  ✓ {label}')
    else: FAIL += 1; print(f'  ✗ {label} — expected {expected!r}, got {actual!r}')


def knobs(limit=LIMIT_MS, warn=WARN_MS):
    return (f"try{{localStorage.setItem('hr_idle_test_ms','{limit}');"
            f"localStorage.setItem('hr_idle_test_warn_ms','{warn}')}}catch(e){{}}")


def new_ctx(b, width=1440, init=None):
    ctx = b.new_context(viewport={'width': width, 'height': 900})
    if init: ctx.add_init_script(init)
    return ctx


def watch(pg, sink):
    pg.on('pageerror', lambda e: sink['errs'].append(str(e)))
    pg.on('console', lambda m: sink['cons'].append(m.text)
          if m.type == 'error' and 'vite.svg' not in m.text and 'status of 401' not in m.text and '404' not in m.text else None)
    pg.on('response', lambda r: sink['bad'].append(f'{r.status} {r.url}')
          if '/api/' in r.url and r.status >= 400 and r.status != 401 else None)


LOGINS = 0


def login_form(pg, user):
    # server.js allows 5 logins / 15 min per IP; restart the scratch server (same DB + JWT_SECRET,
    # so open sessions stay valid) before the limit is hit. Only ever called on the login page.
    global LOGINS
    assert LOGINS < 5, 'a 6th login would hit the 5 / 15 min limit — call restart_server() between sections'
    LOGINS += 1
    pg.get_by_placeholder('admin').fill(user); pg.get_by_placeholder('••••••••').fill(USERS[user])
    pg.get_by_role('button', name='Sign in').click(); pg.wait_for_url(lambda u: '/login' not in u, timeout=15000)
    pg.wait_for_load_state('networkidle')


def login(pg, user):
    pg.goto(BASE + '/login'); login_form(pg, user)


def at_login(pg, timeout=15000):
    # The forced sign-out may first soft-navigate (RequireAuth) and then hard-reload: settle both.
    pg.wait_for_url(re.compile(r'/login$'), timeout=timeout)
    time.sleep(1.2); pg.wait_for_load_state('networkidle')
    pg.get_by_placeholder('admin').wait_for()


def path_of(pg):
    return pg.url[len(BASE):]


def countdown(pg):
    t = pg.locator('[data-testid="session-timeout-countdown"]').inner_text()
    m, s = t.split(':'); return int(m) * 60 + int(s), t


def run_app(b, sink):
    only = os.environ.get('ONLY')
    if only == '9': return section9(b, sink)
    print('\n— 1. countdown, passive activity ignored, Stay keeps the session —')
    ctx = new_ctx(b, init=knobs()); pg = ctx.new_page(); watch(pg, sink)
    login(pg, 'hr')
    target = '/analytics/punctuality?view=dept&x=1'
    pg.goto(BASE + target); pg.wait_for_load_state('networkidle')
    pg.locator(DIALOG).wait_for(timeout=15000)
    t0 = time.time(); s0, txt0 = countdown(pg)
    check('dialog text "You\'ll be signed out in m:ss"', True,
          bool(re.search(r"You.ll be signed out in\s+0:\d\d", pg.locator(DIALOG).inner_text())))
    check('countdown ≤ 0:10 when shown', True, 0 < s0 <= 10)
    check('role=alertdialog + aria-modal', ['alertdialog', 'true'],
          [pg.locator('[role="alertdialog"]').get_attribute('role'), pg.locator('[role="alertdialog"]').get_attribute('aria-modal')])
    check('focus on "Stay signed in"', 'Stay signed in', pg.evaluate('document.activeElement && document.activeElement.textContent'))
    time.sleep(2.2)
    s1, _ = countdown(pg); check('countdown goes down', True, s1 <= s0 - 2)
    for i in range(10): pg.mouse.move(100 + i * 30, 200 + i * 10); time.sleep(0.1)
    pg.keyboard.press('Escape')
    check('mouse movement + Esc do not close it (Q1)', True, pg.locator(DIALOG).is_visible())
    pg.keyboard.press('Tab'); check('Tab keeps focus in the dialog', 'Sign out now', pg.evaluate('document.activeElement.textContent'))
    pg.keyboard.press('Tab')
    with pg.expect_response(lambda r: '/api/auth/heartbeat' in r.url, timeout=5000) as hb:
        pg.get_by_role('button', name='Stay signed in').click()
    check('Stay → dialog closed', False, pg.locator(DIALOG).is_visible())
    check('Stay → heartbeat 200 (server session refreshed)', 200, hb.value.status)
    time.sleep(max(0, (t0 + s0 + 1.5) - time.time()))
    check('still signed in after the original expiry time', target, path_of(pg))
    check('token still stored', True, pg.evaluate("!!localStorage.getItem('hr_token')"))

    print('\n— 2. expiry → /login with banner → same user returns to page + query —')
    at_login(pg, 25000)
    check('signed out: token removed', False, pg.evaluate("!!localStorage.getItem('hr_token')"))
    check('idle banner shown', True, 'without activity' in (pg.locator('[data-testid="signed-out-banner"]').inner_text()))
    saved = pg.evaluate("JSON.parse(sessionStorage.getItem('hr_return_to'))")
    check('saved return path = page + query', target, saved and saved.get('path'))
    check('saved for user hr, reason idle', ['hr', 'idle'], [saved.get('user'), saved.get('reason')])
    login_form(pg, 'hr')
    check('after login: same page + query', target, path_of(pg))
    check('return path consumed', None, pg.evaluate("sessionStorage.getItem('hr_return_to')"))

    print('\n— 3. different user after expiry → "/" —')
    at_login(pg, 30000)
    login_form(pg, 'finance')
    check('finance lands on "/" (not hr\'s page)', '/', path_of(pg))
    ctx.close()

    print('\n— 4. tampered return paths → "/" —')
    restart_server()
    ctx = new_ctx(b); pg = ctx.new_page(); watch(pg, sink)
    for i, bad in enumerate(('//evil.example/x', 'https://evil.example/x', '/login?next=1', '/\\\\evil.example', 'javascript:alert(1)')):
        if i == 3: restart_server(pg)
        pg.goto(BASE + '/login')
        pg.evaluate("p => sessionStorage.setItem('hr_return_to', JSON.stringify({path:p,user:'hr',reason:'idle',at:Date.now()}))", bad)
        pg.reload(); login_form(pg, 'hr')
        check(f'tampered {bad!r} → "/"', '/', path_of(pg))
        pg.evaluate("localStorage.clear()")
    pg.goto(BASE + '/login')
    pg.evaluate("sessionStorage.setItem('hr_return_to', JSON.stringify({path:'/reports',user:'hr',reason:'idle',at:Date.now()-13*3600e3}))")
    pg.reload(); login_form(pg, 'hr')
    check('return path older than 12 h → "/"', '/', path_of(pg))
    pg.evaluate("localStorage.clear()")

    print('\n— 5. API 401 (expired session) → banner + same page after login —')
    restart_server(pg)
    pg.goto(BASE + '/login'); login_form(pg, 'hr')
    pg.route('**/api/auth/me', lambda r: r.fulfill(status=401, content_type='application/json', body='{"error":"expired"}'))
    pg.goto(BASE + '/reports?tab=pf&y=2'); at_login(pg, 15000)
    pg.unroute('**/api/auth/me')
    check('expired banner shown', True, 'session expired' in pg.locator('[data-testid="signed-out-banner"]').inner_text())
    login_form(pg, 'hr')
    check('after login: /reports?tab=pf&y=2', '/reports?tab=pf&y=2', path_of(pg))
    ctx.close()

    print('\n— 6. heartbeat 401 from "Stay signed in" → expired, return path kept —')
    ctx = new_ctx(b, init=knobs()); pg = ctx.new_page(); watch(pg, sink)
    login(pg, 'hr'); pg.goto(BASE + '/reports?hb=1'); pg.wait_for_load_state('networkidle')
    pg.route('**/api/auth/heartbeat', lambda r: r.fulfill(status=401, content_type='application/json', body='{"error":"expired"}'))
    pg.locator(DIALOG).wait_for(timeout=15000)
    pg.get_by_role('button', name='Stay signed in').click()
    at_login(pg, 10000)
    check('heartbeat 401 → expired banner', True, 'session expired' in pg.locator('[data-testid="signed-out-banner"]').inner_text())
    login_form(pg, 'hr'); check('→ back to /reports?hb=1', '/reports?hb=1', path_of(pg))
    ctx.close()

    print('\n— 7. deep link while signed out (RequireAuth) → that page after login —')
    ctx = new_ctx(b); pg = ctx.new_page(); watch(pg, sink)
    pg.goto(BASE + '/employees?q=T1'); at_login(pg)
    check('no banner for a plain deep link', 0, pg.locator('[data-testid="signed-out-banner"]').count())
    login_form(pg, 'hr'); check('→ /employees?q=T1', '/employees?q=T1', path_of(pg))
    ctx.close()

    print('\n— 8. two tabs share activity (Q2) —')
    restart_server()
    ctx = new_ctx(b, init=knobs(20000, 8000)); a = ctx.new_page(); watch(a, sink)
    login(a, 'hr'); a.goto(BASE + '/reports'); a.wait_for_load_state('networkidle')
    bb = ctx.new_page(); watch(bb, sink); bb.goto(BASE + '/'); bb.wait_for_load_state('networkidle')
    end = time.time() + 26
    while time.time() < end:
        bb.mouse.move(50 + int(time.time() * 7) % 400, 300); time.sleep(1.5)
    check('tab A still signed in after 26 s (B active)', '/reports', path_of(a))
    check('tab A: no countdown while B active', False, a.locator(DIALOG).is_visible())
    a.locator(DIALOG).wait_for(timeout=20000); bb.locator(DIALOG).wait_for(timeout=5000)
    bb.get_by_role('button', name='Stay signed in').click()
    a.locator(DIALOG).wait_for(state='hidden', timeout=3000)
    check('Stay in tab B closes the countdown in tab A', False, a.locator(DIALOG).is_visible())
    ctx.close()

    section9(b, sink)


def section9(b, sink):
    print('\n— 9. phone 390 px + "Sign out now" + manual logout unaffected —')
    ctx = new_ctx(b, width=390, init=knobs()); pg = ctx.new_page(); watch(pg, sink)
    login(pg, 'hr'); pg.goto(BASE + '/reports?p=1'); pg.wait_for_load_state('networkidle')
    pg.locator(DIALOG).wait_for(timeout=15000)
    box = pg.locator('[role="alertdialog"]').bounding_box()
    check('390: dialog inside the viewport', True, box['x'] >= 0 and box['x'] + box['width'] <= 390)
    pg.get_by_role('button', name='Sign out now').click(); at_login(pg, 10000)
    check('Sign out now → no return path saved', None, pg.evaluate("sessionStorage.getItem('hr_return_to')"))
    login_form(pg, 'hr'); check('→ "/"', '/', path_of(pg))
    ctx.close()


def run_base(b, sink):
    print('\n— BASE: origin/main behaviour —')
    dist = os.path.join(ROOT, 'frontend', 'dist', 'assets')
    found = any('session-timeout-dialog' in open(os.path.join(dist, f), encoding='utf-8', errors='ignore').read()
                for f in os.listdir(dist) if f.endswith('.js'))
    check('old bundle has no countdown dialog (toast only)', False, found)
    ctx = new_ctx(b); pg = ctx.new_page(); watch(pg, sink)
    login(pg, 'hr')
    pg.route('**/api/auth/me', lambda r: r.fulfill(status=401, content_type='application/json', body='{"error":"expired"}'))
    pg.goto(BASE + '/reports?tab=pf&y=2'); at_login(pg, 15000)
    pg.unroute('**/api/auth/me')
    login_form(pg, 'hr')
    check('old code: after re-login lands on "/" (page lost)', '/', path_of(pg))
    pg.evaluate("localStorage.clear()")
    pg.goto(BASE + '/employees?q=T1'); at_login(pg); login_form(pg, 'hr')
    check('old code: deep link lost → "/"', '/', path_of(pg))
    ctx.close()


def harness_ctx(b, user='tester1', blocked=False):
    ctx = b.new_context(viewport={'width': 900, 'height': 700})
    init = f"try{{localStorage.setItem('hr_user', JSON.stringify({{username:'{user}'}}))}}catch(e){{}}"
    if blocked:
        init += ";Object.defineProperty(window,'sessionStorage',{get(){throw new Error('blocked')}})"
    ctx.add_init_script(init)

    def serve(route):
        u = route.request.url.split('http://harness.test', 1)[1].split('?')[0]
        if u in ('/', ''): u = '/index.html'
        if u == '/other.html':
            return route.fulfill(status=200, content_type='text/html', body='<p id="other">other page</p>')
        p = os.path.join(HARNESS_OUT, u.lstrip('/'))
        if not os.path.isfile(p): return route.fulfill(status=404, body='')
        route.fulfill(status=200, body=open(p, 'rb').read(), content_type=mimetypes.guess_type(p)[0] or 'text/plain')
    ctx.route('http://harness.test/**', serve)
    return ctx


def run_harness(b, sink):
    print('\n— 10. useDraft harness —')
    subprocess.run([os.path.join(ROOT, 'frontend', 'node_modules', '.bin', 'vite'), 'build', '--config',
                    os.path.join(ROOT, 'backend', 'scripts', 'p2-08-harness', 'vite.config.mjs')],
                   check=True, env=dict(os.environ, HARNESS_OUT=HARNESS_OUT), cwd=ROOT, stdout=subprocess.DEVNULL)
    KEY = 'hr_draft:tester1:harness-form'
    ctx = harness_ctx(b); pg = ctx.new_page(); watch(pg, sink)
    dialogs = []
    pg.on('dialog', lambda d: (dialogs.append(d.type), d.accept()))
    pg.goto('http://harness.test/index.html'); pg.get_by_test_id('note').wait_for()
    check('fresh: no banner, not dirty', [0, 'false'], [pg.get_by_test_id('draft-restored-banner').count(), pg.get_by_test_id('dirty').inner_text()])
    pg.get_by_test_id('note').fill('fictional note A'); pg.get_by_test_id('days').fill('2')
    check('typing → dirty', 'true', pg.get_by_test_id('dirty').inner_text())
    time.sleep(0.6)
    stored = pg.evaluate(f"JSON.parse(sessionStorage.getItem('{KEY}'))")
    check('stored in sessionStorage (user-scoped key)', {'note': 'fictional note A', 'days': '2'}, stored and stored.get('v'))
    pg.reload(); pg.get_by_test_id('note').wait_for()
    check('reload while dirty → beforeunload prompt', True, 'beforeunload' in dialogs)
    check('after reload: value restored', 'fictional note A', pg.get_by_test_id('note').input_value())
    check('after reload: "Draft restored · Discard" banner', True,
          bool(re.search(r'Draft restored.*·\s*Discard', pg.get_by_test_id('draft-restored-banner').inner_text(), re.S)))
    pg.get_by_role('button', name='Discard').click()
    check('Discard → empty, banner gone, key removed', ['', 0, None],
          [pg.get_by_test_id('note').input_value(), pg.get_by_test_id('draft-restored-banner').count(), pg.evaluate(f"sessionStorage.getItem('{KEY}')")])
    dialogs.clear(); pg.reload(); pg.get_by_test_id('note').wait_for()
    check('after Discard: reload has no prompt and no banner', [[], 0], [dialogs[:], pg.get_by_test_id('draft-restored-banner').count()])

    pg.get_by_test_id('note').fill('fictional note B'); time.sleep(0.5)
    pg.get_by_role('button', name='Save', exact=True).click()
    check('Save (markSaved) → not dirty, key removed, value kept', ['false', None, 'fictional note B'],
          [pg.get_by_test_id('dirty').inner_text(), pg.evaluate(f"sessionStorage.getItem('{KEY}')"), pg.get_by_test_id('note').input_value()])
    dialogs.clear(); pg.reload(); pg.get_by_test_id('note').wait_for()
    check('after Save: no prompt on leave', [], dialogs[:])

    pg.get_by_test_id('note').type('xyz', delay=10)
    pg.get_by_role('button', name='Unmount form').click()
    check('unmount within the debounce keeps the last keystrokes', 'xyz', (pg.evaluate(f"JSON.parse(sessionStorage.getItem('{KEY}'))") or {}).get('v', {}).get('note'))
    pg.get_by_role('button', name='Mount form').click()
    check('re-mount → restored', ['xyz', 1], [pg.get_by_test_id('note').input_value(), pg.get_by_test_id('draft-restored-banner').count()])
    pg.get_by_role('button', name='Keep draft and hide this message').click()
    check('✕ hides the banner, keeps the draft', [0, 'xyz'], [pg.get_by_test_id('draft-restored-banner').count(), pg.get_by_test_id('note').input_value()])

    dialogs.clear()
    pg.get_by_role('button', name='Forced leave').click(); pg.locator('#other').wait_for(timeout=5000)
    check('forced sign-out (allowForcedUnload) → no prompt, navigates', [], dialogs[:])
    check('…and the draft survives for the re-login', 'xyz', (pg.evaluate(f"JSON.parse(sessionStorage.getItem('{KEY}'))") or {}).get('v', {}).get('note'))
    ctx.close()

    ctx = harness_ctx(b, user='tester2'); pg = ctx.new_page(); watch(pg, sink)
    pg.goto('http://harness.test/index.html'); pg.get_by_test_id('note').fill('n')
    time.sleep(0.5)
    keys = pg.evaluate("Object.keys(sessionStorage)")
    check('other user writes under their own key', ['hr_draft:tester2:harness-form'], keys)
    ctx.close()

    ctx = harness_ctx(b, blocked=True); pg = ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto('http://harness.test/index.html'); pg.get_by_test_id('note').fill('works in memory'); time.sleep(0.5)
    check('blocked sessionStorage: form still works', ['works in memory', 'true'],
          [pg.get_by_test_id('note').input_value(), pg.get_by_test_id('dirty').inner_text()])
    check('blocked sessionStorage: 0 page errors', [], errs)
    ctx.close()


def start_server():
    global srv
    srv = subprocess.Popen(['node', f'{ROOT}/backend/server.js'], env=env, stdout=open(f'{WORK}/log', 'a'), stderr=subprocess.STDOUT)
    for _ in range(80):
        try: urllib.request.urlopen(BASE + '/api/version', timeout=2); return
        except Exception: time.sleep(.5)


def restart_server(pg=None):
    """server.js allows 5 logins / 15 min per IP (in memory): restart the scratch server between
    sections (same DB + JWT_SECRET). Park the page on about:blank first so nothing fetches mid-restart."""
    global LOGINS
    if pg is not None: pg.goto('about:blank')
    srv.terminate(); srv.wait(10); start_server()
    LOGINS = 0


srv = None
env = dict(os.environ, DATA_DIR=WORK, JWT_SECRET='x', PORT=str(PORT), NODE_ENV='production',
           ADMIN_PASSWORD='Admin@123', HR_PASSWORD=USERS['hr'], FINANCE_PASSWORD=USERS['finance'])
try:
    start_server()
    print(f'App root: {ROOT}  mode: {"BASE" if BASE_MODE else "fix"}  port {PORT}')
    sink = {'errs': [], 'cons': [], 'bad': []}
    with sync_playwright() as p:
        b = p.chromium.launch()
        if BASE_MODE:
            run_base(b, sink)
        else:
            run_app(b, sink)
            run_harness(b, sink)
            print('\n— errors across all runs —')
            check('0 page errors', [], sink['errs'])
            check('0 console errors (intended 401s excluded)', [], sink['cons'])
            check('0 API ≥ 400 (intended 401s excluded)', [], sink['bad'])
        b.close()
finally:
    if srv: srv.terminate()
    if not os.environ.get('KEEP'): shutil.rmtree(WORK, ignore_errors=True)
    else: print('KEEPDIR', WORK)

print(f'\n{PASS} passed, {FAIL} failed')
sys.exit(1 if FAIL else 0)
