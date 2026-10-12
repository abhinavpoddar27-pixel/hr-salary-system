#!/usr/bin/env python3
"""P3-01 — Extra Duty bulk grant: browser check (Chromium, built dist, real hr + finance logins).

Scratch DATA_DIR with fictional people (T5xxx), torn down at exit. Needs `npm run build --prefix frontend`.
Usage: python3 backend/scripts/bulk-ed-check.py [--base ROOT_OF_BASE_WORKTREE] [screenshot_dir]
  --base: run the "before" checks against another checkout's build (origin/main): no Bulk button,
          HR Queue lists non-pending rows.
Port: PORT env (default 3401).
"""
import os, sqlite3, subprocess, sys, tempfile, time, urllib.request, json
from playwright.sync_api import sync_playwright

args = sys.argv[1:]
BASE_ROOT = None
if '--base' in args:
    i = args.index('--base'); BASE_ROOT = os.path.abspath(args[i + 1]); del args[i:i + 2]
SHOTS = args[0] if args else None
ROOT = BASE_ROOT or os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
PORT = int(os.environ.get('PORT', '3401')); BASE = f'http://127.0.0.1:{PORT}'
WORK = tempfile.mkdtemp(prefix='bulk-ed-'); DB = os.path.join(WORK, 'hr_system.db')
CA, CB = 'Fict Co A', 'Fict Co B'
DATE, DATE2, OLD = '2026-10-09', '2026-10-16', '2026-10-02'
PASS = FAIL = 0


def check(label, expected, actual):
    global PASS, FAIL
    if expected == actual: PASS += 1; print(f'  ✓ {label}')
    else: FAIL += 1; print(f'  ✗ {label} — expected {expected!r}, got {actual!r}')


def shot(pg, name):
    if SHOTS: pg.screenshot(path=os.path.join(SHOTS, name), full_page=True)


def q(sql, *a):
    con = sqlite3.connect(DB); r = con.execute(sql, a).fetchall(); con.close(); return r


def ex(sql, *a):
    con = sqlite3.connect(DB); con.execute(sql, a); con.commit(); con.close()


def drift():
    return q("SELECT COUNT(*), ROUND(COALESCE(SUM(net_salary),0),2) FROM salary_computations WHERE ABS(net_salary-(gross_earned-total_deductions))>1")


env = dict(os.environ, DATA_DIR=WORK, JWT_SECRET='x', PORT=str(PORT), NODE_ENV='production',
           ADMIN_PASSWORD='Admin@123', HR_PASSWORD='Indriyan@2025', FINANCE_PASSWORD='Finance@2025')
srv = subprocess.Popen(['node', f'{ROOT}/backend/server.js'], env=env, stdout=open(f'{WORK}/log', 'w'), stderr=subprocess.STDOUT)
try:
    for _ in range(80):
        try: urllib.request.urlopen(BASE + '/api/version', timeout=2); break
        except Exception: time.sleep(.5)
    con = sqlite3.connect(DB)
    for n in range(5001, 5071):
        con.execute("INSERT INTO employees(code,name,department,company,status,employment_type) VALUES(?,?,?,?,'Active','Permanent')",
                    (f'T{n}', f'Test Person {n}', 'PROD' if n % 3 else 'STORE', CA if n % 2 else CB))
    con.execute("INSERT INTO employees(code,name,department,company,status,date_of_exit) VALUES('T5099','Test Leaver','PROD',?, 'Left','2026-09-30')", (CA,))
    g = """INSERT INTO extra_duty_grants(employee_code,grant_date,month,year,company,grant_type,duty_days,verification_source,
           status,finance_status,requested_by,linked_attendance_id) VALUES(?,?,10,2026,?,'OVERNIGHT_STAY',1,?,?,?,'hr',?)"""
    con.execute(g, ('T5003', DATE, CA, 'Gate Register', 'PENDING', 'UNREVIEWED', None))         # already granted
    con.execute(g, ('T5004', DATE, CB, 'BIOMETRIC_AUTO', 'PENDING', 'UNREVIEWED', 4242))       # system entry → replaced
    for n in range(5001, 5041):                                                                 # earlier date (copy source)
        con.execute(g, (f'T{n}', OLD, CA, 'Gate Register', 'APPROVED', 'FINANCE_APPROVED', None))
    con.execute(g, ('T5070', '2026-10-05', CA, 'Gate Register', 'REJECTED', 'UNREVIEWED', None))  # HR-rejected (not in HR queue)
    con.commit(); con.close()
    drift_before = drift()
    base_mode = BASE_ROOT is not None

    with sync_playwright() as p:
        b = p.chromium.launch()
        errs, cerrs, bad = [], [], []

        def page(user, pw, width=1440):
            ctx = b.new_context(viewport={'width': width, 'height': 900})
            pg = ctx.new_page()
            pg.on('pageerror', lambda e: errs.append(str(e)))
            pg.on('console', lambda m: cerrs.append(m.text) if m.type == 'error' else None)
            pg.on('response', lambda r: bad.append(f'{r.status} {r.request.method} {r.url.split(BASE)[-1]}') if '/api/' in r.url and r.status >= 400 else None)
            pg.goto(BASE + '/login'); pg.get_by_placeholder('admin').fill(user); pg.get_by_placeholder('••••••••').fill(pw)
            pg.get_by_role('button', name='Sign in').click(); pg.wait_for_url(lambda u: '/login' not in u)
            pg.goto(BASE + '/extra-duty-grants'); pg.wait_for_load_state('networkidle'); time.sleep(.8)
            return pg

        hr = page('hr', 'Indriyan@2025')
        if base_mode:
            print('\n— BASE (origin/main build) —')
            check('base: no "+ Bulk Grant" button', 0, hr.get_by_role('button', name='+ Bulk Grant').count())
            hr.get_by_role('button', name='HR Queue').click(); time.sleep(.6)
            st = set(hr.locator('tbody tr [data-status]').evaluate_all('es => es.map(e => e.dataset.status)'))
            check('base: HR Queue shows non-pending rows (bug F-11)', True, 'APPROVED' in st or 'REJECTED' in st)
            b.close(); raise SystemExit(0)

        print('\n— Open bulk panel, set once —')
        hr.get_by_role('button', name='+ Bulk Grant').click()
        hr.fill('#edb-date', DATE); hr.fill('#edb-ref', 'GR-9'); hr.fill('#edb-remarks', 'Night loading (test)')
        check('date shown in words with weekday', '09-Oct-2026, Fri', hr.locator('[data-testid=edb-date-words]').inner_text())

        print('\n— Paste 60 codes (1 left, 1 repeated, 1 already granted, 1 system entry) —')
        codes = [f'T{n}' for n in range(5001, 5059)] + ['T5099', 'T5001']
        hr.fill('[data-testid=pp-paste]', '\n'.join(codes)); hr.click('[data-testid=pp-paste-add]'); time.sleep(.3)
        check('picker: has-left line names the leaver', True, 'T5099' in hr.locator('[data-testid=pp-has-left]').inner_text())
        check('picker: repeat reported', True, 'repeat' in hr.locator('[data-testid=pp-paste-result]').inner_text().lower())
        hr.wait_for_selector('[data-testid=edb-chips]'); time.sleep(1.2)
        chip = lambda k: hr.locator(f'[data-chip={k}]').inner_text().strip()
        check('All (58)', 'All (58)', chip('all'))
        check('Ready (56)', 'Ready (56)', chip('ok'))
        check('Ready — note (1) = system entry replaced', 'Ready — note (1)', chip('warning'))
        check('Already granted (1)', 'Already granted (1)', chip('skipped'))
        check('Problems (0)', 'Problems (0)', chip('error'))
        print('\n— Draft survives a reload —')
        hr.reload(); hr.wait_for_load_state('networkidle'); time.sleep(.6)
        hr.get_by_role('button', name='+ Bulk Grant').click(); hr.wait_for_selector('[data-testid=edb-chips]'); time.sleep(1.2)
        check('draft restored banner shown', True, hr.get_by_text('Draft restored').count() >= 1)
        check('restored list still 58', 'All (58)', chip('all'))
        check('restored date kept', DATE, hr.input_value('#edb-date'))
        hr.locator('[data-chip=skipped]').click(); time.sleep(.2)
        check('skipped row is T5003', 'T5003', hr.locator('[data-scroll-table=edb-preview] tbody tr').first.get_attribute('data-code'))
        hr.locator('[data-chip=all]').click()
        hr.select_option('select[aria-label="Duty days for T5010"]', '0.5'); time.sleep(1.5)
        save = hr.locator('[data-testid=edb-save]')
        check('save button names the split', 'Save 57 grants (2 batches: 50 + 7)', save.inner_text().strip())
        check('HR approve ticked by default', True, hr.locator('[data-testid=edb-hr-approve]').is_checked())
        shot(hr, 'b1-preview.png')

        print('\n— Save → 2 batches —')
        save.click(); time.sleep(.5); hr.get_by_role('button', name='Save', exact=True).click()
        hr.wait_for_selector('[data-testid=ed-bulk-result]', timeout=15000); time.sleep(.5)
        check('result: 2 of 2 batches saved', '2 of 2 batches saved', hr.locator('[data-testid=ed-bulk-result-summary]').inner_text().strip())
        check('DB: 2 bulk batches', [(2,)], q("SELECT COUNT(*) FROM bulk_batches"))
        check('DB: 57 grants on the date by bulk, HR-approved by hr', [(57,)], q("SELECT COUNT(*) FROM extra_duty_grants WHERE grant_date=? AND status='APPROVED' AND approved_by='hr' AND verification_source='Gate Register' AND reference_number='GR-9'", DATE))
        check('DB: T5010 at 0.5 day', [(0.5,)], q("SELECT duty_days FROM extra_duty_grants WHERE employee_code='T5010' AND grant_date=?", DATE))
        check('DB: T5004 system entry replaced in place (link kept)', [('Gate Register', 4242)], q("SELECT verification_source, linked_attendance_id FROM extra_duty_grants WHERE employee_code='T5004' AND grant_date=?", DATE))
        check('DB: T5003 left as it was (PENDING)', [('PENDING',)], q("SELECT status FROM extra_duty_grants WHERE employee_code='T5003' AND grant_date=?", DATE))
        check('DB: leaver not granted', [(0,)], q("SELECT COUNT(*) FROM extra_duty_grants WHERE employee_code='T5099'"))
        check('DB: company from master (T5002 → Co B)', [(CB,)], q("SELECT company FROM extra_duty_grants WHERE employee_code='T5002' AND grant_date=?", DATE))
        shot(hr, 'b2-result.png')

        print('\n— Finance sees them in its queue —')
        fin = page('finance', 'Finance@2025')
        fin.locator('[data-filter=UNREVIEWED]').click(); time.sleep(.5)
        n_fin = fin.locator('tbody tr', has_text=DATE).count()
        check('finance Unreviewed shows the 57 bulk rows', 57, n_fin)
        print('\n— Flag-for-Review submit is styled (btn-warning fix) —')
        fin.locator('tbody tr', has_text=DATE).first.get_by_role('button', name='⚑ Flag').click()
        flag_btn = fin.get_by_role('button', name='Flag for Review')
        check('Flag button has amber style', True, 'bg-amber-500' in (flag_btn.get_attribute('class') or ''))
        fin.keyboard.press('Escape'); time.sleep(.3)

        print('\n— Undo batch 2 (from Recent bulk batches) —')
        hr.get_by_role('button', name='Close').first.click(); time.sleep(.5)
        hr.reload(); hr.wait_for_load_state('networkidle'); time.sleep(.8)
        b2 = q("SELECT id FROM bulk_batches WHERE group_index=1")[0][0]
        b2codes = [r[0] for r in q("SELECT row_key FROM bulk_rows WHERE batch_id=? AND state IN ('ok','warning')", b2)]
        hr.locator(f'tr[data-batch-id="{b2}"]').get_by_role('button', name='Undo').click()
        hr.get_by_label('Reason for undo').fill('wrong list (test)'); time.sleep(.4); hr.get_by_role('button', name='Undo batch').click()
        time.sleep(1.2)
        check('DB: batch 2 undone', [('undone',)], q("SELECT status FROM bulk_batches WHERE id=?", b2))
        check(f'DB: its {len(b2codes)} grants removed', [(0,)], q(f"SELECT COUNT(*) FROM extra_duty_grants WHERE grant_date=? AND employee_code IN ({','.join('?'*len(b2codes))})", DATE, *b2codes))
        check('DB: batch 1 kept (50 + skipped untouched)', [(50,)], q("SELECT COUNT(*) FROM extra_duty_grants WHERE grant_date=? AND approved_by='hr'", DATE))
        check('list shows Undone', 'Undone', hr.locator(f'tr[data-batch-id="{b2}"] [data-status]').inner_text().strip())

        print('\n— Undo refused after finance reviews a row of batch 1 —')
        b1 = q("SELECT id FROM bulk_batches WHERE group_index=0")[0][0]
        gid = q("SELECT target_id FROM bulk_rows WHERE batch_id=? AND target_id IS NOT NULL LIMIT 1", b1)[0][0]
        ex("UPDATE extra_duty_grants SET finance_status='FINANCE_APPROVED' WHERE id=?", gid)
        hr.locator(f'tr[data-batch-id="{b1}"]').get_by_role('button', name='Undo').click()
        hr.get_by_label('Reason for undo').fill('should be refused'); time.sleep(.4); hr.get_by_role('button', name='Undo batch').click(); time.sleep(1)
        check('refusal dialog lists the reviewed row', True, 'Finance has reviewed' in hr.get_by_role('alertdialog').or_(hr.get_by_role('dialog')).first.inner_text())
        time.sleep(.4); hr.get_by_role('button', name='OK').click(); time.sleep(.3)
        check('DB: batch 1 still applied, 50 grants', [('applied', 50)], q("SELECT b.status, (SELECT COUNT(*) FROM extra_duty_grants WHERE grant_date=? AND approved_by='hr') FROM bulk_batches b WHERE id=?", DATE, b1))

        print('\n— Refused batch: copy an earlier date + paste, data changes before save —')
        hr.get_by_role('button', name='+ Bulk Grant').click(); time.sleep(.3)
        hr.fill('#edb-date', DATE2)
        hr.fill('#cfd-date', OLD); hr.locator('[data-testid=copy-from-date]').get_by_role('button', name='Add these people').click(); time.sleep(.8)
        check('copy from date added 40', '40 people from 02-Oct-2026 added', hr.locator('[data-testid=copy-from-date-msg]').inner_text().strip())
        hr.fill('[data-testid=pp-paste]', ' '.join(f'T{n}' for n in range(5041, 5061))); hr.click('[data-testid=pp-paste-add]'); time.sleep(1.8)
        check('60 ready, 2 batches', 'Save 60 grants (2 batches: 50 + 10)', hr.locator('[data-testid=edb-save]').inner_text().strip())
        ex("""INSERT INTO extra_duty_grants(employee_code,grant_date,month,year,company,grant_type,duty_days,verification_source,status,finance_status,requested_by)
              VALUES('T5055',?,10,2026,?,'OVERNIGHT_STAY',1,'Gate Register','PENDING','UNREVIEWED','someone')""", DATE2, CA)
        hr.locator('[data-testid=edb-save]').click(); time.sleep(.5); hr.get_by_role('button', name='Save', exact=True).click()
        hr.wait_for_selector('[data-testid=ed-bulk-result]', timeout=15000); time.sleep(.4)
        check('result names saved + refused batches', '1 of 2 batches saved · 1 refused — nothing from that batch was saved', hr.locator('[data-testid=ed-bulk-result-summary]').inner_text().strip())
        check('refused batch row shown', 1, hr.locator('[data-batch-result=refused]').count())
        check('DB: batch 1 saved (50), batch 2 nothing', [(50,)], q("SELECT COUNT(*) FROM extra_duty_grants WHERE grant_date=? AND requested_by='hr'", DATE2))
        shot(hr, 'b3-refused.png')
        hr.get_by_role('button', name='Check these 10 again').click(); time.sleep(1.8)
        check('re-check: 9 ready + 1 already granted', ('Ready (9)', 'Already granted (1)'), (hr.locator('[data-chip=ok]').inner_text().strip(), hr.locator('[data-chip=skipped]').inner_text().strip()))
        hr.locator('[data-testid=edb-save]').click(); time.sleep(.5); hr.get_by_role('button', name='Save', exact=True).click()
        hr.wait_for_selector('[data-testid=ed-bulk-result]', timeout=15000); time.sleep(.4)
        check('re-checked batch saved alone', '1 of 1 batch saved', hr.locator('[data-testid=ed-bulk-result-summary]').inner_text().strip())
        check('DB: 59 by bulk on date 2 + 1 by someone', [(59,), ], q("SELECT COUNT(*) FROM extra_duty_grants WHERE grant_date=? AND requested_by='hr'", DATE2))
        hr.get_by_role('button', name='Close').first.click(); time.sleep(.3)

        print('\n— Single "+ New Grant" still works —')
        hr.get_by_role('button', name='+ New Grant').click()
        dlg = hr.get_by_role('dialog')
        dlg.locator('input').first.fill('T5065'); dlg.locator('input[type=date]').fill('2026-10-20')
        dlg.get_by_role('button', name='Create Grant').click(); time.sleep(1)
        check('DB: single grant created (PENDING)', [('PENDING',)], q("SELECT status FROM extra_duty_grants WHERE employee_code='T5065' AND grant_date='2026-10-20'"))

        print('\n— HR Queue: pending only + HR bulk approve (F-11) —')
        hr.reload(); hr.wait_for_load_state('networkidle'); time.sleep(.8)
        hr.get_by_role('button', name='HR Queue').click(); time.sleep(.8)
        QROWS = "rs => rs.filter(r => !r.closest('[data-testid=bulk-batch-list]'))"
        qrows = hr.locator('tbody tr').evaluate_all(QROWS + ".map(r => (r.querySelector('[data-status]') || {}).dataset?.status)")
        hr_statuses = set(qrows)  # first badge per row = HR status
        pend = q("SELECT COUNT(*) FROM extra_duty_grants WHERE month=10 AND year=2026 AND status='PENDING' AND verification_source!='BIOMETRIC_AUTO'")[0][0]
        check('HR Queue rows = pending count', pend, len(qrows))
        check('HR Queue shows only PENDING', {'PENDING'}, hr_statuses)
        hr.locator('[data-testid=select-all]').check(); time.sleep(.3)
        hr.get_by_role('button', name=f'HR Approve ({pend})').click()
        time.sleep(.5); hr.get_by_role('button', name='Approve', exact=True).click(); time.sleep(1.2)
        check('DB: all pending approved', [(0,)], q("SELECT COUNT(*) FROM extra_duty_grants WHERE month=10 AND year=2026 AND status='PENDING' AND verification_source!='BIOMETRIC_AUTO'"))
        check('HR Queue empty message', True, hr.get_by_text('Nothing waiting for HR approval this month').count() == 1)

        print('\n— 390 px —')
        ph = page('hr', 'Indriyan@2025', width=390)
        ph.get_by_role('button', name='+ Bulk Grant').click(); time.sleep(.5)
        box = ph.locator('[data-testid=ed-bulk-panel]').bounding_box()
        check('panel fits 390 px', True, box is not None and box['x'] >= 0 and box['x'] + box['width'] <= 391)
        shot(ph, 'b4-390.png')

        b.close()

    print('\n— Totals —')
    check('drift query unchanged', drift_before, drift())
    check('0 page errors', [], errs)
    unexpected = [x for x in bad if not (x.startswith('409') and ('/api/bulk/extra-duty/apply' in x or '/undo' in x))]
    check('only the intended API errors (409 refused batch + 409 refused undo)', ([], 2), (unexpected, len(bad) - len(unexpected)))
    check('0 console errors except that 409', [], [c for c in cerrs if '409' not in c and 'Conflict' not in c and '[API Error]' not in c])
finally:
    srv.terminate()
    try: srv.wait(5)
    except Exception: srv.kill()
print(f'\n{PASS} passed, {FAIL} failed')
sys.exit(1 if FAIL else 0)
