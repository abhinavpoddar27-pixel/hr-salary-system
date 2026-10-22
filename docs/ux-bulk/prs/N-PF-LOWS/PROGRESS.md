# N-PF-LOWS — PROGRESS (branch fix/pf-ceiling-input-checks, from main b2badcab)

## RESUME
Read PLAN.md + this file, then `git log --oneline origin/main..HEAD`. State: BUILT, verified, pushed. Nothing left but
planner review (no PR opened — planner opens it). Port 3504. Base build for `--base`: a detached b2badcab worktree with
frontend built (recreate: `git worktree add --detach <dir> b2badcab`, symlink node_modules, `npm run build --prefix frontend`).

## Rulings (planner, 22 Oct 2026)
- Q1 PF_CEILING_MAX = ₹1,00,000 (0 rows affected). Q3 a ceiling of 0 is refused (PF off = statutory flag).
- Q2 text in a number field → 400 NOT_A_NUMBER. **Test changed on purpose:** `moneyPermissionBatch4.test.js`
  "unreadable text keeps the stored value" → now "unreadable text → 400 NOT_A_NUMBER; … nothing written".
  Also by Q3: `pfCeilingApproval.test.js` same-date test now uses 19000 (was 0) and the `requestedCeiling` 0 line
  expects null (+ 100001 → null, 100000 → 100000).
- Q4 gross text → 400 NOT_A_NUMBER, negative → 400 GROSS_OUT_OF_RANGE.
- Q5 gross blank/0 + a changed split/ceiling → 400 GROSS_REQUIRED, whole save refused, nothing written.
- Q6 registered, not fixed (see Register).
- Q7 already pending: bank/IDs still saved; reply `notSaved: true`, message says what was and was not saved.
- Q8 request-change reuses `raiseSalaryChangeRequest` (one Pending per employee). Q9 min/max on the ceiling input.

## Done
0. Phase 0 plan — 5e49128
1. Code — e088bf8
2. Tests — new pfCeilingInputChecks.test.js (27); two pins flipped on purpose (above)
3. Check script backend/scripts/pf-ceiling-input-check.py — 29/29 ×2, --base 6/6

## Register (found, not fixed — Q6)
- Split can add up to more than the gross: basic+hra+da > 100 % on 17 salary_structures rows (1 latest Active row);
  2 latest Active rows where percents + special exceed the gross. No check on any writer.
- The Salary Input page's "already pending" toast (SalaryInput.jsx) is covered by API tests only, not a browser run.

## CLAUDE.md entry
## Last Session — 2026-10-22 (N-PF-LOWS: PF wage ceiling / split / gross input checks; one pending request on Salary Input)
**Branch `fix/pf-ceiling-input-checks`, NOT merged. MONEY-ADJACENT (input checks only, no pay formula).** Plan + log:
`docs/ux-bulk/prs/N-PF-LOWS/PLAN.md`, `PROGRESS.md`. Register "N-PF lows" from #167's review. Planner rulings Q1–Q9 (22 Oct).
- **Before:** `PUT /employees/:code/salary` silently kept the stored value for text ('abc', '15,000') in any split /
  ceiling field; accepted a ceiling of 0 or 1e9; read a blank / 0 / negative / text gross as "no gross", then dropped a
  changed split or ceiling and said "Salary structure updated"; the "already pending" reply did not say the new values
  were dropped (bank / IDs were saved). `POST /salary-input/request-change` stored new_structure with no checks and no
  one-pending rule (text components were even string-concatenated into new_gross).
- **Now:** `services/salarySplit.js` — present-but-unreadable → 400 `NOT_A_NUMBER` (+ `field`); ceiling must be > 0 and
  ≤ `PF_CEILING_MAX` (₹1,00,000) → else 400 `SPLIT_OUT_OF_RANGE` (only a SENT ceiling is checked); `splitDiffers`;
  `checkRequestStructure` (components/gross ≥ 0, percents 0–100, ceiling as above). Window route: gross text → 400
  NOT_A_NUMBER, negative → 400 GROSS_OUT_OF_RANGE, blank/0 gross + changed split/ceiling → 400 `GROSS_REQUIRED` — all
  before the first write (nothing saved). Bank-only save with no gross → "Saved — bank and ID details". Already pending →
  `notSaved: true` + "…the new salary values were not saved. Bank and ID details were saved." `raiseSalaryChangeRequest`
  moved to `services/salaryChange.js` and now also guards request-change (one Pending per employee → 200 alreadyPending +
  notSaved). `requestedCeiling` ignores a ceiling ≤ 0 or > ₹1,00,000. UI: ceiling input `min=1 max=100000`; window shows
  the server's save message; Salary Input shows an info toast for "already pending".
- **Fragile:** (1) `splitDiffers` lists the split fields — a new window field must be added there AND in
  `splitUnchanged`. (2) `PF_CEILING_MAX` lives in salarySplit.js and is mirrored by hand in the Employees.jsx input `max`.
  (3) Stage 7 still caps PF with the policy ceiling (PF-S7, unchanged). (4) request-change gross is now numeric-summed;
  a body with text numbers gives the right new_gross where it used to concatenate.
- **Verified:** jest 131 suites / 2336 tests all pass (new `pfCeilingInputChecks.test.js` 27, 22 fail on b2badcab; two pins
  flipped on purpose: moneyPermissionBatch4 text pin, pfCeilingApproval 0-ceiling lines). `backend/scripts/pf-ceiling-input-check.py`
  (Chromium, built dist, scratch DB, fictional T9601–T9607, real hr login, port 3504) 29/29 ×2 — ceiling 0 refused + window
  open + nothing saved, min/max on the input, gross blank + split → GROSS_REQUIRED, pending + split → notSaved message +
  request untouched + bank saved, normal ceiling change still a request, bank-only save message, 390 px, API probes, only
  the two intended 400s, 0 page errors; `--base` on b2badcab 6/6 (0 accepted, gross-blank split "saved", no "not saved").
  Drift query on the scratch DB 0 (no salary rows — this PR moves no pay). Frontend build clean.
- **Not tested:** Railway; production data (0 rows outside the new ranges); Safari/Firefox; the Salary Input
  "already pending" toast in a browser (API covered).
- **Found, not fixed (registered, Q6):** split adding up to more than the gross (17 rows > 100 %, 1 latest Active; 2 latest
  Active rows where percents + special exceed the gross).
