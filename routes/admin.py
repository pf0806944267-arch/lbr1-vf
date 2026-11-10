import csv
import json
import os
import threading

from flask import Blueprint, jsonify, request
from werkzeug.security import generate_password_hash

from config import ROOT
from core.auth import audit, next_id, require
from core.sheets_api import sheet_post
from services.store import append_to_csv, store

admin_bp = Blueprint("admin", __name__)


@admin_bp.delete("/api/admin/<table>/<rid>")
@require()
def api_admin_delete(table, rid):
    keys = {
        "payments": "payment_id",
        "expenses": "expense_id",
        "other_income": "income_id",
        "reserve_transactions": "rt_id",
    }
    if table not in keys:
        return jsonify(error="ไม่รองรับตารางนี้"), 400
    with store.write_lock:
        rows = store.data.get(table, [])
        old = next((r for r in rows if r.get(keys[table]) == rid), None)
        if not old:
            return jsonify(error="ไม่พบรายการ"), 404
        sheet_err = None
        try:
            sheet_post(action="delete", table=table, idCol=keys[table], id=rid)
        except Exception as e:
            sheet_err = str(e)
            # ถ้าไม่มีในชีต ถือว่าลบสำเร็จ ถ้ามีข้อผิดพลาดเครือข่าย ให้บันทึกเตือนแต่ยอมให้ลบในระบบได้
            if "not found" not in str(e):
                print(f"sheet delete warning {table}/{rid}: {e}")
        rows.remove(old)
        audit(request.user, "delete", table, rid, old=json.dumps(old, ensure_ascii=False))

        with store.cond:
            store.version += 1
            store.digest = json.dumps(store.data, sort_keys=True, ensure_ascii=False)
            store.cond.notify_all()

    threading.Thread(target=store.refresh, daemon=True).start()
    return jsonify(ok=True)


@admin_bp.get("/api/admin/users")
@require("admin")
def api_admin_users():
    return jsonify([{k: u.get(k) for k in ("user_id", "username", "role", "active")} for u in store.data.get("users", [])])


@admin_bp.post("/api/admin/users")
@require("admin")
def api_admin_add_user():
    b = request.get_json(force=True)
    if b.get("role") not in ("staff", "admin") or len(b.get("password", "")) < 8 or not b.get("username"):
        return jsonify(error="ข้อมูลไม่ถูกต้อง (รหัสผ่านต้องอย่างน้อย 8 ตัวอักษร)"), 400
    with store.write_lock:
        users = store.data.get("users", [])
        if any(u.get("username") == b["username"] for u in users):
            return jsonify(error="ชื่อผู้ใช้นี้มีในระบบแล้ว"), 409
        row = {
            "user_id": next_id("U", users, "user_id", 3),
            "username": b["username"],
            "password_hash": generate_password_hash(b["password"]),
            "role": b["role"],
            "active": "Y"
        }
        sheet_post(action="append", table="users", row=row)
        users.append(row)
        append_to_csv("users", row)
        audit(request.user, "create", "users", row["user_id"], new=b["username"])

        with store.cond:
            store.version += 1
            store.digest = json.dumps(store.data, sort_keys=True, ensure_ascii=False)
            store.cond.notify_all()

    threading.Thread(target=store.refresh, daemon=True).start()
    return jsonify(ok=True)
