import json
import re
import threading

from flask import Blueprint, jsonify, request
from werkzeug.security import check_password_hash

from config import FY, INCOME_TYPES, MONTH_TH, num
from core.auth import audit, make_token, next_id, require
from core.sheets_api import sheet_post
from services.calculations import houses_view
from services.store import append_to_csv, store

staff_bp = Blueprint("staff", __name__)


@staff_bp.post("/api/login")
def api_login():
    b = request.get_json(force=True)
    users = store.data.get("users", [])
    candidates = [x for x in users if x.get("username") == b.get("username") and x.get("active") == "Y"]
    u = next((x for x in candidates if check_password_hash(x.get("password_hash", ""), b.get("password", ""))), None)
    if not u:
        return jsonify(error="ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง"), 401
    return jsonify(token=make_token(u), username=u["username"], role=u["role"])


@staff_bp.get("/api/staff/houses")
@require()
def api_staff_houses():
    return jsonify(houses_view(full=True))


@staff_bp.get("/api/staff/categories")
@require()
def api_staff_categories():
    return jsonify(store.data.get("expense_categories", []))


@staff_bp.get("/api/staff/recent")
@require()
def api_staff_recent():
    d = store.data
    dues = {x["due_id"]: x for x in d.get("dues", [])}
    houses = {h["house_id"]: h["house_no"] for h in d.get("houses", [])}
    pays = []
    for p in sorted(d.get("payments", []), key=lambda p: p.get("payment_id", ""), reverse=True)[:100]:
        du = dues.get(p.get("due_id"), {})
        pays.append({
            "payment_id": p.get("payment_id"),
            "house_no": houses.get(du.get("house_id"), ""),
            "month": du.get("month"),
            "amount": num(p.get("amount_paid")),
            "paid_date": p.get("paid_date"),
            "channel": p.get("channel"),
            "recorded_by": p.get("recorded_by"),
            "note": p.get("note", "")
        })
    exps = sorted(d.get("expenses", []), key=lambda e: e.get("expense_id", ""), reverse=True)[:100]
    audit_logs = list(reversed(d.get("audit_log", [])))
    incs = sorted(d.get("other_income", []), key=lambda i: i.get("income_id", ""), reverse=True)[:100]
    return jsonify(payments=pays, expenses=exps, incomes=incs, audit_logs=audit_logs)


@staff_bp.get("/api/staff/reports/all")
@require()
def api_staff_reports_all():
    d = store.data
    dues = {x["due_id"]: x for x in d.get("dues", [])}
    houses = {h["house_id"]: h for h in d.get("houses", [])}
    zones = {z["zone_id"]: z.get("zone_name", "") for z in d.get("zones", [])}
    categories = {c["category_id"]: c.get("name", "") for c in d.get("expense_categories", [])}
    members = {m["member_id"]: m.get("full_name", "") for m in d.get("members", [])}
    owners = {}
    for hm in d.get("house_members", []):
        owners.setdefault(hm["house_id"], []).append(members.get(hm["member_id"], ""))

    pays = []
    for p in sorted(d.get("payments", []), key=lambda x: (x.get("paid_date", ""), x.get("payment_id", "")), reverse=True):
        du = dues.get(p.get("due_id"), {})
        if du.get("year_be") and str(du.get("year_be")) != str(FY):
            continue
        h_id = du.get("house_id", "")
        h = houses.get(h_id, {})
        m = du.get("month", "")
        q = ((int(m) - 1) // 3) + 1 if str(m).isdigit() else ""
        pays.append({
            "payment_id": p.get("payment_id"),
            "due_id": p.get("due_id"),
            "house_id": h_id,
            "house_no": h.get("house_no", ""),
            "zone_name": zones.get(h.get("zone_id"), ""),
            "owner": ", ".join(filter(None, owners.get(h_id, []))) or "-",
            "month": m,
            "quarter": q,
            "amount": num(p.get("amount_paid")),
            "paid_date": p.get("paid_date"),
            "channel": p.get("channel", "transfer"),
            "has_slip": p.get("has_slip", ""),
            "transfer_time": p.get("transfer_time", ""),
            "recorded_by": p.get("recorded_by", ""),
            "note": p.get("note", "")
        })

    exps = []
    for e in sorted(d.get("expenses", []), key=lambda x: (x.get("expense_date", ""), x.get("expense_id", "")), reverse=True):
        exps.append({
            "expense_id": e.get("expense_id"),
            "doc_no": e.get("doc_no", ""),
            "expense_date": e.get("expense_date", ""),
            "description": e.get("description", ""),
            "amount": num(e.get("amount")),
            "category_id": e.get("category_id", ""),
            "category_name": categories.get(e.get("category_id"), "ทั่วไป"),
            "payee": e.get("payee", ""),
            "source": e.get("source", "bank"),
            "status": e.get("status", "อนุมัติ"),
            "recorded_by": e.get("recorded_by", "")
        })

    incs = []
    for i in sorted(d.get("other_income", []), key=lambda x: (x.get("date", ""), x.get("income_id", "")), reverse=True):
        incs.append({
            "income_id": i.get("income_id"),
            "date": i.get("date", ""),
            "type": i.get("type", "other"),
            "type_label": INCOME_TYPES.get(i.get("type"), i.get("type", "อื่นๆ")),
            "amount": num(i.get("amount")),
            "channel": i.get("channel", "transfer"),
            "note": i.get("note", "")
        })

    return jsonify(
        fiscal_year=FY,
        payments=pays,
        expenses=exps,
        incomes=incs,
        categories=d.get("expense_categories", [])
    )


@staff_bp.post("/api/staff/payments")
@require()
def api_add_payment():
    b = request.get_json(force=True)
    d = store.data
    months = sorted({int(m) for m in b.get("months", [])})
    if not b.get("house_id") or not months:
        return jsonify(error="ต้องเลือกบ้านและเดือน/งวดที่ชำระ"), 400
    if not re.match(r"\d{4}-\d{2}-\d{2}$", b.get("paid_date", "")):
        return jsonify(error="วันที่ไม่ถูกต้อง"), 400
    if b.get("channel") not in ("transfer", "cash"):
        return jsonify(error="ช่องทางชำระไม่ถูกต้อง"), 400

    with store.write_lock:
        paid_dues = {p["due_id"] for p in d.get("payments", [])}
        dues = {(x["house_id"], int(x["month"])): x for x in d.get("dues", []) if str(x.get("year_be")) == str(FY)}
        for m in months:
            du = dues.get((b["house_id"], m))
            if not du:
                return jsonify(error=f"ไม่พบรายการเดือน {m}"), 400
            if du["due_id"] in paid_dues:
                return jsonify(error=f"เดือน {MONTH_TH[m - 1]} มีประวัติชำระเงินแล้ว"), 409

        added = []
        for m in months:
            du = dues[(b["house_id"], m)]
            row = {
                "payment_id": next_id("P", d.get("payments", []), "payment_id", 5),
                "due_id": du["due_id"],
                "amount_paid": du["amount_due"],
                "paid_date": b["paid_date"],
                "channel": b["channel"],
                "has_slip": "Y" if b.get("has_slip") else "N",
                "transfer_time": b.get("transfer_time", ""),
                "recorded_by": request.user["user_id"],
                "note": b.get("note", "")
            }
            sheet_post(action="append", table="payments", row=row)
            d.setdefault("payments", []).append(row)
            append_to_csv("payments", row)
            audit(request.user, "create", "payments", row["payment_id"], new=json.dumps(row, ensure_ascii=False))
            added.append(row["payment_id"])

        with store.cond:
            store.version += 1
            store.digest = json.dumps(d, sort_keys=True, ensure_ascii=False)
            store.cond.notify_all()

    threading.Thread(target=store.refresh, daemon=True).start()
    return jsonify(ok=True, added=added)


@staff_bp.post("/api/staff/expenses")
@require()
def api_add_expense():
    b = request.get_json(force=True)
    d = store.data
    amount = num(b.get("amount"), -1)
    if amount <= 0 or not b.get("description") or not re.match(r"\d{4}-\d{2}-\d{2}$", b.get("expense_date", "")):
        return jsonify(error="กรุณากรอกข้อมูลให้ครบถ้วนและถูกต้อง"), 400

    with store.write_lock:
        nums = [int(m.group(1)) for e in d.get("expenses", []) if (m := re.match(r"\s*(\d+)/", str(e.get("doc_no", ""))))]
        doc_no = f"{max(nums, default=0) + 1}/{FY % 100}"
        row = {
            "expense_id": next_id("E", d.get("expenses", []), "expense_id", 4),
            "doc_no": doc_no,
            "expense_date": b["expense_date"],
            "description": b["description"],
            "amount": amount,
            "category_id": b.get("category_id", "C01"),
            "payee": b.get("payee", ""),
            "status": "จ่ายแล้ว",
            "source": b.get("source", "bank"),
            "recorded_by": request.user["user_id"]
        }
        sheet_post(action="append", table="expenses", row=row)
        d.setdefault("expenses", []).append(row)
        append_to_csv("expenses", row)
        audit(request.user, "create", "expenses", row["expense_id"], new=json.dumps(row, ensure_ascii=False))

        with store.cond:
            store.version += 1
            store.digest = json.dumps(d, sort_keys=True, ensure_ascii=False)
            store.cond.notify_all()

    threading.Thread(target=store.refresh, daemon=True).start()
    return jsonify(ok=True, expense=row)


@staff_bp.post("/api/staff/income")
@require()
def api_add_income():
    b = request.get_json(force=True)
    d = store.data
    amount = num(b.get("amount"), -1)
    itype = b.get("type")
    if amount <= 0 or itype not in INCOME_TYPES or not re.match(r"\d{4}-\d{2}-\d{2}$", b.get("date", "")):
        return jsonify(error="กรุณากรอกประเภท จำนวนเงิน และวันที่ให้ถูกต้อง"), 400
    if b.get("channel") not in ("cash", "transfer"):
        return jsonify(error="กรุณาเลือกช่องทางรับเงิน (เงินสด / โอนเข้าธนาคาร)"), 400

    with store.write_lock:
        row = {
            "income_id": next_id("I", d.get("other_income", []), "income_id", 3),
            "date": b["date"],
            "type": itype,
            "amount": amount,
            "note": b.get("note", ""),
            "channel": b["channel"],
        }
        sheet_post(action="append", table="other_income", row=row)
        d.setdefault("other_income", []).append(row)
        append_to_csv("other_income", row)
        audit(request.user, "create", "other_income", row["income_id"], new=json.dumps(row, ensure_ascii=False))

        with store.cond:
            store.version += 1
            store.digest = json.dumps(d, sort_keys=True, ensure_ascii=False)
            store.cond.notify_all()

    threading.Thread(target=store.refresh, daemon=True).start()
    return jsonify(ok=True, income=row)
