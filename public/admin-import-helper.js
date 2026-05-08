function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function tryParseJsonText(raw) {
  const text = String(raw || "").trim();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function normalizeCookieHeader(value) {
  const text = String(value || "").trim();
  if (!text) {
    return "";
  }
  if (text.startsWith("{") || text.startsWith("[")) {
    return "";
  }
  return text
    .replace(/^Cookie:\s*/i, "")
    .replace(/^cookie:\s*/i, "")
    .trim();
}

function extractCookiePair(text, cookieName) {
  const match = String(text || "").match(new RegExp(`(?:^|[;\\s])(${cookieName}=([^;\\s]+))`, "i"));
  return match ? match[1] : "";
}

function stripWrappingQuotes(value) {
  return String(value || "").trim().replace(/^"+|"+$/g, "");
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) {
      return text;
    }
  }
  return "";
}

function extractByRegex(text, regex) {
  const match = String(text || "").match(regex);
  if (!match) {
    return "";
  }
  return String(match[match.length - 1] || "").trim();
}

function normalizeStorageSnapshot(value) {
  if (!value) {
    return null;
  }
  if (typeof value === "string") {
    const parsed = tryParseJsonText(value);
    return normalizeStorageSnapshot(parsed);
  }
  if (typeof value !== "object") {
    return null;
  }
  if (value.localStorage || value.sessionStorage) {
    return {
      localStorage: value.localStorage && typeof value.localStorage === "object" ? value.localStorage : {},
      sessionStorage: value.sessionStorage && typeof value.sessionStorage === "object" ? value.sessionStorage : {}
    };
  }
  if (value.local || value.session) {
    return {
      localStorage: value.local && typeof value.local === "object" ? value.local : {},
      sessionStorage: value.session && typeof value.session === "object" ? value.session : {}
    };
  }
  return null;
}

export function getImportPreset(providerDef) {
  const key = providerDef?.key || "";

  if (key === "sgcc_zhejiang") {
    return {
      title: "国网会话导入",
      hint: "推荐方式：在已登录的 95598 / 网上国网页面打开控制台，执行提取脚本，再把输出结果粘贴到这里。",
      acceptedFormats: "支持：提取脚本输出、整段 Cookie、storageJson JSON。",
      snippet: `(() => {
  const dump = (storage) => {
    const result = {};
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      result[key] = storage.getItem(key);
    }
    return result;
  };
  return JSON.stringify({
    provider: "sgcc_zhejiang",
    cookieHeader: document.cookie,
    storageJson: {
      localStorage: dump(window.localStorage),
      sessionStorage: dump(window.sessionStorage)
    }
  }, null, 2);
})()`
    };
  }

  if (key === "hzwater_online") {
    return {
      title: "杭水会话导入",
      hint: "推荐方式：在已登录的杭水网上营业厅页面打开控制台，执行提取脚本，再把输出结果粘贴到这里。",
      acceptedFormats: "支持：提取脚本输出、包含 token 的 requestPara JSON、仅 token 文本。",
      snippet: `(() => {
  const dump = (storage) => {
    const result = {};
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      result[key] = storage.getItem(key);
    }
    return result;
  };
  return JSON.stringify({
    provider: "hzwater_online",
    waterUserToken: (window.localStorage.getItem("waterUserToken") || "").replace(/^"+|"+$/g, ""),
    localStorage: dump(window.localStorage)
  }, null, 2);
})()`
    };
  }

  if (key === "hzgas_servicehall") {
    return {
      title: "燃气会话导入",
      hint: "燃气更适合粘贴 HAR 文件全文、请求头里的 Cookie，或已经抓到的 userNo / 户号。",
      acceptedFormats: "支持：HAR 文件 JSON、`logged_in_user=...` Cookie、`userNo=...` 文本。",
      snippet: ""
    };
  }

  return {
    title: "会话导入辅助",
    hint: "请先选择服务商。",
    acceptedFormats: "",
    snippet: ""
  };
}

function parseSgccImportPayload(raw) {
  const parsed = tryParseJsonText(raw);
  const credentials = {};
  const summaryParts = [];

  const cookieHeader = normalizeCookieHeader(
    parsed?.cookieHeader ||
    parsed?.cookies ||
    parsed?.cookie ||
    raw
  );
  if (cookieHeader) {
    credentials.cookieHeader = cookieHeader;
    summaryParts.push("已识别 CK");
  }

  const storageSnapshot = normalizeStorageSnapshot(
    parsed?.storageJson ||
    parsed?.browserStorageJson ||
    (parsed?.localStorage || parsed?.sessionStorage
      ? { localStorage: parsed.localStorage || {}, sessionStorage: parsed.sessionStorage || {} }
      : null) ||
    (parsed?.local || parsed?.session
      ? { local: parsed.local || {}, session: parsed.session || {} }
      : null)
  );
  if (storageSnapshot) {
    credentials.storageJson = JSON.stringify(storageSnapshot, null, 2);
    summaryParts.push("已识别 storageJson");
  }

  const accountNo = firstNonEmpty(
    parsed?.accountNo,
    parsed?.consNoDst,
    parsed?.consNo,
    parsed?.customerNo,
    parsed?.userObj?.consNoDst,
    parsed?.initData?.consNoDst
  );

  if (!credentials.cookieHeader && !credentials.storageJson) {
    throw new Error("没有识别到国网需要的 CK 或 storageJson。建议直接粘贴提取脚本输出结果。");
  }

  return {
    accountNo: accountNo || "",
    credentials,
    summary: summaryParts.join("，")
  };
}

function parseWaterImportPayload(raw) {
  const parsed = tryParseJsonText(raw);
  const payloadJson = tryParseJsonText(parsed?.requestPara || parsed?.payload || "");
  const credentials = {};
  const summaryParts = [];

  const token = stripWrappingQuotes(firstNonEmpty(
    parsed?.sessionToken,
    parsed?.waterUserToken,
    parsed?.token,
    parsed?.local?.waterUserToken,
    parsed?.localStorage?.waterUserToken,
    payloadJson?.waterUserToken,
    payloadJson?.token,
    extractByRegex(raw, /waterUserToken["'\s:=]+("?)([^"',}\s]+)\1/i),
    extractByRegex(raw, /"token"\s*:\s*"([^"]+)"/i)
  ));

  const meterNumber = firstNonEmpty(
    parsed?.meterNumber,
    parsed?.meterNo,
    parsed?.cardNo,
    parsed?.accountNo,
    payloadJson?.meterNumber,
    extractByRegex(raw, /"meterNumber"\s*:\s*"([^"]+)"/i)
  );

  if (!token && /^[A-Za-z0-9_\-]{30,}$/.test(String(raw).trim())) {
    credentials.sessionToken = String(raw).trim();
    summaryParts.push("已识别 waterUserToken");
  } else if (token) {
    credentials.sessionToken = token;
    summaryParts.push("已识别 waterUserToken");
  }

  if (meterNumber) {
    credentials.meterNumber = meterNumber;
    summaryParts.push("已识别水表号");
  }

  if (!credentials.sessionToken) {
    throw new Error("没有识别到杭水所需的 waterUserToken。建议直接粘贴提取脚本输出，或粘贴包含 token 的 requestPara JSON。");
  }

  return {
    accountNo: meterNumber || "",
    credentials,
    summary: summaryParts.join("，")
  };
}

function parseGasHarPayload(entries) {
  const summaryParts = [];
  let cookieHeader = "";
  let accountNo = "";

  for (const entry of safeArray(entries)) {
    for (const header of safeArray(entry?.request?.headers)) {
      if (String(header?.name || "").toLowerCase() === "cookie" && String(header?.value || "").includes("logged_in_user=")) {
        cookieHeader = cookieHeader || (extractCookiePair(String(header.value), "logged_in_user") || String(header.value));
      }
    }

    for (const cookie of safeArray(entry?.request?.cookies)) {
      if (String(cookie?.name || "") === "logged_in_user") {
        cookieHeader = cookieHeader || `logged_in_user=${cookie.value}`;
      }
    }

    const requestUrl = String(entry?.request?.url || "");
    accountNo = accountNo || extractByRegex(requestUrl, /[?&]user[Nn]o=([^&"\s]+)/);

    for (const queryItem of safeArray(entry?.request?.queryString)) {
      if (/^userno$/i.test(String(queryItem?.name || ""))) {
        accountNo = accountNo || String(queryItem?.value || "").trim();
      }
    }

    const responseText = String(entry?.response?.content?.text || "");
    accountNo = accountNo || extractByRegex(responseText, /"userno"\s*:\s*"([^"]+)"/i);
    accountNo = accountNo || extractByRegex(responseText, /"userNo"\s*:\s*"([^"]+)"/i);
  }

  if (cookieHeader) {
    summaryParts.push("已从 HAR 识别燃气 CK");
  }
  if (accountNo) {
    summaryParts.push("已从 HAR 识别 userNo");
  }

  return {
    cookieHeader,
    accountNo,
    summaryParts
  };
}

function parseGasImportPayload(raw) {
  const parsed = tryParseJsonText(raw);
  const credentials = {};
  const summaryParts = [];

  const cookieHeader = normalizeCookieHeader(
    parsed?.cookieHeader ||
    parsed?.cookies ||
    parsed?.cookie ||
    extractCookiePair(raw, "logged_in_user")
  );
  if (cookieHeader) {
    credentials.cookieHeader = cookieHeader.includes("logged_in_user=")
      ? extractCookiePair(cookieHeader, "logged_in_user") || cookieHeader
      : cookieHeader;
    summaryParts.push("已识别燃气 CK");
  }

  let accountNo = firstNonEmpty(
    parsed?.accountNo,
    parsed?.userNo,
    parsed?.userno,
    extractByRegex(raw, /"user[Nn]o"\s*:\s*"([^"]+)"/),
    extractByRegex(raw, /[?&]user[Nn]o=([^&"\s]+)/)
  );

  if ((!accountNo || !credentials.cookieHeader) && parsed?.log?.entries) {
    const harResult = parseGasHarPayload(parsed.log.entries);
    accountNo = accountNo || harResult.accountNo;
    if (!credentials.cookieHeader && harResult.cookieHeader) {
      credentials.cookieHeader = harResult.cookieHeader;
    }
    if (harResult.summaryParts.length) {
      summaryParts.push(...harResult.summaryParts);
    }
  }

  if (!credentials.cookieHeader && !accountNo) {
    throw new Error("没有识别到燃气 CK 或 userNo。可直接粘贴 HAR 文件全文，或粘贴 `logged_in_user=...` 与 `userNo`。");
  }
  if (!credentials.cookieHeader) {
    throw new Error("已识别到燃气户号，但没有识别到登录 CK。");
  }
  if (!accountNo) {
    throw new Error("已识别到燃气 CK，但没有识别到 userNo。请补充燃气户号 / userNo，或粘贴包含账单查询的 HAR。");
  }

  return {
    accountNo,
    credentials,
    summary: summaryParts.length ? summaryParts.join("，") : "已识别燃气 CK 和 userNo"
  };
}

export function parseImportPayload(providerDef, raw) {
  const key = providerDef?.key || "";
  if (key === "sgcc_zhejiang") {
    return parseSgccImportPayload(raw);
  }
  if (key === "hzwater_online") {
    return parseWaterImportPayload(raw);
  }
  if (key === "hzgas_servicehall") {
    return parseGasImportPayload(raw);
  }
  throw new Error("当前服务商暂不支持智能导入。");
}
