#!/usr/bin/env node
/**
 * Synthetic unit test for normalizeCompany() — Phase 3a + Phase 1.5.
 *
 * Phase 1.5 (May 2026): the function was relaxed so master-data debt
 * (~149 active employees with non-canonical employees.company) no longer
 * throws. Instead, the function consults an existing salary_computations
 * row for (employee_code, month, year) and reuses its company tag, or
 * defaults to ''. The schema's UNIQUE(employee_code, month, year) is the
 * identity; the company column is metadata. Typo protection is preserved
 * for inputs that are neither canonical nor a known bad tag.
 *
 * No real DB. No npm install needed. salaryComputation.js has no top-level
 * external requires (all are inline inside other functions); normalizeCompany
 * itself only uses CANONICAL_COMPANIES, KNOWN_BAD_TAGS, and db.prepare().get().
 *
 * Run:    node scripts/test-normalize-company.js
 * Exit:   0 if all 11 cases pass, 1 otherwise.
 */

const path = require('path');
const { normalizeCompany } = require(
  path.join(__dirname, '..', 'backend', 'src', 'services', 'salaryComputation')
);

// ── Mock factory ──
// Mimics better-sqlite3's `db.prepare(sql).get(params...)` API surface.
// Phase 1.5: the function makes TWO different SELECTs (employees vs
// salary_computations), so the mock dispatches by SQL substring.
//   masterCompany  controls the employees lookup result:
//                  string         → { company: <string> }
//                  null/undefined → undefined (no employee row)
//   existingRow    controls the salary_computations lookup result:
//                  string         → { company: <string> }
//                  null/undefined → undefined (no existing row)
const mockDb = (masterCompany, existingRow) => ({
  prepare: (sql) => ({
    get: () => {
      if (sql.includes('FROM employees')) {
        return (masterCompany !== null && masterCompany !== undefined)
          ? { company: masterCompany }
          : undefined;
      }
      if (sql.includes('FROM salary_computations')) {
        return (existingRow !== null && existingRow !== undefined)
          ? { company: existingRow }
          : undefined;
      }
      return undefined;
    }
  })
});

let passed = 0;
let failed = 0;

function pass(label) {
  console.log(`  PASS  ${label}`);
  passed++;
}

function fail(label, expected, actual) {
  console.log(`  FAIL  ${label}`);
  console.log(`        expected: ${expected}`);
  console.log(`        actual:   ${actual}`);
  failed++;
}

function expectReturn(label, fn, expected) {
  let actual;
  try {
    actual = fn();
  } catch (e) {
    fail(label, `return "${expected}"`, `THREW: ${e.message}`);
    return;
  }
  if (actual === expected) pass(label);
  else fail(label, `"${expected}"`, `"${actual}"`);
}

function expectThrow(label, fn, msgSubstrings) {
  let threw = false;
  let msg = '';
  try {
    fn();
  } catch (e) {
    threw = true;
    msg = e.message;
  }
  if (!threw) {
    fail(label, `throw containing ${JSON.stringify(msgSubstrings)}`, 'returned without throwing');
    return;
  }
  const missing = msgSubstrings.filter(s => !msg.includes(s));
  if (missing.length === 0) pass(label);
  else fail(label, `throw containing ${JSON.stringify(missing)} (missing: ${JSON.stringify(missing)})`, `threw: ${msg}`);
}

console.log('normalizeCompany() — Phase 3a + Phase 1.5 synthetic unit test');
console.log('==============================================================\n');

// ── Cases 1-8: existing behavior (signatures updated to pass month/year) ──

// Case 1: canonical Asian Lakto passes through (no master lookup needed).
expectReturn(
  '1. canonical "Asian Lakto Ind Ltd" passes through',
  () => normalizeCompany(mockDb(null), '12345', 'Asian Lakto Ind Ltd', 4, 2026),
  'Asian Lakto Ind Ltd'
);

// Case 2: canonical Indriyan passes through.
expectReturn(
  '2. canonical "Indriyan Beverages Pvt Ltd" passes through',
  () => normalizeCompany(mockDb(null), '12345', 'Indriyan Beverages Pvt Ltd', 4, 2026),
  'Indriyan Beverages Pvt Ltd'
);

// Case 3: empty string ('') triggers master lookup; master is canonical → use it.
expectReturn(
  '3. ""  + master="Asian Lakto Ind Ltd"  → "Asian Lakto Ind Ltd"',
  () => normalizeCompany(mockDb('Asian Lakto Ind Ltd'), '12345', '', 4, 2026),
  'Asian Lakto Ind Ltd'
);

// Case 4: literal string "null" (from JS null stringification) triggers master lookup.
expectReturn(
  '4. "null" + master="Asian Lakto Ind Ltd" → "Asian Lakto Ind Ltd"',
  () => normalizeCompany(mockDb('Asian Lakto Ind Ltd'), '12345', 'null', 4, 2026),
  'Asian Lakto Ind Ltd'
);

// Case 5: "Default" + master="Default" + no existing row → returns ''.
//        BEHAVIOR FLIPPED in Phase 1.5 from THROW to RETURN '' so the ~149
//        master-data-debt employees aren't locked out. Schema UNIQUE
//        (employee_code, month, year) is the new identity; the company
//        column is metadata. Case 9 covers the same scenario explicitly.
expectReturn(
  '5. "Default" + master="Default" + no existing row → "" (Phase 1.5 lenient)',
  () => normalizeCompany(mockDb('Default'), '12345', 'Default', 4, 2026),
  ''
);

// Case 6: JS null (not the string) → trimmed to "" → master lookup.
expectReturn(
  '6. null   + master="Asian Lakto Ind Ltd" → "Asian Lakto Ind Ltd"',
  () => normalizeCompany(mockDb('Asian Lakto Ind Ltd'), '12345', null, 4, 2026),
  'Asian Lakto Ind Ltd'
);

// Case 7: JS undefined → trimmed to "" → master lookup.
expectReturn(
  '7. undefined + master="Asian Lakto Ind Ltd" → "Asian Lakto Ind Ltd"',
  () => normalizeCompany(mockDb('Asian Lakto Ind Ltd'), '12345', undefined, 4, 2026),
  'Asian Lakto Ind Ltd'
);

// Case 8: typo / unknown company → THROWS even if master is canonical.
//        Master is consulted ONLY for the diagnostic in the error message,
//        not for silent coercion. This protects against new bad-tag drift.
expectThrow(
  '8. "XYZ Corp" + master="Asian Lakto Ind Ltd" THROWS (typo protection)',
  () => normalizeCompany(mockDb('Asian Lakto Ind Ltd'), '12345', 'XYZ Corp', 4, 2026),
  ['Cannot resolve company', '12345', 'XYZ Corp']
);

// ── Cases 9-11: Phase 1.5 new behavior ──

// Case 9: explicit "Default + Default + no existing row + month/year".
//        Master-data-debt employee on first run: schema UNIQUE will dedupe.
expectReturn(
  '9. "Default" + master="Default" + no existing row + (4, 2026) → ""',
  () => normalizeCompany(mockDb('Default', null), '12345', 'Default', 4, 2026),
  ''
);

// Case 10: existing salary_computations row carries forward its tag.
//         Reused tag may itself be non-canonical — that's intentional, the
//         goal is cross-run stability, not canonicalization.
expectReturn(
  '10. "Default" + master="Default" + existing row company="null" → "null"',
  () => normalizeCompany(mockDb('Default', 'null'), '12345', 'Default', 4, 2026),
  'null'
);

// Case 11: typo input + master non-canonical → still throws (protection
//         applies BEFORE the master/existing-row branch).
expectThrow(
  '11. "XYZ Corp" + master="Default" + no existing row → THROWS (typo protection)',
  () => normalizeCompany(mockDb('Default', null), '12345', 'XYZ Corp', 4, 2026),
  ['Cannot resolve company', '12345', 'XYZ Corp']
);

console.log(`\n--------------------------------------------------`);
console.log(`Result: ${passed}/${passed + failed} cases passed`);
process.exit(failed === 0 ? 0 : 1);
