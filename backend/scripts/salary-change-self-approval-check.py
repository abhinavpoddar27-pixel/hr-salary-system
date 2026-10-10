#!/usr/bin/env python3
"""Salary Input → the requester never decides their own salary change (P1-23, finding F-3) — browser check.

Chromium against the BUILT dist, real logins (admin, a second admin "admin2", finance, hr), scratch DATA_DIR with
fictional data (codes T98xx, names "TEST EMP n" — the repo is public).

Flow (fix):
  admin raises a change through the Edit modal → Pending tab: Approve + Reject disabled, reason shown + tooltip;
  a direct API approve by admin → 403 SELF_APPROVAL, row still Pending; admin2 approves in the UI → applied,
  history "Approved by admin2"; admin raises a 2nd change, finance rejects it in the UI; hr raises a 3rd change →
  hr still sees "Awaiting Finance approval"; 390px phone shows the disabled buttons + reason.
Base (old code): admin raises and approves their own change in the UI — the bug.

Usage:
  python3 backend/scripts/salary-change-self-approval-check.py
  APP_ROOT=/tmp/wt python3 .../salary-change-self-approval-check.py --base
Needs `npm run build --prefix frontend` in APP_ROOT first. PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers.
"""
import os, re, shutil, sqlite3, subprocess, sys, tempfile, time, urllib.request
from playwright.sync_api import sync_playwright

HERE_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
ROOT = os.path.abspath(os.environ.get('APP_ROOT', HERE_ROOT))
BASE_MODE = '--base' in sys.argv
PORT = int(os.environ.get('PORT', '3123')); BASE = f'http://127.0.0.1:{PORT}'
WORK = tempfile.mkdtemp(prefix='sal-self-'); DB = os.path.join(WORK, 'hr_system.db')
C = 'Asian Lakto Ind Ltd'
SELF_TEXT = 'You raised this request — ask another finance or admin user to decide it.'
PW = {'admin': 'Admin@123', 'admin2': 'Admin@123', 'hr': 'Indriyan@2025', 'finance': 'Finance@2025'}
PASS = FAIL = 0


def check(label, expected, actual):
    global PASS, FAIL
    if expected == actual: PASS += 1; print(f'  ✓ {label}')
    else: FAIL += 1; print(f'  ✗ {label} — expected {expected!r}, got {actual!r}')


def q(sql, args=()):
    c = sqlite3.connect(DB); r = c.execute(sql, args).fetchall(); c.close(); return r


def seed():
    c = sqlite3.connect(DB)
    for i, code in enumerate(('T9801', 'T9802', 'T9803'), 1):
        c.execute("INSERT INTO employees(code,name,department,company,status,employment_type,gross_salary) "
                  "VALUES(?,?,'TEST DEPT',?,'Active','Permanent',15000)", (code, f'TEST EMP {i}', C))
        eid = c.execute('SELECT id FROM employees WHERE code=?', (code,)).fetchone()[0]
        c.execute("INSERT INTO salary_structures(employee_id,effective_from,gross_salary,basic,da,hra,conveyance,other_allowances) "
                  "VALUES(?, '2025-01-01', 15000, 7500, 0, 3000, 0, 4500)", (eid,))
    # a second admin, same password as admin (copy the seeded hash)
    h = c.execute("SELECT password_hash FROM users WHERE username='admin'").fetchone()[0]
    c.execute("INSERT INTO users(username,password_hash,role,is_active) VALUES('admin2',?,'admin',1)", (h,))
    try: c.execute("UPDATE users SET allowed_companies='*' WHERE username='admin2'")
    except Exception: pass
    c.commit(); c.close()


def login(b, user, width=1440):
    ctx = b.new_context(viewport={'width': width, 'height': 900})
    pg = ctx.new_page()
    errs, cons, bad = [], [], []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('console', lambda m: cons.append(m.text) if m.type == 'error' and 'vite.svg' not in m.text and 'status of 4' not in m.text else None)
    pg.on('response', lambda r: bad.append(f'{r.status} {r.request.method} {r.url}') if '/api/' in r.url and r.status >= 400 else None)
    pg.goto(BASE + '/login'); pg.get_by_placeholder('admin').fill(user); pg.get_by_placeholder('••••••••').fill(PW[user])
    pg.get_by_role('button', name='Sign in').click(); pg.wait_for_url(lambda u: '/login' not in u)
    return pg, errs, cons, bad


def goto_page(pg):
    pg.goto(BASE + '/salary-input'); pg.wait_for_load_state('networkidle'); time.sleep(.5)


def raise_change(pg, code, basic):
    goto_page(pg)
    row = pg.locator('tr', has_text=code).first
    row.get_by_role('button', name='Edit').click()
    pg.locator('label', has_text=re.compile('^Basic$')).locator('xpath=following-sibling::input').fill(str(basic))
    pg.get_by_placeholder('e.g., Annual increment, promotion...').fill('synthetic increment')
    pg.get_by_role('button', name='Submit for Approval').click()
    pg.get_by_text('submitted', exact=False).first.wait_for(timeout=10000)
    # server.js sends Cache-Control: private, max-age=5 on every GET and SalaryInput's reads don't send no-cache,
    # so a list fetched in the last 5 s is served stale (pre-existing, out of scope) — wait it out and reload.
    time.sleep(5.5); goto_page(pg)


def pending_card(pg, code):
    if '/salary-input' not in pg.url: goto_page(pg)
    pg.get_by_role('button', name=re.compile('^Pending Approvals')).click(); pg.wait_for_load_state('networkidle'); time.sleep(.8)
    c = pg.locator('div.card.border-l-4', has_text=f'({code})').first
    if os.environ.get('DEBUG'):
        pg.screenshot(path=os.environ['DEBUG'] + f'/pend-{code}.png', full_page=True)
        print('    cards:', pg.locator('div.card.border-l-4').count(), (pg.locator('main').inner_text()[:600]).replace('\n', ' | '))
    return c


def req_row(code):
    return q("SELECT id,status,requested_by,approved_by FROM salary_change_requests WHERE employee_code=? ORDER BY id DESC LIMIT 1", (code,))[0]


env = dict(os.environ, DATA_DIR=WORK, JWT_SECRET='x', PORT=str(PORT), NODE_ENV='production',
           ADMIN_PASSWORD=PW['admin'], HR_PASSWORD=PW['hr'], FINANCE_PASSWORD=PW['finance'])
srv = subprocess.Popen(['node', f'{ROOT}/backend/server.js'], env=env, stdout=open(f'{WORK}/log', 'w'), stderr=subprocess.STDOUT)
try:
    for _ in range(80):
        try: urllib.request.urlopen(BASE + '/api/version', timeout=2); break
        except Exception: time.sleep(.5)
    seed()
    print(f'App root: {ROOT}  mode: {"BASE (expect self-approval to succeed)" if BASE_MODE else "fix"}')

    with sync_playwright() as p:
        b = p.chromium.launch()
        if BASE_MODE:
            pg, errs, cons, bad = login(b, 'admin')
            raise_change(pg, 'T9801', 9000)
            card = pending_card(pg, 'T9801')
            appr = card.get_by_role('button', name='Approve')
            check('old code: requester sees Approve enabled', True, appr.is_enabled())
            appr.click(); pg.get_by_text('Salary change approved').first.wait_for(timeout=10000)
            rid, st, rb, ab = req_row('T9801')
            check('old code: admin approved their own request', ('Approved', 'admin', 'admin'), (st, rb, ab))
            check('old code: gross applied (16500)', 16500, q("SELECT gross_salary FROM employees WHERE code='T9801'")[0][0])
            b.close()
        else:
            print('\n— admin raises a change, cannot decide it —')
            pg, errs, cons, bad = login(b, 'admin')
            raise_change(pg, 'T9801', 9000)   # gross 15000 → 16500
            rid, st, rb, ab = req_row('T9801')
            check('request stored Pending, requested_by admin', ('Pending', 'admin'), (st, rb))
            card = pending_card(pg, 'T9801')
            appr = card.get_by_role('button', name='Approve'); rej = card.get_by_role('button', name='Reject')
            check('Approve disabled', False, appr.is_enabled())
            check('Reject disabled', False, rej.is_enabled())
            check('Approve tooltip = reason', SELF_TEXT, appr.get_attribute('title'))
            check('Reject tooltip = reason', SELF_TEXT, rej.get_attribute('title'))
            check('reason text shown', SELF_TEXT, card.get_by_test_id('self-decide-note').inner_text().strip())
            appr.click(force=True); rej.click(force=True); time.sleep(.8)
            check('forced clicks: no reject modal opened', 0, pg.get_by_text('This rejection will be archived').count())
            check('forced clicks: still Pending', 'Pending', req_row('T9801')[1])
            # direct API probe (stale screen / script): the server refuses too
            api = pg.evaluate("""async (id) => {
                const t = localStorage.getItem('hr_token');
                const r = await fetch('/api/salary-input/approve/' + id, { method: 'PUT', credentials: 'include',
                  headers: Object.assign({'Content-Type': 'application/json'}, t ? {Authorization: 'Bearer ' + t} : {}), body: '{}' });
                return [r.status, await r.json()];
            }""", rid)
            check('API approve by requester → 403 SELF_APPROVAL', [403, 'SELF_APPROVAL', SELF_TEXT], [api[0], api[1].get('code'), api[1].get('error')])
            check('after API probe: still Pending, gross 15000', ('Pending', 15000),
                  (req_row('T9801')[1], q("SELECT gross_salary FROM employees WHERE code='T9801'")[0][0]))
            bad_other = [x for x in bad if f'/approve/{rid}' not in x]
            check('admin: only the deliberate probe returned ≥ 400', [], bad_other)
            check('admin: 0 page errors', [], errs)
            check('admin: 0 console errors', [], cons)

            print('\n— admin2 (second admin) approves it —')
            pg2, errs2, cons2, bad2 = login(b, 'admin2')
            card = pending_card(pg2, 'T9801')
            appr = card.get_by_role('button', name='Approve')
            check('admin2: Approve enabled', True, appr.is_enabled())
            check('admin2: no self note', 0, card.get_by_test_id('self-decide-note').count())
            appr.click(); pg2.get_by_text('Salary change approved').first.wait_for(timeout=10000); time.sleep(.8)
            print('    note: card still listed right after approve (stale 5 s GET cache, pre-existing):',
                  pg2.locator('div.card.border-l-4', has_text='(T9801)').count())
            time.sleep(5.5); goto_page(pg2)
            pg2.get_by_role('button', name=re.compile('^Pending Approvals')).click(); pg2.wait_for_load_state('networkidle'); time.sleep(.8)
            check('admin2: card gone after reload', 0, pg2.locator('div.card.border-l-4', has_text='(T9801)').count())
            rid2, st, rb, ab = req_row('T9801')
            check('DB: Approved by admin2, raised by admin', ('Approved', 'admin', 'admin2'), (st, rb, ab))
            check('DB: gross applied 16500', 16500, q("SELECT gross_salary FROM employees WHERE code='T9801'")[0][0])
            pg2.get_by_role('button', name='Change History').click(); pg2.wait_for_load_state('networkidle'); time.sleep(.8)
            hr_row = pg2.locator('tr', has_text='T9801').first
            check('history row: Approved + admin2', (True, True), (hr_row.get_by_text('Approved', exact=True).count() > 0,
                                                                  hr_row.get_by_text('admin2', exact=True).count() > 0))
            check('admin2: 0 page errors', [], errs2); check('admin2: 0 console errors', [], cons2); check('admin2: 0 API ≥ 400', [], bad2)

            print('\n— admin raises again; finance rejects it —')
            raise_change(pg, 'T9802', 8000)
            pg3, errs3, cons3, bad3 = login(b, 'finance')
            card = pending_card(pg3, 'T9802')
            check('finance: Reject enabled', True, card.get_by_role('button', name='Reject').is_enabled())
            card.get_by_role('button', name='Reject').click()
            pg3.locator('textarea').last.fill('synthetic rejection')
            pg3.get_by_role('button', name='Reject', exact=True).last.click()
            pg3.get_by_text('Salary change rejected').first.wait_for(timeout=10000)
            check('DB: Rejected by finance', ('Rejected', 'admin', 'finance'), req_row('T9802')[1:])
            check('DB: gross unchanged 15000', 15000, q("SELECT gross_salary FROM employees WHERE code='T9802'")[0][0])
            check('finance: 0 page errors', [], errs3); check('finance: 0 API ≥ 400', [], bad3)

            print('\n— hr raises; hr still sees "Awaiting Finance approval" (unchanged) —')
            pg4, errs4, cons4, bad4 = login(b, 'hr')
            raise_change(pg4, 'T9803', 8500)
            card = pending_card(pg4, 'T9803')
            check('hr: no Approve button', 0, card.get_by_role('button', name='Approve').count())
            check('hr: Awaiting Finance approval', 1, card.get_by_text('Awaiting Finance approval').count())
            check('hr: 0 page errors', [], errs4); check('hr: 0 API ≥ 400', [], bad4)

            print('\n— phone 390px: admin sees hr\'s request decidable, raises one more and sees it locked —')
            pg5, errs5, cons5, bad5 = login(b, 'admin', width=390)
            card = pending_card(pg5, 'T9803')
            check('phone: admin can decide hr\'s request', True, card.get_by_role('button', name='Approve').is_enabled())
            card.get_by_role('button', name='Approve').click(); pg5.get_by_text('Salary change approved').first.wait_for(timeout=10000)
            raise_change(pg5, 'T9802', 9500)
            card = pending_card(pg5, 'T9802')
            check('phone: own request Approve disabled', False, card.get_by_role('button', name='Approve').is_enabled())
            check('phone: reason visible', True, card.get_by_test_id('self-decide-note').is_visible())
            check('phone: 0 page errors', [], errs5); check('phone: 0 API ≥ 400', [], bad5)
            b.close()
finally:
    srv.terminate(); shutil.rmtree(WORK, ignore_errors=True)

print(f'\n{PASS} passed, {FAIL} failed')
sys.exit(1 if FAIL else 0)
