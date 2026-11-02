import csv
import json
import os
import threading
import time

from config import API_KEY, REFRESH_SECONDS, ROOT, SCRIPT_URL, TABLES
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
