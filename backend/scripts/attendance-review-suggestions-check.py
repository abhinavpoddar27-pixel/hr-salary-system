#!/usr/bin/env python3
"""Analytics → Attendance Review: standing leave-outs + monthly suggestions (owner rulings 11 Oct 2026) — browser check.

Chromium against the BUILT dist, real admin login, scratch DATA_DIR, fictional codes S90xx (repo is public).
Rules version 1 (effective 2026-10): master basis, and the OLDER list format excluded_codes ['S9001'] (folded into a
standing rule "From the earlier list"). October 2026 has:
  S9001  on time every day                     → "rule no longer needed"            (accept → removed)
  S9002–S9004 contract LODING, dept CREW K     → "mark CREW K as a piece-rate crew"  (accept → crew rule)
  S9010  10-hour master, punches 08:00–18:00   → "master doesn't fit, create 08:00–18:00" (accept → left out until fixed)
  S9020  no master, punches 09:30–18:30        → "no master shift" (data fix only)   (dismiss)
  S9030  gross ₹90,000, 45 min late on 12 days → "senior staff?"                     (accept → Senior staff)
  S9040  contract LOADING, leaves 3 h early    → no early exits counted (contractor-loader rule)
Flow: Apply disabled until something is ticked → tick → Apply → one new version (2) → panel empty, action list loses
S9030 → Rules editor shows the standing tables with reasons → a row without a reason is refused → removing it saves v3
→ the dismissed suggestion stays dismissed → phone width. Nothing is written to a payroll table.

Usage: npm run build --prefix frontend; python3 backend/scripts/attendance-review-suggestions-check.py
"""
import datetime, json, os, sqlite3, subprocess, tempfile, time, urllib.request
from playwright.sync_api import sync_playwright

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
PORT = int(os.environ.get('PORT', '3996')); BASE = f'http://127.0.0.1:{PORT}'
WORK = tempfile.mkdtemp(prefix='ar-sug-'); DB = os.path.join(WORK, 'hr_system.db')
C = 'Indriyan Beverages Pvt Ltd'
PASS = FAIL = 0


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


def seed():
    c = sqlite3.connect(DB)
    sid = lambda code: c.execute('SELECT id FROM shifts WHERE code=?', (code,)).fetchone()[0]
    people = [  # code, dept, designation, contractor, gross, master
        ('S9001', 'PRODUCTION', 'OPERATOR', 0, 20000, '12HR'),
        ('S9002', 'CREW K', 'LODING', 1, 14000, '12HR'), ('S9003', 'CREW K', 'LODING', 1, 14000, '12HR'), ('S9004', 'CREW K', 'LODING', 1, 14000, '12HR'),
        ('S9010', 'HOUSE KEEPING', 'SWEEPER', 0, 13000, '10HR'),
        ('S9020', 'OFFICE ADMIN', 'CLERK', 0, 20000, None),
        ('S9030', 'OFFICE ADMIN', 'GENERAL MANAGER', 0, 90000, '12HR'),
        ('S9040', 'MEERA', 'LOADING', 1, 14000, '12HR'),
    ]
    for n, (code, dept, des, con, gross, m) in enumerate(people, 1):
        c.execute("INSERT INTO employees(code,name,department,designation,company,status,employment_type,is_contractor,gross_salary,date_of_joining,default_shift_id) "
                  "VALUES(?,?,?,?,?,'Active',?,?,?,'2024-01-01',?)", (code, f'TEST SUG {n}', dept, des, C, 'Contract' if con else 'Permanent', con, gross, sid(m) if m else None))

    def day(code, iso, it, ot):
        c.execute("INSERT INTO attendance_processed(employee_code,date,status_original,status_final,in_time_final,out_time_final,shift_detected,"
                  "is_late_arrival,late_by_minutes,is_early_departure,early_by_minutes,is_left_late,is_miss_punch,month,year,company) "
                  "VALUES(?,?,'P','P',?,?,'12-Hour Shift',0,0,0,0,0,0,?,?,?)", (code, iso, it, ot, int(iso[5:7]), int(iso[:4]), C))
    for m in (9, 10):
        for i, iso in enumerate(weekdays(2026, m)[:22]):
            for code in ('S9001', 'S9002', 'S9003', 'S9004'): day(code, iso, '08:00', '20:00')
            day('S9010', iso, '09:00' if m == 9 else '08:00', '19:00' if m == 9 else '18:00')
            day('S9020', iso, '09:30', '18:30')
            day('S9030', iso, '08:45' if (m == 10 and i < 12) else '08:00', '20:00')
            day('S9040', iso, '08:00', '17:00' if m == 10 else '20:00')
    c.execute("INSERT INTO attendance_review_config (effective_from, config_json, updated_by) VALUES ('2026-10', ?, 'admin')",
              (json.dumps({'assessment_basis': 'master', 'excluded_codes': ['S9001']}),))
    c.commit(); c.close()


def section(pg, title): return pg.locator(f'[data-section="{title}"]')


def sug_keys(pg):
    return pg.locator('[data-testid="ar-suggestions"] [data-key]').evaluate_all('els => els.map(e => e.dataset.key)')


def action_codes(pg):
    sec = section(pg, 'Action list')
    return [t.strip() for t in sec.locator('tbody tr td:first-child').all_inner_texts()]


def open_tab(pg):
    pg.goto(BASE + '/analytics/attendance-review'); pg.wait_for_load_state('networkidle')
    pg.locator('select').filter(has=pg.locator('option', has_text='October')).first.select_option('10')
    pg.locator('select').filter(has=pg.locator('option', has_text='2026')).first.select_option('2026')
    pg.wait_for_load_state('networkidle'); time.sleep(1.5)


env = dict(os.environ, DATA_DIR=WORK, JWT_SECRET='x', PORT=str(PORT), NODE_ENV='production',
           ADMIN_PASSWORD='Admin@123', HR_PASSWORD='Indriyan@2025', FINANCE_PASSWORD='Finance@2025')
srv = subprocess.Popen(['node', f'{ROOT}/backend/server.js'], env=env, stdout=open(f'{WORK}/log', 'w'), stderr=subprocess.STDOUT)
try:
    for _ in range(80):
        try: urllib.request.urlopen(BASE + '/api/version', timeout=2); break
        except Exception: time.sleep(.5)
    seed()
    payroll_before = [q(f'SELECT COUNT(*) n FROM {t}')[0]['n'] for t in ('day_calculations', 'salary_computations', 'late_coming_deductions')]
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_context(viewport={'width': 1440, 'height': 900}).new_page(); errs, bad = [], []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.on('response', lambda r: bad.append(f'{r.status} {r.url}') if '/api/' in r.url and r.status >= 400 and r.request.method == 'GET' else None)
        pg.goto(BASE + '/login'); pg.get_by_placeholder('admin').fill('admin'); pg.get_by_placeholder('••••••••').fill('Admin@123')
        pg.get_by_role('button', name='Sign in').click(); pg.wait_for_url(lambda u: '/login' not in u)
        open_tab(pg)

        print('\n— suggestions shown —')
        keys = sug_keys(pg)
        expect = ['senior_hint|S9030', 'master_fit|S9010', 'loader_crew|CREW K', 'no_master|S9020', 'stale_person|S9001']
        check('the five expected suggestions, in priority order', expect, keys)
        check('S9030 on the action list before', True, 'S9030' in action_codes(pg))
        check('S9040 (contract loader leaving 3 h early) not on any list', False,
              pg.locator('[data-section="Early-exit warnings"]', has_text='S9040').count() > 0 or 'S9040' in action_codes(pg))
        mf = pg.locator('[data-key="master_fit|S9010"]').inner_text()
        check('master-fit evidence proposes creating 08:00–18:00', True, '08:00–18:00' in mf)
        check('no-master is a data fix (no accept box)', 0, pg.get_by_label('Accept no_master|S9020').count())
        apply_btn = pg.get_by_role('button', name='Apply', exact=False).filter(has_text='change')
        section(pg, 'Suggestions — leave out or fix').screenshot(path=os.path.join(WORK, 'suggestions.png'))
        check('edge: Apply disabled with nothing ticked', True, apply_btn.is_disabled())

        print('\n— tick and apply —')
        for k in ('senior_hint|S9030', 'master_fit|S9010', 'loader_crew|CREW K', 'stale_person|S9001'): pg.get_by_label(f'Accept {k}').check()
        pg.get_by_label('Dismiss no_master|S9020').check()
        check('counter says 4 accepted · 1 dismissed', True, pg.get_by_text('4 accepted · 1 dismissed').count() == 1)
        apply_btn.click(); pg.get_by_text('Saved as rules version 2', exact=False).wait_for(timeout=10000)
        check('toast: saved as rules version 2', True, True)
        pg.wait_for_load_state('networkidle'); time.sleep(1.5)
        check('panel now has nothing to suggest', True, pg.get_by_text('Nothing to suggest this month.').count() == 1)
        check('S9030 off the action list', False, 'S9030' in action_codes(pg))
        stored = json.loads(q('SELECT config_json FROM attendance_review_config ORDER BY id DESC LIMIT 1')[0]['config_json'])
        check('DB v2: standing rules', {'S9010': 'exclude', 'S9030': 'exclude'}, {k: v['rule'] for k, v in stored['standing_people'].items()})
        check('DB v2: S9030 reason "Senior staff"', 'Senior staff', stored['standing_people']['S9030']['reason'])
        check('DB v2: CREW K piece rate', 'Piece-rate loading crew', stored['standing_departments']['CREW K']['reason'])
        check('DB v2: dismissed no_master|S9020', True, 'no_master|S9020' in stored['dismissed_suggestions'])
        check('DB v2: old list gone, basis kept', [None, 'master'], [stored.get('excluded_codes'), stored.get('assessment_basis')])
        check('audit row written', 1, q("SELECT COUNT(*) n FROM audit_log WHERE stage='ATTENDANCE_REVIEW_SUGGESTIONS'")[0]['n'])

        print('\n— rules editor —')
        pg.get_by_role('button', name='Rules & exclusions').click(); time.sleep(.8)
        cfg = pg.get_by_test_id('ar-config')
        codes = cfg.get_by_label('Standing person code').evaluate_all('els => els.map(e => e.value)')
        check('people table: S9010, S9030', ['S9010', 'S9030'], sorted(codes))
        reasons = cfg.get_by_label('Standing person reason').evaluate_all('els => els.map(e => e.value)')
        check('reasons shown', True, 'Senior staff' in reasons and any('Master shift' in r for r in reasons))
        check('crew table: CREW K', ['CREW K'], cfg.get_by_label('Standing department', exact=True).evaluate_all('els => els.map(e => e.value)'))
        check('contract-loader tick on by default', True, cfg.get_by_label('Contract loaders early exits not counted').is_checked())
        cfg.get_by_role('button', name='+ add a person').click()
        cfg.get_by_label('Standing person code').last.fill('S9099')
        cfg.get_by_label('Effective from').fill('2026-10')
        cfg.get_by_role('button', name='Save as new version').click(); time.sleep(1.5)
        check('edge: a row without a reason is refused (still 2 versions)', 2, q('SELECT COUNT(*) n FROM attendance_review_config')[0]['n'])
        cfg.locator('tr:has(input[aria-label="Standing person code"])').last.get_by_role('button', name='remove').click()
        cfg.get_by_role('button', name='Save as new version').click(); time.sleep(1.8)
        check('saved as version 3', 3, q('SELECT COUNT(*) n FROM attendance_review_config')[0]['n'])
        v3 = json.loads(q('SELECT config_json FROM attendance_review_config ORDER BY id DESC LIMIT 1')[0]['config_json'])
        check('v3 keeps the dismissal and who set each rule', [True, 'admin'], ['no_master|S9020' in v3['dismissed_suggestions'], v3['standing_people']['S9030'].get('set_by')])
        pg.reload(); open_tab(pg)
        check('dismissed suggestion still not shown after an editor save', False, 'no_master|S9020' in sug_keys(pg))

        print('\n— phone width 390 —')
        ph = b.new_context(viewport={'width': 390, 'height': 844}).new_page(); perr = []
        ph.on('pageerror', lambda e: perr.append(str(e)))
        ph.goto(BASE + '/login'); ph.get_by_placeholder('admin').fill('admin'); ph.get_by_placeholder('••••••••').fill('Admin@123')
        ph.get_by_role('button', name='Sign in').click(); ph.wait_for_url(lambda u: '/login' not in u)
        open_tab(ph)
        check('phone: suggestions section renders', 1, section(ph, 'Suggestions — leave out or fix').count())
        check('phone: 0 page errors', [], perr)
        check('0 page errors', [], errs)
        check('0 failed GET calls', [], bad)
        b.close()
    payroll_after = [q(f'SELECT COUNT(*) n FROM {t}')[0]['n'] for t in ('day_calculations', 'salary_computations', 'late_coming_deductions')]
    check('no payroll table written', payroll_before, payroll_after)
finally:
    srv.terminate()
    try: srv.wait(timeout=10)
    except Exception: srv.kill()

print(f'\n{PASS} passed, {FAIL} failed  (screenshot: {WORK}/suggestions.png)')
raise SystemExit(1 if FAIL else 0)
