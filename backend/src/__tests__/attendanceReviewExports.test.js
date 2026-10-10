/**
 * Attendance Review exports (PR-3): workbook + Word pack from a stored run; admin-only download routes.
 * Synthetic codes only.
 */
const XLSX = require('xlsx');
const zlib = require('zlib');
const F = require('./helpers/attendanceReviewFixture');
const S = require('../services/attendanceReviewService');
const X = require('../services/attendanceReviewExports');
const { startJwtApi } = require('./helpers/jwtApiHarness');

/** Text of word/document.xml from a .docx buffer (minimal zip reader — no new test dependency). */
function docxText(buf) {
  let i = 0;
  while (i < buf.length - 30) {
    if (buf.readUInt32LE(i) !== 0x04034b50) { i += 1; continue; }
    const method = buf.readUInt16LE(i + 8); const csize = buf.readUInt32LE(i + 18);
    const nlen = buf.readUInt16LE(i + 26); const xlen = buf.readUInt16LE(i + 28);
    const name = buf.slice(i + 30, i + 30 + nlen).toString();
    const start = i + 30 + nlen + xlen;
    if (name === 'word/document.xml') {
      const data = buf.slice(start, start + csize);
      const xml = (method === 8 ? zlib.inflateRawSync(data) : data).toString('utf8');
      return xml.replace(/<w:tab\/>/g, ' ').replace(/<\/w:p>/g, '\n').replace(/<[^>]+>/g, '')
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
    }
    i = start + csize;
  }
  throw new Error('word/document.xml not found');
}

function cast(db) {
  F.emp(db, 'X1', { name: 'TEST EMP ONE 12' }); F.month(db, 'X1', 2026, 9, 22, (i) => ({ lm: i < 10 ? 30 : 0 }));
  F.month(db, 'X1', 2026, 10, 22, (i) => ({ lm: i < 12 ? 50 : 0 }));
  F.emp(db, 'X2', { name: 'TEST EMP TWO', department: 'MEERA', is_contractor: 1, employment_type: 'Contract' });
  F.month(db, 'X2', 2026, 10, 20, (i) => ({ lm: i < 10 ? 40 : 0 }));
  F.emp(db, 'X3', { name: 'TEST EMP THREE' }); F.month(db, 'X3', 2026, 9, 22);
  F.month(db, 'X3', 2026, 10, 22, (i) => ({ em: [0, 1, 2, 8, 9].includes(i) ? (i < 2 ? 75 : 30) : 0 }));
}
const result = (db, cfg = {}) => S.computeAttendanceReview(db, { month: 10, year: 2026, config: cfg, releaseDays: ['2026-10-07'] });

describe('workbook', () => {
  test('sheets, numbers as numbers, totals, rules', () => {
    const db = F.newDb(); cast(db);
    const wb = XLSX.read(X.buildWorkbook(result(db), { status: 'final', generated_by: 'adm' }), { type: 'buffer' });
    expect(wb.SheetNames).toEqual(['Summary', 'Action list', 'Early-exit warnings', 'Notice late', 'Notice early', 'By department', 'All with late or early', 'Shift issues', 'Shift check', 'Payroll checks', 'Rules used']);
    const al = XLSX.utils.sheet_to_json(wb.Sheets['Action list']);
    expect(al.map((r) => [r.Code, r.Action, r['Deduction days']])).toEqual([['X1', 'deduction', 1], ['X2', 'warning', 0]]);
    expect(typeof al[0]['Workdays lost']).toBe('number');
    const sum = XLSX.utils.sheet_to_json(wb.Sheets.Summary, { header: 1 });
    expect(sum.find((r) => r[0] === 'Status')[1]).toBe('FINAL');
    expect(sum.find((r) => r[0] === 'Deduction days')[1]).toBe(1);
    expect(sum.find((r) => r[0] === 'Release days (not counted)')[1]).toBe('2026-10-07');
    expect(XLSX.utils.sheet_to_json(wb.Sheets['Early-exit warnings']).map((r) => r.Code)).toEqual(['X3']);
  });
});

describe('Word pack', () => {
  test('action list, both notices, one note per person; notices carry no money; names cleaned; contractor copy', async () => {
    const db = F.newDb(); cast(db);
    const text = docxText(await X.buildDocx(result(db), { status: 'final' }, { now: new Date('2026-10-10T06:00:00Z') }));
    expect(text).toMatch('Late Coming & Early Exit – Action List, October 2026');
    expect(text).toMatch('Prepared 10 October 2026');
    expect(text).toMatch('2 people: 1 gets a deduction note (1 day in total, about ₹1,000), 1 gets a warning note.');
    expect(text).toMatch('Late Coming – October 2026'); expect(text).toMatch('Leaving Early – October 2026');
    expect(text).toMatch('Ref: HR/ATT/OCT26/01'); expect(text).toMatch('Ref: HR/ATT/OCT26/03');
    expect(text).toMatch('deduction of 1 day'); expect(text).toMatch('As you have joined recently');
    expect(text).toMatch('Copy to: MEERA contractor');
    expect(text).toMatch('TEST EMP ONE  (Code X1)'); expect(text).not.toMatch('TEST EMP ONE 12');
    expect(text).not.toMatch('DRAFT');
    const notices = text.slice(text.indexOf('NOTICE'), text.indexOf('Ref: HR/ATT'));
    expect(notices).not.toMatch('₹'); expect(notices).not.toMatch(/\bmin\b/);
    expect(notices.length).toBeGreaterThan(200);
    expect(notices).toMatch('TEST EMP THREE');
    expect(notices).toMatch('(7 Oct) are not counted');
  });

  test('draft is marked on every page group; Option C wording when switched on', async () => {
    const db = F.newDb(); cast(db);
    const text = docxText(await X.buildDocx(result(db, { early_exit_rule: 'option_c' }), { status: 'draft' }));
    expect((text.match(/DRAFT — not finalised/g) || []).length).toBe(1 + 3);        // action list + each of 3 notes
    expect(text).toMatch('Option C applies'); expect(text).toMatch('Early exits are deducted from salary in half-day steps.');
    expect(text).toMatch('a deduction of 1.5 days will be made');
  });

  test('shift check: sheet, rule recorded, "check master shift" flagged in the action list', async () => {
    const db = F.newDb();
    // H1 leaves 3 h early every day (19 counted: 7 Oct is a release day) → deduction, flagged "check master shift".
    F.emp(db, 'H1', { name: 'TEST SHORT' }); F.month(db, 'H1', 2026, 9, 22); F.month(db, 'H1', 2026, 10, 20, () => ({ em: 180 }));
    // H2 "early" every day by the system but in at 07:00 → full hours, nothing counted, not shown.
    F.emp(db, 'H2', { name: 'TEST FULL' }); F.month(db, 'H2', 2026, 9, 22); F.month(db, 'H2', 2026, 10, 20, () => ({ it: '07:00', em: 60 }));
    const r = result(db);
    const wb = XLSX.read(X.buildWorkbook(r, { status: 'draft' }), { type: 'buffer' });
    expect(XLSX.utils.sheet_to_json(wb.Sheets['Shift check']).map((x) => [x.Code, x.Counted, x.Result]))
      .toEqual([['H1', 19, 'Check master shift'], ['H2', 0, 'Not shown – full hours worked']]);
    expect(XLSX.utils.sheet_to_json(wb.Sheets['Action list']).map((x) => [x.Code, x['Shift check']])).toEqual([['H1', 'check master shift']]);
    expect(XLSX.utils.sheet_to_json(wb.Sheets['Rules used'], { header: 1 }).find((x) => x[0] === 'shift_fit')[1]).toBe('habitual');
    const text = docxText(await X.buildDocx(r, { status: 'final' }));
    expect(text).toMatch('1 person flagged "check master shift" – confirm the shift before issuing.');
    expect(text).toMatch('Check master shift: leaves early almost daily');
    expect(text).not.toMatch('TEST FULL');
  });

  test('a month with nobody selected still produces a valid file', async () => {
    const db = F.newDb(); F.emp(db, 'X9'); F.month(db, 'X9', 2026, 10, 20);
    const text = docxText(await X.buildDocx(result(db), { status: 'final' }));
    expect(text).toMatch('0 people'); expect(text).toMatch('No individual notes for October 2026.');
  });
});

describe('download routes', () => {
  const BASE = '/api/analytics/attendance-review';
  let api; let id;
  beforeAll(async () => {
    api = startJwtApi({ [BASE]: '../../routes/attendanceReview' }, { users: [{ username: 'adm', role: 'admin' }, { username: 'hr1', role: 'hr' }] });
    cast(api.db);
    id = (await api.request('POST', `${BASE}/runs`, { as: 'adm', body: { month: 10, year: 2026, releaseDays: ['2026-10-07'] } })).body.data.id;
  });
  afterAll(() => api.close());

  test('admin downloads both files; draft in the file name; one audit row per download', async () => {
    const http = require('http');
    const get = (url) => new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port: api.server.address().port, path: url, headers: { Authorization: `Bearer ${api.tokens.adm}` } }, (res) => {
        const chunks = []; res.on('data', (c) => chunks.push(c)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      }); req.on('error', reject); req.end();
    });
    const x = await get(`${BASE}/runs/${id}/export.xlsx`);
    expect(x.status).toBe(200);
    expect(x.headers['content-disposition']).toBe('attachment; filename="Attendance_Review_Oct2026_DRAFT.xlsx"');
    expect(XLSX.read(x.body, { type: 'buffer' }).SheetNames[0]).toBe('Summary');
    const d = await get(`${BASE}/runs/${id}/export.docx`);
    expect(d.status).toBe(200);
    expect(d.headers['content-disposition']).toBe('attachment; filename="Oct2026_Late_Early_Action_Notes_DRAFT.docx"');
    expect(docxText(d.body)).toMatch('DRAFT — not finalised');
    await api.request('PUT', `${BASE}/runs/${id}/finalise`, { as: 'adm' });
    const f = await get(`${BASE}/runs/${id}/export.docx`);
    expect(f.headers['content-disposition']).toBe('attachment; filename="Oct2026_Late_Early_Action_Notes.docx"');
    expect(docxText(f.body)).not.toMatch('DRAFT');
    expect(api.db.prepare("SELECT COUNT(*) n FROM audit_log WHERE stage = 'ATTENDANCE_REVIEW_EXPORT'").get().n).toBe(3);
  });

  test('HR refused, unknown run 404, anonymous 401', async () => {
    expect((await api.request('GET', `${BASE}/runs/${id}/export.xlsx`, { as: 'hr1' })).status).toBe(403);
    expect((await api.request('GET', `${BASE}/runs/${id}/export.docx`, { as: 'hr1' })).status).toBe(403);
    expect((await api.request('GET', `${BASE}/runs/999/export.xlsx`, { as: 'adm' })).status).toBe(404);
    expect((await api.request('GET', `${BASE}/runs/${id}/export.docx`)).status).toBe(401);
  });
});
