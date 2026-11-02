import threading
import time

from config import now_th, num
from core.sheets_api import sheet_get, sheet_post


class Visits:
    """สถิติผู้เข้าชม — นับในหน่วยความจำภายใต้ lock (กันชนเมื่อเข้าพร้อมกัน)
    แล้วรวมส่งขึ้นชีต site_stats เป็นชุดๆ ผ่าน Apps Script action 'incr' ซึ่งบวกค่าแบบ atomic ใน script lock
    (บวกเพิ่ม ไม่เขียนทับ จึงไม่ชนกันแม้หลาย instance)"""
    FLUSH_SECONDS = 30

    def __init__(self):
        self.lock = threading.Lock()
        self.totals = {}      # date -> [views, visitors] (ยอดที่รู้ ณ ตอนนี้)
        self.pending = {}     # date -> [views, visitors] (ยังไม่ส่งขึ้นชีต)
        self.loaded = False

    def load(self):
        try:
            rows = sheet_get("site_stats")
            with self.lock:
                base = {r["date"]: [int(num(r.get("views"))), int(num(r.get("visitors")))] for r in rows if r.get("date")}
                for day, (v, u) in self.pending.items():  # ทับด้วยยอดที่ยังไม่ส่ง
                    b = base.setdefault(day, [0, 0])
                    b[0] += v
                    b[1] += u
                self.totals = base
                self.loaded = True
        except Exception as e:
            print(f"visits load error: {e}")

    def hit(self, new_visitor):
        day = now_th().strftime("%Y-%m-%d")
        with self.lock:
            for d_ in (self.totals, self.pending):
                c = d_.setdefault(day, [0, 0])
                c[0] += 1
                c[1] += 1 if new_visitor else 0

    def stats(self):
        day = now_th().strftime("%Y-%m-%d")
        with self.lock:
            t = self.totals.get(day, [0, 0])
            return {"today_views": t[0], "today_visitors": t[1],
                    "total_views": sum(x[0] for x in self.totals.values()),
                    "total_visitors": sum(x[1] for x in self.totals.values())}

    def flush(self):
        with self.lock:
            batch, self.pending = self.pending, {}
        for day, (v, u) in batch.items():
            if not (v or u):
                continue
            try:
                sheet_post(action="incr", table="site_stats", date=day, views=v, visitors=u)
            except Exception as e:
                print(f"visits flush error: {e}")
                with self.lock:  # ส่งไม่สำเร็จ คืนยอดกลับไปรอส่งรอบถัดไป
                    c = self.pending.setdefault(day, [0, 0])
                    c[0] += v
                    c[1] += u

    def loop(self):
        self.load()
        while True:
            time.sleep(self.FLUSH_SECONDS)
            self.flush()
            if not self.loaded:
                self.load()


visits = Visits()
