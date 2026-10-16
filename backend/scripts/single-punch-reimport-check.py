#!/usr/bin/env python3
"""Single-punch miss punch through a REAL EESL import + reimport (review fix, 16 Oct 2026).
Real server.js, scratch DB, hr + finance logins, synthetic October 2026 .xls (fictional T17xx). T1701 has one
evening punch on 7 Oct (EESL: A, 19:22). Checks: import flags it Missing IN; HR resolves → P (finance pending);
Stage 6 does not pay it yet; a REIMPORT of the same file keeps the flag + resolution (finance still pending,
still not paid); dedupe re-detect keeps it too; finance approves → Stage 6 pays it."""
import json, os, sqlite3, subprocess, sys, tempfile, time, urllib.request
ROOT = os.environ.get('APP_ROOT', os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..')))
PORT = 3434; BASE = f'http://127.0.0.1:{PORT}'
WORK = tempfile.mkdtemp(prefix='sp-reimp-'); DB = os.path.join(WORK, 'hr_system.db'); P = F = 0
BUILD_JS = r"""
const XLSX = require(process.argv[2]); const out = process.argv[3];
const AB = ['S','M','T','W','Th','F','St']; const heads = [], st = [], tin = [], tout = [], tot = [];
for (let d = 1; d <= 31; d++) { const wd = new Date(Date.UTC(2026, 9, d)).getUTCDay(); heads.push(`${d} ${AB[wd]}`);
  const off = wd === 0; st.push(off ? 'WO' : 'P'); tin.push(off ? '' : '07:58'); tout.push(off ? '' : '20:02'); tot.push(off ? '00:00' : '12:04'); }
const rows = [['Monthly Status Report (Basic Work Duration)'], ['Oct 01 2026  To  Oct 31 2026'], ['Company:', 'Asian Lakto Ind Ltd'], [], ['Days', ...heads], ['Department:', 'TEST DEPT']];
[['T1701', 'TEST EMP 1'], ['T1702', 'TEST EMP 2']].forEach(([c, n]) => {
  const s = [...st], i = [...tin], o = [...tout], t = [...tot];
  if (c === 'T1701') { s[6] = 'A'; i[6] = '19:22'; o[6] = ''; t[6] = '00:38'; }
  rows.push(['Emp. Code :', c, 'Emp. Name :', n]); rows.push(['Status', ...s]); rows.push(['InTime', ...i]); rows.push(['OutTime', ...o]); rows.push(['Total', ...t]); rows.push([]); });
const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Sheet1'); XLSX.writeFile(wb, out, { bookType: 'biff8' });
"""
def chk(l, e, a):
    global P, F
    if e == a: P += 1; print('  ✓', l)
    else: F += 1; print('  ✗', l, 'expected', repr(e), 'got', repr(a))
def req(m, path, tok=None, body=None):
    r = urllib.request.Request(BASE + path, method=m, data=json.dumps(body).encode() if body is not None else None,
        headers={'Content-Type': 'application/json', **({'Authorization': 'Bearer ' + tok} if tok else {})})
    try:
        with urllib.request.urlopen(r) as x: return x.status, json.loads(x.read() or b'{}')
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b'{}')
def upload(tok, path):
    out = subprocess.run(['curl', '-s', '-H', f'Authorization: Bearer {tok}', '-F', f'files=@{path}', '-F', 'month=10', '-F', 'year=2026',
                          BASE + '/api/import/upload'], capture_output=True, text=True).stdout
    return json.loads(out or '{}')
def row():
    c = sqlite3.connect(DB); r = c.execute("SELECT is_miss_punch, miss_punch_type, miss_punch_resolved, COALESCE(miss_punch_finance_status,''), status_original, status_final FROM attendance_processed WHERE in_time_original='19:22' AND date='2026-10-07'").fetchone(); c.close(); return r
def present():
    c = sqlite3.connect(DB); r = c.execute("SELECT days_present FROM day_calculations WHERE employee_code=(SELECT employee_code FROM attendance_processed WHERE in_time_original='19:22' AND date='2026-10-07') AND month=10 AND year=2026").fetchone(); c.close(); return r[0] if r else None
env = dict(os.environ, DATA_DIR=WORK, JWT_SECRET='x', PORT=str(PORT), NODE_ENV='production', ADMIN_PASSWORD='Admin@123', HR_PASSWORD='Indriyan@2025', FINANCE_PASSWORD='Finance@2025')
srv = subprocess.Popen(['node', f'{ROOT}/backend/server.js'], env=env, stdout=open(f'{WORK}/log', 'w'), stderr=subprocess.STDOUT)
try:
    for _ in range(80):
        try: urllib.request.urlopen(BASE + '/api/health'); break
        except Exception: time.sleep(.5)
    js = os.path.join(WORK, 'b.js'); open(js, 'w').write(BUILD_JS); xls = os.path.join(WORK, 'oct.xls')
    subprocess.run(['node', js, os.path.join(ROOT, 'backend', 'node_modules', 'xlsx'), xls], check=True)
    hr = req('POST', '/api/auth/login', body={'username': 'hr', 'password': 'Indriyan@2025'})[1]['token']
    fin = req('POST', '/api/auth/login', body={'username': 'finance', 'password': 'Finance@2025'})[1]['token']
    r = upload(hr, xls); chk("import ok", True, bool(r.get("success")))
    chk('import flags 7 Oct as Missing IN', (1, 'MISSING_IN', 0, '', 'A', 'A'), row())
    rid = sqlite3.connect(DB).execute("SELECT id FROM attendance_processed WHERE in_time_original='19:22' AND date='2026-10-07'").fetchone()[0]
    s, _ = req('POST', f'/api/attendance/miss-punches/{rid}/resolve', hr, {'inTime': '07:55', 'outTime': '19:22', 'source': 'Gate Register', 'remark': 'gate book'})
    chk('resolve 200', 200, s); chk('resolved → P, finance pending', (1, 'MISSING_IN', 1, 'pending', 'A', 'P'), row())
    req('POST', '/api/payroll/calculate-days', hr, {'month': 10, 'year': 2026, 'company': ''}); p0 = present()
    r = upload(hr, xls); chk('reimport ok', True, bool(r.get('success')))
    chk('reimport keeps flag + resolution, finance still pending', (1, 'MISSING_IN', 1, 'pending', 'A', 'P'), row())
    req('POST', '/api/payroll/calculate-days', hr, {'month': 10, 'year': 2026, 'company': ''})
    chk('Stage 6 still does not pay it before finance', p0, present())
    req('POST', '/api/attendance/deduplicate', hr, {'month': 10, 'year': 2026})
    chk('dedupe re-detect keeps it', (1, 1, 'pending', 'P'), (row()[0], row()[2], row()[3], row()[5]))
    s, _ = req('POST', f'/api/finance-audit/miss-punch/{rid}/approve', fin, {}); chk('finance approve 200', 200, s)
    req('POST', '/api/payroll/calculate-days', hr, {'month': 10, 'year': 2026, 'company': ''})
    chk('after approval Stage 6 pays one more day', 1, (present() or 0) - (p0 or 0))
finally: srv.terminate()
print(f'{P} passed, {F} failed'); sys.exit(1 if F else 0)
