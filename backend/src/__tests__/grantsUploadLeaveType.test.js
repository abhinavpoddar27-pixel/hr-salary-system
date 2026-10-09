/**
 * Grants upload with Leave Type + Days (ruling R-E, leave switchover 2026).
 */
const { startApi } = require('./helpers/apiHarness');
const { sheet, uploadGrants } = require('./helpers/grantsUpload');

const YEAR = 2026;
const CO = 'Indriyan Beverages Pvt Ltd';
let api;
let db;

beforeAll(() => {
  api = startApi({ '/api/features': '../../routes/phase5' });
  db = api.db;
});
afterAll(async () => { await api.close(); });
beforeEach(() => {
  for (const t of ['leave_external_grants', 'employees', 'audit_log']) db.prepare(`DELETE FROM ${t}`).run();
  db.prepare("UPDATE policy_config SET value = 'false' WHERE key = 'leave_external_grants_acknowledged'").run();
});

function addEmployee(code, type = 'SILP') {
  db.prepare(`INSERT INTO employees (code, name, company, employment_type, status, date_of_joining)
              VALUES (?, 'T', ?, ?, 'Active', '2023-01-01')`).run(code, CO, type);
}
const row = (over) => ({ 'Employee Code': 'U1', Year: YEAR, Month: 7, 'How Given': 'Leave taken', ...over });

test('CL and EL rows in the same month are both stored with their leave type', async () => {
  addEmployee('U1');
  const res = await uploadGrants(api, sheet([
    row({ 'Leave Type': 'CL', Days: 4 }),
    row({ 'Leave Type': 'EL', Days: 5 }),
  ]), '?dryRun=false');
  expect(res.status).toBe(200);
  expect(res.body.totals).toEqual({ rows: 2, accepted: 2, rejected: 0 });
  const got = db.prepare('SELECT leave_type, days, mode FROM leave_external_grants ORDER BY leave_type').all();
  expect(got).toEqual([
    { leave_type: 'CL', days: 4, mode: 'leave_taken' },
    { leave_type: 'EL', days: 5, mode: 'leave_taken' },
  ]);
});

test('a missing / blank Leave Type means EL, and lower case is accepted', async () => {
  addEmployee('U1');
  const res = await uploadGrants(api, sheet([
    row({ Days: 2 }),
    row({ Month: 8, 'Leave Type': 'cl', Days: 1 }),
  ]), '?dryRun=false');
  expect(res.body.totals.accepted).toBe(2);
  expect(db.prepare("SELECT leave_type FROM leave_external_grants WHERE month = 7").get().leave_type).toBe('EL');
  expect(db.prepare("SELECT leave_type FROM leave_external_grants WHERE month = 8").get().leave_type).toBe('CL');
});

test('the legacy EL Days header still works', async () => {
  addEmployee('U1');
  const res = await uploadGrants(api, sheet([row({ 'EL Days': 3 })]), '?dryRun=false');
  expect(res.body.totals.accepted).toBe(1);
  const g = db.prepare('SELECT leave_type, days FROM leave_external_grants').get();
  expect(g).toEqual({ leave_type: 'EL', days: 3 });
});

test('bad leave type, bad days and CL paid out are rejected per row with the new text', async () => {
  addEmployee('U1');
  const res = await uploadGrants(api, sheet([
    row({ 'Leave Type': 'SL', Days: 1 }),
    row({ 'Leave Type': 'EL', Days: 0 }),
    row({ 'Leave Type': 'CL', Days: 2, 'How Given': 'Paid in cash' }),
    row({ 'Leave Type': 'CL', Days: 2, 'How Given': 'Paid in salary' }),
  ]));
  expect(res.status).toBe(200);
  expect(res.body.totals).toEqual({ rows: 4, accepted: 0, rejected: 4 });
  const reasons = res.body.rows.map((r) => r.reason);
  expect(reasons[0]).toMatch(/Leave Type must be 'EL' or 'CL'/);
  expect(reasons[1]).toBe('Days must be a positive number');
  expect(reasons[2]).toBe("CL can only be 'Leave taken'");
  expect(reasons[3]).toBe("CL can only be 'Leave taken'");
});

test('a CL duplicate of a stored row is rejected; the same month as EL is not', async () => {
  addEmployee('U1');
  await uploadGrants(api, sheet([row({ 'Leave Type': 'CL', Days: 4 })]), '?dryRun=false');
  const res = await uploadGrants(api, sheet([
    row({ 'Leave Type': 'CL', Days: 4 }),
    row({ 'Leave Type': 'EL', Days: 4 }),
  ]));
  expect(res.body.rows[0].accepted).toBe(false);
  expect(res.body.rows[0].reason).toMatch(/Already recorded/);
  expect(res.body.rows[1].accepted).toBe(true);
});

test('duplicates inside one sheet are per-row errors, in the dry run and on commit — never a 500', async () => {
  addEmployee('U1');
  const buf = sheet([
    row({ 'Leave Type': 'CL', Days: 4 }),
    row({ 'Leave Type': 'CL', Days: 3 }),
    row({ 'Leave Type': 'EL', Days: 1 }),
  ]);
  const dry = await uploadGrants(api, buf);
  expect(dry.status).toBe(200);
  expect(dry.body.totals).toEqual({ rows: 3, accepted: 2, rejected: 1 });
  expect(dry.body.rows[1].reason).toMatch(/Duplicate of row 2 in this sheet/);

  const commit = await uploadGrants(api, buf, '?dryRun=false');
  expect(commit.status).toBe(200);
  expect(commit.body.totals.accepted).toBe(2);
  expect(db.prepare('SELECT COUNT(*) c FROM leave_external_grants').get().c).toBe(2);
});

const OWNER_SHEET = require('path').join(__dirname, '../../../docs/leave-switchover-2026/leave-outside-system-2026.xlsx');
// The sheet is committed with the docs (commit 6); skip cleanly on an earlier checkout.
const ownerSheetTest = require('fs').existsSync(OWNER_SHEET) ? test : test.skip;

ownerSheetTest('the owner sheet in the build pack validates row for row', async () => {
  const XLSX = require('xlsx');
  const file = OWNER_SHEET;
  const rows = XLSX.utils.sheet_to_json(XLSX.readFile(file).Sheets[XLSX.readFile(file).SheetNames[0]], { defval: '' });
  for (const code of new Set(rows.map((r) => String(r['Employee Code'])))) addEmployee(code);
  const fs = require('fs');
  const res = await uploadGrants(api, fs.readFileSync(file));
  expect(res.status).toBe(200);
  expect(res.body.totals).toEqual({ rows: 44, accepted: 44, rejected: 0 });
  expect(res.body.rows.filter((r) => r.leave_type === 'CL').reduce((a, r) => a + r.days, 0)).toBe(76);
  expect(res.body.rows.filter((r) => r.leave_type === 'EL').reduce((a, r) => a + r.days, 0)).toBe(57);
});
