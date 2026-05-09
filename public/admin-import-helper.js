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
      title: "国网接入指引",
      hint: "适用于已完成网上国网登录的场景。建议优先导入浏览器导出的完整登录信息；如暂时无法导出，再使用页面提取结果。",
      acceptedFormats: "可识别内容：页面提取结果、完整登录信息、补充页面信息。",
      steps: [
        {
          title: "确认登录页面",
          visual: "已登录页面",
          body: "在浏览器中打开已登录的网上国网页面，建议停留在电费账单或电量分析相关页面。"
        },
        {
          title: "打开浏览器工具",
          visual: "控制台",
          body: "按 F12 打开浏览器工具，并切换到 Console 页面。首次打开如有安全提示，按浏览器提示处理即可。"
        },
        {
          title: "粘贴并导入结果",
          visual: "导入结果",
          body: "执行下方提取脚本后，将输出结果粘贴回后台。若测试后仍回到登录页，请改用浏览器导出的完整登录信息。"
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
      title: "杭水接入指引",
      hint: "适用于已完成杭水网上营业厅登录的场景。导入已登录页面中的结果后，系统会自动识别所需信息。",
      acceptedFormats: "可识别内容：页面提取结果、请求内容、单独的登录信息文本。",
      steps: [
        {
          title: "确认登录页面",
          visual: "网上营业厅",
          body: "在浏览器中打开已登录的杭水网上营业厅，并保持当前登录状态。"
        },
        {
          title: "打开浏览器工具",
          visual: "控制台",
          body: "按 F12 打开浏览器工具，并切换到 Console 页面后执行下方脚本。"
        },
        {
          title: "粘贴并导入结果",
          visual: "导入结果",
          body: "复制脚本输出结果并粘贴回后台。系统会自动识别登录信息，识别到水表号时也会一并带入。"
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
      title: "燃气接入指引",
      hint: "燃气查询依赖公众号页面环境，建议优先导入抓包结果，或直接粘贴已登录页面中的登录信息与燃气户号。",
      acceptedFormats: "可识别内容：抓包文件、登录信息、燃气户号文本。",
      steps: [
        {
          title: "准备导入内容",
          visual: "抓包文件",
          body: "如已通过手机或代理工具导出抓包文件，可直接将完整内容粘贴到后台。"
        },
        {
          title: "补充登录信息或户号",
          visual: "登录信息",
          body: "如已单独拿到登录信息和燃气户号，也可以直接粘贴原始内容进行导入。"
        },
        {
          title: "系统自动识别",
          visual: "自动识别",
          body: "系统会自动识别登录信息和燃气户号；如内容不足，会明确提示仍需补充的项目。"
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
    summaryParts.push("已识别完整登录信息");
  }

  const cookieHeader = normalizeCookieHeader(
    parsed?.cookieHeader ||
    (!cookieCollection.length ? parsed?.cookies || parsed?.cookie || raw : "")
  );
  if (!credentials.cookieHeader && cookieHeader) {
    credentials.cookieHeader = cookieHeader;
    summaryParts.push("已识别登录信息");
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
    summaryParts.push("已识别补充页面信息");
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
    throw new Error("没有识别到国网可用的登录信息。建议直接粘贴页面提取结果，或粘贴浏览器导出的完整登录信息。");
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
    summaryParts.push("已识别登录信息");
  } else if (token) {
    credentials.sessionToken = token;
    summaryParts.push("已识别登录信息");
  }

  if (meterNumber) {
    credentials.meterNumber = meterNumber;
    summaryParts.push("已识别水表号");
  }

  if (!credentials.sessionToken) {
    throw new Error("没有识别到杭水可用的登录信息。建议直接粘贴页面提取结果，或粘贴请求里的登录信息。");
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
    summaryParts.push("已从抓包结果识别登录信息");
  }
  if (accountNo) {
    summaryParts.push("已从抓包结果识别燃气户号");
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
    summaryParts.push("已识别登录信息");
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
    throw new Error("没有识别到燃气可用的登录信息或燃气户号。可直接粘贴抓包文件全文，或粘贴登录信息与燃气户号。");
  }
  if (!credentials.cookieHeader) {
    throw new Error("已识别到燃气户号，但没有识别到登录信息。");
  }
  if (!accountNo) {
    throw new Error("已识别到登录信息，但没有识别到燃气户号。请补充燃气户号，或粘贴包含账单查询的抓包结果。");
  }

  return {
    accountNo,
    credentials,
    summary: summaryParts.length ? summaryParts.join("，") : "已识别登录信息和燃气户号"
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
