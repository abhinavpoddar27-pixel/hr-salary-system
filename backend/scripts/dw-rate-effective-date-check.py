#!/usr/bin/env python3
"""G1 — DW contractor rate change applies from its effective date — browser check.

Chromium against the BUILT dist, real logins (finance, hr), scratch DATA_DIR, fictional data only
("TEST GANG GAMMA" / "TEST GANG DELTA" — the repo is public). Server restarted between roles (login limiter).

Owner ruling 17 Oct 2026 ("drafts only"): approving a past-dated change re-prices drafts (hr_entered /
needs_correction) dated on/after the effective date; entries with finance, approved, paid … keep the old rate.

  GAMMA 500/20, pending change → 600/25 effective today-7. Entries: today-10 draft (before), today-5 draft,
        today-4 needs_correction, today-3 approved, today-2 paid (3 workers each).
  DELTA 450/40, pending change → 520/45 effective today+10 (future).

Usage:
  PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers PORT=3504 python3 backend/scripts/dw-rate-effective-date-check.py
  APP_ROOT=/home/claude/wt-g1-base python3 backend/scripts/dw-rate-effective-date-check.py --base   # old tree
Needs `npm run build --prefix frontend` in APP_ROOT first.
"""
import datetime, os, re, sqlite3, subprocess, sys, tempfile, time, urllib.request
from playwright.sync_api import sync_playwright

HERE_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
ROOT = os.path.abspath(os.environ.get('APP_ROOT', HERE_ROOT))
BASE_MODE = '--base' in sys.argv
PORT = int(os.environ.get('PORT', '3504')); BASE = f'http://127.0.0.1:{PORT}'
WORK = tempfile.mkdtemp(prefix='g1-'); DB = os.path.join(WORK, 'hr_system.db')
PASS = FAIL = 0
PW = {'hr': 'Indriyan@2025', 'finance': 'Finance@2025', 'admin': 'Admin@123'}
IST = datetime.datetime.utcnow() + datetime.timedelta(hours=5, minutes=30)
TODAY = IST.date()
d = lambda n: (TODAY + datetime.timedelta(days=n)).isoformat()
MON = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
fmt_date = lambda iso: f'{iso[8:10]}-{MON[int(iso[5:7])]}-{iso[:4]}'


def check(label, expected, actual):
    global PASS, FAIL
    if expected == actual: PASS += 1; print(f'  ✓ {label}')
    else: FAIL += 1; print(f'  ✗ {label} — expected {expected!r}, got {actual!r}')


def q(sql, *a):
    c = sqlite3.connect(DB); r = c.execute(sql, a).fetchall(); c.close(); return r


def ex(sql, *a):
    c = sqlite3.connect(DB); cur = c.execute(sql, a); c.commit(); rid = cur.lastrowid; c.close(); return rid


E = {}


def seed():
    g = ex("INSERT INTO dw_contractors(contractor_name,current_daily_wage_rate,current_commission_rate,created_by) VALUES('TEST GANG GAMMA',500,20,'hr')")
    dl = ex("INSERT INTO dw_contractors(contractor_name,current_daily_wage_rate,current_commission_rate,created_by) VALUES('TEST GANG DELTA',450,40,'hr')")
    E['g'] = g; E['d'] = dl
    for key, off, status in (('before', -10, 'hr_entered'), ('draft', -5, 'hr_entered'), ('corr', -4, 'needs_correction'),
                             ('appr', -3, 'approved'), ('paid', -2, 'paid')):
        eid = ex("INSERT INTO dw_entries(contractor_id,entry_date,in_time,out_time,total_worker_count,wage_rate_applied,commission_rate_applied,"
                 "total_wage_amount,total_commission_amount,total_liability,gate_entry_reference,status,created_by) "
                 "VALUES(?,?,'08:00','17:00',3,500,20,1500,60,1560,?,?,'hr')", g, d(off), f'GT-{key}', status)
        ex("INSERT INTO dw_department_allocations(entry_id,department,worker_count,allocated_wage_amount,allocated_commission_amount) VALUES(?,'TESTING',3,1500,60)", eid)
        E[key] = eid
    ex("INSERT INTO dw_rate_history(contractor_id,old_wage_rate,new_wage_rate,old_commission_rate,new_commission_rate,effective_date,proposed_by) "
       "VALUES(?,500,600,20,25,?,'hr')", g, d(-7))
    ex("INSERT INTO dw_rate_history(contractor_id,old_wage_rate,new_wage_rate,old_commission_rate,new_commission_rate,effective_date,proposed_by) "
       "VALUES(?,450,520,40,45,?,'hr')", dl, d(10))


env = dict(os.environ, DATA_DIR=WORK, JWT_SECRET='x', PORT=str(PORT), NODE_ENV='production',
           ADMIN_PASSWORD=PW['admin'], HR_PASSWORD=PW['hr'], FINANCE_PASSWORD=PW['finance'])
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
srv = None; RUNS = [0]


def start():
    global srv
    RUNS[0] += 1
    srv = subprocess.Popen(['node', f'{ROOT}/backend/server.js'], env=env, stdout=open(f'{WORK}/log', 'a'), stderr=subprocess.STDOUT)
    for _ in range(240):
        try:
            if opener.open(BASE + '/api/version', timeout=2).status == 200 and open(f'{WORK}/log').read().count('running on') >= RUNS[0]: return
        except Exception: pass
        time.sleep(.5)


def stop():
    srv.terminate(); srv.wait(10)


def login(b, user, path, width=1440):
    ctx = b.new_context(viewport={'width': width, 'height': 900})
    pg = ctx.new_page()
    st = {'errs': [], 'bad': []}
    pg.on('pageerror', lambda e: st['errs'].append(str(e)))
    pg.on('response', lambda r: st['bad'].append(f'{r.status} {r.url}') if '/api/' in r.url and r.status >= 400
          and not r.url.endswith('/comp-off/pending') and 'session-analytics' not in r.url else None)
    pg.goto(BASE + '/login'); pg.get_by_placeholder('admin').fill(user); pg.get_by_placeholder('••••••••').fill(PW[user])
    pg.get_by_role('button', name='Sign in').click(); pg.wait_for_url(lambda u: '/login' not in u)
    pg.goto(BASE + path); pg.wait_for_load_state('networkidle'); time.sleep(.8)
    return pg, ctx, st


def dialog(pg):
    return pg.get_by_role('dialog').filter(has=pg.locator('[data-testid="confirm-approve-rate"]'))


ent = lambda k: q('SELECT wage_rate_applied, commission_rate_applied, total_wage_amount, total_commission_amount, total_liability FROM dw_entries WHERE id=?', E[k])[0]
alloc = lambda k: q('SELECT allocated_wage_amount, allocated_commission_amount FROM dw_department_allocations WHERE entry_id=?', E[k])[0]
total = lambda cid: q('SELECT ROUND(SUM(total_liability),2) FROM dw_entries WHERE contractor_id=?', cid)[0][0]
cur = lambda cid: q('SELECT current_daily_wage_rate, current_commission_rate FROM dw_contractors WHERE id=?', cid)[0]
OLD = (500.0, 20.0, 1500.0, 60.0, 1560.0); NEW = (600.0, 25.0, 1800.0, 75.0, 1875.0)

start(); seed()
print(f'App root: {ROOT}  mode: {"BASE (expect the old behaviour)" if BASE_MODE else "fix"}  IST today {TODAY}')
try:
    with sync_playwright() as p:
        b = p.chromium.launch()

        # ── finance: approve GAMMA (past-dated) and DELTA (future) ───────────
        print('\n— finance: approve a past-dated change (GAMMA) —')
        pg, ctx, st = login(b, 'finance', '/daily-wage/contractors')
        pg.get_by_role('button', name=re.compile('^Rate Approvals')).click(); time.sleep(.6)
        card = lambda name: pg.locator('div.bg-white.rounded-lg.border', has_text=name)
        card('TEST GANG GAMMA').get_by_role('button', name='Approve', exact=True).click()
        dialog(pg).wait_for(timeout=5000); time.sleep(1.2)
        txt = dialog(pg).get_by_test_id('confirm-approve-rate').inner_text()
        sum_before = total(E['g']); kept_before = {k: (ent(k), alloc(k)) for k in ('before', 'appr', 'paid')}
        if BASE_MODE:
            check('old: confirm says rates apply from today, effective date not used', True, 'not used yet' in txt)
        else:
            check('confirm: rates apply to entries dated from the effective date', True, f'entries dated {fmt_date(d(-7))} onward' in txt)
            check('confirm: "not used yet" sentence gone', False, 'not used yet' in txt)
            check('confirm: says 2 drafts will be re-priced', True, '2 draft entries' in txt and 're-priced' in txt)
            check('confirm: says 2 entries with finance or paid keep the old rate', True,
                  '2 entries dated after' in txt and 'already with finance or paid and keep the old rate' in txt)
        dialog(pg).get_by_role('button', name='Approve rates', exact=True).dblclick()
        pg.wait_for_load_state('networkidle'); time.sleep(1)
        check('rate change approved in the DB', [('approved',)], q("SELECT approval_status FROM dw_rate_history WHERE contractor_id=?", E['g']))
        if BASE_MODE:
            check('old: draft dated after the effective date NOT re-priced', OLD, ent('draft'))
        else:
            check('toast names the date + re-priced + kept counts', 1,
                  pg.get_by_text(re.compile(r'applies to entries dated .* 2 draft entries re-priced\. 2 entries already with finance or paid keep the old rate')).count())
            check('draft (hr_entered) after the date re-priced', NEW, ent('draft'))
            check('needs_correction after the date re-priced', NEW, ent('corr'))
            check('re-priced allocations follow', (1800.0, 75.0), alloc('draft'))
            for k in ('before', 'appr', 'paid'):
                check(f'{k}: entry + allocation unchanged', kept_before[k], (ent(k), alloc(k)))
            check('DW total moved by exactly the re-priced drafts\' delta (2 × 315)', round(sum_before + 2 * 315, 2), total(E['g']))
            check('one reprice audit row per draft', 2, q("SELECT COUNT(*) FROM dw_audit_log WHERE action='reprice_rate_change'")[0][0])
            check('GAMMA current rates = new (date has passed)', (600.0, 25.0), cur(E['g']))

        print('\n— finance: approve a future-dated change (DELTA) —')
        card('TEST GANG DELTA').get_by_role('button', name='Approve', exact=True).click()
        dialog(pg).wait_for(timeout=5000); time.sleep(1.2)
        txt = dialog(pg).get_by_test_id('confirm-approve-rate').inner_text()
        if not BASE_MODE:
            check('future: confirm says current rates stay until then', True, 'Until then the current rates stay' in txt)
        dialog(pg).get_by_role('button', name='Approve rates', exact=True).click()
        pg.wait_for_load_state('networkidle'); time.sleep(1)
        if BASE_MODE:
            check('old: future-dated change applied at once', (520.0, 45.0), cur(E['d']))
        else:
            check('future: DELTA keeps its current rates until the date', (450.0, 40.0), cur(E['d']))
        check('finance: 0 page errors', [], st['errs']); check('finance: 0 API ≥ 400', [], st['bad'])
        ctx.close()
        stop(); start()

        # ── hr: Entry page preview + back-dated save ─────────────────────────
        print('\n— hr: new entry, back-dated before the effective date —')
        pg, ctx, st = login(b, 'hr', '/daily-wage/new')
        pg.get_by_placeholder('Search contractor...').click()
        pg.locator('div.cursor-pointer', has_text='TEST GANG GAMMA').first.click(); time.sleep(.5)
        pg.locator('input[type=date]').fill(d(-9)); time.sleep(1)
        prev = pg.get_by_test_id('entry-rate-preview').inner_text() if pg.get_by_test_id('entry-rate-preview').count() else \
            pg.locator('div.bg-blue-50', has_text='Wage Rate').first.inner_text()
        if BASE_MODE:
            check('old: preview for a back-dated entry shows today\'s rate (600)', True, '600.00' in prev)
        else:
            check('preview for a date before the change shows the old rate (500)', True, '500.00' in prev and '20.00' in prev)
            check('preview says "Rate in force on <date>"', 1, pg.get_by_test_id('entry-rate-note').count())
            pg.locator('input[type=date]').fill(d(-1)); time.sleep(1)
            check('preview after the change date shows the new rate (600)', True, '600.00' in pg.get_by_test_id('entry-rate-preview').inner_text())
            pg.locator('input[type=date]').fill(d(-9)); time.sleep(1)
        pg.locator('input[type=number]').first.fill('2')
        pg.get_by_placeholder('Department name').fill('TESTING')
        pg.get_by_placeholder('0', exact=True).fill('2')
        pg.get_by_placeholder('e.g. GE-2026-04-10-001').fill('GT-UI-1')
        pg.get_by_role('button', name='Save as Draft').click()
        pg.wait_for_url(lambda u: u.rstrip('/').endswith('/daily-wage'), timeout=8000); time.sleep(.6)
        saved = q("SELECT wage_rate_applied, commission_rate_applied, total_liability FROM dw_entries WHERE gate_entry_reference='GT-UI-1'")
        if BASE_MODE:
            check('old: back-dated entry saved at the NEW rate', [(600.0, 25.0, 1250.0)], saved)
        else:
            check('back-dated entry saved at the OLD rate (= preview)', [(500.0, 20.0, 1040.0)], saved)
        check('hr: 0 page errors', [], st['errs']); check('hr: 0 API ≥ 400', [], st['bad'])
        ctx.close()

        if not BASE_MODE:
            print('\n— hr, phone 390 px —')
            pg, ctx, st = login(b, 'hr', '/daily-wage/new', width=390)
            pg.get_by_placeholder('Search contractor...').click()
            pg.locator('div.cursor-pointer', has_text='TEST GANG GAMMA').first.click(); time.sleep(.5)
            pg.locator('input[type=date]').fill(d(-9)); time.sleep(1)
            box = pg.get_by_test_id('entry-rate-preview').bounding_box()
            check('390px: rate preview fits the width', True, box is not None and box['x'] + box['width'] <= 390)
            check('390px: no sideways page scroll', True, pg.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1'))
            check('390px: 0 page errors', [], st['errs'])
            ctx.close()
        b.close()
finally:
    stop()
print(f'\n{PASS} passed, {FAIL} failed')
sys.exit(1 if FAIL else 0)
