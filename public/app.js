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
  if (!data.ok) throw new Error(data.message || "请求失败");
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

async function initDashboard() {
  const root = document.querySelector("#summaryCards");
  if (!root) return;
  const data = await api("/api/overview");
  const summary = data.summary || {};
  const total = Object.values(summary).reduce((sum, item) => sum + Number(item.amount || 0), 0);
  root.innerHTML = [
    `<div class="card metric"><div class="label">本月合计</div><div class="value">${money(total)}</div><p class="sub">来自已采集账单</p></div>`,
    card("electricity", summary.electricity),
    card("water", summary.water),
    card("gas", summary.gas),
  ].join("");
  document.querySelector("#sideStatus").innerHTML = data.accounts.map(item => `${item.provider_name}：${statusText(item)}`).join("<br>");
  document.querySelector("#accountStatus").innerHTML = data.accounts.map(item => `<div><span class="status-dot ${item.status === "ok" ? "ok" : item.configured ? "warn" : ""}"></span>${item.provider_name}：${statusText(item)}</div>`).join("");
  document.querySelector("#recentBills").innerHTML = (data.recentBills || []).map(item => `<div class="list-row"><div><b>${names[item.utility_type]}</b><div class="sub">${item.statement_date} ${item.usage_value || ""}${item.usage_unit || ""}</div></div><b>${money(item.amount)}</b></div>`).join("") || `<p class="helper">暂无账单，先到后台完成接入。</p>`;
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

function card(type, item = {}) {
  return `<div class="card metric ${type === "electricity" ? "electric-card" : type === "water" ? "water-card" : "gas-card"}"><div class="label">${names[type]}</div><div class="value">${money(item.amount)}</div><p class="sub">用量 ${Number(item.usage || 0).toFixed(2)} ${units[type]}</p></div>`;
}

function renderBars(selector, rows) {
  const root = document.querySelector(selector);
  if (!root) return;
  const max = Math.max(...rows.map(([, v]) => Number(v)), 1);
  root.innerHTML = rows.map(([label, value]) => `<div class="bar-wrap"><div class="bar" style="height:${Math.max(24, Number(value) / max * 250)}px"></div><span>${label}</span></div>`).join("") || `<p class="helper">暂无统计数据</p>`;
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
    document.querySelector("#analyticsRows").innerHTML = (data.rows || []).slice(-12).map(row => `<div class="list-row"><div><b>${row.bucket}</b><div class="sub">${names[row.utility_type]} ${Number(row.usage || 0).toFixed(2)}</div></div><b>${money(row.amount)}</b></div>`).join("") || `<p class="helper">暂无统计数据</p>`;
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
  document.querySelector("#jobsForm").innerHTML = (settings.jobs || []).map(job => `<label>${names[job.utility_type]}采集时间<input class="input job-time" data-type="${job.utility_type}" value="${job.schedule_time || "07:30"}"></label>`).join("");
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
  const importText = account.utility_type === "electricity" ? "导入登录状态" : "导入抓包文件";
  const desc = {
    electricity: "登录国网页面后导入登录状态，系统自动获取月账单和近 7 日日用电。",
    water: "导入杭水 e 家抓包文件，系统自动识别水表号和账单接口。",
    gas: "导入公众号查询页抓包文件，系统自动识别燃气户号、机构和账单记录。"
  }[account.utility_type];
  return `<div class="provider-card ${colorClass}" data-type="${account.utility_type}"><div class="provider-head"><h2>${account.provider_name}</h2><span class="tag">${statusText(account)}</span></div><p class="helper">${desc}</p><div class="helper">当前识别：${JSON.stringify(account.sessionSummary || {})}</div><div style="display:flex;gap:10px"><button class="btn import-btn">${importText}</button><button class="btn secondary test-btn">测试连接</button></div></div>`;
}

function bindProviderActions() {
  const dialog = document.querySelector("#importDialog");
  const scriptBox = document.querySelector("#scriptBox");
  const scriptContent = document.querySelector("#scriptContent");
  const copyScript = document.querySelector("#copyScript");
  const importContent = document.querySelector("#importContent");
  let currentType = "";
  document.querySelectorAll(".provider-card").forEach(card => {
    const type = card.dataset.type;
    card.querySelector(".import-btn").onclick = () => {
      currentType = type;
      document.querySelector("#dialogTitle").textContent = `${names[type]}接入`;
      document.querySelector("#dialogHelp").textContent = type === "electricity"
        ? "先复制脚本，到已登录的国网电费页面控制台执行；再把输出的 JSON 粘贴到下方。"
        : "粘贴完整 HAR JSON，系统会自动识别必要登录信息。";
      importContent.value = "";
      importContent.placeholder = type === "electricity" ? "粘贴国网页面控制台输出的完整 JSON" : "粘贴完整 HAR JSON";
      scriptBox.hidden = type !== "electricity";
      scriptContent.value = type === "electricity" ? sgccExportSnippet() : "";
      dialog.showModal();
    };
    card.querySelector(".test-btn").onclick = async () => {
      try {
        const result = await api(`/api/test/${type}`, {method: "POST", body: "{}"});
        showToast(result.message || "连接成功");
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
      const result = await api(`/api/import/${currentType}`, {method: "POST", body: JSON.stringify({content})});
      showToast(result.message || "导入成功");
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
  return `(() => {\n  const app = document.querySelector("#app");\n  const vue = app && app.__vue__ ? app.__vue__ : null;\n  const root = vue && vue.$root ? vue.$root : null;\n  const store = root && root.$store ? root.$store : null;\n  const getters = (store && store.getters) || {};\n  const pattern = /key|token|access|request|public|user|power|door|auth|account/i;\n  const pick = (obj) => {\n    const out = {};\n    if (!obj || typeof obj !== "object") return out;\n    for (const key of Object.keys(obj)) {\n      if (!pattern.test(key)) continue;\n      try {\n        const value = obj[key];\n        out[key] = typeof value === "string" ? value : JSON.parse(JSON.stringify(value));\n      } catch (error) {\n        out[key] = String(error);\n      }\n    }\n    return out;\n  };\n  return JSON.stringify({\n    result: { value: {\n      href: location.href,\n      title: document.title,\n      getterHits: pick(getters),\n      sessionHits: pick({ ...sessionStorage }),\n      localHits: pick({ ...localStorage })\n    }}\n  }, null, 2);\n})()`;
}

initDashboard().catch(error => showToast(error.message));
initAnalytics().catch(error => showToast(error.message));
initAdmin().catch(error => showToast(error.message));
