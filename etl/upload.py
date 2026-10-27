"""อัปโหลดตาราง data/*.csv เข้า Google Sheet ผ่าน Apps Script (action=replace)
รัน: python etl/upload.py   (ต้องมี .env: APPS_SCRIPT_URL, API_KEY)
หมายเหตุ: ทุกเซลล์เก็บเป็นข้อความ (กัน Sheets แปลง 448/12 เป็นวันที่) ฝั่ง server แปลงตัวเลขเอง
"""
import csv, json, os, sys, urllib.request

sys.stdout.reconfigure(encoding="utf-8")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
env = dict(l.strip().split("=", 1) for l in open(os.path.join(ROOT, ".env"), encoding="utf-8") if "=" in l)
URL, KEY = env["APPS_SCRIPT_URL"], env["API_KEY"]

TABLES = ["fiscal_years", "zones", "fee_rates", "houses", "members", "house_members", "dues", "payments",
          "bank_ref", "expense_categories", "expenses", "reserve_transactions", "other_income"]
EXTRA = {
    "users": ["user_id", "username", "password_hash", "role", "active"],
    "audit_log": ["log_id", "user_id", "action", "table", "record_id", "old_value", "new_value", "timestamp"],
}


def post(payload):
    req = urllib.request.Request(URL, data=json.dumps(payload).encode("utf-8"),
                                 headers={"Content-Type": "text/plain;charset=utf-8"})
    return json.loads(urllib.request.urlopen(req, timeout=120).read().decode("utf-8"))


for t in TABLES:
    with open(os.path.join(ROOT, "data", t + ".csv"), encoding="utf-8-sig", newline="") as f:
        rows = list(csv.reader(f))
    print(t, post({"key": KEY, "action": "replace", "table": t, "header": rows[0], "rows": rows[1:]}))
for t, header in EXTRA.items():
    print(t, post({"key": KEY, "action": "replace", "table": t, "header": header, "rows": []}))
