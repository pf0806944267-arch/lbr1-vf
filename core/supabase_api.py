"""
Supabase API Client for Village Fund System
Direct replacement for Google Sheets API (sub-50ms query, ACID reliability, Storage integration)
"""
import base64
import json
import os
import urllib.parse
import urllib.request
from config import SUPABASE_KEY, SUPABASE_URL

HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json"
}


def _call(url, data=None, headers=None, method="GET"):
    h = dict(HEADERS)
    if headers:
        h.update(headers)
    req = urllib.request.Request(
        url,
        data=json.dumps(data).encode("utf-8") if (data is not None and not isinstance(data, (bytes, bytearray))) else data,
        headers=h,
        method=method
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            content = resp.read()
            if content:
                try:
                    return json.loads(content.decode("utf-8"))
                except Exception:
                    return content.decode("utf-8")
            return None
    except Exception as e:
        print(f"Supabase {method} error on {url}: {e}")
        return None


def sheet_get(table):
    """Fetch all rows from a Supabase table with automatic pagination"""
    if not SUPABASE_URL or not SUPABASE_KEY:
        return []
    all_rows = []
    page_size = 1000
    start = 0
    while True:
        end = start + page_size - 1
        url = f"{SUPABASE_URL}/rest/v1/{table}?select=*"
        headers = {"Range": f"{start}-{end}"}
        try:
            res = _call(url, headers=headers, method="GET")
            if not res or not isinstance(res, list):
                break
            all_rows.extend(res)
            if len(res) < page_size:
                break
            start += page_size
        except Exception as e:
            print(f"Supabase GET error on {table} range {start}-{end}: {e}")
            break
    return all_rows


def sheet_get_many(tables):
    """Fetch rows for multiple tables from Supabase"""
    data = {}
    for t in tables:
        data[t] = sheet_get(t)
    return data


def sheet_insert_many(table, rows):
    """Batch insert rows into a Supabase table with upsert/merge capability"""
    if not SUPABASE_URL or not SUPABASE_KEY or not rows:
        return {"ok": False, "count": 0}
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    headers = {"Prefer": "resolution=merge-duplicates"}
    chunk_size = 100
    total = 0
    for i in range(0, len(rows), chunk_size):
        chunk = rows[i:i + chunk_size]
        _call(url, data=chunk, headers=headers, method="POST")
        total += len(chunk)
    return {"ok": True, "count": total}


def upload_slip_to_storage(data_b64, filename, mime_type="image/jpeg"):
    """Upload slip directly to Supabase Storage bucket 'slips' and return public URL"""
    if "," in str(data_b64):
        data_b64 = str(data_b64).split(",", 1)[1]
    raw_bytes = base64.b64decode(data_b64)

    # Clean filename
    safe_name = filename.replace(" ", "_")
    url = f"{SUPABASE_URL}/storage/v1/object/slips/{safe_name}"

    headers = {
        "Content-Type": mime_type or "image/jpeg",
        "x-upsert": "true"
    }

    _call(url, data=raw_bytes, headers=headers, method="POST")

    public_url = f"{SUPABASE_URL}/storage/v1/object/public/slips/{safe_name}"
    return {
        "ok": True,
        "url": public_url,
        "direct_url": public_url,
        "file_name": safe_name
    }


def sheet_post(**payload):
    """Unified handler for database operations (compatible with previous sheets_api interface)"""
    action = payload.get("action")

    # 1. Upload slip
    if action == "upload_slip":
        return upload_slip_to_storage(
            data_b64=payload.get("data"),
            filename=payload.get("filename", "slip.jpg"),
            mime_type=payload.get("mimeType", "image/jpeg")
        )

    table = payload.get("table")
    if not table:
        return {"ok": False, "error": "Table required"}

    # 2. Append / Insert row
    if action == "append":
        row = payload.get("row", {})
        # Type cleanup
        clean_row = {}
        for k, v in row.items():
            if v == "" and k in ("paid_date", "expense_date", "date", "category_id", "from_date", "to_date", "expense_id"):
                clean_row[k] = None
            elif k in ("amount_paid", "amount", "amount_due", "opening_balance", "opening_reserve", "monthly_amount") and v is not None:
                try:
                    clean_row[k] = float(str(v).replace(",", ""))
                except Exception:
                    clean_row[k] = 0.0
            elif k in ("month", "period", "year_be", "sort_order", "views", "visitors") and v is not None:
                try:
                    clean_row[k] = int(v)
                except Exception:
                    clean_row[k] = 0
            elif k == "active":
                clean_row[k] = True if str(v).upper() == "Y" else False
            else:
                clean_row[k] = v

        url = f"{SUPABASE_URL}/rest/v1/{table}"
        _call(url, data=[clean_row], method="POST")
        return {"ok": True}

    # 3. Delete row
    if action == "delete":
        id_col = payload.get("idCol", "id")
        rid = payload.get("id")
        encoded_id = urllib.parse.quote(str(rid))
        url = f"{SUPABASE_URL}/rest/v1/{table}?{id_col}=eq.{encoded_id}"
        _call(url, method="DELETE")
        return {"ok": True}

    # 4. Update row
    if action == "update":
        id_col = payload.get("idCol", "id")
        rid = payload.get("id")
        patch = payload.get("patch", {})
        encoded_id = urllib.parse.quote(str(rid))
        url = f"{SUPABASE_URL}/rest/v1/{table}?{id_col}=eq.{encoded_id}"
        _call(url, data=patch, method="PATCH")
        return {"ok": True}

    # 5. Increment daily stats
    if action == "incr":
        date_str = str(payload.get("date"))
        v = int(payload.get("views", 0))
        u = int(payload.get("visitors", 0))

        # Check existing
        url_check = f"{SUPABASE_URL}/rest/v1/site_stats?date=eq.{date_str}"
        existing = _call(url_check, method="GET")
        if existing and len(existing) > 0:
            cur_views = existing[0].get("views", 0) + v
            cur_visitors = existing[0].get("visitors", 0) + u
            _call(url_check, data={"views": cur_views, "visitors": cur_visitors}, method="PATCH")
        else:
            _call(f"{SUPABASE_URL}/rest/v1/site_stats", data=[{"date": date_str, "views": v, "visitors": u}], method="POST")
        return {"ok": True}

    return {"ok": False, "error": f"Unknown action: {action}"}
