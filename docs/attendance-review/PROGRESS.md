# Attendance Review build — PROGRESS

## RESUME
- Phase: **PR-1 Phase 0 plan written** (`PLAN_PR1.md`), awaiting owner "go". No app code yet.
- Decided 10 Oct 2026: D1 approved · D2 Option 2 (release days excluded everywhere, 0.9-day cut-off, improved = fell 40%+) + per-run overrides · D3 `docx` backend · D4 Kuldeep loading excluded · D5 configurable, default warning.
- Next: on "go" build PR-1 per `PLAN_PR1.md` §2–5 on `feat/attendance-review-engine`; then acceptance vs private fixture.
- Open: source of a production DB snapshot for the acceptance run.
- Ground truth: private project doc `claude/attendance-review/sep2026_expected.json` (not in the repo — repo is public).

## PR table
| PR | Branch | Scope | Status |
|---|---|---|---|
| docs | `docs/attendance-review-handoff` | runbook, build plan, handoff, prompt | pushed, not merged |
| PR-1 | `feat/attendance-review-engine` | service + config/run tables + admin endpoints | plan written, awaiting go |
| PR-2 | `feat/attendance-review-tab` | Analytics tab | not started |
| PR-3 | `feat/attendance-review-exports` | xlsx + docx exports | not started |
| PR-4 | later | write-back to `late_coming_deductions` | blocked on day-calc fix (L3) |

## Log
- 2026-10-10 — September review done by hand; rules locked; runbook + skill; build designed; docs pushed.
- 2026-10-10 — D1–D5 decided; D2 rule derived from Sep data (reproduces fixture 17/18, one documented release-day difference); PLAN_PR1.md written.
