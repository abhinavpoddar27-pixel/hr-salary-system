# F151 — N-MONEY2 follow-ups F-2, F-3 (frontend only)

> Planner ruling 16 Oct: F-6 MOVED to N-PF (`alreadyPending` flag + Employees.jsx toast there). The F-6 section below is kept for history only.
Branch `fix/n-money2-followups` off origin/main b0ed242 (worktree /home/claude/wt-f151). Source: findings in
docs/ux-bulk/prs/N-MONEY2/PROGRESS.md (#151). Phase 0 — no code yet. Each fix = the smallest change.

## F-2 — Salary Input history shows nothing for 'Reverted'
FACT: `frontend/src/pages/SalaryInput.jsx` l.420-424 renders three hard-coded spans (Approved / Rejected / Pending);
N-23 sets status 'Reverted' (financeAudit.js gross revert) → empty Status cell. `utils/statusMap.js` domain
`salary_change` has no 'Reverted'; `statusInfo` falls back to the raw status as label, gray tone.
Change: one added line in that cell — `{h.status === 'Reverted' && <StatusBadge domain="salary_change" status="Reverted" size="xs" />}`
+ the import → gray pill "Reverted" (the fallback label is exactly "Reverted"). The other three spans stay (no
restyle). statusMap.js is not mine → see Q1.

## F-3 — Extra Duty bulk finance-approve ignores `skipped`
FACT: `frontend/src/pages/ExtraDutyGrants.jsx` l.137-140 `bulkFinApproveMut.onSuccess` toasts "`count` grants approved";
POST /bulk-finance-approve returns `{ count, skipped: [{id, error}] }` (extraDutyGrants.js l.509-523).
Change: onSuccess text → `Approved N` when nothing skipped; `Approved N · Skipped M (not HR-approved or already decided)`
when M > 0 (singular/plural "grant"). If N = 0 and M > 0 → plain `toast` (not success) with "Nothing approved · Skipped M
(not HR-approved or already decided)".
Single finance approve (`finApproveMut`, l.106): NO onError added. Reason (FACT, utils/toastDedup.js + api.js l.40-45):
the axios interceptor already toasts every non-401 failure with the server's `error` text (e.g. the 409 "Not HR-approved"
/ "already decided" message from N-MONEY2) → one failure = one toast today. An onError would only re-label that same
toast (dedup claim), adding code for no user gain. Same holds for the bulk call (ReviewQueue catches; interceptor toasts).
The check script proves "one toast" for a forced 409 on single approve.

## F-6 — Employees.jsx says "submitted" when the reply is "already pending"
FACT: `frontend/src/pages/Employees.jsx` l.110-121: any `pendingApproval` reply → "Salary change submitted for finance
approval". PUT /employees/:code/salary returns `pendingApproval: true` with message "A salary change request is already
pending finance approval for this employee." when nothing new is raised; for a new request its `message` is the right
text too (gross / split, and the ceiling text from N-PF).
Change: `pendingApproval` → show `data.message` (fallback the current text). "Already pending" (message starts with
"A salary change request is already pending") → neutral `toast(…)` with an info icon instead of success, so it does not
look like something was raised. No backend change (see Q2).

## NOT touched
statusMap.js, StatusBadge.jsx, api.js, toastDedup.js, components/bulk/*, any backend file, CLAUDE.md.

## Checks
jest full suite (no backend change; confirm green), frontend build, `backend/scripts/n-money2-followups-check.py`
(port 3502 after N-PF is done, built dist, scratch DB fictional T95xx / "Test Person A"):
F-2 history row with status Reverted shows "Reverted" pill (finance login); F-3 bulk approve 2 eligible + 1 not
HR-approved → toast "Approved 2 · Skipped 1 (…)"; all-ineligible → "Nothing approved · Skipped …"; single approve forced
409 → exactly 1 toast with the server text; F-6 hr saves a gross change twice → first "Salary change submitted…",
second "…already pending…" (not a success toast); 390 px; 0 page errors; 0 unexpected ≥ 400 (the forced 409 excepted).
`--base` on origin/main: empty Status cell, "2 grants approved", "submitted" on the second save.

## Risks
- F-6 matches the server's message text to pick the toast style; if the text changes, the toast falls back to a
  success toast with the server's own (still correct) words — never wrong text, only wrong icon.

## Questions
- Q1 F-2: add `Reverted: { label: 'Reverted', tone: 'muted' or 'orange' }` to statusMap `salary_change` (one line, not my
  file) for a proper tone, or keep the gray fallback?
- Q2 F-6: OK to match on the message text? The clean alternative is `alreadyPending: true` in the employees.js reply —
  that file is in my N-PF PR; I can add it there (1 line) and key F-6 on it if you prefer (makes F151 depend on N-PF).
- Q3 F-3: OK to skip the single-approve onError because the global interceptor already gives one toast?
