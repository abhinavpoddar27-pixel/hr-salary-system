#!/usr/bin/env bash
# PR-0 user simulation — drives the REAL server over HTTP with REAL JWT auth.
#
# The jest suite mounts the routers behind a stub auth middleware. This script
# boots backend/server.js as a whole, logs in as hr / admin / finance / viewer
# with real passwords, and exercises the floor the way a person would. It exists
# because a stubbed req.user cannot prove the role guards hold end to end.
#
# Scratch DATA_DIR, torn down at exit. Never point this at a real database.
set -uo pipefail

PORT="${PORT:-3997}"
BASE="http://127.0.0.1:${PORT}"
WORK="$(mktemp -d)"
PASS=0
FAIL=0

cleanup() {
  [[ -n "${SRV_PID:-}" ]] && kill "$SRV_PID" 2>/dev/null
  wait "${SRV_PID:-}" 2>/dev/null
  rm -rf "$WORK"
}
trap cleanup EXIT

check() { # check <label> <expected> <actual>
  if [[ "$2" == "$3" ]]; then
    printf '  ✓ %s\n' "$1"; PASS=$((PASS+1))
  else
    printf '  ✗ %s — expected [%s], got [%s]\n' "$1" "$2" "$3"; FAIL=$((FAIL+1))
  fi
}

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

DATA_DIR="$WORK" JWT_SECRET=sim-secret PORT="$PORT" NODE_ENV=development \
  ADMIN_PASSWORD='Admin@123' HR_PASSWORD='Indriyan@2025' FINANCE_PASSWORD='Finance@2025' \
  node "$ROOT/backend/server.js" > "$WORK/server.log" 2>&1 &
SRV_PID=$!

for _ in $(seq 1 60); do
  curl -sf "$BASE/api/version" >/dev/null 2>&1 && break
  sleep 0.5
done
if ! curl -sf "$BASE/api/version" >/dev/null 2>&1; then
  echo "server did not come up; log follows:"; tail -30 "$WORK/server.log"; exit 1
fi

DB="$WORK/hr_system.db"

login() { # login <user> <pass>
  curl -s -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' \
    -d "{\"username\":\"$1\",\"password\":\"$2\"}" \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(JSON.parse(s).token||"")}catch{process.stdout.write("")}})'
}

api() { # api <token> <method> <path> [json]
  if [[ -n "${4:-}" ]]; then
    curl -s -o "$WORK/body" -w '%{http_code}' -X "$2" "$BASE$3" \
      -H "Authorization: Bearer $1" -H 'Content-Type: application/json' -d "$4"
  else
    curl -s -o "$WORK/body" -w '%{http_code}' -X "$2" "$BASE$3" -H "Authorization: Bearer $1"
  fi
}

sql() { node -e '
const D=require(process.argv[1]+"/backend/node_modules/better-sqlite3");
const d=new D(process.argv[2],{readonly:true});
const r=d.prepare(process.argv[3]).get();
process.stdout.write(r===undefined?"":String(Object.values(r)[0]));
' "$ROOT" "$DB" "$1"; }

echo "── logging in ──"
HR=$(login hr 'Indriyan@2025')
ADMIN=$(login admin 'Admin@123')
FIN=$(login finance 'Finance@2025')
check "hr token issued"      "yes" "$([[ -n $HR ]] && echo yes || echo no)"
check "admin token issued"   "yes" "$([[ -n $ADMIN ]] && echo yes || echo no)"
check "finance token issued" "yes" "$([[ -n $FIN ]] && echo yes || echo no)"

echo "── seeding an employee with 3 CL ──"
CODE="SIM001"
YEAR=$(date +%Y)
node -e '
const D=require(process.argv[1]+"/backend/node_modules/better-sqlite3");
const d=new D(process.argv[2]);
const info=d.prepare(`INSERT INTO employees (code,name,department,company,employment_type,status,date_of_joining,gross_salary)
  VALUES (?,?,?,?,?,?,?,?)`).run(process.argv[3],"SIM PERSON","PRODUCTION","Indriyan Beverages Pvt Ltd","Permanent","Active","2023-01-01",20000);
d.prepare(`INSERT INTO leave_balances (employee_id,year,leave_type,opening,accrued,used,balance)
  VALUES (?,?,?,?,0,0,?)`).run(info.lastInsertRowid, Number(process.argv[4]), "CL", 3, 3);
' "$ROOT" "$DB" "$CODE" "$YEAR"
check "starting balance" "3" "$(sql "SELECT balance FROM leave_balances WHERE leave_type='CL'")"

adj() { # adj <token> <days> <type> [extra json]
  api "$1" POST /api/leaves/adjust \
    "{\"employee_code\":\"$CODE\",\"leave_type\":\"CL\",\"transaction_type\":\"$3\",\"days\":$2,\"reason\":\"simulation run\"${4:-}}"
}

echo "── happy path: an HR debit that fits ──"
check "HTTP 200" "200" "$(adj "$HR" 2 Debit)"
check "balance 3 → 1" "1" "$(sql "SELECT balance FROM leave_balances WHERE leave_type='CL'")"

echo "── edge: a debit one day larger than the balance ──"
check "HTTP 400" "400" "$(adj "$HR" 2 Debit)"
check "balance untouched at 1" "1" "$(sql "SELECT balance FROM leave_balances WHERE leave_type='CL'")"
check "error names the shortfall" "yes" \
  "$(grep -q 'day(s) available' "$WORK/body" && echo yes || echo no)"

echo "── edge: non-admin override, good reason ──"
check "HTTP 400" "400" "$(adj "$HR" 2 Debit ',"allow_negative":true,"negative_reason":"authorised by the owner"')"
check "code NEGATIVE_OVERRIDE_NOT_ADMIN" "yes" \
  "$(grep -q 'NEGATIVE_OVERRIDE_NOT_ADMIN' "$WORK/body" && echo yes || echo no)"
check "balance untouched at 1" "1" "$(sql "SELECT balance FROM leave_balances WHERE leave_type='CL'")"

echo "── edge: admin override with a 3-character reason ──"
check "HTTP 400" "400" "$(adj "$ADMIN" 2 Debit ',"allow_negative":true,"negative_reason":"abc"')"
check "code NEGATIVE_OVERRIDE_REASON_REQUIRED" "yes" \
  "$(grep -q 'NEGATIVE_OVERRIDE_REASON_REQUIRED' "$WORK/body" && echo yes || echo no)"
check "balance untouched at 1" "1" "$(sql "SELECT balance FROM leave_balances WHERE leave_type='CL'")"

echo "── admin override with a real reason ──"
check "HTTP 200" "200" "$(adj "$ADMIN" 3 Debit ',"allow_negative":true,"negative_reason":"authorised by the owner, ticket 412"')"
check "balance 1 → -2" "-2" "$(sql "SELECT balance FROM leave_balances WHERE leave_type='CL'")"
check "audit row written" "1" \
  "$(sql "SELECT COUNT(*) FROM audit_log WHERE action_type='leave_balance_negative_override'")"
check "audit row names the real user" "admin" \
  "$(sql "SELECT changed_by FROM audit_log WHERE action_type='leave_balance_negative_override'")"

echo "── repair: a negative balance can still be credited ──"
check "HTTP 200" "200" "$(adj "$HR" 2 Credit)"
check "balance -2 → 0" "0" "$(sql "SELECT balance FROM leave_balances WHERE leave_type='CL'")"

echo "── the incident shape: six one-day debits against 4 CL ──"
node -e '
const D=require(process.argv[1]+"/backend/node_modules/better-sqlite3");
new D(process.argv[2]).prepare("UPDATE leave_balances SET balance=4, used=0 WHERE leave_type=?").run("CL");
' "$ROOT" "$DB"
OK=0; NO=0
for _ in 1 2 3 4 5 6; do
  if [[ "$(adj "$HR" 1 Debit)" == "200" ]]; then OK=$((OK+1)); else NO=$((NO+1)); fi
done
check "4 accepted" "4" "$OK"
check "2 refused"  "2" "$NO"
check "balance floors at 0 (was -2 in production)" "0" \
  "$(sql "SELECT balance FROM leave_balances WHERE leave_type='CL'")"

echo "── role guards ──"
VIEWER_OUT=$(curl -s -o "$WORK/body" -w '%{http_code}' -X PUT "$BASE/api/employees/$CODE/leaves" \
  -H "Authorization: Bearer $FIN" -H 'Content-Type: application/json' \
  -d "{\"year\":$YEAR,\"leaveType\":\"CL\",\"opening\":5,\"used\":0}")
check "PUT /:code/leaves refuses finance" "403" "$VIEWER_OUT"
check "PUT /:code/leaves accepts hr" "200" \
  "$(api "$HR" PUT "/api/employees/$CODE/leaves" "{\"year\":$YEAR,\"leaveType\":\"CL\",\"opening\":5,\"used\":0}")"
check "PUT /:code/leaves refuses used > opening" "400" \
  "$(api "$HR" PUT "/api/employees/$CODE/leaves" "{\"year\":$YEAR,\"leaveType\":\"CL\",\"opening\":2,\"used\":9}")"
check "mark-present refuses hr" "403" \
  "$(api "$HR" POST /api/finance-audit/corrections/mark-present '{}')"
check "mark-present lets finance past the gate" "400" \
  "$(api "$FIN" POST /api/finance-audit/corrections/mark-present '{}')"

echo "── employee portal leave-history (the created_at 500) ──"
node -e '
const D=require(process.argv[1]+"/backend/node_modules/better-sqlite3");
const d=new D(process.argv[2]);
const bcrypt=require(process.argv[1]+"/backend/node_modules/bcryptjs");
d.prepare("INSERT INTO users (username,password_hash,role,is_active,employee_code) VALUES (?,?,?,1,?)")
  .run("simemp", bcrypt.hashSync("Sim@12345",10), "employee", process.argv[3]);
d.prepare(`INSERT INTO leave_applications (employee_code,leave_type,start_date,end_date,days,reason,status)
  VALUES (?,?,?,?,?,?,?)`).run(process.argv[3],"CL","2026-03-10","2026-03-10",1,"sim","Pending");
' "$ROOT" "$DB" "$CODE"
EMP=$(login simemp 'Sim@12345')
check "employee token issued" "yes" "$([[ -n $EMP ]] && echo yes || echo no)"
check "GET /api/portal/leave-history is 200, not 500" "200" \
  "$(api "$EMP" GET /api/portal/leave-history)"
check "it returns the application" "yes" \
  "$(grep -q '"leave_type":"CL"' "$WORK/body" && echo yes || echo no)"

echo
echo "════════════════════════════════════════"
printf 'PASS %d   FAIL %d\n' "$PASS" "$FAIL"
echo "════════════════════════════════════════"
[[ $FAIL -eq 0 ]]
