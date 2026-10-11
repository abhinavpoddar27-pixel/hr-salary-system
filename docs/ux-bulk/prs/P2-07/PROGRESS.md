# P2-07 PROGRESS
## RESUME
Read PROMPT.md + PLAN.md. Phase 0 done; GO received. Build per PLAN + rulings.
## Steps
- [x] Phase 0: code read, production shapes (counts only), PLAN.md
- [x] go received (11 Oct)
- [x] parseCodes.js + parse-codes-check.mjs (37/37)
- [x] EmployeeSearchSelect aria fix
- [x] PeoplePicker.jsx
- [x] harness + people-picker-check.py 39/39; --base (origin/main ESS) 6/13 — 7 aria checks fail as expected
- [ ] Leave Management real-app aria check
- [ ] jest before/after, merge main, push
## Rulings
Q1 parser matches the master list; pattern fallback only without a list.
Q2 PeoplePicker props-only; callers pass Active + Left for the Left toggle (document it).
Q3 paste box inside PeoplePicker.
Q4 browser test via esbuild harness under backend/scripts/harness/.
## CLAUDE.md entry
(after build)
