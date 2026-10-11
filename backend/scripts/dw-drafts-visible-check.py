#!/usr/bin/env python3
"""Daily wage: imported drafts are visible and can be submitted (P1-18, finding D-1) — browser check.

Chromium against the BUILT dist, real hr login, scratch DATA_DIR, fictional contractor "TEST GANG ALPHA" and
gate refs "TG-…" (the repo is public).

Usage:
  python3 backend/scripts/dw-drafts-visible-check.py               # this tree's server + dist
  APP_ROOT=/tmp/wt python3 .../dw-drafts-visible-check.py --base   # another tree (origin/main): records the bug
Needs `npm run build --prefix frontend` in APP_ROOT first. PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers.
"""
import json, os, sqlite3, subprocess, sys, tempfile, time, urllib.request
import openpyxl
from playwright.sync_api import sync_playwright

HERE_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
ROOT = os.path.abspath(os.environ.get('APP_ROOT', HERE_ROOT))
BASE_MODE = '--base' in sys.argv
PORT = int(os.environ.get('PORT', '3118')); BASE = f'http://127.0.0.1:{PORT}'
WORK = tempfile.mkdtemp(prefix='dw-drafts-'); DB = os.path.join(WORK, 'hr_system.db')
GANG = 'TEST GANG ALPHA'
PASS = FAIL = 0


def check(label, expected, actual):
    global PASS, FAIL
    if expected == actual: PASS += 1; print(f'  ✓ {label}')
    else: FAIL += 1; print(f'  ✗ {label} — expected {expected!r}, got {actual!r}')


def q(sql, *a):
    c = sqlite3.connect(DB); r = c.execute(sql, a).fetchall(); c.close(); return r


def api(method, path, body=None, token=None):
    req = urllib.request.Request(BASE + '/api' + path, method=method,
                                 data=json.dumps(body).encode() if body is not None else None,
                                 headers={'Content-Type': 'application/json',
                                          **({'Authorization': 'Bearer ' + token} if token else {})})
    try:
        with urllib.request.urlopen(req) as r: return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b'{}')


def make_xlsx(path, refs, day0):
    wb = openpyxl.Workbook(); ws = wb.active
    ws.append(['Date', 'Contractor', 'In', 'Out', 'Workers', 'Depts', 'Gate', 'Notes'])
    for i, ref in enumerate(refs):
        ws.append([f'2026-09-{day0 + i:02d}', GANG, '08:00', '17:00', 4, 'Packing:3,Scrap:1', ref, 'fictional'])
    wb.save(path)


def status_of(ref):
    r = q("SELECT status FROM dw_entries WHERE gate_entry_reference=?", ref); return r[0][0] if r else None


env = dict(os.environ, DATA_DIR=WORK, JWT_SECRET='x', PORT=str(PORT), NODE_ENV='production',
           ADMIN_PASSWORD='Admin@123', HR_PASSWORD='Indriyan@2025', FINANCE_PASSWORD='Finance@2025')
srv = subprocess.Popen(['node', f'{ROOT}/backend/server.js'], env=env, stdout=open(f'{WORK}/log', 'w'), stderr=subprocess.STDOUT)
try:
    for _ in range(80):
        try: urllib.request.urlopen(BASE + '/api/version', timeout=2); break
        except Exception: time.sleep(.5)
    print(f'App root: {ROOT}  mode: {"BASE (expect the bug)" if BASE_MODE else "fix"}')

    _, lg = api('POST', '/auth/login', {'username': 'hr', 'password': 'Indriyan@2025'}); TOK = lg['token']
    c = sqlite3.connect(DB)
    c.execute("INSERT INTO dw_contractors(contractor_name,current_daily_wage_rate,current_commission_rate,created_by) "
              "VALUES(?,500,50,'test')", (GANG,))
    c.commit(); cid = c.execute("SELECT id FROM dw_contractors WHERE contractor_name=?", (GANG,)).fetchone()[0]; c.close()
    for i, ref in enumerate(['TG-S1', 'TG-S2', 'TG-S3', 'TG-S4', 'TG-S5']):
        st, _ = api('POST', '/daily-wage/entries', {'contractor_id': cid, 'entry_date': f'2026-08-{i + 1:02d}', 'in_time': '08:00',
                                                   'out_time': '17:00', 'total_worker_count': 2,
                                                   'department_allocations': [{'department': 'Packing', 'worker_count': 2}],
                                                   'gate_entry_reference': ref}, TOK)
        assert st in (200, 201), st
    c = sqlite3.connect(DB)
    c.execute("UPDATE dw_entries SET status='needs_correction' WHERE gate_entry_reference='TG-S3'")
    c.execute("UPDATE dw_entries SET status='approved' WHERE gate_entry_reference IN ('TG-S4','TG-S5')")
    c.commit(); c.close()
    check('seed: 2 drafts, 1 needs correction, 2 approved', [('approved', 2), ('hr_entered', 2), ('needs_correction', 1)],
          q("SELECT status, COUNT(*) FROM dw_entries GROUP BY status ORDER BY status"))

    with sync_playwright() as p:
        b = p.chromium.launch()

        def page(width=1440):
            ctx = b.new_context(viewport={'width': width, 'height': 900}); pg = ctx.new_page()
            errs, cons, bad, posts = [], [], [], []
            pg.on('pageerror', lambda e: errs.append(str(e)))
            pg.on('console', lambda m: cons.append(m.text) if m.type == 'error' and 'vite.svg' not in m.text and 'status of 400' not in m.text and 'batch-submit → HTTP 400' not in m.text else None)
            pg.on('response', lambda r: bad.append(f'{r.status} {r.url}') if '/api/' in r.url and r.status >= 400 else None)
            pg.on('request', lambda r: posts.append((r.url, r.post_data)) if r.method == 'POST' and 'batch-submit' in r.url else None)
            pg.goto(BASE + '/login'); pg.get_by_placeholder('admin').fill('hr'); pg.get_by_placeholder('••••••••').fill('Indriyan@2025')
            pg.get_by_role('button', name='Sign in').click(); pg.wait_for_url(lambda u: '/login' not in u)
            return pg, errs, cons, bad, posts

        def gate_refs_in_list(pg):
            pg.wait_for_load_state('networkidle'); pg.wait_for_timeout(300)
            return pg.locator('tbody tr', has_text=GANG).count()

        if BASE_MODE:
            pg, errs, cons, bad, posts = page()
            pg.goto(BASE + '/daily-wage'); pg.wait_for_load_state('networkidle')
            check('base: no Draft card', 0, pg.locator('button', has_text='Draft').count())
            check('base: no Needs Correction card', 0, pg.locator('button', has_text='Needs Correction').count())
            xl = os.path.join(WORK, 'base.xlsx'); make_xlsx(xl, ['TG-B1', 'TG-B2'], 10)
            pg.goto(BASE + '/daily-wage/import'); pg.wait_for_load_state('networkidle')
            pg.locator('input[type=file]').set_input_files(xl)
            pg.get_by_role('button', name='Import 2 Entries').click()
            pg.wait_for_timeout(600)
            body = pg.locator('body').inner_text()
            check('base: done screen says nothing about drafts', False, 'draft' in body.lower())
            check('base: no Submit all button', 0, pg.locator('button', has_text='Submit all').count())
            pg.wait_for_timeout(2000)
            check('base: auto-redirected to records', True, pg.url.rstrip('/').endswith('/daily-wage'))
            check('base: imported rows stay drafts', ['hr_entered', 'hr_entered'], [status_of('TG-B1'), status_of('TG-B2')])
        else:
            print('— Records cards —')
            pg, errs, cons, bad, posts = page()
            pg.goto(BASE + '/daily-wage'); pg.wait_for_load_state('networkidle')
            check('Draft card = 2', '2', pg.get_by_test_id('dw-kpi-hr_entered').locator('div').first.inner_text())
            check('Needs Correction card = 1', '1', pg.get_by_test_id('dw-kpi-needs_correction').locator('div').first.inner_text())
            check('Draft card highlighted (count > 0)', True, 'bg-amber-50' in pg.get_by_test_id('dw-kpi-hr_entered').get_attribute('class'))
            check('unfiltered list shows all 5', 5, gate_refs_in_list(pg))
            pg.get_by_test_id('dw-kpi-hr_entered').click()
            check('Draft filter: 2 rows', 2, gate_refs_in_list(pg))
            check('Draft filter: hint shown', 1, pg.get_by_test_id('dw-draft-hint').count())
            check('Draft filter: every row a Draft', 2, pg.locator('tbody tr', has_text='Draft').count())
            pg.get_by_test_id('dw-kpi-needs_correction').click()
            check('Needs-correction filter: 1 row', 1, gate_refs_in_list(pg))
            check('Needs-correction hint shown', 1, pg.get_by_test_id('dw-correction-hint').count())
            pg.get_by_test_id('dw-kpi-total').click()
            check('Total clears filter', 5, gate_refs_in_list(pg))

            print('— Import → done screen → Submit all —')
            xl = os.path.join(WORK, 'imp1.xlsx'); make_xlsx(xl, ['TG-I1', 'TG-I2', 'TG-I3'], 10)
            pg.goto(BASE + '/daily-wage/import'); pg.wait_for_load_state('networkidle')
            pg.locator('input[type=file]').set_input_files(xl)
            pg.get_by_role('button', name='Import 3 Entries').click()
            pg.get_by_test_id('dw-import-drafts').wait_for()
            check('done screen: "3 entries created as drafts"', '3 entries created as drafts', pg.get_by_test_id('dw-import-drafts').inner_text())
            pg.wait_for_timeout(2500)
            check('no auto-redirect after 2.5 s', True, '/daily-wage/import' in pg.url)
            check('DB: 3 imported drafts', ['hr_entered'] * 3, [status_of(r) for r in ('TG-I1', 'TG-I2', 'TG-I3')])
            btn = pg.get_by_test_id('dw-import-submit-all')
            check('button text', 'Submit all 3 for finance review', btn.inner_text())
            btn.dblclick()
            pg.get_by_test_id('dw-import-submitted').wait_for()
            pg.wait_for_timeout(300)
            check('exactly one batch-submit POST', 1, len(posts))
            ids = sorted(json.loads(posts[0][1])['entry_ids'])
            check('POST carries the 3 imported ids', sorted(r[0] for r in q("SELECT id FROM dw_entries WHERE gate_entry_reference LIKE 'TG-I%'")), ids)
            check('success text', '3 entries sent to finance review', pg.get_by_test_id('dw-import-submitted').inner_text())
            check('DB: 3 rows pending_finance', ['pending_finance'] * 3, [status_of(r) for r in ('TG-I1', 'TG-I2', 'TG-I3')])
            check('DB: 3 submitted approvals', 3, q("SELECT COUNT(*) FROM dw_approvals a JOIN dw_entries e ON e.id=a.entry_id "
                                                  "WHERE e.gate_entry_reference LIKE 'TG-I%' AND a.action='submitted'")[0][0])
            check('seeded drafts untouched', ['hr_entered', 'hr_entered'], [status_of('TG-S1'), status_of('TG-S2')])
            time.sleep(5.5)  # past the server's max-age=5 window (no-cache comes with N-FRESH)
            pg.get_by_role('button', name='Go to records').click(); pg.wait_for_load_state('networkidle'); pg.wait_for_timeout(400)
            check('Records: Draft card still 2', '2', pg.get_by_test_id('dw-kpi-hr_entered').locator('div').first.inner_text())
            check('Records: Pending Finance card 3', '3', pg.locator('button', has_text='Pending Finance').locator('div').first.inner_text())

            print('— Edge: one draft submitted elsewhere, then Submit all —')
            xl = os.path.join(WORK, 'imp2.xlsx'); make_xlsx(xl, ['TG-J1', 'TG-J2'], 20)
            pg.goto(BASE + '/daily-wage/import'); pg.wait_for_load_state('networkidle')
            pg.locator('input[type=file]').set_input_files(xl)
            pg.get_by_role('button', name='Import 2 Entries').click()
            pg.get_by_test_id('dw-import-drafts').wait_for()
            j1 = q("SELECT id FROM dw_entries WHERE gate_entry_reference='TG-J1'")[0][0]
            st, _ = api('PUT', f'/daily-wage/entries/{j1}/submit', {}, TOK)
            check('J1 submitted via API', 200, st)
            pg.get_by_test_id('dw-import-submit-all').click()
            pg.get_by_test_id('dw-import-submit-error').wait_for()
            check('refusal message shown', True, 'not in hr_entered status' in pg.get_by_test_id('dw-import-submit-error').inner_text())
            check('J2 still a draft (all-or-nothing)', 'hr_entered', status_of('TG-J2'))
            check('Submit all still offered', 1, pg.get_by_test_id('dw-import-submit-all').count())
            pg.get_by_test_id('dw-import-open-drafts').click()
            pg.wait_for_url(lambda u: 'status=hr_entered' in u)
            check('drafts list opened with Draft filter', 'hr_entered', pg.locator('select', has_text='All Statuses').input_value())
            check('drafts list: 3 drafts (S1, S2, J2)', 3, gate_refs_in_list(pg))
            pg.locator('tbody tr', has_text=GANG).first.locator('input[type=checkbox]').check()
            pg.get_by_role('button', name='Submit Selected for Review').click()
            pg.wait_for_timeout(1200)
            check('Submit Selected: one more pending_finance', 5, q("SELECT COUNT(*) FROM dw_entries WHERE status='pending_finance'")[0][0])

            print('— Bad ?status and phone —')
            pg.goto(BASE + '/daily-wage?status=bogus'); pg.wait_for_load_state('networkidle')
            check('?status=bogus → unfiltered', '', pg.locator('select', has_text='All Statuses').input_value())
            check('page errors', [], errs)
            check('console errors', [], cons)
            check('API ≥ 400 = only the intended batch-submit refusal', 1, len(bad))
            check('that one is batch-submit', True, bool(bad) and 'batch-submit' in bad[0])

            pg2, errs2, cons2, bad2, _ = page(390)
            pg2.goto(BASE + '/daily-wage'); pg2.wait_for_load_state('networkidle')
            check('390px: Draft card visible', True, pg2.get_by_test_id('dw-kpi-hr_entered').is_visible())
            check('390px: 0 page errors', [], errs2)
        b.close()
finally:
    srv.terminate(); srv.wait()

print(f'\n{PASS} passed, {FAIL} failed')
sys.exit(1 if FAIL else 0)
