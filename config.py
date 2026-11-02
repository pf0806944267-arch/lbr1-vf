import datetime as dt
import os
import re

ROOT = os.path.dirname(os.path.abspath(__file__))


def load_env():
    p = os.path.join(ROOT, ".env")
    if os.path.exists(p):
        for line in open(p, encoding="utf-8"):
            if "=" in line and not line.strip().startswith("#"):
                k, v = line.strip().split("=", 1)
                os.environ.setdefault(k, v)


load_env()
SCRIPT_URL = os.environ.get("APPS_SCRIPT_URL", "")
API_KEY = os.environ.get("API_KEY", "")
SECRET = os.environ.get("SESSION_SECRET") or (API_KEY + "-session" if API_KEY else "secret-fund-2569")
FY = int(os.environ.get("FISCAL_YEAR", "2569"))
REFRESH_SECONDS = int(os.environ.get("REFRESH_SECONDS", "60"))
TABLES = ["fiscal_years", "zones", "fee_rates", "houses", "members", "house_members", "dues", "payments",
          "expense_categories", "expenses", "reserve_transactions", "other_income", "users", "audit_log"]
MONTH_TH = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."]
PERIOD_NAMES = [
    "งวดที่ 1 (ม.ค. - มี.ค.)",
    "งวดที่ 2 (เม.ย. - มิ.ย.)",
    "งวดที่ 3 (ก.ค. - ก.ย.)",
    "งวดที่ 4 (ต.ค. - ธ.ค.)"
]
INCOME_TYPES = {"donation": "เงินบริจาค", "interest": "ดอกเบี้ยเงินฝาก",
                "support": "เงินสนับสนุน", "other": "รายได้ทางอื่นๆ"}


def now_th():
    return dt.datetime.utcnow() + dt.timedelta(hours=7)


def num(v, default=0.0):
    try:
        return float(str(v).replace(",", ""))
    except (TypeError, ValueError):
        return default


def mask_name(full):
    parts = re.sub(r"^\s*คุณ\s*", "", full or "").split()
    if len(parts) <= 1:
        return parts[0] if parts else "-"
    return " ".join(parts[:-1]) + " " + parts[-1][0] + "."
