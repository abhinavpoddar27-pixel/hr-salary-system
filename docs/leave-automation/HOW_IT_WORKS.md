# Leave automation — how it works

Written for whoever has to run this, not for whoever wrote it.

## The short version

Leave used to be a button nobody pressed. `runLeaveAccrual` existed, one route called
it, and nothing else ever did — so earned leave was only ever as current as the last
time somebody remembered. It now recomputes itself whenever something that affects it
changes, with two hard limits: a finalized month is never touched, and salary never
recomputes on its own.

## The chain, end to end

```
   HR resolves a miss punch        finance approves or rejects it
              │                                  │
              └──────────────┬───────────────────┘
                             ▼
                   checkAutoStage6()            ← both counters at zero?
                             │  yes
                             ▼
              queue  day_calculate  →  queue  leave_recalc
                             │                      │
                             ▼                      ▼
                     recomputeDays()          recomputeLeaves()
               (Stage 6 + late deduction)   (whole year, from January)
                             │                      │
                   salary_stale = 1           leave_balances updated
                             │
                             ▼
              Stage 7 shows "needs recompute" — HR clicks Compute
```

Everything else — approving a leave, cancelling one, a comp-off decision, a reimport,
a DOJ change — enters the same chain at `queueLeaveRecalc`.

## Where each piece lives

| What | File | Notes |
|---|---|---|
| The rules | `backend/src/services/leaveEngine.js` | `computeLeavePlan` is pure; `applyLeavePlan` is the only writer |
| Stage 6 and Stage 7 | `backend/src/services/recompute.js` | one copy, shared by the route, the job queue and reimport |
| What triggers what | `backend/src/services/leaveTriggers.js` | `queueLeaveRecalc`, `checkAutoStage6`, the flags |
| The job types | `backend/src/services/jobQueue.js:92` (`leave_recalc`), `:122` (`leave_nightly`) | |
| The two crons | `backend/src/services/monthEndScheduler.js` | `'30 3 * * *'` = 09:00 IST sweep · `'35 18 * * *'` = 00:05 IST year boundary |
| The API | `backend/src/routes/phase5.js`, mounted at `/api/features` | |
| The screen | `frontend/src/components/leave/LeaveAutomationTab.jsx` | Leave Management → Automation, admin only |

### Every trigger call site

| Event | File:line |
|---|---|
| Leave approved | `routes/leaves.js:203` |
| Leave cancelled | `routes/leaves.js:274` |
| Leave rejected | `routes/leaves.js:303` |
| Manual adjustment | `routes/leaves.js:470` |
| Bulk adjustment | `routes/leaves.js:609` |
| Miss punch resolved (HR) | `routes/attendance.js:160` |
| Miss punches bulk-resolved | `routes/attendance.js:188` |
| Finance approves a miss punch | `routes/financeAudit.js:1557` |
| Finance rejects a miss punch | `routes/financeAudit.js:1613` |
| Finance bulk-approves | `routes/financeAudit.js:1652` |
| Finance applies leave to an absence | `routes/financeAudit.js:646` |
| Comp-off finance review | `routes/compensatoryOff.js:271` |
| Comp-off bulk review | `routes/compensatoryOff.js:356` |
| Comp-off deleted | `routes/compensatoryOff.js:408` |
| Employee created | `routes/employees.js:313` |
| Employee DOJ or type changed | `routes/employees.js:504` |
| Import confirmed / reimported | `routes/import.js:526` and `:531` |

Every one of them fires **after** its own transaction has committed and is wrapped in
`safeTrigger`, so a trigger that throws can never fail the thing that caused it.

## The rules, in plain language

**Earned leave accrues on days actually worked.** That is
`days_present + half the half days + days worked on a weekly off + EL already used`.
Paid Sundays and paid holidays do not count — they are paid, not worked. Comp-off is
not added separately because day calculation already folds it into `days_present`.

**Nothing accrues until 180 days worked in the same calendar year.** Below that the
screen still shows the days worked and how many are left to go, but the earned figure
is zero. At or above it, one earned leave day for every twenty days worked.

**Casual leave is 7 days a year**, less one day for every two months after February
that the employee joined. Nov or Dec joiners get 2.

**Both lapse on 31 December.** No carry-forward, no encashment.

**A finalized month is never recalculated.** If something changes against one, it
appears in Leave Management → Automation under "changes that landed on a finalized
month", and HR decides what to do.

**Salary never recomputes by itself.** Stage 6 marks its rows, Stage 7 shows a banner
with the employee codes, and HR clicks Compute. Finalising is blocked while that count
is above zero; an admin can override with a written reason, which is recorded.

## Switching it on

Automation ships **off**. Nothing is written until the owner turns it on, deliberately,
in this order:

1. **Merge and deploy.** Nothing changes yet — `leave_automation_enabled` is `false`,
   so every trigger records `skipped_disabled` and queues nothing.
2. **Leave Management → Automation → Upload EL-given list.** The sheet the owner keeps
   of earned leave already given outside the system. Columns: Employee Code, Employee
   Name, Company, Year, Month, EL Days, How Given (*Leave taken* / *Paid in salary* /
   *Paid in cash*), Paid In Salary Month, Paid In Salary Year, Remark. The upload shows
   accept/reject per row before anything is written; commit when it looks right.
   If there is genuinely no such list, click **There is none** instead.
   Until one of those two things happens, applying a recompute is refused — by the
   backend, not just the button.
3. **Preview EL recompute.** A dry run: what every employee's balance would become and
   why. Download the CSV, check it against whatever the owner has on paper.
4. **Apply.** Type `APPLY 2026` to confirm. This is the first time balances move.
5. **Turn Automation ON.** From here the chain above runs by itself.

`Auto day calculation` can stay on throughout — it only runs Stage 6, never salary.

## Reading the state

Leave Management → Automation shows the switches, how many jobs are waiting, when the
nightly sweep last ran, and the last run of each kind. `leave_recompute_runs` is the
full history; a row with status `skipped_disabled` means automation was off when
something tried.

## Things worth knowing

- **Historical SL still renders.** Sick leave was abolished as a live type: nothing can
  create one, and an old SL row no longer moves pay. The column and every report that
  shows it are untouched.
- **A manual adjustment survives a recompute.** The engine reads `leave_transactions`
  and folds credits and debits back in, so a credit HR gave by hand is never wiped.
  Rows written by the finance correction screen are excluded — day calculation already
  counts those days, and counting them twice would debit the employee twice.
- **A CL opening HR set by hand is respected.** The engine will not overwrite it; if it
  disagrees with the entitlement for that DOJ, the preview says so in the Notes column.
- **The nightly sweep is queued, not run inline.** The 09:00 IST cron drops a
  `leave_nightly` job and returns, so a long sweep cannot block the scheduler.
- **The server clock is UTC.** Both crons are written in UTC with the IST time in a
  comment beside them.
