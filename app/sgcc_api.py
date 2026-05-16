from __future__ import annotations

import hashlib
import json
import time
from dataclasses import dataclass
from datetime import datetime, timedelta
from urllib import error as urlerror
from urllib import parse as urlparse
from urllib import request as urlrequest

from .sgcc_crypto import random_hex, sm2_encrypt_key, sm3_sign, sm4_decrypt, sm4_encrypt


APP_KEY = "7e5b5e84ddad4994b0ebc68dedca4962"
APP_SECRET = "2bc37a881e1541aaa6e6e174658d150b"
BOOT_PUBLIC_KEY = (
    "042D12DFBC179202AC4B7B7BADCDA6FF7B604339263F6AB732CE7107B7EA3830A2"
    "CA714DC303920D3CFF7647D898F1A8CC6C24E9EC3CC194E22D984AF7E16B42DC"
)
BASE_URL = "https://www.95598.cn/api"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"


def compact(data) -> str:
    return json.dumps(data, ensure_ascii=False, separators=(",", ":"))


def clean(value) -> str:
    return str(value or "").strip()


def first_float(*values):
    for value in values:
        if value in (None, ""):
            continue
        try:
            return float(str(value).replace(",", ""))
        except ValueError:
            pass
    return None


def normalize_date(value):
    raw = clean(value)
    if not raw:
        return None
    if len(raw) == 6 and raw.isdigit():
        return f"{raw[:4]}-{raw[4:6]}-01"
    if len(raw) == 8 and raw.isdigit():
        return f"{raw[:4]}-{raw[4:6]}-{raw[6:8]}"
    return raw[:10]


def is_token_error(result: dict) -> bool:
    code = str(result.get("code") or "")
    message = str(result.get("message") or "")
    return code in {"10010", "30010", "20103"} or "Token" in message or "登录态" in message


@dataclass
class SgccApiCollector:
    username: str
    password: str
    daily_days: int = 7

    def __post_init__(self):
        self.key_code = ""
        self.public_key = ""
        self.bizrt = {}
        self.access_token = ""
        self.refresh_token = ""
        self.authorize_code = ""

    @property
    def password_hash(self) -> str:
        value = clean(self.password)
        if len(value) == 32 and all(ch in "0123456789abcdefABCDEF" for ch in value):
            return value.upper()
        return hashlib.md5(value.encode("utf-8")).hexdigest().upper()

    def headers(self, timestamp: int, *, key=False, token=False, authorized=False, form=False) -> dict:
        headers = {
            "Accept": "application/json;charset=UTF-8",
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" if form else "application/json;charset=UTF-8",
            "User-Agent": UA,
            "version": "1.0",
            "source": "0901",
            "timestamp": str(timestamp),
            "wsgwType": "web",
            "appKey": APP_KEY,
            "Origin": "https://www.95598.cn",
            "Referer": "https://www.95598.cn/osgweb/login",
            "sessionId": "web" + str(timestamp),
        }
        if key and self.key_code:
            headers["keyCode"] = self.key_code
        if token and self.bizrt.get("token"):
            headers["token"] = self.bizrt["token"]
        if authorized and self.access_token:
            headers["acctoken"] = self.access_token
        return headers

    def encrypted_body(self, payload: dict, timestamp: int, key: str | None = None, public_key: str | None = None) -> dict:
        key = key or self.key_code
        encrypted = sm4_encrypt(compact(payload), key)
        return {
            "data": encrypted + sm3_sign(encrypted + str(timestamp)),
            "skey": sm2_encrypt_key(key, public_key or self.public_key),
            "timestamp": timestamp,
        }

    def post_raw(self, path: str, *, headers: dict, body: bytes, decrypt_key: str | None = None) -> dict:
        req = urlrequest.Request(BASE_URL + path, method="POST", data=body, headers=headers)
        try:
            with urlrequest.urlopen(req, timeout=35) as resp:
                result = json.loads(resp.read().decode("utf-8", errors="replace"))
        except urlerror.HTTPError as exc:
            raw = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"国网接口 HTTP {exc.code}: {raw[:200]}") from exc
        if "encryptData" in result:
            result = json.loads(sm4_decrypt(result["encryptData"], decrypt_key or self.key_code))
        if "data" in result and isinstance(result["data"], str) and decrypt_key:
            try:
                result["data"] = json.loads(sm4_decrypt(result["data"], decrypt_key))
            except Exception:
                pass
        return result

    def request_key(self) -> dict:
        timestamp = int(time.time() * 1000)
        local_key = random_hex(32)
        payload = {"client_id": APP_KEY, "client_secret": APP_SECRET}
        body = self.encrypted_body(payload, timestamp, key=local_key, public_key=BOOT_PUBLIC_KEY)
        body["client_id"] = APP_KEY
        result = self.post_raw(
            "/oauth2/outer/c02/f02",
            headers=self.headers(timestamp),
            body=json.dumps(body, ensure_ascii=False).encode("utf-8"),
            decrypt_key=local_key,
        )
        if str(result.get("code")) != "1":
            raise RuntimeError(result.get("message") or "国网 keyCode 获取失败")
        self.key_code = result["data"]["keyCode"]
        self.public_key = result["data"]["publicKey"]
        return result

    def login(self) -> dict:
        base_payload = {
            "params": {
                "uscInfo": {"devciceIp": "", "tenant": "state_grid", "member": "0902", "devciceId": ""},
                "quInfo": {
                    "optSys": "android",
                    "pushId": "000000",
                    "addressProvince": "110100",
                    "password": self.password_hash,
                    "addressRegion": "110101",
                    "account": clean(self.username),
                    "addressCity": "330100",
                },
            }
        }
        errors = []
        for complex_type in (None, "clickImg"):
            payload = dict(base_payload)
            if complex_type:
                payload["complexSliderRet"] = 0
                payload["complexSliderType"] = complex_type
            timestamp = int(time.time() * 1000)
            result = self.post_raw(
                "/osg-web0004/open/c44/f06",
                headers=self.headers(timestamp, key=True),
                body=json.dumps(self.encrypted_body(payload, timestamp), ensure_ascii=False).encode("utf-8"),
            )
            bizrt = ((result.get("data") or {}).get("bizrt") if isinstance(result, dict) else None) or {}
            if bizrt and bizrt.get("token"):
                self.bizrt = bizrt
                return result
            errors.append(result.get("message") or result.get("code") or "登录失败")
            if str(result.get("code")) not in {"RK1003", "11401"}:
                break
        raise RuntimeError("国网账号密码登录失败：" + "；".join(map(str, errors)))

    def authorize(self) -> dict:
        timestamp = int(time.time() * 1000)
        payload = {
            "client_id": APP_KEY,
            "response_type": "code",
            "redirect_url": "/test",
            "timestamp": timestamp,
            "rsi": self.bizrt["token"],
        }
        result = self.post_raw(
            "/oauth2/oauth/authorize",
            headers=self.headers(timestamp, key=True, token=True, form=True),
            body=urlparse.urlencode(payload).encode("utf-8"),
            decrypt_key=self.bizrt["token"],
        )
        target = result.get("data") if isinstance(result.get("data"), dict) else result
        redirect = target.get("redirect_url") or target.get("redirectUrl") or ""
        parsed_code = urlparse.parse_qs(urlparse.urlparse(redirect).query).get("code", [""])[0] if redirect else ""
        self.authorize_code = parsed_code or clean(target.get("code") or target.get("authorizeCode"))
        if not self.authorize_code:
            raise RuntimeError("国网授权码获取失败")
        return result

    def web_token(self) -> dict:
        timestamp = int(time.time() * 1000)
        payload = {
            "grant_type": "authorization_code",
            "sign": sm3_sign(APP_KEY + str(timestamp)),
            "client_secret": APP_SECRET,
            "state": "464606a4-184c-4beb-b442-2ab7761d0796",
            "key_code": self.key_code,
            "client_id": APP_KEY,
            "timestamp": timestamp,
            "code": self.authorize_code,
        }
        result = self.post_raw(
            "/oauth2/outer/getWebToken",
            headers=self.headers(timestamp, key=True),
            body=json.dumps(self.encrypted_body(payload, timestamp), ensure_ascii=False).encode("utf-8"),
        )
        data = result.get("data") or {}
        self.access_token = clean(data.get("access_token"))
        self.refresh_token = clean(data.get("refresh_token"))
        if not self.access_token:
            raise RuntimeError(result.get("message") or "国网 WebToken 获取失败")
        return result

    def authorized_body(self, payload: dict, timestamp: int) -> dict:
        wrapper = {
            "_access_token": self.access_token[len(self.access_token) // 2 :],
            "_t": self.bizrt["token"][len(self.bizrt["token"]) // 2 :],
            "_data": payload,
            "timestamp": timestamp,
        }
        return self.encrypted_body(wrapper, timestamp)

    def authorized_post(self, path: str, payload: dict) -> dict:
        timestamp = int(time.time() * 1000)
        headers = self.headers(timestamp, key=True)
        headers["Authorization"] = "Bearer " + self.access_token[: len(self.access_token) // 2]
        headers["t"] = self.bizrt["token"][: len(self.bizrt["token"]) // 2]
        result = self.post_raw(
            path,
            headers=headers,
            body=json.dumps(self.authorized_body(payload, timestamp), ensure_ascii=False).encode("utf-8"),
        )
        if is_token_error(result):
            raise RuntimeError(result.get("message") or "国网登录态失效")
        return result

    def current_user(self) -> dict:
        return (self.bizrt.get("userInfo") or [{}])[0]

    def bind_info(self) -> dict:
        user = self.current_user()
        payload = {
            "serviceCode": "0101183",
            "source": "SGAPP",
            "target": "32101",
            "uscInfo": {"member": "0902", "devciceIp": "", "devciceId": "", "tenant": "state_grid"},
            "quInfo": {"userId": clean(user.get("userId") or user.get("acctId"))},
            "token": self.bizrt["token"],
            "Channels": "web",
        }
        return self.authorized_post("/osg-open-uc0001/member/c9/f02", payload)

    def usage_query(self, power_user: dict, *, daily=False) -> dict:
        user = self.current_user()
        pro_code = clean(power_user.get("proNo") or power_user.get("provinceCode") or power_user.get("codeValue") or "32101")
        cons_type = "02" if clean(power_user.get("consType") or power_user.get("elecTypeCode")) == "02" else "01"
        data = {
            "acctId": clean(user.get("userId") or user.get("acctId")),
            "consNo": clean(power_user.get("consNo_dst") or power_user.get("consNo") or power_user.get("consNoSrc")),
            "consType": cons_type,
            "orgNo": clean(power_user.get("orgNo") or power_user.get("orgNo_dst")),
            "queryYear": datetime.now().year,
            "proCode": pro_code,
            "provinceCode": pro_code,
            "serialNo": "",
            "srvCode": "",
            "userName": clean(user.get("loginAccount") or user.get("realName") or user.get("userName")),
            "funcCode": "WEBALIPAY_01",
            "channelCode": "0902",
            "clearCache": "11",
            "promotCode": "1",
            "promotType": "1",
        }
        if daily:
            end = datetime.now().date() - timedelta(days=1)
            start = end - timedelta(days=max(1, self.daily_days - 1))
            data["startTime"] = start.isoformat()
            data["endTime"] = end.isoformat()
        payload = {
            "params1": {
                "serviceCode": "0101183",
                "source": "SGAPP",
                "target": "32101",
                "uscInfo": {"member": "0902", "devciceIp": "", "devciceId": "", "tenant": "state_grid"},
                "quInfo": {"userId": clean(user.get("userId") or user.get("acctId"))},
                "token": self.bizrt["token"],
            },
            "params3": {"data": data, "serviceCode": "BCP_000026", "source": "app", "target": pro_code},
            "params4": "010103" if daily else "010102",
        }
        return self.authorized_post("/osg-web0004/member/c24/f01", payload)

    def ensure_login(self):
        self.request_key()
        self.login()
        self.authorize()
        self.web_token()

    def collect(self) -> dict:
        self.ensure_login()
        bind_result = self.bind_info()
        user_info = self.current_user()
        power_users = user_info.get("powerUserList") or []
        if not power_users:
            data = bind_result.get("data") if isinstance(bind_result, dict) else None
            if isinstance(data, dict):
                power_users = data.get("powerUserList") or data.get("userInfo") or []
            elif isinstance(data, list):
                power_users = data
        if not power_users:
            raise RuntimeError("国网未查询到绑定户号")
        bills = []
        daily_rows = []
        for power_user in power_users:
            monthly = self.usage_query(power_user)
            daily = self.usage_query(power_user, daily=True)
            for row in ((monthly.get("data") or {}).get("mothEleList") or []):
                amount = first_float(row.get("totalEleCost"), row.get("charge"), row.get("amount"), row.get("totalCost"))
                usage = first_float(row.get("totalEleNum"), row.get("eleNum"), row.get("pq"))
                if amount is None:
                    continue
                bills.append({
                    "statementDate": normalize_date(row.get("ym") or row.get("month") or row.get("date")),
                    "usageValue": usage,
                    "usageUnit": "kWh" if usage is not None else None,
                    "amount": amount,
                    "sourceChannel": "95598.cn-api",
                    "recordType": "bill",
                    "status": "confirmed",
                    "raw": row,
                })
            for row in ((daily.get("data") or {}).get("sevenEleList") or []):
                date = normalize_date(row.get("day") or row.get("date") or row.get("ymd"))
                usage = first_float(row.get("dayElePq"), row.get("thisPPq"))
                if not date or usage is None:
                    continue
                daily_rows.append({
                    "usageDate": date,
                    "usageValue": usage,
                    "usageUnit": "kWh",
                    "amount": None,
                    "raw": row,
                })
        return {"bills": bills, "daily": daily_rows, "message": f"国网采集成功：月账单 {len(bills)} 条，日用电 {len(daily_rows)} 条"}
