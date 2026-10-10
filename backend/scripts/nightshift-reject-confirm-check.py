#!/usr/bin/env python3
"""Stage 4 Night Shift: reject asks first; "Undo" is relabelled "Reject pairing" (P1-10, finding P-6) — browser check.

Chromium against the BUILT dist, real hr login, scratch DATA_DIR with fictional data (codes T96xx, names
"TEST NIGHT n" — the repo is public). Seeds September 2026 night-shift pairs plus the IN/OUT attendance rows
each pair points at:
  T9601 pending / medium   T9602 confirmed / medium   T9603 confirmed / high (no reject button)
  T9604 pending / low (double-click edge)   T9605 pending / medium (phone width)

Usage:
  python3 backend/scripts/nightshift-reject-confirm-check.py                # this tree's server + dist
  APP_ROOT=/tmp/wt python3 .../nightshift-reject-confirm-check.py --base    # another tree (e.g. origin/main):
                                                                            # one click rejects, no confirm
Needs `npm run build --prefix frontend` in APP_ROOT first. PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers. Port 3110.
"""
import os, re, sqlite3, subprocess, sys, tempfile, time, urllib.request
from playwright.sync_api import sync_playwright

HERE_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
ROOT = os.path.abspath(os.environ.get('APP_ROOT', HERE_ROOT))
BASE_MODE = '--base' in sys.argv
PORT = int(os.environ.get('PORT', '3110')); BASE = f'http://127.0.0.1:{PORT}'
WORK = tempfile.mkdtemp(prefix='ns-rej-'); DB = os.path.join(WORK, 'hr_system.db')
C = 'Asian Lakto Ind Ltd'
PASS = FAIL = 0

# code, in_date, out_date, confidence, confirmed
PAIRS = [
    ('T9601', '2026-09-03', '2026-09-04', 'medium', 0),
    ('T9602', '2026-09-05', '2026-09-06', 'medium', 1),
    ('T9603', '2026-09-07', '2026-09-08', 'high', 1),
    ('T9604', '2026-09-09', '2026-09-10', 'low', 0),
    ('T9605', '2026-09-11', '2026-09-12', 'medium', 0),
]
PAIR_ID = {}


def check(label, expected, actual):
    global PASS, FAIL
    if expected == actual: PASS += 1; print(f'  ✓ {label}')
    else: FAIL += 1; print(f'  ✗ {label} — expected {expected!r}, got {actual!r}')


def fmt(d):
    y, m, dd = d.split('-')
    return f"{dd}-{['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][int(m)]}-{y}"


def seed():
    c = sqlite3.connect(DB)
    for i, (code, ind, outd, conf, confirmed) in enumerate(PAIRS, 1):
        c.execute("INSERT OR IGNORE INTO employees(code,name,department,company,status,employment_type,gross_salary) "
                  "VALUES(?,?,'TEST DEPT',?,'Active','Permanent',20000)", (code, f'TEST NIGHT {i}', C))
        cur = c.execute("INSERT INTO attendance_processed(employee_code,date,status_original,status_final,in_time_original,"
                        "in_time_final,out_time_original,out_time_final,is_night_shift,night_pair_date,is_miss_punch,company) "
                        "VALUES(?,?,'P','P','20:05','20:05',NULL,'08:10',1,?,0,?)", (code, ind, outd, C))
        in_id = cur.lastrowid
        cur = c.execute("INSERT INTO attendance_processed(employee_code,date,status_original,status_final,in_time_original,"
                        "out_time_original,is_night_out_only,is_night_shift,night_pair_date,company) "
                        "VALUES(?,?,'P','P',NULL,'08:10',1,1,?,?)", (code, outd, ind, C))
        out_id = cur.lastrowid
        cur = c.execute("INSERT INTO night_shift_pairs(employee_code,in_record_id,out_record_id,in_date,out_date,in_time,"
                        "out_time,calculated_hours,confidence,is_confirmed,is_rejected,month,year,company) "
                        "VALUES(?,?,?,?,?,'20:05','08:10',12.1,?,?,0,9,2026,?)",
                        (code, in_id, out_id, ind, outd, conf, confirmed, C))
        PAIR_ID[code] = (cur.lastrowid, in_id, out_id)
    c.commit(); c.close()


def db_state(code):
    pid, in_id, out_id = PAIR_ID[code]
    c = sqlite3.connect(DB)
    p = c.execute('SELECT is_confirmed,is_rejected FROM night_shift_pairs WHERE id=?', (pid,)).fetchone()
    a = c.execute('SELECT out_time_final,is_miss_punch,miss_punch_type,is_night_shift FROM attendance_processed WHERE id=?',
                  (in_id,)).fetchone()
    b = c.execute('SELECT is_night_out_only,is_night_shift FROM attendance_processed WHERE id=?', (out_id,)).fetchone()
    c.close()
    return {'confirmed': p[0], 'rejected': p[1], 'in_out_time': a[0], 'in_miss': a[1], 'in_miss_type': a[2],
            'in_night': a[3], 'out_only': b[0], 'out_night': b[1]}


UNTOUCHED = lambda confirmed: {'confirmed': confirmed, 'rejected': 0, 'in_out_time': '08:10', 'in_miss': 0,
                               'in_miss_type': None, 'in_night': 1, 'out_only': 1, 'out_night': 1}


def login(b, width=1440):
    ctx = b.new_context(viewport={'width': width, 'height': 900})
    pg = ctx.new_page()
    errs, cons, bad, posts = [], [], [], []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('console', lambda m: cons.append(m.text) if m.type == 'error' and 'vite.svg' not in m.text and '404' not in m.text else None)
    pg.on('response', lambda r: bad.append(f'{r.status} {r.url}') if '/api/' in r.url and r.status >= 400 else None)
    pg.on('request', lambda r: posts.append(r.url) if r.method == 'POST' and '/night-shifts/' in r.url and r.url.endswith('/reject') else None)
    pg.goto(BASE + '/login'); pg.get_by_placeholder('admin').fill('hr'); pg.get_by_placeholder('••••••••').fill('Indriyan@2025')
    pg.get_by_role('button', name='Sign in').click(); pg.wait_for_url(lambda u: '/login' not in u)
    open_month(pg)
    return pg, errs, cons, bad, posts


def open_month(pg):
    pg.goto(BASE + '/pipeline/night-shift'); pg.wait_for_load_state('networkidle')
    pg.locator('select').filter(has=pg.locator('option', has_text='September')).first.select_option('9')
    pg.locator('select').filter(has=pg.locator('option', has_text='2026')).first.select_option('2026')
    pg.wait_for_load_state('networkidle')
    pg.locator('tbody tr', has_text='T9601').first.wait_for(timeout=15000)


def row(pg, code):
    return pg.locator('tbody > tr:not(.drill-down-row)', has_text=code).first


def dialog(pg):
    return pg.locator('div.fixed.inset-0.z-50', has=pg.locator('h3', has_text='Reject this night-shift pairing?'))


def wait_state(code, key, val, secs=10):
    for _ in range(secs * 10):
        if db_state(code)[key] == val: return
        time.sleep(.1)


env = dict(os.environ, DATA_DIR=WORK, JWT_SECRET='x', PORT=str(PORT), NODE_ENV='production',
           ADMIN_PASSWORD='Admin@123', HR_PASSWORD='Indriyan@2025', FINANCE_PASSWORD='Finance@2025')
srv = subprocess.Popen(['node', f'{ROOT}/backend/server.js'], env=env, stdout=open(f'{WORK}/log', 'w'), stderr=subprocess.STDOUT)
try:
    for _ in range(80):
        try: urllib.request.urlopen(BASE + '/api/version', timeout=2); break
        except Exception: time.sleep(.5)
    seed()
    print(f'App root: {ROOT}  mode: {"BASE (expect one-click reject, Undo label)" if BASE_MODE else "fix"}')

    with sync_playwright() as p:
        b = p.chromium.launch()
        pg, errs, cons, bad, posts = login(b)

        if BASE_MODE:
            check('old code: "Undo" button on confirmed medium pair', 1, row(pg, 'T9602').get_by_text('Undo', exact=True).count())
            x = row(pg, 'T9601').get_by_role('button', name='✕')
            check('old code: ✕ has no aria-label', None, x.get_attribute('aria-label'))
            x.click(); wait_state('T9601', 'rejected', 1); time.sleep(.5)
            check('old code: no confirm dialog after ✕', 0, dialog(pg).count())
            check('old code: one click sent the reject POST', 1, len(posts))
            check('old code: one click rejected the pair in DB', 1, db_state('T9601')['rejected'])
            check('old code: IN day now Missing OUT', 'MISSING_OUT', db_state('T9601')['in_miss_type'])
            pg.wait_for_load_state('networkidle'); time.sleep(.8)
            print(f'  · info: old code status cell right after reject shows "Rejected": '
                  f'{"Rejected" in row(pg, "T9601").inner_text()} (same stale refetch, pre-existing)')
        else:
            print('— labels')
            check('no "Undo" text anywhere on the page', 0, pg.get_by_text('Undo', exact=True).count())
            xa = row(pg, 'T9601').get_by_role('button', name='Reject pairing')
            check('pending ✕: aria-label "Reject pairing"', 'Reject pairing', xa.get_attribute('aria-label'))
            check('pending ✕: title "Reject pairing"', 'Reject pairing', xa.get_attribute('title'))
            check('pending ✕: visible glyph kept', '✕', xa.inner_text().strip())
            rb = row(pg, 'T9602').get_by_role('button', name='Reject pairing')
            check('confirmed medium: button text "Reject pairing"', 'Reject pairing', rb.inner_text().strip())
            check('confirmed medium: aria-label', 'Reject pairing', rb.get_attribute('aria-label'))
            check('confirmed high: no reject button', 0, row(pg, 'T9603').get_by_role('button', name='Reject pairing').count())

            print('— pending pair T9601: cancel, then reject')
            xa.click(); dialog(pg).wait_for(timeout=5000)
            msg = dialog(pg).inner_text()
            for want in ('TEST NIGHT 1', 'T9601', fmt('2026-09-03'), fmt('2026-09-04'), 'Missing OUT', 'cannot be undone here'):
                check(f'dialog names {want!r}', True, want in msg)
            check('pending pair: no "confirmed earlier" line', False, 'confirmed earlier' in msg)
            check('opening dialog did not expand the row', 0, pg.locator('tr.drill-down-row').count())
            dialog(pg).get_by_role('button', name='Keep pairing').click(); time.sleep(.8)
            check('Cancel closes the dialog', 0, dialog(pg).count())
            check('Cancel sends no reject POST', 0, len(posts))
            check('Cancel leaves pair + both attendance rows unchanged', UNTOUCHED(0), db_state('T9601'))
            check('status still Pending', True, 'Pending' in row(pg, 'T9601').inner_text())
            xa.click(); dialog(pg).wait_for(timeout=5000)
            dialog(pg).get_by_role('button', name='Reject pairing').click()
            wait_state('T9601', 'rejected', 1); pg.wait_for_load_state('networkidle'); time.sleep(.8)
            s = db_state('T9601')
            check('Reject: pair is_rejected=1', 1, s['rejected'])
            check('Reject: IN day Missing OUT, out time cleared', ('MISSING_OUT', None, 1), (s['in_miss_type'], s['in_out_time'], s['in_miss']))
            check('Reject: OUT day stands alone', (0, 0), (s['out_only'], s['out_night']))
            check('Reject: exactly one POST', 1, len(posts))
            check('Reject: dialog closed', 0, dialog(pg).count())
            imm = 'Rejected' in row(pg, 'T9601').inner_text()
            print(f'  · info: status cell right after reject shows "Rejected": {imm} '
                  '(pre-existing: GET /night-shifts has Cache-Control max-age=5, refetch can get the stale copy)')
            time.sleep(6); open_month(pg)
            check('Reject: after reload the status cell is "Rejected"', True, 'Rejected' in row(pg, 'T9601').inner_text())
            check('Reject: rejected row has no reject button', 0, row(pg, 'T9601').get_by_role('button', name='Reject pairing').count())
            xa = row(pg, 'T9601')  # (no longer used for clicks)
            rb = row(pg, 'T9602').get_by_role('button', name='Reject pairing')

            print('— confirmed medium pair T9602: cancel, then reject')
            rb.click(); dialog(pg).wait_for(timeout=5000)
            msg = dialog(pg).inner_text()
            check('dialog names T9602 + dates', True, all(w in msg for w in ('T9602', fmt('2026-09-05'), fmt('2026-09-06'))))
            check('dialog says it was confirmed earlier', True, 'confirmed earlier' in msg)
            dialog(pg).get_by_role('button', name='Keep pairing').click(); time.sleep(.8)
            check('Cancel: no POST', 1, len(posts))
            check('Cancel: unchanged (still confirmed)', UNTOUCHED(1), db_state('T9602'))
            rb.click(); dialog(pg).wait_for(timeout=5000)
            dialog(pg).get_by_role('button', name='Reject pairing').click()
            wait_state('T9602', 'rejected', 1); pg.wait_for_load_state('networkidle'); time.sleep(.8)
            s = db_state('T9602')
            check('Reject: confirmed pair now rejected, not confirmed', (0, 1), (s['confirmed'], s['rejected']))
            check('Reject: IN day Missing OUT', 'MISSING_OUT', s['in_miss_type'])
            check('Reject: dialog closed', 0, dialog(pg).count())

            print('— edge: double-click Reject in the dialog (T9604)')
            row(pg, 'T9604').get_by_role('button', name='Reject pairing').click(); dialog(pg).wait_for(timeout=5000)
            dialog(pg).get_by_role('button', name='Reject pairing').dblclick()
            wait_state('T9604', 'rejected', 1); pg.wait_for_load_state('networkidle'); time.sleep(.8)
            check('double-click: pair rejected', 1, db_state('T9604')['rejected'])
            check('double-click: at most 2 POSTs total for it (route idempotent)', True, len(posts) - 2 in (1, 2))
            check('double-click: dialog closed', 0, dialog(pg).count())
            check('high pair T9603 untouched throughout', UNTOUCHED(1), db_state('T9603'))

            print('— backdrop click cancels (T9605)')
            row(pg, 'T9605').get_by_role('button', name='Reject pairing').click(); dialog(pg).wait_for(timeout=5000)
            pg.mouse.click(5, 5); time.sleep(.6)
            check('backdrop click closes dialog', 0, dialog(pg).count())
            check('backdrop click: T9605 unchanged', UNTOUCHED(0), db_state('T9605'))

            print('— 390px phone')
            pg2, e2, c2, b2, p2 = login(b, 390)
            btn = row(pg2, 'T9605').get_by_role('button', name='Reject pairing')
            btn.scroll_into_view_if_needed(); btn.click(); dialog(pg2).wait_for(timeout=5000)
            box = dialog(pg2).locator('h3').bounding_box()
            check('390px: dialog title inside viewport', True, box is not None and box['x'] >= 0 and box['x'] + box['width'] <= 390)
            dialog(pg2).get_by_role('button', name='Keep pairing').click(); time.sleep(.6)
            check('390px: cancel → no POST, unchanged', (0, UNTOUCHED(0)), (len(p2), db_state('T9605')))
            errs += e2; cons += c2; bad += b2

        check('0 page errors', [], errs)
        check('0 console errors', [], cons)
        check('0 API responses ≥ 400', [], bad)
        b.close()
finally:
    srv.terminate()
print(f'\n{PASS} passed, {FAIL} failed')
sys.exit(1 if FAIL else 0)
