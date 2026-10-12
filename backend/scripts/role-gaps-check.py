#!/usr/bin/env python3
"""P3-RG role gaps — browser + API check.

1. Finance Audit → Attendance Flags: HR sees status only (no Verify, "Awaiting finance"); finance verifies.
   The verified state is read from `finance_verified` (there is no `verified` column); a legacy row with
   finance_verified=1 and no verified_by shows as verified.
2. GET /api/tax-declarations/:code and /:code/calculate: hr/finance/admin only (viewer/employee → 403).

Chromium against the BUILT dist, real hr + finance logins, scratch DATA_DIR, fictional codes T97xx.

Usage:
  python3 backend/scripts/role-gaps-check.py                 # this tree
  APP_ROOT=/tmp/wt python3 .../role-gaps-check.py --base     # an origin/main tree: records the old behaviour
Needs `npm run build --prefix frontend` in APP_ROOT first. PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers.
"""
import base64, datetime, hashlib, hmac, json, os, sqlite3, subprocess, sys, tempfile, time, urllib.request, urllib.error
from playwright.sync_api import sync_playwright

HERE_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
ROOT = os.path.abspath(os.environ.get('APP_ROOT', HERE_ROOT))
BASE_MODE = '--base' in sys.argv
PORT = int(os.environ.get('PORT', '3406')); BASE = f'http://127.0.0.1:{PORT}'
WORK = tempfile.mkdtemp(prefix='role-gaps-'); DB = os.path.join(WORK, 'hr_system.db')
SECRET = 'x'
C = 'Asian Lakto Ind Ltd'
IST = datetime.datetime.utcnow() + datetime.timedelta(hours=5, minutes=30)
M, Y = IST.month, IST.year
PASS = FAIL = 0

# code, day, finance_verified, verified_by
FLAGS = [('T9701', 2, 0, None), ('T9702', 3, 0, None), ('T9703', 4, 1, 'finance'), ('T9704', 5, 1, None)]


def check(label, expected, actual):
    global PASS, FAIL
    if expected == actual: PASS += 1; print(f'  ✓ {label}')
    else: FAIL += 1; print(f'  ✗ {label} — expected {expected!r}, got {actual!r}')


def b64(b): return base64.urlsafe_b64encode(b).rstrip(b'=').decode()


def token(username, role, emp=None):
    h = b64(json.dumps({'alg': 'HS256', 'typ': 'JWT'}).encode())
    p = b64(json.dumps({'id': 999, 'username': username, 'role': role, 'employee_code': emp,
                        'exp': int(time.time()) + 3600}).encode())
    sig = b64(hmac.new(SECRET.encode(), f'{h}.{p}'.encode(), hashlib.sha256).digest())
    return f'{h}.{p}.{sig}'


def api_get(path, tok):
    req = urllib.request.Request(BASE + path, headers={'Authorization': f'Bearer {tok}'})
    try:
        with urllib.request.urlopen(req, timeout=5) as r: return r.status
    except urllib.error.HTTPError as e: return e.code


def seed():
    c = sqlite3.connect(DB)
    for i, (code, day, fv, vb) in enumerate(FLAGS, 1):
        c.execute("INSERT OR IGNORE INTO employees(code,name,department,company,status,employment_type,gross_salary) "
                  "VALUES(?,?,'TEST DEPT',?,'Active','Permanent',30000)", (code, f'TEST EMP {i}', C))
        c.execute("INSERT INTO manual_attendance_flags(employee_code,employee_name,company,date,month,year,evidence_type,"
                  "reason,marked_by,finance_verified,verified_by,verified_at) VALUES(?,?,?,?,?,?,'gate_register','test reason',"
                  "'hr',?,?,?)", (code, f'TEST EMP {i}', C, f'{Y}-{M:02d}-{day:02d}', M, Y, fv, vb,
                                   '2026-10-01 10:00:00' if fv else None))
    c.execute("INSERT INTO tax_declarations(employee_code,financial_year,regime,section_80c) VALUES('T9701','2026-27','old',1000)")
    c.commit(); c.close()


def login(b, user, pw, width=1440):
    ctx = b.new_context(viewport={'width': width, 'height': 900})
    pg = ctx.new_page()
    errs, cons, bad, puts = [], [], [], []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('console', lambda m: cons.append(m.text) if m.type == 'error' and 'vite.svg' not in m.text and '404' not in m.text else None)
    pg.on('response', lambda r: bad.append(f'{r.status} {r.url}') if '/api/' in r.url and r.status >= 400 else None)
    pg.on('request', lambda r: puts.append(r.url) if r.method == 'PUT' and '/manual-flags/' in r.url else None)
    pg.goto(BASE + '/login'); pg.get_by_placeholder('admin').fill(user); pg.get_by_placeholder('••••••••').fill(pw)
    pg.get_by_role('button', name='Sign in').click(); pg.wait_for_url(lambda u: '/login' not in u)
    return pg, errs, cons, bad, puts


def open_flags(pg):
    pg.goto(BASE + '/finance-audit?tab=manual-flags'); pg.wait_for_load_state('networkidle')
    pg.locator('table tbody tr').first.wait_for(timeout=15000); time.sleep(.5)


def rows(pg):
    out = {}
    for tr in pg.locator('table tbody tr').all():
        code = tr.locator('td').first.inner_text().strip()
        out[code] = {'verified': tr.locator('td').nth(7).inner_text().strip().startswith('✓'),
                     'actions': tr.locator('td').nth(9).inner_text().strip()}
    return out


def kpi(pg, label):
    card = pg.locator('div.card', has=pg.get_by_text(label, exact=True)).first
    return int(card.locator('div.text-xl').inner_text())


def badge(pg):
    btn = pg.get_by_role('button', name=__import__('re').compile('^Attendance Flags'))
    s = btn.locator('span')
    return int(s.inner_text()) if s.count() else 0


env = dict(os.environ, DATA_DIR=WORK, JWT_SECRET=SECRET, PORT=str(PORT), NODE_ENV='production',
           ADMIN_PASSWORD='Admin@123', HR_PASSWORD='Indriyan@2025', FINANCE_PASSWORD='Finance@2025')
srv = subprocess.Popen(['node', f'{ROOT}/backend/server.js'], env=env, stdout=open(f'{WORK}/log', 'w'), stderr=subprocess.STDOUT)
try:
    for _ in range(80):
        try: urllib.request.urlopen(BASE + '/api/version', timeout=2); break
        except Exception: time.sleep(.5)
    seed()
    print(f'App root: {ROOT}  mode: {"BASE" if BASE_MODE else "fix"}  month {M}/{Y}')

    print('\n— API: tax declaration reads —')
    tv, te = token('rg_viewer', 'viewer'), token('rg_emp', 'employee', 'T9701')
    th, tf = token('rg_hr', 'hr'), token('rg_fin', 'finance')
    paths = ['/api/tax-declarations/T9701?financial_year=2026-27', '/api/tax-declarations/T9701/calculate?financial_year=2026-27']
    if BASE_MODE:
        check('old code: viewer reads declaration (200)', 200, api_get(paths[0], tv))
        check('old code: employee reads calculate (200)', 200, api_get(paths[1], te))
    else:
        for pth in paths:
            check(f'viewer → 403 {pth.split("?")[0]}', 403, api_get(pth, tv))
            check(f'employee (own code) → 403 {pth.split("?")[0]}', 403, api_get(pth, te))
            check(f'hr → 200 {pth.split("?")[0]}', 200, api_get(pth, th))
            check(f'finance → 200 {pth.split("?")[0]}', 200, api_get(pth, tf))

    with sync_playwright() as p:
        b = p.chromium.launch()
        print('\n— hr: Attendance Flags —')
        pg, errs, cons, bad, puts = login(b, 'hr', 'Indriyan@2025')
        open_flags(pg)
        r = rows(pg)
        check('hr: 4 flag rows', 4, len(r))
        nverify = pg.get_by_role('button', name='Verify', exact=True).count()
        if BASE_MODE:
            check('old code: hr sees Verify buttons', True, nverify > 0)
            check('old code: legacy finance_verified=1 row shows unverified', False, r['T9704']['verified'])
            pg.get_by_role('button', name='Verify', exact=True).first.click()
            pg.get_by_role('button', name='OK', exact=True).click(); time.sleep(1.2)
            check('old code: hr Verify → 403', True, any(x.startswith('403') and '/verify' in x for x in bad))
        else:
            check('hr: 0 Verify buttons', 0, nverify)
            check('hr: "Awaiting finance" on the 2 unverified rows', ['Awaiting finance'] * 2, [r['T9701']['actions'], r['T9702']['actions']])
            check('hr: verified rows show ✓ (incl. legacy finance_verified=1, no name)', [True, True], [r['T9703']['verified'], r['T9704']['verified']])
            check('hr: Unverified KPI 2', 2, kpi(pg, 'Unverified'))
            check('hr: Verified KPI 2', 2, kpi(pg, 'Verified'))
            check('hr: tab badge 2', 2, badge(pg))
            check('hr: 0 verify PUTs', 0, len(puts))
            # Known pre-existing (not this PR): the page's comp-off tab badge calls GET /comp-off/pending (finance+admin)
            # for every role → HR gets one 403 + its console line on load. Counted, then excluded.
            known = [x for x in bad if '/api/comp-off/pending' in x]
            check('hr: known comp-off/pending 403 (pre-existing, reported)', True, len(known) >= 1)
            bad = [x for x in bad if '/api/comp-off/pending' not in x]
            cons = [x for x in cons if 'comp-off/pending' not in x and 'status of 403' not in x]
            check('hr: 0 page errors', [], errs); check('hr: 0 other console errors', [], cons); check('hr: 0 other API ≥ 400', [], bad)
            # phone width
            ctx2 = b.new_context(viewport={'width': 390, 'height': 800}); ctx2.add_cookies(pg.context.cookies())
            pm = ctx2.new_page()
            pm.add_init_script(f"localStorage.setItem('hr_user', {json.dumps(pg.evaluate('localStorage.getItem(\"hr_user\")'))}); localStorage.setItem('hr_token', {json.dumps(pg.evaluate('localStorage.getItem(\"hr_token\")') or '')})")
            open_flags(pm)
            check('hr 390px: 0 Verify buttons', 0, pm.get_by_role('button', name='Verify', exact=True).count())
            check('hr 390px: Awaiting finance shown', 2, pm.get_by_test_id('flag-awaiting-finance').count())

            print('\n— finance: Attendance Flags —')
            pg, errs, cons, bad, puts = login(b, 'finance', 'Finance@2025')
            open_flags(pg)
            r = rows(pg)
            check('finance: 2 Verify buttons (unverified rows only)', 2, pg.get_by_role('button', name='Verify', exact=True).count())
            check('finance: no "Awaiting finance"', 0, pg.get_by_test_id('flag-awaiting-finance').count())
            check('finance: legacy row verified, no Verify', (True, ''), (r['T9704']['verified'], r['T9704']['actions']))
            tr = pg.locator('table tbody tr', has=pg.get_by_text('T9701', exact=True))
            tr.get_by_role('button', name='Verify', exact=True).click()
            tr.locator('input').fill('checked gate register')
            tr.get_by_role('button', name='OK', exact=True).click()
            pg.wait_for_load_state('networkidle'); time.sleep(1.5)
            c = sqlite3.connect(DB)
            row = c.execute("SELECT finance_verified, verified_by, finance_remarks FROM manual_attendance_flags WHERE employee_code='T9701'").fetchone()
            c.close()
            check('finance: verify writes DB', (1, 'finance', 'checked gate register'), row)
            check('finance: exactly 1 PUT', 1, len(puts))
            check('finance: Unverified KPI → 1', 1, kpi(pg, 'Unverified'))
            check('finance: 1 Verify button left', 1, pg.get_by_role('button', name='Verify', exact=True).count())
            check('finance: verified row shows ✓ at once', True, rows(pg)['T9701']['verified'])
            check('finance: tab badge → 1', 1, badge(pg))
            time.sleep(7)  # past the server cache window + delayed re-read: still verified
            check('finance: after re-read row still verified', True, rows(pg)['T9701']['verified'])
            check('finance: after re-read Unverified KPI 1', 1, kpi(pg, 'Unverified'))
            check('finance: 0 page errors', [], errs); check('finance: 0 console errors', [], cons); check('finance: 0 API ≥ 400', [], bad)
        b.close()
finally:
    srv.terminate()
    try: srv.wait(5)
    except Exception: srv.kill()

print(f'\n{PASS} passed, {FAIL} failed')
sys.exit(1 if FAIL else 0)
