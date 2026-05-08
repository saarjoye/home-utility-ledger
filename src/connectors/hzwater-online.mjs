function getWaterConfig() {
  return {
    baseUrl: process.env.HZWATER_BASE_URL || "https://wt.hzwgc.com",
    loginUrl: process.env.HZWATER_LOGIN_URL || "https://wt.hzwgc.com/wangting/#/",
    meterListPath: process.env.HZWATER_METER_LIST_PATH || "/iwater/v1/watermeter/queryUserMeterList/new.json",
    payHistoryPath: process.env.HZWATER_PAY_HISTORY_PATH || "/iwater/v1/watermeter/queryPayMentInfo/v2.json",
    timeoutMs: Math.max(5000, Number(process.env.HZWATER_TIMEOUT_MS || 30000)),
    waterCorpId: Number(process.env.HZWATER_WATER_CORP_ID || 3),
    areaId: Number(process.env.HZWATER_AREA_ID || 0),
    accountType: process.env.HZWATER_ACCOUNT_TYPE || "XJ",
    apiType: process.env.HZWATER_API_TYPE || "PC",
    appVersion: process.env.HZWATER_APP_VERSION || "1.0.2"
  };
}

function trimText(value) {
  return String(value ?? "").trim();
}

function resolveWaterToken(credentials = {}) {
  const token = trimText(
    credentials.waterUserToken ||
    credentials.sessionToken ||
    credentials.token
  );
  return token.replace(/^"+|"+$/g, "");
}

function resolveCookieHeader(credentials = {}) {
  return trimText(credentials.cookieHeader || credentials.cookies);
}

function resolveWaterUnid(credentials = {}) {
  return trimText(
    credentials.unid ||
    credentials.UNID
  ).replace(/^"+|"+$/g, "");
}

function buildUrl(baseUrl, requestPath) {
  return new URL(requestPath, baseUrl).toString();
}

function createHeaders(config, credentials) {
  const headers = {
    Accept: "application/json, text/plain, */*",
    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    Origin: config.baseUrl,
    Referer: config.loginUrl,
    "User-Agent": process.env.HZWATER_USER_AGENT || "Mozilla/5.0 home-utility-ledger"
  };

  const cookieHeader = resolveCookieHeader(credentials);
  if (cookieHeader) {
    headers.Cookie = cookieHeader;
  }

  return headers;
}

function buildRequestPayload(config, credentials, extraPayload = {}) {
  return {
    token: resolveWaterToken(credentials),
    waterCorpId: Number(credentials.waterCorpId || config.waterCorpId || 3),
    UNID: resolveWaterUnid(credentials),
    areaId: Number(credentials.areaId ?? config.areaId ?? 0),
    accountType: trimText(credentials.accountType || config.accountType || "XJ"),
    apiType: trimText(credentials.apiType || config.apiType || "PC"),
    appVersion: trimText(credentials.appVersion || config.appVersion || "1.0.2"),
    ...extraPayload
  };
}

async function postWaterJson(config, credentials, requestPath, payload) {
  const response = await fetch(buildUrl(config.baseUrl, requestPath), {
    method: "POST",
    headers: createHeaders(config, credentials),
    body: new URLSearchParams({
      requestPara: JSON.stringify(payload || {})
    }),
    redirect: "follow",
    signal: AbortSignal.timeout(config.timeoutMs)
  });

  const raw = await response.text();
  let data = null;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(`Hangzhou Water returned non-JSON response from ${requestPath}`);
  }

  if (!response.ok) {
    throw new Error(data?.message || `Hangzhou Water request failed with ${response.status}`);
  }

  if (data?.status !== 0 && data?.status !== "0" && !Array.isArray(data?.data)) {
    if (/\u53c2\u6570\u7c7b\u578b\u9519\u8bef/.test(String(data?.message || ""))) {
      throw new Error("杭水接口返回“参数类型错误”。根据最新抓包，UNID 可以留空。请优先检查 waterUserToken 是否有效；如果你已经知道水表号，也建议一并填写。");
    }
    throw new Error(data?.message || `Hangzhou Water request rejected at ${requestPath}`);
  }

  return data;
}

function pickMeterRow(rows, account, credentials) {
  const accountNo = trimText(account.accountNo);
  const preferredMeter = trimText(credentials.meterNumber || credentials.cardNo || credentials.workno);
  const candidates = Array.isArray(rows) ? rows : [];

  if (preferredMeter) {
    const matched = candidates.find((item) => {
      const meterNumber = trimText(item?.meterNumber || item?.meterNum || item?.cardno || item?.cardNo);
      const workNo = trimText(item?.workno || item?.workNo);
      return meterNumber === preferredMeter || workNo === preferredMeter;
    });
    if (matched) {
      return matched;
    }
  }

  if (accountNo) {
    const matched = candidates.find((item) => {
      const meterNumber = trimText(item?.meterNumber || item?.meterNum || item?.cardno || item?.cardNo);
      const workNo = trimText(item?.workno || item?.workNo);
      return meterNumber === accountNo || workNo === accountNo;
    });
    if (matched) {
      return matched;
    }
  }

  return candidates[0] || null;
}

function getMeterNumber(row, account, credentials) {
  return trimText(
    credentials.meterNumber ||
    row?.meterNumber ||
    row?.meterNum ||
    row?.cardno ||
    row?.cardNo ||
    account.accountNo
  );
}

function firstFinite(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === "") {
      continue;
    }
    const parsed = Number(String(value).replace(/,/g, ""));
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
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

function currentYearRange() {
  const now = new Date();
  return {
    startDate: `${now.getFullYear()}0101`,
    endDate: `${now.getFullYear()}1231`
  };
}

function mapWaterBill(account, row) {
  const statementDate = normalizeDate(
    row?.costDate ||
    row?.costdate ||
    row?.paymentDate ||
    row?.paymentdate ||
    row?.payDate ||
    row?.date ||
    row?.copy_date ||
    row?.copyDate
  );
  const amount = firstFinite(
    row?.payablePrincipal,
    row?.defaultAmount,
    row?.amount,
    row?.payAmount,
    row?.money
  );
  const usageValue = firstFinite(
    row?.consumedVolume,
    row?.waterNum,
    row?.waternum,
    row?.dosage
  );

  if (!statementDate || amount === null) {
    return null;
  }

  return {
    accountId: account.id,
    statementDate,
    periodStart: normalizeDate(row?.costDate || row?.costdate || row?.startDate || row?.startdate),
    periodEnd: normalizeDate(row?.metertime || row?.meterTime || row?.endDate || row?.enddate),
    usageValue,
    usageUnit: usageValue !== null ? "m3" : null,
    amount,
    currency: "CNY",
    sourceChannel: "wt.hzwgc.com",
    recordType: "bill",
    status: /(?:\u5df2|\u9500\u8d26|\u7f34\u8d39|\u652f\u4ed8)/i.test(String(row?.payStatus ?? "")) ? "confirmed" : "pending",
    isEstimated: false,
    raw: row
  };
}

async function fetchMeters(config, account, credentials) {
  const result = await postWaterJson(
    config,
    credentials,
    config.meterListPath,
    buildRequestPayload(config, credentials)
  );
  const rows = Array.isArray(result?.data) ? result.data : [];
  const meter = pickMeterRow(rows, account, credentials);
  return {
    rows,
    meter
  };
}

async function fetchPayHistory(config, account, credentials, meterNumber) {
  const range = currentYearRange();
  const result = await postWaterJson(
    config,
    credentials,
    config.payHistoryPath,
    buildRequestPayload(config, credentials, {
      meterNumber,
      startDate: range.startDate,
      endDate: range.endDate,
      payStatus: 2
    })
  );
  return Array.isArray(result?.data) ? result.data : [];
}

export async function testHzWaterConnection({ account, credentials }) {
  const config = getWaterConfig();
  const token = resolveWaterToken(credentials);
  const cookieHeader = resolveCookieHeader(credentials);
  const unid = resolveWaterUnid(credentials);

  if (!token && !cookieHeader) {
    throw new Error("杭州水务当前请先填写 waterUserToken。只有在你明确抓到了可用会话 CK 时，才建议改填 cookieHeader。");
  }

  const { rows, meter } = await fetchMeters(config, account, credentials);
  const meterNumber = getMeterNumber(meter, account, credentials);
  if (!meterNumber) {
    throw new Error("No water meter could be resolved for this account");
  }

  return {
    ok: true,
    summary: "Hangzhou Water session is valid",
    details: {
      provider: account.provider,
      utilityType: account.utilityType,
      tokenConfigured: Boolean(token),
      cookieConfigured: Boolean(cookieHeader),
      unidConfigured: Boolean(unid),
      meterCount: rows.length,
      meterNumber
    }
  };
}

export async function collectHzWaterBills({ account, credentials }) {
  const config = getWaterConfig();
  const { rows, meter } = await fetchMeters(config, account, credentials);
  const meterNumber = getMeterNumber(meter, account, credentials);
  if (!meterNumber) {
    throw new Error("No water meter could be resolved for this account");
  }

  const payHistory = await fetchPayHistory(config, account, credentials, meterNumber);
  const bills = payHistory
    .map((item) => mapWaterBill(account, item))
    .filter(Boolean);

  return {
    ok: true,
    summary: `Hangzhou Water collected ${bills.length} bill items`,
    details: {
      provider: account.provider,
      utilityType: account.utilityType,
      meterCount: rows.length,
      meterNumber,
      fetchedRows: payHistory.length
    },
    bills
  };
}
