#!/usr/bin/env python3
"""BULK-WORD — Recent bulk batches list: per-kind wording + finance sees salary-revision batches.

Chromium on the built dist, scratch DATA_DIR, fictional people only (T9501–T9506, "Test Person A–F"), real logins.
Salary revision batches: A sent (waiting) → approved by finance → undone; B returned; C rejected. Extra duty: one bulk grant.
Checks: finance sees the list on Salary Input without HR's panel (Q3); headers Sent / Revisions; one waiting line;
row view ₹ old → new + state word; returned / rejected rows "not applied"; applied badge "Approved" + "Approved by" tooltip;
undo prompt + toast in salary-change words; HR sees no Undo; Extra Duty list keeps "Saved" / "Saved rows" / "created" / grant words;
empty text; 390 px; 0 page errors / console errors / unexpected API >= 400.
Usage: python3 backend/scripts/bulk-word-check.py [--base ROOT_OF_BASE_WORKTREE]
  --base: same seed on another checkout's build — proves the old list: finance sees no list, revision rows say "created",
          headers "Saved rows", generic undo wording. (Those checks PASS on base = the bug is there; the fix checks would fail.)
Port: PORT env (default 3502).
"""
import json, os, subprocess, sys, tempfile, time, urllib.request, urllib.error, sqlite3
from playwright.sync_api import sync_playwright

args = sys.argv[1:]
BASE_ROOT = None
if '--base' in args:
    i = args.index('--base'); BASE_ROOT = os.path.abspath(args[i + 1]); del args[i:i + 2]
ROOT = BASE_ROOT or os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
PORT = int(os.environ.get('PORT', '3502')); BASE = f'http://127.0.0.1:{PORT}'
WORK = tempfile.mkdtemp(prefix='bulk-word-'); DB = os.path.join(WORK, 'hr_system.db')
PW = {'admin': 'Admin@123', 'hr': 'Indriyan@2025', 'finance': 'Finance@2025'}
C = 'Indriyan Beverages Pvt Ltd'
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
        c.execute("INSERT INTO salary_structures(employee_id,effective_from,gross_salary,basic,da,hra,conveyance,special_allowance,"
                  "other_allowances,basic_percent,hra_percent,da_percent,pt_applicable,pf_applicable,pf_wage_ceiling) "
                  "VALUES(?, '2025-01-01', ?, ?, 0, ?, 0, 0, ?, 50, 20, 0, 1, 1, 15000)", (eid, g, g * .5, g * .2, g * .3))
    # First open payroll month = Oct 2026 (Stage 7 placeholder row, all zero → drift 0; not finalised).
    c.execute("INSERT INTO monthly_imports (month, year, file_name, company, stage_1_done) VALUES (10, 2026, 'sim-oct.xls', ?, 1)", (C,))
    c.execute("INSERT INTO salary_computations (employee_code, month, year, company, gross_salary, gross_earned, total_deductions, net_salary) "
              "VALUES ('T9599', 10, 2026, ?, 0, 0, 0, 0)", (C,))
    c.commit(); c.close()


env = dict(os.environ, DATA_DIR=WORK, JWT_SECRET='bulk-word-secret', PORT=str(PORT), NODE_ENV='production',
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


def submit_revision(tok, rows, eff):
    s, pv = http('POST', '/api/bulk/salary-revision/preview', tok, {'common': {'effective_from': eff, 'reason': 'test revision'}, 'rows': rows})
    if s != 200: return s, pv
    g = pv['groups'][0]; by = {r['rowNo']: r for r in pv['rows']}
    return http('POST', '/api/bulk/salary-revision/submit', tok, {'common': {'effective_from': eff, 'reason': 'test revision'},
                                                                  'planHash': g['planHash'], 'rows': [by[n]['input'] for n in g['rowNos']]})


try:
    start(); seed()
    htok, ftok = login_api('hr'), login_api('finance')
    s, d = http('GET', '/api/bulk/salary-revision/defaults', htok)
    EFF = (d.get('data') or {}).get('effective_from') or '2026-10-01'
    print(f'effective date {EFF}  mode: {"BASE " + BASE_ROOT if BASE_ROOT else "fix"}')

    with sync_playwright() as p:
        b = p.chromium.launch()
        errs, cerrs, bad = [], [], []

        def login(user, width=1440):
            ctx = b.new_context(viewport={'width': width, 'height': 900})
            pg = ctx.new_page()
            pg.on('pageerror', lambda e: errs.append(str(e)))
            pg.on('console', lambda m: cerrs.append(m.text) if m.type == 'error' else None)
            pg.on('response', lambda r: bad.append(f'{r.status} {r.request.method} {r.url.split(BASE)[-1]}') if '/api/' in r.url and r.status >= 400 else None)
            pg.goto(BASE + '/login'); pg.get_by_placeholder('admin').fill(user); pg.get_by_placeholder('••••••••').fill(PW[user])
            pg.get_by_role('button', name='Sign in').click(); pg.wait_for_url(lambda u: '/login' not in u)
            return pg

        def open_sr(pg, panel=False):
            pg.goto(BASE + '/salary-input'); pg.wait_for_load_state('networkidle'); time.sleep(.6)
            if panel:
                pg.locator('[data-testid=sr-bulk-open]').click(); pg.wait_for_selector('[data-testid=bulk-batch-list]'); time.sleep(.6)

        def lst(pg): return pg.locator('[data-testid=bulk-batch-list]')
        def row(pg, bid): return pg.locator(f'tr[data-batch-id="{bid}"]')

        def view_rows(pg, bid):
            row(pg, bid).get_by_role('button', name='View rows').click(); time.sleep(.8)
            return lst(pg).inner_text()

        if not BASE_ROOT:
            print('\n— finance, before any batch: list shown without the HR panel, empty text —')
            fin = login('finance'); open_sr(fin)
            check('finance sees the batch list on Salary Input (Q3)', 1, lst(fin).count())
            check('empty text names salary revisions', 'No bulk salary revisions yet', fin.locator('[data-testid=bulk-batch-empty]').inner_text().strip())

        # Batches: A sent (T9501, T9502), B returned (T9503), C rejected (T9505)
        s, A = submit_revision(htok, [{'code': 'T9501', 'new_gross': 22000}, {'code': 'T9502', 'pct': 10}], EFF); A = A.get('batchId')
        s, B = submit_revision(htok, [{'code': 'T9503', 'new_gross': 27500}], EFF); B = B.get('batchId')
        s, Cb = submit_revision(htok, [{'code': 'T9505', 'new_gross': 19000}], EFF); Cb = Cb.get('batchId')
        check('three revision batches sent', True, all([A, B, Cb]))
        check('finance returns B', 200, http('POST', f'/api/bulk/batches/{B}/return', ftok, {'note': 'wrong person here'})[0])
        check('finance rejects C', 200, http('POST', f'/api/bulk/batches/{Cb}/reject', ftok, {'reason': 'not agreed with management'})[0])
        # Extra duty bulk grant (hr), today's IST month
        today = time.strftime('%Y-%m-%d', time.gmtime(time.time() + 5.5 * 3600))
        edc = {'grant_date': today[:8] + '05', 'grant_type': 'OVERNIGHT_STAY', 'duty_days': 1, 'verification_source': 'Gate Register'}
        s, pv = http('POST', '/api/bulk/extra-duty/preview', htok, {'common': edc, 'rows': ['T9504', 'T9506']})
        g = pv['groups'][0]
        s, ed = http('POST', '/api/bulk/extra-duty/apply', htok, {'common': edc, 'rows': [{'code': 'T9504'}, {'code': 'T9506'}], 'planHash': g['planHash']})
        ED = ed.get('batchId'); check('extra duty bulk batch saved', True, bool(ED))

        if BASE_ROOT:
            print('\n— BASE build (bug present) —')
            fin = login('finance'); open_sr(fin)
            check('base: finance sees NO batch list on Salary Input', 0, lst(fin).count())
            hr = login('hr'); open_sr(hr, panel=True)
            heads = hr.locator('[data-testid=bulk-batch-list] thead').inner_text().upper()
            check('base: revision headers say "Saved rows"', True, 'SAVED ROWS' in heads)
            txt = view_rows(hr, A)
            check('base: a waiting revision row says "created"', True, 'created' in txt)
            check('base: no ₹ old → new in the row view', False, '₹20,000 → ₹22,000' in txt)
            b.close(); raise SystemExit(0 if FAIL == 0 else 1)

        print('\n— finance: waiting / returned / rejected wording —')
        fin.reload(); fin.wait_for_load_state('networkidle'); time.sleep(.8)
        heads = lst(fin).locator('thead').inner_text().upper()
        check('headers: Sent + Revisions (no "Saved rows")', (True, True, False), ('SENT' in heads, 'REVISIONS' in heads, 'SAVED ROWS' in heads))
        check('A badge "Waiting for finance"', 'Waiting for finance', row(fin, A).locator('[data-status]').inner_text().strip())
        check('one "waiting for finance to decide" line (only A)', 1, fin.locator('[data-testid=bulk-waiting-note]').count())
        check('waiting line names who sent it', True, 'Sent by hr' in fin.locator('[data-testid=bulk-waiting-note]').inner_text())
        txt = view_rows(fin, A)
        check('A row view: ₹20,000 → ₹22,000 from date · waiting for finance', True, '₹20,000 → ₹22,000 from' in txt and 'waiting for finance' in txt)
        check('A row view: % row ₹30,000 → ₹33,000', True, '₹30,000 → ₹33,000' in txt)
        check('A row view never says "created"', False, ' created' in txt)
        row(fin, A).get_by_role('button', name='Hide rows').click(); time.sleep(.3)
        check('returned B: "not applied" in rows', True, 'not applied' in view_rows(fin, B))
        row(fin, B).get_by_role('button', name='Hide rows').click(); time.sleep(.3)
        check('rejected C: "not applied" in rows', True, 'not applied' in view_rows(fin, Cb))
        row(fin, Cb).get_by_role('button', name='Hide rows').click(); time.sleep(.3)
        check('no Undo on a not-applied batch', 0, row(fin, A).get_by_role('button', name='Undo').count())

        print('\n— finance approves A → "Approved" badge + tooltip, rows applied, undo in salary-change words —')
        check('finance approves A', 200, http('POST', f'/api/bulk/batches/{A}/approve', ftok, {})[0])
        fin.reload(); fin.wait_for_load_state('networkidle'); time.sleep(.8)
        badge = row(fin, A).locator('[data-status]')
        check('A badge reads "Approved" (status applied)', ('Approved', 'applied'), (badge.inner_text().strip(), badge.get_attribute('data-status')))
        check('A badge tooltip "Approved by finance on …"', True, (badge.get_attribute('title') or '').startswith('Approved by finance on '))
        check('waiting line gone', 0, fin.locator('[data-testid=bulk-waiting-note]').count())
        txt = view_rows(fin, A)
        check('A rows: applied', True, '· applied' in txt and 'waiting for finance' not in txt)
        row(fin, A).get_by_role('button', name='Hide rows').click(); time.sleep(.3)
        row(fin, A).get_by_role('button', name='Undo').click(); time.sleep(.6)
        dlg = fin.get_by_role('dialog'); dtxt = dlg.inner_text()
        check('undo prompt: salary change(s) + old gross + Stage 7', True, 'salary change(s)' in dtxt and 'old gross' in dtxt and 'Stage 7' in dtxt)
        check('undo prompt has no ED wording', False, 'grant(s)' in dtxt)
        dlg.locator('input, textarea').first.fill('redo with the full list'); time.sleep(.4)
        dlg.get_by_role('button', name='Undo batch').click(); time.sleep(1.2)
        check('toast "salary change(s) reversed"', True, fin.get_by_text(f'Batch #{A} undone — 2 salary change(s) reversed').count() > 0)
        check('A badge Undone', 'Undone', row(fin, A).locator('[data-status]').inner_text().strip())
        check('gross back after undo (20000 / 30000)', [(20000.0,), (30000.0,)], q("SELECT gross_salary FROM employees WHERE code IN ('T9501','T9502') ORDER BY code"))
        check('A rows: undone', True, '· undone' in view_rows(fin, A))

        print('\n— finance at 390 px —')
        f390 = login('finance', width=390); open_sr(f390)
        check('390: list shown', 1, lst(f390).count())
        check('390: no sideways page scroll', True, f390.evaluate('document.documentElement.scrollWidth') <= 391)

        print('\n— hr: list inside the panel only, no Undo —')
        stop(); start()  # login limiter
        hr = login('hr'); open_sr(hr)
        check('hr: no list before opening the panel', 0, lst(hr).count())
        hr.locator('[data-testid=sr-bulk-open]').click(); hr.wait_for_selector('[data-testid=bulk-batch-list]'); time.sleep(.6)
        check('hr: list shows in the panel', 1, lst(hr).count())
        check('hr: no Undo buttons on revision batches', 0, lst(hr).get_by_role('button', name='Undo').count())

        print('\n— hr: Extra Duty list keeps its wording —')
        hr.goto(BASE + '/extra-duty-grants'); hr.wait_for_load_state('networkidle'); time.sleep(1)
        heads = lst(hr).locator('thead').inner_text().upper()
        check('ED headers: Saved + Saved rows', (True, True, False), ('SAVED' in heads, 'SAVED ROWS' in heads, 'REVISIONS' in heads))
        check('ED badge "Applied"', 'Applied', row(hr, ED).locator('[data-status]').inner_text().strip())
        txt = view_rows(hr, ED)
        check('ED rows say "created", no ₹', (True, False), ('· created' in txt, '₹' in txt))
        row(hr, ED).get_by_role('button', name='Undo').click(); time.sleep(.6)
        dtxt = hr.get_by_role('dialog').inner_text()
        check('ED undo prompt keeps grant wording', True, 'grant(s) this batch saved' in dtxt)
        hr.get_by_role('dialog').get_by_role('button', name='Cancel').click(); time.sleep(.4)

        print('\n— Errors —')
        check('0 page errors', [], errs)
        check('0 unexpected API >= 400 (browser)', [], bad)
        check('0 console errors', [], [c for c in cerrs if 'favicon' not in c and 'vite.svg' not in c])
        drift = q('SELECT COUNT(*) FROM salary_computations WHERE ABS(net_salary - (gross_earned - total_deductions)) > 1')[0][0]
        check('drift query = 0 rows', 0, drift)
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
