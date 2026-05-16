from __future__ import annotations

import base64
import io
import re
import zipfile
from datetime import date, datetime, timedelta
from xml.etree import ElementTree as ET


NS_MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
NS_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
NS_PACKAGE_REL = "http://schemas.openxmlformats.org/package/2006/relationships"


SHEETS = {
    "daily_usage": "日用电",
    "monthly_bills": "月账单",
    "annual_summary": "年度汇总",
    "bill_details": "账单详情",
}


def template_rows(sample: bool = True) -> dict[str, list[list[object]]]:
    rows = {
        "daily_usage": [
            ["日期", "用电量(度)", "费用(元)", "峰用电(度)", "谷用电(度)", "平用电(度)", "尖用电(度)", "备注"],
        ],
        "monthly_bills": [
            ["账单月份", "账期开始", "账期结束", "用电量(度)", "电费(元)", "户号", "来源"],
        ],
        "annual_summary": [
            ["年份", "年用电量(度)", "年电费(元)", "户号", "备注"],
        ],
        "bill_details": [
            ["账单月份", "模块", "项目", "数值", "单位", "备注"],
        ],
    }
    if sample:
        rows["daily_usage"].append(["2026-05-15", 10.88, "", 6.92, 3.97, 0, 0, "日费用为空表示国网页面暂未出账"])
        rows["monthly_bills"].append(["2026-04", "2026-04-01", "2026-04-30", 209, 96.03, "", "国网页面导入"])
        rows["annual_summary"].append(["2026", 1111, 526.61, "", "年度累计"])
        rows["bill_details"].extend(
            [
                ["2026-04", "账单信息", "账期", "2026-04-01 至 2026-04-30", "", ""],
                ["2026-04", "本月电费", "本期电费", 96.03, "元", ""],
                ["2026-05", "分时用电", "2026-05-15 峰用电", 6.92, "度", ""],
                ["2026", "阶梯电量", "年度累计用电", 1111, "度", ""],
            ]
        )
    return rows


def write_xlsx(sheets: dict[str, list[list[object]]]) -> bytes:
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("[Content_Types].xml", _content_types(len(sheets)))
        zf.writestr("_rels/.rels", _root_rels())
        zf.writestr("xl/workbook.xml", _workbook_xml([SHEETS.get(key, key) for key in sheets]))
        zf.writestr("xl/_rels/workbook.xml.rels", _workbook_rels(len(sheets)))
        for idx, rows in enumerate(sheets.values(), start=1):
            zf.writestr(f"xl/worksheets/sheet{idx}.xml", _worksheet_xml(rows))
    return out.getvalue()


def parse_base64_xlsx(content_base64: str) -> dict[str, list[dict[str, str]]]:
    if not content_base64:
        raise ValueError("没有收到 Excel 文件内容")
    if "," in content_base64 and content_base64.split(",", 1)[0].startswith("data:"):
        content_base64 = content_base64.split(",", 1)[1]
    try:
        raw = base64.b64decode(content_base64, validate=False)
    except Exception as exc:
        raise ValueError("Excel 文件内容无法解析") from exc
    return parse_xlsx(raw)


def parse_xlsx(raw: bytes) -> dict[str, list[dict[str, str]]]:
    try:
        zf = zipfile.ZipFile(io.BytesIO(raw))
    except zipfile.BadZipFile as exc:
        raise ValueError("请上传 .xlsx 格式的 Excel 文件") from exc
    with zf:
        shared = _read_shared_strings(zf)
        sheet_paths = _sheet_paths(zf)
        parsed: dict[str, list[dict[str, str]]] = {}
        for sheet_name, path in sheet_paths.items():
            canonical = _canonical_sheet_name(sheet_name)
            if not canonical:
                continue
            rows = _read_sheet(zf, path, shared)
            if not rows:
                parsed[canonical] = []
                continue
            headers = [str(cell).strip() for cell in rows[0]]
            data_rows = []
            for row in rows[1:]:
                item = {}
                for idx, header in enumerate(headers):
                    if header:
                        item[header] = row[idx] if idx < len(row) else ""
                if any(str(value).strip() for value in item.values()):
                    data_rows.append(item)
            parsed[canonical] = data_rows
        return parsed


def normalize_history(parsed: dict[str, list[dict[str, str]]]) -> dict[str, list[dict]]:
    daily = [_normalize_daily(row) for row in parsed.get("daily_usage", [])]
    monthly = [_normalize_monthly(row) for row in parsed.get("monthly_bills", [])]
    annual = [_normalize_annual(row) for row in parsed.get("annual_summary", [])]
    details = [_normalize_detail(row) for row in parsed.get("bill_details", [])]
    return {
        "daily": [row for row in daily if row],
        "monthly": [row for row in monthly if row],
        "annual": [row for row in annual if row],
        "details": [row for row in details if row],
    }


def _normalize_daily(row: dict[str, str]) -> dict | None:
    usage_date = _date_text(_pick(row, "日期", "usage_date", "usageDate"))
    usage = _number(_pick(row, "用电量(度)", "用电量", "usage_kwh", "usageValue"))
    if not usage_date or usage is None:
        return None
    raw = {
        "peakKwh": _number(_pick(row, "峰用电(度)", "峰用电", "peak_kwh")),
        "valleyKwh": _number(_pick(row, "谷用电(度)", "谷用电", "valley_kwh")),
        "flatKwh": _number(_pick(row, "平用电(度)", "平用电", "flat_kwh")),
        "sharpKwh": _number(_pick(row, "尖用电(度)", "尖用电", "sharp_kwh")),
        "note": _pick(row, "备注", "note"),
    }
    return {
        "usageDate": usage_date,
        "usageValue": usage,
        "usageUnit": "度",
        "amount": _number(_pick(row, "费用(元)", "费用", "amount_yuan", "amount")),
        "sourceChannel": "sgcc_history_import",
        "raw": raw,
    }


def _normalize_monthly(row: dict[str, str]) -> dict | None:
    month = _month_text(_pick(row, "账单月份", "statement_month", "statementDate"))
    amount = _number(_pick(row, "电费(元)", "电费", "amount_yuan", "amount"))
    usage = _number(_pick(row, "用电量(度)", "用电量", "usage_kwh", "usageValue"))
    if not month or amount is None:
        return None
    statement_date = f"{month}-01"
    return {
        "statementDate": statement_date,
        "periodStart": _date_text(_pick(row, "账期开始", "period_start", "periodStart")) or statement_date,
        "periodEnd": _date_text(_pick(row, "账期结束", "period_end", "periodEnd")),
        "usageValue": usage,
        "usageUnit": "度",
        "amount": amount,
        "sourceChannel": "sgcc_history_import",
        "recordType": "history_bill",
        "status": "confirmed",
        "raw": {"accountNo": _pick(row, "户号", "account_no"), "source": _pick(row, "来源", "source")},
    }


def _normalize_annual(row: dict[str, str]) -> dict | None:
    year = str(_pick(row, "年份", "year")).strip()
    if not re.fullmatch(r"\d{4}", year):
        return None
    return {
        "year": year,
        "usageValue": _number(_pick(row, "年用电量(度)", "年用电量", "usage_kwh")),
        "amount": _number(_pick(row, "年电费(元)", "年电费", "amount_yuan")),
        "accountNo": _pick(row, "户号", "account_no"),
        "raw": {"note": _pick(row, "备注", "note")},
    }


def _normalize_detail(row: dict[str, str]) -> dict | None:
    month = _period_text(_pick(row, "账单月份", "statement_month", "statementDate"))
    module = str(_pick(row, "模块", "module")).strip()
    item = str(_pick(row, "项目", "item_name", "item")).strip()
    if not month or not module or not item:
        return None
    return {
        "statementMonth": month,
        "module": module,
        "itemName": item,
        "itemValue": str(_pick(row, "数值", "item_value", "value")).strip(),
        "unit": str(_pick(row, "单位", "unit")).strip(),
        "raw": {"note": _pick(row, "备注", "note")},
    }


def _pick(row: dict[str, str], *keys: str) -> str:
    normalized = {_norm_key(key): value for key, value in row.items()}
    for key in keys:
        value = normalized.get(_norm_key(key))
        if value is not None:
            return str(value).strip()
    return ""


def _number(value: str | int | float | None) -> float | None:
    if value is None:
        return None
    text = str(value).strip().replace(",", "")
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        match = re.search(r"-?\d+(?:\.\d+)?", text)
        return float(match.group(0)) if match else None


def _date_text(value: str) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    match = re.search(r"(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})", text)
    if match:
        return f"{match.group(1)}-{int(match.group(2)):02d}-{int(match.group(3)):02d}"
    if re.fullmatch(r"\d+(?:\.\d+)?", text):
        try:
            dt = datetime(1899, 12, 30) + timedelta(days=float(text))
            return dt.strftime("%Y-%m-%d")
        except ValueError:
            return ""
    return text[:10] if re.fullmatch(r"\d{4}-\d{2}-\d{2}.*", text) else ""


def _month_text(value: str) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    match = re.search(r"(\d{4})[-/.年]?(\d{1,2})", text)
    if match:
        return f"{match.group(1)}-{int(match.group(2)):02d}"
    return ""


def _period_text(value: str) -> str:
    text = str(value or "").strip()
    if re.fullmatch(r"\d{4}", text):
        return text
    return _month_text(text)


def _canonical_sheet_name(name: str) -> str:
    normalized = _norm_key(name)
    aliases = {
        "日用电": "daily_usage",
        "dailyusage": "daily_usage",
        "daily": "daily_usage",
        "月账单": "monthly_bills",
        "monthlybills": "monthly_bills",
        "bills": "monthly_bills",
        "年度汇总": "annual_summary",
        "annualsummary": "annual_summary",
        "annual": "annual_summary",
        "账单详情": "bill_details",
        "billdetails": "bill_details",
        "details": "bill_details",
    }
    return aliases.get(normalized, "")


def _norm_key(value: str) -> str:
    return re.sub(r"[\s_（）()/-]+", "", str(value or "").strip().lower())


def _read_shared_strings(zf: zipfile.ZipFile) -> list[str]:
    if "xl/sharedStrings.xml" not in zf.namelist():
        return []
    root = ET.fromstring(zf.read("xl/sharedStrings.xml"))
    strings = []
    for item in root.findall(f"{{{NS_MAIN}}}si"):
        strings.append("".join(node.text or "" for node in item.findall(f".//{{{NS_MAIN}}}t")))
    return strings


def _sheet_paths(zf: zipfile.ZipFile) -> dict[str, str]:
    workbook = ET.fromstring(zf.read("xl/workbook.xml"))
    rels = ET.fromstring(zf.read("xl/_rels/workbook.xml.rels"))
    rel_map = {
        rel.attrib["Id"]: rel.attrib["Target"]
        for rel in rels.findall(f"{{{NS_PACKAGE_REL}}}Relationship")
    }
    paths = {}
    for sheet in workbook.findall(f".//{{{NS_MAIN}}}sheet"):
        rid = sheet.attrib.get(f"{{{NS_REL}}}id")
        target = rel_map.get(rid or "", "")
        if target:
            paths[sheet.attrib.get("name", "")] = "xl/" + target.lstrip("/")
    return paths


def _read_sheet(zf: zipfile.ZipFile, path: str, shared: list[str]) -> list[list[str]]:
    root = ET.fromstring(zf.read(path))
    rows = []
    for row in root.findall(f".//{{{NS_MAIN}}}row"):
        values = []
        last_col = 0
        for cell in row.findall(f"{{{NS_MAIN}}}c"):
            col = _column_index(cell.attrib.get("r", "A1"))
            while last_col + 1 < col:
                values.append("")
                last_col += 1
            values.append(_cell_value(cell, shared))
            last_col = col
        rows.append(values)
    return rows


def _column_index(ref: str) -> int:
    letters = re.match(r"[A-Z]+", ref.upper())
    total = 0
    for char in (letters.group(0) if letters else "A"):
        total = total * 26 + (ord(char) - 64)
    return total


def _cell_value(cell: ET.Element, shared: list[str]) -> str:
    cell_type = cell.attrib.get("t", "")
    if cell_type == "inlineStr":
        return "".join(node.text or "" for node in cell.findall(f".//{{{NS_MAIN}}}t"))
    value = cell.find(f"{{{NS_MAIN}}}v")
    text = value.text if value is not None and value.text is not None else ""
    if cell_type == "s" and text:
        try:
            return shared[int(text)]
        except (ValueError, IndexError):
            return ""
    return text


def _worksheet_xml(rows: list[list[object]]) -> bytes:
    worksheet = ET.Element(f"{{{NS_MAIN}}}worksheet")
    sheet_data = ET.SubElement(worksheet, f"{{{NS_MAIN}}}sheetData")
    for row_idx, row in enumerate(rows, start=1):
        row_el = ET.SubElement(sheet_data, f"{{{NS_MAIN}}}row", {"r": str(row_idx)})
        for col_idx, value in enumerate(row, start=1):
            ref = f"{_column_name(col_idx)}{row_idx}"
            cell = ET.SubElement(row_el, f"{{{NS_MAIN}}}c", {"r": ref})
            if isinstance(value, (int, float)) and not isinstance(value, bool):
                v = ET.SubElement(cell, f"{{{NS_MAIN}}}v")
                v.text = str(value)
            else:
                cell.attrib["t"] = "inlineStr"
                is_el = ET.SubElement(cell, f"{{{NS_MAIN}}}is")
                t = ET.SubElement(is_el, f"{{{NS_MAIN}}}t")
                t.text = "" if value is None else str(value)
    return ET.tostring(worksheet, encoding="utf-8", xml_declaration=True)


def _column_name(index: int) -> str:
    chars = []
    while index:
        index, rem = divmod(index - 1, 26)
        chars.append(chr(65 + rem))
    return "".join(reversed(chars))


def _content_types(sheet_count: int) -> str:
    overrides = [
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>',
    ]
    overrides.extend(
        f'<Override PartName="/xl/worksheets/sheet{idx}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
        for idx in range(1, sheet_count + 1)
    )
    return f'''<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  {"".join(overrides)}
</Types>'''


def _root_rels() -> str:
    return '''<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>'''


def _workbook_xml(sheet_names: list[str]) -> str:
    sheets = "".join(
        f'<sheet name="{name}" sheetId="{idx}" r:id="rId{idx}"/>'
        for idx, name in enumerate(sheet_names, start=1)
    )
    return f'''<?xml version="1.0" encoding="UTF-8"?>
<workbook xmlns="{NS_MAIN}" xmlns:r="{NS_REL}">
  <sheets>{sheets}</sheets>
</workbook>'''


def _workbook_rels(sheet_count: int) -> str:
    rels = "".join(
        f'<Relationship Id="rId{idx}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet{idx}.xml"/>'
        for idx in range(1, sheet_count + 1)
    )
    return f'''<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">{rels}</Relationships>'''
