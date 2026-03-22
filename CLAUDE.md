# Session Context - Last updated: 2026-03-22

## Project: hr-salary-system
**Branch:** main
**Repo:** https://github.com/abhinavpoddar27-pixel/hr-salary-system.git

## Completed Phases
- **Phase 0**: Full codebase audit — 27 tables, 95 endpoints, 25 pages
- **Phase 1**: Dedup indexes, upsert import, reimport_count
- **Phase 2**: Overtime fix, behavioral pattern engine, employee profiles
- **Phase 3**: Finance audit module, correction workflow, HR bias detection
- **Phase 4**: Session tracking, client-side SessionTracker, admin analytics (4 tabs)
- **Phase 5**: Leave accrual, shift roster, compliance alerts, bulk PDF, attrition risk
- **Phase 6**: Advanced Session Analytics — 9 new endpoints, 9-tab dashboard (see below)

## Phase 6 Details — Advanced Session Analytics

### New Backend Endpoints (sessionAnalytics.js)
| Endpoint | Purpose |
|----------|---------|
| GET /user-sessions?username=&days= | Sessions list for a user with duration/events/pages |
| GET /session-replay?sessionId= | Full chronological event stream for one session |
| GET /user-journeys?days= | Page-to-page transition matrix + entry/exit pages |
| GET /time-on-page?days= | Avg/median/max duration per page + bounce detection |
| GET /feature-matrix?days= | User × feature adoption grid |
| GET /heatmap?days= | Day-of-week × hour-of-day activity density |
| GET /live-activity | Users active in last 5 minutes |
| GET /click-details?page=&days= | Per-page element click breakdown |
| GET /user-engagement?days= | 0-100 engagement score per user |

### New Frontend Tabs (SessionAnalytics.jsx — 9 tabs total)
1. **Overview** — enhanced with live user count, engagement score cards
2. **Users** — enhanced with engagement score column, clickable rows → replay
3. **Session Replay** — user picker → session list → vertical event timeline with color-coded dots
4. **Journeys** — transition table with flow bars, entry/exit page lists
5. **Pages** — original page analytics
6. **Click Map** — page picker → click breakdown chart + element detail table
7. **Deep Metrics** — time-on-page stats, feature adoption matrix, engagement gauges (SVG rings)
8. **Heatmap** — 7×24 CSS grid with color scale + live activity feed (auto-refresh 30s)
9. **Errors** — original error log

### Seed Script
`node backend/src/scripts/seedSessionData.js` — generates 2500+ synthetic events across 4 users

## Extras (from recent sessions)
- Per-page DateSelector, advance rounding to ₹100, SPA MIME fix
- Parser: dynamic name column + company fallback
- Reconciliation cartesian JOIN fix
- HR department correction flow
- 6-feature enhancement: CompanyFilter (all pages), Employee Master (mark-left),
  Leave Register (transactions + 4 tabs), Absent→CL/EL corrections,
  Loans (recover/skip), Manual Present Marking + Finance Flags

## Key Files
| File | Purpose |
|------|---------|
| backend/src/routes/sessionAnalytics.js | Session analytics (13 endpoints) |
| backend/src/scripts/seedSessionData.js | Test data seeder |
| frontend/src/pages/SessionAnalytics.jsx | 9-tab analytics dashboard |
| frontend/src/utils/api.js | All API helpers |
| frontend/src/components/shared/CompanyFilter.jsx | Global company filter |

## Database Tables (34 total)
Original 27 + day_corrections, punch_corrections, session_events, session_daily_summary, shift_roster, leave_transactions, manual_attendance_flags

## Resume instructions
You are continuing work on the **hr-salary-system** project (branch: main).
All phases 0-6 complete. Latest: Phase 6 advanced session analytics with 9 endpoints and 9-tab dashboard.
