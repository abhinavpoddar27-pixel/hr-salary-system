#!/usr/bin/env python3
"""Finance Verification covers every company; one sign-off per month; latest decision wins (P1-13, finding F-4) — browser check.

Chromium against the BUILT dist, real finance + admin logins, scratch DATA_DIR, fictional data only (codes T913x,
names "TEST EMP n" — the repo is public). Seeds 4 salary rows for the CURRENT month: 2 in company A, 1 in company B,
1 with a blank company label (as production has).

Usage:
  python3 backend/scripts/finverify-company-scope-check.py               # this tree
  APP_ROOT=/tmp/wt python3 .../finverify-company-scope-check.py --base   # old tree: dead filter, stale "Approved" banner
Needs `npm run build --prefix frontend` in APP_ROOT first. PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers.
"""
import datetime, os, re, shutil, sqlite3, subprocess, sys, tempfile, time, urllib.request
from playwright.sync_api import sync_playwright

HERE_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
ROOT = os.path.abspath(os.environ.get('APP_ROOT', HERE_ROOT))
BASE_MODE = '--base' in sys.argv
PORT = int(os.environ.get('PORT', '3113')); BASE = f'http://127.0.0.1:{PORT}'
WORK = tempfile.mkdtemp(prefix='finverify-scope-'); DB = os.path.join(WORK, 'hr_system.db')
CA, CB = 'Asian Lakto Ind Ltd', 'Indriyan Beverages Pvt Ltd'
TODAY = datetime.date.today(); M, Y = TODAY.month, TODAY.year
PASS = FAIL = 0
ROWS = [('T9131', CA, 20000), ('T9132', CA, 15000), ('T9133', CB, 12000), ('T9134', '', 10000)]
GATE_SQL = "SELECT status FROM finance_month_signoff WHERE month = ? AND year = ? AND status = 'approved'"  # payroll.js /finalise


def check(label, expected, actual):
    global PASS, FAIL
    if expected == actual: PASS += 1; print(f'  ✓ {label}')
    else: FAIL += 1; print(f'  ✗ {label} — expected {expected!r}, got {actual!r}')


def q(sql, *a):
    c = sqlite3.connect(DB); r = c.execute(sql, a).fetchall(); c.close(); return r


def ex(sql, *a):
    c = sqlite3.connect(DB); c.execute(sql, a); c.commit(); c.close()


def seed():
    for i, (code, co, net) in enumerate(ROWS, 1):
        ex("INSERT OR IGNORE INTO employees(code,name,department,company,status,employment_type,gross_salary) "
           "VALUES(?,?,'TEST DEPT',?,'Active','Permanent',?)", code, f'TEST EMP {i}', co or 'Default', net)
        ex("INSERT INTO salary_computations(employee_code,month,year,company,payable_days,gross_salary,gross_earned,"
           "total_deductions,net_salary) VALUES(?,?,?,?,26,?,?,0,?)", code, M, Y, co, net, net, net)


def login(b, user='finance', pw='Finance@2025', width=1440):
    ctx = b.new_context(viewport={'width': width, 'height': 900})
    pg = ctx.new_page()
    errs, cons, bad = [], [], []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('console', lambda m: cons.append(m.text) if m.type == 'error' and 'vite.svg' not in m.text and '404' not in m.text and '403' not in m.text else None)
    pg.on('response', lambda r: bad.append(f'{r.status} {r.url}') if '/finance-verify/' in r.url and r.status >= 400 else None)
    pg.goto(BASE + '/login'); pg.get_by_placeholder('admin').fill(user); pg.get_by_placeholder('••••••••').fill(pw)
    pg.get_by_role('button', name='Sign in').click(); pg.wait_for_url(lambda u: '/login' not in u)
    goto_fv(pg)
    return pg, errs, cons, bad


def goto_fv(pg):
    pg.goto(BASE + '/finance-verification'); pg.wait_for_load_state('networkidle'); time.sleep(.8)


def kpi(pg, label):
    card = pg.locator('div.card', has=pg.get_by_text(label, exact=True)).first
    return card.locator('div').first.inner_text().strip()


def numbers(pg):
    return (kpi(pg, 'Total Employees'), kpi(pg, 'Total Net'), kpi(pg, 'Pending'))


def header_select(pg):
    # the old page had the CompanyFilter <select> (first option "All Companies") in the page header
    # (the global top bar keeps its own selector — not part of this page — so look inside the page header only)
    return pg.locator('h2.section-title').locator('xpath=../..').locator('select', has=pg.locator('option', has_text='All Companies'))


def sign(pg, decision):
    pg.get_by_role('button', name='Sign Off Month').click(); time.sleep(.5)
    if decision == 'approved':
        with pg.expect_response(lambda r: '/finance-verify/signoff' in r.url and r.request.method == 'POST') as rr:
            pg.get_by_role('button', name='Approve', exact=True).click()
    else:
        pg.get_by_placeholder('Rejection reason (required)...').fill('Synthetic rejection reason')
        with pg.expect_response(lambda r: '/finance-verify/signoff' in r.url and r.request.method == 'POST') as rr:
            pg.get_by_role('button', name='Reject', exact=True).click()
    time.sleep(1)
    return rr.value.status


def banner(pg):
    if pg.get_by_text(re.compile(r'^Approved by ')).count() or pg.get_by_text('salary can be finalised', exact=False).count():
        return 'approved'
    if pg.get_by_text(re.compile(r'Rejected by ')).count():
        return 'rejected'
    return 'none'


env = dict(os.environ, DATA_DIR=WORK, JWT_SECRET='x', PORT=str(PORT), NODE_ENV='production',
           ADMIN_PASSWORD='Admin@123', HR_PASSWORD='Indriyan@2025', FINANCE_PASSWORD='Finance@2025')
srv = subprocess.Popen(['node', f'{ROOT}/backend/server.js'], env=env, stdout=open(f'{WORK}/log', 'w'), stderr=subprocess.STDOUT)
try:
    for _ in range(80):
        try: urllib.request.urlopen(BASE + '/api/version', timeout=2); break
        except Exception: time.sleep(.5)
    seed()
    sql_total = q("SELECT COUNT(*), SUM(net_salary) FROM salary_computations WHERE month=? AND year=?", M, Y)[0]
    print(f'App root: {ROOT}  mode: {"BASE" if BASE_MODE else "fix"}  month {M}/{Y}  SQL all-companies {sql_total}')
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg, errs, cons, bad = login(b)
        before = numbers(pg)
        check('KPI Total Employees = SQL all-companies count', str(sql_total[0]), before[0])
        check('KPI Total Net shows the all-companies sum', True, '57,000' in before[1])
        if BASE_MODE:
            sel = header_select(pg)
            check('old: company filter present on the page', 1, sel.count())
            sel.select_option(CB); pg.wait_for_load_state('networkidle'); time.sleep(1)
            check('old: switching to company B changes no number', before, numbers(pg))
            check('old: approve', 200, sign(pg, 'approved'))
            pg.reload(); pg.wait_for_load_state('networkidle'); time.sleep(.8)
            check('old: reject after approve', 200, sign(pg, 'rejected'))
            pg.reload(); pg.wait_for_load_state('networkidle'); time.sleep(1)
            check('old: banner still says Approved after the reject', 'approved', banner(pg))
            check('old: two sign-off rows (NULL company never upserts)', 2, q("SELECT COUNT(*) FROM finance_month_signoff")[0][0])
            check('old: payroll gate still finds an approved row', True, bool(q(GATE_SQL, M, Y)))
        else:
            print('\n— no company filter; scope note —')
            check('no company <select> on the page', 0, header_select(pg).count())
            check('"All companies" chip shown', 'All companies', pg.get_by_test_id('finverify-scope-note').inner_text().strip())
            print('\n— a company chosen on another page changes nothing here —')
            pg.goto(BASE + '/pipeline/salary'); pg.wait_for_load_state('networkidle'); time.sleep(.8)
            other = pg.locator('select', has=pg.locator('option', has_text='All Companies'))
            if other.count():
                other.first.select_option(CB); time.sleep(.5)
                check('company B selected elsewhere', CB, other.first.input_value())
            goto_fv(pg)
            check('numbers unchanged with company B in the top bar', before, numbers(pg))
            print('\n— sign-off: one row, latest wins —')
            pg.get_by_role('button', name='Sign Off Month').click(); time.sleep(.5)
            mon = datetime.date(Y, M, 1).strftime('%B')
            check('modal line names all companies + month', f'This sign-off covers all companies for {mon} {Y}.',
                  pg.get_by_test_id('signoff-scope').inner_text().strip())
            pg.keyboard.press('Escape'); time.sleep(.3)
            check('approve → 200', 200, sign(pg, 'approved'))
            check('banner Approved at once', 'approved', banner(pg))
            check('payroll gate finds approved', True, bool(q(GATE_SQL, M, Y)))
            check('reject (right after, < 5 s) → 200', 200, sign(pg, 'rejected'))
            check('banner Rejected at once (no stale cache)', 'rejected', banner(pg))
            check('one sign-off row, company "" , rejected', [('', 'rejected')], q("SELECT company, status FROM finance_month_signoff"))
            check('payroll gate finds NO approved row', False, bool(q(GATE_SQL, M, Y)))
            pg.reload(); pg.wait_for_load_state('networkidle'); time.sleep(1)
            check('after reload banner still Rejected', 'rejected', banner(pg))
            print('\n— legacy NULL-company row replaced —')
            ex("DELETE FROM finance_month_signoff")
            ex("INSERT INTO finance_month_signoff(month,year,company,status,signed_by) VALUES(?,?,NULL,'approved','old')", M, Y)
            time.sleep(6)  # the row was written behind the page's back: let the GET's 5 s browser cache expire
            pg.reload(); pg.wait_for_load_state('networkidle'); time.sleep(.8)
            check('legacy NULL row read as approved (latest)', 'approved', banner(pg))
            check('reject over a legacy row → 200', 200, sign(pg, 'rejected'))
            check('legacy NULL row gone, one "" row rejected', [('', 'rejected')], q("SELECT COALESCE(company,'<NULL>'), status FROM finance_month_signoff"))
            check('0 page errors', [], errs)
            check('0 console errors', [], cons)
            check('0 finance-verify API ≥ 400', [], bad)
            print('\n— admin + phone width 390px —')
            pg, errs, cons, bad = login(b, 'admin', 'Admin@123', width=390)
            note = pg.get_by_test_id('finverify-scope-note'); bb = note.bounding_box()
            check('phone: note visible inside the viewport', True, bb is not None and bb['x'] >= 0 and bb['x'] + bb['width'] <= 390)
            check('phone: banner Rejected', 'rejected', banner(pg))
            check('phone: 0 page errors', [], errs)
            check('phone: 0 finance-verify API ≥ 400', [], bad)
        b.close()
finally:
    srv.terminate(); shutil.rmtree(WORK, ignore_errors=True)

print(f'\n{PASS} passed, {FAIL} failed')
sys.exit(1 if FAIL else 0)
