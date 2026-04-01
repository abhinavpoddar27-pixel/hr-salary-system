# Session Context - Last updated: 2026-04-02 00:01:31

## Project: hr-salary-system
**Branch:** main
**Repo:** https://github.com/abhinavpoddar27-pixel/hr-salary-system.git

## Last 8 commits
b6cb891 claude: session-end 2026-04-02 00:01:30
eb9d385 Skip attendance_raw/monthly_imports cleanup in dedup — focus on attendance_processed
99b7f4d Rewrite dedup: single transaction with FK OFF, clean all related tables
2c3d5c7 Disable FK constraints during dedup, clean orphaned night_shift_pairs
44b7909 Fix FK constraint: reassign attendance_raw.import_id before deleting monthly_imports
68cbe29 Fix: attendance_raw has no month/year columns, use import_id join instead
15971bd Split dedup into non-transactional steps to handle UNIQUE conflicts gracefully
a562de8 Fix dedup: handle monthly_imports UNIQUE(month,year,company) constraint

## Files changed in last commit
CLAUDE.md
backend/data/hr_salary.db

## Resume instructions
You are continuing work on the **hr-salary-system** project (branch: main).
Last session ended: 2026-04-02 00:01:31
Recent changes: CLAUDE.md
backend/data/hr_salary.db
Greet the user and ask what they want to work on next.
