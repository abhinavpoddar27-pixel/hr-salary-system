# PR-A — single punch becomes a miss punch (`fix/single-punch-miss-punch`)

Owner ruling 16 Oct 2026: any day with exactly one punch is raised as a miss punch whatever EESL's
status. A lone evening punch → "missing check-in"; a lone morning punch → "missing check-out".
From 1 Oct 2026 only — no clean-up of past months.

## Bug
EESL marks a day with one punch "A" (it reads a lone evening exit as a late entry: 19:22 → 20:00 =
38 min). `detectMissPunches` skipped every row whose status was not P/WOP/½P/WO½P, so these days never
reached the Miss Punch page and were paid as absences with no review. 2026 to date: 289 days,
78 employees, ≈ ₹2.51 lakh (not repaired, by ruling). Second gap: even if HR had typed the times,
`resolveMissPunch` never changed `status_final`, so the day stayed A.

## Fix (`backend/src/services/missPunch.js`, `frontend/src/pages/MissPunch.jsx`)
- Detection: status A or WO, exactly one punch, date ≥ start date, HR has not re-labelled the day
  (status_final = status_original), not part of a night pair, and the day is closed (this person's next
  day has a punch, or two days have passed, or it is the month's last day and the month is over — an open
  night check-in is not raised). Start date: `policy_config.single_punch_miss_punch_from`
  ('YYYY-MM-DD', or 'off'); default 2026-10-01. No row → default (no schema change, no config key seeded).
- Resolve: on such a day, entering IN + OUT sets status_final from hours worked against the shift's
  full / half-day minimum (P / ½P; WOP / WO½P on a weekly off); below the half-day minimum the status is
  left alone. Audit row (stage "Stage 2"). Stage 6 uses it only after finance approves (unchanged rule).
  "Mark absent" (convert) path unchanged.
- Screen: a lone evening punch flagged Missing IN pre-fills as the OUT time; IN is left empty.

## Independent review fixes (16 Oct)
- **Night shifts the pairing missed** (lone 20:00 on D + lone morning punch on D+1, the exit stored as an IN):
  D is raised as NIGHT_UNPAIRED (IN kept, HR adds the OUT → 12 h → one P) and D+1 is not raised — otherwise
  one shift could be resolved into two paid days. Detection also reads the day before / after the file's range
  from the database, so a night shift across a month end is seen whole.
- **Reimport / dedupe dropped the flag** on resolved rows (pre-existing for all miss punches): `import.js`
  replay now restores `is_miss_punch` + type from the snapshot; `POST /attendance/deduplicate` resets the flag
  only on unresolved rows. Without this a reimport paid HR's resolution as P before finance decided
  (Stage 6 reads a resolved day only through the flag).
- **Status upgrade scoped**: only for dates from the rule's start date and only when HR has not re-labelled the day.

## Verified
- New `backend/src/__tests__/singlePunchMissPunch.test.js` 21 (incl. night / month-end / scoping cases).
- Full jest 122 suites / 2193 pass.
- `backend/scripts/single-punch-reimport-check.py` (real import of a synthetic Oct .xls + reimport) 10/10;
  with the import.js / attendance.js fixes reverted 4 fail (reimport pays the day before finance).
- `backend/scripts/single-punch-sim.py` (real server.js, scratch DB, real hr + finance logins) 13/13:
  re-detect via POST /attendance/deduplicate → 7 Oct on the list as Missing IN, a no-punch absence not
  listed; resolve → P + audit; Stage 6 before finance: no change; after finance approve: +1 present day.
- `backend/scripts/single-punch-ui-check.py` (Chromium, built dist) 7/7: pre-fill at 1440 and 390 px,
  ordinary Missing OUT unchanged, save from the screen → P, 0 page errors.
- No salary / day-calc file touched; drift unaffected.

## Fragile
- The 17:00 split (lone IN-only punch at/after 17:00 = exit) is in `singlePunchIssue`.
- Detection only sees one month's rows; the month-end rule covers the last day.
- A lone evening punch whose next day is not in the database yet (month end before the next file) is raised as
  Missing IN; HR's gate times still give one day.
- From October single-punch rows count toward the 40-a-day bulk-failure threshold the Attendance Review uses.

## Not tested
Railway; a real EESL import file for October (detection path is the same function).

## Open
Monday 7 Sep 2026 (no morning punches for anyone, 131 regular staff marked A) — owner to confirm whether
the plant worked; outside this PR.
