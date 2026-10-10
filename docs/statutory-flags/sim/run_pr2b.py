#!/usr/bin/env python3
"""Phase 3 simulation — statutory flags PR-2b (sales LWF). THROWAWAY DB ONLY.

A synthetic mirror of the sales payroll around T5: boots backend/server.js on a fresh temp DATA_DIR
(seed_pr2b.js), real logins (admin / hr / finance), the real sales compute route for August and
September BEFORE the upload (as production did), September hold / NEFT export / paid moves through
the real routes, the real statutory upload (sales scope, preview → apply, effective 2026-09), then
August re-run, September re-run (the RUNBOOK 6A shape) and October (the first live month) over HTTP,
HR edits (PUT /api/sales/salary/:id), payslip, register totals and the register Excel, and the
VERIFY.sql V8 / V13 / V14 statements read straight from docs/statutory-flags/VERIFY.sql.

  python3 docs/statutory-flags/sim/run_pr2b.py <repo-under-test> [--base] [--dump out.json]
  python3 docs/statutory-flags/sim/run_pr2b.py --compare branch.json base.json

--base     the code under test is pre-PR-2b (a worktree at ad96604): run the same flow, skip the LWF
           checks, only dump.
--dump     write every August / September / October sales salary row (volatile columns stripped) as JSON.
--compare  branch dump vs base dump: every row with lwf_employee = 0 on the branch is identical in every
           column; every flagged row differs only by the LWF lines (lwf_* 5/20; total +5 / net −5, or the
           loan −5 where the 50% cap binds; every other component identical).
Exit 0 only if every check passes. The temp DATA_DIR is deleted at the end.
"""
import json, os, sqlite3, subprocess, sys, tempfile, time, urllib.request, urllib.parse, shutil, base64, re

HERE = os.path.dirname(os.path.abspath(__file__))
VOLATILE = {'id', 'computed_at', 'created_at', 'updated_at'}
STAMPS = {'neft_exported_at', 'finalized_at', 'payslip_generated_at'}  # wall-clock values: compared as present / absent

if '--compare' in sys.argv:
    i = sys.argv.index('--compare')
    br, bs = (json.load(open(p)) for p in sys.argv[i + 1:i + 3])
    fails = []; n_flag = n_same = 0
    for month in ('aug', 'sep', 'oct'):
        if sorted(br[month]) != sorted(bs[month]):
            fails.append(f'{month}: row sets differ {sorted(set(br[month]) ^ set(bs[month]))}'); continue
        for code in sorted(br[month]):
            b, s = br[month][code], bs[month][code]
            diff = sorted(k for k in b if k not in STAMPS and b[k] != s.get(k))
            stamps = [k for k in STAMPS if bool(b.get(k)) != bool(s.get(k))]
            if stamps: fails.append(f'{month} {code}: stamp presence differs {stamps}')
            if b['lwf_employee'] == 0:
                n_same += 1
                if diff: fails.append(f'{month} {code} (unflagged): differs in {diff}')
                continue
            n_flag += 1
            if not set(diff) <= {'lwf_employee', 'lwf_employer', 'total_deductions', 'net_salary', 'loan_recovery'}:
                fails.append(f'{month} {code}: differs outside the LWF lines {diff}')
            if (b['lwf_employee'], b['lwf_employer'], s['lwf_employee'], s['lwf_employer']) != (5, 20, 0, 0):
                fails.append(f'{month} {code}: LWF {b["lwf_employee"]}/{b["lwf_employer"]} vs base {s["lwf_employee"]}/{s["lwf_employer"]}')
            other_b = b['total_deductions'] - b['lwf_employee'] - b['loan_recovery']
            other_s = s['total_deductions'] - s['loan_recovery']
            if abs(other_b - other_s) > 0.005: fails.append(f'{month} {code}: non-LWF, non-loan deductions differ {other_b} vs {other_s}')
            if abs((b['net_salary'] - s['net_salary']) + (b['total_deductions'] - s['total_deductions'])) > 0.005:
                fails.append(f'{month} {code}: net moved by more than the total')
            if abs((b['total_deductions'] - s['total_deductions']) + (s['loan_recovery'] - b['loan_recovery']) - 5) > 0.005:
                fails.append(f'{month} {code}: LWF effect is not exactly ₹5 (total +{b["total_deductions"] - s["total_deductions"]}, loan {b["loan_recovery"] - s["loan_recovery"]})')
    print(f'compare: {n_same} unflagged rows identical in every column, {n_flag} flagged rows differ only by the LWF lines' if not fails else 'compare FAILED')
    for f in fails: print('  FAIL', f)
    sys.exit(1 if fails else 0)

REPO = sys.argv[1]
BASE_MODE = '--base' in sys.argv
DUMP = sys.argv[sys.argv.index('--dump') + 1] if '--dump' in sys.argv else None
BACKEND = os.path.join(REPO, 'backend')
DATA = tempfile.mkdtemp(prefix='lwf-sales-sim-')
PORT = 3928
URL = f'http://127.0.0.1:{PORT}'
CO = 'Indriyan Beverages Pvt Ltd'
CQ = urllib.parse.quote(CO)
results = []

def check(name, ok, detail=''):
    results.append((name, bool(ok)))
    print(('PASS ' if ok else 'FAIL ') + name + (f'  [{detail}]' if detail != '' else ''), flush=True)

out = subprocess.run(['node', os.path.join(HERE, 'seed_pr2b.js'), DATA, BACKEND], capture_output=True, text=True, cwd=BACKEND)
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
    data = None; h = dict(headers or {})
    if body is not None and not isinstance(body, bytes):
        data = json.dumps(body).encode(); h['Content-Type'] = 'application/json'
    elif isinstance(body, bytes):
        data = body
    if token: h['Authorization'] = 'Bearer ' + token
    r = urllib.request.Request(URL + path, data=data, method=method, headers=h)
    try:
        with urllib.request.urlopen(r, timeout=120) as resp:
            b = resp.read(); return resp.status, (b if raw else json.loads(b or b'{}'))
    except urllib.error.HTTPError as e:
        b = e.read()
        try: return e.code, json.loads(b)
        except Exception: return e.code, b

def multipart(path, token, fields, file_bytes, file_name='flags.xlsx'):
    boundary = '----lwfsalessim' + str(time.time()).replace('.', '')
    parts = [f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode() for k, v in fields.items()]
    parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{file_name}"\r\nContent-Type: application/octet-stream\r\n\r\n'.encode())
    parts += [file_bytes, b'\r\n', f'--{boundary}--\r\n'.encode()]
    return req('POST', path, token, b''.join(parts), headers={'Content-Type': f'multipart/form-data; boundary={boundary}'})

def login(u, p):
    s, b = req('POST', '/api/auth/login', body={'username': u, 'password': p})
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

def rows_of(m):
    out = {}
    for r in sql('SELECT * FROM sales_salary_computations WHERE month=? AND year=2026 AND company=? ORDER BY employee_code', m, CO):
        d = {k: v for k, v in r.items() if k not in VOLATILE}
        if isinstance(d.get('sunday_rule_trace'), str):
            d['sunday_rule_trace'] = re.sub(r'"computedAt":"[^"]*"', '"computedAt":"-"', d['sunday_rule_trace'])
        out[r['employee_code']] = d
    return out

def verify_sql(tag, month=None):
    """The statement under '-- <tag> …' in docs/statutory-flags/VERIFY.sql; month=N rewrites its literal month (V8: 9, V14: 10)."""
    text = open(os.path.join(HERE, '..', 'VERIFY.sql')).read()
    m = re.search(r'^-- ' + tag + r'\b.*?\n((?:--.*\n)*)(SELECT[^\n]*;)', text, re.M)
    q = m.group(2)
    if month is not None:
        q = re.sub(r'sc\.month=\d+', f'sc.month={month}', q)
        q = re.sub(r"'2026-\d\d'", f"'2026-{month:02d}'", q)
        q = re.sub(r'\bmonth=\d+ AND year=2026', f'month={month} AND year=2026', q)
    return q

def diff_keys(a, b, ignore=STAMPS):
    return sorted(k for k in a if k not in ignore and a[k] != b.get(k))

FLAGGED_PAID = ['F01', 'F02', 'F03', 'F04', 'F05', 'F06']
try:
    admin = login('admin', 'SimAdmin#1'); hr = login('hr', 'SimHr#1'); fin = login('finance', 'SimFin#1')
    check('real logins admin/hr/finance', admin and hr and fin)

    def compute(m, tag):
        s, b = req('POST', '/api/sales/compute', hr, {'month': m, 'year': 2026, 'company': CO})
        check(f'sales compute {m}/2026 {tag} → 200', s == 200, s if s == 200 else str(b)[:200])
        return b.get('data', {}) if s == 200 else {}

    compute(8, '(before the upload)')
    aug0 = rows_of(8)
    compute(9, '(before the upload — as production computed September)')
    check('Z02 zero-gross structure → excluded, no row (Aug + Sep)', 'Z02' not in aug0 and 'Z02' not in rows_of(9))

    # ── September after its compute, before T5: holds, NEFT export, one row paid (production: 187 exported + 15 hold) ──
    sep_ids = {c: r['id'] for c, r in ((x['employee_code'], x) for x in sql('SELECT id, employee_code FROM sales_salary_computations WHERE month=9 AND year=2026'))}
    for c in ('F04', 'U03'):
        s, _ = req('PUT', f'/api/sales/salary/{sep_ids[c]}/status', hr, {'status': 'hold'})
        check(f'{c} → hold (status route)', s == 200, s)
    s, _ = req('GET', f'/api/sales/export/bank-neft?month=9&year=2026&company={CQ}&download=true', hr, raw=True)
    exported = sorted(r['employee_code'] for r in sql('SELECT employee_code FROM sales_salary_computations WHERE month=9 AND year=2026 AND neft_exported_at IS NOT NULL'))
    check('September NEFT export (download) stamps every non-hold row with pay', s == 200 and 'F04' not in exported and 'U03' not in exported and 'F05' in exported and 'Z01' not in exported, exported)
    for to in ('reviewed', 'finalized', 'paid'):
        s, b = req('PUT', f'/api/sales/salary/{sep_ids["F05"]}/status', hr, {'status': to})
        check(f'F05 → {to} (status route)', s == 200, s if s == 200 else str(b)[:150])
    sep0 = rows_of(9)

    # ── the owner's T5 upload: LWF list (+ ESI for F02 / U01) effective September ──
    HDR = ['code', 'company', 'name', 'esi_applicable', 'pf_applicable', 'lwf_applicable', 'esi_number', 'uan', 'note']
    rows = [HDR] + [[c, CO, 'X', 'Y' if c == 'F02' else 'N', 'N', 'Y', '', '', ''] for c in FLAGGED_PAID + ['Z01', 'Z02']] \
                 + [['U01', CO, 'X', 'Y', 'N', 'N', '', '', ''], ['U03', CO, 'X', 'N', 'N', 'N', '', '', '']]
    f = xlsx_file(rows)
    s, pv = multipart('/api/statutory-flags/preview', admin, {'scope': 'sales', 'effectiveMonth': '2026-09'}, f)
    check('sales upload preview 200', s == 200, s)
    s, ap = multipart('/api/statutory-flags/apply', admin, {'scope': 'sales', 'effectiveMonth': '2026-09', 'expectedSha256': pv.get('sha256')}, f)
    check('sales upload apply 200', s == 200, s if s == 200 else str(ap)[:200])

    compute(8, '(re-run after the upload)')
    aug1 = rows_of(8)
    check('August re-run after the upload: every row byte-identical', aug1 == aug0, [c for c in aug0 if aug0[c] != aug1.get(c)][:5])
    sep_out = compute(9, '(6A shape: re-run after the upload)')
    sep1 = rows_of(9)
    oct_out = compute(10, '(first live month)')

    for m, tag in ((8, 'Aug'), (9, 'Sep'), (10, 'Oct')):
        v8 = sql(verify_sql('V8', m))
        check(f'V8 sales identity (VERIFY.sql) {tag} → 0 rows', v8 == [], v8[:3])
    v13 = sql(verify_sql('V13'))
    check('V13 sales component check (VERIFY.sql, 7 components + LWF, every month) → 0 rows', v13 == [], v13[:3])

    if not BASE_MODE:
        oct1 = rows_of(10)
        for m, rs in ((9, sep1), (10, oct1)):
            lwf_rows = sorted(c for c, r in rs.items() if r['lwf_employee'] > 0)
            check(f'{m}/2026: N = {len(FLAGGED_PAID)} flagged reps with pay carry LWF (incl. held F04, paid F05, loan F06)', lwf_rows == FLAGGED_PAID, lwf_rows)
            tot = sql('SELECT SUM(lwf_employee) ee, SUM(lwf_employer) er FROM sales_salary_computations WHERE month=? AND year=2026', m)[0]
            check(f'{m}/2026 totals = N×5 / N×20 = 30 / 120', (tot['ee'], tot['er']) == (30, 120), tot)
            check(f'{m}/2026 every flagged-with-pay row is exactly 5 / 20', all((rs[c]['lwf_employee'], rs[c]['lwf_employer']) == (5, 20) for c in FLAGGED_PAID))
            check(f'{m}/2026 Z01 flagged, 0 days given → row saved, gross_earned 0, LWF 0 / 0',
                  'Z01' in rs and rs['Z01']['gross_earned'] == 0 and (rs['Z01']['lwf_employee'], rs['Z01']['lwf_employer']) == (0, 0))
            check(f'{m}/2026 unflagged U01–U03 → 0 / 0', all((rs[c]['lwf_employee'], rs[c]['lwf_employer']) == (0, 0) for c in ('U01', 'U02', 'U03')))
        check('Z02 still excluded in Sep + Oct (no row)', 'Z02' not in sep1 and 'Z02' not in oct1)
        check('August stays LWF 0 for everyone', all(r['lwf_employee'] == 0 and r['lwf_employer'] == 0 for r in aug1.values()))
        for tag, m in (('V14 as written (October)', None), ('V14 rewritten for September (6A)', 9)):
            v14 = sql(verify_sql('V14', m))
            check(f'{tag} → 0 rows', v14 == [], v14[:3])

        # 6A shape: what the September re-run did to locked / exported / held rows
        check('F05 paid + NEFT: status paid, stamps kept, net −5', sep1['F05']['status'] == 'paid' and sep1['F05']['neft_exported_at'] == sep0['F05']['neft_exported_at']
              and sep1['F05']['finalized_at'] == sep0['F05']['finalized_at'] and abs(sep1['F05']['net_salary'] - (sep0['F05']['net_salary'] - 5)) < 0.005)
        warns = sep_out.get('finalizedRecomputeWarnings', [])
        check('finalizedRecomputeWarnings lists F05 with delta −5 (and only locked rows)', [(w['employee_code'], w['prev_status'], w['delta']) for w in warns] == [('F05', 'paid', -5)], warns)
        check('every NEFT stamp survives the re-run', all(sep1[c]['neft_exported_at'] == sep0[c]['neft_exported_at'] for c in sep0))
        check('F04 on hold: still hold, charged 5 / 20', sep1['F04']['status'] == 'hold' and sep1['F04']['lwf_employee'] == 5)
        same = {c: diff_keys(sep1[c], sep0[c]) for c in ('U02', 'U03')}
        check('unchanged-flag reps (U02 not in file, U03 unchanged + hold): September identical in every column', all(v == [] for v in same.values()), same)
        lwf_only = {c: diff_keys(sep1[c], sep0[c]) for c in ('F01', 'F03', 'F04', 'F05', 'F06')}
        check('LWF-only reps: September differs ONLY in lwf_*, total (+5), net (−5)',
              all(v == ['lwf_employee', 'lwf_employer', 'net_salary', 'total_deductions'] for v in lwf_only.values())
              and all(abs(sep1[c]['total_deductions'] - sep0[c]['total_deductions'] - 5) < 0.005 for c in lwf_only), lwf_only)
        check('F02 (ESI + LWF) differs only in ESI + LWF lines; U01 (ESI only) only in ESI lines',
              diff_keys(sep1['F02'], sep0['F02']) == ['esi_employee', 'esi_employer', 'lwf_employee', 'lwf_employer', 'net_salary', 'total_deductions']
              and diff_keys(sep1['U01'], sep0['U01']) == ['esi_employee', 'esi_employer', 'net_salary', 'total_deductions'],
              (diff_keys(sep1['F02'], sep0['F02']), diff_keys(sep1['U01'], sep0['U01'])))
        check('F06 loan unchanged by LWF where the cap does not bind (3334 both runs)', sep0['F06']['loan_recovery'] == 3334 and sep1['F06']['loan_recovery'] == 3334)

    # ── HR edits on October (Q6 shape) — run in both modes so the dumps compare ──
    oct_ids = {r['employee_code']: r['id'] for r in sql('SELECT id, employee_code FROM sales_salary_computations WHERE month=10 AND year=2026')}
    s, e06 = req('PUT', f'/api/sales/salary/{oct_ids["F06"]}', hr, {'other_deductions': 9000})
    s1, e01 = req('PUT', f'/api/sales/salary/{oct_ids["F01"]}', hr, {'other_deductions': 100})
    s2, eu2 = req('PUT', f'/api/sales/salary/{oct_ids["U02"]}', hr, {'other_deductions': 100})
    s3, _ = req('PUT', f'/api/sales/salary/{sep_ids["F05"]}', hr, {'other_deductions': 100})
    check('HR edits 200 / 200 / 200; paid September row → 409 (N3)', (s, s1, s2, s3) == (200, 200, 200, 409), (s, s1, s2, s3))
    if not BASE_MODE:
        d06 = e06.get('data', {})
        check('F06 edit other 9000 → loan 995, total 10000, net 10000 (LWF ranks above the loan)',
              (d06.get('lwf_employee'), d06.get('loan_recovery'), d06.get('total_deductions'), d06.get('net_salary')) == (5, 995, 10000, 10000), d06.get('loan_recovery'))
        check('F01 edit other 100 → total 105 (LWF + other); U02 → total 100 (old formula)',
              e01['data']['total_deductions'] == 105 and eu2['data']['total_deductions'] == 100, (e01['data']['total_deductions'], eu2['data']['total_deductions']))
        led = sql("SELECT amount, state FROM loan_deductions WHERE employee_code='F06' AND month=10 AND year=2026 AND payroll='sales'")
        check('F06 ledger = the edited loan (995, provisional)', led == [{'amount': 995, 'state': 'provisional'}], led)
    oct_edit = rows_of(10)
    compute(10, '(after the HR edits)')
    oct2 = rows_of(10)
    check('October compute after the edits reproduces the edited rows (K30)', oct2 == oct_edit, [c for c in oct_edit if oct_edit[c] != oct2.get(c)][:5])

    if not BASE_MODE:
        s, p = req('GET', f'/api/sales/payslip/F01?month=10&year=2026&company={CQ}', hr)
        ded = {d['label']: d['amount'] for d in p['data']['deductions']} if s == 200 else {}
        check('payslip F01: LWF (Employee) 5, lwfEmployer 20, lines sum to the total',
              ded.get('LWF (Employee)') == 5 and p['data']['lwfEmployer'] == 20 and abs(sum(ded.values()) - p['data']['totalDeductions']) < 0.01, ded)
        s, p = req('GET', f'/api/sales/payslip/U02?month=10&year=2026&company={CQ}', hr)
        check('payslip U02 (unflagged): no LWF line, lwfEmployer 0',
              s == 200 and not any('LWF' in d['label'] for d in p['data']['deductions']) and p['data']['lwfEmployer'] == 0)
        s, reg = req('GET', f'/api/sales/salary-register?month=10&year=2026&company={CQ}', hr)
        t = reg.get('data', {}).get('totals', {}) if s == 200 else {}
        check('salary-register totals LWF 30 / 120', (t.get('lwf_employee'), t.get('lwf_employer')) == (30, 120), t)
        s, pv = req('GET', f'/api/sales/export/salary-register?month=10&year=2026&company={CQ}', hr)
        t2 = pv.get('data', {}).get('totals', {}) if s == 200 else {}
        check('Excel JSON preview totals LWF 30 / 120', (t2.get('lwf_employee'), t2.get('lwf_employer')) == (30, 120), t2)
        s, b = req('GET', f'/api/sales/export/salary-register?month=10&year=2026&company={CQ}&download=true', hr, raw=True)
        x = read_xlsx(b)['Sales Salary Register'] if s == 200 else None
        hdr = x['rows'][0] if x else []
        f01 = next((r for r in x['rows'] if r and r[0] == 'F01'), []) if x else []
        check('register Excel: header = width = !cols = every row = 39; LWF Employee at 25; F01 LWF 5, next column PT',
              x and len(hdr) == 39 and x['width'] == 39 and x['cols'] == 39 and all(len(r) == 39 for r in x['rows'])
              and hdr.index('LWF Employee') == 25 and hdr[26] == 'PT' and f01[25] == 5
              and f01[hdr.index('Total Deductions')] == oct2['F01']['total_deductions'] and f01[hdr.index('Net Salary')] == oct2['F01']['net_salary'],
              (len(hdr), x and x['cols'], f01[25] if f01 else None))
        s, _ = req('GET', f'/api/sales/salary-register?month=10&year=2026&company={CQ}', fin)
        check('finance login: sales register stays HR/admin only (403, unchanged)', s == 403, s)

    if DUMP:
        json.dump({'aug': aug1, 'sep': sep1, 'oct': oct2}, open(DUMP, 'w'), indent=1, sort_keys=True, default=str)
        print('dumped', len(aug1), 'Aug +', len(sep1), 'Sep +', len(oct2), 'Oct rows to', DUMP)
finally:
    try: srv.terminate(); srv.wait(10)
    except Exception: pass
    log.close()

fails = [n for n, ok in results if not ok]
print(f'\n{len(results) - len(fails)}/{len(results)} checks passed' + (' (base mode: LWF checks skipped)' if BASE_MODE else ''))
if fails:
    print('FAILED:', fails)
    print(open(os.path.join(DATA, 'server.log')).read()[-2000:])
shutil.rmtree(DATA, ignore_errors=True)
sys.exit(1 if fails else 0)
