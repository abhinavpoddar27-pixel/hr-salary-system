---
name: session-handoff
description: End-of-session handoff — updates CLAUDE.md Section 0 so the next session starts with full context
---

# /session-handoff — End of Session Handoff

Run this command at the END of every Claude Code session, before closing.

## Step 1: Gather what changed this session

Run these commands and collect the output:

```bash
git log --oneline -10
git diff HEAD~3 --stat
git status
```

## Step 2: Update CLAUDE.md Section 0

Open `CLAUDE.md` and find or create "Section 0: Last Session" at the very top of the file (before Section 1). Replace its entire contents with:

```markdown
## Section 0: Last Session
- **Date:** [today's date]
- **Branch:** [current branch]
- **Last commit:** [hash + message from git log]
- **Files changed this session:**
  - [filename] — [one-line description of what changed]
  - [filename] — [one-line description of what changed]
- **What was fixed/built:** [1-2 sentence summary]
- **What's fragile:** [anything that might break if touched — be specific about file + function]
- **Unfinished work:** [anything started but not completed]
- **Known issues remaining:** [bugs or gaps discovered but not addressed]
- **Next session should:** [specific recommended first action]
```

Fill in every field based on the actual git diff and your knowledge of what happened during this session. Do NOT leave any field as a placeholder — write real content or "None" if not applicable.

## Step 3: Commit

```bash
git add CLAUDE.md
git commit -m "docs: session handoff [today's date]"
```

## Rules
- Be honest about what's fragile. Future you depends on this.
- If something broke and was partially fixed, say so explicitly.
- "Unfinished work" prevents the next session from duplicating effort.
- Keep each bullet to one line. This is a quick reference, not a report.
