#!/usr/bin/env python3
"""Lists show the change right after an action (N-FRESH: N-7, N-9) + finance opens Miss Punch with no 403 (N-15).

server.js answers every GET with `Cache-Control: private, max-age=5`, so a refetch inside 5 s of the previous read got
the browser's pre-action copy; and react-query (staleTime 30 s) kept other filter views of the same list.

Chromium against the BUILT dist, real hr + finance logins, scratch DATA_DIR, fictional data only (codes T98xx, names
"TEST FRESH n" — the repo is public). September 2026:
  T9801  Stage 6 employee (days 1–15 present, 16–30 absent; later 16–20 become present)
  T9811 / T9812  pending night-shift pairs (confirm / reject)
  T9821  Miss Punch HR pending (hr corrects it)    T9822 / T9823  finance pending (finance approves / rejects)

Usage:
  python3 backend/scripts/fresh-reads-check.py                 # this tree's server + dist
  APP_ROOT=/tmp/wt python3 .../fresh-reads-check.py --base     # another tree (origin/main): records the stale reads
Needs `npm run build --prefix frontend` in APP_ROOT first. PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers. Port 3133.
"""
import datetime, os, re, sqlite3, subprocess, sys, tempfile, time, urllib.request
from playwright.sync_api import sync_playwright

HERE_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
ROOT = os.path.abspath(os.environ.get('APP_ROOT', HERE_ROOT))
BASE_MODE = '--base' in sys.argv
PORT = int(os.environ.get('PORT', '3133')); BASE = f'http://127.0.0.1:{PORT}'
WORK = tempfile.mkdtemp(prefix='fresh-reads-'); DB = os.path.join(WORK, 'hr_system.db')
C = 'Asian Lakto Ind Ltd'
PASS = FAIL = 0
IDS, PAIR = {}, {}
STATUS = 'leave-automation/status'


def check(label, expected, actual):
    global PASS, FAIL
    if BASE_MODE: label = f'[base: expects old behaviour] {label}'
    if expected == actual: PASS += 1; print(f'  ✓ {label}')
    else: FAIL += 1; print(f'  ✗ {label} — expected {expected!r}, got {actual!r}')


def emp(c, code, n):
    c.execute("INSERT OR IGNORE INTO employees(code,name,department,company,status,employment_type,gross_salary,"
              "date_of_joining,weekly_off_day) VALUES(?,?,'TEST DEPT',?,'Active','Permanent',20000,'2025-01-01',0)",
              (code, f'TEST FRESH {n}', C))


def seed():
    c = sqlite3.connect(DB)
    emp(c, 'T9801', 1)
    for d in range(1, 31):
        dt = datetime.date(2026, 9, d)
        st = 'WO' if dt.weekday() == 6 else ('P' if d <= 15 else 'A')
        tin, tout = ('09:00', '18:00') if st == 'P' else (None, None)
        c.execute("INSERT INTO attendance_processed(employee_code,date,status_original,status_final,in_time_original,"
                  "in_time_final,out_time_original,out_time_final,month,year,company,stage_5_done) "
                  "VALUES('T9801',?,?,?,?,?,?,?,9,2026,?,1)", (dt.isoformat(), st, st, tin, tin, tout, tout, C))
    c.execute("INSERT OR IGNORE INTO monthly_imports(month,year,company,stage_1_done,stage_5_done) VALUES(9,2026,?,1,1)", (C,))
    for n, (code, ind, outd) in enumerate([('T9811', '2026-09-03', '2026-09-04'), ('T9812', '2026-09-08', '2026-09-09')], 2):
        emp(c, code, n)
        i = c.execute("INSERT INTO attendance_processed(employee_code,date,month,year,status_original,status_final,"
                      "in_time_original,in_time_final,out_time_final,is_night_shift,night_pair_date,is_miss_punch,company) "
                      "VALUES(?,?,9,2026,'P','P','20:05','20:05','08:10',1,?,0,?)", (code, ind, outd, C)).lastrowid
        o = c.execute("INSERT INTO attendance_processed(employee_code,date,month,year,status_original,status_final,"
                      "out_time_original,is_night_out_only,is_night_shift,night_pair_date,company) "
                      "VALUES(?,?,9,2026,'P','P','08:10',1,1,?,?)", (code, outd, ind, C)).lastrowid
        PAIR[code] = c.execute("INSERT INTO night_shift_pairs(employee_code,in_record_id,out_record_id,in_date,out_date,"
                               "in_time,out_time,calculated_hours,confidence,is_confirmed,is_rejected,month,year,company) "
                               "VALUES(?,?,?,?,?,'20:05','08:10',12.1,'medium',0,0,9,2026,?)",
                               (code, i, o, ind, outd, C)).lastrowid
    for n, (code, date, res, fs, tin, tout) in enumerate([
            ('T9821', '2026-09-10', 0, None, '09:00', None),
            ('T9822', '2026-09-11', 1, 'pending', '09:00', '18:00'),
            ('T9823', '2026-09-12', 1, 'pending', '09:00', '18:00')], 4):
        emp(c, code, n)
        IDS[code] = c.execute(
            "INSERT INTO attendance_processed(employee_code,date,month,year,company,status_original,status_final,"
            "in_time_original,out_time_original,in_time_final,out_time_final,is_miss_punch,miss_punch_type,"
            "miss_punch_resolved,miss_punch_finance_status) VALUES(?,?,9,2026,?,'P','P',?,?,?,?,1,'MISSING_OUT',?,?)",
            (code, date, C, tin, tout, tin if res else None, tout if res else None, res, fs)).lastrowid
    c.commit(); c.close()


def login(b, user, pw, width=1440):
    ctx = b.new_context(viewport={'width': width, 'height': 900})
    pg = ctx.new_page()
    log = {'errs': [], 'cons': [], 'bad': [], 'hdr': {}, 'status_calls': []}
    pg.on('pageerror', lambda e: log['errs'].append(str(e)))
    pg.on('console', lambda m: log['cons'].append(m.text) if m.type == 'error' and 'vite.svg' not in m.text
          and '404' not in m.text else None)
    pg.on('response', lambda r: log['bad'].append(f'{r.status} {r.url}') if '/api/' in r.url and r.status >= 400 else None)

    def on_req(r):
        for key in ('/attendance/miss-punches', '/attendance/night-shifts', '/payroll/day-calculations',
                    '/payroll/day-calc-staleness', '/daily-wage/entries'):
            if key in r.url and r.method == 'GET': log['hdr'][key] = r.headers.get('cache-control')
        if STATUS in r.url: log['status_calls'].append(r.url)
    pg.on('request', on_req)
    pg.goto(BASE + '/login'); pg.get_by_placeholder('admin').fill(user); pg.get_by_placeholder('••••••••').fill(pw)
    pg.get_by_role('button', name='Sign in').click(); pg.wait_for_url(lambda u: '/login' not in u)
    return pg, log


def pick_sept(pg):
    pg.locator('select').filter(has=pg.locator('option', has_text='September')).first.select_option('9')
    pg.locator('select').filter(has=pg.locator('option', has_text='2026')).first.select_option('2026')
    pg.wait_for_load_state('networkidle')


def goto(pg, path):
    pg.goto(BASE + path); pg.wait_for_load_state('networkidle'); pick_sept(pg)


def spa(pg, path):
    """Client-side navigation (keeps react-query's cache, unlike page.goto)."""
    pg.evaluate("p => { history.pushState({}, '', p); dispatchEvent(new PopStateEvent('popstate')) }", path)
    pg.wait_for_load_state('networkidle'); time.sleep(0.4)


def row(pg, code):
    return pg.locator('tbody > tr:not(.drill-down-row)', has_text=code).first


def has_row(pg, code):
    return pg.locator('tbody > tr:not(.drill-down-row)', has_text=code).count() > 0


def chip(pg, name):
    pg.get_by_role('button', name=re.compile('^' + name + r' \(')).click()
    pg.wait_for_load_state('networkidle'); time.sleep(0.3)


def db1(sql, args=()):
    c = sqlite3.connect(DB); r = c.execute(sql, args).fetchone(); c.close(); return r


env = dict(os.environ, DATA_DIR=WORK, JWT_SECRET='x', PORT=str(PORT), NODE_ENV='production',
           ADMIN_PASSWORD='Admin@123', HR_PASSWORD='Indriyan@2025', FINANCE_PASSWORD='Finance@2025')
srv = subprocess.Popen(['node', f'{ROOT}/backend/server.js'], env=env, stdout=open(f'{WORK}/log', 'w'), stderr=subprocess.STDOUT)
try:
    for _ in range(80):
        try: urllib.request.urlopen(BASE + '/api/version', timeout=2); break
        except Exception: time.sleep(.5)
    seed()
    print(f'App root: {ROOT}  mode: {"BASE (expect stale reads + finance 403)" if BASE_MODE else "fix"}')
    want = (lambda fix_value, base_value: base_value if BASE_MODE else fix_value)

    with sync_playwright() as p:
        b = p.chromium.launch()
        hr, hlog = login(b, 'hr', 'Indriyan@2025')

        print('\n— A: Stage 6 — Run, list read < 5 s after the page read it (N-7) —')
        goto(hr, '/pipeline/day-calc'); t0 = time.time()
        check('before Run: T9801 not listed (no day calculation yet)', False, has_row(hr, 'T9801'))
        with hr.expect_response(lambda r: '/api/payroll/calculate-days' in r.url and r.request.method == 'POST') as rr:
            hr.get_by_role('button', name=re.compile('Run Day Calculation')).click()
        check('Run → HTTP 200', 200, rr.value.status)
        hr.wait_for_load_state('networkidle'); time.sleep(1.5)
        print(f'  · Run finished {time.time() - t0:.1f} s after the list was read')
        check('right after Run: T9801 listed without a reload', want(True, False), has_row(hr, 'T9801'))
        time.sleep(6); goto(hr, '/pipeline/day-calc'); row(hr, 'T9801').wait_for(timeout=15000)
        before = row(hr, 'T9801').inner_text()
        c = sqlite3.connect(DB)
        c.execute("UPDATE attendance_processed SET status_original='P',status_final='P',in_time_original='09:00',"
                  "in_time_final='09:00',out_time_original='18:00',out_time_final='18:00' WHERE employee_code='T9801' "
                  "AND date BETWEEN '2026-09-16' AND '2026-09-20' AND status_final='A'")
        c.commit(); c.close()
        time.sleep(6); goto(hr, '/pipeline/day-calc'); row(hr, 'T9801').wait_for(timeout=15000); t0 = time.time()
        hr.get_by_role('button', name=re.compile('Run Day Calculation')).click()
        hr.wait_for_load_state('networkidle'); time.sleep(1.5)
        print(f'  · second Run finished {time.time() - t0:.1f} s after the list was read')
        after = row(hr, 'T9801').inner_text()
        time.sleep(6); goto(hr, '/pipeline/day-calc'); row(hr, 'T9801').wait_for(timeout=15000)
        truth = row(hr, 'T9801').inner_text()
        check('the second Run changed the row (5 more present days)', True, truth != before)
        check('right after the second Run the row already shows the new days', want(True, False), after == truth)
        check('day-calculations GET sends no-cache', want('no-cache', None), hlog['hdr'].get('/payroll/day-calculations'))
        check('day-calc-staleness GET sends no-cache', want('no-cache', None), hlog['hdr'].get('/payroll/day-calc-staleness'))

        print('\n— B: Miss Punch (hr) — correct a row < 5 s after the read; another chip cached before (N-9) —')
        goto(hr, '/pipeline/miss-punch'); t0 = time.time()
        chip(hr, 'Finance Pending')
        check('Finance Pending chip: T9821 not there yet', False, has_row(hr, 'T9821'))
        chip(hr, 'All')
        row(hr, 'T9821').get_by_role('button', name='Correct').click()
        hr.locator('input[type=time]').nth(1).fill('18:00')
        hr.get_by_placeholder('Add remark...').fill('test fix')
        with hr.expect_response(lambda r: '/miss-punches/' in r.url and r.url.endswith('/resolve')) as rr:
            hr.get_by_role('button', name='Save', exact=True).click()
        check('resolve → HTTP 200', 200, rr.value.status)
        hr.wait_for_load_state('networkidle'); time.sleep(1.2)
        print(f'  · saved {time.time() - t0:.1f} s after the All list was read')
        check('All: T9821 no longer offers Correct', want(0, 1), row(hr, 'T9821').get_by_role('button', name='Correct').count())
        chip(hr, 'Finance Pending')
        check('Finance Pending chip (cached earlier) now lists T9821', want(True, False), has_row(hr, 'T9821'))
        check('miss-punches GET sends no-cache', want('no-cache', None), hlog['hdr'].get('/attendance/miss-punches'))
        check('hr still loads the auto-Stage-6 status (200, no error)', True, len(hlog['status_calls']) > 0)

        print('\n— C: Night Shift (hr) — confirm / reject; Miss Punch (cached) gets the rejected day (N-9) —')
        chip(hr, 'All')
        check('Miss Punch All (cached): T9812 not a miss punch yet', False, has_row(hr, 'T9812'))
        spa(hr, '/pipeline/night-shift'); row(hr, 'T9811').wait_for(timeout=15000); t0 = time.time()
        row(hr, 'T9811').get_by_role('button', name='✓ Confirm').click()
        hr.wait_for_load_state('networkidle'); time.sleep(1.2)
        print(f'  · confirmed {time.time() - t0:.1f} s after the list was read')
        check('DB: T9811 confirmed', (1,), db1('SELECT is_confirmed FROM night_shift_pairs WHERE id=?', (PAIR['T9811'],)))
        check('T9811 shows Confirmed right away', want(True, False), 'Confirmed' in row(hr, 'T9811').inner_text())
        row(hr, 'T9812').get_by_role('button', name='Reject pairing').click()
        dlg = hr.locator('div.fixed.inset-0.z-50', has=hr.locator('h3', has_text='Reject this night-shift pairing?'))
        dlg.get_by_role('button', name='Reject pairing').click()
        hr.wait_for_load_state('networkidle'); time.sleep(1.2)
        check('DB: T9812 rejected', (1,), db1('SELECT is_rejected FROM night_shift_pairs WHERE id=?', (PAIR['T9812'],)))
        check('T9812 shows Rejected right away', want(True, False), 'Rejected' in row(hr, 'T9812').inner_text())
        spa(hr, '/pipeline/miss-punch'); time.sleep(1)
        check('Miss Punch All lists the rejected IN day T9812 without a reload', want(True, False), has_row(hr, 'T9812'))
        check('night-shifts GET sends no-cache', want('no-cache', None), hlog['hdr'].get('/attendance/night-shifts'))

        print('\n— D: Miss Punch (finance) — approve / reject < 5 s after the read; no 403 (N-15, N-9) —')
        fin, flog = login(b, 'finance', 'Finance@2025')
        goto(fin, '/pipeline/miss-punch'); time.sleep(0.5)
        chip(fin, 'Approved')
        check('Approved chip: T9822 not there yet', False, has_row(fin, 'T9822'))
        chip(fin, 'Finance Pending'); t0 = time.time()
        row(fin, 'T9822').get_by_role('button', name='✓ Approve').dispatch_event('click')
        fin.wait_for_load_state('networkidle'); time.sleep(1.2)
        print(f'  · approved {time.time() - t0:.1f} s after the list was read')
        check('DB: T9822 approved', ('approved',), db1('SELECT miss_punch_finance_status FROM attendance_processed WHERE id=?', (IDS['T9822'],)))
        check('Finance Pending: T9822 gone right away', want(False, True), has_row(fin, 'T9822'))
        chip(fin, 'Finance Pending'); t0 = time.time()
        row(fin, 'T9823').get_by_role('button', name='✕ Reject').dispatch_event('click')
        fin.locator('textarea').last.fill('test reason')
        fin.get_by_role('button', name='Reject & Credit ½P').click()
        fin.wait_for_load_state('networkidle'); time.sleep(1.2)
        check('DB: T9823 rejected', ('rejected',), db1('SELECT miss_punch_finance_status FROM attendance_processed WHERE id=?', (IDS['T9823'],)))
        check('Finance Pending: T9823 gone right away', want(False, True), has_row(fin, 'T9823'))
        chip(fin, 'Approved')
        check('Approved chip (cached earlier) lists T9822', want(True, False), has_row(fin, 'T9822'))
        time.sleep(1)
        f403 = [x for x in flog['bad'] if STATUS in x]
        check('finance: calls leave-automation/status', want(False, True), len(flog['status_calls']) > 0)
        check('finance: 403 on leave-automation/status', want(False, True), len(f403) > 0)
        print('\n— E: Daily wage records list sends no-cache (for P1-18) + phone width —')
        hr.goto(BASE + '/daily-wage'); hr.wait_for_load_state('networkidle'); time.sleep(1)
        check('daily-wage entries GET sends no-cache', want('no-cache', None), hlog['hdr'].get('/daily-wage/entries'))
        ph, plog = login(b, 'finance', 'Finance@2025', width=390)
        goto(ph, '/pipeline/miss-punch'); time.sleep(1)
        check('phone 390: Miss Punch renders (chips visible)', True,
              ph.get_by_role('button', name=re.compile(r'^All \(')).count() > 0)

        if not BASE_MODE:
            print('\n— errors —')
            for name, lg in (('hr', hlog), ('finance', flog), ('phone', plog)):
                check(f'{name}: 0 page errors', [], lg['errs'])
                check(f'{name}: 0 console errors', [], lg['cons'])
                check(f'{name}: 0 API ≥ 400', [], lg['bad'])
        b.close()
finally:
    srv.terminate()
print(f'\n{PASS} passed, {FAIL} failed')
sys.exit(1 if FAIL else 0)
