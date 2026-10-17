#!/usr/bin/env python3
"""P5-04 — bulk salary revision: browser check (Chromium, built dist, real hr / finance / admin logins).

Scratch DATA_DIR, fictional people only (T9501–T9506, "Test Person A–F"), effective 2026-11-01 (first open month: Stage 7 rows, not finalised — Q-EM), November attendance seeded so
Stage 6 + 7 can run. hr pastes rows on Salary Input → "+ Bulk revision" (one % row, one conflict row left out) → sends;
finance opens Finance Verification → Bulk batches, sees every component and the ₹ total, approves → structures + gross change;
undo works; re-sent + approved again → Stage 7 pays the new gross → undo refused. Self-approval refused. Drift query.
Usage: python3 backend/scripts/bulk-salary-revision-check.py [--base ROOT_OF_BASE_WORKTREE] [screenshot_dir]
  --base: the same first steps on another checkout's build: no "+ Bulk revision" button, no salary-revision kind.
Port: PORT env (default 3504).
"""
import json, os, re, sqlite3, subprocess, sys, tempfile, time, urllib.request, urllib.error
from playwright.sync_api import sync_playwright

args = sys.argv[1:]
BASE_ROOT = None
if '--base' in args:
    i = args.index('--base'); BASE_ROOT = os.path.abspath(args[i + 1]); del args[i:i + 2]
SHOTS = args[0] if args else None
ROOT = BASE_ROOT or os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
PORT = int(os.environ.get('PORT', '3504')); BASE = f'http://127.0.0.1:{PORT}'
WORK = tempfile.mkdtemp(prefix='bulk-sr-'); DB = os.path.join(WORK, 'hr_system.db')
PW = {'admin': 'Admin@123', 'hr': 'Indriyan@2025', 'finance': 'Finance@2025'}
C = 'Indriyan Beverages Pvt Ltd'
EFF = '2026-11-01'
PASS = FAIL = 0


def check(label, expected, actual):
    global PASS, FAIL
    if expected == actual: PASS += 1; print(f'  ✓ {label}')
    else: FAIL += 1; print(f'  ✗ {label} — expected {expected!r}, got {actual!r}')


def q(sql, *a):
    con = sqlite3.connect(DB); r = con.execute(sql, a).fetchall(); con.close(); return r


def http(method, path, tok=None, body=None):
    data = json.dumps(body).encode() if body is not None else None
    h = {'Content-Type': 'application/json'}
    if tok: h['Authorization'] = f'Bearer {tok}'
    req = urllib.request.Request(BASE + path, data=data, method=method, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=60) as r: return r.status, json.loads(r.read() or b'{}')
    except urllib.error.HTTPError as e:
        try: return e.code, json.loads(e.read() or b'{}')
        except Exception: return e.code, {}


def login_api(u):
    s, b = http('POST', '/api/auth/login', body={'username': u, 'password': PW[u]})
    return b.get('token')


PEOPLE = [('T9501', 'A', 20000), ('T9502', 'B', 30000), ('T9503', 'C', 25000), ('T9504', 'D', 20000), ('T9505', 'E', 18000), ('T9506', 'F', 22000)]


def seed():
    c = sqlite3.connect(DB)
    for code, letter, g in PEOPLE:
        c.execute("INSERT INTO employees(code,name,department,company,status,employment_type,gross_salary,date_of_joining) "
                  "VALUES(?,?,'TEST DEPT',?,'Active','Permanent',?, '2024-01-01')", (code, f'Test Person {letter}', C, g))
        eid = c.execute('SELECT id FROM employees WHERE code=?', (code,)).fetchone()[0]
        conv = 300 if code == 'T9501' else 0
        c.execute("INSERT INTO salary_structures(employee_id,effective_from,gross_salary,basic,da,hra,conveyance,special_allowance,"
                  "other_allowances,basic_percent,hra_percent,da_percent,pt_applicable,pf_applicable,pf_wage_ceiling) "
                  "VALUES(?, '2025-01-01', ?, ?, 0, ?, ?, 0, ?, 50, 20, 0, 1, 1, 15000)", (eid, g, g * .5, g * .2, conv, g * .3 - conv))
        for d in range(1, 31):
            day = f'2026-11-{d:02d}'
            st = 'WO' if time.strptime(day, '%Y-%m-%d').tm_wday == 6 else 'P'
            io = ('08:00', '20:00') if st == 'P' else (None, None)
            c.execute("""INSERT INTO attendance_processed (employee_code, date, status_original, status_final, company, month, year,
                in_time_original, out_time_original, in_time_final, out_time_final) VALUES (?, ?, ?, ?, ?, 11, 2026, ?, ?, ?, ?)""",
                      (code, day, st, st, C, *io, *io))
    c.execute("INSERT INTO monthly_imports (month, year, file_name, company, stage_1_done) VALUES (11, 2026, 'sim-nov.xls', ?, 1)", (C,))
    # Q-EM (owner, 17 Oct 2026): a month is open only with Stage 7 rows and not finalised. Scratch shape:
    #  Apr 2025 import-only, unfinalised, no Stage 7 rows → ignored; Oct 2026 finalised with Stage 7 rows → closed;
    #  Nov 2026 has a Stage 7 placeholder row (fictional T9599, all zero so drift stays 0) → the first open month.
    c.execute("INSERT INTO monthly_imports (month, year, file_name, company, stage_1_done) VALUES (4, 2025, 'sim-apr25.xls', ?, 1)", (C,))
    c.execute("INSERT INTO monthly_imports (month, year, file_name, company, stage_1_done, is_finalised) VALUES (10, 2026, 'sim-oct.xls', ?, 1, 1)", (C,))
    c.execute("INSERT INTO salary_computations (employee_code, month, year, company, gross_salary, gross_earned, total_deductions, net_salary) "
              "VALUES ('T9599', 10, 2026, ?, 0, 0, 0, 0)", (C,))
    c.execute("INSERT INTO salary_computations (employee_code, month, year, company, gross_salary, gross_earned, total_deductions, net_salary) "
              "VALUES ('T9599', 11, 2026, ?, 0, 0, 0, 0)", (C,))
    # T9504: a single-path request already waiting for finance → conflict row (Q-B8)
    eid = c.execute("SELECT id FROM employees WHERE code='T9504'").fetchone()[0]
    c.execute("INSERT INTO salary_change_requests (employee_id, employee_code, requested_by, old_gross, new_gross, old_structure, new_structure, reason, status) "
              "VALUES (?, 'T9504', 'hr', 20000, 21000, '{}', '{\"gross_salary\":21000}', 'single path', 'Pending')", (eid,))
    c.commit(); c.close()


env = dict(os.environ, DATA_DIR=WORK, JWT_SECRET='p504-secret', PORT=str(PORT), NODE_ENV='production',
           ADMIN_PASSWORD=PW['admin'], HR_PASSWORD=PW['hr'], FINANCE_PASSWORD=PW['finance'])
srv = None


def start():
    global srv
    srv = subprocess.Popen(['node', f'{ROOT}/backend/server.js'], env=env, stdout=open(f'{WORK}/log', 'a'), stderr=subprocess.STDOUT)
    for _ in range(80):
        try: urllib.request.urlopen(BASE + '/api/version', timeout=2); return
        except Exception: time.sleep(.5)
    raise SystemExit('server did not start')


def stop():
    srv.terminate(); srv.wait(timeout=10)


def gross(code): return q('SELECT gross_salary FROM employees WHERE code=?', code)[0][0]
def latest(code):
    return q("SELECT s.effective_from, s.gross_salary, s.basic, s.hra, s.conveyance, s.other_allowances, s.pf_applicable, s.pf_wage_ceiling "
             "FROM salary_structures s JOIN employees e ON e.id=s.employee_id WHERE e.code=? ORDER BY s.effective_from DESC, s.id DESC LIMIT 1", code)[0]


try:
    start(); seed()
    with sync_playwright() as p:
        b = p.chromium.launch()
        errs, cerrs, bad = [], [], []
        EXPECTED_BAD = set()

        def login(user, width=1440):
            ctx = b.new_context(viewport={'width': width, 'height': 900})
            pg = ctx.new_page()
            pg.on('pageerror', lambda e: errs.append(str(e)))
            pg.on('console', lambda m: cerrs.append(m.text) if m.type == 'error' else None)
            pg.on('response', lambda r: bad.append(f'{r.status} {r.request.method} {r.url.split(BASE)[-1]}') if '/api/' in r.url and r.status >= 400 else None)
            pg.goto(BASE + '/login'); pg.get_by_placeholder('admin').fill(user); pg.get_by_placeholder('••••••••').fill(PW[user])
            pg.get_by_role('button', name='Sign in').click(); pg.wait_for_url(lambda u: '/login' not in u)
            return pg

        if BASE_ROOT:
            print('\n— BASE build —')
            hr = login('hr'); hr.goto(BASE + '/salary-input'); hr.wait_for_load_state('networkidle'); time.sleep(.8)
            check('base: no "+ Bulk revision" button on Salary Input', 0, hr.locator('[data-testid=sr-bulk-open]').count())
            s, _ = http('POST', '/api/bulk/salary-revision/preview', login_api('admin'), {'common': {}, 'rows': [{'code': 'T9501', 'new_gross': 1}]})
            check('base: no salary-revision kind (404)', 404, s)
            b.close(); raise SystemExit(0)

        print('\n— hr: paste rows on Salary Input → check → leave out the conflict → send —')
        hr = login('hr')
        hr.goto(BASE + '/salary-input'); hr.wait_for_load_state('networkidle'); time.sleep(.5)
        hr.locator('[data-testid=sr-bulk-open]').click()
        hr.wait_for_selector('[data-testid=sr-bulk-panel]')
        check('panel opens inline (no dialog)', 0, hr.get_by_role('dialog').count())
        hr.wait_for_function("document.querySelector('#sr-date').value !== ''")
        check('default date = 1st of the first open payroll month (Q-EM: Nov 2026 has Stage 7 rows; import-only Apr 2025 and finalised Oct 2026 ignored)', EFF, hr.locator('#sr-date').input_value())
        check('panel names the first open payroll month', True, 'Nov-2026' in hr.locator('[data-testid=sr-first-open]').inner_text())
        hr.locator('#sr-reason').fill('annual increment test')
        hr.locator('[data-testid=sr-text]').fill('T9506 23000 01-12-2026')
        hr.wait_for_selector('[data-scroll-table=sr-preview]'); time.sleep(1.2)
        check('H1 a: a December date (later than the open Nov) is refused', True,
              'first open payroll month (Nov 2026)' in hr.locator('tr[data-code=T9506]').inner_text())
        hr.locator('[data-testid=sr-text]').fill('T9501,22,000\nT9502 10%\nT9503 27,500\nT9504 21000\nnot-a-row')
        hr.wait_for_selector('[data-scroll-table=sr-preview]'); time.sleep(1.2)
        check('parse line: 4 rows read, 1 not understood', True, '4 rows read' in hr.locator('[data-testid=sr-parse-line]').inner_text()
              and '1 line not understood' in hr.locator('[data-testid=sr-parse-line]').inner_text())
        r4 = hr.locator('tr[data-code=T9504]')
        check('conflict row T9504 flagged (already waiting for finance)', True, 'already waiting for finance' in r4.inner_text())
        check('Send disabled while a problem row is there', True, hr.locator('[data-testid=sr-send]').is_disabled())
        r2 = hr.locator('tr[data-code=T9502]').inner_text()
        check('% row: ₹30,000 → ₹33,000 (10%)', True, '₹30,000' in r2 and '₹33,000' in r2 and '10%' in r2)
        r1 = hr.locator('tr[data-code=T9501]').inner_text()
        check('T9501: Basic ₹10,000 → ₹11,000 and conveyance kept', True, '₹10,000 → ₹11,000' in r1 and 'Conveyance 300 kept' in r1)
        check('total change per month = ₹7,500', True, '₹7,500' in hr.locator('[data-testid=sr-delta-total]').inner_text())
        hr.locator('[data-testid=sr-leave-out]').click(); time.sleep(1.4)
        check('after "leave out": 3 rows, no T9504', (3, 0), (hr.locator('[data-scroll-table=sr-preview] tbody tr').count(), hr.locator('tr[data-code=T9504]').count()))
        if SHOTS: hr.screenshot(path=os.path.join(SHOTS, 'p504-hr-panel.png'), full_page=True)
        send_btn = hr.locator('[data-testid=sr-send]')
        check('send button label', 'Send 3 to finance', send_btn.inner_text().strip())
        send_btn.dblclick(); time.sleep(.6)
        dlg = hr.get_by_role('dialog')
        check('confirm names the ₹ total', True, '₹7,500' in dlg.inner_text())
        dlg.get_by_role('button', name='Send to finance').click()
        hr.wait_for_selector('[data-testid=sr-bulk-result]'); time.sleep(.5)
        check('one batch submitted (double click → 1)', [(1, 'submitted', 7500.0)], q("SELECT COUNT(*), MAX(status), MAX(money_total) FROM bulk_batches WHERE kind='salary-revision'"))
        X = q("SELECT id FROM bulk_batches WHERE kind='salary-revision'")[0][0]
        check('nothing changed yet (gross, requests)', (20000.0, 1), (gross('T9501'), q('SELECT COUNT(*) FROM salary_change_requests')[0][0]))
        hr.locator('[data-testid=sr-bulk-result]').get_by_role('button', name='Close').click(); time.sleep(.3)
        hr.locator('[data-testid=sr-bulk-open]').click(); time.sleep(1)
        check('recent batches list shows it as waiting', True, 'Waiting for finance' in hr.locator(f'tr[data-batch-id="{X}"]').inner_text())

        print('\n— hr at 390 px —')
        hr390 = login('hr', width=390)
        hr390.goto(BASE + '/salary-input'); hr390.wait_for_load_state('networkidle'); hr390.locator('[data-testid=sr-bulk-open]').click()
        hr390.wait_for_selector('[data-testid=sr-bulk-panel]')
        right = hr390.locator('[data-testid=sr-bulk-panel]').evaluate('e => e.getBoundingClientRect().right')
        check('390: panel fits the screen width', True, right <= 391)
        if SHOTS: hr390.screenshot(path=os.path.join(SHOTS, 'p504-390.png'), full_page=True)

        print('\n— finance: Bulk batches → open → approve —')
        fin = login('finance')
        fin.goto(BASE + '/finance-verification?tab=bulk'); fin.wait_for_load_state('networkidle'); time.sleep(.8)
        row = fin.locator(f'tr[data-batch-id="{X}"]')
        check('queue row shows change / month ₹7,500', True, '₹7,500' in row.inner_text())
        row.get_by_role('button', name='Open').click(); fin.wait_for_selector('[data-testid=bulk-queue-rows]'); time.sleep(.3)
        rows_txt = fin.locator('[data-testid=bulk-queue-rows]').inner_text()
        check('finance sees every component column', True, all(s.upper() in rows_txt.upper() for s in ['Basic now', 'Basic new', 'DA new', 'HRA new', 'Conv. new', 'Other new', 'Gross new']))
        check('finance sees T9502 ₹33,000', True, '₹33,000' in rows_txt)
        if SHOTS: fin.screenshot(path=os.path.join(SHOTS, 'p504-finance.png'), full_page=True)
        row.locator('input[type=checkbox]').check()
        fin.locator('[data-testid=bulk-bar]').get_by_role('button', name=re.compile('Approve 1')).click(); time.sleep(.5)
        fin.get_by_role('dialog').get_by_role('button', name='Approve and apply').click(); time.sleep(1.8)
        check('batch applied, approved by finance', [('applied', 'finance')], q('SELECT status, approved_by FROM bulk_batches WHERE id=?', X))
        check('gross updated (22000 / 33000 / 27500)', (22000.0, 33000.0, 27500.0), (gross('T9501'), gross('T9502'), gross('T9503')))
        check('T9501 new structure from 2026-11-01, conveyance kept, flags + ceiling carried',
              (EFF, 22000.0, 11000.0, 4400.0, 300.0, 1, 15000.0), tuple(latest('T9501')[i] for i in (0, 1, 2, 3, 4, 6, 7)))
        check('3 requests Approved, requested by hr, approved by finance', [(3,)],
              q("SELECT COUNT(*) FROM salary_change_requests WHERE status='Approved' AND requested_by='hr' AND approved_by='finance'"))
        check('audit SALARY_REVISION_BULK 9 rows', [(9,)], q("SELECT COUNT(*) FROM audit_log WHERE stage='SALARY_REVISION_BULK'"))
        check('single-path request of T9504 untouched (Pending)', [('Pending',)], q("SELECT status FROM salary_change_requests WHERE employee_code='T9504'"))

        print('\n— undo (finance) works before Stage 7 —')
        ftok = login_api('finance')
        s, body = http('POST', f'/api/bulk/batches/{X}/undo', ftok, {'reason': 'redo with the full list'})
        check('undo → 200, 3 rows', (200, 3), (s, body.get('undone')))
        check('gross back (20000 / 30000 / 25000)', (20000.0, 30000.0, 25000.0), (gross('T9501'), gross('T9502'), gross('T9503')))
        check('Nov structure removed', '2025-01-01', latest('T9501')[0])
        check('requests Reverted', [(3,)], q("SELECT COUNT(*) FROM salary_change_requests WHERE status='Reverted'"))

        print('\n— re-send (API, hr) → admin self-approval refused → finance approves → Stage 6+7 → undo refused —')
        stop(); start()  # login limiter
        htok = login_api('hr'); atok = login_api('admin'); ftok = login_api('finance')
        rows = [{'code': 'T9501', 'new_gross': 22000}, {'code': 'T9502', 'pct': 10}, {'code': 'T9505', 'pct': 5}]
        s, pv = http('POST', '/api/bulk/salary-revision/preview', atok, {'common': {'effective_from': EFF}, 'rows': rows})
        g = pv['groups'][0]
        by = {r['rowNo']: r for r in pv['rows']}
        s, sub = http('POST', '/api/bulk/salary-revision/submit', atok, {'common': {'effective_from': EFF}, 'planHash': g['planHash'],
                                                                         'rows': [by[n]['input'] for n in g['rowNos']]})
        Y = sub.get('batchId')
        check('admin sends batch Y', 200, s)
        s, body = http('POST', f'/api/bulk/batches/{Y}/approve', atok, {})
        check('admin approves own batch → 403 SELF_APPROVAL', (403, 'SELF_APPROVAL'), (s, body.get('code')))
        s, _ = http('POST', f'/api/bulk/batches/{Y}/approve', ftok, {})
        check('finance approves Y', 200, s)
        check('T9505 % row: 18000 × 1.05 = 18900', 18900.0, gross('T9505'))
        s, _ = http('POST', '/api/payroll/calculate-days', htok, {'month': 11, 'year': 2026, 'company': C}); check('Stage 6 runs', 200, s)
        s, _ = http('POST', '/api/payroll/compute-salary', htok, {'month': 11, 'year': 2026, 'company': C}); check('Stage 7 runs', 200, s)
        sc = dict(q("SELECT employee_code, gross_salary FROM salary_computations WHERE month=11 AND year=2026"))
        check('Stage 7 pays the new gross (T9501 22000, T9502 33000, T9505 18900, T9503 25000)',
              (22000.0, 33000.0, 18900.0, 25000.0), (sc.get('T9501'), sc.get('T9502'), sc.get('T9505'), sc.get('T9503')))
        s, body = http('POST', f'/api/bulk/batches/{Y}/undo', ftok, {'reason': 'try to undo after pay'})
        check('undo after Stage 7 → 409 blocked', (409, 'BULK_UNDO_BLOCKED'), (s, body.get('code')))
        check('block reason names Stage 7', True, 'Stage 7' in json.dumps(body.get('rows', [])))
        check('gross unchanged after the refused undo', 22000.0, gross('T9501'))
        drift = q('SELECT COUNT(*) FROM salary_computations WHERE ABS(net_salary - (gross_earned - total_deductions)) > 1')[0][0]
        check('drift query (§10.7) = 0 rows', 0, drift)

        print('\n— Errors —')
        check('0 page errors', [], errs)
        unexpected = [x for x in bad if x not in EXPECTED_BAD]
        check('0 unexpected API ≥ 400 (browser)', [], unexpected)
        check('0 console errors', [], [c for c in cerrs if 'favicon' not in c and 'vite.svg' not in c])
        b.close()
except SystemExit:
    raise
except Exception:
    import traceback; traceback.print_exc(); FAIL += 1
finally:
    try: stop()
    except Exception: pass
    print(f'\n{PASS} passed, {FAIL} failed  (scratch {WORK})')
    sys.exit(1 if FAIL else 0)
