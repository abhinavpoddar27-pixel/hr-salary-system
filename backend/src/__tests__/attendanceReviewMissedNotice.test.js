/**
 * Missed-punch notices (16 Oct 2026): the mid-month board counts every flagged miss punch whatever the day's
 * status (a one-punch day EESL marks absent is a missed punch too); the monthly review lists people with
 * board_miss_punch_min (3)+ own missed punches. Bulk-failure days and days from today on are not counted;
 * left-out and held people are not listed. Names, codes and counts only. Synthetic codes (MN…).
 */
const F = require('./helpers/attendanceReviewFixture');
const S = require('../services/attendanceReviewService');
const XLSX = require('xlsx');
const { buildWorkbook, buildDocx } = require('../services/attendanceReviewExports');
const zlib = require('zlib');

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


const wd = F.weekdays(2026, 10);
const first15 = wd.filter((d) => d <= '2026-10-15');
const RULES = { standing_people: { MNOUT: { rule: 'exclude', reason: 'Senior staff' }, MNHELD: { rule: 'held', reason: 'Awaiting ruling' } } };
const cfg = (c = RULES) => S.mergeConfig(c);

function seed(db) {
  // MNABS: 2 worked-day miss punches + 1 single-punch absent day → 3 (was 2 under the old worked-only count)
  F.emp(db, 'MNABS'); first15.forEach((d, i) => F.day(db, 'MNABS', d, i === 2 || i === 4 ? { mp: 1 } : i === 6 ? { st: 'A', mp: 1, ot: null } : {}));
  // MNTWO: 2 missed punches → not named
  F.emp(db, 'MNTWO'); first15.forEach((d, i) => F.day(db, 'MNTWO', d, i < 2 ? { mp: 1 } : {}));
  // MNONLY: only single-punch absent days, no worked day at all → still named
  F.emp(db, 'MNONLY'); first15.slice(0, 3).forEach((d) => F.day(db, 'MNONLY', d, { st: 'A', mp: 1, ot: null }));
  // MNOUT / MNHELD: 4 each → left out / held, never listed
  for (const c of ['MNOUT', 'MNHELD']) { F.emp(db, c); first15.slice(0, 4).forEach((d) => F.day(db, c, d, { mp: 1 })); }
  // MNLATE: 2 own + 2 on a bulk-failure day → 2 counted
  F.emp(db, 'MNLATE'); first15.slice(0, 2).forEach((d) => F.day(db, 'MNLATE', d, { mp: 1 }));
  F.day(db, 'MNLATE', '2026-10-09', { mp: 1 });
  // 40 others with a miss punch on 9 Oct → 9 Oct is a bulk-failure day
  for (let i = 0; i < 40; i++) { const c = `MNB${String(i).padStart(2, '0')}`; F.emp(db, c); F.day(db, c, '2026-10-09', { mp: 1 }); }
  // MNTODAY: 2 earlier + 1 today (20 Oct) → 2 counted before today
  F.emp(db, 'MNTODAY'); F.day(db, 'MNTODAY', '2026-10-12', { mp: 1 }); F.day(db, 'MNTODAY', '2026-10-13', { mp: 1 }); F.day(db, 'MNTODAY', '2026-10-20', { mp: 1 });
}

describe('missed-punch notices', () => {
  let db;
  beforeAll(() => { db = F.newDb(); seed(db); });

  test('board: a single-punch absent day counts as a missed punch', () => {
    const b = S.noticeBoard(db, { month: 10, year: 2026, to: '2026-10-15', config: RULES, today: '2026-10-20' });
    const missed = b.listed.filter((x) => x.flags.missed).map((x) => x.code).sort();
    expect(missed).toEqual(['MNABS', 'MNONLY']);
    expect(b.listed.find((x) => x.code === 'MNABS').missed_punches).toBe(3);
    expect(b.meta.bulk_miss_punch_days.map((x) => x.date)).toEqual(['2026-10-09']);
  });

  test('monthly notice: 3+ own missed punches, bulk days and today on left out, held + left-out not listed', () => {
    const list = S.missedPunchNotice(db, 10, 2026, cfg(), '2026-10-20');
    expect(list).toEqual([
      { code: 'MNABS', name: 'Test MNABS', department: 'PRODUCTION', missed_punches: 3 },
      { code: 'MNONLY', name: 'Test MNONLY', department: 'PRODUCTION', missed_punches: 3 },
    ]);
    // after the month the 20 Oct punch counts → MNTODAY reaches 3
    expect(S.missedPunchNotice(db, 10, 2026, cfg(), '2026-11-02').map((x) => x.code)).toContain('MNTODAY');
    // threshold follows the config
    expect(S.missedPunchNotice(db, 10, 2026, cfg({ ...RULES, thresholds: { board_miss_punch_min: 2 } }), '2026-10-20').map((x) => x.code).sort())
      .toEqual(['MNABS', 'MNLATE', 'MNONLY', 'MNTODAY', 'MNTWO']);
    // counts only — no money, minutes or dates
    expect(Object.keys(list[0]).sort()).toEqual(['code', 'department', 'missed_punches', 'name']);
  });

  test('a month not started yet → empty', () => {
    expect(S.missedPunchNotice(db, 10, 2026, cfg(), '2026-10-01')).toEqual([]);
  });

  test('the monthly review result carries noticeMissed; the workbook gets its sheet', () => {
    const r = S.computeAttendanceReview(db, { month: 10, year: 2026, config: RULES });
    expect(Array.isArray(r.noticeMissed)).toBe(true);
    expect(r.noticeMissed.map((x) => x.code)).toEqual(expect.arrayContaining(['MNABS', 'MNONLY']));
    const wb = XLSX.read(buildWorkbook(r, {}), { type: 'buffer' });
    expect(wb.SheetNames).toContain('Notice missed punch');
    // an older stored result without the key still exports
    const old = { ...r }; delete old.noticeMissed;
    expect(XLSX.read(buildWorkbook(old, {}), { type: 'buffer' }).SheetNames).toContain('Notice missed punch');
  });

  test('Word pack: a "Missed Punches" notice page with names and counts, none when nobody is named', async () => {
    const r = S.computeAttendanceReview(db, { month: 10, year: 2026, config: RULES });
    const text = docxText(await buildDocx(r, { status: 'final' }));
    expect(text).toMatch('Missed Punches');
    expect(text).toMatch('MNABS');
    const empty = docxText(await buildDocx({ ...r, noticeMissed: [] }, { status: 'final' }));
    expect(empty).not.toMatch('Missed Punches');
  });
});
