#!/usr/bin/env python3
"""G3 — employee document delete is a soft delete with an audit row — browser check.

Chromium against the BUILT dist, real logins (hr, finance), scratch DATA_DIR + DOCS_DIR, fictional data only
(code T9561, "TEST DOC EMP"). Server restarted between roles (login limiter 5 / 15 min per IP).

  hr: confirm text says the file is kept · Delete → toast "Document removed", row gone from the list, the other
      document still listed · DB row kept with deleted_at + deleted_by='hr' · file still on disk · exactly one
      audit_log row (document_delete) · download of the removed id → 404, of the live one → 200 · upload through the
      page → one document_upload audit row · reopen the profile: removed row still hidden · 390 px · 0 page errors.
  finance: removed row not listed, download 404.

Usage:
  PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers PORT=3505 python3 backend/scripts/doc-delete-audit-check.py
  APP_ROOT=/tmp/wt-base python3 backend/scripts/doc-delete-audit-check.py --base   # old tree: row + file gone, no audit
Needs `npm run build --prefix frontend` in APP_ROOT first.
"""
import json, os, re, sqlite3, subprocess, sys, tempfile, time, urllib.request
from playwright.sync_api import sync_playwright

HERE_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
ROOT = os.path.abspath(os.environ.get('APP_ROOT', HERE_ROOT))
BASE_MODE = '--base' in sys.argv
PORT = int(os.environ.get('PORT', '3505')); BASE = f'http://127.0.0.1:{PORT}'
WORK = tempfile.mkdtemp(prefix='g3-'); DB = os.path.join(WORK, 'hr_system.db'); DOCS = os.path.join(WORK, 'docs')
os.makedirs(DOCS, exist_ok=True)
PW = {'hr': 'Indriyan@2025', 'finance': 'Finance@2025', 'admin': 'Admin@123'}
PASS = FAIL = 0


def check(label, expected, actual):
    global PASS, FAIL
    if expected == actual: PASS += 1; print(f'  ✓ {label}')
    else: FAIL += 1; print(f'  ✗ {label} — expected {expected!r}, got {actual!r}')


def q(sql, *a):
    c = sqlite3.connect(DB); r = c.execute(sql, a).fetchall(); c.close(); return r


def ex(sql, *a):
    c = sqlite3.connect(DB); cur = c.execute(sql, a); c.commit(); rid = cur.lastrowid; c.close(); return rid


env = dict(os.environ, DATA_DIR=WORK, DOCS_DIR=DOCS, JWT_SECRET='x', PORT=str(PORT), NODE_ENV='production',
           ADMIN_PASSWORD=PW['admin'], HR_PASSWORD=PW['hr'], FINANCE_PASSWORD=PW['finance'])
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
srv = None; RUNS = [0]


def start():
    global srv
    RUNS[0] += 1
    srv = subprocess.Popen(['node', f'{ROOT}/backend/server.js'], env=env, stdout=open(f'{WORK}/log', 'a'), stderr=subprocess.STDOUT)
    for _ in range(240):
        try:
            if opener.open(BASE + '/api/version', timeout=2).status == 200 and open(f'{WORK}/log').read().count('running on') >= RUNS[0]: return
        except Exception: pass
        time.sleep(.5)


def stop():
    srv.terminate(); srv.wait(10)


def login(b, user, width=1440):
    ctx = b.new_context(viewport={'width': width, 'height': 900})
    pg = ctx.new_page()
    st = {'errs': [], 'bad': [], 'reqs': []}
    pg.on('pageerror', lambda e: st['errs'].append(str(e)))
    pg.on('request', lambda r: st['reqs'].append(f'{r.method} {r.url}') if '/api/' in r.url and r.method != 'GET' else None)
    pg.on('response', lambda r: st['bad'].append(f'{r.status} {r.url}') if '/api/' in r.url and r.status >= 400
          and not r.url.endswith('/comp-off/pending') and 'session-analytics' not in r.url else None)
    pg.goto(BASE + '/login'); pg.get_by_placeholder('admin').fill(user); pg.get_by_placeholder('••••••••').fill(PW[user])
    pg.get_by_role('button', name='Sign in').click(); pg.wait_for_url(lambda u: '/login' not in u)
    pg.goto(BASE + '/employees'); pg.wait_for_load_state('networkidle'); time.sleep(.8)
    return pg, ctx, st


def open_docs(pg):
    pg.get_by_role('row', name=re.compile('T9561')).get_by_role('button', name='Profile', exact=True).click(); time.sleep(.8)
    pg.get_by_role('button', name='Documents', exact=True).click(); pg.wait_for_load_state('networkidle'); time.sleep(.8)


def api_status(pg, path):
    tok = pg.evaluate("localStorage.getItem('hr_token')")
    r = pg.request.get(BASE + path, headers={'Authorization': f'Bearer {tok}', 'Cache-Control': 'no-cache'})
    return r.status


def row_count(pg, name):
    return pg.get_by_role('row', name=re.compile(re.escape(name))).count()


start()
ex("INSERT OR IGNORE INTO employees(code,name,department,company,status,employment_type,gross_salary) "
   "VALUES('T9561','TEST DOC EMP','TEST DEPT','Asian Lakto Ind Ltd','Active','Permanent',20000)")
ids = {}
for n in ('test_g3_a.pdf', 'test_g3_b.pdf'):
    fp = os.path.join(DOCS, n); open(fp, 'wb').write(b'%PDF-1.4 g3')
    ids[n] = ex("INSERT INTO employee_documents(employee_code,document_type,file_name,file_path,file_size,mime_type,uploaded_by) "
                "VALUES('T9561','Other',?,?,11,'application/pdf','hr')", n, fp)
fa = os.path.join(DOCS, 'test_g3_a.pdf')
print(f'App root: {ROOT}  mode: {"BASE (expect hard delete, no audit)" if BASE_MODE else "fix"}')
try:
    with sync_playwright() as p:
        b = p.chromium.launch()
        print('\n— hr: remove a document —')
        pg, ctx, st = login(b, 'hr')
        open_docs(pg)
        check('both documents listed before', (1, 1), (row_count(pg, 'test_g3_a.pdf'), row_count(pg, 'test_g3_b.pdf')))
        pg.get_by_role('row', name=re.compile('test_g3_a.pdf')).get_by_role('button', name='Delete', exact=True).click()
        dlg = pg.get_by_role('dialog').filter(has=pg.locator('[data-testid="confirm-delete-doc"]'))
        dlg.wait_for(timeout=5000); time.sleep(.45)
        txt = dlg.get_by_test_id('confirm-delete-doc').inner_text()
        if not BASE_MODE:
            check('confirm says the file stays and who removed it is recorded', True,
                  'file stays on the server' in txt and 'record of who removed it' in txt and 'cannot be undone' not in txt)
        dlg.get_by_role('button', name='Delete document', exact=True).click()
        pg.wait_for_load_state('networkidle'); time.sleep(1)
        check('exactly 1 DELETE request', 1, len([r for r in st['reqs'] if re.search(r'DELETE .*/employees/documents/\d+', r)]))
        check('removed row gone from the list, the other still listed', (0, 1), (row_count(pg, 'test_g3_a.pdf'), row_count(pg, 'test_g3_b.pdf')))
        db_row = q("SELECT COUNT(*) FROM employee_documents WHERE id=?", ids['test_g3_a.pdf'])[0][0]
        audit = q("SELECT COUNT(*) FROM audit_log WHERE table_name='employee_documents' AND action_type='document_delete'")[0][0] \
            if q("SELECT name FROM sqlite_master WHERE name='audit_log'") else 0
        if BASE_MODE:
            check('old: row hard-deleted, file gone, no audit row', (0, False, 0), (db_row, os.path.exists(fa), audit))
        else:
            check('toast says "Document removed"', 1, pg.get_by_text('Document removed').count())
            check('DB row kept, deleted_by hr, deleted_at set',
                  [(1, 'hr', 1)], q("SELECT COUNT(*), deleted_by, deleted_at IS NOT NULL FROM employee_documents WHERE id=?", ids['test_g3_a.pdf']))
            check('file still on disk', True, os.path.exists(fa))
            a = q("SELECT changed_by, employee_code, field_name, remark FROM audit_log WHERE table_name='employee_documents' "
                  "AND action_type='document_delete' AND record_id=?", ids['test_g3_a.pdf'])
            check('exactly one document_delete audit row (hr, T9561, deleted_at)', [('hr', 'T9561', 'deleted_at')], [r[:3] for r in a])
            check('audit remark names the file and says it is kept', True, bool(a) and 'test_g3_a.pdf' in a[0][3] and 'file kept' in a[0][3])
            check('download of removed id → 404', 404, api_status(pg, f'/api/employees/documents/{ids["test_g3_a.pdf"]}/download'))
            check('download of the live id → 200', 200, api_status(pg, f'/api/employees/documents/{ids["test_g3_b.pdf"]}/download'))
            # upload through the page
            up = os.path.join(WORK, 'test_g3_up.pdf'); open(up, 'wb').write(b'%PDF-1.4 up')
            st['reqs'].clear()
            pg.locator('input[type="file"]').first.set_input_files(up)
            upload_btn = pg.get_by_role('button', name=re.compile('^Upload'))
            if upload_btn.count(): upload_btn.first.click()
            pg.wait_for_load_state('networkidle'); time.sleep(1.2)
            check('upload → listed', 1, row_count(pg, 'test_g3_up.pdf'))
            check('upload → one document_upload audit row by hr', [('hr', 'T9561')],
                  q("SELECT changed_by, employee_code FROM audit_log WHERE table_name='employee_documents' AND action_type='document_upload'"))
            # reopen
            pg.goto(BASE + '/employees'); pg.wait_for_load_state('networkidle'); time.sleep(.8); open_docs(pg)
            check('reopened profile: removed row still hidden', (0, 1, 1),
                  (row_count(pg, 'test_g3_a.pdf'), row_count(pg, 'test_g3_b.pdf'), row_count(pg, 'test_g3_up.pdf')))
            check('hr: 0 page errors', [], st['errs']); check('hr: 0 API ≥ 400', [], st['bad'])
        ctx.close()

        if not BASE_MODE:
            print('\n— hr, phone 390 px —')
            pg, ctx, st = login(b, 'hr', width=390)
            open_docs(pg)
            pg.get_by_role('row', name=re.compile('test_g3_b.pdf')).get_by_role('button', name='Delete', exact=True).click()
            dlg = pg.get_by_role('dialog').filter(has=pg.locator('[data-testid="confirm-delete-doc"]'))
            dlg.wait_for(timeout=5000); time.sleep(.45)
            box = dlg.locator('h3').bounding_box()
            check('390px: confirm fits the width', True, box is not None and box['x'] >= 0 and box['x'] + box['width'] <= 390)
            pg.keyboard.press('Escape'); time.sleep(.4)
            check('390px: Esc sends nothing, row still live', (0, [(None,)]),
                  (len([r for r in st['reqs'] if 'DELETE' in r]), q("SELECT deleted_at FROM employee_documents WHERE id=?", ids['test_g3_b.pdf'])))
            check('390px: 0 page errors', [], st['errs'])
            ctx.close()
            stop(); start()

            print('\n— finance: read only —')
            pg, ctx, st = login(b, 'finance')
            open_docs(pg)
            check('finance: removed row not listed, live one listed', (0, 1), (row_count(pg, 'test_g3_a.pdf'), row_count(pg, 'test_g3_b.pdf')))
            check('finance: download of removed id → 404', 404, api_status(pg, f'/api/employees/documents/{ids["test_g3_a.pdf"]}/download'))
            check('finance: 0 page errors', [], st['errs'])
            ctx.close()
        b.close()
finally:
    stop()
print(f'\n{PASS} passed, {FAIL} failed')
sys.exit(1 if FAIL else 0)
