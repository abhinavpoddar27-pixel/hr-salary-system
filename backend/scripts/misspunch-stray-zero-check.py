#!/usr/bin/env python3
"""Stage 2 Miss Punch: no stray "0" in the Action cell (P1-24, finding O-3) — browser check.

Chromium against the BUILT dist, real hr + finance logins, scratch DATA_DIR with fictional data
(employee codes T24xx, names "TEST EMP n" — the repo is public). Seeds September 2026 miss-punch rows
in the four workflow states:
  T2401 unresolved (miss_punch_resolved = 0)           → hr: Correct
  T2402 resolved, finance pending                      → finance: Approve / Reject
  T2403 resolved, finance rejected                     → hr: Re-resolve
  T2404 resolved, finance approved                     → Finalised
  T2405 unresolved, second unresolved row (another day)

The old guard `{rec.miss_punch_resolved && …}` printed the integer 0 on every unresolved row.

Usage:
  python3 backend/scripts/misspunch-stray-zero-check.py               # this tree's server + dist
  APP_ROOT=/tmp/wt python3 .../misspunch-stray-zero-check.py --base   # another tree (origin/main): records the "0"
Needs `npm run build --prefix frontend` in APP_ROOT first. PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers.
"""
import os, re, shutil, sqlite3, subprocess, sys, tempfile, time, urllib.request
from playwright.sync_api import sync_playwright

HERE_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
ROOT = os.path.abspath(os.environ.get('APP_ROOT', HERE_ROOT))
BASE_MODE = '--base' in sys.argv
PORT = int(os.environ.get('PORT', '3124')); BASE = f'http://127.0.0.1:{PORT}'
WORK = tempfile.mkdtemp(prefix='mp-zero-'); DB = os.path.join(WORK, 'hr_system.db')
C = 'Asian Lakto Ind Ltd'
PASS = FAIL = 0

# code, date, resolved, finance_status, type, in, out
ROWS = [
    ('T2401', '2026-09-03', 0, None,       'MISSING_OUT', '09:00', None),
    ('T2402', '2026-09-04', 1, '',         'MISSING_IN',  '09:05', '18:00'),
    ('T2403', '2026-09-05', 1, 'rejected', 'MISSING_OUT', '09:10', '18:30'),
    ('T2404', '2026-09-06', 1, 'approved', 'MISSING_IN',  '09:00', '18:00'),
    ('T2405', '2026-09-08', 0, None,       'MISSING_IN',  None,    '18:00'),
]
UNRESOLVED = ('T2401', 'T2405')
# Pre-existing, out of scope (same on origin/main 18bef07): MissPunch.jsx asks GET /features/leave-automation/status
# for every role, but the route is admin/hr only, so finance gets a 403 (+ the api.js console line). Reported and
# counted separately below, not treated as a P1-24 failure.
KNOWN_403 = '/features/leave-automation/status'


def check(label, expected, actual):
    global PASS, FAIL
    if expected == actual: PASS += 1; print(f'  ✓ {label}')
    else: FAIL += 1; print(f'  ✗ {label} — expected {expected!r}, got {actual!r}')


def seed():
    c = sqlite3.connect(DB)
    for i, (code, date, res, fs, typ, tin, tout) in enumerate(ROWS, 1):
        c.execute("INSERT OR IGNORE INTO employees(code,name,department,company,status,employment_type,gross_salary) "
                  "VALUES(?,?,'TEST DEPT',?,'Active','Permanent',20000)", (code, f'TEST EMP {i}', C))
        c.execute("INSERT INTO attendance_processed(employee_code,date,status_original,status_final,in_time_original,"
                  "out_time_original,in_time_final,out_time_final,is_miss_punch,miss_punch_type,miss_punch_resolved,"
                  "miss_punch_finance_status,miss_punch_finance_notes,month,year,company) "
                  "VALUES(?,?,'P','P',?,?,?,?,1,?,?,?,?,9,2026,?)",
                  (code, date, tin, tout, tin if res else None, tout if res else None, typ, res, fs,
                   'Test reject note' if fs == 'rejected' else None, C))
    c.commit(); c.close()


def login(b, user, pw, width=1440):
    ctx = b.new_context(viewport={'width': width, 'height': 900})
    pg = ctx.new_page()
    errs, cons, bad = [], [], []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('console', lambda m: cons.append(m.text) if m.type == 'error' and 'vite.svg' not in m.text and '404' not in m.text else None)
    pg.on('response', lambda r: bad.append(f'{r.status} {r.url}') if '/api/' in r.url and r.status >= 400 else None)
    pg.goto(BASE + '/login'); pg.get_by_placeholder('admin').fill(user); pg.get_by_placeholder('••••••••').fill(pw)
    pg.get_by_role('button', name='Sign in').click(); pg.wait_for_url(lambda u: '/login' not in u)
    return pg, errs, cons, bad


def open_page(pg, month='9'):
    pg.goto(BASE + '/pipeline/miss-punch'); pg.wait_for_load_state('networkidle')
    pg.locator('select').filter(has=pg.locator('option', has_text='September')).first.select_option(month)
    pg.locator('select').filter(has=pg.locator('option', has_text='2026')).first.select_option('2026')
    pg.wait_for_load_state('networkidle'); time.sleep(1)


ROWS_JS = r"""() => {
  const out = {};
  for (const tr of document.querySelectorAll('table tbody tr')) {
    const tds = tr.querySelectorAll(':scope > td');
    if (tds.length < 12) continue;
    const m = (tds[1].textContent || '').match(/T24\d\d/);
    if (!m) continue;
    const zeros = (el) => {
      const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let n = 0;
      while (w.nextNode()) if (w.currentNode.nodeValue.trim() === '0') n++;
      return n;
    };
    const act = tds[tds.length - 1];
    out[m[0]] = { actionText: act.textContent.trim(), actionZeros: zeros(act), rowZeros: zeros(tr),
                  buttons: [...act.querySelectorAll('button')].map(b => b.textContent.trim()) };
  }
  return out;
}"""


def rows(pg):
    pg.locator('table tbody tr', has_text='T2401').first.wait_for(timeout=15000)
    return pg.evaluate(ROWS_JS)


env = dict(os.environ, DATA_DIR=WORK, JWT_SECRET='x', PORT=str(PORT), NODE_ENV='production',
           ADMIN_PASSWORD='Admin@123', HR_PASSWORD='Indriyan@2025', FINANCE_PASSWORD='Finance@2025')
srv = subprocess.Popen(['node', f'{ROOT}/backend/server.js'], env=env, stdout=open(f'{WORK}/log', 'w'), stderr=subprocess.STDOUT)
try:
    for _ in range(80):
        try: urllib.request.urlopen(BASE + '/api/version', timeout=2); break
        except Exception: time.sleep(.5)
    seed()
    print(f'App root: {ROOT}  mode: {"BASE (expect the stray 0)" if BASE_MODE else "fix"}')

    with sync_playwright() as p:
        b = p.chromium.launch()
        if BASE_MODE:
            for user, pw in (('hr', 'Indriyan@2025'), ('finance', 'Finance@2025')):
                pg, errs, cons, bad = login(b, user, pw); open_page(pg)
                r = rows(pg)
                for code in UNRESOLVED:
                    print(f'  {user} {code} action: {r[code]["actionText"]!r}')
                    check(f'old code: {user} {code} Action cell has a "0" text node', 1, r[code]['actionZeros'])
                check(f'old code: {user} resolved rows have no "0"', [0, 0, 0],
                      [r[c]['actionZeros'] for c in ('T2402', 'T2403', 'T2404')])
            b.close()
        else:
            for user, pw in (('hr', 'Indriyan@2025'), ('finance', 'Finance@2025')):
                print(f'\n— {user}: Miss Punch Sep 2026 —')
                pg, errs, cons, bad = login(b, user, pw); open_page(pg)
                r = rows(pg)
                check(f'{user}: all 5 rows shown', sorted(c[0] for c in ROWS), sorted(r))
                for code, *_ in ROWS:
                    check(f'{user}: {code} no "0" text node in Action cell', 0, r[code]['actionZeros'])
                    check(f'{user}: {code} no "0" text node anywhere in the row', 0, r[code]['rowZeros'])
                if user == 'hr':
                    check('hr: T2401 Correct button', ['Correct'], r['T2401']['buttons'])
                    check('hr: T2401 Action text is exactly "Correct"', 'Correct', r['T2401']['actionText'])
                    check('hr: T2405 Correct button', ['Correct'], r['T2405']['buttons'])
                    check('hr: T2402 (finance pending) no action for hr', '', r['T2402']['actionText'])
                    check('hr: T2403 Re-resolve button', ['Re-resolve'], r['T2403']['buttons'])
                else:
                    check('finance: T2401 Action cell empty', '', r['T2401']['actionText'])
                    check('finance: T2405 Action cell empty', '', r['T2405']['actionText'])
                    check('finance: T2402 Approve + Reject', ['✓ Approve', '✕ Reject'], r['T2402']['buttons'])
                check(f'{user}: T2404 Finalised', 'Finalised', r['T2404']['actionText'])
                check(f'{user}: 0 page errors', [], errs)
                known = [x for x in bad if KNOWN_403 in x]
                check(f'{user}: 0 console errors (known leave-automation 403 aside)', [],
                      [x for x in cons if KNOWN_403 not in x and not (known and '403 (Forbidden)' in x)])
                check(f'{user}: 0 API ≥ 400 (known leave-automation 403 aside)', [], [x for x in bad if KNOWN_403 not in x])
                print(f'  · {user}: known pre-existing leave-automation 403 seen {len(known)}×')

            print('\n— user sim: hr opens Correct on T2401, cancels; row unchanged —')
            pg, errs, cons, bad = login(b, 'hr', 'Indriyan@2025'); open_page(pg)
            rows(pg)
            pg.locator('table tbody tr', has_text='T2401').first.get_by_role('button', name='Correct').click()
            time.sleep(.5)
            cancel = pg.get_by_role('button', name='Cancel')
            check('sim: edit row opened (Cancel visible)', True, cancel.count() > 0)
            if cancel.count(): cancel.first.click(); time.sleep(.5)
            r = rows(pg)
            check('sim: after cancel T2401 still Correct, no "0"', ('Correct', 0), (r['T2401']['actionText'], r['T2401']['actionZeros']))
            check('sim: 0 page errors', [], errs)

            print('\n— edge: phone width 390px (finance) —')
            pg, errs, cons, bad = login(b, 'finance', 'Finance@2025', width=390); open_page(pg)
            r = rows(pg)
            check('phone: unresolved rows no "0"', [0, 0], [r[c]['actionZeros'] for c in UNRESOLVED])
            check('phone: 0 page errors', [], errs)

            print('\n— edge: empty month (August 2026) —')
            pg, errs, cons, bad = login(b, 'hr', 'Indriyan@2025'); open_page(pg, '8')
            check('empty: no T24 rows', {}, pg.evaluate(ROWS_JS))
            check('empty: 0 page errors', [], errs)
            check('empty: 0 API ≥ 400', [], bad)
            b.close()
finally:
    srv.terminate(); shutil.rmtree(WORK, ignore_errors=True)

print(f'\n{PASS} passed, {FAIL} failed')
sys.exit(1 if FAIL else 0)
