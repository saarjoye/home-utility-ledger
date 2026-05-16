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
  anchorDate: today,
  billType: "electricity",
  dashboardView: "overview",
  detailSearch: "",
  detailPage: 1,
  detailPageSize: 20,
  overview: null,
};

if (["water", "gas"].includes(state.detailType) && !new URLSearchParams(location.search).get("period")) {
  state.period = "all";
}


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

function addMonths(date, amount) {
  const next = new Date(date);
  next.setMonth(next.getMonth() + amount);
  return next;
}

function addYears(date, amount) {
  const next = new Date(date);
  next.setFullYear(next.getFullYear() + amount);
  return next;
}

function rangeFor(period = state.period) {
  const anchor = state.anchorDate instanceof Date && !Number.isNaN(state.anchorDate.getTime()) ? state.anchorDate : today;
  const y = anchor.getFullYear();
  const m = anchor.getMonth();
  if (period === "all") return { start: "0000-01-01", end: "9999-12-31", label: "全部已落盘账单", text: "当前：全部账单" };
  if (period === "day") return { start: dateKey(anchor), end: dateKey(anchor), label: dateKey(anchor), text: "当前：今日" };
  if (period === "week") {
    const day = anchor.getDay() || 7;
    const start = new Date(y, m, anchor.getDate() - day + 1);
    const end = new Date(y, m, anchor.getDate() - day + 7);
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
  const start = `${y}-${String(m + 1).padStart(2, "0")}-01`;
  const end = new Date(y, m + 1, 0);
  return { start, end: dateKey(end), label: `${start} 至 ${dateKey(end)}`, text: `当前：${y} 年 ${m + 1} 月` };
}

function periodNavMeta() {
  const range = rangeFor();
  const anchor = state.anchorDate instanceof Date ? state.anchorDate : today;
  const y = anchor.getFullYear();
  const m = anchor.getMonth();
  if (state.period === "all") return { label: "全部账单", value: "不限定时间", canStep: false };
  if (state.period === "day") return { label: "当前日期", value: dateKey(anchor), canStep: true };
  if (state.period === "week") return { label: "当前周", value: range.label, canStep: true };
  if (state.period === "quarter") return { label: "当前季度", value: `${y} 年 Q${Math.floor(m / 3) + 1}`, canStep: true };
  if (state.period === "year") return { label: "当前年份", value: `${y} 年`, canStep: true };
  if (state.period === "custom") return { label: "自定义时段", value: range.label, canStep: false };
  return { label: "当前月份", value: `${y} 年 ${m + 1} 月`, canStep: true };
}

function shiftPeriod(direction) {
  const step = direction < 0 ? -1 : 1;
  if (state.period === "day") state.anchorDate = new Date(state.anchorDate.getFullYear(), state.anchorDate.getMonth(), state.anchorDate.getDate() + step);
  else if (state.period === "week") state.anchorDate = new Date(state.anchorDate.getFullYear(), state.anchorDate.getMonth(), state.anchorDate.getDate() + step * 7);
  else if (state.period === "quarter") state.anchorDate = addMonths(state.anchorDate, step * 3);
  else if (state.period === "year") state.anchorDate = addYears(state.anchorDate, step);
  else if (state.period === "month") state.anchorDate = addMonths(state.anchorDate, step);
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

function periodMonth(value) {
  return value ? String(value).slice(0, 7) : "--";
}

function periodLabel(row = {}, type = "electricity") {
  const start = row.period_start || row.periodStart || "";
  const end = row.period_end || row.periodEnd || "";
  const statement = row.statement_date || row.statementDate || "";
  if (type === "electricity") return periodMonth(statement);
  if (type === "water") return periodMonth(statement);
  if (start && end) {
    const startMonth = periodMonth(start);
    const endMonth = periodMonth(end);
    return startMonth === endMonth ? startMonth : `${startMonth} 至 ${endMonth}`;
  }
  return periodMonth(statement);
}

function settlementText(row = {}, type = "electricity") {
  if (type === "electricity") return "月度账单";
  if (type === "water") return "月账单";
  const start = row.period_start || row.periodStart || "";
  const end = row.period_end || row.periodEnd || "";
  if (start && end && periodMonth(start) !== periodMonth(end)) return "跨期结算";
  return "结算账单";
}

function filterDetailRows(rows = []) {
  const keyword = String(state.detailSearch || "").trim().toLowerCase();
  if (!keyword) return rows;
  return rows.filter((row) => {
    const haystack = [
      row.statement_date,
      row.period_start,
      row.period_end,
      row.usage_value,
      row.usage_unit,
      row.amount,
      row.source_channel,
      periodLabel(row, state.detailType),
      settlementText(row, state.detailType),
    ].filter((item) => item !== null && item !== undefined).join(" ").toLowerCase();
    return haystack.includes(keyword);
  });
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
  return { ...data, latestSummary, billsByType, dailyUsage, recentBills, allBillsByType: sourceBills };
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
      if (period === "custom" && rootSelector === "#detailRangeTabs") {
        openInlineCustomRange(onChange);
        return;
      }
      if (period === "custom") {
        openRangeDialog(onChange);
        return;
      }
      state.period = period;
      state.start = "";
      state.end = "";
      state.anchorDate = today;
      document.querySelector("#detailCustomRange")?.setAttribute("hidden", "");
      root.querySelectorAll("button").forEach((item) => item.classList.toggle("active", item === btn));
      onChange(period);
    };
  });
}

function openInlineCustomRange(onApply) {
  const panel = document.querySelector("#detailCustomRange");
  const start = document.querySelector("#detailCustomStart");
  const end = document.querySelector("#detailCustomEnd");
  const apply = document.querySelector("#applyDetailCustomRange");
  if (!panel || !start || !end || !apply) return;
  const range = state.start && state.end ? rangeFor("custom") : rangeFor("month");
  start.value = state.start || range.start;
  end.value = state.end || range.end;
  panel.hidden = false;
  start.focus();
  apply.onclick = () => {
    if (!start.value || !end.value) {
      showToast("请选择开始日期和结束日期");
      return;
    }
    if (start.value > end.value) {
      showToast("开始日期不能晚于结束日期");
      return;
    }
    state.period = "custom";
    state.start = start.value;
    state.end = end.value;
    state.anchorDate = new Date(start.value);
    document.querySelectorAll("#detailRangeTabs button").forEach((btn) => btn.classList.toggle("active", btn.dataset.period === "custom"));
    onApply?.("custom");
  };
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
    state.anchorDate = state.start ? new Date(state.start) : today;
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
    const action = state.dashboardView === type ? "查看全部数据" : "进入详情";
    const badge = type === "electricity" ? `最新 ${item.statementDate || "--"}` : `账期 ${String(item.statementDate || "--").slice(0, 7)}`;
    const amountHint = type === "electricity" && item.amount === null && item.usage
      ? "日用电已获取，电费金额待月账单出账"
      : item.statementDate || "暂无账单";
    const detailHref = `/analytics.html?type=${type}${type === "electricity" ? "" : "&period=all"}`;
    return `<article class="utility-card ${type} ${active}" data-card-type="${type}" data-href="${detailHref}" tabindex="0" role="link">
      <div class="utility-head"><h2>${names[type]}</h2><span>${badge}</span></div>
      <strong>${money(item.amount)}</strong>
      <p>${type === "electricity" ? "本月" : "本期"} ${fmt(item.usage)} ${units[type]} · ${amountHint}</p>
      <a class="btn card-detail-link" href="${detailHref}">${action}</a>
    </article>`;
  }).join("");
  root.querySelectorAll(".utility-card[data-href]").forEach((card) => {
    card.onclick = (event) => {
      if (event.target.closest("a")) return;
      location.href = card.dataset.href;
    };
    card.onkeydown = (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        location.href = card.dataset.href;
      }
    };
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
  const period = new URLSearchParams(location.search).get("period");
  if (period) state.period = period;
  const data = await api("/api/overview");
  state.overview = data;
  syncDetailRangeTabs();
  renderDetail(data);
  wireRangeTabs("#detailRangeTabs", () => {
    state.detailPage = 1;
    renderDetail(data);
  });
  const search = document.querySelector("#detailSearch");
  const pageSize = document.querySelector("#detailPageSize");
  if (search) {
    search.oninput = () => {
      state.detailSearch = search.value;
      state.detailPage = 1;
      renderDetail(data);
    };
  }
  if (pageSize) {
    pageSize.onchange = () => {
      state.detailPageSize = Number(pageSize.value || 20);
      state.detailPage = 1;
      renderDetail(data);
    };
  }
  bindPeriodNavigator(data);
}

function bindPeriodNavigator(data) {
  const prev = document.querySelector("#periodPrev");
  const next = document.querySelector("#periodNext");
  if (!prev || !next) return;
  prev.onclick = () => {
    shiftPeriod(-1);
    state.detailPage = 1;
    renderDetail(data);
  };
  next.onclick = () => {
    shiftPeriod(1);
    state.detailPage = 1;
    renderDetail(data);
  };
}

function syncDetailRangeTabs() {
  const root = document.querySelector("#detailRangeTabs");
  if (!root) return;
  const isPeriodBillType = ["water", "gas"].includes(state.detailType);
  let allButton = root.querySelector('button[data-period="all"]');
  if (isPeriodBillType && !allButton) {
    allButton = document.createElement("button");
    allButton.dataset.period = "all";
    allButton.textContent = "全部";
    root.prepend(allButton);
  }
  if (!isPeriodBillType && allButton) allButton.remove();
  root.querySelectorAll("button").forEach((btn) => {
    btn.hidden = isPeriodBillType && ["day", "week"].includes(btn.dataset.period);
    btn.classList.toggle("active", btn.dataset.period === state.period);
  });
}

function syncPeriodNavigator() {
  const nav = document.querySelector("#periodNavigator");
  if (!nav) return;
  const meta = periodNavMeta();
  document.querySelector("#periodNavLabel").textContent = meta.label;
  document.querySelector("#periodNavValue").textContent = meta.value;
  nav.querySelectorAll("button").forEach((button) => {
    button.disabled = !meta.canStep;
  });
}

function renderDetail(data) {
  data = scopedOverview(data);
  const type = state.detailType;
  const summary = (data.latestSummary || {})[type] || {};
  const allRows = ((data.allBillsByType || data.billsByType || {})[type] || []);
  const filteredRows = ((data.billsByType || {})[type] || []);
  const baseRows = state.period === "all" ? allRows : filteredRows;
  const visibleRows = filterDetailRows(baseRows);
  const account = (data.accounts || []).find((item) => item.utility_type === type) || {};
  const range = rangeFor();
  document.body.dataset.detail = type;
  document.querySelector("#detailTitle").textContent = `${names[type]}详情`;
  document.querySelector("#detailRefresh").textContent = latestRun(data.accounts || []);
  document.querySelector("#detailPeriod").textContent = summary.statementDate ? periodMonth(summary.statementDate) : "--";
  document.querySelector("#detailAmountLabel").textContent = type === "electricity" ? "最近电费账单" : "当前账期费用";
  document.querySelector("#detailAmount").textContent = money(summary.amount);
  document.querySelector("#detailRangeLabel").textContent = range.label;
  document.querySelector("#detailBillTitle").textContent = type === "electricity" ? "账单明细" : "账期明细";
  document.querySelector("#periodInfoTitle").textContent = type === "water" ? "水费账期说明" : "燃气结算说明";
  document.querySelector("#detailBillCount").textContent = state.period === "all"
    ? `全部 ${allRows.length} 条`
    : `当前 ${filteredRows.length} 条 / 全部 ${allRows.length} 条`;
  document.querySelector("#detailTrendTitle").textContent = type === "electricity" ? "近 7 日用电" : "账期趋势";
  syncDetailRangeTabs();
  syncPeriodNavigator();
  renderDetailMetrics(type, summary, data);
  renderDetailInfo(type, account, summary);
  renderDetailAvailability(type);
  renderCalendar(data.dailyUsage || []);
  document.querySelector("#detailCalendarCard").hidden = type !== "electricity";
  document.querySelector("#periodInfoCard").hidden = type === "electricity";
  const trendRows = type === "electricity"
    ? (data.dailyUsage || []).slice(0, 7).reverse().map((row) => [String(row.usage_date).slice(5), Number(row.amount || row.usage_value || 0)])
    : baseRows.slice(0, 24).reverse().map((row) => [periodLabel(row, type), Number(row.amount || 0)]);
  renderBars("#analyticsBars", trendRows, accents[type]);
  renderDetailBills(type, visibleRows, allRows.length, filteredRows.length, baseRows.length);
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
    : type === "water"
      ? "水费按官方月账单统计，当前渠道没有稳定的每日用水明细。"
      : "燃气按实际结算账期统计，一条账单可能覆盖 1 个月或多个月，不按每日明细展示。";
}

function renderDetailMetrics(type, summary, data) {
  const bills = ((data.billsByType || {})[type] || []);
  const allBills = ((data.allBillsByType || data.billsByType || {})[type] || []);
  const metricRows = state.period === "all" && type !== "electricity" ? allBills : bills;
  const previous = bills[1] || {};
  const usage = Number(summary.usage || 0);
  const previousUsage = Number(previous.usage_value || 0);
  const change = previousUsage ? Math.round((usage - previousUsage) / previousUsage * 100) : 0;
  const metrics = type === "electricity"
    ? [["日总用电", usage ? fmt(usage) + "°" : "--"], ["日电费", "待出账"], ["本月用电", fmt(usage) + "°"], ["最近账单", money(summary.billAmount ?? summary.amount)], ["年电费", money(bills.length ? bills.reduce((sum, item) => sum + Number(item.amount || 0), 0) : null)], ["年用电", fmt(bills.reduce((sum, item) => sum + Number(item.usage_value || 0), 0)) + "°"]]
    : [["账期条数", metricRows.length], [`统计${type === "water" ? "用水" : "用气"}`, `${fmt(metricRows.reduce((sum, item) => sum + Number(item.usage_value || 0), 0))}${units[type]}`], ["统计费用", money(metricRows.length ? metricRows.reduce((sum, item) => sum + Number(item.amount || 0), 0) : null)], [`当前账期${type === "water" ? "用水" : "用气"}`, `${fmt(usage)}${units[type]}`], [`上期${type === "water" ? "用水" : "用气"}`, `${fmt(previousUsage)}${units[type]}`], ["环比变化", `${change >= 0 ? "+" : ""}${change}%`]];
  document.querySelector("#detailMetrics").innerHTML = metrics.map(([label, value]) => `<div><b>${label}</b><strong>${value}</strong></div>`).join("");
}

function renderDetailInfo(type, account, summary) {
  const root = document.querySelector("#periodInfo");
  if (!root) return;
  const rows = type === "water"
    ? [["账单模型", "按月账单"], ["最近账期", periodMonth(summary.statementDate)], ["用户编号", providerIdentity(account)]]
    : [["账单模型", "按结算账期"], ["最近账期", periodMonth(summary.statementDate)], ["燃气户号", providerIdentity(account)]];
  root.innerHTML = rows.map(([label, value]) => `<div><span>${label}</span><b>${value}</b></div>`).join("");
}

function renderDetailBills(type, rows, totalCount = rows.length, filteredCount = rows.length, scopedCount = rows.length) {
  const root = document.querySelector("#analyticsRows");
  const pager = document.querySelector("#detailPager");
  const pageSize = Math.max(1, Number(state.detailPageSize || 20));
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  state.detailPage = Math.min(Math.max(1, Number(state.detailPage || 1)), pageCount);
  const start = (state.detailPage - 1) * pageSize;
  const pageRows = rows.slice(start, start + pageSize);
  const header = `<p class="helper bill-count-note">当前范围 ${scopedCount} 条，搜索后 ${rows.length} 条，本地共 ${totalCount} 条。</p>`;
  root.innerHTML = header + (pageRows.map((item) => `<div class="bill-item ${type}">
    <div>
      <b>${periodLabel(item, type)} · ${type === "electricity" ? "电费账单" : type === "water" ? "月账单" : settlementText(item, type)}</b>
      <span>${fmt(item.usage_value)} ${item.usage_unit || units[type]} · 出账日 ${String(item.statement_date || "--").slice(0, 10)}</span>
    </div>
    <strong>${money(item.amount)}</strong>
  </div>`).join("") || `<p class="helper">暂无${names[type]}账单；可切换为“全部”查看已落盘历史账单。</p>`);
  if (!pager) return;
  pager.innerHTML = rows.length > pageSize ? `
    <span>第 ${start + 1}-${Math.min(start + pageSize, rows.length)} 条 / 共 ${rows.length} 条</span>
    <div>
      <button class="btn secondary" id="detailPrevPage" ${state.detailPage <= 1 ? "disabled" : ""}>上一页</button>
      <button class="btn" id="detailNextPage" ${state.detailPage >= pageCount ? "disabled" : ""}>下一页</button>
    </div>
  ` : `<span>共 ${rows.length} 条</span>`;
  const prev = document.querySelector("#detailPrevPage");
  const next = document.querySelector("#detailNextPage");
  if (prev) prev.onclick = () => { state.detailPage -= 1; renderDetail(state.overview); };
  if (next) next.onclick = () => { state.detailPage += 1; renderDetail(state.overview); };
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
  bindElectricityHistoryImport();
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
    details.monthlyReceived !== undefined ? `月账单 ${details.monthlyReceived} 条` : "",
    details.monthlyInserted !== undefined ? `写入月账单 ${details.monthlyInserted} 条` : "",
    details.annualReceived !== undefined ? `年度汇总 ${details.annualReceived} 条` : "",
    details.detailReceived !== undefined ? `账单详情 ${details.detailReceived} 条` : "",
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
      ${account.utility_type === "electricity" ? `<button class="btn secondary history-btn" type="button">历史导入</button>` : ""}
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
    const historyBtn = card.querySelector(".history-btn");
    if (historyBtn) {
      historyBtn.onclick = () => document.querySelector("#electricityHistory")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
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

function bindElectricityHistoryImport() {
  const button = document.querySelector("#importElectricityHistory");
  const fileInput = document.querySelector("#electricityHistoryFile");
  const resultRoot = document.querySelector("#electricityHistoryResult");
  if (!button || !fileInput || !resultRoot) return;
  button.onclick = async () => {
    const file = fileInput.files?.[0];
    if (!file) {
      showToast("请先选择国电历史数据 Excel 文件");
      return;
    }
    try {
      button.disabled = true;
      button.textContent = "正在导入...";
      const contentBase64 = await readFileAsBase64(file);
      const result = await api("/api/import/electricity-history", {
        method: "POST",
        body: JSON.stringify({ filename: file.name, contentBase64 }),
      });
      resultRoot.innerHTML = historyImportResult(result);
      showToast(result.message || "国电历史数据已导入");
      await loadLogs();
    } catch (error) {
      resultRoot.innerHTML = `<p class="helper error-text">${error.message}</p>`;
      showToast(error.message);
    } finally {
      button.disabled = false;
      button.textContent = "导入国电历史数据";
    }
  };
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("文件读取失败"));
    reader.readAsDataURL(file);
  });
}

function historyImportResult(result) {
  const data = result.data || result.summary || result;
  const chips = [
    ["月账单", data.monthlyReceived, data.monthlyInserted],
    ["日用电", data.dailyReceived, data.dailyInserted],
    ["年度汇总", data.annualReceived, data.annualSaved],
    ["账单详情", data.detailReceived, data.detailSaved],
  ].map(([label, received, saved]) => `<div><span>${label}</span><b>${received || 0}</b><small>写入 ${saved || 0}</small></div>`).join("");
  const daily = (data.sampleDaily || []).map((row) => `<li>${row.usageDate} · ${fmt(row.usageValue)} 度 · ${money(row.amount)}</li>`).join("");
  const monthly = (data.sampleMonthly || []).map((row) => `<li>${String(row.statementDate || "").slice(0, 7)} · ${fmt(row.usageValue)} 度 · ${money(row.amount)}</li>`).join("");
  const details = (data.sampleDetails || []).slice(0, 6).map((row) => `<li>${row.statementMonth} · ${row.module} · ${row.itemName} ${row.itemValue || ""}${row.unit || ""}</li>`).join("");
  return `<div class="history-result-card">
    <div class="history-result-metrics">${chips}</div>
    <div class="history-result-preview">
      <section><b>日用电预览</b><ul>${daily || "<li>无</li>"}</ul></section>
      <section><b>月账单预览</b><ul>${monthly || "<li>无</li>"}</ul></section>
      <section><b>账单详情预览</b><ul>${details || "<li>无</li>"}</ul></section>
    </div>
  </div>`;
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
