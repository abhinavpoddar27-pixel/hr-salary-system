# Wide layout — PROGRESS

## RESUME (read first)
1. Branch `feat/wide-layout` off origin/main 2cd0b26. Frontend display only. Do NOT push.
2. State: COMPLETE — all items done, awaiting owner review / push.
3. Checks: `npm run build --prefix frontend`, then `python3 backend/scripts/wide-layout-render.py . /home/claude/renders/after` and `python3 backend/scripts/wide-layout-check.py .`
4. Before renders: /home/claude/renders/before. Compare page by page.
5. Commits: harness script alone; source; dist alone.

## Owner rulings (binding)
- All 9 pages lose the 1280px cap (`max-w-screen-xl` → `w-full min-w-0`); cap only elements that look broken when wide.
- Every column stays individually visible — no merging of leave or recovery columns.
- Default view: Everything ≥ 768px, Review below. Remembered in localStorage (`salreg.view.v1`).
- Earned total = "Total Gross" card; Take Home total (held excluded, tooltip) = Take Home card. Gross column summed, no card.
- Leave-day sums kept in totals; Days blank. Stat cards auto-fit. 3+-badge rows may wrap to 2 lines.
- Pinning from md (768px) up only. Hold reason under Held badge moves into the badge tooltip (still visible truncated in the Employee pill).
- X1 stray "0" header fix; X2 drill-down sticky to the visible width (ResizeObserver); X3 header wraps on phones.
- Never touch backend, compute, API calls, mutations, gating, sort/filter logic, downloads.

## Done
- [x] Phase 0 plan approved (coordinator GO)

## Next
- [x] 8 other pages: class swap + caps
- [x] Stage 7: header, cards, checklist, X1
- [x] Stage 7 register: column model, view toggle, scroll window, pins, density, totals, X2 (first pass, built)
- [x] Build + render harness (PASS, 0 page errors) + check script (47/47)
- [x] Self-debug: removed unused useEffect/regTableRef; zero-muting did not apply (.table-compact td colour beats text-* on <td>) → scoped .salreg-mute / .salreg-mute-soft
- [x] User simulation in wide-layout-check.py: filter Held, Review ↔ Everything, expand, sort Net both ways, reload persistence, 390px
- [x] Commits (harness / source / check script / dist). NOT pushed.

## Found, not fixed (out of scope)
- MissPunch Action column shows a stray "0" next to Correct (`rec.miss_punch_resolved && …` renders 0). Pre-existing (in the before renders).
- Main area at 390px still scrolls sideways on 6 pages, same widths as before (wide tables / pipeline bar), unchanged by this PR.
