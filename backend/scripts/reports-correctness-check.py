#!/usr/bin/env python3
"""Reports correctness (N-REP: N-3 bank sheet held, N-2 PF/ESI company, N-1 audit trail) — browser check.

Chromium against the BUILT dist, real hr + finance logins, scratch DATA_DIR, fictional data only
(codes T86xx, names "TEST EMP n"; the repo is public). Seeds September 2026 salary rows in both companies
(one held per company) and audit_log rows at the IST month edges + one in August.

Usage:
  python3 backend/scripts/reports-correctness-check.py               # this tree
  APP_ROOT=/tmp/wt python3 .../reports-correctness-check.py --base   # another tree (origin/main): records the bugs
Needs `npm run build --prefix frontend` in APP_ROOT first. PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers.
"""
import csv, os, re, shutil, sqlite3, subprocess, sys, tempfile, time, urllib.request
from playwright.sync_api import sync_playwright

HERE_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
ROOT = os.path.abspath(os.environ.get('APP_ROOT', HERE_ROOT))
BASE_MODE = '--base' in sys.argv
PORT = int(os.environ.get('PORT', '3131')); BASE = f'http://127.0.0.1:{PORT}'
WORK = tempfile.mkdtemp(prefix='nrep-'); DB = os.path.join(WORK, 'hr_system.db')
AL = 'Asian Lakto Ind Ltd'; IB = 'Indriyan Beverages Pvt Ltd'
PASS = FAIL = 0

# code, company, net, held, pf_ee, esi_ee, account, bank_account, ifsc_code, ifsc
ROWS = [
    ('T8601', AL, 20000, 0, 1200, 0,   '5000111', None, 'SYNB0000001', None),
    ('T8602', AL, 15000, 0, 0,    120, '5000222', None, 'SYNB0000002', None),
    ('T8603', AL, 9000,  1, 900,  70,  '5000333', None, 'SYNB0000003', None),   # held
    ('T8604', IB, 18000, 0, 1100, 0,   '  ',      '6000444', '', 'SYNB0000004'),  # blank primary → fallback
    ('T8605', IB, 4000,  1, 0,    30,  '5000555', None, 'SYNB0000005', None),   # held
]
# changed_at (UTC), stage — Sep IST month = 2026-08-31 18:30:00 … 2026-09-30 18:29:59 UTC
AUDIT = [('2026-08-31 18:29:59', 'nrep_aug_edge'), ('2026-08-31 18:30:00', 'nrep_sep_start'),
         ('2026-09-15 06:00:00', 'nrep_sep_mid'), ('2026-09-30 18:29:59', 'nrep_sep_end'),
         ('2026-09-30 18:30:00', 'nrep_oct_edge')]


def check(label, expected, actual):
    global PASS, FAIL
    if expected == actual: PASS += 1; print(f'  ✓ {label}')
    else: FAIL += 1; print(f'  ✗ {label} — expected {expected!r}, got {actual!r}')


def rupees(txt):
    d = re.sub(r'[^0-9\-]', '', txt or '')
    return int(d) if d not in ('', '-') else None


def seed():
    c = sqlite3.connect(DB)
    for i, (code, co, net, held, pfe, esie, acc, bacc, ifc, ifs) in enumerate(ROWS, 1):
        c.execute("INSERT INTO employees(code,name,department,company,status,employment_type,gross_salary,"
                  "account_number,bank_account,ifsc_code,ifsc,bank_name) VALUES(?,?,'TEST DEPT',?,'Active','Permanent',25000,?,?,?,?,'SYNTH BANK')",
                  (code, f'TEST EMP {i}', co, acc, bacc, ifc, ifs))
        c.execute("INSERT INTO salary_computations(employee_code,month,year,company,gross_salary,gross_earned,pf_wages,"
                  "pf_employee,pf_employer,esi_wages,esi_employee,esi_employer,total_deductions,net_salary,salary_held,hold_reason)"
                  " VALUES(?,9,2026,?,25000,25000,?,?,?,?,?,?,0,?,?,?)",
                  (code, co, 10000 if pfe else 0, pfe, pfe, 25000 if esie else 0, esie, esie * 4, net, held, 'Test hold' if held else ''))
    for at, stage in AUDIT:
        c.execute("INSERT INTO audit_log(table_name,record_id,field_name,old_value,new_value,changed_by,changed_at,stage,remark)"
                  " VALUES('synth',1,'f','a','b','tester',?,?,'synthetic')", (at, stage))
    c.executemany("INSERT INTO audit_log(table_name,record_id,field_name,old_value,new_value,changed_by,changed_at,stage,remark)"
                  " VALUES('synth',1,'f','a','b','tester','2026-07-10 10:00:00','nrep_jul_bulk','synthetic')", [()] * 1003)
    c.commit(); c.close()


def login(b, user, pw, width=1440):
    ctx = b.new_context(viewport={'width': width, 'height': 900}, accept_downloads=True)
    pg = ctx.new_page()
    errs, cons, bad = [], [], []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('console', lambda m: cons.append(m.text) if m.type == 'error' and 'vite.svg' not in m.text and '404' not in m.text else None)
    pg.on('response', lambda r: bad.append(f'{r.status} {r.url}') if '/api/' in r.url and r.status >= 400 else None)
    pg.goto(BASE + '/login'); pg.get_by_placeholder('admin').fill(user); pg.get_by_placeholder('••••••••').fill(pw)
    pg.get_by_role('button', name='Sign in').click(); pg.wait_for_url(lambda u: '/login' not in u)
    return pg, errs, cons, bad


def set_company(pg, value):
    sel = pg.locator('select').filter(has=pg.locator('option', has_text='All Companies')).first
    if sel.count() == 0: return
    sel.select_option(value); pg.wait_for_load_state('networkidle'); time.sleep(.8)


def open_report(pg, label, heading):
    pg.goto(BASE + '/reports'); pg.wait_for_load_state('networkidle')
    pg.locator('select').filter(has=pg.locator('option', has_text='September')).first.select_option('9')
    pg.locator('select').filter(has=pg.locator('option', has_text='2026')).first.select_option('2026')
    pg.get_by_role('button', name=re.compile('^' + label)).click()
    pg.wait_for_load_state('networkidle'); time.sleep(1)
    return pg.locator('div.space-y-4', has=pg.get_by_role('heading', name=re.compile('^' + heading))).last


def body_rows(sec):
    # one evaluate instead of a locator call per cell (the old Audit Trail renders 1,000+ rows)
    out = sec.locator('table tbody').first.evaluate(
        "tb => [...tb.querySelectorAll(':scope > tr:not(.drill-down-row)')].map(tr => [...tr.querySelectorAll(':scope > td')].map(td => td.innerText.trim()))")
    return [r for r in out if len(r) > 2]


def codes_in(sec, col):
    return sorted(re.findall(r'T86\d\d', ' '.join(r[col] for r in body_rows(sec))))


env = dict(os.environ, DATA_DIR=WORK, JWT_SECRET='x', PORT=str(PORT), NODE_ENV='production',
           ADMIN_PASSWORD='Admin@123', HR_PASSWORD='Indriyan@2025', FINANCE_PASSWORD='Finance@2025')
srv = subprocess.Popen(['node', f'{ROOT}/backend/server.js'], env=env, stdout=open(f'{WORK}/log', 'w'), stderr=subprocess.STDOUT)
try:
    for _ in range(80):
        try: urllib.request.urlopen(BASE + '/api/version', timeout=2); break
        except Exception: time.sleep(.5)
    seed()
    print(f'App root: {ROOT}  mode: {"BASE (expect the bugs)" if BASE_MODE else "fix"}')
    with sync_playwright() as p:
        b = p.chromium.launch()
        if BASE_MODE:
            pg, errs, cons, bad = login(b, 'hr', 'Indriyan@2025')
            sec = open_report(pg, 'Bank NEFT', 'Bank Transfer Sheet')
            check('old: bank sheet lists the held rows (T8603, T8605)', True, {'T8603', 'T8605'} <= set(codes_in(sec, 1)))
            set_company(pg, IB)
            sec = open_report(pg, 'PF Statement', 'PF Statement')
            check('old: PF with Indriyan selected still shows Asian Lakto rows', True, 'T8601' in codes_in(sec, 0))
            set_company(pg, '')
            sec = open_report(pg, 'Audit Trail', 'Audit Trail')
            rows = body_rows(sec)
            stamps = [r[0].replace('▶', '').replace('▼', '').strip() for r in rows if 'nrep_' in ' '.join(r)]
            check('old: audit timestamps blank', True, len(stamps) > 0 and all(s == '' for s in stamps))
            check('old: August edge row shown in September', True, any('nrep_aug_edge' in ' '.join(r) for r in rows))
            b.close()
        else:
            for user, pw in (('hr', 'Indriyan@2025'), ('finance', 'Finance@2025')):
                print(f'\n— {user} —')
                pg, errs, cons, bad = login(b, user, pw)
                set_company(pg, '')
                sec = open_report(pg, 'Bank NEFT', 'Bank Transfer Sheet')
                check(f'{user}: bank — all companies: non-held rows only', ['T8601', 'T8602', 'T8604'], codes_in(sec, 1))
                total_txt = sec.locator('div.card', has_text='Total Net Payable').first.inner_text()
                check(f'{user}: bank — total = non-held sum', 53000, rupees(total_txt.split('(')[0]))
                note = sec.locator('[data-testid="bank-held-note"]')
                check(f'{user}: bank — held note shows 2 / ₹13,000', True,
                      note.count() == 1 and '2 held salaries' in note.inner_text() and '13,000' in note.inner_text())
                r4 = [r for r in body_rows(sec) if 'T8604' in r[1]][0]
                check(f'{user}: bank — blank primary account/IFSC falls back', ['6000444', 'SYNB0000004'], [r4[2], r4[4]])
                with pg.expect_download() as dl:
                    sec.get_by_role('button', name=re.compile('Export CSV')).click()
                recs = list(csv.reader(open(dl.value.path(), encoding='utf-8')))
                check(f'{user}: bank CSV = 3 rows, no held', ['T8601', 'T8602', 'T8604'], sorted(r[0] for r in recs[1:]))

                set_company(pg, IB)
                sec = open_report(pg, 'Bank NEFT', 'Bank Transfer Sheet')
                check(f'{user}: bank — Indriyan only', ['T8604'], codes_in(sec, 1))
                note = sec.locator('[data-testid="bank-held-note"]')
                check(f'{user}: bank — Indriyan held note 1 / ₹4,000', True,
                      note.count() == 1 and '1 held salary' in note.inner_text() and '4,000' in note.inner_text())
                sec = open_report(pg, 'PF Statement', 'PF Statement')
                check(f'{user}: PF — Indriyan only', ['T8604'], codes_in(sec, 0))
                check(f'{user}: PF heading names the company', True, IB in sec.get_by_role('heading').first.inner_text())
                sec = open_report(pg, 'ESI Statement', 'ESI Statement')
                check(f'{user}: ESI — Indriyan only (held row kept)', ['T8605'], codes_in(sec, 0))
                set_company(pg, AL)
                sec = open_report(pg, 'PF Statement', 'PF Statement')
                check(f'{user}: PF — Asian Lakto only (held row kept)', ['T8601', 'T8603'], codes_in(sec, 0))
                sec = open_report(pg, 'ESI Statement', 'ESI Statement')
                check(f'{user}: ESI — Asian Lakto only', ['T8602', 'T8603'], codes_in(sec, 0))
                set_company(pg, '')
                sec = open_report(pg, 'PF Statement', 'PF Statement')
                check(f'{user}: PF — all companies', ['T8601', 'T8603', 'T8604'], codes_in(sec, 0))

                sec = open_report(pg, 'Audit Trail', 'Audit Trail')
                rows = body_rows(sec)
                mine = {r[6]: r for r in rows if r[6].startswith('nrep_')}
                check(f'{user}: audit — only Sep IST rows of ours', ['nrep_sep_end', 'nrep_sep_mid', 'nrep_sep_start'], sorted(mine))
                check(f'{user}: audit — times in IST', ['01-09-2026 00:00', '15-09-2026 11:30', '30-09-2026 23:59'],
                      sorted(re.sub(r'^[^0-9]*', '', mine[k][0]) for k in mine))
                check(f'{user}: audit — every timestamp non-blank', True, all(re.search(r'\d{2}-\d{2}-\d{4} \d{2}:\d{2}', r[0]) for r in rows))
                check(f'{user}: audit — every row in September (IST)', True, all('-09-2026' in r[0] for r in rows))
                cnt = pg.locator('[data-testid="audit-count"]').first.inner_text() if pg.locator('[data-testid="audit-count"]').count() else ''
                print('    count line:', cnt)
                check(f'{user}: audit — count line', True, 'Sep 2026' in cnt and 'Not filtered by company' in cnt)
                with pg.expect_download() as dl:
                    sec.get_by_role('button', name=re.compile('Export CSV')).click()
                recs = list(csv.reader(open(dl.value.path(), encoding='utf-8')))
                check(f'{user}: audit CSV timestamp column filled', True,
                      recs[0][0] == 'Timestamp (IST)' and all(r[0] for r in recs[1:]) and len(recs) > 1)
                check(f'{user}: 0 page errors', [], errs)
                check(f'{user}: 0 console errors', [], cons)
                check(f'{user}: 0 API ≥ 400', [], bad)

            print('\n— Settings → Audit tab (alias created_at) —')
            pg, errs, cons, bad = login(b, 'hr', 'Indriyan@2025')
            j = pg.evaluate("async () => (await fetch('/api/reports/audit-trail?month=9&year=2026', "
                            "{headers: {Authorization: 'Bearer ' + localStorage.getItem('hr_token')}})).json()")
            check('API: created_at alias = changed_at on every row', True, all(x['created_at'] == x['changed_at'] for x in j['data']))
            check('API: total + truncated present', True, 'total' in j and 'truncated' in j)

            print('\n— phone 390px (finance) —')
            pg, errs, cons, bad = login(b, 'finance', 'Finance@2025', width=390)
            sec = open_report(pg, 'Bank NEFT', 'Bank Transfer Sheet')
            check('phone: held note visible', 1, sec.locator('[data-testid="bank-held-note"]').count())
            check('phone: 0 page errors', [], errs)

            print('\n— edge: empty month (August 2026 bank / September seeds absent) —')
            pg, errs, cons, bad = login(b, 'hr', 'Indriyan@2025')
            sec = open_report(pg, 'Bank NEFT', 'Bank Transfer Sheet')
            pg.locator('select').filter(has=pg.locator('option', has_text='September')).first.select_option('8')
            pg.wait_for_load_state('networkidle'); time.sleep(1)
            check('empty: message', 1, pg.get_by_text('Run salary computation first', exact=True).count())
            check('empty: no held note', 0, pg.locator('[data-testid="bank-held-note"]').count())
            check('empty: 0 page errors', [], errs)
            check('empty: 0 API ≥ 400', [], bad)

            print('\n— edge: audit month over the 1,000 cap (July 2026, 1,003 rows) —')
            sec = open_report(pg, 'Audit Trail', 'Audit Trail')
            pg.locator('select').filter(has=pg.locator('option', has_text='September')).first.select_option('7')
            pg.wait_for_load_state('networkidle'); time.sleep(1.5)
            cnt = pg.locator('[data-testid="audit-count"]').first.inner_text()
            check('cap: "latest 1,000 of 1,003"', True, 'latest 1,000 of 1,003' in cnt)
            check('cap: 1,000 rows rendered', 1000, pg.locator('table tbody > tr:not(.drill-down-row)').count())
            check('cap: 0 page errors', [], errs)
            b.close()
finally:
    srv.terminate(); shutil.rmtree(WORK, ignore_errors=True)

print(f'\n{PASS} passed, {FAIL} failed')
sys.exit(1 if FAIL else 0)
