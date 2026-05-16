from __future__ import annotations

import json
import os
import sqlite3
from datetime import datetime, timedelta
from pathlib import Path


def now_iso() -> str:
    return datetime.now().replace(microsecond=0).isoformat()


def today_key() -> str:
    return datetime.now().strftime("%Y-%m-%d")


def default_db_path() -> Path:
    return Path(os.environ.get("APP_DATA_DIR", "/data")) / "home-utility-ledger.db"


def connect(db_path: str | Path | None = None) -> sqlite3.Connection:
    path = Path(db_path) if db_path else default_db_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        probe = path.parent / ".write-test"
        probe.write_text("ok", encoding="utf-8")
        probe.unlink(missing_ok=True)
    except OSError as exc:
        raise RuntimeError(f"数据目录不可写：{path.parent}") from exc
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    migrate(conn)
    seed(conn)
    return conn


def migrate(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS sessions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          token TEXT NOT NULL UNIQUE,
          username TEXT NOT NULL,
          expires_at TEXT NOT NULL,
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS accounts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          utility_type TEXT NOT NULL UNIQUE,
          provider_name TEXT NOT NULL,
          display_name TEXT NOT NULL,
          account_no TEXT,
          status TEXT NOT NULL DEFAULT 'not_configured',
          session_payload TEXT NOT NULL DEFAULT '{}',
          last_test_at TEXT,
          last_test_status TEXT,
          last_test_message TEXT,
          last_collected_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS bills (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          utility_type TEXT NOT NULL,
          account_id INTEGER NOT NULL,
          statement_date TEXT NOT NULL,
          period_start TEXT,
          period_end TEXT,
          usage_value REAL,
          usage_unit TEXT,
          amount REAL NOT NULL,
          source_channel TEXT NOT NULL,
          record_type TEXT NOT NULL DEFAULT 'bill',
          status TEXT NOT NULL DEFAULT 'confirmed',
          raw_json TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL,
          UNIQUE(account_id, utility_type, statement_date, amount, source_channel),
          FOREIGN KEY(account_id) REFERENCES accounts(id)
        );

        CREATE TABLE IF NOT EXISTS daily_usage (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          utility_type TEXT NOT NULL,
          account_id INTEGER NOT NULL,
          usage_date TEXT NOT NULL,
          usage_value REAL,
          usage_unit TEXT,
          amount REAL,
          raw_json TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL,
          UNIQUE(account_id, utility_type, usage_date),
          FOREIGN KEY(account_id) REFERENCES accounts(id)
        );

        CREATE TABLE IF NOT EXISTS jobs (
          utility_type TEXT PRIMARY KEY,
          enabled INTEGER NOT NULL DEFAULT 1,
          schedule_time TEXT NOT NULL DEFAULT '07:30',
          last_run_at TEXT,
          last_status TEXT,
          last_message TEXT,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS collection_runs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          utility_type TEXT NOT NULL,
          run_date TEXT NOT NULL,
          trigger_type TEXT NOT NULL DEFAULT 'scheduled',
          status TEXT NOT NULL DEFAULT 'running',
          message TEXT NOT NULL DEFAULT '',
          bills_inserted INTEGER NOT NULL DEFAULT 0,
          daily_inserted INTEGER NOT NULL DEFAULT 0,
          started_at TEXT NOT NULL,
          finished_at TEXT,
          UNIQUE(utility_type, run_date)
        );

        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          level TEXT NOT NULL,
          module TEXT NOT NULL,
          message TEXT NOT NULL,
          details TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL
        );
        """
    )
    conn.commit()


def seed(conn: sqlite3.Connection) -> None:
    providers = {
        "electricity": ("国网浙江电力", "家庭电费"),
        "water": ("杭州市水务", "家庭水费"),
        "gas": ("杭州天然气", "家庭燃气"),
    }
    for utility_type, (provider_name, display_name) in providers.items():
        conn.execute(
            """
            INSERT OR IGNORE INTO accounts
              (utility_type, provider_name, display_name, status, created_at, updated_at)
            VALUES (?, ?, ?, 'not_configured', ?, ?)
            """,
            (utility_type, provider_name, display_name, now_iso(), now_iso()),
        )
        conn.execute(
            """
            INSERT OR IGNORE INTO jobs
              (utility_type, enabled, schedule_time, updated_at)
            VALUES (?, 1, '07:30', ?)
            """,
            (utility_type, now_iso()),
        )
    conn.execute(
        """
        INSERT OR IGNORE INTO settings (key, value, updated_at)
        VALUES ('wecom_webhook', '', ?), ('push_daily_summary', 'true', ?), ('push_failure_alert', 'true', ?)
        """,
        (now_iso(), now_iso(), now_iso()),
    )
    conn.commit()


def row_to_dict(row: sqlite3.Row | None) -> dict | None:
    return dict(row) if row else None


def json_loads(text: str | None, fallback=None):
    if not text:
        return {} if fallback is None else fallback
    try:
        return json.loads(text)
    except Exception:
        return {} if fallback is None else fallback


def list_accounts(conn: sqlite3.Connection) -> list[dict]:
    rows = conn.execute("SELECT * FROM accounts ORDER BY id").fetchall()
    out = []
    for row in rows:
        item = dict(row)
        payload = json_loads(item.pop("session_payload"), {})
        item["configured"] = bool(payload)
        item["sessionSummary"] = summarize_payload(item["utility_type"], payload)
        item["authStatus"] = account_auth_status(item, payload)
        item["localData"] = local_data_status(conn, item["utility_type"])
        out.append(item)
    return out


def get_account(conn: sqlite3.Connection, utility_type: str) -> dict:
    row = conn.execute("SELECT * FROM accounts WHERE utility_type = ?", (utility_type,)).fetchone()
    if not row:
        raise ValueError("unknown utility type")
    item = dict(row)
    item["session_payload"] = json_loads(item.get("session_payload"), {})
    return item


def summarize_payload(utility_type: str, payload: dict) -> dict:
    if utility_type == "electricity":
        return {
            "mode": payload.get("mode") or ("browser_state" if (payload.get("getterHits") or payload.get("result")) else ""),
            "hasLoginState": bool(payload.get("getterHits") or payload.get("result") or payload.get("mode") == "web_login"),
            "accountNo": payload.get("displayAccount") or payload.get("accountNo") or payload.get("consNo") or "",
        }
    if utility_type == "water":
        return {
            "meterNumber": payload.get("meterNumber") or payload.get("cardNos") or "",
            "hasSession": bool(payload.get("token")),
        }
    if utility_type == "gas":
        return {
            "userNo": payload.get("userNo") or "",
            "orgId": payload.get("orgId") or "",
            "hasSession": bool(payload.get("cookieHeader")),
        }
    return {}


def parse_iso(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return None


def account_auth_status(item: dict, payload: dict) -> dict:
    if not payload:
        return {
            "authorizedAt": "",
            "expiresAt": "",
            "expiresText": "尚未接入",
            "hint": "请先导入登录信息。",
            "needsReauth": True,
        }

    utility_type = item.get("utility_type")
    authorized_at = payload.get("_authorizedAt") or item.get("updated_at") or ""
    authorized_dt = parse_iso(authorized_at)
    last_failed = item.get("last_test_status") == "error"

    if utility_type == "electricity":
        if payload.get("mode") == "web_login":
            return {
                "authorizedAt": authorized_at,
                "expiresAt": "",
                "expiresText": "自动登录",
                "hint": "已保存账号密码，采集时会自动登录国网页面。",
                "needsReauth": last_failed,
            }
        expires_dt = authorized_dt + timedelta(hours=12) if authorized_dt else None
        expired = bool(expires_dt and expires_dt <= datetime.now())
        needs_reauth = expired or last_failed
        return {
            "authorizedAt": authorized_at,
            "expiresAt": expires_dt.isoformat(timespec="seconds") if expires_dt else "",
            "expiresText": "约 12 小时内有效",
            "hint": "国网登录状态有效期较短，失败或过期后请重新导入。",
            "needsReauth": needs_reauth,
        }

    return {
        "authorizedAt": authorized_at,
        "expiresAt": "",
        "expiresText": "失效后重新导入",
        "hint": "当前登录信息已保存，若采集失败请重新导入。",
        "needsReauth": last_failed,
    }


def update_account_session(conn: sqlite3.Connection, utility_type: str, payload: dict, account_no: str = "") -> None:
    status = "configured" if payload else "not_configured"
    if payload:
        payload = dict(payload)
        payload["_authorizedAt"] = now_iso()
    conn.execute(
        """
        UPDATE accounts
        SET session_payload = ?, account_no = COALESCE(NULLIF(?, ''), account_no),
            status = ?, last_test_at = NULL, last_test_status = NULL,
            last_test_message = NULL, updated_at = ?
        WHERE utility_type = ?
        """,
        (json.dumps(payload, ensure_ascii=False), account_no, status, now_iso(), utility_type),
    )
    conn.commit()


def update_account_test(conn: sqlite3.Connection, utility_type: str, ok: bool, message: str) -> None:
    conn.execute(
        """
        UPDATE accounts
        SET last_test_at = ?, last_test_status = ?, last_test_message = ?, status = ?, updated_at = ?
        WHERE utility_type = ?
        """,
        (now_iso(), "success" if ok else "error", message, "ok" if ok else "error", now_iso(), utility_type),
    )
    conn.commit()


def mark_collected(conn: sqlite3.Connection, utility_type: str, ok: bool, message: str) -> None:
    conn.execute(
        """
        UPDATE accounts SET last_collected_at = ?, status = ?, updated_at = ?
        WHERE utility_type = ?
        """,
        (now_iso(), "ok" if ok else "error", now_iso(), utility_type),
    )
    conn.execute(
        """
        UPDATE jobs SET last_run_at = ?, last_status = ?, last_message = ?, updated_at = ?
        WHERE utility_type = ?
        """,
        (now_iso(), "success" if ok else "error", message, now_iso(), utility_type),
    )
    conn.commit()


def get_collection_run(conn: sqlite3.Connection, utility_type: str, run_date: str | None = None) -> dict | None:
    row = conn.execute(
        """
        SELECT * FROM collection_runs
        WHERE utility_type = ? AND run_date = ?
        """,
        (utility_type, run_date or today_key()),
    ).fetchone()
    return row_to_dict(row)


def start_collection_run(conn: sqlite3.Connection, utility_type: str, trigger_type: str = "scheduled") -> dict:
    run_date = today_key()
    existing = get_collection_run(conn, utility_type, run_date)
    if existing:
        return existing
    now = now_iso()
    conn.execute(
        """
        INSERT INTO collection_runs
          (utility_type, run_date, trigger_type, status, message, started_at)
        VALUES (?, ?, ?, 'running', '', ?)
        """,
        (utility_type, run_date, trigger_type, now),
    )
    conn.commit()
    return get_collection_run(conn, utility_type, run_date) or {}


def finish_collection_run(
    conn: sqlite3.Connection,
    utility_type: str,
    ok: bool,
    message: str,
    bills_inserted: int = 0,
    daily_inserted: int = 0,
) -> None:
    conn.execute(
        """
        UPDATE collection_runs
        SET status = ?, message = ?, bills_inserted = ?, daily_inserted = ?, finished_at = ?
        WHERE utility_type = ? AND run_date = ?
        """,
        (
            "success" if ok else "error",
            message,
            int(bills_inserted or 0),
            int(daily_inserted or 0),
            now_iso(),
            utility_type,
            today_key(),
        ),
    )
    conn.commit()


def local_data_status(conn: sqlite3.Connection, utility_type: str) -> dict:
    bill_row = conn.execute(
        """
        SELECT COUNT(*) total, MAX(statement_date) latest_date
        FROM bills
        WHERE utility_type = ?
        """,
        (utility_type,),
    ).fetchone()
    daily_row = conn.execute(
        """
        SELECT COUNT(*) total, MAX(usage_date) latest_date
        FROM daily_usage
        WHERE utility_type = ?
        """,
        (utility_type,),
    ).fetchone()
    today_run = get_collection_run(conn, utility_type)
    return {
        "billCount": int(bill_row["total"] or 0) if bill_row else 0,
        "latestBillDate": bill_row["latest_date"] if bill_row and bill_row["latest_date"] else "",
        "dailyCount": int(daily_row["total"] or 0) if daily_row else 0,
        "latestDailyDate": daily_row["latest_date"] if daily_row and daily_row["latest_date"] else "",
        "todayRun": today_run,
    }


def insert_log(conn: sqlite3.Connection, level: str, module: str, message: str, details=None) -> None:
    conn.execute(
        "INSERT INTO logs(level, module, message, details, created_at) VALUES (?, ?, ?, ?, ?)",
        (level, module, message, json.dumps(details or {}, ensure_ascii=False), now_iso()),
    )
    conn.commit()


def list_logs(conn: sqlite3.Connection, limit: int = 80) -> list[dict]:
    rows = conn.execute(
        """
        SELECT id, level, module, message, details, created_at
        FROM logs
        ORDER BY id DESC
        LIMIT ?
        """,
        (max(1, min(int(limit or 80), 200)),),
    ).fetchall()
    out = []
    for row in rows:
        item = dict(row)
        item["details"] = json_loads(item.get("details"), {})
        out.append(item)
    return out


def upsert_bill(conn: sqlite3.Connection, account_id: int, utility_type: str, bill: dict) -> bool:
    cur = conn.execute(
        """
        INSERT OR IGNORE INTO bills
          (utility_type, account_id, statement_date, period_start, period_end, usage_value,
           usage_unit, amount, source_channel, record_type, status, raw_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            utility_type,
            account_id,
            bill.get("statementDate"),
            bill.get("periodStart"),
            bill.get("periodEnd"),
            bill.get("usageValue"),
            bill.get("usageUnit"),
            float(bill.get("amount") or 0),
            bill.get("sourceChannel") or utility_type,
            bill.get("recordType") or "bill",
            bill.get("status") or "confirmed",
            json.dumps(bill.get("raw") or {}, ensure_ascii=False),
            now_iso(),
        ),
    )
    return cur.rowcount > 0


def upsert_daily(conn: sqlite3.Connection, account_id: int, utility_type: str, row: dict) -> bool:
    cur = conn.execute(
        """
        INSERT INTO daily_usage
          (utility_type, account_id, usage_date, usage_value, usage_unit, amount, raw_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(account_id, utility_type, usage_date)
        DO UPDATE SET usage_value=excluded.usage_value, amount=excluded.amount, raw_json=excluded.raw_json
        """,
        (
            utility_type,
            account_id,
            row.get("usageDate"),
            row.get("usageValue"),
            row.get("usageUnit"),
            row.get("amount"),
            json.dumps(row.get("raw") or {}, ensure_ascii=False),
            now_iso(),
        ),
    )
    return cur.rowcount > 0


def get_settings(conn: sqlite3.Connection) -> dict:
    rows = conn.execute("SELECT key, value FROM settings").fetchall()
    jobs = conn.execute("SELECT * FROM jobs ORDER BY utility_type").fetchall()
    return {
        **{row["key"]: row["value"] for row in rows},
        "jobs": [dict(row) for row in jobs],
    }


def update_settings(conn: sqlite3.Connection, data: dict) -> None:
    for key in ("wecom_webhook", "push_daily_summary", "push_failure_alert"):
        if key in data:
            conn.execute(
                """
                INSERT INTO settings(key, value, updated_at) VALUES(?, ?, ?)
                ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at
                """,
                (key, str(data.get(key) or ""), now_iso()),
            )
    for job in data.get("jobs") or []:
        if job.get("utility_type") in {"electricity", "water", "gas"}:
            conn.execute(
                "UPDATE jobs SET enabled=?, schedule_time=?, updated_at=? WHERE utility_type=?",
                (1 if job.get("enabled") else 0, job.get("schedule_time") or "07:30", now_iso(), job["utility_type"]),
            )
    conn.commit()


def create_session(conn: sqlite3.Connection, username: str, token: str, ttl_hours=168) -> None:
    conn.execute(
        "INSERT INTO sessions(token, username, expires_at, created_at) VALUES (?, ?, ?, ?)",
        (token, username, (datetime.now() + timedelta(hours=ttl_hours)).isoformat(), now_iso()),
    )
    conn.commit()


def get_session(conn: sqlite3.Connection, token: str) -> dict | None:
    row = conn.execute("SELECT * FROM sessions WHERE token = ?", (token,)).fetchone()
    if not row:
        return None
    item = dict(row)
    if datetime.fromisoformat(item["expires_at"]) < datetime.now():
        conn.execute("DELETE FROM sessions WHERE token = ?", (token,))
        conn.commit()
        return None
    return item


def delete_session(conn: sqlite3.Connection, token: str) -> None:
    conn.execute("DELETE FROM sessions WHERE token = ?", (token,))
    conn.commit()


def overview(conn: sqlite3.Connection) -> dict:
    accounts = list_accounts(conn)
    current_month = conn.execute(
        """
        SELECT utility_type, COALESCE(SUM(amount), 0) amount, COALESCE(SUM(usage_value), 0) usage
        FROM bills
        WHERE substr(statement_date, 1, 7) = strftime('%Y-%m', 'now', 'localtime')
        GROUP BY utility_type
        """
    ).fetchall()
    latest = conn.execute(
        """
        SELECT b.*
        FROM bills b
        JOIN (
          SELECT utility_type, MAX(statement_date) statement_date
          FROM bills
          GROUP BY utility_type
        ) x ON x.utility_type = b.utility_type AND x.statement_date = b.statement_date
        WHERE b.id IN (
          SELECT MAX(id)
          FROM bills
          GROUP BY utility_type, statement_date
        )
        ORDER BY b.utility_type
        """
    ).fetchall()
    current_by_type = {row["utility_type"]: {"amount": row["amount"], "usage": row["usage"]} for row in current_month}
    latest_by_type = {
        row["utility_type"]: {
            "amount": row["amount"],
            "usage": row["usage_value"] or 0,
            "statementDate": row["statement_date"],
        }
        for row in latest
    }
    recent = conn.execute(
        """
        SELECT * FROM (
          SELECT *,
                 ROW_NUMBER() OVER (PARTITION BY utility_type ORDER BY statement_date DESC, id DESC) rn
          FROM bills
        )
        WHERE rn <= 4
        ORDER BY statement_date DESC, id DESC
        LIMIT 12
        """
    ).fetchall()
    bills_by_type = conn.execute(
        """
        SELECT * FROM (
          SELECT *,
                 ROW_NUMBER() OVER (PARTITION BY utility_type ORDER BY statement_date DESC, id DESC) rn
          FROM bills
        )
        WHERE rn <= 240
        ORDER BY utility_type, statement_date DESC, id DESC
        """
    ).fetchall()
    daily = conn.execute(
        "SELECT * FROM daily_usage ORDER BY usage_date DESC LIMIT 14"
    ).fetchall()
    grouped_bills = {"electricity": [], "water": [], "gas": []}
    for row in bills_by_type:
        grouped_bills.setdefault(row["utility_type"], []).append(dict(row))
    return {
        "accounts": accounts,
        "summary": current_by_type,
        "latestSummary": latest_by_type,
        "recentBills": [dict(row) for row in recent],
        "billsByType": grouped_bills,
        "dailyUsage": [dict(row) for row in daily],
    }


def analytics(conn: sqlite3.Connection, period: str = "month", start: str = "", end: str = "") -> dict:
    date_expr = {
        "day": "statement_date",
        "month": "substr(statement_date, 1, 7)",
        "quarter": "substr(statement_date, 1, 4) || '-Q' || ((cast(substr(statement_date, 6, 2) as integer)+2)/3)",
        "year": "substr(statement_date, 1, 4)",
    }.get(period, "statement_date")
    where = []
    params = []
    if start:
        where.append("statement_date >= ?")
        params.append(start)
    if end:
        where.append("statement_date <= ?")
        params.append(end)
    where_sql = "WHERE " + " AND ".join(where) if where else ""
    rows = conn.execute(
        f"""
        SELECT {date_expr} bucket, utility_type, SUM(amount) amount, SUM(COALESCE(usage_value, 0)) usage
        FROM bills {where_sql}
        GROUP BY bucket, utility_type ORDER BY bucket
        """,
        params,
    ).fetchall()
    return {"period": period, "rows": [dict(row) for row in rows]}
