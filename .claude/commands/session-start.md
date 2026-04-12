---
name: session-start
description: Start-of-session context load — checks git state, reads last session handoff, detects stale dist
---

# /session-start — Beginning of Session Context Load

Run this at the START of every Claude Code session before doing any work.

## Step 1: Git State

Run all four commands and report the output:

```bash
echo "=== BRANCH ==="
git branch --show-current

echo "=== LAST 10 COMMITS ==="
git log --oneline -10

echo "=== RECENT CHANGES (last 3 commits) ==="
git diff HEAD~3 --stat

echo "=== UNCOMMITTED CHANGES ==="
git status --short
```

Report:
- Current branch (warn if NOT main)
- Any uncommitted changes (warn if yes — list the files)
- Last 3 commit messages (so you know what just happened)

## Step 2: Read Handoff Notes

```bash
cat CLAUDE.md
```

Find **Section 0: Last Session**. Read it carefully and report back:
- What was done last session
- What is flagged as **fragile** (these files need extra care)
- Any **unfinished work** to continue
- Any **known issues** that remain

If Section 0 does not exist, say: "No session handoff found — starting fresh. Ask what to work on."

## Step 3: Frontend Dist Freshness

```bash
echo "=== LATEST .jsx CHANGE ==="
git log -1 --format="%ai %s" -- "frontend/src/**/*.jsx" "frontend/src/**/*.js"

echo "=== LATEST dist BUILD ==="
git log -1 --format="%ai %s" -- "frontend/dist/"
```

Compare the two timestamps:
- If .jsx/js source is NEWER than dist → warn: **"⚠️ Frontend dist is STALE — must rebuild before deploy. Run: cd frontend && npm run build"**
- If dist is same age or newer → report: "Frontend dist is current ✅"

## Step 4: Status Report

Print a summary in this format:

```
═══════════════════════════════════════
SESSION START — [today's date]
═══════════════════════════════════════
Branch: main ✅ (or ⚠️ NOT on main!)
Uncommitted changes: None ✅ (or ⚠️ list files)
Frontend dist: Current ✅ (or ⚠️ STALE)
Last session: [one-line summary from Section 0]
Fragile areas: [list from Section 0, or "None flagged"]
Unfinished work: [from Section 0, or "None"]
═══════════════════════════════════════
Ready to work. What would you like to do?
```

## Rules
- This command is READ-ONLY. Never modify any files.
- Always run the actual git commands — never guess from memory.
- If CLAUDE.md doesn't exist at all, warn: "No CLAUDE.md found — project may not be initialized."
- If any git command fails (e.g., shallow clone), report the error and continue with the other steps.
