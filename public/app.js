const toast = document.querySelector("#toast");
const names = {electricity: "电费", water: "水费", gas: "燃气费"};
const units = {electricity: "kWh", water: "m³", gas: "m³"};

function showToast(message) {
  if (!toast) return;
  toast.textContent = message;
  toast.style.display = "block";
  setTimeout(() => toast.style.display = "none", 3600);
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: {"content-type": "application/json", ...(options.headers || {})}
  });
  if (res.status === 401) location.href = "/login.html";
  const data = await res.json();
  if (!data.ok) throw new Error(data.message || "璇锋眰澶辫触");
  return data.data ?? data;
}

function money(value) {
  return `¥ ${Number(value || 0).toFixed(2)}`;
}

function statusText(account) {
  if (account.status === "ok") return "正常";
  if (account.status === "error") return "异常";
  if (account.configured) return "已接入";
  return "未接入";
}

function formatDateTime(value) {
  if (!value) return "未导入";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).replace("T", " ");
  return date.toLocaleString("zh-CN", {hour12: false});
}

function providerIdentity(account) {
  const summary = account.sessionSummary || {};
  if (account.utility_type === "electricity") return summary.accountNo ? `用电户号 ${summary.accountNo}` : "已保存国网登录信息";
  if (account.utility_type === "water") return summary.meterNumber ? `水表号 ${summary.meterNumber}` : "已保存杭水登录信息";
  if (account.utility_type === "gas") return summary.userNo ? `燃气户号 ${summary.userNo}` : "已保存燃气登录信息";
  return "已保存登录信息";
}

async function initDashboard() {
  const root = document.querySelector("#summaryCards");
  if (!root) return;
  const data = await api("/api/overview");
  const summary = data.latestSummary || data.summary || {};
  const total = Object.values(summary).reduce((sum, item) => sum + Number(item.amount || 0), 0);
  root.innerHTML = [
    `<div class="card metric"><div class="label">鏈€鏂拌处鍗曞悎璁?/div><div class="value">${money(total)}</div><p class="sub">鍚勬笭閬撴渶杩戜竴鏈熻处鍗?/p></div>`,
    card("electricity", summary.electricity),
    card("water", summary.water),
    card("gas", summary.gas),
  ].join("");
  document.querySelector("#sideStatus").innerHTML = data.accounts.map(item => `${item.provider_name}锛?{statusText(item)}`).join("<br>");
  document.querySelector("#accountStatus").innerHTML = data.accounts.map(item => `<div><span class="status-dot ${item.status === "ok" ? "ok" : item.configured ? "warn" : ""}"></span>${item.provider_name}锛?{statusText(item)}</div>`).join("");
  renderBillGroups(data.billsByType || {});
  const monthly = {};
  for (const item of data.recentBills || []) {
    const key = String(item.statement_date || "").slice(0, 7);
    monthly[key] = (monthly[key] || 0) + Number(item.amount || 0);
  }
  renderBars("#bars", Object.entries(monthly).reverse().slice(-6));
  document.querySelector("#collectAll").onclick = async () => {
    for (const type of ["electricity", "water", "gas"]) {
      try { await api(`/api/collect/${type}`, {method: "POST", body: "{}"}); } catch (error) { showToast(error.message); }
    }
    location.reload();
  };
}

function renderBillGroups(groups) {
  const root = document.querySelector("#recentBills");
  if (!root) return;
  const order = ["electricity", "water", "gas"];
  const html = order.map(type => {
    const rows = groups[type] || [];
    const body = rows.map(item => `<div class="bill-row">
      <div>
        <b>${item.statement_date}</b>
        <div class="sub">${Number(item.usage_value || 0).toFixed(2)} ${item.usage_unit || units[type]}</div>
      </div>
      <b>${money(item.amount)}</b>
    </div>`).join("") || `<p class="helper">鏆傛棤${names[type]}璐﹀崟</p>`;
    return `<section class="bill-group ${type}">
      <div class="bill-group-head"><h3>${names[type]}</h3><span>${rows.length} 鏉?/span></div>
      ${body}
    </section>`;
  }).join("");
  root.innerHTML = html;
}

function card(type, item = {}) {
  const date = item.statementDate ? ` 路 ${item.statementDate}` : "";
  return `<div class="card metric ${type === "electricity" ? "electric-card" : type === "water" ? "water-card" : "gas-card"}"><div class="label">${names[type]}</div><div class="value">${money(item.amount)}</div><p class="sub">鐢ㄩ噺 ${Number(item.usage || 0).toFixed(2)} ${units[type]}${date}</p></div>`;
}

function renderBars(selector, rows) {
  const root = document.querySelector(selector);
  if (!root) return;
  const max = Math.max(...rows.map(([, v]) => Number(v)), 1);
  root.innerHTML = rows.map(([label, value]) => `<div class="bar-wrap"><div class="bar" style="height:${Math.max(24, Number(value) / max * 250)}px"></div><span>${label}</span></div>`).join("") || `<p class="helper">鏆傛棤缁熻鏁版嵁</p>`;
}

async function initAnalytics() {
  const root = document.querySelector("#analyticsBars");
  if (!root) return;
  async function load(period = "month") {
    const data = await api(`/api/analytics?period=${period}`);
    const buckets = {};
    for (const row of data.rows || []) {
      buckets[row.bucket] = (buckets[row.bucket] || 0) + Number(row.amount || 0);
    }
    renderBars("#analyticsBars", Object.entries(buckets).slice(-8));
    document.querySelector("#analyticsRows").innerHTML = (data.rows || []).slice(-12).map(row => `<div class="list-row"><div><b>${row.bucket}</b><div class="sub">${names[row.utility_type]} ${Number(row.usage || 0).toFixed(2)}</div></div><b>${money(row.amount)}</b></div>`).join("") || `<p class="helper">鏆傛棤缁熻鏁版嵁</p>`;
  }
  document.querySelectorAll(".tabs button").forEach(btn => btn.onclick = () => {
    document.querySelectorAll(".tabs button").forEach(item => item.classList.remove("active"));
    btn.classList.add("active");
    load(btn.dataset.period);
  });
  load();
}

async function initAdmin() {
  const providerRoot = document.querySelector("#providerCards");
  if (!providerRoot) return;
  const accounts = await api("/api/accounts");
  const settings = await api("/api/settings");
  providerRoot.innerHTML = accounts.map(account => providerCard(account)).join("");
  document.querySelector("#jobsForm").innerHTML = (settings.jobs || []).map(job => `<label>${names[job.utility_type]}閲囬泦鏃堕棿<input class="input job-time" data-type="${job.utility_type}" value="${job.schedule_time || "07:30"}"></label>`).join("");
  document.querySelector("#wecomWebhook").value = settings.wecom_webhook || "";
  document.querySelector("#pushDaily").checked = settings.push_daily_summary === "true";
  document.querySelector("#pushFailure").checked = settings.push_failure_alert === "true";
  bindProviderActions();
  document.querySelector("#saveSettings").onclick = async () => {
    const jobs = [...document.querySelectorAll(".job-time")].map(input => ({utility_type: input.dataset.type, enabled: true, schedule_time: input.value || "07:30"}));
    await api("/api/settings", {method: "POST", body: JSON.stringify({jobs, wecom_webhook: document.querySelector("#wecomWebhook").value, push_daily_summary: document.querySelector("#pushDaily").checked, push_failure_alert: document.querySelector("#pushFailure").checked})});
    showToast("配置已保存");
  };
}

function providerCard(account) {
  const colorClass = account.utility_type === "electricity" ? "electric-card" : account.utility_type === "water" ? "water-card" : "gas-card";
  const auth = account.authStatus || {};
  const importText = account.configured ? "閲嶆柊璁剧疆" : (account.utility_type === "electricity" ? "濉啓璐﹀彿" : "瀵煎叆鎶撳寘鏂囦欢");
  const local = account.localData || {};
  const todayRun = local.todayRun || {};
  const authClass = auth.needsReauth ? "auth-warning" : "auth-ok";
  const desc = {
    electricity: "填写国网账号和密码。系统每日只登录采集一次，成功后把账单落盘到本地。",
    water: "导入杭水 E 家授权文件。系统每日采集一次，成功后把账单落盘到本地。",
    gas: "导入杭州燃气公众号账单页授权文件。系统每日采集一次，成功后把账单落盘到本地。"
  }[account.utility_type];
  const authNotice = auth.needsReauth
    ? `<div class="auth-banner">登录信息可能已过期，请重新导入。国网每日登录次数有限，测试不会触发登录。</div>`
    : "";
  return `<div class="provider-card ${colorClass}" data-type="${account.utility_type}">
    <div class="provider-head"><h2>${account.provider_name}</h2><span class="tag">${statusText(account)}</span></div>
    <p class="helper">${desc}</p>
    <div class="auth-panel ${authClass}">
      <div><b>当前账号</b><span>${providerIdentity(account)}</span></div>
      <div><b>最后授权</b><span>${formatDateTime(auth.authorizedAt)}</span></div>
      <div><b>预计过期</b><span>${auth.expiresAt ? formatDateTime(auth.expiresAt) : (auth.expiresText || "失效后重新导入")}</span></div>
      <div><b>本地数据</b><span>账单 ${local.billCount || 0} 条，最新 ${local.latestBillDate || "暂无"}</span></div>
      <div><b>今日采集</b><span>${todayRun.status ? `${todayRun.status} · ${todayRun.message || ""}` : "今日尚未执行"}</span></div>
      <div><b>状态说明</b><span>${auth.hint || "登录信息已保存"}</span></div>
    </div>
    ${authNotice}
    ${account.last_test_message ? `<p class="helper">鏈€杩戞祴璇曪細${account.last_test_message}</p>` : ""}
    <div style="display:flex;gap:10px"><button class="btn import-btn">${importText}</button><button class="btn secondary test-btn">检查本地数据</button></div>
  </div>`;
}

function bindProviderActions() {
  const dialog = document.querySelector("#importDialog");
  const scriptBox = document.querySelector("#scriptBox");
  const scriptContent = document.querySelector("#scriptContent");
  const copyScript = document.querySelector("#copyScript");
  const importContent = document.querySelector("#importContent");
  const credentialBox = document.querySelector("#credentialBox");
  const sgccUsername = document.querySelector("#sgccUsername");
  const sgccPassword = document.querySelector("#sgccPassword");
  let currentType = "";
  document.querySelectorAll(".provider-card").forEach(card => {
    const type = card.dataset.type;
    card.querySelector(".import-btn").onclick = () => {
      currentType = type;
      document.querySelector("#dialogTitle").textContent = `${names[type]}接入`;
      document.querySelector("#dialogHelp").textContent = type === "electricity"
        ? "填写国网账号和密码。系统每日只登录采集一次，成功后会把账单落盘到本地；登录状态导入仅作为备用。"
        : "粘贴完整 HAR JSON，系统会自动识别必要登录信息。";
      importContent.value = "";
      if (sgccPassword) sgccPassword.value = "";
      importContent.placeholder = type === "electricity" ? "备用：粘贴国网页面导出的登录状态 JSON" : "粘贴完整 HAR JSON";
      if (credentialBox) credentialBox.hidden = type !== "electricity";
      importContent.hidden = type === "electricity";
      scriptBox.hidden = type !== "electricity";
      scriptContent.value = type === "electricity" ? sgccExportSnippet() : "";
      dialog.showModal();
    };
    card.querySelector(".test-btn").onclick = async () => {
      try {
        const result = await api(`/api/test/${type}`, {method: "POST", body: "{}"});
        showToast(result.message || "杩炴帴鎴愬姛");
        setTimeout(() => location.reload(), 800);
      } catch (error) {
        showToast(error.message);
      }
    };
  });
  document.querySelector("#confirmImport").onclick = async (event) => {
    event.preventDefault();
    try {
      const content = document.querySelector("#importContent").value;
      const body = currentType === "electricity" && (sgccUsername?.value || sgccPassword?.value)
        ? {username: sgccUsername.value, password: sgccPassword.value}
        : {content};
      const result = await api(`/api/import/${currentType}`, {method: "POST", body: JSON.stringify(body)});
      showToast(result.message || "瀵煎叆鎴愬姛");
      dialog.close();
      setTimeout(() => location.reload(), 800);
    } catch (error) {
      showToast(error.message);
    }
  };
  copyScript.onclick = async () => {
    scriptContent.focus();
    scriptContent.select();
    try {
      await navigator.clipboard.writeText(scriptContent.value);
      showToast("脚本已复制");
    } catch (error) {
      document.execCommand("copy");
      showToast("已选中脚本，请按 Ctrl+C 复制");
    }
  };
  scriptContent.onclick = () => scriptContent.select();
}

function sgccExportSnippet() {
  return `(() => {\n  const app = document.querySelector("#app");\n  const vue = app && app.__vue__ ? app.__vue__ : null;\n  const root = vue && vue.$root ? vue.$root : null;\n  const store = root && root.$store ? root.$store : null;\n  const getters = (store && store.getters) || {};\n  const mustKeys = ["getRequestCyu", "getAccessToken", "getToken", "getUserInfo", "getRequestParams"];\n  const templateCodes = new Set(["010102", "010103"]);\n  const pattern = /key|token|access|request|public|user|power|door|auth|account/i;\n  const clone = (value) => {\n    if (typeof value === "string") return value;\n    return JSON.parse(JSON.stringify(value));\n  };\n  const readGetter = (key) => {\n    try {\n      const value = getters[key];\n      if (value !== undefined && value !== null) return clone(value);\n    } catch (error) {\n      return String(error);\n    }\n    return undefined;\n  };\n  const pick = (obj) => {\n    const out = {};\n    if (!obj || typeof obj !== "object") return out;\n    const keys = new Set([...mustKeys, ...Object.keys(obj).filter((key) => pattern.test(key))]);\n    for (const key of keys) {\n      const value = readGetter(key);\n      if (value !== undefined) out[key] = value;\n    }\n    return out;\n  };\n  const normalizeTemplate = (value) => {\n    if (!value || typeof value !== "object") return null;\n    const body = value.requestBody && typeof value.requestBody === "object" ? value.requestBody : value;\n    return templateCodes.has(String(body.params4 || "")) ? clone(body) : null;\n  };\n  const requestTemplates = [];\n  const seenTemplates = new Set();\n  const addTemplate = (value) => {\n    try {\n      const template = normalizeTemplate(value);\n      if (!template) return;\n      const key = template.params4 + ":" + JSON.stringify(template).slice(0, 300);\n      if (seenTemplates.has(key)) return;\n      seenTemplates.add(key);\n      requestTemplates.push(template);\n    } catch (error) {}\n  };\n  const visited = new WeakSet();\n  let scanned = 0;\n  const scan = (value, depth = 0) => {\n    if (!value || typeof value !== "object" || depth > 8 || scanned > 5000) return;\n    if (visited.has(value)) return;\n    visited.add(value);\n    scanned += 1;\n    addTemplate(value);\n    if (Array.isArray(value)) {\n      for (const item of value) scan(item, depth + 1);\n      return;\n    }\n    for (const key of Object.keys(value)) {\n      if (key === "$parent" || key === "$root" || key === "__ob__" || key === "_watchers") continue;\n      try {\n        scan(value[key], depth + 1);\n      } catch (error) {}\n    }\n  };\n  const getterHits = pick(getters);\n  scan(getterHits.getRequestParams);\n  scan(store && store.state);\n  scan(root && root.$data);\n  scan(root && root.$children);\n  if (requestTemplates.length) {\n    const existing = Array.isArray(getterHits.getRequestParams) ? getterHits.getRequestParams : [];\n    getterHits.getRequestParams = [...existing, ...requestTemplates.map((item) => ({ requestBody: item }))];\n  }\n  const foundCodes = new Set((getterHits.getRequestParams || []).map((item) => String(((item || {}).requestBody || item || {}).params4 || "")));\n  const missing = mustKeys.filter((key) => !getterHits[key]);\n  const missingTemplates = [...templateCodes].filter((code) => !foundCodes.has(code));\n  const output = JSON.stringify({\n    result: { value: {\n      href: location.href,\n      title: document.title,\n      missing,\n      missingTemplates,\n      getterKeys: Object.keys(getters),\n      scanned,\n      requestTemplates,\n      getterHits,\n      sessionHits: Object.fromEntries(Object.entries({ ...sessionStorage }).filter(([key]) => pattern.test(key))),\n      localHits: Object.fromEntries(Object.entries({ ...localStorage }).filter(([key]) => pattern.test(key)))\n    }}\n  }, null, 2);\n  console.log(output);\n  if (typeof copy === "function") copy(output);\n  return missing.length || missingTemplates.length\n    ? "宸插鍑猴紝浣嗕粛缂哄皯锛? + [...missing, ...missingTemplates].join(", ") + "銆傝纭褰撳墠椤甸潰鏄浗缃戠數璐硅处鍗曢〉锛屽苟绛夊緟璐﹀崟鍔犺浇瀹屾垚鍚庨噸璇曘€?\n    : "宸茬敓鎴愮櫥褰曚俊鎭?JSON锛涘鏋滄祻瑙堝櫒鍏佽锛屽唴瀹瑰凡鑷姩澶嶅埗銆傚惁鍒欒澶嶅埗涓婃柟 console.log 杈撳嚭鐨勫畬鏁?JSON銆?;\n})()`;
}

initDashboard().catch(error => showToast(error.message));
initAnalytics().catch(error => showToast(error.message));
initAdmin().catch(error => showToast(error.message));
