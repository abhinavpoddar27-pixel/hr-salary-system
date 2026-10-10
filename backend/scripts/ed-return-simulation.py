#!/usr/bin/env python3
"""Extra duty "Return to HR" — user simulation against the REAL server.

Boots backend/server.js on a scratch DATA_DIR, logs in as hr and finance with
real passwords, and replays the 7 Sept 2026 production case end to end:

  HR grants 1 day → HR approves → finance rejects ("power cut")
  → HR re-enters the same date (409, now tells HR what to do)
  → finance returns it → HR edits to 0.5 → HR approves → finance approves
  → Stage 6 + Stage 7 for September → the employee is paid 0.5 ED day.

Plus refusals a person would hit (HR returning, finance editing, returning an
approved grant) and a control employee whose pay must not move.

Scratch DATA_DIR only, torn down at exit. Never point this at a real database.
Usage: python3 backend/scripts/ed-return-simulation.py
"""
import json, os, shutil, sqlite3, subprocess, sys, tempfile, time, urllib.request, urllib.error

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
PORT = int(os.environ.get('PORT', '3987'))
BASE = f'http://127.0.0.1:{PORT}'
COMPANY = 'Asian Lakto Ind Ltd'
WORK = tempfile.mkdtemp(prefix='ed-return-sim-')
DB = os.path.join(WORK, 'hr_system.db')
PASS = FAIL = 0


def check(label, expected, actual):
    global PASS, FAIL
    if expected == actual:
        PASS += 1; print(f'  ✓ {label}')
    else:
        FAIL += 1; print(f'  ✗ {label} — expected {expected!r}, got {actual!r}')


def http(method, path, token=None, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method)
    req.add_header('Content-Type', 'application/json')
    req.add_header('Cache-Control', 'no-cache')
    if token: req.add_header('Authorization', f'Bearer {token}')
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, json.loads(r.read() or b'null')
    except urllib.error.HTTPError as e:
        raw = e.read()
        try: return e.code, json.loads(raw)
        except Exception: return e.code, {'raw': raw.decode(errors='replace')}


def q(sql, args=()):
    con = sqlite3.connect(DB, timeout=10); con.row_factory = sqlite3.Row
    try: return [dict(r) for r in con.execute(sql, args).fetchall()]
    finally: con.close()


def x(sql, args=()):
    con = sqlite3.connect(DB, timeout=10)
    try: con.execute(sql, args); con.commit()
    finally: con.close()


env = dict(os.environ, DATA_DIR=WORK, JWT_SECRET='sim-secret', PORT=str(PORT), NODE_ENV='development',
           ADMIN_PASSWORD='Admin@123', HR_PASSWORD='Indriyan@2025', FINANCE_PASSWORD='Finance@2025')
log = open(os.path.join(WORK, 'server.log'), 'w')
srv = subprocess.Popen(['node', os.path.join(ROOT, 'backend', 'server.js')], env=env, stdout=log, stderr=subprocess.STDOUT)
try:
    for _ in range(80):
        try:
            urllib.request.urlopen(BASE + '/api/version', timeout=2); break
        except Exception: time.sleep(0.5)
    else:
        print(open(os.path.join(WORK, 'server.log')).read()[-3000:]); sys.exit(1)

    # ── Seed: two permanent employees, full September attendance ──
    for code, name in [('17575', 'SIM WORKER'), ('17576', 'SIM CONTROL')]:
        x("""INSERT INTO employees (code, name, department, company, status, employment_type, is_contractor, gross_salary, date_of_joining)
             VALUES (?, ?, 'OFFICE ADMIN', ?, 'Active', 'Permanent', 0, 30000, '2020-04-01')""", (code, name, COMPANY))
        for day in range(1, 31):
            d = f'2026-09-{day:02d}'
            dow = time.strptime(d, '%Y-%m-%d').tm_wday  # Monday=0 … Sunday=6
            st = 'WO' if dow == 6 else 'P'
            x("""INSERT INTO attendance_processed (employee_code, date, status_original, status_final, company, month, year,
                   in_time_original, out_time_original, in_time_final, out_time_final)
                 VALUES (?, ?, ?, ?, ?, 9, 2026, ?, ?, ?, ?)""",
              (code, d, st, st, COMPANY, *(('08:00', '20:00') * 2 if st == 'P' else (None, None, None, None))))
    x("INSERT INTO monthly_imports (month, year, file_name, company, stage_1_done) VALUES (9, 2026, 'sim-sep.xls', ?, 1)", (COMPANY,))

    def login(u, p):
        s, b = http('POST', '/api/auth/login', body={'username': u, 'password': p})
        return (b or {}).get('token')
    hr = login('hr', 'Indriyan@2025'); fin = login('finance', 'Finance@2025')
    check('hr and finance log in', True, bool(hr) and bool(fin))

    G = '/api/extra-duty-grants'
    body = {'employee_code': '17575', 'grant_date': '2026-09-07', 'month': 9, 'year': 2026, 'company': COMPANY,
            'grant_type': 'OVERNIGHT_STAY', 'duty_days': 1, 'verification_source': 'Gate Register', 'remarks': 'stayed night'}

    print('\n— Step 1: the original grant, rejected by finance —')
    s, b = http('POST', G, hr, body); gid = b.get('id')
    check('HR creates 1-day grant', 200, s)
    check('HR approves', 200, http('POST', f'{G}/{gid}/approve', hr)[0])
    check('finance rejects (power cut)', 200, http('POST', f'{G}/{gid}/finance-reject', fin, {'finance_flag_reason': 'power cut'})[0])

    print('\n— Step 2: HR tries to award it again (the reported bug) —')
    s, b = http('POST', G, hr, dict(body, duty_days=0.5))
    check('re-award is refused with 409, not 500', 409, s)
    check('message tells HR to ask finance to Return to HR', True, 'ask finance to use "Return to HR"' in (b or {}).get('error', ''))
    check('still exactly one row for that date', 1, q("SELECT COUNT(*) n FROM extra_duty_grants WHERE employee_code='17575' AND grant_date='2026-09-07'")[0]['n'])

    print('\n— Step 3: refusals —')
    check('HR cannot return a finance rejection (403)', 403, http('POST', f'{G}/{gid}/finance-return', hr, {'return_reason': 'hr override'})[0])
    check('HR cannot edit a finance-rejected grant (409)', 409, http('PUT', f'{G}/{gid}', hr, {'duty_days': 0.5})[0])
    check('return with blank reason → 400', 400, http('POST', f'{G}/{gid}/finance-return', fin, {'return_reason': '  '})[0])

    print('\n— Step 4: finance returns, HR corrects and approves, finance approves —')
    check('finance returns it to HR', 200, http('POST', f'{G}/{gid}/finance-return', fin, {'return_reason': 'Power cut — give 0.5 day'})[0])
    s, b = http('GET', f'{G}?month=9&year=2026', hr)
    row = next(g for g in b['data'] if g['id'] == gid)
    check('HR queue shows it PENDING with finance note', ('PENDING', True), (row['status'], 'Power cut — give 0.5 day' in (row.get('finance_notes') or '')))
    check('finance cannot edit (403)', 403, http('PUT', f'{G}/{gid}', fin, {'duty_days': 0.5})[0])
    s, b = http('PUT', f'{G}/{gid}', hr, {'duty_days': 0.5, 'remarks': 'power cut, half day'})
    check('HR edits days to 0.5', (200, ['duty_days', 'remarks']), (s, sorted(b.get('changed', []))))
    check('HR approves again', 200, http('POST', f'{G}/{gid}/approve', hr)[0])
    s, b = http('GET', f'{G}/finance-review?month=9&year=2026', fin)
    row = next(g for g in b['data'] if g['id'] == gid)
    check('finance queue shows it UNREVIEWED at 0.5', ('UNREVIEWED', 0.5), (row['finance_status'], row['duty_days']))
    check('finance approves', 200, http('POST', f'{G}/{gid}/finance-approve', fin)[0])
    check('returning an approved grant is refused (409)', 409, http('POST', f'{G}/{gid}/finance-return', fin, {'return_reason': 'again please'})[0])

    audit = q("SELECT stage, field_name, old_value, new_value FROM audit_log WHERE table_name='extra_duty_grants' AND record_id=? ORDER BY id", (gid,))
    stages = [a['stage'] for a in audit]
    check('audit trail order', ['HR_APPROVE', 'FINANCE_REJECT', 'FINANCE_RETURN', 'FINANCE_RETURN', 'HR_EDIT', 'HR_EDIT', 'HR_APPROVE', 'FINANCE_APPROVE'], stages)
    check('old rejection kept in finance_rejections archive', 1, q("SELECT COUNT(*) n FROM finance_rejections WHERE source_record_id=?", (gid,))[0]['n'])

    print('\n— Step 5: Stage 6 + Stage 7 for September —')
    s, _ = http('POST', '/api/payroll/calculate-days', hr, {'month': 9, 'year': 2026, 'company': COMPANY}); check('Stage 6 runs', 200, s)
    s, _ = http('POST', '/api/payroll/compute-salary', hr, {'month': 9, 'year': 2026, 'company': COMPANY}); check('Stage 7 runs', 200, s)
    sc = {r['employee_code']: r for r in q("SELECT employee_code, ed_days, ed_pay, gross_salary, net_salary, gross_earned, total_deductions, take_home, total_payable FROM salary_computations WHERE month=9 AND year=2026")}
    dc = {r['employee_code']: r for r in q("SELECT employee_code, finance_ed_days FROM day_calculations WHERE month=9 AND year=2026")}
    check('Stage 6 shows 0.5 finance ED day', 0.5, dc.get('17575', {}).get('finance_ed_days'))
    check('Stage 7 ed_days = 0.5', 0.5, sc.get('17575', {}).get('ed_days'))
    check('Stage 7 ed_pay = 30000 / 30 × 0.5 = 500', 500.0, sc.get('17575', {}).get('ed_pay'))
    check('take_home = total_payable + ed_pay', True, abs(sc['17575']['take_home'] - (sc['17575']['total_payable'] + sc['17575']['ed_pay'])) < 0.01)
    check('control employee has no ED', (0, 0), (sc['17576']['ed_days'] or 0, sc['17576']['ed_pay'] or 0))
    check('control employee net = worker net (ED sits outside net)', sc['17576']['net_salary'], sc['17575']['net_salary'])
    drift = q("SELECT COUNT(*) n FROM salary_computations WHERE month=9 AND year=2026 AND ABS(net_salary-(gross_earned-total_deductions))>1")[0]['n']
    check('salary drift rows = 0', 0, drift)
finally:
    srv.terminate()
    try: srv.wait(10)
    except Exception: srv.kill()
    log.close()
    shutil.rmtree(WORK, ignore_errors=True)

print(f'\n{PASS} passed, {FAIL} failed')
sys.exit(1 if FAIL else 0)
