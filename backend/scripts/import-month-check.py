#!/usr/bin/env python3
"""Stage 1 Import sends the picked month; no dead Overwrite checkbox; re-import warning (P1-17, findings P-7/P-8).

Chromium against the BUILT dist, real hr login, scratch DATA_DIR. Fictional EESL files are built here with the
parser.test.js layout (codes T1701/T1702, names "TEST EMP n" — the repo is public): one for Sep 2026, one for Aug 2026.

Usage:
  python3 backend/scripts/import-month-check.py               # this tree's server + dist
  APP_ROOT=/tmp/wt python3 .../import-month-check.py --base   # another tree (origin/main): checkbox present,
                                                               # wrong-month file imports silently
Needs `npm run build --prefix frontend` in APP_ROOT first. PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers.
"""
import json, os, re, sqlite3, subprocess, sys, tempfile, time, urllib.request
from playwright.sync_api import sync_playwright

HERE_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
ROOT = os.path.abspath(os.environ.get('APP_ROOT', HERE_ROOT))
BASE_MODE = '--base' in sys.argv
PORT = int(os.environ.get('PORT', '3117')); BASE = f'http://127.0.0.1:{PORT}'
WORK = tempfile.mkdtemp(prefix='imp-month-'); DB = os.path.join(WORK, 'hr_system.db')
PASS = FAIL = 0
MONTH_NAMES = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September',
               'October', 'November', 'December']

# Node builds the .xls (xlsx lib from this tree) — same layout as backend/src/__tests__/parser.test.js
BUILD_JS = r"""
const XLSX = require(process.argv[2]);
const [out, year, month] = [process.argv[3], +process.argv[4], +process.argv[5]];
const AB = ['S','M','T','W','Th','F','St'], MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
const heads = [], st = [], tin = [], tout = [], tot = [];
for (let d = 1; d <= last; d++) {
  const wd = new Date(Date.UTC(year, month - 1, d)).getUTCDay();
  heads.push(`${d} ${AB[wd]}`);
  const off = wd === 0;
  st.push(off ? 'WO' : 'P'); tin.push(off ? '' : '09:01'); tout.push(off ? '' : '18:35'); tot.push(off ? '00:00' : '09:34');
}
const p2 = n => String(n).padStart(2, '0');
const rows = [['Monthly Status Report (Basic Work Duration)'],
  [`${MON[month-1]} 01 ${year}  To  ${MON[month-1]} ${p2(last)} ${year}`],
  ['Company:', 'Asian Lakto Ind Ltd'], [], ['Days', ...heads], ['Department:', 'TEST DEPT']];
[['T1701', 'TEST EMP 1'], ['T1702', 'TEST EMP 2']].forEach(([c, n]) => {
  rows.push(['Emp. Code :', c, 'Emp. Name :', n]); rows.push(['Status', ...st]); rows.push(['InTime', ...tin]);
  rows.push(['OutTime', ...tout]); rows.push(['Total', ...tot]); rows.push([]);
});
const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Sheet1');
XLSX.writeFile(wb, out, { bookType: 'biff8' });
"""


def check(label, expected, actual):
    global PASS, FAIL
    if expected == actual: PASS += 1; print(f'  ✓ {label}')
    else: FAIL += 1; print(f'  ✗ {label} — expected {expected!r}, got {actual!r}')


def build_file(name, year, month):
    js = os.path.join(WORK, 'build.js'); open(js, 'w').write(BUILD_JS)
    out = os.path.join(WORK, name)
    subprocess.run(['node', js, os.path.join(HERE_ROOT, 'backend', 'node_modules', 'xlsx'), out, str(year), str(month)],
                   check=True)
    return out


def counts():
    c = sqlite3.connect(DB)
    r = {t: c.execute(f'SELECT COUNT(*) FROM {t}').fetchone()[0]
         for t in ('monthly_imports', 'attendance_raw', 'attendance_processed')}
    c.close(); return r


def login(b, width=1440):
    ctx = b.new_context(viewport={'width': width, 'height': 900})
    pg = ctx.new_page()
    errs, cons, bad = [], [], []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('console', lambda m: cons.append(m.text) if m.type == 'error' and 'vite.svg' not in m.text and '404' not in m.text else None)
    pg.on('response', lambda r: bad.append(f'{r.status} {r.url}') if '/api/' in r.url and r.status >= 400 else None)
    pg.goto(BASE + '/login'); pg.get_by_placeholder('admin').fill('hr'); pg.get_by_placeholder('••••••••').fill('Indriyan@2025')
    pg.get_by_role('button', name='Sign in').click(); pg.wait_for_url(lambda u: '/login' not in u)
    pg.goto(BASE + '/pipeline/import'); pg.wait_for_load_state('networkidle')
    return pg, errs, cons, bad


def pick_month(pg, month, year=2026):
    pg.locator('select').filter(has=pg.locator('option', has_text='September')).first.select_option(str(month))
    pg.locator('select').filter(has=pg.locator('option', has_text='2026')).first.select_option(str(year))
    pg.wait_for_load_state('networkidle'); time.sleep(.5)


def upload(pg, paths):
    """Select files, click Upload, return (multipart body bytes, results card text)."""
    pg.locator('input[type=file]').first.set_input_files(paths)
    seen = []
    def grab(route):  # multipart bodies are only readable from a route handler
        seen.append(route.request.post_data_buffer or b''); route.continue_()
    pg.route('**/api/import/upload', grab)
    with pg.expect_response(lambda r: '/api/import/upload' in r.url, timeout=120000):
        pg.get_by_role('button', name=re.compile('Upload & Parse')).click()
    pg.unroute('**/api/import/upload', grab)
    body = seen[0] if seen else b''
    card = pg.locator('div.card', has=pg.get_by_role('heading', name='Import Results'))
    card.wait_for(timeout=30000)
    return body, card


def field(body, name):
    m = re.search(rb'name="' + name.encode() + rb'"\r\n\r\n([^\r]*)\r\n', body)
    return m.group(1).decode() if m else None


env = dict(os.environ, DATA_DIR=WORK, JWT_SECRET='x', PORT=str(PORT), NODE_ENV='production',
           ADMIN_PASSWORD='Admin@123', HR_PASSWORD='Indriyan@2025', FINANCE_PASSWORD='Finance@2025')
srv = subprocess.Popen(['node', f'{ROOT}/backend/server.js'], env=env, stdout=open(f'{WORK}/log', 'w'), stderr=subprocess.STDOUT)
try:
    for _ in range(80):
        try: urllib.request.urlopen(BASE + '/api/version', timeout=2); break
        except Exception: time.sleep(.5)
    SEP = build_file('EESL_TEST_SEP2026.xls', 2026, 9)
    AUG = build_file('EESL_TEST_AUG2026.xls', 2026, 8)
    print(f'App root: {ROOT}  mode: {"BASE (expect checkbox + silent wrong-month import)" if BASE_MODE else "fix"}')

    with sync_playwright() as p:
        b = p.chromium.launch()
        pg, errs, cons, bad = login(b)
        if BASE_MODE:
            check('old code: Overwrite checkbox present', True, pg.get_by_text('Overwrite if month already imported').count() > 0)
            pick_month(pg, 10)
            before = counts()
            body, card = upload(pg, [SEP])
            check('old code: upload body has no month field', None, field(body, 'month'))
            check('old code: Sep file imported while Oct selected (silently)', True, 'succeeded' in card.inner_text() and
                  counts()['monthly_imports'] > before['monthly_imports'])
            b.close()
        else:
            print('\n— page —')
            check('no Overwrite checkbox text', 0, pg.get_by_text(re.compile('Overwrite', re.I)).count())
            check('no checkbox in the upload card', 0,
                  pg.locator('div.card', has=pg.get_by_role('heading', name='Upload EESL Files')).locator('input[type=checkbox]').count())
            check('hint says files are for the selected month', 1,
                  pg.get_by_text('multiple files supported (all for the month selected above)').count())

            print('\n— wrong month: Oct 2026 selected, Sep file —')
            pick_month(pg, 10)
            check('month line names Oct 2026', True, 'Oct 2026' in pg.get_by_test_id('import-month-line').inner_text())
            check('no re-import warning on an empty month', 0, pg.get_by_test_id('reimport-warning').count())
            before = counts()
            body, card = upload(pg, [SEP])
            check('body month = 10', '10', field(body, 'month'))
            check('body year = 2026', '2026', field(body, 'year'))
            check('body has no overwrite field', None, field(body, 'overwrite'))
            err = card.get_by_test_id('import-error').first.inner_text()
            check('server refusal text shown', True, err.startswith('You selected 10/2026'))
            check('refusal names the file month', True, '9/2026' in err)
            check('badge 0/1 succeeded', True, '0/1 succeeded' in card.inner_text())
            check('failure toast', 1, pg.get_by_text('1 file(s) failed to import').count())
            check('DB counts unchanged', before, counts())

            print('\n— right month: Sep 2026 —')
            pick_month(pg, 9)
            check('month line names Sep 2026', True, 'Sep 2026' in pg.get_by_test_id('import-month-line').inner_text())
            check('no warning before first import', 0, pg.get_by_test_id('reimport-warning').count())
            body, card = upload(pg, [SEP])
            check('body month = 9', '9', field(body, 'month'))
            check('Sep import succeeded', True, '1/1 succeeded' in card.inner_text())
            after1 = counts()
            check('monthly_imports +1', before['monthly_imports'] + 1, after1['monthly_imports'])
            check('attendance_processed rows written (2 emp × 30 days)', 60, after1['attendance_processed'] - before['attendance_processed'])
            w = pg.get_by_test_id('reimport-warning'); w.wait_for(timeout=10000)
            wt = w.inner_text()
            check('re-import warning shows right after the import', True, 'This month is already imported' in wt)
            check('warning names the company', True, 'Asian Lakto Ind Ltd' in wt)
            check('warning says Stage 6 and 7 recompute + corrections replayed', True,
                  'Stage 6 and 7 will be recomputed and manual corrections replayed' in wt)

            print('\n— re-import Sep 2026 —')
            # same content, new name: a browser does not fire `change` when the very same file is set again
            SEP2 = build_file('EESL_TEST_SEP2026_again.xls', 2026, 9)
            body, card = upload(pg, [SEP2])
            check('re-import succeeded', True, '1/1 succeeded' in card.inner_text())
            after2 = counts()
            check('re-import: monthly_imports unchanged', after1['monthly_imports'], after2['monthly_imports'])
            check('re-import: attendance_processed no duplicates', after1['attendance_processed'], after2['attendance_processed'])

            print('\n— switch month —')
            pick_month(pg, 8)
            check('Aug 2026: no warning', 0, pg.get_by_test_id('reimport-warning').count())
            pick_month(pg, 9)
            check('back to Sep: warning again', 1, pg.get_by_test_id('reimport-warning').count())

            print('\n— two files, Sep selected (Aug + Sep) —')
            pg.locator('input[type=file]').first.set_input_files([AUG, SEP])
            note = pg.get_by_test_id('multi-file-note')
            check('multi-file note shown', 'Only files for Sep 2026 will import.', note.inner_text().strip() if note.count() else None)
            pre = counts()
            with pg.expect_response(lambda r: '/api/import/upload' in r.url, timeout=120000):
                pg.get_by_role('button', name=re.compile('Upload & Parse 2 file')).click()
            card = pg.locator('div.card', has=pg.get_by_role('heading', name='Import Results')); card.wait_for()
            time.sleep(.5)
            txt = card.inner_text()
            check('Sep in, Aug out: 1/2 succeeded', True, '1/2 succeeded' in txt)
            check('Aug refusal text', True, 'You selected 9/2026' in txt and '8/2026' in txt)
            check('Aug not imported (monthly_imports unchanged)', pre['monthly_imports'], counts()['monthly_imports'])
            c = sqlite3.connect(DB)
            check('no Aug 2026 rows', 0, c.execute("SELECT COUNT(*) FROM attendance_processed WHERE month=8 AND year=2026").fetchone()[0])
            c.close()

            print('\n— phone 390px —')
            ph, perrs, pcons, pbad = login(b, width=390)
            pick_month(ph, 9)
            check('390: warning visible', True, ph.get_by_test_id('reimport-warning').is_visible())
            check('390: month line visible', True, ph.get_by_test_id('import-month-line').is_visible())
            w390 = ph.get_by_test_id('reimport-warning').bounding_box()
            check('390: warning fits the viewport', True, w390['x'] >= 0 and w390['x'] + w390['width'] <= 390)

            print('\n— errors —')
            check('0 page errors', [], errs + perrs)
            check('0 console errors', [], cons + pcons)
            check('0 API ≥ 400', [], bad + pbad)
            b.close()
finally:
    srv.terminate()
    try: srv.wait(10)
    except Exception: srv.kill()

print(f'\n{PASS}/{PASS + FAIL} passed' + (f' — {FAIL} FAILED (server log: {WORK}/log)' if FAIL else ''))
sys.exit(1 if FAIL else 0)
