-- STATUTORY FLAGS + LWF — production verification (READ-ONLY, one statement per run)
-- Run through the HR SQL Console (chat MCP or /admin/sql-console).
-- Structure lookups mirror compute: row in effect for the month, else the latest row (fallback, BUILD_PLAN L18).

-- V1 plant: flags in effect for September (expect esi 24, pf 6, lwf 118)
SELECT SUM(s.esi_applicable) esi_on, SUM(s.pf_applicable) pf_on, SUM(s.lwf_applicable) lwf_on FROM employees e JOIN salary_structures s ON s.id = COALESCE((SELECT x.id FROM salary_structures x WHERE x.employee_id=e.id AND x.effective_from<='2026-09-01' ORDER BY x.effective_from DESC LIMIT 1),(SELECT x.id FROM salary_structures x WHERE x.employee_id=e.id ORDER BY x.effective_from DESC LIMIT 1));

-- V2 plant, January–August 2026: anyone paid in a month whose in-effect structure has a flag ON
-- (baseline 9 Oct: exactly 5 rows — 22127, months 1–5, pre-existing PF flag. After the upload: the same 5, nothing else)
SELECT sc.month, sc.employee_code FROM salary_computations sc JOIN employees e ON e.code=sc.employee_code JOIN salary_structures s ON s.id = COALESCE((SELECT x.id FROM salary_structures x WHERE x.employee_id=e.id AND x.effective_from<=printf('2026-%02d-01',sc.month) ORDER BY x.effective_from DESC LIMIT 1),(SELECT x.id FROM salary_structures x WHERE x.employee_id=e.id ORDER BY x.effective_from DESC LIMIT 1)) WHERE sc.year=2026 AND sc.month BETWEEN 1 AND 8 AND (s.esi_applicable=1 OR s.pf_applicable=1 OR COALESCE(s.lwf_applicable,0)=1);

-- V3 plant September after recompute: rows breaking the rule (expect 0 rows)
SELECT sc.employee_code, sc.esi_employee, sc.pf_employee, sc.lwf_employee FROM salary_computations sc JOIN employees e ON e.code=sc.employee_code JOIN salary_structures s ON s.id = COALESCE((SELECT x.id FROM salary_structures x WHERE x.employee_id=e.id AND x.effective_from<='2026-09-01' ORDER BY x.effective_from DESC LIMIT 1),(SELECT x.id FROM salary_structures x WHERE x.employee_id=e.id ORDER BY x.effective_from DESC LIMIT 1)) WHERE sc.month=9 AND sc.year=2026 AND (ABS(sc.esi_employee - CASE WHEN s.esi_applicable=1 AND sc.gross_salary<=21000 THEN ROUND(sc.gross_earned*0.0075,2) ELSE 0 END)>0.05 OR ABS(sc.pf_employee - CASE WHEN s.pf_applicable=1 THEN ROUND(MIN(sc.basic_earned+sc.da_earned,15000)*0.12,2) ELSE 0 END)>0.05 OR ABS(sc.lwf_employee - CASE WHEN s.lwf_applicable=1 AND sc.gross_earned>0 THEN 5 ELSE 0 END)>0.05);

-- V3b row coverage: every September row must find a structure (expect checked = total = 211 on 9-Oct data)
SELECT COUNT(*) total, SUM(EXISTS(SELECT 1 FROM employees e JOIN salary_structures x ON x.employee_id=e.id WHERE e.code=sc.employee_code)) checked FROM salary_computations sc WHERE sc.month=9 AND sc.year=2026;

-- V4 plant September totals (expect ≈ esi_ee 2450.74, pf_ee 9762.86, lwf_ee 565, lwf_er 2260)
SELECT COUNT(*) rows_, SUM(esi_employee>0) esi_n, ROUND(SUM(esi_employee),2) esi_ee, ROUND(SUM(esi_employer),2) esi_er, SUM(pf_employee>0) pf_n, ROUND(SUM(pf_employee),2) pf_ee, SUM(lwf_employee>0) lwf_n, ROUND(SUM(lwf_employee),2) lwf_ee, ROUND(SUM(lwf_employer),2) lwf_er FROM salary_computations WHERE month=9 AND year=2026;

-- V5 plant drift identity (expect 0 rows)
SELECT employee_code, net_salary, gross_earned, total_deductions FROM salary_computations WHERE month=9 AND year=2026 AND ABS(net_salary-(gross_earned-total_deductions))>1;

-- V6 sales: flags in effect for cycle month 2026-09 (expect esi 57, pf 0, lwf 139)
SELECT SUM(st.esi_applicable) esi_on, SUM(st.pf_applicable) pf_on, SUM(st.lwf_applicable) lwf_on FROM sales_employees e JOIN sales_salary_structures st ON st.id = COALESCE((SELECT x.id FROM sales_salary_structures x WHERE x.employee_id=e.id AND x.effective_from<='2026-09' ORDER BY x.effective_from DESC, x.id DESC LIMIT 1),(SELECT x.id FROM sales_salary_structures x WHERE x.employee_id=e.id ORDER BY x.effective_from DESC, x.id DESC LIMIT 1));

-- V6b sales, cycles before September: anyone computed with a flag ON in effect (expect 0 rows)
SELECT sc.month, sc.employee_code FROM sales_salary_computations sc JOIN sales_employees e ON e.code=sc.employee_code AND e.company=sc.company JOIN sales_salary_structures st ON st.id = COALESCE((SELECT x.id FROM sales_salary_structures x WHERE x.employee_id=e.id AND x.effective_from<=printf('%d-%02d',sc.year,sc.month) ORDER BY x.effective_from DESC, x.id DESC LIMIT 1),(SELECT x.id FROM sales_salary_structures x WHERE x.employee_id=e.id ORDER BY x.effective_from DESC, x.id DESC LIMIT 1)) WHERE sc.year=2026 AND sc.month<9 AND (st.esi_applicable=1 OR st.pf_applicable=1 OR COALESCE(st.lwf_applicable,0)=1);

-- V7 sales September after recompute: rule check (expect 0 rows)
SELECT sc.employee_code, sc.esi_employee, sc.lwf_employee FROM sales_salary_computations sc JOIN sales_employees e ON e.code=sc.employee_code AND e.company=sc.company JOIN sales_salary_structures st ON st.id = COALESCE((SELECT x.id FROM sales_salary_structures x WHERE x.employee_id=e.id AND x.effective_from<='2026-09' ORDER BY x.effective_from DESC, x.id DESC LIMIT 1),(SELECT x.id FROM sales_salary_structures x WHERE x.employee_id=e.id ORDER BY x.effective_from DESC, x.id DESC LIMIT 1)) WHERE sc.month=9 AND sc.year=2026 AND (ABS(sc.esi_employee - CASE WHEN st.esi_applicable=1 AND sc.gross_monthly<=21000 THEN ROUND(sc.gross_earned*0.0075,2) ELSE 0 END)>0.05 OR ABS(sc.lwf_employee - CASE WHEN st.lwf_applicable=1 AND sc.gross_earned>0 THEN 5 ELSE 0 END)>0.05);

-- V8 sales identity (expect 0 rows)
SELECT employee_code FROM sales_salary_computations WHERE month=9 AND year=2026 AND ABS(net_salary-(gross_earned+COALESCE(diwali_bonus,0)+COALESCE(incentive_amount,0)-total_deductions))>1;

-- V9 upload batches (expect one applied plant + one applied sales batch for 2026-09)
SELECT id, scope, effective_month, row_count, changed_count, status, applied_by, applied_at FROM statutory_flag_batches ORDER BY id DESC LIMIT 5;

-- V10 run right after each apply. Expect plant 124 employees / 248 rows (freeze + effective each;
-- 23152 unchanged), sales 139 employees / 270 rows (139 freeze + 131 effective; 8 updated in place).
-- Any other structure created after the apply time also shows up here:
SELECT 'plant' scope, COUNT(DISTINCT employee_id) emps, COUNT(*) rows_ FROM salary_structures WHERE created_at >= (SELECT MIN(applied_at) FROM statutory_flag_batches WHERE scope='plant') UNION ALL SELECT 'sales', COUNT(DISTINCT employee_id), COUNT(*) FROM sales_salary_structures WHERE created_at >= (SELECT MIN(applied_at) FROM statutory_flag_batches WHERE scope='sales');

-- V11 plant component check (statutory flags PR-2): total_deductions = the 10 components + LWF(EE) within ₹1.
-- Expect ONLY the 5 known capped rows (3/2026 ×2, 4/2026 ×1, 5/2026 ×2 — DEDUCTIONS_EXCEED_EARNINGS); any other row fails.
SELECT month, year, employee_code, ROUND((COALESCE(pf_employee,0)+COALESCE(esi_employee,0)+COALESCE(professional_tax,0)+COALESCE(tds,0)+COALESCE(advance_recovery,0)+COALESCE(lop_deduction,0)+COALESCE(other_deductions,0)+COALESCE(loan_recovery,0)+COALESCE(late_coming_deduction,0)+COALESCE(early_exit_deduction,0)+COALESCE(lwf_employee,0))-total_deductions,2) AS components_minus_total FROM salary_computations WHERE ABS(total_deductions-(COALESCE(pf_employee,0)+COALESCE(esi_employee,0)+COALESCE(professional_tax,0)+COALESCE(tds,0)+COALESCE(advance_recovery,0)+COALESCE(lop_deduction,0)+COALESCE(other_deductions,0)+COALESCE(loan_recovery,0)+COALESCE(late_coming_deduction,0)+COALESCE(early_exit_deduction,0)+COALESCE(lwf_employee,0)))>1 ORDER BY year, month, employee_code;

-- V12 plant LWF rule, September after recompute (expect 0 rows): LWF = the policy amounts (default 5/20) exactly when the in-force structure has lwf=1 and gross_earned > 0, else 0/0.
-- (PR-2b M6: amounts read from policy_config, as compute does; a non-numeric value reads as 0 here and shows up as rows.)
SELECT sc.employee_code, sc.gross_earned, sc.lwf_employee, sc.lwf_employer, st.lwf_applicable FROM salary_computations sc JOIN employees e ON e.code=sc.employee_code JOIN salary_structures st ON st.id = COALESCE((SELECT x.id FROM salary_structures x WHERE x.employee_id=e.id AND x.effective_from<='2026-09-01' ORDER BY x.effective_from DESC LIMIT 1),(SELECT x.id FROM salary_structures x WHERE x.employee_id=e.id ORDER BY x.effective_from DESC LIMIT 1)) WHERE sc.month=9 AND sc.year=2026 AND (ABS(sc.lwf_employee - CASE WHEN st.lwf_applicable=1 AND sc.gross_earned>0 THEN COALESCE((SELECT CAST(value AS REAL) FROM policy_config WHERE key='lwf_employee_amount'),5) ELSE 0 END)>0.005 OR ABS(sc.lwf_employer - CASE WHEN st.lwf_applicable=1 AND sc.gross_earned>0 THEN COALESCE((SELECT CAST(value AS REAL) FROM policy_config WHERE key='lwf_employer_amount'),20) ELSE 0 END)>0.005);

-- V13 sales component check (statutory flags PR-2b): total_deductions = the 7 sales components + LWF(EE) within ₹1, every month.
-- Expect 0 rows. Run on production BEFORE PR-2b deploys as the baseline (no sales row carries LWF yet), and after every sales compute.
SELECT month, year, company, employee_code, ROUND((COALESCE(pf_employee,0)+COALESCE(esi_employee,0)+COALESCE(professional_tax,0)+COALESCE(tds,0)+COALESCE(advance_recovery,0)+COALESCE(loan_recovery,0)+COALESCE(other_deductions,0)+COALESCE(lwf_employee,0))-total_deductions,2) AS components_minus_total FROM sales_salary_computations WHERE ABS(total_deductions-(COALESCE(pf_employee,0)+COALESCE(esi_employee,0)+COALESCE(professional_tax,0)+COALESCE(tds,0)+COALESCE(advance_recovery,0)+COALESCE(loan_recovery,0)+COALESCE(other_deductions,0)+COALESCE(lwf_employee,0)))>1 ORDER BY year, month, company, employee_code;

-- V14 sales LWF rule for ONE cycle month after its compute (expect 0 rows): LWF = the policy amounts (default 5/20) exactly when the in-force
-- sales structure (V7's join = compute's pick, fallback included) has lwf=1 and gross_earned > 0, else 0/0. Literal month 10 / '2026-10' = October;
-- for a September re-run (RUNBOOK 6A) change BOTH to 9 / '2026-09'.
SELECT sc.company, sc.employee_code, sc.gross_earned, sc.lwf_employee, sc.lwf_employer, st.lwf_applicable FROM sales_salary_computations sc JOIN sales_employees e ON e.code=sc.employee_code AND e.company=sc.company JOIN sales_salary_structures st ON st.id = COALESCE((SELECT x.id FROM sales_salary_structures x WHERE x.employee_id=e.id AND x.effective_from<='2026-10' ORDER BY x.effective_from DESC, x.id DESC LIMIT 1),(SELECT x.id FROM sales_salary_structures x WHERE x.employee_id=e.id ORDER BY x.effective_from DESC, x.id DESC LIMIT 1)) WHERE sc.month=10 AND sc.year=2026 AND (ABS(sc.lwf_employee - CASE WHEN st.lwf_applicable=1 AND sc.gross_earned>0 THEN COALESCE((SELECT CAST(value AS REAL) FROM policy_config WHERE key='lwf_employee_amount'),5) ELSE 0 END)>0.005 OR ABS(sc.lwf_employer - CASE WHEN st.lwf_applicable=1 AND sc.gross_earned>0 THEN COALESCE((SELECT CAST(value AS REAL) FROM policy_config WHERE key='lwf_employer_amount'),20) ELSE 0 END)>0.005);
