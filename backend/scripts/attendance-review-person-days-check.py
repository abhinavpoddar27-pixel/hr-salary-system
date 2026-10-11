#!/usr/bin/env python3
"""PR-9 (G10) — Attendance Review person drill-down — browser check.

Chromium against the BUILT dist, real admin + hr logins, scratch DATA_DIR, fictional codes PDX1–PDX5 (repo is public).
Import basis for October 2026 (a DRAFT run with release day 14 Oct); rules effective Sep 2026 switch to the master basis
so September (no run) is computed live on the master:
  PDX1 late regular (12 lates of 45 min) + a 60-min early exit on the release day + one counted 50-min exit
  PDX2 re-measured on 09:00–18:00 (config), 9 lates of 30 min on it → late regular
  PDX3 clean control
  PDX4 no master shift (September on the master → not assessed)
  PDX5 night worker on a 12-hour master (September → measured 20:00–08:00)
Flow: tab → click PDX1 → history → expand October → day rows = API, totals = month row, release-day excuse shown →
expand September (no run, live) → PDX2 re-measured day reason → PDX4 / PDX5 via API (no master, night) → hr 403 →
phone 390: no page-level sideways scroll, the table scrolls in its own box → 0 page errors → nothing written.

Usage: npm run build --prefix frontend; python3 backend/scripts/attendance-review-person-days-check.py
"""
import datetime, json, os, sqlite3, subprocess, tempfile, time, urllib.request
from playwright.sync_api import sync_playwright

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
PORT = int(os.environ.get('PORT', '3992')); BASE = f'http://127.0.0.1:{PORT}'
WORK = tempfile.mkdtemp(prefix='ar-person-days-'); DB = os.path.join(WORK, 'hr_system.db')
C = 'Indriyan Beverages Pvt Ltd'
AR = '/api/analytics/attendance-review'
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


REL = '2026-10-14'
def seed():
    c = sqlite3.connect(DB)
    s12 = c.execute("SELECT id FROM shifts WHERE code='12HR'").fetchone()[0]
    for n, code in enumerate(['PDX1', 'PDX2', 'PDX3', 'PDX4', 'PDX5'], 1):
        c.execute("INSERT INTO employees(code,name,department,designation,company,status,employment_type,is_contractor,gross_salary,date_of_joining,default_shift_id) "
                  "VALUES(?,?,'PRODUCTION','OPERATOR',?,'Active','Permanent',0,22000,'2024-01-01',?)", (code, f'TEST DRILL {n}', C, None if code == 'PDX4' else s12))
    ins = ("INSERT INTO attendance_processed(employee_code,date,status_original,status_final,in_time_final,out_time_final,shift_detected,is_night_shift,"
           "is_late_arrival,late_by_minutes,is_early_departure,early_by_minutes,is_left_late,is_miss_punch,month,year,company) VALUES(?,?,'P','P',?,?,?,?,?,?,?,?,0,0,?,?,?)")
    def day(code, iso, it='08:00', ot='20:00', lm=0, em=0, sd='12-Hour Shift', night=0):
        c.execute(ins, (code, iso, it, ot, sd, night, 1 if lm else 0, lm, 1 if em else 0, em, int(iso[5:7]), 2026, C))
    for m in (9, 10):
        for i, iso in enumerate(weekdays(2026, m)[:22]):
            o = m == 10
            day('PDX1', iso, '08:45' if o and i < 12 else '08:00', '19:00' if o and iso == REL else '19:10' if o and i == 15 else '20:00',
                45 if o and i < 12 else 0, 60 if o and iso == REL else 50 if o and i == 15 else 0)
            day('PDX2', iso, '09:30' if o and i < 9 else '09:00', '18:00')
            day('PDX3', iso)
            day('PDX4', iso, '08:40', '18:00')
            if i < 10: day('PDX5', iso, '20:30' if i == 1 else '20:00', '08:00', 0, 0, 'Night Shift', 1)
    c.commit(); c.close()


def login(ctx, user='admin', pw='Admin@123'):
    pg = ctx.new_page()
    pg.goto(BASE + '/login'); pg.get_by_placeholder('admin').fill(user); pg.get_by_placeholder('••••••••').fill(pw)
    pg.get_by_role('button', name='Sign in').click(); pg.wait_for_url(lambda u: '/login' not in u)
    return pg


def api(pg, method, path, body=None):
    return pg.evaluate("""async ([m, p, b]) => { const t = localStorage.getItem('hr_token');
      const r = await fetch(p, { method: m, headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined });
      let j = null; try { j = await r.json() } catch {} return { status: r.status, body: j } }""", [method, path, body])


def open_tab(pg):
    pg.goto(BASE + '/analytics/attendance-review'); pg.wait_for_load_state('networkidle')
    pg.locator('select').filter(has=pg.locator('option', has_text='October')).first.select_option('10')
    pg.locator('select').filter(has=pg.locator('option', has_text='2026')).first.select_option('2026')
    pg.wait_for_load_state('networkidle'); time.sleep(1.5)


def ui_rows(win, ym):
    box = win.get_by_test_id(f'ar-days-{ym}')
    return box.locator('tbody tr').evaluate_all("els => els.map(e => [e.dataset.testid.slice(7), e.dataset.late, e.dataset.early])")


TABLES = ('employees', 'attendance_processed', 'attendance_review_runs', 'attendance_review_config', 'late_coming_deductions',
          'day_calculations', 'salary_computations', 'early_exit_deductions', 'short_leaves')

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
        pg = login(b.new_context(viewport={'width': 1440, 'height': 900})); errs, bad = [], []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.on('response', lambda r: bad.append(f'{r.status} {r.url}') if '/api/' in r.url and r.status >= 400 else None)

        print('\n— rules + draft (setup through the API, as the admin would in the tab) —')
        r = api(pg, 'PUT', f'{AR}/config', {'effective_from': '2026-09', 'config': {'assessment_basis': 'master'}})
        check('Sep rules: master basis saved', 200, r['status'])
        r = api(pg, 'PUT', f'{AR}/config', {'effective_from': '2026-10', 'config': {'remeasure': {'PDX2': {'start': '09:00', 'end': '18:00'}}}})
        check('Oct rules: import basis + re-measure PDX2', 200, r['status'])
        r = api(pg, 'POST', f'{AR}/runs', {'month': 10, 'year': 2026, 'releaseDays': [REL], 'overrides': []})
        check('Oct draft with release day 14 Oct', 201, r['status'])
        before = {t: q(f'SELECT COUNT(*) n FROM {t}')[0]['n'] for t in TABLES + ('audit_log',)}

        print('\n— tab → person → history → expand October —')
        open_tab(pg)
        pg.get_by_test_id('ar-code-PDX1').first.click()
        win = pg.get_by_test_id('ar-person'); win.wait_for(timeout=10000); time.sleep(1.5)
        orow = win.get_by_test_id('ar-person-2026-10').inner_text()
        win.get_by_test_id('ar-person-expand-2026-10').click()
        win.get_by_test_id('ar-days-2026-10').wait_for(timeout=10000); time.sleep(.5)
        apid = api(pg, 'GET', f'{AR}/person/PDX1/days?month=10&year=2026')['body']['data']
        rows = ui_rows(win, '2026-10')
        check('31 day rows', 31, len(rows))
        check('day rows = API (date, late, early)', [[d['date'][8:], d['late'], d['early']] for d in apid['days']], [[x[0][8:], x[1], x[2]] for x in rows])
        check('API: consistent with the engine', True, apid['consistent'])
        check('API: inputs from the draft run', 'draft', apid['rule_version']['source'])
        cells = orow.split('\t') if '\t' in orow else orow.split()
        lt = int(win.get_by_test_id('ar-days-2026-10').get_by_test_id('ar-days-total-late').get_attribute('data-days'))
        et = int(win.get_by_test_id('ar-days-2026-10').get_by_test_id('ar-days-total-early').get_attribute('data-days'))
        hist = api(pg, 'GET', f'{AR}/person/PDX1?to=2026-10')['body']['data']['months']
        oct_ = [m for m in hist if m['ym'] == '2026-10'][0]
        check('totals = month row (late 12, early 1)', [oct_['late_days'], oct_['early_exits'], 12, 1], [lt, et, lt, et])
        check('no mismatch note', 0, win.get_by_test_id('ar-days-mismatch').count())
        rel = win.get_by_test_id(f'ar-day-{REL}')
        check('release day: early excused with reason', ['excused:release_day', True], [rel.get_attribute('data-early'), 'plant release day' in rel.inner_text()])
        check('release-day chip carries the reason code', 'release_day', rel.get_by_test_id('ar-day-early-excuse').get_attribute('data-reason'))
        check('counted rows highlighted', True, 'bg-red-50' in (win.get_by_test_id('ar-day-2026-10-01').get_attribute('class') or ''))
        check('shift used shown', True, '08:00–20:00' in win.get_by_test_id('ar-day-2026-10-01').inner_text())

        print('\n— September: no run → live, on the master basis —')
        win.get_by_test_id('ar-person-expand-2026-09').click()
        win.get_by_test_id('ar-days-2026-09').wait_for(timeout=10000); time.sleep(.5)
        sep = api(pg, 'GET', f'{AR}/person/PDX1/days?month=9&year=2026')['body']['data']
        check('Sep: live, master basis', ['live', 'master'], [sep['rule_version']['source'], sep['basis']])
        check('Sep: 30 rows = API', [[d['date'][8:], d['late'], d['early']] for d in sep['days']], [[x[0][8:], x[1], x[2]] for x in ui_rows(win, '2026-09')])
        check('Sep text says master shift', True, 'current master shift' in win.get_by_test_id('ar-days-2026-09').inner_text())
        win.get_by_test_id('ar-person-expand-2026-09').click(); time.sleep(.3)
        check('collapse hides Sep', 0, win.get_by_test_id('ar-days-2026-09').count())
        pg.keyboard.press('Escape'); time.sleep(.4)

        print('\n— re-measured person —')
        pg.get_by_test_id('ar-code-PDX2').first.click(); win.wait_for(timeout=10000); time.sleep(1.2)
        win.get_by_test_id('ar-person-expand-2026-10').click(); win.get_by_test_id('ar-days-2026-10').wait_for(timeout=10000); time.sleep(.5)
        d1 = win.get_by_test_id('ar-day-2026-10-01')
        check('re-measured day: counted, shift "Re-measure 09:00–18:00", note re-measured', [True, True, True],
              ['counted' in d1.inner_text(), 'Re-measure 09:00–18:00' in d1.inner_text(), 're-measured' in d1.inner_text()])
        a2 = api(pg, 'GET', f'{AR}/person/PDX2/days?month=10&year=2026')['body']['data']
        check('re-measured: 9 lates = engine', [9, True, True], [a2['totals']['late_days'], a2['consistent'], a2['person']['remeasured']])
        pg.keyboard.press('Escape'); time.sleep(.4)

        print('\n— edge cases (user simulation): no master, night worker, no attendance, bad input —')
        a4 = api(pg, 'GET', f'{AR}/person/PDX4/days?month=9&year=2026')['body']['data']
        d = [x for x in a4['days'] if x['date'] == '2026-09-01'][0]
        check('no master: not assessed (no_master), nothing counted', ['no_master', 0, 0], [d['not_assessed_reason'], a4['totals']['late_days'], a4['totals']['early_days']])
        a5 = api(pg, 'GET', f'{AR}/person/PDX5/days?month=9&year=2026')['body']['data']
        d = [x for x in a5['days'] if x['date'] == weekdays(2026, 9)[1]][0]
        check('night worker: measured 20:00–08:00 (night), 30 min late counted',
              ['20:00', '08:00', 'night', 'counted', 30], [d['shift']['start'], d['shift']['end'], d['shift']['mode'], d['late'], d['late_minutes']])
        check('night worker: consistent', True, a5['consistent'])
        check('no attendance month → 404', 404, api(pg, 'GET', f'{AR}/person/PDX1/days?month=11&year=2026')['status'])
        check('bad month → 400', 400, api(pg, 'GET', f'{AR}/person/PDX1/days?month=0&year=2026')['status'])
        hr = login(b.new_context(viewport={'width': 1280, 'height': 900}), 'hr', 'Indriyan@2025')
        check('hr: days API refused (403)', 403, api(hr, 'GET', f'{AR}/person/PDX1/days?month=10&year=2026')['status'])

        print('\n— phone 390 —')
        ph = login(b.new_context(viewport={'width': 390, 'height': 844}))
        ph.on('pageerror', lambda e: errs.append(str(e)))
        open_tab(ph)
        ph.get_by_test_id('ar-code-PDX1').first.click()
        pw = ph.get_by_test_id('ar-person'); pw.wait_for(timeout=10000); time.sleep(1.2)
        pw.get_by_test_id('ar-person-expand-2026-10').click(); pw.get_by_test_id('ar-days-2026-10').wait_for(timeout=10000); time.sleep(.6)
        check('phone: no page-level sideways scroll', True, ph.evaluate('document.documentElement.scrollWidth <= window.innerWidth'))
        box = pw.get_by_test_id('ar-days-2026-10').get_by_test_id('ar-days-scroll')
        check('phone: the day table scrolls inside its own box', True, box.evaluate('e => e.scrollWidth > e.clientWidth && e.getBoundingClientRect().right <= window.innerWidth + 1'))
        check('phone: total row visible text', True, 'Counted' in box.inner_text())

        check('0 page errors', [], errs)
        check('0 API errors (bar the deliberate 400 / 404 / 403)', [], [x for x in bad if not any(s in x for s in ('month=11', 'month=0'))])
        b.close()
    after = {t: q(f'SELECT COUNT(*) n FROM {t}')[0]['n'] for t in TABLES + ('audit_log',)}
    check('nothing written (row counts unchanged incl. audit_log)', before, after)
finally:
    srv.terminate()
print(f'\n{PASS} passed, {FAIL} failed')
raise SystemExit(1 if FAIL else 0)
