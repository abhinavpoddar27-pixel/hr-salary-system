"""T4 — Attendance Review Trends additions — browser check.

Chromium against the BUILT dist, real admin login, scratch DATA_DIR, fictional codes TT0x (repo is public).
Aug–Oct 2026, import basis, 22 weekdays a month:
  TT01 late 45 min on 12 days every month; TT02 early exits of 70 min on 5 days in October; TT03 a loader late 5 days;
  TT04 clean. A notice-board print for October (up to the 15th) names TT01; a review finance row for September.
Flow: Trends view (3 months) → waterfall, money, funnel, bands, weekday, miss punches, data quality, top people, effect
cards render → "Show as tables" figures equal the API → click a top-people code → history window → Download Excel
(5 sheets) → phone width. 0 page errors; nothing written except the export audit row.

Usage: npm run build --prefix frontend; python3 backend/scripts/attendance-review-trends-more-check.py
"""
import datetime, json, os, re, sqlite3, subprocess, tempfile, time, urllib.request, zipfile
from playwright.sync_api import sync_playwright

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
PORT = int(os.environ.get('PORT', '3998')); BASE = f'http://127.0.0.1:{PORT}'
WORK = tempfile.mkdtemp(prefix='ar-t4-'); DB = os.path.join(WORK, 'hr_system.db')
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
    people = {'TT01': 'OPERATOR', 'TT02': 'OPERATOR', 'TT03': 'LOADER', 'TT04': 'OPERATOR'}
    for n, (code, des) in enumerate(people.items(), 1):
        c.execute("INSERT INTO employees(code,name,department,designation,company,status,employment_type,is_contractor,gross_salary,date_of_joining,default_shift_id) "
                  "VALUES(?,?,'PRODUCTION',?,?,'Active','Permanent',0,24000,'2024-01-01',?)", (code, f'TEST T4 {n}', des, C, s12))
    for m in (7, 8, 9, 10):
        for i, iso in enumerate(weekdays(2026, m)[:22]):
            for code in people:
                lm = 45 if (code == 'TT01' and m >= 8 and i < 12) or (code == 'TT03' and m == 10 and i < 5) else 0
                em = 70 if code == 'TT02' and m == 10 and i < 5 else 0
                c.execute("INSERT INTO attendance_processed(employee_code,date,status_original,status_final,in_time_final,out_time_final,shift_detected,"
                          "is_late_arrival,late_by_minutes,is_early_departure,early_by_minutes,is_left_late,is_miss_punch,month,year,company) "
                          "VALUES(?,?,'P','P',?,?,'12-Hour Shift',?,?,?,?,0,0,?,?,?)",
                          (code, iso, '08:45' if lm else '08:00', '18:50' if em else '20:00', 1 if lm else 0, lm, 1 if em else 0, em, m, 2026, C))
    c.execute("""INSERT INTO audit_log (table_name, record_id, field_name, old_value, new_value, changed_by, stage, remark)
      VALUES ('attendance_review_board', 202610, 'board_print', '', ?, 'admin', 'ATTENDANCE_REVIEW_BOARD_PRINT', 'No. 1')""",
              (json.dumps({'to': '2026-10-15', 'covered_to': '2026-10-15', 'listed': [['TT01', 8, 0, 0]], 'spotless': ['TT04']}),))
    c.commit(); c.close()


def login(ctx, user='admin', pw='Admin@123'):
    pg = ctx.new_page()
    pg.goto(BASE + '/login'); pg.get_by_placeholder('admin').fill(user); pg.get_by_placeholder('••••••••').fill(pw)
    pg.get_by_role('button', name='Sign in').click(); pg.wait_for_url(lambda u: '/login' not in u)
    return pg


def api(pg, path):
    return pg.evaluate("""async (p) => { const t = localStorage.getItem('hr_token');
      const r = await fetch(p, { headers: { Authorization: 'Bearer ' + t } }); return { status: r.status, body: await r.json() } }""", path)


def open_trends(pg):
    pg.goto(BASE + '/analytics/attendance-review'); pg.wait_for_load_state('networkidle')
    pg.locator('select').filter(has=pg.locator('option', has_text='October')).first.select_option('10')
    pg.locator('select').filter(has=pg.locator('option', has_text='2026')).first.select_option('2026')
    pg.wait_for_load_state('networkidle'); time.sleep(1)
    pg.get_by_test_id('ar-view-trends').click()
    pg.get_by_role('button', name='3 months').click()
    pg.get_by_test_id('ar-trends-more').wait_for(timeout=60000); time.sleep(1.5)


env = dict(os.environ, DATA_DIR=WORK, JWT_SECRET='x', PORT=str(PORT), NODE_ENV='production',
           ADMIN_PASSWORD='Admin@123', HR_PASSWORD='Indriyan@2025', FINANCE_PASSWORD='Finance@2025')
srv = subprocess.Popen(['node', f'{ROOT}/backend/server.js'], env=env, stdout=open(f'{WORK}/log', 'w'), stderr=subprocess.STDOUT)
try:
    for _ in range(80):
        try: urllib.request.urlopen(BASE + '/api/version', timeout=2); break
        except Exception: time.sleep(.5)
    seed()
    before = [q(f'SELECT COUNT(*) n FROM {t}')[0]['n'] for t in ('attendance_review_runs', 'attendance_review_config', 'late_coming_deductions', 'salary_computations')]
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = login(b.new_context(viewport={'width': 1440, 'height': 900}, accept_downloads=True)); errs, bad = [], []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.on('response', lambda r: bad.append(f'{r.status} {r.url}') if '/api/' in r.url and r.status >= 400 else None)
        open_trends(pg)

        print('\n— sections —')
        for tid in ['waterfall-late', 'waterfall-early', 'money', 'funnel', 'bands', 'weekday', 'misspunch', 'quality', 'top', 'effect']:
            check(f'{tid} card shown', 1, pg.get_by_test_id(f'ar-trends-{tid}').count())
        check('waterfall chart drawn (svg bars)', True, pg.get_by_test_id('ar-trends-waterfall-late').locator('svg path').count() > 0)
        api_d = api(pg, '/api/analytics/attendance-review/trends?from=2026-08&to=2026-10')['body']['data']
        octm = api_d['months'][-1]
        check('API: Oct lates counted 12, loaders 5', [12, 5], [octm['waterfall']['lates']['counted'], octm['waterfall']['lates']['loaders']])
        check('API: Oct early counted 5 in the 60–119 band', 5, octm['distribution']['early_bands'][2]['count'])

        pg.get_by_test_id('ar-trends-more').screenshot(path=os.path.join(WORK, 'trends-more.png'))
        print('\n— tables equal the API —')
        pg.get_by_label('Show as tables').check() if pg.get_by_label('Show as tables').count() else pg.get_by_text('Show as tables').click()
        time.sleep(1)
        wrow = pg.get_by_test_id('ar-trends-waterfall-late').locator('tbody tr').last.inner_text().split('\t')
        w = octm['waterfall']['lates']
        check('late waterfall row (Oct) = API', [str(w['measured']), str(w['stayed_late']), str(w['full_hours']), str(w['loaders']), str(w['counted'])], [x.strip() for x in wrow[1:6]])
        top = pg.get_by_test_id('ar-trends-top').locator('tbody tr').first.inner_text()
        check('top person TT01 with a pattern label', True, 'TT01' in top and 'on a list in 3 months' in top)
        eff = pg.get_by_test_id('ar-trends-effect').inner_text()
        check('effect: a notice-board row and a notes row', True, 'Notice board' in eff and 'Notes' in eff)
        mp = pg.get_by_test_id('ar-trends-misspunch').locator('tbody tr').count()
        check('miss-punch table: 3 months', 3, mp)
        check('quality: import basis noted', True, 'import basis' in pg.get_by_test_id('ar-trends-quality').inner_text())

        print('\n— history window from top people —')
        pg.get_by_test_id('ar-trends-top').get_by_role('button', name='TT01').click()
        win = pg.get_by_test_id('ar-person'); win.wait_for(timeout=15000); time.sleep(1.5)
        check('history shows Oct board appearance', True, 'named' in win.get_by_test_id('ar-person-boards').inner_text())
        pg.keyboard.press('Escape'); time.sleep(.4)

        print('\n— Excel —')
        with pg.expect_download() as dl: pg.get_by_test_id('ar-trends-export').click()
        x = dl.value; xp = os.path.join(WORK, x.suggested_filename); x.save_as(xp)
        check('file name', 'Attendance_Trends_2026-08_to_2026-10.xlsx', x.suggested_filename)
        wbxml = zipfile.ZipFile(xp).read('xl/workbook.xml').decode()
        check('5 sheets', ['Months', 'Departments', 'Distribution', 'Top people', 'Effect'], re.findall(r'<sheet name="([^"]+)"', wbxml))

        print('\n— phone —')
        ph = login(b.new_context(viewport={'width': 390, 'height': 844}))
        ph.on('pageerror', lambda e: errs.append(str(e)))
        open_trends(ph)
        check('phone: funnel visible', True, ph.get_by_test_id('ar-trends-funnel').is_visible())
        check('0 page errors', [], errs)
        check('0 API errors', [], bad)
        b.close()
    after = [q(f'SELECT COUNT(*) n FROM {t}')[0]['n'] for t in ('attendance_review_runs', 'attendance_review_config', 'late_coming_deductions', 'salary_computations')]
    check('nothing written (runs, config, deductions, salary)', before, after)
    check('one export audit row', 1, q("SELECT COUNT(*) n FROM audit_log WHERE stage='ATTENDANCE_REVIEW_EXPORT'")[0]['n'])
finally:
    srv.terminate()
print(f'\n{PASS} passed, {FAIL} failed  (screenshot: {WORK}/trends-more.png)')
raise SystemExit(1 if FAIL else 0)
