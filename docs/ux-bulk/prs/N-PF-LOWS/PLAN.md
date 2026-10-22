# N-PF-LOWS — PF wage ceiling / split input checks (the N-PF review Lows)
Branch `fix/pf-ceiling-input-checks` off main b2badcab. Port 3504. Phase 0 — plan only, no code yet.

## 1. The register items (source: Project `claude/ux-bulk/HANDOFF_ux_bulk_17Oct2026.md` §7 "N-PF-L" + §9 "N-PF lows";
review of #167 = SHIP with 4 Lows)
| # | Item (as registered) | What the code does today (FACT, main b2badcab) |
|---|---|---|
| L1 | Non-numeric ceiling silently dropped | `salarySplit.js readSplitNum()` (l.15): a value that is present but not a number (`'abc'`, `'15,000'`, `{}`) returns the STORED value. Same for every split field (basic/hra/da %, special %, other). The reply is `structureUnchanged` / "Saved" — the caller is never told. Pinned on purpose by `moneyPermissionBatch4.test.js` l.122 ("unreadable text keeps the stored value"). |
| L2 | No upper bound on the ceiling | `resolveSplit()` (l.39) only refuses `< 0`. `pf_wage_ceiling: 1e9` raises a request; `PUT /salary-input/approve/:id` → `salaryChange.js requestedCeiling()` (l.55) writes any number ≥ 0. A ceiling of `0` is also accepted. |
| L3 | Gross blank/0 ignores split/ceiling but says "updated" | `employees.js PUT /:code/salary` (l.695): `newGross = parseFloat(gross_salary) \|\| 0` (l.715) — blank, 0, negative and `'abc'` all become 0; both gross branches need `newGross > 0`, so a changed split/ceiling is dropped and the reply is "Salary structure updated" (l.840); the window toasts "Salary structure saved". |
| L4 | Already-pending reply drops new values silently | l.785: message "A salary change request is already pending finance approval for this employee." (F-6 made it an info toast). It does not say the NEW values were not kept, nor that bank / UAN / ESI no. / PT in the same save WERE saved (they are written before the request step, l.729-741). |

Consistency across the three writers (prompt ask):
- **Single path** `PUT /employees/:code/salary` — validates split range + ceiling ≥ 0 (above).
- **Salary Input** `POST /salary-input/request-change` (`salary-input.js` l.46) — no checks at all: `newStructure` is stored as sent
  (negative / text components, any percent, any ceiling). Approve then silently filters percents to 0–100
  (`requestedPercents`) and ceilings to finite ≥ 0 (`requestedCeiling`), and `parseFloat(x) || 0` turns text components into 0.
  The page itself sends only basic/da/hra/conveyance/other from `type=number` inputs (no percent, no ceiling). 0 calls since 3 Jun 2026.
- **Bulk revision kind** (`services/bulk/kinds/salaryRevision.js`) — rows carry only code + gross/% + date; the split and ceiling come
  from the STORED row via `buildRevisionStructure` → no user-typed ceiling/split to check. Gross: must be a number > 0, % −50…+100. No change needed.

## 2. Production (read-only, counts only, 22 Oct 2026)
- salary_structures 1,580: pf_wage_ceiling NULL **0**, 0 → **0**, text **0**, other than 15000 **0** (all 1,580 = 15000).
- Split percents: any of basic/hra/da outside 0–100 **0**; NULL **0**. basic+hra+da > 100: **17** rows (all rows); on latest rows of
  Active employees **1** of 384, and **2** whose percents + special exceed gross. (Not in scope — see Q6.)
- salary_change_requests 301 (2 Pending, 0 employees with 2+ Pending): ceiling key 264, text 0, ≠ 15000 0; negative or text
  components 0; new_gross ≤ 0 0; same-gross (split / ceiling) requests 0.
- Usage: `PUT /employees/:code/salary` 158 calls in 90 d (728 since Mar); `POST /salary-input/request-change` 37 ever, last 3 Jun 2026.
- Active employees with gross 0/NULL: 5 (none with a structure) — the only people who can hit L3 from the window.
→ (INFERENCE) the stricter checks below refuse nothing that exists today; they only stop new bad input.

## 3. Smallest change
**A. `services/salarySplit.js`** (shared by single path + request-change)
- `readSplitNum` → present but not a finite number → `{ error, field }` instead of the stored value (blank / missing still = stored).
- `resolveSplit` returns `{ error, code, field }`:
  - unreadable → code `NOT_A_NUMBER`, "<label> must be a number" (Q2);
  - percents outside 0–100 → `SPLIT_OUT_OF_RANGE` (unchanged text);
  - other allowance < 0 → `SPLIT_OUT_OF_RANGE` (unchanged);
  - ceiling ≤ 0 or > `PF_CEILING_MAX` → `SPLIT_OUT_OF_RANGE`, "PF wage ceiling must be more than ₹0 and at most ₹<max>" (Q1, Q3).
  Negative ceiling keeps code `SPLIT_OUT_OF_RANGE` (pfCeilingApproval test l.138 unchanged).
- New exported `checkRequestStructure(ns)` for request-change: components (basic, da, hra, conveyance, special_allowance,
  other_allowances, gross_salary) present → finite ≥ 0; percents 0–100; ceiling same rule. Same codes.
- `PF_CEILING_MAX` exported (one constant).

**B. `routes/employees.js` PUT `/:code/salary` only** (all checks BEFORE the first write, as N-19 does):
- gross: present but not a number, or < 0 → 400 `NOT_A_NUMBER` / `SPLIT_OUT_OF_RANGE` (Q4).
- L3: gross blank/0 AND (split ≠ stored OR ceiling ≠ stored) → 400 `GROSS_REQUIRED`
  "Enter the gross salary to change the split or PF wage ceiling — nothing was saved" (Q5: whole save refused, like every other
  400 here). Gross blank/0 with split/ceiling unchanged → bank/IDs save as today; reply message "Saved — bank and ID details"
  instead of "Salary structure updated".
- L4: already-pending reply keeps `alreadyPending: true`; message → "A salary change request is already pending finance approval
  for this employee — the new salary values were not saved. Bank and ID details were saved." (+ `notSaved: true`). No other
  behaviour change (bank fields still save — Q7).

**C. `routes/salary-input.js` POST `/request-change` only:** `checkRequestStructure(newStructure)` → 400 with the code, nothing
written. Statutory-flag ignore list unchanged. (One-pending rule NOT added — Q8.)

**D. `services/salaryChange.js requestedCeiling`:** also ignore a ceiling > `PF_CEILING_MAX` or ≤ 0 (defence for rows raised
before this PR; 0 such rows). 2 lines.

**E. Frontend `Employees.jsx` SalaryForm (one hunk):** ceiling input gets `min="1" max={PF_CEILING_MAX}`; nothing else — server
messages already reach the user (onError toast for 400, info toast for `alreadyPending`). Optional, Q9.

## 4. NOT touched
salaryComputation.js (PF-S7: Stage 7 still uses the policy ceiling — out of scope), schema.js, payroll.js, recompute.js,
bulk revision kind, POST /employees/bulk-import (its structure has no ceiling), approve/reject routes beyond D, SalaryInput.jsx,
api.js, CLAUDE.md, dist.

## 5. Tests — new `backend/src/__tests__/pfCeilingInputChecks.test.js` (fictional T95xx, real JWTs via the existing harness)
1 ceiling 'abc' → 400 NOT_A_NUMBER, nothing written (bank field in same body not saved). 2 basic_percent 'abc' → 400 (flips the
moneyPermissionBatch4 l.122 pin — Q2). 3 ceiling 0 / −1 / max+1 → 400 SPLIT_OUT_OF_RANGE; max → request raised. 4 blank ceiling →
stored kept (control). 5 gross '' + changed split → 400 GROSS_REQUIRED, nothing written. 6 gross '' + unchanged split + new account →
200, account saved, message "bank and ID details". 7 gross 'abc' / −5 → 400. 8 already pending + new split → `alreadyPending`,
`notSaved`, message names "not saved", request untouched, bank saved. 9 request-change: negative / text component → 400, no row;
percent 120 → 400; ceiling 1e9 → 400; normal body → 200 (control). 10 `requestedCeiling` ignores > max and 0. 11 bulk revision kind
unchanged (existing bulkSalaryRevision suite).
Then pfCeilingApproval, moneyPermissionBatch4, bulkSalaryRevision, salaryChangeSelfApproval, salaryFlagRevertAndApprove,
newEmployeeSalaryGate, statutoryWriter* suites, then FULL jest under flock.

## 6. Checks
`backend/scripts/pf-ceiling-input-check.py` (port 3504, built dist, scratch DB, fictional T95xx, real hr login; finance login for one
card check): window — ceiling 0 → error toast, window stays, nothing saved; gross cleared + split changed → error toast
"Enter the gross…"; pending request + new split → info toast "…not saved…"; normal ceiling change still → "submitted" toast;
API probes for 'abc' and request-change; 390 px; 0 page errors; 0 unexpected ≥ 400. `--base` on origin/main: ceiling 0 accepted,
gross-blank save says saved, pending toast has no "not saved". No money moves → drift query run once on the scratch DB as a control.

## 7. Risks
- R1 An API caller that relied on text being ignored now gets 400 (only the window and tests call this; window uses number inputs).
- R2 `PF_CEILING_MAX` too low would block a legitimate voluntary higher-wage PF set-up — hence Q1.
- R3 L3 refusal blocks a bank-detail save if the window also sends a changed split with blank gross — the message says what to do.

## 8. Questions
- Q1 Upper bound for the per-employee PF wage ceiling? Proposal ₹1,00,000 (statutory is ₹15,000, EPF notification says ₹25,000 from
  17 Sep 2026; employers may contribute on higher wages voluntarily). Alternative: ₹25,000, or "not above the gross".
- Q2 Present-but-unreadable numbers (ceiling, %, other) → 400 `NOT_A_NUMBER` instead of silently keeping the stored value? This flips
  the existing pin in `moneyPermissionBatch4.test.js` l.122 ("unreadable text keeps the stored value") — OK to change it?
- Q3 Ceiling 0 → refuse (PF is switched off via the statutory flag, not a 0 ceiling)? Today 0 is accepted.
- Q4 Gross sent as text or negative → 400 (today treated as "no gross")?
- Q5 L3: gross blank/0 + changed split/ceiling → refuse the whole save with `GROSS_REQUIRED` (nothing written, bank fields included),
  or save bank/IDs and reply 200 with `notSaved: true` + message? Proposal: refuse (same as every other 400 on this route).
- Q6 basic+hra+da (+special) > 100 % of gross — 1 active latest row today. Add a "split adds up to more than the gross" check now, or
  register it? Proposal: register (it changes N-19 behaviour, not a Low).
- Q7 L4: keep saving bank/IDs when a request is already pending (just say so in the message) — or refuse the save? Proposal: keep + say so.
- Q8 Salary Input request-change has no one-pending-per-employee rule (Employee Master has). Add it here (reuse
  `raiseSalaryChangeRequest`)? 0 duplicates today; page unused since June. Proposal: yes, same reply as Employee Master — or register.
- Q9 Frontend: add `min`/`max` on the ceiling input (Employees.jsx one hunk), or backend only?
