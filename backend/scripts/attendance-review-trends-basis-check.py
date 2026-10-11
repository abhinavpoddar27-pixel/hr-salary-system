#!/usr/bin/env python3
"""Attendance Review → Trends T5 (18-month range, rules version per month, Measured-on what-if) — browser check.

Chromium against the BUILT dist, real admin login, scratch DATA_DIR, fictional codes G40xx (repo is public).
Attendance Aug, Sep, Oct 2026 only (the other 15 months of an 18-month range are empty).
  G4001 PACKING  master shift 07:30–16:30 (own shift T5X); punches 07:30–16:30. The import matched the 12-hour shift and
                 flagged an early exit of 210 min on 10 days every month → import basis: early exits; master basis: none.
  G4002 PACKING  12-hour master, late 45 min on 12 days each month (on the list on both bases)
  G4003 STORES   12-hour master, on time
A rules version is saved through the API (effective 2026-08) and September is generated + finalised, so September is
"Final", August/October "Not reviewed" and every month is labelled with that version.
Flow: Trends → 18 months → sources line names the version on every month and equals the API → Show as tables has the
Rules column → Excel has "Rules version" = the API → Measured on: Import shift → amber what-if line, all months What-if,
same figures as the API's basis=import → Master shift → early exit % drops (G4001 measured on its own shift) → Excel
what-if file → As saved → back to Final/Not reviewed, line gone → click a month still opens it → phone 390 → nothing written.

Usage: npm run build --prefix frontend; python3 backend/scripts/attendance-review-trends-basis-check.py
"""
import datetime, os, re, sqlite3, subprocess, tempfile, time, urllib.request, zipfile
from playwright.sync_api import sync_playwright

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
PORT = int(os.environ.get('PORT', '3994')); BASE = f'http://127.0.0.1:{PORT}'
WORK = tempfile.mkdtemp(prefix='ar-trends-basis-'); DB = os.path.join(WORK, 'hr_system.db')
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


def seed():
    c = sqlite3.connect(DB)
    c.execute("INSERT INTO shifts(name,code,start_time,end_time,duration_hours) VALUES('T5 Short','T5X','07:30','16:30',9)")
    s12 = c.execute("SELECT id FROM shifts WHERE code='12HR'").fetchone()[0]
    sx = c.execute("SELECT id FROM shifts WHERE code='T5X'").fetchone()[0]
    people = [('G4001', 'PACKING', sx), ('G4002', 'PACKING', s12), ('G4003', 'STORES', s12)]
    for n, (code, dept, sid) in enumerate(people, 1):
        c.execute("INSERT INTO employees(code,name,department,designation,company,status,employment_type,is_contractor,gross_salary,date_of_joining,default_shift_id) "
                  "VALUES(?,?,?,'OPERATOR',?,'Active','Permanent',0,20000,'2024-01-01',?)", (code, f'TEST BASIS {n}', dept, C, sid))
    for m in (8, 9, 10):
        for i, iso in enumerate(weekdays(2026, m)[:22]):
            for code, _, _ in people:
                if code == 'G4001':
                    it, ot, late, early = '07:30', '16:30', 0, (210 if i < 10 else 0)
                else:
                    late = 45 if (code == 'G4002' and i < 12) else 0
                    it, ot, early = ('08:45' if late else '08:00'), '20:00', 0
                c.execute("INSERT INTO attendance_processed(employee_code,date,status_original,status_final,in_time_final,out_time_final,shift_detected,"
                          "is_late_arrival,late_by_minutes,is_early_departure,early_by_minutes,is_left_late,is_miss_punch,month,year,company) "
                          "VALUES(?,?,'P','P',?,?,'12-Hour Shift',?,?,?,?,0,0,?,?,?)",
                          (code, iso, it, ot, 1 if late else 0, late, 1 if early else 0, early, m, 2026, C))
    c.commit(); c.close()


def login(ctx):
    pg = ctx.new_page()
    pg.goto(BASE + '/login'); pg.get_by_placeholder('admin').fill('admin'); pg.get_by_placeholder('••••••••').fill('Admin@123')
    pg.get_by_role('button', name='Sign in').click(); pg.wait_for_url(lambda u: '/login' not in u)
    return pg


def api(pg, method, path, body=None):
    return pg.evaluate("""async ([m, p, b]) => { const t = localStorage.getItem('hr_token');
        const r = await fetch(p, { method: m, credentials: 'include', headers: Object.assign({ 'content-type': 'application/json' }, t ? { Authorization: 'Bearer ' + t } : {}),
          body: b ? JSON.stringify(b) : undefined }); let j = null; try { j = await r.json() } catch {} return { status: r.status, body: j } }""", [method, path, body])


def pick_month(pg, m, y):
    pg.locator('select').filter(has=pg.locator('option', has_text='October')).first.select_option(str(m))
    pg.locator('select').filter(has=pg.locator('option', has_text='2026')).first.select_option(str(y))
    pg.wait_for_load_state('networkidle'); time.sleep(1)


def wait_sources(pg, contains):
    for _ in range(120):
        try:
            t = pg.get_by_test_id('ar-trends-sources').inner_text(timeout=500)
            if contains in t: return t
        except Exception: pass
        time.sleep(.5)
    return pg.get_by_test_id('ar-trends-sources').inner_text()


def table_rows(pg):
    pg.get_by_label('Show as tables').check(); time.sleep(.4)
    rows = pg.get_by_test_id('ar-trends-table').locator('tbody tr').evaluate_all('els => els.map(e => [...e.cells].map(c => c.innerText.trim()))')
    pg.get_by_label('Show as tables').uncheck(); time.sleep(.3)
    return rows


def months_sheet(path):
    """Months sheet of the downloaded workbook as list of dicts (header row → values), via openpyxl."""
    import openpyxl
    ws = openpyxl.load_workbook(path, read_only=True)['Months']
    vals = [list(r) for r in ws.iter_rows(values_only=True)]
    return [dict(zip(vals[0], r)) for r in vals[1:]]


LABEL = lambda ym: datetime.date(int(ym[:4]), int(ym[5:]), 1).strftime('%b ') + ym[2:4]

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
        ctx = b.new_context(viewport={'width': 1440, 'height': 1000}, accept_downloads=True)
        pg = login(ctx); errs, bad = [], []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.on('response', lambda r: bad.append(f'{r.status} {r.url}') if '/api/' in r.url and r.status >= 400 and r.request.method == 'GET' else None)

        print('\n— set-up through the API: a rules version + September final —')
        cfg = api(pg, 'PUT', f'{AR}/config', {'effective_from': '2026-08', 'config': {'thresholds': {'notice_late': 5}}})
        vid = q('SELECT MAX(id) id FROM attendance_review_config')[0]['id']
        g = api(pg, 'POST', f'{AR}/runs', {'month': 9, 'year': 2026, 'releaseDays': [], 'overrides': []})
        rid = (g['body'] or {}).get('data', {}).get('id')
        f = api(pg, 'PUT', f'{AR}/runs/{rid}/finalise', {'acknowledge': 'Synthetic test month, checks reviewed'})
        check('config saved, Sep generated + finalised', [200, True, 200], [cfg['status'], g['status'] in (200, 201), f['status']])
        runs_before = q('SELECT COUNT(*) n FROM attendance_review_runs')[0]['n']

        pg.goto(BASE + '/analytics/attendance-review'); pg.wait_for_load_state('networkidle'); pick_month(pg, 10, 2026)
        pg.get_by_test_id('ar-view-trends').click(); wait_sources(pg, 'Oct 26')

        print('\n— 18-month range —')
        check('range buttons 3/6/12/18', ['3 months', '6 months', '12 months', '18 months'],
              pg.get_by_role('group', name='Range').locator('button').all_inner_texts())
        pg.get_by_role('button', name='18 months').click(); time.sleep(.5)
        src = wait_sources(pg, 'May 25 (no attendance)')
        check('18 months: May 25 … Jul 26 left out (15 months)', True, all(f'{LABEL(f"{y}-{m:02d}")} (no attendance)' in src
              for (y, m) in [(2025, 5), (2025, 12), (2026, 1), (2026, 7)]) and src.count('(no attendance)') == 15)
        check('18 months: Aug / Sep / Oct shown, Sep Final', True, 'Aug 26: Not reviewed' in src and 'Sep 26: Final' in src and 'Oct 26: Not reviewed' in src)
        trends = api(pg, 'GET', f'{AR}/trends?from=2025-05&to=2026-10')['body']['data']
        check('API 18 months: 3 rows, 15 skipped', [3, 15], [len(trends['months']), len(trends['skipped'])])

        print('\n— rules version per month —')
        labels = pg.get_by_test_id('ar-trends-rules').evaluate_all('els => els.map(e => [e.dataset.ym, e.innerText])')
        api_labels = [[m['ym'], f"(v{m['rules']['version']} · import shift)"] for m in trends['months']]
        check(f'every month labelled "(v{vid} · import shift)"', api_labels, labels)
        check('API: Sep from the run (configSource), Aug/Oct live; all the saved version', [['run', vid], ['live', vid], ['live', vid]],
              [[m['rules']['from'], m['rules']['version']] for m in sorted(trends['months'], key=lambda m: m['source'] != 'final')])
        tr = table_rows(pg)
        check('table: Rules column per month', [f'v{vid} · import shift'] * 3, [r[-1] for r in tr])

        print('\n— Excel (as saved) —')
        with pg.expect_download() as dl: pg.get_by_test_id('ar-trends-export').click()
        x = dl.value; xp = os.path.join(WORK, x.suggested_filename); x.save_as(xp)
        check('file name', 'Attendance_Trends_2026-08_to_2026-10.xlsx', x.suggested_filename)
        ms = months_sheet(xp)
        check('Months sheet: Rules version column = API', [f'v{vid} (from 2026-08)'] * 3, [r.get('Rules version') for r in ms])
        check('Months sheet: From = final for Sep, live for Aug/Oct', ['live', 'final', 'live'], [r.get('From') for r in ms])

        print('\n— Measured on: Import shift (what-if) —')
        saved_rows = table_rows(pg)
        check('no what-if line while "As saved"', 0, pg.get_by_test_id('ar-trends-whatif').count())
        pg.get_by_test_id('ar-trends-basis').get_by_role('button', name='Import shift').click()
        src = wait_sources(pg, 'What-if')
        check('amber what-if line shown', True, pg.get_by_test_id('ar-trends-whatif').is_visible() and 'not the saved reviews' in pg.get_by_test_id('ar-trends-whatif').inner_text())
        check('every month says What-if, none Final', [3, 0], [src.count(': What-if'), src.count('Final')])
        imp = api(pg, 'GET', f'{AR}/trends?from=2025-05&to=2026-10&basis=import')['body']['data']
        imp_rows = table_rows(pg)
        check('import what-if table = API basis=import (late %, early %)', [[f"{m['all']['late_pct']:.1f}", f"{m['all']['early_pct']:.1f}"] for m in imp['months']],
              [[r[3], r[4]] for r in imp_rows])
        check('API basis=import rows are what_if + live', [[True, 'live']] * 3, [[m.get('what_if'), m['source']] for m in imp['months']])

        print('\n— Master shift —')
        pg.get_by_test_id('ar-trends-basis').get_by_role('button', name='Master shift').click()
        src = wait_sources(pg, 'master shift')
        mas = api(pg, 'GET', f'{AR}/trends?from=2025-05&to=2026-10&basis=master')['body']['data']
        mas_rows = table_rows(pg)
        check('master what-if table = API basis=master (early %)', [f"{m['all']['early_pct']:.1f}" for m in mas['months']], [r[4] for r in mas_rows])
        check('master: G4001 measured on its own shift → early exit % falls to 0 every month', [0, 0, 0], [m['all']['early_pct'] for m in mas['months']])
        check('import shift showed early exits (the figures differ)', True, all(float(r[4]) > 0 for r in imp_rows))
        check('labels say master shift', 3, src.count('master shift'))
        with pg.expect_download() as dl: pg.get_by_test_id('ar-trends-export').click()
        x = dl.value; xp = os.path.join(WORK, x.suggested_filename); x.save_as(xp)
        check('what-if Excel file name', 'Attendance_Trends_2026-08_to_2026-10_what-if-master.xlsx', x.suggested_filename)
        ms = months_sheet(xp)
        check('what-if Excel: From what-if, Basis master, version kept', [['what-if (live)', 'master', f'v{vid} (from 2026-08)']] * 3,
              [[r.get('From'), r.get('Basis'), r.get('Rules version')] for r in ms])
        pg.get_by_test_id('ar-trends').screenshot(path=os.path.join(WORK, 'whatif.png'))

        print('\n— back to As saved —')
        pg.get_by_test_id('ar-trends-basis').get_by_role('button', name='As saved').click()
        src = wait_sources(pg, 'Final')
        check('As saved: what-if line gone, Sep Final again', [0, True], [pg.get_by_test_id('ar-trends-whatif').count(), 'Sep 26: Final' in src])
        check('As saved table = the first one', saved_rows, table_rows(pg))

        print('\n— click a month still opens it —')
        act = pg.get_by_test_id('ar-trends-actions')
        tick = act.locator('.recharts-xAxis .recharts-cartesian-axis-tick', has_text='Sep 26').bounding_box()
        grid = act.locator('.recharts-cartesian-grid').bounding_box()
        pg.mouse.move(tick['x'] + tick['width'] / 2, grid['y'] + grid['height'] * 0.8); time.sleep(.3)
        pg.mouse.click(tick['x'] + tick['width'] / 2, grid['y'] + grid['height'] * 0.8); pg.wait_for_load_state('networkidle'); time.sleep(1.5)
        check('September opens, FINAL', ['FINAL', 1], [pg.get_by_test_id('ar-status').inner_text().strip(), pg.get_by_test_id('ar-view-month').filter(has_text='Sep 2026').count()])

        print('\n— phone width 390 —')
        ph = login(b.new_context(viewport={'width': 390, 'height': 844})); perr = []
        ph.on('pageerror', lambda e: perr.append(str(e)))
        ph.goto(BASE + '/analytics/attendance-review'); ph.wait_for_load_state('networkidle'); pick_month(ph, 10, 2026)
        ph.get_by_test_id('ar-view-trends').click(); wait_sources(ph, 'Oct 26')
        ph.get_by_role('button', name='18 months').click(); time.sleep(.5)
        ph.get_by_test_id('ar-trends-basis').get_by_role('button', name='Master shift').click(); wait_sources(ph, 'What-if')
        check('phone: what-if line + charts', [True, 1], [ph.get_by_test_id('ar-trends-whatif').is_visible(), ph.get_by_test_id('ar-trends-rates').count()])
        check('phone: no horizontal page scroll', True, ph.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1'))
        ph.screenshot(path=os.path.join(WORK, 'phone.png'), full_page=True)
        check('phone: 0 page errors', [], perr)
        check('0 page errors', [], errs)
        check('0 failed GET calls', [], bad)
        b.close()
    check('trends wrote no run (runs unchanged)', runs_before, q('SELECT COUNT(*) n FROM attendance_review_runs')[0]['n'])
    check('exports audited (2 rows, one what-if)', [2, 1], [q("SELECT COUNT(*) n FROM audit_log WHERE stage='ATTENDANCE_REVIEW_EXPORT' AND remark LIKE 'trends%'")[0]['n'],
          q("SELECT COUNT(*) n FROM audit_log WHERE stage='ATTENDANCE_REVIEW_EXPORT' AND remark LIKE '%what-if master%'")[0]['n']])
finally:
    srv.terminate()
    try: srv.wait(timeout=10)
    except Exception: srv.kill()

print(f'\n{PASS} passed, {FAIL} failed  (screenshots: {WORK}/whatif.png, phone.png)')
raise SystemExit(1 if FAIL else 0)
