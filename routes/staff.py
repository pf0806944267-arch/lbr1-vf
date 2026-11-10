import base64
import json
import os
import re
import threading
import time

from flask import Blueprint, jsonify, request
from werkzeug.security import check_password_hash

from config import FY, INCOME_TYPES, MONTH_TH, ROOT, num, DRIVE_FOLDER_ID
from core.auth import audit, make_token, next_id, require
from core.sheets_api import sheet_post, sheet_insert_many
from services.calculations import houses_view, summary, get_active_fy, get_fiscal_years_list
from services.store import append_to_csv, store, save_table_to_csv

staff_bp = Blueprint("staff", __name__)


@staff_bp.post("/api/login")
def api_login():
    b = request.get_json(force=True)
    users = store.data.get("users", [])
    candidates = [x for x in users if x.get("username") == b.get("username") and str(x.get("active", "")).lower() in ("y", "true", "1")]
    u = next((x for x in candidates if check_password_hash(x.get("password_hash", ""), b.get("password", ""))), None)
    if not u:
        return jsonify(error="ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง"), 401
    return jsonify(token=make_token(u), username=u["username"], role=u["role"])


@staff_bp.get("/api/staff/houses")
@require()
def api_staff_houses():
    year = request.args.get("year", type=int)
    return jsonify(houses_view(full=True, target_fy=year))


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
        if du and du.get("year_be") and str(du.get("year_be")) != str(FY):
            continue
        h_id = du.get("house_id", "") if du else (p.get("house_id") or "NOSLIP")
        h_no = houses.get(h_id, "ไม่มีสลิป" if h_id == "NOSLIP" else "")
        q = du.get("period", "") if du else (p.get("period") or "")
        pays.append({
            "payment_id": p.get("payment_id"),
            "house_id": h_id,
            "house_no": h_no,
            "month": du.get("month", ""),
            "quarter": q,
            "period": q,
            "amount": num(p.get("amount_paid")),
            "amount_paid": num(p.get("amount_paid")),
            "paid_date": p.get("paid_date"),
            "channel": p.get("channel"),
            "has_slip": p.get("has_slip", ""),
            "slip_url": p.get("slip_url", ""),
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
    target_fy = request.args.get("year", type=int) or get_active_fy()
    d = store.data
    dues = {x["due_id"]: x for x in d.get("dues", [])}
    houses = {h["house_id"]: h for h in d.get("houses", [])}
    zones = {z["zone_id"]: z.get("name", "") or z.get("zone_name", "") for z in d.get("zones", [])}
    categories = {c["category_id"]: c.get("name", "") for c in d.get("expense_categories", [])}
    members = {m["member_id"]: m.get("full_name", "") for m in d.get("members", [])}
    owners = {}
    for hm in d.get("house_members", []):
        owners.setdefault(hm["house_id"], []).append(members.get(hm["member_id"], ""))

    pays = []
    for p in sorted(d.get("payments", []), key=lambda x: (x.get("paid_date", ""), x.get("payment_id", "")), reverse=True):
        du = dues.get(p.get("due_id"), {})
        p_year = du.get("year_be") if du else (p.get("year_be") or p.get("fiscal_year"))
        if p_year and str(p_year) != str(target_fy):
            continue
        h_id = du.get("house_id", "") if du else (p.get("house_id") or "NOSLIP")
        h = houses.get(h_id, {})
        h_no = h.get("house_no") or ("ไม่มีสลิป" if h_id == "NOSLIP" else "-")
        owner_str = ", ".join(filter(None, owners.get(h_id, []))) or ("ยังไม่ระบุลูกบ้าน (ไม่มีสลิป)" if h_id == "NOSLIP" else "-")
        q = du.get("period", "") if du else (p.get("period") or "")
        pays.append({
            "payment_id": p.get("payment_id"),
            "due_id": p.get("due_id", ""),
            "house_id": h_id,
            "house_no": h_no,
            "zone_name": zones.get(h.get("zone_id"), "-"),
            "owner": owner_str,
            "month": du.get("month", ""),
            "quarter": q,
            "period": q,
            "amount": num(p.get("amount_paid")),
            "amount_paid": num(p.get("amount_paid")),
            "paid_date": p.get("paid_date"),
            "channel": p.get("channel", "transfer"),
            "has_slip": p.get("has_slip", ""),
            "slip_url": p.get("slip_url", ""),
            "transfer_time": p.get("transfer_time", ""),
            "recorded_by": p.get("recorded_by", ""),
            "note": p.get("note", "")
        })

    exps = []
    for e in sorted(d.get("expenses", []), key=lambda x: (x.get("expense_date", ""), x.get("expense_id", "")), reverse=True):
        if str(e.get("year_be", target_fy)) != str(target_fy):
            continue
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
        if str(i.get("year_be", target_fy)) != str(target_fy):
            continue
        incs.append({
            "income_id": i.get("income_id"),
            "date": i.get("date", ""),
            "type": i.get("type", "other"),
            "type_label": INCOME_TYPES.get(i.get("type"), i.get("type", "อื่นๆ")),
            "amount": num(i.get("amount")),
            "channel": i.get("channel", "transfer"),
            "note": i.get("note", "")
        })

    reserve_list = [r for r in d.get("reserve_transactions", []) if str(r.get("year_be", target_fy)) == str(target_fy)]

    summary_data = summary(target_fy=target_fy)
    bal = summary_data.get("balance", {})

    return jsonify(
        fiscal_year=target_fy,
        fiscal_years=get_fiscal_years_list(d),
        active_year=get_active_fy(d),
        balance=bal,
        opening_balance=bal.get("opening", 82969.73),
        opening_bank=round(bal.get("opening", 82969.73) - bal.get("opening_reserve", 10049.57), 2),
        opening_reserve=bal.get("opening_reserve", 10049.57),
        payments=pays,
        expenses=exps,
        incomes=incs,
        reserve=reserve_list,
        categories=d.get("expense_categories", [])
    )


@staff_bp.post("/api/staff/payments")
@require()
def api_add_payment():
    b = request.get_json(force=True)
    d = store.data
    house_id = str(b.get("house_id", "")).strip()

    if not house_id:
        return jsonify(error="ต้องเลือกลูกบ้าน / บ้านเลขที่"), 400
    if not re.match(r"\d{4}-\d{2}-\d{2}$", b.get("paid_date", "")):
        return jsonify(error="วันที่ไม่ถูกต้อง"), 400
    if b.get("channel") not in ("transfer", "cash"):
        return jsonify(error="ช่องทางชำระไม่ถูกต้อง"), 400

    # จัดการไฟล์สลิป (บันทึกลง Local และ Supabase Storage / Drive)
    slip_url = b.get("slip_url", "")
    slip_file = b.get("slip_file")
    if slip_file and isinstance(slip_file, dict) and slip_file.get("data"):
        raw_b64 = str(slip_file["data"])
        if "," in raw_b64:
            raw_b64 = raw_b64.split(",", 1)[1]
        mime_type = slip_file.get("mimeType") or "image/jpeg"
        fname = slip_file.get("filename") or f"slip_{house_id}.jpg"
        clean_ext = ".jpg"
        if "png" in mime_type.lower() or fname.lower().endswith(".png"):
            clean_ext = ".png"
        elif "webp" in mime_type.lower() or fname.lower().endswith(".webp"):
            clean_ext = ".webp"

        save_name = f"slip_{house_id}_{int(time.time())}{clean_ext}"
        local_slips_dir = os.path.join(ROOT, "static", "slips")
        os.makedirs(local_slips_dir, exist_ok=True)
        local_path = os.path.join(local_slips_dir, save_name)

        try:
            with open(local_path, "wb") as f_out:
                f_out.write(base64.b64decode(raw_b64))
            slip_url = f"/static/slips/{save_name}"
        except Exception as e:
            print("Local slip save error:", e)

        try:
            drive_res = sheet_post(
                action="upload_slip",
                folder_id=DRIVE_FOLDER_ID,
                data=raw_b64,
                filename=save_name,
                mimeType=mime_type
            )
            if drive_res and drive_res.get("ok"):
                slip_url = drive_res.get("direct_url") or drive_res.get("url") or slip_url
        except Exception as e:
            print("Drive slip upload error:", e)

    has_slip_flag = "Y" if (slip_url or b.get("has_slip") == "Y" or b.get("has_slip") is True) else "N"
    target_year = int(b.get("year_be") or b.get("fiscal_year") or get_active_fy(d))

    with store.write_lock:
        added = []

        # กรณี "ไม่มีสลิป" (เจ้าบ้านโอนเข้าแต่ยังไม่ส่งสลิป / ยังไม่ระบุบ้าน)
        if house_id == "NOSLIP":
            amount = num(b.get("amount") or b.get("amount_paid"), 0)
            if amount <= 0:
                return jsonify(error="กรุณาระบุจำนวนเงินที่ถูกต้อง"), 400

            row = {
                "payment_id": next_id("P", d.get("payments", []), "payment_id", 5),
                "due_id": "",
                "year_be": target_year,
                "amount_paid": amount,
                "paid_date": b["paid_date"],
                "channel": b["channel"],
                "has_slip": has_slip_flag,
                "slip_url": slip_url,
                "transfer_time": b.get("transfer_time", ""),
                "recorded_by": request.user["user_id"],
                "note": b.get("note") or "โอนเงินเข้าบัญชี (ไม่มีสลิปการโอน)"
            }
            sheet_post(action="append", table="payments", row=row)
            d.setdefault("payments", []).append(row)
            append_to_csv("payments", row)
            audit(request.user, "create", "payments", row["payment_id"], new=json.dumps(row, ensure_ascii=False))
            added.append(row["payment_id"])

        else:
            # กรณีระบุบ้าน: บันทึกเป็น "งวด" (Period 1 - 4)
            quarters = []
            if b.get("quarters"):
                quarters = sorted({int(q) for q in b.get("quarters")})
            elif b.get("periods"):
                quarters = sorted({int(q) for q in b.get("periods")})
            elif b.get("months"):
                quarters = sorted({((int(m) - 1) // 3) + 1 for m in b.get("months") if str(m).isdigit()})

            if not quarters:
                return jsonify(error="กรุณาเลือกงวดที่ต้องการชำระเงิน"), 400

            paid_dues = {p["due_id"] for p in d.get("payments", []) if p.get("due_id")}
            dues = {x["due_id"]: x for x in d.get("dues", []) if str(x.get("year_be")) == str(target_year)}

            for q in quarters:
                due_id = f"D{target_year}-{house_id}-P{q}"
                du = dues.get(due_id)
                if not du:
                    # fallback to month-based due if legacy
                    du = next((x for x in d.get("dues", []) if x.get("house_id") == house_id and int(x.get("period", 0)) == q), None)
                if not du:
                    return jsonify(error=f"ไม่พบข้อมูลงวดที่ {q}"), 400
                if du["due_id"] in paid_dues:
                    return jsonify(error=f"งวดที่ {q} มีประวัติชำระเงินแล้ว"), 409

            for q in quarters:
                due_id = f"D{target_year}-{house_id}-P{q}"
                du = dues.get(due_id)
                row = {
                    "payment_id": next_id("P", d.get("payments", []), "payment_id", 5),
                    "due_id": du["due_id"],
                    "year_be": target_year,
                    "amount_paid": du["amount_due"],
                    "paid_date": b["paid_date"],
                    "channel": b["channel"],
                    "has_slip": has_slip_flag,
                    "slip_url": slip_url,
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


@staff_bp.post("/api/staff/payments/<payment_id>/update")
@staff_bp.put("/api/staff/payments/<payment_id>")
@require()
def api_update_payment(payment_id):
    b = request.get_json(force=True)
    d = store.data
    payments = d.get("payments", [])
    p = next((x for x in payments if x.get("payment_id") == payment_id), None)
    if not p:
        return jsonify(error="ไม่พบรายการรับชำระเงิน"), 404

    with store.write_lock:
        old_data = dict(p)

        # Upload slip file if attached
        slip_url = b.get("slip_url", p.get("slip_url", ""))
        slip_file = b.get("slip_file")
        if slip_file and isinstance(slip_file, dict) and slip_file.get("data"):
            raw_b64 = str(slip_file["data"])
            if "," in raw_b64:
                raw_b64 = raw_b64.split(",", 1)[1]
            mime_type = slip_file.get("mimeType") or "image/jpeg"
            fname = slip_file.get("filename") or f"slip_{payment_id}.jpg"
            clean_ext = ".jpg"
            if "png" in mime_type.lower() or fname.lower().endswith(".png"):
                clean_ext = ".png"
            elif "webp" in mime_type.lower() or fname.lower().endswith(".webp"):
                clean_ext = ".webp"

            save_name = f"slip_{payment_id}_{int(time.time())}{clean_ext}"
            local_slips_dir = os.path.join(ROOT, "static", "slips")
            os.makedirs(local_slips_dir, exist_ok=True)
            local_path = os.path.join(local_slips_dir, save_name)

            try:
                with open(local_path, "wb") as f_out:
                    f_out.write(base64.b64decode(raw_b64))
                slip_url = f"/static/slips/{save_name}"
            except Exception as e:
                print("Local slip save error:", e)

            try:
                drive_res = sheet_post(
                    action="upload_slip",
                    folder_id=DRIVE_FOLDER_ID,
                    data=raw_b64,
                    filename=save_name,
                    mimeType=mime_type
                )
                if drive_res and drive_res.get("ok"):
                    slip_url = drive_res.get("direct_url") or drive_res.get("url") or slip_url
            except Exception as e:
                print("Drive slip upload error:", e)

        # Update house and period if reassigned
        new_house_id = b.get("house_id")
        new_period = b.get("period") or b.get("quarter")
        if new_house_id and new_house_id != "NOSLIP" and new_period:
            p["due_id"] = f"D{FY}-{new_house_id}-P{int(new_period)}"
        elif new_house_id == "NOSLIP":
            p["due_id"] = ""

        if "amount" in b or "amount_paid" in b:
            p["amount_paid"] = num(b.get("amount") or b.get("amount_paid"))
        if "paid_date" in b and b["paid_date"]:
            p["paid_date"] = b["paid_date"]
        if "channel" in b:
            p["channel"] = b["channel"]
        if "transfer_time" in b:
            p["transfer_time"] = b["transfer_time"]
        if "note" in b:
            p["note"] = b["note"]

        p["slip_url"] = slip_url
        p["has_slip"] = "Y" if (slip_url or b.get("has_slip") == "Y") else "N"

        patch = {
            "due_id": p.get("due_id") or None,
            "amount_paid": num(p.get("amount_paid")),
            "paid_date": p.get("paid_date"),
            "channel": p.get("channel", "transfer"),
            "has_slip": p.get("has_slip", "N"),
            "slip_url": p.get("slip_url", ""),
            "transfer_time": p.get("transfer_time", ""),
            "note": p.get("note", "")
        }
        try:
            sheet_post(action="update", table="payments", idCol="payment_id", id=payment_id, patch=patch)
        except Exception as err:
            print("Supabase update error:", err)

        audit(request.user, "update", "payments", payment_id, old=json.dumps(old_data, ensure_ascii=False), new=json.dumps(p, ensure_ascii=False))

        with store.cond:
            store.version += 1
            store.digest = json.dumps(d, sort_keys=True, ensure_ascii=False)
            store.cond.notify_all()

    threading.Thread(target=store.refresh, daemon=True).start()
    return jsonify(ok=True, payment=p)


@staff_bp.post("/api/staff/expenses")
@require()
def api_add_expense():
    b = request.get_json(force=True)
    d = store.data
    amount = num(b.get("amount"), -1)
    if amount <= 0 or not b.get("description") or not re.match(r"\d{4}-\d{2}-\d{2}$", b.get("expense_date", "")):
        return jsonify(error="กรุณากรอกข้อมูลให้ครบถ้วนและถูกต้อง"), 400

    target_year = int(b.get("year_be") or b.get("fiscal_year") or get_active_fy(d))

    with store.write_lock:
        nums = [int(m.group(1)) for e in d.get("expenses", []) if str(e.get("year_be", "")) == str(target_year) and (m := re.match(r"\s*(\d+)/", str(e.get("doc_no", ""))))]
        doc_no = f"{max(nums, default=0) + 1}/{target_year % 100}"
        row = {
            "expense_id": next_id("E", d.get("expenses", []), "expense_id", 4),
            "year_be": target_year,
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


@staff_bp.post("/api/staff/expenses/<expense_id>/update")
@staff_bp.put("/api/staff/expenses/<expense_id>")
@require()
def api_update_expense(expense_id):
    b = request.get_json(force=True)
    d = store.data
    expenses = d.get("expenses", [])
    e = next((x for x in expenses if x.get("expense_id") == expense_id), None)
    if not e:
        return jsonify(error="ไม่พบรายการรายจ่าย"), 404

    with store.write_lock:
        old_data = dict(e)
        if "description" in b and b["description"]:
            e["description"] = b["description"]
        if "amount" in b:
            e["amount"] = num(b["amount"])
        if "expense_date" in b and b["expense_date"]:
            e["expense_date"] = b["expense_date"]
        if "category_id" in b and b["category_id"]:
            e["category_id"] = b["category_id"]
        if "payee" in b:
            e["payee"] = b["payee"]
        if "source" in b and b["source"]:
            e["source"] = b["source"]
        if "doc_no" in b and b["doc_no"]:
            e["doc_no"] = b["doc_no"]
        if "status" in b and b["status"]:
            e["status"] = b["status"]

        patch = {
            "doc_no": e.get("doc_no", ""),
            "expense_date": e.get("expense_date"),
            "description": e.get("description", ""),
            "amount": num(e.get("amount")),
            "category_id": e.get("category_id", ""),
            "payee": e.get("payee", ""),
            "source": e.get("source", "bank"),
            "status": e.get("status", "จ่ายแล้ว")
        }
        try:
            sheet_post(action="update", table="expenses", idCol="expense_id", id=expense_id, patch=patch)
        except Exception as err:
            print("Supabase expense update error:", err)

        save_table_to_csv("expenses", expenses)
        audit(request.user, "update", "expenses", expense_id, old=json.dumps(old_data, ensure_ascii=False), new=json.dumps(e, ensure_ascii=False))

        with store.cond:
            store.version += 1
            store.digest = json.dumps(d, sort_keys=True, ensure_ascii=False)
            store.cond.notify_all()

    threading.Thread(target=store.refresh, daemon=True).start()
    return jsonify(ok=True, expense=e)


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

    target_year = int(b.get("year_be") or b.get("fiscal_year") or get_active_fy(d))

    with store.write_lock:
        row = {
            "income_id": next_id("I", d.get("other_income", []), "income_id", 3),
            "year_be": target_year,
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


@staff_bp.post("/api/staff/income/<income_id>/update")
@staff_bp.put("/api/staff/income/<income_id>")
@require()
def api_update_income(income_id):
    b = request.get_json(force=True)
    d = store.data
    incomes = d.get("other_income", [])
    i = next((x for x in incomes if x.get("income_id") == income_id), None)
    if not i:
        return jsonify(error="ไม่พบรายการรายได้"), 404

    with store.write_lock:
        old_data = dict(i)
        if "date" in b and b["date"]:
            i["date"] = b["date"]
        if "type" in b and b["type"]:
            i["type"] = b["type"]
        if "amount" in b:
            i["amount"] = num(b["amount"])
        if "channel" in b and b["channel"]:
            i["channel"] = b["channel"]
        if "note" in b:
            i["note"] = b["note"]

        patch = {
            "date": i.get("date"),
            "type": i.get("type", "other"),
            "amount": num(i.get("amount")),
            "channel": i.get("channel", "transfer"),
            "note": i.get("note", "")
        }
        try:
            sheet_post(action="update", table="other_income", idCol="income_id", id=income_id, patch=patch)
        except Exception as err:
            print("Supabase income update error:", err)

        save_table_to_csv("other_income", incomes)
        audit(request.user, "update", "other_income", income_id, old=json.dumps(old_data, ensure_ascii=False), new=json.dumps(i, ensure_ascii=False))

        with store.cond:
            store.version += 1
            store.digest = json.dumps(d, sort_keys=True, ensure_ascii=False)
            store.cond.notify_all()

    threading.Thread(target=store.refresh, daemon=True).start()
    return jsonify(ok=True, income=i)


@staff_bp.post("/api/staff/transfers")
@require()
def api_add_transfer():
    b = request.get_json(force=True)
    d = store.data
    amount = num(b.get("amount"), -1)
    if amount <= 0 or not re.match(r"\d{4}-\d{2}-\d{2}$", b.get("date", "")):
        return jsonify(error="กรุณากรอกวันที่และจำนวนเงินให้ถูกต้อง"), 400

    target_year = int(b.get("year_be") or b.get("fiscal_year") or get_active_fy(d))

    with store.write_lock:
        row = {
            "rt_id": next_id("RT", d.get("reserve_transactions", []), "rt_id", 4),
            "year_be": target_year,
            "date": b["date"],
            "type": "in",
            "amount": amount,
            "expense_id": "",
            "note": b.get("note") or "เบิกเงินจากบัญชีธนาคารมาเติมเงินสดสำรองจ่าย"
        }
        sheet_post(action="append", table="reserve_transactions", row=row)
        d.setdefault("reserve_transactions", []).append(row)
        append_to_csv("reserve_transactions", row)
        audit(request.user, "create", "reserve_transactions", row["rt_id"], new=json.dumps(row, ensure_ascii=False))

        with store.cond:
            store.version += 1
            store.digest = json.dumps(d, sort_keys=True, ensure_ascii=False)
            store.cond.notify_all()

    threading.Thread(target=store.refresh, daemon=True).start()
    return jsonify(ok=True, transfer=row)


@staff_bp.post("/api/staff/transfers/<rt_id>/update")
@staff_bp.put("/api/staff/transfers/<rt_id>")
@require()
def api_update_transfer(rt_id):
    b = request.get_json(force=True)
    d = store.data
    reserves = d.get("reserve_transactions", [])
    t = next((x for x in reserves if x.get("rt_id") == rt_id), None)
    if not t:
        return jsonify(error="ไม่พบรายการถอนเงินสด"), 404

    with store.write_lock:
        old_data = dict(t)
        if "date" in b and b["date"]:
            t["date"] = b["date"]
        if "amount" in b:
            t["amount"] = num(b["amount"])
        if "note" in b:
            t["note"] = b["note"]

        patch = {
            "date": t.get("date"),
            "amount": num(t.get("amount")),
            "note": t.get("note", "")
        }
        try:
            sheet_post(action="update", table="reserve_transactions", idCol="rt_id", id=rt_id, patch=patch)
        except Exception as err:
            print("Supabase transfer update error:", err)

        save_table_to_csv("reserve_transactions", reserves)
        audit(request.user, "update", "reserve_transactions", rt_id, old=json.dumps(old_data, ensure_ascii=False), new=json.dumps(t, ensure_ascii=False))

        with store.cond:
            store.version += 1
            store.digest = json.dumps(d, sort_keys=True, ensure_ascii=False)
            store.cond.notify_all()

    threading.Thread(target=store.refresh, daemon=True).start()
    return jsonify(ok=True, transfer=t)


@staff_bp.get("/api/staff/years")
@require()
def api_staff_get_years():
    d = store.data
    years = get_fiscal_years_list(d)
    active_year = get_active_fy(d)
    return jsonify(ok=True, years=years, active_year=active_year)


@staff_bp.get("/api/staff/years/rollover-preview")
@require()
def api_staff_rollover_preview():
    d = store.data
    active_fy = get_active_fy(d)
    from_year = request.args.get("from_year", type=int) or active_fy
    
    # Calculate closing numbers from previous year
    sum_data = summary(target_fy=from_year)
    bal = sum_data.get("balance", {})
    closing_tot = bal.get("total", bal.get("closing", 0.0))
    closing_bank = bal.get("bank", 0.0)
    closing_res = bal.get("reserve", 0.0)

    houses = [h for h in d.get("houses", []) if h.get("house_id") != "NOSLIP" and h.get("house_no") != "ไม่มีสลิป"]
    suggested_year = from_year + 1

    return jsonify(
        ok=True,
        from_year=from_year,
        suggested_year=suggested_year,
        opening_balance=closing_tot,
        opening_bank=closing_bank,
        opening_reserve=closing_res,
        houses_count=len(houses),
        expected_dues=len(houses) * 4
    )


@staff_bp.post("/api/staff/years")
@require()
def api_staff_create_year():
    b = request.get_json(force=True)
    d = store.data
    try:
        new_year = int(b.get("year_be"))
    except Exception:
        return jsonify(error="กรุณาระบุปีงบประมาณ พ.ศ. ให้ถูกต้อง เช่น 2570"), 400

    existing_years = {int(y["year_be"]) for y in d.get("fiscal_years", []) if str(y.get("year_be", "")).isdigit()}
    if new_year in existing_years:
        return jsonify(error=f"ปีงบประมาณ พ.ศ. {new_year} มีอยู่ในระบบแล้ว"), 400

    from_year = int(b.get("from_year") or (new_year - 1))
    title = b.get("title") or f"ปีงบประมาณ {new_year}"
    opening_balance = num(b.get("opening_balance"), 0.0)
    opening_reserve = num(b.get("opening_reserve"), 0.0)
    set_active = bool(b.get("set_active", False))

    from datetime import datetime, timezone

    with store.write_lock:
        # 1. Update existing fiscal_years active flags if set_active is True
        fys = d.get("fiscal_years", [])
        if set_active:
            for y in fys:
                y["is_active"] = "False"
                sheet_post(action="update", table="fiscal_years", idCol="year_be", id=y.get("year_be"), patch={"is_active": False})

        # 2. Insert new fiscal_year
        fy_row = {
            "year_be": new_year,
            "title": title,
            "opening_balance": opening_balance,
            "opening_reserve": opening_reserve,
            "closing_balance": "",
            "closing_reserve": "",
            "start_date": f"{new_year - 543}-01-01",
            "end_date": f"{new_year - 543}-12-31",
            "is_active": "True" if set_active else "False",
            "is_closed": "False",
            "created_at": datetime.now(timezone.utc).isoformat()
        }
        sheet_post(action="append", table="fiscal_years", row=fy_row)
        fys.append(fy_row)
        save_table_to_csv("fiscal_years", fys)

        # 3. Create fee_rates for new_year (copy from from_year or defaults)
        prev_rates = [r for r in d.get("fee_rates", []) if str(r.get("year_be")) == str(from_year)]
        if not prev_rates:
            prev_rates = [r for r in d.get("fee_rates", []) if str(r.get("year_be")) == "2569"]
        
        rate_by_zone = {}
        new_rates = []
        for r in prev_rates:
            zid = r.get("zone_id")
            m_amt = num(r.get("monthly_amount"), 300.0)
            rate_by_zone[zid] = m_amt
            new_r = {
                "rate_id": f"RZ{zid[-2:]}_{new_year}",
                "zone_id": zid,
                "year_be": new_year,
                "monthly_amount": m_amt
            }
            new_rates.append(new_r)
        
        if new_rates:
            sheet_insert_many("fee_rates", new_rates)
            d.setdefault("fee_rates", []).extend(new_rates)
            save_table_to_csv("fee_rates", d["fee_rates"])

        # 4. Generate dues for all houses (4 periods per year)
        houses = [h for h in d.get("houses", []) if h.get("house_id") != "NOSLIP" and h.get("house_no") != "ไม่มีสลิป"]
        new_dues = []
        for h in houses:
            hid = h.get("house_id")
            zid = h.get("zone_id", "Z01")
            m_rate = rate_by_zone.get(zid, 100.0 if zid == "Z11" else 300.0)
            q_rate = round(m_rate * 3, 2)
            for p in range(1, 5):
                due_id = f"D{new_year}-{hid}-P{p}"
                new_dues.append({
                    "due_id": due_id,
                    "house_id": hid,
                    "year_be": new_year,
                    "month": p,
                    "period": p,
                    "amount_due": q_rate
                })

        if new_dues:
            sheet_insert_many("dues", new_dues)
            d.setdefault("dues", []).extend(new_dues)
            save_table_to_csv("dues", d["dues"])

        # 5. Create initial opening reserve transaction if reserve > 0
        if opening_reserve > 0:
            rt_row = {
                "rt_id": next_id("RT", d.get("reserve_transactions", []), "rt_id", 4),
                "year_be": new_year,
                "date": f"{new_year - 543}-01-01",
                "type": "in",
                "amount": opening_reserve,
                "expense_id": "",
                "note": f"ยอดยกมาจากปี {from_year}"
            }
            sheet_post(action="append", table="reserve_transactions", row=rt_row)
            d.setdefault("reserve_transactions", []).append(rt_row)
            append_to_csv("reserve_transactions", rt_row)

        audit(request.user, "create", "fiscal_years", str(new_year), new=json.dumps(fy_row, ensure_ascii=False))

        with store.cond:
            store.version += 1
            store.digest = json.dumps(d, sort_keys=True, ensure_ascii=False)
            store.cond.notify_all()

    threading.Thread(target=store.refresh, daemon=True).start()
    return jsonify(ok=True, message=f"สร้างปีงบประมาณ {new_year} เรียบร้อยแล้ว (สร้างงวดชำระ {len(new_dues)} รายการ)", fiscal_year=fy_row)


@staff_bp.post("/api/staff/years/set-active")
@require()
def api_staff_set_active_year():
    b = request.get_json(force=True)
    d = store.data
    try:
        target_year = int(b.get("year_be"))
    except Exception:
        return jsonify(error="กรุณาระบุปีงบประมาณที่ถูกต้อง"), 400

    fys = d.get("fiscal_years", [])
    found = False
    with store.write_lock:
        for y in fys:
            is_match = (str(y.get("year_be")) == str(target_year))
            if is_match:
                found = True
            val_str = "True" if is_match else "False"
            val_bool = is_match
            y["is_active"] = val_str
            sheet_post(action="update", table="fiscal_years", idCol="year_be", id=y.get("year_be"), patch={"is_active": val_bool})

        if not found:
            return jsonify(error=f"ไม่พบปีงบประมาณ {target_year}"), 404

        save_table_to_csv("fiscal_years", fys)
        audit(request.user, "update", "fiscal_years", str(target_year), note=f"Set active fiscal year to {target_year}")

        with store.cond:
            store.version += 1
            store.digest = json.dumps(d, sort_keys=True, ensure_ascii=False)
            store.cond.notify_all()

    threading.Thread(target=store.refresh, daemon=True).start()
    return jsonify(ok=True, active_year=target_year)
