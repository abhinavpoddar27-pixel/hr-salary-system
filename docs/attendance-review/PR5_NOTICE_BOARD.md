# Attendance enforcement PR-5 — mid-month notice board

Branch `feat/attendance-review-notice-board` (from main 75d60ee6). Private plan: project `claude/attendance-review/PLAN_enforcement_v2.md` (Phase 3, D-8, D-9, MP-2).
Repo is PUBLIC — synthetic codes only in tests and docs.

## What it does
A printable A4 notice for "the 1st of the month up to a chosen day" (default the 15th), built from the SAME engine as the
monthly review (same basis, rules, standing leave-outs, release days as detected). Admin only (Attendance Review tab →
"Notice board").

Listed (name + code + department + counts, no ₹, no minutes — D-9):
- counted lates ≥ `notice_late` (4) — loading staff not assessed for lates, as in the review;
- counted early exits ≥ `notice_early` (3) — early-exempt people and contract loaders not counted, as in the review;
- personal missed punches ≥ `board_miss_punch_min` (3) — MP-2.

"On time every day" list (D-8): assessed for both lates and early exits, 0 lates, 0 early exits, 0 missed punches, and
assessed full days ≥ `board_spotless_min_share` (0.75) of the Mon–Sat days in the range.

Footer in Hindi + English (config `board_footer_en` / `board_footer_hi`, `{date}` = last attendance day covered).

Every print is recorded (audit_log, stage `ATTENDANCE_REVIEW_BOARD_PRINT`, new_value = JSON snapshot of who was named)
so PR-7 and effect tracking can read board appearances per person. No schema change.

## Rules decided while building (flag if wrong)
1. Range is always 1st → chosen day of one month (cumulative "so far"); not an arbitrary window.
2. Missed punch = worked-status row with `is_miss_punch = 1` (any type), on a day that is not a bulk-failure day
   (≥ `bulk_miss_punch_day` = 40 miss-punch rows plant-wide). Matches the plan's "19 people with 3+ in September".
   The admin can add more days to skip (e.g. a power cut) on the screen. Days from today (IST) on are never counted
   (a shift still open is not a miss punch).
3. Held people are not shown; left-out people (standing rules) are not shown.
4. Spotless excludes loading staff (lates not assessed) and early-exempt people (exits not assessed).
5. What is printed is what the server recomputes at print time (the print POST returns the board it recorded).

## Files
- `backend/src/services/attendanceReviewService.js` — `noticeBoard()`, optional `to` through sqlParams/loaders, 3 thresholds + 2 footer keys.
- `backend/src/routes/attendanceReview.js` — `GET /board`, `POST /board/prints`.
- `frontend/src/components/attendanceReview/AttendanceReviewBoard.jsx`, `frontend/src/utils/noticeBoardHtml.js`.
- `AttendanceReviewTab.jsx` (third view), `AttendanceReviewConfig.jsx` (labels + wording), `utils/api.js`.
- Tests `backend/src/__tests__/attendanceReviewNoticeBoard.test.js`; browser `backend/scripts/attendance-review-board-check.py`.

## Protected files
salaryComputation.js, dayCalculation.js, recompute.js, schema.js, payroll.js — NOT touched.
