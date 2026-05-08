function resolveConfigText(credentials, key, fallback = "") {
  const value = trimText(credentials?.[key]);
  return value || fallback;
}

function getPlaywrightConfig(credentials = {}) {
  const timeoutValue = Number(credentials.timeoutMs || process.env.SGCC_TIMEOUT_MS || 60000);
  return {
    homeUrl: resolveConfigText(credentials, "homeUrl", "https://www.95598.cn/osgweb/"),
    summaryUrl: resolveConfigText(credentials, "summaryUrl", "https://www.95598.cn/osgweb/electricitySummary"),
    chargeUrl: resolveConfigText(credentials, "chargeUrl", "https://www.95598.cn/osgweb/electricityCharge"),
    headless: String(credentials.headless ?? process.env.PLAYWRIGHT_HEADLESS ?? "true").toLowerCase() !== "false",
    timeoutMs: Math.max(10000, Number.isFinite(timeoutValue) ? timeoutValue : 60000)
  };
}

async function loadChromium() {
  try {
    const playwright = await import("playwright");
    return playwright.chromium;
  } catch {
    throw new Error("playwright dependency is not installed");
  }
}

function trimText(value) {
  return String(value ?? "").trim();
}

function parseJsonObject(value) {
  if (!value) {
    return null;
  }
  if (typeof value === "object") {
    return value;
  }
  const text = trimText(value);
  if (!text) {
    return null;
  }
  return JSON.parse(text);
}

function parseJsonLenient(value) {
  try {
    return parseJsonObject(value);
  } catch {
    return null;
  }
}

function resolveStorageSnapshot(credentials = {}) {
  const snapshot =
    credentials.storageJson ||
    credentials.browserStorageJson ||
    credentials.localStorageJson ||
    credentials.sessionSnapshot;
  const parsed = parseJsonObject(snapshot);
  if (!parsed) {
    return {
      localStorage: {},
      sessionStorage: {}
    };
  }

  if (parsed.localStorage || parsed.sessionStorage) {
    return {
      localStorage: parsed.localStorage && typeof parsed.localStorage === "object" ? parsed.localStorage : {},
      sessionStorage: parsed.sessionStorage && typeof parsed.sessionStorage === "object" ? parsed.sessionStorage : {}
    };
  }

  return {
    localStorage: parsed,
    sessionStorage: {}
  };
}

function parseCookieHeader(cookieHeader, domain = "www.95598.cn") {
  return trimText(cookieHeader)
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const index = item.indexOf("=");
      const name = index >= 0 ? item.slice(0, index).trim() : item;
      const value = index >= 0 ? item.slice(index + 1).trim() : "";
      return {
        name,
        value,
        domain,
        path: "/",
        httpOnly: false,
        secure: true
      };
    });
}

function hasSessionSnapshot(credentials = {}) {
  return Boolean(trimText(credentials.cookieHeader || credentials.cookies));
}

function hasStorageSnapshot(credentials = {}) {
  return Boolean(
    trimText(credentials.storageJson) ||
    trimText(credentials.browserStorageJson) ||
    trimText(credentials.localStorageJson) ||
    trimText(credentials.sessionSnapshot)
  );
}

const SGCC_RELAY_DEFAULT_BASE_URL = "https://api.120399.xyz";
const SGCC_BASE_URL = "https://www.95598.cn";
const SGCC_LOGIN_PAGE_URL = "https://www.95598.cn/osgweb/login";
const SGCC_GATEWAY_HEADERS = {
  "Content-Type": "application/json;charset=UTF-8",
  Accept: "application/json;charset=UTF-8",
  version: "1.0",
  source: "0901",
  wsgwType: "web"
};
const SGCC_API = {
  getKeyCode: "/api/oauth2/outer/c02/f02",
  getAuth: "/api/oauth2/oauth/authorize",
  getWebToken: "/api/oauth2/outer/getWebToken",
  searchUser: "/api/osg-open-uc0001/member/c9/f02",
  loginVerifyCodeNew: "/api/osg-web0004/open/c44/f05",
  loginTestCodeNew: "/api/osg-web0004/open/c44/f06",
  accapi: "/api/osg-open-bc0001/member/c05/f01",
  busInfoApi: "/api/osg-web0004/member/c24/f01"
};
const SGCC_REQUEST_CONFIG = {
  uscInfo: {
    member: "0902",
    devciceIp: "",
    devciceId: "",
    tenant: "state_grid"
  },
  source: "SGAPP",
  target: "32101",
  serviceCode: {
    order: "0101154",
    uploadPic: "0101296",
    pauseSCode: "0101250",
    pauseTCode: "0101251",
    listconsumers: "0101093",
    messageList: "0101343",
    submit: "0101003",
    sbcMsg: "0101210",
    powercut: "0104514",
    BkAuth01: "f15",
    BkAuth02: "f18",
    BkAuth03: "f02",
    BkAuth04: "f17",
    BkAuth05: "f05",
    BkAuth06: "f16",
    BkAuth07: "f01",
    BkAuth08: "f03"
  },
  userInform: { serviceCode: "0101183", source: "SGAPP" },
  account: { channelCode: "0902", funcCode: "WEBA1007200" },
  getday: {
    channelCode: "0902",
    clearCache: "11",
    funcCode: "WEBALIPAY_01",
    promotCode: "1",
    promotType: "1",
    serviceCode: "BCP_000026",
    source: "app"
  },
  mouthOut: {
    channelCode: "0902",
    clearCache: "11",
    funcCode: "WEBALIPAY_01",
    promotCode: "1",
    promotType: "1",
    serviceCode: "BCP_000026",
    source: "app"
  }
};

function getSgccTimeoutMs(credentials = {}) {
  const timeoutValue = Number(credentials.timeoutMs || process.env.SGCC_TIMEOUT_MS || 60000);
  return Math.max(10000, Number.isFinite(timeoutValue) ? timeoutValue : 60000);
}

function getSgccRelayBaseUrl(credentials = {}) {
  const value = trimText(credentials.relayBaseUrl || process.env.SGCC_RELAY_BASE_URL || SGCC_RELAY_DEFAULT_BASE_URL);
  return value.replace(/\/+$/, "");
}

function hasRelayCredentials(credentials = {}, account = {}) {
  const username = trimText(
    credentials.username ||
    credentials.account ||
    credentials.loginName ||
    account.loginName
  );
  const password = trimText(credentials.password);
  return Boolean(username && password);
}

function getRelayCredentialSet(credentials = {}, account = {}) {
  return {
    username: trimText(
      credentials.username ||
      credentials.account ||
      credentials.loginName ||
      account.loginName
    ),
    password: trimText(credentials.password)
  };
}

function buildSgccGatewayHeaders(headers = {}, riskContext = {}) {
  const riskHeaders = riskContext?.deviceToken
    ? { deviceTokenTX: riskContext.deviceToken }
    : {};
  return {
    ...SGCC_GATEWAY_HEADERS,
    ...headers,
    ...riskHeaders,
    timestamp: headers.timestamp || Date.now()
  };
}

function shouldRejectRelayRawResponse(payload = {}) {
  const code = payload?.code;
  const message = String(payload?.message || "");
  return Boolean(
    code && (
      code === 10010 ||
      code === 30010 ||
      code === "20103" ||
      (code === 10002 && message === "WEB渠道KeyCode已失效") ||
      (code === 10002 && message === "Token 为空！")
    )
  );
}

async function httpRequestText(url, { method = "GET", headers = {}, body, timeoutMs = 30000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method,
      headers,
      body,
      signal: controller.signal
    });
    const text = await response.text();
    return { ok: response.ok, status: response.status, text };
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`请求超时：${url}`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function relayEncryptRequest(relayBaseUrl, config, { riskContext, timeoutMs }) {
  const response = await httpRequestText(`${relayBaseUrl}/wsgw/s1`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      yuheng: {
        ...config,
        headers: buildSgccGatewayHeaders(config.headers || {}, riskContext)
      }
    }),
    timeoutMs
  });
  const payload = parseJsonLenient(response.text);
  const data = payload?.data || payload;
  if (!data?.url) {
    throw new Error(`国网中转加密服务返回异常：${String(response.text).slice(0, 200)}`);
  }
  return {
    ...data,
    url: `${SGCC_BASE_URL}${data.url}`,
    body: data.data !== undefined ? JSON.stringify(data.data) : data.body
  };
}

async function relayDecryptResponse(relayBaseUrl, config, rawData, { encryptKey, timeoutMs }) {
  const response = await httpRequestText(`${relayBaseUrl}/wsgw/s2`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      yuheng: {
        config: {
          ...config,
          ...(config.url === SGCC_API.getKeyCode ? { headers: { encryptKey } } : {})
        },
        data: rawData
      }
    }),
    timeoutMs
  });
  const payload = parseJsonLenient(response.text);
  const code = payload?.data?.code;
  const message = payload?.data?.message;
  const data = payload?.data?.data;

  if (`${code}` === "1") {
    return data;
  }

  if (
    config.url === SGCC_API.getAuth &&
    data &&
    [10015, 10108, 10009, 10207, 10005, 10010, 30010].includes(code)
  ) {
    throw new Error(`重新获取: ${message}`);
  }
  if (config.url === SGCC_API.getAuth && code === 10002 && message === "WEB渠道KeyCode已失效") {
    throw new Error(`重新获取: ${message}`);
  }
  if (config.url === SGCC_API.getAuth && code === 10002 && message === "Token 为空！") {
    throw new Error(`重新获取: ${message}`);
  }

  throw new Error(message || `国网中转解密失败：${String(response.text).slice(0, 200)}`);
}

async function requestViaRelay(relayBaseUrl, config, context) {
  const encrypted = await relayEncryptRequest(relayBaseUrl, config, context);
  const headers = { ...(encrypted.headers || {}) };
  let body = encrypted.body;

  if (config.url === SGCC_API.getAuth && typeof body === "string") {
    body = body.replace(/^"|"$/g, "");
  }
  if (config.url === SGCC_API.getWebToken) {
    headers["content-type"] = "text/plain;charset=UTF-8";
  }

  const response = await httpRequestText(encrypted.url, {
    method: encrypted.method || config.method || "POST",
    headers,
    body,
    timeoutMs: context.timeoutMs
  });
  const rawData = parseJsonLenient(response.text) ?? response.text;
  if (shouldRejectRelayRawResponse(rawData)) {
    throw new Error(rawData.message || "国网接口返回失败");
  }

  return relayDecryptResponse(relayBaseUrl, config, rawData, {
    encryptKey: encrypted.encryptKey,
    timeoutMs: context.timeoutMs
  });
}

async function initRelayRiskContext(relayBaseUrl, timeoutMs) {
  const response = await httpRequestText(`${relayBaseUrl}/wsgw/s4`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      yuheng: {
        ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
        href: SGCC_LOGIN_PAGE_URL,
        referer: SGCC_LOGIN_PAGE_URL,
        ip: ""
      }
    }),
    timeoutMs
  });
  const payload = parseJsonLenient(response.text);
  const data = payload?.data || payload;
  return {
    deviceToken: trimText(data?.tdcItoken || data?.deviceToken),
    tdcItoken: trimText(data?.tdcItoken),
    collect: data?.collect || "",
    info: data?.info || null
  };
}

function getRelayLoginPayload(username, password, slider = null) {
  return {
    params: {
      uscInfo: {
        devciceIp: "",
        tenant: "state_grid",
        member: "0902",
        devciceId: ""
      },
      quInfo: {
        optSys: "android",
        pushId: "000000",
        addressProvince: "110100",
        password,
        addressRegion: "110101",
        account: username,
        addressCity: "330100"
      }
    },
    complexSliderRet: slider ? slider.complexSliderRet : undefined,
    complexSliderType: slider ? slider.complexSliderType : undefined
  };
}

function getRelayCaptchaType(error) {
  const message = String(error || "");
  if (/RK1003/.test(message)) return "clickImg";
  if (/RK008/.test(message)) return "clickWord";
  return "blockPuzzle";
}

function isRelayCaptchaChallenge(error) {
  return /RK007|RK008|RK1003/.test(String(error || ""));
}

function isRelayRateLimited(error) {
  return /操作过于频繁|code["']?\s*[:=]\s*-?100\b/.test(String(error || ""));
}

function isRelayLoginRiskBlocked(error) {
  return /RK001|网络连接超时/.test(String(error || ""));
}

function isSgccPasswordModeUnavailableError(error) {
  return /GB002|请求异常.?GB002|账号密码登录失败：请求异常/.test(String(error || ""));
}

function buildSgccPasswordModeUnavailableMessage(error) {
  const message = String(error?.message || error || "").trim();
  return [
    "网上国网当前更稳定的方式是先在官网或 App 使用短信验证码登录，再导入后台里的 CK。",
    "你这次填写的账号密码链路没有通过，官网当前很可能已经不再稳定支持纯账号密码直登。",
    message ? `原始返回：${message}` : null
  ]
    .filter(Boolean)
    .join(" ");
}

async function getRelayKeyCode(relayBaseUrl, context) {
  return requestViaRelay(relayBaseUrl, {
    url: SGCC_API.getKeyCode,
    method: "POST",
    headers: {}
  }, context);
}

async function loginViaRelay(relayBaseUrl, context, { username, password }, slider = null) {
  try {
    const result = await requestViaRelay(relayBaseUrl, {
      url: SGCC_API.loginTestCodeNew,
      method: "POST",
      headers: { ...(context.requestKey || {}) },
      data: getRelayLoginPayload(username, password, slider)
    }, context);
    const bizrt = result?.bizrt;
    if (!(Array.isArray(bizrt?.userInfo) && bizrt.userInfo.length > 0)) {
      throw new Error("登录失败：未获取到用户信息");
    }
    return bizrt;
  } catch (error) {
    const message = String(error?.message || error || "");
    if (isRelayRateLimited(message)) {
      throw new Error(`网上国网登录过于频繁，请稍后再试：${message}`);
    }
    if (isRelayLoginRiskBlocked(message)) {
      throw new Error(
        "网上国网账号触发了登录风控。请先在官方 App 或官网手动确认账号密码正确，再减少当天重试次数后重新测试。"
      );
    }
    if (isRelayCaptchaChallenge(message) && !slider) {
      return loginViaRelay(relayBaseUrl, context, { username, password }, {
        complexSliderRet: 0,
        complexSliderType: getRelayCaptchaType(message)
      });
    }
    throw new Error(`网上国网账号密码登录失败：${message}`);
  }
}

async function getRelayAuthorizeCode(relayBaseUrl, context, bizrt) {
  const result = await requestViaRelay(relayBaseUrl, {
    url: SGCC_API.getAuth,
    method: "POST",
    headers: {
      ...(context.requestKey || {}),
      token: bizrt.token
    }
  }, context);
  const redirectUrl = trimText(result?.redirect_url);
  const match = redirectUrl.match(/[?&]code=([^&]+)/);
  if (!match) {
    throw new Error("网上国网授权码获取失败：redirect_url 中未找到 code");
  }
  return match[1];
}

async function getRelayAccessToken(relayBaseUrl, context, bizrt, authorizeCode) {
  const result = await requestViaRelay(relayBaseUrl, {
    url: SGCC_API.getWebToken,
    method: "POST",
    headers: {
      ...(context.requestKey || {}),
      token: bizrt.token,
      authorizecode: authorizeCode
    }
  }, context);
  const accessToken = trimText(result?.access_token);
  if (!accessToken) {
    throw new Error("网上国网 accessToken 获取失败");
  }
  return accessToken;
}

async function getRelayBindInfo(relayBaseUrl, context, bizrt, accessToken) {
  const result = await requestViaRelay(relayBaseUrl, {
    url: SGCC_API.searchUser,
    method: "POST",
    headers: {
      ...(context.requestKey || {}),
      token: bizrt.token,
      acctoken: accessToken
    },
    data: {
      serviceCode: SGCC_REQUEST_CONFIG.userInform.serviceCode,
      source: SGCC_REQUEST_CONFIG.source,
      target: SGCC_REQUEST_CONFIG.target,
      uscInfo: { ...SGCC_REQUEST_CONFIG.uscInfo },
      quInfo: { userId: bizrt.userInfo[0].userId },
      token: bizrt.token,
      Channels: "web"
    }
  }, context);
  return result?.bizrt || result;
}

function pickRelayPowerUser(bindInfo, account) {
  const items = Array.isArray(bindInfo?.powerUserList) ? bindInfo.powerUserList : [];
  const accountNo = trimText(account.accountNo);
  if (accountNo) {
    const matched = items.find((item) => (
      trimText(item.consNo_dst) === accountNo ||
      trimText(item.consNoDst) === accountNo ||
      trimText(item.consNo) === accountNo
    ));
    if (matched) {
      return matched;
    }
  }

  const primaryResidential = items.find((item) => String(item.isDefault || "") === "1" && String(item.elecTypeCode || "") === "01");
  return primaryResidential || items.find((item) => String(item.isDefault || "") === "1") || items[0] || null;
}

async function getRelayElectricityFee(relayBaseUrl, context, bizrt, accessToken, powerUser) {
  const user = bizrt.userInfo[0];
  const result = await requestViaRelay(relayBaseUrl, {
    url: SGCC_API.accapi,
    method: "POST",
    headers: {
      ...(context.requestKey || {}),
      token: bizrt.token,
      acctoken: accessToken
    },
    data: {
      data: {
        srvCode: "",
        serialNo: "",
        channelCode: SGCC_REQUEST_CONFIG.account.channelCode,
        funcCode: SGCC_REQUEST_CONFIG.account.funcCode,
        acctId: user.userId,
        userName: user.loginAccount || user.nickname,
        promotType: "1",
        promotCode: "1",
        userAccountId: user.userId,
        list: [
          {
            consNoSrc: powerUser.consNo_dst,
            proCode: powerUser.proNo,
            sceneType: powerUser.constType,
            consNo: powerUser.consNo,
            orgNo: powerUser.orgNo
          }
        ]
      },
      serviceCode: "0101143",
      source: SGCC_REQUEST_CONFIG.source,
      target: powerUser.proNo || powerUser.provinceId
    }
  }, context);
  return Array.isArray(result?.list) ? result.list[0] || null : null;
}

function getBeforeDate(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

async function getRelayDayUsage(relayBaseUrl, context, bizrt, accessToken, powerUser) {
  const user = bizrt.userInfo[0];
  return requestViaRelay(relayBaseUrl, {
    url: SGCC_API.busInfoApi,
    method: "POST",
    headers: {
      ...(context.requestKey || {}),
      token: bizrt.token,
      acctoken: accessToken
    },
    data: {
      params1: {
        serviceCode: SGCC_REQUEST_CONFIG.serviceCode,
        source: SGCC_REQUEST_CONFIG.source,
        target: SGCC_REQUEST_CONFIG.target,
        uscInfo: { ...SGCC_REQUEST_CONFIG.uscInfo },
        quInfo: { userId: user.userId },
        token: bizrt.token
      },
      params3: {
        data: {
          acctId: user.userId,
          consNo: powerUser.consNo_dst,
          consType: String(powerUser.constType || "") === "02" ? "02" : "01",
          endTime: getBeforeDate(1),
          orgNo: powerUser.orgNo,
          queryYear: new Date().getFullYear().toString(),
          proCode: powerUser.proNo || powerUser.provinceId,
          serialNo: "",
          srvCode: "",
          startTime: getBeforeDate(8),
          userName: user.nickname || user.loginAccount,
          funcCode: SGCC_REQUEST_CONFIG.getday.funcCode,
          channelCode: SGCC_REQUEST_CONFIG.getday.channelCode,
          clearCache: SGCC_REQUEST_CONFIG.getday.clearCache,
          promotCode: SGCC_REQUEST_CONFIG.getday.promotCode,
          promotType: SGCC_REQUEST_CONFIG.getday.promotType
        },
        serviceCode: SGCC_REQUEST_CONFIG.getday.serviceCode,
        source: SGCC_REQUEST_CONFIG.getday.source,
        target: powerUser.proNo || powerUser.provinceId
      },
      params4: "010103"
    }
  }, context);
}

async function getRelayMonthUsage(relayBaseUrl, context, bizrt, accessToken, powerUser) {
  const user = bizrt.userInfo[0];
  const requestPayload = (year) => ({
    url: SGCC_API.busInfoApi,
    method: "POST",
    headers: {
      ...(context.requestKey || {}),
      token: bizrt.token,
      acctoken: accessToken
    },
    data: {
      params1: {
        serviceCode: SGCC_REQUEST_CONFIG.serviceCode,
        source: SGCC_REQUEST_CONFIG.source,
        target: SGCC_REQUEST_CONFIG.target,
        uscInfo: { ...SGCC_REQUEST_CONFIG.uscInfo },
        quInfo: { userId: user.userId },
        token: bizrt.token
      },
      params3: {
        data: {
          acctId: user.userId,
          consNo: powerUser.consNo_dst,
          consType: String(powerUser.constType || "") === "02" ? "02" : "01",
          orgNo: powerUser.orgNo,
          proCode: powerUser.proNo || powerUser.provinceId,
          provinceCode: powerUser.proNo || powerUser.provinceId,
          queryYear: year,
          serialNo: "",
          srvCode: "",
          userName: user.nickname || user.loginAccount,
          funcCode: SGCC_REQUEST_CONFIG.mouthOut.funcCode,
          channelCode: SGCC_REQUEST_CONFIG.mouthOut.channelCode,
          clearCache: SGCC_REQUEST_CONFIG.mouthOut.clearCache,
          promotCode: SGCC_REQUEST_CONFIG.mouthOut.promotCode,
          promotType: SGCC_REQUEST_CONFIG.mouthOut.promotType
        },
        serviceCode: SGCC_REQUEST_CONFIG.mouthOut.serviceCode,
        source: SGCC_REQUEST_CONFIG.mouthOut.source,
        target: powerUser.proNo || powerUser.provinceId
      },
      params4: "010102"
    }
  });

  const currentYear = new Date().getFullYear().toString();
  const currentData = await requestViaRelay(relayBaseUrl, requestPayload(currentYear), context);
  const currentList = Array.isArray(currentData?.mothEleList) ? currentData.mothEleList : [];
  if (currentList.length >= 12) {
    return currentData;
  }

  const previousYear = String(Number(currentYear) - 1);
  const previousData = await requestViaRelay(relayBaseUrl, requestPayload(previousYear), context);
  return {
    ...currentData,
    mothEleList: [
      ...(Array.isArray(previousData?.mothEleList) ? previousData.mothEleList : []),
      ...currentList
    ]
  };
}

async function executeRelaySgccCollection(account, credentials) {
  const relayBaseUrl = getSgccRelayBaseUrl(credentials);
  const timeoutMs = getSgccTimeoutMs(credentials);
  const login = getRelayCredentialSet(credentials, account);
  if (!login.username || !login.password) {
    throw new Error("网上国网账号密码模式需要填写用户名和密码。");
  }

  const context = {
    timeoutMs,
    riskContext: await initRelayRiskContext(relayBaseUrl, timeoutMs),
    requestKey: null
  };
  context.requestKey = await getRelayKeyCode(relayBaseUrl, context);

  const bizrt = await loginViaRelay(relayBaseUrl, context, login);
  const authorizeCode = await getRelayAuthorizeCode(relayBaseUrl, context, bizrt);
  const accessToken = await getRelayAccessToken(relayBaseUrl, context, bizrt, authorizeCode);
  const bindInfo = await getRelayBindInfo(relayBaseUrl, context, bizrt, accessToken);
  const powerUser = pickRelayPowerUser(bindInfo, account);
  if (!powerUser) {
    throw new Error("网上国网未查询到已绑定的用电户号。");
  }

  const [electricityFee, dayUsage, monthUsage] = await Promise.all([
    getRelayElectricityFee(relayBaseUrl, context, bizrt, accessToken, powerUser),
    getRelayDayUsage(relayBaseUrl, context, bizrt, accessToken, powerUser),
    getRelayMonthUsage(relayBaseUrl, context, bizrt, accessToken, powerUser)
  ]);

  return {
    relayBaseUrl,
    powerUser,
    electricityFee,
    dayUsage,
    monthUsage
  };
}

function mapRelayMonthlyBills(account, monthUsage) {
  const items = Array.isArray(monthUsage?.mothEleList) ? monthUsage.mothEleList : [];
  const bills = [];

  for (const row of items) {
    const monthText = trimText(row.month || row.ym || row.yearMonth);
    const amount = toNumber(
      row.monthEleCost ||
      row.monthCost ||
      row.amt ||
      row.amount ||
      row.eleCost
    );
    const usageValue = toNumber(
      row.monthEleNum ||
      row.monthNum ||
      row.eleNum ||
      row.pq ||
      row.totalPq
    );
    const statementDate = normalizeDate(`${monthText}01`);
    if (!statementDate || amount === null) {
      continue;
    }

    bills.push({
      accountId: account.id,
      statementDate,
      periodStart: normalizeDate(`${monthText}01`),
      periodEnd: normalizeDate(row.endDate) || normalizeDate(row.readDate) || statementDate,
      usageValue,
      usageUnit: usageValue !== null ? "kWh" : null,
      amount,
      currency: "CNY",
      sourceChannel: "95598.cn/api-relay",
      recordType: "bill",
      status: "confirmed",
      isEstimated: false,
      raw: row
    });
  }

  return bills;
}

function mapRelayRecentDailyUsage(dayUsage) {
  const items = Array.isArray(dayUsage?.sevenEleList) ? dayUsage.sevenEleList : [];
  return items
    .map((item) => ({
      usageDate: normalizeDate(item.day),
      usageValue: toNumber(item.dayElePq),
      usageUnit: "kWh",
      amount: toNumber(item.thisAmt),
      currency: "CNY",
      sourceChannel: "95598.cn/api-relay",
      isEstimated: false,
      peakUsage: toNumber(item.thisPPq),
      valleyUsage: toNumber(item.thisVPq),
      tipUsage: toNumber(item.thisTPq),
      normalUsage: toNumber(item.thisNPq),
      raw: item
    }))
    .filter((item) => item.usageDate);
}

async function testSgccRelayConnection({ account, credentials }) {
  const result = await executeRelaySgccCollection(account, credentials);
  const dailyCount = Array.isArray(result.dayUsage?.sevenEleList) ? result.dayUsage.sevenEleList.length : 0;
  const monthlyCount = Array.isArray(result.monthUsage?.mothEleList) ? result.monthUsage.mothEleList.length : 0;
  return {
    ok: true,
    summary: "SGCC Zhejiang relay-api session is valid",
    details: {
      provider: account.provider,
      utilityType: account.utilityType,
      accountNo: result.powerUser?.consNo_dst || result.powerUser?.consNoDst || account.accountNo,
      dailyUsageCount: dailyCount,
      monthlyUsageCount: monthlyCount,
      currentBalance: toNumber(result.electricityFee?.sumMoney),
      relayBaseUrl: result.relayBaseUrl,
      sessionMode: false,
      apiMode: "relay-api"
    }
  };
}

async function collectSgccRelayBills({ account, credentials }) {
  const result = await executeRelaySgccCollection(account, credentials);
  const bills = mapRelayMonthlyBills(account, result.monthUsage);
  const recentDailyUsage = mapRelayRecentDailyUsage(result.dayUsage);
  return {
    ok: true,
    summary: `SGCC Zhejiang relay-api collected ${bills.length} bill items and ${recentDailyUsage.length} daily usage items`,
    details: {
      provider: account.provider,
      utilityType: account.utilityType,
      accountNo: result.powerUser?.consNo_dst || result.powerUser?.consNoDst || account.accountNo,
      recentDailyUsage,
      annualSummary: result.monthUsage?.dataInfo || null,
      currentFeeSnapshot: result.electricityFee || null,
      powerUser: result.powerUser || null,
      relayBaseUrl: result.relayBaseUrl,
      stage: "relay-api"
    },
    bills
  };
}

async function createBrowserContext(config) {
  const chromium = await loadChromium();
  const browser = await chromium.launch({ headless: config.headless });
  const context = await browser.newContext();
  const page = await context.newPage();
  return { browser, context, page };
}

async function withBrowser(config, task) {
  const { browser, context, page } = await createBrowserContext(config);
  try {
    return await task({ browser, context, page });
  } finally {
    await context.close();
    await browser.close();
  }
}

async function injectSessionSnapshot(page, context, config, credentials) {
  const cookieHeader = trimText(credentials.cookieHeader || credentials.cookies);
  const snapshot = resolveStorageSnapshot(credentials);

  if (!cookieHeader) {
    throw new Error("SGCC session mode requires cookieHeader");
  }

  const cookies = parseCookieHeader(cookieHeader);
  if (cookies.length) {
    await context.addCookies(cookies);
  }

  await page.goto(config.homeUrl, {
    waitUntil: "domcontentloaded",
    timeout: config.timeoutMs
  });

  await page.evaluate(({ localValues, sessionValues }) => {
    for (const [key, value] of Object.entries(localValues || {})) {
      localStorage.setItem(key, String(value));
    }
    for (const [key, value] of Object.entries(sessionValues || {})) {
      sessionStorage.setItem(key, String(value));
    }
  }, {
    localValues: snapshot.localStorage,
    sessionValues: snapshot.sessionStorage
  });
}

async function getPageDebugInfo(page) {
  let title = "";
  let bodyText = "";

  try {
    title = await page.title();
  } catch {
    title = "";
  }

  try {
    bodyText = await page.evaluate(() => (document.body?.innerText || "").replace(/\s+/g, " ").trim().slice(0, 240));
  } catch {
    bodyText = "";
  }

  return {
    url: page.url(),
    title,
    bodyText
  };
}

function isLikelySgccLoginState(pageInfo) {
  const haystack = `${pageInfo.url} ${pageInfo.title} ${pageInfo.bodyText}`;
  return /login|status=0|登录|验证码|短信|滑块|请先登录/i.test(haystack);
}

function isLikelySecurityBlock(pageInfo) {
  const haystack = `${pageInfo.title} ${pageInfo.bodyText}`;
  return /安全验证|访问过于频繁|机器人|异常|风控|校验/i.test(haystack);
}

async function waitForVueApp(page, timeoutMs) {
  try {
    await page.waitForFunction(() => Boolean(document.getElementById("app")?.__vue__), {
      timeout: timeoutMs
    });
  } catch {
    const pageInfo = await getPageDebugInfo(page);
    if (isLikelySgccLoginState(pageInfo)) {
      throw new Error(`网上国网页面已回到登录态，当前导入的 CK / storageJson 很可能已失效。当前地址：${pageInfo.url}`);
    }
    if (isLikelySecurityBlock(pageInfo)) {
      throw new Error(`网上国网页面触发了安全校验或风控，当前容器内无法继续提取数据。当前地址：${pageInfo.url}`);
    }
    throw new Error(`未能识别网上国网页面框架，无法进入账单页。当前地址：${pageInfo.url}；页面标题：${pageInfo.title || "未知"}；页面摘要：${pageInfo.bodyText || "空"}`);
  }
}

async function getVueTreeDebugInfo(page) {
  try {
    return await page.evaluate(() => {
      const root = document.getElementById("app")?.__vue__;
      if (!root) {
        return {
          route: null,
          componentNames: []
        };
      }

      const queue = [root, root.firstElementChild?.__vue__].filter(Boolean);
      const seen = new Set();
      const componentNames = [];
      let route = null;

      while (queue.length) {
        const vm = queue.shift();
        if (!vm || seen.has(vm._uid)) {
          continue;
        }
        seen.add(vm._uid);

        const name = String(vm.$options?.name || "").trim();
        if (name && componentNames.length < 16 && !componentNames.includes(name)) {
          componentNames.push(name);
        }

        if (!route && vm.$route) {
          route = {
            path: vm.$route.path || null,
            fullPath: vm.$route.fullPath || null,
            name: vm.$route.name || null
          };
        }

        for (const child of vm.$children || []) {
          queue.push(child);
        }
      }

      return {
        route,
        componentNames
      };
    });
  } catch {
    return {
      route: null,
      componentNames: []
    };
  }
}

async function waitForVueData(page, predicate, { timeoutMs, stage, missingHint }) {
  try {
    await page.waitForFunction(predicate, { timeout: timeoutMs });
  } catch {
    const [pageInfo, vueInfo] = await Promise.all([
      getPageDebugInfo(page),
      getVueTreeDebugInfo(page)
    ]);

    if (isLikelySgccLoginState(pageInfo)) {
      throw new Error(`网上国网页面在${stage}阶段回到了登录态，当前导入的 CK / storageJson 很可能已失效。当前地址：${pageInfo.url}`);
    }
    if (isLikelySecurityBlock(pageInfo)) {
      throw new Error(`网上国网页面在${stage}阶段触发了安全校验或风控，当前容器内无法继续提取数据。当前地址：${pageInfo.url}`);
    }

    const routeText = vueInfo.route?.fullPath || vueInfo.route?.path || vueInfo.route?.name || "未知";
    const componentText = vueInfo.componentNames.length ? vueInfo.componentNames.join(", ") : "未识别到组件";

    throw new Error(
      `网上国网页面已加载框架，但在${stage}阶段未等到账单数据组件。` +
      `可能原因：${missingHint}。` +
      `当前地址：${pageInfo.url}；` +
      `页面标题：${pageInfo.title || "未知"}；` +
      `页面摘要：${pageInfo.bodyText || "空"}；` +
      `当前路由：${routeText}；` +
      `已识别组件：${componentText}`
    );
  }
}

async function findVueComponentData(page, predicateSource) {
  return page.evaluate((predicateText) => {
    const predicate = new Function("vm", `return (${predicateText})(vm);`);
    const root = document.getElementById("app")?.__vue__;
    if (!root) {
      return null;
    }

    const queue = [root, root.firstElementChild?.__vue__].filter(Boolean);
    const seen = new Set();
    while (queue.length) {
      const vm = queue.shift();
      if (!vm || seen.has(vm._uid)) {
        continue;
      }
      seen.add(vm._uid);
      if (predicate(vm)) {
        return {
          uid: vm._uid,
          name: vm.$options?.name || null,
          route: vm.$route ? {
            path: vm.$route.path,
            fullPath: vm.$route.fullPath,
            name: vm.$route.name
          } : null,
          data: vm._data || null,
          props: vm.$props || null
        };
      }
      for (const child of vm.$children || []) {
        queue.push(child);
      }
    }

    return null;
  }, predicateSource);
}

async function loadSummarySnapshot(page, config) {
  await page.goto(config.summaryUrl, {
    waitUntil: "domcontentloaded",
    timeout: config.timeoutMs
  });
  await waitForVueApp(page, config.timeoutMs);
  await waitForVueData(page, () => {
    const root = document.getElementById("app")?.__vue__;
    const queue = [root, root?.firstElementChild?.__vue__].filter(Boolean);
    const seen = new Set();
    while (queue.length) {
      const vm = queue.shift();
      if (!vm || seen.has(vm._uid)) {
        continue;
      }
      seen.add(vm._uid);
      if ((vm.$options?.name || "") === "eleSum" && Array.isArray(vm._data?.billNumberList)) {
        return vm._data.billNumberList.length > 0;
      }
      for (const child of vm.$children || []) {
        queue.push(child);
      }
    }
    return false;
  }, {
    timeoutMs: config.timeoutMs,
    stage: "电费账单页",
    missingHint: "当前会话可能没有进入正确账单页、目标户号账单列表为空，或国网页面结构发生变化"
  });

  return findVueComponentData(page, "(vm) => (vm.$options?.name || '') === 'eleSum' && Array.isArray(vm._data?.billNumberList)");
}

async function loadChargeSnapshot(page, config) {
  await page.goto(config.chargeUrl, {
    waitUntil: "domcontentloaded",
    timeout: config.timeoutMs
  });
  await waitForVueApp(page, config.timeoutMs);
  await waitForVueData(page, () => {
    const root = document.getElementById("app")?.__vue__;
    const queue = [root, root?.firstElementChild?.__vue__].filter(Boolean);
    const seen = new Set();
    while (queue.length) {
      const vm = queue.shift();
      if (!vm || seen.has(vm._uid)) {
        continue;
      }
      seen.add(vm._uid);
      if (vm._data?.powerData && Array.isArray(vm._data?.sevenEleList)) {
        return true;
      }
      for (const child of vm.$children || []) {
        queue.push(child);
      }
    }
    return false;
  }, {
    timeoutMs: config.timeoutMs,
    stage: "电量分析页",
    missingHint: "当前会话可能没有进入正确电量分析页、页面数据尚未返回，或国网页面结构发生变化"
  });

  return findVueComponentData(page, "(vm) => Boolean(vm._data?.powerData) && Array.isArray(vm._data?.sevenEleList)");
}

function normalizeDate(value) {
  const raw = trimText(value);
  if (!raw) {
    return null;
  }

  if (/^\d{8}$/.test(raw)) {
    return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  }

  const match = raw.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (match) {
    return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
  }

  return raw;
}

function toNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const parsed = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function pickSummaryAccount(summaryData, account) {
  const items = Array.isArray(summaryData?.billNumberList) ? summaryData.billNumberList : [];
  const accountNo = trimText(account.accountNo);
  if (!accountNo) {
    return items[0] || null;
  }
  return items.find((item) => trimText(item.consNoDst || item.consNo_dst) === accountNo) || items[0] || null;
}

function mapSummaryBills(account, summaryAccount) {
  const groups = Array.isArray(summaryAccount?.billList) ? summaryAccount.billList : [];
  const bills = [];

  for (const group of groups) {
    for (const row of Array.isArray(group?.monthList) ? group.monthList : []) {
      const usageValue = toNumber(row?.pq);
      const amount = toNumber(row?.amt);
      const statementDate = normalizeDate(`${group?.ym || ""}01`) || normalizeDate(row?.issuDate);
      if (!statementDate || amount === null) {
        continue;
      }

      bills.push({
        accountId: account.id,
        statementDate,
        periodStart: normalizeDate(row?.begDate),
        periodEnd: normalizeDate(row?.endDate),
        usageValue,
        usageUnit: usageValue !== null ? "kWh" : null,
        amount,
        currency: "CNY",
        sourceChannel: "95598.cn/electricitySummary",
        recordType: "bill",
        status: "confirmed",
        isEstimated: false,
        raw: {
          group,
          row,
          summaryAccount: {
            consNoDst: summaryAccount?.consNoDst,
            consName: summaryAccount?.consName,
            elecAddress: summaryAccount?.elecAddress
          }
        }
      });
    }
  }

  return bills;
}

async function extractSgccSessionData(config, account, credentials) {
  return withBrowser(config, async ({ context, page }) => {
    await injectSessionSnapshot(page, context, config, credentials);
    const summary = await loadSummarySnapshot(page, config);
    const summaryAccount = pickSummaryAccount(summary?.data, account);
    if (!summaryAccount) {
      throw new Error("No SGCC account data was found in electricity summary page");
    }

    const charge = await loadChargeSnapshot(page, config);
    return {
      summary,
      summaryAccount,
      charge
    };
  });
}

async function testSgccSessionConnection({ account, credentials }) {
  const config = getPlaywrightConfig(credentials);
  let extracted;
  try {
    extracted = await extractSgccSessionData(config, account, credentials);
  } catch (error) {
    if (!hasStorageSnapshot(credentials)) {
      throw new Error("已识别到你填写了国网 CK，但当前这份 CK 单独还不足以拿到账单页面数据。你可以重新抓取一次页面会话后，再补充 storageJson 增强导入。");
    }
    throw error;
  }

  return {
    ok: true,
    summary: "SGCC Zhejiang session is valid",
    details: {
      provider: account.provider,
      utilityType: account.utilityType,
      accountNo: extracted.summaryAccount?.consNoDst || extracted.summaryAccount?.consNo_dst || account.accountNo,
      billGroupCount: Array.isArray(extracted.summaryAccount?.billList) ? extracted.summaryAccount.billList.length : 0,
      dailyUsageCount: Array.isArray(extracted.charge?.data?.sevenEleList) ? extracted.charge.data.sevenEleList.length : 0,
      sessionMode: true
    }
  };
}

function assertSgccSessionSnapshotForRuntime(credentials = {}) {
  if (hasSessionSnapshot(credentials)) {
    return;
  }

  throw new Error("网上国网目前使用 CK 会话导入。请先在后台填写登录 Cookie（CK）；storageJson 现在是可选增强项，不需要再填写登录页 URL、详情页 URL 或选择器。");
}

export async function testSgccZhejiangConnection({ account, credentials }) {
  if (hasSessionSnapshot(credentials)) {
    return testSgccSessionConnection({ account, credentials });
  }
  if (hasRelayCredentials(credentials, account)) {
    try {
      return await testSgccRelayConnection({ account, credentials });
    } catch (error) {
      if (isSgccPasswordModeUnavailableError(error)) {
        throw new Error(buildSgccPasswordModeUnavailableMessage(error));
      }
      throw error;
    }
  }
  assertSgccSessionSnapshotForRuntime(credentials);
  return testSgccSessionConnection({ account, credentials });
}

export async function collectSgccZhejiangBills({ account, credentials }) {
  if (hasSessionSnapshot(credentials)) {
    const config = getPlaywrightConfig(credentials);
    let extracted;
    try {
      extracted = await extractSgccSessionData(config, account, credentials);
    } catch (error) {
      if (!hasStorageSnapshot(credentials)) {
        throw new Error("网上国网 CK 已导入，但当前还不足以直接进入账单页。请补充同一次登录会话对应的 storageJson 后再试一次。");
      }
      throw error;
    }

    const bills = mapSummaryBills(account, extracted.summaryAccount);
    const recentDailyUsage = Array.isArray(extracted.charge?.data?.sevenEleList)
      ? extracted.charge.data.sevenEleList.map((item) => ({
          usageDate: normalizeDate(item.day),
          usageValue: toNumber(item.dayElePq),
          peakUsage: toNumber(item.thisPPq),
          valleyUsage: toNumber(item.thisVPq),
          tipUsage: toNumber(item.thisTPq),
          normalUsage: toNumber(item.thisNPq),
          costAmount: toNumber(item.thisAmt),
          raw: item
        }))
      : [];

    return {
      ok: true,
      summary: `SGCC Zhejiang collected ${bills.length} monthly bill items`,
      details: {
        provider: account.provider,
        utilityType: account.utilityType,
        accountNo: extracted.summaryAccount?.consNoDst || extracted.summaryAccount?.consNo_dst || account.accountNo,
        recentDailyUsage,
        annualSummary: extracted.charge?.data?.powerData?.dataInfo || null,
        stage: "browser-session"
      },
      bills
    };
  }
  if (hasRelayCredentials(credentials, account)) {
    try {
      return await collectSgccRelayBills({ account, credentials });
    } catch (error) {
      if (isSgccPasswordModeUnavailableError(error)) {
        throw new Error(buildSgccPasswordModeUnavailableMessage(error));
      }
      throw error;
    }
  }
  assertSgccSessionSnapshotForRuntime(credentials);

  const config = getPlaywrightConfig(credentials);
  let extracted;
  try {
    extracted = await extractSgccSessionData(config, account, credentials);
  } catch (error) {
    if (!hasStorageSnapshot(credentials)) {
      throw new Error("国网 CK 已导入，但当前无法直接从页面提取账单数据。请补充 storageJson 后再试一次。");
    }
    throw error;
  }

  const bills = mapSummaryBills(account, extracted.summaryAccount);
  const recentDailyUsage = Array.isArray(extracted.charge?.data?.sevenEleList)
    ? extracted.charge.data.sevenEleList.map((item) => ({
        usageDate: normalizeDate(item.day),
        usageValue: toNumber(item.dayElePq),
        peakUsage: toNumber(item.thisPPq),
        valleyUsage: toNumber(item.thisVPq),
        tipUsage: toNumber(item.thisTPq),
        normalUsage: toNumber(item.thisNPq),
        costAmount: toNumber(item.thisAmt),
        raw: item
      }))
    : [];

  return {
    ok: true,
    summary: `SGCC Zhejiang collected ${bills.length} monthly bill items`,
    details: {
      provider: account.provider,
      utilityType: account.utilityType,
      accountNo: extracted.summaryAccount?.consNoDst || extracted.summaryAccount?.consNo_dst || account.accountNo,
      recentDailyUsage,
      annualSummary: extracted.charge?.data?.powerData?.dataInfo || null,
      stage: "browser-session"
    },
    bills
  };
}
