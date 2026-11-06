import csv
import json
import os
import threading
import time

from config import SUPABASE_KEY, SUPABASE_URL, REFRESH_SECONDS, ROOT, TABLES
from core.sheets_api import sheet_get_many


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


def save_table_to_csv(table, rows):
    p = os.path.join(ROOT, "data", table + ".csv")
    if not rows:
        return
    try:
        h = list(rows[0].keys())
        with open(p, "w", encoding="utf-8-sig", newline="") as f:
            w = csv.writer(f)
            w.writerow(h)
            for r in rows:
                w.writerow([r.get(col, "") for col in h])
    except Exception as err:
        print(f"save cache error {table}: {err}")


def append_to_csv(table, row):
    p = os.path.join(ROOT, "data", table + ".csv")
    try:
        exists = os.path.exists(p) and os.path.getsize(p) > 0
        if not exists:
            with open(p, "w", encoding="utf-8-sig", newline="") as f:
                w = csv.writer(f)
                w.writerow(list(row.keys()))
                w.writerow([row.get(k, "") for k in row.keys()])
            return

        with open(p, "r", encoding="utf-8-sig", newline="") as f:
            reader = csv.reader(f)
            header = next(reader, [])

        new_keys = [k for k in row.keys() if k not in header]
        if new_keys:
            with open(p, "r", encoding="utf-8-sig", newline="") as f:
                all_rows = list(csv.reader(f))
            header = all_rows[0] + new_keys
            with open(p, "w", encoding="utf-8-sig", newline="") as f:
                w = csv.writer(f)
                w.writerow(header)
                for r in all_rows[1:]:
                    w.writerow(r + [""] * len(new_keys))

        with open(p, "a", encoding="utf-8-sig", newline="") as f:
            w = csv.writer(f)
            w.writerow([row.get(k, "") for k in header])
    except Exception as e:
        print(f"append_to_csv error {table}: {e}")


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
            if not SUPABASE_URL or not SUPABASE_KEY:
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
