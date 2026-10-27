# -*- coding: utf-8 -*-
"""
Village Fund Management Web Application (ระบบบริหารจัดการกองทุนพัฒนาหมู่บ้าน 2569)
Backend Server using Python's ThreadingHTTPServer & SQLite
"""
import os
import sys
import json
import sqlite3
import mimetypes
from http.server import HTTPServer, BaseHTTPRequestHandler
from socketserver import ThreadingMixIn
import urllib.parse
from datetime import datetime

PORT = int(os.environ.get("PORT", 8000))
DB_FILE = "village_fund.db"
GOOGLE_SHEET_WEBHOOK_URL = os.environ.get("GOOGLE_SHEET_WEBHOOK_URL", "")
_last_sheet_pull_time = 0

def sync_to_google_sheet(action_type, payload):
    """
    Sends data to Google Sheets via Google Apps Script Webhook asynchronously.
    Non-blocking to ensure fast web response times.
    """
    if not GOOGLE_SHEET_WEBHOOK_URL:
        return

    import threading
    def _worker():
        try:
            import urllib.request
            req_data = json.dumps({"action": action_type, "data": payload}, ensure_ascii=False).encode('utf-8')
            req = urllib.request.Request(
                GOOGLE_SHEET_WEBHOOK_URL,
                data=req_data,
                headers={'Content-Type': 'application/json'}
            )
            with urllib.request.urlopen(req, timeout=12) as resp:
                print(f"[GoogleSheets Sync] Successfully synced {action_type} (Status: {resp.status})")
        except Exception as e:
            print(f"[GoogleSheets Sync] Notice: sync notice for {action_type}: {e}")

    threading.Thread(target=_worker, daemon=True).start()

def pull_from_google_sheet(force=False):
    """
    Fetches the latest members and expenses data from Google Sheets Webhook and updates local SQLite.
    Returns (success: bool, message: str, count: int)
    """
    global _last_sheet_pull_time
    import time
    now_ts = time.time()
    # Cache / Throttle: do not pull more frequently than once every 20 seconds unless force=True
    if not force and (now_ts - _last_sheet_pull_time < 20):
        return True, "Cached recent pull", 0

    if not GOOGLE_SHEET_WEBHOOK_URL:
        return False, "ยังไม่ได้ตั้งค่า GOOGLE_SHEET_WEBHOOK_URL", 0

    try:
        import urllib.request
        req = urllib.request.Request(GOOGLE_SHEET_WEBHOOK_URL, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode('utf-8'))

        members = data.get("members", [])
        expenses = data.get("expenses", [])

        if not members and not expenses:
            return False, "ไม่พบข้อมูลจาก Google Sheets (อาจยังไม่ได้ Deploy โค้ดใหม่)", 0

        conn = get_db()
        c = conn.cursor()
        updated_count = 0

        if members:
            for m in members:
                # Update member payment records in SQLite from Google Sheets
                c.execute("""
                    UPDATE members SET
                        m1=?, m2=?, m3=?, q1_total=?,
                        m4=?, m5=?, m6=?, q2_total=?,
                        m7=?, m8=?, m9=?, q3_total=?,
                        m10=?, m11=?, m12=?, q4_total=?,
                        year_total=?, due_amount=?, status=?
                    WHERE id=? OR house_no=?
                """, (
                    m.get('m1', 0), m.get('m2', 0), m.get('m3', 0), m.get('q1_total', 0),
                    m.get('m4', 0), m.get('m5', 0), m.get('m6', 0), m.get('q2_total', 0),
                    m.get('m7', 0), m.get('m8', 0), m.get('m9', 0), m.get('q3_total', 0),
                    m.get('m10', 0), m.get('m11', 0), m.get('m12', 0), m.get('q4_total', 0),
                    m.get('year_total', 0), m.get('due_amount', 0), m.get('status', 'ยังไม่ชำระ'),
                    m.get('id'), str(m.get('house_no', ''))
                ))
                updated_count += 1

        if expenses:
            for ex in expenses:
                c.execute("SELECT id FROM expenses WHERE doc_no = ?", (ex.get('doc_no'),))
                if not c.fetchone():
                    c.execute("""
                        INSERT INTO expenses (doc_no, date, category, title, amount, payee, status)
                        VALUES (?, ?, ?, ?, ?, ?, ?)
                    """, (
                        ex.get('doc_no', ''), ex.get('date', ''), ex.get('category', 'ค่าใช้จ่ายทั่วไป'),
                        ex.get('title', ''), ex.get('amount', 0), ex.get('payee', ''), ex.get('status', 'จ่ายแล้ว')
                    ))

        conn.commit()
        conn.close()
        _last_sheet_pull_time = now_ts
        print(f"[GoogleSheets Sync] Successfully pulled {updated_count} members from Google Sheet")
        return True, f"ดึงข้อมูลจาก Google Sheets สำเร็จ {updated_count} รายการ", updated_count
    except Exception as e:
        print(f"[GoogleSheets Sync] Error pulling from Google Sheets: {e}")
        return False, str(e), 0

class ThreadedHTTPServer(ThreadingMixIn, HTTPServer):
    daemon_threads = True

def get_db():
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    return conn

class VillageFundHandler(BaseHTTPRequestHandler):
    def send_json(self, data, status=200):
        response_bytes = json.dumps(data, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(response_bytes)))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
        self.end_headers()
        self.wfile.write(response_bytes)

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
        self.end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        query = urllib.parse.parse_qs(parsed.query)

        # Static file handling
        if path == "/" or path == "/index.html":
            self.serve_file("index.html", "text/html; charset=utf-8")
            return
        elif path == "/staff" or path == "/staff.html":
            self.serve_file("staff.html", "text/html; charset=utf-8")
            return
        elif path.startswith("/static/") or path.endswith((".js", ".css", ".png", ".jpg", ".xlsx", ".csv", ".json")):
            file_name = path.lstrip("/")
            if os.path.exists(file_name):
                mime, _ = mimetypes.guess_type(file_name)
                self.serve_file(file_name, mime or "application/octet-stream")
                return

        # API Routes
        if path == "/api/stats":
            # Auto-pull latest updates from Google Sheets if configured
            pull_from_google_sheet(force=False)
            self.handle_get_stats()
        elif path == "/api/members":
            self.handle_get_members(query)
        elif path.startswith("/api/member/"):
            member_id = path.split("/")[-1]
            self.handle_get_single_member(member_id)
        elif path == "/api/expenses":
            self.handle_get_expenses()
        elif path == "/api/bank-transactions":
            self.handle_get_bank_transactions()
        elif path == "/api/audit-logs":
            self.handle_get_audit_logs()
        elif path == "/api/overview":
            self.handle_get_overview()
        elif path == "/api/pull-from-sheets":
            ok, msg, cnt = pull_from_google_sheet(force=True)
            self.send_json({"success": ok, "message": msg, "count": cnt})
        else:
            self.send_json({"error": "Endpoint not found"}, 404)

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        
        content_length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(content_length).decode('utf-8')
        try:
            data = json.loads(body) if body else {}
        except Exception:
            data = {}

        if path == "/api/login":
            self.handle_login(data)
        elif path == "/api/pay":
            self.handle_record_payment(data)
        elif path == "/api/expenses":
            self.handle_add_expense(data)
        elif path == "/api/sync-sheets":
            self.handle_sync_sheets(data)
        elif path == "/api/pull-from-sheets":
            ok, msg, cnt = pull_from_google_sheet(force=True)
            self.send_json({"success": ok, "message": msg, "count": cnt})
        else:
            self.send_json({"error": "Endpoint not found"}, 404)

    def serve_file(self, filename, content_type):
        if not os.path.exists(filename):
            self.send_json({"error": "File not found"}, 404)
            return
        with open(filename, "rb") as f:
            content = f.read()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(content)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(content)

    def handle_get_stats(self):
        conn = get_db()
        c = conn.cursor()
        
        # Real-time total counts and collections from database
        c.execute("""
            SELECT 
                COUNT(*) as total_houses,
                COALESCE(SUM(year_total), 0) as total_collected,
                COALESCE(SUM(due_amount), 0) as total_due,
                COALESCE(SUM(q1_total), 0) as q1_sum,
                COALESCE(SUM(q2_total), 0) as q2_sum,
                COALESCE(SUM(q3_total), 0) as q3_sum,
                COALESCE(SUM(q4_total), 0) as q4_sum
            FROM members
        """)
        gen = dict(c.fetchone())

        # Quarterly paid counts
        c.execute("SELECT COUNT(*) FROM members WHERE q1_total > 0")
        q1_paid = c.fetchone()[0]
        c.execute("SELECT COUNT(*) FROM members WHERE q2_total > 0")
        q2_paid = c.fetchone()[0]
        c.execute("SELECT COUNT(*) FROM members WHERE q3_total > 0")
        q3_paid = c.fetchone()[0]
        c.execute("SELECT COUNT(*) FROM members WHERE q4_total > 0")
        q4_paid = c.fetchone()[0]

        # Alley breakdown
        c.execute("""
            SELECT alley,
                   COUNT(*) as house_count,
                   SUM(CASE WHEN q1_total > 0 THEN 1 ELSE 0 END) as q1_paid_count,
                   SUM(CASE WHEN q2_total > 0 THEN 1 ELSE 0 END) as q2_paid_count,
                   SUM(CASE WHEN q3_total > 0 THEN 1 ELSE 0 END) as q3_paid_count,
                   SUM(CASE WHEN q4_total > 0 THEN 1 ELSE 0 END) as q4_paid_count,
                   SUM(q1_total) as q1_sum,
                   SUM(q2_total) as q2_sum,
                   SUM(q3_total) as q3_sum,
                   SUM(q4_total) as q4_sum,
                   SUM(year_total) as alley_total,
                   SUM(due_amount) as alley_due
            FROM members
            GROUP BY alley
            ORDER BY row_no ASC
        """)
        alley_stats = [dict(row) for row in c.fetchall()]

        # Real-time Expense total
        # Base baseline is 311,420.10 plus any newly recorded expenses beyond the initial 6
        c.execute("SELECT COALESCE(SUM(amount), 0) FROM expenses")
        all_exp_in_db = c.fetchone()[0]
        # Initial 6 expenses sum to 27,784.00
        baseline_cum_expenses = 311420.10
        extra_expenses = max(0.0, all_exp_in_db - 27784.00)
        total_expenses = baseline_cum_expenses + extra_expenses

        # Latest bank balance
        c.execute("SELECT balance FROM bank_transactions ORDER BY id DESC LIMIT 1")
        last_bank = c.fetchone()
        bank_bal = last_bank[0] if last_bank else 54353.55

        # Current Thai Date
        now = datetime.now()
        thai_months = ["", "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
                       "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"]
        thai_date_str = f"{now.day} {thai_months[now.month]} 2569"
        thai_datetime_str = f"{now.day} {thai_months[now.month]} 2569 เวลา {now.strftime('%H:%M:%S')} น."

        conn.close()

        res = {
            "total_houses": gen["total_houses"],
            "total_collected": gen["total_collected"],
            "total_due": gen["total_due"],
            "as_of_date": thai_date_str,
            "as_of_datetime": thai_datetime_str,
            "quarter_counts": {
                "q1": {"paid": q1_paid, "total": 162, "percent": round(q1_paid/162*100, 1), "amount": gen["q1_sum"]},
                "q2": {"paid": q2_paid, "total": 162, "percent": round(q2_paid/162*100, 1), "amount": gen["q2_sum"]},
                "q3": {"paid": q3_paid, "total": 162, "percent": round(q3_paid/162*100, 1), "amount": gen["q3_sum"]},
                "q4": {"paid": q4_paid, "total": 162, "percent": round(q4_paid/162*100, 1), "amount": gen["q4_sum"]}
            },
            "financial_summary": {
                "initial_2568": 82969.73,
                "member_income": gen["total_collected"],
                "support_income": 168.39,
                "expenses_cum": total_expenses,
                "cash_reserve": 13764.47,
                "bank_balance": bank_bal,
                "total_ending_balance": 13764.47 + bank_bal
            },
            "alley_stats": alley_stats
        }
        self.send_json(res)

    def handle_get_members(self, query):
        conn = get_db()
        c = conn.cursor()
        
        sql = "SELECT * FROM members WHERE 1=1"
        params = []
        
        q = query.get('q', [None])[0]
        if q:
            sql += " AND (name LIKE ? OR house_no LIKE ?)"
            params.extend([f"%{q}%", f"%{q}%"])

        alley = query.get('alley', [None])[0]
        if alley and alley != "all":
            sql += " AND alley = ?"
            params.append(alley)

        status = query.get('status', [None])[0]
        if status and status != "all":
            sql += " AND status = ?"
            params.append(status)

        sql += " ORDER BY id ASC"
        c.execute(sql, params)
        members = [dict(row) for row in c.fetchall()]
        conn.close()
        self.send_json(members)

    def handle_get_single_member(self, member_id):
        conn = get_db()
        c = conn.cursor()
        if member_id.isdigit():
            c.execute("SELECT * FROM members WHERE id = ?", (int(member_id),))
        else:
            c.execute("SELECT * FROM members WHERE house_no = ?", (member_id,))
        row = c.fetchone()
        conn.close()
        if row:
            self.send_json(dict(row))
        else:
            self.send_json({"error": "Member not found"}, 404)

    def handle_get_expenses(self):
        conn = get_db()
        c = conn.cursor()
        c.execute("SELECT * FROM expenses ORDER BY id ASC")
        rows = [dict(r) for r in c.fetchall()]
        conn.close()
        self.send_json(rows)

    def handle_get_bank_transactions(self):
        conn = get_db()
        c = conn.cursor()
        c.execute("SELECT * FROM bank_transactions ORDER BY id ASC")
        rows = [dict(r) for r in c.fetchall()]
        conn.close()
        self.send_json(rows)

    def handle_get_audit_logs(self):
        conn = get_db()
        c = conn.cursor()
        c.execute("SELECT * FROM audit_logs ORDER BY id DESC LIMIT 50")
        rows = [dict(r) for r in c.fetchall()]
        conn.close()
        self.send_json(rows)

    def handle_get_overview(self):
        if os.path.exists("village_fund_overview.json"):
            with open("village_fund_overview.json", "r", encoding="utf-8") as f:
                data = json.load(f)
            self.send_json(data)
        else:
            self.send_json({"error": "Overview file not found"}, 404)

    def handle_login(self, data):
        username = data.get('username')
        password = data.get('password')
        conn = get_db()
        c = conn.cursor()
        c.execute("SELECT * FROM users WHERE username = ? AND password = ?", (username, password))
        user = c.fetchone()
        conn.close()
        if user:
            user_dict = dict(user)
            del user_dict['password']
            user_dict['token'] = f"token_{user_dict['username']}_{datetime.now().strftime('%Y%m%d%H%M%S')}"
            self.send_json({"success": True, "user": user_dict})
        else:
            self.send_json({"success": False, "message": "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง"}, 401)

    def handle_record_payment(self, data):
        """
        Record a payment:
        data: {
            "member_id": int,
            "months": [1, 2, 3...], # 1-indexed (1=ม.ค., 12=ธ.ค.)
            "amount": float,
            "channel": "bank" | "cash",
            "receipt_no": str (optional),
            "payer_name": str,
            "note": str,
            "actor": str
        }
        """
        member_id = data.get('member_id')
        months = data.get('months', [])
        channel = data.get('channel', 'bank')
        note = data.get('note', '')
        actor = data.get('actor', 'เจ้าหน้าที่')

        if not member_id or not months:
            self.send_json({"error": "ข้อมูลไม่ครบถ้วน"}, 400)
            return

        conn = get_db()
        c = conn.cursor()
        c.execute("SELECT * FROM members WHERE id = ?", (member_id,))
        m = c.fetchone()
        if not m:
            conn.close()
            self.send_json({"error": "ไม่พบข้อมูลสมาชิก"}, 404)
            return

        fee = m['fee_monthly']
        payments = [m[f'm{i}'] for i in range(1, 13)]
        total_paid_in_action = 0.0

        for mon in months:
            if 1 <= mon <= 12:
                payments[mon-1] = fee
                total_paid_in_action += fee

        q1 = sum(payments[0:3])
        q2 = sum(payments[3:6])
        q3 = sum(payments[6:9])
        q4 = sum(payments[9:12])
        year_total = sum(payments)
        annual_target = fee * 12
        due = max(0.0, annual_target - year_total)
        status = "ชำระครบทั้งปี" if year_total >= annual_target else "ชำระบางส่วน"

        # Update member record
        c.execute("""
            UPDATE members SET
                m1=?, m2=?, m3=?, m4=?, m5=?, m6=?,
                m7=?, m8=?, m9=?, m10=?, m11=?, m12=?,
                q1_total=?, q2_total=?, q3_total=?, q4_total=?,
                year_total=?, due_amount=?, status=?
            WHERE id=?
        """, (*payments, q1, q2, q3, q4, year_total, due, status, member_id))

        # Receipt Number
        receipt_no = f"REC-69-{member_id:03d}-{datetime.now().strftime('%m%d%H%M')}"
        today_thai = datetime.now().strftime('%d/%m/69')
        time_str = datetime.now().strftime('%H.%M')

        # If bank, record bank transaction
        if channel == 'bank':
            c.execute("SELECT balance FROM bank_transactions ORDER BY id DESC LIMIT 1")
            last_bal_row = c.fetchone()
            curr_bal = (last_bal_row[0] if last_bal_row else 54353.55) + total_paid_in_action
            c.execute("""
                INSERT INTO bank_transactions (date, house_no, alley, description, income, expense, balance, transfer_time)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """, (today_thai, m['house_no'], m['alley'], m['name'], total_paid_in_action, 0.0, curr_bal, time_str))

        # Add Audit log
        c.execute("""
            INSERT INTO audit_logs (actor, action, details)
            VALUES (?, ?, ?)
        """, (actor, "RECORD_PAYMENT", f"บันทึกรับเงิน {m['name']} บ้านเลขที่ {m['house_no']} ({m['alley']}) จำนวน {total_paid_in_action:,.2f} บาท เดือน {months} ทาง {channel} (ใบเสร็จ: {receipt_no})"))

        conn.commit()
        conn.close()

        # Sync Payment to Google Sheets (Real-time background sync)
        sync_to_google_sheet("PAYMENT", {
            "receipt_no": receipt_no,
            "member_id": member_id,
            "member_name": m['name'],
            "house_no": m['house_no'],
            "alley": m['alley'],
            "amount": total_paid_in_action,
            "date": today_thai,
            "time": time_str,
            "months": months,
            "channel": channel,
            "new_status": status,
            "remaining_due": due,
            "actor": actor,
            "q1": q1,
            "q2": q2,
            "q3": q3,
            "q4": q4,
            "year_total": year_total,
            "payments": payments
        })

        self.send_json({
            "success": True,
            "receipt_no": receipt_no,
            "member_id": member_id,
            "member_name": m['name'],
            "house_no": m['house_no'],
            "alley": m['alley'],
            "amount": total_paid_in_action,
            "date": today_thai,
            "months": months,
            "channel": channel,
            "new_status": status,
            "remaining_due": due
        })

    def handle_add_expense(self, data):
        conn = get_db()
        c = conn.cursor()
        doc_no = data.get('doc_no', f"EXP-{datetime.now().strftime('%m%d%H%M')}")
        date_str = data.get('date', datetime.now().strftime('%d/%m/69'))
        category = data.get('category', 'ค่าใช้จ่ายทั่วไป')
        title = data.get('title', '')
        amount = float(data.get('amount', 0))
        payee = data.get('payee', '')
        status = data.get('status', 'จ่ายแล้ว')
        actor = data.get('actor', 'เจ้าหน้าที่')

        c.execute("""
            INSERT INTO expenses (doc_no, date, category, title, amount, payee, status)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (doc_no, date_str, category, title, amount, payee, status))

        c.execute("""
            INSERT INTO audit_logs (actor, action, details)
            VALUES (?, ?, ?)
        """, (actor, "ADD_EXPENSE", f"บันทึกรายจ่าย: {title} จำนวน {amount:,.2f} บาท แก่ {payee}"))

        conn.commit()
        conn.close()

        # Sync Expense to Google Sheets (Real-time background sync)
        sync_to_google_sheet("EXPENSE", {
            "doc_no": doc_no,
            "date": date_str,
            "category": category,
            "title": title,
            "amount": amount,
            "payee": payee,
            "status": status,
            "actor": actor
        })

        self.send_json({"success": True, "doc_no": doc_no})

    def handle_sync_sheets(self, data):
        # Triggers full bulk sync to Google Sheets
        conn = get_db()
        c = conn.cursor()
        c.execute("SELECT * FROM members ORDER BY row_no ASC")
        members = [dict(r) for r in c.fetchall()]

        c.execute("SELECT * FROM expenses ORDER BY id ASC")
        expenses = [dict(r) for r in c.fetchall()]

        c.execute("SELECT * FROM bank_transactions ORDER BY id ASC")
        bank = [dict(r) for r in c.fetchall()]
        conn.close()

        if GOOGLE_SHEET_WEBHOOK_URL:
            sync_to_google_sheet("SYNC_ALL", {
                "members": members,
                "expenses": expenses,
                "bank_transactions": bank
            })
            msg = "ส่งคำสั่งซิงก์ข้อมูลทั้งหมดไปยัง Google Sheets เรียบร้อยแล้ว"
        else:
            msg = "ยังไม่ได้ตั้งค่า GOOGLE_SHEET_WEBHOOK_URL (ทำงานในโหมดออฟไลน์)"

        self.send_json({
            "success": True,
            "status": "ready" if GOOGLE_SHEET_WEBHOOK_URL else "configured_local",
            "has_webhook": bool(GOOGLE_SHEET_WEBHOOK_URL),
            "synced_at": datetime.now().strftime('%d/%m/2569 %H:%M:%S'),
            "sheets_available": ["ทะเบียนสมาชิกและการชำระ", "สรุปรายรับแยกงวด", "รายละเอียดค่าใช้จ่าย", "สมุดบัญชีธนาคาร", "งบดุลสรุปภาพรวม"],
            "download_url": "/village_fund_2569.xlsx",
            "message": msg
        })

def run():
    server_address = ('', PORT)
    httpd = ThreadedHTTPServer(server_address, VillageFundHandler)
    print(f"Server started at http://localhost:{PORT}")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping server...")
        httpd.server_close()

if __name__ == "__main__":
    run()
