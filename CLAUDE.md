# Session Context - Last updated: 2026-03-20

## Project: hr-salary-system
**Branch:** main
**Repo:** https://github.com/abhinavpoddar27-pixel/hr-salary-system.git

## Completed Phases (all 5 + extras)
- **Phase 0**: Full codebase audit — 27 tables, 95 endpoints, 25 pages documented
- **Phase 1**: Dedup indexes (attendance_raw, attendance_processed), upsert import strategy with audit logging, reimport_count tracking
- **Phase 2**: Overtime bug fixed (overtime_minutes never populated), early departure detection, behavioral pattern engine (7 patterns + regularity score + narrative), employee profile API + BehavioralProfile component
- **Phase 3**: Finance audit module — day_corrections + punch_corrections tables, finance report with salary comparison, correction workflow with dropdown reasons, HR bias detection (admin-only), full audit trail
- **Phase 4**: Session tracking — session_events table, client-side SessionTracker (batched flush, idle detection, sendBeacon), admin analytics dashboard (overview, users, pages, errors)
- **Phase 5**: Leave accrual (CL/EL auto-accrue), shift roster (CRUD + auto-rotate), compliance alerts (PF/ESI/gratuity), bulk salary slip PDF, attrition risk scoring (0-100)
- **Extra**: Per-page DateSelector with quick presets, advance amounts rounded to nearest ₹100, SPA fallback MIME type fix

## Latest fixes (2026-03-20)
- **Parser: dynamic name column** — no longer hardcodes col 13; scans for "Emp. Name" label dynamically
- **Parser: company fallback** — scans cols 4-15; if empty, import route resolves from employee master
- **Reconciliation: cartesian JOIN fix** — replaced LEFT JOIN attendance_raw with pre-aggregated subquery (was inflating total records to 1.28M)
- **HR department correction flow** — new endpoints POST /reconciliation/update-departments and /add-to-master, editable department fields in ReconciliationPanel UI

## Key files
- backend/src/services/parser.js — EESL XLS parser (dynamic name/company detection)
- backend/src/routes/import.js — import pipeline + reconciliation + department correction endpoints
- frontend/src/pages/Import.jsx — upload UI + reconciliation panel with inline dept editing

## Database tables (32 total)
Original 27 + day_corrections, punch_corrections, session_events, session_daily_summary, shift_roster

## Resume instructions
You are continuing work on the **hr-salary-system** project (branch: main).
All 5 phases of the feature enhancement prompt are complete.
Latest work: fixed parser name/company detection bugs, reconciliation cartesian JOIN, added HR department correction workflow.
Greet the user and ask what they want to work on next.
