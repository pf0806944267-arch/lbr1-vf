import os
import re

from flask import Blueprint, Response, jsonify, request, send_from_directory

from config import ROOT, now_th
from services.calculations import houses_view, summary
from services.store import store
from services.visits import visits

public_bp = Blueprint("public", __name__)
BOT_RE = re.compile(r"bot|crawl|spider|slurp|monitor|uptime|curl|python-requests|render", re.I)


@public_bp.get("/")
def index():
    return send_from_directory(os.path.join(ROOT, "static"), "index.html")


@public_bp.get("/staff")
def staff_page():
    return send_from_directory(os.path.join(ROOT, "static"), "staff.html")


@public_bp.get("/static/<path:p>")
def static_files(p):
    return send_from_directory(os.path.join(ROOT, "static"), p)


@public_bp.get("/healthz")
def health():
    return jsonify(ok=store.error is None, error=store.error, version=store.version)


@public_bp.post("/api/visit")
def api_visit():
    """นับการเข้าชม 1 ครั้งต่อการเปิดหน้า; นับ 'ผู้เข้าชม' 1 ครั้งต่อเบราว์เซอร์ต่อวัน (ใช้คุกกี้)"""
    today = now_th().strftime("%Y-%m-%d")
    counted = not BOT_RE.search(request.headers.get("User-Agent", ""))
    new_visitor = request.cookies.get("fvd") != today
    if counted:
        visits.hit(new_visitor)
    resp = jsonify(visits.stats())
    if counted and new_visitor:
        resp.set_cookie("fvd", today, max_age=60 * 60 * 24 * 2, samesite="Lax")
    return resp


@public_bp.get("/api/visits")
def api_visits():
    return jsonify(visits.stats())


@public_bp.get("/api/dashboard")
def api_dashboard():
    return jsonify(summary())


@public_bp.get("/api/houses")
def api_houses():
    return jsonify(houses_view(full=False))


@public_bp.get("/api/stream")
def api_stream():
    def gen():
        last = -1
        yield "retry: 5000\n\n"
        while True:
            with store.cond:
                if store.version == last:
                    store.cond.wait(timeout=25)
                v = store.version
            if v != last:
                last = v
                yield f"event: update\ndata: {v}\n\n"
            else:
                yield ": keep-alive\n\n"
    return Response(gen(), mimetype="text/event-stream",
                    headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
