# 03 — Leave Frontend

> READ-ONLY audit. Repo `/home/user/hr-salary-system`, branch `docs/leave-inventory`, from `origin/main@3806a6d`. Agent 3 of 4 — scope: leave frontend.
> **Method note (FACT):** every file under `frontend/src` carries mtime `2026-09-15 14:18`, identical to the `frontend/dist` build time — a git-checkout artifact. Mtime comparison therefore proves nothing; **all DIST STATUS results below come from content-grep of `frontend/dist/`**, validated with a negative control (a nonsense string correctly returns no match).
> **Enforcement note (FACT):** `backend/src/config/permissions.js` is referenced only by `backend/src/middleware/roles.js:13` and `backend/src/routes/auth.js:178`. `requirePermission` is applied to **no** route in `backend/server.js`, and the frontend helper `getUserPermissions` (`frontend/src/utils/api.js:293`) has **zero consumers** in `frontend/src`. Wherever a "permissions.js roles" field appears below, it is **advisory only and not enforced**.

---

## A. Surface inventory

### A1. `frontend/src/pages/LeaveManagement.jsx` — centrepiece (1102 lines)

**Route (FACT):** `App.jsx:188` — `/leave-management`, wrapped in `<RequireAuth>` only. Lazy-imported at `App.jsx:40`.
**Sidebar (FACT):** `Sidebar.jsx:50` — `{ label: 'Leave Management', icon: '📋', to: '/leave-management' }`. **No `adminOnly` / `financeOnly` / `hrFinanceOrAdmin` flag → visible to every authenticated role** (`Sidebar.jsx:145-155` shows the only gate flags that exist).
**permissions.js (FACT):** `leave-management` listed for `hr` (`permissions.js:5`) and `admin` via `'*'` (`:2`). **Not** listed for `finance`, `supervisor`, `viewer`, `employee`.
**Backend mount (FACT):** `backend/server.js:206` — `app.use('/api/leaves', requireAuth, require('./src/routes/leaves'))`. `routes/leaves.js` contains **no** role check and **no** 403 return (verified by grep for `req.user|role|403` — only `req.user?.username` for audit attribution at `:130, :206, :227, :244, :401, :521`).

**Page-level state (FACT):** month/year via `useDateSelector` (`:183`), company via `CompanyFilter` (`:302`), six main tabs declared `:173-180`.

#### Tab 1 — `applications` (`:327-505`)
- **Shows:** 4 stat cards (Total/Pending/Approved/Rejected, `:285-290`); status pill-tabs All/Pending/Approved/Rejected (`:292`); type dropdown from `LEAVE_TYPES` (`:359-362`); employee search (`:364`); 9-column table — Employee, Type, From, To, Days, Reason, Status, Applied, Actions (`:379-387`); expandable drill-down row rendering `<EmployeeQuickView>` + a "Leave Details" grid (`:448-468`).
- **Writes:** `approve.mutate(l.id)` (`:429`) and reject-with-reason modal (`:481-503`). Approve hardcodes `{ approved_by: 'admin' }` (`:254`) rather than the real user — **FACT, `:254`**.
- **Apply Leave modal** (`ApplyLeaveModal`, `:29-171`), opened by a button rendered only on this tab (`:305-309`): employee select, live balance cards for CL/EL (`:95-113`), leave-type select, auto-calculated days (`:59-64`), start/end dates, reason, **mandatory HR remark** (`:146-149`), and a **hard client-side block** when CL/EL balance is insufficient (`:74-76`, `:151-156`) — LWP and Comp Off are exempt.
- **`LEAVE_TYPES` (FACT, `:22-27`):** `CL` Casual Leave, `EL` Earned Leave, `LWP` Leave Without Pay, `Comp Off` Compensatory Off. **No SL option here.**
- **api.js calls →** `getLeaveApplications` → `GET /leaves` · `submitLeaveApplication` → `POST /leaves` · `approveLeave` → `PUT /leaves/:id/approve` · `rejectLeave` → `PUT /leaves/:id/reject` · `getEmployeeLeaveBalance` → `GET /leaves/balances/:code` · `getEmployees` → `GET /employees`.

#### Tab 2 — `balances` (`:508-557`)
- **Shows:** search box, year label, 7-column read-only table — Code, Name, Department, Company, CL, EL, Total. Query gated `enabled: mainTab === 'balances'` (`:223`).
- **Writes:** none.
- **api.js →** `getLeaveBalancesList` → `GET /leaves/balances`.

#### Tab 3 — `register` (`:560-601`)
- **Shows:** 7-column read-only monthly register — Code, Name, Department, Leave Type, Days, Date, Reason. Gated `enabled: mainTab === 'register'` (`:231`).
- **Writes:** none.
- **api.js →** `getLeaveRegister` → `GET /leaves/register`.

#### Tab 4 — `adjustments` (`:604-706`) — **DIRECT BALANCE WRITE**
- **Shows:** a 5-field "New Adjustment" form — Employee, Leave Type (**CL/EL only**, `:626-629`), Transaction Type (**Credit/Debit**, `:633-636`), Days, Reason (`:609-645`); plus per-employee "Adjustment History" table — Date, Leave Type, Type, Days, Reason, By (`:672-700`).
- **Writes:** `adjustMutation` (`:236-244`) posts a **direct credit/debit against a leave balance with no approval step**. The only guard is `disabled={!adjForm.employee_code || !adjForm.days}` (`:650`) — **reason is not required** (contrast with the mandatory HR remark on the application flow).
- **api.js →** `adjustLeave` → `POST /leaves/adjust` · `getLeaveTransactions` → `GET /leaves/transactions/:code`.

#### Tab 5 — `comp_off` → `CompOffTab` (`:712-720`, component `:729-1102`)
- **Shows:** 4 KPI cards (Pending / Approved / Rejected / Total Approved Days, `:849-868`); status pill-filter all/pending/approved/rejected (`:933-944`); an 11-column table — checkbox (finance only), Employee, From, To, Days, Reason, HR Remark, Status, Applied, Finance Remark, Actions (`:968-980`).
- **Writes (role-split):**
  - HR/admin only (`isHrOrAdmin`, `:733`): "New Comp-Off / OD Request" form with **contractors filtered out client-side** (`:743-746`, note text `:887`) and a **mandatory HR remark** (`:911-918`, `:820`) → `createCompOff`.
  - Finance/admin only (`isFinanceOrAdmin`, `:732`): per-row Approve/Reject (`:1029-1040`) and a bulk toolbar (`:947-961`) → both funnel through a **mandatory-finance-remark modal** (`:1061-1099`, enforced `:828-830` and `:1089`).
  - HR-but-not-finance: a "Cancel" button on pending rows with a `window.confirm` (`:1041-1050`) → `deleteCompOff`.
- **Role source (FACT, `:731`):** `const role = user?.role` — **raw, not passed through `normalizeRole`**, unlike `Sidebar.jsx:239`.
- **api.js →** `getCompOffList` → `GET /comp-off` · `createCompOff` → `POST /comp-off` · `reviewCompOff` → `PUT /comp-off/:id/finance-review` · `bulkReviewCompOff` → `PUT /comp-off/bulk-review` · `deleteCompOff` → `DELETE /comp-off/:id`.
- **Backend gates (FACT, `backend/src/routes/compensatoryOff.js`):** `POST /` and `DELETE /:id` → `requireHrOrAdmin` (`:68, :339`, 403 at `:20-22`); `GET /` → `requireHrFinanceOrAdmin` (`:161`, 403 at `:27-29`); `GET /pending`, `PUT /:id/finance-review`, `PUT /bulk-review` → `requireFinanceOrAdmin` (`:188, :212, :272`, 403 at `:34-36`). Mounted `backend/server.js:219`.

#### Tab 6 — `gate_passes` → `<GatePasses />` (`:709`) — see A2.

**Dead import (FACT):** `getLeaveSummary` is imported at `LeaveManagement.jsx:3` and never called anywhere in the file.

---

### A2. `frontend/src/components/GatePasses.jsx` (368 lines)

**Route (FACT):** none of its own — rendered only as the `gate_passes` tab of LeaveManagement (`LeaveManagement.jsx:709`). **Sidebar:** no entry. **permissions.js:** no dedicated key; reached via `leave-management`.
- **Shows:** 3 summary cards — Total This Month / Quota Breaches / Cancelled (`:57-70`); search + type filter (**Short Leave / Half Day**, `:80-84`) + status filter (`:85-89`); 10-column table — Employee, Code, Dept, Date, Type, Duration, Leave Until, Remark, Status, Actions (`:102-111`), with a red **`BREACH`** badge when `r.quota_breach` (`:137-139`).
- **Writes:** "+ New Gate Pass" modal (`CreateGatePassModal`, `:175-368`) — typeahead employee search, date, radio Short Leave (3 hrs) / Half Day (`:306-315`), read-only computed duration (`:215`, `:319-323`), **live quota display with colour escalation** (`:256-258`, `:324-332`), **mandatory remark** (`:241-246`, `:336-346`), and a **quota-breach override**: on a `quota_warning` error the mutation re-fires with `force_quota_breach: true` after a `confirm()` (`:224-239`); the button label flips to "Create Gate Pass (Quota Breach)" at `used >= 2` (`:361`). Also per-row Cancel with hardcoded reason `'Cancelled by HR'` (`:147`).
- **api.js →** `getShortLeaves` → `GET /short-leaves` · `createShortLeave` → `POST /short-leaves` · `getShortLeaveQuota` → `GET /short-leaves/quota/:code` · `cancelShortLeave` → `PUT /short-leaves/:id/cancel`.
- **Backend gates (FACT, `backend/src/routes/short-leaves.js`):** `POST /` and `PUT /:id/cancel` → `requireHrOrAdmin` (`:44, :264`); `GET /`, `GET /quota/:employeeCode`, `GET /:id` → `requireHrFinanceOrAdmin` (`:173, :212, :249`). Mounted `backend/server.js:221`.

---

### A3. `frontend/src/pages/EmployeeProfile.jsx` — `leaveRegister` tab (610 lines)

**Route:** `/employee-profile` (Sidebar `Sidebar.jsx:117`, **no gate flag**). **permissions.js:** `employee-profile` granted to `hr` (`:7`) and `finance` (`:21`).
- **Tab declared (FACT):** `:5` `TABS` array, label "Leave Register" at `:6`.
- **Shows (all read-only):** current-year balance KPI cards for **CL / EL / SL** (`:370-390`) with sub-line `Opening + Accrued − Used` (`:384`) — this is the **only place opening/accrued figures surface in the UI**; a "Total Applications" card (`:391-396`); a "Range Leave Summary" strip including `cl_used`, `el_used`, `od_days` ("OD / Comp-Off (range)"), `short_leave_days` ("Short Leaves (range)") (`:403-412`); a "Monthly Leave Breakdown" table with CL/EL/SL columns (`:425-450`); and a "Leave Applications Timeline" (`:457-490`).
- **Writes:** **none** — entirely read-only.
- **api.js →** data arrives inside the aggregate profile payload as `profileData.leaveUsage` (`:115`); no dedicated leave helper is called.

---

### A4. `frontend/src/pages/DailyMIS.jsx` — "On Leave Today" (1158 lines)

**Route:** `/daily-mis` (Sidebar `Sidebar.jsx:32`, **no gate**). **permissions.js:** `daily-mis` granted to `hr` (`:3`), `supervisor` (`:23`), `viewer` (`:24`).
- **Shows (FACT, `:888-1010`):** section header "Employees on Leave Today — N employees" (`:941`); department filter chips with counts (`:947-962`); rows grouped by leave type in the fixed order `['EL','CL','LWP','OD','SL']` (`:927`); each group rendered with a per-type colour from `LEAVE_TYPE_STYLE` (`:890-895`); per-row table — Employee, Dept, Type, From → To, Days, **Returns** (computed `nextDayAfter(r.end_date)`). Empty state: "No employees on leave today." (`:966`).
- **Writes:** none.
- **api.js →** `getOnLeaveToday` (`:147`) → `GET /leaves/on-leave-today` (`api.js:387-388`; backend `routes/leaves.js:639`).

---

### A5. `frontend/src/pages/DayCalculation.jsx` — leave columns + Apply-Leave panel (858 lines)

**Route:** `App.jsx:180` — `/pipeline/day-calc`, title "Stage 6: Day Calculation & Leave Adjustment". **Sidebar:** `Sidebar.jsx:41` as Payroll child "6. Day Calc" (no gate). **permissions.js:** `day-calc` → `hr` (`:4`).
- **Register columns (FACT):** `CL` with tooltip "CL used for Sunday granting" (`:342`), `EL` (`:343`), sortable `LOP` "Loss of Pay" (`:344-346`); LOP cell (`:418`); footer totals for cl/el/lop (`:455-457`); KPI "Total LOP" (`:261`); rows with LOP tinted amber (`:372`). Totals computed `:186-193`. **No OD column in this register** — OD appears in SalaryComputation (A6), not here. (State of absence: explicit.)
- **Detail panel — "Apply Leave" modal (FACT, `:524-620`), opened per-row at `:398` with tooltip `"Apply CL/EL/SL to absent days"` (`:400`):**
  - Employee header + absent-day count (`:527-539`).
  - **Three balance tiles: CL, EL, and SL** (`:541-560`), reading `cl_balance`/`el_balance`/`sl_balance`.
  - Negative-balance warning: "this will create a negative balance (LWP)" (`:563-573`).
  - **Leave-type dropdown with three live options: `CL (Casual Leave)`, `EL (Earned Leave)`, `SL (Sick Leave)`** (`:582-585`).
  - Date input clamped to the selected month, free-text reason, submit.
- **Writes:** `applyLeaveCorrection` (`:156`) → `POST /finance-audit/corrections/apply-leave` (`api.js:279`) — converts an absent day into a leave day, i.e. **a balance-affecting write with no approval step**.
- **Explainer text (FACT):** "No CL/EL deducted from Sunday logic — leaves are managed separately." (`:485`); "LOP = absent days not covered by CL/EL." (`:499`).
- **Legend (FACT, `:520`):** `AbbreviationLegend keys=['P','A','½P','WO','WOP','CL','EL','SL','LOP','LWP',...]` — includes `SL`.
- **api.js →** `applyLeaveCorrection`, `getEmployeeLeaveBalance` (`:149`).

---

### A6. `frontend/src/pages/SalaryComputation.jsx` — leave columns in the salary register (1006 lines)

**Route:** `/pipeline/salary` (Sidebar `Sidebar.jsx:42` "7. Salary"). **permissions.js:** `salary` → `hr` (`:4`), `finance` (`:18`).
- **Columns (FACT, all sortable, `:610-614`):** `CL` (tooltip "Casual Leave days consumed this month") · `EL` ("Earned Leave days consumed this month") · `LWP` ("Leave Without Pay days") · `OD` ("On-Duty / Comp-Off days (finance approved)") · **`SL` — but bound to `short_leave_days` with tooltip "Short Leave (gate pass) days-equivalent"**, i.e. the `SL` header here means *Short Leave*, not Sick Leave (`:614`).
- Cells `:729-733`; footer totals for od/short-leave `:884-885`. `LOP` also surfaces as a deduction line in the row drill-down (`:842`).
- **Writes:** no leave writes from this page.
- **Legend (FACT, `:979`):** `AbbreviationLegend` keys here do **not** include CL/EL/SL — only `LOP` among leave terms.

---

### A7. `frontend/src/utils/payslipPdf.js` — leave line items (335 lines)

**Route/Sidebar:** none (utility, invoked from payslip generation).
- **Register PDF (FACT):** `el: att.el_used || 0` (`:58`) — **only EL** is carried into the per-employee register row; `lateDed` folds `LOP` into the late/LOP deduction lookup (`:56`).
- **Individual payslip (FACT):** an attendance strip printing Present / Sundays / Payable / **LOP** (`:257-262`), followed by a conditional amber **"Leave Summary:"** block (`:264-280`) that emits, only when non-zero: **`CL`, `EL`, `SL`, `LWP`, `OD`, `Short Lv`, `Uninfo. Abs`** — read from `payslip.leaveSummary`. **`SL` is a live payslip line item** (`:269`).
- **Writes:** none (render-only).

---

### A8. `frontend/src/pages/Settings.jsx` — holiday master + leave policy (931 lines)

**Route:** `/settings/*` (`Settings.jsx:923` for the holidays sub-route). **Sidebar:** `Sidebar.jsx:126-134` — parent **`adminOnly: true`**, children "Holiday Master" (`:129`) and "Policy Config" (`:130`). **permissions.js:** no `settings` key exists for any non-admin role → admin-only via `'*'`. This is the **only leave-adjacent surface with a real UI role gate.**
- **Holiday Master (`HolidaysTab`, `:186-280`):** year selector; "Add Holiday" form — date, name, type (National default), isRecurring, applicableTo (`:201`, `:211-240`); a per-year table with a `window.confirm`-guarded Remove action (`:273`); empty state "No holidays configured for {year}" (`:263`).
  - **api.js →** `getHolidays` → `GET /settings/holidays` · `createHoliday` → `POST /settings/holidays` · `deleteHoliday` → `DELETE /settings/holidays/:id`.
- **Leave policy (`POLICY_GROUPS`, group "Sunday & Leave Rules", `:315-321`):** editable numeric keys `paid_sunday_min_days`, **`cl_per_year`** ("CL per Year"), **`el_per_year`** ("EL per Year"), **`sl_per_year`** ("SL per Year — Sick Leave entitlement"). Saved via `updatePolicyConfig` (`:300`), toast "Policy saved" (`:301`).
- **Absences (explicit):** no UI for accrual cadence, lapse date, carry-forward cap, or opening-balance seeding.

---

### A9. `frontend/src/components/ui/CalendarView.jsx` — leave rendering (182 lines)

**Route/Sidebar:** none (shared component; rendered inside `EmployeeQuickView`).
- **FINDING — no leave rendering at all (FACT).** `STATUS_STYLES` (`:9-17`) and `STATUS_LABELS` (`:19-22`) cover only `P`, `A`, `WO`, `WOP`, `½P`, `WO½P`, `NH`. The legend (`:162-167`) lists Present / Absent / Week Off / WO Present / Half Day / Night Shift plus Late and Miss-Punch dots. **There is no `CL`, `EL`, `SL`, `LWP`, `OD` or `Comp Off` style, label, or legend entry.** A day taken as leave renders with the unstyled fallback and the tooltip shows the raw code with no expansion (`:133`).
- **Writes:** none.
- **api.js →** `getEmployeeDailyAttendance` only (`:33`) — no leave helper.

---

### A10. `frontend/src/pages/Employees.jsx` — leave balance display/edit (1174 lines)

- **FINDING — no leave UI exists (FACT).** A case-insensitive grep for `leave` across the whole file matches **only line 6**, the import statement. `getLeaveBalances` and `updateLeaveBalance` are imported at `:6` and **never referenced again** — dead imports. There is no leave tab, no balance display, and **no balance edit control** on this page.
- **api.js (unused here):** `getLeaveBalances` → `GET /employees/:code/leaves`; `updateLeaveBalance` → `PUT /employees/:code/leaves`. Note `api.js:84-87` defines **two duplicate alias pairs** for these endpoints (`getEmployeeLeaves`/`getLeaveBalances` and `updateEmployeeLeaves`/`updateLeaveBalance`); `getEmployeeLeaves` and `updateEmployeeLeaves` have **zero consumers anywhere**.

---

### A11. `frontend/src/pages/FinanceAudit.jsx` — Comp Off / OD tab (1672 lines)

**Route:** `/finance-audit` (Sidebar `Sidebar.jsx:83`, **no gate flag**). **permissions.js:** `finance-audit` granted to **both** `hr` (`:6`) and `finance` (`:18`).
- **Tab (FACT, `:1326`):** `{ id: 'comp-off', label: 'Comp Off / OD', badge: pendingCompOffCount }` — added to the tab list **unconditionally**; only the `corrections` tab is role-gated (`:1329`, `isAdmin` from `:1272`, again raw `user?.role`).
- **Component `CompOffAuditTab` (`:1398-1672`):** a "Pending Comp-Off / OD Requests" table (`:1511`, empty state `:1532`), a reviewed-this-month table (`:1594`), single and bulk review via a mandatory-remark modal (`:1639`), toasts "Comp-off updated" (`:1433`) and "N comp-off requests updated" (`:1445`).
- **Writes:** `reviewCompOff` (`:1428`), `bulkReviewCompOff` (`:1439`).
- **api.js →** `getCompOffPending` → `GET /comp-off/pending` · `getCompOffList` → `GET /comp-off` · `reviewCompOff` · `bulkReviewCompOff`.
- **Badge query fires on page mount, outside the tab (FACT, `:1310-1315`)** — so merely opening Finance Audit issues `GET /comp-off/pending`.

---

### A12. `frontend/src/pages/Reports.jsx` — leave in exports (1247 lines)

**Route:** `/reports` (Sidebar `Sidebar.jsx:82`, **no gate**). **permissions.js:** `reports` granted to `hr` (`:6`), `finance` (`:18`), `viewer` (`:24`).
- **Report entry (FACT, `:247`):** `{ id: 'leave-register', label: 'Leave Reports', desc: 'Monthly leave register + annual CL/EL summary' }` — **no role gate on the report list.**
- **Shows (`:1090-1200`):** a monthly/annual format toggle (`:1100-1112`); header "Leave Register — {Month Year}" or "FY {year}" (`:1095`); monthly blurb "Per-employee leave consumption for the selected month (**CL / EL / SL / LWP / OD / Short Leave / Uninformed Absent**)" (`:1123`); a table with those columns plus a bold **Total Leave** column (`:1145-1150`); a totals row summing `cl_used`, `el_used`, **`sl_used`**, `lwp_days`, `od_days`, `short_leave_days`, `uninformed_absent` (`:1177-1186`); empty state "No leave data for this {month|financial year}." (`:1131`).
- **Writes:** none — but an **xlsx export** button (`:1116`) downloads a blob with filename fallback `leave_register_{format}_{Month}_{year}.xlsx` (`:188`).
- **api.js →** `getLeaveRegisterReport` → `GET /reports/leave-register` · `downloadLeaveRegisterReport` → same with `download=xlsx`, `responseType: 'blob'` (`api.js:390-393`).

---

### A13. Sales pages — earned-leave UI

- **FINDING — none exists (FACT).** A case-insensitive grep for `leave` across `frontend/src/pages/Sales/` returns **only React DOM handlers**: `onDragLeave` at `SalesUpload.jsx:304`, `:405`, `SalesTaDaUpload.jsx:329`, `:440`, plus the prose word "leave" in an upload hint at `SalesUpload.jsx:391`. **There is no earned-leave, EL-accrual, or leave-balance UI anywhere in the Sales module.** The Sales module does have its own holiday master (`SalesHolidayMaster.jsx`, route `App.jsx:215`, Sidebar `:109` gated `salesAllowed` → hr+admin) with `salesHolidaysList/Create/Update/Delete` (`api.js:508-511`), but holidays are not leave.

---

## B. Dist status table

**Build (FACT):** `frontend/dist/assets` — 76 files, all mtime `Sep 15 14:18`; `frontend/dist/index.html` same. Per the Method note, mtime tells us nothing about staleness; content-grep does.
**Probe command:** `grep -rl 'STRING' frontend/dist/ 2>/dev/null` (fixed-string). **Negative control:** a nonsense string returned no match, confirming the method discriminates.

| # | Surface | Probe string | Dist asset | SHIPS |
|---|---|---|---|---|
| 1 | LeaveManagement — Comp Off tab label | `Comp Off / OD` | `LeaveManagement-D2bheGNS.js`, `FinanceAudit-BHqKa70o.js` | **YES** |
| 2 | LeaveManagement — Gate Passes tab | `Gate Passes` | `LeaveManagement-D2bheGNS.js` | **YES** |
| 3 | LeaveManagement — Adjustments tab | `Adjustment History` | `LeaveManagement-D2bheGNS.js` | **YES** |
| 4 | LeaveManagement — insufficient-balance block | `Reduce the number of days or apply as` | `LeaveManagement-D2bheGNS.js` | **YES** |
| 5 | LeaveManagement — mandatory HR remark | `Mandatory HR note (informed / uninformed` | `LeaveManagement-D2bheGNS.js` | **YES** |
| 6 | Balances tab endpoint | `/leaves/balances` | `index-C6lX4phT.js` | **YES** |
| 7 | Register tab endpoint | `/leaves/register` | `index-C6lX4phT.js` | **YES** |
| 8 | Adjustments endpoint | `/leaves/adjust` | `index-C6lX4phT.js` | **YES** |
| 9 | Adjustment history endpoint | `/leaves/transactions` | `index-C6lX4phT.js` | **YES** |
| 10 | Comp-off bulk review endpoint | `/comp-off/bulk-review` | `index-C6lX4phT.js` | **YES** |
| 11 | Comp-off finance review endpoint | `finance-review` | `index-C6lX4phT.js` | **YES** |
| 12 | Comp-off contractor exclusion note | `Contractors excluded.` | `LeaveManagement-D2bheGNS.js` | **YES** |
| 13 | GatePasses — quota-breach button | `Create Gate Pass (Quota Breach)` | `LeaveManagement-D2bheGNS.js` | **YES** |
| 14 | GatePasses — endpoint | `/short-leaves` | `index-C6lX4phT.js` | **YES** |
| 15 | GatePasses — quota endpoint | `short-leaves/quota` | `index-C6lX4phT.js` | **YES** |
| 16 | EmployeeProfile — leave tab id | `leaveRegister` | `EmployeeProfile-xewH78y1.js` | **YES** |
| 17 | EmployeeProfile — range summary | `Range Leave Summary` | `EmployeeProfile-xewH78y1.js` | **YES** |
| 18 | EmployeeProfile — OD metric | `OD / Comp-Off (range)` | `EmployeeProfile-xewH78y1.js` | **YES** |
| 19 | DailyMIS — on-leave endpoint | `on-leave-today` | `index-C6lX4phT.js` | **YES** |
| 20 | DailyMIS — section header | `Employees on Leave Today` | `DailyMIS-QcIMOKNL.js` | **YES** |
| 21 | DayCalculation — apply-leave endpoint | `corrections/apply-leave` | `index-C6lX4phT.js` | **YES** |
| 22 | DayCalculation — **SL dropdown option** | `SL (Sick Leave)` | `DayCalculation-mp5tXd0L.js` | **YES** |
| 23 | DayCalculation — LOP explainer | `LOP = absent days not covered by CL/EL.` | `DayCalculation-mp5tXd0L.js` | **YES** |
| 24 | SalaryComputation — OD column | `On-Duty / Comp-Off days (finance approved)` | `SalaryComputation-DZU_Tm8w.js` | **YES** |
| 25 | SalaryComputation — SL/short-leave column | `Short Leave (gate pass) days-equivalent` | `SalaryComputation-DZU_Tm8w.js` | **YES** |
| 26 | Settings — SL policy key | `sl_per_year` | `Settings-Bu132Osq.js` | **YES** |
| 27 | Settings — holiday endpoint | `settings/holidays` | `Settings-Bu132Osq.js`, `index-C6lX4phT.js` | **YES** |
| 28 | Reports — leave register endpoint | `/reports/leave-register` | `index-C6lX4phT.js` | **YES** |
| 29 | Reports — leave blurb (incl. SL) | `Per-employee leave consumption for the selected month` | `Reports-CpwsWjru.js` | **YES** |
| 30 | payslipPdf — leave block | `Leave Summary:` | `payslipPdf-jOWDnGvN.js` | **YES** |
| 31 | payslipPdf — short leave line | `Short Lv:` | `payslipPdf-jOWDnGvN.js` | **YES** |
| 32 | payslipPdf — uninformed absent line | `Uninfo. Abs:` | `payslipPdf-jOWDnGvN.js` | **YES** |
| 33 | abbreviations — SL entry | `Sick Leave` | `DayCalculation-mp5tXd0L.js`, `Settings-Bu132Osq.js`, `index-C6lX4phT.js` | **YES** |
| 34 | abbreviations — legend category | `Leave Types` | `index-C6lX4phT.js` | **YES** |
| 35 | Sidebar — nav label | `Leave Management` | `index-C6lX4phT.js`, `LeaveManagement-D2bheGNS.js` | **YES** |
| — | *negative control* | `ZZZ_NOT_A_REAL_STRING_ZZZ` | *(none)* | *(correctly absent)* |

**Unrouted-helper probes** (shipped but never called — see D): `accrue-leaves` → `index-C6lX4phT.js`; `accrual-ledger` → `index-C6lX4phT.js`; `annual-summary` → `index-C6lX4phT.js`; `leaves/bulk-adjust` → `index-C6lX4phT.js`. All **SHIP YES** as dead bytes.

**Verdict (FACT): 35/35 probes found. No stale-build finding. Every leave feature present in `frontend/src` is present in `frontend/dist`.**

---

## C. Role / permission matrix + mismatches

Column key: **Sidebar** = does the nav entry render (`Sidebar.jsx:145-155` gate flags) · **perms.js** = is the page key listed in `backend/src/config/permissions.js` (advisory only) · **Backend** = will the API actually answer.

| Surface | Sidebar gate | perms.js key | admin | hr | finance | supervisor | viewer | Backend gate |
|---|---|---|---|---|---|---|---|---|
| Leave Management page + Applications / Balances / Register / Adjustments | **none** (`:50`) | `leave-management` | ✅ | ✅ | ⚠️ not in perms.js | ⚠️ not in perms.js | ⚠️ not in perms.js | **`requireAuth` only** (`server.js:206`); zero role checks in `routes/leaves.js` |
| — Comp Off / OD tab | none (`LM:178`) | `comp-off` | ✅ | ✅ create/cancel | ✅ review | ❌ | ❌ | `requireHrOrAdmin` / `requireHrFinanceOrAdmin` / `requireFinanceOrAdmin` (`compensatoryOff.js:20-36`) |
| — Gate Passes tab | none (`LM:179`) | *(none)* | ✅ | ✅ | read-only | ❌ | ❌ | `requireHrOrAdmin` write / `requireHrFinanceOrAdmin` read (`short-leaves.js:13-23`) |
| EmployeeProfile → Leave Register | none (`:117`) | `employee-profile` | ✅ | ✅ | ✅ | ⚠️ | ⚠️ | `requireAuth` |
| DailyMIS → On Leave Today | none (`:32`) | `daily-mis` | ✅ | ✅ | ⚠️ | ✅ | ✅ | `requireAuth` (`server.js:206`) |
| DayCalculation leave cols + Apply Leave | none (`:41`) | `day-calc` | ✅ | ✅ | ⚠️ | ⚠️ | ⚠️ | `requireAuth` |
| SalaryComputation leave cols | none (`:42`) | `salary` | ✅ | ✅ | ✅ | ⚠️ | ⚠️ | `requireAuth` |
| Reports → Leave Reports | none (`:82`) | `reports` | ✅ | ✅ | ✅ | ⚠️ | ✅ | `requireAuth` |
| FinanceAudit → Comp Off / OD tab | none (`:83`) | `finance-audit` | ✅ | ⚠️ **403** | ✅ | ⚠️ | ⚠️ | `requireFinanceOrAdmin` |
| Settings → Holiday Master / Policy | **`adminOnly`** (`:126`) | *(admin `*` only)* | ✅ | ❌ | ❌ | ❌ | ❌ | `requireAuth` |
| payslipPdf leave lines | n/a (utility) | `payslips` | ✅ | ✅ | ✅ | ❌ | ❌ | n/a |

### Mismatches

**M1 — CRITICAL: leave is ungated end-to-end. (FACT)** `Sidebar.jsx:50` carries no gate flag; `App.jsx:188` wraps only in `RequireAuth`; `backend/server.js:206` applies only `requireAuth`; `routes/leaves.js` has no role check or 403 anywhere. Net effect: a `viewer` or `supervisor` sees "Leave Management" in the sidebar, loads the page, and can **approve/reject applications and credit/debit leave balances** (`POST /leaves/adjust`). `permissions.js` restricts `leave-management` to hr+admin, but that restriction is never consulted. **Code wins over any doc that claims leave is HR-gated.**

**M2 — `permissions.js` is decorative on both sides. (FACT)** `requirePermission` (`backend/src/middleware/roles.js:43`) is applied to **no** route in `backend/server.js` (every mount uses bare `requireAuth`). `getUserPermissions` (`api.js:293`) has **zero consumers** in `frontend/src`. The permission table is reachable only via `GET /auth/permissions` (`routes/auth.js:178-180`), which nothing calls. Every real gate in the app is a hardcoded role literal.

**M3 — HR is shown a tab that 403s. (FACT)** `permissions.js:6` grants `finance-audit` to `hr`; `Sidebar.jsx:83` has no gate; `FinanceAudit.jsx:1326` adds the "Comp Off / OD" tab unconditionally; `compensatoryOff.js:188` gates `GET /comp-off/pending` behind `requireFinanceOrAdmin`. Worse, the badge query at `FinanceAudit.jsx:1310` fires **on page mount**, so an HR user gets a 403 just by opening Finance Audit, before touching the tab.

**M4 — viewer/supervisor get 403s inside Leave Management. (FACT)** The Comp Off and Gate Passes tabs render for every role (`LeaveManagement.jsx:178-179`) but their backends require hr/finance/admin. The UI shows the tabs; the data never loads.

**M5 — role normalisation is inconsistent. (FACT)** `Sidebar.jsx:239` uses `normalizeRole(user?.role)`, which maps compound labels like "Finance Team" → `finance` (`utils/role.js`). But `LeaveManagement.jsx:731` (`const role = user?.role`) and `FinanceAudit.jsx:1272` (`user?.role === 'admin'`) compare the **raw** value. A user stored as "Finance Team" would see the Leave Management nav item but neither the HR entry form nor the finance approval toolbar inside CompOffTab. **INFERENCE** on the practical impact; the code divergence is FACT.

---

## D. Backend-only or script-only capabilities (no UI)

Stated plainly, each verified by grepping all of `frontend/src` for the helper name and finding only the `api.js` definition:

| Capability | UI? | Evidence |
|---|---|---|
| **EL accrual trigger** | **NO UI.** `accrueLeaves(month, year)` → `POST /features/accrue-leaves` is defined at `api.js:353` and has **zero callers**. Backend/script-only. | FACT |
| **Year-end lapse** | **NO UI, and no api.js helper at all.** A case-insensitive grep for `lapse` / `carry.?forward` / `year.?end` across `frontend/src` returns only false positives (`elapsed` in `VoiceRecorder.jsx`, `collapsed` in `Sidebar.jsx`/`DrillDownRow.jsx`). Entirely backend/script-only. | FACT |
| **CL opening-balance init** | **NO UI.** No seeding control exists. Opening balances are only *displayed*, read-only, in one place — the `Opening {n} + Accrued {n} − Used {n}` sub-line on `EmployeeProfile.jsx:384`. `Settings.jsx:318-320` sets *entitlement* constants (`cl_per_year`/`el_per_year`/`sl_per_year`), which is policy configuration, not balance initialisation. | FACT |
| **`leave_accrual_ledger` viewing** | **NO UI.** `getLeaveAccrualLedger(code, params)` → `GET /leaves/accrual-ledger/:code` is defined at `api.js:199` and has **zero callers**. Backend endpoint exists (`routes/leaves.js:539`). | FACT |
| **Annual leave summary** | **NO UI.** `getLeaveAnnualSummary` (`api.js:200` → `routes/leaves.js:559`) has zero callers. *(The annual view in Reports uses the separate `/reports/leave-register?format=annual` endpoint instead.)* | FACT |
| **Bulk leave adjustment** | **NO UI.** `bulkAdjustLeaves` → `POST /leaves/bulk-adjust` (`api.js:197` → `routes/leaves.js:457`) has zero callers. Only the single-employee Adjustments form exists. | FACT |
| **Leave application cancel/delete** | **NO UI.** `DELETE /leaves/:id` exists (`routes/leaves.js:178`, with audit logging at `:227`) but no api.js helper and no button anywhere. | FACT |
| **Holiday audit / review / bulk-seed** | **NO UI.** `getHolidayAuditLog` (`api.js:348`), `reviewHolidayChange` (`:349`), `bulkSeedHolidays` (`:350`) all have zero callers. `Settings.jsx` uses only get/create/delete — even `updateHoliday` (`api.js:347`) is uncalled, so holidays can be added and removed but **not edited**. | FACT |

### Does any UI write leave balances directly (bypassing application/approval)?

**Yes — three surfaces. (FACT)**

1. **LeaveManagement → Adjustments tab** (`LeaveManagement.jsx:604-656`) — an explicit Credit/Debit against a CL or EL balance via `POST /leaves/adjust`. No approval step, no second party, and **reason is not enforced** (`:650` disables only on missing employee/days). Backend audit-logs it (`routes/leaves.js:401`) but does not gate it by role.
2. **DayCalculation → Apply Leave modal** (`DayCalculation.jsx:524-620`) — converts an absent day into CL/EL/**SL**, consuming balance, via `POST /finance-audit/corrections/apply-leave`. Single-click, no approval; it will knowingly drive a balance negative and only warns (`:563-573`).
3. **`PUT /employees/:code/leaves`** — helper exists (`api.js:86-87`) and ships, but has **no UI consumer** (see A10), so it is not currently reachable from the app.

By contrast the application flow (`ApplyLeaveModal` → `POST /leaves` → `PUT /leaves/:id/approve`) and the comp-off flow (HR create → finance review) *are* two-step. **OPINION:** the Adjustments tab is the weakest control in the leave frontend — an ungated, unreasoned, single-click balance write; it is the natural first candidate for a role gate and a mandatory-reason field.

---

## E. Dead / residual UI

### E1. Dead imports and unrouted helpers (all FACT)

| Item | Location | Note |
|---|---|---|
| `getLeaveSummary` | `LeaveManagement.jsx:3` | imported, never called |
| `getLeaveBalances`, `updateLeaveBalance` | `Employees.jsx:6` | imported, never called — the page has **no** leave UI whatsoever |
| `getEmployeeLeaves`, `updateEmployeeLeaves` | `api.js:84, :86` | duplicate aliases of `getLeaveBalances`/`updateLeaveBalance`; zero consumers |
| `accrueLeaves` | `api.js:353` | zero consumers |
| `getLeaveAccrualLedger` | `api.js:199` | zero consumers |
| `getLeaveAnnualSummary` | `api.js:200` | zero consumers |
| `bulkAdjustLeaves` | `api.js:197` | zero consumers |
| `updateHoliday`, `getHolidayAuditLog`, `reviewHolidayChange`, `bulkSeedHolidays` | `api.js:347-350` | zero consumers |
| `getUserPermissions` | `api.js:293` | zero consumers — the reason M2 exists |

All of the above are bundled into `index-C6lX4phT.js` and ship to users as dead bytes.

**No commented-out leave code found (FACT)** — a grep for commented lines mentioning leave returns only live section headers (`// Leave Management Phase 4 —` etc.). **No disabled buttons with "coming soon" tooltips were found in any leave surface (FACT)** — every `disabled` attribute in these files is a legitimate validation or in-flight guard.

### E2. SL (sick leave) remnants — **SL was NOT removed from the frontend**

CLAUDE.md reportedly describes SL as removed. **CODE WINS: SL is live, user-visible, writable, and shipped.** 15 references across 8 files (all FACT):

| # | file:line | Kind | Live? |
|---|---|---|---|
| 1 | `frontend/src/pages/DayCalculation.jsx:585` | **`<option value="SL">SL (Sick Leave)</option>`** — a selectable dropdown option that posts `leave_type: 'SL'` | **LIVE WRITE PATH** |
| 2 | `frontend/src/pages/DayCalculation.jsx:557` | SL balance tile in the Apply Leave modal | live display |
| 3 | `frontend/src/pages/DayCalculation.jsx:400` | tooltip `"Apply CL/EL/SL to absent days"` | live label |
| 4 | `frontend/src/pages/DayCalculation.jsx:520` | `AbbreviationLegend` keys include `'SL'` | live legend |
| 5 | `frontend/src/pages/Settings.jsx:320` | policy key `sl_per_year`, label "SL per Year", hint "Sick Leave entitlement" | **live editable setting** |
| 6 | `frontend/src/utils/abbreviations.js:19` | `SL: { full: 'Sick Leave', desc: 'Leave for medical reasons…' }` | live tooltip source |
| 7 | `frontend/src/utils/abbreviations.js:106` | legend category "Leave Types" → `{ abbr: 'SL', meaning: 'Sick Leave' }` | live legend entry |
| 8 | `frontend/src/utils/payslipPdf.js:269` | `if ((lv.sl \|\| 0) > 0) parts.push('<strong>SL:</strong> …')` | **prints on payslips** |
| 9 | `frontend/src/pages/EmployeeProfile.jsx:375` | `{ key: 'SL', color: 'teal' }` → renders an "SL Balance (year)" KPI card | live display |
| 10 | `frontend/src/pages/EmployeeProfile.jsx:434` | `<th>SL</th>` in Monthly Leave Breakdown | live column |
| 11 | `frontend/src/pages/Reports.jsx:1123` | blurb lists `CL / EL / SL / LWP / OD / …` | live label |
| 12 | `frontend/src/pages/Reports.jsx:1145` | `<th>SL</th>` in the monthly leave register (+ `sl_used` total at `:1179`, `:1186`) | **live column + xlsx export** |
| 13 | `frontend/src/pages/DailyMIS.jsx:893` | `SL: { bg: 'bg-amber-100', …, label: 'SL' }` in `LEAVE_TYPE_STYLE` | live style |
| 14 | `frontend/src/pages/DailyMIS.jsx:927` | display order `['EL','CL','LWP','OD','SL']` | live grouping |
| 15 | `frontend/src/pages/SalaryComputation.jsx:614` | header `SL` — **but bound to `short_leave_days`, meaning *Short Leave*, not Sick Leave** | live, **semantically colliding** |

**Dist confirmation (FACT):** `SL (Sick Leave)` → `DayCalculation-mp5tXd0L.js`; `sl_per_year` → `Settings-Bu132Osq.js`; `Sick Leave` → `DayCalculation-mp5tXd0L.js` + `Settings-Bu132Osq.js` + `index-C6lX4phT.js`. **All SL remnants ship to production.**

**Where SL is already absent (FACT):** `LeaveManagement.jsx` `LEAVE_TYPES` (`:22-27`) and the Adjustments leave-type select (`:626-629`) offer no SL. **INFERENCE:** the removal was applied to LeaveManagement only and never propagated, leaving Day Calculation as an unremoved side door that still writes `SL`.

---

## F. Findings

1. **[FACT] DIST IS CURRENT — no stale-build finding.** 35/35 unique probe strings covering all 13 surfaces resolve inside `frontend/dist/` (build `Sep 15 14:18`, 76 assets), with a validated negative control. Every leave feature in `src` is deployed. Mtime comparison was impossible (all `src` files share the checkout mtime), so this rests entirely on content-grep.

2. **[FACT] Leave Management is completely ungated.** `Sidebar.jsx:50` (no gate flag) + `App.jsx:188` (`RequireAuth` only) + `backend/server.js:206` (`requireAuth` only) + `routes/leaves.js` (no role check, no 403 anywhere). Any authenticated user — including `viewer` and `supervisor` — can read every balance, approve applications, and credit/debit balances.

3. **[FACT] `backend/src/config/permissions.js` is not enforced anywhere.** `requirePermission` is applied to no route; `getUserPermissions` has no frontend consumer. The file documents intent that the code does not implement. **Any CLAUDE.md statement that roles are permission-gated is contradicted — CODE WINS.**

4. **[FACT] HR hits a guaranteed 403 on Finance Audit.** `permissions.js:6` grants HR `finance-audit`; `FinanceAudit.jsx:1310` fires `GET /comp-off/pending` on mount; `compensatoryOff.js:188` requires finance/admin.

5. **[FACT] viewer/supervisor see Comp Off and Gate Passes tabs that cannot load** (`LeaveManagement.jsx:178-179` vs. `compensatoryOff.js:20-36`, `short-leaves.js:13-23`).

6. **[FACT] SL is not removed from the frontend.** 15 live references in 8 files, all shipped, including a working `SL (Sick Leave)` write option (`DayCalculation.jsx:585`), an editable `sl_per_year` policy (`Settings.jsx:320`), and an SL payslip line (`payslipPdf.js:269`). **[INFERENCE]** the removal covered `LeaveManagement.jsx` only and was never propagated.

7. **[FACT] `SL` carries two conflicting meanings in shipped UI.** Sick Leave in Day Calc / Reports / EmployeeProfile / payslip; **Short Leave (gate pass)** in the salary register (`SalaryComputation.jsx:614`). **[OPINION]** in a payroll register this is a genuine misreading risk — rename the salary-register header to `ShL` or `GP`.

8. **[FACT] Three UI paths write leave balances without an approval flow:** the Adjustments tab (`LeaveManagement.jsx:604-656`, reason not enforced at `:650`), the Day Calc Apply Leave modal (`DayCalculation.jsx:524-620`, will drive balances negative with only a warning), and the unreachable `PUT /employees/:code/leaves`. **[OPINION]** the Adjustments tab is the weakest control in the module.

9. **[FACT] No UI exists for EL accrual trigger, year-end lapse, CL opening-balance init, or `leave_accrual_ledger` viewing.** The helpers `accrueLeaves`, `getLeaveAccrualLedger`, `getLeaveAnnualSummary`, `bulkAdjustLeaves` are exported and bundled but have zero callers; lapse has no helper at all. All are backend/script-only. Opening/accrued figures surface read-only in exactly one place (`EmployeeProfile.jsx:384`).

10. **[FACT] `CalendarView.jsx` renders no leave states.** `STATUS_STYLES`/`STATUS_LABELS` (`:9-22`) and the legend (`:162-167`) cover only P/A/WO/WOP/½P/WO½P/NH. A leave day falls through to the unstyled fallback with an unexpanded tooltip code. **[OPINION]** the most visible gap in the leave UI — the one screen a manager would expect to show leave doesn't.

11. **[FACT] `Employees.jsx` has no leave UI at all** — `getLeaveBalances`/`updateLeaveBalance` are imported at `:6` and never used. **[FACT] No Sales page has any earned-leave UI** — all `leave` matches under `pages/Sales/` are `onDragLeave` handlers.

12. **[FACT] Role normalisation is inconsistent.** `Sidebar.jsx:239` uses `normalizeRole`; `LeaveManagement.jsx:731` and `FinanceAudit.jsx:1272` compare raw `user?.role`. **[INFERENCE]** a legacy role value such as "Finance Team" would see the nav entry but get neither the HR form nor the finance toolbar inside CompOffTab.

13. **[FACT] `approveLeave` hardcodes the approver.** `LeaveManagement.jsx:254` sends `{ approved_by: 'admin' }` regardless of who clicks; the backend separately records `req.user?.username` (`routes/leaves.js:130`). **[INFERENCE]** the client-supplied field is misleading in any payload log or audit view that trusts it.

14. **[FACT] Holidays can be created and deleted but not edited** — `Settings.jsx` wires only `getHolidays`/`createHoliday`/`deleteHoliday`; `updateHoliday`, `getHolidayAuditLog`, `reviewHolidayChange`, `bulkSeedHolidays` ship unused. **[INFERENCE]** a holiday-change review workflow was designed backend-first and the UI half was never built.

15. **[OPINION] Priority order for remediation:** (1) add a role gate to `/leave-management` in Sidebar, route, and `routes/leaves.js` — finding 2 is the only one with a direct data-integrity consequence; (2) decide SL's fate and apply it consistently, starting with `DayCalculation.jsx:585`; (3) gate the FinanceAudit comp-off tab on finance/admin to stop the mount-time 403; (4) either enforce `permissions.js` or delete it, since a permission table nothing reads is worse than none.

---

*End of 03 — Leave Frontend. Read-only audit; no files under `frontend/` were modified, no build was run, no dev server started. No employee names, phone, PAN, Aadhaar, or bank data appear in this document.*

---

## Provenance note (added by orchestrator, not the agent)

This file was produced by the frontend Explore subagent, which ran without `Write` in its
toolset and therefore handed its report back as text. The orchestrator transcribed it here
verbatim. **The file:line references below were independently spot-checked by the orchestrator
before assembly — see the VERIFY section of `LEAVE_INVENTORY.md` for which ones and the result.**
