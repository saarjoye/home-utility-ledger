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
  assertSgccSessionSnapshotForRuntime(credentials);
  return testSgccSessionConnection({ account, credentials });
}

export async function collectSgccZhejiangBills({ account, credentials }) {
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
