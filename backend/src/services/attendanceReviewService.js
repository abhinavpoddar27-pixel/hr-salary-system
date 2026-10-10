/**
 * Attendance Review engine (Analytics → "Attendance Review", PR-1).
 *
 * Monthly late-coming / early-exit review that was done by hand for September 2026
 * (docs/attendance-review/RUNBOOK.md, PLAN_PR1.md). READ-ONLY: never writes a payroll table.
 *
 * Every threshold is in DEFAULT_CONFIG (numbers only) and can be overridden by the admin config row.
 * Every employee code / department list comes ONLY from the admin config (attendance_review_config) —
 * nothing employee-specific lives in this file (the repo is public).
 *
 * Pipeline: loadPersonMonth (SQL, both months) → applyRemeasure → applyExclusions → classify → actions → notices.
 */

const DEFAULT_CONFIG = Object.freeze({
  thresholds: Object.freeze({
    late_min_minutes: 10,          // late day = is_late_arrival AND late_by_minutes >= 10 (grace 9)
    misread_minutes: 600,          // readings >= 600 min late/early are night-shift misreads → dropped
    early_min_exclusive: 15,       // early exit = early_by_minutes > 15 …
    early_max_exclusive: 600,      // … and < 600
    early_weekdays_only: true,     // Mon–Sat only
    release_day_share: 0.5,        // plant-wide release day: > 50% of day-shift workers left early
    regular_count: 8,              // regular: 8+ lates OR 8+ early exits …
    regular_min_worked: 10,        // … with 10+ worked days
    double_late: 4,                // double: 4+ lates AND 4+ early exits
    double_early: 4,
    act_workdays: 0.9,             // early-regular and double need >= 0.9 workdays lost
    improved_ratio: 0.6,           // improved = this month <= 60% of last month (fell 40%+)
    newcomer_min_prev_days: 5,     // newcomer: no last-month row or < 5 worked days → warning only
    notice_late: 4,                // late notice: 4+ counted lates
    notice_early: 3,               // early notice: 3+ early exits
    early_warning_min: 3,          // early-exit warning: 3+ exits, not on the action list
    rounding_step: 0.5,            // deduction rounded to nearest 0.5 day …
    min_deduction: 0.5,            // … minimum 0.5 day
    option_c_long_minutes: 60,     // Option C: each exit >= 60 min early = ½ day …
    option_c_short_per_half: 3,    // … every 3 shorter exits = ½ day
    default_shift_hours: 12,       // shift hours when shifts.duration_hours is missing (flagged)
    stayed_late_lookback_days: 7,  // LAG window starts this many days before last month
    shift_fit_share: 0.6,          // shift check: early exits on >= 60% of Mon–Sat worked days = habitual (likely wrong shift) …
    shift_fit_min_days: 5,         // … with at least 5 such worked days
    shift_fit_grace: 10,           // full-hours tolerance: a day counts as "full shift worked" if out − in ≥ shift length − 10 min
    shift_fit_confirm_share: 0.8,  // habitual AND short on >= 80% of those days → flagged "check master shift" (no change to the action)
  }),
  stayed_late_mode: 'either',      // 'worked' | 'calendar' | 'either' (previous worked day OR previous calendar day)
  early_exit_rule: 'warning',      // 'warning' | 'option_c'
  shift_fit: 'everyone',           // early exit not counted on a full-hours day: 'everyone' | 'habitual' (only habitual early leavers) | 'off'
  late_full_hours: true,           // late not counted on a day the person still worked the full shift length (owner ruling 10 Oct 2026)
  loading_designation_patterns: Object.freeze(['LOAD', 'LODING']),
  excluded_codes: Object.freeze([]),        // left out of every output
  excluded_departments: Object.freeze([]),  // left out of every output (e.g. piece-rate contractors)
  early_excluded_codes: Object.freeze([]),  // manual override: early exits not assessed (normally empty — the shift check handles wrong shifts)
  held_codes: Object.freeze([]),            // listed as held, no action / notice
  remeasure: Object.freeze({}),             // { code: { start, end 'HH:MM', late_grace 9, early_grace 15, left_late 'system'|'shift'|'off', left_late_minutes 20, hours_complete false, hours_grace 10 } }
});

const MODES = { worked: 0, calendar: 1, either: 2 };
const ACTIONS = ['include', 'exclude', 'warning'];
const SHIFT_FIT = ['habitual', 'everyone', 'off'];
const WORKED = "('P','WOP','½P','WO½P')";

// ── config ────────────────────────────────────────────────────────────────

function mergeConfig(stored) {
  const s = stored && typeof stored === 'object' ? stored : {};
  return {
    ...DEFAULT_CONFIG,
    ...s,
    thresholds: { ...DEFAULT_CONFIG.thresholds, ...(s.thresholds || {}) },
    loading_designation_patterns: s.loading_designation_patterns || [...DEFAULT_CONFIG.loading_designation_patterns],
    excluded_codes: (s.excluded_codes || []).map(String),
    excluded_departments: (s.excluded_departments || []).map(String),
    early_excluded_codes: (s.early_excluded_codes || []).map(String),
    held_codes: (s.held_codes || []).map(String),
    remeasure: { ...(s.remeasure || {}) },
  };
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const isCodeList = (v) => Array.isArray(v) && v.every((x) => (typeof x === 'string' || typeof x === 'number') && String(x).trim() !== '');

/** Returns a list of problems (empty = valid). Unknown keys are rejected so typos never silently do nothing. */
function validateConfig(c) {
  const errs = [];
  if (!c || typeof c !== 'object' || Array.isArray(c)) return ['config must be an object'];
  const allowed = new Set(Object.keys(DEFAULT_CONFIG));
  for (const k of Object.keys(c)) if (!allowed.has(k)) errs.push(`unknown key: ${k}`);
  if (c.thresholds !== undefined) {
    if (typeof c.thresholds !== 'object' || Array.isArray(c.thresholds)) errs.push('thresholds must be an object');
    else {
      for (const [k, v] of Object.entries(c.thresholds)) {
        if (!(k in DEFAULT_CONFIG.thresholds)) errs.push(`unknown threshold: ${k}`);
        else if (typeof DEFAULT_CONFIG.thresholds[k] === 'boolean') { if (typeof v !== 'boolean') errs.push(`${k} must be true/false`); }
        else if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) errs.push(`${k} must be a non-negative number`);
      }
    }
  }
  if (c.stayed_late_mode !== undefined && !(c.stayed_late_mode in MODES)) errs.push('stayed_late_mode must be worked | calendar | either');
  if (c.early_exit_rule !== undefined && !['warning', 'option_c'].includes(c.early_exit_rule)) errs.push('early_exit_rule must be warning | option_c');
  if (c.shift_fit !== undefined && !SHIFT_FIT.includes(c.shift_fit)) errs.push('shift_fit must be habitual | everyone | off');
  if (c.late_full_hours !== undefined && typeof c.late_full_hours !== 'boolean') errs.push('late_full_hours must be true or false');
  for (const k of ['loading_designation_patterns', 'excluded_codes', 'excluded_departments', 'early_excluded_codes', 'held_codes']) {
    if (c[k] !== undefined && !isCodeList(c[k])) errs.push(`${k} must be a list of non-empty strings`);
  }
  if (c.remeasure !== undefined) {
    if (typeof c.remeasure !== 'object' || Array.isArray(c.remeasure)) errs.push('remeasure must be an object keyed by code');
    else for (const [code, r] of Object.entries(c.remeasure)) {
      if (!r || !HHMM.test(r.start || '') || !HHMM.test(r.end || '')) errs.push(`remeasure ${code}: start and end must be HH:MM`);
      else if (toMin(r.end) <= toMin(r.start)) errs.push(`remeasure ${code}: end must be after start (day shifts only)`);
      for (const g of ['late_grace', 'early_grace', 'left_late_minutes']) if (r && r[g] !== undefined && (typeof r[g] !== 'number' || r[g] < 0)) errs.push(`remeasure ${code}: ${g} must be a non-negative number`);
      if (r && r.left_late !== undefined && !['system', 'shift', 'off'].includes(r.left_late)) errs.push(`remeasure ${code}: left_late must be system | shift | off`);
      if (r && r.hours_complete !== undefined && typeof r.hours_complete !== 'boolean') errs.push(`remeasure ${code}: hours_complete must be true or false`);
      if (r && r.hours_grace !== undefined && (typeof r.hours_grace !== 'number' || r.hours_grace < 0 || r.hours_grace > 120)) errs.push(`remeasure ${code}: hours_grace must be 0–120 minutes`);
    }
  }
  return errs;
}

function validateOverrides(list) {
  if (list === undefined || list === null) return [];
  if (!Array.isArray(list)) return ['overrides must be a list'];
  const errs = []; const seen = new Set();
  list.forEach((o, i) => {
    if (!o || typeof o !== 'object') { errs.push(`override ${i + 1}: must be an object`); return; }
    if (!o.code || !String(o.code).trim()) errs.push(`override ${i + 1}: code required`);
    if (!ACTIONS.includes(o.action)) errs.push(`override ${i + 1}: action must be include | exclude | warning`);
    if (!o.reason || String(o.reason).trim().length < 5) errs.push(`override ${i + 1}: reason of at least 5 characters required`);
    if (o.code && seen.has(String(o.code))) errs.push(`override ${i + 1}: code listed twice`);
    if (o.code) seen.add(String(o.code));
  });
  return errs;
}

function loadConfig(db, ym) {
  const row = db.prepare(`SELECT id, effective_from, config_json, updated_by, updated_at FROM attendance_review_config
    WHERE effective_from <= ? ORDER BY effective_from DESC, id DESC LIMIT 1`).get(ym);
  let stored = {};
  if (row) { try { stored = JSON.parse(row.config_json); } catch { stored = {}; } }
  return { config: mergeConfig(stored), source: row ? { id: row.id, effective_from: row.effective_from, updated_by: row.updated_by, updated_at: row.updated_at } : null };
}

// ── dates / numbers ───────────────────────────────────────────────────────

const pad = (n) => String(n).padStart(2, '0');
const ymOf = (m, y) => `${y}-${pad(m)}`;
function prevMonth(m, y) { return m === 1 ? { month: 12, year: y - 1 } : { month: m - 1, year: y }; }
function daysInMonth(m, y) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }
function addDays(iso, n) { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function toMin(t) { if (!t || typeof t !== 'string') return null; const m = /^(\d{1,2}):(\d{2})/.exec(t.trim()); return m ? Number(m[1]) * 60 + Number(m[2]) : null; }
const r2 = (x) => Math.round(x * 100) / 100;
const r1 = (x) => Math.round(x * 10) / 10;
function roundDeduction(wdl, t) {
  const step = t.rounding_step || 0.5;
  return Math.max(t.min_deduction, Math.round(wdl / step) * step);
}

// ── SQL ───────────────────────────────────────────────────────────────────

/**
 * Person-month aggregate for this month and last, one row per (code, ym).
 * Named params: @from @to @cur @prev @rel @prel @lateMin @mis @eMin @eMax @sunOff @mode @defH @longMin @fitGrace @lateFull
 * A late is excused when the person stayed late the previous evening (exc) OR, with @lateFull, worked the full shift that day.
 * Shift-check columns: ms_days (Mon–Sat worked days when @sunOff), early_short* (exits on days out − in < shift length − @fitGrace).
 * Exported so the acceptance check can run the exact same SQL through the SQL Console.
 */
const PERSON_MONTH_SQL = `
WITH base AS (
  SELECT a.employee_code c, a.date d, a.status_final st, COALESCE(a.is_miss_punch,0) mp,
         COALESCE(a.is_late_arrival,0) la, COALESCE(a.late_by_minutes,0) lm,
         COALESCE(a.is_early_departure,0) ed, COALESCE(a.early_by_minutes,0) em,
         COALESCE(a.is_left_late,0) ll, a.shift_detected sd, a.in_time_final it, a.out_time_final ot
  FROM attendance_processed a WHERE a.date BETWEEN @from AND @to),
pl AS (SELECT c, d, MAX(ll) ll FROM base GROUP BY c, d),
w AS (SELECT b.*, LAG(b.ll) OVER (PARTITION BY b.c ORDER BY b.d) pll FROM base b
      WHERE b.st IN ${WORKED} AND b.mp = 0),
x AS (SELECT w.*, COALESCE(p.ll,0) cll, substr(w.d,1,7) ym,
             CASE WHEN w.st IN ('½P','WO½P') THEN 0.5 ELSE 1.0 END f,
             COALESCE((SELECT s.duration_hours FROM shifts s WHERE s.name = w.sd AND s.duration_hours > 0 ORDER BY s.id LIMIT 1), @defH) h,
             CASE WHEN (SELECT s.duration_hours FROM shifts s WHERE s.name = w.sd AND s.duration_hours > 0 LIMIT 1) IS NULL THEN 1 ELSE 0 END hmiss,
             strftime('%w', w.d) dow,
             CASE WHEN w.it IS NULL OR w.ot IS NULL OR length(w.it) < 5 OR length(w.ot) < 5 THEN NULL
               ELSE ((CAST(substr(w.ot,1,2) AS INTEGER)*60 + CAST(substr(w.ot,4,2) AS INTEGER))
                   - (CAST(substr(w.it,1,2) AS INTEGER)*60 + CAST(substr(w.it,4,2) AS INTEGER)) + 1440) % 1440 END wm
      FROM w LEFT JOIN pl p ON p.c = w.c AND p.d = date(w.d,'-1 day')
      WHERE substr(w.d,1,7) IN (@cur, @prev)),
y AS (SELECT x.*,
        CASE WHEN x.la = 1 AND x.lm >= @lateMin AND x.lm < @mis THEN 1 ELSE 0 END isl,
        CASE WHEN (@mode = 0 AND COALESCE(x.pll,0) = 1) OR (@mode = 1 AND x.cll = 1)
               OR (@mode = 2 AND (COALESCE(x.pll,0) = 1 OR x.cll = 1)) THEN 1 ELSE 0 END exc,
        CASE WHEN x.ed = 1 AND x.em > @eMin AND x.em < @eMax AND (@sunOff = 0 OR x.dow <> '0')
              AND x.d NOT IN (SELECT value FROM json_each(CASE WHEN x.ym = @cur THEN @rel ELSE @prel END))
             THEN 1 ELSE 0 END ise,
        CASE WHEN x.wm IS NULL OR x.wm < x.f*x.h*60 - @fitGrace THEN 1 ELSE 0 END short,
        -- full shift worked, for lates: tolerance kept below the late threshold, so a late is only forgiven when made up
        CASE WHEN x.wm IS NOT NULL AND x.wm >= x.f*x.h*60 - MIN(@fitGrace, @lateMin - 1) THEN 1 ELSE 0 END fhl
      FROM x)
SELECT c AS code, ym, COUNT(*) AS worked_days, SUM(f) AS worked_units, SUM(f*h*60) AS sched_min,
       MAX(h) AS shift_h, MAX(hmiss) AS shift_h_missing,
       SUM(isl) AS late_raw, SUM(isl*MAX(exc, @lateFull*fhl)) AS late_excused,
       SUM(isl*(1-MAX(exc, @lateFull*fhl))) AS lates,
       SUM(CASE WHEN isl = 1 AND MAX(exc, @lateFull*fhl) = 0 THEN lm ELSE 0 END) AS late_min,
       SUM(CASE WHEN isl = 1 AND exc = 0 AND @lateFull = 1 AND fhl = 1 THEN 1 ELSE 0 END) AS late_full_excused,
       SUM(ise) AS early_exits, SUM(CASE WHEN ise = 1 THEN em ELSE 0 END) AS early_min,
       SUM(CASE WHEN ise = 1 AND em >= @longMin THEN 1 ELSE 0 END) AS early_long,
       SUM(CASE WHEN @sunOff = 0 OR dow <> '0' THEN 1 ELSE 0 END) AS ms_days,
       SUM(ise*short) AS early_short, SUM(CASE WHEN ise = 1 AND short = 1 THEN em ELSE 0 END) AS early_short_min,
       SUM(CASE WHEN ise = 1 AND short = 1 AND em >= @longMin THEN 1 ELSE 0 END) AS early_short_long,
       SUM(CASE WHEN ise = 1 THEN COALESCE(wm,0) ELSE 0 END) AS early_wm_sum
FROM y GROUP BY c, ym`;

const WEEKLY_SQL = `
WITH base AS (
  SELECT a.employee_code c, a.date d, a.status_final st, COALESCE(a.is_miss_punch,0) mp,
         COALESCE(a.is_late_arrival,0) la, COALESCE(a.late_by_minutes,0) lm,
         COALESCE(a.is_early_departure,0) ed, COALESCE(a.early_by_minutes,0) em, COALESCE(a.is_left_late,0) ll,
         a.shift_detected sd, a.in_time_final it, a.out_time_final ot
  FROM attendance_processed a WHERE a.date BETWEEN @from AND @to),
pl AS (SELECT c, d, MAX(ll) ll FROM base GROUP BY c, d),
w AS (SELECT b.*, LAG(b.ll) OVER (PARTITION BY b.c ORDER BY b.d) pll FROM base b WHERE b.st IN ${WORKED} AND b.mp = 0),
x AS (SELECT w.*, COALESCE(p.ll,0) cll, substr(w.d,1,7) ym,
             CASE WHEN w.st IN ('½P','WO½P') THEN 0.5 ELSE 1.0 END f,
             COALESCE((SELECT s.duration_hours FROM shifts s WHERE s.name = w.sd AND s.duration_hours > 0 ORDER BY s.id LIMIT 1), @defH) h,
             CASE WHEN w.it IS NULL OR w.ot IS NULL OR length(w.it) < 5 OR length(w.ot) < 5 THEN NULL
               ELSE ((CAST(substr(w.ot,1,2) AS INTEGER)*60 + CAST(substr(w.ot,4,2) AS INTEGER))
                   - (CAST(substr(w.it,1,2) AS INTEGER)*60 + CAST(substr(w.it,4,2) AS INTEGER)) + 1440) % 1440 END wm
      FROM w LEFT JOIN pl p ON p.c = w.c AND p.d = date(w.d,'-1 day')
      WHERE substr(w.d,1,7) IN (@cur, @prev) AND strftime('%w', w.d) <> '0')
SELECT c AS code, ym, date(d, 'weekday 1', '-7 days') AS week_start, COUNT(*) AS worked_days,
  SUM(CASE WHEN la = 1 AND lm >= @lateMin AND lm < @mis AND NOT ((@mode = 0 AND COALESCE(pll,0) = 1) OR (@mode = 1 AND cll = 1)
       OR (@mode = 2 AND (COALESCE(pll,0) = 1 OR cll = 1)))
       AND NOT (@lateFull = 1 AND wm IS NOT NULL AND wm >= f*h*60 - MIN(@fitGrace, @lateMin - 1)) THEN 1 ELSE 0 END) AS lates,
  SUM(CASE WHEN ed = 1 AND em > @eMin AND em < @eMax
       AND d NOT IN (SELECT value FROM json_each(CASE WHEN ym = @cur THEN @rel ELSE @prel END)) THEN 1 ELSE 0 END) AS early_exits,
  SUM(CASE WHEN ed = 1 AND em > @eMin AND em < @eMax AND (wm IS NULL OR wm < f*h*60 - @fitGrace)
       AND d NOT IN (SELECT value FROM json_each(CASE WHEN ym = @cur THEN @rel ELSE @prel END)) THEN 1 ELSE 0 END) AS early_short
FROM x GROUP BY c, ym, week_start`;

const RELEASE_DAYS_SQL = `
SELECT date, COUNT(*) AS worked,
  SUM(CASE WHEN COALESCE(is_early_departure,0) = 1 AND early_by_minutes > @eMin AND early_by_minutes < @eMax THEN 1 ELSE 0 END) AS early
FROM attendance_processed
WHERE substr(date,1,7) = @cur AND status_final IN ${WORKED} AND COALESCE(is_miss_punch,0) = 0
  AND COALESCE(is_night_shift,0) = 0 AND strftime('%w', date) <> '0'
GROUP BY date HAVING early * 1.0 / worked > @share ORDER BY date`;

const SHIFT_ISSUES_SQL = `
SELECT e.code, e.department, s.name AS master_shift, a.shift_detected AS used_shift, COUNT(*) AS days,
  MIN(a.in_time_final) AS min_in, MAX(a.in_time_final) AS max_in, MIN(a.out_time_final) AS min_out, MAX(a.out_time_final) AS max_out,
  SUM(COALESCE(a.is_late_arrival,0)) AS late, SUM(COALESCE(a.is_early_departure,0)) AS early
FROM attendance_processed a JOIN employees e ON e.code = a.employee_code LEFT JOIN shifts s ON s.id = e.default_shift_id
WHERE substr(a.date,1,7) = @cur AND a.status_final IN ('P','WOP') AND COALESCE(a.is_miss_punch,0) = 0 AND COALESCE(a.is_night_shift,0) = 0
GROUP BY e.code, a.shift_detected
HAVING days >= 10 AND ((s.name IS NOT NULL AND s.name <> a.shift_detected) OR early >= 0.8 * days OR late >= 0.8 * days)
ORDER BY e.code`;

function sqlParams(month, year, cfg, releaseDays, prevReleaseDays) {
  const t = cfg.thresholds; const pm = prevMonth(month, year);
  return {
    from: addDays(`${ymOf(pm.month, pm.year)}-01`, -t.stayed_late_lookback_days),
    to: `${ymOf(month, year)}-${pad(daysInMonth(month, year))}`,
    cur: ymOf(month, year), prev: ymOf(pm.month, pm.year),
    rel: JSON.stringify(releaseDays || []), prel: JSON.stringify(prevReleaseDays || []),
    lateMin: t.late_min_minutes, mis: t.misread_minutes, eMin: t.early_min_exclusive, eMax: t.early_max_exclusive,
    sunOff: t.early_weekdays_only ? 1 : 0, mode: MODES[cfg.stayed_late_mode] ?? 2, defH: t.default_shift_hours,
    longMin: t.option_c_long_minutes, fitGrace: t.shift_fit_grace, lateFull: cfg.late_full_hours === false ? 0 : 1,
  };
}

/** Substitutes @params into SQL as literals — ONLY for the acceptance script (SQL Console takes no bind params). */
function inlineParams(sql, params) {
  return sql.replace(/@(\w+)/g, (m, k) => {
    if (!(k in params)) return m;
    const v = params[k];
    return typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`;
  });
}

// ── step 1–2: detection ───────────────────────────────────────────────────

function detectReleaseDays(db, month, year, cfg) {
  const t = cfg.thresholds;
  return db.prepare(RELEASE_DAYS_SQL).all({ cur: ymOf(month, year), eMin: t.early_min_exclusive, eMax: t.early_max_exclusive, share: t.release_day_share })
    .map((r) => ({ date: r.date, worked: r.worked, early: r.early, share: r2(r.early / r.worked) }));
}

function detectShiftIssues(db, month, year) {
  return db.prepare(SHIFT_ISSUES_SQL).all({ cur: ymOf(month, year) }).map((r) => ({ ...r, code: String(r.code) }));
}

// ── step 3: person-month ──────────────────────────────────────────────────

function loadPersonMonth(db, month, year, cfg, releaseDays, prevReleaseDays) {
  const p = sqlParams(month, year, cfg, releaseDays, prevReleaseDays);
  return db.prepare(PERSON_MONTH_SQL).all(p).map((r) => ({ ...r, code: String(r.code) }));
}

/**
 * Re-measures the configured codes on the shift given in config (both months), from the final punches.
 * Late = in > start + late_grace (minutes counted from start); early = out < end − early_grace, Mon–Sat, release days out.
 * Stayed-late exemption per code: left_late 'system' (stored flag, default), 'shift' (recomputed on this shift), 'off' (none).
 * Full-hours rule per code (hours_complete): a late or an early exit is not counted on a day where
 * out − in ≥ the shift's length (half for ½P) − hours_grace minutes (default 10). Counted in hours_excused.
 */
function remeasureRows(db, month, year, cfg, releaseDays, prevReleaseDays) {
  const codes = Object.keys(cfg.remeasure || {});
  if (!codes.length) return [];
  const t = cfg.thresholds; const p = sqlParams(month, year, cfg, releaseDays, prevReleaseDays);
  const ph = codes.map(() => '?').join(',');
  const rows = db.prepare(`SELECT employee_code c, date d, status_final st, COALESCE(is_miss_punch,0) mp, in_time_final it, out_time_final ot,
      COALESCE(is_left_late,0) ll FROM attendance_processed WHERE employee_code IN (${ph}) AND date BETWEEN ? AND ? ORDER BY employee_code, date`)
    .all(...codes, p.from, p.to);
  const rel = { [p.cur]: new Set(releaseDays || []), [p.prev]: new Set(prevReleaseDays || []) };
  // Stayed-late flag per day: 'system' = is_left_late as stored (measured on the system's shift);
  // 'shift' = recomputed on the re-measure shift (out >= end + left_late_minutes); 'off' = no exemption.
  const llOf = (r) => {
    const rm = cfg.remeasure[String(r.c)]; const mode = rm.left_late || 'system';
    if (mode === 'off') return 0;
    if (mode === 'shift') { const o = toMin(r.ot); return o !== null && o >= toMin(rm.end) + (rm.left_late_minutes ?? 20) ? 1 : 0; }
    return r.ll;
  };
  const llByDay = new Map(); for (const r of rows) llByDay.set(`${r.c}|${r.d}`, Math.max(llByDay.get(`${r.c}|${r.d}`) || 0, llOf(r)));
  const out = new Map(); let lastWorkedLl = new Map();
  for (const r of rows) {
    const worked = ['P', 'WOP', '½P', 'WO½P'].includes(r.st) && r.mp === 0;
    if (!worked) continue;
    const code = String(r.c); const rm = cfg.remeasure[code];
    const pll = lastWorkedLl.has(code) ? lastWorkedLl.get(code) : 0;
    lastWorkedLl.set(code, llOf(r));
    const ym = r.d.slice(0, 7);
    if (ym !== p.cur && ym !== p.prev) continue;
    const cll = llByDay.get(`${code}|${addDays(r.d, -1)}`) || 0;
    const exc = cfg.stayed_late_mode === 'worked' ? pll === 1 : cfg.stayed_late_mode === 'calendar' ? cll === 1 : (pll === 1 || cll === 1);
    const h = (toMin(rm.end) - toMin(rm.start)) / 60; const f = ['½P', 'WO½P'].includes(r.st) ? 0.5 : 1;
    const key = `${code}|${ym}`;
    const a = out.get(key) || { code, ym, worked_days: 0, worked_units: 0, sched_min: 0, shift_h: h, shift_h_missing: 0, late_raw: 0, late_excused: 0, lates: 0, late_min: 0, early_exits: 0, early_min: 0, early_long: 0, hours_excused: 0, remeasured: true };
    a.worked_days += 1; a.worked_units += f; a.sched_min += f * h * 60;
    const inM = toMin(r.it); const outM = toMin(r.ot);
    const wmin = inM !== null && outM !== null && outM > inM ? outM - inM : null;
    const need = f * h * 60;
    // Full-hours excuse: this row's own tick (its own tolerance), or the plant-wide rules
    // (lates: late_full_hours, tolerance kept below the late threshold; early exits: shift_fit 'everyone').
    const own = rm.hours_complete === true && wmin !== null && wmin >= need - (rm.hours_grace ?? 10);
    const fullLate = own || (cfg.late_full_hours !== false && wmin !== null && wmin >= need - Math.min(t.shift_fit_grace, t.late_min_minutes - 1));
    const fullEarly = own || (cfg.shift_fit === 'everyone' && wmin !== null && wmin >= need - t.shift_fit_grace);
    const lateBy = inM === null ? 0 : inM - toMin(rm.start);
    if (lateBy > (rm.late_grace ?? 9) && lateBy >= t.late_min_minutes && lateBy < t.misread_minutes) {
      a.late_raw += 1;
      if (exc) a.late_excused += 1;
      else if (fullLate) { a.late_excused += 1; a.hours_excused += 1; }
      else { a.lates += 1; a.late_min += lateBy; }
    }
    const earlyBy = outM === null ? 0 : toMin(rm.end) - outM;
    const dow = new Date(`${r.d}T00:00:00Z`).getUTCDay();
    if (earlyBy > (rm.early_grace ?? t.early_min_exclusive) && earlyBy < t.early_max_exclusive && (!t.early_weekdays_only || dow !== 0) && !rel[ym].has(r.d)) {
      if (fullEarly) a.hours_excused += 1;
      else { a.early_exits += 1; a.early_min += earlyBy; if (earlyBy >= t.option_c_long_minutes) a.early_long += 1; }
    }
    out.set(key, a);
  }
  return [...out.values()];
}

function loadEmployees(db, codes) {
  const map = new Map();
  if (!codes.length) return map;
  const stmt = db.prepare(`SELECT code, name, department, designation, company, is_contractor, employment_type, gross_salary
    FROM employees WHERE code = ? ORDER BY id LIMIT 1`);
  for (const c of codes) { const e = stmt.get(c); if (e) map.set(String(c), e); }
  return map;
}

/**
 * Joins the aggregate rows into one record per person: { code, emp, cur, prev }.
 * Rows for re-measured codes replace the SQL rows for those codes.
 */
function buildPeople(sqlRows, remRows, empMap, cfg, cur, prev) {
  const rem = new Set(remRows.map((r) => r.code));
  const rows = [...sqlRows.filter((r) => !rem.has(r.code)), ...remRows];
  const byCode = new Map();
  for (const r of rows) {
    const p = byCode.get(r.code) || { code: r.code, cur: null, prev: null };
    if (r.ym === cur) p.cur = r; else if (r.ym === prev) p.prev = r;
    byCode.set(r.code, p);
  }
  const pats = cfg.loading_designation_patterns.map((s) => String(s).toUpperCase());
  for (const p of byCode.values()) {
    const e = empMap.get(p.code) || {};
    p.name = e.name || null; p.department = e.department || null; p.designation = e.designation || null;
    p.company = e.company || null; p.gross_salary = Number(e.gross_salary) || 0;
    p.group = (Number(e.is_contractor) === 1 || e.employment_type === 'Contract') ? 'Contract' : 'Company';
    const des = String(e.designation || '').toUpperCase();
    p.loading = pats.some((x) => x && des.includes(x));
    p.in_employee_master = !!empMap.get(p.code);
  }
  return byCode;
}

// ── step 4: exclusions ────────────────────────────────────────────────────

/**
 * Shift check (early exits). A person whose system early exits fall on >= shift_fit_share of their Mon–Sat worked days
 * (min shift_fit_min_days days) is "habitual" — usually a wrong shift in the master. For them ('habitual') or for everyone
 * ('everyone') an exit counts only on a day out − in < shift length − shift_fit_grace. Re-measured rows have their own rule.
 */
function isHabitualEarly(m, t) {
  return !!m && m.ms_days >= t.shift_fit_min_days && m.early_exits > 0 && m.early_exits >= t.shift_fit_share * m.ms_days;
}
function shiftFitApplies(m, cfg) {
  if (!m || m.remeasured || m.early_short === undefined || m.early_short === null) return false;
  if (cfg.shift_fit === 'everyone') return true;
  return cfg.shift_fit === 'habitual' && isHabitualEarly(m, cfg.thresholds);
}

function applyExclusions(byCode, cfg) {
  const exCodes = new Set(cfg.excluded_codes); const exDept = new Set(cfg.excluded_departments.map((d) => d.toUpperCase()));
  const earlyEx = new Set(cfg.early_excluded_codes); const held = new Set(cfg.held_codes);
  const kept = []; const excluded = []; const heldList = [];
  for (const p of byCode.values()) {
    if (exCodes.has(p.code) || exDept.has(String(p.department || '').toUpperCase())) { excluded.push(p.code); continue; }
    for (const m of [p.cur, p.prev]) {
      if (!m) continue;
      m.lates_counted = p.loading ? 0 : m.lates; m.late_min_counted = p.loading ? 0 : m.late_min;
      const ee = earlyEx.has(p.code);
      const fit = !ee && shiftFitApplies(m, cfg);
      m.fit_applied = fit; m.early_raw = m.early_exits;
      m.fit_excused = fit ? m.early_exits - m.early_short : 0;
      m.early_counted = ee ? 0 : fit ? m.early_short : m.early_exits;
      m.early_min_counted = ee ? 0 : fit ? m.early_short_min : m.early_min;
      m.early_long_counted = ee ? 0 : fit ? m.early_short_long : m.early_long;
      m.fit_confirm_master = fit && isHabitualEarly(m, cfg.thresholds) && m.early_counted > 0
        && m.early_counted >= cfg.thresholds.shift_fit_confirm_share * m.early_raw;
    }
    p.early_excluded = earlyEx.has(p.code);
    p.held = held.has(p.code);
    if (p.held) heldList.push(p);
    kept.push(p);
  }
  return { kept, excludedCount: excluded.length, held: heldList };
}

// ── step 5: classify ──────────────────────────────────────────────────────

function workdaysLost(m) {
  if (!m || !m.shift_h) return 0;
  return (m.late_min_counted + m.early_min_counted) / (m.shift_h * 60);
}

function classify(people, cfg) {
  const t = cfg.thresholds;
  for (const p of people) {
    const c = p.cur;
    p.newcomer = !p.prev || p.prev.worked_days < t.newcomer_min_prev_days;
    if (!c) { p.categories = []; p.workdays_lost = 0; continue; }
    p.workdays_lost = workdaysLost(c);
    const notImproved = (curV, prevV) => p.newcomer || curV > t.improved_ratio * prevV;
    const pl = p.prev ? p.prev.lates_counted : 0; const pe = p.prev ? p.prev.early_counted : 0;
    const enough = c.worked_days >= t.regular_min_worked;
    const cats = [];
    if (c.lates_counted >= t.regular_count && enough && notImproved(c.lates_counted, pl)) cats.push('late_regular');
    if (c.early_counted >= t.regular_count && enough && p.workdays_lost >= t.act_workdays && notImproved(c.early_counted, pe)) cats.push('early_regular');
    if (c.lates_counted >= t.double_late && c.early_counted >= t.double_early && p.workdays_lost >= t.act_workdays) cats.push('double');
    p.categories = cats;
    p.is_double_defaulter = c.lates_counted >= t.double_late && c.early_counted >= t.double_early;
    p.is_regular = enough && (c.lates_counted >= t.regular_count || c.early_counted >= t.regular_count);
    p.late_improved = !!p.prev && !p.newcomer && c.lates_counted <= t.improved_ratio * pl;
    p.early_improved = !!p.prev && !p.newcomer && c.early_counted <= t.improved_ratio * pe;
  }
  return people;
}

function optionCDays(m, t) {
  if (!m) return 0;
  const long = m.early_long_counted; const short = m.early_counted - long;
  return 0.5 * long + 0.5 * Math.floor(short / t.option_c_short_per_half);
}

// ── step 6–7: actions + notices ───────────────────────────────────────────

function personLine(p, monthDays) {
  const c = p.cur || {};
  return {
    code: p.code, name: p.name, department: p.department, designation: p.designation, group: p.group,
    worked_days: c.worked_days || 0, late_days: c.lates_counted || 0, early_days: c.early_counted || 0,
    late_min: c.late_min_counted || 0, early_min: c.early_min_counted || 0, shift_h: c.shift_h || null,
    workdays_lost: r2(p.workdays_lost || 0),
    last_month: p.prev ? { worked_days: p.prev.worked_days, late_days: p.prev.lates_counted, early_days: p.prev.early_counted } : null,
    newcomer: p.newcomer, categories: p.categories || [], remeasured: !!c.remeasured, hours_excused: c.hours_excused || 0, fit_excused: c.fit_excused || 0, late_full_excused: c.late_full_excused || 0,
    gross_salary: p.gross_salary, _monthDays: monthDays,
  };
}

function actions(people, cfg, overrides, month, year) {
  const t = cfg.thresholds; const md = daysInMonth(month, year);
  const ov = new Map((overrides || []).map((o) => [String(o.code), o]));
  const eligible = people.filter((p) => !p.held && p.cur);
  const actionList = []; const applied = [];
  for (const p of eligible) {
    const o = ov.get(p.code);
    const selected = p.categories.length > 0;
    if (o && o.action === 'exclude') { if (selected) applied.push({ ...o, effect: 'removed from action list' }); else applied.push({ ...o, effect: 'no effect (not selected)' }); continue; }
    if (!selected && !(o && o.action === 'include')) continue;
    const line = personLine(p, md);
    const forcedWarn = o && o.action === 'warning';
    // Leaves early almost every day and short of the master shift: punches alone cannot tell a wrong master shift from a
    // habitual early leaver, so this is a flag for the admin (fix the master, or override) — the action is unchanged.
    if (p.cur.fit_confirm_master) line.check_master_shift = true;
    if (p.newcomer || forcedWarn) { line.action = 'warning'; line.deduction_days = 0; }
    else { line.action = 'deduction'; line.deduction_days = roundDeduction(p.workdays_lost, t); }
    line.indicative_amount = line.deduction_days > 0 && p.gross_salary ? Math.round((p.gross_salary / md) * line.deduction_days) : 0;
    if (o) { line.override = { action: o.action, reason: o.reason }; applied.push({ ...o, effect: o.action === 'include' && !selected ? 'added to action list' : forcedWarn ? 'deduction changed to warning' : 'no change' }); }
    delete line.gross_salary; delete line._monthDays;
    actionList.push(line);
  }
  for (const o of ov.values()) if (!people.some((p) => p.code === String(o.code) && p.cur && !p.held)) applied.push({ ...o, effect: 'no effect (code not in this month\'s data)' });
  actionList.sort((a, b) => b.workdays_lost - a.workdays_lost || a.code.localeCompare(b.code));

  const onList = new Set(actionList.map((a) => a.code));
  const earlyExitWarnings = [];
  for (const p of eligible) {
    if (onList.has(p.code) || p.early_excluded) continue;
    if ((ov.get(p.code) || {}).action === 'exclude') continue;
    const c = p.cur; if (c.early_counted < t.early_warning_min) continue;
    const days = optionCDays(c, t);
    const line = { code: p.code, name: p.name, department: p.department, designation: p.designation, group: p.group,
      early_exits: c.early_counted, over_1h: c.early_long_counted, early_min: c.early_min_counted, option_c_days: days, newcomer: p.newcomer,
      check_master_shift: !!c.fit_confirm_master };
    if (cfg.early_exit_rule === 'option_c' && !p.newcomer && days > 0) {
      line.action = 'deduction'; line.deduction_days = days;
      line.indicative_amount = p.gross_salary ? Math.round((p.gross_salary / md) * days) : 0;
    } else { line.action = 'warning'; line.deduction_days = 0; line.indicative_amount = 0; }
    earlyExitWarnings.push(line);
  }
  earlyExitWarnings.sort((a, b) => b.early_exits - a.early_exits || a.code.localeCompare(b.code));
  return { actionList, earlyExitWarnings, overridesApplied: applied };
}

function notices(people, cfg) {
  const t = cfg.thresholds; const live = people.filter((p) => !p.held && p.cur);
  const noticeLate = live.filter((p) => p.cur.lates_counted >= t.notice_late)
    .map((p) => ({ code: p.code, name: p.name, department: p.department, late_days: p.cur.lates_counted }))
    .sort((a, b) => b.late_days - a.late_days || a.code.localeCompare(b.code));
  const noticeEarly = live.filter((p) => p.cur.early_counted >= t.notice_early)
    .map((p) => ({ code: p.code, name: p.name, department: p.department, early_exits: p.cur.early_counted }))
    .sort((a, b) => b.early_exits - a.early_exits || a.code.localeCompare(b.code));
  return { noticeLate, noticeEarly };
}

// ── step 8: trend + departments ───────────────────────────────────────────

function summarise(people, cfg, cur, prev) {
  const t = cfg.thresholds; const init = () => ({ people: 0, worked_days: 0, late_days: 0, early_exits: 0, sched_min: 0, lost_min: 0, habitual_late: 0, double_defaulters: 0 });
  const monthly = { [prev]: { Company: init(), Contract: init(), All: init() }, [cur]: { Company: init(), Contract: init(), All: init() } };
  for (const p of people) {
    for (const [ym, m] of [[cur, p.cur], [prev, p.prev]]) {
      if (!m) continue;
      for (const g of [p.group, 'All']) {
        const s = monthly[ym][g];
        s.people += 1; s.worked_days += m.worked_days; s.late_days += m.lates_counted; s.early_exits += m.early_counted;
        s.sched_min += m.sched_min; s.lost_min += m.late_min_counted + m.early_min_counted;
        if (m.lates_counted >= 10) s.habitual_late += 1;
        if (m.lates_counted >= t.double_late && m.early_counted >= t.double_early) s.double_defaulters += 1;
      }
    }
  }
  for (const ym of Object.keys(monthly)) for (const s of Object.values(monthly[ym])) {
    s.late_pct = s.worked_days ? r1((s.late_days / s.worked_days) * 100) : 0;
    s.early_pct = s.worked_days ? r1((s.early_exits / s.worked_days) * 100) : 0;
    s.time_lost_pct = s.sched_min ? r1((s.lost_min / s.sched_min) * 100) : 0;
    s.sched_min = Math.round(s.sched_min);
  }
  const deps = new Map();
  for (const p of people) {
    const m = p.cur; if (!m) continue;
    const k = p.department || '(none)';
    const d = deps.get(k) || { department: k, people: 0, worked_days: 0, sched_min: 0, late_min: 0, early_min: 0, workdays_lost: 0, late_days: 0, early_exits: 0 };
    d.people += 1; d.worked_days += m.worked_days; d.sched_min += m.sched_min; d.late_min += m.late_min_counted; d.early_min += m.early_min_counted;
    d.workdays_lost += p.workdays_lost; d.late_days += m.lates_counted; d.early_exits += m.early_counted;
    deps.set(k, d);
  }
  const departments = [...deps.values()].map((d) => ({ ...d, sched_min: Math.round(d.sched_min), workdays_lost: r2(d.workdays_lost),
    time_lost_pct: d.sched_min ? r2(((d.late_min + d.early_min) / d.sched_min) * 100) : 0 }))
    .sort((a, b) => b.workdays_lost - a.workdays_lost);
  return { monthly, departments };
}

function weeklyTrend(db, month, year, cfg, releaseDays, prevReleaseDays, peopleByCode) {
  const rows = db.prepare(WEEKLY_SQL).all(sqlParams(month, year, cfg, releaseDays, prevReleaseDays));
  const wk = new Map();
  for (const r of rows) {
    const p = peopleByCode.get(String(r.code)); if (!p) continue; // excluded or unknown
    const key = `${r.week_start}|${p.group}`;
    const m = r.ym === (p.cur && p.cur.ym) ? p.cur : r.ym === (p.prev && p.prev.ym) ? p.prev : null;
    const a = wk.get(key) || { week_start: r.week_start, group: p.group, worked_days: 0, late_days: 0, early_exits: 0 };
    a.worked_days += r.worked_days; a.late_days += p.loading ? 0 : r.lates; a.early_exits += p.early_excluded ? 0 : (m && m.fit_applied ? r.early_short : r.early_exits);
    wk.set(key, a);
  }
  return [...wk.values()].map((a) => ({ ...a, late_pct: a.worked_days ? r1((a.late_days / a.worked_days) * 100) : 0, early_pct: a.worked_days ? r1((a.early_exits / a.worked_days) * 100) : 0 }))
    .sort((a, b) => a.week_start.localeCompare(b.week_start) || a.group.localeCompare(b.group));
}

// ── step 9: payroll checks ────────────────────────────────────────────────

function payrollChecks(db, month, year) {
  const rows = db.prepare(`SELECT d.employee_code, d.late_count, d.deduction_days, d.finance_status, d.is_applied_to_salary,
      (SELECT SUM(dc.late_deduction_days) FROM day_calculations dc WHERE dc.employee_code = d.employee_code AND dc.month = d.month AND dc.year = d.year) AS daycalc_days,
      (SELECT SUM(s.late_coming_deduction) FROM salary_computations s WHERE s.employee_code = d.employee_code AND s.month = d.month AND s.year = d.year) AS salary_amount
    FROM late_coming_deductions d WHERE d.month = ? AND d.year = ? ORDER BY d.employee_code`).all(month, year);
  const by = new Map();
  for (const r of rows) { const a = by.get(r.employee_code) || []; a.push(r); by.set(r.employee_code, a); }
  const flags = [];
  for (const [code, rs] of by) {
    const approved = rs.filter((r) => r.finance_status === 'approved');
    const dc = Number(rs[0].daycalc_days) || 0; const sal = Number(rs[0].salary_amount) || 0;
    if (approved.length > 1) flags.push({ code: String(code), flag: 'two_approved_rows', rows: approved.length });
    if (!approved.length && rs.some((r) => r.finance_status === 'rejected') && dc > 0) flags.push({ code: String(code), flag: 'rejected_but_daycalc_applied', daycalc_days: dc });
    if (dc > 0 && sal > 0) flags.push({ code: String(code), flag: 'daycalc_and_salary_deduction', daycalc_days: dc, salary_amount: sal });
  }
  return { month, year, rows: rows.length, flags };
}

// ── main ──────────────────────────────────────────────────────────────────

/**
 * @param db better-sqlite3 handle
 * @param opts { month, year, config (merged), releaseDays [], prevReleaseDays [], overrides [] }
 */
function computeAttendanceReview(db, { month, year, config, releaseDays = [], prevReleaseDays = [], overrides = [] }) {
  const cfg = mergeConfig(config);
  const cur = ymOf(month, year); const pm = prevMonth(month, year); const prev = ymOf(pm.month, pm.year);
  const sqlRows = loadPersonMonth(db, month, year, cfg, releaseDays, prevReleaseDays);
  const remRows = remeasureRows(db, month, year, cfg, releaseDays, prevReleaseDays);
  const codes = [...new Set([...sqlRows, ...remRows].map((r) => r.code))];
  const empMap = loadEmployees(db, codes);
  const byCode = buildPeople(sqlRows, remRows, empMap, cfg, cur, prev);
  const { kept, excludedCount, held } = applyExclusions(byCode, cfg);
  classify(kept, cfg);
  const act = actions(kept, cfg, overrides, month, year);
  const nt = notices(kept, cfg);
  const { monthly, departments } = summarise(kept, cfg, cur, prev);
  const keptMap = new Map(kept.map((p) => [p.code, p]));
  const weekly = weeklyTrend(db, month, year, cfg, releaseDays, prevReleaseDays, keptMap);
  const md = daysInMonth(month, year);
  const live = kept.filter((p) => p.cur);
  const peopleOut = live.filter((p) => (p.cur.lates_counted || 0) + (p.cur.early_counted || 0) > 0)
    .map((p) => { const l = personLine(p, md); delete l.gross_salary; delete l._monthDays; return l; })
    .sort((a, b) => b.workdays_lost - a.workdays_lost || a.code.localeCompare(b.code));
  const doubleDefaulters = live.filter((p) => p.is_double_defaulter).map((p) => ({ code: p.code, name: p.name, department: p.department,
    late_days: p.cur.lates_counted, early_days: p.cur.early_counted, workdays_lost: r2(p.workdays_lost), selected: p.categories.includes('double') }))
    .sort((a, b) => b.workdays_lost - a.workdays_lost);
  const regular = live.filter((p) => p.is_regular).map((p) => ({ code: p.code, name: p.name, department: p.department,
    late_days: p.cur.lates_counted, early_days: p.cur.early_counted, last_late: p.prev ? p.prev.lates_counted : null, last_early: p.prev ? p.prev.early_counted : null,
    newcomer: p.newcomer, late_improved: p.late_improved, early_improved: p.early_improved, selected: p.categories.length > 0 }));
  const shiftCheck = live.filter((p) => p.cur.fit_applied && (isHabitualEarly(p.cur, cfg.thresholds) || p.cur.fit_excused > 0)).map((p) => {
    const c = p.cur; const habitual = isHabitualEarly(c, cfg.thresholds);
    const result = c.early_counted === 0 ? 'hidden' : c.early_counted >= cfg.thresholds.early_warning_min ? 'shown' : 'below_threshold';
    return { code: p.code, name: p.name, department: p.department, designation: p.designation, shift_h: c.shift_h, ms_days: c.ms_days,
      system_early: c.early_raw, excused: c.fit_excused, counted: c.early_counted,
      avg_hours: c.early_raw ? r1(c.early_wm_sum / c.early_raw / 60) : null, habitual, result,
      check_master: !!c.fit_confirm_master };
  }).sort((a, b) => b.system_early - a.system_early || a.code.localeCompare(b.code));
  const gatePassCount = db.prepare('SELECT COUNT(*) n FROM short_leaves WHERE substr(date,1,7) = ? AND cancelled_at IS NULL').get(cur).n;
  // early exits a gate pass fully covered (early-exit detection writes these as 'exempted')
  const gatePassExcused = db.prepare("SELECT COUNT(*) n FROM early_exit_detections WHERE substr(date,1,7) = ? AND has_gate_pass = 1 AND flagged_minutes = 0").get(cur).n;
  const ded = act.actionList.filter((a) => a.action === 'deduction');
  return {
    meta: { month, year, ym: cur, prev_ym: prev, days_in_month: md, release_days: releaseDays, prev_release_days: prevReleaseDays,
      excluded_people: excludedCount, people_assessed: live.length, missing_shift_hours: live.filter((p) => p.cur.shift_h_missing).map((p) => p.code),
      not_in_employee_master: live.filter((p) => !p.in_employee_master).map((p) => p.code) },
    criteria: { thresholds: cfg.thresholds, stayed_late_mode: cfg.stayed_late_mode, early_exit_rule: cfg.early_exit_rule, shift_fit: cfg.shift_fit, late_full_hours: cfg.late_full_hours !== false, loading_designation_patterns: cfg.loading_designation_patterns, remeasure: cfg.remeasure || {} },
    releaseDaysDetected: detectReleaseDays(db, month, year, cfg),
    shiftIssues: detectShiftIssues(db, month, year).filter((r) => !cfg.excluded_codes.includes(r.code)
      && !cfg.excluded_departments.map((d) => d.toUpperCase()).includes(String(r.department || '').toUpperCase())),
    trend: { monthly, weekly }, departments, shiftCheck,
    people: peopleOut, doubleDefaulters, regular,
    actionList: act.actionList, earlyExitWarnings: act.earlyExitWarnings,
    actionTotals: { people: act.actionList.length, deduction_notes: ded.length, warning_notes: act.actionList.length - ded.length,
      deduction_days: ded.reduce((s, a) => s + a.deduction_days, 0), indicative_amount: ded.reduce((s, a) => s + a.indicative_amount, 0) },
    held: held.filter((p) => p.cur).map((p) => ({ code: p.code, name: p.name, department: p.department, late_days: p.cur.lates_counted, early_exits: p.cur.early_counted })),
    noticeLate: nt.noticeLate, noticeEarly: nt.noticeEarly,
    payrollChecks: payrollChecks(db, pm.month, pm.year), gatePassCount, gatePassExcused,
    overridesApplied: act.overridesApplied,
  };
}

module.exports = {
  DEFAULT_CONFIG, mergeConfig, validateConfig, validateOverrides, loadConfig,
  PERSON_MONTH_SQL, WEEKLY_SQL, RELEASE_DAYS_SQL, SHIFT_ISSUES_SQL, sqlParams, inlineParams,
  isHabitualEarly, shiftFitApplies, detectReleaseDays, detectShiftIssues, loadPersonMonth, remeasureRows, buildPeople, applyExclusions, classify, actions, notices,
  roundDeduction, optionCDays, prevMonth, daysInMonth, computeAttendanceReview,
};
