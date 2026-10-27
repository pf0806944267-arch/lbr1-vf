"""ทดสอบ end-to-end (เขียนข้อมูลจริงลงชีตแล้วลบทิ้ง): python tests/e2e.py"""
import os, sys, time
sys.stdout.reconfigure(encoding="utf-8")
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import app

c = app.app.test_client()
print("health:", c.get("/healthz").get_json())
print("users in sheet:", len(app.store.data["users"]))
d = c.get("/api/dashboard").get_json()
print("dashboard total/bank/reserve:", d["balance"]["total"], d["balance"]["bank"], d["balance"]["reserve"])
hv = c.get("/api/houses").get_json()
print("houses:", len(hv), "| sample public name:", hv[0]["name"])
print("staff endpoint without login:", c.get("/api/staff/houses").status_code)

r = c.post("/api/login", json={"username": os.environ["ADMIN_USERNAME"], "password": os.environ["ADMIN_PASSWORD"]})
print("login:", r.status_code)
tok = r.get_json().get("token")
H = {"Authorization": "Bearer " + str(tok)}
print("bad login:", c.post("/api/login", json={"username": "x", "password": "y"}).status_code)

before = d["balance"]["received"]
r = c.post("/api/staff/payments", headers=H, json={"house_id": "H001", "months": [12], "paid_date": "2026-10-27",
                                                     "channel": "cash", "has_slip": False, "note": "TEST"})
print("add payment:", r.status_code, r.get_json())
pid = r.get_json().get("added", [None])[0]
print("duplicate payment:", c.post("/api/staff/payments", headers=H, json={"house_id": "H001", "months": [12], "paid_date": "2026-10-27", "channel": "cash"}).status_code)
d2 = c.get("/api/dashboard").get_json()
print("received before/after:", before, d2["balance"]["received"])

r = c.post("/api/staff/expenses", headers=H, json={"expense_date": "2026-10-27", "amount": "1", "description": "TEST", "category_id": "C99"})
print("add expense:", r.status_code, r.get_json().get("expense", {}).get("doc_no"))
eid = r.get_json().get("expense", {}).get("expense_id")

# SSE: version ควรเพิ่มหลังเขียน
print("version:", app.store.version)
print("cleanup payment:", c.delete(f"/api/admin/payments/{pid}", headers=H).status_code)
print("cleanup expense:", c.delete(f"/api/admin/expenses/{eid}", headers=H).status_code)
d3 = c.get("/api/dashboard").get_json()
print("restored totals:", d3["balance"]["received"] == before, d3["balance"]["total"])
print("audit rows:", len(app.store.data["audit_log"]))
