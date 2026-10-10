#!/usr/bin/env python3
"""
Wide-layout behaviour checks for the Stage 7 register + user simulation. SCRATCH DATABASE ONLY.

  python3 backend/scripts/wide-layout-check.py <repo_root_to_serve>

Reuses wide-layout-render.py (boot on a temp DATA_DIR, the same fictional September 2026
seed with the real Stage 6 + 7). Needs frontend/dist built. Exit 0 only if every check passes.
"""
import importlib.util
import os
import re
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('render', os.path.join(HERE, 'wide-layout-render.py'))
R = importlib.util.module_from_spec(spec)
spec.loader.exec_module(R)
from playwright.sync_api import sync_playwright  # noqa: E402

RESULTS = []


def check(name, ok, detail=''):
    RESULTS.append((name, bool(ok)))
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f"  — {detail}" if detail and not ok else ''))


def money(t):
    t = re.sub(r'[^0-9.\-]', '', t or '')
    return float(t) if t not in ('', '-', '.') else None


STRUCT_JS = r"""() => {
  const t = document.querySelector('[data-testid="salary-register"] table');
  const th = t.querySelectorAll('thead th').length;
  const rows = [...t.querySelectorAll('tbody > tr:not(.drill-down-row)')];
  const tdCounts = [...new Set(rows.map(r => r.children.length))];
  const tf = t.querySelectorAll('tfoot td').length;
  const dd = t.querySelector('tbody > tr.drill-down-row > td');
  return { th, tdCounts, tf, colSpan: dd ? dd.colSpan : null, rows: rows.length };
}"""

PIN_JS = r"""() => {
  const t = document.querySelector('[data-testid="salary-register"] table');
  const pins = [...t.querySelectorAll('thead th.pin')].map(e => { const r = e.getBoundingClientRect(); return { l: r.left, r: r.right }; })
    .sort((a, b) => a.l - b.l);
  const bad = [];
  for (let i = 1; i < pins.length; i++) if (pins[i].l < pins[i - 1].r - 0.5) bad.push([pins[i - 1], pins[i]]);
  const pos = getComputedStyle(t.querySelector('thead th.pin')).position;
  return { n: pins.length, bad, pos };
}"""

COL_TOTAL_JS = r"""(label) => {
  const t = document.querySelector('[data-testid="salary-register"] table');
  const ths = [...t.querySelectorAll('thead th')];
  const i = ths.findIndex(h => h.textContent.trim().replace(/[ ▲▼]+$/, '') === label);
  if (i < 0) return null;
  return t.querySelectorAll('tfoot td')[i].textContent;
}"""

CARD_JS = r"""(label) => {
  const c = [...document.querySelectorAll('[data-testid="stage7-cards"] .stat-card')].find(e => e.textContent.toUpperCase().includes(label.toUpperCase()));
  return c ? c.children[1].textContent : null;
}"""

COL_VALUES_JS = r"""(label) => {
  const t = document.querySelector('[data-testid="salary-register"] table');
  const ths = [...t.querySelectorAll('thead th')];
  const i = ths.findIndex(h => h.textContent.trim().replace(/[ ▲▼]+$/, '') === label);
  return [...t.querySelectorAll('tbody > tr:not(.drill-down-row)')].map(r => r.children[i].textContent);
}"""


def view(page, key):
    page.get_by_test_id(f'register-view-{key}').click()
    page.wait_for_timeout(250)


def pressed(page):
    for k in ('review', 'statutory', 'all'):
        if page.get_by_test_id(f'register-view-{k}').get_attribute('aria-pressed') == 'true':
            return k
    return None


def new_page(browser, state, w, h, errors, clear_view=True):
    ctx = browser.new_context(viewport={'width': w, 'height': h}, storage_state=state, timezone_id='Asia/Kolkata')
    init = f"""try {{ localStorage.setItem('hr-system-store', JSON.stringify({{ state: {{ selectedMonth: 9, selectedYear: 2026,
        sidebarCollapsed: {'true' if w < 768 else 'false'}, selectedCompany: '', dateRangeMode: 'month', dateRangeStart: '', dateRangeEnd: '' }}, version: 0 }}));"""
    if clear_view:
        init += " if (!sessionStorage.getItem('wl-init')) { localStorage.removeItem('salreg.view.v1'); sessionStorage.setItem('wl-init', '1'); }"
    init += " } catch (e) {}"
    ctx.add_init_script(init)
    page = ctx.new_page()
    page.on('pageerror', lambda e: errors.append(f'{w}: {e}'))
    return ctx, page


def open_stage7(page, base):
    page.goto(base + '/pipeline/salary')
    page.locator('[data-testid="salary-register"] tbody tr').first.wait_for(timeout=30000)
    page.wait_for_timeout(800)


def main():
    if len(sys.argv) < 2:
        raise SystemExit('usage: wide-layout-check.py <repo_root_to_serve>')
    repo = os.path.abspath(sys.argv[1])
    port = R.free_port()
    base = f'http://127.0.0.1:{port}'
    work = tempfile.mkdtemp(prefix='wide-check-')
    R.SERVER['work'] = work
    errors = []
    try:
        R.boot(repo, port, work)
        seeded = R.seed(repo, work)
        held_n = seeded['register']['held']
        with sync_playwright() as p:
            browser = p.chromium.launch()
            ctx = browser.new_context(viewport={'width': 1440, 'height': 900})
            pg = ctx.new_page()
            pg.goto(f'{base}/login')
            pg.get_by_placeholder('admin').fill(R.ADMIN_USER)
            pg.get_by_placeholder('••••••••').fill(R.ADMIN_PASS)
            pg.get_by_role('button', name='Sign in').click()
            pg.wait_for_url(lambda u: '/login' not in u, timeout=20000)
            state = ctx.storage_state()
            ctx.close()

            # ── desktop 1440 ──
            ctx, page = new_page(browser, state, 1440, 900, errors)
            open_stage7(page, base)
            check('1440: default view is Everything', pressed(page) == 'all', pressed(page))
            expect = {'review': 11, 'statutory': 14, 'all': 25}
            for k, n in expect.items():
                view(page, k)
                page.locator('[data-testid="salary-register"] tbody > tr:not(.drill-down-row)').first.locator('td').nth(1).click()
                page.wait_for_timeout(300)
                st = page.evaluate(STRUCT_JS)
                ok = st['th'] == n and st['tdCounts'] == [n] and st['tf'] == n and st['colSpan'] == n
                check(f'1440 {k}: th = td = tfoot = colSpan = {n}', ok, st)
                page.locator('[data-testid="salary-register"] tbody > tr:not(.drill-down-row)').first.locator('td').nth(1).click()
                page.wait_for_timeout(200)
            view(page, 'all')
            pin = page.evaluate(PIN_JS)
            check('1440: 5 pinned header cells, sticky, none overlapping', pin['n'] == 5 and not pin['bad'] and pin['pos'] == 'sticky', pin)
            page.evaluate("() => { const b = document.querySelector('[data-testid=register-scroll]'); b.scrollLeft = b.scrollWidth / 2; }")
            page.wait_for_timeout(200)
            pin = page.evaluate(PIN_JS)
            check('1440: pins still separate with the register scrolled sideways', not pin['bad'], pin)
            # sticky header + footer stay at the edges of the scroll window when scrolled down
            geo = page.evaluate("""() => { const b = document.querySelector('[data-testid=register-scroll]'); b.scrollTop = 600;
                const br = b.getBoundingClientRect(), th = b.querySelector('thead th').getBoundingClientRect(),
                      tf = b.querySelector('tfoot td').getBoundingClientRect();
                return { boxTop: br.top, thTop: th.top, boxBottom: br.bottom - (b.offsetHeight - b.clientHeight), tfBottom: tf.bottom, scrolled: b.scrollTop }; }""")
            check('1440: header row sticks to the top of the register while scrolling', geo['scrolled'] > 0 and abs(geo['thTop'] - geo['boxTop']) < 2, geo)
            check('1440: totals row sticks to the bottom of the register', abs(geo['tfBottom'] - geo['boxBottom']) < 2, geo)
            page.evaluate("() => { const b = document.querySelector('[data-testid=register-scroll]'); b.scrollTop = 0; b.scrollLeft = 0; }")
            # totals = cards (filter All)
            for col, card in (('Earned', 'Total Gross'), ('Take Home', 'Take Home')):
                tot, crd = money(page.evaluate(COL_TOTAL_JS, col)), money(page.evaluate(CARD_JS, card))
                check(f'1440 All: {col} total = "{card}" card', tot is not None and tot == crd, f'{tot} vs {crd}')
            mz = page.evaluate("""() => { const t = document.querySelector('[data-testid=salary-register] table');
                const ths = [...t.querySelectorAll('thead th')]; const i = ths.findIndex(h => h.textContent.startsWith('PF'));
                const cells = [...t.querySelectorAll('tbody > tr:not(.drill-down-row)')].map(r => r.children[i]);
                const z = cells.find(c => c.textContent === '₹0'), nz = cells.find(c => c.textContent !== '₹0');
                return { zero: z && z.textContent, zc: z && getComputedStyle(z).color, nzc: nz && getComputedStyle(nz).color }; }""")
            check('zero amounts keep "₹0" text but render muted (slate-300)', mz['zero'] == '₹0' and mz['zc'] == 'rgb(203, 213, 225)' and mz['nzc'] != mz['zc'], mz)
            label = page.evaluate("() => document.querySelector('[data-testid=register-totals] td').textContent")
            check('1440: totals label "Totals — 64 shown"', label == 'Totals — 64 shown', label)
            # X1: no stray 0 in the register header
            hdr = page.evaluate("() => [...document.querySelector('[data-testid=salary-register] .card-header').querySelectorAll('*')].filter(e => !e.children.length && e.textContent.trim() === '0').length")
            check('X1: no stray "0" in the register header', hdr == 0, hdr)
            # drill-down visible inside the scroll window, even scrolled right
            row = page.locator('[data-testid="salary-register"] tbody > tr:not(.drill-down-row)').first
            row.locator('td').nth(1).click()
            page.wait_for_timeout(400)
            for where in ('left', 'right'):
                if where == 'right':
                    page.evaluate("() => { const b = document.querySelector('[data-testid=register-scroll]'); b.scrollLeft = b.scrollWidth; }")
                    page.wait_for_timeout(300)
                g = page.evaluate("""() => { const b = document.querySelector('[data-testid=register-scroll]').getBoundingClientRect();
                    const d = document.querySelector('[data-testid=register-drilldown]').getBoundingClientRect();
                    const ded = [...document.querySelectorAll('[data-testid=register-drilldown] p')].find(p => p.textContent === 'Deductions');
                    const dr = ded ? ded.parentElement.getBoundingClientRect() : null;
                    return { bl: b.left, br: b.right, dl: d.left, dr: d.right, dedRight: dr && dr.right }; }""")
                check(f'X2: drill-down (Earnings + Deductions) inside the visible register, scrolled {where}',
                      g['dl'] >= g['bl'] - 1 and g['dr'] <= g['br'] + 1 and g['dedRight'] is not None and g['dedRight'] <= g['br'] + 1, g)
            page.evaluate("() => { document.querySelector('[data-testid=register-scroll]').scrollLeft = 0; }")
            row.locator('td').nth(1).click()
            # payslip modal: no stray 0 (X1, same class of bug)
            page.locator('[data-testid="salary-register"] tbody tr').nth(5).locator('button[title="Payslip"]').click()
            page.get_by_text('Net Salary').first.wait_for(timeout=10000)
            page.wait_for_timeout(800)
            z = page.evaluate("() => { const m = [...document.querySelectorAll('[role=dialog], .fixed')].find(e => e.textContent.includes('Net Salary')); return m ? [...m.querySelectorAll('*')].filter(e => !e.children.length && e.textContent.trim() === '0').length : -1 }")
            check('X1: payslip modal has no stray "0"', z == 0, z)
            page.keyboard.press('Escape')
            page.wait_for_timeout(300)

            # ── user simulation ──
            page.get_by_role('button', name=re.compile(r'^Held \(')).click()
            page.wait_for_timeout(400)
            st = page.evaluate(STRUCT_JS)
            held_ok = page.evaluate("() => [...document.querySelectorAll('[data-testid=salary-register] tbody > tr:not(.drill-down-row)')].every(r => r.querySelector('[data-testid=held-reason]'))")
            check(f'sim: filter Held → {held_n} rows, each with its held reason pill', st['rows'] == held_n and held_ok, st)
            label = page.evaluate("() => document.querySelector('[data-testid=register-totals] td').textContent")
            check('sim: totals label follows the filter', label == f'Totals — {held_n} shown', label)
            page.get_by_role('button', name=re.compile(r'^All \(')).click()
            page.wait_for_timeout(300)
            view(page, 'review')
            st = page.evaluate(STRUCT_JS)
            check('sim: Review shows 11 columns', st['th'] == 11 and st['tdCounts'] == [11], st)
            view(page, 'all')
            check('sim: back to Everything (25)', page.evaluate(STRUCT_JS)['th'] == 25)
            page.locator('[data-testid="salary-register"] thead th', has_text='Net').first.click()
            page.wait_for_timeout(300)
            nets = [money(x) for x in page.evaluate(COL_VALUES_JS, 'Net')]
            check('sim: sort by Net (first click = descending)', nets == sorted(nets, reverse=True), nets[:6])
            page.locator('[data-testid="salary-register"] thead th', has_text='Net').first.click()
            page.wait_for_timeout(300)
            nets = [money(x) for x in page.evaluate(COL_VALUES_JS, 'Net')]
            check('sim: sort by Net again = ascending', nets == sorted(nets), nets[:6])
            # persistence
            view(page, 'statutory')
            page.reload()
            page.locator('[data-testid="salary-register"] tbody tr').first.wait_for(timeout=30000)
            check('view choice survives a reload', pressed(page) == 'statutory', pressed(page))
            view(page, 'all')
            ctx.close()

            # ── page-level horizontal scroll at 2560 / 1440 on all 9 pages ──
            pages = [path for _, path, _ in R.PAGES]
            pages = [x.replace('{LOAN_ID}', str(seeded['loanDetailId'])) for x in pages]
            for w, h in ((2560, 1440), (1440, 900)):
                ctx, page = new_page(browser, state, w, h, errors)
                for path in pages:
                    page.goto(base + path)
                    try:
                        page.wait_for_load_state('networkidle', timeout=15000)
                    except Exception:
                        pass
                    page.wait_for_timeout(700)
                    o = page.evaluate("() => { const m = document.querySelector('main'), s = document.scrollingElement; return { doc: s.scrollWidth - s.clientWidth, main: m.scrollWidth - m.clientWidth }; }")
                    check(f'{w}: no page-level horizontal scroll on {path}', o['doc'] <= 0 and o['main'] <= 0, o)
                ctx.close()

            # ── phone 390 ──
            ctx, page = new_page(browser, state, 390, 844, errors)
            open_stage7(page, base)
            check('390: default view is Review', pressed(page) == 'review', pressed(page))
            vis = page.evaluate("() => [...document.querySelectorAll('[data-testid=stage7-actions] button')].map(b => { const r = b.getBoundingClientRect(); return [b.textContent.trim(), Math.round(r.left), Math.round(r.right)]; })")
            check('X3 390: every header button is inside the screen', len(vis) >= 3 and all(l >= 0 and r <= 390 for _, l, r in vis), vis)
            pos = page.evaluate("() => getComputedStyle(document.querySelector('[data-testid=salary-register] tbody td.pin')).position")
            check('390: nothing pinned below md', pos != 'sticky', pos)
            box = page.evaluate("() => { const b = document.querySelector('[data-testid=register-scroll]').getBoundingClientRect(); return [Math.round(b.left), Math.round(b.right)]; }")
            check('390: register scroll box fits the screen', box[0] >= 0 and box[1] <= 390, box)
            page.locator('[data-testid="salary-register"] tbody > tr:not(.drill-down-row)').first.locator('td').nth(1).click()
            page.wait_for_timeout(400)
            st = page.evaluate(STRUCT_JS)
            check('390: expand a row in Review → colSpan 11', st['colSpan'] == 11, st)
            ctx.close()
            browser.close()
    finally:
        R.stop_server()
    check('0 page errors across every run', not errors, errors[:3])
    bad = [n for n, ok in RESULTS if not ok]
    print(f"\n{len(RESULTS) - len(bad)}/{len(RESULTS)} checks passed" + (f" — FAILED: {bad}" if bad else ''))
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()
