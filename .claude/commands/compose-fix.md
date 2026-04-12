---
name: compose-fix
description: Generate a high-quality bug fix prompt with all 7 guardrails — prevents regressions and ensures first-attempt success
---

# /compose-fix — Bug Fix Prompt Composer

This command generates a structured, scored fix prompt. It does NOT apply the fix itself — it produces a prompt you can review and then execute.

## INTAKE: Gather Information

Before generating anything, ask these questions if they weren't already provided:

1. **What's broken?** (one sentence — e.g., "Sachin Rana's OT pay is ₹0")
2. **Which employee code?** (for test validation)
3. **What should the correct value be?** (if known)

If the user already described the bug in this session, extract the answers from conversation context — don't re-ask.

## STEP 1: Classify the Bug

Based on the description, classify as exactly ONE type:

| Type | Signal | Fix Approach |
|------|--------|-------------|
| **FORMULA** | Math is wrong, wrong amount, ratio off | Find the exact line with the formula, change the math. Tiny fix — usually 1-5 lines. |
| **WIRING** | Feature exists but data doesn't flow | Trace the pipeline: where does the data enter, where does it disappear? Don't rewrite — reconnect. |
| **UPSERT** | Value is correct on first compute but zeroed on recompute | Check ON CONFLICT UPDATE SET clause — a column is missing. Add it. |
| **DATA** | Code is correct but database has bad values | Write a cleanup query. Don't change code. |
| **STALE_DIST** | Backend works (curl returns correct data) but UI shows old behavior | Rebuild frontend: `cd frontend && npm run build && git add dist/` |
| **DOUBLE_COUNT** | Value is too high — something counted twice | Find both counting mechanisms, add date-level deduplication. |

State the classification and WHY. Example: "UPSERT bug — advance_recovery shows correct value on first compute but resets to 0 when salary is recomputed. Classic ON CONFLICT missing column pattern."

## STEP 2: Identify Target Files

Based on the classification, identify the MINIMUM files that need to change:

```bash
# For FORMULA bugs — find the computation
grep -rn "THE_VARIABLE_NAME" backend/src/services/ --include="*.js"

# For WIRING bugs — trace the data flow
grep -rn "THE_TABLE_OR_FIELD" backend/src/routes/ backend/src/services/ --include="*.js"

# For UPSERT bugs — find all UPSERT statements for the table
grep -rn "ON CONFLICT" backend/src/services/ backend/src/routes/ --include="*.js" | grep "TABLE_NAME"

# For STALE_DIST — just frontend build
echo "Only: cd frontend && npm run build"
```

List each file with a ONE-LINE description of what changes. If more than 3 files need changes, STOP and ask: "This touches X files — should we split into smaller fixes?"

## STEP 3: Build the DO NOT MODIFY List

Based on the target files, list everything that must NOT be changed:

```
DO NOT MODIFY:
- computeEmployeeSalary() core formula (unless this IS the formula bug)
- saveSalaryComputation() UPSERT clause (unless this IS the UPSERT bug)  
- dayCalculation.js (unless the bug is in day calculation)
- Any existing API response shapes
- Any existing frontend table columns/sorting
- schema.js table definitions (unless adding a new column via safeAddColumn)
```

Adapt this list based on what the fix ACTUALLY touches — protect everything else.

## STEP 4: Generate the Prompt

Output a complete, copy-paste-ready prompt in this exact structure:

```
# FIX: [One-line bug description]

Read `CLAUDE.md` first. Read `.claude/commands/ship.md` for quality standards.

## BUG CLASSIFICATION
Type: [FORMULA / WIRING / UPSERT / DATA / STALE_DIST / DOUBLE_COUNT]
Evidence: [What makes this that type — one sentence]

## PHASE 0: READ BEFORE TOUCHING (mandatory — do not skip)

```bash
cat CLAUDE.md
git log --oneline -10
git diff HEAD~3 --stat
cat [TARGET_FILE_1]
cat [TARGET_FILE_2]
```

List every file you plan to modify with a one-line change description each. STOP. Wait for confirmation before proceeding.

## DO NOT MODIFY
[The list from Step 3]

## PHASE 1: DIAGNOSTIC (run before any code change)

```sql
-- Check the current state for the affected employee
SELECT * FROM [relevant_table] WHERE employee_code = '[CODE]' AND month = [M] AND year = [Y];
```

```bash
# Verify the broken pattern exists in the code
grep -n "[the pattern we're fixing]" [target_file]
```

Report what you find. If the pattern does NOT exist, STOP — the bug may already be fixed or may be in a different file.

## PHASE 2: FIX

[Exact description of what to change — find X, replace with Y. Never "investigate and fix" — always specific.]

Apply all changes to each file in a single edit, not incrementally.

## PHASE 3: VALIDATE

```bash
# 1. Syntax check
node -c [changed_file]

# 2. If frontend changed
cd frontend && npm run build

# 3. Start server and test
curl -s "http://localhost:3000/api/payroll/sanity-check?month=[M]&year=[Y]" -H "Authorization: Bearer <token>" | jq '.data.allPassed'
# Expected: true

# 4. Check the specific employee
curl -s "http://localhost:3000/api/payroll/salary-register?month=[M]&year=[Y]" -H "Authorization: Bearer <token>" | jq '[.data[] | select(.employee_code=="[CODE]")] | .[0] | {net_salary, gross_earned, total_deductions, ot_pay, ed_pay, payable_days}'
# Expected: [specific values]
```

## PHASE 4: REGRESSION CHECK (do not skip)

```bash
# Salary sanity — must return allPassed: true
curl -s "http://localhost:3000/api/payroll/sanity-check?month=[M]&year=[Y]" -H "Authorization: Bearer <token>" | jq '.data | {allPassed, passedCount, failedCount}'

# Drift check — must return 0 rows
curl -s "http://localhost:3000/api/payroll/sanity-check?month=[M]&year=[Y]" -H "Authorization: Bearer <token>" | jq '.data.checks[] | select(.status=="FAIL")'
```

If ANY check fails: STOP. Do not commit. Report what failed.

## PHASE 5: COMMIT

```bash
git add [changed files only]
git commit -m "fix: [descriptive message matching the bug]"
```

Then run /session-handoff to update CLAUDE.md Section 0.

## RULES
- cat every file before editing — never trust stale context
- Apply all changes in a single edit per file, not incrementally
- If the fix can be 5 lines, do not write 50
- If you find yourself changing more files than listed above, STOP and ask
- Never rewrite entire files — targeted find-and-replace only
```

## STEP 5: Score the Prompt

Score the generated prompt on these 7 dimensions (1-5 each, max 35):

|Dimension          |What to check                            |Score|
|-------------------|-----------------------------------------|-----|
|**Scope**          |Single bug only? No batching?            |/5   |
|**File targets**   |Specific files listed, not "investigate"?|/5   |
|**Pre-read**       |Mandatory cat of every target file?      |/5   |
|**DO NOT MODIFY**  |Explicit protection list present?        |/5   |
|**Validation SQL** |Specific employee test + sanity check?   |/5   |
|**Plan gate**      |Phase 0 stops and waits for confirmation?|/5   |
|**Smallest change**|Fix is minimal — not a rewrite?          |/5   |

Print the score: `Quality Score: XX/35`

If score < 28: automatically revise the weak dimensions and re-score. Do NOT output a prompt scoring below 28.

## STEP 6: Deliver

Output the final prompt inside a single code block, ready to copy-paste. No commentary before or after — just the raw prompt.
