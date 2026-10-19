#!/usr/bin/env python3
"""FRESH-2 — Finance Audit reads are no-cache and every decision refreshes exactly what it changed — browser check.

Chromium against the BUILT dist, real finance / admin / hr logins, scratch DATA_DIR, fictional data only (codes T96xx,
names "TEST FRESH2 n"). Current month.

Checks (fix):
  - the 10 Finance Audit reads go out with Cache-Control: no-cache
  - Manual Interventions approve → row + tab badge update at once; re-reads salary-manual-flags; does NOT re-read
    unrelated lists (/settings/companies, /late-coming, /comp-off, /early-exit, /leave-requests) — the bare-array fix
  - Late Coming approve → pending row gone + badge at once; no /comp-off or /settings/companies re-read
  - Comp Off approve → pending row gone + badge; Readiness is re-read when its tab is opened again (< 30 s staleTime)
  - Early Exit approve → the PAGE badge drops at once (Q2)
  - Report day correction → drill-down "Correction History" and the Manual Interventions badge update without reload (Q1)
  - admin: Corrections Summary read no-cache; hr: page opens, 0 page errors; 390 px; 0 page errors / 0 API ≥ 400
  - static: 0 bare-array invalidateQueries([ in FinanceAudit.jsx
--base (origin/main tree): records the old behaviour (no no-cache, unrelated re-reads, stale early-exit + interventions
  badges, 18 bare-array calls) — every one of those is asserted, so the fix checks would FAIL there.

Usage:
  PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers PORT=3503 python3 backend/scripts/finance-audit-fresh-check.py
  APP_ROOT=/tmp/wt-base PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers PORT=3503 python3 backend/scripts/finance-audit-fresh-check.py --base
Needs `npm run build --prefix frontend` in APP_ROOT first.
"""
import datetime, os, re, sqlite3, subprocess, sys, tempfile, time, urllib.request
from playwright.sync_api import sync_playwright

HERE_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
ROOT = os.path.abspath(os.environ.get('APP_ROOT', HERE_ROOT))
BASE_MODE = '--base' in sys.argv
PORT = int(os.environ.get('PORT', '3503')); BASE = f'http://127.0.0.1:{PORT}'
WORK = tempfile.mkdtemp(prefix='fresh2-'); DB = os.path.join(WORK, 'hr_system.db')
C = 'Asian Lakto Ind Ltd'
TODAY = datetime.date.today(); M, Y = TODAY.month, TODAY.year
D1, D2 = f'{Y}-{M:02d}-02', f'{Y}-{M:02d}-03'
PASS = FAIL = 0
PW = {'hr': 'Indriyan@2025', 'finance': 'Finance@2025', 'admin': 'Admin@123'}
UNRELATED = ('/settings/companies', '/late-coming/', '/comp-off', '/early-exit-deductions', '/leave-requests')
FRESH_PATHS = {
    'report': '/finance-audit/report', 'correction-history': '/finance-audit/corrections/T9601',
    'salary-manual-flags': '/finance-audit/salary-manual-flags', 'readiness': '/finance-audit/readiness-check',
    'late-finance-pending': '/late-coming/finance-pending', 'early-exit-pending': '/early-exit-deductions/finance/pending',
    'early-exit-list': '/early-exit-deductions', 'comp-off-pending': '/comp-off/pending', 'comp-off-list': '/comp-off',
}


def check(label, expected, actual):
    global PASS, FAIL
    if expected == actual: PASS += 1; print(f'  ✓ {label}')
    else: FAIL += 1; print(f'  ✗ {label} — expected {expected!r}, got {actual!r}')


def q(sql, *a):
    c = sqlite3.connect(DB); r = c.execute(sql, a).fetchall(); c.close(); return r


def ex(sql, *a):
    c = sqlite3.connect(DB); cur = c.execute(sql, a); c.commit(); rid = cur.lastrowid; c.close(); return rid


def seed():
    for n in range(1, 7):
        ex("INSERT OR IGNORE INTO employees(code,name,department,company,status,employment_type,gross_salary) "
           "VALUES(?,?,'TEST DEPT',?,'Active','Permanent',26000)", f'T960{n}', f'TEST FRESH2 {n}', C)
    # Report + day correction (T9601)
    ex("INSERT INTO day_calculations(employee_code,month,year,company,total_payable_days) VALUES('T9601',?,?,?,26)", M, Y, C)
    ex("INSERT INTO salary_computations(employee_code,month,year,company,gross_salary,gross_earned,total_deductions,net_salary,payable_days) "
       "VALUES('T9601',?,?,?,26000,26000,0,26000,26)", M, Y, C)
    # Manual Interventions (T9601, T9602)
    for code in ('T9601', 'T9602'):
        ex("INSERT INTO salary_manual_flags(employee_code,month,year,flag_type,field_name,system_value,manual_value,delta,changed_by,finance_approved) "
           "VALUES(?,?,?,'MANUAL_TDS','tds',0,500,500,'hr',0)", code, M, Y)
    # Late Coming (T9603, T9604)
    for code in ('T9603', 'T9604'):
        ex("INSERT INTO late_coming_deductions(employee_code,month,year,company,late_count,deduction_days,remark,applied_by,finance_status) "
           "VALUES(?,?,?,?,6,1,'Test late remark','hr','pending')", code, M, Y, C)
    # Comp Off (T9605, T9606)
    for code, d in (('T9605', D1), ('T9606', D2)):
        ex("INSERT INTO compensatory_off_requests(employee_code,start_date,end_date,days,month,year,company,reason,hr_remark,applied_by) "
           "VALUES(?,?,?,1,?,?,?,'Test reason','Test HR remark','hr')", code, d, d, M, Y, C)
    # Early Exit (T9603, T9604)
    for code in ('T9603', 'T9604'):
        det = ex("INSERT INTO early_exit_detections(employee_code,employee_name,department,company,date,shift_code,shift_end_time,"
                 "actual_punch_out_time,minutes_early,flagged_minutes) VALUES(?,?,'TEST DEPT',?,?,'12HR','20:00','18:00',120,120)",
                 code, code, C, D1)
        ex("INSERT INTO early_exit_deductions(early_exit_detection_id,employee_code,employee_name,department,company,date,deduction_type,"
           "deduction_amount,payroll_month,payroll_year,hr_remark,submitted_by_name,finance_status) "
           "VALUES(?,?,?,'TEST DEPT',?,?,'half_day',500,?,?,'Test early remark','hr','pending')", det, code, code, C, D1, M, Y)


def login(b, user, width=1440):
    ctx = b.new_context(viewport={'width': width, 'height': 900})
    pg = ctx.new_page()
    st = {'errs': [], 'bad': [], 'reqs': []}
    pg.on('pageerror', lambda e: st['errs'].append(str(e)))
    pg.on('response', lambda r: st['bad'].append(f'{r.status} {r.url}') if '/api/' in r.url and r.status >= 400
          and 'session-analytics' not in r.url
          and not (user == 'hr' and r.url.split('?')[0].endswith('/comp-off/pending')) else None)

    def on_req(r):
        if '/api/' in r.url:
            path = r.url.split('/api', 1)[1].split('?')[0]
            st['reqs'].append((time.monotonic(), r.method, path, r.headers.get('cache-control') or ''))
    pg.on('request', on_req)
    pg.goto(BASE + '/login'); pg.get_by_placeholder('admin').fill(user); pg.get_by_placeholder('••••••••').fill(PW[user])
    pg.get_by_role('button', name='Sign in').click(); pg.wait_for_url(lambda u: '/login' not in u)
    pg.goto(BASE + '/finance-audit'); pg.wait_for_load_state('networkidle'); pg.wait_for_timeout(800)
    return pg, ctx, st


def tab(pg, label):
    pg.locator('div.border-b button', has_text=label).first.click(); pg.wait_for_timeout(900)


def badge(pg, label):
    t = pg.locator('div.border-b button', has_text=label).first.inner_text()
    digits = ''.join(ch for ch in t.replace(label, '') if ch.isdigit())
    return int(digits) if digits else 0


def gets_after(st, t0, sub, within=2.0):
    return [r for r in st['reqs'] if r[1] == 'GET' and r[0] >= t0 and r[0] - t0 <= within and sub in r[2]]


def gets_any(st, sub, exact=False):
    return [r for r in st['reqs'] if r[1] == 'GET' and (r[2] == sub if exact else sub in r[2])]


def row(pg, code):
    return pg.locator('tbody tr', has_text=code).first


def dialog(pg):
    return pg.get_by_role('dialog').last


def quiet(pg):
    pg.wait_for_timeout(5600)   # past the server's 5 s GET cache: a re-read now has to hit the network


env = dict(os.environ, DATA_DIR=WORK, JWT_SECRET='x', PORT=str(PORT), NODE_ENV='production',
           ADMIN_PASSWORD=PW['admin'], HR_PASSWORD=PW['hr'], FINANCE_PASSWORD=PW['finance'])
srv = subprocess.Popen(['node', f'{ROOT}/backend/server.js'], env=env, stdout=open(f'{WORK}/log', 'w'), stderr=subprocess.STDOUT)
try:
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    for _ in range(240):
        try:
            if opener.open(BASE + '/api/version', timeout=2).status == 200 and 'running on' in open(f'{WORK}/log').read(): break
        except Exception: pass
        time.sleep(.5)
    seed()
    src = open(f'{ROOT}/frontend/src/pages/FinanceAudit.jsx').read()
    bare = len(re.findall(r'invalidateQueries\(\[', src))
    print(f'App root: {ROOT}  mode: {"BASE (expect the old behaviour)" if BASE_MODE else "fix"}  month {M}/{Y}')
    check('static: bare-array invalidateQueries([ in FinanceAudit.jsx', 18 if BASE_MODE else 0, bare)

    with sync_playwright() as p:
        b = p.chromium.launch()
        print('\n— finance —')
        pg, ctx, st = login(b, 'finance')
        pg.get_by_text('Loading readiness check...').wait_for(state='detached', timeout=15000)

        # ── Manual Interventions ──
        tab(pg, 'Manual Interventions'); row(pg, 'T9602').wait_for(timeout=15000)
        b0 = badge(pg, 'Manual Interventions')
        quiet(pg)
        t0 = time.monotonic()
        row(pg, 'T9601').get_by_role('button', name='Approve', exact=True).click()
        pg.wait_for_timeout(2000)
        b1 = badge(pg, 'Manual Interventions')
        unrelated = sorted({r[2] for r in st['reqs'] if r[1] == 'GET' and r[0] >= t0 and any(u in r[2] for u in UNRELATED)})
        smf = gets_after(st, t0, '/finance-audit/salary-manual-flags')
        check('interventions: DB flag approved', [(1,)], q("SELECT finance_approved FROM salary_manual_flags WHERE employee_code='T9601'"))
        if BASE_MODE:
            check('old: unrelated lists re-read after an approve (bare array = everything)', True, len(unrelated) >= 2)
            check('old: salary-manual-flags read without no-cache', True, all('no-cache' not in r[3] for r in gets_any(st, '/finance-audit/salary-manual-flags')))
        else:
            check('interventions: badge 2 → 1 at once', (2, 1), (b0, b1))
            check('interventions: salary-manual-flags re-read, no-cache', (True, True), (len(smf) >= 1, all('no-cache' in r[3] for r in smf)))
            check('interventions: no unrelated list re-read', [], unrelated)

        # ── Late Coming ──
        tab(pg, 'Late Coming'); row(pg, 'T9604').wait_for(timeout=15000)
        lb0 = badge(pg, 'Late Coming')
        quiet(pg)
        t0 = time.monotonic()
        row(pg, 'T9603').get_by_role('button', name='Approve', exact=True).click(); pg.wait_for_timeout(500)
        dialog(pg).get_by_role('button', name='Submit').click(); pg.wait_for_timeout(2000)
        lb1 = badge(pg, 'Late Coming')
        unrelated = sorted({r[2] for r in st['reqs'] if r[1] == 'GET' and r[0] >= t0 and any(u in r[2] for u in ('/settings/companies', '/comp-off', '/early-exit-deductions'))})
        lfp = gets_after(st, t0, '/late-coming/finance-pending')
        check('late: DB row approved', [('approved',)], q("SELECT finance_status FROM late_coming_deductions WHERE employee_code='T9603'"))
        if BASE_MODE:
            check('old: unrelated lists re-read after a late approve', True, len(unrelated) >= 1)
        else:
            check('late: badge 2 → 1 and T9603 gone from pending', (2, 1, 0),
                  (lb0, lb1, pg.locator('tbody tr', has_text='T9603').get_by_role('button', name='Approve', exact=True).count()))
            check('late: finance-pending re-read, no-cache', (True, True), (len(lfp) >= 1, all('no-cache' in r[3] for r in lfp)))
            check('late: no unrelated list re-read', [], unrelated)

        # ── Comp Off (and Readiness re-read) ──
        tab(pg, 'Readiness'); pg.wait_for_timeout(500)       # readiness data fresh in the cache now
        tab(pg, 'Comp Off'); row(pg, 'T9606').wait_for(timeout=15000)
        cb0 = badge(pg, 'Comp Off')
        quiet(pg)
        t0 = time.monotonic()
        row(pg, 'T9605').get_by_role('button', name='Approve', exact=True).click(); pg.wait_for_timeout(500)
        dialog(pg).locator('textarea').fill('Checked OD register')
        dialog(pg).get_by_role('button', name='Confirm Approval').click(); pg.wait_for_timeout(2000)
        cb1 = badge(pg, 'Comp Off')
        cop = gets_after(st, t0, '/comp-off/pending')
        check('comp-off: DB row approved', [('approved',)], q("SELECT finance_status FROM compensatory_off_requests WHERE employee_code='T9605'"))
        t1 = time.monotonic()
        tab(pg, 'Readiness'); pg.wait_for_timeout(1200)
        rd = gets_after(st, t1, '/finance-audit/readiness-check', within=3)
        if BASE_MODE:
            check('old: comp-off pending read without no-cache', True, all('no-cache' not in r[3] for r in gets_any(st, '/comp-off/pending')))
        else:
            check('comp-off: badge 2 → 1 at once', (2, 1), (cb0, cb1))
            check('comp-off: pending re-read, no-cache', (True, True), (len(cop) >= 1, all('no-cache' in r[3] for r in cop)))
            check('comp-off: Readiness re-read when its tab opens again (Q2), no-cache', (True, True), (len(rd) >= 1, all('no-cache' in r[3] for r in rd)))

        # ── Early Exit (page badge, Q2) ──
        tab(pg, 'Early Exit'); row(pg, 'T9604').wait_for(timeout=15000)
        eb0 = badge(pg, 'Early Exit')
        t0 = time.monotonic()
        row(pg, 'T9603').get_by_role('button', name='Approve', exact=True).click(); pg.wait_for_timeout(600)
        dialog(pg).get_by_role('button', name='Approve').click(); pg.wait_for_timeout(2500)
        eb1 = badge(pg, 'Early Exit')
        check('early exit: DB row approved', [('approved',)], q("SELECT finance_status FROM early_exit_deductions WHERE employee_code='T9603'"))
        if BASE_MODE:
            check('old: early-exit page badge still 2 after the approve (stale up to 60 s)', (2, 2), (eb0, eb1))
        else:
            check('early exit: page badge 2 → 1 at once', (2, 1), (eb0, eb1))
        pg.get_by_role('button', name='Approved').first.click(); pg.wait_for_timeout(1500)

        # ── Report: day correction (Q1) ──
        tab(pg, 'Finance Report'); row(pg, 'T9601').wait_for(timeout=15000)
        mi0 = badge(pg, 'Manual Interventions')
        row(pg, 'T9601').click(); pg.wait_for_timeout(1500)   # drill-down loads correction history (staleTime 60 s)
        had_hist = pg.get_by_text('Correction History').count()
        row(pg, 'T9601').get_by_role('button', name='Correct').click(); pg.wait_for_timeout(500)
        dialog(pg).get_by_placeholder('e.g. 22').fill('24')
        dialog(pg).locator('select').select_option('Gate register mismatch')
        dialog(pg).get_by_role('button', name='Save Correction').click(); pg.wait_for_timeout(2500)
        hist = pg.get_by_text('Correction History').count()
        mi1 = badge(pg, 'Manual Interventions')
        check('correction: DB day_corrections row 26 → 24', [(26.0, 24.0)], q("SELECT original_system_days, corrected_days FROM day_corrections WHERE employee_code='T9601'"))
        if BASE_MODE:
            check('old: drill-down history and interventions badge stay stale', (0, mi0), (hist, mi1))
        else:
            check('correction: drill-down shows Correction History without reload', (0, 1), (had_hist, hist))
            check('correction: Manual Interventions badge +1 (live day-correction row) at once', mi0 + 1, mi1)

        if not BASE_MODE:
            for k, path in FRESH_PATHS.items():
                rs = gets_any(st, path, exact=(k in ('early-exit-list', 'comp-off-list')))
                check(f'no-cache: {k} ({len(rs)} GETs)', True, len(rs) >= 1 and all('no-cache' in r[3] for r in rs))
            check('finance: 0 page errors', [], st['errs']); check('finance: 0 API ≥ 400', [], st['bad'])
        ctx.close()

        print('\n— admin —')
        pg, ctx, st = login(b, 'admin')
        tab(pg, 'Corrections Summary'); pg.wait_for_timeout(1000)
        cs = gets_any(st, '/finance-audit/corrections-summary')
        check('admin: corrections-summary read ' + ('without no-cache (old)' if BASE_MODE else 'no-cache'),
              True, len(cs) >= 1 and all((('no-cache' not in r[3]) if BASE_MODE else ('no-cache' in r[3])) for r in cs))
        if not BASE_MODE:
            check('admin: 0 page errors', [], st['errs']); check('admin: 0 API ≥ 400', [], st['bad'])
        ctx.close()

        if not BASE_MODE:
            print('\n— hr —')
            pg, ctx, st = login(b, 'hr')
            tab(pg, 'Late Coming'); tab(pg, 'Finance Report')
            check('hr: page opens (Finance Report rows)', True, pg.locator('tbody tr', has_text='T9601').count() >= 1)
            check('hr: 0 page errors', [], st['errs']); check('hr: 0 API ≥ 400 (known /comp-off/pending 403 aside)', [], st['bad'])
            ctx.close()

            print('\n— finance, phone 390 px —')
            pg, ctx, st = login(b, 'finance', width=390)
            tab(pg, 'Late Coming')
            check('390px: Late Coming pending row renders', True, pg.locator('tbody tr', has_text='T9604').count() >= 1)
            check('390px: no sideways page scroll', True, pg.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1'))
            check('390px: 0 page errors', [], st['errs'])
            ctx.close()
        b.close()
finally:
    srv.terminate()
print(f'\n{PASS} passed, {FAIL} failed')
sys.exit(1 if FAIL else 0)
