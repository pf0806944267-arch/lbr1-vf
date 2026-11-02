"""ระบบกองทุนพัฒนาหมู่บ้าน: Flask server (Render) -> Apps Script API -> Google Sheet
- สมาชิกดู dashboard เรียลไทม์ (SSE), ค้นหาสถานะบ้านตนเอง, ดูงบการเงินฉบับทางการ
- เจ้าหน้าที่/ผู้ดูแลล็อกอินเพื่อบันทึกรับชำระเงิน (ออก E-Receipt) และบันทึกค่าใช้จ่าย
"""
import os
import threading
from flask import Flask

from core.auth import bootstrap_admin, current_user, make_token, require
from routes.admin import admin_bp
from routes.public import public_bp
from routes.staff import staff_bp
from services.store import store
from services.visits import visits

app = Flask(__name__, static_folder=None)

# Register Blueprints
app.register_blueprint(public_bp)
app.register_blueprint(staff_bp)
app.register_blueprint(admin_bp)


def start_background():
    def init_and_loop():
        store.refresh()
        bootstrap_admin()
        store.loop()
    threading.Thread(target=init_and_loop, daemon=True).start()
    threading.Thread(target=visits.loop, daemon=True).start()


start_background()

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", "8000")), threaded=True)
