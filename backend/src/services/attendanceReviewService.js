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
    // master basis only (assessment_basis 'master'):
    odd_punch_minutes: 180,        // in-punch more than this many minutes before the master start → not assessed (odd punch)
    night_start_minutes: 1200,     // night work on a 12-hour day master is measured from 20:00 (1200) for 12 hours
    stayed_late_minutes: 20,       // stayed late = out ≥ scheduled end + this many minutes (recomputed on the master)
    // suggestions
    senior_hint_gross: 75000,      // a person about to be deducted with gross ≥ this → suggest "senior staff — not assessed"
    master_fit_min_days: 8,        // master-fit check needs at least this many assessed full days in the month
    master_fit_share: 0.6,         // … late or early (raw) on at least this share of them
  }),
  // 'import' = the shift the import matched each day (is_late_arrival / is_early_departure as stored);
  // 'master' = each person's CURRENT master shift (employees.default_shift_id), measured from the punches (owner ruling 10 Oct 2026).
  assessment_basis: 'import',
  // master basis: a miss-punch day fixed from the gate register (miss_punch_resolved) is assessed with those times (MP-1).
  // An out typed as exactly the shift end is "out not verified": no early exit is measured from it and it excuses nothing (MP-3).
  assess_fixed_miss_punch: true,
  stayed_late_mode: 'either',      // 'worked' | 'calendar' | 'either' (previous worked day OR previous calendar day)
  early_exit_rule: 'warning',      // 'warning' | 'option_c'
  shift_fit: 'everyone',           // early exit not counted on a full-hours day: 'everyone' | 'habitual' (only habitual early leavers) | 'off'
  late_full_hours: true,           // late not counted on a day the person still worked the full shift length (owner ruling 10 Oct 2026)
  loading_designation_patterns: Object.freeze(['LOAD', 'LODING']),
  excluded_codes: Object.freeze([]),        // left out of every output
  excluded_departments: Object.freeze([]),  // left out of every output (e.g. piece-rate contractors)
  early_excluded_codes: Object.freeze([]),  // manual override: early exits not assessed (normally empty — the shift check handles wrong shifts)
  held_codes: Object.freeze([]),            // listed as held, no action / notice
  // Standing rules (set once, carry forward until removed, each with a reason). The four lists above are DERIVED from these
  // by mergeConfig; older configs that only have the lists are folded in with the reason "From the earlier list".
  standing_people: Object.freeze({}),       // { code: { rule: 'exclude' | 'early_exempt' | 'held', reason, source?, set_by?, set_at? } }
  standing_departments: Object.freeze({}),  // { department: { rule: 'exclude', reason, source?, set_by?, set_at? } } e.g. a piece-rate crew
  contract_loaders_early_exempt: true,      // contractor workers with a loading designation: early exits not counted (owner ruling 11 Oct 2026)
  dismissed_suggestions: Object.freeze({}), // { key: { by, at } } — a dismissed suggestion is not shown again
  remeasure: Object.freeze({}),             // { code: { start, end 'HH:MM', late_grace 9, early_grace 15, left_late 'system'|'shift'|'off', left_late_minutes 20, hours_complete false, hours_grace 10 } }
});

const MODES = { worked: 0, calendar: 1, either: 2 };
const ACTIONS = ['include', 'exclude', 'warning'];
const SHIFT_FIT = ['habitual', 'everyone', 'off'];
const BASES = ['import', 'master'];
const WORKED = "('P','WOP','½P','WO½P')";

// ── config ────────────────────────────────────────────────────────────────

const LEGACY_REASON = 'From the earlier list';
const PERSON_RULES = ['exclude', 'early_exempt', 'held'];
const DEPT_RULES = ['exclude'];

/** Standing rules from a stored config: the explicit maps, plus the older code / department lists folded in. */
function standingFrom(s) {
  const people = {}; const depts = {};
  const add = (map, k, rule) => { const key = String(k).trim(); if (key && !map[key]) map[key] = { rule, reason: LEGACY_REASON }; };
  (s.excluded_codes || []).forEach((c) => add(people, c, 'exclude'));
  (s.early_excluded_codes || []).forEach((c) => add(people, c, 'early_exempt'));
  (s.held_codes || []).forEach((c) => add(people, c, 'held'));
  (s.excluded_departments || []).forEach((d) => add(depts, d, 'exclude'));
  for (const [k, v] of Object.entries(s.standing_people || {})) people[String(k).trim()] = { ...v };
  for (const [k, v] of Object.entries(s.standing_departments || {})) depts[String(k).trim()] = { ...v };
  return { people, depts };
}

function mergeConfig(stored) {
  const s = stored && typeof stored === 'object' ? stored : {};
  const st = standingFrom(s);
  const codesWith = (rule) => Object.entries(st.people).filter(([, v]) => v.rule === rule).map(([k]) => k);
  return {
    ...DEFAULT_CONFIG,
    ...s,
    thresholds: { ...DEFAULT_CONFIG.thresholds, ...(s.thresholds || {}) },
    loading_designation_patterns: s.loading_designation_patterns || [...DEFAULT_CONFIG.loading_designation_patterns],
    standing_people: st.people,
    standing_departments: st.depts,
    excluded_codes: codesWith('exclude'),
    excluded_departments: Object.entries(st.depts).filter(([, v]) => v.rule === 'exclude').map(([k]) => k),
    early_excluded_codes: codesWith('early_exempt'),
    held_codes: codesWith('held'),
    contract_loaders_early_exempt: s.contract_loaders_early_exempt !== false,
    dismissed_suggestions: { ...(s.dismissed_suggestions || {}) },
    remeasure: { ...(s.remeasure || {}) },
  };
}

/**
 * The config to STORE once standing rules exist: the older lists are dropped (they live in standing_* now).
 * Used by the suggestions endpoint; the rules editor sends this shape too.
 */
function toStoredConfig(s) {
  const st = standingFrom(s || {});
  const out = { ...(s || {}), standing_people: st.people, standing_departments: st.depts };
  for (const k of ['excluded_codes', 'excluded_departments', 'early_excluded_codes', 'held_codes']) delete out[k];
  return out;
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
  if (c.assessment_basis !== undefined && !BASES.includes(c.assessment_basis)) errs.push('assessment_basis must be import | master');
  if (c.assess_fixed_miss_punch !== undefined && typeof c.assess_fixed_miss_punch !== 'boolean') errs.push('assess_fixed_miss_punch must be true or false');
  if (c.contract_loaders_early_exempt !== undefined && typeof c.contract_loaders_early_exempt !== 'boolean') errs.push('contract_loaders_early_exempt must be true or false');
  for (const [key, rules, label] of [['standing_people', PERSON_RULES, 'code'], ['standing_departments', DEPT_RULES, 'department']]) {
    if (c[key] === undefined) continue;
    if (!c[key] || typeof c[key] !== 'object' || Array.isArray(c[key])) { errs.push(`${key} must be an object keyed by ${label}`); continue; }
    for (const [k, v] of Object.entries(c[key])) {
      if (!String(k).trim()) errs.push(`${key}: empty ${label}`);
      if (!v || !rules.includes(v.rule)) errs.push(`${key} ${k}: rule must be ${rules.join(' | ')}`);
      if (!v || typeof v.reason !== 'string' || v.reason.trim().length < 3) errs.push(`${key} ${k}: a reason of at least 3 characters is required`);
    }
  }
  if (c.dismissed_suggestions !== undefined && (!c.dismissed_suggestions || typeof c.dismissed_suggestions !== 'object' || Array.isArray(c.dismissed_suggestions))) errs.push('dismissed_suggestions must be an object');
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
const PERSON_MONTH_TAIL = `
pl AS (SELECT c, d, MAX(ll) ll FROM base GROUP BY c, d),
w AS (SELECT b.*, LAG(b.ll) OVER (PARTITION BY b.c ORDER BY b.d) pll FROM base b
      WHERE b.st IN ${WORKED} AND b.mp = 0),
x AS (SELECT w.*, COALESCE(p.ll,0) cll, substr(w.d,1,7) ym,
             CASE WHEN w.st IN ('½P','WO½P') THEN 0.5 ELSE 1.0 END f,
             COALESCE(w.bh, (SELECT s.duration_hours FROM shifts s WHERE s.name = w.sd AND s.duration_hours > 0 ORDER BY s.id LIMIT 1), @defH) h,
             CASE WHEN w.bh IS NULL AND (SELECT s.duration_hours FROM shifts s WHERE s.name = w.sd AND s.duration_hours > 0 LIMIT 1) IS NULL THEN 1 ELSE 0 END hmiss,
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

const WEEKLY_TAIL = `
pl AS (SELECT c, d, MAX(ll) ll FROM base GROUP BY c, d),
w AS (SELECT b.*, LAG(b.ll) OVER (PARTITION BY b.c ORDER BY b.d) pll FROM base b WHERE b.st IN ${WORKED} AND b.mp = 0),
x AS (SELECT w.*, COALESCE(p.ll,0) cll, substr(w.d,1,7) ym,
             CASE WHEN w.st IN ('½P','WO½P') THEN 0.5 ELSE 1.0 END f,
             COALESCE(w.bh, (SELECT s.duration_hours FROM shifts s WHERE s.name = w.sd AND s.duration_hours > 0 ORDER BY s.id LIMIT 1), @defH) h,
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

/**
 * Day rows on the IMPORT basis: the flags the import (and early-exit detection, gate passes applied) stored on each row.
 * Columns every basis must give: c d st mp la lm ed em ll sd it ot bh (bh = shift hours of the basis; NULL → looked up by sd).
 */
const IMPORT_BASE = `
WITH base AS (
  SELECT a.employee_code c, a.date d, a.status_final st, COALESCE(a.is_miss_punch,0) mp,
         COALESCE(a.is_late_arrival,0) la, COALESCE(a.late_by_minutes,0) lm,
         COALESCE(a.is_early_departure,0) ed, COALESCE(a.early_by_minutes,0) em,
         COALESCE(a.is_left_late,0) ll, a.shift_detected sd, a.in_time_final it, a.out_time_final ot, NULL bh
  FROM attendance_processed a WHERE a.date BETWEEN @from AND @to),`;

/**
 * Day rows on the MASTER basis (owner ruling 10 Oct 2026): every day measured on the person's CURRENT master shift
 * (employees.default_shift_id), from the final punches. Same output columns as IMPORT_BASE, plus mode / ua / gr / onv / gpx.
 *  mode  day    — day work on the master's start / end / length
 *        night  — night work (is_night_shift or "Night Shift") on a 12-hour master → @nightStart for 12 h;
 *                 or any day on an overnight master (end < start) → that master's own times
 *        no_master | night_on_day_master | odd_punch (in > @odd min before start) → not assessed (ua)
 *  Half days (½P / WO½P) are not assessed for late / early (already paid as half a day).
 *  gr    a miss-punch day fixed from the gate register, assessed with those times when @fixMp = 1 (else skipped as before).
 *  onv   gr day whose out is exactly the shift end → "out not verified": worked minutes unknown, so no early exit is
 *        measured and the out can't excuse a late (full hours) or give a stayed-late exemption.
 *  Gate pass (short_leaves, not cancelled, first by id): out ≥ end − pass hours → not early; earlier → only the minutes beyond.
 */
const MASTER_BASE = `
WITH m0 AS (
  SELECT a.employee_code c, a.date d, a.status_final st, COALESCE(a.is_miss_punch,0) mp0, COALESCE(a.miss_punch_resolved,0) mpr,
         COALESCE(a.is_night_shift,0) nt, a.shift_detected sd, a.in_time_final it, a.out_time_final ot,
         sh.start_time mst, sh.end_time men, sh.duration_hours mdur,
         (SELECT sl.duration_hours FROM short_leaves sl WHERE sl.employee_code = a.employee_code AND sl.date = a.date
            AND sl.cancelled_at IS NULL ORDER BY sl.id LIMIT 1) gph
  FROM attendance_processed a
  LEFT JOIN shifts sh ON sh.id = (SELECT e.default_shift_id FROM employees e WHERE e.code = a.employee_code ORDER BY e.id LIMIT 1)
  WHERE a.date BETWEEN @from AND @to),
m1 AS (SELECT m0.*,
  CASE WHEN mp0 = 1 AND (@fixMp = 0 OR mpr = 0) THEN 1 ELSE 0 END mp,
  CASE WHEN mp0 = 1 AND @fixMp = 1 AND mpr = 1 THEN 1 ELSE 0 END gr,
  CASE WHEN it IS NULL OR length(it) < 5 THEN NULL ELSE CAST(substr(it,1,2) AS INTEGER)*60 + CAST(substr(it,4,2) AS INTEGER) END inm,
  CASE WHEN ot IS NULL OR length(ot) < 5 THEN NULL ELSE CAST(substr(ot,1,2) AS INTEGER)*60 + CAST(substr(ot,4,2) AS INTEGER) END otm,
  CASE WHEN mst IS NULL OR length(mst) < 5 THEN NULL ELSE CAST(substr(mst,1,2) AS INTEGER)*60 + CAST(substr(mst,4,2) AS INTEGER) END sm,
  CASE WHEN men IS NULL OR length(men) < 5 THEN NULL ELSE CAST(substr(men,1,2) AS INTEGER)*60 + CAST(substr(men,4,2) AS INTEGER) END enm,
  (nt = 1 OR sd = 'Night Shift') isn,
  CASE WHEN st IN ('½P','WO½P') THEN 1 ELSE 0 END half
  FROM m0),
m2 AS (SELECT m1.*,
  CASE WHEN sm IS NULL OR enm IS NULL OR mdur IS NULL OR mdur <= 0 THEN 'no_master'
       WHEN enm < sm THEN 'night'
       WHEN isn AND mdur = 12 THEN 'night'
       WHEN isn THEN 'night_on_day_master'
       WHEN inm IS NOT NULL AND inm < sm - @odd THEN 'odd_punch'
       ELSE 'day' END mode,
  CASE WHEN enm < sm THEN sm WHEN isn AND mdur = 12 THEN @nightStart ELSE sm END s0,
  CAST(ROUND(mdur * 60) AS INTEGER) dmin
  FROM m1),
m3 AS (SELECT m2.*,
  CASE WHEN mode = 'night' AND inm IS NOT NULL AND inm < 720 THEN inm + 1440 ELSE inm END inabs,
  CASE WHEN gr = 1 AND otm IS NOT NULL AND s0 IS NOT NULL AND otm = (s0 + dmin) % 1440 THEN 1 ELSE 0 END onv,
  CASE WHEN st IN ${WORKED} AND mp = 0 AND mode IN ('day','night') AND half = 0 AND inm IS NOT NULL AND otm IS NOT NULL THEN 1 ELSE 0 END asx
  FROM m2),
m4 AS (SELECT m3.*,
  CASE WHEN inm IS NULL OR otm IS NULL OR onv = 1 THEN NULL ELSE (otm - inm + 1440) % 1440 END wmx
  FROM m3),
m5 AS (SELECT m4.*,
  inabs - s0 lt,
  CASE WHEN wmx IS NULL THEN NULL ELSE (s0 + dmin) - (inabs + wmx) END er
  FROM m4),
base AS (
  SELECT c, d, st, mp,
    CASE WHEN asx = 1 AND lt > 0 THEN 1 ELSE 0 END la,
    CASE WHEN asx = 1 AND lt > 0 THEN lt ELSE 0 END lm,
    CASE WHEN asx = 1 AND er IS NOT NULL AND er > 0 AND (gph IS NULL OR er > CAST(ROUND(gph * 60) AS INTEGER)) THEN 1 ELSE 0 END ed,
    CASE WHEN asx = 1 AND er IS NOT NULL AND er > 0 THEN CASE WHEN gph IS NULL THEN er ELSE MAX(0, er - CAST(ROUND(gph * 60) AS INTEGER)) END ELSE 0 END em,
    CASE WHEN asx = 1 AND er IS NOT NULL AND -er >= @llMin THEN 1 ELSE 0 END ll,
    sd, it, CASE WHEN onv = 1 THEN NULL ELSE ot END ot,
    CASE WHEN mdur > 0 THEN mdur ELSE NULL END bh,
    mode, CASE WHEN st IN ${WORKED} AND mp = 0 AND mode NOT IN ('day','night') THEN mode END ua, gr, onv,
    CASE WHEN asx = 1 AND er IS NOT NULL AND er > 0 AND gph IS NOT NULL THEN 1 ELSE 0 END gpx, half
  FROM m5),`;

const PERSON_MONTH_SQL = IMPORT_BASE + PERSON_MONTH_TAIL;
const PERSON_MONTH_SQL_MASTER = MASTER_BASE + PERSON_MONTH_TAIL;
const WEEKLY_SQL = IMPORT_BASE + WEEKLY_TAIL;
const WEEKLY_SQL_MASTER = MASTER_BASE + WEEKLY_TAIL;

/** Master basis: plant-wide release days — Mon–Sat, day-mode work, more than @share of those workers left > @eMin min early. */
const RELEASE_DAYS_SQL_MASTER = MASTER_BASE.replace(/,$/, '') + `
SELECT d AS date, COUNT(*) AS worked,
  SUM(CASE WHEN ed = 1 AND em > @eMin AND em < @eMax THEN 1 ELSE 0 END) AS early
FROM base WHERE substr(d,1,7) = @cur AND st IN ${WORKED} AND mp = 0 AND mode = 'day' AND half = 0 AND strftime('%w', d) <> '0'
GROUP BY d HAVING early * 1.0 / worked > @share ORDER BY d`;

/** Master basis: what was and wasn't assessed this month (data quality). One row per (code, kind). */
const MASTER_QUALITY_SQL = MASTER_BASE.replace(/,$/, '') + `
SELECT c AS code, kind, COUNT(*) AS days FROM (
  SELECT c, ua AS kind FROM base WHERE substr(d,1,7) = @cur AND ua IS NOT NULL
  UNION ALL SELECT c, 'half_day' FROM base WHERE substr(d,1,7) = @cur AND st IN ${WORKED} AND mp = 0 AND half = 1
  UNION ALL SELECT c, 'gate_register' FROM base WHERE substr(d,1,7) = @cur AND st IN ${WORKED} AND gr = 1
  UNION ALL SELECT c, 'out_not_verified' FROM base WHERE substr(d,1,7) = @cur AND st IN ${WORKED} AND onv = 1
  UNION ALL SELECT c, 'gate_pass' FROM base WHERE substr(d,1,7) = @cur AND gpx = 1
  UNION ALL SELECT c, 'miss_punch_open' FROM base WHERE substr(d,1,7) = @cur AND st IN ${WORKED} AND mp = 1
) GROUP BY c, kind ORDER BY kind, c`;

/** Master basis: one row per worked full day with punches (day mode, or no master / odd punch) — for the master-fit check. */
const MASTER_DAYS_SQL = MASTER_BASE.replace(/,$/, '') + `
SELECT c AS code, mode, inm, otm, lt, er FROM m5
WHERE substr(d,1,7) = @cur AND st IN ${WORKED} AND mp = 0 AND half = 0 AND inm IS NOT NULL AND otm IS NOT NULL
  AND mode IN ('day', 'no_master', 'odd_punch') ORDER BY c, d`;

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
    // master basis only (unused by the import SQL)
    fixMp: cfg.assess_fixed_miss_punch === false ? 0 : 1, odd: t.odd_punch_minutes, nightStart: t.night_start_minutes, llMin: t.stayed_late_minutes,
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

const isMaster = (cfg) => cfg.assessment_basis === 'master';

function detectReleaseDays(db, month, year, cfg) {
  const t = cfg.thresholds;
  const rows = isMaster(cfg)
    ? db.prepare(RELEASE_DAYS_SQL_MASTER).all({ ...sqlParams(month, year, cfg, [], []), share: t.release_day_share })
    : db.prepare(RELEASE_DAYS_SQL).all({ cur: ymOf(month, year), eMin: t.early_min_exclusive, eMax: t.early_max_exclusive, share: t.release_day_share });
  return rows.map((r) => ({ date: r.date, worked: r.worked, early: r.early, share: r2(r.early / r.worked) }));
}

/**
 * Master basis only: what the month's assessment left out or measured differently, by reason, with the codes.
 * no_master | night_on_day_master | odd_punch = worked days not assessed; half_day = not assessed for late / early;
 * gate_register = fixed miss-punch days assessed with gate-register times; out_not_verified = of those, out typed as the
 * exact shift end; gate_pass = early exits reduced by a gate pass; miss_punch_open = miss-punch days still skipped.
 * People left out of the review (excluded_codes, excluded_departments) are left out here too. Returns null on the import basis.
 */
function assessmentQuality(db, month, year, cfg) {
  if (!isMaster(cfg)) return null;
  const ex = new Set(cfg.excluded_codes); const exDept = new Set(cfg.excluded_departments.map((d) => d.toUpperCase()));
  const all = db.prepare(MASTER_QUALITY_SQL).all(sqlParams(month, year, cfg, [], [])).map((r) => ({ ...r, code: String(r.code) }));
  const emp = loadEmployees(db, [...new Set(all.map((r) => r.code))]);
  const rows = all.filter((r) => !ex.has(r.code) && !exDept.has(String((emp.get(r.code) || {}).department || '').toUpperCase()));
  const kinds = ['no_master', 'night_on_day_master', 'odd_punch', 'half_day', 'gate_register', 'out_not_verified', 'gate_pass', 'miss_punch_open'];
  const out = {};
  for (const k of kinds) {
    const rs = rows.filter((r) => r.kind === k);
    out[k] = { days: rs.reduce((a, r) => a + r.days, 0), people: rs.map((r) => ({ code: r.code, days: r.days })) };
  }
  out.unassessable_days = out.no_master.days + out.night_on_day_master.days + out.odd_punch.days;
  return out;
}

function detectShiftIssues(db, month, year) {
  return db.prepare(SHIFT_ISSUES_SQL).all({ cur: ymOf(month, year) }).map((r) => ({ ...r, code: String(r.code) }));
}

// ── step 3: person-month ──────────────────────────────────────────────────

function loadPersonMonth(db, month, year, cfg, releaseDays, prevReleaseDays) {
  const p = sqlParams(month, year, cfg, releaseDays, prevReleaseDays);
  return db.prepare(isMaster(cfg) ? PERSON_MONTH_SQL_MASTER : PERSON_MONTH_SQL).all(p).map((r) => ({ ...r, code: String(r.code) }));
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
    // contractor loaders may leave once dispatch is done → early exits not counted (owner ruling 11 Oct 2026)
    p.contract_loader = p.loading && p.group === 'Contract' && cfg.contract_loaders_early_exempt !== false;
    for (const m of [p.cur, p.prev]) {
      if (!m) continue;
      m.lates_counted = p.loading ? 0 : m.lates; m.late_min_counted = p.loading ? 0 : m.late_min;
      const ee = earlyEx.has(p.code) || p.contract_loader;
      const fit = !ee && shiftFitApplies(m, cfg);
      m.fit_applied = fit; m.early_raw = m.early_exits;
      m.fit_excused = fit ? m.early_exits - m.early_short : 0;
      m.early_counted = ee ? 0 : fit ? m.early_short : m.early_exits;
      m.early_min_counted = ee ? 0 : fit ? m.early_short_min : m.early_min;
      m.early_long_counted = ee ? 0 : fit ? m.early_short_long : m.early_long;
      m.fit_confirm_master = fit && isHabitualEarly(m, cfg.thresholds) && m.early_counted > 0
        && m.early_counted >= cfg.thresholds.shift_fit_confirm_share * m.early_raw;
    }
    p.early_excluded = earlyEx.has(p.code) || p.contract_loader;
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
  const rows = db.prepare(isMaster(cfg) ? WEEKLY_SQL_MASTER : WEEKLY_SQL).all(sqlParams(month, year, cfg, releaseDays, prevReleaseDays));
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

// ── suggestions (shown on the tab; nothing changes until the admin applies them) ─────────────────────

const hhmmOf = (m) => { const x = ((Math.round(m) % 1440) + 1440) % 1440; return `${pad(Math.floor(x / 60))}:${pad(x % 60)}`; };
const median = (xs) => { const a = [...xs].sort((p, q) => p - q); const n = a.length; return n ? (n % 2 ? a[(n - 1) / 2] : (a[n / 2 - 1] + a[n / 2]) / 2) : null; };
const round30 = (m) => Math.round(m / 30) * 30;

/** Best-fitting day shift for a punch pattern: error = |start − median in| + |end − median out| (minutes). */
function fitShift(shifts, medIn, medOut) {
  let best = null;
  for (const sh of shifts) {
    const st = toMin(sh.start_time); const en = toMin(sh.end_time);
    if (st === null || en === null || en <= st || !(sh.duration_hours > 0) || sh.duration_hours > 14) continue;  // day shifts only
    const err = Math.abs(st - medIn) + Math.abs(en - medOut);
    if (!best || err < best.err) best = { id: sh.id, name: sh.name, code: sh.code, start: sh.start_time, end: sh.end_time, err };
  }
  return best;
}

/**
 * Suggested leave-outs and data fixes for the month. Each: { key, kind, code | department, title, evidence, action, can_apply }.
 *  stale_person        a standing person rule that changes nothing now (left / inactive / below every notice line in both
 *                      months) — apply removes it. Not raised for a loader of a piece-rate crew booked in another department.
 *  stale_department    a standing department rule with nobody working in it this month or last — apply removes it
 *  redundant_remeasure (master basis) a re-measure row with exactly the master's times — apply removes it
 *  loader_crew         a contract department (3+ people) that is ≥ 60% contract loaders and has no rule — apply marks it piece rate
 *  loader_outside_crew a person with the same loading designation as a ruled crew but booked elsewhere — apply leaves them out
 *  senior_hint         a person about to be deducted with gross ≥ senior_hint_gross — apply marks "senior staff — not assessed"
 *  master_fit          (master basis) late or early on most days and another shift fits the punches clearly better, or none
 *                      fits — apply leaves them out until the master is fixed (the rule is offered for removal once it fits)
 *  no_master           (master basis) worked days but no master shift — data fix only (already not assessed)
 * Dismissed keys (config.dismissed_suggestions) are not returned.
 */
function suggestions(db, month, year, cfg, byCode, act) {
  const t = cfg.thresholds; const out = [];
  const dismissed = cfg.dismissed_suggestions || {};
  const push = (sug) => { if (!dismissed[sug.key]) out.push(sug); };
  const people = [...byCode.values()];
  const sp = cfg.standing_people || {}; const sd = cfg.standing_departments || {};
  const sdUpper = new Set(Object.keys(sd).map((d) => d.toUpperCase()));
  const pats = cfg.loading_designation_patterns.map((x) => String(x).toUpperCase());
  const isLoaderDes = (des) => pats.some((x) => x && String(des || '').toUpperCase().includes(x));
  // "would this person matter" = would reach a notice line in this month or last, ignoring their standing rule
  const matters = (p) => [p.cur, p.prev].some((m) => m && ((p.loading ? 0 : m.lates) >= t.notice_late
    || (p.loading && p.group === 'Contract' && cfg.contract_loaders_early_exempt !== false ? 0 : (cfg.shift_fit === 'off' ? m.early_exits : m.early_short)) >= t.notice_early));

  // designations used by ruled crews (2+ people) — to spot a crew member booked in another department
  const crewDes = new Map();
  for (const p of people) {
    if (!p.cur || !sdUpper.has(String(p.department || '').toUpperCase()) || !isLoaderDes(p.designation)) continue;
    const k = String(p.designation || '').trim().toUpperCase(); const e = crewDes.get(k) || { n: 0, dept: p.department }; e.n += 1; crewDes.set(k, e);
  }
  const loaderOutside = (p) => {
    if (!isLoaderDes(p.designation) || sdUpper.has(String(p.department || '').toUpperCase())) return null;
    const e = crewDes.get(String(p.designation || '').trim().toUpperCase()); return e && e.n >= 2 ? e : null;
  };

  // master fit (also used to retire a rule created "until the master is fixed")
  const fit = new Map();
  if (isMaster(cfg)) {
    const shifts = db.prepare('SELECT id, name, code, start_time, end_time, duration_hours FROM shifts ORDER BY id').all();
    const emps = new Map(db.prepare('SELECT e.code, e.default_shift_id sid FROM employees e').all().map((r) => [String(r.code), r.sid]));
    const byId = new Map(shifts.map((sh) => [sh.id, sh]));
    const days = new Map();
    for (const r of db.prepare(MASTER_DAYS_SQL).all(sqlParams(month, year, cfg, [], []))) {
      const k = String(r.code); const a = days.get(k) || []; a.push(r); days.set(k, a);
    }
    for (const [code, rows] of days) {
      const ms = byId.get(emps.get(code));
      const medIn = median(rows.map((r) => r.inm)); const medOut = median(rows.map((r) => (r.otm < r.inm ? r.otm + 1440 : r.otm)));
      const best = fitShift(shifts, medIn, medOut);
      const dayRows = rows.filter((r) => r.mode === 'day');
      const lateShare = dayRows.length ? dayRows.filter((r) => r.lt >= t.late_min_minutes).length / dayRows.length : 0;
      const earlyShare = dayRows.length ? dayRows.filter((r) => r.er > t.early_min_exclusive).length / dayRows.length : 0;
      const masterErr = ms ? Math.abs(toMin(ms.start_time) - medIn) + Math.abs(toMin(ms.end_time) - medOut) : null;
      fit.set(code, { rows: rows.length, dayRows: dayRows.length, medIn, medOut, best, master: ms || null, masterErr, lateShare, earlyShare });
    }
  }
  const pattern = (f) => `in about ${hhmmOf(f.medIn)}, out about ${hhmmOf(f.medOut)} on ${f.rows} days`;
  // Shifts are compared by TIMES, not id (the master can hold two shifts with the same times under different names).
  const sameTimes = (b, m) => !!b && !!m && b.start === m.start_time && b.end === m.end_time;
  const betterFit = (f) => f.best && f.best.err <= 40 && !sameTimes(f.best, f.master) && f.best.err < f.masterErr;
  const noneFits = (f) => f.masterErr >= 90 && !(f.best && f.best.err <= 40);
  // a clear mismatch only: another shift fits within 40 min, or the master is 90+ min off and nothing fits.
  // A master that is roughly right with a late / early person is real lateness, not a set-up issue.
  // Only what is actually assessed for the person counts: no lates for loaders; no early exits for contract loaders or an
  // early-exit rule — a master "fix" for exits that are never counted would be noise.
  const assessed = (code) => {
    const p = byCode.get(code) || {}; const loader = isLoaderDes(p.designation);
    const contractLoader = loader && p.group === 'Contract' && cfg.contract_loaders_early_exempt !== false;
    return { late: !loader, early: !contractLoader && !(sp[code] && sp[code].rule === 'early_exempt') };
  };
  const misfit = (f, code) => {
    if (!(f && f.master && f.dayRows >= t.master_fit_min_days)) return false;
    const a = assessed(code);
    const off = (a.late && f.lateShare >= t.master_fit_share) || (a.early && f.earlyShare >= t.master_fit_share);
    return off && (betterFit(f) || noneFits(f));
  };

  // 1. stale person rules
  const status = new Map();
  const codes = Object.keys(sp);
  if (codes.length) {
    const st = db.prepare('SELECT status, date_of_exit FROM employees WHERE code = ? ORDER BY id LIMIT 1');
    for (const c of codes) status.set(c, st.get(c) || null);
  }
  for (const [code, rule] of Object.entries(sp)) {
    const p = byCode.get(code); const e = status.get(code);
    const left = !e || (e.status && !/^active$/i.test(e.status)) || !!(e && e.date_of_exit);
    const noWork = !p || (!p.cur && !p.prev);
    let why = null;
    if (left) why = 'no longer active in the employee master';
    else if (noWork) why = 'no worked days this month or last';
    else if (rule.source === 'master_fit') { const f = fit.get(code); if (f && !misfit(f, code)) why = 'the master shift now fits the punches'; }
    else if (!loaderOutside(p) && !matters(p)) why = 'without it they would not reach any list or notice this month or last';
    if (why) push({ key: `stale_person|${code}`, kind: 'stale_person', code, name: p?.name || null, department: p?.department || null,
      title: `Remove the standing rule for ${code}`, evidence: `${RULE_LABEL[rule.rule]} (“${rule.reason}”) — ${why}.`, action: 'Remove the rule', can_apply: true });
  }
  // 2. stale department rules
  for (const [dept, rule] of Object.entries(sd)) {
    const any = people.some((p) => String(p.department || '').toUpperCase() === dept.toUpperCase() && (p.cur || p.prev));
    if (!any) push({ key: `stale_department|${dept}`, kind: 'stale_department', department: dept, title: `Remove the rule for ${dept}`,
      evidence: `“${rule.reason}” — nobody in ${dept} worked this month or last.`, action: 'Remove the rule', can_apply: true });
  }
  // 3. redundant re-measure rows
  if (isMaster(cfg)) {
    for (const [code, rm] of Object.entries(cfg.remeasure || {})) {
      const f = fit.get(code); const ms = f?.master;
      const sh = ms || db.prepare('SELECT s.start_time, s.end_time FROM employees e JOIN shifts s ON s.id = e.default_shift_id WHERE e.code = ? ORDER BY e.id LIMIT 1').get(code);
      if (sh && sh.start_time === rm.start && sh.end_time === rm.end) push({ key: `redundant_remeasure|${code}`, kind: 'redundant_remeasure', code,
        name: byCode.get(code)?.name || null, title: `Remove the re-measure row for ${code}`,
        evidence: `It measures on ${rm.start}–${rm.end}, which is now the master shift; the master basis already does this.`, action: 'Remove the row', can_apply: true });
    }
  }
  // 4. loader crews without a rule
  const byDept = new Map();
  for (const p of people) { if (!p.cur) continue; const k = String(p.department || ''); const a = byDept.get(k) || []; a.push(p); byDept.set(k, a); }
  for (const [dept, ps] of byDept) {
    if (!dept || sdUpper.has(dept.toUpperCase()) || ps.length < 3) continue;
    const loaders = ps.filter((p) => p.group === 'Contract' && isLoaderDes(p.designation)).length;
    if (loaders / ps.length >= 0.6) push({ key: `loader_crew|${dept}`, kind: 'loader_crew', department: dept, title: `Mark ${dept} as a piece-rate crew`,
      evidence: `${loaders} of ${ps.length} people who worked this month are contract loaders.`, action: 'Mark piece rate — not assessed', can_apply: true,
      rule: { scope: 'department', rule: 'exclude', reason: 'Piece-rate loading crew' } });
  }
  // 5. a crew's loader booked in another department
  for (const p of people) {
    if (!p.cur || sp[p.code]) continue; const e = loaderOutside(p); if (!e) continue;
    push({ key: `loader_outside_crew|${p.code}`, kind: 'loader_outside_crew', code: p.code, name: p.name, department: p.department,
      title: `${p.code}: looks like a ${e.dept} loader booked in ${p.department || '(no department)'}`,
      evidence: `Designation “${p.designation}” is used by ${e.n} people of the ${e.dept} crew. Fix the department in the employee master; meanwhile leave out?`,
      action: 'Leave out (piece-rate crew)', can_apply: true, rule: { scope: 'person', rule: 'exclude', reason: `Loader of the ${e.dept} crew booked in ${p.department || 'another department'}` } });
  }
  // 6. senior hint
  for (const a of act.actionList) {
    if (a.action !== 'deduction' || sp[a.code]) continue;
    const p = byCode.get(a.code); if (!p || !(p.gross_salary >= t.senior_hint_gross)) continue;
    push({ key: `senior_hint|${a.code}`, kind: 'senior_hint', code: a.code, name: p.name, department: p.department,
      title: `${a.code} (${p.designation || 'no designation'}) is about to be deducted — senior staff?`,
      evidence: `Gross ₹${Math.round(p.gross_salary).toLocaleString('en-IN')} — at or above ₹${t.senior_hint_gross.toLocaleString('en-IN')}. If their timings are not a floor obligation, leave them out.`,
      action: 'Mark senior staff — not assessed', can_apply: true, rule: { scope: 'person', rule: 'exclude', reason: 'Senior staff' } });
  }
  // 7–8. master fit / no master (master basis)
  for (const [code, f] of fit) {
    const p = byCode.get(code); if (!p || sp[code] || cfg.excluded_departments.map((d) => d.toUpperCase()).includes(String(p.department || '').toUpperCase())) continue;
    if (!f.master) {
      if (f.rows < 3) continue;
      const fits = f.best && f.best.err <= 40;
      push({ key: `no_master|${code}`, kind: 'no_master', code, name: p.name, department: p.department, title: `${code} has no master shift`,
        evidence: `Punches: ${pattern(f)}. ${fits ? `${f.best.name} (${f.best.start}–${f.best.end}) fits.` : `No shift fits — create one of about ${hhmmOf(round30(f.medIn))}–${hhmmOf(round30(f.medOut))}.`} Not assessed until a master is set.`,
        action: 'Set the master in the employee profile', can_apply: false,
        proposed: fits ? { shift: f.best.name, start: f.best.start, end: f.best.end } : { create: `${hhmmOf(round30(f.medIn))}–${hhmmOf(round30(f.medOut))}` } });
      continue;
    }
    if (!misfit(f, code)) continue;
    const fits = betterFit(f);
    const what = assessed(code).late && f.lateShare >= t.master_fit_share ? `late on ${Math.round(f.lateShare * 100)}%` : `early on ${Math.round(f.earlyShare * 100)}%`;
    push({ key: `master_fit|${code}`, kind: 'master_fit', code, name: p.name, department: p.department,
      title: `${code}: master ${f.master.name} (${f.master.start_time}–${f.master.end_time}) doesn't fit the punches`,
      evidence: `Punches: ${pattern(f)} — ${what} of days on the master. ${fits ? `${f.best.name} (${f.best.start}–${f.best.end}) fits.` : `No existing shift fits — create one of about ${hhmmOf(round30(f.medIn))}–${hhmmOf(round30(f.medOut))}.`} Fix the master; meanwhile leave out?`,
      action: 'Leave out until the master is fixed', can_apply: true,
      proposed: fits ? { shift: f.best.name, start: f.best.start, end: f.best.end } : { create: `${hhmmOf(round30(f.medIn))}–${hhmmOf(round30(f.medOut))}` },
      rule: { scope: 'person', rule: 'exclude', reason: `Master shift doesn't fit the punches — fix in the employee master`, source: 'master_fit' } });
  }
  const order = ['senior_hint', 'master_fit', 'loader_outside_crew', 'loader_crew', 'no_master', 'redundant_remeasure', 'stale_person', 'stale_department'];
  return out.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || String(a.code || a.department).localeCompare(String(b.code || b.department)));
}

const RULE_LABEL = { exclude: 'Not assessed', early_exempt: 'Early exits not assessed', held: 'Held' };

/**
 * Pure: applies accepted / dismissed suggestions to a STORED config and returns the new stored config.
 * Unknown keys are reported, not applied. Older lists are folded into standing_* first (toStoredConfig).
 */
function applySuggestions(stored, list, { accept = [], dismiss = [], by = 'admin', at = new Date().toISOString() } = {}) {
  const c = toStoredConfig(JSON.parse(JSON.stringify(stored || {})));
  c.standing_people = c.standing_people || {}; c.standing_departments = c.standing_departments || {};
  c.remeasure = c.remeasure || {}; c.dismissed_suggestions = c.dismissed_suggestions || {};
  const byKey = new Map(list.map((s2) => [s2.key, s2]));
  const applied = []; const unknown = [];
  for (const key of accept) {
    const sg = byKey.get(key);
    if (!sg || !sg.can_apply) { unknown.push(key); continue; }
    if (sg.kind === 'stale_person') delete c.standing_people[sg.code];
    else if (sg.kind === 'stale_department') delete c.standing_departments[sg.department];
    else if (sg.kind === 'redundant_remeasure') delete c.remeasure[sg.code];
    else if (sg.rule && sg.rule.scope === 'department') c.standing_departments[sg.department] = { rule: sg.rule.rule, reason: sg.rule.reason, source: sg.kind, set_by: by, set_at: at };
    else if (sg.rule && sg.rule.scope === 'person') c.standing_people[sg.code] = { rule: sg.rule.rule, reason: sg.rule.reason, source: sg.kind, set_by: by, set_at: at };
    else { unknown.push(key); continue; }
    applied.push(key);
  }
  for (const key of dismiss) {
    if (!byKey.has(key)) { unknown.push(key); continue; }
    c.dismissed_suggestions[key] = { by, at }; applied.push(key);
  }
  if (!Object.keys(c.remeasure).length) delete c.remeasure;
  return { config: c, applied, unknown };
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
    criteria: { assessment_basis: cfg.assessment_basis, assess_fixed_miss_punch: cfg.assess_fixed_miss_punch !== false,
      thresholds: cfg.thresholds, stayed_late_mode: cfg.stayed_late_mode, early_exit_rule: cfg.early_exit_rule, shift_fit: cfg.shift_fit, late_full_hours: cfg.late_full_hours !== false, loading_designation_patterns: cfg.loading_designation_patterns, remeasure: cfg.remeasure || {} },
    releaseDaysDetected: detectReleaseDays(db, month, year, cfg),
    shiftIssues: isMaster(cfg) ? [] : detectShiftIssues(db, month, year).filter((r) => !cfg.excluded_codes.includes(r.code)
      && !cfg.excluded_departments.map((d) => d.toUpperCase()).includes(String(r.department || '').toUpperCase())),
    trend: { monthly, weekly }, departments, shiftCheck,
    people: peopleOut, doubleDefaulters, regular,
    actionList: act.actionList, earlyExitWarnings: act.earlyExitWarnings,
    actionTotals: { people: act.actionList.length, deduction_notes: ded.length, warning_notes: act.actionList.length - ded.length,
      deduction_days: ded.reduce((s, a) => s + a.deduction_days, 0), indicative_amount: ded.reduce((s, a) => s + a.indicative_amount, 0) },
    held: held.filter((p) => p.cur).map((p) => ({ code: p.code, name: p.name, department: p.department, late_days: p.cur.lates_counted, early_exits: p.cur.early_counted })),
    noticeLate: nt.noticeLate, noticeEarly: nt.noticeEarly,
    payrollChecks: payrollChecks(db, pm.month, pm.year), gatePassCount, gatePassExcused,
    assessment: { basis: cfg.assessment_basis, quality: assessmentQuality(db, month, year, cfg) },
    suggestions: suggestions(db, month, year, cfg, byCode, act),
    standing: { people: Object.entries(cfg.standing_people).map(([code, v]) => ({ code, ...v, name: byCode.get(code)?.name || null, department: byCode.get(code)?.department || null })),
      departments: Object.entries(cfg.standing_departments).map(([department, v]) => ({ department, ...v })) },
    overridesApplied: act.overridesApplied,
  };
}

module.exports = {
  DEFAULT_CONFIG, mergeConfig, validateConfig, validateOverrides, loadConfig,
  PERSON_MONTH_SQL, PERSON_MONTH_SQL_MASTER, WEEKLY_SQL, WEEKLY_SQL_MASTER, RELEASE_DAYS_SQL, RELEASE_DAYS_SQL_MASTER, MASTER_QUALITY_SQL,
  SHIFT_ISSUES_SQL, sqlParams, inlineParams, assessmentQuality,
  isHabitualEarly, shiftFitApplies, detectReleaseDays, detectShiftIssues, loadPersonMonth, remeasureRows, buildPeople, applyExclusions, classify, actions, notices,
  roundDeduction, optionCDays, prevMonth, daysInMonth, computeAttendanceReview,
  suggestions, applySuggestions, toStoredConfig, standingFrom, fitShift, MASTER_DAYS_SQL, LEGACY_REASON,
};
