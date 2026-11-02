from functools import wraps
import json
import os
import re

from flask import jsonify, request
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer
from werkzeug.security import generate_password_hash

from config import SECRET, now_th
from core.sheets_api import sheet_post
from services.store import append_to_csv, store

serializer = URLSafeTimedSerializer(SECRET)


def make_token(user):
    return serializer.dumps({"u": user["user_id"], "n": user["username"], "r": user["role"]})


def current_user():
    tok = request.headers.get("Authorization", "").replace("Bearer ", "")
    if not tok:
        return None
    try:
        data = serializer.loads(tok, max_age=60 * 60 * 24)
    except (BadSignature, SignatureExpired):
        return None
    u = next((x for x in store.data.get("users", []) if x.get("user_id") == data["u"] and x.get("active") == "Y"), None)
    return u


def require(role=None):
    def deco(fn):
        @wraps(fn)
        def wrapper(*a, **kw):
            u = current_user()
            if not u:
                return jsonify(error="กรุณาเข้าสู่ระบบ"), 401
            if role == "admin" and u["role"] != "admin":
                return jsonify(error="ต้องเป็นผู้ดูแลระบบ"), 403
            request.user = u
            return fn(*a, **kw)
        return wrapper
    return deco


def next_id(prefix, rows, key, width):
    mx = 0
    for r in rows:
        m = re.match(rf"{prefix}(\d+)$", str(r.get(key, "")))
        if m:
            mx = max(mx, int(m.group(1)))
    return f"{prefix}{mx + 1:0{width}d}"


def audit(user, action, table, rid, old="", new=""):
    row = {
        "log_id": next_id("L", store.data.get("audit_log", []), "log_id", 5),
        "user_id": user["user_id"] if isinstance(user, dict) else str(user),
        "action": action,
        "table": table,
        "record_id": rid,
        "old_value": str(old or ""),
        "new_value": str(new or ""),
        "timestamp": now_th().strftime("%Y-%m-%d %H:%M:%S")
    }
    try:
        sheet_post(action="append", table="audit_log", row=row)
    except Exception as e:
        print(f"audit sheet error: {e}")
    store.data.setdefault("audit_log", []).append(row)
    append_to_csv("audit_log", row)


def bootstrap_admin():
    try:
        users = store.data.get("users", [])
        admin_user = os.environ.get("ADMIN_USERNAME", "admin")
        if not admin_user or any(x.get("username") == admin_user for x in users):
            return
        row = {
            "user_id": next_id("U", users, "user_id", 3),
            "username": admin_user,
            "password_hash": generate_password_hash(os.environ.get("ADMIN_PASSWORD", "11111111")),
            "role": "admin",
            "active": "Y"
        }
        sheet_post(action="append", table="users", row=row)
        store.data.setdefault("users", []).append(row)
        append_to_csv("users", row)
    except Exception as e:
        print("bootstrap_admin skipped/error:", e)
