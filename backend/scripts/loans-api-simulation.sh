#!/usr/bin/env bash
# Loans PR-3 user simulation — drives the REAL server over HTTP with REAL logins.
#
# Boots backend/server.js on a scratch DATA_DIR, logs in as admin / hr / finance
# with real passwords, creates a viewer and an employee portal user (the login
# limiter allows 5 logins per 15 minutes, so exactly 5 are used), and walks one loan through its whole life:
#   raise → approve → (gate refuses) → disburse → receipt → defer → close-out.
# Plus the refusals a person would hit: viewer writes, admin raising, hr
# approving, the disbursement gate, the missing agreement, the retired paths.
#
# Scratch DATA_DIR, torn down at exit. Never point this at a real database.
set -uo pipefail

PORT="${PORT:-3996}"
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
TODAY="$(TZ=Asia/Kolkata date +%Y-%m-%d)"

login() { # login <user> <pass>
  curl -s -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' \
    -d "{\"username\":\"$1\",\"password\":\"$2\"}" \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(JSON.parse(s).token||"")}catch{process.stdout.write("")}})'
}

api() { # api <token> <method> <path> [json]  → prints the HTTP status, body in $WORK/body
  if [[ -n "${4:-}" ]]; then
    curl -s -o "$WORK/body" -w '%{http_code}' -X "$2" "$BASE$3" \
      -H "Authorization: Bearer $1" -H 'Content-Type: application/json' -d "$4"
  else
    curl -s -o "$WORK/body" -w '%{http_code}' -X "$2" "$BASE$3" -H "Authorization: Bearer $1"
  fi
}

jget() { # jget <dot.path> → value from the last body
  node -e '
let v; try { v = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); } catch { process.exit(0); }
for (const k of process.argv[2].split(".")) { if (v == null) break; v = v[k]; }
process.stdout.write(v === undefined || v === null ? "" : (typeof v === "object" ? JSON.stringify(v) : String(v)));
' "$WORK/body" "$1"; }

sql() { node -e '
const D=require(process.argv[1]+"/backend/node_modules/better-sqlite3");
const d=new D(process.argv[2],{readonly:true});
const r=d.prepare(process.argv[3]).get();
process.stdout.write(r===undefined?"":String(Object.values(r)[0]));
' "$ROOT" "$DB" "$1"; }

sqlw() { node -e '
const D=require(process.argv[1]+"/backend/node_modules/better-sqlite3");
new D(process.argv[2]).prepare(process.argv[3]).run();
' "$ROOT" "$DB" "$1"; }

echo "── logging in ──"
ADMIN=$(login admin 'Admin@123')
HR=$(login hr 'Indriyan@2025')
FIN=$(login finance 'Finance@2025')
check "admin / hr / finance tokens issued" "yes" "$([[ -n $ADMIN && -n $HR && -n $FIN ]] && echo yes || echo no)"
api "$ADMIN" POST /api/auth/users '{"username":"simviewer","password":"View@12345","role":"viewer"}' >/dev/null
VIEW=$(login simviewer 'View@12345')
check "viewer token issued" "yes" "$([[ -n $VIEW ]] && echo yes || echo no)"

echo "── seeding one plant employee (DOJ 2023, gross ₹20,000) + portal user ──"
CODE="LSIM01"
node -e '
const D=require(process.argv[1]+"/backend/node_modules/better-sqlite3");
const bcrypt=require(process.argv[1]+"/backend/node_modules/bcryptjs");
const d=new D(process.argv[2]);
d.prepare(`INSERT INTO employees (code,name,department,company,employment_type,status,date_of_joining,gross_salary)
  VALUES (?,?,?,?,?,?,?,?)`).run(process.argv[3],"SIM PERSON","PRODUCTION","Indriyan Beverages Pvt Ltd","Permanent","Active","2023-01-01",20000);
d.prepare("INSERT INTO users (username,password_hash,role,is_active,employee_code) VALUES (?,?,?,1,?)")
  .run("simemp", bcrypt.hashSync("Emp@12345",10), "employee", process.argv[3]);
' "$ROOT" "$DB" "$CODE"
EMP=$(login simemp 'Emp@12345')
SAL_BEFORE="$(sql "SELECT COUNT(*) || '/' || COALESCE(SUM(net_salary),0) FROM salary_computations")"
LOAN_BODY="{\"employeeCode\":\"$CODE\",\"company\":\"Indriyan Beverages Pvt Ltd\",\"loanType\":\"Personal\",\"principal\":12000,\"tenure\":3,\"reason\":\"house repair\"}"

echo "── the gate and the seed ──"
check "loans_disbursement_enabled seeded 0" "0" "$(sql "SELECT value FROM policy_config WHERE key='loans_disbursement_enabled'")"
check "loan_requests table exists" "table" "$(sql "SELECT type FROM sqlite_master WHERE name='loan_requests'")"

echo "── refusals before anything exists ──"
check "no token → 401" "401" "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/loans")"
check "viewer can read the list" "200" "$(api "$VIEW" GET /api/loans)"
check "viewer cannot raise" "403" "$(api "$VIEW" POST /api/loans "$LOAN_BODY")"
check "admin cannot raise" "403" "$(api "$ADMIN" POST /api/loans "$LOAN_BODY")"
check "… with ADMIN_CANNOT_RAISE" "ADMIN_CANNOT_RAISE" "$(jget code)"
check "… and the owner's wording" "HR raises loans; admin approves" "$(jget error)"
check "company 'Default' refused" "400" "$(api "$HR" POST /api/loans "${LOAN_BODY/Indriyan Beverages Pvt Ltd/Default}")"
check "no loan written" "0" "$(sql "SELECT COUNT(*) FROM loans")"

echo "── hr raises, admin approves ──"
check "hr raises → 201" "201" "$(api "$HR" POST /api/loans "$LOAN_BODY")"
ID="$(jget data.loanId)"
check "EMI ₹4,000" "4000" "$(jget data.emi)"
check "admin notified" "1" "$(sql "SELECT COUNT(*) FROM notifications WHERE role_target='admin' AND type='LOAN_REQUESTED'")"
check "hr cannot approve" "403" "$(api "$HR" PUT "/api/loans/$ID/approve" '{}')"
check "finance cannot approve" "403" "$(api "$FIN" PUT "/api/loans/$ID/approve" '{}')"
check "admin approves → 200" "200" "$(api "$ADMIN" PUT "/api/loans/$ID/approve" '{"reason":"ok"}')"
check "status approved" "approved" "$(sql "SELECT status FROM loans WHERE id=$ID")"

echo "── disbursement gate (ruling A) ──"
DISB="{\"mode\":\"NEFT\",\"reference\":\"UTR-SIM-1\",\"disbursedOn\":\"$TODAY\",\"agreementRef\":\"HR-FILE/LOAN/0001\"}"
check "finance disburse while gate 0 → 409" "409" "$(api "$FIN" POST "/api/loans/$ID/disburse" "$DISB")"
check "… DISBURSEMENT_DISABLED" "DISBURSEMENT_DISABLED" "$(jget code)"
check "admin cannot switch the gate via PUT /policy" "400" \
  "$(api "$ADMIN" PUT /api/loans/policy '{"values":{"loans_disbursement_enabled":"1"},"reason":"go"}')"
check "… POLICY_KEY_LOCKED" "POLICY_KEY_LOCKED" "$(jget code)"
check "gate still 0" "0" "$(sql "SELECT value FROM policy_config WHERE key='loans_disbursement_enabled'")"
sqlw "UPDATE policy_config SET value='1' WHERE key='loans_disbursement_enabled'"   # scratch DB only (cutover action)
check "viewer cannot disburse" "403" "$(api "$VIEW" POST "/api/loans/$ID/disburse" "$DISB")"
check "no agreement → 400" "400" "$(api "$FIN" POST "/api/loans/$ID/disburse" "${DISB/HR-FILE\/LOAN\/0001/}")"
check "… AGREEMENT_REQUIRED" "AGREEMENT_REQUIRED" "$(jget code)"
check "finance disburses → 200" "200" "$(api "$FIN" POST "/api/loans/$ID/disburse" "$DISB")"
check "status active, balance 12000" "active/12000" "$(sql "SELECT status || '/' || CAST(remaining_balance AS INTEGER) FROM loans WHERE id=$ID")"
check "3 instalments" "3" "$(sql "SELECT COUNT(*) FROM loan_instalments WHERE loan_id=$ID")"

echo "── receipt, defer, close-out ──"
check "viewer cannot record a receipt" "403" "$(api "$VIEW" POST "/api/loans/$ID/receipts" "{\"amount\":100,\"mode\":\"cash\",\"receiptDate\":\"$TODAY\"}")"
check "finance receipt ₹4,000 → 201" "201" "$(api "$FIN" POST "/api/loans/$ID/receipts" "{\"amount\":4000,\"mode\":\"cash\",\"receiptDate\":\"$TODAY\"}")"
check "receipt is numbered" "yes" "$([[ "$(jget data.receiptNo)" =~ ^LR/[0-9]{4}-[0-9]{2}/00001$ ]] && echo yes || echo no)"
FIRST="$(sql "SELECT id FROM loan_instalments WHERE loan_id=$ID AND status='scheduled' ORDER BY sequence LIMIT 1")"
check "admin cannot raise a defer" "403" "$(api "$ADMIN" POST "/api/loans/$ID/requests" "{\"kind\":\"defer\",\"instalmentId\":$FIRST,\"reason\":\"leave\"}")"
check "hr raises a defer → 201" "201" "$(api "$HR" POST "/api/loans/$ID/requests" "{\"kind\":\"defer\",\"instalmentId\":$FIRST,\"reason\":\"medical leave\"}")"
RID="$(jget data.requestId)"
check "hr cannot approve it" "403" "$(api "$HR" POST "/api/loans/requests/$RID/approve" '{}')"
check "admin approves the defer → 200" "200" "$(api "$ADMIN" POST "/api/loans/requests/$RID/approve" '{}')"
check "instalment deferred, one added" "1/1" "$(sql "SELECT SUM(status='deferred') || '/' || SUM(origin='deferred') FROM loan_instalments WHERE loan_id=$ID")"
check "admin records the closing receipt → 201" "201" "$(api "$ADMIN" POST "/api/loans/$ID/receipts" "{\"amount\":8000,\"mode\":\"cheque\",\"reference\":\"CHQ-9\",\"receiptDate\":\"$TODAY\"}")"
check "loan completed" "completed" "$(jget data.loanStatus)"
check "GET detail: reconciliation ok" "200" "$(api "$VIEW" GET "/api/loans/$ID")"
check "… ok=true, balance 0" "true/0" "$(jget data.reconciliation.ok)/$(jget data.reconciliation.balance)"
check "statement closes at 0" "200/0" "$(api "$VIEW" GET "/api/loans/$ID/statement")/$(jget data.closing)"
check "audit rows carry the user" "0" "$(sql "SELECT COUNT(*) FROM audit_log WHERE table_name='loans' AND record_id=$ID AND (changed_by IS NULL OR changed_by='')")"
check "audit: request, approve, disburse, receipt, defer, complete" "6" \
  "$(sql "SELECT COUNT(DISTINCT action_type) FROM audit_log WHERE table_name='loans' AND record_id=$ID AND action_type IN ('loan_requested','loan_approved','loan_disbursed','loan_receipt','loan_deferred','loan_completed')")"

echo "── a rejected loan and the portal ──"
api "$HR" POST /api/loans "$LOAN_BODY" >/dev/null
ID2="$(jget data.loanId)"
check "admin rejects with a reason" "200" "$(api "$ADMIN" PUT "/api/loans/$ID2/reject" '{"reason":"recent loan just closed"}')"
check "portal is 200" "200" "$(api "$EMP" GET /api/portal/loans)"
check "portal shows the completed loan only" "[$ID]" "$(node -e 'const b=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(JSON.stringify(b.data.map(l=>l.id)))' "$WORK/body")"

echo "── retired endpoints ──"
check "process-deductions → 410" "410" "$(api "$FIN" POST /api/loans/process-deductions '{"month":10,"year":2026}')"
check "recover → 410" "410" "$(api "$FIN" POST "/api/loans/$ID/recover" '{"amount":1}')"
check "skip → 410" "410" "$(api "$HR" POST "/api/loans/$ID/skip" '{}')"
check "close → 410" "410" "$(api "$ADMIN" PUT "/api/loans/$ID/close" '{}')"

echo "── nothing outside the loan tables moved ──"
check "salary_computations unchanged" "$SAL_BEFORE" "$(sql "SELECT COUNT(*) || '/' || COALESCE(SUM(net_salary),0) FROM salary_computations")"
check "drift rows" "0" "$(sql "SELECT COUNT(*) FROM salary_computations WHERE ABS(net_salary - (gross_earned - total_deductions)) > 1")"
check "server logged no loan 500" "0" "$(grep -c '\[loans\].*failed' "$WORK/server.log")"

echo
echo "════════════════════════════════════════"
printf 'PASS %d   FAIL %d\n' "$PASS" "$FAIL"
echo "════════════════════════════════════════"
[[ $FAIL -eq 0 ]]
