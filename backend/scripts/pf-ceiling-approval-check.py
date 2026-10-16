#!/usr/bin/env python3
"""N-PF — a PF wage ceiling change at the same gross goes to finance approval (owner ruling 16 Oct 2026),
plus F-6 (Employee Master shows "already pending" instead of "submitted").

Chromium against the BUILT dist, real logins, scratch DATA_DIR, fictional data only (T95xx, "Test Person A..").
Server restarted between role batches (login limiter 5 / 15 min per IP); the scratch DB survives restarts.

  T9501  ceiling only 15000 → 21000 (hr in the window), then a second save → "already pending"
  T9502  ceiling 21000 + Basic % 40 → ONE request
  T9503  gross 20000 → 24000 only → card without a ceiling row
  T9504  ceiling change raised by admin (API) → admin cannot decide it
Batches: A hr (window saves, toasts, DB) · B finance 1440 + 390 px (cards, approve T9501 in the UI) ·
C admin (self-approval note on T9504) + hr (window reopens with 21000).
--base (APP_ROOT=old checkout, built): ceiling written at once, no request, second gross save says "submitted".

Usage:
  PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers PORT=3502 python3 backend/scripts/pf-ceiling-approval-check.py
  APP_ROOT=/home/claude/wt-npf-base PORT=3502 python3 backend/scripts/pf-ceiling-approval-check.py --base
"""
import json, os, re, sqlite3, subprocess, sys, tempfile, time, urllib.request
from playwright.sync_api import sync_playwright

HERE_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
ROOT = os.path.abspath(os.environ.get('APP_ROOT', HERE_ROOT))
BASE_MODE = '--base' in sys.argv
PORT = int(os.environ.get('PORT', '3502')); BASE = f'http://127.0.0.1:{PORT}'
WORK = tempfile.mkdtemp(prefix='npf-'); DB = os.path.join(WORK, 'hr_system.db')
C = 'Asian Lakto Ind Ltd'
PW = {'admin': 'Admin@123', 'hr': 'Indriyan@2025', 'finance': 'Finance@2025'}
PASS = FAIL = 0
SUBMIT_CEIL = 'PF wage ceiling change submitted for finance approval'
ALREADY = 'already pending finance approval'


def check(label, expected, actual):
    global PASS, FAIL
    if expected == actual: PASS += 1; print(f'  ✓ {label}')
    else: FAIL += 1; print(f'  ✗ {label} — expected {expected!r}, got {actual!r}')


def q(sql, args=()):
    c = sqlite3.connect(DB); r = c.execute(sql, args).fetchall(); c.close(); return r


def latest(code):
    return q("SELECT s.gross_salary, s.basic_percent, s.pf_wage_ceiling FROM salary_structures s JOIN employees e ON e.id=s.employee_id "
             "WHERE e.code=? ORDER BY s.effective_from DESC, s.id DESC LIMIT 1", (code,))[0]


def npending(code):
    return q("SELECT COUNT(*) FROM salary_change_requests WHERE employee_code=? AND status='Pending'", (code,))[0][0]


def seed():
    c = sqlite3.connect(DB)
    for i, code in enumerate(['T9501', 'T9502', 'T9503', 'T9504']):
        c.execute("INSERT INTO employees(code,name,department,company,status,employment_type,gross_salary) "
                  "VALUES(?,?,'TEST DEPT',?,'Active','Permanent',20000)", (code, f'Test Person {"ABCD"[i]}', C))
        eid = c.execute('SELECT id FROM employees WHERE code=?', (code,)).fetchone()[0]
        c.execute("INSERT INTO salary_structures(employee_id,effective_from,gross_salary,basic,da,hra,conveyance,special_allowance,"
                  "other_allowances,basic_percent,hra_percent,da_percent,pt_applicable,pf_wage_ceiling) "
                  "VALUES(?, '2025-01-01', 20000, 10000, 0, 4000, 0, 0, 6000, 50, 20, 0, 1, 15000)", (eid,))
    c.commit(); c.close()


env = dict(os.environ, DATA_DIR=WORK, JWT_SECRET='x', PORT=str(PORT), NODE_ENV='production',
           ADMIN_PASSWORD=PW['admin'], HR_PASSWORD=PW['hr'], FINANCE_PASSWORD=PW['finance'])
srv = None


def start():
    global srv
    srv = subprocess.Popen(['node', f'{ROOT}/backend/server.js'], env=env, stdout=open(f'{WORK}/log', 'a'), stderr=subprocess.STDOUT)
    for _ in range(80):
        try: urllib.request.urlopen(BASE + '/api/version', timeout=2); return
        except Exception: time.sleep(.5)
    raise SystemExit('server did not start')


def stop():
    srv.terminate(); srv.wait()


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
    pg.on('console', lambda m: cons.append(m.text) if m.type == 'error' and 'vite.svg' not in m.text and '404' not in m.text else None)
    pg.on('response', lambda r: bad.append(f'{r.status} {r.request.method} {r.url}') if '/api/' in r.url and r.status >= 400 else None)
    pg.goto(BASE + '/login'); pg.get_by_placeholder('admin').fill(user); pg.get_by_placeholder('••••••••').fill(PW[user])
    pg.get_by_role('button', name='Sign in').click(); pg.wait_for_url(lambda u: '/login' not in u)
    return pg, errs, cons, bad


def open_window(pg, code):
    if '/employees' not in pg.url:
        pg.goto(BASE + '/employees'); pg.wait_for_load_state('networkidle')
    s = pg.get_by_placeholder('Search by name or code...')
    s.fill(''); s.fill(code); time.sleep(.6)
    pg.locator('tbody tr', has_text=code).first.get_by_role('button', name='₹', exact=True).click()
    pg.get_by_text('Salary Structure —').wait_for(timeout=8000)
    time.sleep(.4)
    return pg.locator('div.max-w-xl').last


def field(win, label):
    return win.locator(f'xpath=.//label[normalize-space(text())="{label}"]/following-sibling::input[1]')


def save_and_toast(win, pg):
    """Save; return (toast message, whether the toast shows the ℹ info icon)."""
    # dismiss earlier toasts so the one read below is this save's
    pg.evaluate("() => document.querySelectorAll('[role=status]').forEach(e => { const p = e.closest('[style]'); if (p) p.remove() })")
    win.get_by_role('button', name='Save Structure').click()
    pg.get_by_text('Salary Structure —').wait_for(state='hidden', timeout=8000)
    for _ in range(40):
        if pg.locator('[role=status]').count() > 0: break
        time.sleep(.1)
    t = pg.locator('[role=status]').first
    msg = t.inner_text().strip()
    info = t.evaluate("e => (e.parentElement ? e.parentElement.innerText : '').includes('ℹ')")
    time.sleep(.3)
    return msg, info


def open_pending(pg):
    pg.goto(BASE + '/salary-input'); pg.wait_for_load_state('networkidle'); time.sleep(.5)
    pg.get_by_role('button', name=re.compile('^Pending Approvals')).click(); pg.wait_for_load_state('networkidle'); time.sleep(.8)


def card(pg, code):
    return pg.locator('div.card.border-l-4', has_text=f'({code})').first


def ceil_row(cd):
    return cd.evaluate("""el => { const tr = el.querySelector('tr[data-component=pf_wage_ceiling]'); if (!tr) return null;
        const td = tr.querySelectorAll('td'); return [td[0].innerText.trim(), td[1].innerText.trim(), td[2].innerText.replace(/[▲▼]/g, '').trim()]; }""")


try:
    start(); seed()
    print(f'App root: {ROOT}  mode: {"BASE (old behaviour expected)" if BASE_MODE else "fix"}')
    with sync_playwright() as p:
        b = p.chromium.launch()

        print('\n— A. hr: Employee Master window —')
        pg, errs, cons, bad = login(b, 'hr')
        win = open_window(pg, 'T9501')
        check('window shows ceiling 15000', '15000', field(win, 'PF Wage Ceiling (₹)').input_value())
        field(win, 'PF Wage Ceiling (₹)').fill('21000')
        msg, info = save_and_toast(win, pg)
        if BASE_MODE:
            check('old: ceiling written at once', 21000, latest('T9501')[2])
            check('old: no request raised', 0, npending('T9501'))
            # F-6 old behaviour: a second request while one is pending still says "submitted"
            win = open_window(pg, 'T9503'); field(win, 'Gross Monthly Salary (₹)').fill('24000'); save_and_toast(win, pg)
            win = open_window(pg, 'T9503'); field(win, 'Gross Monthly Salary (₹)').fill('26000')
            msg2, _ = save_and_toast(win, pg)
            check('old: second save says "submitted" although nothing new was raised', True, 'submitted for finance approval' in msg2)
            b.close()
        else:
            check('toast: ceiling submitted for approval', True, SUBMIT_CEIL in msg)
            check('toast is a success toast (no ℹ)', False, info)
            check('DB: ceiling still 15000', 15000, latest('T9501')[2])
            check('DB: one pending request', 1, npending('T9501'))
            win = open_window(pg, 'T9501')
            check('window reopens with the in-force 15000', '15000', field(win, 'PF Wage Ceiling (₹)').input_value())
            field(win, 'PF Wage Ceiling (₹)').fill('25000')
            msg, info = save_and_toast(win, pg)
            check('F-6: second save says "already pending"', True, ALREADY in msg)
            check('F-6: not "submitted"', False, 'submitted' in msg)
            check('F-6: info toast (ℹ), not success', True, info)
            check('DB: still one pending, ceiling 15000', (1, 15000), (npending('T9501'), latest('T9501')[2]))

            win = open_window(pg, 'T9502')
            field(win, 'PF Wage Ceiling (₹)').fill('21000'); field(win, 'Basic %').fill('40')
            msg, _ = save_and_toast(win, pg)
            check('split + ceiling: one combined request', (True, 1), ('split and PF wage ceiling' in msg, npending('T9502')))
            check('DB: T9502 row unchanged', (20000, 50, 15000), latest('T9502'))

            win = open_window(pg, 'T9503'); field(win, 'Gross Monthly Salary (₹)').fill('24000')
            msg, _ = save_and_toast(win, pg)
            check('gross only: "Salary change submitted…"', True, msg.startswith('Salary change submitted for finance approval'))
            check('hr: 0 page errors', [], errs); check('hr: 0 console errors', [], cons); check('hr: 0 API ≥ 400', [], bad)
            stop(); start()

            st, r = api('PUT', '/api/employees/T9504/salary', token('admin'), {'gross_salary': 20000, 'basic_percent': 50,
                        'hra_percent': 20, 'da_percent': 0, 'special_allowance_percent': 0, 'other_allowance': 6000, 'pf_wage_ceiling': 18000})
            check('admin raises T9504 ceiling 18000 via API', (200, True), (st, r.get('pendingApproval')))

            print('\n— B. finance: pending cards —')
            pf, errsf, consf, badf = login(b, 'finance')
            open_pending(pf)
            check('4 pending cards', 4, pf.locator('div.card.border-l-4').count())
            check('T9501 ceiling row ₹15,000 → ₹21,000', ['PF wage ceiling', '₹15,000', '₹21,000'], ceil_row(card(pf, 'T9501')))
            check('T9501 ceiling row amber + ▲', (True, True), tuple(card(pf, 'T9501').locator('tr[data-component=pf_wage_ceiling]').evaluate(
                "e => [e.className.includes('bg-amber-50'), e.innerText.includes('▲')]")))
            check('T9502 ceiling row + basic changed', (['PF wage ceiling', '₹15,000', '₹21,000'], '1'),
                  (ceil_row(card(pf, 'T9502')), card(pf, 'T9502').locator('tr[data-component=basic]').get_attribute('data-changed')))
            check('T9503 gross-only: no ceiling row', None, ceil_row(card(pf, 'T9503')))
            check('T9504 ceiling row ₹15,000 → ₹18,000', ['PF wage ceiling', '₹15,000', '₹18,000'], ceil_row(card(pf, 'T9504')))
            pp, errsp, consp, badp = login(b, 'finance', width=390)
            open_pending(pp)
            check('390px: no sideways page scroll', True, pp.evaluate('document.documentElement.scrollWidth') <= 392)
            check('390px: ceiling row visible', True, card(pp, 'T9501').locator('tr[data-component=pf_wage_ceiling]').is_visible())
            check('390px: 0 page errors', [], errsp); check('390px: 0 API ≥ 400', [], badp)
            card(pf, 'T9501').get_by_role('button', name='Approve').click()
            pf.get_by_text('Salary change approved').first.wait_for(timeout=10000)
            check('DB: T9501 approved, ceiling 21000, gross 20000', ('Approved', 20000, 21000),
                  (q("SELECT status FROM salary_change_requests WHERE employee_code='T9501'")[0][0], latest('T9501')[0], latest('T9501')[2]))
            check('finance: 0 page errors', [], errsf); check('finance: 0 console errors', [], consf); check('finance: 0 API ≥ 400', [], badf)
            stop(); start()

            print('\n— C. admin cannot decide own request; hr sees the approved ceiling —')
            pa, errsa, consa, bada = login(b, 'admin')
            open_pending(pa)
            ca = card(pa, 'T9504')
            check('admin: own request → Approve disabled + note', (True, 1),
                  (ca.get_by_role('button', name='Approve').is_disabled(), ca.get_by_test_id('self-decide-note').count()))
            check('admin: can approve T9502 (raised by hr)', True, card(pa, 'T9502').get_by_role('button', name='Approve').is_enabled())
            check('admin: 0 page errors', [], errsa); check('admin: 0 API ≥ 400', [], bada)
            ph, errsh, consh, badh = login(b, 'hr')
            win = open_window(ph, 'T9501')
            check('hr window now shows 21000', '21000', field(win, 'PF Wage Ceiling (₹)').input_value())
            check('hr: 0 page errors', [], errsh); check('hr: 0 API ≥ 400', [], badh)
            b.close()
finally:
    if srv: stop()

print(f'\n{PASS} passed, {FAIL} failed')
sys.exit(1 if FAIL else 0)
