# Claude Cowork Prompt — Fix Verification Run (PR #7)

You are verifying **3 bug fixes** on PR #7 of the HR Salary System using the Chrome extension against the live PR preview. Do NOT use computer use or screen recording — only DOM inspection, clicks, typing, and DevTools network/console checks via the extension.

**PR**: https://github.com/abhinavpoddar27-pixel/hr-salary-system/pull/7
**Preview URL**: `https://hr-app-hr-salary-system-pr-7.up.railway.app`
**Branch**: `claude/early-exit-gate-pass-QGmJK`

## Rules of engagement

1. **Do not stop for anything except the login page.** When you hit the login screen, pause and tell me: *"I've reached the login screen. Please log in as an admin user, then tell me to continue."* Wait for my acknowledgement, then resume.
2. **Never abort on intermediate failures.** Log them in the defect log and move on.
3. **Run every numbered check in order.** Each must be attempted.
4. **After each check, state ✅ PASS, ❌ FAIL (with details), or ⚠ SKIPPED (with reason).**
5. **At the end, output the full defect log as a markdown table** plus a summary: X pass / Y fail / Z skip.

## Context — what was fixed

The previous diagnostic run found 3 defects which have now been fixed and pushed. Your job is to confirm each fix works AND that no regressions were introduced.

- **DEF-01**: Leave Management nav link was buried under Payroll submenu → now promoted to a top-level sidebar entry
- **DEF-02**: Future date accepted by Early Exit Detection → now blocked in frontend (disabled button + inline error) AND backend (HTTP 400)
- **DEF-03**: Pre-finalization checklist missing early exit deduction item → now added to both month-end checklist and finance readiness check

---

## PART 1 — DEF-01 (Sidebar Link)

**1.1** After login, inspect the left sidebar. Verify a **top-level** nav entry labeled **"Leave Management"** with 📋 icon exists (not nested under Payroll). Verify it's between Payroll and Workforce in the nav order. ✅/❌

**1.2** Click the Leave Management nav entry. Verify: page navigates to `/leave-management`, renders without error, nav entry shows active state, 5 tabs visible (Applications, Leave Balances, Leave Register, Adjustments, Gate Passes). ✅/❌

**1.3** Click "Payroll" in sidebar to expand it. Verify: submenu still contains Import / Miss Punches / Shift Check / Night Shift / Corrections / Day Calc / Salary / Held Salaries Register / Salary Advance / Payable OT / Salary Input / Loans. Verify: **Leave Management is NO LONGER inside the Payroll submenu**. ✅/❌

**1.4** Click any remaining Payroll submenu item (e.g., Miss Punches). Verify it still loads its page without error. ✅/❌

---

## PART 2 — DEF-02 (Future Date Validation)

**2.1** Navigate to **Analytics → Early Exit** tab. Verify the tab loads and shows the Re-run Detection button. ✅/❌

**2.2** Click **"Re-run Detection"**. Verify a modal opens with a date input pre-filled with yesterday's date. ✅/❌

**2.3** Using the Chrome extension's DOM inspector, inspect the `<input type="date">` element in the modal. Verify it has a `max` attribute set to today's date in YYYY-MM-DD format. ✅/❌

**2.4** Clear the date input and **type** a future date manually: **`2030-12-31`**. Verify:
- Input border becomes red
- Inline error text appears: **"Detection date cannot be in the future"**
- The **"Run Detection"** button is **disabled** (check DOM for `disabled` attribute)

✅/❌

**2.5** Open DevTools → Network tab. Try clicking the disabled Run Detection button anyway. Verify: no POST request is sent to `/api/early-exits/detect`. ✅/❌

**2.6** Change the date to today's date. Verify:
- Red border disappears
- Inline error disappears
- Run Detection button becomes enabled (no `disabled` attribute)

✅/❌

**2.7** Click Run Detection with today's date. Verify: POST `/api/early-exits/detect` fires and returns 200. Success toast appears. ✅/❌

**2.8 (Backend defense-in-depth)** Open DevTools → Console. Execute this fetch directly (bypassing the UI):

```js
fetch('/api/early-exits/detect', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer ' + localStorage.getItem('hr_token')
  },
  body: JSON.stringify({ date: '2030-12-31' })
}).then(r => r.json().then(j => ({ status: r.status, body: j })))
  .then(console.log)
```

Verify:
- Response status is **400**
- Response body contains `success: false` and error text mentioning "future"

✅/❌

**2.9** Close the detection modal. Pick a valid past date and run detection. Verify it completes successfully (regression check). ✅/❌

---

## PART 3 — DEF-03 (Pre-Finalization Checklist)

**3.1** Navigate to **Payroll → 7. Salary** (Salary Computation page / Stage 7). Ensure month/year is selected. ✅/❌

**3.2** Open DevTools → Network tab. Refresh the page. Find the request to `GET /api/payroll/month-end-checklist`. Verify the response `data` array contains an item with `id` matching one of: `early-exit-deductions-pending`, `early-exit-deductions-reviewed`, or `early-exit-deductions-unapplied`. ✅/❌

**3.3** On the Stage 7 page, look for the checklist UI (may be collapsed or in a panel). Verify a visible checklist item labeled something like **"All early exit deductions reviewed"** (green/OK) or **"Early exit deductions pending finance review"** (amber/warning). ✅/❌

**3.4** Also verify the existing late coming checklist item is still present: **"All late coming deductions reviewed"** or **"Late coming deductions pending finance review"**. Both should render. ✅/❌

**3.5** Navigate to **Finance Audit → Readiness** tab. ✅/❌

**3.6** In DevTools → Network, find `GET /api/finance-audit/readiness-check`. Verify the response includes a check with `type: "EARLY_EXIT_DEDUCTIONS_REVIEWED"` (in `passed` array) or `type: "EARLY_EXIT_DEDUCTIONS_PENDING"` (in `warnings` array). ✅/❌

**3.7** On the Readiness tab UI, verify an item referring to early exit deductions is visible alongside the existing late coming items. ✅/❌

**3.8** In the readiness response, verify the existing `LATE_DEDUCTIONS_REVIEWED` / `LATE_DEDUCTIONS_PENDING` types are also present (regression check). ✅/❌

---

## PART 4 — No Broader Regression

**4.1** Click through each of the new feature tabs to confirm they all still load:
- Leave Management → Gate Passes tab ✅/❌
- Analytics → Early Exit tab ✅/❌
- Finance Audit → Early Exit tab (verify Pending/Approved/Rejected sub-tabs render) ✅/❌
- Daily MIS → scroll to find the Early Exits card ✅/❌

**4.2** Open DevTools → Console. Navigate: Dashboard → Leave Management → Analytics → Finance Audit → Daily MIS → Salary Computation. Verify **no new red errors** appear in the console during this navigation. List any errors you do see. ✅/❌

**4.3** In DevTools → Network, filter requests by the keywords `early-exits` and `short-leaves`. Verify all such requests return HTTP 200 (no 500s, no 404s other than expected 404s for missing records). ✅/❌

**4.4** Verify `/api/payroll/month-end-checklist` and `/api/finance-audit/readiness-check` return 200 with valid data. ✅/❌

---

## Final Output

At the end, output the defect log as a markdown table:

| # | Part | Check | Expected | Actual | Status |
|---|------|-------|----------|--------|--------|
| 1 | 1.1 | ... | ... | ... | PASS/FAIL |

And a summary: **"Summary: X passed / Y failed / Z skipped out of N total checks. Fix status: [GO / NO-GO]."**

- **GO**: All PART 1, PART 2, PART 3 checks pass, and PART 4 shows no regression
- **NO-GO**: Any fix-related check fails, or any new regression is detected

Then stop.

---

**Remember**: Only pause at the login screen. Say *"I've reached the login screen. Please log in as an admin user, then tell me to continue."* Otherwise, power through every check back-to-back. Start now.
