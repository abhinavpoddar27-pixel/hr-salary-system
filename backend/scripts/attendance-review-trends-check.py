#!/usr/bin/env python3
"""Attendance Review → Trends (T1–T3) — browser check.

Chromium against the BUILT dist, real admin login, scratch DATA_DIR, fictional codes G90xx (repo is public).
Attendance only in Aug, Sep, Oct 2026 (May–Jul empty). 12-hour masters (08:00–20:00), import flags set:
  G9001 PRODUCTION  late 45 min on 12 days in Aug, Sep and Oct  → on the list 3 months (repeat name)
  G9002 PRODUCTION  late on 12 days in Oct only                 → on the list once
  G9003 STORES      on time
  G9004 STORES      contract, leaves 2 h early on 10 days in Sep
September is generated and finalised through the API first, so it shows as Final; Aug and Oct are computed live.
Flow: view switch → Trends (6 months) → sources line, stat tiles, four charts render with points/bars → hover shows a
tooltip → heat-map hover detail → repeat-names dots → Workers: Contract changes the rate → Show as tables → 3 months
range → click September on the action-list chart opens September (FINAL) → a month range with no attendance says so →
phone width → trends write nothing.

Usage: npm run build --prefix frontend; python3 backend/scripts/attendance-review-trends-check.py
"""
import datetime, os, sqlite3, subprocess, tempfile, time, urllib.request
from playwright.sync_api import sync_playwright

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
PORT = int(os.environ.get('PORT', '3994')); BASE = f'http://127.0.0.1:{PORT}'
WORK = tempfile.mkdtemp(prefix='ar-trends-'); DB = os.path.join(WORK, 'hr_system.db')
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


def seed():
    c = sqlite3.connect(DB)
    s12 = c.execute("SELECT id FROM shifts WHERE code='12HR'").fetchone()[0]
    people = [('G9001', 'PRODUCTION', 0), ('G9002', 'PRODUCTION', 0), ('G9003', 'STORES', 0), ('G9004', 'STORES', 1)]
    for n, (code, dept, con) in enumerate(people, 1):
        c.execute("INSERT INTO employees(code,name,department,designation,company,status,employment_type,is_contractor,gross_salary,date_of_joining,default_shift_id) "
                  "VALUES(?,?,?,'OPERATOR',?,'Active',?,?,20000,'2024-01-01',?)", (code, f'TEST TREND {n}', dept, C, 'Contract' if con else 'Permanent', con, s12))
    for m in (8, 9, 10):
        for i, iso in enumerate(weekdays(2026, m)[:22]):
            for code, _, _ in people:
                late = i < 12 and (code == 'G9001' or (code == 'G9002' and m == 10))
                early = code == 'G9004' and m == 9 and i < 10
                c.execute("INSERT INTO attendance_processed(employee_code,date,status_original,status_final,in_time_final,out_time_final,shift_detected,"
                          "is_late_arrival,late_by_minutes,is_early_departure,early_by_minutes,is_left_late,is_miss_punch,month,year,company) "
                          "VALUES(?,?,'P','P',?,?,'12-Hour Shift',?,?,?,?,0,0,?,?,?)",
                          (code, iso, '08:45' if late else '08:00', '18:00' if early else '20:00', 1 if late else 0, 45 if late else 0,
                           1 if early else 0, 120 if early else 0, m, 2026, C))
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
        pg = login(b.new_context(viewport={'width': 1440, 'height': 1000})); errs, bad = [], []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.on('response', lambda r: bad.append(f'{r.status} {r.url}') if '/api/' in r.url and r.status >= 400 and r.request.method == 'GET' else None)

        print('\n— September finalised through the API —')
        g = api(pg, 'POST', '/api/analytics/attendance-review/runs', {'month': 9, 'year': 2026, 'releaseDays': [], 'overrides': []})
        rid = (g['body'] or {}).get('data', {}).get('id')
        f = api(pg, 'PUT', f'/api/analytics/attendance-review/runs/{rid}/finalise', {'acknowledge': 'Synthetic test month, checks reviewed'})
        check('Sep run generated + finalised', [True, 200], [g['status'] in (200, 201), f['status']])
        runs_before = q('SELECT COUNT(*) n FROM attendance_review_runs')[0]['n']

        pg.goto(BASE + '/analytics/attendance-review'); pg.wait_for_load_state('networkidle'); pick_month(pg, 10, 2026)

        print('\n— Trends, 6 months —')
        check('view switch shows "Oct 2026" and "Trends"', [1, 1], [pg.get_by_test_id('ar-view-month').filter(has_text='Oct 2026').count(), pg.get_by_test_id('ar-view-trends').count()])
        pg.get_by_test_id('ar-view-trends').click()
        pg.get_by_test_id('ar-trends-sources').wait_for(timeout=30000); time.sleep(1)
        src = pg.get_by_test_id('ar-trends-sources').inner_text()
        check('sources: Aug live, Sep final, Oct live', True, 'Aug 26: Not reviewed' in src and 'Sep 26: Final' in src and 'Oct 26: Not reviewed' in src)
        check('sources: May–Jul left out (no attendance)', True, all(f'{m} 26 (no attendance)' in src for m in ('May', 'Jun', 'Jul')))
        stats = pg.get_by_test_id('ar-trends-stats').inner_text()
        check('stat tiles name Oct and compare with Aug', True, 'Oct 26' in stats.upper().replace('OCT 26', 'Oct 26') or 'OCT 26' in stats.upper())
        check('deductions tile: 2 in Oct, ▲ 1 vs Aug', True, '2' in stats and '▲ 1' in stats)
        for t in ('ar-trends-rates', 'ar-trends-actions', 'ar-trends-lost', 'ar-trends-departments'):
            check(f'{t} renders', 1, pg.get_by_test_id(t).count())
        check('rates chart: one direct label per line, on Oct only', 2, pg.get_by_test_id('ar-trends-rates').locator('.recharts-label-list text').count())
        check('rates chart: 2 lines', 2, pg.get_by_test_id('ar-trends-rates').locator('.recharts-line').count())
        check('rates chart: Sep point solid, Aug hollow', ['#2a78d6', '#fff'],
              [pg.get_by_test_id('ar-trends-rates').locator('.recharts-line').first.locator('circle').nth(1).get_attribute('fill'),
               pg.get_by_test_id('ar-trends-rates').locator('.recharts-line').first.locator('circle').nth(0).get_attribute('fill')])
        check('action chart: 3 months of bars', True, pg.get_by_test_id('ar-trends-actions').locator('.recharts-bar-rectangle').count() >= 3)
        pg.get_by_test_id('ar-trends-actions').screenshot(path=os.path.join(WORK, 'actions.png'))
        pg.get_by_test_id('ar-trends').screenshot(path=os.path.join(WORK, 'trends.png'))

        print('\n— hover —')
        box = pg.get_by_test_id('ar-trends-rates').locator('.recharts-cartesian-grid').bounding_box()
        pg.mouse.move(box['x'] + box['width'] - 4, box['y'] + box['height'] / 2); time.sleep(.6)
        tip = pg.get_by_test_id('ar-trends-rates').locator('.recharts-tooltip-wrapper').inner_text()
        check('tooltip on the rates chart names Oct 26, its source and both series', True, 'Oct 26' in tip and 'Not reviewed' in tip and 'Late' in tip and 'Early exit' in tip)
        heat = pg.get_by_test_id('ar-trends-heatmap')
        check('heat map: 2 departments × 3 months', 6, heat.locator('td[aria-label]').count())
        heat.locator('td[aria-label^="PRODUCTION Oct 26"]').hover(); time.sleep(.3)
        hv = pg.get_by_test_id('ar-trends-heat-hover').inner_text()
        check('heat-map hover detail for PRODUCTION Oct', True, hv.startswith('PRODUCTION, Oct 26') and '24 lates' in hv)

        print('\n— repeat names —')
        rep = pg.get_by_test_id('ar-trends-repeaters'); rep.screenshot(path=os.path.join(WORK, 'repeaters.png'))
        check('only G9001 repeats', ['G9001'], rep.locator('tr[data-code]').evaluate_all('els => els.map(e => e.dataset.code)'))
        # August is the first month with data, so everyone there is a newcomer → a warning, not a deduction
        check('G9001: Aug warning, Sep + Oct deductions', [1, 2], [rep.locator('tr[data-code="G9001"] [aria-label="warning"]').count(),
              rep.locator('tr[data-code="G9001"] [aria-label="deduction"]').count()])

        print('\n— filters —')
        def sep_early():
            pg.get_by_label('Show as tables').check(); time.sleep(.4)
            row = pg.get_by_test_id('ar-trends-table').locator('tr', has_text='Sep 26').inner_text().split('\t')
            pg.get_by_label('Show as tables').uncheck(); time.sleep(.3)
            return row
        all_row = sep_early()
        pg.get_by_role('button', name='Contract', exact=True).click(); time.sleep(.4)
        con_row = sep_early()
        check('table view: Sep 26 row, source Final', ['Sep 26', 'Final'], all_row[:2])
        check('Contract filter: 1 person, early exit % rises above All', [True, True], [con_row[2].strip() == '1', float(con_row[4]) > float(all_row[4])])
        pg.get_by_role('button', name='All workers').click()
        pg.get_by_role('button', name='3 months').click(); pg.get_by_test_id('ar-trends-sources').wait_for(); time.sleep(1.5)
        check('3 months: Aug–Oct, nothing left out', True, 'left out' not in pg.get_by_test_id('ar-trends-sources').inner_text())

        print('\n— click a month opens it —')
        act = pg.get_by_test_id('ar-trends-actions')
        tick = act.locator('.recharts-xAxis .recharts-cartesian-axis-tick', has_text='Sep 26').bounding_box()
        grid = act.locator('.recharts-cartesian-grid').bounding_box()
        pg.mouse.move(tick['x'] + tick['width'] / 2, grid['y'] + grid['height'] * 0.8); time.sleep(.3)
        pg.mouse.click(tick['x'] + tick['width'] / 2, grid['y'] + grid['height'] * 0.8); pg.wait_for_load_state('networkidle'); time.sleep(1.5)
        check('month picker shows September 2026', ['9', '2026'], [pg.locator('select').filter(has=pg.locator('option', has_text='October')).first.input_value(),
              pg.locator('select').filter(has=pg.locator('option', has_text='2026')).first.input_value()])
        check('September opens, FINAL', ['FINAL', 1], [pg.get_by_test_id('ar-status').inner_text().strip(), pg.get_by_test_id('ar-view-month').filter(has_text='Sep 2026').count()])

        print('\n— edge: no attendance in range —')
        pick_month(pg, 3, 2026); pg.get_by_test_id('ar-view-trends').click(); time.sleep(2)
        check('says "No attendance in Jan 26 – Mar 26"', 1, pg.get_by_text('No attendance in Jan 26 – Mar 26').count())

        print('\n— phone width 390 —')
        ph = login(b.new_context(viewport={'width': 390, 'height': 844})); perr = []
        ph.on('pageerror', lambda e: perr.append(str(e)))
        ph.goto(BASE + '/analytics/attendance-review'); ph.wait_for_load_state('networkidle'); pick_month(ph, 10, 2026)
        ph.get_by_test_id('ar-view-trends').click(); ph.get_by_test_id('ar-trends-sources').wait_for(timeout=30000); time.sleep(1)
        check('phone: charts render', 1, ph.get_by_test_id('ar-trends-rates').count())
        check('phone: no horizontal page scroll', True, ph.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1'))
        ph.screenshot(path=os.path.join(WORK, 'phone.png'), full_page=True)
        check('phone: 0 page errors', [], perr)
        check('0 page errors', [], errs)
        check('0 failed GET calls', [], bad)
        b.close()
    check('trends wrote nothing (runs unchanged)', runs_before, q('SELECT COUNT(*) n FROM attendance_review_runs')[0]['n'])
finally:
    srv.terminate()
    try: srv.wait(timeout=10)
    except Exception: srv.kill()

print(f'\n{PASS} passed, {FAIL} failed  (screenshots: {WORK}/trends.png, actions.png, phone.png)')
raise SystemExit(1 if FAIL else 0)
