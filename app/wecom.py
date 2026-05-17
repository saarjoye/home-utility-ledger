from __future__ import annotations

import json
import urllib.parse
import urllib.request
from datetime import datetime, timedelta


TOKEN_CACHE: dict[str, object] = {"token": "", "expires_at": datetime.min}

WECOM_API_BASE = "https://qyapi.weixin.qq.com"


class WeComError(RuntimeError):
    pass


def base_url(settings: dict) -> str:
    relay = (settings.get("wecom_relay_url") or "").strip().rstrip("/")
    return relay or WECOM_API_BASE


def enabled(settings: dict) -> bool:
    return bool(settings.get("wecom_corp_id") and settings.get("wecom_agent_id") and settings.get("wecom_secret"))


def send_text(settings: dict, content: str) -> dict:
    if not enabled(settings):
        return {"ok": False, "skipped": True, "message": "企业微信应用未配置"}
    token = access_token(settings)
    payload = {
        "touser": settings.get("wecom_to_user") or "@all",
        "msgtype": "text",
        "agentid": int(settings.get("wecom_agent_id") or 0),
        "text": {"content": content[:2000]},
        "safe": 0,
    }
    url = f"{base_url(settings)}/cgi-bin/message/send?access_token={urllib.parse.quote(token)}"
    data = request_json(url, payload=payload)
    if int(data.get("errcode") or 0) != 0:
        raise WeComError(mask_error(data))
    return {"ok": True, "message": "企业微信应用消息已发送"}


def access_token(settings: dict) -> str:
    cached_token = TOKEN_CACHE.get("token")
    expires_at = TOKEN_CACHE.get("expires_at")
    if cached_token and isinstance(expires_at, datetime) and expires_at > datetime.now() + timedelta(minutes=5):
        return str(cached_token)
    query = urllib.parse.urlencode({
        "corpid": settings.get("wecom_corp_id") or "",
        "corpsecret": settings.get("wecom_secret") or "",
    })
    data = request_json(f"{base_url(settings)}/cgi-bin/gettoken?{query}")
    if int(data.get("errcode") or 0) != 0 or not data.get("access_token"):
        raise WeComError(mask_error(data))
    TOKEN_CACHE["token"] = data["access_token"]
    TOKEN_CACHE["expires_at"] = datetime.now() + timedelta(seconds=int(data.get("expires_in") or 7200))
    return str(data["access_token"])


def request_json(url: str, payload: dict | None = None) -> dict:
    body = None
    headers = {"User-Agent": "home-utility-ledger/1.0"}
    if payload is not None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        headers["Content-Type"] = "application/json; charset=utf-8"
    req = urllib.request.Request(url, data=body, headers=headers, method="POST" if payload is not None else "GET")
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read().decode("utf-8"))


def mask_error(data: dict) -> str:
    code = data.get("errcode")
    msg = str(data.get("errmsg") or "企业微信接口请求失败")
    for marker in ("access_token", "secret", "corpsecret"):
        msg = msg.replace(marker, "[masked]")
    return f"企业微信应用推送失败：{code} {msg}" if code is not None else f"企业微信应用推送失败：{msg}"
