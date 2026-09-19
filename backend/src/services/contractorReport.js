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

// Payroll's own status rule, imported rather than mirrored. Stage 6 ignores an
// HR miss-punch resolution until finance approves it, so status_final (what
// this report shows everywhere else) and what payroll actually pays disagree on
// exactly the rows where a correction is still awaiting finance. It is exported
// and pure — a plain row in, a status string out, no database handle, no I/O —
// so importing keeps the two in lockstep for ever. dayCalculation.js is on the
// DO-NOT-MODIFY list and is not touched; this is a read-only require.
// See docs/progress/contractor-report-2-1.md RULING 2.
const { effectiveStatusForDay } = require('./dayCalculation');

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

/**
 * The status this report shows for a row: status_final, falling back to
 * status_original. Mirrors STATUS_EXPR so the JS and SQL views agree.
 */
function reportStatusOf(row) {
  return row.status_final || row.status_original || '';
}

/**
 * Rows where payroll's view of the day differs from the report's view — i.e.
 * an HR miss-punch correction finance has not ruled on. Only divergent rows are
 * returned: a resolution that lands on the same status cannot move a man-day,
 * and listing it would pad the exception with rows nobody can act on.
 *
 * `delta` is the man-day correction to add to the report's figure to reach
 * payroll's. Pre-joining days carry delta 0 because the report already excludes
 * them from man-days, exactly as payroll does.
 */
function correctionDivergences(rows) {
  const out = [];
  for (const r of rows) {
    const reportStatus = reportStatusOf(r);
    const payrollStatus = effectiveStatusForDay(r);
    if (payrollStatus === reportStatus) continue;
    const preJoining = Number(r.pre_doj) === 1;
    out.push({
      code: r.code,
      name: r.name,
      date: r.date,
      dept: r.dept,
      punchedAs: r.status_original || '',
      hrMarkedAs: reportStatus,
      payrollStatus,
      correctionSource: r.correction_source || '',
      // '' and NULL both mean "finance has not ruled yet" to
      // effectiveStatusForDay, so both surface as 'pending' rather than blank.
      financeStatus: r.miss_punch_finance_status || 'pending',
      preJoining,
      delta: preJoining
        ? 0
        : r2(CFG.statusWeight(payrollStatus) - CFG.statusWeight(reportStatus)),
    });
  }
  return out;
}

/**
 * SELECT for the rows above. Narrowed to miss punches whose finance state can
 * still make payroll disagree with status_final — everything except 'approved',
 * where effectiveStatusForDay returns status_final by definition. A REJECTED
 * row stays in: it is forced to ½P and can differ just as loudly.
 */
function loadCorrections(db, pop, start, end) {
  const holes = CFG.FINANCE_STATES_MATCHING_REPORT.map(() => '?').join(',');
  return db
    .prepare(
      `SELECT ap.employee_code AS code, e.name AS name, ap.date AS date,
              UPPER(TRIM(COALESCE(e.department,''))) AS dept,
              COALESCE(ap.is_miss_punch,0) AS is_miss_punch,
              TRIM(COALESCE(ap.status_original,'')) AS status_original,
              NULLIF(TRIM(COALESCE(ap.status_final,'')),'') AS status_final,
              COALESCE(ap.miss_punch_finance_status,'') AS miss_punch_finance_status,
              COALESCE(ap.correction_source,'') AS correction_source,
              ${PRE_DOJ_EXPR} AS pre_doj
         FROM attendance_processed ap
         JOIN employees e ON e.code = ap.employee_code
        WHERE ${pop.sql}
          AND COALESCE(ap.is_miss_punch,0) = 1
          AND COALESCE(ap.miss_punch_finance_status,'') NOT IN (${holes})
          AND COALESCE(ap.is_night_out_only,0) <> 1
          AND ap.date BETWEEN ? AND ?
        ORDER BY ap.employee_code, ap.date`
    )
    .all(...pop.params, ...CFG.FINANCE_STATES_MATCHING_REPORT, start, end);
}

/**
 * Everyone on the roster payroll still treats as employed, with the date they
 * were last actually present. A LEFT JOIN rather than a correlated subquery so
 * this stays one query for ~320 people; `never punched` comes back as a NULL
 * last_punch rather than a missing row, which is the case that matters most.
 *
 * Active only, by design: a worker already marked Left is not a stale roster
 * row, they are a closed one. Not month-scoped — see STALE_NO_PUNCH_DAYS.
 */
function loadStaleRoster(db, pop, today) {
  const holes = CFG.PRESENT_STATUSES.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT e.code AS code, e.name AS name,
              UPPER(TRIM(COALESCE(e.department,''))) AS dept,
              e.date_of_joining AS doj,
              MAX(ap.date) AS last_punch
         FROM employees e
         LEFT JOIN attendance_processed ap
                ON ap.employee_code = e.code
               AND COALESCE(ap.is_night_out_only,0) <> 1
               AND ${STATUS_EXPR} IN (${holes})
        WHERE ${pop.sql}
          AND TRIM(COALESCE(e.status,'')) = 'Active'
        GROUP BY e.code`
    )
    .all(...CFG.PRESENT_STATUSES, ...pop.params);

  const out = [];
  for (const r of rows) {
    const lastPunch = r.last_punch || null;
    // Never punched is always stale, whatever the arithmetic would say.
    const daysSince = lastPunch === null ? null : daysBetween(lastPunch, today);
    if (lastPunch !== null && !(daysSince > CFG.STALE_NO_PUNCH_DAYS)) continue;
    out.push({
      code: r.code,
      name: r.name,
      contractor: CFG.resolveBiometricContractor(r.dept).name,
      doj: r.doj || null,
      lastPunch,
      daysSince,
    });
  }
  // Longest silent first; never-punched sort above everyone, then by code so
  // the order is stable between runs.
  out.sort(
    (a, b) =>
      (b.daysSince === null ? Infinity : b.daysSince) -
        (a.daysSince === null ? Infinity : a.daysSince) ||
      String(a.code).localeCompare(String(b.code))
  );
  return out;
}

/** Today as YYYY-MM-DD, from the database so it matches every other date. */
function dbToday(db) {
  return db.prepare(`SELECT date('now') AS today`).get().today;
}

/** Whole days between two YYYY-MM-DD dates. */
function daysBetween(fromDate, toDate) {
  const a = Date.parse(`${fromDate}T00:00:00Z`);
  const b = Date.parse(`${toDate}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86400000);
}

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
        rejected: row.status === 'rejected',
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
function monthReport(db, { month, year, company, today }) {
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
  //
  //     Deliberately NOT filtered by company, and deliberately summed per
  //     employee. day_calculations.company disagrees with employees.company on
  //     325 of the 512 contract rows in April–May 2026, so filtering by the
  //     selected company would drop most employees' payroll row and turn the
  //     tie-out into a wall of false mismatches. Summing is right when an
  //     employee genuinely has one row per company: their biometric man-days
  //     (unfiltered) span both companies too. Verified: no contract employee
  //     currently has more than one row for a month.
  const dcRows = db
    .prepare(
      `SELECT employee_code AS code, SUM(total_payable_days) AS payroll_days
         FROM day_calculations WHERE month = ? AND year = ? GROUP BY employee_code`
    )
    .all(month, year);
  const payrollByCode = new Map(dcRows.map((r) => [r.code, Number(r.payroll_days)]));

  // 4 — company mix for the yellow banner. This one deliberately runs WITHOUT
  //     the company filter: the banner's job is to say how much of the month
  //     sits on workers with no valid company, and filtering to a company first
  //     would make that share structurally zero and silence the banner at the
  //     exact moment it matters (selecting a company drops every blank /
  //     'null' / 'Default' worker from the figures above it).
  const popAll = populationClause('e', null);
  const coRows = db
    .prepare(
      `SELECT TRIM(COALESCE(e.company,'')) AS company,
              SUM(CASE WHEN ${PRE_DOJ_EXPR} = 0 THEN ${wt} ELSE 0 END) AS man_days
         FROM attendance_processed ap
         JOIN employees e ON e.code = ap.employee_code
        WHERE ${popAll.sql}
          AND COALESCE(ap.is_night_out_only,0) <> 1
          AND ap.date BETWEEN ? AND ?
        GROUP BY 1`
    )
    .all(...popAll.params, start, end);

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

  for (const row of bioRows) {
    const weight = CFG.statusWeight(row.status);
    if (weight <= 0) continue;
    const resolved = CFG.resolveBiometricContractor(row.dept);
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
    if (entry.counted) {
      cell.dwHeads += entry.heads;
      cell.dwCost = r2(cell.dwCost + entry.amount);
      cell.dwRecords += 1;
      addDeptBreakdown(cell, entry);
    } else if (!entry.rejected) {
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

  // 5 — miss-punch corrections finance has not ruled on (2.1). These are the
  //     only rows where payroll's status rule and status_final disagree, so
  //     they are the whole explanation for the tie-out gaps this report used to
  //     report as unexplained mismatches.
  const corrections = correctionDivergences(loadCorrections(db, pop, start, end));

  // 6 — roster staleness (2.1). Deliberately NOT month-scoped: the question is
  //     "who does payroll still think works here", which does not change
  //     because you paged back to April. `today` is injectable for tests only;
  //     every caller in the app leaves it unset and gets the database's date.
  const staleRows = loadStaleRoster(db, pop, today || dbToday(db));

  const exceptions = buildExceptions({
    days, cells, dwEntries, empRows, payrollByCode, corrections, staleRows,
  });
  stats.bothSourceDays = exceptions.both.length;

  const totalMd = coRows.reduce((s, r) => s + (Number(r.man_days) || 0), 0);
  const unknownMd = coRows
    .filter((r) => !CFG.isValidCompany(r.company))
    .reduce((s, r) => s + (Number(r.man_days) || 0), 0);

  // 7 — the gangs the GRID may be opened on (2.1). `contractors` above is
  //     "who appears in this month's data" and drives the header filter, the
  //     per-contractor totals and every exception list — it is left exactly as
  //     it was. But a gang where nobody punched all month appears in neither
  //     biometric nor daily wage, so it could not be selected at all, which is
  //     precisely the gang the worked/no-punch split exists to show. This adds
  //     anyone with an Active roster on top, for the grid picker only.
  const rosterDepts = db
    .prepare(
      `SELECT DISTINCT UPPER(TRIM(COALESCE(e.department,''))) AS dept
         FROM employees e
        WHERE ${pop.sql} AND TRIM(COALESCE(e.status,'')) = 'Active'`
    )
    .all(...pop.params);
  const gridContractors = [
    ...new Set([
      ...contractors,
      ...rosterDepts.map((r) => CFG.resolveBiometricContractor(r.dept).name),
    ]),
  ].sort();

  return {
    month, year, company: company || null,
    days, contractors, gridContractors, cells,
    totals: { perContractor, stats },
    // 4dp, not 2 — this drives a percentage, and rounding the ratio to 2dp
    // would quantise the banner to whole steps of 1%.
    unknownCompanyRatio: totalMd > 0 ? Math.round((unknownMd / totalMd) * 1e4) / 1e4 : 0,
    exceptions,
  };
}

// ─── exceptions ───────────────────────────────────────────────────────────
function buildExceptions({
  days, cells, dwEntries, empRows, payrollByCode, corrections = [], staleRows = [],
}) {
  // Man-day correction per employee to get from the report's status_final view
  // to payroll's. Summed because one person can have several pending days.
  const deltaByCode = new Map();
  for (const c of corrections) {
    if (!c.delta) continue;
    deltaByCode.set(c.code, r2((deltaByCode.get(c.code) || 0) + c.delta));
  }
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
  // Grouped with the date and contractor carried on the value. A contractor
  // display name can be raw free text typed at the gate and may contain the
  // separator, so the key must never be parsed back apart.
  const byDayContractor = new Map();
  for (const e of dwEntries) {
    if (e.isTest || !e.counted) continue;
    const key = `${e.date}\u0000${e.contractor}`;
    if (!byDayContractor.has(key)) {
      byDayContractor.set(key, { date: e.date, contractor: e.contractor, list: [] });
    }
    byDayContractor.get(key).list.push(e);
  }
  for (const { date, contractor, list } of byDayContractor.values()) {
    const distinct = new Set(list.map((e) => e.contractorId));
    if (distinct.size < 2) continue;
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
    // Tie-out against payroll's OWN view of the days, not the report's.
    // Comparing status_final to payroll reported every correction still
    // awaiting finance as a mismatch — 10 of them in September 2026, all false.
    // What is left after applying payroll's rule is genuinely unexplained.
    const payroll = payrollByCode.get(r.code);
    const manDays = r2(r.man_days);
    const payrollView = r2(manDays + (deltaByCode.get(r.code) || 0));
    if (payroll != null && Math.abs(payroll - payrollView) > 0.01) {
      tie.push({ ...base, manDays, payrollView, payrollDays: r2(payroll) });
    }
  }

  // "Not counted" splits two ways. Rejected entries are a terminal decision
  // finance already made — listing them as "not approved" would keep the
  // Exceptions badge permanently non-zero with nothing anyone can act on.
  const dwNotCounted = dwEntries.filter((e) => !e.isTest && !e.counted);
  const toRow = (e) => ({
    date: e.date, rawName: e.rawName, contractor: e.contractor,
    heads: e.heads, status: e.status,
  });
  const pend = dwNotCounted.filter((e) => !e.rejected).map(toRow);
  const rejected = dwNotCounted.filter((e) => e.rejected).map(toRow);

  const test = dwEntries
    .filter((e) => e.isTest)
    .map((e) => ({
      date: e.date, rawName: e.rawName, heads: e.heads,
      amount: e.amount, status: e.status,
    }));

  const bySorter = (a, b) => String(a.date).localeCompare(String(b.date));
  both.sort(bySorter); dup.sort(bySorter); pend.sort(bySorter);
  rejected.sort(bySorter); test.sort(bySorter);
  const byDays = (a, b) => b.days - a.days || String(a.code).localeCompare(String(b.code));
  pre.sort(byDays); aft.sort(byDays); nodoj.sort(byDays);
  tie.sort((a, b) => String(a.code).localeCompare(String(b.code)));

  // The corrections that explain the gaps the tie-out no longer reports.
  // Contractor is resolved here so the tab's per-contractor filter works on
  // this section exactly as it does on every other one.
  const financePending = corrections.map((c) => ({
    code: c.code,
    name: c.name,
    contractor: CFG.resolveBiometricContractor(c.dept).name,
    date: c.date,
    punchedAs: c.punchedAs,
    hrMarkedAs: c.hrMarkedAs,
    payrollStatus: c.payrollStatus,
    correctionSource: c.correctionSource,
    financeStatus: c.financeStatus,
  }));
  financePending.sort(
    (a, b) =>
      String(a.date).localeCompare(String(b.date)) ||
      String(a.code).localeCompare(String(b.code))
  );

  const stale = staleRows;

  return {
    both, dup, pre, tie, financePending, aft, nodoj, stale, pend, rejected, test,
    // `stale` is deliberately OUTSIDE the count, for the same reason `rejected`
    // is: the badge answers "what happened in this month", and stale roster
    // rows are measured against today, not the month. 231 month-independent
    // rows would swamp the badge and make it useless as a month signal. It is
    // still shown, with its own count on its own section header.
    count: both.length + dup.length + pre.length + tie.length +
           financePending.length + aft.length + nodoj.length +
           pend.length + test.length,
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
    } else if (!e.rejected) {
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
              TRIM(COALESCE(e.status,'')) AS emp_status,
              UPPER(TRIM(COALESCE(e.department,''))) AS dept,
              ap.date AS date, COALESCE(ap.is_night_shift,0) AS night,
              ${STATUS_EXPR} AS status, ${PRE_DOJ_EXPR} AS pre_doj,
              COALESCE(ap.is_miss_punch,0) AS is_miss_punch,
              TRIM(COALESCE(ap.status_original,'')) AS status_original,
              NULLIF(TRIM(COALESCE(ap.status_final,'')),'') AS status_final,
              COALESCE(ap.miss_punch_finance_status,'') AS miss_punch_finance_status,
              COALESCE(ap.correction_source,'') AS correction_source
         FROM attendance_processed ap
         JOIN employees e ON e.code = ap.employee_code
        WHERE ${pop.sql}
          AND UPPER(TRIM(COALESCE(e.department,''))) IN (${deptHoles})
          AND COALESCE(ap.is_night_out_only,0) <> 1
          AND ap.date BETWEEN ? AND ?
        ORDER BY ap.employee_code, ap.date`
    )
    .all(...pop.params, ...depts, start, end);

  // The gang's whole roster (2.1). The query above starts from
  // attendance_processed, so anyone with no attendance row at all this month —
  // a gang that did not work a single day, most obviously — was invisible.
  // Active only on this side: a worker already marked Left with no punch is a
  // closed row, not an idle one, and listing them would bury the live ones.
  const rosterRows = db
    .prepare(
      `SELECT e.code AS code, e.name, e.designation, e.company,
              e.date_of_joining AS doj, e.date_of_exit AS doe,
              TRIM(COALESCE(e.status,'')) AS emp_status
         FROM employees e
        WHERE ${pop.sql}
          AND UPPER(TRIM(COALESCE(e.department,''))) IN (${deptHoles})
          AND TRIM(COALESCE(e.status,'')) = 'Active'`
    )
    .all(...pop.params, ...depts);

  const dcRows = db
    .prepare(
      `SELECT employee_code AS code, SUM(total_payable_days) AS payroll_days
         FROM day_calculations WHERE month = ? AND year = ? GROUP BY employee_code`
    )
    .all(month, year);
  const payrollByCode = new Map(dcRows.map((r) => [r.code, Number(r.payroll_days)]));

  const newEmp = (row) => ({
    code: row.code, name: row.name,
    role: CFG.normalizeRole(row.designation),
    company: row.company || null,
    doj: row.doj || null, doe: row.doe || null,
    cells: {},
    noPunch: true,
    active: row.emp_status === 'Active',
    stats: {
      dayShifts: 0, nightShifts: 0, halfDays: 0, wop: 0, absent: 0,
      weeklyOff: 0, preJoining: 0, workedDays: 0, manDays: 0,
      pendingDays: 0, payrollView: 0,
      payrollDays: null, tie: null, firstPunch: null, lastPunch: null,
    },
  });

  const byCode = new Map();
  for (const row of rows) {
    let emp = byCode.get(row.code);
    if (!emp) {
      emp = newEmp(row);
      byCode.set(row.code, emp);
    }
    const weight = CFG.statusWeight(row.status);
    const isNight = Number(row.night) === 1;
    const preJoining = Number(row.pre_doj) === 1;
    const cell = { status: row.status, night: isNight, preJoining };

    // A day payroll pays differently from what this grid shows, because an HR
    // correction is still waiting on finance. Carried on the cell so the grid
    // can outline it and the selection panel can explain it. Only attached when
    // the two views actually differ — these fields ride ~2,800 cells.
    const payrollStatus = effectiveStatusForDay(row);
    if (payrollStatus !== row.status) {
      cell.pending = true;
      cell.punchedAs = row.status_original || '';
      cell.hrMarkedAs = row.status;
      cell.payrollStatus = payrollStatus;
      cell.correctionSource = row.correction_source || '';
      cell.financeStatus = row.miss_punch_finance_status || 'pending';
    }
    emp.cells[row.date] = cell;

    const s = emp.stats;
    if (weight > 0) {
      emp.noPunch = false;
      s.workedDays += 1;
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
    if (cell.pending && !preJoining) {
      s.pendingDays = r2(
        s.pendingDays + (CFG.statusWeight(payrollStatus) - CFG.statusWeight(row.status))
      );
    }
  }

  // Roster members with no attendance row at all this month.
  for (const row of rosterRows) {
    if (!byCode.has(row.code)) byCode.set(row.code, newEmp(row));
  }

  // Someone already marked Left who did not work this month is a closed row,
  // not an idle one — listing them would bury the live ones under every worker
  // who has ever left. They are kept the moment they DO work, because their
  // man-days still have to tie out.
  const employees = [...byCode.values()].filter((e) => !e.noPunch || e.active);
  for (const emp of employees) {
    const s = emp.stats;
    s.manDays = r2(s.manDays);
    // Payroll's view of the same days — the report's man-days plus whatever the
    // corrections still awaiting finance move. The tie-out is against THIS, so
    // a day waiting on finance no longer reads as a mismatch.
    s.payrollView = r2(s.manDays + s.pendingDays);
    const payroll = payrollByCode.get(emp.code);
    if (payroll != null) {
      s.payrollDays = r2(payroll);
      s.tie = Math.abs(payroll - s.payrollView) < 0.01;
    }
  }
  // People who worked first, then the idle roster, then the gang's own order
  // within each block. The no-punch flag is the primary key so the split stays
  // put under every sort the tab offers.
  employees.sort(
    (a, b) =>
      Number(a.noPunch) - Number(b.noPunch) ||
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

  const workedCount = employees.filter((e) => !e.noPunch).length;
  return {
    month, year, contractor, company: company || null, days, employees, footer,
    workedCount,
    noPunchCount: employees.length - workedCount,
  };
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
