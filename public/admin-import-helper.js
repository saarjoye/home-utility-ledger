function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function tryParseJsonText(raw) {
  const text = String(raw || "").trim();
  if (!text) {
    return null;
  }
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed === "string") {
      const nested = parsed.trim();
      if (
        (nested.startsWith("{") && nested.endsWith("}"))
        || (nested.startsWith("[") && nested.endsWith("]"))
      ) {
        try {
          return JSON.parse(nested);
        } catch {
          return parsed;
        }
      }
    }
    return parsed;
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

function normalizeCookieCollection(value) {
  if (!value) {
    return [];
  }
  if (typeof value === "string") {
    const parsed = tryParseJsonText(value);
    return normalizeCookieCollection(parsed);
  }
  if (Array.isArray(value)) {
    return value.filter((item) => item && typeof item === "object" && String(item.name || "").trim());
  }
  if (Array.isArray(value.cookies)) {
    return normalizeCookieCollection(value.cookies);
  }
  return [];
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
      hint: "适用于已在浏览器登录 95598 / 网上国网的场景。优先粘贴完整 Cookie JSON；只有拿不到时，再退回普通 Cookie 串。",
      acceptedFormats: "支持粘贴：提取脚本输出、整段 Cookie、完整 Cookie JSON、storageJson JSON。",
      steps: [
        {
          title: "打开已登录页面",
          visual: "浏览器页",
          body: "在 Edge 中打开已经登录好的网上国网页面，优先停留在“电费账单”或“电量分析”页面。"
        },
        {
          title: "打开控制台",
          visual: "F12 / Console",
          body: "按 F12，切到 Console（控制台）页签。第一次打开时若有安全提示，按浏览器提示允许粘贴。"
        },
        {
          title: "执行脚本并复制输出",
          visual: "复制 JSON",
          body: "把下面的提取脚本粘进去执行。它能导出当前页面可见的 Cookie 和 storageJson。若测试仍回登录页，说明还缺 HttpOnly Cookie，请改为从浏览器扩展或 DevTools 导出完整 Cookie JSON，再粘贴到同一个“登录 Cookie（CK）”输入框。"
        }
      ],
      snippetLabel: "国网页面提取脚本",
      snippet: `(() => {
  const dump = (storage) => {
    const result = {};
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      result[key] = storage.getItem(key);
    }
    return result;
  };
  const payload = {
    provider: "sgcc_zhejiang",
    cookieHeader: document.cookie,
    storageJson: {
      localStorage: dump(window.localStorage),
      sessionStorage: dump(window.sessionStorage)
    }
  };
  const text = JSON.stringify(payload, null, 2);
  if (typeof copy === "function") {
    copy(text);
    console.log("已复制国网会话 JSON，直接回后台粘贴即可。");
  }
  console.log(text);
  return undefined;
})()`
    };
  }

  if (key === "hzwater_online") {
    return {
      title: "杭水会话导入",
      hint: "适用于已在杭水网上营业厅登录的场景。当前真正关键的是 `waterUserToken`。",
      acceptedFormats: "支持粘贴：提取脚本输出、包含 token 的 requestPara JSON、仅 token 文本。",
      steps: [
        {
          title: "打开已登录杭水页面",
          visual: "网上营业厅",
          body: "在 Edge 中打开已经登录好的杭水网上营业厅，保持当前登录状态不要刷新退出。"
        },
        {
          title: "进入控制台执行脚本",
          visual: "F12 / Console",
          body: "按 F12，切到 Console（控制台），执行下面脚本。它会读取 localStorage 里的 `waterUserToken`。"
        },
        {
          title: "回粘结果",
          visual: "waterUserToken",
          body: "复制脚本输出的 JSON，回到后台粘贴。系统会自动识别 `waterUserToken`，能识别到水表号时也会一起带上。"
        }
      ],
      snippetLabel: "杭水页面提取脚本",
      snippet: `(() => {
  const dump = (storage) => {
    const result = {};
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      result[key] = storage.getItem(key);
    }
    return result;
  };
  const payload = {
    provider: "hzwater_online",
    waterUserToken: (window.localStorage.getItem("waterUserToken") || "").replace(/^"+|"+$/g, ""),
    localStorage: dump(window.localStorage)
  };
  const text = JSON.stringify(payload, null, 2);
  if (typeof copy === "function") {
    copy(text);
    console.log("已复制杭水会话 JSON，直接回后台粘贴即可。");
  }
  console.log(text);
  return undefined;
})()`
    };
  }

  if (key === "hzgas_servicehall") {
    return {
      title: "燃气会话导入",
      hint: "燃气更适合直接粘贴 HAR、Cookie 或 userNo。因为查询过程依赖微信公众号环境，不建议承诺浏览器脚本一键提取。",
      acceptedFormats: "支持粘贴：HAR 文件 JSON、`logged_in_user=...` Cookie、`userNo=...` 文本。",
      steps: [
        {
          title: "优先准备 HAR 或抓包结果",
          visual: "HAR",
          body: "如果你已经从手机或代理工具导出了 HAR，直接把 HAR 全文粘贴到后台即可。"
        },
        {
          title: "或者粘贴 CK + userNo",
          visual: "Cookie / userNo",
          body: "如果你已经单独拿到了 `logged_in_user=...` Cookie 和燃气户号 `userNo`，也可以直接粘贴原始文本。"
        },
        {
          title: "自动识别并回填",
          visual: "自动拆字段",
          body: "系统会优先识别 `logged_in_user` 和 `userNo`。识别不到时会明确告诉你缺的是 CK 还是 userNo。"
        }
      ],
      snippetLabel: "燃气导入说明",
      snippet: ""
    };
  }

  return {
    title: "会话导入辅助",
    hint: "请先选择服务商。",
    acceptedFormats: "",
    steps: [],
    snippetLabel: "",
    snippet: ""
  };
}

function parseSgccImportPayload(raw) {
  const parsed = tryParseJsonText(raw);
  const credentials = {};
  const summaryParts = [];

  const cookieCollection = normalizeCookieCollection(
    parsed?.cookiesJson ||
    parsed?.cookieJson ||
    parsed?.cookies ||
    parsed?.cookie
  );
  if (cookieCollection.length) {
    credentials.cookieHeader = JSON.stringify(cookieCollection, null, 2);
    summaryParts.push("已识别完整 Cookie JSON");
  }

  const cookieHeader = normalizeCookieHeader(
    parsed?.cookieHeader ||
    (!cookieCollection.length ? parsed?.cookies || parsed?.cookie || raw : "")
  );
  if (!credentials.cookieHeader && cookieHeader) {
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
    throw new Error("没有识别到国网需要的 Cookie 或 storageJson。建议直接粘贴提取脚本输出，或粘贴浏览器导出的完整 Cookie JSON。");
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
