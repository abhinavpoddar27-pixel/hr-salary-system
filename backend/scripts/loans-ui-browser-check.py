#!/usr/bin/env python3
"""
Loans PR-4 browser check — drives the REBUILT loan screens in Chromium with
REAL logins, on a SCRATCH database. Never point it at a real database.

  * Boots backend/server.js with NODE_ENV=production on a fresh temp DATA_DIR,
    so it serves the built frontend/dist (run `npm run build` in frontend first).
  * Seeds plant employees, 3 months of salary history for one, a viewer user and
    one loan raised by "admin" (the admin cannot raise through the API, so this is
    the only way to show the self-approval tooltip).
  * Pass 1 — disbursement gate '0' (as production): raise, queue, approve, reject,
    and the disabled Disburse button with the reason.
  * Pass 2 — gate flipped to '1' IN THE TEMP DB ONLY: disburse, receipt, defer,
    restructure + withdraw, write-off + reject, cancel, policy edit, due list,
    statement print window, Employees → Loans tab, Mark Left text, viewer read-only.

Usage:  python3 backend/scripts/loans-ui-browser-check.py [screenshot_dir]
Needs Python Playwright and Chromium (PLAYWRIGHT_BROWSERS_PATH, e.g. /opt/pw-browsers).
Uses 4 logins (the login limiter allows 5 per 15 minutes per server start).
Exit code 0 = every check passed.
"""
import json
import os
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import time
import urllib.request
from datetime import datetime, timedelta, timezone

from playwright.sync_api import sync_playwright

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else os.path.join(ROOT, 'screenshots')
PORT = int(os.environ.get('PORT', '3997'))
BASE = f'http://127.0.0.1:{PORT}'
COMPANY = 'Indriyan Beverages Pvt Ltd'

RESULTS = []
API_ERRORS = []
PAGE_ERRORS = []


def check(label, ok, detail=''):
    RESULTS.append((label, bool(ok), detail))
    print(f"  {'✓' if ok else '✗'} {label}{'' if ok else ' — ' + str(detail)}")


def ist_now():
    return datetime.now(timezone.utc) + timedelta(hours=5, minutes=30)


def main():
    if not os.path.exists(os.path.join(ROOT, 'frontend', 'dist', 'index.html')):
        sys.exit('frontend/dist is missing — run `npm run build` in frontend first')
    os.makedirs(OUT, exist_ok=True)
    work = tempfile.mkdtemp(prefix='loans-ui-')
    env = dict(os.environ, DATA_DIR=work, JWT_SECRET='ui-check-secret', PORT=str(PORT), NODE_ENV='production',
               ADMIN_PASSWORD='Admin@123', HR_PASSWORD='Indriyan@2025', FINANCE_PASSWORD='Finance@2025')
    log = open(os.path.join(work, 'server.log'), 'w')
    srv = subprocess.Popen(['node', os.path.join(ROOT, 'backend', 'server.js')], env=env, stdout=log, stderr=log)
    try:
        for _ in range(80):
            try:
                urllib.request.urlopen(f'{BASE}/api/version', timeout=1)
                break
            except Exception:
                time.sleep(0.5)
        else:
            sys.exit('server did not come up')
        db_path = os.path.join(work, 'hr_system.db')
        admin_loan_id = seed(db_path)
        try:
            run_browser(db_path, admin_loan_id)
        except Exception as e:  # report what we have, then fail
            check('browser run completed without an exception', False, repr(e)[:400])
    finally:
        srv.terminate()
        try:
            srv.wait(timeout=10)
        except Exception:
            srv.kill()
        log.close()
        shutil.rmtree(work, ignore_errors=True)

    failed = [r for r in RESULTS if not r[1]]
    print(f"\n{len(RESULTS) - len(failed)}/{len(RESULTS)} checks passed")
    print(f"uncaught page errors: {len(PAGE_ERRORS)}")
    for e in PAGE_ERRORS:
        print('   ', e)
    print(f"API responses >= 400: {len(API_ERRORS)}")
    for e in API_ERRORS:
        print('   ', e)
    sys.exit(1 if failed or PAGE_ERRORS else 0)


def seed(db_path):
    """Scratch DB only. Returns the id of the loan raised by 'admin'."""
    viewer_hash = subprocess.check_output(['node', '-e',
        f"process.stdout.write(require('{ROOT}/backend/node_modules/bcryptjs').hashSync('Viewer@2025', 10))"]).decode()
    con = sqlite3.connect(db_path, timeout=10)
    c = con.cursor()
    c.execute("INSERT INTO users (username, password_hash, role, is_active) VALUES ('viewer1', ?, 'viewer', 1)", (viewer_hash,))
    emps = [
        ('E101', 'Asha Verma', 'PRODUCTION', 'Permanent', 0, 30000, '2023-01-02'),
        ('E102', 'Bilal Khan', 'PACKING', 'Permanent', 0, 25000, '2022-05-10'),
        ('E103', 'Chand Singh', 'LOADING', 'Contract', 1, 15000, '2023-03-01'),
        ('E104', 'Deep Kaur', 'QC', 'Permanent', 0, 22000, None),
        ('E105', 'Esha Mehra', 'STORES', 'Permanent', 0, 20000, '2021-08-01'),
        ('E106', 'Farid Ali', 'UTILITY', 'Worker', 0, 18000, '2022-11-15'),
        ('E107', 'Gita Rani', 'PRODUCTION', 'SILP', 0, 21000, '2022-02-01'),
        ('E108', 'Harpal Gill', 'PACKING', 'Permanent', 0, 19000, '2020-07-01'),
        ('E109', 'Inder Pal', 'ADMIN', 'Permanent', 0, 26000, '2021-01-04'),
    ]
    for code, name, dept, et, contr, gross, doj in emps:
        c.execute("""INSERT INTO employees (code, name, department, company, status, employment_type, is_contractor, gross_salary, date_of_joining)
                     VALUES (?, ?, ?, ?, 'Active', ?, ?, ?, ?)""", (code, name, dept, COMPANY, et, contr, gross, doj))
    # 3 months of computed salary for E101: deductions ~40% of earned base → DEDUCTION_LOAD_HIGH.
    emp_id = c.execute("SELECT id FROM employees WHERE code = 'E101'").fetchone()[0]
    for m in (7, 8, 9):
        c.execute("""INSERT INTO salary_computations (employee_id, employee_code, month, year, company, gross_salary, gross_earned,
                       ot_pay, holiday_duty_pay, pf_employee, advance_recovery, total_deductions, net_salary)
                     VALUES (?, 'E101', ?, 2026, ?, 30000, 30000, 0, 0, 1800, 10200, 12000, 18000)""", (emp_id, m, COMPANY))
    # A loan raised by "admin" — impossible through the API (ADMIN_CANNOT_RAISE); shows the self-approval tooltip.
    c.execute("""INSERT INTO loans (borrower_type, employee_code, company, loan_type, principal_amount, interest_rate, tenure_months,
                   emi_amount, status, requested_by, request_reason)
                 VALUES ('plant', 'E109', ?, 'Personal', 12000, 0, 6, 2000, 'requested', 'admin', 'seeded: raised by the admin')""", (COMPANY,))
    lid = c.lastrowid
    gate = c.execute("SELECT value FROM policy_config WHERE key = 'loans_disbursement_enabled'").fetchone()
    con.commit()
    con.close()
    check("temp DB: disbursement gate starts at '0' (as production)", gate and gate[0] == '0', gate)
    return lid


def set_gate(db_path, value):
    con = sqlite3.connect(db_path, timeout=10)
    con.execute("UPDATE policy_config SET value = ? WHERE key = 'loans_disbursement_enabled'", (value,))
    con.commit()
    con.close()


def shot(page, name, full=False, element=None):
    """Waits out the page fade-in animation first. `element` = a test id to capture whole
    (the app scrolls inside <main>, so a full-page shot would not include it)."""
    page.wait_for_timeout(800)
    path = os.path.join(OUT, f'{name}.png')
    if element:
        # The app scrolls inside <main>; grow the viewport so the whole element shows.
        h = page.evaluate("() => (document.querySelector('main') || document.body).scrollHeight")
        page.set_viewport_size({'width': 1440, 'height': min(max(900, h + 120), 2600)})
        page.wait_for_timeout(400)
        page.get_by_test_id(element).screenshot(path=path)
        page.set_viewport_size({'width': 1440, 'height': 900})
    else:
        page.screenshot(path=path, full_page=full)
    return path


def login(browser, user, password):
    ctx = browser.new_context(viewport={'width': 1440, 'height': 900})
    page = ctx.new_page()
    page.on('pageerror', lambda e, u=user: PAGE_ERRORS.append(f'{u}: {e}'))
    page.on('response', lambda r, u=user: (r.status >= 400 and '/api/' in r.url)
            and API_ERRORS.append(f'{u}: {r.status} {r.request.method} {r.url.replace(BASE, "")}'))
    page.goto(f'{BASE}/login')
    page.get_by_placeholder('admin').fill(user)
    page.get_by_placeholder('••••••••').fill(password)
    page.get_by_role('button', name='Sign in').click()
    page.wait_for_url(lambda u: '/login' not in u, timeout=15000)
    check(f'{user}: real login through the login page', '/login' not in page.url, page.url)
    return page


def toast(page, text, timeout=10000):
    try:
        page.get_by_text(text, exact=False).first.wait_for(timeout=timeout)
        return True
    except Exception:
        return False


def raise_loan(page, code, loan_type, principal, tenure, reason, expect_eligible=True, screenshot=None):
    page.goto(f'{BASE}/loans?tab=loans')
    page.get_by_test_id('new-loan').click()
    page.get_by_test_id('loan-emp-search').fill(code)
    page.get_by_role('button', name=code).first.click()
    page.get_by_test_id('loan-company').select_option(COMPANY)
    page.get_by_test_id('loan-type').select_option(loan_type)
    page.get_by_test_id('loan-principal').fill(str(principal))
    page.get_by_test_id('loan-tenure').fill(str(tenure))
    panel = page.get_by_test_id('eligibility-panel')
    want = '✓ Eligible' if expect_eligible else '✗ Not eligible'
    panel.get_by_text(want).wait_for(timeout=10000)
    page.get_by_test_id('loan-reason').fill(reason)
    if screenshot:
        shot(page, screenshot)
    if not expect_eligible:
        return panel, None
    submit = page.get_by_test_id('loan-submit')
    submit.click()
    page.wait_for_url(lambda u: '/loans/' in u and '?' not in u, timeout=10000)
    return panel, int(page.url.rstrip('/').split('/')[-1])


def visible(page, testid, timeout=10000):
    try:
        page.get_by_test_id(testid).first.wait_for(timeout=timeout)
        return True
    except Exception:
        return False


def reason_confirm(page, text=None):
    m = page.get_by_test_id('reason-modal')
    m.wait_for()
    if text is not None:
        page.get_by_test_id('reason-input').fill(text)
    page.get_by_test_id('reason-confirm').click()
    m.wait_for(state='detached', timeout=10000)


def status_becomes(page, text, timeout=10000):
    try:
        page.get_by_test_id('loan-status').get_by_text(text).wait_for(timeout=timeout)
        return True
    except Exception:
        return False


def status_of(page):
    return page.get_by_test_id('loan-status').inner_text()


def run_browser(db_path, admin_loan_id):
    with sync_playwright() as p:
        browser = p.chromium.launch()
        hr = login(browser, 'hr', 'Indriyan@2025')
        admin = login(browser, 'admin', 'Admin@123')
        fin = login(browser, 'finance', 'Finance@2025')
        viewer = login(browser, 'viewer1', 'Viewer@2025')

        print('\n— Pass 1: disbursement gate OFF —')
        # HR: refusal shown in the panel, submit disabled.
        hr.goto(f'{BASE}/loans')
        check('hr: gate banner on the Loans page', visible(hr, 'gate-banner'))
        check('hr: "+ Request loan" shown', visible(hr, 'new-loan'))
        panel, _ = raise_loan(hr, 'E103', 'Personal', 10000, 5, 'test', expect_eligible=False, screenshot='request-refused-contract')
        check('hr: contract worker refused in the live panel', 'CONTRACT_NOT_ELIGIBLE' in panel.inner_text())
        check('hr: submit disabled while not eligible', hr.get_by_test_id('loan-submit').is_disabled())
        hr.keyboard.press('Escape')
        # E104 has no DOJ.
        panel, _ = raise_loan(hr, 'E104', 'Personal', 10000, 5, 'test', expect_eligible=False)
        check('hr: missing date of joining → SERVICE_UNKNOWN', 'SERVICE_UNKNOWN' in panel.inner_text())
        hr.keyboard.press('Escape')
        # Eligible with warnings + schedule preview from the engine.
        hr.goto(f'{BASE}/loans?tab=loans')
        hr.get_by_test_id('new-loan').click()
        hr.get_by_test_id('loan-emp-search').fill('E101')
        hr.get_by_role('button', name='E101').first.click()
        hr.get_by_test_id('loan-company').select_option(COMPANY)
        hr.get_by_test_id('loan-type').select_option('Personal')
        hr.get_by_test_id('loan-principal').fill('20000')
        hr.get_by_test_id('loan-tenure').fill('6')
        panel = hr.get_by_test_id('eligibility-panel')
        panel.get_by_text('✓ Eligible').wait_for(timeout=10000)
        txt = panel.inner_text()
        check('hr: eligible with DEDUCTION_LOAD_HIGH warning (3-month history)', 'DEDUCTION_LOAD_HIGH' in txt, txt)
        check('hr: engine schedule preview #1–#5 ₹3,334, #6 ₹3,330, total ₹20,000',
              all(f'#{i} ₹3,334' in txt for i in range(1, 6)) and '#6 ₹3,330' in txt and 'Total ₹20,000' in txt, txt)
        hr.get_by_test_id('loan-reason').fill('Medical bills for a family member')
        shot(hr, '01-request-form-eligibility')
        hr.get_by_test_id('loan-submit').click()
        hr.wait_for_url(lambda u: '/loans/' in u and '?' not in u, timeout=10000)
        l101 = int(hr.url.rstrip('/').split('/')[-1])
        check('hr: loan raised → detail page, status Requested', 'Requested' in status_of(hr))
        check('hr: no approve / disburse buttons on own loan', hr.get_by_test_id('approve-loan').count() == 0 and hr.get_by_test_id('disburse-loan').count() == 0)

        _, l102 = raise_loan(hr, 'E102', 'Emergency / medical', 30000, 6, 'Hospital admission')
        _, l107 = raise_loan(hr, 'E107', 'Personal', 10000, 5, 'House repair')
        _, l108 = raise_loan(hr, 'E108', 'Festival advance', 10000, 5, 'Festival')
        _, l106 = raise_loan(fin, 'E106', 'Education', 10000, 5, 'School fees')

        # Admin queue.
        admin.goto(f'{BASE}/loans')
        q = admin.get_by_test_id('approval-queue')
        q.wait_for()
        admin.get_by_test_id(f'review-loan-{l101}').wait_for()
        check('admin: lands on the approval queue when something waits', admin.url.endswith('/loans') or 'tab=queue' in admin.url)
        check('admin: no "+ Request loan" (ADMIN_CANNOT_RAISE)', admin.get_by_test_id('new-loan').count() == 0)
        first_row = q.locator('tbody').first.locator('tr').first.inner_text()
        check('admin: Emergency / medical request sits first, flagged URGENT', 'URGENT' in first_row and 'E102' in first_row, first_row)
        shot(admin, '02-admin-approval-queue')

        admin.goto(f'{BASE}/loans/{admin_loan_id}')
        btn = admin.get_by_test_id('approve-loan')
        btn.wait_for()
        check('admin: own request → Approve disabled', btn.is_disabled())
        check('admin: own request → tooltip says nobody approves their own', 'nobody approves their own request' in (btn.get_attribute('data-disabled-reason') or ''))

        admin.goto(f'{BASE}/loans/{l101}')
        admin.get_by_test_id('approval-panel').wait_for()
        ap = admin.get_by_test_id('approval-panel').inner_text()
        check('admin: approval panel shows 3 months of deductions and the load %', 'last 3 computed salary months' in ap and '40.0%' in ap, ap)
        shot(admin, '03-admin-loan-review', element='loan-detail')
        admin.get_by_test_id('approve-loan').click()
        reason_confirm(admin, 'ok')
        check('admin: E101 loan approved', status_becomes(admin, 'Approved'), status_of(admin))
        for lid in (l102, l107, l106):
            admin.goto(f'{BASE}/loans/{lid}')
            admin.get_by_test_id('approve-loan').click()
            reason_confirm(admin, '')
            check(f'admin: loan #{lid} approved', status_becomes(admin, 'Approved'), status_of(admin))
        admin.goto(f'{BASE}/loans/{l108}')
        admin.get_by_test_id('reject-loan').click()
        check('admin: reject needs a reason', admin.get_by_test_id('reason-confirm').is_disabled())
        reason_confirm(admin, 'Festival advance not needed this year')
        admin.get_by_test_id('loan-status').get_by_text('Rejected').wait_for()
        check('admin: E108 rejected with reason', 'Rejected' in status_of(admin))

        fin.goto(f'{BASE}/loans/{l101}')
        d = fin.get_by_test_id('disburse-loan')
        d.wait_for()
        check('finance: Disburse shown but disabled while the gate is off', d.is_disabled())
        check('finance: disabled reason names the gate', 'switched off' in (d.get_attribute('data-disabled-reason') or ''))
        check('finance: inline "Disbursement not available" note', fin.get_by_test_id('disburse-blocked').is_visible())
        shot(fin, '04-disburse-disabled-gate-off')
        fin.goto(f'{BASE}/loans')
        check('finance: gate banner on the Loans page', visible(fin, 'gate-banner'))
        shot(fin, 'loans-page-gate-banner')

        hr.goto(f'{BASE}/loans/{l101}')
        hr.get_by_test_id('loan-detail').wait_for()
        check('hr: no Disburse button at all (server refuses hr)', hr.get_by_test_id('disburse-loan').count() == 0)

        print('\n— Pass 2: gate ON (temp DB only) —')
        set_gate(db_path, '1')
        today = ist_now()
        first_prev = (today.replace(day=1) - timedelta(days=1)).replace(day=15).strftime('%Y-%m-%d')
        fin.goto(f'{BASE}/loans/{l101}')
        d = fin.get_by_test_id('disburse-loan')
        d.wait_for()
        check('finance: Disburse enabled once the gate is on', d.is_enabled())
        d.click()
        fin.get_by_test_id('payout-mode').select_option('Bank transfer')
        fin.get_by_test_id('payout-reference').fill('UTR-TEST-0001')
        fin.get_by_test_id('payout-date').fill(first_prev)
        fin.get_by_test_id('payout-agreement').fill('DMS-2026-0042')
        shot(fin, 'disburse-modal')
        fin.get_by_test_id('disburse-confirm').click()
        fin.get_by_test_id('loan-status').get_by_text('Active').wait_for(timeout=10000)
        rows = fin.get_by_test_id('schedule').locator('tbody tr').count()
        check('finance: disbursed → Active with 6 scheduled instalments', rows == 6, rows)
        check('finance: reconciliation badge says it reconciles', 'Reconciles' in fin.get_by_test_id('reconciliation').inner_text())

        fin.get_by_test_id('receipt-loan').click()
        fin.get_by_test_id('receipt-amount').fill('5000')
        fin.get_by_test_id('receipt-mode').select_option('Cash')
        fin.get_by_test_id('receipt-confirm').click()
        check('finance: receipt numbered LR/<FY>/00001', toast(fin, 'Receipt LR/'))
        fin.get_by_test_id('receipts').wait_for()
        check('finance: balance ₹15,000 after a ₹5,000 receipt', '₹15,000' in fin.get_by_test_id('reconciliation').inner_text())
        fin.wait_for_timeout(4500)  # let the disbursement toast clear
        shot(fin, '05-receipt-recorded', element='loan-detail')

        # Due this month (first EMI = this month: disbursed on the 15th of last month).
        admin.goto(f'{BASE}/loans?tab=due')
        due = admin.get_by_test_id('due-this-month')
        due.get_by_text('Asha Verma').first.wait_for(timeout=10000)
        check('admin: due-this-month lists the E101 instalment by name', 'Asha Verma' in due.inner_text())
        shot(admin, '07-due-this-month')

        fin.goto(f'{BASE}/loans/{l106}')
        d = fin.get_by_test_id('disburse-loan')
        d.wait_for()
        check('finance: own loan → Disburse disabled (SELF_DISBURSEMENT)', d.is_disabled() and 'You requested this loan' in (d.get_attribute('data-disabled-reason') or ''))

        # Defer: HR raises, admin approves in the queue.
        hr.goto(f'{BASE}/loans/{l101}')
        hr.get_by_test_id('change-loan').click()
        hr.get_by_test_id('change-instalment').select_option(index=1)
        hr.get_by_test_id('change-reason').fill('Employee on unpaid leave this month')
        hr.get_by_test_id('change-submit').click()
        check('hr: defer request sent', toast(hr, 'Defer request #'))
        admin.goto(f'{BASE}/loans?tab=queue')
        approve = admin.locator('[data-testid^="approve-change-"]').first
        approve.wait_for()
        approve.click()
        reason_confirm(admin, '')
        check('admin: defer approved in the queue', toast(admin, 'approved'))
        admin.goto(f'{BASE}/loans/{l101}')
        sched = admin.get_by_test_id('schedule').inner_text()
        check('admin: schedule now shows a Deferred instalment', 'Deferred' in sched, sched)

        # Restructure: HR raises, then withdraws it.
        hr.goto(f'{BASE}/loans/{l101}')
        hr.get_by_test_id('change-loan').click()
        hr.get_by_test_id('change-kind-restructure').click()
        hr.get_by_test_id('change-tenure').fill('4')
        hr.get_by_test_id('change-reason').fill('Shorter tenure requested')
        hr.get_by_test_id('change-submit').click()
        check('hr: restructure request sent', toast(hr, 'Restructure request #'))
        hr.goto(f'{BASE}/loans?tab=queue')
        w = hr.locator('[data-testid^="withdraw-change-"]').first
        w.wait_for()
        check('hr: no Approve / Reject in the queue', hr.locator('[data-testid^="approve-change-"]').count() == 0)
        w.click()
        reason_confirm(hr, '')
        check('hr: own restructure request withdrawn', toast(hr, 'withdrawn'))

        # Write-off: HR raises, admin rejects.
        hr.goto(f'{BASE}/loans/{l101}')
        hr.get_by_test_id('change-loan').click()
        hr.get_by_test_id('change-kind-write_off').click()
        hr.get_by_test_id('change-reason').fill('Testing a write-off request')
        hr.get_by_test_id('change-submit').click()
        check('hr: write-off request sent', toast(hr, 'Write-off request #'))
        admin.goto(f'{BASE}/loans?tab=queue')
        rej = admin.locator('[data-testid^="reject-change-"]').first
        rej.wait_for()
        rej.click()
        reason_confirm(admin, 'Borrower is still employed and repaying')
        check('admin: write-off request rejected', toast(admin, 'rejected'))

        # Cancel an approved, undisbursed loan.
        admin.goto(f'{BASE}/loans/{l107}')
        admin.get_by_test_id('cancel-loan').click()
        reason_confirm(admin, 'Employee no longer needs it')
        admin.get_by_test_id('loan-status').get_by_text('cancelled').wait_for()
        check('admin: approved loan cancelled (shows Rejected (cancelled))', 'cancelled' in status_of(admin))

        # Settings.
        admin.goto(f'{BASE}/loans?tab=settings')
        admin.get_by_test_id('policy-edit').click()
        admin.get_by_test_id('policy-input-loan_close_day').fill('14')
        admin.get_by_test_id('policy-reason').fill('Payroll now paid by the 11th')
        admin.get_by_test_id('policy-save').click()
        check('admin: one policy key changed with a reason', toast(admin, '1 setting changed'))
        check('admin: gate shown read-only (ON in this temp DB)', 'Disbursement: ON' in admin.get_by_test_id('gate-readonly').inner_text())
        check('admin: no input for the gate key', admin.get_by_test_id('policy-input-loans_disbursement_enabled').count() == 0)
        admin.wait_for_timeout(4500)
        shot(admin, '06-loan-settings-admin', element='loan-policy')

        # Statement.
        admin.goto(f'{BASE}/loans/{l101}')
        with admin.expect_popup() as pop:
            admin.get_by_test_id('print-statement').click()
        st = pop.value
        st.wait_for_load_state()
        st_txt = st.inner_text('body')
        check('statement: opens a print window with month rows and the closing balance',
              'Loan statement' in st_txt and 'Closing balance' in st_txt and '₹15,000' in st_txt, st_txt[:400])
        check('statement: no bank / PAN fields', 'IFSC' not in st_txt and 'PAN' not in st_txt)
        st.set_viewport_size({'width': 1000, 'height': 620})
        shot(st, '08-statement-print')

        # Employees → Loans tab and Mark Left text.
        hr.goto(f'{BASE}/employees')
        hr.get_by_placeholder('Search by name or code...').fill('E101')
        hr.get_by_role('button', name='Profile').first.click()
        hr.get_by_role('button', name='Loans', exact=True).click()
        tab = hr.get_by_test_id('employee-loans')
        tab.wait_for()
        t = tab.inner_text()
        check('employees tab: loan listed with Active badge and balance', 'Active' in t and '₹15,000' in t, t)
        shot(hr, '09-employees-loans-tab')
        hr.keyboard.press('Escape')
        hr.goto(f'{BASE}/employees')
        hr.get_by_placeholder('Search by name or code...').fill('E105')
        hr.get_by_role('button', name='Mark Left').first.click()
        ml = hr.get_by_text('Open loans will be flagged for recovery from the final salary; nothing is closed.')
        check('Mark Left dialog: corrected loan text', ml.count() == 1)
        check('Mark Left dialog: stale "close all active loans" text gone', hr.get_by_text('close all active loans').count() == 0)
        shot(hr, 'mark-left-dialog')

        # Viewer: everything readable, nothing actionable.
        viewer.goto(f'{BASE}/loans?tab=loans')
        viewer.get_by_test_id('loan-list').wait_for()
        check('viewer: loan list renders', viewer.get_by_test_id(f'loan-row-{l101}').is_visible())
        check('viewer: no "+ Request loan"', viewer.get_by_test_id('new-loan').count() == 0)
        viewer.goto(f'{BASE}/loans/{l101}')
        viewer.get_by_test_id('loan-detail').wait_for()
        none = all(viewer.get_by_test_id(t).count() == 0 for t in
                   ('approve-loan', 'reject-loan', 'disburse-loan', 'cancel-loan', 'receipt-loan', 'change-loan'))
        check('viewer: no action buttons on the detail page', none)
        check('viewer: can still print the statement', viewer.get_by_test_id('print-statement').is_visible())
        viewer.goto(f'{BASE}/loans?tab=settings')
        viewer.get_by_test_id('loan-policy').wait_for()
        check('viewer: settings read-only', viewer.get_by_test_id('policy-edit').count() == 0)
        viewer.goto(f'{BASE}/loans?tab=queue')
        viewer.get_by_test_id('approval-queue').wait_for()
        check('viewer: queue has no approve / reject / withdraw',
              viewer.locator('[data-testid^="approve-change-"], [data-testid^="reject-change-"], [data-testid^="withdraw-change-"]').count() == 0)

        # Sidebar: admin badge.
        admin.goto(f'{BASE}/loans?tab=loans')
        admin.get_by_role('button', name='Payroll').first.click()
        link = admin.locator('a[href="/loans"]')
        link.wait_for()
        try:
            link.locator('span[title*="waiting for approval"]').wait_for(timeout=10000)
        except Exception:
            pass
        check('sidebar: admin Loans entry carries the waiting count (1: the admin-raised loan)',
              link.inner_text().strip().endswith('1'), link.inner_text())
        hr.goto(f'{BASE}/loans')
        hr.get_by_role('button', name='Payroll').first.click()
        hr.locator('a[href="/loans"]').wait_for()
        hr.wait_for_timeout(1500)
        check('sidebar: no waiting count for hr', hr.locator('a[href="/loans"] span[title*="waiting"]').count() == 0)

        browser.close()


if __name__ == '__main__':
    main()
