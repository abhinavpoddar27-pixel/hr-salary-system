#!/usr/bin/env node
/**
 * Synthetic unit test for normalizeCompany() — Phase 3a of the
 * Stage 6/7 company-tag duplicate fix.
 *
 * No real DB. No npm install needed. salaryComputation.js has no top-level
 * external requires (all are inline inside other functions); normalizeCompany
 * itself only uses CANONICAL_COMPANIES, KNOWN_BAD_TAGS, and db.prepare().get().
 *
 * Run:    node scripts/test-normalize-company.js
 * Exit:   0 if all 8 cases pass, 1 otherwise.
 */

const path = require('path');
const { normalizeCompany } = require(
  path.join(__dirname, '..', 'backend', 'src', 'services', 'salaryComputation')
);

// ── Mock factory ──
// Mimics better-sqlite3's `db.prepare(sql).get(params...)` API surface.
// `masterCompany` controls what the employees lookup returns:
//   string         → { company: <string> }
//   null/undefined → undefined (no employee row found)
const mockDb = (masterCompany) => ({
  prepare: () => ({
    get: () => (masterCompany !== null && masterCompany !== undefined)
      ? { company: masterCompany }
      : undefined
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

console.log('normalizeCompany() — Phase 3a synthetic unit test');
console.log('==================================================\n');

// Case 1: canonical Asian Lakto passes through (no master lookup needed).
expectReturn(
  '1. canonical "Asian Lakto Ind Ltd" passes through',
  () => normalizeCompany(mockDb(null), '12345', 'Asian Lakto Ind Ltd'),
  'Asian Lakto Ind Ltd'
);

// Case 2: canonical Indriyan passes through.
expectReturn(
  '2. canonical "Indriyan Beverages Pvt Ltd" passes through',
  () => normalizeCompany(mockDb(null), '12345', 'Indriyan Beverages Pvt Ltd'),
  'Indriyan Beverages Pvt Ltd'
);

// Case 3: empty string ('') triggers master lookup; master is canonical → use it.
expectReturn(
  '3. ""  + master="Asian Lakto Ind Ltd"  → "Asian Lakto Ind Ltd"',
  () => normalizeCompany(mockDb('Asian Lakto Ind Ltd'), '12345', ''),
  'Asian Lakto Ind Ltd'
);

// Case 4: literal string "null" (from JS null stringification) triggers master lookup.
expectReturn(
  '4. "null" + master="Asian Lakto Ind Ltd" → "Asian Lakto Ind Ltd"',
  () => normalizeCompany(mockDb('Asian Lakto Ind Ltd'), '12345', 'null'),
  'Asian Lakto Ind Ltd'
);

// Case 5: "Default" input + master also "Default" → THROWS.
//        This is the forcing function for the ~138 master-data debt employees.
expectThrow(
  '5. "Default" + master="Default" THROWS with employee code in message',
  () => normalizeCompany(mockDb('Default'), '12345', 'Default'),
  ['Cannot resolve company', '12345']
);

// Case 6: JS null (not the string) → trimmed to "" → master lookup.
expectReturn(
  '6. null   + master="Asian Lakto Ind Ltd" → "Asian Lakto Ind Ltd"',
  () => normalizeCompany(mockDb('Asian Lakto Ind Ltd'), '12345', null),
  'Asian Lakto Ind Ltd'
);

// Case 7: JS undefined → trimmed to "" → master lookup.
expectReturn(
  '7. undefined + master="Asian Lakto Ind Ltd" → "Asian Lakto Ind Ltd"',
  () => normalizeCompany(mockDb('Asian Lakto Ind Ltd'), '12345', undefined),
  'Asian Lakto Ind Ltd'
);

// Case 8: typo / unknown company → THROWS even if master is canonical.
//        Master is consulted ONLY for the diagnostic in the error message,
//        not for silent coercion. This protects against new bad-tag drift.
expectThrow(
  '8. "XYZ Corp" + master="Asian Lakto Ind Ltd" THROWS (typo protection)',
  () => normalizeCompany(mockDb('Asian Lakto Ind Ltd'), '12345', 'XYZ Corp'),
  ['Cannot resolve company', '12345', 'XYZ Corp']
);

console.log(`\n--------------------------------------------------`);
console.log(`Result: ${passed}/${passed + failed} cases passed`);
process.exit(failed === 0 ? 0 : 1);
