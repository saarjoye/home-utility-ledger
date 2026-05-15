from __future__ import annotations

import hashlib
import json
import os
import secrets
import threading
import time
from datetime import datetime
from http import cookies
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from . import collectors
from .db import (
    analytics,
    connect,
    create_session,
    delete_session,
    get_account,
    get_session,
    get_settings,
    insert_log,
    list_accounts,
    mark_collected,
    overview,
    update_account_session,
    update_account_test,
    update_settings,
    upsert_bill,
    upsert_daily,
)


ROOT = Path(__file__).resolve().parent.parent
PUBLIC = ROOT / "public"
COOKIE_NAME = "hul_session"


def admin_user() -> str:
    return os.environ.get("ADMIN_USERNAME", "admin")


def admin_password_hash() -> str:
    password = os.environ.get("ADMIN_PASSWORD", "admin123456")
    return hashlib.sha256(password.encode("utf-8")).hexdigest()


def json_dumps(data) -> bytes:
    return json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def read_body(handler: BaseHTTPRequestHandler) -> bytes:
    length = int(handler.headers.get("content-length") or 0)
    return handler.rfile.read(length) if length else b""


def parse_json_body(handler: BaseHTTPRequestHandler) -> dict:
    raw = read_body(handler)
    if not raw:
        return {}
    return json.loads(raw.decode("utf-8"))


def run_collect_for(conn, utility_type: str) -> dict:
    account = get_account(conn, utility_type)
    payload = account["session_payload"]
    if not payload:
        raise RuntimeError("该渠道尚未接入，请先完成导入")
    result = collectors.collect(utility_type, payload)
    inserted = 0
    daily_count = 0
    for bill in result.get("bills") or []:
        if bill.get("statementDate") and bill.get("amount") is not None:
            inserted += 1 if upsert_bill(conn, account["id"], utility_type, bill) else 0
    for row in result.get("daily") or []:
        if row.get("usageDate"):
            daily_count += 1 if upsert_daily(conn, account["id"], utility_type, row) else 0
    message = result.get("message") or f"采集完成：新增账单 {inserted} 条"
    mark_collected(conn, utility_type, True, message)
    insert_log(conn, "info", f"{utility_type}-collector", message, {"inserted": inserted, "daily": daily_count})
    return {"ok": True, "message": message, "inserted": inserted, "daily": daily_count}


def scheduler_loop():
    while True:
        try:
            conn = connect()
            settings = get_settings(conn)
            now_hm = datetime.now().strftime("%H:%M")
            for job in settings.get("jobs") or []:
                if job.get("enabled") and job.get("schedule_time") == now_hm:
                    try:
                        run_collect_for(conn, job["utility_type"])
                    except Exception as exc:
                        mark_collected(conn, job["utility_type"], False, str(exc))
                        insert_log(conn, "error", f"{job['utility_type']}-collector", str(exc))
            conn.close()
        except Exception:
            pass
        time.sleep(60)


class Handler(BaseHTTPRequestHandler):
    server_version = "HomeUtilityLedger/1.0"

    def db(self):
        return connect()

    def respond(self, status: int, body: bytes, content_type="text/plain; charset=utf-8", headers=None):
        self.send_response(status)
        self.send_header("content-type", content_type)
        for key, value in (headers or {}).items():
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(body)

    def json(self, status: int, data):
        self.respond(status, json_dumps(data), "application/json; charset=utf-8")

    def redirect(self, location: str):
        self.respond(302, b"", headers={"Location": location})

    def token(self) -> str:
        jar = cookies.SimpleCookie(self.headers.get("Cookie"))
        morsel = jar.get(COOKIE_NAME)
        return morsel.value if morsel else ""

    def authed(self) -> bool:
        token = self.token()
        if not token:
            return False
        conn = self.db()
        try:
            return bool(get_session(conn, token))
        finally:
            conn.close()

    def require_auth(self) -> bool:
        if self.authed():
            return True
        if self.path.startswith("/api/"):
            self.json(401, {"ok": False, "message": "未登录"})
        else:
            self.redirect("/login.html")
        return False

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        if path == "/":
            return self.redirect("/index.html")
        if path == "/admin":
            return self.redirect("/admin.html")
        if path == "/analytics":
            return self.redirect("/analytics.html")
        if path == "/healthz":
            return self.json(200, {"ok": True, "app": "home-utility-ledger-standalone", "version": "standalone-2026.05.15.4"})
        if path == "/api/me":
            return self.json(200, {"ok": True, "authenticated": self.authed()})
        if path == "/login.html":
            return self.serve_static("login.html")
        if path.endswith(".css") or path.endswith(".js") or path.startswith("/assets/"):
            return self.serve_static(path.lstrip("/"))
        if path.startswith("/api/") and not self.require_auth():
            return
        if path == "/api/overview":
            conn = self.db()
            try:
                return self.json(200, {"ok": True, "data": overview(conn)})
            finally:
                conn.close()
        if path == "/api/analytics":
            query = parse_qs(parsed.query)
            conn = self.db()
            try:
                return self.json(200, {"ok": True, "data": analytics(conn, (query.get("period") or ["month"])[0], (query.get("start") or [""])[0], (query.get("end") or [""])[0])})
            finally:
                conn.close()
        if path == "/api/accounts":
            conn = self.db()
            try:
                return self.json(200, {"ok": True, "data": list_accounts(conn)})
            finally:
                conn.close()
        if path == "/api/settings":
            conn = self.db()
            try:
                return self.json(200, {"ok": True, "data": get_settings(conn)})
            finally:
                conn.close()
        if path.endswith(".html"):
            if path != "/login.html" and not self.require_auth():
                return
            return self.serve_static(path.lstrip("/"))
        return self.respond(404, b"Not Found")

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path
        if path == "/api/login":
            data = parse_json_body(self)
            if data.get("username") == admin_user() and hashlib.sha256(str(data.get("password") or "").encode("utf-8")).hexdigest() == admin_password_hash():
                token = secrets.token_urlsafe(32)
                conn = self.db()
                try:
                    create_session(conn, admin_user(), token)
                finally:
                    conn.close()
                self.respond(200, json_dumps({"ok": True}), "application/json; charset=utf-8", {"Set-Cookie": f"{COOKIE_NAME}={token}; Path=/; HttpOnly; SameSite=Lax"})
                return
            return self.json(401, {"ok": False, "message": "账号或密码错误"})
        if path == "/api/logout":
            token = self.token()
            conn = self.db()
            try:
                if token:
                    delete_session(conn, token)
            finally:
                conn.close()
            self.respond(200, json_dumps({"ok": True}), "application/json; charset=utf-8", {"Set-Cookie": f"{COOKIE_NAME}=; Path=/; Max-Age=0"})
            return
        if not self.require_auth():
            return
        try:
            if path == "/api/import/electricity":
                data = parse_json_body(self)
                payload = collectors.import_sgcc_state(data.get("content") or "")
                conn = self.db()
                try:
                    update_account_session(conn, "electricity", payload, payload.get("accountNo") or "")
                    return self.json(200, {"ok": True, "message": "国网登录状态已导入", "summary": {"accountNo": payload.get("accountNo")}})
                finally:
                    conn.close()
            if path == "/api/import/water":
                data = parse_json_body(self)
                payload = collectors.import_water_har(data.get("content") or "")
                conn = self.db()
                try:
                    update_account_session(conn, "water", payload, payload.get("meterNumber") or payload.get("cardNos") or "")
                    return self.json(200, {"ok": True, "message": "杭水抓包文件已导入", "summary": {"meterNumber": payload.get("meterNumber") or payload.get("cardNos")}})
                finally:
                    conn.close()
            if path == "/api/import/gas":
                data = parse_json_body(self)
                payload = collectors.import_gas_har(data.get("content") or "")
                conn = self.db()
                try:
                    update_account_session(conn, "gas", payload, payload.get("userNo") or "")
                    return self.json(200, {"ok": True, "message": "燃气抓包文件已导入", "summary": {"userNo": payload.get("userNo"), "orgId": payload.get("orgId")}})
                finally:
                    conn.close()
            if path.startswith("/api/test/"):
                utility_type = path.rsplit("/", 1)[-1]
                conn = self.db()
                try:
                    result = run_collect_for(conn, utility_type)
                    update_account_test(conn, utility_type, True, result["message"])
                    return self.json(200, result)
                except Exception as exc:
                    update_account_test(conn, utility_type, False, str(exc))
                    return self.json(400, {"ok": False, "message": str(exc)})
                finally:
                    conn.close()
            if path.startswith("/api/collect/"):
                utility_type = path.rsplit("/", 1)[-1]
                conn = self.db()
                try:
                    return self.json(200, run_collect_for(conn, utility_type))
                except Exception as exc:
                    mark_collected(conn, utility_type, False, str(exc))
                    return self.json(400, {"ok": False, "message": str(exc)})
                finally:
                    conn.close()
            if path == "/api/settings":
                data = parse_json_body(self)
                conn = self.db()
                try:
                    update_settings(conn, data)
                    return self.json(200, {"ok": True, "message": "配置已保存"})
                finally:
                    conn.close()
        except Exception as exc:
            return self.json(400, {"ok": False, "message": str(exc)})
        return self.respond(404, b"Not Found")

    def serve_static(self, rel_path: str):
        safe = Path(rel_path).as_posix().lstrip("/")
        target = (PUBLIC / safe).resolve()
        if not str(target).startswith(str(PUBLIC.resolve())) or not target.exists() or target.is_dir():
            return self.respond(404, b"Not Found")
        mime = {
            ".html": "text/html; charset=utf-8",
            ".css": "text/css; charset=utf-8",
            ".js": "application/javascript; charset=utf-8",
            ".png": "image/png",
            ".svg": "image/svg+xml",
        }.get(target.suffix, "application/octet-stream")
        self.respond(200, target.read_bytes(), mime)


def main():
    host = os.environ.get("HOST", "0.0.0.0")
    port = int(os.environ.get("PORT", "3000"))
    threading.Thread(target=scheduler_loop, daemon=True).start()
    httpd = ThreadingHTTPServer((host, port), Handler)
    print(f"Home Utility Ledger listening on http://{host}:{port}")
    httpd.serve_forever()


if __name__ == "__main__":
    main()
