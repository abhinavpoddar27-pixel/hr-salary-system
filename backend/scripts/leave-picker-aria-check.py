#!/usr/bin/env python3
"""P2-07: EmployeeSearchSelect aria in the real app (Leave Management → Apply Leave).

Built dist + real server.js on a scratch DATA_DIR, fictional employees T97xx, real hr login.
Checks aria-controls / aria-activedescendant follow the keyboard, a pick still works, 0 errors.
  npm run build --prefix frontend   (first)
  python3 backend/scripts/leave-picker-aria-check.py          # PORT env, default 3207
"""
import os, sqlite3, subprocess, sys, tempfile, time, urllib.request
os.environ.setdefault('PLAYWRIGHT_BROWSERS_PATH', '/opt/pw-browsers')
from playwright.sync_api import sync_playwright

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
PORT = int(os.environ.get('PORT', '3207')); BASE = f'http://127.0.0.1:{PORT}'
WORK = tempfile.mkdtemp(prefix='p207-leave-'); DB = os.path.join(WORK, 'hr_system.db')
C = 'Asian Lakto Ind Ltd'
PASS = FAIL = 0


def check(label, ok, detail=''):
    global PASS, FAIL
    if ok: PASS += 1; print(f'  ✓ {label}')
    else: FAIL += 1; print(f'  ✗ {label} {detail}')


def seed():
    c = sqlite3.connect(DB)
    for i in range(1, 6):
        c.execute("INSERT OR IGNORE INTO employees(code,name,department,company,status,employment_type,gross_salary,date_of_joining) "
                  "VALUES(?,?,'TEST DEPT',?,'Active','Permanent',20000,'2025-01-01')", (f'T970{i}', f'TEST PICK {i}', C))
    c.commit(); c.close()


env = dict(os.environ, DATA_DIR=WORK, JWT_SECRET='x', PORT=str(PORT), NODE_ENV='production',
           ADMIN_PASSWORD='Admin@123', HR_PASSWORD='Indriyan@2025', FINANCE_PASSWORD='Finance@2025')
srv = subprocess.Popen(['node', f'{ROOT}/backend/server.js'], env=env, stdout=open(f'{WORK}/log', 'w'), stderr=subprocess.STDOUT)
try:
    for _ in range(80):
        try: urllib.request.urlopen(BASE + '/api/version', timeout=2); break
        except Exception: time.sleep(.5)
    seed()
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page(viewport={'width': 1440, 'height': 900})
        errs, bad = [], []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' and 'vite.svg' not in m.text and '404' not in m.text else None)
        pg.on('response', lambda r: bad.append(f'{r.status} {r.url}') if '/api/' in r.url and r.status >= 400 else None)
        pg.goto(BASE + '/login'); pg.get_by_placeholder('admin').fill('hr'); pg.get_by_placeholder('••••••••').fill('Indriyan@2025')
        pg.get_by_role('button', name='Sign in').click(); pg.wait_for_url(lambda u: '/login' not in u)
        pg.goto(BASE + '/leave-management'); pg.wait_for_load_state('networkidle')
        pg.get_by_role('button', name='+ Apply Leave').click()
        pg.get_by_role('heading', name='Apply for Leave').wait_for()
        box = pg.get_by_placeholder('Type code or name…').first.element_handle()  # stable: placeholder changes after a pick
        box.click()
        pg.wait_for_selector('[role=listbox] [role=option]')
        st = lambda: pg.evaluate("""() => { const i = document.querySelector('[role=combobox][aria-expanded=true]') || document.querySelector('[role=combobox]')
            const c = i.getAttribute('aria-controls'), a = i.getAttribute('aria-activedescendant')
            const lb = c && document.getElementById(c), o = a && document.getElementById(a)
            return { c, a, lb: lb && lb.getAttribute('role'), o: o && o.getAttribute('role'), inList: !!(lb && o && lb.contains(o)), text: o && o.textContent } }""")
        s1 = st()
        check('aria-controls → listbox', s1['lb'] == 'listbox', str(s1))
        check('aria-activedescendant → option inside it', s1['o'] == 'option' and s1['inList'], str(s1))
        box.press('ArrowDown'); s2 = st()
        check('ArrowDown moves the active option', s2['inList'] and s2['a'] != s1['a'], str(s2))
        box.fill('T9703'); s3 = st()
        check('typing → active option is the match', s3['text'] and 'T9703' in s3['text'], str(s3))
        box.press('Enter')
        check('Enter picks', 'T9703' in box.input_value(), box.input_value())
        s4 = pg.evaluate("() => document.querySelector('[role=combobox]').getAttribute('aria-activedescendant')")
        check('closed → no aria-activedescendant', s4 is None, str(s4))
        dup = pg.evaluate("() => { const a=[...document.querySelectorAll('[id]')].map(e=>e.id); return a.length-new Set(a).size }")
        check('no duplicate ids', dup == 0, str(dup))
        check('0 page/console errors', not errs, '; '.join(errs[:3]))
        check('0 API >= 400', not bad, '; '.join(bad[:3]))
        b.close()
finally:
    srv.terminate()
print(f'\n{PASS}/{PASS + FAIL} passed')
sys.exit(1 if FAIL else 0)
