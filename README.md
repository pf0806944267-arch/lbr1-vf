# ระบบกองทุนพัฒนาหมู่บ้าน

Dashboard เรียลไทม์สำหรับสมาชิก + หน้าเจ้าหน้าที่บันทึกการชำระเงิน/ค่าใช้จ่าย
Flask (Render) → Google Apps Script (API) → Google Sheet

## โครงสร้าง
- `app.py` เซิร์ฟเวอร์ (แคชข้อมูล, SSE, login, API)
- `static/` หน้า dashboard (`index.html`) และหน้าเจ้าหน้าที่ (`staff.html`, ที่ `/staff`)
- `apps-script/Code.gs` โค้ดที่วางใน Apps Script ของชีต
- `etl/build_db.py` แปลง Excel เดิม → `data/*.csv` ; `etl/upload.py` อัปโหลดเข้าชีต

## รันในเครื่อง
สร้างไฟล์ `.env` (ห้าม commit):
```
APPS_SCRIPT_URL=https://script.google.com/macros/s/.../exec
API_KEY=รหัสเดียวกับใน Script properties
ADMIN_USERNAME=admin
ADMIN_PASSWORD=รหัสผ่านอย่างน้อย 8 ตัว
```
`pip install -r requirements.txt` แล้ว `python app.py` เปิด http://localhost:8000

## Deploy บน Render
New → Blueprint → เลือก repo นี้ (ใช้ `render.yaml`) แล้วใส่ค่า env 4 ตัว: `APPS_SCRIPT_URL`, `API_KEY`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`
ผู้ดูแลคนแรกถูกสร้างอัตโนมัติเมื่อตาราง users ว่าง
