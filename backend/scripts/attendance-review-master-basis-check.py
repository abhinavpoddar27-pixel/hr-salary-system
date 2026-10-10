#!/usr/bin/env python3
"""Analytics → Attendance Review: the master-shift basis (owner ruling 10 Oct 2026) — browser check.

Chromium against the BUILT dist, real admin login, scratch DATA_DIR, fictional codes M80xx (repo is public).
Seeds Sep + Oct 2026:
  M8001 master 07:30–16:30, punches 07:31–16:35; the import measured on 12 h → "early" every day.
        Import basis: 22 "early exits" of 3 h+ → a deduction. Master basis: clean.
  M8002 master 10HR, in 09:20 out 19:00 on 10 Oct days; import flags nothing.
        Import basis: clean. Master basis: regular late → deduction.
  M8003 no master shift; import flags 45-min lates on 10 Oct days.
        Import basis: deduction. Master basis: not assessed, listed under "no master shift".
  M8004 master 12HR, three miss-punch days fixed from the gate register: two outs written as exactly 20:00 (not
        verified), one out at 17:00 (3 h early).
Flow: preview on the default (import) basis → Rules: switch to "current master shift", save → basis line, action list,
warnings and the "What the master-shift basis left out" section follow → untick MP-1, save → gate-register days skipped
→ reopen Rules: the choice was saved → phone width renders. Nothing is ever written to a payroll table.

Usage: npm run build --prefix frontend; python3 backend/scripts/attendance-review-master-basis-check.py
"""
import datetime, os, sqlite3, subprocess, tempfile, time, urllib.request
from playwright.sync_api import sync_playwright

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
PORT = int(os.environ.get('PORT', '3995')); BASE = f'http://127.0.0.1:{PORT}'
WORK = tempfile.mkdtemp(prefix='ar-master-'); DB = os.path.join(WORK, 'hr_system.db')
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


def seed():
    c = sqlite3.connect(DB)
    c.execute("INSERT INTO shifts(name,code,start_time,end_time,duration_hours) VALUES('Housekeeping M','HKM','07:30','16:30',9)")
    sid = lambda code: c.execute('SELECT id FROM shifts WHERE code=?', (code,)).fetchone()[0]
    masters = {'M8001': sid('HKM'), 'M8002': sid('10HR'), 'M8003': None, 'M8004': sid('12HR')}
    for n, (code, shift) in enumerate(masters.items(), 1):
        c.execute("INSERT INTO employees(code,name,department,designation,company,status,employment_type,gross_salary,date_of_joining,default_shift_id) "
                  "VALUES(?,?,'TEST DEPT','OPERATOR',?,'Active','Permanent',30000,'2024-01-01',?)", (code, f'TEST MASTER {n}', C, shift))

    def day(code, iso, it, ot, lm=0, em=0, mp=0, resolved=0):
        c.execute("INSERT INTO attendance_processed(employee_code,date,status_original,status_final,in_time_final,out_time_final,shift_detected,"
                  "is_late_arrival,late_by_minutes,is_early_departure,early_by_minutes,is_left_late,is_miss_punch,miss_punch_resolved,month,year,company) "
                  "VALUES(?,?,'P','P',?,?,'12-Hour Shift',?,?,?,?,0,?,?,?,?,?)",
                  (code, iso, it, ot, 1 if lm else 0, lm, 1 if em else 0, em, mp, resolved, int(iso[5:7]), int(iso[:4]), C))
    for iso in weekdays(2026, 9)[:20]:
        day('M8001', iso, '07:30', '16:30', em=210); day('M8002', iso, '09:00', '19:00')
        day('M8003', iso, '08:00', '20:00'); day('M8004', iso, '08:00', '20:00')
    for i, iso in enumerate(weekdays(2026, 10)[:22]):
        day('M8001', iso, '07:31', '16:35', em=205)
        day('M8002', iso, '09:20' if i < 10 else '09:00', '19:00')
        day('M8003', iso, '08:45' if i < 10 else '08:00', '20:00', lm=45 if i < 10 else 0)
        if i in (3, 4): day('M8004', iso, '08:30', '20:00', mp=1, resolved=1)
        elif i == 5: day('M8004', iso, '08:00', '17:00', mp=1, resolved=1)
        else: day('M8004', iso, '08:00', '20:00')
    c.commit(); c.close()


def section(pg, title): return pg.locator(f'[data-section="{title}"]')


def codes_in(pg, title):
    sec = section(pg, title)
    if sec.count() == 0: return []
    if sec.locator('tbody').count() == 0: sec.locator('button').first.click(); time.sleep(.4)
    return [t.strip() for t in sec.locator('tbody tr td:first-child').all_inner_texts()]


def quality_row(pg, label):
    sec = section(pg, 'What the master-shift basis left out')
    if sec.locator('tbody').count() == 0: sec.locator('button').first.click(); time.sleep(.4)
    row = sec.locator('tbody tr', has_text=label).first
    return [t.strip() for t in row.locator('td').all_inner_texts()] if row.count() else None


def save_rules(pg):
    cfg = pg.get_by_test_id('ar-config')
    cfg.get_by_label('Effective from').fill('2026-10')
    cfg.get_by_role('button', name='Save as new version').click(); time.sleep(1.8)
    return cfg


env = dict(os.environ, DATA_DIR=WORK, JWT_SECRET='x', PORT=str(PORT), NODE_ENV='production',
           ADMIN_PASSWORD='Admin@123', HR_PASSWORD='Indriyan@2025', FINANCE_PASSWORD='Finance@2025')
srv = subprocess.Popen(['node', f'{ROOT}/backend/server.js'], env=env, stdout=open(f'{WORK}/log', 'w'), stderr=subprocess.STDOUT)
try:
    for _ in range(80):
        try: urllib.request.urlopen(BASE + '/api/version', timeout=2); break
        except Exception: time.sleep(.5)
    seed()
    payroll_before = [sqlite3.connect(DB).execute(f'SELECT COUNT(*) FROM {t}').fetchone()[0] for t in ('day_calculations', 'salary_computations', 'late_coming_deductions')]
    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context(viewport={'width': 1440, 'height': 900})
        pg = ctx.new_page(); errs, bad = [], []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.on('response', lambda r: bad.append(f'{r.status} {r.url}') if '/api/' in r.url and r.status >= 400 else None)
        pg.goto(BASE + '/login'); pg.get_by_placeholder('admin').fill('admin'); pg.get_by_placeholder('••••••••').fill('Admin@123')
        pg.get_by_role('button', name='Sign in').click(); pg.wait_for_url(lambda u: '/login' not in u)
        pg.goto(BASE + '/analytics/attendance-review'); pg.wait_for_load_state('networkidle')
        pg.locator('select').filter(has=pg.locator('option', has_text='October')).first.select_option('10')
        pg.locator('select').filter(has=pg.locator('option', has_text='2026')).first.select_option('2026')
        pg.wait_for_load_state('networkidle'); time.sleep(1.5)

        print('\n— import basis (default) —')
        check('basis line says import', True, 'import basis' in pg.get_by_test_id('ar-basis').inner_text())
        check('no master-basis section', 0, section(pg, 'What the master-shift basis left out').count())
        check('action list: M8001 (wrong import shift) and M8003 (import-flagged lates)', ['M8001', 'M8003'], sorted(codes_in(pg, 'Action list')))

        print('\n— rules: switch to the current master shift —')
        pg.get_by_role('button', name='Rules & exclusions').click(); time.sleep(.8)
        cfg = pg.get_by_test_id('ar-config')
        check('basis selector defaults to the import basis', 'import', cfg.get_by_label('Assessment basis').input_value())
        check('MP-1 tick hidden on the import basis', 0, cfg.get_by_label('Assess fixed miss-punch days').count())
        cfg.get_by_label('Assessment basis').select_option('master')
        check('MP-1 tick shown and on by default', True, cfg.get_by_label('Assess fixed miss-punch days').is_checked())
        save_rules(pg)
        check('saved as version 1', True, cfg.get_by_text('version 1, effective 2026-10').count() == 1)
        pg.wait_for_load_state('networkidle'); time.sleep(1.2)

        print('\n— master basis —')
        check('basis line says current master shift + gate register', True,
              "current master shift" in pg.get_by_test_id('ar-basis').inner_text() and 'gate register' in pg.get_by_test_id('ar-basis').inner_text())
        al = codes_in(pg, 'Action list')
        check('M8002 (10 lates on the 10-hour master) now on the action list', True, 'M8002' in al)
        check('M8003 (no master) no longer on the action list', False, 'M8003' in al)
        check('M8001 (measured on 07:30–16:30) off the action list and the warnings', False,
              'M8001' in al or 'M8001' in codes_in(pg, 'Early-exit warnings'))
        sec = section(pg, 'What the master-shift basis left out')
        check('data-quality section shown with 22 unassessable days', True, sec.count() == 1 and '22' in sec.locator('h4').inner_text())
        r = quality_row(pg, 'No master shift')
        check('no master: 22 days, 1 person, M8003 (22)', ['22', '1', 'M8003 (22)'], r[1:4] if r else None)
        r = quality_row(pg, 'fixed from the gate register')
        check('gate register: 3 days', '3', r[1] if r else None)
        r = quality_row(pg, 'exactly the shift end')
        check('out not verified: 2 days', '2', r[1] if r else None)
        pg.screenshot(path=os.path.join(WORK, 'master.png'), full_page=True)

        print('\n— edge: MP-1 off —')
        cfg = pg.get_by_test_id('ar-config')
        cfg.get_by_label('Assess fixed miss-punch days').uncheck()
        save_rules(pg); pg.wait_for_load_state('networkidle'); time.sleep(1.2)
        check('saved as version 2', True, cfg.get_by_text('version 2, effective 2026-10').count() == 1)
        check('basis line no longer mentions the gate register', False, 'gate register' in pg.get_by_test_id('ar-basis').inner_text())
        r = quality_row(pg, 'fixed from the gate register')
        check('gate register: 0 days', '0', r[1] if r else None)
        r = quality_row(pg, 'not yet fixed')
        check('the 3 days are now skipped as miss-punch days', '3', r[1] if r else None)

        print('\n— reopen rules: choice persisted —')
        pg.reload(); pg.wait_for_load_state('networkidle'); time.sleep(1.2)
        pg.locator('select').filter(has=pg.locator('option', has_text='October')).first.select_option('10')
        pg.wait_for_load_state('networkidle'); time.sleep(1)
        pg.get_by_role('button', name='Rules & exclusions').click(); time.sleep(.8)
        cfg = pg.get_by_test_id('ar-config')
        check('basis still master after reload', 'master', cfg.get_by_label('Assessment basis').input_value())
        check('MP-1 still off after reload', False, cfg.get_by_label('Assess fixed miss-punch days').is_checked())

        print('\n— phone width 390 —')
        ph = b.new_context(viewport={'width': 390, 'height': 844}).new_page(); perr = []
        ph.on('pageerror', lambda e: perr.append(str(e)))
        ph.goto(BASE + '/login'); ph.get_by_placeholder('admin').fill('admin'); ph.get_by_placeholder('••••••••').fill('Admin@123')
        ph.get_by_role('button', name='Sign in').click(); ph.wait_for_url(lambda u: '/login' not in u)
        ph.goto(BASE + '/analytics/attendance-review'); ph.wait_for_load_state('networkidle')
        ph.locator('select').filter(has=ph.locator('option', has_text='October')).first.select_option('10')
        ph.wait_for_load_state('networkidle'); time.sleep(1.2)
        check('phone: basis line renders', True, ph.get_by_test_id('ar-basis').count() == 1)
        check('phone: 0 page errors', [], perr)

        check('0 page errors', [], errs)
        check('0 API 4xx/5xx', [], bad)
        b.close()
    payroll_after = [sqlite3.connect(DB).execute(f'SELECT COUNT(*) FROM {t}').fetchone()[0] for t in ('day_calculations', 'salary_computations', 'late_coming_deductions')]
    check('no payroll table written', payroll_before, payroll_after)
finally:
    srv.terminate()
    try: srv.wait(timeout=10)
    except Exception: srv.kill()

print(f'\n{PASS} passed, {FAIL} failed  (screenshot: {WORK}/master.png)')
raise SystemExit(1 if FAIL else 0)
