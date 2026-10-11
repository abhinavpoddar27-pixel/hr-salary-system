# P1-07 — retire the legacy "Grant Extra Duty" (Payable OT)

Owner ruling Q5 (11 Oct 2026): "Yes remove it". Built by the planner directly (small, one route file + one page).

- [x] Backend: POST /payroll/grant-extra-duty and DELETE /payroll/revoke-extra-duty/:id → 410, write nothing. GET list kept (read-only).
- [x] Frontend: Payable OT loses the Grant Extra Duty tab; a one-line pointer links to /extra-duty-grants. Dead api.js helpers removed.
- [x] jest: new legacyExtraDutyGrantRetired.test.js 6 (5 fail on main); full suite 96 / 1537.
- [x] Browser: backend/scripts/legacy-ed-grant-retired-check.py 31/31; --base on origin/main 3/3 (tab present, grant writes a row).
- [x] Pay unaffected: the legacy rows are read only by the DAY_CORRECTION finance flag and the corrections views — never by Stage 6/7 pay.
