#!/usr/bin/env python3
"""Legacy late-deduction route retired — browser check of the built frontend (Chromium).

Owner ruling 10 Oct 2026 (D-1): Analytics → Attendance Review is the only place
late / early deductions are decided. Stage 6's "Apply Deduction" button and its
PUT /api/payroll/day-calculations/:code/late-deduction route are closed; a cut
already stored stays exactly as it is (D-2).

Boots backend/server.js with NODE_ENV=production (serves frontend/dist) on a
scratch DATA_DIR with three fictional employees and Stage 6 rows for the page's
month, then as hr in a real browser on Stage 6: Day Calculation:
  91101  late 9×, no cut        → read-only note, no Apply / Remove button
  91102  late 12×, legacy cut 2 → note shows the 2-day cut + remark, no Remove button
  91103  late 2×                → no late panel at all
  then calls the old route from the page → 410 and the DB is unchanged.
Screenshots go to $SHOTS (default: scratch). Never point at a real DB.
"""
import json, os, sqlite3, subprocess, tempfile, time, urllib.request
from playwright.sync_api import sync_playwright

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
PORT = int(os.environ.get('PORT', '3992'))
BASE = f'http://127.0.0.1:{PORT}'
COMPANY = 'Asian Lakto Ind Ltd'
WORK = tempfile.mkdtemp(prefix='legacy-late-ui-')
SHOTS = os.environ.get('SHOTS') or os.path.join(WORK, 'shots')
os.makedirs(SHOTS, exist_ok=True)
DB = os.path.join(WORK, 'hr_system.db')
PASS = FAIL = 0
PAGE_ERRORS, API_ERRORS = [], []


def check(label, ok, detail=''):
    global PASS, FAIL
    if ok: PASS += 1; print(f'  ✓ {label}')
    else: FAIL += 1; print(f'  ✗ {label} {detail}')


def q(sql, args=()):
    con = sqlite3.connect(DB, timeout=10); con.row_factory = sqlite3.Row
    try: return [dict(r) for r in con.execute(sql, args).fetchall()]
    finally: con.close()


env = dict(os.environ, DATA_DIR=WORK, JWT_SECRET='ui-secret', PORT=str(PORT), NODE_ENV='production',
           ADMIN_PASSWORD='Admin@123', HR_PASSWORD='Indriyan@2025', FINANCE_PASSWORD='Finance@2025')
log = open(os.path.join(WORK, 'server.log'), 'w')
srv = subprocess.Popen(['node', os.path.join(ROOT, 'backend', 'server.js')], env=env, stdout=log, stderr=subprocess.STDOUT)
try:
    for _ in range(80):
        try: urllib.request.urlopen(BASE + '/api/version', timeout=2); break
        except Exception: time.sleep(0.5)

    con = sqlite3.connect(DB)
    people = [('91101', 'TEST LATE NOCUT', 9, 0, None),
              ('91102', 'TEST LATE LEGACY', 12, 2, 'Late deduction: 2 day(s) for 12 late arrivals'),
              ('91103', 'TEST FEW LATES', 2, 0, None)]
    for code, name, *_ in people:
        con.execute("INSERT INTO employees (code, name, department, company, status, employment_type, gross_salary) "
                    "VALUES (?, ?, 'PRODUCTION', ?, 'Active', 'Permanent', 20000)", (code, name, COMPANY))
    # Rows for every month of 2026, so whatever month the page opens on has them.
    for m in range(1, 13):
        for code, _name, late, cut, remark in people:
            con.execute("INSERT INTO day_calculations (employee_id, employee_code, month, year, company, total_calendar_days, "
                        "days_present, total_payable_days, lop_days, late_count, late_deduction_days, late_deduction_remark) "
                        "VALUES ((SELECT id FROM employees WHERE code=?), ?, ?, 2026, ?, 30, 26, ?, ?, ?, ?, ?)",
                        (code, code, m, COMPANY, 30 - cut, cut, late, cut, remark))
    con.commit(); con.close()
    before = q('SELECT * FROM day_calculations ORDER BY id')

    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path='/opt/pw-browsers/chromium' if os.path.exists('/opt/pw-browsers/chromium') else None)
        ctx = browser.new_context(viewport={'width': 1440, 'height': 900})
        page = ctx.new_page()
        page.on('pageerror', lambda e: PAGE_ERRORS.append(str(e)))
        page.on('response', lambda r: (r.status >= 400 and '/api/' in r.url and 'late-deduction' not in r.url) and API_ERRORS.append(f'{r.status} {r.url}'))
        page.goto(f'{BASE}/login')
        page.get_by_placeholder('admin').fill('hr')
        page.get_by_placeholder('••••••••').fill('Indriyan@2025')
        page.get_by_role('button', name='Sign in').click()
        page.wait_for_url(lambda u: '/login' not in u, timeout=15000)
        page.goto(f'{BASE}/pipeline/day-calc'); page.wait_for_load_state('networkidle'); page.wait_for_timeout(800)

        def expand(code):
            row = page.locator('tbody tr', has=page.get_by_text(code, exact=True)).first
            row.click(); page.wait_for_timeout(500)
            return row

        print('\n— 91101: late 9×, no cut —')
        check('row listed', page.locator('tbody tr', has=page.get_by_text('91101', exact=True)).count() >= 1)
        expand('91101')
        note = page.get_by_test_id('late-deduction-readonly')
        check('read-only note shown', note.count() == 1, f'count={note.count()}')
        check('says "Late 9 times this month."', note.count() == 1 and 'Late 9 times this month.' in note.inner_text())
        check('points to Attendance Review', note.count() == 1 and 'Analytics → Attendance Review' in note.inner_text())
        check('no "Apply Deduction" button anywhere', page.get_by_role('button', name='Apply Deduction').count() == 0)
        check('no deduction days input', page.locator('input[id^=late-ded-]').count() == 0)
        page.screenshot(path=os.path.join(SHOTS, '1-late-no-cut.png'), full_page=False)
        expand('91101')  # collapse

        print('\n— 91102: legacy 2-day cut stays, read-only —')
        expand('91102')
        note = page.get_by_test_id('late-deduction-readonly')
        txt = note.inner_text() if note.count() == 1 else ''
        check('note shows the 2-day legacy cut', 'Legacy late deduction: 2 day(s) already cut from payable days.' in txt, txt)
        check('note shows the stored remark', 'Late deduction: 2 day(s) for 12 late arrivals' in txt)
        check('no "Remove" button for the cut', page.get_by_role('button', name='Remove', exact=True).count() == 0)
        page.screenshot(path=os.path.join(SHOTS, '2-legacy-cut.png'), full_page=False)
        expand('91102')

        print('\n— 91103: 2 lates → no late panel —')
        expand('91103')
        check('no late note for 2 lates', page.get_by_test_id('late-deduction-readonly').count() == 0)
        expand('91103')

        print('\n— the old route, called from the logged-in page —')
        res = page.evaluate("""async () => {
            const t = localStorage.getItem('token') || localStorage.getItem('hr_token') || '';
            const r = await fetch('/api/payroll/day-calculations/91101/late-deduction', {
              method: 'PUT', credentials: 'include',
              headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) },
              body: JSON.stringify({ month: 10, year: 2026, deductionDays: 2, remark: 'x' }) });
            return { status: r.status, body: await r.json().catch(() => null) };
        }""")
        check('PUT late-deduction → 410', res['status'] == 410, json.dumps(res))
        check('410 message names Attendance Review', 'Attendance Review' in json.dumps(res.get('body') or {}, ensure_ascii=False))
        check('day_calculations unchanged (all 36 rows byte-identical)', q('SELECT * FROM day_calculations ORDER BY id') == before)

        check('no page errors', not PAGE_ERRORS, '; '.join(PAGE_ERRORS[:3]))
        check('no API 4xx/5xx besides the retired route', not API_ERRORS, '; '.join(API_ERRORS[:3]))
        browser.close()
finally:
    srv.terminate()
    try: srv.wait(timeout=10)
    except Exception: srv.kill()

print(f'\n{PASS} passed, {FAIL} failed. Screenshots: {SHOTS}')
raise SystemExit(1 if FAIL else 0)
