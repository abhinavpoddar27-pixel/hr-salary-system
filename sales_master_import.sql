-- Sales Employee Master — Bootstrap Import (v2 — corrected schema)
-- Generated: 2026-04-25
-- Supersedes: sales_master_import.sql v1 (which had wrong column names)
--
-- Source: Sales_Salary_master.xlsx (JAN 26 bank sheet)
-- Total: 167 employees (176 source - 3 merges - 6 outliers)
-- Classification: Class 1=65, Class 3=77, Class 4=23, Class 5=2
--
-- Schema fixes vs v1:
--   city → city_of_operation
--   is_active=1 → status='Active'
--   basic_monthly/hra_monthly/cca_monthly/conveyance_monthly → moved to sales_salary_structures
--   gross_monthly → gross_salary (single column on sales_employees)
--   company: 'indriyan' → 'Indriyan Beverages Pvt Ltd'
--
-- Bootstrap marker: ta_da_updated_by = 'master_import_2026-04-24'
-- Salary structures use effective_from = '2026-01' (the JAN 26 bank reference month)
--
-- Outliers (6) NOT imported — HR re-adds via UI:
--   DILIP KUMAR PODDAR (87129), RAJENDER (87189), POOJA (86948),
--   HARVEER SINGH VERMA (87008), JAGDEEP (87311), MOHIT (87078)
--
-- Merged pairs (3):
--   SAMIR MAHIR: 87250 + 87251 (legacy_code='87250|87251')
--   DIVYANSH: 87305 + 87306 (legacy_code='87305|87306')
--   MUKESH KUMAR SAH: 87319 + 87320 (legacy_code='87319|87320')

BEGIN TRANSACTION;

-- S001 | NISHAN SINGH | class=3 | legacy=87353
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S001', '87353', 'NISHAN SINGH', 'Indriyan Beverages Pvt Ltd', 'AMRITSAR', 'SO', '2023-04-20', 'Active',
    'HDFC BANK', '50100554922931', NULL,
    18000.0,
    3, 200.0, NULL, 3.0, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S002 | SPARSH HARISH | class=4 | legacy=87309
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S002', '87309', 'SPARSH HARISH', 'Indriyan Beverages Pvt Ltd', 'BANGA', 'TSI', '2023-04-20', 'Active',
    'SBI BANK', '37775050398', NULL,
    30000.0,
    4, 150.0, 200.0, 3.0, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S003 | VIPAN KUMAR | class=4 | legacy=87555
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S003', '87555', 'VIPAN KUMAR', 'Indriyan Beverages Pvt Ltd', 'AMRITSAR', 'TSI', '2023-04-20', 'Active',
    'SBI BANK', '55139446234', NULL,
    21600.0,
    4, 120.0, 150.0, 2.0, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S004 | VIJAY KUMAR | class=3 | legacy=87315
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S004', '87315', 'VIJAY KUMAR', 'Indriyan Beverages Pvt Ltd', 'DELHI', 'TSI', '2023-04-29', 'Active',
    'PNB BANK', '4907000100147625', NULL,
    23700.0,
    3, 150.0, NULL, 2.0, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S005 | AMIT TYAGI | class=5 | legacy=86875
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S005', '86875', 'AMIT TYAGI', 'Indriyan Beverages Pvt Ltd', 'MEERUT', 'ASM', '2023-06-12', 'Active',
    'CANARA BANK', '88492210019622', NULL,
    58000.0,
    5, 300.0, 300.0, 3.0, 6.0,
    'master_import_2026-04-24', datetime('now')
);
-- S006 | GULSHAN | class=4 | legacy=87029
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S006', '87029', 'GULSHAN', 'Indriyan Beverages Pvt Ltd', 'NAKODAR', 'TSI', '2023-06-21', 'Active',
    'CAPITAL SMALL FIN BANK', '010205001306', 'CLBL0000010',
    23000.0,
    4, 150.0, 200.0, 2.5, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S007 | LOVEPREET SINGH | class=3 | legacy=87349
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S007', '87349', 'LOVEPREET SINGH', 'Indriyan Beverages Pvt Ltd', 'JALANDHAR', 'SO', '2023-06-24', 'Active',
    'UNION BANK', '390602010151260', 'UBINO539066',
    30000.0,
    3, 150.0, NULL, 2.5, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S008 | DAVINDER SINGH | class=3 | legacy=86899
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S008', '86899', 'DAVINDER SINGH', 'Indriyan Beverages Pvt Ltd', 'JAMALPUR', 'SO', '2024-01-01', 'Active',
    'CENTRAL BANK OF INDIA', '3786839267', 'PUNBO024010',
    28000.0,
    3, 150.0, NULL, 2.0, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S009 | POOJA | class=3 | legacy=87215
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S009', '87215', 'POOJA', 'Indriyan Beverages Pvt Ltd', 'GHAZIYABAD', 'TSI', '2024-01-08', 'Active',
    'UNION BANK', '612102010012931', 'UBIN0561215',
    23700.0,
    3, 100.0, NULL, 3.0, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S010 | AMIT KUMAR | class=3 | legacy=10002
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S010', '10002', 'AMIT KUMAR', 'Indriyan Beverages Pvt Ltd', 'BULANDSHAR', 'SO', '2024-01-15', 'Active',
    'ICICI BANK', '016001528359', 'ICIC0000160',
    26000.0,
    3, 200.0, NULL, 3.0, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S011 | ROHIT VERMA | class=3 | legacy=87341
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S011', '87341', 'ROHIT VERMA', 'Indriyan Beverages Pvt Ltd', 'LUDHIANA', 'TSI', '2024-01-22', 'Active',
    'SBI BANK', '41109616932', 'SBIN0050638',
    16000.0,
    3, 100.0, NULL, 2.0, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S012 | MANJEET SINGH | class=3 | legacy=87340
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S012', '87340', 'MANJEET SINGH', 'Indriyan Beverages Pvt Ltd', 'JALANDHAR', 'TSI', '2024-03-04', 'Active',
    'SBI BANK', '65209605338', 'SBIN0050454',
    20000.0,
    3, 100.0, NULL, 2.0, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S013 | SHIV PRASAD MISHRA | class=3 | legacy=87342
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S013', '87342', 'SHIV PRASAD MISHRA', 'Indriyan Beverages Pvt Ltd', 'DADRI', 'SO', '2024-03-04', 'Active',
    'SBI BANK', '37300330069', 'SBIN0011477',
    26400.0,
    3, 200.0, NULL, 3.0, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S014 | KISHAN KUMAR | class=3 | legacy=87174
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S014', '87174', 'KISHAN KUMAR', 'Indriyan Beverages Pvt Ltd', 'SIKANDRABAD', 'TSI', '2024-03-12', 'Active',
    'SBI BANK', '32892402413', 'SBIN0016353',
    19500.0,
    3, 200.0, NULL, 2.0, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S015 | KRISHAN DUTT SHARMA | class=4 | legacy=87282
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S015', '87282', 'KRISHAN DUTT SHARMA', 'Indriyan Beverages Pvt Ltd', 'FARIDABAD', 'ASM', '2024-03-18', 'Active',
    'PNB BANK', '4172000100319950', NULL,
    37000.0,
    4, 300.0, 350.0, 3.0, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S016 | SANJAY KUMAR | class=3 | legacy=87053
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S016', '87053', 'SANJAY KUMAR', 'Indriyan Beverages Pvt Ltd', 'AMRITSAR', 'SO', '2024-04-01', 'Active',
    'CENTRAL BANK OF INDIA', '5219405958', 'CBIN0280340',
    24000.0,
    3, 200.0, NULL, 3.0, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S017 | VIJAY KUMAR | class=3 | legacy=87334
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S017', '87334', 'VIJAY KUMAR', 'Indriyan Beverages Pvt Ltd', 'JALANDHAR', 'TSI', '2024-04-29', 'Active',
    'SBI', '43786480684', NULL,
    17000.0,
    3, 150.0, NULL, 2.0, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S018 | SHUBHAM KAPOOR | class=4 | legacy=87352
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S018', '87352', 'SHUBHAM KAPOOR', 'Indriyan Beverages Pvt Ltd', 'PHAGWARA', 'SO', '2024-05-01', 'Active',
    'UNION BANK', '498202010018797', 'UBIN0549827',
    20000.0,
    4, 150.0, 200.0, 2.5, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S019 | AYUSH BHATIA | class=4 | legacy=10013
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S019', '10013', 'AYUSH BHATIA', 'Indriyan Beverages Pvt Ltd', 'AMRITSAR', 'SSO', '2024-05-25', 'Active',
    'BOB', '01010100017350', NULL,
    22000.0,
    4, 200.0, 250.0, 3.0, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S020 | DEV NARAYAN | class=3 | legacy=87083
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S020', '87083', 'DEV NARAYAN', 'Indriyan Beverages Pvt Ltd', 'EAST DELHI', 'TSI', '2024-07-18', 'Active',
    'HDFC BANK', '50100742022532', 'HDFC0007716',
    18000.0,
    3, 150.0, NULL, 3.0, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S021 | MANMEET SINGH | class=3 | legacy=87101
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S021', '87101', 'MANMEET SINGH', 'Indriyan Beverages Pvt Ltd', 'LUDHIANA', 'SO', '2024-07-31', 'Active',
    'SBI', '65209824474', 'SBIN0001826',
    24200.0,
    3, 100.0, NULL, 3.0, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S022 | SACHIN OJHA | class=3 | legacy=86767
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S022', '86767', 'SACHIN OJHA', 'Indriyan Beverages Pvt Ltd', 'SHIMLAPURI', 'SO', '2024-08-27', 'Active',
    'KOTAK BANK', '2848846932', NULL,
    18500.0,
    3, 125.0, NULL, 2.0, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S023 | SANJAY ARORA | class=3 | legacy=87184
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S023', '87184', 'SANJAY ARORA', 'Indriyan Beverages Pvt Ltd', 'PATIALA', 'SR ASM', '2024-09-20', 'Active',
    'SBI BANK', '43766104771', 'SBIN0050244',
    70000.0,
    3, 400.0, NULL, 8.0, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S024 | PRAVEEN BANSAL | class=3 | legacy=87274
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S024', '87274', 'PRAVEEN BANSAL', 'Indriyan Beverages Pvt Ltd', 'BULANDSHAR', 'ASE', '2024-10-07', 'Active',
    'ICICI BANK', '003101203619', NULL,
    28000.0,
    3, 150.0, NULL, 2.5, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S025 | UMESH KUMAR | class=3 | legacy=87030
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S025', '87030', 'UMESH KUMAR', 'Indriyan Beverages Pvt Ltd', 'NORTH DELHI', 'ASM', '2024-10-14', 'Active',
    'PNB BANK', '1051000100373269', 'PUNBO105100',
    42000.0,
    3, 250.0, NULL, 3.0, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S026 | HARISH KHANNA | class=3 | legacy=86607
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S026', '86607', 'HARISH KHANNA', 'Indriyan Beverages Pvt Ltd', 'SAMRALA', 'ASE', '2024-11-25', 'Active',
    'AXIS BANK', '922010064359261', NULL,
    35000.0,
    3, 250.0, NULL, 3.0, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S027 | VARINDERPAL | class=3 | legacy=87050
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S027', '87050', 'VARINDERPAL', 'Indriyan Beverages Pvt Ltd', 'AMRITSAR', 'TSI', '2024-12-16', 'Active',
    'PNB BANK', '3015000100075820', 'PUNBO301500',
    16500.0,
    3, 150.0, NULL, 2.0, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S028 | GAURAV SRIVASTAV | class=3 | legacy=87013
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S028', '87013', 'GAURAV SRIVASTAV', 'Indriyan Beverages Pvt Ltd', 'BAREILLY', 'ASM', '2025-01-02', 'Active',
    'CANARA BANK', '110181293156', NULL,
    100000.0,
    3, 300.0, NULL, 8.0, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S029 | VIJAY SHANKAR TIWARI | class=3 | legacy=87346
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S029', '87346', 'VIJAY SHANKAR TIWARI', 'Indriyan Beverages Pvt Ltd', 'LONI', 'SO', '2025-01-02', 'Active',
    'INDIAN BANK', '50368778424', NULL,
    22000.0,
    3, 200.0, NULL, 3.0, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S030 | KARAN | class=3 | legacy=87281
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S030', '87281', 'KARAN', 'Indriyan Beverages Pvt Ltd', 'JALANDHAR', 'TSI', '2025-01-17', 'Active',
    'PNB BANK', '4130000100187485', 'PUNB0413000',
    13000.0,
    3, 100.0, NULL, 2.0, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S031 | ANUJ SHARMA | class=4 | legacy=86997
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S031', '86997', 'ANUJ SHARMA', 'Indriyan Beverages Pvt Ltd', 'HARIDWAR', 'ASE', '2025-02-01', 'Active',
    'CANARA BANK', '2177101413272', 'CNRB0002177',
    37400.0,
    4, 200.0, 250.0, 3.0, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S032 | ROHIT | class=4 | legacy=86961
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S032', '86961', 'ROHIT', 'Indriyan Beverages Pvt Ltd', 'MUZAFFARNAGAR', 'ASE', '2025-02-01', 'Active',
    'PNB', '2553000101038569', NULL,
    37400.0,
    4, 200.0, 250.0, 3.0, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S033 | SUNIL SHARMA | class=5 | legacy=87165
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S033', '87165', 'SUNIL SHARMA', 'Indriyan Beverages Pvt Ltd', 'SAHARNPUR', 'ASM', '2025-02-01', 'Active',
    'SBI', '32627797289', NULL,
    52800.0,
    5, 300.0, 350.0, 3.0, 6.0,
    'master_import_2026-04-24', datetime('now')
);
-- S034 | YOGESH KUMAR | class=4 | legacy=87005
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S034', '87005', 'YOGESH KUMAR', 'Indriyan Beverages Pvt Ltd', 'CHHAPRAULI', 'ASE', '2025-02-01', 'Active',
    'PNB', '0578000100228324', 'PUNB0057800',
    37400.0,
    4, 250.0, 300.0, 3.0, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S035 | MANDEEP KUMAR | class=4 | legacy=87172
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S035', '87172', 'MANDEEP KUMAR', 'Indriyan Beverages Pvt Ltd', 'BANGA', 'TSI', '2025-02-06', 'Active',
    'HDFC BANK', '50100714010440', NULL,
    23000.0,
    4, 100.0, 150.0, 2.0, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S036 | GURMILAP SINGH | class=4 | legacy=87339
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S036', '87339', 'GURMILAP SINGH', 'Indriyan Beverages Pvt Ltd', 'FEROZPUR', 'SO', '2025-02-07', 'Active',
    'SBI BANK', '10747332477', NULL,
    21000.0,
    4, 200.0, 250.0, 2.0, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S037 | ASHISH MADAN | class=3 | legacy=87007
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S037', '87007', 'ASHISH MADAN', 'Indriyan Beverages Pvt Ltd', 'HARIDWAR', 'SO', '2025-02-19', 'Active',
    'PNB', '13842191013407', 'PUNB0138410',
    20900.0,
    3, 150.0, NULL, 3.0, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S038 | CHANDAN KUMAR | class=1 | legacy=86897
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S038', '86897', 'CHANDAN KUMAR', 'Indriyan Beverages Pvt Ltd', 'NOIDA', 'TSI', '2025-02-26', 'Active',
    'PNB', '1877010080802', NULL,
    18000.0,
    1, 150.0, NULL, NULL, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S039 | BARKAT ALI SHAH | class=3 | legacy=86615
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S039', '86615', 'BARKAT ALI SHAH', 'Indriyan Beverages Pvt Ltd', 'BAREILLY', 'TSI', '2025-03-06', 'Active',
    'BOB', '53328100005734', NULL,
    17000.0,
    3, 150.0, NULL, 3.0, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S040 | PANKAJ | class=3 | legacy=87102
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S040', '87102', 'PANKAJ', 'Indriyan Beverages Pvt Ltd', 'BAREILLY', 'SO', '2025-03-06', 'Active',
    'SBI', '30488826845', NULL,
    28000.0,
    3, 150.0, NULL, 4.0, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S041 | JATIN | class=3 | legacy=87345
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S041', '87345', 'JATIN', 'Indriyan Beverages Pvt Ltd', 'EAST DELHI', 'SO', '2025-03-20', 'Active',
    'UNION BANK', '651102010019645', NULL,
    23000.0,
    3, 150.0, NULL, 3.0, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S042 | ARJUN | class=3 | legacy=86851
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S042', '86851', 'ARJUN', 'Indriyan Beverages Pvt Ltd', 'EAST DELHI', 'SO', '2025-03-26', 'Active',
    'KOTAK BANK', '1213127799', NULL,
    23000.0,
    3, 150.0, NULL, 3.0, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S043 | MADHUR GARG | class=3 | legacy=87239
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S043', '87239', 'MADHUR GARG', 'Indriyan Beverages Pvt Ltd', 'BULANDSHAR', 'SO', '2025-04-01', 'Active',
    'YES BANK', '036892000007077', NULL,
    20000.0,
    3, 125.0, NULL, 3.0, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S044 | SALENDRA SHARMA | class=3 | legacy=86901
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S044', '86901', 'SALENDRA SHARMA', 'Indriyan Beverages Pvt Ltd', 'BULANDSHAR', 'TSI', '2025-04-01', 'Active',
    'KOTAK BANK', '4211919144', NULL,
    20000.0,
    3, 125.0, NULL, 2.0, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S045 | SANJEEV PIWAL | class=3 | legacy=87279
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S045', '87279', 'SANJEEV PIWAL', 'Indriyan Beverages Pvt Ltd', 'EAST DELHI', 'SO', '2025-04-02', 'Active',
    'PNB', '1988000102981722', NULL,
    25000.0,
    3, 150.0, NULL, 3.0, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S046 | RAVI KUMAR | class=1 | legacy=87326
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S046', '87326', 'RAVI KUMAR', 'Indriyan Beverages Pvt Ltd', 'BULANDSHAR', 'TSI', '2025-04-03', 'Active',
    'SBI', '40653613381', NULL,
    14000.0,
    1, 200.0, NULL, NULL, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S047 | ANUJ KUMAR | class=3 | legacy=87061
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S047', '87061', 'ANUJ KUMAR', 'Indriyan Beverages Pvt Ltd', 'KHURJA', 'SO', '2025-04-04', 'Active',
    'SBI', '20522834263', NULL,
    22000.0,
    3, 200.0, NULL, 2.5, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S048 | SHAH ALAM | class=3 | legacy=87222
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S048', '87222', 'SHAH ALAM', 'Indriyan Beverages Pvt Ltd', 'EAST DELHI', 'SO', '2025-04-04', 'Active',
    'ICICI', '083101520405', NULL,
    23000.0,
    3, 150.0, NULL, 3.0, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S049 | UJWAL SHARMA | class=3 | legacy=87137
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S049', '87137', 'UJWAL SHARMA', 'Indriyan Beverages Pvt Ltd', 'MUZAFARNAGAR', 'TSI', '2025-04-04', 'Active',
    'CANARA BANK', '2194101020765', NULL,
    16500.0,
    3, 150.0, NULL, 3.0, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S050 | SUNIL KUMAR | class=3 | legacy=86867
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S050', '86867', 'SUNIL KUMAR', 'Indriyan Beverages Pvt Ltd', 'GHAZIYABAD', 'SO', '2025-04-10', 'Active',
    'BOB', '38210100004398', NULL,
    25000.0,
    3, 200.0, NULL, 2.0, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S051 | SALIM HASSAN | class=1 | legacy=87194
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S051', '87194', 'SALIM HASSAN', 'Indriyan Beverages Pvt Ltd', 'DADRI', 'TSI', '2025-04-11', 'Active',
    'HDFC BANK', '50100474572051', NULL,
    18000.0,
    1, 200.0, NULL, NULL, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S052 | SACHIN KUMAR | class=1 | legacy=87164
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S052', '87164', 'SACHIN KUMAR', 'Indriyan Beverages Pvt Ltd', 'LONI', 'TSI', '2025-04-12', 'Active',
    'SBI', '42796601037', NULL,
    18000.0,
    1, 200.0, NULL, NULL, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S053 | HIMANSHU TYAGI | class=3 | legacy=86946
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S053', '86946', 'HIMANSHU TYAGI', 'Indriyan Beverages Pvt Ltd', 'MEERUT', 'TSI', '2025-04-26', 'Active',
    'PNB', '6443001700024456', NULL,
    18000.0,
    3, 150.0, NULL, 2.0, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S054 | YASH KUMAR | class=1 | legacy=87217
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S054', '87217', 'YASH KUMAR', 'Indriyan Beverages Pvt Ltd', 'HAPUR', NULL, '2025-04-28', 'Active',
    'UNION BANK', '328222010001353', NULL,
    18000.0,
    1, 200.0, NULL, NULL, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S055 | AKASH | class=1 | legacy=87295
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S055', '87295', 'AKASH', 'Indriyan Beverages Pvt Ltd', 'SARDANA', 'TSI', '2025-05-01', 'Active',
    'SBI', '43102477875', NULL,
    21000.0,
    1, 150.0, NULL, NULL, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S056 | ARUN TYAGI | class=3 | legacy=87304
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S056', '87304', 'ARUN TYAGI', 'Indriyan Beverages Pvt Ltd', 'HAPUR', 'TSI', '2025-05-05', 'Active',
    'SBI', '44494231674', NULL,
    18000.0,
    3, 150.0, NULL, 2.0, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S057 | KISHORE KUMAR | class=3 | legacy=87168
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S057', '87168', 'KISHORE KUMAR', 'Indriyan Beverages Pvt Ltd', 'CENTRAL DELHI', 'RSM', '2025-05-12', 'Active',
    'HDFC BANK', '50100474422791', NULL,
    72300.0,
    3, 500.0, NULL, 8.0, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S058 | LALU KUMAR PODDAR | class=1 | legacy=87348
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S058', '87348', 'LALU KUMAR PODDAR', 'Indriyan Beverages Pvt Ltd', 'NOIDA', 'TSI', '2025-05-31', 'Active',
    'UNION BANK', '522202120010016', NULL,
    18000.0,
    1, 150.0, NULL, NULL, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S059 | RAGHUBIR | class=3 | legacy=87133
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S059', '87133', 'RAGHUBIR', 'Indriyan Beverages Pvt Ltd', 'AMRITSAR', 'TSI', '2025-06-06', 'Active',
    'SBI', '43057340588', NULL,
    16500.0,
    3, 150.0, NULL, 2.0, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S060 | MANISH | class=3 | legacy=87298
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S060', '87298', 'MANISH', 'Indriyan Beverages Pvt Ltd', 'BARELLI', 'TSI', '2025-06-21', 'Active',
    'INDIAN BANK', '7808057552', NULL,
    18000.0,
    3, 150.0, NULL, 3.0, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S061 | SIMERJEET | class=1 | legacy=87280
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S061', '87280', 'SIMERJEET', 'Indriyan Beverages Pvt Ltd', 'LUDHIANA', 'TSI', '2025-06-26', 'Active',
    'PNB', '4433000100123391', NULL,
    15000.0,
    1, 150.0, NULL, NULL, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S062 | VIMAL KUMAR | class=1 | legacy=87139
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S062', '87139', 'VIMAL KUMAR', 'Indriyan Beverages Pvt Ltd', 'GHAZIYABAD', 'TSI', '2025-06-26', 'Active',
    'CANARA BANK', '3742101001570', NULL,
    18000.0,
    1, 200.0, NULL, NULL, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S063 | RAGHAVENDRA KUMAR RAGHAV | class=1 | legacy=10011
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S063', '10011', 'RAGHAVENDRA KUMAR RAGHAV', 'Indriyan Beverages Pvt Ltd', 'NOIDA', 'TSI', '2025-07-02', 'Active',
    'BANK OF INDIA', '466310110018991', NULL,
    18000.0,
    1, 150.0, NULL, NULL, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S064 | VIVEK KAPOOR | class=3 | legacy=87337
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S064', '87337', 'VIVEK KAPOOR', 'Indriyan Beverages Pvt Ltd', 'AMRITSAR', 'TSI', '2025-07-04', 'Active',
    'SBI', '40729906600', NULL,
    16500.0,
    3, 150.0, NULL, 2.5, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S065 | PANKAJ KUMAR | class=3 | legacy=87323
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S065', '87323', 'PANKAJ KUMAR', 'Indriyan Beverages Pvt Ltd', 'AMRITSAR', 'TSI', '2025-07-14', 'Active',
    'SBI', '38940634049', NULL,
    17500.0,
    3, 200.0, NULL, 2.5, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S066 | ARJUN | class=3 | legacy=87344
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S066', '87344', 'ARJUN', 'Indriyan Beverages Pvt Ltd', 'AMRITSAR', 'TSI', '2025-07-31', 'Active',
    'UNION BANK', '506502130000352', NULL,
    15000.0,
    3, 200.0, NULL, 2.5, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S067 | ROHIT TIWARI | class=1 | legacy=87271
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S067', '87271', 'ROHIT TIWARI', 'Indriyan Beverages Pvt Ltd', 'EAST DELHI', 'ASE', '2025-08-01', 'Active',
    'PNB', '3077000107262300', NULL,
    108333.0,
    1, 500.0, NULL, NULL, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S068 | NANDU JOSHI | class=1 | legacy=87321
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S068', '87321', 'NANDU JOSHI', 'Indriyan Beverages Pvt Ltd', 'DELHI', 'TSI', '2025-08-10', 'Active',
    'SBI', '34724850556', NULL,
    20000.0,
    1, 150.0, NULL, NULL, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S069 | PRABHAT KUMAR | class=1 | legacy=87187
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S069', '87187', 'PRABHAT KUMAR', 'Indriyan Beverages Pvt Ltd', 'NOIDA', 'TSI', '2025-08-11', 'Active',
    'HDFC BANK', '50100293182449', NULL,
    18000.0,
    1, 150.0, NULL, NULL, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S070 | MUHIBBUR REHMAN | class=1 | legacy=87318
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S070', '87318', 'MUHIBBUR REHMAN', 'Indriyan Beverages Pvt Ltd', 'AMBALA', 'TSI', '2025-08-26', 'Active',
    'SBI', '36991243926', NULL,
    18000.0,
    1, 200.0, NULL, NULL, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S071 | VARUN | class=1 | legacy=87043
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S071', '87043', 'VARUN', 'Indriyan Beverages Pvt Ltd', 'NOIDA', 'TSI', '2025-08-28', 'Active',
    'BOB', '45198100004066', NULL,
    18000.0,
    1, 150.0, NULL, NULL, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S072 | NANAK KOHLI | class=1 | legacy=87225
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S072', '87225', 'NANAK KOHLI', 'Indriyan Beverages Pvt Ltd', 'DELHI', 'SSO', '2025-09-10', 'Active',
    'INDIAN BANK', '50207501830', NULL,
    35000.0,
    1, 200.0, NULL, NULL, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S073 | VINOD KUMAR | class=1 | legacy=86731
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S073', '86731', 'VINOD KUMAR', 'Indriyan Beverages Pvt Ltd', 'DELHI', 'TSI', '2025-09-11', 'Active',
    'AXIS BANK', '919010005245424', NULL,
    23000.0,
    1, 150.0, NULL, NULL, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S074 | MOHD UMAR FARUKH | class=1 | legacy=87290
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S074', '87290', 'MOHD UMAR FARUKH', 'Indriyan Beverages Pvt Ltd', 'DELHI', 'TSI', '2025-09-12', 'Active',
    'PUNJAB & SIND', '07041000071286', NULL,
    16000.0,
    1, 150.0, NULL, NULL, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S075 | NITESH YADAV | class=1 | legacy=87256
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S075', '87256', 'NITESH YADAV', 'Indriyan Beverages Pvt Ltd', 'NORTH DELHI', 'TSI', '2025-10-06', 'Active',
    'KOTAK BANK', '2850201194', NULL,
    20000.0,
    1, 150.0, NULL, NULL, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S076 | SALMAN | class=1 | legacy=87291
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S076', '87291', 'SALMAN', 'Indriyan Beverages Pvt Ltd', 'EAST DELHI', 'SSO', '2025-10-06', 'Active',
    'PUNJAB & SIND BANK', '07041000063045', NULL,
    28000.0,
    1, 200.0, NULL, NULL, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S077 | MOHD NABEEL | class=4 | legacy=87287
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S077', '87287', 'MOHD NABEEL', 'Indriyan Beverages Pvt Ltd', 'BIJNOR', 'ASE', '2025-10-08', 'Active',
    'PNB BANK', '0357001500035100', NULL,
    30000.0,
    4, 200.0, 250.0, 3.0, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S078 | PARVESH KAPANIA | class=3 | legacy=87325
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S078', '87325', 'PARVESH KAPANIA', 'Indriyan Beverages Pvt Ltd', 'KAPURTHALA', 'SO', '2025-10-09', 'Active',
    'SBI', '37968835936', NULL,
    18000.0,
    3, 150.0, NULL, 2.0, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S079 | NITIN KUMAR | class=1 | legacy=87322
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S079', '87322', 'NITIN KUMAR', 'Indriyan Beverages Pvt Ltd', 'EAST DELHI', 'TSI', '2025-10-12', 'Active',
    'SBI', '33634725592', NULL,
    18000.0,
    1, 150.0, NULL, NULL, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S080 | HONEY GOUR | class=1 | legacy=87310
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S080', '87310', 'HONEY GOUR', 'Indriyan Beverages Pvt Ltd', 'ALIGARH', 'TSI', '2025-10-13', 'Active',
    'SBI', '44610942872', NULL,
    16000.0,
    1, 200.0, NULL, NULL, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S081 | MANISH SHARMA | class=1 | legacy=87285
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S081', '87285', 'MANISH SHARMA', 'Indriyan Beverages Pvt Ltd', 'SOUTH DELHI', 'ASM', '2025-10-16', 'Active',
    'PNB BANK', '6713000100013297', NULL,
    50000.0,
    1, 400.0, NULL, NULL, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S082 | ARUN SHARMA | class=3 | legacy=87082
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S082', '87082', 'ARUN SHARMA', 'Indriyan Beverages Pvt Ltd', 'AMBALA', 'RSM', '2025-11-04', 'Active',
    'SBI', '31094001684', NULL,
    50000.0,
    3, 350.0, NULL, 8.0, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S083 | SACHIN CHAUHAN | class=1 | legacy=87328
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S083', '87328', 'SACHIN CHAUHAN', 'Indriyan Beverages Pvt Ltd', 'ALIGARH', 'TSI', '2025-11-11', 'Active',
    'SBI', '20213914378', NULL,
    16000.0,
    1, 200.0, NULL, NULL, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S084 | ARPIT GUPTA | class=1 | legacy=87260
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S084', '87260', 'ARPIT GUPTA', 'Indriyan Beverages Pvt Ltd', 'MODINAGAR', 'SO', '2025-11-13', 'Active',
    'PNB', '9270000100027909', NULL,
    28000.0,
    1, 200.0, NULL, NULL, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S085 | SHAKIR KHAN | class=1 | legacy=87331
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S085', '87331', 'SHAKIR KHAN', 'Indriyan Beverages Pvt Ltd', 'ALIGARH', 'SO', '2025-11-13', 'Active',
    'SBI', '33985435812', NULL,
    19000.0,
    1, 200.0, NULL, NULL, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S086 | KAPIL KUMAR | class=1 | legacy=86926
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S086', '86926', 'KAPIL KUMAR', 'Indriyan Beverages Pvt Ltd', 'BULANDSHAR', 'TSI', '2025-11-19', 'Active',
    'BOB', '24660100004646', NULL,
    17000.0,
    1, 200.0, NULL, NULL, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S087 | PRADEEP SHARMA | class=1 | legacy=87268
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S087', '87268', 'PRADEEP SHARMA', 'Indriyan Beverages Pvt Ltd', 'ALIGARH', 'TSI', '2025-11-24', 'Active',
    'PNB', '6562000100010562', NULL,
    16000.0,
    1, 200.0, NULL, NULL, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S088 | SAURABH BAJPAI | class=1 | legacy=87330
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S088', '87330', 'SAURABH BAJPAI', 'Indriyan Beverages Pvt Ltd', 'ALIGARH', 'TSI', '2025-11-26', 'Active',
    'SBI', '42863774298', NULL,
    15000.0,
    1, 200.0, NULL, NULL, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S089 | HIMANSHU TYAGI | class=1 | legacy=87074
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S089', '87074', 'HIMANSHU TYAGI', 'Indriyan Beverages Pvt Ltd', 'MEERUT', 'SO', '2025-12-01', 'Active',
    'CANARA BANK', '87902210001112', NULL,
    25000.0,
    1, 250.0, NULL, NULL, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S090 | LALIT RAJ | class=1 | legacy=86612
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S090', '86612', 'LALIT RAJ', 'Indriyan Beverages Pvt Ltd', 'MEERUT', 'TSI', '2025-12-01', 'Active',
    'AXIS BANK', '925010039713259', NULL,
    17000.0,
    1, 200.0, NULL, NULL, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S091 | MONISH RANA | class=1 | legacy=87267
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S091', '87267', 'MONISH RANA', 'Indriyan Beverages Pvt Ltd', 'MEERUT', 'TSI', '2025-12-01', 'Active',
    'PNB', '4007001700063000', NULL,
    15000.0,
    1, 200.0, NULL, NULL, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S092 | PARMINDER | class=4 | legacy=87180
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S092', '87180', 'PARMINDER', 'Indriyan Beverages Pvt Ltd', 'KAPURTHALA', 'SSO', '2025-12-01', 'Active',
    'SBI BANK', '44718791932', NULL,
    26000.0,
    4, 150.0, 200.0, 2.5, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S093 | RAHMAT ALI | class=1 | legacy=87084
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S093', '87084', 'RAHMAT ALI', 'Indriyan Beverages Pvt Ltd', 'NORTH DELHI', 'ASM', '2025-12-01', 'Active',
    'HDFC BANK', '50100535625341', NULL,
    55000.0,
    1, 500.0, NULL, NULL, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S094 | TARUN KUMAR | class=1 | legacy=87343
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S094', '87343', 'TARUN KUMAR', 'Indriyan Beverages Pvt Ltd', 'ALIGARH', 'TSI', '2025-12-03', 'Active',
    'SBI BANK', '41873935707', NULL,
    15000.0,
    1, 200.0, NULL, NULL, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S095 | JAGDISH PANDEY | class=1 | legacy=86903
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S095', '86903', 'JAGDISH PANDEY', 'Indriyan Beverages Pvt Ltd', 'NORTH DELHI', 'TSI', '2025-12-04', 'Active',
    'BOB', '71198100000653', NULL,
    20000.0,
    1, 150.0, NULL, NULL, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S096 | JASWANT | class=3 | legacy=87266
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S096', '87266', 'JASWANT', 'Indriyan Beverages Pvt Ltd', 'BALLABHGARH', 'TSO', '2025-12-05', 'Active',
    'PNB', '1386101700005088', NULL,
    18000.0,
    3, 150.0, NULL, 3.0, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S097 | SARFRAJ | class=1 | legacy=87140
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S097', '87140', 'SARFRAJ', 'Indriyan Beverages Pvt Ltd', 'SOUTH DELHI', 'TSI', '2025-12-22', 'Active',
    'FEDERAL BANK', '77770141683744', NULL,
    20000.0,
    1, 200.0, NULL, NULL, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S098 | MOHD SUHAIL | class=1 | legacy=87317
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S098', '87317', 'MOHD SUHAIL', 'Indriyan Beverages Pvt Ltd', 'MEERUT', 'TSI', '2025-12-26', 'Active',
    'SBI', '36031606940', 'SBIN0002488',
    15000.0,
    1, 200.0, NULL, NULL, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S099 | PRASHANT TYAGI | class=1 | legacy=87269
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S099', '87269', 'PRASHANT TYAGI', 'Indriyan Beverages Pvt Ltd', 'MURET NAGAR', 'TSI', '2025-12-27', 'Active',
    'PNB', '0318001500163664', 'PUNB0031800',
    18000.0,
    1, 200.0, NULL, NULL, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S100 | ADESH KUMAR | class=1 | legacy=87258
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S100', '87258', 'ADESH KUMAR', 'Indriyan Beverages Pvt Ltd', 'BHOPA', 'TSI', '2026-01-01', 'Active',
    'PNB', '3720001500183383', 'PUNB',
    15000.0,
    1, 250.0, NULL, NULL, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S101 | ANIKESH RAI | class=1 | legacy=87296
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S101', '87296', 'ANIKESH RAI', 'Indriyan Beverages Pvt Ltd', 'NORTH DELHI', 'TSI', '2026-01-01', 'Active',
    'SBI', '44839278342', NULL,
    20000.0,
    1, 150.0, NULL, NULL, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S102 | MANOJ KUMAR | class=3 | legacy=87316
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S102', '87316', 'MANOJ KUMAR', 'Indriyan Beverages Pvt Ltd', 'MURADABAD', 'ASM', '2026-01-01', 'Active',
    'AXIS BANK', '923010003688598', NULL,
    45000.0,
    3, 350.0, NULL, 4.0, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S103 | SANJEEV KUMAR | class=1 | legacy=87351
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S103', '87351', 'SANJEEV KUMAR', 'Indriyan Beverages Pvt Ltd', 'BAGPATH', 'TSI', '2026-01-02', 'Active',
    'UNION BANK', '575702010002655', 'UBIN0912824',
    16000.0,
    1, 250.0, NULL, NULL, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S104 | SUKHCHAIN SINGH | class=3 | legacy=87167
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S104', '87167', 'SUKHCHAIN SINGH', 'Indriyan Beverages Pvt Ltd', 'AMRITSAR', 'TSI', '2026-01-03', 'Active',
    'SBI', '34470389701', 'SBIN0004940',
    19000.0,
    3, 200.0, NULL, 2.5, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S105 | ARIF ALI | class=1 | legacy=86859
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S105', '86859', 'ARIF ALI', 'Indriyan Beverages Pvt Ltd', 'SOUTH DELHI', 'TSI', '2026-01-05', 'Active',
    'BOB', '76838100002286', 'BARB0VJMNGR',
    20000.0,
    1, 150.0, NULL, NULL, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S106 | SURAJ KUMAR | class=3 | legacy=87292
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S106', '87292', 'SURAJ KUMAR', 'Indriyan Beverages Pvt Ltd', 'CHANDIGARH', 'SO', '2026-01-05', 'Active',
    'IDBI BANK', '2008104000056489', 'IBKL0002008',
    20000.0,
    3, 150.0, NULL, 2.0, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S107 | KISHOR PODDAR | class=1 | legacy=87347
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S107', '87347', 'KISHOR PODDAR', 'Indriyan Beverages Pvt Ltd', 'NOIDA', 'TSI', '2026-01-08', 'Active',
    'UNION BANK', '676802120001050', 'UBIN0567680',
    22000.0,
    1, 200.0, NULL, NULL, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S108 | VIPIN KUMAR | class=1 | legacy=87335
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S108', '87335', 'VIPIN KUMAR', 'Indriyan Beverages Pvt Ltd', 'MEERUT', 'TSI', '2026-01-08', 'Active',
    'SBI', '40622590017', 'SBIN0021744',
    15000.0,
    1, 200.0, NULL, NULL, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S109 | SURAJ | class=3 | legacy=87332
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S109', '87332', 'SURAJ', 'Indriyan Beverages Pvt Ltd', 'AMRITSAR', 'TSI', '2026-01-09', 'Active',
    'SBI', '44841775509', 'SBIN0009279',
    16000.0,
    3, 150.0, NULL, 2.5, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S110 | KAMALPREET SINGH | class=3 | legacy=87293
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S110', '87293', 'KAMALPREET SINGH', 'Indriyan Beverages Pvt Ltd', 'AMRITSAR', 'TSI', '2026-01-10', 'Active',
    'PUNJAB & SINDH', '02021000021143', 'PSIB0000202',
    19000.0,
    3, 150.0, NULL, 2.5, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S111 | RISHAB PAL | class=1 | legacy=86974
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S111', '86974', 'RISHAB PAL', 'Indriyan Beverages Pvt Ltd', 'MEERUT', 'TSI', '2026-01-12', 'Active',
    'BOB', '34748100004980', 'BARB0GANGAN',
    15000.0,
    1, 200.0, NULL, NULL, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S112 | MUKESH KUMAR SAH | class=1 | legacy=87319|87320
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S112', '87319|87320', 'MUKESH KUMAR SAH', 'Indriyan Beverages Pvt Ltd', 'NOIDA', 'TSI', '2026-01-14', 'Active',
    'SBI', '31417862892', NULL,
    20000.0,
    1, 200.0, NULL, NULL, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S113 | ABHINANDAN | class=1 | legacy=87240
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S113', '87240', 'ABHINANDAN', 'Indriyan Beverages Pvt Ltd', 'NORTH DELHI', 'SO', '2026-01-17', 'Active',
    'KOTAK', '8145568416', 'KKBK0004628',
    28000.0,
    1, 200.0, NULL, NULL, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S114 | DIVYANSH | class=1 | legacy=87305|87306
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S114', '87305|87306', 'DIVYANSH', 'Indriyan Beverages Pvt Ltd', 'NORTH DELHI', 'TSI', '2026-01-19', 'Active',
    'SBI', '43837818878', 'SBIN0031770',
    20000.0,
    1, 150.0, NULL, NULL, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S115 | SHADAB KAYYUM | class=1 | legacy=86840
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S115', '86840', 'SHADAB KAYYUM', 'Indriyan Beverages Pvt Ltd', 'MEERUT', 'TSI', '2026-01-19', 'Active',
    'INDIAN OVERSEAS BANK', '161501000028165', 'IOBA0001615',
    21000.0,
    1, 200.0, NULL, NULL, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S116 | SHAMSHAD | class=1 | legacy=87169
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S116', '87169', 'SHAMSHAD', 'Indriyan Beverages Pvt Ltd', 'NORTH DELHI', 'TSI', '2026-01-19', 'Active',
    'SBI', '32812636967', 'SBIN0004741',
    22000.0,
    1, 150.0, NULL, NULL, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S117 | SAMIR MAHIR | class=1 | legacy=87250|87251
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S117', '87250|87251', 'SAMIR MAHIR', 'Indriyan Beverages Pvt Ltd', 'NORTH DELHI', 'TSI', '2026-01-21', 'Active',
    'KOTAK', '8947294162', 'KKBK0004608',
    20000.0,
    1, 150.0, NULL, NULL, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S118 | GAURAV KUMAR | class=1 | legacy=87265
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S118', '87265', 'GAURAV KUMAR', 'Indriyan Beverages Pvt Ltd', 'NOIDA', 'TSI', '2026-01-27', 'Active',
    'PNB', '0444100100009188', 'PUNB0044410',
    19000.0,
    1, 200.0, NULL, NULL, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S119 | MANJOT SINGH | class=3 | legacy=87313
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S119', '87313', 'MANJOT SINGH', 'Indriyan Beverages Pvt Ltd', 'MOGA', 'TSI', '2026-01-27', 'Active',
    'SBI', '39967254039', 'SBIN0050659',
    17500.0,
    3, 150.0, NULL, 2.0, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S120 | NEELU VERMA | class=3 | legacy=87246
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S120', '87246', 'NEELU VERMA', 'Indriyan Beverages Pvt Ltd', 'HAPUR', 'ASM', '2026-01-27', 'Active',
    'KOTAK', '9647980676', 'KKBK0000148',
    65000.0,
    3, 350.0, NULL, 8.0, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S121 | SANDEEP DABRA | class=1 | legacy=87273
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S121', '87273', 'SANDEEP DABRA', 'Indriyan Beverages Pvt Ltd', 'PATIALA', 'SO', '2026-01-27', 'Active',
    'PNB', '0390000152107550', 'PUNB0291800',
    20000.0,
    1, 200.0, NULL, NULL, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S122 | VISHAL KUMAR SHARMA | class=4 | legacy=87336
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S122', '87336', 'VISHAL KUMAR SHARMA', 'Indriyan Beverages Pvt Ltd', 'HARIDWAR', 'SO', '2026-01-27', 'Active',
    'SBI', '36721746055', 'SBIN0000586',
    22000.0,
    4, 150.0, 200.0, 3.0, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S123 | YUVRAJ | class=3 | legacy=87338
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S123', '87338', 'YUVRAJ', 'Indriyan Beverages Pvt Ltd', 'SAMRALA', 'TSI', '2026-01-27', 'Active',
    'SBI', '41506070003', NULL,
    18000.0,
    3, 150.0, NULL, 2.0, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S124 | SUDESH KOHLI | class=3 | legacy=87202
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S124', '87202', 'SUDESH KOHLI', 'Indriyan Beverages Pvt Ltd', 'GURDASPUR', 'TSI', '2026-01-28', 'Active',
    'ICIC', '342101504791', 'ICIC0003421',
    50000.0,
    3, 300.0, NULL, 8.0, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S125 | PAPPU PANDAY | class=1 | legacy=87324
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S125', '87324', 'PAPPU PANDAY', 'Indriyan Beverages Pvt Ltd', 'NORTH DELHI', 'TSI', '2026-01-31', 'Active',
    'SBI', '40934973323', 'SBIN0000062',
    21000.0,
    1, 250.0, NULL, NULL, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S126 | REHAN ARORA | class=3 | legacy=87327
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S126', '87327', 'REHAN ARORA', 'Indriyan Beverages Pvt Ltd', 'ZIRA/MAKHU', 'TSI', '2026-01-31', 'Active',
    'SBI', '42349176997', 'SBIN0004632',
    17000.0,
    3, 150.0, NULL, 2.0, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S127 | DEEPAK KANSAL | class=3 | legacy=87032
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S127', '87032', 'DEEPAK KANSAL', 'Indriyan Beverages Pvt Ltd', 'SAHIBABAD', 'TSI', '2026-02-02', 'Active',
    'CENTRAL BANK OF INDIA', '3596840574', 'CBIN0280257',
    23700.0,
    3, 200.0, NULL, 3.0, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S128 | SACHIN | class=3 | legacy=87318
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S128', '87318', 'SACHIN', 'Indriyan Beverages Pvt Ltd', 'FARIDKOT', 'TSI', '2026-02-02', 'Active',
    NULL, NULL, NULL,
    18000.0,
    3, 150.0, NULL, 2.0, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S129 | GAURAV PATEL | class=3 | legacy=86865
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S129', '86865', 'GAURAV PATEL', 'Indriyan Beverages Pvt Ltd', 'MURADABAD', 'SO', '2026-02-03', 'Active',
    'BOB', '20948100009421', 'BARB0MATKAP',
    25000.0,
    3, 150.0, NULL, 3.0, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S130 | SUBHAM KUMAR | class=3 | legacy=87257
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S130', '87257', 'SUBHAM KUMAR', 'Indriyan Beverages Pvt Ltd', 'AMRITSAR', 'TSI', '2026-02-03', 'Active',
    'P & SIND BANK', '05871000067322', 'PSIB0000587',
    24000.0,
    3, 200.0, NULL, 2.5, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S131 | NAVEEN JAISWARA | class=1 | legacy=87112
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S131', '87112', 'NAVEEN JAISWARA', 'Indriyan Beverages Pvt Ltd', 'CHANDIGARH', 'TSI', '2026-02-05', 'Active',
    'CANARA BANK', '8428101016375', 'CNRB0008428',
    20000.0,
    1, 200.0, NULL, NULL, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S132 | SANDEEP KUMAR | class=1 | legacy=87329
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S132', '87329', 'SANDEEP KUMAR', 'Indriyan Beverages Pvt Ltd', 'MOHALI', 'TSI', '2026-02-05', 'Active',
    'SBI', '44442248158', 'SBIN0051244',
    17000.0,
    1, 150.0, NULL, NULL, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S133 | MOHD REHBAR | class=4 | legacy=87314
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S133', '87314', 'MOHD REHBAR', 'Indriyan Beverages Pvt Ltd', 'NAJIBABAD', 'TSI', '2026-02-06', 'Active',
    'SBI', '43512250440', 'SBIN0000688',
    22000.0,
    4, 180.0, 200.0, 3.0, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S134 | PARDEEP KUMAR | class=3 | legacy=87249
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S134', '87249', 'PARDEEP KUMAR', 'Indriyan Beverages Pvt Ltd', 'BATALA', 'TSI', '2026-02-07', 'Active',
    'KOTAK', '2814274608', NULL,
    18000.0,
    3, 200.0, NULL, 2.0, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S135 | KAMLESH SHARMA | class=3 | legacy=87312
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S135', '87312', 'KAMLESH SHARMA', 'Indriyan Beverages Pvt Ltd', 'BARELI', 'TSI', '2026-02-09', 'Active',
    'SBI', '30507014925', 'SBIN0016455',
    18000.0,
    3, 150.0, NULL, 3.0, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S136 | ABHISHEK KUMAR | class=4 | legacy=87294
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S136', '87294', 'ABHISHEK KUMAR', 'Indriyan Beverages Pvt Ltd', 'BIJNOR/KOTWALI', 'TSI', '2026-02-11', 'Active',
    'SBI', '42604958625', 'SBIN0012517',
    24000.0,
    4, 180.0, 200.0, 3.0, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S137 | PRAVEEN SINGH | class=1 | legacy=87350
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S137', '87350', 'PRAVEEN SINGH', 'Indriyan Beverages Pvt Ltd', NULL, 'TSI', '2026-02-13', 'Active',
    'UNION BANK', '125910100039610', 'UBIN0812595',
    20000.0,
    1, 150.0, NULL, NULL, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S138 | ANKIT SRIVASTVA | class=3 | legacy=87297
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S138', '87297', 'ANKIT SRIVASTVA', 'Indriyan Beverages Pvt Ltd', 'GORAKHPUR', 'ASM', '2026-02-16', 'Active',
    'SBI', '30771486248', 'SBIN0006992',
    75000.0,
    3, 300.0, NULL, 6.0, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S139 | NITIN | class=1 | legacy=87234
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S139', '87234', 'NITIN', 'Indriyan Beverages Pvt Ltd', NULL, 'TSI', '2026-02-16', 'Active',
    'INDUSLND BANK', '158447479906', 'INDB0000044',
    16000.0,
    1, 150.0, NULL, NULL, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S140 | VEER SINGH | class=3 | legacy=87333
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S140', '87333', 'VEER SINGH', 'Indriyan Beverages Pvt Ltd', NULL, 'TSI', '2026-02-16', 'Active',
    'SBI', '34181662602', 'SBIN0017018',
    20000.0,
    3, 200.0, NULL, 2.0, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S141 | YASH SAXSENA | class=3 | legacy=86249
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S141', '86249', 'YASH SAXSENA', 'Indriyan Beverages Pvt Ltd', 'MURADABAD', 'TSI', '2026-02-16', 'Active',
    'AXIS', '924010008671806', 'UTIB0003735',
    19000.0,
    3, 150.0, NULL, 3.0, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S142 | MANOJ KAPIL | class=3 | legacy=86929
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S142', '86929', 'MANOJ KAPIL', 'Indriyan Beverages Pvt Ltd', 'SHARANPUR', 'TSI', '2026-02-18', 'Active',
    'IOB', '043401000056705', 'IOBA0000434',
    16000.0,
    3, 150.0, NULL, 3.0, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S143 | SARTHAK AHUJA | class=3 | legacy=87042
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S143', '87042', 'SARTHAK AHUJA', 'Indriyan Beverages Pvt Ltd', 'RAMPUR', 'TSI', '2026-02-18', 'Active',
    'BOB', '46680100008937', 'BARB0MODBLY',
    28000.0,
    3, 150.0, NULL, 3.0, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S144 | SAHIL MATTU | class=3 | legacy=87320
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S144', '87320', 'SAHIL MATTU', 'Indriyan Beverages Pvt Ltd', NULL, 'TSI', '2026-02-19', 'Active',
    NULL, NULL, NULL,
    18000.0,
    3, 150.0, NULL, 2.0, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S145 | NAVIN KUMAR | class=1 | legacy=87321
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S145', '87321', 'NAVIN KUMAR', 'Indriyan Beverages Pvt Ltd', NULL, 'TSI', '2026-02-20', 'Active',
    NULL, NULL, NULL,
    20000.0,
    1, 200.0, NULL, NULL, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S146 | SACHIN KUMAR | class=1 | legacy=87027
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S146', '87027', 'SACHIN KUMAR', 'Indriyan Beverages Pvt Ltd', NULL, 'PSR', '2026-02-20', 'Active',
    'BOB', '88540100000156', 'BARB0PILANI',
    20000.0,
    1, 150.0, NULL, NULL, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S147 | NADEEM ALI | class=1 | legacy=87557
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S147', '87557', 'NADEEM ALI', 'Indriyan Beverages Pvt Ltd', NULL, 'TSI', '2026-02-21', 'Active',
    NULL, NULL, NULL,
    20000.0,
    1, 200.0, NULL, NULL, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S148 | GAURAV | class=1 | legacy=87241
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S148', '87241', 'GAURAV', 'Indriyan Beverages Pvt Ltd', 'EAST DELHI', 'TSI', '2026-02-24', 'Active',
    'KOTAK', '6345804389', 'KKBK0004608',
    23000.0,
    1, 250.0, NULL, NULL, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S149 | BHARAT SINGH | class=3 | legacy=86424
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S149', '86424', 'BHARAT SINGH', 'Indriyan Beverages Pvt Ltd', 'JALANDHAR', 'ASM', NULL, 'Active',
    'SBI', '55036512817', 'SBIN0050430',
    85000.0,
    3, 350.0, NULL, 8.0, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S150 | DAVINDER | class=3 | legacy=87081
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S150', '87081', 'DAVINDER', 'Indriyan Beverages Pvt Ltd', 'LUDHIANA', 'ASM', NULL, 'Active',
    'HDFC BANK', '50100328187863', 'HDFC0001832',
    60000.0,
    3, 300.0, NULL, 3.0, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S151 | DINESH SHARMA | class=4 | legacy=87556
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S151', '87556', 'DINESH SHARMA', 'Indriyan Beverages Pvt Ltd', 'RAMPUR', 'TSI', NULL, 'Active',
    NULL, NULL, NULL,
    28000.0,
    4, 200.0, 250.0, 3.0, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S152 | GAURAV SHARMA | class=3 | legacy=87063
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S152', '87063', 'GAURAV SHARMA', 'Indriyan Beverages Pvt Ltd', 'ALIGARH', 'TSI', NULL, 'Active',
    'BOB', '25750100012120', NULL,
    18000.0,
    3, 150.0, NULL, 3.0, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S153 | HARISH RAGHAV | class=1 | legacy=87308
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S153', '87308', 'HARISH RAGHAV', 'Indriyan Beverages Pvt Ltd', 'NOIDA', 'TSI', NULL, 'Active',
    'SBI', '42620794347', NULL,
    18000.0,
    1, 150.0, NULL, NULL, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S154 | HEERA LAL | class=4 | legacy=87085
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S154', '87085', 'HEERA LAL', 'Indriyan Beverages Pvt Ltd', 'EAST DELHI', 'ASM', NULL, 'Active',
    'ICICI BANK', '663001506619', 'ICIC0006630',
    60000.0,
    4, 300.0, 350.0, 7.0, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S155 | KARAN KUMAR | class=3 | legacy=87162
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S155', '87162', 'KARAN KUMAR', 'Indriyan Beverages Pvt Ltd', 'LUDHIANA', 'SSO', NULL, 'Active',
    'HDFC BANK', '50100284675316', 'HDFC0001830',
    40400.0,
    3, 200.0, NULL, 2.0, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S156 | MADHAV JUNEJA | class=3 | legacy=87283
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S156', '87283', 'MADHAV JUNEJA', 'Indriyan Beverages Pvt Ltd', 'JALANDHAR', 'TSI', NULL, 'Active',
    'PNB BANK', '3654000100200858', 'PUNB0365400',
    19000.0,
    3, 100.0, NULL, 2.0, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S157 | MANAV THUKRAL | class=4 | legacy=84344
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S157', '84344', 'MANAV THUKRAL', 'Indriyan Beverages Pvt Ltd', 'MALLANWALA', 'ASE', NULL, 'Active',
    'PNB', '6829000100002918', NULL,
    34200.0,
    4, 200.0, 250.0, 3.0, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S158 | PRINCE KUMAR | class=4 | legacy=87307
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S158', '87307', 'PRINCE KUMAR', 'Indriyan Beverages Pvt Ltd', 'GHAZIABAD', 'ASM', NULL, 'Active',
    'CANARA BANK', '3742101001631', NULL,
    65000.0,
    4, 300.0, 350.0, 7.0, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S159 | RAHUL SALGOTRA | class=3 | legacy=87270
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S159', '87270', 'RAHUL SALGOTRA', 'Indriyan Beverages Pvt Ltd', 'JALANDHAR', 'TSI', NULL, 'Active',
    'PNB', '2537000103106185', 'PUNB0253700',
    20000.0,
    3, 150.0, NULL, 2.5, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S160 | RAJAT NARANG | class=4 | legacy=87554
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S160', '87554', 'RAJAT NARANG', 'Indriyan Beverages Pvt Ltd', 'FAZILKA', 'TSI', NULL, 'Active',
    'HDFC BANK', '50100259101213', NULL,
    20500.0,
    4, 150.0, 200.0, 2.0, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S161 | RAM RATAN | class=1 | legacy=87224
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S161', '87224', 'RAM RATAN', 'Indriyan Beverages Pvt Ltd', NULL, 'TSI', NULL, 'Active',
    'ICICI BANK', '349201501448', NULL,
    17000.0,
    1, 200.0, NULL, NULL, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S162 | REHMAN | class=3 | legacy=86973
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S162', '86973', 'REHMAN', 'Indriyan Beverages Pvt Ltd', 'EAST DELHI', 'SO', NULL, 'Active',
    'BOB', '44630100010555', NULL,
    28000.0,
    3, 200.0, NULL, 3.0, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S163 | SANJAY SHARMA | class=3 | legacy=84473
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S163', '84473', 'SANJAY SHARMA', 'Indriyan Beverages Pvt Ltd', 'AMRITSAR', 'ASE', NULL, 'Active',
    'SBI', '55146626159', NULL,
    49000.0,
    3, 350.0, NULL, 8.0, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S164 | SOHIT KUMAR | class=4 | legacy=86634
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S164', '86634', 'SOHIT KUMAR', 'Indriyan Beverages Pvt Ltd', 'HOSHIARPUR', 'SO', NULL, 'Active',
    'PNB', '3430000107127640', NULL,
    21500.0,
    4, 150.0, 200.0, 3.0, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S165 | TARSEM LAL | class=4 | legacy=87289
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S165', '87289', 'TARSEM LAL', 'Indriyan Beverages Pvt Ltd', 'MOGA', 'TSI', NULL, 'Active',
    'PNB BANK', '03912151009283', NULL,
    21500.0,
    4, 120.0, 150.0, 2.0, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S166 | VANSH GUPTA | class=1 | legacy=87321
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S166', '87321', 'VANSH GUPTA', 'Indriyan Beverages Pvt Ltd', 'EAST DELHI', 'TSI', NULL, 'Active',
    NULL, NULL, NULL,
    18000.0,
    1, 150.0, NULL, NULL, NULL,
    'master_import_2026-04-24', datetime('now')
);
-- S167 | VIVEK | class=3 | legacy=86856
INSERT OR IGNORE INTO sales_employees (
    code, legacy_code, name, company, city_of_operation, designation, doj, status,
    bank_name, account_no, ifsc,
    gross_salary,
    ta_da_class, da_rate, da_outstation_rate, ta_rate_primary, ta_rate_secondary,
    ta_da_updated_by, ta_da_updated_at
) VALUES (
    'S167', '86856', 'VIVEK', 'Indriyan Beverages Pvt Ltd', 'LUDHIANA', 'TSI', NULL, 'Active',
    'BANK OF INDIA', '650010510002854', NULL,
    18000.0,
    3, 100.0, NULL, 2.0, NULL,
    'master_import_2026-04-24', datetime('now')
);

-- Salary structures: link to employee_id via (code, company) lookup

INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 17100.0, 900.0, 0.0, 0.0, 18000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S001' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 18000.0, 4000.0, 4000.0, 4000.0, 30000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S002' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 17100.0, 3000.0, 1500.0, 0.0, 21600.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S003' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 15500.0, 2500.0, 2700.0, 3000.0, 23700.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S004' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 58000.0, 0.0, 0.0, 0.0, 58000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S005' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 15500.0, 4500.0, 3000.0, 0.0, 23000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S006' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 18000.0, 4000.0, 4000.0, 4000.0, 30000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S007' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 25000.0, 3000.0, 0.0, 0.0, 28000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S008' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 18000.0, 2700.0, 3000.0, 0.0, 23700.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S009' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 23000.0, 3000.0, 0.0, 0.0, 26000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S010' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 12000.0, 2000.0, 2000.0, 0.0, 16000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S011' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 17000.0, 3000.0, 0.0, 0.0, 20000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S012' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 20000.0, 3000.0, 3400.0, 0.0, 26400.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S013' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 14000.0, 3000.0, 2500.0, 0.0, 19500.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S014' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 37000.0, 0.0, 0.0, 0.0, 37000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S015' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 20000.0, 4000.0, 0.0, 0.0, 24000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S016' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 17000.0, 0.0, 0.0, 0.0, 17000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S017' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 20000.0, 0.0, 0.0, 0.0, 20000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S018' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 22000.0, 0.0, 0.0, 0.0, 22000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S019' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 18000.0, 0.0, 0.0, 0.0, 18000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S020' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 22000.0, 2200.0, 0.0, 0.0, 24200.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S021' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 16500.0, 2000.0, 0.0, 0.0, 18500.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S022' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 70000.0, 0.0, 0.0, 0.0, 70000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S023' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 28000.0, 0.0, 0.0, 0.0, 28000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S024' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 42000.0, 0.0, 0.0, 0.0, 42000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S025' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 35000.0, 0.0, 0.0, 0.0, 35000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S026' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 16500.0, 0.0, 0.0, 0.0, 16500.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S027' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 100000.0, 0.0, 0.0, 0.0, 100000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S028' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 22000.0, 0.0, 0.0, 0.0, 22000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S029' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 13000.0, 0.0, 0.0, 0.0, 13000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S030' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 34000.0, 3400.0, 0.0, 0.0, 37400.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S031' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 34000.0, 3400.0, 0.0, 0.0, 37400.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S032' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 48000.0, 4800.0, 0.0, 0.0, 52800.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S033' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 34000.0, 3400.0, 0.0, 0.0, 37400.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S034' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 20000.0, 3000.0, 0.0, 0.0, 23000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S035' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 21000.0, 0.0, 0.0, 0.0, 21000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S036' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 20900.0, 0.0, 0.0, 0.0, 20900.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S037' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 18000.0, 0.0, 0.0, 0.0, 18000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S038' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 17000.0, 0.0, 0.0, 0.0, 17000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S039' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 28000.0, 0.0, 0.0, 0.0, 28000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S040' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 23000.0, 0.0, 0.0, 0.0, 23000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S041' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 23000.0, 0.0, 0.0, 0.0, 23000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S042' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 20000.0, 0.0, 0.0, 0.0, 20000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S043' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 20000.0, 0.0, 0.0, 0.0, 20000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S044' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 25000.0, 0.0, 0.0, 0.0, 25000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S045' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 14000.0, 0.0, 0.0, 0.0, 14000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S046' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 22000.0, 0.0, 0.0, 0.0, 22000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S047' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 23000.0, 0.0, 0.0, 0.0, 23000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S048' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 16500.0, 0.0, 0.0, 0.0, 16500.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S049' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 25000.0, 0.0, 0.0, 0.0, 25000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S050' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 18000.0, 0.0, 0.0, 0.0, 18000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S051' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 18000.0, 0.0, 0.0, 0.0, 18000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S052' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 18000.0, 0.0, 0.0, 0.0, 18000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S053' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 18000.0, 0.0, 0.0, 0.0, 18000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S054' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 21000.0, 0.0, 0.0, 0.0, 21000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S055' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 18000.0, 0.0, 0.0, 0.0, 18000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S056' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 72300.0, 0.0, 0.0, 0.0, 72300.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S057' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 18000.0, 0.0, 0.0, 0.0, 18000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S058' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 15000.0, 1500.0, 0.0, 0.0, 16500.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S059' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 18000.0, 0.0, 0.0, 0.0, 18000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S060' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 15000.0, 0.0, 0.0, 0.0, 15000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S061' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 18000.0, 0.0, 0.0, 0.0, 18000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S062' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 18000.0, 0.0, 0.0, 0.0, 18000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S063' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 16500.0, 0.0, 0.0, 0.0, 16500.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S064' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 16000.0, 1500.0, 0.0, 0.0, 17500.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S065' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 15000.0, 0.0, 0.0, 0.0, 15000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S066' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 108333.0, 0.0, 0.0, 0.0, 108333.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S067' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 20000.0, 0.0, 0.0, 0.0, 20000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S068' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 18000.0, 0.0, 0.0, 0.0, 18000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S069' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 18000.0, 0.0, 0.0, 0.0, 18000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S070' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 18000.0, 0.0, 0.0, 0.0, 18000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S071' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 35000.0, 0.0, 0.0, 0.0, 35000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S072' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 23000.0, 0.0, 0.0, 0.0, 23000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S073' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 16000.0, 0.0, 0.0, 0.0, 16000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S074' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 20000.0, 0.0, 0.0, 0.0, 20000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S075' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 28000.0, 0.0, 0.0, 0.0, 28000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S076' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 30000.0, 0.0, 0.0, 0.0, 30000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S077' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 18000.0, 0.0, 0.0, 0.0, 18000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S078' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 18000.0, 0.0, 0.0, 0.0, 18000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S079' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 16000.0, 0.0, 0.0, 0.0, 16000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S080' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 50000.0, 0.0, 0.0, 0.0, 50000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S081' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 50000.0, 0.0, 0.0, 0.0, 50000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S082' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 16000.0, 0.0, 0.0, 0.0, 16000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S083' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 28000.0, 0.0, 0.0, 0.0, 28000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S084' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 19000.0, 0.0, 0.0, 0.0, 19000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S085' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 17000.0, 0.0, 0.0, 0.0, 17000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S086' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 16000.0, 0.0, 0.0, 0.0, 16000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S087' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 15000.0, 0.0, 0.0, 0.0, 15000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S088' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 25000.0, 0.0, 0.0, 0.0, 25000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S089' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 17000.0, 0.0, 0.0, 0.0, 17000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S090' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 15000.0, 0.0, 0.0, 0.0, 15000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S091' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 26000.0, 0.0, 0.0, 0.0, 26000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S092' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 55000.0, 0.0, 0.0, 0.0, 55000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S093' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 15000.0, 0.0, 0.0, 0.0, 15000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S094' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 20000.0, 0.0, 0.0, 0.0, 20000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S095' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 18000.0, 0.0, 0.0, 0.0, 18000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S096' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 20000.0, 0.0, 0.0, 0.0, 20000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S097' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 15000.0, 0.0, 0.0, 0.0, 15000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S098' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 16000.0, 2000.0, 0.0, 0.0, 18000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S099' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 15000.0, 0.0, 0.0, 0.0, 15000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S100' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 16000.0, 4000.0, 0.0, 0.0, 20000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S101' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 20000.0, 10000.0, 15000.0, 0.0, 45000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S102' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 16000.0, 0.0, 0.0, 0.0, 16000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S103' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 16000.0, 3000.0, 0.0, 0.0, 19000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S104' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 16000.0, 4000.0, 0.0, 0.0, 20000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S105' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 16000.0, 4000.0, 0.0, 0.0, 20000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S106' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 16000.0, 4000.0, 0.0, 2000.0, 22000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S107' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 15000.0, 0.0, 0.0, 0.0, 15000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S108' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 16000.0, 0.0, 0.0, 0.0, 16000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S109' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 16000.0, 3000.0, 0.0, 0.0, 19000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S110' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 15000.0, 0.0, 0.0, 0.0, 15000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S111' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 16000.0, 4000.0, 0.0, 0.0, 20000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S112' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 16000.0, 4000.0, 4000.0, 4000.0, 28000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S113' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 16000.0, 4000.0, 0.0, 0.0, 20000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S114' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 16000.0, 4000.0, 0.0, 1000.0, 21000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S115' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 16000.0, 4000.0, 0.0, 2000.0, 22000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S116' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 16000.0, 4000.0, 0.0, 0.0, 20000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S117' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 16000.0, 3000.0, 0.0, 0.0, 19000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S118' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 16000.0, 1500.0, 0.0, 0.0, 17500.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S119' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 35000.0, 14000.0, 3000.0, 13000.0, 65000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S120' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 15500.0, 4500.0, 0.0, 0.0, 20000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S121' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 16000.0, 4000.0, 0.0, 2000.0, 22000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S122' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 16000.0, 2000.0, 0.0, 0.0, 18000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S123' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 30000.0, 10000.0, 0.0, 10000.0, 50000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S124' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 16000.0, 4000.0, 0.0, 1000.0, 21000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S125' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 16000.0, 1000.0, 0.0, 0.0, 17000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S126' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 15500.0, 2500.0, 2700.0, 3000.0, 23700.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S127' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 16000.0, 2000.0, 0.0, 0.0, 18000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S128' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 16000.0, 4000.0, 1000.0, 4000.0, 25000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S129' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 16000.0, 4000.0, 0.0, 4000.0, 24000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S130' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 16000.0, 4000.0, 0.0, 0.0, 20000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S131' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 17000.0, 0.0, 0.0, 0.0, 17000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S132' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 15500.0, 4500.0, 0.0, 2000.0, 22000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S133' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 16000.0, 2000.0, 0.0, 0.0, 18000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S134' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 16000.0, 2000.0, 0.0, 0.0, 18000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S135' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 17000.0, 4000.0, 0.0, 3000.0, 24000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S136' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 16000.0, 4000.0, 0.0, 0.0, 20000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S137' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 37500.0, 20000.0, 12500.0, 5000.0, 75000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S138' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 16000.0, 0.0, 0.0, 0.0, 16000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S139' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 16000.0, 4000.0, 0.0, 0.0, 20000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S140' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 16000.0, 3000.0, 0.0, 0.0, 19000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S141' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 16000.0, 0.0, 0.0, 0.0, 16000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S142' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 16000.0, 4000.0, 4000.0, 4000.0, 28000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S143' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 16000.0, 2000.0, 0.0, 0.0, 18000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S144' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 16000.0, 4000.0, 0.0, 0.0, 20000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S145' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 16000.0, 4000.0, 0.0, 0.0, 20000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S146' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 16000.0, 4000.0, 0.0, 0.0, 20000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S147' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 16000.0, 4000.0, 0.0, 3000.0, 23000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S148' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 36000.0, 20000.0, 14000.0, 15000.0, 85000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S149' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 20000.0, 12000.0, 8000.0, 20000.0, 60000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S150' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 16000.0, 4000.0, 4000.0, 4000.0, 28000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S151' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 18000.0, 0.0, 0.0, 0.0, 18000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S152' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 18000.0, 0.0, 0.0, 0.0, 18000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S153' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 30000.0, 20000.0, 5000.0, 5000.0, 60000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S154' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 37000.0, 3400.0, 0.0, 0.0, 40400.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S155' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 14000.0, 2000.0, 3000.0, 0.0, 19000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S156' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 20000.0, 7000.0, 3700.0, 3500.0, 34200.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S157' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 31000.0, 20000.0, 7000.0, 7000.0, 65000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S158' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 16000.0, 4000.0, 0.0, 0.0, 20000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S159' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 15500.0, 2000.0, 3000.0, 0.0, 20500.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S160' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 17000.0, 0.0, 0.0, 0.0, 17000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S161' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 28000.0, 0.0, 0.0, 0.0, 28000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S162' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 22000.0, 14000.0, 5500.0, 7500.0, 49000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S163' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 15100.0, 1400.0, 3000.0, 2000.0, 21500.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S164' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 17500.0, 2500.0, 1500.0, 0.0, 21500.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S165' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 16000.0, 0.0, 0.0, 2000.0, 18000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S166' AND company = 'Indriyan Beverages Pvt Ltd';
INSERT OR IGNORE INTO sales_salary_structures (
    employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, created_by
) SELECT id, '2026-01', 16000.0, 2000.0, 0.0, 0.0, 18000.0, 'master_import_2026-04-24'
  FROM sales_employees WHERE code = 'S167' AND company = 'Indriyan Beverages Pvt Ltd';

COMMIT;
