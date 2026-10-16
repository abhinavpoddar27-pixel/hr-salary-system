#!/usr/bin/env python3
"""P6-06 — destructive actions ask first (findings D-6, H-10) — browser check.

Chromium against the BUILT dist, real logins (hr, finance, admin), scratch DATA_DIR, fictional data only
("TEST GANG ALPHA", codes T95xx, names "TEST EMP n" — the repo is public). Server restarted between role batches
(login limiter is 5 / 15 min per IP).

Actions covered:
  A1 DW contractor Deactivate (hr)            A2 DW rate Approve (finance, amber)
  A3 employee document Delete (hr)            A4 outside-grant Remove (admin)
  A5 Leave automation toggle (admin)          E1 Automatic day calculation toggle (admin)
  E2 "There is none" (admin)
For each: dialog text names the object; Cancel / Esc / backdrop send nothing and change nothing in the DB;
Confirm (double click) sends exactly one request with the DB effect; busy (delayed route) disables both buttons and
ignores Esc; a forced 500 keeps the dialog open with one error toast; first focus = Cancel (danger) / Confirm (amber).

Usage:
  PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers PORT=3503 python3 backend/scripts/destructive-confirms-check.py
  APP_ROOT=/tmp/wt-base python3 backend/scripts/destructive-confirms-check.py --base   # old tree: one click sends, no dialog
Needs `npm run build --prefix frontend` in APP_ROOT first.
"""
import datetime, os, re, sqlite3, subprocess, sys, tempfile, time, urllib.request
from playwright.sync_api import sync_playwright

HERE_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
ROOT = os.path.abspath(os.environ.get('APP_ROOT', HERE_ROOT))
BASE_MODE = '--base' in sys.argv
PORT = int(os.environ.get('PORT', '3503')); BASE = f'http://127.0.0.1:{PORT}'
WORK = tempfile.mkdtemp(prefix='p606-'); DB = os.path.join(WORK, 'hr_system.db'); DOCS = os.path.join(WORK, 'docs')
os.makedirs(DOCS, exist_ok=True)
C = 'Asian Lakto Ind Ltd'
YEAR = datetime.date.today().year
PASS = FAIL = 0
PW = {'hr': 'Indriyan@2025', 'finance': 'Finance@2025', 'admin': 'Admin@123'}


def check(label, expected, actual):
    global PASS, FAIL
    if expected == actual: PASS += 1; print(f'  ✓ {label}')
    else: FAIL += 1; print(f'  ✗ {label} — expected {expected!r}, got {actual!r}')


def q(sql, *a):
    c = sqlite3.connect(DB); r = c.execute(sql, a).fetchall(); c.close(); return r


def ex(sql, *a):
    c = sqlite3.connect(DB); cur = c.execute(sql, a); c.commit(); rid = cur.lastrowid; c.close(); return rid


def seed():
    ex("INSERT INTO dw_contractors(contractor_name,current_daily_wage_rate,current_commission_rate,created_by) VALUES('TEST GANG ALPHA',500,50,'hr')")
    ex("INSERT INTO dw_contractors(contractor_name,current_daily_wage_rate,current_commission_rate,created_by) VALUES('TEST GANG BETA',450,40,'hr')")
    cid = q("SELECT id FROM dw_contractors WHERE contractor_name='TEST GANG BETA'")[0][0]
    ex("INSERT INTO dw_rate_history(contractor_id,old_wage_rate,new_wage_rate,old_commission_rate,new_commission_rate,effective_date,proposed_by) "
       "VALUES(?,450,520,40,45,?,'hr')", cid, f'{YEAR}-11-01')
    ex("INSERT OR IGNORE INTO employees(code,name,department,company,status,employment_type,gross_salary) "
       "VALUES('T9501','TEST EMP 1','TEST DEPT',?,'Active','Permanent',20000)", C)
    for i in (1, 2):
        fp = os.path.join(DOCS, f'test_doc_{i}.pdf'); open(fp, 'wb').write(b'%PDF-1.4 test')
        ex("INSERT INTO employee_documents(employee_code,document_type,file_name,file_path,file_size,mime_type,uploaded_by) "
           "VALUES('T9501','Other',?,?,13,'application/pdf','hr')", f'test_doc_{i}.pdf', fp)
    for code, m in (('T9501', 3), ('T9501', 4)):
        ex("INSERT INTO leave_external_grants(employee_code,year,month,leave_type,days,mode,uploaded_by) VALUES(?,?,?,'EL',2,'leave_taken','admin')",
           code, YEAR, m)


env = dict(os.environ, DATA_DIR=WORK, DOCS_DIR=DOCS, JWT_SECRET='x', PORT=str(PORT), NODE_ENV='production',
           ADMIN_PASSWORD=PW['admin'], HR_PASSWORD=PW['hr'], FINANCE_PASSWORD=PW['finance'])
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
srv = None


RUNS = [0]


def start():
    global srv
    RUNS[0] += 1
    srv = subprocess.Popen(['node', f'{ROOT}/backend/server.js'], env=env, stdout=open(f'{WORK}/log', 'a'), stderr=subprocess.STDOUT)
    for _ in range(240):
        try:
            # wait for the full boot (schema + migrations) — /api/version answers before the schema is in
            if opener.open(BASE + '/api/version', timeout=2).status == 200 and open(f'{WORK}/log').read().count('running on') >= RUNS[0]: return
        except Exception: pass
        time.sleep(.5)


def stop():
    srv.terminate(); srv.wait(10)


def login(b, user, path, width=1440):
    ctx = b.new_context(viewport={'width': width, 'height': 900})
    pg = ctx.new_page()
    st = {'errs': [], 'bad': [], 'reqs': []}
    pg.on('pageerror', lambda e: st['errs'].append(str(e)))
    pg.on('request', lambda r: st['reqs'].append(f'{r.method} {r.url}') if '/api/' in r.url and r.method != 'GET' else None)
    pg.on('response', lambda r: st['bad'].append(f'{r.status} {r.url}') if '/api/' in r.url and r.status >= 400
          and not r.url.endswith('/comp-off/pending') and 'session-analytics' not in r.url else None)
    pg.goto(BASE + '/login'); pg.get_by_placeholder('admin').fill(user); pg.get_by_placeholder('••••••••').fill(PW[user])
    pg.get_by_role('button', name='Sign in').click(); pg.wait_for_url(lambda u: '/login' not in u)
    pg.goto(BASE + path); pg.wait_for_load_state('networkidle'); time.sleep(.8)
    return pg, ctx, st


def writes(st, pat):
    return [r for r in st['reqs'] if re.search(pat, r)]


def dialog(pg):
    # the confirm only — on Employees the profile Modal behind it is a role=dialog too
    if BASE_MODE: return pg.get_by_role('dialog').filter(has_text='__never__')
    return pg.get_by_role('dialog').filter(
        has=pg.locator('[data-testid="confirm-deactivate"], [data-testid="confirm-approve-rate"], '
                       '[data-testid="confirm-delete-doc"], [data-testid="leave-auto-confirm"]'))


def wait_dialog(pg):
    dialog(pg).wait_for(timeout=5000); time.sleep(.45)  # ConfirmDialog ignores answers in its first 300 ms? (useConfirm only) — settle anyway


def no_dialog(pg):
    time.sleep(.4); return dialog(pg).count()


def cancel_paths(pg, st, opener_fn, pat, label, db_probe):
    before = db_probe()
    # Cancel button
    opener_fn(); wait_dialog(pg)
    dialog(pg).get_by_role('button', name='Cancel', exact=True).click()
    check(f'{label}: Cancel closes the dialog', 0, no_dialog(pg))
    # Esc
    opener_fn(); wait_dialog(pg); pg.keyboard.press('Escape')
    check(f'{label}: Esc closes the dialog', 0, no_dialog(pg))
    # backdrop
    opener_fn(); wait_dialog(pg); pg.mouse.click(10, 450)
    check(f'{label}: backdrop click closes the dialog', 0, no_dialog(pg))
    check(f'{label}: Cancel / Esc / backdrop sent 0 requests', [], writes(st, pat))
    check(f'{label}: DB unchanged after cancels', before, db_probe())


def busy_and_fail(pg, st, opener_fn, url_glob, confirm_name, label):
    # busy: hold the request (route kept pending, answered later from here — a sleep inside a sync
    # handler would block Playwright and the page would see the answer before the checks run)
    held = []
    pg.route(url_glob, lambda route: held.append(route))
    opener_fn(); wait_dialog(pg)
    dialog(pg).get_by_role('button', name=confirm_name, exact=True).click()
    for _ in range(50):
        if held: break
        pg.wait_for_timeout(100)
    pg.wait_for_timeout(200)
    btns = dialog(pg).get_by_role('button')
    check(f'{label}: busy — every dialog button disabled', True, btns.count() >= 2 and all(btns.nth(i).is_disabled() for i in range(btns.count())))
    pg.keyboard.press('Escape'); pg.wait_for_timeout(300)
    check(f'{label}: busy — Esc ignored (dialog still open)', 1, dialog(pg).count())
    if held: held[0].fulfill(status=500, content_type='application/json', body='{"success":false,"error":"Test failure"}')
    pg.wait_for_timeout(800)
    check(f'{label}: failure keeps the dialog open', 1, dialog(pg).count())
    check(f'{label}: failure shows exactly one error toast', 1, pg.get_by_text('Test failure').count())
    pg.unroute(url_glob)
    dialog(pg).get_by_role('button', name='Cancel', exact=True).click(); pg.wait_for_timeout(300)
    st['bad'][:] = [b for b in st['bad'] if not b.startswith('500 ')]
    st['reqs'].clear()
    pg.wait_for_timeout(4500)  # let the toast expire before the next case


def first_focus(pg, opener_fn, expected_name, label):
    opener_fn(); wait_dialog(pg)
    name = pg.evaluate("document.activeElement && document.activeElement.textContent.trim()")
    check(f'{label}: first focus on "{expected_name}"', expected_name, name)
    pg.keyboard.press('Escape'); no_dialog(pg)


def confirm_once(pg, st, opener_fn, confirm_name, pat, label):
    opener_fn(); wait_dialog(pg)
    dialog(pg).get_by_role('button', name=confirm_name, exact=True).dblclick()
    pg.wait_for_load_state('networkidle'); time.sleep(.8)
    check(f'{label}: Confirm (double click) → exactly 1 request', 1, len(writes(st, pat)))
    check(f'{label}: dialog closes on success', 0, dialog(pg).count())


def base_one_click(pg, st, click_fn, pat, label):
    click_fn(); pg.wait_for_load_state('networkidle'); time.sleep(.8)
    check(f'old: {label} — one click sends the request with no dialog', (1, 0), (len(writes(st, pat)), dialog(pg).count()))


start(); seed()
print(f'App root: {ROOT}  mode: {"BASE (expect one-click writes)" if BASE_MODE else "fix"}')
try:
    with sync_playwright() as p:
        b = p.chromium.launch()

        # ── hr: A1 deactivate + A3 document delete ─────────────────────────
        print('\n— hr: contractor Deactivate (A1) —')
        pg, ctx, st = login(b, 'hr', '/daily-wage/contractors')
        alpha = q("SELECT id FROM dw_contractors WHERE contractor_name='TEST GANG ALPHA'")[0][0]
        pg.get_by_text('TEST GANG ALPHA', exact=True).click(); time.sleep(.6)
        open_deact = lambda: pg.get_by_role('button', name='Deactivate', exact=True).click()
        A1 = r'PUT .*/contractors/\d+/deactivate'
        if BASE_MODE:
            base_one_click(pg, st, open_deact, A1, 'Deactivate')
        else:
            open_deact(); wait_dialog(pg)
            check('A1: dialog title names the contractor', 1, dialog(pg).get_by_text('Deactivate TEST GANG ALPHA?').count())
            check('A1: dialog says what happens + can reactivate', True, 'reactivate' in dialog(pg).get_by_test_id('confirm-deactivate').inner_text())
            pg.keyboard.press('Escape'); no_dialog(pg)
            first_focus(pg, open_deact, 'Cancel', 'A1')
            cancel_paths(pg, st, open_deact, A1, 'A1', lambda: q('SELECT is_active FROM dw_contractors WHERE id=?', alpha))
            busy_and_fail(pg, st, open_deact, '**/contractors/*/deactivate', 'Deactivate', 'A1')
            confirm_once(pg, st, open_deact, 'Deactivate', A1, 'A1')
            check('A1: DB is_active = 0', [(0,)], q('SELECT is_active FROM dw_contractors WHERE id=?', alpha))
            check('A1: Reactivate shown (no dialog)', 1, pg.get_by_role('button', name='Reactivate', exact=True).count())
            check('A1: 0 page errors', [], st['errs']); check('A1: 0 API ≥ 400', [], st['bad'])
        ctx.close()

        print('\n— hr: document Delete (A3) —')
        pg, ctx, st = login(b, 'hr', '/employees')
        pg.get_by_role('button', name='Profile', exact=True).first.click(); time.sleep(.8)
        pg.get_by_role('button', name='Documents', exact=True).click(); time.sleep(.8)
        open_del = lambda: pg.get_by_role('row', name=re.compile('test_doc_1.pdf')).get_by_role('button', name='Delete', exact=True).click()
        A3 = r'DELETE .*/employees/documents/\d+'
        f1 = os.path.join(DOCS, 'test_doc_1.pdf')
        if BASE_MODE:
            base_one_click(pg, st, open_del, A3, 'document Delete')
        else:
            open_del(); wait_dialog(pg)
            check('A3: dialog title names the file', 1, dialog(pg).get_by_text('Delete test_doc_1.pdf?').count())
            txt = dialog(pg).get_by_test_id('confirm-delete-doc').inner_text()
            check('A3: dialog names the employee + says it cannot be undone', True, 'T9501' in txt and 'cannot be undone' in txt)
            check('A3: profile window still open behind the dialog', True, pg.get_by_text('TEST EMP 1').count() >= 1)
            pg.keyboard.press('Escape'); time.sleep(.4)
            check('A3: Esc closes only the confirm, profile stays', True, pg.get_by_role('button', name='Documents', exact=True).count() == 1)
            first_focus(pg, open_del, 'Cancel', 'A3')
            cancel_paths(pg, st, open_del, A3, 'A3', lambda: (q("SELECT COUNT(*) FROM employee_documents"), os.path.exists(f1)))
            check('A3: profile window still open after the cancels', 1, pg.get_by_role('button', name='Documents', exact=True).count())
            busy_and_fail(pg, st, open_del, '**/employees/documents/*', 'Delete document', 'A3')
            confirm_once(pg, st, open_del, 'Delete document', A3, 'A3')
            check('A3: DB row + file gone, the other document kept', ([(1,)], False, True),
                  (q("SELECT COUNT(*) FROM employee_documents"), os.path.exists(f1), os.path.exists(os.path.join(DOCS, 'test_doc_2.pdf'))))
            check('A3: profile window still open after delete', 1, pg.get_by_role('button', name='Documents', exact=True).count())
            check('A3: 0 page errors', [], st['errs']); check('A3: 0 API ≥ 400', [], st['bad'])
        ctx.close()
        stop(); start()

        # ── finance: A2 rate approve ─────────────────────────────────────
        print('\n— finance: rate Approve (A2, amber) —')
        pg, ctx, st = login(b, 'finance', '/daily-wage/contractors')
        pg.get_by_role('button', name=re.compile('^Rate Approvals')).click(); time.sleep(.6)
        open_appr = lambda: pg.get_by_role('button', name='Approve', exact=True).first.click()
        A2 = r'PUT .*/rates/\d+/approve'
        rate = lambda: q("SELECT r.approval_status, c.current_daily_wage_rate, c.current_commission_rate FROM dw_rate_history r JOIN dw_contractors c ON c.id=r.contractor_id")
        if BASE_MODE:
            base_one_click(pg, st, open_appr, A2, 'rate Approve')
        else:
            open_appr(); wait_dialog(pg)
            txt = dialog(pg).get_by_test_id('confirm-approve-rate').inner_text()
            check('A2: title names the contractor', 1, dialog(pg).get_by_text('Approve the rate change for TEST GANG BETA?').count())
            check('A2: old → new wage / commission / total in ₹', True, all(s in txt for s in ('450.00', '520.00', '40.00', '45.00', '490.00', '565.00')))
            check('A2: says new rates apply from today, effective date not used yet', True,
                  'New rates apply from today' in txt and 'recorded but not used yet' in txt and f'01-Nov-{YEAR}' in txt)
            check('A2: Confirm is amber (warning)', True, 'bg-amber-600' in (dialog(pg).get_by_role('button', name='Approve rates').get_attribute('class') or ''))
            pg.keyboard.press('Escape'); no_dialog(pg)
            first_focus(pg, open_appr, 'Approve rates', 'A2')
            cancel_paths(pg, st, open_appr, A2, 'A2', rate)
            busy_and_fail(pg, st, open_appr, '**/rates/*/approve', 'Approve rates', 'A2')
            confirm_once(pg, st, open_appr, 'Approve rates', A2, 'A2')
            check('A2: DB approved + new rates on the contractor', [('approved', 520.0, 45.0)], rate())
            check('A2: 0 page errors', [], st['errs']); check('A2: 0 API ≥ 400', [], st['bad'])
        ctx.close()
        stop(); start()

        # ── admin: A4, A5, E1, E2 ─────────────────────────────────────────
        print('\n— admin: Leave Automation tab (A4, A5, E1, E2) —')
        pg, ctx, st = login(b, 'admin', '/leave-management')
        pg.get_by_role('button', name='Automation', exact=True).click(); pg.wait_for_load_state('networkidle'); time.sleep(1)
        auto_cb = lambda: pg.locator('label', has_text='Leave automation').locator('input[type=checkbox]')
        st6_cb = lambda: pg.locator('label', has_text='Automatic day calculation').locator('input[type=checkbox]')
        pol = lambda k: q('SELECT value FROM policy_config WHERE key=?', k)
        SET = r'POST .*/leave-automation/settings'
        if BASE_MODE:
            base_one_click(pg, st, lambda: auto_cb().click(), SET, 'Leave automation toggle')
        else:
            # A5 automation ON
            open_a5 = lambda: auto_cb().click()
            open_a5(); wait_dialog(pg)
            check('A5: title "Turn leave automation on?"', 1, dialog(pg).get_by_text('Turn leave automation on?').count())
            pg.keyboard.press('Escape'); no_dialog(pg)
            check('A5: checkbox still OFF after Esc', False, auto_cb().is_checked())
            first_focus(pg, open_a5, 'Cancel', 'A5')
            cancel_paths(pg, st, open_a5, SET, 'A5', lambda: pol('leave_automation_enabled'))
            busy_and_fail(pg, st, open_a5, '**/leave-automation/settings', 'Turn on', 'A5')
            check('A5: checkbox still OFF after the failure', False, auto_cb().is_checked())
            confirm_once(pg, st, open_a5, 'Turn on', SET, 'A5')
            check('A5: DB leave_automation_enabled = true', [('true',)], pol('leave_automation_enabled'))
            time.sleep(.6); check('A5: checkbox now ON', True, auto_cb().is_checked())
            st['reqs'].clear()
            auto_cb().click(); wait_dialog(pg)
            check('A5: turning off asks "Turn leave automation off?"', 1, dialog(pg).get_by_text('Turn leave automation off?').count())
            dialog(pg).get_by_role('button', name='Turn off', exact=True).click(); pg.wait_for_load_state('networkidle'); time.sleep(.6)
            check('A5: off → DB false, 1 request', ([('false',)], 1), (pol('leave_automation_enabled'), len(writes(st, SET))))
            st['reqs'].clear()
            # E1 auto day calc (default ON) → OFF
            open_e1 = lambda: st6_cb().click()
            open_e1(); wait_dialog(pg)
            check('E1: title "Turn automatic day calculation off?"', 1, dialog(pg).get_by_text('Turn automatic day calculation off?').count())
            pg.keyboard.press('Escape'); no_dialog(pg)
            cancel_paths(pg, st, open_e1, SET, 'E1', lambda: pol('leave_auto_stage6_enabled'))
            confirm_once(pg, st, open_e1, 'Turn off', SET, 'E1')
            check('E1: DB leave_auto_stage6_enabled = false', [('false',)], pol('leave_auto_stage6_enabled'))
            st['reqs'].clear()
            time.sleep(4)

            # A4 remove grant
            GR = r'DELETE .*/leave-external-grants/\d+'
            open_a4 = lambda: pg.locator('tr', has_text=f'3/{YEAR}').filter(has_text='T9501').get_by_role('button', name='Remove', exact=True).click()
            open_a4(); wait_dialog(pg)
            txt = dialog(pg).get_by_test_id('leave-auto-confirm').inner_text()
            check('A4: dialog names code · type · days · month', True, all(s in txt for s in ('T9501', 'EL', '2 day(s)', f'3/{YEAR}', 'leave taken')))
            check('A4: says it cannot be undone + no re-upload', True, 'cannot be undone' in txt and 'cannot be uploaded again' in txt)
            pg.keyboard.press('Escape'); no_dialog(pg)
            first_focus(pg, open_a4, 'Cancel', 'A4')
            active = lambda: q('SELECT month, is_active FROM leave_external_grants ORDER BY month')
            cancel_paths(pg, st, open_a4, GR, 'A4', active)
            busy_and_fail(pg, st, open_a4, '**/leave-external-grants/*', 'Remove grant', 'A4')
            confirm_once(pg, st, open_a4, 'Remove grant', GR, 'A4')
            check('A4: only the March grant soft-deleted', [(3, 0), (4, 1)], active())
            st['reqs'].clear()

            # E2 "There is none": remove the last grant so the link shows
            pg.locator('tr', has_text=f'4/{YEAR}').filter(has_text='T9501').get_by_role('button', name='Remove', exact=True).click(); wait_dialog(pg)
            dialog(pg).get_by_role('button', name='Remove grant', exact=True).click(); pg.wait_for_load_state('networkidle'); time.sleep(1)
            st['reqs'].clear()
            ACK = r'POST .*/acknowledge-none'
            open_e2 = lambda: pg.get_by_role('button', name='There is none', exact=True).click()
            open_e2(); wait_dialog(pg)
            check('E2: title asks to record "none" (the flag is not per year)', 1, dialog(pg).get_by_text('Record that no leave was given outside the system?').count())
            pg.keyboard.press('Escape'); no_dialog(pg)
            cancel_paths(pg, st, open_e2, ACK, 'E2', lambda: pol('leave_external_grants_acknowledged'))
            confirm_once(pg, st, open_e2, 'Record "none"', ACK, 'E2')
            check('E2: DB acknowledged = true', [('true',)], pol('leave_external_grants_acknowledged'))
            check('admin: 0 page errors', [], st['errs']); check('admin: 0 API ≥ 400', [], st['bad'])
        ctx.close()

        if not BASE_MODE:
            print('\n— admin, phone 390 px —')
            pg, ctx, st = login(b, 'admin', '/leave-management', width=390)
            pg.get_by_role('button', name='Automation', exact=True).click(); pg.wait_for_load_state('networkidle'); time.sleep(1)
            st6_cb().click(); wait_dialog(pg)
            box = dialog(pg).locator('h3').bounding_box()
            check('390px: dialog opens and fits the width', True, box is not None and box['x'] >= 0 and box['x'] + box['width'] <= 390)
            check('390px: no sideways page scroll', True, pg.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1'))
            pg.keyboard.press('Escape'); no_dialog(pg)
            check('390px: 0 page errors', [], st['errs'])
            ctx.close()
        b.close()
finally:
    stop()
print(f'\n{PASS} passed, {FAIL} failed')
sys.exit(1 if FAIL else 0)
