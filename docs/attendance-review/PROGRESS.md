# Attendance Review build — PROGRESS

## RESUME
- Phase: **PR-1 merged (#82, live 10 Oct 2026). PR-2 tab built** on `feat/attendance-review-tab`, PR open — merge, then PR-3 exports.
- Decided 10 Oct 2026: D1 approved · D2 Option 2 (release days excluded everywhere, 0.9-day cut-off, improved = fell 40%+) + per-run overrides · D3 `docx` backend · D4 Kuldeep loading excluded · D5 configurable, default warning.
- Acceptance method (owner chose no DB snapshot): `backend/scripts/attendance-review-acceptance.js print-sql` → run the engine's own SQL in the SQL Console → `rows` mode feeds the output to the engine's JS stages and diffs against the private fixture. Private config + fixture live outside the repo.
- Sep 2026 result: PASS — 17 people, 14 deductions, 12.5 days; late notice 51 and early notice 38 = fixture; early-exit warnings 32.
  Known differences (documented): one person drops off the action list (4th early exit on a release day, Option 2); one Option-C count differs at exactly 60 min (written rule "≥ 1 h" kept; fixture used > 60).
- OWNER DECISION PENDING: the one re-measured person matches the fixture only with `remeasure.left_late = 'off'` (no stayed-late exemption — how it was done by hand). With the exemption he falls below the deduction rule. Config supports `system | shift | off`.
- Ground truth: private project doc `claude/attendance-review/sep2026_expected.json` (not in the repo — repo is public).

## PR table
| PR | Branch | Scope | Status |
|---|---|---|---|
| docs | `docs/attendance-review-handoff` | runbook, build plan, handoff, prompt | pushed, not merged |
| PR-1 | `feat/attendance-review-engine` | service + config/run tables + admin endpoints | merged #82, live |
| PR-2 | `feat/attendance-review-tab` | Analytics tab + config editor; preview takes overrides | built, tested, PR open |
| PR-3 | `feat/attendance-review-exports` | xlsx + docx exports | not started |
| PR-4 | later | write-back to `late_coming_deductions` | blocked on day-calc fix (L3) |

## PR-1 contents
- `backend/src/services/attendanceReviewService.js` — engine (read-only). `routes/attendanceReview.js` — admin-only API.
- `server.js` +1 mount line (above `/api/analytics`). `schema.js` +2 CREATE TABLE blocks, no seeds.
- Tests: `__tests__/attendanceReview.test.js` (23), `attendanceReviewApi.test.js` (5), helper `attendanceReviewFixture.js`.
- `scripts/attendance-review-acceptance.js` — `db` / `print-sql` / `rows` modes.
- API: omitted `releaseDays` / `overrides` on regenerate keep the draft's saved values; explicit `[]` clears.

## Log
- 2026-10-10 — September review done by hand; rules locked; runbook + skill; build designed; docs pushed.
- 2026-10-10 — D1–D5 decided; D2 rule derived from Sep data (reproduces fixture 17/18, one documented release-day difference); PLAN_PR1.md written.
- 2026-10-10 — PR-1 built. jest 83 suites / 1360 tests pass (baseline 81 / 1332). Live simulation on real server.js 16/16. Sep acceptance PASS. Payroll checks reproduce the 3 known Aug errors exactly. Salary drift unchanged (1 row, Feb 2026).
- 2026-10-10 — PR-1 merged as #82; production: tables created (empty), endpoint 401 without login, drift unchanged.
- 2026-10-10 — PR-2 built: Analytics → Attendance Review (admin only; sidebar + tab hidden for others; direct URL refused without an API call). Live preview / saved draft / final; release-day checkboxes pre-ticked from detection; overrides with reason (preview now applies unsaved overrides — `GET /?overrides=<json>`); Finalise blocked until the draft matches the screen; Rules & exclusions editor saves dated config versions. Times shown in IST. Browser check `backend/scripts/attendance-review-tab-check.py` 34/34; jest 83/1360.
