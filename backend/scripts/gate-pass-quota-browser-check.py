#!/usr/bin/env python3
"""Gate pass allowance — browser check of the built frontend (Chromium).

Owner ruling 10 Oct 2026: per employee per calendar month, 2 Short Leaves
(2 hours) OR 1 Half Day; only an admin can go over, with a reason.

Boots backend/server.js with NODE_ENV=production (serves frontend/dist) on a
scratch DATA_DIR with three fictional employees, then as real users in a real
browser on Leave Management → Gate Passes:
  hr:    Short Leave #1 (2 h, leave from 18:00) → Half Day shown "not available"
         → Short Leave #2 → allowance used up, Create disabled;
         Half Day for a second employee → Short Leave "not available".
  admin: over the allowance → reason box → Create over allowance → BREACH badge
         with the reason in its tooltip; a same-day pass → server refusal shown.
  phone: modal at 390 px.
Screenshots go to $SHOTS (default: scratch). Never point at a real DB.
"""
import json, os, sqlite3, subprocess, sys, tempfile, time, urllib.request, urllib.error
from datetime import datetime, timezone, timedelta
from playwright.sync_api import sync_playwright

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
PORT = int(os.environ.get('PORT', '3991'))
BASE = f'http://127.0.0.1:{PORT}'
COMPANY = 'Asian Lakto Ind Ltd'
WORK = tempfile.mkdtemp(prefix='gate-pass-ui-')
SHOTS = os.environ.get('SHOTS') or os.path.join(WORK, 'shots')
os.makedirs(SHOTS, exist_ok=True)
DB = os.path.join(WORK, 'hr_system.db')
IST = datetime.now(timezone(timedelta(hours=5, minutes=30)))
M, Y = IST.month, IST.year
D = lambda day: f'{Y}-{M:02d}-{day:02d}'
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
    for code, name in [('91001', 'TEST ALPHA'), ('91002', 'TEST BRAVO'), ('91003', 'TEST CHARLIE')]:
        con.execute("INSERT INTO employees (code, name, department, company, status, employment_type, gross_salary) "
                    "VALUES (?, ?, 'PRODUCTION', ?, 'Active', 'Permanent', 20000)", (code, name, COMPANY))
    con.commit(); con.close()

    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path='/opt/pw-browsers/chromium' if os.path.exists('/opt/pw-browsers/chromium') else None)

        def login(user, pw, width=1440):
            ctx = browser.new_context(viewport={'width': width, 'height': 900})
            page = ctx.new_page()
            page.on('pageerror', lambda e, u=user: PAGE_ERRORS.append(f'{u}: {e}'))
            page.on('response', lambda r, u=user: (r.status >= 400 and '/api/' in r.url) and API_ERRORS.append(f'{u}: {r.status} {r.url}'))
            page.goto(f'{BASE}/login')
            page.get_by_placeholder('admin').fill(user)
            page.get_by_placeholder('••••••••').fill(pw)
            page.get_by_role('button', name='Sign in').click()
            page.wait_for_url(lambda u: '/login' not in u, timeout=15000)
            page.goto(f'{BASE}/leave-management'); page.wait_for_load_state('networkidle')
            page.get_by_role('button', name='Gate Passes', exact=True).click(); page.wait_for_load_state('networkidle')
            return page

        def open_modal(page, code, day, ltype=None):
            page.get_by_role('button', name='+ New Gate Pass').click()
            modal = page.locator('div', has=page.get_by_text('Create Gate Pass', exact=True)).last
            page.get_by_placeholder('Search by name or code...').fill(code)
            page.get_by_role('button', name=code, exact=False).first.click()
            page.locator('input[type=date]').fill(D(day))
            page.wait_for_load_state('networkidle'); page.wait_for_timeout(400)
            if ltype: page.locator(f'input[name=gate-pass-type][value={ltype}]').check()
            return modal

        print('\n— hr: first Short Leave —')
        hr = login('hr', 'Indriyan@2025')
        open_modal(hr, '91001', 2)
        check('label says Short Leave (2 hrs)', hr.get_by_text('Short Leave (2 hrs)').count() == 1)
        check('duration shows 2 hrs', hr.locator('input[readonly]').first.input_value() == '2 hrs')
        check('allowance text shown', hr.get_by_text('Allowance: 2 Short Leaves or 1 Half Day per month').count() == 1)
        check('used: nothing yet', hr.get_by_text('Used: nothing yet').count() == 1)
        check('still allowed: 2 Short Leaves or 1 Half Day', hr.get_by_text('Still allowed: 2 Short Leaves or 1 Half Day').count() == 1)
        hr.get_by_placeholder('Reason for gate pass...').fill('Doctor visit')
        hr.screenshot(path=os.path.join(SHOTS, '1-hr-first-short-leave.png'))
        hr.get_by_role('button', name='Create Gate Pass', exact=True).click()
        hr.get_by_text('Gate pass created', exact=True).last.wait_for(timeout=10000)
        check('toast: Gate pass created', True)
        rows = q("SELECT * FROM short_leaves WHERE employee_code='91001'")
        check('DB: 1 row, 2 h, leave from 18:00', len(rows) == 1 and rows[0]['duration_hours'] == 2 and rows[0]['authorized_leave_until'] == '18:00', str(rows))
        hr.wait_for_timeout(800)
        row = hr.locator('tbody tr', has=hr.get_by_text('91001', exact=True))
        check('list shows the new pass (2h, 18:00) without a reload', row.count() == 1 and '2h' in row.inner_text() and '18:00' in row.inner_text(), row.inner_text() if row.count() else 'no row')

        print('\n— hr: Half Day not available after one Short Leave —')
        open_modal(hr, '91001', 3)
        check('used: 1 Short Leave', hr.get_by_text('Used: 1 Short Leave').count() == 1)
        check('still allowed: 1 Short Leave', hr.get_by_text('Still allowed: 1 Short Leave').count() == 1)
        hd = hr.locator('input[name=gate-pass-type][value=half_day]')
        check('Half Day radio disabled for HR', hd.is_disabled())
        check('"not available" shown next to Half Day', hr.get_by_text('not available').count() == 1)
        hr.screenshot(path=os.path.join(SHOTS, '2-hr-half-day-unavailable.png'))
        hr.get_by_placeholder('Reason for gate pass...').fill('Bank work')
        hr.get_by_role('button', name='Create Gate Pass', exact=True).click()
        hr.get_by_text('Gate pass created', exact=True).last.wait_for(timeout=10000)
        check('second Short Leave created', len(q("SELECT id FROM short_leaves WHERE employee_code='91001'")) == 2)

        print('\n— hr: allowance used up —')
        open_modal(hr, '91001', 4)
        check('used: 2 Short Leaves', hr.get_by_text('Used: 2 Short Leaves').count() == 1)
        check('still allowed: nothing more this month', hr.get_by_text('Still allowed: nothing more this month').count() == 1)
        check('red banner says only admin can allow one more', hr.get_by_text('Only an admin can allow one more', exact=False).count() == 1)
        hr.get_by_placeholder('Reason for gate pass...').fill('Personal work')
        check('Create button disabled for HR', hr.get_by_role('button', name='Create Gate Pass', exact=True).is_disabled())
        check('no reason box for HR', hr.get_by_placeholder('Reason for going over the allowance', exact=False).count() == 0)
        hr.screenshot(path=os.path.join(SHOTS, '3-hr-allowance-used.png'))
        hr.locator('button.btn', has_text='Cancel').click()
        check('DB: still 2 rows', len(q("SELECT id FROM short_leaves WHERE employee_code='91001'")) == 2)

        print('\n— hr: Half Day first → Short Leave not available —')
        open_modal(hr, '91002', 2, 'half_day')
        hr.get_by_placeholder('Reason for gate pass...').fill('Family function')
        hr.get_by_role('button', name='Create Gate Pass', exact=True).click()
        hr.get_by_text('Gate pass created', exact=True).last.wait_for(timeout=10000)
        r2 = q("SELECT * FROM short_leaves WHERE employee_code='91002'")
        check('DB: Half Day 6 h on 12HR, leave from 14:00', len(r2) == 1 and r2[0]['leave_type'] == 'half_day' and r2[0]['duration_hours'] == 6 and r2[0]['authorized_leave_until'] == '14:00', str(r2))
        open_modal(hr, '91002', 9)
        check('used: 1 Half Day', hr.get_by_text('Used: 1 Half Day').count() == 1)
        check('Short Leave radio disabled', hr.locator('input[name=gate-pass-type][value=short_leave]').is_disabled())
        check('Create disabled', hr.get_by_role('button', name='Create Gate Pass', exact=True).is_disabled())
        hr.locator('button.btn', has_text='Cancel').click()

        print('\n— admin: over the allowance with a reason —')
        ad = login('admin', 'Admin@123')
        open_modal(ad, '91001', 5)
        reason = ad.get_by_placeholder('Reason for going over the allowance', exact=False)
        check('admin sees the reason box', reason.count() == 1)
        btn = ad.get_by_role('button', name='Create over allowance', exact=True)
        ad.get_by_placeholder('Reason for gate pass...').fill('Hospital visit')
        check('button disabled with no reason', btn.is_disabled())
        reason.fill('too short')
        check('button disabled with 9 characters', btn.is_disabled())
        reason.fill('Hospital visit, approved by plant head')
        check('button enabled with a full reason', not btn.is_disabled())
        ad.wait_for_timeout(400)  # button fades in from disabled (150 ms transition)
        ad.screenshot(path=os.path.join(SHOTS, '4-admin-over-allowance.png'))
        btn.click()
        ad.get_by_text('Gate pass created over the monthly allowance', exact=True).last.wait_for(timeout=10000)
        check('toast: created over the monthly allowance', True)
        b = q("SELECT * FROM short_leaves WHERE employee_code='91001' AND date=?", (D(5),))
        check('DB: breach row with reason', len(b) == 1 and b[0]['quota_breach'] == 1 and b[0]['breach_reason'] == 'Hospital visit, approved by plant head', str(b))
        ad.wait_for_timeout(800)
        badge = ad.locator('tbody tr', has=ad.get_by_text(D(5), exact=True)).get_by_text('BREACH', exact=True)
        check('BREACH badge shown', badge.count() == 1)
        check('BREACH tooltip carries the reason', badge.count() == 1 and 'Hospital visit' in (badge.get_attribute('title') or ''))
        aud = q("SELECT stage, changed_by FROM audit_log WHERE table_name='short_leaves' AND record_id=?", (b[0]['id'],))
        check('audit row: short_leave_quota_override by admin', aud and aud[0]['stage'] == 'short_leave_quota_override' and aud[0]['changed_by'] == 'admin', str(aud))

        print('\n— admin: same-day pass → server refusal is shown —')
        open_modal(ad, '91002', 2, 'short_leave')
        ad.get_by_placeholder('Reason for gate pass...').fill('Second pass same day')
        ad.get_by_placeholder('Reason for going over the allowance', exact=False).fill('Testing a same-day second pass')
        ad.get_by_role('button', name='Create over allowance', exact=True).click()
        ad.get_by_text('already has a Half Day on', exact=False).last.wait_for(timeout=10000)
        check('toast shows the 409 reason', True)
        check('DB: still one pass for 91002 on that day', len(q("SELECT id FROM short_leaves WHERE employee_code='91002' AND date=?", (D(2),))) == 1)
        ad.locator('button.btn', has_text='Cancel').click()

        print('\n— hr: cancelling gives the points back —')
        hr.reload(); hr.wait_for_load_state('networkidle')
        hr.get_by_role('button', name='Gate Passes', exact=True).click(); hr.wait_for_load_state('networkidle')
        hr.once('dialog', lambda d: d.accept())
        hr.locator('tbody tr', has=hr.get_by_text('91002', exact=True)).get_by_role('button', name='Cancel').click()
        hr.get_by_text('Gate pass cancelled', exact=True).last.wait_for(timeout=10000)
        open_modal(hr, '91002', 9, 'half_day')
        check('after cancel: Half Day available again', not hr.locator('input[name=gate-pass-type][value=half_day]').is_disabled()
              and not hr.get_by_role('button', name='Create Gate Pass', exact=True).is_disabled())
        hr.locator('button.btn', has_text='Cancel').click()

        print('\n— phone width —')
        ph = login('hr', 'Indriyan@2025', width=390)
        open_modal(ph, '91003', 2)
        ph.screenshot(path=os.path.join(SHOTS, '5-phone-modal.png'), full_page=True)
        check('modal renders at 390 px', ph.get_by_text('Still allowed: 2 Short Leaves or 1 Half Day').count() == 1)

        browser.close()

    print()
    check('0 page errors', not PAGE_ERRORS, str(PAGE_ERRORS))
    expected_api = [e for e in API_ERRORS if 'short-leaves' in e and ' 409 ' in e]
    unexpected_api = [e for e in API_ERRORS if e not in expected_api and '/vite.svg' not in e]
    check('only API error is the deliberate same-day 409', len(expected_api) == 1 and not unexpected_api, str(API_ERRORS))
finally:
    srv.terminate()
    try: srv.wait(timeout=10)
    except Exception: srv.kill()

print(f'\n{PASS} passed, {FAIL} failed — screenshots in {SHOTS}')
sys.exit(1 if FAIL else 0)
