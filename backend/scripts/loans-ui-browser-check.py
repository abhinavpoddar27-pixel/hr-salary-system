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
  * Pass 3 (Loans PR-6b) — the monthly loan close and the admin reversal. Seeded AFTER
    boot (the start-up catch-up would otherwise close the months first): 3 borrowers
    disbursed in Jun 2026 through the engine, a REAL Stage 7 run for Jul 2026, then one
    salary held and one payslip that no longer matches the ledger. Readiness codes,
    close by finance (201), a stale second tab (409), history notes, hr / viewer
    read-only, a company-restricted finance user, the admin reversal on the loan page,
    and the Mark Left dialog's outstanding. Screens go to <screenshot_dir>/pr6b/.
  * Pass 4 (Loans PR-8) — sales borrowers. Seeds 3 sales reps, two with sales loans
    (disbursed 15 Jun 2026 → first EMI the Jul 2026 sales cycle), runs the sales
    Stage 7 for Jul 2026 and posts one rep's deduction. Then: the request form's one
    search across both masters (Plant / Sales tags, a plant row typed Sales left out),
    a sales loan raised through the form with the company locked, the Loans list
    "Sales" tag, and the sales register's Loan column with Hold disabled on the row
    whose loan is posted. Screens go to <screenshot_dir>/pr8/.
  * Pass 5 (Loans PR-9) — reports, payslip balance line, sales close. No new login (the
    limiter's 5 are used): the Reports tab's six views, the outstanding total against the
    Loans tile and the ledger, an Excel download per view, the perquisite threshold label;
    the Stage 7 payslip modal shows the balance line for a borrower and NOT for a
    non-borrower (seeded); the sales payslip page likewise; the close tab's Plant / Sales
    toggle — sales readiness, a sales close by finance (201), the history row, hr read-only.
    Screens go to <screenshot_dir>/pr9/.
  * Pass 6 (Loans PR-11) — the admin dry run. Seeds two Aug 2026 plant employees with a
    stored Stage 7 (Aug imports stamped done), then on the Dry run tab: hidden for hr; two
    scenarios (one with Hold), the green "nothing was saved" banner, the stale note, the
    per-employee table, the close line, JSON + Excel exports, the rehearsal pack (two
    reports). After every run an INDEPENDENT hash of every table must equal the one taken
    before (except exactly one new 'loan_dry_run' audit row). Screens go to <screenshot_dir>/pr11/.

Usage:  python3 backend/scripts/loans-ui-browser-check.py [screenshot_dir]
Needs Python Playwright and Chromium (PLAYWRIGHT_BROWSERS_PATH, e.g. /opt/pw-browsers).
Uses 5 logins (the login limiter allows 5 per 15 minutes per server start).
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
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

from playwright.sync_api import sync_playwright

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else os.path.join(ROOT, 'screenshots')
OUT6B = os.path.join(OUT, 'pr6b')
OUT8 = os.path.join(OUT, 'pr8')
OUT9 = os.path.join(OUT, 'pr9')
OUT11 = os.path.join(OUT, 'pr11')
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
    utc = datetime.now(timezone.utc)
    if abs((utc.hour * 60 + utc.minute) - 45) < 10:
        sys.exit('within 10 minutes of the daily loan job (00:45 UTC = 06:15 IST) — run it a little later')
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


def shot(page, name, full=False, element=None, out=None):
    """Waits out the page fade-in animation first. `element` = a test id to capture whole
    (the app scrolls inside <main>, so a full-page shot would not include it)."""
    page.wait_for_timeout(800)
    os.makedirs(out or OUT, exist_ok=True)
    path = os.path.join(out or OUT, f'{name}.png')
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

        run_close_pass(browser, db_path, hr, admin, fin, viewer)
        run_sales_pass(db_path, hr)
        run_reports_pass(db_path, hr, admin, fin, viewer)
        run_dry_run_pass(db_path, hr, admin)

        browser.close()


# ── Pass 3 (Loans PR-6b): the monthly loan close ────────────────────────────

SEED_CLOSE_JS = r"""
// Scratch DB only. argv: ROOT DB_PATH. Writes through the loan engine and a REAL Stage 7 run.
const [ROOT, DB] = process.argv.slice(2);
const Database = require(`${ROOT}/backend/node_modules/better-sqlite3`);
const db = new Database(DB);
db.pragma('busy_timeout = 10000');
const L = require(`${ROOT}/backend/src/services/loans`);
const { recomputeSalary } = require(`${ROOT}/backend/src/services/recompute`);
const COMPANY = 'Indriyan Beverages Pvt Ltd';
const out = {};
const quiet = (fn) => { const l = console.log; const w = console.warn; console.log = () => {}; console.warn = () => {}; try { return fn(); } finally { console.log = l; console.warn = w; } };
for (const [code, name] of [['E110', 'Jaspreet Sandhu'], ['E111', 'Kiran Bala'], ['E112', 'Lakhvir Dhillon']]) {
  db.prepare(`INSERT INTO employees (code, name, department, company, status, employment_type, is_contractor, gross_salary, date_of_joining)
              VALUES (?, ?, 'PRODUCTION', ?, 'Active', 'Permanent', 0, 24000, '2020-04-01')`).run(code, name, COMPANY);
  const r = L.requestLoan(db, { borrowerType: 'plant', employeeCode: code, company: COMPANY, loanType: 'Personal', principal: 12000, tenure: 4, reason: 'UI check: close month' }, { username: 'hr', role: 'hr' }, { asOf: '2026-06-10' });
  if (!r.ok) throw new Error(`request ${code}: ${r.code} ${r.message}`);
  const a = L.approveLoan(db, r.loanId, { username: 'admin', role: 'admin' }, { asOf: '2026-06-10' });
  if (!a.ok) throw new Error(`approve ${code}: ${a.code}`);
  const d = L.disburseLoan(db, r.loanId, { username: 'finance', role: 'finance' }, { mode: 'Bank transfer', reference: `UTR-${code}`, disbursedOn: '2026-06-15', agreementFilePath: `DMS-${code}` }, { asOf: '2026-06-20' });
  if (!d.ok) throw new Error(`disburse ${code}: ${d.code} ${d.message}`);
  out[code] = r.loanId;
  db.prepare(`INSERT INTO day_calculations (employee_code, month, year, company, days_present, total_payable_days) VALUES (?, 7, 2026, ?, 27, 27)`).run(code, COMPANY);
  // Present at month end, so the end-of-month absence rule does not hold the salary.
  const ins = db.prepare("INSERT OR IGNORE INTO attendance_processed (employee_code, date, status_original, status_final, company, month, year) VALUES (?, ?, 'P', 'P', ?, 7, 2026)");
  for (let day = 24; day <= 31; day++) ins.run(code, `2026-07-${day}`, COMPANY);
}
quiet(() => recomputeSalary(db, { month: 7, year: 2026, company: COMPANY, requestId: 'ui-check' }));
// E111: salary on hold. E112: the payslip no longer agrees with the loan ledger.
db.prepare("UPDATE salary_computations SET salary_held = 1, hold_reason = 'UI check: held' WHERE employee_code = 'E111' AND month = 7 AND year = 2026").run();
db.prepare("UPDATE salary_computations SET loan_recovery = loan_recovery - 500 WHERE employee_code = 'E112' AND month = 7 AND year = 2026").run();
// Aug 2026: the attendance file is imported but Stage 7 has not run yet.
db.prepare("INSERT INTO monthly_imports (month, year, file_name, company, stage_1_done) VALUES (8, 2026, 'ui-check-aug.xls', ?, 1)").run(COMPANY);
out.provisional = db.prepare("SELECT id, employee_code, amount FROM loan_deductions WHERE month = 7 AND year = 2026 AND state = 'provisional' ORDER BY employee_code").all();
const restrictedHash = require(`${ROOT}/backend/node_modules/bcryptjs`).hashSync('Asian@2025', 10);
db.prepare("INSERT INTO users (username, password_hash, role, is_active, allowed_companies) VALUES ('finasian', ?, 'finance', 1, 'Asian Lakto Ind Ltd')").run(restrictedHash);
process.stdout.write(JSON.stringify(out));
"""


def seed_close_month(db_path):
    js = os.path.join(os.path.dirname(db_path), 'seed-close.js')
    with open(js, 'w') as f:
        f.write(SEED_CLOSE_JS)
    return json.loads(subprocess.check_output(['node', js, ROOT, db_path]).decode())


def pick_month(page, month, year, code, timeout=10000):
    """Sets the close screen's month picker; True once the readiness panel shows `code`."""
    page.get_by_test_id('close-year').select_option(str(year))
    page.get_by_test_id('close-month').select_option(str(month))
    return readiness_is(page, code, timeout)


def readiness_is(page, code, timeout=10000):
    try:
        page.locator(f'[data-testid="close-readiness"][data-code="{code}"]').wait_for(timeout=timeout)
        return True
    except Exception:
        return False


def tile(page, testid):
    return page.get_by_test_id(testid).inner_text()


def run_close_pass(browser, db_path, hr, admin, fin, viewer):
    print('\n— Pass 3: monthly loan close (Loans PR-6b) —')
    seeded = seed_close_month(db_path)
    prov = {r['employee_code']: r for r in seeded['provisional']}
    check('seed: a real Stage 7 run for Jul 2026 left 3 provisional ₹3,000 deductions',
          sorted(prov) == ['E110', 'E111', 'E112'] and all(r['amount'] == 3000 for r in prov.values()), seeded)
    l110, l111 = seeded['E110'], seeded['E111']
    d110 = prov['E110']['id']

    # Finance: readiness codes.
    fin.goto(f'{BASE}/loans?tab=close')
    fin.get_by_test_id('loan-close').wait_for()
    check('finance: "Monthly close" tab with the 06:15 IST automatic-close note',
          '06:15 IST' in fin.get_by_test_id('close-auto-note').inner_text())
    check('finance: Jan 2026 → NOT_NEEDED in plain English',
          pick_month(fin, 1, 2026, 'NOT_NEEDED') and 'Nothing to close for Jan 2026' in fin.get_by_test_id('close-readiness').inner_text())
    check('finance: Oct 2026 → MONTH_NOT_ENDED', pick_month(fin, 10, 2026, 'MONTH_NOT_ENDED')
          and 'has not ended yet' in fin.get_by_test_id('close-readiness').inner_text())
    shot(fin, 'close-month-not-ended', element='loan-close', out=OUT6B)
    check('finance: Aug 2026 → EARLIER_MONTH_OPEN with a link to Jul', pick_month(fin, 8, 2026, 'EARLIER_MONTH_OPEN')
          and visible(fin, 'close-earlier-7-2026'))
    check('finance: Close disabled while an earlier month is open', fin.get_by_test_id('close-run').is_disabled())
    shot(fin, 'close-earlier-month-open', element='loan-close', out=OUT6B)
    fin.get_by_test_id('close-earlier-7-2026').click()
    check('finance: the link switches to Jul 2026, ready to close', readiness_is(fin, 'READY'))
    check('finance: would post 1 (₹3,000) — E111 held, E112 mismatched',
          '1' in tile(fin, 'close-tile-post') and '₹3,000' in tile(fin, 'close-tile-post'), tile(fin, 'close-tile-post'))
    check('finance: held 1', tile(fin, 'close-tile-held').split('\n')[1].strip() == '1', tile(fin, 'close-tile-held'))
    check('finance: provisional 3 (₹9,000)', '3' in tile(fin, 'close-tile-provisional') and '₹9,000' in tile(fin, 'close-tile-provisional'))
    check('finance: due this month 3', tile(fin, 'close-tile-due').split('\n')[1].strip() == '3', tile(fin, 'close-tile-due'))
    mm = fin.get_by_test_id('close-mismatches').inner_text()
    check('finance: mismatch table names E112 (payslip ₹2,500, ledger ₹3,000)', 'E112' in mm and '₹2,500' in mm and '₹3,000' in mm, mm)
    check('finance: Close enabled', fin.get_by_test_id('close-run').is_enabled())
    shot(fin, '01-close-preview-ready', element='loan-close', out=OUT6B)

    # A second finance tab holding the same (soon stale) preview → 409 later.
    fin2 = fin.context.new_page()
    fin2.on('pageerror', lambda e: PAGE_ERRORS.append(f'finance tab 2: {e}'))
    fin2.goto(f'{BASE}/loans?tab=close')
    fin2.get_by_test_id('loan-close').wait_for()
    pick_month(fin2, 7, 2026, 'READY')

    fin.get_by_test_id('close-run').click()
    conf = fin.get_by_test_id('close-confirm')
    conf.wait_for()
    ct = conf.inner_text()
    check('finance: confirm dialog spells out post / held / mismatch',
          'Posts 1 deduction totalling ₹3,000' in ct and '1 held salary stays provisional' in ct and 'Payslip and ledger disagree for 1 employee' in ct, ct)
    shot(fin, '02-close-confirm', out=OUT6B)
    fin.get_by_test_id('close-confirm-run').click()
    check('finance: close → 201 toast "Closed Jul 2026: posted 1 (₹3,000)"', toast(fin, 'Closed Jul 2026: posted 1 (₹3,000)'))
    check('finance: Jul 2026 now ALREADY_CLOSED, by finance (Manual)', readiness_is(fin, 'ALREADY_CLOSED')
          and 'by finance (Manual)' in fin.get_by_test_id('close-done').inner_text())
    check('finance: still waiting for the sweep — held 1, mismatch 1',
          tile(fin, 'close-tile-held').split('\n')[1].strip() == '1' and tile(fin, 'close-tile-mismatch').split('\n')[1].strip() == '1')
    row = fin.get_by_test_id('close-row-7-2026')
    row.wait_for()
    check('finance: history row for Jul 2026 (posted 1 · ₹3,000, held 1)', '1 · ₹3,000' in row.inner_text(), row.inner_text())
    fin.locator('[data-testid^="close-notes-"]').first.click()
    notes = fin.locator('[data-testid^="close-notes-body-"]').first.inner_text()
    check('finance: history notes list the held E111 and mismatched E112', 'E111' in notes and 'E112' in notes, notes)
    fin.wait_for_timeout(5000)  # let the toasts clear
    shot(fin, '03-close-done-history', element='loan-close', out=OUT6B)

    fin2.get_by_test_id('close-run').click()
    fin2.get_by_test_id('close-confirm-run').click()
    check('finance (stale tab): second close → 409 shown as "already closed"', toast(fin2, 'was closed on'))
    check('finance (stale tab): refreshes to ALREADY_CLOSED', readiness_is(fin2, 'ALREADY_CLOSED'))
    fin2.close()

    check('finance: Aug 2026 (imported, Stage 7 not run) → STAGE7_NOT_COMPUTED once Jul is closed', pick_month(fin, 8, 2026, 'STAGE7_NOT_COMPUTED')
          and 'not computed yet' in fin.get_by_test_id('close-readiness').inner_text())
    shot(fin, 'close-stage7-not-computed', element='loan-close', out=OUT6B)

    # HR and viewer: read-only.
    for who, page in (('hr', hr), ('viewer', viewer)):
        page.goto(f'{BASE}/loans?tab=close')
        page.get_by_test_id('loan-close').wait_for()
        ok = pick_month(page, 7, 2026, 'ALREADY_CLOSED')
        check(f'{who}: close screen readable, no Close button', ok and page.get_by_test_id('close-run').count() == 0
              and visible(page, 'close-readonly'))
        if who == 'hr':
            shot(page, '04-close-hr-read-only', element='loan-close', out=OUT6B)

    # Company-restricted finance user (5th login).
    ra = login(browser, 'finasian', 'Asian@2025')
    ra.goto(f'{BASE}/loans?tab=close')
    ra.get_by_test_id('loan-close').wait_for()
    check('restricted finance: explains the close covers both companies, no Close button',
          visible(ra, 'close-restricted') and ra.get_by_test_id('close-run').count() == 0)
    check('restricted finance: history still readable', visible(ra, 'close-row-7-2026'))
    shot(ra, '05-close-company-restricted', element='loan-close', out=OUT6B)

    # Admin reversal on the loan page.
    fin.goto(f'{BASE}/loans/{l110}')
    fin.get_by_test_id('deductions').wait_for()
    check('finance: deductions listed, no Reverse button (admin only)', fin.locator('[data-testid^="reverse-"]').count() == 0)
    admin.goto(f'{BASE}/loans/{l111}')
    admin.get_by_test_id('deductions').wait_for()
    check('admin: a provisional (held) deduction has no Reverse button', admin.locator('[data-testid^="reverse-"]').count() == 0)
    admin.goto(f'{BASE}/loans/{l110}')
    rb = admin.get_by_test_id(f'reverse-{d110}')
    rb.wait_for()
    dt = admin.get_by_test_id('deductions').inner_text()
    check('admin: Jul 2026 deduction posted ₹3,000, standing ₹3,000, Reverse enabled', 'Posted' in dt and '₹3,000' in dt and rb.is_enabled(), dt)
    rb.click()
    admin.get_by_test_id('reason-input').fill('short')
    check('admin: reason under 10 characters → confirm disabled', admin.get_by_test_id('reason-confirm').is_disabled()
          and '5 / 10' in admin.get_by_test_id('reason-length').inner_text())
    admin.get_by_test_id('reason-input').fill('July salary was not actually paid')
    shot(admin, '06-reverse-modal', out=OUT6B)
    admin.get_by_test_id('reason-confirm').click()
    check('admin: reversal toast tells to re-run Stage 7', toast(admin, 'reversed — re-run Stage 7 for E110 Jul 2026'))
    admin.get_by_test_id('adjustments').wait_for()
    at = admin.get_by_test_id('adjustments').inner_text()
    check('admin: opposite entry listed (Admin reversal, ₹3,000, by admin, back as #5)',
          'Admin reversal' in at and '₹3,000' in at and 'admin' in at and '#5' in at, at)
    sched = admin.get_by_test_id('schedule').inner_text()
    check('admin: schedule gains a "Reversal" instalment', 'Reversal' in sched, sched)
    rec = admin.get_by_test_id('reconciliation').inner_text()
    check('admin: still reconciles, with opposite entries ₹3,000 in the formula', 'Reconciles' in rec and 'opposite entries ₹3,000' in rec, rec)
    rb = admin.get_by_test_id(f'reverse-{d110}')
    check('admin: Reverse now disabled — already reversed in full', rb.is_disabled()
          and 'Already reversed in full' in (rb.get_attribute('data-disabled-reason') or ''))
    admin.wait_for_timeout(4500)
    shot(admin, '07-loan-detail-after-reversal', element='loan-detail', out=OUT6B)

    # Mark Left dialog: the leaver's outstanding.
    hr.goto(f'{BASE}/employees')
    hr.get_by_placeholder('Search by name or code...').fill('E110')
    hr.get_by_role('button', name='Mark Left').first.click()
    ml = hr.get_by_test_id('markleft-loans')
    ml.wait_for()
    hr.locator('[data-testid="markleft-loans"][data-state="loans"]').wait_for(timeout=10000)
    mt = ml.inner_text()
    check('Mark Left: E110 loan and outstanding ₹12,000 shown', 'Outstanding loan balance: ₹12,000' in mt, mt)
    check('Mark Left: final-payroll / receipt / write-off wording',
          'falls due from the final monthly payroll; any remainder is settled by cash receipt or an admin-approved write-off' in mt, mt)
    check('Mark Left: exit-month warning line', 'Mark Left in the exit month' in mt and 'residual for finance to collect in cash or write off' in mt, mt)
    shot(hr, '08-mark-left-outstanding', out=OUT6B)
    hr.get_by_role('button', name='Cancel', exact=True).last.click()
    hr.goto(f'{BASE}/employees')
    hr.get_by_placeholder('Search by name or code...').fill('E105')
    hr.get_by_role('button', name='Mark Left').first.click()
    hr.locator('[data-testid="markleft-loans"][data-state="none"]').wait_for(timeout=10000)
    check('Mark Left: a non-borrower shows "No open loans."', 'No open loans.' in hr.get_by_test_id('markleft-loans').inner_text())
    hr.get_by_role('button', name='Cancel', exact=True).last.click()



# ── Pass 4 (Loans PR-8): sales borrowers ────────────────────────────────────

SEED_SALES_JS = r"""
// Scratch DB only. argv: ROOT DB_PATH. Sales reps, loans through the engine, a sales Stage 7 for Jul 2026.
const [ROOT, DB] = process.argv.slice(2);
const Database = require(`${ROOT}/backend/node_modules/better-sqlite3`);
const db = new Database(DB);
db.pragma('busy_timeout = 10000');
const S = require(`${ROOT}/backend/src/__tests__/helpers/salesLoanFixture`);
const L = require(`${ROOT}/backend/src/services/loans`);
const COMPANY = 'Indriyan Beverages Pvt Ltd';
const out = {};
S.addRep(db, { code: 'S901', name: 'Mona Brar', gross: 24000 });
S.addRep(db, { code: 'S902', name: 'Navdeep Toor', gross: 24000 });
S.addRep(db, { code: 'S903', name: 'Ojas Bedi', gross: 24000 });
db.prepare(`INSERT INTO employees (code, name, department, company, status, employment_type, is_contractor, gross_salary, date_of_joining)
            VALUES ('E120', 'Ojas Salestyped', 'SALES', ?, 'Active', 'Sales', 0, 20000, '2020-01-01')`).run(COMPANY);
for (const code of ['S901', 'S902']) out[code] = S.salesLoan(db, { code, principal: 9000, tenure: 3, disbursedOn: '2026-06-15', asOf: '2026-06-20' });
S.setUpload(db, { month: 7, year: 2026, rows: [{ code: 'S901', days: 31 }, { code: 'S902', days: 31 }, { code: 'S903', days: 31 }] });
S.computeSalesMonth(db, { month: 7, year: 2026, runId: 'ui-check-sales' });
const d = db.prepare("SELECT id FROM loan_deductions WHERE payroll = 'sales' AND employee_code = 'S901' AND month = 7 AND year = 2026").get();
const p = L.postDeduction(db, { deductionId: d.id }, { username: 'system', role: 'system' });
if (!p.ok) throw new Error(`post: ${p.code}`);
out.rows = db.prepare("SELECT employee_code, loan_recovery FROM sales_salary_computations WHERE month = 7 AND year = 2026 ORDER BY employee_code").all();
process.stdout.write(JSON.stringify(out));
"""


def run_sales_pass(db_path, hr):
    print('\n— Pass 4: sales borrowers (Loans PR-8) —')
    js = os.path.join(os.path.dirname(db_path), 'seed-sales.js')
    with open(js, 'w') as f:
        f.write(SEED_SALES_JS)
    seeded = json.loads(subprocess.check_output(['node', js, ROOT, db_path]).decode())
    rows = {r['employee_code']: r['loan_recovery'] for r in seeded['rows']}
    check('seed: sales Stage 7 Jul 2026 deducted ₹3,000 for S901 and S902, ₹0 for S903',
          rows == {'S901': 3000, 'S902': 3000, 'S903': 0}, seeded)

    # Request form: one search across both masters.
    hr.goto(f'{BASE}/loans?tab=loans')
    hr.get_by_test_id('new-loan').click()
    hr.get_by_test_id('loan-emp-search').fill('Ojas')
    hr.get_by_test_id('loan-emp-result').first.wait_for(timeout=10000)
    res = [hr.get_by_test_id('loan-emp-result').nth(i).inner_text() for i in range(hr.get_by_test_id('loan-emp-result').count())]
    check('request form: search finds the sales rep, tagged Sales', any('Sales' in r and 'S903' in r for r in res), res)
    check('request form: a plant row typed Sales is left out of the search', not any('E120' in r for r in res), res)
    hr.get_by_test_id('loan-emp-search').fill('Asha')
    plant_row = hr.get_by_test_id('loan-emp-result').filter(has_text='E101')
    try:
        plant_row.first.wait_for(timeout=10000)   # the 300 ms debounce: wait for the new results
        txt = plant_row.first.inner_text()
    except Exception:
        txt = ''
    check('request form: plant employees still found, tagged Plant', 'Plant' in txt, txt)
    hr.get_by_test_id('loan-emp-search').fill('S903')
    hr.get_by_role('button', name='S903').first.click()
    company = hr.get_by_test_id('loan-company')
    check('request form: sales borrower → company locked to the sales-master company',
          company.is_disabled() and company.input_value() == COMPANY, company.input_value())
    hr.get_by_test_id('loan-type').select_option('Personal')
    hr.get_by_test_id('loan-principal').fill('6000')
    hr.get_by_test_id('loan-tenure').fill('3')
    panel = hr.get_by_test_id('eligibility-panel')
    ok = True
    try:
        panel.get_by_text('✓ Eligible').wait_for(timeout=10000)
    except Exception:
        ok = False
    check('request form: sales borrower eligible (engine verdict)', ok, panel.inner_text())
    hr.get_by_test_id('loan-reason').fill('UI check: sales loan')
    shot(hr, '01-request-sales-borrower', out=OUT8)
    hr.get_by_test_id('loan-submit').click()
    hr.wait_for_url(lambda u: '/loans/' in u and '?' not in u, timeout=10000)
    new_id = int(hr.url.rstrip('/').split('/')[-1])
    con = sqlite3.connect(db_path, timeout=10)
    row = con.execute('SELECT borrower_type, employee_code, company, status FROM loans WHERE id = ?', (new_id,)).fetchone()
    con.close()
    check('request form: the loan is raised as a sales loan for S903', row == ('sales', 'S903', COMPANY, 'requested'), row)

    # Loans list: Sales tag.
    hr.goto(f'{BASE}/loans?tab=loans')
    lr = hr.get_by_test_id(f'loan-row-{new_id}')
    lr.wait_for(timeout=10000)
    check('Loans list: sales borrower row shows the "Sales" tag', 'Sales' in lr.inner_text() and 'Ojas Bedi' in lr.inner_text(), lr.inner_text())

    # Sales register: Loan column, Hold disabled where the loan is posted.
    hr.goto(f'{BASE}/sales/compute')
    hr.locator(f'select:has(option[value="{COMPANY}"])').first.select_option(COMPANY)
    hr.locator('select:has(option[value="2026"])').first.select_option('2026')
    hr.locator('select:has(option[value="12"]):not(:has(option[value="2026"]))').first.select_option('7')
    ok = True
    try:
        hr.get_by_test_id('sales-loan-S901').wait_for(timeout=15000)
    except Exception:
        ok = False
    check('sales register: Loan column present', ok)
    if ok:
        c1 = hr.get_by_test_id('sales-loan-S901').inner_text()
        c2 = hr.get_by_test_id('sales-loan-S902').inner_text()
        check('sales register: S901 loan ₹3,000 marked posted', '3,000' in c1 and 'posted' in c1, c1)
        check('sales register: S902 loan ₹3,000, not posted', '3,000' in c2 and 'posted' not in c2, c2)
        r1 = hr.locator('tr', has=hr.get_by_test_id('sales-loan-S901'))
        r2 = hr.locator('tr', has=hr.get_by_test_id('sales-loan-S902'))
        h1 = r1.locator('option', has_text='hold')
        h2 = r2.locator('option', has_text='hold')
        check('sales register: "→ hold" disabled with "(loan posted)" on the posted row',
              h1.count() == 1 and h1.is_disabled() and 'loan posted' in h1.inner_text(), h1.count() and h1.inner_text())
        check('sales register: "→ hold" still allowed on the row whose loan is not posted',
              h2.count() == 1 and not h2.is_disabled(), h2.count())
        shot(hr, '02-sales-register-loan-column', out=OUT8)



# ── Pass 5 (Loans PR-9): reports, payslip balance line, sales close ─────────

SEED_PR9_JS = r"""
// Scratch DB only. argv: ROOT DB_PATH. A no-loan plant employee with a Jul 2026 payslip,
// and the expected payslip balance lines from the engine.
const [ROOT, DB] = process.argv.slice(2);
const Database = require(`${ROOT}/backend/node_modules/better-sqlite3`);
const db = new Database(DB);
db.pragma('busy_timeout = 10000');
const L = require(`${ROOT}/backend/src/services/loans`);
const COMPANY = 'Indriyan Beverages Pvt Ltd';
const emp = db.prepare("SELECT id FROM employees WHERE code = 'E105'").get();
db.prepare(`INSERT INTO day_calculations (employee_code, month, year, company, days_present, total_payable_days) VALUES ('E105', 7, 2026, ?, 27, 27)`).run(COMPANY);
db.prepare(`INSERT INTO salary_computations (employee_id, employee_code, month, year, company, gross_salary, gross_earned, total_deductions, net_salary, basic_earned)
            VALUES (?, 'E105', 7, 2026, ?, 20000, 20000, 0, 20000, 20000)`).run(emp.id, COMPANY);
const out = {
  E110: L.payslipLoanBalance(db, { payroll: 'plant', employeeCode: 'E110', month: 7, year: 2026 }),
  E105: L.payslipLoanBalance(db, { payroll: 'plant', employeeCode: 'E105', month: 7, year: 2026 }),
  S901: L.payslipLoanBalance(db, { payroll: 'sales', employeeCode: 'S901', company: COMPANY, month: 7, year: 2026 }),
  S903: L.payslipLoanBalance(db, { payroll: 'sales', employeeCode: 'S903', company: COMPANY, month: 7, year: 2026 }),
  outstanding: db.prepare("SELECT COALESCE(SUM(remaining_balance), 0) AS v FROM loans WHERE status IN ('active','recover_at_exit')").get().v,
};
process.stdout.write(JSON.stringify(out));
"""


def digits(text):
    return ''.join(ch for ch in str(text) if ch.isdigit() or ch == '.')


def inr(v):
    """₹ amount as the screens print it (en-IN grouping, no decimals for whole rupees)."""
    v = float(v)
    whole = int(round(v)) if abs(v - round(v)) < 0.005 else None
    s = str(whole if whole is not None else f'{v:.2f}')
    head, _, frac = s.partition('.')
    neg = head.startswith('-')
    head = head.lstrip('-')
    if len(head) > 3:
        rest, last3 = head[:-3], head[-3:]
        groups = []
        while len(rest) > 2:
            groups.insert(0, rest[-2:])
            rest = rest[:-2]
        if rest:
            groups.insert(0, rest)
        head = ','.join(groups + [last3])
    return ('-' if neg else '') + head + (('.' + frac) if frac else '')


def run_reports_pass(db_path, hr, admin, fin, viewer):
    print('\n— Pass 5: reports, payslip balance line, sales close (Loans PR-9) —')
    js = os.path.join(os.path.dirname(db_path), 'seed-pr9.js')
    with open(js, 'w') as f:
        f.write(SEED_PR9_JS)
    seeded = json.loads(subprocess.check_output(['node', js, ROOT, db_path]).decode())
    check('seed: E110 has a loan line for Jul 2026, E105 (no loan) has none',
          seeded['E110']['show'] and not seeded['E105']['show'], {k: seeded[k]['show'] for k in ('E110', 'E105')})

    # Reports tab (finance — has not touched the company filter).
    fin.goto(f'{BASE}/loans?tab=loans')
    fin.get_by_test_id('tile-outstanding').wait_for()
    fin.wait_for_timeout(800)
    tile_txt = fin.get_by_test_id('tile-outstanding').inner_text()
    fin.goto(f'{BASE}/loans?tab=reports')
    ok = visible(fin, 'rep-outstanding', 15000)
    check('Reports tab: Outstanding view renders', ok)
    total_txt = fin.get_by_test_id('rep-total-outstanding').inner_text() if ok else ''
    check('Reports: outstanding total = the Loans "Outstanding" tile', inr(seeded['outstanding']) in tile_txt and inr(seeded['outstanding']) in total_txt,
          [tile_txt, total_txt, seeded['outstanding']])
    check('Reports: department table footer = the ledger total', ok and inr(seeded['outstanding']) in fin.get_by_test_id('rep-groups-total').inner_text())
    shot(fin, '01-reports-outstanding', element='loan-reports', out=OUT9)
    for view in ['outstanding', 'forecast', 'exceptions', 'leavers', 'perquisite', 'write-offs']:
        fin.get_by_test_id(f'rep-view-{view}').click()
        rendered = visible(fin, f'rep-{view}', 15000)
        check(f'Reports: "{view}" view renders', rendered)
        path = None
        try:
            with fin.expect_download(timeout=15000) as dl:
                fin.get_by_test_id('rep-download').click()
            path = os.path.join(os.path.dirname(db_path), dl.value.suggested_filename)
            dl.value.save_as(path)
        except Exception as e:
            check(f'Reports: "{view}" Excel download', False, repr(e)[:200])
        if path:
            import zipfile
            with zipfile.ZipFile(path) as z:
                wb = z.read('xl/workbook.xml').decode()
            want = {'outstanding': 'Outstanding register', 'forecast': 'Recovery forecast', 'exceptions': 'Exceptions',
                    'leavers': 'Leavers with balance', 'perquisite': 'Perquisite list', 'write-offs': 'Write-offs (TDS)'}[view]
            check(f'Reports: "{view}" Excel opens with sheet "{want}"', want in wb, os.path.basename(path))
        if view == 'forecast':
            chk = fin.get_by_test_id('rep-forecast-check').inner_text()
            check('Reports: forecast total = outstanding', '=' in chk and '≠' not in chk, chk)
            shot(fin, '02-reports-forecast', element='loan-reports', out=OUT9)
        if view == 'perquisite':
            t = fin.get_by_test_id('rep-perq-threshold').inner_text()
            check('Reports: perquisite threshold ₹20,000 labelled "pending CA confirmation"', '20,000' in t and 'pending CA confirmation' in t, t)
            shot(fin, '03-reports-perquisite', element='loan-reports', out=OUT9)
    viewer.goto(f'{BASE}/loans?tab=reports')
    check('Reports: viewer can read the reports', visible(viewer, 'rep-outstanding', 15000))

    # Stage 7 payslip modal: line for the borrower, none for the non-borrower.
    def stage7_payslip(code):
        hr.goto(f'{BASE}/pipeline/salary')
        hr.locator('select:has(option[value="2026"])').first.select_option('2026')
        hr.locator('select:has(option[value="12"]):not(:has(option[value="2026"]))').first.select_option('7')
        row = hr.locator('tr', has_text=code).filter(has=hr.locator('button[title="Payslip"]')).first
        row.wait_for(timeout=15000)
        row.locator('button[title="Payslip"]').click()
        hr.get_by_text('Net Salary').first.wait_for(timeout=10000)
        hr.wait_for_timeout(1500)   # the balance read is a second request
    try:
        stage7_payslip('E110')
        line = hr.get_by_test_id('payslip-loan-balance')
        want = inr(seeded['E110']['loans'][0]['outstandingAfter'])
        check('Stage 7 payslip: borrower shows "Loan outstanding after this month\'s EMI"',
              line.count() == 1 and "outstanding after this month's EMI" in line.inner_text() and want in line.inner_text(),
              line.inner_text() if line.count() else 'no line')
        shot(hr, '04-stage7-payslip-loan-line', out=OUT9)
        hr.keyboard.press('Escape')
        stage7_payslip('E105')
        check('Stage 7 payslip: non-borrower shows no loan line', hr.get_by_test_id('payslip-loan-balance').count() == 0)
        hr.keyboard.press('Escape')
    except Exception as e:
        check('Stage 7 payslip modal reachable', False, repr(e)[:300])

    # Sales payslip page.
    q = f'month=7&year=2026&company={urllib.parse.quote(COMPANY)}'
    hr.goto(f'{BASE}/sales/payslip/S901?{q}')
    hr.get_by_text('Net Salary Payable').first.wait_for(timeout=15000)
    hr.wait_for_timeout(1500)
    sl = hr.get_by_test_id('sales-payslip-loan-balance')
    want = inr(seeded['S901']['loans'][0]['outstandingAfter'])
    check('sales payslip: borrower S901 shows the loan line', sl.count() == 1 and want in sl.inner_text(), sl.inner_text() if sl.count() else 'no line')
    shot(hr, '05-sales-payslip-loan-line', out=OUT9)
    hr.goto(f'{BASE}/sales/payslip/S903?{q}')
    hr.get_by_text('Net Salary Payable').first.wait_for(timeout=15000)
    hr.wait_for_timeout(1500)
    check('sales payslip: S903 (loan only requested) shows no loan line', hr.get_by_test_id('sales-payslip-loan-balance').count() == 0)

    # Close tab: Plant / Sales toggle.
    fin.goto(f'{BASE}/loans?tab=close')
    fin.get_by_test_id('loan-close').wait_for()
    fin.get_by_test_id('close-payroll-sales').click()
    check('close tab: Sales toggle shows the sales readiness for Jul 2026 (READY)', pick_month(fin, 7, 2026, 'READY', 15000),
          fin.get_by_test_id('close-readiness').inner_text())
    due_txt = ''
    for _ in range(40):   # the due list is its own request: wait for it to land
        due_txt = tile(fin, 'close-tile-due')
        lines = [x.strip() for x in due_txt.split('\n') if x.strip()]
        if len(lines) > 1 and lines[1] == '2':
            break
        fin.wait_for_timeout(250)
    check('close tab (sales): due tile counts only sales instalments (2 of the month\'s due rows)',
          [x.strip() for x in due_txt.split('\n') if x.strip()][1:2] == ['2'], due_txt.replace('\n', ' | '))
    shot(fin, '06-close-sales-ready', element='loan-close', out=OUT9)
    fin.get_by_test_id('close-run').click()
    title = fin.get_by_text('Close sales loans for Jul 2026?')
    check('close tab (sales): confirm dialog names the sales payroll', title.count() >= 1)
    fin.get_by_test_id('close-confirm-run').click()
    check('close tab (sales): finance closes the sales month (toast)', toast(fin, 'Closed sales Jul 2026'))
    check('close tab (sales): readiness becomes ALREADY_CLOSED', readiness_is(fin, 'ALREADY_CLOSED', 15000))
    con = sqlite3.connect(db_path, timeout=10)
    closes = con.execute("SELECT payroll, run_by, trigger_kind FROM loan_closes WHERE month = 7 AND year = 2026 ORDER BY payroll").fetchall()
    con.close()
    check('close tab (sales): a sales loan_closes row written by finance, manual', ('sales', 'finance', 'manual') in closes, closes)
    hist = fin.get_by_test_id('close-row-7-2026')
    check('close tab: history lists the sales close', any('sales' in hist.nth(i).inner_text() for i in range(hist.count())), hist.count())
    fin.get_by_test_id('close-payroll-plant').click()
    check('close tab: switching back to Plant shows plant Jul 2026 (closed in Pass 3)', readiness_is(fin, 'ALREADY_CLOSED', 15000))
    hr.goto(f'{BASE}/loans?tab=close')
    hr.get_by_test_id('loan-close').wait_for()
    hr.get_by_test_id('close-payroll-sales').click()
    check('close tab (sales): hr is read-only', visible(hr, 'close-readonly') and hr.get_by_test_id('close-run').count() == 0)

# ── Pass 6 (Loans PR-11): the admin dry run ─────────────────────────────────

SEED_PR11_JS = r"""
// Scratch DB only. argv: ROOT DB_PATH. Two Aug 2026 plant employees with a stored Stage 7.
const [ROOT, DB] = process.argv.slice(2);
const Database = require(`${ROOT}/backend/node_modules/better-sqlite3`);
const db = new Database(DB);
db.pragma('busy_timeout = 10000');
const { recomputeSalary } = require(`${ROOT}/backend/src/services/recompute`);
const COMPANY = 'Indriyan Beverages Pvt Ltd';
const quiet = (fn) => { const l = console.log; const w = console.warn; console.log = () => {}; console.warn = () => {}; try { return fn(); } finally { console.log = l; console.warn = w; } };
for (const [code, name] of [['E140', 'Manpreet Gill'], ['E141', 'Navdeep Kaur']]) {
  db.prepare(`INSERT INTO employees (code, name, department, company, status, employment_type, is_contractor, gross_salary, date_of_joining)
              VALUES (?, ?, 'PRODUCTION', ?, 'Active', 'Permanent', 0, 24000, '2020-04-01')`).run(code, name, COMPANY);
  db.prepare(`INSERT INTO day_calculations (employee_code, month, year, company, days_present, total_payable_days) VALUES (?, 8, 2026, ?, 27, 27)`).run(code, COMPANY);
  const ins = db.prepare("INSERT OR IGNORE INTO attendance_processed (employee_code, date, status_original, status_final, company, month, year) VALUES (?, ?, 'P', 'P', ?, 8, 2026)");
  for (let day = 24; day <= 31; day++) ins.run(code, `2026-08-${day}`, COMPANY);
}
quiet(() => recomputeSalary(db, { month: 8, year: 2026, company: COMPANY, employeeCodes: ['E140', 'E141'], requestId: 'ui-check-pr11' }));
db.prepare('UPDATE monthly_imports SET stage_7_done = 1 WHERE month = 8 AND year = 2026').run();
// Sep 2026 imported but Stage 7 not finished (as production would be mid-month): the pack's latest computed month is Aug.
db.prepare("INSERT INTO monthly_imports (month, year, file_name, company, stage_1_done, stage_7_done) VALUES (9, 2026, 'ui-check-sep.xls', ?, 1, 0)").run(COMPANY);
// Production shape: Stage 6 changed after Stage 7 for one of them (stale).
db.prepare("UPDATE day_calculations SET total_payable_days = 25, days_present = 25, salary_stale = 1 WHERE employee_code = 'E141' AND month = 8 AND year = 2026").run();
process.stdout.write(JSON.stringify({ ok: true }));
"""


def db_hashes(db_path):
    """{table: sha256} of every table; audit_log and its sqlite_sequence counter returned apart."""
    import hashlib
    con = sqlite3.connect(db_path, timeout=10)
    out = {}
    for (name,) in con.execute("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").fetchall():
        # audit_log is compared apart; the app's own request logging (usage_logs, session_*)
        # writes on every page call and is not part of the dry run.
        if name in ('audit_log', 'usage_logs', 'session_events', 'session_daily_summary'):
            continue
        where = " WHERE name NOT IN ('audit_log', 'usage_logs', 'session_events', 'session_daily_summary')" if name == 'sqlite_sequence' else ''
        h = hashlib.sha256()
        for row in con.execute(f'SELECT * FROM "{name}"{where} ORDER BY rowid'):
            h.update(repr(row).encode())
        out[name] = h.hexdigest()
    audit_max = con.execute('SELECT COALESCE(MAX(id), 0) FROM audit_log').fetchone()[0]
    h = hashlib.sha256()
    for row in con.execute('SELECT * FROM audit_log WHERE id <= ? ORDER BY id', (audit_max,)):
        h.update(repr(row).encode())
    con.close()
    return out, audit_max, h.hexdigest()


def audit_since(db_path, audit_max):
    con = sqlite3.connect(db_path, timeout=10)
    rows = con.execute('SELECT action_type, changed_by, remark FROM audit_log WHERE id > ? ORDER BY id', (audit_max,)).fetchall()
    con.close()
    return rows


def untouched(db_path, before, label, runs=1):
    tables, amax, ahash = before
    after_tables, _, _ = db_hashes(db_path)
    changed = [t for t in tables if tables[t] != after_tables.get(t)]
    con = sqlite3.connect(db_path, timeout=10)
    old_audit = hashlib_rows(con, amax)
    con.close()
    check(f'{label}: every table identical to before the run', not changed, changed)
    check(f'{label}: existing audit rows unchanged', old_audit == ahash)
    new = audit_since(db_path, amax)
    check(f'{label}: exactly {runs} new audit row(s), all loan_dry_run by admin',
          len(new) == runs and all(r[0] == 'loan_dry_run' and r[1] == 'admin' for r in new), [r[:2] for r in new])
    return new


def hashlib_rows(con, amax):
    import hashlib
    h = hashlib.sha256()
    for row in con.execute('SELECT * FROM audit_log WHERE id <= ? ORDER BY id', (amax,)):
        h.update(repr(row).encode())
    return h.hexdigest()


def pick_borrower(page, idx, code):
    page.get_by_test_id(f'dry-run-emp-{idx}').fill(code)
    page.get_by_role('button', name=code).first.click()


def run_dry_run_pass(db_path, hr, admin):
    print('\n— Pass 6: admin dry run (Loans PR-11) —')
    js = os.path.join(os.path.dirname(db_path), 'seed-pr11.js')
    with open(js, 'w') as f:
        f.write(SEED_PR11_JS)
    subprocess.check_output(['node', js, ROOT, db_path])

    hr.goto(f'{BASE}/loans?tab=loans')
    hr.get_by_test_id('tab-loans').wait_for()
    check('dry run: the tab is hidden for hr', hr.get_by_test_id('tab-dry-run').count() == 0)

    admin.goto(f'{BASE}/loans?tab=dry-run')
    check('dry run: admin sees the Dry run tab', visible(admin, 'tab-dry-run'))
    check('dry run: the form renders', visible(admin, 'dry-run-run'))
    admin.get_by_test_id('dry-run-month').select_option('8')
    pick_borrower(admin, 1, 'E140')
    admin.get_by_test_id('dry-run-principal-1').fill('10000')
    admin.get_by_test_id('dry-run-tenure-1').fill('4')
    admin.get_by_role('button', name='+ Add employee').click()
    pick_borrower(admin, 2, 'E141')
    admin.get_by_test_id('dry-run-principal-2').fill('12000')
    admin.get_by_test_id('dry-run-tenure-2').fill('4')
    admin.get_by_test_id('dry-run-hold-2').check()
    shot(admin, '01-dry-run-form', out=OUT11)

    before = db_hashes(db_path)
    admin.get_by_test_id('dry-run-run').click()
    check('dry run: report appears', visible(admin, 'dry-run-report', 30000))
    banner = admin.get_by_test_id('dry-run-banner').inner_text()
    check('dry run: green "Nothing was saved" banner', 'Nothing was saved' in banner, banner[:200])
    row1 = admin.get_by_test_id('dry-run-row-1').inner_text()
    check('dry run: E140 deducted ₹2,500 and posted', '2,500' in row1 and 'Posted' in row1, row1)
    row2 = admin.get_by_test_id('dry-run-row-2').inner_text()
    check('dry run: E141 (hold) waits for the hold to be released', 'Held' in row2, row2)
    stale = admin.get_by_test_id('dry-run-stale-note').inner_text()
    check('dry run: stale note says the difference is not caused by the loan', 'not caused by the loan' in stale and '1 of 2' in stale, stale[:300])
    close = admin.get_by_test_id('dry-run-close').inner_text()
    check('dry run: close line shows the Aug close', 'Closed: posted' in close, close)
    checks_t = admin.get_by_test_id('dry-run-checks').inner_text()
    check('dry run: touched-row checks clean', 'all clean' in checks_t, checks_t)
    shot(admin, '02-dry-run-report', element='dry-run-report', out=OUT11)
    new = untouched(db_path, before, 'dry run (2 scenarios)')
    if new:
        try:
            meta = json.loads(new[0][2])
            check('dry run: audit row records scenarios, verified and timings',
                  len(meta.get('scenarios', [])) == 2 and meta.get('rollbackVerified') is True and 'lockMs' in meta.get('timings', {}), meta)
        except Exception as e:
            check('dry run: audit row records scenarios, verified and timings', False, repr(e))
    con = sqlite3.connect(db_path, timeout=10)
    left = con.execute("SELECT (SELECT COUNT(*) FROM loans WHERE employee_code IN ('E140','E141')), (SELECT COUNT(*) FROM loan_closes WHERE month = 8 AND year = 2026)").fetchone()
    check('dry run: no loan and no Aug close row survived', left == (0, 0), left)
    con.close()

    try:
        with admin.expect_download(timeout=15000) as dl:
            admin.get_by_test_id('dry-run-export-json').first.click()
        d = dl.value
        p = d.path()
        data = json.load(open(p))
        check('dry run: JSON export downloads the report', d.suggested_filename.endswith('.json') and data.get('nothingSaved') is True)
    except Exception as e:
        check('dry run: JSON export downloads the report', False, repr(e)[:200])
    try:
        with admin.expect_download(timeout=15000) as dl:
            admin.get_by_test_id('dry-run-export-xlsx').first.click()
        check('dry run: Excel export downloads', dl.value.suggested_filename.endswith('.xlsx'))
    except Exception as e:
        check('dry run: Excel export downloads', False, repr(e)[:200])

    before = db_hashes(db_path)
    admin.get_by_test_id('dry-run-pack').click()
    # Plant: E140 / E141 (the only Aug borrowers without a loan). Sales: every Jul rep already
    # has an open loan from Pass 4, so the sales pack is honestly empty and says so.
    ok = False
    for _ in range(60):
        if admin.get_by_test_id('dry-run-report').count() == 1 and admin.get_by_test_id('dry-run-pack-empty').count() == 1:
            ok = True
            break
        admin.wait_for_timeout(500)
    check('dry run: rehearsal pack shows the plant report and the empty sales pack note', ok,
          (admin.get_by_test_id('dry-run-report').count(), admin.get_by_test_id('dry-run-pack-empty').count(), admin.locator('main').inner_text()[-600:]))
    if admin.get_by_test_id('dry-run-pack-empty').count():
        note = admin.get_by_test_id('dry-run-pack-empty').first.inner_text()
        check('dry run: the empty sales pack explains why', 'No eligible sales borrower' in note, note)
    banners = admin.get_by_test_id('dry-run-banner')
    check('dry run: the pack report says nothing was saved', banners.count() == 1 and 'Nothing was saved' in banners.first.inner_text())
    shot(admin, '03-dry-run-pack', out=OUT11)
    untouched(db_path, before, 'rehearsal pack', runs=1)


if __name__ == '__main__':
    main()
