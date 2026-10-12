#!/usr/bin/env python3
"""P2-10 Phase 0 diagnostic (read-only, scratch DB). For 5 roles: sidebar labels + every nav route's API >=400."""
import json, os, re, subprocess, sys, tempfile, time, urllib.request
from playwright.sync_api import sync_playwright
ROOT = '/home/claude/wt-p2-10'
PORT = 3403; BASE = f'http://127.0.0.1:{PORT}'
WORK = tempfile.mkdtemp(prefix='p210-')
USERS = {'admin': ('admin', 'Admin@123'), 'hr': ('hr', 'Indriyan@2025'), 'finance': ('finance', 'Finance@2025'),
         'viewer': ('test_viewer', 'Viewer@2025'), 'supervisor': ('test_super', 'Super@2025')}

def api(path, body=None, tok=None):
    req = urllib.request.Request(BASE + path, data=json.dumps(body).encode() if body is not None else None,
                                 headers={'Content-Type': 'application/json', **({'Authorization': 'Bearer ' + tok} if tok else {})})
    return json.loads(urllib.request.urlopen(req).read())

src = open(f'{ROOT}/frontend/src/components/layout/Sidebar.jsx').read()
nav_paths = re.findall(r"to: '([^']+)'", src)
routes = [p for p in dict.fromkeys(nav_paths) if p not in ('/pipeline', '/workforce', '/analytics', '/compliance', '/sales', '/settings')]
routes += ['/loans/1', '/sales/payslip/X1', '/admin/bug-reports/1']

env = dict(os.environ, DATA_DIR=WORK, JWT_SECRET='x', PORT=str(PORT), NODE_ENV='production',
           ADMIN_PASSWORD='Admin@123', HR_PASSWORD='Indriyan@2025', FINANCE_PASSWORD='Finance@2025')
srv = subprocess.Popen(['node', f'{ROOT}/backend/server.js'], env=env, stdout=open(f'{WORK}/log', 'w'), stderr=subprocess.STDOUT)
out = {}
try:
    for _ in range(80):
        try: urllib.request.urlopen(BASE + '/api/version', timeout=2); break
        except Exception: time.sleep(.5)
    la = api('/api/auth/login', {'username': 'admin', 'password': 'Admin@123'}); tok = la['token']
    api('/api/auth/users', {'username': 'test_viewer', 'password': 'Viewer@2025', 'role': 'viewer', 'allowedCompanies': ['*']}, tok)
    api('/api/auth/users', {'username': 'test_super', 'password': 'Super@2025', 'role': 'supervisor', 'allowedCompanies': ['*']}, tok)
    sess = {'admin': la}
    for role, (u, pw) in USERS.items():
        if role != 'admin': sess[role] = api('/api/auth/login', {'username': u, 'password': pw})
    with sync_playwright() as p:
        b = p.chromium.launch()
        for role, (u, pw) in USERS.items():
            ctx = b.new_context(viewport={'width': 1440, 'height': 900})
            ctx.add_init_script("try{if(!sessionStorage.getItem('x')){localStorage.setItem('hr_token',%s);localStorage.setItem('hr_user',%s);sessionStorage.setItem('x','1')}}catch(e){}" % (json.dumps(sess[role]['token']), json.dumps(json.dumps(sess[role]['user']))))
            pg = ctx.new_page()
            bad = []; errs = []
            pg.on('response', lambda r: bad.append((r.status, r.request.method, re.sub(r'\?.*', '', r.url.replace(BASE, '')))) if '/api/' in r.url and r.status >= 400 else None)
            pg.on('pageerror', lambda e: errs.append(str(e)[:120]))
            pg.goto(BASE + '/'); pg.wait_for_load_state('networkidle'); time.sleep(1.5)
            # expand every parent
            for btn in pg.locator('aside nav > ul > li > button').all():
                if '▼' in (btn.inner_text() or ''): btn.click(); time.sleep(.1)
            labels = []
            for li in pg.locator('aside nav a, aside nav button').all():
                t = re.sub(r'\s+', ' ', li.inner_text()).replace('▲', '').replace('▼', '').strip()
                href = li.get_attribute('href')
                labels.append([t, href])
            hdr = {}
            pg.locator('header button').last.click(); time.sleep(.2)
            hdr['settings_in_menu'] = pg.get_by_role('button', name='Settings').count() > 0
            pg.keyboard.press('Escape')
            rv = {}
            for r in routes:
                bad.clear(); errs.clear()
                pg.goto(BASE + r); pg.wait_for_load_state('networkidle'); time.sleep(.6)
                rv[r] = {'final': pg.url.replace(BASE, ''), 'bad': sorted(set(bad)), 'errs': list(errs),
                         'title': (pg.locator('header h1').first.inner_text() if pg.locator('header h1').count() else '')}
            out[role] = {'labels': labels, 'header': hdr, 'routes': rv}
            ctx.close()
        b.close()
finally:
    srv.terminate()
json.dump(out, open(sys.argv[1] if len(sys.argv) > 1 else '/dev/stdout', 'w'), indent=1)
