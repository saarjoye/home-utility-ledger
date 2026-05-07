(function () {
  const state = {
    site: {},
    overview: null,
    analytics: null,
    bills: []
  };

  document.addEventListener("DOMContentLoaded", () => {
    init().catch((error) => {
      renderFatal(error.message || "前台加载失败");
    });
  });

  async function init() {
    bindNavigation();

    const [siteResult, overviewResult, analyticsResult, billsResult] = await Promise.all([
      fetchJson("/api/site"),
      fetchJson("/api/overview"),
      fetchJson("/api/analytics?granularity=month"),
      fetchJson("/api/bills")
    ]);

    state.site = siteResult.site || {};
    state.overview = overviewResult || {};
    state.analytics = analyticsResult || {};
    state.bills = Array.isArray(billsResult.items) ? billsResult.items : [];

    renderSummary();
    renderTrendChart();
    renderActivityFeed();
    renderBillsTable();
  }

  async function fetchJson(url, options = {}) {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        ...(options.headers || {})
      },
      ...options
    });

    if (response.status === 401) {
      window.location.href = "/login";
      throw new Error("未登录或登录已失效");
    }

    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    if (!response.ok) {
      throw new Error(payload?.error || `${url} returned ${response.status}`);
    }

    return payload;
  }

  function renderSummary() {
    const overview = state.overview || {};
    const summary = overview.summary || {};
    const highlights = overview.highlights || {};
    const utilities = safeArray(overview.utilityCards);
    const composition = safeArray(overview.charts?.composition);
    const pendingCount = state.bills.filter((item) => String(item.status || "").toLowerCase() !== "confirmed").length;

    setText("dashboardLastSync", `最近同步: ${formatDateTime(summary.lastSyncedAt)}`);
    setText("dashboardHomeLabel", `家庭: ${state.site.title || "家庭水电燃账本"}`);
    setText("heroHeadline", `${summary.monthLabel || "本月"}家庭水电燃账单总览`);
    setText("heroDescription", "统一查看本月支出、周期账单与最近同步动态。");
    setText("sidebarTotalAmount", money(summary.totalAmount, summary.currency || "CNY"));
    setText("sidebarInsight", highlights.gas?.message || highlights.water?.message || "暂无新的账单提醒。");

    if (highlights.electricity) {
      setText("todayUsageValue", formatValue(highlights.electricity.usageValue, highlights.electricity.usageUnit));
      setText(
        "todayUsageSummary",
        `${formatDate(highlights.electricity.date)} 用电费用 ${money(highlights.electricity.amount, summary.currency || "CNY")}`
      );
    } else {
      setText("todayUsageValue", "--");
      setText("todayUsageSummary", "暂无昨日用电摘要。");
    }

    setText(
      "dashboardFootnote",
      "电费支持真实日数据；水费和燃气目前以账单周期统计为主，不伪装成日账单。"
    );

    const heroStats = [
      { label: "本月总支出", value: money(summary.totalAmount, summary.currency || "CNY") },
      {
        label: "昨日用电费用",
        value: highlights.electricity ? money(highlights.electricity.amount, summary.currency || "CNY") : "--"
      },
      { label: "待确认账单", value: `${pendingCount} 条` }
    ];

    document.getElementById("heroStats").innerHTML = heroStats.map((item) => `
      <article class="mini-card">
        <span class="label">${escapeHtml(item.label)}</span>
        <strong>${escapeHtml(item.value)}</strong>
      </article>
    `).join("");

    const utilityCards = document.getElementById("utilityCards");
    utilityCards.innerHTML = utilities.map((item) => `
      <article class="utility-card">
        <div class="utility-head">
          <strong>${escapeHtml(item.label || utilityLabel(item.utilityType))}</strong>
          <span class="utility-dot" style="background:${escapeHtml(utilityColor(item.utilityType))}"></span>
        </div>
        <div class="utility-amount">${escapeHtml(money(item.amount, summary.currency || "CNY"))}</div>
        <p class="utility-meta">
          ${escapeHtml(formatValue(item.usage?.value, item.usage?.unit))} · ${escapeHtml(item.detail || "暂无补充说明")}
        </p>
      </article>
    `).join("");

    const sourceStatusList = document.getElementById("sourceStatusList");
    sourceStatusList.innerHTML = buildSourceStatusRows(utilities, composition).map((item) => `
      <div class="status-row">
        <span>${escapeHtml(item.name)}</span>
        <span class="badge badge-${statusClass(item.status)}">${escapeHtml(item.label)}</span>
      </div>
    `).join("");
  }

  function buildSourceStatusRows(utilities, composition) {
    const totals = new Map(composition.map((item) => [item.utilityType, item.amount]));
    return utilities.map((item) => {
      const utilityType = item.utilityType;
      if (utilityType === "electricity") {
        return { name: "电力数据", label: "已同步", status: "success" };
      }
      if (utilityType === "water") {
        return {
          name: "水务数据",
          label: totals.has("water") ? "周期账单" : "待同步",
          status: totals.has("water") ? "info" : "warning"
        };
      }
      return {
        name: "燃气数据",
        label: String(item.detail || "").includes("清单") ? "待确认" : "已同步",
        status: String(item.detail || "").includes("清单") ? "warning" : "success"
      };
    });
  }

  function renderTrendChart() {
    const chart = document.getElementById("trendChart");
    const legend = document.getElementById("trendLegend");
    const points = safeArray(state.analytics?.points);
    setText("trendCaption", `共 ${points.length} 个统计周期`);

    if (!points.length) {
      chart.innerHTML = "";
      legend.innerHTML = "";
      chart.closest(".chart-card").insertAdjacentHTML("beforeend", `<div class="empty-state">暂无趋势数据</div>`);
      return;
    }

    const series = [
      { name: "电费", color: utilityColor("electricity"), values: points.map((item) => safeNumber(item.electricity)) },
      { name: "水费", color: utilityColor("water"), values: points.map((item) => safeNumber(item.water)) },
      { name: "燃气费", color: utilityColor("gas"), values: points.map((item) => safeNumber(item.gas)) }
    ];
    const periods = points.map((item) => item.period);

    const width = 900;
    const height = 320;
    const padding = { top: 24, right: 24, bottom: 50, left: 46 };
    const maxValue = Math.max(...series.flatMap((item) => item.values), 1);
    const xStep = (width - padding.left - padding.right) / Math.max(periods.length - 1, 1);

    const grid = Array.from({ length: 5 }, (_, index) => {
      const y = padding.top + ((height - padding.top - padding.bottom) / 4) * index;
      return `<line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" stroke="rgba(20,49,79,0.12)" />`;
    }).join("");

    const lines = series.map((item) => {
      const pointsText = item.values.map((value, index) => {
        const x = padding.left + (xStep * index);
        const y = height - padding.bottom - ((safeNumber(value) / maxValue) * (height - padding.top - padding.bottom));
        return `${x},${y}`;
      }).join(" ");

      return `<polyline fill="none" stroke="${escapeHtml(item.color)}" stroke-width="4" points="${pointsText}" />`;
    }).join("");

    const labels = periods.map((period, index) => {
      const x = padding.left + (xStep * index);
      return `<text x="${x}" y="${height - 18}" text-anchor="middle" font-size="12" fill="#61758f">${escapeHtml(period)}</text>`;
    }).join("");

    chart.innerHTML = `${grid}${lines}${labels}`;
    legend.innerHTML = series.map((item) => `
      <span class="legend-item">
        <span class="legend-dot" style="background:${escapeHtml(item.color)}"></span>
        ${escapeHtml(item.name)}
      </span>
    `).join("");
  }

  function renderActivityFeed() {
    const composition = safeArray(state.overview?.charts?.composition);
    const events = safeArray(state.overview?.recentActivity);
    renderCompositionChart(composition);

    const timeline = document.getElementById("activityTimeline");
    if (!events.length) {
      timeline.innerHTML = `<div class="empty-state">暂无最近动态</div>`;
      return;
    }

    timeline.innerHTML = events.map((item, index) => `
      <article class="timeline-item">
        <div class="timeline-marker"></div>
        <div class="timeline-content" ${index === events.length - 1 ? 'style="border-bottom:none;"' : ""}>
          <strong>${escapeHtml(item.title || "未命名事件")}</strong>
          <div class="muted">${escapeHtml(item.summary || "暂无摘要")}</div>
        </div>
      </article>
    `).join("");
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
    const arcs = items.map((item) => {
      const portion = safeNumber(item.amount) / total;
      const dash = portion * circumference;
      const stroke = utilityColor(item.utilityType);
      const arc = `<circle cx="80" cy="80" r="${radius}" fill="none" stroke="${escapeHtml(stroke)}" stroke-width="16" stroke-linecap="round" stroke-dasharray="${dash} ${circumference}" stroke-dashoffset="${-offset}" transform="rotate(-90 80 80)"></circle>`;
      offset += dash;
      return arc;
    }).join("");

    chart.innerHTML = `
      <circle cx="80" cy="80" r="${radius}" fill="none" stroke="#e9eff6" stroke-width="16"></circle>
      ${arcs}
      <text x="80" y="76" text-anchor="middle" font-size="12" fill="#61758f">总支出</text>
      <text x="80" y="94" text-anchor="middle" font-size="18" font-weight="800" fill="#14314f">${escapeHtml(money(total))}</text>
    `;
  }

  function renderBillsTable() {
    const billTableBody = document.getElementById("billTableBody");
    if (!state.bills.length) {
      billTableBody.innerHTML = `<tr><td colspan="7"><div class="empty-state">暂无账单记录</div></td></tr>`;
      return;
    }

    billTableBody.innerHTML = state.bills.map((item) => `
      <tr>
        <td>${escapeHtml(formatDate(item.statementDate))}</td>
        <td>${escapeHtml(utilityLabel(item.utilityType))}</td>
        <td>${escapeHtml(formatPeriod(item.periodStart, item.periodEnd))}</td>
        <td>${escapeHtml(formatValue(item.usageValue, item.usageUnit))}</td>
        <td>${escapeHtml(money(item.amount, item.currency || "CNY"))}</td>
        <td>${escapeHtml(item.sourceChannel || "--")}</td>
        <td><span class="tag tag-${statusClass(item.status)}">${escapeHtml(item.status || "--")}</span></td>
      </tr>
    `).join("");
  }

  function bindNavigation() {
    const navItems = Array.from(document.querySelectorAll(".sidebar .nav-item"));
    const sectionItems = navItems
      .filter((item) => item.getAttribute("href")?.startsWith("#"))
      .map((item) => {
        const targetId = item.getAttribute("href").slice(1);
        const section = document.getElementById(targetId);
        return section ? { item, targetId, section } : null;
      })
      .filter(Boolean);

    const homeNavItem = navItems.find((item) => !item.getAttribute("href")?.startsWith("#") && item.getAttribute("href")?.includes("index"));

    const setActive = (targetId = "") => {
      if (homeNavItem) {
        homeNavItem.classList.toggle("active", !targetId);
      }
      for (const sectionItem of sectionItems) {
        sectionItem.item.classList.toggle("active", sectionItem.targetId === targetId);
      }
    };

    const syncActive = () => {
      const hashTargetId = window.location.hash.slice(1);
      if (hashTargetId && sectionItems.some((item) => item.targetId === hashTargetId)) {
        setActive(hashTargetId);
        return;
      }

      const visible = sectionItems
        .map((item) => ({
          targetId: item.targetId,
          top: item.section.getBoundingClientRect().top
        }))
        .filter((item) => item.top <= 160)
        .sort((left, right) => Math.abs(left.top) - Math.abs(right.top));

      setActive(visible[0]?.targetId || "");
    };

    for (const sectionItem of sectionItems) {
      sectionItem.item.addEventListener("click", () => setActive(sectionItem.targetId));
    }

    window.addEventListener("hashchange", syncActive);
    window.addEventListener("scroll", syncActive, { passive: true });
    syncActive();
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
      maximumFractionDigits: 2
    }).format(safeNumber(value));
  }

  function formatValue(value, unit) {
    if (value === null || value === undefined || value === "") {
      return "--";
    }
    return unit ? `${value} ${unit}` : `${value}`;
  }

  function formatDate(value) {
    if (!value) {
      return "--";
    }
    return String(value).slice(0, 10);
  }

  function formatDateTime(value) {
    if (!value) {
      return "--";
    }
    return String(value).replace("T", " ").replace(".000Z", "Z");
  }

  function formatPeriod(start, end) {
    if (!start && !end) {
      return "--";
    }
    return `${formatDate(start)} 至 ${formatDate(end)}`;
  }

  function utilityLabel(type) {
    if (type === "electricity") return "电";
    if (type === "water") return "水";
    if (type === "gas") return "燃气";
    return type || "--";
  }

  function utilityColor(type) {
    if (type === "water") return "var(--water)";
    if (type === "gas") return "var(--gas)";
    return "var(--elec)";
  }

  function statusClass(status) {
    const value = String(status || "").toLowerCase();
    if (["ok", "healthy", "success", "synced", "enabled", "confirmed"].includes(value)) {
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

  function setText(id, value) {
    const element = document.getElementById(id);
    if (element) {
      element.textContent = value;
    }
  }

  function renderFatal(message) {
    setText("heroDescription", message);
    const utilityCards = document.getElementById("utilityCards");
    if (utilityCards) {
      utilityCards.innerHTML = `<div class="error-state">${escapeHtml(message)}</div>`;
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
})();
