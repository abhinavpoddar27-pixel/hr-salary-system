#!/usr/bin/env python3
"""PR-8 — Attendance Review plant-wide late days — browser check.

Chromium against the BUILT dist, real admin login, scratch DATA_DIR, fictional codes PL01–PL40 (repo is public).
Import basis, 12-hour day shift, September clean, October 20 weekdays each.
  6 Oct 2026 (Tue): 22 of the 40 people punch in at 08:52 (late 52 min) — a plant-wide late day.
  PL01 is also late 30 min on 8 other days → 9 lates = a late regular on the action list; with 6 Oct ticked → 8 lates,
       still on the list but with one late fewer. PL02 late on 7 other days → 8 with the day (on the list), 7 ticked (off).
  PL03 leaves 40 min early on 6 Oct → the early exit still counts when the day is ticked.
Flow: detected day shown UNTICKED, numbers = API → tick → action list / counts change, "N lates not counted" line →
generate draft saves the tick (DB) → reload keeps it ticked → untick → Finalise disabled (screen ≠ draft) → regenerate
clears the saved list → rules editor shows + saves the two thresholds (people 23 → the day is no longer detected) →
phone 390 → 0 page errors; payroll tables untouched.

Usage: npm run build --prefix frontend; python3 backend/scripts/attendance-review-plant-late-days-check.py
"""
import datetime, json, os, sqlite3, subprocess, tempfile, time, urllib.request
from playwright.sync_api import sync_playwright

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
PORT = int(os.environ.get('PORT', '3993')); BASE = f'http://127.0.0.1:{PORT}'
WORK = tempfile.mkdtemp(prefix='ar-plantlate-'); DB = os.path.join(WORK, 'hr_system.db')
C = 'Indriyan Beverages Pvt Ltd'
DAY = '2026-10-06'
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


CODES = [f'PL{i:02d}' for i in range(1, 41)]
def seed():
    c = sqlite3.connect(DB)
    s12 = c.execute("SELECT id FROM shifts WHERE code='12HR'").fetchone()[0]
    for n, code in enumerate(CODES, 1):
        c.execute("INSERT INTO employees(code,name,department,designation,company,status,employment_type,is_contractor,gross_salary,date_of_joining,default_shift_id) "
                  "VALUES(?,?,'PRODUCTION','OPERATOR',?,'Active','Permanent',0,26000,'2024-01-01',?)", (code, f'TEST PLANT {n}', C, s12))
    oct_days = weekdays(2026, 10)[:20]
    others = [d for d in oct_days if d != DAY]
    for m in (9, 10):
        for iso in weekdays(2026, m)[:20]:
            for n, code in enumerate(CODES, 1):
                lm = 0; em = 0
                if m == 10:
                    if iso == DAY and n <= 22: lm = 52
                    if code == 'PL01' and iso in others[:8]: lm = 30
                    if code == 'PL02' and iso in others[:7]: lm = 30
                    if code == 'PL03' and iso == DAY: em = 40
                tin = 480 + lm; tout = 1200 - em
                it = f'{tin // 60:02d}:{tin % 60:02d}'; ot = f'{tout // 60:02d}:{tout % 60:02d}'
                c.execute("INSERT INTO attendance_processed(employee_code,date,status_original,status_final,in_time_final,out_time_final,shift_detected,"
                          "is_late_arrival,late_by_minutes,is_early_departure,early_by_minutes,is_left_late,is_miss_punch,month,year,company) "
                          "VALUES(?,?,'P','P',?,?,'12-Hour Shift',?,?,?,?,0,0,?,?,?)",
                          (code, iso, it, ot, 1 if lm else 0, lm, 1 if em else 0, em, m, 2026, C))
    c.commit(); c.close()


def section(pg, title): return pg.locator(f'[data-section="{title}"]')
def row(pg, code): return section(pg, 'Action list').locator('tbody tr', has=pg.get_by_test_id(f'ar-code-{code}'))


def open_tab(pg):
    pg.goto(BASE + '/analytics/attendance-review'); pg.wait_for_load_state('networkidle')
    pg.locator('select').filter(has=pg.locator('option', has_text='October')).first.select_option('10')
    pg.locator('select').filter(has=pg.locator('option', has_text='2026')).first.select_option('2026')
    pg.wait_for_load_state('networkidle'); time.sleep(2)


def login(ctx, user='admin', pw='Admin@123'):
    pg = ctx.new_page()
    pg.goto(BASE + '/login'); pg.get_by_placeholder('admin').fill(user); pg.get_by_placeholder('••••••••').fill(pw)
    pg.get_by_role('button', name='Sign in').click(); pg.wait_for_url(lambda u: '/login' not in u)
    return pg


def api(pg, method, path, body=None):
    return pg.evaluate("""async ([m, p, b]) => { const t = localStorage.getItem('hr_token');
      const r = await fetch(p, { method: m, headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' }, body: b ? JSON.stringify(b) : undefined });
      let j = null; try { j = await r.json() } catch {} return { status: r.status, body: j } }""", [method, path, body])


def action_codes(pg):
    return sorted(t.strip() for t in section(pg, 'Action list').locator('[data-testid^="ar-code-"]').all_inner_texts())


def late_cell(pg, code):
    return row(pg, code).locator('td').nth(3).inner_text().split('(')[0].strip()


env = dict(os.environ, DATA_DIR=WORK, JWT_SECRET='x', PORT=str(PORT), NODE_ENV='production',
           ADMIN_PASSWORD='Admin@123', HR_PASSWORD='Indriyan@2025', FINANCE_PASSWORD='Finance@2025')
srv = subprocess.Popen(['node', f'{ROOT}/backend/server.js'], env=env, stdout=open(f'{WORK}/log', 'w'), stderr=subprocess.STDOUT)
try:
    for _ in range(80):
        try: urllib.request.urlopen(BASE + '/api/version', timeout=2); break
        except Exception: time.sleep(.5)
    seed()
    tables = ('day_calculations', 'salary_computations', 'late_coming_deductions')
    payroll_before = [q(f'SELECT COUNT(*) n FROM {t}')[0]['n'] for t in tables]
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = login(b.new_context(viewport={'width': 1440, 'height': 900})); errs, bad = [], []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.on('response', lambda r: bad.append(f'{r.status} {r.url}') if '/api/' in r.url and r.status >= 400 else None)
        open_tab(pg)

        print('\n— detected, unticked —')
        api_d = api(pg, 'GET', '/api/analytics/attendance-review?month=10&year=2026')['body']['data']['plantLateDays']
        check('API: one detected day', [DAY], [d['date'] for d in api_d['detected']])
        d0 = api_d['detected'][0]
        check('API: 22 of 40, 55%, median 52', [22, 40, 0.55, 52], [d0['late_people'], d0['assessed'], d0['share'], d0['median_late_minutes']])
        panel = pg.get_by_test_id('ar-plant-late')
        check('panel shown', True, panel.is_visible())
        box = pg.get_by_test_id(f'ar-plant-late-tick-{DAY}')
        check('the day is UNTICKED', False, box.is_checked())
        info = pg.get_by_test_id(f'ar-plant-late-info-{DAY}').inner_text()
        check('screen numbers = API', True, f"{d0['late_people']} of {d0['assessed']} late ({round(d0['share'] * 100)}%), median {d0['median_late_minutes']} min" in info)
        check('no "not counted" line while unticked', 0, pg.get_by_test_id('ar-plant-late-excused').count())
        check('action list before: PL01, PL02', ['PL01', 'PL02'], action_codes(pg))
        check('PL01 9 lates before', '9', late_cell(pg, 'PL01'))

        print('\n— tick —')
        box.check(); pg.wait_for_load_state('networkidle'); time.sleep(2)
        check('action list after tick: PL01 only', ['PL01'], action_codes(pg))
        check('PL01 8 lates', '8', late_cell(pg, 'PL01'))
        check('"22 late arrival(s) not counted"', True, '22 late arrival(s) not counted' in pg.get_by_test_id('ar-plant-late-excused').inner_text())
        pv = api(pg, 'GET', f'/api/analytics/attendance-review?month=10&year=2026&lateFreeDays={DAY}')['body']['data']
        pl03 = next((x for x in pv['people'] if x['code'] == 'PL03'), {})
        check('PL03 early exit on the ticked day still counts (API)', 1, pl03.get('early_days'))

        print('\n— generate draft, reload —')
        pg.get_by_role('button', name='Generate draft').click(); pg.get_by_text('Draft created').wait_for(timeout=15000)
        pg.wait_for_load_state('networkidle'); time.sleep(2)
        check('DB: late_free_days saved', json.dumps([DAY]), q('SELECT late_free_days FROM attendance_review_runs WHERE month=10 AND year=2026')[0]['late_free_days'].replace(', ', ','))
        fin = pg.get_by_role('button', name='Finalise')
        check('Finalise enabled (draft = screen)', True, fin.is_enabled())
        open_tab(pg)
        check('reload: still ticked', True, pg.get_by_test_id(f'ar-plant-late-tick-{DAY}').is_checked())
        check('reload: status DRAFT', 'DRAFT', pg.get_by_test_id('ar-status').inner_text().strip())

        print('\n— untick → screen ≠ draft; regenerate clears —')
        pg.get_by_test_id(f'ar-plant-late-tick-{DAY}').uncheck(); pg.wait_for_load_state('networkidle'); time.sleep(2)
        check('Finalise disabled while screen ≠ draft', False, pg.get_by_role('button', name='Finalise').is_enabled())
        check('preview shows PL02 back', ['PL01', 'PL02'], action_codes(pg))
        pg.get_by_role('button', name='Regenerate draft').click(); pg.get_by_text('Draft regenerated').wait_for(timeout=15000)
        pg.wait_for_load_state('networkidle'); time.sleep(2)
        check('DB: list cleared', '[]', q('SELECT late_free_days FROM attendance_review_runs WHERE month=10 AND year=2026')[0]['late_free_days'])
        check('Finalise enabled again', True, pg.get_by_role('button', name='Finalise').is_enabled())

        print('\n— rules editor —')
        pg.get_by_role('button', name='Rules & exclusions').click(); time.sleep(1)
        pg.get_by_text('Thresholds (change only on a ruling)').click()
        pp = pg.get_by_label('plant_late_min_people'); ps = pg.get_by_label('plant_late_min_share')
        check('thresholds shown: 15 and 0.25', ['15', '0.25'], [pp.input_value(), ps.input_value()])
        check('labelled', True, pg.get_by_text('Plant-wide late day: people late that day at least').is_visible())
        pp.fill('23'); pg.get_by_role('button', name='Save as new version').click(); time.sleep(2)
        cfg = q("SELECT json_extract(config_json,'$.thresholds.plant_late_min_people') a, json_extract(config_json,'$.thresholds.plant_late_min_share') b FROM attendance_review_config ORDER BY id DESC LIMIT 1")[0]
        check('saved version keeps both thresholds', [23, 0.25], [cfg['a'], cfg['b']])
        pg.get_by_role('button', name='Hide rules & exclusions').click(); pg.wait_for_load_state('networkidle'); time.sleep(2.5)
        check('no day detected at 23 people', 1, pg.get_by_test_id('ar-plant-late-none').count())

        print('\n— phone —')
        ph = login(b.new_context(viewport={'width': 390, 'height': 844}))
        ph.on('pageerror', lambda e: errs.append(str(e)))
        open_tab(ph)
        check('phone: panel visible', True, ph.get_by_test_id('ar-plant-late').is_visible())
        sw = ph.evaluate('document.documentElement.scrollWidth')
        check('phone: page renders', True, sw > 0)
        check('0 page errors', [], errs)
        check('0 API errors', [], bad)
        b.close()
    check('payroll tables untouched', payroll_before, [q(f'SELECT COUNT(*) n FROM {t}')[0]['n'] for t in tables])
finally:
    srv.terminate()
print(f'\n{PASS} passed, {FAIL} failed')
raise SystemExit(1 if FAIL else 0)
