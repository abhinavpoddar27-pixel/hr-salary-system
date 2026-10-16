import json, os, sqlite3, subprocess, sys, tempfile, time, urllib.request
ROOT = os.environ.get('APP_ROOT', os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..')))
PORT = 3431; BASE = f'http://127.0.0.1:{PORT}'
WORK = tempfile.mkdtemp(prefix='sp-sim-'); DB = os.path.join(WORK, 'hr_system.db')
C = 'Asian Lakto Ind Ltd'; P = F = 0
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
env = dict(os.environ, DATA_DIR=WORK, JWT_SECRET='x', PORT=str(PORT), NODE_ENV='production',
           ADMIN_PASSWORD='Admin@123', HR_PASSWORD='Indriyan@2025', FINANCE_PASSWORD='Finance@2025')
srv = subprocess.Popen(['node', f'{ROOT}/backend/server.js'], env=env, stdout=open(f'{WORK}/log', 'w'), stderr=subprocess.STDOUT)
try:
    for _ in range(60):
        try: urllib.request.urlopen(BASE + '/api/health'); break
        except Exception: time.sleep(0.5)
    c = sqlite3.connect(DB)
    sid = c.execute("SELECT id FROM shifts WHERE code='12HR'").fetchone()[0]
    c.execute("INSERT INTO employees(code,name,department,company,status,employment_type,gross_salary,default_shift_id,shift_code,date_of_joining) VALUES('T7701','TEST EMP 1','OPR',?,'Active','Permanent',26000,?,'12HR','2025-01-01')", (C, sid))
    c.execute("INSERT INTO salary_structures(employee_id,gross_salary,basic,da,hra,effective_from) SELECT id,26000,13000,0,5200,'2025-01-01' FROM employees WHERE code='T7701'")
    # Oct 1-15: worked days, but 7 Oct = lone evening punch (A), 9 Oct = no punch (real absence)
    for d in range(1, 16):
        date = f'2026-10-{d:02d}'
        if d == 7: st, i, o = 'A', '19:22', None
        elif d == 9: st, i, o = 'A', None, None
        elif d in (4, 11): st, i, o = 'WO', None, None
        else: st, i, o = 'P', '07:58', '20:02'
        c.execute("INSERT INTO attendance_processed(employee_code,date,status_original,status_final,in_time_original,in_time_final,out_time_original,out_time_final,month,year,company,is_night_shift) VALUES('T7701',?,?,?,?,?,?,?,10,2026,?,?)",
                  (date, st, st, i, i, o, o, C, 1 if d == 7 else 0))
    c.execute("INSERT OR REPLACE INTO monthly_imports(month,year,company,status,stage_1_done) VALUES(10,2026,?,'imported',1)", (C,)); c.commit(); c.close()
    _, hr = req('POST', '/api/auth/login', body={'username': 'hr', 'password': 'Indriyan@2025'}); hr = hr.get('token')
    _, fin = req('POST', '/api/auth/login', body={'username': 'finance', 'password': 'Finance@2025'}); fin = fin.get('token')
    chk('hr + finance logged in', True, bool(hr and fin))
    s, r = req('POST', '/api/attendance/deduplicate', hr, {'month': 10, 'year': 2026}); chk('re-detect via real route 200', 200, s)
    s, r = req('GET', f'/api/attendance/miss-punches?month=10&year=2026&company={urllib.parse.quote(C)}', hr)
    rows = r.get('data') or r.get('records') or []
    mine = [x for x in rows if x['date'] == '2026-10-07']
    chk('7 Oct on the Miss Punch list', 1, len(mine))
    chk('type Missing IN', 'MISSING_IN', mine[0]['miss_punch_type'] if mine else None)
    chk('9 Oct (no punch, A) NOT on the list', 0, len([x for x in rows if x['date'] == '2026-10-09']))
    rid = mine[0]['id']
    s, r = req('POST', f'/api/attendance/miss-punches/{rid}/resolve', hr, {'inTime': '07:55', 'outTime': '19:22', 'source': 'Gate Register', 'remark': 'gate book in 07:55'})
    chk('hr resolve 200', 200, s)
    c = sqlite3.connect(DB); row = c.execute("SELECT status_final,in_time_final,out_time_final,miss_punch_resolved,is_night_shift FROM attendance_processed WHERE id=?", (rid,)).fetchone()
    chk('resolved row → P with gate times', ('P', '07:55', '19:22', 1, 0), row)
    chk('audit row A→P', 1, c.execute("SELECT COUNT(*) FROM audit_log WHERE record_id=? AND field_name='status_final' AND old_value='A' AND new_value='P'", (rid,)).fetchone()[0]); c.close()
    s, _ = req('POST', '/api/payroll/calculate-days', hr, {'month': 10, 'year': 2026, 'company': ''}); chk('Stage 6 before finance 200', 200, s)
    c = sqlite3.connect(DB); before = c.execute("SELECT days_present FROM day_calculations WHERE employee_code='T7701' AND month=10").fetchone(); c.close()
    s, r = req('POST', f'/api/finance-audit/miss-punch/{rid}/approve', fin, {}); chk('finance approve 200', 200, s)
    s, _ = req('POST', '/api/payroll/calculate-days', hr, {'month': 10, 'year': 2026, 'company': ''}); chk('Stage 6 after finance 200', 200, s)
    c = sqlite3.connect(DB); after = c.execute("SELECT days_present FROM day_calculations WHERE employee_code='T7701' AND month=10").fetchone(); c.close()
    print('   days_present before/after finance:', before, after)
    chk('one more present day after finance approval', 1, (after[0] - before[0]) if before and after else None)
    s, r = req('POST', '/api/attendance/deduplicate', hr, {'month': 10, 'year': 2026})
    c = sqlite3.connect(DB); again = c.execute("SELECT is_miss_punch, miss_punch_resolved, miss_punch_finance_status, status_final, company FROM attendance_processed WHERE id=?", (rid,)).fetchone(); c.close()
    print('   after second re-detect:', again)
    chk('re-detect keeps it resolved + approved + P', (1, 'approved', 'P'), again[1:4])
finally:
    srv.terminate()
print(f'{P} passed, {F} failed'); sys.exit(1 if F else 0)
