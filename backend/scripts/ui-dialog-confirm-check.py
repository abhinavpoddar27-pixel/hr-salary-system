#!/usr/bin/env python3
"""P2-01 — Modal / ConfirmDialog on headlessui Dialog + useConfirm — browser check.

Chromium against the BUILT dist, real admin / hr / finance logins, scratch DATA_DIR, fictional data only
(codes T96xx, names "TEST EMP n" — the repo is public).

Fix mode (default):
  * The 8 migrated native dialogs (Settings holiday Remove, Comp-off Cancel, Gate pass Cancel, Early-exit
    Approve, Reports ECR "download without them", SqlConsole restore prompt + 2 alerts):
      opens with its text · first focus (Cancel on red confirms, Confirm otherwise) · Esc / Cancel / backdrop
      send NOTHING · OK sends the same request as before + DB effect · no native dialog ever fires.
  * Six existing <Modal> callers on different pages open and close (✕, Esc, backdrop); Tab / Shift-Tab stay
    inside; focus returns to the opener.
  * 390px: dialogs fit the screen.
  * 0 page errors, 0 console errors, 0 unexpected API >= 400.
Base mode (--base, APP_ROOT=<origin/main tree>): native confirm fires; Tab escapes the old Modal.

Usage:
  PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers python3 backend/scripts/ui-dialog-confirm-check.py
  APP_ROOT=/path/to/main-tree python3 backend/scripts/ui-dialog-confirm-check.py --base
Needs `npm run build --prefix frontend` in APP_ROOT first.
"""
import datetime, json, os, re, sqlite3, subprocess, sys, tempfile, time, urllib.request
from playwright.sync_api import sync_playwright

HERE_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
ROOT = os.path.abspath(os.environ.get('APP_ROOT', HERE_ROOT))
BASE_MODE = '--base' in sys.argv
PORT = int(os.environ.get('PORT', '3201')); BASE = f'http://127.0.0.1:{PORT}'
WORK = tempfile.mkdtemp(prefix='p2-01-'); DB = os.path.join(WORK, 'hr_system.db')
C = 'Asian Lakto Ind Ltd'
TODAY = datetime.date.today(); M, Y = TODAY.month, TODAY.year
PW = {'admin': 'Admin@123', 'hr': 'Indriyan@2025', 'finance': 'Finance@2025'}
PASS = FAIL = 0
ALLOWED_BAD = []   # substrings of API >= 400 responses that a test triggers on purpose


def check(label, expected, actual):
    global PASS, FAIL
    if expected == actual: PASS += 1; print(f'  ✓ {label}')
    else: FAIL += 1; print(f'  ✗ {label} — expected {expected!r}, got {actual!r}')


def d(day): return f'{Y}-{M:02d}-{day:02d}'


def q(sql, args=()):
    c = sqlite3.connect(DB); r = c.execute(sql, args).fetchall(); c.close(); return r


def seed():
    c = sqlite3.connect(DB)
    for i, (code, uan) in enumerate((('T9601', None), ('T9602', '100000000002'), ('T9603', None), ('T9604', None)), 1):
        c.execute("INSERT OR IGNORE INTO employees(code,name,department,company,status,employment_type,gross_salary,uan) "
                  "VALUES(?,?,'TEST DEPT',?,'Active','Permanent',30000,?)", (code, f'TEST EMP {i}', C, uan))
    for code in ('T9601', 'T9602'):
        c.execute("INSERT INTO salary_computations(employee_code,month,year,company,payable_days,gross_salary,basic_earned,"
                  "gross_earned,pf_wages,pf_employee,pf_employer,total_deductions,net_salary) "
                  "VALUES(?,?,?,?,26,30000,15000,30000,15000,1800,1800,1800,28200)", (code, M, Y, C))
    c.execute("INSERT INTO holidays(date,name,type) VALUES(?, 'TEST HOLIDAY P2', 'Festival')", (f'{Y}-12-30',))
    c.execute("INSERT INTO compensatory_off_requests(employee_code,start_date,end_date,days,month,year,company,reason,"
              "hr_remark,applied_by) VALUES('T9601',?,?,1,?,?,?,'Test reason','Test remark','hr')", (d(5), d(5), M, Y, C))
    c.execute("INSERT INTO short_leaves(employee_code,employee_name,company,date,leave_type,duration_hours,remark,"
              "calendar_month,calendar_year,created_by_name) VALUES('T9601','TEST EMP 1',?,?,'short_leave',2,"
              "'Test gate pass',?,?,'hr')", (C, d(28), M, Y))
    cur = c.execute("INSERT INTO early_exit_detections(employee_code,date,company) VALUES('T9602',?,?)", (d(3), C))
    c.execute("INSERT INTO early_exit_deductions(early_exit_detection_id,employee_code,employee_name,company,date,"
              "deduction_type,deduction_amount,payroll_month,payroll_year,hr_remark,submitted_by_name) "
              "VALUES(?,'T9602','TEST EMP 2',?,?,'half_day',500,?,?,'Test early exit','hr')", (cur.lastrowid, C, d(3), M, Y))
    c.execute("INSERT INTO early_exit_detections(employee_code,date,company) VALUES('T9603',?,?)", (d(4), C))
    cur = c.execute("SELECT id FROM early_exit_detections WHERE employee_code='T9603'").fetchone()
    c.execute("INSERT INTO early_exit_deductions(early_exit_detection_id,employee_code,employee_name,company,date,"
              "deduction_type,deduction_amount,payroll_month,payroll_year,hr_remark,submitted_by_name) "
              "VALUES(?,'T9603','TEST EMP 3',?,?,'half_day',400,?,?,'Test early exit two','hr')", (cur[0], C, d(4), M, Y))
    c.commit(); c.close()


def api(method, path, body=None, token=None):
    req = urllib.request.Request(BASE + path, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={'Content-Type': 'application/json', **({'Authorization': f'Bearer {token}'} if token else {})})
    try:
        with urllib.request.urlopen(req, timeout=20) as r: return r.status, json.loads(r.read() or b'{}')
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b'{}')


class Page:
    def __init__(self, b, user, width=1440):
        self.ctx = b.new_context(viewport={'width': width, 'height': 900}, accept_downloads=True)
        self.pg = pg = self.ctx.new_page()
        self.errs, self.cons, self.bad, self.reqs, self.native = [], [], [], [], []
        pg.on('pageerror', lambda e: self.errs.append(str(e)))
        pg.on('console', lambda m: self.cons.append(m.text) if m.type == 'error' and 'vite.svg' not in m.text
              and 'Failed to load resource' not in m.text else None)
        pg.on('response', lambda r: self.bad.append(f'{r.status} {r.request.method} {r.url}')
              if '/api/' in r.url and r.status >= 400 else None)
        pg.on('request', lambda r: self.reqs.append((r.method, r.url, r.post_data)) if '/api/' in r.url else None)
        pg.on('dialog', lambda dl: (self.native.append(dl.message), dl.dismiss()))
        pg.goto(BASE + '/login'); pg.get_by_placeholder('admin').fill(user); pg.get_by_placeholder('••••••••').fill(PW[user])
        pg.get_by_role('button', name='Sign in').click(); pg.wait_for_url(lambda u: '/login' not in u)
        self.user = user

    def count(self, method, pattern):
        return sum(1 for m, u, _ in self.reqs if m == method and re.search(pattern, u))

    def bodies(self, method, pattern):
        return [b for m, u, b in self.reqs if m == method and re.search(pattern, u)]

    def dialog(self, title):
        return self.pg.locator('[role="dialog"]', has=self.pg.locator('h3', has_text=title))

    def active_text(self):
        return self.pg.evaluate('() => (document.activeElement && (document.activeElement.innerText || document.activeElement.getAttribute("aria-label") || document.activeElement.tagName) || "").trim()')

    def focus_inside(self, title):
        return self.pg.evaluate("""(t) => { const ds = [...document.querySelectorAll('[role="dialog"]')]
            .filter(x => [...x.querySelectorAll('h3')].some(h => h.textContent.includes(t)));
            return ds.length > 0 && ds[0].contains(document.activeElement) }""", title)

    def finish(self):
        bad = [x for x in self.bad if not any(a in x for a in ALLOWED_BAD)]
        check(f'{self.user}: 0 page errors', [], self.errs)
        check(f'{self.user}: 0 console errors', [], [c for c in self.cons if not any(a in c for a in ('403', '404', '409', '400'))] )
        check(f'{self.user}: 0 unexpected API >= 400', [], bad)
        check(f'{self.user}: no native dialog fired', [], self.native)
        self.ctx.close()


def close_drawer(pg):
    try: bb = pg.get_by_text('Leave Management', exact=True).first.bounding_box(timeout=3000)
    except Exception: bb = None
    if bb and bb['x'] >= 0 and bb['x'] < 300:
        pg.mouse.click(370, 420); time.sleep(.5)


def click_backdrop(p):
    p.pg.mouse.click(4, 890)


def confirm_cycle(p, label, opener, title, text, cancel_name, ok_name, method, url_pat, first_focus):
    """opener: callable returning a locator for the trigger (re-evaluated each time)."""
    pg = p.pg
    for how in ('Esc', 'Cancel', 'backdrop'):
        opener().click()
        dlg = p.dialog(title); dlg.wait_for(timeout=8000); time.sleep(.3)
        if how == 'Esc':
            check(f'{label}: dialog text', True, text in dlg.inner_text())
            check(f'{label}: first focus on {first_focus}', first_focus, p.active_text())
            for _ in range(8): pg.keyboard.press('Tab')
            check(f'{label}: Tab stays inside (8 presses)', True, p.focus_inside(title))
            for _ in range(3): pg.keyboard.press('Shift+Tab')
            check(f'{label}: Shift+Tab stays inside', True, p.focus_inside(title))
            pg.keyboard.press('Escape')
        elif how == 'Cancel':
            dlg.get_by_role('button', name=cancel_name, exact=True).click()
        else:
            click_backdrop(p)
        dlg.wait_for(state='detached', timeout=5000)
        time.sleep(.4)
        check(f'{label}: {how} → closed, 0 {method} requests', 0, p.count(method, url_pat))
    opener().click()
    dlg = p.dialog(title); dlg.wait_for(timeout=8000); time.sleep(.4)
    dlg.get_by_role('button', name=ok_name, exact=True).click()
    dlg.wait_for(state='detached', timeout=5000)
    for _ in range(40):
        if p.count(method, url_pat): break
        time.sleep(.2)
    check(f'{label}: OK → exactly 1 {method} request', 1, p.count(method, url_pat))


def modal_cycle(p, label, opener, title):
    """Existing <Modal> caller: opens; Tab trap; ✕ / Esc / backdrop close; focus returns."""
    pg = p.pg
    for how in ('x', 'Esc', 'backdrop'):
        opener().click()
        dlg = p.dialog(title); dlg.wait_for(timeout=10000); time.sleep(.3)
        if how == 'x':
            check(f'{label}: opens', True, dlg.is_visible())
            for _ in range(15): pg.keyboard.press('Tab')
            fi = p.focus_inside(title)
            if not fi: print('    active:', pg.evaluate('() => document.activeElement.outerHTML.slice(0, 200)'))
            check(f'{label}: Tab ×15 stays inside', True, fi)
            dlg.get_by_role('button', name='Close', exact=True).first.click()
        elif how == 'Esc':
            pg.keyboard.press('Escape')
        else:
            click_backdrop(p)
        dlg.wait_for(state='detached', timeout=5000)
        check(f'{label}: {how} closes', 0, p.dialog(title).count())
        if how == 'Esc':
            check(f'{label}: focus back on the opener', True,
                  opener().evaluate('el => el === document.activeElement'))


def run_fix(b):
    # ── 1. Settings → Holidays → Remove (admin) ────────────────────────────────
    print('\n— admin: Settings holiday Remove —')
    p = Page(b, 'admin')
    p.pg.goto(BASE + '/settings/holidays'); p.pg.wait_for_load_state('networkidle')
    row = lambda: p.pg.locator('tr', has_text='TEST HOLIDAY P2').get_by_role('button', name='Remove')
    row().wait_for(timeout=10000)
    confirm_cycle(p, 'holiday', row, 'Remove holiday?', 'Remove this holiday?', 'Keep', 'Remove',
                  'DELETE', r'/api/settings/holidays/\d+', 'Keep')
    time.sleep(.8)
    check('holiday: soft-deleted in DB (is_active 0, as before)', [(0,)], q("SELECT is_active FROM holidays WHERE name='TEST HOLIDAY P2'"))
    pa = p   # admin page is reused for the SQL Console section at the end (login limiter: 5 per window)

    # ── 3. Leave Management (hr): Comp-off Cancel + Gate pass Cancel + modals ──
    print('\n— hr: Leave Management —')
    p = Page(b, 'hr'); pg = p.pg
    pg.goto(BASE + '/leave-management'); pg.wait_for_load_state('networkidle')
    modal_cycle(p, 'Apply Leave modal', lambda: pg.get_by_role('button', name='+ Apply Leave'), 'Apply for Leave')
    pg.get_by_role('button', name='Comp Off / OD').first.click(); pg.wait_for_load_state('networkidle')
    cbtn = lambda: pg.locator('tr', has_text='TEST EMP 1').get_by_role('button', name='Cancel', exact=True)
    cbtn().wait_for(timeout=10000)
    confirm_cycle(p, 'comp-off', cbtn, 'Cancel comp-off request?', 'Cancel this pending comp-off request?', 'Keep',
                  'Cancel request', 'DELETE', r'/api/comp-off/\d+', 'Keep')
    time.sleep(.8)
    check('comp-off: row deleted in DB', 0, len(q("SELECT 1 FROM compensatory_off_requests WHERE employee_code='T9601'")))
    pg.get_by_role('button', name='Gate Passes').first.click(); pg.wait_for_load_state('networkidle')
    modal_cycle(p, 'Create Gate Pass modal', lambda: pg.get_by_role('button', name='+ New Gate Pass'), 'Create Gate Pass')
    gbtn = lambda: pg.locator('tr', has_text='Test gate pass').get_by_role('button', name='Cancel', exact=True)
    gbtn().wait_for(timeout=10000)
    confirm_cycle(p, 'gate pass', gbtn, 'Cancel gate pass?', 'Cancel this gate pass?', 'Keep', 'Cancel gate pass',
                  'PUT', r'/api/short-leaves/\d+/cancel', 'Keep')
    check('gate pass: same body as before', {'cancel_reason': 'Cancelled by HR'},
          json.loads(p.bodies('PUT', r'/api/short-leaves/\d+/cancel')[0]))
    time.sleep(.8)
    check('gate pass: cancelled in DB', 1, len(q("SELECT 1 FROM short_leaves WHERE employee_code='T9601' AND cancelled_at IS NOT NULL")))

    # Reports ECR — hr
    print('\n— hr: Reports PF ECR —')
    pg.goto(BASE + '/reports'); pg.wait_for_load_state('networkidle')
    pg.get_by_role('button', name=re.compile('^PF ECR File')).click(); pg.wait_for_load_state('networkidle')
    dl = lambda: pg.get_by_role('button', name='Download ECR (.txt)')
    pg.get_by_text('NOT in the file').first.wait_for(timeout=10000)
    ECR = r'/api/reports/pf-ecr\?.*download=true'
    confirm_cycle_noo = None
    for how in ('Esc', 'Cancel', 'backdrop'):
        dl().click(); dlg = p.dialog('Download without these employees?'); dlg.wait_for(timeout=8000); time.sleep(.4)
        if how == 'Esc':
            txt = dlg.inner_text()
            check('ECR: lists the missing code', True, 'T9601' in txt and 'NOT in this file' in txt)
            check('ECR: keeps line breaks (3+ lines)', True, txt.count('\n') >= 3)
            check('ECR: first focus on Cancel', 'Cancel', p.active_text())
            pg.keyboard.press('Escape')
        elif how == 'Cancel': dlg.get_by_role('button', name='Cancel', exact=True).click()
        else: click_backdrop(p)
        dlg.wait_for(state='detached'); time.sleep(.4)
        check(f'ECR: {how} → 0 download requests', 0, p.count('GET', ECR))
    dl().click(); dlg = p.dialog('Download without these employees?'); dlg.wait_for(); time.sleep(.4)
    with pg.expect_download(timeout=15000) as dli:
        dlg.get_by_role('button', name='Download without them', exact=True).click()
    check('ECR: OK → file downloaded', True, dli.value.suggested_filename.endswith('.txt'))
    check('ECR: OK → exactly 1 download request', 1, p.count('GET', ECR))
    ph = p

    # ── 4. Finance Audit → Early Exit (finance): Approve + Reject modal ─────────
    print('\n— finance: Early Exit approvals —')
    p = Page(b, 'finance'); pg = p.pg
    pg.goto(BASE + '/finance-audit'); pg.wait_for_load_state('networkidle')
    pg.get_by_role('button', name=re.compile('^Early Exit')).first.click(); pg.wait_for_load_state('networkidle')
    abtn = lambda: pg.locator('tr', has_text='TEST EMP 2').get_by_role('button', name='Approve', exact=True)
    abtn().wait_for(timeout=10000)
    modal_cycle(p, 'Reject Early Exit modal',
                lambda: pg.locator('tr', has_text='TEST EMP 3').get_by_role('button', name='Reject', exact=True),
                'Reject Early Exit Deduction')
    confirm_cycle(p, 'early-exit approve', abtn, 'Approve deduction?', 'Approve this deduction?', 'Cancel', 'Approve',
                  'PUT', r'/api/early-exit-deductions/\d+/approve', 'Approve')
    time.sleep(.8)
    check('early-exit: approved in DB', [('approved',)], q("SELECT finance_status FROM early_exit_deductions WHERE employee_code='T9602'"))
    check('early-exit: other row untouched', [('pending',)], q("SELECT finance_status FROM early_exit_deductions WHERE employee_code='T9603'"))
    p.finish()

    # ── 5. More existing <Modal> callers (hr) ───────────────────────────────────
    print('\n— hr: more Modal callers —')
    p = ph; pg = p.pg
    pg.goto(BASE + '/employees'); pg.wait_for_load_state('networkidle')
    erow = lambda: pg.locator('tr', has_text='TEST EMP 1').get_by_role('button', name='Profile', exact=True).first
    erow().wait_for(timeout=10000)
    modal_cycle(p, 'Employee Profile modal', erow, 'TEST EMP 1')
    pg.goto(BASE + '/loans'); pg.wait_for_load_state('networkidle')
    modal_cycle(p, 'Request loan modal', lambda: pg.get_by_test_id('new-loan'), 'loan')
    pg.goto(BASE + '/sales/employees'); pg.wait_for_load_state('networkidle')
    modal_cycle(p, 'Sales employee New modal', lambda: pg.get_by_role('button', name='+ New', exact=True), 'New sales employee')

    # ── 6. 390px phone ─────────────────────────────────────────────────────────
    print('\n— hr @390px —')
    pg.set_viewport_size({'width': 390, 'height': 844})
    pg.goto(BASE + '/leave-management'); pg.wait_for_load_state('networkidle')
    close_drawer(pg)   # the desktop sidebar opens as a drawer at 390 — close it
    pg.get_by_role('button', name='+ Apply Leave').click()
    dlg = p.dialog('Apply for Leave'); dlg.wait_for()
    box = dlg.locator('h3').evaluate('el => { const r = el.closest("[id^=headlessui-dialog-panel]").getBoundingClientRect(); return [r.left, r.right] }')
    check('390: Apply Leave panel within the screen', True, box[0] >= 0 and box[1] <= 390)
    pg.keyboard.press('Escape'); dlg.wait_for(state='detached')
    pg.get_by_role('button', name='Gate Passes').first.click(); pg.wait_for_load_state('networkidle')
    # gate pass already cancelled → seed one more for the phone check
    q_conn = sqlite3.connect(DB)
    q_conn.execute("INSERT INTO short_leaves(employee_code,employee_name,company,date,leave_type,duration_hours,remark,"
                   "calendar_month,calendar_year,created_by_name) VALUES('T9602','TEST EMP 2',?,?,'short_leave',2,"
                   "'Phone gate pass',?,?,'hr')", (C, d(27), M, Y)); q_conn.commit(); q_conn.close()
    pg.reload(); pg.wait_for_load_state('networkidle')
    close_drawer(pg)
    pg.get_by_role('button', name='Gate Passes').first.click(); pg.wait_for_load_state('networkidle')
    gb = pg.locator('tr', has_text='Phone gate pass').get_by_role('button', name='Cancel', exact=True)
    n0 = p.count('PUT', r'/api/short-leaves/\d+/cancel')
    gb.scroll_into_view_if_needed(); gb.click()
    dlg = p.dialog('Cancel gate pass?'); dlg.wait_for(); time.sleep(.4)
    ok = dlg.get_by_role('button', name='Cancel gate pass', exact=True).bounding_box()
    check('390: confirm buttons on screen', True, ok['x'] >= 0 and ok['x'] + ok['width'] <= 390)
    dlg.get_by_role('button', name='Keep', exact=True).click(); dlg.wait_for(state='detached')
    time.sleep(.4)
    check('390: Keep → 0 cancel requests', n0, p.count('PUT', r'/api/short-leaves/\d+/cancel'))
    p.finish()

    # ── 2. SqlConsole restore: prompt + 2 alerts (admin) ───────────────────────
    print('\n— admin: SQL Console snapshot restore —')
    # LAST on purpose: a successful restore leaves a write txn open on the app's shared DB connection for 60 s,
    # and any other app write in that window is rolled back with it (pre-existing SQL Console behaviour).
    p = pa
    s, r = api('POST', '/api/auth/login', {'username': 'admin', 'password': PW['admin']}); tok = r.get('token')
    for code in ('T9603', 'T9604'):
        s, r = api('POST', '/api/admin/sql/preview', {'sql': f"UPDATE employees SET department='TEST DEPT B' WHERE code='{code}'",
                                                      'remark': 'P2-01 test write for restore'}, tok)
        s2, r2 = api('POST', f"/api/admin/sql/commit/{r.get('txn_id')}", {}, tok)
        check(f'setup: committed protected write {code}', (200, 200), (s, s2))
    pg = p.pg
    pg.goto(BASE + '/admin/sql-console'); pg.wait_for_load_state('networkidle')

    def open_restore():
        link = pg.get_by_role('button', name='Restore this snapshot →').first
        if not link.is_visible():   # a cancelled prompt leaves the list open (unchanged behaviour)
            pg.get_by_role('button', name='Snapshots ▾').click()
        link.wait_for(timeout=8000)
        link.click()
        dlg = p.dialog('Restore snapshot'); dlg.wait_for(timeout=8000); time.sleep(.4)
        return dlg
    RESTORE = r'/api/admin/sql/snapshot/\d+/restore'
    dlg = open_restore()
    check('prompt: text', True, 'describe why (≥10 characters)' in dlg.inner_text())
    check('prompt: input has focus', 'INPUT', pg.evaluate('() => document.activeElement.tagName'))
    dlg.get_by_role('button', name='Cancel', exact=True).click(); dlg.wait_for(state='detached')
    time.sleep(.3); check('prompt Cancel → 0 restore POST', 0, p.count('POST', RESTORE))
    dlg = open_restore(); pg.keyboard.press('Escape'); dlg.wait_for(state='detached')
    time.sleep(.3); check('prompt Esc → 0 restore POST', 0, p.count('POST', RESTORE))
    dlg = open_restore(); dlg.locator('input').fill('short'); dlg.get_by_role('button', name='OK', exact=True).click()
    al = p.dialog('Restore aborted'); al.wait_for(timeout=5000); time.sleep(.4)
    check('alert (<10 chars): text', True, 'remark must be at least 10 characters' in al.inner_text())
    check('alert: one button only (no Cancel)', 1, al.get_by_role('button').count())
    check('alert: focus on OK', 'OK', p.active_text())
    al.get_by_role('button', name='OK', exact=True).click(); al.wait_for(state='detached')
    time.sleep(.3); check('<10 chars → 0 restore POST', 0, p.count('POST', RESTORE))
    # failure: hold a write txn open via the API so the restore answers 409 TXN_ALREADY_OPEN
    s, hold = api('POST', '/api/admin/sql/preview', {'sql': "UPDATE employees SET department='TEST DEPT C' WHERE code='T9604'",
                                                     'remark': 'P2-01 hold a txn open'}, tok)
    ALLOWED_BAD.append('/restore')
    dlg = open_restore(); dlg.locator('input').fill('P2-01 restore check (fails)'); pg.keyboard.press('Enter')
    al = p.dialog('Restore failed'); al.wait_for(timeout=8000); time.sleep(.4)
    check('alert (failed): text names the code', True, 'Restore failed: TXN_ALREADY_OPEN' in al.inner_text())
    pg.keyboard.press('Escape'); al.wait_for(state='detached')
    check('failed restore → exactly 1 POST', 1, p.count('POST', RESTORE))
    api('POST', f"/api/admin/sql/rollback/{hold.get('txn_id')}", {}, tok)
    dlg = open_restore(); dlg.locator('input').fill('  P2-01 restore check  ')
    dlg.get_by_role('button', name='OK', exact=True).click(); dlg.wait_for(state='detached')
    for _ in range(30):
        if p.count('POST', RESTORE) == 2: break
        time.sleep(.2)
    check('valid remark → 2nd restore POST', 2, p.count('POST', RESTORE))
    check('restore POST body = trimmed remark', {'remark': 'P2-01 restore check'}, json.loads(p.bodies('POST', RESTORE)[-1]))
    pg.get_by_text('Restore', exact=False).first.wait_for(timeout=8000)
    p.finish()


def run_base(b):
    print('\n— BASE: admin Settings holiday Remove (native confirm) —')
    p = Page(b, 'admin')
    p.pg.goto(BASE + '/settings/holidays'); p.pg.wait_for_load_state('networkidle')
    p.pg.locator('tr', has_text='TEST HOLIDAY P2').get_by_role('button', name='Remove').click()
    time.sleep(1)
    check('old code: a native confirm fired', ['Remove this holiday?'], p.native)
    p.ctx.close()
    print('\n— BASE: hr Apply Leave modal Tab trap —')
    p = Page(b, 'hr'); pg = p.pg
    pg.goto(BASE + '/leave-management'); pg.wait_for_load_state('networkidle')
    pg.get_by_role('button', name='+ Apply Leave').click()
    pg.locator('h3', has_text='Apply for Leave').wait_for()
    inside = []
    for _ in range(25):
        pg.keyboard.press('Tab')
        inside.append(pg.evaluate("""() => { const h = [...document.querySelectorAll('h3')].find(x => x.textContent.includes('Apply for Leave'));
            return !!h && h.closest('.fixed').contains(document.activeElement) }"""))
    check('old code: Tab leaves the modal at some point', True, False in inside)
    check('old code: no role=dialog', 0, pg.locator('[role="dialog"]').count())
    p.ctx.close()


env = dict(os.environ, DATA_DIR=WORK, JWT_SECRET='x', PORT=str(PORT), NODE_ENV='production',
           ADMIN_PASSWORD=PW['admin'], HR_PASSWORD=PW['hr'], FINANCE_PASSWORD=PW['finance'],
           SQL_CONSOLE_ENABLED='true', SQL_CONSOLE_API_KEY='p2-01-test-key-not-a-secret-0123456789')
srv = subprocess.Popen(['node', f'{ROOT}/backend/server.js'], env=env, stdout=open(f'{WORK}/log', 'w'), stderr=subprocess.STDOUT)
try:
    for _ in range(80):
        try: urllib.request.urlopen(BASE + '/api/version', timeout=2); break
        except Exception: time.sleep(.5)
    seed()
    print(f'App root: {ROOT}  mode: {"BASE" if BASE_MODE else "fix"}  month {M}/{Y}  work {WORK}')
    with sync_playwright() as pw:
        b = pw.chromium.launch()
        (run_base if BASE_MODE else run_fix)(b)
        b.close()
finally:
    srv.terminate(); srv.wait(timeout=10)
print(f'\n{PASS} passed, {FAIL} failed')
sys.exit(1 if FAIL else 0)
