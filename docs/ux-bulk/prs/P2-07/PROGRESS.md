# P2-07 PROGRESS
## RESUME
Read PROMPT.md + PLAN.md. BUILT. Merged origin/main fa430144; all checks re-run green. Waiting for planner review / PR.
## Steps
- [x] Phase 0: code read, production shapes (counts only), PLAN.md
- [x] go received (11 Oct)
- [x] parseCodes.js + parse-codes-check.mjs (37/37)
- [x] EmployeeSearchSelect aria fix
- [x] PeoplePicker.jsx
- [x] harness + people-picker-check.py 39/39; --base (origin/main ESS) 6/13 — 7 aria checks fail as expected
- [x] Leave Management real-app aria check 9/9 (caught: after ArrowDown, typing left activedescendant unset for a render — v2 resets active with the query)
- [x] jest 105/1649 before (80934af4) → 107/1669 after merging origin/main fa430144 (new suites from main; no backend change here); pushed
## Rulings
Q1 parser matches the master list; pattern fallback only without a list.
Q2 PeoplePicker props-only; callers pass Active + Left for the Left toggle (document it).
Q3 paste box inside PeoplePicker.
Q4 browser test via esbuild harness under backend/scripts/harness/.
## CLAUDE.md entry
## Last Session — 2026-10-11 (P2-07: parseCodes + PeoplePicker; EmployeeSearchSelect aria)
**Branch `feat/people-picker-parse-codes`, NOT merged.** Frontend only. Plan + log: `docs/ux-bulk/prs/P2-07/PLAN.md`, `PROGRESS.md`.
Rulings Q1 (match the master list, pattern only as fallback), Q2 (picker props-only), Q3 (paste inside the picker), Q4 (esbuild harness).
- **Prod facts (counts only):** plant codes are mostly 5 digits (also 4 and 6); one live code is a word and one starts with "/";
  sales codes = "S" + 3 digits; no leading zeros; 141 departments (largest 183 Active). So a code regex alone would drop 2 live codes.
- **`utils/parseCodes.js` (new):** `parseCodes(text, knownCodes) → {codes, unknown, ignored, duplicates, total}`. Splits on
  newline/comma/tab/semicolon/space; strips quotes, brackets, sentence punctuation, Excel ".0"; text only (leading zeros kept);
  case-insensitive match against the master, master spelling returned; first-seen order, deduped. Code-shaped but not in the
  master → `unknown`; words → `ignored`. `knownCodes` null → pattern fallback. Also `splitTokens`, `isCodeShaped`.
- **`components/bulk/PeoplePicker.jsx` (new, not wired):** props `employees, value, onChange, allowLeft, maxHeight`. Caller fetches;
  for the "Include people who have left" toggle the caller must pass Active AND Left employees. Departments largest first,
  "No department" last, collapsed until a search; search name/code/department; department box ticks the VISIBLE members
  (indeterminate when partial); tray with count, ✕, Clear all; paste box (Added / repeated / ignored / Not found / Has left).
- **`EmployeeSearchSelect`:** `useId` ids; input `aria-controls` + `aria-activedescendant` (only while open with a highlighted row);
  non-option rows `role="presentation"`; `active` reset together with the query (v2). Behaviour unchanged.
- **Fragile:** a word code in the master matches the same word in a pasted name ("code name" pastes). Space is a separator, so a
  code containing a space would split (0 such codes). Picker department tick acts on what the search shows.
- **Verified:** `node backend/scripts/parse-codes-check.mjs` 37/37; `backend/scripts/people-picker-check.py` (esbuild harness under
  `backend/scripts/harness/`, Chromium, fictional data) 40/40; `--base` with origin/main's EmployeeSearchSelect 6/13 (7 aria checks
  fail); `backend/scripts/leave-picker-aria-check.py` (built dist, real hr login, Leave Management → Apply Leave) 9/9, 0 errors.
  jest 105/1649 → 107/1669 (after merging main; no backend change).
- **Not tested:** Railway; Safari/Firefox; screen readers (attributes only); harness has no Tailwind styling (behaviour only).
