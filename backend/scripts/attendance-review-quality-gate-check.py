#!/usr/bin/env python3
"""PR-4 — Attendance Review data-quality check before Finalise — browser check.

Chromium against the BUILT dist, real admin + hr logins, scratch DATA_DIR, fictional codes G40xx (repo is public).
September 2026 (already over), master basis, 12-hour day master (08:00–20:00) for everyone:
  G4001 works nights 19:30–06:30 on the day master  → deduction, "works nights … needs an overnight master"
  G4002 late 40 min every day                       → deduction, "late on N of N days"
  G4003 one open (unfixed) miss punch               → "miss-punch day(s) not fixed"
  G4004 clean
Flow: draft → "Before you finalise" shows 2 checks → Finalise window: reason < 10 chars keeps the button off, Cancel
writes nothing → rules saved after the draft → "Must fix", Finalise disabled → regenerate clears it → night master +
fixed miss punch + regenerate → only G4002 left → finalise with a reason (double click = 1 PUT) → run final, reason in
audit_log, panel shows it → hr gets 403 → phone width. Payroll tables untouched.

Usage: npm run build --prefix frontend; python3 backend/scripts/attendance-review-quality-gate-check.py
"""
import datetime, json, os, sqlite3, subprocess, tempfile, time, urllib.request
from playwright.sync_api import sync_playwright

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
PORT = int(os.environ.get('PORT', '3996')); BASE = f'http://127.0.0.1:{PORT}'
WORK = tempfile.mkdtemp(prefix='ar-qg-'); DB = os.path.join(WORK, 'hr_system.db')
C = 'Indriyan Beverages Pvt Ltd'
PASS = FAIL = 0
REASON = 'G4002 checked: really late, master is right'


def check(label, expected, actual):
    global PASS, FAIL
    if expected == actual: PASS += 1; print(f'  ✓ {label}')
    else: FAIL += 1; print(f'  ✗ {label} — expected {expected!r}, got {actual!r}')


def weekdays(y, m):
    d = datetime.date(y, m, 1); out = []
    while d.month == m:
        if d.weekday() != 6: out.append(d.isoformat())
        d += datetime.timedelta(days=1)
    return out


def q(sql, args=()):
    con = sqlite3.connect(DB, timeout=10); con.row_factory = sqlite3.Row
    try: return [dict(r) for r in con.execute(sql, args).fetchall()]
    finally: con.close()


def run(sql, args=()):
    con = sqlite3.connect(DB, timeout=10)
    try: con.execute(sql, args); con.commit()
    finally: con.close()


def seed():
    c = sqlite3.connect(DB)
    s12 = c.execute("SELECT id FROM shifts WHERE code='12HR'").fetchone()[0]
    for n, code in enumerate(['G4001', 'G4002', 'G4003', 'G4004'], 1):
        c.execute("INSERT INTO employees(code,name,department,designation,company,status,employment_type,is_contractor,gross_salary,date_of_joining,default_shift_id) "
                  "VALUES(?,?,'PRODUCTION','OPERATOR',?,'Active','Permanent',0,24000,'2024-01-01',?)", (code, f'TEST QG {n}', C, s12))
    ins = ("INSERT INTO attendance_processed(employee_code,date,status_original,status_final,in_time_final,out_time_final,shift_detected,"
           "is_night_shift,is_late_arrival,late_by_minutes,is_early_departure,early_by_minutes,is_left_late,is_miss_punch,miss_punch_resolved,month,year,company) "
           "VALUES(?,?,'P','P',?,?,?,?,?,?,?,?,0,?,0,?,?,?)")
    for m in (8, 9):
        for i, iso in enumerate(weekdays(2026, m)):
            for code in ['G4001', 'G4002', 'G4003', 'G4004']:
                it, ot, sd, nt, lm, em, mp = '08:00', '20:00', '12-Hour Shift', 0, 0, 0, 0
                if m == 9 and code == 'G4001': it, ot, sd, nt, em = '19:30', '06:30', 'Night Shift', 1, 90
                if m == 9 and code == 'G4002': it, lm = '08:40', 40
                if m == 9 and code == 'G4003' and i == 4: mp, ot = 1, None
                c.execute(ins, (code, iso, it, ot, sd, nt, 1 if lm else 0, lm, 1 if em else 0, em, mp, m, 2026, C))
    c.execute("INSERT INTO attendance_review_config (effective_from, config_json, updated_by) VALUES ('2026-08', ?, 'admin')",
              (json.dumps({'assessment_basis': 'master'}),))
    c.commit(); c.close()


def open_tab(pg):
    pg.goto(BASE + '/analytics/attendance-review'); pg.wait_for_load_state('networkidle')
    pg.locator('select').filter(has=pg.locator('option', has_text='September')).first.select_option('9')
    pg.locator('select').filter(has=pg.locator('option', has_text='2026')).first.select_option('2026')
    pg.wait_for_load_state('networkidle'); time.sleep(1.5)


def login(ctx, user='admin', pw='Admin@123'):
    pg = ctx.new_page()
    pg.goto(BASE + '/login'); pg.get_by_placeholder('admin').fill(user); pg.get_by_placeholder('••••••••').fill(pw)
    pg.get_by_role('button', name='Sign in').click(); pg.wait_for_url(lambda u: '/login' not in u)
    return pg


def api(pg, method, path, body=None):
    return pg.evaluate("""async ([m, p, b]) => { const t = localStorage.getItem('hr_token');
      const r = await fetch(p, { method: m, headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined });
      let j = null; try { j = await r.json() } catch {} return { status: r.status, body: j } }""", [method, path, body])


def regenerate(pg):
    pg.get_by_role('button', name='Regenerate draft').click(); pg.get_by_text('Draft regenerated').first.wait_for(timeout=15000)
    pg.wait_for_load_state('networkidle'); time.sleep(1.5)


def panel_keys(pg):
    return sorted(t.replace('ar-q-item-', '') for t in pg.locator('[data-testid^="ar-q-item-"]').evaluate_all('els => els.map(e => e.dataset.testid)'))


env = dict(os.environ, DATA_DIR=WORK, JWT_SECRET='x', PORT=str(PORT), NODE_ENV='production',
           ADMIN_PASSWORD='Admin@123', HR_PASSWORD='Indriyan@2025', FINANCE_PASSWORD='Finance@2025')
srv = subprocess.Popen(['node', f'{ROOT}/backend/server.js'], env=env, stdout=open(f'{WORK}/log', 'w'), stderr=subprocess.STDOUT)
try:
    for _ in range(80):
        try: urllib.request.urlopen(BASE + '/api/version', timeout=2); break
        except Exception: time.sleep(.5)
    seed()
    payroll_before = [q(f'SELECT COUNT(*) n FROM {t}')[0]['n'] for t in ('day_calculations', 'salary_computations', 'late_coming_deductions', 'early_exit_deductions')]
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = login(b.new_context(viewport={'width': 1440, 'height': 900})); errs, bad, puts = [], [], []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.on('response', lambda r: bad.append(f'{r.status} {r.url}') if '/api/' in r.url and r.status >= 400 else None)
        pg.on('request', lambda r: puts.append(r.url) if r.method == 'PUT' and '/finalise' in r.url else None)
        open_tab(pg)

        print('\n— draft and its checks —')
        check('no panel before a draft', 0, pg.get_by_test_id('ar-quality').count())
        pg.get_by_role('button', name='Generate draft').click(); pg.get_by_text('Draft created').wait_for(timeout=15000)
        pg.wait_for_load_state('networkidle'); time.sleep(1.5)
        check('panel shown', 1, pg.get_by_test_id('ar-quality').count())
        keys = panel_keys(pg)
        check('checks: shift doubt + open miss punch', True, 'shift_doubt' in keys and 'miss_punch_open' in keys)
        check('no stop on a fresh draft', False, 'rules_changed' in keys)
        doubt = pg.get_by_test_id('ar-q-item-shift_doubt')
        check('G4001 named as a night worker on a day master', True, 'works nights' in doubt.get_by_test_id('ar-q-shift_doubt-G4001').inner_text())
        check('G4002 named: late on most days', True, 'late on' in doubt.get_by_test_id('ar-q-shift_doubt-G4002').inner_text())
        check('G4003 in the open miss-punch list', 1, pg.get_by_test_id('ar-q-miss_punch_open-G4003').count())
        check('summary chip: 2 to check', True, pg.get_by_text('2 to check').count() >= 1)

        print('\n— finalise window: reason needed —')
        pg.get_by_role('button', name='Finalise').click()
        dlg = pg.get_by_test_id('ar-finalise-dialog'); dlg.wait_for(timeout=5000)
        conf = pg.get_by_test_id('ar-finalise-confirm')
        check('confirm off with no reason', True, conf.is_disabled())
        pg.get_by_label('Reason to finalise').fill('  short   ')
        check('confirm off with 5 characters', True, conf.is_disabled())
        check('button says Finalise anyway', 'Finalise anyway', conf.inner_text().strip())
        pg.get_by_role('button', name='Cancel').click(); time.sleep(.5)
        check('Cancel: no PUT, still draft', [0, 'draft'], [len(puts), q("SELECT status FROM attendance_review_runs WHERE month=9")[0]['status']])
        pg.get_by_role('button', name='Finalise').click(); dlg.wait_for(timeout=5000)
        check('reopened window starts empty', '', pg.get_by_label('Reason to finalise').input_value())
        pg.keyboard.press('Escape'); time.sleep(.3)

        print('\n— rules saved after the draft = must fix —')
        cfg = api(pg, 'GET', '/api/analytics/attendance-review/config?month=9&year=2026')['body']['data']['config']
        cfg['thresholds']['act_workdays'] = 1.1
        r = api(pg, 'PUT', '/api/analytics/attendance-review/config', {'effective_from': '2026-09', 'config': {'assessment_basis': 'master', 'thresholds': {'act_workdays': 1.1}}})
        check('new rules version saved', 200, r['status'])
        pg.reload(); pg.wait_for_load_state('networkidle'); open_tab(pg)
        check('stop shown: rules changed', True, 'rules_changed' in panel_keys(pg))
        check('Finalise disabled', True, pg.get_by_role('button', name='Finalise').is_disabled())
        f = api(pg, 'PUT', f"/api/analytics/attendance-review/runs/{q('SELECT id FROM attendance_review_runs WHERE month=9')[0]['id']}/finalise", {'acknowledge': 'force it through please'})
        check('direct PUT with a reason still refused (409 QUALITY_GATE)', [409, 'QUALITY_GATE'], [f['status'], (f['body'] or {}).get('code')])
        regenerate(pg)
        check('regenerate clears the stop', False, 'rules_changed' in panel_keys(pg))

        print('\n— fix the master and the miss punch, regenerate —')
        run("INSERT INTO shifts (name, code, start_time, end_time, grace_minutes, duration_hours) VALUES ('Night 19-07 test', 'QG1907', '19:00', '07:00', 9, 12)")
        run("UPDATE employees SET default_shift_id = (SELECT id FROM shifts WHERE code='QG1907') WHERE code='G4001'")
        run("UPDATE attendance_processed SET miss_punch_resolved = 1, out_time_final = '20:00' WHERE employee_code='G4003' AND is_miss_punch = 1")
        regenerate(pg)
        keys = panel_keys(pg)
        check('miss-punch check gone', False, 'miss_punch_open' in keys)
        night = pg.get_by_test_id('ar-q-shift_doubt-G4001')
        check('G4001 no longer "night work on a day master"', True, night.count() == 0 or 'works nights' not in night.inner_text())
        check('G4002 still a check', 1, pg.get_by_test_id('ar-q-shift_doubt-G4002').count())

        print('\n— finalise with a reason (double click = one PUT) —')
        n0 = len(puts)
        pg.get_by_role('button', name='Finalise').click(); dlg.wait_for(timeout=5000)
        pg.get_by_label('Reason to finalise').fill(REASON)
        check('confirm on with a full reason', False, conf.is_disabled())
        conf.dblclick(); pg.get_by_text('Review finalised and locked').first.wait_for(timeout=10000)
        pg.wait_for_load_state('networkidle'); time.sleep(1.5)
        check('one PUT for a double click', 1, len(puts) - n0)
        runrow = q('SELECT id, status FROM attendance_review_runs WHERE month=9')[0]
        check('run final', 'final', runrow['status'])
        a = q("SELECT remark, new_value, changed_by FROM audit_log WHERE stage='ATTENDANCE_REVIEW_GATE' AND record_id=?", (runrow['id'],))
        check('reason recorded once, by admin', [1, REASON, 'admin'], [len(a), a[0]['remark'] if a else None, a[0]['changed_by'] if a else None])
        check('recorded check names G4002', True, bool(a) and 'G4002' in a[0]['new_value'])
        ack = pg.get_by_test_id('ar-quality-ack')
        check('final run shows the reason', True, ack.count() == 1 and REASON in ack.inner_text())
        check('no Finalise button on a final run', 0, pg.get_by_role('button', name='Finalise', exact=True).count())

        print('\n— hr and phone —')
        hr = login(b.new_context(viewport={'width': 1280, 'height': 900}), 'hr', 'Indriyan@2025')
        check('hr: quality check refused (403)', 403, api(hr, 'GET', f"/api/analytics/attendance-review/runs/{runrow['id']}/quality")['status'])
        ph = login(b.new_context(viewport={'width': 390, 'height': 844}))
        ph.on('pageerror', lambda e: errs.append(str(e)))
        open_tab(ph)
        check('phone: reason panel visible', True, ph.get_by_test_id('ar-quality-ack').is_visible())

        check('0 page errors', [], errs)
        check('only the intended API errors (2 × 409 finalise, hr 403)', True,
              all(('/finalise' in x and x.startswith('409')) or ('/quality' in x and x.startswith('403')) for x in bad))
        b.close()
    check('payroll tables untouched', payroll_before,
          [q(f'SELECT COUNT(*) n FROM {t}')[0]['n'] for t in ('day_calculations', 'salary_computations', 'late_coming_deductions', 'early_exit_deductions')])
finally:
    srv.terminate()
print(f'\n{PASS} passed, {FAIL} failed')
raise SystemExit(1 if FAIL else 0)
