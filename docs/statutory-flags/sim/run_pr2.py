#!/usr/bin/env python3
"""Phase 3 simulation — statutory flags PR-2 (plant LWF). THROWAWAY DB ONLY.

A synthetic mirror of today's plant September run: boots backend/server.js on a fresh
temp DATA_DIR (seed_pr2.js), real logins (admin / hr / finance), the real statutory
upload (preview → apply, effective 2026-09), real Stage 6 + Stage 7 over HTTP for
August (before and after the upload) and September, then the plant outputs
(payslip, register totals, finance report, both Excel exports) and the VERIFY.sql
V5 / V11 / V12 statements read straight from docs/statutory-flags/VERIFY.sql.

  python3 docs/statutory-flags/sim/run_pr2.py <repo-under-test> [--base] [--dump out.json]

--base   the code under test is pre-PR-2 (e.g. a worktree at 66c6a08): run the same flow,
         skip the LWF checks, only dump. Compare the two dumps to prove that everyone not
         on the LWF list is byte-identical and that flagged rows differ only by the LWF lines.
--dump   write every August + September salary row (volatile columns stripped) as JSON.
Exit 0 only if every check passes. The temp DATA_DIR is deleted at the end.
"""
import json, os, sqlite3, subprocess, sys, tempfile, time, urllib.request, shutil, base64, re

REPO = sys.argv[1]
BASE_MODE = '--base' in sys.argv
DUMP = sys.argv[sys.argv.index('--dump') + 1] if '--dump' in sys.argv else None
BACKEND = os.path.join(REPO, 'backend')
HERE = os.path.dirname(os.path.abspath(__file__))
DATA = tempfile.mkdtemp(prefix='lwf-sim-')
PORT = 3927
URL = f'http://127.0.0.1:{PORT}'
CO = 'Indriyan Beverages Pvt Ltd'
results = []

def check(name, ok, detail=''):
    results.append((name, bool(ok)))
    print(('PASS ' if ok else 'FAIL ') + name + (f'  [{detail}]' if detail != '' else ''), flush=True)

out = subprocess.run(['node', os.path.join(HERE, 'seed_pr2.js'), DATA, BACKEND], capture_output=True, text=True, cwd=BACKEND)
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
    boundary = '----lwfsim' + str(time.time()).replace('.', '')
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
    """{sheet: {rows, cols, merges, comments:[[r,c]]}} via SheetJS (cellStyles so !cols round-trips)."""
    p = os.path.join(DATA, 'x.xlsx'); open(p, 'wb').write(buf)
    return json.loads(node_js('''const X=require("xlsx");const wb=X.readFile(process.argv[1],{cellStyles:true});const o={};
for(const n of wb.SheetNames){const ws=wb.Sheets[n];const cm=[];for(const k of Object.keys(ws)){if(k[0]==="!")continue;
if(ws[k].c&&ws[k].c.length){const a=X.utils.decode_cell(k);cm.push([a.r,a.c]);}}
o[n]={rows:X.utils.sheet_to_json(ws,{header:1,defval:"",blankrows:true}),width:X.utils.decode_range(ws["!ref"]).e.c+1,
cols:(ws["!cols"]||[]).length,merges:(ws["!merges"]||[]).map(m=>m.e.c),comments:cm};}
process.stdout.write(JSON.stringify(o));''', p))

DB = os.path.join(DATA, 'hr_system.db')
def sql(q, *a):
    c = sqlite3.connect(DB); c.row_factory = sqlite3.Row
    try: return [dict(r) for r in c.execute(q, a).fetchall()]
    finally: c.close()

VOLATILE = {'id', 'computed_at', 'created_at', 'updated_at', 'ai_explanation', 'ai_explanation_at', 'finalised_at'}
def salary_rows(m, y):
    return {r['employee_code']: {k: v for k, v in r.items() if k not in VOLATILE}
            for r in sql('SELECT * FROM salary_computations WHERE month=? AND year=? ORDER BY employee_code', m, y)}

def verify_sql(tag):
    """The statement under '-- <tag> …' in docs/statutory-flags/VERIFY.sql (the doc's own SQL)."""
    text = open(os.path.join(HERE, '..', 'VERIFY.sql')).read()
    m = re.search(r'^-- ' + tag + r'\b.*?\n((?:--.*\n)*)(SELECT[^\n]*;)', text, re.M)
    return m.group(2)

FLAGGED_PAID = ['F01', 'F02', 'F03', 'F04', 'F05', 'F06', 'F07', 'F08']
try:
    admin = login('admin', 'SimAdmin#1'); hr = login('hr', 'SimHr#1'); fin = login('finance', 'SimFin#1')
    check('real logins admin/hr/finance', admin and hr and fin)

    def stage67(m, tag):
        s, _ = req('POST', '/api/payroll/calculate-days', hr, {'month': m, 'year': 2026, 'company': CO})
        s2, b = req('POST', '/api/payroll/compute-salary', hr, {'month': m, 'year': 2026, 'company': CO})
        check(f'Stage 6 + 7 {m}/2026 {tag} → 200/200', s == 200 and s2 == 200, f'{s}/{s2}')

    stage67(8, '(before the upload)')
    aug0 = salary_rows(8, 2026)

    # ── the owner's T4 upload: LWF list (+ PF/ESI for some) effective September ──
    HDR = ['code', 'name', 'type', 'esi_applicable', 'pf_applicable', 'lwf_applicable', 'esi_number', 'uan', 'note']
    rows = [HDR] + [[c, 'X', 'W', 'Y' if c in ('F04', 'F05') else 'N', 'Y' if c in ('F04', 'F05') else 'N', 'Y', '', '', '']
                    for c in FLAGGED_PAID + ['Z01', 'Z02']] \
                 + [['U01', 'X', 'W', 'Y', 'Y', 'N', '', '', ''], ['U02', 'X', 'W', 'Y', 'Y', 'N', '', '', ''],
                    ['U04', 'X', 'W', 'N', 'N', 'N', '', '', ''], ['U05', 'X', 'W', 'N', 'N', 'N', '', '', '']]
    f = xlsx_file(rows)
    s, pv = multipart('/api/statutory-flags/preview', admin, {'scope': 'plant', 'effectiveMonth': '2026-09'}, f)
    check('upload preview 200', s == 200, s)
    s, ap = multipart('/api/statutory-flags/apply', admin, {'scope': 'plant', 'effectiveMonth': '2026-09', 'expectedSha256': pv.get('sha256')}, f)
    check('upload apply 200', s == 200, s if s == 200 else str(ap)[:200])

    stage67(8, '(re-run after the upload)')
    aug1 = salary_rows(8, 2026)
    check('August re-run after the upload: every row byte-identical', aug1 == aug0,
          [c for c in aug0 if aug0[c] != aug1.get(c)][:5])
    stage67(9, '(after the upload)')
    sep = salary_rows(9, 2026)

    drift = sql(verify_sql('V5'))
    check('V5 drift identity (VERIFY.sql) → 0 rows', drift == [], drift[:3])

    if not BASE_MODE:
        lwf_rows = sorted(c for c, r in sep.items() if r['lwf_employee'] > 0)
        n = len(FLAGGED_PAID)
        check(f'N = {n} flagged employees with pay carry LWF (incl. held F08 + contractor F07)', lwf_rows == FLAGGED_PAID, lwf_rows)
        tot = sql('SELECT SUM(lwf_employee) ee, SUM(lwf_employer) er FROM salary_computations WHERE month=9 AND year=2026')[0]
        check(f'September totals = N×5 / N×20 = {n*5} / {n*20}', (tot['ee'], tot['er']) == (n * 5, n * 20), tot)
        check('every flagged-with-pay row is exactly 5 / 20', all((sep[c]['lwf_employee'], sep[c]['lwf_employer']) == (5, 20) for c in FLAGGED_PAID))
        check('Z01 flagged, zero gross → row saved, gross_earned 0, LWF 0 / 0',
              'Z01' in sep and sep['Z01']['gross_earned'] == 0 and (sep['Z01']['lwf_employee'], sep['Z01']['lwf_employer']) == (0, 0),
              sep.get('Z01', {}).get('gross_earned'))
        check('Z02 flagged, no September attendance → no salary row', 'Z02' not in sep)
        check('F08 held salary is still charged 5 / 20', sep['F08']['salary_held'] == 1 and sep['F08']['lwf_employee'] == 5, sep['F08']['hold_reason'])
        check('F07 contractor on the list → 5 / 20, OT 0', sep['F07']['is_contractor'] == 1 and sep['F07']['lwf_employee'] == 5 and sep['F07']['ot_pay'] == 0)
        check('unflagged U01–U05 → 0 / 0 (U01/U02 PF+ESI on, U05 held, U04 contractor, U03 not in file)',
              all((sep[c]['lwf_employee'], sep[c]['lwf_employer']) == (0, 0) for c in ['U01', 'U02', 'U03', 'U04', 'U05']))
        check('August stays LWF 0 for everyone', all(r['lwf_employee'] == 0 and r['lwf_employer'] == 0 for r in aug1.values()))
        v11 = sql(verify_sql('V11'))
        check('V11 component check (VERIFY.sql, 10 components + LWF) → 0 rows', v11 == [], v11[:3])
        v12 = sql(verify_sql('V12'))
        check('V12 September LWF rule (VERIFY.sql) → 0 rows', v12 == [], v12[:3])

        s, p = req('GET', '/api/payroll/payslip/F01?month=9&year=2026', admin)
        ded = {d['label']: d['amount'] for d in p['data']['deductions']} if s == 200 else {}
        check('payslip F01: LWF (Employee) 5, lwfEmployer 20, deductions sum to the total',
              ded.get('LWF (Employee)') == 5 and p['data']['lwfEmployer'] == 20 and abs(sum(ded.values()) - p['data']['totalDeductions']) < 0.01, ded)
        s, p = req('GET', '/api/payroll/payslip/U01?month=9&year=2026', admin)
        check('payslip U01 (unflagged): no LWF line, lwfEmployer 0',
              s == 200 and not any('LWF' in d['label'] for d in p['data']['deductions']) and p['data']['lwfEmployer'] == 0)
        s, reg = req('GET', f'/api/payroll/salary-register?month=9&year=2026&company={urllib.parse.quote(CO)}', fin)
        check('salary-register totals LWF 40 / 160 (finance login)', s == 200 and (reg['totals'].get('totalLWFEmployee'), reg['totals'].get('totalLWFEmployer')) == (40, 160), reg.get('totals', {}).get('totalLWFEmployee'))
        s, rep = req('GET', '/api/finance-audit/report?month=9&year=2026', fin)
        d = rep.get('data') if s == 200 else None
        rr = {x['code']: x for x in ((d.get('rows') if isinstance(d, dict) else d) or [])}
        check('finance-audit report: F01 lwfEmployee 5 / lwfEmployer 20, U01 0', rr.get('F01', {}).get('lwfEmployee') == 5 and rr.get('F01', {}).get('lwfEmployer') == 20 and rr.get('U01', {}).get('lwfEmployee') == 0)

        s, b = req('GET', f'/api/payroll/salary-register-excel?month=9&year=2026&company={urllib.parse.quote(CO)}', fin, raw=True)
        x = read_xlsx(b)['PAYROLL REGISTER'] if s == 200 else None
        hdr = x['rows'][3] if x else []
        tot_row = next((r for r in x['rows'] if r and r[0] == 'TOTAL'), []) if x else []
        check('register Excel: header = width = !cols = 39; LWF(EE)/LWF(ER) after ESI(ER); totals 40 / 160',
              x and len(hdr) == 39 and x['width'] == 39 and x['cols'] == 39 and hdr.index('LWF(EE)') == hdr.index('ESI(ER)') + 1
              and (tot_row[hdr.index('LWF(EE)')], tot_row[hdr.index('LWF(ER)')]) == (40, 160),
              (len(hdr), x and x['cols']))
        s, b = req('GET', f'/api/payroll/salary-slip-excel?month=9&year=2026&company={urllib.parse.quote(CO)}', fin, raw=True)
        y = read_xlsx(b)['SUMMARY'] if s == 200 else None
        h2 = y['rows'][3] if y else []
        held_idx = next((i for i, r in enumerate(y['rows']) if len(r) > 1 and r[1] == 'F08'), -1) if y else -1
        tot2 = next((r for r in y['rows'] if len(r) > 2 and r[2] == 'TOTAL'), []) if y else []
        check('slip Excel SUMMARY: header = width = !cols = 20; LWF after ESI; totals LWF 40; held F08 comments on cols 16/17/18',
              y and len(h2) == 20 and y['width'] == 20 and y['cols'] == 20 and h2.index('LWF') == h2.index('ESI') + 1
              and tot2[h2.index('LWF')] == 40 and sorted(c for r, c in y['comments'] if r == held_idx) == [16, 17, 18],
              (len(h2), y and y['cols'], sorted(c for r, c in (y['comments'] if y else []) if r == held_idx)))

    if DUMP:
        json.dump({'aug': aug1, 'sep': sep}, open(DUMP, 'w'), indent=1, sort_keys=True, default=str)
        print('dumped', len(aug1), 'August +', len(sep), 'September rows to', DUMP)
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
