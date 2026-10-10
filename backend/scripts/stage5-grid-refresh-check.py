#!/usr/bin/env python3
"""Stage 5 daily grid refreshes after a correction is saved (P1-08, finding P-4) — browser check.

Chromium against the BUILT dist, real hr login, scratch DATA_DIR with fictional data (codes T980x,
names "TEST EMP n" — the repo is public). Seeds attendance for the CURRENT month (the page opens on it).

Cases (fix mode):
  A  slow save (> 5 s after the grid loaded): A → P + times → cell shows P, times, amber, no reload; DB row = new values
  B  quick save (< 5 s after the grid loaded) + a second edit straight after → both show (the server's
     `Cache-Control: private, max-age=5` must not hand back the pre-save copy)
  C  switch employee after a save (accordion: one grid at a time) → other grid renders, back again still saved
  D  calendar view: open it, back to grid, edit, open calendar again → calendar shows the new status
  D2 calendar opened < 5 s before the save → calendar still shows the new status (no-cache on its read)
  E  Recalculate Metrics: a night punch stored with is_night_shift = 0 turns purple without reload
  F  390 px phone: case A on another day
  + 0 page errors / 0 console errors / 0 API >= 400 throughout

Usage:
  python3 backend/scripts/stage5-grid-refresh-check.py               # this tree's server + dist
  APP_ROOT=/tmp/wt python3 .../stage5-grid-refresh-check.py --base   # another tree (origin/main): case A stays stale
Needs `npm run build --prefix frontend` in APP_ROOT first. PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers. Port 3108.
"""
import datetime, os, re, shutil, sqlite3, subprocess, sys, tempfile, time, urllib.request
from playwright.sync_api import sync_playwright

HERE_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
ROOT = os.path.abspath(os.environ.get('APP_ROOT', HERE_ROOT))
BASE_MODE = '--base' in sys.argv
ONLY = os.environ.get('ONLY', '')  # e.g. ONLY=B to run one case while debugging
PORT = int(os.environ.get('PORT', '3108')); BASE = f'http://127.0.0.1:{PORT}'
WORK = tempfile.mkdtemp(prefix='stage5-grid-'); DB = os.path.join(WORK, 'hr_system.db')
C = 'Asian Lakto Ind Ltd'
NOW = datetime.date.today(); M, Y = NOW.month, NOW.year
DAYS = (datetime.date(Y + (M == 12), M % 12 + 1, 1) - datetime.timedelta(days=1)).day
# Sundays render grey whatever the record says, so every day the script edits/inspects is a weekday
WD = [d for d in range(1, DAYS + 1) if datetime.date(Y, M, d).weekday() != 6]
DA, DB1, DB2, DN, DC, DD, DF, DD2 = WD[1:9]   # slow save, quick save, back-to-back, night, switch, calendar, phone, calendar-quick
PASS = FAIL = 0
GRID = 'div.grid[style*="grid-template-columns"]'  # the daily grid (EmployeeQuickView has its own div.grid)


def check(label, expected, actual):
    global PASS, FAIL
    if expected == actual: PASS += 1; print(f'  ✓ {label}')
    else: FAIL += 1; print(f'  ✗ {label} — expected {expected!r}, got {actual!r}')


def iso(d): return f'{Y}-{M:02d}-{d:02d}'


def seed():
    c = sqlite3.connect(DB)
    for i, code in enumerate(('T9801', 'T9802'), 1):
        c.execute("INSERT OR IGNORE INTO employees(code,name,department,company,status,employment_type,gross_salary) "
                  "VALUES(?,?,'TEST DEPT',?,'Active','Permanent',20000)", (code, f'TEST EMP {i}', C))
    rows = []
    for d in WD[:10]:
        rows.append(('T9801', d, 'A', None, None, 0) if d in (DA, DB1, DC, DD, DF, DD2) else ('T9801', d, 'P', '08:00', '20:00', 0))
        rows.append(('T9802', d, 'P', '20:15', '08:00', 0) if d == DN else ('T9802', d, 'P', '08:00', '20:00', 0))
    for code, d, st, tin, tout, night in rows:
        c.execute("INSERT INTO attendance_processed(employee_code,date,status_original,in_time_original,out_time_original,"
                  "actual_hours,is_night_shift,month,year,company) VALUES(?,?,?,?,?,?,?,?,?,?)",
                  (code, iso(d), st, tin, tout, 12 if tin else None, night, M, Y, C))
    c.commit(); c.close()


def db_row(code, d):
    c = sqlite3.connect(DB)
    r = c.execute("SELECT status_final,in_time_final,out_time_final,correction_remark,stage_5_done,is_night_shift "
                  "FROM attendance_processed WHERE employee_code=? AND date=?", (code, iso(d))).fetchone()
    c.close(); return r


def login(b, width=1440):
    ctx = b.new_context(viewport={'width': width, 'height': 900})
    pg = ctx.new_page()
    errs, cons, bad = [], [], []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('console', lambda m: cons.append(m.text) if m.type == 'error' and 'vite.svg' not in m.text and '404' not in m.text else None)
    pg.on('response', lambda r: bad.append(f'{r.status} {r.url}') if '/api/' in r.url and r.status >= 400 else None)
    pg.goto(BASE + '/login'); pg.get_by_placeholder('admin').fill('hr'); pg.get_by_placeholder('••••••••').fill('Indriyan@2025')
    pg.get_by_role('button', name='Sign in').click(); pg.wait_for_url(lambda u: '/login' not in u)
    return pg, errs, cons, bad


def open_page(pg):
    pg.goto(BASE + '/pipeline/corrections'); pg.wait_for_load_state('networkidle')
    pg.locator('tr', has_text='T9801').first.wait_for(timeout=15000)


def expand(pg, code, name):
    """Expand an employee row; return (panel, time the grid's GET finished)."""
    with pg.expect_response(lambda r: '/api/attendance/register' in r.url and code in r.url) as resp:
        pg.locator('tbody tr', has_text=code).first.locator('td').nth(2).click()
    t = time.time(); _ = resp.value.status
    pg.get_by_role('heading', name=f'{name} — Daily Grid').wait_for(timeout=10000)
    panel = drill(pg)
    panel.locator(GRID + ' > div').first.wait_for(timeout=10000)
    return panel, t


def drill(pg):
    # the open employee's detail block (accordion → only one); anchored on the view toggle, which the
    # Calendar View keeps on screen (the grid heading disappears there)
    return pg.locator('div.space-y-4', has=pg.get_by_role('button', name='Calendar View')).first


def cell(panel, d):
    return panel.locator(GRID).first.locator(':scope > div').nth(d - 1)


def cell_state(panel, d):
    el = cell(panel, d)
    lines = [x.strip() for x in el.inner_text().split('\n') if x.strip()]
    return lines[2] if len(lines) > 2 else None, lines[3:], el.get_attribute('class') or ''


def wait_status(panel, d, want, secs=3.0):
    end = time.time() + secs
    while time.time() < end:
        if cell_state(panel, d)[0] == want: return True
        time.sleep(0.2)
    return cell_state(panel, d)[0] == want


def edit(pg, panel, d, status, tin, tout, remark):
    cell(panel, d).click()
    modal = pg.locator('div.fixed.inset-0', has_text='Edit:').first
    modal.locator('select').select_option(status)
    ins = modal.locator('input[type="time"]')
    ins.nth(0).fill(tin); ins.nth(1).fill(tout)
    modal.locator('input[type="text"]').fill(remark)
    with pg.expect_response(lambda r: '/api/attendance/record/' in r.url and r.request.method == 'PUT') as put:
        modal.get_by_role('button', name='Save').click()
    return put.value.status


def calendar_status(panel, d):
    return panel.evaluate("""(el, day) => {
        const spans = [...el.querySelectorAll('div.grid.grid-cols-7 span.leading-none')];
        const s = spans.find(x => x.textContent.trim() === String(day));
        if (!s) return null;
        const nxt = s.parentElement.querySelector('span.font-bold');
        return nxt ? nxt.textContent.trim() : '';
    }""", d)


def run(name): return not ONLY or name in ONLY


env = dict(os.environ, DATA_DIR=WORK, JWT_SECRET='x', PORT=str(PORT), NODE_ENV='production',
           ADMIN_PASSWORD='Admin@123', HR_PASSWORD='Indriyan@2025', FINANCE_PASSWORD='Finance@2025')
srv = subprocess.Popen(['node', f'{ROOT}/backend/server.js'], env=env, stdout=open(f'{WORK}/log', 'w'), stderr=subprocess.STDOUT)
try:
    for _ in range(80):
        try: urllib.request.urlopen(BASE + '/api/version', timeout=2); break
        except Exception: time.sleep(.5)
    seed()
    print(f'App root: {ROOT}  mode: {"BASE (expect stale cell)" if BASE_MODE else "fix"}  month: {M}/{Y}')

    with sync_playwright() as p:
        b = p.chromium.launch()
        pg, errs, cons, bad = login(b)

        if BASE_MODE:
            print('\n— A (old code): slow save —')
            open_page(pg); panel, t = expand(pg, 'T9801', 'TEST EMP 1')
            check(f'old: day {DA} starts A', 'A', cell_state(panel, DA)[0])
            time.sleep(max(0, 6 - (time.time() - t)))
            check('old: PUT 200', 200, edit(pg, panel, DA, 'P', '08:05', '20:05', 'test fix A'))
            check('old: DB saved P', 'P', db_row('T9801', DA)[0])
            check('old: cell STILL shows A after 3 s (bug)', False, wait_status(panel, DA, 'P'))
            pg.reload(); pg.wait_for_load_state('networkidle')
            panel, _ = expand(pg, 'T9801', 'TEST EMP 1')
            check('old: after reload the cell shows P', 'P', cell_state(panel, DA)[0])
            b.close()
        else:
            if run('A'):
                print('\n— A: slow save (> 5 s after the grid loaded) —')
                open_page(pg); panel, t = expand(pg, 'T9801', 'TEST EMP 1')
                check(f'A: day {DA} starts A', 'A', cell_state(panel, DA)[0])
                time.sleep(max(0, 6 - (time.time() - t)))
                check('A: PUT 200', 200, edit(pg, panel, DA, 'P', '08:05', '20:05', 'test fix A'))
                check('A: cell shows P without reload', True, wait_status(panel, DA, 'P'))
                st, times, cls = cell_state(panel, DA)
                check('A: cell shows the new times', ['08:05', '20:05'], times)
                check('A: cell painted amber (corrected)', True, 'bg-amber-50' in cls)
                check('A: editor closed', 0, pg.locator('div.fixed.inset-0', has_text='Edit:').count())
                check('A: DB row = new values', ('P', '08:05', '20:05', 'test fix A', 1), db_row('T9801', DA)[:5])

            if run('B'):
                print('\n— B: quick save (< 5 s after the grid loaded) + back-to-back edit —')
                open_page(pg); panel, t = expand(pg, 'T9801', 'TEST EMP 1')
                check(f'B: PUT 200 (day {DB1})', 200, edit(pg, panel, DB1, 'P', '08:10', '20:10', 'test fix B1'))
                print(f'    (save sent {time.time() - t:.1f} s after the grid GET)')
                check(f'B: day {DB1} shows P without reload', True, wait_status(panel, DB1, 'P'))
                check(f'B: PUT 200 (day {DB2}, straight after)', 200, edit(pg, panel, DB2, '½P', '08:00', '14:00', 'test fix B2'))
                check(f'B: day {DB2} shows ½P without reload', True, wait_status(panel, DB2, '½P'))
                check(f'B: day {DB1} still shows P', 'P', cell_state(panel, DB1)[0])

            if run('C'):
                print('\n— C: switch employee after a save (the page opens one grid at a time) —')
                open_page(pg); p1, t1 = expand(pg, 'T9801', 'TEST EMP 1')
                time.sleep(max(0, 6 - (time.time() - t1)))
                check(f'C: PUT 200 (T9801 day {DC})', 200, edit(pg, p1, DC, 'P', '08:00', '20:00', 'test fix C'))
                check(f'C: T9801 day {DC} shows P', True, wait_status(p1, DC, 'P'))
                p2, _ = expand(pg, 'T9802', 'TEST EMP 2')
                check('C: T9802 grid renders every day of the month', DAYS, p2.locator(GRID).first.locator(':scope > div').count())
                check('C: T9802 first weekday = P', 'P', cell_state(p2, WD[0])[0])
                pg.locator('tbody tr', has_text='T9801').first.locator('td').nth(2).click()
                pg.get_by_role('heading', name='TEST EMP 1 — Daily Grid').wait_for(timeout=10000)
                p1 = drill(pg)
                check(f'C: back on T9801, day {DC} still P', True, wait_status(p1, DC, 'P'))

            if run('D'):
                print('\n— D: calendar view refreshes after a save —')
                open_page(pg); panel, _ = expand(pg, 'T9801', 'TEST EMP 1')
                panel.get_by_role('button', name='Calendar View').click()
                pg.wait_for_load_state('networkidle'); time.sleep(0.5)
                check(f'D: calendar day {DD} starts A', 'A', calendar_status(panel, DD))
                time.sleep(6)
                panel.get_by_role('button', name='Grid View').click()
                cell(panel, DD).wait_for()
                check(f'D: PUT 200 (day {DD})', 200, edit(pg, panel, DD, 'P', '08:00', '20:00', 'test fix D'))
                wait_status(panel, DD, 'P')
                panel.get_by_role('button', name='Calendar View').click()
                pg.wait_for_load_state('networkidle'); time.sleep(1.5)
                check(f'D: calendar day {DD} shows P without reload', 'P', calendar_status(panel, DD))
                panel.get_by_role('button', name='Grid View').click()

            if run('D'):
                print('\n— D2: calendar opened < 5 s before the save —')
                open_page(pg); panel, _ = expand(pg, 'T9801', 'TEST EMP 1')
                panel.get_by_role('button', name='Calendar View').click()
                pg.wait_for_load_state('networkidle'); time.sleep(0.5)
                check(f'D2: calendar day {DD2} starts A', 'A', calendar_status(panel, DD2))
                t_cal = time.time()
                panel.get_by_role('button', name='Grid View').click()
                cell(panel, DD2).wait_for()
                check(f'D2: PUT 200 (day {DD2})', 200, edit(pg, panel, DD2, 'P', '08:00', '20:00', 'test fix D2'))
                wait_status(panel, DD2, 'P', secs=1.5)
                panel.get_by_role('button', name='Calendar View').click()
                print(f'    (calendar re-opened {time.time() - t_cal:.1f} s after its first load)')
                pg.wait_for_load_state('networkidle'); time.sleep(1.5)
                check(f'D2: calendar day {DD2} shows P without reload', 'P', calendar_status(panel, DD2))
                panel.get_by_role('button', name='Grid View').click()

            if run('E'):
                print('\n— E: Recalculate Metrics repaints night cells —')
                open_page(pg); p2, t2 = expand(pg, 'T9802', 'TEST EMP 2')
                check(f'E: day {DN} (20:15 punch, flag 0) not purple before', False, 'bg-purple-50' in cell_state(p2, DN)[2])
                time.sleep(max(0, 6 - (time.time() - t2)))
                with pg.expect_response(lambda r: '/recalculate-metrics' in r.url) as rr:
                    pg.get_by_role('button', name='Recalculate Metrics').click()
                check('E: recalc 200', 200, rr.value.status)
                check('E: DB is_night_shift = 1', 1, db_row('T9802', DN)[5])
                end = time.time() + 3
                while time.time() < end and 'bg-purple-50' not in cell_state(p2, DN)[2]: time.sleep(0.2)
                check(f'E: day {DN} purple without reload', True, 'bg-purple-50' in cell_state(p2, DN)[2])

            check('desktop: 0 page errors', [], errs)
            check('desktop: 0 console errors', [], cons)
            check('desktop: 0 API ≥ 400', [], bad)

            if run('F'):
                print('\n— F: phone 390 px —')
                pg, errs, cons, bad = login(b, width=390)
                open_page(pg); panel, t = expand(pg, 'T9801', 'TEST EMP 1')
                time.sleep(max(0, 6 - (time.time() - t)))
                cell(panel, DF).scroll_into_view_if_needed()
                check(f'F: PUT 200 (day {DF})', 200, edit(pg, panel, DF, 'P', '09:00', '18:00', 'test fix F'))
                check(f'F: day {DF} shows P without reload', True, wait_status(panel, DF, 'P'))
                check('F: 0 page errors', [], errs)
                check('F: 0 API ≥ 400', [], bad)
            b.close()
finally:
    srv.terminate(); shutil.rmtree(WORK, ignore_errors=True)

print(f'\n{PASS} passed, {FAIL} failed')
sys.exit(1 if FAIL else 0)
