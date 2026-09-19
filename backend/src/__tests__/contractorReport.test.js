/**
 * Contractor Report — service + config tests. (PR-2, read-only, Sep 2026)
 *
 * Runs against an in-memory SQLite database built to the same shape as the
 * production tables the service reads. Read-only service, so the fixture is
 * seeded once per suite and never mutated by the code under test.
 */

const Database = require('better-sqlite3');
const CFG = require('../config/contractorReportConfig');
const {
  monthReport, dayReport, gridReport, contractorNamesForMonth,
} = require('../services/contractorReport');

// ─── fixture ──────────────────────────────────────────────────────────────
function makeDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE employees (
      id INTEGER PRIMARY KEY, code TEXT, name TEXT, department TEXT, designation TEXT,
      company TEXT, employment_type TEXT, date_of_joining TEXT, date_of_exit TEXT,
      is_contractor INTEGER DEFAULT 0, contractor_group TEXT,
      status TEXT DEFAULT 'Active'
    );
    CREATE TABLE attendance_processed (
      id INTEGER PRIMARY KEY, employee_code TEXT, date TEXT,
      status_original TEXT, status_final TEXT,
      is_night_shift INTEGER DEFAULT 0, is_night_out_only INTEGER DEFAULT 0,
      is_miss_punch INTEGER DEFAULT 0, miss_punch_finance_status TEXT,
      correction_source TEXT
    );
    CREATE TABLE day_calculations (
      id INTEGER PRIMARY KEY, employee_code TEXT, month INTEGER, year INTEGER,
      company TEXT, total_payable_days REAL,
      UNIQUE(employee_code, month, year, company)
    );
    CREATE TABLE dw_contractors (id INTEGER PRIMARY KEY, contractor_name TEXT);
    CREATE TABLE dw_entries (
      id INTEGER PRIMARY KEY, contractor_id INTEGER, entry_date TEXT NOT NULL,
      in_time TEXT NOT NULL, out_time TEXT NOT NULL,
      total_worker_count INTEGER NOT NULL, wage_rate_applied REAL NOT NULL,
      commission_rate_applied REAL NOT NULL, total_wage_amount REAL NOT NULL DEFAULT 0,
      total_commission_amount REAL NOT NULL DEFAULT 0, total_liability REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'hr_entered', gate_entry_reference TEXT NOT NULL
    );
    CREATE TABLE dw_department_allocations (
      id INTEGER PRIMARY KEY, entry_id INTEGER, department TEXT,
      worker_count INTEGER, allocated_wage_amount REAL
    );
  `);
  return db;
}

let idSeq = 0;
function addEmp(db, o) {
  db.prepare(
    `INSERT INTO employees (id, code, name, department, designation, company,
       employment_type, date_of_joining, date_of_exit, is_contractor, contractor_group,
       status)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    ++idSeq, o.code, o.name || `EMP ${o.code}`, o.dept, o.designation || 'HELPER',
    o.company === undefined ? 'Asian Lakto Ind Ltd' : o.company,
    o.employmentType === undefined ? 'Contract' : o.employmentType,
    o.doj || null, o.doe || null, o.isContractor || 0, o.contractorGroup || null,
    o.status === undefined ? 'Active' : o.status
  );
}
function addAtt(db, code, date, status, opts = {}) {
  db.prepare(
    `INSERT INTO attendance_processed (id, employee_code, date, status_original,
       status_final, is_night_shift, is_night_out_only,
       is_miss_punch, miss_punch_finance_status, correction_source)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  ).run(++idSeq, code, date, opts.original || status,
    opts.final === undefined ? status : opts.final,
    opts.night ? 1 : 0, opts.nightOutOnly ? 1 : 0,
    opts.missPunch ? 1 : 0,
    opts.financeStatus === undefined ? null : opts.financeStatus,
    opts.correctionSource === undefined ? null : opts.correctionSource);
}
function addDayCalc(db, code, month, year, days, company = 'Asian Lakto Ind Ltd') {
  db.prepare(
    `INSERT INTO day_calculations (id, employee_code, month, year, company, total_payable_days)
     VALUES (?,?,?,?,?,?)`
  ).run(++idSeq, code, month, year, company, days);
}
function addContractor(db, id, name) {
  db.prepare(`INSERT INTO dw_contractors (id, contractor_name) VALUES (?,?)`).run(id, name);
}
function addDwEntry(db, o) {
  const id = ++idSeq;
  const amount = o.amount === undefined ? o.heads * o.rate : o.amount;
  // Commission columns are seeded with a deliberately distinctive value: the
  // report must never read them (AMENDMENT 1), so a 777 surfacing anywhere is a leak.
  db.prepare(
    `INSERT INTO dw_entries (id, contractor_id, entry_date, in_time, out_time,
       total_worker_count, wage_rate_applied, commission_rate_applied,
       total_wage_amount, total_commission_amount, total_liability,
       status, gate_entry_reference)
     VALUES (?,?,?,'08:00','18:00',?,?,777,?,?,?,?,?)`
  ).run(id, o.contractorId, o.date, o.heads, o.rate, amount,
    o.heads * 777, amount + o.heads * 777,
    o.status || 'approved', o.gateRef || `GATE-${id}`);
  const allocs = o.allocations === undefined
    ? [{ dept: o.dept === undefined ? 'PRODUCTION' : o.dept, heads: o.heads, cost: amount }]
    : o.allocations;
  for (const a of allocs) {
    db.prepare(
      `INSERT INTO dw_department_allocations (id, entry_id, department, worker_count,
         allocated_wage_amount) VALUES (?,?,?,?,?)`
    ).run(++idSeq, id, a.dept, a.heads, a.cost);
  }
  return id;
}

const M = { month: 4, year: 2026 };

// ─── config-level rules ───────────────────────────────────────────────────
describe('config: attendance weights', () => {
  test('P and WOP weigh a full day; half-day codes weigh 0.5', () => {
    expect(CFG.statusWeight('P')).toBe(1);
    expect(CFG.statusWeight('WOP')).toBe(1);
    expect(CFG.statusWeight('½P')).toBe(0.5);
    expect(CFG.statusWeight('WO½P')).toBe(0.5);
  });
  test('absent, weekly off and anything unknown weigh nothing', () => {
    for (const s of ['A', 'WO', '', null, undefined, 'NH', 'ED']) {
      expect(CFG.statusWeight(s)).toBe(0);
    }
  });
  test('the generated SQL CASE covers exactly the configured statuses', () => {
    const sql = CFG.statusWeightSql('x');
    for (const st of Object.keys(CFG.PRESENT_WEIGHTS)) expect(sql).toContain(`'${st}'`);
    expect(sql).toMatch(/ELSE 0 END$/);
  });
});

describe('config: department normaliser', () => {
  test('typo variants of Production all collapse', () => {
    for (const s of ['PRODUCTION', 'PRODUTION', 'prodution', 'Production Line']) {
      expect(CFG.normalizeDepartment(s)).toBe('Production');
    }
  });
  test('utility, zeera and night map to their canonical names', () => {
    expect(CFG.normalizeDepartment('UTILITY WORK')).toBe('Utility');
    expect(CFG.normalizeDepartment('PRODUCTION OF ZEERA 400ML')).toBe('Zeera 400 ml line');
    expect(CFG.normalizeDepartment('FOR NIGHT SHIFT PRODUCTION')).toBe('Production · night');
  });
  test('rule ORDER is load-bearing: the real 9 May UTILITY entry stays Utility', () => {
    // Contains both "zeera" and "prod". Only starts-with-utility running first
    // keeps its 21 heads under Utility. Regression guard for the rule order.
    const typed =
      'UTILITY (SUGAR-7, SYRUP-1,PULP-2,HK-2,ZEERA (400) PROD-5,,BOILER-1,MOULDING-2, OTHER-1';
    expect(CFG.normalizeDepartment(typed)).toBe('Utility');
  });
  test('the later rules still resolve', () => {
    expect(CFG.normalizeDepartment('housekeeping A')).toBe('Housekeeping');
    expect(CFG.normalizeDepartment('ETP PLANT')).toBe('ETP');
    expect(CFG.normalizeDepartment('mistri work')).toBe('Maintenance (mistri)');
    expect(CFG.normalizeDepartment('godown')).toBe('Godown');
  });
  test('empty text becomes Not recorded; unknown text is kept verbatim', () => {
    expect(CFG.normalizeDepartment('')).toBe('Not recorded');
    expect(CFG.normalizeDepartment(null)).toBe('Not recorded');
    expect(CFG.normalizeDepartment('  CANTEEN  ')).toBe('CANTEEN');
  });
});

describe('config: roles and aliases', () => {
  test('designation variants map to canonical roles', () => {
    expect(CFG.normalizeRole('LODING')).toBe('Loading');
    expect(CFG.normalizeRole('LOADING')).toBe('Loading');
    expect(CFG.normalizeRole('S.GUARD')).toBe('Guard');
    expect(CFG.normalizeRole('')).toBe('No designation');
    expect(CFG.normalizeRole('fitter helper')).toBe('Fitter Helper');
  });
  test('SONU CONT is mapped to Sonu, not flagged unmapped', () => {
    expect(CFG.resolveBiometricContractor('SONU CONT')).toEqual({ name: 'Sonu', unmapped: false });
  });
  test('a name never seen before is kept and flagged, never dropped', () => {
    const r = CFG.resolveBiometricContractor('BRAND NEW CONT');
    expect(r).toEqual({ name: 'BRAND NEW CONT', unmapped: true });
  });
  test('the combined daily-wage record resolves to its two components', () => {
    expect(CFG.resolveDwContractor('SAJJAN+JIWAN LAL (12-H)').name).toBe('Sajan + Jiwan Lal (12-h)');
    expect(CFG.componentContractors('Sajan + Jiwan Lal (12-h)')).toEqual(['Sajan', 'Jiwan Lal']);
    expect(CFG.componentContractors('Meera')).toEqual(['Meera']);
  });
  test('company validity has no mapping rules — ASIAN is invalid', () => {
    expect(CFG.isValidCompany('Asian Lakto Ind Ltd')).toBe(true);
    expect(CFG.isValidCompany('Indriyan Beverages Pvt Ltd')).toBe(true);
    for (const c of ['ASIAN', 'Default', 'null', '', null]) {
      expect(CFG.isValidCompany(c)).toBe(false);
    }
  });
});

// ─── population ───────────────────────────────────────────────────────────
describe('population', () => {
  test('only employment_type drives inclusion; SECURITY is excluded and the is_contractor flag is ignored', () => {
    const db = makeDb();
    addEmp(db, { code: 'C1', dept: 'MEERA' });
    addEmp(db, { code: 'S1', dept: 'SECURITY' });                             // excluded dept
    addEmp(db, { code: 'B1', dept: 'BISLERI WORKERS' });                      // excluded dept
    addEmp(db, { code: 'P1', dept: 'MEERA', employmentType: 'Permanent', isContractor: 1 }); // flag ignored
    for (const c of ['C1', 'S1', 'B1', 'P1']) addAtt(db, c, '2026-04-01', 'P');

    const rep = monthReport(db, M);
    expect(rep.totals.stats.manDays).toBe(1);
    expect(rep.contractors).toEqual(['Meera']);
    expect(rep.cells['2026-04-01'].Meera.bio).toBe(1);
  });

  test('status_final overrides status_original, and night-out-only rows are skipped', () => {
    const db = makeDb();
    addEmp(db, { code: 'C1', dept: 'MEERA' });
    addAtt(db, 'C1', '2026-04-01', null, { original: 'A', final: 'P' });   // corrected to present
    addAtt(db, 'C1', '2026-04-02', null, { original: 'P', final: 'A' });   // corrected to absent
    addAtt(db, 'C1', '2026-04-03', 'P', { nightOutOnly: true });           // the OUT half of a night pair
    const rep = monthReport(db, M);
    expect(rep.totals.stats.manDays).toBe(1);
    expect(rep.cells['2026-04-03'].Meera).toBeUndefined();
  });
});

// ─── weights, night split, pre-joining ────────────────────────────────────
describe('heads, man-days and the night split', () => {
  test('half days count as one head but half a man-day; night counts on the punch-in date', () => {
    const db = makeDb();
    addEmp(db, { code: 'C1', dept: 'MEERA' });
    addEmp(db, { code: 'C2', dept: 'MEERA' });
    addEmp(db, { code: 'C3', dept: 'MEERA' });
    addAtt(db, 'C1', '2026-04-01', 'P');
    addAtt(db, 'C2', '2026-04-01', '½P');
    addAtt(db, 'C3', '2026-04-01', 'WO½P', { night: true });

    const cell = monthReport(db, M).cells['2026-04-01'].Meera;
    expect(cell.bio).toBe(3);
    expect(cell.bioDay).toBe(2);
    expect(cell.bioNight).toBe(1);
    expect(cell.manDays).toBe(2);        // 1 + 0.5 + 0.5
    expect(cell.manDaysDay).toBe(1.5);
    expect(cell.manDaysNight).toBe(0.5);
  });

  test('days before the joining date are heads but not man-days, and are flagged', () => {
    const db = makeDb();
    addEmp(db, { code: 'C1', dept: 'MEERA', doj: '2026-04-03' });
    addAtt(db, 'C1', '2026-04-01', 'P');   // pre-joining
    addAtt(db, 'C1', '2026-04-02', 'P');   // pre-joining
    addAtt(db, 'C1', '2026-04-03', 'P');   // on the joining date — counts

    const rep = monthReport(db, M);
    expect(rep.totals.perContractor.Meera.bio).toBe(3);
    expect(rep.totals.stats.manDays).toBe(1);
    expect(rep.exceptions.pre).toHaveLength(1);
    expect(rep.exceptions.pre[0]).toMatchObject({ code: 'C1', days: 2, doj: '2026-04-03' });
  });

  test('man-days are NOT clipped by the exit date — payroll does not clip either', () => {
    const db = makeDb();
    addEmp(db, { code: 'C1', dept: 'MEERA', doe: '2026-04-01' });
    addAtt(db, 'C1', '2026-04-01', 'P');
    addAtt(db, 'C1', '2026-04-02', 'P');   // after exit: still paid, but flagged
    const rep = monthReport(db, M);
    expect(rep.totals.stats.manDays).toBe(2);
    expect(rep.exceptions.aft).toHaveLength(1);
    expect(rep.exceptions.aft[0]).toMatchObject({ code: 'C1', days: 1, doe: '2026-04-01' });
  });
});

// ─── daily wage ───────────────────────────────────────────────────────────
describe('daily wage', () => {
  test('only approved and paid entries count; others become dwPending and an exception', () => {
    const db = makeDb();
    addContractor(db, 10, 'CHOTTU CONT');
    addDwEntry(db, { contractorId: 10, date: '2026-04-01', heads: 5, rate: 600 });
    addDwEntry(db, { contractorId: 10, date: '2026-04-01', heads: 3, rate: 600, status: 'paid' });
    addDwEntry(db, { contractorId: 10, date: '2026-04-01', heads: 7, rate: 600, status: 'hr_entered' });

    const rep = monthReport(db, M);
    const cell = rep.cells['2026-04-01'].Chottu;
    expect(cell.dwHeads).toBe(8);
    expect(cell.dwCost).toBe(4800);
    expect(cell.dwRecords).toBe(2);
    expect(cell.dwPending).toBe(7);
    expect(rep.exceptions.pend).toHaveLength(1);
    expect(rep.exceptions.pend[0]).toMatchObject({ heads: 7, status: 'hr_entered' });
  });

  test('test contractors are excluded everywhere except the void list', () => {
    const db = makeDb();
    addContractor(db, 1, 'RAJESH KUMAR');
    addContractor(db, 2, 'SURESH SINGH');
    addContractor(db, 10, 'CHOTTU CONT');
    addDwEntry(db, { contractorId: 1, date: '2026-04-01', heads: 10, rate: 450 });
    addDwEntry(db, { contractorId: 2, date: '2026-04-02', heads: 4, rate: 400, status: 'hr_entered' });
    addDwEntry(db, { contractorId: 10, date: '2026-04-01', heads: 2, rate: 600 });

    const rep = monthReport(db, M);
    expect(rep.totals.stats.dwHeads).toBe(2);
    expect(rep.contractors).toEqual(['Chottu']);
    expect(rep.exceptions.test).toHaveLength(2);
    // a not-approved TEST entry must not also appear under "not approved"
    expect(rep.exceptions.pend).toHaveLength(0);
  });

  test('PAPPU and PAPPU CONT on one day fold into one contractor with two records', () => {
    const db = makeDb();
    addContractor(db, 7, 'PAPPU CONT');
    addContractor(db, 8, 'PAPPU');
    addDwEntry(db, { contractorId: 8, date: '2026-04-04', heads: 12, rate: 600 });
    addDwEntry(db, { contractorId: 7, date: '2026-04-04', heads: 2, rate: 650 });

    const rep = monthReport(db, M);
    const cell = rep.cells['2026-04-04'].Pappu;
    expect(cell.dwHeads).toBe(14);
    expect(cell.dwCost).toBe(8500);      // 12*600 + 2*650
    expect(cell.dwRecords).toBe(2);
    expect(rep.exceptions.dup).toHaveLength(1);
    expect(rep.exceptions.dup[0].records.map((r) => r.rawName).sort())
      .toEqual(['PAPPU', 'PAPPU CONT']);
  });

  test('two entries from the SAME contractor record on one day are not a duplicate', () => {
    const db = makeDb();
    addContractor(db, 10, 'CHOTTU CONT');
    addDwEntry(db, { contractorId: 10, date: '2026-04-01', heads: 5, rate: 600 });
    addDwEntry(db, { contractorId: 10, date: '2026-04-01', heads: 6, rate: 600 });
    expect(monthReport(db, M).exceptions.dup).toHaveLength(0);
  });

  test('departments come from the allocation rows, with the typed text kept', () => {
    const db = makeDb();
    addContractor(db, 10, 'CHOTTU CONT');
    addDwEntry(db, {
      contractorId: 10, date: '2026-04-01', heads: 8, rate: 500, amount: 4000,
      allocations: [
        { dept: 'PRODUTION', heads: 5, cost: 2500 },
        { dept: 'UTILITY (SUGAR-7, ZEERA (400) PROD-5)', heads: 3, cost: 1500 },
      ],
    });
    const cell = monthReport(db, M).cells['2026-04-01'].Chottu;
    expect(cell.deptBreakdown).toEqual([
      { dept: 'Production', typed: 'PRODUTION', heads: 5, cost: 2500 },
      { dept: 'Utility', typed: 'UTILITY (SUGAR-7, ZEERA (400) PROD-5)', heads: 3, cost: 1500 },
    ]);
  });

  test('an entry with no allocation row falls back to Not recorded and keeps its heads', () => {
    const db = makeDb();
    addContractor(db, 10, 'CHOTTU CONT');
    addDwEntry(db, { contractorId: 10, date: '2026-04-01', heads: 9, rate: 500, allocations: [] });
    const cell = monthReport(db, M).cells['2026-04-01'].Chottu;
    expect(cell.dwHeads).toBe(9);
    expect(cell.deptBreakdown).toEqual([
      { dept: 'Not recorded', typed: '', heads: 9, cost: 4500 },
    ]);
  });
});

// ─── both-source ──────────────────────────────────────────────────────────
describe('both sources on the same day', () => {
  test('max double pay is min(bio, dw) x the per-head daily-wage rate', () => {
    const db = makeDb();
    addEmp(db, { code: 'C1', dept: 'PAPPU CONT' });
    addEmp(db, { code: 'C2', dept: 'PAPPU CONT' });
    addEmp(db, { code: 'C3', dept: 'PAPPU CONT' });
    for (const c of ['C1', 'C2', 'C3']) addAtt(db, c, '2026-04-04', 'P');
    addContractor(db, 8, 'PAPPU');
    addDwEntry(db, { contractorId: 8, date: '2026-04-04', heads: 2, rate: 600 });

    const rep = monthReport(db, M);
    expect(rep.exceptions.both).toHaveLength(1);
    expect(rep.exceptions.both[0]).toMatchObject({
      contractor: 'Pappu', bio: 3, dwHeads: 2, dwCost: 1200, maxDoublePay: 1200,
    });
    expect(rep.totals.stats.bothSourceDays).toBe(1);
  });

  test('biometric-only or daily-wage-only days are not flagged', () => {
    const db = makeDb();
    addEmp(db, { code: 'C1', dept: 'MEERA' });
    addAtt(db, 'C1', '2026-04-01', 'P');
    addContractor(db, 10, 'CHOTTU CONT');
    addDwEntry(db, { contractorId: 10, date: '2026-04-02', heads: 4, rate: 600 });
    expect(monthReport(db, M).exceptions.both).toHaveLength(0);
  });

  test('R-8: the combined 12-h record is compared against BOTH component gangs', () => {
    // No such entry existed in April-May 2026, so this fixture is the only
    // proof the combined path works. Sajan has 2 biometric heads and Jiwan Lal
    // has 3; the combined record must see 5, not 0.
    const db = makeDb();
    addEmp(db, { code: 'S1', dept: 'SAJAN' });
    addEmp(db, { code: 'S2', dept: 'SAJAN' });
    addEmp(db, { code: 'J1', dept: 'JIWAN CONT' });
    addEmp(db, { code: 'J2', dept: 'JIWAN CONT' });
    addEmp(db, { code: 'J3', dept: 'JIWAN CONT' });
    for (const c of ['S1', 'S2', 'J1', 'J2', 'J3']) addAtt(db, c, '2026-04-10', 'P');
    addContractor(db, 11, 'SAJJAN+JIWAN LAL (12-H)');
    addDwEntry(db, { contractorId: 11, date: '2026-04-10', heads: 4, rate: 700 });

    const rep = monthReport(db, M);
    const flag = rep.exceptions.both.find((o) => o.contractor === 'Sajan + Jiwan Lal (12-h)');
    expect(flag).toBeDefined();
    expect(flag.bio).toBe(5);                              // 2 Sajan + 3 Jiwan Lal
    expect(flag.comparedAgainst).toEqual(['Sajan', 'Jiwan Lal']);
    expect(flag.maxDoublePay).toBe(2800);                  // min(5,4) * 700
    // The component gangs have no daily wage of their own, so they are clean.
    expect(rep.exceptions.both.filter((o) => o.contractor === 'Sajan')).toHaveLength(0);
  });
});

// ─── tie-out ──────────────────────────────────────────────────────────────
describe('payroll tie-out', () => {
  test('a mismatch is flagged and a match is not; a missing row is neither', () => {
    const db = makeDb();
    addEmp(db, { code: 'T1', dept: 'MEERA' });
    addEmp(db, { code: 'T2', dept: 'MEERA' });
    addEmp(db, { code: 'T3', dept: 'MEERA' });
    for (const c of ['T1', 'T2', 'T3']) {
      addAtt(db, c, '2026-04-01', 'P');
      addAtt(db, c, '2026-04-02', 'P');
    }
    addDayCalc(db, 'T1', 4, 2026, 2);     // ties
    addDayCalc(db, 'T2', 4, 2026, 5);     // differs
    // T3 has no day_calculations row at all

    const tie = monthReport(db, M).exceptions.tie;
    expect(tie).toHaveLength(1);
    expect(tie[0]).toMatchObject({ code: 'T2', manDays: 2, payrollDays: 5 });
  });

  test('employees with no joining date are listed with their present days', () => {
    const db = makeDb();
    addEmp(db, { code: 'N1', dept: 'MEERA', doj: null });
    addAtt(db, 'N1', '2026-04-01', 'P');
    addAtt(db, 'N1', '2026-04-02', '½P');
    addAtt(db, 'N1', '2026-04-03', 'A');
    const nodoj = monthReport(db, M).exceptions.nodoj;
    expect(nodoj).toHaveLength(1);
    expect(nodoj[0]).toMatchObject({ code: 'N1', days: 2 });   // heads, not man-days
  });
});

// ─── company filter + banner ──────────────────────────────────────────────
describe('company filter and the unknown-company banner', () => {
  test('the filter narrows biometric workers and leaves daily wage alone', () => {
    const db = makeDb();
    addEmp(db, { code: 'A1', dept: 'MEERA', company: 'Asian Lakto Ind Ltd' });
    addEmp(db, { code: 'I1', dept: 'MEERA', company: 'Indriyan Beverages Pvt Ltd' });
    addAtt(db, 'A1', '2026-04-01', 'P');
    addAtt(db, 'I1', '2026-04-01', 'P');
    addContractor(db, 10, 'CHOTTU CONT');
    addDwEntry(db, { contractorId: 10, date: '2026-04-01', heads: 4, rate: 600 });

    const all = monthReport(db, M);
    expect(all.totals.stats.manDays).toBe(2);
    expect(all.totals.stats.dwHeads).toBe(4);

    const asian = monthReport(db, { ...M, company: 'Asian Lakto Ind Ltd' });
    expect(asian.totals.stats.manDays).toBe(1);
    expect(asian.totals.stats.dwHeads).toBe(4);   // daily wage is not company-split
  });

  test('ASIAN, Default and the literal "null" all count as unknown company', () => {
    const db = makeDb();
    addEmp(db, { code: 'V1', dept: 'MEERA', company: 'Asian Lakto Ind Ltd' });
    addEmp(db, { code: 'X1', dept: 'MEERA', company: 'ASIAN' });
    addEmp(db, { code: 'X2', dept: 'MEERA', company: 'Default' });
    addEmp(db, { code: 'X3', dept: 'MEERA', company: 'null' });
    for (const c of ['V1', 'X1', 'X2', 'X3']) addAtt(db, c, '2026-04-01', 'P');

    const rep = monthReport(db, M);
    expect(rep.unknownCompanyRatio).toBe(0.75);   // 3 of 4 man-days
  });
});

// ─── day report ───────────────────────────────────────────────────────────
describe('day report', () => {
  test('lists the employees present and the daily-wage records side by side', () => {
    const db = makeDb();
    addEmp(db, { code: 'C1', dept: 'MEERA', name: 'ZEBRA', designation: 'HELPER' });
    addEmp(db, { code: 'C2', dept: 'MEERA', name: 'ALPHA', designation: 'SUPERVISOR' });
    addEmp(db, { code: 'C3', dept: 'MEERA', name: 'NIGHTY', designation: 'LODING' });
    addAtt(db, 'C1', '2026-04-01', 'P');
    addAtt(db, 'C2', '2026-04-01', 'P');
    addAtt(db, 'C3', '2026-04-01', 'P', { night: true });
    addContractor(db, 9, 'MEERA DAILY WAGE');
    addDwEntry(db, { contractorId: 9, date: '2026-04-01', heads: 3, rate: 550, dept: 'godown' });

    const rep = dayReport(db, { date: '2026-04-01' });
    expect(rep.contractors).toHaveLength(1);
    const m = rep.contractors[0];
    expect(m).toMatchObject({ name: 'Meera', bio: 3, bioDay: 2, bioNight: 1, dwHeads: 3, dwCost: 1650 });
    // Supervisor, then Loading, then Helper
    expect(m.employees.map((e) => e.role)).toEqual(['Supervisor', 'Loading', 'Helper']);
    expect(m.dwEntries[0].allocations[0]).toMatchObject({ dept: 'Godown', typed: 'godown', heads: 3 });
    expect(m.dwEntries[0].gateRef).toBeTruthy();
  });

  test('a date with nothing on it returns no contractors rather than throwing', () => {
    const db = makeDb();
    addEmp(db, { code: 'C1', dept: 'MEERA' });
    addAtt(db, 'C1', '2026-04-01', 'P');
    expect(dayReport(db, { date: '2026-04-15' }).contractors).toEqual([]);
  });

  test('pre-joining and missing-joining-date employees are flagged on the row', () => {
    const db = makeDb();
    addEmp(db, { code: 'P1', dept: 'MEERA', doj: '2026-04-10' });
    addEmp(db, { code: 'N1', dept: 'MEERA', doj: null });
    addAtt(db, 'P1', '2026-04-01', 'P');
    addAtt(db, 'N1', '2026-04-01', 'P');
    const emps = dayReport(db, { date: '2026-04-01' }).contractors[0].employees;
    expect(emps.find((e) => e.code === 'P1').preJoining).toBe(true);
    expect(emps.find((e) => e.code === 'N1').noDoj).toBe(true);
  });
});

// ─── grid report ──────────────────────────────────────────────────────────
describe('grid report', () => {
  test('cells, month stats and the payroll tie for one contractor', () => {
    const db = makeDb();
    addEmp(db, { code: 'G1', dept: 'MEERA', name: 'GRID ONE', doj: '2026-04-02' });
    addEmp(db, { code: 'O1', dept: 'PAPPU CONT', name: 'OTHER' });   // different gang
    addAtt(db, 'G1', '2026-04-01', 'P');                  // pre-joining
    addAtt(db, 'G1', '2026-04-02', 'P', { night: true });
    addAtt(db, 'G1', '2026-04-03', '½P');
    addAtt(db, 'G1', '2026-04-04', 'A');
    addAtt(db, 'G1', '2026-04-05', 'WO');
    addAtt(db, 'G1', '2026-04-06', 'WOP');
    addAtt(db, 'O1', '2026-04-02', 'P');
    addDayCalc(db, 'G1', 4, 2026, 2.5);

    const rep = gridReport(db, { ...M, contractor: 'Meera' });
    expect(rep.employees).toHaveLength(1);
    const e = rep.employees[0];
    expect(e.cells['2026-04-02']).toEqual({ status: 'P', night: true, preJoining: false });
    expect(e.cells['2026-04-01'].preJoining).toBe(true);
    expect(e.stats).toMatchObject({
      dayShifts: 3,       // 1 Apr (pre-joining still a shift), 3 Apr, 6 Apr
      nightShifts: 1,
      halfDays: 1,
      wop: 1,
      absent: 1,
      weeklyOff: 1,
      preJoining: 1,
      manDays: 2.5,       // 1 + 0.5 + 1, the pre-joining day excluded
      payrollDays: 2.5,
      tie: true,
      firstPunch: '2026-04-01',
      lastPunch: '2026-04-06',
    });
  });

  test('a daily-wage-only contractor returns an empty grid, not an error', () => {
    const db = makeDb();
    addContractor(db, 10, 'CHOTTU CONT');
    addDwEntry(db, { contractorId: 10, date: '2026-04-01', heads: 5, rate: 600 });
    const rep = gridReport(db, { ...M, contractor: 'Chottu' });
    expect(rep.employees).toEqual([]);
    expect(rep.days).toHaveLength(30);
    expect(rep.footer['2026-04-01'].dwHeads).toBe(5);
    expect(rep.footer['2026-04-01'].bothSource).toBe(false);
  });

  test('the footer marks a both-source column red', () => {
    const db = makeDb();
    addEmp(db, { code: 'C1', dept: 'MEERA' });
    addAtt(db, 'C1', '2026-04-01', 'P');
    addContractor(db, 9, 'MEERA DAILY WAGE');
    addDwEntry(db, { contractorId: 9, date: '2026-04-01', heads: 2, rate: 550 });
    const f = gridReport(db, { ...M, contractor: 'Meera' }).footer;
    expect(f['2026-04-01']).toMatchObject({ bioDay: 1, bioNight: 0, dwHeads: 2, bothSource: true });
    expect(f['2026-04-02'].bothSource).toBe(false);
  });

  test('a combined daily-wage record credits its components’ footer columns', () => {
    const db = makeDb();
    addEmp(db, { code: 'S1', dept: 'SAJAN' });
    addAtt(db, 'S1', '2026-04-10', 'P');
    addContractor(db, 11, 'SAJJAN+JIWAN LAL (12-H)');
    addDwEntry(db, { contractorId: 11, date: '2026-04-10', heads: 4, rate: 700 });
    const f = gridReport(db, { ...M, contractor: 'Sajan' }).footer;
    expect(f['2026-04-10']).toMatchObject({ dwHeads: 4, bothSource: true });
  });

  test('months of different lengths produce the right number of days', () => {
    const db = makeDb();
    expect(gridReport(db, { month: 2, year: 2026, contractor: 'Meera' }).days).toHaveLength(28);
    expect(gridReport(db, { month: 5, year: 2026, contractor: 'Meera' }).days).toHaveLength(31);
  });
});

// ─── read-only guarantee ──────────────────────────────────────────────────
describe('read-only', () => {
  test('building all three reports leaves every table untouched', () => {
    const db = makeDb();
    addEmp(db, { code: 'C1', dept: 'MEERA' });
    addAtt(db, 'C1', '2026-04-01', 'P');
    addContractor(db, 10, 'CHOTTU CONT');
    addDwEntry(db, { contractorId: 10, date: '2026-04-01', heads: 5, rate: 600 });
    addDayCalc(db, 'C1', 4, 2026, 1);

    const tables = ['employees', 'attendance_processed', 'day_calculations',
      'dw_contractors', 'dw_entries', 'dw_department_allocations'];
    const before = tables.map((t) => db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n);

    monthReport(db, M);
    dayReport(db, { date: '2026-04-01' });
    gridReport(db, { ...M, contractor: 'Meera' });

    const after = tables.map((t) => db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n);
    expect(after).toEqual(before);
    expect(db.prepare('SELECT * FROM employees').all()).toHaveLength(1);
  });
});

// ─── grid department filtering + name lookup (added after the self-debug pass) ──
describe('grid department filter and contractor lookup', () => {
  test('an unmapped contractor is its own department, so its grid still loads', () => {
    const db = makeDb();
    addEmp(db, { code: 'U1', dept: 'BRAND NEW CONT', name: 'UNMAPPED ONE' });
    addAtt(db, 'U1', '2026-04-01', 'P');
    expect(CFG.departmentsForContractor('Meera').sort()).toEqual(['MEERA', 'MRREA']);
    expect(CFG.departmentsForContractor('BRAND NEW CONT')).toEqual(['BRAND NEW CONT']);

    const rep = gridReport(db, { ...M, contractor: 'BRAND NEW CONT' });
    expect(rep.employees.map((e) => e.code)).toEqual(['U1']);
  });

  test('both MEERA and the MRREA typo land in the same grid', () => {
    const db = makeDb();
    addEmp(db, { code: 'M1', dept: 'MEERA', name: 'AAA' });
    addEmp(db, { code: 'M2', dept: 'MRREA', name: 'BBB' });
    addEmp(db, { code: 'P1', dept: 'PAPPU CONT', name: 'CCC' });
    for (const c of ['M1', 'M2', 'P1']) addAtt(db, c, '2026-04-01', 'P');
    const rep = gridReport(db, { ...M, contractor: 'Meera' });
    expect(rep.employees.map((e) => e.code).sort()).toEqual(['M1', 'M2']);
  });

  test('tie is null when payroll has no row for that employee', () => {
    const db = makeDb();
    addEmp(db, { code: 'G1', dept: 'MEERA' });
    addAtt(db, 'G1', '2026-04-01', 'P');
    const e = gridReport(db, { ...M, contractor: 'Meera' }).employees[0];
    expect(e.stats.payrollDays).toBeNull();
    expect(e.stats.tie).toBeNull();
  });

  test('contractorNamesForMonth sees both sources and hides test contractors', () => {
    const db = makeDb();
    addEmp(db, { code: 'M1', dept: 'MEERA' });
    addAtt(db, 'M1', '2026-04-01', 'P');
    addContractor(db, 10, 'CHOTTU CONT');
    addContractor(db, 1, 'RAJESH KUMAR');
    addDwEntry(db, { contractorId: 10, date: '2026-04-02', heads: 3, rate: 600 });
    addDwEntry(db, { contractorId: 1, date: '2026-04-02', heads: 3, rate: 450 });
    const names = contractorNamesForMonth(db, M).sort();
    expect(names).toEqual(['Chottu', 'Meera']);
  });
});


// ─── regressions from the Phase 4 code review ─────────────────────────────
describe('code-review regressions', () => {
  test('F1: a combined record\u2019s grid shows BOTH component gangs, and its footer agrees with the exception', () => {
    const db = makeDb();
    addEmp(db, { code: 'S1', dept: 'SAJAN', name: 'SAJAN ONE' });
    addEmp(db, { code: 'J1', dept: 'JIWAN CONT', name: 'JIWAN ONE' });
    addAtt(db, 'S1', '2026-04-10', 'P');
    addAtt(db, 'J1', '2026-04-10', 'P');
    addContractor(db, 11, 'SAJJAN+JIWAN LAL (12-H)');
    addDwEntry(db, { contractorId: 11, date: '2026-04-10', heads: 4, rate: 700 });

    const name = 'Sajan + Jiwan Lal (12-h)';
    const grid = gridReport(db, { ...M, contractor: name });
    expect(grid.employees.map((e) => e.code).sort()).toEqual(['J1', 'S1']);
    // The grid must not contradict the Exceptions tab for the same day.
    expect(grid.footer['2026-04-10']).toMatchObject({ dwHeads: 4, bothSource: true });
    const flag = monthReport(db, M).exceptions.both.find((o) => o.contractor === name);
    expect(flag.bio).toBe(2);
  });

  test('F3: a gate contractor named exactly like a biometric department still raises both-source', () => {
    const db = makeDb();
    addEmp(db, { code: 'M1', dept: 'MEERA' });
    addAtt(db, 'M1', '2026-04-01', 'P');
    addContractor(db, 99, 'MEERA');          // NOT in DW_CONTRACTOR_ALIASES
    addDwEntry(db, { contractorId: 99, date: '2026-04-01', heads: 3, rate: 500 });

    const rep = monthReport(db, M);
    expect(rep.contractors).toEqual(['Meera']);          // one gang, not two
    expect(rep.exceptions.both).toHaveLength(1);
    expect(rep.exceptions.both[0]).toMatchObject({ contractor: 'Meera', bio: 1, dwHeads: 3 });
  });

  test('F4: the unknown-company banner survives a company filter', () => {
    const db = makeDb();
    addEmp(db, { code: 'V1', dept: 'MEERA', company: 'Asian Lakto Ind Ltd' });
    addEmp(db, { code: 'X1', dept: 'MEERA', company: 'Default' });
    addEmp(db, { code: 'X2', dept: 'MEERA', company: 'null' });
    for (const c of ['V1', 'X1', 'X2']) addAtt(db, c, '2026-04-01', 'P');

    // Filtering to a real company must NOT silence the warning about the
    // workers that filter just dropped.
    const filtered = monthReport(db, { ...M, company: 'Asian Lakto Ind Ltd' });
    expect(filtered.totals.stats.manDays).toBe(1);
    expect(filtered.unknownCompanyRatio).toBeCloseTo(2 / 3, 3);
    expect(monthReport(db, M).unknownCompanyRatio).toBeCloseTo(2 / 3, 3);
  });

  test('F6: a finance-rejected entry is not reported as awaiting approval', () => {
    const db = makeDb();
    addContractor(db, 10, 'CHOTTU CONT');
    addDwEntry(db, { contractorId: 10, date: '2026-04-01', heads: 5, rate: 600, status: 'rejected' });
    addDwEntry(db, { contractorId: 10, date: '2026-04-02', heads: 4, rate: 600, status: 'hr_entered' });

    const rep = monthReport(db, M);
    expect(rep.exceptions.pend.map((o) => o.status)).toEqual(['hr_entered']);
    expect(rep.exceptions.rejected.map((o) => o.status)).toEqual(['rejected']);
    // rejected is terminal, so it must not keep the actionable badge non-zero
    expect(rep.exceptions.count).toBe(1);
    expect(rep.cells['2026-04-01'].Chottu.dwPending).toBe(0);
    expect(rep.cells['2026-04-02'].Chottu.dwPending).toBe(4);
  });

  test('F7: a contractor name containing the key separator survives the duplicate grouping', () => {
    const db = makeDb();
    addContractor(db, 20, 'PAPPU | NIGHT');
    addContractor(db, 21, 'PAPPU|NIGHT EXTRA');
    addDwEntry(db, { contractorId: 20, date: '2026-04-04', heads: 3, rate: 600 });
    addDwEntry(db, { contractorId: 20, date: '2026-04-05', heads: 3, rate: 600 });
    const rep = monthReport(db, M);
    expect(rep.contractors).toContain('PAPPU | NIGHT');
    expect(rep.exceptions.dup).toHaveLength(0);
    // and the same name on one day from two records is still caught intact
    addDwEntry(db, { contractorId: 21, date: '2026-04-04', heads: 2, rate: 600 });
    const rep2 = monthReport(db, M);
    const dup = rep2.exceptions.dup.find((d) => d.date === '2026-04-04');
    expect(dup).toBeUndefined();   // different display names, so not a duplicate
  });

  test('F14: the tie-out sums a genuinely multi-company employee rather than picking one row', () => {
    // day_calculations is UNIQUE(employee_code, month, year, company), so one
    // employee can hold a row per company. Their biometric man-days are
    // company-wide too, so the sum is the right comparison.
    const db = makeDb();
    addEmp(db, { code: 'MC1', dept: 'MEERA' });
    for (const d of ['2026-04-01', '2026-04-02', '2026-04-03']) addAtt(db, 'MC1', d, 'P');
    addDayCalc(db, 'MC1', 4, 2026, 1, 'Asian Lakto Ind Ltd');
    addDayCalc(db, 'MC1', 4, 2026, 2, 'Indriyan Beverages Pvt Ltd');
    const rep = monthReport(db, M);
    expect(rep.exceptions.tie).toHaveLength(0);          // 3 man-days vs 1 + 2
    const grid = gridReport(db, { ...M, contractor: 'Meera' });
    expect(grid.employees[0].stats).toMatchObject({ manDays: 3, payrollDays: 3, tie: true });
  });
});

// ─── 2.1 · C — payroll's own status rule on the tie-out ───────────────────
//
// Stage 6 reads effectiveStatusForDay(), which ignores an HR miss-punch
// resolution until finance approves it. The report reads status_final. Every
// correction still awaiting finance therefore showed up as a false mismatch —
// 10 of them across September 2026 on production, all explained by 11 pending
// "Gate Register" corrections that turned a punched P into an A.
describe('2.1 · corrections awaiting finance (C)', () => {
  // One worker, three P days, one of which HR marked absent from the gate
  // register. Payroll still pays it, so payroll says 3 and status_final says 2.
  function pendingFixture(financeStatus) {
    const db = makeDb();
    addEmp(db, { code: 'C1', name: 'LALIT SADA', dept: 'MEERA', doj: '2026-01-01' });
    addAtt(db, 'C1', '2026-04-01', 'P');
    addAtt(db, 'C1', '2026-04-02', 'P');
    addAtt(db, 'C1', '2026-04-03', 'A', {
      original: 'P', final: 'A', missPunch: true,
      financeStatus, correctionSource: 'Gate Register',
    });
    addDayCalc(db, 'C1', 4, 2026, 3);
    return db;
  }

  test('C1: a pending correction is explained, not reported as a mismatch', () => {
    const x = monthReport(pendingFixture('pending'), M).exceptions;
    expect(x.tie).toHaveLength(0);
    expect(x.financePending).toHaveLength(1);
    expect(x.financePending[0]).toMatchObject({
      code: 'C1', name: 'LALIT SADA', contractor: 'Meera', date: '2026-04-03',
      punchedAs: 'P', hrMarkedAs: 'A', payrollStatus: 'P',
      correctionSource: 'Gate Register', financeStatus: 'pending',
    });
  });

  test('C2: an APPROVED correction is payroll reality — it must still mismatch', () => {
    // Finance agreed the day was absent, so payroll should have paid 2. It paid
    // 3. That is a real problem and must NOT be explained away.
    const x = monthReport(pendingFixture('approved'), M).exceptions;
    expect(x.financePending).toHaveLength(0);
    expect(x.tie).toHaveLength(1);
    expect(x.tie[0]).toMatchObject({ code: 'C1', manDays: 2, payrollView: 2, payrollDays: 3 });
  });

  test('C3: a REJECTED correction falls back to half a day, per the payroll rule', () => {
    // effectiveStatusForDay forces ½P on rejection. Production has never
    // produced a rejected row, so this branch is covered here or nowhere.
    const db = pendingFixture('rejected');
    const x = monthReport(db, M).exceptions;
    expect(x.financePending[0]).toMatchObject({ payrollStatus: '½P', financeStatus: 'rejected' });
    // payroll's view is 2 + 0.5; day_calculations says 3, so 0.5 is unexplained
    expect(x.tie[0]).toMatchObject({ manDays: 2, payrollView: 2.5, payrollDays: 3 });
  });

  test('C4: NULL and empty finance status both mean "not ruled on yet"', () => {
    for (const fs of [null, '']) {
      const x = monthReport(pendingFixture(fs), M).exceptions;
      expect(x.tie).toHaveLength(0);
      expect(x.financePending[0].financeStatus).toBe('pending');
    }
  });

  test('C5: a resolution that does not move the day is not an exception', () => {
    // HR filled in a missing punch time but the status stayed P. Nothing to
    // explain, so it must not pad the list.
    const db = makeDb();
    addEmp(db, { code: 'C2', dept: 'MEERA' });
    addAtt(db, 'C2', '2026-04-01', 'P', {
      original: 'P', final: 'P', missPunch: true, financeStatus: 'pending',
    });
    addDayCalc(db, 'C2', 4, 2026, 1);
    const x = monthReport(db, M).exceptions;
    expect(x.financePending).toHaveLength(0);
    expect(x.tie).toHaveLength(0);
  });

  test('C6: several pending days on one person add up', () => {
    const db = makeDb();
    addEmp(db, { code: 'C3', dept: 'MEERA' });
    for (const d of ['2026-04-01', '2026-04-07']) {
      addAtt(db, 'C3', d, 'A', {
        original: 'P', final: 'A', missPunch: true,
        financeStatus: 'pending', correctionSource: 'Gate Register',
      });
    }
    addAtt(db, 'C3', '2026-04-08', 'P');
    addDayCalc(db, 'C3', 4, 2026, 3);            // payroll pays all three
    const x = monthReport(db, M).exceptions;
    expect(x.financePending).toHaveLength(2);
    expect(x.tie).toHaveLength(0);
  });

  test('C7: heads and man-days everywhere else still read status_final', () => {
    const rep = monthReport(pendingFixture('pending'), M);
    // 3 punched days, one of which HR marked absent → 2 man-days, not 3.
    expect(rep.totals.stats.manDays).toBe(2);
    expect(rep.totals.perContractor.Meera.manDays).toBe(2);
    // the corrected day reads as absent, so it raises no Meera cell at all,
    // while an untouched day still shows its head
    expect(rep.cells['2026-04-03'].Meera).toBeUndefined();
    expect(rep.cells['2026-04-01'].Meera.bio).toBe(1);
  });

  test('C8: a pending day is flagged on the grid cell and ties the employee', () => {
    const grid = gridReport(pendingFixture('pending'), { ...M, contractor: 'Meera' });
    const emp = grid.employees[0];
    expect(emp.stats).toMatchObject({ manDays: 2, payrollView: 3, payrollDays: 3, tie: true });
    expect(emp.cells['2026-04-03']).toMatchObject({
      status: 'A', pending: true, punchedAs: 'P', hrMarkedAs: 'A',
      payrollStatus: 'P', correctionSource: 'Gate Register', financeStatus: 'pending',
    });
    // an ordinary day carries none of those fields
    expect(emp.cells['2026-04-01'].pending).toBeUndefined();
  });

  test('C9: a pre-joining pending day moves nothing, because payroll skips it too', () => {
    const db = makeDb();
    addEmp(db, { code: 'C4', dept: 'MEERA', doj: '2026-04-10' });
    addAtt(db, 'C4', '2026-04-02', 'A', {
      original: 'P', final: 'A', missPunch: true, financeStatus: 'pending',
    });
    addAtt(db, 'C4', '2026-04-11', 'P');
    addDayCalc(db, 'C4', 4, 2026, 1);
    const x = monthReport(db, M).exceptions;
    expect(x.tie).toHaveLength(0);               // 1 man-day, payroll 1
    expect(x.financePending).toHaveLength(1);    // still listed, still visible
  });

  test('C10: financePending counts toward the exceptions badge', () => {
    const x = monthReport(pendingFixture('pending'), M).exceptions;
    expect(x.count).toBe(x.financePending.length);
  });
});

// ─── 2.1 · B — active on roster, no punch for 30+ days ────────────────────
describe('2.1 · stale roster (B)', () => {
  const TODAY = '2026-09-19';
  const stale = (db) => monthReport(db, { ...M, today: TODAY }).exceptions.stale;

  test('B1: 31 days silent is flagged, 30 is not', () => {
    const db = makeDb();
    addEmp(db, { code: 'S30', name: 'EXACTLY THIRTY', dept: 'MEERA' });
    addAtt(db, 'S30', '2026-08-20', 'P');        // 30 days before 19 Sep
    addEmp(db, { code: 'S31', name: 'THIRTY ONE', dept: 'MEERA' });
    addAtt(db, 'S31', '2026-08-19', 'P');        // 31 days
    const codes = stale(db).map((r) => r.code);
    expect(codes).toEqual(['S31']);
    expect(stale(db)[0]).toMatchObject({
      name: 'THIRTY ONE', contractor: 'Meera', lastPunch: '2026-08-19', daysSince: 31,
    });
  });

  test('B2: someone who never punched at all is flagged, with a null last punch', () => {
    const db = makeDb();
    addEmp(db, { code: 'NEVER', name: 'NO PUNCH EVER', dept: 'MEERA', doj: '2026-01-05' });
    const rows = stale(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      code: 'NEVER', doj: '2026-01-05', lastPunch: null, daysSince: null,
    });
  });

  test('B3: only absences do not count as a punch', () => {
    const db = makeDb();
    addEmp(db, { code: 'ABS', dept: 'MEERA' });
    addAtt(db, 'ABS', '2026-09-18', 'A');        // yesterday, but not present
    addAtt(db, 'ABS', '2026-09-17', 'WO');
    expect(stale(db).map((r) => r.code)).toEqual(['ABS']);
  });

  test('B4: a half day counts as a punch', () => {
    const db = makeDb();
    addEmp(db, { code: 'HALF', dept: 'MEERA' });
    addAtt(db, 'HALF', '2026-09-18', '½P');
    expect(stale(db)).toHaveLength(0);
  });

  test('B5: people already marked Left are not stale roster rows', () => {
    const db = makeDb();
    addEmp(db, { code: 'LEFT', dept: 'MEERA', status: 'Left' });
    addEmp(db, { code: 'LIVE', dept: 'MEERA', status: 'Active' });
    expect(stale(db).map((r) => r.code)).toEqual(['LIVE']);
  });

  test('B6: it ignores the month selector entirely', () => {
    const db = makeDb();
    addEmp(db, { code: 'OLD', dept: 'MEERA' });
    addAtt(db, 'OLD', '2026-01-04', 'P');
    const april = monthReport(db, { ...M, today: TODAY }).exceptions.stale;
    const may = monthReport(db, { month: 5, year: 2026, today: TODAY }).exceptions.stale;
    expect(april).toEqual(may);
    expect(april[0].daysSince).toBe(258);
  });

  test('B7: longest silent first, never-punched above everyone', () => {
    const db = makeDb();
    addEmp(db, { code: 'A1', dept: 'MEERA' }); addAtt(db, 'A1', '2026-08-01', 'P');
    addEmp(db, { code: 'B1', dept: 'MEERA' }); addAtt(db, 'B1', '2026-05-01', 'P');
    addEmp(db, { code: 'Z9', dept: 'MEERA' });   // never punched
    expect(stale(db).map((r) => r.code)).toEqual(['Z9', 'B1', 'A1']);
  });

  test('B8: stale rows stay OUT of the month badge count', () => {
    // 231 month-independent rows would swamp a month signal.
    const db = makeDb();
    addEmp(db, { code: 'ST', dept: 'MEERA' });
    const x = monthReport(db, { ...M, today: TODAY }).exceptions;
    expect(x.stale).toHaveLength(1);
    expect(x.count).toBe(0);
  });

  test('B9: excluded departments and non-contract staff never reach it', () => {
    const db = makeDb();
    addEmp(db, { code: 'SEC', dept: 'SECURITY' });
    addEmp(db, { code: 'PERM', dept: 'MEERA', employmentType: 'Permanent' });
    expect(stale(db)).toHaveLength(0);
  });
});

// ─── 2.1 · A — the grid shows people who worked ───────────────────────────
describe('2.1 · grid shows people who worked (A)', () => {
  function gangFixture() {
    const db = makeDb();
    addEmp(db, { code: 'W1', name: 'WORKED ONE', dept: 'MEERA' });
    addAtt(db, 'W1', '2026-04-02', 'P');
    addEmp(db, { code: 'W2', name: 'WORKED HALF', dept: 'MEERA' });
    addAtt(db, 'W2', '2026-04-02', '½P');
    addEmp(db, { code: 'N1', name: 'ABSENT ALL MONTH', dept: 'MEERA' });
    addAtt(db, 'N1', '2026-04-02', 'A');
    addAtt(db, 'N1', '2026-04-05', 'WO');
    addEmp(db, { code: 'N2', name: 'NO ROW AT ALL', dept: 'MEERA' });
    return db;
  }

  test('A1: worked first, idle after, each flagged', () => {
    const g = gridReport(gangFixture(), { ...M, contractor: 'Meera' });
    expect(g.workedCount).toBe(2);
    expect(g.noPunchCount).toBe(2);
    // within each block the gang's own order applies (role, then name)
    expect(g.employees.map((e) => e.code)).toEqual(['W2', 'W1', 'N1', 'N2']);
    expect(g.employees.map((e) => e.noPunch)).toEqual([false, false, true, true]);
  });

  test('A2: someone with no attendance row at all still appears', () => {
    // The old grid started from attendance_processed, so this person was
    // invisible — and a gang that worked no days rendered as an empty table.
    const g = gridReport(gangFixture(), { ...M, contractor: 'Meera' });
    const n2 = g.employees.find((e) => e.code === 'N2');
    expect(n2).toBeDefined();
    expect(n2.cells).toEqual({});
    expect(n2.stats).toMatchObject({ workedDays: 0, manDays: 0 });
  });

  test('A3: an absent-all-month worker keeps their cells, so the pattern shows', () => {
    const g = gridReport(gangFixture(), { ...M, contractor: 'Meera' });
    const n1 = g.employees.find((e) => e.code === 'N1');
    expect(n1.noPunch).toBe(true);
    expect(n1.cells['2026-04-02']).toMatchObject({ status: 'A' });
    expect(n1.stats).toMatchObject({ absent: 1, weeklyOff: 1, workedDays: 0 });
  });

  test('A4: a gang where nobody worked still renders its roster', () => {
    const db = makeDb();
    addEmp(db, { code: 'IDLE1', dept: 'MOTI LAL CON' });
    addEmp(db, { code: 'IDLE2', dept: 'MOTI LAL CON' });
    const g = gridReport(db, { ...M, contractor: 'Moti Lal' });
    expect(g.workedCount).toBe(0);
    expect(g.noPunchCount).toBe(2);
  });

  test('A5: a worker marked Left who DID work is kept — their man-days must tie', () => {
    const db = makeDb();
    addEmp(db, { code: 'LW', dept: 'MEERA', status: 'Left' });
    addAtt(db, 'LW', '2026-04-02', 'P');
    const g = gridReport(db, { ...M, contractor: 'Meera' });
    expect(g.workedCount).toBe(1);
    expect(g.employees[0]).toMatchObject({ code: 'LW', noPunch: false });
  });

  test('A6: a worker marked Left with no punch is dropped, not listed as idle', () => {
    const db = makeDb();
    addEmp(db, { code: 'LN', dept: 'MEERA', status: 'Left' });
    addAtt(db, 'LN', '2026-04-02', 'A');
    const g = gridReport(db, { ...M, contractor: 'Meera' });
    expect(g.employees).toHaveLength(0);
    expect(g.noPunchCount).toBe(0);
  });

  test('A7: only pre-joining punches still count as having worked', () => {
    // They punched. Payroll does not pay it, which the red ring already says —
    // but they are not an idle roster row.
    const db = makeDb();
    addEmp(db, { code: 'PJ', dept: 'MEERA', doj: '2026-04-20' });
    addAtt(db, 'PJ', '2026-04-02', 'P');
    const g = gridReport(db, { ...M, contractor: 'Meera' });
    expect(g.workedCount).toBe(1);
    expect(g.employees[0].stats).toMatchObject({ workedDays: 1, preJoining: 1, manDays: 0 });
  });

  test('A8: idle people contribute nothing to the footer', () => {
    const g = gridReport(gangFixture(), { ...M, contractor: 'Meera' });
    expect(g.footer['2026-04-02']).toMatchObject({ bioDay: 2, bioNight: 0 });
  });
});

// ─── 2.1 · the grid's contractor picker ───────────────────────────────────
describe('2.1 · gridContractors', () => {
  test('G1: a gang with an Active roster but no activity is still selectable', () => {
    // `contractors` is "who appears in this month's data" and drives the header
    // filter and every exception list — it must NOT gain the idle gang.
    const db = makeDb();
    addEmp(db, { code: 'GA', dept: 'MEERA' });
    addAtt(db, 'GA', '2026-04-02', 'P');
    addEmp(db, { code: 'GB', dept: 'MOTI LAL CON' });      // Active, never punched
    const rep = monthReport(db, M);
    expect(rep.contractors).toEqual(['Meera']);
    expect(rep.gridContractors).toEqual(['Meera', 'Moti Lal']);
  });

  test('G2: a gang whose only people have left is not offered', () => {
    const db = makeDb();
    addEmp(db, { code: 'GC', dept: 'MEERA' });
    addAtt(db, 'GC', '2026-04-02', 'P');
    addEmp(db, { code: 'GD', dept: 'RANJIT CONT', status: 'Left' });
    expect(monthReport(db, M).gridContractors).toEqual(['Meera']);
  });

  test('G3: it honours the company filter like every other query', () => {
    const db = makeDb();
    addEmp(db, { code: 'GE', dept: 'MEERA', company: 'Asian Lakto Ind Ltd' });
    addAtt(db, 'GE', '2026-04-02', 'P');
    addEmp(db, { code: 'GF', dept: 'PAPPU CONT', company: 'Indriyan Beverages Pvt Ltd' });
    const rep = monthReport(db, { ...M, company: 'Asian Lakto Ind Ltd' });
    expect(rep.gridContractors).toEqual(['Meera']);
  });
});

// ─── 2.1 · code-review regressions ────────────────────────────────────────
describe('2.1 · code-review regressions', () => {
  test('R1: a blank or NULL employee status still counts as on the roster', () => {
    // Treating an unrecorded status as "left" silently deleted those people
    // from the grid along with the absence pattern the split exists to show.
    // analytics.js and recompute.js both read `status IS NULL OR = Active`.
    const db = makeDb();
    addEmp(db, { code: 'NULLST', dept: 'MEERA', status: null });
    addEmp(db, { code: 'BLANKST', dept: 'MEERA', status: '' });
    addEmp(db, { code: 'LEFTST', dept: 'MEERA', status: 'Left' });
    for (const c of ['NULLST', 'BLANKST', 'LEFTST']) addAtt(db, c, '2026-04-02', 'A');
    const g = gridReport(db, { ...M, contractor: 'Meera' });
    expect(g.employees.map((e) => e.code).sort()).toEqual(['BLANKST', 'NULLST']);
    expect(monthReport(db, { ...M, today: '2026-09-19' }).exceptions.stale.map((r) => r.code).sort())
      .toEqual(['BLANKST', 'NULLST']);
  });

  test('R2: payroll pays HP as half a day, so the delta must too', () => {
    // PRESENT_WEIGHTS has no HP (a PR-2 ruling about what counts as a head),
    // but dayCalculation.js:265 counts HP as daysHalfPresent += 0.5. Weighing
    // payroll's side with the report's map scored it 0 and invented a mismatch.
    const db = makeDb();
    addEmp(db, { code: 'HPX', dept: 'MEERA', doj: '2026-01-01' });
    addAtt(db, 'HPX', '2026-04-01', 'P', {
      original: 'HP', final: 'P', missPunch: true, financeStatus: 'pending',
    });
    addAtt(db, 'HPX', '2026-04-02', 'P');
    addDayCalc(db, 'HPX', 4, 2026, 1.5);          // payroll: HP 0.5 + P 1
    const x = monthReport(db, M).exceptions;
    expect(x.financePending[0].delta).toBe(-0.5);  // not -1
    expect(x.tie).toHaveLength(0);
    const g = gridReport(db, { ...M, contractor: 'Meera' });
    expect(g.employees[0].stats).toMatchObject({ manDays: 2, payrollView: 1.5, tie: true });
  });

  test('R3: the grid picker only offers gangs the /grid route accepts', () => {
    // An unmapped department resolves to its own raw name, which the route
    // rejects with a 400 and departmentsForContractor() cannot resolve back.
    const db = makeDb();
    addEmp(db, { code: 'K1', dept: 'MEERA' });
    addAtt(db, 'K1', '2026-04-02', 'P');
    addEmp(db, { code: 'U1', dept: 'NEW GANG CONT' });   // Active, unmapped, no punch
    addEmp(db, { code: 'U2', dept: '' });                // blank department
    const rep = monthReport(db, M);
    expect(rep.gridContractors).toEqual(['Meera']);
    expect(rep.gridContractors.every((c) => CFG.knownContractorNames().includes(c))).toBe(true);
  });

  test('R4: a day with no status at all is not a correction awaiting finance', () => {
    // STATUS_EXPR gives SQL NULL, effectiveStatusForDay gives '' — comparing
    // them directly painted 318 December-2025 cells as awaiting finance.
    const db = makeDb();
    addEmp(db, { code: 'NS', dept: 'MEERA' });
    addAtt(db, 'NS', '2026-04-01', null, { original: null, final: null });
    addAtt(db, 'NS', '2026-04-02', 'P');
    const g = gridReport(db, { ...M, contractor: 'Meera' });
    expect(g.employees[0].cells['2026-04-01'].pending).toBeUndefined();
    expect(monthReport(db, M).exceptions.financePending).toHaveLength(0);
  });

  test('R5: someone hired last week who has not punched yet is not "stale"', () => {
    const db = makeDb();
    addEmp(db, { code: 'NEWHIRE', dept: 'MEERA', doj: '2026-09-15' });   // 4 days ago
    addEmp(db, { code: 'OLDHIRE', dept: 'MEERA', doj: '2025-01-01' });   // long ago
    addEmp(db, { code: 'NODOJ', dept: 'MEERA', doj: null });             // unknowable
    const stale = monthReport(db, { ...M, today: '2026-09-19' }).exceptions.stale;
    expect(stale.map((r) => r.code).sort()).toEqual(['NODOJ', 'OLDHIRE']);
  });

  test('R6: the grid and the Exceptions tab always agree on what is pending', () => {
    // Both sides are gated on the same predicate, so a row can never be
    // outlined on one tab and absent from the other.
    const db = makeDb();
    addEmp(db, { code: 'AG', dept: 'MEERA', doj: '2026-01-01' });
    addAtt(db, 'AG', '2026-04-01', 'A', { original: 'P', final: 'A', missPunch: true, financeStatus: 'pending' });
    addAtt(db, 'AG', '2026-04-02', 'A', { original: 'P', final: 'A', missPunch: true, financeStatus: 'approved' });
    addAtt(db, 'AG', '2026-04-03', null, { original: null, final: null });
    addAtt(db, 'AG', '2026-04-04', 'P');
    addDayCalc(db, 'AG', 4, 2026, 2);
    const gridPending = Object.entries(gridReport(db, { ...M, contractor: 'Meera' }).employees[0].cells)
      .filter(([, c]) => c.pending).map(([d]) => d);
    const tabPending = monthReport(db, M).exceptions.financePending.map((r) => r.date);
    expect(gridPending).toEqual(['2026-04-01']);
    expect(tabPending).toEqual(gridPending);
  });

  test('R7: the stale threshold is published, not re-typed in the UI', () => {
    expect(monthReport(makeDb(), M).staleDays).toBe(CFG.STALE_NO_PUNCH_DAYS);
  });

  test('R8: the grid does not ship its internal active flag', () => {
    const db = makeDb();
    addEmp(db, { code: 'IF1', dept: 'MEERA' });
    addAtt(db, 'IF1', '2026-04-02', 'P');
    expect(gridReport(db, { ...M, contractor: 'Meera' }).employees[0]).not.toHaveProperty('active');
  });
});
