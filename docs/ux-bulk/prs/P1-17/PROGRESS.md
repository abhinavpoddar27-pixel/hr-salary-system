# P1-17 — PROGRESS

## RESUME (re-read after any compaction)
- Branch: `fix/import-month-and-dead-checkbox` (base origin/main 868f5389). Worktree /home/claude/wt-p1-17 only.
  Never push to main; no PR open/merge. Port 3117 only.
- Spec: `docs/ux-bulk/prs/P1-17/PROMPT.md`. Plan: `docs/ux-bulk/prs/P1-17/PLAN.md`.
- Current phase: **COMPLETE — handed off** (planner "go" 11 Oct 2026). Do NOT open or merge a PR.
- Done steps are not redone; continue from the first step whose status is not `done`.
- Only `frontend/src/pages/Import.jsx` + one `fresh` line in `utils/api.js` (getImportHistory) may change in frontend/src (+ dist, + new check script). Backend untouched.
  Fictional data only (repo public). node_modules are symlinks — never commit them.
- Builds: `flock /tmp/vite.lock npm run build --prefix frontend`; full jest: `flock /tmp/jest.lock npx jest`.
  Kill only PIDs you started.

## Steps
| # | Step | Status | Result / sha |
|---|---|---|---|
| 0 | Phase 0 plan + progress | done | 81ebec5 |
| 1 | jest before | done | 96 suites / 1537 pass (tree = 868f5389 + docs) |
| 2 | Source edit Import.jsx + api.js `fresh` | done | 9efcdb5 |
| 3 | dist rebuild (own commit) | done | 88d719a |
| 4 | jest after | done | 96 suites / 1537 pass |
| 5 | check script written | done | backend/scripts/import-month-check.py (fictional T1701/T1702, Sep + Aug 2026 .xls built in-script, hr, port 3117) |
| 6 | script on branch dist | done | 38/38, two runs. v1 failed on node argv index + same-file reselect (no `change`) + multipart body unreadable from expect_request — script fixes only (route handler reads the body) |
| 7 | `--base` on origin/main dist | done | 3/3 on a 868f5389 archive: checkbox present, no month in body, Sep file imported while Oct selected |
| 8 | self-debug + user simulation | done | diff vs 868f5389 in frontend/src+backend = Import.jsx, api.js 1 line, new script; user sim = wrong month → right month → re-import → switch month → 2-file batch → 390px |
| 9 | CLAUDE.md Last Session entry | done | prepended at top |
| 10 | final push + HEAD == origin | done | verified with git ls-remote |

## Rulings
- Programme-level owner "go" 10 Oct 2026; planner "go" 11 Oct 2026.
- Q1: send the month; reword the hint; when >1 file is chosen show "only files for {Mon YYYY} will import".
- Q2: add `fresh` (no-cache) to getImportHistory in api.js (one line).
- Q3: re-import warning matches month+year across all companies.
