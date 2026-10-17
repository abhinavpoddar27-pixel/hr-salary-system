#!/usr/bin/env python3
"""G2 — DW rate change maker-checker — browser check.

Chromium against the BUILT dist, real logins (admin, a second admin "admin2", finance), scratch DATA_DIR,
fictional data only ("TEST GANG EPSILON" / "TEST GANG ZETA" — the repo is public).

  EPSILON 500/20, pending change → 600/25 effective today-3, proposed by "admin". One draft entry today-1.
  ZETA    450/40, pending change → 520/45 effective today-3, proposed by "hr".

Fix mode: admin sees EPSILON's Approve/Reject disabled + the note, ZETA's enabled; a forced click sends nothing;
the API refuses admin's own approve/reject with 403 SELF_APPROVAL and writes nothing; admin2 approves EPSILON
(the G1 re-price runs); finance sees ZETA enabled; 390 px.
--base (G1 build): admin's own EPSILON Approve is enabled and approving it succeeds.

Usage:
  PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers PORT=3504 python3 backend/scripts/dw-rate-maker-checker-check.py
  APP_ROOT=/home/claude/wt-dw-rates python3 backend/scripts/dw-rate-maker-checker-check.py --base
Needs `npm run build --prefix frontend` in APP_ROOT first.
"""
import datetime, json, os, re, sqlite3, subprocess, sys, tempfile, time, urllib.request
from playwright.sync_api import sync_playwright

HERE_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
ROOT = os.path.abspath(os.environ.get('APP_ROOT', HERE_ROOT))
BASE_MODE = '--base' in sys.argv
PORT = int(os.environ.get('PORT', '3504')); BASE = f'http://127.0.0.1:{PORT}'
WORK = tempfile.mkdtemp(prefix='g2-'); DB = os.path.join(WORK, 'hr_system.db')
PASS = FAIL = 0
PW = {'hr': 'Indriyan@2025', 'finance': 'Finance@2025', 'admin': 'Admin@123', 'admin2': 'Second@2025'}
TODAY = (datetime.datetime.utcnow() + datetime.timedelta(hours=5, minutes=30)).date()
d = lambda n: (TODAY + datetime.timedelta(days=n)).isoformat()
NOTE = 'You raised this request — another finance or admin user must decide it.'


def check(label, expected, actual):
    global PASS, FAIL
    if expected == actual: PASS += 1; print(f'  ✓ {label}')
    else: FAIL += 1; print(f'  ✗ {label} — expected {expected!r}, got {actual!r}')


def q(sql, *a):
    c = sqlite3.connect(DB); r = c.execute(sql, a).fetchall(); c.close(); return r


def ex(sql, *a):
    c = sqlite3.connect(DB); cur = c.execute(sql, a); c.commit(); rid = cur.lastrowid; c.close(); return rid


E = {}


def seed():
    E['eps'] = ex("INSERT INTO dw_contractors(contractor_name,current_daily_wage_rate,current_commission_rate,created_by) VALUES('TEST GANG EPSILON',500,20,'hr')")
    E['zeta'] = ex("INSERT INTO dw_contractors(contractor_name,current_daily_wage_rate,current_commission_rate,created_by) VALUES('TEST GANG ZETA',450,40,'hr')")
    E['draft'] = ex("INSERT INTO dw_entries(contractor_id,entry_date,in_time,out_time,total_worker_count,wage_rate_applied,commission_rate_applied,"
                    "total_wage_amount,total_commission_amount,total_liability,gate_entry_reference,status,created_by) "
                    "VALUES(?,?,'08:00','17:00',3,500,20,1500,60,1560,'GT-EPS-1','hr_entered','hr')", E['eps'], d(-1))
    ex("INSERT INTO dw_department_allocations(entry_id,department,worker_count,allocated_wage_amount,allocated_commission_amount) VALUES(?,'TESTING',3,1500,60)", E['draft'])
    E['r_eps'] = ex("INSERT INTO dw_rate_history(contractor_id,old_wage_rate,new_wage_rate,old_commission_rate,new_commission_rate,effective_date,proposed_by) "
                    "VALUES(?,500,600,20,25,?,'admin')", E['eps'], d(-3))
    E['r_zeta'] = ex("INSERT INTO dw_rate_history(contractor_id,old_wage_rate,new_wage_rate,old_commission_rate,new_commission_rate,effective_date,proposed_by) "
                     "VALUES(?,450,520,40,45,?,'hr')", E['zeta'], d(-3))


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


def api(method, path, token=None, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method,
                                 headers={'Content-Type': 'application/json', **({'Authorization': f'Bearer {token}'} if token else {})})
    try:
        r = opener.open(req, timeout=10); return r.status, json.loads(r.read() or b'null')
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b'null')


def login(b, user, path, width=1440):
    ctx = b.new_context(viewport={'width': width, 'height': 900})
    pg = ctx.new_page()
    st = {'errs': [], 'bad': [], 'puts': []}
    pg.on('pageerror', lambda e: st['errs'].append(str(e)))
    pg.on('request', lambda r: st['puts'].append(r.url) if r.method == 'PUT' and '/rates/' in r.url else None)
    pg.on('response', lambda r: st['bad'].append(f'{r.status} {r.url}') if '/api/' in r.url and r.status >= 400
          and not r.url.endswith('/comp-off/pending') and 'session-analytics' not in r.url else None)
    pg.goto(BASE + '/login'); pg.get_by_placeholder('admin').fill(user); pg.get_by_placeholder('••••••••').fill(PW[user])
    pg.get_by_role('button', name='Sign in').click(); pg.wait_for_url(lambda u: '/login' not in u)
    pg.goto(BASE + path); pg.wait_for_load_state('networkidle'); time.sleep(.8)
    pg.get_by_role('button', name=re.compile('^Rate Approvals')).click(); time.sleep(.6)
    return pg, ctx, st


card = lambda pg, name: pg.locator('div.bg-white.rounded-lg.border', has_text=name)
btn = lambda pg, name, label: card(pg, name).get_by_role('button', name=label, exact=True)
dialog = lambda pg: pg.get_by_role('dialog').filter(has=pg.locator('[data-testid="confirm-approve-rate"]'))
rate = lambda key: q('SELECT approval_status, approved_by FROM dw_rate_history WHERE id=?', E[key])[0]
snap = lambda: (q('SELECT * FROM dw_rate_history ORDER BY id'), q('SELECT * FROM dw_contractors ORDER BY id'),
                q('SELECT * FROM dw_entries ORDER BY id'), q('SELECT COUNT(*) FROM dw_audit_log'))

start(); seed()
print(f'App root: {ROOT}  mode: {"BASE (expect the old behaviour)" if BASE_MODE else "fix"}  IST today {TODAY}')
try:
    # second admin, created through the real users route (one API login)
    s, r = api('POST', '/api/auth/login', body={'username': 'admin', 'password': PW['admin']})
    admin_tok = r['token']
    s, r = api('POST', '/api/auth/users', admin_tok, {'username': 'admin2', 'password': PW['admin2'], 'role': 'admin'})
    check('second admin created', True, s in (200, 201) and r.get('success') is True)

    with sync_playwright() as p:
        b = p.chromium.launch()

        print('\n— admin: own request (EPSILON) vs someone else\'s (ZETA) —')
        pg, ctx, st = login(b, 'admin', '/daily-wage/contractors')
        if BASE_MODE:
            check('old: own Approve enabled', True, btn(pg, 'TEST GANG EPSILON', 'Approve').is_enabled())
            check('old: no self note', 0, card(pg, 'TEST GANG EPSILON').get_by_test_id('dw-rate-self-note').count())
            btn(pg, 'TEST GANG EPSILON', 'Approve').click(); dialog(pg).wait_for(timeout=5000); time.sleep(1.2)
            dialog(pg).get_by_role('button', name='Approve rates', exact=True).click()
            pg.wait_for_load_state('networkidle'); time.sleep(1)
            check('old: admin approved their own request', ('approved', 'admin'), rate('r_eps'))
        else:
            check('own Approve disabled', False, btn(pg, 'TEST GANG EPSILON', 'Approve').is_enabled())
            check('own Reject disabled', False, btn(pg, 'TEST GANG EPSILON', 'Reject').is_enabled())
            check('own card shows the note', NOTE, card(pg, 'TEST GANG EPSILON').get_by_test_id('dw-rate-self-note').inner_text().strip())
            check('own Approve tooltip = note', NOTE, btn(pg, 'TEST GANG EPSILON', 'Approve').get_attribute('title'))
            check('other card Approve enabled', True, btn(pg, 'TEST GANG ZETA', 'Approve').is_enabled())
            check('other card Reject enabled', True, btn(pg, 'TEST GANG ZETA', 'Reject').is_enabled())
            check('other card has no note', 0, card(pg, 'TEST GANG ZETA').get_by_test_id('dw-rate-self-note').count())
            before = snap()
            btn(pg, 'TEST GANG EPSILON', 'Approve').click(force=True); time.sleep(.8)
            btn(pg, 'TEST GANG EPSILON', 'Reject').click(force=True); time.sleep(.8)
            check('forced clicks open no approve dialog', 0, dialog(pg).count())
            check('forced clicks send no PUT', [], st['puts'])
            tok = pg.evaluate("localStorage.getItem('hr_token')")
            s1, r1 = api('PUT', f"/api/daily-wage/rates/{E['r_eps']}/approve", tok)
            s2, r2 = api('PUT', f"/api/daily-wage/rates/{E['r_eps']}/reject", tok, {'remarks': 'not agreed'})
            check('API own approve → 403 SELF_APPROVAL', (403, 'SELF_APPROVAL'), (s1, (r1 or {}).get('code')))
            check('API own reject → 403 SELF_APPROVAL', (403, 'SELF_APPROVAL'), (s2, (r2 or {}).get('code')))
            check('nothing written by the refused calls', before, snap())
            st['bad'] = [x for x in st['bad'] if '/rates/' not in x]
            check('admin page: 0 page errors', [], st['errs'])
            check('admin page: 0 API ≥ 400', [], st['bad'])
            ctx.close()

            print('\n— admin at 390 px —')
            pg, ctx, st = login(b, 'admin', '/daily-wage/contractors', width=390)
            check('390 px: note visible', True, card(pg, 'TEST GANG EPSILON').get_by_test_id('dw-rate-self-note').is_visible())
            check('390 px: no sideways scroll', True, pg.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1'))
            check('390 px: 0 page errors', [], st['errs'])
            ctx.close()

            print('\n— admin2 decides the admin-raised request —')
            pg, ctx, st = login(b, 'admin2', '/daily-wage/contractors')
            check('admin2: EPSILON Approve enabled', True, btn(pg, 'TEST GANG EPSILON', 'Approve').is_enabled())
            check('admin2: no self note', 0, card(pg, 'TEST GANG EPSILON').get_by_test_id('dw-rate-self-note').count())
            btn(pg, 'TEST GANG EPSILON', 'Approve').click(); dialog(pg).wait_for(timeout=5000); time.sleep(1.2)
            dialog(pg).get_by_role('button', name='Approve rates', exact=True).click()
            pg.wait_for_load_state('networkidle'); time.sleep(1)
            check('approved by admin2', ('approved', 'admin2'), rate('r_eps'))
            check('draft re-priced to the new rate (G1)', [(600.0, 25.0, 1875.0)],
                  q('SELECT wage_rate_applied, commission_rate_applied, total_liability FROM dw_entries WHERE id=?', E['draft']))
            check('admin2: 0 page errors', [], st['errs'])
            check('admin2: 0 API ≥ 400', [], st['bad'])
            ctx.close()

            stop(); start()   # login limiter: fresh server before the next browser login
            print('\n— finance: hr-raised request (ZETA) is decidable —')
            pg, ctx, st = login(b, 'finance', '/daily-wage/contractors')
            check('finance: ZETA Approve enabled', True, btn(pg, 'TEST GANG ZETA', 'Approve').is_enabled())
            check('finance: no self note', 0, pg.get_by_test_id('dw-rate-self-note').count())
            check('finance: 0 page errors', [], st['errs'])
            check('finance: 0 API ≥ 400', [], st['bad'])
            ctx.close()
        b.close()
finally:
    stop()
print(f'\n{PASS} passed, {FAIL} failed')
sys.exit(1 if FAIL else 0)
