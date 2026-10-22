#!/usr/bin/env python3
"""N-PF-LOWS — PF wage ceiling / split / gross input checks (planner rulings 22 Oct 2026).

Chromium against the BUILT dist, real hr login, scratch DATA_DIR, fictional data only (T96xx, "Test Person A..").

  T9601  ceiling 0 in the window          → error toast, window stays open, nothing saved (input has min/max)
  T9602  gross cleared + Basic % 40       → "Enter the gross salary…", window stays open, nothing saved
  T9603  pending request + Basic % 45     → info toast "…not saved… Bank and ID details were saved"
  T9604  ceiling 21000 (normal)           → "PF wage ceiling change submitted…" (no regression)
  T9605  gross cleared, bank only         → toast "Saved — bank and ID details", account saved
  API: ceiling 'abc' → 400 NOT_A_NUMBER; request-change negative → 400; request-change twice → alreadyPending.
  390 px: window fits, no sideways scroll.
--base (APP_ROOT=old checkout, built): ceiling 0 accepted, gross-blank split change "saved" with nothing raised,
pending message has no "not saved".

Usage:
  PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers PORT=3504 python3 backend/scripts/pf-ceiling-input-check.py
  APP_ROOT=/home/claude/wt-npflows-base PORT=3504 python3 backend/scripts/pf-ceiling-input-check.py --base
"""
import json, os, sqlite3, subprocess, sys, tempfile, time, urllib.error, urllib.request
from playwright.sync_api import sync_playwright

HERE_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
ROOT = os.path.abspath(os.environ.get('APP_ROOT', HERE_ROOT))
BASE_MODE = '--base' in sys.argv
PORT = int(os.environ.get('PORT', '3504')); BASE = f'http://127.0.0.1:{PORT}'
WORK = tempfile.mkdtemp(prefix='npflows-'); DB = os.path.join(WORK, 'hr_system.db')
C = 'Asian Lakto Ind Ltd'
PW = {'admin': 'Admin@123', 'hr': 'Indriyan@2025', 'finance': 'Finance@2025'}
CODES = ['T9601', 'T9602', 'T9603', 'T9604', 'T9605', 'T9606', 'T9607']
PASS = FAIL = 0


def check(label, expected, actual):
    global PASS, FAIL
    if expected == actual: PASS += 1; print(f'  ✓ {label}')
    else: FAIL += 1; print(f'  ✗ {label} — expected {expected!r}, got {actual!r}')


def q(sql, args=()):
    c = sqlite3.connect(DB); r = c.execute(sql, args).fetchall(); c.close(); return r


def state(code):
    """Everything a refused save must leave alone."""
    return (q("SELECT s.* FROM salary_structures s JOIN employees e ON e.id=s.employee_id WHERE e.code=? ORDER BY s.id", (code,)),
            q("SELECT gross_salary, account_number, bank_account FROM employees WHERE code=?", (code,)),
            q("SELECT id, new_structure FROM salary_change_requests WHERE employee_code=? ORDER BY id", (code,)))


def npending(code):
    return q("SELECT COUNT(*) FROM salary_change_requests WHERE employee_code=? AND status='Pending'", (code,))[0][0]


def seed():
    c = sqlite3.connect(DB)
    for i, code in enumerate(CODES):
        c.execute("INSERT INTO employees(code,name,department,company,status,employment_type,gross_salary) "
                  "VALUES(?,?,'TEST DEPT',?,'Active','Permanent',20000)", (code, f'Test Person {"ABCDEFG"[i]}', C))
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


def api(method, path, tok, body=None):
    req = urllib.request.Request(BASE + path, method=method, data=json.dumps(body or {}).encode(),
                                 headers={'Content-Type': 'application/json', 'Authorization': 'Bearer ' + tok})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b'{}')


def token(user):
    req = urllib.request.Request(BASE + '/api/auth/login', data=json.dumps({'username': user, 'password': PW[user]}).encode(),
                                 headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read())['token']


def window_body(**over):
    b = {'gross_salary': 20000, 'basic_percent': 50, 'hra_percent': 20, 'da_percent': 0, 'special_allowance_percent': 0,
         'other_allowance': 6000, 'pf_wage_ceiling': 15000}
    b.update(over); return b


def login(b, user, width=1440):
    ctx = b.new_context(viewport={'width': width, 'height': 900})
    pg = ctx.new_page()
    errs, cons, bad = [], [], []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('console', lambda m: cons.append(m.text) if m.type == 'error' and 'vite.svg' not in m.text and 'status of 4' not in m.text and not m.text.startswith('[API Error] /employees/T960') else None)
    pg.on('response', lambda r: bad.append(f'{r.status} {r.request.method} {r.url.split("/api/")[-1]}') if '/api/' in r.url and r.status >= 400 else None)
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


def clear_toasts(pg):
    pg.evaluate("() => document.querySelectorAll('[role=status]').forEach(e => { const p = e.closest('[style]'); if (p) p.remove() })")


def save(win, pg):
    """Save; return (toast text, window still open)."""
    clear_toasts(pg)
    win.get_by_role('button', name='Save Structure').click()
    for _ in range(60):
        if pg.locator('[role=status]').count() > 0: break
        time.sleep(.1)
    time.sleep(.5)
    msg = pg.locator('[role=status]').first.inner_text().strip() if pg.locator('[role=status]').count() else ''
    return msg, pg.get_by_text('Salary Structure —').count() > 0


def close_window(pg):
    if pg.get_by_text('Salary Structure —').count():
        pg.keyboard.press('Escape'); time.sleep(.3)
        if pg.get_by_text('Salary Structure —').count():
            pg.get_by_role('button', name='Cancel').last.click(); time.sleep(.3)


try:
    start(); seed()
    print(f'App root: {ROOT}  mode: {"BASE (old behaviour expected)" if BASE_MODE else "fix"}')
    hr_tok = token('hr')
    # T9603: a pending request raised first (gross change) through the API
    st, r = api('PUT', '/api/employees/T9603/salary', hr_tok, window_body(gross_salary=22000))
    check('setup: T9603 gross request pending', (200, 1), (st, npending('T9603')))

    with sync_playwright() as p:
        b = p.chromium.launch()
        print('\n— A. hr: Employee Master window (1440 px) —')
        pg, errs, cons, bad = login(b, 'hr')

        win = open_window(pg, 'T9601')
        before = state('T9601')
        inp = field(win, 'PF Wage Ceiling (₹)')
        if not BASE_MODE:
            check('ceiling input has min=1 max=100000', ('1', '100000'), (inp.get_attribute('min'), inp.get_attribute('max')))
        inp.fill('0')
        msg, still_open = save(win, pg)
        if BASE_MODE:
            check('old: ceiling 0 accepted (request raised)', 1, npending('T9601'))
        else:
            check('ceiling 0 → error toast names the range', True, 'more than ₹0 and at most ₹1,00,000' in msg)
            check('ceiling 0 → window stays open', True, still_open)
            check('ceiling 0 → nothing saved', before, state('T9601'))
        close_window(pg)

        win = open_window(pg, 'T9602')
        before = state('T9602')
        field(win, 'Gross Monthly Salary (₹)').fill(''); field(win, 'Basic %').fill('40')
        msg, still_open = save(win, pg)
        if BASE_MODE:
            check('old: gross blank + split change answered as saved, nothing raised', (False, 0), ('Enter the gross' in msg, npending('T9602')))
            check('old: window closed as if saved', False, still_open)
        else:
            check('gross blank + split → "Enter the gross salary…"', True, msg.startswith('Enter the gross salary'))
            check('gross blank + split → window stays open', True, still_open)
            check('gross blank + split → nothing saved', before, state('T9602'))
        close_window(pg)

        win = open_window(pg, 'T9603')
        field(win, 'Basic %').fill('45'); field(win, 'Bank Account No.').fill('555566667777')
        req_before = state('T9603')[2]
        msg, still_open = save(win, pg)
        if BASE_MODE:
            check('old: pending message does not say "not saved"', False, 'not saved' in msg)
        else:
            check('pending + split → "…new salary values were not saved"', True, 'new salary values were not saved' in msg)
            check('pending + split → says bank/ID details were saved', True, 'Bank and ID details were saved' in msg)
            check('pending request untouched', req_before, state('T9603')[2])
            check('window closed (save of bank/IDs went through)', False, still_open)
            check('bank account saved while pending', '555566667777', state('T9603')[1][0][1])

        if not BASE_MODE:
            win = open_window(pg, 'T9604')
            field(win, 'PF Wage Ceiling (₹)').fill('21000')
            msg, _ = save(win, pg)
            check('normal ceiling change → submitted for approval', True, 'PF wage ceiling change submitted for finance approval' in msg)
            check('normal ceiling change → one pending request', 1, npending('T9604'))

            win = open_window(pg, 'T9605')
            field(win, 'Gross Monthly Salary (₹)').fill('')
            field(win, 'Bank Account No.').fill('121234343434')
            msg, still_open = save(win, pg)
            check('bank-only save with blank gross → "Saved — bank and ID details"', 'Saved — bank and ID details', msg)
            check('bank-only save → account stored', '121234343434', state('T9605')[1][0][1])
            check('bank-only save → no request, structure unchanged', (0, 1), (npending('T9605'), len(state('T9605')[0])))

            expected_bad = ['400 PUT employees/T9601/salary', '400 PUT employees/T9602/salary']
            check('hr: 0 page errors', [], errs)
            check('hr: 0 console errors (other than the two intended 400s)', [], cons)
            check('hr: only the two intended 400s', expected_bad, bad)

            print('\n— B. 390 px —')
            pm, errsm, consm, badm = login(b, 'hr', width=390)
            win = open_window(pm, 'T9606')
            check('390 px: no sideways page scroll', True, pm.evaluate('document.documentElement.scrollWidth') <= 392)
            check('390 px: ceiling input visible', True, field(win, 'PF Wage Ceiling (₹)').is_visible())
            check('390 px: 0 page errors / 0 API ≥ 400', ([], []), (errsm, badm))
        b.close()

    if not BASE_MODE:
        print('\n— C. API probes —')
        stop(); start(); hr_tok = token('hr')
        st, r = api('PUT', '/api/employees/T9606/salary', hr_tok, window_body(pf_wage_ceiling='abc'))
        check("PUT ceiling 'abc' → 400 NOT_A_NUMBER", (400, 'NOT_A_NUMBER'), (st, r.get('code')))
        st, r = api('PUT', '/api/employees/T9606/salary', hr_tok, window_body(gross_salary='abc'))
        check("PUT gross 'abc' → 400 NOT_A_NUMBER", (400, 'NOT_A_NUMBER'), (st, r.get('code')))
        st, r = api('POST', '/api/salary-input/request-change', hr_tok, {'employeeCode': 'T9607', 'newStructure': {'basic': -1}})
        check('request-change basic −1 → 400', (400, 'SPLIT_OUT_OF_RANGE', 0), (st, r.get('code'), npending('T9607')))
        ns = {'basic': 11000, 'da': 0, 'hra': 4000, 'conveyance': 0, 'other_allowances': 5000}
        st1, r1 = api('POST', '/api/salary-input/request-change', hr_tok, {'employeeCode': 'T9607', 'newStructure': ns, 'reason': 't'})
        st2, r2 = api('POST', '/api/salary-input/request-change', hr_tok, {'employeeCode': 'T9607', 'newStructure': dict(ns, basic=12000), 'reason': 't'})
        check('request-change: first 200, second alreadyPending + notSaved, one request',
              (200, None, 200, True, True, 1), (st1, r1.get('alreadyPending'), st2, r2.get('alreadyPending'), r2.get('notSaved'), npending('T9607')))

    print('\n— D. drift control (scratch DB) —')
    drift = q("SELECT COUNT(*) FROM salary_computations WHERE ABS(net_salary-(gross_earned-total_deductions))>1")[0][0]
    check('drift rows = 0', 0, drift)
finally:
    if srv: stop()

print(f'\n{PASS} passed, {FAIL} failed')
sys.exit(1 if FAIL else 0)
