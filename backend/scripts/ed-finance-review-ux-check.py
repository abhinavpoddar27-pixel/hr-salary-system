#!/usr/bin/env python3
"""Extra duty Finance Review UX — browser check (Chromium, built dist, real logins).

Seeds a scratch DB shaped like production September 2026 (171 finance-approved,
22 finance-rejected, 212 unreviewed), logs in as finance and checks that the
rejected rows can actually be found, selected in bulk and returned to HR.

Scratch DATA_DIR only, torn down at exit. Needs `npm run build` first.
Usage: python3 backend/scripts/ed-finance-review-ux-check.py [screenshot_dir]
"""
import os, shutil, sqlite3, subprocess, sys, tempfile, time, urllib.request
from playwright.sync_api import sync_playwright

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
PORT = int(os.environ.get('PORT', '3992')); BASE = f'http://127.0.0.1:{PORT}'
SHOTS = sys.argv[1] if len(sys.argv) > 1 else None
WORK = tempfile.mkdtemp(prefix='ed-ux-'); DB = os.path.join(WORK, 'hr_system.db')
C = 'Asian Lakto Ind Ltd'
PASS = FAIL = 0


def check(label, expected, actual):
    global PASS, FAIL
    if expected == actual: PASS += 1; print(f'  ✓ {label}')
    else: FAIL += 1; print(f'  ✗ {label} — expected {expected!r}, got {actual!r}')


def shot(pg, name):
    if SHOTS: pg.screenshot(path=os.path.join(SHOTS, name))


env = dict(os.environ, DATA_DIR=WORK, JWT_SECRET='x', PORT=str(PORT), NODE_ENV='production',
           ADMIN_PASSWORD='Admin@123', HR_PASSWORD='Indriyan@2025', FINANCE_PASSWORD='Finance@2025')
srv = subprocess.Popen(['node', f'{ROOT}/backend/server.js'], env=env, stdout=open(f'{WORK}/log', 'w'), stderr=subprocess.STDOUT)
try:
    for _ in range(80):
        try: urllib.request.urlopen(BASE + '/api/version', timeout=2); break
        except Exception: time.sleep(.5)
    c = sqlite3.connect(DB)

    def add(i, fs, date):
        code = f'{20000 + i}'
        c.execute("INSERT OR IGNORE INTO employees(code,name,department,company,status,employment_type) VALUES(?,?,'OFFICE ADMIN',?,'Active','Permanent')", (code, f'EMP {code}', C))
        c.execute("""INSERT INTO extra_duty_grants(employee_code,grant_date,month,year,company,grant_type,duty_days,verification_source,
                     status,finance_status,finance_flag_reason,requested_by) VALUES(?,?,9,2026,?,'OVERNIGHT_STAY',?,'Gate Register','APPROVED',?,?,'hr1')""",
                  (code, date, C, 1 if fs == 'FINANCE_REJECTED' else 0.5, fs, 'power cut' if fs == 'FINANCE_REJECTED' else None))
    i = 0
    for _ in range(171): i += 1; add(i, 'FINANCE_APPROVED', f'2026-09-{(i % 28) + 1:02d}')
    for _ in range(22): i += 1; add(i, 'FINANCE_REJECTED', '2026-09-07')
    for _ in range(212): i += 1; add(i, 'UNREVIEWED', f'2026-09-{(i % 28) + 1:02d}')
    c.commit(); c.close()

    with sync_playwright() as p:
        b = p.chromium.launch(); pg = b.new_context(viewport={'width': 1440, 'height': 900}).new_page()
        errs, bad = [], []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.on('response', lambda r: bad.append(f'{r.status} {r.url}') if '/api/' in r.url and r.status >= 400 else None)
        pg.goto(BASE + '/login'); pg.get_by_placeholder('admin').fill('finance'); pg.get_by_placeholder('••••••••').fill('Finance@2025')
        pg.get_by_role('button', name='Sign in').click(); pg.wait_for_url(lambda u: '/login' not in u)
        pg.goto(BASE + '/extra-duty-grants'); pg.wait_for_load_state('networkidle')
        for k in range(pg.locator('select').count()):
            s = pg.locator('select').nth(k)
            if 'September' in ' '.join(s.locator('option').all_inner_texts()): s.select_option(label='September')
        pg.wait_for_load_state('networkidle'); time.sleep(1)

        print('\n— Landing (Finance Review, All) —')
        chips = pg.locator('[data-testid=fin-filters] button')
        check('5 filter chips', 5, chips.count())
        check('Rejected chip shows 22', 'Rejected (22)', pg.locator('[data-filter=FINANCE_REJECTED]').inner_text().strip())
        check('All chip shows 405', 'All (405)', pg.locator('[data-filter=all]').inner_text().strip())
        order = pg.locator('tbody tr').evaluate_all('rs => rs.map(r => r.dataset.fin)')
        check('405 rows', 405, len(order))
        check('first row is UNREVIEWED (needs action first)', 'UNREVIEWED', order[0])
        check('rejected rows come before approved ones', True, max(k for k, f in enumerate(order) if f == 'FINANCE_REJECTED') < min(k for k, f in enumerate(order) if f == 'FINANCE_APPROVED'))
        shot(pg, 'u1-landing.png')

        print('\n— "All" header box keeps old behaviour (unreviewed only) —')
        pg.locator('[data-testid=select-all]').check(); time.sleep(.3)
        check('bulk bar visible', True, pg.locator('[data-testid=bulk-bar]').is_visible())
        check('Bulk Approve (212)', 1, pg.get_by_role('button', name='Bulk Approve (212)').count())
        check('no Return button from All select', 0, pg.get_by_role('button', name='↩ Return to HR (', exact=False).count())
        pg.locator('[data-testid=bulk-bar]').get_by_role('button', name='Clear').click(); time.sleep(.2)
        check('Clear hides the bar', 0, pg.locator('[data-testid=bulk-bar]').count())

        print('\n— Rejected filter → select all → Return to HR —')
        pg.locator('[data-filter=FINANCE_REJECTED]').click(); time.sleep(.3)
        rows = pg.locator('tbody tr')
        check('22 rows in Rejected view', 22, rows.count())
        check('all rows rejected', {'FINANCE_REJECTED'}, set(rows.evaluate_all('rs => rs.map(r => r.dataset.fin)')))
        pg.locator('[data-testid=select-all]').check(); time.sleep(.3)
        check('22 checkboxes ticked', 22, pg.locator('tbody input[type=checkbox]:checked').count())
        ret = pg.get_by_role('button', name='↩ Return to HR (22)')
        check('Return to HR (22) in bulk bar', 1, ret.count())
        pg.mouse.wheel(0, 4000); time.sleep(.3)
        box = ret.bounding_box()
        check('button still on screen after scrolling', True, bool(box) and 0 <= box['y'] <= 900 - box['height'])
        shot(pg, 'u2-rejected-selected.png')

        print('\n— Filter change clears a selection —')
        pg.locator('[data-filter=FINANCE_APPROVED]').click(); time.sleep(.3)
        check('selection cleared on filter change', 0, pg.locator('[data-testid=bulk-bar]').count())
        check('Approved view: header box disabled (nothing selectable)', True, pg.locator('[data-testid=select-all]').is_disabled())
        pg.locator('[data-filter=FINANCE_REJECTED]').click(); time.sleep(.3)
        pg.locator('[data-testid=select-all]').check(); time.sleep(.3)

        print('\n— Submit the return —')
        pg.get_by_role('button', name='↩ Return to HR (22)').click()
        pg.get_by_placeholder("What should HR correct?", exact=False).fill('Power cut — give 0.5 day, not 1')
        pg.get_by_role('button', name='Return to HR', exact=True).click()
        pg.wait_for_load_state('networkidle'); time.sleep(1.5)
        check('Rejected chip now 0', 'Rejected (0)', pg.locator('[data-filter=FINANCE_REJECTED]').inner_text().strip())
        con = sqlite3.connect(DB)
        n = con.execute("SELECT COUNT(*) FROM extra_duty_grants WHERE grant_date='2026-09-07' AND status='PENDING' AND finance_status='UNREVIEWED' AND finance_notes LIKE 'Returned by finance%'").fetchone()[0]
        others = con.execute("SELECT finance_status, COUNT(*) FROM extra_duty_grants GROUP BY finance_status ORDER BY 1").fetchall(); con.close()
        check('DB: 22 rows back with HR (PENDING/UNREVIEWED + note)', 22, n)
        check('DB: approved + unreviewed rows untouched', [('FINANCE_APPROVED', 171), ('UNREVIEWED', 234)], others)
        shot(pg, 'u3-after-return.png')

        print('\n— Single-row path still works (flagged) —')
        con = sqlite3.connect(DB); con.execute("UPDATE extra_duty_grants SET finance_status='FINANCE_FLAGGED', finance_flag_reason='check gate' WHERE id=(SELECT MIN(id) FROM extra_duty_grants WHERE finance_status='FINANCE_APPROVED')"); con.commit(); con.close()
        pg.reload(); pg.wait_for_load_state('networkidle'); time.sleep(1)
        for k in range(pg.locator('select').count()):
            s = pg.locator('select').nth(k)
            if 'September' in ' '.join(s.locator('option').all_inner_texts()): s.select_option(label='September')
        pg.wait_for_load_state('networkidle'); time.sleep(1)
        pg.locator('[data-filter=FINANCE_FLAGGED]').click(); time.sleep(.3)
        check('Flagged view: 1 row', 1, pg.locator('tbody tr').count())
        check('flagged row has Approve / Reject / Return', 3, pg.locator('tbody tr').first.get_by_role('button').filter(has_text='Approve').count() + pg.locator('tbody tr').first.get_by_role('button').filter(has_text='Reject').count() + pg.locator('tbody tr').first.get_by_role('button').filter(has_text='Return to HR').count())

        print('\n— HR view unaffected —')
        pg.get_by_role('button', name='HR Queue').click(); time.sleep(.5)
        check('no filter chips on HR Queue', 0, pg.locator('[data-testid=fin-filters]').count())

        check('0 page errors', [], errs)
        check('0 API 4xx/5xx', [], bad)
        b.close()
finally:
    srv.terminate(); shutil.rmtree(WORK, ignore_errors=True)

print(f'\n{PASS} passed, {FAIL} failed')
sys.exit(1 if FAIL else 0)
