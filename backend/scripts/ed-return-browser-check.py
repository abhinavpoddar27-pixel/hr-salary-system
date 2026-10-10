#!/usr/bin/env python3
"""Extra duty "Return to HR" — browser check of the built frontend (Chromium).

Boots backend/server.js with NODE_ENV=production (serves frontend/dist) on a
scratch DATA_DIR, seeds three finance-rejected grants for the current month
through the real API, then as real users in a real browser:
  finance: single "Return to HR" on one row, bulk return of the other two;
  hr:      sees the finance note, edits days 1 → 0.5, approves;
  finance: sees it back as unreviewed at 0.5 and approves.
Screenshots go to $SHOTS (default: scratch, deleted). Never point at a real DB.
"""
import json, os, shutil, sqlite3, subprocess, sys, tempfile, time, urllib.request, urllib.error
from datetime import datetime, timezone, timedelta
from playwright.sync_api import sync_playwright

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
PORT = int(os.environ.get('PORT', '3988'))
BASE = f'http://127.0.0.1:{PORT}'
COMPANY = 'Asian Lakto Ind Ltd'
WORK = tempfile.mkdtemp(prefix='ed-return-ui-')
SHOTS = os.environ.get('SHOTS') or os.path.join(WORK, 'shots')
os.makedirs(SHOTS, exist_ok=True)
DB = os.path.join(WORK, 'hr_system.db')
IST = datetime.now(timezone(timedelta(hours=5, minutes=30)))
M, Y = IST.month, IST.year
DATE = f'{Y}-{M:02d}-02'
PASS = FAIL = 0
PAGE_ERRORS, API_ERRORS = [], []


def check(label, ok, detail=''):
    global PASS, FAIL
    if ok: PASS += 1; print(f'  ✓ {label}')
    else: FAIL += 1; print(f'  ✗ {label} {detail}')


def http(method, path, token=None, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method, headers={'Content-Type': 'application/json'})
    if token: req.add_header('Authorization', f'Bearer {token}')
    try:
        with urllib.request.urlopen(req, timeout=30) as r: return r.status, json.loads(r.read() or b'null')
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b'null')


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
    for code, name in [('17575', 'RAM SINGH'), ('18766', 'SHYAM LAL'), ('22713', 'MOHAN DAS')]:
        con.execute("INSERT INTO employees (code, name, department, company, status, employment_type, gross_salary) VALUES (?, ?, 'OFFICE ADMIN', ?, 'Active', 'Permanent', 30000)", (code, name, COMPANY))
    con.commit(); con.close()

    def api_login(u, p): return http('POST', '/api/auth/login', body={'username': u, 'password': p})[1]['token']
    hr_t, fin_t = api_login('hr', 'Indriyan@2025'), api_login('finance', 'Finance@2025')
    ids = {}
    for code in ['17575', '18766', '22713']:
        _, b = http('POST', '/api/extra-duty-grants', hr_t, {'employee_code': code, 'grant_date': DATE, 'month': M, 'year': Y, 'company': COMPANY, 'duty_days': 1, 'verification_source': 'Gate Register'})
        ids[code] = b['id']
        http('POST', f"/api/extra-duty-grants/{b['id']}/approve", hr_t)
        http('POST', f"/api/extra-duty-grants/{b['id']}/finance-reject", fin_t, {'finance_flag_reason': 'power cut'})
    check('seeded 3 finance-rejected grants', q("SELECT COUNT(*) n FROM extra_duty_grants WHERE finance_status='FINANCE_REJECTED'")[0]['n'] == 3)

    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path='/opt/pw-browsers/chromium' if os.path.exists('/opt/pw-browsers/chromium') else None)

        def login(user, pw):
            ctx = browser.new_context(viewport={'width': 1440, 'height': 900})
            page = ctx.new_page()
            page.on('pageerror', lambda e, u=user: PAGE_ERRORS.append(f'{u}: {e}'))
            page.on('response', lambda r, u=user: (r.status >= 400 and '/api/' in r.url) and API_ERRORS.append(f'{u}: {r.status} {r.url}'))
            page.goto(f'{BASE}/login')
            page.get_by_placeholder('admin').fill(user)
            page.get_by_placeholder('••••••••').fill(pw)
            page.get_by_role('button', name='Sign in').click()
            page.wait_for_url(lambda u: '/login' not in u, timeout=15000)
            return page

        def row_of(page, code):
            return page.locator('tbody tr', has=page.get_by_text(code, exact=True))

        print('\n— finance: single return —')
        fin = login('finance', 'Finance@2025')
        fin.goto(f'{BASE}/extra-duty-grants'); fin.wait_for_load_state('networkidle')
        fin.get_by_role('button', name='Finance Review').click(); fin.wait_for_load_state('networkidle')
        r = row_of(fin, '17575')
        check('rejected row shows "↩ Return to HR"', r.get_by_role('button', name='↩ Return to HR').count() == 1)
        r.get_by_role('button', name='↩ Return to HR').click()
        submit = fin.get_by_role('button', name='Return to HR', exact=True)
        check('submit disabled until a reason is typed', submit.is_disabled())
        fin.get_by_placeholder("What should HR correct?", exact=False).fill('Power cut — give 0.5 day, not 1')
        fin.screenshot(path=os.path.join(SHOTS, '1-finance-return-modal.png'))
        submit.click()
        fin.get_by_text('1 grant returned to HR for correction').wait_for(timeout=10000)
        check('toast confirms the return', True)
        check('DB: 17575 back to PENDING/UNREVIEWED', q('SELECT status, finance_status FROM extra_duty_grants WHERE id=?', (ids['17575'],))[0] == {'status': 'PENDING', 'finance_status': 'UNREVIEWED'})

        print('\n— finance: bulk return —')
        fin.reload(); fin.wait_for_load_state('networkidle')
        fin.get_by_role('button', name='Finance Review').click(); fin.wait_for_load_state('networkidle')
        for code in ['18766', '22713']:
            row_of(fin, code).locator('input[type=checkbox]').check()
        bulk = fin.get_by_role('button', name='↩ Return to HR (2)')
        check('bulk button counts 2 selected', bulk.count() == 1)
        bulk.click()
        fin.get_by_placeholder("What should HR correct?", exact=False).fill('Power cut — 0.5 day each')
        fin.get_by_role('button', name='Return to HR', exact=True).click()
        fin.get_by_text('2 grants returned to HR for correction').wait_for(timeout=10000)
        check('bulk toast', True)
        check('DB: all 3 pending now', q("SELECT COUNT(*) n FROM extra_duty_grants WHERE status='PENDING' AND finance_status='UNREVIEWED'")[0]['n'] == 3)

        print('\n— hr: sees note, edits to 0.5, approves —')
        hr = login('hr', 'Indriyan@2025')
        hr.goto(f'{BASE}/extra-duty-grants'); hr.wait_for_load_state('networkidle')
        r = row_of(hr, '17575')
        check('HR sees the finance note on the row', r.get_by_text('Power cut — give 0.5 day, not 1', exact=False).count() == 1)
        hr.screenshot(path=os.path.join(SHOTS, '2-hr-queue-returned.png'), full_page=True)
        check('finance user had no Edit button (HR only)', fin.get_by_role('button', name='✎ Edit').count() == 0)
        r.get_by_role('button', name='✎ Edit').click()
        modal = hr.locator('select').filter(has=hr.locator('option[value="0.5"]')).first
        modal.select_option('0.5')
        hr.screenshot(path=os.path.join(SHOTS, '3-hr-edit-modal.png'))
        hr.get_by_role('button', name='Save', exact=True).click()
        hr.get_by_text('Grant updated', exact=False).wait_for(timeout=10000)
        check('DB: duty_days now 0.5', q('SELECT duty_days FROM extra_duty_grants WHERE id=?', (ids['17575'],))[0]['duty_days'] == 0.5)
        row_of(hr, '17575').get_by_role('button', name='Approve', exact=True).click()
        hr.get_by_text('Approved', exact=True).first.wait_for(timeout=10000)
        check('DB: HR approved', q('SELECT status FROM extra_duty_grants WHERE id=?', (ids['17575'],))[0]['status'] == 'APPROVED')

        print('\n— finance: re-reviews and approves —')
        fin.reload(); fin.wait_for_load_state('networkidle')
        fin.get_by_role('button', name='Finance Review').click(); fin.wait_for_load_state('networkidle')
        r = row_of(fin, '17575')
        check('finance sees it unreviewed at 0.5', r.get_by_text('0.5', exact=True).count() >= 1 and r.get_by_text('UNREVIEWED').count() == 1)
        r.get_by_role('button', name='✓ Approve').click()
        fin.get_by_text('Finance approved').wait_for(timeout=10000)
        check('DB: FINANCE_APPROVED at 0.5', q('SELECT finance_status, duty_days FROM extra_duty_grants WHERE id=?', (ids['17575'],))[0] == {'finance_status': 'FINANCE_APPROVED', 'duty_days': 0.5})
        fin.screenshot(path=os.path.join(SHOTS, '4-finance-approved.png'), full_page=True)
        browser.close()

    check('no page errors', not PAGE_ERRORS, PAGE_ERRORS)
    check('no API 4xx/5xx', not API_ERRORS, API_ERRORS)
finally:
    srv.terminate()
    try: srv.wait(10)
    except Exception: srv.kill()
    log.close()
    if not os.environ.get('SHOTS'): shutil.rmtree(WORK, ignore_errors=True)
    else: shutil.rmtree(WORK, ignore_errors=True) if SHOTS not in WORK else None

print(f'\n{PASS} passed, {FAIL} failed')
sys.exit(1 if FAIL else 0)
