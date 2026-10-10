#!/usr/bin/env python3
"""Reports → Salary Register shows real values, not ₹0 (P1-02, finding H-1) — browser check.

Chromium against the BUILT dist, real hr + finance logins, scratch DATA_DIR with fictional data
(employee codes T95xx, names "TEST EMP n" — the repo is public). Seeds September 2026 salary rows:
a PF employee, an ESI employee, a PF+ESI employee, a held employee and one with neither.
Whole-rupee values so fmtINR (0 decimals) shows exactly the DB value.

Usage:
  python3 backend/scripts/salary-register-report-check.py               # this tree's server + dist
  APP_ROOT=/tmp/wt python3 .../salary-register-report-check.py --base   # another tree (e.g. origin/main):
                                                                         # records the old ₹0 cells + PT column
Needs `npm run build --prefix frontend` in APP_ROOT first. PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers.
"""
import csv, io, os, re, shutil, sqlite3, subprocess, sys, tempfile, time, urllib.request
from playwright.sync_api import sync_playwright

HERE_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
ROOT = os.path.abspath(os.environ.get('APP_ROOT', HERE_ROOT))
BASE_MODE = '--base' in sys.argv
PORT = int(os.environ.get('PORT', '3101')); BASE = f'http://127.0.0.1:{PORT}'
WORK = tempfile.mkdtemp(prefix='sal-reg-'); DB = os.path.join(WORK, 'hr_system.db')
C = 'Asian Lakto Ind Ltd'
PASS = FAIL = 0

# code, gross, days, basic_e, hra_e, gross_e, pf_ee, pf_er, esi_ee, total_ded, net, held
ROWS = [
    ('T9501', 30000, 26, 15000, 6000, 30000, 1800, 1800,   0, 1800, 28200, 0),  # PF only
    ('T9502', 18000, 24, 9000, 3600, 16615,    0,    0, 125,  125, 16490, 0),  # ESI only
    ('T9503', 20000, 26, 10000, 4000, 20000, 1200, 1200, 150, 1350, 18650, 0),  # PF + ESI
    ('T9504', 25000, 3,  1442,  577,  2885,  173,  173,   0,  173,  2712, 1),   # held
    ('T9505', 40000, 26, 20000, 8000, 40000,    0,    0,   0,  500, 39500, 0),  # neither (other ded.)
]
EXPECT_HEADER = ['Code', 'Name', 'Dept', 'Gross', 'Payable Days', 'Earned Basic', 'Earned HRA', 'Total Earned',
                 'EE PF', 'EE ESI', 'Total Ded.', 'Net Pay']


def check(label, expected, actual):
    global PASS, FAIL
    if expected == actual: PASS += 1; print(f'  ✓ {label}')
    else: FAIL += 1; print(f'  ✗ {label} — expected {expected!r}, got {actual!r}')


def rupees(txt):
    d = re.sub(r'[^0-9\-]', '', txt or '')
    return int(d) if d not in ('', '-') else None


def seed():
    c = sqlite3.connect(DB)
    for i, r in enumerate(ROWS, 1):
        code, gross, days, be, he, ge, pfe, pfr, esie, ded, net, held = r
        c.execute("INSERT OR IGNORE INTO employees(code,name,department,company,status,employment_type,gross_salary) "
                  "VALUES(?,?,'TEST DEPT',?,'Active','Permanent',?)", (code, f'TEST EMP {i}', C, gross))
        c.execute("INSERT INTO day_calculations(employee_code,month,year,company,total_payable_days) VALUES(?,9,2026,?,?)",
                  (code, C, days))
        c.execute("INSERT INTO salary_computations(employee_code,month,year,company,payable_days,gross_salary,basic_earned,"
                  "hra_earned,gross_earned,pf_employee,pf_employer,esi_employee,professional_tax,total_deductions,net_salary,"
                  "salary_held,hold_reason) VALUES(?,9,2026,?,?,?,?,?,?,?,?,?,0,?,?,?,?)",
                  (code, C, days, gross, be, he, ge, pfe, pfr, esie, ded, net, held, 'Test hold' if held else ''))
    c.commit(); c.close()


def login(b, user, pw, width=1440):
    ctx = b.new_context(viewport={'width': width, 'height': 900}, accept_downloads=True)
    pg = ctx.new_page()
    errs, cons, bad = [], [], []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('console', lambda m: cons.append(m.text) if m.type == 'error' and 'vite.svg' not in m.text and '404' not in m.text else None)
    pg.on('response', lambda r: bad.append(f'{r.status} {r.url}') if '/api/' in r.url and r.status >= 400 else None)
    pg.goto(BASE + '/login'); pg.get_by_placeholder('admin').fill(user); pg.get_by_placeholder('••••••••').fill(pw)
    pg.get_by_role('button', name='Sign in').click(); pg.wait_for_url(lambda u: '/login' not in u)
    return pg, errs, cons, bad


def open_register(pg):
    pg.goto(BASE + '/reports'); pg.wait_for_load_state('networkidle')
    pg.locator('select').filter(has=pg.locator('option', has_text='September')).first.select_option('9')
    pg.locator('select').filter(has=pg.locator('option', has_text='2026')).first.select_option('2026')
    pg.get_by_role('button', name=re.compile('^Salary Register')).click()
    pg.wait_for_load_state('networkidle'); time.sleep(1)
    sec = pg.locator('div.space-y-4', has=pg.get_by_role('heading', name=re.compile('^Salary Register'))).last
    sec.locator('table tbody tr').first.wait_for(timeout=15000)
    return sec


def table(sec):
    heads = [h.text_content().strip() for h in sec.locator('table thead th').all()]
    rows = {}
    for tr in sec.locator('table tbody > tr:not(.drill-down-row)').all():
        cells = [td.inner_text().strip() for td in tr.locator('td').all()]
        rows[cells[0].split()[-1]] = dict(zip(heads, cells))
    return heads, rows


def card_value(sec, label):
    return rupees(sec.locator('div.card', has=sec.page.get_by_text(label, exact=True)).first.locator('div.text-lg').inner_text())


env = dict(os.environ, DATA_DIR=WORK, JWT_SECRET='x', PORT=str(PORT), NODE_ENV='production',
           ADMIN_PASSWORD='Admin@123', HR_PASSWORD='Indriyan@2025', FINANCE_PASSWORD='Finance@2025')
srv = subprocess.Popen(['node', f'{ROOT}/backend/server.js'], env=env, stdout=open(f'{WORK}/log', 'w'), stderr=subprocess.STDOUT)
try:
    for _ in range(80):
        try: urllib.request.urlopen(BASE + '/api/version', timeout=2); break
        except Exception: time.sleep(.5)
    seed()
    print(f'App root: {ROOT}  mode: {"BASE (expect ₹0 cells)" if BASE_MODE else "fix"}')

    with sync_playwright() as p:
        b = p.chromium.launch()
        if BASE_MODE:
            pg, errs, cons, bad = login(b, 'hr', 'Indriyan@2025')
            sec = open_register(pg)
            heads, rows = table(sec)
            print('  headers:', heads)
            check('old code: PT column present', True, 'PT' in heads)
            check('old code: 11 columns', 11, len(heads))
            for code in ('T9501', 'T9502', 'T9503'):
                r = rows[code]
                check(f'old code: {code} Earned/EE PF/EE ESI/Net Pay all ₹0', [0, 0, 0, 0],
                      [rupees(r['Earned']), rupees(r['EE PF']), rupees(r['EE ESI']), rupees(r['Net Pay'])])
            check('old code: Gross Payroll card already right (server totals)', sum(r[5] for r in ROWS), card_value(sec, 'Gross Payroll'))
            b.close()
        else:
            for user, pw in (('hr', 'Indriyan@2025'), ('finance', 'Finance@2025')):
                print(f'\n— {user}: Salary Register Sep 2026 —')
                pg, errs, cons, bad = login(b, user, pw)
                sec = open_register(pg)
                heads, rows = table(sec)
                check(f'{user}: headers', ['Code', 'Name', 'Dept', 'Days', 'Gross', 'Earned', 'EE PF', 'EE ESI', 'Ded.', 'Net Pay'], heads)
                check(f'{user}: no PT column', False, 'PT' in heads)
                check(f'{user}: {len(ROWS)} rows', len(ROWS), len(rows))
                for code, gross, days, be, he, ge, pfe, pfr, esie, ded, net, held in ROWS:
                    r = rows.get(code, {})
                    check(f'{user}: {code} Gross/Earned/EE PF/EE ESI/Ded./Net = DB',
                          [gross, ge, pfe, esie, ded, net],
                          [rupees(r.get(k)) for k in ('Gross', 'Earned', 'EE PF', 'EE ESI', 'Ded.', 'Net Pay')])
                    check(f'{user}: {code} Days', str(days), r.get('Days'))
                sum_earned = sum(rupees(r['Earned']) for r in rows.values())
                sum_net_nh = sum(rupees(rows[x[0]]['Net Pay']) for x in ROWS if not x[11])
                check(f'{user}: Σ Earned = "Gross Payroll" card', sum_earned, card_value(sec, 'Gross Payroll'))
                check(f'{user}: Σ Net Pay (not held) = "Net Payroll" card', sum_net_nh, card_value(sec, 'Net Payroll'))
                check(f'{user}: Σ Ded. = "Total Deductions" card', sum(rupees(r['Ded.']) for r in rows.values()), card_value(sec, 'Total Deductions'))

                with pg.expect_download() as dl:
                    sec.get_by_role('button', name=re.compile('Export CSV')).click()
                data = open(dl.value.path(), encoding='utf-8').read()
                recs = list(csv.reader(io.StringIO(data)))
                check(f'{user}: CSV header', EXPECT_HEADER, recs[0])
                check(f'{user}: CSV rows', len(ROWS), len(recs) - 1)
                byc = {r[0]: dict(zip(recs[0], r)) for r in recs[1:]}
                r3 = byc.get('T9503', {})
                check(f'{user}: CSV every column non-empty (T9503)', [], [k for k in EXPECT_HEADER if r3.get(k, '') == ''])
                check(f'{user}: CSV T9503 values', ['10000', '4000', '20000', '1200', '150', '1350', '18650'],
                      [r3.get(k) for k in ('Earned Basic', 'Earned HRA', 'Total Earned', 'EE PF', 'EE ESI', 'Total Ded.', 'Net Pay')])

                sec.locator('table tbody > tr').first.locator('td').nth(1).click(); time.sleep(1.2)
                dd = sec.locator('tr.drill-down-row > td').first
                check(f'{user}: drill-down colspan', '10', dd.get_attribute('colspan'))
                tw = sec.locator('table').first.bounding_box()['width']; dw = dd.bounding_box()['width']
                check(f'{user}: drill-down spans full table width', True, abs(tw - dw) <= 2)
                check(f'{user}: 0 page errors', [], errs)
                check(f'{user}: 0 console errors', [], cons)
                check(f'{user}: 0 API ≥ 400', [], bad)

            print('\n— phone width 390px (hr) —')
            pg, errs, cons, bad = login(b, 'hr', 'Indriyan@2025', width=390)
            sec = open_register(pg)
            heads, rows = table(sec)
            check('phone: T9501 Net Pay = DB', 28200, rupees(rows['T9501']['Net Pay']))
            check('phone: 0 page errors', [], errs)
            b.close()
finally:
    srv.terminate(); shutil.rmtree(WORK, ignore_errors=True)

print(f'\n{PASS} passed, {FAIL} failed')
sys.exit(1 if FAIL else 0)
