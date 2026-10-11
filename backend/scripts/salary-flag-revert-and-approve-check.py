#!/usr/bin/env python3
"""N-MONEY check (N-16 + N-17): real server.js, real logins, scratch DATA_DIR, fictional data only (codes T23xx).

N-16 (API, real JWTs from /api/auth/login):
  hr / viewer → 403 on approve-flag and bulk-approve; finance bulk REJECT of a GROSS_STRUCTURE_CHANGE flag reverts
  employees.gross_salary + the latest structure and writes finance_rejections + audit like the single route;
  a flag whose employee gross moved since → 409, nothing written.
N-17 (Chromium against the BUILT dist, finance on Salary Input → Pending Approvals):
  T2301 Salary Input request (no special key) on a structure with special ₹2,000 → special kept with the note,
        write-gross ₹22,000 highlighted against the request's ₹20,000.
  T2302 Employee Master request (no conveyance key) → conveyance ₹1,000 kept (not ₹0), gross not highlighted.
  T2303 Salary Input request with conveyance 0 → ₹0, no note.
  Approve T2302 in the UI → DB conveyance 1000, gross 18000. 390px, 0 page/console errors, 0 unexpected API ≥ 400.
Base (--base, an origin/main build): bulk reject leaves gross unchanged; T2302 conveyance shows ₹0.

Usage:  python3 backend/scripts/salary-flag-revert-and-approve-check.py
        APP_ROOT=<origin/main worktree with built dist> python3 backend/scripts/salary-flag-revert-and-approve-check.py --base
Needs `npm run build --prefix frontend` in APP_ROOT first. PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers. PORT default 3132.
"""
import json, os, re, sqlite3, subprocess, sys, tempfile, time, urllib.request, urllib.error
from playwright.sync_api import sync_playwright

HERE_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
ROOT = os.path.abspath(os.environ.get('APP_ROOT', HERE_ROOT))
BASE_MODE = '--base' in sys.argv
PORT = int(os.environ.get('PORT', '3132')); BASE = f'http://127.0.0.1:{PORT}'
WORK = tempfile.mkdtemp(prefix='nmoney-'); DB = os.path.join(WORK, 'hr_system.db')
C = 'Asian Lakto Ind Ltd'
PW = {'admin': 'Admin@123', 'hr': 'Indriyan@2025', 'finance': 'Finance@2025', 'viewer1': 'Viewer@2025x'}
PASS = FAIL = 0


def check(label, expected, actual):
    global PASS, FAIL
    if expected == actual: PASS += 1; print(f'  ✓ {label}')
    else: FAIL += 1; print(f'  ✗ {label} — expected {expected!r}, got {actual!r}')


def q(sql, args=()):
    c = sqlite3.connect(DB); r = c.execute(sql, args).fetchall(); c.commit(); c.close(); return r


def emp(code, gross, s):
    """s = (basic, da, hra, conveyance, special, other)"""
    c = sqlite3.connect(DB)
    c.execute("INSERT INTO employees(code,name,department,company,status,employment_type,gross_salary) "
              "VALUES(?,?,'TEST DEPT',?,'Active','Permanent',?)", (code, f'TEST EMP {code}', C, gross))
    eid = c.execute('SELECT id FROM employees WHERE code=?', (code,)).fetchone()[0]
    c.execute("INSERT INTO salary_structures(employee_id,effective_from,gross_salary,basic,da,hra,conveyance,special_allowance,other_allowances) "
              "VALUES(?, '2025-01-01', ?, ?, ?, ?, ?, ?, ?)", (eid, gross, *s))
    c.commit(); c.close(); return eid


def flag(code, old, new):
    c = sqlite3.connect(DB)
    fid = c.execute("INSERT INTO salary_manual_flags (employee_code, month, year, flag_type, field_name, system_value, manual_value, delta, changed_by, notes) "
                    "VALUES (?, 9, 2026, 'GROSS_STRUCTURE_CHANGE', 'gross_salary', ?, ?, ?, 'system', 'synthetic')", (code, old, new, new - old)).lastrowid
    c.commit(); c.close(); return fid


def api(method, path, token, body=None):
    req = urllib.request.Request(BASE + path, method=method, data=json.dumps(body or {}).encode(),
                                 headers={'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b'{}')


def token(user):
    req = urllib.request.Request(BASE + '/api/auth/login', data=json.dumps({'username': user, 'password': PW[user]}).encode(),
                                 headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read())['token']


def login(b, user, width=1440):
    ctx = b.new_context(viewport={'width': width, 'height': 900})
    pg = ctx.new_page()
    errs, cons, bad = [], [], []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('console', lambda m: cons.append(m.text) if m.type == 'error' and 'vite.svg' not in m.text else None)
    pg.on('response', lambda r: bad.append(f'{r.status} {r.request.method} {r.url}') if '/api/' in r.url and r.status >= 400 else None)
    pg.goto(BASE + '/login'); pg.get_by_placeholder('admin').fill(user); pg.get_by_placeholder('••••••••').fill(PW[user])
    pg.get_by_role('button', name='Sign in').click(); pg.wait_for_url(lambda u: '/login' not in u)
    return pg, errs, cons, bad


def open_pending(pg):
    pg.goto(BASE + '/salary-input'); pg.wait_for_load_state('networkidle'); time.sleep(.5)
    pg.get_by_role('button', name=re.compile('^Pending Approvals')).click(); pg.wait_for_load_state('networkidle'); time.sleep(.8)


def card(pg, code):
    return pg.locator('div.card.border-l-4', has_text=f'({code})').first


def row(cd, comp):
    tr = cd.locator(f'tr[data-component={comp}]')
    return tr.evaluate("""tr => { const td = tr.querySelectorAll('td');
        return [td[2].innerText.replace(/[▲▼]/g,'').trim(), tr.dataset.changed === '1',
                (tr.querySelector('[data-testid=missing-note]') || {}).innerText || ''] }""")


env = dict(os.environ, DATA_DIR=WORK, JWT_SECRET='x', PORT=str(PORT), NODE_ENV='production',
           ADMIN_PASSWORD=PW['admin'], HR_PASSWORD=PW['hr'], FINANCE_PASSWORD=PW['finance'])
srv = subprocess.Popen(['node', f'{ROOT}/backend/server.js'], env=env, stdout=open(f'{WORK}/log', 'w'), stderr=subprocess.STDOUT)
try:
    for _ in range(80):
        try: urllib.request.urlopen(BASE + '/api/version', timeout=2); break
        except Exception: time.sleep(.5)
    print(f'App root: {ROOT}  mode: {"BASE" if BASE_MODE else "fix"}')
    adm = token('admin')
    st, _ = api('POST', '/api/auth/users', adm, {'username': 'viewer1', 'password': PW['viewer1'], 'role': 'viewer'})
    if st >= 400:
        print('  (could not create viewer via API — viewer checks skipped)', st)
    hr = token('hr'); fin = token('finance')
    try: vw = token('viewer1')
    except Exception: vw = None

    print('\n— N-16: flags —')
    emp('T2311', 18000, (9000, 0, 3600, 1000, 0, 4400)); f1 = flag('T2311', 15000, 18000)
    emp('T2312', 18000, (9000, 0, 3600, 1000, 0, 4400)); f2 = flag('T2312', 15000, 18000)
    emp('T2313', 21000, (10500, 0, 4200, 1000, 0, 5300)); f3 = flag('T2313', 15000, 18000)  # gross moved since
    if not BASE_MODE:
        for who, tk in (('hr', hr), ('viewer', vw)):
            if not tk: continue
            check(f'{who}: approve-flag 403', 403, api('PUT', f'/api/finance-audit/approve-flag/{f1}', tk, {'status': 'REJECTED'})[0])
            check(f'{who}: bulk-approve 403', 403, api('PUT', '/api/finance-audit/bulk-approve', tk, {'flagIds': [f1], 'status': 'REJECTED'})[0])
        check('after 403s: T2311 gross untouched', 18000, q("SELECT gross_salary FROM employees WHERE code='T2311'")[0][0])
    st, r = api('PUT', '/api/finance-audit/bulk-approve', fin, {'flagIds': [f1], 'status': 'REJECTED', 'comments': 'synthetic'})
    check('finance bulk reject 200', 200, st)
    g1 = q("SELECT gross_salary FROM employees WHERE code='T2311'")[0][0]
    s1 = q("SELECT s.gross_salary FROM salary_structures s JOIN employees e ON e.id=s.employee_id WHERE e.code='T2311' ORDER BY s.id DESC LIMIT 1")[0][0]
    if BASE_MODE:
        check('old code: bulk reject leaves gross at 18000', 18000, g1)
    else:
        check('bulk reject reverted employee gross to 15000', 15000, g1)
        check('bulk reject reverted structure gross to 15000', 15000, s1)
        check('finance_rejections row', 1, q("SELECT COUNT(*) FROM finance_rejections WHERE source_table='salary_manual_flags' AND source_record_id=?", (f1,))[0][0])
        check('audit FINANCE_FLAG_REJECT + FINANCE_GROSS_REVERT', 2, q("SELECT COUNT(*) FROM audit_log WHERE stage IN ('FINANCE_FLAG_REJECT','FINANCE_GROSS_REVERT') AND (record_id=? OR remark LIKE '%T2311%')", (str(f1),))[0][0])
        st, r = api('PUT', '/api/finance-audit/bulk-approve', fin, {'flagIds': [f2, f3], 'status': 'REJECTED', 'comments': 'synthetic'})
        check('moved gross in batch → 409 GROSS_MOVED_SINCE', (409, 'GROSS_MOVED_SINCE'), (st, r.get('code')))
        check('whole batch unwritten (T2312 still 18000, flag pending)', (18000, 0),
              (q("SELECT gross_salary FROM employees WHERE code='T2312'")[0][0], q('SELECT finance_approved FROM salary_manual_flags WHERE id=?', (f2,))[0][0]))

    print('\n— N-17: approver card —')
    emp('T2301', 22000, (10000, 0, 4000, 1600, 2000, 4400))
    emp('T2302', 15000, (7500, 0, 3000, 1000, 0, 3500))
    emp('T2303', 15000, (7500, 0, 3000, 1000, 0, 3500))
    st, _ = api('POST', '/api/salary-input/request-change', hr, {'employeeCode': 'T2301', 'reason': 'synthetic',
            'newStructure': {'basic': 10000, 'da': 0, 'hra': 4000, 'conveyance': 1600, 'other_allowances': 4400}})
    check('hr raises T2301 (Salary Input, no special key)', 200, st)
    st, r = api('PUT', '/api/employees/T2302/salary', hr, {'gross_salary': 18000, 'basic_percent': 50, 'hra_percent': 20,
            'da_percent': 0, 'special_allowance_percent': 0, 'other_allowance': 0})
    check('hr raises T2302 (Employee Master, no conveyance key)', (200, True), (st, r.get('pendingApproval')))
    st, _ = api('POST', '/api/salary-input/request-change', hr, {'employeeCode': 'T2303', 'reason': 'synthetic',
            'newStructure': {'basic': 7500, 'da': 0, 'hra': 3000, 'conveyance': 0, 'other_allowances': 3500}})
    check('hr raises T2303 (conveyance sent as 0)', 200, st)

    with sync_playwright() as p:
        b = p.chromium.launch()
        pg, errs, cons, bad = login(b, 'finance')
        open_pending(pg)
        c2 = card(pg, 'T2302')
        if BASE_MODE:
            check('old code: T2302 conveyance proposed ₹0', '₹0', row(c2, 'conveyance')[0])
        else:
            r = row(card(pg, 'T2301'), 'special_allowance')
            check('T2301 special ₹2,000 kept, unchanged, note', ('₹2,000', False, 'not in this request — current value kept'), tuple(r))
            wg = card(pg, 'T2301').get_by_test_id('write-gross')
            check('T2301 write gross ₹22,000, highlighted', ('₹22,000', '1'), (wg.inner_text().replace('▲', '').replace('▼', '').strip(), wg.get_attribute('data-gross-differs')))
            check('T2301 differs note names both grosses', True, '₹20,000' in card(pg, 'T2301').get_by_test_id('gross-differs-note').inner_text())
            check('T2301 differs cell is red', True, wg.evaluate("e => e.className.includes('bg-red-100')"))
            check('T2302 conveyance ₹1,000 kept, unchanged, note', ('₹1,000', False, 'not in this request — current value kept'), tuple(row(c2, 'conveyance')))
            check('T2302 gross not highlighted', '0', c2.get_by_test_id('write-gross').get_attribute('data-gross-differs'))
            check('F5: T2302 amber note — components ₹13,600 vs gross ₹18,000', True,
                  'Components add up to ₹13,600, gross ₹18,000' in c2.get_by_test_id('component-sum-note').inner_text())
            check('F5: T2301 components = gross → no note', 0, card(pg, 'T2301').get_by_test_id('component-sum-note').count())
            check('T2303 conveyance sent 0 → ₹0, changed, no note', ('₹0', True, ''), tuple(row(card(pg, 'T2303'), 'conveyance')))
            check('no card says "approval sets it to 0"', 0, pg.get_by_text('approval sets it to 0').count())

            pg.set_viewport_size({'width': 390, 'height': 900}); time.sleep(.5)
            check('390px: no sideways page scroll', True, pg.evaluate('document.documentElement.scrollWidth') <= 392)
            check('390px: differs note visible', True, card(pg, 'T2301').get_by_test_id('gross-differs-note').is_visible())
            pg.set_viewport_size({'width': 1440, 'height': 900}); time.sleep(.3)

            c2.get_by_role('button', name='Approve').click()
            pg.get_by_text('Salary change approved').first.wait_for(timeout=10000)
            check('DB: T2302 conveyance 1000 kept, gross 18000', (1000, 18000),
                  q("SELECT s.conveyance, s.gross_salary FROM salary_structures s JOIN employees e ON e.id=s.employee_id "
                    "WHERE e.code='T2302' ORDER BY s.effective_from DESC, s.id DESC LIMIT 1")[0])
            check('finance: 0 page errors', [], errs); check('finance: 0 console errors', [], cons); check('finance: 0 API ≥ 400', [], bad)
        b.close()
finally:
    srv.terminate(); srv.wait()

print(f'\n{PASS} passed, {FAIL} failed')
sys.exit(1 if FAIL else 0)
