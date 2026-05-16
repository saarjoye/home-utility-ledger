const toast = document.querySelector("#toast");
const names = { electricity: "电费", water: "水费", gas: "燃气费" };
const providerNames = { electricity: "国网浙江电力", water: "杭水 E 家", gas: "杭州天然气" };
const units = { electricity: "度", water: "吨", gas: "m³" };
const accents = { electricity: "#20c7c0", water: "#2687ff", gas: "#ff7a35" };

const today = new Date();
const state = {
  period: "month",
  detailType: new URLSearchParams(location.search).get("type") || "electricity",
  start: "",
  end: "",
  billType: "electricity",
  dashboardView: "overview",
  overview: null,
};

function showToast(message) {
  if (!toast) return;
  toast.textContent = message;
  toast.style.display = "block";
  setTimeout(() => { toast.style.display = "none"; }, 3600);
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers || {}) },
  });
  if (res.status === 401) location.href = "/login.html";
  const data = await res.json();
  if (!data.ok) throw new Error(data.message || "请求失败");
  return data.data ?? data;
}

function money(value) {
  if (value === null || value === undefined || value === "") return "待出账";
  return `¥ ${Number(value || 0).toFixed(2)}`;
}

function fmt(value, digits = 2) {
  return Number(value || 0).toFixed(digits);
}

function statusText(account) {
  if (account.status === "ok") return "正常";
  if (account.status === "error") return "需要处理";
  if (account.configured) return "已授权";
  return "未接入";
}

function formatDateTime(value) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).replace("T", " ");
  return date.toLocaleString("zh-CN", { hour12: false });
}

function monthKey(date = today) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function dateKey(date = today) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function rangeFor(period = state.period) {
  const y = today.getFullYear();
  const m = today.getMonth();
  if (period === "day") return { start: dateKey(today), end: dateKey(today), label: dateKey(today), text: "当前：今日" };
  if (period === "week") {
    const day = today.getDay() || 7;
    const start = new Date(y, m, today.getDate() - day + 1);
    const end = new Date(y, m, today.getDate() - day + 7);
    return { start: dateKey(start), end: dateKey(end), label: `${dateKey(start)} 至 ${dateKey(end)}`, text: "当前：本周" };
  }
  if (period === "quarter") {
    const q = Math.floor(m / 3);
    const start = new Date(y, q * 3, 1);
    const end = new Date(y, q * 3 + 3, 0);
    return { start: dateKey(start), end: dateKey(end), label: `${y} 年 Q${q + 1}`, text: `当前：${y} 年第 ${q + 1} 季度` };
  }
  if (period === "year") return { start: `${y}-01-01`, end: `${y}-12-31`, label: `${y} 年`, text: `当前：${y} 年` };
  if (period === "custom" && state.start && state.end) return { start: state.start, end: state.end, label: `${state.start} 至 ${state.end}`, text: "当前：自定义时间" };
  const end = new Date(y, m + 1, 0);
  return { start: `${monthKey()}-01`, end: dateKey(end), label: `${monthKey()}-01 至 ${dateKey(end)}`, text: `当前：${y} 年 ${m + 1} 月` };
}

function latestDate(summary) {
  const dates = Object.values(summary || {}).map((item) => item.statementDate).filter(Boolean).sort();
  return dates.length ? dates[dates.length - 1] : "--";
}

function inRange(value, range) {
  if (!value) return false;
  const key = String(value).slice(0, 10);
  return key >= range.start && key <= range.end;
}

function summarizeBills(rows) {
  const total = rows.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const usage = rows.reduce((sum, item) => sum + Number(item.usage_value || 0), 0);
  const last = [...rows].sort((a, b) => String(a.statement_date).localeCompare(String(b.statement_date))).pop() || {};
  return { amount: rows.length ? total : null, usage, statementDate: last.statement_date || "", source: "bill", count: rows.length };
}

function summarizeDaily(rows) {
  const amountRows = rows.filter((item) => item.amount !== null && item.amount !== undefined && item.amount !== "");
  const total = amountRows.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const usage = rows.reduce((sum, item) => sum + Number(item.usage_value || 0), 0);
  const last = [...rows].sort((a, b) => String(a.usage_date).localeCompare(String(b.usage_date))).pop() || {};
  return { amount: amountRows.length ? total : null, usage, statementDate: last.usage_date || "", source: "daily", count: rows.length };
}

function scopedOverview(data) {
  const range = rangeFor();
  const sourceBills = data.billsByType || {};
  const billsByType = {
    electricity: (sourceBills.electricity || []).filter((item) => inRange(item.statement_date, range)),
    water: (sourceBills.water || []).filter((item) => inRange(item.statement_date, range)),
    gas: (sourceBills.gas || []).filter((item) => inRange(item.statement_date, range)),
  };
  const dailyUsage = (data.dailyUsage || []).filter((item) => inRange(item.usage_date, range));
  const electricBills = billsByType.electricity;
  const electricBillSummary = summarizeBills(electricBills);
  const electricDailySummary = summarizeDaily(dailyUsage);
  const latestSummary = {
    electricity: {
      ...electricDailySummary,
      amount: electricBillSummary.amount,
      billAmount: electricBillSummary.amount,
      billDate: electricBillSummary.statementDate,
      statementDate: electricDailySummary.statementDate || electricBillSummary.statementDate,
      source: dailyUsage.length ? "daily+bill" : "bill",
    },
    water: summarizeBills(billsByType.water),
    gas: summarizeBills(billsByType.gas),
  };
  const recentBills = Object.values(billsByType).flat().sort((a, b) => String(b.statement_date).localeCompare(String(a.statement_date))).slice(0, 12);
  return { ...data, latestSummary, billsByType, dailyUsage, recentBills };
}

function latestRun(accounts) {
  const dates = (accounts || []).flatMap((item) => [item.last_collected_at, item.localData?.todayRun?.finished_at]).filter(Boolean).sort();
  return dates.length ? formatDateTime(dates[dates.length - 1]) : "--";
}

function providerIdentity(account) {
  if (!account || !account.configured) return "未接入";
  const summary = account.sessionSummary || {};
  if (account.utility_type === "electricity") return summary.accountNo ? `户号 ${summary.accountNo}` : "已保存国网登录信息";
  if (account.utility_type === "water") return summary.meterNumber ? `户号 ${summary.meterNumber}` : "已保存杭水授权";
  if (account.utility_type === "gas") return summary.userNo ? `户号 ${summary.userNo}` : "已保存燃气授权";
  return "已保存授权";
}

function wireRangeTabs(rootSelector, onChange) {
  const root = document.querySelector(rootSelector);
  if (!root) return;
  root.querySelectorAll("button").forEach((btn) => {
    btn.onclick = () => {
      const period = btn.dataset.period;
      if (period === "custom") {
        openRangeDialog(onChange);
        return;
      }
      state.period = period;
      state.start = "";
      state.end = "";
      root.querySelectorAll("button").forEach((item) => item.classList.toggle("active", item === btn));
      onChange(period);
    };
  });
}

function openRangeDialog(onApply) {
  const dialog = document.querySelector("#rangeDialog");
  if (!dialog) return;
  const range = rangeFor("month");
  document.querySelector("#customStart").value = state.start || range.start;
  document.querySelector("#customEnd").value = state.end || range.end;
  document.querySelector("#applyCustomRange").onclick = (event) => {
    event.preventDefault();
    state.period = "custom";
    state.start = document.querySelector("#customStart").value;
    state.end = document.querySelector("#customEnd").value;
    dialog.close();
    document.querySelectorAll(".range-tabs button").forEach((btn) => btn.classList.toggle("active", btn.dataset.period === "custom"));
    onApply("custom");
  };
  dialog.showModal();
}

async function initDashboard() {
  if (!document.querySelector(".dashboard-grid")) return;
  state.overview = await api("/api/overview");
  renderDashboard(state.overview);
  bindDashboardViewTabs(state.overview);
  wireRangeTabs("#rangeTabs", () => renderDashboard(state.overview));
  document.querySelector("#prevRange").onclick = () => showToast("当前版本先按已落盘数据筛选，上一周期快捷切换稍后开放。");
  document.querySelector("#nextRange").onclick = () => showToast("当前版本先按已落盘数据筛选，下一周期快捷切换稍后开放。");
  document.querySelector("#collectAll").onclick = collectAll;
}

function renderDashboard(data) {
  data = scopedOverview(data);
  const range = rangeFor();
  document.querySelector("#rangeText").textContent = range.text;
  document.querySelector("#rangeLabel").textContent = range.label;

  const summary = data.latestSummary || data.summary || {};
  const accounts = data.accounts || [];
  const connected = accounts.filter((item) => item.configured).length;
  const total = Object.values(summary).reduce((sum, item) => sum + Number(item.amount || 0), 0);
  document.querySelector("#monthTotal").textContent = money(total);
  document.querySelector("#monthBreakdown").textContent = `电 ${amountLabel(summary.electricity)} · 水 ${amountLabel(summary.water)} · 燃 ${amountLabel(summary.gas)}`;
  document.querySelector("#connectedCount").textContent = `${connected} 个渠道已接入`;
  document.querySelector("#lastCollect").textContent = `最后采集 ${latestRun(accounts)}`;

  renderSideStatus(accounts);
  renderSummaryCards(summary);
  renderDashboardMainPanel(data);
  bindBillTabs(data);
}

function renderSideStatus(accounts) {
  const root = document.querySelector("#sideStatus");
  if (!root) return;
  root.innerHTML = accounts.map((item) => {
    const local = item.localData || {};
    const dot = item.status === "ok" ? "ok" : item.configured ? "warn" : "";
    const run = local.todayRun;
    const todayRun = run ? `今日已执行：${run.status || "unknown"}` : "今日未采集";
    const dataText = `账单 ${local.billCount || 0} 条，日数据 ${local.dailyCount || 0} 条`;
    return `<div class="status-item"><span class="status-dot ${dot}"></span><b>${providerNames[item.utility_type]}</b><p>${statusText(item)}，${todayRun}<br>${dataText}</p></div>`;
  }).join("");
}

function amountLabel(item = {}) {
  return item.amount === null || item.amount === undefined ? "待出账" : fmt(item.amount);
}

function usageLabel(item = {}, type = "electricity") {
  return `${fmt(item.usage)} ${units[type]}`;
}

function billDateLabel(item = {}) {
  return item.statementDate ? String(item.statementDate).slice(0, 7) : "--";
}

function setDashboardView(view, data = state.overview) {
  state.dashboardView = view || "overview";
  state.billType = state.dashboardView === "overview" ? "electricity" : state.dashboardView;
  document.querySelectorAll("#dashboardViewTabs button").forEach((btn) => btn.classList.toggle("active", btn.dataset.view === state.dashboardView));
  document.querySelectorAll("#billTypeTabs button").forEach((btn) => btn.classList.toggle("active", btn.dataset.type === state.billType));
  if (data) renderDashboard(data);
}

function bindDashboardViewTabs(data) {
  document.querySelectorAll("#dashboardViewTabs button").forEach((btn) => {
    btn.onclick = () => setDashboardView(btn.dataset.view, data);
  });
}

function renderSummaryCards(summary) {
  const root = document.querySelector("#summaryCards");
  root.innerHTML = ["electricity", "water", "gas"].map((type) => {
    const item = summary[type] || {};
    const active = state.dashboardView === type ? "active" : "";
    const action = state.dashboardView === type ? "正在查看" : "切换查看";
    const badge = type === "electricity" ? `最新 ${item.statementDate || "--"}` : `账期 ${String(item.statementDate || "--").slice(0, 7)}`;
    const amountHint = type === "electricity" && item.amount === null && item.usage
      ? "日用电已获取，电费金额待月账单出账"
      : item.statementDate || "暂无账单";
    return `<article class="utility-card ${type} ${active}" data-card-type="${type}">
      <div class="utility-head"><h2>${names[type]}</h2><span>${badge}</span></div>
      <strong>${money(item.amount)}</strong>
      <p>${type === "electricity" ? "本月" : "本期"} ${fmt(item.usage)} ${units[type]} · ${amountHint}</p>
      <button class="btn card-view-btn" type="button" data-view="${type}">${action}</button>
    </article>`;
  }).join("");
  root.querySelectorAll(".card-view-btn").forEach((btn) => {
    btn.onclick = () => setDashboardView(btn.dataset.view, state.overview);
  });
}

function renderCalendar(rows) {
  const root = document.querySelector("#electricCalendar") || document.querySelector("#detailCalendar");
  if (!root) return;
  const range = rangeFor();
  const month = state.period === "custom" && state.start ? state.start.slice(0, 7) : (range.start || monthKey()).slice(0, 7);
  const [yearText, monthText] = month.split("-");
  const year = Number(yearText);
  const monthIndex = Number(monthText) - 1;
  const byDate = Object.fromEntries((rows || []).filter((row) => String(row.usage_date || "").startsWith(month)).map((row) => [row.usage_date, row]));
  const days = new Date(year, monthIndex + 1, 0).getDate();
  const offset = (new Date(year, monthIndex, 1).getDay() || 7) - 1;
  const cells = [];
  for (let i = 0; i < offset; i += 1) cells.push(`<div class="calendar-cell empty"></div>`);
  for (let day = 1; day <= days; day += 1) {
    const key = `${month}-${String(day).padStart(2, "0")}`;
    const row = byDate[key] || {};
    const active = key === latestDate({ electricity: summarizeDaily(rows || []) }) ? "active" : "";
    cells.push(`<div class="calendar-cell ${active}">
      <b>${day}</b>
      <span>${row.usage_value ? `${fmt(row.usage_value)}°` : ""}</span>
      <em>${row.usage_value && (row.amount === null || row.amount === undefined || row.amount === "") ? "待出账" : row.amount ? `${fmt(row.amount)}元` : ""}</em>
    </div>`);
  }
  root.innerHTML = cells.join("");
  const label = `${year} 年 ${monthIndex + 1} 月`;
  const desktopMonth = document.querySelector("#calendarMonth");
  const detailMonth = document.querySelector("#detailCalendarMonth");
  if (desktopMonth) desktopMonth.textContent = label;
  if (detailMonth) detailMonth.textContent = label;
}

function bindBillTabs(data) {
  document.querySelectorAll("#billTypeTabs button").forEach((btn) => {
    btn.onclick = () => {
      state.billType = btn.dataset.type;
      state.dashboardView = btn.dataset.type;
      document.querySelectorAll("#dashboardViewTabs button").forEach((item) => item.classList.toggle("active", item.dataset.view === state.dashboardView));
      document.querySelectorAll("#billTypeTabs button").forEach((item) => item.classList.toggle("active", item === btn));
      renderDashboard(data);
    };
  });
}

function renderDashboardMainPanel(data) {
  const view = state.dashboardView || "overview";
  const type = view === "overview" ? "electricity" : view;
  state.billType = type;
  document.querySelectorAll("#billTypeTabs button").forEach((btn) => btn.classList.toggle("active", btn.dataset.type === type));
  renderMainDataPanel(type, data);
  renderBillGroups(data.billsByType || {});
  renderTrend(type, data);
}

function renderMainDataPanel(type, data) {
  const title = document.querySelector("#mainDataTitle");
  const note = document.querySelector("#mainDataNote");
  const weekdays = document.querySelector("#desktopWeekdays");
  const calendarMonth = document.querySelector("#calendarMonth");
  const billTitle = document.querySelector("#billPanelTitle");
  if (billTitle) billTitle.textContent = `${names[type]}详细账单`;
  if (type === "electricity") {
    if (title) title.textContent = "电费用量日历";
    if (note) note.textContent = "日历展示已落盘的日用电量；单日费用通常需要等待国网月账单出账。";
    if (weekdays) weekdays.hidden = false;
    renderCalendar(data.dailyUsage || []);
    return;
  }
  const summary = (data.latestSummary || {})[type] || {};
  const rows = ((data.billsByType || {})[type] || []).slice(0, 6);
  if (title) title.textContent = `${names[type]}账期概览`;
  if (calendarMonth) calendarMonth.textContent = `${billDateLabel(summary)} 账期`;
  if (note) note.textContent = `${names[type]}当前按官方账期账单统计，稳定渠道暂未提供每日明细。`;
  if (weekdays) weekdays.hidden = true;
  const root = document.querySelector("#electricCalendar");
  if (!root) return;
  root.innerHTML = `<div class="period-overview-card ${type}">
    <div class="period-hero">
      <span>当前账期费用</span>
      <strong>${money(summary.amount)}</strong>
      <p>${billDateLabel(summary)} · ${usageLabel(summary, type)}</p>
    </div>
    <div class="period-stat-grid">
      <div><b>账单条数</b><strong>${rows.length}</strong></div>
      <div><b>统计用量</b><strong>${usageLabel(summary, type)}</strong></div>
      <div><b>最新账期</b><strong>${billDateLabel(summary)}</strong></div>
    </div>
    <div class="period-row-list">
      ${rows.map((item) => `<div class="period-row"><span>${item.statement_date}</span><b>${fmt(item.usage_value)} ${item.usage_unit || units[type]}</b><strong>${money(item.amount)}</strong></div>`).join("") || `<p class="helper">暂无${names[type]}账期账单</p>`}
    </div>
  </div>`;
}

function renderBillGroups(groups) {
  const root = document.querySelector("#recentBills");
  if (!root) return;
  const type = state.billType || "electricity";
  const rows = groups[type] || [];
  root.innerHTML = rows.map((item) => `<div class="bill-item">
    <div><b>${item.statement_date}</b><span>${names[type]} · ${fmt(item.usage_value)} ${item.usage_unit || units[type]}</span></div>
    <strong>${money(item.amount)}</strong>
  </div>`).join("") || `<p class="helper">暂无${names[type]}账单</p>`;
}

function renderTrend(type, data) {
  const title = document.querySelector("#trendTitle");
  if (title) title.textContent = type === "electricity" ? "近 7 日用电趋势" : `近 6 期${names[type]}趋势`;
  const rows = type === "electricity"
    ? (data.dailyUsage || []).slice(0, 7).reverse().map((row) => [String(row.usage_date).slice(5), Number(row.amount || row.usage_value || 0)])
    : ((data.billsByType || {})[type] || []).slice(0, 6).reverse().map((row) => [String(row.statement_date).slice(0, 7), Number(row.amount || 0)]);
  renderBars("#bars", rows, accents[type]);
}

function renderBars(selector, rows, color = "#20c7c0") {
  const root = document.querySelector(selector);
  if (!root) return;
  const max = Math.max(...rows.map(([, value]) => Number(value)), 1);
  root.innerHTML = rows.map(([label, value], index) => `<div class="bar-wrap">
    <div class="bar" style="height:${Math.max(30, Number(value) / max * 170)}px;background:${index === rows.length - 1 ? "#7c4dff" : color}"></div>
    <span>${label}</span>
  </div>`).join("") || `<p class="helper">暂无统计数据</p>`;
}

async function collectAll() {
  for (const type of ["electricity", "water", "gas"]) {
    try {
      await api(`/api/collect/${type}`, { method: "POST", body: "{}" });
    } catch (error) {
      showToast(error.message);
    }
  }
  location.reload();
}

async function initDetail() {
  if (!document.querySelector(".mobile-detail")) return;
  const data = await api("/api/overview");
  state.overview = data;
  renderDetail(data);
  wireRangeTabs("#detailRangeTabs", () => renderDetail(data));
}

function renderDetail(data) {
  data = scopedOverview(data);
  const type = state.detailType;
  const summary = (data.latestSummary || {})[type] || {};
  const account = (data.accounts || []).find((item) => item.utility_type === type) || {};
  const range = rangeFor();
  document.body.dataset.detail = type;
  document.querySelector("#detailTitle").textContent = `${names[type]}信息`;
  document.querySelector("#detailRefresh").textContent = latestRun(data.accounts || []);
  document.querySelector("#detailPeriod").textContent = summary.statementDate ? String(summary.statementDate).slice(0, 7) : "--";
  document.querySelector("#detailAmountLabel").textContent = type === "electricity" ? "最近电费账单" : `本期${names[type]}`;
  document.querySelector("#detailAmount").textContent = money(summary.amount);
  document.querySelector("#detailRangeLabel").textContent = range.label;
  document.querySelector("#detailBillTitle").textContent = `${names[type]}账单列表`;
  document.querySelector("#detailTrendTitle").textContent = type === "electricity" ? "近 7 日用电柱状图" : `近 6 期${names[type]}趋势`;
  document.querySelectorAll("#detailRangeTabs button").forEach((btn) => {
    const limited = type !== "electricity" && ["day", "week"].includes(btn.dataset.period);
    btn.hidden = limited;
    if (limited && btn.classList.contains("active")) {
      state.period = "month";
      btn.classList.remove("active");
      document.querySelector('#detailRangeTabs button[data-period="month"]').classList.add("active");
    }
  });
  renderDetailMetrics(type, summary, data);
  renderDetailInfo(type, account, summary);
  renderDetailAvailability(type);
  renderCalendar(data.dailyUsage || []);
  document.querySelector("#detailCalendarCard").hidden = type !== "electricity";
  document.querySelector("#periodInfoCard").hidden = type === "electricity";
  const trendRows = type === "electricity"
    ? (data.dailyUsage || []).slice(0, 7).reverse().map((row) => [String(row.usage_date).slice(5), Number(row.amount || row.usage_value || 0)])
    : ((data.billsByType || {})[type] || []).slice(0, 6).reverse().map((row) => [String(row.statement_date).slice(0, 7), Number(row.amount || 0)]);
  renderBars("#analyticsBars", trendRows, accents[type]);
  renderDetailBills(type, (data.billsByType || {})[type] || []);
}

function renderDetailAvailability(type) {
  let note = document.querySelector("#detailDataNote");
  if (!note) {
    note = document.createElement("p");
    note.id = "detailDataNote";
    note.className = "helper data-note";
    document.querySelector(".detail-metrics")?.after(note);
  }
  note.textContent = type === "electricity"
    ? "电费日历展示已采集的日用电量；单日金额通常要等国网月账单出账后才能确认。"
    : `${names[type]}目前按账期账单统计，官方渠道未提供可稳定采集的每日用量明细。`;
}

function renderDetailMetrics(type, summary, data) {
  const bills = ((data.billsByType || {})[type] || []);
  const previous = bills[1] || {};
  const usage = Number(summary.usage || 0);
  const previousUsage = Number(previous.usage_value || 0);
  const change = previousUsage ? Math.round((usage - previousUsage) / previousUsage * 100) : 0;
  const metrics = type === "electricity"
    ? [["日总用电", usage ? fmt(usage) + "°" : "--"], ["日电费", "待出账"], ["本月用电", fmt(usage) + "°"], ["最近账单", money(summary.billAmount ?? summary.amount)], ["年电费", money(bills.length ? bills.reduce((sum, item) => sum + Number(item.amount || 0), 0) : null)], ["年用电", fmt(bills.reduce((sum, item) => sum + Number(item.usage_value || 0), 0)) + "°"]]
    : [[`本期${type === "water" ? "用水" : "用气"}`, `${fmt(usage)}${units[type]}`], [`上期${type === "water" ? "用水" : "用气"}`, `${fmt(previousUsage)}${units[type]}`], ["同比变化", `${change >= 0 ? "+" : ""}${change}%`], [`季度${names[type]}`, money(bills.slice(0, 3).reduce((sum, item) => sum + Number(item.amount || 0), 0))], [`年度${type === "water" ? "用水" : "用气"}`, `${fmt(bills.reduce((sum, item) => sum + Number(item.usage_value || 0), 0), 0)}${units[type]}`], [`年度${names[type]}`, money(bills.reduce((sum, item) => sum + Number(item.amount || 0), 0))]];
  document.querySelector("#detailMetrics").innerHTML = metrics.map(([label, value]) => `<div><b>${label}</b><strong>${value}</strong></div>`).join("");
}

function renderDetailInfo(type, account, summary) {
  const root = document.querySelector("#periodInfo");
  if (!root) return;
  const rows = type === "water"
    ? [["抄表日期", summary.statementDate || "--"], ["用户编号", providerIdentity(account)], ["缴费状态", "已缴清"]]
    : [["燃气户号", providerIdentity(account)], ["表具编号", account.sessionSummary?.orgId || "--"], ["账单状态", "已出账"]];
  root.innerHTML = rows.map(([label, value]) => `<div><span>${label}</span><b>${value}</b></div>`).join("");
}

function renderDetailBills(type, rows) {
  const root = document.querySelector("#analyticsRows");
  root.innerHTML = rows.map((item) => `<div class="bill-item ${type}">
    <div><b>${String(item.statement_date).slice(0, 7)} ${type === "electricity" ? "电费" : type === "water" ? "用水" : "用气"} ${fmt(item.usage_value)} ${item.usage_unit || units[type]}</b></div>
    <strong>${money(item.amount)}</strong>
  </div>`).join("") || `<p class="helper">暂无${names[type]}账单</p>`;
}

async function initAdmin() {
  const providerRoot = document.querySelector("#channels");
  if (!providerRoot) return;
  const accounts = await api("/api/accounts");
  const settings = await api("/api/settings");
  providerRoot.innerHTML = accounts.map((account) => providerCard(account)).join("");
  document.querySelector("#jobsForm").innerHTML = (settings.jobs || []).map((job) => `<label>${names[job.utility_type]}采集时间<input class="input job-time" data-type="${job.utility_type}" value="${job.schedule_time || "07:30"}"></label>`).join("");
  document.querySelector("#wecomWebhook").value = settings.wecom_webhook || "";
  document.querySelector("#pushDaily").checked = settings.push_daily_summary === "true";
  document.querySelector("#pushFailure").checked = settings.push_failure_alert === "true";
  bindProviderActions();
  await loadLogs();
  document.querySelector("#refreshLogs").onclick = loadLogs;
  document.querySelector("#saveSettings").onclick = async () => {
    const jobs = [...document.querySelectorAll(".job-time")].map((input) => ({ utility_type: input.dataset.type, enabled: true, schedule_time: input.value || "07:30" }));
    await api("/api/settings", { method: "POST", body: JSON.stringify({ jobs, wecom_webhook: document.querySelector("#wecomWebhook").value, push_daily_summary: document.querySelector("#pushDaily").checked, push_failure_alert: document.querySelector("#pushFailure").checked }) });
    showToast("配置已保存");
  };
}

async function loadLogs() {
  const root = document.querySelector("#logList");
  if (!root) return;
  try {
    const rows = await api("/api/logs?limit=80");
    root.innerHTML = rows.map((row) => logRow(row)).join("") || `<p class="helper">暂无采集日志</p>`;
  } catch (error) {
    root.innerHTML = `<p class="helper">日志读取失败：${error.message}</p>`;
  }
}

function logRow(row) {
  const details = row.details || {};
  const counts = [
    details.billsReceived !== undefined ? `账单 ${details.billsReceived} 条` : "",
    details.dailyReceived !== undefined ? `日数据 ${details.dailyReceived} 条` : "",
    details.billsInserted !== undefined ? `新增账单 ${details.billsInserted} 条` : "",
    details.dailyInserted !== undefined ? `新增日数据 ${details.dailyInserted} 条` : "",
  ].filter(Boolean).join(" · ");
  const rowsHtml = renderLogDetailRows(details);
  const diagnosis = renderLogDiagnosis(details);
  const errorText = details.raw ? `<small>原始返回：${String(details.raw).slice(0, 180)}</small>` : "";
  return `<article class="log-row ${row.level}">
    <div><b>${row.module}</b><span>${formatDateTime(row.created_at)}</span></div>
    <p>${row.message}</p>
    ${counts ? `<em>${counts}</em>` : ""}
    ${diagnosis}
    ${rowsHtml}
    ${errorText}
  </article>`;
}

function renderLogDiagnosis(details) {
  const lines = [
    details.provider ? `渠道：${details.provider}` : "",
    details.stage ? `阶段：${details.stage}` : "",
    details.code ? `错误码：${details.code}` : "",
    details.explain ? `说明：${details.explain}` : "",
    details.suggestion ? `建议：${details.suggestion}` : "",
  ].filter(Boolean);
  return lines.length ? `<div class="log-diagnosis">${lines.map((line) => `<span>${line}</span>`).join("")}</div>` : "";
}

function renderLogDetailRows(details) {
  const billRows = details.billRows || [];
  const dailyRows = details.dailyRows || [];
  if (!billRows.length && !dailyRows.length) {
    const dates = [
      details.billDates?.length ? `账单日期：${details.billDates.join("、")}` : "",
      details.dailyDates?.length ? `日数据：${details.dailyDates.join("、")}` : "",
    ].filter(Boolean).join("<br>");
    return dates ? `<small>${dates}</small>` : "";
  }
  const billHtml = billRows.map((item) => logDetailItem("账单", item)).join("");
  const dailyHtml = dailyRows.map((item) => logDetailItem("日用量", item)).join("");
  return `<div class="log-detail-table">${billHtml}${dailyHtml}</div>`;
}

function logDetailItem(label, item) {
  const usage = item.usage === null || item.usage === undefined || item.usage === "" ? "--" : `${fmt(item.usage)} ${item.unit || ""}`.trim();
  const amount = item.amount === null || item.amount === undefined || item.amount === "" ? "费用待出账" : money(item.amount);
  const status = item.status === "amount_pending" ? "待出账" : item.status || "已确认";
  return `<div class="log-detail-row">
    <span>${label}</span>
    <b>${item.date || "--"}</b>
    <span>用量 ${usage}</span>
    <strong>${amount}</strong>
    <small>${status}${item.source ? ` · ${item.source}` : ""}</small>
  </div>`;
}

function providerCard(account) {
  const auth = account.authStatus || {};
  const local = account.localData || {};
  const todayRun = local.todayRun || {};
  const expires = auth.expiresAt ? formatDateTime(auth.expiresAt) : (auth.expiresText || "失效后重新授权");
  const hint = !account.configured ? "未接入" : auth.needsReauth ? "即将过期" : statusText(account);
  return `<article class="admin-provider ${account.utility_type}">
    <div class="provider-title"><h2>${providerNames[account.utility_type]}</h2><span>${hint}</span></div>
    <p>当前账号：${providerIdentity(account)}</p>
    <p>最后授权：${formatDateTime(auth.authorizedAt)}</p>
    <p>预计过期：${expires}</p>
    <div class="provider-note">${auth.hint || "授权信息已保存，系统会按计划采集并落盘。"}</div>
    <p>本地数据：账单 ${local.billCount || 0} 条，最新 ${local.latestBillDate || "--"}</p>
    <p>今日采集：${todayRun.status ? `${todayRun.status} · ${todayRun.message || ""}` : "尚未执行"}</p>
    <div class="provider-actions">
      <button class="btn test-btn">测试采集</button>
      <button class="btn secondary import-btn">${account.configured ? "重新授权" : "开始接入"}</button>
    </div>
  </article>`;
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
  document.querySelectorAll(".admin-provider").forEach((card) => {
    const type = [...card.classList].find((item) => ["electricity", "water", "gas"].includes(item));
    card.querySelector(".import-btn").onclick = () => {
      currentType = type;
      document.querySelector("#dialogTitle").textContent = `${names[type]}接入`;
      document.querySelector("#dialogHelp").textContent = type === "electricity"
        ? "填写国网账号和密码。系统每日只登录采集一次；备用导入用于页面授权异常时救急。"
        : "上传或粘贴官方账单页抓包文件，系统会自动识别账号和授权信息。";
      importContent.value = "";
      if (sgccPassword) sgccPassword.value = "";
      if (credentialBox) credentialBox.hidden = type !== "electricity";
      importContent.hidden = type === "electricity";
      scriptBox.hidden = type !== "electricity";
      scriptContent.value = type === "electricity" ? sgccExportSnippet() : "";
      dialog.showModal();
    };
    card.querySelector(".test-btn").onclick = async () => {
      try {
        const result = await api(`/api/test/${type}`, { method: "POST", body: "{}" });
        showToast(result.message || "本地数据可用");
        setTimeout(() => location.reload(), 800);
      } catch (error) {
        showToast(error.message);
      }
    };
  });
  document.querySelector("#confirmImport").onclick = async (event) => {
    event.preventDefault();
    try {
      const content = importContent.value;
      const body = currentType === "electricity" && (sgccUsername?.value || sgccPassword?.value)
        ? { username: sgccUsername.value, password: sgccPassword.value }
        : { content };
      const result = await api(`/api/import/${currentType}`, { method: "POST", body: JSON.stringify(body) });
      showToast(result.message || "保存成功");
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
  return `(() => {
  const app = document.querySelector("#app");
  const vue = app && app.__vue__ ? app.__vue__ : null;
  const root = vue && vue.$root ? vue.$root : null;
  const store = root && root.$store ? root.$store : null;
  const getters = (store && store.getters) || {};
  const keys = ["getRequestCyu", "getAccessToken", "getToken", "getUserInfo", "getRequestParams"];
  const getterHits = {};
  for (const key of keys) {
    try { getterHits[key] = JSON.parse(JSON.stringify(getters[key])); } catch (error) {}
  }
  const output = JSON.stringify({ result: { value: { href: location.href, title: document.title, getterHits } } }, null, 2);
  console.log(output);
  if (typeof copy === "function") copy(output);
  return "已生成登录信息 JSON；如浏览器允许，内容已自动复制。";
})()`;
}

initDashboard().catch((error) => showToast(error.message));
initDetail().catch((error) => showToast(error.message));
initAdmin().catch((error) => showToast(error.message));
