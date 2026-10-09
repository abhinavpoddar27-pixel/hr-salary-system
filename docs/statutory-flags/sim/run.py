#!/usr/bin/env python3
"""Phase 3 user simulation — statutory flags PR-1. THROWAWAY DB ONLY.

Boots backend/server.js (NODE_ENV=production → serves the built dist) on a fresh
temp DATA_DIR, seeds synthetic data, then drives the REAL HTTP API with REAL
logins (admin / hr / finance) and the built admin page in Chromium.
Prints one line per check; exit 0 only if every check passes.

  python3 docs/statutory-flags/sim/run.py "$(git rev-parse --show-toplevel)"
  (optional) SIM_SHOTS=/some/dir  → screenshots of the admin page and the salary modal

Needs Python Playwright + Chromium for the browser part, backend/node_modules, and a
built frontend/dist. The temp DATA_DIR lives in the system temp dir and is deleted.
Logins use throwaway passwords set only for the temp server (ADMIN/HR/FINANCE_PASSWORD).
"""
import json, os, sqlite3, subprocess, sys, tempfile, time, urllib.request, shutil, io

REPO = sys.argv[1]
BACKEND = os.path.join(REPO, 'backend')
SCRATCH = os.path.dirname(os.path.abspath(__file__))
DATA = tempfile.mkdtemp(prefix='stat-sim-')
SHOTS = os.environ.get('SIM_SHOTS')
PORT = 3917
BASE = f'http://127.0.0.1:{PORT}'
results = []

def check(name, ok, detail=''):
    results.append((name, bool(ok)))
    print(('PASS ' if ok else 'FAIL ') + name + (f'  [{detail}]' if detail else ''), flush=True)

def node(script, *args):
    out = subprocess.run(['node', script, *args], capture_output=True, text=True, cwd=BACKEND)
    if out.returncode != 0:
        print(out.stdout, out.stderr); raise SystemExit('node failed: ' + script)
    return out.stdout.strip().splitlines()[-1]

# ── seed + boot ──
print(node(os.path.join(SCRATCH, 'seed.js'), DATA, BACKEND))
env = dict(os.environ, DATA_DIR=DATA, PORT=str(PORT), NODE_ENV='production', JWT_SECRET='sim-secret-not-real',
           ADMIN_PASSWORD='SimAdmin#1', HR_PASSWORD='SimHr#1', FINANCE_PASSWORD='SimFin#1', SQL_CONSOLE_ENABLED='false')
log = open(os.path.join(DATA, 'server.log'), 'w')
srv = subprocess.Popen(['node', 'server.js'], cwd=BACKEND, env=env, stdout=log, stderr=subprocess.STDOUT)
for _ in range(60):
    try:
        urllib.request.urlopen(BASE + '/api/health', timeout=1); break
    except Exception:
        time.sleep(0.5)

def req(method, path, token=None, body=None, raw=False, headers=None):
    data = None; h = dict(headers or {})
    if body is not None and not isinstance(body, bytes):
        data = json.dumps(body).encode(); h['Content-Type'] = 'application/json'
    elif isinstance(body, bytes):
        data = body
    if token: h['Authorization'] = 'Bearer ' + token
    r = urllib.request.Request(BASE + path, data=data, method=method, headers=h)
    try:
        with urllib.request.urlopen(r, timeout=60) as resp:
            b = resp.read(); return resp.status, (b if raw else json.loads(b or b'{}'))
    except urllib.error.HTTPError as e:
        b = e.read()
        try: return e.code, json.loads(b)
        except Exception: return e.code, b

def multipart(path, token, fields, file_bytes, file_name='flags.xlsx'):
    boundary = '----sim' + str(time.time()).replace('.', '')
    parts = []
    for k, v in fields.items():
        parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode())
    parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{file_name}"\r\nContent-Type: application/octet-stream\r\n\r\n'.encode())
    parts.append(file_bytes); parts.append(b'\r\n'); parts.append(f'--{boundary}--\r\n'.encode())
    return req('POST', path, token, b''.join(parts), headers={'Content-Type': f'multipart/form-data; boundary={boundary}'})

def login(u, p):
    s, b = req('POST', '/api/auth/login', body={'username': u, 'password': p})
    return b.get('token') if s == 200 else None

def xlsx(rows):
    return subprocess.run(['node', '-e', '''
const X=require("xlsx");const rows=JSON.parse(process.argv[1]);const wb=X.utils.book_new();
X.utils.book_append_sheet(wb,X.utils.aoa_to_sheet(rows),"flags");process.stdout.write(X.write(wb,{type:"buffer",bookType:"xlsx"}).toString("base64"));''', json.dumps(rows)],
        capture_output=True, text=True, cwd=BACKEND).stdout

import base64
def file_of(rows): return base64.b64decode(xlsx(rows))

DB = os.path.join(DATA, 'hr_system.db')
def sql(q, *a):
    c = sqlite3.connect(DB); c.row_factory = sqlite3.Row
    try: return [dict(r) for r in c.execute(q, a).fetchall()]
    finally: c.close()

VOLATILE = {'id', 'computed_at', 'created_at', 'updated_at', 'ai_explanation', 'ai_explanation_at', 'finalised_at'}
def salary_rows(m, y):
    rows = sql('SELECT * FROM salary_computations WHERE month=? AND year=? ORDER BY employee_code', m, y)
    return [{k: v for k, v in r.items() if k not in VOLATILE} for r in rows]
def sales_rows(m, y):
    rows = sql('SELECT * FROM sales_salary_computations WHERE month=? AND year=? ORDER BY employee_code', m, y)
    out = []
    for r in rows:
        r = {k: v for k, v in r.items() if k not in VOLATILE}
        if r.get('sunday_rule_trace'):
            t = json.loads(r['sunday_rule_trace']); t.pop('computedAt', None); r['sunday_rule_trace'] = t
        out.append(r)
    return out

try:
    admin = login('admin', 'SimAdmin#1'); hr = login('hr', 'SimHr#1'); fin = login('finance', 'SimFin#1')
    check('real logins admin/hr/finance', admin and hr and fin)
    CO = 'Indriyan Beverages Pvt Ltd'

    # ── baseline: Stage 6 + 7 for Aug and Sep, sales compute Aug and Sep (before any upload) ──
    for m in (8, 9):
        s, b = req('POST', '/api/payroll/calculate-days', hr, {'month': m, 'year': 2026, 'company': CO})
        check(f'Stage 6 {m}/2026 → 200', s == 200, s)
        s, b = req('POST', '/api/payroll/compute-salary', hr, {'month': m, 'year': 2026, 'company': CO})
        check(f'Stage 7 {m}/2026 (pre-upload) → 200', s == 200, f"{s} processed={b.get('processed') if isinstance(b, dict) else b}")
        s, b = req('POST', '/api/sales/compute', hr, {'month': m, 'year': 2026, 'company': CO})
        check(f'sales compute {m}/2026 (pre-upload) → 200', s == 200, f"{s} {str(b)[:120] if s != 200 else ''}")
    aug0 = salary_rows(8, 2026); saug0 = sales_rows(8, 2026)
    sep0 = {r['employee_code']: r for r in salary_rows(9, 2026)}
    on = sorted({r['employee_code'] for r in aug0 + list(sep0.values()) if r['esi_employee'] or r['pf_employee']})
    check('pre-upload: only SIM06 (seeded ESI on) has statutory deductions', on == ['SIM06'], on)
    held0 = [c for c, r in sep0.items() if r['salary_held']]
    check('SIM05 held in Sep (month-end absence)', 'SIM05' in held0, held0)
    check('SIM04 (zero gross, no Sep attendance) has no Sep salary row', 'SIM04' not in sep0)

    # ── plant upload: preview ──
    HDR = ['code', 'name', 'type', 'esi_applicable', 'pf_applicable', 'lwf_applicable', 'esi_number', 'uan', 'note']
    plant_rows = [HDR,
        ['SIM01', 'X', 'W', 'Y', 'Y', 'Y', '', '', ''],
        ['SIM02', 'X', 'W', 'Y', 'N', 'Y', '', '', ''],
        ['SIM03', 'X', 'W', 'Y', 'N', 'Y', '', '', ''],
        ['SIM04', 'X', 'W', 'Y', 'N', 'Y', '', '', ''],
        ['SIM05', 'X', 'W', 'Y', 'N', 'Y', '', '', ''],
        ['SIM06', 'X', 'W', 'Y', 'N', 'Y', '', '', ''],
        ['NOPE99', 'X', 'W', 'Y', 'N', 'Y', '', '', '']]
    pf = file_of(plant_rows)
    s, pv = multipart('/api/statutory-flags/preview', hr, {'scope': 'plant', 'effectiveMonth': '2026-09'}, pf)
    check('hr cannot preview (403)', s == 403, s)
    s, pv = multipart('/api/statutory-flags/preview', admin, {'scope': 'plant', 'effectiveMonth': '2026-09'}, pf)
    check('admin preview 200', s == 200, s)
    t = pv['totals']
    check('preview: 7 rows / 5 matched / 1 unmatched / 2 row errors (NOPE99, SIM04)', (t['rows'], t['matched'], t['unmatched'], t['errors']) == (7, 5, 1, 2), t)
    check('preview: SIM04 = no structure → row error', any(r['code'] == 'SIM04' and r['error'] and 'No salary structure' in r['error'] for r in pv['rows']))
    check('preview: SIM06 unchanged', any(r['code'] == 'SIM06' and not r['changed'] for r in pv['rows']))
    check('preview: changed = 4 (SIM01/02/03/05)', t['changed'] == 4, t['changed'])
    # later rows: SIM02's only row (2026-09-06) and SIM03's 2026-10-15 row are both after E
    check('preview planned rows: 4 freeze, 4 effective, 0 at E, 2 later', (t['freezeRows'], t['effectiveRows'], t['rowsUpdatedAtE'], t['laterRowsUpdated']) == (4, 4, 0, 2), t)
    counts_before = sql('SELECT (SELECT COUNT(*) FROM salary_structures) s, (SELECT COUNT(*) FROM statutory_flag_batches) b')[0]
    check('preview wrote nothing', counts_before == {'s': 7, 'b': 0}, counts_before)

    # ── apply ──
    s, ap = multipart('/api/statutory-flags/apply', admin, {'scope': 'plant', 'effectiveMonth': '2026-09', 'expectedSha256': pv['sha256']}, pf)
    check('apply 200', s == 200, f'{s} {ap if s != 200 else ""}')
    c = ap['summary']['counts']
    check('apply counts == preview counts', (c['employees'], c['freezeRows'], c['effectiveRows'], c['rowsUpdatedAtE'], c['laterRowsUpdated']) == (4, t['freezeRows'], t['effectiveRows'], t['rowsUpdatedAtE'], t['laterRowsUpdated']), c)
    batch_id = ap['batchId']
    s, again = multipart('/api/statutory-flags/apply', admin, {'scope': 'plant', 'effectiveMonth': '2026-09', 'expectedSha256': pv['sha256']}, pf)
    check('re-apply same file → 409 DUPLICATE_BATCH', s == 409 and again.get('code') == 'DUPLICATE_BATCH', s)
    pf2 = file_of([r if i == 0 else r[:8] + ['again'] for i, r in enumerate(plant_rows)])
    s, pv2 = multipart('/api/statutory-flags/preview', admin, {'scope': 'plant', 'effectiveMonth': '2026-09'}, pf2)
    s, ap2 = multipart('/api/statutory-flags/apply', admin, {'scope': 'plant', 'effectiveMonth': '2026-09', 'expectedSha256': pv2['sha256']}, pf2)
    check('same content, new bytes → applied with 0 changes / 0 inserts', s == 200 and ap2['summary']['counts']['employees'] == 0 and ap2['summary']['counts']['freezeRows'] == 0, ap2.get('summary', {}).get('counts'))
    check('structure rows after apply = 7 + 8', sql('SELECT COUNT(*) c FROM salary_structures')[0]['c'] == 15)

    # ── recompute Aug and Sep ──
    req('POST', '/api/payroll/compute-salary', hr, {'month': 8, 'year': 2026, 'company': CO})
    aug1 = salary_rows(8, 2026)
    check('plant August recompute byte-identical (every column)', aug1 == aug0, f'{len(aug0)} rows')
    req('POST', '/api/payroll/compute-salary', hr, {'month': 9, 'year': 2026, 'company': CO})
    sep1 = {r['employee_code']: r for r in salary_rows(9, 2026)}
    check('Sep SIM01 PF + ESI on', sep1['SIM01']['pf_employee'] > 0 and sep1['SIM01']['esi_employee'] > 0, (sep1['SIM01']['pf_employee'], sep1['SIM01']['esi_employee']))
    check('Sep SIM02 (only a 2026-09-06 row) ESI on', sep1['SIM02']['esi_employee'] > 0, sep1['SIM02']['esi_employee'])
    check('Sep SIM03 (April + Oct rows) ESI on', sep1['SIM03']['esi_employee'] > 0, sep1['SIM03']['esi_employee'])
    check('Sep SIM05 still held, ESI computed on the held row', sep1['SIM05']['salary_held'] == 1 and sep1['SIM05']['esi_employee'] > 0, (sep1['SIM05']['salary_held'], sep1['SIM05']['esi_employee']))
    check('Sep SIM06 unchanged by the batch, ESI on (already on)', sep1['SIM06']['esi_employee'] > 0)
    check('Sep SIM07 (not in file) unchanged', {k: v for k, v in sep1['SIM07'].items()} == {k: v for k, v in sep0['SIM07'].items()})
    check('Sep SIM04 still no salary row (zero gross)', 'SIM04' not in sep1)
    oct_flags = sql("SELECT pf_applicable p, esi_applicable e, lwf_applicable l FROM salary_structures WHERE effective_from='2026-10-15'")
    check('SIM03 2026-10-15 row carries the new flags', oct_flags == [{'p': 0, 'e': 1, 'l': 1}], oct_flags)

    # ── a writer after the upload: HR edits SIM01 through PUT /employees/:code/salary with flags ──
    s, b = req('PUT', '/api/employees/SIM01/salary', hr, {'gross_salary': 15000, 'pf_applicable': 0, 'esi_applicable': 0, 'lwf_applicable': 0})
    m = sql("SELECT pf_applicable p, esi_applicable e, lwf_applicable l FROM employees WHERE code='SIM01'")[0]
    check('HR salary edit ignores flags (ignoredFields) — master still on', s == 200 and b.get('ignoredFields') == ['pf_applicable', 'esi_applicable', 'lwf_applicable'] and m == {'p': 1, 'e': 1, 'l': 1}, (s, b.get('ignoredFields'), m))

    # ── sales upload ──
    SH = ['code', 'company', 'name', 'esi_applicable', 'pf_applicable', 'lwf_applicable', 'esi_number', 'uan', 'note']
    sf = file_of([SH, ['SIMS1', CO, 'X', 'Y', 'N', 'Y', '9000000001', '', ''], ['SIMS2', CO, 'X', 'Y', 'N', 'Y', '', '', ''], ['SIMS3', CO, 'X', 'Y', 'N', 'Y', '', '', '']])
    s, spv = multipart('/api/statutory-flags/preview', admin, {'scope': 'sales', 'effectiveMonth': '2026-09'}, sf)
    st = spv['totals']
    check('sales preview: 3 changed, 1 number, planned 3 freeze / 2 effective / 1 at E / 1 later', (st['changed'], st['numbersAdded'], st['freezeRows'], st['effectiveRows'], st['rowsUpdatedAtE'], st['laterRowsUpdated']) == (3, 1, 3, 2, 1, 1), st)
    s, sap = multipart('/api/statutory-flags/apply', admin, {'scope': 'sales', 'effectiveMonth': '2026-09', 'expectedSha256': spv['sha256']}, sf)
    check('sales apply 200', s == 200, s)
    req('POST', '/api/sales/compute', hr, {'month': 8, 'year': 2026, 'company': CO})
    check('sales August recompute byte-identical', sales_rows(8, 2026) == saug0, f'{len(saug0)} rows')
    req('POST', '/api/sales/compute', hr, {'month': 9, 'year': 2026, 'company': CO})
    ssep = {r['employee_code']: r for r in sales_rows(9, 2026)}
    check('sales Sep ESI on for all 3', all(ssep[c]['esi_employee'] > 0 for c in ('SIMS1', 'SIMS2', 'SIMS3')), {c: ssep[c]['esi_employee'] for c in ssep})
    check('sales ESI number written to the master', sql("SELECT esi_number FROM sales_employees WHERE code='SIMS1'")[0]['esi_number'] == '9000000001')

    # ── drift identity (both) ──
    d1 = sql('SELECT employee_code FROM salary_computations WHERE ABS(net_salary-(gross_earned-total_deductions))>1')
    d2 = sql('SELECT employee_code FROM sales_salary_computations WHERE ABS(net_salary-(gross_earned+COALESCE(diwali_bonus,0)+COALESCE(incentive_amount,0)-total_deductions))>1')
    check('plant drift query → 0 rows', d1 == [], d1)
    check('sales drift query → 0 rows', d2 == [], d2)

    # ── undo file re-applied ──
    s, b = req('GET', '/api/statutory-flags/batches', admin)
    check('batches list shows 3 applied batches', s == 200 and [x['status'] for x in b['batches']] == ['applied'] * 3, [x['status'] for x in b.get('batches', [])])
    s, undo = req('GET', f'/api/statutory-flags/batches/{batch_id}/undo-file', admin, raw=True)
    check('undo file 200 (xlsx bytes)', s == 200 and undo[:2] == b'PK', s)
    s, upv = multipart('/api/statutory-flags/preview', admin, {'scope': 'plant', 'effectiveMonth': '2026-09'}, undo, 'undo.xlsx')
    s, uap = multipart('/api/statutory-flags/apply', admin, {'scope': 'plant', 'effectiveMonth': '2026-09', 'expectedSha256': upv['sha256']}, undo, 'undo.xlsx')
    check('undo apply 200, no new freeze/effective rows', s == 200 and uap['summary']['counts']['freezeRows'] == 0 and uap['summary']['counts']['effectiveRows'] == 0, uap.get('summary', {}).get('counts'))
    req('POST', '/api/payroll/compute-salary', hr, {'month': 9, 'year': 2026, 'company': CO})
    sep2 = {r['employee_code']: r for r in salary_rows(9, 2026)}
    check('after undo: Sep back to the pre-upload amounts (SIM01/02/03/05)', all(sep2[c]['esi_employee'] == sep0[c]['esi_employee'] and sep2[c]['pf_employee'] == sep0[c]['pf_employee'] and abs(sep2[c]['net_salary'] - sep0[c]['net_salary']) < 0.01 for c in ('SIM01', 'SIM02', 'SIM03', 'SIM05')))
    req('POST', '/api/payroll/compute-salary', hr, {'month': 8, 'year': 2026, 'company': CO})
    check('after undo: August still byte-identical', salary_rows(8, 2026) == aug0)
    d1 = sql('SELECT employee_code FROM salary_computations WHERE ABS(net_salary-(gross_earned-total_deductions))>1')
    check('plant drift after undo → 0 rows', d1 == [], d1)

    # ── R1 + boot again (no reset) ──
    s, b = req('GET', '/api/finance-audit/statutory-crosscheck?month=9&year=2026', fin)
    check('statutory-crosscheck → 200', s == 200, s)
    srv.terminate(); srv.wait(10)
    srv = subprocess.Popen(['node', 'server.js'], cwd=BACKEND, env=env, stdout=log, stderr=subprocess.STDOUT)
    for _ in range(60):
        try: urllib.request.urlopen(BASE + '/api/health', timeout=1); break
        except Exception: time.sleep(0.5)
    flags_after_boot = sql("SELECT code, pf_applicable p, esi_applicable e, lwf_applicable l FROM sales_employees ORDER BY code")
    plant_after_boot = sql("SELECT code, pf_applicable p, esi_applicable e, lwf_applicable l FROM employees WHERE code IN ('SIM06') ORDER BY code")
    check('server restart: sales + plant flags survive the boot (no reset; no ESI numbers on plant)', len(flags_after_boot) == 3 and all(r['e'] == 1 and r['l'] == 1 for r in flags_after_boot) and plant_after_boot == [{'code': 'SIM06', 'p': 0, 'e': 1, 'l': 1}], (flags_after_boot, plant_after_boot))

    # ── the admin page in Chromium (built dist) ──
    try:
        from playwright.sync_api import sync_playwright
        with sync_playwright() as p:
            br = p.chromium.launch(); pg = br.new_page()
            errors = []; bad = []
            pg.on('pageerror', lambda e: errors.append(str(e)))
            pg.on('response', lambda r: bad.append(f'{r.status} {r.url}') if r.status >= 400 and '/api/' in r.url and 'vite.svg' not in r.url else None)
            pg.goto(BASE + '/login'); pg.wait_for_load_state('networkidle')
            pg.fill('input[type="text"], input[name="username"]', 'admin'); pg.fill('input[type="password"]', 'SimAdmin#1')
            pg.keyboard.press('Enter'); pg.wait_for_timeout(2500)
            pg.goto(BASE + '/admin/statutory-flags'); pg.wait_for_selector('[data-testid="statutory-flags-page"]', timeout=15000)
            check('browser: page renders for admin', True)
            check('browser: batch history shows 4 batches', pg.locator('[data-testid="batch-row"]').count() == 4, pg.locator('[data-testid="batch-row"]').count())
            path = os.path.join(DATA, 'pv.xlsx'); open(path, 'wb').write(file_of([HDR, ['SIM07', 'X', 'W', 'Y', 'N', 'Y', '', '', '']]))
            pg.set_input_files('[data-testid="file"]', path)
            pg.click('[data-testid="preview-btn"]'); pg.wait_for_selector('[data-testid="preview-row"]', timeout=15000)
            check('browser: preview shows the row', pg.locator('[data-testid="preview-row"]').count() == 1)
            pg.click('[data-testid="apply-btn"]'); pg.wait_for_selector('[data-testid="confirm"]')
            txt = pg.inner_text('[data-testid="planned-rows"]')
            check('browser: confirm quotes planned rows', '1 freeze + 1 effective' in txt, txt)
            pg.click('[data-testid="confirm-apply"]'); pg.wait_for_timeout(2000)
            check('browser: apply wrote the batch', pg.locator('[data-testid="batch-row"]').count() == 5)
            # Employees → salary modal for SIM01 (flags ON from the upload, then undone → 0; SIM06 seeded ESI/LWF on)
            pg.goto(BASE + '/employees'); pg.wait_for_timeout(2000)
            pg.fill('input[placeholder*="Search"]', 'SIM06'); pg.wait_for_timeout(1200)
            pg.locator('button:has-text("₹")').first.click(); pg.wait_for_selector('[data-testid="ro-esi_applicable"]', timeout=10000)
            pg.wait_for_timeout(1200)
            ro = {k: pg.locator(f'[data-testid="ro-{k}"] input').is_checked() for k in ('pf_applicable', 'esi_applicable', 'lwf_applicable')}
            dis = all(pg.locator(f'[data-testid="ro-{k}"] input').is_disabled() for k in ('pf_applicable', 'esi_applicable', 'lwf_applicable'))
            check('browser: Employees salary modal shows real flags read-only (SIM06 PF off / ESI on / LWF on)', ro == {'pf_applicable': False, 'esi_applicable': True, 'lwf_applicable': True} and dis, ro)
            check('browser: modal links to Statutory Flags', pg.locator('a[href="/admin/statutory-flags"]').count() >= 1)
            if SHOTS: pg.screenshot(path=os.path.join(SHOTS, 'employees-salary-modal.png'))
            pg.keyboard.press('Escape')
            # Sales master edit form
            pg.goto(BASE + '/sales/employees'); pg.wait_for_timeout(2500)
            sales_ok = pg.locator('text=SIMS1').count() >= 1
            check('browser: sales master lists the synthetic sales employees', sales_ok)
            check('browser: 0 page errors', errors == [], errors[:3])
            check('browser: 0 API 4xx/5xx', bad == [], bad[:5])
            if SHOTS: pg.screenshot(path=os.path.join(SHOTS, 'statutory-flags-page.png'))
            br.close()
    except Exception as e:
        check('browser run', False, str(e)[:200])
finally:
    try: srv.terminate(); srv.wait(10)
    except Exception: pass
    log.close()

fails = [n for n, ok in results if not ok]
print(f'\n{len(results) - len(fails)}/{len(results)} checks passed')
if fails: print('FAILED:', fails)
shutil.rmtree(DATA, ignore_errors=True)
sys.exit(1 if fails else 0)
