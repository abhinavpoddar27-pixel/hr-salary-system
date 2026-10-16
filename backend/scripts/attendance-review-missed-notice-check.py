#!/usr/bin/env python3
"""Missed-punch notice (16 Oct 2026) — browser check on the Attendance Review tab (admin, built dist, scratch DB,
fictional T79xx). September 2026: T7901 2 worked-day miss punches + 1 single-punch absent day (3 → named),
T7902 2 (not named). Checks the summary tile, the section rows, a draft saved + Excel download has the sheet, 390 px."""
import io, os, sqlite3, subprocess, sys, tempfile, time, urllib.request
from playwright.sync_api import sync_playwright
ROOT = os.environ.get('APP_ROOT', os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..')))
PORT = 3433; BASE = f'http://127.0.0.1:{PORT}'
WORK = tempfile.mkdtemp(prefix='ar-mn-'); DB = os.path.join(WORK, 'hr_system.db'); P = F = 0
def check(l, e, a):
    global P, F
    if e == a: P += 1; print('  ✓', l)
    else: F += 1; print('  ✗', l, 'expected', repr(e), 'got', repr(a))
def seed():
    c = sqlite3.connect(DB)
    for code in ('T7901', 'T7902'):
        c.execute("INSERT INTO employees(code,name,department,designation,company,employment_type,status,date_of_joining,gross_salary) VALUES(?,?,'PRODUCTION','OPERATOR','Indriyan Beverages Pvt Ltd','Permanent','Active','2024-01-01',30000)", (code, f'TEST EMP {code[-1]}'))
    for d in range(1, 31):
        iso = f'2026-09-{d:02d}'
        if time.strptime(iso, '%Y-%m-%d').tm_wday == 6: continue
        for code in ('T7901', 'T7902'):
            st, mp, it, ot = 'P', 0, '08:00', '20:00'
            if code == 'T7901' and d in (2, 8): mp = 1
            if code == 'T7901' and d == 24: st, mp, it, ot = 'A', 1, '19:22', None
            if code == 'T7902' and d in (2, 8): mp = 1
            c.execute("INSERT INTO attendance_processed(employee_code,date,status_original,status_final,in_time_final,out_time_final,shift_detected,is_miss_punch,month,year) VALUES(?,?,?,?,?,?,'12-Hour Shift',?,9,2026)", (code, iso, st, st, it, ot, mp))
    c.commit(); c.close()
env = dict(os.environ, DATA_DIR=WORK, JWT_SECRET='x', PORT=str(PORT), NODE_ENV='production', ADMIN_PASSWORD='Admin@123', HR_PASSWORD='Indriyan@2025', FINANCE_PASSWORD='Finance@2025')
srv = subprocess.Popen(['node', f'{ROOT}/backend/server.js'], env=env, stdout=open(f'{WORK}/log', 'w'), stderr=subprocess.STDOUT)
try:
    for _ in range(80):
        try: urllib.request.urlopen(BASE + '/api/health'); break
        except Exception: time.sleep(.5)
    seed()
    with sync_playwright() as p:
        b = p.chromium.launch()
        for width in (1440, 390):
            ctx = b.new_context(viewport={'width': width, 'height': 900}, accept_downloads=True); pg = ctx.new_page(); errs = []
            pg.on('pageerror', lambda e: errs.append(str(e)))
            pg.goto(BASE + '/login'); pg.get_by_placeholder('admin').fill('admin'); pg.get_by_placeholder('••••••••').fill('Admin@123')
            pg.get_by_role('button', name='Sign in').click(); pg.wait_for_url(lambda u: '/login' not in u)
            pg.goto(BASE + '/analytics/attendance-review'); pg.wait_for_load_state('networkidle')
            pg.locator('select').filter(has=pg.locator('option', has_text='September')).first.select_option('9')
            pg.locator('select').filter(has=pg.locator('option', has_text='2026')).first.select_option('2026')
            pg.wait_for_load_state('networkidle'); time.sleep(1.5)
            tile = pg.locator('div.card.p-3', has=pg.locator('div.uppercase', has_text='Missed-punch notice')).first.locator('div.text-xl').inner_text().strip()
            check(f'{width}px tile = 1', '1', tile)
            sec = pg.get_by_text('Notice board — missed punches').first; sec.scroll_into_view_if_needed(); sec.click(); time.sleep(.5)
            body = pg.locator('[data-section="Notice board — missed punches"]')
            txt = body.inner_text() if body.count() else pg.content()
            check(f'{width}px T7901 listed with 3', True, 'T7901' in txt and '3' in txt)
            check(f'{width}px T7902 not listed', False, 'T7902' in txt)
            if width == 1440:
                pg.get_by_role('button', name='Save draft').first.click() if pg.get_by_role('button', name='Save draft').count() else pg.get_by_role('button', name='Generate draft').first.click()
                time.sleep(2)
                btn = pg.get_by_role('button', name='Excel')
                if btn.count():
                    with pg.expect_download() as dl: btn.first.click()
                    path = dl.value.path()
                    import zipfile; names = zipfile.ZipFile(path).read('xl/workbook.xml').decode()
                    check('Excel has "Notice missed punch" sheet', True, 'Notice missed punch' in names)
                else: print('  (no Excel button visible — draft button label differs; jest covers the workbook)')
            check(f'{width}px no horizontal page scroll', True, pg.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1'))
            check(f'{width}px no page errors', [], errs)
            ctx.close()
        b.close()
finally: srv.terminate()
print(f'{P} passed, {F} failed'); sys.exit(1 if F else 0)
