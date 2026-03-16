# HR Intelligence & Salary Processing Platform
### Indriyan Beverages / Asian Lakto Ind. Ltd.

A complete HR payroll processing system built for Indian manufacturing payroll with EESL biometric attendance integration.

---

## Quick Start

### 1. Install Node.js (required)
Download and install from: **https://nodejs.org** (LTS version recommended, e.g. v20)

Verify: `node --version` and `npm --version`

### 2. Install Dependencies
```bash
cd /Users/abhinavpoddar/Desktop/hr-salary-system

# Install all dependencies
npm install                          # root (concurrently)
npm install --prefix backend         # backend
npm install --prefix frontend        # frontend
```

Or simply run the start script which auto-installs:
```bash
chmod +x start.sh
./start.sh
```

### 3. Run the App
```bash
# Option A: Use the start script (recommended)
./start.sh

# Option B: Manual
npm run dev
```

This starts:
- **Backend API** → http://localhost:3001
- **Frontend App** → http://localhost:5173

Open **http://localhost:5173** in your browser.

---

## System Architecture

```
hr-salary-system/
├── backend/               Express.js API + SQLite
│   ├── server.js
│   ├── src/
│   │   ├── database/
│   │   │   ├── schema.js  ← All table definitions + seeded data
│   │   │   └── db.js      ← SQLite connection (WAL mode)
│   │   ├── services/
│   │   │   ├── parser.js          ← EESL XLS parser (CRITICAL)
│   │   │   ├── nightShift.js      ← Night shift auto-pairing
│   │   │   ├── missPunch.js       ← Miss punch detection
│   │   │   ├── dayCalculation.js  ← Sunday rule + leave adjustment
│   │   │   ├── salaryComputation.js ← Indian payroll engine
│   │   │   └── analytics.js       ← HR intelligence
│   │   └── routes/
│   │       ├── import.js     ← XLS file upload & processing
│   │       ├── attendance.js ← Processed records & corrections
│   │       ├── employees.js  ← Employee master & salary structure
│   │       ├── payroll.js    ← Day calc & salary computation
│   │       ├── analytics.js  ← Org overview, attrition, etc.
│   │       ├── reports.js    ← All 8 report endpoints
│   │       └── settings.js   ← Shifts, holidays, policy
├── frontend/              React + Vite + Tailwind
│   └── src/
│       ├── pages/         15 pages covering all features
│       ├── components/    Reusable UI components
│       ├── store/         Zustand state management
│       └── utils/         API client + formatters
├── data/                  SQLite database (auto-created)
└── start.sh               One-click start script
```

---

## 7-Stage Processing Pipeline

| Stage | Name | Description |
|-------|------|-------------|
| 1 | **Import** | Upload EESL `.xls` files → auto-parse, detect night shifts |
| 2 | **Miss Punch** | Flag & resolve MISSING_IN / MISSING_OUT / NO_PUNCH |
| 3 | **Shift Check** | Verify late arrivals, early departures |
| 4 | **Night Shift** | Confirm/reject cross-midnight punch pairings |
| 5 | **Corrections** | Manual attendance register editing |
| 6 | **Day Calc** | Apply Sunday rule + CL/EL deduction logic |
| 7 | **Salary** | Compute earnings, PF, ESI, PT → finalise |

---

## EESL XLS Parser Format

The parser (`backend/src/services/parser.js`) is verified against actual EESL biometric exports (Apr 2025 – Jan 2026):

- All cell values are **TEXT strings** (ctype=1) — not numeric
- Times: `"H:MM"` or `"HH:MM"` format
- Status codes: `P`, `A`, `WO`, `WOP`, `½P`, `WO½P`
- Row 6: Day headers (`"1 T"`, `"2 W"`, `"14 M"`, `"31 St"`)
- Row 2 col 1: Date range (`"Apr 01 2025  To  Apr 30 2025"`)
- Company name at row 3 col 4
- Employee code at col 3, name at col 13
- Employee block: Status (r+1), InTime (r+2), OutTime (r+3), Total (r+4)

---

## Indian Payroll Rules

| Component | Rate | Notes |
|-----------|------|-------|
| Employee PF | 12% of Basic+DA | Capped at ₹15,000 wage ceiling |
| Employer PF | 3.67% | EPF account |
| EPS | 8.33% | Capped at ₹1,250/month |
| Employee ESI | 0.75% | Gross ≤ ₹21,000 |
| Employer ESI | 3.25% | Gross ≤ ₹21,000 |
| PT (Punjab) | ₹0/₹150/₹200 | Based on gross salary slabs |
| Salary divisor | 26 days | Pro-rata calculation |

---

## Sunday Rule

Each week (Mon–Sat + Sunday):
- **≥ 6 working days** → Paid Sunday (no deduction)
- **≥ 4 working days** → Deduct from CL, then EL, then LOP (if shortage ≤ 1.5 days)
- **< 4 working days** → Unpaid Sunday

---

## Key Features

- **Auto night shift pairing** — ~190 cases/month (IN ≥ 18:00 + OUT next day ≤ 12:00)
- **Miss punch detection** — ~145 cases/month flagged automatically
- **HR analytics** — Chronic absentees, habitual latecomers, attrition, headcount trend
- **Compliance tracking** — PF/ESI calendar with challan management
- **CSV export** — All reports exportable
- **Audit trail** — Every field change logged with before/after values

---

## Default Shifts (Auto-Seeded)

| Code | Name | Time |
|------|------|------|
| DAY | Day Shift | 09:00–18:00 |
| NIGHT | Night Shift | 21:00–06:00 |
| GEN | General Shift | 09:30–18:30 |

---

## Support

Built for the HR/Payroll team at Indriyan Beverages / Asian Lakto Ind. Ltd.
Parser verified against 10 months of actual EESL biometric data (Apr 2025 – Jan 2026).
