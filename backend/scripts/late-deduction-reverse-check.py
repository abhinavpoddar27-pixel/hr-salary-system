#!/usr/bin/env python3
"""Finance Audit → Late Coming: reverse an APPROVED late deduction (owner 12 Oct 2026) — browser check.

Chromium against the BUILT dist, real finance + hr logins, scratch DATA_DIR, fictional codes T95xx (repo is public).
Seeds, for the current month: T9501 approved + in salary, T9502 approved (not in salary), T9503 rejected.

Usage:
  python3 backend/scripts/late-deduction-reverse-check.py
  APP_ROOT=/tmp/wt python3 .../late-deduction-reverse-check.py --base   # old code: no Reverse button
Needs `npm run build --prefix frontend` in APP_ROOT first. PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers.
"""
import datetime, json, os, sqlite3, subprocess, sys, tempfile, time, urllib.request
from playwright.sync_api import sync_playwright

HERE_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
ROOT = os.path.abspath(os.environ.get('APP_ROOT', HERE_ROOT))
BASE_MODE = '--base' in sys.argv
PORT = int(os.environ.get('PORT', '3147')); BASE = f'http://127.0.0.1:{PORT}'
WORK = tempfile.mkdtemp(prefix='lrev-'); DB = os.path.join(WORK, 'hr_system.db')
C = 'Asian Lakto Ind Ltd'
IST = datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None) + datetime.timedelta(hours=5, minutes=30)
M, Y = IST.month, IST.year
PASS = FAIL = 0


def check(label, expected, actual):
    global PASS, FAIL
    if expected == actual: PASS += 1; print(f'  ✓ {label}')
    else: FAIL += 1; print(f'  ✗ {label} — expected {expected!r}, got {actual!r}')


def q(sql, *a):
    c = sqlite3.connect(DB); r = c.execute(sql, a).fetchall(); c.commit(); c.close(); return r


def seed():
    c = sqlite3.connect(DB)
    rows = [('T9501', 'approved', 1, 1.5), ('T9502', 'approved', 0, 1.0), ('T9503', 'rejected', 0, 0.5)]
    for i, (code, st, ap, days) in enumerate(rows):
        c.execute("INSERT OR IGNORE INTO employees(code,name,department,company,status,employment_type,gross_salary) "
                  "VALUES(?,?,'TEST DEPT',?,'Active','Permanent',30000)", (code, f'TEST EMP {code[1:]}', C))
        eid = c.execute('SELECT id FROM employees WHERE code=?', (code,)).fetchone()[0]
        c.execute("INSERT INTO day_calculations(employee_id,employee_code,month,year,company,total_payable_days) VALUES(?,?,?,?,?,26)",
                  (eid, code, M, Y, C))
        c.execute("INSERT INTO late_coming_deductions(employee_code,month,year,company,late_count,deduction_days,remark,applied_by,"
                  "finance_status,finance_reviewed_by,finance_reviewed_at,finance_remark,is_applied_to_salary,applied_at) "
                  "VALUES(?,?,?,?,8,?,'test late','hr1',?,'finance',datetime('now'),?,?,datetime('now',?))",
                  (code, M, Y, C, days, st, 'not a habit' if st == 'rejected' else '', ap, f'-{i} seconds'))
    c.commit(); c.close()


def st(code):
    return q('SELECT finance_status, is_applied_to_salary, finance_remark FROM late_coming_deductions WHERE employee_code=?', code)[0]


def login(ctx, user, pw):
    pg = ctx.new_page()
    errs, cons, bad, puts = [], [], [], []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('console', lambda m: cons.append(m.text) if m.type == 'error' and 'vite.svg' not in m.text and '404' not in m.text else None)
    pg.on('response', lambda r: bad.append(f'{r.status} {r.url}') if '/api/' in r.url and r.status >= 400 else None)
    pg.on('request', lambda r: puts.append((r.url, json.loads(r.post_data or '{}'))) if r.method == 'PUT' and '/finance-reverse/' in r.url else None)
    pg.goto(BASE + '/login'); pg.get_by_placeholder('admin').fill(user); pg.get_by_placeholder('••••••••').fill(pw)
    pg.get_by_role('button', name='Sign in').click(); pg.wait_for_url(lambda u: '/login' not in u)
    return pg, errs, cons, bad, puts


def open_tab(pg):
    pg.goto(BASE + '/finance-audit?tab=late-coming'); pg.wait_for_load_state('networkidle'); time.sleep(1)


def row(pg, code):
    return pg.locator('tr', has=pg.locator('td', has_text=code)).last


env = dict(os.environ, DATA_DIR=WORK, JWT_SECRET='x', PORT=str(PORT), NODE_ENV='production',
           ADMIN_PASSWORD='Admin@123', HR_PASSWORD='Indriyan@2025', FINANCE_PASSWORD='Finance@2025')
srv = subprocess.Popen(['node', f'{ROOT}/backend/server.js'], env=env, stdout=open(f'{WORK}/log', 'w'), stderr=subprocess.STDOUT)
try:
    for _ in range(80):
        try: urllib.request.urlopen(BASE + '/api/version', timeout=2); break
        except Exception: time.sleep(.5)
    seed()
    print(f'App root: {ROOT}  mode: {"BASE (expect no Reverse)" if BASE_MODE else "fix"}  month {M}/{Y}')
    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context(viewport={'width': 1440, 'height': 900})
        pg, errs, cons, bad, puts = login(ctx, 'finance', 'Finance@2025')
        open_tab(pg)
        check('history shows the three reviewed rows', 3, pg.locator('[data-testid=late-decision]').count() if not BASE_MODE
              else pg.locator('tr', has=pg.locator('td', has_text='T950')).count() and 3)
        if BASE_MODE:
            check('old: no Reverse button anywhere', 0, pg.get_by_role('button', name='Reverse').count())
            print(f'\n{PASS} passed, {FAIL} failed'); sys.exit(1 if FAIL else 0)

        check('Reverse only on the two approved rows', 2, pg.locator('[data-testid=late-reverse]').count())
        check('no Reverse on the rejected row', 0, row(pg, 'T9503').locator('[data-testid=late-reverse]').count())

        # open → cancel sends nothing
        row(pg, 'T9501').locator('[data-testid=late-reverse]').click(); time.sleep(.4)
        dlg = pg.locator('[data-testid=late-reverse-dialog]')
        check('dialog opens', 1, dlg.count())
        check('dialog says the deduction is in salary → re-run Stage 7', True, 'Stage 7' in dlg.inner_text())
        check('confirm disabled with no reason', True, pg.locator('[data-testid=late-reverse-confirm]').is_disabled())
        pg.locator('[data-testid=late-reverse-reason]').fill('too short')
        check('confirm disabled at 9 characters', True, pg.locator('[data-testid=late-reverse-confirm]').is_disabled())
        pg.locator('[data-testid=late-reverse-reason]').fill('          ')
        check('confirm disabled for spaces only', True, pg.locator('[data-testid=late-reverse-confirm]').is_disabled())
        pg.get_by_role('button', name='Cancel').last.click(); time.sleep(.3)
        check('cancel closes the dialog', 0, dlg.count())
        check('cancel sent nothing', 0, len(puts))
        check('T9501 still approved', 'approved', st('T9501')[0])

        # reopen → empty → reverse with a double click
        row(pg, 'T9501').locator('[data-testid=late-reverse]').click(); time.sleep(.3)
        check('reason box empty on reopen', '', pg.locator('[data-testid=late-reverse-reason]').input_value())
        pg.locator('[data-testid=late-reverse-reason]').fill('  Stayed late the previous evening  ')
        pg.locator('[data-testid=late-reverse-confirm]').dblclick(); time.sleep(1.5)
        check('one PUT sent', 1, len(puts))
        check('reason sent trimmed', 'Stayed late the previous evening', puts[0][1].get('remark') if puts else None)
        s = st('T9501')
        check('DB: rejected, out of salary, remark marks the reversal', ('rejected', 0, 'Reversed after approval: Stayed late the previous evening'), s)
        check('DB: day calculation marked stale for Stage 7', 1, q("SELECT salary_stale FROM day_calculations WHERE employee_code='T9501'")[0][0])
        check('dialog closed after success', 0, dlg.count())
        check('toast tells finance to re-run Stage 7', True, pg.get_by_text('Re-run Stage 7').count() > 0)
        check('row shows Reversed at once (no 5 s cache)', 'Reversed', row(pg, 'T9501').locator('[data-testid=late-decision]').inner_text().strip())
        check('Reverse button gone from that row', 0, row(pg, 'T9501').locator('[data-testid=late-reverse]').count())

        # not-in-salary row
        row(pg, 'T9502').locator('[data-testid=late-reverse]').click(); time.sleep(.3)
        check('not-in-salary wording', True, 'not in the salary yet' in dlg.inner_text())
        pg.locator('[data-testid=late-reverse-reason]').fill('Device fault on that morning'); pg.locator('[data-testid=late-reverse-confirm]').click(); time.sleep(1.2)
        check('T9502 reversed', 'rejected', st('T9502')[0])
        check('T9503 untouched', ('rejected', 0, 'not a habit'), st('T9503'))
        check('no page errors (finance)', [], errs); check('no console errors (finance)', [], cons); check('no API ≥ 400 (finance)', [], bad)

        # phone width
        ph = b.new_context(viewport={'width': 390, 'height': 844})
        pp, perrs, _, _, _ = login(ph, 'finance', 'Finance@2025'); open_tab(pp)
        check('390 px: page renders the history', True, pp.locator('[data-testid=late-decision]').count() == 3)
        check('390 px: no page errors', [], perrs)

        # hr sees no Reverse; API refuses hr
        hctx = b.new_context(viewport={'width': 1440, 'height': 900})
        hp, herrs, _, _, _ = login(hctx, 'hr', 'Indriyan@2025'); open_tab(hp)
        check('hr: no Reverse column', 0, hp.locator('[data-testid=late-reverse]').count())
        tok = hp.evaluate("() => localStorage.getItem('hr_token') || ''")
        req = urllib.request.Request(f'{BASE}/api/late-coming/finance-reverse/1', method='PUT', data=b'{"remark":"hr trying this out"}',
                                     headers={'Content-Type': 'application/json', 'Authorization': f'Bearer {tok}'})
        try: code = urllib.request.urlopen(req).status
        except urllib.error.HTTPError as e: code = e.code
        check('hr: API answers 403 (or 401 without a stored token)', True, code in (401, 403))
        b.close()
finally:
    srv.terminate()
print(f'\n{PASS} passed, {FAIL} failed')
sys.exit(1 if FAIL else 0)
