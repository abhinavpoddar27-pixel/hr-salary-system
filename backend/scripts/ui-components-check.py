#!/usr/bin/env python3
"""Shared UI components check (P2-ED: Button, IconButton, StatusBadge, ScrollTable, ReviewQueue).

Part A — component harness (frontend/ui-harness, a test-only Vite build into a scratch dir,
never part of the app bundle): every Button variant + busy, IconButton label rule, every
StatusBadge in utils/statusMap.js, ScrollTable sticky header + keyboard sort + keyboard
chevron expand, ReviewQueue chips/order/selection rules/bar total/confirm/reason modal/Esc.
Part B — the real Extra Duty page (built frontend/dist, scratch DB, real finance login):
the list header stays in view after scrolling its window, pills keep their old text,
390 px has no page-level sideways scroll.

Fictional data only. Scratch dirs, torn down at exit. Needs `npm run build` first.
Usage: PORT=3204 python3 backend/scripts/ui-components-check.py [--base /path/to/origin-main-worktree]
  --base runs Part B only, against that worktree's server + dist (expected: sticky header FAILS).
"""
import http.server, os, shutil, socketserver, sqlite3, subprocess, sys, tempfile, threading, time, urllib.request
from playwright.sync_api import sync_playwright

HERE_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
BASE_MODE = '--base' in sys.argv
ROOT = os.path.abspath(sys.argv[sys.argv.index('--base') + 1]) if BASE_MODE else HERE_ROOT
PORT = int(os.environ.get('PORT', '3204')); BASE = f'http://127.0.0.1:{PORT}'
HPORT = PORT + 500
WORK = tempfile.mkdtemp(prefix='ui-comp-'); DB = os.path.join(WORK, 'hr_system.db')
C = 'Asian Lakto Ind Ltd'
PASS = FAIL = 0


def check(label, ok, detail=''):
    global PASS, FAIL
    if ok: PASS += 1; print(f'  ✓ {label}')
    else: FAIL += 1; print(f'  ✗ {label}' + (f' — {detail}' if detail else ''))


def part_a(p):
    out = os.path.join(WORK, 'harness')
    r = subprocess.run(['npx', 'vite', 'build', '--config', 'ui-harness/vite.config.mjs', '--outDir', out],
                       cwd=os.path.join(ROOT, 'frontend'), capture_output=True, text=True)
    check('harness builds', r.returncode == 0, r.stderr[-400:])
    if r.returncode != 0: return

    class Q(http.server.SimpleHTTPRequestHandler):
        def __init__(s, *a, **k): super().__init__(*a, directory=out, **k)
        def log_message(s, *a): pass
    socketserver.TCPServer.allow_reuse_address = True
    httpd = socketserver.TCPServer(('127.0.0.1', HPORT), Q); threading.Thread(target=httpd.serve_forever, daemon=True).start()
    try:
        b = p.chromium.launch(); pg = b.new_context(viewport={'width': 1280, 'height': 900}).new_page()
        errs, cons = [], []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.on('console', lambda m: cons.append(m.text) if m.type == 'error' else None)
        pg.goto(f'http://127.0.0.1:{HPORT}/index.html'); pg.wait_for_selector('[data-section=queue]')

        print('Button / IconButton')
        for v in ['primary', 'secondary', 'ghost', 'danger', 'success', 'warning', 'primary-sm']:
            bt = pg.locator(f'[data-variant={v}]')
            check(f'{v}: type=button, enabled', bt.get_attribute('type') == 'button' and bt.is_enabled())
        bg = pg.locator('[data-variant=warning]').evaluate('e => getComputedStyle(e).backgroundColor')
        check('warning variant is styled (amber, not transparent)', bg not in ('rgba(0, 0, 0, 0)', 'transparent'), bg)
        busy = pg.locator('[data-variant=busy]')
        check('busy: disabled + aria-busy + busy label', busy.is_disabled() and busy.get_attribute('aria-busy') == 'true' and busy.inner_text() == 'Saving...')
        pg.locator('[data-testid=toggle-busy]').click()
        check('not busy: enabled, own label, no aria-busy', busy.is_enabled() and busy.inner_text() == 'Save now' and busy.get_attribute('aria-busy') is None)
        busy.focus(); pg.keyboard.press('Enter')
        check('keyboard Enter clicks a Button', pg.evaluate('window.__calls.includes("busy-click")'))
        lab = pg.locator('[data-icon=labelled]')
        check('IconButton label → aria-label + title', lab.get_attribute('aria-label') == 'Close panel' and lab.get_attribute('title') == 'Close panel')
        check('IconButton role name = label', pg.get_by_role('button', name='Close panel').count() == 1)
        un = pg.locator('[data-icon=unlabelled]')
        check('IconButton without label → "?" + console error', un.get_attribute('aria-label') == '?' and any('IconButton' in c for c in cons))

        print('StatusBadge')
        n = pg.locator('[data-section=badges] span[data-status]').count()
        expected = pg.evaluate('''() => document.querySelectorAll('[data-section=badges] span').length''')
        check(f'every statusMap entry renders ({n})', n == expected and n >= 45, f'{n} vs {expected}')
        empty = pg.locator('[data-section=badges] span[data-status]').evaluate_all('es => es.filter(e => !e.textContent.trim()).length')
        check('no blank badge', empty == 0)
        check('ED finance UNREVIEWED keeps raw label + gray', pg.locator('[data-section=badges] span[data-status=UNREVIEWED]').inner_text() == 'UNREVIEWED')
        check('unknown status → raw text', pg.locator('[data-section=badges] span[data-status=SOMETHING_NEW]').inner_text() == 'SOMETHING_NEW')
        check('null status → —', pg.locator('[data-section=badges] span[data-status=""]').inner_text() == '—')
        check('loan "recover_at_exit" label', pg.locator('[data-section=badges] span[data-status=recover_at_exit]').inner_text() == 'Recover at exit')

        print('ScrollTable')
        box = pg.locator('[data-scroll-table=people]')
        box.evaluate('e => e.scrollTop = 600'); time.sleep(.2)
        top_c = box.evaluate('e => e.getBoundingClientRect().top')
        top_h = box.locator('thead th').first.evaluate('e => e.getBoundingClientRect().top')
        check('header stays at the top of its window after scrolling', abs(top_h - top_c) <= 2, f'{top_h} vs {top_c}')
        th_bg = box.locator('thead th').first.evaluate('e => getComputedStyle(e).backgroundColor')
        check('header background opaque', th_bg.startswith('rgb(') , th_bg)
        box.evaluate('e => e.scrollTop = 0')
        sb = box.locator('button[data-sort-key=name]')
        th = box.locator('th:has(button[data-sort-key=name])')
        check('sortable header is a button, aria-sort none', th.get_attribute('aria-sort') == 'none')
        sb.focus(); pg.keyboard.press('Enter'); time.sleep(.1)
        names = box.locator('tbody tr').evaluate_all('rs => rs.map(r => r.children[2].textContent)')
        js_sorted = pg.evaluate("ns => [...ns].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))", names)
        check('Enter sorts ascending', th.get_attribute('aria-sort') == 'ascending' and names == js_sorted, names[:3])
        pg.keyboard.press(' '); time.sleep(.1)
        names2 = box.locator('tbody tr').evaluate_all('rs => rs.map(r => r.children[2].textContent)')
        check('Space reverses (descending)', th.get_attribute('aria-sort') == 'descending' and names2 == list(reversed(names)))
        ab = box.locator('button[data-sort-key=amount]'); ab.focus(); pg.keyboard.press('Enter'); time.sleep(.1)
        last_amt = box.locator('tbody tr').last.evaluate('r => r.children[3].textContent')
        check('empty value sorts last', last_amt == '')
        rows_before = box.locator('tbody tr').count()
        chev = box.locator('tbody button[aria-expanded]').first
        code = chev.get_attribute('data-expand-key')
        check('chevron is a labelled button', chev.get_attribute('aria-label', ).startswith('Show details for'))
        chev.focus(); pg.keyboard.press('Enter'); time.sleep(.1)
        check('Enter expands: aria-expanded true + detail row', chev.get_attribute('aria-expanded') == 'true' and box.locator('tbody tr').count() == rows_before + 1
              and box.locator(f'#{chev.get_attribute("aria-controls")}').is_visible())
        pg.keyboard.press(' '); time.sleep(.1)
        check('Space collapses', chev.get_attribute('aria-expanded') == 'false' and box.locator('tbody tr').count() == rows_before)
        check('table without expand has 1 tr per row (ReviewQueue)', pg.locator('[data-scroll-table=review-queue] tbody tr').count() == 13)

        print('ReviewQueue')
        q = pg.locator('[data-section=queue]')
        chip = lambda i: q.locator(f'[data-filter={i}]')
        check('chip counts', [chip(i).inner_text() for i in ['all', 'pending', 'rejected', 'approved']] == ['All (13)', 'Pending (5)', 'Rejected (3)', 'Approved (4)'])
        order = q.locator('tbody tr').evaluate_all('rs => rs.map(r => r.dataset.st)')
        check('client order pending → rejected → approved → unknown', order == ['pending'] * 5 + ['rejected'] * 3 + ['approved'] * 4 + ['weird'], order)
        check('rejected rows tinted', 'bg-red-50/60' in (q.locator('tbody tr[data-st=rejected]').first.get_attribute('class') or ''))
        sa = q.locator('[data-testid=select-all]')
        sa.check(); time.sleep(.1)
        check('All: header ticks approve-eligible only (5)', q.locator('tbody input[type=checkbox]:checked').count() == 5)
        bar = pg.locator('[data-testid=bulk-bar]')
        check('bar: 5 selected, total ₹1,252.50, Approve (5), no Return', bar.is_visible() and '5 selected' in bar.inner_text()
              and '1,252.50' in pg.locator('[data-testid=bulk-total]').inner_text()
              and bar.get_by_role('button', name='Approve (5)').count() == 1 and bar.get_by_role('button', name='Return (', exact=False).count() == 0)
        check('ineligible rows: box disabled', q.locator('tbody tr[data-st=approved] input').first.is_disabled())
        chip('rejected').focus(); pg.keyboard.press('Enter'); time.sleep(.1)
        check('keyboard on chip filters + clears selection', chip('rejected').get_attribute('aria-pressed') == 'true'
              and q.locator('tbody tr').count() == 3 and bar.count() == 0)
        sa.check(); time.sleep(.1)
        check('Rejected: header ticks the 3', q.locator('tbody input[type=checkbox]:checked').count() == 3)
        bar.get_by_role('button', name='Return (3)').click()
        send = pg.get_by_role('button', name='Send back')
        pg.get_by_placeholder('Why?').fill(' abc ')
        check('reason under 5 chars (trimmed) → disabled', send.is_disabled())
        pg.keyboard.press('Escape'); time.sleep(.1)
        check('Esc closes the reason window, selection kept', pg.get_by_placeholder('Why?').count() == 0 and bar.is_visible())
        bar.get_by_role('button', name='Return (3)').click()
        check('reopened window starts empty', pg.get_by_placeholder('Why?').input_value() == '')
        pg.get_by_placeholder('Why?').fill('  wrong days  '); send.click(); time.sleep(.2)
        calls = pg.evaluate('window.__calls')
        check('return run with ids + trimmed reason; window closes; selection cleared',
              calls[-1] == ['return', [200, 201, 202], 'wrong days'] and pg.get_by_placeholder('Why?').count() == 0 and bar.count() == 0, calls[-1])
        q.locator('tbody tr[data-st=rejected]').first.get_by_role('button', name='Return one').click()
        check('single-row action opens same window titled "Return 1"', pg.get_by_role('heading', name='Return 1').count() == 1)
        pg.get_by_placeholder('Why?').fill('single row'); send.click(); time.sleep(.2)
        check('single-row run', pg.evaluate('window.__calls')[-1] == ['return', [200], 'single row'])
        chip('all').click(); sa.check(); bar.get_by_role('button', name='Approve (5)').click()
        check('confirmText dialog with n + total', pg.get_by_text('Approve 5 rows worth 1252.50?').count() == 1)
        pg.get_by_role('button', name='Cancel').click(); time.sleep(.1)
        check('Cancel: nothing run, selection kept', pg.evaluate('window.__calls')[-1][0] == 'return' and bar.is_visible())
        bar.get_by_role('button', name='Approve (5)').click(); pg.get_by_role('button', name='Yes, approve').click(); time.sleep(.2)
        check('Confirm: approve run, selection cleared', pg.evaluate('window.__calls')[-1] == ['approve', [300, 301, 302, 303, 304]] and bar.count() == 0)
        chip('approved').click()
        check('nothing selectable → header box disabled', sa.is_disabled())
        chip('pending').click(); sa.check(); time.sleep(.1)
        bar.get_by_role('button', name='Clear').click(); time.sleep(.1)
        check('Clear empties the selection + hides the bar', bar.count() == 0 and q.locator('tbody input[type=checkbox]:checked').count() == 0)

        print('Phone 390 px')
        pg.set_viewport_size({'width': 390, 'height': 800}); time.sleep(.2)
        sw = pg.evaluate('document.scrollingElement.scrollWidth')
        check('harness: sections fit (no page sideways scroll)', sw <= 392, sw)
        check('0 page errors (harness)', not errs, errs[:2])
        other = [c for c in cons if 'IconButton' not in c]
        check('only the expected IconButton console error', not other, other[:2])
        b.close()
    finally:
        httpd.shutdown(); httpd.server_close()


def part_b(p):
    env = dict(os.environ, DATA_DIR=WORK, JWT_SECRET='x', PORT=str(PORT), NODE_ENV='production',
               ADMIN_PASSWORD='Admin@123', HR_PASSWORD='Indriyan@2025', FINANCE_PASSWORD='Finance@2025')
    srv = subprocess.Popen(['node', f'{ROOT}/backend/server.js'], env=env, stdout=open(f'{WORK}/log', 'w'), stderr=subprocess.STDOUT)
    try:
        for _ in range(80):
            try: urllib.request.urlopen(BASE + '/api/version', timeout=2); break
            except Exception: time.sleep(.5)
        c = sqlite3.connect(DB)
        for i in range(80):
            code = f'{90000 + i}'
            fs = 'FINANCE_REJECTED' if i < 6 else 'UNREVIEWED'
            c.execute("INSERT OR IGNORE INTO employees(code,name,department,company,status,employment_type) VALUES(?,?,'TEST DEPT',?,'Active','Permanent')", (code, f'TEST {code}', C))
            c.execute("""INSERT INTO extra_duty_grants(employee_code,grant_date,month,year,company,grant_type,duty_days,verification_source,
                         status,finance_status,requested_by) VALUES(?,?,9,2026,?,'OVERNIGHT_STAY',1,'Gate Register','APPROVED',?,'hr1')""",
                      (code, f'2026-09-{(i % 28) + 1:02d}', C, fs))
        c.commit(); c.close()
        b = p.chromium.launch(); pg = b.new_context(viewport={'width': 1440, 'height': 900}).new_page()
        errs, bad = [], []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.on('response', lambda r: bad.append(f'{r.status} {r.url}') if '/api/' in r.url and r.status >= 400 else None)
        pg.goto(BASE + '/login'); pg.get_by_placeholder('admin').fill('finance'); pg.get_by_placeholder('••••••••').fill('Finance@2025')
        pg.get_by_role('button', name='Sign in').click(); pg.wait_for_url(lambda u: '/login' not in u)
        pg.goto(BASE + '/extra-duty-grants'); pg.wait_for_load_state('networkidle')
        for k in range(pg.locator('select').count()):
            s = pg.locator('select').nth(k)
            if 'September' in ' '.join(s.locator('option').all_inner_texts()): s.select_option(label='September')
        pg.wait_for_load_state('networkidle'); time.sleep(1)
        print('ED page')
        check('80 rows listed', pg.locator('tbody tr').count() == 80)
        # Scroll whatever scrolls (the table window on the branch; the page on main), then
        # check the column header is still on screen.
        pg.locator('tbody tr').nth(70).scroll_into_view_if_needed(); time.sleep(.3)
        th = pg.locator('thead th', has_text='Grant Date')
        vis_top = th.evaluate('e => e.getBoundingClientRect().top')
        row_top = pg.locator('tbody tr').nth(70).evaluate('e => e.getBoundingClientRect().top')
        check('header still visible after scrolling to row 70', 0 <= vis_top < row_top, f'th top {vis_top}, row top {row_top}')
        if not BASE_MODE:
            check('finance pill text unchanged (UNREVIEWED)', pg.locator('tbody tr').first.get_by_text('UNREVIEWED', exact=True).count() == 1)
            check('HR pill text unchanged (APPROVED)', pg.locator('tbody tr').first.get_by_text('APPROVED', exact=True).count() == 1)
            pg.locator('[data-testid=select-all]').focus(); pg.keyboard.press(' '); time.sleep(.2)
            check('keyboard Space on header box selects (bar shows)', pg.locator('[data-testid=bulk-bar]').is_visible())
            pg.locator('[data-testid=bulk-bar]').get_by_role('button', name='Clear').click()
            pg.get_by_role('button', name='All Grants').click(); pg.wait_for_load_state('networkidle'); time.sleep(.5)
            check('All Grants tab: no chips, no select boxes', pg.locator('[data-testid=fin-filters]').count() == 0
                  and pg.locator('tbody input[type=checkbox]').count() == 0)
            pg.locator('tbody tr[data-fin=FINANCE_REJECTED]').first.get_by_role('button', name='↩ Return to HR').click()
            check('All Grants tab: row Return opens the reason window', pg.get_by_role('heading', name='Return Grant to HR').count() == 1)
            pg.keyboard.press('Escape'); time.sleep(.2)
            check('Esc closes it, nothing sent', pg.get_by_role('heading', name='Return Grant to HR').count() == 0 and not bad)
        pg.set_viewport_size({'width': 390, 'height': 800}); time.sleep(.3)
        sw = pg.evaluate('document.scrollingElement.scrollWidth')
        check('390 px: page itself does not scroll sideways', sw <= 392, sw)
        check('0 page errors', not errs, errs[:2]); check('0 API ≥ 400', not bad, bad[:3])
        b.close()
    finally:
        srv.terminate(); srv.wait()


try:
    with sync_playwright() as p:
        if not BASE_MODE: print('Part A — harness'); part_a(p)
        print('Part B — Extra Duty page' + (' (BASE)' if BASE_MODE else '')); part_b(p)
finally:
    shutil.rmtree(WORK, ignore_errors=True)
print(f'\n{PASS} passed, {FAIL} failed')
sys.exit(1 if FAIL else 0)
