import json
import urllib.parse
import urllib.request
from config import API_KEY, SCRIPT_URL


def _call(req):
    return json.loads(urllib.request.urlopen(req, timeout=45).read().decode("utf-8"))


def sheet_get(table):
    if not SCRIPT_URL or not API_KEY:
        return []
    q = urllib.parse.urlencode({"key": API_KEY, "table": table})
    r = _call(urllib.request.Request(SCRIPT_URL + "?" + q))
    if not r.get("ok"):
        raise RuntimeError(f"{table}: {r.get('error')}")
    return r["rows"]


def sheet_get_many(tables):
    if not SCRIPT_URL or not API_KEY:
        return {}
    q = urllib.parse.urlencode({"key": API_KEY, "tables": ",".join(tables)})
    r = _call(urllib.request.Request(SCRIPT_URL + "?" + q))
    if r.get("ok") and "data" in r:
        return r["data"]
    return {t: sheet_get(t) for t in tables}


def sheet_post(**payload):
    if not SCRIPT_URL or not API_KEY:
        return {"ok": False, "error": "No APPS_SCRIPT_URL"}
    payload["key"] = API_KEY
    r = _call(urllib.request.Request(SCRIPT_URL, data=json.dumps(payload).encode("utf-8"),
                                     headers={"Content-Type": "text/plain;charset=utf-8"}))
    if not r.get("ok"):
        raise RuntimeError(r.get("error"))
    return r
