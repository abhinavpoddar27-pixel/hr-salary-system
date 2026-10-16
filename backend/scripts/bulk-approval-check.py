#!/usr/bin/env python3
"""P5-01 — bulk approval stage: browser check (Chromium, built dist, real finance / admin / hr logins).

Scratch DATA_DIR, fictional rows only (T95xx) through the TEST-ONLY kind 'test-approval'
(server started with BULK_TEST_KINDS=1 — Railway never sets it). Batches are sent through the API
(the test kind has no panel); finance decides them in Finance Verification → Bulk batches.
Usage: python3 backend/scripts/bulk-approval-check.py [--base ROOT_OF_BASE_WORKTREE] [screenshot_dir]
  --base: the same steps on another checkout's build (origin/main): no Bulk batches tab, no /submit.
Port: PORT env (default 3501).
"""
import base64, hashlib, hmac, json, os, re, sqlite3, subprocess, sys, tempfile, time, urllib.request, urllib.error
from playwright.sync_api import sync_playwright

args = sys.argv[1:]
BASE_ROOT = None
if '--base' in args:
    i = args.index('--base'); BASE_ROOT = os.path.abspath(args[i + 1]); del args[i:i + 2]
SHOTS = args[0] if args else None
ROOT = BASE_ROOT or os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
PORT = int(os.environ.get('PORT', '3501')); BASE = f'http://127.0.0.1:{PORT}'
WORK = tempfile.mkdtemp(prefix='bulk-appr-'); DB = os.path.join(WORK, 'hr_system.db')
SECRET = 'p501-secret'
PASS = FAIL = 0


def check(label, expected, actual):
    global PASS, FAIL
    if expected == actual: PASS += 1; print(f'  ✓ {label}')
    else: FAIL += 1; print(f'  ✗ {label} — expected {expected!r}, got {actual!r}')


def q(sql, *a):
    con = sqlite3.connect(DB); r = con.execute(sql, a).fetchall(); con.close(); return r


def ex(sql, *a):
    con = sqlite3.connect(DB); con.execute(sql, a); con.commit(); con.close()


def b64(b): return base64.urlsafe_b64encode(b).rstrip(b'=').decode()


def token(username, role):
    h = b64(json.dumps({'alg': 'HS256', 'typ': 'JWT'}).encode())
    p = b64(json.dumps({'id': 999, 'username': username, 'role': role, 'exp': int(time.time()) + 3600}).encode())
    return f'{h}.{p}.' + b64(hmac.new(SECRET.encode(), f'{h}.{p}'.encode(), hashlib.sha256).digest())


def api(method, path, tok, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method,
                                 headers={'Authorization': f'Bearer {tok}', 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=10) as r: return r.status, json.loads(r.read() or b'{}')
    except urllib.error.HTTPError as e:
        try: return e.code, json.loads(e.read() or b'{}')
        except Exception: return e.code, {}


def send(rows, who='hr', role='hr', note='test'):
    """Preview + submit every group as `who`; returns batch ids."""
    tok = token(who, role)
    st, p = api('POST', '/api/bulk/test-approval/preview', tok, {'common': {'note': note}, 'rows': rows})
    if st != 200: return st, p
    by = {r['rowNo']: r for r in p['rows']}
    ids = []
    for g in p['groups']:
        st, r = api('POST', '/api/bulk/test-approval/submit', tok, {
            'common': {'note': note}, 'rows': [{'code': by[n]['code'], 'amount': by[n]['amount']} for n in g['rowNos']],
            'planHash': g['planHash'], 'groupId': 'g', 'groupIndex': g['index'], 'groupSize': len(p['groups'])})
        if st != 200: return st, r
        ids.append(r['batchId'])
    return 200, ids


env = dict(os.environ, DATA_DIR=WORK, JWT_SECRET=SECRET, PORT=str(PORT), NODE_ENV='production', BULK_TEST_KINDS='1',
           ADMIN_PASSWORD='Admin@123', HR_PASSWORD='Indriyan@2025', FINANCE_PASSWORD='Finance@2025')
srv = None


def start():
    global srv
    srv = subprocess.Popen(['node', f'{ROOT}/backend/server.js'], env=env, stdout=open(f'{WORK}/log', 'a'), stderr=subprocess.STDOUT)
    for _ in range(80):
        try: urllib.request.urlopen(BASE + '/api/version', timeout=2); return
        except Exception: time.sleep(.5)


def stop():
    srv.terminate(); srv.wait(timeout=10)


try:
    start()
    with sync_playwright() as p:
        b = p.chromium.launch()
        errs, cerrs, bad = [], [], []
        EXPECTED_BAD = set()

        def login(user, pw, width=1440):
            ctx = b.new_context(viewport={'width': width, 'height': 900})
            pg = ctx.new_page()
            pg.on('pageerror', lambda e: errs.append(str(e)))
            pg.on('console', lambda m: cerrs.append(m.text) if m.type == 'error' else None)
            pg.on('response', lambda r: bad.append(f'{r.status} {r.request.method} {r.url.split(BASE)[-1]}') if '/api/' in r.url and r.status >= 400 else None)
            pg.goto(BASE + '/login'); pg.get_by_placeholder('admin').fill(user); pg.get_by_placeholder('••••••••').fill(pw)
            pg.get_by_role('button', name='Sign in').click(); pg.wait_for_url(lambda u: '/login' not in u)
            return pg

        def open_bulk(pg):
            pg.goto(BASE + '/finance-verification?tab=bulk'); pg.wait_for_load_state('networkidle'); time.sleep(.8)

        def tab(pg):
            t = pg.get_by_role('button', name=re.compile('^Bulk batches'))
            return t.first.inner_text().strip() if t.count() else None

        def row(pg, bid): return pg.locator(f'tr[data-batch-id="{bid}"]')

        if BASE_ROOT:
            print('\n— BASE (origin/main build) —')
            st, _ = api('POST', '/api/bulk/test-approval/submit', token('hr', 'hr'), {'common': {}, 'rows': [], 'planHash': 'x'})
            check('base: no /submit route for an approval kind (404)', 404, st)
            fin = login('finance', 'Finance@2025'); open_bulk(fin)
            check('base: no "Bulk batches" tab on Finance Verification', None, tab(fin))
            st, _ = api('POST', '/api/bulk/batches/1/approve', token('finance', 'finance'), {})
            check('base: finance cannot reach /batches/:id/approve (403/404)', True, st in (403, 404))
            b.close(); raise SystemExit(0)

        print('\n— Send batches through the API (hr) —')
        st, ids = send([{'code': 'T9501', 'amount': 120000}, {'code': 'T9502', 'amount': 250000}, {'code': 'T9503', 'amount': 30000}])
        check('hr submits batch A (3 rows)', 200, st); A = ids[0]
        st, ids = send([{'code': 'T9511', 'amount': 1000}, {'code': 'T9512', 'amount': 2000}]); B = ids[0]
        st, ids = send([{'code': 'T9521', 'amount': 5000}]); C = ids[0]
        st, ids = send([{'code': 'T9531', 'amount': 7000}], who='admin', role='admin'); D = ids[0]
        check('4 batches submitted, nothing applied', ([(4,)], []), (q("SELECT COUNT(*) FROM bulk_batches WHERE status='submitted'"),
                                                                    q("SELECT * FROM bulk_test_target")))
        check('one finance notification per batch', [(4,)], q("SELECT COUNT(*) FROM notifications WHERE type='BULK_SUBMITTED' AND role_target='finance'"))

        print('\n— Finance: tab, open rows, Return B —')
        fin = login('finance', 'Finance@2025'); open_bulk(fin)
        check('tab label counts waiting batches', 'Bulk batches (4)', tab(fin))
        check('queue rendered', 1, fin.locator('[data-testid=bulk-approval-queue]').count())
        check('chip Waiting (4)', 'Waiting (4)', fin.locator('[data-filter=submitted]').inner_text().strip())
        check('batch A shows ₹ total in lakh notation', True, '₹4,00,000' in row(fin, A).inner_text())
        row(fin, A).get_by_role('button', name='Open').click()
        fin.wait_for_selector('[data-testid=bulk-queue-rows]'); time.sleep(.3)
        rows_txt = fin.locator('[data-testid=bulk-queue-rows]').inner_text()
        check('opened rows list every code + new amount', True, all(s in rows_txt for s in ['T9501', 'T9502', 'T9503', '₹2,50,000']))
        if SHOTS: fin.screenshot(path=os.path.join(SHOTS, 'p501-queue.png'), full_page=True)
        row(fin, B).locator('input[type=checkbox]').check()
        check('bar shows selected total', True, '₹3,000' in fin.locator('[data-testid=bulk-total]').inner_text())
        fin.locator('[data-testid=bulk-bar]').get_by_role('button', name=re.compile('Return 1')).click()
        dlg = fin.get_by_role('dialog')
        submit_btn = dlg.get_by_role('button', name='Return', exact=True)
        dlg.locator('textarea').fill('abc')
        check('Return disabled under 5 characters', True, submit_btn.is_disabled())
        dlg.locator('textarea').fill('wrong amounts for two people')
        submit_btn.click(); time.sleep(1.2)
        check('DB: B returned with note by finance', [('returned', 'wrong amounts for two people', 'finance')],
              q('SELECT status, return_note, decided_by FROM bulk_batches WHERE id=?', B))
        check('B row now Returned', 'returned', row(fin, B).get_attribute('data-status'))
        check('tab label down to 3', 'Bulk batches (3)', tab(fin))

        print('\n— Finance: Approve A (whole batch applied) —')
        row(fin, A).locator('input[type=checkbox]').check()
        fin.locator('[data-testid=bulk-bar]').get_by_role('button', name=re.compile('Approve 1')).click()
        time.sleep(.5)
        fin.get_by_role('dialog').get_by_role('button', name='Approve and apply').click(); time.sleep(1.5)
        check('DB: A applied, approved_by finance', [('applied', 'finance')], q('SELECT status, approved_by FROM bulk_batches WHERE id=?', A))
        check('DB: 3 target rows, requested by hr, approved by finance', [(3,)],
              q("SELECT COUNT(*) FROM bulk_test_target WHERE requested_by='hr' AND approved_by='finance' AND code IN ('T9501','T9502','T9503')"))
        check('audit BULK_APPROVE row', [(1,)], q("SELECT COUNT(*) FROM audit_log WHERE stage='BULK_APPROVE' AND record_id=?", A))

        print('\n— Edge: data changed since sent → plain refusal, nothing applied —')
        ex("INSERT INTO bulk_test_target (code, amount) VALUES ('T9521', 1)")
        EXPECTED_BAD.add(f'409 POST /api/bulk/batches/{C}/approve')
        row(fin, C).locator('input[type=checkbox]').check()
        fin.locator('[data-testid=bulk-bar]').get_by_role('button', name=re.compile('Approve 1')).click(); time.sleep(.5)
        fin.get_by_role('dialog').get_by_role('button', name='Approve and apply').click(); time.sleep(1.5)
        ref = fin.locator('[data-testid=bulk-refused]')
        check('refusal banner shown', 1, ref.count())
        check('banner says data changed + names the row', True, ref.count() == 1 and 'Data changed' in ref.inner_text() and 'T9521' in ref.inner_text())
        check('DB: C still submitted, target unchanged', [('submitted', 1.0)],
              q("SELECT b.status, t.amount FROM bulk_batches b, bulk_test_target t WHERE b.id=? AND t.code='T9521'", C))
        print('\n— Return C so it is closed; reject check via Reject reason —')
        row(fin, C).locator('input[type=checkbox]').check()
        fin.locator('[data-testid=bulk-bar]').get_by_role('button', name=re.compile('Reject 1')).click()
        fin.get_by_role('dialog').locator('textarea').fill('amount already set by hand')
        fin.get_by_role('dialog').get_by_role('button', name='Reject', exact=True).click(); time.sleep(1.2)
        check('DB: C rejected with reason', [('rejected', 'amount already set by hand')], q('SELECT status, reject_reason FROM bulk_batches WHERE id=?', C))

        print('\n— 390 px —')
        fin390 = fin.context.browser.new_context(viewport={'width': 390, 'height': 844}, storage_state=fin.context.storage_state()).new_page()
        fin390.on('pageerror', lambda e: errs.append(str(e)))
        open_bulk(fin390)
        check('390: queue renders', 1, fin390.locator('[data-testid=bulk-approval-queue]').count())
        qw = fin390.locator('[data-testid=bulk-approval-queue]').evaluate('e => e.getBoundingClientRect().right')
        check('390: queue fits the screen width', True, qw <= 391)
        if SHOTS: fin390.screenshot(path=os.path.join(SHOTS, 'p501-390.png'), full_page=True)

        print('\n— Edge: admin cannot decide their own batch —')
        stop(); start()  # login limiter is 5 / 15 min per IP
        adm = login('admin', 'Admin@123'); open_bulk(adm)
        check('own batch shows "another finance user decides it"', 1, row(adm, D).locator('[data-testid=bulk-own-note]').count())
        check('own batch box disabled', True, row(adm, D).locator('input[type=checkbox]').is_disabled())
        st, body = api('POST', f'/api/bulk/batches/{D}/approve', token('admin', 'admin'), {})
        check('API: admin approves own batch → 403 SELF_APPROVAL', (403, 'SELF_APPROVAL'), (st, body.get('code')))
        check('DB: D still submitted, nothing applied', ([('submitted',)], []), (q('SELECT status FROM bulk_batches WHERE id=?', D),
                                                                               q("SELECT * FROM bulk_test_target WHERE code='T9531'")))
        st, _ = api('POST', f'/api/bulk/batches/{D}/approve', token('finance', 'finance'), {})
        check('finance approves admin\'s batch', 200, st)

        print('\n— hr: no Bulk tab; returned note visible to creator (API); hr cannot decide or undo —')
        hr = login('hr', 'Indriyan@2025'); open_bulk(hr)
        check('hr: no Bulk batches tab', None, tab(hr))
        st, body = api('GET', '/api/bulk/batches?kind=test-approval', token('hr', 'hr'))
        ret = [x for x in body.get('data', []) if x['id'] == B]
        check('hr list carries the return note', 'wrong amounts for two people', ret[0]['returnNote'] if ret else None)
        st, _ = api('POST', f'/api/bulk/batches/{A}/approve', token('hr', 'hr'), {})
        check('hr approve → 403', 403, st)
        st, _ = api('POST', f'/api/bulk/batches/{A}/undo', token('hr', 'hr'), {'reason': 'wrong batch'})
        check('hr undo of an approval batch → 403 (finance/admin only, Q-A2)', 403, st)
        st, _ = api('POST', f'/api/bulk/batches/{A}/undo', token('finance', 'finance'), {'reason': 'wrong batch'})
        check('finance undo with reason → 200', 200, st)
        check('DB: A undone, target rows removed', ([('undone',)], [(0,)]),
              (q('SELECT status FROM bulk_batches WHERE id=?', A), q("SELECT COUNT(*) FROM bulk_test_target WHERE code IN ('T9501','T9502','T9503')")))
        st, _ = api('GET', '/api/bulk/batches', token('view1', 'viewer'))
        check('viewer list → 403', 403, st)

        print('\n— Errors —')
        check('0 page errors', [], errs)
        unexpected = [x for x in bad if x not in EXPECTED_BAD]
        check('0 unexpected API ≥ 400', [], unexpected)
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
