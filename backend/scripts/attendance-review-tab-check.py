#!/usr/bin/env python3
"""Analytics → Attendance Review tab (PR-2) — browser check.

Chromium against the BUILT dist, real admin + HR logins, scratch DATA_DIR with fictional data
(codes T70xx, names "TEST EMP n" — repo is public). Seeds Sep + Oct 2026:
  T7001 regular late both months (not improved) → deduction · T7002 newcomer with 10 lates → warning
  T7003 5 early exits → early-exit warning · T7004 12 lates of 60 min → deduction, later excluded by config
  T7005–T7007 leave early only on 7 Oct, with T7004 → 7 Oct detected as a plant-wide release day
Flow: admin preview → release day pre-ticked → config excludes T7004 → generate draft → override → stale draft blocks
Finalise → regenerate → finalise (locked). HR: no tab, direct URL refused, no API call. Phone width renders.

Usage: npm run build --prefix frontend; python3 backend/scripts/attendance-review-tab-check.py
Needs PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers (or default playwright browsers).
"""
import datetime, os, shutil, sqlite3, subprocess, sys, tempfile, time, urllib.request
from playwright.sync_api import sync_playwright

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
PORT = int(os.environ.get('PORT', '3994')); BASE = f'http://127.0.0.1:{PORT}'
WORK = tempfile.mkdtemp(prefix='ar-tab-'); DB = os.path.join(WORK, 'hr_system.db')
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
    for n in range(1, 8):
        c.execute("INSERT INTO employees(code,name,department,designation,company,status,employment_type,gross_salary,date_of_joining) "
                  "VALUES(?,?,'TEST DEPT','OPERATOR',?,'Active','Permanent',31000,'2024-01-01')", (f'T700{n}', f'TEST EMP {n}', C))
    def day(code, iso, lm=0, em=0):
        c.execute("INSERT INTO attendance_processed(employee_code,date,status_original,status_final,in_time_final,out_time_final,shift_detected,"
                  "is_late_arrival,late_by_minutes,is_early_departure,early_by_minutes,is_left_late,month,year,company) "
                  "VALUES(?,?,'P','P','08:00','20:00','12-Hour Shift',?,?,?,?,0,?,?,?)",
                  (code, iso, 1 if lm else 0, lm, 1 if em else 0, em, int(iso[5:7]), int(iso[:4]), C))
    for i, iso in enumerate(weekdays(2026, 9)[:20]):
        day('T7001', iso, lm=40 if i < 10 else 0)
        for code in ('T7003', 'T7004', 'T7005', 'T7006', 'T7007'): day(code, iso, lm=60 if code == 'T7004' and i < 12 else 0)
    for i, iso in enumerate(weekdays(2026, 10)[:22]):
        rel = iso == '2026-10-07'
        day('T7001', iso, lm=50 if i < 12 else 0)
        day('T7002', iso, lm=40 if i < 10 else 0)
        day('T7003', iso, em=30 if i in (0, 1, 2, 8, 9) else 0)
        day('T7004', iso, lm=60 if i < 12 else 0, em=120 if rel else 0)
        for code in ('T7005', 'T7006', 'T7007'): day(code, iso, em=120 if rel else 0)
    c.commit(); c.close()


def login(ctx, user, pw):
    pg = ctx.new_page()
    errs, cons, bad, calls = [], [], [], []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('console', lambda m: cons.append(m.text) if m.type == 'error' and 'vite.svg' not in m.text and '404' not in m.text else None)
    pg.on('response', lambda r: bad.append(f'{r.status} {r.url}') if '/api/' in r.url and r.status >= 400 else None)
    pg.on('request', lambda r: calls.append(r.url) if '/attendance-review' in r.url and '/api/' in r.url else None)
    pg.goto(BASE + '/login'); pg.get_by_placeholder('admin').fill(user); pg.get_by_placeholder('••••••••').fill(pw)
    pg.get_by_role('button', name='Sign in').click(); pg.wait_for_url(lambda u: '/login' not in u)
    return pg, errs, cons, bad, calls


def open_tab(pg):
    pg.goto(BASE + '/analytics/attendance-review'); pg.wait_for_load_state('networkidle')
    pg.locator('select').filter(has=pg.locator('option', has_text='October')).first.select_option('10')
    pg.locator('select').filter(has=pg.locator('option', has_text='2026')).first.select_option('2026')
    pg.wait_for_load_state('networkidle'); time.sleep(1.2)


def status(pg): return pg.get_by_test_id('ar-status').inner_text().strip()


def action_codes(pg):
    sec = pg.locator('[data-section="Action list"]')
    return [t.strip() for t in sec.locator('tbody tr td:first-child').all_inner_texts()]


def stat(pg, label):
    return pg.locator('div.card.p-3', has=pg.locator('div.uppercase', has_text=label)).first.locator('div.text-xl').inner_text().strip()


env = dict(os.environ, DATA_DIR=WORK, JWT_SECRET='x', PORT=str(PORT), NODE_ENV='production',
           ADMIN_PASSWORD='Admin@123', HR_PASSWORD='Indriyan@2025', FINANCE_PASSWORD='Finance@2025')
srv = subprocess.Popen(['node', f'{ROOT}/backend/server.js'], env=env, stdout=open(f'{WORK}/log', 'w'), stderr=subprocess.STDOUT)
try:
    for _ in range(80):
        try: urllib.request.urlopen(BASE + '/api/version', timeout=2); break
        except Exception: time.sleep(.5)
    seed()
    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context(viewport={'width': 1440, 'height': 900})
        pg, errs, cons, bad, _ = login(ctx, 'admin', 'Admin@123')

        print('\n— admin: tab visible, live preview —')
        pg.goto(BASE + '/analytics/overview'); pg.wait_for_load_state('networkidle')
        check('tab link shown to admin', True, pg.locator('a[href="/analytics/attendance-review"]').filter(has_text='Attendance Review').count() >= 1)
        open_tab(pg)
        check('status PREVIEW (nothing saved)', 'PREVIEW', status(pg))
        rel = pg.locator('label', has_text='7 Oct (Wed)').locator('input[type=checkbox]')
        check('7 Oct detected as release day and pre-ticked', True, rel.count() == 1 and rel.is_checked())
        check('action list = T7004, T7001 (deductions) + T7002 (newcomer warning), by workdays lost', ['T7004', 'T7001', 'T7002'], action_codes(pg))
        check('deduction days KPI 2.0', '2.0', stat(pg, 'Deduction days'))
        check('indicative ₹ in Indian format', '₹2,000', stat(pg, 'Indicative amount'))
        ew = pg.locator('[data-section="Early-exit warnings"] tbody tr td:first-child').all_inner_texts()
        check('early-exit warnings = T7003 only (release-day exits not counted)', ['T7003'], [x.strip() for x in ew])
        rel.uncheck(); pg.wait_for_load_state('networkidle'); time.sleep(1)
        ew2 = sorted(x.strip() for x in pg.locator('[data-section="Early-exit warnings"] tbody tr td:first-child').all_inner_texts())
        check('edge: unticking 7 Oct → only T7003 still has 3+ exits (others have 1)', ['T7003'], ew2)
        t4 = pg.locator('[data-section="Action list"] tbody tr', has_text='T7004').inner_text()
        check('edge: unticked → T7004 workdays lost 1.17 (release-day exit now counted)', True, '1.17' in t4)
        rel.check(); pg.wait_for_load_state('networkidle'); time.sleep(1)

        print('\n— admin: rules & exclusions —')
        pg.get_by_role('button', name='Rules & exclusions').click(); time.sleep(.8)
        cfg = pg.get_by_test_id('ar-config')
        check('config shows built-in defaults', True, cfg.get_by_text('built-in defaults').count() == 1)
        cfg.get_by_label('Left out of everything — employee codes').fill('T7004')
        cfg.get_by_label('Effective from').fill('2026-10')
        cfg.get_by_role('button', name='Save as new version').click(); time.sleep(1.5)
        check('saved version shown', True, cfg.get_by_text('version 1, effective 2026-10').count() == 1)
        check('T7004 gone from action list after save', ['T7001', 'T7002'], action_codes(pg))
        check('excluded count shown', True, pg.get_by_text('1 excluded by config').count() == 1)
        # edge: an invalid threshold is refused by the server, nothing saved
        cfg.locator('summary', has_text='Thresholds').click()
        cfg.get_by_label('act_workdays').fill('')
        cfg.get_by_role('button', name='Save as new version').click(); time.sleep(1.2)
        check('edge: blank threshold refused (still version 1)', True, cfg.get_by_text('version 1, effective 2026-10').count() == 1)
        pg.get_by_role('button', name='Hide rules & exclusions').click(); time.sleep(.3)

        print('\n— admin: generate draft, override, finalise —')
        pg.get_by_role('button', name='Generate draft').click(); time.sleep(1.5)
        check('status DRAFT', 'DRAFT', status(pg))
        fin = pg.get_by_role('button', name='Finalise')
        check('Finalise enabled for a saved draft', True, fin.is_enabled())
        pg.get_by_label('Override code').fill('T7001'); pg.get_by_label('Override action').select_option('warning')
        pg.get_by_label('Override reason').fill('confirm shift with HR first')
        pg.get_by_role('button', name='Add override').click(); pg.wait_for_load_state('networkidle'); time.sleep(1)
        check('unsaved change → live preview message', True, pg.get_by_text('you have unsaved changes').count() == 1)
        check('unsaved change → Finalise disabled', False, fin.is_enabled())
        t7001 = pg.locator('[data-section="Action list"] tbody tr', has_text='T7001')
        check('preview shows T7001 as warning with reason', True, 'Warning' in t7001.inner_text() and 'confirm shift' in t7001.inner_text())
        pg.get_by_role('button', name='Regenerate draft').click(); time.sleep(1.5)
        check('regenerated → Finalise enabled', True, fin.is_enabled())
        check('deduction days now 0.0 (T7001 downgraded)', '0.0', stat(pg, 'Deduction days'))
        pg.once('dialog', lambda d: d.accept())
        fin.click(); time.sleep(1.5)
        check('status FINAL', 'FINAL', status(pg))
        check('final: no Generate / Regenerate button', 0, pg.get_by_role('button', name='Regenerate draft').count() + pg.get_by_role('button', name='Generate draft').count())
        check('final: release days + override listed', True, pg.get_by_text('confirm shift with HR first').count() >= 1)
        pg.reload(); pg.wait_for_load_state('networkidle'); time.sleep(1.2)
        check('reload keeps FINAL', 'FINAL', status(pg))
        check('admin: 0 page errors', [], errs)
        check('admin: 0 console errors apart from the refused blank threshold', [], [m for m in cons if '400' not in m and '/config' not in m])
        check('admin: only API error = the refused blank threshold (400 on /config)', True, len(bad) == 1 and bad[0].startswith('400') and '/config' in bad[0])

        print('\n— HR: no tab, direct URL refused, no API call —')
        ctx2 = b.new_context(viewport={'width': 1440, 'height': 900})
        pg2, errs2, cons2, bad2, calls2 = login(ctx2, 'hr', 'Indriyan@2025')
        pg2.goto(BASE + '/analytics/overview'); pg2.wait_for_load_state('networkidle')
        check('HR: no Attendance Review tab link', 0, pg2.locator('a[href="/analytics/attendance-review"]').count())
        pg2.goto(BASE + '/analytics/attendance-review'); pg2.wait_for_load_state('networkidle'); time.sleep(.8)
        check('HR: admin-only message', 1, pg2.get_by_text('available to admin only').count())
        check('HR: no attendance-review API call made', [], calls2)
        check('HR: 0 page errors', [], errs2)

        print('\n— phone width 390 (admin) —')
        ctx3 = b.new_context(viewport={'width': 390, 'height': 844})
        pg3, errs3, _, _, _ = login(ctx3, 'admin', 'Admin@123')
        open_tab(pg3)
        check('phone: FINAL review renders', 'FINAL', status(pg3))
        pg3.screenshot(path=os.environ.get('AR_SHOT', os.path.join(WORK, 'phone.png')), full_page=True)
        check('phone: 0 page errors', [], errs3)
        if os.environ.get('AR_SHOT_DESKTOP'):
            pg.set_viewport_size({'width': 1440, 'height': 900}); pg.screenshot(path=os.environ['AR_SHOT_DESKTOP'], full_page=True)
        b.close()
finally:
    srv.terminate()
    if FAIL: print(open(f'{WORK}/log').read()[-3000:])
    shutil.rmtree(WORK, ignore_errors=True)

print(f'\n{PASS} passed, {FAIL} failed')
sys.exit(1 if FAIL else 0)
