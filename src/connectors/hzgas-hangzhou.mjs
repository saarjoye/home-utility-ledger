function getGasConfig() {
  return {
    baseUrl: process.env.HZGAS_BASE_URL || "https://ht-service.hzgas.cn",
    indexUrl: process.env.HZGAS_INDEX_URL || "https://ht-service.hzgas.cn/web/ui/index",
    billPageUrl: process.env.HZGAS_BILL_PAGE_URL || "https://ht-service.hzgas.cn/web/ui/bill",
    queryBillPath: process.env.HZGAS_QUERY_BILL_PATH || "/OnlineService/transferSystem/queryUserBill",
    userBaseInfoPath: process.env.HZGAS_USER_BASE_INFO_PATH || "/OnlineService/transferSystem/userBaseInfo",
    queryUserByAddressPath: process.env.HZGAS_QUERY_USER_BY_ADDRESS_PATH || "/OnlineService/transferSystem/queryUserInfoByAddreDes",
    timeoutMs: Math.max(5000, Number(process.env.HZGAS_TIMEOUT_MS || 30000)),
    billStates: String(process.env.HZGAS_BILL_STATES || "12,11,41")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
  };
}

function trimText(value) {
  return String(value ?? "").trim();
}

function buildUrl(baseUrl, requestPath, query = {}) {
  const url = new URL(requestPath, baseUrl);
  for (const [key, value] of Object.entries(query || {})) {
    if (value === undefined || value === null || value === "") {
      continue;
    }
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

function resolveCookieHeader(credentials = {}) {
  return trimText(credentials.cookieHeader || credentials.cookies);
}

function resolveAddress(account, credentials = {}) {
  return trimText(
    credentials.address ||
    credentials.addr ||
    credentials.addressText ||
    account.notes
  );
}

function resolveUserNo(account, credentials = {}) {
  return trimText(
    credentials.userNo ||
    credentials.userno ||
    credentials.accountNo ||
    account.accountNo
  );
}

function createHeaders(config, credentials, refererUrl = "") {
  const headers = {
    Accept: "application/json, text/plain, */*",
    Referer: trimText(refererUrl) || config.indexUrl,
    Origin: new URL(config.baseUrl).origin,
    "User-Agent": process.env.HZGAS_USER_AGENT || "Mozilla/5.0 home-utility-ledger"
  };

  const cookieHeader = resolveCookieHeader(credentials);
  if (cookieHeader) {
    headers.Cookie = cookieHeader;
  }

  return headers;
}

async function getGasJson(config, credentials, requestPath, query = {}, refererUrl = "") {
  const response = await fetch(buildUrl(config.baseUrl, requestPath, query), {
    method: "GET",
    headers: createHeaders(config, credentials, refererUrl),
    redirect: "follow",
    signal: AbortSignal.timeout(config.timeoutMs)
  });

  const raw = await response.text();
  let data = null;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(`Hangzhou Gas returned non-JSON response from ${requestPath}`);
  }

  if (!response.ok) {
    throw new Error(data?.message || `Hangzhou Gas request failed with ${response.status}`);
  }

  if (String(data?.status || "") !== "200") {
    throw new Error(data?.message || `Hangzhou Gas request rejected at ${requestPath}`);
  }

  return data;
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

  if (/^\d{6}00$/.test(raw)) {
    return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-01`;
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

function buildBillReferer(config, accountInfo, baseInfo) {
  const params = new URLSearchParams();
  params.set("a", trimText(baseInfo?.addrshortdes || accountInfo?.address));
  params.set("ac", trimText(accountInfo?.userNo));
  params.set("uc", trimText(accountInfo?.userNo));
  params.set("p", trimText(baseInfo?.addrTenantPhone));
  params.set("an", trimText(baseInfo?.addrTenantName || accountInfo?.userName));
  params.set("action", "bill");

  const meterAbout = Array.isArray(baseInfo?.meterAbout) ? baseInfo.meterAbout[0] : null;
  if (meterAbout) {
    params.set("meterAbout", JSON.stringify(meterAbout));
  }

  return `${config.billPageUrl}?${params.toString()}`;
}

async function resolveUserByAddress(config, credentials, address) {
  const result = await getGasJson(
    config,
    credentials,
    config.queryUserByAddressPath,
    { addr: address },
    config.indexUrl
  );
  const rows = Array.isArray(result?.data) ? result.data : [];
  return rows[0] || null;
}

async function fetchBaseInfo(config, credentials, userNo, orgId = "") {
  const attempts = [
    { userNo, orgId },
    { userNo }
  ];

  let lastError = null;
  for (const query of attempts) {
    try {
      const result = await getGasJson(
        config,
        credentials,
        config.userBaseInfoPath,
        query,
        config.indexUrl
      );
      if (result?.data) {
        return result.data;
      }
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("Unable to fetch Hangzhou Gas user base info");
}

async function resolveAccountContext(config, account, credentials) {
  const cookieHeader = resolveCookieHeader(credentials);
  if (!cookieHeader) {
    throw new Error("Hangzhou Gas requires cookieHeader");
  }

  let userNo = resolveUserNo(account, credentials);
  const address = resolveAddress(account, credentials);
  const orgId = trimText(credentials.orgId || credentials.orgID);

  let addressLookup = null;
  if (!userNo && address) {
    addressLookup = await resolveUserByAddress(config, credentials, address);
    userNo = trimText(addressLookup?.userno || addressLookup?.userNo);
  }

  if (!userNo) {
    throw new Error("Hangzhou Gas requires accountNo/userNo, or an address that can resolve a userNo");
  }

  const baseInfo = await fetchBaseInfo(config, credentials, userNo, orgId);

  return {
    userNo,
    orgId,
    address: trimText(addressLookup?.addrDes || baseInfo?.addrshortdes || address),
    baseInfo,
    addressLookup
  };
}

async function fetchBillsForState(config, credentials, accountInfo, state) {
  const refererUrl = buildBillReferer(config, accountInfo, accountInfo.baseInfo);
  const result = await getGasJson(
    config,
    credentials,
    config.queryBillPath,
    {
      userno: accountInfo.userNo,
      state,
      limit: 100
    },
    refererUrl
  );

  return Array.isArray(result?.data) ? result.data : [];
}

function mapBillStatus(state) {
  if (String(state) === "12") {
    return "confirmed";
  }
  if (String(state) === "11") {
    return "pending";
  }
  return "pending";
}

function mapGasBill(account, row) {
  const statementDate = normalizeDate(row?.readPeriod) || normalizeDate(row?.realReadDate) || normalizeDate(row?.payTime);
  const amount = firstFinite(row?.payableAmt, row?.amount1, row?.amount2, row?.amount3);
  const usageValue = firstFinite(row?.billingQty, row?.billingQty1, row?.billingQty2, row?.billingQty3);

  if (!statementDate || amount === null) {
    return null;
  }

  return {
    accountId: account.id,
    statementDate,
    periodStart: null,
    periodEnd: normalizeDate(row?.realReadDate) || normalizeDate(row?.payTime),
    usageValue,
    usageUnit: usageValue !== null ? "m3" : null,
    amount,
    currency: "CNY",
    sourceChannel: "ht-service.hzgas.cn",
    recordType: "bill",
    status: mapBillStatus(row?.state),
    isEstimated: false,
    raw: row
  };
}

function summarizeBaseInfo(accountInfo) {
  const baseInfo = accountInfo.baseInfo || {};
  const meterAbout = Array.isArray(baseInfo.meterAbout) ? baseInfo.meterAbout[0] : null;
  const meterStopAbout = Array.isArray(baseInfo.meterStopAbout) ? baseInfo.meterStopAbout[0] : null;
  return {
    provider: "Hangzhou Gas",
    utilityType: "gas",
    userNo: accountInfo.userNo,
    address: trimText(baseInfo.addrshortdes || accountInfo.address),
    orgId: accountInfo.orgId || null,
    balance: firstFinite(baseInfo.balance),
    meterNo: trimText(meterAbout?.meterNo || meterStopAbout?.meterNo),
    meterId: trimText(meterAbout?.meterId || meterStopAbout?.meterId),
    surplus: trimText(meterAbout?.surplus),
    fireState: trimText(baseInfo.fireState),
    stationName: trimText(baseInfo.stationName)
  };
}

export async function testHzGasConnection({ account, credentials }) {
  const config = getGasConfig();
  const accountInfo = await resolveAccountContext(config, account, credentials);
  return {
    ok: true,
    summary: "Hangzhou Gas session is valid",
    details: summarizeBaseInfo(accountInfo)
  };
}

export async function collectHzGasBills({ account, credentials }) {
  const config = getGasConfig();
  const accountInfo = await resolveAccountContext(config, account, credentials);

  const allRows = [];
  for (const state of config.billStates) {
    const rows = await fetchBillsForState(config, credentials, accountInfo, state);
    for (const row of rows) {
      allRows.push({
        ...row,
        __stateQuery: state
      });
    }
  }

  const bills = allRows
    .map((row) => mapGasBill(account, row))
    .filter(Boolean);

  return {
    ok: true,
    summary: `Hangzhou Gas collected ${bills.length} bill items`,
    details: {
      ...summarizeBaseInfo(accountInfo),
      queriedStates: config.billStates,
      fetchedRows: allRows.length
    },
    bills
  };
}
