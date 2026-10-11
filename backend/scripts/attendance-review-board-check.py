#!/usr/bin/env python3
"""Attendance Review → Notice board (PR-5) — browser check.

Chromium against the BUILT dist, real admin + hr logins, scratch DATA_DIR, fictional codes K90xx (repo is public).
September 2026, import basis, 12-hour shift; Mon–Sat 1–15 Sep = 13 days. Rules v1: K9005 left out (senior staff),
system failure from 3 miss punches plant-wide.
  K9001 late 40 min on 1–5 Sep                    → named (5 lates)
  K9002 leaves 90 min early on 8–10 Sep            → named (3 early) from the 10th on
  K9003 missed punch on 7, 8, 9 Sep                 → named (3 missed)
  K9004 on time every day                           → "on time every day"
  K9005 late 9 days, left out by a standing rule    → nowhere
  K9006 other company, late 4 days                  → named; only one shown under that company
  K9007–K9009 miss punch on 3 Sep (system day) + 2 more each → 2 counted, not named, not "on time"
Flow: Notice board view → counts → preview content (Hindi + English, DRAFT, no money / minutes) → auto skip chip →
company filter → "up to" date → manual skip day and undo → print (No. 1, recorded, history) → print again (No. 2) →
wording from the rules version → a month with no attendance → hr refused → phone width → nothing payroll written.

Usage: npm run build --prefix frontend; python3 backend/scripts/attendance-review-board-check.py
"""
import datetime, json, os, sqlite3, subprocess, tempfile, time, urllib.request
from playwright.sync_api import sync_playwright

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
PORT = int(os.environ.get('PORT', '3996')); BASE = f'http://127.0.0.1:{PORT}'
WORK = tempfile.mkdtemp(prefix='ar-board-'); DB = os.path.join(WORK, 'hr_system.db')
C = 'Indriyan Beverages Pvt Ltd'; C2 = 'Asian Lakto Ind Ltd'
PASS = FAIL = 0


def check(label, expected, actual):
    global PASS, FAIL
    if expected == actual: PASS += 1; print(f'  ✓ {label}')
    else: FAIL += 1; print(f'  ✗ {label} — expected {expected!r}, got {actual!r}')


def q(sql, args=()):
    con = sqlite3.connect(DB, timeout=10); con.row_factory = sqlite3.Row
    try: return [dict(r) for r in con.execute(sql, args).fetchall()]
    finally: con.close()


def days_1_15():
    d = datetime.date(2026, 9, 1); out = []
    while d.day <= 15:
        if d.weekday() != 6: out.append(d.isoformat())
        d += datetime.timedelta(days=1)
    return out


def seed():
    c = sqlite3.connect(DB)
    people = [('K9001', C), ('K9002', C), ('K9003', C), ('K9004', C), ('K9005', C), ('K9006', C2), ('K9007', C), ('K9008', C), ('K9009', C)]
    for n, (code, comp) in enumerate(people, 1):
        c.execute("INSERT INTO employees(code,name,department,designation,company,status,employment_type,is_contractor,gross_salary,date_of_joining) "
                  "VALUES(?,?,'PRODUCTION','OPERATOR',?,'Active','Permanent',0,20000,'2024-01-01')", (code, f'TEST BOARD {n}', comp))
    for iso in days_1_15():
        dd = int(iso[8:])
        for code, comp in people:
            late = (code == 'K9001' and dd <= 5) or (code == 'K9005' and dd <= 10) or (code == 'K9006' and dd <= 4)
            early = code == 'K9002' and 8 <= dd <= 10
            mp = (code == 'K9003' and dd in (7, 8, 9)) or (code == 'K9007' and dd in (3, 10, 11)) or (code == 'K9008' and dd in (3, 12, 14)) or (code == 'K9009' and dd in (3, 10, 15))
            c.execute("INSERT INTO attendance_processed(employee_code,date,status_original,status_final,in_time_final,out_time_final,shift_detected,"
                      "is_late_arrival,late_by_minutes,is_early_departure,early_by_minutes,is_left_late,is_miss_punch,month,year,company) "
                      "VALUES(?,?,'P','P',?,?,'12-Hour Shift',?,?,?,?,0,?,9,2026,?)",
                      (code, iso, '08:40' if late else '08:00', '18:30' if early else (None if mp else '20:00'), 1 if late else 0, 40 if late else 0,
                       1 if early else 0, 90 if early else 0, 1 if mp else 0, comp))
    cfg = {'standing_people': {'K9005': {'rule': 'exclude', 'reason': 'Senior staff'}}, 'thresholds': {'bulk_miss_punch_day': 3}}
    c.execute("INSERT INTO attendance_review_config(effective_from, config_json, updated_by) VALUES('2026-09', ?, 'admin')", (json.dumps(cfg),))
    c.commit(); c.close()


def login(ctx, user='admin', pw='Admin@123'):
    pg = ctx.new_page()
    pg.goto(BASE + '/login'); pg.get_by_placeholder('admin').fill(user); pg.get_by_placeholder('••••••••').fill(pw)
    pg.get_by_role('button', name='Sign in').click(); pg.wait_for_url(lambda u: '/login' not in u)
    return pg


def api(pg, method, path, body=None):
    return pg.evaluate("""async ([m, p, b]) => { const t = localStorage.getItem('hr_token');
        const r = await fetch(p, { method: m, credentials: 'include', headers: Object.assign({ 'content-type': 'application/json' }, t ? { Authorization: 'Bearer ' + t } : {}),
          body: b ? JSON.stringify(b) : undefined }); let j = null; try { j = await r.json() } catch {} return { status: r.status, body: j } }""", [method, path, body])


def pick_month(pg, m, y):
    pg.locator('select').filter(has=pg.locator('option', has_text='October')).first.select_option(str(m))
    pg.locator('select').filter(has=pg.locator('option', has_text='2026')).first.select_option(str(y))
    pg.wait_for_load_state('networkidle'); time.sleep(1)


def settle(pg):
    pg.wait_for_load_state('networkidle'); time.sleep(0.8)


def named(pg): return pg.get_by_test_id('ar-board-named').inner_text()
def preview(pg): return pg.get_by_test_id('ar-board-preview').get_attribute('srcdoc') or ''


# the board prints through a hidden iframe: count calls to that frame's print() instead of opening a dialog
PRINT_STUB = """(() => { if (window.top !== window) return;
  const d = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'contentWindow');
  Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', { configurable: true, get() { const w = d.get.call(this);
    try { if (w && !w.__stub) { w.print = () => { window.__prints = (window.__prints || 0) + 1 }; w.__stub = 1 } } catch (e) {} return w } }) })();"""
PAYROLL = ['salary_computations', 'day_calculations', 'late_coming_deductions', 'early_exit_deductions', 'attendance_processed', 'attendance_review_runs']

env = dict(os.environ, DATA_DIR=WORK, JWT_SECRET='x', PORT=str(PORT), NODE_ENV='production',
           ADMIN_PASSWORD='Admin@123', HR_PASSWORD='Indriyan@2025', FINANCE_PASSWORD='Finance@2025')
srv = subprocess.Popen(['node', f'{ROOT}/backend/server.js'], env=env, stdout=open(f'{WORK}/log', 'w'), stderr=subprocess.STDOUT)
try:
    for _ in range(80):
        try: urllib.request.urlopen(BASE + '/api/version', timeout=2); break
        except Exception: time.sleep(.5)
    seed()
    before = {t: q(f'SELECT COUNT(*) n FROM {t}')[0]['n'] for t in PAYROLL}
    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context(viewport={'width': 1440, 'height': 1000}); ctx.add_init_script(PRINT_STUB)
        pg = login(ctx); errs, bad = [], []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.on('response', lambda r: bad.append(f'{r.status} {r.url}') if '/api/' in r.url and r.status >= 400 else None)

        pg.goto(BASE + '/analytics/attendance-review'); settle(pg); pick_month(pg, 9, 2026)
        print('\n— Notice board view —')
        check('view switch has "Notice board"', 1, pg.get_by_test_id('ar-view-board').count())
        pg.get_by_test_id('ar-view-board').click()
        pg.get_by_test_id('ar-board-summary').wait_for(timeout=30000); settle(pg)
        check('default: up to 15 Sep', '2026-09-15', pg.get_by_test_id('ar-board-to').input_value())
        check('4 named (K9001, K9002, K9003, K9006)', '4', named(pg))
        check('1 on time every day (K9004)', '1', pg.get_by_test_id('ar-board-spotless').inner_text())
        html = preview(pg)
        check('preview names the four, not the left-out K9005', [True, True, True, True, False],
              [c in html for c in ('K9001', 'K9002', 'K9003', 'K9006', 'K9005')])
        check('preview: K9004 under "on time every day"', True, 'On time every day' in html and html.index('K9004') > html.index('On time every day'))
        check('preview: K9007–9 neither named nor on time', [False, False, False], [c in html for c in ('K9007', 'K9008', 'K9009')])
        check('preview: Hindi + English heading, DRAFT mark', [True, True, True], ['हाज़िरी सूचना' in html, 'Attendance Notice' in html, 'DRAFT' in html])
        check('preview: footer wording with the date filled in', [True, True], ['15 September 2026 तक' in html, 'up to 15 September 2026.' in html])
        check('preview: no money or minutes', [False, False, False], ['₹' in html, ' min' in html, 'Rs.' in html])
        check('auto skip chip: 3 Sep (system failure)', True, '3 Sep 2026 · auto' in pg.get_by_test_id('ar-board-skip').inner_text())
        pg.screenshot(path=os.path.join(WORK, 'board.png'), full_page=True)

        print('\n— filters —')
        pg.get_by_test_id('ar-board-company').select_option(C2); settle(pg)
        check('company: only K9006', ['1', True, False], [named(pg), 'K9006' in preview(pg), 'K9001' in preview(pg)])
        pg.get_by_test_id('ar-board-company').select_option(''); settle(pg)
        pg.get_by_test_id('ar-board-to').fill('2026-09-05'); settle(pg)
        named_part = preview(pg).split('On time every day')[0]
        check('up to 5 Sep: K9001 + K9006 only named (exits and missed punches come later)', ['2', True, False, False],
              [named(pg), 'K9001' in named_part, 'K9002' in named_part, 'K9003' in named_part])
        check('up to 5 Sep: heading says 1 – 5 September', True, '1 September 2026 – 5 September 2026' in preview(pg))
        pg.get_by_test_id('ar-board-to').fill('2026-09-15'); settle(pg)
        pg.get_by_test_id('ar-board-skip-input').fill('2026-09-08'); pg.get_by_test_id('ar-board-skip-add').click(); settle(pg)
        check('skip 8 Sep: K9003 down to 2 missed → off the notice', ['3', False], [named(pg), 'K9003' in preview(pg)])
        pg.get_by_role('button', name='Count missed punches on 8 Sep 2026 again').click(); settle(pg)
        check('undo the skip: K9003 back', ['4', True], [named(pg), 'K9003' in preview(pg)])

        print('\n— print —')
        pg.get_by_test_id('ar-board-print').click()
        pg.get_by_text('Notice No. 1 recorded').wait_for(timeout=15000); time.sleep(1.5)
        fr = pg.get_by_test_id('ar-board-print-frame')
        doc = fr.get_attribute('srcdoc') or ''
        check('print frame: "Notice No. 1", no DRAFT', [True, False], ['Notice No. 1' in doc, 'DRAFT' in doc])
        check('print dialog opened once', 1, pg.evaluate('window.__prints || 0'))
        rows = q("SELECT * FROM audit_log WHERE stage = 'ATTENDANCE_REVIEW_BOARD_PRINT' ORDER BY id")
        snap = json.loads(rows[0]['new_value']) if rows else {}
        check('recorded: one audit row by admin for 202609', [1, 'admin', 202609], [len(rows), rows[0]['changed_by'] if rows else None, rows[0]['record_id'] if rows else None])
        check('recorded: who was named, with counts', [['K9001', 5, 0, 0], ['K9002', 0, 3, 0], ['K9003', 0, 0, 3], ['K9006', 4, 0, 0]],
              sorted(snap.get('listed', [])))
        check('recorded: on time list', ['K9004'], snap.get('spotless'))
        settle(pg)
        check('history shows print No. 1', True, pg.get_by_test_id('ar-board-history').count() == 1 and 'admin' in pg.get_by_test_id('ar-board-history').inner_text())
        pg.get_by_test_id('ar-board-print').click(); pg.get_by_text('Notice No. 2 recorded').wait_for(timeout=15000); settle(pg)
        check('second print → No. 2, two rows in history', [True, 2], ['Notice No. 2' in (pg.get_by_test_id('ar-board-print-frame').get_attribute('srcdoc') or ''),
              pg.get_by_test_id('ar-board-history').locator('tbody tr').count()])
        check('only one print frame kept', 1, pg.get_by_test_id('ar-board-print-frame').count())

        print('\n— wording from the rules —')
        cfg = json.loads(q("SELECT config_json FROM attendance_review_config ORDER BY id DESC LIMIT 1")[0]['config_json'])
        cfg['board_footer_en'] = 'Check the list. Counted to {date}.'
        r = api(pg, 'PUT', '/api/analytics/attendance-review/config', {'effective_from': '2026-09', 'config': cfg})
        check('rules version with new wording saved', 200, r['status'])
        pg.get_by_test_id('ar-board-to').fill('2026-09-14'); settle(pg)
        check('preview uses the new English wording', True, 'Check the list. Counted to 14 September 2026.' in preview(pg))
        bad_w = api(pg, 'PUT', '/api/analytics/attendance-review/config', {'effective_from': '2026-09', 'config': {**cfg, 'board_footer_hi': 'x'}})
        check('too-short wording refused', 400, bad_w['status'])

        print('\n— edge cases —')
        pick_month(pg, 3, 2026); settle(pg)
        check('March (no attendance): says so, Print disabled', [1, True], [pg.get_by_test_id('ar-board-nodata').count(), pg.get_by_test_id('ar-board-print').is_disabled()])
        check('direct print of an empty month refused', 409, api(pg, 'POST', '/api/analytics/attendance-review/board/prints', {'month': 3, 'year': 2026, 'to': '2026-03-15'})['status'])
        hr = login(b.new_context(), 'hr', 'Indriyan@2025')
        check('hr refused (403)', 403, api(hr, 'GET', '/api/analytics/attendance-review/board?month=9&year=2026&to=2026-09-15')['status'])

        print('\n— phone width 390 —')
        pc = b.new_context(viewport={'width': 390, 'height': 844}); pc.add_init_script(PRINT_STUB)
        ph = login(pc); perr = []
        ph.on('pageerror', lambda e: perr.append(str(e)))
        ph.goto(BASE + '/analytics/attendance-review'); settle(ph); pick_month(ph, 9, 2026)
        ph.get_by_test_id('ar-view-board').click(); ph.get_by_test_id('ar-board-summary').wait_for(timeout=30000); settle(ph)
        check('phone: board renders', '4', named(ph))
        check('phone: no horizontal page scroll', True, ph.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1'))
        ph.screenshot(path=os.path.join(WORK, 'phone.png'), full_page=True)
        check('phone: 0 page errors', [], perr)

        check('0 page errors', [], errs)
        check('API errors only the intended ones (400 wording, 409 empty month)', True,
              all(('/config' in x and x.startswith('400')) or ('/board/prints' in x and x.startswith('409')) for x in bad))
        b.close()
    after = {t: q(f'SELECT COUNT(*) n FROM {t}')[0]['n'] for t in PAYROLL}
    check('no payroll / attendance / run table written', before, after)
finally:
    srv.terminate()
    try: srv.wait(timeout=10)
    except Exception: srv.kill()

print(f'\n{PASS} passed, {FAIL} failed  (screenshots: {WORK}/board.png, phone.png)')
raise SystemExit(1 if FAIL else 0)
