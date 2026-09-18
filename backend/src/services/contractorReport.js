/**
 * Contractor Report — read-only aggregation service. (PR-2, Sep 2026)
 *
 * Three entry points, all pure with respect to the database: they only SELECT.
 * Every rule they apply comes from config/contractorReportConfig.js.
 *
 *   monthReport(db, { month, year, company }) — the whole month: per day ×
 *     contractor cells, month totals, stat cards, and every exception list.
 *   dayReport(db, { date, company })          — one date, drilled to the
 *     individual employees present and the individual daily-wage records.
 *   gridReport(db, { month, year, contractor, company }) — one contractor's
 *     employee × date grid with per-employee month stats and payroll tie-out.
 *
 * Each dataset is fetched with a single query — no per-row lookups.
 */

const CFG = require('../config/contractorReportConfig');

// ─── small helpers ────────────────────────────────────────────────────────
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const pad2 = (n) => String(n).padStart(2, '0');

function monthBounds(month, year) {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { start: `${year}-${pad2(month)}-01`, end: `${year}-${pad2(month)}-${pad2(last)}`, last };
}

function listDays(month, year) {
  const { last } = monthBounds(month, year);
  const out = [];
  for (let d = 1; d <= last; d++) {
    const date = `${year}-${pad2(month)}-${pad2(d)}`;
    out.push({ date, day: d, dow: new Date(date + 'T00:00:00Z').getUTCDay() });
  }
  return out;
}

/** Population predicate + params, shared by every biometric query. */
function populationClause(alias, company) {
  const holes = CFG.EXCLUDED_DEPARTMENTS.map(() => '?').join(',');
  let sql =
    ` LOWER(COALESCE(${alias}.employment_type,'')) LIKE ?` +
    ` AND UPPER(TRIM(COALESCE(${alias}.department,''))) NOT IN (${holes})`;
  const params = [`%${CFG.EMPLOYMENT_TYPE_NEEDLE}%`, ...CFG.EXCLUDED_DEPARTMENTS];
  if (company) {
    sql += ` AND TRIM(COALESCE(${alias}.company,'')) = ?`;
    params.push(String(company).trim());
  }
  return { sql, params };
}

const STATUS_EXPR = `COALESCE(NULLIF(TRIM(ap.status_final),''), TRIM(ap.status_original))`;
const PRE_DOJ_EXPR =
  `CASE WHEN e.date_of_joining IS NOT NULL AND TRIM(e.date_of_joining) <> ''` +
  ` AND ap.date < e.date_of_joining THEN 1 ELSE 0 END`;

/** An empty per-contractor-day cell. */
function emptyCell() {
  return {
    bioDay: 0, bioNight: 0, bio: 0,
    manDays: 0, manDaysDay: 0, manDaysNight: 0,
    dwHeads: 0, dwCost: 0, dwRecords: 0, dwPending: 0,
    deptBreakdown: [],
  };
}

function roundCell(c) {
  c.manDays = r2(c.manDays);
  c.manDaysDay = r2(c.manDaysDay);
  c.manDaysNight = r2(c.manDaysNight);
  c.dwCost = r2(c.dwCost);
  return c;
}

// ─── daily-wage loading ───────────────────────────────────────────────────
/**
 * Every daily-wage entry in a date range, with its department allocations
 * folded in. One query; allocations arrive as extra rows and are grouped here.
 *
 * All statuses and all contractors are loaded — the not-approved and test rows
 * are needed by the exception lists. Callers decide what counts.
 *
 * dw_entries is not company-split in practice, so no company filter is applied
 * (the company selector governs biometric workers only).
 */
function loadDwEntries(db, startDate, endDate) {
  const rows = db
    .prepare(
      `SELECT e.id, e.entry_date, e.contractor_id, c.contractor_name,
              e.total_worker_count, e.wage_rate_applied, e.total_wage_amount,
              e.status, e.gate_entry_reference,
              a.department AS typed_dept, a.worker_count AS alloc_heads,
              a.allocated_wage_amount AS alloc_cost
         FROM dw_entries e
         JOIN dw_contractors c ON c.id = e.contractor_id
         LEFT JOIN dw_department_allocations a ON a.entry_id = e.id
        WHERE e.entry_date BETWEEN ? AND ?
        ORDER BY e.entry_date, e.id, a.id`
    )
    .all(startDate, endDate);

  const byId = new Map();
  for (const row of rows) {
    let entry = byId.get(row.id);
    if (!entry) {
      const resolved = CFG.resolveDwContractor(row.contractor_name);
      entry = {
        id: row.id,
        date: row.entry_date,
        contractorId: row.contractor_id,
        rawName: String(row.contractor_name || '').trim(),
        contractor: resolved.name,
        unmapped: resolved.unmapped,
        isTest: CFG.isTestContractorName(row.contractor_name),
        heads: Number(row.total_worker_count) || 0,
        rate: Number(row.wage_rate_applied) || 0,
        amount: r2(row.total_wage_amount),
        status: row.status,
        counted: CFG.DW_COUNTED_STATUSES.includes(row.status),
        gateRef: row.gate_entry_reference || '',
        allocations: [],
      };
      byId.set(row.id, entry);
    }
    if (row.typed_dept !== null || row.alloc_heads !== null) {
      entry.allocations.push({
        typed: String(row.typed_dept || '').trim(),
        dept: CFG.normalizeDepartment(row.typed_dept),
        heads: Number(row.alloc_heads) || 0,
        cost: r2(row.alloc_cost),
      });
    }
  }

  // An entry with no allocation row still has to show its heads somewhere.
  // Production had zero such entries in April–May 2026, but the fallback is
  // kept so a future gate entry without an allocation is never silently lost.
  for (const entry of byId.values()) {
    if (!entry.allocations.length) {
      entry.allocations.push({
        typed: '',
        dept: CFG.DEPARTMENT_NOT_RECORDED,
        heads: entry.heads,
        cost: entry.amount,
      });
    }
  }
  return [...byId.values()];
}

/** Fold an entry's allocations into a cell's department breakdown. */
function addDeptBreakdown(cell, entry) {
  for (const a of entry.allocations) {
    let found = cell.deptBreakdown.find((d) => d.dept === a.dept);
    if (!found) {
      found = { dept: a.dept, typed: a.typed, heads: 0, cost: 0 };
      cell.deptBreakdown.push(found);
    }
    found.heads += a.heads;
    found.cost = r2(found.cost + a.cost);
  }
}

// ─── month report ─────────────────────────────────────────────────────────
function monthReport(db, { month, year, company }) {
  const { start, end } = monthBounds(month, year);
  const days = listDays(month, year);
  const pop = populationClause('e', company);

  // 1 — biometric attendance, aggregated. One row per
  //     (date, department, night, status, pre-DOJ) bucket.
  const bioRows = db
    .prepare(
      `SELECT ap.date AS date,
              UPPER(TRIM(COALESCE(e.department,''))) AS dept,
              COALESCE(ap.is_night_shift,0) AS night,
              ${STATUS_EXPR} AS status,
              ${PRE_DOJ_EXPR} AS pre_doj,
              COUNT(*) AS n
         FROM attendance_processed ap
         JOIN employees e ON e.code = ap.employee_code
        WHERE ${pop.sql}
          AND COALESCE(ap.is_night_out_only,0) <> 1
          AND ap.date BETWEEN ? AND ?
        GROUP BY 1,2,3,4,5`
    )
    .all(...pop.params, start, end);

  // 2 — per-employee month aggregates, for the exception lists.
  const wt = CFG.statusWeightSql(STATUS_EXPR);
  const empRows = db
    .prepare(
      `SELECT ap.employee_code AS code, e.name, e.date_of_joining AS doj,
              e.date_of_exit AS doe,
              UPPER(TRIM(COALESCE(e.department,''))) AS dept,
              SUM(CASE WHEN ${wt} > 0 THEN 1 ELSE 0 END) AS heads,
              SUM(CASE WHEN ${wt} > 0 AND ${PRE_DOJ_EXPR} = 1 THEN 1 ELSE 0 END) AS pre_doj_days,
              SUM(CASE WHEN ${wt} > 0 AND e.date_of_exit IS NOT NULL
                        AND TRIM(e.date_of_exit) <> '' AND ap.date > e.date_of_exit
                       THEN 1 ELSE 0 END) AS after_exit_days,
              SUM(CASE WHEN ${PRE_DOJ_EXPR} = 0 THEN ${wt} ELSE 0 END) AS man_days
         FROM attendance_processed ap
         JOIN employees e ON e.code = ap.employee_code
        WHERE ${pop.sql}
          AND COALESCE(ap.is_night_out_only,0) <> 1
          AND ap.date BETWEEN ? AND ?
        GROUP BY ap.employee_code`
    )
    .all(...pop.params, start, end);

  // 3 — payroll days for the tie-out.
  const dcRows = db
    .prepare(
      `SELECT employee_code AS code, SUM(total_payable_days) AS payroll_days
         FROM day_calculations WHERE month = ? AND year = ? GROUP BY employee_code`
    )
    .all(month, year);
  const payrollByCode = new Map(dcRows.map((r) => [r.code, Number(r.payroll_days)]));

  // 4 — company mix, for the yellow banner.
  const coRows = db
    .prepare(
      `SELECT TRIM(COALESCE(e.company,'')) AS company,
              SUM(CASE WHEN ${PRE_DOJ_EXPR} = 0 THEN ${wt} ELSE 0 END) AS man_days
         FROM attendance_processed ap
         JOIN employees e ON e.code = ap.employee_code
        WHERE ${pop.sql}
          AND COALESCE(ap.is_night_out_only,0) <> 1
          AND ap.date BETWEEN ? AND ?
        GROUP BY 1`
    )
    .all(...pop.params, start, end);

  // 5 — daily wage.
  const dwEntries = loadDwEntries(db, start, end);

  // ── fold into cells ──
  const cells = {};
  for (const d of days) cells[d.date] = {};
  const cellFor = (date, contractor) => {
    if (!cells[date]) cells[date] = {};
    if (!cells[date][contractor]) cells[date][contractor] = emptyCell();
    return cells[date][contractor];
  };
  const contractorSet = new Set();
  const unmappedNames = new Set();

  for (const row of bioRows) {
    const weight = CFG.statusWeight(row.status);
    if (weight <= 0) continue;
    const resolved = CFG.resolveBiometricContractor(row.dept);
    if (resolved.unmapped) unmappedNames.add(resolved.name);
    const cell = cellFor(row.date, resolved.name);
    contractorSet.add(resolved.name);
    const n = Number(row.n) || 0;
    const isNight = Number(row.night) === 1;
    cell.bio += n;
    if (isNight) cell.bioNight += n; else cell.bioDay += n;
    if (Number(row.pre_doj) !== 1) {
      const md = weight * n;
      cell.manDays += md;
      if (isNight) cell.manDaysNight += md; else cell.manDaysDay += md;
    }
  }

  for (const entry of dwEntries) {
    if (entry.isTest) continue; // surfaced only under "Test entries to void"
    const cell = cellFor(entry.date, entry.contractor);
    contractorSet.add(entry.contractor);
    if (entry.unmapped) unmappedNames.add(entry.contractor);
    if (entry.counted) {
      cell.dwHeads += entry.heads;
      cell.dwCost = r2(cell.dwCost + entry.amount);
      cell.dwRecords += 1;
      addDeptBreakdown(cell, entry);
    } else {
      cell.dwPending += entry.heads;
    }
  }

  // ── totals ──
  const perContractor = {};
  for (const c of contractorSet) {
    perContractor[c] = {
      bio: 0, bioDay: 0, bioNight: 0,
      manDays: 0, manDaysDay: 0, manDaysNight: 0,
      dwHeads: 0, dwCost: 0,
    };
  }
  for (const d of days) {
    for (const [c, cell] of Object.entries(cells[d.date] || {})) {
      roundCell(cell);
      const t = perContractor[c];
      t.bio += cell.bio; t.bioDay += cell.bioDay; t.bioNight += cell.bioNight;
      t.manDays += cell.manDays; t.manDaysDay += cell.manDaysDay;
      t.manDaysNight += cell.manDaysNight;
      t.dwHeads += cell.dwHeads; t.dwCost = r2(t.dwCost + cell.dwCost);
      cell.deptBreakdown.sort((a, b) => b.heads - a.heads || a.dept.localeCompare(b.dept));
    }
  }
  for (const t of Object.values(perContractor)) {
    t.manDays = r2(t.manDays);
    t.manDaysDay = r2(t.manDaysDay);
    t.manDaysNight = r2(t.manDaysNight);
  }

  const contractors = [...contractorSet].sort(
    (a, b) =>
      perContractor[b].manDays + perContractor[b].dwHeads -
        (perContractor[a].manDays + perContractor[a].dwHeads) || a.localeCompare(b)
  );

  const stats = {
    manDays: 0, manDaysDay: 0, manDaysNight: 0,
    dwHeads: 0, dwCost: 0, bothSourceDays: 0,
  };
  for (const t of Object.values(perContractor)) {
    stats.manDays += t.manDays; stats.manDaysDay += t.manDaysDay;
    stats.manDaysNight += t.manDaysNight;
    stats.dwHeads += t.dwHeads; stats.dwCost = r2(stats.dwCost + t.dwCost);
  }
  stats.manDays = r2(stats.manDays);
  stats.manDaysDay = r2(stats.manDaysDay);
  stats.manDaysNight = r2(stats.manDaysNight);

  const exceptions = buildExceptions({
    days, cells, dwEntries, empRows, payrollByCode,
  });
  stats.bothSourceDays = exceptions.both.length;

  const totalMd = coRows.reduce((s, r) => s + (Number(r.man_days) || 0), 0);
  const unknownMd = coRows
    .filter((r) => !CFG.isValidCompany(r.company))
    .reduce((s, r) => s + (Number(r.man_days) || 0), 0);

  return {
    month, year, company: company || null,
    days, contractors, cells,
    totals: { perContractor, stats },
    unknownCompanyManDays: r2(unknownMd),
    unknownCompanyRatio: totalMd > 0 ? r2(unknownMd / totalMd) : 0,
    unmappedContractors: [...unmappedNames].sort(),
    exceptions,
  };
}

// ─── exceptions ───────────────────────────────────────────────────────────
function buildExceptions({ days, cells, dwEntries, empRows, payrollByCode }) {
  const both = [];
  const dup = [];

  // Both-source: a contractor with biometric heads AND daily-wage heads on the
  // same day. A combined daily-wage record (e.g. "Sajan + Jiwan Lal (12-h)")
  // has no biometric workers of its own, so it is compared against the sum of
  // its component contractors' biometric heads.
  for (const d of days) {
    const dayCells = cells[d.date] || {};
    for (const [contractor, cell] of Object.entries(dayCells)) {
      if (cell.dwHeads <= 0) continue;
      const parts = CFG.componentContractors(contractor);
      let bio = 0, bioDay = 0, bioNight = 0;
      for (const p of parts) {
        const pc = dayCells[p];
        if (!pc) continue;
        bio += pc.bio; bioDay += pc.bioDay; bioNight += pc.bioNight;
      }
      if (bio <= 0) continue;
      both.push({
        date: d.date, contractor,
        comparedAgainst: parts.length > 1 ? parts : undefined,
        bio, bioDay, bioNight,
        dwHeads: cell.dwHeads, dwCost: cell.dwCost,
        maxDoublePay: r2(Math.min(bio, cell.dwHeads) * (cell.dwCost / cell.dwHeads)),
      });
    }
  }

  // Two or more distinct daily-wage contractor records for one display-name
  // contractor on one day (e.g. PAPPU and PAPPU CONT on 4 Apr).
  const byDayContractor = new Map();
  for (const e of dwEntries) {
    if (e.isTest || !e.counted) continue;
    const key = `${e.date}|${e.contractor}`;
    if (!byDayContractor.has(key)) byDayContractor.set(key, []);
    byDayContractor.get(key).push(e);
  }
  for (const [key, list] of byDayContractor) {
    const distinct = new Set(list.map((e) => e.contractorId));
    if (distinct.size < 2) continue;
    const [date, contractor] = key.split('|');
    dup.push({
      date, contractor,
      records: list.map((e) => ({
        rawName: e.rawName, heads: e.heads, rate: e.rate, amount: e.amount,
      })),
    });
  }

  const pre = [], aft = [], nodoj = [], tie = [];
  for (const r of empRows) {
    if (!Number(r.heads)) continue;
    const contractor = CFG.resolveBiometricContractor(r.dept).name;
    const base = { code: r.code, name: r.name, contractor };
    if (Number(r.pre_doj_days) > 0) {
      pre.push({ ...base, doj: r.doj, days: Number(r.pre_doj_days) });
    }
    if (Number(r.after_exit_days) > 0) {
      aft.push({ ...base, doe: r.doe, days: Number(r.after_exit_days) });
    }
    if (!r.doj || !String(r.doj).trim()) {
      nodoj.push({ ...base, days: Number(r.heads) });
    }
    const payroll = payrollByCode.get(r.code);
    const manDays = r2(r.man_days);
    if (payroll != null && Math.abs(payroll - manDays) > 0.01) {
      tie.push({ ...base, manDays, payrollDays: r2(payroll) });
    }
  }

  const pend = dwEntries
    .filter((e) => !e.isTest && !e.counted)
    .map((e) => ({
      date: e.date, rawName: e.rawName, contractor: e.contractor,
      heads: e.heads, status: e.status,
    }));

  const test = dwEntries
    .filter((e) => e.isTest)
    .map((e) => ({
      date: e.date, rawName: e.rawName, heads: e.heads,
      amount: e.amount, status: e.status,
    }));

  const bySorter = (a, b) => String(a.date).localeCompare(String(b.date));
  both.sort(bySorter); dup.sort(bySorter); pend.sort(bySorter); test.sort(bySorter);
  const byDays = (a, b) => b.days - a.days || String(a.code).localeCompare(String(b.code));
  pre.sort(byDays); aft.sort(byDays); nodoj.sort(byDays);
  tie.sort((a, b) => String(a.code).localeCompare(String(b.code)));

  return {
    both, dup, pre, tie, aft, nodoj, pend, test,
    count: both.length + dup.length + pre.length + tie.length +
           aft.length + nodoj.length + pend.length + test.length,
    maxDoublePayTotal: r2(both.reduce((s, o) => s + o.maxDoublePay, 0)),
  };
}

// ─── day report ───────────────────────────────────────────────────────────
function dayReport(db, { date, company }) {
  const pop = populationClause('e', company);

  const rows = db
    .prepare(
      `SELECT ap.employee_code AS code, e.name, e.designation, e.date_of_joining AS doj,
              UPPER(TRIM(COALESCE(e.department,''))) AS dept,
              COALESCE(ap.is_night_shift,0) AS night,
              ${STATUS_EXPR} AS status,
              ${PRE_DOJ_EXPR} AS pre_doj
         FROM attendance_processed ap
         JOIN employees e ON e.code = ap.employee_code
        WHERE ${pop.sql}
          AND COALESCE(ap.is_night_out_only,0) <> 1
          AND ap.date = ?
        ORDER BY e.name`
    )
    .all(...pop.params, date);

  const dwEntries = loadDwEntries(db, date, date).filter((e) => !e.isTest);

  const byContractor = new Map();
  const get = (name, unmapped) => {
    if (!byContractor.has(name)) {
      byContractor.set(name, {
        name, unmapped: !!unmapped,
        bioDay: 0, bioNight: 0, bio: 0,
        dwHeads: 0, dwCost: 0, dwRecords: 0, dwPending: 0,
        employees: [], dwEntries: [],
      });
    }
    return byContractor.get(name);
  };

  for (const row of rows) {
    if (CFG.statusWeight(row.status) <= 0) continue;
    const resolved = CFG.resolveBiometricContractor(row.dept);
    const c = get(resolved.name, resolved.unmapped);
    const isNight = Number(row.night) === 1;
    c.bio += 1;
    if (isNight) c.bioNight += 1; else c.bioDay += 1;
    c.employees.push({
      code: row.code, name: row.name,
      role: CFG.normalizeRole(row.designation),
      night: isNight, status: row.status,
      doj: row.doj || null,
      preJoining: Number(row.pre_doj) === 1,
      noDoj: !row.doj || !String(row.doj).trim(),
    });
  }

  for (const e of dwEntries) {
    const c = get(e.contractor, e.unmapped);
    if (e.counted) {
      c.dwHeads += e.heads;
      c.dwCost = r2(c.dwCost + e.amount);
      c.dwRecords += 1;
    } else {
      c.dwPending += e.heads;
    }
    c.dwEntries.push({
      id: e.id, rawName: e.rawName, heads: e.heads, rate: e.rate,
      amount: e.amount, status: e.status, counted: e.counted,
      gateRef: e.gateRef,
      allocations: e.allocations.map((a) => ({
        dept: a.dept, typed: a.typed, heads: a.heads, cost: a.cost,
      })),
    });
  }

  const contractors = [...byContractor.values()];
  for (const c of contractors) {
    c.employees.sort(
      (a, b) =>
        CFG.roleRank(a.role) - CFG.roleRank(b.role) ||
        a.role.localeCompare(b.role) ||
        Number(a.night) - Number(b.night) ||
        String(a.name).localeCompare(String(b.name))
    );
  }
  contractors.sort((a, b) => b.bio + b.dwHeads - (a.bio + a.dwHeads) || a.name.localeCompare(b.name));

  return { date, company: company || null, contractors };
}

// ─── grid report ──────────────────────────────────────────────────────────
function gridReport(db, { month, year, contractor, company }) {
  const { start, end } = monthBounds(month, year);
  const days = listDays(month, year);
  const pop = populationClause('e', company);

  // Only this contractor's departments are fetched — the alias map is resolved
  // to a department list up front so the query does not drag the whole month's
  // other gangs back just to drop them in JS.
  const depts = CFG.departmentsForContractor(contractor);
  const deptHoles = depts.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT ap.employee_code AS code, e.name, e.designation, e.company,
              e.date_of_joining AS doj, e.date_of_exit AS doe,
              UPPER(TRIM(COALESCE(e.department,''))) AS dept,
              ap.date AS date, COALESCE(ap.is_night_shift,0) AS night,
              ${STATUS_EXPR} AS status, ${PRE_DOJ_EXPR} AS pre_doj
         FROM attendance_processed ap
         JOIN employees e ON e.code = ap.employee_code
        WHERE ${pop.sql}
          AND UPPER(TRIM(COALESCE(e.department,''))) IN (${deptHoles})
          AND COALESCE(ap.is_night_out_only,0) <> 1
          AND ap.date BETWEEN ? AND ?
        ORDER BY ap.employee_code, ap.date`
    )
    .all(...pop.params, ...depts, start, end);

  const dcRows = db
    .prepare(
      `SELECT employee_code AS code, SUM(total_payable_days) AS payroll_days
         FROM day_calculations WHERE month = ? AND year = ? GROUP BY employee_code`
    )
    .all(month, year);
  const payrollByCode = new Map(dcRows.map((r) => [r.code, Number(r.payroll_days)]));

  const byCode = new Map();
  for (const row of rows) {
    let emp = byCode.get(row.code);
    if (!emp) {
      emp = {
        code: row.code, name: row.name,
        role: CFG.normalizeRole(row.designation),
        company: row.company || null,
        doj: row.doj || null, doe: row.doe || null,
        cells: {},
        stats: {
          dayShifts: 0, nightShifts: 0, halfDays: 0, wop: 0, absent: 0,
          weeklyOff: 0, preJoining: 0, manDays: 0,
          payrollDays: null, tie: null, firstPunch: null, lastPunch: null,
        },
      };
      byCode.set(row.code, emp);
    }
    const weight = CFG.statusWeight(row.status);
    const isNight = Number(row.night) === 1;
    const preJoining = Number(row.pre_doj) === 1;
    emp.cells[row.date] = { status: row.status, night: isNight, preJoining };

    const s = emp.stats;
    if (weight > 0) {
      if (isNight) s.nightShifts += 1; else s.dayShifts += 1;
      if (weight === 0.5) s.halfDays += 1;
      if (row.status === 'WOP' || row.status === 'WO½P') s.wop += 1;
      if (preJoining) s.preJoining += 1; else s.manDays += weight;
      if (!s.firstPunch) s.firstPunch = row.date;
      s.lastPunch = row.date;
    } else if (row.status === 'A') {
      s.absent += 1;
    } else if (row.status === 'WO') {
      s.weeklyOff += 1;
    }
  }

  const employees = [...byCode.values()];
  for (const emp of employees) {
    emp.stats.manDays = r2(emp.stats.manDays);
    const payroll = payrollByCode.get(emp.code);
    if (payroll != null) {
      emp.stats.payrollDays = r2(payroll);
      emp.stats.tie = Math.abs(payroll - emp.stats.manDays) < 0.01;
    }
  }
  employees.sort(
    (a, b) =>
      CFG.roleRank(a.role) - CFG.roleRank(b.role) ||
      a.role.localeCompare(b.role) ||
      String(a.name).localeCompare(String(b.name))
  );

  // Footer: the whole gang's day, including daily wage (which drives the red
  // "both sources" highlight under a column).
  const dwEntries = loadDwEntries(db, start, end).filter((e) => !e.isTest && e.counted);
  const footer = {};
  for (const d of days) footer[d.date] = { bioDay: 0, bioNight: 0, dwHeads: 0, bothSource: false };
  for (const emp of employees) {
    for (const [date, cell] of Object.entries(emp.cells)) {
      if (CFG.statusWeight(cell.status) <= 0 || !footer[date]) continue;
      if (cell.night) footer[date].bioNight += 1; else footer[date].bioDay += 1;
    }
  }
  for (const e of dwEntries) {
    if (e.contractor !== contractor) continue;
    if (footer[e.date]) footer[e.date].dwHeads += e.heads;
  }
  // A combined record credits its components' columns too.
  for (const e of dwEntries) {
    if (e.contractor === contractor) continue;
    if (!CFG.componentContractors(e.contractor).includes(contractor)) continue;
    if (footer[e.date]) footer[e.date].dwHeads += e.heads;
  }
  for (const d of days) {
    const f = footer[d.date];
    f.bothSource = f.dwHeads > 0 && f.bioDay + f.bioNight > 0;
  }

  return { month, year, contractor, company: company || null, days, employees, footer };
}

/**
 * The contractor display names that actually appear in a month, from two small
 * DISTINCT queries. Used to validate the grid's ?contractor= without paying for
 * a whole monthReport just to reject a typo.
 */
function contractorNamesForMonth(db, { month, year, company }) {
  const { start, end } = monthBounds(month, year);
  const pop = populationClause('e', company);
  const bio = db
    .prepare(
      `SELECT DISTINCT UPPER(TRIM(COALESCE(e.department,''))) AS dept
         FROM attendance_processed ap
         JOIN employees e ON e.code = ap.employee_code
        WHERE ${pop.sql}
          AND COALESCE(ap.is_night_out_only,0) <> 1
          AND ap.date BETWEEN ? AND ?`
    )
    .all(...pop.params, start, end);
  const dw = db
    .prepare(
      `SELECT DISTINCT c.contractor_name AS name
         FROM dw_entries e JOIN dw_contractors c ON c.id = e.contractor_id
        WHERE e.entry_date BETWEEN ? AND ?`
    )
    .all(start, end);
  const names = new Set();
  for (const r of bio) names.add(CFG.resolveBiometricContractor(r.dept).name);
  for (const r of dw) {
    if (CFG.isTestContractorName(r.name)) continue;
    names.add(CFG.resolveDwContractor(r.name).name);
  }
  return [...names];
}

module.exports = {
  monthReport, dayReport, gridReport, contractorNamesForMonth, listDays, monthBounds,
};
