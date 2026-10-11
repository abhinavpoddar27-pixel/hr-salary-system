#!/usr/bin/env python3
"""PR-2 — Attendance Review "Send to finance" + Late Coming apply retired — browser check.

Chromium against the BUILT dist, real admin login, scratch DATA_DIR, fictional codes F90xx (repo is public).
October 2026, master basis, 12-hour masters (08:00–20:00). Late 45 min on 12 days → a deduction for:
  F9001, F9002 (permanent), F9004 (contractor) and F9003 — but F9003 already has an APPROVED row entered in the old
  Late Coming screen, so the review must not add a second one.
Flow: generate draft → Finance section says "finalise first" → Finalise → "Send 3 to finance" + F9003 blocked note +
contractor note → Send → 3 pending rows tagged with the run, audited → button becomes "Nothing left to send" → finance
approves one in the DB → status shows Approved → the Late Coming list has no "Apply Deduction" button and a read-only
note; a direct POST answers 410 and writes nothing → phone width. Salary tables untouched.

Usage: npm run build --prefix frontend; python3 backend/scripts/attendance-review-send-to-finance-check.py
"""
import datetime, json, os, sqlite3, subprocess, tempfile, time, urllib.request
from playwright.sync_api import sync_playwright

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
PORT = int(os.environ.get('PORT', '3995')); BASE = f'http://127.0.0.1:{PORT}'
WORK = tempfile.mkdtemp(prefix='ar-fin-'); DB = os.path.join(WORK, 'hr_system.db')
C = 'Indriyan Beverages Pvt Ltd'
PASS = FAIL = 0


def check(label, expected, actual):
    global PASS, FAIL
    if expected == actual: PASS += 1; print(f'  ✓ {label}')
    else: FAIL += 1; print(f'  ✗ {label} — expected {expected!r}, got {actual!r}')


def weekdays(y, m):
    d = datetime.date(y, m, 1); out = []
    while d.month == m:
        if d.weekday() != 6: out.append(d.isoformat())
        d += datetime.timedelta(days=1)
    return out


def q(sql, args=()):
    con = sqlite3.connect(DB, timeout=10); con.row_factory = sqlite3.Row
    try: return [dict(r) for r in con.execute(sql, args).fetchall()]
    finally: con.close()


def run(sql, args=()):
    con = sqlite3.connect(DB, timeout=10)
    try: con.execute(sql, args); con.commit()
    finally: con.close()


def seed():
    c = sqlite3.connect(DB)
    s12 = c.execute("SELECT id FROM shifts WHERE code='12HR'").fetchone()[0]
    people = [('F9001', 0), ('F9002', 0), ('F9003', 0), ('F9004', 1), ('F9005', 0)]  # F9005 on time
    for n, (code, con) in enumerate(people, 1):
        c.execute("INSERT INTO employees(code,name,department,designation,company,status,employment_type,is_contractor,gross_salary,date_of_joining,default_shift_id) "
                  "VALUES(?,?,'PRODUCTION','OPERATOR',?,'Active',?,?,20000,'2024-01-01',?)",
                  (code, f'TEST FIN {n}', C, 'Contract' if con else 'Permanent', con, s12))
    for m in (9, 10):
        for i, iso in enumerate(weekdays(2026, m)[:22]):
            for code, _ in people:
                late = m == 10 and i < 12 and code != 'F9005'
                c.execute("INSERT INTO attendance_processed(employee_code,date,status_original,status_final,in_time_final,out_time_final,shift_detected,"
                          "is_late_arrival,late_by_minutes,is_early_departure,early_by_minutes,is_left_late,is_miss_punch,month,year,company) "
                          "VALUES(?,?,'P','P',?,'20:00','12-Hour Shift',?,?,0,0,0,0,?,?,?)",
                          (code, iso, '08:45' if late else '08:00', 1 if late else 0, 45 if late else 0, m, 2026, C))
    c.execute("INSERT INTO attendance_review_config (effective_from, config_json, updated_by) VALUES ('2026-10', ?, 'admin')",
              (json.dumps({'assessment_basis': 'master'}),))
    c.execute("INSERT INTO late_coming_deductions (employee_code, month, year, company, late_count, deduction_days, remark, applied_by, finance_status) "
              "VALUES ('F9003', 10, 2026, ?, 12, 1, 'entered in the old screen', 'hr', 'approved')", (C,))
    c.commit(); c.close()


def section(pg, title): return pg.locator(f'[data-section="{title}"]')


def open_tab(pg, path='/analytics/attendance-review'):
    pg.goto(BASE + path); pg.wait_for_load_state('networkidle')
    pg.locator('select').filter(has=pg.locator('option', has_text='October')).first.select_option('10')
    pg.locator('select').filter(has=pg.locator('option', has_text='2026')).first.select_option('2026')
    pg.wait_for_load_state('networkidle'); time.sleep(1.5)


def login(ctx):
    pg = ctx.new_page()
    pg.goto(BASE + '/login'); pg.get_by_placeholder('admin').fill('admin'); pg.get_by_placeholder('••••••••').fill('Admin@123')
    pg.get_by_role('button', name='Sign in').click(); pg.wait_for_url(lambda u: '/login' not in u)
    return pg


env = dict(os.environ, DATA_DIR=WORK, JWT_SECRET='x', PORT=str(PORT), NODE_ENV='production',
           ADMIN_PASSWORD='Admin@123', HR_PASSWORD='Indriyan@2025', FINANCE_PASSWORD='Finance@2025')
srv = subprocess.Popen(['node', f'{ROOT}/backend/server.js'], env=env, stdout=open(f'{WORK}/log', 'w'), stderr=subprocess.STDOUT)
try:
    for _ in range(80):
        try: urllib.request.urlopen(BASE + '/api/version', timeout=2); break
        except Exception: time.sleep(.5)
    seed()
    salary_before = [q(f'SELECT COUNT(*) n FROM {t}')[0]['n'] for t in ('day_calculations', 'salary_computations')]
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = login(b.new_context(viewport={'width': 1440, 'height': 900})); errs, bad = [], []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.on('response', lambda r: bad.append(f'{r.status} {r.url}') if '/api/' in r.url and r.status >= 400 and r.request.method == 'GET' else None)
        pg.on('dialog', lambda d: d.accept())
        open_tab(pg)

        print('\n— draft —')
        check('no Finance section before a draft exists', 0, section(pg, 'Finance').count())
        pg.get_by_role('button', name='Generate draft').click(); pg.get_by_text('Draft created').wait_for(timeout=15000)
        pg.wait_for_load_state('networkidle'); time.sleep(1.5)
        acts = [t.strip() for t in section(pg, 'Action list').locator('tbody tr td:first-child').all_inner_texts()]
        check('action list: F9001–F9004', ['F9001', 'F9002', 'F9003', 'F9004'], sorted(acts))
        fin = pg.get_by_test_id('ar-finance')
        check('edge: draft says finalise first', 1, fin.get_by_text('Finalise the review to send').count())
        check('edge: no send button on a draft', 0, pg.get_by_test_id('ar-send-finance').count())

        print('\n— finalise, then send —')
        pg.get_by_role('button', name='Finalise').click(); pg.get_by_text('Review finalised and locked').wait_for(timeout=10000)
        pg.wait_for_load_state('networkidle'); time.sleep(1.5)
        btn = pg.get_by_test_id('ar-send-finance')
        check('button: Send 3 to finance', 'Send 3 to finance', btn.inner_text().strip())
        blocked = pg.get_by_test_id('ar-finance-blocked').inner_text()
        check('F9003 named as blocked by the existing approved row', True, 'F9003' in blocked and 'Approved' in blocked)
        check('contractor note shown', 1, pg.get_by_text('Contractor deductions are recorded').count())
        check('nothing written before the click', 1, q('SELECT COUNT(*) n FROM late_coming_deductions')[0]['n'])
        section(pg, 'Finance').screenshot(path=os.path.join(WORK, 'finance-before.png'))
        btn.click(); pg.get_by_text('3 sent to finance', exact=False).wait_for(timeout=10000)
        pg.wait_for_load_state('networkidle'); time.sleep(1)
        runid = q("SELECT id FROM attendance_review_runs WHERE month=10 AND year=2026")[0]['id']
        rows = q("SELECT employee_code c, deduction_days d, finance_status s, is_applied_to_salary a, remark FROM late_coming_deductions WHERE remark LIKE ? ORDER BY c",
                 (f'%[review run {runid}]%',))
        check('DB: 3 pending rows from the run', [('F9001', 'pending', 0), ('F9002', 'pending', 0), ('F9004', 'pending', 0)], [(r['c'], r['s'], r['a']) for r in rows])
        check('DB: every row has deduction days > 0', True, all(r['d'] > 0 for r in rows))
        check('DB: F9003 still has exactly one row', 1, q("SELECT COUNT(*) n FROM late_coming_deductions WHERE employee_code='F9003'")[0]['n'])
        check('audit: 3 send rows', 3, q("SELECT COUNT(*) n FROM audit_log WHERE stage='ATTENDANCE_REVIEW_SEND'")[0]['n'])
        check('summary line', True, '3 sent · 3 waiting · 0 approved' in pg.get_by_test_id('ar-finance-summary').inner_text())
        check('edge: button now "Nothing left to send" and disabled', ['Nothing left to send', True],
              [pg.get_by_test_id('ar-send-finance').inner_text().strip(), pg.get_by_test_id('ar-send-finance').is_disabled()])
        check('old-screen row listed under "Entered outside this review"', True,
              pg.get_by_text('Entered outside this review for the month (1)').count() == 1)

        print('\n— finance acts —')
        run("UPDATE late_coming_deductions SET finance_status='approved', finance_remark='ok' WHERE employee_code='F9001' AND remark LIKE ?", (f'%[review run {runid}]%',))
        pg.reload(); open_tab(pg)
        row = section(pg, 'Finance').locator('tr', has_text='F9001').first.inner_text()
        check('F9001 shows Approved with the finance note', True, 'Approved' in row and 'ok' in row)
        check('summary updates', True, '1 approved' in pg.get_by_test_id('ar-finance-summary').inner_text())

        print('\n— Late Coming screen —')
        open_tab(pg, '/analytics/punctuality'); time.sleep(1)
        check('read-only note shown', 1, pg.get_by_test_id('lc-deduction-readonly').count())
        check('no "Apply Deduction" button', 0, pg.get_by_role('button', name='Apply Deduction').count())
        check('late list still shows people', True, pg.get_by_text('F9001').count() > 0)
        status = pg.evaluate("""async () => { const t = localStorage.getItem('token') || sessionStorage.getItem('token');
            const r = await fetch('/api/late-coming/deduction', { method: 'POST', credentials: 'include',
              headers: Object.assign({ 'content-type': 'application/json' }, t ? { Authorization: 'Bearer ' + t } : {}),
              body: JSON.stringify({ employeeCode: 'F9005', month: 10, year: 2026, lateCount: 5, deductionDays: 1, remark: 'x' }) });
            return r.status }""")
        check('edge: direct POST /late-coming/deduction → 410', 410, status)
        check('nothing written for F9005', 0, q("SELECT COUNT(*) n FROM late_coming_deductions WHERE employee_code='F9005'")[0]['n'])

        print('\n— phone width 390 —')
        ph = login(b.new_context(viewport={'width': 390, 'height': 844})); perr = []
        ph.on('pageerror', lambda e: perr.append(str(e)))
        open_tab(ph)
        check('phone: Finance section renders', 1, section(ph, 'Finance').count())
        sw = ph.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1')
        check('phone: no horizontal page scroll', True, sw)
        check('phone: 0 page errors', [], perr)
        check('0 page errors', [], errs)
        check('0 failed GET calls', [], bad)
        b.close()
    check('salary tables untouched', salary_before, [q(f'SELECT COUNT(*) n FROM {t}')[0]['n'] for t in ('day_calculations', 'salary_computations')])
finally:
    srv.terminate()
    try: srv.wait(timeout=10)
    except Exception: srv.kill()

print(f'\n{PASS} passed, {FAIL} failed  (screenshot: {WORK}/finance-before.png)')
raise SystemExit(1 if FAIL else 0)
