#!/usr/bin/env python3
"""Finance Audit → Readiness: blocker cards navigate without crashing (P1-01) — browser check.

Chromium against the BUILT dist, real finance + admin logins, scratch DATA_DIR with fictional data
(employee codes T9001…, names "TEST EMP n" — repo is public). Seeds September 2026 so the readiness
check returns UNAPPROVED_MANUAL_FLAGS, HELD_SALARIES_UNREVIEWED and DAY_CALC_WITHOUT_SALARY blockers;
August 2026 is left empty so it returns NO_ATTENDANCE_DATA (a blocker with no action).

Usage:
  python3 backend/scripts/finance-audit-readiness-check.py            # this tree's server + dist
  APP_ROOT=/tmp/wt python3 .../finance-audit-readiness-check.py --base # another tree (e.g. origin/main):
                                                                       # expects the old crash instead
Needs `npm run build --prefix frontend` in APP_ROOT first. PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers.
"""
import os, shutil, sqlite3, subprocess, sys, tempfile, time, urllib.request
from playwright.sync_api import sync_playwright

HERE_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
ROOT = os.path.abspath(os.environ.get('APP_ROOT', HERE_ROOT))
BASE_MODE = '--base' in sys.argv
PORT = int(os.environ.get('PORT', '3993')); BASE = f'http://127.0.0.1:{PORT}'
WORK = tempfile.mkdtemp(prefix='fa-ready-'); DB = os.path.join(WORK, 'hr_system.db')
C = 'Asian Lakto Ind Ltd'
PASS = FAIL = 0


def check(label, expected, actual):
    global PASS, FAIL
    if expected == actual: PASS += 1; print(f'  ✓ {label}')
    else: FAIL += 1; print(f'  ✗ {label} — expected {expected!r}, got {actual!r}')


def seed():
    c = sqlite3.connect(DB)
    for n in range(1, 5):
        c.execute("INSERT OR IGNORE INTO employees(code,name,department,company,status,employment_type,gross_salary) "
                  "VALUES(?,?,'TEST DEPT',?,'Active','Permanent',20000)", (f'T900{n}', f'TEST EMP {n}', C))
        c.execute("INSERT INTO attendance_processed(employee_code,date,status_original,status_final,month,year,company) "
                  "VALUES(?,'2026-09-01','P','P',9,2026,?)", (f'T900{n}', C))
    for n in (1, 2, 3):  # day calc for 3, salary for 2 → DAY_CALC_WITHOUT_SALARY (T9003)
        c.execute("INSERT INTO day_calculations(employee_code,month,year,company,total_payable_days) VALUES(?,9,2026,?,26)", (f'T900{n}', C))
    c.execute("INSERT INTO salary_computations(employee_code,month,year,company,gross_salary,gross_earned,total_deductions,net_salary,salary_held,hold_reason) "
              "VALUES('T9001',9,2026,?,20000,20000,0,20000,0,'')", (C,))
    c.execute("INSERT INTO salary_computations(employee_code,month,year,company,gross_salary,gross_earned,total_deductions,net_salary,salary_held,hold_reason) "
              "VALUES('T9002',9,2026,?,20000,3000,0,3000,1,'Test hold reason')", (C,))
    c.execute("INSERT INTO salary_manual_flags(employee_code,month,year,company,flag_type,finance_approved) "
              "VALUES('T9001',9,2026,?,'TEST_FLAG',0)", (C,))
    c.commit(); c.close()


def login(ctx, user, pw):
    pg = ctx.new_page()
    errs, cons, bad = [], [], []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('console', lambda m: cons.append(m.text) if m.type == 'error' and 'vite.svg' not in m.text and '404' not in m.text else None)
    pg.on('response', lambda r: bad.append(f'{r.status} {r.url}') if '/api/' in r.url and r.status >= 400 else None)
    pg.goto(BASE + '/login'); pg.get_by_placeholder('admin').fill(user); pg.get_by_placeholder('••••••••').fill(pw)
    pg.get_by_role('button', name='Sign in').click(); pg.wait_for_url(lambda u: '/login' not in u)
    return pg, errs, cons, bad


def open_readiness(pg, month):
    # Month lives in the persisted store; ReadinessTab reads it at mount, so set it then reload.
    pg.goto(BASE + '/finance-audit?tab=readiness'); pg.wait_for_load_state('networkidle')
    pg.locator('select').filter(has=pg.locator('option', has_text='September')).first.select_option(str(month))
    time.sleep(.3); pg.reload(); pg.wait_for_load_state('networkidle'); time.sleep(1)


def card(pg, label):
    return pg.locator('div.rounded-lg', has=pg.locator('div.font-semibold', has_text=label)).last


def tab_active(pg, startswith):
    btn = pg.locator('button.border-b-2', has_text=startswith).first
    return 'border-blue-600' in (btn.get_attribute('class') or '')


env = dict(os.environ, DATA_DIR=WORK, JWT_SECRET='x', PORT=str(PORT), NODE_ENV='production',
           ADMIN_PASSWORD='Admin@123', HR_PASSWORD='Indriyan@2025', FINANCE_PASSWORD='Finance@2025')
srv = subprocess.Popen(['node', f'{ROOT}/backend/server.js'], env=env, stdout=open(f'{WORK}/log', 'w'), stderr=subprocess.STDOUT)
try:
    for _ in range(80):
        try: urllib.request.urlopen(BASE + '/api/version', timeout=2); break
        except Exception: time.sleep(.5)
    seed()
    print(f'App root: {ROOT}  mode: {"BASE (expect crash)" if BASE_MODE else "fix"}')

    with sync_playwright() as p:
        b = p.chromium.launch()

        if BASE_MODE:
            ctx = b.new_context(viewport={'width': 1440, 'height': 900})
            pg, errs, cons, bad = login(ctx, 'finance', 'Finance@2025')
            open_readiness(pg, 9)
            card(pg, 'UNAPPROVED MANUAL FLAGS').click(); time.sleep(1)
            check('old code: manual-flags click throws setActiveTab ReferenceError', True, any('setActiveTab' in e for e in errs))
            check('old code: ErrorBoundary shown', True, pg.get_by_text('Something went wrong').count() > 0)
            print('  page errors:', errs)
            b.close()
        else:
            ctx = b.new_context(viewport={'width': 1440, 'height': 900})
            pg, errs, cons, bad = login(ctx, 'finance', 'Finance@2025')

            print('\n— finance: reload with ?tab=readiness renders —')
            open_readiness(pg, 9)
            check('Readiness tab active', True, tab_active(pg, 'Readiness'))
            check('"Not Ready" heading', 1, pg.get_by_text('Not Ready', exact=True).count())
            for lbl in ('UNAPPROVED MANUAL FLAGS', 'HELD SALARIES UNREVIEWED', 'DAY CALC WITHOUT SALARY'):
                check(f'{lbl}: card clickable ("Click to review")', 1, card(pg, lbl).get_by_text('Click to review').count())

            print('\n— happy: manual-flags card → Interventions tab —')
            card(pg, 'UNAPPROVED MANUAL FLAGS').click(); time.sleep(1)
            check('Manual Interventions tab active', True, tab_active(pg, 'Manual Interventions'))
            check('still on /finance-audit', True, '/finance-audit' in pg.url)
            check('no ErrorBoundary', 0, pg.get_by_text('Something went wrong').count())

            print('\n— HELD card → Finance Verification, Red Flags, held filter —')
            open_readiness(pg, 9)
            card(pg, 'HELD SALARIES UNREVIEWED').click()
            pg.wait_for_url(lambda u: '/finance-verification' in u, timeout=10000); pg.wait_for_load_state('networkidle'); time.sleep(1)
            check('URL', '/finance-verification?tab=redflags&filter=salary_held', pg.url.replace(BASE, ''))
            check('Red Flags tab active', True, tab_active(pg, 'Red Flags'))
            chip = pg.locator('button.rounded-full', has_text='salary held')
            check('"salary held" chip selected', True, chip.count() == 1 and 'bg-blue-600' in (chip.get_attribute('class') or ''))
            check('held test employee listed', True, pg.get_by_text('TEST EMP 2').count() > 0)

            print('\n— SALARY card → Stage 7 —')
            open_readiness(pg, 9)
            card(pg, 'DAY CALC WITHOUT SALARY').click()
            pg.wait_for_url(lambda u: '/pipeline/salary' in u, timeout=10000); pg.wait_for_load_state('networkidle')
            check('URL', '/pipeline/salary', pg.url.replace(BASE, ''))

            print('\n— edge: blocker with no action (August, no attendance) —')
            open_readiness(pg, 8)
            na = card(pg, 'NO ATTENDANCE DATA')
            check('NO ATTENDANCE DATA card shown', 1, na.count())
            check('not cursor-pointer', False, 'cursor-pointer' in (na.get_attribute('class') or ''))
            check('no "Click to review"', 0, na.get_by_text('Click to review').count())
            url0 = pg.url; na.click(); time.sleep(.8)
            check('click does nothing (same URL)', url0, pg.url)
            check('Readiness tab still active', True, tab_active(pg, 'Readiness'))

            check('finance: 0 page errors', [], errs)
            check('finance: 0 console errors', [], cons)
            check('finance: 0 API ≥ 400', [], bad)

            print('\n— admin: manual-flags + HELD cards —')
            ctx2 = b.new_context(viewport={'width': 1440, 'height': 900})
            pg2, errs2, cons2, bad2 = login(ctx2, 'admin', 'Admin@123')
            open_readiness(pg2, 9)
            card(pg2, 'UNAPPROVED MANUAL FLAGS').click(); time.sleep(1)
            check('admin: Manual Interventions tab active', True, tab_active(pg2, 'Manual Interventions'))
            open_readiness(pg2, 9)
            card(pg2, 'HELD SALARIES UNREVIEWED').click()
            pg2.wait_for_url(lambda u: '/finance-verification' in u, timeout=10000); pg2.wait_for_load_state('networkidle')
            check('admin: held → /finance-verification', True, pg2.url.startswith(BASE + '/finance-verification?tab=redflags&filter=salary_held'))
            check('admin: 0 page errors', [], errs2)
            check('admin: 0 console errors', [], cons2)
            check('admin: 0 API ≥ 400', [], bad2)
            b.close()
finally:
    srv.terminate(); shutil.rmtree(WORK, ignore_errors=True)

print(f'\n{PASS} passed, {FAIL} failed')
sys.exit(1 if FAIL else 0)
