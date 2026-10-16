#!/usr/bin/env python3
"""F151 — N-MONEY2 follow-ups F-2 (Reverted badge in Salary Input history) and F-3 (Extra Duty bulk
finance-approve says what it skipped; single approve failure = one toast).

Chromium against the BUILT dist, real finance login, scratch DATA_DIR, fictional data only
(T95xx, "Test Person A.."). Skipped rows are produced the real way: the page is loaded, then the
grants change state in the DB behind its back (another user decided them), then finance clicks.

Usage:
  PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers PORT=3502 python3 backend/scripts/n-money2-followups-check.py
  APP_ROOT=<origin/main checkout, built> PORT=3502 python3 backend/scripts/n-money2-followups-check.py --base
"""
import os, re, sqlite3, subprocess, sys, tempfile, time, urllib.request
from playwright.sync_api import sync_playwright

HERE_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
ROOT = os.path.abspath(os.environ.get('APP_ROOT', HERE_ROOT))
BASE_MODE = '--base' in sys.argv
PORT = int(os.environ.get('PORT', '3502')); BASE = f'http://127.0.0.1:{PORT}'
WORK = tempfile.mkdtemp(prefix='f151-'); DB = os.path.join(WORK, 'hr_system.db')
C = 'Asian Lakto Ind Ltd'
PASS = FAIL = 0
WHY = 'not HR-approved or already decided'


def check(label, expected, actual):
    global PASS, FAIL
    if expected == actual: PASS += 1; print(f'  ✓ {label}')
    else: FAIL += 1; print(f'  ✗ {label} — expected {expected!r}, got {actual!r}')


def q(sql, args=()):
    c = sqlite3.connect(DB); r = c.execute(sql, args).fetchall(); c.commit(); c.close(); return r


def seed():
    c = sqlite3.connect(DB)
    for i in range(1, 9):
        code = f'T95{i:02d}'
        c.execute("INSERT INTO employees(code,name,department,company,status,employment_type,gross_salary) "
                  "VALUES(?,?,'TEST DEPT',?,'Active','Permanent',20000)", (code, f'Test Person {chr(64 + i)}', C))
    eid = lambda code: c.execute('SELECT id FROM employees WHERE code=?', (code,)).fetchone()[0]
    # Salary change history: one of each status (F-2)
    for code, st in [('T9501', 'Approved'), ('T9502', 'Rejected'), ('T9503', 'Pending'), ('T9504', 'Reverted')]:
        c.execute("INSERT INTO salary_change_requests(employee_id,employee_code,requested_by,old_gross,new_gross,old_structure,"
                  "new_structure,reason,status) VALUES(?,?,'hr',20000,22000,'{}','{\"gross_salary\":22000}','synthetic',?)",
                  (eid(code), code, st))
    # Extra duty grants: 4 waiting for finance in Sep 2026 (F-3)
    for k, code in enumerate(['T9505', 'T9506', 'T9507', 'T9508']):
        c.execute("""INSERT INTO extra_duty_grants(employee_code,grant_date,month,year,company,grant_type,duty_days,verification_source,
                     status,finance_status,requested_by) VALUES(?,?,9,2026,?,'OVERNIGHT_STAY',1,'Gate Register','APPROVED','UNREVIEWED','hr1')""",
                  (code, f'2026-09-{k + 1:02d}', C))
    c.commit(); c.close()


env = dict(os.environ, DATA_DIR=WORK, JWT_SECRET='x', PORT=str(PORT), NODE_ENV='production',
           ADMIN_PASSWORD='Admin@123', HR_PASSWORD='Indriyan@2025', FINANCE_PASSWORD='Finance@2025')
srv = subprocess.Popen(['node', f'{ROOT}/backend/server.js'], env=env, stdout=open(f'{WORK}/log', 'w'), stderr=subprocess.STDOUT)


def toasts(pg):
    return pg.locator('[role=status]').all_inner_texts()


def clear_toasts(pg):
    pg.evaluate("() => document.querySelectorAll('[role=status]').forEach(e => { const p = e.closest('[style]'); if (p) p.remove() })")


def wait_toast(pg, n=1, t=8):
    for _ in range(int(t * 10)):
        if pg.locator('[role=status]').count() >= n: break
        time.sleep(.1)
    time.sleep(1.8)  # past the 1.5 s dedup window: a second toast would show by now


def open_ed(pg):
    pg.goto(BASE + '/extra-duty-grants'); pg.wait_for_load_state('networkidle')
    for k in range(pg.locator('select').count()):
        s = pg.locator('select').nth(k)
        opts = ' '.join(s.locator('option').all_inner_texts())
        if 'September' in opts: s.select_option(label='September')
        if '2026' in opts and 'September' not in opts:
            try: s.select_option(label='2026')
            except Exception: pass
    pg.wait_for_load_state('networkidle'); time.sleep(1)


try:
    for _ in range(80):
        try: urllib.request.urlopen(BASE + '/api/version', timeout=2); break
        except Exception: time.sleep(.5)
    seed()
    print(f'App root: {ROOT}  mode: {"BASE (old behaviour expected)" if BASE_MODE else "fix"}')
    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context(viewport={'width': 1440, 'height': 900}); pg = ctx.new_page()
        errs, cons, bad = [], [], []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.on('console', lambda m: cons.append(m.text) if m.type == 'error' and 'vite.svg' not in m.text and '404' not in m.text
              and '409' not in m.text and 'API Error' not in m.text else None)
        pg.on('response', lambda r: bad.append(f'{r.status} {r.request.method} {r.url}') if '/api/' in r.url and r.status >= 400 else None)
        pg.goto(BASE + '/login'); pg.get_by_placeholder('admin').fill('finance'); pg.get_by_placeholder('••••••••').fill('Finance@2025')
        pg.get_by_role('button', name='Sign in').click(); pg.wait_for_url(lambda u: '/login' not in u)

        print('\n— F-2: Salary Input → Change History —')
        pg.goto(BASE + '/salary-input'); pg.wait_for_load_state('networkidle'); time.sleep(.5)
        pg.get_by_role('button', name=re.compile('^Change History')).click(); pg.wait_for_load_state('networkidle'); time.sleep(.8)
        status_of = lambda code: pg.locator('tbody tr', has_text=code).first.locator('td').nth(5).inner_text().strip()
        if BASE_MODE:
            check('old: Reverted row shows an empty status', '', status_of('T9504'))
        else:
            check('Reverted row shows "Reverted"', 'Reverted', status_of('T9504'))
            check('Reverted pill carries data-status', 1, pg.locator('tbody tr', has_text='T9504').locator('[data-status=Reverted]').count())
            check('Reverted pill tone orange', True, pg.locator('[data-status=Reverted]').first.evaluate("e => e.className.includes('bg-orange-100')"))
            check('other statuses unchanged', ['Approved', 'Rejected', 'Pending'], [status_of('T9501'), status_of('T9502'), status_of('T9503')])

        print('\n— F-3: Extra Duty bulk finance approve with 2 decided elsewhere —')
        open_ed(pg)
        pg.get_by_role('button', name=re.compile('Finance Review')).first.click(); pg.wait_for_load_state('networkidle'); time.sleep(.8)
        check('4 rows waiting', 4, pg.locator('tbody tr').count())
        pg.locator('[data-testid=select-all]').check(); time.sleep(.3)
        # another user decides two of them after the page loaded
        q("UPDATE extra_duty_grants SET finance_status='FINANCE_APPROVED' WHERE employee_code='T9505'")
        q("UPDATE extra_duty_grants SET status='PENDING' WHERE employee_code='T9506'")
        clear_toasts(pg)
        pg.get_by_role('button', name='Bulk Approve (4)').click(); wait_toast(pg)
        t = toasts(pg)
        if BASE_MODE:
            check('old: toast ignores the skipped ones', ['2 grants approved'], t)
        else:
            check(f'toast "Approved 2 · Skipped 2 ({WHY})"', [f'Approved 2 · Skipped 2 ({WHY})'], t)
        check('DB: T9507 + T9508 approved, T9506 still PENDING', [('T9505', 'FINANCE_APPROVED'), ('T9506', 'UNREVIEWED'), ('T9507', 'FINANCE_APPROVED'), ('T9508', 'FINANCE_APPROVED')],
              q("SELECT employee_code, finance_status FROM extra_duty_grants ORDER BY employee_code"))

        if not BASE_MODE:
            print('\n— F-3 edge: everything selected was decided elsewhere —')
            q("UPDATE extra_duty_grants SET status='APPROVED', finance_status='UNREVIEWED' WHERE employee_code='T9506'")
            open_ed(pg)
            pg.get_by_role('button', name=re.compile('Finance Review')).first.click(); pg.wait_for_load_state('networkidle'); time.sleep(.8)
            pg.locator('[data-testid=select-all]').check(); time.sleep(.3)
            q("UPDATE extra_duty_grants SET finance_status='FINANCE_APPROVED' WHERE employee_code='T9506'")
            clear_toasts(pg)
            pg.get_by_role('button', name=re.compile(r'^Bulk Approve \(1\)')).click(); wait_toast(pg)
            check(f'toast "Nothing approved · Skipped 1 ({WHY})"', [f'Nothing approved · Skipped 1 ({WHY})'], toasts(pg))

            print('\n— F-3: single approve that the server refuses → exactly one toast —')
            q("INSERT INTO extra_duty_grants(employee_code,grant_date,month,year,company,grant_type,duty_days,verification_source,"
              "status,finance_status,requested_by) VALUES('T9501','2026-09-20',9,2026,?,'OVERNIGHT_STAY',1,'Gate Register','APPROVED','UNREVIEWED','hr1')", (C,))
            open_ed(pg)
            pg.get_by_role('button', name=re.compile('Finance Review')).first.click(); pg.wait_for_load_state('networkidle'); time.sleep(.8)
            q("UPDATE extra_duty_grants SET finance_status='FINANCE_APPROVED' WHERE employee_code='T9501'")
            clear_toasts(pg); bad.clear()
            pg.locator('tbody tr', has_text='T9501').get_by_role('button', name='✓ Approve').click(); wait_toast(pg)
            t = toasts(pg)
            check('one toast', 1, len(t))
            check('toast = server reason', True, bool(t) and 'already approved' in t[0])
            check('the refusal was a 409', True, any(x.startswith('409 POST') for x in bad))
            bad[:] = [x for x in bad if not x.startswith('409 POST')]

            print('\n— 390 px —')
            p2 = b.new_context(viewport={'width': 390, 'height': 800}).new_page()
            e2 = []; p2.on('pageerror', lambda e: e2.append(str(e)))
            p2.goto(BASE + '/login'); p2.get_by_placeholder('admin').fill('finance'); p2.get_by_placeholder('••••••••').fill('Finance@2025')
            p2.get_by_role('button', name='Sign in').click(); p2.wait_for_url(lambda u: '/login' not in u)
            p2.goto(BASE + '/salary-input'); p2.wait_for_load_state('networkidle'); time.sleep(.5)
            p2.get_by_role('button', name=re.compile('^Change History')).click(); p2.wait_for_load_state('networkidle'); time.sleep(.8)
            check('390px: Reverted pill present', 1, p2.locator('[data-status=Reverted]').count())
            check('390px: 0 page errors', [], e2)

        check('0 page errors', [], errs); check('0 console errors', [], cons); check('0 unexpected API ≥ 400', [], bad)
        b.close()
finally:
    srv.terminate(); srv.wait()

print(f'\n{PASS} passed, {FAIL} failed')
sys.exit(1 if FAIL else 0)
