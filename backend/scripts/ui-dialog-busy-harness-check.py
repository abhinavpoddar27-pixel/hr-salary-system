#!/usr/bin/env python3
"""P2-01 — harness check for the parts no app page uses yet: Modal / ConfirmDialog `busy`, ConfirmDialog first
focus per variant, and the useConfirm queue (two dialogs in a row; a double click answers once).

Builds frontend/test-harness (its own vite config, not the app) into a scratch dir, serves it on PORT (3201),
drives it in Chromium.  PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers python3 backend/scripts/ui-dialog-busy-harness-check.py
"""
import functools, http.server, os, subprocess, sys, tempfile, threading, time
from playwright.sync_api import sync_playwright

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
PORT = int(os.environ.get('PORT', '3201'))
OUT = tempfile.mkdtemp(prefix='p2-01-harness-')
PASS = FAIL = 0


def check(label, expected, actual):
    global PASS, FAIL
    if expected == actual: PASS += 1; print(f'  ✓ {label}')
    else: FAIL += 1; print(f'  ✗ {label} — expected {expected!r}, got {actual!r}')


subprocess.run(['flock', '/tmp/vite.lock', 'npx', 'vite', 'build', '--config', 'test-harness/vite.config.js',
                '--outDir', OUT, '--emptyOutDir'], cwd=os.path.join(ROOT, 'frontend'), check=True)
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass


handler = functools.partial(Quiet, directory=OUT)
srv = http.server.ThreadingHTTPServer(('127.0.0.1', PORT), handler)
threading.Thread(target=srv.serve_forever, daemon=True).start()

try:
    with sync_playwright() as pw:
        b = pw.chromium.launch(); pg = b.new_page(viewport={'width': 1000, 'height': 800})
        errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.goto(f'http://127.0.0.1:{PORT}/'); pg.wait_for_function('() => !!window.__show')
        logs = lambda: pg.evaluate('() => window.__log.slice()')
        dlg = lambda t: pg.locator('[role="dialog"]', has=pg.locator('h3', has_text=t))
        active = lambda: pg.evaluate('() => (document.activeElement.innerText || document.activeElement.getAttribute("aria-label") || document.activeElement.tagName).trim()')

        print('— Modal busy —')
        pg.evaluate('() => { window.__setBusy(true); window.__show("modal") }'); dlg('Busy modal').wait_for(); time.sleep(.3)
        pg.keyboard.press('Escape'); time.sleep(.3)
        check('busy: Esc does not close', [], logs())
        pg.mouse.click(990, 790); time.sleep(.3)
        check('busy: outside click does not close', [], logs())
        check('busy: ✕ disabled', True, dlg('Busy modal').get_by_role('button', name='Close').is_disabled())
        check('busy: still open', 1, dlg('Busy modal').count())
        pg.evaluate('() => window.__setBusy(false)'); time.sleep(.2)
        check('not busy: ✕ enabled', False, dlg('Busy modal').get_by_role('button', name='Close').is_disabled())
        pg.keyboard.press('Escape'); dlg('Busy modal').wait_for(state='detached')
        check('not busy: Esc closes', ['modal-close'], logs())

        print('— ConfirmDialog busy + focus —')
        pg.evaluate('() => { window.__log.length = 0; window.__variant("danger"); window.__setBusy(true); window.__show("confirm") }')
        d = dlg('Busy confirm'); d.wait_for(); time.sleep(.3)
        check('busy: both buttons disabled', [True, True],
              [d.get_by_role('button', name='Cancel').is_disabled(), d.get_by_role('button', name='Confirm').is_disabled()])
        pg.keyboard.press('Escape'); pg.mouse.click(990, 790); time.sleep(.3)
        d.get_by_role('button', name='Confirm').click(force=True); time.sleep(.3)
        check('busy: Esc / outside / forced Confirm do nothing', [], logs())
        pg.evaluate('() => window.__setBusy(false)'); time.sleep(.2)
        pg.keyboard.press('Escape'); d.wait_for(state='detached')
        check('not busy: Esc = onCancel', ['cancel'], logs())
        pg.evaluate('() => { window.__log.length = 0; window.__show("confirm") }'); d.wait_for(); time.sleep(.3)
        check('danger: first focus on Cancel', 'Cancel', active())
        d.get_by_role('button', name='Confirm').click(); d.wait_for(state='detached')
        check('Confirm = onConfirm', ['confirm'], logs())
        pg.evaluate('() => { window.__variant("warning"); window.__show("confirm") }'); d.wait_for(); time.sleep(.3)
        check('warning: first focus on Confirm', 'Confirm', active())
        pg.mouse.click(990, 790); d.wait_for(state='detached')
        check('outside click = onCancel', ['confirm', 'cancel'], logs())

        print('— useConfirm queue —')
        pg.evaluate('() => { window.__log.length = 0; window.__confirm({ title: "First?", message: "one" }); window.__confirm({ title: "Second?", message: "two", variant: "warning" }) }')
        dlg('First?').wait_for(); time.sleep(.3)
        check('queue: only the first shows', [1, 0], [dlg('First?').count(), dlg('Second?').count()])
        dlg('First?').get_by_role('button', name='Confirm').dblclick()
        dlg('Second?').wait_for(timeout=5000); time.sleep(.3)
        check('double click answers once; second dialog still comes', ['answer:First?:true'], logs())
        check('second (warning) focus on Confirm', 'Confirm', active())
        pg.keyboard.press('Escape'); dlg('Second?').wait_for(state='detached'); time.sleep(.2)
        check('Esc on second → false', ['answer:First?:true', 'answer:Second?:false'], logs())
        check('one host root in the page', 1, pg.locator('#hr-dialog-root').count())
        check('0 page errors', [], errs)
        b.close()
finally:
    srv.shutdown()
print(f'\n{PASS} passed, {FAIL} failed')
sys.exit(1 if FAIL else 0)
