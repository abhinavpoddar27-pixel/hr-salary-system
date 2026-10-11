#!/usr/bin/env python3
"""P2-07 browser check: PeoplePicker + EmployeeSearchSelect aria (harness, fictional data).

  python3 backend/scripts/people-picker-check.py [--port 3207] [--base <EmployeeSearchSelect.jsx from origin/main>]

Builds backend/scripts/harness/people-picker.jsx with the frontend's esbuild into a
temp dir, serves it on --port, drives Chromium. --base swaps in an old
EmployeeSearchSelect and runs only the aria checks (they are expected to FAIL).
"""
import argparse, functools, http.server, os, subprocess, sys, tempfile, threading

os.environ.setdefault('PLAYWRIGHT_BROWSERS_PATH', '/opt/pw-browsers')
from playwright.sync_api import sync_playwright  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
ap = argparse.ArgumentParser()
ap.add_argument('--port', type=int, default=3207)
ap.add_argument('--base', default=None)
args = ap.parse_args()

out = tempfile.mkdtemp(prefix='p207-harness-')
cmd = ['node', os.path.join(HERE, 'harness', 'build-harness.mjs'), out] + ([args.base] if args.base else [])
subprocess.run(cmd, check=True)

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a, **k):
        pass
handler = functools.partial(Quiet, directory=out)
srv = http.server.ThreadingHTTPServer(('127.0.0.1', args.port), handler)
threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f'http://127.0.0.1:{args.port}/index.html'

results = []
def check(name, ok, detail=''):
    results.append((name, bool(ok)))
    print(('PASS ' if ok else 'FAIL ') + name + (f'  [{detail}]' if detail and not ok else ''))

errors = []
with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_page(viewport={'width': 1280, 'height': 900})
    page.on('pageerror', lambda e: errors.append('pageerror: ' + str(e)))
    page.on('console', lambda m: errors.append('console: ' + m.text) if m.type == 'error' else None)
    page.goto(URL)
    page.wait_for_selector('#ess-a')

    # ---------- EmployeeSearchSelect aria ----------
    def aria_state(sel):
        return page.evaluate("""(sel) => {
          const i = document.querySelector(sel)
          const c = i.getAttribute('aria-controls'), a = i.getAttribute('aria-activedescendant')
          const lb = c ? document.getElementById(c) : null
          const opt = a ? document.getElementById(a) : null
          return { c, a, lbRole: lb && lb.getAttribute('role'), optRole: opt && opt.getAttribute('role'),
                   optInList: !!(lb && opt && lb.contains(opt)), optText: opt ? opt.textContent : null,
                   expanded: i.getAttribute('aria-expanded') }
        }""", sel)

    st = aria_state('#ess-a')
    check('ESS closed: no activedescendant', st['a'] is None)
    page.click('#ess-a')
    st = aria_state('#ess-a')
    check('ESS open: aria-controls -> listbox', st['lbRole'] == 'listbox', str(st))
    check('ESS open: activedescendant -> option in listbox', st['optRole'] == 'option' and st['optInList'], str(st))
    first = st['optText']
    page.keyboard.press('ArrowDown'); page.keyboard.press('ArrowDown')
    st2 = aria_state('#ess-a')
    check('ESS ArrowDown moves activedescendant', st2['a'] and st2['a'] != st['a'] and st2['optInList'], str(st2))
    check('ESS highlighted row = 3rd option', page.evaluate(
        "(id) => [...document.getElementById(id).parentElement.children].indexOf(document.getElementById(id))", st2['a']) == 2 if st2['a'] else False)
    page.keyboard.press('ArrowUp')
    st3 = aria_state('#ess-a')
    check('ESS ArrowUp moves back', st3['optInList'] and st3['a'] != st2['a'])
    page.keyboard.press('ArrowDown'); page.keyboard.press('ArrowDown')
    page.fill('#ess-a', '90003')
    stT = aria_state('#ess-a')
    check('ESS typing after ArrowDown: active option = the match', bool(stT['optText']) and '90003' in stT['optText'], str(stT))
    page.fill('#ess-a', '')
    page.keyboard.type('zzzz')
    st4 = aria_state('#ess-a')
    check('ESS no match: no activedescendant', st4['a'] is None, str(st4))
    check('ESS no-match row is presentation', page.evaluate(
        "() => [...document.querySelectorAll('[role=listbox] > li')].every(li => li.getAttribute('role') === 'option' || li.getAttribute('role') === 'presentation')"))
    page.fill('#ess-a', '9000')
    page.keyboard.press('Enter')
    val_a = page.inner_text('#ess-values')
    check('ESS Enter still picks', val_a.split('|')[0].startswith('9000'), val_a)
    st5 = aria_state('#ess-a')
    check('ESS after pick: closed, no activedescendant', st5['a'] is None and st5['expanded'] == 'false', str(st5))
    page.click('#ess-a'); stA = aria_state('#ess-a'); page.keyboard.press('Escape')
    page.click('#ess-b'); stB = aria_state('#ess-b')
    check('ESS two instances have different ids', stA['c'] and stB['c'] and stA['c'] != stB['c'] and stA['a'] != stB['a'], f'{stA} {stB}')
    page.keyboard.press('Escape')
    ids = page.evaluate("() => { const a=[...document.querySelectorAll('[id]')].map(e=>e.id); return a.length - new Set(a).size }")
    check('no duplicate ids on the page', ids == 0, str(ids))

    if not args.base:
        # ---------- PeoplePicker ----------
        groups = page.eval_on_selector_all('[data-testid=pp-group]', 'els => els.map(e => e.dataset.dept)')
        check('groups largest first, No department last', groups == ['PRODUCTION', 'PACKING', 'STORES', 'QUALITY', 'No department'], str(groups))
        check('collapsed by default (no rows)', page.locator('[data-testid=pp-person]').count() == 0)
        check('Left hidden by default', page.locator('[data-testid=pp-left-badge]').count() == 0)

        # tick whole department
        page.locator('[data-dept=STORES] [data-testid=pp-group-check]').check()
        check('tick dept -> 4 selected', page.inner_text('[data-testid=pp-count]') == '4 selected')
        check('dept count shows 4 of 4', '4 of 4' in page.inner_text('[data-dept=STORES] [data-testid=pp-group-count]'))
        # expand + untick one -> indeterminate
        page.locator('[data-dept=STORES] [data-testid=pp-group-toggle]').click()
        page.locator('[data-dept=STORES] [data-code="01234"] input').uncheck()
        ind = page.eval_on_selector('[data-dept=STORES] [data-testid=pp-group-check]', 'e => e.indeterminate')
        check('partial dept -> indeterminate', ind)
        check('count 3 after untick', page.inner_text('[data-testid=pp-count]') == '3 selected')
        page.locator('[data-dept=STORES] [data-testid=pp-group-check]').click()
        check('click partial dept ticks all', page.inner_text('[data-testid=pp-count]') == '4 selected')
        page.locator('[data-dept=STORES] [data-testid=pp-group-check]').click()
        check('click full dept unticks all', page.inner_text('[data-testid=pp-count]') == '0 selected')

        # search name / code / dept
        page.fill('[data-testid=pp-search]', 'production')
        check('search by dept shows whole dept', page.locator('[data-testid=pp-person]').count() == 9)
        page.fill('[data-testid=pp-search]', 'ZERO lead')
        check('search by name, case-insensitive', page.locator('[data-testid=pp-person]').count() == 1)
        page.fill('[data-testid=pp-search]', '9000')
        n9000 = page.locator('[data-testid=pp-person]').count()
        check('search by partial code', n9000 == 9, str(n9000))
        # tick dept while searching -> only matches
        page.locator('[data-dept=PACKING] [data-testid=pp-group-check]').check()
        check('dept tick while searching = matches only', page.inner_text('[data-testid=pp-count]') == '6 selected',
              page.inner_text('[data-testid=pp-count]'))
        page.fill('[data-testid=pp-search]', 'nobody-here')
        check('empty search message', page.locator('[data-testid=pp-empty]').count() == 1)
        page.fill('[data-testid=pp-search]', '')

        # tray remove + clear
        page.click('[data-testid=pp-chip][data-code="90001"] button')
        check('tray remove', page.inner_text('[data-testid=pp-count]') == '5 selected')
        page.click('[data-testid=pp-clear]')
        check('tray clear all', page.inner_text('[data-testid=pp-count]') == '0 selected')

        # paste
        page.fill('[data-testid=pp-paste]', 'Code\n90010\n90011, 90010\n01234 S901 99999 90901 hello')
        page.click('[data-testid=pp-paste-add]')
        chips = page.eval_on_selector_all('[data-testid=pp-chip]', 'els => els.map(e => e.dataset.code)')
        check('paste adds found codes in order', chips == ['90010', '90011', '01234', 'S901'], str(chips))
        check('paste reports not found', '99999' in page.inner_text('[data-testid=pp-not-found]'))
        check('paste reports has-left (not added)', '90901' in page.inner_text('[data-testid=pp-has-left]'))
        res = page.inner_text('[data-testid=pp-paste-result]')
        check('paste result text', 'Added 4' in res and '1 repeated' in res and 'ignored 2 words' in res, res)
        check('paste box cleared after add', page.input_value('[data-testid=pp-paste]') == '')

        # include left
        page.check('[data-testid=pp-include-left]')
        page.fill('[data-testid=pp-search]', '9090')
        check('Left visible with badge', page.locator('[data-testid=pp-left-badge]').count() == 2)
        page.locator('[data-code="90901"] input').check()
        check('Left tick -> tray shows (left)', '(left)' in page.inner_text('[data-testid=pp-chip][data-code="90901"]'))
        page.fill('[data-testid=pp-search]', '')
        page.fill('[data-testid=pp-paste]', '90902')
        page.click('[data-testid=pp-paste-add]')
        check('paste Left with toggle on adds', page.locator('[data-testid=pp-chip][data-code="90902"]').count() == 1)
        check('onChange value matches tray', page.evaluate('() => window.__selected.length') == page.locator('[data-testid=pp-chip]').count())

        # phone
        page.set_viewport_size({'width': 390, 'height': 844})
        sw = page.evaluate('() => document.documentElement.scrollWidth')
        check('390px no sideways scroll', sw <= 390, str(sw))

    check('0 page/console errors', not errors, '; '.join(errors[:3]))
    b.close()
srv.shutdown()

ok = sum(1 for _, r in results if r)
print(f'\n{ok}/{len(results)} passed' + (' (BASE)' if args.base else ''))
sys.exit(0 if ok == len(results) else 1)
