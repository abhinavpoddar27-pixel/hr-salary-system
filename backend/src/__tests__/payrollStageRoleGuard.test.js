/**
 * P3-PG — role guard on POST /api/payroll/calculate-days, /compute-salary, /finalise.
 *
 * Before: the payroll router sat behind requireAuth only, so any logged-in
 * role (viewer, supervisor, an employee-portal login) could run Stage 6 /
 * Stage 7 for a whole month or finalise it. Owner ruling 12 Oct 2026:
 * hr + finance + admin on all three (90-day callers: hr, admin, finance only).
 *
 * Driven over HTTP behind the REAL requireAuth with real JWTs (jwtApiHarness).
 * A refused call is sent with a VALID body and a signed-off month, so on the
 * old code it would run the handler and write — the snapshot comparison
 * proves the guard answers before any write. Fictional data only.
 */
const crypto = require('crypto');
const { startJwtApi } = require('./helpers/jwtApiHarness');

const MON = 9;
const YEAR = 2026;
const CO = 'Indriyan Beverages Pvt Ltd';
const BODY = { month: MON, year: YEAR, company: CO };
const DENY = 'HR, finance or admin access required';

const USERS = [
  { username: 'adm1', role: 'admin' },
  { username: 'hr1', role: 'hr' },
  { username: 'fin1', role: 'finance' },
  { username: 'fin2', role: 'Finance Team' },   // legacy label → normalizeRole → finance
  { username: 'view1', role: 'viewer' },
  { username: 'sup1', role: 'supervisor' },
  { username: 'emp1', role: 'employee' },
  { username: 'odd1', role: 'Store Keeper' },    // unknown label → viewer
];
const REFUSED = ['view1', 'sup1', 'emp1', 'odd1'];
const ALLOWED = ['adm1', 'hr1', 'fin1', 'fin2'];
const ROUTES = ['/api/payroll/calculate-days', '/api/payroll/compute-salary', '/api/payroll/finalise'];

let api; let db;

const D = (day) => `${YEAR}-${String(MON).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

function seed() {
  for (const code of ['T9801', 'T9802']) {
    const info = db.prepare(`
      INSERT INTO employees (code, name, department, company, employment_type, status, date_of_joining,
                             is_contractor, weekly_off_day, gross_salary)
      VALUES (?, 'TEST WORKER', 'PRODUCTION', ?, 'Permanent', 'Active', '2024-01-01', 0, 0, 20000)
    `).run(code, CO);
    for (let day = 1; day <= 30; day += 1) {
      const dow = new Date(Date.UTC(YEAR, MON - 1, day)).getUTCDay();
      const status = dow === 0 ? 'WO' : 'P';
      db.prepare(`
        INSERT INTO attendance_processed (employee_id, employee_code, date, month, year, company,
                                          status_original, status_final, is_night_out_only)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
      `).run(info.lastInsertRowid, code, D(day), MON, YEAR, CO, status, status);
    }
  }
  db.prepare(`INSERT INTO monthly_imports (month, year, company, file_name, status) VALUES (?, ?, ?, 'x.xls', 'imported')`)
    .run(MON, YEAR, CO);
}

const TABLES = ['day_calculations', 'salary_computations', 'monthly_imports', 'audit_log', 'notifications', 'loan_deductions'];
function snapshot() {
  const out = {};
  for (const t of TABLES) {
    let rows;
    try { rows = db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all(); } catch { rows = null; }
    out[t] = rows === null ? 'n/a' : `${rows.length}:${crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex')}`;
  }
  return out;
}

const post = (url, as, body = BODY) => api.request('POST', url, { as, body });
const unfinalise = () => {
  db.prepare('UPDATE salary_computations SET is_finalised = 0, finalised_at = NULL').run();
  db.prepare('UPDATE monthly_imports SET is_finalised = 0, finalised_at = NULL').run();
};
const finalisedCount = () => db.prepare('SELECT COUNT(*) c FROM monthly_imports WHERE is_finalised = 1').get().c;

beforeAll(async () => {
  api = startJwtApi({ '/api/payroll': '../../routes/payroll' }, { users: USERS });
  db = api.db;
  seed();
  // Admin runs Stage 6 + 7 once and finance signs off, so every route has real work to do
  // and finalise would succeed for anyone who got past the role check.
  const l = console.log; const w = console.warn; console.log = () => {}; console.warn = () => {};
  try {
    expect((await post(ROUTES[0], 'adm1')).status).toBe(200);
    expect((await post(ROUTES[1], 'adm1')).status).toBe(200);
  } finally { console.log = l; console.warn = w; }
  db.prepare(`INSERT INTO finance_month_signoff (month, year, company, status, signed_by) VALUES (?, ?, '', 'approved', 'fin1')`)
    .run(MON, YEAR);
  unfinalise();
});

afterAll(async () => { if (api) await api.close(); });

describe('refused roles get 403 before any write', () => {
  for (const user of REFUSED) {
    for (const url of ROUTES) {
      test(`${user} → POST ${url.replace('/api/payroll', '')} is 403 and changes nothing`, async () => {
        const before = snapshot();
        const res = await post(url, user);
        expect(res.status).toBe(403);
        expect(res.body).toEqual({ success: false, error: DENY });
        expect(snapshot()).toEqual(before);
        expect(finalisedCount()).toBe(0);
      });
    }
  }

  test('a refused role with an empty body still gets 403 (guard before validation)', async () => {
    const res = await api.request('POST', ROUTES[0], { as: 'view1', body: {} });
    expect(res.status).toBe(403);
  });

  test('no token → 401 from requireAuth (unchanged)', async () => {
    for (const url of ROUTES) {
      const res = await api.request('POST', url, { body: BODY });
      expect(res.status).toBe(401);
    }
  });
});

describe('hr / finance / admin still reach the handlers', () => {
  const quiet = async (fn) => {
    const l = console.log; const w = console.warn; console.log = () => {}; console.warn = () => {};
    try { return await fn(); } finally { console.log = l; console.warn = w; }
  };

  for (const user of ALLOWED) {
    test(`${user} runs Stage 6, Stage 7 and finalises`, async () => {
      db.prepare('DELETE FROM day_calculations WHERE month = ? AND year = ?').run(MON, YEAR);
      const d = await quiet(() => post(ROUTES[0], user));
      expect(d.status).toBe(200);
      expect(d.body.success).toBe(true);
      expect(db.prepare('SELECT COUNT(*) c FROM day_calculations WHERE month = ? AND year = ?').get(MON, YEAR).c).toBe(2);

      db.prepare('DELETE FROM salary_computations WHERE month = ? AND year = ?').run(MON, YEAR);
      const s = await quiet(() => post(ROUTES[1], user));
      expect(s.status).toBe(200);
      expect(s.body.success).toBe(true);
      expect(db.prepare('SELECT COUNT(*) c FROM salary_computations WHERE month = ? AND year = ?').get(MON, YEAR).c).toBe(2);

      const f = await post(ROUTES[2], user);
      expect(f.status).toBe(200);
      expect(f.body.success).toBe(true);
      expect(finalisedCount()).toBe(1);
      unfinalise();
    });
  }

  test('the finance sign-off gate still answers its own 403 (not the role 403)', async () => {
    db.prepare("UPDATE finance_month_signoff SET status = 'rejected'").run();
    try {
      const res = await post(ROUTES[2], 'fin1');
      expect(res.status).toBe(403);
      expect(res.body.requiresFinanceApproval).toBe(true);
      expect(res.body.error).not.toBe(DENY);
      expect(finalisedCount()).toBe(0);
    } finally {
      db.prepare("UPDATE finance_month_signoff SET status = 'approved'").run();
    }
  });

  test('stale override stays admin only: hr / finance refused with a reason, admin allowed', async () => {
    db.prepare('UPDATE day_calculations SET salary_stale = 1 WHERE month = ? AND year = ?').run(MON, YEAR);
    try {
      for (const user of ['hr1', 'fin1']) {
        const res = await post(ROUTES[2], user, { ...BODY, staleOverrideReason: 'checked by hand, ok to close' });
        expect(res.status).toBe(400);
        expect(res.body.overridable).toBe(false);
      }
      expect(finalisedCount()).toBe(0);
      const ok = await post(ROUTES[2], 'adm1', { ...BODY, staleOverrideReason: 'checked by hand, ok to close' });
      expect(ok.status).toBe(200);
      expect(finalisedCount()).toBe(1);
    } finally {
      db.prepare('UPDATE day_calculations SET salary_stale = 0 WHERE month = ? AND year = ?').run(MON, YEAR);
      unfinalise();
    }
  });
});
