from __future__ import annotations

import json
import re
import time
from datetime import datetime
from urllib.parse import parse_qs, unquote_plus, urlencode, urlparse

from urllib import request as urlrequest

from .sgcc_crypto import sm2_encrypt_key, sm3_sign, sm4_decrypt, sm4_encrypt


def clean(value) -> str:
    return str(value or "").strip()


def load_json_text(text):
    if isinstance(text, (dict, list)):
        return text
    text = str(text or "").strip()
    candidates = [text, unquote_plus(text)]
    if (text.startswith('"') and text.endswith('"')) or (text.startswith("'") and text.endswith("'")):
        try:
            candidates.append(json.loads(text))
        except Exception:
            candidates.append(text[1:-1])
    json_object_match = re.search(r"(\{[\s\S]*\})", text)
    if json_object_match:
        candidates.append(json_object_match.group(1))
    for candidate in candidates:
        candidate = str(candidate or "").strip()
        try:
            parsed = json.loads(candidate)
            if isinstance(parsed, str):
                nested = parsed.strip()
                if nested.startswith("{") or nested.startswith("["):
                    return json.loads(nested)
            return parsed
        except Exception:
            pass
    return None


def http_json(method: str, url: str, *, headers=None, body=None, timeout=30):
    req = urlrequest.Request(url, method=method.upper(), headers=headers or {}, data=body)
    with urlrequest.urlopen(req, timeout=timeout) as resp:
        raw = resp.read().decode("utf-8", errors="replace")
    try:
        return json.loads(raw)
    except Exception as exc:
        raise RuntimeError(f"接口返回非 JSON：{raw[:200]}") from exc


def normalize_date(value):
    raw = clean(value)
    if not raw:
        return None
    if re.fullmatch(r"\d{6}", raw):
        return f"{raw[:4]}-{raw[4:6]}-01"
    if re.fullmatch(r"\d{6}00", raw):
        return f"{raw[:4]}-{raw[4:6]}-01"
    if re.fullmatch(r"\d{8}", raw):
        return f"{raw[:4]}-{raw[4:6]}-{raw[6:8]}"
    match = re.match(r"^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})", raw)
    if match:
        return f"{match.group(1)}-{match.group(2).zfill(2)}-{match.group(3).zfill(2)}"
    return raw[:10]


def first_float(*values):
    for value in values:
        if value in (None, ""):
            continue
        try:
            return float(str(value).replace(",", ""))
        except ValueError:
            pass
    return None


def parse_har_entries(har_text) -> list[dict]:
    data = load_json_text(har_text)
    if not isinstance(data, dict):
        raise ValueError("抓包文件不是有效 JSON/HAR")
    return ((data.get("log") or {}).get("entries") or []) if "log" in data else []


def extract_request_para(text: str) -> dict:
    if not text:
        return {}
    parsed = parse_qs(text, keep_blank_values=True)
    if "requestPara" in parsed:
        value = load_json_text(parsed["requestPara"][-1])
        return value if isinstance(value, dict) else {}
    value = load_json_text(text)
    return value if isinstance(value, dict) else {}


def import_water_har(har_text: str) -> dict:
    candidate = None
    for entry in parse_har_entries(har_text):
        req = entry.get("request") or {}
        url = clean(req.get("url"))
        if "wx.hzwgc.com" not in url:
            continue
        body = ((req.get("postData") or {}).get("text")) or ""
        para = extract_request_para(body)
        if not para:
            para = extract_request_para(urlparse(url).query)
        if para.get("token"):
            candidate = para
            if para.get("cardNos") or para.get("meterNumber"):
                break
    if not candidate:
        raise ValueError("未识别到杭水 e 家有效登录信息，请确认抓包包含账单或水表页面")
    return {
        "token": clean(candidate.get("token")),
        "UNID": clean(candidate.get("UNID")),
        "waterCorpId": int(candidate.get("waterCorpId") or 3),
        "areaId": int(candidate.get("areaId") or 0),
        "accountType": clean(candidate.get("accountType") or "XJ"),
        "apiType": clean(candidate.get("apiType") or "WX"),
        "appVersion": clean(candidate.get("appVersion") or "1.0.2"),
        "cardNos": clean(candidate.get("cardNos") or candidate.get("cardNo") or candidate.get("meterNumber")),
        "meterNumber": clean(candidate.get("meterNumber") or candidate.get("cardNo") or candidate.get("cardNos")),
    }


def cookie_from_request(req: dict) -> str:
    for item in req.get("headers") or []:
        if clean(item.get("name")).lower() == "cookie":
            return clean(item.get("value"))
    return ""


def import_gas_har(har_text: str) -> dict:
    session = {"cookieHeader": "", "userNo": "", "orgId": ""}
    for entry in parse_har_entries(har_text):
        req = entry.get("request") or {}
        resp = entry.get("response") or {}
        url = clean(req.get("url"))
        if "ht-service.hzgas.cn" not in url:
            continue
        if not session["cookieHeader"]:
            session["cookieHeader"] = cookie_from_request(req)
        combined = "\n".join([
            url,
            ((req.get("postData") or {}).get("text")) or "",
            ((resp.get("content") or {}).get("text")) or "",
        ])
        if not session["userNo"]:
            match = re.search(r'"(?:userNo|userno|accountNo)"\s*:\s*"([^"]+)"|[?&](?:userNo|userno)=([^&#]+)', combined, re.I)
            if match:
                session["userNo"] = clean(match.group(1) or match.group(2))
        if not session["orgId"]:
            match = re.search(r'"orgId"\s*:\s*"?(9901|\d+)"?', combined, re.I)
            if match:
                session["orgId"] = clean(match.group(1))
    if not session["cookieHeader"]:
        raise ValueError("未识别到杭州天然气登录信息，请确认抓包包含公众号账单查询页")
    return session


def import_sgcc_state(text) -> dict:
    data = load_json_text(text)
    if not isinstance(data, dict):
        raise ValueError("导入内容不是有效 JSON")
    value = ((data.get("result") or {}).get("value")) if isinstance(data.get("result"), dict) else data
    getter_hits = value.get("getterHits") if isinstance(value, dict) else None
    if not isinstance(getter_hits, dict):
        raise ValueError("未识别到国网登录状态，请在国网页面执行导出脚本后粘贴完整内容")
    merge_sgcc_request_templates(getter_hits, value)
    user_info = (getter_hits.get("getUserInfo") or [{}])[0]
    power_user = (user_info.get("powerUserList") or [{}])[0]
    payload = {
        "getterHits": getter_hits,
        "accountNo": clean(power_user.get("consNo_dst") or power_user.get("eleCustNumber") or power_user.get("consNo")),
        "displayAccount": clean(power_user.get("consNo_dst") or power_user.get("elecAddr_dst") or "已识别登录状态"),
        "consNo": clean(power_user.get("consNo_dst") or power_user.get("consNo")),
    }
    required = ["getRequestCyu", "getAccessToken", "getToken", "getRequestParams"]
    missing = [key for key in required if not getter_hits.get(key)]
    if missing:
        raise ValueError(f"国网登录状态缺少必要字段：{', '.join(missing)}")
    return payload


def merge_sgcc_request_templates(getter_hits: dict, source: dict) -> None:
    existing = getter_hits.get("getRequestParams")
    if not isinstance(existing, list):
        existing = []
    found_codes = {
        str((((item or {}).get("requestBody") if isinstance(item, dict) else None) or item or {}).get("params4") or "")
        for item in existing
        if isinstance(item, dict)
    }
    missing_codes = {"010102", "010103"} - found_codes
    if not missing_codes:
        getter_hits["getRequestParams"] = existing
        return
    templates = []
    for template in deep_find_sgcc_templates(source):
        code = str(template.get("params4") or "")
        if code in missing_codes:
            templates.append({"requestBody": template})
            missing_codes.remove(code)
        if not missing_codes:
            break
    getter_hits["getRequestParams"] = existing + templates


def deep_find_sgcc_templates(source):
    seen = set()
    out = []

    def walk(value, depth=0):
        if depth > 12 or len(out) > 20:
            return
        if isinstance(value, str):
            stripped = value.strip()
            if stripped.startswith("{") or stripped.startswith("["):
                parsed = load_json_text(stripped)
                if parsed is not None:
                    walk(parsed, depth + 1)
            return
        if isinstance(value, list):
            for item in value:
                walk(item, depth + 1)
            return
        if not isinstance(value, dict):
            return
        body = value.get("requestBody") if isinstance(value.get("requestBody"), dict) else value
        code = str(body.get("params4") or "") if isinstance(body, dict) else ""
        if code in {"010102", "010103"}:
            key = code + ":" + json.dumps(body, ensure_ascii=False, sort_keys=True)[:500]
            if key not in seen:
                seen.add(key)
                out.append(body)
        for item in value.values():
            walk(item, depth + 1)

    walk(source)
    return out


def sgcc_auth(payload: dict) -> dict:
    hits = payload["getterHits"]
    request_params = hits["getRequestParams"]
    month_template = find_sgcc_request_template(request_params, "010102")
    daily_template = find_sgcc_request_template(request_params, "010103")
    return {
        "keyCode": hits["getRequestCyu"]["data"]["keyCode"],
        "publicKey": hits["getRequestCyu"]["data"]["publicKey"],
        "accessToken": hits["getAccessToken"]["data"]["access_token"],
        "refreshToken": hits["getAccessToken"]["data"].get("refresh_token"),
        "token": hits["getToken"],
        "userInfo": (hits.get("getUserInfo") or [{}])[0],
        "monthTemplate": month_template,
        "dailyTemplate": daily_template,
    }


def find_sgcc_request_template(request_params, params4: str) -> dict:
    if not isinstance(request_params, list):
        raise ValueError("国网登录状态中的请求模板格式不正确，请重新导入登录信息")
    for item in request_params:
        if not isinstance(item, dict):
            continue
        body = item.get("requestBody") if isinstance(item.get("requestBody"), dict) else item
        if isinstance(body, dict) and str(body.get("params4") or "") == params4:
            return body
    raise ValueError(f"国网登录状态缺少接口模板 {params4}，请在国网电费账单页面重新执行导出脚本")


def sgcc_month_payload(template: dict) -> dict:
    if not isinstance(template, dict):
        raise ValueError("国网月账单请求模板格式不正确，请重新导入登录信息")
    if isinstance(template.get("params3"), dict):
        return template["params3"]
    if "params3" in template and template.get("params3") is not None:
        return {"params3": template.get("params3")}
    return template


def compact(data) -> str:
    return json.dumps(data, ensure_ascii=False, separators=(",", ":"))


def sgcc_wrap(auth: dict, payload: dict):
    timestamp = int(time.time() * 1000)
    wrapper = {
        "_access_token": auth["accessToken"][len(auth["accessToken"]) // 2 :],
        "_t": auth["token"][len(auth["token"]) // 2 :],
        "_data": payload,
        "timestamp": timestamp,
    }
    encrypted = sm4_encrypt(compact(wrapper), auth["keyCode"])
    body = {
        "data": encrypted + sm3_sign(encrypted + str(timestamp)),
        "skey": sm2_encrypt_key(auth["keyCode"], auth["publicKey"]),
        "timestamp": str(timestamp),
    }
    return timestamp, body


def sgcc_headers(auth: dict, timestamp: int):
    return {
        "Accept": "application/json;charset=UTF-8",
        "Content-Type": "application/json;charset=UTF-8",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "version": "1.0",
        "source": "0901",
        "timestamp": str(timestamp),
        "wsgwType": "web",
        "appKey": "7e5b5e84ddad4994b0ebc68dedca4962",
        "keyCode": auth["keyCode"],
        "Authorization": "Bearer " + auth["accessToken"][: len(auth["accessToken"]) // 2],
        "t": auth["token"][: len(auth["token"]) // 2],
    }


def sgcc_post(api_path: str, auth: dict, payload: dict) -> dict:
    timestamp, body = sgcc_wrap(auth, payload)
    data = json.dumps(body).encode("utf-8")
    result = http_json(
        "POST",
        "https://www.95598.cn/api" + api_path,
        headers=sgcc_headers(auth, timestamp),
        body=data,
        timeout=35,
    )
    if "encryptData" in result:
        return json.loads(sm4_decrypt(result["encryptData"], auth["keyCode"]))
    return result


def collect_sgcc(payload: dict) -> dict:
    auth = sgcc_auth(payload)
    month_result = sgcc_post("/osg-open-bc0001/member/c01/f02", auth, sgcc_month_payload(auth["monthTemplate"]))
    daily_result = sgcc_post("/osg-web0004/member/c24/f01", auth, auth["dailyTemplate"])
    if str(month_result.get("code")) != "1":
        raise RuntimeError(month_result.get("message") or "国网月账单接口返回失败")
    if str(daily_result.get("code")) != "1":
        raise RuntimeError(daily_result.get("message") or "国网日用电接口返回失败")
    bills = []
    data = month_result.get("data") or {}
    for row in data.get("mothEleList") or []:
        month = clean(row.get("ym") or row.get("month") or row.get("date"))
        amount = first_float(row.get("totalEleCost"), row.get("charge"), row.get("amount"), row.get("totalCost"))
        usage = first_float(row.get("totalEleNum"), row.get("eleNum"), row.get("pq"))
        if not month or amount is None:
            continue
        bills.append({
            "statementDate": normalize_date(month),
            "usageValue": usage,
            "usageUnit": "kWh" if usage is not None else None,
            "amount": amount,
            "sourceChannel": "95598.cn",
            "recordType": "bill",
            "status": "confirmed",
            "raw": row,
        })
    daily = []
    for row in ((daily_result.get("data") or {}).get("sevenEleList") or []):
        date = normalize_date(row.get("day") or row.get("date") or row.get("ymd"))
        usage = first_float(row.get("dayElePq"), row.get("thisPPq"))
        if not date or usage is None:
            continue
        daily.append({
            "usageDate": date,
            "usageValue": usage,
            "usageUnit": "kWh",
            "amount": None,
            "raw": row,
        })
    return {"bills": bills, "daily": daily, "message": f"国网采集成功：月账单 {len(bills)} 条，日用电 {len(daily)} 条"}


def water_request(session: dict, method: str, path: str, payload: dict) -> dict:
    base_url = "https://wx.hzwgc.com"
    headers = {
        "Accept": "application/json, text/plain, */*",
        "Origin": base_url,
        "Referer": "https://servicewechat.com/wxc186bfd92b18f575/37/page-frame.html",
        "User-Agent": "Mozilla/5.0 MicroMessenger/8.0 HomeUtilityLedger",
    }
    request_para = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    if method.upper() == "GET":
        url = f"{base_url}{path}?{urlencode({'requestPara': request_para})}"
        return http_json("GET", url, headers={**headers, "Content-Type": "application/json"}, timeout=30)
    body = urlencode({"requestPara": request_para}).encode("utf-8")
    return http_json("POST", f"{base_url}{path}", headers={**headers, "Content-Type": "application/x-www-form-urlencoded"}, body=body, timeout=30)


def water_payload(session: dict, extra=None):
    data = {
        "UNID": clean(session.get("UNID")),
        "waterCorpId": int(session.get("waterCorpId") or 3),
        "areaId": int(session.get("areaId") or 0),
        "accountType": clean(session.get("accountType") or "XJ"),
        "apiType": clean(session.get("apiType") or "WX"),
        "appVersion": clean(session.get("appVersion") or "1.0.2"),
        "token": clean(session.get("token")),
    }
    if extra:
        data.update(extra)
    return data


def collect_water(session: dict) -> dict:
    card = clean(session.get("cardNos") or session.get("meterNumber"))
    if not session.get("token"):
        raise RuntimeError("杭水登录信息已缺失，请重新导入抓包文件")
    meter_info = water_request(session, "GET", "/iwater/meter/getMyMeterInfo.json", water_payload(session))
    if not card:
        data = meter_info.get("data") or []
        if data:
            card = clean(data[0].get("clientId") or data[0].get("cardNos") or data[0].get("meterNumber"))
    if not card:
        raise RuntimeError("未能识别水表号，请重新导入包含账单页的抓包文件")
    year = datetime.now().year
    bill_list = water_request(
        session,
        "POST",
        "/iwater/invoice/queryBillList.json",
        water_payload(session, {"cardNos": card, "type": 1, "startMonth": f"{year}01", "endMonth": f"{year}12", "state": ""}),
    )
    if "data" not in bill_list:
        raise RuntimeError(bill_list.get("msg") or bill_list.get("message") or "杭水账单接口返回异常")
    bills = []
    for row in bill_list.get("data") or []:
        amount = first_float(row.get("feeMoney"), row.get("amount"))
        if amount is None:
            continue
        bills.append({
            "statementDate": normalize_date(row.get("feeDate") or row.get("writeOffDate") or row.get("feeMonth")),
            "periodStart": normalize_date(row.get("preCopyDate")),
            "periodEnd": normalize_date(row.get("thisCopyDate")),
            "usageValue": first_float(row.get("practicalWater")),
            "usageUnit": "m3",
            "amount": amount,
            "sourceChannel": "wx.hzwgc.com",
            "recordType": "bill",
            "status": row.get("feeStateStr") or "confirmed",
            "raw": row,
        })
    return {"bills": bills, "daily": [], "message": f"杭水采集成功：账单 {len(bills)} 条"}


def gas_request(session: dict, path: str, query: dict, referer="https://ht-service.hzgas.cn/web/ui/index") -> dict:
    base_url = "https://ht-service.hzgas.cn"
    url = f"{base_url}{path}?{urlencode({k: v for k, v in query.items() if v not in (None, '')})}"
    headers = {
        "Accept": "application/json, text/plain, */*",
        "Origin": base_url,
        "Referer": referer,
        "User-Agent": "Mozilla/5.0 HomeUtilityLedger",
        "Cookie": clean(session.get("cookieHeader")),
    }
    data = http_json("GET", url, headers=headers, timeout=30)
    if str(data.get("status")) != "200":
        raise RuntimeError(data.get("message") or "杭州天然气接口返回失败")
    return data


def collect_gas(session: dict) -> dict:
    user_no = clean(session.get("userNo") or session.get("accountNo"))
    if not session.get("cookieHeader"):
        raise RuntimeError("燃气登录信息已缺失，请重新导入抓包文件")
    if not user_no:
        raise RuntimeError("未识别燃气户号，请重新导入包含账单页的抓包文件")
    base_info = gas_request(session, "/OnlineService/transferSystem/userBaseInfo", {"userNo": user_no, "orgId": clean(session.get("orgId"))})
    bills = []
    for state in ("12", "11", "41"):
        result = gas_request(session, "/OnlineService/transferSystem/queryUserBill", {"userno": user_no, "state": state, "limit": 100})
        for row in result.get("data") or []:
            amount = first_float(row.get("payableAmt"), row.get("amount1"), row.get("amount2"), row.get("amount3"))
            if amount is None:
                continue
            bills.append({
                "statementDate": normalize_date(row.get("readPeriod") or row.get("realReadDate") or row.get("payTime")),
                "usageValue": first_float(row.get("billingQty"), row.get("billingQty1"), row.get("billingQty2"), row.get("billingQty3")),
                "usageUnit": "m3",
                "amount": amount,
                "sourceChannel": "ht-service.hzgas.cn",
                "recordType": "bill",
                "status": "confirmed" if state == "12" else "pending",
                "raw": row,
            })
    return {"bills": bills, "daily": [], "message": f"燃气采集成功：账单 {len(bills)} 条", "details": {"baseInfo": base_info.get("data")}}


def collect(utility_type: str, payload: dict) -> dict:
    if utility_type == "electricity":
        return collect_sgcc(payload)
    if utility_type == "water":
        return collect_water(payload)
    if utility_type == "gas":
        return collect_gas(payload)
    raise ValueError("unknown utility type")
