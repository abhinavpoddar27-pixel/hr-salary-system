#!/usr/bin/env python3
"""P4-NEXT browser check: next-step links (P4-02), DW finance counts (P4-04), sales blockers before compute +
upload Confirm reason + Go to Compute (P4-05), Loans "Approved — to disburse" tile (P4-07), Salary Explainer button
not covering row buttons (N-24).

Chromium against the BUILT dist, scratch DATA_DIR, real hr + finance logins, fictional data only (codes T98xx / S95x,
names "TEST NEXT n", contractor "TEST GANG NEXT" — the repo is public).

  Plant, September 2026 (company Asian Lakto Ind Ltd):
    T9860–T9899  40 miss punches, HR pending (long list for the explainer-overlap check)
    T9852        1 miss punch, finance pending
    T9853        1 confirmed high-confidence night-shift pair (Night Shift "all confirmed" banner)
  Daily wage: 3 pending finance, 2 needs correction, 1 flagged, 2 approved in the last 7 days (IST), 1 approved 20 days ago.
  Sales, November 2026 (Indriyan Beverages Pvt Ltd): S951 (punch P951, gross 20000), S952 (gross 18000),
    S953 (gross 0 → a compute blocker). A coordinator sheet is uploaded in the browser (2 rows: one matches by punch
    no., one does not).
  Loans: 2 approved (to disburse), 1 requested, 1 active.

The Import "waiting on N" line needs an import result; the check intercepts POST /api/import/upload with a
result object (the server's own import is covered by import-month-check.py) — only the rendering is checked here.

Usage:
  python3 backend/scripts/next-step-links-check.py                 # this tree's server + dist
  APP_ROOT=/tmp/base python3 .../next-step-links-check.py --base   # another tree (origin/main): records the old behaviour
Needs `npm run build --prefix frontend` in APP_ROOT first. PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers. Port 3241.
"""
import datetime, json, os, re, sqlite3, subprocess, sys, tempfile, time, urllib.request
from playwright.sync_api import sync_playwright

HERE_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
ROOT = os.path.abspath(os.environ.get('APP_ROOT', HERE_ROOT))
BASE_MODE = '--base' in sys.argv
PORT = int(os.environ.get('PORT', '3241')); BASE = f'http://127.0.0.1:{PORT}'
WORK = tempfile.mkdtemp(prefix='next-links-'); DB = os.path.join(WORK, 'hr_system.db')
C = 'Asian Lakto Ind Ltd'
SCO = 'Indriyan Beverages Pvt Ltd'
PASS = FAIL = 0
IST_TODAY = (datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=5, minutes=30)).date()


def check(label, expected, actual):
    global PASS, FAIL
    if BASE_MODE: label = f'[base] {label}'
    if expected == actual: PASS += 1; print(f'  ✓ {label}')
    else: FAIL += 1; print(f'  ✗ {label} — expected {expected!r}, got {actual!r}')


def want(fix_value, base_value):
    return base_value if BASE_MODE else fix_value


def q(sql, args=()):
    c = sqlite3.connect(DB); r = c.execute(sql, args).fetchall(); c.close(); return r


def emp(c, code, n):
    c.execute("INSERT OR IGNORE INTO employees(code,name,department,company,status,employment_type,gross_salary,"
              "date_of_joining,weekly_off_day) VALUES(?,?,'TEST DEPT',?,'Active','Permanent',20000,'2025-01-01',0)",
              (code, f'TEST NEXT {n}', C))


def seed():
    c = sqlite3.connect(DB)
    c.execute("INSERT OR IGNORE INTO monthly_imports(month,year,company,stage_1_done) VALUES(9,2026,?,1)", (C,))
    for n in range(40):
        code = f'T98{60 + n}'
        emp(c, code, n)
        c.execute("INSERT INTO attendance_processed(employee_code,date,month,year,company,status_original,status_final,"
                  "in_time_original,in_time_final,is_miss_punch,miss_punch_type,miss_punch_resolved) "
                  "VALUES(?,?,9,2026,?,'P','P','09:00','09:00',1,'MISSING_OUT',0)", (code, f'2026-09-{(n % 28) + 1:02d}', C))
    emp(c, 'T9852', 52)
    c.execute("INSERT INTO attendance_processed(employee_code,date,month,year,company,status_original,status_final,"
              "in_time_original,out_time_original,in_time_final,out_time_final,is_miss_punch,miss_punch_type,"
              "miss_punch_resolved,miss_punch_finance_status) VALUES('T9852','2026-09-11',9,2026,?,'P','P','09:00',"
              "NULL,'09:00','18:00',1,'MISSING_OUT',1,'pending')", (C,))
    emp(c, 'T9853', 53)
    i = c.execute("INSERT INTO attendance_processed(employee_code,date,month,year,status_original,status_final,"
                  "in_time_original,in_time_final,out_time_final,is_night_shift,night_pair_date,company) "
                  "VALUES('T9853','2026-09-03',9,2026,'P','P','20:00','20:00','08:00',1,'2026-09-04',?)", (C,)).lastrowid
    o = c.execute("INSERT INTO attendance_processed(employee_code,date,month,year,status_original,status_final,"
                  "out_time_original,is_night_out_only,is_night_shift,night_pair_date,company) "
                  "VALUES('T9853','2026-09-04',9,2026,'P','P','08:00',1,1,'2026-09-03',?)", (C,)).lastrowid
    c.execute("INSERT INTO night_shift_pairs(employee_code,in_record_id,out_record_id,in_date,out_date,in_time,out_time,"
              "calculated_hours,confidence,is_confirmed,is_rejected,month,year,company) "
              "VALUES('T9853',?,?,'2026-09-03','2026-09-04','20:00','08:00',12,'high',1,0,9,2026,?)", (i, o, C))
    # Daily wage
    c.execute("INSERT INTO dw_contractors(contractor_name,current_daily_wage_rate,current_commission_rate,created_by) "
              "VALUES('TEST GANG NEXT',500,50,'test')")
    cid = c.execute("SELECT id FROM dw_contractors WHERE contractor_name='TEST GANG NEXT'").fetchone()[0]
    dw = [('pending_finance', 1), ('pending_finance', 2), ('pending_finance', 3), ('needs_correction', 2),
          ('needs_correction', 4), ('flagged', 5), ('approved', 1), ('approved', 6), ('approved', 20), ('hr_entered', 1)]
    for k, (st, back) in enumerate(dw):
        d = (IST_TODAY - datetime.timedelta(days=back)).isoformat()
        c.execute("INSERT INTO dw_entries(contractor_id,entry_date,in_time,out_time,total_worker_count,wage_rate_applied,"
                  "commission_rate_applied,total_wage_amount,total_commission_amount,total_liability,gate_entry_reference,"
                  "status,created_by) VALUES(?,?,'08:00','17:00',2,500,50,1000,100,1100,?,?,'hr')", (cid, d, f'TGN-{k}', st))
    # Sales master
    for code, name, punch, gross in [('S951', 'TEST REP NEXT A', 'P951', 20000), ('S952', 'TEST REP NEXT B', None, 18000),
                                     ('S953', 'TEST REP NEXT C', None, 0)]:
        c.execute("INSERT INTO sales_employees(code,name,company,status,doj,gross_salary,punch_no,account_no,ifsc,bank_name,"
                  "ta_da_class,da_rate) VALUES(?,?,?,'Active','2025-01-15',?,?,'91009','TEST0000001','TEST BANK',1,100)",
                  (code, name, SCO, gross, punch))
        if gross:
            eid = c.execute("SELECT id FROM sales_employees WHERE code=? AND company=?", (code, SCO)).fetchone()[0]
            c.execute("INSERT INTO sales_salary_structures(employee_id,effective_from,basic,gross_salary) VALUES(?,'2025-01',?,?)",
                      (eid, gross, gross))
    # Loans
    for code, st in [('T9860', 'approved'), ('T9861', 'approved'), ('T9862', 'requested'), ('T9863', 'active')]:
        c.execute("INSERT INTO loans(borrower_type,employee_code,company,loan_type,principal_amount,interest_rate,tenure_months,"
                  "emi_amount,status,requested_by,request_reason) VALUES('plant',?,?,'Personal',12000,0,6,2000,?,'hr','seeded')",
                  (code, C, st))
    c.commit(); c.close()


def make_coordinator_sheet(path):
    script = ("const X=require('xlsx');const wb=X.utils.book_new();"
              "X.utils.book_append_sheet(wb,X.utils.aoa_to_sheet(["
              "['S.No','Sales Person Name','Punch No.','City',\"Day's Given\"],"
              "[1,'TEST REP NEXT A','P951','TESTCITY',20],[2,'TEST SOMEONE NEW',null,'TESTCITY',18]]),'Sheet1');"
              f"X.writeFile(wb,{json.dumps(path)});")
    subprocess.run(['node', '-e', script], cwd=f'{ROOT}/backend', check=True)


def login(b, user, pw, width=1440, store=None):
    ctx = b.new_context(viewport={'width': width, 'height': 900})
    pg = ctx.new_page()
    log = {'errs': [], 'cons': [], 'bad': []}
    pg.on('pageerror', lambda e: log['errs'].append(str(e)))
    pg.on('console', lambda m: log['cons'].append(m.text) if m.type == 'error' and 'vite.svg' not in m.text
          and '404' not in m.text else None)
    pg.on('response', lambda r: log['bad'].append(f'{r.status} {r.url}') if '/api/' in r.url and r.status >= 400 else None)
    pg.goto(BASE + '/login'); pg.get_by_placeholder('admin').fill(user); pg.get_by_placeholder('••••••••').fill(pw)
    pg.get_by_role('button', name='Sign in').click(); pg.wait_for_url(lambda u: '/login' not in u)
    return pg, log


def month_select(pg):
    return pg.locator('select').filter(has=pg.locator('option', has_text='September')).first


def pick(pg, month, year=2026):
    month_select(pg).select_option(str(month))
    pg.locator('select').filter(has=pg.locator('option', has_text=str(year))).first.select_option(str(year))
    pg.wait_for_load_state('networkidle'); time.sleep(.4)


def goto(pg, path, month=None):
    pg.goto(BASE + path); pg.wait_for_load_state('networkidle'); time.sleep(.4)
    if month: pick(pg, month)


def click_link(pg, loc):
    loc.click(); pg.wait_for_load_state('networkidle'); time.sleep(.6)


def path(pg):
    u = pg.url.split(BASE, 1)[-1]; return u


def explainer_overlap(pg):
    """Scroll <main> to the bottom; for the last 3 rows' Correct buttons say whether a floating button covers them."""
    pg.evaluate("() => { const m = document.querySelector('main'); m.scrollTop = m.scrollHeight }"); time.sleep(.4)
    return pg.evaluate("""() => {
      const rows = [...document.querySelectorAll('tbody > tr')].filter(r => [...r.querySelectorAll('button')].some(b => b.textContent.trim() === 'Correct'))
      const out = []
      for (const r of rows.slice(-3)) {
        const b = [...r.querySelectorAll('button')].find(x => x.textContent.trim() === 'Correct')
        b.scrollIntoView({ block: 'nearest', inline: 'nearest' })
        const rc = b.getBoundingClientRect()
        const pts = [[rc.left + rc.width / 2, rc.top + rc.height / 2], [rc.right - 6, rc.top + rc.height / 2], [rc.left + 6, rc.top + rc.height / 2]]
        const hits = pts.map(([x, y]) => { const el = document.elementFromPoint(x, y); return (el && (el === b || b.contains(el))) ? null : (el ? (el.tagName + '.' + String(el.className).slice(0, 60) + ' ' + (el.textContent || '').trim().slice(0, 30)) : 'none') }).filter(Boolean)
        out.push({ covered: hits.length > 0, by: hits[0] || '', y: Math.round(rc.top), vh: innerHeight })
      }
      return out
    }""")


env = dict(os.environ, DATA_DIR=WORK, JWT_SECRET='x', PORT=str(PORT), NODE_ENV='production',
           ADMIN_PASSWORD='Admin@123', HR_PASSWORD='Indriyan@2025', FINANCE_PASSWORD='Finance@2025')
srv = subprocess.Popen(['node', f'{ROOT}/backend/server.js'], env=env, stdout=open(f'{WORK}/log', 'w'), stderr=subprocess.STDOUT)
try:
    for _ in range(240):
        try: urllib.request.urlopen(BASE + '/api/version', timeout=2); break
        except Exception: time.sleep(.5)
    seed()
    sheet = os.path.join(WORK, 'coordinator_nov.xlsx'); make_coordinator_sheet(sheet)
    print(f'App root: {ROOT}  mode: {"BASE (expect the old behaviour)" if BASE_MODE else "fix"}')

    with sync_playwright() as p:
        b = p.chromium.launch()
        hr, hlog = login(b, 'hr', 'Indriyan@2025')

        print('\n— N-24: Salary Explainer button vs the last rows of a long list (hr, Miss Punch, 40 rows) —')
        goto(hr, '/pipeline/miss-punch', 9)
        hr.locator('tbody > tr', has_text='T9899').first.wait_for(timeout=15000)
        cov = explainer_overlap(hr)
        print(f'  · 1440 px, last 3 Correct buttons: {cov}')
        check('1440 px: no floating button covers the last 3 rows\' Correct buttons', want(False, True), any(x['covered'] for x in cov))
        check('1440 px: explainer button still shown', True, hr.get_by_title('Salary Explainer (Ctrl+Shift+E)').is_visible())

        print('\n— P4-02: Miss Punch links (hr; automatic day calculation switched off → the "by hand" banner) —')
        c = sqlite3.connect(DB)
        c.execute("INSERT OR REPLACE INTO policy_config(key,value) VALUES('leave_auto_stage6_enabled','0')")
        c.commit(); c.close()
        time.sleep(5.5)   # past the server's 5-second GET cache on the status read
        goto(hr, '/pipeline/miss-punch', 9)
        if not BASE_MODE:
            hr.get_by_test_id('mp-link-stage6').wait_for(timeout=10000)
            check('Stage 6 link shown in the "switched off" banner', 1, hr.get_by_test_id('mp-link-stage6').count())
            hr.get_by_test_id('mp-pending-finance').click(); hr.wait_for_load_state('networkidle'); time.sleep(.5)
            check('"N awaiting finance" opens the Finance Pending chip (T9852 only)',
                  (True, False), (hr.locator('tbody > tr', has_text='T9852').count() > 0, hr.locator('tbody > tr', has_text='T9899').count() > 0))
            hr.get_by_test_id('mp-pending-hr').click(); hr.wait_for_load_state('networkidle'); time.sleep(.5)
            check('"N awaiting HR" opens the HR Pending chip (T9899 listed, T9852 not)',
                  (True, False), (hr.locator('tbody > tr', has_text='T9899').count() > 0, hr.locator('tbody > tr', has_text='T9852').count() > 0))
            click_link(hr, hr.get_by_test_id('mp-link-stage6'))
            check('Stage 6 link → /pipeline/day-calc', '/pipeline/day-calc', path(hr))
            check('Stage 6 opens on the same month (September)', '9', month_select(hr).input_value())
            goto(hr, '/pipeline/miss-punch?state=finance-pending')
            check('?state=finance-pending pre-selects that chip',
                  (True, False), (hr.locator('tbody > tr', has_text='T9852').count() > 0, hr.locator('tbody > tr', has_text='T9899').count() > 0))
        else:
            check('no Stage 6 link in the banner', 0, hr.get_by_role('link', name=re.compile('Stage 6')).count())

        c = sqlite3.connect(DB)
        c.execute("UPDATE attendance_processed SET miss_punch_resolved=1, out_time_final='18:00', miss_punch_finance_status='approved' "
                  "WHERE is_miss_punch=1 AND month=9 AND year=2026")
        c.commit(); c.close()
        time.sleep(5.5)
        goto(hr, '/pipeline/miss-punch', 9)
        hr.get_by_text('All miss punches resolved!').wait_for(timeout=10000)
        if not BASE_MODE:
            click_link(hr, hr.get_by_test_id('mp-link-stage3'))
            check('all resolved: "Go to Stage 3" → /pipeline/shift-check', '/pipeline/shift-check', path(hr))
            check('Stage 3 opens on September', '9', month_select(hr).input_value())
        else:
            check('all resolved: no link, only "Proceed to Stage 3" text', 0,
                  hr.get_by_role('link', name=re.compile('Stage 3')).count())

        print('\n— P4-02: Night Shift link —')
        goto(hr, '/pipeline/night-shift', 9)
        hr.get_by_text('All night shifts confirmed!').wait_for(timeout=10000)
        if not BASE_MODE:
            click_link(hr, hr.get_by_test_id('ns-link-stage5'))
            check('"Go to Stage 5" → /pipeline/corrections', '/pipeline/corrections', path(hr))
            check('Stage 5 opens on September', '9', month_select(hr).input_value())
        else:
            check('no Stage 5 link', 0, hr.get_by_role('link', name=re.compile('Stage 5')).count())

        print('\n— P4-02: Import result "waiting on N" (upload response intercepted) —')
        goto(hr, '/pipeline/import', 9)
        fake = {'success': True, 'results': [{'success': True, 'file': 'TEST_SEP.xls', 'sheet': 'Sheet1', 'employeeCount': 1,
                'recordCount': 30, 'nightShiftPairs': 0, 'missPunches': 3,
                'autoStage6': {'fired': False, 'reason': 'miss_punches_outstanding', 'backlog': {'awaitingHr': 2, 'awaitingFinance': 1}}}]}
        hr.route('**/api/import/upload', lambda r: r.fulfill(status=200, content_type='application/json', body=json.dumps(fake)))
        hr.locator('input[type=file]').first.set_input_files({'name': 'TEST_SEP.xls', 'mimeType': 'application/vnd.ms-excel', 'buffer': b'x'})
        hr.get_by_role('button', name=re.compile('Upload & Parse')).click()
        hr.get_by_text('Automatic day calculation:').wait_for(timeout=10000)
        if not BASE_MODE:
            check('"2 miss punch(es) with HR" is a link', True, hr.get_by_test_id('imp-link-mp-hr').inner_text().startswith('2 miss punch'))
            click_link(hr, hr.get_by_test_id('imp-link-mp-finance'))
            check('"1 with finance" → Miss Punch on the Finance Pending chip', '/pipeline/miss-punch?state=finance-pending', path(hr))
            check('Miss Punch opens on September', '9', month_select(hr).input_value())
            active = hr.locator('button.bg-blue-600', has_text='Finance Pending').count()
            check('Finance Pending chip is the active one', 1, active)
        else:
            check('"waiting on" text has no links', 0, hr.get_by_role('link', name=re.compile('miss punch')).count())
        hr.unroute('**/api/import/upload')

        print('\n— P4-05: Sales Compute blockers before the first compute (hr) —')
        hr.evaluate("s => localStorage.setItem('hr-system-store', s)", json.dumps(
            {'state': {'selectedMonth': 11, 'selectedYear': 2026, 'selectedCompany': SCO, 'sidebarCollapsed': False}, 'version': 0}))
        goto(hr, '/sales/compute')
        hr.locator('select', has=hr.locator('option', has_text='All Companies')).first.select_option(SCO)
        pick(hr, 11)
        hr.get_by_text('No salary computation yet').wait_for(timeout=10000)
        banner_text = hr.locator('[data-testid=sales-readiness]').inner_text() if hr.locator('[data-testid=sales-readiness]').count() else ''
        check('pre-compute view shows the readiness banner', want(True, False),
              hr.get_by_text(re.compile(r'1 blocker')).count() > 0)
        if not BASE_MODE:
            check('banner names the missing gross salary', True, 'missing gross salary' in banner_text)
            check('"no coordinator upload yet" shown up front with a link', True, hr.get_by_test_id('sales-link-upload').count() == 1)
            click_link(hr, hr.get_by_test_id('sales-link-upload'))
            check('upload link → /sales/upload', '/sales/upload', path(hr))
        else:
            goto(hr, '/sales/upload')

        print('\n— P4-05: Sales Upload — Confirm reason, Go to Compute —')
        hr.get_by_role('button', name=re.compile('Coordinator Sheet')).click(); time.sleep(.4)
        hr.locator('select', has=hr.locator('option', has_text='All Companies')).first.select_option(SCO)
        pick(hr, 11)
        hr.locator('input[type=file]').first.set_input_files(sheet)
        hr.get_by_text(re.compile(r'Upload #\d+ — Preview')).wait_for(timeout=15000); time.sleep(.5)
        confirm_btn = hr.get_by_role('button', name='Confirm Matches')
        check('Confirm disabled (1 unmatched row)', True, confirm_btn.is_disabled())
        reason = hr.get_by_test_id('sales-confirm-reason')
        check('disabled Confirm says why (1 row has no employee yet)', want(True, False),
              reason.count() == 1 and '1 row has no employee yet' in reason.inner_text())
        hr.get_by_role('button', name=re.compile(r'^Unmatched')).click(); time.sleep(.3)
        hr.get_by_placeholder('Type 2+ chars of name or code…').first.fill('S952'); time.sleep(1)
        with hr.expect_response(lambda r: '/match/' in r.url and r.request.method == 'PUT') as mr:
            hr.locator('button', has_text='TEST REP NEXT B').first.click()
        check('manual match → 200', 200, mr.value.status)
        hr.wait_for_load_state('networkidle'); time.sleep(.8)
        if hr.get_by_test_id('sales-confirm-reason').count(): print('  · reason now:', hr.get_by_test_id('sales-confirm-reason').inner_text())
        check('Confirm enabled at once after the last row is linked (no 5-second stale preview)', want(True, False), confirm_btn.is_enabled())
        if BASE_MODE:
            time.sleep(6)   # old code: the preview refetch got the browser's 5-second copy; reopen to continue
            hr.reload(); hr.wait_for_load_state('networkidle')
            hr.get_by_role('button', name=re.compile('Coordinator Sheet')).click(); time.sleep(.4)
            hr.locator('input[type=file]').first.set_input_files(sheet)
            hr.get_by_role('button', name=re.compile('Open existing upload')).click()
            hr.get_by_text(re.compile(r'Upload #\d+ — Preview')).wait_for(timeout=15000); time.sleep(.5)
        check('no reason line when Confirm is on', 0, hr.get_by_test_id('sales-confirm-reason').count())
        with hr.expect_response(lambda r: r.url.endswith('/confirm') and r.request.method == 'POST') as cr:
            confirm_btn.click()
        check('confirm → 200', 200, cr.value.status)
        hr.wait_for_load_state('networkidle'); time.sleep(.8)
        upl = q("SELECT status FROM sales_uploads ORDER BY id DESC LIMIT 1")[0][0]
        check('upload status in DB = matched', 'matched', upl)
        if not BASE_MODE:
            check('after confirm: "Go to Compute" offered', 1, hr.get_by_test_id('sales-go-compute').count())
            # Point the store at another month first — Go to Compute must use the upload's cycle.
            hr.evaluate("""() => { const k='hr-system-store'; const s=JSON.parse(localStorage.getItem(k)); s.state.selectedMonth=3; localStorage.setItem(k, JSON.stringify(s)) }""")
            click_link(hr, hr.get_by_test_id('sales-go-compute'))
            check('Go to Compute → /sales/compute', '/sales/compute', path(hr))
            sub = hr.locator('p.section-subtitle').first.inner_text()
            check('compute page opens on the upload\'s cycle (Nov 2026, the company)', True, sub.startswith('Nov 2026') and SCO in sub)
            check('blockers still shown before compute (upload done, no cycle warning)', (True, 0),
                  (hr.get_by_text(re.compile(r'1 blocker')).count() > 0, hr.get_by_test_id('sales-link-upload').count()))
        else:
            check('after confirm: no Go to Compute', 0, hr.get_by_role('button', name=re.compile('Go to Compute')).count())

        print('\n— 390 px (hr): explainer vs last rows —')
        ph, plog = login(b, 'hr', 'Indriyan@2025', width=390)
        ph.evaluate("s => localStorage.setItem('hr-system-store', s)", json.dumps(
            {'state': {'selectedMonth': 9, 'selectedYear': 2026, 'selectedCompany': '', 'sidebarCollapsed': True}, 'version': 0}))
        c = sqlite3.connect(DB)
        c.execute("UPDATE attendance_processed SET miss_punch_resolved=0, miss_punch_finance_status=NULL WHERE is_miss_punch=1 "
                  "AND month=9 AND employee_code LIKE 'T98%' AND employee_code != 'T9852'")
        c.commit(); c.close()
        goto(ph, '/pipeline/miss-punch', 9)
        ph.locator('tbody > tr', has_text='T9899').first.wait_for(timeout=15000)
        cov = explainer_overlap(ph)
        print(f'  · 390 px, last 3 Correct buttons: {cov}')
        check('390 px: no floating button covers the last 3 rows\' Correct buttons', want(False, True), any(x['covered'] for x in cov))
        print('  · 390 px: <main> scrolls sideways (known mobile item, out of scope):',
              ph.evaluate("() => document.querySelector('main').scrollWidth > document.querySelector('main').clientWidth + 1"))

        print('\n— P4-04: Daily wage finance counts (finance) —')
        fn, flog = login(b, 'finance', 'Finance@2025')
        goto(fn, '/daily-wage/finance/review')
        db_pending = q("SELECT COUNT(*) FROM dw_entries WHERE status='pending_finance'")[0][0]
        db_corr = q("SELECT COUNT(*) FROM dw_entries WHERE status='needs_correction'")[0][0]
        db_flag = q("SELECT COUNT(*) FROM dw_entries WHERE status='flagged'")[0][0]
        db_appr = q("SELECT COUNT(*) FROM dw_entries WHERE status='approved' AND entry_date >= ?",
                    ((IST_TODAY - datetime.timedelta(days=7)).isoformat(),))[0][0]
        print(f'  · DB: pending {db_pending}, needs correction {db_corr}, flagged {db_flag}, approved last 7 days {db_appr}')
        if not BASE_MODE:
            got = tuple(int(fn.get_by_test_id(f'dw-count-{k}-value').inner_text()) for k in ('pending', 'corrections', 'flagged', 'approved'))
            check('count cards = DB counts (pending, needs correction, flagged, approved 7 d)', (db_pending, db_corr, db_flag, db_appr), got)
            fn.get_by_test_id('dw-count-flagged').click(); fn.wait_for_load_state('networkidle'); time.sleep(.5)
            check('clicking the Flagged card opens the flagged list (1 entry)', 1, fn.locator('text=TEST GANG NEXT').count())
            fn.get_by_test_id('dw-count-approved').click(); fn.wait_for_load_state('networkidle'); time.sleep(.5)
            check('Recently Approved list = approved within 7 IST days', db_appr, fn.locator('text=TEST GANG NEXT').count())
        tab_badge = fn.get_by_role('button', name=re.compile(r'^Needs Correction')).first.inner_text()
        check('Needs Correction tab shows its count before being opened', want(True, False), str(db_corr) in tab_badge)

        print('\n— P4-07: Loans "Approved — to disburse" (finance, then hr) —')
        goto(fn, '/loans')
        db_appr_loans = q("SELECT COUNT(*) FROM loans WHERE status='approved'")[0][0]
        if not BASE_MODE:
            tile = fn.get_by_test_id('tile-to-disburse')
            check('finance sees the tile', True, tile.is_visible())
            check('tile count = DB approved loans', str(db_appr_loans), re.search(r'\d+', tile.locator('span').nth(1).inner_text()).group(0))
            check('tile shows the ₹ total to pay out', True, '24,000' in tile.inner_text())
            fn.get_by_test_id('tile-to-disburse-btn').click(); time.sleep(.6)
            rows = fn.locator('[data-testid^=loan-row-]').count()
            check('click → Loans list filtered to Approved (rows = DB count)', db_appr_loans, rows)
            check('URL on the Loans tab', True, 'tab=loans' in fn.url)
        else:
            check('no "to disburse" tile', 0, fn.get_by_text('Approved — to disburse').count())
        goto(hr, '/loans')
        check('hr does not see the tile (cannot pay out)', 0, hr.get_by_text('Approved — to disburse').count())

        print('\n— page health —')
        if BASE_MODE:   # the base run reopens the upload via the duplicate-file path on purpose (409)
            hlog['bad'] = [x for x in hlog['bad'] if not x.startswith('409 ') or '/sales/upload' not in x]
            hlog['cons'] = [x for x in hlog['cons'] if '409' not in x]
        for name, lg in (('hr', hlog), ('hr 390', plog), ('finance', flog)):
            check(f'{name}: 0 page errors', [], lg['errs'])
            check(f'{name}: 0 console errors', [], lg['cons'])
            check(f'{name}: 0 API ≥ 400', [], lg['bad'])
        b.close()
finally:
    srv.terminate()
print(f'\n{PASS} passed, {FAIL} failed')
sys.exit(1 if FAIL else 0)
