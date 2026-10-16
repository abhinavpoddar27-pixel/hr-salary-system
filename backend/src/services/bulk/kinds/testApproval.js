/**
 * TEST-ONLY bulk kind (P5-01). Registered in engine.js only when BULK_TEST_KINDS=1 (jest and the
 * Playwright check script set it; Railway never does). Exercises the approval stage without touching
 * any real table: rows (code + amount) are written to its own table `bulk_test_target`, created here
 * on first use — so production never gets the table.
 * amount === 13013 throws inside applyRow (all-or-nothing test).
 */
const NAME = 'test-approval';

function ensureTable(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS bulk_test_target (
    id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL UNIQUE, amount REAL NOT NULL,
    requested_by TEXT, approved_by TEXT, note TEXT)`);
}

function normaliseCommon(c) {
  const note = String(c.note ?? '').trim();
  if (note.length > 200) return { ok: false, error: 'Note is too long', fields: { note: 'Note is too long' } };
  return { ok: true, value: { note, month: 9, year: 2026 } };
}

function normaliseRows(input) {
  const out = []; const seen = new Set();
  for (const raw of Array.isArray(input) ? input : []) {
    const code = String(raw?.code ?? '').trim();
    if (!code || seen.has(code.toLowerCase())) continue;
    seen.add(code.toLowerCase());
    out.push({ rowNo: out.length + 1, code, amountRaw: raw.amount, messages: [] });
  }
  return { rows: out };
}

const normaliseOptions = () => ({});
const periodOf = (c) => ({ month: c.month, year: c.year });
const describe = (c) => `test batch${c && c.note ? ` · ${c.note}` : ''}`;
function context(db) { ensureTable(db); return {}; }

function planRow(db, row) {
  const messages = [];
  const amount = Number(row.amountRaw);
  row.amount = amount;
  const existing = db.prepare('SELECT * FROM bulk_test_target WHERE code = ?').get(row.code);
  const base = (state, action) => ({
    state, action, messages,
    display: { code: row.code, name: `Test Person ${row.code}`, amountOld: existing ? existing.amount : null, amountNew: amount },
    fingerprint: existing ? [existing.id, existing.amount] : null, existing,
  });
  if (!Number.isFinite(amount) || amount <= 0) { messages.push('Amount must be more than 0'); return base('error', 'conflict'); }
  if (existing && existing.amount === amount) { messages.push('Already this amount — left as it is'); return base('skipped', 'noop'); }
  if (existing) { messages.push('Will change the existing amount'); return base('warning', 'update'); }
  return base('ok', 'create');
}

function applyRow(db, row, plan, common, { user, requestedBy }) {
  if (row.amount === 13013) throw new Error('test kind: forced failure on 13013');
  if (plan.action === 'create') {
    const id = db.prepare('INSERT INTO bulk_test_target (code, amount, requested_by, approved_by, note) VALUES (?, ?, ?, ?, ?)')
      .run(row.code, row.amount, requestedBy, user, common.note).lastInsertRowid;
    return { targetTable: 'bulk_test_target', targetId: Number(id), before: null, after: db.prepare('SELECT * FROM bulk_test_target WHERE id = ?').get(id) };
  }
  const before = plan.existing;
  db.prepare('UPDATE bulk_test_target SET amount = ?, requested_by = ?, approved_by = ? WHERE id = ?').run(row.amount, requestedBy, user, before.id);
  return { targetTable: 'bulk_test_target', targetId: before.id, before, after: db.prepare('SELECT * FROM bulk_test_target WHERE id = ?').get(before.id) };
}

function undoable(db, bulkRow) {
  const cur = db.prepare('SELECT * FROM bulk_test_target WHERE id = ?').get(bulkRow.target_id);
  if (!cur) return { ok: false, reason: 'The row no longer exists' };
  const after = JSON.parse(bulkRow.after_json || '{}');
  return JSON.stringify(cur) === JSON.stringify(after) ? { ok: true } : { ok: false, reason: 'Changed since the batch' };
}

function undoRow(db, bulkRow) {
  if (bulkRow.action === 'create') { db.prepare('DELETE FROM bulk_test_target WHERE id = ?').run(bulkRow.target_id); return; }
  const b = JSON.parse(bulkRow.before_json);
  db.prepare('UPDATE bulk_test_target SET amount = ?, requested_by = ?, approved_by = ? WHERE id = ?').run(b.amount, b.requested_by, b.approved_by, b.id);
}

module.exports = {
  name: NAME, label: 'test', noun: 'rows', requiresApproval: true,
  nothingToSave: 'Nothing to send — every row is already at that amount',
  roles: { create: ['admin', 'hr'], approve: ['admin', 'finance'] },
  hashRow: (r) => [r.code, r.amount, r.plan.state, r.plan.action, r.plan.fingerprint],
  inputOf: (r) => ({ code: r.code, amount: r.amount }),
  rowFromInput: (input, rowNo) => ({ rowNo, code: String(input.code || ''), amountRaw: input.amount, messages: [] }),
  displayExtra: (r) => ({ amount: r.amount }),
  moneyTotal: (planned) => planned.filter(r => r.plan.state === 'ok' || r.plan.state === 'warning')
    .reduce((s, r) => s + (r.amount - (r.plan.existing ? r.plan.existing.amount : 0)), 0),
  reviewColumns: [
    { key: 'code', label: 'Code', type: 'text' }, { key: 'name', label: 'Name', type: 'text' },
    { key: 'amountOld', label: 'Now', type: 'money' }, { key: 'amountNew', label: 'New', type: 'money' },
  ],
  normaliseCommon, normaliseRows, normaliseOptions, periodOf, describe, context,
  planRow, applyRow, undoable, undoRow,
};
