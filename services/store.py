import csv
import json
import os
import threading
import time

from config import SUPABASE_KEY, SUPABASE_URL, REFRESH_SECONDS, ROOT, TABLES
from core.sheets_api import sheet_get_many


def load_local_cache():
    return {t: [] for t in TABLES}


def save_table_to_csv(table, rows):
    pass


def append_to_csv(table, row):
    pass


class Store:
    def __init__(self):
        self.data = {t: [] for t in TABLES}
        self.version = 1
        self.digest = None
        self.cond = threading.Condition()
        self.write_lock = threading.Lock()
        self.error = None
        try:
            self.refresh()
        except Exception as e:
            self.error = str(e)

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
        except Exception as e:
            self.error = str(e)

    def loop(self):
        while True:
            time.sleep(REFRESH_SECONDS)
            self.refresh()


store = Store()
