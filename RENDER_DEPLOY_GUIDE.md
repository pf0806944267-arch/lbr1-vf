# คู่มือการนำระบบกองทุนหมู่บ้าน 2569 ขึ้น Server (Render.com) ฟรี 100%
## และเชื่อมต่อฐานข้อมูล Google Sheets แบบ Real-time

---

### โครงสร้างการทำงาน (Architecture)
1. **Frontend & Backend (Render.com - ฟรี 100%)**:
   - ทำงานตลอด 24 ชั่วโมง มี SSL (HTTPS) อัตโนมัติ
   - หน้าประชาชนดูรายงาน โปร่งใส และหน้าเจ้าหน้าที่บันทึกข้อมูล
2. **Database Cloud Storage (Google Sheets - ฟรี 100%)**:
   - เมื่อเจ้าหน้าที่บันทึกรับเงินหรือบันทึกค่าใช้จ่ายบนเว็บ ระบบจะยิงข้อมูลผ่าน **Google Apps Script Webhook** เข้าไปอัปเดตใน Google Sheets แบบ Real-time ทันที ข้อมูลไม่มีวันหาย

---

### ขั้นตอนที่ 1: ตั้งค่า Google Sheets และ Google Apps Script (ใช้เวลา 2 นาที)

1. เข้าเว็บ [Google Drive](https://drive.google.com/) แล้วสร้าง **Google Sheets ใหม่** 1 ไฟล์ (หรืออัปโหลดไฟล์ `village_fund_2569.xlsx` ขึ้นไปเปิดบน Google Sheets)
2. ที่แถบเมนูด้านบนของ Google Sheets คลิก: **ส่วนขยาย (Extensions)** > **Apps Script**
3. ลบโค้ดเดิมทั้งหมดในหน้าต่างนั้นออก
4. เปิดไฟล์ [`google_apps_script.js`](file:///d:/กองทุน/google_apps_script.js) คัดลอกโค้ดทั้งหมด แล้วนำไปวางใน Apps Script
5. กดปุ่ม **บันทึก (Save)** (รูปแผ่นดิสก์)
6. คลิกปุ่มสีน้ำเงินมุมขวาบน **"ทำให้ใช้งานได้" (Deploy)** > เลือก **"การทำให้ใช้งานได้ใหม่" (New deployment)**
7. กดรูปฟันเฟือง (Gear) ข้างคำว่า Select type > เลือก **"เว็บแอป" (Web app)**
   - **คำอธิบาย (Description):** `Village Fund Webhook`
   - **ดำเนินการในฐานะ (Execute as):** `ตัวฉัน (Me)`
   - **ผู้มีสิทธิ์เข้าถึง (Who has access):** **`ทุกคน (Anyone)`** *(สำคัญมาก ต้องเลือก ทุกคน เพื่อให้ Render ส่งข้อมูลเข้ามาได้)*
8. คลิกปุ่ม **"ทำให้ใช้งานได้" (Deploy)** > กด **ให้สิทธิ์เข้าถึง (Authorize access)** > เลือกบัญชี Google ของท่าน
9. ระบบจะแสดง **URL ของเว็บแอป (Web app URL)** (ที่ลงท้ายด้วย `/exec`)
   - ให้ **คัดลอก (Copy) URL นี้เก็บไว้** (จะนำไปใช้ในขั้นตอนที่ 3)

---

### ขั้นตอนที่ 2: นำโค้ดขึ้น GitHub

1. เข้าเว็บ [GitHub.com](https://github.com/) (หากยังไม่มีบัญชี ให้สมัครฟรี)
2. สร้าง Repository ใหม่ เช่น ชื่อ `village-fund-2569` (ตั้งเป็น Public หรือ Private ก็ได้)
3. เปิด Command Prompt หรือ PowerShell ในโฟลเดอร์ `d:\กองทุน` แล้วพิมพ์คำสั่ง:
   ```bash
   git init
   git add .
   git commit -m "Initial commit for Village Fund 2569 with Render & Google Sheets"
   git branch -M main
   git remote add origin https://github.com/ชื่อผู้ใช้ของคุณ/village-fund-2569.git
   git push -u origin main
   ```

---

### ขั้นตอนที่ 3: เปิดใช้งานบน Render.com (ฟรี 100%)

1. เข้าเว็บ [Render.com](https://render.com/) แล้วเข้าสู่ระบบด้วยบัญชี GitHub ของท่าน
2. ที่หน้า Dashboard คลิกปุ่ม **New +** > เลือก **Web Service**
3. เลือก **Build and deploy from a Git repository** > คลิก **Next**
4. เลือก repository `village-fund-2569` ที่เพิ่งอัปโหลดขึ้นไป
5. กรอกข้อมูลการตั้งค่าดังนี้:
   - **Name:** `village-fund-2569` (หรือชื่ออื่นตามต้องการ)
   - **Region:** `Singapore` (ใกล้ไทยที่สุด โหลดเร็ว)
   - **Branch:** `main`
   - **Runtime:** `Python 3`
   - **Build Command:** `pip install -r requirements.txt`
   - **Start Command:** `python app.py`
   - **Instance Type:** `Free` ($0/month)
6. เลื่อนลงมาที่หัวข้อ **Environment Variables (ตัวแปรสภาพแวดล้อม)**:
   - คลิก **Add Environment Variable**
   - **Key:** `GOOGLE_SHEET_WEBHOOK_URL`
   - **Value:** วาง URL ที่คัดลอกมาจากขั้นตอนที่ 1 (URL Google Apps Script ที่ลงท้ายด้วย `/exec`)
7. คลิกปุ่ม **Create Web Service**

---

### ขั้นตอนที่ 4: ใช้งานจริงและทดสอบระบบ

1. รอ Render ทำการ Build ประมาณ 1-2 นาที เมื่อขึ้นสถานะ **Live** สีเขียว ท่านจะได้ URL ประจำเว็บ เช่น:
   `https://village-fund-2569.onrender.com`
2. **สำหรับประชาชนทั่วไป:**
   เข้าผ่าน `https://village-fund-2569.onrender.com/` เพื่อดูความโปร่งใส ค้นหาบ้านเลขที่ ดูยอดเงินกองทุน
3. **สำหรับเจ้าหน้าที่:**
   เข้าผ่าน `https://village-fund-2569.onrender.com/staff`
   - เข้าสู่ระบบด้วยบัญชีเจ้าหน้าที่ (เช่น `veeraor` หรือ `admin`)
   - ไปที่แท็บ **"6. Google Drive & Sheets"** > คลิกปุ่ม **"สั่งซิงก์ข้อมูลเดี๋ยวนี้"** ระบบจะส่งฐานข้อมูลสมาชิกทั้ง 162 หลังคาเรือนและรายจ่ายทั้งหมดขึ้นไปสร้างใน Google Sheets ทันที
   - จากนั้นเมื่อเจ้าหน้าที่ออกใบเสร็จรับเงิน หรืองวดใดๆ ข้อมูลจะวิ่งเข้า Google Sheets แบบ Real-time ทันที!
