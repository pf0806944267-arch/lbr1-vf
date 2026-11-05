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
from core.sheets_api import sheet_post
from services.calculations import houses_view, summary
from services.store import append_to_csv, store

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
        if du and du.get("year_be") and str(du.get("year_be")) != str(FY):
            continue
        h_id = du.get("house_id", "") if du else (p.get("house_id") or "NOSLIP")
        h_no = houses.get(h_id, "ไม่มีสลิป" if h_id == "NOSLIP" else "")
        q = du.get("period", "") if du else (p.get("period") or "")
        pays.append({
            "payment_id": p.get("payment_id"),
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
        if du and du.get("year_be") and str(du.get("year_be")) != str(FY):
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

    summary_data = summary()
    bal = summary_data.get("balance", {})

    return jsonify(
        fiscal_year=FY,
        balance=bal,
        opening_balance=bal.get("opening", 82969.73),
        opening_bank=round(bal.get("opening", 82969.73) - bal.get("opening_reserve", 10049.57), 2),
        opening_reserve=bal.get("opening_reserve", 10049.57),
        payments=pays,
        expenses=exps,
        incomes=incs,
        reserve=d.get("reserve_transactions", []),
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
                "year_be": FY,
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
            dues = {x["due_id"]: x for x in d.get("dues", []) if str(x.get("year_be")) == str(FY)}

            for q in quarters:
                due_id = f"D{FY}-{house_id}-P{q}"
                du = dues.get(due_id)
                if not du:
                    # fallback to month-based due if legacy
                    du = next((x for x in d.get("dues", []) if x.get("house_id") == house_id and int(x.get("period", 0)) == q), None)
                if not du:
                    return jsonify(error=f"ไม่พบข้อมูลงวดที่ {q}"), 400
                if du["due_id"] in paid_dues:
                    return jsonify(error=f"งวดที่ {q} มีประวัติชำระเงินแล้ว"), 409

            for q in quarters:
                due_id = f"D{FY}-{house_id}-P{q}"
                du = dues.get(due_id)
                row = {
                    "payment_id": next_id("P", d.get("payments", []), "payment_id", 5),
                    "due_id": du["due_id"],
                    "year_be": FY,
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

        # Rewrite local CSV
        import csv
        p_csv = os.path.join(ROOT, "data", "payments.csv")
        try:
            header = list(payments[0].keys())
            with open(p_csv, "w", encoding="utf-8-sig", newline="") as f:
                w = csv.writer(f)
                w.writerow(header)
                for row in payments:
                    w.writerow([row.get(h, "") for h in header])
        except Exception as e:
            print("CSV write error:", e)

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

    with store.write_lock:
        nums = [int(m.group(1)) for e in d.get("expenses", []) if (m := re.match(r"\s*(\d+)/", str(e.get("doc_no", ""))))]
        doc_no = f"{max(nums, default=0) + 1}/{FY % 100}"
        row = {
            "expense_id": next_id("E", d.get("expenses", []), "expense_id", 4),
            "year_be": FY,
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
            "year_be": FY,
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


@staff_bp.post("/api/staff/transfers")
@require()
def api_add_transfer():
    b = request.get_json(force=True)
    d = store.data
    amount = num(b.get("amount"), -1)
    if amount <= 0 or not re.match(r"\d{4}-\d{2}-\d{2}$", b.get("date", "")):
        return jsonify(error="กรุณากรอกวันที่และจำนวนเงินให้ถูกต้อง"), 400

    with store.write_lock:
        row = {
            "rt_id": next_id("RT", d.get("reserve_transactions", []), "rt_id", 4),
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
