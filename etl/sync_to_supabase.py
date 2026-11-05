"""
Sync Local Database (from (4-11-2569) รายงานการรับ จ่าย เงินคงเหลือ.xlsx) to Supabase
"""
import csv
import json
import os
import sys
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
DATA_DIR = os.path.join(ROOT, "data")

from config import SUPABASE_KEY, SUPABASE_URL

HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "resolution=merge-duplicates"
}

def sb_delete(table, filter_query):
    url = f"{SUPABASE_URL}/rest/v1/{table}?{filter_query}"
    req = urllib.request.Request(url, headers=HEADERS, method="DELETE")
    try:
        with urllib.request.urlopen(req) as resp:
            pass
        print(f"Deleted from {table} with query '{filter_query}'")
    except Exception as e:
        print(f"Delete error on {table}: {e}")

def sb_insert(table, rows):
    if not rows:
        return
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    chunk_size = 100
    for i in range(0, len(rows), chunk_size):
        chunk = rows[i:i + chunk_size]
        req = urllib.request.Request(
            url,
            data=json.dumps(chunk).encode("utf-8"),
            headers=HEADERS,
            method="POST"
        )
        try:
            with urllib.request.urlopen(req) as resp:
                pass
        except urllib.error.HTTPError as e:
            err_body = e.read().decode("utf-8")
            print(f"Error inserting into {table} (chunk {i}): {e.code} - {err_body}")
            raise RuntimeError(f"{table} insert error: {err_body}")
    print(f"Successfully uploaded {len(rows)} rows to {table}")

def load_csv(name):
    p = os.path.join(DATA_DIR, name + ".csv")
    with open(p, encoding="utf-8-sig") as f:
        return list(csv.DictReader(f))

def sync():
    if not SUPABASE_URL or not SUPABASE_KEY:
        print("Supabase credentials missing!")
        return

    print("=== SYNCING TO SUPABASE ===")
    
    # 1. Clear old child tables first (payments, dues, expenses, reserve_transactions, other_income, fee_rates)
    print("Clearing old records for 2569...")
    sb_delete("payments", "year_be=eq.2569")
    sb_delete("dues", "year_be=eq.2569")
    sb_delete("reserve_transactions", "year_be=eq.2569")
    sb_delete("expenses", "year_be=eq.2569")
    sb_delete("other_income", "year_be=eq.2569")
    sb_delete("fee_rates", "year_be=eq.2569")

    # 2. Fiscal Years
    fy_rows = []
    for r in load_csv("fiscal_years"):
        fy_rows.append({
            "year_be": int(r["year_be"]),
            "title": r.get("title") or f"ปีงบประมาณ {r['year_be']}",
            "opening_balance": float(r.get("opening_balance") or 0),
            "opening_reserve": float(r.get("opening_reserve") or 0),
            "is_active": True,
            "is_closed": False
        })
    sb_insert("fiscal_years", fy_rows)

    # 3. Zones
    z_rows = []
    for r in load_csv("zones"):
        z_rows.append({
            "zone_id": r["zone_id"],
            "name": r["name"],
            "sort_order": int(r.get("sort_order") or 0)
        })
    sb_insert("zones", z_rows)

    # 4. Houses
    h_rows = []
    for r in load_csv("houses"):
        h_rows.append({
            "house_id": r["house_id"],
            "house_no": r["house_no"],
            "zone_id": r["zone_id"],
            "status": r.get("status") or "normal"
        })
    sb_insert("houses", h_rows)

    # 5. Members
    m_rows = []
    for r in load_csv("members"):
        m_rows.append({
            "member_id": r["member_id"],
            "full_name": r["full_name"],
            "phone": r.get("phone") or "",
            "id_card": r.get("id_card") or ""
        })
    sb_insert("members", m_rows)

    # 6. House Members
    hm_rows = []
    for r in load_csv("house_members"):
        hm_rows.append({
            "house_id": r["house_id"],
            "member_id": r["member_id"],
            "role": r.get("role") or "owner",
            "from_date": r.get("from_date") or None,
            "to_date": r.get("to_date") or None
        })
    sb_insert("house_members", hm_rows)

    # 7. Fee Rates
    fr_rows = []
    for r in load_csv("fee_rates"):
        fr_rows.append({
            "rate_id": r["rate_id"],
            "zone_id": r["zone_id"],
            "year_be": int(r["year_be"]),
            "monthly_amount": float(r["monthly_amount"])
        })
    sb_insert("fee_rates", fr_rows)

    # 8. Dues (648 Period Dues)
    due_rows = []
    for r in load_csv("dues"):
        due_rows.append({
            "due_id": r["due_id"],
            "house_id": r["house_id"],
            "year_be": int(r["year_be"]),
            "month": int(r["month"]),
            "period": int(r["period"]),
            "amount_due": float(r["amount_due"])
        })
    sb_insert("dues", due_rows)

    # 9. Payments (377 Period Payments)
    p_rows = []
    for r in load_csv("payments"):
        p_rows.append({
            "payment_id": r["payment_id"],
            "due_id": r["due_id"] if r.get("due_id") else None,
            "year_be": 2569,
            "amount_paid": float(r["amount_paid"]),
            "paid_date": r["paid_date"],
            "channel": r.get("channel") or "transfer",
            "transfer_time": r.get("transfer_time") or "",
            "has_slip": r.get("has_slip") or "N",
            "slip_url": r.get("slip_url") or "",
            "recorded_by": r.get("recorded_by") or "import",
            "note": r.get("note") or ""
        })
    sb_insert("payments", p_rows)

    # 10. Expense Categories
    ec_rows = []
    for r in load_csv("expense_categories"):
        ec_rows.append({
            "category_id": r["category_id"],
            "name": r["name"]
        })
    sb_insert("expense_categories", ec_rows)

    # 11. Expenses
    exp_rows = []
    for r in load_csv("expenses"):
        edate = r.get("expense_date") or "2026-01-25"
        exp_rows.append({
            "expense_id": r["expense_id"],
            "year_be": 2569,
            "doc_no": r.get("doc_no") or "",
            "expense_date": edate,
            "description": r["description"],
            "amount": float(r["amount"]),
            "category_id": r.get("category_id") or "C99",
            "payee": r.get("payee") or "",
            "status": r.get("status") or "จ่ายแล้ว",
            "source": r.get("source") or "bank",
            "recorded_by": r.get("recorded_by") or "import"
        })
    sb_insert("expenses", exp_rows)

    # 12. Reserve Transactions
    rt_rows = []
    for r in load_csv("reserve_transactions"):
        rdate = r.get("date") or "2026-01-25"
        rt_rows.append({
            "rt_id": r["rt_id"],
            "year_be": 2569,
            "date": rdate,
            "type": r["type"],
            "amount": float(r["amount"]),
            "expense_id": r["expense_id"] if r.get("expense_id") else None,
            "note": r.get("note") or ""
        })
    sb_insert("reserve_transactions", rt_rows)

    # 13. Other Income
    oi_rows = []
    for r in load_csv("other_income"):
        oi_rows.append({
            "income_id": r["income_id"],
            "year_be": 2569,
            "date": r["date"] if r.get("date") else "2026-06-25",
            "type": r["type"],
            "amount": float(r["amount"]),
            "channel": "transfer",
            "note": r.get("note") or ""
        })
    sb_insert("other_income", oi_rows)

    print("=== SUPABASE SYNC COMPLETE! ===")

if __name__ == "__main__":
    sync()
