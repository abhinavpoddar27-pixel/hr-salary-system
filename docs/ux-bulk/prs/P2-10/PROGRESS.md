# P2-10 + P8-06 PROGRESS

## RESUME
Branch `feat/permissions-nav-guard`, worktree /home/claude/wt-p2-10, port 3403. Read PLAN.md. Phase 1 (build) in progress — rulings below. Do NOT edit files you do not own; do NOT touch utils/api.js; never commit dist.

## Steps
- [x] Read head, common rules, CLAUDE.md (PR rules, P1-12 hook order)
- [x] Read permissions.js, auth.js /permissions, App.jsx, Sidebar.jsx, Header.jsx, Login.jsx, index.html, vite.config.js
- [x] Built dist, ran `phase0-diag.py` (scratch DB, 5 roles): BEFORE sidebar sets + per-route 403s
- [x] Production read-only counts: users per role; page views per role 90 d (counts only)
- [x] PLAN.md with BEFORE/AFTER role × nav-item table + questions
- [x] Planner go + rulings
- [x] jest baseline (flock): 115 suites / 2040 tests
- [x] permissions.js additions + permissionsMatrix.test.js 15 (2 fail on the old matrix: hr, finance)
- [x] usePermissions.js, NoAccess.jsx, NotFound.jsx (+ utils/appInfo.js)
- [x] Sidebar perm keys; App Guard + 404; Header Settings gate
- [x] Name + version define (Login, Sidebar, index.html, vite.config.js) — build OK, dist shows v1.0.0 · <sha>
- [ ] permissions-nav-check.py (+ --base on 8abee969)
- [ ] self-debug, user simulation, v2; merge origin/main; jest after; push

## Rulings (12 Oct)
- Owner: Q5 (A) follow the matrix — viewer 5 items, supervisor 2, other pages "You don't have access". Q3 (a) /settings/* admin only.
- Planner: Q1 yes — permissions.js additions in PLAN §3.1 (additions only, no sales keys) + jest test pinning admin/hr/finance
  see today's sidebar. Q2 fail open + amber "Couldn't load your access" line. Q4 "HR & Salary System", company names as
  Sidebar sub-line. Q6 "v<pkg> · <shortsha>", RAILWAY_GIT_COMMIT_SHA first, fallback "dev".
- R3 + supervisor on-leave-today 403 → planner registers (not this PR).

## CLAUDE.md entry
(written at the end)
