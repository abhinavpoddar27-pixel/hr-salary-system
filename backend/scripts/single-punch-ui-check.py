import json, os, sqlite3, subprocess, sys, tempfile, time, urllib.request, urllib.parse
from playwright.sync_api import sync_playwright
ROOT=os.environ.get('APP_ROOT', os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))); PORT=3432; BASE=f'http://127.0.0.1:{PORT}'
WORK=tempfile.mkdtemp(prefix='sp-ui-'); DB=os.path.join(WORK,'hr_system.db'); C='Asian Lakto Ind Ltd'; P=F=0
def chk(l,e,a):
    global P,F
    if e==a: P+=1; print('  ✓',l)
    else: F+=1; print('  ✗',l,'expected',repr(e),'got',repr(a))
env=dict(os.environ,DATA_DIR=WORK,JWT_SECRET='x',PORT=str(PORT),NODE_ENV='production',ADMIN_PASSWORD='Admin@123',HR_PASSWORD='Indriyan@2025',FINANCE_PASSWORD='Finance@2025')
srv=subprocess.Popen(['node',f'{ROOT}/backend/server.js'],env=env,stdout=open(f'{WORK}/log','w'),stderr=subprocess.STDOUT)
try:
    for _ in range(60):
        try: urllib.request.urlopen(BASE+'/api/health'); break
        except Exception: time.sleep(0.5)
    c=sqlite3.connect(DB)
    c.execute("INSERT INTO employees(code,name,department,company,status,employment_type,gross_salary) VALUES('T7801','TEST EMP 1','OPR',?,'Active','Permanent',26000)",(C,))
    c.execute("INSERT INTO employees(code,name,department,company,status,employment_type,gross_salary) VALUES('T7802','TEST EMP 2','OPR',?,'Active','Permanent',26000)",(C,))
    # T7801 lone evening punch (Missing IN), T7802 lone morning punch on a P day (old rule, Missing OUT)
    c.execute("INSERT INTO attendance_processed(employee_code,date,status_original,status_final,in_time_original,in_time_final,month,year,company,is_miss_punch,miss_punch_type) VALUES('T7801','2026-10-07','A','A','19:22','19:22',10,2026,?,1,'MISSING_IN')",(C,))
    c.execute("INSERT INTO attendance_processed(employee_code,date,status_original,status_final,in_time_original,in_time_final,month,year,company,is_miss_punch,miss_punch_type) VALUES('T7802','2026-10-08','P','P','08:01','08:01',10,2026,?,1,'MISSING_OUT')",(C,))
    c.commit(); c.close()
    with sync_playwright() as p:
        b=p.chromium.launch(); 
        for width in (1440,390):
            pg=b.new_context(viewport={'width':width,'height':900}).new_page(); errs=[]
            pg.on('pageerror',lambda e: errs.append(str(e)))
            pg.goto(BASE+'/login'); pg.get_by_placeholder('admin').fill('hr'); pg.get_by_placeholder('••••••••').fill('Indriyan@2025')
            pg.get_by_role('button',name='Sign in').click(); pg.wait_for_url(lambda u:'/login' not in u)
            pg.goto(BASE+'/pipeline/miss-punch'); pg.wait_for_load_state('networkidle')
            sel=pg.locator('select').filter(has=pg.locator('option',has_text='October')).first
            sel.select_option('10'); pg.wait_for_load_state('networkidle'); time.sleep(1)
            for code, exp in (('T7801',('', '19:22')),('T7802',('08:01',''))):
                row=pg.locator('tr',has_text=code).first
                row.get_by_role('button',name='Correct').click(); time.sleep(0.4)
                ins=pg.locator('input[type="time"]')
                chk(f'{width}px {code} pre-fill IN/OUT', exp, (ins.nth(0).input_value(), ins.nth(1).input_value()))
                pg.get_by_role('button',name='Cancel').first.click(); time.sleep(0.3)
            chk(f'{width}px no page errors',[],errs)
        # save through the UI at desktop: fill IN, save
        pg=b.new_context(viewport={'width':1440,'height':900}).new_page()
        pg.goto(BASE+'/login'); pg.get_by_placeholder('admin').fill('hr'); pg.get_by_placeholder('••••••••').fill('Indriyan@2025')
        pg.get_by_role('button',name='Sign in').click(); pg.wait_for_url(lambda u:'/login' not in u)
        pg.goto(BASE+'/pipeline/miss-punch'); pg.wait_for_load_state('networkidle')
        pg.locator('select').filter(has=pg.locator('option',has_text='October')).first.select_option('10'); pg.wait_for_load_state('networkidle'); time.sleep(1)
        pg.locator('tr',has_text='T7801').first.get_by_role('button',name='Correct').click(); time.sleep(0.4)
        pg.locator('input[type="time"]').nth(0).fill('07:55')
        pg.get_by_role('button',name='Save').first.click(); time.sleep(1.5)
        c=sqlite3.connect(DB); r=c.execute("SELECT status_final,in_time_final,out_time_final,miss_punch_resolved FROM attendance_processed WHERE employee_code='T7801'").fetchone(); c.close()
        chk('UI save → P, 07:55–19:22, resolved',('P','07:55','19:22',1),r)
        b.close()
finally: srv.terminate()
print(f'{P} passed, {F} failed'); sys.exit(1 if F else 0)
