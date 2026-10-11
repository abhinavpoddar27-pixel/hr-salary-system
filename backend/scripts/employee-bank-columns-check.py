#!/usr/bin/env python3
"""Employee Master → Salary Structure window: bank edits reach the NEFT file and the split survives a save
(P1-14, finding H-2) — browser check.

Chromium against the BUILT dist, a real hr login, scratch DATA_DIR with fictional data (codes T94xx, names
"TEST EMP n", made-up account numbers / IFSCs — the repo is public).

  T9411  both bank pairs = the old account; structure 40/25/5 %, special ₹900, other ₹1,250, conveyance ₹1,600,
         basic amount ₹12,345.67 (not gross × %) — the kind of row a save used to rewrite.
  T9412  account / IFSC only in the second pair (bank_account / ifsc), first pair '' — the window used to show
         it blank, a save wiped it, and the NEFT file left the person out.

Usage:
  python3 backend/scripts/employee-bank-columns-check.py                 # this tree's server + dist
  APP_ROOT=/path/to/base python3 .../employee-bank-columns-check.py --base   # records the old behaviour
Needs `npm run build --prefix frontend` in APP_ROOT first. PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers.
"""
import os, re, shutil, sqlite3, subprocess, sys, tempfile, time, urllib.request
from playwright.sync_api import sync_playwright

HERE_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
ROOT = os.path.abspath(os.environ.get('APP_ROOT', HERE_ROOT))
BASE_MODE = '--base' in sys.argv
PORT = int(os.environ.get('PORT', '3114')); BASE = f'http://127.0.0.1:{PORT}'
WORK = tempfile.mkdtemp(prefix='bank-cols-'); DB = os.path.join(WORK, 'hr_system.db')
C = 'Asian Lakto Ind Ltd'
OLD_ACCT, NEW_ACCT = '900000000111', '900000000222'
OLD_IFSC, NEW_IFSC = 'TEST0000111', 'test0000222'
B_ACCT, B_IFSC = '900000000333', 'TEST0000333'
PASS = FAIL = 0


def check(label, expected, actual):
    global PASS, FAIL
    if expected == actual: PASS += 1; print(f'  ✓ {label}')
    else: FAIL += 1; print(f'  ✗ {label} — expected {expected!r}, got {actual!r}')


def q(sql, args=()):
    c = sqlite3.connect(DB); c.row_factory = sqlite3.Row
    r = [dict(x) for x in c.execute(sql, args).fetchall()]; c.close(); return r


def seed():
    c = sqlite3.connect(DB)
    for i, (code, a, b, ia, ib, special) in enumerate([
        ('T9411', OLD_ACCT, OLD_ACCT, OLD_IFSC, OLD_IFSC, 900),
        ('T9412', '', B_ACCT, '', B_IFSC, 900),
        ('T9413', '900000000444', '900000000444', 'TEST0000444', 'TEST0000444', 1000),  # special % = 3.333…
    ], 1):
        cur = c.execute("INSERT INTO employees(code,name,department,company,status,employment_type,gross_salary,"
                        "account_number,bank_account,ifsc_code,ifsc,bank_name,date_of_joining) "
                        "VALUES(?,?,'TEST DEPT',?,'Active','Permanent',30000,?,?,?,?,'TEST BANK','2024-01-01')",
                        (code, f'TEST EMP {i}', C, a, b, ia, ib))
        c.execute("INSERT INTO salary_structures(employee_id,effective_from,gross_salary,basic,da,hra,conveyance,"
                  "special_allowance,other_allowances,basic_percent,hra_percent,da_percent,pf_wage_ceiling) "
                  "VALUES(?,'2025-01-01',30000,12345.67,1500,7500,1600,?,1250,40,25,5,15000)", (cur.lastrowid, special))
        c.execute("INSERT INTO salary_computations(employee_code,month,year,company,net_salary,salary_held) "
                  "VALUES(?,9,2026,?,25000,0)", (code, C))
    c.commit(); c.close()


def struct(code):
    r = q("SELECT ss.* FROM salary_structures ss JOIN employees e ON e.id = ss.employee_id WHERE e.code = ?", (code,))
    for x in r: x.pop('updated_at', None)
    return r


def bank(code):
    return q("SELECT account_number, bank_account, ifsc_code, ifsc FROM employees WHERE code = ?", (code,))[0]


def login(b, width=1440):
    ctx = b.new_context(viewport={'width': width, 'height': 900})
    pg = ctx.new_page()
    errs, cons, bad = [], [], []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('console', lambda m: cons.append(m.text) if m.type == 'error' and 'vite.svg' not in m.text and '404' not in m.text else None)
    pg.on('response', lambda r: bad.append(f'{r.status} {r.url}') if '/api/' in r.url and r.status >= 400 else None)
    pg.goto(BASE + '/login'); pg.get_by_placeholder('admin').fill('hr'); pg.get_by_placeholder('••••••••').fill('Indriyan@2025')
    pg.get_by_role('button', name='Sign in').click(); pg.wait_for_url(lambda u: '/login' not in u)
    return pg, errs, cons, bad


def open_window(pg, code):
    if '/employees' not in pg.url:
        pg.goto(BASE + '/employees'); pg.wait_for_load_state('networkidle')
    s = pg.get_by_placeholder('Search by name or code...')
    s.fill(''); s.fill(code); time.sleep(.6)
    row = pg.locator('tbody tr', has_text=code).first
    row.get_by_role('button', name='₹', exact=True).click()
    pg.get_by_text('Salary Structure —').wait_for(timeout=8000)
    time.sleep(.4)
    return pg.locator('div.max-w-xl').last


def field(win, label):
    return win.locator(f'xpath=.//label[normalize-space(text())="{label}"]/following-sibling::input[1]')


def read_form(win):
    return {k: field(win, k).input_value() for k in
            ['Basic %', 'HRA %', 'DA %', 'Special Allowance %', 'Other Allowance (₹)', 'Bank Account No.', 'IFSC Code']}


def save(win, pg):
    win.get_by_role('button', name='Save Structure').click()
    pg.get_by_text('Salary Structure —').wait_for(state='hidden', timeout=8000)
    time.sleep(.3)


def neft(pg):
    tok = pg.evaluate("localStorage.getItem('hr_token')")
    r = pg.request.get(f'{BASE}/api/reports/bank-salary-file', params={'month': '9', 'year': '2026', 'company': C, 'download': 'true'},
                       headers={'Authorization': f'Bearer {tok}', 'Cache-Control': 'no-cache'})
    assert r.status == 200, r.status
    return r.text()


env = dict(os.environ, DATA_DIR=WORK, JWT_SECRET='x', PORT=str(PORT), NODE_ENV='production',
           ADMIN_PASSWORD='Admin@123', HR_PASSWORD='Indriyan@2025', FINANCE_PASSWORD='Finance@2025')
srv = subprocess.Popen(['node', f'{ROOT}/backend/server.js'], env=env, stdout=open(f'{WORK}/log', 'w'), stderr=subprocess.STDOUT)
try:
    for _ in range(80):
        try: urllib.request.urlopen(BASE + '/api/version', timeout=2); break
        except Exception: time.sleep(.5)
    seed()
    print(f'App root: {ROOT}  mode: {"BASE (expect the old behaviour)" if BASE_MODE else "fix"}')
    s1_before, s2_before = struct('T9411'), struct('T9412')

    with sync_playwright() as p:
        b = p.chromium.launch()
        pg, errs, cons, bad = login(b)
        check('NEFT before: T9411 old account in the file', True, OLD_ACCT in neft(pg))

        win = open_window(pg, 'T9411')
        f = read_form(win)
        if BASE_MODE:
            check('old code: split opens as 50 / 20 (not the stored 40 / 25)', ('50', '20'), (f['Basic %'], f['HRA %']))
        else:
            check('T9411 opens with the stored split', {'Basic %': '40', 'HRA %': '25', 'DA %': '5',
                  'Special Allowance %': '3', 'Other Allowance (₹)': '1250'},
                  {k: f[k] for k in ['Basic %', 'HRA %', 'DA %', 'Special Allowance %', 'Other Allowance (₹)']})
            check('T9411 opens with the stored account / IFSC', (OLD_ACCT, OLD_IFSC), (f['Bank Account No.'], f['IFSC Code']))
        field(win, 'Bank Account No.').fill(NEW_ACCT)
        field(win, 'IFSC Code').fill(NEW_IFSC)
        save(win, pg)
        file_after = neft(pg)
        if BASE_MODE:
            check('old code: NEFT file still pays the OLD account', (True, False), (OLD_ACCT in file_after, NEW_ACCT in file_after))
            check('old code: structure rewritten by an untouched-split save', False, struct('T9411') == s1_before)
        else:
            check('T9411 DB: all four bank columns = new values (IFSC upper-cased)',
                  {'account_number': NEW_ACCT, 'bank_account': NEW_ACCT, 'ifsc_code': NEW_IFSC.upper(), 'ifsc': NEW_IFSC.upper()},
                  bank('T9411'))
            check('NEFT file has the new account + IFSC, not the old', (True, True, False),
                  (NEW_ACCT in file_after, NEW_IFSC.upper() in file_after, OLD_ACCT in file_after))
            check('T9411 structure byte-identical after the save', s1_before, struct('T9411'))
            win = open_window(pg, 'T9411')   # reopen at once (inside the server's 5 s GET cache)
            f2 = read_form(win)
            check('reopen: new account / IFSC shown', (NEW_ACCT, NEW_IFSC.upper()), (f2['Bank Account No.'], f2['IFSC Code']))
            check('reopen: same split', (f['Basic %'], f['HRA %'], f['DA %'], f['Special Allowance %'], f['Other Allowance (₹)']),
                  (f2['Basic %'], f2['HRA %'], f2['DA %'], f2['Special Allowance %'], f2['Other Allowance (₹)']))
            win.get_by_role('button', name='Cancel').click()

        # T9412 — account only in the second pair
        check('NEFT before: T9412 (first pair empty) in the file?', not BASE_MODE, B_ACCT in neft(pg))
        win = open_window(pg, 'T9412')
        f = read_form(win)
        if BASE_MODE:
            check('old code: T9412 window shows the account blank', '', f['Bank Account No.'])
            save(win, pg)
            check('old code: an untouched save WIPED bank_account', None, bank('T9412')['bank_account'])
        else:
            check('T9412 window shows the second-pair account / IFSC', (B_ACCT, B_IFSC), (f['Bank Account No.'], f['IFSC Code']))
            save(win, pg)
            check('T9412 after an untouched save: both pairs hold the account',
                  {'account_number': B_ACCT, 'bank_account': B_ACCT, 'ifsc_code': B_IFSC, 'ifsc': B_IFSC}, bank('T9412'))
            check('T9412 structure byte-identical', s2_before, struct('T9412'))
            check('T9412 in the NEFT file', True, B_ACCT in neft(pg))

            # edge: clear the account → both pairs NULL, person drops out of the NEFT file
            win = open_window(pg, 'T9412')
            field(win, 'Bank Account No.').fill('')
            save(win, pg)
            bk = bank('T9412')
            check('cleared account → both account columns NULL', (None, None), (bk['account_number'], bk['bank_account']))
            check('cleared account → not in the NEFT file', False, B_ACCT in neft(pg))

            # review F4: a long derived special % shows 2 decimals; an untouched save keeps the structure
            s3_before = struct('T9413')
            win = open_window(pg, 'T9413')
            check('T9413 special % shown to 2 decimals', '3.33', field(win, 'Special Allowance %').input_value())
            save(win, pg)
            check('T9413 untouched save: structure byte-identical (full % sent)', s3_before, struct('T9413'))
            check('T9413 untouched save: no bank audit row', 0,
                  q("SELECT COUNT(*) AS c FROM audit_log WHERE employee_code='T9413' AND stage='bank_details_change'")[0]['c'])
            check('T9411 edit wrote masked bank audit rows', [('account_number', '****0111', '****0222'), ('ifsc_code', '****0111', '****0222')],
                  [(r['field_name'], r['old_value'], r['new_value']) for r in
                   q("SELECT * FROM audit_log WHERE employee_code='T9411' AND stage='bank_details_change' ORDER BY id")])

            # phone width: the window opens and is usable
            pg2, errs2, cons2, bad2 = login(b, width=390)
            win = open_window(pg2, 'T9411')
            check('390 px: window shows the split', '40', field(win, 'Basic %').input_value())
            box = win.bounding_box()
            check('390 px: window fits the screen', True, box is not None and box['x'] >= 0 and box['x'] + box['width'] <= 390)
            errs += errs2; cons += cons2; bad += bad2

        check('0 page errors', [], errs)
        check('0 console errors', [], cons)
        check('0 API ≥ 400', [], bad)
        b.close()
finally:
    srv.terminate(); shutil.rmtree(WORK, ignore_errors=True)

print(f'\n{PASS} passed, {FAIL} failed')
sys.exit(1 if FAIL else 0)
