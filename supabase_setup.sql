-- ============================================================
-- ระบบกองทุนพัฒนาหมู่บ้าน (ลพบุรีราเมศวร์ธานี)
-- สคริปต์สร้างฐานข้อมูล Supabase (PostgreSQL) รองรับหลายปีงบประมาณ
-- วิธีใช้: คัดลอกโค้ดทั้งหมดนี้ไปวางใน Supabase > SQL Editor แล้วกด Run
-- ============================================================

-- เปิดใช้งาน Extension สำหรับคำนวณและ UUID (ถ้าต้องการ)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. ตารางปีงบประมาณ (Fiscal Years)
CREATE TABLE IF NOT EXISTS fiscal_years (
    year_be INT PRIMARY KEY,                       -- เช่น 2568, 2569, 2570
    title VARCHAR(100),                            -- เช่น ปีงบประมาณ 2569
    opening_balance NUMERIC(12, 2) DEFAULT 0.00,  -- ยอดยกมาธนาคาร
    opening_reserve NUMERIC(12, 2) DEFAULT 0.00,  -- ยอดยกมาเงินสดย่อย
    closing_balance NUMERIC(12, 2),               -- ยอดปิดบัญชีธนาคารสิ้นปี
    closing_reserve NUMERIC(12, 2),               -- ยอดปิดเงินสดย่อยสิ้นปี
    start_date DATE,                              -- วันเริ่มต้นงวด
    end_date DATE,                                -- วันสิ้นสุดงวด
    is_active BOOLEAN DEFAULT FALSE,              -- TRUE สำหรับปีปัจจุบันที่กำลังทำงาน
    is_closed BOOLEAN DEFAULT FALSE,              -- TRUE เมื่อปิดงวดบัญชีสิ้นปี
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. ตารางโซน / ซอย
CREATE TABLE IF NOT EXISTS zones (
    zone_id VARCHAR(10) PRIMARY KEY, -- เช่น Z01, Z02, MAIN
    name VARCHAR(50) NOT NULL,       -- เช่น ซอย 1, สายหลัก
    sort_order INT DEFAULT 0
);

-- 3. ทะเบียนบ้าน 162 หลัง
CREATE TABLE IF NOT EXISTS houses (
    house_id VARCHAR(10) PRIMARY KEY, -- เช่น H001, H002
    house_no VARCHAR(20) NOT NULL,   -- เช่น 444/1, 448/12
    zone_id VARCHAR(10) REFERENCES zones(zone_id),
    status VARCHAR(20) DEFAULT 'normal', -- normal, vacant
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. ข้อมูลสมาชิก / ลูกบ้าน
CREATE TABLE IF NOT EXISTS members (
    member_id VARCHAR(10) PRIMARY KEY,
    full_name VARCHAR(100) NOT NULL,
    phone VARCHAR(30),
    id_card VARCHAR(20)
);

-- 5. การผูกลูกบ้านกับบ้าน
CREATE TABLE IF NOT EXISTS house_members (
    house_id VARCHAR(10) REFERENCES houses(house_id) ON DELETE CASCADE,
    member_id VARCHAR(10) REFERENCES members(member_id) ON DELETE CASCADE,
    role VARCHAR(30) DEFAULT 'owner', -- owner, resident, contact
    from_date DATE,
    to_date DATE,
    PRIMARY KEY (house_id, member_id)
);

-- 6. อัตราค่าส่วนกลางแยกตามโซนและปีงบประมาณ
CREATE TABLE IF NOT EXISTS fee_rates (
    rate_id VARCHAR(20) PRIMARY KEY,
    zone_id VARCHAR(10) REFERENCES zones(zone_id),
    year_be INT REFERENCES fiscal_years(year_be),
    monthly_amount NUMERIC(10, 2) NOT NULL,
    UNIQUE (zone_id, year_be)
);

-- 7. หนี้ค่าส่วนกลางรายเดือน (Dues)
CREATE TABLE IF NOT EXISTS dues (
    due_id VARCHAR(30) PRIMARY KEY, -- เช่น D2569-H001-01
    house_id VARCHAR(10) REFERENCES houses(house_id),
    year_be INT REFERENCES fiscal_years(year_be),
    month INT NOT NULL CHECK (month BETWEEN 1 AND 12),
    period INT NOT NULL CHECK (period BETWEEN 1 AND 4),
    amount_due NUMERIC(10, 2) NOT NULL,
    UNIQUE (house_id, year_be, month)
);

-- 8. ผู้ใช้งานระบบ
CREATE TABLE IF NOT EXISTS users (
    user_id VARCHAR(10) PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role VARCHAR(20) DEFAULT 'staff', -- admin, staff
    full_name VARCHAR(100),
    active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 9. รายการรับชำระเงิน (Payments)
CREATE TABLE IF NOT EXISTS payments (
    payment_id VARCHAR(20) PRIMARY KEY, -- เช่น P01123
    due_id VARCHAR(30) REFERENCES dues(due_id),
    year_be INT REFERENCES fiscal_years(year_be),
    amount_paid NUMERIC(10, 2) NOT NULL,
    paid_date DATE NOT NULL,
    channel VARCHAR(20) DEFAULT 'transfer', -- transfer, cash
    transfer_time VARCHAR(10),
    has_slip VARCHAR(2) DEFAULT 'N',
    slip_url TEXT,
    recorded_by VARCHAR(10) REFERENCES users(user_id),
    note TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 10. หมวดหมู่ค่าใช้จ่าย
CREATE TABLE IF NOT EXISTS expense_categories (
    category_id VARCHAR(10) PRIMARY KEY,
    name VARCHAR(100) NOT NULL
);

-- 11. รายการค่าใช้จ่าย (Expenses)
CREATE TABLE IF NOT EXISTS expenses (
    expense_id VARCHAR(20) PRIMARY KEY,
    year_be INT REFERENCES fiscal_years(year_be),
    doc_no VARCHAR(50),
    expense_date DATE NOT NULL,
    description TEXT NOT NULL,
    amount NUMERIC(12, 2) NOT NULL,
    category_id VARCHAR(10) REFERENCES expense_categories(category_id),
    payee VARCHAR(100),
    status VARCHAR(20) DEFAULT 'paid',
    source VARCHAR(20) DEFAULT 'bank', -- bank, reserve
    recorded_by VARCHAR(10) REFERENCES users(user_id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 12. เงินสดย่อยสำรองจ่าย (Reserve Transactions)
CREATE TABLE IF NOT EXISTS reserve_transactions (
    rt_id VARCHAR(20) PRIMARY KEY,
    year_be INT REFERENCES fiscal_years(year_be),
    date DATE NOT NULL,
    type VARCHAR(20) NOT NULL, -- in, out
    amount NUMERIC(12, 2) NOT NULL,
    expense_id VARCHAR(20) REFERENCES expenses(expense_id),
    note TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 13. รายได้อื่นๆ (Other Income)
CREATE TABLE IF NOT EXISTS other_income (
    income_id VARCHAR(20) PRIMARY KEY,
    year_be INT REFERENCES fiscal_years(year_be),
    date DATE NOT NULL,
    type VARCHAR(30) NOT NULL, -- interest, donation, support, other
    amount NUMERIC(12, 2) NOT NULL,
    channel VARCHAR(20) DEFAULT 'bank',
    note TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 14. Audit Log
CREATE TABLE IF NOT EXISTS audit_log (
    log_id BIGSERIAL PRIMARY KEY,
    user_id VARCHAR(10),
    action VARCHAR(20),
    table_name VARCHAR(50),
    record_id VARCHAR(50),
    old_value JSONB,
    new_value JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 15. สถิติการเข้าชมเว็บไซต์
CREATE TABLE IF NOT EXISTS site_stats (
    date DATE PRIMARY KEY,
    views INT DEFAULT 0,
    visitors INT DEFAULT 0
);

-- ============================================================
-- Function & View: สำหรับเปิดปีงบประมาณใหม่ และดูยอดค้างชำระข้ามปี
-- ============================================================

CREATE OR REPLACE VIEW v_house_arrears_summary AS
SELECT 
    h.house_id,
    h.house_no,
    z.name AS zone_name,
    COALESCE(SUM(CASE WHEN d.year_be < (SELECT year_be FROM fiscal_years WHERE is_active = TRUE LIMIT 1) AND p.payment_id IS NULL THEN d.amount_due ELSE 0 END), 0) AS arrears_prior_years,
    COALESCE(SUM(CASE WHEN d.year_be = (SELECT year_be FROM fiscal_years WHERE is_active = TRUE LIMIT 1) AND p.payment_id IS NULL THEN d.amount_due ELSE 0 END), 0) AS arrears_current_year,
    COALESCE(SUM(CASE WHEN p.payment_id IS NULL THEN d.amount_due ELSE 0 END), 0) AS total_arrears
FROM houses h
JOIN zones z ON z.zone_id = h.zone_id
JOIN dues d ON d.house_id = h.house_id
LEFT JOIN payments p ON p.due_id = d.due_id
GROUP BY h.house_id, h.house_no, z.name;

-- เปิดใช้งาน Realtime ให้กับตารางสำคัญ
ALTER PUBLICATION supabase_realtime ADD TABLE payments;
ALTER PUBLICATION supabase_realtime ADD TABLE expenses;
ALTER PUBLICATION supabase_realtime ADD TABLE dues;
ALTER PUBLICATION supabase_realtime ADD TABLE other_income;
