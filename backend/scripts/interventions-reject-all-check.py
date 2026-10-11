#!/usr/bin/env python3
"""Finance Audit → Manual Interventions: bulk confirm, Reject All reason, header checkbox (P1-16) — browser check.

Chromium against the BUILT dist, real finance login, scratch DATA_DIR with fictional data (codes T96xx,
names "TEST EMP n" — repo is public).
  Sep 2026: T9601 MANUAL_TDS, T9602 SALARY_HELD, T9603 MANUAL_OTHER_DEDUCTION, T9604 GROSS_STRUCTURE_CHANGE (pending),
            T9605 MANUAL_TDS (already approved), + one live punch correction (T9601).
  Aug 2026: T9611 MANUAL_TDS, T9612 SALARY_HELD (pending) — for Approve All.

Usage:
  python3 backend/scripts/interventions-reject-all-check.py             # this tree
  APP_ROOT=/tmp/wt python3 .../interventions-reject-all-check.py --base # old code: expect one-click reject, no reason
Needs `npm run build --prefix frontend` in APP_ROOT first. PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers.
"""
import json, os, shutil, sqlite3, subprocess, sys, tempfile, time, urllib.request
from playwright.sync_api import sync_playwright

HERE_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
ROOT = os.path.abspath(os.environ.get('APP_ROOT', HERE_ROOT))
BASE_MODE = '--base' in sys.argv
PORT = int(os.environ.get('PORT', '3116')); BASE = f'http://127.0.0.1:{PORT}'
WORK = tempfile.mkdtemp(prefix='p116-'); DB = os.path.join(WORK, 'hr_system.db')
C = 'Asian Lakto Ind Ltd'
PASS = FAIL = 0


def check(label, expected, actual):
    global PASS, FAIL
    if expected == actual: PASS += 1; print(f'  ✓ {label}')
    else: FAIL += 1; print(f'  ✗ {label} — expected {expected!r}, got {actual!r}')


def q(sql, *a):
    c = sqlite3.connect(DB); r = c.execute(sql, a).fetchall(); c.commit(); c.close(); return r


FLAGS = [('T9601', 9, 'MANUAL_TDS', 0, 0, 500), ('T9602', 9, 'SALARY_HELD', 0, 0, 0),
         ('T9603', 9, 'MANUAL_OTHER_DEDUCTION', 0, 0, 300), ('T9604', 9, 'GROSS_STRUCTURE_CHANGE', 0, 18000, 20000),
         ('T9605', 9, 'MANUAL_TDS', 1, 0, 200), ('T9611', 8, 'MANUAL_TDS', 0, 0, 100), ('T9612', 8, 'SALARY_HELD', 0, 0, 0)]


def seed():
    c = sqlite3.connect(DB)
    for code in sorted({f[0] for f in FLAGS}):
        c.execute("INSERT OR IGNORE INTO employees(code,name,department,company,status,employment_type,gross_salary) "
                  "VALUES(?,?,'TEST DEPT',?,'Active','Permanent',20000)", (code, f'TEST EMP {code[1:]}', C))
    for code, m, t, appr, sv, mv in FLAGS:
        c.execute("INSERT INTO salary_manual_flags(employee_code,month,year,flag_type,finance_approved,system_value,manual_value,delta,notes) "
                  "VALUES(?,?,2026,?,?,?,?,?,'test flag')", (code, m, t, appr, sv, mv, mv - sv))
    c.execute("INSERT INTO punch_corrections(employee_code,date,corrected_in_time,punch_type,reason,added_by) "
              "VALUES('T9601','2026-09-05','09:00','IN','test punch fix','hr')")
    c.commit(); c.close()


def fid(code, m=9):
    return q('SELECT id FROM salary_manual_flags WHERE employee_code=? AND month=?', code, m)[0][0]


def status_of(code, m=9):
    return q('SELECT finance_approved FROM salary_manual_flags WHERE employee_code=? AND month=?', code, m)[0][0]


def login(ctx, user, pw):
    pg = ctx.new_page()
    errs, cons, bad, puts = [], [], [], []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('console', lambda m: cons.append(m.text) if m.type == 'error' and 'vite.svg' not in m.text and '404' not in m.text else None)
    pg.on('response', lambda r: bad.append(f'{r.status} {r.url}') if '/api/' in r.url and r.status >= 400 else None)
    pg.on('request', lambda r: puts.append(json.loads(r.post_data or '{}')) if r.method == 'PUT' and '/finance-audit/bulk-approve' in r.url else None)
    pg.goto(BASE + '/login'); pg.get_by_placeholder('admin').fill(user); pg.get_by_placeholder('••••••••').fill(pw)
    pg.get_by_role('button', name='Sign in').click(); pg.wait_for_url(lambda u: '/login' not in u)
    return pg, errs, cons, bad, puts


def open_tab(pg, month):
    pg.goto(BASE + '/finance-audit?tab=interventions'); pg.wait_for_load_state('networkidle')
    pg.locator('select').filter(has=pg.locator('option', has_text='September')).first.select_option(str(month))
    time.sleep(.3); pg.reload(); pg.wait_for_load_state('networkidle'); time.sleep(1)


def hdr(pg):
    return pg.locator('table thead input[type=checkbox]').first


def hstate(pg):
    h = hdr(pg)
    return (h.is_checked(), h.evaluate('e => e.indeterminate'))


def sel_count(pg):
    t = pg.get_by_text(' selected', exact=False).filter(has_text='selected')
    return t.first.inner_text().strip() if t.count() else None


def filt(pg, which, value):  # which: 0 = type select, 1 = status select (filter row)
    sels = pg.locator('select.input.text-xs')
    sels.nth(which).select_option(value); time.sleep(.4)


env = dict(os.environ, DATA_DIR=WORK, JWT_SECRET='x', PORT=str(PORT), NODE_ENV='production',
           ADMIN_PASSWORD='Admin@123', HR_PASSWORD='Indriyan@2025', FINANCE_PASSWORD='Finance@2025')
srv = subprocess.Popen(['node', f'{ROOT}/backend/server.js'], env=env, stdout=open(f'{WORK}/log', 'w'), stderr=subprocess.STDOUT)
try:
    for _ in range(80):
        try: urllib.request.urlopen(BASE + '/api/version', timeout=2); break
        except Exception: time.sleep(.5)
    seed()
    print(f'App root: {ROOT}  mode: {"BASE (expect old behaviour)" if BASE_MODE else "fix"}')

    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context(viewport={'width': 1440, 'height': 900})
        pg, errs, cons, bad, puts = login(ctx, 'finance', 'Finance@2025')
        open_tab(pg, 9)

        if BASE_MODE:
            hdr(pg).click(); time.sleep(.3)
            check('old: header click ticks the approved row too', True, pg.locator('table tbody input[type=checkbox]').nth(4).is_checked())
            check('old: header box NOT checked although every tickable row is ticked', False, hdr(pg).is_checked())
            pg.get_by_role('button', name='Reject All').click(); time.sleep(1.5)
            check('old: no confirm window', 0, pg.locator('[data-testid=bulk-modal]').count())
            check('old: one click sent the PUT', 1, len(puts))
            check('old: no reason in the request', None, (puts[0] if puts else {}).get('comments'))
            check('old: already-approved T9605 flipped to rejected', -1, status_of('T9605'))
            check('old: gross-change T9604 rejected in bulk, gross NOT reverted', (-1, 20000.0),
                  (status_of('T9604'), q("SELECT gross_salary FROM employees WHERE code='T9604'")[0][0]))
            check('old: finance_approvals comments empty', [('',)] * 5, q("SELECT comments FROM finance_approvals"))
            b.close()
        else:
            print('\n— rows tickable: pending, non-live only —')
            for code in ('T9601', 'T9602', 'T9603', 'T9604'):
                check(f'{code} pending row has a box', 1, pg.locator(f'[data-testid=flag-box-{fid(code)}]').count())
            check('approved T9605 has no box', 0, pg.locator(f'[data-testid=flag-box-{fid("T9605")}]').count())
            check('body checkboxes = 4 (live + approved rows excluded)', 4, pg.locator('table tbody input[type=checkbox]').count())
            check('live punch row listed', True, pg.get_by_text('live', exact=True).count() > 0)

            print('\n— header box state —')
            check('header: empty', (False, False), hstate(pg))
            pg.locator(f'[data-testid=flag-box-{fid("T9602")}]').check(); time.sleep(.2)
            check('header: one ticked → indeterminate', (False, True), hstate(pg))
            check('"1 selected"', '1 selected', sel_count(pg))
            hdr(pg).click(); time.sleep(.2)
            check('header click from partial → all ticked, checked', (True, False), hstate(pg))
            check('"4 selected"', '4 selected', sel_count(pg))
            hdr(pg).click(); time.sleep(.2)
            check('header click again → none', (False, False), hstate(pg))
            check('no selection bar', None, sel_count(pg))

            print('\n— filters: selection clears, header follows the filtered set —')
            filt(pg, 1, 'pending'); hdr(pg).click(); time.sleep(.2)
            check('Pending filter: header selects 4', '4 selected', sel_count(pg))
            filt(pg, 0, 'MANUAL_TDS')
            check('type filter change clears selection', None, sel_count(pg))
            check('header empty after filter change', (False, False), hstate(pg))
            filt(pg, 1, '')
            hdr(pg).click(); time.sleep(.2)
            check('MANUAL_TDS (all status): header selects 1 pending (T9605 approved not)', '1 selected', sel_count(pg))
            check('header checked on filtered list', (True, False), hstate(pg))
            filt(pg, 1, 'approved')
            check('Approved filter: header disabled (nothing tickable)', True, hdr(pg).is_disabled())
            filt(pg, 0, ''); filt(pg, 1, '')

            print('\n— Reject All: confirm + reason —')
            hdr(pg).click(); time.sleep(.2)
            pg.get_by_role('button', name='Reject All').click(); time.sleep(.4)
            m = pg.locator('[data-testid=bulk-modal]')
            check('window opens', 1, m.count())
            check('title names the count (gross change left out)', 1, pg.get_by_text('Reject 3 flags?', exact=True).count())
            check('left-out note names 1 gross change', True, '1 gross salary change left out' in pg.locator('[data-testid=bulk-left-out]').inner_text())
            conf = pg.locator('[data-testid=bulk-confirm]')
            check('Confirm disabled with no reason', True, conf.is_disabled())
            pg.locator('[data-testid=bulk-reason]').fill('abcd')
            check('Confirm disabled with 4 chars', True, conf.is_disabled())
            pg.locator('[data-testid=bulk-reason]').fill('   ab   ')
            check('Confirm disabled with spaces + 2 chars', True, conf.is_disabled())
            pg.get_by_role('button', name='Cancel').click(); time.sleep(.4)
            check('Cancel closes the window', 0, m.count())
            check('Cancel sent nothing', 0, len(puts))
            check('DB unchanged after Cancel', [0, 0, 0, 0], [status_of(c) for c in ('T9601', 'T9602', 'T9603', 'T9604')])
            check('selection kept after Cancel', '4 selected', sel_count(pg))
            pg.get_by_role('button', name='Reject All').click(); time.sleep(.3)
            check('reopened window has an empty reason', '', pg.locator('[data-testid=bulk-reason]').input_value())
            pg.keyboard.press('Escape'); time.sleep(.3)
            check('Esc closes, nothing sent', (0, 0), (m.count(), len(puts)))

            pg.get_by_role('button', name='Reject All').click(); time.sleep(.3)
            pg.locator('[data-testid=bulk-reason]').fill('  Test reason for bulk  ')
            check('Confirm enabled with a valid reason', False, conf.is_disabled())
            conf.dblclick(); time.sleep(1.5)
            check('double click → exactly one PUT', 1, len(puts))
            body = puts[0] if puts else {}
            check('PUT flagIds = the 3 non-gross ticked rows', sorted([fid('T9601'), fid('T9602'), fid('T9603')]), sorted(body.get('flagIds', [])))
            check('PUT status REJECTED', 'REJECTED', body.get('status'))
            check('PUT comments = trimmed reason', 'Test reason for bulk', body.get('comments'))
            check('window closed on success', 0, m.count())
            check('DB: the 3 rejected', [-1, -1, -1], [status_of(c) for c in ('T9601', 'T9602', 'T9603')])
            check('DB: gross change still pending', 0, status_of('T9604'))
            check('DB: approved T9605 untouched', 1, status_of('T9605'))
            check('finance_approvals: 3 rows with the reason', [('Test reason for bulk',)] * 3, q("SELECT comments FROM finance_approvals"))
            check('employee gross untouched by the bulk call', 20000.0, q("SELECT gross_salary FROM employees WHERE code='T9604'")[0][0])

            print('\n— user sim: reject the gross change one by one (reverts the gross) —')
            row = pg.locator('tr', has=pg.get_by_text('T9604', exact=True))
            row.get_by_role('button', name='Reject').click(); time.sleep(.3)
            pg.locator('textarea[placeholder="Add comments..."]').fill('Test gross reject')
            pg.get_by_role('button', name='Submit').click(); time.sleep(1.2)
            check('T9604 rejected via the row', -1, status_of('T9604'))
            check('T9604 gross reverted to 18000', 18000.0, q("SELECT gross_salary FROM employees WHERE code='T9604'")[0][0])

            print('\n— Approve All: simple confirm (August) —')
            open_tab(pg, 8); n0 = len(puts)
            hdr(pg).click(); time.sleep(.2)
            pg.get_by_role('button', name='Approve All').click(); time.sleep(.3)
            check('title names the count', 1, pg.get_by_text('Approve 2 flags?', exact=True).count())
            check('no reason box for approve', 0, pg.locator('[data-testid=bulk-reason]').count())
            pg.get_by_role('button', name='Cancel').click(); time.sleep(.3)
            check('Cancel sent nothing', n0, len(puts))
            pg.get_by_role('button', name='Approve All').click(); time.sleep(.3)
            pg.locator('[data-testid=bulk-confirm]').click(); time.sleep(1.2)
            check('one PUT, status APPROVED, 2 ids', (n0 + 1, 'APPROVED', 2), (len(puts), puts[-1].get('status'), len(puts[-1].get('flagIds', []))))
            check('DB: both approved', [1, 1], [status_of('T9611', 8), status_of('T9612', 8)])

            check('finance: 0 page errors', [], errs)
            check('finance: 0 console errors', [], cons)
            check('finance: 0 API ≥ 400', [], bad)

            print('\n— phone 390px: window usable —')
            q("UPDATE salary_manual_flags SET finance_approved=0 WHERE month=8")
            ctx3 = b.new_context(viewport={'width': 390, 'height': 844})
            pg3, errs3, cons3, bad3, puts3 = login(ctx3, 'finance', 'Finance@2025')
            open_tab(pg3, 8)
            hdr(pg3).click(); time.sleep(.2)
            pg3.get_by_role('button', name='Reject All').click(); time.sleep(.3)
            pg3.locator('[data-testid=bulk-reason]').fill('Phone test reason')
            c3 = pg3.locator('[data-testid=bulk-confirm]')
            check('phone: Confirm in viewport + enabled', (True, False), (c3.is_visible(), c3.is_disabled()))
            c3.click(); time.sleep(1.2)
            check('phone: rejected with reason', ([-1, -1], 'Phone test reason'), ([status_of('T9611', 8), status_of('T9612', 8)], puts3[-1].get('comments') if puts3 else None))
            check('phone: 0 page errors', [], errs3)
            b.close()
finally:
    srv.terminate(); shutil.rmtree(WORK, ignore_errors=True)

print(f'\n{PASS} passed, {FAIL} failed')
sys.exit(1 if FAIL else 0)
