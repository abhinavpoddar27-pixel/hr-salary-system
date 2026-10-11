# P2-07 — PLAN (Phase 0)
Base origin/main 80934af4 · branch feat/people-picker-parse-codes · port 3207

## 1. FACTS (production, read-only, counts only — 11 Oct 2026)
Plant `employees` (1,229 rows; 783 Active, 446 Left):
| shape | Active | Left |
|---|---|---|
| 5 digits | 769 | 412 |
| 4 digits | 11 | 34 |
| 6 digits | 1 | 0 |
| 5 letters (a word, no digits) | 1 | 0 |
| "/" + 4 digits (5 chars) | 1 | 0 |
- No code has a leading zero, a surrounding space, or a case-insensitive duplicate.
- Both odd codes are live (they have attendance rows).
- 141 distinct departments; 10 rows with no department; largest Active department = 183 people.
- 29 Active names contain a digit (so "code name" pastes will produce name tokens that must be reported, not kept).

Sales `sales_employees` (332 rows; 230 Active, 102 Left): every code = "S" + 3 digits (4 chars).

INFERENCE: a regex derived from the master ("4–6 digits" or "S+3 digits") would silently drop 2 live plant codes.
So the parser must match against the actual code list, not a pattern alone.

## 2. Design
### utils/parseCodes.js (new, pure ESM, no imports)
`parseCodes(text, knownCodes, opts?) → { codes, unknown, ignored, duplicates }`
- Split on newline / comma / tab / semicolon / space (`/[\s,;]+/`), trim, drop empties; strip surrounding quotes
  (CSV) and a trailing `.0` on an all-digit token (Excel numeric export).
- `knownCodes` = array of master codes (text). Match case-insensitively, return the MASTER spelling
  (so "s012" → "S012"); leading zeros kept because tokens are never converted to numbers.
- A token in the master → `codes` (first occurrence order, deduped). A repeat → counted in `duplicates`.
- Not in the master but code-shaped (`/^[A-Za-z]?\d{3,7}$/` or starts with "/" + digits) → `unknown` (likely a typo or
  someone not in this list — shown to the user as "not found").
- Anything else (names, words, headers like "Code") → `ignored`.
- Without `knownCodes` (null): code-shaped tokens go to `codes`; others `ignored` (fallback mode, documented).
- Also export `splitTokens(text)` for reuse.

### components/bulk/PeoplePicker.jsx (new, not wired)
Props: `employees` [{code,name,department,status}], `value` (array of codes), `onChange(codes)`,
`allowLeft` (default false), `height`.
- Default shows Active only; tick "Include people who have left" → Left rows appear with an amber "Left" badge.
- Grouped by department, largest group first (ties by name); blank department → "No department" last.
- Search box: case-insensitive partial on name / code / department; groups with no match hidden; group header shows
  "n of m ticked".
- Group checkbox ticks/unticks every VISIBLE member of that department (tri-state via `indeterminate`).
- Selected tray: "N selected", chips with ✕ remove, "Clear all". Selection order = tick order.
- Paste box: textarea + "Add" → parseCodes against the employee list; adds found codes; shows
  "Added N · Not found: … · Ignored M words". A pasted Left person is added only when allowLeft is on, else listed as
  "has left".
- Collapsed departments by default when no search (141 groups); expanded when searching. Render cap per group not
  needed (183 max).
- Data fetching stays with the caller (P3-01) — the component is pure props, so the harness can feed fictional data.

### EmployeeSearchSelect.jsx (owned; aria only)
- `useId()` → listbox id + option ids (`${base}-opt-${i}`); input gets `aria-controls={listId}` and
  `aria-activedescendant={open && matches[active] ? optionId(active) : undefined}`.
- Non-option rows inside the listbox ("No employee matches…", "Showing the first 50") get `role="presentation"`
  (today they are bare `<li>` children of a listbox — an a11y violation). No behaviour change.
- Three instances on Leave Management → useId keeps ids unique.

## 3. Tests
- Parser: `backend/scripts/parse-codes-check.mjs` (node, imports the frontend ESM file directly — frontend
  package.json is `"type":"module"`; no new test runner). ~25 cases: Excel column paste (\n and \r\n), CSV row with
  quotes, mixed text "12345 Ravi, 12346", duplicates, case "s012"→"S012", leading zero "01234" kept and not equal to
  "1234", word code + "/1234" code matched from the list, ".0" suffix, empty input, only headers, unknown vs ignored.
  All fictional codes.
- Browser: `backend/scripts/people-picker-check.py` — bundle a harness entry (`backend/scripts/harness/people-picker.jsx`,
  new) with the frontend's esbuild to a scratch dir, serve on 3207, Chromium: search, tick dept, partial tick,
  include Left + badge, tray count/remove/clear, paste add + not-found + ignored, 390px, 0 page/console errors.
  The same harness mounts EmployeeSearchSelect ×2 → aria-controls points at an existing listbox, activedescendant
  follows ↑/↓ and matches an existing option id, ids unique across instances, unset when closed.
  `--base`: harness built against origin/main's EmployeeSearchSelect → aria checks fail.
- Plus a real-app check: local dist + scratch DB + hr login, Leave Management → Apply Leave picker: aria attributes
  present, pick still works, 0 errors.
- jest full suite before/after (no backend change expected → counts identical).

## 4. Risks
- Harness bundle lives outside Vite; Tailwind classes won't style it — behaviour only, screenshots not meaningful.
- Space is a separator, so a code containing a space would split — none in production (0 rows).
- 141 departments: collapsed-by-default keeps the DOM small (~800 rows max when all expanded — acceptable).

## 5. Questions for the planner
Q1 Parser matches against the master list (because 2 live plant codes fit no pattern) — OK? Fallback pattern mode only
   when no list is given.
Q2 PeoplePicker is props-only (caller fetches; caller passes Active + Left if it wants the Left toggle) — OK, or should it
   fetch `/employees` itself?
Q3 Paste box inside PeoplePicker (so P3-01 gets "paste or tick" in one component) — or keep paste separate?
Q4 Browser test via an esbuild harness under backend/scripts/harness (no App.jsx route, since App.jsx isn't mine) — OK?
