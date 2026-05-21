'use strict';

/**
 * Group + diff for Record History Timeline (Design C, v3) — piece #2 of 5.
 *
 * Pure function. No I/O, no DB. Consumes raw audit_log rows, returns logical-action
 * Cards (newest-first by MAX(group id) DESC).
 *
 * Resolution order INSIDE diffField (§5/§7):
 *   1. Both old + new parse as JSON object/array → JSON diff
 *        - emit ONLY differing keys (deepEqual)
 *        - empty diff set === semantic JSON noop
 *   2. One side LOOKS JSON-ish but throws → parse_fallback (truncated)
 *   3. Scalar:
 *        - oldStr === newStr → noop
 *        - oldStr === '' (or null) → 'set' (onboarding / first-fill)
 *        - else → scalar
 *
 * Card aggregation (§4):
 *   - Group key: tuple (changed_by, table_name, record_id, changed_at).
 *     null is a distinct value; do NOT special-case it.
 *   - Within a card: fields sorted by id ASC.
 *   - Across cards: sorted by MAX(group id) DESC. NOT by changed_at (second-granularity ties).
 *   - category: 'human_change' if ANY field is human; else fields' shared category.
 *   - label: from FIRST human field by id ASC, falling back to first meaningful field.
 *   - severity: MAX across all field severities (low < normal < high).
 *     Note: category/label come from dominant human field, severity comes from max.
 *     They are computed independently — a high salary_held alongside lower-severity
 *     riders yields category='human_change' AND severity='high'.
 *   - subtitle: first non-empty remark by id ASC (NOT concatenated).
 *   - isNoop: true iff every field is diffCase 'noop' (string or semantic-JSON).
 *   - flaggedForReview: true iff ANY field's disposition was flagged. Present-or-absent.
 */

const { classifyDisposition } = require('./dispositionMap');

const TRUNCATE_LIMIT = 120;
const TRUNCATE_MARKER = '…';
const MASK = '•••••••';

// Field-name PII redaction set (case-insensitive substring).
const PII_FIELD_PATTERNS = [
  /aadhaar/i,
  /pan/i,
  /account_no/i,
  /account_number/i,
  /bank_account/i,
  /ifsc/i,
  /personal_contact/i,
  /contact/i,
  /phone/i,
  /mobile/i,
  /dob/i,
  /address/i,
];

// Value-regex backstop. CRITICAL: \b\d{9,}\b — 9+ digits ONLY.
// 5-digit employee codes like "22970" must survive. The 9+ floor protects them.
// 12-digit Aadhaar is caught by the 9+ rule; no separate regex needed.
const VALUE_MASKS = [
  /\b\d{9,}\b/g,                  // bank account + Aadhaar (12+) shape
  /\b[A-Z]{5}[0-9]{4}[A-Z]\b/g,   // PAN shape
];

const SEVERITY_RANK = { low: 0, normal: 1, high: 2 };

function isPiiField(fieldName) {
  if (!fieldName || typeof fieldName !== 'string') return false;
  return PII_FIELD_PATTERNS.some((re) => re.test(fieldName));
}

function applyValueMasks(str) {
  if (typeof str !== 'string') return str;
  let out = str;
  for (const re of VALUE_MASKS) {
    out = out.replace(re, MASK);
  }
  return out;
}

function truncate(str) {
  if (typeof str !== 'string') return str;
  if (str.length <= TRUNCATE_LIMIT) return str;
  return str.slice(0, TRUNCATE_LIMIT) + TRUNCATE_MARKER;
}

// Try parsing as a JSON OBJECT or ARRAY only. Bare strings/numbers/null are
// NOT considered "JSON" for the purposes of structured diff — they go through
// the scalar path instead.
function tryParseJsonObjectOrArray(value) {
  if (typeof value !== 'string') {
    return { ok: false, errored: false, looksJson: false };
  }
  const trimmed = value.trim();
  if (!trimmed) return { ok: false, errored: false, looksJson: false };
  const first = trimmed[0];
  const looksJson = first === '{' || first === '[';
  if (!looksJson) return { ok: false, errored: false, looksJson: false };
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed === null || typeof parsed !== 'object') {
      return { ok: false, errored: false, looksJson: true };
    }
    return { ok: true, errored: false, looksJson: true, value: parsed };
  } catch (_) {
    return { ok: false, errored: true, looksJson: true };
  }
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return false;
  if (a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
    if (!deepEqual(a[k], b[k])) return false;
  }
  return true;
}

function jsonChangedKeys(oldObj, newObj) {
  const keys = new Set([
    ...Object.keys(oldObj || {}),
    ...Object.keys(newObj || {}),
  ]);
  const diffs = [];
  for (const k of keys) {
    const oldV = oldObj ? oldObj[k] : undefined;
    const newV = newObj ? newObj[k] : undefined;
    if (!deepEqual(oldV, newV)) {
      diffs.push({ key: k, oldVal: oldV, newVal: newV });
    }
  }
  return diffs;
}

function renderJsonValue(v) {
  if (v === undefined) return '(unset)';
  if (v === null) return 'null';
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v);
  } catch (_) {
    return String(v);
  }
}

function diffField(row) {
  const fieldName = row.field_name || '';
  const masked = isPiiField(fieldName);

  // Normalize null/undefined to '' for string operations. SQLite TEXT NULL
  // arrives as null in better-sqlite3, but in JS we treat empty/null as
  // semantically "no prior value" for the 'set' detection.
  const oldStr = (row.old_value == null) ? '' : String(row.old_value);
  const newStr = (row.new_value == null) ? '' : String(row.new_value);

  const oldP = tryParseJsonObjectOrArray(oldStr);
  const newP = tryParseJsonObjectOrArray(newStr);

  // 1. Both sides parsed as JSON object/array → JSON-mode diff
  if (oldP.ok && newP.ok) {
    const diffs = jsonChangedKeys(oldP.value, newP.value);
    if (diffs.length === 0) {
      return {
        diffCase: 'noop',
        rendered: masked
          ? `${fieldName}: ${MASK} (no change)`
          : `${fieldName}: no change`,
        masked,
      };
    }
    if (masked) {
      return {
        diffCase: 'json',
        rendered: `${fieldName}: ${MASK} (changed)`,
        masked: true,
      };
    }
    const parts = diffs.map(({ key, oldVal, newVal }) =>
      `${key}: ${renderJsonValue(oldVal)} → ${renderJsonValue(newVal)}`
    );
    return {
      diffCase: 'json',
      rendered: truncate(applyValueMasks(`${fieldName}: ${parts.join(', ')}`)),
      masked: false,
    };
  }

  // 2. One side LOOKS JSON-ish but failed to parse → parse_fallback
  if ((oldP.looksJson && oldP.errored) || (newP.looksJson && newP.errored)) {
    if (masked) {
      return {
        diffCase: 'parse_fallback',
        rendered: `${fieldName}: ${MASK} (unparseable)`,
        masked: true,
      };
    }
    const display = newStr || oldStr;
    return {
      diffCase: 'parse_fallback',
      rendered: truncate(applyValueMasks(`${fieldName}: ${display}`)),
      masked: false,
    };
  }

  // 3. Scalar paths
  if (oldStr === newStr) {
    return {
      diffCase: 'noop',
      rendered: masked
        ? `${fieldName}: ${MASK} (no change)`
        : `${fieldName}: no change`,
      masked,
    };
  }
  if (oldStr === '') {
    if (masked) {
      return {
        diffCase: 'set',
        rendered: `${fieldName}: ${MASK} (set)`,
        masked: true,
      };
    }
    return {
      diffCase: 'set',
      rendered: truncate(applyValueMasks(`${fieldName}: set to ${newStr}`)),
      masked: false,
    };
  }
  if (masked) {
    return {
      diffCase: 'scalar',
      rendered: `${fieldName}: ${MASK} (changed)`,
      masked: true,
    };
  }
  return {
    diffCase: 'scalar',
    rendered: truncate(applyValueMasks(`${fieldName}: ${oldStr} → ${newStr}`)),
    masked: false,
  };
}

function groupKey(row) {
  // Tuple (changed_by, table_name, record_id, changed_at). JSON-encoded so
  // null vs string '' vs missing all key distinctly.
  return JSON.stringify([
    row.changed_by === undefined ? null : row.changed_by,
    row.table_name === undefined ? null : row.table_name,
    row.record_id === undefined ? null : row.record_id,
    row.changed_at === undefined ? null : row.changed_at,
  ]);
}

function groupAndDiff(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return [];

  const groups = new Map();
  for (const row of rows) {
    const key = groupKey(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  const cards = [];
  for (const groupRows of groups.values()) {
    groupRows.sort((a, b) => (a.id || 0) - (b.id || 0));

    const fields = [];
    let cardSeverity = 'low';
    let cardFlagged = false;
    let firstHumanLabel = null;
    let firstMeaningfulLabel = null;
    let subtitle = null;

    for (const row of groupRows) {
      const disposition = classifyDisposition(row);
      const diff = diffField(row);

      fields.push({
        id: row.id,
        field_name: row.field_name,
        disposition,
        diffCase: diff.diffCase,
        rendered: diff.rendered,
        masked: diff.masked,
      });

      if (disposition.flaggedForReview) cardFlagged = true;
      if (SEVERITY_RANK[disposition.severity] > SEVERITY_RANK[cardSeverity]) {
        cardSeverity = disposition.severity;
      }
      if (disposition.category === 'human_change' && firstHumanLabel === null) {
        firstHumanLabel = disposition.label;
      }
      if (disposition.category !== 'excluded' && firstMeaningfulLabel === null) {
        firstMeaningfulLabel = disposition.label;
      }
      if (subtitle === null && row.remark && String(row.remark).trim() !== '') {
        // Subtitle is user-facing; apply the value-regex PII backstop here too.
        // 5-digit employee codes (e.g. "22970") still survive — the 9+-digit floor protects them.
        subtitle = applyValueMasks(String(row.remark));
      }
    }

    const hasHuman = fields.some((f) => f.disposition.category === 'human_change');
    const cardCategory = hasHuman
      ? 'human_change'
      : fields[0].disposition.category;
    const cardLabel = hasHuman
      ? (firstHumanLabel || firstMeaningfulLabel || fields[0].disposition.label)
      : (firstMeaningfulLabel || fields[0].disposition.label);

    const allNoop = fields.every((f) => f.diffCase === 'noop');

    const ids = groupRows.map((r) => r.id || 0);
    const minId = Math.min(...ids);
    const maxId = Math.max(...ids);
    const firstRow = groupRows[0];

    const card = {
      id: minId,
      _maxId: maxId,
      changed_by: firstRow.changed_by == null ? null : firstRow.changed_by,
      table_name: firstRow.table_name == null ? null : firstRow.table_name,
      record_id: firstRow.record_id == null ? null : firstRow.record_id,
      changed_at: firstRow.changed_at == null ? null : firstRow.changed_at,
      category: cardCategory,
      label: cardLabel,
      severity: cardSeverity,
      subtitle,
      isNoop: allNoop,
      fields,
    };
    if (cardFlagged) card.flaggedForReview = true;

    cards.push(card);
  }

  cards.sort((a, b) => b._maxId - a._maxId);
  return cards.map(({ _maxId, ...rest }) => rest);
}

module.exports = { groupAndDiff };
