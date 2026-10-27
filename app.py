"""ระบบกองทุนหมู่บ้าน: Flask server (Render) -> Apps Script API -> Google Sheet
- สมาชิกดู dashboard เรียลไทม์ (SSE), ค้นหาสถานะบ้านตนเอง, ดูงบการเงินฉบับทางการ
- เจ้าหน้าที่/ผู้ดูแลล็อกอินเพื่อบันทึกรับชำระเงิน (ออก E-Receipt) และบันทึกค่าใช้จ่าย
"""
import csv
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
SCRIPT_URL = os.environ.get("APPS_SCRIPT_URL", "")
API_KEY = os.environ.get("API_KEY", "")
SECRET = os.environ.get("SESSION_SECRET") or (API_KEY + "-session" if API_KEY else "secret-fund-2569")
FY = int(os.environ.get("FISCAL_YEAR", "2569"))
REFRESH_SECONDS = int(os.environ.get("REFRESH_SECONDS", "60"))
TABLES = ["fiscal_years", "zones", "fee_rates", "houses", "members", "house_members", "dues", "payments",
          "expense_categories", "expenses", "reserve_transactions", "other_income", "users", "audit_log"]
MONTH_TH = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."]
PERIOD_NAMES = [
    "งวดที่ 1 (ม.ค. - มี.ค.)",
    "งวดที่ 2 (เม.ย. - มิ.ย.)",
    "งวดที่ 3 (ก.ค. - ก.ย.)",
    "งวดที่ 4 (ต.ค. - ธ.ค.)"
]

app = Flask(__name__, static_folder=None)
serializer = URLSafeTimedSerializer(SECRET)


# ---------------------------------------------------------------- Fallback & Apps Script
def _call(req):
    return json.loads(urllib.request.urlopen(req, timeout=45).read().decode("utf-8"))


def sheet_get(table):
    if not SCRIPT_URL or not API_KEY:
        return []
    q = urllib.parse.urlencode({"key": API_KEY, "table": table})
    r = _call(urllib.request.Request(SCRIPT_URL + "?" + q))
    if not r.get("ok"):
        raise RuntimeError(f"{table}: {r.get('error')}")
    return r["rows"]


def sheet_get_many(tables):
    if not SCRIPT_URL or not API_KEY:
        return {}
    q = urllib.parse.urlencode({"key": API_KEY, "tables": ",".join(tables)})
    r = _call(urllib.request.Request(SCRIPT_URL + "?" + q))
    if r.get("ok") and "data" in r:
        return r["data"]
    return {t: sheet_get(t) for t in tables}


def sheet_post(**payload):
    if not SCRIPT_URL or not API_KEY:
        return {"ok": False, "error": "No APPS_SCRIPT_URL"}
    payload["key"] = API_KEY
    r = _call(urllib.request.Request(SCRIPT_URL, data=json.dumps(payload).encode("utf-8"),
                                     headers={"Content-Type": "text/plain;charset=utf-8"}))
    if not r.get("ok"):
        raise RuntimeError(r.get("error"))
    return r


def load_local_cache():
    data = {}
    for t in TABLES:
        p = os.path.join(ROOT, "data", t + ".csv")
        if os.path.exists(p):
            with open(p, encoding="utf-8-sig") as f:
                r = list(csv.reader(f))
                if r:
                    h = r[0]
                    data[t] = [dict(zip(h, row)) for row in r[1:]]
                else:
                    data[t] = []
        else:
            data[t] = []
    return data


def append_to_csv(table, row):
    p = os.path.join(ROOT, "data", table + ".csv")
    try:
        exists = os.path.exists(p)
        with open(p, "a", encoding="utf-8-sig", newline="") as f:
            w = csv.writer(f)
            if not exists or os.path.getsize(p) == 0:
                w.writerow(list(row.keys()))
            w.writerow([row.get(k, "") for k in row.keys()])
    except Exception as e:
        print(f"append_to_csv error {table}: {e}")


def num(v, default=0.0):
    try:
        return float(str(v).replace(",", ""))
    except (TypeError, ValueError):
        return default


# ---------------------------------------------------------------- Store / Cache
class Store:
    def __init__(self):
        self.data = load_local_cache()
        self.version = 1
        self.digest = None
        self.cond = threading.Condition()
        self.write_lock = threading.Lock()
        self.error = None

    def refresh(self):
        try:
            if not SCRIPT_URL or not API_KEY:
                return
            new = sheet_get_many(TABLES)
            if new and any(new.values()):
                self.error = None
                digest = json.dumps(new, sort_keys=True, ensure_ascii=False)
                with self.cond:
                    self.data = new
                    if digest != self.digest:
                        self.digest = digest
                        self.version += 1
                        self.cond.notify_all()
                        for t, rows in new.items():
                            if rows and isinstance(rows, list):
                                p = os.path.join(ROOT, "data", t + ".csv")
                                try:
                                    h = list(rows[0].keys())
                                    with open(p, "w", encoding="utf-8-sig", newline="") as f:
                                        w = csv.writer(f)
                                        w.writerow(h)
                                        for r in rows:
                                            w.writerow([r.get(col, "") for col in h])
                                except Exception as err:
                                    print(f"save cache error {t}: {err}")
        except Exception as e:
            self.error = str(e)

    def loop(self):
        while True:
            time.sleep(REFRESH_SECONDS)
            self.refresh()


store = Store()


def start_background():
    threading.Thread(target=store.refresh, daemon=True).start()
    bootstrap_admin()
    threading.Thread(target=store.loop, daemon=True).start()


# ---------------------------------------------------------------- Data Helpers
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
    zones = {z["zone_id"]: z for z in d.get("zones", [])}
    houses = {h["house_id"]: h for h in d.get("houses", [])}
    dues = [x for x in d.get("dues", []) if str(x.get("year_be")) == str(FY)]
    paid_by_due = {}
    for p in d.get("payments", []):
        paid_by_due[p["due_id"]] = p
    owners = {}
    members = {m["member_id"]: m["full_name"] for m in d.get("members", [])}
    for hm in d.get("house_members", []):
        owners.setdefault(hm["house_id"], []).append(members.get(hm["member_id"], ""))
    return zones, houses, dues, paid_by_due, owners


def summary():
    d = store.data
    zones, houses, dues, paid_by_due, owners = build_model()
    fy = next((x for x in d.get("fiscal_years", []) if str(x.get("year_be")) == str(FY)), {})
    opening = num(fy.get("opening_balance", 82969.73))
    opening_reserve = num(fy.get("opening_reserve", 10049.57))

    paid_amount = {dd["due_id"]: num(paid_by_due[dd["due_id"]]["amount_paid"]) for dd in dues if dd["due_id"] in paid_by_due}
    received = sum(paid_amount.values())
    other_income = sum(num(x["amount"]) for x in d.get("other_income", []))
    exp_total = sum(num(e["amount"]) for e in d.get("expenses", []))
    reserve_in = sum(num(r["amount"]) for r in d.get("reserve_transactions", []) if r.get("type") == "in")
    reserve_out = sum(num(r["amount"]) for r in d.get("reserve_transactions", []) if r.get("type") == "out")
    reserve_bal = reserve_in - reserve_out
    total = opening + received + other_income - exp_total
    bank_bal = total - reserve_bal

    periods = [0.0] * 4
    monthly = [0.0] * 12
    z_stat = {zid: {"zone": z["name"], "houses": 0, "periods": [{"paid": 0, "unpaid": 0} for _ in range(4)],
                    "collected": 0.0, "due_to_date": 0.0} for zid, z in zones.items()}
    house_months = {}
    cm = current_month()
    for dd in dues:
        m = int(dd.get("month", 1))
        pr = int(dd.get("period", 1))
        hid = dd["house_id"]
        paid = dd["due_id"] in paid_by_due
        house_months.setdefault(hid, {})[m] = paid
        if paid:
            a = paid_amount[dd["due_id"]]
            periods[pr - 1] += a
            monthly[m - 1] += a
            if hid in houses and houses[hid]["zone_id"] in z_stat:
                z_stat[houses[hid]["zone_id"]]["collected"] += a
        if m <= cm and hid in houses and houses[hid]["zone_id"] in z_stat:
            z_stat[houses[hid]["zone_id"]]["due_to_date"] += num(dd["amount_due"])

    for hid, h in houses.items():
        if h["zone_id"] not in z_stat:
            continue
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

    # Period cards: matching Image 1
    period_cards = []
    p_colors = ["#10b981", "#3b82f6", "#8b5cf6", "#f59e0b"]
    for pr in range(4):
        p_houses_paid = sum(1 for hid in houses if all(house_months.get(hid, {}).get(pr * 3 + i) for i in (1, 2, 3)))
        p_houses_unpaid = len(houses) - p_houses_paid
        pct = round(100 * p_houses_paid / len(houses), 1) if houses else 0
        period_cards.append({
            "period": pr + 1,
            "name": PERIOD_NAMES[pr],
            "amount": round(periods[pr], 2),
            "paid_houses": p_houses_paid,
            "unpaid_houses": p_houses_unpaid,
            "pct": pct,
            "color": p_colors[pr]
        })

    # Zone Chart: compare งวด 1 vs งวด 4 (Image 1)
    zone_chart = []
    for z in zlist:
        p1 = z["periods"][0]
        p4 = z["periods"][3]
        zone_chart.append({
            "zone": z["zone"],
            "houses": z["houses"],
            "p1_pct": p1["pct"],
            "p4_pct": p4["pct"],
            "collected": z["collected"]
        })

    # Expenses Budget Breakdown
    cat_buckets = {
        "ค่า รปภ. รักษาความปลอดภัย": 0.0,
        "บำรุงรักษา & สวน": 0.0,
        "สาธารณูปโภค (ไฟ/น้ำ)": 0.0,
        "ค่าบริการธนาคาร SMS": 0.0,
        "อื่นๆ": 0.0
    }
    for e in d.get("expenses", []):
        desc = str(e.get("description", ""))
        a = num(e.get("amount", 0))
        if any(k in desc for k in ["รปภ", "รักษาความปลอดภัย", "ยาม", "พิเชษฐ์"]):
            cat_buckets["ค่า รปภ. รักษาความปลอดภัย"] += a
        elif any(k in desc for k in ["ไฟ", "หลอด", "โคม", "ซ่อม", "ปูน", "สี", "กาว", "ตู้", "เกาะกลาง", "หญ้า", "สวน", "คัทเอาท์"]):
            cat_buckets["บำรุงรักษา & สวน"] += a
        elif any(k in desc for k in ["น้ำ", "ประปา", "การประปา", "การไฟฟ้า"]):
            cat_buckets["สาธารณูปโภค (ไฟ/น้ำ)"] += a
        elif any(k in desc for k in ["SMS", "ธนาคาร", "ธรรมเนียม"]):
            cat_buckets["ค่าบริการธนาคาร SMS"] += a
        else:
            cat_buckets["อื่นๆ"] += a

    budget_breakdown = [{"name": k, "amount": round(v, 2)} for k, v in cat_buckets.items() if v > 0]
    recent = sorted(d.get("expenses", []), key=lambda e: (e.get("expense_date", ""), e.get("expense_id", "")), reverse=True)[:10]
    full_due = sum(num(x["amount_due"]) for x in dues)

    # Financial Statement rows matching Image 3
    statement = [
        {"date": "24/1/69", "title": "ยอดเงินคงเหลือ ปี 2568 (ยกมา)", "amount": opening, "type": "opening"},
        {"date": "-", "title": f"รับเงินจากสมาชิก งวดที่ 1 (ม.ค. - มี.ค. 69) [ชำระแล้ว {period_cards[0]['paid_houses']}/{len(houses)} หลัง]", "amount": periods[0], "type": "income"},
        {"date": "-", "title": f"รับเงินจากสมาชิก งวดที่ 2 (เม.ย. - มิ.ย. 69) [ชำระแล้ว {period_cards[1]['paid_houses']}/{len(houses)} หลัง]", "amount": periods[1], "type": "income"},
        {"date": "-", "title": f"รับเงินจากสมาชิก งวดที่ 3 (ก.ค. - ก.ย. 69) [ชำระแล้ว {period_cards[2]['paid_houses']}/{len(houses)} หลัง]", "amount": periods[2], "type": "income"},
        {"date": "-", "title": f"รับเงินจากสมาชิก งวดที่ 4 (ต.ค. - ธ.ค. 69) [ชำระแล้ว {period_cards[3]['paid_houses']}/{len(houses)} หลัง]", "amount": periods[3], "type": "income"},
        {"date": "-", "title": f"รวมรับเงินจากสมาชิกทั้ง 4 งวด ({len(houses)} หลังคาเรือน)", "amount": received, "type": "total_received", "highlight": "blue"},
        {"date": "-", "title": "เงินสนับสนุน", "amount": other_income, "type": "income"},
        {"date": "-", "title": "รวมค่าใช้จ่ายตั้งแต่ ม.ค. 2569 - ปัจจุบัน", "amount": exp_total, "type": "total_expense", "highlight": "red"},
        {"date": "-", "title": "เงินสำรองคงเหลือ (เงินสดในมือ)", "amount": reserve_bal, "type": "reserve"},
        {"date": "-", "title": "เงินคงเหลือในสมุดบัญชีธนาคาร (ธนาคารกรุงเทพ)", "amount": bank_bal, "type": "bank"},
        {"date": "ณ ปัจจุบัน", "title": "รวมเงินคงเหลือสุทธิทั้งสิ้น (Real-time)", "amount": total, "type": "final_balance", "highlight": "green"}
    ]

    return {
        "fiscal_year": FY,
        "as_of": now_th().strftime("%Y-%m-%d %H:%M:%S"),
        "as_of_thai": f"{now_th().day} {MONTH_TH[now_th().month - 1]} {FY} เวลา {now_th().strftime('%H:%M:%S')} น.",
        "current_month": cm,
        "balance": {
            "opening": opening,
            "received": received,
            "other_income": other_income,
            "expenses": exp_total,
            "total": round(total, 2),
            "reserve": round(reserve_bal, 2),
            "bank": round(bank_bal, 2),
            "opening_reserve": opening_reserve
        },
        "period_cards": period_cards,
        "zone_chart": zone_chart,
        "budget_breakdown": budget_breakdown,
        "statement": statement,
        "monthly": [round(x, 2) for x in monthly],
        "zones": zlist,
        "houses_total": len(houses),
        "year_collected_pct": round(100 * received / full_due, 1) if full_due else 0,
        "recent_expenses": [{"date": e.get("expense_date", ""), "description": e.get("description", ""),
                             "amount": num(e.get("amount", 0)), "payee": e.get("payee", "")} for e in recent],
        "version": store.version,
    }


def houses_view(full=False):
    zones, houses, dues, paid_by_due, owners = build_model()
    hm = {}
    dues_info = {}
    for dd in dues:
        hid = dd["house_id"]
        m = int(dd.get("month", 1))
        pr = int(dd.get("period", 1))
        paid = dd["due_id"] in paid_by_due
        hm.setdefault(hid, {})[m] = paid
        dues_info.setdefault(hid, {})[m] = {
            "due_id": dd["due_id"],
            "period": pr,
            "amount": num(dd["amount_due"]),
            "paid": paid,
            "payment": paid_by_due.get(dd["due_id"])
        }
    cm = current_month()
    out = []
    for hid, h in houses.items():
        months = [bool(hm.get(hid, {}).get(m)) for m in range(1, 13)]
        quarters = []
        for pr in range(4):
            q_months = [pr * 3 + i for i in (1, 2, 3)]
            is_full = all(months[m - 1] for m in q_months)
            paid_cnt = sum(1 for m in q_months if months[m - 1])
            quarters.append({"period": pr + 1, "is_full": is_full, "paid_count": paid_cnt})

        rate = 100 if zones.get(h["zone_id"], {}).get("name") == "สายหลัก" else 300
        paid_amount = sum(rate for m in range(12) if months[m])
        overdue_months = sum(1 for m in range(cm) if not months[m])
        overdue_amount = overdue_months * rate

        names = owners.get(hid, [])
        item = {
            "house_id": hid,
            "house_no": h["house_no"],
            "zone": zones.get(h["zone_id"], {}).get("name", ""),
            "name": " / ".join(names) if full else " / ".join(mask_name(n) for n in names),
            "owner": " / ".join(names) if full else " / ".join(mask_name(n) for n in names),
            "owner_full": " / ".join(names),
            "rate": rate,
            "months": months,
            "quarters": quarters,
            "paid_count": sum(months),
            "paid_amount": paid_amount,
            "overdue_count": overdue_months,
            "overdue_amount": overdue_amount,
        }
        out.append(item)
    out.sort(key=lambda x: (x["zone"] == "สายหลัก", int(x["zone"].split()[1]) if x["zone"] != "สายหลัก" else 0, x["house_no"]))
    return out


# ---------------------------------------------------------------- Auth & Token
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
        if any(x.get("username") == os.environ.get("ADMIN_USERNAME", "admin") for x in users) or not os.environ.get("ADMIN_USERNAME"):
            return
        row = {
            "user_id": next_id("U", users, "user_id", 3),
            "username": os.environ["ADMIN_USERNAME"],
            "password_hash": generate_password_hash(os.environ.get("ADMIN_PASSWORD", "admin1234")),
            "role": "admin",
            "active": "Y"
        }
        sheet_post(action="append", table="users", row=row)
        store.data.setdefault("users", []).append(row)
        append_to_csv("users", row)
    except Exception as e:
        print("bootstrap_admin skipped/error:", e)


# ---------------------------------------------------------------- Routes: Public
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
    return jsonify(houses_view(full=False))


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


# ---------------------------------------------------------------- Routes: Staff
@app.post("/api/login")
def api_login():
    b = request.get_json(force=True)
    users = store.data.get("users", [])
    u = next((x for x in users if x.get("username") == b.get("username") and x.get("active") == "Y"), None)
    if not u or not check_password_hash(u.get("password_hash", ""), b.get("password", "")):
        return jsonify(error="ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง"), 401
    return jsonify(token=make_token(u), username=u["username"], role=u["role"])


@app.get("/api/staff/houses")
@require()
def api_staff_houses():
    return jsonify(houses_view(full=True))


@app.get("/api/staff/categories")
@require()
def api_staff_categories():
    return jsonify(store.data.get("expense_categories", []))


@app.get("/api/staff/recent")
@require()
def api_staff_recent():
    d = store.data
    dues = {x["due_id"]: x for x in d.get("dues", [])}
    houses = {h["house_id"]: h["house_no"] for h in d.get("houses", [])}
    pays = []
    for p in sorted(d.get("payments", []), key=lambda p: p.get("payment_id", ""), reverse=True)[:30]:
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
    exps = sorted(d.get("expenses", []), key=lambda e: e.get("expense_id", ""), reverse=True)[:30]
    return jsonify(payments=pays, expenses=exps)


@app.post("/api/staff/payments")
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


@app.post("/api/staff/expenses")
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


# ---------------------------------------------------------------- Routes: Admin
@app.delete("/api/admin/<table>/<rid>")
@require("admin")
def api_admin_delete(table, rid):
    keys = {"payments": "payment_id", "expenses": "expense_id"}
    if table not in keys:
        return jsonify(error="ไม่รองรับตารางนี้"), 400
    with store.write_lock:
        rows = store.data.get(table, [])
        old = next((r for r in rows if r.get(keys[table]) == rid), None)
        if not old:
            return jsonify(error="ไม่พบรายการ"), 404
        try:
            sheet_post(action="delete", table=table, idCol=keys[table], id=rid)
        except Exception as e:
            print(f"sheet delete warning: {e}")
        rows.remove(old)
        audit(request.user, "delete", table, rid, old=json.dumps(old, ensure_ascii=False))

        # Re-write the table CSV
        p = os.path.join(ROOT, "data", table + ".csv")
        try:
            if rows:
                header = list(rows[0].keys())
                with open(p, "w", encoding="utf-8-sig", newline="") as f:
                    w = csv.writer(f)
                    w.writerow(header)
                    for r in rows:
                        w.writerow([r.get(h, "") for h in header])
        except Exception as e:
            print(f"rewrite csv error: {e}")

        with store.cond:
            store.version += 1
            store.digest = json.dumps(store.data, sort_keys=True, ensure_ascii=False)
            store.cond.notify_all()

    threading.Thread(target=store.refresh, daemon=True).start()
    return jsonify(ok=True)


@app.get("/api/admin/users")
@require("admin")
def api_admin_users():
    return jsonify([{k: u.get(k) for k in ("user_id", "username", "role", "active")} for u in store.data.get("users", [])])


@app.post("/api/admin/users")
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


start_background()

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", "8000")), threaded=True)
