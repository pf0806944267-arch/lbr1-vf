"""ระบบกองทุนหมู่บ้าน: Flask server (Render) -> Apps Script API -> Google Sheet
- สมาชิกดู dashboard ได้โดยไม่ต้องล็อกอิน (realtime ผ่าน SSE)
- เจ้าหน้าที่/ผู้ดูแลล็อกอินเพื่อบันทึกการชำระเงินและค่าใช้จ่าย
"""
import datetime as dt
import json
import os
import re
import threading
import time
import urllib.parse
import urllib.request
from functools import wraps

from flask import Flask, Response, jsonify, request, send_from_directory
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer
from werkzeug.security import check_password_hash, generate_password_hash

ROOT = os.path.dirname(os.path.abspath(__file__))


def load_env():
    p = os.path.join(ROOT, ".env")
    if os.path.exists(p):
        for line in open(p, encoding="utf-8"):
            if "=" in line and not line.strip().startswith("#"):
                k, v = line.strip().split("=", 1)
                os.environ.setdefault(k, v)


load_env()
SCRIPT_URL = os.environ["APPS_SCRIPT_URL"]
API_KEY = os.environ["API_KEY"]
SECRET = os.environ.get("SESSION_SECRET") or API_KEY + "-session"
FY = int(os.environ.get("FISCAL_YEAR", "2569"))
REFRESH_SECONDS = int(os.environ.get("REFRESH_SECONDS", "15"))
TABLES = ["fiscal_years", "zones", "fee_rates", "houses", "members", "house_members", "dues", "payments",
          "expense_categories", "expenses", "reserve_transactions", "other_income", "users", "audit_log"]
MONTH_TH = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."]

app = Flask(__name__, static_folder=None)
serializer = URLSafeTimedSerializer(SECRET)


# ---------------------------------------------------------------- Apps Script client
def _call(req):
    return json.loads(urllib.request.urlopen(req, timeout=60).read().decode("utf-8"))


def sheet_get(table):
    q = urllib.parse.urlencode({"key": API_KEY, "table": table})
    r = _call(urllib.request.Request(SCRIPT_URL + "?" + q))
    if not r.get("ok"):
        raise RuntimeError(f"{table}: {r.get('error')}")
    return r["rows"]


def sheet_get_many(tables):
    """อ่านหลายตารางในคำขอเดียว (ถ้า Apps Script เวอร์ชันเก่ายังไม่รองรับ จะอ่านทีละตาราง)"""
    q = urllib.parse.urlencode({"key": API_KEY, "tables": ",".join(tables)})
    r = _call(urllib.request.Request(SCRIPT_URL + "?" + q))
    if r.get("ok") and "data" in r:
        return r["data"]
    return {t: sheet_get(t) for t in tables}


def sheet_post(**payload):
    payload["key"] = API_KEY
    r = _call(urllib.request.Request(SCRIPT_URL, data=json.dumps(payload).encode("utf-8"),
                                     headers={"Content-Type": "text/plain;charset=utf-8"}))
    if not r.get("ok"):
        raise RuntimeError(r.get("error"))
    return r


def num(v, default=0.0):
    try:
        return float(str(v).replace(",", ""))
    except (TypeError, ValueError):
        return default


# ---------------------------------------------------------------- cache + realtime
class Store:
    def __init__(self):
        self.data = {t: [] for t in TABLES}
        self.version = 0
        self.digest = None
        self.cond = threading.Condition()
        self.write_lock = threading.Lock()
        self.error = None

    def refresh(self):
        try:
            new = sheet_get_many(TABLES)
            self.error = None
        except Exception as e:  # noqa: BLE001
            self.error = str(e)
            return
        digest = json.dumps(new, sort_keys=True, ensure_ascii=False)
        with self.cond:
            self.data = new
            if digest != self.digest:
                self.digest = digest
                self.version += 1
                self.cond.notify_all()

    def loop(self):
        while True:
            self.refresh()
            time.sleep(REFRESH_SECONDS)


store = Store()


def start_background():
    store.refresh()
    bootstrap_admin()
    threading.Thread(target=store.loop, daemon=True).start()


# ---------------------------------------------------------------- summaries
def mask_name(full):
    parts = re.sub(r"^\s*คุณ\s*", "", full or "").split()
    if len(parts) <= 1:
        return parts[0] if parts else "-"
    return " ".join(parts[:-1]) + " " + parts[-1][0] + "."


def now_th():
    return dt.datetime.utcnow() + dt.timedelta(hours=7)


def current_month():
    n = now_th()
    ce_fy = FY - 543
    if n.year > ce_fy:
        return 12
    if n.year < ce_fy:
        return 0
    return n.month


def build_model():
    d = store.data
    zones = {z["zone_id"]: z for z in d["zones"]}
    houses = {h["house_id"]: h for h in d["houses"]}
    dues = [x for x in d["dues"] if str(x["year_be"]) == str(FY)]
    paid_by_due = {}
    for p in d["payments"]:
        paid_by_due[p["due_id"]] = p
    owners = {}
    members = {m["member_id"]: m["full_name"] for m in d["members"]}
    for hm in d["house_members"]:
        owners.setdefault(hm["house_id"], []).append(members.get(hm["member_id"], ""))
    return zones, houses, dues, paid_by_due, owners


def summary():
    d = store.data
    zones, houses, dues, paid_by_due, owners = build_model()
    fy = next((x for x in d["fiscal_years"] if str(x["year_be"]) == str(FY)), {})
    opening = num(fy.get("opening_balance"))
    opening_reserve = num(fy.get("opening_reserve"))

    paid_amount = {dd["due_id"]: num(paid_by_due[dd["due_id"]]["amount_paid"]) for dd in dues if dd["due_id"] in paid_by_due}
    received = sum(paid_amount.values())
    other_income = sum(num(x["amount"]) for x in d["other_income"])
    exp_total = sum(num(e["amount"]) for e in d["expenses"])
    reserve_in = sum(num(r["amount"]) for r in d["reserve_transactions"] if r["type"] == "in")
    reserve_out = sum(num(r["amount"]) for r in d["reserve_transactions"] if r["type"] == "out")
    reserve_bal = reserve_in - reserve_out
    total = opening + received + other_income - exp_total

    periods = [0.0] * 4
    monthly = [0.0] * 12
    z_stat = {zid: {"zone": z["name"], "houses": 0, "periods": [{"paid": 0, "unpaid": 0} for _ in range(4)],
                    "collected": 0.0, "due_to_date": 0.0} for zid, z in zones.items()}
    house_months = {}
    cm = current_month()
    for dd in dues:
        m = int(dd["month"])
        pr = int(dd["period"])
        hid = dd["house_id"]
        paid = dd["due_id"] in paid_by_due
        house_months.setdefault(hid, {})[m] = paid
        if paid:
            a = paid_amount[dd["due_id"]]
            periods[pr - 1] += a
            monthly[m - 1] += a
            z_stat[houses[hid]["zone_id"]]["collected"] += a
        if m <= cm:
            z_stat[houses[hid]["zone_id"]]["due_to_date"] += num(dd["amount_due"])
    for hid, h in houses.items():
        zs = z_stat[h["zone_id"]]
        zs["houses"] += 1
        for pr in range(4):
            months = [pr * 3 + i for i in (1, 2, 3)]
            ok = all(house_months.get(hid, {}).get(m) for m in months)
            zs["periods"][pr]["paid" if ok else "unpaid"] += 1
    for z in z_stat.values():
        for p in z["periods"]:
            t = p["paid"] + p["unpaid"]
            p["pct"] = round(100 * p["paid"] / t, 1) if t else 0
    zlist = sorted(z_stat.values(), key=lambda z: (z["zone"] == "สายหลัก", int(z["zone"].split()[1]) if z["zone"] != "สายหลัก" else 0))

    cats = {c["category_id"]: c["name"] for c in d["expense_categories"]}
    by_cat, by_month = {}, [0.0] * 12
    for e in d["expenses"]:
        by_cat[cats.get(e["category_id"], "อื่นๆ")] = by_cat.get(cats.get(e["category_id"], "อื่นๆ"), 0) + num(e["amount"])
        try:
            by_month[int(e["expense_date"][5:7]) - 1] += num(e["amount"])
        except (ValueError, IndexError):
            pass
    recent = sorted(d["expenses"], key=lambda e: (e["expense_date"], e["expense_id"]), reverse=True)[:10]
    full_due = sum(num(x["amount_due"]) for x in dues)
    return {
        "fiscal_year": FY,
        "as_of": now_th().strftime("%Y-%m-%d %H:%M:%S"),
        "current_month": cm,
        "balance": {"opening": opening, "received": received, "other_income": other_income, "expenses": exp_total,
                    "total": round(total, 2), "reserve": round(reserve_bal, 2),
                    "bank": round(total - reserve_bal, 2), "opening_reserve": opening_reserve},
        "periods": [round(x, 2) for x in periods],
        "monthly": [round(x, 2) for x in monthly],
        "zones": zlist,
        "houses_total": len(houses),
        "year_collected_pct": round(100 * received / full_due, 1) if full_due else 0,
        "expenses_by_category": [{"name": k, "amount": round(v, 2)} for k, v in sorted(by_cat.items(), key=lambda x: -x[1])],
        "expenses_by_month": [round(x, 2) for x in by_month],
        "recent_expenses": [{"date": e["expense_date"], "description": e["description"], "amount": num(e["amount"]),
                             "category": cats.get(e["category_id"], "อื่นๆ")} for e in recent],
        "version": store.version,
    }


def houses_view(full=False):
    zones, houses, dues, paid_by_due, owners = build_model()
    hm = {}
    for dd in dues:
        hm.setdefault(dd["house_id"], {})[int(dd["month"])] = dd["due_id"] in paid_by_due
    cm = current_month()
    out = []
    for hid, h in houses.items():
        months = [bool(hm.get(hid, {}).get(m)) for m in range(1, 13)]
        item = {"house_id": hid, "house_no": h["house_no"], "zone": zones[h["zone_id"]]["name"], "months": months,
                "paid_count": sum(months), "overdue": sum(1 for m in range(cm) if not months[m])}
        names = owners.get(hid, [])
        item["name"] = " / ".join(names) if full else " / ".join(mask_name(n) for n in names)
        out.append(item)
    out.sort(key=lambda x: (x["zone"] == "สายหลัก", int(x["zone"].split()[1]) if x["zone"] != "สายหลัก" else 0, x["house_no"]))
    return out


# ---------------------------------------------------------------- auth
def make_token(user):
    return serializer.dumps({"u": user["user_id"], "n": user["username"], "r": user["role"]})


def current_user():
    tok = request.headers.get("Authorization", "").replace("Bearer ", "")
    if not tok:
        return None
    try:
        data = serializer.loads(tok, max_age=60 * 60 * 12)
    except (BadSignature, SignatureExpired):
        return None
    u = next((x for x in store.data["users"] if x["user_id"] == data["u"] and x["active"] == "Y"), None)
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
    row = {"log_id": next_id("L", store.data["audit_log"], "log_id", 5), "user_id": user["user_id"], "action": action,
           "table": table, "record_id": rid, "old_value": old, "new_value": new,
           "timestamp": now_th().strftime("%Y-%m-%d %H:%M:%S")}
    sheet_post(action="append", table="audit_log", row=row)
    store.data["audit_log"].append(row)


def bootstrap_admin():
    if store.data["users"] or not os.environ.get("ADMIN_USERNAME"):
        return
    row = {"user_id": "U001", "username": os.environ["ADMIN_USERNAME"],
           "password_hash": generate_password_hash(os.environ["ADMIN_PASSWORD"]), "role": "admin", "active": "Y"}
    sheet_post(action="append", table="users", row=row)
    store.data["users"].append(row)
    print("created first admin:", row["username"])


# ---------------------------------------------------------------- routes: public
@app.get("/")
def index():
    return send_from_directory(os.path.join(ROOT, "static"), "index.html")


@app.get("/staff")
def staff_page():
    return send_from_directory(os.path.join(ROOT, "static"), "staff.html")


@app.get("/static/<path:p>")
def static_files(p):
    return send_from_directory(os.path.join(ROOT, "static"), p)


@app.get("/healthz")
def health():
    return jsonify(ok=store.error is None, error=store.error, version=store.version)


@app.get("/api/dashboard")
def api_dashboard():
    return jsonify(summary())


@app.get("/api/houses")
def api_houses():
    return jsonify(houses_view())


@app.get("/api/stream")
def api_stream():
    def gen():
        last = -1
        yield "retry: 5000\n\n"
        while True:
            with store.cond:
                if store.version == last:
                    store.cond.wait(timeout=25)
                v = store.version
            if v != last:
                last = v
                yield f"event: update\ndata: {v}\n\n"
            else:
                yield ": keep-alive\n\n"
    return Response(gen(), mimetype="text/event-stream",
                    headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


# ---------------------------------------------------------------- routes: staff
@app.post("/api/login")
def api_login():
    b = request.get_json(force=True)
    u = next((x for x in store.data["users"] if x["username"] == b.get("username") and x["active"] == "Y"), None)
    if not u or not check_password_hash(u["password_hash"], b.get("password", "")):
        return jsonify(error="ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง"), 401
    return jsonify(token=make_token(u), username=u["username"], role=u["role"])


@app.get("/api/staff/houses")
@require()
def api_staff_houses():
    return jsonify(houses_view(full=True))


@app.get("/api/staff/categories")
@require()
def api_staff_categories():
    return jsonify(store.data["expense_categories"])


@app.get("/api/staff/recent")
@require()
def api_staff_recent():
    d = store.data
    dues = {x["due_id"]: x for x in d["dues"]}
    houses = {h["house_id"]: h["house_no"] for h in d["houses"]}
    pays = []
    for p in sorted(d["payments"], key=lambda p: p["payment_id"], reverse=True)[:20]:
        du = dues.get(p["due_id"], {})
        pays.append({"payment_id": p["payment_id"], "house_no": houses.get(du.get("house_id"), ""),
                     "month": du.get("month"), "amount": num(p["amount_paid"]), "paid_date": p["paid_date"],
                     "channel": p["channel"], "recorded_by": p["recorded_by"]})
    exps = sorted(d["expenses"], key=lambda e: e["expense_id"], reverse=True)[:20]
    return jsonify(payments=pays, expenses=exps)


@app.post("/api/staff/payments")
@require()
def api_add_payment():
    b = request.get_json(force=True)
    d = store.data
    months = sorted({int(m) for m in b.get("months", [])})
    if not b.get("house_id") or not months:
        return jsonify(error="ต้องเลือกบ้านและเดือน"), 400
    if not re.match(r"\d{4}-\d{2}-\d{2}$", b.get("paid_date", "")):
        return jsonify(error="วันที่ไม่ถูกต้อง"), 400
    if b.get("channel") not in ("transfer", "cash"):
        return jsonify(error="ช่องทางชำระไม่ถูกต้อง"), 400
    with store.write_lock:
        paid_dues = {p["due_id"] for p in d["payments"]}
        dues = {(x["house_id"], int(x["month"])): x for x in d["dues"] if str(x["year_be"]) == str(FY)}
        added = []
        for m in months:
            du = dues.get((b["house_id"], m))
            if not du:
                return jsonify(error=f"ไม่พบรายการเดือน {m}"), 400
            if du["due_id"] in paid_dues:
                return jsonify(error=f"เดือน {MONTH_TH[m - 1]} ชำระแล้ว"), 409
        for m in months:
            du = dues[(b["house_id"], m)]
            row = {"payment_id": next_id("P", d["payments"], "payment_id", 5), "due_id": du["due_id"],
                   "amount_paid": du["amount_due"], "paid_date": b["paid_date"], "channel": b["channel"],
                   "has_slip": "Y" if b.get("has_slip") else "N", "transfer_time": b.get("transfer_time", ""),
                   "recorded_by": request.user["user_id"], "note": b.get("note", "")}
            sheet_post(action="append", table="payments", row=row)
            d["payments"].append(row)
            audit(request.user, "create", "payments", row["payment_id"], new=json.dumps(row, ensure_ascii=False))
            added.append(row["payment_id"])
    store.refresh()
    return jsonify(ok=True, added=added)


@app.post("/api/staff/expenses")
@require()
def api_add_expense():
    b = request.get_json(force=True)
    d = store.data
    amount = num(b.get("amount"), -1)
    if amount <= 0 or not b.get("description") or not re.match(r"\d{4}-\d{2}-\d{2}$", b.get("expense_date", "")):
        return jsonify(error="กรอกข้อมูลไม่ครบหรือไม่ถูกต้อง"), 400
    with store.write_lock:
        nums = [int(m.group(1)) for e in d["expenses"] if (m := re.match(r"\s*(\d+)/", str(e["doc_no"])))]
        row = {"expense_id": next_id("E", d["expenses"], "expense_id", 4),
               "doc_no": f"{max(nums, default=0) + 1}/{FY % 100}", "expense_date": b["expense_date"],
               "description": b["description"], "amount": amount, "category_id": b.get("category_id", "C99"),
               "payee": b.get("payee", ""), "status": "จ่ายแล้ว", "source": b.get("source", "bank"),
               "recorded_by": request.user["user_id"]}
        sheet_post(action="append", table="expenses", row=row)
        d["expenses"].append(row)
        audit(request.user, "create", "expenses", row["expense_id"], new=json.dumps(row, ensure_ascii=False))
    store.refresh()
    return jsonify(ok=True, expense=row)


# ---------------------------------------------------------------- routes: admin
@app.delete("/api/admin/<table>/<rid>")
@require("admin")
def api_admin_delete(table, rid):
    keys = {"payments": "payment_id", "expenses": "expense_id"}
    if table not in keys:
        return jsonify(error="ไม่รองรับ"), 400
    with store.write_lock:
        old = next((r for r in store.data[table] if r[keys[table]] == rid), None)
        if not old:
            return jsonify(error="ไม่พบรายการ"), 404
        sheet_post(action="delete", table=table, idCol=keys[table], id=rid)
        audit(request.user, "delete", table, rid, old=json.dumps(old, ensure_ascii=False))
    store.refresh()
    return jsonify(ok=True)


@app.get("/api/admin/users")
@require("admin")
def api_admin_users():
    return jsonify([{k: u[k] for k in ("user_id", "username", "role", "active")} for u in store.data["users"]])


@app.post("/api/admin/users")
@require("admin")
def api_admin_add_user():
    b = request.get_json(force=True)
    if b.get("role") not in ("staff", "admin") or len(b.get("password", "")) < 8 or not b.get("username"):
        return jsonify(error="ข้อมูลไม่ถูกต้อง (รหัสผ่านอย่างน้อย 8 ตัวอักษร)"), 400
    with store.write_lock:
        if any(u["username"] == b["username"] for u in store.data["users"]):
            return jsonify(error="ชื่อผู้ใช้ซ้ำ"), 409
        row = {"user_id": next_id("U", store.data["users"], "user_id", 3), "username": b["username"],
               "password_hash": generate_password_hash(b["password"]), "role": b["role"], "active": "Y"}
        sheet_post(action="append", table="users", row=row)
        store.data["users"].append(row)
        audit(request.user, "create", "users", row["user_id"], new=b["username"])
    store.refresh()
    return jsonify(ok=True)


start_background()

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", "8000")), threaded=True)
