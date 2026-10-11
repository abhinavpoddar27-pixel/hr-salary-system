# N-MONEY — PROGRESS
## Steps
- [x] Phase 0: code read, prod counts (read-only), PLAN.md — waiting for planner "go"
- [ ] Baseline jest
- [x] financeAudit.js guard + shared decideManualFlag + one transaction (single + bulk), 409 GROSS_MOVED_SINCE
- [x] salary-input.js resolveApproval (absent keeps, gross explicit or sum) + istToday + approval_preview on pending list
- [x] SalaryInput.jsx approver card: kept note, write gross, red highlight when it differs
- [x] salaryFlagRevertAndApprove.test.js 18/18; on c942563f 13 fail / 5 pass (controls)
- [ ] full suite before/after
- [ ] scratch sim + drift 0
- [ ] merge origin/main, push, report
## Rulings (planner, 11 Oct)
- Q1 yes: 409 when current gross differs from flag manual_value by > ₹1, message says so.
- Q2 yes: single route all-or-nothing, 500, nothing written.
- Q3 (a): gross = sum of resolved components; SalaryInput.jsx approver card (owned now) shows kept value "not in this request — current value kept" + resulting gross, highlighted when it differs.
- Q4 report only. Q5 bulk all-or-nothing. employees.js untouched.
## CLAUDE.md entry
(after build)
