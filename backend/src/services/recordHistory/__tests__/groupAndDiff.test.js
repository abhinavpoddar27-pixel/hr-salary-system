'use strict';

/**
 * Tests for piece #2 (groupAndDiff) — Record History Timeline.
 *
 * Behaviour-only assertions. Fixtures are plain JS objects (no DB).
 * Piece #1 (dispositionMap) is imported transitively via groupAndDiff
 * and treated as a black box — we assert against its real return shape.
 */

const { groupAndDiff } = require('../groupAndDiff');

const ACTOR = 'HR Operator';
const TIME_A = '2026-04-15 10:00:00';
const TIME_B = '2026-04-15 11:30:00';
const TIME_C = '2026-04-15 09:00:00';

function row(overrides) {
  return Object.assign(
    {
      id: 0,
      table_name: 'sales_employees',
      record_id: 198,
      action_type: 'update',
      field_name: 'headquarters',
      old_value: '',
      new_value: 'GHAZIABAD',
      changed_by: ACTOR,
      changed_at: TIME_A,
      stage: null,
      remark: null,
    },
    overrides
  );
}

describe('groupAndDiff', () => {
  // -----------------------------------------------------------------------
  describe('grouping + ordering', () => {
    test('returns [] for empty/null/undefined input', () => {
      expect(groupAndDiff([])).toEqual([]);
      expect(groupAndDiff(null)).toEqual([]);
      expect(groupAndDiff(undefined)).toEqual([]);
    });

    test('T7: cards ordered newest-first by MAX(group id) DESC (NOT by changed_at)', () => {
      // Three single-row groups (different record_ids → different tuples).
      const rows = [
        row({ id: 100, record_id: 1, changed_at: TIME_A, field_name: 'headquarters', new_value: 'A' }),
        row({ id: 200, record_id: 2, changed_at: TIME_B, field_name: 'headquarters', new_value: 'B' }),
        row({ id: 50,  record_id: 3, changed_at: TIME_C, field_name: 'headquarters', new_value: 'C' }),
      ];
      const cards = groupAndDiff(rows);
      expect(cards).toHaveLength(3);
      expect(cards.map((c) => c.id)).toEqual([200, 100, 50]);
    });

    test('grouping uses tuple (changed_by, table_name, record_id, changed_at); null record_id is a distinct value, not a singleton', () => {
      const rows = [
        // null record_id, same actor/table/changed_at → one card
        row({ id: 1, table_name: 'policy_config', record_id: null, action_type: 'policy_change', field_name: 'sales_leniency',
              old_value: '2', new_value: '3', changed_at: TIME_A }),
        row({ id: 2, table_name: 'policy_config', record_id: null, action_type: 'policy_change', field_name: 'sales_leniency',
              old_value: '3', new_value: '4', changed_at: TIME_A }),
        // null record_id but different changed_at → second card
        row({ id: 3, table_name: 'policy_config', record_id: null, action_type: 'policy_change', field_name: 'sales_leniency',
              old_value: '4', new_value: '5', changed_at: TIME_B }),
      ];
      const cards = groupAndDiff(rows);
      expect(cards).toHaveLength(2);
      // Card with TIME_B has id 3; card with TIME_A has ids 1,2 (min=1)
      const ids = cards.map((c) => c.id).sort((a, b) => a - b);
      expect(ids).toEqual([1, 3]);
    });
  });

  // -----------------------------------------------------------------------
  describe('T1: sales_employees 6-field onboarding (PII-mixed, set case)', () => {
    test('one card, 6 FieldDiffs sorted by id ASC, PII masked, clear fields rendered, all diffCase=set', () => {
      const fields = [
        ['headquarters',      'GHAZIABAD'],
        ['state',             'UTTAR PRADESH'],
        ['designation',       'SALES OFFICER'],
        ['reporting_manager', 'AMIT KUMAR'],
        ['personal_contact',  '9876543210'],
        ['dob',               '1990-01-15'],
      ];
      const rows = fields.map(([fn, nv], i) =>
        row({
          id: 10 + i,
          field_name: fn,
          old_value: '',
          new_value: nv,
          action_type: 'update',
        })
      );

      const cards = groupAndDiff(rows);
      expect(cards).toHaveLength(1);
      const card = cards[0];

      // Six fields, sorted by id ASC
      expect(card.fields).toHaveLength(6);
      expect(card.fields.map((f) => f.id)).toEqual([10, 11, 12, 13, 14, 15]);

      // All 'set' case (old_value === '')
      card.fields.forEach((f) => expect(f.diffCase).toBe('set'));

      // PII fields: masked=true, value redacted, "(set)" suffix
      const pc = card.fields.find((f) => f.field_name === 'personal_contact');
      const dob = card.fields.find((f) => f.field_name === 'dob');
      expect(pc.masked).toBe(true);
      expect(pc.rendered).not.toContain('9876543210');
      expect(pc.rendered).toMatch(/\(set\)/);
      expect(dob.masked).toBe(true);
      expect(dob.rendered).not.toContain('1990-01-15');
      expect(dob.rendered).toMatch(/\(set\)/);

      // Clear fields: masked=false, value visible, "set to" present
      const hq = card.fields.find((f) => f.field_name === 'headquarters');
      const st = card.fields.find((f) => f.field_name === 'state');
      expect(hq.masked).toBe(false);
      expect(hq.rendered).toContain('GHAZIABAD');
      expect(hq.rendered).toMatch(/set to/);
      expect(st.masked).toBe(false);
      expect(st.rendered).toContain('UTTAR PRADESH');

      // Card-level checks
      expect(card.category).toBe('human_change');
      expect(card.severity).toBe('normal');
      expect(card.isNoop).toBe(false);
      expect(card.changed_by).toBe(ACTOR);
      expect(card.table_name).toBe('sales_employees');
      expect(card.record_id).toBe(198);
    });
  });

  // -----------------------------------------------------------------------
  describe('T2: Stage-5 attendance group — human + system riders', () => {
    test('one card; category=human_change; riders keep system_write category; label from human; severity normal', () => {
      const tbl = 'attendance_processed';
      const rid = 'EMP123-2026-04-15';
      const at = '2026-04-15 18:00:00';
      const rows = [
        // human-change fields (first by id ASC)
        row({ id: 501, table_name: tbl, record_id: rid,
              action_type: 'finalise', field_name: 'out_time_final',
              old_value: '', new_value: '20:15:00',
              changed_at: at, remark: 'Manual correction' }),
        row({ id: 502, table_name: tbl, record_id: rid,
              action_type: 'finalise', field_name: 'status_final',
              old_value: 'A', new_value: 'P',
              changed_at: at, remark: 'Manual correction' }),
        // system riders (later by id; disposition stays system_write)
        row({ id: 503, table_name: tbl, record_id: rid,
              action_type: 'recompute', field_name: 'actual_hours',
              old_value: '0', new_value: '8',
              changed_at: at }),
        row({ id: 504, table_name: tbl, record_id: rid,
              action_type: 'recompute', field_name: 'stage_5_done',
              old_value: '', new_value: '1',
              changed_at: at }),
      ];

      const cards = groupAndDiff(rows);
      expect(cards).toHaveLength(1);
      const card = cards[0];

      // Card-level
      expect(card.category).toBe('human_change');
      expect(card.severity).toBe('normal'); // max(normal, normal, low, low)
      expect(card.subtitle).toBe('Manual correction');

      // Label comes from a human field (first by id ASC is out_time_final)
      expect(card.label).toBe('Out-time finalised (Stage 5)');

      // System riders KEEP their per-field category (UI will grey them)
      const ah = card.fields.find((f) => f.field_name === 'actual_hours');
      const sd = card.fields.find((f) => f.field_name === 'stage_5_done');
      expect(ah.disposition.category).toBe('system_write');
      expect(sd.disposition.category).toBe('system_write');
      expect(ah.disposition.severity).toBe('low');
      expect(sd.disposition.severity).toBe('low');

      // Human fields keep their category
      const ot = card.fields.find((f) => f.field_name === 'out_time_final');
      const sf = card.fields.find((f) => f.field_name === 'status_final');
      expect(ot.disposition.category).toBe('human_change');
      expect(sf.disposition.category).toBe('human_change');
    });
  });

  // -----------------------------------------------------------------------
  describe('T3: no-op burst (string identity)', () => {
    test('two consecutive cards (same actor/record, different changed_at) with old===new fields → both isNoop=true', () => {
      const rid = 'rec-77';
      const tbl = 'sales_employees';
      const rows = [
        // Card A: TIME_A
        row({ id: 800, table_name: tbl, record_id: rid, action_type: 'update',
              field_name: 'state', old_value: 'UP', new_value: 'UP',
              changed_at: TIME_A }),
        row({ id: 801, table_name: tbl, record_id: rid, action_type: 'update',
              field_name: 'headquarters', old_value: 'GHAZIABAD', new_value: 'GHAZIABAD',
              changed_at: TIME_A }),
        // Card B: TIME_B
        row({ id: 900, table_name: tbl, record_id: rid, action_type: 'update',
              field_name: 'state', old_value: 'UP', new_value: 'UP',
              changed_at: TIME_B }),
      ];
      const cards = groupAndDiff(rows);
      expect(cards).toHaveLength(2);
      cards.forEach((c) => expect(c.isNoop).toBe(true));
      // Every field diffCase should be 'noop'
      cards.forEach((c) => c.fields.forEach((f) => expect(f.diffCase).toBe('noop')));
    });
  });

  // -----------------------------------------------------------------------
  describe('T4: JSON diff — only differing keys emitted', () => {
    test('manual_override row with JSON old/new emits only the changed key', () => {
      const oldObj = { incentive: 0, advance: 0, other: 0 };
      const newObj = { incentive: 1500, advance: 0, other: 0 };
      const rows = [row({
        id: 1100,
        table_name: 'sales_salary_computations',
        record_id: 'comp-1',
        action_type: 'manual_override',
        field_name: 'inputs',
        old_value: JSON.stringify(oldObj),
        new_value: JSON.stringify(newObj),
        changed_at: TIME_A,
      })];
      const cards = groupAndDiff(rows);
      expect(cards).toHaveLength(1);
      const f = cards[0].fields[0];
      expect(f.diffCase).toBe('json');
      expect(f.rendered).toContain('incentive');
      expect(f.rendered).toContain('0 → 1500');
      expect(f.rendered).not.toContain('advance');
      expect(f.rendered).not.toContain('other');
    });

    test('content-driven (NOT action-driven): JSON-parseable values diff as JSON even under an unexpected action_type', () => {
      const oldObj = { a: 1, b: 2 };
      const newObj = { a: 1, b: 3 };
      const rows = [row({
        id: 1101,
        table_name: 'wholly_unexpected_table',     // not in any disposition map
        record_id: 'x',
        action_type: 'mystery_action',             // not in JSON-payload whitelist
        field_name: 'data',
        old_value: JSON.stringify(oldObj),
        new_value: JSON.stringify(newObj),
        changed_at: TIME_A,
      })];
      const f = groupAndDiff(rows)[0].fields[0];
      expect(f.diffCase).toBe('json');
      expect(f.rendered).toContain('b: 2 → 3');
      // Unchanged key 'a' must NOT be emitted as a diff entry.
      // Count " → " arrows: exactly 1 means only one key was emitted.
      const arrows = f.rendered.split(' → ').length - 1;
      expect(arrows).toBe(1);
      expect(f.rendered).not.toContain('a: 1');
    });
  });

  // -----------------------------------------------------------------------
  describe('T5: parse_fallback — malformed JSON-shaped values do not throw', () => {
    test('malformed JSON old/new falls back to truncated raw scalar', () => {
      const rows = [row({
        id: 1200,
        table_name: 'sales_salary_computations',
        record_id: 'comp-2',
        action_type: 'manual_override',
        field_name: 'broken_payload',
        old_value: '{not json',
        new_value: '{also not json',
        changed_at: TIME_A,
      })];
      expect(() => groupAndDiff(rows)).not.toThrow();
      const f = groupAndDiff(rows)[0].fields[0];
      expect(f.diffCase).toBe('parse_fallback');
      expect(typeof f.rendered).toBe('string');
      expect(f.rendered.length).toBeGreaterThan(0);
    });

    test('long malformed payload is truncated at 120 + …', () => {
      const huge = '{' + 'x'.repeat(500);
      const rows = [row({
        id: 1201,
        table_name: 'sales_salary_computations',
        record_id: 'comp-2b',
        action_type: 'manual_override',
        field_name: 'huge_blob',
        old_value: huge,
        new_value: huge + 'y',
        changed_at: TIME_A,
      })];
      const rendered = groupAndDiff(rows)[0].fields[0].rendered;
      expect(rendered.endsWith('…')).toBe(true);
      expect(rendered.length).toBe(121); // 120 chars + 1-char ellipsis
    });
  });

  // -----------------------------------------------------------------------
  describe('T6: value-regex backstop — 22970 carve-out + Aadhaar/PAN masking', () => {
    test('5-digit employee code "22970" SURVIVES; 12-digit Aadhaar + PAN ARE masked in the SAME string', () => {
      const rows = [row({
        id: 1300,
        table_name: 'attendance_processed',
        record_id: 'EMP-22970-2026-04-15',
        action_type: 'correct',
        field_name: 'correction_remark',
        old_value: '',
        new_value: 'applied to 22970 PAN ABCDE1234F Aadhaar 123456789012',
        changed_at: TIME_A,
      })];
      const rendered = groupAndDiff(rows)[0].fields[0].rendered;
      expect(rendered).toContain('22970');           // 5-digit employee code SURVIVES
      expect(rendered).not.toContain('ABCDE1234F');   // PAN masked
      expect(rendered).not.toContain('123456789012'); // 12-digit Aadhaar masked
    });

    test('field-name PII redaction precedes value rendering (value never leaked)', () => {
      const rows = [row({
        id: 1301,
        table_name: 'sales_employees',
        record_id: 555,
        action_type: 'update',
        field_name: 'personal_contact',
        old_value: '',
        new_value: '9999988888',
        changed_at: TIME_A,
      })];
      const f = groupAndDiff(rows)[0].fields[0];
      expect(f.masked).toBe(true);
      expect(f.rendered).not.toContain('9999988888');
      expect(f.rendered).toMatch(/\(set\)/);
    });

    test('5-digit numeric runs are NEVER masked (no ambiguity with employee codes)', () => {
      const rows = [row({
        id: 1302,
        table_name: 'attendance_processed',
        record_id: 'EMP-11111-2026-04-15',
        action_type: 'correct',
        field_name: 'correction_remark',
        old_value: '',
        new_value: 'employee codes 12345 67890 22970 must all survive',
        changed_at: TIME_A,
      })];
      const rendered = groupAndDiff(rows)[0].fields[0].rendered;
      ['12345', '67890', '22970'].forEach((code) => {
        expect(rendered).toContain(code);
      });
    });

    test('account-shape (9+ digits) IS masked but 8-digit and lower are NOT', () => {
      const rows = [row({
        id: 1303,
        table_name: 'attendance_processed',
        record_id: 'EMP-x',
        action_type: 'correct',
        field_name: 'correction_remark',
        old_value: '',
        new_value: 'acct 123456789 vs short 12345678 vs code 22970',
        changed_at: TIME_A,
      })];
      const rendered = groupAndDiff(rows)[0].fields[0].rendered;
      expect(rendered).not.toContain('123456789');   // 9-digit masked
      expect(rendered).toContain('12345678');        // 8-digit survives
      expect(rendered).toContain('22970');           // 5-digit survives
    });
  });

  // -----------------------------------------------------------------------
  describe('severity aggregation (category from dominant human, severity from MAX)', () => {
    test('T8: a high human field + a normal flagged rider → card.severity=high, category=human_change', () => {
      const rid = 'sc-99';
      const at = '2026-04-15 13:00:00';
      const rows = [
        // salary_held: human_change HIGH (TRIPLE_MAP hit)
        row({ id: 2001, table_name: 'salary_computations', record_id: rid,
              action_type: null, field_name: 'salary_held',
              old_value: '0', new_value: '1', changed_at: at }),
        // unknown field on salary_computations → unknown-fallback (human, normal, flagged)
        row({ id: 2002, table_name: 'salary_computations', record_id: rid,
              action_type: null, field_name: 'mystery_field',
              old_value: '', new_value: 'x', changed_at: at }),
      ];
      const card = groupAndDiff(rows)[0];

      // category from dominant human → human_change
      expect(card.category).toBe('human_change');
      // severity from MAX (high > normal) → high
      expect(card.severity).toBe('high');
      // label from FIRST human field by id ASC → salary_held's label
      expect(card.label).toBe('Salary hold toggled');
      // flagged rider lifts card-level flag
      expect(card.flaggedForReview).toBe(true);

      // Per-field invariants
      const salaryHeld = card.fields.find((f) => f.field_name === 'salary_held');
      expect(salaryHeld.disposition.severity).toBe('high');
      const mystery = card.fields.find((f) => f.field_name === 'mystery_field');
      expect(mystery.disposition.flaggedForReview).toBe(true);
    });

    test('severity stays low when all fields are system_write low', () => {
      const rid = 'EMP-only-system';
      const at = '2026-04-15 14:00:00';
      const rows = [
        row({ id: 2100, table_name: 'attendance_processed', record_id: rid,
              action_type: 'recompute', field_name: 'actual_hours',
              old_value: '0', new_value: '8', changed_at: at }),
        row({ id: 2101, table_name: 'attendance_processed', record_id: rid,
              action_type: 'recompute', field_name: 'stage_5_done',
              old_value: '', new_value: '1', changed_at: at }),
      ];
      const card = groupAndDiff(rows)[0];
      expect(card.severity).toBe('low');
      expect(card.category).toBe('system_write');
    });
  });

  // -----------------------------------------------------------------------
  describe('semantic-JSON no-op (per user instruction 3)', () => {
    test('JSON old/new that parse to deepEqual values → diffCase noop, isNoop=true (NOT just string identity)', () => {
      // Different string forms (key order + whitespace) but identical content.
      const rows = [row({
        id: 3000,
        table_name: 'sales_salary_computations',
        record_id: 'sc-noop',
        action_type: 'manual_override',
        field_name: 'inputs',
        old_value: '{"a":1,"b":2}',
        new_value: ' { "b": 2 , "a": 1 } ',
        changed_at: TIME_A,
      })];
      const card = groupAndDiff(rows)[0];
      // The two strings are NOT identical character-by-character …
      expect(rows[0].old_value === rows[0].new_value).toBe(false);
      // … but they're semantically equal, so noop.
      expect(card.fields[0].diffCase).toBe('noop');
      expect(card.isNoop).toBe(true);
    });

    test('JSON old/new with array order change but equal arrays → noop', () => {
      const rows = [row({
        id: 3001,
        table_name: 'sales_salary_computations',
        record_id: 'sc-arr',
        action_type: 'manual_override',
        field_name: 'inputs',
        old_value: '[1,2,3]',
        new_value: '[1,2,3]',
        changed_at: TIME_A,
      })];
      expect(groupAndDiff(rows)[0].fields[0].diffCase).toBe('noop');
    });
  });

  // -----------------------------------------------------------------------
  describe('flaggedForReview propagation', () => {
    test('an unknown-table row flags the entire card for review', () => {
      const rows = [row({
        id: 4000,
        table_name: 'loyalty_program', // not in any disposition map
        record_id: 'lp-1',
        action_type: 'redeem',
        field_name: 'points',
        old_value: '100',
        new_value: '50',
        changed_at: TIME_A,
      })];
      const card = groupAndDiff(rows)[0];
      expect(card.fields[0].disposition.flaggedForReview).toBe(true);
      expect(card.flaggedForReview).toBe(true);
    });

    test('flaggedForReview is ABSENT (not false) when no field is flagged', () => {
      const rows = [row({
        id: 4001,
        table_name: 'sales_employees',
        record_id: 100,
        action_type: 'update',
        field_name: 'state',
        old_value: 'UP',
        new_value: 'MP',
        changed_at: TIME_A,
      })];
      const card = groupAndDiff(rows)[0];
      expect(card).not.toHaveProperty('flaggedForReview'); // matches piece #1 convention
    });
  });

  // -----------------------------------------------------------------------
  describe('subtitle (remark) — first non-empty by id ASC, never concatenated', () => {
    test('first non-empty remark wins; later remarks are ignored', () => {
      const rows = [
        row({ id: 5000, field_name: 'state', new_value: 'MP', changed_at: TIME_A, remark: null }),
        row({ id: 5001, field_name: 'headquarters', new_value: 'BHOPAL', changed_at: TIME_A, remark: 'first remark' }),
        row({ id: 5002, field_name: 'designation', new_value: 'SR. SO', changed_at: TIME_A, remark: 'second remark' }),
      ];
      const card = groupAndDiff(rows)[0];
      expect(card.subtitle).toBe('first remark');
    });

    test('subtitle has the value-regex PII backstop applied (PAN + Aadhaar masked, 22970 survives)', () => {
      const rows = [row({
        id: 5050,
        table_name: 'attendance_processed',
        record_id: 'EMP-22970-2026-04-15',
        action_type: 'finalise',
        field_name: 'out_time_final',
        old_value: '',
        new_value: '20:15',
        changed_at: TIME_A,
        remark: 'applied to 22970, PAN ABCDE1234F, Aadhaar 123456789012',
      })];
      const subtitle = groupAndDiff(rows)[0].subtitle;
      expect(subtitle).toContain('22970');           // employee code survives
      expect(subtitle).not.toContain('ABCDE1234F');   // PAN masked
      expect(subtitle).not.toContain('123456789012'); // Aadhaar masked
    });

    test('subtitle is null when no row carries a non-empty remark', () => {
      const rows = [
        row({ id: 5100, field_name: 'state', new_value: 'MP', changed_at: TIME_A, remark: '' }),
        row({ id: 5101, field_name: 'headquarters', new_value: 'BHOPAL', changed_at: TIME_A, remark: null }),
      ];
      const card = groupAndDiff(rows)[0];
      expect(card.subtitle).toBeNull();
    });
  });
});
