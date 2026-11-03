"""
ETL Migration Script: Google Sheets -> Supabase
"""
import base64
import json
import os
import sys
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from config import SUPABASE_KEY, SUPABASE_URL, TABLES
from core.sheets_api import sheet_get_many

HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "resolution=merge-duplicates"
}


def sb_insert(table, rows):
    if not rows:
        return
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    # batch in chunks of 200
    chunk_size = 200
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
    print(f"Successfully migrated {len(rows)} rows to {table}")


def run_migration():
    print("Fetching live data from Google Sheets...")
    sheet_data = sheet_get_many(TABLES)
    print("Data fetched. Tables:", list(sheet_data.keys()))

    # 1. fiscal_years
    fy_rows = []
    for r in sheet_data.get("fiscal_years", []):
        y = int(r["year_be"])
        fy_rows.append({
            "year_be": y,
            "title": f"ปีงบประมาณ {y}",
            "opening_balance": float(r.get("opening_balance") or 0),
            "opening_reserve": float(r.get("opening_reserve") or 0),
            "is_active": True if y == 2569 else False,
            "is_closed": False
        })
    sb_insert("fiscal_years", fy_rows)

    # 2. zones
    zone_rows = []
    for r in sheet_data.get("zones", []):
        zone_rows.append({
            "zone_id": str(r["zone_id"]),
            "name": str(r["name"]),
            "sort_order": int(r.get("sort_order") or 0)
        })
    sb_insert("zones", zone_rows)

    # 3. houses
    house_rows = []
    for r in sheet_data.get("houses", []):
        house_rows.append({
            "house_id": str(r["house_id"]),
            "house_no": str(r["house_no"]),
            "zone_id": str(r["zone_id"]),
            "status": str(r.get("status") or "normal")
        })
    sb_insert("houses", house_rows)

    # 4. members
    member_rows = []
    for r in sheet_data.get("members", []):
        member_rows.append({
            "member_id": str(r["member_id"]),
            "full_name": str(r["full_name"]),
            "phone": str(r.get("phone") or "")
        })
    sb_insert("members", member_rows)

    # 5. house_members
    hm_rows = []
    for r in sheet_data.get("house_members", []):
        hm_rows.append({
            "house_id": str(r["house_id"]),
            "member_id": str(r["member_id"]),
            "role": str(r.get("role") or "owner"),
            "from_date": r.get("from_date") or None,
            "to_date": r.get("to_date") or None
        })
    sb_insert("house_members", hm_rows)

    # 6. fee_rates
    fr_rows = []
    for r in sheet_data.get("fee_rates", []):
        fr_rows.append({
            "rate_id": str(r["rate_id"]),
            "zone_id": str(r["zone_id"]),
            "year_be": int(r["year_be"]),
            "monthly_amount": float(r["monthly_amount"])
        })
    sb_insert("fee_rates", fr_rows)

    # 7. dues
    due_rows = []
    for r in sheet_data.get("dues", []):
        due_rows.append({
            "due_id": str(r["due_id"]),
            "house_id": str(r["house_id"]),
            "year_be": int(r["year_be"]),
            "month": int(r["month"]),
            "period": int(r["period"]),
            "amount_due": float(r["amount_due"])
        })
    sb_insert("dues", due_rows)

    # 8. users
    user_rows = []
    user_ids = set()
    for r in sheet_data.get("users", []):
        uid = str(r["user_id"])
        user_ids.add(uid)
        user_rows.append({
            "user_id": uid,
            "username": str(r["username"]),
            "password_hash": str(r["password_hash"]),
            "role": str(r.get("role") or "staff"),
            "active": True if str(r.get("active", "Y")).upper() == "Y" else False
        })
    if "import" not in user_ids:
        user_rows.append({
            "user_id": "import",
            "username": "system_import",
            "password_hash": "*",
            "role": "admin",
            "active": False
        })
    sb_insert("users", user_rows)

    # 9. payments
    payment_rows = []
    all_user_ids = set(u["user_id"] for u in user_rows)
    for r in sheet_data.get("payments", []):
        pdate = str(r.get("paid_date") or "").strip()
        if len(pdate) < 8:
            pdate = "2026-01-01"
        rec = str(r.get("recorded_by") or "").strip()
        if rec not in all_user_ids:
            rec = "U001" if "U001" in all_user_ids else "import"
        payment_rows.append({
            "payment_id": str(r["payment_id"]),
            "due_id": str(r["due_id"]),
            "year_be": 2569, # Current fiscal year
            "amount_paid": float(r["amount_paid"]),
            "paid_date": pdate,
            "channel": str(r.get("channel") or "transfer"),
            "transfer_time": str(r.get("transfer_time") or ""),
            "has_slip": str(r.get("has_slip") or "N"),
            "slip_url": str(r.get("slip_url") or ""),
            "recorded_by": rec,
            "note": str(r.get("note") or "")
        })
    sb_insert("payments", payment_rows)

    # 10. expense_categories
    ec_rows = []
    for r in sheet_data.get("expense_categories", []):
        ec_rows.append({
            "category_id": str(r["category_id"]),
            "name": str(r["name"])
        })
    sb_insert("expense_categories", ec_rows)

    # 11. expenses
    exp_rows = []
    valid_cats = set(r["category_id"] for r in sheet_data.get("expense_categories", []))
    for r in sheet_data.get("expenses", []):
        cat = str(r.get("category_id") or "").strip()
        if cat not in valid_cats:
            cat = None
        exp_date = str(r.get("expense_date") or "").strip()
        if len(exp_date) < 8:
            exp_date = "2026-01-01"
        exp_rows.append({
            "expense_id": str(r["expense_id"]),
            "year_be": 2569,
            "doc_no": str(r.get("doc_no") or ""),
            "expense_date": exp_date,
            "description": str(r["description"]),
            "amount": float(r["amount"]),
            "category_id": cat,
            "payee": str(r.get("payee") or ""),
            "status": str(r.get("status") or "paid"),
            "source": str(r.get("source") or "bank"),
            "recorded_by": "U001"
        })
    sb_insert("expenses", exp_rows)

    # 12. reserve_transactions
    rt_rows = []
    valid_exp_ids = set(e["expense_id"] for e in exp_rows)
    for r in sheet_data.get("reserve_transactions", []):
        eid = str(r.get("expense_id") or "").strip()
        if eid not in valid_exp_ids:
            eid = None
        rdate = str(r.get("date") or "").strip()
        if len(rdate) < 8:
            rdate = "2026-01-01"
        rt_rows.append({
            "rt_id": str(r["rt_id"]),
            "year_be": 2569,
            "date": rdate,
            "type": str(r["type"]),
            "amount": float(r["amount"]),
            "expense_id": eid,
            "note": str(r.get("note") or "")
        })
    sb_insert("reserve_transactions", rt_rows)

    # 13. other_income
    oi_rows = []
    for r in sheet_data.get("other_income", []):
        odate = str(r.get("date") or "").strip()
        if len(odate) < 8:
            odate = "2026-01-01"
        oi_rows.append({
            "income_id": str(r["income_id"]),
            "year_be": 2569,
            "date": odate,
            "type": str(r["type"]),
            "amount": float(r["amount"]),
            "channel": str(r.get("channel") or "bank"),
            "note": str(r.get("note") or "")
        })
    sb_insert("other_income", oi_rows)

    # 14. site_stats
    ss_rows = []
    for r in sheet_data.get("site_stats", []):
        ss_rows.append({
            "date": str(r["date"]),
            "views": int(r.get("views") or 0),
            "visitors": int(r.get("visitors") or 0)
        })
    sb_insert("site_stats", ss_rows)

    print("ALL DATA MIGRATION COMPLETE!")


if __name__ == "__main__":
    run_migration()
