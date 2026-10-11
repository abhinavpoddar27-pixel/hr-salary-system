#!/usr/bin/env python3
"""Page ErrorBoundary reports to Sentry, shows a plain message, offers Report bug (P2-09, finding X-4) — browser check.

Chromium against the BUILT dist, real hr login, scratch DATA_DIR (empty — no data needed).
A render error is forced WITHOUT any test code in the app: Playwright replaces the lazy Employees page chunk
(assets/Employees-*.js) with a module whose default component throws "forced test error".

Sentry is observed without any network or secret: build the frontend with a FAKE DSN that points at a reserved
`.invalid` host, and Playwright intercepts every Sentry envelope POST (fulfils 200, nothing leaves the machine):
  VITE_SENTRY_DSN=https://public@o0.ingest.invalid/1 flock /tmp/vite.lock npm run build --prefix frontend

Usage:
  python3 backend/scripts/errorboundary-sentry-check.py               # this tree's server + dist
  APP_ROOT=/path/to/origin-main-tree python3 .../errorboundary-sentry-check.py --base
                                                                       # old code: raw message, no Sentry event
Needs PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers. PORT defaults to 3209.
"""
import json, os, re, subprocess, sys, tempfile, time, urllib.request
from playwright.sync_api import sync_playwright

HERE_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
ROOT = os.path.abspath(os.environ.get('APP_ROOT', HERE_ROOT))
BASE_MODE = '--base' in sys.argv
PORT = int(os.environ.get('PORT', '3209')); BASE = f'http://127.0.0.1:{PORT}'
WORK = tempfile.mkdtemp(prefix='eb-sentry-')
FORCED = 'forced test error'
CHUNK_RE = re.compile(r'/assets/Employees-[A-Za-z0-9_-]+\.js$')
ENVELOPE_RE = re.compile(r'/api/1/envelope/')
THROWING_MODULE = f"export default function ForcedCrash() {{ throw new Error('{FORCED}') }}\n"
PASS = FAIL = 0


def check(label, expected, actual):
    global PASS, FAIL
    if expected == actual: PASS += 1; print(f'  ✓ {label}')
    else: FAIL += 1; print(f'  ✗ {label} — expected {expected!r}, got {actual!r}')


def open_session(b, width=1440, crash=True):
    ctx = b.new_context(viewport={'width': width, 'height': 900})
    pg = ctx.new_page()
    st = {'errs': [], 'cons': [], 'bad': [], 'events': [], 'envelopes': 0}

    def on_console(m):
        if m.type != 'error': return
        t = m.text
        if 'vite.svg' in t or '404' in t: return
        # The forced crash itself is logged by React and by the boundary — expected, counted separately.
        if FORCED in t or '[ErrorBoundary]' in t or 'The above error occurred' in t: return
        st['cons'].append(t)

    def on_envelope(route):
        st['envelopes'] += 1
        body = route.request.post_data_buffer or b''
        if b'"type":"event"' in body:
            st['events'].append(body.decode('utf-8', 'replace'))
        route.fulfill(status=200, body='{}', content_type='application/json')

    pg.on('pageerror', lambda e: st['errs'].append(str(e)))
    pg.on('console', on_console)
    pg.on('response', lambda r: st['bad'].append(f'{r.status} {r.url}') if '/api/' in r.url and BASE in r.url and r.status >= 400 else None)
    ctx.route(ENVELOPE_RE, on_envelope)
    if crash:
        ctx.route(CHUNK_RE, lambda route: route.fulfill(status=200, body=THROWING_MODULE, content_type='application/javascript'))
    pg.goto(BASE + '/login'); pg.get_by_placeholder('admin').fill('hr'); pg.get_by_placeholder('••••••••').fill('Indriyan@2025')
    pg.get_by_role('button', name='Sign in').click(); pg.wait_for_url(lambda u: '/login' not in u)
    pg.wait_for_load_state('networkidle')
    return ctx, pg, st


def goto_employees(pg):
    pg.goto(BASE + '/employees'); pg.wait_for_load_state('networkidle'); time.sleep(1.5)


env = dict(os.environ, DATA_DIR=WORK, JWT_SECRET='x', PORT=str(PORT), NODE_ENV='production',
           ADMIN_PASSWORD='Admin@123', HR_PASSWORD='Indriyan@2025', FINANCE_PASSWORD='Finance@2025')
srv = subprocess.Popen(['node', f'{ROOT}/backend/server.js'], env=env, stdout=open(f'{WORK}/log', 'w'), stderr=subprocess.STDOUT)
try:
    for _ in range(80):
        try: urllib.request.urlopen(BASE + '/api/version', timeout=2); break
        except Exception: time.sleep(.5)
    print(f'App root: {ROOT}  mode: {"BASE (expect raw message, no Sentry event)" if BASE_MODE else "fix"}')

    with sync_playwright() as p:
        b = p.chromium.launch()

        if BASE_MODE:
            ctx, pg, st = open_session(b)
            goto_employees(pg)
            body = pg.locator('main').inner_text()
            check('old code: raw error message on screen without any click', True, FORCED in body)
            check('old code: no Report bug button', 0, pg.get_by_role('button', name='Report bug').count())
            check('old code: no Sentry event sent for the page crash', 0, len(st['events']))
            ctx.close(); b.close()
        else:
            # ── 1. Control: no crash → no fallback, no event ──────────────────────────
            print('\n— control (no forced error) —')
            ctx, pg, st = open_session(b, crash=False)
            goto_employees(pg)
            check('control: Employee Master renders (no fallback)', 0, pg.get_by_test_id('error-boundary').count())
            check('control: no Sentry event', 0, len(st['events']))
            check('control: 0 page errors', [], st['errs'])
            check('control: 0 console errors', [], st['cons'])
            check('control: 0 API >= 400', [], st['bad'])
            ctx.close()

            # ── 2. Forced crash on Employee Master ─────────────────────────────────────
            print('\n— forced render error on /employees —')
            ctx, pg, st = open_session(b)
            goto_employees(pg)
            eb = pg.get_by_test_id('error-boundary')
            check('fallback shown', 1, eb.count())
            check('title names the page (from the header)', 'Something went wrong on Employee Master.',
                  pg.get_by_test_id('error-boundary-title').inner_text().strip())
            check('plain message: "Nothing was saved by this error."', True, 'Nothing was saved by this error.' in eb.inner_text())
            check('raw error NOT shown before "Show details"', False, FORCED in eb.inner_text())
            check('header + sidebar still on screen', True, pg.locator('header h1').is_visible())
            for name in ('Try again', 'Reload page', 'Report bug'):
                check(f'button "{name}" present', 1, eb.get_by_role('button', name=name).count())

            # Sentry event observed (intercepted)
            for _ in range(20):
                if st['events']: break
                time.sleep(.25)
            check('exactly one Sentry event for the crash', 1, len(st['events']))
            ev = st['events'][0] if st['events'] else ''
            check('event carries the error message', True, FORCED in ev)
            check('event tagged boundary=page', True, '"boundary":"page"' in ev)
            check('event tagged page=/employees', True, '"page":"/employees"' in ev)
            check('event carries the React component stack', True, '"componentStack"' in ev)

            # Details toggle
            pg.get_by_test_id('error-boundary-details-toggle').click()
            det = pg.get_by_test_id('error-boundary-details')
            check('details: raw message shown', True, FORCED in det.inner_text())
            ev_id = None
            m = re.search(r'"event_id":"([0-9a-f]{32})"', ev)
            if m: ev_id = m.group(1)
            check('details: Sentry reference id = the event sent', True, bool(ev_id) and f'Reference: {ev_id}' in det.inner_text())
            check('toggle label now "Hide details"', 'Hide details', pg.get_by_test_id('error-boundary-details-toggle').inner_text().strip())
            pg.get_by_test_id('error-boundary-details-toggle').click()
            check('details hidden again', 0, pg.get_by_test_id('error-boundary-details').count())

            # Report bug → existing bug modal
            pg.get_by_test_id('error-boundary-report').click()
            dlg = pg.get_by_text('Report an issue', exact=True)
            dlg.first.wait_for(timeout=5000)
            check('Report bug opens the bug reporter ("Report an issue")', True, dlg.first.is_visible())
            pg.keyboard.press('Escape'); time.sleep(.5)
            check('bug modal closes; fallback still there', 1, pg.get_by_test_id('error-boundary').count())

            # Try again → crashes again (chunk still throws) → second event, still the fallback
            pg.get_by_role('button', name='Try again').click(); time.sleep(1)
            check('Try again re-renders the page (still crashing → fallback again)', 1, pg.get_by_test_id('error-boundary').count())
            check('Try again: second Sentry event', 2, len(st['events']))

            # Navigate away via sidebar → error clears, Daily MIS renders
            link = pg.locator('a[href="/daily-mis"]').first
            link.click(); pg.wait_for_url(lambda u: u.endswith('/daily-mis')); pg.wait_for_load_state('networkidle'); time.sleep(1)
            check('navigating to Daily MIS clears the error screen', 0, pg.get_by_test_id('error-boundary').count())
            check('Daily MIS header shown', 'Daily MIS', pg.locator('header h1').inner_text().strip())
            check('no extra Sentry event on navigation', 2, len(st['events']))
            check('crash run: 0 page errors', [], st['errs'])
            check('crash run: 0 unexpected console errors', [], st['cons'])
            check('crash run: 0 API >= 400', [], st['bad'])
            ctx.close()

            # ── 3. Phone width ─────────────────────────────────────────────────────────
            print('\n— 390 px —')
            ctx, pg, st = open_session(b, width=390)
            goto_employees(pg)
            eb = pg.get_by_test_id('error-boundary')
            check('390: fallback shown', 1, eb.count())
            check('390: Report bug visible', True, pg.get_by_test_id('error-boundary-report').is_visible())
            sw = pg.evaluate('document.documentElement.scrollWidth')
            check('390: no sideways page scroll', True, sw <= 392)
            check('390: 0 page errors', [], st['errs'])
            ctx.close()
            b.close()
finally:
    srv.terminate()
    try: srv.wait(timeout=10)
    except Exception: srv.kill()

print(f'\n{PASS} passed, {FAIL} failed')
sys.exit(1 if FAIL else 0)
