#!/usr/bin/env python3
"""Salary Input → pending salary change cards show every component old → new + the effective date (P1-22, F-2).

Chromium against the BUILT dist, real logins (hr raises via the API, finance views), scratch DATA_DIR with
fictional data only (codes T22xx, names "TEST EMP n" — the repo is public).

Requests (fix run):
  T2201  Salary Input request: conveyance 1500→2000, other 3000→3500 (basic/DA/HRA unchanged)
  T2202  Employee Master gross 15000→18000 (50 % basic / 20 % HRA) — no conveyance key in the request
  T2203  Employee Master gross 15000→20000 with 10 % special allowance → Special allowance row
  T2204  Salary Input request with the same five values (nothing changed)
  T2205  legacy row: old/new structure NULL
  T2206  legacy row: old structure not JSON, new = {"basic": 8000}
  T2207  legacy row: old structure {} (no structure on record), new = 5 keys
Checks: rows per card, which rows are marked changed, Current/Proposed text, the "not in this request" note,
effective-date line, finance Approve still there, 390px no sideways page scroll, 0 page/console errors, 0 API ≥ 400.
Base (old code, --base): Conveyance / Other allowances absent from the card, no effective date.

Usage:
  python3 backend/scripts/salary-change-approver-view-check.py
  APP_ROOT=/tmp/wt-main python3 backend/scripts/salary-change-approver-view-check.py --base
Needs `npm run build --prefix frontend` in APP_ROOT first. PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers.
"""
import json, os, re, sqlite3, subprocess, sys, tempfile, time, urllib.request
from playwright.sync_api import sync_playwright

HERE_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
ROOT = os.path.abspath(os.environ.get('APP_ROOT', HERE_ROOT))
BASE_MODE = '--base' in sys.argv
PORT = int(os.environ.get('PORT', '3122')); BASE = f'http://127.0.0.1:{PORT}'
WORK = tempfile.mkdtemp(prefix='sal-view-'); DB = os.path.join(WORK, 'hr_system.db')
C = 'Asian Lakto Ind Ltd'
NOTE = 'not in this request — approval sets it to 0'
PW = {'admin': 'Admin@123', 'hr': 'Indriyan@2025', 'finance': 'Finance@2025'}
PASS = FAIL = 0


def check(label, expected, actual):
    global PASS, FAIL
    if expected == actual: PASS += 1; print(f'  ✓ {label}')
    else: FAIL += 1; print(f'  ✗ {label} — expected {expected!r}, got {actual!r}')


def q(sql, args=()):
    c = sqlite3.connect(DB); r = c.execute(sql, args).fetchall(); c.close(); return r


# code: (basic, da, hra, conveyance, other) of the current structure; None = no structure
STRUCT = {
    'T2201': (7500, 0, 3000, 1500, 3000), 'T2202': (7500, 0, 3000, 1000, 3500),
    'T2203': (7500, 0, 3000, 1000, 3500), 'T2204': (7500, 500, 3000, 1000, 3000),
    'T2205': (7500, 0, 3000, 1500, 3000), 'T2206': (7500, 0, 3000, 1500, 3000), 'T2207': None,
}


def seed():
    c = sqlite3.connect(DB)
    for i, (code, s) in enumerate(STRUCT.items(), 1):
        c.execute("INSERT INTO employees(code,name,department,company,status,employment_type,gross_salary) "
                  "VALUES(?,?,'TEST DEPT',?,'Active','Permanent',15000)", (code, f'TEST EMP {i}', C))
        if s:
            eid = c.execute('SELECT id FROM employees WHERE code=?', (code,)).fetchone()[0]
            c.execute("INSERT INTO salary_structures(employee_id,effective_from,gross_salary,basic,da,hra,conveyance,other_allowances) "
                      "VALUES(?, '2025-01-01', ?, ?, ?, ?, ?, ?)", (eid, sum(s), *s))
    c.commit(); c.close()


def seed_legacy():
    c = sqlite3.connect(DB)
    rows = [('T2205', None, None, 15000, 15000),
            ('T2206', 'not json {', json.dumps({'basic': 8000}), 15000, 8000),
            ('T2207', '{}', json.dumps({'basic': 8000, 'da': 0, 'hra': 3200, 'conveyance': 800, 'other_allowances': 4000}), 0, 16000)]
    for code, old, new, og, ng in rows:
        eid = c.execute('SELECT id FROM employees WHERE code=?', (code,)).fetchone()[0]
        c.execute("INSERT INTO salary_change_requests(employee_id,employee_code,requested_by,old_gross,new_gross,old_structure,"
                  "new_structure,reason,status) VALUES(?,?,'hr',?,?,?,?,'legacy synthetic','Pending')", (eid, code, og, ng, old, new))
    c.commit(); c.close()


def api(method, path, token, body=None):
    req = urllib.request.Request(BASE + path, method=method, data=json.dumps(body or {}).encode(),
                                 headers={'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token})
    with urllib.request.urlopen(req, timeout=10) as r:
        return r.status, json.loads(r.read())


def token(user):
    req = urllib.request.Request(BASE + '/api/auth/login', data=json.dumps({'username': user, 'password': PW[user]}).encode(),
                                 headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read())['token']


def login(b, user, width=1440):
    ctx = b.new_context(viewport={'width': width, 'height': 900})
    pg = ctx.new_page()
    errs, cons, bad = [], [], []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('console', lambda m: cons.append(m.text) if m.type == 'error' and 'vite.svg' not in m.text else None)
    pg.on('response', lambda r: bad.append(f'{r.status} {r.request.method} {r.url}') if '/api/' in r.url and r.status >= 400 else None)
    pg.goto(BASE + '/login'); pg.get_by_placeholder('admin').fill(user); pg.get_by_placeholder('••••••••').fill(PW[user])
    pg.get_by_role('button', name='Sign in').click(); pg.wait_for_url(lambda u: '/login' not in u)
    return pg, errs, cons, bad


def open_pending(pg):
    pg.goto(BASE + '/salary-input'); pg.wait_for_load_state('networkidle'); time.sleep(.5)
    pg.get_by_role('button', name=re.compile('^Pending Approvals')).click(); pg.wait_for_load_state('networkidle'); time.sleep(.8)


def card(pg, code):
    return pg.locator('div.card.border-l-4', has_text=f'({code})').first


def rows(cd):
    """[(component, changed, label, current, proposed, has_note)] read from the table."""
    return cd.evaluate("""el => [...el.querySelectorAll('tr[data-component]')].map(tr => {
        const td = tr.querySelectorAll('td');
        return [tr.dataset.component, tr.dataset.changed === '1', td[0].firstChild.textContent.trim(),
                td[1].innerText.trim(), td[2].innerText.replace(/[▲▼]/g, '').trim(),
                !!tr.querySelector('[data-testid=missing-note]')];
    })""")


env = dict(os.environ, DATA_DIR=WORK, JWT_SECRET='x', PORT=str(PORT), NODE_ENV='production',
           ADMIN_PASSWORD=PW['admin'], HR_PASSWORD=PW['hr'], FINANCE_PASSWORD=PW['finance'])
srv = subprocess.Popen(['node', f'{ROOT}/backend/server.js'], env=env, stdout=open(f'{WORK}/log', 'w'), stderr=subprocess.STDOUT)
try:
    for _ in range(80):
        try: urllib.request.urlopen(BASE + '/api/version', timeout=2); break
        except Exception: time.sleep(.5)
    seed()
    print(f'App root: {ROOT}  mode: {"BASE (expect Conveyance/Other missing)" if BASE_MODE else "fix"}')

    hr = token('hr')
    st, _ = api('POST', '/api/salary-input/request-change', hr, {'employeeCode': 'T2201', 'reason': 'synthetic',
            'newStructure': {'basic': 7500, 'da': 0, 'hra': 3000, 'conveyance': 2000, 'other_allowances': 3500}})
    check('hr raises T2201 via Salary Input API', 200, st)
    st, r = api('PUT', '/api/employees/T2202/salary', hr, {'gross_salary': 18000, 'basic_percent': 50, 'hra_percent': 20,
            'da_percent': 0, 'special_allowance_percent': 0, 'other_allowance': 0})
    check('hr raises T2202 via Employee Master (pendingApproval)', (200, True), (st, r.get('pendingApproval')))
    st, r = api('PUT', '/api/employees/T2203/salary', hr, {'gross_salary': 20000, 'basic_percent': 50, 'hra_percent': 20,
            'da_percent': 0, 'special_allowance_percent': 10, 'other_allowance': 2000})
    check('hr raises T2203 via Employee Master with special allowance', (200, True), (st, r.get('pendingApproval')))
    st, _ = api('POST', '/api/salary-input/request-change', hr, {'employeeCode': 'T2204', 'reason': 'synthetic',
            'newStructure': {'basic': 7500, 'da': 500, 'hra': 3000, 'conveyance': 1000, 'other_allowances': 3000}})
    check('hr raises T2204 (no change) via Salary Input API', 200, st)
    seed_legacy()
    check('7 pending requests in DB', 7, q("SELECT COUNT(*) FROM salary_change_requests WHERE status='Pending'")[0][0])

    with sync_playwright() as p:
        b = p.chromium.launch()
        pg, errs, cons, bad = login(b, 'finance')
        open_pending(pg)
        check('finance sees 7 pending cards', 7, pg.locator('div.card.border-l-4').count())
        if BASE_MODE:
            t = card(pg, 'T2201').inner_text()
            check('old code: Conveyance not on the card', False, 'Conveyance' in t)
            check('old code: Other allowances not on the card', False, 'Other' in t)
            check('old code: no effective date', False, 'Effective' in t)
            b.close()
        else:
            FIVE = ['basic', 'da', 'hra', 'conveyance', 'other_allowances']
            print('\n— T2201: Salary Input request, conveyance + other changed —')
            r1 = rows(card(pg, 'T2201'))
            check('rows = five components + gross', FIVE + ['gross'], [x[0] for x in r1])
            check('labels', ['Basic', 'DA', 'HRA', 'Conveyance', 'Other allowances', 'Gross'], [x[2] for x in r1])
            check('changed: conveyance, other, gross', ['conveyance', 'other_allowances', 'gross'], [x[0] for x in r1 if x[1]])
            check('conveyance ₹1,500 → ₹2,000', ('₹1,500', '₹2,000'), (r1[3][3], r1[3][4]))
            check('other ₹3,000 → ₹3,500', ('₹3,000', '₹3,500'), (r1[4][3], r1[4][4]))
            check('basic unchanged ₹7,500 → ₹7,500', ('₹7,500', '₹7,500'), (r1[0][3], r1[0][4]))
            check('gross ₹15,000 → ₹16,000', ('₹15,000', '₹16,000'), (r1[5][3], r1[5][4]))
            check('no "not in this request" note', [], [x[0] for x in r1 if x[5]])
            check('changed rows are amber', True, card(pg, 'T2201').locator('tr[data-component=conveyance]').evaluate("e => e.className.includes('bg-amber-50')"))
            check('unchanged rows are not amber', False, card(pg, 'T2201').locator('tr[data-component=basic]').evaluate("e => e.className.includes('bg-amber-50')"))
            check('increase arrow ▲ on conveyance', True, '▲' in card(pg, 'T2201').locator('tr[data-component=conveyance]').inner_text())
            eff = card(pg, 'T2201').get_by_test_id('effective-note').inner_text()
            check('effective note says the day it is approved (today)', True, eff.startswith('Effective from: the day it is approved (today, '))
            check('finance still has Approve + Reject', (1, 1), (card(pg, 'T2201').get_by_role('button', name='Approve').count(),
                                                                 card(pg, 'T2201').get_by_role('button', name='Reject').count()))

            print('\n— T2202: Employee Master gross-only change (no conveyance key) —')
            r2 = rows(card(pg, 'T2202'))
            check('rows = five + gross (no special: zero both sides)', FIVE + ['gross'], [x[0] for x in r2])
            check('conveyance ₹1,000 → ₹0 changed with note', ('₹1,000', '₹0', True, True), (r2[3][3], r2[3][4], r2[3][1], r2[3][5]))
            check('only conveyance carries the note', ['conveyance'], [x[0] for x in r2 if x[5]])
            check('note text', NOTE, card(pg, 'T2202').get_by_test_id('missing-note').first.inner_text().strip())
            check('basic ₹7,500 → ₹9,000 changed', ('₹7,500', '₹9,000', True), (r2[0][3], r2[0][4], r2[0][1]))
            check('DA ₹0 → ₹0 not changed', ('₹0', '₹0', False), (r2[1][3], r2[1][4], r2[1][1]))
            check('gross ₹15,000 → ₹18,000', ('₹15,000', '₹18,000', True), (r2[5][3], r2[5][4], r2[5][1]))
            check('decrease arrow ▼ on conveyance', True, '▼' in card(pg, 'T2202').locator('tr[data-component=conveyance]').inner_text())

            print('\n— T2203: Employee Master with special allowance —')
            r3 = rows(card(pg, 'T2203'))
            check('special allowance row shown', FIVE + ['special_allowance', 'gross'], [x[0] for x in r3])
            check('special ₹0 → ₹2,000 changed', ('₹0', '₹2,000', True), (r3[5][3], r3[5][4], r3[5][1]))
            check('other ₹3,500 → ₹2,000', ('₹3,500', '₹2,000'), (r3[4][3], r3[4][4]))

            print('\n— T2204: nothing changed —')
            r4 = rows(card(pg, 'T2204'))
            check('no row marked changed', [], [x[0] for x in r4 if x[1]])
            check('no amber rows', 0, card(pg, 'T2204').locator('tr.bg-amber-50').count())

            print('\n— legacy rows —')
            r5 = rows(card(pg, 'T2205'))
            check('T2205 NULL JSON: renders five + gross', FIVE + ['gross'], [x[0] for x in r5])
            check('T2205 Current all "—" (no old structure)', ['—'] * 5, [x[3] for x in r5[:5]])
            check('T2205 "No current structure on record"', 1, card(pg, 'T2205').get_by_test_id('no-current').count())
            check('T2205 every proposed component noted (approval writes 0)', 5, sum(1 for x in r5 if x[5]))
            r6 = rows(card(pg, 'T2206'))
            check('T2206 bad JSON: basic — → ₹8,000 changed', ('—', '₹8,000', True), (r6[0][3], r6[0][4], r6[0][1]))
            check('T2206 four notes (da, hra, conveyance, other)', ['da', 'hra', 'conveyance', 'other_allowances'], [x[0] for x in r6 if x[5]])
            r7 = rows(card(pg, 'T2207'))
            check('T2207 {} old: Current "—", proposed values shown', (['—'] * 5, ['₹8,000', '₹0', '₹3,200', '₹800', '₹4,000']),
                  ([x[3] for x in r7[:5]], [x[4] for x in r7[:5]]))
            check('T2207 DA ₹0 not marked changed (missing old = 0)', False, r7[1][1])
            check('T2207 no notes (all five keys present)', [], [x[0] for x in r7 if x[5]])
            check('every card has an effective note', 7, pg.get_by_test_id('effective-note').count())
            check('finance: 0 page errors', [], errs); check('finance: 0 console errors', [], cons); check('finance: 0 API ≥ 400', [], bad)

            print('\n— hr view: same table, still "Awaiting Finance approval" —')
            pgh, errsh, consh, badh = login(b, 'hr')
            open_pending(pgh)
            check('hr: change table on every card', 7, pgh.get_by_test_id('change-table').count())
            check('hr: Awaiting Finance approval', 1, card(pgh, 'T2201').get_by_text('Awaiting Finance approval').count())
            check('hr: 0 page errors', [], errsh); check('hr: 0 API ≥ 400', [], badh)

            print('\n— phone 390px —')
            pgp, errsp, consp, badp = login(b, 'finance', width=390)
            open_pending(pgp)
            sw = pgp.evaluate('document.documentElement.scrollWidth')
            check('390px: no sideways page scroll', True, sw <= 392)
            c1 = card(pgp, 'T2202')
            bx = c1.locator('tr[data-component=conveyance]').bounding_box()
            check('390px: conveyance row on screen', True, bx is not None and bx['x'] >= 0 and bx['x'] + 50 < 390)
            check('390px: Approve visible', True, c1.get_by_role('button', name='Approve').is_visible())
            check('390px: note visible', True, c1.get_by_test_id('missing-note').first.is_visible())
            if os.environ.get('SHOTS'):
                pgp.screenshot(path=os.environ['SHOTS'] + '/p1-22-390.png', full_page=True)
                pg.screenshot(path=os.environ['SHOTS'] + '/p1-22-1440.png', full_page=True)
            check('390px: 0 page errors', [], errsp); check('390px: 0 API ≥ 400', [], badp)

            print('\n— approval still works (approve T2201 in the UI) —')
            card(pg, 'T2201').get_by_role('button', name='Approve').click()
            pg.get_by_text('Salary change approved').first.wait_for(timeout=10000)
            check('DB: T2201 approved, conveyance 2000 / other 3500', ('Approved', 2000, 3500),
                  (q("SELECT status FROM salary_change_requests WHERE employee_code='T2201'")[0][0],
                   *q("SELECT s.conveyance, s.other_allowances FROM salary_structures s JOIN employees e ON e.id=s.employee_id "
                      "WHERE e.code='T2201' ORDER BY s.effective_from DESC, s.id DESC LIMIT 1")[0]))
            check('finance: 0 page errors after approve', [], errs)
            b.close()
finally:
    srv.terminate(); srv.wait()

print(f'\n{PASS} passed, {FAIL} failed')
sys.exit(1 if FAIL else 0)
