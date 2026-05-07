(function () {
  const page = document.body.dataset.page;

  document.addEventListener("DOMContentLoaded", () => {
    if (page === "dashboard") {
      initDashboard();
    } else if (page === "admin") {
      initAdmin();
    }
  });

  async function fetchJson(url, options) {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      ...options,
    });

    if (!response.ok) {
      throw new Error(`${url} returned ${response.status}`);
    }

    return response.json();
  }

  function safeArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function safeNumber(value, fallback = 0) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
  }

  function money(value, currency = "CNY") {
    if (value === null || value === undefined || value === "") {
      return "--";
    }

    return new Intl.NumberFormat("zh-CN", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(safeNumber(value));
  }

  function formatValue(value, unit) {
    if (value === null || value === undefined || value === "") {
      return "--";
    }

    return unit ? `${value} ${unit}` : `${value}`;
  }

  function setText(id, value) {
    const element = document.getElementById(id);
    if (element) {
      element.textContent = value;
    }
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function renderError(container, message) {
    container.innerHTML = `<div class="error-state">${escapeHtml(message)}</div>`;
  }

  function renderEmpty(container, message) {
    container.innerHTML = `<div class="empty-state">${escapeHtml(message)}</div>`;
  }

  function statusClass(status) {
    const value = String(status || "").toLowerCase();
    if (["ok", "healthy", "success", "synced", "enabled", "normal"].includes(value)) {
      return "good";
    }
    if (["warn", "warning", "pending", "degraded", "manual"].includes(value)) {
      return "warn";
    }
    if (["bad", "error", "failed", "down", "critical"].includes(value)) {
      return "bad";
    }
    return "info";
  }

  function utilityColor(type) {
    const value = String(type || "").toLowerCase();
    if (value.includes("water") || value.includes("水")) return "var(--water)";
    if (value.includes("gas") || value.includes("燃")) return "var(--gas)";
    return "var(--elec)";
  }

  async function initDashboard() {
    const utilityCards = document.getElementById("utilityCards");
    const statusList = document.getElementById("sourceStatusList");
    const billTableBody = document.getElementById("billTableBody");
    const timeline = document.getElementById("activityTimeline");

    const [summaryResult, trendResult, feedResult, billsResult] = await Promise.allSettled([
      fetchJson("/api/dashboard/summary"),
      fetchJson("/api/dashboard/trends"),
      fetchJson("/api/dashboard/feed"),
      fetchJson("/api/dashboard/bills?limit=8"),
    ]);

    if (summaryResult.status === "fulfilled") {
      renderDashboardSummary(summaryResult.value);
    } else {
      setText("heroDescription", `摘要接口加载失败: ${summaryResult.reason.message}`);
      renderError(utilityCards, "未能加载本月费用分项。");
      renderError(statusList, "未能加载采集状态。");
    }

    if (trendResult.status === "fulfilled") {
      renderTrendChart(trendResult.value);
    } else {
      const trendChart = document.getElementById("trendChart");
      trendChart.innerHTML = "";
      trendChart.closest(".chart-card").insertAdjacentHTML(
        "beforeend",
        `<div class="error-state">趋势接口加载失败: ${escapeHtml(trendResult.reason.message)}</div>`
      );
    }

    if (feedResult.status === "fulfilled") {
      renderActivityFeed(feedResult.value);
    } else {
      renderError(timeline, "未能加载最近动态。");
      const compositionChart = document.getElementById("compositionChart");
      compositionChart.innerHTML = "";
    }

    if (billsResult.status === "fulfilled") {
      renderBillsTable(billsResult.value);
    } else {
      billTableBody.innerHTML = `<tr><td colspan="7"><div class="error-state">账单接口加载失败: ${escapeHtml(billsResult.reason.message)}</div></td></tr>`;
    }
  }

  function renderDashboardSummary(payload) {
    const summary = payload.summary || payload;
    const utilities = safeArray(payload.utilities || summary.utilities);
    const sources = safeArray(payload.sources || summary.sources);
    const heroStats = safeArray(summary.heroStats);

    setText("dashboardLastSync", `最近同步: ${summary.lastSyncAt || "未知"}`);
    setText("dashboardHomeLabel", `家庭: ${summary.homeName || summary.regionName || "未命名家庭"}`);
    setText("heroHeadline", summary.headline || "聚合家庭近期支出与异常动态。");
    setText("heroDescription", summary.description || "正在展示来自接口的实时账单数据。");
    setText("sidebarTotalAmount", money(summary.totalAmount, summary.currency || "CNY"));
    setText("sidebarInsight", summary.sidebarInsight || summary.insight || "接口未返回提醒文案。");
    setText("todayUsageValue", formatValue(summary.todayUsageValue, summary.todayUsageUnit));
    setText("todayUsageSummary", summary.todayUsageSummary || "接口未返回今日摘要。");
    setText("dashboardFootnote", summary.footnote || "页面按接口实际返回渲染；缺失字段会展示为空态。");

    const statsContainer = document.getElementById("heroStats");
    const fallbackStats = [
      { label: "本月总支出", value: money(summary.totalAmount, summary.currency || "CNY") },
      { label: "昨日用电费用", value: money(summary.yesterdayElectricCost, summary.currency || "CNY") },
      { label: "待确认账单", value: formatValue(summary.pendingBills, "条") },
    ];
    const stats = heroStats.length ? heroStats : fallbackStats;
    statsContainer.innerHTML = stats
      .map((item) => `
        <article class="mini-card">
          <span class="label">${escapeHtml(item.label || "指标")}</span>
          <strong>${escapeHtml(item.value || "--")}</strong>
        </article>
      `)
      .join("");

    const utilityCards = document.getElementById("utilityCards");
    if (!utilities.length) {
      renderEmpty(utilityCards, "接口暂未返回费用分项。");
    } else {
      utilityCards.innerHTML = utilities
        .map((item) => `
          <article class="utility-card">
            <div class="utility-head">
              <strong>${escapeHtml(item.name || item.type || "未命名项目")}</strong>
              <span class="utility-dot" style="background:${escapeHtml(item.color || utilityColor(item.type))}"></span>
            </div>
            <div class="utility-amount">${escapeHtml(money(item.amount, item.currency || summary.currency || "CNY"))}</div>
            <p class="utility-meta">${escapeHtml(item.meta || item.description || "")}</p>
          </article>
        `)
        .join("");
    }

    const statusList = document.getElementById("sourceStatusList");
    if (!sources.length) {
      renderEmpty(statusList, "接口暂未返回采集来源状态。");
    } else {
      statusList.innerHTML = sources
        .map((item) => `
          <div class="status-row">
            <span>${escapeHtml(item.name || item.source || "未知来源")}</span>
            <span class="badge badge-${statusClass(item.status)}">${escapeHtml(item.label || item.statusText || item.status || "未知")}</span>
          </div>
        `)
        .join("");
    }
  }

  function renderTrendChart(payload) {
    const chart = document.getElementById("trendChart");
    const legend = document.getElementById("trendLegend");
    const periods = safeArray(payload.periods);
    const series = safeArray(payload.series);

    setText("trendCaption", payload.caption || `共 ${periods.length || 0} 个周期`);

    if (!periods.length || !series.length) {
      chart.innerHTML = "";
      renderEmpty(chart.closest(".chart-card"), "趋势接口暂无可绘制数据。");
      legend.innerHTML = "";
      return;
    }

    const width = 900;
    const height = 320;
    const padding = { top: 24, right: 24, bottom: 50, left: 46 };
    const allValues = series.flatMap((item) => safeArray(item.values).map((value) => safeNumber(value)));
    const maxValue = Math.max(...allValues, 1);
    const xStep = (width - padding.left - padding.right) / Math.max(periods.length - 1, 1);

    const lines = series
      .map((item) => {
        const points = safeArray(item.values)
          .map((value, index) => {
            const x = padding.left + xStep * index;
            const y = height - padding.bottom - (safeNumber(value) / maxValue) * (height - padding.top - padding.bottom);
            return `${x},${y}`;
          })
          .join(" ");

        return `<polyline fill="none" stroke="${escapeHtml(item.color || utilityColor(item.name))}" stroke-width="4" points="${points}" />`;
      })
      .join("");

    const labels = periods
      .map((period, index) => {
        const x = padding.left + xStep * index;
        return `<text x="${x}" y="${height - 18}" text-anchor="middle" font-size="12" fill="#61758f">${escapeHtml(period)}</text>`;
      })
      .join("");

    const grid = Array.from({ length: 5 }, (_, index) => {
      const y = padding.top + ((height - padding.top - padding.bottom) / 4) * index;
      return `<line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" stroke="rgba(20,49,79,0.08)" />`;
    }).join("");

    chart.innerHTML = `${grid}${lines}${labels}`;
    legend.innerHTML = series
      .map((item) => `
        <span class="legend-item">
          <span class="legend-dot" style="background:${escapeHtml(item.color || utilityColor(item.name))}"></span>
          ${escapeHtml(item.name || "未命名序列")}
        </span>
      `)
      .join("");
  }

  function renderActivityFeed(payload) {
    const composition = safeArray(payload.composition);
    const events = safeArray(payload.events);
    renderCompositionChart(composition);

    const timeline = document.getElementById("activityTimeline");
    if (!events.length) {
      renderEmpty(timeline, "最近没有可展示的动态。");
      return;
    }

    timeline.innerHTML = events
      .map((item, index) => `
        <article class="timeline-item">
          <div class="timeline-marker"></div>
          <div class="timeline-content" ${index === events.length - 1 ? 'style="border-bottom:none;"' : ""}>
            <strong>${escapeHtml(item.title || "未命名事件")}</strong>
            <div class="muted">${escapeHtml(item.summary || item.description || "")}</div>
          </div>
        </article>
      `)
      .join("");
  }

  function renderCompositionChart(items) {
    const chart = document.getElementById("compositionChart");
    if (!items.length) {
      chart.innerHTML = `<text x="80" y="82" text-anchor="middle" font-size="12" fill="#61758f">暂无结构数据</text>`;
      return;
    }

    const total = items.reduce((sum, item) => sum + safeNumber(item.amount), 0) || 1;
    const radius = 48;
    const circumference = 2 * Math.PI * radius;
    let offset = 0;
    const arcs = items
      .map((item) => {
        const portion = safeNumber(item.amount) / total;
        const dash = portion * circumference;
        const stroke = item.color || utilityColor(item.name || item.type);
        const arc = `<circle cx="80" cy="80" r="${radius}" fill="none" stroke="${escapeHtml(stroke)}" stroke-width="16" stroke-linecap="round" stroke-dasharray="${dash} ${circumference}" stroke-dashoffset="${-offset}" transform="rotate(-90 80 80)"></circle>`;
        offset += dash;
        return arc;
      })
      .join("");

    chart.innerHTML = `
      <circle cx="80" cy="80" r="${radius}" fill="none" stroke="#e9eff6" stroke-width="16"></circle>
      ${arcs}
      <text x="80" y="76" text-anchor="middle" font-size="12" fill="#61758f">总支出</text>
      <text x="80" y="94" text-anchor="middle" font-size="18" font-weight="800" fill="#14314f">${escapeHtml(money(total))}</text>
    `;
  }

  function renderBillsTable(payload) {
    const bills = safeArray(payload.items || payload.bills || payload);
    const billTableBody = document.getElementById("billTableBody");

    if (!bills.length) {
      billTableBody.innerHTML = `<tr><td colspan="7"><div class="empty-state">接口暂未返回账单记录。</div></td></tr>`;
      return;
    }

    billTableBody.innerHTML = bills
      .map((item) => `
        <tr>
          <td>${escapeHtml(item.date || "--")}</td>
          <td>${escapeHtml(item.utility || item.type || "--")}</td>
          <td>${escapeHtml(item.period || "--")}</td>
          <td>${escapeHtml(formatValue(item.usage, item.usageUnit))}</td>
          <td>${escapeHtml(money(item.amount, item.currency || "CNY"))}</td>
          <td>${escapeHtml(item.source || "--")}</td>
          <td><span class="tag tag-${statusClass(item.status)}">${escapeHtml(item.statusLabel || item.status || "--")}</span></td>
        </tr>
      `)
      .join("");
  }

  async function initAdmin() {
    const [overviewResult, accountsResult, healthResult, settingsResult, logsResult] = await Promise.allSettled([
      fetchJson("/api/admin/overview"),
      fetchJson("/api/admin/accounts"),
      fetchJson("/api/admin/health"),
      fetchJson("/api/admin/settings"),
      fetchJson("/api/admin/logs?limit=8"),
    ]);

    if (overviewResult.status === "fulfilled") {
      renderAdminOverview(overviewResult.value);
    } else {
      setText("adminDescription", `总览接口加载失败: ${overviewResult.reason.message}`);
      renderError(document.getElementById("adminMetrics"), "未能加载后台指标。");
      renderError(document.getElementById("adminPendingList"), "未能加载待处理事项。");
    }

    if (accountsResult.status === "fulfilled") {
      renderAccounts(accountsResult.value);
    } else {
      renderError(document.getElementById("accountList"), "未能加载账户配置。");
    }

    if (healthResult.status === "fulfilled") {
      renderHealth(healthResult.value);
    } else {
      renderError(document.getElementById("healthList"), "未能加载健康状态。");
    }

    if (settingsResult.status === "fulfilled") {
      renderSettings(settingsResult.value);
    } else {
      setText("settingsStatus", `设置接口加载失败: ${settingsResult.reason.message}`);
    }

    if (logsResult.status === "fulfilled") {
      renderLogs(logsResult.value);
    } else {
      document.getElementById("logTableBody").innerHTML = `<tr><td colspan="4"><div class="error-state">未能加载日志列表。</div></td></tr>`;
    }

    bindAdminActions();
  }

  function renderAdminOverview(payload) {
    const overview = payload.overview || payload;
    const metrics = safeArray(payload.metrics || overview.metrics);
    const pending = safeArray(payload.pendingItems || overview.pendingItems);

    setText("adminEnvLabel", `环境: ${overview.environment || "未知"}`);
    setText("adminHealthLabel", `健康检查: ${overview.lastCheckedAt || "未知"}`);
    setText("adminHeadline", overview.headline || "总览后台采集、健康与配置状态。");
    setText("adminDescription", overview.description || "以下内容来自后台接口。");
    setText("pendingIssuesCount", formatValue(overview.pendingIssueCount, "项"));
    setText("pendingIssuesSummary", overview.pendingIssueSummary || "接口未返回待处理摘要。");
    setText("healthScoreValue", overview.healthScoreLabel || formatValue(overview.healthScore, "%"));
    setText("healthScoreSummary", overview.healthSummary || "接口未返回健康度说明。");

    const pendingList = document.getElementById("adminPendingList");
    if (!pending.length) {
      renderEmpty(pendingList, "当前没有待处理事项。");
    } else {
      pendingList.innerHTML = pending
        .map((item) => `
          <div class="status-row">
            <span>${escapeHtml(item.name || item.title || "待处理事项")}</span>
            <span class="badge badge-${statusClass(item.status)}">${escapeHtml(item.label || item.count || item.status || "--")}</span>
          </div>
        `)
        .join("");
    }

    const metricsContainer = document.getElementById("adminMetrics");
    if (!metrics.length) {
      renderEmpty(metricsContainer, "接口暂未返回后台指标。");
    } else {
      metricsContainer.innerHTML = metrics
        .map((item) => `
          <article class="metric-card">
            <p class="caption">${escapeHtml(item.label || "指标")}</p>
            <strong>${escapeHtml(item.value || "--")}</strong>
            <p>${escapeHtml(item.description || "")}</p>
          </article>
        `)
        .join("");
    }
  }

  function renderAccounts(payload) {
    const accounts = safeArray(payload.items || payload.accounts || payload);
    const accountList = document.getElementById("accountList");

    if (!accounts.length) {
      renderEmpty(accountList, "接口暂未返回账户配置。");
      return;
    }

    accountList.innerHTML = accounts
      .map((item) => `
        <article class="config-row">
          <div class="config-meta">
            <strong>${escapeHtml(item.name || "未命名账户")}</strong>
            <p class="utility-meta">${escapeHtml(item.source || item.description || "")}</p>
          </div>
          <div class="config-pills">
            <span class="chip">${escapeHtml(item.accountNoLabel || item.accountNo || "无账号")}</span>
            <span class="chip">${escapeHtml(item.authMode || "未说明登录方式")}</span>
            <span class="tag tag-${statusClass(item.status)}">${escapeHtml(item.statusLabel || item.status || "--")}</span>
          </div>
        </article>
      `)
      .join("");
  }

  function renderHealth(payload) {
    const checks = safeArray(payload.checks);
    const tasks = safeArray(payload.taskStats);
    const healthList = document.getElementById("healthList");

    if (!checks.length) {
      renderEmpty(healthList, "接口暂未返回健康检查列表。");
    } else {
      healthList.innerHTML = checks
        .map((item) => `
          <div class="health-item">
            <span>${escapeHtml(item.name || "未命名检查")}</span>
            <span class="tag tag-${statusClass(item.status)}">${escapeHtml(item.label || item.status || "--")}</span>
          </div>
        `)
        .join("");
    }

    renderTaskChart(tasks);
  }

  function renderTaskChart(tasks) {
    const chart = document.getElementById("taskChart");
    if (!tasks.length) {
      chart.innerHTML = `<text x="320" y="110" text-anchor="middle" font-size="12" fill="#61758f">暂无任务统计</text>`;
      return;
    }

    const width = 640;
    const height = 220;
    const baseline = 180;
    const maxValue = Math.max(...tasks.map((item) => safeNumber(item.value)), 1);
    const barWidth = Math.min(76, (width - 60) / tasks.length - 14);

    chart.innerHTML = tasks
      .map((item, index) => {
        const x = 40 + index * (barWidth + 16);
        const barHeight = (safeNumber(item.value) / maxValue) * 120;
        const y = baseline - barHeight;
        return `
          <rect x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" rx="12" fill="${escapeHtml(item.color || utilityColor(item.name))}"></rect>
          <text x="${x + barWidth / 2}" y="${baseline + 18}" text-anchor="middle" font-size="12" fill="#61758f">${escapeHtml(item.name || "--")}</text>
          <text x="${x + barWidth / 2}" y="${y - 8}" text-anchor="middle" font-size="12" fill="#14314f">${escapeHtml(String(item.value ?? "--"))}</text>
        `;
      })
      .join("");
  }

  function renderSettings(payload) {
    const settings = payload.settings || payload;
    const form = document.getElementById("settingsForm");
    form.elements.corpId.value = settings.corpId || "";
    form.elements.agentId.value = settings.agentId || "";
    form.elements.dailyPushTime.value = settings.dailyPushTime || "";
    form.elements.monthlyPushTime.value = settings.monthlyPushTime || "";
    form.elements.fallbackStrategy.value = settings.fallbackStrategy || "";
    form.elements.estimationMode.value = settings.estimationMode || "";
    setText("settingsStatus", settings.note || "接口已返回当前配置。");
  }

  function renderLogs(payload) {
    const logs = safeArray(payload.items || payload.logs || payload);
    const logTableBody = document.getElementById("logTableBody");

    if (!logs.length) {
      logTableBody.innerHTML = `<tr><td colspan="4"><div class="empty-state">接口暂未返回日志记录。</div></td></tr>`;
      return;
    }

    logTableBody.innerHTML = logs
      .map((item) => `
        <tr>
          <td>${escapeHtml(item.time || item.timestamp || "--")}</td>
          <td>${escapeHtml(item.module || "--")}</td>
          <td><span class="tag tag-${statusClass(item.level)}">${escapeHtml(item.levelLabel || item.level || "--")}</span></td>
          <td>${escapeHtml(item.summary || item.message || "--")}</td>
        </tr>
      `)
      .join("");
  }

  function bindAdminActions() {
    const reloadAccountsButton = document.getElementById("reloadAccountsButton");
    const testConnectionsButton = document.getElementById("testConnectionsButton");
    const saveSettingsButton = document.getElementById("saveSettingsButton");
    const previewSettingsButton = document.getElementById("previewSettingsButton");
    const settingsStatus = document.getElementById("settingsStatus");
    const form = document.getElementById("settingsForm");

    reloadAccountsButton?.addEventListener("click", () => {
      window.location.reload();
    });

    testConnectionsButton?.addEventListener("click", async () => {
      settingsStatus.textContent = "正在调用 /api/admin/actions/test-connections ...";
      try {
        const result = await fetchJson("/api/admin/actions/test-connections", { method: "POST" });
        settingsStatus.textContent = result.message || "连接测试完成。";
      } catch (error) {
        settingsStatus.textContent = `连接测试失败: ${error.message}`;
      }
    });

    previewSettingsButton?.addEventListener("click", async () => {
      settingsStatus.textContent = "正在调用 /api/admin/settings/preview ...";
      try {
        const result = await fetchJson("/api/admin/settings/preview");
        settingsStatus.textContent = result.message || result.preview || "模板预览已返回。";
      } catch (error) {
        settingsStatus.textContent = `模板预览失败: ${error.message}`;
      }
    });

    saveSettingsButton?.addEventListener("click", async () => {
      const payload = Object.fromEntries(new FormData(form).entries());
      settingsStatus.textContent = "正在保存配置...";
      try {
        const result = await fetchJson("/api/admin/settings", {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        });
        settingsStatus.textContent = result.message || "配置保存成功。";
      } catch (error) {
        settingsStatus.textContent = `配置保存失败: ${error.message}`;
      }
    });
  }
})();
