#!/usr/bin/env python3
"""Sales → Compute → Export Bank NEFT: paid rows left out + confirm ALWAYS shown (P1-03) — browser check.

Chromium against the BUILT dist, real hr login, scratch DATA_DIR with fictional data only (codes S9xx,
names "TEST REP n", bank numbers 9100…, IFSC TEST0000001 — the repo is public).
  Oct 2026: 3 computed + 2 reviewed + 2 finalized (one already NEFT-exported) + 1 paid + 1 hold
            + 1 computed with no IFSC  → file N = 7, not finalized 5, earlier file 1, paid 1, no bank 1.
  Nov 2026: 2 computed + 1 paid, everyone with bank details → the case that used to skip the confirm.

Usage:
  python3 backend/scripts/sales-neft-confirm-check.py                  # this tree's server + dist
  APP_ROOT=/tmp/base python3 .../sales-neft-confirm-check.py --base    # another tree (e.g. origin/main):
                                                                       # expects paid row in file + no confirm
Needs `npm run build --prefix frontend` in APP_ROOT first. PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers.
"""
import os, sqlite3, subprocess, sys, tempfile, time, urllib.request, json
from playwright.sync_api import sync_playwright

HERE_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
ROOT = os.path.abspath(os.environ.get('APP_ROOT', HERE_ROOT))
BASE_MODE = '--base' in sys.argv
PORT = int(os.environ.get('PORT', '3103')); BASE = f'http://127.0.0.1:{PORT}'
WORK = tempfile.mkdtemp(prefix='sales-neft-'); DB = os.path.join(WORK, 'hr_system.db')
CO = 'Indriyan Beverages Pvt Ltd'
PAID_STAMP = '2026-10-02 10:00:00'
PASS = FAIL = 0


def check(label, expected, actual):
    global PASS, FAIL
    if expected == actual: PASS += 1; print(f'  ✓ {label}')
    else: FAIL += 1; print(f'  ✗ {label} — expected {expected!r}, got {actual!r}')


ROWS = [  # code, month, status, net, has_ifsc, stamp
    ('S901', 10, 'computed', 15000.50, True, None),
    ('S902', 10, 'computed', 14000, True, None),
    ('S903', 10, 'computed', 13000, True, None),
    ('S904', 10, 'reviewed', 12000, True, None),
    ('S905', 10, 'reviewed', 11000, True, None),
    ('S906', 10, 'finalized', 10000, True, None),
    ('S907', 10, 'finalized', 9000, True, '2026-10-05 09:00:00'),
    ('S908', 10, 'paid', 20000, True, PAID_STAMP),
    ('S909', 10, 'hold', 8000, True, None),
    ('S910', 10, 'computed', 7000, False, None),
    ('S921', 11, 'computed', 16000, True, None),
    ('S922', 11, 'computed', 17000, True, None),
    ('S923', 11, 'paid', 18000, True, PAID_STAMP),
]
FILE_OCT = ['S901', 'S902', 'S903', 'S904', 'S905', 'S906', 'S907']
SUM_OCT = 15000.50 + 14000 + 13000 + 12000 + 11000 + 10000 + 9000


def seed():
    c = sqlite3.connect(DB)
    for i, (code, m, st, net, ifsc, stamp) in enumerate(ROWS, 1):
        c.execute("INSERT OR IGNORE INTO sales_employees(code,name,company,status,doj,account_no,ifsc) VALUES(?,?,?,'Active','2025-01-15',?,?)",
                  (code, f'TEST REP {i:02d}', CO, f'9100{code[1:]}', 'TEST0000001' if ifsc else None))
        c.execute("INSERT INTO sales_salary_computations(employee_code,month,year,company,days_given,total_days,calendar_days,earned_ratio,"
                  "gross_monthly,gross_earned,total_deductions,net_salary,status,hold_reason,neft_exported_at) "
                  "VALUES(?,?,2026,?,25,29,31,0.93,?,?,0,?,?,?,?)",
                  (code, m, CO, net, net, net, st, 'test hold' if st == 'hold' else None, stamp))
    c.commit(); c.close()


def db_state(month):
    c = sqlite3.connect(DB)
    st = dict(c.execute('SELECT employee_code, neft_exported_at FROM sales_salary_computations WHERE month=?', (month,)).fetchall())
    aud = c.execute("SELECT COUNT(*) FROM audit_log WHERE action_type='neft_export'").fetchone()[0]
    c.close(); return st, aud


def login(ctx):
    pg = ctx.new_page()
    errs, cons, bad = [], [], []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('console', lambda m: cons.append(m.text) if m.type == 'error' and 'vite.svg' not in m.text and '404' not in m.text else None)
    pg.on('response', lambda r: bad.append(f'{r.status} {r.url}') if '/api/' in r.url and r.status >= 400 else None)
    pg.goto(BASE + '/login'); pg.get_by_placeholder('admin').fill('hr'); pg.get_by_placeholder('••••••••').fill('Indriyan@2025')
    pg.get_by_role('button', name='Sign in').click(); pg.wait_for_url(lambda u: '/login' not in u)
    return pg, errs, cons, bad


def open_month(pg, month, collapsed=False):
    # collapsed=True on a phone: an open sidebar overlays the page (as for a real user who closes it)
    store = {'state': {'selectedMonth': month, 'selectedYear': 2026, 'selectedCompany': CO, 'sidebarCollapsed': collapsed}, 'version': 0}
    pg.evaluate("s => localStorage.setItem('hr-system-store', s)", json.dumps(store))
    pg.goto(BASE + '/sales/compute'); pg.wait_for_load_state('networkidle'); time.sleep(.5)
    # The app clears selectedCompany at login; pick it in the page's company filter like a user would.
    pg.locator('select', has=pg.locator('option', has_text='All Companies')).first.select_option(CO)
    # …and the month in the page's month picker (the store can be rewritten by the page we came from).
    pg.locator('select').filter(has=pg.locator('option', has_text='September')).first.select_option(str(month))
    pg.wait_for_load_state('networkidle'); time.sleep(1)
    sub = pg.locator('p.section-subtitle').first.inner_text()
    assert sub.startswith(('Oct 2026', 'Nov 2026')[month - 10]) and CO in sub, f'page not on {month}/2026 {CO}: {sub!r}'


def modal(pg):
    return pg.locator('div.fixed.inset-0', has=pg.locator('h3'))


def csv_rows(path):
    with open(path, encoding='utf-8') as f: return f.read().split('\n')


env = dict(os.environ, DATA_DIR=WORK, JWT_SECRET='x', PORT=str(PORT), NODE_ENV='production',
           ADMIN_PASSWORD='Admin@123', HR_PASSWORD='Indriyan@2025', FINANCE_PASSWORD='Finance@2025')
srv = subprocess.Popen(['node', f'{ROOT}/backend/server.js'], env=env, stdout=open(f'{WORK}/log', 'w'), stderr=subprocess.STDOUT)
try:
    for _ in range(80):
        try: urllib.request.urlopen(BASE + '/api/version', timeout=2); break
        except Exception: time.sleep(.5)
    seed()
    print(f'App root: {ROOT}  mode: {"BASE (expect paid row + no confirm)" if BASE_MODE else "fix"}')

    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context(viewport={'width': 1440, 'height': 900}, accept_downloads=True)
        pg, errs, cons, bad = login(ctx)

        if BASE_MODE:
            open_month(pg, 11)
            with pg.expect_download(timeout=10000) as dl:
                pg.get_by_role('button', name='Export Bank NEFT').click()
            rows = csv_rows(dl.value.path())
            check('old code: Nov downloads with NO confirm window', 0, modal(pg).count())
            check('old code: the paid row (S923) is in the file again', True, any('9100923' in r for r in rows))
            check('old code: file lines = 3 (2 computed + 1 paid)', 3, len(rows) - 1)
            time.sleep(1)
            st, aud = db_state(11)
            check('old code: paid row re-stamped', True, st['S923'] != PAID_STAMP)
            check('old code: one NEFT audit row', 1, aud)
        else:
            prev_hdrs = []
            pg.on('request', lambda r: prev_hdrs.append(r.headers.get('cache-control')) if '/export/bank-neft' in r.url and 'download=true' not in r.url else None)
            print('\n— Oct: confirm with counts, ₹ and status mix —')
            open_month(pg, 10)
            st0, aud0 = db_state(10)
            pg.get_by_role('button', name='Export Bank NEFT').click(); time.sleep(1)
            m = modal(pg)
            check('confirm window shown', 1, m.count())
            check('title', 'Download bank (NEFT) file?', m.locator('h3').inner_text().strip())
            check('summary "7 people · ₹84,000.50"', '7 people · ₹84,000.50', m.get_by_test_id('neft-summary').inner_text().strip())
            line = lambda k: m.locator(f'li[data-k="{k}"]').inner_text().strip() if m.locator(f'li[data-k="{k}"]').count() else None
            check('line: not finalized', '5 not finalized yet (computed or reviewed)', line('nf'))
            check('line: earlier file', '1 were already in an earlier NEFT file for this month — check the bank has not paid them', line('ae'))
            check('line: paid left out', '1 marked paid — left out (₹20,000.00)', line('pd'))
            check('line: no bank details', '1 have no bank account or IFSC — left out', line('mb'))
            check('missing table lists S910', True, m.locator('td', has_text='S910').count() == 1)
            check('no held count shown (ruling Q2)', 0, m.get_by_text('hold', exact=False).count())
            check('button "Download NEFT (7 rows)"', 1, m.get_by_role('button', name='Download NEFT (7 rows)').count())

            print('\n— Cancel: nothing downloaded, nothing stamped —')
            got = []
            pg.on('download', lambda d: got.append(d))
            m.get_by_role('button', name='Cancel').click(); time.sleep(1)
            st1, aud1 = db_state(10)
            check('window closed', 0, modal(pg).count())
            check('no download', 0, len(got))
            check('no stamps changed', st0, st1)
            check('no NEFT audit row', aud0, aud1)

            print('\n— Download: CSV rows = N, paid row absent, only file rows stamped —')
            pg.get_by_role('button', name='Export Bank NEFT').click(); time.sleep(1)
            with pg.expect_download(timeout=10000) as dl:
                modal(pg).get_by_role('button', name='Download NEFT (7 rows)').click()
            rows = csv_rows(dl.value.path())
            check('header = plant bank header', 'Sr No,Beneficiary Name,Account Number,IFSC Code,Date of Joining,Amount,Narration', rows[0])
            check('data lines = 7', 7, len(rows) - 1)
            check('paid row S908 absent', False, any('9100908' in r for r in rows))
            check('hold S909 absent', False, any('9100909' in r for r in rows))
            check('Σ amounts = ₹84,000.50', round(SUM_OCT, 2), round(sum(float(r.split(',')[-2]) for r in rows[1:]), 2))
            time.sleep(1)
            st2, aud2 = db_state(10)
            check('file rows stamped', True, all(st2[c] for c in FILE_OCT))
            check('paid row stamp untouched', PAID_STAMP, st2['S908'])
            check('hold + no-bank rows unstamped', [None, None], [st2['S909'], st2['S910']])
            check('one NEFT audit row', aud0 + 1, aud2)
            check('window closed after download', 0, modal(pg).count())

            print('\n— user sim: re-open right away (lost file) —')
            pg.get_by_role('button', name='Export Bank NEFT').click(); time.sleep(1)
            check('earlier-file line now 7 (no stale 5 s cache)', '7 were already in an earlier NEFT file for this month — check the bank has not paid them', line('ae'))
            modal(pg).get_by_role('button', name='Cancel').click(); time.sleep(.5)

            print('\n— Nov: no missing bank details → confirm STILL shown (used to download straight away) —')
            open_month(pg, 11)
            got.clear()
            pg.get_by_role('button', name='Export Bank NEFT').click(); time.sleep(1)
            m = modal(pg)
            check('confirm window shown', 1, m.count())
            check('no download before confirming', 0, len(got))
            check('summary "2 people · ₹33,000.00"', '2 people · ₹33,000.00', m.get_by_test_id('neft-summary').inner_text().strip())
            check('paid line', '1 marked paid — left out (₹18,000.00)', line('pd'))
            check('no missing-bank table', 0, m.locator('table').count())
            with pg.expect_download(timeout=10000) as dl:
                m.get_by_role('button', name='Download NEFT (2 rows)').click()
            rows = csv_rows(dl.value.path())
            check('Nov file lines = 2, paid S923 absent', (2, False), (len(rows) - 1, any('9100923' in r for r in rows)))

            print('\n— 390px phone —')
            pg.set_viewport_size({'width': 390, 'height': 800})
            open_month(pg, 11, collapsed=True)
            pg.get_by_role('button', name='Export Bank NEFT').click(); time.sleep(1)
            m = modal(pg)
            box = m.locator('div.bg-white').first.bounding_box()
            check('window fits the screen width', True, box is not None and box['x'] >= 0 and box['x'] + box['width'] <= 390)
            check('Download button visible', True, m.get_by_role('button', name='Download NEFT (2 rows)').is_visible())
            m.get_by_role('button', name='Cancel').click()

            check('every preview request sends Cache-Control: no-cache (ruling Q1)', True, len(prev_hdrs) >= 4 and all(h == 'no-cache' for h in prev_hdrs))
            check('0 page errors', [], errs)
            check('0 console errors', [], cons)
            check('0 API ≥ 400', [], bad)
        b.close()
except Exception:
    import traceback; traceback.print_exc(); FAIL += 1
finally:
    srv.terminate()
    print(f'\n{PASS} passed, {FAIL} failed')
    sys.exit(1 if FAIL else 0)
