# P6-07 + .btn-warning — PROGRESS

Rebuilt 12 Oct 2026 23:58 IST on main c2c8d23. The toast de-duplication (P2-02) and the IST "today" fixes that were
first in this branch shipped through #158 and #159, so they were dropped here; this PR keeps only:
- P6-07 (F-14): debug role banners (username, raw role JSON, canFinance) removed from Extra Duty, Held Salaries
  and Finance Verification (miss-punch + held tabs). Extra Duty keeps a plain note for users who cannot approve.
- `.btn-warning` defined in index.css (amber, same shape as `.btn-success`) — the Extra Duty "Flag for Review"
  submit button rendered unstyled.

Verified: frontend build OK; `backend/scripts/ui-polish-batch4-check.py` 14/14 (finance/viewer: no debug text on the
five screens, links kept, `.btn-warning` styled, 390 px, 0 page errors). Viewer no longer reaches Extra Duty on main
(#157), so the viewer note check was dropped.

## CLAUDE.md entry
**P6-07 + .btn-warning (feat/ui-polish-batch4).** Debug role banners removed from ExtraDutyGrants, HeldSalariesRegister
and FinanceVerification; `.btn-warning` added to index.css. Check script `ui-polish-batch4-check.py` 14/14.
