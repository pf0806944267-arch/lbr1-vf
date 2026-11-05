"""
ETL Pipeline V2: Build Database from (4-11-2569) รายงานการรับ จ่าย เงินคงเหลือ.xlsx
- Records payments as "งวด" (Periods 1-4) instead of months
- Recalculates whole year dues and overdue balances
- Matches bank transactions from สมุดธนาคาร
- Updates all financial statements, expenses, and reserve transactions
"""
import csv
import datetime as dt
import glob
import os
import re
import sys
import openpyxl

sys.stdout.reconfigure(encoding="utf-8")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(ROOT, "data")
os.makedirs(DATA_DIR, exist_ok=True)

EXCEL_FILE = os.path.join(ROOT, "(4-11-2569) รายงานการรับ จ่าย เงินคงเหลือ.xlsx")
FY = 2569

def fix_date(v):
    if isinstance(v, dt.datetime):
        return dt.date(v.year + 57, v.month, v.day) if v.year < 2000 else v.date()
    if isinstance(v, str):
        m = re.match(r"\s*(\d{1,2})/(\d{1,2})/(\d{2,4})", v)
        if m:
            d, mo, y = map(int, m.groups())
            y = y + 2500 if y < 100 else y
            return dt.date(y - 543, mo, d)
    return None

def norm_house(v):
    if v is None:
        return None
    s = str(v).strip()
    s = re.sub(r"\.0$", "", s)
    s = re.sub(r"\s+", "", s)
    return s or None

def write_csv(name, header, rows):
    path = os.path.join(DATA_DIR, name + ".csv")
    with open(path, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(header)
        w.writerows(rows)
    print(f"Wrote {name}.csv: {len(rows)} rows")

def run():
    print(f"Loading {EXCEL_FILE}...")
    wb = openpyxl.load_workbook(EXCEL_FILE, data_only=True)

    # 1. Bank transactions from สมุดธนาคาร
    ws_bank = wb["สมุดธนาคาร"]
    bank_records = []
    for r in ws_bank.iter_rows(min_row=6, values_only=True):
        d = fix_date(r[1])
        hno = norm_house(r[2])
        desc = str(r[4] or "")
        amt_in = r[5] if isinstance(r[5], (int, float)) else None
        amt_out = r[6] if isinstance(r[6], (int, float)) else None
        t = r[8]
        time_s = f"{int(t):02d}:{int(round((t - int(t)) * 100)):02d}" if isinstance(t, (int, float)) else str(t or "").strip()
        if amt_in or amt_out:
            bank_records.append({
                "date": d.isoformat() if d else "",
                "time": time_s,
                "house_no": hno,
                "desc": desc,
                "income": amt_in,
                "expense": amt_out,
                "used": False
            })
    print(f"Loaded {len(bank_records)} bank records from สมุดธนาคาร")

    # 2. Zones, Houses, Members, Dues, Payments
    zones = []
    houses = []
    members = []
    house_members = []
    dues = []
    payments = []
    member_map = {}

    zone_order = 0
    house_id_num = 0
    payment_id_num = 0

    # Group bank records by house_no for matching
    bank_by_house = {}
    for b in bank_records:
        if b["house_no"] and b["income"]:
            bank_by_house.setdefault(b["house_no"], []).append(b)

    for ws in wb:
        t = ws.title.strip()
        if not (t.startswith("ซอย") or t.startswith("สายหลัก")):
            continue
        zone_order += 1
        zone_id = f"Z{zone_order:02d}"
        zname = "สายหลัก" if t.startswith("สายหลัก") else "ซอย " + re.search(r"ซอย\s*(\d+)", t).group(1)
        zones.append([zone_id, zname, zone_order])

        m_rate = 100.0 if zname == "สายหลัก" else 300.0
        q_rate = 300.0 if zname == "สายหลัก" else 900.0

        for r in ws.iter_rows(min_row=5, values_only=True):
            if not (isinstance(r[1], int) and r[2] is not None):
                continue
            hno = norm_house(r[3])
            if not hno:
                continue

            house_id_num += 1
            hid = f"H{house_id_num:03d}"
            houses.append([hid, hno, zone_id, "normal"])

            raw_owner = str(r[2]).strip()
            owner_clean = re.sub(r"^\s*คุณ\s*", "", raw_owner).strip()
            owners = [re.sub(r"^\s*คุณ\s*", "", s).strip() for s in re.split(r"[/,]", owner_clean) if s.strip()]
            for o in owners or [owner_clean]:
                if not o:
                    continue
                if o not in member_map:
                    mid = f"M{len(member_map) + 1:03d}"
                    member_map[o] = mid
                    members.append([mid, o, "", ""])
                house_members.append([hid, member_map[o], "owner", "", ""])

            note_val = str(r[16] or "").strip() if len(r) > 16 else ""
            vals = [r[4 + i] for i in range(12)]

            # 4 Dues per house (งวด 1 - 4)
            for pr in range(1, 5):
                due_id = f"D{FY}-{hid}-P{pr}"
                dues.append([due_id, hid, FY, pr, pr, q_rate])

                q_vals = vals[(pr - 1) * 3 : pr * 3]
                q_sum = sum(v for v in q_vals if isinstance(v, (int, float)) and v > 0)

                if q_sum > 0:
                    payment_id_num += 1
                    pid = f"P{payment_id_num:05d}"

                    # Try to match bank transaction
                    p_date = "2026-01-25"
                    p_time = ""
                    p_note = note_val
                    p_channel = "transfer"

                    b_cands = bank_by_house.get(hno, [])
                    avail_b = [b for b in b_cands if not b["used"]]
                    if avail_b:
                        matched_b = avail_b[0]
                        matched_b["used"] = True
                        if matched_b["date"]:
                            p_date = matched_b["date"]
                        if matched_b["time"]:
                            p_time = matched_b["time"]

                    payments.append([
                        pid,
                        due_id,
                        q_sum,
                        p_date,
                        p_channel,
                        "Y",
                        p_time,
                        "import",
                        p_note
                    ])

    # Special House for NOSLIP (ลูกบ้านยังไม่ระบุ / ไม่มีสลิป)
    houses.append(["NOSLIP", "ไม่มีสลิป", "Z01", "noslip"])
    members.append(["M000", "ยังไม่ระบุลูกบ้าน (ไม่มีสลิป)", "", ""])
    house_members.append(["NOSLIP", "M000", "owner", "", ""])

    # 3. Fee Rates
    fee_rates = []
    for z in zones:
        fee_rates.append([f"R{z[0]}", z[0], FY, 100.0 if z[1] == "สายหลัก" else 300.0])

    # 4. Fiscal Years
    fiscal_years = [
        [FY, "ปีงบประมาณ 2569", 82969.73, 10049.57, "", "", "2026-01-01", "2026-12-31", "Y", "N"]
    ]

    # 5. Expense Categories
    CATS = [
        ("C01", "รปภ./ค่าจ้าง", ["รปภ", "ค่าจ้าง", "เก็บกวาด", "พิเชษฐ์"]),
        ("C02", "สาธารณูปโภค", ["ค่าน้ำ", "ค่าไฟ", "ประปา", "ไฟฟ้า"]),
        ("C03", "ค่าธรรมเนียมธนาคาร/SMS", ["SMS", "ธรรมเนียม", "ธนาคาร"]),
        ("C04", "ซ่อมบำรุง/อุปกรณ์", ["ซ่อม", "โคม", "ไฟ", "หลอด", "ปูน", "กระเบื้อง", "ตู้", "สี", "คัทเอาท์", "หญ้า", "สวน"]),
        ("C05", "กิจกรรม/พิธี", ["พิธี", "บวงสรวง", "กิจกรรม", "งาน"]),
        ("C99", "อื่นๆ", [])
    ]
    def categorize(desc):
        for cid, _, kws in CATS:
            if any(k in desc for k in kws):
                return cid
        return "C99"

    expense_categories = [[c[0], c[1]] for c in CATS]

    # 6. Expenses
    ws_exp = wb["รายจ่ายถึงปัจจุบัน "]
    expenses = []
    exp_num = 0
    last_exp_date = "2026-01-25"
    for r in ws_exp.iter_rows(min_row=5, values_only=True):
        doc = r[1]
        dte = r[2]
        desc = r[3]
        amt = r[5]
        payee = r[6]
        ptype = str(r[7] or "")

        if not doc or not isinstance(amt, (int, float)):
            continue

        exp_num += 1
        eid = f"E{exp_num:04d}"
        d = fix_date(dte)
        if d:
            last_exp_date = d.isoformat()
        exp_date = d.isoformat() if d else last_exp_date
        desc_str = str(desc or "").strip()
        cat_id = categorize(desc_str)
        source = "bank" if ("ธนาคาร" in ptype or "SMS" in desc_str) else "reserve"

        expenses.append([
            eid,
            str(doc).strip(),
            exp_date,
            desc_str,
            float(amt),
            cat_id,
            str(payee or "").strip(),
            "จ่ายแล้ว",
            source,
            "import"
        ])

    exp_by_doc = {e[1]: e[0] for e in expenses}

    # 7. Reserve Transactions
    ws_res = wb["เงินสำรองจ่าย"]
    reserve_transactions = []
    rt_num = 0
    last_res_date = "2026-01-25"
    # min_row=6 starts right after the 'รวม' header row (which is at row 5)
    for idx, r in enumerate(ws_res.iter_rows(min_row=6, values_only=True)):
        doc = r[1]
        dte = r[2]
        desc = str(r[3] or "").strip()
        out_amt = r[5]
        in_amt = r[6]

        if not in_amt and not out_amt:
            continue
        if desc == "รวม":
            continue

        d = fix_date(dte)
        if d:
            last_res_date = d.isoformat()
        d_str = d.isoformat() if d else last_res_date

        if isinstance(in_amt, (int, float)) and in_amt > 0:
            rt_num += 1
            reserve_transactions.append([
                f"RT{rt_num:04d}",
                d_str,
                "in",
                float(in_amt),
                "",
                desc
            ])
        elif isinstance(out_amt, (int, float)) and out_amt > 0:
            rt_num += 1
            eid = exp_by_doc.get(str(doc).strip(), "")
            reserve_transactions.append([
                f"RT{rt_num:04d}",
                d_str,
                "out",
                float(out_amt),
                eid,
                desc
            ])

    # 8. Other Income
    ws_inc = wb["เงินสนับสนุน"]
    other_income = []
    inc_num = 0
    for r in ws_inc.iter_rows(min_row=4, values_only=True):
        dte = r[1]
        desc = str(r[2] or "").strip()
        amt = r[3]
        if isinstance(amt, (int, float)) and amt > 0 and "รวม" not in desc:
            inc_num += 1
            d = fix_date(dte)
            other_income.append([
                f"I{inc_num:03d}",
                d.isoformat() if d else "",
                "interest",
                float(amt),
                desc
            ])

    # 9. Existing Users & Audit Log (Preserve)
    users = []
    u_path = os.path.join(DATA_DIR, "users.csv")
    if os.path.exists(u_path):
        with open(u_path, encoding="utf-8-sig") as f:
            r = list(csv.reader(f))
            if r:
                users = r[1:]
    if not users:
        from werkzeug.security import generate_password_hash
        users = [
            ["U001", "admin", generate_password_hash("11111111"), "admin", "ผู้ดูแลระบบ", "Y"],
            ["U002", "staff", generate_password_hash("11111111"), "staff", "เจ้าหน้าที่การเงิน", "Y"]
        ]

    # Write all CSV files
    write_csv("zones", ["zone_id", "name", "sort_order"], zones)
    write_csv("houses", ["house_id", "house_no", "zone_id", "status"], houses)
    write_csv("members", ["member_id", "full_name", "phone", "id_card"], members)
    write_csv("house_members", ["house_id", "member_id", "role", "from_date", "to_date"], house_members)
    write_csv("fee_rates", ["rate_id", "zone_id", "year_be", "monthly_amount"], fee_rates)
    write_csv("fiscal_years", ["year_be", "title", "opening_balance", "opening_reserve", "closing_balance", "closing_reserve", "start_date", "end_date", "is_active", "is_closed"], fiscal_years)
    write_csv("dues", ["due_id", "house_id", "year_be", "month", "period", "amount_due"], dues)
    write_csv("payments", ["payment_id", "due_id", "amount_paid", "paid_date", "channel", "has_slip", "transfer_time", "recorded_by", "note"], payments)
    write_csv("expense_categories", ["category_id", "name"], expense_categories)
    write_csv("expenses", ["expense_id", "doc_no", "expense_date", "description", "amount", "category_id", "payee", "status", "source", "recorded_by"], expenses)
    write_csv("reserve_transactions", ["rt_id", "date", "type", "amount", "expense_id", "note"], reserve_transactions)
    write_csv("other_income", ["income_id", "date", "type", "amount", "note"], other_income)
    write_csv("users", ["user_id", "username", "password_hash", "role", "full_name", "active"], users)

    print("\n=== VERIFICATION SUMMARY ===")
    print(f"Houses: {len([h for h in houses if h[0] != 'NOSLIP'])} (Expected 162)")
    print(f"Dues: {len(dues)} (Expected 648 = 162 * 4 periods)")
    print(f"Payments: {len(payments)} period payments")
    p_by_pr = {1: 0.0, 2: 0.0, 3: 0.0, 4: 0.0}
    d_map = {d[0]: d[4] for d in dues}
    for p in payments:
        pr = d_map.get(p[1])
        if pr:
            p_by_pr[pr] += float(p[2])
    print(f"Received by Period: {p_by_pr}")
    print(f"Total Member Payments: {sum(p_by_pr.values()):,.2f} (Expected 316,500.00)")
    print(f"Expenses Count: {len(expenses)}, Total: {sum(e[4] for e in expenses):,.2f} (Expected 338,382.75)")
    rin = sum(r[3] for r in reserve_transactions if r[2] == "in")
    rout = sum(r[3] for r in reserve_transactions if r[2] == "out")
    print(f"Reserve IN: {rin:,.2f}, Reserve OUT: {rout:,.2f}, Balance: {rin - rout:,.2f} (Expected 11,816.82)")
    print(f"Other Income: {sum(i[3] for i in other_income):,.2f} (Expected 168.39)")

if __name__ == "__main__":
    run()
