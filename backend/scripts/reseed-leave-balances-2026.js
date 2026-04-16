#!/usr/bin/env node
/**
 * Reseed 2026 leave_balances for permanent employees only.
 *
 * Usage:
 *   node backend/scripts/reseed-leave-balances-2026.js
 *   node backend/scripts/reseed-leave-balances-2026.js --execute-after-review
 *
 * Policy (Apr 2026):
 *   - Eligible: status='Active' AND employment_type='Permanent' ONLY.
 *     All other employee types' 2026 leave_balances rows are deleted and
 *     NOT re-seeded.
 *   - CL entitlement: DOJ-based pro-ration via computeClEntitlement.
 *     Table: Jan-Feb=7, Mar-Apr=6, May-Jun=5, Jul-Aug=4, Sep-Oct=3, Nov-Dec=2.
 *     Mid-month joiners (DOJ day > 1) roll to next month's bucket.
 *     NULL DOJ = pre-year = 7 CL (handled by helper).
 *   - CL usage preservation + grandfather clamp:
 *       new_balance = max(0, new_entitlement - existing_used)
 *     Existing `used` count is preserved in the new row.
 *   - EL: recomputed from scratch for Jan-Apr 2026 as
 *       sum(floor(days_present / 20) * el_accrual_rate) across months.
 *     EL usage = 0 (verified from earlier diagnostic — nobody has EL usage).
 *   - SL: abolished. 2026 SL rows deleted and NOT re-seeded.
 *   - Historical preservation:
 *       rows with year != 2026: UNTOUCHED across all employees and all tables
 *       leave_applications: UNTOUCHED (zero reads, zero writes)
 *       leave_transactions: UNTOUCHED (zero reads, zero writes)
 *       leave_accrual_ledger rows with year != 2026: UNTOUCHED
 *
 * Guard:
 *   policy_config key 'reseed_2026_v1'. Second execute is refused unless
 *   the guard row is manually deleted. Dry-run is always allowed.
 *
 * Execution model:
 *   - Dry-run opens the DB with { readonly: true } so any accidental write
 *     throws SQLITE_READONLY.
 *   - Execute runs a single db.transaction() that contains every DELETE,
 *     INSERT, audit row, and the guard write. On any throw better-sqlite3
 *     auto-rolls the whole thing back and no guard is written.
 */

const path = require('path');
const Database = require('better-sqlite3');

// Match the repo's established script idiom (see seed-test-data.js) so that
// any downstream module that reads DATA_DIR sees the same path we use here.
process.env.DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const DATA_DIR = process.env.DATA_DIR;
const DB_PATH = path.join(DATA_DIR, 'hr_system.db');

const { computeClEntitlement } = require('../src/services/phase5Features');

const DRY_RUN = !process.argv.includes('--execute-after-review');
const YEAR = 2026;
const GUARD_KEY = `reseed_${YEAR}_v1`;

// ── Plan computation (pure reads — shared by dry-run and execute) ──
function computePlan(db, year, elRate) {
  const permanents = db.prepare(`
    SELECT id, code, name, department, company, date_of_joining
    FROM employees
    WHERE status = 'Active' AND employment_type = 'Permanent'
    ORDER BY code
  `).all();

  const getExistingCl = db.prepare(`
    SELECT balance, used FROM leave_balances
    WHERE employee_id = ? AND year = ? AND leave_type = 'CL'
  `);
  const getExistingEl = db.prepare(`
    SELECT balance, used FROM leave_balances
    WHERE employee_id = ? AND year = ? AND leave_type = 'EL'
  `);
  const getDayCalcs = db.prepare(`
    SELECT month, days_present FROM day_calculations
    WHERE employee_code = ? AND year = ? AND month IN (1,2,3,4)
  `);

  const plan = [];
  for (const emp of permanents) {
    const existingCl = getExistingCl.get(emp.id, year);
    const existingEl = getExistingEl.get(emp.id, year);
    const dayCalcs = getDayCalcs.all(emp.code, year);

    const newClEntitlement = computeClEntitlement(emp.date_of_joining, year);
    const existingClUsed = existingCl?.used || 0;
    const rawNewBalance = newClEntitlement - existingClUsed;
    const newClBalance = Math.max(0, rawNewBalance);
    const grandfathered = rawNewBalance < 0;

    let newElAccrued = 0;
    for (const d of dayCalcs) {
      const present = d.days_present || 0;
      if (present >= 20) {
        newElAccrued += Math.floor(present / 20) * elRate;
      }
    }

    plan.push({
      emp,
      oldClBalance: existingCl?.balance || 0,
      oldClUsed: existingClUsed,
      newClEntitlement,
      newClBalance,
      grandfathered,
      oldElBalance: existingEl?.balance || 0,
      newElAccrued,
      newElBalance: newElAccrued
    });
  }
  return plan;
}

// ── Existing-state metrics (for the "BEFORE reseed" block in the report) ──
function readExistingState(db, year) {
  const permCount = db.prepare(`
    SELECT COUNT(*) AS c FROM employees
    WHERE status = 'Active' AND employment_type = 'Permanent'
  `).get().c;

  // Count leave_balances 2026 rows split by leave_type and by permanence
  const balAll = db.prepare(`
    SELECT leave_type, COUNT(*) AS c
    FROM leave_balances
    WHERE year = ?
    GROUP BY leave_type
  `).all(year);
  const clRows = balAll.find(r => r.leave_type === 'CL')?.c || 0;
  const elRows = balAll.find(r => r.leave_type === 'EL')?.c || 0;
  const slRows = balAll.find(r => r.leave_type === 'SL')?.c || 0;

  const nonPermRows = db.prepare(`
    SELECT COUNT(*) AS c
    FROM leave_balances lb
    JOIN employees e ON e.id = lb.employee_id
    WHERE lb.year = ?
      AND NOT (e.status = 'Active' AND e.employment_type = 'Permanent')
  `).get(year).c;

  const ledgerRows = db.prepare(
    `SELECT COUNT(*) AS c FROM leave_accrual_ledger WHERE year = ?`
  ).get(year).c;

  return { permCount, clRows, elRows, slRows, nonPermRows, ledgerRows };
}

// ── Dry-run report printer ──
function printDryRunReport(db, plan, year, elRate) {
  const state = readExistingState(db, year);

  console.log('======================================================================');
  console.log('RESEED 2026 LEAVE BALANCES — DRY RUN');
  console.log('======================================================================');
  console.log(`Policy: Permanent-only | CL=DOJ-pro-rated | EL=per-20-days | SL=abolished`);
  console.log(`Date: ${new Date().toISOString()}`);
  console.log(`DB path: ${DB_PATH}`);
  console.log(`EL accrual rate: ${elRate} per 20 days`);
  console.log(`Total permanents to process: ${plan.length}`);
  console.log('');
  console.log('Existing state (BEFORE reseed):');
  console.log(`  leave_balances rows for ${year} (all employees):`);
  console.log(`    CL rows: ${state.clRows}`);
  console.log(`    EL rows: ${state.elRows}`);
  console.log(`    SL rows: ${state.slRows}`);
  console.log(`  Non-permanent ${year} rows to delete: ${state.nonPermRows}`);
  console.log(`  leave_accrual_ledger ${year} rows to delete: ${state.ledgerRows}`);
  console.log('');
  console.log('Planned changes per permanent employee:');

  // Header row — column widths chosen to fit the widest real-world values.
  const hdr =
    'CODE'.padEnd(7) +
    'NAME'.padEnd(30) +
    'DOJ'.padEnd(12) +
    'OLD_CL_BAL'.padStart(10) + '  ' +
    'OLD_CL_USED'.padStart(11) + '  ' +
    'NEW_CL_ENT'.padStart(10) + '  ' +
    'NEW_CL_BAL'.padStart(10) + '  ' +
    'OLD_EL_BAL'.padStart(10) + '  ' +
    'NEW_EL_BAL'.padStart(10) + '  ' +
    'FLAG';
  console.log(hdr);

  const fmtNum = (v) => {
    if (v === null || v === undefined) return '-';
    const n = Number(v);
    if (Number.isInteger(n)) return String(n);
    return (Math.round(n * 100) / 100).toString();
  };

  for (const row of plan) {
    const name = (row.emp.name || '').slice(0, 28);
    const doj = row.emp.date_of_joining || 'NULL';
    const flag = row.grandfathered ? 'GRANDFATHERED' : 'ok';
    console.log(
      String(row.emp.code).padEnd(7) +
      name.padEnd(30) +
      String(doj).padEnd(12) +
      fmtNum(row.oldClBalance).padStart(10) + '  ' +
      fmtNum(row.oldClUsed).padStart(11) + '  ' +
      fmtNum(row.newClEntitlement).padStart(10) + '  ' +
      fmtNum(row.newClBalance).padStart(10) + '  ' +
      fmtNum(row.oldElBalance).padStart(10) + '  ' +
      fmtNum(row.newElBalance).padStart(10) + '  ' +
      flag
    );
  }

  // Summary aggregates
  const withClPositive = plan.filter(p => p.newClBalance > 0).length;
  const withZeroCl = plan.filter(p => p.newClBalance === 0).length;
  const grandfathered = plan.filter(p => p.grandfathered).length;
  const clEntSum = plan.reduce((s, p) => s + p.newClEntitlement, 0);
  const clUsedSum = plan.reduce((s, p) => s + p.oldClUsed, 0);
  const elAccruedSum = plan.reduce((s, p) => s + p.newElAccrued, 0);

  console.log('');
  console.log('Summary:');
  console.log(`  Permanents getting CL entitlement > 0:       ${plan.filter(p => p.newClEntitlement > 0).length}`);
  console.log(`  Permanents with new CL balance > 0:          ${withClPositive}`);
  console.log(`  Permanents with new CL balance = 0:          ${withZeroCl}`);
  console.log(`  Permanents GRANDFATHERED (used > new ent):   ${grandfathered}`);
  console.log(`  Total CL entitlement credited (opening sum): ${clEntSum}`);
  console.log(`  Total CL usage preserved (used sum):         ${clUsedSum}`);
  console.log(`  Total EL accrued:                            ${elAccruedSum}`);
  console.log('');
  console.log('Delete plan (execute mode):');
  console.log(`  DELETE FROM leave_balances WHERE year = ${year}          → removes ${state.clRows + state.elRows + state.slRows} rows`);
  console.log(`  DELETE FROM leave_accrual_ledger WHERE year = ${year}    → removes ${state.ledgerRows} rows`);
  console.log('');
  console.log('Insert plan (execute mode):');
  console.log(`  INSERT leave_balances:         ${plan.length} permanents × 2 types = ${plan.length * 2} rows`);
  console.log(`  INSERT leave_accrual_ledger:   ${plan.length} permanents × 2 types = ${plan.length * 2} rows`);
  console.log(`  INSERT audit_log:              ${plan.length} × 2 = ${plan.length * 2} rows`);
  console.log(`  INSERT policy_config guard row: 1`);
  console.log('');
  console.log('To execute these changes:');
  console.log('  node backend/scripts/reseed-leave-balances-2026.js --execute-after-review');
  console.log('');
  console.log(`Guard key that will be set on success: ${GUARD_KEY}`);
  console.log('======================================================================');
  console.log('DRY RUN complete. Zero rows written. DB opened readonly.');
  console.log('======================================================================');
}

// ── Execute mode ──
function execute(db, plan, year) {
  const existingGuard = db.prepare(
    "SELECT value FROM policy_config WHERE key = ?"
  ).get(GUARD_KEY);
  if (existingGuard) {
    console.error(`❌ ABORT: reseed for year ${year} already executed at ${existingGuard.value}.`);
    console.error(`To force a re-execute, run this SQL against the DB:`);
    console.error(`  DELETE FROM policy_config WHERE key='${GUARD_KEY}';`);
    console.error(`Then re-run this script with --execute-after-review.`);
    process.exit(1);
  }

  const delBalances = db.prepare('DELETE FROM leave_balances WHERE year = ?');
  const delLedger = db.prepare('DELETE FROM leave_accrual_ledger WHERE year = ?');

  const insBalance = db.prepare(`
    INSERT INTO leave_balances (employee_id, year, leave_type, opening, accrued, used, balance)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const insLedger = db.prepare(`
    INSERT INTO leave_accrual_ledger
      (employee_code, employee_id, year, month, leave_type,
       opening_balance, accrued, used, lapsed, closing_balance,
       paid_days_this_month, paid_days_ytd, el_earned_ytd, company)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  // Inlined audit-log writer, bound to THIS connection so the rows are part
  // of the transaction. Matches the column layout of the logAudit helper in
  // backend/src/database/db.js.
  const insAudit = db.prepare(`
    INSERT INTO audit_log
      (table_name, record_id, field_name, old_value, new_value, stage, remark)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const insGuard = db.prepare(`
    INSERT OR REPLACE INTO policy_config (key, value, description)
    VALUES (?, ?, ?)
  `);

  const txn = db.transaction(() => {
    const delBal = delBalances.run(year);
    const delLed = delLedger.run(year);

    let clInserts = 0, elInserts = 0, ledgerInserts = 0, auditInserts = 0;

    for (const row of plan) {
      // CL balance: opening stores the formula-computed entitlement (what
      // they were supposed to get); used preserves pre-reseed usage so audit
      // stays intact; balance is the grandfather-clamped value.
      insBalance.run(
        row.emp.id, year, 'CL',
        row.newClEntitlement, 0, row.oldClUsed, row.newClBalance
      );
      clInserts++;

      // EL balance: opening=0 (EL has no opening grant), accrued=computed
      // from day_calculations, used=0 (no EL usage in 2026).
      insBalance.run(
        row.emp.id, year, 'EL',
        0, row.newElAccrued, 0, row.newElBalance
      );
      elInserts++;

      // CL ledger seed booked to January as the year-opening row. Future
      // monthly CL accrual runs (phase5Features.runLeaveAccrual) append
      // additional monthly rows on their own schedule.
      insLedger.run(
        row.emp.code, row.emp.id, year, 1, 'CL',
        row.newClEntitlement, 0, 0, 0, row.newClBalance,
        0, 0, 0, row.emp.company || null
      );
      ledgerInserts++;

      // EL ledger seed also booked to January as an aggregate opening row.
      insLedger.run(
        row.emp.code, row.emp.id, year, 1, 'EL',
        0, row.newElAccrued, 0, 0, row.newElBalance,
        0, 0, 0, row.emp.company || null
      );
      ledgerInserts++;

      const oldClSnap = JSON.stringify({ balance: row.oldClBalance, used: row.oldClUsed });
      const newClSnap = JSON.stringify({
        entitlement: row.newClEntitlement,
        used: row.oldClUsed,
        balance: row.newClBalance,
        grandfathered: row.grandfathered
      });
      insAudit.run(
        'leave_balances', row.emp.id, 'CL_reseed_2026',
        oldClSnap, newClSnap, 'reseed_script', 'Apr 2026 policy reseed'
      );
      auditInserts++;

      const oldElSnap = JSON.stringify({ balance: row.oldElBalance, used: 0 });
      const newElSnap = JSON.stringify({ accrued: row.newElAccrued, balance: row.newElBalance });
      insAudit.run(
        'leave_balances', row.emp.id, 'EL_reseed_2026',
        oldElSnap, newElSnap, 'reseed_script', 'Apr 2026 policy reseed'
      );
      auditInserts++;
    }

    insGuard.run(
      GUARD_KEY,
      new Date().toISOString(),
      `2026 leave_balances reseed (${plan.length} permanents)`
    );

    return {
      delBal: delBal.changes,
      delLed: delLed.changes,
      clInserts, elInserts, ledgerInserts, auditInserts
    };
  });

  const result = txn();

  console.log('======================================================================');
  console.log('RESEED 2026 — EXECUTE COMPLETE');
  console.log('======================================================================');
  console.log(`Deleted: ${result.delBal} leave_balances rows, ${result.delLed} leave_accrual_ledger rows`);
  console.log(`Inserted: ${result.clInserts} CL + ${result.elInserts} EL = ${result.clInserts + result.elInserts} leave_balances rows`);
  console.log(`Inserted: ${result.ledgerInserts} leave_accrual_ledger rows`);
  console.log(`Logged:   ${result.auditInserts} audit_log entries`);
  console.log(`Guard set: policy_config.${GUARD_KEY} = ${new Date().toISOString()}`);
  console.log('======================================================================');
}

function main() {
  let db;
  try {
    db = new Database(DB_PATH, { readonly: DRY_RUN });
  } catch (err) {
    console.error(`FATAL: cannot open DB at ${DB_PATH}`);
    console.error(err.message);
    process.exit(1);
  }

  try {
    const elRateRow = db.prepare(
      "SELECT value FROM policy_config WHERE key = 'el_accrual_rate'"
    ).get();
    const elRate = parseFloat(elRateRow?.value);
    const elRateFinal = isNaN(elRate) ? 1 : elRate;

    const plan = computePlan(db, YEAR, elRateFinal);

    if (DRY_RUN) {
      printDryRunReport(db, plan, YEAR, elRateFinal);
    } else {
      execute(db, plan, YEAR);
    }
  } catch (err) {
    console.error('FATAL:', err.message);
    console.error(err.stack);
    process.exit(1);
  } finally {
    db.close();
  }
}

main();
