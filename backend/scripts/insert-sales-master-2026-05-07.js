#!/usr/bin/env node
/*
 * One-shot insert: 36 new sales employees (S196 - S231) into Indriyan Beverages Pvt Ltd.
 *
 * Modes:
 *   node backend/scripts/insert-sales-master-2026-05-07.js --dry-run
 *     -> Per-row collision check, prints summary, exits 0 (no collisions) or 1 (collisions).
 *
 *   node backend/scripts/insert-sales-master-2026-05-07.js
 *     -> Opens a single transaction. Re-runs collision check inside the txn; if any
 *        collision is found, throws to abort the entire transaction (no partial inserts).
 *        On success, executes 36 INSERTs and commits.
 *
 * Constraints:
 *   - Reads/writes only the sales_employees table.
 *   - Uses the existing getDb() helper from backend/src/database/db.js.
 *   - Wraps all writes in db.transaction(...)() (single-call commit/rollback).
 */

const path = require('path');
const { getDb } = require(path.join(__dirname, '..', 'src', 'database', 'db.js'));

const COMPANY = 'Indriyan Beverages Pvt Ltd';
const SOURCE_TAG = 'master_import_2026-05-07';

// [code, name, aadhaar, doj, city_of_operation, designation, gross_salary,
//  bank_name, account_no, ifsc,
//  ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary, ta_da_notes]
const ROWS = [
  ['S196','NIKHIL CHAUDHARY','971956566514','2026-04-23','LUCKNOW','TSI',18000,'HDFC BANK','50100673991310','HDFC0001943',1,300,null,null,null,null],
  ['S197','SARBJIT SINGH','689317589625','2026-04-23','KAPURTHALA','TSI',20000,'HDFC BANK','50100765080369','HDFC0000138',3,150,null,2.5,null,null],
  ['S198','AHMAD AYAZ','297585722364','2026-04-20','SOUTH DELHI','ASM',60000,'KOTAK','8111137103','KKBK0000183',1,500,null,null,null,null],
  ['S199','RANJEET SINGH CHAUHAN','221676625466','2026-04-20','ALIGARH/AGRA/MATHURA','ASM',60000,'SBI','37527351866','SBIN0007278',4,350,500,4,null,'DA range 350-500 per source sheet (in-city/outstation tiered)'],
  ['S200','AMANDEEP','244199618880','2026-04-17','JALANDHAR','TSI',18000,'SBI','65081949846','SBIN0050261',1,150,null,null,null,null],
  ['S201','RAVI THAKUR','906843236493','2026-04-17','MEERUT','TSI',18000,'CANARA BANK','0199108056768','CNRB0000199',1,200,null,null,null,null],
  ['S202','JUNIT KUMAR','469707730043','2026-04-16','MEERUT','TSI',17000,'UP GRAMIN BANK','91168800005716','PUNB0SUPGB5',1,200,null,null,null,null],
  ['S203','MOHD NADEEM','841153548494','2026-04-15','MEERUT','TSI',18000,'PNB','0339101700013301','PUNB0033910',1,200,null,null,null,null],
  ['S204','MOHAMMAD IMRAN','738890492039','2026-04-06','MEERUT','TSI',16000,'PNB','04142121005642','PUNB0041410',1,200,null,null,null,null],
  ['S205','RAHUL SHARMA','778306780268','2026-04-06','MEERUT','SO',24000,'ICICI','083101005642','ICIC0000976',3,250,null,4,null,null],
  ['S206','SAGAR','540944242442','2026-04-06','MEERUT','TSI',16000,'KOTAK','3950220696','KKBK0005148',1,200,null,null,null,null],
  ['S207','VINAY KUMAR','374917712931','2026-04-02','GHAZIABAD','TSI',15000,'PNB','4950001500044435','PUNB0495000',1,150,null,null,null,null],
  ['S208','MANINDER TRIPATHI','395539469717','2026-04-01','NORTH DELHI','TSI',20000,'UNION BANK','052522160000073','UBIN0905259',1,150,null,null,null,null],
  ['S209','MOHD SHAHZEB','649175743265','2026-04-01','GHAZIABAD/ALIGARH','TSI',14000,'INDIAN OVERSEAS','246701000013864','IOBA0002467',1,150,null,null,null,null],
  ['S210','DEEPAK SINDHU','315771286016','2026-03-26','GHAZIABAD','TSI',22000,'UNION BANK','695702010013814','UBIN0569577',1,250,null,null,null,null],
  ['S211','JAGDEEP','362107300556','2026-02-23','KAPURTHALA','SO',25000,'SBI','65230241203','SBIN0050065',3,200,null,2,null,'Source sheet originally had Aadhaar 502032283400 which collided with S178 NIKHIL MALHOTRA; corrected to 362107300556 in revised sheet 2026-05-07'],
  ['S212','POOJA RANI','780137434061','2026-01-05','BULANDSHAR','TSI',15000,'PNB','2204001700215761','PUNB0220400',1,100,null,null,null,'Source sheet had TA=100 (non-standard). Per Abhinav 2026-05-07: treat as Class 1 (DA only, ignore TA=100)'],
  ['S213','MOHAMMAD FAIZ','442726140912','2026-03-25','EAST DELHI','TSI',20000,'KOTAK','5350237656','KKBK0004608',1,150,null,null,null,null],
  ['S214','KESHAV DUDEJA','602022564214','2026-03-23','BIJNOR/HARYANA','SO',23000,'SBI','55155184516','SBIN0016018',1,100,null,null,null,null],
  ['S215','DEEPAK KAPOOR','292564303228','2026-03-20','MEERUT','TSI',20000,'BOB','32670100007671','BARB0MERDEL',1,200,null,null,null,null],
  ['S216','ZAID','218744193338','2026-03-17','EAST DELHI','TSI',20000,'SBI','45019538727','SBIN0002408',1,150,null,null,null,null],
  ['S217','NISHANT SHARMA','505623813972','2026-03-16','SHARANPUR','TSI',17000,'SBI','38148629257','SBIN0012493',3,150,null,3,null,'Source sheet listed designation as "SR" (not a valid master designation). Per Abhinav 2026-05-07: use TSI based on salary/profile fit'],
  ['S218','ZAFAR','845222750882','2026-03-16','SIWAN MEERUT','TSI',18000,'CANARA BANK','87872010018057','CNRB0018787',1,200,null,null,null,null],
  ['S219','TARUN KHULLAR','913321928810','2026-03-06','AMRITSAR','TSI',18500,'SBI','34887710292','SBIN0008297',3,150,null,2,null,null],
  ['S220','NADEEM AHMED','444726042833','2026-02-26','MEERUT','TSI',21000,'SBI','10456877998','SBIN0002488',1,250,null,null,null,null],
  ['S221','PAWAN KUMAR','529245972048','2026-02-23','RAJPURA','TSI',20000,'SBI','65247789249','SBIN0050362',3,200,null,2,null,null],
  ['S222','ARYAN KAMBHOJ','589393816574','2026-02-16','HARYANA','TSI',18000,'PNB','0110101700016873','PUNR0011010',3,150,null,2,null,null],
  ['S223','HARVEER SINGH VERMA','305158366528','2026-02-02','PILAKHUA','SO',24850,'PNB','4187000100137776','PUNB0418700',1,150,null,null,null,'Source sheet had TA=100 (non-standard). Per Abhinav 2026-05-07: treat as Class 1 (DA only, ignore TA=100)'],
  ['S224','RAKESH KUMAR','471808510474','2026-04-01','LUDHIANA','SO',27000,'AXIS','920010032660711','UTIB0004174',1,650,null,null,null,null],
  ['S225','AFROZ ALI','819425138635','2026-04-01','SOUTH DELHI','TSI',20000,'AXIS','919010091795423','UTIB0004195',1,200,null,null,null,null],
  ['S226','ASALAM','385504562906','2026-04-01','SOUTH DELHI','TSI',20000,'SBI','45031482846','SBIN0011482',1,200,null,null,null,null],
  ['S227','MOHIT','310516637867','2026-04-01','HAPUR','TSI',18000,'SBI','44927437134','SBIN0017491',1,100,null,null,null,'Source sheet had TA=100 (non-standard). Per Abhinav 2026-05-07: treat as Class 1 (DA only, ignore TA=100)'],
  ['S228','MUNENDRA KUMAR','514432485222','2026-04-01','MURADABAD/RAMPUR','SO',25000,'PNB','2034100100001035','PUNB0203410',1,300,null,null,null,null],
  ['S229','MUNESH KUMAR','762304971637','2026-04-01','NOIDA','TSI',20000,'CANARA BANK','4147101013206','CNRB0004147',1,100,null,null,null,'Source sheet had TA=100 (non-standard). Per Abhinav 2026-05-07: treat as Class 1 (DA only, ignore TA=100)'],
  ['S230','NAVEEN KHANNA','335454862020','2026-04-01','BATHINDA','ASM',55000,'AXIS','916010019135673','UTIB0000791',3,400,null,7,null,null],
  ['S231','NITIN SOREN','593372523948','2026-04-01','NORTH DELHI','TSI',20000,'INDUSIND BANK','158447479906','INDB0000044',1,150,null,null,null,'Aadhaar 593372523948 also appears on existing employee S139 NITIN (same bank account). Per Abhinav 2026-05-07: insert as separate person, both records to remain Active'],
];

const INSERT_SQL = `
  INSERT INTO sales_employees (
    code, name, aadhaar, doj,
    city_of_operation, designation,
    gross_salary, pf_applicable, esi_applicable, pt_applicable,
    bank_name, account_no, ifsc,
    company, status,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_notes, ta_da_updated_at, ta_da_updated_by,
    created_by, updated_by
  ) VALUES (
    ?, ?, ?, ?,
    ?, ?,
    ?, 0, 0, 0,
    ?, ?, ?,
    'Indriyan Beverages Pvt Ltd', 'Active',
    ?, ?, ?, ?, ?,
    ?, datetime('now'), 'master_import_2026-05-07',
    'master_import_2026-05-07', 'master_import_2026-05-07'
  );
`;

function classDistribution(rows) {
  const dist = {};
  for (const r of rows) {
    const cls = r[10];
    dist[cls] = (dist[cls] || 0) + 1;
  }
  return dist;
}

function findCollisions(db, rows) {
  const stmt = db.prepare('SELECT 1 FROM sales_employees WHERE code = ? AND company = ?');
  const collisions = [];
  for (const r of rows) {
    const code = r[0];
    if (stmt.get(code, COMPANY)) {
      collisions.push(code);
    }
  }
  return collisions;
}

function bindParams(row) {
  // 16 placeholders in order:
  // code, name, aadhaar, doj, city, designation, gross_salary,
  // bank_name, account_no, ifsc,
  // ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
  // ta_da_notes
  return [
    row[0], row[1], row[2], row[3],
    row[4], row[5],
    row[6],
    row[7], row[8], row[9],
    row[10], row[11], row[12], row[13], row[14],
    row[15],
  ];
}

function runDryRun() {
  const db = getDb();
  const collisions = findCollisions(db, ROWS);
  const dist = classDistribution(ROWS);
  console.log(`Would insert ${ROWS.length} rows. Collisions: ${collisions.length}` +
    (collisions.length ? ` (${collisions.join(', ')})` : ''));
  console.log(`Class distribution: ${JSON.stringify(dist)}`);
  if (collisions.length > 0) {
    process.exit(1);
  }
  process.exit(0);
}

function runLive() {
  const db = getDb();
  const insert = db.prepare(INSERT_SQL);

  const txn = db.transaction(() => {
    // Re-check collisions inside the transaction so we abort cleanly if a
    // concurrent writer beat us to one of the codes between dry-run and live.
    const collisions = findCollisions(db, ROWS);
    if (collisions.length > 0) {
      throw new Error(`Code collision: ${collisions.join(', ')}`);
    }
    for (const r of ROWS) {
      insert.run(...bindParams(r));
    }
  });

  txn();

  const dist = classDistribution(ROWS);
  const first = ROWS[0][0];
  const last = ROWS[ROWS.length - 1][0];
  console.log(`Inserted ${ROWS.length} rows: ${first} through ${last}. Class distribution: ${JSON.stringify(dist)}.`);
}

function main() {
  const dryRun = process.argv.includes('--dry-run');
  if (dryRun) {
    runDryRun();
  } else {
    runLive();
  }
}

main();
