#!/usr/bin/env python3
"""Phase 3 simulation — statutory flags PR-3 (filing). THROWAWAY DB ONLY.

Boots the REAL backend/server.js (NODE_ENV=production, built frontend/dist) on a fresh temp DATA_DIR seeded by
seed_pr3.js (synthetic, sales bootstrap skipped), real logins (admin / hr / finance / viewer1), the real statutory
uploads (plant + sales, effective 2026-10), real plant Stage 6 / 7 and sales compute over HTTP for October 2026, then:
  * plant ECR / ESI / bank files: who is written, who is in `missing`, X-Missing-* on JSON + download, company filter;
  * the sales ESI file (finance login): IP with 0 days, hold row, missing rep, read-only (DB unchanged);
  * sales master number edits over HTTP (400 / 409 / 200 + audit) and the re-export with missing = 0;
  * the LWF register (JSON + xlsx), capped row (M2);
  * C4: viewer 403 on every restricted report + the sales ESI file; finance 200;
  * VERIFY.sql V5 / V8 (drift), V11 / V13 (components), V15 (capped LWF), V16 (fix list), read from the doc;
  * Chromium on the built dist: Reports ECR missing panel + confirm dialog + download, LWF tab, the sales register
    Export ESI modal, a sales master number edit through the form, the viewer's restricted message; 0 page errors.

  python3 docs/statutory-flags/sim/run_pr3.py <repo-under-test> [--shots <dir>]
Exit 0 only if every check passes. The temp DATA_DIR is deleted at the end.
"""
import json, os, re, shutil, sqlite3, subprocess, sys, tempfile, time, urllib.request, urllib.parse, base64

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(sys.argv[1])
SHOTS = sys.argv[sys.argv.index('--shots') + 1] if '--shots' in sys.argv else None
BACKEND = os.path.join(REPO, 'backend')
DATA = tempfile.mkdtemp(prefix='filing-sim-')
PORT = 3931
URL = f'http://127.0.0.1:{PORT}'
A = 'Indriyan Beverages Pvt Ltd'; B = 'Asian Lakto Ind Ltd'
AQ = urllib.parse.quote(A); BQ = urllib.parse.quote(B)
results = []

def check(name, ok, detail=''):
    results.append((name, bool(ok)))
    print(('PASS ' if ok else 'FAIL ') + name + (f'  [{detail}]' if detail != '' else ''), flush=True)

out = subprocess.run(['node', os.path.join(HERE, 'seed_pr3.js'), DATA, BACKEND], capture_output=True, text=True, cwd=BACKEND)
if out.returncode != 0:
    print(out.stdout, out.stderr); raise SystemExit('seed failed')
print(out.stdout.strip().splitlines()[-1])
env = dict(os.environ, DATA_DIR=DATA, PORT=str(PORT), NODE_ENV='production', JWT_SECRET='sim-secret-not-real',
           ADMIN_PASSWORD='SimAdmin#1', HR_PASSWORD='SimHr#1', FINANCE_PASSWORD='SimFin#1', SQL_CONSOLE_ENABLED='false')
log = open(os.path.join(DATA, 'server.log'), 'w')
srv = subprocess.Popen(['node', 'server.js'], cwd=BACKEND, env=env, stdout=log, stderr=subprocess.STDOUT)
for _ in range(80):
    try:
        urllib.request.urlopen(URL + '/api/health', timeout=1); break
    except Exception:
        time.sleep(0.5)

def req(method, path, token=None, body=None, raw=False, headers=None):
    """→ (status, body, response headers dict lower-cased)."""
    data = None; h = dict(headers or {})
    if body is not None and not isinstance(body, bytes):
        data = json.dumps(body).encode(); h['Content-Type'] = 'application/json'
    elif isinstance(body, bytes):
        data = body
    if token: h['Authorization'] = 'Bearer ' + token
    r = urllib.request.Request(URL + path, data=data, method=method, headers=h)
    try:
        with urllib.request.urlopen(r, timeout=120) as resp:
            b = resp.read(); hd = {k.lower(): v for k, v in resp.headers.items()}
            return resp.status, (b if raw else json.loads(b or b'{}')), hd
    except urllib.error.HTTPError as e:
        b = e.read(); hd = {k.lower(): v for k, v in e.headers.items()}
        try: return e.code, json.loads(b), hd
        except Exception: return e.code, b, hd

def multipart(path, token, fields, file_bytes, file_name='flags.xlsx'):
    boundary = '----filingsim' + str(time.time()).replace('.', '')
    parts = [f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode() for k, v in fields.items()]
    parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{file_name}"\r\nContent-Type: application/octet-stream\r\n\r\n'.encode())
    parts += [file_bytes, b'\r\n', f'--{boundary}--\r\n'.encode()]
    return req('POST', path, token, b''.join(parts), headers={'Content-Type': f'multipart/form-data; boundary={boundary}'})

USERS = {}
def login(u, p):
    # server.js allows 5 logins / 15 min per IP: log in once over HTTP, the browser reuses the token + user
    s, b, _ = req('POST', '/api/auth/login', body={'username': u, 'password': p})
    if s == 200: USERS[u] = (b.get('token'), b.get('user'))
    return b.get('token') if s == 200 else None

def node_js(code, *args):
    o = subprocess.run(['node', '-e', code, *args], capture_output=True, text=True, cwd=BACKEND)
    if o.returncode != 0: raise RuntimeError(o.stderr[-400:])
    return o.stdout

def xlsx_file(rows):
    return base64.b64decode(node_js('''const X=require("xlsx");const wb=X.utils.book_new();
X.utils.book_append_sheet(wb,X.utils.aoa_to_sheet(JSON.parse(process.argv[1])),"flags");
process.stdout.write(X.write(wb,{type:"buffer",bookType:"xlsx"}).toString("base64"));''', json.dumps(rows)))

def read_xlsx(buf):
    p = os.path.join(DATA, 'x.xlsx'); open(p, 'wb').write(buf)
    return json.loads(node_js('''const X=require("xlsx");const wb=X.readFile(process.argv[1],{cellStyles:true});const o={};
for(const n of wb.SheetNames){const ws=wb.Sheets[n];
o[n]={rows:X.utils.sheet_to_json(ws,{header:1,defval:"",blankrows:true}),width:X.utils.decode_range(ws["!ref"]).e.c+1,cols:(ws["!cols"]||[]).length};}
process.stdout.write(JSON.stringify(o));''', p))

DB = os.path.join(DATA, 'hr_system.db')
def sql(q, *a):
    c = sqlite3.connect(DB); c.row_factory = sqlite3.Row
    try: return [dict(r) for r in c.execute(q, a).fetchall()]
    finally: c.close()

def verify_sql(tag, month=None):
    """The statement under '-- <tag> …' in docs/statutory-flags/VERIFY.sql; month=N rewrites a literal September month."""
    text = open(os.path.join(HERE, '..', 'VERIFY.sql')).read()
    q = re.search(r'^-- ' + tag + r'\b.*?\n((?:--.*\n)*)(SELECT[^\n]*;)', text, re.M).group(2)
    if month is not None:
        q = re.sub(r'\bmonth=9 AND year=2026', f'month={month} AND year=2026', q)
    return q

lines_of = lambda b: [l for l in b.decode().split('\n') if l]

try:
    admin = login('admin', 'SimAdmin#1'); hr = login('hr', 'SimHr#1'); fin = login('finance', 'SimFin#1'); viewer = login('viewer1', 'SimView#1')
    check('real logins admin / hr / finance / viewer1', admin and hr and fin and viewer)

    # ── the owner's statutory uploads, effective October (real preview → apply) ──
    PH = ['code', 'name', 'type', 'esi_applicable', 'pf_applicable', 'lwf_applicable', 'esi_number', 'uan', 'note']
    prow = lambda c, esi, pf, lwf, en='', uan='': [c, 'X', 'Worker', esi, pf, lwf, en, uan, '']
    plant_file = xlsx_file([PH, prow('P01', 'Y', 'Y', 'Y', '2000000301', '100000000301'), prow('P02', 'N', 'Y', 'Y', '', '100000000302'),
        prow('P03', 'N', 'Y', 'N'), prow('P04', 'N', 'Y', 'N'), prow('P05', 'Y', 'N', 'Y', '2000000305'), prow('P06', 'Y', 'N', 'N'),
        prow('P07', 'N', 'N', 'Y'), prow('B01', 'Y', 'N', 'Y', '2000000311')])
    SH = ['code', 'company', 'name', 'esi_applicable', 'pf_applicable', 'lwf_applicable', 'esi_number', 'uan', 'note']
    srow = lambda c, esi, lwf, en='': [c, A, 'X', esi, 'N', lwf, en, '', '']
    sales_file = xlsx_file([SH, srow('S01', 'Y', 'Y', '4000000401'), srow('S02', 'Y', 'N'), srow('S03', 'Y', 'N', '4000000403'), srow('S05', 'Y', 'N', '4000000405')])
    for scope, f in (('plant', plant_file), ('sales', sales_file)):
        s, pv, _ = multipart('/api/statutory-flags/preview', admin, {'scope': scope, 'effectiveMonth': '2026-10'}, f)
        s2, ap, _ = multipart('/api/statutory-flags/apply', admin, {'scope': scope, 'effectiveMonth': '2026-10', 'expectedSha256': pv.get('sha256')}, f)
        check(f'{scope} statutory upload preview + apply (effective 2026-10) → 200 / 200', (s, s2) == (200, 200), (s, s2, str(ap)[:150]))

    # ── October payroll: plant Stage 6 / 7 (A and B), sales compute ──
    for co in (A, B):
        s1, _, _ = req('POST', '/api/payroll/calculate-days', hr, {'month': 10, 'year': 2026, 'company': co})
        s2, _, _ = req('POST', '/api/payroll/compute-salary', hr, {'month': 10, 'year': 2026, 'company': co})
        check(f'plant Stage 6 + 7 October ({co[:8]}) → 200 / 200', (s1, s2) == (200, 200), (s1, s2))
    s, _, _ = req('POST', '/api/sales/compute', hr, {'month': 10, 'year': 2026, 'company': A})
    check('sales compute October → 200', s == 200, s)
    sid = {r['employee_code']: r['id'] for r in sql('SELECT id, employee_code FROM sales_salary_computations WHERE month=10 AND year=2026')}
    s, _, _ = req('PUT', f'/api/sales/salary/{sid["S05"]}/status', hr, {'status': 'hold'})
    check('S05 → hold (status route)', s == 200, s)
    pr = {r['employee_code']: r for r in sql('SELECT * FROM salary_computations WHERE month=10 AND year=2026')}
    check('plant statutory lines as flagged: PF P01–P04, ESI P01 / P05 / P06 / B01, LWF P01 / P02 / P05 / P07 / B01',
          sorted(c for c, r in pr.items() if r['pf_employee'] > 0) == ['P01', 'P02', 'P03', 'P04']
          and sorted(c for c, r in pr.items() if r['esi_employee'] > 0) == ['B01', 'P01', 'P05', 'P06']
          and sorted(c for c, r in pr.items() if r['lwf_employee'] > 0) == ['B01', 'P01', 'P02', 'P05', 'P07'])
    check('P07: the deductions cap fired (total = gross_earned) and LWF stays 5 (M2)',
          abs(pr['P07']['total_deductions'] - pr['P07']['gross_earned']) < 0.01 and pr['P07']['lwf_employee'] == 5)

    # ── plant ECR / ESI / bank ──
    s, j, h = req('GET', f'/api/reports/pf-ecr?month=10&year=2026&company={AQ}', hr)
    check('ECR JSON: P01 + P02 written; P03 none / P04 malformed in missing; X-Missing-UAN P03,P04',
          s == 200 and sorted(e['employee_code'] for e in j['data']) == ['P01', 'P02']
          and sorted((m['employee_code'], m['reason']) for m in j['missing']) == [('P03', 'none'), ('P04', 'malformed')]
          and h.get('x-missing-uan') in ('P03,P04', 'P04,P03') and j['totals']['missingCount'] == 2, (s, h.get('x-missing-uan')))
    check('ECR JSON missing ₹ = the computed PF of P03 + P04', abs(j['totals']['missingEE'] - (pr['P03']['pf_employee'] + pr['P04']['pf_employee'])) < 0.01)
    s, b, h = req('GET', f'/api/reports/pf-ecr?month=10&year=2026&company={AQ}&download=true', fin, raw=True)
    ls = lines_of(b)
    check('ECR download (finance): 2 lines, both 12-digit UANs, no line starts with |, header present',
          s == 200 and len(ls) == 2 and all(re.match(r'^\d{12}\|', l) for l in ls) and h.get('x-missing-uan') and 'ECR_Oct_2026.txt' in h.get('content-disposition', ''), (s, ls))
    s, j, h = req('GET', f'/api/reports/esi-contribution?month=10&year=2026&company={AQ}', hr)
    check('ESI JSON (A): P01 + P05 written; P06 missing; X-Missing-ESI-Number P06',
          s == 200 and sorted(e['employee_code'] for e in j['data']) == ['P01', 'P05'] and [m['employee_code'] for m in j['missing']] == ['P06']
          and h.get('x-missing-esi-number') == 'P06', (s, h.get('x-missing-esi-number')))
    s, j, h = req('GET', f'/api/reports/esi-contribution?month=10&year=2026&company={BQ}', hr)
    check('ESI JSON (B): B01 only, nothing missing, no header', s == 200 and [e['employee_code'] for e in j['data']] == ['B01'] and j['missing'] == [] and 'x-missing-esi-number' not in h)
    s, j, _ = req('GET', f'/api/reports/bank-salary-file?month=10&year=2026&company={AQ}', hr)
    check('bank file (A): the 7 plant A rows with net > 0 (P07 capped to net 0), untouched path', s == 200 and j['totals']['count'] == 7 and j['totals']['missingCount'] == 0, j.get('totals'))

    # ── the sales ESI file (finance) + number edits ──
    before = sql('SELECT * FROM sales_salary_computations ORDER BY id'); audit0 = sql('SELECT COUNT(*) c FROM audit_log')[0]['c']
    s, j, h = req('GET', f'/api/sales/export/esi-contribution?month=10&year=2026&company={AQ}', fin)
    d = j.get('data', {}) if s == 200 else {}
    check('sales ESI JSON (finance 200): S01, S03 (0 days), S05 (hold) written; S02 missing; header S02',
          s == 200 and [e['employee_code'] for e in d['employees']] == ['S01', 'S03', 'S05'] and [m['employee_code'] for m in d['missing']] == ['S02']
          and h.get('x-missing-esi-number') == 'S02', (s, h.get('x-missing-esi-number')))
    s, b, h = req('GET', f'/api/sales/export/esi-contribution?month=10&year=2026&company={AQ}&download=true', hr, raw=True)
    ls = lines_of(b)
    check('sales ESI download: 3 lines, S03 = 4000000403|SIM SALES S03|0|0|0|0, filename Sales_ESI_Oct_2026_…',
          s == 200 and len(ls) == 3 and '4000000403|SIM SALES S03|0|0|0|0' in ls and 'Sales_ESI_Oct_2026_Indriyan_Beverages_Pvt_Ltd.txt' in h.get('content-disposition', ''), ls)
    check('sales ESI file is read-only: every sales salary row + audit_log count unchanged',
          sql('SELECT * FROM sales_salary_computations ORDER BY id') == before and sql('SELECT COUNT(*) c FROM audit_log')[0]['c'] == audit0)
    S4 = f'/api/sales/employees/S04?company={AQ}'
    s1, b1, _ = req('PUT', S4, hr, {'esi_number': '40000', 'name': 'CHANGED'})
    s2, b2, _ = req('PUT', S4, hr, {'esi_number': '4000 000 401'})
    s3, b3, _ = req('PUT', S4, hr, {'uan': '1000000004011'})
    m4 = sql("SELECT name, esi_number, uan FROM sales_employees WHERE code='S04'")[0]
    check('HR edits S04: malformed ESI → 400, S01\'s number → 409 heldBy S01, 13-digit UAN → 400; nothing written',
          (s1, b1.get('code'), s2, b2.get('code'), b2.get('heldBy'), s3, b3.get('code')) == (400, 'INVALID_ESI_NUMBER', 409, 'NUMBER_IN_USE', 'S01', 400, 'INVALID_UAN')
          and m4 == {'name': 'Sim Sales S04', 'esi_number': None, 'uan': None}, (s1, s2, s3, m4))

    # ── LWF register ──
    s, j, _ = req('GET', '/api/reports/lwf-register?month=10&year=2026', fin)
    rows = {(r['payroll'], r['employee_code']): r for r in j.get('data', [])} if s == 200 else {}
    check('LWF register: plant P01 / P02 / P05 / P07 / B01 + sales S01, 5 / 20 each; P08 / S04 absent',
          s == 200 and sorted(rows) == sorted([('Plant', c) for c in ('P01', 'P02', 'P05', 'P07', 'B01')] + [('Sales', 'S01')])
          and all((r['lwf_employee'], r['lwf_employer']) == (5, 20) for r in rows.values()), sorted(rows))
    p7 = rows.get(('Plant', 'P07'), {})
    comp = ['pf_employee', 'esi_employee', 'professional_tax', 'tds', 'advance_recovery', 'lop_deduction', 'other_deductions', 'loan_recovery', 'late_coming_deduction', 'early_exit_deduction', 'lwf_employee']
    gap = round(sum(pr['P07'][k] or 0 for k in comp) - pr['P07']['total_deductions'], 2)
    check('LWF register: P07 capped with shortfall = V11 sum − total; others not capped; totals 30 / 120, capped 1',
          p7.get('capped') == 1 and abs(p7.get('shortfall', 0) - gap) < 0.01 and all(r['capped'] in (0, None) for k, r in rows.items() if k[1] != 'P07')
          and (j['totals']['lwf_employee'], j['totals']['lwf_employer'], j['totals']['capped']) == (30, 120, 1), (p7, j.get('totals')))
    check('LWF register subtotals: B (1 row) then A (5 rows)', [(x['company'], x['count']) for x in j['subtotals']] == [(B, 1), (A, 5)], j.get('subtotals'))
    s, b, h = req('GET', '/api/reports/lwf-register?month=10&year=2026&download=xlsx', hr, raw=True)
    x = read_xlsx(b)['LWF Register'] if s == 200 else None
    check('LWF register xlsx: header = every row = width = !cols = 8; 6 rows + 2 subtotals + total',
          x and x['width'] == 8 and x['cols'] == 8 and all(len(r) == 8 for r in x['rows']) and len(x['rows']) == 10, x and (x['width'], x['cols'], len(x['rows'])))

    # ── C4: who may download ──
    R = ['/api/reports/pf-ecr', '/api/reports/esi-contribution', '/api/reports/bank-salary-file', '/api/reports/pf-statement',
         '/api/reports/esi-statement', '/api/reports/bank-transfer', '/api/reports/audit-trail', '/api/reports/lwf-register']
    qs = f'?month=10&year=2026&company={AQ}'
    v = {u: req('GET', u + qs, viewer)[0] for u in R}
    v['company-config'] = req('GET', '/api/reports/company-config', viewer)[0]
    v['sales-esi'] = req('GET', f'/api/sales/export/esi-contribution{qs}&download=true', viewer)[0]
    check('C4: viewer 403 on all 10 restricted URLs (incl. the sales ESI file)', set(v.values()) == {403}, v)
    f = {u: req('GET', u + qs, fin)[0] for u in R}
    check('C4: finance 200 on the same reports', set(f.values()) == {200}, f)
    s, _, _ = req('GET', f'/api/reports/attendance-summary{qs}', viewer)
    check('C4: viewer keeps attendance-summary (200)', s == 200, s)

    # ── VERIFY.sql ──
    for tag, m in (('V5', 10), ('V8', 10)):
        rws = sql(verify_sql(tag, m))
        check(f'{tag} drift identity October → 0 rows', rws == [], rws[:3])
    v11 = sql(verify_sql('V11')); v13 = sql(verify_sql('V13'))
    check('V11 plant components → only P07 (the capped row); V13 sales components → 0 rows', [r['employee_code'] for r in v11] == ['P07'] and v13 == [], (v11, v13))
    v15 = sql(verify_sql('V15'))
    check('V15 capped LWF rows → exactly P07, shortfall = the register\'s', [(r['employee_code'], r['shortfall']) for r in v15] == [('P07', p7.get('shortfall'))], v15)
    v16 = sql(verify_sql('V16'))
    check('V16 fix list before the S02 fix: plant A PF 2 / ESI 1 (P03, P04 / P06)', any(r['payroll'] == 'plant' and r['company'] == A and (r['pf_without_uan'], r['esi_without_number']) == (2, 1) for r in v16), v16)
    sales_v16 = [r for r in v16 if r['payroll'] == 'sales']
    s02 = sql("SELECT esi_employee FROM sales_salary_computations WHERE employee_code='S02' AND month=10")[0]['esi_employee']
    check('V16 sales row = S02 (ESI deducted, no number)', s02 > 0 and [(r['company'], r['esi_without_number']) for r in sales_v16] == [(A, 1)], (s02, sales_v16))

    # ── Chromium on the built dist ──
    try:
        from playwright.sync_api import sync_playwright
        with sync_playwright() as p:
            br = p.chromium.launch(); ctx = br.new_context(accept_downloads=True); pg = ctx.new_page()
            errors = []; bad = []
            pg.on('pageerror', lambda e: errors.append(str(e)))
            pg.on('response', lambda r: bad.append(f'{r.status} {r.url}') if r.status >= 400 and '/api/' in r.url else None)
            store = json.dumps({'state': {'selectedMonth': 10, 'selectedYear': 2026, 'selectedCompany': A, 'sidebarCollapsed': False,
                                          'dateRangeMode': 'month', 'dateRangeStart': '', 'dateRangeEnd': ''}, 'version': 0})
            def sign_in(user, pw):
                # the token + user from the HTTP login (see login()); the app reads both from localStorage
                tok, usr = USERS[user]
                pg.goto(URL + '/login'); pg.wait_for_load_state('networkidle')
                pg.evaluate("([t, u, s]) => { localStorage.setItem('hr_token', t); localStorage.setItem('hr_user', u); localStorage.setItem('hr-system-store', s) }",
                            [tok, json.dumps(usr), store])
            sign_in('hr', 'SimHr#1')
            # Reports → PF ECR: missing panel, confirm dialog, download
            pg.goto(URL + '/reports'); pg.wait_for_timeout(1500)
            pg.click('button:has-text("PF ECR File")'); pg.wait_for_selector('[data-testid="filing-missing"]', timeout=15000)
            panel = pg.inner_text('[data-testid="filing-missing"]')
            check('browser: ECR missing panel names P03 + P04 and says NOT in the file', 'P03' in panel and 'P04' in panel and 'NOT in the file' in panel, panel[:160])
            msgs = []
            pg.once('dialog', lambda d: (msgs.append(d.message), d.dismiss()))
            pg.click('button:has-text("Download ECR")'); pg.wait_for_timeout(800)
            check('browser: Download ECR asks first (window.confirm names P03, P04 and the ₹)', msgs and 'P03' in msgs[0] and 'P04' in msgs[0] and 'NOT in this file' in msgs[0], msgs[:1])
            pg.once('dialog', lambda d: d.accept())
            with pg.expect_download() as dl:
                pg.click('button:has-text("Download ECR")')
            check('browser: after confirming, ECR_Oct_2026.txt downloads', dl.value.suggested_filename == 'ECR_Oct_2026.txt', dl.value.suggested_filename)
            # LWF tab
            pg.click('button:has-text("LWF Register")'); pg.wait_for_selector('[data-testid="lwf-capped"]', timeout=15000)
            body = pg.inner_text('main') if pg.locator('main').count() else pg.inner_text('body')
            # the page's company filter is A (store) → A's 5 rows + its subtotal; B01 is in the unfiltered register (API check above)
            check('browser: LWF Register tab (company A) lists P01 / P02 / P05 / P07 / S01, the subtotal and the capped note',
                  all(c in body for c in ('P01', 'P02', 'P05', 'P07', 'S01', 'Subtotal')) and 'B01' not in body
                  and 'deductions cap' in pg.inner_text('[data-testid="lwf-capped"]'), body[-300:])
            if SHOTS: os.makedirs(SHOTS, exist_ok=True); pg.screenshot(path=os.path.join(SHOTS, 'reports-lwf-register.png'), full_page=True)
            # sales register → Export ESI → modal lists S02
            pg.goto(URL + '/sales/compute'); pg.wait_for_selector('[data-testid="sales-esi-export"]', timeout=15000)
            pg.click('[data-testid="sales-esi-export"]'); pg.wait_for_selector('[data-testid="sales-esi-missing"]', timeout=15000)
            modal = pg.inner_text('[data-testid="sales-esi-missing"]')
            check('browser: sales Export ESI opens the missing list (S02, NOT in the file)', 'S02' in modal and 'NOT in the file' in modal, modal[:160])
            if SHOTS: pg.screenshot(path=os.path.join(SHOTS, 'sales-esi-missing.png'))
            pg.click('[data-testid="sales-esi-missing"] button:has-text("Cancel")')
            # sales master: badge, form validation, fix S02 through the form
            pg.goto(URL + '/sales/employees'); pg.wait_for_timeout(2500)
            badge_rows = pg.locator('tr:has-text("ESI no. missing")')
            check('browser: sales master badge "ESI no. missing" on S02 only', badge_rows.count() == 1 and 'S02' in badge_rows.first.inner_text(), badge_rows.count())
            pg.locator('tr:has-text("S02")').locator('button:has-text("Edit")').click()
            pg.wait_for_selector('[data-testid="esi-number"]', timeout=10000)
            pg.fill('[data-testid="esi-number"]', '4000'); pg.click('button:has-text("Save changes")'); pg.wait_for_timeout(500)
            check('browser: a 4-digit ESI number is refused in the form (no request)', pg.locator('text=ESI number must be 10 digits').count() >= 1)
            pg.fill('[data-testid="esi-number"]', '4000 000 402'); pg.click('button:has-text("Save changes")'); pg.wait_for_timeout(2000)
            m2 = sql("SELECT esi_number FROM sales_employees WHERE code='S02'")[0]['esi_number']
            au = sql("SELECT old_value, new_value, changed_by FROM audit_log WHERE table_name='sales_employees' AND employee_code='S02' AND field_name='esi_number'")
            check('browser: S02 saved through the form → stored 4000000402, audited (hr)', m2 == '4000000402' and au == [{'old_value': '', 'new_value': '4000000402', 'changed_by': 'hr'}], (m2, au))
            check('browser: the badge is gone', pg.locator('tr:has-text("ESI no. missing")').count() == 0)
            # sales register again: no missing → straight download
            pg.goto(URL + '/sales/compute'); pg.wait_for_selector('[data-testid="sales-esi-export"]', timeout=15000)
            with pg.expect_download() as dl:
                pg.click('[data-testid="sales-esi-export"]')
            check('browser: Export ESI now downloads straight away (missing 0)', dl.value.suggested_filename == 'Sales_ESI_Oct_2026_Indriyan_Beverages_Pvt_Ltd.txt'
                  and pg.locator('[data-testid="sales-esi-missing"]').count() == 0, dl.value.suggested_filename)
            content = open(dl.value.path()).read().split('\n')
            check('browser: the downloaded sales ESI file now holds S02 (4 lines)', len(content) == 4 and any(l.startswith('4000000402|SIM SALES S02|') for l in content), content)
            # session-analytics posts from the /login page before the injected token is in place → 401 (harness artefact, not a page call)
            hr_bad = [x for x in bad if '/api/session-analytics/' not in x]
            # viewer: a fresh browser context (as a different person's browser); the restricted message, no 403 fired
            ctx.close(); ctx = br.new_context(); pg = ctx.new_page()
            pg.on('pageerror', lambda e: errors.append(str(e)))
            pg.on('response', lambda r: bad.append(f'{r.status} {r.url}') if r.status >= 400 and '/api/' in r.url else None)
            sign_in('viewer1', 'SimView#1'); bad.clear()
            pg.goto(URL + '/reports'); pg.wait_for_timeout(1500)
            pg.click('button:has-text("PF ECR File")'); pg.wait_for_timeout(800)
            check('browser: viewer sees "HR, finance or admin only" on PF ECR (no table, no button)', pg.locator('[data-testid="filing-restricted"]').count() == 1
                  and pg.locator('button:has-text("Download ECR")').count() == 0)
            pg.click('button:has-text("LWF Register")'); pg.wait_for_timeout(500)
            check('browser: viewer sees the same message on LWF Register', pg.locator('[data-testid="filing-restricted"]').count() == 1)
            pg.click('button:has-text("Attendance Summary")'); pg.wait_for_timeout(800)
            check('browser: viewer keeps Attendance Summary (no message)', pg.locator('[data-testid="filing-restricted"]').count() == 0)
            rep_bad = [x for x in bad if '/api/reports/' in x]
            check('browser: the viewer page fired no /api/reports 4xx', rep_bad == [], rep_bad[:3])
            if SHOTS: pg.screenshot(path=os.path.join(SHOTS, 'viewer-restricted.png'))
            check('browser: 0 page errors', errors == [], errors[:3])
            check('browser: hr session — 0 API 4xx/5xx', hr_bad == [], hr_bad[:5])
            br.close()
    except Exception as e:
        try:
            print('browser url at failure:', pg.url)
            if SHOTS: pg.screenshot(path=os.path.join(SHOTS, 'failure.png'), full_page=True)
        except Exception: pass
        check('browser run', False, str(e)[:300])

    # after the UI fix: V16 sales clean, the file complete
    v16 = sql(verify_sql('V16'))
    check('V16 after the S02 fix: no sales row; plant A still PF 2 / ESI 1 (P03, P04, P06 — HR fix list)', [r for r in v16 if r['payroll'] == 'sales'] == []
          and [(r['payroll'], r['company'], r['pf_without_uan'], r['esi_without_number']) for r in v16] == [('plant', A, 2, 1)], v16)
    s, j, h = req('GET', f'/api/sales/export/esi-contribution?month=10&year=2026&company={AQ}', hr)
    check('sales ESI JSON after the fix: missing 0, no header, 4 rows', s == 200 and j['data']['missing'] == [] and 'x-missing-esi-number' not in h and j['data']['totals']['count'] == 4)
finally:
    try: srv.terminate(); srv.wait(10)
    except Exception: pass
    log.close()

fails = [n for n, ok in results if not ok]
print(f'\n{len(results) - len(fails)}/{len(results)} checks passed')
if fails:
    print('FAILED:', fails)
    print(open(os.path.join(DATA, 'server.log')).read()[-2500:])
shutil.rmtree(DATA, ignore_errors=True)
sys.exit(1 if fails else 0)
