#!/usr/bin/env python3
"""Q-B6 — gross flags finance already approved through a salary change request are not asked again. Browser check.

Chromium against the BUILT dist, real finance + hr logins, scratch DATA_DIR, fictional data (codes T94xx, names "TEST EMP n").
  Sep 2026 GROSS_STRUCTURE_CHANGE flags (pending, as Stage 7 writes them):
    T9401 single request #A  hr → approved by admin            → stamped, "With request #A · approved by admin"
    T9402 bulk request #B    hr → approved by admin, batch #K   → stamped, "With bulk batch #K · approved by admin"
    T9403 self-approved legacy (boss → boss)                    → stays pending (Approve / Reject shown)
    T9404 no request                                            → stays pending
    T9405 request gross 18000, flag 18500                       → stays pending
    T9407 approved request, structure effective Oct (after Sep) → stays pending
  Aug 2026 (finalised): T9406 flag + approved request           → untouched
Usage:
  PORT=3503 python3 backend/scripts/gross-flag-preapproval-check.py
  APP_ROOT=/tmp/wt-base PORT=3503 python3 .../gross-flag-preapproval-check.py --base   # origin/main: every flag pending
Needs `npm run build --prefix frontend` in APP_ROOT first. PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers.
"""
import json, os, sqlite3, subprocess, sys, tempfile, time, urllib.request
from playwright.sync_api import sync_playwright

HERE_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
ROOT = os.path.abspath(os.environ.get('APP_ROOT', HERE_ROOT))
BASE_MODE = '--base' in sys.argv
PORT = int(os.environ.get('PORT', '3503')); BASE = f'http://127.0.0.1:{PORT}'
WORK = tempfile.mkdtemp(prefix='qb6-'); DB = os.path.join(WORK, 'hr_system.db')
C = 'Asian Lakto Ind Ltd'
PASS = FAIL = 0


def check(label, expected, actual):
    global PASS, FAIL
    if expected == actual: PASS += 1; print(f'  ✓ {label}')
    else: FAIL += 1; print(f'  ✗ {label} — expected {expected!r}, got {actual!r}')


def q(sql, *a):
    c = sqlite3.connect(DB); r = c.execute(sql, a).fetchall(); c.commit(); c.close(); return r


IDS = {}


def seed():
    c = sqlite3.connect(DB)
    for code, g in (('T9401', 18000), ('T9402', 20000), ('T9403', 18000), ('T9404', 18000), ('T9405', 18500), ('T9406', 18000), ('T9407', 18000)):
        c.execute("INSERT INTO employees(code,name,department,company,status,employment_type,gross_salary) "
                  "VALUES(?,?,'TEST DEPT',?,'Active','Permanent',?)", (code, f'TEST EMP {code[3:]}', C, g))

    def req(code, new, by, appr):
        return c.execute("INSERT INTO salary_change_requests(employee_code,requested_by,old_gross,new_gross,old_structure,new_structure,"
                         "reason,status,approved_by,approved_at) VALUES(?,?,15000,?,'{}','{}','test','Approved',?,datetime('now'))",
                         (code, by, new, appr)).lastrowid
    IDS['A'] = req('T9401', 18000, 'hr', 'admin')
    IDS['B'] = req('T9402', 20000, 'hr', 'admin')
    req('T9403', 18000, 'boss', 'Boss')
    req('T9405', 18000, 'hr', 'admin')
    req('T9406', 18000, 'hr', 'admin')
    req('T9407', 18000, 'hr', 'admin')
    IDS['K'] = c.execute("INSERT INTO bulk_batches(kind,month,year,status,created_by,row_count) VALUES('salary-revision',9,2026,'applied','hr',1)").lastrowid
    c.execute("INSERT INTO bulk_rows(batch_id,row_no,row_key,state,action,target_table,target_id) "
              "VALUES(?,1,'T9402','ok','create','salary_change_requests',?)", (IDS['K'], IDS['B']))
    for code, m, mv in (('T9401', 9, 18000), ('T9402', 9, 20000), ('T9403', 9, 18000), ('T9404', 9, 18000),
                        ('T9405', 9, 18500), ('T9406', 8, 18000), ('T9407', 9, 18000)):
        c.execute("INSERT INTO salary_manual_flags(employee_code,month,year,flag_type,field_name,system_value,manual_value,delta,changed_by,notes) "
                  "VALUES(?,?,2026,'GROSS_STRUCTURE_CHANGE','gross_salary',15000,?,?,'system','Gross changed')", (code, m, mv, mv - 15000))
    c.execute("INSERT INTO monthly_imports(month,year,company,is_finalised) VALUES(8,2026,?,1)", (C,))
    # the structure rows the approvals wrote (review fix 2: effective on or before the flag month end)
    for code, g, eff in (('T9401', 18000, '2026-09-01'), ('T9402', 20000, '2026-09-01'), ('T9403', 18000, '2026-09-01'),
                         ('T9405', 18000, '2026-09-01'), ('T9406', 18000, '2026-08-01'), ('T9407', 18000, '2026-10-01')):
        eid = c.execute('SELECT id FROM employees WHERE code=?', (code,)).fetchone()[0]
        c.execute("INSERT INTO salary_structures(employee_id,effective_from,gross_salary,basic,hra) VALUES(?,?,?,?,?)", (eid, eff, g, g * .5, g * .2))
    c.commit(); c.close()


def appr(code, m=9):
    return q("SELECT finance_approved, approved_by FROM salary_manual_flags WHERE employee_code=? AND month=?", code, m)[0]


def login(ctx, user, pw):
    pg = ctx.new_page()
    errs, bad = [], []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('response', lambda r: bad.append(f'{r.status} {r.url}') if '/api/' in r.url and r.status >= 400 and '/comp-off/' not in r.url else None)
    pg.goto(BASE + '/login'); pg.get_by_placeholder('admin').fill(user); pg.get_by_placeholder('••••••••').fill(pw)
    pg.get_by_role('button', name='Sign in').click(); pg.wait_for_url(lambda u: '/login' not in u)
    return pg, errs, bad


def open_tab(pg, month):
    pg.goto(BASE + '/finance-audit?tab=interventions'); pg.wait_for_load_state('networkidle')
    pg.locator('select').filter(has=pg.locator('option', has_text='September')).first.select_option(str(month))
    time.sleep(.3); pg.reload(); pg.wait_for_load_state('networkidle'); time.sleep(1)


def row(pg, code):
    return pg.locator('table tbody tr', has_text=code).first


def api(pg, path):
    return pg.evaluate("""async (p) => { const r = await fetch(p, { headers: { Authorization: 'Bearer ' + localStorage.getItem('hr_token'), 'Cache-Control': 'no-cache' } });
      return { status: r.status, body: await r.json() } }""", path)


env = dict(os.environ, DATA_DIR=WORK, JWT_SECRET='x', PORT=str(PORT), NODE_ENV='production',
           ADMIN_PASSWORD='Admin@123', HR_PASSWORD='Indriyan@2025', FINANCE_PASSWORD='Finance@2025')


def start():
    s = subprocess.Popen(['node', f'{ROOT}/backend/server.js'], env=env, stdout=open(f'{WORK}/log', 'a'), stderr=subprocess.STDOUT)
    for _ in range(80):
        try: urllib.request.urlopen(BASE + '/api/version', timeout=2); return s
        except Exception: time.sleep(.5)
    return s


srv = start()
try:
    seed()
    print(f'App root: {ROOT}  mode: {"BASE (expect every flag pending)" if BASE_MODE else "fix"}')
    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context(viewport={'width': 1440, 'height': 900})
        pg, errs, bad = login(ctx, 'finance', 'Finance@2025')
        open_tab(pg, 9)
        if BASE_MODE:
            check('old: T9401 (single approved request) still Pending', 'Pending' in row(pg, 'T9401').inner_text(), True)
            check('old: T9402 (bulk revision) still Pending', 'Pending' in row(pg, 'T9402').inner_text(), True)
            check('old: no pre-approved note', 0, pg.locator('[data-testid^=flag-preapproved]').count())
            check('old: DB T9401 pending', 0, appr('T9401')[0])
            rd = api(pg, '/api/finance-audit/readiness-check?month=9&year=2026')
            blk = [x for x in rd['body'].get('data', {}).get('blockers', []) if x['type'] == 'UNAPPROVED_MANUAL_FLAGS']
            check('old: readiness blocker counts all 6 gross flags', 6, blk[0]['count'] if blk else 0)
            b.close()
        else:
            print('\n— finance opens Manual Interventions, Sep 2026 —')
            check('DB T9401 stamped, approved_by = original approver', (1, 'admin'), appr('T9401'))
            check('DB T9402 stamped', (1, 'admin'), appr('T9402'))
            r1 = row(pg, 'T9401').inner_text(); r2 = row(pg, 'T9402').inner_text()
            check('T9401 shows Approved', True, 'Approved' in r1)
            check(f'T9401 note "With request #{IDS["A"]} · approved by admin"', True, f'With request #{IDS["A"]} · approved by admin' in r1)
            check(f'T9402 note "With bulk batch #{IDS["K"]} · approved by admin"', True, f'With bulk batch #{IDS["K"]} · approved by admin' in r2)
            check('T9401 has no Approve/Reject buttons', 0, row(pg, 'T9401').get_by_role('button', name='Reject').count())
            for code, why in (('T9403', 'self-approved'), ('T9404', 'no request'), ('T9405', 'gross differs'), ('T9407', 'approval effective October')):
                t = row(pg, code).inner_text()
                check(f'{code} ({why}) stays Pending with Approve/Reject', (True, 1), ('Pending' in t, row(pg, code).get_by_role('button', name='Reject').count()))
                check(f'{code} DB pending', 0, appr(code)[0])
            check('pre-approved notes on screen = 2', 2, pg.locator('[data-testid^=flag-preapproved]').count())
            print('\n— readiness —')
            rd = api(pg, '/api/finance-audit/readiness-check?month=9&year=2026')
            blk = [x for x in rd['body'].get('data', {}).get('blockers', []) if x['type'] == 'UNAPPROVED_MANUAL_FLAGS']
            check('readiness blocker counts only the 4 still pending', 4, blk[0]['count'] if blk else 0)
            check('audit FLAG_PREAPPROVED rows = 2', 2, q("SELECT COUNT(*) FROM audit_log WHERE stage='FLAG_PREAPPROVED'")[0][0])
            pg.reload(); pg.wait_for_load_state('networkidle'); time.sleep(.8)
            check('second read writes nothing more', 2, q("SELECT COUNT(*) FROM finance_approvals")[0][0])
            print('\n— finalised August untouched —')
            open_tab(pg, 8)
            check('T9406 (Aug, finalised) DB still pending', 0, appr('T9406', 8)[0])
            check('T9406 Aug no note', 0, pg.locator('[data-testid^=flag-preapproved]').count())
            print('\n— finance rejects a stamped flag via the API → gross put back as today —')
            fid = q("SELECT id FROM salary_manual_flags WHERE employee_code='T9401' AND month=9")[0][0]
            rr = pg.evaluate("""async (id) => { const r = await fetch('/api/finance-audit/approve-flag/' + id, { method: 'PUT',
              headers: { Authorization: 'Bearer ' + localStorage.getItem('hr_token'), 'Content-Type': 'application/json' },
              body: JSON.stringify({ status: 'REJECTED', comments: 'check reject' }) }); return { s: r.status, b: await r.json() } }""", fid)
            check('reject → 200 reverted', (200, True), (rr['s'], rr['b'].get('reverted')))
            check('T9401 gross back to 15000', 15000.0, q("SELECT gross_salary FROM employees WHERE code='T9401'")[0][0])
            check('request #A Reverted', 'Reverted', q('SELECT status FROM salary_change_requests WHERE id=?', IDS['A'])[0][0])
            print('\n— 390 px —')
            m = b.new_context(viewport={'width': 390, 'height': 844}); pm, e2, b2 = login(m, 'finance', 'Finance@2025')
            open_tab(pm, 9)
            check('390: T9402 note visible', True, pm.locator('[data-testid^=flag-preapproved]').first.is_visible())
            check('390: no page errors', [], e2)
            check('page errors', [], errs)
            check('API errors ≥ 400', [], bad)
            b.close()
    srv.terminate(); srv.wait()
    if not BASE_MODE:
        srv = start()
        with sync_playwright() as p:
            b = p.chromium.launch(); ctx = b.new_context(viewport={'width': 1440, 'height': 900})
            print('\n— hr opens the tab (reader of another role) —')
            pg, errs, bad = login(ctx, 'hr', 'Indriyan@2025')
            open_tab(pg, 9)
            check('hr sees T9402 note', True, 'With bulk batch' in row(pg, 'T9402').inner_text())
            check('hr: still no new stamps (T9403-5, T9407 pending)', [0, 0, 0, 0], [appr(c_)[0] for c_ in ('T9403', 'T9404', 'T9405', 'T9407')])
            check('hr: page errors', [], errs)
            b.close()
finally:
    srv.terminate()
print(f'\n{PASS} passed, {FAIL} failed')
sys.exit(1 if FAIL else 0)
